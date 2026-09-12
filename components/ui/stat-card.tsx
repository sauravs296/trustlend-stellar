"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "./cn";

/**
 * Split a formatted metric like "1,234.5 XLM", "$110B+", "98.5%" or "42" into
 * the numeric part and its surrounding text so the number can count up while
 * the prefix/suffix render statically.
 */
function parseMetric(value: string): { prefix: string; number: number | null; suffix: string; decimals: number } {
  const match = value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!match) return { prefix: "", number: null, suffix: value, decimals: 0 };
  const [, prefix, num, suffix] = match;
  const cleaned = num.replace(/,/g, "");
  const decimals = cleaned.includes(".") ? cleaned.split(".")[1].length : 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? { prefix, number: parsed, suffix, decimals } : { prefix: "", number: null, suffix: value, decimals: 0 };
}

function formatNumber(n: number, decimals: number, grouped: boolean): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  }).format(n);
}

export interface CountUpProps {
  /** A formatted value such as "1,250 XLM" or "98.5%". */
  value: string;
  className?: string;
  duration?: number;
}

/** Renders a formatted metric, animating the numeric part from 0 on mount. */
export function CountUp({ value, className, duration = 1.1 }: CountUpProps) {
  const reduce = useReducedMotion();
  const { prefix, number, suffix, decimals } = parseMetric(value);
  const grouped = value.includes(",");
  // Reduced motion / non-numeric values render the final text immediately.
  const shouldAnimate = number !== null && !reduce;
  const [display, setDisplay] = useState(() => (shouldAnimate ? formatNumber(0, decimals, grouped) : null));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!shouldAnimate) return;
    const controls = animate(0, number, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(formatNumber(v, decimals, grouped)),
    });
    return () => controls.stop();
  }, [shouldAnimate, number, decimals, grouped, duration]);

  const text =
    number === null
      ? value
      : `${prefix}${shouldAnimate && display !== null ? display : formatNumber(number, decimals, grouped)}${suffix}`;

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {text}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: string;
  /** Optional secondary line under the value. */
  hint?: ReactNode;
  /** Percentage change; renders a coloured trend chip. */
  delta?: number;
  icon?: ReactNode;
  /** Accent colour for the icon tile. */
  tone?: "primary" | "accent" | "warning" | "danger" | "info" | "neutral";
  className?: string;
  /** Stagger index for entrance animation. */
  index?: number;
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary-soft text-primary-soft-fg",
  accent: "bg-accent-soft text-accent-soft-fg",
  warning: "bg-warning-soft text-warning-soft-fg",
  danger: "bg-danger-soft text-danger-soft-fg",
  info: "bg-info-soft text-info-soft-fg",
  neutral: "bg-surface-2 text-fg-muted",
};

export function StatCard({ label, value, hint, delta, icon, tone = "primary", className, index = 0 }: StatCardProps) {
  const reduce = useReducedMotion();
  const up = typeof delta === "number" && delta >= 0;
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 * index, ease: EASE_OUT }}
      className={cn(
        "group relative overflow-hidden rounded-card border border-border bg-surface p-5 shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</p>
        {icon && (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", TONE[tone])} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 font-display text-2xl font-bold tracking-tight text-fg md:text-[1.75rem]">
        <CountUp value={value} />
      </p>
      {(hint || typeof delta === "number") && (
        <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
          {typeof delta === "number" && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold",
                up ? "bg-success-soft text-success-soft-fg" : "bg-danger-soft text-danger-soft-fg",
              )}
            >
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100"
      />
    </motion.article>
  );
}
