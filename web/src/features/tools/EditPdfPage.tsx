import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseCircle, Upload } from 'reicon-react';
import { Button } from '~/components/beui/button';

/**
 * Resolve the public pdfium.wasm URL.
 *
 * Served from /public (like qpdf.wasm). Do not use `new URL(bare, import.meta.url)`
 * — Vite does not rewrite that for package paths and it 404s. Also avoid naive
 * string concat + `.replace('//', '/')`, which corrupts absolute BASE_URLs.
 */
function pdfiumWasmUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  // BASE_URL always ends with `/` in Vite; keep a defensive join anyway.
  const path = base.endsWith('/') ? `${base}pdfium.wasm` : `${base}/pdfium.wasm`;
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).href;
}

/**
 * Wait until `el` has a non-zero box. EmbedPDF virtualises pages from the
 * measured viewport — init while still `display:none` / 0×0 lays out nothing
 * and never recovers without a resize.
 */
function waitForLaidOut(
  el: HTMLElement,
  signal: { cancelled: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let ro: ResizeObserver | null = null;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      ro?.disconnect();
      resolve(ok);
    };

    const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;

    if (signal.cancelled) {
      done(false);
      return;
    }
    if (hasSize()) {
      done(true);
      return;
    }

    ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (signal.cancelled) done(false);
            else if (hasSize()) done(true);
          })
        : null;
    ro?.observe(el);

    // rAF fallback for environments without ResizeObserver / first paint race.
    let frames = 0;
    const tick = () => {
      if (settled) return;
      if (signal.cancelled) {
        done(false);
        return;
      }
      if (hasSize()) {
        done(true);
        return;
      }
      frames += 1;
      if (frames > 120) {
        done(false); // ~2s @ 60fps
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);

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
          export: {
            defaultFileName: file.name,
          },
        });

        // Custom elements default to display:inline. Force the host to fill
        // the flex parent so the virtualised page list gets a real viewport
        // (h-full children inside the shadow tree need a definite host height).
        if (viewer instanceof HTMLElement) {
          viewer.style.display = 'flex';
          viewer.style.flex = '1 1 0%';
          viewer.style.flexDirection = 'column';
          viewer.style.minHeight = '0';
          viewer.style.height = '100%';
          viewer.style.width = '100%';
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
        // Prefer removing the host — disconnectedCallback unmounts the
        // shadow React tree and tears down the engine.
        if (viewer instanceof HTMLElement) {
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
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        tabIndex={-1}
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void open(chosen);
          e.currentTarget.value = '';
        }}
      />

      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            PDF Editor
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {file ? file.name : 'Annotate, highlight, redact and comment'}
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

      {!file ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mb-4 grid size-16 place-items-center rounded-3xl bg-brand-soft text-brand transition hover:scale-105"
            aria-label="Select a PDF"
          >
            <Upload size={28} color="currentColor" />
          </button>
          <h1 className="text-lg font-bold text-foreground">
            Choose a PDF to edit
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Draw, highlight, add text and shapes, redact, and comment. The
            editor engine is a few megabytes and loads once per session — your
            file never leaves the browser.
          </p>
          <Button className="mt-5" onClick={() => inputRef.current?.click()}>
            Select PDF
          </Button>
          {error ? (
            <p className="mt-4 max-w-md rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          ) : null}
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
            ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'hidden'
        }
        style={
          file
            ? {
                // Definite height so flex children (and EmbedPDF's h-full tree)
                // get a real viewport even before the shell's min-height settles.
                height: 'min(70vh, calc(100dvh - 8rem))',
                minHeight: 'min(70vh, calc(100dvh - 8rem))',
              }
            : undefined
        }
      >
        <div
          ref={containerRef}
          className="flex min-h-0 flex-1 flex-col [&>embedpdf-container]:min-h-0 [&>embedpdf-container]:w-full [&>embedpdf-container]:flex-1"
        />
        {file && loading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            Starting the editor…
          </div>
        ) : null}
      </div>
    </div>
  );
}
