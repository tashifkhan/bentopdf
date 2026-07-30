import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, Upload, Trash } from 'reicon-react'
import { Button, StatefulButton } from '~/components/beui/button'
import { ToolIcon } from '~/components/icons'
import type { Tool } from '~/data/tools'
import { downloadFiles } from '~/lib/pdf/core'
import { cn } from '~/lib/utils'
import { getProcessor } from './processors'
import type { ToolField } from './types'

export function ToolWorkspace({ tool }: { tool: Tool }) {
  const processor = useMemo(() => getProcessor(tool.slug), [tool.slug])
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const f of processor.fields || []) {
      init[f.key] = f.defaultValue ?? ''
    }
    return init
  })
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)
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

  const run = async () => {
    setStatus('loading')
    setError(null)
    try {
      const result = await processor.process({ files, values })
      if (!result.files.length) throw new Error('No output produced')
      downloadFiles(result.files)
      setStatus('success')
      window.setTimeout(() => setStatus('idle'), 1600)
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Processing failed')
      setStatus('error')
      window.setTimeout(() => setStatus('idle'), 2200)
    }
  }

  const fields = processor.fields || []

  return (
    <div className="surface-card mx-auto w-full max-w-xl p-5 sm:p-7">
      <header className="mb-5 flex items-start gap-3">
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

      {!processor.textPrimary ? (
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
            'tool-dropzone',
            dragging && 'border-brand bg-brand-soft/40',
          )}
        >
          <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Upload size={22} color="currentColor" />
          </span>
          <span className="text-sm font-semibold text-foreground">
            Drop files here or click to browse
          </span>
          <span className="mt-1 text-xs text-ink-4">
            Files never leave this device
          </span>
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {f.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {(f.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${f.name}`}
                onClick={() =>
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }
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

      {fields.length > 0 ? (
        <div className="mt-5 space-y-3">
          {fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, [field.key]: v }))
              }
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-center text-sm text-destructive">{error}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <StatefulButton
          type="button"
          state={status}
          loadingText="Working…"
          successText="Done"
          errorText="Failed"
          disabled={
            status === 'loading' ||
            (!processor.textPrimary && files.length === 0)
          }
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
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: ToolField
  value: string
  onChange: (v: string) => void
}) {
  const id = `field-${field.key}`
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
        {field.label}
      </span>
      {field.type === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-brand"
        >
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={8}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
        />
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-brand"
        />
      )}
      {field.help ? (
        <span className="mt-1 block text-[11px] text-ink-4">{field.help}</span>
      ) : null}
    </label>
  )
}
