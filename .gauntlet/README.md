# The Gauntlet harness

Boots the real `public/node-city/index.html` in headless Chromium, builds a
fixed district through the **shipped placement path**, and photographs it.
This is how a critic sees actual output instead of a diff.

```bash
node .gauntlet/capture.mjs .gauntlet/shots/rN --tag rN
```

Produces `rN-aerial.png`, `rN-street.png`, `rN-district.png` at 1600×900 and
prints JSON with the scene bounding box, mesh/triangle counts and the last
console lines.

## Why each piece exists

**`shot.mjs`** — single framed screenshot, `--wait/--w/--h/--eval`. Use for a
one-off look at a specific thing.

**`capture.mjs`** — the three-shot round capture. One browser boot (~25 s) for
all three. Camera framings are **derived from the bounding box of the placed
meshes**, because `placeMeshAt` owns the tile→world mapping and hardcoded
coords pointed at empty ground.

**`scene.js`** — the standard district, run inside the page. Deterministic:
fixed tile list, and `makeHousing` seeds its archetype off the tile coords, so
an A/B between rounds compares **renders, not layouts**.

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

## The per-framing diff gate

```bash
node .gauntlet/capture.mjs .gauntlet/shots/rN --tag rN --against .gauntlet/shots/rN-1
```

Reports what fraction of pixels each framing changed against the previous round,
and warns when one framing moved less than a quarter as much as the best one.

It exists because round 5's ground work **never reached the street frame** — 4%
changed there against 48.9% in the aerial — and nobody noticed until a critic
diffed it by hand two rounds later. The round-5 critic's first recommendation
was this gate, and it costs nothing: the two PNGs are decoded through the page
that is already open.

⚠ The images are served over the harness's own loopback HTTP, not as `data:`
URIs. The first cut used data URIs, the catch-all route aborted them, and a bare
`catch { null }` reported that as "no diff" — a silent fallback inside the tool
built to stop silent fallbacks. A failed diff now reports its reason.
