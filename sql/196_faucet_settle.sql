-- ============================================================================
-- 196 — PER-SOURCE CINDER FAUCETS: four client-named credits get their own
--       server door, each with a bound the server works out for itself.
--
-- WHY. public.wallet_credit(p_amount, p_reason, p_ref) is SECURITY DEFINER and
-- executable by `authenticated`. Any signed-in client can credit itself any
-- amount under any reason, bounded only by sql/093 (2M a call, 10M an hour, a
-- 4.5M/day ceiling past which the rest is HELD, not refused). sql/191 moved ONE
-- faucet (AI-corp trades) onto its own RPC. This file does the same for the
-- four biggest client-named faucets that a server can bound at all:
--
--   source          ledger reason (unchanged)          what the server checks
--   fuel_sales      'Fuel Command: sales'              amount = sold × pump, COMPUTED
--                                                      here; sold ≤ the demand curve's
--                                                      ceiling at that pump price; one
--                                                      sale per 25 s (the tick is 30 s)
--   refinery_sale   'Refinery: spot sale'              amount ≤ litres × the stream's
--                                                      top unit price (its own table
--                                                      below); litres ≤ 10 tanks
--   city_income     'City builder income'              NOTHING verifiable — per-call
--                                                      and per-day cap only (see below)
--   reconcile_gain  'reconcile_local_gain_on_fetch'    NOTHING verifiable — a small daily
--                                                      allowance, paid partially
--
-- ⚠ BE HONEST ABOUT WHAT IS BOUNDED. None of these sources has a server-side
--   row to read (unlike a gift, whose amount is an admin-inserted row, or a
--   resource-exchange sale, which rl_claim_sale_pay already pays from
--   resource_trade_ledger). The fuel in the tank, the refinery's stock and the
--   city's simulated income all live in the player's save. So:
--     * fuel_sales and refinery_sale are bounded PER CALL by the client's own
--       price maths, re-derived here from the constants in public/index.html and
--       public/src/refinery/data.js (the same stance as sql/191), and PER DAY by
--       an owner-set cap. A modified client can still sell fuel it never bought,
--       but never faster than one station tick, never above the demand curve, and
--       never past the cap.
--     * city_income and reconcile_gain are purely client-simulated. The server
--       cannot tell a real payout from an invented one, so the only thing this
--       file does for them is make the cap MUCH tighter than wallet_credit's and
--       log every call per source.
--
-- SHAPE (the sql/191 pattern, once, for all four):
--   * auth.uid() or nothing; a ref is REQUIRED (length 6..80);
--   * one advisory lock per (player, source), so the daily sum cannot race;
--   * faucet_settlements: APPEND-ONLY log, one row per call, paid or refused;
--     unique (user, source, ref) makes a retry return the first answer;
--   * the credit goes through public.wallet_credit ITSELF, so the 4.5M ceiling,
--     the holds queue, the wallet_ledger row and its ref dedupe all apply
--     unchanged. The ledger ref is 'fct:<source>:<client ref>', which is what
--     tells a settled credit apart from a raw client wallet_credit in telemetry
--     (a client's own refs are 'c_…').
--   * the GUC app.faucet_caller is set (transaction-local, the sql/069
--     app.city_force precedent) before that call, so the OPTIONAL phase-2 block
--     at the bottom can refuse these reasons when they arrive any other way.
--
-- 🔴 OWNER-SET CAPS (below, c_day_* in each function). They were chosen from the
--   30-day totals, not per-player-day maxima (a full wallet_ledger scan is not
--   something an agent runs on production). RUN THE CALIBRATION QUERY in the
--   report before applying, and raise a cap that would bind an honest player.
--   A refused fuel/refinery sale returns the goods on the client; a refused
--   city payout is simply not paid (the city sim cannot re-owe it).
--
-- ⚠ NOT CLOSED BY THIS FILE: wallet_credit stays executable by authenticated
--   (live v121v185 clients depend on it for every other reward). Until the
--   phase-2 block runs, a modified client can skip these doors and call
--   wallet_credit directly. What this file changes is that honest clients stop
--   using that path for these four reasons, so the day the owner turns phase 2
--   on, the remaining raw credits under these reasons are, by construction, not
--   from an honest build.
--
-- Re-runnable. Never applied by an agent — paste the WHOLE file into an empty
-- tab of the Supabase SQL editor for project ktsiasyjusesawtrwrjc. The verify
-- query at the end should show the table with RLS on, one select policy, the
-- core with NO authenticated grant, the four RPCs WITH it, and three bounds.
-- ============================================================================

-- ── the log (append-only) ────────────────────────────────────────────────
create table if not exists public.faucet_settlements (
  id            bigserial primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  source        text        not null,
  asked         bigint      not null check (asked >= 0),
  paid          bigint      not null default 0 check (paid >= 0),
  -- 'paid', or why not: call (over the per-call bound), rate (too soon after
  -- the last one), day (over the daily cap), wallet (wallet_credit refused).
  status        text        not null check (status in ('paid', 'call', 'rate', 'day', 'wallet')),
  ref           text        not null,
  meta          jsonb,
  balance_after bigint,
  created_at    timestamptz not null default now()
);
-- A retry of the same settlement finds its first answer here.
create unique index if not exists faucet_settlements_ref_uidx
  on public.faucet_settlements (user_id, source, ref);
-- The daily sum and the rate test read only paid rows of one (user, source).
create index if not exists faucet_settlements_paid_idx
  on public.faucet_settlements (user_id, source, created_at desc) where status = 'paid';

alter table public.faucet_settlements enable row level security;

-- Players read their OWN rows only. No insert / update / delete policy on
-- purpose: rows are written only by _faucet_settle (security definer), so the
-- log is append-only from the client's side.
drop policy if exists faucet_settlements_select on public.faucet_settlements;
create policy faucet_settlements_select on public.faucet_settlements
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.faucet_settlements from anon, authenticated;
grant select on public.faucet_settlements to authenticated;

-- ── the core (server code only — no grant) ───────────────────────────────
-- p_partial: pay what fits (reconcile — the rest is retried by the next fetch)
--            instead of refusing the whole call (a sale — the goods go back).
create or replace function public._faucet_settle(
  p_source text, p_asked bigint, p_ref text, p_reason text,
  p_call_max bigint, p_day_max bigint, p_gap_s integer, p_partial boolean, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_row  public.faucet_settlements%rowtype;
  v_day  bigint;
  v_room bigint;
  v_pay  bigint;
  v_bal  bigint;
  v_wref text;
  v_why  text := null;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_ref is null or length(p_ref) < 6 or length(p_ref) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'ref');
  end if;
  if p_asked is null or p_asked <= 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;

  -- One settlement at a time per player per source, so the sums below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':' || p_source, 0));

  -- A retry: the first answer, nothing new.
  select * into v_row from public.faucet_settlements
   where user_id = v_uid and source = p_source and ref = p_ref;
  if found then
    select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = v_uid;
    return jsonb_build_object('ok', v_row.status = 'paid', 'dup', true, 'paid', v_row.paid,
                              'reason', case when v_row.status = 'paid' then null else v_row.status end,
                              'balance', coalesce(v_bal, v_row.balance_after));
  end if;

  select coalesce(sum(paid), 0) into v_day from public.faucet_settlements
   where user_id = v_uid and source = p_source and status = 'paid'
     and created_at > now() - interval '24 hours';
  v_room := greatest(0, p_day_max - v_day);

  if p_partial then
    v_pay := least(p_asked, p_call_max, v_room);
    if v_pay <= 0 then v_why := 'day'; end if;
  else
    v_pay := p_asked;
    if p_asked > p_call_max then v_why := 'call';
    elsif p_gap_s > 0 and exists (
            select 1 from public.faucet_settlements
             where user_id = v_uid and source = p_source and status = 'paid'
               and created_at > now() - make_interval(secs => p_gap_s)) then v_why := 'rate';
    elsif p_asked > v_room then v_why := 'day';
    end if;
  end if;

  if v_why is null then
    v_wref := 'fct:' || p_source || ':' || p_ref;
    -- The marker the phase-2 guard reads. Transaction-local: gone at commit.
    perform set_config('app.faucet_caller', p_source, true);
    v_bal := public.wallet_credit(v_pay, p_reason, v_wref);
    perform set_config('app.faucet_caller', '', true);
    -- wallet_credit writes its ledger row (credit, or held past the daily
    -- ceiling) WITH the ref; a refusal (single/hourly cap) writes one WITHOUT.
    -- No ref row = not paid (the sql/191 test).
    if not exists (select 1 from public.wallet_ledger where user_id = v_uid and ref = v_wref) then
      v_why := 'wallet';
    end if;
  end if;

  if v_bal is null then select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = v_uid; end if;

  insert into public.faucet_settlements (user_id, source, asked, paid, status, ref, meta, balance_after)
  values (v_uid, p_source, p_asked, case when v_why is null then v_pay else 0 end,
          coalesce(v_why, 'paid'), p_ref, p_meta, v_bal);

  if v_why is not null then
    return jsonb_build_object('ok', false, 'reason', v_why, 'balance', v_bal,
                              'left_day', v_room, 'cap_day', p_day_max, 'max_call', p_call_max);
  end if;
  return jsonb_build_object('ok', true, 'paid', v_pay, 'balance', v_bal,
                            'left_day', greatest(0, v_room - v_pay), 'cap_day', p_day_max,
                            'wallet_seq', (select wallet_seq from public.user_progress where user_id = v_uid));
end $$;
revoke all on function public._faucet_settle(text, bigint, text, text, bigint, bigint, integer, boolean, jsonb)
  from public, anon, authenticated;

-- ── 1. Fuel Command: sales ───────────────────────────────────────────────
-- THE BOUND (public/index.html fcTick, v121v116):
--   dem  = 110 × (1.6 − pump/npc) × (0.5 + rep/120) × (supply<30 ? 1.6 : 1), clamp 0..260
--   sold = min(fuel, round(dem));   gross = sold × pump
--   rep ≤ 100 (clamped), npc ≤ FC_NPC_MAX = 320. So for a given pump price
--   sold ≤ min(260, ceil(234.667 × (1.6 − pump/320))), and a pump ≥ 512 sells
--   nothing. The server takes sold and pump, checks sold against that ceiling
--   and computes the amount ITSELF. Top of the curve: pump 257 × 188 bbl =
--   48,316 a tick (the live max was 28,783).
--   ⚠ If a later build changes the demand curve, FC_NPC_MAX or the tick, re-derive.
create or replace function public.faucet_fuel_sales(p_sold integer, p_pump integer, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ceil integer;
  -- 🔴 OWNER-SET. Calibrate against the query in the report before applying.
  c_day_fuel constant bigint := 3000000;
  c_gap_s    constant integer := 25;          -- fcTick runs every 30 s
begin
  if p_pump is null or p_pump < 1 or p_pump >= 512 then return jsonb_build_object('ok', false, 'reason', 'pump'); end if;
  if p_sold is null or p_sold < 1 or p_sold > 260 then return jsonb_build_object('ok', false, 'reason', 'sold'); end if;
  v_ceil := least(260, ceil(110 * 1.6 * (0.5 + 100 / 120.0) * (1.6 - p_pump / 320.0)))::integer;
  if p_sold > v_ceil then
    return jsonb_build_object('ok', false, 'reason', 'sold', 'max_sold', v_ceil);
  end if;
  return public._faucet_settle('fuel_sales', p_sold::bigint * p_pump, p_ref, 'Fuel Command: sales',
                               260::bigint * 511, c_day_fuel, c_gap_s, false,
                               jsonb_build_object('sold', p_sold, 'pump', p_pump));
end $$;
revoke all on function public.faucet_fuel_sales(integer, integer, text) from public, anon;
grant execute on function public.faucet_fuel_sales(integer, integer, text) to authenticated;

-- ── 2. Refinery: spot sale ───────────────────────────────────────────────
-- THE BOUND (public/src/refinery, v121v116):
--   blend.js sellSpot: gross = round(unit × litres), unit =
--     component: cost × SPOT_SELL_HAIRCUT (0.72) × marketIndex      (data.js COMPONENTS)
--     rack:      RACK[id] × marketIndex                              (data.js RACK)
--   marketIndex = priceIndex(...) which clamps to 0.62..1.95 (contracts.js).
--   litres ≤ the product tanks: storeTank max 10 × STORE_TANK_L 24,000 = 240,000.
--   So amount ≤ ceil(litres × top_unit(stream)), top_unit at index 1.95.
--   Any other stream id sells for 0 on the client ("Nobody buys that").
--   ⚠ If data.js changes a cost, the haircut, RACK or the index clamp, re-derive.
create or replace function public._refinery_top_unit(p_stream text)
returns numeric language sql immutable set search_path = public as $$
  select case p_stream
    -- components: cost × 0.72 × 1.95
    when 'naphtha'   then 2.10 * 0.72 * 1.95
    when 'reformate' then 4.50 * 0.72 * 1.95
    when 'alkylate'  then 6.30 * 0.72 * 1.95
    when 'catgas'    then 2.80 * 0.72 * 1.95
    when 'butane'    then 0.95 * 0.72 * 1.95
    when 'ethanol'   then 3.75 * 0.72 * 1.95
    when 'hydro'     then 3.10 * 0.72 * 1.95
    when 'slopcut'   then 0.55 * 0.72 * 1.95
    -- rack: RACK × 1.95
    when 'diesel'    then 3.05 * 1.95
    when 'kero'      then 3.40 * 1.95
    when 'gasoil'    then 1.15 * 1.95
    when 'heavy'     then 0.62 * 1.95
    when 'slop'      then 0.18 * 1.95
    else null end
$$;
revoke all on function public._refinery_top_unit(text) from public, anon, authenticated;

create or replace function public.faucet_refinery_sale(p_stream text, p_litres integer, p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_unit numeric := public._refinery_top_unit(p_stream);
  v_max  bigint;
  -- 🔴 OWNER-SET. Calibrate against the query in the report before applying.
  c_day_refinery constant bigint := 2000000;
begin
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'stream'); end if;
  if p_litres is null or p_litres < 1 or p_litres > 240000 then return jsonb_build_object('ok', false, 'reason', 'litres'); end if;
  v_max := ceil(p_litres * v_unit)::bigint;
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    return jsonb_build_object('ok', false, 'reason', 'price', 'max_pay', v_max);
  end if;
  return public._faucet_settle('refinery_sale', p_amount, p_ref, 'Refinery: spot sale',
                               v_max, c_day_refinery, 0, false,
                               jsonb_build_object('stream', p_stream, 'litres', p_litres));
end $$;
revoke all on function public.faucet_refinery_sale(text, integer, bigint, text) from public, anon;
grant execute on function public.faucet_refinery_sale(text, integer, bigint, text) to authenticated;

-- ── 3. City builder income ───────────────────────────────────────────────
-- ⚠ UNVERIFIABLE. The amount is the /src/economy simulation's audited payout
--   (ECONOMY.md: the closed-loop assert runs in the CLIENT). The server has no
--   copy of the city. So: a per-call cap just above the largest live row
--   (90,000) and a per-day cap, both far below wallet_credit's 2M / 4.5M.
create or replace function public.faucet_city_income(p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- 🔴 OWNER-SET. Calibrate against the query in the report before applying.
  c_call_city constant bigint := 120000;
  c_day_city  constant bigint := 1500000;
begin
  return public._faucet_settle('city_income', p_amount, p_ref, 'City builder income',
                               c_call_city, c_day_city, 0, false, null);
end $$;
revoke all on function public.faucet_city_income(bigint, text) from public, anon;
grant execute on function public.faucet_city_income(bigint, text) to authenticated;

-- ── 4. reconcile_local_gain_on_fetch ─────────────────────────────────────
-- ⚠ UNVERIFIABLE BY DEFINITION: it is "my local balance is higher than yours,
--   credit the difference" — a number the client asserts. Every honest source
--   of that gap is now covered by something the server can check (the credit
--   outbox replays a failed reward under its own ref; wallet_reconcile_self
--   lifts cinder to the server-written gems mirror), so what is left is small:
--   2.7M in 30 days across 28 players. PARTIAL: pay what fits in a small daily
--   allowance; the rest stays local and the next fetch asks again.
create or replace function public.faucet_reconcile_gain(p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- 🔴 OWNER-SET. The live max single row was 329,018 (once).
  c_call_rec constant bigint := 250000;
  c_day_rec  constant bigint := 250000;
begin
  return public._faucet_settle('reconcile_gain', p_amount, p_ref, 'reconcile_local_gain_on_fetch',
                               c_call_rec, c_day_rec, 0, true, null);
end $$;
revoke all on function public.faucet_reconcile_gain(bigint, text) from public, anon;
grant execute on function public.faucet_reconcile_gain(bigint, text) to authenticated;

-- ============================================================================
-- PHASE 2 — OPTIONAL, COMMENTED OUT. Do NOT run it with this file.
-- ============================================================================
-- 2a. Refuse the four reasons above (and sql/191's two) when they arrive
--     through a RAW client wallet_credit. A BEFORE INSERT trigger on
--     wallet_ledger raises for a credit/held row with one of these reasons
--     unless app.faucet_caller is set; the raise aborts wallet_credit's whole
--     transaction, so the balance update above the insert rolls back with it.
--     (wallet_credit's own handler catches only unique_violation and
--     undefined_table/column, so this exception propagates.)
--     A client cannot set app.faucet_caller: PostgREST exposes only `public`
--     functions, set_config lives in pg_catalog, and the setting is
--     transaction-local.
--
--   PRECONDITIONS — all of them, in order:
--     1. This file (196) applied and verified; 191 applied (it is).
--     2. The client build that routes these sources (fix/faucets) deployed, and
--        the three version knobs bumped so every tab reloads.
--     3. sql/191's ai_trade_settle re-created with the same
--        `perform set_config('app.faucet_caller', 'ai_trade', true);` line
--        before its wallet_credit call — OR drop 'Delivery paid%' and
--        'Node trade sold%' from the list below.
--     4. The telemetry query in the report shows, for 7 consecutive days, no
--        raw (ref not like 'fct:%' / 'aitrade:%') credits under these reasons
--        from anyone on the new build. Anything left is an old tab or a
--        modified client.
--     5. The client's credit outbox (Profile.walletOutbox) replays refused
--        credits for up to 7 days with the same reason; after 2a they will
--        error and expire. That is intended (they are exactly the raw path).
--
-- create or replace function public._wallet_ledger_faucet_guard()
-- returns trigger language plpgsql set search_path = public as $g$
-- begin
--   if new.op in ('credit', 'held') and new.resource = 'cinder'
--      and coalesce(current_setting('app.faucet_caller', true), '') = ''
--      and (   new.reason in ('Fuel Command: sales', 'Refinery: spot sale',
--                             'City builder income', 'reconcile_local_gain_on_fetch')
--           or new.reason like 'Delivery paid%' or new.reason like 'Node trade sold%')
--   then
--     raise exception 'faucet: % must be settled through its own RPC', new.reason
--       using errcode = '42501';
--   end if;
--   return new;
-- end $g$;
-- drop trigger if exists wallet_ledger_faucet_guard on public.wallet_ledger;
-- create trigger wallet_ledger_faucet_guard before insert on public.wallet_ledger
--   for each row execute function public._wallet_ledger_faucet_guard();
-- -- undo: drop trigger if exists wallet_ledger_faucet_guard on public.wallet_ledger;
--
-- 2b. Revoke wallet_credit from authenticated entirely. Every internal caller
--     (depot_claim, influence_resolve, merc_*, farm_lot_*, wallet_reconcile_self,
--     ai_trade_settle, _faucet_settle) is SECURITY DEFINER and keeps working.
--   PRECONDITIONS: every addGems/_serverMirrorCredit call site in the client
--     routed to a server door (the generic 'addGems', 'Received in …', season
--     pass, Fuel Command's other seven reasons, wages refunds, etc. — see the
--     phase-2 order in the report), the outbox drained or retired, and the
--     telemetry query showing no raw credits at all for 7 days.
-- revoke execute on function public.wallet_credit(bigint, text, text) from authenticated;
-- -- undo: grant execute on function public.wallet_credit(bigint, text, text) to authenticated;

-- ============================================================================
-- VERIFY — table + RLS, its policy, the functions and who may call them, and
-- three bounds (fuel at pump 256 → 188 bbl; refinery 1,000 L alkylate →
-- 8,846; kero 1,000 L → 6,630).
-- ============================================================================
select 'table' as what, c.relname::text as name, c.relrowsecurity::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'faucet_settlements'
union all
select 'policy', policyname::text, cmd::text from pg_policies
 where schemaname = 'public' and tablename = 'faucet_settlements'
union all
select 'function', p.proname::text,
       'authenticated may execute: ' || has_function_privilege('authenticated', p.oid, 'execute')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('_faucet_settle', '_refinery_top_unit', 'faucet_fuel_sales',
                     'faucet_refinery_sale', 'faucet_city_income', 'faucet_reconcile_gain')
union all
select 'bound', 'fuel max sold at pump 256',
       least(260, ceil(110 * 1.6 * (0.5 + 100 / 120.0) * (1.6 - 256 / 320.0)))::text
union all
select 'bound', 'refinery 1000 L alkylate', ceil(1000 * public._refinery_top_unit('alkylate'))::text
union all
select 'bound', 'refinery 1000 L kero', ceil(1000 * public._refinery_top_unit('kero'))::text;
