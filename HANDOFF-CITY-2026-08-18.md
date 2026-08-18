# Node City rebuild — handover

Branch: `claude/city-builder-visual-upgrade-g9deb4`
Written 2026-08-18, after ~135 commits.

Everything below was **driven in a real browser** before being called done. Where
something is unverified or known-broken, it says so — the verified and the
believed are not mixed together anywhere in this document.

---

## 1. How to see any of it

```bash
node .gauntlet/capture.mjs .gauntlet/shots/x --tag x     # 3 framings of the real game
node .gauntlet/shot.mjs out.png --scene --wait 24000 --eval "<js>"   # drive one feature
```

`.gauntlet/README.md` documents the harness and the **six traps** that cost a
debugging round each. Read it before trusting any capture. The short version:

| Trap | Why it bit |
|---|---|
| The CDN is blocked | the page's import map needs three@0.171.0; the proxy 403s CONNECT, so it is served from a vendored tarball |
| Cost is checked at the bridge | `canAfford` calls `MythicCityBridge`, not `game.res` |
| Two municipal crew slots | the **third** placement in a row is refused; finish builds after every one |
| Road cap is bought with depots | so the order is forced: housing → depots → roads |
| **rAF never fires** | `manageAgents`, `agentTick`, `cullAgents` and `updateSky` all run only from `animate()` |
| **`estClock()` reads the wall clock** | every round was photographed at a different time of day until the clock was pinned |

## 2. Two syntax gates, and you need both

```bash
node _synckcheck.mjs           # the <script> blocks inside index.html
node .gauntlet/modcheck.mjs    # every ES module under public/src   (131 files)
```

`_synckcheck.mjs` does **not** look at `public/src`. That gap shipped a dark
feature: a backtick inside a CSS template literal stopped `power/panel.js`
parsing, the module failed at import, and node-city logged
`[Power] not mounted (non-fatal)` — byte-identical to what it logs when a module
is **absent**. The whole electricity feature reverted to its inline fallback
while the old gate reported ALL CLEAN.

That exact bug happened **three times** in this project. The guarded-import
pattern is right and stays; it just means a broken module is indistinguishable
from a missing one at runtime, so a parse error has to be caught before the
commit or not at all.

## 3. What is on the branch

18 feature modules under `public/src/`, each registered on a `window.Mythic*`
global, each guarded so a 404 costs the player that feature and nothing else.

| Module | Global | What it owns |
|---|---|---|
| `zoning` | `MythicZoning` | 11 zone ids (`r_low r_row r_apt r_high r_mixed r_lowrent c_low c_high o_low o_high i_mfg i_ware`), fill/marquee/paint, right-click de-zone |
| `demographics` | `MythicDemographics` | who moves in, by zone: 5 household archetypes, education→jobs, arrivals and departures |
| `streets` | — | street segmentation, auto-naming, the road modal, 24-bucket traffic ring |
| `outside` | `MythicOutside` | the highway, the Highway Interchange, the connection test, the trade gate |
| `power` | `MythicPower` | 9 plants (`wind solar coal gas oil geothermal hydro nuclear incinerator`), grid, HV/LV, bottlenecks, the info view |
| `water` | `MythicWater` | per-city deterministic hydrology, located aquifers, depletion and recharge |
| `pollution` | `MythicPollution` | air (wind-borne), ground, and the groundwater seep |
| `dossier` | `MythicDossier` | addresses, zone, level pips, residents, household, the books |
| `naming` | `MythicNaming` | every business named, renaming, the save shelf |
| `palette` | `MythicPalette` | per-building wall/roof/trim colour, Historical pin, reset |
| `transit` | `MythicTransit` | Bus Company and Rail Operator, stops, stations, player-built routes |
| `broadcast` | `MythicBroadcast` | Emergency Broadcast — the phone feed |
| `parking` | — | kerbside bays and parked vehicles |

Plus `city`, `economy`, `trading`, `community`, `resonance`, `nodes`,
`resources`, `sprites` from before this work.

## 4. The save layer — read this before wiring the cloud

`window.MythicCitySave` is a **shelf**: a module calls `register(key, {save,
load})` and node-city's `serialize()` collects everything into `payload.ext`
with **no edit to the serialize literal at all**. `payload.meta` is a
self-describing manifest of what is in it.

So the cloud side does not need to know the feature list. It needs `ext` and
`meta`. Every field is optional-with-a-default on load, and a save written
before any of this still opens — that was tested per module, not assumed.

**No Supabase migration was written.** Names, colours, zones, lines and
hydrology all ride inside the existing city save. If a table turns out to be
wanted, it ships as a numbered file in `/sql` with its RLS in the same file, per
CLAUDE.md — and RLS is the entire security boundary, so review every policy line
by line.

## 5. Decisions I made that you may want to overrule

Each of these was a real fork where the request did not settle it.

1. **Transit prices are corporate-scale.** 2,000,000 and 10,000,000 live in
   `OPS_ECON` (`public/index.html:80101`), the scale where a Stadium is 2.4M —
   not node-city's ÷2,000 building scale, where they would have made a bus
   company cost 1,000 city Cinder, cheaper than a Cinder Trust.
2. **Public transport can never profit.** Net is clamped to
   `min(0, fares − upkeep)`, so fares only reduce your subsidy. Letting it earn
   reopens the Cinder-faucet class of bug the retired Forge caused. One line in
   `routes.js ledger()` if you disagree.
3. **Auto-naming is procedural, not a live model.** Streets and businesses are
   seeded so names are stable across reloads and deduped per city. There is no
   reachable network from the game, so a model-driven name would be empty
   offline. Same call for the Broadcast feed's text.
4. **Household wealth is a quartile rank**, not fixed Poor/Modest/Comfortable
   tiers — fixed thresholds would be invented economy numbers and wrong at both
   ends of the game. One function in `dossier/zone.js`.
5. **Pre-existing saves are auto-connected to the highway.** A city that was
   trading yesterday does not wake up cut off. Flip it if you would rather live
   cities go build the ramp.
6. **Residence is derived, not stored** — so building or demolishing housing
   re-deals who lives where. A `home` field would make people stay put.
7. **Zoning does not read through until services do.** Population only grows at
   ≥90% food/water/health coverage, so zoning towers in a struggling city
   changes nothing visible. **The rule stands and is now VISIBLE rather than
   weakened** — `DEMAND_PER_POP` and the 90%/60% thresholds are untouched.
   node-city publishes its gate (`demogGrowth()`), `/src/demographics/gate.js`
   turns it into one sentence, and four surfaces print that one sentence: the
   People tab, the demand meter's causal list and its limit line, the zoning
   panel, and the map — zoned residential land is drained and marked ⏸ while
   the gate is shut. Driven, and the film measured against a control diff
   (`node .gauntlet/verify-zoning-film.mjs`).
   **The alternative nobody has taken:** let zoned land grow SLOWLY below the
   gate instead of not at all — e.g. scale `POP_GROW_PER_MIN` by coverage
   between the decline and grow lines rather than clamping to zero. Zoning would
   then always do something, the 90% line would become a rate rather than a
   switch, and every system priced against "a city under 90% does not grow"
   (the subsistence cap at 0.45, the anti-spiral ramps, the economy's labour
   forecasts) would need re-checking. That is the project owner's call, not a
   builder's.

## 6. Known-broken and unverified — do not ship without reading this

- **The economy suite has one failing round.** `node tools/economy-tests/run.mjs`
  → round 0b: `exactly one operation has no business, and it is bank` now sees
  `[bank, bus, rail]`. Transit added two licences without business entries. It
  may be correct that they have none — transit cannot profit by design, like
  `bank` — but the test and the code have to be made to agree deliberately.
- **Road condition does not move within a session**, despite a measured wear
  retune. The number is probably not the problem.
- ~~**Street names are painted on the tarmac.**~~ **FIXED, round 11 — deleted.**
  `public/src/streets/labels.js` is gone and every reference to it with it
  (the sync/orient hooks, the `lbl` save field, six `STREET.LABEL_*` constants,
  the harness's `orientLabels()` re-face). The naming FEATURE is untouched:
  names, renaming, auto-naming, the road panel and every address /src/dossier
  and /src/naming derive still work — verified in the browser after the
  deletion (11 streets, a rename round-trip, the panel, the dossier's
  `source: "streets"`). Nothing replaced the paint in the world: the road
  recipe's existing junction sign is the convention and its plate carries no
  text, which is also what Cities: Skylines II does.
- **The geology→water link is unverified.** `power/geology.js` turns `springfed`
  basins into hot-spring vents; both basins in the test city are
  `springfed:false`, so its output is byte-identical with and without the water
  module. It does not crash; that is all anyone has established.
- **The visual bar is not met.** See §7.

## 7. The visual loop — nine rounds, and what it actually learned

`.gauntlet/BAR.md` transcribes five Cities: Skylines II reference screenshots
into a 12-dimension rubric. Fresh-context critics score the real render each
round and A/B it blind against the previous one.

| Round | Mean | Stranger test | What it was |
|---|---|---|---|
| 0 | — | instantly | baseline capture |
| 1 | 3.63 | instantly | five builders, one file |
| 2 | 3.64* | instantly | lighting (*scored against a night frame) |
| 3 | 4.57 | instantly | the crowd reaches the film |
| 4 | 4.83 | instantly | parcels |
| 5 | 4.67 | instantly | the ground |
| 6 | 5.08 | instantly | UI legibility, and the demand panel |
| 7 | 5.17 | instantly | the plot, measured |
| 8 | **5.67** | instantly | crowd, lot, massing, road text |

"Stranger test": shown our frame beside a real CS2 screenshot, does a stranger
pick the real game instantly, after a moment, or not at all. **It has been
"instantly" every round.** The bar is not met.

### 🔴 The standing verdict, and it changed twice — read all three

1. **Round 5's critic said STOP and change approach.** Gains had fallen to
   +0.08/round and it observed that "the loop is now producing work that
   satisfies the commit message and not the image."
2. **Round 6 tested that** by taking the one dimension nobody had touched — UI
   legibility, 2 for five rounds — and it went 2 → 6 for pure DOM work. Its
   critic put the pipeline's ceiling at a mean of ~5.5 and said the next
   decision was to **fund an asset kit**.
3. **Round 7's critic OVERTURNED that**, and this is the verdict that stands:

> The claim was "a hard cap around 6 on any dimension whose 10 is modelled
> detail." Dimension 3 — building silhouette, which is nothing but modelled
> detail — is at 7 today, procedurally, with no asset kit. **The pipeline has
> already cleared the cap it was said to be under.**
> The realistic ceiling is a mean of **6.3–6.6**, not 5.5, and the path from
> 5.17 to roughly 6.0 costs **no new art**.
> **Do not fund the asset kit this round.**

**Round 8 tested that prediction and it held** — 5.17 → 5.67, with all four
targeted dimensions moving fast and cheap. Its critic's method for telling "the
estimate was wrong" from "the work did not land" is the best reasoning in the
loop: *if the ceiling were wrong, the targeted dimensions would have REFUSED to
move — you would fix the crowd and citizens would crawl 3 to 4 because the mesh
itself caps it.* They didn't; they jumped.

**So the current recommendation is: keep going, cheaply, and fund art later.**
Six of twelve dimensions still have a named fix costing no new geometry. The
real wall is narrow and specific — window reveals and sills, car glazing and
rims, tree crowns needing cards or imposters — and those three will pin the mean
near 6.5 and keep 8+ permanently out of reach.

The honest alternative remains open and is worth considering on its merits:
**move the bar.** Declare the target a stylised low-poly city that reads well at
the aerial camera — which this genuinely almost is — and stop scoring it against
frames it will never match.

### 🔴 The methodological lesson: measure before you rebuild

**Twice a critic scored a regression that was a random draw.**
- Round 6's "deleted" street-tree pit: `makeTree2`'s paved branch was
  byte-for-byte round 4's. The tile lost a `Math.random` coin flip between two
  captures.
- Round 8's "vanished" crowd: a with-crowd/without-crowd pixel diff read 2,934 px
  and forcing every agent visible read **the same 2,934 px**, so nothing was
  hidden. Exporting the round-6-era tree and running the identical diagnostic
  gave statistically identical results. Fourteen pedestrians over 100 road tiles
  is one per seven; whether a 220×100 crop contains one is a coin flip.

**And twice work was built correctly and never measured.**
- Rounds 4 and 5 both built property boundaries; three critics reported them
  absent. Round 7 measured: a citizen is `.26` tall, a storey `.34`, and the
  hedge topped out at `.086` — **ankle height**. Correct in shape, 2.5× too short.
- Round 7 then found three bugs that had shipped: `bt`/`edge`/`sEdge` declared
  *below* the driveway that must fit inside them, so privet grew through the
  drive of every hedged plot; flank palings planted on `edge` while their rail
  sat on `sEdge`, merging every side fence with its neighbour's into one
  unbroken run — literally the artefact round 4's critic described, still in the
  code three rounds later; and a "dropped kerb" laid *under* the driveway, 7 thou
  below the thing covering it, never once visible.

### The engine findings worth keeping regardless

- **Shadows were never drawn.** three r171's WebGPU node pipeline reads a light's
  shadow from the shadow target's *colour* attachment; the WebGL2 backend runs
  that pass depth-only, so the term collapsed to a constant and every shadow was
  multiplied away — while the depth pass was drawn and discarded every frame.
- **Every mapped surface rendered at 58% of its albedo.** `_grey()` centred each
  shared texture canvas on 0.78 sRGB while documenting it as "centred on 1.0";
  a map decodes to linear first, and 0.78 sRGB is 0.578 linear.
- **The harness lied four ways at once**, and later a fifth time: agents
  censused before the roads existed, never stepped, culled invisible against a
  stale camera, framed by a camera OrbitControls clamped above the rooftops —
  and separately, every round photographed at whatever wall-clock hour it ran.
- **A `GridHelper` breaks raycasting.** `Raycaster` hits `Line` objects, and this
  scene has one lying flat across the whole map; without an `isMesh` filter the
  speech-bubble occlusion test killed the feature citywide.

### What is genuinely good — the critics' own words

Asked what a stranger would not improve, round 7's and round 8's critics named
the same two things:

- **The roads.** Kerb and gutter, sidewalk both sides, grass verge, double-yellow
  centre line, dashed lane lines, edge lines, zebra crossings, and tyre-wear
  tracks polished into the asphalt. "Nearly the whole of reference frame 3's road
  spec, delivered with decals and extruded profiles and no art budget."
- **The building silhouettes**, at 7 — the highest score on the board. Hipped,
  gambrel and cross-gabled roofs, dormers with their own cheeks, capped chimneys,
  porticos with real columns, bay windows, a mansard. "Not one building in the
  built area is an extruded box with a flat lid… It has been quietly good for
  several rounds and no critic has said so."

### Known regressions carried into round 9

- UI legibility fell 6 → 4 when round 8's massing work re-laid the demand strip
  and it lost its labels and causal lists.
- Front-garden greenery fell from 13.9% to 8.3% of the residential band.
- The standing crowd is ~1.5–2× oversize, one frozen pose, and unweighted, so
  figures stand alone on verges beside roads through empty fields.

## 8. If you pick this up

The loop is reproducible. `.gauntlet/rounds.json` is the record,
`.gauntlet/progress.mjs` renders it, and a round is: build one piece → capture →
hand fresh critics `BAR.md` and the two frames → take their `biggestGap` as the
next brief. The critics have been right every time they disagreed with a
builder, including about my own harness.

Two habits earned their keep and are worth continuing:

- **Drive the feature, do not read the diff.** Every real bug in this branch was
  found by running the game, and several were found by measuring pixels rather
  than by looking at them.
- **Make the fallback loud.** A guarded read that silently substitutes a
  plausible value is indistinguishable from a working integration. Every address
  in the game was fictional for a while because a probe called `nameAt(x, z)`
  when the API is `nameAt("x,z")`, and nothing anywhere said so.
