import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Download,
} from 'reicon-react';
import { Button, StatefulButton } from '~/components/beui/button';
import {
  FileUpload,
  filesFromUploadItems,
  type FileUploadItem,
} from '~/components/beui/file-upload';
import { ToolIcon } from '~/components/icons';
import type { Tool } from '~/data/tools';
import { downloadFiles } from '~/lib/pdf/core';
import { getToolEntry } from './processors';
import { ToolFieldControl } from './ToolFieldControl';
import type { ProcessResult, ToolProcessor } from './types';

export function ToolWorkspace({ tool }: { tool: Tool }) {
  const entry = useMemo(() => getToolEntry(tool.slug), [tool.slug]);

  if (entry.status === 'unavailable') {
    return <UnavailableTool tool={tool} reason={entry.reason} />;
  }
  if (entry.status === 'workspace') {
    // Routed to a dedicated page upstream; nothing to render here.
    return null;
  }
  return <ReadyTool tool={tool} processor={entry.processor} />;
}

/* --------------------------------------------------------- unavailable */

function UnavailableTool({ tool, reason }: { tool: Tool; reason: string }) {
  return (
    <div className="tool-workspace">
      <ToolHeader tool={tool} />
      <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-amber-500">
            <AlertTriangle size={18} color="currentColor" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Not available in this build
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-4">
        This tool is listed because it exists in the catalog. Rather than run a
        different operation and hand you the wrong file, it does nothing.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- ready */

function ToolHeader({ tool }: { tool: Tool }) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand sm:size-11">
        <ToolIcon name={tool.icon} size={22} />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {tool.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{tool.subtitle}</p>
      </div>
    </header>
  );
}

function ReadyTool({
  tool,
  processor,
}: {
  tool: Tool;
  processor: ToolProcessor;
}) {
  const [uploadItems, setUploadItems] = useState<FileUploadItem[]>([]);
  const [extraFiles, setExtraFiles] = useState<Record<string, File[]>>({});
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of processor.fields ?? []) {
      init[field.key] = field.defaultValue ?? '';
    }
    return init;
  });
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const files = useMemo(() => filesFromUploadItems(uploadItems), [uploadItems]);

  const visibleFields = (processor.fields ?? []).filter((field) => {
    if (!field.showWhen) return true;
    return field.showWhen.equals.includes(values[field.showWhen.key] ?? '');
  });

  const run = async () => {
    setStatus('loading');
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const output = await processor.process({
        files,
        values,
        extraFiles,
        onProgress: (message) => setProgress(message),
      });
      if (!output.files.length) throw new Error('No output was produced');
      downloadFiles(output.files);
      setResult(output);
      setStatus('success');
      window.setTimeout(() => setStatus('idle'), 1800);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Processing failed');
      setStatus('error');
      window.setTimeout(() => setStatus('idle'), 2400);
    } finally {
      setProgress(null);
    }
  };

  const minFiles = processor.minFiles ?? 1;
  const needsFiles = !processor.textPrimary;
  const canRun = !needsFiles || files.length >= minFiles;

  return (
    <div className="tool-workspace">
      <ToolHeader tool={tool} />

      {processor.note ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-secondary/50 px-3 py-2.5">
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            <AlertCircle size={15} color="currentColor" />
          </span>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {processor.note}
          </p>
        </div>
      ) : null}

      {processor.rasterizes ? (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Output is rasterized — text in the result will not be selectable.
        </p>
      ) : null}

      <FileUpload
        className="mt-4 sm:mt-5"
        value={uploadItems}
        onValueChange={(items) => {
          setUploadItems(items);
          setError(null);
        }}
        accept={processor.accept}
        multiple={processor.multiple}
        maxFiles={processor.multiple ? undefined : 1}
        itemStatus="success"
        variant="centered"
        title={
          processor.textPrimary
            ? 'Optional: drop a file instead of pasting'
            : processor.multiple
              ? 'Drop files here'
              : 'Drop a file here'
        }
        description="Files never leave this device"
        browseLabel="Browse"
      />

      {visibleFields.length > 0 ? (
        <div className="mt-5 space-y-4">
          {visibleFields.map((field) => (
            <ToolFieldControl
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              files={extraFiles[field.key] ?? []}
              onChange={(v) =>
                setValues((prev) => ({ ...prev, [field.key]: v }))
              }
              onFiles={(list) =>
                setExtraFiles((prev) => ({ ...prev, [field.key]: list }))
              }
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {progress ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {progress}…
        </p>
      ) : null}

      {result?.message && status !== 'error' ? (
        <p className="mt-4 rounded-xl border border-border bg-secondary/60 px-3 py-2.5 text-sm text-muted-foreground">
          {result.message}
        </p>
      ) : null}

      {result?.preview ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            {result.preview.title}
          </p>
          <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed text-foreground sm:max-h-72">
            {result.preview.text}
          </pre>
        </div>
      ) : null}

      <div className="tool-actions tool-actions-sticky">
        {files.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full min-h-11 sm:w-auto sm:min-h-0"
            onClick={() => {
              setUploadItems([]);
              setError(null);
              setResult(null);
            }}
          >
            Clear
          </Button>
        ) : null}
        <StatefulButton
          type="button"
          state={status}
          loadingText={progress ?? 'Working…'}
          successText="Done"
          errorText="Failed"
          disabled={status === 'loading' || !canRun}
          onClick={() => void run()}
          data-primary-action
          className="w-full min-h-11 sm:w-auto sm:min-h-0 sm:min-w-[8rem]"
        >
          <span className="inline-flex items-center gap-1.5">
            <Download size={16} color="currentColor" />
            Run & download
          </span>
        </StatefulButton>
      </div>
    </div>
  );
}
