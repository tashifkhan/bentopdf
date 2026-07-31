import * as pdf from '~/lib/pdf/core';
import * as struct from '~/lib/pdf/structure';
import * as enhance from '~/lib/pdf/enhance';
import * as stamp from '~/lib/pdf/stamp';
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

const fontFamilyField = selectField(
  'fontFamily',
  'Font',
  stamp.FONT_FAMILIES,
  'Helvetica'
);

export const editProcessors: Record<string, ToolProcessor> = {
  'add-watermark': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('mode', 'Watermark type', [
        { value: 'text', label: 'Text' },
        { value: 'image', label: 'Image' },
      ]),
      {
        key: 'text',
        label: 'Watermark text',
        type: 'text',
        defaultValue: 'CONFIDENTIAL',
        showWhen: { key: 'mode', equals: ['text'] },
      },
      { ...fontFamilyField, showWhen: { key: 'mode', equals: ['text'] } },
      {
        key: 'fontSize',
        label: 'Font size',
        type: 'number',
        defaultValue: '48',
        min: 6,
        showWhen: { key: 'mode', equals: ['text'] },
      },
      {
        key: 'color',
        label: 'Text colour',
        type: 'color',
        defaultValue: '#808080',
        showWhen: { key: 'mode', equals: ['text'] },
      },
      fileField('image', 'Watermark image', IMAGES, {
        help: 'A transparent PNG works best.',
      }),
      rangeSlider(
        'imageScale',
        'Image width (fraction of page)',
        0.05,
        1,
        0.05,
        0.4
      ),
      rangeSlider('opacity', 'Opacity', 0.05, 1, 0.05, 0.25),
      {
        key: 'angle',
        label: 'Rotation (degrees)',
        type: 'number',
        defaultValue: '35',
      },
      checkbox('tile', 'Tile across the whole page', false),
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const mode = str(ctx, 'mode', 'text') as 'text' | 'image';
      const bytes = await stamp.watermarkPdf(
        file,
        {
          mode,
          text: str(ctx, 'text', 'WATERMARK'),
          fontFamily: str(ctx, 'fontFamily', 'HelveticaBold'),
          fontSize: num(ctx, 'fontSize', 48),
          color: str(ctx, 'color', '#808080'),
          opacity: num(ctx, 'opacity', 0.25),
          angle: num(ctx, 'angle', 35),
          imageScale: num(ctx, 'imageScale', 0.4),
          range: str(ctx, 'range'),
          tile: ctx.values.tile === 'true',
        },
        ctx.extraFiles.image?.[0]
      );
      return onePdf(bytes, derive(file, 'watermarked'));
    },
  }),

  'page-numbers': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('format', 'Format', [
        { value: 'page_only', label: '1, 2, 3…' },
        { value: 'page_x_of_y', label: '1 / 10' },
        { value: 'page_x_of_y_words', label: 'Page 1 of 10' },
        { value: '{n}.', label: '1., 2., 3.' },
        { value: '- {n} -', label: '- 1 -' },
      ]),
      selectField('position', 'Position', stamp.POSITIONS, 'bottom-center'),
      fontFamilyField,
      {
        key: 'fontSize',
        label: 'Font size',
        type: 'number',
        defaultValue: '10',
        min: 4,
      },
      { key: 'color', label: 'Colour', type: 'color', defaultValue: '#333333' },
      {
        key: 'startAt',
        label: 'Start numbering at',
        type: 'number',
        defaultValue: '1',
      },
      {
        key: 'margin',
        label: 'Margin (pt)',
        type: 'number',
        defaultValue: '36',
        min: 0,
      },
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await stamp.pageNumbersPdf(file, {
        format: str(ctx, 'format', 'page_only'),
        position: str(ctx, 'position', 'bottom-center') as stamp.Position,
        fontFamily: str(ctx, 'fontFamily', 'Helvetica'),
        fontSize: num(ctx, 'fontSize', 10),
        color: str(ctx, 'color', '#333333'),
        startAt: int(ctx, 'startAt', 1),
        range: str(ctx, 'range'),
        margin: num(ctx, 'margin', 36),
      });
      return onePdf(bytes, derive(file, 'numbered'));
    },
  }),

  'bates-numbering': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'template',
        label: 'Template',
        type: 'text',
        defaultValue: 'BATES{n}',
        help: 'Use {n} where the counter should go, e.g. "ACME-{n}-2026".',
      },
      selectField(
        'padding',
        'Zero padding',
        [
          { value: '0', label: 'None' },
          { value: '3', label: '3 digits' },
          { value: '4', label: '4 digits' },
          { value: '5', label: '5 digits' },
          { value: '6', label: '6 digits' },
        ],
        '6'
      ),
      {
        key: 'start',
        label: 'Starting number',
        type: 'number',
        defaultValue: '1',
        min: 0,
      },
      selectField('position', 'Position', stamp.POSITIONS, 'bottom-right'),
      fontFamilyField,
      {
        key: 'fontSize',
        label: 'Font size',
        type: 'number',
        defaultValue: '10',
        min: 4,
      },
      { key: 'color', label: 'Colour', type: 'color', defaultValue: '#1a1a1a' },
      {
        key: 'margin',
        label: 'Margin (pt)',
        type: 'number',
        defaultValue: '36',
        min: 0,
      },
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await stamp.batesNumber(file, {
        template: str(ctx, 'template', 'BATES{n}'),
        padding: int(ctx, 'padding', 6),
        start: int(ctx, 'start', 1),
        position: str(ctx, 'position', 'bottom-right') as stamp.Position,
        fontFamily: str(ctx, 'fontFamily', 'Helvetica'),
        fontSize: num(ctx, 'fontSize', 10),
        color: str(ctx, 'color', '#1a1a1a'),
        range: str(ctx, 'range'),
        margin: num(ctx, 'margin', 36),
      });
      return onePdf(bytes, derive(file, 'bates'));
    },
  }),

  'header-footer': processor({
    accept: PDF,
    multiple: false,
    note: 'Each of the six slots is independent. Use {n} for the page number and {N} for the total.',
    fields: [
      {
        key: 'headerLeft',
        label: 'Header left',
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'headerCenter',
        label: 'Header centre',
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'headerRight',
        label: 'Header right',
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'footerLeft',
        label: 'Footer left',
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'footerCenter',
        label: 'Footer centre',
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'footerRight',
        label: 'Footer right',
        type: 'text',
        defaultValue: '',
      },
      fontFamilyField,
      {
        key: 'fontSize',
        label: 'Font size',
        type: 'number',
        defaultValue: '10',
        min: 4,
      },
      { key: 'color', label: 'Colour', type: 'color', defaultValue: '#404040' },
      {
        key: 'margin',
        label: 'Margin (pt)',
        type: 'number',
        defaultValue: '36',
        min: 0,
      },
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const opts = {
        headerLeft: str(ctx, 'headerLeft'),
        headerCenter: str(ctx, 'headerCenter'),
        headerRight: str(ctx, 'headerRight'),
        footerLeft: str(ctx, 'footerLeft'),
        footerCenter: str(ctx, 'footerCenter'),
        footerRight: str(ctx, 'footerRight'),
        fontFamily: str(ctx, 'fontFamily', 'Helvetica'),
        fontSize: num(ctx, 'fontSize', 10),
        color: str(ctx, 'color', '#404040'),
        range: str(ctx, 'range'),
        margin: num(ctx, 'margin', 36),
      };
      const anySlot = [
        opts.headerLeft,
        opts.headerCenter,
        opts.headerRight,
        opts.footerLeft,
        opts.footerCenter,
        opts.footerRight,
      ].some((v) => v.trim());
      if (!anySlot) throw new Error('Fill at least one header or footer slot');
      const bytes = await stamp.headerFooterPdf(file, opts);
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
      rangeSlider('hueShift', 'Hue shift (°)', -180, 180, 1, 0),
      rangeSlider(
        'temperature',
        'Temperature',
        -100,
        100,
        1,
        0,
        'Positive is warmer.'
      ),
      rangeSlider('tint', 'Tint', -100, 100, 1, 0, 'Positive is greener.'),
      rangeSlider('gamma', 'Gamma', 0.2, 3, 0.05, 1),
      rangeSlider('sepia', 'Sepia', 0, 1, 0.05, 0),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Adjusting pages');
      const bytes = await enhance.adjustPdfColors(file, {
        brightness: num(ctx, 'brightness', 0),
        contrast: num(ctx, 'contrast', 0),
        saturation: num(ctx, 'saturation', 1),
        hueShift: num(ctx, 'hueShift', 0),
        temperature: num(ctx, 'temperature', 0),
        tint: num(ctx, 'tint', 0),
        gamma: num(ctx, 'gamma', 1),
        sepia: num(ctx, 'sepia', 0),
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
      rangeSlider('grain', 'Grain / noise', 0, 1, 0.05, 0.15),
      rangeSlider('yellowing', 'Paper warmth', 0, 1, 0.05, 0.2),
      rangeSlider('brightness', 'Brightness', -60, 60, 1, 0),
      rangeSlider('contrast', 'Contrast', -60, 60, 1, 10),
      rangeSlider('blur', 'Softness (px)', 0, 3, 0.25, 0.3),
      rangeSlider('border', 'Scan edge (px)', 0, 30, 1, 0),
      checkbox('greyscale', 'Greyscale (photocopy look)', false),
      selectField(
        'scale',
        'Scan resolution',
        [
          { value: '1', label: 'Low (72 dpi)' },
          { value: '1.5', label: 'Medium (108 dpi)' },
          { value: '2', label: 'High (144 dpi)' },
          { value: '3', label: 'Very high (216 dpi)' },
        ],
        '1.5'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Applying scan effect');
      const bytes = await enhance.scannerEffect(file, {
        strength: num(ctx, 'strength', 0.5),
        grain: num(ctx, 'grain', 0.15),
        yellowing: num(ctx, 'yellowing', 0.2),
        greyscale: ctx.values.greyscale === 'true',
        blur: num(ctx, 'blur', 0.3),
        rotateVariance: 0,
        brightness: num(ctx, 'brightness', 0),
        contrast: num(ctx, 'contrast', 10),
        border: num(ctx, 'border', 0),
        scale: num(ctx, 'scale', 1.5),
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
