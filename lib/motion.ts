/**
 * lib/motion.ts
 *
 * Shared framer-motion presets so every surface animates the same way.
 * Import the variants and spread them on `motion.*` elements:
 *
 *   <motion.div {...fadeUp}>…</motion.div>
 *   <motion.ul variants={stagger} initial="hidden" animate="show">
 *     <motion.li variants={staggerItem} />
 *   </motion.ul>
 *
 * All presets respect `prefers-reduced-motion` via `useReducedMotion` in the
 * components that use them; keep durations short so the UI feels quick.
 */

import type { Transition, Variants } from "framer-motion";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 };
export const springSoft: Transition = { type: "spring", stiffness: 180, damping: 24 };

/** Standard entrance for cards, sections and panels. */
export const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: EASE_OUT },
} as const;

/** Entrance that only fires when the element scrolls into view. */
export const revealOnScroll = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: EASE_OUT },
} as const;

/** Parent + child variants for staggered lists. */
export const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/** Subtle scale for modals and popovers. */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 4 },
  transition: { duration: 0.2, ease: EASE_OUT },
} as const;

/** Route-level page transition used by the dashboard shell. */
export const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: EASE_OUT },
} as const;

/** Hover/tap feedback for buttons and clickable cards. */
export const pressable = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.98 },
  transition: springSnappy,
} as const;
