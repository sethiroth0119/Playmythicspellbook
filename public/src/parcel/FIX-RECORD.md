# ⚠ READ THIS FIRST — findings 2 and 3 below were acted on in round 12

Both were **right that something was wrong** and both are why the harness got
fixed. Finding 2's diagnosis was incomplete and finding 3's was mistaken, and
the corrections are recorded here rather than in the round report because this
is the file the next reader will find.

**Finding 2 (the scene is not building the district it claims to) — CONFIRMED,
and it was four separate causes, not one.** Everything in that section is
accurate as a description. The one thing it does not say is *why*, and the
assumption in the room was "the municipal ceiling, as usual". Measured by
capturing the game's own refusal sentence per tile through
`window.__ncToastSink`: `retail`, the trees, the bushes, the gardens and the
fountain were refused by **/src/progression**, not by the ceiling; `tenantbiz`
is **not a building at all** (it is the mesh name for a leased `lot`, so
`tryPlace` returned at `if (!def) return` and never spoke); only `shop`, `arena`
and `medlab` were the ceiling. And behind the ceiling sat a fifth refusal that
no map could show, because it emitted nothing: **headless Chromium
auto-dismisses `window.confirm`**, so `bldConfirmLong()` was answered *Cancel*.
The standard scene now places 218 tiles and 31 non-housing buildings, three
Retail Parades and three shops among them. See `.gauntlet/README.md`, "Why the
district was a warehouse estate".

**Finding 3 (cross-boot diffs are noise-dominated) — CONFIRMED. The named cause
is WRONG.** `perimeterScenery` does not roll from `Math.random`; every roll in
it goes through `rdRng`, the file's own lattice hash, and its two merged buckets
hash **identically** across two boots (checked per scene-graph group, not
inferred). The `Math.random` treeline it replaced is what the memory is of — its
own header says so. Hiding every agent, every parked vehicle and the whole
standing crowd moves the cross-boot figure from 14.70 pp to **14.68 pp**, so the
moving things are not the cause either. The real cause is that **every pixel
moves a little**: `estClock()` runs on wall time, two boots reach the shutter a
few seconds apart, and a mean delta of ~2.7/255 across the whole frame trips a
6/255 threshold on a seventh of the image. Nothing can be seeded to fix that, so
nothing in `node-city/index.html` was changed for it; the percentage has been
retired and the gate kept as a **relative** tripwire. The single-boot A/B this
section correctly recommends is now a tool — `.gauntlet/layer-ab.mjs` — and it
is stronger than described: driven with `renderer.render()` and the pixel read
**in the same task**, the do-nothing control is *exactly 0*, not a floor.

**Finding 1 (`/src/parcel` is dead on this district) is now worth re-running.**
It was measured on a district of 14 non-housing buildings, 13 of which carry
`HAS_OWN_GROUND`. There are 31 now, including three Retail Parades, three shops,
a tenant business, an arena and a med lab. The "20 triangles of flat parcel
across the entire city" number is from the old scene and should not be quoted
again without re-measuring.

---

# 🔴 Two findings here matter more than the parcel work itself

The round-9 retry at rubric dimension 5 ("The plot") came back with a **5.5, not
6**, and with two discoveries that are worth more than the geometry it shipped.
Both are recorded next to the code because both will otherwise be re-derived.

## 1. `/src/parcel` is effectively dead on the district a critic photographs

Measured on the standard gauntlet scene: the layer lays **20 triangles of flat
parcel across the entire city** — one vacant lot's worth.

`HAS_OWN_GROUND` has grown (round 11 added `retail` and `depot`) until it swallows
**13 of the 14** non-housing buildings that actually place. So the surface, drive
and lot-line half of the layer — the half its own header measures at "430,854 vs
428,818… about 250 a parcel" — never runs.

The header is stale in the other direction too. It claims *"54 housing tiles carry
a parcel and 24 shop/depot/civic tiles carry none"*. There are **14**, not 24, and
**13 of them carry their own ground**.

**And the literal rubric sentence is already satisfied.** No building in this
district stands on bare terrain. What is missing is not ground — it is
*articulation*: every building in the city, of every class, meets its ground with a
hard corner and nothing in the join. That is what the foundation edge addresses,
and it is a different problem from the one the module was written for.

⚠ This was **diagnosed and worked around, not fixed.** The layer that shipped last
round to move this dimension is still, on this district, two draw calls of fences
and props.

## 2. 🔴 THE SCENE IS NOT BUILDING THE DISTRICT IT CLAIMS TO

Of 201 tiles placed: **54 housing, 130 road, 3 anchor, and 14 non-housing
buildings** — 9 depot, 3 motorpool, 1 farm, 1 vacant lot.

**Refused:** `retail`×3, `shop`×3, `tenantbiz`, `arena`, `medlab`, 2 gardens,
3 trees, 2 bushes.

`scene.js` documents the three Retail Parades as its high-street row and asserts
they are under the municipal ceiling. They are not placing.

So every visual round for some time has been judged on **a district of nine
warehouses, three car parks and a suburb** — with no shops, no arena, no medical
lab, and no ornamental planting. "Density & zoning read" is a rubric dimension that
asks whether a viewer can tell commercial from industrial from the air. There is no
commercial.

**This is the highest-value thing to fix in the harness**, and it is worth more
than any amount of further parcel geometry: a district that cannot show a shop
cannot demonstrate that every building owns its parcel, however good the parcels
are.

## 3. 🔴 CROSS-BOOT PER-FRAMING DIFFS ARE NOISE-DOMINATED ON THIS SCENE

The `capture.mjs --against` gate compares two boots. **`perimeterScenery` rolls
from `Math.random` and fills the aerial's background.**

Measured: a **parcel-only** change that a single-boot A/B puts at **2.45 pp** on the
aerial reads **18.9 pp** across two boots.

The `--against` figures from this round (aerial 19.9 / street 7.7 / district 14.3)
are therefore not a result and were not quoted as one.

⚠ `.gauntlet/README.md` presents the per-framing diff gate as the answer to round
5's missed regression. It is still useful as a *tripwire* — "this framing moved
much less than that one" — but a per-framing percentage from it is not a
measurement of a change. **The single-boot A/B (toggle `group.visible`, read
`renderer.info` three times back-to-back before any screenshot) is the instrument.**

🐞 And one trap inside even that: the first cut interleaved read → shoot → read and
reported `dMeshes −12` on the district, i.e. the layer apparently making the scene
*cheaper*. That was agents being culled differently during a 40-second screenshot.
Take all the reads together, before any capture.

## What the round actually shipped

A **foundation edge** — the only element of a parcel that can reach a tile a recipe
already paved edge-to-edge, because it does not live at PAD height: a solid kerbed
bed with shrubs standing in it, *above* whatever the recipe poured. 80 cells over
10 of 14 tiles. Plus, in `makeHousing`, foundation planting, bins for `row` (11
plots that had none) and a rear boundary run — 18 forecourt plots that round 10's
garden-plot fix had excluded by predicate. All into buckets those plots already
emit: **0 new meshes, 0 materials, 0 draw calls.**

Three bugs found on the way, each invisible in a screenshot: a **bounding box** is
useless for a footprint here (a motor pool's merged bucket reads `halfX .615` — one
bucket is the union of a shed, a canopy, a fence and a gantry); a **vertex** raster
leaves wall interiors empty and puts the edge *inside* the shed; and without a
**flood fill from the tile edge**, beds land in the gaps between a depot's roof
plant and inside a farm's crop rows.

`verify()` was added — the module shipped without one, which a critic named on
`/src/wild`. It proves the non-overlap claim (every pair of flat rectangles tested
for same-height overlap, the `/src/wild` coplanar defect) rather than asserting it.

## The four reasons it is 5.5 and not 6, in the builder's own words

- **The aerial shows nothing**, and that is where this dimension is scored.
- **The depot dock frontage is deliberately bare** — vetoing it fixed a bed that
  read as a plank lying across the loading bay over the hazard chevrons — and
  depots are 9 of the 14 non-housing buildings.
- **`row` and `walkup` still have no lawn, no drive, no tree.** Correct
  urbanistically; the rubric names lawn and driveway.
- **Finding 1 above was worked around, not fixed.**
