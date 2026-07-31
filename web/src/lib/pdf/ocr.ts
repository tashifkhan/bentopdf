/**
 * OCR via tesseract.js.
 *
 * The document itself never leaves the device — only the language model is
 * fetched (from the tesseract.js CDN by default, overridable via
 * VITE_TESSERACT_LANG_PATH for fully offline deployments).
 */
import { PDFDocument } from 'pdf-lib';
import { loadPdf, stem, type OutFile } from './core';
import { openWithPdfjs, renderPage } from './render';

export const OCR_LANGUAGES: { value: string; label: string }[] = [
  { value: 'eng', label: 'English' },
  { value: 'ara', label: 'Arabic' },
  { value: 'chi_sim', label: 'Chinese (Simplified)' },
  { value: 'chi_tra', label: 'Chinese (Traditional)' },
  { value: 'nld', label: 'Dutch' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'hin', label: 'Hindi' },
  { value: 'ita', label: 'Italian' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'kor', label: 'Korean' },
  { value: 'pol', label: 'Polish' },
  { value: 'por', label: 'Portuguese' },
  { value: 'rus', label: 'Russian' },
  { value: 'spa', label: 'Spanish' },
  { value: 'swe', label: 'Swedish' },
  { value: 'tur', label: 'Turkish' },
  { value: 'ukr', label: 'Ukrainian' },
  { value: 'vie', label: 'Vietnamese' },
];

type ProgressFn = (message: string, fraction: number) => void;

export type OcrTuning = {
  /** Hard black/white threshold before recognition. */
  binarize?: boolean;
  /** Restrict recognition to these characters. */
  whitelist?: string;
};

/** Apply pre-processing that helps tesseract on poor scans. */
function preprocess(canvas: HTMLCanvasElement, binarize?: boolean) {
  if (!binarize) return canvas;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const v = g < 160 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function createOcrWorker(
  language: string,
  onProgress?: ProgressFn,
  whitelist?: string
) {
  if (typeof window === 'undefined') {
    throw new Error('OCR is only available in the browser');
  }
  const { createWorker } = await import('tesseract.js');
  const langPath = import.meta.env.VITE_TESSERACT_LANG_PATH as
    | string
    | undefined;
  return createWorker(language, 1, {
    ...(langPath ? { langPath } : {}),
    logger: (m: { status: string; progress: number }) => {
      onProgress?.(m.status, m.progress);
    },
  }).then(async (worker) => {
    if (whitelist) {
      await worker.setParameters({ tessedit_char_whitelist: whitelist });
    }
    return worker;
  });
}

/**
 * Add a searchable, invisible text layer over the existing page content.
 * The original vector/image content is preserved — we only overlay text.
 */
export async function ocrPdf(
  file: File,
  language: string,
  opts: { scale?: number; onProgress?: ProgressFn } & OcrTuning = {}
): Promise<Uint8Array> {
  const { scale = 2, onProgress } = opts;
  const worker = await createOcrWorker(language, onProgress, opts.whitelist);
  try {
    const rendered = await openWithPdfjs(file);
    const original = await loadPdf(file);
    const out = await PDFDocument.create();
    const pageCount = rendered.numPages;

    for (let i = 1; i <= pageCount; i++) {
      onProgress?.(
        `Recognising page ${i} of ${pageCount}`,
        (i - 1) / pageCount
      );
      const canvas = preprocess(
        await renderPage(rendered, i, scale),
        opts.binarize
      );
      const { data } = await worker.recognize(
        canvas,
        {},
        { pdf: true, text: false, hocr: false, tsv: false, blocks: false }
      );

      const [copied] = await out.copyPages(original, [i - 1]);
      const page = out.addPage(copied);

      if (data.pdf && data.pdf.length > 0) {
        try {
          // Tesseract's PDF holds the invisible text layer; stamp it on top so
          // selection and search line up with the original artwork.
          const layerDoc = await PDFDocument.load(Uint8Array.from(data.pdf), {
            ignoreEncryption: true,
          });
          const embedded = await out.embedPage(layerDoc.getPage(0));
          page.drawPage(embedded, {
            x: 0,
            y: 0,
            width: page.getWidth(),
            height: page.getHeight(),
            opacity: 1,
          });
        } catch {
          // A page whose text layer will not embed still keeps its content.
        }
      }
    }
    onProgress?.('Finishing', 1);
    return out.save();
  } finally {
    await worker.terminate();
  }
}

/** Plain-text OCR output for scanned documents with no text layer. */
export async function ocrToText(
  file: File,
  language: string,
  opts: { scale?: number; onProgress?: ProgressFn } & OcrTuning = {}
): Promise<string> {
  const { scale = 2, onProgress } = opts;
  const worker = await createOcrWorker(language, onProgress, opts.whitelist);
  try {
    const doc = await openWithPdfjs(file);
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(
        `Recognising page ${i} of ${doc.numPages}`,
        (i - 1) / doc.numPages
      );
      const canvas = preprocess(await renderPage(doc, i, scale), opts.binarize);
      const { data } = await worker.recognize(canvas);
      parts.push(data.text.trim());
    }
    return parts.join('\n\n');
  } finally {
    await worker.terminate();
  }
}

/** OCR loose image files straight into a searchable PDF. */
export async function ocrImagesToPdf(
  files: File[],
  language: string,
  opts: { onProgress?: ProgressFn } = {}
): Promise<OutFile> {
  const worker = await createOcrWorker(language, opts.onProgress);
  try {
    const out = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      opts.onProgress?.(
        `Recognising image ${i + 1} of ${files.length}`,
        i / files.length
      );
      const { data } = await worker.recognize(
        files[i]!,
        {},
        { pdf: true, text: false, hocr: false, tsv: false, blocks: false }
      );
      if (!data.pdf) continue;
      const pageDoc = await PDFDocument.load(Uint8Array.from(data.pdf), {
        ignoreEncryption: true,
      });
      const copied = await out.copyPages(pageDoc, pageDoc.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    if (out.getPageCount() === 0)
      throw new Error('No text could be recognised');
    return {
      name: `${stem(files[0]?.name ?? 'scan')}-ocr.pdf`,
      bytes: await out.save(),
    };
  } finally {
    await worker.terminate();
  }
}
