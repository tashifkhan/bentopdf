import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { Settings, ShieldCheck } from 'reicon-react'
import { Button } from '~/components/beui/button'
import { ThemeToggle } from '~/components/beui/theme-toggle'
import { PageTransition } from '~/components/PageTransition'

export function AppShell({
  children,
  onOpenSettings,
}: {
  children: React.ReactNode
  onOpenSettings?: () => void
}) {
  return (
    <div className="app-shell">
      <motion.header
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-12 w-full max-w-[1120px] items-center justify-between gap-2 px-3 sm:h-14 sm:gap-3 sm:px-4">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 sm:gap-2.5"
            aria-label="BentoPDF home"
          >
            <motion.img
              src="/images/taf-pdf-mark.svg"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-[10px] border border-border sm:size-7"
              whileHover={{ rotate: -6, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <strong className="truncate text-[0.92rem] font-bold tracking-tight text-foreground">
                BentoPDF
              </strong>
              <small className="hidden text-[0.66rem] font-semibold uppercase tracking-[0.04em] text-ink-4 xs:inline sm:inline">
                Private document tools
              </small>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
              className="hidden items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-[0.7rem] font-bold text-success md:inline-flex"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" />
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
              <ShieldCheck size={12} color="currentColor" />
              On this device
            </motion.span>

            {/* Compact privacy pill on small screens */}
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-1 text-[0.65rem] font-bold text-success md:hidden"
              title="Files stay on this device"
            >
              <span className="relative flex size-1.5">
                <span className="relative inline-flex size-1.5 rounded-full bg-success" />
              </span>
              Local
            </span>

            {onOpenSettings ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={onOpenSettings}
                aria-label="Open settings"
                className="size-9 sm:size-8"
              >
                <Settings size={16} color="currentColor" />
              </Button>
            ) : null}

            {/* beUI view-transition theme toggle — no flash */}
            <ThemeToggle
              variant="circle-blur"
              start="center"
              className="size-9 sm:size-8"
              iconClassName="size-4"
            />
          </div>
        </div>
      </motion.header>

      <main className="app-main">
        <PageTransition>{children}</PageTransition>
      </main>

      <footer
        className="mt-auto border-t border-border bg-card/60"
        style={{
          paddingBottom: 'max(0px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 px-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-6">
          <div className="text-sm">
            <strong className="text-foreground">BentoPDF</strong>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Privacy-first PDF tools. Files stay in your browser.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            TanStack Start · Tailwind v4 · beUI · Reicon
          </p>
        </div>
      </footer>
    </div>
  )
}
