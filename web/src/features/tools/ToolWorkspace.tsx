import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Trash,
  Upload,
} from 'reicon-react'
import { Button, StatefulButton } from '~/components/beui/button'
import { Checkbox } from '~/components/beui/checkbox'
import { Input } from '~/components/beui/input'
import { RangeSlider } from '~/components/beui/range-slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/beui/select'
import { ToolIcon } from '~/components/icons'
import type { Tool } from '~/data/tools'
import { downloadFiles } from '~/lib/pdf/core'
import { cn } from '~/lib/utils'
import { getToolEntry } from './processors'
import type { ProcessResult, ToolField, ToolProcessor } from './types'

export function ToolWorkspace({ tool }: { tool: Tool }) {
  const entry = useMemo(() => getToolEntry(tool.slug), [tool.slug])

  if (entry.status === 'unavailable') {
    return <UnavailableTool tool={tool} reason={entry.reason} />
  }
  if (entry.status === 'workspace') {
    // Routed to a dedicated page upstream; nothing to render here.
    return null
  }
  return <ReadyTool tool={tool} processor={entry.processor} />
}

/* --------------------------------------------------------- unavailable */

function UnavailableTool({ tool, reason }: { tool: Tool; reason: string }) {
  return (
    <div className="surface-card mx-auto w-full max-w-xl p-5 sm:p-7">
      <ToolHeader tool={tool} />
      <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-amber-500">
            <AlertTriangle size={18} color="currentColor" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Not available in this build
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-4">
        This tool is listed because it exists in the catalog. Rather than run a
        different operation and hand you the wrong file, it does nothing.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- ready */

function ToolHeader({ tool }: { tool: Tool }) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
        <ToolIcon name={tool.icon} size={22} />
      </span>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {tool.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{tool.subtitle}</p>
      </div>
    </header>
  )
}

function ReadyTool({
  tool,
  processor,
}: {
  tool: Tool
  processor: ToolProcessor
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [extraFiles, setExtraFiles] = useState<Record<string, File[]>>({})
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const field of processor.fields ?? []) {
      init[field.key] = field.defaultValue ?? ''
    }
    return init
  })
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [dragging, setDragging] = useState(false)

  const addFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list?.length) return
      const next = Array.from(list)
      setFiles((prev) =>
        processor.multiple ? [...prev, ...next] : next.slice(0, 1),
      )
      setError(null)
    },
    [processor.multiple],
  )

  const visibleFields = (processor.fields ?? []).filter((field) => {
    if (!field.showWhen) return true
    return field.showWhen.equals.includes(values[field.showWhen.key] ?? '')
  })

  const run = async () => {
    setStatus('loading')
    setError(null)
    setResult(null)
    setProgress(null)
    try {
      const output = await processor.process({
        files,
        values,
        extraFiles,
        onProgress: (message) => setProgress(message),
      })
      if (!output.files.length) throw new Error('No output was produced')
      downloadFiles(output.files)
      setResult(output)
      setStatus('success')
      window.setTimeout(() => setStatus('idle'), 1800)
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Processing failed')
      setStatus('error')
      window.setTimeout(() => setStatus('idle'), 2400)
    } finally {
      setProgress(null)
    }
  }

  const minFiles = processor.minFiles ?? 1
  const needsFiles = !processor.textPrimary
  const canRun = !needsFiles || files.length >= minFiles

  return (
    <div className="surface-card mx-auto w-full max-w-xl p-5 sm:p-7">
      <ToolHeader tool={tool} />

      {processor.note ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-secondary/50 px-3 py-2.5">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            <AlertCircle size={15} color="currentColor" />
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {processor.note}
          </p>
        </div>
      ) : null}

      {processor.rasterizes ? (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Output is rasterized — text in the result will not be selectable.
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={processor.accept}
        multiple={processor.multiple}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        tabIndex={-1}
        onChange={(e) => {
          addFiles(e.target.files)
          e.currentTarget.value = ''
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        className={cn(
          'tool-dropzone mt-5',
          dragging && 'border-brand bg-brand-soft/40',
        )}
      >
        <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Upload size={22} color="currentColor" />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {processor.textPrimary
            ? 'Optional: drop a file instead of pasting'
            : processor.multiple
              ? 'Drop files here or click to browse'
              : 'Drop a file here or click to browse'}
        </span>
        <span className="mt-1 text-xs text-ink-4">
          Files never leave this device
        </span>
      </div>

      {files.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {file.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash size={14} color="currentColor" />
              </button>
            </li>
          ))}
          {processor.multiple ? (
            <li>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => inputRef.current?.click()}
              >
                Add more
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}

      {visibleFields.length > 0 ? (
        <div className="mt-5 space-y-4">
          {visibleFields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              files={extraFiles[field.key] ?? []}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              onFiles={(list) =>
                setExtraFiles((prev) => ({ ...prev, [field.key]: list }))
              }
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {progress ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {progress}…
        </p>
      ) : null}

      {result?.message && status !== 'error' ? (
        <p className="mt-4 rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm text-muted-foreground">
          {result.message}
        </p>
      ) : null}

      {result?.preview ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            {result.preview.title}
          </p>
          <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed text-foreground">
            {result.preview.text}
          </pre>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <StatefulButton
          type="button"
          state={status}
          loadingText={progress ?? 'Working…'}
          successText="Done"
          errorText="Failed"
          disabled={status === 'loading' || !canRun}
          onClick={() => void run()}
          className="min-w-[8rem]"
        >
          <span className="inline-flex items-center gap-1.5">
            <Download size={16} color="currentColor" />
            Run & download
          </span>
        </StatefulButton>
        {files.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setFiles([])
              setError(null)
              setResult(null)
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* --------------------------------------------------------------- fields */

function Field({
  field,
  value,
  files,
  onChange,
  onFiles,
}: {
  field: ToolField
  value: string
  files: File[]
  onChange: (v: string) => void
  onFiles: (files: File[]) => void
}) {
  const id = `field-${field.key}`

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
        <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {field.label}
        </span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
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
        {field.help ? (
          <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
        ) : null}
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
        />
        {field.help ? (
          <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
        ) : null}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return (
      <label className="block" htmlFor={id}>
        <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {field.label}
        </span>
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={8}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/30"
        />
        {field.help ? (
          <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
        ) : null}
      </label>
    )
  }

  if (field.type === 'color') {
    return (
      <div className="block">
        <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {field.label}
        </span>
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
        {field.help ? (
          <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
        ) : null}
      </div>
    )
  }

  if (field.type === 'file') {
    return (
      <label className="block" htmlFor={id}>
        <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          {field.label}
        </span>
        <input
          id={id}
          type="file"
          accept={field.accept}
          multiple={field.multiple}
          onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
          className="block w-full cursor-pointer rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-accent"
        />
        {files.length > 0 ? (
          <span className="mt-1.5 block truncate text-[11px] text-ink-4">
            {files.map((f) => f.name).join(', ')}
          </span>
        ) : null}
        {field.help ? (
          <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
        ) : null}
      </label>
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
      />
      {field.help ? (
        <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
      ) : null}
    </div>
  )
}
