# CITY CONSTRUCTION TIMERS — THE BUILD SPEC
branch `city-construction-timers` · supersedes Designs 1/2/3

---

## 0. CORRECTIONS TO THE JUDGES AND THE DESIGNS (verified against source, not recon)

Read this section first. Three of the designs' headline numbers are derived from a **stale code comment**, and one judge's ranking rests on it.

**0.1 `costOf()` MUST NOT FEED THE DURATION CURVE. Designs 1 and 3 are fatally wrong here; Judge 3 is right.**
Verified: `costOf` returns `{...def.tierCost[lvl-1]}` **before** `baseCost`/`scaleCost` (`public/node-city/index.html:17136`), while every other building is multiplied by `BUILD_CINDER_MULT = 100` (`:17107`). The comment at `:17102-17105` claims tierCost "is already at the right scale (90k → 1.1M)" — **that comment is stale.** The real tables are:
- `resthouse.tierCost = [{cinder:45},{cinder:120},{cinder:260},{cinder:550}]` (`:2263`)
- `stadium.tierCost = [{cinder:600,…},{cinder:1200,…},{cinder:2400,…}]` (`:2310-2312`)

So `costOf('stadium',1).cinder === 600` while `costOf('farm',1).cinder === 1400`. Any cost-derived duration built on `costOf` makes a Stadium build **faster than a starter Farm**. Design 1's quoted "Stadium 4h00 / Resting House T3 24h" and Design 3's "Resting House T4 13.1h" **do not exist in the data**.
→ **We use the RAW `def.cost` / `def.tierCost` dicts.** They are all authored on one shelf (`bush` 2 … `holdco` 11000, tierCost 45–2400 sitting inside it) and are directly comparable. This is Design 2's call and it is the only correct one.

**0.2 The boot order kills Design 1 and makes Design 3's retune-rescale dead code. Judge 1 is right.**
Verified: `await loadState();` is `:24238`. `await import('../src/economy/index.js?v=…')` is `:24289`. `window.MythicEconomy` is **undefined for the entire tile-rehydration pass, on 100% of page loads.**
→ Design 1's load clamp reads `ECON…capH`, gets the `0` default, clamps `bt` to `Date.now()`, and **completes every in-flight build on every reload.**
→ Design 3's `fv !== cur` rescale calls `bldDuration()`, whose first line is `if (!C) return 0`, so the `d2 > 0` guard always rejects. The mechanism can never fire.
→ **Our load path reads no ECON at all**, and a second normalise pass runs *after* the import resolves. See §4.

**0.3 Design 1's site/upgrade discriminator fails toward firm destruction. Judge 2 is right.**
`underConstruction = bt>0 && (bl|0) <= (lvl|0)` collapses a live upgrade into an inert site whenever `bl` is absent, zero, non-numeric, or clamped down by a `maxLvl` retune — dropping a standing L3 building out of `ecoBuildings()` (`:16947`) and handing its firm to `Firms.reap()`.
→ **We carry an explicit `k` flag (0 = new, 1 = upgrade), never a level comparison.**

**0.4 Design 1's grace multiplier inverts the reward. Judges 1 and 3 both caught it.**
`if (k('requireCo') && !hasConstructionCo()) mins *= 0.15` means buying the Construction Co. makes every build **6.7× slower**. Cut entirely; there is no grace multiplier in this spec.

**0.5 Design 2's `sm` rescale-on-capacity-change is cut. Judge 2 is right that it is fatal.**
`workersOf()` reads the parent OPS manifest and degrades to `0` when `OPS.st` is null (standalone/message mode, failed RPC). A stale manifest would silently multiply every in-flight deadline by up to 2.0 **and persist it**, and it fires on exactly the scenario the brief names (Construction Co. destroyed mid-build).
→ **Crew speed is baked in at ORDER time and never re-anchored.** Losing or gaining a Co. changes nothing about jobs already running. The "watch four timers drop at once" payoff is replaced by: completing a Co. **immediately opens crew slots** (start 3 more jobs *now*) and speeds every future job.

**0.6 Design 2's `startupOf(opType)` is a Rule-4 back door. Judge 1 is right.**
It reads `OPS_MOCK_PRICE` (`:21579`, a literal in index.html) into a duration. Verified: every op is registered with `cost: {}` (`:21491`), so no cost-derived formula works for them anyway.
→ **Ops get a flat `ECON.construction.opSec`.** One number, in ECON.

**0.7 Design 1's `damageTile` guard makes construction sites indestructible. Judge 2 is right.**
The anchor/road guard is `:3545`; the `if (destroy)` branch is `:3547`. A guard on line 3545 shelters a site from raid/lightning/fire/anomaly/tornado destruction.
→ **Our guard goes inside the `else` branch (`:3556`).** A site cannot be *damaged*; it can be *destroyed*, and destruction is a total loss exactly as it is for a finished building.

**0.8 Design 2's offline sweep-before-the-loop mints production. Judges 2 and 3 both caught it.**
`offlineCatchUp` monkey-patches `MythicCityBridge.addRes/addCinders/spendRes` for the whole slice loop (`:21030-21042`). Completing a building at t=0 of a 36 h absence when it really finished at t=35 h credits 35 hours of output nobody earned, as real ledger writes.
→ **Virtual-clock sweep inside the slice loop** (Design 3's idea), with the O(slices×tiles) blow-up fixed (§5.3).

**0.9 A REAL, PRE-EXISTING RACE ALL THREE DESIGNS ASSERT IS IMPOSSIBLE. Judge 2 found it; verified.**
In `tryPlace`, `count` is computed at `:17215`, but the tile is not written to `game.tiles` until `:17274` — after `await payCost(cost)` at `:17260`. `_placing` is a **per-square** `Set` (`:17209`). Two fast clicks on two *different* squares both pass a `cap: 1` check and both place, **today**. 24-hour timers turn a cheap, obvious duplicate into a day-long unwinnable tile.
→ We fix it (§7.1). Not caused by this feature; made expensive by it.

**0.10 Not fixed here, flagged:** `ecoHost().hasBank` (`:16978`) tests `t.type === 'bank'`, but the bank is `BUILDINGS['op_bank']` (registered by the loop at `:21489`). `hasBank` is permanently false → `bank.js` refuses every loan → the entire DEBT rung is dead code. Judge 1 verified the fix is audit-safe (`S.treasury -= Bank.capitalise(seed)` is an in-window transfer between two `totalCinder()` terms). **Separate commit.** Also unfixed: `wear: td.wear || 0` (`:21325`) is a live truthy-string bug sitting one line from our new load code — **do not copy the neighbouring line.**

---

## 1. WHAT SHIPS

Every non-exempt building placement and every upgrade becomes a **build order** occupying a **crew slot** for a wall-clock duration derived from what the building is worth, capped at 24 hours. One nullable sub-object on the tile, `t.bld`, is the entire state machine.

Two kinds, and the distinction is load-bearing:
- **`k = 0` (site)** — nothing standing. Invisible to production, jobs, popCap, defense, coverage, logistics, morale, and the economy.
- **`k = 1` (upgrade)** — a **standing, working building** at its current level. `t.lvl` is simply not incremented until completion. **Never withdrawn from `ecoBuildings()`.**

The Construction Co. is a **capability, not a prerequisite**. A free Municipal Works crew (2 slots) takes any job under 40 minutes. Longer jobs need a completed, undamaged `op_construction`, which also buys parallel crews and up to ×2.0 speed on future orders.

**The invariant that has no automated tripwire and must be enforced by review:**
> A tile may be ABSENT from `ecoBuildings()` until its first completion, and is PRESENT forever after. It is NEVER withdrawn. `ecoBuildings` is gated on `bldSite`, **never** on `bldBusy`.

Because `syncBuildings` (`public/src/economy/index.js:155-166`) sets `rung='BANKRUPT'` + `reported=true` and `Firms.reap()` deletes the firm *before any log line*, and its cash leaves `totalCinder()` uncompensated — while `sim.js`'s audit captures `before` inside `runDay` (`sim.js:820`) and `syncBuildings` runs from a 4 s `setInterval` (`:24318`). **The gauntlet stays GREEN through a firm reap.** WP7 ships the only tripwire.

---

## 2. THE ECON GROUP (the only place any of these numbers exists)

New top-level group in `public/src/economy/tuning.js`, inserted between `firm` (`:157`) and `price` (`:230`).

```js
  /* ── 🏗 CONSTRUCTION ────────────────────────────────────────────────────
     How long a building takes to go up. node-city holds NO copy of any of
     these: it computes a PROFILE from BUILDINGS (which only it can see) and
     hands it to Construction.seconds() below. If this module never loads,
     buildSeconds is unreachable, no timer is ever written, and the city
     places buildings instantly exactly as it did before this feature — and
     any job already on disk is COMPLETED, never parked. That is the degrade
     path and it is why there is no fallback literal in index.html (Rule 4).
     Time scales with what a building is WORTH: 65% of the signal is what it
     PRODUCES (cinder, tier-weighted resources, service), 35% is what it cost.
     maxSec is the ceiling the feature was asked for. */
  construction: {
    on:        1,
    formulaV:  1,          // bump on ANY retune below; rescales in-flight jobs
    minSec:    60,
    maxSec:    86400,      // 🔒 24 HOURS. The only place this number exists.
    gamma:     1.7,        // compresses the starter shelf into minutes
    costExp:   0.62,       // compresses a 3400x cost range into a usable band
    weight: { cinder: 0.20, resource: 0.30, service: 0.15, cost: 0.35 },
    full:   { cinderPerHr: 0.30, resource: 1400, service: 3.0, cost: 1200 },
    costResWeight: 2,      // one raw non-cinder unit ≈ 2 raw cinder on the shelf
    tierMul:   4,          // unit value = tierMul^tier  →  1 / 4 / 16 / 64
    defaultTier: 1,
    resSkip:  ['cinder', 'power'],   // ⚠ 'power' is never banked (index.html:2211)
    resTier: { food:0, water:0, wood:0, stone:0, cloth:0, metal:0,
               fuel:1, planks:1, supplies:1, rations:1, goods:1, ingots:1, ammo:1,
               reagents:2, medicine:2, remedies:2, components:2,
               memoryShards:3, corruptedEssence:3 },
    exemptTypes: ['road', 'wall', 'streetlight', 'lot'],  // + anything def.decor
    opSec:     900,        // every op_* is a flat 15 min. Ops carry cost:{}
                           // (index.html:21491) so no cost curve applies, and
                           // reading OPS_MOCK_PRICE would be a Rule-4 breach.
    upgrade:   { base: 0.75, mulPerLevel: 1.6 },
    municipal: { slots: 2, maxSec: 2400 },   // free crew; 40-minute ceiling
    slots:     { perCo: 1, perWorkerStep: 6, max: 6 },
    speed:     { perCo: 0.20, perWorker: 0.025, maxMul: 2.0 },
    confirmOverSec: 3600,  // gcConfirm anything over an hour
  },
```

### 2.1 The curve is a MODULE function, not index.html code

New file `public/src/economy/construction.js`, exported on the public API as `MythicEconomy.buildSeconds(profile)`.

```js
export function seconds(p) {
  const C = ECON.construction;
  if (!C || !C.on) return 0;
  if (p && p.fixedSec > 0) return clamp(Math.round(p.fixedSec), C.minSec, C.maxSec);
  const w = C.weight, f = C.full;
  const nCin  = (+p.cinderPerHr || 0) / f.cinderPerHr;
  const nRes  = (+p.res         || 0) / f.resource;
  const nSvc  = (+p.svc         || 0) / f.service;
  const nCost = Math.pow(Math.max(0, +p.cost || 0) / f.cost, C.costExp);
  let score = w.cinder*nCin + w.resource*nRes + w.service*nSvc + w.cost*nCost;
  score = Math.min(1, Math.max(0, score));            // clamp AFTER summing
  let sec = C.minSec + (C.maxSec - C.minSec) * Math.pow(score, C.gamma);
  if (p.kind === 1) sec *= C.upgrade.base * Math.pow(C.upgrade.mulPerLevel, (p.lvl|0) - 1);
  sec = sec / Math.max(1, +p.speedMul || 1);          // crew speed, then the cap
  if (!Number.isFinite(sec)) return C.minSec;
  return Math.min(C.maxSec, Math.max(C.minSec, Math.round(sec)));
}
```

Putting the math in the module is what makes it **node-testable** (WP1's acceptance) and what keeps index.html free of every number.

### 2.2 The profile builder (index.html — it needs `BUILDINGS`, `genOf`, `LEGACY_SERVICE`)

```js
/* ⏳ Everything the curve needs, extracted from a building def. Returns null
   for an exempt type (⇒ instant, no timer, no slot).
   🔴 RAW def.cost / def.tierCost — NEVER costOf(). costOf returns tierCost
      UNSCALED (:17136) while scaleCost multiplies everything else by 100
      (:17107), so a costOf-derived time builds a Stadium (600) faster than a
      Farm (1400). The comment at :17102 claiming tierCost is "already at the
      right scale (90k→1.1M)" is STALE — the table is [45,120,260,550].
   🔴 genOf(), NEVER def.gen.cinder. def.gen.cinder is a per-minute figure paid
      at /CINDER_PERIOD_DIV (:2825-2832) and the comment there forbids reading
      def.gen[r] directly in any panel. genOf(def,'cinder')*60 is cinder/HOUR. */
function bldProfile(type, lvl, kind, speedMul) {
  const C = bldCfg(); if (!C) return null;
  const def = BUILDINGS[type]; if (!def) return null;
  if (bldExempt(type)) return null;
  if (opsTypeOf(type) !== null) return { fixedSec: C.opSec, kind, lvl, speedMul };

  const rate = Math.pow(RATE_MULT, lvl - 1);           // matches tileMult :16549
  const dv = d => { let v = 0; for (const k in (d||{}))
      v += (k === 'cinder') ? (+d[k]||0) : (+d[k]||0) * C.costResWeight; return v; };
  const raw = (def.tierCost && def.tierCost[lvl-1])
      ? def.tierCost[lvl-1]
      : (() => { const m = Math.pow(UPGRADE_MULT, lvl-1), o = {};
                 for (const k in (def.cost||{})) o[k] = (+def.cost[k]||0) * m; return o; })();

  const cinderPerHr = (def.gen && def.gen.cinder) ? genOf(def,'cinder') * 60 * rate : 0;
  let res = 0;
  for (const r in (def.gen || {})) {
    if (C.resSkip.indexOf(r) >= 0) continue;
    let tier = C.resTier[r];
    if (tier === undefined) { try { const m = window.MythicResourceChain &&
        window.MythicResourceChain.byId(r); tier = (m && Number.isFinite(+m.tier)) ? +m.tier
        : C.defaultTier; } catch (e) { tier = C.defaultTier; } }
    res += genOf(def, r) * 60 * rate * Math.pow(C.tierMul, tier);
  }
  const svc = (((def.svc && def.svc.supply) || 0) +
               ((LEGACY_SERVICE[type] && LEGACY_SERVICE[type].supply) || 0)) * lvl;

  return { cost: dv(raw), cinderPerHr, res, svc, lvl, kind, speedMul };
}
function bldDuration(type, lvl, kind, speedMul) {
  const E = window.MythicEconomy; const p = bldProfile(type, lvl, kind, speedMul || 1);
  if (!p || !E || typeof E.buildSeconds !== 'function') return 0;
  return E.buildSeconds(p) | 0;
}
```

### 2.3 WORKED EXAMPLES (all inputs read from source; assert these in WP1)

`costResWeight=2`, `full.cost=1200`, `costExp=0.62`, `gamma=1.7`, `speedMul=1`, L1, `kind=0`.

| building | raw cost dict (`:line`) | costVal | nCost | ₵/hr | res | svc | score | **duration** |
|---|---|---|---|---|---|---|---|---|
| **road** | `{cinder:4}` `:1996` | — | — | — | — | — | — | **0 (exempt)** |
| **farm** | `{cinder:14,metal:4}` `:1998` | 22 | 0.08379 | 0 | 90 | 0 | 0.048611 | **566 s = 9m26** |
| **housing** | `{cinder:26,metal:10,supplies:6}` `:2090` | 58 | 0.15282 | 0 | 0 | 0 | 0.053486 | **654 s = 10m54** |
| **gasstation** | `{cinder:34,metal:14}` `:2008` | 62 | 0.15925 | 0.25 | 0 | 0 | 0.222405 | **6765 s = 1h52m45** |
| **arena** | `{cinder:160,metal:40,supplies:20}` `:2104` | 280 | 0.40557 | 0.20 | 0 | 0.8 | 0.315283 | **12192 s = 3h23m12** |
| **holdco** | `{cinder:11000,metal:900,supplies:450,memoryShards:18}` `:2059` | 13736 | 4.53326 | 0 | 0 | 0 | **1.0 (clamped)** | **86400 s = 24h00m00** |
| **op_construction** | `cost:{}` `:21491` | — | — | — | — | — | — | **900 s = 15m00 (flat opSec)** |

Sanity points, same method: `indexfund` 53868 s = **14h57** (top separates from holdco — this is why `full.cost` is 1200 and not Design 2's saturating value), `sawmill` 1843 s = **30m43**, `barracks` 2016 s = **33m36**, `tower` 1398 s = **23m18**, `purifier` 741 s = **12m21**, `scrapmine` 714 s = **11m54**, `warehouse` 905 s = **15m05**.
Upgrades: `farm L1→L2` **1489 s = 24m49**, `farm L2→L3` **5680 s = 1h34**, `powerstation L1→L2` **8888 s = 2h28**.

**`power` is skipped** (`resSkip`). Design 2 let `gen.power 6.0` fall through to `defaultTier 1` (×4), producing `vRes = 1440` against `full.resource = 1400` — the single largest resource channel in the game, from a quantity that is never banked (`:2211`), making the mandatory Power Station a 5h52 build above the ceiling. Judge 3 caught this; Design 3's skip is the fix.

---

## 3. THE TILE FIELD

Runtime: **`t.bld`**, nullable object. Its presence *is* the state machine. `delete t.bld` on completion — never store `null` on a live tile, so every predicate is a bare truthiness test that is safe on anchors (`spawnAnchors :16316` creates `{type:'anchor',anchor,mesh}` — no `lvl`, no `born`).

```js
t.bld = {
  k:  0 | 1,        // 0 = new site, 1 = upgrade of a STANDING building
  l:  int,          // target level. 1 when k=0; t.lvl+1 when k=1
  s:  ms,           // Date.now() at the moment payCost RESOLVED
  d:  int seconds,  // planned duration. endAt = s + d*1000, DERIVED, never stored
  fv: int,          // ECON.construction.formulaV the record was written under
  pc: int,          // cinder ACTUALLY paid for this order (honest-refund basis)
  pr: {res:n}|null, // non-cinder resources actually paid for this order
}
```

**Three predicates.** Declare beside `fmtCountdown` (`:16989`) so they are above every consumer.

```js
const bldBusy   = t => !!(t && t.bld);                    // any job — UI/re-entrancy ONLY
const bldSite   = t => !!(t && t.bld && t.bld.k === 0);   // NOTHING STANDING — the read-site gate
const bldRemain = (t, now) => t && t.bld
      ? Math.max(0, (t.bld.s + t.bld.d*1000 - (now || Date.now())) / 1000) : 0;
const bldExempt = type => type === 'anchor'
      || (bldCfg() ? bldCfg().exemptTypes.indexOf(type) >= 0 : true)
      || !!(BUILDINGS[type] && BUILDINGS[type].decor);
```

`bldSite` is what goes at the ~30 integration points. `bldBusy` only hides buttons. **An upgrading tile is excluded NOWHERE.**

`s + d` rather than a bare deadline (Design 3's call, and it is right): a bare deadline cannot be sanity-checked against the formula, the progress bar needs both halves, and `d` is what lets the load clamp bound the job **using no constant** (§4.1).

### 3.1 The four tile constructors must all agree
| # | site | change |
|---|---|---|
| a | `tryPlace :17266` | add `bld: <record or null>` to the literal |
| b | `spawnAnchors :16316` | **no change** — anchors have no `bld`; predicates return `false` on `undefined` |
| c | `loadState :21322-21350` | add `bld: bldLoad(td.b, lvl, td.type)` |
| d | `opsReconcile boot-restore :21914` | add `bld: null` explicitly (shape parity; ops resurrect finished, which is correct — the licence is paid and sited) |

---

## 4. SAVE / LOAD

**DO NOT BUMP `v`.** It stays 5. `:20750-20751` states plainly that `v` is bumped but nothing branches on it and every field is read with a default; adding a branch is how v4/v5 saves start failing. All three designs agree. **DO bump `window.NC_BUILD` (`:12`)** — the economy contract gains a module and a group.

**serialize()** — `:20716-20743`, conditional spread so no finished tile grows by a byte:
```js
...(t.bld ? { b: {
    k:  t.bld.k ? 1 : 0,
    l:  t.bld.l | 0,
    s:  Math.round(+t.bld.s || 0),      // ⚠ Math.round, NEVER |0
    d:  Math.round(+t.bld.d || 0),
    fv: t.bld.fv | 0,
    pc: Math.round(+t.bld.pc || 0),
    pr: (t.bld.pr && typeof t.bld.pr === 'object') ? t.bld.pr : null,
  } } : {})
```
⚠ `|0` on `s` truncates a ~1.78e12 ms stamp to garbage under a 32-bit bitwise OR — written down at `:20791-20794` for `fin.dueAt`.

### 4.1 loadState — READS NO ECON, AND EVERY AMBIGUITY RESOLVES TOWARD COMPLETION

`loadState` runs at `:24238`; the economy imports at `:24289`. **`window.MythicEconomy` is undefined here on every load.** This function therefore uses no constant at all — it bounds the job **by the duration on its own record**.

```js
/* 🏗 Rehydrate a build order. ⚠ RUNS BEFORE window.MythicEconomy EXISTS
   (loadState :24238 vs the import at :24289) — it must read NO ECON value.
   The bound comes from the record itself: endAt = s + d*1000 and s is clamped
   to now, so at most one full written duration can remain. The ABSOLUTE
   ECON.maxSec bound and the formulaV rescale are applied by bldNormalize(),
   which runs after the module mounts.
   GOVERNING PRINCIPLE — EVERY AMBIGUITY RESOLVES TOWARD COMPLETION. NaN,
   Infinity, a truthy string, a target at or below the current level, junk:
   drop the record, the building is FINISHED. The player already paid at
   placement, so completing early costs pacing; stalling forever bricks a
   paid-for tile and is unrecoverable without a save edit. There must be no
   reachable state in which a building is under construction forever.
   ⚠ Number.isFinite, never `|| 0` — `wear: td.wear || 0` two lines up (:21325)
     is a LIVE instance of the truthy-string bug this branch already fixed. */
function bldLoad(raw, lvl, type) {
  if (!raw || typeof raw !== 'object') return null;
  const now = Date.now();
  const s0 = Number.isFinite(+raw.s) ? +raw.s : NaN;
  const d0 = Number.isFinite(+raw.d) ? Math.round(+raw.d) : NaN;
  if (!Number.isFinite(s0) || !Number.isFinite(d0) || d0 <= 0) return null;
  const s = Math.min(s0, now);            // future stamp ⇒ started now (house.core.js:140)
  const k = raw.k ? 1 : 0;
  let l = Math.min(BUILDINGS[type].maxLvl || MAX_LVL, (+raw.l) | 0) || 1;
  if (k === 0) l = 1;                     // a fresh build is always level 1
  else {
    if (l <= lvl) return null;            // upgrade already landed in a newer write
    if (l > lvl + 1) l = lvl + 1;         // a save may never grant a multi-level jump
  }
  return { k, l, s, d: d0, fv: (+raw.fv) | 0,
           pc: Math.max(0, Math.round(+raw.pc || 0)),
           pr: (raw.pr && typeof raw.pr === 'object') ? raw.pr : null };
}
```
Also: a tile that loads with **both** `b` and `dmg` drops `dmg` (`t.damaged = false`). One blocking state, defined precedence — and §7.4 makes the pair unreachable at runtime anyway.

### 4.2 bldNormalize() — runs once, immediately after the import resolves (`:24289`)
```js
/* Applies the two bounds that NEED ECON, at the first moment ECON exists.
   ⚠ IF THE ECONOMY MODULE IS ABSENT (its documented right, economy/index.js
     :18-22), we do NOT leave jobs parked with an unbounded `d` — we COMPLETE
     THEM ALL. The feature is off; a paid-for tile is never held hostage to a
     CDN hiccup. This is the one place Design 2 would have bricked. */
function bldNormalize() {
  const C = bldCfg();
  if (!C) { bldFinishAll('economy module absent'); return; }
  for (const [k, t] of Object.entries(game.tiles)) {
    if (!t.bld) continue;
    t.bld.d = Math.min(t.bld.d, C.maxSec);          // absolute ceiling
    if ((t.bld.fv | 0) !== (C.formulaV | 0)) {      // retune: may only SHORTEN
      const d2 = bldDuration(t.type, t.bld.l, t.bld.k, 1);
      if (Number.isFinite(d2) && d2 > 0) t.bld.d = Math.min(t.bld.d, d2);
      t.bld.fv = C.formulaV | 0;
    }
  }
  bldSweep(Date.now());
}
```
This is the generalisation of the `game.raid.ri` trick (`:20757`, load `:21221-21241`) — and unlike Design 3's version, it actually runs, because it is called after the module exists.

**Old v5 saves:** no `b` on any tile ⇒ every tile loads finished. Semantically exact — a save written before this feature contains only completed buildings.
**Rollback (old build reads a new save):** the unknown `b` key is dropped at `:21322` and the site becomes a finished building the player already paid for. The safe direction; state it in the commit.

---

## 5. TIME SOURCE, TICK PLACEMENT, TAMPER STANCE

**Absolute wall clock, `Date.now()`.** `game.fin.dueAt` is the shipped, debugged version of this exact problem and its comment (`:15945-15953`) states the reason: "a countdown only advances while the city is open, so a 72-hour cycle would take weeks of play to close." `game.cityAge` advances only inside `vitalsTick` (`:19046`), freezes entirely in a backgrounded tab (the bug `visibilitychange` at `:21184-21195` exists to patch) and is capped at `OFFLINE_CAP_H = 36` (`:20924`). `game.raid.timer` is explicitly the **wrong** template despite being named in the brief — `offlineCatchUp` deliberately does not run `raidTick` (`:20913-20922`).

### 5.1 `bldSweep(nowMs)` — the completion engine
Synchronous. **Reads no ECON** (Design 1's one genuinely good property), so a job already on disk completes even in a session where `/src/economy` is gone. Wrapped in `try/catch` at every call site, exactly like `try { finTick(); } catch (e) {}` (`:24187`).

Per tile with `t.bld` and `nowMs >= s + d*1000`:
1. **`const rec = t.bld; t.bld = null;` FIRST**, before any work — the `finTick` "zero `dueAt` before the await" precedent (`:2679`). Re-entrancy is impossible.
2. `t.lvl = rec.l` (the *only* place `t.lvl` moves for an upgrade).
3. If `rec.k === 0`: `t.born = game.cityAge || 0`. **Stamped at completion, not at order** — `tileGrace` (`:19367-19373`) measures `born` against `cityAge` and feeds `tileOutputFactor` (`:19385-19394`); stamping at order burns the new-building grace while the tile is a hole in the ground. (Design 2's catch; neither other design saw it.) `t.spent` is *not* touched — money genuinely left at order.
4. Mesh: `if (t.type === 'road') refreshRoadArea(x,z); else { dropTileMesh(t); t.mesh = buildMesh(...); placeMeshAt(...); }`. **No `clearBuildLook`, no second `userData` colour stash.**
5. Collect the key; set a dirty flag.

After the pass, if anything completed **and we are not inside `offlineCatchUp`**: `computeLinks(); manageAgents(); updateHUD(); ecoSync(); saveNow();`
- `saveNow`, not `saveSoon` — a completion is exactly the moment a crash gives a free or a lost building, and nothing else on the 4 s beat writes (the next write would otherwise be up to 60 s away via `periodicSaveTick`, `:20880-20887`).
- `ecoSync()` explicitly, or a finished building waits up to 4 s to become a firm (`:24318`).
- **ONE batched toast** (`🏗 5 buildings finished.`) — `toast()` caps the rail at 3 and collapses exact repeats (`:20614-20648`), so per-building toasts evict unrelated messages. Per-building detail goes to `logEvent`.
- If `selectedKey` completed, `openInspect(selectedKey)` so the dossier flips from countdown to real.

**Skip any tile key present in `OPS.placing`** (`:21249`). The ops `tryPlace` wrapper (`:21841-21878`) writes the tile, awaits the licence RPC, and rolls back with `dropTileMesh` + `delete` on failure (`:21867`); the 4 s sweep can fire inside that window. Only Design 2 spotted this.

### 5.2 Call sites
| where | call |
|---|---|
| `animate()` 4 s sysTimer block `:24187` | `try { bldSweep(Date.now()); } catch(e){}` immediately after `finTick()` |
| after the economy import `:24289` | `bldNormalize()` (which ends in a sweep) |
| inside `offlineCatchUp`'s slice loop `:21068` | virtual clock — §5.3 |
| after `offlineCatchUp()` returns `:24432` | one unconditional `bldSweep(Date.now())` for anything past the 36 h cap |

### 5.3 The offline sweep — virtual clock, without the O(slices × tiles) blow-up
`OFFLINE_SLICE_SEC = 10` (`:20953`) and `OFFLINE_CAP_H = 36` (`:20924`) ⇒ up to 12,960 slices. Design 3's per-slice full tile walk is ~7M tile visits inside a loop that yields only every 400 slices.

Before the loop: build `_bldDue = [{key, endAt}, …]` sorted ascending, and `_bldNext = _bldDue[0].endAt`.
Inside the loop, after `decayTick(dt, true)`:
```js
const vnow = from + done * 1000;
if (vnow >= _bldNext) { bldSweep(vnow); _bldRebuildDue(); }   // O(1) in the common case
```
Rules inside the catch-up:
- **Never touch `addRes` / `addCinders` / `spendRes`** — they are monkey-patched for the whole loop (`:21022-21042`). Completion credits nothing; cost was paid at order. This is what makes the whole feature Rule-1-safe.
- **Never call `ecoSync()` per completion** — set the dirty flag and sync once when the loop exits.

This credits a building exactly the offline production it earned. Design 2's sweep-before-the-loop over-credits (a real mint through the patched bridge); Design 1's post-loop-only sweep under-credits by up to 36 h.

### 5.4 Tamper stance — stated, not pretended away
There is no server time source in `MythicCityBridge`. Be honest in the comment:
- **Defended:** a future-dated stamp cannot park a tile (`s = min(s, now)`); an unbounded `d` cannot survive (`bldNormalize`, or completion if the module is absent); a rolled-back clock cannot add unowed time.
- **Not defended:** setting the system clock forward skips a build. **Acceptable, because it grants TIME and never CURRENCY** — cost was debited at order (`payCost :17260` / `:18452`) and completion credits nothing at all, so no clock manipulation forward, backward or through the save file can move a single Cinder. Converting that time into money still requires `economyTick`, capped at 36 h per return (`:20924`) and at 3 economic days in the sim (`tuning.js:45`).
- Identical in kind to the shipped `game.fin.dueAt` (72 h) and `t.house.lastAt` (36 h); strictly weaker than both. If server-authoritative timing is ever wanted, the stamp belongs in the ops row next to `site.sitedAt` and **`bldNow()` is the single function to change**. Do not build that now.
- **Deliberately NOT "fixed" with a monotonic watermark.** Forcing `now = max(Date.now(), lastSeen)` would make a legitimately corrected system clock complete every future build instantly, forever.

---

## 6. CREWS, THE GATE, AND THE BOOTSTRAP

```js
function bldCoTiles() {                       // completed, undamaged Construction Cos
  const ty = (typeof opsKeyOf === 'function') ? opsKeyOf('construction') : 'op_construction';
  return Object.entries(game.tiles)
    .filter(([k,t]) => t.type === ty && !t.damaged && !bldBusy(t));
}
```
⚠ **Derive the type string through `opsKeyOf`, never type `'op_construction'`.** `ecoHost().hasBank` (`:16978`) is a live, verified instance of exactly this bug one line from code we touch. (Design 3's idea; both judges endorsed it.)

`workersOf([k,t]) = (opsRowForKey(k) || {}).workers | 0` — 0 when `OPS.st` is null, which is safe **because it is read only at order time and never re-anchors a live deadline** (§0.5).

- `bldSlots()` = `min(slots.max, municipal.slots + Σ (slots.perCo + floor(workers / slots.perWorkerStep)))` → **2** with no Co.; **5** with one 12-worker Co.; **6** capped.
- `bldSpeed()` = `min(speed.maxMul, 1 + Σ (speed.perCo + workers × speed.perWorker))` → **1.0** / **1.50** / **2.0**.
- `bldActive()` = count of tiles with `t.bld`.

**Order-time refusal, always BEFORE `payCost`:**
1. If `bldActive() >= bldSlots()` → refuse, naming the time the next crew frees (`fmtCountdown` of the soonest `endAt`). **No queue** — paying now for something that starts in twenty hours is the worst possible shape for a 24 h timer, and a queue would add a paid-but-unstarted persisted state with its own cancel and reconciliation paths.
2. Else if `opsTypeOf(type) === null` and `durSec > municipal.maxSec` and no completed Co. stands → refuse with the locked-card treatment (§8).

### The bootstrap — four independent exits, any one sufficient
1. **The free Municipal Works crew.** 2 slots, ×1.0, takes any job ≤ 2400 s. This *is* the gate, expressed as a duration ceiling rather than a yes/no requirement. Judges 1 and 3 both rank this the cleanest resolution in the set.
2. **The whole starter shelf is under the ceiling** — verified against the real defs: farm 9m26, housing 10m54, purifier 12m21, mine 11m54, warehouse 15m05, tower 23m18, sawmill 30m43, barracks 33m36. A Construction-Co-less city builds a complete, fed, defended, self-sustaining settlement.
3. **Roads, walls, street lights, lots and all decor are exempt entirely** — instant, no slot, no gate. Without this the curve puts a road at ~1 minute and paving a grid becomes twenty countdowns; it also sidesteps the road-maintenance-cap branch at `:17218-17224`. (Design 2's wider exempt list; Design 3's `['road']` alone is too narrow.)
4. **Every `op_*` is exempt from the requirement** (never from the timer or the slot). The 350,000 🔥 was already paid at City Hall and the registration loop's own comment (`:21485-21488`) says charging twice for one business "is the kind of thing a player never forgives." And `op_construction` computes to **900 s = 15m**, comfortably inside the ceiling — **so the bootstrap closes twice over, independently.**

**Ops still cost a slot and 15 minutes**, so the price is real: siting your Bank ties up a crew.

**The consequence to say out loud** (Judge 3 is right that Design 2 said it too quietly): **every Cinder earner sits above the ceiling** — gasstation 1h53, shop ~1h15, arena 3h23, club ~3h40. A pre-Co. city cannot build an income building. That is deliberate gating — *income is the thing the Construction Co. unlocks* — but it means the licence must be funded from the parent game, and the shop card must say so in plain words or it reads as a bug.

**Manager mode:** the predicate walks `game.tiles`, which **is** the owner's city when a hired mayor is viewing it. Never route it through `OPS.st` / `opsRowsOf()`.

**The gate is a PLACEMENT check only.** In-flight builds continue if the Co. is demolished, damaged or unsited. Re-checking at completion would destroy a paid-for 24-hour build on an accidental demolish.

**No grace-builds counter, no `graceTimeMult`.** Designs 1 and 3 both used a free-first-12 allowance off `builtCount()`; it is a tutorial timer that expires and then the wall arrives with nothing bought in exchange, and Design 1's speed half was keyed on a different predicate than its gate half (§0.4).
**No rush mechanic.** Judge 1 is right that a rush fee is contractor spend and `sim.js`'s `levelUp` comment says such spend must land in `S.treasury` "so it stays inside the loop" — which needs a new faucet-side entry to keep `audit()` balanced. Out of scope; not in the ask.

---

## 7. THE READ SITES

**All of these gate on `bldSite(t)`. NONE gates on `bldBusy(t)`.**

### 7.1 Placement, upgrade, demolish, damage
| file:line | change |
|---|---|
| `index.html:17215` | **DO NOT exclude sites from the cap count.** Plus **fix the pre-existing race** (§0.9): a `_pendingType` multiset incremented beside `_placing.add(pk)` (`:17258`) and released in the same `finally`; the cap test becomes `count + (_pendingType.get(placeType)||0) >= (def.cap || CAP_PER_BUILDING)`. |
| `index.html:17254` | pop gate unchanged — pop is charged at placement |
| `index.html:17266` | tile literal gains `bld`; after `placeMeshAt`, `if (t.bld) applyBuildLook(t)` (mirrors `if (t.damaged) applyDamagedLook(t)` at `:21362`) |
| `index.html:18448-18463` | `if (bldBusy(t)) return;` at the top **and again after the `payCost` await**; on success write the `bld` record **instead of** `t.lvl++` / `dropTileMesh` / `buildMesh`. Keep the instant path verbatim when `durSec === 0`. `guardedAction`/`actionBusy` (`:18431`) already covers the await — **no third latch**. |
| `index.html:18464-18501` | **`k=0`** → cancel: refund **100%** of `rec.pc` + `rec.pr` (exactly what was paid; `Math.floor(x*1) === x`, zero drift). **`k=1`** → refund 100% of `rec.pc`/`rec.pr` for the undelivered upgrade **plus** the existing 50% of `costOf(t.type, t.lvl)` for the standing building. Demolish stays **enabled** on a site — Design 1's outright block bricks a mis-clicked 24 h upgrade for a day, and Judge 2 named it the only deliberately unrecoverable state in the set. Two refunds, both bounded by what was paid, neither mints. |
| `index.html:3556` | `damageTile`: `if (bldSite(t)) return false;` at the top of the **`else`** branch. ⚠ **Not at `:3545`** — that is before the `destroy` branch at `:3547` and would make sites indestructible (Judge 2's find). A site cannot be *damaged*; it *can* be *destroyed*, and destruction is a total loss with no refund, exactly as for a finished building. Log it explicitly so the player learns why the site vanished. |
| — | Because a site can never be damaged, `damagedTiles()` (`:16072`), `renderRepairs()` (`:16082`), `repairTile()` (`:16100`), `repairAll()` (`:16117`) need **no guard** — the pair is unreachable *by construction*. This closes the "pay to repair a hole in the ground" bug Judge 2 found in Design 3. |

### 7.2 Economy handoff — the single most important line
| file:line | change |
|---|---|
| **`index.html:16947`** | `if (t.damaged \|\| bldSite(t)) continue;` — **`bldSite`, never `bldBusy`.** §1's invariant. |
| `index.html:16700` | main producer/consumer/service loop: `if (t.damaged \|\| bldSite(t)) continue;` — the central output gate (gen/use/svc/LEGACY_SERVICE, `t.earn :16762`, `t.svcFed :16769`) |
| `index.html:16601-16604` | power pre-pass, **both legs**: no `gen.power` supply, no `def.powerNeed * t.lvl` demand |
| `index.html:16622-16636` | lot rent loop |
| `index.html:2808-2823` | `cityDemandScale()` staple-producer average |
| `index.html:16857-16878` | `ecoLogisticsCounts()` |
| `index.html:16978` | `ecoHost().hasBank` (guard only; the `'bank'` → `'op_bank'` fix is a separate commit — §0.10) |

### 7.3 City systems
| file:line | change |
|---|---|
| `index.html:16442` | `popCap()` — **EXCLUDE.** ⚠ No `damaged` test here today; this is a real edit. An unfinished Housing must not raise the ceiling the placement gate reads. |
| `index.html:16448` | `popUsed()` — **DO NOT exclude.** Charged at placement (`:17254`); releasing it would let a player queue past the cap and land over it. |
| `index.html:16453 / :16456` | `crewNeeded()` / `staffingRatio()` — EXCLUDE |
| `index.html:22592-22600` | `citJobSlots()` — **EXCLUDE.** ⚠ Its comment (`:22587-22591`) explains why it deliberately *includes* damaged tiles; construction is the opposite case and needs its own clause **plus a comment saying so**. Also re-check `CITIZENS_API.setJob` (`:22835-22841`). |
| `index.html:16463` | `garrisonCap()` — EXCLUDE (no `damaged` test today) |
| `index.html:17002-17009` | `raidTick` static defence — EXCLUDE |
| `index.html:18941-18948` | `staticDefense()` — EXCLUDE |
| `index.html:19812-19820` | `cardDefenseFromSockets()` — EXCLUDE; also hide the socket UI (`:18296-18345`) |
| `index.html:16404-16412` | `computeLinks()` **points** loop — EXCLUDE the points contribution; **keep** the site in the road-component walk so it still reads as connected. ⚠ No `damaged` test today. |
| `index.html:18970` | `computeCoverage()` — `dem.light = Object.keys(game.tiles).length` counts **every** tile; subtract sites, or placing a building instantly drags the Light vital before the building exists. ⚠ No `damaged` test today. |
| `index.html:18950-18957` | `builtCount()` — **EXCLUDE.** Feeds `tCiv`. A site is not civilisation. |
| `index.html:16496-16501` | `stockCap()` — EXCLUDE |
| `index.html:16523-16532` | `litKeys()` — EXCLUDE |
| `index.html:18932-18940` | `serviceMorale()` — EXCLUDE |
| `index.html:19565-19569` | `decorPoints()` — EXCLUDE (moot; decor is exempt) |
| `index.html:19671-19709` | `evaluateNeeds()` unconnected-building warning — EXCLUDE |
| `index.html:16044-16051` | `roadCapParts()` + the depot `some()` checks at `:16047, :17641, :17813, :19641, :19853` — EXCLUDE |
| `index.html:16468-16479` | `bonusesFor()` road/cluster/anchor neighbour scan — EXCLUDE |
| `index.html:19827-19840 / :19822-19825 / :19796-19804` | `lotValue()` / `obeliskBonus()` / `kalonCityBoost()` — EXCLUDE |
| `index.html:19852-19865` | `decayTick()` — **EXCLUDE.** No wear on a building that does not exist; a site can never self-decay into `damaged`. |
| `index.html:18592-18600` | `doorsAt()` — EXCLUDE |
| `index.html:18663-18677` | `desiredAgentCounts()`; also `agentEndpoints() :18607-18624` and the agent tick's re-validation `:18748, :18763-18767` |
| `index.html:19885-19911` | `caravanTick()` caravanpost — EXCLUDE |
| `index.html:19961-19975` | `refugeeTick()` gate — EXCLUDE |
| `index.html:2512-2521 / :2530-2539 / :2606-2630` | `finCount()` / `finBookCap()` / `finPositions()` — EXCLUDE. An unfinished Holding Company (24 h) must carry no book. |
| `index.html:21985-21997` | `opsSiteEffFor()` — return 1 for a site so `opsPushEff` pushes neutral. Documented limitation: the parent's accrual still starts at **siting**, not completion — the player paid 350,000 🔥 and making them wait has no design payoff. |
| `index.html:16831 / :20743 / :21355` | skip a site before calling `MythicHouse.tick` / `MythicStadium` |
| `index.html:20254-20261` | `rebuildSlot()` — must **re-apply `applyBuildLook`** to any site it rebuilds, or an admin re-skin visually completes every site while the timer runs on |

### 7.4 The asymmetry table (three-of-three independent agreement — the strongest signal in the comparison)
| | holds it? |
|---|---|
| per-type cap slot `:17215` | **YES** — else a `cap:1` gate/stadium/resthouse/railyard/obelisk/kalonstable can be started twice |
| `popUsed()` `:16448` | **YES** — charged by the placement gate |
| `popCap()` `:16442` | **NO** |
| `crewNeeded()` `:16453` | **NO** |
| `citJobSlots()` `:22592` | **NO** |

---

## 8. UI

- **Mesh.** A dedicated lightweight `buildSiteMesh` — foundation pad + a few frame posts, **one shared material**, no sprite (`:23921-23925` refuses canvas-textured sprites on a stated scene budget). `applyBuildLook(t)` swaps the mesh; **no `clearBuildLook`, no `userData._bcol`, and `userData._col` is never touched** — completion drops and rebuilds the mesh, so nothing needs restoring and `applyDamagedLook`'s stash (`:3566-3585`) cannot be contended. **No `rotation.z` / `rotation.x` tilt** — the tilt is `damaged`'s visual signature and a player must not read a site as a fire. Apply inside the existing chunked load loop (`:21360-21381`, `LOAD_MESH_CHUNK = 24`), **never as a second unyielded pass** over 5,482 meshes.
- **Status badge** `:18245-18253` — `UNDER CONSTRUCTION` / `UPGRADING` branch inserted **FIRST**, ahead of `DAMAGED`, or a half-built power-drawing building reads `BROWNOUT`.
- `:18287` — `if (!t.damaged)` → `if (!t.damaged && !bldSite(t))` (no entering, no card socketing, no stadium planning inside a site).
- `:18389` — upgrade button test gains `&& !bldBusy(t)`.
- **`#insbonus` (`:812`)** — the countdown + progress card. It is the deliberately preserved anchor **outside `#inspanes`** (which is rebuilt with `innerHTML`), and `opsAugmentInspect` (`:22058-22068`) already proves the create-once-by-id + `insertBefore(anchor.nextSibling)` pattern. Repaint on the 0.5 s HUD beat via `updateHUD()` (`:20661-20707`), not in 4-second jumps.
- **`tipHtml()` `:20307-20345`** — one construction line above the DAMAGED line using **`fmtCountdown` (`:16989`) verbatim** (a 24 h build reads `24:00:00` correctly). Hover ring `:20395` gains a third branch.
- **Shop card `:20499-20544`** — print `⏱ <fmtCountdown(durSec)>` next to the cost chips. **Before a single cinder is spent.** Where the gate blocks it, reuse `.opslock` / `.opslockico` (CSS already injected at `:21718-21771`) with "🔒 Needs a Construction Co. — <duration>", onclick → `toast()` + `opsCityHall()`. **Wrap `buildShopBody` / `openBuildShop` AFTER the ops wrappers** (post-`:21832`) so the lock composes with `opsDecorateShop` rather than fighting it.
- **`gcConfirm()` (async) anything over `confirmOverSec`**, naming the exact duration and the wall-clock time it lands. A 24-hour commitment discovered after `payCost` resolves is a support ticket.
- **Site Board** — a right-rail card `#bldcard`/`#bldlist`/`#bldcount` cloned from `renderRepairs()` (`:16082-16099`), showing every live job with its countdown and a Cancel button.
- **`window.__nc` `:24455-24539` — MANDATORY, not optional.** rAF never fires in the Browser pane (CLAUDE.md), so `animate()` and therefore the whole tick never run there; without these the feature is literally unverifiable.
  `__nc.build = { list(), slots(), speed(), profile(type,lvl,kind), timeFor(type,lvl,kind,speedMul), advance(ms), finish(key), cancel(key), sweep(nowMs), normalize(), hasCo() }`
  `finish(key)` moves the **stamp** (`t.bld.s -= t.bld.d*1000 + 1`), not the clock. `advance(ms)` shifts every `s` backward as a test clock.

---

## 9. "ADD THE BUILDINGS" — ECO_BUILDING_MAP COVERAGE

`ECO_BUILDING_MAP` (`:16899-16935`) covers 28 of 67 tile types and **zero operations** — including `op_construction`, the building this feature makes mandatory. Every id below was checked against `Recipes.producible` (`recipes.js:512-515`: 51 DEPOSITS + 8 BYPRODUCTS + ~200 RECIPES); an id that exists only in `chain.js` is silently dropped at `index.js:152` and the tile never becomes a firm.

**Add — 14 operations** (inside the existing registration loop at `:21489`, which already mutates `BUILDINGS`/`BUILD_ORDER`; `ECO_BUILDING_MAP` is a `const` binding but its value is mutable):
`op_mining` {ironOre,copperOre,coal,aluminumOre,nickelOre,zincOre / mine} · `op_oil` {crudeOil,naturalGas / oilfield} · `op_gas` {gasoline,diesel / transitCo} · **`op_construction`** {constructionComponents,prefabricatedComponents,concrete,brick / cementWorks} · `op_salvage` {recycledMetal,recycledPlastic,recycledElectronics / recycler} · `op_cars` {cars,trucks,vehicleParts / autoPlant} · `op_agri` {wheat,corn,vegetables,soybeans,potatoes / farm} · `op_fishing` {freshFish,seafood,shellfish / fishery} · `op_medical` {medicalSupplies,pharmaceuticals,surgicalSupplies / medDevice} · `op_research` {researchEquipment,researchChemicals,anomalySensors / scpFoundry} · `op_cardshop` {boosterPacks,starterDecks,collectorPacks / cardShop} · `op_dojo` {sportingGoods / venue} · `op_warehouse` {packagingMaterial,cardboard / distributor} · `op_smuggling` {anomalousMatter,arcaneCrystal,mythicResidue / anomalySite}

The deposit-backed ones are automatically ground-gated by `pickAvailable`/`Endow.canExtract`, so they degrade correctly on a node without the seam. **`op_construction` becoming a real firm is what makes "you need a Construction Company" economically legible rather than an arbitrary placement rule.**

**Add — 5 static tiles:** `warehouse` {packagingMaterial,cardboard / distributor} (strongest case: it already contributes freight at `:16871` but employs nobody) · `caravanpost` {packagingMaterial / distributor} · `motorpool` {maintenanceParts,tires / transitCo} · `reslab` {researchEquipment,researchChemicals / scpFoundry} · `resthouse` {householdGoods / hotel}.

**Deliberately NOT added, each for a written reason:** `op_bank` (fix `hasBank` instead — §0.10) · `stadium` (its header `:2287-2291`: "If a `gen` ever appears here, the stadium has become an idle earner and the entire design is dead") · `police` / `firestation` (municipal services, and a firm can hit the BANKRUPT rung — the map's own header `:16894-16897` forbids a player's wall going bankrupt) · `forge` / `indexfund` / `holdco` (the financial layer is modelled by `bank.js`; wiring them as firms double-counts the Cinder they already lift via `finBoost`/`finTick`) · road/wall/gate/tower/decor.

"Add the buildings" does **not** mean "add all the buildings."

---

## 10. VERIFICATION
```
$env:PATH = "$env:ProgramFiles\nodejs;" + $env:PATH; node tools/economy-tests/run.mjs
$env:PATH = "$env:ProgramFiles\nodejs;" + $env:PATH; node _synckcheck.mjs public/node-city/index.html
```
Bump together: `public/version.txt`, `window.BUILD_VERSION`, `sw.js CACHE_VERSION`, **and `window.NC_BUILD` (`node-city/index.html:12`)** — a cached `tuning.js` without the `construction` group silently switches the feature off in exactly the way the degrade path describes, and it will look like a bug in the degrade path rather than a stale cache.

---

## 11. LANDING ORDER
Timer state machine first (WP1–WP6). **Ops-as-firms (WP7) last, and the `hasBank` fix in its own commit after that.** Mixing them makes the firm-reap risk unreviewable — the one risk in this feature with no automated tripwire.

## OPEN RISKS THAT SURVIVE THIS SPEC
1. **Firm reap has no automatic detector.** WP7's firm-id-stability test is the only tripwire. Any future refactor that "simplifies" `bldSite` to `bldBusy` in `ecoBuildings` destroys firms silently with a green gauntlet. The comment there must say so.
2. **`municipal.maxSec` alone decides the feel.** At 2400 the split is clean (sawmill 30m43 and barracks 33m36 in, gasstation 1h53 out). Any retune must be re-checked against WP1's generated table, never adjusted by feel.
3. **Live saves are gated on their next expensive placement.** Intended, but it is a real behaviour change; `ECON.construction.on = 0` turns the whole feature off without touching a line of index.html.
4. `host.shock` (`ecoHost` never sets it; `sim.js:1015` reads it; `prices.js:235` consumes it) is a live, unused price-shock seam — the correct home for a construction boom raising material prices. Out of scope; recorded so nobody rediscovers it as a bug.