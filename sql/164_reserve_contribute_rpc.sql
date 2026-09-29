-- ===========================================================================
-- 164 . FOUNDATION RESERVE: THE CONTRIBUTION REWARD IS PAID BY THE SERVER
-- APPLIED 2026-09-19 (apply_migration 164_reserve_contribute_rpc; test plan 23/23, rolled back). Project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
-- Apply AFTER 159 (it reuses cinder_reward_caps / cinder_reward_days as the
-- owner's single place to tune a Cinder ceiling and as the per-day lock row)
-- and 048 (_ct_cinder_give, the canonical definer credit).
--
-- OWNER-APPROVED CHANGE (2026-09-19): "move the Foundation Reserve Contribute
-- Cinder reward to the server".
--
-- WHAT WAS WRONG. frDeposit (index.html) debited the vault, then did a
-- read-then-write upsert of reserve_contributions (qty and points computed
-- ON THE CLIENT), then paid the reward with addCinders(round(points * 0.5))
-- — the client decided both the rep and the Cinder. frConvoyTick did the
-- same for convoy arrivals. rc_ins / rc_upd let any signed-in player write
-- their own row to any qty / points straight through PostgREST (sql/038's
-- header already names this as the reason Influence cannot trust `points`).
-- ~2.5M Cinder was paid this way (sum(points) * 0.5 = 2,504,243 on
-- 2026-09-19, 17 contributors, 718 rows).
--
-- THE CHANGE
--   * fr_contribute(res, qty, nonce[, specialty]) and
--     fr_convoy_deliver(res, qty, nonce[, specialty]) are the ONLY writers of
--     reserve_contributions. The server computes the points and the Cinder
--     from its own tables, upserts the row atomically
--     (INSERT … ON CONFLICT DO UPDATE qty = qty + excluded.qty — no read-then-
--     write race), and credits through _ct_cinder_give (user_progress.cinder
--     + the gems mirror + one wallet_ledger 'credit' row — the same path
--     sql/159's rewards use). It returns the canonical balance.
--   * rc_ins / rc_upd are DROPPED and insert/update/delete are revoked, so the
--     table is read-only to players (rc_sel is kept: the leaderboard, Reserve
--     Powers, player search and Influence all read it).
--   * IDEMPOTENT PER NONCE. reserve_contribution_log (append-only) holds one
--     row per (user, nonce). A retried call — the first response was lost to a
--     timeout — returns the ORIGINAL result (already: true, the same credited
--     amount) and moves nothing. A nonce re-used with different arguments is
--     refused ('nonce_conflict').
--   * SIZE / RATE. qty must be 1 .. reserve_config.max_qty_per_call, and the
--     Cinder paid per player per UTC day is bounded by
--     cinder_reward_caps['reserve'] (a partial last reward, like sql/159). The
--     contribution itself is still recorded in full when the day's Cinder is
--     used up — the units were given, only the Cinder is clamped.
--
-- 🔴 THE SERVER DOES NOT DEBIT THE VAULT, AND THAT IS DELIBERATE.
--   The vault (user_profiles.forge.__salvage__) is written whole by the client
--   on every save; the server does not own it. A server-side debit would be
--   overwritten by the next client save of the pre-debit copy (the device
--   still holds it), or undone by the salvage max-merge on hydration — i.e. a
--   server debit is a debit that silently comes back, which is exactly the
--   donate-dupe of 0677e2c084. The patched client keeps the proven order:
--   debit locally, SAVE the debit (cloudSyncProfile, declared through
--   forge.__vaultSpend__ so sql/162's up_guard lets it through) and only then
--   call this function; a save that fails is undone locally and nothing is
--   sent. What that leaves unverifiable: a client that skips the debit and
--   calls the RPC directly. That is bounded here — per call by
--   max_qty_per_call and per day by the 'reserve' Cinder ceiling — which is
--   strictly tighter than today, where the same client could write any
--   points and pay itself any Cinder.
--
-- THE NUMBERS — THE SERVER COPY WINS. reserve_resources / reserve_events /
--   reserve_config mirror index.html's SALVAGE_RES ids, RESERVE_WEIGHTS
--   (+ RESERVE_WEIGHT_DEFAULT), RESERVE_EVENTS, FR_EVENT_WINDOW_MS, the
--   1.6 emergency / 1.35 specialty / 2.4 cap multipliers, FR_CONVOY_BONUS and
--   the 0.5 Cinder-per-point rate. `node .gauntlet/reserve-drift-smoke.mjs`
--   fails if the seed below and the client drift. Seeds are ON CONFLICT DO
--   NOTHING so a figure the owner tuned survives a re-run.
--   * Forge-authored resources (card_catalog singleton
--     moves.__custom_resources__) are accepted at the default weight, as the
--     client accepts them. None exist on 2026-09-19.
--   * The world event is DERIVED exactly as the client derives it: _fr_hash is
--     a port of _frHash (index.html), fed the 6-hour UTC window; the verify
--     query checks it against values computed by the JS function.
--   * Camp specialty (+35%) is a free, unpriced client setting
--     (Profile.reserveSpecialty, never saved to the cloud row), so the client
--     names it (p_specialty) and the server honours it only when it equals the
--     contributed resource AND that resource is specialty_ok (a product
--     recipe input — the only ids the picker offers). Naming it therefore
--     grants nothing an honest player cannot select in one click.
--
-- ⚠ CASH-OUT: Cinder paid here is cashable, as it was when the client paid it.
-- ⚠ reserve_consumption (frBuyProduct) keeps its own client insert policy; not
--   in scope.
-- RLS: every new table has RLS on and its policies in this file. No player
--   INSERT/UPDATE/DELETE policy anywhere — writes come only from the definer
--   functions below.
-- ===========================================================================

begin;

-- 0. Dependencies — fail loudly rather than half-apply.
do $d$ begin
  if to_regclass('public.cinder_reward_caps') is null or to_regclass('public.cinder_reward_days') is null then
    raise exception '164 needs sql/159 (cinder_reward_caps / cinder_reward_days) applied first';
  end if;
  if to_regprocedure('public._ct_cinder_give(uuid,bigint,text)') is null then
    raise exception '164 needs public._ct_cinder_give(uuid,bigint,text) (sql/048)';
  end if;
  if to_regclass('public.reserve_contributions') is null then
    raise exception '164 needs public.reserve_contributions (FOUNDATION_RESERVE_SQL)';
  end if;
end $d$;

-- --------------------------------------------------------------------------
-- 1. Tuning — one row. Mirrors index.html; THE SERVER COPY WINS.
-- --------------------------------------------------------------------------
create table if not exists public.reserve_config (
  id                 int primary key default 1 check (id = 1),
  enabled            boolean not null default true,
  cinder_per_point   numeric not null check (cinder_per_point >= 0),     -- frDeposit: round(gained * 0.5)
  min_reward         bigint  not null check (min_reward >= 0),           -- frDeposit: Math.max(1, …)
  weight_default     numeric not null check (weight_default > 0),        -- RESERVE_WEIGHT_DEFAULT
  emergency_mul      numeric not null check (emergency_mul >= 1),        -- crisis resource bonus
  specialty_mul      numeric not null check (specialty_mul >= 1),        -- camp specialty bonus
  mul_cap            numeric not null check (mul_cap >= 1),              -- Math.min(2.4, …)
  convoy_mul         numeric not null check (convoy_mul >= 1),           -- FR_CONVOY_BONUS
  event_window_ms    bigint  not null check (event_window_ms > 0),       -- FR_EVENT_WINDOW_MS
  max_qty_per_call   int     not null check (max_qty_per_call > 0),      -- size sanity (server only)
  note               text
);
insert into public.reserve_config (id, enabled, cinder_per_point, min_reward, weight_default, emergency_mul,
                                   specialty_mul, mul_cap, convoy_mul, event_window_ms, max_qty_per_call, note)
values (1, true, 0.5, 1, 2, 1.6, 1.35, 2.4, 1.5, 21600000, 100000,
        'Mirrors index.html (drift: node .gauntlet/reserve-drift-smoke.mjs). max_qty_per_call is server-only: the largest live row is 97,590 units lifetime.')
on conflict (id) do nothing;

-- The per-resource point weight. Every SALVAGE_RES id (the ids frDeposit
-- accepts); weight = RESERVE_WEIGHTS[id] ?? RESERVE_WEIGHT_DEFAULT.
-- specialty_ok = a RESERVE_PRODUCTS recipe input (the specialty picker's list).
create table if not exists public.reserve_resources (
  res_id        text primary key check (res_id ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  weight        numeric not null check (weight > 0),
  specialty_ok  boolean not null default false,
  enabled       boolean not null default true
);
insert into public.reserve_resources (res_id, weight, specialty_ok) values
  ('ammo', 1, true),
  ('metal', 1, true),
  ('water', 1, true),
  ('food', 1, true),
  ('supplies', 1, true),
  ('medicine', 3, true),
  ('fuel', 3, true),
  ('corruptedEssence', 6, true),
  ('memoryShards', 8, true),
  ('dna', 6, true),
  ('diesel', 2, false),
  ('kerosene', 2, false),
  ('naphtha', 2, false),
  ('butane', 2, false),
  ('scrapMetal', 2, false),
  ('demonCores', 2, false),
  ('relicFragments', 2, false),
  ('etherCrystals', 2, false),
  ('bioMatter', 2, false),
  ('ancientDataDrives', 2, false),
  ('foodSupplies', 2, false),
  ('medicalSupplies', 2, false),
  ('ammunition', 2, false),
  ('constructionMaterials', 2, false),
  ('powerCells', 2, false),
  ('researchData', 2, false),
  ('contraband', 2, false),
  ('corruptedArtifacts', 2, false),
  ('heroShards', 2, false),
  ('anomalyEssence', 2, false),
  ('soulEnergy', 2, false),
  ('mutationStrands', 2, false),
  ('quantumDust', 2, false),
  ('divineSigils', 2, false),
  ('chaosFragments', 2, false),
  ('memoryEchoes', 2, false),
  ('wood', 2, false),
  ('stone', 2, false),
  ('cloth', 2, false),
  ('leather', 2, false),
  ('ironOre', 2, false),
  ('copperWiring', 2, false),
  ('steelPlating', 2, false),
  ('mechanicalParts', 2, false),
  ('circuitBoards', 2, false),
  ('reactorComponents', 2, false),
  ('waterSupplies', 2, false),
  ('seeds', 2, false),
  ('fertilizer', 2, false),
  ('chemicals', 2, false),
  ('glassShards', 2, false),
  ('plasticComponents', 2, false),
  ('boneFragments', 2, false),
  ('monsterHide', 2, false),
  ('toxicWaste', 2, false),
  ('radioactiveMaterial', 2, false),
  ('frozenCores', 2, false),
  ('lavaFragments', 2, false),
  ('shadowEssence', 2, false),
  ('lightEssence', 2, false),
  ('crystalDust', 2, false),
  ('salvagedTech', 2, false),
  ('aiChips', 2, false),
  ('droneParts', 2, false),
  ('generatorParts', 2, false),
  ('toolKits', 2, false),
  ('weaponParts', 2, false),
  ('armorFragments', 2, false),
  ('survivorManuals', 2, false),
  ('energyGel', 2, false),
  ('batteryCells', 2, false),
  ('militaryRations', 2, false),
  ('medicalHerbs', 2, false),
  ('blackMarketTokens', 2, false),
  ('containmentCells', 2, false),
  ('ritualCandles', 2, false),
  ('ancientCoins', 2, false),
  ('goldBars', 2, false),
  ('silverFragments', 2, false),
  ('campSupplies', 2, false),
  ('survivalGear', 2, false),
  ('tacticalEquipment', 2, false),
  ('signalTransmitters', 2, false),
  ('radarComponents', 2, false),
  ('securityModules', 2, false),
  ('bunkerKeys', 2, false),
  ('dataFragments', 2, false),
  ('expeditionMaps', 2, false),
  ('creatureEggs', 2, false),
  ('fusionMaterials', 2, false),
  ('beastHearts', 2, false),
  ('plantSpores', 2, false),
  ('fungalSamples', 2, false),
  ('virusSamples', 2, false),
  ('naniteClusters', 2, false),
  ('plasmaCells', 2, false),
  ('voidResidue', 2, false),
  ('dimensionalShards', 2, false),
  ('gravityStones', 2, false),
  ('timeFragments', 2, false),
  ('weatherBatteries', 2, false),
  ('reinforcedConcrete', 2, false),
  ('carbonFiber', 2, false),
  ('titanAlloy', 2, false),
  ('nanoFiber', 2, false),
  ('heatCores', 2, false),
  ('coolingUnits', 2, false),
  ('purifiedWater', 2, false),
  ('solarCells', 2, false),
  ('windTurbineParts', 2, false),
  ('hydroCores', 2, false),
  ('fireSalts', 2, false),
  ('iceCrystals', 2, false),
  ('stormEssence', 2, false),
  ('earthShards', 2, false),
  ('natureBloom', 2, false),
  ('corruptedBlood', 2, false),
  ('demonFlesh', 2, false),
  ('angelFeathers', 2, false),
  ('spiritAshes', 2, false),
  ('phantomDust', 2, false),
  ('nightmareFuel', 2, false),
  ('beaconParts', 2, false),
  ('supplyCrates', 2, false),
  ('tradeGoods', 2, false),
  ('rareMinerals', 2, false),
  ('campTokens', 2, false),
  ('survivorTags', 2, false),
  ('tacticalIntel', 2, false),
  ('blueprintPages', 2, false),
  ('craftingSchematics', 2, false),
  ('repairKits', 2, false),
  ('excavationTools', 2, false),
  ('miningCharges', 2, false),
  ('lootKeys', 2, false),
  ('vaultCodes', 2, false),
  ('energyCubes', 2, false),
  ('relicDust', 2, false),
  ('mythicEssence', 2, false),
  ('ancientBones', 2, false),
  ('mechanicalLimbs', 2, false),
  ('syntheticOrgans', 2, false),
  ('neuralGel', 2, false),
  ('memoryChips', 2, false),
  ('holoShards', 2, false),
  ('cyberneticParts', 2, false),
  ('droneBatteries', 2, false),
  ('plasmaOre', 2, false),
  ('etherFuel', 2, false),
  ('darkMatter', 2, false),
  ('lightCores', 2, false),
  ('scpSamples', 2, false),
  ('containmentFluid', 2, false),
  ('freshWater', 2, false),
  ('rawWater', 2, false),
  ('industrialWater', 2, false),
  ('reclaimedWater', 2, false),
  ('wastewater', 2, false),
  ('wheat', 2, false),
  ('corn', 2, false),
  ('rice', 2, false),
  ('potatoes', 2, false),
  ('soybeans', 2, false),
  ('sugarCrops', 2, false),
  ('vegetables', 2, false),
  ('fruit', 2, false),
  ('herbs', 2, false),
  ('animalFeed', 2, false),
  ('livestock', 2, false),
  ('feathers', 2, false),
  ('wool', 2, false),
  ('hide', 2, false),
  ('goldEggs', 2, false),
  ('primeMeat', 2, false),
  ('richMilk', 2, false),
  ('primeSeafood', 2, false),
  ('monsterParts', 2, false),
  ('rations', 2, false),
  ('planks', 2, false),
  ('remedies', 2, false),
  ('fineWool', 2, false),
  ('poultry', 2, false),
  ('eggs', 2, false),
  ('rawMilk', 2, false),
  ('cotton', 2, false),
  ('plantFiber', 2, false),
  ('biomass', 2, false),
  ('freshFish', 2, false),
  ('seafood', 2, false),
  ('shellfish', 2, false),
  ('seaweed', 2, false),
  ('flour', 2, false),
  ('bread', 2, false),
  ('meat', 2, false),
  ('processedMeat', 2, false),
  ('dairy', 2, false),
  ('cheese', 2, false),
  ('cookingOil', 2, false),
  ('sugar', 2, false),
  ('packagedFood', 2, false),
  ('frozenFood', 2, false),
  ('cannedFood', 2, false),
  ('snacks', 2, false),
  ('beverages', 2, false),
  ('preparedMeals', 2, false),
  ('restaurantSupplies', 2, false),
  ('timber', 2, false),
  ('lumber', 2, false),
  ('plywood', 2, false),
  ('woodPanels', 2, false),
  ('woodPulp', 2, false),
  ('paper', 2, false),
  ('premiumPaper', 2, false),
  ('cardboard', 2, false),
  ('furnitureComponents', 2, false),
  ('sand', 2, false),
  ('clay', 2, false),
  ('limestone', 2, false),
  ('gravel', 2, false),
  ('copperOre', 2, false),
  ('aluminumOre', 2, false),
  ('nickelOre', 2, false),
  ('zincOre', 2, false),
  ('goldOre', 2, false),
  ('silverOre', 2, false),
  ('platinumOre', 2, false),
  ('lithium', 2, false),
  ('cobalt', 2, false),
  ('titanium', 2, false),
  ('tungsten', 2, false),
  ('rareEarthMinerals', 2, false),
  ('quartz', 2, false),
  ('silica', 2, false),
  ('coal', 2, false),
  ('crudeOil', 2, false),
  ('naturalGas', 2, false),
  ('gasoline', 2, false),
  ('industrialFuel', 2, false),
  ('aviationFuel', 2, false),
  ('naturalGasFuel', 2, false),
  ('nuclearFuel', 2, false),
  ('hydrogen', 2, false),
  ('electricity', 2, false),
  ('brick', 2, false),
  ('cement', 2, false),
  ('concrete', 2, false),
  ('glass', 2, false),
  ('steel', 2, false),
  ('asphalt', 2, false),
  ('structuralSteel', 2, false),
  ('insulation', 2, false),
  ('constructionGlass', 2, false),
  ('compositeMaterials', 2, false),
  ('constructionComponents', 2, false),
  ('prefabricatedComponents', 2, false),
  ('electricalComponents', 2, false),
  ('plumbingComponents', 2, false),
  ('pigIron', 2, false),
  ('sheetMetal', 2, false),
  ('metalComponents', 2, false),
  ('aluminum', 2, false),
  ('copper', 2, false),
  ('copperWire', 2, false),
  ('metalAlloys', 2, false),
  ('advancedAlloys', 2, false),
  ('industrialChemicals', 2, false),
  ('acids', 2, false),
  ('solvents', 2, false),
  ('industrialGas', 2, false),
  ('plastic', 2, false),
  ('rubber', 2, false),
  ('syntheticFiber', 2, false),
  ('paint', 2, false),
  ('adhesives', 2, false),
  ('cleaningChemicals', 2, false),
  ('semiconductorChemicals', 2, false),
  ('medicalChemicals', 2, false),
  ('holographicChemicals', 2, false),
  ('specialtyPolymers', 2, false),
  ('petrochemicals', 2, false),
  ('plasticFeedstock', 2, false),
  ('chemicalFeedstock', 2, false),
  ('machineParts', 2, false),
  ('industrialMachinery', 2, false),
  ('heavyMachinery', 2, false),
  ('agriculturalMachinery', 2, false),
  ('constructionEquipment', 2, false),
  ('miningEquipment', 2, false),
  ('factoryEquipment', 2, false),
  ('pumps', 2, false),
  ('turbines', 2, false),
  ('generators', 2, false),
  ('electronicComponents', 2, false),
  ('wiring', 2, false),
  ('batteries', 2, false),
  ('microchips', 2, false),
  ('processors', 2, false),
  ('sensors', 2, false),
  ('communicationComponents', 2, false),
  ('advancedBatteries', 2, false),
  ('computerComponents', 2, false),
  ('computers', 2, false),
  ('smartphones', 2, false),
  ('displays', 2, false),
  ('communicationDevices', 2, false),
  ('servers', 2, false),
  ('semiconductorMaterials', 2, false),
  ('siliconWafers', 2, false),
  ('advancedMicrochips', 2, false),
  ('engines', 2, false),
  ('vehicleParts', 2, false),
  ('tires', 2, false),
  ('maintenanceParts', 2, false),
  ('cars', 2, false),
  ('electricVehicles', 2, false),
  ('trucks', 2, false),
  ('deliveryVehicles', 2, false),
  ('buses', 2, false),
  ('industrialVehicles', 2, false),
  ('freightVehicles', 2, false),
  ('clothing', 2, false),
  ('shoes', 2, false),
  ('fabric', 2, false),
  ('furniture', 2, false),
  ('appliances', 2, false),
  ('householdGoods', 2, false),
  ('personalCareProducts', 2, false),
  ('cleaningProducts', 2, false),
  ('toys', 2, false),
  ('sportingGoods', 2, false),
  ('books', 2, false),
  ('luxuryGoods', 2, false),
  ('pharmaceuticals', 2, false),
  ('surgicalSupplies', 2, false),
  ('medicalEquipment', 2, false),
  ('diagnosticEquipment', 2, false),
  ('advancedMedicine', 2, false),
  ('researchChemicals', 2, false),
  ('residentialWaste', 2, false),
  ('commercialWaste', 2, false),
  ('industrialWaste', 2, false),
  ('organicWaste', 2, false),
  ('electronicWaste', 2, false),
  ('medicalWaste', 2, false),
  ('hazardousWaste', 2, false),
  ('recycledMetal', 2, false),
  ('recycledPlastic', 2, false),
  ('recycledGlass', 2, false),
  ('recycledPaper', 2, false),
  ('recycledElectronics', 2, false),
  ('compost', 2, false),
  ('reclaimedIndustrialMaterials', 2, false),
  ('fiberOpticCable', 2, false),
  ('communicationEquipment', 2, false),
  ('networkingEquipment', 2, false),
  ('dataStorageHardware', 2, false),
  ('satelliteComponents', 2, false),
  ('robotics', 2, false),
  ('automationSystems', 2, false),
  ('artificialIntelligenceHardware', 2, false),
  ('advancedSensors', 2, false),
  ('quantumComponents', 2, false),
  ('droneComponents', 2, false),
  ('industrialRobots', 2, false),
  ('cardStock', 2, false),
  ('printingInk', 2, false),
  ('inkChemicals', 2, false),
  ('holographicFoil', 2, false),
  ('protectiveCoating', 2, false),
  ('packagingMaterial', 2, false),
  ('printedCards', 2, false),
  ('boosterPacks', 2, false),
  ('starterDecks', 2, false),
  ('cardBoxes', 2, false),
  ('collectorPacks', 2, false),
  ('tournamentProducts', 2, false),
  ('holographicComponents', 2, false),
  ('holographicProjectors', 2, false),
  ('opticalComponents', 2, false),
  ('signalProcessors', 2, false),
  ('holographicChips', 2, false),
  ('relayComponents', 2, false),
  ('aerospaceAluminum', 2, false),
  ('satelliteSystems', 2, false),
  ('mythicResidue', 2, false),
  ('anomalousMatter', 2, false),
  ('anomalousEnergy', 2, false),
  ('realityMatter', 2, false),
  ('dimensionalMaterial', 2, false),
  ('arcaneCrystal', 2, false),
  ('realityFragments', 2, false),
  ('containmentMaterials', 2, false),
  ('reinforcedContainmentMaterials', 2, false),
  ('realityStabilizationComponents', 2, false),
  ('researchEquipment', 2, false),
  ('secureElectronics', 2, false),
  ('anomalySensors', 2, false),
  ('containmentEquipment', 2, false),
  ('specializedMedicalSupplies', 2, false),
  ('hazardousMaterialEquipment', 2, false),
  ('classifiedTechnology', 2, false),
  ('securityEquipment', 2, false),
  ('protectiveEquipment', 2, false),
  ('surveillanceEquipment', 2, false),
  ('officeSupplies', 2, false),
  ('emergencyFood', 2, false),
  ('bottledWater', 2, false),
  ('emergencySupplies', 2, false),
  ('emergencyEquipment', 2, false)
on conflict (res_id) do nothing;

-- RESERVE_EVENTS, in client order: the active event is events[h % count].
create table if not exists public.reserve_events (
  ord     int primary key check (ord >= 0),
  id      text not null unique,
  res     text[] not null default '{}',
  relief  boolean not null default false
);
insert into public.reserve_events (ord, id, res, relief) values
  (0, 'fuelCrisis', array['fuel']::text[], false),
  (1, 'bioLock', array['corruptedEssence', 'dna']::text[], false),
  (2, 'shardDrought', array['memoryShards']::text[], false),
  (3, 'outbreak', array['medicine', 'water']::text[], false),
  (4, 'reliefSurge', '{}'::text[], true)
on conflict (ord) do nothing;

-- 🔥 The owner's Cinder ceiling for this reward, per player per UTC day
--    (sql/159's table; one UPDATE to tune; 0 = contributions pay no Cinder).
--    Not a number the client ever had: the highest lifetime reward on
--    2026-09-19 is ~787k Cinder (1,574,083 points) over the feature's life.
insert into public.cinder_reward_caps (bucket, daily_cinder, note) values
  ('reserve', 100000, 'Foundation Reserve contribution + convoy rewards (sql/164). OWNER TO CONFIRM the figure.')
on conflict (bucket) do nothing;

-- Every contribution the server accepted, with the key that makes it
-- exactly-once. APPEND-ONLY: nothing updates or deletes a row; the day's used
-- Cinder is sum(cinder_paid), never a stored counter.
create table if not exists public.reserve_contribution_log (
  id           bigserial primary key,
  user_id      uuid   not null references auth.users(id) on delete cascade,
  nonce        text   not null check (length(nonce) between 8 and 100),
  source       text   not null check (source in ('deposit', 'convoy')),
  resource     text   not null,
  qty          bigint not null check (qty > 0),
  weight       numeric not null,
  mul          numeric not null,
  points       bigint not null check (points >= 0),
  cinder_want  bigint not null check (cinder_want >= 0),
  cinder_paid  bigint not null check (cinder_paid >= 0 and cinder_paid <= cinder_want),
  emergency    boolean not null default false,
  specialty    boolean not null default false,
  event_id     text,
  created_at   timestamptz not null default now(),
  unique (user_id, nonce)
);
create index if not exists reserve_contribution_log_user_ts on public.reserve_contribution_log (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- 2. RLS — reviewed line by line.
-- --------------------------------------------------------------------------
alter table public.reserve_config           enable row level security;
alter table public.reserve_resources        enable row level security;
alter table public.reserve_events           enable row level security;
alter table public.reserve_contribution_log enable row level security;

-- The numbers are public to signed-in players so the UI can show what is enforced.
drop policy if exists rcf_sel on public.reserve_config;
create policy rcf_sel on public.reserve_config    for select to authenticated using (true);
drop policy if exists rrs_sel on public.reserve_resources;
create policy rrs_sel on public.reserve_resources for select to authenticated using (true);
drop policy if exists rev_sel on public.reserve_events;
create policy rev_sel on public.reserve_events    for select to authenticated using (true);
-- The log: a player reads their OWN rows only (the client's nonce read-back).
drop policy if exists rcl_sel on public.reserve_contribution_log;
create policy rcl_sel on public.reserve_contribution_log for select to authenticated using (user_id = auth.uid());

revoke all on public.reserve_config, public.reserve_resources, public.reserve_events, public.reserve_contribution_log from anon;
revoke insert, update, delete, truncate on public.reserve_config, public.reserve_resources, public.reserve_events,
                                            public.reserve_contribution_log from authenticated;
grant select on public.reserve_config, public.reserve_resources, public.reserve_events, public.reserve_contribution_log to authenticated;
revoke all on sequence public.reserve_contribution_log_id_seq from anon, authenticated;

-- reserve_contributions becomes READ-ONLY to players. Checked 2026-09-19: the
-- only writers are index.html frDeposit + frConvoyTick (both moved to the RPCs
-- below by the paired client patch) and no database function writes it
-- (_inf_inputs only reads it). Live grants were ALL verbs to anon AND
-- authenticated; RLS was the only thing between anon and the table.
drop policy if exists rc_ins on public.reserve_contributions;
drop policy if exists rc_upd on public.reserve_contributions;
revoke insert, update, delete, truncate on public.reserve_contributions from anon, authenticated;
-- anon SELECT is left as it is: rc_sel is TO authenticated, so anon already
-- reads zero rows, and api_reserve_totals is a definer view that does not
-- depend on it. Revoking it would turn an empty answer into an error for any
-- anon caller of the security_invoker reserve_totals view.
grant select on public.reserve_contributions to authenticated;  -- rc_sel (kept) still gates the rows

-- --------------------------------------------------------------------------
-- 3. The world event — a port of index.html _frHash / frActiveEvent.
-- --------------------------------------------------------------------------
-- JS: n = (n|0) ^ 0x9e3779b9; n = imul(n ^ (n >>> 15), 0x85ebca6b);
--     n = imul(n ^ (n >>> 13), 0xc2b2ae35); return (n ^ (n >>> 16)) >>> 0.
-- Carried as an unsigned 32-bit value in a bigint: XOR and a logical right
-- shift on the unsigned pattern equal JS's int32 ops bit for bit, and imul is
-- the product mod 2^32 (numeric, so the 64-bit product cannot overflow).
create or replace function public._fr_hash(p_w bigint)
returns bigint language plpgsql immutable set search_path = public as $$
declare
  m constant bigint := 4294967295;
  n bigint := (p_w & m) # 2654435769;
begin
  n := ((((n # (n >> 15)))::numeric * 2246822507) % 4294967296)::bigint;
  n := ((((n # (n >> 13)))::numeric * 3266489909) % 4294967296)::bigint;
  return n # (n >> 16);
end $$;
revoke all on function public._fr_hash(bigint) from public, anon, authenticated;

-- The active event at p_at, or NULL (a calm window: h % 3 = 0).
create or replace function public._fr_active_event(p_at timestamptz)
returns public.reserve_events language plpgsql stable security definer set search_path = public as $$
declare
  v_win bigint;
  v_h   bigint;
  v_n   int;
  e     public.reserve_events%rowtype;
begin
  select floor(extract(epoch from p_at) * 1000 / event_window_ms)::bigint into v_win from public.reserve_config where id = 1;
  if v_win is null then return null; end if;
  v_h := public._fr_hash(v_win);
  if v_h % 3 = 0 then return null; end if;
  select count(*) into v_n from public.reserve_events;
  if v_n = 0 then return null; end if;
  select * into e from public.reserve_events where ord = (v_h % v_n)::int;
  return e;
end $$;
revoke all on function public._fr_active_event(timestamptz) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 4. The core. One transaction: validate → lock the user's day → exactly
--    once per nonce → compute → log → upsert the reserve row → credit.
--    Every refusal returns before any reserve / log / wallet write (the only
--    earlier write is the moneyless day-lock row); any exception rolls all of
--    it back. So "ok: false" always means no contribution and no Cinder.
-- --------------------------------------------------------------------------
-- A nonce that already landed: the original result, current balance. The
-- same nonce with different arguments is a client bug — refused, not paid.
create or replace function public._fr_replay(lg public.reserve_contribution_log, p_res text, p_qty int, p_source text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_bal bigint; v_seq bigint; v_rq numeric; v_rp numeric;
begin
  if lg.resource <> p_res or lg.qty <> p_qty or lg.source <> p_source then
    return jsonb_build_object('ok', false, 'error', 'nonce_conflict');
  end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = lg.user_id;
  select qty, points into v_rq, v_rp from public.reserve_contributions where user_id = lg.user_id and resource = lg.resource;
  return jsonb_build_object('ok', true, 'already', true, 'source', lg.source, 'resource', lg.resource, 'qty', lg.qty,
                            'points', lg.points, 'credited', lg.cinder_paid, 'wanted', lg.cinder_want,
                            'clamped', lg.cinder_paid < lg.cinder_want, 'emergency', lg.emergency,
                            'specialty', lg.specialty, 'event', lg.event_id,
                            'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0),
                            'reserve', jsonb_build_object('resource', lg.resource, 'qty', coalesce(v_rq, 0), 'points', coalesce(v_rp, 0)));
end $$;
revoke all on function public._fr_replay(public.reserve_contribution_log, text, int, text) from public, anon, authenticated;

create or replace function public._fr_contribute_core(
  p_uid uuid, p_source text, p_res_id text, p_qty int, p_client_nonce text, p_specialty text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg      public.reserve_config%rowtype;
  lg       public.reserve_contribution_log%rowtype;
  ev       public.reserve_events%rowtype;
  v_nonce  text := btrim(coalesce(p_client_nonce, ''));
  v_res    text := btrim(coalesce(p_res_id, ''));
  v_weight numeric;
  v_spec_ok boolean := false;
  v_em     boolean;
  v_sp     boolean;
  v_mul    numeric;
  v_points bigint;
  v_want   bigint;
  v_cap    bigint;
  v_day    date := (now() at time zone 'utc')::date;
  v_from   timestamptz;
  v_used   bigint;
  v_pay    bigint;
  v_id     bigint;
  v_give   jsonb;
  v_name   text;
  v_rq     numeric;
  v_rp     numeric;
  v_bal    bigint;
  v_seq    bigint;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_source not in ('deposit', 'convoy') then return jsonb_build_object('ok', false, 'error', 'bad_source'); end if;
  if length(v_nonce) < 8 or length(v_nonce) > 100 then return jsonb_build_object('ok', false, 'error', 'bad_nonce'); end if;
  select * into cfg from public.reserve_config where id = 1;
  if cfg.id is null or not cfg.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_qty is null or p_qty <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
  if p_qty > cfg.max_qty_per_call then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'max', cfg.max_qty_per_call);
  end if;
  if v_res !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' then return jsonb_build_object('ok', false, 'error', 'unknown_resource'); end if;

  -- Fast path: a retry of a call that already landed gets the ORIGINAL result
  -- back, even if the resource or the tuning changed since.
  select * into lg from public.reserve_contribution_log where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._fr_replay(lg, v_res, p_qty, p_source); end if;

  -- Which resource, at what weight: the server list first, then a
  -- Forge-authored resource from the published catalog (default weight).
  select weight, specialty_ok into v_weight, v_spec_ok from public.reserve_resources where res_id = v_res and enabled;
  if v_weight is null then
    if exists (select 1 from public.card_catalog c
                 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.moves -> '__custom_resources__') = 'array'
                                                              then c.moves -> '__custom_resources__' else '[]'::jsonb end) e
                where c.id = 'singleton' and e ->> 'id' = v_res) then
      v_weight := cfg.weight_default; v_spec_ok := false;
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_resource');
    end if;
  end if;

  -- The per-user, per-UTC-day lock row (sql/159's table, bucket 'reserve').
  -- This is the FIRST write, and it carries no money. Two tabs — or a retry
  -- racing its own timed-out original — serialise HERE, so the nonce check
  -- below sees the other one's committed row, and the day's room is measured
  -- after the other one's payment.
  insert into public.cinder_reward_days (user_id, bucket, day) values (p_uid, 'reserve', v_day)
  on conflict (user_id, bucket, day) do nothing;
  perform 1 from public.cinder_reward_days where user_id = p_uid and bucket = 'reserve' and day = v_day for update;
  select * into lg from public.reserve_contribution_log where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._fr_replay(lg, v_res, p_qty, p_source); end if;

  -- Multipliers, exactly as the client computed them — but here.
  ev := public._fr_active_event(now());
  v_em := coalesce(ev.ord is not null and not ev.relief and v_res = any(ev.res), false);
  v_sp := coalesce(v_spec_ok, false) and p_specialty is not null and btrim(p_specialty) = v_res;
  v_mul := least(cfg.mul_cap, (case when v_em then cfg.emergency_mul else 1 end) * (case when v_sp then cfg.specialty_mul else 1 end));
  if p_source = 'convoy' then v_mul := v_mul * cfg.convoy_mul; end if;
  v_points := round(p_qty * v_weight * v_mul)::bigint;
  v_want := greatest(cfg.min_reward, round(v_points * cfg.cinder_per_point))::bigint;

  -- The day's Cinder room for this reward.
  select daily_cinder into v_cap from public.cinder_reward_caps where bucket = 'reserve';
  v_from := v_day::timestamp at time zone 'utc';
  select coalesce(sum(cinder_paid), 0) into v_used from public.reserve_contribution_log
   where user_id = p_uid and created_at >= v_from and created_at < v_from + interval '1 day';
  v_pay := least(v_want, greatest(0, coalesce(v_cap, 0) - v_used));

  insert into public.reserve_contribution_log (user_id, nonce, source, resource, qty, weight, mul, points,
                                               cinder_want, cinder_paid, emergency, specialty, event_id)
  values (p_uid, v_nonce, p_source, v_res, p_qty, v_weight, v_mul, v_points, v_want, v_pay, v_em, v_sp, ev.id)
  on conflict (user_id, nonce) do nothing returning id into v_id;
  if v_id is null then
    -- Unreachable under the day lock; refuse rather than pay twice.
    return jsonb_build_object('ok', false, 'error', 'nonce_conflict');
  end if;

  -- The reserve row: ONE atomic statement, no read-then-write.
  select left(coalesce(nullif(btrim(display_name), ''), 'Survivor'), 40) into v_name
    from public.user_profiles where user_id = p_uid;
  insert into public.reserve_contributions as rc (user_id, user_name, resource, qty, points, updated_at)
  values (p_uid, coalesce(v_name, 'Survivor'), v_res, p_qty, v_points, now())
  on conflict (user_id, resource) do update
     set qty = rc.qty + excluded.qty,
         points = rc.points + excluded.points,
         user_name = coalesce(v_name, rc.user_name),
         updated_at = now()
  returning rc.qty, rc.points into v_rq, v_rp;

  -- The Cinder: the canonical definer credit (user_progress.cinder + mirror +
  -- wallet_ledger 'credit'). No balance is written here.
  if v_pay > 0 then
    v_give := public._ct_cinder_give(p_uid, v_pay,
                'Foundation Reserve ' || case when p_source = 'convoy' then 'convoy' else 'contribution' end
                || ': ' || p_qty || ' ' || v_res);
    if v_give is null or coalesce((v_give ->> 'moved')::bigint, 0) <> v_pay then
      raise exception '_fr_contribute_core: credit failed for % (%)', p_uid, v_nonce;
    end if;
  end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
  return jsonb_build_object('ok', true, 'already', false, 'source', p_source, 'resource', v_res, 'qty', p_qty,
                            'points', v_points, 'credited', v_pay, 'wanted', v_want, 'clamped', v_pay < v_want,
                            'cap', coalesce(v_cap, 0), 'used_today', v_used + v_pay,
                            'emergency', v_em, 'specialty', v_sp, 'event', ev.id,
                            'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0),
                            'reserve', jsonb_build_object('resource', v_res, 'qty', v_rq, 'points', v_rp));
end $$;
revoke all on function public._fr_contribute_core(uuid, text, text, int, text, text) from public, anon, authenticated;

-- ➕ Contribute (the instant deposit). p_specialty: the player's camp
-- specialty, honoured only when it names this resource (see header).
create or replace function public.fr_contribute(p_res_id text, p_qty int, p_client_nonce text, p_specialty text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public._fr_contribute_core(auth.uid(), 'deposit', p_res_id, p_qty, p_client_nonce, p_specialty);
end $$;
revoke all on function public.fr_contribute(text, int, text, text) from public, anon;
grant execute on function public.fr_contribute(text, int, text, text) to authenticated;

-- 🚚 A convoy arrival: the DELIVERED qty (after any interception), paid at
-- the convoy bonus. The nonce is 'cv:' + the convoy id, so a tick that retries
-- an arrival can never pay it twice. Dispatch and interception stay client
-- state (reload-safe, deterministic per convoy id) — unverifiable, and bounded
-- by the same per-call size and per-day Cinder ceiling.
create or replace function public.fr_convoy_deliver(p_res_id text, p_qty int, p_client_nonce text, p_specialty text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public._fr_contribute_core(auth.uid(), 'convoy', p_res_id, p_qty, p_client_nonce, p_specialty);
end $$;
revoke all on function public.fr_convoy_deliver(text, int, text, text) from public, anon;
grant execute on function public.fr_convoy_deliver(text, int, text, text) to authenticated;

commit;

-- ===========================================================================
-- VERIFY (read-only). Expect every *_ok column = t and:
--   resources = 409, events = 5, reserve_cap = 100000 (or the owner's figure),
--   rc_write_policies = 0, rc_player_writes = f, hash_ok = t (JS _frHash fixtures).
select
  (select count(*) from pg_class where oid in ('public.reserve_config'::regclass, 'public.reserve_resources'::regclass,
      'public.reserve_events'::regclass, 'public.reserve_contribution_log'::regclass) and relrowsecurity) = 4  as rls_ok,
  (select count(*) from public.reserve_resources)                                                        as resources,
  (select count(*) from public.reserve_events)                                                           as events,
  (select daily_cinder from public.cinder_reward_caps where bucket = 'reserve')                          as reserve_cap,
  (select count(*) from pg_policies where tablename = 'reserve_contributions' and cmd <> 'SELECT')      as rc_write_policies,
  (has_table_privilege('authenticated', 'public.reserve_contributions', 'INSERT')
    or has_table_privilege('authenticated', 'public.reserve_contributions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.reserve_contributions', 'DELETE')
    or has_table_privilege('anon', 'public.reserve_contributions', 'INSERT')
    or has_table_privilege('anon', 'public.reserve_contributions', 'UPDATE'))                           as rc_player_writes,
  has_table_privilege('authenticated', 'public.reserve_contributions', 'SELECT')                        as rc_read_ok,
  (select count(*) from pg_policies where tablename in ('reserve_config', 'reserve_resources', 'reserve_events',
      'reserve_contribution_log') and cmd <> 'SELECT') = 0                                             as no_write_policies_ok,
  (has_function_privilege('authenticated', 'public.fr_contribute(text,integer,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.fr_convoy_deliver(text,integer,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fr_contribute(text,integer,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fr_convoy_deliver(text,integer,text,text)', 'EXECUTE')) as grants_ok,
  not (has_function_privilege('authenticated', 'public._fr_contribute_core(uuid,text,text,integer,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._fr_active_event(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._fr_hash(bigint)', 'EXECUTE'))                  as helpers_private_ok,
  (public._fr_hash(0) = 4079132893
    and public._fr_hash(1) = 56475751
    and public._fr_hash(82000) = 2100043309
    and public._fr_hash(82900) = 3582047812
    and public._fr_hash(82901) = 333980516
    and public._fr_hash(82902) = 2163981141
    and public._fr_hash(83000) = 3466864145
    and public._fr_hash(99999) = 2160955750)                                                                                    as hash_ok;
-- ===========================================================================
