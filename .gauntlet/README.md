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
__harness.cam().check()         // { click:{samples,mismatch}, painter:{inversions},
                                //   terrain:{registered,bakeMs} }
```

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
