/**
 * Readers for formats no bundled engine handles: Apple Pages/Numbers/Keynote
 * bundles, Photoshop documents and Kindle MOBI books.
 *
 * Each one targets the part of the format that is actually specified and
 * stable — Pages' embedded preview, PSD's flattened composite, MOBI's PalmDOC
 * text stream — rather than trying to reimplement the whole renderer.
 */
import { newCanvas } from './render';

/* ------------------------------------------------------------ iWork ---- */

const IWORK_PREVIEW_PATHS = [
  'QuickLook/Preview.pdf',
  'preview.pdf',
  'Data/Preview.pdf',
];

/**
 * Apple iWork documents (.pages/.numbers/.key) are ZIP bundles. Modern ones
 * ship a full-fidelity `QuickLook/Preview.pdf` rendered by the app itself,
 * which is a far better result than reimplementing their layout engine.
 */
export async function iworkPreviewPdf(file: File): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error(
      'This does not look like an iWork bundle. Files saved in the older single-file format cannot be read.'
    );
  }

  for (const path of IWORK_PREVIEW_PATHS) {
    const entry = zip.file(path);
    if (entry) return entry.async('uint8array');
  }

  // Fall back to any PDF anywhere in the bundle.
  const anyPdf = Object.values(zip.files).find(
    (e) => !e.dir && e.name.toLowerCase().endsWith('.pdf')
  );
  if (anyPdf) return anyPdf.async('uint8array');

  throw new Error(
    'No preview found inside this document. In Pages, enable "Include preview in document" under Settings → General, re-save, and try again.'
  );
}

/** True when the bundle contains a usable preview. */
export async function iworkHasPreview(file: File): Promise<boolean> {
  try {
    await iworkPreviewPdf(file);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- PSD ---- */

type PsdHeader = {
  channels: number;
  height: number;
  width: number;
  depth: number;
  colorMode: number;
};

function readPsdHeader(view: DataView): PsdHeader {
  const signature = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (signature !== '8BPS') throw new Error('Not a Photoshop document');
  const version = view.getUint16(4);
  if (version !== 1) {
    throw new Error('Large-document PSB files are not supported — save as PSD');
  }
  return {
    channels: view.getUint16(12),
    height: view.getUint32(14),
    width: view.getUint32(18),
    depth: view.getUint16(22),
    colorMode: view.getUint16(24),
  };
}

/** PackBits, as used by PSD's RLE compression. */
function unpackBits(
  src: Uint8Array,
  offset: number,
  expected: number
): { data: Uint8Array; next: number } {
  const out = new Uint8Array(expected);
  let o = 0;
  let i = offset;
  while (o < expected && i < src.length) {
    const n = (src[i++]! << 24) >> 24; // sign-extend
    if (n >= 0) {
      const count = n + 1;
      for (let k = 0; k < count && o < expected; k++) out[o++] = src[i++]!;
    } else if (n !== -128) {
      const count = 1 - n;
      const value = src[i++]!;
      for (let k = 0; k < count && o < expected; k++) out[o++] = value;
    }
  }
  return { data: out, next: i };
}

/**
 * Decode the flattened composite Photoshop stores at the end of every PSD
 * (the image Photoshop shows to apps that cannot read layers).
 */
export async function psdToCanvas(file: File): Promise<HTMLCanvasElement> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const header = readPsdHeader(view);

  if (header.depth !== 8) {
    throw new Error(
      `This PSD is ${header.depth} bits per channel; only 8-bit documents are supported.`
    );
  }
  if (header.colorMode !== 1 && header.colorMode !== 3) {
    throw new Error(
      'Only RGB and greyscale PSDs are supported. Convert to RGB in Photoshop first.'
    );
  }

  // Skip the three variable-length sections before the image data.
  let offset = 26;
  for (let section = 0; section < 3; section++) {
    offset += 4 + view.getUint32(offset);
  }

  const compression = view.getUint16(offset);
  offset += 2;

  const { width, height } = header;
  const pixels = width * height;
  // Composite channel order is R, G, B (then alpha); greyscale is one channel.
  const wanted = header.colorMode === 3 ? 3 : 1;
  const planes: Uint8Array[] = [];

  if (compression === 0) {
    for (let c = 0; c < wanted; c++) {
      planes.push(bytes.subarray(offset, offset + pixels));
      offset += pixels;
    }
  } else if (compression === 1) {
    // Scanline byte counts for every channel come first.
    const counts = header.channels * height;
    let cursor = offset + counts * 2;
    for (let c = 0; c < wanted; c++) {
      const plane = new Uint8Array(pixels);
      let written = 0;
      for (let row = 0; row < height; row++) {
        const { data, next } = unpackBits(bytes, cursor, width);
        plane.set(data, written);
        written += width;
        cursor = next;
      }
      planes.push(plane);
    }
  } else {
    throw new Error(
      'This PSD uses ZIP compression, which is not supported. Re-save with RLE compression.'
    );
  }

  const { canvas, ctx } = newCanvas(width, height);
  const image = ctx.createImageData(width, height);
  const d = image.data;
  for (let i = 0; i < pixels; i++) {
    if (wanted === 3) {
      d[i * 4] = planes[0]![i]!;
      d[i * 4 + 1] = planes[1]![i]!;
      d[i * 4 + 2] = planes[2]![i]!;
    } else {
      const g = planes[0]![i]!;
      d[i * 4] = g;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = g;
    }
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------- MOBI ---- */

type PalmRecord = { offset: number; length: number };

function readPalmRecords(view: DataView, size: number): PalmRecord[] {
  const count = view.getUint16(76);
  const records: PalmRecord[] = [];
  for (let i = 0; i < count; i++) {
    const entry = 78 + i * 8;
    const offset = view.getUint32(entry);
    const nextOffset = i + 1 < count ? view.getUint32(entry + 8) : size;
    records.push({ offset, length: nextOffset - offset });
  }
  return records;
}

/** PalmDOC LZ77 variant used by MOBI compression type 2. */
function palmDocDecompress(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i++]!;
    if (b === 0) {
      out.push(0);
    } else if (b <= 8) {
      // Literal run.
      for (let k = 0; k < b && i < src.length; k++) out.push(src[i++]!);
    } else if (b <= 0x7f) {
      out.push(b);
    } else if (b <= 0xbf) {
      // Back-reference: 2 bytes → distance and length.
      const next = src[i++];
      if (next === undefined) break;
      const pair = (b << 8) | next;
      const distance = (pair >> 3) & 0x07ff;
      const length = (pair & 0x07) + 3;
      if (distance === 0 || distance > out.length) break;
      const start = out.length - distance;
      for (let k = 0; k < length; k++) out.push(out[start + k]!);
    } else {
      // 0xc0-0xff: space plus the low 7 bits.
      out.push(32, b ^ 0x80);
    }
  }
  return Uint8Array.from(out);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<mbp:pagebreak[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export type MobiBook = { title: string; text: string };

/** Extract the readable text from an unencrypted MOBI/AZW file. */
export async function readMobi(file: File): Promise<MobiBook> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const type = String.fromCharCode(...bytes.subarray(60, 68));
  if (!/BOOKMOBI|TEXtREAd/.test(type)) {
    throw new Error('This is not a MOBI or PalmDOC file');
  }

  const records = readPalmRecords(view, bytes.length);
  if (records.length === 0) throw new Error('This MOBI file has no records');

  const head = records[0]!.offset;
  const compression = view.getUint16(head);
  const textLength = view.getUint32(head + 4);
  const textRecordCount = view.getUint16(head + 8);
  const encryption = view.getUint16(head + 12);

  if (encryption !== 0) {
    throw new Error(
      'This book is DRM-protected and cannot be converted. Only DRM-free MOBI files are supported.'
    );
  }
  if (compression === 17480) {
    throw new Error(
      'This MOBI uses HUFF/CDIC compression, which is not supported. Convert it to EPUB first.'
    );
  }
  if (compression !== 1 && compression !== 2) {
    throw new Error(`Unsupported MOBI compression type ${compression}`);
  }

  // Title lives in the MOBI header, at an offset relative to record 0.
  let title = '';
  const mobiMagic = String.fromCharCode(
    ...bytes.subarray(head + 16, head + 20)
  );
  if (mobiMagic === 'MOBI') {
    const titleOffset = view.getUint32(head + 0x54);
    const titleLength = view.getUint32(head + 0x58);
    if (titleLength > 0 && titleLength < 1024) {
      title = new TextDecoder('utf-8').decode(
        bytes.subarray(head + titleOffset, head + titleOffset + titleLength)
      );
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; i <= textRecordCount && i < records.length; i++) {
    const rec = records[i]!;
    const raw = bytes.subarray(rec.offset, rec.offset + rec.length);
    const piece = compression === 2 ? palmDocDecompress(raw) : raw;
    chunks.push(piece);
    total += piece.length;
    if (total >= textLength) break;
  }

  const merged = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.length;
  }

  const html = new TextDecoder('utf-8', { fatal: false }).decode(
    merged.subarray(0, Math.min(textLength, merged.length))
  );
  const text = stripHtml(html);
  if (!text.trim()) {
    throw new Error('No readable text could be extracted from this book');
  }
  return { title: title.trim(), text };
}
