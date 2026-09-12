"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { EASE_OUT } from "@/lib/motion";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 5000;
const TOAST_QUEUE_DELAY = 300;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isShowing, setIsShowing] = useState(false);
  const queueRef = useRef<Toast[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());

  const processQueueRef = useRef<(() => void) | null>(null);

  const processQueue = useCallback(() => {
    if (toasts.length >= 3 || queueRef.current.length === 0) {
      setIsShowing(false);
      return;
    }

    setIsShowing(true);

    const nextToast = queueRef.current.shift();
    if (!nextToast) return;

    const newToast: Toast = {
      ...nextToast,
      id: nextToast.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };

    shownIdsRef.current.add(newToast.id);

    setToasts((prev) => [...prev, newToast]);

    const duration = newToast.duration ?? TOAST_DURATION;

    timeoutRef.current = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      shownIdsRef.current.delete(newToast.id);

      // Process next toast in queue
      setTimeout(() => {
        setToasts((prev) => {
          if (prev.length === 0) {
            processQueueRef.current?.();
          }
          return prev;
        });
      }, TOAST_QUEUE_DELAY);
    }, duration);
  }, [toasts.length]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const toast = useCallback((toastData: Omit<Toast, "id">): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Skip if already showing this toast
    if (shownIdsRef.current.has(id)) {
      return id;
    }

    const newToast: Toast = { ...toastData, id };

    // If we have space, show immediately
    if (toasts.length < 3 && queueRef.current.length === 0 && !isShowing) {
      shownIdsRef.current.add(id);
      setToasts((prev) => [...prev, newToast]);

      const duration = newToast.duration ?? TOAST_DURATION;
      timeoutRef.current = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        shownIdsRef.current.delete(id);

        // Check queue for more toasts
        if (queueRef.current.length > 0) {
          setTimeout(processQueue, TOAST_QUEUE_DELAY);
        } else if (toasts.length === 1) {
          setIsShowing(false);
        }
      }, duration);

      return id;
    }

    // Add to queue
    queueRef.current.push(newToast);

    // Start processing if not already
    if (!isShowing && toasts.length === 0) {
      processQueue();
    }

    return id;
  }, [toasts.length, isShowing, processQueue]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    shownIdsRef.current.delete(id);

    // Process queue after dismiss
    if (queueRef.current.length > 0 && toasts.length <= 1) {
      setTimeout(processQueue, TOAST_QUEUE_DELAY);
    }
  }, [toasts.length, processQueue]);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setToasts([]);
    queueRef.current = [];
    shownIdsRef.current.clear();
    setIsShowing(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss, clear }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

function ToastContainer() {
  const { toasts, dismiss } = useContext(ToastContext)!;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-6 right-4 z-[9999] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-3 sm:right-6"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const TOAST_TONE: Record<ToastType, { icon: typeof CheckCircle2; classes: string }> = {
  success: { icon: CheckCircle2, classes: "bg-success-soft text-success-soft-fg" },
  error: { icon: XCircle, classes: "bg-danger-soft text-danger-soft-fg" },
  warning: { icon: AlertTriangle, classes: "bg-warning-soft text-warning-soft-fg" },
  info: { icon: Info, classes: "bg-info-soft text-info-soft-fg" },
};

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration ?? TOAST_DURATION);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const { icon: Icon, classes } = TOAST_TONE[toast.type];

  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      className="pointer-events-auto flex items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-lg"
    >
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${classes}`} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{toast.title}</p>
        {toast.message && <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{toast.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}