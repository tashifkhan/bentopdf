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
    fields: [
      checkbox(
        'reverseSecond',
        'Reverse the second file first',
        false,
        'Use this when the back sides were scanned in reverse order.'
      ),
    ],
    async process(ctx) {
      requireFiles(ctx, 2);
      let files = ctx.files;
      if (ctx.values.reverseSecond === 'true' && files[1]) {
        const reversed = new Uint8Array(await pdf.reversePages(files[1]));
        files = [
          files[0]!,
          new File([reversed.buffer as ArrayBuffer], files[1].name, {
            type: 'application/pdf',
          }),
          ...files.slice(2),
        ];
      }
      return onePdf(await pdf.alternateMerge(files), 'alternate-merge.pdf');
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
        { value: 'even', label: 'Even pages only' },
        { value: 'odd', label: 'Odd pages only' },
        { value: 'even-odd', label: 'Split into even and odd documents' },
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
      {
        ...checkbox('zip', 'Bundle the output into a single ZIP', false),
        showWhen: { key: 'mode', equals: ['each', 'every', 'even-odd'] },
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const mode = str(ctx, 'mode', 'range');
      const base = stem(file.name);

      const bundle = async (files: { name: string; bytes: Uint8Array }[]) => {
        if (ctx.values.zip !== 'true' || files.length < 2) return { files };
        const zip = new JSZip();
        for (const f of files) zip.file(f.name, f.bytes);
        return {
          files: [
            {
              name: `${base}-split.zip`,
              bytes: await zip.generateAsync({ type: 'uint8array' }),
              mime: 'application/zip',
            },
          ],
          message: `Bundled ${files.length} documents.`,
        };
      };

      if (mode === 'each') return bundle(await pdf.splitEachPage(file));

      if (mode === 'even' || mode === 'odd') {
        const bytes = await pdf.splitByParity(file, mode);
        return onePdf(bytes, derive(file, `${mode}-pages`));
      }

      if (mode === 'even-odd') {
        // A one-page document has no even half; emit whichever halves exist
        // rather than failing the whole operation.
        const halves = [];
        for (const parity of ['odd', 'even'] as const) {
          try {
            halves.push({
              name: `${base}-${parity}.pdf`,
              bytes: await pdf.splitByParity(file, parity),
            });
          } catch {
            // No pages of this parity.
          }
        }
        if (halves.length === 0) throw new Error('The PDF has no pages');
        return bundle(halves);
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
            name: `${base}-${start + 1}-${start + indices.length}.pdf`,
            bytes: await part.save(),
          });
        }
        return bundle(out);
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
    note: 'Splits each page in half — for scans of facing book pages.',
    fields: [
      selectField('direction', 'Split direction', [
        { value: 'vertical', label: 'Vertical (left / right halves)' },
        { value: 'horizontal', label: 'Horizontal (top / bottom halves)' },
      ]),
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.dividePages(
        file,
        str(ctx, 'direction', 'vertical') as 'vertical' | 'horizontal',
        str(ctx, 'range')
      );
      return onePdf(bytes, derive(file, 'divided'));
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
      selectField('position', 'Insert', [
        { value: 'end', label: 'At the end' },
        { value: 'start', label: 'At the beginning' },
        { value: 'after', label: 'After a specific page' },
        { value: 'every', label: 'After every page' },
      ]),
      {
        key: 'after',
        label: 'After page number',
        type: 'number',
        defaultValue: '1',
        min: 1,
        showWhen: { key: 'position', equals: ['after'] },
      },
      {
        key: 'count',
        label: 'How many blank pages',
        type: 'number',
        defaultValue: '1',
        min: 1,
        max: 50,
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await pdf.addBlankPages(
        file,
        str(ctx, 'position', 'end') as 'start' | 'end' | 'after' | 'every',
        int(ctx, 'after', 1),
        Math.max(1, int(ctx, 'count', 1))
      );
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
        'perSheet',
        'Pages per sheet',
        [
          { value: '2', label: '2-up' },
          { value: '4', label: '4-up' },
          { value: '6', label: '6-up' },
          { value: '9', label: '9-up' },
          { value: '16', label: '16-up' },
        ],
        '4'
      ),
      selectField('sheetSize', 'Sheet size', struct.PAGE_SIZE_OPTIONS, 'a4'),
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
        label: 'Sheet margin (pt)',
        type: 'number',
        defaultValue: '18',
        min: 0,
      },
      checkbox('border', 'Draw a border around each page', false),
      {
        key: 'borderColor',
        label: 'Border colour',
        type: 'color',
        defaultValue: '#b4b4b4',
        showWhen: { key: 'border', equals: ['true'] },
      },
      rangeField,
    ],
    async process(ctx) {
      const file = first(ctx);
      const perSheet = int(ctx, 'perSheet', 4);
      const bytes = await struct.nUpPdf(file, {
        perSheet,
        sheetSize: str(ctx, 'sheetSize', 'a4'),
        orientation: str(ctx, 'orientation', 'auto') as
          | 'auto'
          | 'portrait'
          | 'landscape',
        margin: num(ctx, 'margin', 18),
        border: ctx.values.border === 'true',
        borderColor: str(ctx, 'borderColor', '#b4b4b4'),
        range: str(ctx, 'range'),
      });
      return onePdf(bytes, derive(file, `${perSheet}up`));
    },
  }),

  'pdf-booklet': processor({
    accept: PDF,
    multiple: false,
    note: 'Reorders pages for saddle-stitch printing: fold the printed stack in half and the pages read in order.',
    fields: [
      selectField(
        'paperSize',
        'Paper size',
        [
          { value: 'auto', label: 'Match the source pages' },
          ...struct.PAGE_SIZE_OPTIONS,
        ],
        'auto'
      ),
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.bookletPdf(
        file,
        str(ctx, 'paperSize', 'auto')
      );
      return onePdf(bytes, derive(file, 'booklet'));
    },
  }),

  'combine-single-page': processor({
    accept: PDF,
    multiple: false,
    note: 'Stacks every page onto one continuous sheet.',
    fields: [
      selectField('orientation', 'Direction', [
        { value: 'vertical', label: 'Vertical (one tall page)' },
        { value: 'horizontal', label: 'Horizontal (one wide page)' },
      ]),
      {
        key: 'spacing',
        label: 'Gap between pages (pt)',
        type: 'number',
        defaultValue: '0',
        min: 0,
      },
      {
        key: 'background',
        label: 'Background colour',
        type: 'color',
        defaultValue: '#ffffff',
      },
      checkbox('separator', 'Draw a separator line between pages', false),
      {
        key: 'separatorThickness',
        label: 'Separator thickness (pt)',
        type: 'number',
        defaultValue: '1',
        min: 0.25,
        showWhen: { key: 'separator', equals: ['true'] },
      },
      {
        key: 'separatorColor',
        label: 'Separator colour',
        type: 'color',
        defaultValue: '#c8c8c8',
        showWhen: { key: 'separator', equals: ['true'] },
      },
    ],
    async process(ctx) {
      const file = first(ctx);
      const bytes = await struct.combineToSinglePage(file, {
        orientation: str(ctx, 'orientation', 'vertical') as
          | 'vertical'
          | 'horizontal',
        spacing: num(ctx, 'spacing', 0),
        background: str(ctx, 'background', '#ffffff'),
        separator: ctx.values.separator === 'true',
        separatorThickness: num(ctx, 'separatorThickness', 1),
        separatorColor: str(ctx, 'separatorColor', '#c8c8c8'),
      });
      return onePdf(bytes, derive(file, 'single-page'));
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
        label: 'Overlap',
        type: 'number',
        defaultValue: '18',
        min: 0,
      },
      selectField(
        'overlapUnit',
        'Overlap units',
        [
          { value: 'pt', label: 'Points' },
          { value: 'mm', label: 'Millimetres' },
          { value: 'in', label: 'Inches' },
        ],
        'pt'
      ),
      selectField(
        'sheetSize',
        'Sheet size',
        [
          { value: '', label: 'Tile size (no fixed paper)' },
          ...struct.PAGE_SIZE_OPTIONS,
        ],
        ''
      ),
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
      rangeField,
    ],
    note: 'Blows one page up across a grid of sheets for large-format printing.',
    async process(ctx) {
      const file = first(ctx);
      const overlap = struct.toPoints(
        num(ctx, 'overlap', 18),
        str(ctx, 'overlapUnit', 'pt')
      );
      const bytes = await struct.posterizePdf(
        file,
        Math.max(1, int(ctx, 'cols', 2)),
        Math.max(1, int(ctx, 'rows', 2)),
        overlap,
        {
          range: str(ctx, 'range'),
          sheetSize: str(ctx, 'sheetSize') || undefined,
          orientation: str(ctx, 'orientation', 'auto') as
            | 'auto'
            | 'portrait'
            | 'landscape',
        }
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
      selectField('mode', 'Mode', [
        { value: 'overlay', label: 'Overlay (on top of the content)' },
        { value: 'underlay', label: 'Underlay (behind the content)' },
      ]),
      rangeSlider('opacity', 'Overlay opacity', 0, 1, 0.05, 1),
      checkbox('repeat', 'Repeat the overlay if it has fewer pages', true),
      rangeField,
    ],
    async process(ctx) {
      const base = first(ctx);
      const overlay = requiredExtra(ctx, 'overlay', 'an overlay PDF');
      const bytes = await struct.overlayPdf(base, overlay, {
        opacity: num(ctx, 'opacity', 1),
        behind: str(ctx, 'mode', 'overlay') === 'underlay',
        repeat: ctx.values.repeat === 'true',
        range: str(ctx, 'range'),
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
      {
        key: 'page',
        label: 'Anchor to page (optional)',
        type: 'number',
        defaultValue: '',
        min: 1,
        help: 'Leave blank to attach at document level. A page number adds a visible paperclip annotation there.',
      },
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
      {
        key: 'creationDate',
        label: 'Creation date',
        type: 'text',
        defaultValue: '',
        placeholder: 'YYYY-MM-DD or ISO timestamp',
      },
      {
        key: 'modDate',
        label: 'Modification date',
        type: 'text',
        defaultValue: '',
        placeholder: 'YYYY-MM-DD or ISO timestamp',
      },
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
      const setDate = (key: string, apply: (d: Date) => void) => {
        const raw = str(ctx, key);
        if (!raw) return;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error(`"${raw}" is not a valid date`);
        }
        apply(parsed);
      };
      setDate('creationDate', (d) => doc.setCreationDate(d));
      setDate('modDate', (d) => doc.setModificationDate(d));
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
