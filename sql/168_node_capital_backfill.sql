-- ═══════════════════════════════════════════════════════════════════════════
-- 168 — EVERY NODE OWNER HAS A CAPITAL. (idempotent, re-runnable)
-- ═══════════════════════════════════════════════════════════════════════════
-- Player report bug-mucvogzk (high, Grimalkin Lord, 2026-09-22): "Since my 2nd
-- Node was linked to my account, my city has hit a brick wall … never gets over
-- 1070 cinder per hour, which is a figure I've been at for weeks … Lids, Clarey
-- and James's cities all started producing vast amounts of cinder at the same
-- time … nothing I do changes it."
--
-- 🔴 WHAT IS ACTUALLY WRONG: HE HAS NO CAPITAL, AND NOR DO MOST NODE OWNERS.
--   index.html: a capital earns 1 + min(0.60, Σ town-share × 0.35) from the
--   towns feeding it (_nodeTownBoost, TOWN_BOOST_CAP 0.60). That function
--   returns a flat 1 for anything that is not role='main'. A player with no
--   main therefore collects the UNBOOSTED base from every node they own, for
--   ever, and nothing in the UI says so — the badge just reads 🏘 TOWN on all
--   of them.
--
--   MEASURED 2026-09-25, before this file:
--     owners with exactly one main ....... 3   (18 nodes)
--     owners with NO main at all ......... 4   (16 nodes)   ← including the reporter
--   The reporter holds five nodes: four 'town', one with no role, zero 'main'.
--   The three owners who DO have a capital are the players he watched pull
--   ahead of him.
--
-- 🔴 WHY IT COULD NEVER FIX ITSELF. Three things line up:
--   1. The capital is only ever set by the player pressing "🏛 Make capital",
--      and that button was broken for a period — it handed TERRITORY-WAR node
--      ids ('N-01') to _nodeMakeCapital, which looks its argument up among PRN
--      rows (economy_nodes.id, a uuid). Every click missed and returned false
--      with no confirm and no toast. index.html's own note: "the badge read
--      🏘 TOWN on every node forever".
--   2. Nothing has ever assigned a role on INSERT, so a node begins roleless.
--   3. _nodeRole() deliberately reads a roleless node as a TOWN, never a main,
--      "because defaulting the other way would give a brand-new node the
--      capital's boost the moment it appeared". That is the right rule, and it
--      also means zero-main is a stable dead end.
--   economy_nodes_one_main_per_owner is a PARTIAL UNIQUE INDEX on (owner_id)
--   where role='main': it enforces AT MOST one capital, never AT LEAST one.
--   The comment in index.html that the database "enforces exactly one" is half
--   true, and this is the half that was missing.
--
-- WHAT THIS DOES: for every owner who has nodes and NO main, promote their
-- OLDEST node (owner's decision, 2026-09-25) to 'main'. Everything else is left
-- exactly as it is — a roleless node already reads as a town, so nothing else
-- needs to move, and the smaller the write the less there is to get wrong.
--
-- ⚠ THE PLAYER STILL CHOOSES. This is a starting capital, not a fixture:
--   "🏛 Make capital" calls node_set_main() and moves it, demoting the old one
--   in the same statement. The owner asked for exactly that — oldest by
--   default, player picks thereafter.
-- ⚠ IT CANNOT CREATE A SECOND CAPITAL. It only touches owners whose main count
--   is 0, so the partial unique index above is never in play; and because of
--   that same filter, re-running it is a no-op.
-- ⚠ IT PAYS NOTHING AND MOVES NO CINDER. It sets one jsonb field. The boost it
--   restores is applied by the client at collect time, from the tiers those
--   towns already have.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

with no_main as (
  select owner_id
    from public.economy_nodes
   where owner_id is not null
   group by owner_id
  having count(*) filter (where meta ->> 'role' = 'main') = 0
), pick as (
  -- oldest first; id breaks a tie so the choice is deterministic and a re-run
  -- would make the same one (four of the reporter's nodes share a created_at).
  select distinct on (n.owner_id) n.id, n.owner_id
    from public.economy_nodes n
    join no_main m on m.owner_id = n.owner_id
   order by n.owner_id, n.created_at asc, n.id asc
)
update public.economy_nodes e
   set meta = jsonb_set(coalesce(e.meta, '{}'::jsonb), '{role}', '"main"'::jsonb, true),
       updated_at = now()
  from pick p
 where e.id = p.id;

commit;

-- ── VERIFY ────────────────────────────────────────────────────────────────
-- owners_without_capital must be 0; every owner must have exactly one.
select
  (select count(*) from (
     select owner_id from public.economy_nodes
      where owner_id is not null
      group by owner_id
     having count(*) filter (where meta ->> 'role' = 'main') = 0) z)    as owners_without_capital,
  (select count(*) from (
     select owner_id from public.economy_nodes
      where owner_id is not null
      group by owner_id
     having count(*) filter (where meta ->> 'role' = 'main') = 1) z)    as owners_with_one_capital,
  (select count(*) from (
     select owner_id from public.economy_nodes
      where owner_id is not null
      group by owner_id
     having count(*) filter (where meta ->> 'role' = 'main') > 1) z)    as owners_with_too_many;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK-ONLY TEST PLAN — paste as ONE query. WRITES NOTHING.
-- It builds its own owner with three roleless nodes, runs the same statement,
-- and RAISEs the results, which aborts the transaction. Run it BEFORE the
-- migration to see the promotion work on a fixture, and AFTER to confirm the
-- real table is already settled (owners_without_capital = 0).
-- ═══════════════════════════════════════════════════════════════════════════
do $plan$
declare
  v_owner uuid;
  v_old   uuid;
  v_mid   uuid;
  v_new   uuid;
  v_res   jsonb := '{}'::jsonb;
  v_mains int;
begin
  select id into v_owner from auth.users
   where not exists (select 1 from public.economy_nodes e where e.owner_id = auth.users.id)
   order by created_at desc limit 1;
  if v_owner is null then
    raise exception '%', jsonb_pretty(jsonb_build_object('skipped', true,
      'why', 'need one auth user who owns no nodes to build the fixture'));
  end if;

  insert into public.economy_nodes (owner_id, corp_id, name, node_type, resource, level, status, meta, created_at)
  values (v_owner, null, 'TEST-168 oldest',  'supply', 'Food', 1, 'active', '{}'::jsonb, now() - interval '3 days')
  returning id into v_old;
  insert into public.economy_nodes (owner_id, corp_id, name, node_type, resource, level, status, meta, created_at)
  values (v_owner, null, 'TEST-168 middle',  'mining', 'Ore',  1, 'active', jsonb_build_object('role','town'), now() - interval '2 days')
  returning id into v_mid;
  insert into public.economy_nodes (owner_id, corp_id, name, node_type, resource, level, status, meta, created_at)
  values (v_owner, null, 'TEST-168 newest',  'mfg',    'Parts',1, 'active', '{}'::jsonb, now() - interval '1 day')
  returning id into v_new;

  select count(*) filter (where meta ->> 'role' = 'main') into v_mains
    from public.economy_nodes where owner_id = v_owner;
  v_res := v_res || jsonb_build_object('before_mains_expect_0', v_mains);

  -- the migration's statement, verbatim
  with no_main as (
    select owner_id from public.economy_nodes
     where owner_id is not null group by owner_id
    having count(*) filter (where meta ->> 'role' = 'main') = 0
  ), pick as (
    select distinct on (n.owner_id) n.id, n.owner_id
      from public.economy_nodes n join no_main m on m.owner_id = n.owner_id
     order by n.owner_id, n.created_at asc, n.id asc
  )
  update public.economy_nodes e
     set meta = jsonb_set(coalesce(e.meta, '{}'::jsonb), '{role}', '"main"'::jsonb, true),
         updated_at = now()
    from pick p
   where e.id = p.id;

  select count(*) filter (where meta ->> 'role' = 'main') into v_mains
    from public.economy_nodes where owner_id = v_owner;
  v_res := v_res || jsonb_build_object('after_mains_expect_1', v_mains);
  v_res := v_res || jsonb_build_object('the_OLDEST_was_promoted_expect_true',
    (select meta ->> 'role' = 'main' from public.economy_nodes where id = v_old));
  v_res := v_res || jsonb_build_object('middle_untouched_still_town_expect_true',
    (select meta ->> 'role' = 'town' from public.economy_nodes where id = v_mid));
  v_res := v_res || jsonb_build_object('newest_left_roleless_expect_true',
    (select (meta ->> 'role') is null from public.economy_nodes where id = v_new));

  -- running it twice must change nothing more
  with no_main as (
    select owner_id from public.economy_nodes
     where owner_id is not null group by owner_id
    having count(*) filter (where meta ->> 'role' = 'main') = 0
  ), pick as (
    select distinct on (n.owner_id) n.id, n.owner_id
      from public.economy_nodes n join no_main m on m.owner_id = n.owner_id
     order by n.owner_id, n.created_at asc, n.id asc
  )
  update public.economy_nodes e
     set meta = jsonb_set(coalesce(e.meta, '{}'::jsonb), '{role}', '"main"'::jsonb, true)
    from pick p
   where e.id = p.id;
  select count(*) filter (where meta ->> 'role' = 'main') into v_mains
    from public.economy_nodes where owner_id = v_owner;
  v_res := v_res || jsonb_build_object('still_one_after_a_second_run_expect_1', v_mains);

  v_res := v_res || jsonb_build_object(
    'PASS', (v_res->>'before_mains_expect_0') = '0'
        and (v_res->>'after_mains_expect_1') = '1'
        and (v_res->>'the_OLDEST_was_promoted_expect_true') = 'true'
        and (v_res->>'middle_untouched_still_town_expect_true') = 'true'
        and (v_res->>'newest_left_roleless_expect_true') = 'true'
        and (v_res->>'still_one_after_a_second_run_expect_1') = '1',
    'note', 'this transaction is about to be rolled back by the raise below — nothing was written');

  raise exception '%', jsonb_pretty(v_res);
end $plan$;
