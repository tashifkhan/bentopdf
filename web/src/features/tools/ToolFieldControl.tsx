import { useMemo } from 'react'
import { Checkbox } from '~/components/beui/checkbox'
import {
  FileUpload,
  createFileUploadItem,
  filesFromUploadItems,
} from '~/components/beui/file-upload'
import { Input } from '~/components/beui/input'
import { RangeSlider } from '~/components/beui/range-slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/beui/select'
import { Textarea } from '~/components/beui/textarea'
import type { ToolField } from './types'

/**
 * Shared beUI-backed field control used by ToolWorkspace and WorkflowPage.
 * Keeps every catalog tool option on the same select / checkbox / slider /
 * input components (no native browser widgets).
 */
export function ToolFieldControl({
  field,
  value,
  files = [],
  onChange,
  onFiles,
  compact = false,
}: {
  field: ToolField
  value: string
  files?: File[]
  onChange: (v: string) => void
  onFiles?: (files: File[]) => void
  /** Tighter layout for multi-column workflow step cards. */
  compact?: boolean
}) {
  const id = `field-${field.key}`
  const labelClass = compact
    ? 'mb-1 block text-[11px] font-semibold text-muted-foreground'
    : 'mb-1.5 block text-xs font-semibold text-muted-foreground'
  const helpClass = 'mt-1 block text-[11px] text-ink-4'

  if (field.type === 'checkbox') {
    return (
      <Checkbox
        id={id}
        checked={value === 'true'}
        onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
        label={
          <span>
            <span className="block text-sm font-medium text-foreground">
              {field.label}
            </span>
            {field.help ? (
              <span className="mt-0.5 block text-[11px] font-normal text-ink-4">
                {field.help}
              </span>
            ) : null}
          </span>
        }
      />
    )
  }

  if (field.type === 'select') {
    return (
      <div className="block">
        <span className={labelClass}>{field.label}</span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className={compact ? 'h-9' : undefined}>
            <SelectValue placeholder={field.placeholder ?? 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.help ? <span className={helpClass}>{field.help}</span> : null}
      </div>
    )
  }

  if (field.type === 'range') {
    const num = Number(value)
    const safe = Number.isFinite(num) ? num : Number(field.defaultValue ?? 0)
    return (
      <div className="block">
        <span className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            {field.label}
          </span>
          <span className="text-[11px] tabular-nums text-accent">{value}</span>
        </span>
        <RangeSlider
          value={safe}
          min={field.min}
          max={field.max}
          step={field.step}
          onValueChange={(v) => onChange(String(v))}
          aria-label={field.label}
          className={compact ? 'h-8' : undefined}
        />
        {field.help ? <span className={helpClass}>{field.help}</span> : null}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="block">
        <Textarea
          id={id}
          label={field.label}
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
          rows={compact ? 4 : 8}
          fieldClassName={compact ? undefined : 'font-mono'}
        />
        {field.help ? <span className={helpClass}>{field.help}</span> : null}
      </div>
    )
  }

  if (field.type === 'color') {
    return (
      <div className="block">
        <span className={labelClass}>{field.label}</span>
        <span className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={value || '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-xl border border-border bg-card p-1"
          />
          <Input
            value={value}
            onChange={onChange}
            className="min-w-0 flex-1"
            classNames={{ root: 'gap-0' }}
          />
        </span>
        {field.help ? <span className={helpClass}>{field.help}</span> : null}
      </div>
    )
  }

  if (field.type === 'file') {
    return (
      <FileField
        label={field.label}
        help={field.help}
        accept={field.accept}
        multiple={field.multiple}
        files={files}
        onFiles={onFiles}
        compact={compact}
      />
    )
  }

  return (
    <div className="block">
      <Input
        id={id}
        label={field.label}
        type={
          field.type === 'number'
            ? 'number'
            : field.type === 'password'
              ? 'password'
              : 'text'
        }
        value={value}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={onChange}
        placeholder={field.placeholder}
        classNames={compact ? { field: 'h-9' } : undefined}
      />
      {field.help ? <span className={helpClass}>{field.help}</span> : null}
    </div>
  )
}

function FileField({
  label,
  help,
  accept,
  multiple,
  files,
  onFiles,
  compact,
}: {
  label: string
  help?: string
  accept?: string
  multiple?: boolean
  files: File[]
  onFiles?: (files: File[]) => void
  compact?: boolean
}) {
  // Dropzone-only when parent owns the list via `files`; rebuild items from
  // the File objects so remove/add stay in sync with the tool processor.
  const items = useMemo(
    () =>
      files.map((file, index) =>
        createFileUploadItem(file, index, 'success'),
      ),
    [files],
  )

  return (
    <div className="block">
      <span
        className={
          compact
            ? 'mb-1 block text-[11px] font-semibold text-muted-foreground'
            : 'mb-1.5 block text-xs font-semibold text-muted-foreground'
        }
      >
        {label}
      </span>
      <FileUpload
        value={items}
        onValueChange={(next) => {
          onFiles?.(filesFromUploadItems(next))
        }}
        accept={accept}
        multiple={multiple}
        maxFiles={multiple ? undefined : 1}
        itemStatus="success"
        variant={compact ? 'default' : 'centered'}
        title={multiple ? 'Drop files here' : 'Drop a file here'}
        description="Stays on this device"
        browseLabel="Browse"
        classNames={
          compact
            ? { dropzone: 'min-h-0 rounded-2xl p-3' }
            : undefined
        }
      />
      {help ? (
        <span className="mt-1 block text-[11px] text-ink-4">{help}</span>
      ) : null}
    </div>
  )
}
