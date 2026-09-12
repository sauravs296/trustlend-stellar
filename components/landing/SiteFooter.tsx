"use client";

import Image from "next/image";
import Link from "next/link";
import type { FooterLink } from "@/types/landing";

interface SiteFooterProps {
  links: FooterLink[];
}

const REPO_URL = "https://github.com/thisisouvik/trustlend-stellar";

export function SiteFooter({ links }: SiteFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-surface">
      <div className="crypto-container grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <Link href="/" className="flex items-center gap-2.5" aria-label="TrustLend home">
            <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-cover" />
            <span className="font-display text-lg font-bold tracking-tight text-fg">TrustLend</span>
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-fg-muted">
            Credit infrastructure built on real behavior, not collateral bias. Borrowers and lenders meet in one
            transparent network where every repayment strengthens the next opportunity.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
            Open source on GitHub
          </a>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle">Explore</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-fg-muted transition-colors hover:text-fg">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle">Project</h3>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[
              { label: "Contributing", href: `${REPO_URL}/blob/main/CONTRIBUTING.md` },
              { label: "Security policy", href: `${REPO_URL}/blob/main/SECURITY.md` },
              { label: "Smart contracts", href: `${REPO_URL}/tree/main/contracts` },
              { label: "Roadmap", href: `${REPO_URL}/blob/main/docs/roadmap.md` },
            ].map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noreferrer" className="text-fg-muted transition-colors hover:text-fg">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="crypto-container flex flex-col gap-2 py-5 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} TrustLend. MIT licensed.</p>
          <p>Running on Stellar testnet · Not financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
