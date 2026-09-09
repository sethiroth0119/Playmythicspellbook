# Woods Fishing expansion — the catch is a resource

Landed 2026-09-09. Everything below is live in one branch; nothing is deployed until
the three deploy knobs are bumped together (CLAUDE.md → Verifying).

## What changed, in one paragraph

Fish are no longer "food with a splash". Every catch — from the live 3D trip, from a fleet
expedition, from the Fishing Company op, or from a city Fishing Wharf — lands in the stash
as one of **four ledger resources**: `freshFish` 🐟, `shellfish` 🦪, `seafood` 🐠 (Prime
Seafood) and `seaweed` 🌿. They trade on the Player Market like wood or metal, they are
inputs to five new city buildings and one new business, and NPC institutions post
**fishing contracts** for them at a premium over the exchange price.

## The chain

```
                 live trip / fleet / Fishing Company op / Fishing Wharf
                                        │
        ┌───────────────┬───────────────┼────────────────┬───────────────┐
    freshFish       shellfish        seafood          seaweed         (Legendary → +dna)
        │               │               │                │
   🥫 Cannery       galley &       💊 Fish Oil Works ◄───┘   (seafood 6 + seaweed 12 + water 10 → medicine 14)
  (30 fish + 6     rig-kitchen     Apothecary Guild /        Salvage Union rope & compost
   metal → 70      contracts       Research contracts        contracts
   food)
   🏭 Fish Cannery op (freshFish 1.6/worker-hr → food 3.6 + supplies 0.4)
   🐠 Deepwater Pier (12 freshFish as bait + 25 fuel → 10 seafood)
   📜 canteen / cannery contracts
   ⇄ Player Market (all four)
   🧰 Cold Storage bench — instant, worse than the buildings, never lets fish rot uneaten
```

## Where each piece lives

| Piece | File |
|---|---|
| Ledger entries (+ base prices in `SALVAGE_RES`) | `public/index.html` `RESOURCES` (~39290), `SALVAGE_RES` (~75390) |
| Terroir re-derived for 18 resources | `public/src/city/terroir.js` (`slots`, `FALLBACK_IDS`, seam aliases) |
| Chain catalogue marks the four `existing: true` | `public/src/resources/chain.js` |
| City buildings: Fishing Wharf, Kelp Beds, Deepwater Pier, Cannery, Fish Oil Works | `public/src/city/production.data.js` (+ `CITY_PREREQ`) |
| Ops: Fishing Company now yields fish; new **Fish Cannery** op | `OPS_ECON` / `OP_LABELS` (~79760) |
| Fleet expeditions drop fish | `WF_FISH_DROPS`, `wfResolveExpedition` |
| Live 3D trip (species→resource, weather, day/night, schools, sonar, aim, FX, deckhand, boat hold, gear) | `index.html` WF3 block (~193430–194700) |
| Economy module: supply board, processing bench, contracts | `public/src/fishing/{demand,render,index}.js` |
| Bridge | `window.MythicFishingBridge` next to `MythicCityBridge` |
| Screen tabs | `renderWoodsFishing` → COLD STORAGE (module) + CONTRACTS (module), legacy panel is the fallback |

## The 3D trip, what's new for the player

- **Species are resources.** Each loot row carries `res`, `units`, `kg`, `time`. Weight is rolled
  (skewed small, nudged by angler level and storms); units scale with weight; the Catch Log keeps
  the heaviest specimen per species.
- **Day/night.** Trip clock starts at the player's local hour, one in-game hour every 40 s. Sky
  dome, sun/moon, stars and light all lerp. Nocturnal species (`time: 'night'`) barely bite by day.
- **Weather.** Clear / Sea Fog / Rain / Storm, rolled at cast-off and drifting every ~90 s. Fog raises
  rare luck, rain speeds bites, storms add encounters and surge the line. Lightning flashes. Boat
  sway scales. Outriggers gear damps storm surge.
- **Schools + sonar.** Two or three translucent schools drift across the lane; the luck ring rides
  one of them, so the target moves. Casting into a school triples that tier's weight. The sonar
  (bottom-left) shows blips; the Fish Finder gear (or level 12) colours them by tier.
- **Aim.** Pointer x sets the landing lane (±8 units), so a school off to port is reachable.
- **Deckhand.** Pick an idle crewman in EXPEDITIONS; traits ride along (lucky, hard worker,
  veteran, hunter, coward, lazy, smuggler, unstable, aggressive, alcoholic — table `WF3_TRAIT_FX`).
- **Boat matters.** Hold = 15 units × class crew slots (Ice Hold +50%); speed adds cast range;
  hull adds line strength. The boat wears 2 condition per trip, more in storms.
- **Gear** (Outfitter → Gear tab): Fish Finder, Ice Hold, Outriggers, Kelp Knife.
- **Stash full ⇒ fish spoil, and the card says so.** Nothing is lost silently.

## Contracts

`demand.js` seeds a 4-order board per 8-hour window from `(windowKey, userId)` with the same
xorshift/FNV pair terroir uses, so it cannot be re-rolled by reloading. Payout is
`units × live exchange price × premium`, re-priced at delivery (never at render). Delivery calls
`bumpMarketPriceUp` — demand is real on the Crash Exchange. The ledger (`filled/earned/delivered`
and the per-window `done` map) lives on `Profile.fishingCorp.contracts` and rides the existing
`__fishingCorp__` cloud sync.

## Things deliberately NOT done

- No Supabase table. Contracts are client-seeded and client-settled through the existing wallet
  helpers, exactly like the smuggler board. If contracts ever need to be shared or audited, that
  is a `fishing_contracts` migration with RLS, not a change here.
- The `medical` op did not gain a fish input. Adding an input to an existing op throttles every
  player who lacks it to 0 (`_opComputed` uses the worst coverage ratio). Fish demand went into
  NEW buildings and a NEW op instead.
- Terroir re-deals every surveyed player's ground (18-slot bag). r12 accepted the same for +3.

## Verifying

- `node _synckcheck.mjs` → ALL CLEAN.
- `node --input-type=module -e "import('./public/src/fishing/demand.js')…"` — the pure module is
  unit-drivable; see the smoke script in the session for the calls.
- Headless Chromium (Playwright, three r128 served locally because the CDN is blocked in the
  sandbox): tabs render, `Gut & Salt` moves 5 fish → 7 food, a contract pays and writes the ledger,
  the 3D trip boots, casts, bites, reels, banks `freshFish` (+ seaweed by-catch) and records a
  trophy weight, gear tab renders, storm weather applies, docking clears the overlay. No page errors.
- ⚠ The Browser pane in this environment does not composite (no RAF) — use real Chromium for the trip.


# Round 2 — boats that matter, things that bite

## Boats
- Every class now carries `armor`, `sonar`, `stability` alongside cap/fuel/hull/speed, and all of
  them are read (`_wfBoatStats`): armor soaks bites and expedition damage, sonar + the Sonar Array
  reveal school tiers, stability scales swell and storm surge, speed decides flee odds and cast range.
- **Hull is health.** The trip HUD shows it; storms chip it, sharks bite it, Bilge Pumps regen it.
  Zero hull = wrecked: half the haul goes overboard, the boat is `damaged`, the drydock takes over.
- **Boat XP → levels → refit slots** (L2/L4/L6; +1 armor at L5). XP from catches, trips, kills,
  expeditions. `WF_BOAT_MODS`: Harpoon Mount, Reinforced Hull, Extended Hold, Sonar Array, Bilge
  Pumps, Chum Guard — paid in drydock stock, ledger resources and Cinder. DOCKS → ⚙ REFIT.

## Threats (the 3D trip)
- A **threat meter** rises per cast (biome, blood bait, night, storm, fog; big fish add chum; Chum
  Guard and a hunter deckhand slow it; the "Something hungry" tide speeds it). Full → an attacker
  from `WF3_THREATS[biome]` surfaces, circles in 3D, lunges every ~5 s for `bite − armor` hull.
- Three answers on the card: **Harpoon** (needs the mount, 3 ammo a shot, 15–30 + boat level dmg),
  **Flee** (0.45 + 0.15·(speed − its speed), costs 2 casts + 2 fuel), **Card Battle** (existing
  encounter path; win → parts + drops, loss → two free bites on the docked hull and the deckhand).
- Kills drop **Leviathan Parts** (`monsterParts`, 19th ledger resource, base ¢1,500) plus anomaly
  extras (memory shards / corrupted essence). Deckhands can be hurt or lost on a bite.

## Crew
- Level from exp (`_wfCrewLevel`), rank titles Deckhand→Captain, +1% trip luck per level.
- `_wfCrewHurt`: health 0 can be lethal (30%, 10% for veterans/hunters). Fleet expeditions hurt
  crew per 15 hull damage; monster events single someone out.

## Fleet
- Expedition damage is soaked by armor (never below 20% of the roll). Monster/anomaly events the
  boat survives with armor ≥3 or a hunter drop parts; anomalies drop essence. Extended Hold +25% haul.

## Economy
- `rendery` city building (Leviathan Rendery: parts + water → medicine + corrupted essence),
  Deepwater Pier lands 1 part/cycle, two new contract buyers for parts.
- **Tide events** (`demand.js` `tideFor`): one world-wide condition per 8h window, seeded by the
  window only. Moves one resource's contract premium and bite rate (herring run, red tide, kelp
  bloom, dead calm, something hungry). Shown on CONTRACTS and the trip HUD.
- **Coastal claim**: a corp holding ≥50% of any Territory Wars region gets +6–12% trip luck.

## Tournaments
- `sql/038_fishing_records.sql` — `fishing_records` + `fishing_record_submit()` RPC (security
  definer, stamps `auth.uid()`, keeps the max, clamps kg ≤120; select-only RLS for authenticated,
  no direct write policies). Run it in the Supabase SQL editor.
- Client posts a new personal best after a live catch (guarded, fire-and-forget); TOURNAMENT tab
  shows the weekly sector board per species and local trophies, and says so when offline.
