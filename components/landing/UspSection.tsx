"use client";

import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import type { ReasonItem } from "@/types/landing";
import { stagger, staggerItem } from "@/lib/motion";
import { SectionHeading } from "./SectionHeading";

interface UspSectionProps {
  items: ReasonItem[];
}

export function UspSection({ items }: UspSectionProps) {
  return (
    <section className="section-anchor bg-bg-subtle/60">
      <div className="crypto-container py-20 md:py-24">
        <SectionHeading
          eyebrow="Why it works"
          title="Built for people the credit system left out"
          description="Freelancers, gig workers and small traders have real financial histories. TrustLend turns that history into credit."
        />

        <motion.ul
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((item) => (
            <motion.li
              key={item.title}
              variants={staggerItem}
              className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5 text-sm font-medium text-fg shadow-sm"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              {item.title}
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
