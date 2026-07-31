import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  PageSizes,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import type { PDFPage, PDFRef } from 'pdf-lib';
import {
  copyPagesToNew,
  loadPdf,
  parsePageRange,
  stem,
  type OutFile,
} from './core';
import { openWithPdfjs, renderPage } from './render';

/* ------------------------------------------------------------------ crop */

export type CropMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Crop by trimming a margin (in points) off each edge of the current media box. */
export async function cropPdf(
  file: File,
  margins: CropMargins,
  range: string
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const indices = parsePageRange(range, doc.getPageCount());
  for (const i of indices) {
    const page = doc.getPage(i);
    const box = page.getMediaBox();
    const x = box.x + margins.left;
    const y = box.y + margins.bottom;
    const width = box.width - margins.left - margins.right;
    const height = box.height - margins.top - margins.bottom;
    if (width <= 0 || height <= 0) {
      throw new Error(`Margins remove all of page ${i + 1}`);
    }
    page.setCropBox(x, y, width, height);
  }
  return doc.save();
}

/* ------------------------------------------------------- page dimensions */

export const NAMED_SIZES: Record<string, [number, number]> = {
  a0: [...PageSizes.A0] as [number, number],
  a1: [...PageSizes.A1] as [number, number],
  a2: [...PageSizes.A2] as [number, number],
  a3: [...PageSizes.A3] as [number, number],
  a4: [...PageSizes.A4] as [number, number],
  a5: [...PageSizes.A5] as [number, number],
  a6: [...PageSizes.A6] as [number, number],
  b4: [...PageSizes.B4] as [number, number],
  b5: [...PageSizes.B5] as [number, number],
  letter: [...PageSizes.Letter] as [number, number],
  legal: [...PageSizes.Legal] as [number, number],
  tabloid: [...PageSizes.Tabloid] as [number, number],
  // pdf-lib has no Ledger constant — it is Tabloid in landscape.
  ledger: [PageSizes.Tabloid[1], PageSizes.Tabloid[0]] as [number, number],
  executive: [...PageSizes.Executive] as [number, number],
  folio: [...PageSizes.Folio] as [number, number],
};

export const PAGE_SIZE_OPTIONS = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
  { value: 'a3', label: 'A3' },
  { value: 'a5', label: 'A5' },
  { value: 'tabloid', label: 'Tabloid' },
  { value: 'ledger', label: 'Ledger' },
  { value: 'executive', label: 'Executive' },
  { value: 'folio', label: 'Folio' },
];

/** Convert a length in the given unit to PDF points. */
export function toPoints(value: number, unit: string): number {
  if (unit === 'in') return value * 72;
  if (unit === 'mm') return (value * 72) / 25.4;
  if (unit === 'cm') return (value * 72) / 2.54;
  if (unit === 'px') return value * 0.75;
  return value;
}

export function fromPoints(value: number, unit: string): number {
  if (unit === 'in') return value / 72;
  if (unit === 'mm') return (value * 25.4) / 72;
  if (unit === 'cm') return (value * 2.54) / 72;
  if (unit === 'px') return value / 0.75;
  return value;
}

/** Re-impose every page onto a uniform sheet, scaling to fit and centring. */
export async function fixPageSize(
  file: File,
  sizeName: string,
  orientation: 'portrait' | 'landscape' | 'auto' = 'auto',
  opts: {
    custom?: { width: number; height: number; unit: string };
    background?: string;
  } = {}
): Promise<Uint8Array> {
  const base =
    sizeName === 'custom' && opts.custom
      ? ([
          toPoints(opts.custom.width, opts.custom.unit),
          toPoints(opts.custom.height, opts.custom.unit),
        ] as [number, number])
      : (NAMED_SIZES[sizeName] ?? NAMED_SIZES.a4!);
  if (base[0] <= 0 || base[1] <= 0) {
    throw new Error('Page width and height must be greater than zero');
  }
  const src = await loadPdf(file);
  const out = await PDFDocument.create();
  for (let i = 0; i < src.getPageCount(); i++) {
    const page = src.getPage(i);
    const embedded = await out.embedPage(page);
    let [w, h] = base;
    const wantLandscape =
      orientation === 'landscape' ||
      (orientation === 'auto' && embedded.width > embedded.height);
    if (wantLandscape) [w, h] = [h, w];
    const sheet = out.addPage([w, h]);
    if (opts.background) {
      const bg = hexToRgb(opts.background);
      sheet.drawRectangle({
        x: 0,
        y: 0,
        width: w,
        height: h,
        color: rgb(bg.r, bg.g, bg.b),
      });
    }
    const scale = Math.min(w / embedded.width, h / embedded.height);
    const dw = embedded.width * scale;
    const dh = embedded.height * scale;
    sheet.drawPage(embedded, {
      x: (w - dw) / 2,
      y: (h - dh) / 2,
      width: dw,
      height: dh,
    });
  }
  return out.save();
}

export async function readPageDimensions(
  file: File,
  unit = 'pt'
): Promise<string> {
  const doc = await loadPdf(file);
  const lines = [`page,width_${unit},height_${unit},orientation,rotation`];
  doc.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    lines.push(
      [
        i + 1,
        fromPoints(width, unit).toFixed(2),
        fromPoints(height, unit).toFixed(2),
        width > height ? 'landscape' : 'portrait',
        page.getRotation().angle,
      ].join(',')
    );
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------ rotation */

export async function rotateCustom(
  file: File,
  angle: number,
  range: string
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  // PDF /Rotate must be a multiple of 90; snap and normalise.
  const snapped = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  for (const i of parsePageRange(range, doc.getPageCount())) {
    const page = doc.getPage(i);
    page.setRotation(degrees((page.getRotation().angle + snapped) % 360));
  }
  return doc.save();
}

/* --------------------------------------------------------- annotations */

/** Strip every annotation (comments, highlights, links, form widgets). */
export async function removeAnnotations(file: File): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  for (const page of doc.getPages()) {
    page.node.set(PDFName.of('Annots'), doc.context.obj([]));
  }
  // A form whose widgets are gone must lose its field tree too.
  const acro = doc.catalog.get(PDFName.of('AcroForm'));
  if (acro) doc.catalog.delete(PDFName.of('AcroForm'));
  return doc.save();
}

/* ------------------------------------------------------------ sanitize */

export type SanitizeOptions = {
  javascript: boolean;
  embeddedFiles: boolean;
  launchActions: boolean;
  metadata: boolean;
  annotations: boolean;
  links: boolean;
  flattenForms: boolean;
  layers: boolean;
  structureTree: boolean;
};

/**
 * Remove active content. This is the real sanitiser: document-level JavaScript,
 * open/additional actions, embedded file payloads, and annotation actions that
 * can launch or execute.
 */
export async function sanitizePdf(
  file: File,
  opts: SanitizeOptions
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const catalog = doc.catalog;

  if (opts.javascript) {
    catalog.delete(PDFName.of('OpenAction'));
    catalog.delete(PDFName.of('AA'));
    const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) {
      names.delete(PDFName.of('JavaScript'));
    }
  }

  if (opts.embeddedFiles) {
    const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    if (names) names.delete(PDFName.of('EmbeddedFiles'));
    // Drop file-attachment annotations as well.
    for (const page of doc.getPages()) {
      filterAnnots(doc, page, (annot) => {
        const subtype = annot.get(PDFName.of('Subtype'));
        return String(subtype) !== '/FileAttachment';
      });
    }
  }

  for (const page of doc.getPages()) {
    if (opts.javascript) page.node.delete(PDFName.of('AA'));
    if (opts.javascript || opts.launchActions) {
      filterAnnots(doc, page, (annot) => {
        const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
        if (!action) return true;
        const type = String(action.get(PDFName.of('S')));
        if (opts.javascript && type === '/JavaScript') return false;
        if (opts.launchActions && (type === '/Launch' || type === '/GoToR')) {
          return false;
        }
        return true;
      });
    }
  }

  if (opts.links) {
    for (const page of doc.getPages()) {
      filterAnnots(doc, page, (annot) => {
        return String(annot.get(PDFName.of('Subtype'))) !== '/Link';
      });
    }
  }

  if (opts.flattenForms) {
    try {
      doc.getForm().flatten();
    } catch {
      // No form, or a form pdf-lib cannot flatten — carry on.
    }
  }

  if (opts.annotations) {
    for (const page of doc.getPages()) {
      page.node.set(PDFName.of('Annots'), doc.context.obj([]));
    }
    catalog.delete(PDFName.of('AcroForm'));
  }

  if (opts.layers) {
    // Optional content groups: dropping these removes layer toggles.
    catalog.delete(PDFName.of('OCProperties'));
  }

  if (opts.structureTree) {
    catalog.delete(PDFName.of('StructTreeRoot'));
    catalog.delete(PDFName.of('MarkInfo'));
  }

  if (opts.metadata) {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('');
    doc.setCreator('');
    catalog.delete(PDFName.of('Metadata'));
  }

  return doc.save();
}

function filterAnnots(
  doc: PDFDocument,
  page: PDFPage,
  keep: (annot: PDFDict) => boolean
) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annots) return;
  const kept: unknown[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i);
    const annot = annots.lookupMaybe(i, PDFDict);
    if (!annot || keep(annot)) kept.push(ref);
  }
  page.node.set(PDFName.of('Annots'), doc.context.obj(kept as never[]));
}

/* ---------------------------------------------------------- attachments */

export async function addAttachments(
  pdfFile: File,
  attachments: File[]
): Promise<Uint8Array> {
  if (attachments.length === 0) throw new Error('Choose files to attach');
  const doc = await loadPdf(pdfFile);
  for (const att of attachments) {
    await doc.attach(await att.arrayBuffer(), att.name, {
      mimeType: att.type || 'application/octet-stream',
      creationDate: new Date(att.lastModified),
      modificationDate: new Date(att.lastModified),
    });
  }
  return doc.save();
}

export async function listAttachments(
  file: File
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const doc = await loadPdf(file);
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const array = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
  const out: { name: string; bytes: Uint8Array }[] = [];
  if (!array) return out;

  // The /Names array alternates [name, fileSpec, name, fileSpec, ...].
  for (let i = 0; i < array.size(); i += 2) {
    const rawName = array.lookup(i);
    const spec = array.lookupMaybe(i + 1, PDFDict);
    if (!spec) continue;
    const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
    // `lookup` has no overload for stream classes, so resolve then narrow.
    const stream = ef?.lookup(PDFName.of('F'));
    if (!(stream instanceof PDFRawStream)) continue;
    const name =
      rawName instanceof PDFString || rawName instanceof PDFHexString
        ? rawName.decodeText()
        : `attachment-${i / 2 + 1}`;
    out.push({ name, bytes: await decodeStream(stream) });
  }
  return out;
}

/**
 * Embedded file streams are normally Flate-compressed. `getContents()` returns
 * the raw stream bytes, so decode them before handing the file to the user.
 */
async function decodeStream(stream: PDFRawStream): Promise<Uint8Array> {
  const raw = stream.getContents();
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
  const isFlate = filters.some((f) => String(f) === '/FlateDecode');
  if (!isFlate) return raw;

  // zlib-wrapped first (what PDF writers emit), then raw deflate as a fallback.
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      return await inflate(raw, format);
    } catch {
      // Try the next framing.
    }
  }
  // Better to hand back the raw bytes than nothing at all.
  return raw;
}

async function inflate(
  bytes: Uint8Array,
  format: 'deflate' | 'deflate-raw'
): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractAttachments(file: File): Promise<OutFile[]> {
  const found = await listAttachments(file);
  if (found.length === 0)
    throw new Error('This PDF has no embedded attachments');
  return found.map((f) => ({
    name: f.name,
    bytes: f.bytes,
    mime: 'application/octet-stream',
  }));
}

export async function removeAllAttachments(file: File): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) names.delete(PDFName.of('EmbeddedFiles'));
  return doc.save();
}

/* ------------------------------------------------------------ bookmarks */

export type BookmarkSpec = { title: string; page: number; level: number };

/**
 * Parse an indented outline:
 *   Chapter 1: 1
 *     Section 1.1: 2
 * Indentation (2 spaces or a tab) sets nesting depth.
 */
export function parseBookmarkSpec(input: string): BookmarkSpec[] {
  const out: BookmarkSpec[] = [];
  for (const raw of input.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^[\t ]*/)?.[0] ?? '';
    const level = indent.includes('\t')
      ? indent.split('\t').length - 1
      : Math.floor(indent.length / 2);
    const match = raw.trim().match(/^(.*):\s*(\d+)$/);
    if (!match) {
      throw new Error(
        `Cannot parse bookmark line: "${raw.trim()}" (expected "Title: page")`
      );
    }
    out.push({
      title: match[1]!.trim(),
      page: parseInt(match[2]!, 10),
      level,
    });
  }
  if (out.length === 0) throw new Error('Add at least one bookmark');
  return out;
}

/** Build a real /Outlines tree so viewers show a navigable sidebar. */
export async function addBookmarks(
  file: File,
  specs: BookmarkSpec[]
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const context = doc.context;
  const pages = doc.getPages();

  type Node = {
    spec: BookmarkSpec;
    ref: PDFRef;
    dict: PDFDict;
    children: Node[];
  };

  const makeNode = (spec: BookmarkSpec): Node => {
    const index = Math.min(Math.max(spec.page, 1), pages.length) - 1;
    const pageRef = pages[index]!.ref;
    const dict = context.obj({
      Title: PDFHexString.fromText(spec.title),
      Dest: context.obj([pageRef, PDFName.of('Fit')]),
    });
    return { spec, ref: context.register(dict), dict, children: [] };
  };

  // Rebuild the hierarchy from the flat, level-tagged list.
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const spec of specs) {
    const node = makeNode(spec);
    while (stack.length > spec.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const outlinesDict = context.obj({ Type: PDFName.of('Outlines') });
  const outlinesRef = context.register(outlinesDict);

  const link = (siblings: Node[], parentRef: PDFRef): number => {
    let total = 0;
    siblings.forEach((node, i) => {
      node.dict.set(PDFName.of('Parent'), parentRef);
      if (i > 0) node.dict.set(PDFName.of('Prev'), siblings[i - 1]!.ref);
      if (i < siblings.length - 1) {
        node.dict.set(PDFName.of('Next'), siblings[i + 1]!.ref);
      }
      total += 1;
      if (node.children.length > 0) {
        const descendants = link(node.children, node.ref);
        node.dict.set(PDFName.of('First'), node.children[0]!.ref);
        node.dict.set(
          PDFName.of('Last'),
          node.children[node.children.length - 1]!.ref
        );
        // Positive count = open by default.
        node.dict.set(PDFName.of('Count'), PDFNumber.of(descendants));
        total += descendants;
      }
    });
    return total;
  };

  const count = link(roots, outlinesRef);
  if (roots.length > 0) {
    outlinesDict.set(PDFName.of('First'), roots[0]!.ref);
    outlinesDict.set(PDFName.of('Last'), roots[roots.length - 1]!.ref);
  }
  outlinesDict.set(PDFName.of('Count'), PDFNumber.of(count));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

  return doc.save();
}

/** Prepend a rendered table-of-contents page (and matching bookmarks). */
export async function addTableOfContents(
  file: File,
  specs: BookmarkSpec[],
  title: string
): Promise<Uint8Array> {
  const withMarks = await addBookmarks(file, specs);
  const doc = await PDFDocument.load(withMarks, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const first = doc.getPage(0);
  const width = first.getWidth();
  const height = first.getHeight();

  const rowsPerPage = Math.floor((height - 160) / 22);
  const chunks: BookmarkSpec[][] = [];
  for (let i = 0; i < specs.length; i += rowsPerPage) {
    chunks.push(specs.slice(i, i + rowsPerPage));
  }

  // Build TOC pages, then move them to the front in order.
  const created: PDFPage[] = [];
  for (const chunk of chunks) {
    const page = doc.addPage([width, height]);
    created.push(page);
    let y = height - 80;
    if (created.length === 1) {
      page.drawText(title || 'Contents', { x: 60, y, size: 22, font: bold });
      y -= 40;
    }
    for (const spec of chunk) {
      const indent = 60 + spec.level * 18;
      const label = spec.title;
      const pageLabel = String(spec.page + chunks.length);
      page.drawText(label, { x: indent, y, size: 11, font });
      const labelWidth = font.widthOfTextAtSize(label, 11);
      const numWidth = font.widthOfTextAtSize(pageLabel, 11);
      const dotsStart = indent + labelWidth + 6;
      const dotsEnd = width - 60 - numWidth - 6;
      if (dotsEnd > dotsStart) {
        const dotWidth = font.widthOfTextAtSize('.', 11);
        const count = Math.floor((dotsEnd - dotsStart) / dotWidth);
        page.drawText('.'.repeat(Math.max(0, count)), {
          x: dotsStart,
          y,
          size: 11,
          font,
          color: rgb(0.6, 0.6, 0.6),
        });
      }
      page.drawText(pageLabel, { x: width - 60 - numWidth, y, size: 11, font });
      y -= 22;
    }
  }

  created.forEach((page, i) => {
    doc.removePage(doc.getPages().indexOf(page));
    doc.insertPage(i, page);
  });

  return doc.save();
}

/* ---------------------------------------------------------- page labels */

/** Set /PageLabels so viewers show e.g. i, ii, iii then 1, 2, 3. */
export async function addPageLabels(
  file: File,
  ranges: {
    start: number;
    style: string;
    prefix: string;
    firstNumber: number;
  }[]
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const context = doc.context;
  const nums = PDFArray.withContext(context);
  for (const r of ranges) {
    // Build the label dict key by key — pdf-lib's obj() literal form cannot
    // express an optional set of PDF primitives.
    const entry = PDFDict.withContext(context);
    if (r.style && r.style !== 'none') {
      entry.set(PDFName.of('S'), PDFName.of(r.style));
    }
    if (r.prefix) entry.set(PDFName.of('P'), PDFHexString.fromText(r.prefix));
    if (r.firstNumber && r.firstNumber !== 1) {
      entry.set(PDFName.of('St'), PDFNumber.of(r.firstNumber));
    }
    nums.push(PDFNumber.of(Math.max(0, r.start - 1)));
    nums.push(entry);
  }
  const labels = PDFDict.withContext(context);
  labels.set(PDFName.of('Nums'), nums);
  doc.catalog.set(PDFName.of('PageLabels'), labels);
  return doc.save();
}

/* ------------------------------------------------------------- overlay */

/** Stamp every page of `overlay` on top of (or beneath) the base document. */
export async function overlayPdf(
  base: File,
  overlay: File,
  opts: {
    opacity: number;
    behind: boolean;
    repeat: boolean;
    /** Limit stamping to these pages of the base document. */
    range?: string;
  }
): Promise<Uint8Array> {
  const doc = await loadPdf(base);
  const overlayDoc = await loadPdf(overlay);
  const count = overlayDoc.getPageCount();
  if (count === 0) throw new Error('The overlay PDF has no pages');

  const pages = doc.getPages();
  const target = new Set(parsePageRange(opts.range ?? '', pages.length));
  for (let i = 0; i < pages.length; i++) {
    if (!target.has(i)) continue;
    const sourceIndex = opts.repeat ? i % count : i;
    if (sourceIndex >= count) break;
    const embedded = await doc.embedPage(overlayDoc.getPage(sourceIndex));
    const page = pages[i]!;
    const { width, height } = page.getSize();
    const scale = Math.min(width / embedded.width, height / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    const options = {
      x: (width - w) / 2,
      y: (height - h) / 2,
      width: w,
      height: h,
      opacity: opts.opacity,
    };
    if (opts.behind) {
      // drawPage appends; to place beneath we rebuild the page onto a fresh one.
      const self = await doc.embedPage(page);
      page.drawPage(embedded, options);
      page.drawPage(self, { x: 0, y: 0, width, height });
    } else {
      page.drawPage(embedded, options);
    }
  }
  return doc.save();
}

/* ---------------------------------------------------------- imposition */

/** Reorder pages for saddle-stitch booklet printing (2-up, sheet order). */
export async function bookletPdf(
  file: File,
  paperSize = 'auto'
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const count = src.getPageCount();
  // Booklets need a multiple of 4; pad with blanks.
  const padded = Math.ceil(count / 4) * 4;
  const order: (number | null)[] = [];
  let left = 0;
  let right = padded - 1;
  while (left < right) {
    order.push(right, left, left + 1, right - 1);
    left += 2;
    right -= 2;
  }

  const sample = src.getPage(0);
  const paper = NAMED_SIZES[paperSize];
  // A booklet sheet is two pages side by side, so use the landscape paper.
  const sheetW = paper ? Math.max(paper[0], paper[1]) : sample.getWidth() * 2;
  const sheetH = paper ? Math.min(paper[0], paper[1]) : sample.getHeight();
  const out = await PDFDocument.create();

  for (let i = 0; i < order.length; i += 2) {
    const sheet = out.addPage([sheetW, sheetH]);
    for (const [slot, idx] of [order[i], order[i + 1]].entries()) {
      if (idx == null || idx >= count) continue;
      const embedded = await out.embedPage(src.getPage(idx));
      const scale = Math.min(
        sheetW / 2 / embedded.width,
        sheetH / embedded.height
      );
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      sheet.drawPage(embedded, {
        x: slot * (sheetW / 2) + (sheetW / 2 - w) / 2,
        y: (sheetH - h) / 2,
        width: w,
        height: h,
      });
    }
  }
  return out.save();
}

/** Blow one page up across a grid of sheets for large-format printing. */
export async function posterizePdf(
  file: File,
  cols: number,
  rows: number,
  overlapPt: number,
  opts: {
    range?: string;
    sheetSize?: string;
    orientation?: 'auto' | 'portrait' | 'landscape';
  } = {}
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const out = await PDFDocument.create();
  const wanted = new Set(parsePageRange(opts.range ?? '', src.getPageCount()));
  for (let p = 0; p < src.getPageCount(); p++) {
    if (!wanted.has(p)) continue;
    const page = src.getPage(p);
    const embedded = await out.embedPage(page);
    const tileW = embedded.width / cols;
    const tileH = embedded.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Either emit a tile-sized sheet, or fit the tile onto fixed paper.
        let sheetW = tileW + overlapPt;
        let sheetH = tileH + overlapPt;
        const paper = opts.sheetSize ? NAMED_SIZES[opts.sheetSize] : undefined;
        if (paper) {
          const landscape =
            opts.orientation === 'landscape' ||
            (opts.orientation === 'auto' && sheetW > sheetH);
          sheetW = landscape
            ? Math.max(paper[0], paper[1])
            : Math.min(paper[0], paper[1]);
          sheetH = landscape
            ? Math.min(paper[0], paper[1])
            : Math.max(paper[0], paper[1]);
        }
        const sheet = out.addPage([sheetW, sheetH]);
        const fit = paper
          ? Math.min(sheetW / (tileW + overlapPt), sheetH / (tileH + overlapPt))
          : 1;
        sheet.drawPage(embedded, {
          x: (-c * tileW + overlapPt / 2) * fit,
          // PDF origin is bottom-left, so rows count up from the bottom.
          y: (-(rows - 1 - r) * tileH + overlapPt / 2) * fit,
          width: embedded.width * fit,
          height: embedded.height * fit,
        });
      }
    }
  }
  return out.save();
}

export type CombineOptions = {
  orientation: 'vertical' | 'horizontal';
  spacing: number;
  background: string;
  separator: boolean;
  separatorThickness: number;
  separatorColor: string;
};

/** Stack every page onto one continuous page, vertically or horizontally. */
export async function combineToSinglePage(
  file: File,
  opts: CombineOptions = {
    orientation: 'vertical',
    spacing: 0,
    background: '#ffffff',
    separator: false,
    separatorThickness: 1,
    separatorColor: '#c8c8c8',
  }
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const count = src.getPageCount();
  if (count === 0) throw new Error('The PDF has no pages');

  const pages = src.getPages();
  const widths = pages.map((p) => p.getWidth());
  const heights = pages.map((p) => p.getHeight());
  const gaps = opts.spacing * Math.max(0, count - 1);
  const vertical = opts.orientation === 'vertical';

  const sheetW = vertical
    ? Math.max(...widths)
    : widths.reduce((a, b) => a + b, 0) + gaps;
  const sheetH = vertical
    ? heights.reduce((a, b) => a + b, 0) + gaps
    : Math.max(...heights);

  const out = await PDFDocument.create();
  const sheet = out.addPage([sheetW, sheetH]);

  const bg = hexToRgb(opts.background);
  sheet.drawRectangle({
    x: 0,
    y: 0,
    width: sheetW,
    height: sheetH,
    color: rgb(bg.r, bg.g, bg.b),
  });

  const sep = hexToRgb(opts.separatorColor);
  let cursor = vertical ? sheetH : 0;

  for (let i = 0; i < count; i++) {
    const embedded = await out.embedPage(pages[i]!);
    if (vertical) {
      cursor -= embedded.height;
      sheet.drawPage(embedded, {
        x: (sheetW - embedded.width) / 2,
        y: cursor,
        width: embedded.width,
        height: embedded.height,
      });
      if (opts.separator && i < count - 1) {
        sheet.drawRectangle({
          x: 0,
          y: cursor - opts.spacing / 2 - opts.separatorThickness / 2,
          width: sheetW,
          height: opts.separatorThickness,
          color: rgb(sep.r, sep.g, sep.b),
        });
      }
      cursor -= opts.spacing;
    } else {
      sheet.drawPage(embedded, {
        x: cursor,
        y: (sheetH - embedded.height) / 2,
        width: embedded.width,
        height: embedded.height,
      });
      cursor += embedded.width;
      if (opts.separator && i < count - 1) {
        sheet.drawRectangle({
          x: cursor + opts.spacing / 2 - opts.separatorThickness / 2,
          y: 0,
          width: opts.separatorThickness,
          height: sheetH,
          color: rgb(sep.r, sep.g, sep.b),
        });
      }
      cursor += opts.spacing;
    }
  }
  return out.save();
}

/* -------------------------------------------------- blank page removal */

/** Drop pages whose rendered pixels are (near) uniformly white. */
export async function removeBlankPages(
  file: File,
  threshold = 0.999
): Promise<{ bytes: Uint8Array; removed: number[] }> {
  const doc = await openWithPdfjs(file);
  const blank: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = await renderPage(doc, i, 0.5);
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let light = 0;
    const pixels = data.length / 4;
    for (let p = 0; p < data.length; p += 4) {
      if (data[p]! > 245 && data[p + 1]! > 245 && data[p + 2]! > 245) light++;
    }
    if (light / pixels >= threshold) blank.push(i - 1);
  }

  const src = await loadPdf(file);
  const keep = Array.from({ length: src.getPageCount() }, (_, i) => i).filter(
    (i) => !blank.includes(i)
  );
  if (keep.length === 0)
    throw new Error('Every page looks blank — nothing to keep');
  const out = await copyPagesToNew(src, keep);
  return { bytes: await out.save(), removed: blank.map((i) => i + 1) };
}

/* ----------------------------------------------------------- numbering */

export type BatesOptions = {
  prefix: string;
  suffix: string;
  start: number;
  digits: number;
  position: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right';
};

export async function batesNumber(
  file: File,
  opts: BatesOptions
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10;
  doc.getPages().forEach((page, i) => {
    const n = String(opts.start + i).padStart(opts.digits, '0');
    const label = `${opts.prefix}${n}${opts.suffix}`;
    const textWidth = font.widthOfTextAtSize(label, size);
    const { width, height } = page.getSize();
    const positions = {
      'bottom-right': { x: width - textWidth - 36, y: 24 },
      'bottom-left': { x: 36, y: 24 },
      'bottom-center': { x: (width - textWidth) / 2, y: 24 },
      'top-right': { x: width - textWidth - 36, y: height - 30 },
    };
    const { x, y } = positions[opts.position];
    page.drawText(label, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  });
  return doc.save();
}

/* ------------------------------------------------------------- colours */

/** Paint a solid colour behind existing content on every page. */
export async function setBackgroundColor(
  file: File,
  color: { r: number; g: number; b: number }
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const out = await PDFDocument.create();
  for (let i = 0; i < src.getPageCount(); i++) {
    const embedded = await out.embedPage(src.getPage(i));
    const page = out.addPage([embedded.width, embedded.height]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
      color: rgb(color.r, color.g, color.b),
    });
    page.drawPage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
  }
  return out.save();
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`"${hex}" is not a valid hex colour`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/* ---------------------------------------------------------------- forms */

export type FormField = {
  name: string;
  type: string;
  value: string;
  options?: string[];
};

export async function readFormFields(file: File): Promise<FormField[]> {
  const doc = await loadPdf(file);
  const form = doc.getForm();
  return form.getFields().map((field) => {
    const name = field.getName();
    const type = field.constructor.name.replace(/^PDF/, '');
    let value = '';
    let options: string[] | undefined;
    try {
      if ('getText' in field && typeof field.getText === 'function') {
        value = (field.getText() as string | undefined) ?? '';
      } else if (
        'isChecked' in field &&
        typeof field.isChecked === 'function'
      ) {
        value = field.isChecked() ? 'true' : 'false';
      } else if (
        'getSelected' in field &&
        typeof field.getSelected === 'function'
      ) {
        value = ((field.getSelected() as string[]) ?? []).join(', ');
      }
      if ('getOptions' in field && typeof field.getOptions === 'function') {
        options = field.getOptions() as string[];
      }
    } catch {
      // Malformed field — surface it with an empty value rather than failing.
    }
    return { name, type, value, options };
  });
}

export async function fillFormFields(
  file: File,
  values: Record<string, string>,
  flatten: boolean
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFields().find((f) => f.getName() === name);
    if (!field) continue;
    try {
      if ('setText' in field && typeof field.setText === 'function') {
        field.setText(value);
      } else if (
        'check' in field &&
        typeof field.check === 'function' &&
        'uncheck' in field &&
        typeof field.uncheck === 'function'
      ) {
        if (value === 'true') field.check();
        else field.uncheck();
      } else if ('select' in field && typeof field.select === 'function') {
        if (value) field.select(value);
      }
    } catch {
      throw new Error(`Could not set field "${name}"`);
    }
  }
  if (flatten) form.flatten();
  return doc.save();
}

/* --------------------------------------------------------------- misc */

export async function documentInfo(file: File): Promise<string> {
  const doc = await loadPdf(file);
  const fmt = (d: Date | undefined) => (d ? d.toISOString() : '');
  const info = {
    file: file.name,
    sizeBytes: file.size,
    pageCount: doc.getPageCount(),
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    creationDate: fmt(doc.getCreationDate()),
    modificationDate: fmt(doc.getModificationDate()),
    pages: doc.getPages().map((p, i) => ({
      page: i + 1,
      width: Number(p.getWidth().toFixed(2)),
      height: Number(p.getHeight().toFixed(2)),
      rotation: p.getRotation().angle,
    })),
  };
  return JSON.stringify(info, null, 2);
}

export function textFile(name: string, content: string, mime: string): OutFile {
  return { name, bytes: new TextEncoder().encode(content), mime };
}

export { stem };

/* --------------------------------------------------------------- n-up */

export type NUpOptions = {
  perSheet: number;
  sheetSize: string;
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
  border: boolean;
  borderColor: string;
  range: string;
};

/** Grid layouts for each supported pages-per-sheet value. */
const NUP_GRID: Record<number, [number, number]> = {
  2: [2, 1],
  4: [2, 2],
  6: [3, 2],
  9: [3, 3],
  16: [4, 4],
};

/** Place N source pages onto each output sheet. */
export async function nUpPdf(
  file: File,
  opts: NUpOptions
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const indices = parsePageRange(opts.range, src.getPageCount());
  if (indices.length === 0) throw new Error('No pages matched the range');

  const [cols, rows] = NUP_GRID[opts.perSheet] ?? NUP_GRID[4]!;
  const paper = NAMED_SIZES[opts.sheetSize] ?? NAMED_SIZES.a4!;
  let [sheetW, sheetH] = paper;
  // 2-up and 6-up read better on landscape paper by default.
  const wantLandscape =
    opts.orientation === 'landscape' ||
    (opts.orientation === 'auto' && cols > rows);
  if (wantLandscape) [sheetW, sheetH] = [sheetH, sheetW];

  const cellW = (sheetW - opts.margin * 2) / cols;
  const cellH = (sheetH - opts.margin * 2) / rows;
  const border = hexToRgb(opts.borderColor);

  const out = await PDFDocument.create();
  for (let i = 0; i < indices.length; i += opts.perSheet) {
    const sheet = out.addPage([sheetW, sheetH]);
    for (let k = 0; k < opts.perSheet && i + k < indices.length; k++) {
      const embedded = await out.embedPage(src.getPage(indices[i + k]!));
      const col = k % cols;
      const row = Math.floor(k / cols);
      const scale =
        Math.min(cellW / embedded.width, cellH / embedded.height) * 0.95;
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      const cellX = opts.margin + col * cellW;
      const cellY = opts.margin + (rows - 1 - row) * cellH;
      const x = cellX + (cellW - w) / 2;
      const y = cellY + (cellH - h) / 2;
      sheet.drawPage(embedded, { x, y, width: w, height: h });
      if (opts.border) {
        sheet.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: rgb(border.r, border.g, border.b),
          borderWidth: 0.75,
        });
      }
    }
  }
  return out.save();
}

/* ------------------------------------------------------- divide pages */

/** Cut every page in half, vertically (two columns) or horizontally. */
export async function dividePages(
  file: File,
  direction: 'vertical' | 'horizontal',
  range: string
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const target = new Set(parsePageRange(range, src.getPageCount()));
  const out = await PDFDocument.create();

  for (let i = 0; i < src.getPageCount(); i++) {
    const page = src.getPage(i);
    const w = page.getWidth();
    const h = page.getHeight();
    const embedded = await out.embedPage(page);

    if (!target.has(i)) {
      const keep = out.addPage([w, h]);
      keep.drawPage(embedded, { x: 0, y: 0, width: w, height: h });
      continue;
    }

    if (direction === 'vertical') {
      // Left half, then right half.
      const left = out.addPage([w / 2, h]);
      left.drawPage(embedded, { x: 0, y: 0, width: w, height: h });
      const right = out.addPage([w / 2, h]);
      right.drawPage(embedded, { x: -w / 2, y: 0, width: w, height: h });
    } else {
      // Top half, then bottom half.
      const top = out.addPage([w, h / 2]);
      top.drawPage(embedded, { x: 0, y: -h / 2, width: w, height: h });
      const bottom = out.addPage([w, h / 2]);
      bottom.drawPage(embedded, { x: 0, y: 0, width: w, height: h });
    }
  }
  return out.save();
}
