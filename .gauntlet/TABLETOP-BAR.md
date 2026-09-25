# TABLETOP BAR — the battlefield as a digital tabletop

> **Read this before you build or judge anything in this pass.**
>
> 🔴 **WHY THIS FILE EXISTS.** The owner supplied ~20 reference images in one
> conversation, plus a screenshot of the live board. Images cannot be handed to
> a subagent. So the bar is transcribed here, in enough detail that a critic can
> fail a screenshot on a *number* rather than on taste. Same device as
> `.gauntlet/BAR.md` and `DESIGN-BAR.md`, and it carries the same honest cost: a
> written bar is weaker than a side-by-side. It can be read too loosely ("it's
> isometric and has tiles, ship it"). Where a rule is a measurement it is
> written as one. Where it is taste, it says so. **Do not report a board as
> matching the bar when what you mean is that it did not obviously clash.**
>
> 🔴 **REBUILT 2026-09-15.** The tree moved from `D:` to `E:` and this file, plus
> all of `.gauntlet/tabletop/`, was **untracked** and did not survive. The
> product code did. So: the rules below are intact, but **every round PNG from
> rounds 0–3 is gone.** There is no image history left to A/B against. Earlier
> verdicts stand on their written evidence, not on re-openable pictures, and the
> first capture after the rebuild is a new baseline **of a board that already
> carries eight landed pieces** — not of the original board. Do not relabel a
> fresh capture "before".

---

## 0. The ask, decoded

The owner asked for a battlefield that looks like "a tabletop War Hammer 40k but
in a game style". Decoded into work:

| # | Ask | Test | State |
|---|---|---|---|
| A | Tiles randomised every match, element bonuses intact | Two seeds differ; bonus tiles resolve | ✅ won |
| B | **2.5D** tiles, each its own realm | A tile reads as a discrete piece | ✅ won |
| C | "Not painted together like the screenshot" | 🔴 The loudest note. §3 | ✅ won |
| D | **More grass and street** as basics | §4 mix table | ✅ won |
| E | **Elevation**, because damage keys off height | §5.1 | ✅ won |
| F | **Height affects accuracy** | §5.3 | ✅ won |
| G | **Remove the Ruin City background** | §6 | ⬜ open |
| H | Reads as a **sports battlefield** | §7 | ⬜ open |
| I | Player POV of a **digital tabletop** | §2 | ⬜ open |
| J | **Keep every function** | `npm run check` at/under baseline | ⬜ gate pending |
| + | **Mud slows units −1 speed** | §5.4 | ◐ surface + ley row landed; the speed rule is open |

More tiles are coming after this pass. Anything built here must accept new
surfaces by dropping a PNG in and adding one table row — `TILE_ART` already
promises that. **Do not break that promise.**

---

## 1. What the reference images show

### 1.1 The high bar — the detailed realm dioramas
Nine references are large (≥1100 px) renders: a **corrupted city** (ruined
towers on a plinth, broken bridges, violet lightning, a shadow beast rising
behind); a **sound citadel** (dish antennas, waveform panels, a caged orb,
brass-on-charcoal, concentric rings); a **gravity station** (a black hole in an
orbital ring, caged planets on spires, banners with a ringed-planet sigil); a
**wind forest** (pines bent by a white vortex, debris in flight, roots trailing
from the underside); **the pond** (mossy cut-stone rim over an earth skirt,
caustics, lily pads, cattails); plus **arcane**, **crystal**, an **SCP
facility** and a **toxic fortress**.

**The five properties every one shares — the bar in one line:**
1. **It is a diorama, not a texture.** Built stuff stands up off the ground
   plane with its own silhouette.
2. **It has an underside.** A rim, a skirt, or detached floating shards. The
   piece is an object with a bottom, not a hole cut in a photo.
3. **One element, unmistakable at thumbnail size.** Colour + silhouette alone
   tell you which realm it is.
4. **Internal light.** The glow comes from inside the tile, warm against cool.
5. **Transparent background.** The piece ends. Nothing bleeds outward.

### 1.2 The current small tiles
The ~256 px tiles in `public/battle-board/Battletiles/` are the same
construction at lower detail: walled isometric footprint, cut-stone rim, brown
dirt or wood skirt, one element filling the interior. **Acceptable as-is** —
they already satisfy §1.1. They are not what is wrong.

### 1.3 What is wrong is the assembly, not the art
See §3.

### 1.4 🔴 THE BEFORE — the board the owner screenshotted
The owner supplied a live-board screenshot: **"The battlefield must change from
this to what I asked for."** Transcribed. **Every one is a defect to remove, not
a style to preserve.** Marked with where they now stand.

- **Sand owns the board.** ~2/3 of visible tiles are one pale tan desert plate.
  Grass is a scattered minority; there is no street anywhere. ✅ *fixed*
- **Everything is washed out.** The whole frame sits in a hazy low-contrast
  pale-blue wash; tan tiles, beige cliffs, blue-grey sky and grey water all land
  in one narrow value band. Nothing is the brightest thing in frame. ⬜ *open —
  this is `staged-lighting`*
- **The tiles are thin plates, not pieces.** A flat top, a hairline gap, a 2–3 px
  lip. No side wall, no skirt, no depth. ✅ *fixed*
- **There is effectively no elevation.** ✅ *fixed*
- **The ruined city is the whole background.** A painted skyline with a legible
  "NEW YORK UNIT…" sign fills the top third, behind a beige cliff wall and a
  band of water. ⬜ *open — Ask G*
- **The board has no edge and no frame.** Tiles ravel out into ragged half-rows
  left, right and bottom, then stop over dark water. Nothing says the board is
  an object. ⬜ *open — `board-edge-lip`, `table-and-shadow`*
- **Elemental tiles read as coloured patches**, not realms: violet and cyan
  clusters sitting flush in the sand with no rim, no glow spill, no height. ✅
  *fixed*
- Two flaming braziers on pillars sit *behind* the board rather than framing it.
  ⬜ *open*

**A round that does not visibly move away from this frame has not moved.**

---

## 2. The camera and the table

The player must feel they are **sitting at a table looking down at a board**,
not flying over a landscape.

- **Fixed pitch, high.** A steep, stable, near-vertical strategy camera. Not a
  horizon shot.
- **The board is a finite object.** Its edge is visible on at least three sides
  in the default framing. A player must see where the board *stops*.
- **There is a table under it.** Whatever surrounds the board reads as the
  surface it rests on — felt, dark wood, a lit arena floor — never as landscape
  continuing to a horizon.
- **The board casts a shadow onto that surface.** This one cue does more than
  any other to sell "physical object on a table". Taste, but strongly held.
- **No sky doing scenery work.** See §6.

FAIL if a screenshot reads as "standing in a place". PASS if it reads as
"looking at a game".

---

## 3. 🔴 "Not painted together" — the loudest note

> "make it where it is like each tiles are different realms … not painted
> together like the screenshot"

The ground was baked into one continuous raster with neighbouring paintings
bleeding together, so the board read as one airbrushed landscape. The owner is
saying **the seam is the point**: they bought tiles that are individual realms
and want to see them as individual realms.

1. **Every tile has a visible boundary on all sides.** A critic must be able to
   trace any single tile's outline without guessing.
2. **Adjacent tiles do not blend.** No cross-fade, no feathered alpha, no
   gradient wash across a tile border.
3. **The boundary is a physical edge, not a drawn line.** A stone rim, a bevel
   catching light, a contact shadow into the gap. A flat stroked hex outline is
   the cheap version and does not pass on its own.
4. **A tile's art stays inside that tile.** Effects may rise *above* it; ground
   colour may not spill *sideways*.

This does **not** mean a chessboard of clashing postage stamps. Basics (§4) are
the connective tissue: grass and street are the quiet majority, so the loud
realm tiles land as accents with room around them.

---

## 4. The mix — basics are the majority

| class | surfaces | share |
|---|---|---|
| **basic** | grass, asphalt/street, dirt | **≥ 60 %** |
| neutral filler | rubble, water, mud, sand | ≤ 15 % |
| **elemental (bonus)** | the 19 element surfaces | **15–25 %** |

- **No more than ~6 distinct elemental surfaces on one board.**
- **Elemental tiles cluster, they do not speckle.** Prefer 2–4-tile pockets.
  A pocket reads as a place; a lone hex reads as noise.
- **Basics must be varied, not flat** — variation *inside* the tile, never
  bleeding across the edge (§3.4).
- **Every element with a bonus must still be reachable.** Do not silently drop a
  surface from generation.
- 🔴 **Sand is not a basic.** It moves to neutral filler and drops to a small
  share. Grass and street take its place as the majority.

### 4.1 Art on disk — wire it, do not re-draw it
- `public/battle-board/Battletiles/` — the 26 elemental tiles.
- `public/assets/Battlemap titles/` — **`Mud tile.png`, `Sandtile.png`** (no
  space) and **`Street tile.png`**, plus `metal tile.gif`. **Use the real
  paths.** Do not move files to match a doc.
- ⚠ **Footprint differs between batches.** Elemental tiles are walled *hexes*
  (`top: .80`); mud, street and sand are **square/diamond** plates at a
  shallower angle with a thick side wall. They need their own `top`/`crop`.
  Measure per file; one number for all of them will crop wrong.
- ⚠ **`Blood.png` was a live 404** — `TILE_ART` pointed at a name that did not
  exist while `Blood Tile.png` did. A *misspelled* row is a bug; a genuinely
  missing file is not (§8.3). Check the name against disk before concluding
  either.
- These files are **untracked in git**. They must be committed with the change
  or the deploy ships 404s — which degrade quietly to swatches and read as "the
  art didn't work".

---

## 5. Elevation

### 5.1 It must be visible
- A tile one rung higher shows a **visible vertical side wall** — its own skirt,
  lit differently from its top face.
- Top face brightest; the two visible flanks at **distinct** darker values. A
  single flat fill reads as cardboard.
- A raised tile **casts a contact shadow** onto the lower tile beside it.
- Rungs far enough apart to be legible. ⚠ The step is **0.34** and a round
  re-measured it and deliberately left it there: **the cap is the pick ray, not
  taste.** Read the reasoning at `_BB_ELEV` before changing it.

### 5.2 It must be readable as a rule
The height difference between attacker and target must be **surfaced in the UI**
wherever the damage or accuracy number already is. A height advantage the player
can only discover by losing is not a feature.

### 5.3 Height affects accuracy
- Downhill → accuracy bonus. Uphill → penalty. **Symmetric** and **capped**.
- **RANGED-ONLY** (owner decision), matching the existing height→damage rule
  exactly, so the two cannot disagree.
- Must go through the **existing** accuracy path. No second hit-resolution.

> 🔴 The height→damage rule is **not** in `calculateDamage`. It is in
> `public/src/battle/ley.js`, and `public/index.html` carries a **stale comment
> claiming "No elevation grid exists"**. That comment is why people build this
> rule twice in the wrong file. Fix it while you are there.

### 5.4 Mud slows — −1 speed
- `mud` is a surface (already appended to `_SURF_ORDER`, with its `TILE_ART` row
  and its ley row).
- A unit **standing on** mud has speed reduced by 1. Standing on — not
  "entering", not "leaving".
- 🔴 **PURE −1 SPEED.** Not the existing `slow` status, which would silently also
  cost −1 attack range and ~−15 % accuracy. Use the terrain seam.
- **Floor it.** A unit at 0 speed is stuck forever — a soft-lock, not a tactic.
  ⚠ **That soft-lock already exists before mud**: `getMoveRange` applies
  Chokehold as `Math.max(0, base-1)` *outside* the raw floors, so a spd-1
  chokeheld unit returns 0 today with no on-screen explanation. Mud makes it
  reachable in ordinary play. Raising that wrapper floor is a change to an
  **existing** interaction — say so loudly rather than doing it silently.
- **Show it** (§5.2). Mud grants **no elemental bonus**.
- 🔴 **A gate is already waiting, and its firing is the gate working.**
  `_ley_smoke` §2b asserts every surface in `_SURF_ORDER` is *explicitly
  decided* — an `ELEM_BOON` element, or an explicit `SURF_SEED` row, where
  **`null` counts as a decision**. `mud: null` and `sand: {earth,1}` are already
  written. Any new surface needs its row too. **Do not weaken the gate.**

---

## 6. The Ruin City backdrop — remove it

The board loads a location **backdrop** (`BACKDROP` / `LOCATIONS`, e.g.
`ruins-downtown-01`, "Overgrown Downtown"). That painted ruined-city plate is
what to remove.

- After this pass, **no painted scenery plate sits behind the board** by default.
- What replaces it must serve §2 and §7: a table surface, an arena floor, a dark
  vignette — "this board is an object in a room", not "this board is in a city".
- ⚠ **Without breaking the loader.** `BACKDROP` has a cross-fade and a
  **superseded-load guard that exists because of a real past bug**. Removing the
  *art* must not mean deleting machinery other locations still use. Ask J binds.
- ⚠ **Removing the photo reveals a second ruined city** — ~26 procedural ruin
  silhouettes sit behind the plate. §6 is not done when the JPEG is gone.
- ⚠ **Order is not optional:** the board-page half must precede the index.html
  half. A null backdrop is not currently a value the loader understands, so
  doing the host half first re-opens the documented bug where the ground swaps
  and the old sky stays on screen permanently.

---

## 7. Sports-battlefield / arena framing

- The playfield is **framed**: a border, rail or lip runs around the board, the
  way a pitch has a touchline.
- **Zones are marked on the ground** the way a sport marks its field: deployment
  rows, centre line, objective points. Subtle, painted-on, under the pieces.
- **Symmetry reads.** A player can see whose half is whose at a glance.
- **Lighting is staged, not natural.** The playfield is the brightest thing in
  frame; everything outside falls off. Arena floodlight.
- Sports furniture is welcome at the rim — banners, corner posts, side lighting
  — **outside** the playable area, never on a tile a unit stands on.

---

## 8. Hard constraints — breaking one is a failed build

1. **`_SURF_ORDER` IS A NUMBERING. APPEND ONLY.** `_surfCode()` returns the
   index and the terrain key hashes it. Re-ordering invalidates every baked
   ground and every screenshot baseline. Unknown sentinel is 99.
2. **`_SURF_ORDER`, `SURF` and `TILE_ART` stay in sync.**
3. **Missing tile art is not a bug.** `artImage()` answers null until a file
   loads; `tileArtLoaded()` re-bakes once per late arrival. Preserve this — more
   tiles are coming.
4. 🛑 **DO NOT DEPLOY WHILE THIS PASS IS IN FLIGHT.** Eleven pieces edit the
   board page, so the version pair is bumped **once, by the lead, at the end**.
   Mid-pass, the board has changed and its cache-buster has not — shipping
   serves every client a **cached old board**. This already happened once: the
   pair sat at `v121v149-aim` while v159 shipped nineteen new tile surfaces.
   **Deferring the bump is correct. Forgetting it is the failure mode.**
5. **`BB_VER` (index.html) and `BB_BUILD` (board page) must move together.**
   `_ritualart_smoke` and `_aimarrow_smoke` assert the pair.
6. **HEXSPEC is binding.** Pointy-top, odd-r, the one world formula. If a visual
   change implies a lattice change, **STOP and say so** — do not pick another.
7. **Gates, from CLAUDE.md** — run all of them:
   `node _synckcheck.mjs` (index.html — *not* build.mjs) ·
   `node _htmlsyntax.cjs <file>` (board page / harness) ·
   `node .gauntlet/comment-scan.mjs` (markup; **does NOT cover the board page**,
   so be careful with `<!--` there) · `node .gauntlet/modcheck.mjs` (ES modules;
   `_synckcheck` does not look under `public/src`) · `node _ley_smoke.mjs`.
8. **LF line endings.** Git's `autocrlf` rewrites HTML to CRLF on any checkout
   or merge and that silently breaks `_battleperf_smoke`'s slicing.
9. **Performance does not regress.** The ground is baked for a reason. If tiles
   stop sharing one bake, prove the frame cost before claiming it is fine.
10. **`npm run check` stays at or under baseline** (3 known failures +
    `_plague_smoke` 1). **Never raise a baseline to make a change pass.**

---

## 9. How a critic judges

1. **Render it.** `node .gauntlet/tabletop/shot.mjs out.png --scene mixed|cliff|basics`
   — real Chromium, real rAF. Confirm the diag shows a real canvas and size, not
   a blank page. **Then open the PNG.** A critic who did not open an image has
   not judged anything.
2. **A/B against the previous round's PNG**, same seed, same camera. ⚠ See the
   rebuild note at the top: there is no pre-2026-09-15 image history left.
3. **Score against §2–§7 rule by rule, quoting rule numbers.** "Looks better" is
   not a finding.
4. **Name the single biggest remaining gap** as one concrete, buildable
   instruction.
5. **Be willing to say it still loses.** The loop only converges if critics are
   allowed to fail a round. **A critic that passes everything is a broken
   critic.**
6. **Measure distributions, don't eyeball them.** For generator work, run
   hundreds of seeds and report mean and spread. A verdict on one board is not a
   verdict.

### 9.1 The release sweep — v166, when the pass lands
The owner is **holding the deploy** for this pass. This session owns the sweep.

Ten knobs: `public/version.txt` · `window.BUILD_VERSION` · `sw.js CACHE_VERSION`
· node-city `NC_BUILD` · `effects.js?v=` · `handset.js?v=` · **`ley.js?v=`** (ley
changed this pass) · `battle.athena.js` if touched · **`BB_VER`** · **`BB_BUILD`**
(must equal `BB_VER`).

⚠ **`version.txt` and `NC_BUILD` must move in the same commit** —
`_citycinder_smoke`, `_clinicloop_smoke` and `_stockflow_smoke` all read
`version.txt` and assert `NC_BUILD` carries it.
⚠ If `version.txt` lags, the update check reloads 500 ms after load and every
headless suite dies.

Before the sweep, `_ritualart_smoke` and `_elemtiles_smoke` must be **updated to
assert the new art wiring, not relaxed** — they currently pin the pale-tan
monopoly §1.4 exists to delete.

🔴 **Deploying is the owner's call, not this session's.** Prepare, report, wait.

---

## 10. Facts established by the mapping round — start from these

**Line numbers rot.** Grep for the identifier, never trust a number.

1. **The harness lied about elemental tiles.** Its copy of `_bbGenTerrain` ended
   after the mirror pass and had no elemental block, while claiming byte-for-byte
   fidelity. It rendered boards with **zero** elemental tiles. *Repaired.*
2. **The heightfield cache was keyed on `MAP.id`** (the constant `'editor'`), so
   the second map of a session kept the first map's heights. *Repaired.*
3. **"Sand owns the board" was a `TILE_ART` bug**, not a generator quantile:
   `dirt` **and** `rubble` both pointed at a desert plate and `asphalt` at a
   meadow track. *Repaired.*
4. **Elevation was drawn — too small and in the wrong ink to see.** Not missing.
5. **The ladder lives in FOUR places**: the generator, a byte-copy in
   `_harness.html`, re-hardcoded as `ELEV_STEP` in `ley.js`, and
   `.gauntlet/tabletop/shot.mjs`. Move one, move all four.
6. **`TILE_INSET` is one number shared by five painters.** No piece may inset
   only the top face.
7. **`terrainKeyParts` is the single cache-invalidation point.** Any new
   per-tile input must reach that string or the change never appears on a parked
   camera — and it will look like the edit did nothing.
8. **The wall geometry is duplicated three times**: `paintWalls` draws it,
   `slabPieces` rebuilds it for the occlusion mask, `paintSkirtShadow` walks the
   same edges. Changing wall *colour* is safe; changing wall *shape* without the
   other two makes units clip against a wall that is not where it is drawn.
9. **`.board-area.bb-on .board { visibility:hidden !important }`** hides the DOM
   board whenever the canvas stage is mounted — the default. The height chip and
   damage forecast both render there, so the obvious implementation of §5.2 and
   §5.4's "show it" satisfies the letter and is **invisible in a real match**.
   The owner's decision: build a real `board:forecast` channel.
10. **Element bonuses were silently dead.** `SURF_SEED` covered five surfaces,
    so all 19 elemental surfaces seeded no ley and granted no bonus on generated
    ground — with a green suite throughout, because the suite exercised the
    resolver and never asked whether anything reached it. *Repaired.*

### 10.1 Three places where this bar overrides a documented decision
Not oversights — the code argues for them. The bar wins, but a builder is
overriding a deliberate choice and **must say so in the handoff**, or the next
reader reverts it as vandalism.

- City surfaces get no rim because "a road with a stone frame around every hex
  is a tiled floor, not a street". **§3 overrides.**
- ~2 in 5 first-ring skirt cells are kept flush "so the edge of the play area
  dissolves". **§2's finite board overrides.**
- `drawFrame`'s near and side bands were deleted on purpose. **§7's frame
  overrides.**

---

## 11. The lesson this pass keeps re-learning

Three separate bugs in one day shared one shape: **a green test that drove the
function while nothing asserted the feature was reachable.** The dead element
bonuses. The harness rendering zero elemental tiles. A collect button in the
city economy that nothing ever called.

**A gate nobody has seen fail is not evidence.** Write the negative control:
mutate the real module, prove the check goes red, then trust it.

---

## 12. CROWDING — reading the board when units are bunched

Players report that when units bunch together they cannot see **where they can
move** or **what is around them**. Added 2026-09-15 at the owner's request.

### 12.1 What is NOT the problem — verified, do not "fix" it
- **Occupied tiles are already excluded from the move set.** `getValidMoves`
  has `if (getOccupant({x:nx,y:ny}, units)) continue`. The set is correct.
- **The contour already traces holes.** `teleContour` emits an edge wherever a
  neighbour is absent from the set, so a tile a unit stands on is already
  outlined around. The header calling it "the OUTER BOUNDARY" overstates it.
- So **do not re-derive reachability** and do not subtract occupancy a second
  time. The telegraph's own rule binds: every picture is a RENDERING of a set
  the game's rules produced, and a telegraph that computes its own answer is
  the bug rather than the fix.

### 12.2 The actual problem
**Every cue that answers "can I go here" is painted on the ground, and a body
standing on that ground covers it.** The hole in the move region is hidden by
the very unit that made it. At the current 34° pitch a sprite is tall relative
to a tile's on-screen depth, so each unit also hides the tile *behind* it and
part of the unit behind that.

### 12.3 The rules a fix is scored against
1. **A reachable tile must be identifiable without seeing its ground.** The cue
   has to survive a body standing in front of it — which means it lives ABOVE
   sprite height, or it does not solve the problem.
2. **It must not become the checkerboard.** A per-tile tint was already tried
   and rejected. Subtle, small, and quiet on an empty board.
3. **It must not lie.** Same Set, same instant, as the contour. A cue that can
   disagree with the contour is worse than no cue.
4. **Ownership must stay readable.** The blue/red directional foot rings exist
   because overlapping sprites made ownership ambiguous; nothing may bury them.
5. **A fix for occlusion must not hide the thing the player is looking at.**
   Fading or ghosting an occluder is legitimate; making the board mushy is not.
   Whatever is faded must still be identifiable as a unit, and as whose.
6. **Quiet at rest.** None of this may fire when nothing is selected. §9's
   "show the page at rest" applies to the board too: a still frame of an
   unselected board must look exactly as it does today.
7. **Measure the crowd, not the empty board.** Judge on a fixture with units
   adjacent and stacked front-to-back. A cue that reads beautifully on an empty
   board and vanishes in a scrum has failed the only case it was built for.
