import { type ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Compact variant for table bodies and small panels. */
  size?: "sm" | "md";
}

export function EmptyState({ icon, title, description, action, className, size = "md" }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "md" ? "gap-3 px-6 py-12" : "gap-2 px-4 py-8",
        className,
      )}
    >
      {icon && (
        <span
          className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-fg"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <p className={cn("font-display font-semibold text-fg", size === "md" ? "text-base" : "text-sm")}>{title}</p>
      {description && <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
