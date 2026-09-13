import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// lib/contracts/lending.ts pulls in the browser wallet layer; none of it is
// exercised here, so stub the modules that need a browser or Redis.
vi.mock("@/lib/stellar/wallet", () => ({ signTransactionWithWallet: vi.fn() }));
vi.mock("@/lib/services/redis", () => ({ redis: null }));
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  decodeEnumVariant,
  decodeOnchainLoan,
  readOnchainLoanId,
  verifyContractInvocation,
  xlmToStroops,
  stroopsToXlm,
  type RpcTransactionLookup,
} from "@/lib/stellar/onchain-lifecycle";
import { onchainLifecycleMode } from "@/lib/stellar/lifecycle-mode";
import { encodeLoanRequestInput, REPUTATION_TIER_INDEX } from "@/lib/contracts/lending";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT = "CCLVI2JGD7PUV75VHOLTUZF3CVXYBUTOSLKNLHEUUFXOY73BFXUEVEMO";
const OTHER_CONTRACT = "CD67XYZQ4DDARIXCYP77UR77BW3HWFCMLDHTQ7N6YUDML3NX246DD65G";
const HASH = "b".repeat(64);

const borrower = Keypair.random();

function invocationEnvelope(params: { source?: string; contract?: string; method?: string; classic?: boolean } = {}) {
  const source = params.source ?? borrower.publicKey();
  const builder = new TransactionBuilder(new Account(source, "1"), { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  if (params.classic) {
    builder.addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }));
  } else {
    builder.addOperation(
      new Contract(params.contract ?? CONTRACT).call(
        params.method ?? "create_loan_request",
        new Address(source).toScVal(),
        nativeToScVal(7, { type: "u32" }),
      ),
    );
  }
  return builder.setTimeout(30).build().toEnvelope().toXDR("base64");
}

function deps(lookup: RpcTransactionLookup | Error) {
  return {
    getTransaction: async () => {
      if (lookup instanceof Error) throw lookup;
      return lookup;
    },
  };
}

const check = { txHash: HASH, contractId: CONTRACT, method: "create_loan_request", expectedInvoker: borrower.publicKey() };

describe("verifyContractInvocation", () => {
  it("accepts a successful invocation of the expected method by the expected wallet and decodes the return value", async () => {
    const res = await verifyContractInvocation(
      check,
      deps({
        status: "SUCCESS",
        envelopeXdr: invocationEnvelope(),
        returnValue: nativeToScVal(42, { type: "u32" }).toXDR("base64"),
      }),
    );
    expect(res).toEqual({ ok: true, returnValue: 42 });
  });

  it("returns null return value for void functions", async () => {
    const res = await verifyContractInvocation(
      { ...check, method: "approve_loan" },
      deps({ status: "SUCCESS", envelopeXdr: invocationEnvelope({ method: "approve_loan" }) }),
    );
    expect(res).toEqual({ ok: true, returnValue: null });
  });

  it("rejects malformed hashes before touching RPC", async () => {
    let called = false;
    const res = await verifyContractInvocation({ ...check, txHash: "xyz" }, {
      getTransaction: async () => {
        called = true;
        return { status: "SUCCESS" };
      },
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(called).toBe(false);
  });

  it("maps NOT_FOUND / FAILED / RPC errors to 404 / 422 / 502", async () => {
    expect(await verifyContractInvocation(check, deps({ status: "NOT_FOUND" }))).toMatchObject({ ok: false, status: 404 });
    expect(await verifyContractInvocation(check, deps({ status: "FAILED", envelopeXdr: invocationEnvelope() }))).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await verifyContractInvocation(check, deps(new Error("boom")))).toMatchObject({ ok: false, status: 502 });
  });

  it("rejects when the transaction source is a different wallet", async () => {
    const res = await verifyContractInvocation(
      check,
      deps({ status: "SUCCESS", envelopeXdr: invocationEnvelope({ source: Keypair.random().publicKey() }) }),
    );
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/expected wallet/);
  });

  it("rejects calls to a different contract or method", async () => {
    const wrongContract = await verifyContractInvocation(
      check,
      deps({ status: "SUCCESS", envelopeXdr: invocationEnvelope({ contract: OTHER_CONTRACT }) }),
    );
    expect(wrongContract).toMatchObject({ ok: false, status: 422 });
    if (!wrongContract.ok) expect(wrongContract.reason).toMatch(/different contract/);

    const wrongMethod = await verifyContractInvocation(
      check,
      deps({ status: "SUCCESS", envelopeXdr: invocationEnvelope({ method: "approve_loan" }) }),
    );
    expect(wrongMethod).toMatchObject({ ok: false, status: 422 });
    if (!wrongMethod.ok) expect(wrongMethod.reason).toMatch(/calls approve_loan/);
  });

  it("rejects classic (non-contract) transactions", async () => {
    const res = await verifyContractInvocation(
      check,
      deps({ status: "SUCCESS", envelopeXdr: invocationEnvelope({ classic: true }) }),
    );
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reason).toMatch(/not a contract invocation/);
  });

  it("rejects a success response with no envelope", async () => {
    const res = await verifyContractInvocation(check, deps({ status: "SUCCESS" }));
    expect(res).toMatchObject({ ok: false, status: 422 });
  });
});

describe("decoding helpers", () => {
  it("decodes LoanRecord fields and unit enum variants", () => {
    const loan = decodeOnchainLoan({
      id: 3,
      borrower: borrower.publicKey(),
      lender: CONTRACT,
      amount: 250_0000000n,
      duration_days: 60,
      interest_rate_bps: 1200,
      total_due: 255_0000000n,
      remaining_due: 255_0000000n,
      status: ["Pending"],
      escrow_id: 0,
    });
    expect(loan.id).toBe(3);
    expect(loan.amountStroops).toBe(2_500_000_000n);
    expect(loan.status).toBe("Pending");
    expect(decodeEnumVariant("Active")).toBe("Active");
    expect(decodeEnumVariant({ 0: "Repaid" })).toBe("Repaid");
  });

  it("reads the on-chain loan id from either metadata key and rejects junk", () => {
    expect(readOnchainLoanId({ onchain_loan_id: 7 })).toBe(7);
    expect(readOnchainLoanId({ onchainLoanId: "9" })).toBe(9);
    expect(readOnchainLoanId({})).toBeNull();
    expect(readOnchainLoanId({ onchain_loan_id: 0 })).toBeNull();
    expect(readOnchainLoanId(null)).toBeNull();
  });

  it("converts XLM to stroops and back exactly", () => {
    expect(xlmToStroops(1)).toBe(10_000_000n);
    expect(xlmToStroops(123.4567891)).toBe(1_234_567_891n);
    expect(stroopsToXlm(1_234_567_891n)).toBeCloseTo(123.4567891, 7);
  });
});

describe("encodeLoanRequestInput", () => {
  it("encodes LoanRequestInput as a sorted ScMap with every contract field", () => {
    const scval = encodeLoanRequestInput({
      borrowerAddress: borrower.publicKey(),
      amountStroops: 100_0000000n,
      durationDays: 30,
      interestRateBps: 1500,
      maxLoanAmountStroops: 500_0000000n,
      collateralEntries: [{ asset: OTHER_CONTRACT, amount: 200_0000000n }],
      rateModel: "Floating",
      reputationTier: "Silver",
    });
    const map = scval.map()!;
    const keys = map.map((entry) => entry.key().sym().toString());
    expect(keys).toEqual([
      "amount",
      "collateral_entries",
      "duration_days",
      "interest_rate_bps",
      "max_loan_amount",
      "rate_model",
      "reputation_tier",
    ]);
    const tier = map[6].val();
    expect(tier.u32()).toBe(REPUTATION_TIER_INDEX.Silver);
    const rateModel = map[5].val().vec()!;
    expect(rateModel[0].sym().toString()).toBe("Floating");
    const entries = map[1].val().vec()!;
    expect(entries).toHaveLength(1);
    expect(entries[0].map()!.map((e) => e.key().sym().toString())).toEqual(["amount", "asset"]);
    // Round-trips through XDR (a malformed struct would throw here).
    expect(xdr.ScVal.fromXDR(scval.toXDR("base64"), "base64").switch().name).toBe("scvMap");
  });
});

describe("onchainLifecycleMode", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE;
    delete process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("is off with no lending contract and no explicit setting", () => {
    expect(onchainLifecycleMode()).toBe("off");
  });

  it("is required by default once a lending contract id is configured", () => {
    process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID = CONTRACT;
    expect(onchainLifecycleMode()).toBe("required");
  });

  it("honours an explicit override in either direction", () => {
    process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID = CONTRACT;
    process.env.NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE = "off";
    expect(onchainLifecycleMode()).toBe("off");
    delete process.env.NEXT_PUBLIC_LENDING_CONTRACT_ID;
    process.env.NEXT_PUBLIC_ONCHAIN_LOAN_LIFECYCLE = "required";
    expect(onchainLifecycleMode()).toBe("required");
  });
});
