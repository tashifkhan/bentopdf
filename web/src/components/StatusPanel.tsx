import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

/**
 * Centered status card for 404 / error states. Uses only CSS tokens (no
 * providers), so it renders correctly even outside the app shell.
 */
export function StatusPanel({
  code,
  title,
  children,
  actions,
  tone = 'neutral',
}: {
  code: string;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="surface-card w-full max-w-md p-6 text-center sm:p-8">
        <span
          className={cn(
            'mx-auto inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide',
            tone === 'danger'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-brand-soft text-brand'
          )}
        >
          {code}
        </span>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {children ? (
          <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      </div>
    </div>
  );
}

export const statusButton = {
  primary:
    'inline-flex h-10 cursor-pointer items-center justify-center rounded-[0.7rem] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-brand-hover',
  secondary:
    'inline-flex h-10 cursor-pointer items-center justify-center rounded-[0.7rem] border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary',
};
