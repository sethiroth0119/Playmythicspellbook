-- ============================================================================
-- RUN_017 — Aza → Cinder exchange, and keeping purchased money out of cash-out.
--
-- WHAT THIS IS FOR
-- The marketplace site is gaining (a) Aza Coin packages, (b) a Bank-of-Ethos
-- ATM that converts Aza → Cinder, and (c) the Cashout Vault.
--
-- 🔴 THE REASON THIS FILE EXISTS AT ALL — READ BEFORE CHANGING ANYTHING.
-- The product promises, in its own words, on the same pages:
--     "Aza coin is purchased — never dropped, never rewarded."
--     "Cinders can be cashed out for real money. Aza coin cannot."
-- An Aza → Cinder exchange breaks that in one hop: buy Aza with a card,
-- convert to Cinder, withdraw real money. That is a money-transmission and
-- chargeback exposure (buy $150, convert, withdraw, then reverse the card),
-- and it silently voids a guarantee printed next to the button.
-- So every Cinder minted from Aza is RECORDED, and the cash-out path must ask
-- for `cashable_cinder()`, never the raw balance.
--
-- Existing, NOT created here: user_profiles(sovereigns = Aza, gems = Cinder),
-- aza_purchases, cashout_requests(user_id, cinders, usd, method, status, reason).
--
-- Idempotent and re-runnable. RLS ships in this file. Ends with a verify query.
-- ============================================================================

-- ── 1. The tuning row. Economy numbers do not get hardcoded in code. ────────
create table if not exists public.aza_config (
  id              int primary key default 1,
  cinder_per_aza  int not null default 5000,
  min_aza         int not null default 1,
  max_aza_per_day int not null default 1000,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  constraint aza_config_singleton check (id = 1),
  constraint aza_config_sane check (cinder_per_aza > 0 and min_aza > 0 and max_aza_per_day > 0)
);
insert into public.aza_config (id) values (1) on conflict (id) do nothing;

/* ⚠ 5,000 Cinder per Aza is a PLACEHOLDER chosen to line up with the Cashout
   Vault's own base rate (5,000 Cinder = $1.00), i.e. 1 Aza ≈ $1 of Cinder.
   It is deliberately NOT a bargain: pricing it generously would make buying
   Aza the cheapest route to Cinder and quietly turn the game into a shop.
   Change it here, not in code:
     update public.aza_config set cinder_per_aza = <n>, updated_at = now() where id = 1;   */

alter table public.aza_config enable row level security;
drop policy if exists azacfg_sel on public.aza_config;
-- Readable by anyone signed in (the ATM must show the rate); writable by nobody
-- through the API — change it in the SQL editor.
create policy azacfg_sel on public.aza_config for select to authenticated using (true);


-- ── 2. The ledger of every conversion. Append-only. ────────────────────────
create table if not exists public.aza_exchanges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  aza_spent     int not null,
  cinder_minted bigint not null,
  rate          int not null,
  created_at    timestamptz not null default now(),
  constraint aza_exchanges_positive check (aza_spent > 0 and cinder_minted > 0 and rate > 0)
);
create index if not exists aza_exchanges_user on public.aza_exchanges (user_id, created_at desc);

alter table public.aza_exchanges enable row level security;
drop policy if exists azaex_sel on public.aza_exchanges;
-- You may read your own history. There is deliberately NO insert/update/delete
-- policy: rows are written only by the SECURITY DEFINER function below, so a
-- client cannot mint itself Cinder by inserting a row.
create policy azaex_sel on public.aza_exchanges for select to authenticated
  using (user_id = auth.uid());


-- ── 3. How much of a player's Cinder came from Aza, and how much is cashable ─
create or replace function public.cinder_from_aza(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cinder_minted), 0)::bigint
  from public.aza_exchanges where user_id = p_user;
$$;

/* ⭐ THE FUNCTION THE CASH-OUT PATH MUST ASK. Never offer `gems` directly.
   Cash-out already paid out is NOT subtracted here — cashout_requests is the
   record of that and the balance has already been debited for it; subtracting
   again would double-count. What this removes is only the purchased portion. */
create or replace function public.cashable_cinder(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce((select gems from public.user_profiles where user_id = p_user), 0)::bigint
    - public.cinder_from_aza(p_user)
  );
$$;

revoke all on function public.cinder_from_aza(uuid) from public, anon;
revoke all on function public.cashable_cinder(uuid) from public, anon;
grant execute on function public.cinder_from_aza(uuid) to authenticated;
grant execute on function public.cashable_cinder(uuid) to authenticated;


-- ── 4. The exchange itself. The ONLY way Aza becomes Cinder. ───────────────
/* 🔒 SECURITY REVIEW — every line matters, per CLAUDE.md.
   · SECURITY DEFINER with a PINNED search_path: without the pin a caller could
     shadow `public` and run their own tables as the owner.
   · Acts ONLY on auth.uid(). There is no user_id argument to forge.
   · The debit is a single conditional UPDATE — `sovereigns >= p_aza` lives in
     the WHERE clause, so two concurrent calls cannot both pass a check-then-act
     race and overdraw. If it matches no row, the caller could not afford it.
   · Debit and credit are one statement each inside one function, so the
     transaction is all-or-nothing. A crash between them rolls both back.
   · Non-positive and non-integer amounts are rejected before anything moves.
   · A daily ceiling limits the blast radius of a stolen session. */
create or replace function public.aza_exchange(p_aza int)
returns table (aza_left int, cinder bigint, minted bigint, rate int)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_cfg   public.aza_config%rowtype;
  v_today int;
  v_mint  bigint;
  v_ok    boolean := false;
begin
  if v_uid is null then raise exception 'aza_exchange: not signed in'; end if;

  select * into v_cfg from public.aza_config where id = 1;
  if not found or not v_cfg.enabled then
    raise exception 'aza_exchange: the exchange is closed';
  end if;
  if p_aza is null or p_aza <= 0 then
    raise exception 'aza_exchange: amount must be a positive whole number';
  end if;
  if p_aza < v_cfg.min_aza then
    raise exception 'aza_exchange: minimum is % Aza', v_cfg.min_aza;
  end if;

  select coalesce(sum(aza_spent), 0) into v_today
  from public.aza_exchanges
  where user_id = v_uid and created_at > now() - interval '24 hours';

  if v_today + p_aza > v_cfg.max_aza_per_day then
    raise exception 'aza_exchange: daily limit is % Aza (% already exchanged today)',
      v_cfg.max_aza_per_day, v_today;
  end if;

  v_mint := (p_aza::bigint) * v_cfg.cinder_per_aza;

  -- Debit Aza. The balance test is IN the WHERE clause, so this is the
  -- concurrency guard as well as the affordability check.
  update public.user_profiles
     set sovereigns = sovereigns - p_aza
   where user_id = v_uid and coalesce(sovereigns, 0) >= p_aza
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'aza_exchange: not enough Aza';
  end if;

  update public.user_profiles
     set gems = coalesce(gems, 0) + v_mint
   where user_id = v_uid;

  -- The record that keeps this Cinder out of cash-out, forever.
  insert into public.aza_exchanges (user_id, aza_spent, cinder_minted, rate)
  values (v_uid, p_aza, v_mint, v_cfg.cinder_per_aza);

  return query
    select coalesce(p.sovereigns, 0)::int,
           coalesce(p.gems, 0)::bigint,
           v_mint,
           v_cfg.cinder_per_aza
    from public.user_profiles p where p.user_id = v_uid;
end;
$fn$;

revoke all on function public.aza_exchange(int) from public, anon;
grant execute on function public.aza_exchange(int) to authenticated;


-- ── 5. Make the cash-out path honour it. ───────────────────────────────────
/* The site and the game must both ask this instead of reading `gems`. It
   returns everything the Vault needs in one call, so no client ever has to
   compute the cashable figure itself (and therefore cannot get it wrong). */
create or replace function public.cashout_snapshot()
returns table (
  cinder_total   bigint,
  cinder_from_aza bigint,
  cinder_cashable bigint,
  aza             int,
  pending_usd     numeric,
  lifetime_usd    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select gems from public.user_profiles where user_id = auth.uid()), 0)::bigint,
    public.cinder_from_aza(auth.uid()),
    public.cashable_cinder(auth.uid()),
    coalesce((select sovereigns from public.user_profiles where user_id = auth.uid()), 0)::int,
    coalesce((select sum(usd) from public.cashout_requests
               where user_id = auth.uid() and status in ('pending','held')), 0)::numeric,
    coalesce((select sum(usd) from public.cashout_requests
               where user_id = auth.uid() and status = 'paid'), 0)::numeric;
$$;

revoke all on function public.cashout_snapshot() from public, anon;
grant execute on function public.cashout_snapshot() to authenticated;


-- ============================================================================
-- VERIFY — every row below must be true before you trust this.
-- ============================================================================
select 'aza_config row'      as check, (select count(*) = 1 from public.aza_config where id = 1) as ok
union all
select 'aza_exchanges RLS on',   (select relrowsecurity from pg_class where oid = 'public.aza_exchanges'::regclass)
union all
select 'aza_exchanges select-only (1 policy)',
       (select count(*) = 1 from pg_policies where tablename = 'aza_exchanges')
union all
select 'no INSERT policy on aza_exchanges',
       (select count(*) = 0 from pg_policies where tablename = 'aza_exchanges' and cmd = 'INSERT')
union all
select '4 functions present',
       (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('aza_exchange','cinder_from_aza','cashable_cinder','cashout_snapshot'))
union all
select 'all 4 are SECURITY DEFINER',
       (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('aza_exchange','cinder_from_aza','cashable_cinder','cashout_snapshot'))
union all
select 'all 4 pin search_path',
       (select bool_and(p.proconfig::text like '%search_path=public%')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('aza_exchange','cinder_from_aza','cashable_cinder','cashout_snapshot'));

-- ── Then prove it end to end, signed in as a real test account: ────────────
--   select * from public.cashout_snapshot();        -- note cinder_cashable
--   select * from public.aza_exchange(1);           -- converts 1 Aza
--   select * from public.cashout_snapshot();
-- EXPECT: cinder_total rises by the rate, cinder_from_aza rises by the SAME
-- amount, and cinder_cashable is UNCHANGED. If cashable moved, stop — the
-- guarantee is broken and Aza has become cashable.
--
-- Then try to break it (all four must FAIL):
--   select * from public.aza_exchange(0);
--   select * from public.aza_exchange(-5);
--   select * from public.aza_exchange(999999999);
--   insert into public.aza_exchanges (user_id, aza_spent, cinder_minted, rate)
--     values (auth.uid(), 1, 999999999, 1);   -- must be refused by RLS
