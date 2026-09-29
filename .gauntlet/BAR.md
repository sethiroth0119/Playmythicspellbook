# THE BAR — Cities: Skylines II

This is the quality bar for the Node City visual upgrade. It is a **written
transcription of five reference screenshots** the user supplied, because the
images themselves cannot be handed to a subagent. Every line below describes
something actually visible in one of those frames. Treat it as the ground
truth a critic scores against.

---

## The five reference frames

### 1. Industrial district, low aerial (afternoon, overcast-neutral)
- A **green corrugated-metal warehouse** with a flat grey roof, occupying most
  of the frame. The corrugation is a real ribbed normal detail, not a stripe
  texture — you can see the ribs catch light differently on the sunlit vs
  shaded wall.
- **Roof clutter is the signature**: HVAC boxes, vents, ducting runs, skylights,
  a roof hatch. No industrial roof in the reference is a bare plane.
- **Four roller-shutter loading doors** in a row, each with its own recessed
  reveal, a concrete dock apron and a painted **yellow-and-black hazard chevron**
  on the ground in front of them.
- Behind: a chemical plant with **cylindrical tanks, stacks, pipe bridges**;
  further back, a container yard with stacked coloured containers.
- A single **street lamp on a tall mast** in the foreground — the pole is thin,
  round, and has a visible base plate and a curved arm.
- A white pickup truck on the road. Road has a **solid white edge line and a
  dashed centre line**, both slightly worn.
- Asphalt is **desaturated warm grey**, not purple. Concrete aprons read a
  half-stop lighter than the road.

### 2. Citizen selection panel (street level, night, wet road)
- A **named citizen** ("TIMOTHY CROSBY") with a full dossier: mood, age,
  education, college, household, household wealth, residence address,
  occupation, destination — every one of them a **clickable cross-link**.
- The citizen is an individual **character model with a backpack and blonde
  hair**, casting a real shadow, standing on a marked crossing.
- Traffic queued at the crossing: ~12 **distinct car models** in distinct
  colours (red, yellow, white, blue, grey, black), each with visible glazing,
  wheels with rims, mirrors, and separate head/tail light lenses. Two
  motorcycles. Vans and hatchbacks alongside sedans.
- The road is **wet-dark with reflective blue lane markings**; headlights throw
  visible pools.
- UI: a **blue teardrop map pin** floats over the selected citizen.

### 3. Suburban residential, autumn, golden hour
- **Detached family houses, each visibly different**: gables, dormers, porches
  with columns, bay windows, chimneys, attached garages with panelled doors.
  White clapboard, brick, and dark-stained siding all present in one street.
- **Roofs are the strongest read**: pitched, hipped, cross-gabled, with visible
  shingle texture, ridge lines, eaves overhang and gutters. **Solar panels** on
  several roofs.
- Every house has a **plot**: mown lawn, a driveway of a different material than
  the road, a **clipped hedge or low fence on the property line**, foundation
  planting, a path to the front door.
- **Autumn deciduous trees** in orange/yellow alongside dark conifers — trees
  have a real crown silhouette, not a cone.
- The road **curves**, has a **double yellow centre line**, white edge lines, a
  **painted turn arrow**, a **zebra crossing**, and a proper **kerb with a
  gutter line**. Sidewalks run both sides, separated from the road by a grass
  verge.
- Long **golden-hour shadows** rake across the road from the trees and houses.
  Sun is warm; shadows are cool blue, not black.

### 4. City Information / Demand panel (UI reference)
- A **modal with tabs** ("DEMAND", "CITY POLICIES"), a right-hand detail pane.
- Four demand bars — **Medium Density Residential, High Density Residential,
  Commercial, Industrial** — each a **coloured arrow-shaped meter** (green for
  residential, blue for commercial, yellow for industrial).
- Beside each bar, a **signed causal list**: what is pushing demand up and what
  is pushing it down, e.g. Commercial `− Low-skill Labor Availability`,
  `− Gas Station Availability`, `+ High-skill Labor Availability`,
  `+ Local Demand`, `+ Taxes`.
- The detail pane explains the selected demand type in plain prose.
- A **bottom status bar**: pause/speed, weather + temperature, city name,
  population with `+/hr` delta, treasury with `+/hr` delta, and a row of
  service-status dots.

### 5. Office / light-commercial district, low aerial (day)
- **Low-rise offices and retail**: 3–5 storey blocks with **continuous glass
  curtain walls**, coloured spandrel panels (magenta, orange), and flat roofs
  covered in **solar arrays and plant rooms**.
- **Ground-floor retail signage** — coloured fascia bands with legible signs.
- Every block sits on a plot with **its own surface car park**, marked with
  **white bay lines**, kerbed islands and planted trees in the islands.
- Sidewalks, street trees at regular spacing, bus-stop shelters.
- Materials are **naturalistic**: warm grey concrete, dark grey asphalt, real
  glass with sky reflection. No global purple cast.

---

## The scoring rubric

A critic scores each dimension 0–10 against the frames above.
**We "win" a dimension at 8+ and only when the critic cannot name a gap that a
first-time viewer would notice in a side-by-side.**

| # | Dimension | What 10 looks like |
|---|---|---|
| 1 | **Palette & grade** | Naturalistic. Sky blue, asphalt neutral grey, foliage green, brick red-brown. No global purple/violet cast. Sunlit and shaded faces clearly differ. |
| 2 | **Lighting & shadow** | A single strong warm key with cool ambient fill. Long soft-edged shadows that ground every object. Sky ambient, not flat hemisphere. |
| 3 | **Building silhouette** | Pitched/hipped/gabled roofs, dormers, chimneys, eaves, setbacks. Nothing reads as an extruded box with a flat lid. |
| 4 | **Building surface detail** | Window reveals with frames and sills, doors with surrounds, gutters, downpipes, balconies, roof clutter (HVAC/solar/vents), fascia signage. |
| 5 | **The plot** | Every building owns its parcel: lawn, driveway, path, hedge/fence, foundation planting, bins, parked car. No building sits on bare ground. |
| 6 | **Roads** | Kerb + gutter, sidewalk both sides, verge, centre line (dashed or double-yellow), edge lines, crossings, turn arrows, stop bars, worn/dirty asphalt. |
| 7 | **Street furniture** | Lamps with proper mast + arm + base, signs, hydrants, bins, benches, bus shelters, utility cabinets — placed, not scattered. |
| 8 | **Vehicles** | Multiple distinct body types (sedan/hatch/van/pickup/bus/truck), glazing, rims, mirrors, lens-separated lights, varied paint. |
| 9 | **Citizens** | Readable human silhouette with head/torso/limbs, varied clothing colour, varied height/build, a walk that isn't a slide, ground shadow. |
| 10 | **Vegetation** | Trees with a real crown silhouette and trunk taper, several species, seasonal colour, hedges, mown lawn vs rough grass. |
| 11 | **Density & zoning read** | A viewer can tell residential from commercial from industrial from the air, and low density from high density, without the UI. |
| 12 | **UI legibility** | Panels are readable at a glance; demand/economy state is expressed as a meter with a signed causal list, not a raw number. |

---

## The feature bar (from the user's CS2 spec)

Visual quality is the headline, but the user also named specific systems.
These are judged as *shipped and working*, not as visual polish.

### Resource chain
Raw: Wood, Grain, Livestock, Vegetables, Cotton, Crude Oil, Metal Ore, Coal,
Rock, Water.
Processed: Minerals, Concrete, Machinery, Petrochemicals, Chemicals, Plastics,
Pharmaceuticals, Electronics, Vehicles, Beverages, Convenience Food, Food,
Textiles, Timber, Paper, Furniture.
Immaterial: Software, Telecom, Financial, Media, Lodging, Meals, Entertainment,
Recreation.

⚠ The repo already carries 258 chain ids in `public/src/resources/chain.js` and
50 industries in `public/src/economy/recipes.js`. **The bar is to wire the
listed set through to the city builder, not to invent a second catalogue.**
`RESOURCES_NEXT.md` names the five sites each promotion has to touch.

### Zone demand
Residential demand rises with jobs; commercial demand rises with residents and
with local industrial output; industrial demand rises with commercial demand.
Taxes adjustable per education level and per goods type, moving demand.

### Zoning tools
Fill (flood a contiguous zoned area), Marquee (rectangle), Paint (single cell).
**Right mouse button de-zones with whichever tool is active** — no separate
de-zone tool. Changing zone type does not require de-zoning first.

### Zone types
Residential ×6: low density detached, medium density row housing (wall-to-wall),
medium density apartments, high density towers, mixed (retail ground floor +
apartments above, answers BOTH residential and commercial demand), low rent.
Commercial ×2 (low/high density). Office ×2 (low/high density).
Industrial: manufacturing + warehouses.

### Architectural themes
North American and European, chosen at city start, affecting building style,
street markings, roadside props and service vehicle look. The zoning tool can
place either theme regardless of the city default.

---

## How a critic must judge

1. **Look at the real output.** Run the harness (`.gauntlet/README.md`) and open
   the PNGs. Never score from a diff or a description.
2. **Blind A/B where possible.** Compare the round-N shot against the round-N−1
   shot with the labels stripped, decide which is closer to the frames above,
   and say why in one sentence.
3. **Name ONE biggest remaining gap**, concretely enough to build against —
   "the roofs are flat lids with no eaves or ridge" beats "buildings need work".
4. **Score every dimension** in the table, even the ones this round did not
   touch, so regressions elsewhere are caught.
5. **A round that broke the page scores 0.** `node _synckcheck.mjs` must pass
   and the harness must still produce a non-blank render.


---

<!-- ══════════════════════════════════════════════════════════════════ -->
# PART TWO — the tactical battlefield (merged in from the hex branch)

Both branches independently wrote a file called `.gauntlet/BAR.md`, so this document is
a UNION, not a rewrite. Everything above is the city/stage document this repo
already shipped; everything below arrived with the hex battlefield and is
scoped to `public/battle-board/`. Where the two disagree about THE BAR,
the section that names the subsystem you are working on is the one that binds.

⚠ Their runbook refers to `.gauntlet/shot.mjs` and `.gauntlet/probe.mjs`. Those
names were already taken by our Node City rigs, so their versions now live at
`.gauntlet/stage-shot.mjs` and `.gauntlet/stage-probe.mjs`.
<!-- ══════════════════════════════════════════════════════════════════ -->

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

---

## Standing constraint, restated by the user (binding on every piece)

> "I want to make sure I keep all of the functions of the battlefield. Just when a
> unit or hero moves have an arrow show where they are going or where they are
> attacking like how games like XCOM have it. Make the UI where it fits this style
> and keep all of the gameplay the same but for this battlefield and new changes."

Three things follow, and every critic applies them:

1. **Nothing is removed.** Every battlefield function that worked before must still
   work: summon, move, attack, abilities, consumables, fusion, traps, walls,
   tombstones and looting, the hover action menu, unit details, placement, the hand
   and rail, end turn, the AI, replays, and multiplayer broadcast. A piece that
   improves the look and quietly drops a feature is a `fail`, not a tradeoff. When
   a piece cannot preserve something, it says so out loud instead of deleting it.
2. **Movement and attack telegraph with an arrow.** Selecting a move shows the route
   the unit will actually walk, ending in a destination marker; selecting an attack
   shows an arc to the target. XCOM-style, and derived from the real path the game
   will take — not a straight line drawn between two points, which would be another
   way for the UI to lie about the rules.
3. **The UI matches the new battlefield.** The HUD, panels and markers are restyled
   to sit with the post-apocalyptic field rather than fighting it, using the existing
   battle chrome tokens in CONTRACT.md §6. Restyled, not rebuilt — the panels keep
   their functions and their positions.

