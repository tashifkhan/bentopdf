import type { Tool } from '~/data/tools'
import { ToolIcon } from '~/components/icons'
import { Upload } from 'reicon-react'

/**
 * Experimental shell only. The shipping product is the root Vite SIMPLE_MODE app
 * (all processors). This React rewrite does not embed HTML tools.
 */
export function GenericToolShell({ tool }: { tool: Tool }) {
  return (
    <div className="surface-card mx-auto w-full max-w-xl p-5 sm:p-7">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--ws-brand-soft)] text-[var(--ws-brand)]">
          <ToolIcon name={tool.icon} size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tool.name}</h1>
          <p className="mt-1 text-sm text-[var(--ws-ink-3)]">{tool.subtitle}</p>
        </div>
      </div>

      <div className="flex min-h-44 flex-col items-center justify-center rounded-[var(--ws-radius)] border border-dashed border-[var(--ws-line-strong)] bg-[var(--ws-surface-2)] px-4 py-10 text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--ws-brand-soft)] text-[var(--ws-brand)]">
          <Upload size={22} color="currentColor" />
        </span>
        <p className="text-sm font-semibold">Not ported to React yet</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--ws-ink-4)]">
          Use the main app for the full{' '}
          <strong className="text-[var(--ws-ink-2)]">{tool.name}</strong>{' '}
          processor:{' '}
          <code className="rounded bg-[var(--ws-surface)] px-1">bun run dev</code>{' '}
          at the repo root (not <code className="rounded bg-[var(--ws-surface)] px-1">web/</code>).
        </p>
      </div>
    </div>
  )
}
