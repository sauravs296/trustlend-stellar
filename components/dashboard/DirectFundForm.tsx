"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getConnectedWallet,
  getWalletProviderLabel,
  signTransactionWithWallet,
} from "@/lib/stellar/wallet";
import { FundingProgressBar } from "@/components/ui/FundingProgressBar";
import { TermTooltip } from "@/components/ui/TermTooltip";
import {
  calculateLenderReturn,
  getFundingProgress,
  validateFundingAmount,
} from "@/lib/loans/funding";

interface OpenLoan {
  id: string;
  principal_amount: number;
  /** Total already contributed by other lenders (Issue #269). */
  funded_amount?: number;
  lender_count?: number;
  apr_bps: number;
  duration_days: number;
  trust_score: number;
  borrower_wallet?: string | null;
}

interface DirectFundFormProps {
  loan: OpenLoan;
  onClose: () => void;
}

/**
 * Format an amount for the funding input at Stellar's full 7-decimal precision,
 * without trailing zeros.
 *
 * Rounding to 2 decimals here would make "Fund all" fall a fraction short of
 * the remainder and leave the loan stuck just under 100%.
 */
function toStellarAmountInput(value: number): string {
  return String(Number(value.toFixed(7)));
}

type Step =
  | "idle"
  | "connecting"
  | "building"
  | "signing"
  | "submitting"
  | "recording"
  | "done"
  | "error";

const STEP_LABELS: Record<Step, string> = {
  idle: "Ready to fund",
  connecting: "1/5 -- Connecting wallet...",
  building: "2/5 -- Building Stellar payment...",
  signing: "3/5 -- Waiting for signature...",
  submitting: "4/5 -- Submitting to Stellar network...",
  recording: "5/5 -- Recording on TrustLend...",
  done: "Success!",
  error: "Failed",
};

export function DirectFundForm({ loan, onClose }: DirectFundFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [explorerUrl, setExplorerUrl] = useState("");
  const [activeWalletLabel, setActiveWalletLabel] = useState("wallet");
  const [fundedFully, setFundedFully] = useState(false);

  const progress = useMemo(
    () => getFundingProgress(loan.principal_amount, loan.funded_amount ?? 0),
    [loan.principal_amount, loan.funded_amount],
  );

  // Default to filling the loan outright; the lender can dial it down to take
  // a smaller slice and leave the rest for others (Issue #269).
  const [amountInput, setAmountInput] = useState(() =>
    toStellarAmountInput(progress.remaining),
  );

  const validation = validateFundingAmount(amountInput, progress.remaining);
  const contribution = validation.ok ? validation.amount : 0;
  const { interest, total: totalReturn } = calculateLenderReturn(
    contribution,
    loan.apr_bps,
    loan.duration_days,
  );
  const interestXlm = interest.toFixed(4);
  const completesLoan =
    validation.ok && contribution >= progress.remaining - 1e-6;

  const borrowerWallet = loan.borrower_wallet ?? "";

  const handleFund = async () => {
    setErrorMsg("");

    // Re-validate at submit time: the input is free-form text.
    if (!validation.ok) {
      setErrorMsg(validation.error);
      setStep("error");
      return;
    }

    setStep("connecting");

    try {
      if (!borrowerWallet) {
        throw new Error(
          "Borrower has not connected a wallet yet. Cannot fund this loan.",
        );
      }

      // Step 1 -- Wallet connection
      const wallet = await getConnectedWallet();
      const lenderAddress = wallet.address;
      setActiveWalletLabel(getWalletProviderLabel(wallet.provider));

      if (lenderAddress === borrowerWallet) {
        throw new Error("You cannot fund your own loan.");
      }

      // Step 2 -- Build transaction
      setStep("building");
      const { TransactionBuilder, Networks, Operation, Asset, Memo, Account } =
        await import("@stellar/stellar-sdk");

      const horizonUrl =
        process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
        "https://horizon-testnet.stellar.org";

      const accountRes = await fetch(`${horizonUrl}/accounts/${lenderAddress}`);
      if (!accountRes.ok) {
        throw new Error(
          `Your account is not connected to the Stellar network. Fund it at: https://friendbot.stellar.org?addr=${lenderAddress}`,
        );
      }
      const accountData = await accountRes.json();
      const account = new Account(lenderAddress, accountData.sequence);

      const tx = new TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: borrowerWallet,
            asset: Asset.native(),
            amount: contribution.toFixed(7),
          }),
        )
        .addMemo(Memo.text(`TL-FUND:${loan.id.slice(0, 12)}`))
        .setTimeout(180)
        .build();

      const txXdr = tx.toXDR();

      // Step 3 -- Sign with selected wallet
      setStep("signing");
      const signResult = await signTransactionWithWallet({
        xdr: txXdr,
        networkPassphrase: Networks.TESTNET,
        address: lenderAddress,
        provider: wallet.provider,
      });

      // Step 4 -- Submit to Stellar
      setStep("submitting");
      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `tx=${encodeURIComponent(signResult.signedTxXdr)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok || !submitData.hash) {
        const detail =
          submitData?.extras?.result_codes?.transaction ??
          submitData?.detail ??
          "Unknown error";
        throw new Error(`Stellar submission failed: ${detail}`);
      }

      const txHash: string = submitData.hash;

      // Step 5 -- Record on TrustLend
      setStep("recording");
      const apiRes = await fetch("/api/loans/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loanId: loan.id,
          txHash,
          lenderAddress,
          amount: contribution,
        }),
      });

      if (!apiRes.ok) {
        const apiErr = await apiRes.json();
        throw new Error(apiErr.error ?? "Backend recording failed");
      }

      const apiData = await apiRes.json();
      setExplorerUrl(apiData.explorerUrl ?? "");
      setFundedFully(Boolean(apiData.isFullyFunded));
      setStep("done");

      setTimeout(() => {
        router.refresh();
        onClose();
      }, 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setStep("error");
    }
  };

  return (
    <div
      className="direct-fund-form"
      style={{
        padding: "1.75rem",
        border: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)",
        borderRadius: "1rem",
        background: "var(--surface)", // Clean white background for light theme
        boxShadow: "0 12px 40px color-mix(in srgb, var(--primary) 8%, transparent)",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "var(--fg)",
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
          }}
        >
          <span style={{ fontSize: "1.5rem" }}>🛡️</span>{" "}
          {progress.isPartiallyFunded ? "Top Up This Loan" : "Direct P2P Funding"}
        </h3>
        <span
          style={{
            fontSize: "0.75rem",
            color: "color-mix(in srgb, var(--fg) 40%, transparent)",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          STELLAR NETWORK
        </span>
      </div>

      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid color-mix(in srgb, var(--primary) 10%, transparent)",
          borderRadius: "0.75rem",
          padding: "1.25rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          className="direct-fund-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem 2rem",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 0.2rem 0",
                fontSize: "0.75rem",
                color: "color-mix(in srgb, var(--fg) 50%, transparent)",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Principal Amount
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--fg)",
              }}
            >
              {loan.principal_amount}{" "}
              <span style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)" }}>
                XLM
              </span>
            </p>
            <div style={{ marginTop: "0.6rem" }}>
              <FundingProgressBar
                principalAmount={loan.principal_amount}
                fundedAmount={loan.funded_amount ?? 0}
                lenderCount={loan.lender_count}
              />
            </div>
          </div>
          <div>
            <p
              style={{
                margin: "0 0 0.2rem 0",
                fontSize: "0.75rem",
                color: "color-mix(in srgb, var(--fg) 50%, transparent)",
                textTransform: "uppercase",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
              }}
            >
              Annual Return (APR)
              <TermTooltip term="APR" side="top" />
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              {(loan.apr_bps / 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <p
              style={{
                margin: "0 0 0.2rem 0",
                fontSize: "0.75rem",
                color: "color-mix(in srgb, var(--fg) 50%, transparent)",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Interest On Your Slice
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--fg)",
              }}
            >
              +{interestXlm}{" "}
              <span style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--fg) 40%, transparent)" }}>
                XLM
              </span>
            </p>
          </div>
          <div>
            <p
              style={{
                margin: "0 0 0.2rem 0",
                fontSize: "0.75rem",
                color: "color-mix(in srgb, var(--fg) 50%, transparent)",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Total Expected Back
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--fg)",
              }}
            >
              {totalReturn.toFixed(4)} XLM
            </p>
          </div>
        </div>

        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "1rem",
            borderTop: "1px dashed color-mix(in srgb, var(--fg) 10%, transparent)",
          }}
        >
          <label
            htmlFor={`fund-amount-${loan.id}`}
            style={{
              display: "block",
              margin: "0 0 0.4rem 0",
              fontSize: "0.75rem",
              color: "color-mix(in srgb, var(--fg) 50%, transparent)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Amount You Are Funding
          </label>

          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id={`fund-amount-${loan.id}`}
              type="number"
              min="0"
              max={progress.remaining}
              step="0.01"
              inputMode="decimal"
              value={amountInput}
              disabled={step !== "idle" && step !== "error"}
              onChange={(event) => setAmountInput(event.target.value)}
              aria-invalid={!validation.ok}
              aria-describedby={`fund-amount-help-${loan.id}`}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "0.6rem 0.75rem",
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--fg)",
                background: "var(--surface)",
                border: `1px solid ${validation.ok ? "color-mix(in srgb, var(--primary) 25%, transparent)" : "var(--danger)"}`,
                borderRadius: "0.5rem",
              }}
            />
            <button
              type="button"
              onClick={() => setAmountInput(toStellarAmountInput(progress.remaining))}
              disabled={step !== "idle" && step !== "error"}
              style={{
                padding: "0.6rem 0.9rem",
                fontSize: "0.78rem",
                fontWeight: 700,
                color: "var(--primary)",
                background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
                borderRadius: "0.5rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Fund all
            </button>
          </div>

          <p
            id={`fund-amount-help-${loan.id}`}
            style={{
              margin: "0.4rem 0 0",
              fontSize: "0.75rem",
              lineHeight: 1.45,
              color: validation.ok ? "color-mix(in srgb, var(--fg) 55%, transparent)" : "var(--danger)",
            }}
          >
            {!validation.ok
              ? validation.error
              : completesLoan
                ? `This completes the loan — it activates immediately at 100% funded.`
                : `You can fund up to ${progress.remaining.toFixed(2)} XLM. Other lenders can cover the rest; the loan activates only once it reaches 100%.`}
          </p>
        </div>

        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "1rem",
            borderTop: "1px dashed color-mix(in srgb, var(--fg) 10%, transparent)",
          }}
        >
          <p
            style={{
              margin: "0 0 0.4rem 0",
              fontSize: "0.75rem",
              color: "color-mix(in srgb, var(--fg) 50%, transparent)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Recipient Wallet Address
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: "monospace",
              fontSize: "0.85rem",
              color: "var(--primary)",
              wordBreak: "break-all",
            }}
          >
            {borrowerWallet || "⚠ No wallet registered"}
          </p>
        </div>
      </div>

      <div
        style={{
          padding: "0.85rem",
          background: "color-mix(in srgb, var(--primary) 5%, transparent)",
          borderRadius: "0.6rem",
          border: "1px solid color-mix(in srgb, var(--primary) 15%, transparent)",
          marginBottom: "1.5rem",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "color-mix(in srgb, var(--fg) 70%, transparent)",
            lineHeight: 1.5,
          }}
        >
          ℹ️ Your XLM will be sent directly to the borrower. TrustLend records
          the transaction hash to verify your claim to the repayment.
        </p>
      </div>

      {step !== "idle" && step !== "error" && step !== "done" && (
        <div
          style={{
            padding: "1rem",
            textAlign: "center",
            borderRadius: "0.75rem",
            background: "color-mix(in srgb, var(--primary) 5%, transparent)",
            border: "1px solid color-mix(in srgb, var(--primary) 20%, transparent)",
            marginBottom: "1.5rem",
            animation: "pulse 2s infinite",
          }}
        >
          <div style={{ fontSize: "1.25rem", marginBottom: "0.4rem" }}>⚡</div>
          <p
            style={{
              margin: 0,
              color: "var(--primary)",
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            {step === "connecting"
              ? `1/5 -- Connecting ${activeWalletLabel}...`
              : STEP_LABELS[step]}
          </p>
          <p
            style={{
              margin: "0.25rem 0 0 0",
              color: "color-mix(in srgb, var(--fg) 40%, transparent)",
              fontSize: "0.7rem",
            }}
          >
            Please do not close this window
          </p>
        </div>
      )}

      {step === "done" && (
        <div
          style={{
            padding: "1.25rem",
            textAlign: "center",
            borderRadius: "0.75rem",
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🎉</div>
          <p style={{ margin: 0, color: "var(--accent)", fontWeight: 700 }}>
            {fundedFully ? "Loan Fully Funded!" : "Contribution Confirmed!"}
          </p>
          <p
            style={{
              margin: "0.25rem 0 0.75rem 0",
              color: "color-mix(in srgb, var(--fg) 60%, transparent)",
              fontSize: "0.8rem",
            }}
          >
            {contribution.toFixed(2)} XLM has been sent on-chain.{" "}
            {fundedFully
              ? "The loan is now active."
              : "The loan stays open until it reaches 100%."}
          </p>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-block",
                color: "var(--accent)",
                fontSize: "0.8rem",
                textDecoration: "underline",
                fontWeight: 600,
              }}
            >
              Verify on Stellar Explorer ↗
            </a>
          )}
        </div>
      )}

      {step === "error" && (
        <div
          style={{
            padding: "1rem",
            borderRadius: "0.75rem",
            background: "color-mix(in srgb, var(--danger) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
            marginBottom: "1.5rem",
          }}
        >
          <p
            style={{
              margin: "0 0 0.25rem 0",
              color: "var(--danger)",
              fontWeight: 700,
              fontSize: "0.9rem",
            }}
          >
            Interaction Failed
          </p>
          <p
            style={{
              margin: 0,
              color: "color-mix(in srgb, var(--fg) 70%, transparent)",
              fontSize: "0.8rem",
              lineHeight: 1.4,
            }}
          >
            {errorMsg}
          </p>
        </div>
      )}

      <div
        className="direct-fund-actions"
        style={{ display: "flex", gap: "1rem" }}
      >
        <button
          onClick={handleFund}
          disabled={(step !== "idle" && step !== "error") || !validation.ok}
          className="workspace-button workspace-button--primary"
          style={{
            flex: 2,
            height: "3.25rem",
            fontSize: "1rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)",
            color: "var(--primary-fg)",
            boxShadow: "0 4px 15px color-mix(in srgb, var(--primary) 25%, transparent)",
            border: "none",
            borderRadius: "0.5rem",
            opacity: validation.ok ? 1 : 0.55,
            cursor:
              (step !== "idle" && step !== "error") || !validation.ok
                ? "not-allowed"
                : "pointer",
          }}
        >
          {step === "signing"
            ? `Check ${activeWalletLabel}...`
            : step === "done"
              ? "Returning..."
              : step === "error"
                ? "Try Again"
                : step !== "idle"
                  ? "Processing..."
                  : validation.ok
                    ? `Confirm & Send ${contribution.toFixed(2)} XLM`
                    : "Enter a valid amount"}
        </button>
        <button
          onClick={onClose}
          disabled={step !== "idle" && step !== "error" && step !== "done"}
          className="workspace-button workspace-button--secondary"
          style={{
            flex: 1,
            border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
            background: "var(--surface)",
            color: "var(--fg)",
            borderRadius: "0.5rem",
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0% {
            opacity: 0.8;
          }
          50% {
            opacity: 1;
          }
          100% {
            opacity: 0.8;
          }
        }

        @media (max-width: 640px) {
          .direct-fund-form {
            width: calc(100vw - 1rem);
            max-width: none !important;
            margin: 0 auto;
            padding: 1rem !important;
          }

          .direct-fund-grid {
            grid-template-columns: 1fr !important;
            gap: 0.9rem !important;
          }

          .direct-fund-actions {
            flex-direction: column;
          }

          .direct-fund-actions > button {
            width: 100%;
            min-width: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
