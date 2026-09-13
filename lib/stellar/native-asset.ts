/**
 * The Stellar Asset Contract (SAC) address for native XLM on the configured
 * network — the default collateral asset for on-chain loan requests.
 */
import { Asset } from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export function nativeAssetContractId(passphrase: string = NETWORK_PASSPHRASE): string {
  return Asset.native().contractId(passphrase);
}
