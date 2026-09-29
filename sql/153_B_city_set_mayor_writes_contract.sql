-- ════════════════════════════════════════════════════════════════════════════
-- 153_B · AN IN-CITY "APPOINT NODE MANAGER" WRITES THE CONTRACT THE MANAGER USES
--         DRAFT — NOT APPLIED. Needs the owner's yes (see DECISION below).
--         Idempotent: CREATE OR REPLACE of the sql/148 function, same signature,
--         same grants. Re-runnable. Ends with a verify SELECT.
--
-- REPORTS: bug-mtyo8e66 "When Davos tries to add me to his Aritzal Ascension city
--          as the mayor, he gets the attached error", bug-mtyd8sio "Davos has
--          registered/claimed two new nodes — I am supposed to be mayoring them
--          all, but I can't see them in the Client City list".
--
-- WHAT THE ERROR WAS: the pre-148 city_set_mayor upserted city_state
--   ON CONFLICT (user_id) on a table keyed (user_id, node_id) and raised on every
--   call. sql/148 (applied 2026-09-17) replaced it, so that error is gone.
--
-- WHAT 148 STILL DOES WRONG — MEASURED 2026-09-17 in a rolled-back probe on the
-- live function, as Davos (owner of N-26, where the reporter ALREADY holds the
-- active node_mayors contract):
--     city_set_mayor(<reporter>, 'probe', 500, 'probe', 'N-26')
--       → {"ok": true, "paid": 500}      (500 Cinder taken, a pay row written)
--     node_mayors active rows for the reporter: before 6, after 6
--     city_state: N-26.mayor_id = <reporter>
--   i.e. the in-city appointment charges the owner and writes ONLY
--   city_state.mayor_id — a column nothing reads any more (cityMayorGet, the
--   Client City list, _twIAmMayorOf, _openNodeCity's admission and
--   city_state_can_write all read node_mayors). The appointee never sees the
--   city, and re-appointing the manager who already holds the contract is not
--   refused because 148's "already appointed" test reads that same dead column.
--   Live: 0 city_state rows carry a mayor_id; every one of the 21 active seats
--   came through the Mayor Hall (mayor_accept_offer).
--
-- THE CHANGE (paid hire only; the Remove branch and the unpaid path are 148's):
--   · the caller must OWN the node in tw_node_owners — the same test
--     mayor_accept_offer makes. node_mayors is keyed on node_id alone, so a city
--     on a node the caller does not own must never write that node's contract.
--   · an ACTIVE contract on the node is read first:
--       same manager      → 'that Node Manager is already appointed' (nothing paid)
--       another manager   → 'this node already has a Node Manager under contract'
--                           (a Mayor Hall contract's negotiated terms are never
--                           overwritten by a flat in-city fee)
--   · after the escrow (unchanged) it upserts node_mayors for the node with the
--     table's DEFAULT terms (30 % / CINDER / 20 h / owner / owner), active, and
--     answers `contract: true`. The client (cityMayorSet) reads that flag and
--     tells the owner the city is now in the manager's Client City list; without
--     it, the owner is told the appointment reaches nobody until a Hall offer.
--
-- DECISION FOR THE OWNER: should an in-city appointment create a Node Manager
--   contract at default terms (this file), or should the in-city Appoint button
--   be removed so every hire goes through the Mayor Hall negotiation? Until one
--   of the two ships, the in-city appointment takes 500 Cinder for a seat nobody
--   can use (the client now refuses the "same manager" and "already under
--   contract" cases before paying, and says so after paying).
--
-- RLS: no new table and no policy change. node_mayors keeps its single
--   `node_mayors_read` (select, true) policy and no write policy; this function
--   is SECURITY DEFINER and is the write path, exactly like mayor_accept_offer.
--   city_mayor_pay's policies/grants are 148's and are untouched.
-- ════════════════════════════════════════════════════════════════════════════
begin;

create or replace function public.city_set_mayor(p_mayor_id uuid, p_mayor_name text,
                                                 p_pay integer default 0, p_from text default null,
                                                 p_node_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_amt   bigint := least(100000, greatest(0, coalesce(p_pay, 0)));
  v_paid  boolean;
  v_found boolean;
  v_prev  uuid;
  v_cur   uuid;
  v_take  jsonb;
  v_id    uuid;
  v_n     int;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  v_paid := p_mayor_id is not null and v_amt > 0;

  if v_paid then
    if p_mayor_id = v_uid then raise exception 'you cannot hire yourself'; end if;
    if not exists (select 1 from auth.users u where u.id = p_mayor_id) then
      raise exception 'no such player';
    end if;
    if p_node_id is null then raise exception 'which city? a paid hire must name the node'; end if;
    select true, c.mayor_id into v_found, v_prev
      from public.city_state c
     where c.user_id = v_uid and c.node_id = p_node_id
       for update;
    if not coalesce(v_found, false) then raise exception 'you have no city on that node to hire for'; end if;
    -- 153_B: a contract is the NODE's, so only the node's owner writes one.
    if not exists (select 1 from public.tw_node_owners w
                    where w.node_id = p_node_id and w.user_id = v_uid) then
      raise exception 'you do not own that node — only its owner can appoint its Node Manager';
    end if;
    -- 153_B: the seat that counts is node_mayors, not city_state.mayor_id.
    select m.mayor_id into v_cur
      from public.node_mayors m
     where m.node_id = p_node_id and m.active
       for update;
    if v_cur is not null and v_cur = p_mayor_id then
      raise exception 'that Node Manager is already appointed';
    end if;
    if v_cur is not null then
      raise exception 'this node already has a Node Manager under contract — end that contract first';
    end if;
    if v_prev is not distinct from p_mayor_id then
      raise exception 'that Node Manager is already appointed';
    end if;
  end if;

  update public.city_state c
     set mayor_id = p_mayor_id, mayor_name = left(p_mayor_name, 60), updated_at = now()
   where c.user_id = v_uid and (p_node_id is null or c.node_id = p_node_id);
  get diagnostics v_n = row_count;

  if not v_paid then
    return jsonb_build_object('ok', true, 'paid', 0, 'cities', v_n);
  end if;

  v_take := public._ct_cinder_take(v_uid, v_amt, 'Node Manager hiring pay (escrow)');

  insert into public.city_mayor_pay (user_id, amount, from_name, funded)
  values (p_mayor_id, v_amt, left(coalesce(p_from, ''), 60), true)
  returning id into v_id;

  -- 153_B: the contract. Omitted columns take the table defaults, and the
  -- conflict branch copies those same defaults from `excluded` — an ended
  -- (inactive) row for this node is re-opened with default terms, never with
  -- the terms somebody negotiated for a previous manager.
  insert into public.node_mayors (node_id, mayor_id, owner_id, offer_id, active, started_at, ended_at)
  values (p_node_id, p_mayor_id, v_uid, null, true, now(), null)
  on conflict (node_id) do update
    set mayor_id = excluded.mayor_id, owner_id = excluded.owner_id, offer_id = null,
        player_pct = excluded.player_pct, currency = excluded.currency,
        hours_per_month = excluded.hours_per_month, card_policy = excluded.card_policy,
        resource_policy = excluded.resource_policy, active = true,
        started_at = now(), ended_at = null
    where not public.node_mayors.active;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- An active contract appeared between the check and here: undo everything.
    raise exception 'this node already has a Node Manager under contract — end that contract first';
  end if;

  return jsonb_build_object('ok', true, 'paid', v_amt, 'pay_id', v_id, 'contract', true,
                            'cinder', (v_take->>'balance')::bigint,
                            'wallet_seq', (v_take->>'wallet_seq')::bigint);
end $$;

revoke all on function public.city_set_mayor(uuid, text, integer, text, text) from public, anon;
grant execute on function public.city_set_mayor(uuid, text, integer, text, text) to authenticated;

commit;

-- --- VERIFY. Expect: fn_writes_contract_t = t, fn_checks_tw_owner_t = t,
--     anon_exec_f = f, auth_exec_t = t, node_mayors_rls_t = t,
--     node_mayors_write_policies_expect_0 = 0, client_can_insert_node_mayors_f = f.
select
  (select position('insert into public.node_mayors' in pg_get_functiondef('public.city_set_mayor(uuid,text,integer,text,text)'::regprocedure)) > 0)
                                                                                           as fn_writes_contract_t,
  (select position('tw_node_owners' in pg_get_functiondef('public.city_set_mayor(uuid,text,integer,text,text)'::regprocedure)) > 0)
                                                                                           as fn_checks_tw_owner_t,
  has_function_privilege('anon', 'public.city_set_mayor(uuid,text,integer,text,text)', 'EXECUTE')          as anon_exec_f,
  has_function_privilege('authenticated', 'public.city_set_mayor(uuid,text,integer,text,text)', 'EXECUTE') as auth_exec_t,
  (select relrowsecurity from pg_class where oid = 'public.node_mayors'::regclass)          as node_mayors_rls_t,
  (select count(*) from pg_policies where tablename = 'node_mayors' and cmd <> 'SELECT')    as node_mayors_write_policies_expect_0,
  has_table_privilege('authenticated', 'public.node_mayors', 'INSERT')
    and exists (select 1 from pg_policies where tablename = 'node_mayors' and cmd in ('INSERT','ALL'))
                                                                                           as client_can_insert_node_mayors_f;
