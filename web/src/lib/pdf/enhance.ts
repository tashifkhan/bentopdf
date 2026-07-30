import { PDFDocument } from 'pdf-lib';
import {
  canvasToBytes,
  newCanvas,
  openWithPdfjs,
  rasterizePdf,
  renderPage,
} from './render';

/* ------------------------------------------------------ colour adjust */

export type ColorAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
};

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Brightness / contrast / saturation, each expressed as a multiplier or offset. */
export function adjustPdfColors(
  file: File,
  adj: ColorAdjustments
): Promise<Uint8Array> {
  // Standard contrast factor curve, centred on mid-grey.
  const contrast = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
  return rasterizePdf(file, {
    edit: (image) => {
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i]! + adj.brightness;
        let g = d[i + 1]! + adj.brightness;
        let b = d[i + 2]! + adj.brightness;

        r = contrast * (r - 128) + 128;
        g = contrast * (g - 128) + 128;
        b = contrast * (b - 128) + 128;

        const grey = 0.299 * r + 0.587 * g + 0.114 * b;
        r = grey + (r - grey) * adj.saturation;
        g = grey + (g - grey) * adj.saturation;
        b = grey + (b - grey) * adj.saturation;

        d[i] = clamp(r);
        d[i + 1] = clamp(g);
        d[i + 2] = clamp(b);
      }
    },
  });
}

/* ---------------------------------------------------- scanner effect */

export type ScannerOptions = {
  /** 0-1: how strongly to push toward pure black/white. */
  strength: number;
  grain: number;
  yellowing: number;
};

/** Make a clean digital PDF look like a photocopy/scan. */
export function scannerEffect(
  file: File,
  opts: ScannerOptions
): Promise<Uint8Array> {
  return rasterizePdf(file, {
    quality: 0.8,
    edit: (image) => {
      const d = image.data;
      const threshold = 128 + (1 - opts.strength) * 60;
      for (let i = 0; i < d.length; i += 4) {
        let grey = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

        // Push contrast around the threshold to mimic scanner tone response.
        grey = grey + (grey - threshold) * opts.strength;
        if (opts.grain > 0) grey += (Math.random() - 0.5) * opts.grain * 40;

        const value = clamp(grey);
        d[i] = clamp(value + opts.yellowing * 18);
        d[i + 1] = clamp(value + opts.yellowing * 10);
        d[i + 2] = clamp(value - opts.yellowing * 8);
      }
    },
  });
}

/* -------------------------------------------------------- text colour */

/**
 * Recolour dark (text) pixels while leaving light background alone.
 * This rasterizes the document — vector text is not preserved.
 */
export function recolorText(
  file: File,
  color: { r: number; g: number; b: number },
  darknessThreshold = 128
): Promise<Uint8Array> {
  const target = {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
  };
  return rasterizePdf(file, {
    edit: (image) => {
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        const grey = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
        if (grey < darknessThreshold) {
          // Blend by how dark the pixel is, so antialiased edges stay smooth.
          const weight = 1 - grey / darknessThreshold;
          d[i] = clamp(d[i]! * (1 - weight) + target.r * weight);
          d[i + 1] = clamp(d[i + 1]! * (1 - weight) + target.g * weight);
          d[i + 2] = clamp(d[i + 2]! * (1 - weight) + target.b * weight);
        }
      }
    },
  });
}

/* ------------------------------------------------------------ deskew */

/**
 * Estimate page skew by rotating candidate angles and scoring the variance of
 * the horizontal ink projection — text lines align at the correct angle, which
 * maximises that variance.
 */
export function estimateSkew(
  canvas: HTMLCanvasElement,
  maxAngle = 10,
  step = 0.25
): number {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  // Downsample to a binary ink map to keep the search cheap.
  const sample = 2;
  const w = Math.floor(width / sample);
  const h = Math.floor(height / sample);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * sample * width + x * sample) * 4;
      const grey =
        0.299 * data[src]! + 0.587 * data[src + 1]! + 0.114 * data[src + 2]!;
      ink[y * w + x] = grey < 160 ? 1 : 0;
    }
  }

  const score = (angle: number): number => {
    const tan = Math.tan((angle * Math.PI) / 180);
    const rows = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink[y * w + x]) continue;
        const shifted = y + Math.round((x - w / 2) * tan);
        if (shifted >= 0 && shifted < h) rows[shifted]! += 1;
      }
    }
    let mean = 0;
    for (let i = 0; i < h; i++) mean += rows[i]!;
    mean /= h;
    let variance = 0;
    for (let i = 0; i < h; i++) {
      const diff = rows[i]! - mean;
      variance += diff * diff;
    }
    return variance;
  };

  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -maxAngle; angle <= maxAngle; angle += step) {
    const value = score(angle);
    if (value > bestScore) {
      bestScore = value;
      bestAngle = angle;
    }
  }

  // Quantisation noise makes some non-zero angle win by a hair on pages that
  // are already straight. Only correct when it is a clear improvement.
  const straightScore = score(0);
  if (bestScore < straightScore * 1.02) return 0;
  return bestAngle;
}

/** Straighten scanned pages, either automatically or by a fixed angle. */
export async function deskewPdf(
  file: File,
  opts: { angle?: number; auto: boolean; scale?: number } = { auto: true }
): Promise<{ bytes: Uint8Array; angles: number[] }> {
  const scale = opts.scale ?? 1.5;
  const source = await openWithPdfjs(file);
  const out = await PDFDocument.create();
  const angles: number[] = [];

  for (let i = 1; i <= source.numPages; i++) {
    const canvas = await renderPage(source, i, scale);
    const angle = opts.auto ? estimateSkew(canvas) : (opts.angle ?? 0);
    angles.push(angle);

    const { canvas: rotated, ctx } = newCanvas(canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rotated.width, rotated.height);
    ctx.translate(rotated.width / 2, rotated.height / 2);
    // `estimateSkew` returns the shear that flattens the text lines, which is
    // already the negation of the page tilt — so rotate by it directly.
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

    const bytes = await canvasToBytes(rotated, 'image/jpeg', 0.9);
    const img = await out.embedJpg(bytes);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  return { bytes: await out.save(), angles };
}
