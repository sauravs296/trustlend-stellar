import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { ledgerTransactions, loans, poolPositions, profiles, reputationEvents } from "@/lib/db/schema";

export interface BorrowerDashboardMetrics {
  reputationScore: number;
  availableCredit: number;
  activeLoans: number;
  pendingLoans: number;
  repaymentRate: number;
}

export interface LenderDashboardMetrics {
  deployedCapital: number;
  totalEarnings: number;
  activePositions: number;
  defaultRate: number;
}

export interface AdminDashboardMetrics {
  totalUsers: number;
  totalLoans: number;
  activeLoans: number;
  highRiskUsers: number;
}

function toCurrency(valueInStroops: number): string {
  const adjustedValue = valueInStroops / 10000000;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(adjustedValue)} XLM`;
}

function toPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function presentBorrowerMetrics(metrics: BorrowerDashboardMetrics) {
  return [
    { label: "Trust score", value: String(metrics.reputationScore) },
    { label: "Available credit", value: toCurrency(metrics.availableCredit) },
    metrics.pendingLoans > 0
      ? { label: "Loan requests", value: String(metrics.pendingLoans) }
      : { label: "Active loans", value: String(metrics.activeLoans) },
    { label: "Repayment rate", value: toPercentage(metrics.repaymentRate) },
  ];
}

export function presentLenderMetrics(metrics: LenderDashboardMetrics) {
  return [
    { label: "Capital deployed", value: toCurrency(metrics.deployedCapital) },
    { label: "Interest earned", value: toCurrency(metrics.totalEarnings) },
    { label: "Active positions", value: String(metrics.activePositions) },
  ];
}

export function presentAdminMetrics(metrics: AdminDashboardMetrics) {
  return [
    { label: "Total users", value: String(metrics.totalUsers) },
    { label: "Total loans", value: String(metrics.totalLoans) },
    { label: "Active loans", value: String(metrics.activeLoans) },
    { label: "High risk users", value: String(metrics.highRiskUsers) },
  ];
}


const ACTIVE_LOAN_STATUSES = ["active", "funded", "approved"];

export async function getBorrowerDashboardMetrics(
  userId: string,
): Promise<BorrowerDashboardMetrics> {
  const db = getDb();
  if (!db) {
    return { reputationScore: 0, availableCredit: 0, activeLoans: 0, pendingLoans: 0, repaymentRate: 0 };
  }

  try {
    const [events, loanRows] = await Promise.all([
      db.select({ pointsDelta: reputationEvents.pointsDelta }).from(reputationEvents).where(eq(reputationEvents.userId, userId)),
      db.select({ status: loans.status }).from(loans).where(eq(loans.borrowerId, userId)),
    ]);

    const reputationPoints = events.reduce((sum, row) => sum + Number(row.pointsDelta ?? 0), 0);
    const reputation = Math.max(0, 250 + reputationPoints);

    const pendingLoans  = loanRows.filter((loan) => loan.status === "requested").length;
    const activeLoans   = loanRows.filter((loan) => ACTIVE_LOAN_STATUSES.includes(loan.status)).length;
    const repaidLoans   = loanRows.filter((loan) => loan.status === "repaid").length;
    const defaultedLoans = loanRows.filter((loan) => loan.status === "defaulted").length;
    const repaymentBase = repaidLoans + defaultedLoans;
    const repaymentRate = repaymentBase > 0 ? (repaidLoans / repaymentBase) * 100 : 100;

    return {
      reputationScore: reputation,
      availableCredit: reputation * 10,
      activeLoans,
      pendingLoans,
      repaymentRate,
    };
  } catch {
    return { reputationScore: 250, availableCredit: 2500, activeLoans: 0, pendingLoans: 0, repaymentRate: 0 };
  }
}

type LedgerMeta = { lenderUserId?: unknown; lenderAddress?: unknown; loanId?: unknown };

function parseMeta(raw: unknown): LedgerMeta {
  if (!raw) return {};
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as LedgerMeta;
  } catch {
    return {};
  }
}

export async function getLenderDashboardMetrics(
  userId: string,
): Promise<LenderDashboardMetrics> {
  const db = getDb();
  if (!db) {
    return { deployedCapital: 0, totalEarnings: 0, activePositions: 0, defaultRate: 0 };
  }

  try {
    // 1. Pool positions
    const positions = await db
      .select({
        status: poolPositions.status,
        principalAmount: poolPositions.principalAmount,
        earnedInterest: poolPositions.earnedInterest,
      })
      .from(poolPositions)
      .where(eq(poolPositions.lenderId, userId));

    const poolDeployed = positions.reduce((s, r) => s + Number(r.principalAmount ?? 0), 0);
    const poolEarnings = positions.reduce((s, r) => s + Number(r.earnedInterest ?? 0), 0);
    const poolActive   = positions.filter((r) => r.status === "active").length;

    // 2. P2P metrics
    const [p2pFunds, p2pRepays] = await Promise.all([
      db
        .select({ amount: ledgerTransactions.amount, refId: ledgerTransactions.refId })
        .from(ledgerTransactions)
        .where(and(eq(ledgerTransactions.userId, userId), eq(ledgerTransactions.refType, "loan_fund"))),
      db
        .select({ amount: ledgerTransactions.amount, metadata: ledgerTransactions.metadata })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.refType, "loan_repay")),
    ]);

    const lenderRepays = p2pRepays.filter((tx) => {
      const meta = parseMeta(tx.metadata);
      return String(meta.lenderUserId) === userId || String(meta.lenderAddress) === userId;
    });

    // Group by loan so a newly funded loan doesn't wipe out past profits.
    const loanProfitMap = new Map<string, { deployed: number; received: number }>();

    for (const tx of p2pFunds) {
      const id = String(tx.refId);
      const cur = loanProfitMap.get(id) ?? { deployed: 0, received: 0 };
      cur.deployed += Number(tx.amount || 0);
      loanProfitMap.set(id, cur);
    }

    for (const tx of lenderRepays) {
      const meta = parseMeta(tx.metadata);
      const id = meta.loanId ? String(meta.loanId) : "";
      if (!id) continue;
      const cur = loanProfitMap.get(id) ?? { deployed: 0, received: 0 };
      cur.received += Number(tx.amount || 0);
      loanProfitMap.set(id, cur);
    }

    let p2pProfit = 0;
    for (const { deployed, received } of loanProfitMap.values()) {
      p2pProfit += Math.max(0, received - deployed);
    }

    const p2pDeployed = p2pFunds.reduce((s, t) => s + Number(t.amount || 0), 0);

    const loanIds = Array.from(loanProfitMap.keys()).filter((id) => id && id !== "null");
    let p2pActiveCount = 0;
    if (loanIds.length > 0) {
      const loanRows = await db.select({ status: loans.status }).from(loans).where(inArray(loans.id, loanIds));
      p2pActiveCount = loanRows.filter((l) => l.status === "active").length;
    }

    return {
      deployedCapital: poolDeployed + p2pDeployed,
      totalEarnings: poolEarnings + p2pProfit,
      activePositions: poolActive + p2pActiveCount,
      defaultRate: 0,
    };
  } catch {
    return { deployedCapital: 0, totalEarnings: 0, activePositions: 0, defaultRate: 0 };
  }
}

export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const db = getDb();
  if (!db) return { totalUsers: 0, totalLoans: 0, activeLoans: 0, highRiskUsers: 0 };

  try {
    const countOf = sql<number>`count(*)::int`;
    const [[usersRes], [totalLoansRes], [activeLoansRes], [highRiskRes]] = await Promise.all([
      db.select({ count: countOf }).from(profiles),
      db.select({ count: countOf }).from(loans),
      db.select({ count: countOf }).from(loans).where(inArray(loans.status, ["approved", "funded", "active", "requested"])),
      db.select({ count: countOf }).from(profiles).where(inArray(profiles.riskStatus, ["high", "blocked"])),
    ]);
    return {
      totalUsers:    usersRes?.count ?? 0,
      totalLoans:    totalLoansRes?.count ?? 0,
      activeLoans:   activeLoansRes?.count ?? 0,
      highRiskUsers: highRiskRes?.count ?? 0,
    };
  } catch {
    return { totalUsers: 0, totalLoans: 0, activeLoans: 0, highRiskUsers: 0 };
  }
}
