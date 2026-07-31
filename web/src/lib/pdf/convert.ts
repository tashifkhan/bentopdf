import { PDFDocument, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { stem, type OutFile } from './core';
import { canvasToBytes, newCanvas, openWithPdfjs } from './render';

/* ------------------------------------------------------- flowing writer */

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
};

/**
 * A minimal top-down text flow over pdf-lib: it tracks a cursor, wraps to the
 * page width, and adds pages as it overflows. Enough for the text-ish
 * converters without dragging in a browser layout engine.
 */
class DocWriter {
  readonly doc: PDFDocument;
  private fonts!: Fonts;
  private page!: PDFPage;
  private y = 0;
  readonly margin = 54;
  pageSize: [number, number] = [...PageSizes.A4] as [number, number];

  private constructor(doc: PDFDocument, pageSize?: [number, number]) {
    this.doc = doc;
    if (pageSize) this.pageSize = pageSize;
  }

  static async create(pageSize?: [number, number]): Promise<DocWriter> {
    const doc = await PDFDocument.create();
    const writer = new DocWriter(doc, pageSize);
    writer.fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      mono: await doc.embedFont(StandardFonts.Courier),
    };
    writer.newPage();
    return writer;
  }

  get width() {
    return this.pageSize[0] - this.margin * 2;
  }

  private newPage() {
    this.page = this.doc.addPage(this.pageSize);
    this.y = this.pageSize[1] - this.margin;
  }

  private ensure(height: number) {
    if (this.y - height < this.margin) this.newPage();
  }

  space(amount: number) {
    this.y -= amount;
    if (this.y < this.margin) this.newPage();
  }

  /** Split a string to fit `maxWidth`, breaking long unbroken tokens. */
  private wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        const trial = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
          current = trial;
          continue;
        }
        if (current) lines.push(current);
        if (font.widthOfTextAtSize(word, size) <= maxWidth) {
          current = word;
          continue;
        }
        // A single token wider than the column — hard-break it.
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
      lines.push(current);
    }
    return lines;
  }

  text(
    content: string,
    opts: {
      size?: number;
      font?: keyof Fonts;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      lineHeight?: number;
    } = {}
  ) {
    const size = opts.size ?? 11;
    const font = this.fonts[opts.font ?? 'regular'];
    const indent = opts.indent ?? 0;
    const lineHeight = opts.lineHeight ?? size * 1.45;
    const maxWidth = this.width - indent;
    for (const line of this.wrap(content, font, size, maxWidth)) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: this.margin + indent,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? rgb(0.1, 0.1, 0.12),
      });
      this.y -= lineHeight;
    }
  }

  rule() {
    this.ensure(12);
    this.y -= 6;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageSize[0] - this.margin, y: this.y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.82),
    });
    this.y -= 10;
  }

  codeBlock(content: string) {
    const size = 9;
    const lineHeight = size * 1.4;
    const lines = this.wrap(content, this.fonts.mono, size, this.width - 20);
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawRectangle({
        x: this.margin,
        y: this.y - lineHeight + 2,
        width: this.width,
        height: lineHeight,
        color: rgb(0.96, 0.96, 0.97),
      });
      this.page.drawText(line, {
        x: this.margin + 8,
        y: this.y - size,
        size,
        font: this.fonts.mono,
        color: rgb(0.15, 0.15, 0.2),
      });
      this.y -= lineHeight;
    }
  }

  /** Draw a bordered table, repeating the header row across page breaks. */
  table(rows: string[][], hasHeader: boolean) {
    if (rows.length === 0) return;
    const columns = Math.max(...rows.map((r) => r.length));
    const colWidth = this.width / columns;
    const size = 9;
    const padding = 4;

    const drawRow = (cells: string[], header: boolean) => {
      const wrapped = Array.from({ length: columns }, (_, c) =>
        this.wrap(
          cells[c] ?? '',
          header ? this.fonts.bold : this.fonts.regular,
          size,
          colWidth - padding * 2
        )
      );
      const lineCount = Math.max(1, ...wrapped.map((w) => w.length));
      const rowHeight = lineCount * (size * 1.35) + padding * 2;
      this.ensure(rowHeight);
      const top = this.y;

      if (header) {
        this.page.drawRectangle({
          x: this.margin,
          y: top - rowHeight,
          width: this.width,
          height: rowHeight,
          color: rgb(0.94, 0.95, 0.97),
        });
      }
      for (let c = 0; c < columns; c++) {
        const x = this.margin + c * colWidth;
        this.page.drawRectangle({
          x,
          y: top - rowHeight,
          width: colWidth,
          height: rowHeight,
          borderColor: rgb(0.82, 0.83, 0.86),
          borderWidth: 0.5,
        });
        wrapped[c]!.forEach((line, li) => {
          this.page.drawText(line, {
            x: x + padding,
            y: top - padding - size - li * (size * 1.35),
            size,
            font: header ? this.fonts.bold : this.fonts.regular,
            color: rgb(0.12, 0.12, 0.15),
          });
        });
      }
      this.y -= rowHeight;
    };

    rows.forEach((row, i) => drawRow(row, hasHeader && i === 0));
  }

  save() {
    return this.doc.save();
  }
}

/* ------------------------------------------------------------- markdown */

/** Render markdown to PDF via markdown-it's token stream. */
export async function markdownToPdf(
  source: string,
  filename = 'document.pdf'
): Promise<OutFile> {
  const MarkdownIt = (await import('markdown-it')).default;
  const md = new MarkdownIt({ html: false, linkify: true });
  const tokens = md.parse(source, {});
  const writer = await DocWriter.create();

  const headingSizes: Record<string, number> = {
    h1: 24,
    h2: 19,
    h3: 15,
    h4: 13,
    h5: 12,
    h6: 11,
  };

  let listDepth = 0;
  let ordered = false;
  let itemIndex = 0;
  let tableRows: string[][] = [];
  let tableRow: string[] = [];
  let inTable = false;
  let inHeaderRow = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case 'heading_open': {
        const size = headingSizes[token.tag] ?? 12;
        const inline = tokens[i + 1];
        writer.space(8);
        writer.text(inline?.content ?? '', { size, font: 'bold' });
        writer.space(4);
        i += 2;
        break;
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        if (inline?.content) {
          const indent = listDepth > 0 ? listDepth * 16 : 0;
          const prefix =
            listDepth > 0 ? (ordered ? `${itemIndex}. ` : '• ') : '';
          writer.text(prefix + stripInline(inline.content), { indent });
          writer.space(4);
        }
        i += 2;
        break;
      }
      case 'fence':
      case 'code_block':
        writer.space(4);
        writer.codeBlock(token.content.replace(/\n$/, ''));
        writer.space(6);
        break;
      case 'hr':
        writer.rule();
        break;
      case 'bullet_list_open':
        listDepth++;
        ordered = false;
        itemIndex = 0;
        break;
      case 'ordered_list_open':
        listDepth++;
        ordered = true;
        itemIndex = 0;
        break;
      case 'bullet_list_close':
      case 'ordered_list_close':
        listDepth = Math.max(0, listDepth - 1);
        writer.space(4);
        break;
      case 'list_item_open':
        itemIndex++;
        break;
      case 'blockquote_open':
        writer.space(4);
        break;
      case 'table_open':
        inTable = true;
        tableRows = [];
        break;
      case 'thead_open':
        inHeaderRow = true;
        break;
      case 'thead_close':
        inHeaderRow = false;
        break;
      case 'tr_open':
        tableRow = [];
        break;
      case 'tr_close':
        tableRows.push(tableRow);
        break;
      case 'th_open':
      case 'td_open': {
        const inline = tokens[i + 1];
        tableRow.push(stripInline(inline?.content ?? ''));
        i += 2;
        break;
      }
      case 'table_close':
        writer.space(6);
        writer.table(tableRows, true);
        writer.space(8);
        inTable = false;
        break;
      default:
        break;
    }
  }
  void inTable;
  void inHeaderRow;

  return {
    name: filename,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/** Strip inline markdown emphasis markers we cannot render as rich text. */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1');
}

/* -------------------------------------------------------------- csv/tsv */

export async function csvToPdf(
  source: string,
  filename = 'table.pdf',
  opts: { header: boolean; delimiter?: string } = { header: true }
): Promise<OutFile> {
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse<string[]>(source.trim(), {
    skipEmptyLines: true,
    delimiter: opts.delimiter || undefined,
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`Could not parse CSV: ${parsed.errors[0]!.message}`);
  }
  const rows = parsed.data.filter((r) => r.length > 0);
  if (rows.length === 0) throw new Error('The CSV has no rows');

  const writer = await DocWriter.create();
  writer.table(rows, opts.header);
  return {
    name: filename,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/* ---------------------------------------------------------------- json */

export async function jsonToPdf(
  source: string,
  filename = 'data.pdf'
): Promise<OutFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    throw new Error(
      `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
      {
        cause: e,
      }
    );
  }
  const writer = await DocWriter.create();

  // An array of flat objects reads far better as a table than as raw JSON.
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((r) => r && typeof r === 'object' && !Array.isArray(r))
  ) {
    const keys = [...new Set(parsed.flatMap((r) => Object.keys(r as object)))];
    const rows = [
      keys,
      ...parsed.map((r) =>
        keys.map((k) => {
          const v = (r as Record<string, unknown>)[k];
          return v == null
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
        })
      ),
    ];
    writer.table(rows, true);
  } else {
    writer.codeBlock(JSON.stringify(parsed, null, 2));
  }
  return {
    name: filename,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/* ----------------------------------------------------------------- xml */

export async function xmlToPdf(
  source: string,
  filename = 'document.pdf'
): Promise<OutFile> {
  const { XMLParser, XMLValidator } = await import('fast-xml-parser');
  const valid = XMLValidator.validate(source);
  if (valid !== true) {
    throw new Error(`Invalid XML: ${valid.err.msg} (line ${valid.err.line})`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    preserveOrder: false,
  });
  const tree = parser.parse(source);
  const writer = await DocWriter.create();
  writer.codeBlock(JSON.stringify(tree, null, 2));
  return {
    name: filename,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/* --------------------------------------------------------------- plain */

export type TextPdfOptions = {
  font?: 'regular' | 'bold' | 'italic' | 'mono';
  fontSize?: number;
  color?: string;
  pageSize?: [number, number];
};

function hexToRgbLocal(hex: string) {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

export async function plainTextToPdf(
  source: string,
  filename = 'document.pdf',
  opts: TextPdfOptions = {}
): Promise<OutFile> {
  if (!source.trim()) throw new Error('There is no text to convert');
  const writer = await DocWriter.create(opts.pageSize);
  const c = opts.color ? hexToRgbLocal(opts.color) : undefined;
  writer.text(source, {
    font: opts.font ?? 'regular',
    size: opts.fontSize ?? 11,
    ...(c ? { color: rgb(c.r, c.g, c.b) } : {}),
  });
  return {
    name: filename,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/* ---------------------------------------------------------------- email */

/** Convert .eml / .msg to PDF, headers first then the plain-text body. */
export type EmailPdfOptions = {
  includeCcBcc: boolean;
  listAttachments: boolean;
  pageSize?: [number, number];
};

export async function emailToPdf(
  file: File,
  opts: EmailPdfOptions = { includeCcBcc: true, listAttachments: true }
): Promise<OutFile> {
  const name = file.name.toLowerCase();
  const writer = await DocWriter.create(opts.pageSize);

  if (name.endsWith('.msg')) {
    const MsgReader = await loadMsgReader();
    const reader = new MsgReader(await file.arrayBuffer());
    const data = reader.getFileData();
    if (!data || 'error' in data)
      throw new Error('Could not read this .msg file');
    writer.text(data.subject || '(no subject)', { size: 18, font: 'bold' });
    writer.space(6);
    writer.text(`From: ${data.senderName ?? ''} <${data.senderEmail ?? ''}>`, {
      size: 10,
      color: rgb(0.35, 0.35, 0.4),
    });
    writer.text(
      `To: ${(data.recipients ?? []).map((r) => r.email ?? r.name).join(', ')}`,
      { size: 10, color: rgb(0.35, 0.35, 0.4) }
    );
    writer.rule();
    writer.text(data.body ?? '');
    return {
      name: `${stem(file.name)}.pdf`,
      bytes: await writer.save(),
      mime: 'application/pdf',
    };
  }

  const PostalMime = (await import('postal-mime')).default;
  const email = await new PostalMime().parse(await file.arrayBuffer());
  writer.text(email.subject || '(no subject)', { size: 18, font: 'bold' });
  writer.space(6);
  const meta = [
    `From: ${email.from?.name ?? ''} <${email.from?.address ?? ''}>`,
    `To: ${(email.to ?? []).map((t) => t.address).join(', ')}`,
    opts.includeCcBcc && email.cc?.length
      ? `Cc: ${email.cc.map((t) => t.address).join(', ')}`
      : '',
    opts.includeCcBcc && email.bcc?.length
      ? `Bcc: ${email.bcc.map((t) => t.address).join(', ')}`
      : '',
    email.date ? `Date: ${email.date}` : '',
  ].filter(Boolean);
  for (const line of meta) {
    writer.text(line, { size: 10, color: rgb(0.35, 0.35, 0.4) });
  }
  writer.rule();

  const body =
    email.text ??
    (email.html
      ? email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      : '');
  writer.text(body || '(empty message)');

  if (opts.listAttachments && email.attachments?.length) {
    writer.space(10);
    writer.text('Attachments', { size: 13, font: 'bold' });
    for (const att of email.attachments) {
      writer.text(`• ${att.filename ?? 'unnamed'} (${att.mimeType})`, {
        size: 10,
      });
    }
  }

  return {
    name: `${stem(file.name)}.pdf`,
    bytes: await writer.save(),
    mime: 'application/pdf',
  };
}

/* --------------------------------------------------------------- images */

/**
 * msgreader's CommonJS build nests the constructor one level deeper than its
 * typings claim, and the depth differs between dev and the pre-bundled build.
 */
async function loadMsgReader() {
  const mod = (await import('@kenjiuno/msgreader')) as unknown as Record<
    string,
    unknown
  >;
  const candidates = [
    (mod.default as Record<string, unknown> | undefined)?.default,
    mod.default,
    mod,
  ];
  const ctor = candidates.find((c) => typeof c === 'function');
  if (!ctor) throw new Error('The .msg reader failed to load');
  return ctor as new (buffer: ArrayBuffer) => {
    getFileData: () => {
      error?: string;
      subject?: string;
      senderName?: string;
      senderEmail?: string;
      recipients?: { email?: string; name?: string }[];
      body?: string;
    };
  };
}

/**
 * utif ships as CommonJS and only surfaces a default export under Vite's
 * interop, so the named imports its typings advertise are undefined at runtime.
 */
export async function loadUtif() {
  const mod = await import('utif');
  const resolved = (mod as unknown as { default?: typeof mod }).default ?? mod;
  if (typeof resolved.decode !== 'function') {
    throw new Error('The TIFF decoder failed to load');
  }
  return resolved;
}

/**
 * Decode any supported image into a canvas, including formats the browser
 * cannot open natively (HEIC via heic2any, TIFF via utif).
 */
export async function decodeImage(file: File): Promise<HTMLCanvasElement> {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    type.includes('heic')
  ) {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob: file, toType: 'image/png' });
    const blob = Array.isArray(converted) ? converted[0]! : converted;
    return blobToCanvas(blob as Blob);
  }

  if (
    name.endsWith('.tif') ||
    name.endsWith('.tiff') ||
    type.includes('tiff')
  ) {
    const UTIF = await loadUtif();
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) throw new Error('This TIFF has no images');
    const first = ifds[0]!;
    UTIF.decodeImage(buffer, first);
    const rgba = UTIF.toRGBA8(first);
    const { canvas, ctx } = newCanvas(first.width, first.height);
    const image = ctx.createImageData(first.width, first.height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  return blobToCanvas(file);
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode this image'));
      el.src = url;
    });
    // SVGs may report zero intrinsic size; fall back to a sensible raster size.
    const width = img.naturalWidth || 1024;
    const height = img.naturalHeight || 1024;
    const { canvas, ctx } = newCanvas(width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ImageToPdfOptions = {
  pageSize: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  margin: number;
};

/** Build a PDF from images of any supported format. */
export async function imagesToPdfAdvanced(
  files: File[],
  opts: ImageToPdfOptions = { pageSize: 'fit', orientation: 'auto', margin: 0 }
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one image');
  const doc = await PDFDocument.create();
  const failures: string[] = [];

  for (const file of files) {
    let canvas: HTMLCanvasElement;
    try {
      canvas = await decodeImage(file);
    } catch {
      failures.push(file.name);
      continue;
    }
    const jpeg = await canvasToBytes(canvas, 'image/jpeg', 0.92);
    const img = await doc.embedJpg(jpeg);

    if (opts.pageSize === 'fit') {
      const page = doc.addPage([
        img.width + opts.margin * 2,
        img.height + opts.margin * 2,
      ]);
      page.drawImage(img, {
        x: opts.margin,
        y: opts.margin,
        width: img.width,
        height: img.height,
      });
      continue;
    }

    const base =
      opts.pageSize === 'letter'
        ? ([...PageSizes.Letter] as [number, number])
        : ([...PageSizes.A4] as [number, number]);
    let [w, h] = base;
    const landscape =
      opts.orientation === 'landscape' ||
      (opts.orientation === 'auto' && img.width > img.height);
    if (landscape) [w, h] = [h, w];
    const page = doc.addPage([w, h]);
    const available = { w: w - opts.margin * 2, h: h - opts.margin * 2 };
    const scale = Math.min(available.w / img.width, available.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    page.drawImage(img, {
      x: (w - dw) / 2,
      y: (h - dh) / 2,
      width: dw,
      height: dh,
    });
  }

  if (doc.getPageCount() === 0) {
    throw new Error(`Could not decode any of the supplied images`);
  }
  if (failures.length > 0) {
    console.warn('[images-to-pdf] skipped undecodable files:', failures);
  }
  return doc.save();
}

/* ----------------------------------------------------------------- cbz */

/** Comic archive → PDF, one page per image in filename order. */
export async function cbzToPdf(file: File): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files)
    .filter((e) => !e.dir && /\.(jpe?g|png|webp|gif|bmp)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (entries.length === 0) throw new Error('No images found in this archive');

  const doc = await PDFDocument.create();
  for (const entry of entries) {
    const bytes = await entry.async('uint8array');
    let img;
    try {
      img = /\.png$/i.test(entry.name)
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
    } catch {
      // Formats pdf-lib cannot embed directly go through the canvas.
      const canvas = await blobToCanvas(
        new Blob([bytes.slice().buffer as ArrayBuffer])
      );
      img = await doc.embedJpg(await canvasToBytes(canvas, 'image/jpeg', 0.9));
    }
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return doc.save();
}

export type CbzOptions = {
  scale: number;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  greyscale: boolean;
  /** Right-to-left reading order, written into ComicInfo.xml. */
  manga: boolean;
  metadata?: Record<string, string>;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function pdfToCbz(
  file: File,
  opts: CbzOptions = {
    scale: 2,
    format: 'jpeg',
    quality: 0.9,
    greyscale: false,
    manga: false,
  }
): Promise<OutFile> {
  const JSZip = (await import('jszip')).default;
  const { renderPage } = await import('./render');
  const doc = await openWithPdfjs(file);
  const zip = new JSZip();
  const pad = String(doc.numPages).length;
  const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
  const mime = `image/${opts.format}`;

  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = await renderPage(doc, i, opts.scale);
    if (opts.greyscale) {
      const ctx = canvas.getContext('2d')!;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      for (let p = 0; p < d.length; p += 4) {
        const g = 0.299 * d[p]! + 0.587 * d[p + 1]! + 0.114 * d[p + 2]!;
        d[p] = d[p + 1] = d[p + 2] = g;
      }
      ctx.putImageData(image, 0, 0);
    }
    zip.file(
      `${String(i).padStart(pad, '0')}.${ext}`,
      await canvasToBytes(canvas, mime, opts.quality)
    );
  }

  const meta = opts.metadata ?? {};
  const entries = Object.entries(meta).filter(([, v]) => v);
  if (entries.length > 0 || opts.manga) {
    // ComicInfo.xml is the de-facto metadata sidecar comic readers look for.
    const tags = entries
      .map(([k, v]) => `  <${k}>${escapeXml(v)}</${k}>`)
      .join('\n');
    zip.file(
      'ComicInfo.xml',
      `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n${tags}\n  <PageCount>${doc.numPages}</PageCount>\n  <Manga>${opts.manga ? 'YesAndRightToLeft' : 'No'}</Manga>\n</ComicInfo>\n`
    );
  }

  return {
    name: `${stem(file.name)}.cbz`,
    bytes: await zip.generateAsync({ type: 'uint8array' }),
    mime: 'application/vnd.comicbook+zip',
  };
}

/* -------------------------------------------------------- image extract */

/** Pull the embedded raster images out of a PDF at their native resolution. */
export async function extractEmbeddedImages(file: File): Promise<OutFile[]> {
  const doc = await openWithPdfjs(file);
  const out: OutFile[] = [];
  const base = stem(file.name);
  const seen = new Set<string>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    const pdfjs = await import('pdfjs-dist');
    const { OPS } = pdfjs;

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) {
        continue;
      }
      const arg = ops.argsArray[i]?.[0];
      const key = typeof arg === 'string' ? arg : `inline-${p}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const img: EmbeddedImage =
          typeof arg === 'string' ? await resolveImageObject(page, arg) : arg;
        if (!img?.width || !img.height) continue;

        const { canvas, ctx } = newCanvas(img.width, img.height);
        if (img.bitmap) {
          // pdf.js 5+ hands back an ImageBitmap rather than raw pixels.
          ctx.drawImage(img.bitmap, 0, 0);
        } else if (img.data) {
          const rgba = toRgba(img.data, img.width, img.height);
          const target = ctx.createImageData(img.width, img.height);
          target.data.set(rgba);
          ctx.putImageData(target, 0, 0);
        } else {
          continue;
        }
        out.push({
          name: `${base}-p${p}-img${out.length + 1}.png`,
          bytes: await canvasToBytes(canvas, 'image/png'),
          mime: 'image/png',
        });
      } catch {
        // Skip images pdf.js cannot materialise (e.g. unsupported JPX).
      }
    }
  }

  if (out.length === 0) {
    throw new Error(
      'No embedded images found. Use "PDF to PNG" to rasterize pages instead.'
    );
  }
  return out;
}

type EmbeddedImage = {
  width: number;
  height: number;
  data?: Uint8ClampedArray | null;
  bitmap?: ImageBitmap | null;
};

/**
 * Image XObjects are only materialised once pdf.js has decoded them, so
 * `objs.get` takes a callback that may fire after the operator list resolves.
 */
function resolveImageObject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  key: string
): Promise<EmbeddedImage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Image decode timed out')),
      15000
    );
    try {
      page.objs.get(key, (value: EmbeddedImage) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('Image could not be read'));
    }
  });
}

/** pdf.js hands back RGB, RGBA or greyscale buffers depending on the source. */
function toRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const pixels = width * height;
  if (data.length === pixels * 4) return new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(pixels * 4);
  if (data.length === pixels * 3) {
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      out[i * 4] = data[j]!;
      out[i * 4 + 1] = data[j + 1]!;
      out[i * 4 + 2] = data[j + 2]!;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (data.length === pixels) {
    for (let i = 0; i < pixels; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i]!;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  throw new Error('Unrecognised image buffer layout');
}
