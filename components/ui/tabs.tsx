"use client";

import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "./cn";

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** `pill` sits in a soft track; `underline` is a flat text row. */
  variant?: "pill" | "underline";
  "aria-label"?: string;
}

/** Controlled tab list with an animated active indicator. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  variant = "pill",
  "aria-label": ariaLabel,
}: TabsProps<T>) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex w-fit max-w-full gap-1 overflow-x-auto",
        variant === "pill" ? "rounded-full bg-surface-2 p-1" : "border-b border-border",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              variant === "pill" ? "rounded-full px-4 py-1.5" : "px-3 py-2.5",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
              item.disabled && "opacity-50",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={springSnappy}
                className={cn(
                  "absolute inset-0 -z-10",
                  variant === "pill"
                    ? "rounded-full bg-surface shadow-sm"
                    : "inset-x-0 bottom-0 top-auto h-0.5 rounded-full bg-primary",
                )}
                aria-hidden="true"
              />
            )}
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
