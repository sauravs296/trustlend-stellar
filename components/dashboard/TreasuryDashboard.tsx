"use client";

import React, { useState, useEffect } from "react";
import {
  Vault,
  TrendingUp,
  ShieldCheck,
  Building2,
  ArrowUpRight,
  RefreshCw,
  PieChart,
  CheckCircle2,
  DollarSign,
  Users,
  FileSignature,
  Send,
  Lock,
  Check,
  AlertCircle,
  Clock,
  X,
  ExternalLink,
} from "lucide-react";
import { TreasuryDashboardSkeleton } from "@/components/dashboard/ChartSkeleton";
import type {
  TreasuryMultisigProposal,
  TreasurySigner,
  TreasuryProposalAction,
} from "@/lib/treasury/multisig";

interface HistoryRecord {
  id: number;
  timestamp: string;
  asset: string;
  insuranceAmount: number;
  daoAmount: number;
  status: string;
  txHash: string;
  signaturesCount?: number;
  approvedBy?: string[];
}

interface TreasuryData {
  currentBalance: number;
  totalCollected: number;
  totalDistributedInsurance: number;
  totalDistributedDao: number;
  rules: {
    insuranceShareBps: number;
    daoShareBps: number;
  };
  asset: string;
  multisig: {
    threshold: number;
    totalSigners: number;
    signers: TreasurySigner[];
    activeProposals: TreasuryMultisigProposal[];
    executedProposals: TreasuryMultisigProposal[];
  };
  history: HistoryRecord[];
}

export function TreasuryDashboard() {
  const [data, setData] = useState<TreasuryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Active connected signer address (defaults to Admin 1)
  const [activeSignerAddress, setActiveSignerAddress] = useState<string>("");

  // Propose Modal State
  const [isProposeOpen, setIsProposeOpen] = useState<boolean>(false);
  const [proposeActionType, setProposeActionType] = useState<"distribute" | "collect_fees" | "transfer">("distribute");
  const [proposeTitle, setProposeTitle] = useState<string>("");
  const [proposeDescription, setProposeDescription] = useState<string>("");
  const [proposeAmount, setProposeAmount] = useState<string>("");
  const [proposeRecipient, setProposeRecipient] = useState<string>("");

  const fetchTreasuryData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/treasury");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (!activeSignerAddress && json.multisig?.signers?.length > 0) {
          setActiveSignerAddress(json.multisig.signers[0].address);
        }
      }
    } catch (err) {
      console.error("Failed to fetch treasury data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTreasuryData();
  }, []);

  const handleProposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading("propose");
    setMessage(null);

    try {
      const amountNum = parseFloat(proposeAmount) || (data?.currentBalance ?? 1000);
      let actionPayload: TreasuryProposalAction;

      if (proposeActionType === "distribute") {
        actionPayload = {
          type: "distribute",
          asset: data?.asset ?? "USDC",
          amount: amountNum,
          insuranceShareBps: data?.rules.insuranceShareBps ?? 5000,
          daoShareBps: data?.rules.daoShareBps ?? 5000,
        };
      } else if (proposeActionType === "collect_fees") {
        actionPayload = {
          type: "collect_fees",
          asset: data?.asset ?? "USDC",
          amount: amountNum,
        };
      } else {
        actionPayload = {
          type: "transfer",
          asset: data?.asset ?? "USDC",
          amount: amountNum,
          recipient: proposeRecipient || "GBDAO...TREASURY",
          memo: proposeDescription,
        };
      }

      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          signerAddress: activeSignerAddress,
          title: proposeTitle || `Treasury ${proposeActionType.replace("_", " ").toUpperCase()}`,
          description: proposeDescription || "Multi-sig treasury operation proposal",
          proposalData: { action: actionPayload },
        }),
      });

      const result = await res.json();
      if (res.ok) {
        setData(result.data);
        setMessage({ type: "success", text: result.message });
        setIsProposeOpen(false);
        setProposeTitle("");
        setProposeDescription("");
        setProposeAmount("");
        setProposeRecipient("");
      } else {
        setMessage({ type: "error", text: result.error || "Failed to propose transaction" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error while submitting proposal." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSignProposal = async (proposalId: number) => {
    setActionLoading(`sign-${proposalId}`);
    setMessage(null);

    try {
      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          proposalId,
          signerAddress: activeSignerAddress,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        setData(result.data);
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.error || "Signing failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to sign proposal." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeSignature = async (proposalId: number) => {
    setActionLoading(`revoke-${proposalId}`);
    setMessage(null);

    try {
      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revoke",
          proposalId,
          signerAddress: activeSignerAddress,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        setData(result.data);
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.error || "Revocation failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to revoke signature." });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecuteProposal = async (proposalId: number) => {
    setActionLoading(`execute-${proposalId}`);
    setMessage(null);

    try {
      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          proposalId,
          signerAddress: activeSignerAddress,
        }),
      });

      const result = await res.json();
      if (res.ok) {
        setData(result.data);
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.error || "Execution failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to execute multi-sig transaction." });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !data) {
    return <TreasuryDashboardSkeleton />;
  }

  const currentBalance = data?.currentBalance ?? 0;
  const totalCollected = data?.totalCollected ?? 0;
  const totalInsurance = data?.totalDistributedInsurance ?? 0;
  const totalDao = data?.totalDistributedDao ?? 0;
  const insurancePct = ((data?.rules.insuranceShareBps ?? 5000) / 100).toFixed(0);
  const daoPct = ((data?.rules.daoShareBps ?? 5000) / 100).toFixed(0);

  const signers = data?.multisig?.signers ?? [];
  const activeProposals = data?.multisig?.activeProposals ?? [];
  const executedProposals = data?.multisig?.executedProposals ?? [];
  const threshold = data?.multisig?.threshold ?? 3;
  const totalSigners = data?.multisig?.totalSigners ?? 5;

  const currentSigner = signers.find((s) => s.address === activeSignerAddress);

  return (
    <div className="space-y-8 p-6 bg-surface text-fg rounded-2xl border border-border shadow-xl">
      {/* ── Header with 3-of-5 Badge & Propose Button ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary-soft text-primary rounded-xl border border-primary/20">
              <Vault className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-fg tracking-tight">
                  Protocol Multi-Signature Treasury
                </h1>
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-accent-soft text-accent border border-accent/30 rounded-full text-xs font-bold">
                  <Lock className="w-3.5 h-3.5" />
                  {threshold} of {totalSigners} Multi-Sig Security
                </span>
              </div>
              <p className="text-sm text-fg-muted mt-0.5">
                All platform treasury operations require 3 of 5 authorized admin signatures before execution.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setIsProposeOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary text-fg font-medium text-sm rounded-xl transition-all shadow-lg shadow-primary/20"
          >
            <FileSignature className="w-4 h-4" />
            Propose Transaction
          </button>
        </div>
      </div>

      {/* ── Action Notification Alert ── */}
      {message && (
        <div
          className={`flex items-center justify-between gap-2 p-4 rounded-xl text-sm border ${
            message.type === "success"
              ? "bg-accent-soft border-accent/30 text-accent"
              : "bg-danger-soft border-danger/30 text-danger-soft-fg"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="p-1 hover:bg-surface-2 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Active Admin Signer Selection Bar ── */}
      <div className="p-4 bg-surface-2 rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-info-soft text-primary rounded-lg border border-info/20">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider block">
              Current Connected Signer
            </span>
            <span className="text-sm font-bold text-fg">
              {currentSigner?.name ?? "Admin Signer"} ({currentSigner?.role})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-fg-muted font-medium whitespace-nowrap">
            Switch Admin Signer:
          </label>
          <select
            value={activeSignerAddress}
            onChange={(e) => setActiveSignerAddress(e.target.value)}
            className="bg-surface border border-border text-fg text-xs rounded-lg px-3 py-2 focus:ring-2 focus:ring-ring focus:outline-none"
          >
            {signers.map((signer) => (
              <option key={signer.address} value={signer.address}>
                {signer.name} — {signer.role}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Treasury Balance & Metrics Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="p-5 bg-surface-2 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between text-fg-muted text-xs font-semibold uppercase tracking-wider">
            <span>Treasury Vault</span>
            <DollarSign className="w-4 h-4 text-accent" />
          </div>
          <div className="text-2xl font-extrabold text-fg">
            ${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-fg-muted">Vault balance awaiting distribution</p>
        </div>

        <div className="p-5 bg-surface-2 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between text-fg-muted text-xs font-semibold uppercase tracking-wider">
            <span>Total Collected Fees</span>
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-extrabold text-fg">
            ${totalCollected.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-fg-muted">All-time protocol lending revenue</p>
        </div>

        <div className="p-5 bg-surface-2 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between text-fg-muted text-xs font-semibold uppercase tracking-wider">
            <span>Insurance Fund ({insurancePct}%)</span>
            <ShieldCheck className="w-4 h-4 text-info" />
          </div>
          <div className="text-2xl font-extrabold text-fg">
            ${totalInsurance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-fg-muted">Default & liquidation protection</p>
        </div>

        <div className="p-5 bg-surface-2 rounded-xl border border-border space-y-2">
          <div className="flex items-center justify-between text-fg-muted text-xs font-semibold uppercase tracking-wider">
            <span>DAO Treasury ({daoPct}%)</span>
            <Building2 className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-extrabold text-fg">
            ${totalDao.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-fg-muted">Community & tokenholder pool</p>
        </div>
      </div>

      {/* ── Active Multi-Sig Proposals Queue (Propose & Sign UI) ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-fg">Active Multi-Signature Proposals</h2>
          </div>
          <span className="text-xs px-2.5 py-1 bg-primary-soft text-primary border border-primary/20 rounded-full font-semibold">
            {activeProposals.length} Pending Approval
          </span>
        </div>

        {activeProposals.length === 0 ? (
          <div className="p-8 text-center bg-surface-2/20 rounded-xl border border-border text-fg-muted text-sm">
            <CheckCircle2 className="w-8 h-8 mx-auto text-accent/60 mb-2" />
            <p className="font-semibold text-fg">All proposals executed</p>
            <p className="text-xs text-fg-muted mt-1">
              Click &quot;Propose Transaction&quot; above to create a new multi-sig treasury request.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activeProposals.map((prop) => {
              const hasSigned = prop.approvals.some(
                (a) => a.toLowerCase() === activeSignerAddress.toLowerCase()
              );
              const isReady = prop.approvals.length >= prop.threshold;
              const isBusy = actionLoading === `sign-${prop.id}` || actionLoading === `execute-${prop.id}` || actionLoading === `revoke-${prop.id}`;

              return (
                <div
                  key={prop.id}
                  className="p-5 bg-surface-2 rounded-xl border border-border space-y-4 hover:border-border-strong transition-colors shadow-lg"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs font-mono font-bold text-primary bg-primary-soft px-2 py-0.5 rounded border border-primary/20">
                          #{prop.id}
                        </span>
                        <h3 className="text-base font-bold text-fg">{prop.title}</h3>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                            isReady
                              ? "bg-accent-soft text-accent border border-accent/30"
                              : "bg-warning-soft text-warning-soft-fg border border-warning/30"
                          }`}
                        >
                          {isReady ? "Ready to Execute" : "Collecting Signatures"}
                        </span>
                      </div>
                      <p className="text-xs text-fg mt-1">{prop.description}</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {!hasSigned ? (
                        <button
                          onClick={() => handleSignProposal(prop.id)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary text-fg text-xs font-semibold rounded-lg transition-all shadow-md shadow-primary/20 disabled:opacity-50"
                        >
                          {actionLoading === `sign-${prop.id}` ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <FileSignature className="w-3.5 h-3.5" />
                          )}
                          Sign Proposal
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRevokeSignature(prop.id)}
                          disabled={isBusy || isReady}
                          className="flex items-center gap-1.5 px-3 py-2 bg-surface-2/80 hover:bg-surface-2 text-fg text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
                          title="Revoke your signature"
                        >
                          <X className="w-3.5 h-3.5" />
                          Revoke Signature
                        </button>
                      )}

                      <button
                        onClick={() => handleExecuteProposal(prop.id)}
                        disabled={!isReady || isBusy}
                        className="flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent-hover text-accent-fg text-xs font-bold rounded-lg transition-all shadow-md shadow-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {actionLoading === `execute-${prop.id}` ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        Execute On-Chain
                      </button>
                    </div>
                  </div>

                  {/* Signature Progress Bar & Signers */}
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                      <span>
                        Signatures Required:{" "}
                        <strong className="text-fg font-mono font-bold">
                          {prop.approvals.length} / {prop.threshold}
                        </strong>{" "}
                        (of {prop.totalSigners} total admins)
                      </span>
                      <span className="text-fg-muted">
                        Proposed on {new Date(prop.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="w-full bg-surface h-2.5 rounded-full overflow-hidden border border-border">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isReady
                            ? "bg-gradient-to-r from-accent to-accent-hover"
                            : "bg-gradient-to-r from-primary to-primary-hover"
                        }`}
                        style={{ width: `${Math.min(100, (prop.approvals.length / prop.threshold) * 100)}%` }}
                      />
                    </div>

                    {/* Signer Avatars / Status Badges */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <span className="text-xs text-fg-muted mr-1">Admin Signers:</span>
                      {signers.map((s) => {
                        const signedThis = prop.approvals.some(
                          (a) => a.toLowerCase() === s.address.toLowerCase()
                        );
                        return (
                          <span
                            key={s.address}
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono font-medium ${
                              signedThis
                                ? "bg-accent-soft text-accent border border-accent/30"
                                : "bg-surface-2 text-fg-muted border border-border"
                            }`}
                          >
                            {signedThis ? <Check className="w-3 h-3 text-accent" /> : <Clock className="w-3 h-3" />}
                            {s.name.split(" ")[0]} {signedThis ? "✓" : "…"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 5 Authorized Admin Signers Roster ── */}
      <div className="p-6 bg-surface-2 rounded-xl border border-border space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-fg">Authorized Treasury Signers (3-of-5 Multi-Sig)</h2>
          </div>
          <span className="text-xs text-fg-muted">
            3 distinct signatures needed for on-chain authorization
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {signers.map((s, idx) => (
            <div
              key={s.address}
              className={`p-3.5 rounded-xl border flex items-center justify-between ${
                s.address === activeSignerAddress
                  ? "bg-primary-soft border-primary/40 shadow-sm"
                  : "bg-surface/60 border-border"
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-fg">{s.name}</span>
                  {s.address === activeSignerAddress && (
                    <span className="px-1.5 py-0.2 bg-primary/20 text-primary text-[10px] font-bold rounded">
                      YOU
                    </span>
                  )}
                </div>
                <p className="text-xs text-fg-muted">{s.role}</p>
                <p className="text-[11px] font-mono text-fg-muted mt-1">
                  {s.address.slice(0, 10)}...{s.address.slice(-6)}
                </p>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-accent shadow-sm shadow-accent/50" />
            </div>
          ))}
        </div>
      </div>

      {/* ── Historical Executed Distributions Log ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Historical Multi-Sig Distributions Log</h2>
          <span className="text-xs text-fg-muted">
            {data?.history.length ?? 0} Recorded Operations
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm text-fg">
            <thead className="bg-surface-2/80 text-xs uppercase text-fg-muted tracking-wider">
              <tr>
                <th className="p-3.5">ID</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Asset</th>
                <th className="p-3.5">Insurance Fund (50%)</th>
                <th className="p-3.5">DAO Treasury (50%)</th>
                <th className="p-3.5">Multi-Sig Signatures</th>
                <th className="p-3.5">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-surface/50">
              {data?.history && data.history.length > 0 ? (
                data.history.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-2 transition-colors">
                    <td className="p-3.5 font-mono text-xs text-fg-muted">#{item.id}</td>
                    <td className="p-3.5 text-xs text-fg">
                      {new Date(item.timestamp).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3.5 font-semibold text-fg">{item.asset}</td>
                    <td className="p-3.5 text-info font-mono">
                      +${item.insuranceAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5 text-primary font-mono">
                      +${item.daoAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-soft text-accent border border-accent/20">
                        <Check className="w-3 h-3" />
                        {item.signaturesCount ?? 3} of 5 Signed
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-xs text-fg-muted">
                      <span className="hover:text-primary cursor-pointer">{item.txHash}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-fg-muted text-sm">
                    No distributions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Propose Multi-Sig Transaction Modal ── */}
      {isProposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-bold text-fg">Propose Multi-Sig Transaction</h3>
              </div>
              <button
                onClick={() => setIsProposeOpen(false)}
                className="p-1 hover:bg-surface-2 rounded-lg transition-colors text-fg-muted hover:text-fg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProposeSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-fg block mb-1.5">
                  Transaction Type
                </label>
                <select
                  value={proposeActionType}
                  onChange={(e) =>
                    setProposeActionType(
                      e.target.value as "distribute" | "collect_fees" | "transfer",
                    )
                  }
                  className="w-full bg-surface-2 border border-border text-fg rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
                >
                  <option value="distribute">Distribute Treasury (50% Insurance / 50% DAO)</option>
                  <option value="collect_fees">Collect Protocol Fees from Lending Pool</option>
                  <option value="transfer">Transfer / Protocol Grant Allocation</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-fg block mb-1.5">
                  Proposal Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 Treasury Fee Distribution"
                  value={proposeTitle}
                  onChange={(e) => setProposeTitle(e.target.value)}
                  className="w-full bg-surface-2 border border-border text-fg rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-fg block mb-1.5">
                  Amount ({data?.asset ?? "USDC"})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder={data?.currentBalance.toFixed(2) ?? "1000"}
                  value={proposeAmount}
                  onChange={(e) => setProposeAmount(e.target.value)}
                  className="w-full bg-surface-2 border border-border text-fg rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
                />
              </div>

              {proposeActionType === "transfer" && (
                <div>
                  <label className="text-xs font-semibold text-fg block mb-1.5">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="G..."
                    value={proposeRecipient}
                    onChange={(e) => setProposeRecipient(e.target.value)}
                    className="w-full bg-surface-2 border border-border text-fg rounded-xl px-3.5 py-2.5 text-sm font-mono focus:ring-2 focus:ring-ring focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-fg block mb-1.5">
                  Description / Justification
                </label>
                <textarea
                  rows={2}
                  placeholder="Explain why this treasury movement is requested..."
                  value={proposeDescription}
                  onChange={(e) => setProposeDescription(e.target.value)}
                  className="w-full bg-surface-2 border border-border text-fg rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
                />
              </div>

              <div className="p-3 bg-primary-soft border border-primary/20 rounded-xl text-xs text-primary flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  Submitting automatically records your signature as 1 of 3 required approvals.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProposeOpen(false)}
                  className="px-4 py-2.5 bg-surface-2 hover:bg-surface-2 text-fg font-medium text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "propose"}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary text-fg font-bold text-sm rounded-xl transition-all shadow-lg shadow-primary/25 disabled:opacity-50"
                >
                  {actionLoading === "propose" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSignature className="w-4 h-4" />
                  )}
                  Submit Proposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
