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

**`check-streets-clock.mjs`** — `traffic.js` in node, no browser. It takes a
ctx and a clock and touches no DOM, so the bucket boundaries, a full lap of the
24-bucket ring, the save format and the migration cases run in a second instead
of in a twenty-minute capture. Run it before any browser round when the traffic
meter changed.

## 🔴 Four things that cost a debugging round each

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

## The seam this rides on

`window.__nc` (node-city's diagnostics seam, ~line 28903) exposes
`place`, `build.finishAll`, `camera`, `controls`, `three()`, `game.tiles`.
Nothing test-only was added to the shipped file — the harness drives the same
functions a player's click drives.

## Not committed

`.gauntlet/package/` (vendored three) and `.gauntlet/shots/` are gitignored —
one is 10 MB of third-party code, the other is regenerable.
