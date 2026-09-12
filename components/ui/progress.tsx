import { cn } from "./cn";

interface ProgressProps {
  value: number;
  className?: string;
  tone?: "primary" | "accent" | "warning" | "danger";
  /** Accessible label; also used for the aria-valuetext. */
  label?: string;
}

const TONE = {
  primary: "bg-primary",
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Progress({ value, className, tone = "primary", label }: ProgressProps) {
  const bounded = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bounded)}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", TONE[tone])}
        style={{ width: `${bounded}%` }}
      />
    </div>
  );
}
