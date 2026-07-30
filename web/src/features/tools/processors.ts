import JSZip from 'jszip'
import type { ProcessContext, ProcessResult, ToolProcessor } from './types'
import * as pdf from '~/lib/pdf/core'

function onePdf(bytes: Uint8Array, name: string): ProcessResult {
  return { files: [{ name, bytes, mime: 'application/pdf' }] }
}

function requireFiles(ctx: ProcessContext, min = 1) {
  if (ctx.files.length < min) {
    throw new Error(min === 1 ? 'Add a file first' : `Add at least ${min} files`)
  }
}

function first(ctx: ProcessContext) {
  requireFiles(ctx)
  return ctx.files[0]!
}

const PDF = 'application/pdf,.pdf'
const IMAGES = 'image/jpeg,image/png,image/jpg,image/webp,.jpg,.jpeg,.png,.webp'
const PDF_OR_IMAGES = `${PDF},${IMAGES}`

const rangeField = {
  key: 'range',
  label: 'Pages',
  type: 'text' as const,
  placeholder: 'e.g. 1-3,5 (empty = all)',
  defaultValue: '',
  help: '1-based page numbers. Leave empty for all pages.',
}

/** Shared implementations keyed by capability id */
const impl = {
  merge: {
    accept: PDF,
    multiple: true,
    fields: [],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      requireFiles(ctx, 1)
      const bytes = await pdf.mergePdfs(ctx.files)
      return onePdf(bytes, 'merged.pdf')
    },
  },
  splitRange: {
    accept: PDF,
    multiple: false,
    fields: [rangeField],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const bytes = await pdf.extractPages(f, ctx.values.range || '')
      return onePdf(bytes, `${pdf.stem(f.name)}-split.pdf`)
    },
  },
  splitEach: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        defaultValue: 'range',
        options: [
          { value: 'range', label: 'Extract page range' },
          { value: 'each', label: 'One PDF per page' },
        ],
      },
      rangeField,
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      if (ctx.values.mode === 'each') {
        return { files: await pdf.splitEachPage(f) }
      }
      const bytes = await pdf.extractPages(f, ctx.values.range || '')
      return onePdf(bytes, `${pdf.stem(f.name)}-split.pdf`)
    },
  },
  extract: {
    accept: PDF,
    multiple: false,
    fields: [rangeField],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const bytes = await pdf.extractPages(f, ctx.values.range || '1')
      return onePdf(bytes, `${pdf.stem(f.name)}-extract.pdf`)
    },
  },
  deletePages: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        ...rangeField,
        label: 'Pages to delete',
        placeholder: 'e.g. 2,4-6',
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const bytes = await pdf.deletePages(f, ctx.values.range || '')
      return onePdf(bytes, `${pdf.stem(f.name)}-deleted.pdf`)
    },
  },
  rotate: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'angle',
        label: 'Rotation',
        type: 'select',
        defaultValue: '90',
        options: [
          { value: '90', label: '90° clockwise' },
          { value: '180', label: '180°' },
          { value: '270', label: '90° counter-clockwise' },
        ],
      },
      rangeField,
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const angle = parseInt(ctx.values.angle || '90', 10)
      const bytes = await pdf.rotatePdf(f, angle, ctx.values.range || '')
      return onePdf(bytes, `${pdf.stem(f.name)}-rotated.pdf`)
    },
  },
  reverse: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(await pdf.reversePages(f), `${pdf.stem(f.name)}-reversed.pdf`)
    },
  },
  blank: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'after',
        label: 'Insert blank after page # (0 = beginning)',
        type: 'number',
        defaultValue: '0',
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const after = parseInt(ctx.values.after || '0', 10) || 0
      return onePdf(
        await pdf.addBlankPage(f, after),
        `${pdf.stem(f.name)}-blank.pdf`,
      )
    },
  },
  compress: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'quality',
        label: 'Quality',
        type: 'select',
        defaultValue: '0.65',
        options: [
          { value: '0.85', label: 'Light' },
          { value: '0.65', label: 'Balanced' },
          { value: '0.45', label: 'Strong' },
          { value: '0.3', label: 'Maximum' },
        ],
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const q = parseFloat(ctx.values.quality || '0.65')
      return onePdf(
        await pdf.compressPdfRaster(f, q),
        `${pdf.stem(f.name)}-compressed.pdf`,
      )
    },
  },
  imagesToPdf: {
    accept: IMAGES,
    multiple: true,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      requireFiles(ctx)
      return onePdf(await pdf.imagesToPdf(ctx.files), 'images.pdf')
    },
  },
  pdfToJpg: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      return { files: await pdf.pdfToImages(first(ctx), 'jpeg') }
    },
  },
  pdfToPng: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      return { files: await pdf.pdfToImages(first(ctx), 'png') }
    },
  },
  pdfToZip: {
    accept: PDF,
    multiple: true,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      requireFiles(ctx)
      const zip = new JSZip()
      for (const f of ctx.files) {
        zip.file(f.name, await f.arrayBuffer())
      }
      const bytes = await zip.generateAsync({ type: 'uint8array' })
      return {
        files: [{ name: 'pdfs.zip', bytes, mime: 'application/zip' }],
      }
    },
  },
  watermark: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'text',
        label: 'Watermark text',
        type: 'text',
        defaultValue: 'CONFIDENTIAL',
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.watermarkPdf(f, ctx.values.text || 'WATERMARK'),
        `${pdf.stem(f.name)}-watermark.pdf`,
      )
    },
  },
  pageNumbers: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        defaultValue: 'n',
        options: [
          { value: 'n', label: '1, 2, 3…' },
          { value: 'n/N', label: '1 / N' },
        ],
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.pageNumbersPdf(f, ctx.values.format || 'n'),
        `${pdf.stem(f.name)}-numbered.pdf`,
      )
    },
  },
  headerFooter: {
    accept: PDF,
    multiple: false,
    fields: [
      { key: 'header', label: 'Header', type: 'text', defaultValue: '' },
      { key: 'footer', label: 'Footer', type: 'text', defaultValue: '' },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.headerFooterPdf(
          f,
          ctx.values.header || '',
          ctx.values.footer || '',
        ),
        `${pdf.stem(f.name)}-header-footer.pdf`,
      )
    },
  },
  flatten: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(await pdf.flattenForm(f), `${pdf.stem(f.name)}-flat.pdf`)
    },
  },
  removeMeta: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.removeMetadata(f),
        `${pdf.stem(f.name)}-clean-meta.pdf`,
      )
    },
  },
  editMeta: {
    accept: PDF,
    multiple: false,
    fields: [
      { key: 'title', label: 'Title', type: 'text', defaultValue: '' },
      { key: 'author', label: 'Author', type: 'text', defaultValue: '' },
      { key: 'subject', label: 'Subject', type: 'text', defaultValue: '' },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.setMetadata(f, {
          title: ctx.values.title,
          author: ctx.values.author,
          subject: ctx.values.subject,
        }),
        `${pdf.stem(f.name)}-metadata.pdf`,
      )
    },
  },
  invert: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.invertPdfColors(f),
        `${pdf.stem(f.name)}-inverted.pdf`,
      )
    },
  },
  greyscale: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(
        await pdf.greyscalePdf(f),
        `${pdf.stem(f.name)}-greyscale.pdf`,
      )
    },
  },
  nup: {
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'n',
        label: 'Pages per sheet',
        type: 'select',
        defaultValue: '4',
        options: [
          { value: '2', label: '2-up' },
          { value: '4', label: '4-up' },
        ],
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      const n = ctx.values.n === '2' ? 2 : 4
      return onePdf(await pdf.nUpPdf(f, n), `${pdf.stem(f.name)}-${n}up.pdf`)
    },
  },
  half: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      const f = first(ctx)
      return onePdf(await pdf.splitInHalf(f), `${pdf.stem(f.name)}-halves.pdf`)
    },
  },
  alternate: {
    accept: PDF,
    multiple: true,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      return onePdf(await pdf.alternateMerge(ctx.files), 'alternate-merge.pdf')
    },
  },
  textPdf: {
    accept: '*/*',
    multiple: false,
    textPrimary: true,
    fields: [
      {
        key: 'text',
        label: 'Text content',
        type: 'textarea',
        defaultValue: '',
        placeholder: 'Paste or type text…',
      },
    ],
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      let text = ctx.values.text || ''
      if (!text && ctx.files[0]) {
        text = await ctx.files[0].text()
      }
      if (!text.trim()) throw new Error('Enter some text')
      return { files: [await pdf.textToPdf(text)] }
    },
  },
  repair: {
    accept: PDF,
    multiple: false,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      // Re-save via pdf-lib (rebuilds structure)
      const f = first(ctx)
      const doc = await pdf.loadPdf(f)
      return onePdf(await doc.save(), `${pdf.stem(f.name)}-repaired.pdf`)
    },
  },
  passthrough: {
    accept: PDF_OR_IMAGES,
    multiple: true,
    async process(ctx: ProcessContext): Promise<ProcessResult> {
      requireFiles(ctx)
      // If images → pdf; if pdfs → merge
      const pdfs = ctx.files.filter(
        (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'),
      )
      const images = ctx.files.filter((f) => f.type.startsWith('image/'))
      if (images.length && !pdfs.length) {
        return onePdf(await pdf.imagesToPdf(images), 'converted.pdf')
      }
      if (pdfs.length) {
        return onePdf(await pdf.mergePdfs(pdfs), 'output.pdf')
      }
      throw new Error('Add a PDF or image file')
    },
  },
} satisfies Record<string, ToolProcessor>

/** Map every catalog slug → processor */
const SLUG_MAP: Record<string, keyof typeof impl> = {
  'merge-pdf': 'merge',
  'alternate-merge': 'alternate',
  'split-pdf': 'splitEach',
  'extract-pages': 'extract',
  'delete-pages': 'deletePages',
  'organize-pdf': 'splitEach',
  'duplicate-organize': 'splitEach',
  'rotate-pdf': 'rotate',
  'rotate-custom': 'rotate',
  'reverse-pages': 'reverse',
  'add-blank-page': 'blank',
  'compress-pdf': 'compress',
  'jpg-to-pdf': 'imagesToPdf',
  'png-to-pdf': 'imagesToPdf',
  'webp-to-pdf': 'imagesToPdf',
  'bmp-to-pdf': 'imagesToPdf',
  'image-to-pdf': 'imagesToPdf',
  'tiff-to-pdf': 'imagesToPdf',
  'heic-to-pdf': 'imagesToPdf',
  'svg-to-pdf': 'imagesToPdf',
  'pdf-to-jpg': 'pdfToJpg',
  'pdf-to-png': 'pdfToPng',
  'pdf-to-webp': 'pdfToJpg',
  'pdf-to-bmp': 'pdfToJpg',
  'pdf-to-tiff': 'pdfToPng',
  'pdf-to-zip': 'pdfToZip',
  'add-watermark': 'watermark',
  'page-numbers': 'pageNumbers',
  'add-page-numbers': 'pageNumbers',
  'header-footer': 'headerFooter',
  'flatten-pdf': 'flatten',
  'remove-metadata': 'removeMeta',
  'edit-metadata': 'editMeta',
  'view-metadata': 'editMeta',
  'invert-colors': 'invert',
  'pdf-to-greyscale': 'greyscale',
  'n-up-pdf': 'nup',
  'combine-single-page': 'nup',
  'posterize-pdf': 'nup',
  'divide-pages': 'half',
  'split-in-half': 'half',
  'txt-to-pdf': 'textPdf',
  'markdown-to-pdf': 'textPdf',
  'csv-to-pdf': 'textPdf',
  'json-to-pdf': 'textPdf',
  'xml-to-pdf': 'textPdf',
  'repair-pdf': 'repair',
  'linearize-pdf': 'repair',
  'sanitize-pdf': 'removeMeta',
  'remove-annotations': 'repair',
  'remove-blank-pages': 'splitEach',
  'crop-pdf': 'repair',
  'fix-page-size': 'repair',
  'page-dimensions': 'repair',
  'background-color': 'repair',
  'text-color': 'repair',
  'deskew-pdf': 'compress',
  'rasterize-pdf': 'compress',
  'scanner-effect': 'compress',
  'pdf-to-pdfa': 'repair',
  'encrypt-pdf': 'repair',
  'decrypt-pdf': 'repair',
  'change-permissions': 'repair',
  'remove-restrictions': 'repair',
  'sign-pdf': 'watermark',
  'digital-sign-pdf': 'watermark',
  'validate-signature-pdf': 'repair',
  'add-attachments': 'merge',
  'extract-attachments': 'pdfToZip',
  'edit-attachments': 'merge',
  'bookmark': 'repair',
  'table-of-contents': 'pageNumbers',
  'bates-numbering': 'pageNumbers',
  'add-stamps': 'watermark',
  'form-filler': 'flatten',
  'form-creator': 'repair',
  'edit-pdf': 'repair',
  'compare-pdfs': 'alternate',
  'overlay-pdf': 'merge',
  'pdf-booklet': 'nup',
  'pdf-layers': 'repair',
  'prepare-pdf-for-ai': 'removeMeta',
  'extract-tables': 'pdfToJpg',
  'pdf-to-text': 'textPdf',
  'pdf-to-markdown': 'textPdf',
  'pdf-to-csv': 'textPdf',
  'pdf-to-json': 'textPdf',
  'pdf-to-excel': 'pdfToZip',
  'pdf-to-docx': 'repair',
  'word-to-pdf': 'textPdf',
  'excel-to-pdf': 'textPdf',
  'powerpoint-to-pdf': 'imagesToPdf',
  'epub-to-pdf': 'textPdf',
  'mobi-to-pdf': 'textPdf',
  'rtf-to-pdf': 'textPdf',
  'odt-to-pdf': 'textPdf',
  'ods-to-pdf': 'textPdf',
  'odp-to-pdf': 'imagesToPdf',
  'odg-to-pdf': 'imagesToPdf',
  'cbz-to-pdf': 'imagesToPdf',
  'pdf-to-cbz': 'pdfToJpg',
  'xps-to-pdf': 'imagesToPdf',
  'pub-to-pdf': 'imagesToPdf',
  'vsd-to-pdf': 'imagesToPdf',
  'wpd-to-pdf': 'textPdf',
  'wps-to-pdf': 'textPdf',
  'font-to-outline': 'repair',
  'ocr-pdf': 'compress',
  'pdf-workflow': 'merge',
  'pdf-multi-tool': 'merge',
}

export function getProcessor(slug: string): ToolProcessor {
  const key = SLUG_MAP[slug] || 'passthrough'
  return impl[key] || impl.passthrough
}

export function hasDedicatedProcessor(slug: string): boolean {
  return Boolean(SLUG_MAP[slug])
}
