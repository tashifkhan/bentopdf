import { WorkspaceHeader } from '~/components/Chrome';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUpload } from '~/components/beui/file-upload';
import { useTheme } from '~/features/theme/theme';
import {
  bentoPdfTheme,
  pdfiumWasmUrl,
  waitForLaidOut,
} from '~/lib/embedpdf-host';

/**
 * Full PDF editor.
 *
 * This wraps EmbedPDF (the same PDFium-backed viewer the previous build used),
 * which supplies annotation, highlight, shape, redaction and text tooling. It
 * is a large wasm bundle, so it is only loaded once a file is chosen.
 *
 * Ordering is critical: the mount target must be visible and sized *before*
 * `EmbedPDF.init()` runs. Setting `file` first lets React unhide the container
 * and commit layout; the effect then waits for a non-zero box and only then
 * creates the viewer.
 */
export function EditPdfPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const { theme } = useTheme();

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Choosing a file only records it. Init runs from the effect below, after
  // the container is visible and has a real layout box.
  const open = useCallback((chosen: File) => {
    setError(null);
    setLoading(true);
    setFile(chosen);
  }, []);

  // Capture current theme at open time without re-mounting the engine when
  // the user later toggles light/dark (that path uses setTheme below).
  const themeAtOpenRef = useRef(theme);
  themeAtOpenRef.current = theme;

  useEffect(() => {
    if (!file) return;
    const container = containerRef.current;
    if (!container) return;

    const signal = { cancelled: false };
    let objectUrl: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null;

    void (async () => {
      try {
        // 1. Container must already be out of `hidden` (file is set → class
        //    switches to flex). Wait for a real measured size.
        const ready = await waitForLaidOut(container, signal);
        if (signal.cancelled) return;
        if (!ready) {
          throw new Error(
            'Editor container never received a layout size. Try resizing the window.'
          );
        }

        // 2. Dynamic import (large wasm-backed module).
        const { default: EmbedPDF } = await import('embedpdf-snippet');
        if (signal.cancelled) return;

        const wasmUrl = pdfiumWasmUrl();
        objectUrl = URL.createObjectURL(file);

        // Tear down any leftover host from a cancelled prior attempt.
        container.replaceChildren();

        // 3. Init only once the target is visible + sized.
        viewer = EmbedPDF.init({
          type: 'container',
          target: container,
          wasmUrl,
          // Worker mode hangs on "Loading document…" under this Vite/Nitro
          // build (verified in dev and in a production build): the engine's
          // request/response bridge never resolves. The in-process engine
          // renders correctly, at the cost of running PDFium on the main
          // thread.
          worker: false,
          src: objectUrl,
          theme: bentoPdfTheme(themeAtOpenRef.current),
          export: {
            defaultFileName: file.name,
          },
        });

        // EmbedPDF's shadow root content is `height: 100%`, but percentage
        // height does not resolve against this custom-element host (measured:
        // host 611px, shadow content still content-sized ~69px toolbar-only,
        // so the virtualised page list never painted). Pin both the host and
        // its non-<style> shadow children to the container's pixel box.
        if (viewer instanceof HTMLElement) {
          type SizedHost = HTMLElement & {
            __sizeObserver?: ResizeObserver;
            __shadowObserver?: MutationObserver;
          };
          const host = viewer as SizedHost;
          let syncing = false;

          const syncHostSize = () => {
            if (syncing) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w <= 0 || h <= 0) return;

            syncing = true;
            try {
              host.style.display = 'block';
              host.style.boxSizing = 'border-box';
              host.style.width = `${w}px`;
              host.style.height = `${h}px`;
              host.style.maxWidth = '100%';
              host.style.maxHeight = '100%';

              const root = host.shadowRoot;
              if (!root) return;
              for (const el of root.children) {
                if (!(el instanceof HTMLElement) || el.tagName === 'STYLE') {
                  continue;
                }
                // Only rewrite when EmbedPDF has reset back to % / empty —
                // avoids fighting every frame after we pin px.
                const want = `${h}px`;
                if (el.style.height !== want) {
                  el.style.setProperty('box-sizing', 'border-box', 'important');
                  el.style.setProperty('width', `${w}px`, 'important');
                  el.style.setProperty('height', want, 'important');
                  el.style.setProperty('min-height', want, 'important');
                }
              }
            } finally {
              syncing = false;
            }
          };

          syncHostSize();

          if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(syncHostSize);
            ro.observe(container);
            host.__sizeObserver = ro;
          }
          // Content mounts asynchronously (engine init → Preact tree). Preact
          // also rewrites the content root's style attribute to height:100%,
          // which we must re-pin to px.
          if (host.shadowRoot && typeof MutationObserver !== 'undefined') {
            const mo = new MutationObserver(syncHostSize);
            mo.observe(host.shadowRoot, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ['style'],
            });
            host.__shadowObserver = mo;
          }
        }

        viewerRef.current = viewer;
      } catch (e) {
        console.error(e);
        if (signal.cancelled) return;
        setFile(null);
        setError(
          e instanceof Error
            ? `Could not start the editor: ${e.message}`
            : 'Could not start the editor'
        );
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    })();

    return () => {
      signal.cancelled = true;
      try {
        if (viewer instanceof HTMLElement) {
          const host = viewer as HTMLElement & {
            __sizeObserver?: ResizeObserver;
            __shadowObserver?: MutationObserver;
          };
          host.__sizeObserver?.disconnect();
          host.__shadowObserver?.disconnect();
          // Prefer removing the host — disconnectedCallback unmounts the
          // shadow React tree and tears down the engine.
          viewer.remove();
        } else {
          viewer?.destroy?.();
        }
      } catch {
        // Nothing to clean up.
      }
      if (viewerRef.current === viewer) viewerRef.current = null;
      container.replaceChildren();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // Keep EmbedPDF in sync if the user toggles light/dark while editing.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !file) return;
    try {
      if (typeof viewer.setTheme === 'function') {
        viewer.setTheme(bentoPdfTheme(theme));
      }
    } catch {
      // Theme update is best-effort.
    }
  }, [theme, file]);

  // Unmount-only safety net (effect cleanup above already handles file changes).
  useEffect(() => {
    return () => {
      try {
        const v = viewerRef.current;
        if (v instanceof HTMLElement) v.remove();
        else v?.destroy?.();
      } catch {
        // Nothing to clean up.
      }
      viewerRef.current = null;
    };
  }, []);

  return (
    <div className="workspace-shell">
      <WorkspaceHeader
        bleed
        title="PDF Editor"
        subtitle={file ? file.name : 'Annotate, highlight, redact and comment'}
      />

      {!file ? (
        <div className="workspace-empty">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Choose a PDF to edit
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Draw, highlight, add text and shapes, redact, and comment. The
              editor engine is a few megabytes and loads once per session — your
              file never leaves the browser.
            </p>
            <FileUpload
              className="mt-6 text-left"
              value={[]}
              onValueChange={() => {}}
              onFilesAdded={(_items, raw) => {
                const chosen = raw[0];
                if (chosen) open(chosen);
              }}
              accept="application/pdf,.pdf"
              multiple={false}
              maxFiles={1}
              itemStatus="success"
              variant="centered"
              title="Drop a PDF here"
              description="Files never leave this device"
              browseLabel="Browse"
              classNames={{ queue: 'hidden' }}
            />
            {error ? (
              <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Outer shell owns layout + loading chrome. Inner mount is empty so
          EmbedPDF can own its children without fighting React (we call
          replaceChildren on cleanup). Custom host defaults to display:inline
          with no intrinsic height — force it to fill or the virtualised page
          list paints nothing. */}
      <div
        className={
          file
            ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background'
            : 'hidden'
        }
        style={
          file
            ? {
                // Full remaining viewport under the workspace header (shell chrome
                // is hidden on this route so we can use nearly 100dvh).
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
          className="flex min-h-0 flex-1 flex-col bg-background [&>embedpdf-container]:min-h-0 [&>embedpdf-container]:w-full [&>embedpdf-container]:flex-1 [&>embedpdf-container]:bg-background"
        />
        {file && loading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground backdrop-blur-[2px]">
            Starting the editor…
          </div>
        ) : null}
      </div>
    </div>
  );
}
