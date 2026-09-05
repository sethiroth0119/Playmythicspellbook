# Handoff — new battle effect types (written 2026-09-05)

Four mechanics were added: **Fuel**, **Fuel Restore**, the **Sea** surface, and
**Counters**. Everything below is verified against the code in this repo. Read the
[Not verified](#not-verified--do-this-first) section before you trust any of it in a
real match — **none of this has been run in a browser.**

## Where things stand

| | |
|---|---|
| Branch | `claude/game-effect-types-8nwfty` |
| HEAD | `f84be38b6c` |
| `main` | `4dbc4f9` — **not** merged, branch is 2 commits ahead |
| Pushed | yes, branch only |
| Working tree | clean |
| Version knobs | bumped to **v120w8** (all three, together) |
| Deployed | **no.** Nothing has been deployed and no PR was opened. |
| Live version | unverified — outbound HTTPS was blocked in the session that wrote this |

Two commits:

- `b0478cf` — the four effect types
- `f84be38` — Fuel changed from *stall at zero* to *destroy at zero* (a follow-up
  instruction, not a bug fix)

## The one architectural decision

The engine is a **new file**, `public/src/battle/effects.js` (602 lines), loaded as a
classic script alongside `combat.js` / `targeting.js`. It exports three globals:

```js
window.MythicFuel · window.MythicSea · window.MythicCounters   // + window.MythicFX = {fuel, sea, counters}
```

**It deliberately touches no globals from index.html.** `PASSIVES`, `SURFACE_TYPES`,
`hasPassive`, `App` are top-level `const` — lexical bindings that are *not* on `window`
(CLAUDE.md's globals trap). Rather than build a bridge, every predicate reads plain data
off the object it is handed: `unit.passives` (array), `unit.factions` (array),
`tile.surface.type` (string). `hasPassive`'s field-negation rule is re-implemented in
five lines at the top of the file rather than imported.

Consequence: the module loads in any order relative to index.html and cannot be broken by
renaming a const. **If you extend it, keep that property** — the moment it needs `App` or
`SURFACE_TYPES` you are building a bridge, and `window.MythicBridge` is where that goes.

All index.html call sites are `try { if (window.MythicX) … } catch {}`. A missing module
degrades to the old behavior everywhere; it never throws into a reducer.

---

## ⛽ Fuel — `fuel1` / `fuel2` / `fuel3`

A fuelled unit burns **one counter at the end of each of its owner's turns** and is
**DESTROYED at zero**. It is a clock on the body from the turn it lands.

Three passives instead of one passive plus a number because PASSIVES entries carry no
per-card parameters — the Forge picker is a flat dropdown, so the tank size *has* to be
the passive.

### 🔴 The order is BURN → RESTORE → DESTROY, and it must stay that way

`MythicFuel.tickSide` runs three separate phases. Folding the destruction into the burn
would kill a Fuel (1) unit standing inside a Fuel Restore circle **before the circle could
refill it** — which is exactly the unit the circle exists for, and would make the aura
useless at the tank size that most needs it. Only a unit still empty *after* the refill is
swept.

Verified: a Fuel (1) inside a circle survives indefinitely at 1 (burn→0, restore→1, sweep
sees 1). Step out, and it is gone at the end of that turn.

### Heroes are exempt

A hero at zero **stalls** instead of dying. Hero death is the loss condition, and dropping
a match because a counter ran out is not a play the opponent made or the player can
answer. Same carve-out `purgeAscended`, `takeControl` and the Execute counter make.

### Deaths go through the real pipeline

The module marks the unit dead (`alive:false, currentHp:0`) and lists its id on
`state._fuelKilled`. **`_fuelResolveDeaths` (index.html:102150) then runs each one through
`_battleOnUnitKilled`** — panic rolls, ultimate charge, bond XP, on-death triggers, grave
effects — because none of that is reachable from the module's scope. Marking dead without
it would leave a corpse the rest of the game never learned about.

`killer` is `null`, the same shape the DoT/status death path passes, so
`_battleOnUnitKilled`'s "proxy via the opposing hero" branch credits it exactly as a
poison kill. It also re-checks `gameOver`, since a fuel death can be the last unit
standing.

### `isStalled` still exists — on purpose

In ordinary play nothing is ever *seen* at zero, because the sweep kills it in the same
pass that emptied it. `isStalled` covers the two cases the sweep does not: a **hero**, and
any **future effect that drains fuel mid-turn** (nothing does today). Such a unit is inert
until the sweep or a refuel reaches it, rather than acting on a dry tank. `getValidMoves`
and `executeMove` both gate on it.

### UI

Pips on the unit (`.fuel-badge`, index.html:1306) — spent pips go hollow rather than
vanishing so the tank *size* stays readable. At 1 Fuel the badge turns red and pulses
(`.fuel-low`) and the tooltip says outright that the unit dies at end of turn unless
refuelled or standing in a circle. That warning is not cosmetic: without it the only
signal was a tooltip nobody hovers and the unit would simply be gone.

---

## 🟢 Fuel Restore — `fuelRestore`

A **2-tile Chebyshev green circle** drawn on the tiles, not the unit. Every ally inside
it, the source included, refills to full at end of turn. Player circles green, enemy red.

Radius is a fixed constant (`MythicFuel.RESTORE_RADIUS`), not authorable — the spec said
"a green circle" with no size, and three more `fuelRestore1/2/3` passives would clutter
the picker for no gameplay gain. If you want it per-card, that constant is the one place
to change.

The aura map is computed **once per render** into `_fuelAuraMap` (index.html:142042), not
per tile. Rebuilding it inside the 7×9 tile loop meant 63 sweeps of the unit array per
frame for a cosmetic ring. It is `null` when nothing on the board projects a circle, which
is the common case and costs the loop nothing.

---

## 🌊 Sea — `SURFACE_TYPES.sea` (index.html:74998)

Terrain, not a hazard: **no `standDamage`, no `standStatus`.** What it does is decide who
may stand there and who may be hit there.

| unit | may enter? | attackable in it? |
|---|---|---|
| ground | **no** | n/a |
| flying | yes (passes over) | yes — normal flying rules, ranged + magic hit |
| aquatic (submerged) | yes | **only Storm-element moves** |

- **Aquatic is a FACTION** (`unit.factions` contains `'aquatic'`), not a flag. The new
  `amphibious` passive is the explicit opt-in for a construct or hero that should wade —
  it grants **entry only**, never the untargetable rule.
- `flockFlight` deliberately does **not** count as flying here. It is conditional flight
  granted by nearby birds and can evaporate mid-path, stranding a unit in open water with
  nowhere legal to stand.
- The submerged rule has **no Unblockable / Skyguard escape hatch**. Those two passives
  answer *flight*; the whole point of the rule is that nothing but Storm answers deep
  water.
- **`defaultTurns: 99`** — painted Sea is effectively permanent. `_setSurface` was changed
  to honour a surface's `defaultTurns` instead of the flat 3-turn hazard default. Terrain
  that evaporates would strand anything that had rerouted around it.
- **Sea is absent from the elemental surface reactions** in `_resolveSurfaceForMove` —
  those all test `here.type === 'water'` (the puddle). One fireball does not flash an ocean
  into steam, one ice shard does not freeze it, one storm bolt does not electrify it.
  Storm's interaction with the Sea *is* the aquatic-targeting rule.
- 3D board: `_BB_SURFACE_FX.sea = 'puddle'`. A deliberate downgrade — there is no deep-water
  shader, and a **missing** mapping trips the drift assert and draws nothing at all. The flat
  DOM board renders the real `.surf-sea` art (index.html:1259).

### Gate sites — all four must agree

| what | where |
|---|---|
| movement tiles | `getValidMoves` — index.html:83748 |
| walked path | `getMovePath` — index.html:100602 |
| attack | `executeMove` — index.html:99508 |
| splash | index.html:100051 |
| AI target scoring | index.html:152095 |

⚠ `getValidMoves` and `getMovePath` must mirror each other exactly. A path that walks
*through* Sea to a tile `getValidMoves` called legal would teleport a ground unit across
water it may not touch.

A ground unit that has Sea painted **under** it is not softlocked — it can still walk out,
because only *entering* is gated, not the tile it already occupies.

---

## 🔵 Counters — the markers, not the ⏱ Counter card

⚠ **Two different things sit next to each other in the editor. Do not confuse them:**

- **⏱ Counter card** (pre-existing, `type: 'counter'`) — a card held in hand and played to
  **negate**.
- **🔵 Counters** (new, `card.counterToken`) — named markers **stacked on a card**, which
  can later be **removed to pay** for an ability or a negation.

Authored per card in the Forge (`counterTokenBlock`, index.html:125923; saved at
index.html:128156). Shown for **every card type** — the spec is explicit that a location
holds counters just as a unit does.

```js
card.counterToken = {
  id, name, icon,
  start, max,                 // enters play with / cap (0 = uncapped)
  grantTo, grantAmount, grantOn,   // self|allies|enemies|any · N · never|turnEnd
  canCounter, counterCost, counterTargets,
}
```

The token **`id` is derived from the name**, not typed. Two cards that both say "Spell
Counter" must share one pool, or "remove 2 Spell Counters" cannot be paid from a partner
card.

### 🔴 Counts live in `state._counters`, never on the card

```js
state._counters = { '<kind>:<id>': { '<tokenId>': n } }
```

Units are spread-copied on nearly every reducer pass, and locations / enchantments /
weather are rebuilt from card data on every perspective swap and multiplayer snapshot. A
count riding on the object is one missed spread from being silently reset. `buildUnit`
carries the **token definition** onto the board unit (index.html:97602) so the engine can
read name/cap/cost without a card lookup — but never the counts.

Counts seed lazily from `token.start` the first time a holder is asked about, so "enters
play with 2" needs no summon-time hook.

### Holders

Units, plus `MythicCounters.permanentsFor()`: `state.activeLocation`, `state.enchantments[]`,
`state.weather`. That list is the "location cards can have counters" half of the spec — if
you add a new permanent zone, add it there.

### Spending to counter

`MythicCounters.pay` drains the **fullest holder first** so one big stack is used before
change is broken across several small ones, and **rolls back a partial payment** — a
half-paid negation would eat counters and still let the action through.

Wired into three places:

| | where |
|---|---|
| player eligibility | `tryPromptCounter` via `_counterPayableWithTokens` (index.html:136662) |
| player payment | `_battleActivateCounter` — tries counters *only* when energy is short, then sets `cost = 0` so the single energy deduction below stays the one place energy moves |
| AI | `_aiAutoCounter` — affordability is established **before** the random fire-chance roll, but the counters are **removed after** it, so a declined counter never wastes them |

⚠ `cheapest` in `_aiAutoCounter` was changed `const` → `let`; the counter path replaces it
with a cost-0 copy.

The prompt shows the alternative price (`· or 2 🔵 (3 held)`). Without it the prompt offers
a card the player cannot afford in energy with no hint why clicking it works.

---

## New on-play effect types

All four are ordinary `ONPLAY_TYPES` entries, so they work from **every** zone the on-play
funnel serves — unit on-play, field ability, spell, trap, grave ability.

| id | line | notes |
|---|---|---|
| `absorbSurface` | 85320 / handler 94462 | The "suck up Sea" ability. Drinks matching tiles in radius, heals `amount` **per tile**. `surfaceType: 'any'` absorbs everything. Distinct from `clearSurfaces`, which wipes indiscriminately and gains nothing. |
| `refuel` | 85324 / handler 94490 | `amount: 0` = fill to full. Clones the unit before refuelling — `MythicFuel.refuel` mutates `unit.fuel` in place, and mutating an object still in the previous state is invisible to identity-diffing renderers. |
| `addCounters` | 85332 / handler 94520 | Counter kind comes from **this card's own** token block; falls back to a generic `charge` so the effect can be wired before the counter is named. |
| `removeCounters` | 85333 | Same handler, sign flipped. |

`needs:` reuses only existing field keys (`amount`, `radius`, `surfaceType`, `tSide`) — no
new editor field types were introduced. Priced in `AI_FX_VALUE`; grouped under a new
`⛽🔵 Fuel & Counters` optgroup plus `absorbSurface` in the Field/Weather group.

---

## Not verified — do this first

**Nothing here has run in a browser.** What was actually verified:

- `node _synckcheck.mjs` — ALL CLEAN (and `node --check` on the module)
- a standalone Node harness over `effects.js` covering: burn/stall/refill; a lone Fuel (1)
  dying on its first tick; a Fuel (1) surviving five ticks inside a circle; a Fuel (3)
  leaving a circle and dying exactly three turns later; a hero stalling not dying; only the
  ticking side burning; sea entry + targeting for ground/flying/aquatic; absorption; and
  counter granting, capping, totalling across units **and** a location, and payment draining
  the fullest holder first.

That harness exercises the **module**, not the wiring. Everything below is untested:

1. **Open a real battle and confirm `window.MythicFuel` is defined.** The script tag is
   `defer`, so it runs after parse — fine for runtime calls, but this is the single
   assumption everything else rests on. If it is undefined, every call site silently
   degrades and *nothing* works while *nothing* errors.
2. **Forge a unit with `fuel1` and end a turn.** Confirm: pips render, badge goes red at 1,
   the unit is destroyed, and the death log line appears.
3. **Confirm the fuel death fires on-death triggers** — put a `deathrattle`-style passive on
   the test unit. This is the `_fuelResolveDeaths` path and it is the most likely thing to
   be subtly wrong.
4. **Paint a Sea and try to walk a ground unit in.** Then a flier, then an aquatic unit.
   Then attack the submerged aquatic with a non-Storm and a Storm move.
5. **Author a counter token, save the card, reopen the editor.** Confirms the save/load
   round-trip (there is no card-field allowlist, so it *should* persist wholesale).
6. **A counter card paid for with counters instead of energy** — player side and AI side.

### Known gaps, deliberately not built

- **The AI does not understand Fuel.** It will happily walk a fuelled unit out of a restore
  circle to its death and does not value refuelling. Fuel is functional but the AI plays it
  badly.
- **No fuel-death VFX** beyond the normal death handling.
- **`state._counters` is not garbage-collected.** A dead unit's counters stay in the map for
  the match. Bounded by units-per-match, so it is not a leak worth code today, but it is why
  the map is keyed rather than swept.
- **Multiplayer untested.** Counts live on the state object so they *should* ride snapshots
  like `board[y][x].surface` does. Unconfirmed.

## If you deploy

Per CLAUDE.md: bump `public/version.txt`, `window.BUILD_VERSION`, and `sw.js`
`CACHE_VERSION` **together** — already done, all three read `v120w8`. The script tag
cache-buster `src/battle/effects.js?v=120w8` moves with them and must, or clients keep the
old module against the new index.html.

Verify at the **edge** with curl, never the deploy log, and poll — propagation takes a
couple of minutes. **Commit before deploying**; see the deploy-restore trap in `HANDOFF.md`.
