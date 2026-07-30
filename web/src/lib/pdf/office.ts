/**
 * LibreOffice-wasm document conversion.
 *
 * The engine is ~74 MB of wasm + data, so it is loaded lazily on first use and
 * then kept alive for the rest of the session. Assets are served from
 * /libreoffice-wasm/ (overridable with VITE_LIBREOFFICE_PATH).
 */
import type { OutFile } from './core';
import { stem } from './core';

export type ConvertProgress = (message: string, percent: number) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Converter = any;

let converterPromise: Promise<Converter> | null = null;

function basePath(): string {
  return (
    (import.meta.env.VITE_LIBREOFFICE_PATH as string | undefined) ??
    '/libreoffice-wasm/'
  );
}

/**
 * LibreOffice-wasm is a pthreads build: without SharedArrayBuffer it stalls
 * partway through startup instead of failing, so check up front and say why.
 */
function assertThreadsAvailable() {
  if (typeof SharedArrayBuffer !== 'undefined') return;
  const isolated =
    typeof globalThis.crossOriginIsolated === 'boolean'
      ? globalThis.crossOriginIsolated
      : false;
  throw new Error(
    isolated
      ? 'This browser has SharedArrayBuffer disabled, which the document conversion engine requires.'
      : 'Document conversion needs a cross-origin-isolated page, which is off by default ' +
          'because it slows down every PDF rendering tool. Rebuild with ' +
          'VITE_CROSS_ORIGIN_ISOLATION=true (and make sure any reverse proxy forwards the ' +
          'COOP/COEP headers) to enable Office conversion.'
  );
}

async function getConverter(onProgress?: ConvertProgress): Promise<Converter> {
  if (typeof window === 'undefined') {
    throw new Error('Document conversion is only available in the browser');
  }
  assertThreadsAvailable();
  if (converterPromise) {
    onProgress?.('Conversion engine ready', 100);
    return converterPromise;
  }

  converterPromise = (async () => {
    const { WorkerBrowserConverter } =
      await import('@matbee/libreoffice-converter/browser');
    const base = basePath();
    const converter = new WorkerBrowserConverter({
      sofficeJs: `${base}soffice.js`,
      sofficeWasm: `${base}soffice.wasm.gz`,
      sofficeData: `${base}soffice.data.gz`,
      sofficeWorkerJs: `${base}soffice.worker.js`,
      browserWorkerJs: `${base}browser.worker.global.js`,
      verbose: false,
      onProgress: (info: { percent: number }) => {
        onProgress?.(
          `Loading conversion engine (${Math.round(info.percent)}%)`,
          info.percent
        );
      },
    });
    await converter.initialize();
    return converter;
  })();

  try {
    return await converterPromise;
  } catch (e) {
    // Allow a retry on the next attempt rather than caching the failure.
    converterPromise = null;
    throw e;
  }
}

/** Formats LibreOffice can read and turn into a PDF. */
export const OFFICE_INPUT_FORMATS = [
  'doc',
  'docx',
  'odt',
  'rtf',
  'txt',
  'wpd',
  'wps',
  'fodt',
  'xls',
  'xlsx',
  'ods',
  'csv',
  'fods',
  'ppt',
  'pptx',
  'odp',
  'fodp',
  'odg',
  'vsd',
  'vsdx',
  'pub',
  'xps',
  'fb2',
  'epub',
  'psd',
] as const;

export function officeAccept(extensions: string[]): string {
  return extensions.map((e) => `.${e}`).join(',');
}

function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

/** Convert any LibreOffice-readable document to PDF. */
export async function officeToPdf(
  file: File,
  onProgress?: ConvertProgress
): Promise<OutFile> {
  const converter = await getConverter(onProgress);
  onProgress?.(`Converting ${file.name}`, 100);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await converter.convert(
    bytes,
    { outputFormat: 'pdf', inputFormat: extensionOf(file) },
    file.name
  );
  const data = new Uint8Array(result.data);
  if (data.length === 0) {
    throw new Error(`LibreOffice produced an empty PDF for ${file.name}`);
  }
  return {
    name: `${stem(file.name)}.pdf`,
    bytes: data,
    mime: 'application/pdf',
  };
}

/** Convert a PDF into an editable Office format (docx / xlsx / odt …). */
export async function pdfToOffice(
  file: File,
  outputFormat: string,
  onProgress?: ConvertProgress
): Promise<OutFile> {
  const converter = await getConverter(onProgress);
  onProgress?.(`Converting to ${outputFormat.toUpperCase()}`, 100);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await converter.convert(
    bytes,
    { outputFormat, inputFormat: 'pdf' },
    file.name
  );
  const data = new Uint8Array(result.data);
  if (data.length === 0) {
    throw new Error(`Could not produce a ${outputFormat.toUpperCase()} file`);
  }
  return {
    name: `${stem(file.name)}.${outputFormat}`,
    bytes: data,
    mime: result.mimeType || 'application/octet-stream',
  };
}

/** Convert several documents and return one PDF each. */
export async function officeBatchToPdf(
  files: File[],
  onProgress?: ConvertProgress
): Promise<OutFile[]> {
  const out: OutFile[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(`Converting ${i + 1} of ${files.length}`, 100);
    out.push(await officeToPdf(files[i]!, onProgress));
  }
  return out;
}
