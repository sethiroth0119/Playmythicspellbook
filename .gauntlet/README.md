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
up, including the development points of research it granted itself). Read
both. A bare `fails` count is what let one wrong explanation stand for ten
rounds.

🏢 **Round 17 added a sixth block and a seventh gate.** node-city gained an
`office` building — there was none, and four systems (the Zone Demand panel,
`o_low`/`o_high`, /src/districts' three office specialisations and
/src/landvalue's `off` column) had been advertising a land use that resolved to
a Research Spire or a holding company. Three Office Blocks now stand at
`(C+5…C+7, C+3)`, in line with the three Retail Parades across the x = C+4
junction, so one frontage carries shopfronts and then office massing. That
needs `off_low` (2 dp), so the scene grants **14** development points, not 12,
and places **221** tiles. The tiles are inside the existing bounding box, so
the `aerial` / `street` / `district` framings did not move.

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

**`r18-probe.mjs`** — added round 18, and it is `layer-ab.mjs`'s shape applied to
two things a layer toggle cannot reach: **fog distances** and **whether a given
object casts a shadow at all**. One boot, one camera, render and read in the
same task, control 0.000%.
· *fog*: samples the ground at road-tile and empty-tile centres — the CLASS
  comes out of `game.tiles`, never guessed — projects each through the live
  camera, **raycasts it and drops it unless the first thing the camera sees
  there is that point**, then reports the median road-vs-grass ΔL and Δhue per
  depth band under the shipped fog and under a candidate. The raycast is the
  part that matters: the standard district's far corner projects to (800, 200)
  in the aerial, which is *behind* the mid-rise cluster, so a bare projection
  reads a roof and calls it grass.
· *shadow*: flips `sun.castShadow` and, for each caster, **scans a ray along
  the light direction from its foot** keeping the darkest L(off)/L(on) on it —
  because a shadow lands over a kerb or a 3cm-lower carriageway and predicting
  one point misses it. Control = the same scan rotated 90°.
  🔴 ITS FIRST CUT WAS A DEAD INSTRUMENT AND SAID 1.000 FOR ALL 74 LAMPS. It
  read `mesh.userData.lampLocal`, which is the LANTERN — the arm carries it
  0.15 over the carriageway — so it probed thin air. The mast is at tile-local
  (0.36, 0.36). A control that also sits in the open agrees that nothing is
  there, so the control did not catch it; the ray scan is what did.
· also sweeps map size / span / normalBias / filter in the same boot and prints
  texels-per-unit beside each, which is how round 18 concluded that a
  0.031-unit lamp mast cannot be shadowed by one cascade at any affordable
  resolution.

⚠ **THE WEATHER IS NOT PINNED AND IT SHOULD BE.** `capture.mjs` pins the hour
(§5) but `wx` rolls on its own timer, so a five-framing capture can start CLEAR
and finish in a STORM — measured in round 18: `r18b-aerial` reads CLEAR and
`r18b-frontage`, 30 s later in the same run, reads STORM, with the carriageway
going from warm brown to blue-grey. Any before/after taken across two runs must
check the weather badge in the frame (top-left) before it quotes a colour.

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


---

<!-- ══════════════════════════════════════════════════════════════════ -->
# PART TWO — the tactical battlefield (merged in from the hex branch)

Both branches independently wrote a file called `.gauntlet/README.md`, so this document is
a UNION, not a rewrite. Everything above is the city/stage document this repo
already shipped; everything below arrived with the hex battlefield and is
scoped to `public/battle-board/`. Where the two disagree about the Gauntlet README,
the section that names the subsystem you are working on is the one that binds.

⚠ Their runbook refers to `.gauntlet/shot.mjs` and `.gauntlet/probe.mjs`. Those
names were already taken by our Node City rigs, so their versions now live at
`.gauntlet/stage-shot.mjs` and `.gauntlet/stage-probe.mjs`.
<!-- ══════════════════════════════════════════════════════════════════ -->

# .gauntlet — how to actually look at the battle board

Everything in this folder exists so that a judgement about the battlefield is made
against **pixels**, not against a description of pixels. `BAR.md` says it outright:
*a critic who did not open an image has not critiqued.*

| File | What it is |
|---|---|
| `CONTRACT.md` | The architecture brief. Read §1 before touching the protocol. |
| `BAR.md` | The quality bar every critic judges against. |
| `shot.mjs` | The capture rig — serves `public/`, drives real Chromium at 2×, writes a PNG. |
| `baseline-stage.png` | The before picture. A/B against this, per `BAR.md` step 2. |
| `baseline-app.png` | The whole game screen, same purpose. |
| `progress.html` | Run status for the gauntlet itself. |

The harness the rig drives lives with the thing it drives:
**`public/battle-board/_harness.html`**.

---

## Capture a scenario in one command

```bash
node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" /tmp/gamemap.png 1600 900
```

That is the whole recipe. Swap `scene=` for any name in the table below, and swap the
output path. Then **open the PNG.**

```
node .gauntlet/shot.mjs <url-path> <out.png> [width] [height] [waitMs]
```

`width`/`height` are CSS pixels; the rig captures at `deviceScaleFactor: 2`, so
`1600 900` writes a 3200×1800 file. `waitMs` (default 2600) is only used for pages
that publish no readiness signal — see *Readiness* below. Exit code is `0` on a good
capture and **`1` if readiness timed out** — the PNG is still written so you can look
at the stall, but a script in a loop can tell the difference.

---

## 🏷 AS-SHIPPED vs TARGET-STATE — read this before judging any capture

A fixture is only trustworthy as far as the game's real *sender* can produce it. The
sole producer of the battle stage's map is `_bbMapFromEditor` (grep it — the line
number has moved twice), and **what it produces changed in the terrain wave**.

**As of the terrain wave, the shipped default is NOT bare ground.** `_bbMapFromEditor`
now calls `_bbGenTerrain(cols, rows, _bbMapSeed())` unconditionally and returns all
168 tiles with `surf`, `elev` and `deco` on them, admin battlemap or none. So the
`gamemap` scene — the control capture — really is a relief map with materials and
props, and judging elevation, cliff faces or props from it is judging the real game.

What that fixed, recorded here because it is the reason the label exists at all:

- it used to emit tiles as `{x, z, type}` plus an optional `prop`, and **the word
  `elev` appeared nowhere in the function**;
- with the shipped default, `_b3dActiveMap()` returned `terrain: null, models: []`, so
  both conversion loops ran zero times and it returned **`tiles: []`** — and
  `board:init` does `Object.assign(MAP, msg.map)`, which *replaced* the board's own
  demo tiles with that empty array. A real match had no props, no hazards and no
  elevation, while every terrain-rich capture in this folder implied it did.

**Still not reachable from the sender**, and still target-state wherever a scene uses
them: `BB_TERRAIN_TYPE` is `{water, lava, blight} → 'hazard'`, so `type:'objective'`
and `type:'blocked'` cannot be sent; and the battle stage is never sent `events` at
all (see *Known caveats*). The generator deliberately emits neither — its header says
why: the canvas stage's idea of "blocked" is not the game's, and the game's walkable
rules stay authoritative.

So every scene is labelled. The label is in the chrome panel, in this table, and burned
into the corner of every `?shot=1` PNG as a watermark, because a PNG outlives the URL
that made it.

### The scenes

| `?scene=` | Provenance | What it shows |
|---|---|---|
| `gamemap` | ◆ **as-shipped** | **The control capture.** `_bbMapFromEditor()`'s literal output for the shipped default: all 168 tiles carrying `surf`, `elev` and `deco` from `_bbGenTerrain`, i.e. the seeded post-apocalyptic relief a real match is fought on. Units, defs (`h:1.05`), graves and surfaces are all verbatim-real. Same layout as `skirmish` so the two diff cleanly. Add `&seed=<n>` to build the same map family on a different seed — the default seed is what every A/B uses and must not change. |
| `empty` | ◇ target-state | Terrain, props, horizon and lighting with no units in front of them. |
| `skirmish` | ◇ target-state | Both sides deployed, mixed unit types, three graves in three states, three painted surfaces. |
| `moverange` | ◇ target-state | One unit selected: the move set as ONE cyan contour (it stopped being a per-tile checkerboard in the telegraph wave — BAR R3), red attack set, gold selection ring. Paint is real; terrain is not. |
| `telegraph` | ◇ target-state | 🏹 BAR R3. Move contour plus the **path arrow** to a hovered destination. The destination is chosen so the route must DETOUR: (4,5) is three hexes from the mover and six steps by the only legal route. |
| `arc` | ◇ target-state | 🏹 BAR R2. The attack telegraph — a curve from attacker to target drawn *above* the board, arrowhead and ownership ring on the target. Not a straight laser. |
| `threat` | ◇ target-state | 🏹 BAR R2. Enemy reach as an orange painted region with a brighter outer edge, with the player's own cyan move contour sitting inside it — two questions, two colours. |
| `aitele` | ◇ target-state | 🏹 BAR R3, the **enemy** half. A foe crossing the field on a route that bends, drawn in RED (`tele.side:'foe'`) so it can never be confused with the player's cyan preview, plus a second foe's attack arc onto the player hero. In a match the host pushes this from `setAIActor` while the AI walks — see the note below on why it used to draw nothing. |
| `night` | ◇ target-state | `skirmish` under the night lighting rig. |
| `ruins` | ◇ target-state | Ruin art on event tiles. Doubly so — the battle stage is never sent events at all. |

Only `gamemap` answers *"does the game look like this?"*. The rest answer *"can the
board draw this?"* — a real and useful question, but a different one.

Two other things are target-state inside those scenes, and both are called out in the
file at the line that does it:

- **Unit heights.** `_bbUnitDefs` writes `h: 1.05` as a literal for every unit
  (`index.html:103514`) — a boss is exactly as tall as a dog. The 0.78–1.22 spread in
  the `ROSTER` is applied to target-state scenes only; `gamemap` gets a flat 1.05.
- **Framing.** The game sizes `#bb-stage-host` to `.board-area`'s rect
  (`_bbStageTrack`, `:104381`), and `VIEW.scale` fits the vertical FOV to the safe-box
  *height* — which EMBEDDED zeroes — so horizontal FOV falls out of the host's **aspect**
  (`CONTRACT.md` §1.6). `gamemap` mounts into the measured in-game rect (802×688 at a
  1600×900 viewport) with the surrounding HUD footprint outlined and labelled; the
  target-state scenes keep the full viewport, which is a bigger and lower-framed picture
  no match produces. `?host=boardarea` / `?host=full` overrides either way for an A/B.

Drop `&shot=1` to get the harness chrome (scene switcher with ◆/◇ markers on every chip,
plus a live board→host readout) and click around the board yourself.

---

## Why a harness and not just the board

`public/battle-board/index.html` opens fine on its own, but what you see is its
built-in demo, and that demo is **not framed like the game**. The stage checks
`EMBEDDED` and, when it is inside an iframe, zeroes `CONFIG.SAFE` and
`CONFIG.viewShiftY`; `VIEW.scale` fits the vertical FOV to the safe-box height, so the
standalone preview has a different zoom and a different horizon from the stage a
player actually sees (`CONTRACT.md` §1.6).

So `_harness.html` embeds the stage in an iframe exactly the way `_bbStageMount()`
does and drives it with the real `board:*` protocol. Every payload is built by a
function copied from `public/index.html` and named for its original:

| Harness function | Mirrors | Message |
|---|---|---|
| `bridgeInitPayload` | `_bbStagePayload` (`index.html:103833`) | `board:init` |
| `bridgeLocations` | `_bbLocations` (`:103300`) | `board:locations` + `board:location` |
| `bridgeDefs` | `_bbUnitDefs` (`:103363`) | `board:defs` |
| `bridgeUnitList` | `_bbStageUnitList` (`:103862`) | `board:units` |
| `bridgePaint` | `_bbStagePushPaint` (`:103885`) | `board:paint` |
| `bridgeTele` | `_bbStagePushTele` | `board:tele` |
| `bridgeTombs` | `_bbStagePushTombs` (`:103898`) | `board:tombs` |
| `bridgeSurfaces` | `_bbStagePushSurfaces` (`:104008`) | `board:surfaces` |
| `bridgeEvents` | `_bbEvents` (`:103646`) | `board:events` |
| `shippedMap` | `_bbMapFromEditor` (`:103208`) | the `map` inside `board:init` |
| `_bbGenTerrain` | `_bbGenTerrain` (byte-for-byte) | the tiles inside that `map` |

Line numbers drift when `public/index.html` is edited — re-grep the function name.

Plus `board:timeOfDay`, and `board:pointer` from a transparent catcher laid over the
iframe — the same forwarded-input path the game uses (`CONTRACT.md` §1.4), so a click
in the harness goes through `pickTile` and comes back as `board:tileClick` just as it
would in a match.

### Keys: forwarded, and now received

`BAR.md` requirement #2 is *"Camera: WASD moves it, Q/E turns it."* **The board has a free
camera.** `handleHostMessage` has both cases, the game sends both messages from
`_bbCamKeysBind` (`public/index.html`), and this rig sends the identical pair — an iframe
that never holds focus gets no `keydown` for the same reason it gets no mouse events
(`CONTRACT.md` §1.4), so forwarding is the only path that works in either place.

| message | payload | for |
|---|---|---|
| `board:key` | `{down, code, key, repeat}` | key EDGES. The board keeps the held set and integrates it in `update(dt)` against its own clock — `CONTRACT.md` §2 Tier 2's frame-rate-independence rule. It is also the only shape that carries **R** (reset the view), which is an edge and not an axis. |
| `board:camera` | `{dx, dz, yaw}` | resolved intent, re-sent every animation frame while a camera key is held, with `dt` already applied. `dz` is a delta along the board's **+Z**, i.e. toward the NEAR edge — S is positive, W is negative. |

⚠ The board reads the pulse as an intent **sign** and never accumulates it, so sending
both shapes does not drive the camera twice. Anything that integrates deltas on the
board's behalf **will** double-count, at whatever ratio the two clocks sit at, and it
looks like a tuning problem rather than a bug.

Controls: **WASD** pans in the camera plane (W pushes the view away along the ground at
any yaw), **Q/E** yaw around the board with acceleration and easing, **R** restores the
fit exactly. Pan is clamped to half the board's half-extent per axis. `prefers-reduced-
motion` collapses the velocity ramp to a snap so the view stops dead with the key.

For a deterministic capture, do not hold a key for a guessed number of milliseconds —
set the pose:

```js
__harness.cam().set(90, 0, 0)   // yaw 90°, no pan, no easing (the clamp still runs)
__harness.cam().get()           // { yawDeg, pan, vel, moving, reduced, terrainKey, … }
__harness.cam().check()         // { click:{samples,mismatch,rim,hard,offScreen,bad},
                                //   painter:{inversions}, terrain:{registered,bakeMs} }
```

⚠ **`click.mismatch` is no longer the assertion — `click.hard` is.** Since `PICK_EDGE_PX`
went in (`battle-board/index.html`, `slabTakesSample`) the pick deliberately hands the
≤1.5 px band inside a slab's BACK edges to the tile behind it, so `mismatch` is nonzero by
design and stays visible rather than being zeroed. It is split:

* `rim` — the drawn owner holds the pixel only inside its own back-edge rim (depth
  measured, and **bounded by `PICK_EDGE_PX`** — that bound is what stops the classifier
  excusing an arbitrarily wide rim), and the pick's answer really does contain the pixel.
  Expected.
* `hard` — everything else. **This is the one that must be 0.**

Board-wide the rim trade costs 5.64% of drawn ground pixels (10,392 / 184,215 rastered at
1 px, 802×688, default seed); `camCheck` only samples the 168 tile centres, so it surfaces
that as a handful. The invariant that must hold at every pose is that no drawn ground pixel
answers **nothing** — `__bbHexCheck().nullOverDrawn`, asserted 0 and folded into `ok`.

`__harness.state().camSent` counts `board:camera` posts that left the parent, and
`__harness.rects()` returns the newest `board:rects` payload as the HOST sees it — which is
how anchor staleness is measured from outside the iframe (compare it against the board's own
`Board.unitScreenBox(u)` on the same frame). Rects are published 4/sec at rest and **every
frame the camera re-aims**, so an anchored overlay tracks its unit to under a pixel while
the player turns; at 4/sec it was up to 107 px behind.

⚠ `g` and `1`–`4` are claimed by the board's *local* listener and are inert here for the
focus reason above — they are forwarded as `board:key`, but the board maps only WASD/QE/R
out of that message. Use `__harness.post('timeOfDay', {key:'night'})` for time of day.

Scenarios are written in **game** terms (`pos:{x,y}`, `owner:'player'|'ai'`,
tombstones keyed by `y`, surfaces keyed `"x,y"` by surface *type*). The rename to
board terms (`{x,z}`, `side`, shader key) happens only inside the bridge — which is
exactly where it happens in the game. Get this backwards and everything transposes
silently (`CONTRACT.md` §1.1).

---

## Readiness — why captures are not a guess

`waitMs` is a guess, and a guess is wrong in both directions. So the harness declares
`window.__harnessReady = false` before anything can throw, and flips it to `true` only
when **all three** hold:

1. the stage reported `board:ready`,
2. the scenario finished going out (including the awaited sprite slicing, so no unit
   can still be sitting on an empty def), and
3. one full second of real animation has elapsed — checked by wall clock **and** by
   counting `board:rects` messages, which the stage publishes from inside its own
   `frame()` loop at 4/sec. Receiving them is direct evidence the RAF loop is alive;
   a parent-side rAF count would prove nothing about the iframe.

The flag is declared as the **first statement in the harness IIFE**, before the roster
and scene tables are built, because its *presence* is the contract: a throw anywhere in
that construction would otherwise leave the global undefined and silently downgrade a
broken page to a fixed-delay capture.

`shot.mjs` probes for the *presence* of `window.__harnessReady` (1.5s), then waits up
to 30s for it to go true. Pages that publish nothing — the stage's own demo, the game
itself — fall back to the fixed `waitMs` exactly as before, so the CLI contract is
unchanged. Any page can opt in by publishing the same global.

If rAF genuinely never fires (the Browser-pane caveat in `CLAUDE.md`), the harness
gives up after 6s, flips ready anyway, and sets `window.__harnessDegraded` with the
reason; `shot.mjs` prints it as `ready (DEGRADED: …)`. **A degraded capture is a
picture of a frozen board — do not judge art from one.**

---

## Adding a scenario

One object in the `SCENES` table in `_harness.html`. Nothing else.

```js
SCENES.myscene = {
  shipped: false,                   // ◆ true only if the GAME can send this today
  desc: 'one line, shown in the chrome',
  timeOfDay: 'day',                 // dawn | day | dusk | night
  location: 'battlefield',          // battlefield | dark-forest
  map: ruinsMap('day', 'battlefield'),
  units: [ unit('warrior-hero', 'player', 3, 6), unit('zombie', 'ai', 3, 0) ],
  tombstones: [ { x:4, y:3, owner:'ai', lootable:true, looted:false, glowing:false } ],
  surfaces: { '2,3':'oil' },        // keys are GAME "x,y"; values are surface TYPE ids
  paint: null,                      // { move:[{x,y}], attack:[…], place:[…], swap:[…], sel:{x,y} }
  tele: null,                       // { path:[{x,y}…], dest:{x,y}, arc:{from,to,side}, threat:[{x,y}…] }
  events: []                        // { x, y, type, name, art, scale }
};
```

⚠ **A `tele` scene proves the board DRAWS a route; it cannot prove the route is the
one the unit walks.** The harness has no rules and no pathfinder, so `tele.path` is a
literal tile list (`bfsPath()` is a fixture mirror of the game's `getMovePath`, kept
honest about being one). The real claim — drawn route == walked route — is only
provable in the game, by patching `window.getMovePath` and comparing what the telegraph
pushed against what `moveUnit()` actually consumed. `getMovePath` is a top-level
function *declaration*, so it IS on `window` and both callers resolve through it; the
`const` movement helpers around it are not (`CLAUDE.md`, the globals trap).

⚠ **The ENEMY route has one extra trap, and it is an ordering trap.** `setAIActor()`
fires *after* `moveUnit()` has committed, so a `getMovePath()` call made from there
BFSes from the destination to itself and returns an empty array — an enemy that
teleports. The AI move site therefore computes the route **before** the commit and
carries it on `App.ui.aiMoveTrail.path`; `_bbStagePushTele()` prepends the pre-move tile
and sends `side:'foe'`. Two more things that were live bugs, kept here because they cost
real time: the enemy's arrow used to be rendered only into `.ai-trail`, a DOM-board glyph
that is `visibility:hidden` whenever the stage is on — correct data, invisible picture;
and the push has to leave `setAIActor` directly rather than wait for `_bbStageMount`'s
rAF tick, because an AI step only lives for `AI_DELAYS.move` (700 ms) and in this rig
that tick was measured **4.2 s** behind.

`shipped` has no default. A scene that forgets it is falsy — target-state — which is the
safe way round: the failure mode is "labelled a fixture when it was honest", never the
reverse. Use `shippedMap(timeOfDay, location)` for an as-shipped map and `ruinsMap(…)`
for a target-state one.

`unit(cardId, owner, x, y)` pulls art and colour from the `ROSTER` table above it. To
add a unit type, add a `ROSTER` row pointing at any of the repo's 768×768 5×5 sprite
sheets — the harness slices row 0 into five PNG data: URLs and sends them as
`def.frames`, which is the same payload shape the game sends for an Atelier sprite.
Without that, a cold headless browser has no IndexedDB sprites and every unit falls
through to the board's procedural jelly, which would mean critics grading a failure
mode instead of the board.

---

## Drive it live

`window.__harness` is the driver handle:

```js
__harness.scenes                              // ['gamemap','empty','skirmish',…]
__harness.shipped                             // true only for the as-shipped scene
__harness.post('timeOfDay', { key:'night' })  // any board:* message, real protocol
__harness.push()                              // re-send the whole scene
__harness.state()                             // { boardReady, rectsSeen, ready, degraded,
                                              //   shipped, hostMode, host:{w,h},
                                              //   heldKeys, camSent }
```

From Playwright, after waiting on `__harnessReady`:

```js
await page.mouse.click(800, 560);                 // → board:tileClick, via pickTile
await page.evaluate(() => window.__harness.post('focus', { x:3, z:4 }));
```

---

## Known caveats

- **`CONSOLE Failed to load resource: net::ERR_CONNECTION_RESET` is expected here.**
  It is `battle-board/index.html:8` asking Google Fonts for Cinzel/EB Garamond, and
  this sandbox has no outbound network. It appears identically on an untouched
  `/battle-board/index.html` capture, so it is not a harness regression — but *any
  other* error in the `ERRORS:` block is.
- **The in-battle stage is never sent events.** `_bbStagePayload` omits `events` and
  `_bbStageMount` never posts `board:events`, so event tiles do not appear during a
  match; only the full-screen board (`_bbMount` → `_bbSnapshot`) sends them. Scenes
  default to no events to match the battle stage; `ruins` opts in deliberately.
- **Only four tile props draw.** `drawProp` handles `barricade`/`crater`/`pylon`/
  `bones`; `house` and `wreck` are still advertised in the PORT BRIEF but became
  events, and a tile carrying one renders as bare ground with no warning.
- **The harness is not the game.** It has no rules, no turn loop and no HUD. Anything
  about the rail, the hand or the objective banner has to be captured from the app
  itself, against `baseline-app.png`. The dashed outlines in a `gamemap` capture are
  *rig annotations* marking where that furniture would be — they are hairlines with
  monospace caps labels precisely so they cannot be mistaken for the game's own chrome,
  which is an opaque gold-bordered panel (`CONTRACT.md` §6.4).
- **The camera bake is not free, and `bakeMs` alone is a LIAR.** `terrainKey()` names the
  camera, so every frame of a pan or a turn is a cache miss and the ground is drawn live
  instead of blitted (see `drawBoard`, which bypasses the cache entirely while
  `CAMERA.moving`). Measured in this rig's software rasteriser at `scene=gamemap`,
  `host=boardarea`, across the **cross product** of 12 yaws × 9 pans (108 poses):
  **~0 ms parked, worst 30.7 ms and median 24.2 ms of terrain bake at any pose**, with the
  painted skirt hard-capped at `SKIRT_BUDGET` (240) cells. Held live: 27.0 ms/frame for
  yaw alone (E), 17.2 for pan alone (W), 23.9 for E+W and 29.3 for E+D.
  ⚠ **Do not read a single `bakeMs` sample as work.** Chromium's 2D canvas records ops and
  flushes them lazily; once the recorded list crosses a threshold the flush lands *inside*
  the bake timer and the same pose reports 28 ms on one frame and 157 ms on the next. That
  bimodality — not a 5–8× change in work — is what an earlier round measured as a
  "pan×yaw cliff": swept against a pinned pose, 320 painted cells reported **171 ms** and
  300 reported **29 ms**, while the iframe's true rAF rate was **4.15 vs 4.33 fps**. Judge
  a camera change on `__bbPerf()` medians *plus* an actual frame count over a wall clock,
  and on `__bbCam.check().terrain.skirtPainted`, which counts the work rather than timing
  where the flush fell. There is no GPU here, so all of it is an upper bound.
  `window.__bbTerrSec(true)` splits the bake into apron / art / plan / sweep / field /
  skirt / tail if you need to know which painter grew; `window.__bbSkirtBudget(n)` re-runs
  the sweep that picked 240.


---

# 🟢 The adjacent question — and the negative control that catches it

Over two days, five separate defects in this repo shared one shape, and it is not
the shape anyone names when they talk about bad tests.

The obvious failure — *a check that did not run* — accounts for only two of the
five. A suite that throws at least looks like something: somebody eventually
notices the summary is shorter than it was. The other three **ran fine and
exited 0.** They answered a question one degree away from the question that
mattered, and a green answer to an adjacent question is indistinguishable from
correct right up until something downstream renders empty — at which point you
are debugging the renderer.

The five:

| what it reported | what it actually checked | what it should have checked |
|---|---|---|
| 138 day/night perf checks pass | nothing — the suite threw at `HF is not defined` inside its sandbox before asserting | that the sandbox and the real `terrainKeyParts` still agree |
| `_fx-engine-needs` / `_fx-gate-audit` green | that the command exited 0 — both ENOENT'd after the `D:` → `E:` move and read no file at all | that the file it claims to audit was opened |
| Cinder collects correctly | a code path nothing called | that the button the player presses reaches it |
| `const TRAP_MODES` is present | that the **text** appears in the file | that the **binding is reachable** from where it is read |
| the harness matches the generator byte for byte | a copy of the generator that ended early enough to omit every elemental surface | that the copy covers what the original covers |

The fourth is the sharpest. `TRAP_MODES` was written one line too early and
landed inside `getCardRange`'s body. Valid JavaScript. Both syntax gates green.
`grep 'const TRAP_MODES'` found it. And it was a function-local const that
ceased to exist the moment `getCardRange` returned, so the Forge's trap-mode
dropdown rendered with zero options — because the editor asks
`typeof TRAP_MODES !== 'undefined'` and got the honest answer. **A guard written
to survive load order silently absorbed a scoping bug.**

**A text search cannot tell you what scope something is in.** If reachability is
the property you care about, walk the AST and ask whether the declaration is a
top-level statement. `_trapmode_smoke.mjs` does this for `public/index.html`;
`.gauntlet/tabletop/scopecheck.mjs` does it for the board page and for `ley.js`
— where the right answer is *different*, because `ley.js` is an IIFE and a
symbol correctly nested inside it would fail a naive Program-top-level test.

## The defence, and it is cheap

**Break the check on purpose the day you write it, not the day you doubt it.**

Every suite whose passes depend on an instrument — a parser, a sandboxed copy, a
pixel diff, a DOM query — should run that instrument against an input whose
answer is already known, **first**, and fail if it comes back happy. Four lines:

```js
const probe = topLevelNames('const OUTER=1;\nfunction f(){ const INNER=2; }\n');
ok('control: the walker parses at all',        !!probe);
ok('control: it SEES a top-level const',        probe.has('OUTER'));
ok('control: it REFUSES a nested const',       !probe.has('INNER'),
   'the walker says yes to everything — every assertion below is meaningless');
```

Without those, a walker that returned every identifier in the file would print
forty-eight confident passes.

Three rules that fall out of this:

1. **"It passed on my tree" is not evidence.** One of the five shipped green on a
   different checkout and only failed here.
2. **Assert the durable property, not today's spelling.** A check pinned to a
   filename goes red when the product deliberately changes and green when the
   property quietly breaks. Both directions are wrong.
3. **A suite that reports nothing and a suite with nothing to report look
   identical.** Print the count of assertions actually executed, and gate on it —
   `_checkall`'s `minPasses` exists for exactly this and is the reason the 138
   missing day/night checks were findable at all.

## The sixth: when the instrument reports catastrophe

Added the same night, during the verification of the very release the section
above was written for.

To confirm the deploy, `curl` fetched `https://…/index.html` and grepped the
served page for the strings that matter. Every grep returned **0** — the vault
guard, `TRAP_MODES`, `BUILD_VERSION`, all of them. `curl` exited 0. The file it
wrote was zero bytes.

`/index.html` **307-redirects to `/`**, and `curl` without `-L` follows nothing,
writes an empty file, and reports success. The page was 10.3 MB and had been
correct the entire time.

Same root as the other five — a command that exited 0 and answered a question one
degree from the one that was meant. But this instance **inverts the danger**, and
that is why it gets its own heading:

> Every previous instance produced a *comfortable* wrong answer that you had to
> go looking for. This one produced a *terrifying* wrong answer that invited
> immediate action — and the obvious action, rolling back a release whose payload
> was a data-loss fix, would have been strictly worse than doing nothing.

**A false alarm demanding an emergency response is worse than a false all-clear.**
The all-clear costs you time. The alarm costs you the thing you just fixed.

So, narrowly and on its own:

**When an instrument reports catastrophe, check the instrument before you act on
the reading.** Two commands would have settled it — `curl -D-` to see the 307,
or `wc -c` on the file to see it was empty rather than wrong. Neither takes
longer than the first sentence of a rollback.

The corollary for this repo specifically: **always fetch `/` with `-L`**, never
`/index.html`, and treat a zero-byte body as a transport failure rather than as
evidence about content. An empty response is not a page that lost its contents;
it is a page you never received.

## The seventh, forty minutes after the sixth — and the asymmetry that links them

Verifying the same release, the same night.

`grep -c 'Profile.cloud._vaultSeen = _seen'` against the served page returns
**0**. The fix is present. `deploy.mjs` minifies `index.html`, so the served form
is `Profile.cloud&&(Profile.cloud._vaultSeen=_seen)` — no spaces — and the
reader ships as `+Profile.cloud._vaultSeen`. Likewise `_cloUnits * 0.10` ships as
`.1*_cloUnits`.

**An exact-string grep against a minified page answers a question about
formatting, not about behaviour.** Grep for string literals — they survive
verbatim — or for minifier-tolerant fragments. Never for a whole expression
containing spaces.

### The asymmetry, which matters more than either instance

The sixth instance (the zero-byte 307) and this one are the same failure from
opposite directions: one says *the fix is missing* when the transport broke, the
other says *the fix is missing* when only the whitespace moved.

But note what actually happened between them. The 307 produced a frightening
result, so it was investigated within seconds. This grep produced a result that
**agreed with what was expected**, so it was reported as confirmation — and the
label attached to it ("`Profile.cloud._vaultSeen = _seen` ×1") described a
stricter check than the one that had been run.

> An instrument gets checked when it disagrees with you and trusted when it
> agrees. That is exactly backwards from what makes it useful.

A green result from an instrument nobody audits is not evidence. It is the
absence of an alarm, which is the same thing every entry in this section has
turned out to be. **Audit the instrument on the pass, not only on the fail** —
and when reporting, quote the check you actually ran, not the one you meant to.

## The eighth, and a different shape: a document that does not run

Every entry above is an *instrument* answering a question one degree away from
the one that mattered. This one is not an instrument at all.

A feature handoff stated that `sql/132_handbook.sql` was **NOT APPLIED** and that
"nothing exists server-side yet". Live reality, checked: `handbook_doc` (0 rows),
`is_handbook_admin()`, four RLS policies and a public `handbook` storage bucket —
all present and working.

Acting on the document meant re-applying the migration. Postgres refused:

```
42P13  cannot change return type of existing function
```

The handoff's `handbook_publish` declared OUT params `(version, updated_at)`. The
**live** one returns `(ok, status, new_version)`, and the page destructures all
three by name. Had the types happened to match, the apply would have succeeded
and silently replaced a working RPC with one whose shape the page cannot read.

**The only thing that caught it was a guard nobody wrote for this purpose**, in a
different system, firing by accident.

### Why this one is worth its own heading

A green suite at least *ran*. A stale document does not run, cannot be re-run,
and gets more confident-looking with age — it is prose, and prose reads as
settled. Worse, the failure direction is inverted from the rest of the catalogue:
"nothing exists yet" invites you to **create**, and creating over live
infrastructure is destructive in a way that reading a wrong number never is.

> **A handoff's claim about live infrastructure is a hypothesis.** The only way
> to read it is against the infrastructure.

Three specifics for this repo:

1. **Before acting on any "not applied / not yet built / nothing exists" claim,
   check.** One query against `information_schema` or one `curl` is cheaper than
   the smallest recovery.
2. **Prefer a generator to a note.** The same handoff's element/faction/status
   tables were *generated* from index.html's constants, and re-running that
   generator 884 commits later produced byte-identical output — the generated
   half aged perfectly while the prose half rotted. That is not luck; it is the
   difference between a claim that is re-derived and a claim that is retyped.
3. **Trigger regeneration on the event, not on a clock.** A daily refresh runs
   when nothing changed and still leaves the artefact wrong for up to a day when
   something did. Generated content that depends on a source file should be
   rebuilt by the pipeline that ships that file.

## The ninth: a check that structurally cannot see the bug

`renderCardEditor` threw and the Forge card editor did not render at all. The
cause was a **comment**:

```js
`<!-- 🌐 GLOBAL RADIUS.
      The ENGINE reads `(eff.global === true) || ((eff.radius|0) >= 99)`
 -->`
```

An HTML comment **inside a JS template literal**. The backticks close the
template. Everything after is parsed as expressions, adjacency becomes call
syntax, and the error surfaces as the tell-tale
`(intermediate value)(intermediate value)… is not a function`.

**Prose inside a template literal is not prose. It is template.**

### Why this one gets its own heading

`_synckcheck` passed on it — **before and after**. The file stayed *syntactically
valid*: the template merely ended early and a new expression began. A syntax gate
cannot see a string boundary move. It is not an instrument pointed one degree
away from the question; it is an instrument **structurally incapable** of seeing
this class, sitting in exactly the position where you would expect it to be the
one that catches it.

And the failure mode is silent. `renderCardEditor` falls back to
`renderForgeCards()` for an unknown id, so the editor slot renders the card
**list**. A player gets a list where the editor should be. Any suite asking *is
something there* rather than *is the right thing there* calls it fine.

What caught it: a harness that **opens the editor for real** and insists on
finding **exactly one** `.card-editor`.

### The general rule

> **Never reproduce a delimiter inside the thing it delimits.**

This repo has now hit three variants:

| delimiter | inside | symptom |
|---|---|---|
| `*/` in a block comment | a block comment | comment ends early, prose renders under the UI |
| a backtick | a template literal | template ends early, parser reads calls |
| a CSS comment | a stripper's input | stripper desyncs, reads prose as code |

CLAUDE.md already warns about the first. It should be widened to all three —
the existing wording would not have saved this one, because nothing here was
quoting a comment marker.

### And a distinction worth keeping

Two suites went red behind this fix, and both were repaired rather than raised.
The `_forge-harness` one is the example to copy: it pins the on-play block's
`.editor-field` count, and its own note says the pin *"has to follow real
additions or it would fail on every new field forever."*

Before moving it, the delta was **measured**: the block went 65 → 66, and
`ed-onplay-global` was named as the single new id. Then 130 → 131, with the
reason written beside the note that demands one.

> **Updating a baseline and raising a baseline are not the same act.** One is
> re-deriving the number from the thing it describes. The other is making the
> red go away. They produce the same diff and they are opposites.

## The tenth: the same shape, applied to research instead of testing

Every entry above is a *check* answering a question one degree off. This one is
a **search**.

The task: does the battle screen have a Vanish/Void pile? The search: grep
`public/index.html` for `vanish zone`, `void-zone`, `voidZone`, `renderVoidZone`.
The result: nothing. The conclusion written into a commit message: *"nothing in
the entire battle screen ever read `side.void` — a whole zone of the game was
write-only."*

**It was false.** `public/src/battle/hud.js` already rendered the zone, on both
sides, in the 2×2 pile grid, with its own viewer and its own bridge — under the
name **`vanishCell`**, which none of those four search terms could reach.

A second Vanish Zone was then built. The owner saw four slots where there should
have been two.

> The search was sound and exhaustive **within its scope**. The scope was the bug.
> Grepping one file answers about that file — never about the program.

### Why it generalises further than the rest

This repo is `public/index.html` **and** `public/src/**`, and that split is
precisely where a one-file search goes wrong. The same shape shows up from the
other direction: the elevation ladder is written down in **four** places (the
generator, a byte-copy in the harness, re-hardcoded in `ley.js`, and a screenshot
fixture) — so a search that finds one copy and stops concludes it has found *the*
number.

Two rules:

1. **Before concluding a feature does not exist, search `public/src` as well as
   `public/index.html`** — and search for what the thing *does* (`void`, `banish`,
   the state field) as well as what you would have called it. A feature you did
   not name is a feature your grep cannot find.
2. **Before concluding a constant has one home, count the homes.** Finding one is
   not finding the only one.

### And the uncomfortable half

The fix was to **delete the new one**, not to keep both and hide one. A duplicate
that is merely hidden renders again the moment someone flips a display rule, and
the second implementation drifts from the first the first time either is edited.

Where the reader used to be there is now a signpost naming `hud.js`, because the
next person to look here must find the **answer**, not the absence that produced
the duplicate.
