"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Briefcase,
  ChevronRight,
  ClipboardList,
  Coins,
  FileCheck2,
  Gift,
  History,
  Home,
  Landmark,
  ListChecks,
  LogOut,
  Menu,
  Settings,
  ShieldAlert,
  Store,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { NotificationWidget } from "./NotificationWidget";
import { ThemeToggle } from "@/components/ThemeToggle";
import { RpcWarningBanner } from "@/components/ui/RpcWarningBanner";
import { StatCard } from "@/components/ui/stat-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/components/ui/cn";
import { EASE_OUT, pageTransition } from "@/lib/motion";

interface WorkspaceLink {
  href: string;
  label: string;
}

interface WorkspaceMetric {
  label: string;
  value: string;
}

interface ProfileSummary {
  completion: number;
  kycStatus: string;
  warningText: string;
  requiredItems: string[];
}

interface WorkspaceFrameProps {
  roleLabel: string;
  heading: string;
  description: string;
  email: string | null;
  userName?: string | null;
  metrics: WorkspaceMetric[];
  links: WorkspaceLink[];
  currentPath?: string;
  profilePath?: string;
  profileSummary?: ProfileSummary;
  headerWidget?: ReactNode;
  showProfileAlert?: boolean;
  children?: ReactNode;
}

/** Icon per nav destination, matched on the href/label so link lists stay plain data. */
function iconFor(link: WorkspaceLink): LucideIcon {
  const key = `${link.href} ${link.label}`.toLowerCase();
  if (/home|overview/.test(key)) return Home;
  if (/apply|loans/.test(key)) return Coins;
  if (/repay/.test(key)) return Wallet;
  if (/history|activity/.test(key)) return History;
  if (/task/.test(key)) return ListChecks;
  if (/refer/.test(key)) return Gift;
  if (/profile|settings/.test(key)) return Settings;
  if (/guide|docs/.test(key)) return BookOpen;
  if (/marketplace/.test(key)) return Store;
  if (/pool/.test(key)) return Landmark;
  if (/portfolio/.test(key)) return Briefcase;
  if (/risk|security/.test(key)) return ShieldAlert;
  if (/kyc/.test(key)) return FileCheck2;
  if (/user/.test(key)) return Users;
  return ClipboardList;
}

export function WorkspaceFrame({
  roleLabel,
  heading,
  description,
  userName,
  metrics,
  links,
  currentPath,
  profilePath,
  profileSummary,
  headerWidget,
  showProfileAlert = true,
  children,
}: WorkspaceFrameProps) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const resolvedPath = currentPath ?? pathname ?? links[0]?.href ?? "/dashboard";
  const resolvedProfilePath =
    profilePath ?? links.find((item) => /profile|settings/i.test(item.label))?.href ?? links[0]?.href ?? "/dashboard";
  const displayName = userName && userName.trim() !== "" ? userName.trim() : "User";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  const normalizedLinks = links.filter((item, i, all) => all.findIndex((x) => x.href === item.href) === i);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const { signOut } = await import("@/lib/auth/siws-client");
      await signOut();
      router.push("/auth");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-4 pt-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="TrustLend home">
          <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg object-cover" />
          <span className="font-display text-lg font-bold tracking-tight text-fg">TrustLend</span>
        </Link>
        <button
          type="button"
          onClick={() => setIsSidebarOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-surface-2 lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="px-5 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{roleLabel}</p>

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label={`${roleLabel} navigation`}>
        {normalizedLinks.map((item) => {
          const Icon = iconFor(item);
          const active = resolvedPath === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "text-primary-soft-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {active && (
                <motion.span
                  layoutId="workspace-nav-active"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-lg bg-primary-soft"
                  aria-hidden="true"
                />
              )}
              <Icon className="relative h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="relative truncate">{item.label}</span>
              {active && <ChevronRight className="relative ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>

      {showProfileAlert && profileSummary ? (
        <section className="mx-3 mb-3 rounded-card border border-warning/30 bg-warning-soft/60 p-4" aria-live="polite">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-warning-soft-fg">Action required</p>
          <p className="mt-1 font-display text-sm font-semibold text-fg">Profile &amp; KYC</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">{profileSummary.warningText}</p>
          <Progress
            value={profileSummary.completion}
            tone="warning"
            className="mt-3 bg-surface"
            label={`Profile ${profileSummary.completion}% complete`}
          />
          <p className="mt-1.5 text-[11px] text-fg-muted">{profileSummary.completion}% complete</p>
          {profileSummary.requiredItems.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-fg-muted">
              {profileSummary.requiredItems.map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-warning" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={resolvedProfilePath}
            className="mt-3 inline-flex h-8 items-center rounded-full bg-fg px-3 text-xs font-semibold text-fg-inverse transition-opacity hover:opacity-90"
          >
            Complete profile
          </Link>
        </section>
      ) : null}

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft font-display text-xs font-bold text-primary-soft-fg">
            {initials || "U"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{displayName}</p>
            <p className="truncate text-[11px] text-fg-subtle">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Mobile drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-overlay lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-surface shadow-lg lg:hidden"
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              aria-label="Dashboard sidebar"
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="mx-auto flex w-full max-w-[1440px]">
        {/* Desktop sidebar */}
        <aside
          className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-surface lg:block"
          aria-label="Dashboard sidebar"
        >
          {sidebar}
        </aside>

        <div className="min-w-0 flex-1">
          <RpcWarningBanner />
          <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/80 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface text-fg-muted hover:text-fg lg:hidden"
                  onClick={() => setIsSidebarOpen(true)}
                  aria-label="Open menu"
                  aria-expanded={isSidebarOpen}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate font-display text-lg font-bold tracking-tight sm:text-xl">{heading}</h1>
                  <p className="hidden truncate text-xs text-fg-muted sm:block">{description}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2" aria-label="Dashboard controls">
                {headerWidget ? <div className="hidden md:block">{headerWidget}</div> : null}
                <ThemeToggle />
                <NotificationWidget />
              </div>
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6 lg:px-8">
            {headerWidget ? <div className="mb-6 md:hidden">{headerWidget}</div> : null}

            {metrics.length > 0 && (
              <div
                className={cn(
                  "mb-6 grid gap-3 sm:gap-4",
                  metrics.length >= 4 ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-1 sm:grid-cols-3",
                )}
              >
                {metrics.map((metric, i) => (
                  <StatCard key={metric.label} label={metric.label} value={metric.value} index={i} />
                ))}
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.section
                key={pathname}
                {...(reduce ? {} : pageTransition)}
                className="workspace-content"
              >
                {children}
              </motion.section>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
