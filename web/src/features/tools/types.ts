import type { OutFile } from '~/lib/pdf/core';

export type FieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'select'
  | 'textarea'
  | 'checkbox'
  | 'color'
  | 'range'
  | 'file';

export type ToolField = {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  help?: string;
  /** For `file` fields. */
  accept?: string;
  multiple?: boolean;
  /** For `range` / `number` fields. */
  min?: number;
  max?: number;
  step?: number;
  /** Only show this field when another field has one of these values. */
  showWhen?: { key: string; equals: string[] };
};

export type ProgressFn = (message: string, fraction?: number) => void;

export type ProcessContext = {
  files: File[];
  values: Record<string, string>;
  /** Files chosen in `file`-type fields, keyed by field key. */
  extraFiles: Record<string, File[]>;
  onProgress: ProgressFn;
};

export type ProcessResult = {
  files: OutFile[];
  /** Shown to the user after a successful run. */
  message?: string;
  /** Rendered in a preview pane instead of only downloading. */
  preview?: { title: string; text: string };
};

export type ToolProcessor = {
  /** MIME / extensions for the primary file input. */
  accept: string;
  multiple: boolean;
  minFiles?: number;
  maxFiles?: number;
  fields?: ToolField[];
  /** When true, a textarea is the primary input rather than a file drop. */
  textPrimary?: boolean;
  /** Extra context shown above the form. */
  note?: string;
  /** Warns that output is rasterized (text stops being selectable). */
  rasterizes?: boolean;
  process: (ctx: ProcessContext) => Promise<ProcessResult>;
};

/**
 * Every catalog slug resolves to one of these. `unavailable` is deliberate and
 * user-visible: a tool that cannot do its job must say so rather than silently
 * running something else.
 */
export type ToolEntry =
  | { status: 'ready'; processor: ToolProcessor }
  | { status: 'workspace'; kind: 'multi-tool' | 'merge' }
  | { status: 'unavailable'; reason: string };
