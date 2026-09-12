"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { signInWithStellar } from "@/lib/auth/siws-client";
import { getDashboardPath } from "@/lib/auth/roles";
import { WalletSelectionModal } from "@/components/ui/WalletSelectionModal";
import { getStoredWalletProvider } from "@/lib/stellar/wallet";
import {
  getWalletProviderLabel,
  type StellarWalletProvider,
} from "@/lib/stellar/wallet-providers";

import { UserRole } from "@/lib/auth/roles";

interface StellarSignInButtonProps {
  className?: string;
  disabled?: boolean;
  role?: UserRole;
}

/**
 * "Sign in with Stellar" (SIWS / SEP-0010) button. Opens the wallet picker —
 * including WalletConnect for mobile wallets — then drives the wallet challenge
 * → sign → verify flow and, on success, routes to the user's dashboard.
 */
export function StellarSignInButton({ className, disabled, role }: StellarSignInButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const [provider, setProvider] = useState<StellarWalletProvider>("freighter");

  const signIn = async (selected: StellarWalletProvider) => {
    setProvider(selected);
    setIsLoading(true);
    setError(null);
    try {
      const result = await signInWithStellar(selected, role);
      router.push(getDashboardPath(result.role));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stellar sign-in failed.");
      setIsLoading(false);
    }
  };

  const waitingLabel =
    provider === "walletconnect"
      ? "Scan the QR code…"
      : `Waiting for ${getWalletProviderLabel(provider)}…`;

  return (
    <div className="space-y-2">
      <WalletSelectionModal
        open={showWalletSelection}
        busy={isLoading}
        selectedProvider={provider}
        title="Sign in with your Stellar wallet"
        description="Pick a wallet to sign the login challenge. Choose WalletConnect to scan a QR code with a mobile wallet."
        onSelect={(selected) => {
          // Close first: WalletConnect renders its QR code in its own overlay.
          setShowWalletSelection(false);
          void signIn(selected);
        }}
        onClose={() => setShowWalletSelection(false)}
      />

      <button
        type="button"
        id="siws-auth-btn"
        data-wallet-select-trigger
        className={cn(buttonClasses({ size: "lg" }), className)}
        onClick={() => {
          setError(null);
          // Default the picker to whichever wallet this browser used last. Read
          // on open rather than at mount: localStorage is not available during
          // SSR, and this also picks up a wallet connected since we rendered.
          setProvider(getStoredWalletProvider() ?? "freighter");
          setShowWalletSelection(true);
        }}
        disabled={isLoading || disabled}
      >
        {isLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.3 6.6 3.3-6.6 3.3-6.6-3.3L12 4.3ZM5 9.2l6 3v6.6l-6-3V9.2Zm14 0v6.6l-6 3v-6.6l6-3Z" />
          </svg>
        )}
        <span>{isLoading ? waitingLabel : "Sign in with Stellar"}</span>
      </button>

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
