import * as pdf from '~/lib/pdf/core';
import * as struct from '~/lib/pdf/structure';
import * as enhance from '~/lib/pdf/enhance';
import { rasterizePdf } from '~/lib/pdf/render';
import {
  applyImageSignature,
  applySignatureToPages,
  applyTextSignature,
} from '~/lib/pdf/sign';
import type { ToolProcessor } from '../types';
import {
  IMAGES,
  PDF,
  checkbox,
  derive,
  fileField,
  first,
  int,
  num,
  onePdf,
  processor,
  rangeField,
  rangeSlider,
  selectField,
  str,
  textResult,
} from './common';

const POSITIONS = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'top-right', label: 'Top right' },
];

export const editProcessors: Record<string, ToolProcessor> = {
  'add-watermark': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'text',
        label: 'Watermark text',
        type: 'text',
        defaultValue: 'CONFIDENTIAL',
      },
      rangeSlider('opacity', 'Opacity', 0.05, 1, 0.05, 0.25),
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.watermarkPdf(
        file,
        str(ctx, 'text', 'WATERMARK'),
        num(ctx, 'opacity', 0.25)
      );
      return onePdf(bytes, derive(file, 'watermarked'));
    },
  }),

  'page-numbers': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('format', 'Format', [
        { value: 'n', label: '1, 2, 3…' },
        { value: 'n/N', label: '1 / 10' },
      ]),
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.pageNumbersPdf(file, str(ctx, 'format', 'n'));
      return onePdf(bytes, derive(file, 'numbered'));
    },
  }),

  'bates-numbering': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'prefix',
        label: 'Prefix',
        type: 'text',
        defaultValue: 'BATES',
        placeholder: 'e.g. ACME',
      },
      { key: 'suffix', label: 'Suffix', type: 'text', defaultValue: '' },
      {
        key: 'start',
        label: 'Starting number',
        type: 'number',
        defaultValue: '1',
        min: 0,
      },
      {
        key: 'digits',
        label: 'Zero-padded digits',
        type: 'number',
        defaultValue: '6',
        min: 1,
        max: 12,
      },
      selectField('position', 'Position', POSITIONS),
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.batesNumber(file, {
        prefix: str(ctx, 'prefix'),
        suffix: str(ctx, 'suffix'),
        start: int(ctx, 'start', 1),
        digits: Math.max(1, int(ctx, 'digits', 6)),
        position: str(
          ctx,
          'position',
          'bottom-right'
        ) as struct.BatesOptions['position'],
      });
      return onePdf(bytes, derive(file, 'bates'));
    },
  }),

  'header-footer': processor({
    accept: PDF,
    multiple: false,
    fields: [
      { key: 'header', label: 'Header text', type: 'text', defaultValue: '' },
      { key: 'footer', label: 'Footer text', type: 'text', defaultValue: '' },
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.headerFooterPdf(
        file,
        str(ctx, 'header'),
        str(ctx, 'footer')
      );
      return onePdf(bytes, derive(file, 'header-footer'));
    },
  }),

  'add-page-labels': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'spec',
        label: 'Label ranges',
        type: 'textarea',
        defaultValue: '1: r\n5: D',
        placeholder: '1: r\n5: D',
        help: 'One rule per line: "start page: style". Styles — D decimal, r/R roman, a/A letters. Add a prefix after the style, e.g. "5: D App-".',
      },
    ],
    note: 'Sets the labels a PDF viewer shows in its page box (e.g. i, ii, iii then 1, 2, 3).',
    async process(ctx) {
      const file = first(ctx);
      const ranges = str(ctx, 'spec')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(\d+)\s*:\s*([DrRaA])?\s*(.*)$/);
          if (!match) throw new Error(`Cannot parse label rule: "${line}"`);
          return {
            start: parseInt(match[1]!, 10),
            style: match[2] ?? 'D',
            prefix: match[3]?.trim() ?? '',
            firstNumber: 1,
          };
        });
      if (ranges.length === 0) throw new Error('Add at least one label rule');
      const bytes = await struct.addPageLabels(file, ranges);
      return onePdf(bytes, derive(file, 'labelled'));
    },
  }),

  bookmark: processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'spec',
        label: 'Bookmarks',
        type: 'textarea',
        defaultValue: 'Introduction: 1\n  Background: 2\nConclusion: 8',
        help: 'One per line as "Title: page". Indent by two spaces (or a tab) to nest.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const specs = struct.parseBookmarkSpec(str(ctx, 'spec'));
      const bytes = await struct.addBookmarks(file, specs);
      return {
        ...onePdf(bytes, derive(file, 'bookmarked')),
        message: `Added ${specs.length} bookmark(s).`,
      };
    },
  }),

  'table-of-contents': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'title',
        label: 'Heading',
        type: 'text',
        defaultValue: 'Contents',
      },
      {
        key: 'spec',
        label: 'Entries',
        type: 'textarea',
        defaultValue: 'Introduction: 1\n  Background: 2\nConclusion: 8',
        help: 'One per line as "Title: page". Indent to nest. Page numbers refer to the original document; the inserted contents pages are accounted for automatically.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const specs = struct.parseBookmarkSpec(str(ctx, 'spec'));
      const bytes = await struct.addTableOfContents(
        file,
        specs,
        str(ctx, 'title', 'Contents')
      );
      return onePdf(bytes, derive(file, 'with-toc'));
    },
  }),

  'crop-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'top',
        label: 'Trim from top (pt)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
      {
        key: 'right',
        label: 'Trim from right (pt)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
      {
        key: 'bottom',
        label: 'Trim from bottom (pt)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
      {
        key: 'left',
        label: 'Trim from left (pt)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
      rangeField,
    ],
    note: '72 points = 1 inch. Cropping sets the visible box; the underlying content is preserved.',
    async process(ctx) {
      const file = first(ctx);
      const margins = {
        top: num(ctx, 'top'),
        right: num(ctx, 'right'),
        bottom: num(ctx, 'bottom'),
        left: num(ctx, 'left'),
      };
      if (Object.values(margins).every((v) => v === 0)) {
        throw new Error('Set at least one margin to trim');
      }
      const bytes = await struct.cropPdf(file, margins, str(ctx, 'range'));
      return onePdf(bytes, derive(file, 'cropped'));
    },
  }),

  'remove-annotations': processor({
    accept: PDF,
    multiple: false,
    note: 'Removes comments, highlights, links and form widgets.',
    async process(ctx) {
      const file = first(ctx);
      return onePdf(
        await struct.removeAnnotations(file),
        derive(file, 'no-annotations')
      );
    },
  }),

  'invert-colors': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Rendering pages');
      return onePdf(await pdf.invertPdfColors(file), derive(file, 'inverted'));
    },
  }),

  'adjust-colors': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    fields: [
      rangeSlider('brightness', 'Brightness', -100, 100, 1, 0),
      rangeSlider('contrast', 'Contrast', -100, 100, 1, 0),
      rangeSlider('saturation', 'Saturation', 0, 2, 0.05, 1),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Adjusting pages');
      const bytes = await enhance.adjustPdfColors(file, {
        brightness: num(ctx, 'brightness', 0),
        contrast: num(ctx, 'contrast', 0),
        saturation: num(ctx, 'saturation', 1),
      });
      return onePdf(bytes, derive(file, 'adjusted'));
    },
  }),

  'scanner-effect': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    fields: [
      rangeSlider('strength', 'Contrast punch', 0, 1, 0.05, 0.5),
      rangeSlider('grain', 'Grain', 0, 1, 0.05, 0.15),
      rangeSlider('yellowing', 'Paper warmth', 0, 1, 0.05, 0.2),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Applying scan effect');
      const bytes = await enhance.scannerEffect(file, {
        strength: num(ctx, 'strength', 0.5),
        grain: num(ctx, 'grain', 0.15),
        yellowing: num(ctx, 'yellowing', 0.2),
      });
      return onePdf(bytes, derive(file, 'scanned'));
    },
  }),

  'background-color': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'color',
        label: 'Background colour',
        type: 'color',
        defaultValue: '#fffdf5',
      },
    ],
    note: 'Paints a solid colour behind the existing content — vector text stays selectable.',
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.setBackgroundColor(
        file,
        struct.hexToRgb(str(ctx, 'color', '#ffffff'))
      );
      return onePdf(bytes, derive(file, 'background'));
    },
  }),

  'text-color': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    fields: [
      {
        key: 'color',
        label: 'Text colour',
        type: 'color',
        defaultValue: '#1a3fbf',
      },
      rangeSlider(
        'threshold',
        'Darkness cutoff',
        40,
        220,
        5,
        128,
        'Pixels darker than this are treated as text.'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Recolouring text');
      const bytes = await enhance.recolorText(
        file,
        struct.hexToRgb(str(ctx, 'color', '#000000')),
        num(ctx, 'threshold', 128)
      );
      return onePdf(bytes, derive(file, 'recoloured'));
    },
  }),

  'sign-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('kind', 'Signature type', [
        { value: 'image', label: 'Image (scan or drawn signature)' },
        { value: 'text', label: 'Typed name' },
      ]),
      fileField('signature', 'Signature image', IMAGES, {
        help: 'A PNG with transparency works best.',
      }),
      {
        key: 'text',
        label: 'Typed signature',
        type: 'text',
        defaultValue: '',
        showWhen: { key: 'kind', equals: ['text'] },
      },
      { key: 'page', label: 'Page', type: 'number', defaultValue: '1', min: 1 },
      {
        key: 'allPages',
        label: 'Apply to a page range instead',
        type: 'text',
        defaultValue: '',
        placeholder: 'e.g. 1-3 (leave blank for a single page)',
      },
      rangeSlider('x', 'Horizontal position', 0, 0.95, 0.01, 0.6),
      rangeSlider('y', 'Vertical position', 0, 0.95, 0.01, 0.1),
      rangeSlider('width', 'Width (fraction of page)', 0.05, 0.8, 0.01, 0.25),
    ],
    note: 'This places a visible signature graphic. For a cryptographic signature use "Digitally Sign PDF".',
    async process(ctx) {
      const file = first(ctx);
      const placement = {
        page: int(ctx, 'page', 1),
        x: num(ctx, 'x', 0.6),
        y: num(ctx, 'y', 0.1),
        width: num(ctx, 'width', 0.25),
      };

      if (str(ctx, 'kind', 'image') === 'text') {
        const bytes = await applyTextSignature(
          file,
          str(ctx, 'text'),
          placement
        );
        return onePdf(bytes, derive(file, 'signed'));
      }

      const signature = ctx.extraFiles.signature?.[0];
      if (!signature) throw new Error('Choose a signature image');
      const range = str(ctx, 'allPages');
      const bytes = range
        ? await applySignatureToPages(file, signature, range, placement)
        : await applyImageSignature(file, signature, placement);
      return onePdf(bytes, derive(file, 'signed'));
    },
  }),

  'add-stamps': processor({
    accept: PDF,
    multiple: false,
    fields: [
      fileField('stamp', 'Stamp image', IMAGES),
      rangeField,
      rangeSlider('x', 'Horizontal position', 0, 0.95, 0.01, 0.7),
      rangeSlider('y', 'Vertical position', 0, 0.95, 0.01, 0.75),
      rangeSlider('width', 'Width (fraction of page)', 0.05, 0.8, 0.01, 0.2),
      {
        key: 'rotate',
        label: 'Rotation (degrees)',
        type: 'number',
        defaultValue: '0',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const stamp = ctx.extraFiles.stamp?.[0];
      if (!stamp) throw new Error('Choose a stamp image');
      const bytes = await applySignatureToPages(
        file,
        stamp,
        str(ctx, 'range'),
        {
          x: num(ctx, 'x', 0.7),
          y: num(ctx, 'y', 0.75),
          width: num(ctx, 'width', 0.2),
          rotate: num(ctx, 'rotate', 0),
        }
      );
      return onePdf(bytes, derive(file, 'stamped'));
    },
  }),

  'form-filler': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('action', 'Action', [
        { value: 'list', label: 'List the form fields' },
        { value: 'fill', label: 'Fill fields from JSON' },
      ]),
      {
        key: 'values',
        label: 'Field values (JSON)',
        type: 'textarea',
        defaultValue: '{}',
        placeholder: '{ "Name": "Ada Lovelace", "Agree": "true" }',
        showWhen: { key: 'action', equals: ['fill'] },
      },
      checkbox(
        'flatten',
        'Flatten after filling (makes values permanent)',
        false
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      if (str(ctx, 'action', 'list') === 'list') {
        const fields = await struct.readFormFields(file);
        if (fields.length === 0) throw new Error('This PDF has no form fields');
        const report = JSON.stringify(
          Object.fromEntries(fields.map((f) => [f.name, f.value])),
          null,
          2
        );
        const detail = fields
          .map(
            (f) =>
              `${f.name} (${f.type})${f.options ? ` options: ${f.options.join(', ')}` : ''}`
          )
          .join('\n');
        return {
          ...textResult(
            derive(file, 'fields', 'json'),
            report,
            'application/json'
          ),
          preview: {
            title: `${fields.length} form field(s)`,
            text: `${detail}\n\n${report}`,
          },
        };
      }

      let values: Record<string, string>;
      try {
        const parsed = JSON.parse(str(ctx, 'values', '{}')) as Record<
          string,
          unknown
        >;
        values = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, String(v)])
        );
      } catch {
        throw new Error('Field values must be valid JSON');
      }
      const bytes = await struct.fillFormFields(
        file,
        values,
        ctx.values.flatten === 'true'
      );
      return onePdf(bytes, derive(file, 'filled'));
    },
  }),

  'flatten-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('mode', 'Flatten', [
        { value: 'form', label: 'Form fields only (keeps text selectable)' },
        { value: 'full', label: 'Everything (rasterize each page)' },
      ]),
    ],
    async process(ctx) {
      const file = first(ctx);
      if (str(ctx, 'mode', 'form') === 'full') {
        ctx.onProgress('Rasterizing pages');
        return onePdf(
          await rasterizePdf(file, { scale: 2 }),
          derive(file, 'flat')
        );
      }
      return onePdf(await pdf.flattenForm(file), derive(file, 'flat'));
    },
  }),
};
