"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { formatCurrency } from "@/lib/utils/formatting";
import { buildStellarTxVerificationUrl, isLikelyTxHash } from "@/lib/stellar/explorer";

interface Transaction {
  id: string;
  type: "loan_requested" | "funding_received" | "repayment_made";
  loanId: string;
  amount: number;
  date: string;
  txHash: string;
  loanStatus: string;
}

interface TransactionListProps {
  apiEndpoint: string;
  initialTransactions?: Transaction[];
  initialHasMore?: boolean;
}

export function TransactionList({
  apiEndpoint,
  initialTransactions = [],
  initialHasMore = true,
}: TransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const observerTarget = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);
    try {
      const url = new URL(apiEndpoint, window.location.origin);
      if (cursor) {
        url.searchParams.set("cursor", cursor);
        url.searchParams.set("direction", "next");
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch");

      const data = await res.json();

      if (data.transactions.length === 0) {
        setHasMore(false);
      } else {
        setTransactions((prev) => {
          // Avoid duplicates
          const existingIds = new Set(prev.map((t) => t.id));
          const newTxns = data.transactions.filter(
            (t: Transaction) => !existingIds.has(t.id)
          );
          return [...prev, ...newTxns];
        });
        setHasMore(data.hasMore);
        setCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.error("Error loading more transactions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [apiEndpoint, cursor, hasMore, isLoading]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "100px" }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  if (transactions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "2.5rem", opacity: 0.5 }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📋</div>
        <p>No transactions yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {transactions.map((tx) => {
        const isRequested = tx.type === "loan_requested";
        const isFunding = tx.type === "funding_received";
        const isRepayment = tx.type === "repayment_made";
        const hasTx = isLikelyTxHash(tx.txHash);

        return (
          <div
            key={tx.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              padding: "0.9rem 1rem",
              borderRadius: "0.65rem",
              background: isRequested
                ? "color-mix(in srgb, var(--warning) 8%, transparent)"
                : isFunding
                  ? "color-mix(in srgb, var(--primary) 4%, transparent)"
                  : "color-mix(in srgb, var(--accent) 4%, transparent)",
              border: `1px solid ${
                isRequested
                  ? "color-mix(in srgb, var(--warning) 28%, transparent)"
                  : isFunding
                    ? "color-mix(in srgb, var(--primary) 12%, transparent)"
                    : "color-mix(in srgb, var(--accent) 12%, transparent)"
              }`,
              flexWrap: "wrap",
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                flexShrink: 0,
                background: isRequested
                  ? "color-mix(in srgb, var(--warning) 14%, transparent)"
                  : isFunding
                    ? "color-mix(in srgb, var(--primary) 10%, transparent)"
                    : "color-mix(in srgb, var(--accent) 10%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.1rem",
              }}
            >
              {isRequested ? "📝" : isFunding ? "📥" : "📤"}
            </div>

            {/* Details */}
            <div style={{ flex: 1, minWidth: "200px" }}>
              <p
                style={{
                  margin: 0,
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  color: "var(--fg)",
                }}
              >
                {isRequested
                  ? "Loan Request Created"
                  : isFunding
                    ? "Funding Received"
                    : "Repayment Made"}
              </p>
              <p
                style={{
                  margin: "0.15rem 0 0",
                  fontSize: "0.75rem",
                  color: "var(--fg-subtle)",
                  fontFamily: "monospace",
                }}
              >
                Loan #{tx.loanId.slice(0, 8)}
                {" · "}
                {tx.date ? new Date(tx.date).toLocaleString() : "—"}
              </p>
            </div>

            {/* Amount */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  color: isRequested ? "var(--warning)" : isFunding ? "var(--primary)" : "var(--accent)",
                }}
              >
                {isRequested ? "" : isRepayment ? "-" : "+"}
                {formatCurrency(tx.amount)}
              </p>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color:
                    tx.loanStatus === "repaid"
                      ? "var(--accent)"
                      : tx.loanStatus === "active" || tx.loanStatus === "funded"
                        ? "var(--warning)"
                        : "var(--fg-subtle)",
                }}
              >
                {tx.loanStatus || "—"}
              </span>
            </div>

            {/* Verify link */}
            {hasTx ? (
              <a
                href={buildStellarTxVerificationUrl(tx.txHash)}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "0.4rem",
                  background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "var(--accent)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                ✅ Verify on Stellar ↗
              </a>
            ) : isFunding ? (
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--border)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                ⏳ Awaiting TX
              </span>
            ) : isRequested ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "0.4rem",
                  background: "color-mix(in srgb, var(--warning) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--warning) 28%, transparent)",
                  fontSize: "0.72rem",
                  color: "var(--warning)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                🧾 Request recorded
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "0.4rem",
                  background: "color-mix(in srgb, var(--fg-muted) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--fg-muted) 15%, transparent)",
                  fontSize: "0.72rem",
                  color: "var(--fg-muted)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                📋 Off-chain record
              </span>
            )}
          </div>
        );
      })}

      {/* Loading indicator / Intersection target */}
      <div
        ref={observerTarget}
        style={{
          padding: "1rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {isLoading && (
          <span style={{ fontSize: "0.9rem", color: "var(--fg-muted)" }}>
            Loading more...
          </span>
        )}
        {!hasMore && transactions.length > 0 && (
          <span style={{ fontSize: "0.8rem", color: "var(--fg-subtle)" }}>
            No more transactions
          </span>
        )}
      </div>
    </div>
  );
}