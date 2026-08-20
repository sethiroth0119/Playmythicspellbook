# THE BAR — what "wins" means

Every critic judges against this file. It is derived from three reference images the
user supplied plus their written brief. Critics cannot see the images; this is the
image. Do not soften it, do not re-interpret it, do not grade on effort.

---

## R1 — Final Fantasy Tactics / Tactics Ogre Reborn (the BATTLEFIELD bar)

What the reference actually shows:

- **The map IS the frame.** The diorama fills the screen edge to edge. There is no
  small board plate floating in the middle of a painting. The world is the board.
- **Real elevation.** Terrain is built from chunky slabs at several heights with
  *visible cliff faces* — the vertical side walls are lit differently from the tops,
  and they cast hard shadows onto the level below. Height is readable at a glance.
- **Surface variety within one map:** rock plateau, dirt shelf, grass shelf, and a
  wide marsh floor of green-teal water flecked with algae blooms and pale scum.
- **Props sit ON the terrain and read as silhouettes** — bare dead thorn bushes,
  scattered stones. They are small, numerous, and irregularly placed. They break up
  the grid without hiding it.
- **Units are SMALL relative to the map** (roughly 1/12 of frame height) and still
  perfectly crisp — hard pixel edges, no blur, strong single-color silhouettes that
  separate from the ground. Party clustered on one shelf, enemies scattered across.
- **Palette is muted and desaturated** — mossy greens, wet browns, cool grey-blue
  shadow. One value range; nothing neon. Soft rain streaks and a heavy vignette.
- **Camera is a low isometric three-quarter**, roughly 40° down, and the whole
  diorama is a single object you could rotate.

**Fail conditions:** a flat plate; a grid drawn on a photo; uniform ground with no
elevation; giant units that dwarf the terrain; saturated fantasy-purple lighting;
props evenly spaced on a lattice.

---

## R2 — Fire Emblem: Three Houses (the TELEGRAPH + UI bar)

- **The grid is explicit and legible** — discrete cells, tinted as translucent
  overlays that follow terrain, never as a wireframe floating above it.
- **Threat range is a painted region**: enemy reach shown as a red/orange wash over
  every reachable cell at once, with a brighter border on the region's outer edge.
- **The target cell is separately highlighted** (yellow) inside the red wash, so
  "where I will stand" and "what I threaten" are two different colors.
- **A floating cursor diamond** marks the active target above the unit.
- **The attack telegraphs as an ARC** — a curved line from attacker to target,
  drawn above the board, colored by ownership. Not a straight laser.
- **Combat forecast panel**: both portraits face each other, HP now → HP after,
  and the numbers that matter (Mt / Hit / Crit) in a tight column. The player can
  see the outcome *before* committing.
- **Unit feet carry a directional ring** (blue = mine, red = theirs) so ownership
  reads even when sprites overlap.
- Chrome is dark, hard-edged, with a thin bright keyline. No soft rounded cards.

**Fail conditions:** range shown only per-hovered-tile; attack shown as a straight
line; no pre-commit forecast; ownership legible only from sprite art.

---

## R3 — XCOM 2 (the OBJECTIVE + PATH bar)

- **Objective banner top-left**, with a checkbox and one plain sentence of what
  must happen. Persistent, never modal.
- **A countdown top-right** with a big number in a ring — the pressure clock.
  ("Turns until completion: 14.")
- **Movement range is a glowing CONTOUR**, one continuous cyan polygon traced
  around the whole reachable region on the ground — not a checkerboard of tiles.
  A second, dimmer contour marks the dash/extended range.
- **A path line runs from the unit to the cursor** along the actual route it will
  walk, ending in a marker at the destination. The player sees the *route*, not
  just the endpoint.
- **Enemy nameplates float above units**: name in caps, a segmented health bar,
  and pip icons for armor/shields. Readable at distance.
- **Flanking chevrons (`>>`)** appear beside a unit when it is exposed.
- **Selected unit portrait bottom-left**, ability row bottom-center with numbered
  slots and charge counts, weapon bottom-right.
- Environment is a real place — cars, hydrants, wet asphalt — not an arena.

**Fail conditions:** range as a tile checkerboard; destination-only preview with no
route; enemy health only visible on hover; objectives hidden in a menu.

---

## The user's own words (verbatim requirements)

1. Full-field **hex** grid map, "a mixture of the best elements of XCOM, Fire
   Emblem, and Final Fantasy Tactics."
2. **Camera: WASD moves it, Q/E turns it.** A nice size map.
3. **Sprite units and hero stay sprites** — "extremely clear and high quality on
   the board" — while the battlefield itself is beautiful.
4. **Post-apocalyptic world.** Ground is dirt, cracked street, rubble, and grass
   where nature is taking over.
5. **Five lootable ruins, visibly destroyed:** a car, a church, a school, a
   hospital, and a house.
6. **Looting a ruin = the tombstone interaction, exactly.** It must call the real
   `_lootGridOpen` so resources appear in the grid the player can take from and
   swap their own loot into. Not a copy, not a lookalike — the same function.
7. **Three control points, which are SCP trucks with nodes.**
8. **Capture scoring:** each turn a player holds a control point they gain a
   point; when they lose it they lose the point. Holding **two of the three for
   three straight turns wins the match** — a victory path that does not require
   killing the enemy hero.
9. **Move and attack telegraph with an arrow**, XCOM-style, showing where a unit
   is going or what it is attacking.
10. **The UI fits this style**, and **every existing battlefield function keeps
    working.** Gameplay otherwise unchanged.

---

## How a critic decides

1. **Run the real thing.** `node .gauntlet/shot.mjs <path> <out.png> [w] [h] [ms]`
   renders the actual page in real Chromium at 2× and writes a PNG. Look at it.
   A critic who did not open an image has not critiqued.
2. **Blind A/B.** Put the new capture beside `.gauntlet/baseline-stage.png` and the
   bar above. Ask: if a stranger saw these two and the reference description, would
   they pick ours? Answer honestly. "Improved" is not "wins."
3. **Name ONE biggest remaining gap.** Not a list of twelve nits — the single
   change that would move it furthest toward the bar. Be concrete about what is
   wrong and what the fixed version looks like.
4. **Regression check is part of the verdict.** If a piece broke an existing
   battlefield function, the verdict is `fail` no matter how good it looks.
5. Verdicts: `pass` (wins against the bar), `rework` (real progress, gap named),
   `fail` (broken or regressed).
