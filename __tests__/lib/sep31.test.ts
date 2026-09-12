import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the wallet module to avoid loading third-party UI wallet packages during tests
vi.mock("@/lib/stellar/wallet", () => ({
  signTransactionWithWallet: vi.fn().mockResolvedValue({
    signedTxXdr: "mockSignedXdr",
  }),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromPublicKey: (key: string) => ({
      verify: (data: Buffer, sig: Buffer) => {
        return sig.toString("utf8") === "mock-signature";
      },
    }),
  },
}));

import {
  discoverSep31Anchor,
  getSep31Info,
  getSep12Customer,
  registerSep12Customer,
  createSep31Transaction,
  getSep31Transaction,
  verifyAnchorSignature,
} from "@/lib/stellar/sep31";

describe("Stellar SEP-31 Client", () => {
  const mockHomeDomain = "testanchor.stellar.org";
  
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("discoverSep31Anchor", () => {
    it("successfully parses TOML response and resolves endpoints", async () => {
      const mockToml = `
        DIRECT_PAYMENT_SERVER="https://testanchor.stellar.org/sep31"
        WEB_AUTH_ENDPOINT="https://testanchor.stellar.org/auth"
        SIGNING_KEY="GCSW6Y6W7QA2SV6OQNK2STU2QL2IWOJM4XNKV56A476I2V4JSU46A6N2"
        KYC_SERVER="https://testanchor.stellar.org/kyc"
      `;

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => mockToml,
      } as Response);

      const endpoints = await discoverSep31Anchor(mockHomeDomain);

      expect(fetch).toHaveBeenCalledWith(
        "https://testanchor.stellar.org/.well-known/stellar.toml",
        { headers: { Accept: "text/plain" } }
      );
      expect(endpoints).toEqual({
        directPaymentServer: "https://testanchor.stellar.org/sep31",
        webAuthEndpoint: "https://testanchor.stellar.org/auth",
        signingKey: "GCSW6Y6W7QA2SV6OQNK2STU2QL2IWOJM4XNKV56A476I2V4JSU46A6N2",
        kycServer: "https://testanchor.stellar.org/kyc",
      });
    });

    it("throws error if DIRECT_PAYMENT_SERVER is missing", async () => {
      const mockToml = `
        WEB_AUTH_ENDPOINT="https://testanchor.stellar.org/auth"
        SIGNING_KEY="GCSW6Y6W7QA2SV6OQNK2STU2QL2IWOJM4XNKV56A476I2V4JSU46A6N2"
      `;

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        text: async () => mockToml,
      } as Response);

      await expect(discoverSep31Anchor(mockHomeDomain)).rejects.toThrow(
        "Anchor does not support SEP-31 (DIRECT_PAYMENT_SERVER missing)."
      );
    });
  });

  describe("getSep31Info", () => {
    it("fetches active assets and requirements from anchor", async () => {
      const mockInfo = {
        receive: {
          USD: {
            enabled: true,
            min_amount: 10,
            max_amount: 1000000,
            sender_sep12_type: "sep31-sender",
            receiver_sep12_type: "sep31-receiver",
            fields: {
              transaction: {
                routing_number: { description: "Routing", optional: false },
              },
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockInfo,
      } as Response);

      const info = await getSep31Info("https://testanchor.stellar.org/sep31");

      expect(fetch).toHaveBeenCalledWith("https://testanchor.stellar.org/sep31/info");
      expect(info.receive.USD.enabled).toBe(true);
      expect(info.receive.USD.sender_sep12_type).toBe("sep31-sender");
    });
  });

  describe("getSep12Customer", () => {
    it("retrieves customer kyc status using JWT", async () => {
      const mockCustomer = {
        id: "cust-123",
        status: "ACCEPTED",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockCustomer,
      } as Response);

      const customer = await getSep12Customer("https://testanchor.stellar.org/kyc", "mock-jwt", {
        type: "sep31-sender",
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://testanchor.stellar.org/kyc/customer?type=sep31-sender",
        { headers: { Authorization: "Bearer mock-jwt" } }
      );
      expect(customer.status).toBe("ACCEPTED");
      expect(customer.id).toBe("cust-123");
    });
  });

  describe("registerSep12Customer", () => {
    it("submits customer records and returns customer ID", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "cust-new-id" }),
      } as Response);

      const customerId = await registerSep12Customer("https://testanchor.stellar.org/kyc", "mock-jwt", {
        first_name: "John",
        last_name: "Doe",
        type: "sep31-sender",
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://testanchor.stellar.org/kyc/customer",
        expect.objectContaining({
          method: "PUT",
          headers: { Authorization: "Bearer mock-jwt" },
          body: expect.any(FormData),
        })
      );
      expect(customerId).toBe("cust-new-id");
    });
  });

  describe("createSep31Transaction", () => {
    it("initiates transaction on the anchor and returns details", async () => {
      const mockTxResponse = {
        id: "tx-456",
        amount_in: "100.00",
        amount_out: "98.00",
        how_to_register: "Wire instructions...",
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTxResponse,
      } as Response);

      const tx = await createSep31Transaction("https://testanchor.stellar.org/sep31", "mock-jwt", {
        amount: "100.00",
        asset_code: "USD",
        sender_id: "cust-sender",
        receiver_id: "cust-receiver",
        fields: {
          transaction: {
            routing_number: "12345",
          },
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://testanchor.stellar.org/sep31/transactions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer mock-jwt",
          },
          body: JSON.stringify({
            amount: "100.00",
            asset_code: "USD",
            sender_id: "cust-sender",
            receiver_id: "cust-receiver",
            fields: {
              transaction: {
                routing_number: "12345",
              },
            },
          }),
        })
      );
      expect(tx.id).toBe("tx-456");
      expect(tx.how_to_register).toBe("Wire instructions...");
    });
  });

  describe("getSep31Transaction", () => {
    it("fetches single transaction status", async () => {
      const mockTx = {
        transaction: {
          id: "tx-456",
          status: "completed",
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTx,
      } as Response);

      const tx = await getSep31Transaction("https://testanchor.stellar.org/sep31", "mock-jwt", "tx-456");

      expect(fetch).toHaveBeenCalledWith(
        "https://testanchor.stellar.org/sep31/transactions/tx-456",
        { headers: { Authorization: "Bearer mock-jwt" } }
      );
      expect(tx.status).toBe("completed");
    });
  });

  describe("verifyAnchorSignature", () => {
    it("correctly identifies valid signatures using Ed25519", async () => {
      const isValid = await verifyAnchorSignature(
        '{"status":"completed"}',
        Buffer.from("mock-signature").toString("base64"),
        "GCSW6Y6W7QA2SV6OQNK2STU2QL2IWOJM4XNKV56A476I2V4JSU46A6N2"
      );

      expect(isValid).toBe(true);
    });
  });
});
