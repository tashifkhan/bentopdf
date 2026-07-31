import * as conv from '~/lib/pdf/convert';
import * as formats from '~/lib/pdf/formats';
import * as layers from '~/lib/pdf/layers';
import * as pdfa from '~/lib/pdf/pdfa';
import { pdfToSvg } from '~/lib/pdf/svg';
import * as gs from '~/lib/pdf/ghostscript';
import { canvasToBytes } from '~/lib/pdf/render';
import type { ToolProcessor } from '../types';
import {
  PDF,
  checkbox,
  derive,
  first,
  num,
  onePdf,
  processor,
  rangeSlider,
  requireFiles,
  selectField,
  stem,
  str,
  textResult,
} from './common';

export const formatProcessors: Record<string, ToolProcessor> = {
  /* ------------------------------------------------- font outlining */

  'font-to-outline': processor({
    accept: PDF,
    multiple: false,
    note: 'Converts every glyph to a vector path, so the file renders identically anywhere without needing its fonts. Text stops being selectable or searchable. This needs Ghostscript, which is GPL-licensed and ~10 MB, so it is not bundled — point the field below at a Ghostscript-WASM build you host.',
    fields: [
      {
        key: 'engineUrl',
        label: 'Ghostscript-WASM base URL',
        type: 'text',
        defaultValue: '',
        placeholder: 'https://example.com/ghostscript/',
        help: 'A folder containing gs.js and gs.wasm. Remembered in this browser only.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const url = str(ctx, 'engineUrl').trim();
      // An entered URL wins and is persisted; otherwise reuse what is stored.
      if (url) gs.setGhostscriptUrl(url);
      if (!gs.isGhostscriptConfigured()) {
        throw new Error(
          'No Ghostscript build configured. Paste the base URL of a Ghostscript-WASM build (a folder with gs.js and gs.wasm) above.'
        );
      }
      const bytes = await gs.fontsToOutlines(file, (m) => ctx.onProgress(m));
      return {
        ...onePdf(bytes, derive(file, 'outlined')),
        message: 'Fonts converted to vector outlines.',
      };
    },
  }),

  /* ------------------------------------------------------ iWork Pages */

  'pages-to-pdf': processor({
    accept: '.pages,.numbers,.key',
    multiple: true,
    note: 'Apple iWork documents embed a full-fidelity PDF preview rendered by the app itself — that preview is what gets extracted. If Pages was set not to include a preview, re-save with "Include preview in document" enabled.',
    async process(ctx) {
      requireFiles(ctx);
      const files = [];
      for (const file of ctx.files) {
        ctx.onProgress(`Reading ${file.name}`);
        files.push({
          name: `${stem(file.name)}.pdf`,
          bytes: await formats.iworkPreviewPdf(file),
          mime: 'application/pdf',
        });
      }
      return { files };
    },
  }),

  /* ------------------------------------------------------------- PSD */

  'psd-to-pdf': processor({
    accept: '.psd,image/vnd.adobe.photoshop',
    multiple: true,
    note: 'Reads the flattened composite Photoshop saves inside every PSD. Individual layers are not preserved. 8-bit RGB and greyscale documents with raw or RLE compression are supported.',
    fields: [
      selectField('pageSize', 'Page size', [
        { value: 'fit', label: 'Fit page to the image' },
        { value: 'a4', label: 'A4' },
        { value: 'letter', label: 'Letter' },
      ]),
      {
        key: 'margin',
        label: 'Margin (points)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
    ],
    async process(ctx) {
      requireFiles(ctx);
      const rendered: File[] = [];
      for (const file of ctx.files) {
        ctx.onProgress(`Decoding ${file.name}`);
        const canvas = await formats.psdToCanvas(file);
        const png = await canvasToBytes(canvas, 'image/png');
        rendered.push(
          new File(
            [new Uint8Array(png).buffer as ArrayBuffer],
            `${stem(file.name)}.png`,
            {
              type: 'image/png',
            }
          )
        );
      }
      ctx.onProgress('Building PDF');
      const bytes = await conv.imagesToPdfAdvanced(rendered, {
        pageSize: str(ctx, 'pageSize', 'fit') as 'fit' | 'a4' | 'letter',
        orientation: 'auto',
        margin: num(ctx, 'margin', 0),
      });
      const name =
        ctx.files.length === 1
          ? `${stem(ctx.files[0]!.name)}.pdf`
          : 'photoshop.pdf';
      return onePdf(bytes, name);
    },
  }),

  /* ------------------------------------------------------------ MOBI */

  'mobi-to-pdf': processor({
    accept: '.mobi,.azw,.azw3,.prc',
    multiple: true,
    note: 'Reads the PalmDOC text stream inside DRM-free MOBI files. Formatting is simplified to flowing text; DRM-protected and HUFF/CDIC-compressed books cannot be read.',
    fields: [
      selectField(
        'font',
        'Font',
        [
          { value: 'regular', label: 'Helvetica' },
          { value: 'mono', label: 'Courier' },
        ],
        'regular'
      ),
      {
        key: 'fontSize',
        label: 'Font size',
        type: 'number',
        defaultValue: '11',
        min: 6,
      },
      selectField(
        'pageSize',
        'Page size',
        [
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter' },
          { value: 'a5', label: 'A5 (e-reader size)' },
        ],
        'a4'
      ),
    ],
    async process(ctx) {
      requireFiles(ctx);
      const struct = await import('~/lib/pdf/structure');
      const files = [];
      for (const file of ctx.files) {
        ctx.onProgress(`Reading ${file.name}`);
        const book = await formats.readMobi(file);
        const body = book.title ? `${book.title}\n\n${book.text}` : book.text;
        files.push(
          await conv.plainTextToPdf(body, `${stem(file.name)}.pdf`, {
            font: str(ctx, 'font', 'regular') as 'regular' | 'mono',
            fontSize: num(ctx, 'fontSize', 11),
            pageSize: struct.NAMED_SIZES[str(ctx, 'pageSize', 'a4')],
          })
        );
      }
      return { files };
    },
  }),

  /* ------------------------------------------------------------- SVG */

  'pdf-to-svg': processor({
    accept: PDF,
    multiple: false,
    note: 'pdf.js removed its vector SVG renderer, so the artwork is embedded as a high-resolution image inside a real SVG. The original text is added as selectable <text> elements, so search and copy still work.',
    fields: [
      rangeSlider('scale', 'Artwork resolution', 1, 4, 0.5, 2),
      selectField(
        'format',
        'Embedded image format',
        [
          { value: 'png', label: 'PNG (lossless, larger)' },
          { value: 'jpeg', label: 'JPEG (smaller)' },
        ],
        'png'
      ),
      {
        ...rangeSlider('quality', 'JPEG quality', 0.3, 1, 0.05, 0.9),
        showWhen: { key: 'format', equals: ['jpeg'] },
      },
      checkbox('textLayer', 'Include a selectable text layer', true),
      checkbox(
        'showText',
        'Make the text layer visible (for checking alignment)',
        false
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      const files = await pdfToSvg(
        file,
        {
          scale: num(ctx, 'scale', 2),
          textLayer: ctx.values.textLayer !== 'false',
          showText: ctx.values.showText === 'true',
          format: str(ctx, 'format', 'png') as 'png' | 'jpeg',
          quality: num(ctx, 'quality', 0.9),
        },
        (m) => ctx.onProgress(m)
      );
      return { files, message: `Exported ${files.length} SVG page(s).` };
    },
  }),

  /* ---------------------------------------------------------- layers */

  'pdf-layers': processor({
    accept: PDF,
    multiple: false,
    note: 'Optional content groups are the layers a PDF viewer lets you toggle. Hiding a layer only changes what opens by default; deleting one removes its content permanently.',
    fields: [
      selectField('action', 'Action', [
        { value: 'list', label: 'List the layers in this PDF' },
        { value: 'hide', label: 'Hide layers by default' },
        { value: 'show', label: 'Show all layers by default' },
        { value: 'delete', label: 'Delete layers permanently' },
      ]),
      {
        key: 'names',
        label: 'Layer names',
        type: 'textarea',
        defaultValue: '',
        placeholder: 'One layer name per line, exactly as listed',
        help: 'Run "List the layers" first to see the exact names.',
        showWhen: { key: 'action', equals: ['hide', 'delete'] },
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const action = str(ctx, 'action', 'list');
      const found = await layers.listLayers(file);

      if (found.length === 0) {
        throw new Error('This PDF has no optional content layers');
      }

      if (action === 'list') {
        const report = found
          .map((l) => `${l.visible ? '[visible]' : '[hidden] '} ${l.name}`)
          .join('\n');
        return {
          ...textResult(derive(file, 'layers', 'txt'), report, 'text/plain'),
          message: `Found ${found.length} layer(s).`,
          preview: { title: 'Layers', text: report },
        };
      }

      if (action === 'show') {
        const bytes = await layers.setLayerVisibility(file, []);
        return {
          ...onePdf(bytes, derive(file, 'layers-shown')),
          message: `All ${found.length} layer(s) now visible by default.`,
        };
      }

      const wanted = new Set(
        str(ctx, 'names')
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean)
      );
      if (wanted.size === 0) throw new Error('List at least one layer name');

      const matched = found.filter((l) => wanted.has(l.name));
      if (matched.length === 0) {
        throw new Error(
          `No layer matched. Available: ${found.map((l) => l.name).join(', ')}`
        );
      }

      if (action === 'hide') {
        const bytes = await layers.setLayerVisibility(
          file,
          matched.map((l) => l.id)
        );
        return {
          ...onePdf(bytes, derive(file, 'layers-hidden')),
          message: `Hid ${matched.length} layer(s) by default.`,
        };
      }

      ctx.onProgress('Removing layer content');
      const { bytes, removed } = await layers.deleteLayers(
        file,
        matched.map((l) => l.id)
      );
      return {
        ...onePdf(bytes, derive(file, 'layers-removed')),
        message:
          removed > 0
            ? `Removed ${matched.length} layer(s) and ${removed} content block(s).`
            : `Removed ${matched.length} layer(s) from the layer list, but found no marked content to strip.`,
      };
    },
  }),

  /* ----------------------------------------------------------- PDF/A */

  'pdf-to-pdfa': processor({
    accept: PDF,
    multiple: false,
    note: 'Adds the sRGB OutputIntent, PDF/A identification metadata and document ID that the standard requires, and removes constructs it forbids. This build does not run a validator, so treat the result as best-effort rather than certified.',
    fields: [
      selectField(
        'part',
        'PDF/A version',
        [
          { value: '2', label: 'PDF/A-2 (recommended)' },
          { value: '1', label: 'PDF/A-1' },
          { value: '3', label: 'PDF/A-3 (allows attachments)' },
        ],
        '2'
      ),
      selectField(
        'conformance',
        'Conformance level',
        [
          { value: 'B', label: 'Level B — visual reproduction' },
          { value: 'A', label: 'Level A — also requires tagging' },
        ],
        'B'
      ),
      checkbox(
        'flatten',
        'Rasterize pages first',
        true,
        'Guarantees the font-embedding rules are met, at the cost of selectable text.'
      ),
      {
        ...rangeSlider('rasterScale', 'Rasterize resolution', 1, 4, 0.5, 2),
        showWhen: { key: 'flatten', equals: ['true'] },
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const { bytes, notes } = await pdfa.toPdfA(
        file,
        {
          part: str(ctx, 'part', '2'),
          conformance: str(ctx, 'conformance', 'B') as 'A' | 'B',
          flatten: ctx.values.flatten !== 'false',
          rasterScale: num(ctx, 'rasterScale', 2),
        },
        (m) => ctx.onProgress(m)
      );
      return {
        ...onePdf(bytes, derive(file, 'pdfa')),
        message: `Declared PDF/A-${str(ctx, 'part', '2')}${str(ctx, 'conformance', 'B')}. ${notes.join(' ')}`,
      };
    },
  }),
};
