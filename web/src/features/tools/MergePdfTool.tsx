import { useMemo, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { Document, Layers, Trash, Upload } from 'reicon-react'
import { Button, StatefulButton } from '~/components/beui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/beui/tabs'
import { cn } from '~/lib/utils'

type FileEntry = {
  id: string
  file: File
  pageCount: number
  range: string
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const buffer = new Uint8Array(bytes).buffer
  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function readPageCount(file: File): Promise<number> {
  const buf = await file.arrayBuffer()
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  return doc.getPageCount()
}

function parseRange(range: string, pageCount: number): number[] {
  const trimmed = range.trim()
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i)
  const pages = new Set<number>()
  for (const part of trimmed.split(',')) {
    const p = part.trim()
    if (!p) continue
    if (p.includes('-')) {
      const [a, b] = p.split('-').map((n) => parseInt(n.trim(), 10))
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const start = Math.max(1, Math.min(a, b))
      const end = Math.min(pageCount, Math.max(a, b))
      for (let i = start; i <= end; i++) pages.add(i - 1)
    } else {
      const n = parseInt(p, 10)
      if (Number.isFinite(n) && n >= 1 && n <= pageCount) pages.add(n - 1)
    }
  }
  return [...pages].sort((x, y) => x - y)
}

export function MergePdfTool() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)

  const totalPages = useMemo(
    () => files.reduce((sum, f) => sum + f.pageCount, 0),
    [files],
  )

  async function addFiles(list: FileList | File[]) {
    const next: FileEntry[] = []
    for (const file of Array.from(list)) {
      if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) continue
      try {
        const pageCount = await readPageCount(file)
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          file,
          pageCount,
          range: '',
        })
      } catch {
        setError(`Could not read ${file.name}`)
      }
    }
    setFiles((prev) => [...prev, ...next])
  }

  async function merge() {
    if (files.length === 0) return
    setStatus('loading')
    setError(null)
    try {
      const out = await PDFDocument.create()
      for (const entry of files) {
        const src = await PDFDocument.load(await entry.file.arrayBuffer(), {
          ignoreEncryption: true,
        })
        const indices = parseRange(entry.range, entry.pageCount)
        if (indices.length === 0) continue
        const pages = await out.copyPages(src, indices)
        pages.forEach((p) => out.addPage(p))
      }
      const bytes = await out.save()
      downloadBytes(bytes, 'merged.pdf')
      setStatus('success')
      window.setTimeout(() => setStatus('idle'), 1600)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Merge failed')
      window.setTimeout(() => setStatus('idle'), 2000)
    }
  }

  return (
    <div className="surface-card mx-auto w-full max-w-xl p-4 sm:p-7">
      <header className="mb-4 sm:mb-5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Merge PDF
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Combine whole files, or pick page ranges, entirely in your browser.
        </p>
      </header>

      <label className="tool-dropzone touch-manipulation">
        <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Upload size={22} color="currentColor" />
        </span>
        <span className="text-sm font-semibold text-foreground">
          <span className="sm:hidden">Tap to choose PDFs</span>
          <span className="hidden sm:inline">Drop PDFs here or click to browse</span>
        </span>
        <span className="mt-1 text-xs text-ink-4">
          Files never leave this device
        </span>
        <input
          type="file"
          accept="application/pdf"
          multiple
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.currentTarget.value = ''
          }}
        />
      </label>

      {files.length > 0 ? (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-10 sm:min-h-0"
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'application/pdf'
                input.multiple = true
                input.onchange = () => {
                  if (input.files) void addFiles(input.files)
                }
                input.click()
              }}
            >
              <Document size={16} color="currentColor" />
              Add more
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10 sm:min-h-0"
              onClick={() => setFiles([])}
            >
              <Trash size={16} color="currentColor" />
              Clear all
            </Button>
            <span className="w-full text-xs text-ink-4 sm:ml-auto sm:w-auto sm:self-center">
              {files.length} files · {totalPages} pages
            </span>
          </div>

          <Tabs defaultValue="file" variant="segment">
            <TabsList className="w-full bg-secondary">
              <TabsTrigger value="file" className="flex-1">
                File mode
              </TabsTrigger>
              <TabsTrigger value="page" className="flex-1">
                Ranges
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-3 space-y-2">
              {files.map((entry, index) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-border bg-secondary p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-xs font-bold text-brand">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {entry.file.name}
                    </span>
                    <button
                      type="button"
                      className="touch-manipulation rounded-lg p-2.5 text-destructive hover:bg-destructive/10 sm:p-2"
                      onClick={() =>
                        setFiles((prev) => prev.filter((f) => f.id !== entry.id))
                      }
                      aria-label={`Remove ${entry.file.name}`}
                    >
                      <Trash size={16} color="currentColor" />
                    </button>
                  </div>
                  <label className="mt-2 block text-xs text-ink-4">
                    Pages · {entry.pageCount} total
                    <input
                      value={entry.range}
                      onChange={(e) =>
                        setFiles((prev) =>
                          prev.map((f) =>
                            f.id === entry.id
                              ? { ...f, range: e.target.value }
                              : f,
                          ),
                        )
                      }
                      placeholder="All pages (or e.g. 1-3, 5)"
                      inputMode="text"
                      className="mt-1 h-11 w-full rounded-xl border border-input bg-card px-3 py-2 text-base text-foreground outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-auto sm:text-sm"
                    />
                  </label>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="page" className="mt-3 text-sm text-muted-foreground">
              Enter page ranges per file in File mode. Example:{' '}
              <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs text-foreground">
                1-3, 5
              </code>
              . Leave blank for every page.
            </TabsContent>
          </Tabs>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <StatefulButton
            type="button"
            className={cn('min-h-11 w-full sm:min-h-0')}
            state={status}
            loadingText="Merging…"
            successText="Downloaded"
            errorText="Failed"
            onClick={() => void merge()}
          >
            <span className="inline-flex items-center gap-2">
              <Layers size={16} color="currentColor" />
              Merge PDFs
            </span>
          </StatefulButton>
        </div>
      ) : null}
    </div>
  )
}
