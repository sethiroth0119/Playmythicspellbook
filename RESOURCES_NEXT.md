# Resource chain — what landed, and tomorrow's city-builder work

Written 2026-08-13. Data layer is in and deployed; **no gameplay changed yet, on purpose.**

## What landed

`public/src/resources/chain.js` — 258 entries, registered on `window.MythicResourceChain`.

| | |
|---|---|
| Requested | 258 |
| Already in the game (aliased, not duplicated) | 13 |
| Genuinely new ids | **245** |
| Categories | 26 |
| Tier 0 raw / 1 intermediate / 2 finished | 60 / 98 / 100 |

Aliased rather than redefined, because these ids already exist in `index.html`:
`seeds, wood, stone, ironOre, rareMinerals, reinforcedConcrete, fertilizer, circuitBoards,
leather, medicalSupplies, medicine, mythicEssence, soulEnergy`. They carry `existing: true`.
**Never redefine them** — the chain references the ids the game already uses.

```js
const C = window.MythicResourceChain;
C.ALL          // all 258, in the order they were specified
C.byId('steel')
C.byCat('electronics')   // 18
C.byTier(0)              // 60 raws
C.NEW_IDS                // the 245 not yet in index.html — the promotion queue
```

## 🔴 Read this before promoting anything

There are already **two** lists in `index.html`, and the difference is the whole design:

- `RESOURCES` (14, line ~39272) — the **live ledger**. Tradeable, spendable, priceable, visible in the city.
- `SALVAGE_RES` (149, line ~75348) — the **loot catalogue**. Lootable and bankable, and nothing else.

`.cityloop/_r12/new_resources.NOTES.md` records what happens to an id that sits in the
second without the first:

> *"A resource you can loot, bank, and be capped by — but cannot sell, spend, make, or see.
> That is not 'wood is missing'; it is worse than missing, because the player's pile of it is
> real and inert."*

Promoting all 245 into `RESOURCES` in one move would reproduce that **245 times**: every one
appears in every cost renderer, market dropdown and vault grid, and not one has a producer, a
terroir tier, or a city HUD entry. So **a resource is promoted together with its producer, never
before it.** That is why `chain.js` is a catalogue and today's change is inert.

## The five sites each promotion touches

From the r12 notes table — adding an id to `RESOURCES` gets you the first two for free; the
rest are real work:

| # | Site | File | What it gives |
|---|---|---|---|
| 1 | `RESOURCES` → `RESOURCE_IDS` | `index.html:~39272` | market listing + cost legs render |
| 2 | `_normCost` / `_facCostAt` | `index.html:~65328` | can price a facility |
| 3 | `CITY_PRODUCTION` | `src/city/production.data.js` | **a producer — without this it is unmakeable** |
| 4 | `MythicTerroir` `FALLBACK_IDS` | `src/city/terroir.js` | a tier / regional yield |
| 5 | node-city `RES_META` + HUD | `node-city/index.html:~1815` | visible in the builder |

## Suggested order for tomorrow

Work **up** the chain, so nothing is ever promoted before its inputs exist:

1. **Tier 0 raws first** (60) — they need no inputs, so a producer is just an extractor.
   Start with the ones the city already implies: `rawWater`, `wheat`, `corn`, `sand`, `clay`,
   `limestone`, `gravel`, `coal`, `crudeOil`, `naturalGas`.
2. **Then tier 1** (98) — each needs its inputs promoted first. `flour` ← `wheat`,
   `lumber` ← `timber`, `pigIron` ← `ironOre`, `cement` ← `limestone`.
3. **Tier 2 last** (100) — the things a city consumes or sells.

`inputs: []` on every entry is deliberate and is the recipe slot. Fill it as each producer
lands, so the catalogue and the production data can never disagree about what makes what.

## Conventions that already bind this work

- **The globals trap.** `Profile`, `Cloud`, `App`, `Corp`, `Forge`, and `RESOURCES` are
  top-level `const` — lexical bindings, **not on `window`**. A module cannot read them.
  Everything crosses through `window.MythicCityBridge` / `MythicBridge`. Add to the bridge;
  never reach for a bare global.
- **Bump `?v=` on the script tag for every `/src/*` edit.** The service worker caches those
  like any other static asset and a missed bump ships invisibly. `chain.js` is currently
  `?v=v120w5chain1`.
- **All operation pricing goes through `_opEcon()`.** Never hardcode economy numbers.
- **Deploy moves three knobs together**: `public/version.txt`, `window.BUILD_VERSION`,
  `sw.js CACHE_VERSION`. Verify at the EDGE with curl, and poll — propagation takes minutes.
- **Commit before every deploy.** `deploy.mjs` minifies `index.html` in place and restores
  afterwards; if the machine dies mid-deploy the tree is left holding the 9 MB minified build,
  and `git checkout -- public/index.html` is the recovery — which only works if you committed.
- **Syntax-check with `node _synckcheck.mjs`**, and pass the files you touched. It defaults to
  `public/index.html` only, so work elsewhere under `public/` is otherwise ungated.
  ⚠ It uses terser, which **cannot parse JSX** — it reports FAIL for the market site whether or
  not anything is wrong. That file needs a Babel-based check instead.

## Open questions for tomorrow

1. **Does the city builder use its own resource ids?** node-city has `RES_META` and building
   `gen: { food: 1.5 }` entries. Confirm whether promoted ids flow through automatically or
   need a mapping — the r12 notes say the bridge feeds `MythicCityBridge.resources → terroir`,
   so it may be free.
2. **Storage cap.** `getResourceUnits()` counts everything against the stash cap
   (`RES_STASH_BASE = 2000`). 245 more resource types with no cap change means the same total
   space split more ways. Decide whether the cap scales with variety.
3. **How many are actually reachable?** 258 types is a lot of buildings. It may be worth
   picking the ~40 that close real loops for the city first and leaving the rest catalogued
   until there is a producer worth building.
