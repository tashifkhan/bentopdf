import { Link } from '@tanstack/react-router';
import { PDFDocument } from 'pdf-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseCircle, Download, Trash, Upload } from 'reicon-react';
import { Button, StatefulButton } from '~/components/beui/button';
import { downloadFiles } from '~/lib/pdf/core';
import { openWithPdfjs, renderPage } from '~/lib/pdf/render';
import { cn } from '~/lib/utils';

type FieldKind = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'signature';

type FormField = {
  id: string;
  kind: FieldKind;
  name: string;
  page: number;
  /** Normalised 0-1 rect, measured from the top-left of the page. */
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  defaultValue: string;
  /** Newline-separated choices for dropdown/radio. */
  options: string;
};

const KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  radio: 'Radio group',
  signature: 'Signature',
};

const KIND_COLORS: Record<FieldKind, string> = {
  text: '#3b82f6',
  checkbox: '#10b981',
  dropdown: '#a855f7',
  radio: '#f59e0b',
  signature: '#ef4444',
};

export function FormCreatorPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kind, setKind] = useState<FieldKind>('text');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');

  // Drag state for drawing a new field rectangle.
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const pageFields = fields.filter((f) => f.page === pageIndex);

  const loadFile = useCallback(async (chosen: File) => {
    setLoading(true);
    setError(null);
    try {
      const doc = await openWithPdfjs(chosen);
      const images: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const canvas = await renderPage(doc, i, 1.5);
        images.push(canvas.toDataURL('image/jpeg', 0.82));
      }
      setFile(chosen);
      setPageImages(images);
      setPageIndex(0);
      setFields([]);
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that PDF');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!selectedId) return;
      e.preventDefault();
      setFields((prev) => prev.filter((f) => f.id !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  /* ------------------------------------------------------ drawing ---- */

  const relative = (e: React.PointerEvent) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!file) return;
    // Clicking an existing field selects it instead of drawing a new one.
    if ((e.target as HTMLElement).dataset.fieldId) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = relative(e);
    dragStart.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    setSelectedId(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = relative(e);
    const start = dragStart.current;
    setDraft({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  };

  const onPointerUp = () => {
    const box = draft;
    dragStart.current = null;
    setDraft(null);
    // Ignore stray clicks that did not produce a usable rectangle.
    if (!box || box.w < 0.01 || box.h < 0.005) return;

    const count = fields.filter((f) => f.kind === kind).length + 1;
    const field: FormField = {
      id: crypto.randomUUID(),
      kind,
      name: `${kind}_${count}`,
      page: pageIndex,
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      required: false,
      defaultValue: '',
      options: kind === 'dropdown' || kind === 'radio' ? 'Option 1\nOption 2' : '',
    };
    setFields((prev) => [...prev, field]);
    setSelectedId(field.id);
  };

  const update = (patch: Partial<FormField>) => {
    if (!selectedId) return;
    setFields((prev) =>
      prev.map((f) => (f.id === selectedId ? { ...f, ...patch } : f))
    );
  };

  /* -------------------------------------------------------- export ---- */

  const save = async () => {
    if (!file) return;
    if (fields.length === 0) {
      setError('Draw at least one field first');
      return;
    }
    const names = new Set<string>();
    for (const f of fields) {
      if (!f.name.trim()) {
        setError('Every field needs a name');
        return;
      }
      if (names.has(f.name)) {
        setError(`Duplicate field name: "${f.name}"`);
        return;
      }
      names.add(f.name);
    }

    setSaveState('loading');
    setError(null);
    try {
      const doc = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const form = doc.getForm();

      for (const f of fields) {
        const page = doc.getPage(f.page);
        const { width: pw, height: ph } = page.getSize();
        // Our rects are top-left origin; PDF's is bottom-left.
        const rect = {
          x: f.x * pw,
          y: ph - (f.y + f.height) * ph,
          width: f.width * pw,
          height: f.height * ph,
        };
        const choices = f.options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean);

        if (f.kind === 'text' || f.kind === 'signature') {
          const field = form.createTextField(f.name);
          if (f.defaultValue) field.setText(f.defaultValue);
          if (f.required) field.enableRequired();
          if (f.kind === 'signature') {
            // pdf-lib cannot create signature widgets, so this is a clearly
            // labelled text field reserved for a signature.
            field.setText(f.defaultValue || '');
          }
          field.addToPage(page, rect);
        } else if (f.kind === 'checkbox') {
          const field = form.createCheckBox(f.name);
          field.addToPage(page, rect);
          if (f.defaultValue.toLowerCase() === 'true') field.check();
          if (f.required) field.enableRequired();
        } else if (f.kind === 'dropdown') {
          const field = form.createDropdown(f.name);
          field.addOptions(choices.length ? choices : ['Option 1']);
          if (f.defaultValue) field.select(f.defaultValue);
          if (f.required) field.enableRequired();
          field.addToPage(page, rect);
        } else {
          const field = form.createRadioGroup(f.name);
          const list = choices.length ? choices : ['Option 1', 'Option 2'];
          // Stack the radio options vertically inside the drawn rectangle.
          const each = rect.height / list.length;
          list.forEach((option, i) => {
            field.addOptionToPage(option, page, {
              x: rect.x,
              y: rect.y + rect.height - each * (i + 1),
              width: Math.min(each, rect.width),
              height: each,
            });
          });
          if (f.defaultValue && list.includes(f.defaultValue)) {
            field.select(f.defaultValue);
          }
          if (f.required) field.enableRequired();
        }
      }

      const bytes = await doc.save();
      downloadFiles([
        {
          name: file.name.replace(/\.pdf$/i, '') + '-form.pdf',
          bytes,
          mime: 'application/pdf',
        },
      ]);
      setSaveState('success');
      window.setTimeout(() => setSaveState('idle'), 1600);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Could not build the form');
      setSaveState('error');
      window.setTimeout(() => setSaveState('idle'), 2200);
    }
  };

  const empty = !file;

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
          if (chosen) void loadFile(chosen);
          e.currentTarget.value = '';
        }}
      />

      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            Form Creator
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {empty
              ? 'Draw fields onto a PDF'
              : `${fields.length} field${fields.length === 1 ? '' : 's'} · page ${pageIndex + 1} of ${pageImages.length}`}
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

      {empty ? (
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
            Choose a PDF to add form fields to
          </h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Drag a rectangle anywhere on the page to place a field. Everything
            stays in your browser.
          </p>
          {loading ? (
            <p className="mt-4 text-sm text-muted-foreground">Rendering…</p>
          ) : (
            <Button className="mt-5" onClick={() => inputRef.current?.click()}>
              Select PDF
            </Button>
          )}
          {error ? (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 flex-col lg:flex-row">
          {/* ------------------------------------------------ canvas */}
          <div className="flex flex-1 flex-col overflow-auto p-3 sm:p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="h-scroll items-center">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Field type
                </span>
                {(Object.keys(KIND_LABELS) as FieldKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      'touch-manipulation shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition sm:py-1',
                      kind === k
                        ? 'border-transparent text-white'
                        : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
                    )}
                    style={kind === k ? { background: KIND_COLORS[k] } : undefined}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-1 sm:ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((p) => p - 1)}
                  className="min-h-9"
                >
                  ‹ Prev
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pageIndex + 1} / {pageImages.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pageIndex >= pageImages.length - 1}
                  onClick={() => setPageIndex((p) => p + 1)}
                  className="min-h-9"
                >
                  Next ›
                </Button>
              </div>
            </div>

            <div
              ref={surfaceRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="relative mx-auto w-full max-w-3xl cursor-crosshair select-none overflow-hidden rounded-xl border border-border bg-card shadow-card"
            >
              <img
                src={pageImages[pageIndex]}
                alt={`Page ${pageIndex + 1}`}
                className="block w-full"
                draggable={false}
              />

              {pageFields.map((f) => (
                <div
                  key={f.id}
                  data-field-id={f.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(f.id);
                  }}
                  className={cn(
                    'absolute cursor-pointer border-2 text-[10px] font-bold',
                    selectedId === f.id ? 'ring-2 ring-offset-1' : ''
                  )}
                  style={{
                    left: `${f.x * 100}%`,
                    top: `${f.y * 100}%`,
                    width: `${f.width * 100}%`,
                    height: `${f.height * 100}%`,
                    borderColor: KIND_COLORS[f.kind],
                    background: `${KIND_COLORS[f.kind]}22`,
                  }}
                >
                  <span
                    className="pointer-events-none absolute -top-4 left-0 whitespace-nowrap rounded px-1 text-white"
                    style={{ background: KIND_COLORS[f.kind] }}
                  >
                    {f.name}
                  </span>
                </div>
              ))}

              {draft ? (
                <div
                  className="pointer-events-none absolute border-2 border-dashed"
                  style={{
                    left: `${draft.x * 100}%`,
                    top: `${draft.y * 100}%`,
                    width: `${draft.w * 100}%`,
                    height: `${draft.h * 100}%`,
                    borderColor: KIND_COLORS[kind],
                    background: `${KIND_COLORS[kind]}18`,
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* ----------------------------------------------- inspector */}
          <aside className="w-full shrink-0 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:w-80 lg:border-l lg:border-t-0">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-foreground">
                    {KIND_LABELS[selected.kind]} field
                  </h2>
                  <button
                    type="button"
                    className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Delete field"
                    onClick={() => {
                      setFields((prev) =>
                        prev.filter((f) => f.id !== selected.id)
                      );
                      setSelectedId(null);
                    }}
                  >
                    <Trash size={14} color="currentColor" />
                  </button>
                </div>

                <Labelled label="Field name">
                  <input
                    value={selected.name}
                    onChange={(e) => update({ name: e.target.value })}
                    className={inputClass}
                  />
                </Labelled>

                {selected.kind === 'dropdown' || selected.kind === 'radio' ? (
                  <Labelled label="Options (one per line)">
                    <textarea
                      value={selected.options}
                      rows={4}
                      onChange={(e) => update({ options: e.target.value })}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                    />
                  </Labelled>
                ) : null}

                <Labelled
                  label={
                    selected.kind === 'checkbox'
                      ? 'Checked by default (true/false)'
                      : 'Default value'
                  }
                >
                  <input
                    value={selected.defaultValue}
                    onChange={(e) => update({ defaultValue: e.target.value })}
                    className={inputClass}
                  />
                </Labelled>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selected.required}
                    onChange={(e) => update({ required: e.target.checked })}
                    className="size-4 rounded border-border"
                  />
                  Required
                </label>

                <p className="text-[11px] text-ink-4">
                  Press Delete to remove the selected field.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Drag on the page to draw a field, then select it here to set its
                name and options.
              </p>
            )}

            {fields.length > 0 ? (
              <div className="mt-5">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  All fields
                </p>
                <ul className="space-y-1">
                  {fields.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPageIndex(f.page);
                          setSelectedId(f.id);
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs',
                          selectedId === f.id
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground hover:bg-secondary/60'
                        )}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: KIND_COLORS[f.kind] }}
                        />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 tabular-nums">
                          p{f.page + 1}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2 lg:static">
              <StatefulButton
                type="button"
                state={saveState}
                loadingText="Building…"
                successText="Saved"
                errorText="Failed"
                onClick={() => void save()}
                disabled={fields.length === 0 || saveState === 'loading'}
                className="min-h-11 flex-1 sm:min-h-0"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Download size={15} color="currentColor" />
                  Save form PDF
                </span>
              </StatefulButton>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-xl border border-border bg-card px-3 text-base text-foreground outline-none focus:border-brand sm:h-10 sm:text-sm';

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
