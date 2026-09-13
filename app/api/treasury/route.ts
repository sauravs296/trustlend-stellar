import { NextRequest, NextResponse } from "next/server";
import { enforceRouteRateLimit } from "@/lib/rate-limit";
import {
  DEFAULT_TREASURY_SIGNERS,
  TREASURY_THRESHOLD,
  TREASURY_SIGNERS_COUNT,
} from "@/lib/treasury/multisig";
import {
  getTotals,
  getDistributionRules,
  getDistributionHistory,
  getTreasuryBalance,
  isConfigured,
  collectProtocolFees,
  distribute
} from "@/lib/contracts/treasury";

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRouteRateLimit(request);
  if (rateLimited) return rateLimited;

  if (!isConfigured()) {
    return NextResponse.json({
      currentBalance: 0,
      totalCollected: 0,
      totalDistributedInsurance: 0,
      totalDistributedDao: 0,
      rules: { insuranceShareBps: 5000, daoShareBps: 5000 },
      asset: "USDC",
      multisig: {
        threshold: TREASURY_THRESHOLD,
        totalSigners: TREASURY_SIGNERS_COUNT,
        signers: DEFAULT_TREASURY_SIGNERS,
        activeProposals: [],
        executedProposals: [],
      },
      history: [],
    }, { status: 200 });
  }

  try {
    const caller = DEFAULT_TREASURY_SIGNERS[0].address;
    
    const totals = await getTotals(caller).catch(() => ({ collected: 0n, toInsurance: 0n, toDao: 0n, count: 0 }));
    const rules = await getDistributionRules(caller).catch(() => ({ insuranceShareBps: 5000, daoShareBps: 5000 }));
    const history = await getDistributionHistory(caller).catch(() => []);
    
    const asset = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID || "USDC";
    const currentBalance = await getTreasuryBalance(asset, caller).catch(() => 0n);

    const formatAmount = (val: bigint) => Number(val) / 10000000;

    const treasuryState = {
      currentBalance: formatAmount(currentBalance),
      totalCollected: formatAmount(totals.collected),
      totalDistributedInsurance: formatAmount(totals.toInsurance),
      totalDistributedDao: formatAmount(totals.toDao),
      rules: {
        insuranceShareBps: rules.insuranceShareBps,
        daoShareBps: rules.daoShareBps,
      },
      asset: "USDC",
      multisig: {
        threshold: TREASURY_THRESHOLD,
        totalSigners: TREASURY_SIGNERS_COUNT,
        signers: DEFAULT_TREASURY_SIGNERS,
        activeProposals: [],
        executedProposals: [],
      },
      history: history.map((h, i) => ({
        id: i + 1,
        timestamp: new Date(Number(h.timestamp) * 1000).toISOString(),
        asset: "USDC",
        insuranceAmount: formatAmount(h.toInsurance),
        daoAmount: formatAmount(h.toDao),
        status: "Completed",
        txHash: "On-Chain", 
        signaturesCount: TREASURY_THRESHOLD,
        approvedBy: [],
      })),
    };

    return NextResponse.json(treasuryState, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch live treasury data:", error);
    return NextResponse.json({ error: "Failed to fetch live treasury data" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await enforceRouteRateLimit(request);
    if (rateLimited) return rateLimited;

    const body = await request.json();
    const { action, signerAddress } = body;

    if (!isConfigured()) {
      return NextResponse.json({ error: "Treasury contract not configured" }, { status: 500 });
    }

    const caller = signerAddress || DEFAULT_TREASURY_SIGNERS[0].address;
    const asset = process.env.NEXT_PUBLIC_USDC_CONTRACT_ID || "USDC";

    if (action === "collect") {
      const lendingContractId = process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID;
      if (!lendingContractId) {
        return NextResponse.json({ error: "Lending contract not configured" }, { status: 500 });
      }
      await collectProtocolFees(caller, lendingContractId);
      return NextResponse.json({ message: "Collected protocol fees successfully (live)" }, { status: 200 });
    }

    if (action === "distribute") {
      await distribute(caller, asset);
      return NextResponse.json({ message: "Distributed treasury balance successfully (live)" }, { status: 200 });
    }

    return NextResponse.json({ error: "Action not supported in live mode without a DB" }, { status: 400 });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
