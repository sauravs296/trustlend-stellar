import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const fieldBase = cn(
  "w-full rounded-md border border-border bg-surface px-3.5 text-sm text-fg placeholder:text-fg-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15",
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leftAddon, rightAddon, ...props },
  ref,
) {
  if (!leftAddon && !rightAddon) {
    return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />;
  }
  return (
    <div className="relative flex items-center">
      {leftAddon && (
        <span className="pointer-events-none absolute left-3 text-fg-subtle" aria-hidden="true">
          {leftAddon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(fieldBase, "h-10", leftAddon && "pl-9", rightAddon && "pr-14", className)}
        {...props}
      />
      {rightAddon && (
        <span className="pointer-events-none absolute right-3 text-xs font-semibold text-fg-muted">{rightAddon}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(fieldBase, "h-10 appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, laid out consistently. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
