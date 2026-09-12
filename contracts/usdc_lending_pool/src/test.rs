#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

/// Deploy a native Stellar asset (acts as USDC in tests) and return its address.
fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = token_id.address();
    let asset_client = StellarAssetClient::new(env, &addr);
    let token_client = TokenClient::new(env, &addr);
    (addr, asset_client, token_client)
}

/// Standard test setup: deploys the pool + a mock USDC token, mints USDC to
/// `user`, and registers the pool contract so it can transfer-from users.
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    // Yield tests fast-forward the ledger by up to a full year (6.3M ledgers).
    // Raise the entry TTLs so contract storage is not archived along the way.
    env.ledger().with_mut(|li| {
        li.min_temp_entry_ttl = 100_000_000;
        li.min_persistent_entry_ttl = 100_000_000;
        li.max_entry_ttl = 100_000_000;
    });

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Deploy mock USDC token and mint to user + pool (so pool can pay out yield)
    let (usdc_addr, asset_client, _) = create_token(&env, &admin);
    asset_client.mint(&user, &1_000_000_000); // 1 000 USDC (7 decimals assumed)

    // Deploy pool contract
    let pool_id = env.register(UsdcLendingPool, ());

    // Mint tokens to the pool contract as "yield reserve"
    asset_client.mint(&pool_id, &500_000_000);

    // Initialize pool: 5 % annual yield (500 bps)
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.initialize(&admin, &usdc_addr, &500_u32);

    (env, pool_id, admin, user, usdc_addr)
}

// ─── Initialization tests ─────────────────────────────────────────────────────

#[test]
fn test_initialize_stores_pool_state() {
    let (env, pool_id, _admin, _user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    let state = client.get_pool_state();
    assert_eq!(state.total_deposited, 0);
    assert_eq!(state.total_withdrawn, 0);
    assert_eq!(state.annual_yield_bps, 500);
    assert_eq!(state.depositor_count, 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_rejects_double_init() {
    let (env, pool_id, admin, _user, usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.initialize(&admin, &usdc, &500_u32);
}

#[test]
#[should_panic(expected = "annual_yield_bps must be > 0")]
fn test_initialize_rejects_zero_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (usdc_addr, _, _) = create_token(&env, &admin);
    let pool_id = env.register(UsdcLendingPool, ());
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.initialize(&admin, &usdc_addr, &0_u32);
}

#[test]
#[should_panic(expected = "annual_yield_bps must be <= 10000")]
fn test_initialize_rejects_yield_over_max() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (usdc_addr, _, _) = create_token(&env, &admin);
    let pool_id = env.register(UsdcLendingPool, ());
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.initialize(&admin, &usdc_addr, &10_001_u32);
}

// ─── Deposit tests ────────────────────────────────────────────────────────────

#[test]
fn test_deposit_records_principal_and_updates_pool() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    let deposit_amount: i128 = 100_000_000; // 100 USDC
    client.deposit(&user, &deposit_amount);

    let (principal, accrued) = client.get_deposit(&user);
    assert_eq!(principal, deposit_amount);
    assert_eq!(accrued, 0); // no ledgers have advanced

    let state = client.get_pool_state();
    assert_eq!(state.total_deposited, deposit_amount);
    assert_eq!(state.depositor_count, 1);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn test_deposit_rejects_zero_amount() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.deposit(&user, &0_i128);
}

#[test]
#[should_panic(expected = "amount must be > 0")]
fn test_deposit_rejects_negative_amount() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.deposit(&user, &(-1_i128));
}

#[test]
fn test_deposit_accumulates_on_second_deposit() {
    let (env, pool_id, _admin, user, _usdc_addr) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    // First deposit
    client.deposit(&user, &100_000_000_i128);

    // Advance ledger by ~1 year worth of ledgers so yield is meaningful
    env.ledger().with_mut(|li| li.sequence_number += 6_307_200_u32);

    // Second deposit: the previous principal + accrued yield should roll into new principal
    client.deposit(&user, &50_000_000_i128);

    let (principal, _accrued) = client.get_deposit(&user);
    // new principal = original_principal(100M) + yield(~5% of 100M = ~5M) + new_deposit(50M) ≈ 155M
    assert!(principal > 150_000_000, "principal should include rolled-over yield");
    assert!(principal < 160_000_000, "principal should be reasonable");

    let state = client.get_pool_state();
    // total_deposited tracks raw deposit amounts only (100M + 50M)
    assert_eq!(state.total_deposited, 150_000_000);
    // depositor_count stays 1 (same user)
    assert_eq!(state.depositor_count, 1);
}

// ─── Withdrawal tests ─────────────────────────────────────────────────────────

#[test]
fn test_withdraw_returns_principal_plus_yield() {
    let (env, pool_id, _admin, user, usdc_addr) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    // Mint extra reserve to pool so it can cover yield payout
    let token_client = TokenClient::new(&env, &usdc_addr);
    let deposit_amount: i128 = 100_000_000;

    client.deposit(&user, &deposit_amount);

    // Balance after deposit: user gave 100M to pool
    let balance_after_deposit = token_client.balance(&user);

    // Advance ledger by half a year
    env.ledger().with_mut(|li| li.sequence_number += 3_153_600_u32);

    let (principal, expected_yield) = client.get_deposit(&user);
    assert_eq!(principal, deposit_amount);
    // 5% annual / 2 years ≈ 2.5% of 100M = ~2.5M
    assert!(expected_yield > 0, "yield should accrue over ledger time");

    client.withdraw(&user);

    let balance_after_withdraw = token_client.balance(&user);
    let received = balance_after_withdraw - balance_after_deposit;

    assert_eq!(received, principal + expected_yield);
    assert!(received > deposit_amount, "user must receive more than deposited");
}

#[test]
fn test_withdraw_updates_pool_total_withdrawn() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    let deposit_amount: i128 = 50_000_000;
    client.deposit(&user, &deposit_amount);

    // Small ledger advance
    env.ledger().with_mut(|li| li.sequence_number += 100_u32);

    let (principal, yield_amt) = client.get_deposit(&user);
    client.withdraw(&user);

    let state = client.get_pool_state();
    assert_eq!(state.total_withdrawn, principal + yield_amt);
}

#[test]
fn test_withdraw_clears_deposit_record() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.deposit(&user, &100_000_000_i128);
    client.withdraw(&user);

    let (principal, accrued) = client.get_deposit(&user);
    assert_eq!(principal, 0);
    assert_eq!(accrued, 0);
}

#[test]
#[should_panic(expected = "no deposit found for this address")]
fn test_withdraw_without_deposit_panics() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.withdraw(&user);
}

// ─── Yield accrual tests ──────────────────────────────────────────────────────

#[test]
fn test_zero_yield_when_same_ledger() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.deposit(&user, &100_000_000_i128);
    let (principal, accrued) = client.get_deposit(&user);
    assert_eq!(principal, 100_000_000);
    assert_eq!(accrued, 0, "no yield on same ledger");
}

#[test]
fn test_yield_increases_with_ledger_advancement() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.deposit(&user, &100_000_000_i128);

    env.ledger().with_mut(|li| li.sequence_number += 1_000_000_u32);
    let (_, yield_1m) = client.get_deposit(&user);

    env.ledger().with_mut(|li| li.sequence_number += 1_000_000_u32);
    let (_, yield_2m) = client.get_deposit(&user);

    assert!(yield_2m > yield_1m, "yield should grow with more ledgers");
}

#[test]
fn test_full_year_yield_approximately_correct() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    let deposit_amount: i128 = 100_000_000; // 100 USDC (7 decimals)
    client.deposit(&user, &deposit_amount);

    // Advance exactly 1 year of ledgers
    env.ledger().with_mut(|li| li.sequence_number += 6_307_200_u32);

    let (_, accrued) = client.get_deposit(&user);

    // Expected: 5% of 100M = 5M
    let expected = 5_000_000_i128;
    let tolerance = 1_000_i128; // tiny rounding tolerance
    assert!(
        (accrued - expected).abs() <= tolerance,
        "1-year yield should be ~5%, got {}",
        accrued
    );
}

// ─── Multiple depositors ──────────────────────────────────────────────────────

#[test]
fn test_multiple_depositors_tracked_independently() {
    let (env, pool_id, admin, user1, usdc_addr) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    // Create a second user and mint tokens
    let user2 = Address::generate(&env);
    let asset_client = StellarAssetClient::new(&env, &usdc_addr);
    asset_client.mint(&user2, &500_000_000_i128);

    client.deposit(&user1, &100_000_000_i128);

    env.ledger().with_mut(|li| li.sequence_number += 100_u32);

    client.deposit(&user2, &200_000_000_i128);

    let (p1, _) = client.get_deposit(&user1);
    let (p2, _) = client.get_deposit(&user2);

    assert_eq!(p1, 100_000_000);
    assert_eq!(p2, 200_000_000);

    let state = client.get_pool_state();
    assert_eq!(state.total_deposited, 300_000_000);
    assert_eq!(state.depositor_count, 2);
    let _ = admin; // suppress unused warning
}

// ─── Pause / unpause tests ────────────────────────────────────────────────────

#[test]
fn test_pause_prevents_deposit() {
    let (env, pool_id, admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.pause(&admin);
    assert!(client.is_paused());

    // deposit must fail while paused (try_ variant surfaces the panic as Err
    // without needing catch_unwind, which the Env handle does not support)
    let result = client.try_deposit(&user, &100_000_000_i128);
    assert!(result.is_err(), "deposit should be blocked when paused");
}

#[test]
fn test_unpause_restores_deposits() {
    let (env, pool_id, admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());

    // Should succeed after unpausing
    client.deposit(&user, &100_000_000_i128);
    let (principal, _) = client.get_deposit(&user);
    assert_eq!(principal, 100_000_000);
}

#[test]
#[should_panic(expected = "unauthorized: caller is not admin")]
fn test_pause_by_non_admin_panics() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.pause(&user); // user is not admin
}

// ─── Yield rate update tests ───────────────────────────────────────────────────

#[test]
fn test_set_yield_rate_updates_pool_state() {
    let (env, pool_id, admin, _user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);

    client.set_yield_rate(&admin, &1000_u32); // 10%
    let state = client.get_pool_state();
    assert_eq!(state.annual_yield_bps, 1000);
}

#[test]
#[should_panic(expected = "annual_yield_bps must be > 0")]
fn test_set_yield_rate_rejects_zero() {
    let (env, pool_id, admin, _user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.set_yield_rate(&admin, &0_u32);
}

#[test]
#[should_panic(expected = "unauthorized: caller is not admin")]
fn test_set_yield_rate_by_non_admin_panics() {
    let (env, pool_id, _admin, user, _usdc) = setup();
    let client = UsdcLendingPoolClient::new(&env, &pool_id);
    client.set_yield_rate(&user, &1000_u32);
}
