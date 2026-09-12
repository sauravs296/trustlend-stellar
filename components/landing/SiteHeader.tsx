"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import type { NavItem } from "@/types/landing";
import { ThemeToggle } from "@/components/ThemeToggle";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EASE_OUT } from "@/lib/motion";

interface SiteHeaderProps {
  items: NavItem[];
  isAuthenticated?: boolean;
}

export function SiteHeader({ items, isAuthenticated = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const cta = isAuthenticated
    ? { href: "/dashboard", label: "Open dashboard" }
    : { href: "/auth", label: "Sign in with wallet" };

  return (
    <motion.header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled ? "border-border bg-bg/85 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <div className="crypto-container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="TrustLend home">
          <Image src="/logo.png" alt="" width={36} height={36} priority className="h-9 w-9 rounded-xl object-cover" />
          <span className="leading-tight">
            <strong className="block font-display text-base font-bold tracking-tight text-fg">TrustLend</strong>
            <small className="hidden text-[11px] text-fg-subtle sm:block">Behavior-first credit on Stellar</small>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href={cta.href} className={cn(buttonClasses({ size: "sm" }), "hidden sm:inline-flex")}>
            {cta.label}
          </Link>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-fg-muted lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <Menu className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            className="border-t border-border bg-bg lg:hidden"
            aria-label="Primary mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <div className="crypto-container flex flex-col gap-1 py-3">
              {items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  {item.label}
                </a>
              ))}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-3">
                <ThemeToggle />
                <Link href={cta.href} className={buttonClasses({ size: "sm" })} onClick={() => setOpen(false)}>
                  {cta.label}
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2"
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
