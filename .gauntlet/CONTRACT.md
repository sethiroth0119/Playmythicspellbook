# Mythic Spellbook — Battle Board CONTRACT BRIEF

**Audience:** builders who have never opened this repo.
**Scope:** the battle board only — hex conversion, larger maps, free camera, lootable map
structures, control-point objectives, and the HUD that shows them.
**Date:** 2026-08-20. Every `file:line` below was read, not guessed. Line numbers drift when
`public/index.html` is edited — re-grep the quoted source text if a number misses.

> Two hard rules from `CLAUDE.md` that this brief does not repeat but does not override:
> no image/video upload, no Discord integration. And: **do not modify battle, card, or
> economy code** — §3 exists precisely to give you seams that obey that rule.

---

## 0. The five files you will touch

| File | What it is | Size |
|---|---|---|
| `public/index.html` | The whole legacy game. One inline classic `<script>` opens at **:36930** and never closes before **:72000**. Game state, reducers, DOM board, HUD, loot, turn loop. | ~215k lines / 11.6 MB |
| `public/battle-board/index.html` | The 3D canvas stage, loaded in an **iframe**. Self-contained, no libraries. `window.BB_BUILD='v119k4'` at **:203**; the entire engine is one `<script>` from **:203** to **:2949**. | 2950 lines / 156 KB |
| `public/src/battle/*.js` | `combat.js`, `targeting.js`, `fit.js`, `draw.js`, `activate.js`. Loaded as **classic deferred scripts** at `index.html:223116-223144` — *not* ES modules. | small |
| `public/src/battle/*.css` | `board.css`, `units.css`, `chrome.css`, `alive.css`, `draw.css`. Loaded at `index.html:223112+`, `chrome.css` last (wins by source order). | small |
| `public/version.txt`, `window.BUILD_VERSION`, `sw.js` `CACHE_VERSION`, and the per-file `?v=` query strings | The deploy knobs. All must move together. | — |

### The globals trap — and where it does NOT apply
`CLAUDE.md` warns that `Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level `const` in
`index.html` and therefore invisible to ES modules. **That warning does not apply to
`public/src/battle/*.js`**, because those are classic scripts, not modules: a top-level
`const` in one classic script lands in the shared global *lexical* environment that every
other classic script observes. Proof in-tree: `src/battle/targeting.js:341` reads bare
`BOARD_W`, `:373` reads `BOARD_H`, `:286-287` reads `App.state`.

**Consequence, and it is a trap of its own:** if anyone ever converts a `src/battle/*.js`
file to `type="module"` to "match the src/community pattern", `targeting.js:341/373`
silently fall through to a CSS-derived fallback and then to the literals `8` and `7`. No
error. Wrong coordinates forever. **Do not convert `src/battle/*` to modules.**

---

## 1. The two-layer architecture and the exact postMessage protocol

```
┌─────────────────────────────────────────────────────────────────┐
│ public/index.html  — GAME LOGIC (authoritative)                  │
│   state.board[y][x], state.units[].pos {x,y}, state.tombstones   │
│   reducers: startTurn / endPlayerTurn / endAITurn                │
│   DOM board renderer: renderBoard()      index.html:141513       │
│   3D bridge:          _bbStagePost()     index.html:103820       │
└───────────────┬──────────────────────────────────┬──────────────┘
                │ postMessage {type:'board:*'}     │ postMessage {type:'board:*'}
                ▼ (down: state → pixels)           ▲ (up: pixels → intent)
┌─────────────────────────────────────────────────────────────────┐
│ public/battle-board/index.html — CANVAS-2D PERSPECTIVE STAGE     │
│   MAP {cols,rows,tiles[]}, units[], TOMBS[], SURFACES{}, PAINT{} │
│   hand-rolled pinhole projector: gw() → project() → pickTile()   │
│   renders. Owns NO game rules.                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Division of authority (non-negotiable):** the board is a *renderer*. It has no
pathfinding, no adjacency, no win condition. `moveUnit` in the board
(`battle-board/index.html:518`) tweens straight to the target and only checks
`tileBlocked`/`unitAt`. All rules live in `public/index.html`.

### 1.1 Coordinate naming
The game uses `{x, y}`; the board uses `{x, z}` (y is up in 3D). **`game.y === board.z`.**
The rename happens at the bridge, e.g. `_bbStagePushTombs` at `index.html:103890` emits
`z: t.y|0`. Get this backwards and everything silently transposes.

### 1.2 Downstream (host → board). Handler: `handleHostMessage`, `battle-board/index.html:2812-2907`
A flat if/else chain on `msg.type.slice(6)`, whole body in a try/catch that only
`console.warn`s (**:2906**). Listener at **:2909** — **no origin check**; `HOST.origin='*'`
at **:2737**.

| type | payload | effect | line |
|---|---|---|---|
| `init` | `{map, locations, location, timeOfDay, defs, units, events, safe}` | applies safe box, merges locations (keepDefault), `Object.assign(MAP, msg.map)`, `buildStage()`, `applyDefs`, instant `loadLocation`, sets `LIGHT` with **no lerp**, `applyUnits`, `setEvents`, `resize` | 2815-2831 |
| `map` | `{map, events?}` | `Object.assign(MAP, msg.map)` + `buildStage()` + `resize` | 2836 |
| `events` | `{events}` | whole-list replace | 2837 |
| `defs` | `{defs}` | `applyDefs` — **mutates `UNIT_DEFS` entries in place** | 2838 |
| `units` | `{units}` | full snapshot reconcile; anything absent is killed | 2839 |
| `surfaces` | `{tiles:{'x,z':effectKey}}` | whole-map replace | 2848 |
| `locations` | `{locations}` | merge, keepDefault | 2849 |
| `location` | `{id, instant}` | play a location | 2850 |
| `timeOfDay` | `{key}` | 2.5s lerp | 2851 |
| `spawn` | `{key,x,z,side,id}` | spawn, then overwrite `u.id` | 2852 |
| `summon` | `{key,x,z,id,side,cost}` | full card-fly ceremony | 2853 |
| `summonFx` | `{id}` | cosmetic arrival replay only | 2854 |
| `tombs` | `{list:[{x,z,img,owner,glowing,lootable,looted}]}` | clears + refills `TOMBS`, warms textures | 2857-2861 |
| `move` / `attack` / `kill` | `{id,x,z}` / `{id,targetId}` / `{id}` | animate | 2862-2864 |
| `focus` / `clearFocus` | `{x,z}` / — | focus ring | 2865-2866 |
| `paint` | `{move[],attack[],place[],swap[],sel}` arrays of `"x,z"` | rebuilds the four highlight Sets | 2870-2876 |
| `pointer` | `{kind:'click'|other, nx, ny}` normalised 0..1 | **the forwarded-input path** — see 1.4 | 2878-2894 |
| `event` | `{action:'spawn'|'trigger'|'clear', evType\|evtType, x, z, unitId}` | note: reads `evType`/`evtType`, **not** `type` (that's the envelope) | 2895-2899 |

Host side: `_bbStagePost(type, obj)` at `index.html:103820-103824` posts
`{type:'board:'+type, ...obj}` same-origin. Payload builder `_bbStagePayload()` at
**:103815**.

### 1.3 Upstream (board → host). `post()` at `battle-board/index.html:2738-2741`
`post()` is a **no-op unless EMBEDDED** (**:2739**).

- `board:ready {cols, rows}` — once at boot, **:2937**
- `board:rects {rects:{[unitId]:{left,top,width,height}}, tiles:{'x,z':{cx,cy}}}` — **:2576**,
  EMBEDDED only, **throttled to 4/sec** via `window.__rectsAt` (**:2557-2559**)
- mirrored DOM dispatches (**:2743-2745**): `board:tileClick {x,z[,unitId]}`,
  `board:unitClick {id}`, `board:tileHover {x,z,unitId,box}` (x/z are `-1` off-board),
  `board:cardPlayed {cardId,x,z}`, `board:summonComplete {cardId,unitId,x,z}`,
  `board:locationChange {location,name}`, `board:timeOfDay {key}`

**NOT mirrored to the host** (they fire as DOM CustomEvents only, reachable via
`Board.on()` in the same document, invisible across the iframe):
`unitMove` (**:525**), `unitAttack` (**:541**), `unitDeath` (**:547**),
`eventSpawn` (**:1152**), `eventTrigger` (**:1163**), `eventClear` (**:1171**).
If you need one host-side, add it to the mirror array at **:2743** — and know that this
changes the outbound surface for any existing listener.

### 1.4 Input: two paths, one funnel
When EMBEDDED the stage paints **below** the app so the HUD stays on top, so the canvas
cannot receive its own mouse events (comment at `battle-board/index.html:2877-2880`). The
host captures pointer events and forwards normalised coords via `board:pointer`. Keyboard
has the same problem: an iframe that never holds focus gets no `keydown`.

Both the local listeners (**:2618-2632**) and the forwarded path (**:2880**) funnel into
`pickTile()`. Host-side the 3D board forwards into the *same two functions* the DOM board
uses: `index.html:104107-104108` and `:104123` call
`onTileClick(d.x|0, d.z|0)` / `onUnitClick(id)`.

**The single click funnel, for both renderers:**
- `function onTileClick(x, y)` — `index.html:143657`. Two integers. No tile object.
- `function onUnitClick(unitId)` — `index.html:143540`. Delegates to
  `onTileClick(target.pos.x, target.pos.y)` at **:143556**.
- DOM binding, re-bound every render, `index.html:143223-143228`:
  `el.onclick = () => onTileClick(parseInt(el.dataset.x,10), parseInt(el.dataset.y,10))`.

### 1.5 The public board API — port 1:1, do not change signatures
`window.Board` at `battle-board/index.html:2664-2672`:
```
buildStage, spawnUnit(defKey,gx,gz,side), summonUnit(cardId,gx,gz,opts),
moveUnit(id,gx,gz), attackUnit(id,targetId), killUnit(id), setTimeOfDay(key),
setLocation(id,instant), setPylonArt(src,opts), focusTile(x,z), clearFocus(),
tileAt(x,z), spawnEvent, setEvents, triggerEvent, clearEvent, eventsAt,
unitScreenBox(u), get eventTypes/locations/map/units/paint, on(evt,fn)
```
The PORT BRIEF comment at `battle-board/index.html:14-123` declares these frozen
(**:110-122**: "KEEP THESE FUNCTIONS — port them 1:1").

`unitScreenBox(u)` (**:1902-1911**) returns `{left,top,width,height}` in CSS px inside the
iframe, `width = height*0.8` hardcoded. **Every host-side VFX and cinematic anchors off
this**, via the throttled `board:rects` publish.

### 1.6 The projection triad — the contract that must move in lockstep
```
gw(gx,gz,y)   battle-board/index.html:469-471   grid → world.   Called ~40×.
project(p)    battle-board/index.html:461-467   world → screen. Called by every draw fn.
pickTile(x,y) battle-board/index.html:2602-2617 screen → grid.  MUST be exact inverse.
```
`project` returns `{x, y, z, s}` where **`s` = pixels-per-world-unit at that depth** — used
as a universal scale factor throughout. There is a near clip (`z <= 0.05 → null`,
**:464**) and **no far clip, no matrix**. ~40 callers respond to `null` with a bare
`continue`/`return`, so off-camera geometry **vanishes silently**.

`VIEW.scale` (**:441**) fits the **vertical FOV to the SAFE-BOX HEIGHT, not the window** —
so horizontal FOV varies with the safe-box aspect, and any change to `SAFE` or the window
silently rescales the whole board. EMBEDDED mode zeroes `CONFIG.SAFE` and `viewShiftY`
(**:2917-2920**), so **framing tuned in the standalone preview differs inside the game.**

---

## 2. Square-grid assumptions, ranked by risk

Two independent lattices exist and both must be converted, or they will disagree:

- **Board (canvas):** `MAP.cols/rows`, `gw`, `tilePoly`, `pickTile`.
- **Game (logic + DOM):** `BOARD_W=8, BOARD_H=7` at `index.html:71892`; `board[y][x]`;
  Chebyshev `distance()`; a **hardcoded CSS grid**.

### Tier 0 — silent wrong-answer bugs (fix first, together, in one commit)

**0.1 `gw` ↔ `pickTile` must change together.**
`gw` (`battle-board:469-471`) is a rectangular lattice with uniform pitch `CONFIG.tile`.
`pickTile` (**:2613-2616**) is its analytic inverse:
`gx = round(wx/tile + (cols-1)/2)`. Change one without the other and clicks keep
"working" while addressing the wrong tile. **There is no assertion tying them.**
- Hex `gw` (pointy-top, offset rows):
  `x = (gx + (gz&1)*0.5 - (cols-1)/2) * hexW`, `z = (gz - (rows-1)/2) * hexV`,
  `hexW = size*sqrt(3)`, `hexV = size*1.5`.
- Hex `pickTile`: world→axial (`q = (sqrt(3)/3*wx - wz/3)/size`, `r = (2/3*wz)/size`),
  **cube rounding**, then back to the same offset scheme `gw` uses, then re-derive the
  bounds test at **:2616** for staggered rows.

**0.2 The metric is duplicated ~80 times inline.**
Canonical `distance` at `index.html:74070` is Chebyshev
(`Math.max(abs(dx), abs(dy))`). ~26 sites call it; **~80 more inline the identical
expression and never call it.** Changing `distance()` alone changes almost nothing — the
UI highlight and the click gate then disagree. The codebase already carries a scar comment
about exactly this class of bug at `index.html:141543-141550` ("the UI-lies-about-the-rules
bug"). Manhattan appears exactly once and only cosmetically
(`index.html:74100`, a ring-scan order inside `clampUnitsToBoard`).

**0.3 `inBounds` is bypassed by five hand-rolled copies.**
`inBounds(x,y)` at `index.html:74071` is the sole *definition* of "is this a real tile", but
`index.html:141619, 201072, 99726, 133804, 213764` re-implement `x<0||y<0||x>=BOARD_W||...`.
Redefining the playable region via `inBounds` alone leaves those five accepting or
rejecting the wrong tiles.

**0.4 CSS is a second, unlinked source of truth.**
`index.html:11219` `grid-template-columns: repeat(8, 1fr)`, `:11278`
`grid-template-rows: repeat(7, 1fr)`, plus an `aspect-ratio: 8/7` lock and a width budget
derived from it (**:11245-11290**). Tiles are `aspect-ratio: 1`. Extra `.board` rules in
`src/battle/board.css:46` and `:210`. **Changing `BOARD_W`/`BOARD_H` alone does not reflow
the DOM board** — tile count and track count disagree, tiles wrap to wrong rows, and
`targeting.js`'s index-modulo fallback (`targeting.js:351-362`) computes wrong coordinates.

### Tier 1 — visible geometry breakage

**1.1 `tilePoly`** (`battle-board:923-928`) builds an axis-aligned square from
`h = CONFIG.tile/2 - inset` at `(±h,±h)`. Replace with 6 vertices at `i*PI/3` (+`PI/6` for
pointy-top), radius `size - inset`. **Reinterpret `inset` as radial, not edge.**
`pathPoly(P)` at **:929** is already generic over N points, so only `tilePoly` is 4-gon
specific.

**1.2 `_sQuad`** (`battle-board:2251-2258`), the surface-FX clip polygon, offsets **grid**
coords by ±0.5 — meaningless on a hex lattice. Must build the same hexagon `tilePoly` does.

**1.3 `drawSurfaceFx`** (**:2497-2503**) averages **exactly four** vertices for `cx/cy` and
derives `r` from `|q1.x-q0.x|` / `|q2.x-q3.x|` in a known winding. Generalise:
`centre = project(gw(gx,gz))`, `r = size * p.s`. Most of the 17 `SURFACE_2D` painters
(**:2262-2470**) only consume `(cx, cy, r)` and follow for free; `web` (**:2323**) already
iterates `for (const p2 of q)`; `fire` (**:2269**) and `gas` (**:2333**) `fillRect` an
r-box and stay correctly clipped.

**1.4 Raised-tile side walls** (**:1010-1019**) draw 3 quads from fixed index pairs
`[[2,3],[1,2],[3,0]]` — the front/left/right faces of a cube. For a hexagon, pick
front-facing edges by projected outward normal, or draw all 6 back-to-front.

**1.5 The "world-X offset" radius idiom — 7+ sites.** Every ground circle takes its pixel
radius as `|screen.x(P + Δ·worldX) - screen.x(P)|`:
`drawRune :1039` (.34), `drawEvent :1180` (.40), `drawUnit ring :2014` (.42),
`drawTomb :1922` (.38), `drawEffects rune :2039` (.44), `pillar :2052` (.42),
`drawEffects ring :2029` (world r0/r1), plus `drawPylon :1421/:1470/:1477` and
`shadowEllipse :1721-1723`. All constants are "a bit under half a tile" for `tile===1`.
On hex, inradius (`size*√3/2`) and circumradius (`size`) differ — express them as fractions
of one, not as literals. **Under camera yaw these radii shrink continuously toward zero
with no error** (see §2 Tier 2).

**1.6 Board extent as ±cols/2, ±rows/2** — six sites: `drawGroundSlices :374/:379`,
apron quad **:936-939**, ground-art clip **:954-955**, `drawFrame :1065`,
`seedBraziers :1610`, `drawBackdrop` far anchor **:866**. Hex extent is
`cols*hexW + hexW/2` wide by `rows*hexV + size/2` deep. **Introduce one `boardExtent()`
helper and route all six through it** — the larger-map work needs it too.

**1.7 The checkerboard class** `'even'` when `(x+y)%2===0` (`index.html:141691`) is a pure
square artifact.

### Tier 2 — breaks only under a free camera (build the camera and these are yours)

There are **no camera controls today**. `CONFIG.camera` (`battle-board:209`) is never
mutated at runtime; `buildCam()` (**:454-460**) is called from exactly one place,
`buildStage()` (**:491**). `CAM.pos` is a **live reference** to `CONFIG.camera.pos` but
`CAM.f/r/u` are **snapshots** — mutating `pos` slides the eye *without re-aiming*.
Clean shape: `CAMERA = {focus:{x,z}, yaw, pitch, dist}` → derive `pos`/`target` each frame
→ call `buildCam()` at the top of `frame()` (**:2516**).

Already general, no change: `project`, `pickTile`, `unitScreenBox`, all billboards.

Breaks under **yaw**:
1. The world-X radius idiom (1.5 above) — circles deflate to nothing at 90°. Fix: offset
   along `CAM.r`, or just `R = Δ * p.s`.
2. Painter's-algorithm sort (**:2540-2551**) sorts by world/grid `z` ascending. Must become
   `dot(worldPos - CAM.pos, CAM.f)`. Tile loop **:974-975** likewise per yaw quadrant.
3. `drawGroundSlices` (**:373-390**) integrates the ground texture in **constant-world-Z**
   bands blitted to axis-aligned rects. Shears under yaw; falls apart at 90°.
4. Sky/backdrop are **screen-anchored by deliberate past decision** (see the comment at
   **:736-739**): sun/moon pinned to `VIEW.cx`/`VIEW.box` (**:740-743**), backdrop covers
   the viewport (**:860-877**), 26 procedural ruins laid out from the horizon line
   (**:837-850**). Nothing parallaxes — the sky appears nailed to the camera.
5. `u.face` (±1 in world X, **:508/:520**) applied as a horizontal mirror at **:1994**.
   Should be `sign(dot(facingVec, CAM.r))`. Note: the **player's** units are mirrored by
   default (`face = side==='foe' ? 1 : -1`), the enemy's are not.
6. The pylon `_spr` sprite-space anchor (**:1361-1375**) and the HOLO beam that reads it
   (**:1500-1508**). Its comment documents that these anchors were moved *out* of world
   space precisely because billboard space and world space disagree at this framing. A
   rotating camera makes the disagreement dynamic.

Breaks under **pitch** (yaw is fine): the ~11 hardcoded `ctx.scale(1, k)` ground-ellipse
squashes, `k ∈ {.34,.40,.42,.44,.46}` — `drawRune :1043`, `drawEvent :1187`,
`drawUnit foe pool :1973`, `selection ring :2016`, `drawTomb :1925`,
`drawEffects ring :2034` / `rune :2042`, `drawPylon bowl :1418`,
`drawHoloBeam :1544`, `drawParticles :2103`, `shadowEllipse :1722`. **None is derived from
the camera.** Derive one `groundSquash()` from pitch and route them all through it.

**Pan must be clamped** to `boardExtent() + margin`: crossing the near clip makes geometry
return `null` and vanish silently.

**Embedding:** a free camera needs an inbound `board:camera {dx,dz,yaw}` case (the if/else
chain at **:2814-2907** makes it a one-liner) *plus* host-forwarded keys, in addition to
the local listener for the standalone preview. Only `g/G` and `1-4` are claimed
(**:2634-2639**); WASD/QE are free. **Integrate held-key state in `update(dt)` (:2139), not
on keydown**, for frame-rate independence.

**Host desync:** `board:rects` is throttled to 4/sec (**:2557-2559**). While the camera
moves, host overlays lag by up to 250 ms. Publish every frame while in motion, or send a
"camera moving" flag so the host suppresses anchored overlays.

### Tier 3 — larger maps

- **Blocker: the camera is fixed.** A larger board projects larger and runs off screen or
  behind the near plane. Either derive `CONFIG.camera.pos` distance from `boardExtent()` in
  `buildStage()` (**:491**), or ship the free camera.
- **Perf 1:** `tileAt(x,z)` (**:472**) is an **O(n) linear scan** with no index, called from
  `tileElev`/`tileBlocked` per tile per frame (`drawBoard :976/:1010`, `drawRune :1038`,
  `_sQuad :2252`, rects publish **:2571**, `drawEvent :1176`, `drawUnit :1959`,
  `drawTomb :1914`). ~500 finds/frame at 8×7; **~640k/frame at 40×40**. Build a `Map` keyed
  `"x,z"` in `buildStage()`.
- **Perf 2:** the tile loop (**:976-1033**) is ~12 canvas path ops/tile and `drawRune`
  (**:1037-1062**) adds ~15 more — **no culling, no LOD**. Add a visible-rect cull (unproject
  the viewport corners with the `pickTile` math) and skip runes/grid lines below N px.
- **Perf 3:** `drawGroundSlices` uses a fixed **N=150** depth bands with a `+1.2` px seam
  fudge (**:384**) tuned for a 7-deep board. Scale N with projected depth.
- **Perf 4:** the rects publish (**:2565-2578**) loops **every** tile 4×/sec and
  structured-clones the whole map. 1600 entries at 40×40. Cull to visible, or make it
  request/response.
- **Hardcoded arena size:** 70 ambient motes seeded `rnd(-5,5)`x / `rnd(-4,4)`z
  (**:640-643**, recycled **:2205**); SHARDS at `±rnd(4.4,7.4)` x, `rnd(-5,3.4)` z
  (**:904-907**) meant to float *outside* the arena — they land inside any board wider
  than ~9.
- **Scenery:** four corner braziers (`seedBraziers :1608-1614`, `pylonClearance :1604`) and
  `HOLO.inset = 0.34` (**:1478/:1502**) aim each beam at 34% of the way from centre to its
  corner. Reads right at 8×7, increasingly wrong as the board grows.
- **Needs no change:** `cols/rows` already flow from the host, `pickTile` bounds
  (**:2616**), the tile loops, `post('ready',{cols,rows})` (**:2937**).
- **Watch:** `Object.assign(MAP, msg.map)` at **:2818/:2836** **MERGES**. A `board:map`
  omitting `tiles` or `events` silently keeps the previous board's contents — a larger map
  pushed without a full `tiles` array inherits the old board's props at now-out-of-range
  coordinates.

### Tier 4 — deep structural assumptions to decide about, not silently inherit
- **Two opposing edge rows.** Player hero at `{x: floor(BOARD_W/2)-1, y: BOARD_H-1}` =
  (3,6), `index.html:97522`. AI hero at `{x: floor(BOARD_W/2), y: 0}` = (4,0),
  **:97542-97543**. This drives `laneDepth`'s facing rule (**:99721**,
  `dy = owner==='player' ? -1 : 1`, the single directional effect in the game) and the
  `.unit[data-y]` 2.5D depth CSS that scales sprites by row.
- **MP mirroring** assumes point symmetry about the centre and hardcodes `BOARD_W-1` /
  `BOARD_H-1` at `index.html:179404, 179452, 179456`, while the board array itself is
  mirrored using *derived* W/H at **:179432-179434**.
- **A dimension-agnostic path already exists and is the model to copy:** `_boardDims(state)`
  at `index.html:74862` derives W/H from `state.board.length` / `state.board[0].length`.
  The whole surface subsystem uses it (`:74880, 74893, 74916, 74940, 75015, 75072, 75081,
  75103, 88272`). **Prefer `_boardDims` over the constants in all new code.**
- **Stale fallback constants** encode wrong sizes: `index.html:133797` uses `_H : 8` (real
  is 7), **:74524** uses `BOARD_W : 10`, **:213562/213756** use `W : 9`.

### What hex does NOT require
`project` (**:461**), `buildCam` (**:454**), all billboards, the `"x,z"` key format for
PAINT/SURFACES/rects, and `moveUnit` (**:518**) — the board has no pathfinding, so hex
**adjacency is entirely the host's problem**. `MAP.cols/rows` keep working as "cells per
row" / "number of rows" for an offset-hex rectangle and `board:init`/`board:map` need no
protocol change — **but the host and board must agree on odd-r vs even-r**, or every
`"x,z"` key silently addresses the wrong cell.

---

## 3. The seams — where new work plugs in without touching combat/card/economy

Six seams. Every one of them is an existing, load-bearing pattern; none requires editing a
damage formula, a card definition, or a price.

### Seam A — per-turn tick: `_twTickGameMode(state, who)`
`index.html:213716`, sole call site `index.html:101206`:
```js
try { if (typeof _twTickGameMode === 'function') _twTickGameMode(s, who); }
catch (e) { console.warn('[TW gameMode tick]', e); }
```
Inside `startTurn`, in a flat run of guarded hook lines (**:101189-101215**) that also
holds `tickTombstones`, `_tickTunneledCards`, `_tickVanishReturn`, `_tickNegateField`,
`_tickCostCuts`, `_tickProtection`, `_stabilizeTickBleeding`, `_smokeTickClouds`,
`tickSurfaces`. Runs **once per side per turn with `who` in hand.**
**It mutates state in place and returns nothing.**

### Seam B — victory evaluator: `_twEvalObjectives(state)`
`index.html:213441` (comment at **:213439-213440**). Returns `'win' | 'loss' | null`.
Called from the render at `index.html:134062-134067`, guarded
`!s.gameOver && !App.replayViewing && App.battlePrep && App.battlePrep.territoryWarsAttack`,
and stamps `s.gameOver` + a log line. Adding a `case` to its switch (**:213458-213513**) is
a **purely additive** edit. Objective ids come from `TW_NODE_OBJECTIVES`
(**:213398-213430**) and parse `kind:param` via `_twParseObjective` (**:213432**).

### Seam C — HUD rail mount point
`index.html:134196` opens `<div class="bc-rail bchrome">`; **:134197** is
`${twObjectiveBanner}` — already the rail's first element. Mount a new
`_bcObjectiveTracker(s)` builder immediately after it, or inside `_bcPanel`
(**:141001-141105**) after the `.envrow` block at **:141051** to group it with
LOCATION/WEATHER. The class `.tw-objective-banner` is **already styled and already has its
narrow-rail rule** (`index.html:7016-7018`, `flex: 1 1 100%`) but is **never emitted by any
JS** — it is a free, pre-wired class name.

### Seam D — in-board markers
Tile classes are pushed in `renderBoard` at `index.html:141724-141734`
(`tw-convoy-exit`, `tw-oil-tower`, `tw-oil-done`, `tw-oil-active`); marker DOM is built at
**:141929-141936** (`.tile-marker.tw-oil-marker` > `.tw-oil-icon`, `.tw-oil-count`,
`.tw-oil-bar > .tw-oil-fill{width:%}`, `.tw-oil-tier`) and **:141944-141948**. Their CSS is
**inline in index.html at :12203-12266**, not in `src/battle/*.css`.

### Seam E — unit hover-menu action row
`_hoverButtonsFor(u, s)` at `index.html:70413`; the Loot row is pushed at **:70522-70525**.
Rows render as `<button class="uhm-act" data-uhm-act="<act>">` at **:70723**. One delegated
click listener at **:70286-70306** reads the attribute and calls
`_dispatchHoverAction(act, uid)` (**:70748-70796**); number keys 1-9 do the same at
**:70310-70326**. Adding an action = one `btns.push` + one `case`.

### Seam F — the 3D stage push
`_bbStagePushTombs()` at `index.html:103880-103896` is the template for any new positioned
overlay: read the array, resolve images, **drop `blob:` URLs** (**:103888**, they cannot
cross into the iframe), JSON-diff the whole list against a key on `_BBS`, and post only on
change. Called from `_bbStageMount` on the slow tick (**:104079**) and on `board:ready`
(**:104149**).

### Explicitly NOT seams
Do not add turn logic to `endPlayerTurn` (**:101817**) or `endAITurn` (**:101831**) —
`startTurn` is the only place both sides pass through symmetrically. Do not put scoring in
the click path: `checkPostAction` (**:149316**) early-returns twice before its gameOver
check (**:149322** targeting pending, **:149332** self-sacrifice).

---

## 4. Loot-reuse recipe — a map structure with identical tombstone interaction

### 4.1 The good news
`_lootGridOpen(got, ctx)` at `index.html:77406` is **already fully generic**. Signature:
- `got` = flat `{ [resourceId: string]: integerQty }`. Nothing else on it is read.
- `ctx` = `{ tombName?, unitName? }`, used for **exactly two cosmetic strings**: the modal
  `<h2>` at **:77424** and the subtitle at **:77425**.

No id, no unit, no tile, no state is passed in. A structure can call it unchanged.

Similarly reusable **verbatim, pure functions**:
`_looterRarityBoost(base, looter)` **:77190**, `_biasSalvage(map, key)` **:77250**,
`_applyEventLootMods(map)` **:83021**, `_meta(id)` **:39579** (unknown resource ids degrade
gracefully to `{name:id, icon:'📦'}` and slot 1, so structure-only resources are safe).
`_rollLootCard(t)` **:77108** and `_rollLootItem(t)` **:77149** take a plain
`{rarity, level, isBoss, name}` record — they work on a structure object unchanged.

### 4.2 The eight edits

**(1) New state array.** Use **the same field names** as the lootable tombstone created at
`index.html:74749-74765`, so every downstream reader works untouched:
```js
state.structures = [{
  x, y, kind:'car'|'church'|'school'|'hospital'|'house',
  name, image, lootable:true, looted:false,
  rarity, level, isBoss:false,
  salvage:_rollStructureSalvage(kind),   // {resourceId: qty}
  risk:_rollStructureRisk(kind)          // 'corrupted'|'explosive'|'cursed'|'guarded'|null
}]
```
Seed it where match state is built (the analogue of `processTombstoneDrops`, **:74599**) or
from map data.

**(2) `_rollStructureSalvage(kind)`** — clone the *shape* of `_rollUnitSalvage`
(**:77010-77107**) but key the bias off `kind` instead of the unit keyword blob:
car → metal/fuel/mechanicalParts; hospital → medicine/chemicals; school →
researchData/cloth/supplies; church → relicFragments/divineSigils; house →
food/water/cloth/wood. Return the same `{id:qty}` map. Resource id universe: `RESOURCES`
(**:39272+**), `RESOURCE_IDS` (**:39357**), and the 150-entry `SALVAGE_RES`
(**:75373-75523**) indexed by `_SALVAGE_BY_ID` (**:75524**). Slot costs: `_resSlot`
(**:77853**), table at **:77831-77836** (metal/supplies/food/water/corruptedEssence/wood/
stone cost 2 slots, everything else 1).

**(3) `_unitCanLootStructure(u)`** — copy `_unitCanLoot` (**:77819-77829**) verbatim,
swapping `s.tombstones` → `s.structures` and dropping the `!o.glowing` clause.

**(4) `_lootStructureWithUnit(unitId, mode)`** — copy `_lootWithUnit` (**:77576-77762**)
and delete **only** the tombstone-specific parts:
- the graveyard-removal block **:77594-77601** (removes the fallen unit's stamped card)
- `trackMission('lootBody', 1)` **:77607** (or give it its own mission id)

**Keep verbatim:**
- **:77602** — the single line that spends the turn:
  `s.units = s.units.map(x => x.id===u.id ? {...x, hasMoved:true, hasAttacked:true, _looted:true} : x)`
- **:77603-77604** — lazily creates `s._salvageRun = {gained:{}, looted:0}`. **Required**:
  `_lootGridOpen`'s commit only writes into `_salvageRun` `if (s && s._salvageRun)`
  (**:77546**) and **never creates it**. Skip this and the run summary silently records zero.
- **:77621-77639** — the haul pipeline in order: `_looterRarityBoost` → `_biasSalvage`
  (mode) → `_applyEventLootMods` → backpack multiplier (`_battleBackpackLootMult`,
  **:190340-190349**)
- **:77686** — `_lootGridOpen(got, {tombName: st.name, unitName: u.name})`, guarded by
  `typeof _lootGridOpen === 'function' && Object.keys(got).some(k => (got[k]|0) > 0)`.
  **An empty haul must not open the grid** or the player sees an empty modal.
- **:77703-77760** — post-harvest: `_applyTombstoneRisk` (**:77259-77291**, HP-only,
  clamped to min 1), `_rollLootCard`, `_rollLootItem`, `_rollChestDrops`, two `s.log`
  lines, `playSfx`, `showToast`, `render()`.

Guards to keep, in order (**:77580-77586**): state + arrays exist; unit found and alive;
`u.pos` present; `u.owner==='player' && s.turn==='player'`; `!(u.hasMoved && u.hasAttacked)`;
a lootable, unlooted target on the unit's tile.

**(5) Hover menu.** One push next to **:70525**:
```js
if (_unitCanLootStructure(u)) btns.push({ act:'lootStruct', lbl:'Search',
  c:'#e08a2a', icon:'bag', sub:'Search this building' });
```
plus one `case 'lootStruct':` in `_dispatchHoverAction` (**:70788**) mirroring the two-line
loot case. Optionally mirror the modal button at **:140564** + **:143434**.

**(6) Extraction menu.** `openExtractionMenu(unitId)` at `index.html:77765-77817` builds a
fixed overlay with six `data-extract` buttons (normal / dna / essence / shards / research /
destroy) wired at **:77812-77814**. Its only tombstone coupling is the lookup at **:77771**
and the `t.name`/`t.risk` reads — either copy it or add a `source` argument.
Note the research mode's hard gates (**:77642-77682**): `playerOwnsVehicle()` and
`getRes('fuel') >= VEHICLE_LOOT_FUEL` (=5, **:65707**); it has an **undo**, `_unLoot()`
(**:77650-77656**), that refunds the spent turn.

**(7) 3D stage.** `_bbStagePushStructs()` as a byte-for-byte copy of `_bbStagePushTombs`
(**:103880**) against `App.state.structures` with its own `_BBS.structKey`, posting
`'structs'`; call it beside `_bbStagePushTombs()` at **:104079** and **:104149**.
In `battle-board/index.html`: `const STRUCTS = []` next to **:351**, a `t === 'structs'`
handler next to **:2854**, a `drawStruct(st)` modelled on `drawTomb` (**:1913-1956**) with a
taller projection (buildings ~1.4 world units, car ~0.55) and the same gold
`lootable && !looted` badge (**:1952-1956**), plus the drawable push/dispatch at
**:2541/:2550**.

**(8) Multiplayer.** Add `out.structures` to the coordinate-mirror block at
`index.html:179451`. **This entry exists for tombstones because the bug was hit before.**

### 4.3 Polish worth doing
- `_lgPaint` hardcodes `'☠ Tombstone Salvage'` at **:77402** and does not read `ctx`.
  Stash `_LG.lootTitle = (ctx && ctx.lootTitle) || '☠ Tombstone Salvage'` in
  `_lootGridOpen` and read it at **:77402**.
- Add structures to the missed-loot count in the game-over panel (**:151938**).
- **Decide, don't omit:** tombstones only block their tile when `glowing`
  (`tileBlockedByTombstone` **:75362**, consumed in the movement BFS at **:83596**).
  Copying the tombstone model gives you a walk-through church.
- **Decide, don't omit:** `tickTombstones` (**:75273-75284**) lets any AI unit standing on
  an unlooted body permanently deny it. Copying that means a raider in a house denies it
  forever; not copying it makes structures behave inconsistently with bodies.

---

## 5. Turn loop — control-point capture tick and alternate victory

### 5.1 The loop, precisely
```
onEndTurn()                index.html:149374   (#btn-end-turn, bound at :143400-143403)
  └ endPlayerTurn(state)   index.html:101817   turn:'ai'; fires turnEnd triggers
      └ startTurn(s,'ai')  index.html:101100   ← ALL PER-TURN TICKS LIVE HERE (:101189-101215)
  └ scheduleAIStep(700)    index.html:149890
      └ doAIStep() … re-schedules itself; budget AI_MAX_STEPS_PER_TURN=120 (:149877)
      └ finishAIPhase()    index.html:149940
          └ endAITurn(state) index.html:101831
              turnNumber++   index.html:101835   ← SINGLE-PLAYER INCREMENT
              └ startTurn(s,'player')  index.html:101890
```
`state.turnNumber` initialises to 1 at `index.html:97553`. `state.turn` is `'player'|'ai'`.
**There is no `turnCount` and no `turn_count`** despite dead reads at
`src/battle/targeting.js:452` and `index.html:141003`.

**`turnNumber` is incremented in TWO places.** In multiplayer `scheduleAIStep` no-ops
(**:149894**) so `endAITurn` never runs locally; MP bumps the counter itself at
`index.html:149487-149488`. **A tick keyed on `turnNumber` will double-count or never fire
on one of the two paths.** `_twTickGameMode` avoids this by keying on `who` inside
`startTurn`. **Do the same.**

### 5.2 The capture tick — where and how
Add your control-point block **inside `_twTickGameMode(state, who)`
(`index.html:213716`), directly after the oil-tower block that ends at :213816.** Or add
`_twTickControlPoints(s, who)` and call it from the **same line 101206 site** with its own
try/catch. **Do not add a call site in `endPlayerTurn`/`endAITurn`.**

**The pattern to copy is already written**: the oil-tower 3-turn hold-the-tile capture at
`index.html:213788-213816`. It gates on `who === (state.mods.twAttackerSide || 'player')`,
does `tw.progress = Math.min(3, progress + 1)` when a living owner unit stands on `tw.pos`,
**resets to 0 when the pad is vacated**, fires at 3, and logs every tick.

**The rejected design is documented at `index.html:213781-213787`:** a per-unit
`_twOilStandTowerIdx` marker, dropped when unit objects were rebuilt between turns, leaving
progress permanently at 0 with **no error**. **Scan tile occupancy at turn start. Never
stamp capture state on a unit object.**

Spawn the three points with `_twPickSpreadTiles(state, n, {minSpacing, avoidPos})` at
`index.html:213556-213578` — it picks N well-spread free tiles and is exactly the primitive
a 3-point layout needs. Stamp them in `_twStampGameMode(state)` (**:213580-213711**),
which already spawns the convoy, VIP, mainframe tile and oil towers.

**Return-value discipline:** `_twTickGameMode` mutates in place and returns nothing; the
call site invokes it as a bare statement. Writing `s = _twTickControlPoints(s, who)` there
sets `s` to `undefined`, blows up the rest of `startTurn`, and the try/catch **silently
skips every remaining turn-start tick** (bleed, smoke, surfaces, **draw phase**).

### 5.3 The alternate victory path — three edits, then nothing
1. Add an entry to `TW_NODE_OBJECTIVES` at `index.html:213430`, e.g.
   `{ id:'control_points:3', name:'Hold the Points', icon:'🚩', desc:'…' }`.
2. Add `case 'control_points':` to the switch in `_twEvalObjectives` (**:213510**) returning
   `'win' | 'loss' | null`. **Pure read — it must not mutate.**
3. Nothing else. `index.html:134062-134067` already stamps the verdict onto `s.gameOver`,
   and the entire downstream pipeline fires unchanged: `renderGameOverOverlay()`
   (**:151741**), `recordBattleProgress()` (**:134072**), `saveProgressCloud()`
   (**:134084**), `_twResolveAttackOutcome()` (**:134096**),
   `_zoneEncounterResolveOutcome()` (**:134101**).

**The gate you will forget:** `index.html:134062` requires
`App.battlePrep.territoryWarsAttack` to be truthy. A mode that does not set it will tick
progress and paint the HUD but **never win** — silent, and it looks like a scoring bug
rather than a routing bug. The game-mode picker sets the flag at
`index.html:198224-198244`; the TW attack flow at **:221922-221930**.

**Debrief:** extend the summary builder at `index.html:222021-222046` and add a row in
`renderGameModeSummary()` (**:138029-138068**, mounted at **:134271**, bound at
**:138070-138076**). It already prints rows like `Towers Completed  2/3` and renders on top
of the game-over overlay.

### 5.4 `state.gameOver` semantics — read this twice
`null | 'player' | 'ai'`, and **the value NAMES THE WINNER**, not the loser (comment at
`index.html:134049-134050`). Initialised null at **:97565**. It is assigned at **~65
independent sites**, each re-deriving `deadHero.owner === 'player' ? 'ai' : 'player'`:
the hero-death sweep idiom at `75012, 75064, 75164, 92285, 92395, 93599, 96894, 101734`;
~25 direct kill sites in effect resolution; deck-out at **:101750-101769**; the render-time
safety sweep at **:134044-134056**; the objective evaluator at **:134062**; MP server
verdicts at `45624, 149537-149541, 134330-134333`. `_applyHeroGuardian` can **clear it back
to null** (**:133815**, invoked from the *render* at **:133874**).

**There is no single choke point.** A new win condition set in only one place will be
overwritten by any of the hero-death sweeps that run later in the same turn — notably the
`startTurn` sweep at **:101734**, which runs on every turn start. Route new verdicts
through `_twEvalObjectives`, which the render deliberately evaluates *before* the standard
game-over branch.

---

## 6. Visual style contract

### 6.1 Global tokens — `index.html:94-107`
```
--bg-deep:#0b0814   --bg-mid:#14101f   --bg-panel:#1a1530   --bg-card:#221a3a
--gold:#d4af37      --gold-bright:#f5d76e
--ember:#e85d3c     --blood:#a02828    --emerald:#3aa86b
--azure:#4a8fd4     --violet:#8b5cf6
--ink:#e8e0d0       --ink-dim:#a89888
--border:#3a2f5c    --border-bright:#6b5499
```
Elevation, `index.html:113-121`: `--shadow-sm/md/lg`,
`--shadow-glow: 0 0 22px rgba(212,175,55,0.35)`,
`--ring-gold: 0 0 0 1px rgba(212,175,55,0.45)`.

### 6.2 Battle chrome — scoped to `.bchrome`, `index.html:5132-5138`
```
--bc-panel:#12121e     --bc-panel-2:#171625
--bc-gold:#d4af37      --bc-gold-bright:#f5c453   --bc-gold-dim:#7d6a2f
--bc-gold-line:rgba(212,175,55,.5)
--bc-ink:#f6efe3       --bc-ink-dim:#b9afa0       --bc-ink-mute:#7a7466
--bc-nature:#5edb8a    --bc-shadow:#b483f0        --bc-storm:#4aa8e8
--bc-rp:#63d97a        --bc-ember:#e0553c
--bc-disp:'Cinzel','Trajan Pro',Georgia,'Times New Roman',serif
```

### 6.3 HUD panel — scoped to `.bcp`, `index.html:5306-5311`
```
--gold:#d2a44e   --gold-hi:#f6dc95   --gold-deep:#8a6a28
--parch:#e9dab2  --dim:#9a8d6c
--nature:#6fbf3f --shadow:#a35cff    --storm:#4f8fe0   --crimson:#e04a4a
```
**Body font inside `.bcp` is `"EB Garamond", serif`** (`index.html:5314`). **Every label
and heading is `"Cinzel", serif`.** No exceptions.

### 6.4 The signature panel border — `.bchrome .panel`, `index.html:5142-5152`
2px **transparent** border with a double background:
```css
background:
  linear-gradient(180deg, var(--bc-panel-2), var(--bc-panel)) padding-box,
  linear-gradient(155deg,#f4d47c 0%,#c29a3a 22%,#7a5f24 50%,#c29a3a 78%,#f6d780 100%) border-box;
box-shadow: 0 7px 24px rgba(0,0,0,.6),
            inset 0 0 0 1px rgba(0,0,0,.55),
            inset 0 0 26px rgba(0,0,0,.5),
            inset 0 1px 0 rgba(255,240,200,.13);
```
plus a `::before` inset hairline `inset 0 0 0 1px rgba(212,175,55,.22)` (**:5151-5152**).

### 6.5 The chip/tile treatment — copy `.bcp .envcard`, `index.html:5509-5530`
```css
border: 1.5px solid rgba(210,164,78,.55);
border-radius: 10px;
background: linear-gradient(180deg, rgba(20,17,26,.9), rgba(10,9,15,.95));
box-shadow: inset 0 0 20px rgba(0,0,0,.55);
/* hover :5516 */
border-color: rgba(246,220,149,.8); box-shadow: 0 0 16px rgba(246,220,149,.16);
```
Typography inside it: `.lab` — Cinzel 700, 9.5px, `letter-spacing:.18em`, `#a2957a`
(**:5524-5527**); `b` — Cinzel 900, 16px, `#f2e6c2` (**:5529**); `.sub` — 12.5px,
`#9a8d6c` (**:5530**). **This is the exact template for a control-point tracker tile.**

### 6.6 The objective banner — already styled, `index.html:27110-27128`
```css
.tw-battle-banner {
  background: linear-gradient(180deg, rgba(212,175,55,0.16), rgba(80,40,20,0.45));
  border: 1px solid rgba(255,209,102,0.55); border-radius: 6px;
  padding: .45rem .65rem; color:#ffeec0; font-size:.85rem;
  display:flex; gap:.4rem; flex-wrap:wrap;
  box-shadow: 0 0 14px -4px rgba(255,209,102,0.45);
}
.tw-bb-obj { background: rgba(0,0,0,0.35); border:1px solid rgba(255,209,102,0.45);
  padding:.2rem .45rem; border-radius:3px; font-size:.78rem; color:#ffe9a8; }
```

### 6.7 In-board marker colours — `index.html:12203-12266` (inline, not in src/battle/*.css)
```css
.tile.tw-oil-tower.tw-oil-active {
  box-shadow: inset 0 0 22px rgba(255,180,80,0.6),
              inset 0 0 0 2px rgba(255,200,80,0.85);
  animation: tw-oil-pump 1.0s;
}
.tw-oil-done { /* green */ rgba(120,220,160,0.8) }
.tw-oil-fill { background: linear-gradient(90deg,#d68a3a,#ffcf5a) }
```
Active/in-progress = amber. Complete = green. Match it.

### 6.8 The loudest element — `.bcp .endturn`, `index.html:5671-5696`
`linear-gradient(180deg,#ffe9a2 0%,#f0c05e 38%,#d99f34 62%,#a87a1e 100%)`,
`border:2.5px solid #8a6218`, `color:#3a2606`, Cinzel 900, `letter-spacing:.14em`,
`clip-path: polygon(30px 0, calc(100% - 30px) 0, 100% 50%, calc(100% - 30px) 100%, 30px 100%, 0 50%)`,
`animation: bcp-etPulse 2.8s`, with `❖` ornaments via `.etwrap::before/::after`.
**Nothing new should out-shout this button.**

### 6.9 Text output channels
- **`s.log`** — `{ msg: string, color: 'amber'|'green'|'red'|'ink' }`. **No push helper**;
  every site does `s.log = [...s.log, {...}]`, or uses `startTurn`'s local alias
  (`let log = [...s.log]` **:101107**, written back at **:101814**). `msg` is escaped at
  render — never HTML. Rail shows the last 6 (**:141029-141033**); the modal
  `_bcLogModal(s)` (**:141207-141235**) shows `visible.slice(-400).reverse()`.
- **`showToast(msg, ms=1800, opts)`** — `index.html:112801`. **Synchronous, single-toast:
  it removes any existing `.toast` first (:112804-112805).** `opts.html` opts into raw HTML;
  `🔥` auto-swaps to `<span class="cinder-icon">`.
- **`gcConfirm(msg, opts)`** — `index.html:111729`. Returns a Promise. **Must be awaited.**
  `window.alert/confirm/prompt` are globally overridden to themed modals at **:111757-111761**.

### 6.10 Layout invariants you must not break
- **The board is deliberately FLAT.** `.board { transform: translateZ(0);
  transform-style: flat; }` at `index.html:11216-11219`, with a 40-line comment at
  **:11184-11215** recording that *any* perspective/`rotateX` re-projection caused the
  "map glitches with animated sprites" bug. `board.css`, `alive.css` and `units.css` state
  as an explicit contract that **the word `filter` does not appear in them**.
- **`.tile` carries `contain: layout paint`** (`index.html:11797`, cited at
  `targeting.js:83`), which hard-clips descendants and outranks the later
  `.tile { overflow: visible !important }`. A badge that must overflow its cell will be
  **silently cropped**. This is exactly why `targeting.js` builds a separate overlay grid.
- **Rail width is a fragile three-way agreement:** `index.html:7082-7089` sets
  `--btl-rail-w` (560/400/330); `chrome.css:97-99` overrides it (440/320/280);
  `chrome.css:117-135` restores the three-column `.battle-grid` template that
  `index.html:6930-6931` breaks below 1500px. `chrome.css:100-116` documents that
  `--btl-rail-r` already lies about the right rail's real width.
- **`chrome.css` is appended LAST and wins by source order.** It carries 53 `!important`
  declarations that exist *only* to answer index.html's "PANEL FIT" compression passes
  (~`index.html:5698-5784`). New rules in index.html's inline sheet targeting `.bcp` will
  **lose** to chrome.css. New rules added to chrome.css must respect its stated 4px /
  32-40-48px spacing discipline (`chrome.css:63-78`).
- **`--hand-clear`** is written onto `.battle-screen` by `src/battle/fit.js:59`, clamped
  [72,260], and **removed entirely** when no `.hand-strip` is in the DOM. The board's height
  calculation depends on it.

---

## 7. Ranked risk register — what breaks silently, and the cheapest guard

Ranked by (probability of happening) × (time lost before anyone notices).

| # | Risk | Where | Failure mode | Cheapest guard |
|---|---|---|---|---|
| **R1** | `renderBattle` **swallows exceptions** and keeps the last good frame | `index.html:133846-133848` | A throw in a new HUD builder does **not** surface. The board silently stops updating; the game looks frozen. | Wrap every new render helper in its own try/catch returning `''`. In-repo precedent: the per-card isolation in `renderHandStrip`, `index.html:142435-142448`. |
| **R2** | `frameErr` in the canvas stage is a **one-way latch** | `battle-board/index.html:2512`, error paint **:2586-2597** | One exception anywhere in `frame()` paints a red "RENDER ERROR" screen and **stops the RAF loop forever** — no reschedule. Looks like a total freeze, not a glitch. | New per-frame code goes inside its own try/catch (the `drawSurfaceFx` call at **:2530** already models this). Never let new camera/hex code throw intermittently. |
| **R3** | `gw` changed without `pickTile` | board **:469** vs **:2613** | Clicks and hovers keep "working" and address the **wrong tile**. No assertion ties them. | Add a boot-time self-test: for every `(gx,gz)`, assert `pickTile(project(gw(gx,gz)))` round-trips. ~10 lines, runs once. |
| **R4** | The metric is inlined ~80× | `index.html:74070` + ~80 copies | Changing `distance()` leaves the UI highlight and the click gate disagreeing. Scar comment at **:141543-141550**. | Grep `Math.max(Math.abs` across index.html and convert **all** of them to `distance()` in one commit *before* touching the metric. |
| **R5** | Objective gate `App.battlePrep.territoryWarsAttack` | `index.html:134062` | Progress ticks, HUD paints, **victory never fires**. Reads as a scoring bug. | Log once per battle when a control-point objective is present but the flag is false. |
| **R6** | Deploy versioning | `index.html:223112-223144`, `version.txt`, `BUILD_VERSION`, `sw.js CACHE_VERSION`, `BB_VER` at **:104152** | Editing `src/battle/*` without bumping its `?v=` ships **nothing** to returning players. A stale cached board iframe silently ignores a new `board:*` message type. | Bump all knobs in the same commit. Verify at the **edge with curl**, never the deploy log, and poll — PoP propagation takes minutes. |
| **R7** | `_twTickGameMode` returns nothing | `index.html:213716`, call site **:101206** | `s = _tick…()` sets `s` to `undefined`; the try/catch then **silently skips every remaining turn-start tick** including the draw phase. | Match the void-mutation convention, or add a separate correctly-assigned call. |
| **R8** | Capture state stamped on a unit object | rejected design documented at `index.html:213781-213787` | Unit objects are rebuilt between turns; progress stays at 0 forever with **no error**. | Scan tile occupancy at turn start. Copy the oil-tower block at **:213788-213816**. |
| **R9** | `turnNumber` incremented in two places | `index.html:101835` (SP) and **:149487-149488** (MP) | A tick keyed on `turnNumber` double-counts or never fires in one mode. | Key on `who` inside `startTurn`, like `_twTickGameMode`. |
| **R10** | New positioned array missing from the MP mirror | `index.html:179451` | `state.structures` renders on the **wrong tiles** for the remote player. The tombstone entry exists because this was already hit. | Add `out.structures` at **:179451** in the same commit that creates the array. |
| **R11** | `image` is in HEAVY_KEYS, blanked in MP snapshots | `index.html:179602-179618`; tombstones re-resolve at draw time **:141982-141984** | A renderer that trusts `st.image` shows **nothing** for the remote player. `_bbStagePushTombs` also drops `blob:` URLs (**:103888**) — they cannot cross the iframe. | Re-resolve the image at render time; strip `blob:` before posting. |
| **R12** | `_LG` is a module **singleton** | `index.html:77296`, defensive removal at **:77408** | A second `_lootGridOpen` while one is open **destroys the first's pending haul without committing** — `commitClose` never runs, the loot is silently lost. | Guard new loot paths on `_LG.open`. |
| **R13** | `s._salvageRun` is created only by `_lootWithUnit` | created **:77603**, written defensively **:77546** | A new loot source calling `_lootGridOpen` directly banks loot correctly but records **zero** in the game-over summary (**:151937**). | Create `s._salvageRun` before calling the grid. |
| **R14** | `Profile.fieldBag = newBag` is a **full replacement** | `index.html:77541` | Anything that mutated the bag while the grid was open (another loot source, a consumable, a deposit) is overwritten and lost. | Don't run a second bag mutation while a grid is open — same guard as R12. |
| **R15** | The turn is spent at `:77602` **before** the mode branches | `index.html:77602`; only undo is `_unLoot` **:77650** | Any new failure path added after that line eats the unit's turn for nothing. | Call `_unLoot()` on every new early return. |
| **R16** | `fromLoot` flag on grid pieces | piece literal `index.html:77315`, auto-take **:77521-77532** | Auto-take-on-close only moves `fromLoot === true`. Hand-built pieces missing the flag are treated as the player's own dumped goods and **quietly abandoned**. | Always go through `_lgPieces(got, true)`. |
| **R17** | `project()` returns `null` at `z <= 0.05` | board **:464**, ~40 bare-`continue` callers | Any camera move, larger board or FOV change pushes geometry behind the near plane and it **vanishes with no error**. This is the first failure to expect when panning. | Clamp pan to `boardExtent() + margin`. Add a dev-only counter of null projections per frame. |
| **R18** | `Object.assign(MAP, msg.map)` **merges** | board **:2818, :2836** | A `board:map` omitting `tiles`/`events` keeps the **previous** board's contents at now-out-of-range coordinates. | Always send a full `tiles` array; or replace `MAP.tiles` explicitly before the assign. |
| **R19** | `_twEvalObjectives` runs on **every render**, not once per turn | `index.html:134064` | An objective that mutates or is expensive fires dozens of times per turn — capture progress placed there races to victory in one turn. | Keep the evaluator a pure read. Progress belongs in Seam A. |
| **R20** | `_applyHeroGuardian` can **clear** `gameOver` | `index.html:133815`, invoked from the render **:133874** | A decided match can be un-decided by a render pass. | Make any "the moment we win" side effect idempotent; `recordBattleProgress` is already guarded by `App.battleProgressRecorded` (**:134071**). |
| **R21** | `tileAt` is an unindexed linear scan | board **:472** | Degrades quadratically with map size; **no symptom but frame rate**. | Build a `Map` keyed `"x,z"` in `buildStage()`. |
| **R22** | Inserting an element as a **sibling of the tiles** inside `.board` | `targeting.js:529-531`; shake animation keyed on `.tile:nth-child(3n+k)` at `targeting.js:123` | Shifts every tile's nth-child index, breaking that animation and `domPos`'s index fallback (`targeting.js:359`). | Put markers **inside** a `.tile`, or append after `.tgt-layer` — never between tiles. |
| **R23** | `targeting.js` caches `cols()`/`rows()` for the page lifetime | `targeting.js:339, 371` | If grid dims ever become per-battle, every enemy name plate is placed against the **first battle's** geometry until reload. The `.tgt-layer` inherits `grid-template-*` from `.board` so the overlay follows a reshaped grid while the JS math does not. | Invalidate `_colsCache`/`_rowsCache` on battle start if dims become dynamic. |
| **R24** | Existing coordinate-space bug: grid coords fed to world-coord consumers | `deny()` board **:529**, `attackUnit` **:536-539**, `killUnit` **:546** vs `drawEffects` ring **:2029** | Effects land up to 3.5 world units off-target today; the error scales with `(cols-1)/2`, so a **larger board makes it worse**. `summonFx` (**:563-564**), `spawnEvent` (**:1151**) and `triggerEvent` (**:1160-1161**) do it correctly via `gw()`. | Route those three through `gw()` before enlarging the board. |
| **R25** | `_unitCanLoot` and `_lootWithUnit`'s guards are duplicated logic | **:77819-77829** vs **:77583-77586** | Adding a structure predicate creates a **third** copy. If they drift, the action row appears and the click returns `false` with **no toast** — a completely silent failure. | Extract one shared predicate, or add a `console.warn` on the `false` returns. |
| **R26** | `showToast` shows only the **last** toast | `index.html:112804-112805` | A tick that toasts per control point shows one of three. | Per-turn events go to `s.log` (which the rail shows and the replay recorder keys on); at most one summarising toast. |
| **R27** | `pickTile` intersects **y=0 only** | board **:2612** | Raised tiles (elev 0.18) are already mis-clickable — you select the tile behind. Pitch control widens the gap with no error. | Known-and-accepted, or raycast against `tileElev`. Document the choice. |
| **R28** | `artImage` never retries a failed load | board **:320-332**, `rec.bad` set at **:327** and never read | A transient 404 at boot leaves that sprite **permanently blank**, no error, no recovery short of reload. | Check `rec.bad` and retry once with backoff. |
| **R29** | `D._clip` is never assigned anywhere | read at board **:1793-1794** | Multi-row sprite sheets **always play row 0** ('idle'). Anyone wiring anim states finds the plumbing half-built. | Assign `_clip` from `u.anim` in `drawUnit`, or delete the dead read. |
| **R30** | `getValidPlacementTiles` is called with the **wrong argument order** | declared `(card, hero, state)` at `index.html:83372`; called `(state, hero)` at **:86461** and **:93034** | `card` receives the state object, `state` is undefined, `getCardRange` returns 1, every type branch misses, and the function returns `cells` **unfiltered** — grave-raise and deploy-self can place a unit on an occupied tile or a wall. | Fix both call sites when refactoring the signature. Do not merely move them. |
| **R31** | `getValidMoves` and `getMovePath` are near-duplicate BFS and already disagree | `index.html:83560` vs **:100261** | `getMovePath` omits the tombstone check and the Zone-of-Control dead-end rule — a unit can be shown a legal destination and then walked **through** a ZoC line. | Editing one requires editing the other. Better: extract one BFS. |
| **R32** | Sprite crispness fixes inside `paintSprite` do nothing | `ctx.shadowBlur = k*.16` at board **:2000** | The rim-light shadow blurs the **entire** sprite draw and is the single biggest softness source; it is outside `paintSprite`'s carefully restored `imageSmoothingEnabled` block (**:1768-1798**). Also `ctx.translate(foot.x+sh, foot.y)` at **:1993** uses unrounded sub-pixel coords, undoing the `Math.round` done in local space. | Address **:1999-2001** first, then round the parent translate to device pixels. |
| **R33** | `_rollChestDrops()` takes no arguments and rolls unconditionally | `index.html:202737-202754`, called per harvest | A map full of lootable houses **directly multiplies the chest/key drop rate across the whole economy**. | Gate chest rolls to tombstones, or rate-limit per battle. Get this decided before shipping structures. |
| **R34** | Stale fallback constants | `index.html:133797` (`_H : 8`), **:74524** (`BOARD_W : 10`), **:213562/213756** (`W : 9`) | Fire only when the global is missing, and then place units off-board. | Replace all fallbacks with `_boardDims(state)` (**:74862**). |

---

## 8. Definition of done (per work item)

1. `node _synckcheck.mjs` passes (**not** `build.mjs`).
2. `gw` ↔ `pickTile` round-trip self-test passes for every cell (hex work only).
3. Both renderers agree: click the same visual tile in the DOM board and the 3D board and
   confirm the same `onTileClick(x, y)` args.
4. Every new render helper has its own try/catch (R1, R2).
5. `version.txt` + `window.BUILD_VERSION` + `sw.js CACHE_VERSION` + every touched `?v=`
   + `BB_VER` bumped together; edge verified with curl and polled.
6. New positioned state added to the MP mirror at `index.html:179451`.
7. No file under `public/src/battle/` converted to `type="module"`.
8. Browser-pane caveat: `requestAnimationFrame` never fires there, so `render()` does
   nothing and canvas rects read 0×0. Call renderers directly, and for canvas work inject
   `requestAnimationFrame = cb => setTimeout(cb,16)` into a throwaway copy of the page.
