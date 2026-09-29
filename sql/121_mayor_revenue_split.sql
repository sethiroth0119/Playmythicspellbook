-- ════════════════════════════════════════════════════════════════════════════
-- 121 · THE MAYOR HALL CONTRACT ACTUALLY PAYS (v121v65)
--
-- Mayor Hall negotiates a revenue split — "30% mayor · 70% owner" — and writes
-- it to node_mayors.player_pct when an offer is accepted. The game read that
-- number to PRINT it on the manage button and nowhere else. Every Cinder the
-- city earned went to the owner. A mayor could work a contract for a month and
-- be paid exactly nothing by it.
--
-- This makes city_owner_ledger_apply honour the contract.
--
-- ── WHY THIS IS SERVER SIDE ─────────────────────────────────────────────────
-- The split cannot live in the browser. The client running the city IS the
-- mayor's client, Cinder is withdrawable through the Cashout Vault, and a
-- percentage the payee can edit is not a contract, it is a faucet. The only
-- copy of player_pct that may decide money is the row Mayor Hall wrote.
--
-- ── THE TWO RULES ───────────────────────────────────────────────────────────
--   1. EARNINGS SPLIT, SPENDS DO NOT. Only a positive delta is shared. A
--      negative delta is the city buying something and comes wholly out of the
--      owner's stores — splitting it would hand the mayor a rebate for
--      spending someone else's money.
--   2. NOTHING IS MINTED OR LOST. The mayor's cut is floored and the owner
--      receives the exact remainder, so cut + owner_delta = delta to the
--      Cinder, every time. The rounding crumb goes to the owner, who is the
--      party carrying the cost of the city.
--
-- Resources are NOT split here. The contract has its own card_policy and
-- resource_policy fields with their own wording ("Node owner keeps them"), and
-- quietly reinterpreting those as a percentage would pay people terms they
-- never agreed to. Salvage continues to go wholly to the owner.
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- The contract terms for the CALLER as mayor of this node, or nothing. Same
-- authority test as _node_manager_owner — an active row naming auth.uid() as
-- the mayor — so a non-mayor can no more read terms than apply a delta.
create or replace function public._node_mayor_terms(p_node_id text)
returns table (owner_id uuid, player_pct numeric)
language sql stable security definer set search_path = public as $$
  select m.owner_id,
         least(100, greatest(0, coalesce(m.player_pct, 0)))::numeric
    from public.node_mayors m
   where m.node_id = p_node_id
     and m.mayor_id = auth.uid()
     and coalesce(m.active, true)
   limit 1;
$$;

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
begin
  if v_mayor is null then raise exception 'not signed in'; end if;

  select t.owner_id, t.player_pct into v_owner, v_pct
    from public._node_mayor_terms(p_node_id) t;
  if v_owner is null then raise exception 'you do not manage this node'; end if;

  -- ── the contract, applied ────────────────────────────────────────────────
  v_delta := coalesce(p_cinder_delta, 0);
  if v_delta > 0 and coalesce(v_pct, 0) > 0 then
    v_cut := floor(v_delta * v_pct / 100.0);
  end if;
  -- The owner takes the exact remainder. Never `v_delta * (100-pct)/100`:
  -- two independent floors lose a Cinder per payout to nobody.
  v_owner_delta := v_delta - v_cut;

  -- Lock the owner's row for the whole check-and-apply. Without this, two
  -- managers (or a manager and a retrying client) can both read the same
  -- balance and both spend it.
  select coalesce(forge->'__salvage__', '{}'::jsonb), coalesce(gems, 0)
    into v_salvage, v_cinder
    from public.user_profiles where user_id = v_owner for update;

  if v_salvage is null then raise exception 'owner has no profile'; end if;

  -- Cinder first: a refusal here must happen before any resource moves, and
  -- before the mayor is paid anything.
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

  -- ! jsonb_set on the ONE key. Writing the whole forge blob back would
  --   destroy every other thing the owner changed since we read it.
  update public.user_profiles
     set forge = jsonb_set(coalesce(forge, '{}'::jsonb), '{__salvage__}', v_salvage, true),
         gems  = v_cinder
   where user_id = v_owner;

  -- Keep the canonical wallet in step. Missing this is exactly how the v120g6
  -- drift happened: gems and user_progress.cinder disagreeing forever.
  begin
    update public.user_progress set cinder = greatest(0, v_cinder) where user_id = v_owner;
  exception when undefined_table or undefined_column then null;
  end;

  -- ── the mayor's share, paid LAST ─────────────────────────────────────────
  -- After the owner's side committed, so a refusal above can never pay a cut
  -- for revenue the owner never received. _ct_cinder_give writes the canonical
  -- wallet AND a wallet_ledger row, which is what puts a named line in the
  -- player's phone ledger instead of an unexplained credit.
  if v_cut > 0 then
    begin
      perform public._ct_cinder_give(v_mayor, v_cut::bigint,
        'Mayor revenue share (' || round(v_pct)::text || '%) — city on node ' || coalesce(p_node_id, '?'));
    exception when undefined_function then null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'cinder', v_cinder,
    'salvage', v_salvage,
    'mayor_pct', v_pct,
    'mayor_cut', v_cut,
    'owner_delta', v_owner_delta);
end $$;

revoke all on function public._node_mayor_terms(text) from public, anon;
revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public._node_mayor_terms(text) to authenticated;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;

commit;

-- --- VERIFY. Expect split_live = t.
select exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_node_mayor_terms'
) as split_live;
