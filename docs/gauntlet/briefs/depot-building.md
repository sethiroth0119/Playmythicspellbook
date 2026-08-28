# BRIEF — Freight Depot — the city catalog entry and its transport-side reader

## GOAL
Two deliverables. (1) Add ONE entry, `freightdepot`, to CITY_PRODUCTION in /home/user/Playmythicspellbook/public/src/city/production.data.js, plus its CITY_PREREQ line — additive, in the file's own idiom, deleting nothing. (2) Write a NEW file /home/user/Playmythicspellbook/public/src/transport/depot.js that reads the placed depot rows back out of the city module and answers the three questions the depot exists to answer: origin (which node), reach (how many hops), and concurrency (how many simultaneous contracts), plus the fleet cap. The catalog entry alone is inert — /src/city reads only four keys off `effect(lv)` and none of them are the depot's — so the reader is the half that makes the building mean anything, and it must say so.

## FILES YOU OWN (write ONLY these)
- public/src/city/production.data.js
- public/src/transport/depot.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. Both files exist; `node --check` passes on each. The production.data.js diff is purely ADDITIVE — no reindentation, no restructuring, and zero deleted or reworded existing comments.
2. The new entry's id is exactly `freightdepot`. It does NOT collide with the EXISTING `depot` entry (id 'depot', name 'Supply Workshop', production.data.js:175), and a comment notes that collision hazard.
3. `MythicCityProduction.auditCatalog()` returns [] with the new entry present. Concretely: `cost` has exactly `maxLevel` rows; EVERY row has at least 3 non-cinder legs with value > 0 (Cinder does not count); every cost key is one of the 14 live resource ids (food, ammo, water, medicine, energyDrink, supplies, metal, fuel, corruptedEssence, memoryShards, dna, wood, stone, cloth); and the TOP level includes one of memoryShards / dna / corruptedEssence.
4. Cost rows are authored in the same PRE-DIAL units as every existing entry. A comment states that `buildingCostAt()` applies RESOURCE_COST_MULT = 2.5 to every non-cinder leg and CINDER_COST_DIV = 3 to the Cinder leg at read time, so the authored numbers are not the price. RESOURCE_COST_MULT and CINDER_COST_DIV are NOT modified.
5. `CITY_PREREQ.freightdepot` is present and non-empty, keeping the tree acyclic and one level deep. Leaving it out would make a charter building placeable on a bare grid, which no other building allows.
6. The entry's `inputs` line carries a comment saying honestly what it does and does not do: `inputs` is charged only inside `collect()`, which is unreachable for any def with `yields: null`, so the fuel line renders in the card and produces a NO_INPUTS halt banner but never debits a unit. Per-run fuel is burned server-side in transport_dispatch(). Alternatively the entry omits `inputs` and says why.
7. The entry's `draw` values are modelled as a real city load and the `desc` says so; a comment acknowledges that cityBudget() sums draw across ALL placed rows and multiplies by level, so a level-3 depot's crew and power can push every OTHER building in the city into NO_STAFF or BROWNOUT.
8. depot.js exports exactly: DEPOT_DEF_ID, depots(), bestDepot(), depotEffect(level), fleetCap(garageTier), bays(), radius(), depotReady().
9. depot.js states which system is the AUTHORITY: `effect(lv)` in production.data.js is the single definition of bays/fleetCap/radius, and depot.js reads it rather than re-deriving it. A second copy of those numbers in depot.js is a fail.
10. depot.js explains, with the four key names, why the transport side must read the effect itself: cityBudget() reads only `power`, `workers`, `storage` and `population` off effect(lv) and discards everything else — powerplant's authored `radius: 4` is already dead in exactly this way.
11. depotReady() returns `{ ok, why, fix }` where a false `ok` carries BOTH a reason the UI is required to print AND a `fix` naming the concrete thing to go do (e.g. 'Build a Freight Depot in your city', 'Upgrade the depot to reach that node'). An invisible refusal is a fail.
12. Every depot.js export is absent-tolerant and total: with no city module, no bridge, no placed rows, or a malformed row, each returns a neutral typed value (0 / null / [] / {ok:false,…}) from BOTH the no-data path and the catch — never a throw, never undefined.
13. `grep -nE "\\b(Profile|Cloud|App|Corp|Forge|RESOURCES|Operations|Catalog)\\b" public/src/transport/depot.js` returns zero non-comment hits. The city module is reached via `bridge().cityProd()` (which returns window.MythicCityProduction or null), never as a bare global.
14. depot.js contains no `.from(` and no `.rpc(`.
15. A comment in depot.js records the permanence rule: `ensureState()` filters s.placed to rows whose defId still resolves via cityProdDef() and writes the filtered array back, so a depot whose catalog entry went missing at that moment is silently and permanently deleted after the player paid for it — this project's own comment records 'deleted paid-for buildings four rounds running'. Therefore `freightdepot` must never be renamed or removed once shipped.
16. Neither file contains 'discord'/'webhook' or any upload/FormData/storage.from(.

## CONTEXT
You have TWO deliverables and may write no other file:
  EDIT   /home/user/Playmythicspellbook/public/src/city/production.data.js   (additive: one CITY_PRODUCTION entry + one CITY_PREREQ line)
  CREATE /home/user/Playmythicspellbook/public/src/transport/depot.js

WHY THE DEPOT EXISTS. Transportation Companies are a new player-run business that hauls other players' freight for Cinder. The charter (a `transport` operation bought in Just Business) is the paperwork; the Freight Depot is the premises. Three things the depot decides, and they are the whole reason it is a building rather than a number:
  1. ORIGIN — the node the depot stands in is where routes start. sql/033's node hierarchy gives every node its own city, so this is a real map position.
  2. REACH — `radius`, how many hops from the depot you can quote. A carrier cannot serve the whole world from one yard; more depots is the natural sink for a growing company. Rule: no depot in reach of BOTH endpoints ⇒ you cannot quote that route. This is what stops one player owning the planet from a single tile.
  3. CONCURRENCY — `bays` caps SIMULTANEOUS in-transit contracts, independently of fleet size. Buying rigs alone does not scale you; you have to build.

The design doc's shape for the entry (adjust `cost` to satisfy the audit; keep the id, kind, effect keys):
  { id:'freightdepot', name:'Freight Depot', kind:'utility', emoji:'🚛', accent:'#e0a45c',
    desc:'Loading bays, fuel bowsers and a yard. Without one your charter is paperwork.',
    maxLevel: 3, yields: null, inputs: { fuel: 30 },
    draw: { power: 18, water: 4, workers: 8, pollution: 14 },
    effect: lv => ({ bays: 2*lv, fleetCap: 4*lv, radius: 3+lv }),
    footprint: { w: 3, h: 3 }, cost: [ … ] }

═══ GROUND TRUTH ABOUT /src/city THAT DECIDES YOUR DESIGN ═══
Read /home/user/Playmythicspellbook/public/src/city/production.data.js end to end first. Facts you must build around:

1. THERE IS ALREADY A BUILDING CALLED `depot`. production.data.js:175: `id: 'depot', name: 'Supply Workshop', kind: 'production', emoji: '📦'`, and `CITY_PREREQ.depot = ['timberyard']`, and `CITY_PREREQ.archive = ['depot']`. Your id is `freightdepot`. Do not touch the existing one.

2. THE COST DIAL. /src/city/cost.js:48-91 — `RESOURCE_COST_MULT = 2.5`, `CINDER_COST_DIV = 3`, applied inside `buildingCostAt()` at READ time: `{ cinder: 650000, metal: 200 }` is charged as `{ cinder: 216666, metal: 500 }`. Its own comment: "⚠ APPLIED HERE, NOT BAKED INTO THE 51 COST ENTRIES, on purpose. One knob to turn… so the UI and the spend can never disagree about the price." Author your rows in the same units as `warehouse` (production.data.js:59-63) and `depot` (183-187). Never multiply by hand and never touch the dial.

3. THE AUDIT, production.data.js:360-398, exported and deliberately NOT run at import. Its five rules, verbatim in effect: (a) every resource id has ≥1 building that yields it; (b) `levels.length !== b.maxLevel` is a problem; (c) a row may not be priced solely in what the building yields; (d) `if (keys.length < 3) problems.push(…only ${keys.length} resource legs)` where `keys` excludes cinder and excludes zero legs; (e) every key must be one of the 14 live ids; (f) the TOP level must include one of `['memoryShards','dna','corruptedEssence']`. Run it and confirm [] before you finish — nobody will catch this for you.

4. `inputs` ON A UTILITY IS INERT. `inputs` is charged only inside `collect()` (production.state.js:359-366), and `collect()` is unreachable for a def with `yields: null` because `pending()` returns `{cycles:0}` at its first line: `if (!def || !def.yields) return { cycles: 0, gain: {}, halt: null, cappedByTime: false };`. So `inputs: { fuel: 30 }` would render in the card, would produce a NO_INPUTS halt banner via haltState(), and would never debit a unit. The design doc's "every run burns fuel from the depot" does NOT fall out of the catalog — that fuel is burned server-side in transport_dispatch(). Either keep the line and comment it honestly as a display/halt claim that gates dispatch rather than accrual, or omit it and say why. Do not leave it implying a debit that never happens.

5. `effect(lv)` KEYS ARE MOSTLY DISCARDED. `cityBudget()` (production.state.js:91-100) reads exactly `power`, `workers`, `storage`, `population` off `def.effect(p.level)`. `bays` / `fleetCap` / `radius` are read by nothing in /src/city — `powerplant`'s authored `radius: 4` is already dead in exactly this way. That is WHY depot.js exists: it reads the placed rows and calls the def's own `effect()` itself. Keep `effect` as the single definition (do not copy the numbers into depot.js) and write the reader on the transport side rather than editing cityBudget.

6. `draw` SCALES WITH LEVEL AND IS CITY-WIDE. production.state.js:103: `workerDraw += (d.workers | 0) * p.level;` — a level-3 depot draws 54⚡ and 24 crew. `haltState()` then reports NO_STAFF / BROWNOUT (a 0.4 throttle) on every OTHER building in the city, because those halts are city-wide deficits. Planting a depot can visibly stop a player's Foundry. Model it and say so in the `desc`, or keep the numbers modest — either way, acknowledge it.

7. `CITY_PREREQ` — production.data.js:315-342. "Empty / absent = buildable from turn one." `missingPrereqs()` returns [] for any absent id. The grammar is "a building requires the PRODUCER OF ITS PRIMARY INPUT", the tree is hand-checked acyclic ("⚠ THE INPUT GRAPH HAS A CYCLE AND THIS TREE MUST NOT"), and only one level of depth is checked because transitivity is enforced by construction. A depot that eats fuel and power wants something like `['powerplant']`.

8. PERMANENCE. `ensureState()` (production.state.js:74-84) filters `s.placed` to rows whose `defId` still resolves via `cityProdDef()` and WRITES THE FILTERED ARRAY BACK with `host.setState(s)`. A depot whose catalog entry is missing at that moment is silently and permanently deleted from `Profile.cityProduction` after the player paid for it. The file's own comment: "This project deleted paid-for buildings four rounds running." So `freightdepot` must never be renamed or removed once shipped, and the catalog entry must land in the same deploy as anything that can place one.

9. PLACEMENT IS NOT VALIDATED. `build(host, defId, at)` writes x/y/z/rotation_y/scale straight from `at` with no occupancy test; `footprint {w,h}` is authored on every entry and read by nothing; `bind()` always calls `build(h, id, {})`, so every building currently stacks at the origin. Do NOT build depot origin/reach logic on the assumption that x/y/z are meaningful. The depot's map position comes from the node — `bridge().campNodeId()` and the node list — not from placement coordinates.

═══ depot.js — THE PINNED CONTRACT ═══
Other builders are importing these right now; match names and arities exactly:
  export const DEPOT_DEF_ID = 'freightdepot';
  export function depots()             // [{ id, level, effect:{bays,fleetCap,radius} }], [] when none/absent
  export function bestDepot()          // the highest-level depot or null
  export function depotEffect(level)   // { bays, fleetCap, radius } via the catalog def, never a local copy
  export function fleetCap(garageTier) // sum of depot fleetCaps + the Garage perk slot bonus
  export function bays()               // integer
  export function radius()             // integer
  export function depotReady()         // { ok, why, fix }
You import `{ bridge }` from './transport.bridge.js'. The bridge exposes `cityProd()` returning `window.MythicCityProduction` or null; that object exposes `placed()` (the placed rows) and re-exports the catalog. Reach the def through it, guarded — `if (!MP || typeof MP.placed !== 'function') return <neutral>`. index.html's own legacy→module call, `_cityProdStorage()` at index.html:39414, is the shape to copy:
  function _cityProdStorage() { try { const MP = (typeof window !== 'undefined') ? window.MythicCityProduction : null; if (!MP || typeof MP.storageBonus !== 'function') return 0; const n = MP.storageBonus() | 0; return n > 0 ? n : 0; } catch (e) { return 0; } }
⚠ `garageTier` arrives as an integer 0-3 from the caller. Tier 1 = +1 fleet slot, tier 2 = +1 run/day on every rig, tier 3 = both. That is a ratified perk that makes the $99 real-money Garage rig MORE valuable when Transport ships. Do not read a Garage SKU, do not sum tiers (the best owned rig applies; rigs do not stack), and never register a Garage rig as a fleet rig.

═══ THE BAR: what production.state.js does that you must match ═══
Judged blind against /home/user/Playmythicspellbook/public/src/city/production.state.js. Read it. Its habits:
- `ensureState()` is "🔴 ABSENT-TOLERANT ON LOAD. This project has shipped silent save bugs three times, so every field is defaulted and no shape is assumed."
- `HALT` gives every stop a distinct code, and every branch returns a `reason` the UI must print PLUS a `fix` naming the concrete thing to go do — "An invisible halt reads as a bug" — with the resource named exactly, because "'missing inputs' on a building with three of them tells the player nothing actionable." The ORDER of its four checks is individually justified (staff first, because "an unstaffed building consumes nothing and should not be reported as short of inputs it never asked for").
- It declares which system is the authority when two could disagree: "🔴 THE CAP REPORTED HERE IS THE LEDGER'S OWN CAP, NOT A LOCAL BELIEF", with the measured consequence of getting it wrong — a collect promised 810 food and banked 540, "270 units destroyed, clipped:false, and the 36h timer reset. Measured, not theorised."
- `chainRank`'s header states a rule about a data structure: "🔴 nothing here removes, reorders or rewrites a placed row. This project deleted paid-for buildings four rounds running; this function only READS the array." Your depot.js is READ-ONLY over s.placed and should say so in those terms.
And for the catalog half, match production.data.js's own conventions: box header, 🔴 for a rule already broken with the measured consequence, ⚠ for a live gotcha, a rejected design recorded with its cost, and comments that explain WHY.

═══ HARD RULES ═══
- THE GLOBALS TRAP: Profile, Cloud, App, Corp, Forge, RESOURCES are top-level `const` in index.html — lexical bindings, NOT window properties. `window.Profile` is undefined. depot.js reads nothing but the bridge.
- No npm dependencies; no bare-specifier or CDN imports.
- Nothing throws at import; the catalog assertion is exported, not run.
- ⚠ Someone else is bumping `?v=` on `src/city/index.js` in index.html so the service worker cannot serve an old catalog against a new save. Do not edit index.html.
- Never write 'discord' or 'webhook', including in a comment. No image/video upload; visuals are emoji + accent colour.
