/**
 * lib/stellar/lifecycle-mode.ts
 *
 * Isomorphic switch for the on-chain loan lifecycle. Client components read
 * it to decide whether a loan request must be signed on the LendingContract
 * before it is submitted; the server reads it to decide whether to verify and
 * mirror. `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js
 * can inline the values into the browser bundle.
 *
 *   NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE=required  every loan lives on-chain
 *   NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE=off       database-only mode
 *   (unset)                                      "required" when a lending
 *                                                contract id is configured
 */

export type LifecycleMode = "required" | "off";

export function onchainLifecycleMode(): LifecycleMode {
  const explicit = (process.env.NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE ?? "").trim().toLowerCase();
  if (explicit === "off" || explicit === "false" || explicit === "0") return "off";
  if (explicit === "required" || explicit === "on" || explicit === "true") return "required";
  return process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID ? "required" : "off";
}

export function isOnchainLifecycleRequired(): boolean {
  return onchainLifecycleMode() === "required";
}
