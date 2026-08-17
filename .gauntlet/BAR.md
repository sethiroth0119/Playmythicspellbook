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
