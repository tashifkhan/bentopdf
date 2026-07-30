import JSZip from 'jszip';
import * as pdf from '~/lib/pdf/core';
import * as struct from '~/lib/pdf/structure';
import { comparePdfsTextually, comparePdfsVisually } from '~/lib/pdf/compare';
import type { ToolProcessor } from '../types';
import {
  PDF,
  derive,
  extras,
  fileField,
  first,
  int,
  num,
  onePdf,
  pagesField,
  processor,
  rangeField,
  rangeSlider,
  requireFiles,
  requiredExtra,
  selectField,
  checkbox,
  stem,
  str,
  textResult,
} from './common';

export const organizeProcessors: Record<string, ToolProcessor> = {
  'merge-pdf': processor({
    accept: PDF,
    multiple: true,
    minFiles: 2,
    fields: [
      {
        key: 'ranges',
        label: 'Page ranges per file (optional)',
        type: 'text',
        placeholder: 'e.g. 1-3 | 2,5 | (blank = all)',
        defaultValue: '',
        help: 'Separate one range per file with "|", in the same order as the files above.',
      },
    ],
    async process(ctx) {
      requireFiles(ctx, 2);
      const ranges = str(ctx, 'ranges')
        .split('|')
        .map((r) => r.trim());
      ctx.onProgress('Merging documents');
      const bytes = await pdf.mergePdfs(ctx.files, ranges);
      return onePdf(bytes, 'merged.pdf');
    },
  }),

  'alternate-merge': processor({
    accept: PDF,
    multiple: true,
    minFiles: 2,
    note: 'Interleaves pages: file A page 1, file B page 1, file A page 2, and so on. Useful for recombining single-sided scans.',
    async process(ctx) {
      requireFiles(ctx, 2);
      return onePdf(await pdf.alternateMerge(ctx.files), 'alternate-merge.pdf');
    },
  }),

  'split-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('mode', 'Split mode', [
        { value: 'range', label: 'Extract a page range' },
        { value: 'each', label: 'One PDF per page' },
        { value: 'every', label: 'Every N pages' },
      ]),
      { ...rangeField, showWhen: { key: 'mode', equals: ['range'] } },
      {
        key: 'chunk',
        label: 'Pages per file',
        type: 'number',
        defaultValue: '10',
        min: 1,
        showWhen: { key: 'mode', equals: ['every'] },
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const mode = str(ctx, 'mode', 'range');

      if (mode === 'each') {
        return { files: await pdf.splitEachPage(file) };
      }
      if (mode === 'every') {
        const size = Math.max(1, int(ctx, 'chunk', 10));
        const doc = await pdf.loadPdf(file);
        const total = doc.getPageCount();
        const out = [];
        for (let start = 0; start < total; start += size) {
          const indices = Array.from(
            { length: Math.min(size, total - start) },
            (_, k) => start + k
          );
          const part = await pdf.copyPagesToNew(doc, indices);
          out.push({
            name: `${stem(file.name)}-${start + 1}-${start + indices.length}.pdf`,
            bytes: await part.save(),
          });
        }
        return { files: out };
      }
      const bytes = await pdf.extractPages(file, str(ctx, 'range'));
      return onePdf(bytes, derive(file, 'split'));
    },
  }),

  'extract-pages': processor({
    accept: PDF,
    multiple: false,
    fields: [pagesField('Pages to extract', 'e.g. 1-3,7')],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.extractPages(file, str(ctx, 'range', '1'));
      return onePdf(bytes, derive(file, 'extracted'));
    },
  }),

  'delete-pages': processor({
    accept: PDF,
    multiple: false,
    fields: [pagesField('Pages to delete', 'e.g. 2,4-6')],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.deletePages(file, str(ctx, 'range'));
      return onePdf(bytes, derive(file, 'trimmed'));
    },
  }),

  'divide-pages': processor({
    accept: PDF,
    multiple: false,
    note: 'Splits each page down the middle into two pages — for scans of facing book pages.',
    async process(ctx) {
      const file = first(ctx);
      return onePdf(await pdf.splitInHalf(file), derive(file, 'divided'));
    },
  }),

  'reverse-pages': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      return onePdf(await pdf.reversePages(file), derive(file, 'reversed'));
    },
  }),

  'rotate-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField(
        'angle',
        'Rotation',
        [
          { value: '90', label: '90° clockwise' },
          { value: '180', label: '180°' },
          { value: '270', label: '90° counter-clockwise' },
        ],
        '90'
      ),
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.rotatePdf(
        file,
        int(ctx, 'angle', 90),
        str(ctx, 'range')
      );
      return onePdf(bytes, derive(file, 'rotated'));
    },
  }),

  'rotate-custom': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'angle',
        label: 'Angle (degrees)',
        type: 'number',
        defaultValue: '90',
        step: 90,
        help: 'PDF page rotation must be a multiple of 90°; other values are snapped to the nearest.',
      },
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.rotateCustom(
        file,
        num(ctx, 'angle', 90),
        str(ctx, 'range')
      );
      return onePdf(bytes, derive(file, 'rotated'));
    },
  }),

  'add-blank-page': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'after',
        label: 'Insert blank page after page number',
        type: 'number',
        defaultValue: '0',
        min: 0,
        help: '0 inserts at the very beginning.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.addBlankPage(file, int(ctx, 'after', 0));
      return onePdf(bytes, derive(file, 'with-blank'));
    },
  }),

  'remove-blank-pages': processor({
    accept: PDF,
    multiple: false,
    fields: [
      rangeSlider(
        'threshold',
        'Blankness threshold',
        90,
        100,
        0.5,
        99.9,
        'Percentage of near-white pixels above which a page counts as blank.'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      ctx.onProgress('Scanning pages');
      const { bytes, removed } = await struct.removeBlankPages(
        file,
        num(ctx, 'threshold', 99.9) / 100
      );
      return {
        ...onePdf(bytes, derive(file, 'no-blanks')),
        message: removed.length
          ? `Removed ${removed.length} blank page(s): ${removed.join(', ')}`
          : 'No blank pages found — the document is unchanged.',
      };
    },
  }),

  'n-up-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField(
        'n',
        'Pages per sheet',
        [
          { value: '2', label: '2-up' },
          { value: '4', label: '4-up' },
        ],
        '4'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      const n = str(ctx, 'n') === '2' ? 2 : 4;
      return onePdf(await pdf.nUpPdf(file, n), derive(file, `${n}up`));
    },
  }),

  'pdf-booklet': processor({
    accept: PDF,
    multiple: false,
    note: 'Reorders pages for saddle-stitch printing: fold the printed stack in half and the pages read in order.',
    async process(ctx) {
      const file = first(ctx);
      return onePdf(await struct.bookletPdf(file), derive(file, 'booklet'));
    },
  }),

  'combine-single-page': processor({
    accept: PDF,
    multiple: false,
    note: 'Stacks every page onto one continuous tall page.',
    async process(ctx) {
      const file = first(ctx);
      return onePdf(
        await struct.combineToSinglePage(file),
        derive(file, 'single-page')
      );
    },
  }),

  'posterize-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      {
        key: 'cols',
        label: 'Columns',
        type: 'number',
        defaultValue: '2',
        min: 1,
        max: 10,
      },
      {
        key: 'rows',
        label: 'Rows',
        type: 'number',
        defaultValue: '2',
        min: 1,
        max: 10,
      },
      {
        key: 'overlap',
        label: 'Overlap (points)',
        type: 'number',
        defaultValue: '18',
        min: 0,
        help: 'Extra margin on each tile to give you something to trim and glue.',
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.posterizePdf(
        file,
        Math.max(1, int(ctx, 'cols', 2)),
        Math.max(1, int(ctx, 'rows', 2)),
        num(ctx, 'overlap', 18)
      );
      return onePdf(bytes, derive(file, 'poster'));
    },
  }),

  'overlay-pdf': processor({
    accept: PDF,
    multiple: false,
    fields: [
      fileField('overlay', 'Overlay PDF', PDF, {
        help: 'Its pages are stamped onto the base document.',
      }),
      rangeSlider('opacity', 'Overlay opacity', 0, 1, 0.05, 1),
      checkbox('behind', 'Place overlay behind the page content'),
      checkbox('repeat', 'Repeat the overlay if it has fewer pages', true),
    ],
    async process(ctx) {
      const base = first(ctx);
      const overlay = requiredExtra(ctx, 'overlay', 'an overlay PDF');
      const bytes = await struct.overlayPdf(base, overlay, {
        opacity: num(ctx, 'opacity', 1),
        behind: ctx.values.behind === 'true',
        repeat: ctx.values.repeat === 'true',
      });
      return onePdf(bytes, derive(base, 'overlaid'));
    },
  }),

  'pdf-to-zip': processor({
    accept: PDF,
    multiple: true,
    async process(ctx) {
      requireFiles(ctx);
      const zip = new JSZip();
      for (const file of ctx.files)
        zip.file(file.name, await file.arrayBuffer());
      return {
        files: [
          {
            name: 'pdfs.zip',
            bytes: await zip.generateAsync({ type: 'uint8array' }),
            mime: 'application/zip',
          },
        ],
      };
    },
  }),

  /* ------------------------------------------------------ attachments */

  'add-attachments': processor({
    accept: PDF,
    multiple: false,
    fields: [
      fileField('attachments', 'Files to attach', '*/*', { multiple: true }),
    ],
    async process(ctx) {
      const file = first(ctx);
      const attachments = extras(ctx, 'attachments');
      const bytes = await struct.addAttachments(file, attachments);
      return {
        ...onePdf(bytes, derive(file, 'with-attachments')),
        message: `Embedded ${attachments.length} file(s).`,
      };
    },
  }),

  'extract-attachments': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      const files = await struct.extractAttachments(file);
      return { files, message: `Extracted ${files.length} attachment(s).` };
    },
  }),

  'edit-attachments': processor({
    accept: PDF,
    multiple: false,
    fields: [
      selectField('action', 'Action', [
        { value: 'list', label: 'List attachments' },
        { value: 'remove-all', label: 'Remove all attachments' },
        { value: 'add', label: 'Add more attachments' },
      ]),
      fileField('attachments', 'Files to attach', '*/*', {
        multiple: true,
        help: 'Only used with the "Add" action.',
      }),
    ],
    async process(ctx) {
      const file = first(ctx);
      const action = str(ctx, 'action', 'list');

      if (action === 'remove-all') {
        return {
          ...onePdf(
            await struct.removeAllAttachments(file),
            derive(file, 'no-attachments')
          ),
          message: 'All embedded files removed.',
        };
      }
      if (action === 'add') {
        const attachments = extras(ctx, 'attachments');
        const bytes = await struct.addAttachments(file, attachments);
        return onePdf(bytes, derive(file, 'with-attachments'));
      }

      const found = await struct.listAttachments(file);
      const report = found.length
        ? found.map((f) => `${f.name} — ${f.bytes.length} bytes`).join('\n')
        : 'This PDF has no embedded attachments.';
      return textResult(
        derive(file, 'attachments', 'txt'),
        report,
        'text/plain',
        'Attachments'
      );
    },
  }),

  /* --------------------------------------------------------- metadata */

  'view-metadata': processor({
    accept: PDF,
    multiple: false,
    async process(ctx) {
      const file = first(ctx);
      const info = await struct.documentInfo(file);
      return textResult(
        derive(file, 'metadata', 'json'),
        info,
        'application/json',
        'Document metadata'
      );
    },
  }),

  'edit-metadata': processor({
    accept: PDF,
    multiple: false,
    fields: [
      { key: 'title', label: 'Title', type: 'text', defaultValue: '' },
      { key: 'author', label: 'Author', type: 'text', defaultValue: '' },
      { key: 'subject', label: 'Subject', type: 'text', defaultValue: '' },
      {
        key: 'keywords',
        label: 'Keywords',
        type: 'text',
        defaultValue: '',
        placeholder: 'comma, separated',
      },
      { key: 'creator', label: 'Creator', type: 'text', defaultValue: '' },
      { key: 'producer', label: 'Producer', type: 'text', defaultValue: '' },
    ],
    note: 'Blank fields are left untouched. Use "Remove metadata" to clear everything.',
    async process(ctx) {
      const file = first(ctx);
      const doc = await pdf.loadPdf(file);
      const set = (key: string, apply: (v: string) => void) => {
        const value = str(ctx, key);
        if (value) apply(value);
      };
      set('title', (v) => doc.setTitle(v));
      set('author', (v) => doc.setAuthor(v));
      set('subject', (v) => doc.setSubject(v));
      set('creator', (v) => doc.setCreator(v));
      set('producer', (v) => doc.setProducer(v));
      const keywords = str(ctx, 'keywords');
      if (keywords) {
        doc.setKeywords(
          keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        );
      }
      return onePdf(await doc.save(), derive(file, 'metadata'));
    },
  }),

  /* ---------------------------------------------------------- compare */

  'compare-pdfs': processor({
    accept: PDF,
    multiple: false,
    fields: [
      fileField('other', 'Compare against', PDF),
      selectField('mode', 'Comparison', [
        { value: 'both', label: 'Text differences and visual diff' },
        { value: 'text', label: 'Text differences only (fast)' },
        { value: 'visual', label: 'Visual pixel diff only' },
      ]),
      rangeSlider(
        'threshold',
        'Pixel sensitivity',
        0.01,
        0.5,
        0.01,
        0.1,
        'Lower values flag smaller differences.'
      ),
    ],
    async process(ctx) {
      const a = first(ctx);
      const b = requiredExtra(ctx, 'other', 'a second PDF to compare against');
      const mode = str(ctx, 'mode', 'both');
      const out = [];
      let message = '';

      if (mode !== 'visual') {
        ctx.onProgress('Comparing text');
        const { report, identical } = await comparePdfsTextually(a, b);
        out.push({
          name: 'comparison-report.txt',
          bytes: new TextEncoder().encode(report),
          mime: 'text/plain',
        });
        message = identical
          ? 'The extracted text is identical.'
          : 'Text differences found — see the report.';
      }

      if (mode !== 'text') {
        ctx.onProgress('Rendering visual diff');
        const { visual, pages } = await comparePdfsVisually(a, b, {
          threshold: num(ctx, 'threshold', 0.1),
        });
        out.push(visual);
        const changed = pages.filter((p) => p.ratio > 0.0001);
        message +=
          (message ? ' ' : '') +
          (changed.length
            ? `${changed.length} of ${pages.length} page(s) differ visually.`
            : 'Pages are visually identical.');
      }

      return { files: out, message };
    },
  }),

  /* -------------------------------------------------------- structure */

  'extract-tables': processor({
    accept: PDF,
    multiple: false,
    fields: [pagesField('Pages', 'e.g. 2-4 (empty = all)')],
    note: 'Reconstructs tables from the text layer by clustering column positions. Scanned pages need OCR first.',
    async process(ctx) {
      const file = first(ctx);
      const { extractPageText, pageToRows } = await import('~/lib/pdf/text');
      const pages = await extractPageText(file);
      const wanted = str(ctx, 'range');
      const selected = wanted
        ? new Set(pdf.parsePageRange(wanted, pages.length).map((i) => i + 1))
        : null;

      const lines: string[] = [];
      for (const page of pages) {
        if (selected && !selected.has(page.pageNumber)) continue;
        const rows = pageToRows(page);
        if (rows.length === 0) continue;
        lines.push(`# Page ${page.pageNumber}`);
        for (const row of rows) {
          lines.push(
            row
              .map((cell) =>
                /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
              )
              .join(',')
          );
        }
        lines.push('');
      }
      if (lines.length === 0) {
        throw new Error(
          'No table-like text found. If this is a scan, run OCR first.'
        );
      }
      return textResult(
        derive(file, 'tables', 'csv'),
        lines.join('\n'),
        'text/csv',
        'Extracted tables'
      );
    },
  }),
};
