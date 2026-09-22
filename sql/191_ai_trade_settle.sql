-- 191_ai_trade_settle.sql — AI-corp trades settle on the SERVER, two per corp per UTC day.
--
-- WHY. The daily AI-trade allowance (AI_TRADE_DAILY = 2, owner decision,
-- bug-mu1i6hd6 / bug-mu7azbpf / bug-mu8vi4pp, commit c77a116f) lived only in
-- Profile.aiTrade, and the Cinder for a spot trade or a contract delivery
-- arrived through the generic wallet_credit RPC, whose only limit is the
-- global 4.5M/day ceiling (sql/093). A modified client could ignore the
-- allowance and name any pay it liked. This RPC is the one door a trade's
-- Cinder now comes through:
--   * auth.uid() or nothing;
--   * at most c_daily (2) settlements per user per corp per UTC day, counted
--     from an append-only log (ai_trade_settlements) under an advisory lock,
--     with a unique (user, corp, day, slot) index as the structural backstop;
--   * the pay is BOUNDED by a price the server derives itself (below);
--   * the credit goes through public.wallet_credit itself — the same body the
--     client's addGems mirror calls — so the daily ceiling, the holds queue,
--     the wallet_ledger row and the ref dedupe all apply unchanged. This file
--     adds no new write to user_progress.cinder of its own.
--   * idempotent on p_ref: a retry of the same settlement returns the first
--     answer and consumes nothing.
--
-- THE PRICE BOUND (derived from the client, public/index.html):
--   _aiOfferHash(corp, salt) = |Java-style 31-hash of 'offer:'+corp+':'+salt|
--   (int32 wrap). Deterministic, no secrets — the server recomputes it
--   exactly (_ai_offer_hash below; checked against the JS for all twelve
--   corps before this file was written).
--     spot     qty  = 6  + hash(corp, <UTC day index>) % 9     (6..14)
--              unit = 14 + hash(corp, 'u') % 9                  (14..22)
--     deliver  qty  = 10 + hash(corp, 'deal') % 11              (10..20)
--              unit = 19 + hash(corp, 'deal') % 8               (19..26)
--   pay = round(qty × unit × _aiPayMul), and _aiPayMul is the one factor the
--   server cannot see (it comes from the player's derived standing), but the
--   client CLAMPS it to 0.85..1.15. So the bound is
--              p_pay ≤ ceil(qty × unit × 1.15)
--   i.e. a modified client can gain at most the top of the standing band, and
--   never more than 598 Cinder (ninthvein / quiethand contract) per trade.
--   The spot qty takes the day index as salt, so the bound takes the largest
--   of yesterday / today / tomorrow to survive a midnight race and a client
--   clock that is a little off. A contract's terms are fixed at signing and
--   do not depend on the day.
--   ⚠ If a later build changes _aiSpotOffer / _aiContractTerms (players are on
--     v121v153, this file was written against v121v116), re-derive these
--     four lines. A build that pays LESS still passes; one that pays MORE is
--     refused with reason 'pay' and the client refunds the goods.
--   p_res and p_qty are recorded for audit but NOT trusted for the bound:
--   resources are client-side state the server cannot see.
--
-- ⚠ WHAT THIS DOES NOT CLOSE: wallet_credit itself is still granted to
--   authenticated, so a modified client can still call it directly with any
--   reason (bounded only by sql/093's daily ceiling). That is true of every
--   Cinder faucet in the game and is not an AI-trade hole; closing it means
--   moving each faucet onto its own RPC, as this file does for one of them.
--
-- Re-runnable. Never applied by an agent — paste into the Supabase SQL editor
-- for project ktsiasyjusesawtrwrjc. The verify query at the end should show
-- the table with RLS on, one select policy, and both functions.

-- ── the log (append-only) ────────────────────────────────────────────────
create table if not exists public.ai_trade_settlements (
  id            bigserial primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  corp_id       text        not null,
  kind          text        not null check (kind in ('spot', 'deliver')),
  res           text,
  qty           integer     not null check (qty > 0),
  pay           bigint      not null check (pay > 0),
  utc_day       integer     not null,          -- floor(epoch / 86400) = the client's _aiDayIndex()
  slot          smallint    not null check (slot >= 1),
  ref           text,
  balance_after bigint,
  created_at    timestamptz not null default now()
);
-- The backstop: even two racing calls cannot both take slot N for a day.
create unique index if not exists ai_trade_settlements_slot_uidx
  on public.ai_trade_settlements (user_id, corp_id, utc_day, slot);
create unique index if not exists ai_trade_settlements_ref_uidx
  on public.ai_trade_settlements (user_id, ref) where ref is not null;

alter table public.ai_trade_settlements enable row level security;

-- Players read their OWN rows only. No insert / update / delete policy on
-- purpose: rows are written only by ai_trade_settle (security definer), so
-- the log is append-only from the client's side.
drop policy if exists ai_trade_settlements_select on public.ai_trade_settlements;
create policy ai_trade_settlements_select on public.ai_trade_settlements
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.ai_trade_settlements from anon, authenticated;
grant select on public.ai_trade_settlements to authenticated;

-- ── the client's offer hash, exactly ─────────────────────────────────────
-- JS: h = (h * 31 + charCode) | 0 over 'offer:'+corp+':'+salt; Math.abs(h).
-- Kept unsigned mod 2^32 while looping (same residue), signed once at the end.
create or replace function public._ai_offer_hash(p_corp text, p_salt text)
returns bigint language plpgsql immutable set search_path = public as $$
declare s text := 'offer:' || p_corp || ':' || p_salt; h bigint := 0; i int;
begin
  for i in 1..length(s) loop
    h := (h * 31 + ascii(substr(s, i, 1))) & 4294967295;
  end loop;
  if h >= 2147483648 then h := h - 4294967296; end if;
  return abs(h);
end $$;
revoke all on function public._ai_offer_hash(text, text) from public, anon, authenticated;

-- ── the settlement ───────────────────────────────────────────────────────
create or replace function public.ai_trade_settle(
  p_corp text, p_kind text, p_res text, p_qty integer, p_pay integer, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_day   integer := floor(extract(epoch from now()) / 86400)::integer;
  v_used  integer;
  v_cap   bigint := 0;
  v_qty   bigint;
  v_unit  bigint;
  v_d     integer;
  v_bal   bigint;
  v_wref  text;
  v_row   public.ai_trade_settlements%rowtype;
  -- 🔴 OWNER-SET (2026-09-22). Must match AI_TRADE_DAILY in public/index.html.
  c_daily constant integer := 2;
  c_corps constant text[] := array['vance','ashfall','greenbelt','meridian','ninthvein','foundation',
                                   'kindling','wickline','rootwater','palegrove','quiethand','ledgerroom'];
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_corp is null or not (p_corp = any (c_corps)) then return jsonb_build_object('ok', false, 'reason', 'corp'); end if;
  if p_kind is null or p_kind not in ('spot', 'deliver') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000 then return jsonb_build_object('ok', false, 'reason', 'qty'); end if;
  if p_pay is null or p_pay <= 0 then return jsonb_build_object('ok', false, 'reason', 'pay'); end if;
  if p_ref is not null and length(p_ref) > 80 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;

  -- One settlement at a time per player per corp, so the count below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('ai_trade_settle:' || v_uid::text || ':' || p_corp, 0));

  -- A retry of a settlement that already landed: the same answer, nothing new.
  if p_ref is not null then
    select * into v_row from public.ai_trade_settlements where user_id = v_uid and ref = p_ref;
    if found then
      select count(*) into v_used from public.ai_trade_settlements
       where user_id = v_uid and corp_id = p_corp and utc_day = v_day;
      select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = v_uid;
      return jsonb_build_object('ok', true, 'dup', true, 'balance', coalesce(v_bal, v_row.balance_after),
                                'pay', v_row.pay, 'left', greatest(0, c_daily - v_used), 'cap', c_daily);
    end if;
  end if;

  select count(*) into v_used from public.ai_trade_settlements
   where user_id = v_uid and corp_id = p_corp and utc_day = v_day;
  if v_used >= c_daily then
    return jsonb_build_object('ok', false, 'reason', 'limit', 'left', 0, 'cap', c_daily,
                              'resets_in_s', ((v_day + 1)::bigint * 86400 - floor(extract(epoch from now()))::bigint));
  end if;

  -- The price bound (see header). ceil(qty × unit × 1.15), computed in numeric.
  if p_kind = 'spot' then
    v_unit := 14 + public._ai_offer_hash(p_corp, 'u') % 9;
    for v_d in (v_day - 1)..(v_day + 1) loop
      v_qty := 6 + public._ai_offer_hash(p_corp, v_d::text) % 9;
      v_cap := greatest(v_cap, ceil(v_qty * v_unit * 1.15::numeric)::bigint);
    end loop;
  else
    v_qty  := 10 + public._ai_offer_hash(p_corp, 'deal') % 11;
    v_unit := 19 + public._ai_offer_hash(p_corp, 'deal') % 8;
    v_cap  := ceil(v_qty * v_unit * 1.15::numeric)::bigint;
  end if;
  if p_pay > v_cap then
    return jsonb_build_object('ok', false, 'reason', 'pay', 'max_pay', v_cap,
                              'left', greatest(0, c_daily - v_used), 'cap', c_daily);
  end if;

  -- Credit through wallet_credit itself: same ceiling, holds, ledger row and
  -- ref dedupe as every other Cinder faucet. auth.uid() is the same caller
  -- inside it. The ledger ref ties the wallet row to this settlement.
  v_wref := 'aitrade:' || v_uid::text || ':' || coalesce(p_ref, p_corp || ':' || v_day || ':' || (v_used + 1));
  v_bal := public.wallet_credit(p_pay::bigint,
             case when p_kind = 'spot' then 'Node trade sold' else 'Delivery paid' end || ' (' || p_corp || ')',
             v_wref);
  -- wallet_credit writes its ledger row (credit, or held past the daily
  -- ceiling) WITH the ref; a refusal (single/hourly cap) writes one WITHOUT.
  -- No ref row = not paid, so the trade is not logged and does not count.
  if not exists (select 1 from public.wallet_ledger where user_id = v_uid and ref = v_wref) then
    return jsonb_build_object('ok', false, 'reason', 'wallet', 'balance', v_bal,
                              'left', greatest(0, c_daily - v_used), 'cap', c_daily);
  end if;

  insert into public.ai_trade_settlements (user_id, corp_id, kind, res, qty, pay, utc_day, slot, ref, balance_after)
  values (v_uid, p_corp, p_kind, left(p_res, 64), p_qty, p_pay, v_day, v_used + 1, p_ref, v_bal);

  return jsonb_build_object('ok', true, 'balance', v_bal, 'pay', p_pay,
                            'left', greatest(0, c_daily - (v_used + 1)), 'cap', c_daily,
                            'wallet_seq', (select wallet_seq from public.user_progress where user_id = v_uid));
end $$;

revoke all on function public.ai_trade_settle(text, text, text, integer, integer, text) from public, anon;
grant execute on function public.ai_trade_settle(text, text, text, integer, integer, text) to authenticated;

-- verify: table + RLS, its policies, both functions, and the bound for one corp
-- (ninthvein contract must read 598 — the same figure the client computes at 1.15x).
select 'table'  as what, c.relname::text as name, c.relrowsecurity::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'ai_trade_settlements'
union all
select 'policy', policyname::text, cmd::text from pg_policies
 where schemaname = 'public' and tablename = 'ai_trade_settlements'
union all
select 'function', p.proname::text, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('ai_trade_settle', '_ai_offer_hash')
union all
select 'bound', 'ninthvein deliver',
       ceil((10 + public._ai_offer_hash('ninthvein', 'deal') % 11)
          * (19 + public._ai_offer_hash('ninthvein', 'deal') % 8) * 1.15::numeric)::text;
