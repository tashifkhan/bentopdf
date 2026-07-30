import type { OutFile } from '~/lib/pdf/core'

export type FieldType = 'text' | 'number' | 'select' | 'textarea'

export type ToolField = {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  defaultValue?: string
  options?: { value: string; label: string }[]
  help?: string
}

export type ProcessContext = {
  files: File[]
  values: Record<string, string>
}

export type ProcessResult = {
  files: OutFile[]
}

export type ToolProcessor = {
  /** MIME / extensions for file input */
  accept: string
  multiple: boolean
  /** Max files (optional) */
  maxFiles?: number
  fields?: ToolField[]
  /** When true, text area is primary input (txt-to-pdf etc.) */
  textPrimary?: boolean
  process: (ctx: ProcessContext) => Promise<ProcessResult>
}
