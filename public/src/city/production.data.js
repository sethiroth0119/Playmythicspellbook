/* ════════════════════════════════════════════════════════════════════════════
   🏭 CITY_PRODUCTION — placeable buildings that YIELD resources.
   ----------------------------------------------------------------------------
   Spec: CLAUDE_TASK_buildings.md §3.

   🔴 THIS IS DELIBERATELY NOT MERGED INTO CAMP_FACILITIES, and that is the whole
   design decision. Those are three different things that only look alike:
     • CAMP_FACILITIES  — grant BONUSES (slots, multipliers). No placement, no
                          throughput, no inputs. `bonus: lv => ({…})`.
     • CAMP_BUILDINGS   — screen PORTALS. `{door, route}`; they run a transition
                          and nothing else.
     • CITY_PRODUCTION  — this. Buildings that consume inputs, occupy the city
                          grid, draw power/water/labour and produce resources
                          over time.
   Folding production into CAMP_FACILITIES would mean every facility read site
   (campBonus, resolveReadyCampBuilds, the facility grid, the admin cost editor)
   grew a "…but is it a factory?" branch, and every production read site grew the
   mirror of it. Two catalogs with one shared COST GRAMMAR is the cheaper seam.

   Every entry:
     yields   — resource units per collection cycle at level 1
     inputs   — resources CONSUMED per cycle. Production HALTS without them.
     draw     — city load: power, water, workers, pollution
     cost[]   — build/upgrade cost per level, as a resource dict (see cost.js)

   ⚠ Rates here are tuning starting points, NOT an authority. If a _cityEcon()
   tuning path is ever added (the analogue of _opEcon() for operations), route
   these through it rather than copying numbers out — CLAUDE.md: "All operation
   pricing goes through _opEcon(). Never hardcode economy numbers." Production
   has no such path YET, which is why the literals are here and why this comment
   exists to be deleted by whoever adds one.
   ════════════════════════════════════════════════════════════════════════════ */

/* 📦 UI ORDER IS LOAD-BEARING — THE WAREHOUSE IS FIRST ON PURPOSE.
   Production halts at full storage. A player who builds a Hydroponics Bay first
   watches it fill its buffer and stop, which reads as a broken building rather
   than as a storage cap. Storage, then power, then labour, then the producers:
   the three utilities are what make any of the rest work, so they are what the
   blueprint list offers first. Do not "tidy" this into alphabetical order. */
export const CITY_PRODUCTION = [
  // ───────────────────────── UTILITIES (no yield, but required) ─────────────
  {
    id: 'warehouse', name: 'Warehouse', kind: 'utility', emoji: '📦', accent: '#d4af37',
    desc: 'Raises the stash ceiling. Without it every producer fills its buffer and stops.',
    maxLevel: 3,
    yields: null, inputs: null,
    draw: { power: 5, water: 0, workers: 2, pollution: 0 },
    // +2,000 storage at L1, scaling with level.
    effect: lv => ({ storage: 2000 * lv }),
    footprint: { w: 2, h: 2 },
    /* ⚠ THE TASK DOC CONTRADICTS ITSELF HERE AND THE STRICTER RULE WINS.
       §3 states "Every building costs at least three different resources", but
       the utility table then prices the Warehouse at "cinder 50k, metal 80,
       supplies 60" — two resource legs. The `water: 15` below is the third.
       It is deliberately tiny: the Warehouse is the building players are told
       to put up first, so it must stay the cheapest thing in the list. Raising
       it further would fight the onboarding the catalog order exists to serve. */
    cost: [
      { cinder: 50000,  metal: 80,  supplies: 60,  water: 15 },
      { cinder: 125000, metal: 185, supplies: 140, fuel: 35 },
      { cinder: 295000, metal: 400, supplies: 310, fuel: 90, memoryShards: 8 },
    ],
  },
  {
    id: 'powerplant', name: 'Power Plant', kind: 'utility', emoji: '⚡', accent: '#8affd6',
    desc: 'Feeds the grid. Unpowered buildings run at 40% — or not at all.',
    maxLevel: 3,
    yields: null, inputs: { fuel: 25 },
    draw: { power: 0, water: 10, workers: 6, pollution: 22 },
    effect: lv => ({ power: 250 * lv, radius: 4 }),
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 140000, metal: 120, supplies: 90,  fuel: 60 },
      { cinder: 335000, metal: 275, supplies: 210, fuel: 145, ammo: 25 },
      { cinder: 790000, metal: 590, supplies: 455, fuel: 320, ammo: 60, corruptedEssence: 14 },
    ],
  },
  {
    id: 'tenements', name: 'Tenements', kind: 'utility', emoji: '🏢', accent: '#c9a86a',
    desc: 'Homes. Every producer needs crew, and crew have to live somewhere.',
    maxLevel: 3,
    yields: null, inputs: { food: 20, water: 25 },
    draw: { power: 12, water: 0, workers: 0, pollution: 4 },
    effect: lv => ({ workers: 25 * lv, population: 40 * lv }),
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 70000,  metal: 60,  supplies: 110, water: 30 },
      { cinder: 170000, metal: 140, supplies: 255, water: 75,  food: 45 },
      { cinder: 400000, metal: 300, supplies: 545, water: 165, food: 100, dna: 8 },
    ],
  },

  // ───────────────────────── PRODUCERS — one per resource ───────────────────
  {
    id: 'hydroponics', name: 'Hydroponics Bay', kind: 'production', emoji: '🥬', accent: '#9ad17a',
    desc: 'Racked greens under sodium light. Thirsty, but it feeds the city.',
    maxLevel: 3,
    yields: { food: 45 }, inputs: { water: 30 },
    draw: { power: 15, water: 30, workers: 6, pollution: 0 },
    footprint: { w: 3, h: 2 },
    // Costs no food — a food building bootstrapped from food is an infinite loop.
    cost: [
      { cinder: 45000,  metal: 40,  supplies: 30,  water: 20 },
      { cinder: 110000, metal: 95,  supplies: 70,  water: 50,  fuel: 20 },
      { cinder: 260000, metal: 210, supplies: 160, water: 120, fuel: 55, dna: 8 },
    ],
  },
  {
    id: 'wellhead', name: 'Water Reclaimer', kind: 'production', emoji: '💧', accent: '#7fd6ff',
    desc: 'Pulls the grey back out of the ground and makes it drinkable.',
    maxLevel: 3,
    yields: { water: 60 }, inputs: { supplies: 5 },
    draw: { power: 25, water: 0, workers: 4, pollution: 0 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 55000,  metal: 50,  supplies: 35,  fuel: 15 },
      { cinder: 130000, metal: 115, supplies: 80,  fuel: 40, ammo: 12 },
      { cinder: 310000, metal: 250, supplies: 180, fuel: 95, ammo: 30, memoryShards: 5 },
    ],
  },
  {
    id: 'foundry', name: 'Smelting Foundry', kind: 'production', emoji: '🏭', accent: '#9fb4d8',
    desc: 'Scrap in, ingots out. The air downwind is not free.',
    maxLevel: 3,
    yields: { metal: 40 }, inputs: { fuel: 20 },
    draw: { power: 35, water: 0, workers: 8, pollution: 18 },
    footprint: { w: 3, h: 3 },
    // Produces metal, priced mostly in fuel + supplies. Rule 1 of §3.
    cost: [
      { cinder: 60000,  metal: 20,  supplies: 45,  fuel: 30 },
      { cinder: 145000, metal: 55,  supplies: 110, fuel: 75,  ammo: 15 },
      { cinder: 340000, metal: 130, supplies: 250, fuel: 170, ammo: 40, memoryShards: 6 },
    ],
  },
  {
    id: 'refinery', name: 'Fuel Refinery', kind: 'production', emoji: '⛽', accent: '#ffcf6b',
    desc: 'Cracks sludge into burnable fuel. Keep it away from the munitions bench.',
    maxLevel: 3,
    yields: { fuel: 38 }, inputs: { metal: 12, water: 20 },
    draw: { power: 30, water: 20, workers: 7, pollution: 26, fireRisk: 'high' },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 75000,  metal: 70,  supplies: 50,  water: 30 },
      { cinder: 180000, metal: 160, supplies: 120, water: 70,  ammo: 18 },
      { cinder: 420000, metal: 350, supplies: 270, water: 160, ammo: 45, corruptedEssence: 10 },
    ],
  },
  {
    id: 'munitions', name: 'Munitions Bench', kind: 'production', emoji: '🔫', accent: '#e0a060',
    desc: 'Presses brass and packs powder. Do not smoke.',
    maxLevel: 3,
    yields: { ammo: 30 }, inputs: { metal: 25, fuel: 8 },
    draw: { power: 12, water: 0, workers: 5, pollution: 6, fireRisk: 'high' },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 65000,  metal: 60,  supplies: 40,  fuel: 25 },
      { cinder: 155000, metal: 140, supplies: 95,  fuel: 60,  water: 30 },
      { cinder: 365000, metal: 300, supplies: 215, fuel: 135, water: 70, memoryShards: 7 },
    ],
  },
  {
    id: 'apothecary', name: 'Apothecary', kind: 'production', emoji: '💊', accent: '#ff8aa0',
    desc: 'Distils what the infirmary burns through.',
    maxLevel: 3,
    yields: { medicine: 18 }, inputs: { water: 25, food: 10 },
    draw: { power: 20, water: 25, workers: 5, pollution: 3 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 80000,  metal: 55,  supplies: 45,  water: 35 },
      { cinder: 190000, metal: 125, supplies: 105, water: 80,  food: 40 },
      { cinder: 450000, metal: 270, supplies: 235, water: 180, food: 90, dna: 9 },
    ],
  },
  {
    id: 'depot', name: 'Supply Workshop', kind: 'production', emoji: '📦', accent: '#d4af37',
    desc: 'Crates, webbing, spare everything. The least glamorous building you own.',
    maxLevel: 3,
    yields: { supplies: 50 }, inputs: { metal: 18, fuel: 10 },
    draw: { power: 15, water: 0, workers: 7, pollution: 5 },
    footprint: { w: 3, h: 2 },
    // Costs no supplies — see rule 1. A supply shop that pays for itself in
    // supplies is a money printer with extra steps.
    cost: [
      { cinder: 55000,  metal: 65,  fuel: 30,  food: 20 },
      { cinder: 135000, metal: 150, fuel: 75,  food: 50,  water: 35 },
      { cinder: 320000, metal: 320, fuel: 165, food: 110, water: 80, memoryShards: 6 },
    ],
  },
  {
    id: 'bottling', name: 'Bottling Line', kind: 'production', emoji: '🥤', accent: '#ffd166',
    desc: 'Sugar, caffeine and something the label does not name.',
    maxLevel: 3,
    yields: { energyDrink: 22 }, inputs: { water: 35, food: 12 },
    draw: { power: 18, water: 35, workers: 4, pollution: 7 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 60000,  metal: 50,  supplies: 40,  water: 30 },
      { cinder: 145000, metal: 115, supplies: 90,  water: 70,  food: 35 },
      { cinder: 340000, metal: 245, supplies: 200, water: 155, food: 80, dna: 7 },
    ],
  },
  {
    id: 'sump', name: 'Containment Sump', kind: 'production', emoji: '🟣', accent: '#b06bff',
    desc: 'Bleeds the corruption out of the water table and bottles it. Runs hot.',
    maxLevel: 3,
    yields: { corruptedEssence: 8 }, inputs: { medicine: 10 },
    draw: { power: 45, water: 0, workers: 5, pollution: 30, heat: 15 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 110000, metal: 90,  supplies: 70,  medicine: 20 },
      { cinder: 265000, metal: 200, supplies: 160, medicine: 50,  memoryShards: 8 },
      { cinder: 620000, metal: 430, supplies: 340, medicine: 120, memoryShards: 22, dna: 10 },
    ],
  },
  {
    id: 'archive', name: 'Memory Archive', kind: 'production', emoji: '🧠', accent: '#7fb8ff',
    desc: 'Cold storage for things people would rather forget. Enormously power-hungry.',
    maxLevel: 3,
    yields: { memoryShards: 4 }, inputs: { supplies: 20 },
    draw: { power: 60, water: 0, workers: 4, pollution: 0 },
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 90000,  metal: 70,  supplies: 55,  memoryShards: 3,  corruptedEssence: 2 },
      { cinder: 220000, metal: 160, supplies: 130, memoryShards: 10, corruptedEssence: 6,  dna: 4 },
      { cinder: 520000, metal: 340, supplies: 290, memoryShards: 28, corruptedEssence: 18, dna: 12 },
    ],
  },
  {
    id: 'genevault', name: 'Gene Vault', kind: 'production', emoji: '🧬', accent: '#86e08a',
    desc: 'Sequencing tanks. The most expensive building in the city, and worth it.',
    maxLevel: 3,
    yields: { dna: 5 }, inputs: { food: 30, medicine: 12 },
    draw: { power: 40, water: 15, workers: 6, pollution: 9 },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 120000, metal: 85,  supplies: 60,  medicine: 25,  dna: 5 },
      { cinder: 290000, metal: 190, supplies: 140, medicine: 60,  dna: 14, corruptedEssence: 8 },
      { cinder: 680000, metal: 410, supplies: 320, medicine: 145, dna: 35, corruptedEssence: 22, memoryShards: 15 },
    ],
  },
  /* ══ THE MATERIAL CHAIN (r12) ═══════════════════════════════════════════
     wood / stone / cloth joined RESOURCES this round. auditCatalog() rule 1
     says every resource needs a producer, and it is not a style rule: a
     resource with no building that makes it is obtainable only by loot, which
     is the exact inert state these three were already in.
     Yields are set against the existing shelf — Water Reclaimer 60, Supply
     Workshop 50, Hydroponics 45 — with the construction raws at the ABUNDANT
     end (wood 55, stone 60) and cloth scarcer (26), because cloth's whole job
     is to be the cheap-but-slow road into Goods.
     🔴 None is priced in what it produces (rule 2), each has ≥3 resource legs
        (rule 3), and each top tier pulls a rare (rule 5). */
  {
    id: 'timberyard', name: 'Timber Yard', kind: 'production', emoji: '🪵', accent: '#c08a4a',
    desc: 'Fells, bucks and stacks. The standing dead are the one crop the Collapse left behind.',
    maxLevel: 3,
    yields: { wood: 55 }, inputs: { fuel: 12 },
    draw: { power: 10, water: 0, workers: 6, pollution: 4 },
    footprint: { w: 3, h: 2 },
    cost: [
      { cinder: 40000,  metal: 35,  supplies: 25,  fuel: 15 },
      { cinder: 96000,  metal: 85,  supplies: 60,  fuel: 38,  stone: 25 },
      { cinder: 228000, metal: 185, supplies: 140, fuel: 85,  stone: 60, memoryShards: 5 },
    ],
  },
  {
    id: 'stonequarry', name: 'Stone Quarry', kind: 'production', emoji: '🪨', accent: '#a8a29a',
    desc: 'Cuts block and rubble out of the ridge. Slow, loud, and the reason anything stands up.',
    maxLevel: 3,
    yields: { stone: 60 }, inputs: { fuel: 18, water: 10 },
    draw: { power: 22, water: 10, workers: 8, pollution: 12 },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 48000,  metal: 45,  supplies: 30,  fuel: 20 },
      { cinder: 115000, metal: 105, supplies: 75,  fuel: 48,  wood: 40 },
      { cinder: 272000, metal: 225, supplies: 175, fuel: 108, wood: 95, memoryShards: 6 },
    ],
  },
  {
    id: 'textilemill', name: 'Textile Mill', kind: 'production', emoji: '🧵', accent: '#e0b8c8',
    desc: 'Retting pits, carders and looms. Everything a person wears passes through here.',
    maxLevel: 3,
    yields: { cloth: 26 }, inputs: { water: 20, food: 8 },
    draw: { power: 18, water: 20, workers: 5, pollution: 6 },
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 52000,  metal: 40,  supplies: 35,  wood: 25 },
      { cinder: 124000, metal: 95,  supplies: 82,  wood: 60,  water: 45 },
      { cinder: 292000, metal: 205, supplies: 180, wood: 135, water: 100, dna: 7 },
    ],
  },
  /* ══ THE FREIGHT DEPOT (transport r1) ═══════════════════════════════════
     APPENDED, NOT SLOTTED IN WITH THE OTHER UTILITIES, deliberately. It is
     `kind: 'utility'` because it yields nothing and enables instead — but the
     header rule at the top of this file (storage → power → labour → producers)
     is about what a NEW city is offered FIRST, and a freight yard is nowhere on
     that path. Putting it third would hand a fresh player a charter building
     before a farm. Appending keeps that order intact and keeps this diff purely
     additive.

     ⚠ THE ID COLLISION IS REAL AND IT IS WHY THIS SAYS `freightdepot`.
     `depot` is ALREADY TAKEN — by the Supply Workshop above (id 'depot', a
     `production` building that yields supplies), and `CITY_PREREQ.archive =
     ['depot']` points at THAT one. Two ids a prefix apart is a hazard, so it is
     written down: Supply Workshop is `depot`, the freight yard is
     `freightdepot`, and NEITHER may be renamed to tidy the pair up.

     🔴 WHY A RENAME IS NOT COSMETIC: A MISSING ID DELETES A PAID-FOR BUILDING.
     ensureState() (production.state.js) filters s.placed down to the rows whose
     defId still resolves through cityProdDef() and WRITES THE FILTERED ARRAY
     BACK. The instant this entry stops existing — renamed, removed, or merely
     absent from the bundle a stale service worker served against a fresh save —
     every placed depot is erased from the save, permanently, after the player
     paid for it. This file's own history, recorded in production.state.js:
     "This project deleted paid-for buildings four rounds running."
     So `freightdepot` is a PERMANENT id, and this entry must land in the same
     deploy as anything that can place one — never one deploy behind it.

     🔴 THREE OF THE FOUR effect() KEYS ARE READ BY NOTHING IN /src/city, AND
     THAT IS THE DESIGN, NOT AN OVERSIGHT. cityBudget() reads exactly `power`,
     `workers`, `storage` and `population` off def.effect(level) and discards
     the rest — powerplant's authored `radius: 4` above is already dead in
     precisely this way. `bays` / `fleetCap` / `radius` are read on the TRANSPORT
     side, by src/transport/depot.js, which walks the placed rows and calls this
     function itself. Do NOT "fix" that by teaching cityBudget() about bays: the
     city budget is a power/crew/storage ledger and a freight number in it would
     be a second authority for a value the server (sql/038) also derives.
     This function is the SINGLE definition of the level table. Copy it nowhere. */
  {
    id: 'freightdepot', name: 'Freight Depot', kind: 'utility', emoji: '🚛', accent: '#e0a45c',
    desc: 'Loading bays, fuel bowsers and a yard. Without one your charter is paperwork — and a working yard eats crew and power the rest of the city was using.',
    maxLevel: 3,
    /* ⛽ `inputs` IS OMITTED, AND THE DESIGN DOC'S `inputs: { fuel: 30 }` IS A
       REJECTED DESIGN. Three verified facts, in the order that decides it:
         1. It could never debit a unit. `inputs` is charged only inside
            collect(), and collect() is unreachable for any def with
            `yields: null` because pending() returns `{cycles: 0}` on its first
            line for exactly that case.
         2. It would still RENDER on the card and still raise a red ⛔ NO FUEL
            halt through haltState(), whose wording is "burns 30 fuel per cycle"
            — and there is no cycle. A halt that is worded falsely is bad; a
            halt that is worded falsely AND stops nothing is worse. It would
            stop nothing: cityBudget() and depot.js both read effect() with no
            regard for halt state, so a "halted" depot keeps every bay, every
            fleet slot and its full reach.
         3. The fuel sink the doc wants is real, and it is somebody else's line.
            sql/038 says so where it defines transport_config: "Startup cost,
            salaries, fuel burn and repair bills are that file's business and
            are deliberately absent" — that file being index.html's OPS_ECON,
            reached through _opEcon(), which CLAUDE.md names as the only place
            operation pricing may live. A per-run burn priced HERE would be a
            second price for one thing, which is the failure this catalog's
            cost dial exists to prevent.
       So: no `inputs`, and when the per-run burn does ship it ships in
       _opEcon('transport') and this line stays null. The card losing a fuel
       chip is the whole cost of that. */
    yields: null, inputs: null,
    /* ⚠ THIS IS A REAL CITY LOAD AND IT SCALES WITH LEVEL — the `desc` says so
       because a player is owed the warning BEFORE they place it. cityBudget()
       multiplies every `draw` leg by the row's level and sums it across ALL
       placed rows, so a level-3 yard draws 54⚡, 24 crew, 12💧 and 42☣ — and 24
       crew is an entire level-1 Tenement block's output. The deficit is
       CITY-WIDE: haltState() reports NO_STAFF and BROWNOUT (a 0.4 throttle) on
       every OTHER building, so upgrading this can visibly stop a player's
       Foundry with no message that names the depot. Kept at the design doc's
       numbers rather than quietly shaved, because a business that costs the
       city nothing is not a business; the honest move is to say it out loud in
       the desc and in the panel, not to hide it in the tuning. */
    draw: { power: 18, water: 4, workers: 8, pollution: 14 },
    /* 🚛 THE THREE THINGS THE BUILDING DECIDES, and the reason freight is a
       building rather than a number:
         bays     — SIMULTANEOUS in-transit contracts, independent of fleet
                    size. Buying rigs alone does not scale a carrier.
         fleetCap — how many rigs the yard can park.
         radius   — reach in HOPS from the node the yard stands in. No depot in
                    reach of both endpoints ⇒ no quote, which is what stops one
                    player serving the planet from a single tile.
       🔴 sql/038 RESTATES THIS LADDER AND THE SERVER'S COPY BINDS. A migration
       cannot import this catalog, so the server states it again in SQL — but
       ONCE, in transport_caps() (grep the name; that file grew ~800 lines this
       round and every colon-and-number citation into it went stale): reach
       `3 + depot_level`, bays `least(2 * depot_level, max_bays)`, fleet_cap
       `least(4 * depot_level, max_fleet_rigs)`. Its header names itself the authority for
       the CAPS and names this file the authority for what the building COSTS
       AND DRAWS, and it records the draft it replaced: those three expressions
       "were written out at four separate call sites in the first draft" — reach
       in transport_quote, bays in transport_dispatch, both again in
       transport_set_sheet's payload — because "Four copies of a formula is four
       authorities."
       ⚠ AN EARLIER VERSION OF THIS COMMENT DESCRIBED THAT DEAD DRAFT as if it
       were the live server, and pointed a future editor at two call sites that
       no longer compute anything. Corrected here rather than left to be
       rediscovered: there is one function, and changing a multiplier below
       WITHOUT editing transport_caps() makes this panel promise bays and reach
       that dispatch then refuses — this repo's worst bug class: shown one
       number, billed by another.
       ⚠ THE SERVER CLAMPS WHERE THIS DOES NOT, AND ONE OF THE CLAMPS REFUSES A
       WRITE. max_bays defaults to 6 and 2 × 3 is exactly 6, so that clamp is
       invisible today and bites the first person who raises the bays multiplier
       without raising transport_config.max_bays. fleet_cap is clamped the same
       way against max_fleet_rigs and it is ENFORCED — by
       transport_fleet_cap_guard(), the BEFORE INSERT trigger on transport_rigs,
       which raises `fleet_cap` once a carrier's rigs reach it. So it is not a
       display number: a generous fleetCap here becomes a registration a player
       cannot make, after they have bought the rig.
       ⚠ AN EARLIER VERSION OF THIS LINE NAMED THE INSERT POLICY trg_ins AS THE
       ENFORCEMENT. Wrong, and wrong in the direction that matters: that clause
       was a draft and has been deleted, under a heading in sql/038 that reads
       "THE FLEET CAP IS NOT HERE, AND THIS IS THE LINE IT WAS WRONG ON TWICE"
       — a `stable` helper called from a WITH CHECK cannot see the rows its own
       statement is inserting, and 60 rigs went into a cap-4 charter to prove
       it. Cite the trigger, not the policy.
       ⚠ AND THE SERVER READS A COLUMN, NOT THIS FUNCTION: it caps off
       `transport_companies.depot_level` — `int not null default 1 check
       (depot_level between 1 and 3)` — which the client would send through
       transport_set_sheet(). maxLevel above must stay 3; raising it here alone
       would sell a level the server silently flattens.
       🔴 AND NOTHING IN THE SHIPPED CLIENT EVER SENDS IT. contracts.js's
       setTariff() is the only caller of transport_set_sheet and it passes
       `p_depot_level: null`, which that function coalesces back to the stored
       value. Every carrier is therefore depot_level 1 on the server whatever
       this catalog says, so an UPGRADED yard's extra bays and reach exist only
       on the client until a level-send path ships. That is not fixable from this
       file — it is stated here because this is where the ladder is defined, and
       depot.js's depotReady() is what puts it in front of the player (its
       `drift` field). Do not "fix" it by shrinking the numbers below.
       ⚠ AND NOTHING STOPS A PLAYER PLACING TWO OF THESE. renderBlueprints()
       emits a Build button for every entry in this array with no already-built
       test, and build() checks prereqs and cost and then pushes — there is no
       uniqueness test on that path for ANY building. For most entries that is
       fine (two farms is two farms). For this one it is a divergence, because
       the server's fleet cap is per-carrier off one depot_level and has no
       concept of a second yard. Deliberately NOT solved by adding a uniqueness
       rule here: `unique: true` would be a new field that every other entry and
       every read site would have to learn, to fix one building's problem, and
       /src/city has no such concept today. It is reported instead, on the
       transport side, by the module that knows what the server does. */
    effect: lv => ({ bays: 2 * lv, fleetCap: 4 * lv, radius: 3 + lv }),
    footprint: { w: 3, h: 3 },
    /* 💰 AUTHORED PRE-DIAL, like all 51 rows above it. buildingCostAt() applies
       RESOURCE_COST_MULT = 2.5 to every non-cinder leg and CINDER_COST_DIV = 3
       to the cinder leg AT READ TIME, so these numbers are NOT the price. Worked
       once, the way cost.js works its own example — RUN, not asserted:
       buildingCostAt(def, 1) returns 35,000 cinder + 238 metal + 175 supplies +
       125 stone + 75 fuel. Never hand-multiply a row to "fix" a price and never touch the two
       constants for one building — they are one knob for the whole catalog, and
       that is what keeps the UI and the spend from ever disagreeing.
       Priced against the Power Plant (the other 3×3 utility) and deliberately a
       little under it: this is the door into a whole business, not a capstone.
       💡 THE STONE + WOOD LEGS ARE ON PURPOSE A SINK for the r12 material
       chain — wood and stone got producers that round and almost nothing that
       consumes them at scale. A yard is hardstanding, decking and dunnage, so
       the fiction and the economy want the same thing here. */
    cost: [
      { cinder: 105000, metal: 95,  supplies: 70,  stone: 50,  fuel: 30 },
      { cinder: 250000, metal: 215, supplies: 160, stone: 120, fuel: 70,  wood: 80 },
      { cinder: 585000, metal: 460, supplies: 340, stone: 260, fuel: 155, wood: 175, memoryShards: 9 },
    ],
  },
];

export const CITY_PRODUCTION_BY_ID = CITY_PRODUCTION.reduce((m, b) => { m[b.id] = b; return m; }, {});

/* 🔗 THE TECH TREE — what must already stand before a building can be placed.
   ────────────────────────────────────────────────────────────────────────────
   The rule is not invented: a building requires the PRODUCER OF ITS PRIMARY
   INPUT. Textile Mill eats food+water, so it needs the farm. Munitions eats
   metal, so it needs the smelter. That is the whole grammar, and it falls
   straight out of the `inputs` already declared on every def above.

   ⚠ THE INPUT GRAPH HAS A CYCLE AND THIS TREE MUST NOT. Foundry needs fuel,
     Refinery needs metal — deriving prerequisites mechanically from `inputs`
     would deadlock a fresh city with two buildings that each require the other.
     So the three bootstrap producers (warehouse, wellhead, hydroponics) are
     deliberately ungated, the tree is hand-checked acyclic from there, and
     Refinery hangs off Foundry rather than the reverse.

   ⚠ ONE LEVEL OF DEPTH IS CHECKED, NOT THE WHOLE CHAIN. Requiring the direct
     parent is enough: you cannot own a Foundry without having owned a Stone
     Quarry, so transitivity is enforced by construction rather than by walking
     the graph on every render.

   Empty / absent = buildable from turn one. */
export const CITY_PREREQ = {
  // bootstrap tier — ungated on purpose, a new city must be able to start
  warehouse:   [],
  wellhead:    [],
  hydroponics: [],
  // utilities
  powerplant:  ['warehouse'],
  tenements:   ['hydroponics'],
  // raw extraction
  timberyard:  ['warehouse'],
  stonequarry: ['powerplant'],
  foundry:     ['stonequarry'],
  depot:       ['timberyard'],
  // refined — each behind the producer of what it consumes
  refinery:    ['foundry'],
  munitions:   ['foundry'],        // metal → ammo: the smelter comes first
  textilemill: ['hydroponics'],    // cloth off food/water: the farm comes first
  apothecary:  ['hydroponics'],
  bottling:    ['hydroponics'],
  // late tier
  sump:        ['apothecary'],
  archive:     ['depot'],
  genevault:   ['apothecary'],
  /* 🚛 THE FREIGHT DEPOT — GATED, AND NOT LEFT ABSENT. An absent id means
     "buildable from turn one" (missingPrereqs() returns [] for it), which would
     make a charter building the one thing in this catalog placeable on a bare
     grid — no other building allows that, and a yard on an empty tile has no
     grid to draw its 18⚡ from.
     ⚠ THE GRAMMAR SAYS "the producer of its primary input" AND THAT WOULD SAY
     `refinery` (fuel). Rejected, for two reasons. The depot declares no
     `inputs` at all — see the entry — so pointing at the fuel producer would
     gate the building on a line that does not exist; and refinery sits four
     deep (powerplant → stonequarry → foundry → refinery), which buries the
     entrance to a whole business behind the late game. What the depot actually
     consumes, every hour, charged and enforced, is POWER. So it hangs off the
     thing that makes power. One level deep, and acyclic: powerplant needs only
     warehouse, and nothing needs the depot. */
  freightdepot: ['powerplant'],
};

/* Which prerequisites are missing, given what the city already has placed.
   `placedIds` may be an array, a Set, or an id→count map — every caller in the
   codebase holds a different one of those and none should have to convert. */
export function missingPrereqs(defId, placedIds) {
  const need = CITY_PREREQ[defId];
  if (!need || !need.length) return [];
  const has = (id) => {
    if (!placedIds) return false;
    if (typeof placedIds.has === 'function') return placedIds.has(id);
    if (Array.isArray(placedIds)) return placedIds.indexOf(id) >= 0;
    return (placedIds[id] | 0) > 0;
  };
  return need.filter((id) => !has(id));
}
export function cityProdDef(id) { return CITY_PRODUCTION_BY_ID[id] || null; }

/* 🧪 CATALOG SELF-AUDIT — the acceptance criteria of §5, checkable rather than
   claimed. Exported so a test harness can assert them; it is NOT run at import
   time, because a data assertion that throws on load would take the whole city
   down over a tuning typo. Returns [] when the catalog is sound. */
export function auditCatalog(resourceIds) {
  const RARE = ['memoryShards', 'dna', 'corruptedEssence'];
  // ⚠ Kept in sync with index.html's RESOURCES (14 as of r12). A STALE list
  // here does not just under-report: rule 4 ("every cost key must be a real
  // resource") would flag every wood/stone/cloth cost leg below as an unknown
  // id, which is the 'intel' bug this audit was written to catch, inverted.
  const ids = Array.isArray(resourceIds) && resourceIds.length ? resourceIds : [
    'food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies',
    'metal', 'fuel', 'corruptedEssence', 'memoryShards', 'dna',
    'wood', 'stone', 'cloth',
  ];
  const problems = [];
  // 1. Every one of the resources has a producer (14 as of r12 — the count is
  //    read from `ids`, never hardcoded, precisely so this rule cannot go stale).
  const produced = new Set();
  CITY_PRODUCTION.forEach(b => Object.keys(b.yields || {}).forEach(r => produced.add(r)));
  ids.forEach(r => { if (!produced.has(r)) problems.push(`no building yields "${r}"`); });
  CITY_PRODUCTION.forEach(b => {
    const levels = Array.isArray(b.cost) ? b.cost : [];
    if (levels.length !== b.maxLevel) problems.push(`${b.id}: ${levels.length} cost rows for maxLevel ${b.maxLevel}`);
    levels.forEach((row, i) => {
      const keys = Object.keys(row || {}).filter(k => k !== 'cinder' && (row[k] | 0) > 0);
      // 2. Never priced solely in what it produces.
      const mine = Object.keys(b.yields || {});
      if (keys.length && mine.length && keys.every(k => mine.indexOf(k) >= 0)) {
        problems.push(`${b.id} L${i + 1}: costs only what it produces`);
      }
      // 3. At least three distinct resource legs (Cinder does not count).
      if (keys.length < 3) problems.push(`${b.id} L${i + 1}: only ${keys.length} resource legs`);
      // 4. Every cost key must be a real resource — the `intel` class of bug.
      keys.forEach(k => { if (ids.indexOf(k) < 0) problems.push(`${b.id} L${i + 1}: unknown resource "${k}"`); });
      // 5. The top level pulls in a rare.
      if (i === levels.length - 1 && !RARE.some(r => (row[r] | 0) > 0)) {
        problems.push(`${b.id} L${i + 1}: top tier has no memoryShards/dna/corruptedEssence`);
      }
    });
  });
  return problems;
}
