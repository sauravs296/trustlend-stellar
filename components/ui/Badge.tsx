import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  // legacy aliases kept for existing call sites
  | "green"
  | "gold"
  | "blue"
  | "yellow";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Colour tone. `variant` is accepted as an alias. */
  tone?: BadgeTone;
  variant?: BadgeTone;
  /** Adds a small status dot before the label. */
  dot?: boolean;
  size?: "sm" | "md";
}

const TONE_CLASSES: Record<Exclude<BadgeTone, "green" | "gold" | "blue" | "yellow">, string> = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  primary: "bg-primary-soft text-primary-soft-fg border-transparent",
  success: "bg-success-soft text-success-soft-fg border-transparent",
  warning: "bg-warning-soft text-warning-soft-fg border-transparent",
  danger: "bg-danger-soft text-danger-soft-fg border-transparent",
  info: "bg-info-soft text-info-soft-fg border-transparent",
};

const LEGACY: Record<"green" | "gold" | "blue" | "yellow", keyof typeof TONE_CLASSES> = {
  green: "success",
  gold: "warning",
  blue: "info",
  yellow: "warning",
};

function resolveTone(tone?: BadgeTone): keyof typeof TONE_CLASSES {
  if (!tone) return "neutral";
  return tone in LEGACY ? LEGACY[tone as keyof typeof LEGACY] : (tone as keyof typeof TONE_CLASSES);
}

export function Badge({ children, tone, variant, dot = false, size = "md", className, ...props }: BadgeProps) {
  const resolved = resolveTone(tone ?? variant);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-wide",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        TONE_CLASSES[resolved],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
