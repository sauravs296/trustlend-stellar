"use client";

import React, { useState, useEffect } from "react";
import {
  Vault,
  TrendingUp,
  ShieldCheck,
  Building2,
  CheckCircle2,
  DollarSign,
  Users,
  Lock,
  Check,
} from "lucide-react";
import { TreasuryDashboardSkeleton } from "@/components/dashboard/ChartSkeleton";
import type {
  TreasuryMultisigProposal,
  TreasurySigner,
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

  const fetchTreasuryData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/treasury");
      if (res.ok) {
        const json = await res.json();
        setData(json);
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
  const threshold = data?.multisig?.threshold ?? 3;
  const totalSigners = data?.multisig?.totalSigners ?? 5;

  return (
    <div className="space-y-8 p-6 bg-surface text-fg rounded-2xl border border-border shadow-xl">
      {/* ── Header with 3-of-5 Badge ── */}
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
              className="p-3.5 rounded-xl border flex items-center justify-between bg-surface/60 border-border"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-fg">{s.name}</span>
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
                <th className="p-3.5">Insurance Fund ({insurancePct}%)</th>
                <th className="p-3.5">DAO Treasury ({daoPct}%)</th>
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
    </div>
  );
}
