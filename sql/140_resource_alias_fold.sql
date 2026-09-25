-- ============================================================================
-- 140 — FOLD WAR-MAP RESOURCE KEYS INTO THE REAL RESOURCE IDS (server stores)
-- Project: ktsiasyjusesawtrwrjc
-- Status: APPLIED 2026-09-17, after v121v174 went live. Verify returned zero
--         alias rows; bank (188,199) and ledger (194,067) totals unchanged.
--         Re-run if an alias reappears — it is idempotent.
-- ----------------------------------------------------------------------------
-- Tracker bug-mu4fo0lg: "Electricity resource has been triplicated … All 3
-- should be combined into 1."
--
-- THE CAUSE. The Territory Wars map names node resources in its own vocabulary
-- (_TW_RES_KEYS: FOOD FUEL MED METAL CRYSTAL RELIC ETHER WOOD BIO ELEC, plus
-- the badge keys ENERGY POWER SPARK OIL ORE STONE WATER AQUA GOLD SCRAP). Only
-- four had a mapping to a real resource id; the rest fell back to
-- `.toLowerCase()`, which names nothing in RESOURCES — so a node's ELEC arrived
-- as `elec`. And the Card Shop district dividend (card_shop_node_dividend)
-- handed the node key back RAW, so the same resource also arrived as `ELEC`,
-- and FOOD / FUEL / MED / WOOD arrived uppercase too. Every one of those is a
-- separate "resource" to every screen, which is the three Electricity cards.
--
-- MEASURED BEFORE WRITING (2026-09-17):
--   bank_of_ethos.resources  elec 115 (3) · ether 264 (5) · ETHER 991 (1)
--                            bio 71 (2)   · WOOD 86 (1)
--   user_resources           elec 16 (3)  · ELEC 203 (1) · ether 509 (5)
--                            ETHER 428 (1) · bio 1 (1)
--   (player stashes — user_profiles.forge.__salvage__ — are folded by the
--    CLIENT, deliberately; see WHY NOT THE STASH.)
--
-- THE TARGETS are the client's TW_RES_CANON and src/city/terroir.js's
-- seamAliases, which already made these calls for the fantasy keys:
--   CRYSTAL, RELIC → memoryShards · ETHER → corruptedEssence · BIO → dna
-- ELEC is the one change: terroir had it at energyDrink, a stand-in from before
-- `electricity` existed — the same story its own note tells about WOOD.
--
-- ⚠ ORDER: CLIENT FIRST, THEN THIS. A client older than the fix still
--   deposits `elec` / `ELEC`, and would simply re-create what this folds. Run it
--   once the release carrying the client fold is live, then again if any alias
--   shows up in the verify block — it is idempotent.
--
-- ⚠ WHY NOT THE STASH. user_profiles.forge.__salvage__ is merged on the client
--   with a per-id MAX when the device has no pending edit. A server-side fold
--   there, met by an older local copy still holding `ELEC`, would keep BOTH the
--   local ELEC and the server's already-folded electricity and upload the
--   duplicate. The client fold runs on both sides of that merge before it
--   compares anything, which is the only place the two copies can be made to
--   agree. This file therefore touches only stores the client never max-merges:
--   the bank row (fetched and assigned whole) and the warehouse ledger (topped
--   up from the client, never read back into the stash).
--
-- ⚠ TOTALS ARE PRESERVED. Every fold moves units from an alias id to its
--   canonical id; nothing is created or destroyed. The bank's vault cap and the
--   ledger's per-resource cap are checked on write paths, not by a constraint,
--   and a fold cannot move a total across either.
--
-- Re-runnable.
-- ============================================================================

-- The alias table. Uppercase keys are never real ids. A lowercase form is an
-- alias only where it is NOT itself a real resource (food, fuel, metal, wood,
-- water, ammo, supplies, stone and cloth are real, and are not listed).
create or replace function public._res_alias_map()
returns table(alias text, canon text)
language sql immutable as $fn$
  values
    ('FOOD','food'), ('FUEL','fuel'), ('MED','medicine'), ('med','medicine'), ('MEDICINE','medicine'),
    ('METAL','metal'), ('WOOD','wood'),
    ('CRYSTAL','memoryShards'), ('crystal','memoryShards'),
    ('RELIC','memoryShards'), ('relic','memoryShards'),
    ('ETHER','corruptedEssence'), ('ether','corruptedEssence'),
    ('BIO','dna'), ('bio','dna'),
    ('ELEC','electricity'), ('elec','electricity'),
    ('ENERGY','electricity'), ('energy','electricity'),
    ('POWER','electricity'), ('power','electricity'),
    ('SPARK','electricity'), ('spark','electricity'),
    ('WATER','water'), ('AQUA','water'), ('aqua','water'),
    ('AMMO','ammo'), ('SUPPLIES','supplies'),
    ('STONE','stone'), ('ROCK','stone'), ('rock','stone'),
    ('CLOTH','cloth'), ('FIBER','cloth'), ('fiber','cloth'), ('FIBRE','cloth'), ('fibre','cloth'),
    ('OIL','crudeOil'), ('oil','crudeOil'),
    ('ORE','metal'), ('ore','metal'),
    ('GOLD','goldOre'), ('gold','goldOre'),
    ('SCRAP','metal'), ('scrap','metal')
$fn$;

-- Fold one jsonb { id: qty } map. Pure; a map with no alias comes back equal.
create or replace function public._res_fold_aliases(m jsonb)
returns jsonb
language plpgsql immutable as $fn$
declare
  out jsonb := coalesce(m, '{}'::jsonb);
  a record;
  v numeric;
  cur numeric;
begin
  if jsonb_typeof(out) <> 'object' then return out; end if;
  for a in select * from public._res_alias_map() loop
    if out ? a.alias then
      v := coalesce(floor((out ->> a.alias)::numeric), 0);
      cur := coalesce(floor((out ->> a.canon)::numeric), 0);
      out := (out - a.alias) || jsonb_build_object(a.canon, greatest(cur, 0) + greatest(v, 0));
    end if;
  end loop;
  return out;
exception when others then
  -- A value that will not cast is left exactly as it was: a fold must never be
  -- the reason a bank row fails to load.
  return coalesce(m, '{}'::jsonb);
end $fn$;

-- ── the bank ────────────────────────────────────────────────────────────────
update public.bank_of_ethos b
   set resources = public._res_fold_aliases(b.resources),
       updated_at = now()
 where exists (select 1 from jsonb_object_keys(coalesce(b.resources, '{}'::jsonb)) k
                 join public._res_alias_map() am on am.alias = k);

-- ── the warehouse ledger ────────────────────────────────────────────────────
-- Add each alias row onto its canonical row, then delete the alias rows. One
-- statement per step inside this transaction; the sum is taken per user so two
-- aliases of one resource (elec + ELEC) land together.
with moved as (
  select r.user_id, am.canon, sum(greatest(r.qty, 0)) as qty
    from public.user_resources r
    join public._res_alias_map() am on am.alias = r.resource_id
   group by r.user_id, am.canon
)
insert into public.user_resources (user_id, resource_id, qty, updated_at)
select user_id, canon, qty, now() from moved
on conflict (user_id, resource_id)
do update set qty = public.user_resources.qty + excluded.qty, updated_at = now();

delete from public.user_resources r
 using public._res_alias_map() am
 where am.alias = r.resource_id;

-- ── verify: both should return zero rows ────────────────────────────────────
select 'bank' as store, k as alias, count(*) as rows
  from public.bank_of_ethos b, jsonb_object_keys(coalesce(b.resources,'{}'::jsonb)) k
  join public._res_alias_map() am on am.alias = k
 group by k
union all
select 'ledger', r.resource_id, count(*)
  from public.user_resources r join public._res_alias_map() am on am.alias = r.resource_id
 group by r.resource_id;
