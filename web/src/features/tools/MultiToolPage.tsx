import { Link } from '@tanstack/react-router'
import { PDFDocument, degrees } from 'pdf-lib'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  CloseCircle,
  Copy,
  Download,
  Restart,
  Trash,
  Upload,
} from 'reicon-react'
import { Button, StatefulButton } from '~/components/beui/button'
import { cn } from '~/lib/utils'

type PageItem = {
  id: string
  fileName: string
  sourceBytes: ArrayBuffer
  pageIndex: number
  rotation: number
  thumbUrl: string
  selected: boolean
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

/** Lazy-load pdf.js only in the browser (SSR has no DOMMatrix). */
async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

async function renderThumb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  pageIndex: number,
  rotation: number,
): Promise<string> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 0.35, rotation })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return canvas.toDataURL('image/jpeg', 0.72)
}

async function loadFilesToPages(
  fileList: FileList | File[],
): Promise<PageItem[]> {
  const pdfjs = await getPdfjs()
  const out: PageItem[] = []

  for (const file of Array.from(fileList)) {
    const name = file.name.toLowerCase()
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
    const isImage = file.type.startsWith('image/')

    if (isPdf) {
      const bytes = await file.arrayBuffer()
      const copy = bytes.slice(0)
      const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
      for (let i = 0; i < pdf.numPages; i++) {
        const thumbUrl = await renderThumb(pdf, i, 0)
        out.push({
          id: `${file.name}-${i}-${crypto.randomUUID()}`,
          fileName: file.name,
          sourceBytes: copy,
          pageIndex: i,
          rotation: 0,
          thumbUrl,
          selected: false,
        })
      }
    } else if (isImage) {
      const imgBytes = new Uint8Array(await file.arrayBuffer())
      const doc = await PDFDocument.create()
      let embedded
      try {
        if (file.type.includes('png') || name.endsWith('.png')) {
          embedded = await doc.embedPng(imgBytes)
        } else {
          embedded = await doc.embedJpg(imgBytes)
        }
      } catch {
        // Skip unsupported image encodings (e.g. webp without convert)
        continue
      }
      const page = doc.addPage([embedded.width, embedded.height])
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: embedded.width,
        height: embedded.height,
      })
      const pdfBytes = await doc.save()
      const ab = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ) as ArrayBuffer
      const pdf = await pdfjs.getDocument({ data: ab.slice(0) }).promise
      const thumbUrl = await renderThumb(pdf, 0, 0)
      out.push({
        id: `${file.name}-0-${crypto.randomUUID()}`,
        fileName: file.name,
        sourceBytes: ab.slice(0),
        pageIndex: 0,
        rotation: 0,
        thumbUrl,
        selected: false,
      })
    }
  }
  return out
}

export function MultiToolPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<PageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportState, setExportState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const history = useRef<PageItem[][]>([])

  const selectedCount = useMemo(
    () => pages.filter((p) => p.selected).length,
    [pages],
  )

  const pushHistory = useCallback(
    (next: PageItem[]) => {
      history.current.push(pages)
      if (history.current.length > 30) history.current.shift()
      setPages(next)
    },
    [pages],
  )

  const onFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length) return
      setLoading(true)
      setError(null)
      try {
        const loaded = await loadFilesToPages(list)
        if (loaded.length === 0) {
          setError(
            'No supported files found. Use PDF, JPG, or PNG.',
          )
        } else {
          pushHistory([...pages, ...loaded])
        }
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : 'Failed to load files')
      } finally {
        setLoading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [pages, pushHistory],
  )

  const openPicker = useCallback(() => {
    // Prefer the mounted input. Fall back to an ephemeral input so the
    // picker still opens if the ref is missing or the browser blocks
    // clicks on clipped/sr-only inputs.
    const mounted = inputRef.current
    if (mounted) {
      mounted.value = ''
      mounted.click()
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept =
      'application/pdf,image/jpeg,image/png,image/jpg,.pdf,.png,.jpg,.jpeg'
    input.multiple = true
    input.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      void onFiles(input.files)
      input.remove()
    })
    input.click()
  }, [onFiles])

  const toggleSelect = (id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)),
    )
  }

  const selectAll = () => {
    setPages((prev) => prev.map((p) => ({ ...p, selected: true })))
  }

  const selectNone = () => {
    setPages((prev) => prev.map((p) => ({ ...p, selected: false })))
  }

  const rotateSelected = (dir: 1 | -1) => {
    pushHistory(
      pages.map((p) =>
        p.selected
          ? { ...p, rotation: (p.rotation + dir * 90 + 360) % 360 }
          : p,
      ),
    )
  }

  const duplicateSelected = () => {
    const next: PageItem[] = []
    for (const p of pages) {
      next.push(p)
      if (p.selected) {
        next.push({
          ...p,
          id: `${p.id}-dup-${crypto.randomUUID()}`,
          selected: false,
        })
      }
    }
    pushHistory(next)
  }

  const deleteSelected = () => {
    if (selectedCount === 0) return
    pushHistory(pages.filter((p) => !p.selected))
  }

  const undo = () => {
    const prev = history.current.pop()
    if (prev) setPages(prev)
  }

  const addBlank = async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const bytes = await doc.save()
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const pdfjs = await getPdfjs()
    const pdf = await pdfjs.getDocument({ data: ab.slice(0) }).promise
    const thumbUrl = await renderThumb(pdf, 0, 0)
    pushHistory([
      ...pages,
      {
        id: `blank-${crypto.randomUUID()}`,
        fileName: 'blank.pdf',
        sourceBytes: ab.slice(0),
        pageIndex: 0,
        rotation: 0,
        thumbUrl,
        selected: false,
      },
    ])
  }

  const exportPdf = async () => {
    if (pages.length === 0) return
    setExportState('loading')
    try {
      const out = await PDFDocument.create()
      const cache = new Map<ArrayBuffer, PDFDocument>()

      for (const item of pages) {
        let src = cache.get(item.sourceBytes)
        if (!src) {
          src = await PDFDocument.load(item.sourceBytes.slice(0), {
            ignoreEncryption: true,
          })
          cache.set(item.sourceBytes, src)
        }
        const [copied] = await out.copyPages(src, [item.pageIndex])
        if (item.rotation) {
          copied.setRotation(degrees(item.rotation))
        }
        out.addPage(copied)
      }

      const bytes = await out.save()
      downloadBytes(bytes, 'multi-tool-export.pdf')
      setExportState('success')
      window.setTimeout(() => setExportState('idle'), 1500)
    } catch (e) {
      console.error(e)
      setExportState('error')
      setError(e instanceof Error ? e.message : 'Export failed')
      window.setTimeout(() => setExportState('idle'), 2000)
    }
  }

  const empty = pages.length === 0

  return (
    <div className="-mx-[max(0px,calc((100vw-1120px)/2))] flex min-h-[calc(100dvh-3.5rem)] flex-col bg-background">
      {/* Real file input — shared by Upload + Select files.
          Keep it visually hidden but not display:none (browsers block that). */}
      <input
        ref={inputRef}
        id="multi-tool-file-input"
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/jpg,.pdf,.png,.jpg,.jpeg"
        multiple
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        tabIndex={-1}
        onChange={(e) => void onFiles(e.target.files)}
      />

      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            PDF Multi Tool
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {empty
              ? 'Organize · rotate · export'
              : `${pages.length} page${pages.length === 1 ? '' : 's'}${
                  selectedCount ? ` · ${selectedCount} selected` : ''
                }`}
          </span>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 text-sm font-semibold text-foreground"
        >
          <CloseCircle size={14} color="currentColor" />
          Close
        </Link>
      </header>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-secondary p-1">
          <Button
            size="sm"
            variant="primary"
            type="button"
            onClick={openPicker}
          >
            <Upload size={14} color="currentColor" />
            Upload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => void addBlank()}
          >
            Blank
          </Button>
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-secondary p-1">
          <Button
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Undo"
            onClick={undo}
            disabled={history.current.length === 0}
          >
            <Restart size={14} color="currentColor" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Duplicate selected"
            onClick={duplicateSelected}
            disabled={selectedCount === 0}
          >
            <Copy size={14} color="currentColor" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => rotateSelected(-1)}
            disabled={selectedCount === 0}
            title="Rotate left"
          >
            ↺
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => rotateSelected(1)}
            disabled={selectedCount === 0}
            title="Rotate right"
          >
            ↻
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={selectAll}
            disabled={empty}
          >
            All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={selectNone}
            disabled={empty || selectedCount === 0}
          >
            None
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            className="text-destructive"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
          >
            <Trash size={14} color="currentColor" />
            Delete
          </Button>
          <StatefulButton
            size="sm"
            type="button"
            state={exportState}
            loadingText="Exporting…"
            successText="Done"
            errorText="Failed"
            onClick={() => void exportPdf()}
            disabled={empty || exportState === 'loading'}
          >
            <span className="inline-flex items-center gap-1.5">
              <Download size={14} color="currentColor" />
              Export
            </span>
          </StatefulButton>
        </div>
      </div>

      <div
        className="flex flex-1 flex-col overflow-auto p-4"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          void onFiles(e.dataTransfer.files)
        }}
      >
        {error ? (
          <p className="mb-3 text-center text-sm text-destructive">{error}</p>
        ) : null}

        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="size-8 animate-spin rounded-full border-2 border-border border-t-brand" />
            <p className="text-sm">Loading pages…</p>
          </div>
        ) : empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
            <label
              htmlFor="multi-tool-file-input"
              className="mb-4 grid size-16 cursor-pointer place-items-center rounded-3xl bg-brand-soft text-brand transition hover:scale-105"
              aria-label="Select files"
            >
              <Upload size={28} color="currentColor" />
            </label>
            <h1 className="text-lg font-bold text-foreground">
              Select PDF or image files
            </h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Drag and drop here, or choose files. Everything stays in your
              browser.
            </p>
            {/* Native label association — opens picker without relying on JS click */}
            <label
              htmlFor="multi-tool-file-input"
              className="mt-5 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Select files
            </label>
            <p className="mt-3 text-xs text-muted-foreground">
              PDF, JPG, PNG supported
            </p>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                onClick={() => toggleSelect(page.id)}
                className={cn(
                  'group relative overflow-hidden rounded-xl border bg-card p-2 text-left shadow-card transition',
                  page.selected
                    ? 'border-brand ring-2 ring-brand/40'
                    : 'border-border hover:border-brand/40',
                )}
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-secondary">
                  <img
                    src={page.thumbUrl}
                    alt={`Page ${index + 1}`}
                    className="h-full w-full object-contain"
                    style={{
                      transform: `rotate(${page.rotation}deg)`,
                      transition: 'transform 160ms ease',
                    }}
                    draggable={false}
                  />
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                  {page.selected ? (
                    <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-brand text-[10px] font-bold text-primary-foreground">
                      ✓
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  {page.fileName}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {!empty ? (
        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card/95 p-3 backdrop-blur md:hidden">
          <Button
            className="flex-1"
            variant="secondary"
            type="button"
            onClick={openPicker}
          >
            Upload
          </Button>
          <Button
            className="flex-1"
            variant="ghost"
            type="button"
            onClick={deleteSelected}
            disabled={selectedCount === 0}
          >
            Delete
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            type="button"
            onClick={() => void exportPdf()}
          >
            Export
          </Button>
        </div>
      ) : null}
    </div>
  )
}
