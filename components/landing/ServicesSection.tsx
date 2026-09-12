"use client";

import { motion } from "framer-motion";
import { Activity, Globe2, ShieldCheck, Zap } from "lucide-react";
import type { HighlightContent, MetricItem } from "@/types/landing";
import { CountUp } from "@/components/ui/stat-card";
import { revealOnScroll, stagger, staggerItem } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface ServicesSectionProps {
  metrics: MetricItem[];
  content: HighlightContent;
}

const FEATURES = [
  {
    icon: Activity,
    title: "Behavior-based scoring",
    body: "Repayments, lending activity and transaction discipline move the score — not collateral or paid tasks.",
  },
  {
    icon: ShieldCheck,
    title: "Enforced by contracts",
    body: "Loan terms, escrow and defaults are handled by Soroban smart contracts you can read and verify.",
  },
  {
    icon: Zap,
    title: "Settles in seconds",
    body: "Stellar's rails move funds globally for a fraction of a cent, so payouts and repayments are instant.",
  },
  {
    icon: Globe2,
    title: "Built for emerging markets",
    body: "Designed for freelancers and gig workers who have income history but no bank credit file.",
  },
];

export function ServicesSection({ metrics, content }: ServicesSectionProps) {
  return (
    <section id="introduce" className="section-anchor">
      <div className="crypto-container">
        {/* Metric strip */}
        <motion.dl
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border lg:grid-cols-4"
        >
          {metrics.map((item) => (
            <motion.div key={item.label} variants={staggerItem} className="bg-surface px-6 py-6">
              <dt className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{item.label}</dt>
              <dd className="mt-2 font-display text-3xl font-extrabold tracking-tight text-fg">
                <CountUp value={item.value} />
              </dd>
            </motion.div>
          ))}
        </motion.dl>

        <div className="py-20 md:py-24">
          <SectionHeading eyebrow="Why TrustLend" title={content.title} description={content.description} />

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <motion.article
                key={title}
                variants={staggerItem}
                className="group rounded-card border border-border bg-surface p-6 shadow-card transition-transform duration-200 hover:-translate-y-0.5"
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-soft text-primary-soft-fg">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-fg">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{body}</p>
              </motion.article>
            ))}
          </motion.div>

          <motion.p
            {...revealOnScroll}
            className="mx-auto mt-10 max-w-2xl rounded-card border border-accent/30 bg-accent-soft/60 px-5 py-4 text-center text-sm font-medium text-accent-soft-fg"
          >
            {content.callout}
          </motion.p>
        </div>
      </div>
    </section>
  );
}
