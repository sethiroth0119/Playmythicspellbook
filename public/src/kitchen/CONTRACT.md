# 🍔 MYTHIC KITCHEN — THE BUILD CONTRACT

**Read this whole file before you write a line. It is the only thing keeping six parallel
builders from writing six incompatible function signatures.**

If you need something this contract does not give you, **do not invent it locally** —
say so and it gets added HERE first. That rule is the entire reason this file exists.

> 🔴 **AND THE SECOND RULE, ADDED IN ROUND 5 BECAUSE IT HAD ALREADY COST A ROUND.**
> This file drifted for four rounds. §1 listed `plateHand(now)` while the shipped
> signature took a second argument; the plate-steering verbs (`assignDish`,
> `assignmentOf`, `binPass`, `addStep`, `dumpSupply`) were shipped and absent from it
> entirely; the ingredient list said 15 when 25 had shipped; the recipe list said 9
> when 19 had. **A contract that lies is how four parallel builders disagree.**
> So: **if you change an exported signature, you change §1 in the same edit.** Not in the
> handover, not next round. The export lists below were regenerated from the shipped code
> — `grep -n "^export" public/src/kitchen/*.js` — and §12 records which round moved what.
> Regenerate them the same way before you trust them.

---

## 0. THE THREE RULES THAT BREAK EVERYTHING IF IGNORED

1. **🔴 THE GLOBALS TRAP.** `Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES`,
   `getRes`, `addRes`, `spendResources`, `showToast`, `gcConfirm`, `render`, `saveProfile`
   are top-level `const`/function declarations in index.html. They are **lexical** globals.
   They are **NOT on `window`**. `window.Profile` is `undefined`. An ES module cannot see
   any of them. Everything arrives through `window.MythicKitchenBridge` (§7) and nowhere
   else. This has cost real time three times. It will not cost it a fourth.
2. **🔴 ONLY `kitchen.state.js` (and the two files it calls: `drivethru.js`, `convoy.js`)
   MAY MUTATE `Kitchen`.** Render reads and calls actions. API reads and returns rows.
   `index.js` calls `tick()`. Nobody else assigns to a `Kitchen` field, ever.
3. **🔴 EVERY BRIDGE MUTATOR RETURNS A BOOLEAN.** Not `undefined` on success.
   The pantry restock unwind (§8) decides whether to refund from these return values,
   exactly like `/src/trading/settle.js` does. A wrapper that returns `undefined` makes
   the rollback fire on a leg that worked. `kitchen.bridge.js` `guard()` `console.warn`s
   once per key when a real bridge returns `undefined` from a mutator — it deliberately
   does not guess.

---

## 1. FILES, OWNERSHIP, EXPORTS

Eight ES modules + one stylesheet + one migration. **Own your file. Do not edit anyone
else's.** Every module **must not throw at import time** (it is loaded on every page load
of a 223k-line app) and imports nothing outside `/src/kitchen/`.

> ⚠ **NAMESPACE IMPORTS ONLY** (`import * as State from './kitchen.state.js'`).
> `kitchen.state.js` ↔ `drivethru.js` and `kitchen.state.js` ↔ `convoy.js` are import
> CYCLES. ESM resolves a cycle correctly for hoisted `function` declarations and **not**
> for `const` arrows, which are still in the temporal dead zone while the graph links.
> A namespace import binds the module record rather than a binding; guard every call site
> with `typeof`, and **touch nothing across the cycle at module-evaluation time.**

### `public/src/kitchen/kitchen.data.js`
Owns: every number and every id in the feature. **Pure data. Zero imports. Zero side effects.**
> WHY a data file at all: CLAUDE.md — "All operation pricing goes through `_opEcon()`. Never
> hardcode economy numbers." Kitchen has no `_opEcon()`, so `ECON` is it. If you write a
> number in any other kitchen file, you have written a bug.

```js
export const INGREDIENTS   // [{id,name,icon,color,unit,batch}]  the PANTRY vocabulary (§8)
export const RECIPES       // [{id,name,icon,tier,minLevel,station,cat,needs:{ingId:n},
                           //   steps:[{ing}], cookMs,doneWindowMs,burnMs,basePrice,xp,pop}]
export const STATIONS      // [{id,name,icon,kind,slots}]
export const SHELVES       // pantry bin grouping, for the restock screen
export const MENU_CATS     // menu categories; CUSTOMERS[].likes indexes these
export const SUPPLY_RECIPES// [{id,out:{ing,qty},cost:{<liveResId|'cinder'>:n}}]  §8
export const RELIEF        // 🔴 the CINDER-PRICED escape hatch. Pays out LIVE
                           //    resources, not pantry stock. Read §8.1's warning.
export const UPGRADES      // [{id,…,effect:{…}}]  owned ids live in Kitchen.upgrades
export const CUSTOMERS     // [{id,name,icon,patienceMs,tipBias,likes,order:{min,max}}]
export const CARS          // [{id,icon,name,seats,patienceMul,weight,len}]
export const CONVOY_TIERS  // [{id,name,capacity,transitMs,feePct,minLevel}]
export const DAY_NAMES, POP_FACES
export const ECON          // ALL tuning. 165 keys. See §8.
                           // ⚠ THE COUNT DRIFTS EVERY ROUND AND HAS BEEN WRONG
                           //   TWICE. Read it, never remember it:
                           //   node -e "import('./public/src/kitchen/kitchen.data.js')
                           //     .then(D=>console.log(Object.keys(D.ECON).length))"
                           //   Round 7: +COUNTER_ENABLED (was read by
                           //   kitchen.state.js and declared by nobody),
                           //   +COOKABLE_BIAS (named by a comment that lied),
                           //   −SPARK_MS (a dial wired to no FX).
export const DATA          // the whole module re-exported as one object, for the console

// lookups (all → row | null)
export function recipe(id), ingredient(id), station(id), supply(id), supplyFor(ingId)
export function salvageFor(ingId), customer(id), car(id), convoyTier(id), upgrade(id), shelf(id)
export function relief(id), salvageMenu(), salvageCinderCost(recipeId), resRetail(id)
export function cheapestRoute(recipeId, payableIn), reliefRouteCost(recipeId, parcelId)

// progression
export function xpForLevel(lv), levelForXp(xp), xpProgress(xp)
export function menuForLevel(lv, cookable), unlocksAt(lv)

// upgrade-aware derived values — ALWAYS pass Kitchen.upgrades as `owned`
export function slotsFor(stationId, owned), speedMulFor(stationId, owned)
export function cookMsFor(recipeId, owned), doneWindowMsFor(recipeId)
export function laneCap(owned), passCap(owned), pantryCap(owned)
export function patienceMul(owned), tipMul(owned), popGainMul(owned)
export function passFreshMs(owned), passSpoilMs(owned)
export function convoyCapacity(tierId, owned), convoyFeePct(tierId, owned)
export function expectedUpgradesFor(lv, lagLevels), upgradesForLevel(lv, owned)

// the day curve and the payout multipliers — state.js and drivethru.js BOTH read these,
// which is what stops two files inventing two economies
export function dayPct(tMs), hourAt(tMs), rushAt(tMs), dayName(day)
export function demandScale(level), spawnIntervalMs(pop, rush)
export function rushPayMul(rush), popPayMul(pop), qualityMul(q), faceFor(pop)
export function popDayDelta(pop, report), orderScore(recipeId, laidIds)
export function shippable(recipeId), foodCostOf(recipeId), dishValue(items)
export function capacityModel(lv, owned, pop)

// 🔴 SELF-AUDITS. Both are pure and cheap and both are printed by `__mk.debug()`.
export function convoyGuardOk()   // → is a convoy round trip still a LOSS? (§8.4)
export function assertDataSane()  // → [] when the data file is internally consistent
```

**Fixed shared vocabulary — these ids are the contract; do not rename them.**
Regenerated round 5 from the shipped tables. **The counts have grown twice; read them from
the file, not from memory.**
- Ingredients (**25**): `dough sauce cheese tomato pepperoni patty chicken bun lettuce
  onion pickle sausage potato syrup milk roll bacon chili slaw mushroom mustard mayo oil
  ice coffee`
- Stations (5): `griddle fryer oven assembly drinks`
- Recipes (**19**): `hotDog chiliDog slawDog burgerClassic burgerDouble chickenSandwich
  burgerBacon pizzaMargherita pizzaPepperoni pizzaVeggie pizzaSupreme fries sideSalad
  onionRings nuggets chiliCheeseFries soda shake icedCoffee`
- Customers (12): `commuter courier scav trucker medic suit kid raider family mayor ghoul
  guard`
- Cars (9): `hatch suv pickup van taxi bike rig bus patrol`
- Convoy tiers (3): `van truck rig`
- Numbers on all of the above are yours to tune. The **ids** are everyone's.

### `public/src/kitchen/kitchen.state.js`
Owns: the sim. **No DOM. No `document`. No `window`. No `Date.now()` inside `tick`.**
Must run to completion under `node --input-type=module` with no browser at all — that is
the test, and it is why `now` is a parameter everywhere.

`{ok,code,why}` is the universal action result. `code` is a stable machine string
(`OK NO_PANTRY NO_SLOT LOCKED CLOSED NOT_READY BAD_ARG CAP`). `why` is the player sentence
that goes to `toast()`. **Never throw across an action boundary — return `{ok:false}`.**

```js
export const Kitchen                       // the state object (§2)
export function init()                     // hydrate from bridge, catchUp convoys, → Kitchen
export function reset()                    // wipe to a fresh kitchen (admin/console)
export function tick(dt, now)              // ⏱ THE ONLY ADVANCE. → Event[] drained this frame
export function on(name, fn)               // → off() unsubscribe fn
export function emit(name, payload)        // internal + testable; render never calls it
export function seed(n)                    // reseed the deterministic RNG (tests only)
export function simulate(seconds, actions, opts)  // headless day runner. opts:{seed,step,
                                           //   quiet,gap:{at,ms}} → a settlement report

// ── shift ────────────────────────────────────────────────────────────────
export function openShift(now)             // → boolean   starts service, resets `today`
export function closeShift(now, opts)      // → boolean   opts:{forfeit:true} (§4)
export function shiftClock()               // → {hour,label,dayName,pct} for the HUD chip
export function lastReport()               // → the last day-end settlement report

// ── pantry ───────────────────────────────────────────────────────────────
export function pantryHas(needs)           // → boolean  affordability, no mutation
export function pantryRoom()               // → the cooler read: per-bin fill + cap
export function pantryLowList()            // → ingredients running out (the red bins)
export function startPantryCovers()        // → can the FIRST tap be a yes? (§9 rung 1)
export function dryCheck()                 // → 🔴 nothing cookable AND nothing affordable
                                           //   {dry,stalled,cookable[],reachable[],
                                           //    affordable[],need[],ing}
export function isDry()                    // → boolean  THE LATCHED read of the above.
                                           //   🔴 ADDED TO §1 IN ROUND 7; it shipped in
                                           //   round 6 and was missing here. Every door
                                           //   (walk-ins, the lane) gates on THIS, never
                                           //   on `Kitchen._dry` and never on its own
                                           //   dryCheck() — one truth, one reader.
export function buySupply(supplyId, batches)      // → {ok,code,why,spent} (§8.1)
export function dumpSupply(ingId, n)              // → {ok,code,why}  empty a bin; n<=0 = all
                                           //   n omitted/<=0 empties it. NO refund, ever.
                                           //   Called by the tick path's cooler recovery
                                           //   AND (once it exists) a per-bin DUMP button.

// ── 🪂 the relief drop (§8.1b) ────────────────────────────────────────────
//    🔴 ALL THREE ADDED TO §1 IN ROUND 7. They shipped in round 6 and this list did not
//    say so, which is the drift §0's second rule exists to stop.
export function reliefOffer()              // → {stalled,dry,takenToday,day,rows:[{…row,
                                           //    available,why,cinder}]}  READ ONLY. The
                                           //    Supplies sheet draws this and must NOT
                                           //    re-derive `available`/`why`.
export function buyRelief(reliefId, batches)      // → {ok,code,why,granted,spent,line}
                                           //   🔴 PAYS OUT LIVE LEDGER RESOURCES, not
                                           //   pantry stock, and is the ONE Cinder-priced
                                           //   door in the feature. The FREE row lands by
                                           //   itself on the tick path; the paid pallets
                                           //   want a button.

// ── cooking ──────────────────────────────────────────────────────────────
export function canCook(recipeId)                        // → boolean
export function startCook(stationId, slotIndex, recipeId, now) // → {ok,code,why}
export function addStep(stationId, slotIndex, ingredientId, now)// → {ok,code,why}
                                           //   🔴 refuses to lay MORE of an ingredient
                                           //   than the recipe calls for — see §8.5
export function pullSlot(stationId, slotIndex, now)      // → {ok,code,why}  slot → hand
export function dropHand()                               // → boolean  bin what's in hand
export function plateHand(now, forTicketId)              // → {ok,code,why}  hand → pass
                                           //   🔴 TWO ARGUMENTS. `forTicketId` plates AND
                                           //   pins in one gesture; a REFUSED pin never
                                           //   fails the plating.
export function binPass(dishId)            // → {ok,code,why}  triage, NOT failure (§8.6)
export function slotPhase(slot, now), cookPct(slot, now), burnPct(slot, now)
export function qualityOf(slot, now), qMult(quality), scoreBuild(slot)

// ── the pass ↔ the board ─────────────────────────────────────────────────
export function assignDish(dishId, ticketId)  // → {ok,code,why}  PIN a plate to an order.
                                           //   `ticketId` null un-pins. A refused pin
                                           //   returns ok:false rather than silently
                                           //   ignoring the instruction.
export function assignmentOf(dishId)       // → ticketId | null   read-only, for render
export function newTicket(k, opts)         // → ticket   drivethru.js files lane orders here
export function ticketPct(ticket, now)     // → 0..1 of the deadline BURNT THROUGH.
                                           //   ⚠ THE OPPOSITE SENSE TO drivethru's
                                           //   `patiencePct`, which returns REMAINING.
                                           //   Both are deliberate — the board bar FILLS
                                           //   as time runs out, the car bar EMPTIES — and
                                           //   the pair is exactly why §1 has to say so.
export function passStalePct(dish, now)    // → 0..1  how far a plate is toward spoiling
export function serveTicket(ticketId, now) // → {ok,code,why,paid,tip,xp}
export function quoteTicket(ticketId, now) // → {paid,tip,total,xp,units,quality,onTime,
                                           //    complete} | null   WHAT THIS ORDER PAYS
                                           //    RIGHT NOW. Pure. 🔴 ADDED TO §1 IN ROUND 7
                                           //    (shipped round 6). It is the till's own
                                           //    arithmetic — print this figure beside the
                                           //    SERVE button or print no figure.

// ── progression ──────────────────────────────────────────────────────────
export function xpProgress()               // → {level,into,need,pct}
export function menu()                     // → menuForLevel(K.level)
export function ownsUpgrade(id)            // → boolean
export function buyUpgrade(upgradeId)      // → {ok,code,why}

// ── persistence (§5) ─────────────────────────────────────────────────────
export function snapshot()                 // → the SAVED subset only
export function hydrate(saved)             // ← the SAVED subset only
export function save(force)                // → boolean  debounced write
```

### `public/src/kitchen/kitchen.render.js`
Owns: every pixel. Reads `Kitchen`, calls actions, subscribes to events. **Never writes
game truth.** The only state render owns is view state (which panel/bin is selected).
```js
export function open()                     // build overlay, wire delegated listeners, paint
export function close()                    // remove overlay, drop subscriptions
export function paint()                    // FULL structural repaint. Expensive. Rev-gated.
export function frame(dt, now, events)     // per-frame CHEAP updates: timers, bars, clock,
                                           // car positions, FX. No innerHTML of containers.
export function isOpen()                   // → boolean
export function toastEvents(events)        // map sim events → bridge.toast() lines
```
> ⚠ `paint()` rebuilds nodes and therefore drops focus and scroll. Countdowns MUST be
> updated in `frame()` by writing `style.width` / `textContent` on existing nodes.
> Repainting a ticket board 60×/sec is the bug that makes the board unusable.

### `public/src/kitchen/kitchen.css`
Owns: all styling. A real stylesheet — no `<style>` string soup in JS.
Every selector is namespaced `.mk-*` and scoped under `#mythic-kitchen-ov`.
**Must be legible and playable at 360px wide AND at desktop width** — that is a hard
requirement, phones are the main platform. Mobile-first, with the layout break at 820px:
`@media (min-width:820px)` widens the counter into the landscape layout and
`@media (max-width:819px)` carries the phone-only overrides. Two more exist and are not
layout — `prefers-reduced-motion` and a `pointer: coarse` tap-target bump.
⚠ **A phone-only rule is a rule nobody testing on desktop will ever see fail.** Round 4
shipped the promise summary printed on top of "AT THE WINDOW" in the same grid area, at
360/390/430/819 and clean at 900/1280. Sweep both sides of the break.
Loaded by `index.js` injecting a `<link>` (§9) — **not** by an index.html edit.

### `public/src/kitchen/drivethru.js`
Owns: NPC customers, the lane, patience, tips, set pieces, the promise mechanic
(§MODIFIERS), and the lane's WRITING. Pure functions over `K`; never schedules anything.
```js
export function tick(K, dt, now)           // → Event[]  spawn/advance/expire
export function spawn(K, now, force)       // → car | null   (null IS the balk)
export function serveCar(K, carId, now)    // → {ok,code,why,paid,tip,xp,custName,icon,line,
                                           //    honoured,broken,unproven,modCinder,modPop,
                                           //    modLine,mods[]}
                                           //   🔴 CALLS State.serveTicket() ITSELF.
                                           //   Do NOT also call it — that is a double pay.
export function waveCar(K, carId, now)     // → {ok,code,why,custName,icon,pop}
                                           //   pop cost, NO lost ticket
export function patiencePct(car, now)      // → 0..1 patience REMAINING. 1 = fresh arrival,
                                           //   0 = gone. (Resolved round 5; the bar EMPTIES.)
export function tipFor(K, car, quality, now) // → a FRACTION of the payout, 0..1 — never
                                           //   absolute Cinder. state.js multiplies.
export function fitScore(item, dish)       // → +1 per promise this plate keeps, −1 per
                                           //   promise it breaks, 0 unprovable. Consumed by
                                           //   state.js `planPass()` and render's picker.
export function modVerdict(K, car, now)    // → the live per-promise verdict, for the chips
export function clearLane(K)               // → void     shift close
export function laneView(K)                // → cars in draw order (front first)
export function laneStatus(K, now)         // → the HUD chip. `label` is the thing to print.
export function laneCard(K, now)           // → the pinned window/next strip, resolved
export function passersBy(K, now)          // → drive-past records (§BALK), with `lane`/`pct`
export function regulars(K)                // → this shift's regulars ledger
export function arrivalPlan(opts)          // → a deterministic replayable rush (critic tool)
export function econAudit()                // → {gaps,pending,ok}  ok:true is the only
                                           //   state this file ships in
export function voiceAudit(budget)         // → {budget,over,max,ok}  every authored line
                                           //   that cannot fit the speech bubble
```

### `public/src/kitchen/convoy.js`
Owns: composition, transit, arrival, claim. **The only part of the sim that advances on
wall-clock while the panel is shut** (§4).
```js
export function manifest(K, tierId, wanted)// → the loading screen's resolved payload
export function compose(K, tierId, items, forNetwork) // → {ok,code,why,convoy}
                                           //   🔴 FOUR ARGUMENTS. `forNetwork` is the
                                           //   in-flight cap's strict/permissive switch;
                                           //   omit it and unconfirmed launches do NOT
                                           //   count. See the note below.
export async function launch(K, convoy, toUserId, now) // → {ok,code,why,id}  local first, then api
export function tick(K, dt, now)           // → Event[]  flips transit→arrived
export function catchUp(K, now)            // → Event[]  offline gap; called by init() and open()
export async function refreshInbound(K)    // → boolean  guarded api.listInbound()
export async function claim(K, convoyId, now) // → {ok,code,why,granted}  §8.4 payout + cap check
export function board(K), progress(c, now), route(c, now)
export function held(K), heldFood(K)
export function arrival(K, now), ackArrival(K, id)   // the arrival moment + its dismissal
export function banner(K)                  // 🔴 THE WHOLE degradation ladder as one
                                           //   finished sentence: {rung,text}, rung is
                                           //   'ok'|'missing'|'offline'|'netError'|'pending'
export async function recipients(fragment, K)
export function recentPartners(K, limit)
```
Convoy `state` values: `pending` → `transit` → `arrived` → `claimed`, plus `held`
(quota) and `delivered` (the sender's copy once the recipient has claimed).

> 🔴 **ROUND 6 REMOVED EIGHT EXPORTS FROM THIS LIST AND THE REASON IS §0's.**
> `estimate` `shippablePass` `pending` `docking` `claimableAt` `netError` `history`
> are now module-internal, and `leaderboard` is deleted outright along with
> `kitchen_stats`. Every one of them was exported, listed here, and named by **no
> other file** for four rounds — an export is a promise that something across a
> file boundary depends on the signature, and six builders read §1 to decide what
> they may rely on. What each was for still reaches the screen, through the
> function that was always the real answer: `banner()` carries the depot's state
> **and the unconfirmed launches**, `manifest()` carries the quote and the bins,
> `route()` carries the dock beat and the road.
>
> ⚠ **`compose()`'s fourth argument is the practice-run lane.** A `pending`
> launch — one whose reply was lost — occupies a slot on the SERVER, so it counts
> against a real shipment and against nothing else. Round 5 counted it always, and
> three lost receipts disabled the offline practice run underneath a banner
> promising "practice runs still work". `launch()` resolves the recipient FIRST
> and passes the answer in; a caller that does not know yet (the renderer's
> pre-flight) omits it and gets the permissive count. Do not "fix" that default.

### `public/src/kitchen/kitchen.api.js`
Owns: **every** Supabase call. If a query lives anywhere else, that is the bug.
Copy `/src/community/community.api.js` exactly: `MISSING_RE`, `client()`, `fail()`, `OFFLINE`.
**Every function returns `{ok, rows|row, missing?, offline?, error?}` and NEVER throws.**
A 404 on a table is an empty list, never a crash.
```js
export async function listInbound(limit = 40)        // → {ok,rows}
export async function listOutbound(limit = 40)       // → {ok,rows}
export async function insertConvoy(payload)          // → {ok,row}   RPC kitchen_convoy_launch
export async function findConvoysByRef(refs)         // → {ok,rows}  idempotency recovery
export async function claimConvoy(convoyId)          // → {ok,row}   RPC kitchen_convoy_claim
export async function listConvoyLedger(convoyId, limit = 20) // → {ok,rows}  append-only
export async function findPlayer(nameFragment, limit = 12) // → {ok,rows}
```
> ⚠ `insertConvoy` is a misnomer kept for the call sites: there is **no client INSERT** on
> `kitchen_convoys` at all. It calls the launch RPC, which computes `arrives_at` on the
> SERVER clock. See §10.

### `public/src/kitchen/kitchen.bridge.js`
Owns: the seam + total-degradation fallbacks + tiny shared formatters.
```js
export function bridge()                   // → real bridge, or NULL_BRIDGE (never null)
export function bridgeReady()              // → boolean   (!bridge()._null)
export function bridgeReason()             // → why it is not ready, for the debug panel
export function esc(t)                     // HTML escape
export function fmtNum(n)                  // 1.2k / 3.4M
export function fmtCinder(n)               // "◈ 12,400"
export function fmtClock(hourFloat)        // "01:18 PM"
export function fmtMs(ms)                  // "1:04" countdown
export const NULL_BRIDGE                   // exported so headless tests can inject it
```
`NULL_BRIDGE` mirrors **every** key in §7 with a zero/false/no-op. The whole feature must
render and play against `NULL_BRIDGE` alone — that is how it is tested headlessly.

### `public/src/kitchen/index.js`
Owns: registration, the **one** RAF loop (§3), the CSS `<link>`, the public surface.
```js
export function open(), close(), paint(), isOpen()
window.MythicKitchen = {
  version, open, close, paint, isOpen,
  state: Kitchen, sim: State, ui: Render, data: Data, api: Api, convoy: Convoy,
  bridgeReady, bridgeReason, debug(), NULL_BRIDGE,
};
window.__mk = window.MythicKitchen;        // console shorthand, like __mc
// dispatches CustomEvent('mythic:kitchen-ready') so index.html can unhide the tile
```
Registration is wrapped in try/catch. A failure here makes the tile not appear; it does
not take the game down.
> ⚠ **index.js does NOT import `drivethru.js`.** `debug()` therefore cannot print
> `econAudit()` / `voiceAudit()`. That is a live handover ask in drivethru.js (item C10),
> not an oversight to "fix" by adding an unused import.

### `sql/038_kitchen_convoys.sql`
§10. Idempotent, re-runnable, RLS in the same file, ends with a verify block.

### index.html gets EXACTLY THREE EDITS (one agent, nobody else touches this file)
1. `window.MythicKitchenBridge = {…}` beside the other bridges (**index.html:207495**).
2. One tile that calls `window.MythicKitchen.open()`, hidden until `mythic:kitchen-ready`
   (**~114708**).
3. `<script type="module" src="src/kitchen/index.js?v=…"></script>` (**223230**).
> Still exactly three, verified round 5. The stylesheet is deliberately **not** a fourth
> edit — `index.js` injects the `<link>`. The battle CSS is `<link>`ed from index.html; we
> do not follow that here because every extra edit to an 11.6 MB file is a merge hazard
> for one line of markup.

---

## 2. THE STATE OBJECT

Regenerated round 5 from `kitchen.state.js`'s `Kitchen` literal.

```js
export const Kitchen = {
  v: 1,                  // save-format version. Bump → write a migration in hydrate().
  rev: 0,                // 🔴 monotonic. ANY structural mutation ++ it. Render repaints
                         //    structure only when rev changes; timers update every frame.
  open: false,           // panel visible. The RAF loop runs ONLY while true.
  now: 0,                // ms epoch of the last tick. state.js reads THIS, never Date.now().

  // ── SHIFT CLOCK (in-game day) ─────────────────────────────────────────────
  shift: {
    day: 1,              // 1-based, persists forever. Weekday = DAY_NAMES[day % 7].
    tMs: 0,              // ms elapsed inside the current in-game day
    running: false,      // service open → customers spawn
    rush: 1,             // demand multiplier from the day curve, recomputed each tick
    bail: null,          // 🔴 THE UNFINISHED SHIFT — {day,tMs,owed,today} or null. SAVED.
                         //    The whole of the anti-rewind; `owed` is a COUNT, never a
                         //    popularity number. See closeShift/openShift.
  },

  // ── PROGRESSION ───────────────────────────────────────────────────────────
  level: 1,
  xp: 0,                 // TOTAL lifetime xp. Level is derived: levelForXp(xp).
  popularity: 50,        // 0..100. The emoji face + meter. Drives spawn rate and tips.
  upgrades: [],          // owned UPGRADES ids. SAVED. Feeds every DATA.*(…, owned) helper.

  // ── PANTRY — the kitchen's OWN stock. NOT the 14-id live ledger. (§8) ──────
  pantry: {},            // ingredientId → integer units. Capped by DATA.pantryCap(owned).

  // ── STATIONS ──────────────────────────────────────────────────────────────
  stations: {},          // stationId → { slots: [slot|null, …] }  length = slotsFor()
                         // slot = { recipeId, startedAt, doneAt, burnAt, steps:[ingId] }
                         // 🔴 'raw'|'cooking'|'done'|'burnt' is DERIVED from now vs
                         //    doneAt/burnAt. Never store a state string — it goes stale.
  hand: null,            // { recipeId, quality, mult, built } lifted off a station, or null
  pass: [],              // plated and waiting: [{id, recipeId, quality, mult, madeAt,
                         //   built:[ingId], assembled, forTicket }]

  // ── TICKETS ───────────────────────────────────────────────────────────────
  tickets: [],           // [{ id, source:'counter'|'drive', carId|null, custId, name, icon,
                         //    line, items:[{recipeId, qty, filled, qsum, xn, pn, mods[],
                         //    built[] }], placedAt, dueAt,
                         //    state:'open'|'ready'|'served'|'lost', paid:0, tip:0 }]

  // ── DRIVE-THRU LANE — drivethru.js owns this array outright ───────────────
  lane: [],              // [{ id, carId, custId, name, icon, vehicle, vehicleIcon,
                         //    vehicleName, len, ticketId, arrivedAt, expiresAt, patienceMs,
                         //    pos, target, slot, station:'window'|'speaker'|'queue',
                         //    mood, special, exitDir, say, sayUntil,
                         //    state:'rolling'|'ordering'|'waiting'|'gone',
                         //    phase:'approach'|'order'|'wait'|'collect'|'exit' }]

  // ── CONVOYS ───────────────────────────────────────────────────────────────
  convoys: [],           // MINE, outbound. SAVED.
  inbound: [],           // server rows addressed to me. [] when offline or table missing.

  // ── TALLIES ───────────────────────────────────────────────────────────────
  today:  freshToday(),  // 🔴 ONE definition of the shape. served lost burnt spoiled binned
                         //    turned earned tips xp qsum qunits raw perfect ms
  totals: { served, lost, burnt, spoiled, binned, earned, days },   // lifetime, SAVED

  startGranted: false,   // 🔴 THE STARTING-STOCK RECEIPT. SAVED, or every open re-grants.

  // ── CLOUD STATUS — the Corp.* triple, verbatim ────────────────────────────
  missing: false,        // sql/038 has not been run → UI says "not set up yet"
  offline: false,        // signed out / no cloud
  error: null,

  // ── DERIVED. NEVER SAVED. ─────────────────────────────────────────────────
  _fx, _events, _lastSave, _seq, _seed, _nextCounter, _lowSeen, _dry, _report, _init,
  _stalled, _stallSince, _dryAt,
  _cookable,// 🆕 r7. Latched dryCheck().cookable. spawnCounter() biases walk-in
           //     orders toward it (ECON.COOKABLE_BIAS) without pricing a restock
           //     basket per arrival. Refreshed beside _dry, on the same throttle.
  _lane,   // drivethru.js's per-shift book: spawn timer, regulars ledger, stats, passers
  _arrival,// convoy.js's "a truck just landed" moment, until ackArrival()
};
```

> 🔴 **THREE KINDS OF WASTE AND THEY ARE NOT ONE NUMBER.** `burnt` is NEGLECT (a slot
> crossed `burnAt`, or a plate rotted on the pass) and is the only one `gradeFor()` reads.
> `spoiled` is the pass half of `burnt`, counted in both. `binned` is TRIAGE — the player
> deliberately binning a plate — and **must never be scored as failure**: breaking the pass
> deadlock is mandatory play, and the shipped build charged `today.burnt` for it, so
> correct play was booked as incompetence.

---

## 3. ⏱ THE TICK CONTRACT

**`index.js` owns the one and only `requestAnimationFrame` loop.** Nothing else in
`/src/kitchen/` may call `requestAnimationFrame`, `setInterval`, or a simulation
`setTimeout`. (Render may use `setTimeout` **only** to remove a finished CSS animation node.)

> WHY index.js and not render.js: `state.js` must be headlessly testable, so it cannot own
> a loop. `render.js` must not own game truth, so it cannot decide when the sim advances.
> `index.js` is the only file that knows the feature is open. That leaves exactly one answer.

```js
// index.js — the whole loop, verbatim shape
let _raf = 0, _last = 0;
function loop(ts) {
  if (!Kitchen.open) { _raf = 0; return; }
  const now = Date.now();
  let dt = _last ? (ts - _last) : 16;
  _last = ts;
  // 🔴 CLAMP. A backgrounded tab hands you a 40-second dt and burns a whole
  //    shift — every ticket expires at once and popularity floors. Clamp it.
  if (dt > ECON.MAX_DT_MS) dt = ECON.MAX_DT_MS;
  const events = State.tick(dt, now);      // ← sim advances HERE and only here
  Render.frame(dt, now, events);           // ← pixels react, never decide
  _raf = requestAnimationFrame(loop);
}
```

Inside `State.tick(dt, now)`, in this order, every frame:
1. `K.now = now`; advance `shift.tMs` and `today.ms` by the clamped step; recompute
   `shift.rush`; roll the day over.
2. Station timers (derive done/burnt from `now`; emit `cook:done` / `cook:burnt` on crossing).
3. `DriveThru.tick(K, dt, now)` → events.
4. Ticket expiry → `ticket:lost`, popularity hit. Pass staleness → spoil.
5. `Convoy.tick(K, dt, now)` → events.
6. Popularity/XP settle; `save()` if the debounce is due.
7. Return the drained `K._events`.

**Sub-modules receive `(K, dt, now)` and return `Event[]`. They never schedule anything and
never read the clock themselves.** That is what makes a headless test able to run a whole
in-game day in one loop of fake `dt`s.

> ⚠ **A CLAMPED FRAME LOSES TIME, AND THE LOST TIME IS PAID BACK BY A SKEW.**
> `skewClocks(ms, now)` in state.js pushes every absolute stamp in the game forward by the
> amount the clamp swallowed, so a backgrounded tab does not silently expire the board.
> 🔴 It reaches into `K.lane`, which belongs to drivethru.js, and its own comment says the
> right shape is a `DriveThru.skew(K, ms)` entry point. **That is an open cross-file item**
> (drivethru.js handover O6, with the signature written out). The hand-rolled list is
> already missing `car.orderStartedAt` and the drive-past stamps.

**⚠ RAF NEVER FIRES IN THE BUILT-IN BROWSER PANE** (CLAUDE.md). For a real visual check use
headless Chromium via the global Playwright:
`import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';`
Harness scripts go in the scratchpad, **never in the repo.**

---

## 4. 🔴 THE SHIFT IS THE UNIT OF PERSISTENCE

**Closing the panel closes the shift.** Tickets, lane, `pass`, `hand`, station slots and
`today` are all cleared. Pantry, level, xp, upgrades, popularity, `shift.day`, `totals` and
convoys survive.

> WHY, because a reasonable person would do this differently: a ticket with a 90-second
> countdown cannot survive a page close honestly. Either it keeps running while you sleep —
> cruel, and it silently drains popularity to zero overnight — or it freezes, which turns
> the drive-thru into a turn-based game with a free pause button. Both are worse than
> "the shift ended." So we end the shift, forfeit open tickets **with no popularity
> penalty** (`closeShift(now, {forfeit:true})`), and let the player start a fresh one.

**⚠ AND THAT IS A FREE PAUSE BUTTON UNLESS SOMETHING REMEMBERS.** `shift.bail` is what
remembers: walking out mid-shift records the day, the clock and how many customers were
abandoned, it is SAVED, and re-opening on the same day resumes into it rather than handing
the player a fresh morning. `hydrate()` drops a bail record that names a different day.

**Convoys are the single exception and advance on wall-clock.** They are an hours-long
logistics promise, not a real-time reflex, so they must tick while you are away.
`Convoy.catchUp(K, now)` is called by `init()` and by `open()` and flips anything whose
`arrivesAt <= now`. It is idempotent — calling it twice must not double-arrive a convoy.

---

## 5. THE PERSISTENCE CONTRACT

**Where:** `bridge().kitchenState()` → `Profile.kitchen` (auto-created `{}`),
written back with `bridge().setKitchenState(obj)` then `bridge().save()`.
**Never touch `Profile` directly. Never `saveProfile()` directly.**

**`snapshot()` saves exactly this and nothing else** (regenerated round 5):
```
v, shift.day, level, xp, popularity, pantry, upgrades, convoys, totals,
shift.bail, startGranted
```
**NEVER SAVED (derived or ephemeral):**
`rev, open, now, shift.tMs, shift.running, shift.rush, stations, hand, pass, tickets,
lane, inbound, today, missing, offline, error, _fx, _events, _lastSave, _seq, _seed,
_nextCounter, _lowSeen, _dry, _dryAt, _stalled, _stallSince, _cookable, _report, _init, _lane,
_arrival`
— plus, inside a station slot, any `'cooking'|'done'|'burnt'` string. Cook state is
**always** derived from `now` vs `doneAt`/`burnAt`. A stored state string is a stale lie.

**How often:** `save()` is debounced to at most once per `ECON.SAVE_DEBOUNCE_MS`.
It is force-called (`save(true)`) on: `closeShift`, `convoy:launch`, `convoy:claim`,
`level:up`, `buySupply` / `buyUpgrade` success, and `close()`. It is **never** called per tick.
`setProdState`-style failure handling applies: `setKitchenState`/`save` returning `false`
is a real failure — surface it with `toast()`, do not swallow it.

**Hydrate is absent-tolerant by construction.** No `Profile.kitchen` key → a fresh kitchen,
never a throw. Unknown `v` → keep what parses, default the rest, bump to current `v`.
**Unknown pantry ids are KEPT, not dropped** — if kitchen.data.js renames an ingredient,
deleting the old key would destroy stock the player paid real resources for.

---

## 6. THE STATE ↔ RENDER CONTRACT

- **State is renderer-agnostic.** It imports nothing from `kitchen.render.js` and touches
  no DOM. It communicates in exactly two ways: the `Kitchen` object, and events.
- **Render never writes game truth.** It calls the exported actions in §1 and reads their
  `{ok,code,why}`. On `ok:false` it calls `bridge().toast(why)`. It may hold view state
  (selected bin, open panel, drag ghost) in its own module scope — nothing else.
- **Events.** `tick()` returns the frame's events **and** the emitter fires them, so a
  headless test can read the return value without subscribing.
  Event: `{ name, t /* now */, ...payload }`. **Closed set — do not add one without
  adding it here:**
  `shift:open shift:close day:roll cook:start cook:done cook:burnt ticket:new
   ticket:ready ticket:served ticket:lost car:arrive car:order car:served car:leave
   car:balk pantry:low pantry:buy level:up pop:change pay convoy:launch convoy:arrive
   convoy:claim error`
  > `car:balk` was added in round 3 (§BALK: a car reached a full lane and drove past — the
  > largest number in the business, and it used to happen in total silence). It is listed
  > here because the previous version of this section did not list it, which is how a
  > "closed set" stops being one.
- 🔴 **`name` AND `t` ARE RESERVED PAYLOAD KEYS.** Both emitters build the event as
  `Object.assign({ name, t }, payload)`, so a payload key called `name` **silently
  overwrites the event name**. drivethru.js shipped `car:arrive` with `{name: car.name}`
  once and every arrival dispatched under the event name "Kid on a BMX". Use `custName`.
- **Repaint rule.** `paint()` (structural) runs when `Kitchen.rev` changed since last paint,
  or on an explicit view-state change. `frame()` (cheap) runs every RAF and may only
  `textContent` / `style.*` existing nodes.

---

## 7. `window.MythicKitchenBridge` — THE COMPLETE SURFACE

Built in index.html beside `MythicTradeBridge`, in its style: every reader wrapped in
try/catch with a zero fallback, **every mutator returns a boolean.**
Verified round 5: the shipped bridge carries exactly these keys and no others.

| Accessor | Signature | Returns | Notes |
|---|---|---|---|
| `resources` | `() => Array` | the 14 `RESOURCES` rows | `[]` on failure |
| `meta` | `(id) => object` | `{id,name,icon,color}` | via `_meta(id)`; never null |
| `getRes` | `(id) => number` | int | `getRes()` — **not** `Profile.resources` |
| `resourceCap` | `() => number` | int | stash ceiling |
| `resourceUnits` | `() => number` | int | current fill |
| `gems` | `() => number` | int | Cinder = `Profile.gems` |
| `signedIn` | `() => boolean` | | |
| `userId` | `() => string\|null` | | |
| `displayName` | `() => string` | `'Survivor'` fallback | |
| `cloud` | property | `Cloud` object or `null` | ⚠ a live GETTER, not a copied value |
| `myCorp` | `() => object\|null` | `{id,name,tag}` | convoy recipient shortlist |
| `cityProd` | `() => object` | `Profile.cityProduction` | **read-only**; "your city makes X" hint |
| `isAdmin` | `() => boolean` | | debug panel gate |
| `spendRes` | `(id,n) => boolean` | **true = it happened** | `spendResources({[id]:n})` |
| `addRes` | `(id,n) => boolean` | true = call made | 🔴 **capped**; verify by re-reading |
| `refundRes` | `(id,n) => boolean` | true = call made | 🔴 **uncapped UNDO only** |
| `spendGems` | `(n) => boolean` | true = paid | never mutate `Profile.gems` |
| `addGems` | `(n) => boolean` | true = paid out | never mutate `Profile.gems` |
| `kitchenState` | `() => object` | `Profile.kitchen`, auto-created `{}` | never null |
| `setKitchenState` | `(obj) => boolean` | 🔴 **false on failure** | do not swallow |
| `save` | `() => boolean` | 🔴 **false on failure** | `saveProfile()` |
| `toast` | `(msg, ms) => void` | | `showToast` |
| `confirm` | `(msg) => Promise<boolean>` | | `gcConfirm`, async |
| `render` | `() => void` | | legacy `render()`, for HUD chips outside the overlay |

> 🔴 `refundRes` vs `addRes` is the whole safety story. `addRes()` enforces the stash cap
> and **returns without adding when the vault is full** — correct for loot, catastrophic
> for a refund (it destroyed 215 units of a real player's resources). Rule, no exceptions:
> **undoing a deduction this call stack just made → `refundRes`. Creating units (a convoy
> claim, a payout) → `addRes`, and then RE-READ `getRes()` and treat a short landing as a
> failed leg.** Belt and braces; "the preflight should have caught it" is how the 215 went missing.

> ⚠ `NULL_BRIDGE.confirm` answers **true** — the one fallback that is not the conservative
> answer — because with no bridge every spend mutator returns false, so nothing can be
> lost, and answering false would make rung 1 of §9 unplayable. A **real** bridge merely
> MISSING `confirm` gets `SAFE_FILL.confirm` instead, which asks the browser or refuses.

---

## 8. THE ECONOMY CONTRACT

### 8.1 Live ledger → pantry (the only way ingredients exist)
The 14 live ids — `food ammo water medicine energyDrink supplies metal fuel
corruptedEssence memoryShards dna wood stone cloth` — are the **only** spendable input.
`SUPPLY_RECIPES` converts them into pantry stock:
```js
{ id:'sup_patty', out:{ ing:'patty', qty:8 }, cost:{ food:12, dna:1, supplies:1, cinder:400 } }
```
**Rules, all load-bearing:**
- A `cost` dict may contain **only** the 14 live ids plus the key `cinder`. Any other key
  is a bug — `buySupply()` must reject the recipe rather than silently skip the leg.
- 🔴 **Pantry ingredients are NOT promoted into `RESOURCES`.** They live in `Kitchen.pantry`,
  are not tradeable, not lootable, not stash-capped. *WHY:* `/src/resources/chain.js`
  documents exactly what happens when an id is holdable but has no producer, no cost
  renderer and no market entry — "worse than missing, because the player's pile of it is
  real and inert."
- `buySupply(supplyId, batches)` is **all-or-nothing, settle.js discipline**:
  1. Preflight **every** leg (`getRes` ≥ n for each; `gems()` ≥ cinder). Refuse before
     touching anything — a failing buy costs the player nothing at all.
  2. Take: `spendRes` / `spendGems` per leg, remembering exactly what was taken.
  3. Any leg returns false → unwind in reverse with **`refundRes` / `addGems`**, return
     `{ok:false}`. Never leave a partial spend.
  4. Only then `pantry[ing] += qty * batches`, `rev++`, `save(true)`.

> 🔴 **AND THE LIVE LEDGER MUST STAY THE INPUT, WHICH IS THE PREMISE OF THE WHOLE
> FEATURE.** The player asked for a cooking minigame **fed by what businesses, the city
> builder and battle produce**. A fallback supply ladder priced purely in Cinder closes
> every dead end and also makes the 14-id ledger optional — measured on a fresh account,
> 188 dishes served over ten days with the ledger never moving once, minting +23,542
> Cinder net. **A kitchen that runs on Cinder fails the request at a deeper level than any
> soft-lock.** Both requirements — never soft-locked, and genuinely fed by the ledger —
> have to hold at once; picking one is not an answer.
>
> **WHERE THAT STANDS TODAY, measured round 5 rather than asserted.** `SUPPLY_RECIPES` is
> 41 lines and **not one of them is Cinder-only** — 39 want `food`, 12 want `water`, 8 want
> `dna`, 3 `supplies`, and every line carries a Cinder component beside the resources. The
> pantry is genuinely fed by the ledger. `RELIEF` is the escape hatch and it is the hole:
> three parcels, `cost` is Cinder and nothing else, and `out` is **live resources**
> (`rel_pallet` → `{food:10, water:10}` for ◈1200). So a player is never dead-ended, and a
> player with Cinder can also buy their way round the ledger at roughly 12× retail. The
> price is the wall. **If you retune `RELIEF`, you are retuning the premise** — check what
> a day of play mints against what a day of play burns before you touch it.

### 8.2 Cooking, quality, and ruining it
`startCook` spends `recipe.needs` from the pantry (all-or-nothing, same discipline) and
writes a slot with `startedAt`, `doneAt = startedAt + cookMsFor(recipeId, owned)`,
`burnAt = doneAt + doneWindowMsFor(recipeId)`. Quality is derived at `pullSlot(now)`:
| when pulled | quality | multiplier |
|---|---|---|
| `now < doneAt` | `'raw'` | `ECON.Q_RAW` (and no XP) |
| within the first third of the done window | `'perfect'` | `ECON.Q_PERFECT` |
| rest of the done window | `'good'` | `ECON.Q_GOOD` |
| `now >= burnAt` | `'burnt'` | `0` — pays nothing and costs `ECON.POP_BURN` popularity |
The done window is what makes timing a skill instead of a wait. Do not widen it to be kind.

### 8.3 Serving — what a meal pays
Money in this game is **Cinder = `Profile.gems`**, reached only via `bridge().addGems` /
`spendGems`. There is no second currency and no "restaurant cash".
```
payout = Σ(recipe.basePrice × qsum)  × popPayMul(popularity) × rushPayMul(rush)
tip    = payout × DriveThru.tipFor(…)          // a FRACTION, never absolute Cinder
xp     = Σ(recipe.xp) + (ticket fully filled and on time ? ECON.XP_TICKET_BONUS : 0)
```
Popularity moves on `ticket:served` (+), `ticket:lost` (−−), `cook:burnt` (−),
`car:leave` unserved (−−), `car:balk` (− tiny), `waveCar` (−). It is clamped 0..100 and is
**the only thing** the emoji face reads.
Every constant above is a key in `ECON` (165 of them — count it, do not quote it; see §1).
**No number in this section may
appear literally in any file other than `kitchen.data.js`.** Read the keys from the file;
this contract deliberately no longer restates their values, because two of them had
already drifted apart from the numbers a comment claimed.

### 8.4 Convoys — a transfer, never a faucet
A convoy carries **finished dishes** from `pass` to another player's city.
- Sender: dishes leave `pass`, a Cinder freight fee (`convoyFeePct(tier, owned)` of dish
  value) is paid with `spendGems`, the launch RPC writes the row, `state:'transit'`.
- Receiver on `claim()`: gains `dishes × ECON.CONVOY_FOOD_PER_DISH` units of the live
  resource `food` via `addRes` — **then re-reads `getRes('food')`.** A short landing (stash
  cap) is reported as `{ok:false, code:'CAP'}` and the convoy stays claimable; it is never
  silently clamped. **The client may only pay on the RPC's `delivered_dishes`, which is 0
  on a replay.**
- 🔴 `CONVOY_FOOD_PER_DISH` must be tuned **below** the `food` cost of the ingredients that
  made the dish. *WHY:* the dishes were bought out of the 14-id ledger in the first place,
  so a convoy **moves** value between players. If the round trip nets more `food` than it
  consumed, the kitchen becomes an infinite `food` printer and the whole resource economy
  is dead. This is the single most dangerous number in the feature — and it is now
  ASSERTED, not merely intended: `DATA.convoyGuardOk()` re-derives the comparison and
  `__mk.debug()` prints it.
- Everything works with **zero tables**: a local practice convoy to your own city runs
  entirely in `Kitchen.convoys`. `missing`/`offline` disable only the player-to-player picker.

### 8.5 🔴 A PROMISE MUST BE PHYSICALLY KEEPABLE
`addStep()` refuses to lay more of an ingredient than the recipe calls for, so an `extra`
modifier is only keepable on a dish whose canon carries at least `ECON.MOD_EXTRA_MIN` of
it. drivethru.js's `rollMods()` gates the pool on the RECIPE for exactly that reason.
**A promise the game forbids the player from keeping is worse than no promise**: it is
loud, it is wrong, and it charges `MOD_PAY_MISS` for obedience.

### 8.6 🔴 BINNING A PLATE IS TRIAGE, NOT FAILURE
Breaking a pass deadlock is mandatory play. `binPass()` counts `today.binned`, which the
settlement report shows as a cost line, and `gradeFor()` does **not** read it. The
ingredients and the slot time are already the price; the grade may not charge again.

---

## 9. LOADING & DEGRADATION

`index.js` on import: publish `window.MythicKitchen`, inject
`<link rel="stylesheet" href="./kitchen.css?v=…">` once (guard by id, resolved against
`import.meta.url`), dispatch `mythic:kitchen-ready`. **It does not touch the DOM otherwise
and does not start the loop.**
`open()` → `State.init()` → `Convoy.catchUp()` → `Render.open()` → start RAF.
`close()` → stop RAF, `State.closeShift(now,{forfeit:true})`, `save(true)`, `Render.close()`.

**Total degradation ladder — all four rungs must be playable:**
1. No bridge at all (`NULL_BRIDGE`) → the kitchen opens, cooks, and serves against an empty
   pantry; restock refuses with "no supplies". Nothing throws. **This is the headless test.**
2. Bridge, signed out → full single-player game. Convoy tab says "sign in to ship".
3. Signed in, `sql/038` not run (`missing:true`) → full game + local convoys.
   Banner: "Convoy network not set up yet." **Never** an error toast.
4. Everything present → the whole feature.

---

## 10. `sql/038_kitchen_convoys.sql`

**The file's own header is the current spec — read it, not this summary.** It is 1,654
lines, idempotent, ships its RLS, and ends with a ~30-assertion verify block that names
each defect explicitly if it is still present.

What it adds: `kitchen_convoys`, `kitchen_convoy_ledger` (**append-only, no balance
column, no write policy, ever**), `kitchen_convoy_tiers` (the truck table **on the
server**), and the RPCs that are the only write paths — `kitchen_convoy_launch()`,
`kitchen_convoy_claim()`, `kitchen_convoy_quota_ok()`, plus the `is_convoy_party()`
helper.
> 🔴 **`kitchen_stats` and `kitchen_stats_upsert()` were here and round 6 dropped
> them**, with `leaderboard()` / `listLeaderboard()` / `upsertStats()`. No screen
> ever showed a row, through four reviews. The migration now DROPs them explicitly
> — it has already been applied by hand, so deleting the `create` alone would have
> left a live table with a live policy that the repo no longer describes — and two
> new verify rows assert the removal actually happened.

**RLS, and every line of it is the security boundary:**
- `select`: `auth.uid() = from_user or auth.uid() = to_user`.
- **No client INSERT, UPDATE or DELETE on `kitchen_convoys` at all.** Both writes are RPCs.
- Claiming is `kitchen_convoy_claim(p_id uuid)` — `security definer`,
  `set search_path = public` — which checks party, state and `arrives_at <= now()`, flips
  state, writes the ledger row, and **returns `delivered_dishes`, 0 on a replay.** That
  return value is the wall against a double payout; the client pays on it and nothing else.
- Transit is computed **on the server** from `now()`. The client posts a duration, never a
  timestamp, so a fast device clock buys nothing.
- `to_user <> from_user` is enforced on the server, so the trivial ship-to-myself loop
  cannot exist. Local practice runs never reach this table.
- ⚠ **RLS recursion:** any policy that needs "am I a party to this convoy" uses the
  `security definer` helper `is_convoy_party(p_convoy uuid)`. A policy on `kitchen_convoys`
  that itself selects `kitchen_convoys` recurses and hangs — the exact trap
  `is_community_member` exists to avoid.
- **Review every policy line by line.** A missing `using (auth.uid() = …)` is a data breach
  and looks completely fine in review.

---

## 11. VERIFYING BEFORE YOU HAND OFF

- `node --check public/src/kitchen/<yourfile>.js`.
- `node _synckcheck.mjs` if — and only if — you are the one agent editing index.html. **Not** `build.mjs`.
- Headless sim proof (state.js owner): `State.simulate(720, null, {seed, quiet:true})` for
  several seeds; assert no throw, popularity stays 0..100, and pantry never goes negative.
- Self-audits, all four, all of which must be clean and all of which are one call:
  `DriveThru.econAudit().ok`, `DriveThru.voiceAudit().ok`, `Data.convoyGuardOk()`,
  `Data.assertDataSane()` → `[]`.
- Visual proof (render/css owner): headless Chromium at **360px** and at 1280px.
  Screenshot both. If it does not read as a working kitchen at a glance at 360px, it is not done.
- ⚠ index.html:209271 (`_uiAutoScale`) multiplies the whole document by `h/980` on any
  viewport ≤1100px wide. **A control declared at 36px is not 36px on a phone.** Measure
  rendered pixels, not declared ones.
- 🔴 **GREP FOR THE CALL SITE.** Four rounds running, this feature shipped a value that was
  computed and never consumed: two dead player verbs, a modifier verdict the till ignored,
  `modCinder`/`modPop` that nothing drew, and a skill signal `min()` threw away. "I added
  the field" is not "the game uses the field". Before you report anything closed, run the
  path end to end and print what the PLAYER receives.

## 12. WHAT CHANGED, BY ROUND

Kept so a reader can tell a deliberate change from drift. Rounds 1–4 are commits
`c574ac3`, `6518447`, `822f0a4`, `ee827b0`.

| Round | Contract-visible change |
|---|---|
| 1 | Original nine-module split, the bridge surface (§7), the tick contract (§3). |
| 2 | `UPGRADES` + `Kitchen.upgrades` and every `DATA.*(…, owned)` helper. `ECON` absorbed drivethru's 36 private literals. `car:balk` groundwork. |
| 3 | `car:balk` event and `passersBy()`. §RIDES. §MODIFIERS became a literal three-way per-line check with `MOD_PAY_*` / `MOD_POP_*`. `kitchen_convoy_tiers` moved the truck table onto the server. `shift.bail` (the anti-rewind). |
| 4 | `plateHand(now, forTicketId)` — **the second argument**. `assignDish` / `assignmentOf` (the plate-steering control). `planPass()` and `fitScore()`. `serveCar()` re-judges AFTER the commit. `RELIEF` and the Cinder supply ladder (see §8.1's warning — it closed the dead end and broke the premise). |
| 5 | **This file, brought back into line with the shipped code.** §1 export lists regenerated from `grep "^export"` across all eight modules; vocabulary counts corrected (15→25 ingredients, 9→19 recipes); `patiencePct` direction and `tipFor` return type written down (§1); `car:balk` added to the closed event set (§6); `shift.bail`, `startGranted` and `upgrades` added to §5's saved subset; §2 regenerated; §10 reduced to a pointer at the migration's own header plus the six economy walls; §8.5, §8.6 and the §8.1 premise warning added; the skew seam recorded in §3. In drivethru.js: §RIDE SKINS (the Kid rides a bicycle), the handover split into OPEN/CLOSED with the closed half in the past tense, three dialogue lines rewritten. |
| 6 | `kitchen.selftest.js` — the ninth module, and the only one that is a checker rather than a part of the game. It reads all eight modules plus this file and reports the ONE defect this feature keeps shipping: a value written, documented, tuned, and reached by nobody. No round-6 row was written at the time; this one is reconstructed from the shipped file and is deliberately short. |
| 7 | **The self-test's own verdict, closed.** §1 gained the four `kitchen.state.js` exports that had shipped without it — `isDry`, `reliefOffer`, `buyRelief`, `quoteTicket` — plus the fuller `dumpSupply` / `dryCheck` notes. The `ECON` key count is 165 and now carries the command that prints it instead of a number to misremember: **+`COUNTER_ENABLED`** (kitchen.state.js's walk-in door was reading it and nothing declared it, so it resolved to `undefined` and the counter ran on a number living in the reading file), **+`COOKABLE_BIAS`** (a comment named it; it did not exist — and it is now wired: `menuForLevel(lv, cookable)` finally has a caller, `spawnCounter()`), **−`SPARK_MS`** (a dial with no FX anywhere in the feature). `ECON.DAY_NAMES` / `ECON.POP_FACES` are read through `ECON` by `dayName()` / `faceFor()`, which is what makes them live rows rather than decoration. `ECON.MOD_XP_HIT` is paid by `serveTicket()` (drivethru.js handover O2, taking its second option, so no new export exists). §2 gained `_cookable`. `Kitchen._init` is read by `save()`, which now refuses to overwrite a profile it never hydrated. `popDayDelta()` has the day roll as its one caller and the duplicate settle is gone; `dumpSupply()` has `coolerWatch()` on the tick path, so a cooler with no room is no longer a permanent soft-lock; `upgradesForLevel()` gates `buyUpgrade()`; `salvageFor()` writes the second half of a restock refusal; `ticketPct()` is the patience term in `tipFor()`. `index.js` imports the self-test, so `__mk.selftest()` exists in the browser. |
