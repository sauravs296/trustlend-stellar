-- Functions and triggers that live in the database.
--
-- Authorization is NOT enforced here (there is no auth.uid() on Neon): every
-- caller is the application server, which verifies the session before it
-- invokes any of these. Keep them limited to logic that genuinely benefits
-- from running inside Postgres — row locks, atomic multi-row transitions and
-- triggers.

-- ─── updated_at maintenance ───────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_reputation_snapshots_updated_at
before update on public.reputation_snapshots
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_lending_pools_updated_at
before update on public.lending_pools
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_pool_positions_updated_at
before update on public.pool_positions
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_loans_updated_at
before update on public.loans
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_ledger_transactions_updated_at
before update on public.ledger_transactions
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_external_verifications_updated_at
before update on public.external_verifications
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_webhook_endpoints_updated_at
before update on public.webhook_endpoints
for each row execute function public.set_updated_at();
--> statement-breakpoint
create trigger trg_referrals_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();
--> statement-breakpoint

-- ─── Reputation snapshot kept in sync with events ─────────────────────────────

create or replace function public.sync_reputation_snapshot_from_event()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  existing_repayment_score integer := 0;
  existing_lending_score integer := 0;
  existing_consistency_score integer := 0;
  existing_external_score integer := 0;
  existing_level text := 'bronze';
  total_points integer := 0;
  computed_total integer := 250;
begin
  if new.user_id is null then
    return new;
  end if;

  select
    coalesce(score_total, 250),
    coalesce(repayment_score, 0),
    coalesce(lending_score, 0),
    coalesce(consistency_score, 0),
    coalesce(external_score, 0),
    coalesce(reputation_level, 'bronze')
  into computed_total, existing_repayment_score, existing_lending_score,
       existing_consistency_score, existing_external_score, existing_level
  from public.reputation_snapshots
  where user_id = new.user_id;

  select coalesce(sum(points_delta), 0)
  into total_points
  from public.reputation_events
  where user_id = new.user_id;

  computed_total := greatest(0, least(750, 250 + total_points));

  insert into public.reputation_snapshots (
    user_id, score_total, repayment_score, lending_score, consistency_score,
    external_score, reputation_level, calculated_at, updated_at
  )
  values (
    new.user_id, computed_total, existing_repayment_score, existing_lending_score,
    existing_consistency_score, existing_external_score, existing_level, now(), now()
  )
  on conflict (user_id) do update
    set score_total = excluded.score_total,
        repayment_score = excluded.repayment_score,
        lending_score = excluded.lending_score,
        consistency_score = excluded.consistency_score,
        external_score = excluded.external_score,
        reputation_level = excluded.reputation_level,
        calculated_at = excluded.calculated_at,
        updated_at = excluded.updated_at;

  return new;
end;
$$;
--> statement-breakpoint

create trigger trg_reputation_events_snapshot
after insert on public.reputation_events
for each row execute function public.sync_reputation_snapshot_from_event();
--> statement-breakpoint

-- ─── Referral codes ───────────────────────────────────────────────────────────

create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_code := 'TL';
    for _ in 1..6 loop
      v_code := v_code || substr(v_alphabet, floor(random() * 30)::int + 1, 1);
    end loop;

    exit when not exists (
      select 1 from public.profiles where referral_code = v_code
    );

    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'Could not generate a unique referral code after % attempts', v_attempt;
    end if;
  end loop;

  return v_code;
end;
$$;
--> statement-breakpoint

create or replace function public.ensure_referral_code(p_user_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  select referral_code into v_code from public.profiles where id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;

  v_code := public.generate_referral_code();

  update public.profiles
  set referral_code = v_code
  where id = p_user_id and referral_code is null;

  select referral_code into v_code from public.profiles where id = p_user_id;
  return v_code;
end;
$$;
--> statement-breakpoint

create or replace function public.assign_referral_code_on_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.referral_code is null then
    new.referral_code := public.generate_referral_code();
  end if;
  return new;
exception
  when others then
    return new;
end;
$$;
--> statement-breakpoint

create trigger trg_profiles_referral_code
before insert on public.profiles
for each row execute function public.assign_referral_code_on_profile();
--> statement-breakpoint

-- Attribute a new user to a referrer. Idempotent: a referee is attributed once.
create or replace function public.record_referral(
  p_referee_id uuid,
  p_referral_code text
)
returns table (
  referral_id uuid,
  referrer_id uuid,
  status public.referral_status
)
language plpgsql
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_code text;
  v_referral_id uuid;
  v_status public.referral_status;
begin
  v_code := upper(trim(p_referral_code));

  if v_code is null or v_code = '' then
    raise exception 'Referral code is required';
  end if;

  select id into v_referrer_id from public.profiles where referral_code = v_code;

  if v_referrer_id is null then
    raise exception 'Unknown referral code';
  end if;

  if v_referrer_id = p_referee_id then
    raise exception 'Cannot refer yourself';
  end if;

  insert into public.referrals (referrer_id, referee_id, referral_code, status)
  values (v_referrer_id, p_referee_id, v_code, 'pending')
  on conflict (referee_id) do nothing
  returning id into v_referral_id;

  if v_referral_id is null then
    select r.id, r.referrer_id, r.status
    into v_referral_id, v_referrer_id, v_status
    from public.referrals r
    where r.referee_id = p_referee_id;

    referral_id := v_referral_id;
    referrer_id := v_referrer_id;
    status := v_status;
    return next;
    return;
  end if;

  referral_id := v_referral_id;
  referrer_id := v_referrer_id;
  status := 'pending'::public.referral_status;
  return next;
end;
$$;
--> statement-breakpoint

-- Mark a pending referral qualified when the referee's loan activates.
create or replace function public.qualify_referral(
  p_referee_id uuid,
  p_loan_id uuid
)
returns table (
  referral_id uuid,
  referrer_id uuid,
  status public.referral_status
)
language plpgsql
set search_path = public
as $$
declare
  v_row public.referrals;
begin
  select * into v_row from public.referrals where referee_id = p_referee_id for update;

  if not found then
    return;
  end if;

  if v_row.status <> 'pending'::public.referral_status then
    referral_id := v_row.id;
    referrer_id := v_row.referrer_id;
    status := v_row.status;
    return next;
    return;
  end if;

  update public.referrals
  set status = 'qualified'::public.referral_status,
      qualifying_loan_id = p_loan_id,
      qualified_at = now()
  where id = v_row.id;

  referral_id := v_row.id;
  referrer_id := v_row.referrer_id;
  status := 'qualified'::public.referral_status;
  return next;
end;
$$;
--> statement-breakpoint

create or replace function public.settle_referral_payout(
  p_referral_id uuid,
  p_bonus_amount numeric,
  p_tx_hash text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_bonus_amount < 0 then
    raise exception 'Bonus amount cannot be negative';
  end if;

  update public.referrals
  set status = 'paid'::public.referral_status,
      bonus_amount = p_bonus_amount,
      payout_tx_hash = p_tx_hash,
      paid_at = now()
  where id = p_referral_id
    and status <> 'paid'::public.referral_status;
end;
$$;
--> statement-breakpoint

-- ─── Loan funding (partial fills, row-locked) ─────────────────────────────────

create or replace function public.record_loan_funding(
  p_loan_id uuid,
  p_lender_id uuid,
  p_amount numeric,
  p_tx_hash text,
  p_lender_address text default null,
  p_funded_at timestamptz default now()
)
returns table (
  loan_id uuid,
  status public.loan_status,
  principal_amount numeric,
  funded_amount numeric,
  remaining_amount numeric,
  is_fully_funded boolean,
  funding_id uuid
)
language plpgsql
set search_path = public
as $$
declare
  v_loan public.loans;
  v_new_total numeric(20, 6);
  v_remaining numeric(20, 6);
  v_funding_id uuid;
  v_due_at timestamptz;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'funding amount must be greater than zero';
  end if;

  if p_tx_hash is null or length(trim(p_tx_hash)) = 0 then
    raise exception 'a stellar transaction hash is required';
  end if;

  -- Lock the loan so two lenders cannot both read the same remaining amount.
  select * into v_loan from public.loans where id = p_loan_id for update;

  if not found then
    raise exception 'loan not found';
  end if;

  if v_loan.status not in ('requested', 'approved') then
    raise exception 'loan is not available for funding (status: %)', v_loan.status;
  end if;

  if v_loan.borrower_id = p_lender_id then
    raise exception 'you cannot fund your own loan';
  end if;

  v_remaining := v_loan.principal_amount - v_loan.funded_amount;

  if v_remaining <= 0 then
    raise exception 'loan is already fully funded';
  end if;

  -- The lender already sent exactly p_amount on-chain; never silently cap it.
  if p_amount > v_remaining then
    raise exception 'funding amount % exceeds the remaining % on this loan', p_amount, v_remaining;
  end if;

  insert into public.loan_fundings (loan_id, lender_id, amount, tx_hash, lender_address, funded_at)
  values (p_loan_id, p_lender_id, p_amount, trim(p_tx_hash), p_lender_address, p_funded_at)
  returning id into v_funding_id;

  v_new_total := v_loan.funded_amount + p_amount;

  if v_new_total >= v_loan.principal_amount then
    v_due_at := p_funded_at + make_interval(days => v_loan.duration_days);

    update public.loans
    set funded_amount = v_new_total,
        status        = 'active',
        approved_at   = coalesce(approved_at, p_funded_at),
        funded_at     = coalesce(funded_at, p_funded_at),
        due_at        = v_due_at,
        updated_at    = now()
    where id = p_loan_id
    returning * into v_loan;
  else
    update public.loans
    set funded_amount = v_new_total,
        updated_at    = now()
    where id = p_loan_id
    returning * into v_loan;
  end if;

  return query
  select
    v_loan.id,
    v_loan.status,
    v_loan.principal_amount,
    v_loan.funded_amount,
    greatest(v_loan.principal_amount - v_loan.funded_amount, 0)::numeric,
    (v_loan.funded_amount >= v_loan.principal_amount),
    v_funding_id;
end;
$$;
