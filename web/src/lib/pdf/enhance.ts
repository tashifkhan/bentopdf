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
  /** Degrees, -180..180. */
  hueShift: number;
  /** -100..100; positive is warmer. */
  temperature: number;
  /** -100..100; positive is greener. */
  tint: number;
  gamma: number;
  /** 0..1 sepia blend. */
  sepia: number;
};

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Full colour pipeline: brightness → contrast → temp/tint → saturation → hue → gamma → sepia. */
export function adjustPdfColors(
  file: File,
  adj: ColorAdjustments
): Promise<Uint8Array> {
  // Standard contrast factor curve, centred on mid-grey.
  const contrast = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
  const gamma = adj.gamma > 0 ? 1 / adj.gamma : 1;
  const hue = (adj.hueShift * Math.PI) / 180;
  const cosH = Math.cos(hue);
  const sinH = Math.sin(hue);

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

        // Temperature shifts red against blue; tint shifts green.
        r += adj.temperature * 0.6;
        b -= adj.temperature * 0.6;
        g += adj.tint * 0.6;

        const grey = 0.299 * r + 0.587 * g + 0.114 * b;
        r = grey + (r - grey) * adj.saturation;
        g = grey + (g - grey) * adj.saturation;
        b = grey + (b - grey) * adj.saturation;

        if (adj.hueShift !== 0) {
          // Luminance-preserving hue rotation matrix.
          const m0 = 0.213 + cosH * 0.787 - sinH * 0.213;
          const m1 = 0.715 - cosH * 0.715 - sinH * 0.715;
          const m2 = 0.072 - cosH * 0.072 + sinH * 0.928;
          const m3 = 0.213 - cosH * 0.213 + sinH * 0.143;
          const m4 = 0.715 + cosH * 0.285 + sinH * 0.14;
          const m5 = 0.072 - cosH * 0.072 - sinH * 0.283;
          const m6 = 0.213 - cosH * 0.213 - sinH * 0.787;
          const m7 = 0.715 - cosH * 0.715 + sinH * 0.715;
          const m8 = 0.072 + cosH * 0.928 + sinH * 0.072;
          const nr = r * m0 + g * m1 + b * m2;
          const ng = r * m3 + g * m4 + b * m5;
          const nb = r * m6 + g * m7 + b * m8;
          r = nr;
          g = ng;
          b = nb;
        }

        if (adj.gamma !== 1) {
          r = 255 * Math.pow(Math.max(r, 0) / 255, gamma);
          g = 255 * Math.pow(Math.max(g, 0) / 255, gamma);
          b = 255 * Math.pow(Math.max(b, 0) / 255, gamma);
        }

        if (adj.sepia > 0) {
          const sr = 0.393 * r + 0.769 * g + 0.189 * b;
          const sg = 0.349 * r + 0.686 * g + 0.168 * b;
          const sb = 0.272 * r + 0.534 * g + 0.131 * b;
          r += (sr - r) * adj.sepia;
          g += (sg - g) * adj.sepia;
          b += (sb - b) * adj.sepia;
        }

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
  greyscale: boolean;
  /** Blur radius in pixels; softens like a cheap scanner lens. */
  blur: number;
  /** Random page skew, in degrees. */
  rotateVariance: number;
  brightness: number;
  contrast: number;
  /** Dark scan edge, in pixels. */
  border: number;
  /** Render scale — the effective scan resolution. */
  scale: number;
};

/** Make a clean digital PDF look like a photocopy/scan. */
export function scannerEffect(
  file: File,
  opts: ScannerOptions
): Promise<Uint8Array> {
  const contrast =
    (259 * (opts.contrast + 255)) / (255 * (259 - opts.contrast));
  return rasterizePdf(file, {
    quality: 0.8,
    scale: opts.scale,
    edit: (image, ctx) => {
      const d = image.data;
      const threshold = 128 + (1 - opts.strength) * 60;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i]! + opts.brightness;
        let g = d[i + 1]! + opts.brightness;
        let b = d[i + 2]! + opts.brightness;
        r = contrast * (r - 128) + 128;
        g = contrast * (g - 128) + 128;
        b = contrast * (b - 128) + 128;

        let grey = 0.299 * r + 0.587 * g + 0.114 * b;
        grey = grey + (grey - threshold) * opts.strength;
        if (opts.grain > 0) grey += (Math.random() - 0.5) * opts.grain * 40;

        if (opts.greyscale) {
          const v = clamp(grey);
          r = v;
          g = v;
          b = v;
        } else {
          const shift = grey - (0.299 * r + 0.587 * g + 0.114 * b);
          r += shift;
          g += shift;
          b += shift;
        }

        d[i] = clamp(r + opts.yellowing * 18);
        d[i + 1] = clamp(g + opts.yellowing * 10);
        d[i + 2] = clamp(b - opts.yellowing * 8);
      }
      ctx.putImageData(image, 0, 0);

      if (opts.blur > 0) {
        // Re-draw through a canvas filter; cheaper and better than a manual kernel.
        ctx.filter = `blur(${opts.blur}px)`;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
      }

      if (opts.border > 0) {
        ctx.strokeStyle = 'rgba(40,40,40,0.85)';
        ctx.lineWidth = opts.border;
        ctx.strokeRect(
          opts.border / 2,
          opts.border / 2,
          ctx.canvas.width - opts.border,
          ctx.canvas.height - opts.border
        );
      }

      // Copy the mutated canvas back so rasterizePdf's putImageData is a no-op.
      const refreshed = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height
      );
      image.data.set(refreshed.data);
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
