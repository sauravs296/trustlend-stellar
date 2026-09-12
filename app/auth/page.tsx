import { Suspense } from "react";
import { AuthPageClient } from "@/components/auth/AuthPageClient";
import { ReferralCodeStash } from "@/components/auth/ReferralCodeStash";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in — TrustLend",
  description: "Sign in or create your TrustLend account as a borrower or lender.",
};

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthPageSkeleton />}>
      {/* Remembers an invite code across the wallet sign-in round trip. */}
      <ReferralCodeStash />
      <AuthPageClient />
    </Suspense>
  );
}

function AuthPageSkeleton() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg" aria-busy="true" aria-label="Loading authentication">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </main>
  );
}
