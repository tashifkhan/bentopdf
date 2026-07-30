import type { OutFile } from '~/lib/pdf/core';
import { stem } from '~/lib/pdf/core';
import type {
  ProcessContext,
  ProcessResult,
  ToolField,
  ToolProcessor,
} from '../types';

export { stem };

/* ------------------------------------------------------------- accepts */

export const PDF = 'application/pdf,.pdf';
export const IMAGES =
  'image/jpeg,image/png,image/webp,image/bmp,image/gif,image/svg+xml,image/tiff,image/heic,.jpg,.jpeg,.png,.webp,.bmp,.gif,.svg,.tif,.tiff,.heic,.heif';

/* ------------------------------------------------------------- results */

export function onePdf(bytes: Uint8Array, name: string): ProcessResult {
  return { files: [{ name, bytes, mime: 'application/pdf' }] };
}

export function textResult(
  name: string,
  content: string,
  mime: string,
  previewTitle?: string
): ProcessResult {
  const file: OutFile = {
    name,
    bytes: new TextEncoder().encode(content),
    mime,
  };
  return {
    files: [file],
    ...(previewTitle
      ? { preview: { title: previewTitle, text: content } }
      : {}),
  };
}

/* -------------------------------------------------------------- inputs */

export function requireFiles(ctx: ProcessContext, min = 1) {
  if (ctx.files.length < min) {
    throw new Error(
      min === 1 ? 'Add a file first' : `Add at least ${min} files`
    );
  }
}

export function first(ctx: ProcessContext): File {
  requireFiles(ctx);
  return ctx.files[0]!;
}

/** Read a required file chosen in a `file`-type field. */
export function requiredExtra(
  ctx: ProcessContext,
  key: string,
  label: string
): File {
  const file = ctx.extraFiles[key]?.[0];
  if (!file) throw new Error(`Choose ${label}`);
  return file;
}

export function extras(ctx: ProcessContext, key: string): File[] {
  return ctx.extraFiles[key] ?? [];
}

export function num(ctx: ProcessContext, key: string, fallback = 0): number {
  const parsed = parseFloat(ctx.values[key] ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function int(ctx: ProcessContext, key: string, fallback = 0): number {
  const parsed = parseInt(ctx.values[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bool(ctx: ProcessContext, key: string): boolean {
  return ctx.values[key] === 'true';
}

export function str(ctx: ProcessContext, key: string, fallback = ''): string {
  return ctx.values[key] ?? fallback;
}

/** Read the primary file as text, falling back to the textarea contents. */
export async function textInput(
  ctx: ProcessContext,
  key = 'text'
): Promise<string> {
  const typed = ctx.values[key]?.trim();
  if (typed) return ctx.values[key]!;
  const file = ctx.files[0];
  if (file) return file.text();
  throw new Error('Paste some text or add a file');
}

/* --------------------------------------------------------- field presets */

export const rangeField: ToolField = {
  key: 'range',
  label: 'Pages',
  type: 'text',
  placeholder: 'e.g. 1-3,5 (empty = all)',
  defaultValue: '',
  help: '1-based page numbers. Leave empty for all pages.',
};

export function pagesField(label: string, placeholder: string): ToolField {
  return { ...rangeField, label, placeholder };
}

export const passwordField: ToolField = {
  key: 'password',
  label: 'Password',
  type: 'password',
  defaultValue: '',
};

export function selectField(
  key: string,
  label: string,
  options: { value: string; label: string }[],
  defaultValue?: string,
  help?: string
): ToolField {
  return {
    key,
    label,
    type: 'select',
    options,
    defaultValue: defaultValue ?? options[0]?.value ?? '',
    ...(help ? { help } : {}),
  };
}

export function checkbox(
  key: string,
  label: string,
  defaultValue = false,
  help?: string
): ToolField {
  return {
    key,
    label,
    type: 'checkbox',
    defaultValue: defaultValue ? 'true' : 'false',
    ...(help ? { help } : {}),
  };
}

export function fileField(
  key: string,
  label: string,
  accept: string,
  opts: { multiple?: boolean; help?: string } = {}
): ToolField {
  return {
    key,
    label,
    type: 'file',
    accept,
    multiple: opts.multiple ?? false,
    ...(opts.help ? { help: opts.help } : {}),
  };
}

export function rangeSlider(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  help?: string
): ToolField {
  return {
    key,
    label,
    type: 'range',
    min,
    max,
    step,
    defaultValue: String(defaultValue),
    ...(help ? { help } : {}),
  };
}

/* ------------------------------------------------------------ processor */

/** Small helper so each entry reads as a declaration rather than a cast. */
export function processor(spec: ToolProcessor): ToolProcessor {
  return spec;
}

/**
 * Build an output filename from the input, e.g. report.pdf → report-signed.pdf.
 * An empty suffix just swaps the extension: report.pdf → report.md
 */
export function derive(file: File, suffix: string, ext = 'pdf'): string {
  const base = stem(file.name);
  return suffix ? `${base}-${suffix}.${ext}` : `${base}.${ext}`;
}
