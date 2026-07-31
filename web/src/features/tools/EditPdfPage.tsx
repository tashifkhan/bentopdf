import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseCircle, Upload } from 'reicon-react';
import { Button } from '~/components/beui/button';

/**
 * Full PDF editor.
 *
 * This wraps EmbedPDF (the same PDFium-backed viewer the previous build used),
 * which supplies annotation, highlight, shape, redaction and text tooling. It
 * is a large wasm bundle, so it is only loaded once a file is chosen.
 */
export function EditPdfPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (chosen: File) => {
    setLoading(true);
    setError(null);
    try {
      const { default: EmbedPDF } = await import('embedpdf-snippet');
      // The wasm binary ships with the package; resolve it relative to the
      // module so the bundler emits it as an asset.
      const wasmUrl = new URL(
        'embedpdf-snippet/dist/pdfium.wasm',
        import.meta.url
      ).toString();

      const url = URL.createObjectURL(chosen);
      viewerRef.current = await EmbedPDF.init({
        type: 'container',
        target: containerRef.current!,
        wasmUrl,
        worker: true,
        src: url,
      });
      setFile(chosen);
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? `Could not start the editor: ${e.message}`
          : 'Could not start the editor'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        viewerRef.current?.destroy?.();
      } catch {
        // Nothing to clean up.
      }
    };
  }, []);

  return (
    <div className="-mx-[max(0px,calc((100vw-1120px)/2))] flex min-h-[calc(100dvh-3.5rem)] flex-col bg-background">
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

      <header className="flex h-12 items-center justify-between border-b border-border bg-card px-3 sm:px-4">
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
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 text-sm font-semibold text-foreground"
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
          {loading ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Starting the editor…
            </p>
          ) : (
            <Button className="mt-5" onClick={() => inputRef.current?.click()}>
              Select PDF
            </Button>
          )}
          {error ? (
            <p className="mt-4 max-w-md rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* EmbedPDF mounts here and provides its own toolbar. */}
      <div
        ref={containerRef}
        className={file ? 'flex-1' : 'hidden'}
        style={{ minHeight: file ? '70vh' : undefined }}
      />
    </div>
  );
}
