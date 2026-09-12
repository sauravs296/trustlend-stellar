"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles, TrendingUp, Wallet } from "lucide-react";
import type { HeroContent } from "@/types/landing";
import { buttonClasses } from "@/components/ui/button";
import { CountUp } from "@/components/ui/stat-card";
import { cn } from "@/components/ui/cn";
import { EASE_OUT } from "@/lib/motion";

interface HeroSectionProps {
  content: HeroContent;
  isAuthenticated?: boolean;
}

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: EASE_OUT },
});

export function HeroSection({ content, isAuthenticated = false }: HeroSectionProps) {
  const reduce = useReducedMotion();

  return (
    <section id="home" className="section-anchor relative overflow-hidden">
      {/* Background: soft brand glow + grid */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl dark:bg-primary/20" />
        <div className="absolute right-[-10%] top-[30%] h-[360px] w-[360px] rounded-full bg-accent/15 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
      </div>

      <div className="crypto-container relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div className="max-w-2xl">
          <motion.p
            {...enter(0.05)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-fg-muted shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {content.eyebrow}
          </motion.p>

          <motion.h1
            {...enter(0.15)}
            className="mt-6 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-6xl"
          >
            <span className="block">{content.titleMain}</span>
            <span className="block bg-[image:var(--gradient-brand)] bg-clip-text text-transparent">
              {content.titleAccent}
            </span>
          </motion.h1>

          <motion.p {...enter(0.25)} className="mt-6 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">
            {content.description}
          </motion.p>

          <motion.div {...enter(0.35)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={isAuthenticated ? "/dashboard" : "/auth"} className={buttonClasses({ size: "lg" })}>
              {isAuthenticated ? "Open dashboard" : "Get started"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className={buttonClasses({ size: "lg", variant: "outline" })}>
              See how it works
            </a>
          </motion.div>

          <motion.ul {...enter(0.45)} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted" aria-label="TrustLend highlights">
            {[
              { icon: Wallet, label: "Wallet sign-in, no passwords" },
              { icon: ShieldCheck, label: "Non-custodial on Stellar" },
              { icon: TrendingUp, label: "Score grows with every repayment" },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                {label}
              </li>
            ))}
          </motion.ul>
        </div>

        <HeroVisual animate={!reduce} />
      </div>
    </section>
  );
}

/** A mock "trust profile" card: the product's core object, rendered as UI rather than a stock illustration. */
function HeroVisual({ animate }: { animate: boolean }) {
  const bars = [42, 58, 51, 66, 74, 71, 83, 90];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.3, ease: EASE_OUT }}
      className="relative mx-auto w-full max-w-md"
      aria-hidden="true"
    >
      <motion.div
        animate={animate ? { y: [0, -8, 0] } : undefined}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="rounded-xl border border-border bg-surface p-6 shadow-glow"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">Trust score</p>
            <p className="mt-1 font-display text-5xl font-extrabold tracking-tight text-fg">
              <CountUp value="742" duration={1.6} />
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success-soft-fg">
            <TrendingUp className="h-3.5 w-3.5" /> Gold tier
          </span>
        </div>

        <div className="mt-6 flex h-24 items-end gap-1.5">
          {bars.map((h, i) => (
            <motion.span
              key={i}
              initial={animate ? { scaleY: 0 } : false}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.6, delay: 0.5 + i * 0.07, ease: EASE_OUT }}
              style={{ height: `${h}%`, transformOrigin: "bottom" }}
              className={cn("flex-1 rounded-t-md", i === bars.length - 1 ? "bg-primary" : "bg-primary/25")}
            />
          ))}
        </div>

        <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5">
          {[
            ["Credit limit", "7,420 XLM"],
            ["APR", "10.0%"],
            ["On-time", "100%"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{k}</dt>
              <dd className="mt-1 font-display text-sm font-bold text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.9, ease: EASE_OUT }}
        className="absolute -left-8 top-[58%] hidden rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-card sm:block"
      >
        <p className="font-semibold text-fg">Repayment received</p>
        <p className="text-fg-muted">+5 trust points · 120 XLM</p>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1.1, ease: EASE_OUT }}
        className="absolute -right-8 top-12 hidden rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-card sm:block"
      >
        <p className="font-semibold text-fg">Loan funded on-chain</p>
        <p className="font-mono text-[11px] text-fg-muted">tx 3f9c…a71e · Stellar testnet</p>
      </motion.div>
    </motion.div>
  );
}
