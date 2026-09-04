# Mythic Spellbook — session handoff (2026-09-04): the city outbreak engine

Paste this into a new session to pick up exactly where this one stopped.

**Branch:** `claude/game-viruses-cures-e0jrqc` (2 commits, pushed, local == remote)
**Commits:** `d219039` (the engine) · `be1f0a7` (version bump)
**Scope:** 1,227 insertions across 3 files. No SQL, no RLS, no migration, no new npm dependency.

---

## 0. STATE IN ONE LINE

Built, verified, committed and pushed. **Not deployed — nothing is live.** No PR is open.

| | |
|---|---|
| Code | ✅ shipped & pushed, working tree clean |
| Verification | ✅ headless maths + real-browser panel, zero page errors |
| Deploy | 🔴 **blocked** — see §7 |
| PR | ⚪ not opened |

---

## 1. WHAT WAS BUILT

Steps **10–13** of `smuggling-and-contamination.md` — the outbreak engine that two comments in
`public/node-city/index.html` said out loud were deliberately *not* built. Both of those comments
are corrected in the same commit rather than left to lie (§5).

Six viruses a player's city can catch, six cures synthesised at the **Research Facility**, and a
shipping seam that makes the **Medical Corp.** the only place a cure ever reaches a citizen.

### 🔴 The one rule that shaped every number

**A city never catches a virus at random.** Every virus fires on a condition already visible on the
Vital Signs panel, so an outbreak is the bill arriving for a number that was already red. A city with
green vitals is provably safe — measured pressure across all six viruses on a healthy city is exactly
`0.000`.

⚠ A flat random-chance model was built first and driven for ~40 city-days. It read as pure noise:
outbreaks landed on cities doing everything right and skipped cities that were visibly rotting.
**Do not reintroduce it.**

---

## 2. THE SIX VIRUSES

`r0` and `lethality` are per **city-minute** (`CITY_DAY_MIN = 20`, so ×20 = per day).

| Virus | Tier | Vector — what the player did | Effect on NPCs | r0 | Lethality | Cure |
|---|---|---|---|---|---|---|
| 🫁 Ashlung Fever | 1 | Health coverage < 70% with 4+ heavy ops | Labour ×0.88. The teacher — cannot kill a city. | 0.035 | 0.0011 | Ashlung Antiserum |
| 🔴 Cinder Pox | 1 | Housing > 90% of cap **and** Remedies < 8 | Labour ×0.82, morale −0.34. Fastest spread, barely lethal. | 0.090 | 0.0006 | Pox Wash |
| 🟤 Ferric Rot | 2 | Water coverage < 65% | Labour ×0.80 **and water demand +35%** — feeds its own vector. | 0.055 | 0.0024 | Ferric Chelate |
| 🟣 Violet Wither | 3 | Sited Anomaly Lab held under **55% containment** | Labour ×0.70, health −0.62. Highest lethality. | 0.048 | 0.0060 | Violet Lysate |
| 😴 Hollow Sleep | 2 | Hope < 30 while handling Memory Shards | **Labour ×0.55** — economic catastrophe, almost no deaths. | 0.042 | 0.0004 | Waking Serum |
| ☠️ Grey Marrow | 3 | Food < 55% **on top of an existing outbreak** | Labour ×0.62, health −0.70. Cannot start a crisis, only end one. | 0.038 | 0.0085 | Marrow Graft |

### 🟣 Violet Wither is what the Containment Lab dial was always for

Section 8 of node-city promised containment *"is not allowed to be a number with no consequence"* and
could only offer two consequences, both local to the facility. This is the third. Measured pressure:

| Containment | tier 1 | tier 3 | tier 5 |
|---|---|---|---|
| ≥ 55% | 0.00 | 0.00 | 0.00 |
| 40% | 0.16 | 0.24 | 0.31 |
| 10% | 0.48 | 0.71 | 0.94 |

⚠ It hangs off **sustained** low containment, **never off a containment incident.** Incidents are
already random, so triggering a plague from one would make the plague random too. Overdrive is a
switch and a lapsed investment is a supply decision — both are things the player *did*. Keep it
that way.

---

## 3. THE SIX CURES

| Cure | Cures | Cost (city stock) | Time | Doses |
|---|---|---|---|---|
| 💉 Ashlung Antiserum | Ashlung Fever | 6 reagents · 4 remedies | 8 min | 40 |
| 🧴 Pox Wash | Cinder Pox | 4 reagents · 6 remedies · 4 goods | 6 min | 60 |
| ⚗️ Ferric Chelate | Ferric Rot | 10 reagents · 5 remedies · 3 components | 11 min | 45 |
| 🟪 Violet Lysate | Violet Wither | 18 reagents · 10 remedies · 6 components · **2 🧠** | 18 min | 35 |
| ☕ Waking Serum | Hollow Sleep | 9 reagents · 6 remedies · 5 goods | 13 min | 50 |
| 🦴 Marrow Graft | Grey Marrow | 20 reagents · 14 remedies · 8 components · 10 rations · **3 🧠** | 22 min | 30 |

🧠 = Memory Shards, from the **game ledger** (not city stock) via `MythicCityBridge.spendRes` —
which is why `startResearch` is `async`.

### The pipeline — and the gate that is the whole point

```
🔬 Research Facility  ──►  📦 Lab vault  ──►  🚚 SHIP  ──►  💊 Medical Corp.
   synthesises              INERT.            requires a      6 doses/min
   charged on START         cures nobody      sited clinic    per clinic
```

A player with a full lab and **no Medical Corp.** has a freezer of vials and a dying city. That is
not an oversight to smooth over later — it is what makes the Medical Corp. worth its 450,000 🔥
instead of being a Health-coverage trinket. With no clinic the Ship button is `disabled` and
`shipDoses()` returns `{ok:false, error:'no-clinic'}`.

---

## 4. DECISIONS THAT WILL LOOK WRONG IF YOU DON'T KNOW WHY

Each was the *second* attempt. The first is in the file comments with the measurement that killed it.

### 🔴 The model is SIR, and the R is not decoration

The first version was a plain logistic with cured citizens returned to the general population.
Driven end-to-end on a 200-pop city, a full Ferric Chelate batch researched and shipped on the
fastest possible schedule left the city at **21.4% infected against the 14.9%** it had when research
started. Every dose worked and the epidemic still won, because the clinic was refilling the pool it
was draining. A player doing everything right would have watched the bar dip and climb back,
concluded the cure was broken, and been right.

**Do not remove the `imm` term.** Tracking the recovered as immune fixes it at the model level
rather than by inflating dose counts until the numbers happen to work.

- **Cost is charged on START, never refunded.** Charge-on-completion let a player queue a batch they
  couldn't afford, watch a 15-minute timer, and get nothing at 0:00. A batch that started always
  finishes. Cancelling is therefore destructive and `gcConfirm()`s.
- **Labour stacks multiplicatively.** Additive stacking hits zero at three concurrent outbreaks, and
  a city with zero labour can never research its way out — an unwinnable state reachable by ordinary play.
- **Grey Marrow is exempt from `PLAGUE_MAX_ACTIVE`.** Capping the opportunist out would mean the
  worst virus in the catalog can only land on a city that isn't yet in trouble — backwards.
- **Sickness multiplies `labour`,** not a fourth leg beside it, so it reaches both `resources` and
  `cinder` and inherits the `OUT_FLOOR` clamps. Deliberately **not** scaled by `severity`: a virus
  in a village of twelve is *more* of a labour event, not less.
- **The state rides the city save.** An epidemic that reset on reload would make F5 a cure — the
  same failure the coverage layer's `ramp` field exists to prevent.
- **The lab accessor never calls `opsLab()`.** That function caches into `OPS.live` as a side
  effect and would fight `opsLabTick` over which lab is live. It reads `row.lab` raw instead.

---

## 5. WHERE EVERYTHING LIVES

| Path | What |
|---|---|
| `public/src/city/plague.data.js` | **419 lines.** Catalog + pure maths. Imports nothing, touches no DOM — drivable in isolation. |
| `public/src/city/plague.city.js` | **659 lines.** State machine, city wiring, panel. Exports `mount(ctx)`. |
| `node-city` → `boot()` | Mounted after the Stadium via a ctx hand-over. **Fifth module to hit the globals trap.** |
| `node-city` → `economyTick` | `PLAGUE.tick(dtMin)` on the same dtMin, so offline catch-up slices an epidemic at the resolution it slices production. |
| `node-city` → `cityOutputMultipliers` | One line: `labour *= PLAGUE.outputMul()`. |
| `node-city` → `saveState`/`loadState` | A `plague` slice. Absent on load ⇒ healthy city. |
| `window.MythicPlague` | Diagnostics: `_seed(id)`, `_step(mins)`, `_state()`, `_snapshot()`. |

**Comments corrected in this commit** (they claimed the engine was not built): node-city §12b
(`WHAT THIS IS NOT`) and §8 (`WHAT CONTAINMENT ACTUALLY COSTS YOU`).

### 🔴 The globals trap (CLAUDE.md)

`game`, `vitals`, `wellbeing`, `cityPop`, `popCap`, `stockOf`, `opsLab` are top-level `const` in
node-city's module script and are **invisible to an ES module**. The ctx object passed to `mount()`
IS the hand-over. If the module needs something new from the city, **add it to the ctx** — never
reach for a bare global, and never assume `window.Foo` exists.

Note what is *not* handed over: no raw write access to `game.stock`. The module gets
`spendStock`/`addStock` — a pair with an inverse — because a cure batch has to be able to fail and
leave the city's books where it found them.

### Tuning constants (all in the two module files)

```
PLAGUE_SEED_FRAC       0.02     PLAGUE_CLEAR_FRAC      0.012
PLAGUE_GRACE_CITY_MIN  90       PLAGUE_RECATCH_CD_MIN  240
PLAGUE_MAX_ACTIVE      2        DOSES_PER_CLINIC_MIN   6
QUARANTINE_R_MUL       0.45     QUARANTINE_LABOUR      0.80
CATCH_CHECK_MIN        5        CATCH_ROLL             0.28
```

---

## 6. WHAT WAS ACTUALLY VERIFIED

- **Vector isolation** — pressure exactly `0.000` across all six viruses on a healthy city.
  Grey Marrow reads `0.00` on famine alone, `0.45` with an outbreak already running.
- **Full loop at real city scale** (pop 30–120): catch → spread → research → ship → administer
  clears an outbreak on one batch.
- **The gate** — no Medical Corp.: warning box renders, Ship button `disabled`, programmatic call
  still refused, 45 doses sat inert in the vault.
- **Throughput scales** — two clinics reported `administering 12 doses/min`.
- **Save/load round-trips**, including a legacy save with no `plague` key.
- **Stability** — 3,000 city-minutes (150 days) in the worst city constructible: no NaN, no
  out-of-range fraction, `outputMul` floored at 0.436, so a city can never deadlock.
- **Real browser** — panel opened by click in Chromium (playwright-core + the pre-installed
  `/opt/pw-browsers/chromium-1194`), buttons toggled real state, **zero page errors**.
- **Syntax** — all node-city script blocks parse, `sw.js` parses, `index.html` passes `_synckcheck.mjs`.

### ⚠ NOT verified

The panel was driven through a **mock ctx**, not a booted node-city — this container's network
policy blocks the CDN that serves THREE, so the full city never rendered. The wiring is
cross-checked statically (every `C.*` accessor the module calls is supplied by the mount), but
**the first real boot is still worth watching.**

---

## 7. 🔴 FINISHING THE DEPLOY (the only thing left)

All knobs are bumped and committed (`be1f0a7`). **Nothing has reached production.**

| Knob | Value |
|---|---|
| `public/version.txt` | `v120w7` |
| `window.BUILD_VERSION` | `v120w7` |
| `sw.js` `CACHE_VERSION` | `mythic-v120w7-outbreak` |
| `NC_BUILD` (node-city) | `v120w7-city` |

`NC_BUILD` is a **fourth** knob and it matters: node-city passes it as the cache-buster on every
dynamic module import, so without it the new module loads under the stale `?v=v120i2-city`. It is
also the deploy probe.

**Steps:**

1. `npm run deploy` **from an authenticated machine.** Wrangler is not logged in in the container —
   `wrangler whoami` reports *"You are not authenticated."*
2. **Verify the EDGE with curl, never the deploy log.** The container's network policy returns
   `HTTP 000` for `https://playmythicspellbook.play-a3d.workers.dev`, so the edge could not be
   checked from the session at all.
3. **Poll for a couple of minutes** — PoP propagation is not instant. Check `/version.txt` for
   `v120w7`, then grep `NC_BUILD` on the served `node-city/index.html` to prove the edge took it.
4. Before `git add public/index.html`, confirm `head -c 12 public/index.html` is `<!DOCTYPE` and
   **not** `<!--MIN-->` — the deploy minifies in place and restores after. (Carried over from the
   2026-08-01 handoff; still applies.)

⚠ `chain.js?v=v120w6chain2` in node-city was **left alone deliberately** — that is the
resource-chain module's own per-file cache-buster, not one of the deploy knobs, and `chain.js` did
not change on this branch. Bumping it would evict a cache entry that is still correct.

---

## 8. IF YOU EXTEND IT

- **Adding a virus** = one entry in `PLAGUE_VIRUSES` + one in `PLAGUE_CURES`. A virus *removed*
  from the catalog vanishes safely from old saves — `load()` skips unknown ids.
- **Never reach for a bare global** — add it to the ctx hand-over (§5).
- **No SQL / RLS / migration.** The epidemic lives entirely in the existing city save blob;
  nothing new touches Supabase.
- **Not done, and deliberately so:** district-level spread, cross-player contagion, and world
  events. The engine is per-city by design.
- **No PR is open.** Two commits sit on `claude/game-viruses-cures-e0jrqc` awaiting review.

---

*Also published as a page: https://claude.ai/code/artifact/bf1e9672-247b-4ada-83f5-c96828c738ab*
