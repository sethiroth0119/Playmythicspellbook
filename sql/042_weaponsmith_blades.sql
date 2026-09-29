-- ===========================================================================
-- 040 — BLADES. Three forged frames for the Weapon Smith.
--
-- A separate numbered file rather than an edit to 038's insert, because 038
-- may already have been applied by the time these land and a migration that
-- has run is history. Both are idempotent, so applying them in order from
-- scratch gives the same result either way.
--
-- 🔴 THE BUDGETS ARE THE POINT OF THIS FILE. ws_mint clamps to
--    ws_blueprints.budget, so a blade that exists only in the client's
--    blueprints.js would be refused as `unknown_blueprint` -- which is the
--    correct failure, but it means blades simply would not craft. These rows
--    are what make them real, and they carry the SAME benchmarking rule as
--    the guns: a perfect forge ties the shop weapon and never beats it.
--
--      knife       4 -- sw_autopistol (+4 ATK) / sw_combatKnife
--      sword      11 -- pw_relicEdge (+10 ATK, +1 SPD)
--      greatsword 12 -- pw_heavyMaul (+12 ATK)
--
-- ⚠ aza_price is NULL on all three, deliberately. Blades are the craft
--   ladder, not the store: the knife is free with the operation, and the two
--   above it are earned through reputation. Selling a forged frame for cash
--   would make the one part of the feature that is purely about skill into
--   something purchasable.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

insert into public.ws_blueprints (id, name, tier, slot_type, budget, weapon, aza_price, rep_required) values
  ('ws_bp_knife',      'Field Knife',   1, 'secondaryWeapon', 4,  '{"range":1}'::jsonb, null,  0),
  ('ws_bp_sword',      'Arming Sword',  2, 'primeWeapon',     11, '{"range":1}'::jsonb, null, 20),
  ('ws_bp_greatsword', 'Greatsword',    3, 'primeWeapon',     12, '{"range":1}'::jsonb, null, 45)
on conflict (id) do update
  set name = excluded.name, tier = excluded.tier, slot_type = excluded.slot_type,
      budget = excluded.budget, weapon = excluded.weapon,
      aza_price = excluded.aza_price, rep_required = excluded.rep_required;

-- A blade contract, so the board has something to ask a forger for.
insert into public.ws_contract_templates
  (id, client_name, blurb, spec, cinder_min, cinder_max, hours, rep_min, weight) values
  ('c_blade_order', 'The Cold Mouth', 'Steel, not machinery. Bring us something with an edge on it.',
   '{"minAtk":6,"blueprint":"ws_bp_sword"}'::jsonb, 6400, 8800, 36, 20, 8)
on conflict (id) do update
  set client_name = excluded.client_name, blurb = excluded.blurb, spec = excluded.spec,
      cinder_min = excluded.cinder_min, cinder_max = excluded.cinder_max,
      hours = excluded.hours, rep_min = excluded.rep_min, weight = excluded.weight;

-- ===========================================================================
-- VERIFY
-- ===========================================================================

-- 1. All eight frames, and the client copy they must agree with
--    (public/src/weaponsmith/blueprints.js). THIS TABLE WINS on a disagreement.
-- select id, name, tier, slot_type, budget, weapon, aza_price, rep_required
--   from public.ws_blueprints order by slot_type, tier, id;
--   -> guns:   carbine 8 / sidearm 4 / breacher 14 / lance 10 / marksman 14
--   -> blades: knife 4 / sword 11 / greatsword 12

-- 2. 🔴 No blade may be for sale. Blades are the skill ladder, not the store.
--    Zero rows.
--    ⚠ The `id in (...)` MUST be parenthesised against the aza_price test. An
--    earlier draft wrote it as a chain of ORs and `and` bound tighter, so the
--    query counted every blade regardless of price and reported a violation
--    that was not there. A verify query that cries wolf is worse than none.
-- select id, aza_price from public.ws_blueprints
--  where id in ('ws_bp_knife','ws_bp_sword','ws_bp_greatsword')
--    and aza_price is not null;

-- 3. 🔴 The invariant, re-checked now that blades can mint. Zero rows, always.
-- select w.id, w.item_id, w.blueprint_id, b.budget,
--        (select sum((value #>> '{}')::int) from jsonb_each(w.stats)) as spent
--   from public.crafted_weapons w
--   join public.ws_blueprints b on b.id = w.blueprint_id
--  where (select sum((value #>> '{}')::int) from jsonb_each(w.stats)) > b.budget;
-- ===========================================================================
