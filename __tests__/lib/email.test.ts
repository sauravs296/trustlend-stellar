import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createFakeDb } from "../helpers/fake-db";

// ── Mock the database: getUserEmail() runs one select on users ───────────────
const fakeDb = createFakeDb();

vi.mock("@/lib/db/client", () => ({
  getDb: () => fakeDb,
}));

/** Queue the users row the next e-mail lookup will read. */
function primeUserEmail(email: string | null) {
  fakeDb.reset();
  fakeDb.queue(email === null ? [] : [{ email }]);
}

import {
  isResendConfigured,
  sendLoanApprovedEmail,
  sendLoanFundedEmail,
  sendPaymentOverdueEmail,
} from "@/lib/email/resend";
import {
  loanApprovedTemplate,
  loanFundedTemplate,
  paymentOverdueTemplate,
} from "@/lib/email/templates";

describe("Email Templates", () => {
  describe("loanApprovedTemplate", () => {
    it("generates correct subject, html and text with loan details link", () => {
      const template = loanApprovedTemplate({
        amount: 500,
        dashboardUrl: "http://localhost:3000/dashboard/borrower/loans?loan=loan-123",
      });

      expect(template.subject).toBe("Loan Approved");
      expect(template.text).toContain("500 XLM");
      expect(template.text).toContain("http://localhost:3000/dashboard/borrower/loans?loan=loan-123");
      expect(template.html).toContain("Loan Approved");
      expect(template.html).toContain("500 XLM");
      expect(template.html).toContain("View Loan Details");
      expect(template.html).toContain("http://localhost:3000/dashboard/borrower/loans?loan=loan-123");
    });
  });

  describe("loanFundedTemplate", () => {
    it("generates correct subject, html and text with loan details link upon funding", () => {
      const template = loanFundedTemplate({
        amount: 1500,
        dashboardUrl: "http://localhost:3000/dashboard/borrower/loans?loan=loan-456",
      });

      expect(template.subject).toBe("Loan Funded");
      expect(template.text).toContain("1,500 XLM");
      expect(template.text).toContain("http://localhost:3000/dashboard/borrower/loans?loan=loan-456");
      expect(template.html).toContain("Loan Funded");
      expect(template.html).toContain("1,500 XLM");
      expect(template.html).toContain("View Loan Details");
      expect(template.html).toContain("http://localhost:3000/dashboard/borrower/loans?loan=loan-456");
    });
  });

  describe("paymentOverdueTemplate", () => {
    it("generates overdue notification email template", () => {
      const template = paymentOverdueTemplate({
        amount: 250,
        dueAt: "2026-08-01T00:00:00Z",
        dashboardUrl: "http://localhost:3000/dashboard/borrower/repay?loan=loan-789",
      });

      expect(template.subject).toBe("Payment Overdue");
      expect(template.text).toContain("250 XLM");
      expect(template.html).toContain("Repay Now");
    });
  });
});

describe("Resend Email Delivery", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "re_mock_api_key_123",
      RESEND_FROM_EMAIL: "TrustLend <notifications@trustlend.finance>",
      NEXT_PUBLIC_SITE_URL: "https://trustlend.finance",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("isResendConfigured returns true when credentials exist", () => {
    expect(isResendConfigured()).toBe(true);
  });

  it("isResendConfigured returns false when env variables are missing", () => {
    delete process.env.RESEND_API_KEY;
    expect(isResendConfigured()).toBe(false);
  });

  it("sends loan funded email immediately to the borrower", async () => {
    primeUserEmail("borrower@example.com");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendLoanFundedEmail({
      userId: "user-123",
      amount: 1000,
      loanId: "loan-abc",
    });

    expect(fakeDb.calls.some((c) => c.method === "select")).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    expect(options.headers["authorization"]).toBe("Bearer re_mock_api_key_123");

    const body = JSON.parse(options.body);
    expect(body.to).toBe("borrower@example.com");
    expect(body.subject).toBe("Loan Funded");
    expect(body.html).toContain("https://trustlend.finance/dashboard/borrower/loans?loan=loan-abc");
    expect(body.html).toContain("View Loan Details");
  });

  it("sends loan approved email to borrower", async () => {
    primeUserEmail("borrower@example.com");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendLoanApprovedEmail({
      userId: "user-123",
      amount: 500,
      loanId: "loan-def",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toBe("borrower@example.com");
    expect(body.subject).toBe("Loan Approved");
    expect(body.html).toContain("https://trustlend.finance/dashboard/borrower/loans?loan=loan-def");
  });

  it("handles missing user email gracefully without throwing", async () => {
    primeUserEmail(null);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendLoanFundedEmail({
        userId: "non-existent-user",
        amount: 1000,
        loanId: "loan-xyz",
      })
    ).resolves.not.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches and logs API failures without unhandled rejections", async () => {
    primeUserEmail("borrower@example.com");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Resend error"),
      })
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendLoanFundedEmail({
        userId: "user-123",
        amount: 1000,
        loanId: "loan-xyz",
      })
    ).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
