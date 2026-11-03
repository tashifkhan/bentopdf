import { Monitor, Moon, Sun, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'reicon-react';
import { BottomSheet } from '~/components/beui/bottom-sheet';
import { Button } from '~/components/beui/button';
import { useSettings, type LayoutMode } from '~/features/settings/settings';
import { useTheme, type ThemePreference } from '~/features/theme/theme';
import { EASE_DRAWER } from '~/lib/ease';
import { cn } from '~/lib/utils';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const desktop = useMediaQuery('(min-width: 640px)');
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus first control on open; restore focus to whatever opened it on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (opener && typeof opener.focus === 'function') {
        requestAnimationFrame(() => opener.focus());
      }
    };
  }, [open]);

  // Escape + focus trap (neither container ships one).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter((el) => el.tabIndex !== -1);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const body = <SettingsBody onClose={onClose} />;

  if (desktop) {
    return (
      <CenteredDialog open={open} onClose={onClose} panelRef={panelRef}>
        {body}
      </CenteredDialog>
    );
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Settings"
      description="Appearance and layout. Saved on this device."
      snapPoints={['auto', 0.92]}
      defaultSnap={0}
    >
      <div
        ref={panelRef}
        className="pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
      >
        {body}
      </div>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------ containers */

function CenteredDialog({
  open,
  onClose,
  panelRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-6">
          <motion.button
            type="button"
            aria-label="Close settings"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-[var(--ws-scrim)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[min(46rem,calc(100dvh-3rem))] w-full max-w-[36rem] flex-col overflow-hidden rounded-[1.25rem] border border-border bg-card shadow-panel"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.28, ease: EASE_DRAWER }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 pb-4 pt-5">
              <div>
                <h2
                  id={titleId}
                  className="text-base font-bold text-foreground"
                >
                  Settings
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Appearance and layout. Saved on this device.
                </p>
              </div>
              <button
                type="button"
                className="icon-btn -mr-1.5 border-transparent"
                onClick={onClose}
                aria-label="Close settings"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/* ---------------------------------------------------------------- body */

function SettingsBody({ onClose }: { onClose: () => void }) {
  const { layout, compact, setLayout, setCompact, reset } = useSettings();
  const { preference, setPreference } = useTheme();

  return (
    <div className="space-y-6 pt-2 sm:pt-0">
      <Section
        title="Theme"
        hint="System follows your device's light or dark setting."
      >
        <OptionGroup<ThemePreference>
          label="Theme"
          value={preference}
          onChange={setPreference}
          columns={3}
          autofocus
          options={[
            {
              value: 'light',
              label: 'Light',
              icon: <Sun className="size-4" />,
            },
            { value: 'dark', label: 'Dark', icon: <Moon className="size-4" /> },
            {
              value: 'system',
              label: 'System',
              icon: <Monitor className="size-4" />,
            },
          ]}
        />
      </Section>

      <Section
        title="Page width"
        hint="Applies to every page, including the full-screen tools. Only visible on screens wider than about 1200px."
      >
        <OptionGroup<LayoutMode>
          label="Page width"
          value={layout}
          onChange={setLayout}
          columns={2}
          options={[
            {
              value: 'fixed',
              label: 'Fixed',
              description: 'Centered column, 1152px max. Easy to scan.',
              preview: <LayoutPreview mode="fixed" />,
            },
            {
              value: 'wide',
              label: 'Wide',
              description: 'Fills large screens. More tools per row.',
              preview: <LayoutPreview mode="wide" />,
            },
          ]}
        />
      </Section>

      <Section
        title="Density"
        hint="Compact hides descriptions on the tool list."
      >
        <OptionGroup<'comfortable' | 'compact'>
          label="Density"
          value={compact ? 'compact' : 'comfortable'}
          onChange={(v) => setCompact(v === 'compact')}
          columns={2}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Section>

      <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary p-3.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
          <ShieldCheck size={16} color="currentColor" />
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">
            Private by design.
          </span>{' '}
          Every tool runs in your browser and nothing is uploaded. After the
          first visit the app also works offline.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Reset layout
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[0.7rem] font-bold uppercase tracking-[0.06em] text-ink-3">
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
      {hint ? <p className="mt-2 text-xs text-ink-4">{hint}</p> : null}
    </section>
  );
}

type Option<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  preview?: ReactNode;
};

/** Radio group drawn as cards. Arrow keys move the selection like native radios. */
function OptionGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  columns,
  autofocus,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  columns: 2 | 3;
  autofocus?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: ReactKeyboardEvent, index: number) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'grid gap-2',
        columns === 3 ? 'grid-cols-3' : 'grid-cols-2'
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-autofocus={autofocus && selected ? '' : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'group relative flex min-h-11 cursor-pointer flex-col rounded-xl border bg-card p-2.5 text-left transition-[border-color,background-color,box-shadow]',
              option.preview ? 'gap-2.5' : 'items-center justify-center',
              selected
                ? 'border-brand bg-brand-soft shadow-[0_0_0_1px_var(--ws-brand)]'
                : 'border-border hover:border-line-strong hover:bg-secondary'
            )}
          >
            {option.preview ? (
              <span className="block overflow-hidden rounded-lg border border-border bg-background">
                {option.preview}
              </span>
            ) : null}
            <span
              className={cn(
                'flex items-center gap-2 text-sm font-semibold',
                selected ? 'text-foreground' : 'text-ink-2',
                !option.preview && 'justify-center'
              )}
            >
              {option.icon ? (
                <span className={selected ? 'text-brand' : 'text-ink-3'}>
                  {option.icon}
                </span>
              ) : null}
              {option.label}
            </span>
            {option.description ? (
              <span className="-mt-1.5 text-xs leading-snug text-muted-foreground">
                {option.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Tiny wireframe of the page at each width so the choice is obvious. */
function LayoutPreview({ mode }: { mode: LayoutMode }) {
  const inset = mode === 'fixed' ? 22 : 6;
  const cols = mode === 'fixed' ? 3 : 5;
  const w = 120 - inset * 2;
  const gap = 3;
  const cardW = (w - gap * (cols - 1)) / cols;
  return (
    <svg viewBox="0 0 120 64" className="block h-auto w-full" aria-hidden>
      <rect x="0" y="0" width="120" height="9" fill="var(--ws-surface)" />
      <rect
        x={inset}
        y="3"
        width="14"
        height="3"
        rx="1.5"
        fill="var(--ws-ink-4)"
      />
      <rect
        x={inset}
        y="15"
        width={w * 0.55}
        height="4"
        rx="2"
        fill="var(--ws-ink-3)"
      />
      {[0, 1].map((row) =>
        Array.from({ length: cols }, (_, i) => (
          <rect
            key={`${row}-${i}`}
            x={inset + i * (cardW + gap)}
            y={25 + row * 18}
            width={cardW}
            height="14"
            rx="2.5"
            fill="var(--ws-surface)"
            stroke="var(--ws-line-strong)"
            strokeWidth="0.75"
          />
        ))
      )}
    </svg>
  );
}
