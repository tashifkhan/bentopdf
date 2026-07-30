// Adapted from beui.dev/components/motion/theme-toggle
// Uses app ThemeProvider (not next-themes)

import { Moon, Sun } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { ActionSwapIcon } from '~/components/beui/action-swap'
import { useTheme, applyThemeClass, type Theme } from '~/features/theme/theme'
import { cn } from '~/lib/utils'

export type ThemeVariant = 'rectangle' | 'circle' | 'circle-blur'

export type RectStart =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center'
  | 'bottom-up'

export interface ThemeToggleProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'onClick'> {
  variant?: ThemeVariant
  start?: RectStart
  iconClassName?: string
}

const VT_STYLE_ID = 'beui-theme-toggle-vt'

const VT_CSS = `
html[data-beui-vt="rect"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
  z-index: 1;
}
html[data-beui-vt="rect"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-rect-reveal 450ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 2;
}
html[data-beui-vt="circle"]::view-transition-old(root),
html[data-beui-vt="circle-blur"]::view-transition-old(root) {
  animation: none;
  mix-blend-mode: normal;
  z-index: 1;
}
html[data-beui-vt="circle"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-reveal 650ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 2;
}
html[data-beui-vt="circle-blur"]::view-transition-new(root) {
  mix-blend-mode: normal;
  animation: beui-circle-blur-reveal 700ms cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 2;
}
@keyframes beui-rect-reveal {
  from { clip-path: var(--beui-vt-from, inset(100% 0 0 0)); }
  to   { clip-path: inset(0 0 0 0); }
}
@keyframes beui-circle-reveal {
  from { clip-path: circle(0% at var(--beui-vt-origin, 50% 100%)); }
  to   { clip-path: circle(150% at var(--beui-vt-origin, 50% 100%)); }
}
@keyframes beui-circle-blur-reveal {
  from {
    clip-path: circle(0% at var(--beui-vt-origin, 50% 100%));
    filter: blur(10px);
  }
  to {
    clip-path: circle(150% at var(--beui-vt-origin, 50% 100%));
    filter: blur(0px);
  }
}
/* Prevent FOUC double-paint during VT */
::view-transition-group(root) {
  animation-duration: 0.01ms;
}
@supports (view-transition-name: none) {
  ::view-transition-group(root) {
    animation-duration: 0.45s;
  }
}
`

const RECT_FROM: Record<RectStart, string> = {
  'top-left': 'inset(0 100% 100% 0)',
  'top-right': 'inset(0 0 100% 100%)',
  'bottom-left': 'inset(100% 100% 0 0)',
  'bottom-right': 'inset(100% 0 0 100%)',
  center: 'inset(50% 50% 50% 50%)',
  'bottom-up': 'inset(100% 0 0 0)',
}

const CIRCLE_ORIGIN: Record<RectStart, string> = {
  'top-left': '0% 0%',
  'top-right': '100% 0%',
  'bottom-left': '0% 100%',
  'bottom-right': '100% 100%',
  center: '50% 50%',
  'bottom-up': '50% 100%',
}

function originFromEvent(
  event: MouseEvent | PointerEvent | undefined,
): string | null {
  if (!event) return null
  const x = (event.clientX / window.innerWidth) * 100
  const y = (event.clientY / window.innerHeight) * 100
  return `${x.toFixed(2)}% ${y.toFixed(2)}%`
}

export function useThemeToggle({
  variant = 'circle-blur',
  start = 'center',
}: {
  variant?: ThemeVariant
  start?: RectStart
} = {}) {
  const { theme, setTheme } = useTheme()
  const reduce = useReducedMotion() ?? false
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (document.getElementById(VT_STYLE_ID)) return
    const el = document.createElement('style')
    el.id = VT_STYLE_ID
    el.textContent = VT_CSS
    document.head.appendChild(el)
  }, [])

  const isDark = mounted && theme === 'dark'

  const toggle = (event?: MouseEvent | PointerEvent) => {
    const next: Theme = isDark ? 'light' : 'dark'
    const root = document.documentElement

    const apply = () => {
      setTheme(next)
      applyThemeClass(next)
    }

    if (reduce || !('startViewTransition' in document)) {
      apply()
      return
    }

    if (variant === 'rectangle') {
      root.style.setProperty('--beui-vt-from', RECT_FROM[start])
      root.dataset.beuiVt = 'rect'
    } else {
      const origin = originFromEvent(event) ?? CIRCLE_ORIGIN[start]
      root.style.setProperty('--beui-vt-origin', origin)
      root.dataset.beuiVt = variant
    }

    // Disable CSS color transitions during VT so we don't double-animate
    root.dataset.themeSwitching = '1'

    const vt = (
      document as Document & {
        startViewTransition: (cb: () => void) => { finished: Promise<void> }
      }
    ).startViewTransition(() => {
      apply()
    })

    void vt.finished.finally(() => {
      delete root.dataset.beuiVt
      delete root.dataset.themeSwitching
      root.style.removeProperty('--beui-vt-from')
      root.style.removeProperty('--beui-vt-origin')
    })
  }

  return { isDark, mounted, toggle, theme }
}

export function ThemeToggle({
  variant = 'circle-blur',
  start = 'center',
  className,
  iconClassName,
  ...rest
}: ThemeToggleProps) {
  const { isDark, mounted, toggle } = useThemeToggle({ variant, start })

  return (
    <button
      type="button"
      aria-label={
        mounted && isDark ? 'Switch to light mode' : 'Switch to dark mode'
      }
      onClick={(e) => toggle(e)}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-lg border border-border bg-transparent text-foreground transition-colors hover:bg-primary/5',
        className,
      )}
      {...rest}
    >
      {mounted ? (
        <ActionSwapIcon
          value={isDark ? 'dark' : 'light'}
          animation="blur"
          className={cn('size-4', iconClassName)}
        >
          {isDark ? (
            <Sun className={cn('size-4', iconClassName)} />
          ) : (
            <Moon className={cn('size-4', iconClassName)} />
          )}
        </ActionSwapIcon>
      ) : (
        <span className={cn('size-4', iconClassName)} aria-hidden="true" />
      )}
    </button>
  )
}
