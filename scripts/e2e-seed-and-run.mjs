#!/usr/bin/env node
/**
 * scripts/e2e-seed-and-run.mjs
 *
 * Seeds three accounts (borrower, lender, admin) and a liquidity pool directly
 * in Postgres, then exercises the running app's dashboards and API routes with
 * the dev auth-bypass headers (ENABLE_DEV_AUTH_BYPASS=true on the server).
 *
 *   npm run e2e:seed            # against http://localhost:3000
 *   E2E_BASE_URL=... npm run e2e:seed
 *
 * Requires DATABASE_URL in .env.local (or the environment).
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function printResult(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status.padEnd(5)} | ${name.padEnd(38)} | ${detail}`);
}

async function http(method, url, headers = {}, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  let payload = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return { status: res.status, payload };
}

/** Deterministic, valid-looking Stellar public keys for the seeded accounts. */
const E2E_WALLETS = {
  borrower: "GE2EBORROWERADDRESS0000000000000000000000000000000000000",
  lender: "GE2ELENDERADDRESS00000000000000000000000000000000000000",
  admin: "GE2EADMINADDRESS000000000000000000000000000000000000000",
};

/** Upsert a users + profiles pair keyed by wallet address; returns the user. */
async function ensureUser(client, walletAddress, email, role, fullName) {
  const { rows } = await client.query(
    `insert into users (wallet_address, role, email, last_sign_in_at)
     values ($1, $2, $3, now())
     on conflict (wallet_address) do update set role = excluded.role, email = excluded.email
     returning id, email`,
    [walletAddress, role, email],
  );
  const user = rows[0];

  await client.query(
    `insert into profiles (id, full_name, role, wallet_address, kyc_status, risk_status)
     values ($1, $2, $3, $4, 'verified', 'low')
     on conflict (id) do update
       set full_name = excluded.full_name, role = excluded.role,
           wallet_address = excluded.wallet_address,
           kyc_status = 'verified', risk_status = 'low'`,
    [user.id, fullName, role, walletAddress],
  );

  return { id: user.id, email: user.email, walletAddress };
}

async function main() {
  const cwd = process.cwd();
  const env = { ...loadEnv(path.join(cwd, ".env.local")), ...process.env };

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL in .env.local");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  console.log("Starting seeded E2E run...\n");

  try {
    const borrower = await ensureUser(client, E2E_WALLETS.borrower, "e2e.borrower@trustlend.local", "borrower", "E2E Borrower");
    const lender = await ensureUser(client, E2E_WALLETS.lender, "e2e.lender@trustlend.local", "lender", "E2E Lender");
    const admin = await ensureUser(client, E2E_WALLETS.admin, "e2e.admin@trustlend.local", "admin", "E2E Admin");

    // Ensure borrower can request loans.
    await client.query(
      `insert into reputation_snapshots (user_id, score_total, repayment_score, lending_score, consistency_score, external_score, reputation_level)
       values ($1, 300, 80, 20, 90, 40, 'silver')
       on conflict (user_id) do update set score_total = 300`,
      [borrower.id],
    );

    let poolId = null;
    const existingPool = await client.query(`select id from lending_pools where status = 'active' limit 1`);
    if (existingPool.rows[0]?.id) {
      poolId = existingPool.rows[0].id;
    } else {
      const created = await client.query(
        `insert into lending_pools (name, description, status, currency, apr_bps, total_liquidity, available_liquidity, total_borrowed, created_by)
         values ('E2E Liquidity Pool', 'Seeded pool for automated E2E', 'active', 'XLM', 1200, 10000, 10000, 0, $1)
         returning id`,
        [lender.id],
      );
      poolId = created.rows[0].id;
    }

    const base = env.E2E_BASE_URL ?? "http://localhost:3000";
    const borrowerHeaders = { "x-dev-user-id": borrower.id, "x-dev-role": "borrower" };
    const lenderHeaders = { "x-dev-user-id": lender.id, "x-dev-role": "lender" };
    const adminHeaders = { "x-dev-user-id": admin.id, "x-dev-role": "admin" };

    let pass = 0;
    let total = 0;
    const check = (name, ok, detail) => {
      total += 1;
      if (ok) pass += 1;
      printResult(name, ok, detail);
    };

    const bDash = await http("GET", `${base}/dashboard/borrower`, borrowerHeaders);
    check("Borrower dashboard", bDash.status === 200, `status=${bDash.status}`);

    const lDash = await http("GET", `${base}/dashboard/lender`, lenderHeaders);
    check("Lender dashboard", lDash.status === 200, `status=${lDash.status}`);

    const aDash = await http("GET", `${base}/dashboard/admin`, adminHeaders);
    check("Admin dashboard", aDash.status === 200, `status=${aDash.status}`);

    const apply = await http("POST", `${base}/api/loans/apply`, borrowerHeaders, {
      amount: 120,
      durationDays: 30,
    });
    const loanId = apply?.payload?.loan?.id;
    check("Borrower apply loan", apply.status === 201 && !!loanId, `status=${apply.status}`);

    const deposit = await http("POST", `${base}/api/pools/deposit`, lenderHeaders, {
      poolId,
      amount: 250,
      txHash: `e2e-deposit-tx-${Date.now()}`,
      lenderAddress: lender.walletAddress,
    });
    const positionId = deposit?.payload?.position?.id;
    check("Lender deposit", deposit.status === 201 && !!positionId, `status=${deposit.status}`);

    const withdraw = await http("POST", `${base}/api/pools/withdraw`, lenderHeaders, {
      positionId,
      amount: 50,
    });
    check("Lender withdraw", withdraw.status === 200, `status=${withdraw.status}`);

    const repayPartial = await http("POST", `${base}/api/loans/repay`, borrowerHeaders, {
      loanId,
      amount: 30,
      txHash: `e2e-repay-partial-${Date.now()}`,
      borrowerAddress: borrower.walletAddress,
    });
    check("Borrower partial repayment", repayPartial.status === 201, `status=${repayPartial.status}`);

    const repayFull = await http("POST", `${base}/api/loans/repay`, borrowerHeaders, {
      loanId,
      amount: 500,
      txHash: `e2e-repay-full-${Date.now()}`,
      borrowerAddress: borrower.walletAddress,
    });
    check("Borrower full repayment", repayFull.status === 201, `status=${repayFull.status}`);

    // Verify DB updates are real and persisted.
    const loanRow = (await client.query(`select id, status, repaid_amount from loans where id = $1`, [loanId])).rows[0];
    check(
      "Loan status persisted",
      !!loanRow && ["active", "repaid"].includes(loanRow.status),
      `status=${loanRow?.status ?? "none"}`,
    );

    const posRow = (
      await client.query(`select id, principal_amount, withdrawn_amount from pool_positions where id = $1`, [positionId])
    ).rows[0];
    check(
      "Position update persisted",
      !!posRow && Number(posRow.withdrawn_amount ?? 0) >= 50,
      `withdrawn=${posRow?.withdrawn_amount ?? "none"}`,
    );

    const ledgerRows = (
      await client.query(
        `select id, category from ledger_transactions where user_id = $1 and category in ('deposit', 'withdrawal') limit 20`,
        [lender.id],
      )
    ).rows;
    check(
      "Ledger tx recorded",
      ledgerRows.some((r) => r.category === "deposit") && ledgerRows.some((r) => r.category === "withdrawal"),
      `rows=${ledgerRows.length}`,
    );

    const adminKyc = await http("GET", `${base}/dashboard/admin/kyc`, adminHeaders);
    check("Admin KYC page", adminKyc.status === 200, `status=${adminKyc.status}`);

    const adminUsers = await http("GET", `${base}/dashboard/admin/users`, adminHeaders);
    check("Admin users page", adminUsers.status === 200, `status=${adminUsers.status}`);

    const roleMismatch = await http("POST", `${base}/api/pools/deposit`, borrowerHeaders, {
      poolId,
      amount: 10,
    });
    check("Role mismatch guard", roleMismatch.status === 307, `status=${roleMismatch.status}`);

    const invalidApply = await http("POST", `${base}/api/loans/apply`, borrowerHeaders, {
      amount: 0,
      durationDays: 30,
    });
    check("Input validation guard", invalidApply.status === 400, `status=${invalidApply.status}`);

    console.log("\nSummary");
    console.log(`Passed: ${pass}/${total}`);

    if (pass !== total) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("E2E run failed:", error.message);
  process.exit(1);
});
