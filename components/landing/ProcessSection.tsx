"use client";

import { motion } from "framer-motion";
import type { StepItem } from "@/types/landing";
import { revealOnScroll, stagger, staggerItem } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface ProcessSectionProps {
  steps: StepItem[];
}

export function ProcessSection({ steps }: ProcessSectionProps) {
  return (
    <section id="journey" className="section-anchor">
      <div className="crypto-container grid items-start gap-12 py-20 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div className="lg:sticky lg:top-24">
          <SectionHeading
            align="left"
            eyebrow="Your journey"
            title="Trust that compounds with every healthy cycle"
            description="From first sign-in to a growing credit line, each step feeds the next. Nothing here requires a bank, a credit file or collateral."
          />
          <motion.div {...revealOnScroll} className="mt-8 rounded-card border border-border bg-surface p-5 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Score range</p>
            <div className="mt-3 h-2 w-full rounded-full bg-[image:var(--gradient-brand)]" aria-hidden="true" />
            <div className="mt-2 flex justify-between text-[11px] font-semibold text-fg-subtle">
              <span>0 · None</span>
              <span>300 · Beginner</span>
              <span>500 · Silver</span>
              <span>700 · Gold</span>
              <span>850+ · Platinum</span>
            </div>
          </motion.div>
        </div>

        <motion.ol
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="relative space-y-4 before:absolute before:bottom-6 before:left-[1.35rem] before:top-6 before:w-px before:bg-border"
        >
          {steps.map((step) => (
            <motion.li
              key={step.step}
              variants={staggerItem}
              className="relative flex gap-5 rounded-card border border-border bg-surface p-5 shadow-card"
            >
              <span
                className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full border-4 border-bg bg-primary font-display text-sm font-bold text-primary-fg"
                aria-hidden="true"
              >
                {step.step}
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-fg">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{step.description}</p>
              </div>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}
