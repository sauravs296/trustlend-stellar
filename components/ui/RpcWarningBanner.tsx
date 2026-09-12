"use client";

import { useRpcHealth } from "@/components/RpcHealthProvider";
import { X, AlertTriangle, WifiOff } from "lucide-react";
import { cn } from "./cn";

export function RpcWarningBanner() {
  const { status, message, isDismissed, dismiss } = useRpcHealth();

  if (status === "healthy" || status === "checking" || isDismissed) return null;

  const isDown = status === "down";

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b px-4 py-3 text-sm sm:px-6 lg:px-8",
        isDown ? "border-danger/30 bg-danger-soft text-danger-soft-fg" : "border-warning/30 bg-warning-soft text-warning-soft-fg",
      )}
      role="alert"
      aria-live="polite"
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {isDown ? <WifiOff size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{isDown ? "RPC endpoint unavailable" : "RPC endpoint degraded"}</p>
        <p className="text-xs opacity-90">{message}</p>
      </div>
      <button
        type="button"
        className="-m-1 shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        onClick={dismiss}
        aria-label="Dismiss warning"
      >
        <X size={16} />
      </button>
    </div>
  );
}
