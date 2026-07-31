import { Link } from '@tanstack/react-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CloseCircle, Download, Trash, Upload } from 'reicon-react';
import { Button, StatefulButton } from '~/components/beui/button';
import { Input } from '~/components/beui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/beui/select';
import { allTools } from '~/data/tools';
import { downloadFiles, type OutFile } from '~/lib/pdf/core';
import { cn } from '~/lib/utils';
import { getToolEntry } from './processors';
import { ToolFieldControl } from './ToolFieldControl';
import type { ToolField, ToolProcessor } from './types';

type Step = {
  id: string;
  slug: string;
  values: Record<string, string>;
};

type StepResult = {
  slug: string;
  status: 'ok' | 'failed' | 'skipped';
  message: string;
  outputs: number;
};

const STORAGE_KEY = 'bentopdf.workflows';

/**
 * Steps must take a PDF in and give a PDF back, otherwise they cannot be
 * chained. Text-primary tools and image-input converters are excluded.
 */
function isChainable(processor: ToolProcessor): boolean {
  if (processor.textPrimary) return false;
  return processor.accept.includes('pdf');
}

const chainableTools = allTools
  .filter((tool) => {
    const entry = getToolEntry(tool.slug);
    return entry.status === 'ready' && isChainable(entry.processor);
  })
  // The catalog lists some tools in two categories.
  .filter((tool, i, list) => list.findIndex((t) => t.slug === tool.slug) === i)
  .sort((a, b) => a.name.localeCompare(b.name));

function defaultValues(processor: ToolProcessor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of processor.fields ?? []) {
    out[field.key] = field.defaultValue ?? '';
  }
  return out;
}

export function WorkflowPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [picker, setPicker] = useState('');
  const [search, setSearch] = useState('');
  const [running, setRunning] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');

  const visibleTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chainableTools;
    return chainableTools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.includes(q)
    );
  }, [search]);

  const addStep = useCallback((slug: string) => {
    const entry = getToolEntry(slug);
    if (entry.status !== 'ready') return;
    setSteps((prev) => [
      ...prev,
      { id: crypto.randomUUID(), slug, values: defaultValues(entry.processor) },
    ]);
    setPicker('');
  }, []);

  const move = (id: string, delta: number) => {
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(i, 1);
      next.splice(j, 0, moved!);
      return next;
    });
  };

  const setValue = (id: string, key: string, value: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, values: { ...s.values, [key]: value } } : s
      )
    );
  };

  /* ------------------------------------------------------ templates ---- */

  const saveTemplate = () => {
    if (!templateName.trim() || steps.length === 0) return;
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    stored[templateName.trim()] = steps.map((s) => ({
      slug: s.slug,
      values: s.values,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setTemplateName('');
    setError(null);
    setProgress(`Saved template "${templateName.trim()}"`);
    window.setTimeout(() => setProgress(null), 2000);
  };

  const templates = useMemo(() => {
    if (typeof localStorage === 'undefined') return [];
    try {
      return Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch {
      return [];
    }
  }, [progress]);

  const loadTemplate = (name: string) => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const saved = stored[name] as {
      slug: string;
      values: Record<string, string>;
    }[];
    if (!saved) return;
    setSteps(
      saved.map((s) => ({
        id: crypto.randomUUID(),
        slug: s.slug,
        values: s.values,
      }))
    );
  };

  /* -------------------------------------------------------- running ---- */

  const run = async () => {
    if (files.length === 0 || steps.length === 0) return;
    setRunning('loading');
    setError(null);
    setResults([]);
    const log: StepResult[] = [];

    try {
      // Each document flows through the whole pipeline independently.
      const finals: OutFile[] = [];

      for (const source of files) {
        let current: File = source;

        for (const [index, step] of steps.entries()) {
          const entry = getToolEntry(step.slug);
          if (entry.status !== 'ready') {
            log.push({
              slug: step.slug,
              status: 'skipped',
              message: 'Tool unavailable',
              outputs: 0,
            });
            continue;
          }

          setProgress(
            `${source.name}: step ${index + 1} of ${steps.length} — ${step.slug}`
          );

          try {
            const result = await entry.processor.process({
              files: [current],
              values: step.values,
              extraFiles: {},
              onProgress: (message) =>
                setProgress(`${source.name}: ${step.slug} — ${message}`),
            });

            const nextPdf = result.files.find(
              (f) => f.mime === 'application/pdf' || f.name.endsWith('.pdf')
            );
            if (!nextPdf) {
              // A step that produces no PDF ends this document's chain.
              log.push({
                slug: step.slug,
                status: 'ok',
                message:
                  'Produced non-PDF output — kept as a final result and stopped chaining.',
                outputs: result.files.length,
              });
              finals.push(...result.files);
              current = null as unknown as File;
              break;
            }

            log.push({
              slug: step.slug,
              status: 'ok',
              message: result.message ?? 'Done',
              outputs: result.files.length,
            });
            current = new File(
              [new Uint8Array(nextPdf.bytes).buffer as ArrayBuffer],
              nextPdf.name,
              { type: 'application/pdf' }
            );
          } catch (e) {
            log.push({
              slug: step.slug,
              status: 'failed',
              message: e instanceof Error ? e.message : 'Failed',
              outputs: 0,
            });
            throw new Error(
              `Step ${index + 1} (${step.slug}) failed: ${
                e instanceof Error ? e.message : 'unknown error'
              }`,
              { cause: e }
            );
          }
        }

        if (current) {
          finals.push({
            name: current.name,
            bytes: new Uint8Array(await current.arrayBuffer()),
            mime: 'application/pdf',
          });
        }
      }

      if (finals.length === 0)
        throw new Error('The pipeline produced no output');
      downloadFiles(finals);
      setResults(log);
      setRunning('success');
      window.setTimeout(() => setRunning('idle'), 1800);
    } catch (e) {
      setResults(log);
      setError(e instanceof Error ? e.message : 'The pipeline failed');
      setRunning('error');
      window.setTimeout(() => setRunning('idle'), 2400);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="workspace-shell">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        tabIndex={-1}
        onChange={(e) => {
          setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
          e.currentTarget.value = '';
        }}
      />

      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            PDF Workflow
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {steps.length} step{steps.length === 1 ? '' : 's'} · {files.length}{' '}
            file{files.length === 1 ? '' : 's'}
          </span>
          <span className="truncate text-xs text-muted-foreground sm:hidden">
            {steps.length}s · {files.length}f
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

      <div className="flex flex-1 flex-col gap-4 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 lg:flex-row">
        {/* -------------------------------------------------- pipeline */}
        <div className="flex-1 space-y-3">
          <div className="surface-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">Input files</h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={14} color="currentColor" />
                Add PDFs
              </Button>
            </div>
            {files.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Add one or more PDFs. Each one runs through the whole pipeline
                independently.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash size={13} color="currentColor" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {steps.map((step, index) => {
            const entry = getToolEntry(step.slug);
            const tool = allTools.find((t) => t.slug === step.slug);
            const fields: ToolField[] =
              entry.status === 'ready' ? (entry.processor.fields ?? []) : [];
            const visible = fields.filter(
              (f) =>
                f.type !== 'file' &&
                (!f.showWhen ||
                  f.showWhen.equals.includes(step.values[f.showWhen.key] ?? ''))
            );

            return (
              <div key={step.id} className="surface-card p-4">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {tool?.name ?? step.slug}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(step.id, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === steps.length - 1}
                    onClick={() => move(step.id, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <button
                    type="button"
                    aria-label="Remove step"
                    className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() =>
                      setSteps((prev) => prev.filter((s) => s.id !== step.id))
                    }
                  >
                    <Trash size={14} color="currentColor" />
                  </button>
                </div>

                {visible.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {visible.map((field) => (
                      <ToolFieldControl
                        key={field.key}
                        field={field}
                        value={step.values[field.key] ?? ''}
                        onChange={(v) => setValue(step.id, field.key, v)}
                        compact
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="surface-card p-4">
            <h2 className="mb-2 text-sm font-bold text-foreground">
              Add a step
            </h2>
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Search tools…"
              className="mb-2"
              classNames={{
                field: 'h-11 sm:h-9',
                input: 'text-base sm:text-sm',
              }}
            />
            <Select
              value={picker || undefined}
              onValueChange={(slug) => {
                if (slug) addStep(slug);
              }}
            >
              <SelectTrigger className="h-11 sm:h-10">
                <SelectValue
                  placeholder={`Choose a tool… (${visibleTools.length} available)`}
                />
              </SelectTrigger>
              <SelectContent>
                {visibleTools.map((t) => (
                  <SelectItem key={t.slug} value={t.slug}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] text-ink-4">
              Only tools that take a PDF and return a PDF can be chained.
            </p>
          </div>
        </div>

        {/* ----------------------------------------------------- side */}
        <aside className="w-full shrink-0 space-y-3 lg:w-80">
          <div className="surface-card p-4">
            <h2 className="mb-2 text-sm font-bold text-foreground">Run</h2>
            {progress ? (
              <p className="mb-2 text-xs text-muted-foreground">{progress}</p>
            ) : null}
            {error ? (
              <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <StatefulButton
              type="button"
              state={running}
              loadingText="Running…"
              successText="Done"
              errorText="Failed"
              className="min-h-11 w-full sm:min-h-0"
              disabled={
                files.length === 0 ||
                steps.length === 0 ||
                running === 'loading'
              }
              onClick={() => void run()}
            >
              <span className="inline-flex items-center gap-1.5">
                <Download size={15} color="currentColor" />
                Run pipeline
              </span>
            </StatefulButton>

            {results.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {results.map((r, i) => (
                  <li
                    key={`${r.slug}-${i}`}
                    className={cn(
                      'rounded-lg px-2 py-1.5 text-[11px]',
                      r.status === 'ok'
                        ? 'bg-secondary/60 text-muted-foreground'
                        : 'bg-destructive/10 text-destructive'
                    )}
                  >
                    <span className="font-semibold">{r.slug}</span> —{' '}
                    {r.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="surface-card p-4">
            <h2 className="mb-2 text-sm font-bold text-foreground">
              Templates
            </h2>
            <div className="flex gap-2">
              <Input
                value={templateName}
                onChange={setTemplateName}
                placeholder="Template name"
                className="min-w-0 flex-1"
                classNames={{ root: 'gap-0', field: 'h-9' }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!templateName.trim() || steps.length === 0}
                onClick={saveTemplate}
              >
                Save
              </Button>
            </div>
            {templates.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {templates.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => loadTemplate(name)}
                      className="w-full rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-ink-4">
                Saved pipelines are kept in this browser only.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
