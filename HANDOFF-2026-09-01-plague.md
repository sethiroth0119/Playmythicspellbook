# 🦠 HANDOFF — Plague, Cures, the Hazmat Lab and the Ward

**Branch:** `claude/hazmat-station-minigame-0dbwd6`
**PR:** [#4](https://github.com/sethiroth0119/Playmythicspellbook/pull/4) — **open, mergeable, NOT merged**
**Size:** 13 commits · 34 files · +11,458 / −3
**Version knobs:** `v120x6` (version.txt, `BUILD_VERSION`, `sw.js CACHE_VERSION` — all three moved together)

---

## ⛔ READ THIS FIRST — three things block a clean merge

### 1. `transport` already exists in production

This is the real blocker and it is a **decision, not a bug**.

The PR adds a `transport` row to `OPS_ECON`. But `op_type='transport'` already has **5 live rows** in
`corp_operations`, created 28–30 August:

```
Hidn Studios · ANOMALY · Omnione · Clarey Nexus · River Meadows Corp
```

Behind them is a complete, separately-maintained transport system — **34 Postgres RPCs**, all
`SECURITY DEFINER`, `transport_config.enabled = true`:

```
transport_companies  transport_rigs     transport_contracts  transport_ledger
transport_config     transport_keys     haul_requests        haul_requests_history
node_depots          depot_earnings     van_liveries
```

Its client is **not in this repository** — `git log --all -S'transport_dispatch'` returns nothing, on
any branch, ever. It lives in another codebase talking to the same Supabase project. The SQL comments
reference `public/src/transport/contracts.js`, which is that project's tree, not this one.

**What merging as-is would do:** `_opEcon('transport')` currently returns `null` for those five
operations, so they earn nothing. This PR gives them a live econ row — retroactively switching on
income, salaries and a 0.9/hr fuel input for five businesses players bought under different terms. It
would also list Transportation Company at 320,000 Cinder in Found a Business alongside whatever the
existing system charges. Nothing is corrupted; it is an economy change to other people's businesses
as a *side effect*.

**Also worth knowing:** `weaponsmith`, `bus`, `restaurant` and `rail` are likewise live `op_type`
values absent from `OPS_ECON`. Other features create operation rows that table does not know about,
so this is a pattern rather than a one-off.

**Three ways out:**

| Option | What it means | Cost |
|---|---|---|
| **Reuse** (most correct) | Point `logistics.js` at `transport_dispatch` / `haul_post` instead of `corp_operations`, drop the `OPS_ECON` row | Most work. Creates a cross-project dependency: if that codebase changes an RPC signature, the cure chain breaks and nothing here catches it. Pin it with a smoke test that calls `transport_quote` and fails loudly if the shape moves. |
| **Rename** (cheapest) | Call mine `coldhaul`; leave the existing system untouched | Two haulage concepts in the game. Honest, but duplicated. |
| **Adopt** (not recommended) | Keep the row, treat switching those five on as an intended buff | Bad if that system is live, which it appears to be. |

The integration seam for **Reuse** is unusually good:
`transport_dispatch(carrier, rig, from, to, hops, units, **cargo jsonb**, escort, **client_ref**)` —
a cure batch *is* cargo (2000-byte limit; the manifest fits), and `client_ref` gives idempotent retry
for free. `risk_pct` already models what `logistics.js` calls cold-chain integrity, server-side and
un-spoofable.

### 2. `sql/038_plague_cures_logistics.sql` needs applying by hand

Supabase SQL editor, project `ktsiasyjusesawtrwrjc`. Idempotent, re-runnable, RLS in the same file,
verify query at the end.

Until applied the feature degrades to solo play — you ship to your own operations, deliberately
indistinguishable from nobody being online.

Three objects: `cure_shipments` (waybills), `cure_payouts` (append-only, with a trigger permitting
only the `claimed` flag to change), `plague_carriers` (a `security_invoker` view over
`corp_operations`, not a second copy). Reads scoped to the three parties with a legitimate interest —
shipper, haulier, receiving lab — via a `SECURITY DEFINER` helper, which is also what stops the
policies recursing.

### 3. Merging deploys straight to production

`.github/workflows/deploy.yml` pushes `./public` to Cloudflare on **every push to `main`**, and there
is **no CI on pull requests**. The local gate is the only gate:

```bash
npm i                                                              # terser, for the gate below
node _synckcheck.mjs public/index.html public/node-city/index.html # → ALL CLEAN
node _plague_smoke.mjs                                             # → 72 checks, ALL PASSED
```

Both were green at `5f28ddf`.

---

## 🔒 Unrelated security finding — surfaced while working, NOT touched

Supabase reports **8 tables with RLS disabled**, fully readable *and writable* by anyone holding the
anon key (which ships in the client):

```
city_state_backup_20260825        city_profiles_backup_20260825
forge_cards_backup_shufflezones   city_state_rekey_backup_20260829
corp_merge_backup_20260829        grimalkin_prn_city_backup_20260829
prn_removed_backup_20260829       lids_vault_backup_20260830
```

Backups of player city state, a corp merge, and a vault. They predate this work and have nothing to
do with it.

**Deliberately left alone.** Enabling RLS with no policies blocks all access; dropping them is
destructive. They look like finished one-off migration backups, but that is an owner's call.

---

## What was built

### The loop

1. **A virus emerges.** `outbreak.js` reads the city's own vitals — health coverage, water, food,
   density — into one `pressure` number. A well-run city can reach **zero** and never see a wild
   outbreak. That is deliberate: a system with an unavoidable floor teaches players that building
   correctly does not pay.
2. **NPCs catch it.** Named citizens go incubating → symptomatic → critical → recovered → immune on
   an 8 / 20 / 30-minute clock, spreading along the workplace graph the city already models.
3. **You cure it in the 3D lab.** Sequence the strain, suit up at the airlock, spin, mix, assay,
   package.
4. **You can get it wrong.** An unstable or contaminated batch grades `IATROGENIC`; administering it
   spawns a **new strain** — the parent pushed along the axes your failed blend leaned on, so the
   player can see their own mistake in it.
5. **You ship it.** A cure in the lab has cured nobody. Hire a player-owned haulier to run it to a
   player-owned Medical Corporation.
6. **Somebody else decides whether it goes into people.** The crate stops at the ward door.

### File map

```
public/src/plague/          the domain. Pure except state.js.
  strains.js                4-axis signature, families, mutation, resistance
  outbreak.js               infection over named citizens; the three inherited rules
  outbreak.city.js          node-city adapter (mount(ctx) — the globals trap)
  cures.js                  reagent chemistry over the REAL 14 resources, grading
  logistics.js              carriers, cold chain, quotes, arrival, settlement
  state.js                  the ONLY file that spends, saves or touches Supabase
  index.js                  window.MythicPlague

public/src/biolab/          the 3D hazmat minigame.
  stations.js               floor plan as data; HOT_Z is the clean/hot line
  hazmat.js                 four seals, and the exposure that lands on the BATCH
  player.js                 walking, collision, WASD + virtual stick
  scene.js                  three.js r128, character load/swap, camera
  hud.js                    every pixel of the 2D layer + its CSS
  gltfloader.vendor.js      GLTFLoader r128, MIT, vendored (see "CSP" below)
  index.js                  window.MythicBioLab

public/src/ward/            the Medical Corporation. Far end of the pipe.
  triage.js                 patients, dose costs, coverage — the reservoir rule
  intake.js                 what is in the crate, and whether you open it
  hud.js                    the clinic screen (deliberately not the lab's)
  index.js                  window.MythicWard

public/models/lab/          researcher.glb (0.65 MB) · sentinel.glb (0.70 MB)
sql/038_plague_cures_logistics.sql
PLAGUE.md                   the design doc — read this next
_plague_smoke.mjs           72 headless checks over the domain layer
_glbpack.mjs / _glbcheck.mjs   GLB repacker + structural validator
_labshot.mjs                real-browser harness (see "Verifying")
```

### index.html's contribution — four things only

`window.MythicPlagueBridge`; the `transport` `OPS_ECON` row + `OP_LABELS` entry; three
`<script type="module">` tags; `medical` / `research` / `transport` interiors in `cityEnterBusiness`;
plus `_plagueSettle` on the mayor-stipend poll.

`node-city/index.html` gets the outbreak mount (alongside the House and Stadium) and **one wrapper on
`cityOutputMultipliers`** that applies the outbreak's health drag.

---

## Design invariants — do not break these

- **No citizen is ever removed.** The named roster is a SUBSET of a population counter this code does
  not own; removing one desyncs the HUD's population against the staffing ratio. `critical` is the
  worst stage and it recovers.
- **`game.tiles` is never written.** A virus cannot damage, demolish or un-crew a building. The only
  write into a citizen is `nudge()`, the sanctioned mood seam.
- **Every reagent is an id from the live `RESOURCES` (14).** Never `SALVAGE_RES`, never the 258-entry
  chain catalogue — an id a player can hold but not spend is worse than a missing one.
- **All operation pricing goes through `_opEcon()`.** Not one Cinder figure is written inside the
  modules.
- **Ledgers are append-only.** `cure_payouts` has a trigger enforcing it; a destroyed batch is
  marked, not spliced out.
- **The suit's consequence is on the product.** There is no health bar. Exposure costs purity and
  stability and sets `contaminated`. An "ignore" button or auto-suit would remove the teeth from the
  whole feature.
- **Coverage gates clearance.** A viable cure only *retires* a strain if it reached ≥80% of active
  cases, counting incubating ones the ward cannot see. Without this, one dose clears an outbreak and
  dose count is decoration.
- **Stability is separate from efficacy.** A batch can be the right shape *and* unstable — it works,
  cures people, and sheds. That is the interesting mistake.

## Tuning, in one place each

| Knob | File | Value | Effect |
|---|---|---|---|
| `CONTACTS_PER_HR` | `outbreak.js` | 11 | R₀ ≈ 2.0 moderate, 4.5 virulent |
| `CEILING_SHARE` | `outbreak.js` | 0.72 | max concurrent share of roster |
| `WORKFORCE_DRAG_MAX` | `outbreak.js` | 0.35 | health-vital drag; **0 = outbreaks purely social** |
| `CLEAR_THRESHOLD` | `triage.js` + `state.js` | 0.8 | mirrored in both; the smoke test asserts they agree |
| `SUIT_SPEED` | `scene.js` | 0.72 | suit weight; 1 removes the penalty |
| `CAM_HEIGHT` / `CAM_BACK` | `scene.js` | 8.4 / −7.2 | `_setCamera(15.5, 13.5)` = original wide shot |
| `MODEL_YAW` | `scene.js` | 0 | `_setModelYaw(Math.PI)` if a character moonwalks |

Measured on 40 citizens over five uncured hours: moderate (0.35) reaches 27/40, peak 16; virulent
(0.80) reaches all 40, peak 29 against a ceiling of 30.

---

## Verifying

```bash
npm i                                                               # terser
node _synckcheck.mjs public/index.html public/node-city/index.html
node _plague_smoke.mjs            # 72 checks, deterministic, pinned epoch

# real browser — needs two packages NOT in package.json, by design
npm i --no-save playwright-core three@0.128.0
node _labshot.mjs <page.html>     # asserts the character is human-sized and on the floor
```

**Why `_labshot.mjs` exists:** `CLAUDE.md` notes the Browser pane never composites — RAF does not
fire, canvas rects read 0×0 — so anything that only exists once the scene has *rendered* is invisible
to every other check here. That gap let a 175-metre character ship twice.

⚠ It measures **bone world positions**, not `Box3.setFromObject`. On a skinned mesh that helper
reports bind-pose geometry through the armature's 0.01 scale — it answers 0.017 m for a character
standing 1.75 m on screen. Its first version used the helper and failed a correct build.

---

## Bugs found by playing, and what each cost

Every one of these was invisible to reading the code and to the headless tests as they existed. All
are fixed and covered by tests now.

1. **The hazmat suit could never be sealed.** `startDon` stamped `Date.now()`; the loop fed
   `HZ.tick()` `performance.now()`. The comparison was `5000 - 1767000000000 >= 2600` — always false.
   The HUD reads the wall clock, so the bar filled to 100% and froze. *Two clocks, one comparison.*
2. **A moved right, D moved left.** `axisOf()` returns screen intent, but the camera looks along
   world `+z` and three.js builds that basis as `cross(up, eye−target) = (−1,0,0)`, so screen-right is
   world `−x`. The vertical half was correct by luck, which is why only half the controls felt wrong.
   Now one documented constant, `SCREEN_X_TO_WORLD`.
3. **The character swap could never run.** `if (chars.active)` gated a branch whose only job was to
   call the function that sets `chars.active`. Chicken-and-egg; models could load perfectly and you
   still saw boxes.
4. **A 175-metre researcher.** Sized with `Box3.setFromObject`, which walks `matrixWorld` and includes
   the armature's 0.01 scale. Skinning *cancels* that (GLTFLoader binds while unplaced; the baked
   inverse-bind matrices undo it), so the rendered size is governed by **geometry space**. Dividing by
   0.017 instead of 1.7 overshot 103×. It drew 3,043 triangles the whole time and looked like an empty
   room.
5. **CSP killed the textures.** A GLB keeps its texture in the binary chunk; three.js makes a `blob:`
   URL and **fetches** it (r128 picks `ImageBitmapLoader` outside Firefox). A strict CSP refuses that
   — `connect-src`. The texture rejects → the parse rejects → "the model did not load", pointing at
   the file. Fixed by inlining textures as `data:` URIs *and* forcing the `<img>`-based loader.
6. **A warning false on every row.** `rankLabs` reported "unstaffed — it cannot administer" using a
   rule that predated the ward. Every `medical` op in production has zero workers, so it would have
   been wrong on every row on day one.

**Two harness defects worth remembering:** `_plague_smoke.mjs` originally used absolute
`/home/user/...` imports (would have failed on any other machine), and its clock started at
`Date.now()`, which seeds the spread roll — so the suite genuinely passed or failed depending on the
time of day. Now pinned to a fixed epoch; output is byte-identical across runs.

**The process lesson:** three of these shipped because each "verification" ran in an environment that
differed from the player's in exactly the way that mattered — first no real browser, then an
intercepted CDN, then no CSP. A temporary on-screen diagnostic panel found #5 in one round after four
rounds of guessing. Build the readout before the third guess.

---

## Known gaps / next work

- **Two of three player roles are still passive.** The ward fixed the lab. The **haulier** still gets
  paid automatically and makes no decisions. `haul_post` / `haul_board` in the existing transport
  system is exactly the job board that would fix it — another argument for the Reuse option.
- **No city counter-play besides curing.** Outbreaks now cost output, but the only answer is a cure
  that takes time to make and ship. A quarantine lever — restrict a workplace, take the labour hit
  deliberately, slow transmission — would make the retune feel fair rather than punishing.
- **`report().workforceLoss` is dead**, superseded by `healthDrag`. Harmless cruft.
- **The Medical Corporation minigame is done; the transport one is not.**
- **Assets:** `_glbpack.mjs` must be re-run on any character re-export (30 MB → 1.31 MB), and
  `_glbcheck.mjs` run after it. Keep them small — the `.glb` exceptions in `.gitignore` /
  `.assetsignore` exist only because these two are 0.65 MB against Cloudflare's 25 MiB per-asset cap,
  and one oversized file aborts the entire deploy.

## Degraded states, all supported

| Missing | Behaviour |
|---|---|
| `MythicPlagueBridge` | Modules register, stay inert, warn once |
| WebGL / the CDN | Lab opens **flat** — no room, every station present, suit gate still applies |
| Character models | Box avatar, plus a toast naming the reason (no longer silent) |
| Supabase / signed out | Ship to your own operations |
| `sql/038` unapplied | Indistinguishable from offline, by design |
| City builder not loaded | A strain with nobody to infect is **queued**, takes hold on the next city tick — the normal case when a shipment lands on the game's poll |

---

*Read `PLAGUE.md` next — it is the design doc and explains the why behind each mechanic.*
