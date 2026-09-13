/**
 * lib/stellar/platform-wallet.ts
 *
 * The platform wallet is the Stellar account that receives pool deposits and
 * platform fees. Pool withdrawals have to be paid back out of it, which means
 * the server needs its secret key (`PLATFORM_WALLET_SECRET`).
 *
 * SERVER-ONLY.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export class PlatformWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformWalletError";
  }
}

/** Public address deposits are sent to (client and server must agree). */
export function platformWalletAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEXT_PUBLIC_PLATFORM_STELLAR_ADDRESS ?? env.PLATFORM_FEE_WALLET ?? "";
}

export function getPlatformKeypair(env: NodeJS.ProcessEnv = process.env): Keypair | null {
  const secret = env.PLATFORM_WALLET_SECRET;
  if (!secret) return null;
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new PlatformWalletError("PLATFORM_WALLET_SECRET is not a valid Stellar secret key");
  }
}

export interface PayoutParams {
  destination: string;
  amountXlm: number;
  memo: string;
}

export interface PayoutDeps {
  submit(signedXdr: string): Promise<{ hash: string }>;
  loadAccount(address: string): Promise<{ sequence: string }>;
}

async function horizonDeps(): Promise<PayoutDeps> {
  const server = new Horizon.Server(HORIZON_URL, { allowHttp: HORIZON_URL.startsWith("http://") });
  return {
    loadAccount: async (address) => {
      const account = await server.loadAccount(address);
      return { sequence: account.sequenceNumber() };
    },
    submit: async (signedXdr) => {
      const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
      const res = await server.submitTransaction(tx);
      return { hash: res.hash };
    },
  };
}

/**
 * Pay native XLM from the platform wallet. Throws `PlatformWalletError` when
 * the server has no signer — callers must refuse the withdrawal rather than
 * record one that never happened.
 */
export async function payoutFromPlatformWallet(
  params: PayoutParams,
  deps?: PayoutDeps,
): Promise<{ hash: string; source: string }> {
  const signer = getPlatformKeypair();
  if (!signer) {
    throw new PlatformWalletError(
      "PLATFORM_WALLET_SECRET is not configured — the server cannot pay out from the platform wallet",
    );
  }
  const configured = platformWalletAddress();
  if (configured && configured !== signer.publicKey()) {
    throw new PlatformWalletError(
      "PLATFORM_WALLET_SECRET does not belong to NEXT_PUBLIC_PLATFORM_STELLAR_ADDRESS",
    );
  }
  if (!(params.amountXlm > 0) || !Number.isFinite(params.amountXlm)) {
    throw new PlatformWalletError("Payout amount must be a positive number");
  }

  const io = deps ?? (await horizonDeps());
  const { sequence } = await io.loadAccount(signer.publicKey());
  const { Account } = await import("@stellar/stellar-sdk");

  const tx = new TransactionBuilder(new Account(signer.publicKey(), sequence), {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: params.destination,
        asset: Asset.native(),
        amount: params.amountXlm.toFixed(7),
      }),
    )
    .addMemo(Memo.text(params.memo.slice(0, 28)))
    .setTimeout(120)
    .build();

  tx.sign(signer);
  const { hash } = await io.submit(tx.toXDR());
  return { hash, source: signer.publicKey() };
}
