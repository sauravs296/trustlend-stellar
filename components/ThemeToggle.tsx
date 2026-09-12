"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { springSnappy } from "@/lib/motion";

type ThemeValue = "light" | "dark" | "system";

const OPTIONS: Array<{ value: ThemeValue; icon: typeof Sun; label: string }> = [
  { value: "light", icon: Sun, label: "Light theme" },
  { value: "dark", icon: Moon, label: "Dark theme" },
  { value: "system", icon: Monitor, label: "Follow system theme" },
];

/**
 * ThemeToggle – Client Component
 *
 * A three-way segmented control (light / dark / system). The choice is
 * delegated to next-themes, which persists it to localStorage (under the
 * `trustlend-theme` key) and applies the `.dark` class before paint. The
 * default is `system`, so first-time visitors get their OS preference.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const layoutId = React.useId();

  React.useEffect(() => setMounted(true), []);

  // Before hydration, render the control without an active indicator so the
  // server and client markup match.
  const current = (mounted ? (theme as ThemeValue | undefined) : undefined) ?? "system";

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = mounted && current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`relative grid h-7 w-7 place-items-center rounded-full text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active ? "text-fg" : ""
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={springSnappy}
                className="absolute inset-0 rounded-full bg-surface shadow-sm"
                aria-hidden="true"
              />
            )}
            <Icon className="relative h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
