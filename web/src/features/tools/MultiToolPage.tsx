import { WorkspaceHeader } from '~/components/Chrome';
import { PDFDocument } from 'pdf-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Restart } from 'reicon-react';
import editcoreWasmUrl from 'bentopdf-pdfium/editcore.wasm?url';
import { Button } from '~/components/beui/button';
import { FileUpload } from '~/components/beui/file-upload';
import { useTheme } from '~/features/theme/theme';
import {
  bentoPdfTheme,
  destroyHost,
  pinHostSize,
  waitForLaidOut,
} from '~/lib/embedpdf-host';

/**
 * PDF Multi Tool — pdfium page organizer.
 *
 * Ported from upstream v2.8.11 (`feat(multi-tool): replace the page grid with
 * the pdfium organizer`). Pages are reordered, rotated, duplicated, inserted
 * and deleted inside the bentopdf-viewer organizer (`organize.standalone`),
 * and exported through the viewer's export plugin. Everything runs locally.
 */

const ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/bmp,.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Registry = any;
type DocManager = {
  openDocumentBuffer(opts: {
    buffer: ArrayBuffer;
    name: string;
    autoActivate?: boolean;
  }): unknown;
  closeDocument(id: string): unknown;
  onDocumentOpened(cb: (data: { id?: string } | null) => void): unknown;
  onDocumentClosed(
    cb: (data: string | { id?: string } | null) => void
  ): unknown;
};

function isPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Convert a raster image into a single-page PDF (pdf-lib, canvas fallback). */
async function imageToPdf(file: File): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const raw = new Uint8Array(await file.arrayBuffer());
  let img;
  if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name)) {
    img = await doc.embedJpg(raw);
  } else if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
    img = await doc.embedPng(raw);
  } else {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, 'image/png')
    );
    if (!blob) throw new Error(`Could not read image ${file.name}`);
    img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  }
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const bytes = await doc.save();
  return new Uint8Array(bytes).buffer;
}

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], { type: 'application/pdf' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function MultiToolPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const registryRef = useRef<Promise<Registry> | null>(null);
  const docManagerRef = useRef<DocManager | null>(null);
  const currentDocRef = useRef<string | null>(null);
  const probeSeq = useRef(0);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [pending, setPending] = useState<File[] | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasDoc, setHasDoc] = useState(false);
  const [docName, setDocName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Create the organizer once the container is visible and sized. */
  const ensureViewer = useCallback((): Promise<Registry> => {
    if (registryRef.current) return registryRef.current;
    const container = containerRef.current;
    if (!container)
      return Promise.reject(new Error('Organizer container missing'));
    registryRef.current = (async () => {
      const ready = await waitForLaidOut(container, { cancelled: false });
      if (!ready)
        throw new Error('Organizer container never received a layout size.');
      const { default: EmbedPDF } = await import('bentopdf-viewer');
      container.replaceChildren();
      const viewer = EmbedPDF.init({
        type: 'container',
        target: container,
        // Worker mode hangs under this Vite/Nitro build (see EditPdfPage).
        worker: false,
        wasmUrl: new URL(editcoreWasmUrl, window.location.origin).href,
        theme: bentoPdfTheme(themeRef.current),
        tabBar: 'never',
        organize: { standalone: true },
        documentManager: { maxDocuments: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      viewerRef.current = viewer;
      pinHostSize(viewer, container);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = await (viewer as any).registry;
      const dm = registry
        .getPlugin('document-manager')
        .provides() as unknown as DocManager;
      dm.onDocumentOpened((data) => {
        if (data?.id) {
          currentDocRef.current = data.id;
          setHasDoc(true);
        }
      });
      dm.onDocumentClosed((data) => {
        const id = typeof data === 'string' ? data : data?.id;
        if (id && id === currentDocRef.current) {
          currentDocRef.current = null;
          setHasDoc(false);
        }
      });
      docManagerRef.current = dm;
      return registry;
    })();
    registryRef.current.catch(() => {
      registryRef.current = null;
    });
    return registryRef.current;
  }, []);

  const canOpen = useCallback(
    async (registry: Registry, content: ArrayBuffer) => {
      const engine = registry.getEngine();
      try {
        const doc = await engine
          .openDocumentBuffer({ id: `mt-probe-${++probeSeq.current}`, content })
          .toPromise();
        await engine
          .closeDocument(doc)
          .toPromise()
          .catch(() => {});
        return doc.pageCount > 0;
      } catch {
        return false;
      }
    },
    []
  );

  // Load queued files once the organizer surface is mounted and visible.
  useEffect(() => {
    if (!pending || !active) return;
    const files = pending;
    setPending(null);
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const registry = await ensureViewer();
        const buffers: ArrayBuffer[] = [];
        const failed: string[] = [];
        for (const file of files) {
          try {
            const bytes = isPdf(file)
              ? await file.arrayBuffer()
              : await imageToPdf(file);
            if (await canOpen(registry, bytes)) buffers.push(bytes);
            else failed.push(file.name);
          } catch {
            failed.push(file.name);
          }
        }
        if (failed.length) {
          setError(
            `Could not open ${failed.join(', ')} (corrupt or password-protected — unlock it first).`
          );
        }
        if (buffers.length === 0) {
          if (!currentDocRef.current) setActive(false);
          return;
        }
        // Adding files while a document is open appends them to it.
        if (currentDocRef.current) {
          const current = await registry
            .getPlugin('export')
            .provides()
            .saveAsCopy()
            .toPromise();
          buffers.unshift(current);
          docManagerRef.current?.closeDocument(currentDocRef.current);
        }
        const merged: ArrayBuffer =
          buffers.length === 1
            ? buffers[0]
            : (
                await registry
                  .getEngine()
                  .merge(
                    buffers.map((content, i) => ({
                      id: `mt-${++probeSeq.current}-${i}`,
                      content,
                    }))
                  )
                  .toPromise()
              ).content;
        const name = docName ?? files[0]?.name ?? 'document.pdf';
        setDocName(name);
        docManagerRef.current?.openDocumentBuffer({
          buffer: merged,
          name,
          autoActivate: true,
        });
      } catch (e) {
        console.error('Multi Tool failed to load files', e);
        setError(e instanceof Error ? e.message : 'Failed to load files');
        if (!currentDocRef.current) setActive(false);
      } finally {
        setBusy(false);
      }
    })();
  }, [pending, active, ensureViewer, canOpen, docName]);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setActive(true);
    setPending(files);
  }, []);

  const exportPdf = useCallback(async () => {
    if (!currentDocRef.current || !registryRef.current) return;
    setBusy(true);
    try {
      const registry = await registryRef.current;
      const buffer = await registry
        .getPlugin('export')
        .provides()
        .saveAsCopy()
        .toPromise();
      const base = (docName ?? 'all-pages').replace(/\.[^.]+$/, '');
      downloadBuffer(buffer, `${base}-organized.pdf`);
    } catch (e) {
      console.error('Export failed', e);
      setError('Export failed.');
    } finally {
      setBusy(false);
    }
  }, [docName]);

  const resetAll = useCallback(() => {
    if (currentDocRef.current) {
      docManagerRef.current?.closeDocument(currentDocRef.current);
    }
    currentDocRef.current = null;
    setHasDoc(false);
    setDocName(null);
    setError(null);
    setActive(false);
  }, []);

  // Follow light/dark toggles.
  useEffect(() => {
    const v = viewerRef.current as { setTheme?: (t: unknown) => void } | null;
    try {
      v?.setTheme?.(bentoPdfTheme(theme));
    } catch {
      // best-effort
    }
  }, [theme]);

  useEffect(
    () => () => {
      destroyHost(viewerRef.current);
      viewerRef.current = null;
      registryRef.current = null;
    },
    []
  );

  const extraInput = useRef<HTMLInputElement>(null);

  return (
    <div className="workspace-shell">
      <WorkspaceHeader
        bleed
        title="PDF Multi Tool"
        subtitle={docName ?? 'Reorder, rotate, duplicate and delete pages'}
        actions={
          active ? (
            <>
              <input
                ref={extraInput}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  addFiles(files);
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={() => extraInput.current?.click()}
              >
                Add files
              </Button>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={resetAll}
              >
                <Restart size={14} color="currentColor" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={busy || !hasDoc}
                onClick={() => void exportPdf()}
              >
                <Download size={14} color="currentColor" />
                Export PDF
              </Button>
            </>
          ) : null
        }
      />

      {!active ? (
        <div className="workspace-empty">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Organize PDF pages
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Drop PDFs or images. Reorder, rotate, duplicate, insert and delete
              pages in the pdfium organizer, then export one PDF. Your files
              never leave the browser.
            </p>
            <FileUpload
              className="mt-6 text-left"
              value={[]}
              onValueChange={() => {}}
              onFilesAdded={(_items, raw) => addFiles(Array.from(raw))}
              accept={ACCEPT}
              multiple
              itemStatus="success"
              variant="centered"
              title="Drop PDFs or images here"
              description="Files never leave this device"
              browseLabel="Browse"
              classNames={{ queue: 'hidden' }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div
        className={
          active
            ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
            : 'hidden'
        }
        style={
          active
            ? {
                height:
                  'calc(100dvh - 3.25rem - env(safe-area-inset-top, 0px))',
                minHeight:
                  'calc(100dvh - 3.25rem - env(safe-area-inset-top, 0px))',
              }
            : undefined
        }
      >
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 flex-col bg-background [&>embedpdf-container]:min-h-0 [&>embedpdf-container]:w-full [&>embedpdf-container]:flex-1"
        />
        {busy ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground backdrop-blur-[2px]">
            Loading pages…
          </div>
        ) : null}
      </div>
    </div>
  );
}
