"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { FaqItem } from "@/types/landing";
import { cn } from "@/components/ui/cn";
import { EASE_OUT, revealOnScroll } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface FaqSectionProps {
  items: FaqItem[];
}

export function FaqSection({ items }: FaqSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="section-anchor">
      <div className="crypto-container grid gap-10 py-20 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24">
          <SectionHeading
            align="left"
            eyebrow="FAQ"
            title="Questions, answered"
            description="Still unsure about something? The borrowing guide walks through the whole loan lifecycle with worked examples."
          />
          <motion.div {...revealOnScroll} className="mt-6">
            <Link href="/docs/borrowing" className="text-sm font-semibold text-primary hover:underline">
              Read the borrowing guide →
            </Link>
          </motion.div>
        </div>

        <motion.dl {...revealOnScroll} className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
          {items.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;
            return (
              <div key={item.question}>
                <dt>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-display text-sm font-semibold text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-base"
                  >
                    {item.question}
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200", isOpen && "rotate-180")}
                      aria-hidden="true"
                    />
                  </button>
                </dt>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.dd
                      id={panelId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-sm leading-relaxed text-fg-muted">{item.answer}</p>
                    </motion.dd>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.dl>
      </div>
    </section>
  );
}
