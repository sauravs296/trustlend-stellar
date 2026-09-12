"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export function Tooltip({ children, content, side = "top", align = "center" }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={4}
            style={{
              background: "color-mix(in srgb, var(--fg) 95%, transparent)",
              border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--fg-inverse)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              maxWidth: "220px",
              lineHeight: 1.4,
              zIndex: 9999,
            }}
          >
            {content}
            <TooltipPrimitive.Arrow style={{ fill: "color-mix(in srgb, var(--primary) 40%, transparent)" }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
