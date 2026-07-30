import * as pdf from '~/lib/pdf/core';
import * as conv from '~/lib/pdf/convert';
import * as office from '~/lib/pdf/office';
import * as text from '~/lib/pdf/text';
import {
  canvasToBmp,
  canvasToBytes,
  openWithPdfjs,
  pdfToImageFiles,
  renderPage,
  supportsMime,
} from '~/lib/pdf/render';
import type { ToolField, ToolProcessor } from '../types';
import {
  IMAGES,
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
  textInput,
  textResult,
} from './common';

/* ------------------------------------------------------ images → PDF */

const imageLayoutFields: ToolField[] = [
  selectField('pageSize', 'Page size', [
    { value: 'fit', label: 'Fit page to each image' },
    { value: 'a4', label: 'A4' },
    { value: 'letter', label: 'Letter' },
  ]),
  selectField(
    'orientation',
    'Orientation',
    [
      { value: 'auto', label: 'Automatic' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    'auto'
  ),
  {
    key: 'margin',
    label: 'Margin (points)',
    type: 'number',
    defaultValue: '0',
    min: 0,
  },
];

/** One image-to-PDF processor, specialised by accepted extensions. */
function imagesToPdf(accept: string, note?: string): ToolProcessor {
  return processor({
    accept,
    multiple: true,
    fields: imageLayoutFields,
    ...(note ? { note } : {}),
    async process(ctx) {
      requireFiles(ctx);
      ctx.onProgress(`Converting ${ctx.files.length} image(s)`);
      const bytes = await conv.imagesToPdfAdvanced(ctx.files, {
        pageSize: str(ctx, 'pageSize', 'fit') as 'fit' | 'a4' | 'letter',
        orientation: str(ctx, 'orientation', 'auto') as
          | 'auto'
          | 'portrait'
          | 'landscape',
        margin: num(ctx, 'margin', 0),
      });
      const name =
        ctx.files.length === 1
          ? `${stem(ctx.files[0]!.name)}.pdf`
          : 'images.pdf';
      return onePdf(bytes, name);
    },
  });
}

/* ----------------------------------------------------- office → PDF */

/** LibreOffice-backed conversion for one document family. */
function officeToPdf(extensions: string[], note?: string): ToolProcessor {
  return processor({
    accept: office.officeAccept(extensions),
    multiple: true,
    note:
      note ??
      'Converted with LibreOffice compiled to WebAssembly. The engine is ~74 MB and downloads once per session.',
    async process(ctx) {
      requireFiles(ctx);
      const files = await office.officeBatchToPdf(ctx.files, (message) =>
        ctx.onProgress(message)
      );
      return { files };
    },
  });
}

/* --------------------------------------------------- PDF → raster */

function pdfToRaster(mime: string, ext: string, label: string): ToolProcessor {
  return processor({
    accept: PDF,
    multiple: false,
    fields: [
      rangeSlider(
        'scale',
        'Resolution',
        1,
        4,
        0.5,
        2,
        'Higher values give sharper, larger images.'
      ),
      ...(mime === 'image/jpeg' || mime === 'image/webp'
        ? [rangeSlider('quality', 'Quality', 0.3, 1, 0.05, 0.92)]
        : []),
    ],
    async process(ctx) {
      const file = first(ctx);
      if (!supportsMime(mime)) {
        throw new Error(
          `This browser cannot export ${label}. Try PNG or JPG instead.`
        );
      }
      ctx.onProgress('Rendering pages');
      const files = await pdfToImageFiles(
        file,
        mime,
        ext,
        num(ctx, 'scale', 2),
        num(ctx, 'quality', 0.92)
      );
      return { files, message: `Exported ${files.length} page(s).` };
    },
  });
}

export const convertProcessors: Record<string, ToolProcessor> = {
  /* --------------------------------------------------- images → PDF */

  'image-to-pdf': imagesToPdf(IMAGES),
  'jpg-to-pdf': imagesToPdf('image/jpeg,.jpg,.jpeg'),
  'png-to-pdf': imagesToPdf('image/png,.png'),
  'webp-to-pdf': imagesToPdf('image/webp,.webp'),
  'bmp-to-pdf': imagesToPdf('image/bmp,.bmp'),
  'svg-to-pdf': imagesToPdf(
    'image/svg+xml,.svg',
    'SVGs are rasterized by the browser at their intrinsic size.'
  ),
  'heic-to-pdf': imagesToPdf(
    'image/heic,image/heif,.heic,.heif',
    'HEIC photos from iPhone are decoded in the browser.'
  ),
  'tiff-to-pdf': imagesToPdf(
    'image/tiff,.tif,.tiff',
    'Multi-page TIFFs contribute their first page; split them first for full coverage.'
  ),

  'cbz-to-pdf': processor({
    accept: '.cbz,.zip,application/zip',
    multiple: false,
    note: 'Each image in the comic archive becomes one page, in filename order.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Reading archive');
      return onePdf(await conv.cbzToPdf(file), `${stem(file.name)}.pdf`);
    },
  }),

  'email-to-pdf': processor({
    accept: '.eml,.msg,message/rfc822',
    multiple: true,
    note: 'Renders headers and the plain-text body. Attachments are listed, not embedded.',
    async process(ctx) {
      requireFiles(ctx);
      const files = [];
      for (const file of ctx.files) {
        ctx.onProgress(`Converting ${file.name}`);
        files.push(await conv.emailToPdf(file));
      }
      return { files };
    },
  }),

  /* ------------------------------------------------------ text → PDF */

  'txt-to-pdf': processor({
    accept: '.txt,text/plain',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'Text',
        type: 'textarea',
        defaultValue: '',
        placeholder: 'Paste text, or drop a .txt file below…',
      },
      checkbox('mono', 'Use a monospace font', false),
    ],
    async process(ctx) {
      const source = await textInput(ctx);
      const name = ctx.files[0]
        ? `${stem(ctx.files[0].name)}.pdf`
        : 'document.pdf';
      return {
        files: [
          await conv.plainTextToPdf(source, name, ctx.values.mono === 'true'),
        ],
      };
    },
  }),

  'markdown-to-pdf': processor({
    accept: '.md,.markdown,text/markdown',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'Markdown',
        type: 'textarea',
        defaultValue: '',
        placeholder: '# Heading\n\nSome **bold** text…',
      },
    ],
    note: 'Supports headings, lists, tables, code blocks and rules.',
    async process(ctx) {
      const source = await textInput(ctx);
      const name = ctx.files[0]
        ? `${stem(ctx.files[0].name)}.pdf`
        : 'document.pdf';
      return { files: [await conv.markdownToPdf(source, name)] };
    },
  }),

  'csv-to-pdf': processor({
    accept: '.csv,.tsv,text/csv',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'CSV',
        type: 'textarea',
        defaultValue: '',
        placeholder: 'name,role\nAda,Engineer',
      },
      checkbox('header', 'First row is a header', true),
      {
        key: 'delimiter',
        label: 'Delimiter',
        type: 'text',
        defaultValue: '',
        placeholder: 'auto-detected',
      },
    ],
    async process(ctx) {
      const source = await textInput(ctx);
      const name = ctx.files[0]
        ? `${stem(ctx.files[0].name)}.pdf`
        : 'table.pdf';
      return {
        files: [
          await conv.csvToPdf(source, name, {
            header: ctx.values.header !== 'false',
            delimiter: str(ctx, 'delimiter') || undefined,
          }),
        ],
      };
    },
  }),

  'json-to-pdf': processor({
    accept: '.json,application/json',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'JSON',
        type: 'textarea',
        defaultValue: '',
        placeholder: '{ }',
      },
    ],
    note: 'An array of flat objects is rendered as a table; anything else is pretty-printed.',
    async process(ctx) {
      const source = await textInput(ctx);
      const name = ctx.files[0] ? `${stem(ctx.files[0].name)}.pdf` : 'data.pdf';
      return { files: [await conv.jsonToPdf(source, name)] };
    },
  }),

  'xml-to-pdf': processor({
    accept: '.xml,text/xml,application/xml',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'XML',
        type: 'textarea',
        defaultValue: '',
        placeholder: '<root/>',
      },
    ],
    async process(ctx) {
      const source = await textInput(ctx);
      const name = ctx.files[0]
        ? `${stem(ctx.files[0].name)}.pdf`
        : 'document.pdf';
      return { files: [await conv.xmlToPdf(source, name)] };
    },
  }),

  /* ---------------------------------------------------- office → PDF */

  'word-to-pdf': officeToPdf(['doc', 'docx', 'odt', 'rtf', 'fodt']),
  'excel-to-pdf': officeToPdf(['xls', 'xlsx', 'ods', 'csv', 'fods']),
  'powerpoint-to-pdf': officeToPdf(['ppt', 'pptx', 'odp', 'fodp']),
  'odt-to-pdf': officeToPdf(['odt', 'fodt']),
  'ods-to-pdf': officeToPdf(['ods', 'fods']),
  'odp-to-pdf': officeToPdf(['odp', 'fodp']),
  'odg-to-pdf': officeToPdf(['odg']),
  'rtf-to-pdf': officeToPdf(['rtf']),
  'wpd-to-pdf': officeToPdf(['wpd']),
  'wps-to-pdf': officeToPdf(['wps', 'wpt']),
  'pub-to-pdf': officeToPdf(['pub']),
  'vsd-to-pdf': officeToPdf(['vsd', 'vsdx']),
  'xps-to-pdf': officeToPdf(['xps', 'oxps']),
  'epub-to-pdf': officeToPdf(['epub']),
  'fb2-to-pdf': officeToPdf(['fb2']),

  /* ---------------------------------------------------- PDF → raster */

  'pdf-to-jpg': pdfToRaster('image/jpeg', 'jpg', 'JPEG'),
  'pdf-to-png': pdfToRaster('image/png', 'png', 'PNG'),
  'pdf-to-webp': pdfToRaster('image/webp', 'webp', 'WebP'),

  'pdf-to-bmp': processor({
    accept: PDF,
    multiple: false,
    fields: [rangeSlider('scale', 'Resolution', 1, 4, 0.5, 2)],
    note: 'BMP is uncompressed, so files are large.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Rendering pages');
      const doc = await openWithPdfjs(file);
      const files = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const canvas = await renderPage(doc, i, num(ctx, 'scale', 2));
        files.push({
          name: `${stem(file.name)}-page-${i}.bmp`,
          bytes: canvasToBmp(canvas),
          mime: 'image/bmp',
        });
      }
      return { files, message: `Exported ${files.length} page(s).` };
    },
  }),

  'pdf-to-tiff': processor({
    accept: PDF,
    multiple: false,
    fields: [rangeSlider('scale', 'Resolution', 1, 4, 0.5, 2)],
    async process(ctx) {
      const file = first(ctx);
      const UTIF = await conv.loadUtif();
      ctx.onProgress('Rendering pages');
      const doc = await openWithPdfjs(file);
      const files = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const canvas = await renderPage(doc, i, num(ctx, 'scale', 2));
        const ctx2d = canvas.getContext('2d')!;
        const image = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
        const encoded = UTIF.encodeImage(
          new Uint8Array(image.data.buffer.slice(0)),
          canvas.width,
          canvas.height
        );
        files.push({
          name: `${stem(file.name)}-page-${i}.tiff`,
          bytes: new Uint8Array(encoded),
          mime: 'image/tiff',
        });
      }
      return { files, message: `Exported ${files.length} page(s).` };
    },
  }),

  'pdf-to-cbz': processor({
    accept: PDF,
    multiple: false,
    fields: [rangeSlider('scale', 'Resolution', 1, 4, 0.5, 2)],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Building archive');
      return { files: [await conv.pdfToCbz(file, num(ctx, 'scale', 2))] };
    },
  }),

  'pdf-to-greyscale': processor({
    accept: PDF,
    multiple: false,
    rasterizes: true,
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Converting pages');
      return onePdf(await pdf.greyscalePdf(file), derive(file, 'greyscale'));
    },
  }),

  'extract-images': processor({
    accept: PDF,
    multiple: false,
    note: 'Pulls out the images embedded in the file at their original resolution — not page screenshots.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Scanning for images');
      const files = await conv.extractEmbeddedImages(file);
      return { files, message: `Found ${files.length} embedded image(s).` };
    },
  }),

  /* ------------------------------------------------------ PDF → text */

  'pdf-to-text': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Extracting text');
      const content = await text.pdfToPlainText(file);
      if (!content.trim()) {
        throw new Error(
          'No text layer found — this looks like a scan. Run OCR first.'
        );
      }
      return textResult(
        derive(file, 'text', 'txt'),
        content,
        'text/plain',
        'Extracted text'
      );
    },
  }),

  'pdf-to-markdown': processor({
    accept: PDF,
    multiple: false,
    note: 'Headings are inferred from relative font size.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Extracting text');
      const content = await text.pdfToMarkdown(file);
      return textResult(
        derive(file, '', 'md'),
        content,
        'text/markdown',
        'Markdown'
      );
    },
  }),

  'pdf-to-csv': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Detecting columns');
      const content = await text.pdfToCsv(file);
      return textResult(derive(file, '', 'csv'), content, 'text/csv', 'CSV');
    },
  }),

  'pdf-to-json': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Extracting text');
      const content = await text.pdfToJson(file);
      return textResult(
        derive(file, '', 'json'),
        content,
        'application/json',
        'JSON'
      );
    },
  }),

  'prepare-pdf-for-ai': processor({
    accept: PDF,
    multiple: false,
    note: 'Produces clean, page-marked plain text suitable for pasting into an LLM or a RAG pipeline.',
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Extracting text');
      const content = await text.pdfToAiText(file);
      return textResult(
        derive(file, 'for-ai', 'txt'),
        content,
        'text/plain',
        'LLM-ready text'
      );
    },
  }),

  /* ---------------------------------------------------- PDF → office */

  'pdf-to-docx': processor({
    accept: PDF,
    multiple: false,
    note: 'Converted with LibreOffice. Complex layouts will not survive perfectly — PDF is not a reversible format.',
    async process(ctx) {
      const file = first(ctx);
      return {
        files: [
          await office.pdfToOffice(file, 'docx', (m) => ctx.onProgress(m)),
        ],
      };
    },
  }),

  'pdf-to-excel': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('mode', 'Method', [
        { value: 'csv', label: 'Extract tables from the text layer (CSV)' },
        { value: 'office', label: 'Convert via LibreOffice (XLSX)' },
      ]),
    ],
    async process(ctx) {
      const file = first(ctx);
      if (str(ctx, 'mode', 'csv') === 'office') {
        return {
          files: [
            await office.pdfToOffice(file, 'xlsx', (m) => ctx.onProgress(m)),
          ],
        };
      }
      ctx.onProgress('Detecting columns');
      const content = await text.pdfToCsv(file);
      return textResult(
        derive(file, 'tables', 'csv'),
        content,
        'text/csv',
        'Extracted tables'
      );
    },
  }),
};

/** Rasterize a whole PDF without changing its page geometry. */
export const rasterizeProcessor = processor({
  accept: PDF,
  multiple: false,
  rasterizes: true,
  fields: [
    rangeSlider('scale', 'Resolution', 1, 4, 0.5, 2),
    rangeSlider('quality', 'JPEG quality', 0.3, 1, 0.05, 0.85),
  ],
  async process(ctx) {
    const file = first(ctx);
    ctx.onProgress('Rasterizing pages');
    const { rasterizePdf } = await import('~/lib/pdf/render');
    const bytes = await rasterizePdf(file, {
      scale: num(ctx, 'scale', 2),
      quality: num(ctx, 'quality', 0.85),
    });
    return onePdf(bytes, derive(file, 'rasterized'));
  },
});

export { canvasToBytes };
