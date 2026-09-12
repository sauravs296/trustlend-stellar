"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";
import { FocusTrap } from "./FocusTrap";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set false to keep the dialog open on backdrop click / Escape. */
  dismissible?: boolean;
  className?: string;
}

const SIZE = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Accessible modal dialog: portal, backdrop, focus trap, Escape to close,
 * body scroll lock and an animated entrance.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
}: DialogProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissible, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1000] flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            onClick={dismissible ? onClose : undefined}
            aria-hidden="true"
          />
          <FocusTrap active={open}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dialog-title"
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
              className={cn(
                "relative w-full rounded-card border border-border bg-surface text-fg shadow-lg",
                SIZE[size],
                className,
              )}
            >
              <div className="flex items-start justify-between gap-4 px-6 pt-6">
                <div>
                  <h2 id="dialog-title" className="font-display text-lg font-semibold tracking-tight">
                    {title}
                  </h2>
                  {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
                </div>
                {dismissible && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="-m-2 rounded-md p-2 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {children && <div className="px-6 py-5">{children}</div>}
              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </FocusTrap>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
