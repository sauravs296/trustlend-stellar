"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { AboutContent, P2PStep } from "@/types/landing";
import { buttonClasses } from "@/components/ui/button";
import { revealOnScroll, stagger, staggerItem } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface AboutSectionProps {
  content: AboutContent;
  steps: P2PStep[];
}

export function AboutSection({ content, steps }: AboutSectionProps) {
  return (
    <section id="p2p" className="section-anchor">
      <div className="crypto-container py-20 md:py-24">
        <SectionHeading eyebrow="Peer to peer" title={content.title} description={content.description} />

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-4 md:grid-cols-3"
        >
          {steps.map((step, i) => (
            <motion.article
              key={step.step}
              variants={staggerItem}
              className="relative overflow-hidden rounded-card border border-border bg-surface p-6 shadow-card"
            >
              <span
                className="pointer-events-none absolute -right-3 -top-6 font-display text-[7rem] font-extrabold leading-none text-primary/5 dark:text-primary/10"
                aria-hidden="true"
              >
                {step.step}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-soft-fg">
                Step {step.step}
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-fg">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.description}</p>
              {i < steps.length - 1 && (
                <ArrowRight
                  className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-fg-subtle md:block"
                  aria-hidden="true"
                />
              )}
            </motion.article>
          ))}
        </motion.div>

        <motion.div {...revealOnScroll} className="mt-10 flex justify-center">
          <Link href="/auth" className={buttonClasses({ size: "lg" })}>
            Start a request
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
