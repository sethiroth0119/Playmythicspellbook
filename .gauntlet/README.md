# The Gauntlet harness

Boots the real `public/node-city/index.html` in headless Chromium, builds a
fixed district through the **shipped placement path**, and photographs it.
This is how a critic sees actual output instead of a diff.

```bash
node .gauntlet/capture.mjs .gauntlet/shots/rN --tag rN
```

Produces `rN-aerial.png`, `rN-street.png`, `rN-district.png` and `rN-frontage.png`
at 1600×900 (plus committable .jpg twins) and prints JSON with the scene bounding
box, mesh/triangle counts, what the scene placed, **why anything it asked for was
refused**, **which gates it had to satisfy**, and the last console lines.

## Why each piece exists

**`shot.mjs`** — single framed screenshot, `--wait/--w/--h/--eval`. Use for a
one-off look at a specific thing.

**`capture.mjs`** — the round capture: **four** framings from one browser boot
(~25 s). Camera framings are **derived from the bounding box of the placed
meshes**, because `placeMeshAt` owns the tile→world mapping and hardcoded
coords pointed at empty ground.

`aerial`, `street` and `district` are **unchanged since round 0 and must stay
that way** — every historical comparison in this project is made against them.
`frontage` was added in round 12 and is the fourth: a raking three-quarter view
down a built frontage, eye at 0.80 (just under the eaves at SH = 0.34), ~19° of
depression, **targeted at the ground rather than at the building**, and with the
camera kept inside the road corridor — plots are 1 unit wide, so anything more
than ~0.45 off the carriageway centre puts the lens inside the building
opposite, which is what the first cut did. It exists because the round-9 parcel critic could not find a
change worth 80 cells of foundation bed in any of the other three — *"the rear
walls are occluded by the roofs that stand in front of them at this angle, and
the foundation planting is below the eaves"* — and they were right: the two
aerials look down on roofs, and the street shot sits at 0.30 in the carriageway
where the whole ground plane is at grazing incidence. Anything that meets the
ground — a kerb, a drive, a lawn, a bin store, a parcel line, a foundation bed —
is scored from `frontage` now.

**`scene.js`** — the standard district, run inside the page. Deterministic:
fixed tile list, and `makeHousing` seeds its archetype off the tile coords, so
an A/B between rounds compares **renders, not layouts**.

🔴 **Rounds 0–11 were judged on a district with no commercial building in it.**
Measured at round 11: of 201 tiles, 54 housing, 130 road, 3 anchor and **14**
non-housing buildings — 9 Supply Depots, 3 Motor Pools, a farm and a vacant lot.
Refused *every single capture*: `retail`×3, `shop`×3, `tenantbiz`, `arena`,
`medlab`, 2 gardens, 3 trees, 2 bushes, the fountain. A warehouse estate with a
suburb attached, photographed for eleven rounds under the heading "Density &
zoning read". Round 12 found four separate causes — see **Why the district was a
warehouse estate** below — and it now places **218 tiles / 31 non-housing
buildings**, including three Retail Parades, three shops, a leased tenant
business, an arena, a med lab and the planting.

The scene's return value now carries **`why`** (the game's own refusal sentence
for every tile that did not place, captured through `window.__ncToastSink` —
never re-derived) and **`gates`** (what the scene had to satisfy to get the city
up, including the 12 development points of research it granted itself). Read
both. A bare `fails` count is what let one wrong explanation stand for ten
rounds.

**`drive-streets.mjs`** — a LONG run with sampling, for anything that has to
accumulate. `shot.mjs` throws the eval's return value away and truncates
console lines at 400 chars; this prints whole JSON objects on a timer.
`--run/--every/--ff/--vp/--png`.
⚠ **The sim runs at about a fifth of wall time in this box.** `animate()`
clamps `dt` to 0.25 s and SwiftShader renders the built district at ~0.6 fps,
so `game.cityAge` — and therefore anything measured per city second — advances
five times slower than it does for a player at 60 fps. `--ff n` adds `n`
seconds to `cityAge` per frame to compensate. It injects **clock only, never
traffic**: compressing the clock n-fold means the city genuinely carries n
times fewer vehicles per city hour, so volumes read low and a `--ff` capture is
not a reference for how busy a street is.

**`lotcheck.mjs`** — the LOT GATE, added round 10. Asserts three things about
the residential parcel against the real scene graph: that no plot's geometry
crosses its own tile line in X, that every garden plot actually got a driveway,
and what housing costs in triangles and meshes. It exists because round 9
shipped a semi whose eaves overhung the neighbour by 5mm and whose driveway the
code was correctly refusing to build — neither visible in any capture, both a
one-line number here. Run it after anything that touches `makeHousing`.

**`layer-ab.mjs`** — **the instrument for "how much did my change actually
do".** One boot, one scene, one camera; a named scene group (`parcel`,
`parking`, `crowd`, `outskirts`, `zoning-overlay`, …) is switched off and the
frame compared with itself, with `renderer.render()` and the pixel read **in the
same task** (item 6 below). The do-nothing control comes back at exactly 0 and
is printed beside every figure, so a run that drifted announces itself instead
of being quoted. Also prints one `renderer.info` cost delta with **all three
reads taken together, before any capture** — interleaving read → shoot → read
once reported `dMeshes −12`, i.e. the layer making the scene *cheaper*, which
was agents being culled differently during a 40-second screenshot.

```bash
node .gauntlet/layer-ab.mjs --layer parcel --framings aerial,frontage
```

**`noise-floor.mjs`** — runs the aerial framing twice over on the same commit
and prints what the cross-boot tripwire reports **when nothing has changed**. It
exists because nobody had ever run that control; the answer is 14.7–15.9 pp, and
it is why the tripwire's percentages are no longer quoted as results. Re-run it
(two invocations, the second with `--against` the first) if the standard scene
or the pinned hour ever changes — a floor nobody re-measures is a floor nobody
believes.

**`precommit-scan.mjs`** — the THIRD gate, and the only one that is not about
syntax. `_synckcheck.mjs` and `modcheck.mjs` answer "does this parse". This
answers "did anyone mean this". It greps the working diff for markers an agent
leaves on a line it intends to take back out — `TEMPORARY REGRESSION`,
`DO NOT COMMIT`, `PRE-FIX BEHAVIOUR` and friends — and exits non-zero.

🔴 It exists because commit `47e230f` shipped a deliberately broken line. An
agent had injected a regression so it could photograph the pre-fix behaviour;
a checkpoint commit sampled the tree at that instant; **both syntax gates passed,
and always would have, because the injected line is valid JavaScript.** Checked
out, that commit is a build where a fix is disabled while appearing present.
See `public/src/districts/FIX-RECORD.md`, and `public/src/demographics/FIX-RECORD.md`
for the first, milder instance of the same mechanism.

It is a grep and it says so: it finds the marker, not the breakage. **The
convention it depends on is that the marker goes ON the line you are about to
remove**, not in a comment three lines away. Run it before any commit that sweeps
a tree other agents are writing to.

**`lumscan.mjs`** — prints one row of a capture as RGB + luminance. The round-9
critic's own instrument: they answered "I can see the boundary at 4x" with "it
is 1-2 px wide and ~15 units of separation from what it is meant to separate",
and that is the form an answer has to take. A 4x crop is not evidence.

**`check-streets-clock.mjs`** — `traffic.js` in node, no browser. It takes a
ctx and a clock and touches no DOM, so the bucket boundaries, a full lap of the
24-bucket ring, the save format and the migration cases run in a second instead
of in a twenty-minute capture. Run it before any browser round when the traffic
meter changed.

## 🔴 Six things that cost a debugging round each

1. **The CDN is blocked.** The page's import map points at
   `cdn.jsdelivr.net/npm/three@0.171.0`, and the agent proxy 403s CONNECT to
   CDNs. The harness fulfils those URLs from a locally vendored tarball
   (`.gauntlet/package`, from `npm pack three@0.171.0` — npmjs.org *is*
   reachable). Chromium is launched with the proxy env stripped and
   `--no-proxy-server`, and the catch-all route is registered **before** the
   jsdelivr route because Playwright's last-registered route wins.

2. **Cost is checked at the bridge, not at `game.res`.** `canAfford`/`payCost`
   call `MythicCityBridge.getRes/getCinders`. Stubbing `game.res` does nothing.

3. **Crew slots refuse the third order.** `bldSlots()` is the municipal 2 free
   crew, so `scene.js` calls `__nc.build.finishAll()` after **every** placement.
   That both frees the slot and turns the scaffold site into the building —
   without it the camera photographs construction sites.

4. **Road capacity is bought with Supply Depots.** `ROAD_CAP_BASE` 40, `+10`
   per *finished* depot; depots cost population and population comes from
   housing. So the placement order is forced: housing → depots → roads.

5. **A whole-frame pixel statistic cannot resolve a change confined to a few
   tiles — and you cannot photograph a ground film on built land at all.**
   Four attempts, while verifying the zoning overlay's dormant marking
   (`verify-zoning-film.mjs`), and none of them separated the treatment from a
   do-nothing control. On a 1240x700 crop (868,000 px):

   | Comparison | px >12/765 | px >150/765 | mean-colour Δ |
   |---|---|---|---|
   | Two frames, **nothing changed**, 4.2 s apart | 136,171 | 88,149 | 0.658 |
   | The film's whole appearance changed | 151,031 | 105,066 | 0.325 |

   The treatment came in **below the control**. What each attempt taught:

   · **Pin the hour.** The first pass ran unpinned and landed at dusk, sky
     mid-transition and the street lamps coming on, so every frame differed
     from the last across a tenth of the image. `shot.mjs --hour` and
     `capture.mjs` have pinned it since round 3; anything that diffs frames
     must too.
   · **Raise the threshold — it does not help.** 88,149 px still moved by more
     than a fifth of full range with nothing changed. A scene this busy has no
     quiet pixels.
   · **Crop to the thing under test, and DERIVE the crop.** Project the tiles'
     centres through `__nc.camera` — the same camera the frame was rendered
     with — so the box cannot drift out of the picture the first time somebody
     moves the default framing. This shrank the crop 6× and the signal stayed
     under the floor.
   · **A level-5 tower covers its whole plot.** Zoning the built housing band
     and cropping to it measures ROOFTOPS: a y=.05 ground film has no ground
     left to be drawn on. Test a ground feature on ground the player can see —
     land they have just zoned and not yet built.

   🔴 SO THE VERDICT IS NOT A PIXEL COUNT. It is the overlay mesh's own vertex
   count and vertex colours, read out of the scene through
   `MythicZoning._ctx.scene`: the dormant state adds a known number of quads and
   a known number of amber vertices, and both have to appear, disappear and come
   back with the verdict. A photograph is evidence; the buffer that produced it
   is proof. The crops are still saved — `film-dormant.png`, `film-open.png`,
   `film-off.png`, the same land three ways — because a human reading them side
   by side sees in a second what the statistic could not find at all.

   ⚠ One more, and it cost a round on its own: **a vertex colour is LINEAR.**
   `Color.setHex()` converts sRGB→linear for you; a literal `{r,g,b}` written in
   the source does not get that conversion. The sRGB amber (1.00, 0.64, 0.22)
   renders as (1.00, 0.83, 0.51) — a pale beige that reads as nothing.

6. **A `.visible` A/B that never calls `renderer.render()` reports ZERO for
   everything.** `animate()` is the only thing that renders, and rAF fires
   **about 0.56 Hz here** (measured: 3 callbacks in 5,343 ms) — so flipping a
   mesh and reading the buffer in the same task reads *the frame before the
   flip*, for any layer, always. Measured on the landvalue and water ground
   overlays, both of which had been recorded as unphotographable:

   | Instrument (same plane, same frame, same 1378x712 derived crop) | px changed |
   |---|---|
   | flip `.visible`, read buffer, **no render** | **0 / 981,136 — 0.00%** |
   | flip `.visible`, `renderer.render()` between reads | **766,317 — 78.11%** |
   | two renders, nothing changed (control) | 0 — 0.00% |

   Zero is not a small signal, it is a **dead instrument**, and it is why
   `/src/water` "measured identically": a do-nothing read measures every layer
   identically. `/src/landvalue`'s overlay is in fact one of the loudest things
   in the frame — 78% of the district crop and 79% of a 2x2 patch of bare
   ground move when it comes on. See `ovl-probe2.mjs` / `ovl-driver2.js`.

   ⚠ AND THE SECOND TRAP, which reports ~1% instead of 0% and is therefore
     worse: **the module puts the plane back.** `/src/landvalue` runs
     `setInterval(… , LV.field.ttlMs)` = 2.5 s that calls `refresh()` →
     `Overlay.sync()` → `mesh.visible = true` **whenever its panel is open**.
     Any A/B that opens the panel and then hand-flips `.visible` is racing that
     timer: measured 1.12% with the panel open against 61.04% for the identical
     procedure with it closed. Either drive the shipped toggle
     (`__nc.landValuePanel(false)`, which stops the timer refreshing) or flip
     by hand **with the panel shut** — the canvas keeps its paint after a
     close, so one open/close is enough to have something to photograph.

   🔵 THE MEASUREMENT THAT WORKS, to copy:

   ```js
   const { renderer, scene, camera } = __nc.three();
   const gl = renderer.domElement, CW = gl.width, CH = gl.height;
   const s = document.createElement('canvas'); s.width = CW; s.height = CH;
   const c = s.getContext('2d', { willReadFrequently: true });
   // ⚠ drawImage in the SAME TASK as render(): preserveDrawingBuffer is off,
   //    so the buffer is gone by the next task and readPixels returns zeros.
   const shoot = () => { renderer.render(scene, camera);
     c.clearRect(0,0,CW,CH); c.drawImage(gl,0,0,CW,CH);
     return c.getImageData(0,0,CW,CH); };
   plane.visible = true;  const A = shoot();
   plane.visible = false; const B = shoot();
   const C = shoot();                    // control: B vs C must be 0
   ```

   With the renderer driven this way the do-nothing control is **exactly 0**,
   not the 136,171 px of §5 — because nothing steps the sim between two
   synchronous renders. That removes the noise floor that defeated four
   attempts, so a pixel count IS a verdict again, **provided the control is
   reported beside it**. `page.screenshot()` is also honest (61.04% on the same
   toggle) as long as rAF gets ~1.5 s to composite, or a render is driven and
   then given a beat — it is only ever the *unrendered* read that lies.

## The seam this rides on

`window.__nc` (node-city's diagnostics seam, ~line 28903) exposes
`place`, `build.finishAll`, `camera`, `controls`, `three()`, `game.tiles`.
Nothing test-only was added to the shipped file — the harness drives the same
functions a player's click drives.

## Not committed

`.gauntlet/package/` (vendored three) and `.gauntlet/shots/` are gitignored —
one is 10 MB of third-party code, the other is regenerable.

## The cross-boot tripwire (was: "the per-framing diff gate")

```bash
node .gauntlet/capture.mjs .gauntlet/shots/rN --tag rN --against .gauntlet/shots/rN-1
```

### 🔴 What it does NOT measure

**It does not measure how much your change did, and its percentages must never
be quoted as if it did.** They were, in several round reports.

Measured on the standard scene with **literally nothing changed** — same commit,
same pinned hour, two boots of this same script:

| Comparison (aerial framing, 1600×900, >6/255 threshold) | px changed | mean Δ |
|---|---|---|
| Two boots, **nothing changed at all** | **14.70 %** | 2.75 |
| Two boots, nothing changed, second pair | **15.90 %** | 3.09 |
| Two boots, nothing changed, **every agent, parked vehicle and the standing crowd hidden** | **14.68 %** | 2.77 |
| Same boot, two shots **5 s apart** | 6.14 % | 3.09 |
| Same boot, two shots back to back through `page.screenshot` | 1.16 % | 0.62 |
| Same boot, two renders read **in the same task** (item 6) | **0.00 %** | 0 |
| *A real parcel-scale change, single-boot A/B, for scale* | *2.45 %* | — |

The null control is **six times the signal**. Every absolute per-framing number
this gate has printed has been inside its own noise.

⚠ **`perimeterScenery` is not the cause, and `public/src/parcel/FIX-RECORD.md`
is wrong about it.** That file records "`perimeterScenery` rolls from
`Math.random` and fills the aerial's background" as the diagnosis. It does not:
every roll in it goes through `rdRng`, the file's own lattice hash (the treeline
it replaced *did* use `Math.random`, and its header says so — that is where the
memory comes from). Checked, not inferred: the scene graph was fingerprinted per
top-level group across two boots and the `outskirts` group hashes **identically**.
And hiding every moving thing in the city moves the figure by 0.02 pp.

What actually happens is that **every pixel moves a little**. `estClock()` reads
the wall clock 1:1, two boots reach the shutter a few seconds apart, and a mean
delta of ~2.7/255 spread over the whole frame trips a 6/255 threshold on a
seventh of the image. A scene this busy has no quiet pixels — the same finding
as item 5, arrived at from the other end. **No seeding fixes this**, which is
why nothing in `node-city/index.html` was changed for it.

### What it IS still good for

The comparison it was built for is **relative**, and a common-mode drift floor
cannot manufacture a spread between framings. Round 5's ground work moved the
aerial 48.9 % and the street frame 4.0 % — 12× — and nobody noticed for two
rounds. That is the tripwire, and it still fires.

So the output is now `crossBootTripwire`, not `changedVsPrev`: an object
carrying the per-framing percentages, the **ratio of each framing to the best
one**, the list of framings that barely moved, and its own null control in the
same object, so the number and the reason it cannot stand alone can never be
separated by a copy-paste. Use the ratio. Never quote the percentage.

### The instrument that replaces it

**`layer-ab.mjs`** — one boot, one camera, the layer toggled, render and read in
the same task, control exactly 0. See its entry above and item 6.

⚠ The images are served over the harness's own loopback HTTP, not as `data:`
URIs. The first cut used data URIs, the catch-all route aborted them, and a bare
`catch { null }` reported that as "no diff" — a silent fallback inside the tool
built to stop silent fallbacks. A failed diff now reports its reason.

## Why the district was a warehouse estate

Five kinds of refusal, four of them faults, found in round 12 by capturing the
game's own refusal sentence for every tile instead of counting failures. The
`fails` map had reported a bare count for ten rounds and every reader — human
and agent — attributed all of it to one cause. All four faults are now
satisfied, and `scene.js` reports in `gates` which gates it had to open:

| Refused | Real reason | What the scene does now |
|---|---|---|
| `retail`×3 | **/src/progression**: `retail` needs *High-Density Commercial* (2 dp). The building gate landed in `tryPlace` at commit `aa6286a` (2026-08-18) and three Retail Parades stopped placing that day — silently, because a refusal is a toast and nobody was listening to toasts. | grants the node through `MythicProgress._grant`, the module's own documented test seam, **and lists every node and its point cost in `gates`** |
| `tree`×3, `bush`×2, `garden`×2, `fountain` | same gate: *Parks & Recreation* (1 dp), whose req *Municipal Services* (1 dp) also has to be granted | as above — 12 dp in total, all named |
| `shop`×3, `arena`, `medlab` | **the municipal ceiling**: 2:02:01 / 3:23:16 / 1:28:29 against `ECON.municipal.maxSec` of 40:00, with no Construction Co. standing | **not stubbed** — collects the free Construction Co. licence with `opsAcquireFree` (the same call a player's click makes) and sites one at `(C+5, C+1)`, which is the exact route the refusal text names |
| `tenantbiz` | **it is not a building.** `tenantbiz` is the *mesh name* `buildMesh` uses for a `lot` that has a tenant; there has never been a `BUILDINGS` entry. `tryPlace` returned at `if (!def) return` before any gate spoke — no toast, no tile, and eleven rounds of a line in the scene that drew nothing | places a `lot`, leases it through `MythicCityBridge.leasePlot`, and repaints through `__nc.repaint` — the two lines the inspect handler runs when the player picker resolves |
| `road`×29 | **road capacity, and this one is correct.** 130/130 with nine finished Supply Depots. The street grid genuinely runs out; that is a rule a player meets too. | left alone, and reported with its reason in `why` |

Two traps found on the way, both of which will bite the next scene:

1. **The long-order confirm.** `bldConfirmLong()` calls `window.confirm` for
   anything over `ECON.confirmOverSec` (1 h). **Headless Chromium
   auto-dismisses a dialog nobody handles** — so the answer was *Cancel*, and
   `tryPlace` returned having emitted no toast at all. Once the ceiling was
   properly satisfied, shop / arena / med lab were all still refused, invisibly,
   with nothing in `fails` to explain it. `scene.js` answers yes, counts the
   questions and restores `window.confirm`.
2. **Siting an operation opens the dossier.** `opsSite`'s success path ends with
   `openInspect(pk)`, and the first capture after the Construction Co. landed
   photographed a 1000×700 panel instead of the city. The scene closes it the
   way a player does, with `closeInspect()`.

### 🔴 What this makes suspect in rounds 0–11

Every visual round in this project was judged on frames from this harness. Two
of its properties were wrong. This is what that costs, and none of it is a
guess — each line is a building type that was measured as refused.

1. **Every "commercial vs industrial from the air" judgement is void.** `shop`×3,
   `arena`, `medlab`, `gasstation`, `forge` and `tenantbiz` were refused in
   **every capture this harness has ever taken**. There has never been a shop, an
   arena, a med lab or a tenant business in a gauntlet frame. A critic scoring
   commercial architecture, shopfronts, signage or a high street was scoring an
   absence — and any score that *rewarded* the district for reading as
   industrial was rewarding the fact that it was industrial and nothing else.

2. **Round 11's zoning block never existed.** It was built to answer exactly that
   rubric dimension, and its own comment describes "a viewer reading down that
   block crosses industrial, then open ground use, then a high street, then the
   housing". The high street is three Retail Parades, and **all three were
   refused, every capture**. What shipped was three depots and three car parks:
   industrial, then parking, then nothing. The comment even asserts "EVERY TYPE
   HERE IS UNDER THE MUNICIPAL CEILING and that is why they place at all" —
   true about duration, and irrelevant, because what stopped them was
   /src/progression, a different gate entirely.

3. **Round 7's tree, bush and garden recipes have never appeared in a capture
   since `aa6286a`.** The progression building gate landed on 2026-08-18 (33
   commits back), and from that commit `tree`×3, `bush`×2, `garden`×2 and the
   fountain stopped placing. Rounds up to 10 *did* have them; round 11 lost all
   of them. So an r10→r11 framing diff contains the disappearance of every
   ornamental tile in the city, and whatever round 11 attributed that movement
   to, some of it was planting vanishing. (`makeTree2`'s kerb-pit street tree,
   its three-silhouette set and the seeded archetypes are all only reachable
   through those tiles.)

4. **Every per-framing percentage published from the `--against` gate is inside
   its own noise** — see the table above. The one conclusion that survives is
   round 5's, because it is a *ratio*: aerial 48.9 % against street 4.0 % is a
   12× spread, and a common-mode drift floor cannot manufacture that. Any round
   whose framings differed by less than about 2× proved nothing.

5. **Round 9's `/src/parcel` coverage finding needs re-measuring.** "20 triangles
   of flat parcel across the entire city" and "13 of the 14 non-housing
   buildings carry `HAS_OWN_GROUND`" were measured on the old district. There are
   **31** non-housing buildings now, of five classes that did not exist in the
   scene. Do not quote those numbers again without re-running.

### What is deterministic, and what is not

Two boots of the same commit produce **the same layout**. The scene returns a
`layout` block in every capture so this is checkable from any run rather than
from a tool nobody remembers to execute:

```json
"layout": { "tileHash": "b1f8cdea", "meshHash": "b3aebda2", "staticMeshes": 1982 }
```

**`tileHash` must be identical between two boots of one commit** — it is every
key, type, level, rotation and tenant in `game.tiles`. Measured over four boots
of this scene: `b1f8cdea` every time. If it ever moves, an A/B between rounds is
comparing two different cities and every pixel figure taken from it is void.
`meshHash` is every mesh in the scene (agents excluded) by world position and
full vertex checksum, and it is **expected** to differ — see below.

⚠ **Four building recipes still redraw themselves on every boot**: `farm`,
`lot`, `shop` and `machineshop` (the Construction Co.'s mesh). `buildMesh`
passes `tx, tz` and only `housing`, `tree`, `bush` and `garden` read it — every
other recipe falls back to `Math.random`. That is ~19 meshes out of 1,982 and it
is a **game-side** property that predates the harness (`farm` and `lot` have
been in the standard city all along). It is not why the cross-boot diff is
noisy — see the table above — so nothing was changed in `index.html` for it. If
a round ever needs those four stable, the fix is in the recipes, not here.
The sun and moon discs also move a few thousandths between boots, because the
clock is pinned to an *hour* and not to an instant.
