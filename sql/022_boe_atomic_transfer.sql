-- ===========================================================================
-- 022 . BANK OF ETHOS — ATOMIC TRANSFER (the actual anti-dupe fix)
-- ===========================================================================
-- WHY THIS EXISTS, AND WHY 021 WAS NOT ENOUGH
--
--   A deposit was TWO independent writes:
--     • the WALLET debit  -> Profile.gems, a CLIENT value that must be pushed
--     • the BANK credit   -> bank_of_ethos.balance, SERVER-side and durable
--   They were never atomic. The credit always landed. The debit only landed if
--   the client successfully persisted it. EVERY way the client fails to save is
--   therefore a mint:
--     - the 4s debounce losing to a refresh   (the v120t2 theory)
--     - saveProfile() early-returning entirely in a non-writer tab
--       (MultiTab.amWriter === false) — un-persisted state, so awaiting a push
--       of it changes nothing
--     - the freshness guard uploading/restoring an older snapshot
--       ("Cloud fetch skipped: local progression is newer")
--   v120t2 awaited cloudSyncProfile() before the toast. That closes ONE of
--   those and the exploit continued. A client-side ordering fix cannot close
--   this class, because the debit is still client-held.
--
--   THE FIX: the server owns BOTH SIDES of the move, in ONE statement. The
--   client stops doing arithmetic on money and simply adopts what the server
--   returns. There is no client-held debit left to lose.
--
-- SAFETY PROPERTIES
--   * gems are read SERVER-SIDE. A client claiming a balance is ignored.
--   * over-withdraw / over-deposit is refused by the same statement that moves
--     the money, so a refusal cannot half-apply.
--   * every accepted move appends to boe_ledger inside the same transaction —
--     if the ledger write fails the money move rolls back with it.
--   * SECURITY DEFINER + auth.uid(): a caller can only ever move their OWN
--     money. p_user_id is deliberately NOT a parameter.
--   * idempotent DDL; safe to re-run.
--
-- APPLY BY HAND (no CLI login exists). Run the whole file, then the VERIFY
-- block at the bottom.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 0. Shape guards. 021 and earlier files created these with PARTIAL column
--    sets on some databases, so never assume — add what is missing.
-- --------------------------------------------------------------------------
create table if not exists public.bank_of_ethos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric not null default 0
);
alter table public.bank_of_ethos add column if not exists balance   numeric not null default 0;
alter table public.bank_of_ethos add column if not exists aza       numeric not null default 0;
alter table public.bank_of_ethos add column if not exists resources jsonb   not null default '{}'::jsonb;

create table if not exists public.boe_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  kind text not null,
  cinder numeric not null default 0,
  aza numeric not null default 0,
  note text,
  counterparty text
);
alter table public.boe_ledger add column if not exists cinder numeric not null default 0;
alter table public.boe_ledger add column if not exists aza    numeric not null default 0;
alter table public.boe_ledger add column if not exists note   text;
create index if not exists boe_ledger_user_ts on public.boe_ledger (user_id, ts desc);

alter table public.bank_of_ethos enable row level security;
alter table public.boe_ledger    enable row level security;

drop policy if exists boe_self_sel on public.bank_of_ethos;
create policy boe_self_sel on public.bank_of_ethos for select to authenticated using (user_id = auth.uid());
drop policy if exists boe_led_sel on public.boe_ledger;
create policy boe_led_sel on public.boe_ledger for select to authenticated using (user_id = auth.uid());

-- ⚠ NO client-facing INSERT/UPDATE policy on bank_of_ethos is created here.
--    All movement goes through boe_transfer() below, which is SECURITY DEFINER
--    and therefore bypasses RLS on purpose. If an older migration granted the
--    client a direct UPDATE, drop it — a direct update is exactly the hole.
drop policy if exists boe_self_upd on public.bank_of_ethos;
drop policy if exists boe_self_ins on public.bank_of_ethos;

-- --------------------------------------------------------------------------
-- 1. THE TRANSFER. p_dir: 'deposit' = wallet -> bank, 'withdraw' = bank -> wallet.
--    p_amount is always POSITIVE; direction is never inferred from a sign, so a
--    negative amount cannot invert the move.
-- --------------------------------------------------------------------------
create or replace function public.boe_transfer(p_amount numeric, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $t$
declare
  v_uid   uuid := auth.uid();
  v_amt   numeric := floor(coalesce(p_amount, 0));
  v_gems  numeric;
  v_bal   numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_amt is null or v_amt <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if p_dir is null or p_dir not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'bad_direction');
  end if;

  -- Make the row exist, then LOCK it. Every concurrent move for this user
  -- serialises here, so two tabs cannot both read the same balance and both
  -- succeed — that race was itself a way to mint.
  insert into public.bank_of_ethos (user_id, balance)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  select balance into v_bal from public.bank_of_ethos where user_id = v_uid for update;

  -- The wallet is read from the SERVER, never from the caller. Lock it too so
  -- the debit cannot be lost to a concurrent profile upload.
  select coalesce(gems, 0) into v_gems from public.user_profiles where user_id = v_uid for update;
  if v_gems is null then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  if p_dir = 'deposit' then
    if v_gems < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'gems', v_gems, 'balance', v_bal);
    end if;
    update public.user_profiles set gems = gems - v_amt where user_id = v_uid;
    update public.bank_of_ethos  set balance = balance + v_amt where user_id = v_uid;
  else
    if v_bal < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_bank',
                                'gems', v_gems, 'balance', v_bal);
    end if;
    update public.bank_of_ethos  set balance = balance - v_amt where user_id = v_uid;
    update public.user_profiles  set gems = coalesce(gems,0) + v_amt where user_id = v_uid;
  end if;

  -- Same transaction: if this fails, the money move rolls back with it.
  insert into public.boe_ledger (user_id, kind, cinder, note)
  values (v_uid, p_dir, case when p_dir = 'deposit' then v_amt else -v_amt end,
          'atomic ' || p_dir);

  select coalesce(gems,0) into v_gems from public.user_profiles where user_id = v_uid;
  select balance          into v_bal  from public.bank_of_ethos  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'gems', v_gems, 'balance', v_bal, 'moved', v_amt, 'dir', p_dir);
end;
$t$;

revoke all on function public.boe_transfer(numeric, text) from public;
grant execute on function public.boe_transfer(numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 1b. THE SAME MOVE FOR AZA (👑) — user_profiles.sovereigns <-> bank_of_ethos.aza
--
--     ⚠ AZA IS BOUGHT WITH REAL MONEY, so this is the more serious of the two.
--     It had the identical split-write: sovereigns are client-held and pushed,
--     the bank's aza column is server-side and durable, so every way the client
--     failed to save the debit minted premium currency.
--
--     A SEPARATE FUNCTION, not an overload of boe_transfer(). PostgREST resolves
--     overloads by argument NAMES and a same-arity ambiguity is a genuine
--     footgun; a distinct name also means the already-deployed 2-arg Cinder
--     calls keep working untouched.
-- --------------------------------------------------------------------------
create or replace function public.boe_transfer_aza(p_amount numeric, p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $a$
declare
  v_uid  uuid := auth.uid();
  v_amt  numeric := floor(coalesce(p_amount, 0));
  v_sov  numeric;
  v_bank numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_amt is null or v_amt <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if p_dir is null or p_dir not in ('deposit', 'withdraw') then
    return jsonb_build_object('ok', false, 'error', 'bad_direction');
  end if;

  insert into public.bank_of_ethos (user_id, balance)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  select coalesce(aza, 0) into v_bank from public.bank_of_ethos where user_id = v_uid for update;
  select coalesce(sovereigns, 0) into v_sov from public.user_profiles where user_id = v_uid for update;
  if v_sov is null then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  if p_dir = 'deposit' then
    if v_sov < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_wallet',
                                'aza', v_sov, 'bank_aza', v_bank);
    end if;
    update public.user_profiles set sovereigns = coalesce(sovereigns,0) - v_amt where user_id = v_uid;
    update public.bank_of_ethos  set aza        = coalesce(aza,0)        + v_amt where user_id = v_uid;
  else
    if v_bank < v_amt then
      return jsonb_build_object('ok', false, 'error', 'insufficient_bank',
                                'aza', v_sov, 'bank_aza', v_bank);
    end if;
    update public.bank_of_ethos  set aza        = coalesce(aza,0)        - v_amt where user_id = v_uid;
    update public.user_profiles  set sovereigns = coalesce(sovereigns,0) + v_amt where user_id = v_uid;
  end if;

  insert into public.boe_ledger (user_id, kind, aza, note)
  values (v_uid, p_dir || '_aza',
          case when p_dir = 'deposit' then v_amt else -v_amt end,
          'atomic ' || p_dir || ' (aza)');

  select coalesce(sovereigns,0) into v_sov  from public.user_profiles where user_id = v_uid;
  select coalesce(aza,0)        into v_bank from public.bank_of_ethos  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'aza', v_sov, 'bank_aza', v_bank, 'moved', v_amt, 'dir', p_dir);
end;
$a$;

revoke all on function public.boe_transfer_aza(numeric, text) from public;
grant execute on function public.boe_transfer_aza(numeric, text) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Authoritative read, so the client can resync both sides after a move
--    without trusting its own cached numbers.
-- --------------------------------------------------------------------------
create or replace function public.boe_balances()
returns jsonb
language plpgsql
security definer
set search_path = public
as $b$
declare
  v_uid uuid := auth.uid();
  v_gems numeric; v_bal numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select coalesce(gems,0)    into v_gems from public.user_profiles where user_id = v_uid;
  select coalesce(balance,0) into v_bal  from public.bank_of_ethos  where user_id = v_uid;
  return jsonb_build_object('ok', true, 'gems', coalesce(v_gems,0), 'balance', coalesce(v_bal,0));
end;
$b$;
revoke all on function public.boe_balances() from public;
grant execute on function public.boe_balances() to authenticated;

-- ===========================================================================
-- VERIFY — run after applying. Expect both functions present and executable.
-- ===========================================================================
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('boe_transfer','boe_balances')
--  order by 1;
--
-- Expect NO client UPDATE policy left on the bank table:
-- select policyname, cmd from pg_policies
--  where schemaname='public' and tablename='bank_of_ethos' order by 1;
