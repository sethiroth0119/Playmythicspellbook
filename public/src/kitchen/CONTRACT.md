# 🍔 MYTHIC KITCHEN — THE BUILD CONTRACT

**Read this whole file before you write a line. It is the only thing keeping six parallel
builders from writing six incompatible function signatures.**

If you need something this contract does not give you, **do not invent it locally** —
say so and it gets added HERE first. That rule is the entire reason this file exists.

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
   the rollback fire on a leg that worked. See the comment on `MythicTradeBridge`.

---

## 1. FILES, OWNERSHIP, EXPORTS

Nine modules + one migration. **Own your file. Do not edit anyone else's.**
Every module is `.js`, ES module, **must not throw at import time** (it is loaded on every
page load of a 223k-line app), and imports nothing outside `/src/kitchen/`.

### `public/src/kitchen/kitchen.data.js`
Owns: every number and every id in the feature. **Pure data. Zero imports. Zero side effects.**
> WHY a data file at all: CLAUDE.md — "All operation pricing goes through `_opEcon()`. Never
> hardcode economy numbers." Kitchen has no `_opEcon()`, so `ECON` is it. If you write a
> number in any other kitchen file, you have written a bug.

```js
export const INGREDIENTS   // [{id,name,icon,color,unit,batch}]  the PANTRY vocabulary (§8)
export const RECIPES       // [{id,name,icon,tier,minLevel,station,needs:{ingId:n},
                           //   cookMs,doneWindowMs,burnMs,basePrice,xp,pop}]
export const STATIONS      // [{id,name,icon,kind,slots}]  kind:'heat'|'fry'|'bake'|'build'|'instant'
export const SUPPLY_RECIPES// [{id,out:{ing,qty},cost:{<liveResId|'cinder'>:n}}]  §8
export const CUSTOMERS     // [{id,name,icon,patienceMs,tipBias,order:{min,max}}]
export const CARS          // [{id,icon,seats,patienceMul}]  drive-thru sprites
export const CONVOY_TIERS  // [{id,name,capacity,transitMs,feePct,minLevel}]
export const ECON          // ALL tuning. See §8 for the required keys.
export function recipe(id)      // → RECIPES entry | null
export function ingredient(id)  // → INGREDIENTS entry | null
export function station(id)     // → STATIONS entry | null
export function xpForLevel(lv)  // → cumulative XP needed to REACH level lv (lv 1 → 0)
export function levelForXp(xp)  // → integer level for a total XP number
export function menuForLevel(lv)// → RECIPES filtered by minLevel, in menu order
```

**Fixed shared vocabulary — these ids are the contract; do not rename them.**
- Ingredients (15): `dough sauce cheese tomato pepperoni patty chicken bun lettuce onion
  pickle sausage potato syrup milk`
- Stations (5): `oven griddle fryer assembly drinks`
- Recipes (9): `pizzaMargherita pizzaPepperoni burgerClassic burgerDouble chickenSandwich
  hotDog fries soda shake`
- Numbers on all of the above are yours to tune. The **ids** are everyone's.

### `public/src/kitchen/kitchen.state.js`
Owns: the sim. **No DOM. No `document`. No `window`. No `Date.now()` inside `tick`.**
Must run to completion under `node --input-type=module` with no browser at all — that is
the test, and it is why `now` is a parameter everywhere.
```js
export const Kitchen                       // the state object (§2)
export function init()                     // hydrate from bridge, catchUp convoys, → Kitchen
export function tick(dt, now)              // ⏱ THE ONLY ADVANCE. → Event[] drained this frame
export function on(name, fn)               // → off() unsubscribe fn
export function emit(name, payload)        // internal + testable; render never calls it
export function openShift(now)             // → boolean   starts service, resets `today`
export function closeShift(now, opts)      // → boolean   opts:{forfeit:true} (§4)
export function startCook(stationId, slot, recipeId, now)  // → {ok,code,why}
export function pullSlot(stationId, slot, now)             // → {ok,code,why}  slot → hand
export function dropHand()                                 // → boolean  bin what's in hand
export function plateHand(now)                             // → {ok,code,why}  hand → pass
export function serveTicket(ticketId, now)                 // → {ok,code,why,paid,tip,xp}
export function buySupply(supplyId, batches)               // → {ok,code,why,spent} (§8)
export function pantryHas(needs)                           // → boolean  affordability, no mutation
export function snapshot()                                 // → the SAVED subset only (§5)
export function hydrate(saved)                             // ← the SAVED subset only (§5)
export function save(force)                                // → boolean  debounced write (§5)
export function reset()                                    // wipe to a fresh kitchen (admin/console)
```
`{ok,code,why}` is the universal action result. `code` is a stable machine string
(`OK NO_PANTRY NO_SLOT LOCKED CLOSED NOT_READY BAD_ARG CAP`). `why` is the player sentence
that goes to `toast()`. **Never throw across an action boundary — return `{ok:false}`.**

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
requirement, phones are the main platform. Mobile-first, one `@media (min-width:820px)`
that widens the counter into the landscape layout.
Loaded by `index.js` injecting a `<link>` (§9) — **not** by an index.html edit.

### `public/src/kitchen/drivethru.js`
Owns: NPC customers, the lane, patience, tips, service resolution. Pure functions over `K`.
```js
export function tick(K, dt, now)           // → Event[]  spawn/advance/expire. NEVER schedules.
export function spawn(K, now, force)       // → car | null
export function serveCar(K, carId, now)    // → {ok,code,why,paid,tip}
export function waveCar(K, carId, now)     // → boolean  turn one away (pop cost, no lost-ticket)
export function patiencePct(car, now)      // → 0..1     for the bar over the car
export function tipFor(K, car, quality, now) // → integer Cinder, via ECON only
export function clearLane(K)               // → void     shift close
```

### `public/src/kitchen/convoy.js`
Owns: composition, transit, arrival, claim. **The only part of the sim that advances on
wall-clock while the panel is shut** (§4).
```js
export function compose(K, tierId, items)  // → {ok,code,why,convoy}  validates capacity+stock
export async function launch(K, convoy, toUserId, now) // → {ok,code,why,id}  local first, then api
export function tick(K, dt, now)           // → Event[]  flips transit→arrived
export function catchUp(K, now)            // → Event[]  offline gap; called by init() and open()
export async function refreshInbound(K)    // → boolean  guarded api.listInbound()
export async function claim(K, convoyId, now) // → {ok,code,why,granted}  §8 payout + cap check
export function estimate(tierId, items)    // → {dishes,transitMs,feeCinder}  pure, for the UI
```

### `public/src/kitchen/kitchen.api.js`
Owns: **every** Supabase call. If a query lives anywhere else, that is the bug.
Copy `/src/community/community.api.js` exactly: `MISSING_RE`, `client()`, `fail()`, `OFFLINE`.
**Every function returns `{ok, rows|row, missing?, offline?, error?}` and NEVER throws.**
A 404 on a table is an empty list, never a crash.
```js
export async function listInbound()                  // → {ok,rows}
export async function listOutbound()                 // → {ok,rows}
export async function insertConvoy(payload)          // → {ok,row}
export async function claimConvoy(convoyId)          // → {ok,row}   RPC kitchen_convoy_claim
export async function listConvoyLedger(convoyId)     // → {ok,rows}  append-only, read-only
export async function upsertStats(stats)             // → {ok}       best-effort leaderboard
export async function listLeaderboard(limit)         // → {ok,rows}
export async function findPlayer(nameFragment)       // → {ok,rows}  convoy recipient picker
```

### `public/src/kitchen/kitchen.bridge.js`
Owns: the seam + total-degradation fallbacks + tiny shared formatters.
```js
export function bridge()                   // → real bridge, or NULL_BRIDGE (never null)
export function bridgeReady()              // → boolean   (!bridge()._null)
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
window.MythicKitchen = {
  version:'v1', open, close, paint,        // open/close wrap render + loop start/stop
  state: Kitchen, data, api, bridgeReady, debug(),
};
window.__mk = window.MythicKitchen;        // console shorthand, like __mc
// dispatches CustomEvent('mythic:kitchen-ready') so index.html can unhide the tile
```
Registration is wrapped in try/catch. A failure here makes the tile not appear; it does
not take the game down.

### `sql/038_kitchen_convoys.sql`
§10. Idempotent, re-runnable, RLS in the same file, ends with a verify query.

### index.html gets EXACTLY THREE EDITS (one agent, nobody else touches this file)
1. `window.MythicKitchenBridge = {…}` beside the other bridges (~line 207430).
2. One tile that calls `window.MythicKitchen.open()`, hidden until `mythic:kitchen-ready`.
3. `<script type="module" src="src/kitchen/index.js?v=…"></script>` beside the others (~223074).
> The stylesheet is deliberately **not** a fourth edit — `index.js` injects the `<link>`.
> The battle CSS is `<link>`ed from index.html; we do not follow that here because every
> extra edit to an 11.6 MB file is a merge hazard for one line of markup.

---

## 2. THE STATE OBJECT

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
  },

  // ── PROGRESSION ───────────────────────────────────────────────────────────
  level: 1,
  xp: 0,                 // TOTAL lifetime xp. Level is derived: levelForXp(xp).
  popularity: 50,        // 0..100. The emoji face + meter. Drives spawn rate and tips.

  // ── PANTRY — the kitchen's OWN stock. NOT the 14-id live ledger. (§8) ──────
  pantry: {},            // ingredientId → integer units. Uncapped by the stash cap.

  // ── STATIONS ──────────────────────────────────────────────────────────────
  stations: {},          // stationId → { slots: [slot|null, …] }  length = STATIONS.slots
                         // slot = { recipeId, startedAt, doneAt, burnAt }
                         // 🔴 'raw'|'cooking'|'done'|'burnt' is DERIVED from now vs
                         //    doneAt/burnAt. Never store a state string — it goes stale.
  hand: null,            // { recipeId, quality } lifted off a station, or null
  pass: [],              // plated and waiting: [{id, recipeId, quality, madeAt}]

  // ── TICKETS ───────────────────────────────────────────────────────────────
  tickets: [],           // [{ id, source:'counter'|'drive', carId|null,
                         //    items:[{recipeId, qty, filled}], placedAt, dueAt,
                         //    state:'open'|'ready'|'served'|'lost', paid:0, tip:0 }]

  // ── DRIVE-THRU LANE ───────────────────────────────────────────────────────
  lane: [],              // [{ id, carId, custId, name, ticketId, arrivedAt,
                         //    patienceMs, pos, state:'rolling'|'ordering'|'waiting'|'gone' }]

  // ── CONVOYS ───────────────────────────────────────────────────────────────
  convoys: [],           // MINE, outbound: [{ id, remoteId, tierId, toUserId, toName,
                         //   items:{recipeId:qty}, dishes, launchedAt, arrivesAt,
                         //   state:'transit'|'arrived'|'claimed', feeCinder }]
  inbound: [],           // server rows addressed to me. [] when offline or table missing.

  // ── TALLIES ───────────────────────────────────────────────────────────────
  today:  { served:0, lost:0, burnt:0, earned:0, tips:0 },   // reset each openShift()
  totals: { served:0, lost:0, burnt:0, earned:0, days:0 },   // lifetime, saved

  // ── CLOUD STATUS — the Corp.* triple, verbatim ────────────────────────────
  missing: false,        // sql/038 has not been run → UI says "not set up yet"
  offline: false,        // signed out / no cloud
  error: null,

  // ── DERIVED. NEVER SAVED. Recomputed every tick. ──────────────────────────
  _fx: [],               // transient float-ups / sparks for the renderer to consume+clear
  _events: [],           // this frame's event drain buffer
  _lastSave: 0,          // debounce stamp
};
```

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
1. `K.now = now`; advance `shift.tMs` by `dt`; recompute `shift.rush`; roll the day over.
2. Station timers (derive done/burnt from `now`; emit `cook:done` / `cook:burnt` on crossing).
3. `DriveThru.tick(K, dt, now)` → events.
4. Ticket expiry → `ticket:lost`, popularity hit.
5. `Convoy.tick(K, dt, now)` → events.
6. Popularity/XP settle; `save()` if the debounce is due.
7. Return the drained `K._events`.

**Sub-modules receive `(K, dt, now)` and return `Event[]`. They never schedule anything and
never read the clock themselves.** That is what makes a headless test able to run a whole
in-game day in one loop of fake `dt`s.

**⚠ RAF NEVER FIRES IN THE BUILT-IN BROWSER PANE** (CLAUDE.md). For a real visual check use
headless Chromium via the global Playwright:
`import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';`
Harness scripts go in the scratchpad, **never in the repo.**

---

## 4. 🔴 THE SHIFT IS THE UNIT OF PERSISTENCE

**Closing the panel closes the shift.** Tickets, lane, `pass`, `hand`, station slots and
`today` are all cleared. Pantry, level, xp, popularity, `shift.day`, `totals` and convoys survive.

> WHY, because a reasonable person would do this differently: a ticket with a 90-second
> countdown cannot survive a page close honestly. Either it keeps running while you sleep —
> cruel, and it silently drains popularity to zero overnight — or it freezes, which turns
> the drive-thru into a turn-based game with a free pause button. Both are worse than
> "the shift ended." So we end the shift, forfeit open tickets **with no popularity
> penalty** (`closeShift(now, {forfeit:true})`), and let the player start a fresh one.

**Convoys are the single exception and advance on wall-clock.** They are a hours-long
logistics promise, not a real-time reflex, so they must tick while you are away.
`Convoy.catchUp(K, now)` is called by `init()` and by `open()` and flips anything whose
`arrivesAt <= now`. It is idempotent — calling it twice must not double-arrive a convoy.

---

## 5. THE PERSISTENCE CONTRACT

**Where:** `bridge().kitchenState()` → `Profile.kitchen` (auto-created `{}`),
written back with `bridge().setKitchenState(obj)` then `bridge().save()`.
**Never touch `Profile` directly. Never `saveProfile()` directly.**

**`snapshot()` saves exactly this and nothing else:**
```
v, shift.day, level, xp, popularity, pantry, convoys, totals
```
**NEVER SAVED (derived or ephemeral):**
`rev, open, now, shift.tMs, shift.running, shift.rush, stations, hand, pass, tickets,
lane, inbound, today, missing, offline, error, _fx, _events, _lastSave`
— plus, inside a station slot, any `'cooking'|'done'|'burnt'` string. Cook state is
**always** derived from `now` vs `doneAt`/`burnAt`. A stored state string is a stale lie.

**How often:** `save()` is debounced to at most once per `ECON.SAVE_DEBOUNCE_MS` (5000).
It is force-called (`save(true)`) on: `closeShift`, `convoy:launch`, `convoy:claim`,
`level:up`, `buySupply` success, and `close()`. It is **never** called per tick.
`setProdState`-style failure handling applies: `setKitchenState`/`save` returning `false`
is a real failure — surface it with `toast()`, do not swallow it.

**Hydrate is absent-tolerant by construction.** No `Profile.kitchen` key → a fresh kitchen,
never a throw. Unknown `v` → keep what parses, default the rest, bump to current `v`.

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
   pantry:low pantry:buy level:up pop:change pay convoy:launch convoy:arrive
   convoy:claim error`
- **Repaint rule.** `paint()` (structural) runs when `Kitchen.rev` changed since last paint,
  or on an explicit view-state change. `frame()` (cheap) runs every RAF and may only
  `textContent` / `style.*` existing nodes.

---

## 7. `window.MythicKitchenBridge` — THE COMPLETE SURFACE

Built in index.html beside `MythicTradeBridge`, in its style: every reader wrapped in
try/catch with a zero fallback, **every mutator returns a boolean.**

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
| `cloud` | property | `Cloud` object or `null` | the only thing `kitchen.api.js` reads |
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
  real and inert." Fifteen more of those is fifteen more of that fault.
- `buySupply(supplyId, batches)` is **all-or-nothing, settle.js discipline**:
  1. Preflight **every** leg (`getRes` ≥ n for each; `gems()` ≥ cinder). Refuse before
     touching anything — a failing buy costs the player nothing at all.
  2. Take: `spendRes` / `spendGems` per leg, remembering exactly what was taken.
  3. Any leg returns false → unwind in reverse with **`refundRes` / `addGems`**, return
     `{ok:false}`. Never leave a partial spend.
  4. Only then `pantry[ing] += qty * batches`, `rev++`, `save(true)`.

### 8.2 Cooking, quality, and ruining it
`startCook` spends `recipe.needs` from the pantry (all-or-nothing, same discipline) and
writes a slot with `startedAt`, `doneAt = startedAt + cookMs`,
`burnAt = doneAt + doneWindowMs`. Quality is derived at `pullSlot(now)`:
| when pulled | quality | multiplier |
|---|---|---|
| `now < doneAt` | `'raw'` | `ECON.Q_RAW` (0.5, and no XP) |
| within the first third of the done window | `'perfect'` | `ECON.Q_PERFECT` (1.25) |
| rest of the done window | `'good'` | `ECON.Q_GOOD` (1.0) |
| `now >= burnAt` | `'burnt'` | `0` — pays nothing and costs `ECON.POP_BURN` popularity |
The done window is what makes timing a skill instead of a wait. Do not widen it to be kind.

### 8.3 Serving — what a meal pays
Money in this game is **Cinder = `Profile.gems`**, reached only via `bridge().addGems` /
`spendGems`. There is no second currency and no "restaurant cash".
```
payout = Σ(recipe.basePrice × qualityMult)   × popMult × rushMult
popMult  = ECON.POP_PAY_FLOOR + (popularity/100) × ECON.POP_PAY_SPAN   // 0.8 → 1.2
tip      = payout × DriveThru.tipFor(...)                              // patience + quality
xp       = Σ(recipe.xp) + (ticket fully filled and on time ? ECON.XP_TICKET_BONUS : 0)
```
Popularity moves on `ticket:served` (+), `ticket:lost` (−−), `cook:burnt` (−),
`car:leave` unserved (−−). It is clamped 0..100 and is **the only thing** the emoji face reads.
Every constant above is a key in `ECON`. **No number in this section may appear literally
in any file other than `kitchen.data.js`.** Required `ECON` keys, minimum:
`DAY_MS OPEN_HOUR CLOSE_HOUR MAX_DT_MS SAVE_DEBOUNCE_MS Q_RAW Q_GOOD Q_PERFECT
POP_PAY_FLOOR POP_PAY_SPAN POP_SERVE POP_LOST POP_BURN POP_WAVE XP_TICKET_BONUS
LANE_CAP SPAWN_BASE_MS SPAWN_POP_SPAN TIP_MAX_PCT CONVOY_FOOD_PER_DISH CONVOY_FEE_PCT`

### 8.4 Convoys — a transfer, never a faucet
A convoy carries **finished dishes** from `pass` to another player's city.
- Sender: dishes leave `pass`, a Cinder freight fee (`tier.feePct` of dish value) is paid
  with `spendGems`, the row is written, `state:'transit'`.
- Receiver on `claim()`: gains `dishes × ECON.CONVOY_FOOD_PER_DISH` units of the live
  resource `food` via `addRes` — **then re-reads `getRes('food')`.** A short landing (stash
  cap) is reported as `{ok:false, code:'CAP'}` and the convoy stays claimable; it is never
  silently clamped. Sender gets XP on `convoy:arrive`.
- 🔴 `CONVOY_FOOD_PER_DISH` must be tuned **below** the `food` cost of the ingredients that
  made the dish. *WHY:* the dishes were bought out of the 14-id ledger in the first place,
  so a convoy **moves** value between players. If the round trip nets more `food` than it
  consumed, the kitchen becomes an infinite `food` printer and the whole resource economy
  is dead. This is the single most dangerous number in the feature.
- Everything works with **zero tables**: a local practice convoy to your own city runs
  entirely in `Kitchen.convoys`. `missing`/`offline` disable only the player-to-player picker.

---

## 9. LOADING & DEGRADATION

`index.js` on import: publish `window.MythicKitchen`, inject
`<link rel="stylesheet" href="/src/kitchen/kitchen.css?v=…">` once (guard by id), dispatch
`mythic:kitchen-ready`. **It does not touch the DOM otherwise and does not start the loop.**
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

Idempotent (`create table if not exists`, `drop policy if exists` before each `create policy`),
RLS enabled and **policies in this same file**, ends with a verify `select`.

- `kitchen_convoys` — `id uuid pk default gen_random_uuid(), from_user uuid not null,
  to_user uuid not null, from_name text, to_name text, tier text, items jsonb not null,
  dishes int not null check (dishes > 0), launched_at timestamptz default now(),
  arrives_at timestamptz not null, state text not null default 'transit', claimed_at timestamptz`
- `kitchen_convoy_ledger` — **append-only**, `amount int` signed.
  🔴 **Balance = `sum(amount)`. There is no balance column and there never will be.
  No UPDATE policy on this table at all** — that is what makes append-only enforceable.
- `kitchen_stats` — optional leaderboard, `user_id uuid pk`, cosmetic only, never trusted
  as an economy source.

**RLS:**
- `select`: `auth.uid() = from_user or auth.uid() = to_user`.
- `insert`: `with check (auth.uid() = from_user)` — you cannot ship *from* someone else.
- **No client `update` on `kitchen_convoys`.** Claiming goes through
  `kitchen_convoy_claim(p_id uuid)` — `security definer`, `set search_path = public`, which
  checks `auth.uid() = to_user and state = 'transit' and arrives_at <= now()`, flips state,
  writes the ledger row, and returns the row. One RPC, one atomic claim, no double-claim.
- ⚠ **RLS recursion:** any policy that needs "am I a party to this convoy" uses the
  `security definer` helper `is_convoy_party(p_convoy uuid)`. A policy on `kitchen_convoys`
  that itself selects `kitchen_convoys` recurses and hangs — the exact trap
  `is_community_member` exists to avoid.
- **Review every policy line by line.** A missing `using (auth.uid() = …)` is a data breach
  and looks completely fine in review.

---

## 11. VERIFYING BEFORE YOU HAND OFF

- `node --check public/src/kitchen/<yourfile>.js` (or `node --input-type=module --check < file`).
- `node _synckcheck.mjs` if — and only if — you are the one agent editing index.html. **Not** `build.mjs`.
- Headless sim proof (state.js owner): run `tick()` in a loop with fake `dt` against
  `NULL_BRIDGE`, for a full in-game day, and assert no throw, popularity stays 0..100,
  and pantry never goes negative.
- Visual proof (render/css owner): headless Chromium at **360px** and at 1280px.
  Screenshot both. If it does not read as a working kitchen at a glance at 360px, it is not done.

## 12. HOUSE VOICE
Heavy block comments. 🔴 for load-bearing warnings, ⚠ for traps. Comments explain **WHY**,
including past bugs and rejected designs — a comment that restates the code is noise, a
comment that records why the obvious approach was wrong is why this codebase is maintainable.
