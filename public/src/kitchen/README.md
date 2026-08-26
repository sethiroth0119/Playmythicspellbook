# 🍔 Mythic Kitchen

A real-time fast-food sim inside Mythic Spellbook. You cook pizzas, burgers, hot dogs,
fries and shakes from **real game resources** earned elsewhere in the app, serve NPC
customers at the counter and through a **drive-thru lane**, and load **convoys** that ship
finished food to other players' cities.

It is a game loop, not a click-to-collect screen: tickets have live countdowns, pans have a
done window you can miss, cars lose patience and leave, and popularity moves every time any
of that happens.

**The authority on how it is built is [`CONTRACT.md`](./CONTRACT.md), not this file.**
Read that before changing anything. This README is the map and the trap list.

---

## The file map

| File | Owns |
|---|---|
| `kitchen.data.js` | **Every number and every id.** Pure data, zero imports, zero side effects. `ECON` is this feature's `_opEcon()`: a number written anywhere else is a bug. |
| `kitchen.state.js` | The sim. Game truth. No DOM, no `window`, no `Date.now()` — `now` is a parameter, which is what makes it headlessly testable (`simulate()` at the bottom of the file). |
| `drivethru.js` | NPC customers, the lane, patience, tips, service resolution. Pure functions over `K`. |
| `convoy.js` | Convoy composition, transit, arrival, claim. The **only** part of the sim that advances on wall-clock while the panel is shut. |
| `kitchen.render.js` | Every pixel. Reads state, calls actions, never writes game truth. |
| `kitchen.css` | All styling, namespaced `.mk-*` under `#mythic-kitchen-ov`. Mobile-first at 360px, one breakpoint at 820px. |
| `kitchen.api.js` | **Every** Supabase call. Guarded: a 404 on a table is an empty list, never a crash. |
| `kitchen.bridge.js` | The seam to the legacy app + total-degradation fallbacks + shared formatters. |
| `index.js` | Registration, the CSS `<link>`, the **one** RAF loop, `window.MythicKitchen`. |
| `../../../sql/038_kitchen_convoys.sql` | Tables, RLS and the claim RPC. Applied by hand in the Supabase SQL editor. |

`index.html` gets **exactly three edits** and no more: the `window.MythicKitchenBridge`
block (beside `MythicTradeBridge`), one tile that calls `window.MythicKitchen.open()` and
stays hidden until the `mythic:kitchen-ready` event fires, and the
`<script type="module" src="src/kitchen/index.js?v=…">` tag. The stylesheet is deliberately
*not* a fourth edit — `index.js` injects the `<link>` itself, because every edit to an
11.6 MB file is a merge hazard.

---

## Driving it from the console

```js
__mk.open()            // open the panel (alias of window.MythicKitchen.open)
__mk.close()           // close it — ⚠ this ENDS THE SHIFT, see trap 3
__mk.debug()           // one object: bridge status, level, pantry, lane, convoy guard
__mk.state             // the live Kitchen object. Read it. Do not write it.
__mk.sim.openShift(Date.now())        // start service
__mk.sim.startCook('griddle', 0, 'burgerClassic', Date.now())
__mk.sim.simulate(600)                // fast-forward ten in-game minutes, headless
__mk.sim.reset()                      // 💥 wipes pantry, level and XP
__mk.data.ECON                        // every tuning number in the feature
__mk.bridgeReason()                   // '' when healthy, one line saying why when not
```

`__mk.debug().convoyGuard` is worth knowing about: it re-derives whether
`ECON.CONVOY_FOOD_PER_DISH` is still below the `food` cost of the cheapest dish it can
carry. If `ok` is ever `false`, the kitchen has become an infinite `food` printer and the
whole resource economy is dead. `__mk.debug().dataProblems` should always be `[]`.

---

## The four traps

### 1. 🔴 The globals trap — `window.Profile` is `undefined`
`Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES`, `getRes`, `addRes`,
`spendResources`, `showToast`, `gcConfirm`, `render` and `saveProfile` are top-level
`const`/`function` declarations in index.html. Those are **lexical** globals — they are not
properties of `window`, so an ES module cannot see them, no matter how obviously they are
"right there". This has cost real time three times in this codebase.

Everything arrives through `window.MythicKitchenBridge`, and `kitchen.bridge.js` is the only
file that touches it. Need something new from the legacy app? **Add it to the bridge** —
here and in index.html. Never reach around.

Two sub-traps inside the seam:
- **Never cache `bridge()` in a module-level `const`.** Resolve it per call. The real bridge
  can be published, replaced or repaired after this module is imported.
- **Every bridge mutator returns a boolean**, and `true` means *it happened*. `buySupply()`
  decides whether to refund from those return values. A wrapper that returns `undefined` on
  success makes the rollback fire on a leg that worked. The seam warns in the console when
  it sees one and deliberately does not guess which way to coerce it.
- **`refundRes` is not `addRes`.** `addRes` enforces the stash cap and returns *without
  adding* when the vault is full — correct for loot, catastrophic for a refund. It once
  destroyed 215 units of a real player's resources. Undoing a deduction this call stack just
  made → `refundRes`. Creating units → `addRes`, then **re-read `getRes()`** and treat a
  short landing as a failed leg.

### 2. ⏱ There is exactly one `requestAnimationFrame` loop, and it is in `index.js`
Nothing else in `/src/kitchen` may call `requestAnimationFrame`, `setInterval`, or a
simulation `setTimeout`. `kitchen.state.js` must stay headlessly testable so it cannot own a
loop; `kitchen.render.js` must not own game truth so it cannot decide when the sim advances;
`index.js` is the only file that knows the feature is open. Sub-modules take `(K, dt, now)`
and return `Event[]`.

The loop clamps `dt` to `ECON.MAX_DT_MS` and separately watches the **wall-clock gap**
(`Date.now()` vs `Kitchen.now`), because iOS Safari suspends pages without ever firing
`visibilitychange` and an NTP correction moves the clock under a running loop. The clamped
`dt` hides both; the gap check catches them.

`index.js` writes exactly one field of `Kitchen` — `Kitchen.open`, the loop guard, which
means "the panel is on screen" and is nobody else's fact. **Every other field goes through a
`State` action.**

### 3. 🔴 The shift is the unit of persistence — closing the panel ends the shift
`close()` calls `closeShift(now, {forfeit:true})`. Tickets, the lane, the pass, your hand
and every station slot are cleared. Pantry, level, XP, popularity, `shift.day`, upgrades,
totals and convoys survive.

This is deliberate and the alternatives are worse. A ticket with a 90-second countdown
cannot survive a page close honestly: either it keeps running while you sleep — cruel, and
it silently drains popularity to zero overnight — or it freezes, which turns the drive-thru
into a turn-based game with a free pause button. Forfeiting costs **no popularity**: open
tickets are discarded, not lost.

The same policy covers the tab being hidden. Hidden → the loop stops and the sim freezes
immediately (a phone call must not cost you a shift). Away longer than
`ECON.AWAY_FORFEIT_MS` → the shift closes with forfeit on return, because a permanent freeze
is a free pause button in a game that pays out real Cinder.

**Convoys are the single exception** and advance on wall-clock via `Convoy.catchUp(K, now)`,
which is idempotent — calling it twice must not double-arrive a convoy. `init()` and
`open()` both call it on purpose.

⚠ Related: `catchUp()` runs *after* the first `tick(0, now)` in `open()`, not before.
`kitchen.state.js` reads `Kitchen.now` and never `Date.now()`, so on a first-ever open
`Kitchen.now` is `0` and a catch-up against "now = 0" arrives absolutely nothing.

### 4. Pantry ingredients are not resources, and the browser pane cannot show you the game
There are **14 live resource ids** (`food ammo water medicine energyDrink supplies metal
fuel corruptedEssence memoryShards dna wood stone cloth`) and they are the only spendable,
tradeable, cap-counted things in the app. The kitchen's 15 ingredients live in
`Kitchen.pantry` and are **not** promoted into that ledger — `SUPPLY_RECIPES` is the one and
only door between them. `/src/resources/chain.js` documents what an id that is holdable but
has no producer, no cost renderer and no market entry does to a player: it is "worse than
missing, because the player's pile of it is real and inert." Fifteen more would be fifteen
more of that fault.

And when you go to look at it: **`requestAnimationFrame` never fires in the built-in browser
pane**, so the loop never runs and the kitchen looks frozen and empty. That is the tool, not
the code. Use headless Chromium via the global Playwright install
(`import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'`), serve
`public/` over HTTP (ES modules will not load from `file://`), and screenshot at 360px and
1280px. Harness scripts go in the scratchpad, never in the repo.

---

## The degradation ladder — all four rungs must be playable

1. **No bridge at all.** The kitchen opens, cooks and serves against an empty pantry;
   restock refuses with "not enough". Nothing throws. This is the headless test, and
   `NULL_BRIDGE` is exported from `kitchen.bridge.js` so a harness can inject it.
2. **Bridge, signed out.** Full single-player game. The convoy tab says "sign in to ship".
3. **Signed in, `sql/038` not run.** Full game plus local convoys, and a banner reading
   "Convoy network not set up yet." Never an error toast.
4. **Everything present.** The whole feature.
