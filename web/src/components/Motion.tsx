import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

/** Stagger children into view (home sections, tool grids). */
export function Stagger({
  children,
  className,
  delay = 0,
  stagger = 0.04,
}: {
  children: ReactNode
  className?: string
  delay?: number
  stagger?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: reduce
            ? { duration: 0 }
            : { staggerChildren: stagger, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  )
}

export function FadeUp({
  children,
  className,
  delay = 0,
  ...rest
}: HTMLMotionProps<'div'> & { delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={cn(className)}
      variants={{
        hidden: reduce
          ? { opacity: 0 }
          : { opacity: 0, y: 14, filter: 'blur(6px)' },
        show: {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          transition: reduce
            ? { duration: 0.12 }
            : { duration: 0.4, ease: EASE, delay },
        },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export function ScaleIn({
  children,
  className,
  ...rest
}: HTMLMotionProps<'div'>) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        reduce
          ? { duration: 0.12 }
          : { type: 'spring', stiffness: 260, damping: 24 }
      }
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export { motion, useReducedMotion }
