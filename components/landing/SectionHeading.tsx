"use client";

import { motion } from "framer-motion";
import { revealOnScroll } from "@/lib/motion";
import { cn } from "@/components/ui/cn";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  className?: string;
}

/** Consistent eyebrow / title / lede stack used at the top of every landing section. */
export function SectionHeading({ eyebrow, title, description, align = "center", className }: SectionHeadingProps) {
  return (
    <motion.div
      {...revealOnScroll}
      className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left", className)}
    >
      {eyebrow && (
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
      )}
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">{title}</h2>
      {description && <p className="mt-4 text-base leading-relaxed text-fg-muted sm:text-lg">{description}</p>}
    </motion.div>
  );
}
