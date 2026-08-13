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

## ✅ The three open questions — answered and implemented (v120w6)

### 1. Stash cap — fixed, and today's number did not move

`getResourceUnits()` sums **every** resource against one ceiling, so the cap is shared across
however many kinds exist. At 14 kinds, 2,000 units is ~143 of each; at 258 it would have been
~8 of each, and `_stashEnforceCap()` — which jettisons from the biggest pile — would have been
trimming players constantly for collecting broadly. That punishes the exact behaviour the city
builder is about to ask for.

The floor is now expressed **per kind** and derived from the live ledger:

```js
const RES_STASH_PER_KIND = 143;
function _resStashFloor() {
  return Math.max(RES_STASH_BASE, RESOURCE_IDS.length * RES_STASH_PER_KIND);
}
```

| ledger kinds | floor | per kind |
|---|---|---|
| 14 — today | 2,002 | 143 |
| 54 — after wave 1 | 7,722 | 143 |
| 258 — full catalogue | 36,894 | 143 |

143 × 14 = 2,002, so **today is unchanged**. This is not a buff — it is the same allowance held
still while the denominator moves. It rises on its own with each promotion and never needs a
second edit. `RES_STASH_BASE` (2,000) stays as a hard floor underneath, and vault rows +
Warehouse staff still stack on top, untouched.

### 2. Scope — 40 first-wave ids, marked `core: true`

Chosen for **closure, not coverage**: every one sits in a chain that runs raw → refined →
consumed, with nothing dangling. 13 raws + 27 intermediates, and deliberately **no tier 2** —
finished goods need longer chains. Verified that all 23 input pairs resolve either inside the
wave or to an id the game already has (`ironOre`, `wood`).

```js
window.MythicResourceChain.CORE_IDS   // the 40
```

The loops and their justification are in the `CORE_IDS` comment in `chain.js`. Everything else
stays catalogued and unpromoted until there is a producer worth building for it.

### 3. node-city — it was *not* free, so I made it free

`RES_META` (node-city ~line 1868) was a **hand-mirror** of `RESOURCES`, so "add an entry here"
was a fifth manual step behind every promotion. And not a cosmetic one: line ~19473 reads
`RES_META[r].ico` **unguarded** to build the shortage warning, so the first promoted resource
to run low would have thrown a TypeError inside a render and taken the panel down — the exact
failure the comment above `resIco` was written about.

`RES_META` now seeds itself from `window.MythicResourceChain`, with **existing keys winning**
(the HUD icons were chosen deliberately — stone is 🪨 not 🧱 because 🧱 is already
`CITY_STOCK.ingots`). node-city loads `chain.js` itself, above its main module, because the
iframe is a separate window with its own `window`.

**So the promotion checklist is now four steps, not five.**

⚠ `chain.js` is referenced with `?v=` in **two** files — `index.html` and
`node-city/index.html`. Bump both, or one window ships a stale table.

## Remaining open questions

1. **Does `CITY_PRODUCTION` need a building per resource, or can one building take a recipe
   parameter?** 40 producers is a lot of buildings; a generic "Refinery" that reads a recipe
   may be the better shape. Worth deciding before writing the first ten.
2. **What consumes the finished goods?** Wave 1 stops at intermediates the city eats directly.
   Tier 2 (machinery, electronics, vehicles) needs a demand sink before it is worth producing.
