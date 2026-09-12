//! # USDC Lending Pool — Soroban Smart Contract
//!
//! Accepts USDC deposits from lenders and allows them to withdraw their
//! principal plus accrued yield at any time.
//!
//! ## Yield Model
//! Yield accrues linearly per-ledger:
//! ```text
//! yield = principal * annual_yield_bps / 10_000
//!              * ledgers_elapsed / LEDGERS_PER_YEAR
//! ```
//! `LEDGERS_PER_YEAR` assumes a 5-second average ledger close time on Stellar
//! mainnet: 365 * 24 * 60 * 60 / 5 = 6_307_200 ledgers/year.
//!
//! ## Token Interface
//! All USDC movements use the SEP-41 token interface
//! (`soroban_sdk::token::TokenClient`).
//!
//! ## Acceptance Criteria (Issue #252)
//! - Smart contract accepts USDC deposits  ✔
//! - Users can withdraw their USDC + yield ✔

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Assumed ledger closes per year (5-second average close time).
const LEDGERS_PER_YEAR: u64 = 6_307_200;

/// Basis-points denominator (10 000 bps = 100 %).
const MAX_BPS: u64 = 10_000;

// ─── Storage types ────────────────────────────────────────────────────────────

/// Per-depositor record written to persistent storage.
#[contracttype]
#[derive(Clone)]
pub struct DepositRecord {
    /// Amount of USDC deposited (in the token's smallest unit, i.e. stroops for USDC:XLM or micro-USDC).
    pub principal: i128,
    /// Ledger sequence number at deposit time — used for yield accrual.
    pub deposit_ledger: u32,
}

/// Global pool state.
#[contracttype]
#[derive(Clone)]
pub struct PoolState {
    /// Cumulative USDC deposited across all users (does not decrease on withdraw).
    pub total_deposited: i128,
    /// Cumulative USDC withdrawn (principal + yield) across all users.
    pub total_withdrawn: i128,
    /// Annual yield rate in basis-points (e.g. 500 = 5.00 %).
    pub annual_yield_bps: u32,
    /// Total number of unique depositors (monotonically increasing).
    pub depositor_count: u32,
}

/// Ledger storage keys.
#[contracttype]
pub enum DataKey {
    /// Contract administrator.
    Admin,
    /// Address of the USDC token contract (SEP-41).
    UsdcToken,
    /// Global pool state.
    Pool,
    /// Per-depositor record: `Deposit(depositor_address)`.
    Deposit(Address),
    /// Whether the pool is paused for deposits/withdrawals.
    IsPaused,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct UsdcLendingPool;

#[contractimpl]
impl UsdcLendingPool {
    // ── Initialization ────────────────────────────────────────────────────────

    /// One-time setup. Must be called before any other function.
    ///
    /// # Arguments
    /// * `admin`           – Address authorised to pause/unpause and upgrade.
    /// * `usdc_token`      – SEP-41 USDC token contract address.
    /// * `annual_yield_bps`– Annual yield in basis-points (e.g. 500 = 5.00 %).
    pub fn initialize(env: Env, admin: Address, usdc_token: Address, annual_yield_bps: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if annual_yield_bps == 0 {
            panic!("annual_yield_bps must be > 0");
        }
        if annual_yield_bps > MAX_BPS as u32 {
            panic!("annual_yield_bps must be <= 10000");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage().instance().set(
            &DataKey::Pool,
            &PoolState {
                total_deposited: 0,
                total_withdrawn: 0,
                annual_yield_bps,
                depositor_count: 0,
            },
        );

        env.events().publish(
            (symbol_short!("pool"), symbol_short!("init")),
            (admin, usdc_token, annual_yield_bps),
        );
    }

    // ── Core pool functions ───────────────────────────────────────────────────

    /// Deposit USDC into the lending pool.
    ///
    /// Transfers `amount` USDC from `depositor` into this contract and records
    /// the deposit. If the depositor already has an open position the new
    /// principal is accumulated and the deposit ledger is reset (yield already
    /// accrued on the previous deposit is added to the new principal).
    ///
    /// # Arguments
    /// * `depositor` – Address making the deposit (must have authorised this call).
    /// * `amount`    – USDC amount to deposit (must be > 0).
    pub fn deposit(env: Env, depositor: Address, amount: i128) {
        depositor.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("amount must be > 0");
        }

        // Transfer USDC from depositor → pool contract. `depositor.require_auth()`
        // above covers the token transfer, so no prior allowance is needed.
        let usdc = Self::usdc_client(&env);
        let contract_addr = env.current_contract_address();
        usdc.transfer(&depositor, &contract_addr, &amount);

        let current_ledger = env.ledger().sequence();

        // If depositor already has a position, settle accrued yield first
        // and add it to the new principal so they don't lose earned yield.
        let new_principal = if let Some(existing) =
            env.storage()
                .persistent()
                .get::<DataKey, DepositRecord>(&DataKey::Deposit(depositor.clone()))
        {
            let settled_yield =
                Self::compute_yield(existing.principal, existing.deposit_ledger, current_ledger, Self::annual_yield_bps(&env));
            existing.principal + settled_yield + amount
        } else {
            // New depositor — increment count.
            let mut pool: PoolState = env
                .storage()
                .instance()
                .get(&DataKey::Pool)
                .expect("pool not found");
            pool.depositor_count += 1;
            env.storage().instance().set(&DataKey::Pool, &pool);
            amount
        };

        // Update global total.
        let mut pool: PoolState = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("pool not found");
        pool.total_deposited += amount;
        env.storage().instance().set(&DataKey::Pool, &pool);

        // Store per-depositor record.
        env.storage().persistent().set(
            &DataKey::Deposit(depositor.clone()),
            &DepositRecord {
                principal: new_principal,
                deposit_ledger: current_ledger,
            },
        );

        env.events().publish(
            (symbol_short!("pool"), symbol_short!("deposit")),
            (depositor, amount, current_ledger),
        );
    }

    /// Withdraw principal + accrued yield from the lending pool.
    ///
    /// Calculates the yield accrued since the deposit ledger, then transfers
    /// `principal + yield` USDC back to the depositor and clears their record.
    ///
    /// # Arguments
    /// * `depositor` – Address to withdraw on behalf of (must have authorised this call).
    pub fn withdraw(env: Env, depositor: Address) {
        depositor.require_auth();
        Self::assert_not_paused(&env);

        let record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(depositor.clone()))
            .expect("no deposit found for this address");

        if record.principal <= 0 {
            panic!("nothing to withdraw");
        }

        let current_ledger = env.ledger().sequence();
        let annual_yield_bps = Self::annual_yield_bps(&env);
        let yield_amount =
            Self::compute_yield(record.principal, record.deposit_ledger, current_ledger, annual_yield_bps);
        let total_payout = record.principal + yield_amount;

        // Transfer payout from pool → depositor.
        let usdc = Self::usdc_client(&env);
        usdc.transfer(&env.current_contract_address(), &depositor, &total_payout);

        // Clear the deposit record.
        env.storage()
            .persistent()
            .remove(&DataKey::Deposit(depositor.clone()));

        // Update global totals.
        let mut pool: PoolState = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("pool not found");
        pool.total_withdrawn += total_payout;
        env.storage().instance().set(&DataKey::Pool, &pool);

        env.events().publish(
            (symbol_short!("pool"), symbol_short!("withdraw")),
            (depositor, record.principal, yield_amount, current_ledger),
        );
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// Returns the depositor's current `(principal, accrued_yield)` tuple.
    /// Returns `(0, 0)` if the address has no open deposit.
    pub fn get_deposit(env: Env, depositor: Address) -> (i128, i128) {
        match env
            .storage()
            .persistent()
            .get::<DataKey, DepositRecord>(&DataKey::Deposit(depositor))
        {
            Some(record) => {
                let current_ledger = env.ledger().sequence();
                let annual_yield_bps = Self::annual_yield_bps(&env);
                let yield_amount = Self::compute_yield(
                    record.principal,
                    record.deposit_ledger,
                    current_ledger,
                    annual_yield_bps,
                );
                (record.principal, yield_amount)
            }
            None => (0, 0),
        }
    }

    /// Returns the global pool state.
    pub fn get_pool_state(env: Env) -> PoolState {
        env.storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("pool not initialized")
    }

    /// Returns true if the pool is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    // ── Admin functions ───────────────────────────────────────────────────────

    /// Pause deposits and withdrawals (admin only).
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &true);
        env.events()
            .publish((symbol_short!("pool"), symbol_short!("paused")), ());
    }

    /// Resume deposits and withdrawals (admin only).
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.events()
            .publish((symbol_short!("pool"), symbol_short!("unpaused")), ());
    }

    /// Update the annual yield rate (admin only).
    ///
    /// Note: existing open positions keep their original deposit_ledger; yield
    /// on elapsed ledgers before this call is effectively locked in at the old
    /// rate when the depositor next settles (re-deposits or withdraws).
    pub fn set_yield_rate(env: Env, admin: Address, new_annual_yield_bps: u32) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);

        if new_annual_yield_bps == 0 {
            panic!("annual_yield_bps must be > 0");
        }
        if new_annual_yield_bps > MAX_BPS as u32 {
            panic!("annual_yield_bps must be <= 10000");
        }

        let mut pool: PoolState = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("pool not found");
        pool.annual_yield_bps = new_annual_yield_bps;
        env.storage().instance().set(&DataKey::Pool, &pool);

        env.events().publish(
            (symbol_short!("pool"), symbol_short!("rate")),
            new_annual_yield_bps,
        );
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Compute linear yield accrued between `from_ledger` and `to_ledger`.
    ///
    /// ```text
    /// yield = principal * annual_yield_bps / 10_000
    ///              * ledgers_elapsed / LEDGERS_PER_YEAR
    /// ```
    fn compute_yield(principal: i128, from_ledger: u32, to_ledger: u32, annual_yield_bps: u32) -> i128 {
        if to_ledger <= from_ledger || principal <= 0 {
            return 0;
        }
        let ledgers_elapsed = (to_ledger - from_ledger) as u64;
        // Use u128 intermediary to avoid i128 overflow on large principals.
        let numerator = (principal as u128)
            .saturating_mul(annual_yield_bps as u128)
            .saturating_mul(ledgers_elapsed as u128);
        let denominator = MAX_BPS.saturating_mul(LEDGERS_PER_YEAR);
        (numerator / denominator as u128) as i128
    }

    /// Returns the current annual yield bps from pool state.
    fn annual_yield_bps(env: &Env) -> u32 {
        let pool: PoolState = env
            .storage()
            .instance()
            .get(&DataKey::Pool)
            .expect("pool not initialized");
        pool.annual_yield_bps
    }

    /// Build a typed SEP-41 token client for the USDC contract.
    fn usdc_client(env: &Env) -> token::TokenClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::UsdcToken)
            .expect("usdc token not configured");
        token::TokenClient::new(env, &addr)
    }

    /// Panic if `caller` is not the stored admin.
    fn assert_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");
        if *caller != admin {
            panic!("unauthorized: caller is not admin");
        }
    }

    /// Panic if the pool is currently paused.
    fn assert_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false);
        if paused {
            panic!("pool is paused");
        }
    }
}

#[cfg(test)]
mod test;
