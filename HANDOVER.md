# Node City — handover

**Branch:** `claude/city-builder-visual-upgrade-g9deb4` — pushed and level with origin.

⚠ **This clone is shallow** (`.git/shallow`; the root is an artificial graft), so no commit
count here is trustworthy and neither is any `origin/main...HEAD` diff. 232 commits are
visible, 194 on first-parent. Fetch the full history before you judge what this branch
contains.
Supersedes `HANDOFF-CITY-2026-08-18.md`, which predates most of what is here and
should be read only for its round 0–9 visual history.

---

## 1. Read these four things before touching anything

| File | Why |
|---|---|
| `CLAUDE.md` | The non-negotiables. The globals trap is the one that has cost real time repeatedly. |
| `ECONOMY.md` | Cinder is never minted. Four historical leaks are documented; one **destroyed** Cinder rather than minting it. |
| `ECONOMY_HANDOFF.md` | **The deploy procedure**, the `NC_BUILD` rule, the `sql/038` apply step with its expected verify output, and the warning that `deploy.mjs` minifies `public/index.html` **in place** — commit before deploying or `git checkout --` is your only recovery from a 9 MB tree. |
| `.gauntlet/README.md` | Six things that each cost an agent a full debugging round. Item 6 is a measurement contract — read it before you A/B anything on screen. |
| The six `FIX-RECORD.md` files | `demographics`, `districts`, `wild`, `parcel`, `lifepath`, `landvalue`. Each says where work **actually** landed when a commit subject misfiled it. ⚠ `.gauntlet/README.md` records that the **parcel** one is wrong about the landvalue one. |

## 2. Three gates, and you need all three

```bash
node _synckcheck.mjs public/index.html public/node-city/index.html
node .gauntlet/modcheck.mjs         # 172 .js/.mjs FILES under public/src today
node .gauntlet/precommit-scan.mjs   # refuses a line marked deliberately broken
node tools/economy-tests/run.mjs    # 663 assertions; the audit is the point
```

🔴 **`_synckcheck.mjs` must be given its files.** With no arguments it checks
`public/index.html` **and nothing else** — and essentially all of this branch's work is in
`public/node-city/index.html`, which a bare invocation never opens. Its own header warns
about this. There are 13 `index.html` files under `public/`.

⚠ **172 is a FILE count, not a module count** (33 feature directories — see §3). The two
numbers count different things.

⚠ **`precommit-scan.mjs` passes vacuously on a clean tree.** It scans `git diff HEAD`, so on
committed code it examines nothing and exits 0. It is a pre-commit hook, not a state check.

The first two answer *"does this parse"*. The third answers *"did anyone mean this"* —
it exists because a checkpoint once shipped a build where a fix was **disabled while
appearing present**, and both syntax gates passed, because the injected line was valid
JavaScript.

The economy suite can be made to fail on purpose — `ECON_TEST_SABOTAGE=seed-mint`
returns a red round. A suite that cannot be made to fail is not a gate.

## 3. What is on the branch

**33** feature directories under `public/src/`. Most register a `window.Mythic*` global and
every one is guarded so a 404 costs that feature and nothing else — but **`battle` and
`sprites` have no `Mythic*` global at all** (`battle` sets `window.DrawFX`), and five others
(`crowd parcel parking sprites streets wild`) are assigned by the host from `mount()`'s
return rather than self-assigning.

**Zoning stack**, four layers meeting at one function (`/src/zoning`'s `typeFor()`, the
single point where "what goes on this plot" is decided):

| Layer | Module | What it decides |
|---|---|---|
| 1 | `zoning` | Land use — **13** zone ids (6 residential incl. `r_asbuilt`, 2 commercial, 2 office, 2 industrial), fill/marquee/paint, right-click de-zone |
| 2 | `districts` | Specialisation — 13 district types incl. the 🃏 Mythic card districts |
| — | `landvalue` | Which of that set *this ground* will take — five bands |
| 3 | `tenants` | **Which company** wins the lot, by auction rather than by hash |

**City systems:** `demographics` `power` `water` `pollution` `outside` `transit` `streets`
`progression` `budget` `naming` `palette` `dossier` `citizen` `lifepath` `broadcast`
`economy` `city` `trading` `nodes` `resources` `community` `resonance` `hud`

⚠ **`battle` and `sprites` are NOT city systems** and are not imported by
`public/node-city/index.html` at all — they belong to `public/index.html` and
`public/battle-board/`. CLAUDE.md tells you not to touch battle code; do not let their
presence under `public/src` suggest otherwise.

**Rendering:** `wild` (ground scatter) `parcel` (the plot under non-housing, plus the
foundation plinth) `crowd` (standing figures) `parking`

**Landed after the first draft of this document:** an **Office Block** (`office`) — the
game had ~53% office demand and no office building, so zoning office gave you a research
spire; wired across 16 sites, with `ECO_BUILDING_MAP` a *deliberate* non-site because no
tile in this city makes paper, plastic or printing ink. A **`foundedDay` stamp on firms**,
which dissolved the demolish-and-rebuild workforce demotion. Fog, road-paint and
parcel-coverage fixes (below).

## 4. 🔴 The save layer — read before wiring the cloud

Modules do **not** edit node-city's `serialize()` literal. They register a slice on a
shelf, and `serialize()` collects them into `payload.ext` with a manifest in
`payload.meta`:

```js
window.MythicCitySave.register('<key>', { save: () => ({…}), load: (p) => {…} })
```

Registered today — **seven** keys: `progress` `zoning` `names` `districts` `tenants`
`lifepath` `broadcast`.

**Registering late is safe and is the documented behaviour** — the shelf stashes the
payload and replays it to whoever registers next (`naming/save.js`).

### 🔴 SIX modules bypass the shelf and own a TOP-LEVEL field in `serialize()`

This is the half a cloud-sync integration gets wrong, because these are not in
`payload.ext` and a manifest walk will not find them. **Every one has a load-bearing
fallback whose job is to stop a boot where the module 404s from erasing the player's data:**

| field | module | erase guard | index.html |
|---|---|---|---|
| `power` | MythicPower | `_pendingPower` | :30348 |
| `streets` | MythicStreets | `game._streets` | :30420 |
| `transit` | MythicTransit | `game._transitRaw` | :30435 |
| `paint` | MythicPalette | `_paintDisk` | :30444 |
| `economy` | MythicEconomy | `_lastEconomyBlob` | :30496 |
| `demog` | MythicDemographics | `_lastDemogBlob` | :30513 |

⚠ **`streets` is NOT on the shelf** despite what its module header may suggest, and
**`palette` does not ride the tile record.** Palette's one-letter keys (`w r m h hp ty`)
are fields inside *its own* per-tile record within the `paint` blob, not keys on
node-city's tile.

### No save field at all, by design

`landvalue` `wild` `parcel` `crowd` `citizen` `budget` — every fact they show is derived
from state already persisted.

### Two rules a new slice must follow

An **unknown key from a newer build is kept, never stripped** (an older build must not
silently empty a save it does not understand — implemented at `districts/store.js` and
`tenants/store.js`), and **hostile input is dropped** rather than carried: a key that is not
`"x,z"` becomes a lookup that never matches, and a district you can see in the count and
never on the map.

## 5. 🚀 Nothing here has been deployed — and there are FOUR knobs, not three

```
public/version.txt                    v120w9
window.BUILD_VERSION                  v120w9
public/sw.js       CACHE_VERSION      mythic-v120w9-battlefield-and-city
public/node-city/index.html NC_BUILD  v120w9-districts     ← ALSO STALE
```

🔴 **`NC_BUILD` is the one that will bite you.** It is the cache-buster on **31 dynamic
module imports** (`import('../src/zoning/index.js?v=' + window.NC_BUILD)` and thirty more).
**Deploy this branch without bumping it and every returning player fetches the cached OLD
modules — all 33 of them ship dark**, logging "not mounted (non-fatal)", which is
indistinguishable from the modules being absent. Its current value still says `districts`,
which was many modules ago. `ECONOMY_HANDOFF.md` states the rule: *"a missed bump ships
invisibly."*

Verify the **edge** with `curl` (grep `NC_BUILD` on the served page — it is a deploy probe,
not decoration), never the deploy log, and poll: propagation takes a couple of minutes.

⚠ **`deploy.mjs` minifies `public/index.html` IN PLACE.** Commit before deploying, or
`git checkout -- public/index.html` is your only recovery from a 9 MB minified tree.

### SQL — `sql/038_city_economy_trade.sql` has NOT been applied

`ECONOMY.md` and `ECONOMY_HANDOFF.md` both record it as written, idempotent, RLS-complete
and **not applied**. Until it is, `/src/economy/trade.js` runs against simulated partners.

Migrations are applied **by hand** in the Supabase SQL editor for project
`ktsiasyjusesawtrwrjc`. Each file is idempotent, ends with a verify query, and ships its RLS
in the same file. **RLS is the entire security boundary — review every policy line by
line.** A missing `using (auth.uid() = …)` is a data breach and looks fine in review.

⚠ `git log -- sql/` shows three recent files (`036`, `037`, `038`). Only `038` belongs to
this work; `036` and `037` are unrelated and predate it.

## 6. Known open, honestly

**Named and unfixed:**
- ~~`/src/parcel` is starved by `HAS_OWN_GROUND`.~~ **FIXED, and the diagnosis was
  backwards.** Measured by rasterising each tile's own mesh: every non-housing type that
  places already paves 87.9–100% of its tile, and five were *missing* from the list — so
  the layer was laying a **second full-tile pad over five recipes' own aprons** and a green
  lawn quadrant over the Med Lab's plaza. `own` is now measured, not listed; the list
  survives only as a floor that can suppress and never add. Flat triangles 160 → 0, meshes
  2 → 1.
- ~~Demolish-and-rebuild demotes a whole workforce.~~ **FIXED** — firms carry a
  `foundedDay`. Tenure through a rebuild now holds (grade 5 → 5, where it was 5 → 1).
  ⚠ Still open underneath it: **a per-citizen hire date**. Firm age is a real ceiling but
  not a hire date; the honest version needs a stamp per (citizen, employer) pair in the
  **roster's** save slice, which `/src/lifepath` is deliberately read-only over.
- The Job level row's *"of 3"* still reads as a reading when it is an analogy.
- The charter fund still exhausts on a 220-firm board. The fix added the missing
  investment arrow; on that board **the richest firm holds 10.65 days of its own operating
  cost against a 12-day founding buffer** — the city is thin, not hoarding. **The cap was
  deliberately not raised**; that is the tuned-number move.
- Rent → failure → land value falls is **open, not closed**: no land-value term reads firm
  health, and a bankrupt firm leaves its building standing.
- The geology→water link is unverified.
- ⚠ *Not* a defect, though it has been filed as one: road condition **does** accumulate,
  from counted vehicle passes — it is just imperceptible on a young street.
  `/src/streets` documents this and ships `wearRate` specifically to separate "is worn"
  from "is wearing".

**Visual — fog and road paint fixed since the last score.** Fog was arithmetic: the aerial
camera sits 18.6 units from the centre of an 18-unit district whose far corner is 30.18
units out, and `fog.far` was 30 — it was dissolving the city, not fading distance. Road
paint stood proud because **a paint slab was a box and a box has walls**; it is a quad now,
with speckle *below* baseline and every marking 24 verts → 4.
🔴 **Small-object shadows were swept and deliberately REFUSED.** Signal-minus-control goes
0.25 → 0.69 across the sweep, monotone in texel density, and it takes a 6-unit frustum to
double — a second cascade, which three r171 has no support for. The existing 58-px penumbra
and 2.0× key/fill ratio are not worth trading for a 0.031-unit mast. The sweep and the shape
of a cheaper fix (contact patches at each prop's foot) are recorded at `sun.shadow.radius`.

**Mean 6.92 across 12 dimensions at round 19** (was 6.46 at round 13), weather-matched and
pixel-aligned between rounds. Biggest moves: building surface detail 6.5 → **8.0** (the
window skin — the largest single visual return in the project), density and zoning read
6.5 → **7.5** (the office block), silhouette and roads both to 8.0.

~~The biggest remaining gap: nothing below building scale casts a shadow.~~ **FIXED** —
`/src/contact`, the 34th module. A contact **decal** rather than a shadow-map entry, so
round 18's refusal never applied. **`MultiplyBlending`, not a colour**: white changes
nothing and 0.62 removes 38% of whatever was already there, which makes night correct for
free, darkens the existing grain instead of covering it, and lets one mesh serve props on
stone, cars on bay paint and agents on road wear. **Two meshes and +2 draw calls for the
whole city** (against `/src/crowd`'s +24 for 78 figures), +2.1% triangles. Measured notch
25–37 units at ratio 0.63 against a designed 0.62, with byte-identical control pixels in
the same frame.
⚠ Deliberately capped: a lamp mast gets occlusion at its foot, not a hairline shadow —
round 18's trade, kept. On empty ground the change is nil by construction.

**The stranger test is still "instantly", and the tell has moved off the materials.** It is
now composition: **41.6% of the aerial viewport is undeveloped green**, and the built area is
a hard-edged rectangle with nothing beyond it, where every CS2 aerial runs off all four frame
edges. No amount of material work touches that. Second is that everything small floats. Third
— correcting an earlier round — is not that the glass reflects only the sky, but that **every
pane in the city carries the identical head-first profile** regardless of which way it faces,
so two office blocks three metres apart have indistinguishable facing glass. ⚠ That score PREDATES the
environment map, the interior glass content and the arena (rounds 14–16), which are
unscored: `rounds.json` carries `meanScore: null` for round 14. The next round's first job
is to re-score. the glass reflects the sky and now
has interior content, but nothing casts *into* it, so a street canyon reads as if it had no
other side. Fog dissolves the far third of the aerial. No lamp, sign or bollard casts a
visible shadow — a mast is ~3 shadow-map texels. Road paint stands proud. The arena reads
civic rather than duel, and is tower-proportioned on a one-tile footprint.

**Not built from the zoning brief:** Layer 4 ownership and player-owned parcels · district
policies (taxes/subsidies/regulations) · government policy system · faction territories ·
Mythic tournament economy · Signature Buildings · city achievements unlocking cards ·
**cards affecting the city** (a bridge change, deliberately deferred).

## 7. The harness, and why its history matters

`.gauntlet/capture.mjs` boots the real page in headless Chromium, builds a district through
the **shipped placement path**, and photographs it in five framings.

🔴 **It was building the wrong district for most of this project's life.** `retail`, `shop`,
`arena`, `medlab`, `tenantbiz`, the trees, bushes, gardens and the fountain were **all
refused**, for four separate reasons — the research tree, the municipal build ceiling, a
scene line naming a *mesh* rather than a building, and headless Chromium auto-dismissing
`window.confirm` on any order over an hour. Rounds 0–12 were judged on a warehouse estate
with no commercial building in it, so **every "can you tell commercial from industrial from
the air" judgement before round 13 is void.**

🔴 **`capture.mjs` pins the hour but NOT the weather.** One run photographed the aerial in
CLEAR and the frontage, thirty seconds later, in STORM — carriageway warm brown to
blue-grey. Any cross-run colour comparison must check the badge. Same class as the
clock-pinning bug that cost two earlier rounds.

🔴 **Cross-boot per-framing PERCENTAGES are retired.** Two boots with nothing changed read
**14.7–15.9 pp** on the aerial against a real signal of **2.45 pp** — the null control is
six times the signal.

✅ **The RATIO between framings survives, and the gate was kept for it.** The drift is
common-mode, so it cannot manufacture a *spread*: `.gauntlet/README.md`'s conclusion is that
any round whose framings differed by less than about **2×** proved nothing, and
`capture.mjs` flags a framing at **max × 0.25 (4×)**. Do not raise that threshold — you
would throw away the signal the gate exists to catch.

`.gauntlet/layer-ab.mjs` is the instrument for "how much did my change do": one boot, layer
toggled, `render()` then `drawImage` **in the same task** — it asserts its own do-nothing
control is exactly **0.000%** and fails the run otherwise.

## 8. The rule that governs everything here

**Never ship a number with no model behind it, and never ship a rule nobody enforces.**

Two panels have had content torn out for the first; four gates have been closed for the
second. The pattern that keeps recurring is one seam that knows the rules and another that
writes the store — it has now been found twice — `districts` via `store.load()` and `tenants` via `award()`,
both of them a write path the gate did not stand in front of — and will be found again.
⚠ A near neighbour worth knowing separately: `landvalue`'s vitals chip had the same
predicate written out in **two** places and they disagreed. That is a duplicated read-side
rule, not an unguarded write, and it is caught by different reading.

When a panel cannot honestly show something, it says so. The citizen dossier marks a row
`UNAVAIL` with the reason; the budget names two lines the ledger does not record **at all** (a separate case from
the five tax figures it genuinely cannot separate, which are collapsed into one counter); the
card-value seam returns `null` **and not zero**, because zero is a number and this is an
absence.

---

## 9. What this document does NOT know

This was written from one session's memory and then fact-checked against the tree; that
check found **eleven wrong claims**, including a deploy step whose omission would have
shipped all 33 modules dark. The following are still unverified, and are marked rather than
asserted:

- **`layer-ab.mjs`'s zero control** is asserted by construction (the script fails any run
  whose control is non-zero) and recorded in the README. It was not re-measured for this
  document.
- **The 10.65-day figure** for the richest firm on the churn board is a board-specific
  measurement that was not reproduced independently.
- **Which migrations belong to this branch** cannot be proven from a shallow clone.
- **Round 14–16's visual work is unscored.** The 6.46 mean is round 13's.

If a number in this document matters to a decision you are about to make, **re-derive it.**
That is the rule the whole project runs on, and it applies to its own handover.
