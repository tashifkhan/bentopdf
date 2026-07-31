/**
 * Page-stamping tools: watermarks, page numbers, headers/footers and Bates
 * numbering. They share font handling, colour parsing and corner placement, so
 * they live together.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { loadPdf, parsePageRange } from './core';
import { hexToRgb } from './structure';
import { decodeImage } from './convert';
import { canvasToBytes } from './render';

export const FONT_FAMILIES = [
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'HelveticaBold', label: 'Helvetica Bold' },
  { value: 'TimesRoman', label: 'Times Roman' },
  { value: 'TimesRomanBold', label: 'Times Roman Bold' },
  { value: 'Courier', label: 'Courier' },
  { value: 'CourierBold', label: 'Courier Bold' },
];

const FONT_MAP: Record<string, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  TimesRomanBold: StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
  CourierBold: StandardFonts.CourierBold,
};

export async function embedFont(doc: PDFDocument, name: string) {
  return doc.embedFont(FONT_MAP[name] ?? StandardFonts.Helvetica);
}

export const POSITIONS = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export type Position =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Resolve a named corner to a concrete baseline coordinate. */
export function placeText(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  position: Position,
  margin = 36
): { x: number; y: number } {
  const { width, height } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = position.endsWith('left')
    ? margin
    : position.endsWith('right')
      ? width - textWidth - margin
      : (width - textWidth) / 2;
  const y = position.startsWith('top') ? height - margin - size * 0.2 : margin;
  return { x, y };
}

/* ------------------------------------------------------------ watermark */

export type WatermarkOptions = {
  mode: 'text' | 'image';
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  opacity: number;
  angle: number;
  /** Image watermark scale as a fraction of page width. */
  imageScale: number;
  range: string;
  /** Tile the watermark across the whole page. */
  tile: boolean;
};

export async function watermarkPdf(
  file: File,
  opts: WatermarkOptions,
  image?: File
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const indices = parsePageRange(opts.range, doc.getPageCount());
  const target = new Set(indices);
  const color = hexToRgb(opts.color);

  const font =
    opts.mode === 'text' ? await embedFont(doc, opts.fontFamily) : null;
  let embeddedImage = null;
  if (opts.mode === 'image') {
    if (!image) throw new Error('Choose a watermark image');
    const canvas = await decodeImage(image);
    embeddedImage = await doc.embedPng(
      await canvasToBytes(canvas, 'image/png')
    );
  }

  doc.getPages().forEach((page, index) => {
    if (!target.has(index)) return;
    const { width, height } = page.getSize();

    if (embeddedImage) {
      const w = width * opts.imageScale;
      const h = (embeddedImage.height / embeddedImage.width) * w;
      const draw = (cx: number, cy: number) =>
        page.drawImage(embeddedImage!, {
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          opacity: opts.opacity,
          rotate: degrees(opts.angle),
        });
      if (opts.tile) {
        for (let gx = 0; gx < 3; gx++)
          for (let gy = 0; gy < 4; gy++)
            draw((width * (gx + 0.5)) / 3, (height * (gy + 0.5)) / 4);
      } else {
        draw(width / 2, height / 2);
      }
      return;
    }

    if (!font || !opts.text) return;
    const size = opts.fontSize;
    const textWidth = font.widthOfTextAtSize(opts.text, size);
    const draw = (cx: number, cy: number) =>
      page.drawText(opts.text, {
        x: cx - textWidth / 2,
        y: cy - size / 2,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity: opts.opacity,
        rotate: degrees(opts.angle),
      });
    if (opts.tile) {
      for (let gx = 0; gx < 3; gx++)
        for (let gy = 0; gy < 4; gy++)
          draw((width * (gx + 0.5)) / 3, (height * (gy + 0.5)) / 4);
    } else {
      draw(width / 2, height / 2);
    }
  });

  return doc.save();
}

/* --------------------------------------------------------- page numbers */

export type PageNumberOptions = {
  format: string;
  position: Position;
  fontFamily: string;
  fontSize: number;
  color: string;
  startAt: number;
  range: string;
  margin: number;
};

/** Supported placeholders: {n} current page, {N} total, {p} printed index. */
export function formatPageLabel(
  template: string,
  current: number,
  total: number
): string {
  if (template === 'page_only') return String(current);
  if (template === 'page_x_of_y') return `${current} / ${total}`;
  if (template === 'page_x_of_y_words') return `Page ${current} of ${total}`;
  return template
    .replace(/\{n\}/g, String(current))
    .replace(/\{N\}/g, String(total));
}

export async function pageNumbersPdf(
  file: File,
  opts: PageNumberOptions
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const font = await embedFont(doc, opts.fontFamily);
  const color = hexToRgb(opts.color);
  const pages = doc.getPages();
  const target = new Set(parsePageRange(opts.range, pages.length));
  const total = target.size;

  let printed = opts.startAt;
  pages.forEach((page, index) => {
    if (!target.has(index)) return;
    const label = formatPageLabel(
      opts.format,
      printed,
      total + opts.startAt - 1
    );
    const { x, y } = placeText(
      page,
      label,
      font,
      opts.fontSize,
      opts.position,
      opts.margin
    );
    page.drawText(label, {
      x,
      y,
      size: opts.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    });
    printed++;
  });
  return doc.save();
}

/* -------------------------------------------------------- header/footer */

export type HeaderFooterOptions = {
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  range: string;
  margin: number;
};

export async function headerFooterPdf(
  file: File,
  opts: HeaderFooterOptions
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const font = await embedFont(doc, opts.fontFamily);
  const color = hexToRgb(opts.color);
  const pages = doc.getPages();
  const target = new Set(parsePageRange(opts.range, pages.length));

  const slots: [string, Position][] = [
    [opts.headerLeft, 'top-left'],
    [opts.headerCenter, 'top-center'],
    [opts.headerRight, 'top-right'],
    [opts.footerLeft, 'bottom-left'],
    [opts.footerCenter, 'bottom-center'],
    [opts.footerRight, 'bottom-right'],
  ];

  pages.forEach((page, index) => {
    if (!target.has(index)) return;
    for (const [raw, position] of slots) {
      if (!raw.trim()) continue;
      // Allow {n}/{N} in any slot, matching the legacy tool.
      const text = formatPageLabel(raw, index + 1, pages.length);
      const { x, y } = placeText(
        page,
        text,
        font,
        opts.fontSize,
        position,
        opts.margin
      );
      page.drawText(text, {
        x,
        y,
        size: opts.fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
      });
    }
  });
  return doc.save();
}

/* ------------------------------------------------------ bates numbering */

export type BatesOptions = {
  /** Template with {n} for the counter, e.g. "ACME-{n}". */
  template: string;
  padding: number;
  start: number;
  position: Position;
  fontFamily: string;
  fontSize: number;
  color: string;
  range: string;
  margin: number;
};

export async function batesNumber(
  file: File,
  opts: BatesOptions
): Promise<Uint8Array> {
  const doc = await loadPdf(file);
  const font = await embedFont(doc, opts.fontFamily);
  const color = hexToRgb(opts.color);
  const pages = doc.getPages();
  const target = new Set(parsePageRange(opts.range, pages.length));

  let counter = opts.start;
  pages.forEach((page, index) => {
    if (!target.has(index)) return;
    const digits = String(counter).padStart(opts.padding, '0');
    const label = opts.template.includes('{n}')
      ? opts.template.replace(/\{n\}/g, digits)
      : `${opts.template}${digits}`;
    const { x, y } = placeText(
      page,
      label,
      font,
      opts.fontSize,
      opts.position,
      opts.margin
    );
    page.drawText(label, {
      x,
      y,
      size: opts.fontSize,
      font,
      color: rgb(color.r, color.g, color.b),
    });
    counter++;
  });
  return doc.save();
}
