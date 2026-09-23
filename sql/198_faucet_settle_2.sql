-- ============================================================================
-- 198 — PER-SOURCE CINDER FAUCETS, PHASE 2: the mayor ledger, keyed refunds,
--       Fuel Command's other payouts, and Season Pass tiers.
--
-- Builds on sql/196 (faucet_settlements + _faucet_settle, APPLIED 2026-09-23)
-- and does not replace any of it. Every new door that PAYS goes through
-- _faucet_settle, so the log, the (user, source, ref) idempotency, the per-
-- (user, source) advisory lock, the rolling-24h cap and the credit through
-- wallet_credit itself (holds, 4.5M ceiling, ledger ref 'fct:<source>:<ref>')
-- are the phase-1 ones, unchanged.
--
--   §1 city_owner_ledger_apply  — re-created with the SAME signature. An
--      appointed mayor could pass an unbounded positive p_cinder_delta that was
--      written straight into the owner's gems/cinder, with no wallet_ledger row,
--      plus a mayor cut (sql/121) paid to the caller out of it. Now the POSITIVE
--      part is clamped per call and per rolling 24 h per (mayor, node) — the
--      faucet_city_income ceilings, because this is the same city income, paid
--      to an owner instead of to oneself — and every Cinder move writes a
--      wallet_ledger row for the owner. CLAMPED, NOT REFUSED: the live client
--      (v121v185 _cityMgrSend) re-queues a refused delta and re-sends it every
--      6 s forever, and a refusal also sinks the spend bundled in the same
--      delta. A clamp answers ok:true, the client adopts the server's balance
--      and the excess is simply not paid. The reply says how much ('capped').
--   §2 wallet_charge_ref / wallet_refund — a Cinder refund keyed to the exact
--      charge it undoes, once (the sov_refund pattern, sql/024-era, for Aza).
--   §3 Fuel Command — NPC sale, hedge, insurance payout: faucet doors with a
--      per-call bound derived from the client's constants + a daily cap.
--      Positions and loans: the OPEN is recorded server-side (the stake is
--      charged here, the loan is a debt row), so the close / draw is bounded by
--      something the server holds.
--   §4 Season Pass — each (season, track, tier) pays once per player, the amount
--      comes from season_pass_tiers (seeded from index.html SEASON_*_REWARDS;
--      _faucets2_smoke.mjs fails if the two drift).
--
-- ⚠ BE HONEST ABOUT WHAT IS BOUNDED (the 196 stance):
--   * mayor ledger: bounded, not verified — the city sim runs in the client.
--   * refunds: bounded by a charge the server recorded; the server cannot tell
--     whether the goods were delivered, so a modified client can undo its own
--     keyed spend within 30 min. It can never refund more than it paid, twice,
--     or a charge it did not make.
--   * NPC sale, hedge: per-call price ceilings + day caps; the fuel and the hedge
--     live in the save.
--   * insurance: fixed 4,000, needs an insurance premium on the ledger, 60 s
--     apart, 10 a day.
--   * positions: payout ≤ 5 × a stake the server CHARGED, profit ≤ 1M / 24 h.
--   * loans: one open loan, principal ≤ 100,000, repayments recorded.
--   * season pass: amounts are exact; once per tier; season monotonic and
--     bounded by account age; premium needs a premium-unlock charge per season.
--
-- ⚠ STILL NOT CLOSED BY THIS FILE: wallet_credit stays executable by
--   authenticated (live v121v185 depends on it). A modified client can still
--   skip every door here. See the phase-2 guard notes in sql/196 and the report.
--
-- Re-runnable. Never applied by an agent — paste the WHOLE file into an empty
-- tab of the Supabase SQL editor for project ktsiasyjusesawtrwrjc. The verify
-- query at the end lists every table (RLS on), policy, function + grant, the
-- seeded tier totals and three bounds; expected values are written beside it.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- §1  city_owner_ledger_apply — bounded, and on the ledger.
-- ════════════════════════════════════════════════════════════════════════════
-- THE BOUND. faucet_city_income (sql/196) pays a player's OWN city 120,000 a
-- call and 1,500,000 a rolling day; a mayor-run city is the same simulation
-- paying the owner, so the same ceilings apply per (mayor, node). Measured
-- 2026-09-23 (read-only, mayor_earnings ÷ player_pct, 30 days): the largest
-- honest delta was 20,000 and the largest (mayor, node) day 20,160, so neither
-- cap binds an honest city by two orders of magnitude.
-- The log is faucet_settlements, source 'mayor_city', user_id = the MAYOR (the
-- caller), meta.node / meta.owner — one row per positive delta, status 'paid'
-- (asked may exceed paid: that is the clamp) or 'day' when nothing fit.
-- The owner's wallet_ledger row carries ref 'mc:<uuid>' so telemetry can tell
-- it from a raw client credit, op 'credit' (counts toward the owner's sql/093
-- ceiling, like any other income) or 'charge' for a spend.
-- UNCHANGED from the live body (read with pg_get_functiondef 2026-09-23): the
-- authorisation (_node_mayor_terms), the absolute write of gems + cinder, the
-- salvage loop, the refusal shapes, the sql/121 split and its corp branch.
-- ⚠ NOT BOUNDED HERE: p_salvage_delta. A positive salvage delta still adds any
--   quantity of any key to the owner's stash. See the report.
create or replace function public.city_owner_ledger_apply(
  p_node_id text, p_cinder_delta numeric default 0, p_salvage_delta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner       uuid;
  v_mayor       uuid := auth.uid();
  v_pct         numeric := 0;
  v_delta       numeric;
  v_cut         numeric := 0;
  v_owner_delta numeric;
  v_salvage     jsonb;
  v_cinder      numeric;
  k             text;
  v_have        numeric;
  v_next        numeric;
  v_emp_corp    uuid;
  v_mgr_pct     numeric;
  v_mgr_share   numeric := 0;
  v_corp_share  numeric := 0;
  -- 198: the bound
  v_asked       bigint := 0;
  v_day         bigint := 0;
  v_room        bigint := 0;
  v_why         text := null;
  v_ref         text := 'mc:' || gen_random_uuid()::text;
  -- 🔴 OWNER-SET. Same numbers as faucet_city_income (sql/196); change both together.
  c_call_mc constant bigint := 120000;
  c_day_mc  constant bigint := 1500000;
begin
  if v_mayor is null then raise exception 'not signed in'; end if;

  select t.owner_id, t.player_pct into v_owner, v_pct
    from public._node_mayor_terms(p_node_id) t;
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  v_delta := coalesce(p_cinder_delta, 0);
  if v_delta = 'NaN'::numeric then v_delta := 0; end if;

  -- 198: clamp the CREDIT half. A spend (negative) is bounded by the owner's
  -- balance below, exactly as before.
  if v_delta > 0 then
    v_asked := least(v_delta, 9000000000000000)::bigint;   -- a loggable number even for 'Infinity'
    perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_mayor::text || ':mayor_city:' || coalesce(p_node_id, ''), 0));
    select coalesce(sum(s.paid), 0) into v_day
      from public.faucet_settlements s
     where s.user_id = v_mayor and s.source = 'mayor_city' and s.status = 'paid'
       and s.created_at > now() - interval '24 hours'
       and s.meta->>'node' = p_node_id;
    v_room  := greatest(0, c_day_mc - v_day);
    v_delta := floor(least(v_delta, c_call_mc, v_room));
    if v_delta < v_asked then
      v_why := case when v_room <= least(v_asked, c_call_mc) then 'day' else 'call' end;
    end if;
  end if;

  if v_delta > 0 and coalesce(v_pct, 0) > 0 then
    v_cut := floor(v_delta * v_pct / 100.0);
  end if;
  v_owner_delta := v_delta - v_cut;

  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner for update;

  if v_salvage is null then raise exception 'owner has no profile'; end if;

  v_cinder := v_cinder + v_owner_delta;
  if v_cinder < 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cinder',
                              'cinder', coalesce((select gems from user_profiles where user_id = v_owner), 0));
  end if;

  for k in select jsonb_object_keys(coalesce(p_salvage_delta, '{}'::jsonb))
  loop
    v_have := coalesce((v_salvage->>k)::numeric, 0);
    v_next := v_have + coalesce((p_salvage_delta->>k)::numeric, 0);
    if v_next < 0 then
      return jsonb_build_object('ok', false, 'error', 'insufficient_resource',
                                'resource', k, 'have', v_have);
    end if;
    v_salvage := jsonb_set(v_salvage, array[k], to_jsonb(v_next), true);
  end loop;

  update public.user_profiles p
     set forge = jsonb_set(coalesce(p.forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where p.user_id = v_owner;

  begin
    update public.user_progress g set cinder = greatest(0, v_cinder) where g.user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  -- 198: the owner's Cinder move is on the ledger now (it never was).
  if v_owner_delta <> 0 then
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref, meta)
    values (v_owner, case when v_owner_delta > 0 then 'credit' else 'charge' end, 'cinder',
            v_owner_delta::bigint, greatest(0, v_cinder)::bigint,
            case when v_owner_delta > 0 then 'City income (mayor-run node ' else 'City spend (mayor-run node ' end
              || coalesce(p_node_id, '?') || ')',
            v_ref,
            jsonb_build_object('mayor', v_mayor, 'node', p_node_id, 'asked', v_asked,
                               'capped', greatest(0, v_asked - greatest(v_delta, 0))::bigint, 'contract_cut', v_cut));
  end if;
  if v_asked > 0 then
    insert into public.faucet_settlements (user_id, source, asked, paid, status, ref, meta, balance_after)
    values (v_mayor, 'mayor_city', v_asked, greatest(v_delta, 0)::bigint,
            case when v_delta > 0 then 'paid' else coalesce(v_why, 'day') end, v_ref,
            jsonb_build_object('node', p_node_id, 'owner', v_owner, 'why', v_why), greatest(0, v_cinder)::bigint);
  end if;

  v_mgr_share := v_cut;
  if v_cut > 0 then
    select e.corp_id, e.manager_pct into v_emp_corp, v_mgr_pct
      from public.corp_node_managers e
     where e.manager_id = v_mayor and e.status = 'active'
     limit 1
       for share;

    if v_emp_corp is not null then
      v_mgr_share  := floor(v_cut * v_mgr_pct / 100.0);
      v_corp_share := v_cut - v_mgr_share;
    end if;

    if v_mgr_share > 0 then
      begin
        if v_emp_corp is null then
          perform public._ct_cinder_give(v_mayor, v_mgr_share::bigint,
            'Mayor revenue share (' || round(v_pct)::text || '%) — city on node ' || coalesce(p_node_id, '?'));
        else
          perform public._ct_cinder_give(v_mayor, v_mgr_share::bigint,
            'Node Manager commission (' || round(v_mgr_pct)::text || '% of a '
            || round(v_pct)::text || '% share) — city on node ' || coalesce(p_node_id, '?'));
        end if;
      exception when undefined_function then null;
      end;
      begin
        insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct)
        values (p_node_id, v_mayor, v_owner, v_mgr_share::bigint, v_pct);
      exception when others then null;
      end;
    end if;

    if v_corp_share > 0 then
      insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
      values (v_emp_corp, v_mayor, v_corp_share, 'node_manager_fee',
              'Node Manager fee (' || round(100 - v_mgr_pct)::text || '% of a '
              || round(v_pct)::text || '% share) — city on node ' || coalesce(p_node_id, '?'));
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cinder', v_cinder,
    'salvage', v_salvage,
    'mayor_pct', v_pct,
    'mayor_cut', v_mgr_share,
    'contract_cut', v_cut,
    'corp_id', v_emp_corp,
    'manager_pct', v_mgr_pct,
    'corp_share', v_corp_share,
    'owner_delta', v_owner_delta,
    -- 198: what the clamp did. capped > 0 → that much of the delta was NOT paid.
    'asked', v_asked,
    'capped', greatest(0, v_asked - greatest(v_delta, 0))::bigint,
    'cap_reason', v_why,
    'left_day', case when v_asked > 0 then greatest(0, v_room - greatest(v_delta, 0))::bigint else null end);
end $$;
revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- §2  Keyed Cinder refunds: wallet_charge_ref + wallet_refund.
-- ════════════════════════════════════════════════════════════════════════════
-- WHY. ~20 client sites spend Cinder, try something async, and on failure call
-- addGems(n) — which asks wallet_credit for n under the generic 'addGems'
-- reason. Two faults: (1) wallet_credit cannot tell a refund from a mint, and
-- (2) when the spend and the refund land in the SAME tick of the client's
-- spend watcher (a synchronous `spendGems(x); if (!spendResources(r))
-- addGems(x)`), the watcher sees a net change of 0 and bills nothing, while
-- addGems still credits x: the server gains x per failed click.
-- A keyed refund fixes both: the spend is charged HERE under a ref, and the
-- refund pays back at most that exact ledger row, once.
--
-- REF NAMESPACES on wallet_ledger (its unique (user_id, ref) index is the
-- once-only guarantee; the prefixes are added server-side so a client can
-- never collide with a faucet's 'fct:' ref or with another door's charge):
--   'chg:<ref>'   a wallet_charge_ref charge       — refundable by wallet_refund
--   'rfd:<ref>'   its refund                       — at most one
--   'void:<ref>'  refund arrived before the charge — the charge is then refused
--   'fcpos:<ref>' a Fuel Command position stake    — NOT refundable (§3)
--   'fcloan:<ref>' a Fuel Command loan repayment   — NOT refundable (§3)
-- ⚠ The void marker closes the one race a keyed refund has: the client refunds
--   when a charge's reply was LOST (outcome unknown). If the charge did land,
--   the refund finds it; if it had not landed yet, the refund writes the void
--   and the late charge is refused — so the pair nets to zero in every order.

-- The charge itself: the LIVE wallet_charge body (pg_get_functiondef,
-- 2026-09-23) plus a ledger ref and a dup answer. Server code only — no grant.
create or replace function public._wallet_charge_core(p_uid uuid, p_amount bigint, p_reason text, p_ledger_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bal  bigint;
  v_seq  bigint;
  v_tax  bigint;
  v_rate numeric := 0.02;   -- the historical wallet_charge rate; see wallet_charge's own note
  v_lid  uuid;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  if p_ledger_ref is null then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;

  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  -- The player's wallet lock first (wallet_credit's lock order), then the dup test.
  perform 1 from public.user_progress g where g.user_id = p_uid for update;
  select l.id into v_lid from public.wallet_ledger l where l.user_id = p_uid and l.ref = p_ledger_ref;
  if found then
    select g.cinder, coalesce(g.wallet_seq, 0) into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
    return jsonb_build_object('ok', true, 'dup', true, 'balance', coalesce(v_bal, 0), 'wallet_seq', v_seq, 'ledger_id', v_lid);
  end if;

  update public.user_progress g
     set cinder     = g.cinder - p_amount,
         wallet_seq = coalesce(g.wallet_seq, 0) + 1,
         updated_at = now()
   where g.user_id = p_uid and g.cinder >= p_amount
   returning g.cinder, g.wallet_seq into v_bal, v_seq;
  if v_bal is null then
    select g.cinder into v_bal from public.user_progress g where g.user_id = p_uid;
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'balance', coalesce(v_bal, 0));
  end if;

  -- The profile mirror follows on the way DOWN (wallet_charge's note: leave it
  -- high and the reconcile puts the spend back).
  update public.user_profiles p set gems = v_bal where p.user_id = p_uid and coalesce(p.gems, 0) > v_bal;

  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
  values (p_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason, p_ledger_ref)
  returning id into v_lid;

  v_tax := floor(p_amount * v_rate);
  if v_tax > 0 then
    update public.user_progress g set ft_tax_total = coalesce(g.ft_tax_total, 0) + v_tax where g.user_id = p_uid;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (p_uid, 'tax', 'cinder', 0, v_bal, 'Foundation Tax (2%)',
              jsonb_build_object('tax_amount', v_tax, 'parent_reason', p_reason));
    exception when undefined_table or undefined_column then null;
    end;
    begin
      insert into public.reserve_tax_log (seller_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
      values (p_uid, p_reason, 0, p_amount, v_rate, v_tax, 'spend');
    exception when undefined_table then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'balance', v_bal, 'tax', coalesce(v_tax, 0), 'wallet_seq', v_seq, 'ledger_id', v_lid);
end $$;
revoke all on function public._wallet_charge_core(uuid, bigint, text, text) from public, anon, authenticated;

-- A refundable spend. Same effect as wallet_charge, plus the ref.
create or replace function public.wallet_charge_ref(p_amount bigint, p_reason text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_ref is null or length(p_ref) < 6 or length(p_ref) > 80 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  perform 1 from public.user_progress g where g.user_id = v_uid for update;
  -- Its refund already came (reply lost, client gave up on it): never charge it now.
  if exists (select 1 from public.wallet_ledger l where l.user_id = v_uid and l.ref = 'void:' || p_ref) then
    select g.cinder into v_bal from public.user_progress g where g.user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'void', 'balance', coalesce(v_bal, 0));
  end if;
  return public._wallet_charge_core(v_uid, p_amount, coalesce(nullif(trim(p_reason), ''), 'Cinder spending'), 'chg:' || p_ref);
end $$;
revoke all on function public.wallet_charge_ref(bigint, text, text) from public, anon;
grant execute on function public.wallet_charge_ref(bigint, text, text) to authenticated;

-- The refund: at most the amount of THAT charge row, once, within 30 minutes
-- (sov_refund allows 10; a failed Cinder spend is usually known in seconds, but
-- the client's retry queue survives a reload). Credited directly with op
-- 'refund' — NOT through wallet_credit: undoing a spend is not income, so it
-- must not eat the player's sql/093 daily ceiling or be held behind it.
create or replace function public.wallet_refund(p_charge_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_amt    bigint;
  v_when   timestamptz;
  v_reason text;
  v_cid    uuid;
  v_bal    bigint;
  c_window constant interval := interval '30 minutes';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_charge_ref is null or length(p_charge_ref) < 6 or length(p_charge_ref) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'ref');
  end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  perform 1 from public.user_progress g where g.user_id = v_uid for update;

  if exists (select 1 from public.wallet_ledger l where l.user_id = v_uid and l.ref in ('rfd:' || p_charge_ref, 'void:' || p_charge_ref)) then
    select g.cinder into v_bal from public.user_progress g where g.user_id = v_uid;
    return jsonb_build_object('ok', true, 'already', true, 'refunded', 0, 'balance', coalesce(v_bal, 0));
  end if;

  select l.id, -l.delta, l.created_at, l.reason into v_cid, v_amt, v_when, v_reason
    from public.wallet_ledger l
   where l.user_id = v_uid and l.ref = 'chg:' || p_charge_ref
     and l.op = 'charge' and l.resource = 'cinder' and l.delta < 0;

  if v_cid is null then
    -- The charge has not landed (or never will). Void the ref so it cannot land later.
    select g.cinder into v_bal from public.user_progress g where g.user_id = v_uid;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
    values (v_uid, 'void', 'cinder', 0, coalesce(v_bal, 0), 'Refund before its charge — charge voided', 'void:' || p_charge_ref);
    return jsonb_build_object('ok', true, 'voided', true, 'refunded', 0, 'balance', coalesce(v_bal, 0));
  end if;
  if v_when < now() - c_window then
    return jsonb_build_object('ok', false, 'reason', 'too_old');
  end if;

  update public.user_progress g set cinder = coalesce(g.cinder, 0) + v_amt, updated_at = now()
   where g.user_id = v_uid returning g.cinder into v_bal;
  update public.user_profiles p set gems = v_bal where p.user_id = v_uid and coalesce(p.gems, 0) < v_bal;
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref, meta)
  values (v_uid, 'refund', 'cinder', v_amt, v_bal, left('Refund: ' || coalesce(v_reason, 'Cinder spending'), 200),
          'rfd:' || p_charge_ref, jsonb_build_object('charge_id', v_cid));
  return jsonb_build_object('ok', true, 'refunded', v_amt, 'balance', v_bal);
end $$;
revoke all on function public.wallet_refund(text) from public, anon;
grant execute on function public.wallet_refund(text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- §3  Fuel Command — the payouts sql/196 left on wallet_credit.
-- ════════════════════════════════════════════════════════════════════════════
-- Client constants these are derived from (public/index.html, v121v116) —
-- _faucets2_smoke.mjs re-reads them and fails if one moves:
--   FC_NPC_MAX 320, FC_NPC_MIN 22, FC_NPC_SPREAD 0.05  → bid ≤ 304 ¢/bbl
--   fuelCap = 1000 + tank × 250, tank max 6            → ≤ 2,500 bbl (default 1,500)
--   insurance payout 4,000 on bandit / scp / boom; the premium is 600
-- Live 60-day maxima (read-only, 2026-09-23): NPC sale 250,563 a row and ONE
-- player-day of 9,689,522 (50 sales); position closed 500,000 (= its stake);
-- insurance 5 a player-day; loan 100,000.

-- 3a. NPC sale: amount ≤ qty × 304; qty ≤ 2,500.
create or replace function public.faucet_fc_npc_sale(p_qty integer, p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max bigint;
  -- 🔴 OWNER-SET. 3M binds exactly one player-day seen in 60 days (9.69M,
  --    50 dumps). Look at that account before raising it.
  c_day_npc constant bigint := 3000000;
begin
  if p_qty is null or p_qty < 1 or p_qty > 2500 then return jsonb_build_object('ok', false, 'reason', 'qty'); end if;
  v_max := p_qty::bigint * 304;
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    return jsonb_build_object('ok', false, 'reason', 'price', 'max_pay', v_max);
  end if;
  return public._faucet_settle('fc_npc_sale', p_amount, p_ref, 'Fuel Command: NPC sale',
                               v_max, c_day_npc, 0, false, jsonb_build_object('qty', p_qty));
end $$;
revoke all on function public.faucet_fc_npc_sale(integer, bigint, text) from public, anon;
grant execute on function public.faucet_fc_npc_sale(integer, bigint, text) to authenticated;

-- 3b. Hedge settled: gain = (mark − strike) × qty with mark ≤ 320, strike ≥ 22,
--     so ≤ 298 ¢/bbl; qty ≤ fuelCap ≤ 2,500. The lock is free and client-side,
--     so this is a ceiling, not a check: one settlement per 10 min, 250k a day.
create or replace function public.faucet_fc_hedge(p_qty integer, p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max bigint;
  -- 🔴 OWNER-SET. No hedge payout at all in the last 60 days.
  c_day_hedge constant bigint := 250000;
  c_gap_hedge constant integer := 600;
begin
  if p_qty is null or p_qty < 1 or p_qty > 2500 then return jsonb_build_object('ok', false, 'reason', 'qty'); end if;
  v_max := p_qty::bigint * 298;
  if p_amount is null or p_amount < 1 or p_amount > v_max then
    return jsonb_build_object('ok', false, 'reason', 'price', 'max_pay', v_max);
  end if;
  return public._faucet_settle('fc_hedge', p_amount, p_ref, 'Fuel Command: hedge settled',
                               v_max, c_day_hedge, c_gap_hedge, false, jsonb_build_object('qty', p_qty));
end $$;
revoke all on function public.faucet_fc_hedge(integer, bigint, text) from public, anon;
grant execute on function public.faucet_fc_hedge(integer, bigint, text) to authenticated;

-- 3c. Insurance payout: the amount is FIXED here (4,000), and the player must
--     have paid a premium ('Fuel Command: Insurance' charge) at some point.
create or replace function public.faucet_fc_insurance(p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- 🔴 OWNER-SET. Honest max seen: 5 payouts in a player-day.
  c_day_ins constant bigint := 40000;
  c_gap_ins constant integer := 60;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.wallet_ledger l
                  where l.user_id = auth.uid() and l.op = 'charge' and l.resource = 'cinder'
                    and l.reason = 'Fuel Command: Insurance') then
    return jsonb_build_object('ok', false, 'reason', 'uninsured');
  end if;
  return public._faucet_settle('fc_insurance', 4000, p_ref, 'Fuel Command: insurance payout',
                               4000, c_day_ins, c_gap_ins, false, null);
end $$;
revoke all on function public.faucet_fc_insurance(text) from public, anon;
grant execute on function public.faucet_fc_insurance(text) to authenticated;

-- 3d. Positions. The OPEN is a server row and its stake is charged HERE, so a
--     close is bounded by a stake the server actually took.
--     Close bound (client fcClosePos): pl = stake × (1 + dir × move × 4), and a
--     SHORT's move ≥ (22 − entry)/entry > −1 → ≤ 5× stake. A LONG's profitable
--     move is capped by the exogenous shock ledger (_fcSettleMark); a rolled
--     'spike' is +50%, i.e. 3×. So payout ≤ 5 × stake (CLAMPED, the position
--     closes), and net profit across closes ≤ 1M per rolling 24 h.
create table if not exists public.fc_positions (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  ref        text        not null,                 -- the client's position ref
  side       text        not null check (side in ('long', 'short')),
  stake      bigint      not null check (stake > 0),
  status     text        not null default 'open' check (status in ('open', 'closed')),
  payout     bigint,
  close_ref  text,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);
create unique index if not exists fc_positions_ref_uidx on public.fc_positions (user_id, ref);
-- One open position per player — the client holds exactly one (s.pos).
create unique index if not exists fc_positions_open_uidx on public.fc_positions (user_id) where status = 'open';
alter table public.fc_positions enable row level security;
-- Players read their own; rows are written only by the definer functions below.
drop policy if exists fc_positions_select on public.fc_positions;
create policy fc_positions_select on public.fc_positions
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.fc_positions from anon, authenticated;
grant select on public.fc_positions to authenticated;

create or replace function public.fc_position_open(p_side text, p_stake bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pos public.fc_positions%rowtype;
  v_chg jsonb;
  -- 🔴 OWNER-SET. Live max stake 500,000; wallet_credit refuses a single credit
  --    over 2M, so a stake above 400k can already fail to pay out at 5×.
  c_stake_max constant bigint := 2000000;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_ref is null or length(p_ref) < 6 or length(p_ref) > 80 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;
  if p_side is null or p_side not in ('long', 'short') then return jsonb_build_object('ok', false, 'reason', 'side'); end if;
  if p_stake is null or p_stake < 50 or p_stake > c_stake_max then return jsonb_build_object('ok', false, 'reason', 'stake', 'max_stake', c_stake_max); end if;
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':fc_position', 0));

  select * into v_pos from public.fc_positions where user_id = v_uid and ref = p_ref;
  if found then return jsonb_build_object('ok', true, 'dup', true, 'stake', v_pos.stake, 'status', v_pos.status); end if;
  if exists (select 1 from public.fc_positions where user_id = v_uid and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'open');
  end if;

  v_chg := public._wallet_charge_core(v_uid, p_stake, 'Fuel Command: Open position (' || p_side || ')', 'fcpos:' || p_ref);
  if not coalesce((v_chg->>'ok')::boolean, false) then return v_chg; end if;
  insert into public.fc_positions (user_id, ref, side, stake) values (v_uid, p_ref, p_side, p_stake);
  return v_chg || jsonb_build_object('stake', p_stake);
end $$;
revoke all on function public.fc_position_open(text, bigint, text) from public, anon;
grant execute on function public.fc_position_open(text, bigint, text) to authenticated;

-- p_pos_ref names the position; p_ref names THIS close attempt (a refused close
-- leaves the position open, and the next attempt must carry a fresh ref).
create or replace function public.faucet_fc_position_close(p_pos_ref text, p_payout bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_pos    public.fc_positions%rowtype;
  v_profit bigint;
  v_pay    bigint;
  v_res    jsonb;
  -- 🔴 OWNER-SET.
  c_mult       constant bigint := 5;
  c_day_profit constant bigint := 1000000;
  c_day_pos    constant bigint := 20000000;   -- stakes coming back are not a mint; profit is capped above
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_ref is null or length(p_ref) < 6 or length(p_ref) > 80 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;
  if p_payout is null or p_payout < 0 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':fc_position', 0));

  select * into v_pos from public.fc_positions where user_id = v_uid and ref = p_pos_ref;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_position'); end if;
  if v_pos.status = 'closed' then
    if v_pos.close_ref is distinct from p_ref then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
    return jsonb_build_object('ok', true, 'dup', true, 'paid', coalesce(v_pos.payout, 0));
  end if;

  select coalesce(sum(greatest(0, coalesce(p.payout, 0) - p.stake)), 0) into v_profit
    from public.fc_positions p
   where p.user_id = v_uid and p.status = 'closed' and p.closed_at > now() - interval '24 hours';
  v_pay := least(p_payout, v_pos.stake * c_mult,
                 v_pos.stake + greatest(0, c_day_profit - v_profit));

  if v_pay > 0 then
    v_res := public._faucet_settle('fc_position', v_pay, p_ref, 'Fuel Command: position closed',
                                   v_pay, c_day_pos, 0, false,
                                   jsonb_build_object('position', p_pos_ref, 'asked', p_payout, 'stake', v_pos.stake));
    -- Not paid (wallet refused, day cap): the position stays OPEN — it is the
    -- player's, and the next close attempt settles it.
    if not coalesce((v_res->>'ok')::boolean, false) then return v_res; end if;
  else
    v_res := jsonb_build_object('ok', true, 'paid', 0);
  end if;

  update public.fc_positions
     set status = 'closed', payout = v_pay, close_ref = p_ref, closed_at = now()
   where id = v_pos.id;
  return v_res || jsonb_build_object('asked', p_payout, 'capped', greatest(0, p_payout - v_pay), 'stake', v_pos.stake);
end $$;
revoke all on function public.faucet_fc_position_close(text, bigint, text) from public, anon;
grant execute on function public.faucet_fc_position_close(text, bigint, text) to authenticated;

-- 3e. Loans. A draw is a DEBT ROW, not a free credit: one open loan at a time
--     (repayments below its principal), principal ≤ 100,000. Interest accrues
--     in the client (per fuel cycle), so repayments above the principal are
--     allowed and simply close the loan. Append-only: outstanding =
--     principal − sum(repayments) for that loan_ref.
create table if not exists public.fc_loan_ledger (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  loan_ref   text,                                  -- null = a repayment of a pre-198 (unrecorded) loan
  kind       text        not null check (kind in ('draw', 'repay')),
  amount     bigint      not null check (amount > 0),
  ref        text        not null,
  created_at timestamptz not null default now()
);
create unique index if not exists fc_loan_ledger_ref_uidx on public.fc_loan_ledger (user_id, kind, ref);
create index if not exists fc_loan_ledger_user_idx on public.fc_loan_ledger (user_id, loan_ref);
alter table public.fc_loan_ledger enable row level security;
-- Players read their own; rows are written only by the definer functions below.
drop policy if exists fc_loan_ledger_select on public.fc_loan_ledger;
create policy fc_loan_ledger_select on public.fc_loan_ledger
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.fc_loan_ledger from anon, authenticated;
grant select on public.fc_loan_ledger to authenticated;

-- The open loan (latest draw not yet repaid in full), or null. Server-only.
create or replace function public._fc_loan_open(p_uid uuid)
returns table (loan_ref text, principal bigint, repaid bigint)
language sql stable security definer set search_path = public as $$
  select d.ref, d.amount,
         coalesce((select sum(r.amount) from public.fc_loan_ledger r
                    where r.user_id = p_uid and r.kind = 'repay' and r.loan_ref = d.ref), 0)::bigint
    from public.fc_loan_ledger d
   where d.user_id = p_uid and d.kind = 'draw'
     and d.amount > coalesce((select sum(r.amount) from public.fc_loan_ledger r
                               where r.user_id = p_uid and r.kind = 'repay' and r.loan_ref = d.ref), 0)
   order by d.created_at desc
   limit 1
$$;
revoke all on function public._fc_loan_open(uuid) from public, anon, authenticated;

create or replace function public.faucet_fc_loan_draw(p_principal bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_open record;
  v_res  jsonb;
  -- 🔴 OWNER-SET. The client has no working credit limit (s.creditLimit is
  --    never set); the largest live draw was 100,000.
  c_loan_max constant bigint := 100000;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_principal is null or p_principal < 1 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':fc_loan', 0));
  -- A retry of a draw that was paid: the first answer, nothing new.
  if exists (select 1 from public.faucet_settlements where user_id = v_uid and source = 'fc_loan' and ref = p_ref) then
    return public._faucet_settle('fc_loan', p_principal, p_ref, 'Fuel Command: loan drawn', c_loan_max, c_loan_max, 0, false, null);
  end if;
  if p_principal > c_loan_max then return jsonb_build_object('ok', false, 'reason', 'call', 'max_call', c_loan_max); end if;
  select * into v_open from public._fc_loan_open(v_uid);
  if v_open.loan_ref is not null then
    return jsonb_build_object('ok', false, 'reason', 'open', 'owed', v_open.principal - v_open.repaid);
  end if;
  v_res := public._faucet_settle('fc_loan', p_principal, p_ref, 'Fuel Command: loan drawn',
                                 c_loan_max, c_loan_max, 0, false, jsonb_build_object('principal', p_principal));
  if coalesce((v_res->>'ok')::boolean, false) then
    insert into public.fc_loan_ledger (user_id, loan_ref, kind, amount, ref)
    values (v_uid, p_ref, 'draw', p_principal, p_ref) on conflict do nothing;
  end if;
  return v_res;
end $$;
revoke all on function public.faucet_fc_loan_draw(bigint, text) from public, anon;
grant execute on function public.faucet_fc_loan_draw(bigint, text) to authenticated;

-- A repayment is CHARGED here (not refundable: ledger ref 'fcloan:'), then
-- recorded against the open loan. No open loan → it is a pre-198 loan the
-- server never saw; it is still charged, recorded with loan_ref null.
create or replace function public.fc_loan_repay(p_amount bigint, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_open record;
  v_chg  jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_ref is null or length(p_ref) < 6 or length(p_ref) > 80 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;
  if p_amount is null or p_amount < 1 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':fc_loan', 0));
  select * into v_open from public._fc_loan_open(v_uid);
  v_chg := public._wallet_charge_core(v_uid, p_amount, 'Fuel Command: Loan repayment', 'fcloan:' || p_ref);
  if not coalesce((v_chg->>'ok')::boolean, false) then return v_chg; end if;
  if not coalesce((v_chg->>'dup')::boolean, false) then
    insert into public.fc_loan_ledger (user_id, loan_ref, kind, amount, ref)
    values (v_uid, v_open.loan_ref, 'repay', p_amount, p_ref) on conflict do nothing;
  end if;
  return v_chg || jsonb_build_object('loan_ref', v_open.loan_ref,
    'owed', case when v_open.loan_ref is null then null
                 else greatest(0, v_open.principal - v_open.repaid - p_amount) end);
end $$;
revoke all on function public.fc_loan_repay(bigint, text) from public, anon;
grant execute on function public.fc_loan_repay(bigint, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- §4  Season Pass — each (season, track, tier) pays once, at the server's price.
-- ════════════════════════════════════════════════════════════════════════════
-- WHY. The client pays a tier with _serverMirrorCredit(amount, 'season-pass tier
-- N'), and its only "already claimed" test is Profile.seasonPass.claimed*Tiers,
-- which the player owns. Live, 2026-09-23 (read-only): one player-day holds 25
-- payouts of 'season-pass tier 1' and 24 of 'tier 1 (premium)'.
-- THE RULES:
--   * amount = season_pass_tiers.cinder (seeded below from index.html
--     SEASON_FREE_REWARDS / SEASON_PREMIUM_REWARDS, v121v116; only 'cinder'
--     tiers are here — packs, frames, Aza do not touch this door);
--   * once per (player, season, track, tier) — season_pass_claims PK;
--   * the season is the client's Profile.seasonPass.seasonNumber, which rolls
--     by exactly one per 30 days of play. So a claim's season must be ≥ the
--     player's newest claimed season and ≤ that + 1, and never more than one
--     season ahead of the account's age (auth.users.created_at, 30-day seasons);
--   * premium needs a 'Season Pass — Premium unlock' charge on the ledger for
--     every season it pays premium tiers in (all 6 premium payers in the last
--     30 days have one);
--   * the ledger reason is unchanged ('season-pass tier N' / ' (premium)').
-- ⚠ A pre-198 claim is not in season_pass_claims, so each tier of the season
--   in progress can be paid once more through this door. That is bounded
--   (≤ 47,550 per season) and is the price of not trusting the client's map.
-- ⚠ A player whose save was wiped restarts at season 1 and is refused ('season')
--   until their client reaches the server's newest season. See the report.
create table if not exists public.season_pass_tiers (
  track  text    not null check (track in ('free', 'premium')),
  tier   integer not null check (tier between 1 and 30),
  cinder bigint  not null check (cinder > 0),
  primary key (track, tier)
);
alter table public.season_pass_tiers enable row level security;
-- A public price list: anyone signed in may read it; no client writes.
drop policy if exists season_pass_tiers_select on public.season_pass_tiers;
create policy season_pass_tiers_select on public.season_pass_tiers
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.season_pass_tiers from anon, authenticated;
grant select on public.season_pass_tiers to authenticated;

-- SEED — the Cinder tiers of SEASON_FREE_REWARDS / SEASON_PREMIUM_REWARDS.
-- ⚠ _faucets2_smoke.mjs parses these lines and index.html and fails on drift.
with seed(track, tier, cinder) as (values
  ('free', 1, 200), ('free', 2, 250), ('free', 4, 300), ('free', 5, 350),
  ('free', 7, 400), ('free', 8, 500), ('free', 10, 600), ('free', 11, 650),
  ('free', 12, 700), ('free', 14, 800), ('free', 16, 900), ('free', 17, 1000),
  ('free', 18, 1100), ('free', 20, 1200), ('free', 22, 1400), ('free', 23, 1500),
  ('free', 24, 1600), ('free', 26, 1800), ('free', 28, 2000), ('free', 29, 2500),
  ('free', 30, 5000),
  ('premium', 1, 500), ('premium', 2, 600), ('premium', 4, 700), ('premium', 7, 900),
  ('premium', 10, 1200), ('premium', 12, 1400), ('premium', 14, 1600), ('premium', 18, 2000),
  ('premium', 20, 2400), ('premium', 24, 3000), ('premium', 26, 3500), ('premium', 29, 5000)
), gone as (
  delete from public.season_pass_tiers t
   where not exists (select 1 from seed s where s.track = t.track and s.tier = t.tier)
)
insert into public.season_pass_tiers (track, tier, cinder)
select track, tier, cinder from seed
on conflict (track, tier) do update set cinder = excluded.cinder;

create table if not exists public.season_pass_claims (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  season     integer     not null check (season >= 1),
  track      text        not null check (track in ('free', 'premium')),
  tier       integer     not null check (tier between 1 and 30),
  cinder     bigint      not null,
  ref        text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, season, track, tier)
);
alter table public.season_pass_claims enable row level security;
-- Players read their own; rows are written only by faucet_season_pass.
drop policy if exists season_pass_claims_select on public.season_pass_claims;
create policy season_pass_claims_select on public.season_pass_claims
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.season_pass_claims from anon, authenticated;
grant select on public.season_pass_claims to authenticated;

create or replace function public.faucet_season_pass(p_season integer, p_tier integer, p_track text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_amt     bigint;
  v_newest  integer;
  v_age     integer;
  v_unlocks bigint;
  v_prem    bigint;
  v_res     jsonb;
  v_reason  text;
  -- A full season (both tracks) is 47,550; nothing honest pays more in a day.
  c_day_sp constant bigint := 47550;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_track is null or p_track not in ('free', 'premium') then return jsonb_build_object('ok', false, 'reason', 'track'); end if;
  if p_tier is null or p_season is null or p_season < 1 then return jsonb_build_object('ok', false, 'reason', 'tier'); end if;
  select t.cinder into v_amt from public.season_pass_tiers t where t.track = p_track and t.tier = p_tier;
  if v_amt is null then return jsonb_build_object('ok', false, 'reason', 'tier'); end if;
  v_reason := 'season-pass tier ' || p_tier || case when p_track = 'premium' then ' (premium)' else '' end;

  -- _faucet_settle's own lock, taken first so the checks below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('faucet:' || v_uid::text || ':season_pass', 0));
  if exists (select 1 from public.faucet_settlements where user_id = v_uid and source = 'season_pass' and ref = p_ref) then
    return public._faucet_settle('season_pass', v_amt, p_ref, v_reason, v_amt, c_day_sp, 0, false, null);
  end if;
  if exists (select 1 from public.season_pass_claims c
              where c.user_id = v_uid and c.season = p_season and c.track = p_track and c.tier = p_tier) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;

  select max(c.season) into v_newest from public.season_pass_claims c where c.user_id = v_uid;
  select floor(extract(epoch from (now() - u.created_at)) / 2592000)::integer + 1 into v_age
    from auth.users u where u.id = v_uid;
  if p_season > coalesce(v_age, 1) + 1
     or (v_newest is not null and (p_season < v_newest or p_season > v_newest + 1)) then
    return jsonb_build_object('ok', false, 'reason', 'season', 'newest', v_newest);
  end if;

  if p_track = 'premium' then
    select count(*) into v_unlocks from public.wallet_ledger l
     where l.user_id = v_uid and l.op = 'charge' and l.resource = 'cinder'
       and l.reason = 'Season Pass — Premium unlock';
    select count(distinct c.season) into v_prem from public.season_pass_claims c
     where c.user_id = v_uid and c.track = 'premium' and c.season <> p_season;
    if v_unlocks < v_prem + 1 then return jsonb_build_object('ok', false, 'reason', 'premium'); end if;
  end if;

  v_res := public._faucet_settle('season_pass', v_amt, p_ref, v_reason, v_amt, c_day_sp, 0, false,
                                 jsonb_build_object('season', p_season, 'track', p_track, 'tier', p_tier));
  if coalesce((v_res->>'ok')::boolean, false) then
    insert into public.season_pass_claims (user_id, season, track, tier, cinder, ref)
    values (v_uid, p_season, p_track, p_tier, v_amt, p_ref) on conflict do nothing;
  end if;
  return v_res || jsonb_build_object('cinder', v_amt);
end $$;
revoke all on function public.faucet_season_pass(integer, integer, text, text) from public, anon;
grant execute on function public.faucet_season_pass(integer, integer, text, text) to authenticated;


-- ============================================================================
-- PHASE-2 GUARD (sql/196 2a) — when the owner turns it on, add these reasons
-- to _wallet_ledger_faucet_guard's list. Commented out; see sql/196.
--   'Fuel Command: NPC sale', 'Fuel Command: hedge settled',
--   'Fuel Command: insurance payout', 'Fuel Command: position closed',
--   'Fuel Command: loan drawn', new.reason like 'season-pass tier %'
-- ============================================================================

-- ============================================================================
-- VERIFY. Expected:
--   table        fc_loan_ledger / fc_positions / season_pass_claims /
--                season_pass_tiers                         rls = true   (4 rows)
--   policy       one select policy on each of the four               (4 rows)
--   function     _wallet_charge_core, _fc_loan_open           → false
--                city_owner_ledger_apply, wallet_charge_ref, wallet_refund,
--                faucet_fc_npc_sale, faucet_fc_hedge, faucet_fc_insurance,
--                fc_position_open, faucet_fc_position_close,
--                faucet_fc_loan_draw, fc_loan_repay, faucet_season_pass → true
--   tiers        free 21 rows / 24750 ; premium 12 rows / 22800
--   bound        npc 100 bbl → 30400 ; hedge 100 bbl → 29800
-- ============================================================================
select 'table' as what, c.relname::text as name, ('rls=' || c.relrowsecurity::text) as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('fc_positions', 'fc_loan_ledger', 'season_pass_tiers', 'season_pass_claims')
union all
select 'policy', tablename::text || '.' || policyname::text, cmd::text from pg_policies
 where schemaname = 'public' and tablename in ('fc_positions', 'fc_loan_ledger', 'season_pass_tiers', 'season_pass_claims')
union all
select 'function', p.proname::text,
       'authenticated may execute: ' || has_function_privilege('authenticated', p.oid, 'execute')::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('city_owner_ledger_apply', '_wallet_charge_core', 'wallet_charge_ref', 'wallet_refund',
                     'faucet_fc_npc_sale', 'faucet_fc_hedge', 'faucet_fc_insurance',
                     'fc_position_open', 'faucet_fc_position_close', '_fc_loan_open',
                     'faucet_fc_loan_draw', 'fc_loan_repay', 'faucet_season_pass')
union all
select 'tiers', track, count(*)::text || ' rows / ' || sum(cinder)::text from public.season_pass_tiers group by track
union all
select 'bound', 'npc 100 bbl', (100 * 304)::text
union all
select 'bound', 'hedge 100 bbl', (100 * 298)::text;
