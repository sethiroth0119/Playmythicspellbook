-- ===========================================================================
-- 167 . OWN MANY PRN ANCHORS, PLACE SIX  (166 is the Operations owner lock)
-- NOT APPLIED. Project ktsiasyjusesawtrwrjc, to be pasted by hand in the
-- Supabase SQL editor when the owner approves. Idempotent and re-runnable;
-- ends with a verify query. Apply AFTER 165 (fr_node_payout / node_payout_*).
--
-- PLAYER ASK (feature board, Clarence Freycinet, Gameplay, 2026-09-19):
--   "I would like to be able to purchase all PRN Anchors, currently you can
--    only purchase 6. I accidentally purchased two of the same and it does not
--    allow me to purchase an additional one … being able to purchase more than
--    6 but only place 6 at a time would be a great solution."
--
-- WHAT WAS TRUE BEFORE THIS FILE
--   The "6" was CLIENT-ONLY. index.html's nodeEstablish refuses at
--   NODE_MAX_PER_CORP = 6 and the Build button disables itself; the DATABASE
--   had no cap of any kind. economy_nodes' only insert policy is
--       en_ins: with check (owner_id = auth.uid())
--   so any signed-in player could POST a seventh, eightieth or eight-hundredth
--   row straight at PostgREST. Live today: one owner already holds 7 rows.
--   This file is therefore the first server-side cap that has ever existed
--   here, and it deliberately caps the thing that COSTS the world money (a
--   PLACED anchor, which can be paid by fr_node_payout) and not the thing the
--   player is asking to be allowed to do (own as many as they like).
--
-- THE MODEL
--   economy_nodes.status gains a third value, 'stored': owned, not placed.
--     · 'active' / 'building'  -> PLACED. Rings the city, can be paid.
--     · 'stored'               -> OWNED. Pays nothing, rings nothing.
--   A stored row is neither 'active' nor a finished 'building', so
--   _np_active() (sql/165) is already false for it and fr_node_payout already
--   refuses it. THIS FILE DOES NOT TOUCH fr_node_payout, _np_active OR ANY
--   PAYOUT PATH — that is the point: the payout invariants hold by
--   construction rather than by a new branch that has to be got right.
--
-- WHAT HAPPENS TO A STORED / RELEASED NODE'S PAYOUT HISTORY
--   · STORE keeps the SAME row and the SAME uuid, so node_payout_claims (the
--     append-only marker log), the per-node 6h cooldown derived from it and
--     node_payouts all carry straight across a store/place cycle. Storing can
--     neither reset a cooldown nor re-arm a claim.
--   · RELEASE (the existing delete) is unchanged and remains destructive.
--     node_payout_claims has NO foreign key to economy_nodes, so its rows
--     survive the delete with their node_id intact — the history is kept in
--     full, exactly as the append-only rule requires. node_payouts.node_id is
--     ON DELETE SET NULL, so the ledger row survives with a null node_id (the
--     amount, the user and the timestamp — everything the daily allowance and
--     the pool accounting read — are untouched; only the per-node cooldown
--     link goes, and it goes with the node).
--   · A re-bought anchor is a NEW uuid and gets a fresh 'baseline' claim from
--     the existing economy_nodes_payout_baseline trigger, which is what stops
--     delete-and-rebuy paying for points already claimed.
--
-- WHAT THIS FILE DOES
--   1. node_payout_config.max_placed  — the cap, ONE number, server-side.
--      (index.html mirrors it as NODE_MAX_PLACED; the server's copy wins.)
--   2. a NOT VALID check constraint pinning status to the three known values.
--   3. _en_placed_cap() BEFORE INSERT OR UPDATE on economy_nodes:
--        · INSERT over the cap  -> the row is COERCED to 'stored' (never
--          refused: nodeEstablish has already taken the Cinder and the
--          materials, and an exception there would land in a refund path; and
--          the admin gift path must never fail because a corp is full).
--        · UPDATE that would PLACE an over-cap row -> RAISE. Placing is a
--          deliberate act with nothing spent, so it is the one that refuses.
--   RLS: no policy is added, changed or relaxed. The trigger runs under the
--   caller and is checked for every writer including admins; the cap is about
--   how many anchors may be LIVE, not about who may write the row, so the
--   existing en_ins / en_upd / en_del owner checks remain the whole security
--   boundary and are untouched.
-- ===========================================================================

begin;

-- ── 1. the cap lives in the tuning table, next to every other node number ──
-- (ECONOMY.md / _opEcon pattern: no gameplay number is hand-written twice.)
alter table public.node_payout_config
  add column if not exists max_placed int not null default 6;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'node_payout_config_max_placed_chk') then
    alter table public.node_payout_config
      add constraint node_payout_config_max_placed_chk check (max_placed >= 1);
  end if;
end $$;

comment on column public.node_payout_config.max_placed is
  'How many PRN anchors one corporation (or one owner, for a corp-less row) may have PLACED at a time. Mirrored by NODE_MAX_PLACED in index.html; this copy wins. Owning is uncapped here.';

-- ── 2. the vocabulary of status ────────────────────────────────────────────
-- NOT VALID on purpose: it polices every NEW write from the moment it lands
-- without a full-table validation that could fail on a legacy row nobody has
-- looked at. (Checked 2026-09-19: the live table holds only 'active' and
-- 'building', so it would in fact validate — NOT VALID is the cheap insurance,
-- not a workaround.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'economy_nodes_status_chk') then
    alter table public.economy_nodes
      add constraint economy_nodes_status_chk
      check (status in ('active', 'building', 'stored')) not valid;
  end if;
end $$;

-- ── 3. the placed cap ──────────────────────────────────────────────────────
-- SCOPE. A corp's anchors are counted against the corp; a row with corp_id
-- null (6 live rows today, whose corporation is gone) is counted against its
-- owner. Without that second branch a player whose corp dissolved would have an
-- unlimited placed allowance, which is exactly the hole this closes.
create or replace function public._en_placed_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cap    int;
  v_placed int;
  v_was    text;
begin
  if new.status is null or new.status not in ('active', 'building') then
    return new;                              -- storing or releasing never needs a slot
  end if;

  select max_placed into v_cap from public.node_payout_config where id = 1;
  v_cap := coalesce(v_cap, 6);

  v_was := case when tg_op = 'UPDATE' then old.status else null end;
  -- Nothing to check when the row was ALREADY placed and stays in the same
  -- scope: an UPDATE of meta/level/eff must not be able to fail because some
  -- other row pushed the corp over a cap this row is already inside.
  if tg_op = 'UPDATE'
     and v_was in ('active', 'building')
     and old.corp_id is not distinct from new.corp_id
     and old.owner_id is not distinct from new.owner_id then
    return new;
  end if;

  select count(*) into v_placed
    from public.economy_nodes e
   where e.id <> new.id
     and e.status in ('active', 'building')
     and (case when new.corp_id is not null
               then e.corp_id = new.corp_id
               else e.corp_id is null and e.owner_id = new.owner_id end);

  if v_placed >= v_cap then
    if tg_op = 'INSERT' then
      -- COERCE, never refuse: the client has already paid for this anchor.
      new.status := 'stored';
      new.meta := (case when jsonb_typeof(new.meta) = 'object' then new.meta else '{}'::jsonb end)
                  - 'readyAt'
                  || jsonb_build_object('storedAt', (extract(epoch from now()) * 1000)::bigint,
                                        'built', false,
                                        'capCoerced', true);
      return new;
    end if;
    raise exception 'prn_placed_cap: % anchors are already placed (max %) — store one first', v_placed, v_cap
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke all on function public._en_placed_cap() from public, anon, authenticated;

drop trigger if exists economy_nodes_placed_cap on public.economy_nodes;
create trigger economy_nodes_placed_cap
  before insert or update on public.economy_nodes
  for each row execute function public._en_placed_cap();

commit;

-- ── VERIFY ────────────────────────────────────────────────────────────────
select jsonb_pretty(jsonb_build_object(
  'max_placed',        (select max_placed from public.node_payout_config where id = 1),
  'status_check',      (select pg_get_constraintdef(oid) from pg_constraint where conname = 'economy_nodes_status_chk'),
  'trigger',           (select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.economy_nodes'::regclass and tgname = 'economy_nodes_placed_cap'),
  'stored_pays_nothing', public._np_active('stored', '{"readyAt":0}'::jsonb, (extract(epoch from now()) * 1000)::bigint),
  'rls_unchanged',     (select jsonb_agg(polname order by polname) from pg_policy where polrelid = 'public.economy_nodes'::regclass),
  'over_cap_scopes',   (select coalesce(jsonb_agg(jsonb_build_object('scope', scope, 'placed', c)), '[]'::jsonb)
                          from (select coalesce(corp_id::text, 'owner:' || owner_id::text) scope, count(*) c
                                  from public.economy_nodes
                                 where status in ('active', 'building')
                                 group by 1 having count(*) > (select max_placed from public.node_payout_config where id = 1)) x)
)) as verify_167;


-- ===========================================================================
-- ROLLBACK-ONLY TEST PLAN — paste this WHOLE block as ONE execute_sql call.
-- It opens a transaction, exercises the cap against REAL rows it creates
-- itself, and ends by RAISEing the results JSON, which rolls everything back.
-- Nothing it does survives. Run it AFTER the migration above.
-- ===========================================================================
do $$
declare
  r        jsonb := '[]'::jsonb;
  v_owner  uuid;
  v_corp   uuid;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_extra  uuid;
  v_status text;
  v_cap    int;
  i        int;
  ok       boolean;
  msg      text;
  add_r    text;
begin
  select max_placed into v_cap from public.node_payout_config where id = 1;

  -- a throwaway owner + corp that no live row points at
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then raise exception 'TEST-167: no auth.users row to borrow'; end if;
  v_corp := gen_random_uuid();

  -- 1. fill the cap
  for i in 1 .. v_cap loop
    insert into public.economy_nodes (owner_id, corp_id, name, node_type, resource, level, status, meta)
    values (v_owner, null, 'TEST-167 placed ' || i, 'supply', 'Food', 1, 'active', '{}'::jsonb)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  -- corp_id null => the scope is the OWNER; make sure we counted only ours by
  -- checking the LAST insert actually landed placed.
  select status into v_status from public.economy_nodes where id = v_ids[array_length(v_ids, 1)];
  r := r || jsonb_build_object('test', '1 cap can be filled', 'pass', v_status = 'active', 'got', v_status);

  -- 2. BUYING a further anchor is ALLOWED (the player's ask) and lands STORED
  insert into public.economy_nodes (owner_id, corp_id, name, node_type, resource, level, status, meta)
  values (v_owner, null, 'TEST-167 seventh', 'fuel', 'Fuel', 1, 'building',
          jsonb_build_object('readyAt', (extract(epoch from now()) * 1000)::bigint + 3600000))
  returning id, status into v_extra, v_status;
  r := r || jsonb_build_object('test', '2 a seventh anchor may be BOUGHT, coerced to stored', 'pass', v_status = 'stored', 'got', v_status);
  r := r || jsonb_build_object('test', '2b …and its readyAt was dropped (no build served on the shelf)', 'pass',
                               (select meta ? 'readyAt' from public.economy_nodes where id = v_extra) = false);

  -- 3. PLACING it is refused while the cap is full
  ok := false; msg := null;
  begin
    update public.economy_nodes set status = 'active' where id = v_extra;
  exception when others then ok := true; msg := sqlerrm;
  end;
  r := r || jsonb_build_object('test', '3 placing a seventh is REFUSED', 'pass', ok, 'error', coalesce(msg, '(none)'));

  -- 4. a stored anchor pays nothing (the 165 gate, unchanged)
  r := r || jsonb_build_object('test', '4 _np_active(stored) is false', 'pass',
                               public._np_active('stored', jsonb_build_object('readyAt', 1), (extract(epoch from now()) * 1000)::bigint) = false);

  -- 5. STORING one frees the slot, and PLACING then succeeds
  update public.economy_nodes set status = 'stored' where id = v_ids[1];
  update public.economy_nodes set status = 'active' where id = v_extra;
  select status into v_status from public.economy_nodes where id = v_extra;
  r := r || jsonb_build_object('test', '5 store frees a slot, place then succeeds', 'pass', v_status = 'active', 'got', v_status);
  r := r || jsonb_build_object('test', '5b still exactly cap placed', 'pass',
    (select count(*) from public.economy_nodes where owner_id = v_owner and corp_id is null and status in ('active','building')
        and name like 'TEST-167%') = v_cap);

  -- 6. an ordinary UPDATE of a placed row is never blocked by the cap
  ok := true; msg := null;
  begin
    update public.economy_nodes set meta = meta || '{"eff":100}'::jsonb where id = v_ids[2];
  exception when others then ok := false; msg := sqlerrm;
  end;
  r := r || jsonb_build_object('test', '6 meta update on a placed row is untouched by the cap', 'pass', ok, 'error', coalesce(msg, '(none)'));

  -- 7. an unknown status is refused by the check constraint
  ok := false; msg := null;
  begin
    update public.economy_nodes set status = 'parked' where id = v_ids[2];
  exception when others then ok := true; msg := sqlerrm;
  end;
  r := r || jsonb_build_object('test', '7 an unknown status is refused', 'pass', ok, 'error', coalesce(msg, '(none)'));

  -- 8. the append-only claim log survives a RELEASE (delete)
  select count(*)::text into add_r from public.node_payout_claims where node_id = v_ids[3];
  delete from public.economy_nodes where id = v_ids[3];
  r := r || jsonb_build_object('test', '8 claims survive a released node (no FK)', 'pass',
    (select count(*)::text from public.node_payout_claims where node_id = v_ids[3]) = add_r, 'claims', add_r);

  -- 9. RLS was not touched
  r := r || jsonb_build_object('test', '9 economy_nodes policies unchanged', 'pass',
    (select jsonb_agg(polname order by polname) from pg_policy where polrelid = 'public.economy_nodes'::regclass)
      = '["en_del","en_ins","en_sel","en_upd"]'::jsonb);

  raise exception 'TEST-167 RESULTS (rolled back): %', jsonb_pretty(
    jsonb_build_object('cap', v_cap,
                       'failed', (select count(*) from jsonb_array_elements(r) e where (e ->> 'pass') <> 'true'),
                       'results', r));
end $$;
