-- ════════════════════════════════════════════════════════════════════════════
-- 145 · THE SERVER BOUNDS THE CITY PAYOUT DELTA (draft, NOT applied)
--
-- Requires sql/142 (corp_node_managers). Refuses to run without it.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- city_owner_ledger_apply (sql/121 → 123 → 142) credits the node owner, the
-- Node Manager (_ct_cinder_give) and, since 142, the employing corporation's
-- treasury out of p_cinder_delta. That number is chosen ENTIRELY by the
-- manager's client: index.html's _cityMgrSend passes the city's pending
-- earnings straight through. The only server check was _node_mayor_terms,
-- "the caller is the active mayor_id of this node". So a seated manager could
--     rpc('city_owner_ledger_apply', { p_node_id, p_cinder_delta: 1e9 })
-- from the console and mint Cinder for the owner, themselves and their corp.
-- Live on 2026-09-17: mayor_earnings has single payouts of 6,000 / 5,550
-- (about 20,000 / 18,500 gross at 30%) against a typical cut of 2.
--
-- ── THE BOUND ───────────────────────────────────────────────────────────────
-- A token bucket per node. The allowance refills at rate_per_hour for the
-- time since that node's last accepted apply, up to burst_cap. A positive
-- delta larger than the allowance is refused WHOLE with
--     { ok:false, error:'over_rate', allowance, rate_per_hour, rate_cap, retry_after }
-- and nothing is written: no gems, no wallet_ledger, no mayor_earnings, no
-- corp_treasury. There is no partial credit: a partial credit would drain the
-- bucket with whatever garbage a client sent, every flush, and the client
-- could not tell what had landed.
-- Spends (negative deltas) are never bounded by it (they are bounded by the
-- owner's balance, as before) and they give their Cinder back to the bucket,
-- so a demolish refund of something the owner just paid for still lands.
--
-- The numbers live in ONE place, _city_ledger_econ(), which is the _opEcon()
-- rule: the payout body hard-codes no economy number. They were picked from
-- the live distribution above: the busiest real hour on any node was about
-- 18,600 gross; the biggest single real apply about 20,000. burst_cap 40,000
-- clears both with room; 36,000/hour (10 a second) is about twice the busiest
-- hour seen. A dishonest manager can still inflate by up to that much per node
-- per hour. That is the knob to turn down once the city economy's real
-- ceiling is known, but it turns "unbounded" into "bounded and tunable".
--
-- ── REJECTED DESIGNS ────────────────────────────────────────────────────────
--   * An append-only row per accepted apply. The client flushes every 6 s:
--     about 14,400 rows a node a day, ~300k a day at today's 21 active
--     contracts, for a rate limiter. The bucket is ONE row a node and it is
--     not money. "Ledgers are append-only" is about balances, and no balance
--     is ever read from this table.
--   * Debiting the bucket at the top. The insufficient_cinder/resource
--     refusals RETURN (they do not raise), so the debit would commit for a
--     payout that never happened. The debit is on the success path only.
--   * Bounding the manager's cut instead of the delta. The owner's share is
--     the bigger faucet (70% of a 30% contract).
--   * Keying the bucket by manager. An owner who re-seats a new manager must
--     not hand them a fresh bucket. It is per node and survives contract
--     changes.
--
-- ── WHAT IS UNCHANGED ───────────────────────────────────────────────────────
-- Everything else in the function is sql/142 line for line: the split, the
-- floored manager share with the corp taking the exact remainder, the
-- refusals, the wording read by the sql/123 backfill. The added lines sit
-- between "rate bound (sql/145)" / "rate bound" arrow markers, and
-- _corpnodemgr_smoke.mjs removes them and compares what is left with sql/142.
--
-- ── NOT COVERED ─────────────────────────────────────────────────────────────
-- p_salvage_delta is still client-chosen per resource. It moves resources into
-- the OWNER's forge only (no manager or corp split), so it is not a Cinder
-- faucet; bounding it needs a per-resource rate and is a separate change.
--
-- Idempotent: create-if-not-exists, no policies to re-create, create-or-
-- replace. Apply by hand in the SQL editor for ktsiasyjusesawtrwrjc, AFTER
-- sql/142.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regclass('public.corp_node_managers') is null then
    raise exception 'sql/145 needs sql/142 (corp_node_managers) applied first';
  end if;
end $$;

-- ── the bucket: one row per node, server-only ───────────────────────────────
create table if not exists public.city_ledger_rate (
  node_id    text        primary key,
  allowance  numeric     not null,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policy: a client can neither read nor write a row, and the
-- grants are revoked as well. Only the SECURITY DEFINER payout below touches
-- it. A client that could UPDATE its own node's allowance would have the
-- faucet back.
alter table public.city_ledger_rate enable row level security;
revoke all on public.city_ledger_rate from anon, authenticated, public;

-- ── the numbers (this RPC's _opEcon) ────────────────────────────────────────
create or replace function public._city_ledger_econ()
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rate_per_hour',        36000,   -- gross city payout a node may bank per hour
    'burst_cap',            40000,   -- most a node can bank in one apply after a full refill
    'spend_credit_ceiling', 250000   -- most a run of spends can lift the bucket to
  );
$$;
revoke all on function public._city_ledger_econ() from public, anon;
grant execute on function public._city_ledger_econ() to authenticated;

-- ── the payout, bounded ─────────────────────────────────────────────────────
-- Re-stated in full from sql/142, for the reason 123 and 142 gave: a money
-- function split across files is one nobody can read in one sitting.
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
  -- ▼ rate bound (sql/145)
  v_econ        jsonb := public._city_ledger_econ();
  v_rate        numeric;
  v_cap         numeric;
  v_ceil        numeric;
  v_allow       numeric;
  v_left        numeric;
  v_rrow        public.city_ledger_rate%rowtype;
  -- ▲ rate bound
begin
  if v_mayor is null then raise exception 'not signed in'; end if;

  select t.owner_id, t.player_pct into v_owner, v_pct
    from public._node_mayor_terms(p_node_id) t;
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  -- ▼ rate bound (sql/145)
  -- Refill the node's bucket for the time since its last accepted apply and
  -- refuse a credit bigger than what is in it — WHOLE, before any write, so
  -- an over-rate call credits nobody (not the owner, not the manager, not the
  -- corp). The row lock also serialises two applies for the same node: the
  -- second one refills from the first one's result instead of both spending
  -- the same allowance. Only the caller's own node is ever touched, because
  -- _node_mayor_terms above already proved they manage it.
  v_rate := (v_econ->>'rate_per_hour')::numeric;
  v_cap  := (v_econ->>'burst_cap')::numeric;
  v_ceil := (v_econ->>'spend_credit_ceiling')::numeric;
  insert into public.city_ledger_rate (node_id, allowance, updated_at)
  values (p_node_id, v_cap, now())
  on conflict (node_id) do nothing;
  select * into v_rrow from public.city_ledger_rate where node_id = p_node_id for update;
  -- greatest(): an allowance already above the cap (spend credit, below) is
  -- never clipped DOWN by the refill.
  v_allow := greatest(v_rrow.allowance,
               least(v_cap, v_rrow.allowance
                 + v_rate * greatest(0, extract(epoch from (now() - v_rrow.updated_at))) / 3600.0));
  if coalesce(p_cinder_delta, 0) > v_allow then
    return jsonb_build_object('ok', false, 'error', 'over_rate',
      'allowance', floor(v_allow),
      'rate_per_hour', v_rate, 'rate_cap', v_cap,
      'retry_after', ceil((coalesce(p_cinder_delta, 0) - v_allow) * 3600.0 / v_rate));
  end if;
  -- ▲ rate bound

  v_delta := coalesce(p_cinder_delta, 0);
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

  update public.user_profiles
     set forge = jsonb_set(coalesce(forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where user_id = v_owner;

  begin
    update public.user_progress set cinder = greatest(0, v_cinder) where user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  -- ── the Node Manager's share, paid LAST (sql/121) ─────────────────────────
  v_mgr_share := v_cut;
  if v_cut > 0 then
    -- Is this manager employed by a corporation? `for share` holds the row so
    -- a corp_end_node_manager racing this payout waits for it instead of
    -- ending the contract halfway through the split.
    select e.corp_id, e.manager_pct into v_emp_corp, v_mgr_pct
      from public.corp_node_managers e
     where e.manager_id = v_mayor and e.status = 'active'
     limit 1
       for share;

    if v_emp_corp is not null then
      -- Floor the manager, corp takes the exact remainder: never two floors.
      v_mgr_share  := floor(v_cut * v_mgr_pct / 100.0);
      v_corp_share := v_cut - v_mgr_share;
    end if;

    if v_mgr_share > 0 then
      begin
        if v_emp_corp is null then
          -- Unchanged wording: sql/123's backfill and the phone ledger read it.
          perform public._ct_cinder_give(v_mayor, v_mgr_share::bigint,
            'Mayor revenue share (' || round(v_pct)::text || '%) — city on node ' || coalesce(p_node_id, '?'));
        else
          perform public._ct_cinder_give(v_mayor, v_mgr_share::bigint,
            'Node Manager commission (' || round(v_mgr_pct)::text || '% of a '
            || round(v_pct)::text || '% share) — city on node ' || coalesce(p_node_id, '?'));
        end if;
      exception when undefined_function then null;
      end;
      -- Reporting row (sql/123): what actually reached this player's wallet,
      -- so the phone dashboard never shows the corp's part as the manager's.
      begin
        insert into public.mayor_earnings (node_id, mayor_id, owner_id, amount, pct)
        values (p_node_id, v_mayor, v_owner, v_mgr_share::bigint, v_pct);
      exception when others then null;
      end;
    end if;

    -- The corp's part: ONE append-only row. Deliberately NOT wrapped in an
    -- exception handler — if the treasury cannot take it, the whole payout
    -- rolls back and the client retries, rather than the owner's side
    -- committing while the corp's Cinder vanishes.
    if v_corp_share > 0 then
      insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
      values (v_emp_corp, v_mayor, v_corp_share, 'node_manager_fee',
              'Node Manager fee (' || round(100 - v_mgr_pct)::text || '% of a '
              || round(v_pct)::text || '% share) — city on node ' || coalesce(p_node_id, '?'));
    end if;
  end if;

  -- ▼ rate bound (sql/145)
  -- Debit (or, for a spend, credit) the bucket only on the success path:
  -- the insufficient_* refusals above RETURN rather than raise, so a debit
  -- written before them would commit and eat allowance for a payout that
  -- never happened. A spend gives its Cinder back to the bucket so a build
  -- refund (bldPayRefund → addCinders → this RPC) can return what was paid;
  -- that credit is ceilinged so it cannot pile up without limit, and it is
  -- not a mint either way — the owner already paid it out.
  if coalesce(p_cinder_delta, 0) <> 0 then
    if p_cinder_delta > 0 then
      v_left := v_allow - p_cinder_delta;
    else
      v_left := greatest(v_allow, least(v_ceil, v_allow - p_cinder_delta));
    end if;
    update public.city_ledger_rate
       set allowance = v_left, updated_at = now()
     where node_id = p_node_id;
  else
    v_left := v_allow;
  end if;
  -- ▲ rate bound

  return jsonb_build_object(
    'ok', true,
  -- ▼ rate bound (sql/145)
    'rate_allowance', floor(v_left),
    'rate_per_hour', v_rate,
    'rate_cap', v_cap,
  -- ▲ rate bound
    'cinder', v_cinder,
    'salvage', v_salvage,
    'mayor_pct', v_pct,
    -- mayor_cut stays "what reached THIS player's wallet": index.html's
    -- _cityCutReport toasts it to the manager, and announcing the corp's part
    -- as theirs would be a lie on screen. contract_cut is the gross.
    'mayor_cut', v_mgr_share,
    'contract_cut', v_cut,
    'corp_id', v_emp_corp,
    'manager_pct', v_mgr_pct,
    'corp_share', v_corp_share,
    'owner_delta', v_owner_delta);
end $$;

revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;

commit;

-- --- VERIFY. Expect table_t = t, rls_t = t, policies_expect_0 = 0,
--     client_can_read_expect_false = f, client_can_write_expect_false = f,
--     bound_live_t = t, split_live_t = t, econ_rate_expect_36000 = 36000.
select
  (to_regclass('public.city_ledger_rate') is not null)                          as table_t,
  (select relrowsecurity from pg_class where oid = 'public.city_ledger_rate'::regclass) as rls_t,
  (select count(*) from pg_policies where schemaname = 'public'
      and tablename = 'city_ledger_rate')                                        as policies_expect_0,
  has_table_privilege('authenticated', 'public.city_ledger_rate', 'SELECT')      as client_can_read_expect_false,
  has_table_privilege('authenticated', 'public.city_ledger_rate', 'UPDATE')      as client_can_write_expect_false,
  (position('over_rate' in pg_get_functiondef(
     'public.city_owner_ledger_apply(text,numeric,jsonb)'::regprocedure)) > 0)   as bound_live_t,
  (position('node_manager_fee' in pg_get_functiondef(
     'public.city_owner_ledger_apply(text,numeric,jsonb)'::regprocedure)) > 0)   as split_live_t,
  (public._city_ledger_econ()->>'rate_per_hour')::numeric                        as econ_rate_expect_36000;
