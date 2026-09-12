"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { HowItWorksStep } from "@/types/landing";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EASE_OUT } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface HowItWorksSectionProps {
  steps: HowItWorksStep[];
}

/** How long each step stays on screen before the walkthrough advances. */
const STEP_DURATION_MS = 6000;

export function HowItWorksSection({ steps }: HowItWorksSectionProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  // Auto-advancing motion is disorienting for anyone who has asked the OS to
  // reduce it, so hold on one step and let them drive with the stepper instead.
  const autoplay = !prefersReducedMotion && !paused;

  useEffect(() => {
    if (!autoplay || steps.length < 2) return;
    const timer = setTimeout(() => {
      setActiveIndex((current) => (current + 1) % steps.length);
    }, STEP_DURATION_MS);
    return () => clearTimeout(timer);
    // activeIndex restarts the dwell timer each time the step changes, so a
    // manual selection gets a full turn rather than whatever time was left.
  }, [autoplay, activeIndex, steps.length]);

  const select = useCallback((index: number) => setActiveIndex(index), []);

  const onRailKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      setActiveIndex((current) => {
        const delta = event.key === "ArrowRight" ? 1 : -1;
        return (current + delta + steps.length) % steps.length;
      });
    },
    [steps.length],
  );

  if (steps.length === 0) return null;
  const active = steps[activeIndex];

  return (
    <section id="how-it-works" className="section-anchor bg-bg-subtle/60">
      <div className="crypto-container py-20 md:py-24">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps from wallet to funded loan"
          description="Every step is enforced by a Soroban contract you can read. Hover to pause the walkthrough."
        />

        <div
          className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          {/* ── Stepper rail ── */}
          <div
            className="flex flex-col gap-2"
            role="tablist"
            aria-label="How TrustLend works"
            onKeyDown={onRailKeyDown}
          >
            {steps.map((step, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  id={`how-tab-${step.id}`}
                  aria-selected={isActive}
                  aria-controls={`how-panel-${step.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => select(index)}
                  className={cn(
                    "relative flex w-full items-start gap-4 overflow-hidden rounded-card border p-4 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "border-primary/40 bg-surface shadow-card"
                      : "border-transparent bg-transparent hover:bg-surface/60",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-lg font-display text-sm font-bold",
                      isActive ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg-muted",
                    )}
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
                      {step.caption}
                    </span>
                    <span className={cn("mt-0.5 block font-display text-sm font-semibold sm:text-base", isActive ? "text-fg" : "text-fg-muted")}>
                      {step.title}
                    </span>
                  </span>

                  {/* Progress bar doubles as the countdown to the next step. */}
                  {isActive ? (
                    <motion.span
                      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
                      aria-hidden="true"
                      key={`${step.id}-${autoplay}`}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={
                        autoplay
                          ? { duration: STEP_DURATION_MS / 1000, ease: "linear" }
                          : { duration: 0.3, ease: "easeOut" }
                      }
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* ── Animated stage ── */}
          <div
            className="flex flex-col rounded-card border border-border bg-surface p-6 shadow-card sm:p-8"
            role="tabpanel"
            id={`how-panel-${active.id}`}
            aria-labelledby={`how-tab-${active.id}`}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
                className="flex-1"
              >
                <StepVisual visual={active.visual} animate={!prefersReducedMotion} />
                <h3 className="mt-6 font-display text-xl font-bold tracking-tight text-fg sm:text-2xl">{active.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fg-muted sm:text-base">{active.description}</p>
              </motion.div>
            </AnimatePresence>

            <a href="/auth" className={cn(buttonClasses({ size: "md" }), "mt-8 w-fit")}>
              Get started free
            </a>
          </div>
        </div>

        {/* Screen readers get the step change announced without the animation. */}
        <p className="sr-only" aria-live="polite">
          {`Step ${activeIndex + 1} of ${steps.length}: ${active.title}`}
        </p>
      </div>
    </section>
  );
}

/* ── Illustrations ───────────────────────────────────────────────────────── */

const PULSE = {
  animate: { opacity: [0.35, 1, 0.35] },
  transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const },
};

function StepVisual({
  visual,
  animate,
}: {
  visual: HowItWorksStep["visual"];
  animate: boolean;
}) {
  // Reduced motion still gets the diagram, just held still at full opacity.
  const pulse = animate ? PULSE : { animate: { opacity: 1 } };

  return (
    <div className="rounded-lg bg-bg-subtle p-4" aria-hidden="true">
      <svg viewBox="0 0 320 160" role="presentation" className="h-auto w-full">
        <defs>
          <linearGradient id="how-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        {visual === "wallet" ? (
          <g>
            <rect x="28" y="44" width="104" height="72" rx="12" fill="url(#how-grad)" opacity="0.16" />
            <rect x="28" y="44" width="104" height="72" rx="12" fill="none" stroke="url(#how-grad)" strokeWidth="2" />
            <circle cx="112" cy="80" r="7" fill="var(--primary)" />
            <motion.g {...pulse}>
              <path d="M140 80 H196" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="7 7" />
              <path d="M188 73 L196 80 L188 87" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
            </motion.g>
            <rect x="204" y="52" width="88" height="56" rx="12" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
            <path d="M232 80 l10 10 l20 -22" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        ) : null}

        {visual === "reputation" ? (
          <g>
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.rect
                key={i}
                x={44 + i * 40}
                width="26"
                rx="5"
                fill="url(#how-grad)"
                y={124 - (i + 1) * 16}
                height={(i + 1) * 16}
                initial={animate ? { scaleY: 0 } : false}
                animate={{ scaleY: 1 }}
                style={{ originY: 1, transformBox: "fill-box" }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: "easeOut" }}
              />
            ))}
            <path d="M32 128 H288" stroke="var(--border-strong)" strokeWidth="2" />
          </g>
        ) : null}

        {visual === "funding" ? (
          <g>
            <circle cx="62" cy="80" r="26" fill="url(#how-grad)" opacity="0.18" />
            <circle cx="62" cy="80" r="26" fill="none" stroke="url(#how-grad)" strokeWidth="2" />
            <rect x="126" y="56" width="68" height="48" rx="10" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2" />
            <rect x="150" y="72" width="20" height="18" rx="3" fill="var(--primary)" />
            <path d="M154 72 v-6 a6 6 0 0 1 12 0 v6" fill="none" stroke="var(--primary)" strokeWidth="2.5" />
            <circle cx="258" cy="80" r="26" fill="url(#how-grad)" opacity="0.18" />
            <circle cx="258" cy="80" r="26" fill="none" stroke="url(#how-grad)" strokeWidth="2" />
            <motion.circle
              cx="62"
              cy="80"
              r="5"
              fill="var(--accent)"
              animate={animate ? { cx: [62, 160, 258] } : { cx: 160 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
            />
          </g>
        ) : null}

        {visual === "repayment" ? (
          <g>
            <motion.path
              d="M40 118 C 96 118, 108 60, 160 60 S 232 34, 284 34"
              fill="none"
              stroke="url(#how-grad)"
              strokeWidth="3.5"
              strokeLinecap="round"
              initial={animate ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.6, ease: "easeOut" }}
            />
            <path d="M32 128 H288" stroke="var(--border-strong)" strokeWidth="2" />
            <motion.circle cx="284" cy="34" r="7" fill="var(--accent)" {...pulse} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
