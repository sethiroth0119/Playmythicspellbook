# Phase 0 — Tick Audit (Persistent World Simulation)

**Date:** 2026-08-18 · **Status:** complete, read-only. No code changed.
**Brief:** `PERSISTENT_SIMULATION_BRIEF.md`

---

## Headline

| | count |
|---|---|
| **Economic** loop entry points (must convert) | **21** |
| **Presentational** loops (leave alone) | ~190 |
| Economic sub-ticks hosted inside node-city's single `animate()` RAF | 12 |
| Non-deterministic rolls in payout paths (need a decision) | **18+** |

---

## 🔴 Worst offender — `_osimAnimate()` (`public/index.html:203341`)

Black River's extraction field runs **production inside the `requestAnimationFrame` render
loop**. `m.buffer`, `m.condition`, `_osimState.inv` and `stats.produced` are all mutated per
frame off `clock.getDelta()`.

Two consequences:

1. **Output is tied to monitor refresh rate**, and stops dead when the 3D canvas is not
   composited.
2. **There are two different production rates for the same field.** A closed-form stepper
   `_osimStepMachine` (`:203340`) already exists but is used *only* by `_osimOfflineCatchUp`
   (`:203363`) — and the two disagree on completion: the RAF path does `m.timer = 0`
   (discards the remainder), the offline path does `m.timer -= rate` (keeps it).

⚠ **Reconcile that divergence before converting anything.** Picking the wrong one silently
changes the field's yield.

---

## 🔴 LIVE BUG, not an offline one — expeditions and caravans are destroyed on reload

Verified directly, not inferred:

```js
// node-city/index.html:23883
game.expedition = { until: performance.now() / 1000 + trip, soldiers, … };
// :23839-23842 — caravans do the same
```

`performance.now()` restarts at ~0 on every page load. And `serialize()` contains
**zero** references to `expedition` or `caravan`.

So: send an expedition, press F5, and it is gone — along with the soldiers committed to it.
This is broken **today**, before any offline work, and it is a player-facing loss.

*(Correction to the sub-audit: `raid` and `nodeXp` DO appear in `serialize()` — 3 and 1
references respectively. Only `expedition` and `caravan` are entirely unsaved.)*

---

## ✅ Construction timers are already correct — Phase 1 has almost no work here

```js
t.bld = { k, l, s: Date.now(), d: durSec|0, fv, pc, pr }   // node-city:19374, :19691
```

`endAt = s + d*1000` is **derived, never stored**. `bldRemain` (`:19403`) is
`max(0, (s + d*1000 - now)/1000)`. It is serialized per tile with an explicit `Math.round`
on `s` (a `| 0` would truncate a 1.78e12 ms stamp to 32 bits), survives F5, and
`offlineCatchUp` (`:25391`) sweeps it against a virtual clock so a job completes at the hour
it actually finished. Completion credits nothing, so there is no double-pay.

**One residual gap:** `s` is a client stamp round-tripped through the save, so a backdated
`s` finishes any build instantly. `bldNormalize`'s clamp bounds the *duration*, not the
*start*. Same class as everything in the next section.

---

## 🔴 Client-clock reads that are written to persistence AND drive a payout

These are the exploitable ones. Volume overall: 939 `Date.now()` in `index.html` alone —
but only these compute money.

| File:line | Field | Exploit |
|---|---|---|
| `node-city:25145` | `savedAt: Date.now()` | Advance system clock → save → reload pays up to **36 h** (`OFFLINE_CAP_MS`, `:25323`) of real production |
| `index.html:203358` | `lastTick` → `Profile.blackRiver.extraction` → DB | Same, capped **24 h** (`:202664`) |
| `index.html:63159` | node `meta.lastTick` / `readyAt` | Owner-writable; gates `_nodeActive` and drives `_nodeEff` decay. The file's own comment at `:62463` concedes only a server rule closes this |
| `index.html:62115` | `departAt` / `arriveAt` | Convoy maturity → `addCinders(reward)` at `:62158` |
| `node-city:19694` | `bldRecord.s` | Backdated start finishes a 24 h build instantly |
| `node-city:3577-3582` | `fin.dueAt` / `lastPaid` | Investment close → `addCinders(payout)` at `:3590` |

---

## ✅ Already on the target model — DO NOT TOUCH

Six systems are already timestamp-based and are the pattern to copy:

- `src/city/production.state.js:324` (`elapsedRaw = Date.now() - p.lastCollect`) and
  **`:496`** (`p.lastCollect = Date.now() - remainder`) — the second one preserves the
  part-cycle instead of discarding it. That is the subtle half and it is easy to regress.
- `src/resonance/house.core.js:208-212` — `h.lastAt = Math.min(Date.now(), lastAt + ms)`,
  a monotonic watermark that cannot be pushed into the future.
- `node-city:3562` `finTick` (`dueAt`), `node-city:19374` construction,
  `index.html:62134` `frConvoyTick` (`arriveAt` + **seeded** roll),
  `index.html:196967` fishing (`endAt`), `index.html:193386` hero rest (`lastRestAt`).

**`src/economy/*` contains zero `Math.random()`.** It is already deterministic.

---

## Systems by severity

| System | Offline model today | Severity |
|---|---|---|
| Black River `_OSIM` | RAF production + 24 h capped catch-up | 🔴 Critical |
| Fuel Command (`fcTick`, `:204945`) | **None** — 30 s interval, screen-scoped | 🔴 Critical |
| Caravans / expeditions / refugees | **None** — session clock, unserialized | 🔴 Critical (reload-lossy) |
| Node City yields (`economyTick`) | 36 h capped slice-replay | 🟠 High |
| Node City raids | countdown, partially serialized | 🟠 High |
| Node XP | accumulator | 🟡 Medium |
| FoundationReserve node yields | ✅ point-based, time-decayed | 🟡 Medium (clock trust) |
| Fishing, FR convoys, city finance, construction, resting house, city production ops | ✅ correct | 🟢 Low |

**No standalone passive Cinder faucet exists.** All Cinder enters via the audited
`MythicEconomy` payout, `frConvoyTick`, raid rewards, `finTick`, `_mayorPayClaim`, or
`fcTick`'s `addGems`.

---

## The 18 rolls that need Seth's decision (brief §5.3)

Each is `Math.random()` inside a payout path. A roll that can be re-rolled by refreshing is
an exploit — the same rule the Aza and PRN fixes already established in this codebase.

**node-city:** raid `:20583, :20599, :20601` · caravan `:23839, :23840, :23841, :23870` ·
expedition `:23882, :23894, :23896, :23900, :23904` · refugees `:23914, :23917, :23918`
**index.html:** Fuel Command `:204995, :205000` (→ `fcFireEvent`, 12 more at `:204889`–`:204935`,
including `_fcRnd(300,1000)` debited from `Profile.gems` at `:204915`) · OSIM `:202980`,
`:203498` · fishing `:196999, :197002, :197039, :197040` · covert `:190149` · PP cull
`:199738` · rush drop `:214484`

**Three options per roll:** (a) collapse to expected value over elapsed time, (b) replay
from a seeded PRNG keyed on `(entityId, cycleIndex)`, (c) become server-authoritative.

**Recommendation: (b).** It is the only option that preserves current feel, and the codebase
already has a working instance — `frConvoyTick:62147` uses
`(_nodeSeed(cv.id) % 100) < riskPct`, a seeded, id-derived, replayable roll. Generalize that.

---

## Recommended Phase 1 order

1. **Expeditions / caravans** — fix the live reload loss first. Move off `performance.now()`
   onto `Date.now()` and add them to `serialize()`. Smallest change, real player harm today.
2. **`_osimAnimate`** — delete the production block from the RAF (keep the beam/drill/core
   animation), make `_osimStepMachine` the single path driven from `lastTick`. **Reconcile
   the `m.timer` divergence first.**
3. **`fcTick`** — the only system with no offline model at all.
4. **`raidTick` / `nodeXpTick`** — convert countdowns to `nextRaidAt` stamps.
5. **Server-authoritative time** for every stamp in the exploit table. Until then, `savedAt`
   and `lastTick` are each one clock change away from 24–36 h of free production.

**Do not touch:** `bldRecord`/`bldSweep`, `finTick`, `frConvoyTick`, `wfTickExpeditions`,
`src/city/production.state.js`, `src/resonance/house.core.js`. All six are already correct.
