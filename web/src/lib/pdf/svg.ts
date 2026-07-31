/**
 * SVG export.
 *
 * pdf.js removed its vector SVG backend in v4, so true path-level conversion is
 * no longer available from the renderer. What this produces instead is a real,
 * standards-compliant SVG per page: the rendered artwork as an embedded image,
 * plus the original text as selectable `<text>` elements positioned from the
 * PDF text layer. That keeps search, selection and accessibility working even
 * though the artwork itself is raster.
 */
import { stem, type OutFile } from './core';
import { canvasToBytes, openWithPdfjs, renderPage } from './render';
import { extractPageText } from './text';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type SvgOptions = {
  scale: number;
  /** Include a selectable text layer over the artwork. */
  textLayer: boolean;
  /** Make the text layer visible instead of transparent (for debugging). */
  showText: boolean;
  format: 'png' | 'jpeg';
  quality: number;
};

export async function pdfToSvg(
  file: File,
  opts: SvgOptions,
  onProgress?: (message: string) => void
): Promise<OutFile[]> {
  const doc = await openWithPdfjs(file);
  const pages = opts.textLayer ? await extractPageText(file) : [];
  const base = stem(file.name);
  const out: OutFile[] = [];
  const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';

  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`Rendering page ${i} of ${doc.numPages}`);
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const width = viewport.width;
    const height = viewport.height;

    const canvas = await renderPage(doc, i, opts.scale);
    const bytes = await canvasToBytes(canvas, mime, opts.quality);
    const dataUri = `data:${mime};base64,${toBase64(bytes)}`;

    let textLayer = '';
    const source = pages.find((p) => p.pageNumber === i);
    if (opts.textLayer && source) {
      const items = source.items
        .filter((item) => item.str.trim())
        .map((item) => {
          // pdf.js text coordinates have their origin bottom-left; SVG's is
          // top-left, so flip the y axis.
          const y = height - item.y;
          const size = item.height || 10;
          return `    <text x="${item.x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}" textLength="${Math.max(item.width, 0.01).toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(item.str)}</text>`;
        })
        .join('\n');
      if (items) {
        const fill = opts.showText
          ? 'fill="#c1121f" fill-opacity="0.85"'
          : 'fill="transparent"';
        textLayer = `  <g font-family="sans-serif" ${fill}>\n${items}\n  </g>\n`;
      }
    }

    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width.toFixed(2)}" height="${height.toFixed(2)}" ` +
      `viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">\n` +
      `  <image x="0" y="0" width="${width.toFixed(2)}" height="${height.toFixed(2)}" xlink:href="${dataUri}"/>\n` +
      textLayer +
      `</svg>\n`;

    out.push({
      name: `${base}-page-${i}.svg`,
      bytes: new TextEncoder().encode(svg),
      mime: 'image/svg+xml',
    });
  }
  return out;
}
