-- ════════════════════════════════════════════════════════════════════════════
-- 142 · CORPORATIONS EMPLOY NODE MANAGERS
--       APPLIED 2026-09-17 after sql/149 (owner: members may read contracts;
--       mayor_cut = the manager's own share). Rolled-back probe: a member cannot
--       offer, 150% refused, accept ok, member reads (role member), stranger 0,
--       payout 1000 @30% on a 70 contract = owner 700 / manager 210 / corp 90.
--
-- Asked for: "Change the mayor name to Node Manager. Allow players who own
-- corporations to hire players as mayors to get a percentage of what they are
-- contracted for as Node Managers from their clients."
--
-- What exists today: a node owner hires a Node Manager (node_mayors, "mayor"
-- in the schema — the tables keep their names, only the words on screen
-- change) and sql/121 + sql/123 pay that manager floor(delta * player_pct/100)
-- of every positive city payout. Nothing ties a manager to a corporation.
--
-- This adds the employment: a corporation FOUNDER offers a player a contract
-- with a commission percentage; the player accepts; from then on every share
-- the player earns as a Node Manager is split between the player and the
-- corporation's treasury.
--
-- ── WHAT manager_pct MEANS ──────────────────────────────────────────────────
-- It is the percentage of the Node Manager's OWN cut that the manager keeps.
-- The corporation keeps the rest. A 70 contract on a 30% city:
--     delta 1000 → owner 700, cut 300 → manager 210, corp 90.
-- It is NOT a percentage of the city's delta: the corp is paid out of what the
-- manager was contracted for, never out of the node owner's share, which is
-- what "a percentage of what they are contracted for" says. The node owner's
-- number is identical whether or not the manager is employed.
--
-- ── THE RULES, SAME SHAPE AS sql/121 ────────────────────────────────────────
--   1. NOTHING IS MINTED OR LOST. manager_share is floored and the corp gets
--      the exact remainder: owner_delta + manager_share + corp_share = delta
--      to the Cinder. Two independent floors would leak a Cinder per payout to
--      nobody (the bug sql/121 already names); a ceil would mint one.
--   2. SPENDS ARE NEVER SPLIT. A negative delta has a zero cut in sql/121, so
--      there is nothing to split and the corp is never charged for a city
--      buying something.
--   3. THE ONLY CINDER SOURCE IS THE OWNER'S EARNED DELTA. The corp's share is
--      carved out of the cut that sql/121 already moves; this file adds no
--      new faucet.
--   4. corp_treasury IS APPEND-ONLY. One INSERT per payout, balance =
--      sum(amount), the corpTreasuryDeposit() pattern. Never an UPDATE.
--   5. NO EMPLOYMENT → sql/121/123 BEHAVIOUR, BYTE FOR BYTE IN EFFECT. The 21
--      live contracts keep paying exactly as they do today until a manager
--      accepts a corp offer.
--
-- ── WHO CAN READ A CONTRACT: THE MANAGER AND EVERY MEMBER OF THE CORP ───────
-- Owner decision 2026-09-17: corporation members may read their corp's Node
-- Manager contracts. The first draft limited reads to the manager and the
-- founder because corp_members was not a trust boundary — any player could
-- insert themselves into any corporation. sql/149 closed that (membership is
-- written by the founder's hire or by the server only), so is_corp_member() is
-- now a real test and is what this file uses.
-- ⚠ ORDER: apply AFTER sql/149. Applied before it, "members" means anyone.
-- Members READ only; offering, accepting and ending stay with the founder and
-- the manager (the RPCs below), and corp_node_manager_list() reports a member
-- who is neither party with role 'member' so the client shows it read-only.
--
-- ── WHY RPC ONLY ────────────────────────────────────────────────────────────
-- The percentage decides money. A table a client can UPDATE is a manager
-- raising their own share to 100. There is no insert/update/delete policy and
-- those privileges are revoked; every write goes through a SECURITY DEFINER
-- function that checks auth.uid() against the right party.
--
-- Requires sql/121, sql/123. Idempotent, safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.corp_node_managers (
  id          uuid        primary key default gen_random_uuid(),
  corp_id     uuid        not null references public.corporations(id) on delete cascade,
  manager_id  uuid        not null references auth.users(id) on delete cascade,
  manager_pct numeric     not null,
  status      text        not null default 'offered',
  offered_by  uuid        not null,
  ended_by    uuid,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  -- Whole percents, 0-100, enforced by the TABLE and not only by the RPC, so a
  -- future function that forgets the check still cannot store 150.
  constraint corp_node_managers_pct_range
    check (manager_pct >= 0 and manager_pct <= 100 and manager_pct = trunc(manager_pct)),
  constraint corp_node_managers_status
    check (status in ('offered', 'active', 'ended'))
);

-- ONE ACTIVE EMPLOYER PER MANAGER, by index. Two accepts racing in two tabs
-- would otherwise both pass a "no active row" check and the payout would pick
-- whichever row the planner met first.
create unique index if not exists corp_node_managers_one_active
  on public.corp_node_managers (manager_id) where status = 'active';
-- One open offer per corp/player pair, so a founder cannot stack offers.
create unique index if not exists corp_node_managers_one_offer
  on public.corp_node_managers (corp_id, manager_id) where status = 'offered';
create index if not exists corp_node_managers_corp_idx
  on public.corp_node_managers (corp_id, status);

alter table public.corp_node_managers enable row level security;

drop policy if exists cnm_sel on public.corp_node_managers;
create policy cnm_sel on public.corp_node_managers
  for select to authenticated
  using (
    manager_id = auth.uid()
    or public.is_corp_member(corp_node_managers.corp_id, auth.uid())
  );
-- No insert / update / delete policy, on purpose. See header.
revoke all on public.corp_node_managers from anon, public;
revoke insert, update, delete, truncate on public.corp_node_managers from authenticated;
grant select on public.corp_node_managers to authenticated;

-- ── offer ───────────────────────────────────────────────────────────────────
create or replace function public.corp_offer_node_manager(
  p_corp_id uuid, p_manager_id uuid, p_pct numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.corporations c
                  where c.id = p_corp_id and c.founder_id = v_uid) then
    raise exception 'only the corporation founder can hire a Node Manager' using errcode = '42501';
  end if;
  if p_manager_id is null then raise exception 'no player chosen'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 or p_pct <> trunc(p_pct) then
    raise exception 'commission must be a whole percent from 0 to 100' using errcode = '22023';
  end if;
  begin
    insert into public.corp_node_managers (corp_id, manager_id, manager_pct, status, offered_by)
    values (p_corp_id, p_manager_id, p_pct, 'offered', v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'that player already has an open offer from this corporation';
    when foreign_key_violation then
      raise exception 'no such player';
  end;
  return v_id;
end $$;

-- ── accept ──────────────────────────────────────────────────────────────────
create or replace function public.corp_accept_node_manager(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  r     public.corp_node_managers%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into r from public.corp_node_managers where id = p_id for update;
  if r.id is null or r.manager_id <> v_uid then
    -- Same message for "missing" and "not yours": a stranger learns nothing.
    raise exception 'no such offer for you' using errcode = '42501';
  end if;
  if r.status <> 'offered' then raise exception 'this offer is no longer open'; end if;
  -- A founder who handed the corp on (or lost it) cannot leave a live offer
  -- behind that binds the NEW founder's treasury to terms they never set.
  if not exists (select 1 from public.corporations c
                  where c.id = r.corp_id and c.founder_id = r.offered_by) then
    update public.corp_node_managers
       set status = 'ended', ended_at = now(), ended_by = v_uid
     where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'offer_stale');
  end if;
  begin
    update public.corp_node_managers
       set status = 'active', started_at = now()
     where id = p_id;
  exception when unique_violation then
    raise exception 'you already work for a corporation as Node Manager — end that contract first';
  end;
  return jsonb_build_object('ok', true, 'id', p_id, 'corp_id', r.corp_id, 'manager_pct', r.manager_pct);
end $$;

-- ── end (either party; the founder may also withdraw an open offer, the
--     player may decline one) ────────────────────────────────────────────────
create or replace function public.corp_end_node_manager(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  r     public.corp_node_managers%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into r from public.corp_node_managers where id = p_id for update;
  if r.id is null or not (
       r.manager_id = v_uid
       or exists (select 1 from public.corporations c
                   where c.id = r.corp_id and c.founder_id = v_uid)) then
    raise exception 'no such contract for you' using errcode = '42501';
  end if;
  if r.status = 'ended' then
    return jsonb_build_object('ok', true, 'id', p_id, 'already', true);
  end if;
  update public.corp_node_managers
     set status = 'ended', ended_at = now(), ended_by = v_uid
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ── both dashboards ─────────────────────────────────────────────────────────
-- One row per contract the caller is a party to. `role` tells the client which
-- side it is looking from. corp_fees_total is read from corp_treasury, the
-- ledger itself, rather than a counter that could disagree with it.
create or replace function public.corp_node_manager_list()
returns table (
  id              uuid,
  role            text,
  corp_id         uuid,
  corp_name       text,
  corp_tag        text,
  manager_id      uuid,
  manager_name    text,
  manager_pct     numeric,
  status          text,
  created_at      timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  corp_fees_total bigint
)
language sql stable security definer set search_path = public, pg_temp as $$
  select k.id,
         case when k.manager_id = auth.uid() then 'manager'
              when c.founder_id = auth.uid() then 'employer'
              else 'member' end,
         k.corp_id, c.name, c.tag,
         k.manager_id,
         coalesce(nullif(pp.display_name, ''), 'Survivor'),
         k.manager_pct, k.status, k.created_at, k.started_at, k.ended_at,
         coalesce((select sum(t.amount)
                     from public.corp_treasury t
                    where t.corp_id = k.corp_id
                      and t.user_id = k.manager_id
                      and t.kind = 'node_manager_fee'
                      and k.started_at is not null
                      and t.created_at >= k.started_at
                      and (k.ended_at is null or t.created_at <= k.ended_at)), 0)::bigint
    from public.corp_node_managers k
    join public.corporations c on c.id = k.corp_id
    left join public.public_profiles pp on pp.user_id = k.manager_id
   where k.manager_id = auth.uid()
      or public.is_corp_member(k.corp_id, auth.uid())
   order by (k.status = 'active') desc, (k.status = 'offered') desc, k.created_at desc
   limit 200;
$$;

-- ── the payout, with the employment honoured ────────────────────────────────
-- Re-stated in full from sql/123 (which re-stated sql/121) for the same reason
-- 123 gave: a money function split across files is one nobody can read in one
-- sitting. Everything above the "mayor's share" block is unchanged.
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
begin
  if v_mayor is null then raise exception 'not signed in'; end if;

  select t.owner_id, t.player_pct into v_owner, v_pct
    from public._node_mayor_terms(p_node_id) t;
  if v_owner is null then raise exception 'you do not manage this node'; end if;

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

  return jsonb_build_object(
    'ok', true,
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

revoke all on function public.corp_offer_node_manager(uuid, uuid, numeric) from public, anon;
revoke all on function public.corp_accept_node_manager(uuid)              from public, anon;
revoke all on function public.corp_end_node_manager(uuid)                 from public, anon;
revoke all on function public.corp_node_manager_list()                    from public, anon;
revoke all on function public.city_owner_ledger_apply(text, numeric, jsonb) from public, anon;
grant execute on function public.corp_offer_node_manager(uuid, uuid, numeric) to authenticated;
grant execute on function public.corp_accept_node_manager(uuid)              to authenticated;
grant execute on function public.corp_end_node_manager(uuid)                 to authenticated;
grant execute on function public.corp_node_manager_list()                    to authenticated;
grant execute on function public.city_owner_ledger_apply(text, numeric, jsonb) to authenticated;

commit;

-- --- VERIFY. Expect table_t = t, rls_t = t, policies_expect_1 = 1,
--     write_policies_expect_0 = 0, fns_expect_4 = 4, split_live_t = t,
--     client_can_write_expect_false = f.
select
  (to_regclass('public.corp_node_managers') is not null)                       as table_t,
  (select relrowsecurity from pg_class where oid = 'public.corp_node_managers'::regclass) as rls_t,
  (select count(*) from pg_policies where tablename = 'corp_node_managers')     as policies_expect_1,
  (select count(*) from pg_policies where tablename = 'corp_node_managers'
      and cmd <> 'SELECT')                                                      as write_policies_expect_0,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('corp_offer_node_manager', 'corp_accept_node_manager',
       'corp_end_node_manager', 'corp_node_manager_list'))                      as fns_expect_4,
  (position('node_manager_fee' in pg_get_functiondef(
     'public.city_owner_ledger_apply(text,numeric,jsonb)'::regprocedure)) > 0)  as split_live_t,
  has_table_privilege('authenticated', 'public.corp_node_managers', 'UPDATE')   as client_can_write_expect_false;
