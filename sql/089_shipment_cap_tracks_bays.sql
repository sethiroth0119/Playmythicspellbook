-- ════════════════════════════════════════════════════════════════════════════
-- 089 · THE SHIPMENT CAP FOLLOWS THE BAYS IT IS SUPPOSED TO SERVE.
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 THE DEFECT, IN ONE LINE: bays got ten times bigger and the truck did not.
--
--    max_shipment_kg was 1,800, and its original sizing was sound — a tier-1
--    warehouse was 4 bays x 500 kg = 2,000 kg, so one shipment carried ~90% of
--    a starter warehouse. sql/083 raised the tier-1 bay floor from 500 to
--    5,000, which makes a tier-1 warehouse 20,000 kg. The cap stayed at 1,800.
--
--    What that means for a player today:
--        fill one tier-1 BAY      (5,000 kg) ......  3 shipments
--        fill a tier-1 WAREHOUSE (20,000 kg) ...... 12 shipments
--        fill a tier-5 WAREHOUSE (480,000 kg) .... 267 shipments
--    083 flagged this deliberately ("raising the per-shipment limit is a
--    separate design call") and left it. This is that call.
--
-- ⭐ THE FIX IS THE ORIGINAL RATIO, RESTORED EXACTLY — not a new number picked
--    to feel right. 90% of a tier-1 warehouse, which is what 1,800 was against
--    2,000: wh_bay_floor(1) x 4 bays x 0.9 = 5,000 x 4 x 0.9 = 18,000 kg.
--
-- 🔴 AND IT IS DERIVED, NOT A LITERAL, BECAUSE THAT IS THE ACTUAL BUG. A second
--    hard-coded number that has to be remembered whenever the first one changes
--    is how 1,800 came to be six months stale. wh_bay_floor(1) is the single
--    source; move the bay floors again and the shipment cap moves itself.
--    (The same reasoning the stash floor states: "still derived, not a literal,
--    so this stays one edit".)
--
-- ⚠ WHAT THIS DOES NOT CHANGE. Lifter carry_kg is untouched — that is a
--   PERSON's carrying capacity, a different limit with its own ladder, and
--   scaling it here would silently retune the lifter shop nobody asked about.
--   Bay capacity, tier prices, rents and ETAs are all untouched.
--
-- SAFE TO RE-RUN. One function, one key.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.wh_config()
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'aza_to_cinder', 5000,
    'start_units', 2,
    'unit_price_aza', 10,
    'unit_price_cinder', 5000000,
    'unit_capacity_kg', public.wh_bay_floor(1),
    'bay_floor_by_tier', jsonb_build_object(
      '1', public.wh_bay_floor(1), '2', public.wh_bay_floor(2),
      '3', public.wh_bay_floor(3), '4', public.wh_bay_floor(4),
      '5', public.wh_bay_floor(5)),
    'tiers', jsonb_build_array(
      jsonb_build_object('tier', 1, 'max_units', 4,  'aza', 0,   'cinder', 0,         'name', 'Lean-To Depot'),
      jsonb_build_object('tier', 2, 'max_units', 8,  'aza', 25,  'cinder', 12500000,  'name', 'Sheet-Metal Warehouse'),
      jsonb_build_object('tier', 3, 'max_units', 14, 'aza', 60,  'cinder', 30000000,  'name', 'Concrete Distribution Hub'),
      jsonb_build_object('tier', 4, 'max_units', 22, 'aza', 140, 'cinder', 70000000,  'name', 'Regional Freight Terminal'),
      jsonb_build_object('tier', 5, 'max_units', 32, 'aza', 300, 'cinder', 150000000, 'name', 'Ashfall Logistics Yard')
    ),
    'lifters', jsonb_build_array(
      jsonb_build_object('tier', 0, 'carry_kg', 25,  'aza', 0,  'cinder', 0,        'name', 'Bare Hands',  'icon', '🖐'),
      jsonb_build_object('tier', 1, 'carry_kg', 45,  'aza', 2,  'cinder', 1000000,  'name', 'Back Brace',  'icon', '🎽'),
      jsonb_build_object('tier', 2, 'carry_kg', 90,  'aza', 5,  'cinder', 2500000,  'name', 'Hand Truck',  'icon', '🛒'),
      jsonb_build_object('tier', 3, 'carry_kg', 180, 'aza', 12, 'cinder', 6000000,  'name', 'Pallet Jack', 'icon', '🛠'),
      jsonb_build_object('tier', 4, 'carry_kg', 400, 'aza', 30, 'cinder', 15000000, 'name', 'Forklift',    'icon', '🚜')
    ),
    'weights', jsonb_build_object(
      'food', 1.2, 'water', 2.0, 'ammo', 0.8, 'medicine', 0.4, 'energyDrink', 0.5,
      'supplies', 1.5, 'metal', 3.5, 'fuel', 3.0,
      'corruptedEssence', 0.6, 'memoryShards', 0.2, 'dna', 0.1
    ),
    'default_weight', 1.0,
    'crate_kg', 22,
    -- 🚚 ONE SHIPMENT ≈ 90% OF A STARTER WAREHOUSE, which is exactly what 1,800
    -- meant when a tier-1 bay was 500 kg. Derived from the bay floor so it can
    -- never go stale behind it again: 5,000 x 4 bays x 0.9 = 18,000 kg.
    'max_shipment_kg', (public.wh_bay_floor(1) * 4 * 9 / 10)::int,
    'eta_hours', jsonb_build_object(
      '0', 72, '1', 68, '2', 62, '3', 56, '4', 50, '5', 44,
      '6', 37, '7', 30, '8', 22, '9', 14, '10', 6
    ),
    'free_city_hours', 72,
    'max_hours', 72,
    'rent_cinder_per_day', 120000,
    'renew_terms', jsonb_build_array(7, 30, 60, 90),
    'rent_max_days', 90,
    -- ⏳ 24 HOURS, not three days: the window between a rental lapsing and the
    -- owner being allowed to impound. The renter's time to pull goods or renew.
    'rent_grace_days', 1
  );
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   max_shipment_kg   = 18000
--   tier1_warehouse   = 20000   (4 bays x the tier-1 floor)
--   trips_to_fill_t1  = 2       ← was 12
--   bay_floor_1       = 5000    unchanged
--   forklift_carry_kg = 400     unchanged — a person, not a truck
-- ════════════════════════════════════════════════════════════════════════════
select
  (public.wh_config()->>'max_shipment_kg')::int                        as max_shipment_kg,
  (public.wh_bay_floor(1) * 4)                                         as tier1_warehouse,
  ceil((public.wh_bay_floor(1) * 4)::numeric
       / (public.wh_config()->>'max_shipment_kg')::numeric)::int       as trips_to_fill_t1,
  public.wh_bay_floor(1)                                               as bay_floor_1,
  (public.wh_config()->'lifters'->4->>'carry_kg')::int                 as forklift_carry_kg;
