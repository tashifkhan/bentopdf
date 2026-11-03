import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ArrowLeft, CloseCircle, Settings } from 'reicon-react';
import { ThemeToggle } from '~/components/beui/theme-toggle';
import { useSettings } from '~/features/settings/settings';
import { cn } from '~/lib/utils';

/**
 * Shared page chrome. The shell header and every full-screen workspace use
 * these, so settings and the theme toggle are reachable from every page.
 */

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5"
      aria-label="BentoPDF home"
    >
      <img
        src="/images/taf-pdf-mark.svg"
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-[10px] border border-border"
      />
      {compact ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <strong className="truncate text-[0.92rem] font-bold tracking-tight text-foreground">
            BentoPDF
          </strong>
          <small className="hidden text-[0.66rem] font-semibold uppercase tracking-[0.04em] text-ink-4 sm:inline">
            Private document tools
          </small>
        </span>
      )}
    </Link>
  );
}

export function HeaderControls() {
  const { openSettings } = useSettings();
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        onClick={openSettings}
        aria-label="Open settings"
        title="Settings"
      >
        <Settings size={16} color="currentColor" />
      </button>
      <ThemeToggle
        variant="circle-blur"
        start="center"
        // Explicit size/radius so tailwind-merge drops ThemeToggle's defaults
        // (utilities would otherwise beat .icon-btn in the cascade).
        className="icon-btn size-9 rounded-[0.7rem]"
        iconClassName="size-4"
      />
    </>
  );
}

export function PrivacyBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-1 text-[0.68rem] font-bold text-success md:px-2.5 md:text-[0.7rem]"
      title="Files stay on this device"
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full rounded-full bg-success opacity-40 motion-safe:animate-ping" />
        <span className="relative inline-flex size-1.5 rounded-full bg-success" />
      </span>
      <span className="md:hidden">Local</span>
      <span className="hidden md:inline">On this device</span>
    </span>
  );
}

/**
 * Header for full-viewport tools (multi-tool, editor, form creator, workflow).
 * Same height on every workspace so EditPdfPage's viewport math holds.
 */
export function WorkspaceHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark compact />
        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
        <div className="flex min-w-0 flex-col leading-tight sm:flex-row sm:items-baseline sm:gap-2">
          <h1 className="truncate text-sm font-bold text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {actions}
        <HeaderControls />
        <Link
          to="/"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[0.7rem] border border-border bg-secondary px-2.5 text-sm font-semibold text-foreground transition-colors hover:border-brand/40 sm:px-3"
          aria-label="Close and return to all tools"
        >
          <CloseCircle size={14} color="currentColor" />
          <span className="hidden sm:inline">Close</span>
        </Link>
      </div>
    </header>
  );
}

export function BackLink({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('back-link', className)}>
      <ArrowLeft size={14} color="currentColor" />
      All tools
    </Link>
  );
}
