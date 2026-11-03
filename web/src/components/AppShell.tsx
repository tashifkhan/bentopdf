import { useRouterState } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { BrandMark, HeaderControls, PrivacyBadge } from '~/components/Chrome';
import { PageTransition } from '~/components/PageTransition';
import { isWorkspacePath } from '~/features/settings/workspace-routes';
import { cn } from '~/lib/utils';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const workspace = isWorkspacePath(pathname);
  const reduce = useReducedMotion();

  useEffect(() => {
    document.documentElement.classList.toggle('workspace-route', workspace);
    return () => {
      document.documentElement.classList.remove('workspace-route');
    };
  }, [workspace]);

  return (
    <div
      className={cn('app-shell', workspace && 'app-shell--workspace')}
      data-workspace={workspace ? 'true' : undefined}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-panel"
      >
        Skip to content
      </a>

      {!workspace ? (
        <motion.header
          // Same initial state on server and client; reduced motion just makes it instant.
          initial={{ y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
          }
          className="app-header"
        >
          <div className="app-chrome-inner">
            <BrandMark />
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <PrivacyBadge />
              <HeaderControls />
            </div>
          </div>
        </motion.header>
      ) : null}

      <main
        id="main"
        className={cn('app-main', workspace && 'app-main--workspace')}
      >
        {workspace ? children : <PageTransition>{children}</PageTransition>}
      </main>

      {!workspace ? (
        <footer
          className="mt-auto border-t border-border bg-card/60"
          style={{
            paddingBottom: 'max(0px, env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div className="app-chrome-inner flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-6">
            <div className="text-sm">
              <strong className="text-foreground">BentoPDF</strong>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Privacy-first PDF tools. Files stay in your browser.
              </p>
            </div>
            <p className="text-xs text-ink-4">
              TanStack Start · Tailwind v4 · beUI · Reicon
            </p>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
