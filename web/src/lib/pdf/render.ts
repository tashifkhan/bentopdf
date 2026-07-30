import { PDFDocument } from 'pdf-lib';
import { getPdfjs, stem, type OutFile } from './core';

/** A loaded pdf.js document. pdf.js has no exported doc type we can name cheaply. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfjsDoc = any;

export async function openWithPdfjs(
  file: File | Uint8Array
): Promise<PdfjsDoc> {
  const pdfjs = await getPdfjs();
  const data =
    file instanceof File
      ? await file.arrayBuffer()
      : (file.slice().buffer as ArrayBuffer);
  return pdfjs.getDocument({ data }).promise;
}

export function newCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable in this browser');
  return { canvas, ctx };
}

/** Render one 1-based page to a fresh canvas. */
export async function renderPage(
  doc: PdfjsDoc,
  pageNumber: number,
  scale = 1.5
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const { canvas, ctx } = newCanvas(viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

export async function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime = 'image/jpeg',
  quality = 0.92
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality)
  );
  if (!blob) throw new Error(`Browser cannot encode ${mime}`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** True when the browser actually honours a codec (Safari lacks webp export on older versions). */
export function supportsMime(mime: string): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL(mime).startsWith(`data:${mime}`);
}

/**
 * Render every page, let `edit` mutate the pixels, and rebuild a PDF from the
 * result. This is the shared engine behind invert / greyscale / scanner effect /
 * colour adjustment / rasterize.
 */
export async function rasterizePdf(
  file: File,
  opts: {
    scale?: number;
    quality?: number;
    edit?: (data: ImageData, ctx: CanvasRenderingContext2D) => void;
  } = {}
): Promise<Uint8Array> {
  const { scale = 1.5, quality = 0.9, edit } = opts;
  const doc = await openWithPdfjs(file);
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = await renderPage(doc, i, scale);
    if (edit) {
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      edit(data, ctx);
      ctx.putImageData(data, 0, 0);
    }
    const bytes = await canvasToBytes(canvas, 'image/jpeg', quality);
    const img = await out.embedJpg(bytes);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  if (out.getPageCount() === 0) throw new Error('The PDF has no pages');
  return out.save();
}

/** Render every page to image files in an arbitrary browser-supported codec. */
export async function pdfToImageFiles(
  file: File,
  mime: string,
  ext: string,
  scale = 2,
  quality = 0.92
): Promise<OutFile[]> {
  const doc = await openWithPdfjs(file);
  const base = stem(file.name);
  const out: OutFile[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = await renderPage(doc, i, scale);
    out.push({
      name: `${base}-page-${i}.${ext}`,
      bytes: await canvasToBytes(canvas, mime, quality),
      mime,
    });
  }
  return out;
}

/** Minimal uncompressed 24-bit BMP encoder — no browser supports image/bmp export. */
export function canvasToBmp(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const src = ctx.getImageData(0, 0, width, height).data;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  // BMP rows run bottom-up and store BGR.
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      bytes[dst++] = src[s + 2]!;
      bytes[dst++] = src[s + 1]!;
      bytes[dst++] = src[s]!;
    }
  }
  return bytes;
}
