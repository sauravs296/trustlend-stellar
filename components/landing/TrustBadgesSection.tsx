"use client";

import { motion } from "framer-motion";
import { ExternalLink, FileCheck2, Link2, ShieldCheck, Unlock } from "lucide-react";
import type { TrustBadge } from "@/types/landing";
import { revealOnScroll, stagger, staggerItem } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface TrustBadgesSectionProps {
  badges: TrustBadge[];
}

const ICONS = {
  shield: ShieldCheck,
  verified: FileCheck2,
  openSource: Unlock,
  chain: Link2,
} as const;

export function TrustBadgesSection({ badges }: TrustBadgesSectionProps) {
  if (badges.length === 0) return null;

  return (
    <section id="security" className="section-anchor bg-bg-subtle/60">
      <div className="crypto-container py-20 md:py-24">
        <SectionHeading
          eyebrow="Security"
          title="Verifiable, not just promised"
          description="Every claim below links to something you can open and check — a policy, a workflow run, or the contract itself."
        />

        <motion.ul
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {badges.map((badge) => {
            const Icon = ICONS[badge.icon];
            return (
              <motion.li key={badge.label} variants={staggerItem}>
                <a
                  href={badge.href}
                  target={badge.external ? "_blank" : undefined}
                  rel={badge.external ? "noreferrer" : undefined}
                  className="group flex h-full flex-col rounded-card border border-border bg-surface p-5 shadow-card transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent-soft-fg">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="mt-4 flex items-center gap-1.5 font-display text-sm font-semibold text-fg">
                    {badge.label}
                    {badge.external && <ExternalLink className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />}
                  </span>
                  <span className="mt-1.5 text-sm leading-relaxed text-fg-muted">{badge.detail}</span>
                </a>
              </motion.li>
            );
          })}
        </motion.ul>

        <motion.p {...revealOnScroll} className="mt-8 text-center text-xs text-fg-subtle">
          TrustLend runs on Stellar testnet today. Contracts are open source and under continuous automated audit;
          no third-party certification is claimed.
        </motion.p>
      </div>
    </section>
  );
}
