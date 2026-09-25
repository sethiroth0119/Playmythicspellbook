-- ═══════════════════════════════════════════════════════════════════════════
-- 017 · AZA → CINDER EXCHANGE, WITH A NON-WITHDRAWABLE TAG
--
-- Backs the "Bank of Ethos" ATM on the marketing site's account page
-- (market-deploy/public/index.html → BankOfEthosATM).
--
-- ─────────────────────────────────────────────────────────────────────────
-- 🔴 WHY THIS FILE EXISTS AT ALL — READ BEFORE CHANGING ANY LINE
-- ─────────────────────────────────────────────────────────────────────────
-- Aza is BOUGHT with a credit card. Cinder is CASHED OUT for real money.
-- A plain Aza → Cinder conversion therefore builds a money-out pipe for
-- money-in currency:
--
--       card → Aza → Cinder → payout
--
-- That is money transmission, and it is the classic card-fraud laundering
-- shape (buy with a stolen card, convert, withdraw, charge back). It also
-- silently voids the promise printed on the site's own Shop page:
-- "Cinders can be cashed out for real money. Aza coin cannot."
--
-- So the exchange does NOT simply move numbers between two columns. Every
-- exchange writes an append-only row here recording exactly how much Cinder
-- came from Aza, and `cinder_cashable()` below subtracts that lifetime total
-- from the withdrawable balance. Converted Cinder spends anywhere in the game
-- and can never legitimately leave as money.
--
-- ⚠️ THE TAG IS ONLY HALF A GUARANTEE UNTIL THE PAYOUT GATES CONSULT IT.
--    Two paths can still spend Cinder toward a withdrawal and neither reads
--    this ledger yet:
--      1. worker.js  /api/cashout/payout  — takes `usd` from the request body
--         with no ledger derivation at all (it is 501-disabled by default,
--         and STRIPE.md already flags this as a pre-launch requirement).
--      2. game-deploy/public/index.html → requestCashout() — a client-side
--         mock vault, i.e. not a security boundary in the first place.
--    Before CASHOUT_PAYOUTS_ENABLED is ever set to true, both must clamp the
--    payout to `public.cinder_cashable()`. See the note at the bottom.
--
-- ⚠️ There is ALSO a second, UNTAGGED exchange already in the game:
--    boeExchangeAzaToCinder() (public/index.html ≈ 58032) converts at the
--    same 1:5000 peg straight through boe_adjust_balance, writing no ledger
--    row. Its own comment calls "buy Aza → exchange → cash out" the intended
--    design. Until it is routed through this RPC, the tag is bypassable by
--    doing the conversion in-game instead. That is a product decision, not a
--    bug this file can fix on its own.
--
-- Requires: user_profiles (gems = Cinder, sovereigns = Aza).
-- Supabase SQL editor, project ktsiasyjusesawtrwrjc. Idempotent, re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ledger ───────────────────────────────────────────────────────────
-- APPEND-ONLY, the same shape as corp_treasury / community_ledger: the total
-- is sum(cinder_credited), never a balance column, because a balance column
-- is a thing that can drift from its own history — and here the history is
-- the only evidence of which Cinder is not withdrawable.
create table if not exists public.aza_cinder_exchanges (
  id              bigserial primary key,
  user_id         uuid   not null references auth.users(id) on delete cascade,
  aza_spent       bigint not null check (aza_spent > 0),
  cinder_credited bigint not null check (cinder_credited > 0),
  rate            bigint not null check (rate > 0),
  created_at      timestamptz not null default now()
);
create index if not exists aza_cinder_exchanges_user
  on public.aza_cinder_exchanges (user_id, created_at desc);

alter table public.aza_cinder_exchanges enable row level security;

-- 🔒 POLICY REVIEW — RLS is the entire security boundary here.
--
-- SELECT: a player may read their OWN exchanges (the ATM shows the locked
-- total). `user_id = auth.uid()` — no subquery, nothing another user can
-- influence, and `to authenticated` keeps anon out entirely.
drop policy if exists ace_sel on public.aza_cinder_exchanges;
create policy ace_sel on public.aza_cinder_exchanges for select to authenticated
  using (user_id = auth.uid());

-- INSERT / UPDATE / DELETE: no policy exists, deliberately.
-- With RLS on and no permissive policy, every such statement matches nothing.
-- The grants are revoked as well, so the ledger is writable ONLY by the
-- SECURITY DEFINER function below. A player who could insert here could
-- forge history; a player who could delete here could un-tag their own
-- purchased Cinder and cash it out — which is the whole attack.
revoke insert, update, delete on public.aza_cinder_exchanges from anon, authenticated;
revoke all   on sequence public.aza_cinder_exchanges_id_seq from anon, authenticated;


-- ── The exchange ─────────────────────────────────────────────────────────
-- 💱 ONE-WAY, IRREVERSIBLE, and the ONLY server-side path that may credit
-- Cinder from Aza. There is no Cinder → Aza direction: Aza is a purchased
-- reserve, and a round trip would let a player wash earned Cinder into
-- "purchased" Aza and back to hide its origin.
--
-- 🔒 SECURITY DEFINER — required, because it writes a ledger the caller is
--    denied on. It is safe here only because:
--      · `set search_path = public` is pinned, so a caller cannot shadow
--        `public` with their own tables and have them run as the owner.
--      · There is NO parameter naming a user. Every row it touches is keyed
--        by auth.uid(), so it cannot be aimed at anybody else's balance.
--      · The debit, the credit and the ledger row are one statement pair in
--        one function body = one transaction. A half-applied exchange
--        (Aza gone, no Cinder — or Cinder minted, no ledger row) is not a
--        reachable state.
create or replace function public.aza_to_cinder_exchange(p_aza integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid   := auth.uid();
  v_rate   bigint := 5000;   -- canonical peg: 1 Aza = $1 = 5,000 Cinder
                             -- (game: AZA_TO_CINDER / CASHOUT_RATE_PER_DOLLAR)
  v_cinder bigint;
  v_gems   bigint;
  v_sov    bigint;
  v_locked bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Amount validation. `integer` already rejects 1.5 and "abc" at the type
  -- boundary before this body runs; these catch the rest. The upper bound is
  -- not a business rule, it is a blast-radius cap on a single call.
  if p_aza is null or p_aza <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  if p_aza > 100000 then
    return jsonb_build_object('ok', false, 'error', 'amount_too_large');
  end if;

  v_cinder := p_aza::bigint * v_rate;

  -- The debit and the credit are the SAME statement, and the funds check is
  -- part of its WHERE clause rather than an `if` before it. Two concurrent
  -- tabs cannot both pass a check and then both write: the row is locked for
  -- the duration of the update, and an overdraw simply matches no row.
  update public.user_profiles
     set sovereigns = coalesce(sovereigns, 0) - p_aza,
         gems       = coalesce(gems, 0) + v_cinder,
         updated_at = now()
   where user_id = v_uid
     and coalesce(sovereigns, 0) >= p_aza
  returning gems, sovereigns into v_gems, v_sov;

  if not found then
    -- Either no profile row, or not enough Aza. Report the CURRENT balances
    -- so the client corrects its copy instead of guessing.
    select coalesce(gems, 0), coalesce(sovereigns, 0) into v_gems, v_sov
      from public.user_profiles where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_aza',
                              'gems', coalesce(v_gems, 0), 'sovereigns', coalesce(v_sov, 0));
  end if;

  -- 🔴 The tag. Same transaction as the credit above: if this insert raises,
  -- the balance move is rolled back with it, so untagged Cinder cannot exist.
  insert into public.aza_cinder_exchanges (user_id, aza_spent, cinder_credited, rate)
  values (v_uid, p_aza, v_cinder, v_rate);

  select coalesce(sum(cinder_credited), 0) into v_locked
    from public.aza_cinder_exchanges where user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'aza_spent', p_aza,
    'cinder_credited', v_cinder,
    'rate', v_rate,
    'gems', v_gems,
    'sovereigns', v_sov,
    'locked_cinder', v_locked,
    'cashable_cinder', greatest(0, coalesce(v_gems, 0) - v_locked)
  );
end $$;


-- ── The two read-only derivations the cash-out path must use ─────────────
-- Lifetime Cinder this player minted from purchased Aza. Never decreases:
-- spending converted Cinder does not make the next Cinder withdrawable,
-- because balances are fungible and the alternative is a free laundering
-- window (convert, spend earned Cinder, withdraw the converted Cinder).
create or replace function public.cinder_from_aza_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cinder_credited), 0)::bigint
    from public.aza_cinder_exchanges
   where user_id = auth.uid();
$$;

-- 🔴 THE WITHDRAWABLE BALANCE. Any payout path — the Worker's
-- /api/cashout/payout, the in-game vault, a future webhook — must clamp to
-- THIS, not to user_profiles.gems. gems includes purchased value; this does
-- not.
create or replace function public.cinder_cashable()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
           0,
           coalesce((select gems from public.user_profiles where user_id = auth.uid()), 0)
             - coalesce((select sum(cinder_credited) from public.aza_cinder_exchanges
                          where user_id = auth.uid()), 0)
         )::bigint;
$$;

-- Execute grants: signed-in users only. `public`/`anon` get nothing — an
-- anonymous caller has no auth.uid() and would only ever burn a round trip,
-- but there is no reason to let them reach a SECURITY DEFINER body at all.
revoke all on function public.aza_to_cinder_exchange(integer) from public, anon;
revoke all on function public.cinder_from_aza_total()        from public, anon;
revoke all on function public.cinder_cashable()              from public, anon;
grant execute on function public.aza_to_cinder_exchange(integer) to authenticated;
grant execute on function public.cinder_from_aza_total()         to authenticated;
grant execute on function public.cinder_cashable()               to authenticated;


-- ─── VERIFY ── expect table 1, select_policies 1, write_policies 0, rpcs 3
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename = 'aza_cinder_exchanges')                                as table_,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'aza_cinder_exchanges' and cmd = 'SELECT')             as select_policies,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'aza_cinder_exchanges' and cmd <> 'SELECT')            as write_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('aza_to_cinder_exchange','cinder_from_aza_total','cinder_cashable')) as rpcs;

-- Sanity check on your OWN account (safe — reads only):
--   select public.cinder_from_aza_total(), public.cinder_cashable();
-- A rejection path, also safe (writes nothing):
--   select public.aza_to_cinder_exchange(0);   -- expect ok:false bad_amount

-- ─────────────────────────────────────────────────────────────────────────
-- ⛔ BEFORE ENABLING REAL PAYOUTS (CASHOUT_PAYOUTS_ENABLED=true), the payout
--    amount must be derived from public.cinder_cashable() server-side. In
--    worker.js the guard belongs in handleCashout()'s `payout` branch, and it
--    must FAIL CLOSED if this migration has not been applied:
--
--      const rc = await fetch(SB_URL + '/rest/v1/rpc/cinder_cashable', {
--        method: 'POST',
--        headers: { apikey: env.SB_ANON, authorization: 'Bearer ' + user.token,
--                   'content-type': 'application/json' },
--        body: '{}',
--      });
--      if (!rc.ok) return cjson({ error: 'cashout_ledger_missing' }, 503);
--      const cashable = Number(await rc.json()) || 0;
--      if (usd * 5000 > cashable) return cjson({ error: 'not_cashable' }, 400);
--
--    Deliberately NOT applied here: worker.js is outside the scope of the
--    change that added this file, and the endpoint is 501-disabled today.
-- ─────────────────────────────────────────────────────────────────────────
