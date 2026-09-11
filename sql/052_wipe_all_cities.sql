-- ════════════════════════════════════════════════════════════════════════════
-- 052 — WIPE EVERY CITY. Players start over.
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
--
-- 🔴 THIS DESTROYS PLAYER DATA. Every built city in the game is deleted. It is
--    not a migration you re-run casually and it is not idempotent in the way
--    the other files are — the SECOND run is a no-op only because the first one
--    already emptied the tables.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ ORDER OF OPERATIONS — THIS FILE IS THE *SECOND* STEP, NOT THE FIRST
--
--   Deleting these rows on its own WIPES NOTHING. node-city's `B.loadCity`
--   reads the server FIRST and falls back to the browser's local save only when
--   the server returns nothing — and a deleted row is indistinguishable from
--   "no city yet". So the next time a player opens the builder:
--       server: empty  ->  fall back to localStorage  ->  old city restored
--       ...which then saves straight back up to the row you just cleared.
--   The wipe silently fails for every active player while looking like it
--   worked, and the only evidence is the row count creeping back up.
--
--   So the local key was bumped first:
--       public/node-city/index.html   CITYKEY_BASE
--       'mythic_node_city_v1'  ->  'mythic_node_city_v2'      (+ a sweep that
--       deletes the v1 keys outright, so nothing can resurrect them later)
--
--   RUN THIS FILE ONLY ONCE THAT BUILD IS LIVE AND VERIFIED AT THE EDGE.
--   A client still running v1 during the gap will re-upload its city into the
--   freshly emptied table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SCOPE — "cities only", as chosen. Live counts read 2026-08-25:
--     city_state      24 rows   the built city itself: layout, buildings,
--                               economy, population — `state` jsonb is the save
--     city_profiles   36 rows   the city's public identity: name,
--                               specializations, sells/buys, economy_day
--
-- DELIBERATELY NOT TOUCHED, so the world and its politics survive the reset:
--     economy_nodes         33   the SHARED world map (PRN nodes) — not a city
--     city_node_links       42   which player is tied to which node
--     node_mayors           12   who governs what
--     node_payouts          46   pending payouts
--     city_mayor_pay         5
--
-- 🔴 NOT TRUE OF city_trade_offers — AND THIS WAS MISSED ON THE RUN.
--     `city_trade_offers.city_id` is a FOREIGN KEY to `city_profiles` with
--     ON DELETE CASCADE (so is city_trade_agreements, on both of its city
--     columns). Deleting city_profiles therefore deleted all 2459 offers
--     automatically. They were NOT in the chosen scope and they were NOT in the
--     backup above, because the FKs were only read AFTER the delete.
--     The outcome is the one you would have picked anyway — every one of those
--     offers was posted by a city that no longer exists — but it was not a
--     decision, it was a cascade, and that is a different thing.
--     The backup line below now covers it. CHECK THE FOREIGN KEYS BEFORE
--     DELETING A PARENT TABLE:
--       select tc.table_name, rc.delete_rule
--         from information_schema.table_constraints tc
--         join information_schema.referential_constraints rc using (constraint_name)
--         join information_schema.constraint_column_usage ccu using (constraint_name)
--        where tc.constraint_type='FOREIGN KEY' and ccu.table_name = '<parent>';
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. BACKUP FIRST. Non-negotiable: this is the only way back. ─────────────
-- Plain tables, not temp — they must survive the session so the data is still
-- recoverable tomorrow. Drop them by hand once you are happy with the reset.
-- `if not exists` so a re-run cannot clobber a good backup with an empty one.
create table if not exists city_state_backup_20260825    as select * from city_state;
create table if not exists city_profiles_backup_20260825 as select * from city_profiles;
-- ⚠ The CASCADE children. Added after the fact — see the red note in the header.
-- On the real run these were not backed up and 2459 offers were lost with the
-- parent. `if not exists` means adding this line cannot overwrite anything.
create table if not exists city_trade_offers_backup_20260825     as select * from city_trade_offers;
create table if not exists city_trade_agreements_backup_20260825 as select * from city_trade_agreements;

-- Keep the backups out of reach of the client roles entirely. They are a copy
-- of every player's city; anon/authenticated have no business reading them, and
-- a plain `create table` in `public` inherits whatever the bootstrap grant left
-- lying around (see sql/051).
revoke all on public.city_state_backup_20260825            from anon, authenticated;
revoke all on public.city_profiles_backup_20260825         from anon, authenticated;
revoke all on public.city_trade_offers_backup_20260825     from anon, authenticated;
revoke all on public.city_trade_agreements_backup_20260825 from anon, authenticated;

-- ── 2. PROVE THE BACKUP TOOK before deleting anything ───────────────────────
-- If the counts disagree, the transaction aborts and nothing is lost.
do $$
declare
  live_state int; back_state int;
  live_prof  int; back_prof  int;
begin
  select count(*) into live_state from city_state;
  select count(*) into back_state from city_state_backup_20260825;
  select count(*) into live_prof  from city_profiles;
  select count(*) into back_prof  from city_profiles_backup_20260825;

  -- A re-run is fine: live is already 0 and the backup still holds the originals.
  if live_state > 0 and back_state < live_state then
    raise exception 'ABORT: city_state backup has % rows for % live', back_state, live_state;
  end if;
  if live_prof > 0 and back_prof < live_prof then
    raise exception 'ABORT: city_profiles backup has % rows for % live', back_prof, live_prof;
  end if;

  raise notice 'backup verified — city_state %/% · city_profiles %/%',
               back_state, live_state, back_prof, live_prof;
end $$;

-- ── 3. THE WIPE ─────────────────────────────────────────────────────────────
-- DELETE, not TRUNCATE: it is transactional here, it fires any FK/audit
-- triggers the schema has, and sql/051 has just taken TRUNCATE away from the
-- client roles anyway — using it here would model the habit we are removing.
delete from city_state;
delete from city_profiles;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expected: live 0 / 0, backups holding the originals.
select 'city_state'    as t, (select count(*) from city_state)    as live,
       (select count(*) from city_state_backup_20260825)          as backed_up
union all
select 'city_profiles',      (select count(*) from city_profiles),
       (select count(*) from city_profiles_backup_20260825);

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   city_state      24 -> 0    backup holds 24
--   city_profiles   36 -> 0    backup holds 36
--   city_trade_offers 2459 -> 0   BY CASCADE, not backed up (see the header)
--   city_trade_agreements 0 -> 0  by cascade, was already empty
--   kept: economy_nodes 33 · node_mayors 12 · city_node_links 42 · node_payouts 46
--   backups readable by anon/authenticated: 0 grants
--   step 1 (CITYKEY_BASE v2) verified live at the edge BEFORE this ran.
--
-- ── 4. WHAT TO WATCH AFTERWARDS ─────────────────────────────────────────────
-- The honest re-check, a day later: if `city_state` has climbed back above
-- zero, a client on the OLD build restored from localStorage — which means this
-- file was run before the key bump was live. Re-verify the deploy, then re-run.
--     select count(*) from city_state;
