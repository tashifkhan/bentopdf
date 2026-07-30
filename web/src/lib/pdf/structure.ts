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

const NAMED_SIZES: Record<string, [number, number]> = {
  a4: [...PageSizes.A4] as [number, number],
  a3: [...PageSizes.A3] as [number, number],
  a5: [...PageSizes.A5] as [number, number],
  letter: [...PageSizes.Letter] as [number, number],
  legal: [...PageSizes.Legal] as [number, number],
  tabloid: [...PageSizes.Tabloid] as [number, number],
};

/** Re-impose every page onto a uniform sheet, scaling to fit and centring. */
export async function fixPageSize(
  file: File,
  sizeName: string,
  orientation: 'portrait' | 'landscape' | 'auto' = 'auto'
): Promise<Uint8Array> {
  const base = NAMED_SIZES[sizeName] ?? NAMED_SIZES.a4!;
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

export async function readPageDimensions(file: File): Promise<string> {
  const doc = await loadPdf(file);
  const lines = ['page,width_pt,height_pt,width_mm,height_mm,rotation'];
  doc.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    const mm = (pt: number) => (pt * 25.4) / 72;
    lines.push(
      [
        i + 1,
        width.toFixed(2),
        height.toFixed(2),
        mm(width).toFixed(1),
        mm(height).toFixed(1),
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
  opts: { opacity: number; behind: boolean; repeat: boolean }
): Promise<Uint8Array> {
  const doc = await loadPdf(base);
  const overlayDoc = await loadPdf(overlay);
  const count = overlayDoc.getPageCount();
  if (count === 0) throw new Error('The overlay PDF has no pages');

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
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
export async function bookletPdf(file: File): Promise<Uint8Array> {
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
  const sheetW = sample.getWidth() * 2;
  const sheetH = sample.getHeight();
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
  overlapPt: number
): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const out = await PDFDocument.create();
  for (let p = 0; p < src.getPageCount(); p++) {
    const page = src.getPage(p);
    const embedded = await out.embedPage(page);
    const tileW = embedded.width / cols;
    const tileH = embedded.height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sheet = out.addPage([tileW + overlapPt, tileH + overlapPt]);
        sheet.drawPage(embedded, {
          x: -c * tileW + overlapPt / 2,
          // PDF origin is bottom-left, so rows count up from the bottom.
          y: -(rows - 1 - r) * tileH + overlapPt / 2,
          width: embedded.width,
          height: embedded.height,
        });
      }
    }
  }
  return out.save();
}

/** Stack every page onto one tall continuous page. */
export async function combineToSinglePage(file: File): Promise<Uint8Array> {
  const src = await loadPdf(file);
  const count = src.getPageCount();
  if (count === 0) throw new Error('The PDF has no pages');
  const width = Math.max(...src.getPages().map((p) => p.getWidth()));
  const heights = src.getPages().map((p) => p.getHeight());
  const total = heights.reduce((a, b) => a + b, 0);

  const out = await PDFDocument.create();
  const sheet = out.addPage([width, total]);
  let y = total;
  for (let i = 0; i < count; i++) {
    const embedded = await out.embedPage(src.getPage(i));
    y -= heights[i]!;
    sheet.drawPage(embedded, {
      x: (width - embedded.width) / 2,
      y,
      width: embedded.width,
      height: embedded.height,
    });
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
