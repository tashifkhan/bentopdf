import { Link } from '@tanstack/react-router';
import { PDFDocument, degrees } from 'pdf-lib';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CloseCircle,
  Copy,
  Download,
  Restart,
  Scissors,
  Trash,
  Upload,
} from 'reicon-react';
import { Button, StatefulButton } from '~/components/beui/button';
import { cn } from '~/lib/utils';

type PageItem = {
  id: string;
  fileName: string;
  sourceBytes: ArrayBuffer;
  pageIndex: number;
  rotation: number;
  thumbUrl: string;
};

/** Everything undo/redo has to restore. */
type Snapshot = {
  pages: PageItem[];
  selected: Set<string>;
  splits: Set<string>;
};

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/jpg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes);
  downloadBlob(new Blob([copy.buffer], { type: 'application/pdf' }), filename);
}

/** Lazy-load pdf.js only in the browser (SSR has no DOMMatrix). */
async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderThumb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  pageIndex: number
): Promise<string> {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 0.35 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas.toDataURL('image/jpeg', 0.72);
}

async function loadFilesToPages(
  fileList: FileList | File[]
): Promise<PageItem[]> {
  const pdfjs = await getPdfjs();
  const out: PageItem[] = [];

  for (const file of Array.from(fileList)) {
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    if (isPdf) {
      const bytes = await file.arrayBuffer();
      const copy = bytes.slice(0);
      const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
      for (let i = 0; i < pdf.numPages; i++) {
        out.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          sourceBytes: copy,
          pageIndex: i,
          rotation: 0,
          thumbUrl: await renderThumb(pdf, i),
        });
      }
      continue;
    }

    if (!isImage) continue;

    // Images become a one-page PDF so every item shares the same export path.
    const doc = await PDFDocument.create();
    const imgBytes = new Uint8Array(await file.arrayBuffer());
    let embedded;
    try {
      embedded =
        file.type.includes('png') || name.endsWith('.png')
          ? await doc.embedPng(imgBytes)
          : await doc.embedJpg(imgBytes);
    } catch {
      continue;
    }
    doc
      .addPage([embedded.width, embedded.height])
      .drawImage(embedded, {
        x: 0,
        y: 0,
        width: embedded.width,
        height: embedded.height,
      });
    const pdfBytes = await doc.save();
    const ab = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
    const pdf = await pdfjs.getDocument({ data: ab.slice(0) }).promise;
    out.push({
      id: crypto.randomUUID(),
      fileName: file.name,
      sourceBytes: ab,
      pageIndex: 0,
      rotation: 0,
      thumbUrl: await renderThumb(pdf, 0),
    });
  }
  return out;
}

/** Build one PDF from the given items, honouring per-page rotation. */
async function buildPdf(items: PageItem[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const cache = new Map<ArrayBuffer, PDFDocument>();
  for (const item of items) {
    let src = cache.get(item.sourceBytes);
    if (!src) {
      src = await PDFDocument.load(item.sourceBytes.slice(0), {
        ignoreEncryption: true,
      });
      cache.set(item.sourceBytes, src);
    }
    const [copied] = await out.copyPages(src, [item.pageIndex]);
    if (item.rotation) copied.setRotation(degrees(item.rotation));
    out.addPage(copied);
  }
  return out.save();
}

export function MultiToolPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const insertAfterRef = useRef<string | null>(null);

  const [pages, setPages] = useState<PageItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splits, setSplits] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [dragId, setDragId] = useState<string | null>(null);

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const selectedCount = selected.size;
  const empty = pages.length === 0;

  const snapshot = useCallback((): Snapshot => {
    return {
      pages: pages.map((p) => ({ ...p })),
      selected: new Set(selected),
      splits: new Set(splits),
    };
  }, [pages, selected, splits]);

  /** Record the current state before a mutation so undo can return to it. */
  const commit = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setHistoryTick((t) => t + 1);
  }, [snapshot]);

  const restore = useCallback((snap: Snapshot) => {
    setPages(snap.pages);
    setSelected(snap.selected);
    setSplits(snap.splits);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(snapshot());
    restore(prev);
    setHistoryTick((t) => t + 1);
  }, [restore, snapshot]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshot());
    restore(next);
    setHistoryTick((t) => t + 1);
  }, [restore, snapshot]);

  const resetAll = useCallback(() => {
    if (pages.length > 0) commit();
    setPages([]);
    setSelected(new Set());
    setSplits(new Set());
    setError(null);
  }, [commit, pages.length]);

  const onFiles = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list?.length) return;
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadFilesToPages(list);
        if (loaded.length === 0) {
          setError('No supported files found. Use PDF, JPG, PNG or WebP.');
          return;
        }
        commit();
        const anchor = insertAfterRef.current;
        setPages((prev) => {
          if (!anchor) return [...prev, ...loaded];
          const at = prev.findIndex((p) => p.id === anchor);
          if (at === -1) return [...prev, ...loaded];
          return [...prev.slice(0, at + 1), ...loaded, ...prev.slice(at + 1)];
        });
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : 'Failed to load files');
      } finally {
        insertAfterRef.current = null;
        setLoading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [commit]
  );

  const openPicker = useCallback((insertAfter?: string) => {
    insertAfterRef.current = insertAfter ?? null;
    const mounted = inputRef.current;
    if (mounted) {
      mounted.value = '';
      mounted.click();
    }
  }, []);

  /* ------------------------------------------------------------ editing */

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(pages.map((p) => p.id)));
  const deselectAll = () => setSelected(new Set());

  const rotate = (ids: string[], dir: 1 | -1) => {
    if (ids.length === 0) return;
    commit();
    const target = new Set(ids);
    setPages((prev) =>
      prev.map((p) =>
        target.has(p.id)
          ? { ...p, rotation: (p.rotation + dir * 90 + 360) % 360 }
          : p
      )
    );
  };

  const duplicate = (ids: string[]) => {
    if (ids.length === 0) return;
    commit();
    const target = new Set(ids);
    setPages((prev) => {
      const next: PageItem[] = [];
      for (const p of prev) {
        next.push(p);
        if (target.has(p.id)) next.push({ ...p, id: crypto.randomUUID() });
      }
      return next;
    });
  };

  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    commit();
    const target = new Set(ids);
    setPages((prev) => prev.filter((p) => !target.has(p.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setSplits((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const toggleSplit = (ids: string[]) => {
    if (ids.length === 0) return;
    commit();
    setSplits((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const addBlank = async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: ab.slice(0) }).promise;
    const thumbUrl = await renderThumb(pdf, 0);
    commit();
    setPages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        fileName: 'blank.pdf',
        sourceBytes: ab,
        pageIndex: 0,
        rotation: 0,
        thumbUrl,
      },
    ]);
  };

  /* --------------------------------------------------------- reordering */

  const onDropReorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    commit();
    setPages((prev) => {
      const from = prev.findIndex((p) => p.id === dragId);
      const to = prev.findIndex((p) => p.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setDragId(null);
  };

  /* ------------------------------------------------------------- export */

  /** Split markers cut *after* the marked page, producing one PDF per segment. */
  const segments = useMemo(() => {
    const out: PageItem[][] = [];
    let current: PageItem[] = [];
    for (const page of pages) {
      current.push(page);
      if (splits.has(page.id)) {
        out.push(current);
        current = [];
      }
    }
    if (current.length > 0) out.push(current);
    return out;
  }, [pages, splits]);

  const exportPdf = async () => {
    if (empty) return;
    setExportState('loading');
    setError(null);
    try {
      if (segments.length > 1) {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (let i = 0; i < segments.length; i++) {
          zip.file(`document - ${i + 1}.pdf`, await buildPdf(segments[i]!));
        }
        downloadBlob(
          await zip.generateAsync({ type: 'blob' }),
          'split-documents.zip'
        );
      } else {
        downloadBytes(await buildPdf(pages), 'multi-tool-export.pdf');
      }
      setExportState('success');
      window.setTimeout(() => setExportState('idle'), 1500);
    } catch (e) {
      console.error(e);
      setExportState('error');
      setError(e instanceof Error ? e.message : 'Export failed');
      window.setTimeout(() => setExportState('idle'), 2000);
    }
  };

  const downloadSelected = async () => {
    const chosen = pages.filter((p) => selected.has(p.id));
    if (chosen.length === 0) return;
    try {
      downloadBytes(await buildPdf(chosen), 'selected-pages.pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const selectedIds = pages.filter((p) => selected.has(p.id)).map((p) => p.id);

  return (
    <div className="workspace-shell">
      <input
        ref={inputRef}
        id="multi-tool-file-input"
        type="file"
        accept={ACCEPT}
        multiple
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        tabIndex={-1}
        onChange={(e) => void onFiles(e.target.files)}
      />

      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            PDF Multi Tool
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {empty
              ? 'Organize · rotate · split · export'
              : `${pages.length} page${pages.length === 1 ? '' : 's'}${
                  selectedCount ? ` · ${selectedCount} selected` : ''
                }${segments.length > 1 ? ` · ${segments.length} documents` : ''}`}
          </span>
        </div>
        <Link
          to="/"
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 text-sm font-semibold text-foreground"
        >
          <CloseCircle size={14} color="currentColor" />
          Close
        </Link>
      </header>

      {/* Horizontally scrollable toolbar — critical on narrow viewports */}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-scroll">
          <ToolGroup>
            <Button
              size="sm"
              variant="primary"
              type="button"
              onClick={() => openPicker()}
              className="shrink-0"
            >
              <Upload size={14} color="currentColor" />
              <span className="hidden sm:inline">Upload PDFs</span>
              <span className="sm:hidden">Upload</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => void addBlank()}
              className="shrink-0"
            >
              <span className="hidden sm:inline">Add Blank Page</span>
              <span className="sm:hidden">Blank</span>
            </Button>
          </ToolGroup>

          <ToolGroup label="Edit">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={undo}
              disabled={undoStack.current.length === 0}
              data-history={historyTick}
              className="shrink-0"
            >
              Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={redo}
              disabled={redoStack.current.length === 0}
              className="shrink-0"
            >
              Redo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={resetAll}
              disabled={empty}
              className="shrink-0"
            >
              <Restart size={14} color="currentColor" />
              Reset
            </Button>
          </ToolGroup>

          <ToolGroup label="Selection">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={selectAll}
              disabled={empty}
              className="shrink-0"
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={deselectAll}
              disabled={selectedCount === 0}
              className="shrink-0"
            >
              Deselect
            </Button>
          </ToolGroup>

          <ToolGroup label="Rotate">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => rotate(selectedIds, -1)}
              disabled={selectedCount === 0}
              title="Rotate left"
              className="shrink-0"
            >
              ↺ Left
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => rotate(selectedIds, 1)}
              disabled={selectedCount === 0}
              title="Rotate right"
              className="shrink-0"
            >
              ↻ Right
            </Button>
          </ToolGroup>

          <ToolGroup label="Transform">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => duplicate(selectedIds)}
              disabled={selectedCount === 0}
              className="shrink-0"
            >
              <Copy size={14} color="currentColor" />
              <span className="hidden sm:inline">Duplicate</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => toggleSplit(selectedIds)}
              disabled={selectedCount === 0}
              title="Toggle a split point after each selected page"
              className="shrink-0"
            >
              <Scissors size={14} color="currentColor" />
              Split
            </Button>
          </ToolGroup>

          <ToolGroup label="Clear">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="shrink-0 text-destructive"
              onClick={() => remove(selectedIds)}
              disabled={selectedCount === 0}
            >
              <Trash size={14} color="currentColor" />
              Delete
            </Button>
          </ToolGroup>

          <ToolGroup label="Download">
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => void downloadSelected()}
              disabled={selectedCount === 0}
              className="hidden shrink-0 sm:inline-flex"
            >
              <Download size={14} color="currentColor" />
              Download Selected
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
              className="hidden shrink-0 sm:inline-flex"
            >
              <span className="inline-flex items-center gap-1.5">
                <Download size={14} color="currentColor" />
                {segments.length > 1 ? 'Export ZIP' : 'Export PDF'}
              </span>
            </StatefulButton>
          </ToolGroup>
        </div>
      </div>

      <div
        className="flex flex-1 flex-col overflow-auto p-3 sm:p-4"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          if (dragId) return;
          e.preventDefault();
          void onFiles(e.dataTransfer.files);
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
              Drag and drop PDF or image files here, or click to select.
              Everything stays in your browser.
            </p>
            <label
              htmlFor="multi-tool-file-input"
              className="mt-5 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Select Files
            </label>
            <p className="mt-3 text-xs text-muted-foreground">
              PDF, JPG, PNG, WebP supported
            </p>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {pages.map((page, index) => (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                isSelected={selected.has(page.id)}
                hasSplit={splits.has(page.id)}
                isDragging={dragId === page.id}
                onToggle={() => toggleSelect(page.id)}
                onRotateLeft={() => rotate([page.id], -1)}
                onRotateRight={() => rotate([page.id], 1)}
                onDuplicate={() => duplicate([page.id])}
                onInsert={() => openPicker(page.id)}
                onToggleSplit={() => toggleSplit([page.id])}
                onDelete={() => remove([page.id])}
                onDragStart={() => setDragId(page.id)}
                onDragEnd={() => setDragId(null)}
                onDropOn={() => onDropReorder(page.id)}
              />
            ))}
          </div>
        )}
      </div>

      {!empty ? (
        <div className="mobile-action-bar sm:hidden">
          <Button
            className="min-h-11 flex-1"
            variant="secondary"
            type="button"
            onClick={() => openPicker()}
          >
            Upload
          </Button>
          <Button
            className="min-h-11 flex-1"
            variant="ghost"
            type="button"
            onClick={() => remove(selectedIds)}
            disabled={selectedCount === 0}
          >
            Delete
          </Button>
          <Button
            className="min-h-11 flex-1"
            variant="primary"
            type="button"
            onClick={() => void exportPdf()}
            disabled={exportState === 'loading'}
          >
            Export
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ToolGroup({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      {label ? (
        <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:inline">
          {label}:
        </span>
      ) : null}
      <div className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-secondary p-1">
        {children}
      </div>
    </div>
  );
}

function PageCard({
  page,
  index,
  isSelected,
  hasSplit,
  isDragging,
  onToggle,
  onRotateLeft,
  onRotateRight,
  onDuplicate,
  onInsert,
  onToggleSplit,
  onDelete,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  page: PageItem;
  index: number;
  isSelected: boolean;
  hasSplit: boolean;
  isDragging: boolean;
  onToggle: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onDuplicate: () => void;
  onInsert: () => void;
  onToggleSplit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}) {
  // Larger hit targets on touch; denser on desktop
  const action =
    'grid size-8 place-items-center rounded-md text-[12px] text-foreground/80 active:bg-secondary sm:size-7 hover:bg-secondary touch-manipulation';

  return (
    <div
      className={cn('group/card relative', isDragging && 'opacity-40')}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropOn();
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full touch-manipulation overflow-hidden rounded-xl border bg-card p-1.5 text-left shadow-card transition sm:p-2',
          isSelected
            ? 'border-brand ring-2 ring-brand/40'
            : 'border-border hover:border-brand/40'
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
          {isSelected ? (
            <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-brand text-[10px] font-bold text-primary-foreground">
              ✓
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {page.fileName}
        </p>
      </button>

      {/* Always visible on touch devices; hover-reveal only on fine pointers */}
      <div className="mt-1 flex items-center justify-center gap-0.5 rounded-lg border border-border bg-card p-0.5 opacity-100 transition [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/card:opacity-100 focus-within:opacity-100">
        <button type="button" className={action} title="Rotate left" onClick={onRotateLeft}>
          ↺
        </button>
        <button type="button" className={action} title="Rotate right" onClick={onRotateRight}>
          ↻
        </button>
        <button type="button" className={action} title="Duplicate page" onClick={onDuplicate}>
          <Copy size={12} color="currentColor" />
        </button>
        <button type="button" className={action} title="Insert PDF after this page" onClick={onInsert}>
          +
        </button>
        <button
          type="button"
          className={cn(action, hasSplit && 'text-brand')}
          title="Toggle split after this page"
          onClick={onToggleSplit}
        >
          <Scissors size={12} color="currentColor" />
        </button>
        <button
          type="button"
          className={cn(action, 'text-destructive')}
          title="Delete page"
          onClick={onDelete}
        >
          <Trash size={12} color="currentColor" />
        </button>
      </div>

      {hasSplit ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2 top-0 bottom-8 w-0 border-l-2 border-dashed border-brand"
        />
      ) : null}
    </div>
  );
}
