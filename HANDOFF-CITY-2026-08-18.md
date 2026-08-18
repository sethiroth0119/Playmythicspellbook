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
   changes nothing visible. That may be exactly right; it is stated because it
   makes the zoning tools feel inert early.

## 6. Known-broken and unverified — do not ship without reading this

- **The economy suite has one failing round.** `node tools/economy-tests/run.mjs`
  → round 0b: `exactly one operation has no business, and it is bank` now sees
  `[bank, bus, rail]`. Transit added two licences without business entries. It
  may be correct that they have none — transit cannot profit by design, like
  `bank` — but the test and the code have to be made to agree deliberately.
- **Road condition does not move within a session**, despite a measured wear
  retune. The number is probably not the problem.
- **Street names are painted on the tarmac.** No city game does this. Fixed
  orientation and scale, but the critic's position is that it should not be
  there at all.
- **The geology→water link is unverified.** `power/geology.js` turns `springfed`
  basins into hot-spring vents; both basins in the test city are
  `springfed:false`, so its output is byte-identical with and without the water
  module. It does not crash; that is all anyone has established.
- **The visual bar is not met.** See §7.

## 7. The visual loop — it ran five rounds and then stopped, on advice

`.gauntlet/BAR.md` transcribes five Cities: Skylines II reference screenshots
into a 12-dimension rubric. Fresh-context critics score the real render each
round and A/B it blind against the previous one.

| Round | Mean | Stranger test |
|---|---|---|
| 0 baseline | — | instantly |
| 1 | 3.63 | instantly |
| 2 | 3.64 (scored against a night frame — see below) | instantly |
| 3 | 4.57 | instantly |
| 4 | 4.83 | instantly |
| 5 | 4.67 | instantly |

"Stranger test": shown our frame beside a real CS2 screenshot, does a stranger
pick the real game instantly, after a moment, or not at all. **It was "instantly"
every round.** The bar was not met.

**The round-5 critic recommended STOP AND CHANGE APPROACH**, and its evidence is
worth more than its conclusion:

> Rubric sums on my own consistent scale: r3=53, r4=55, r5=56. Five rounds of
> hand-authored geometry and shader tweaks bought +0.08 on the last iteration.
> Two consecutive rounds shipped commits titled "give every building a parcel"
> and "give every lot an edge", and I cannot see a lot edge in either round at
> the camera the game renders at. **The loop is now producing work that
> satisfies the commit message and not the image.**

The score column splits cleanly and that split is the real finding. Everything
about **objects** climbed and is nearly done — silhouette 4·7·6·6·6, roads
4·6·6·7·7, street furniture 3·5·6·6·7. Everything about the **world between
objects** never left the floor — the plot 3·4·2·2·3, citizens 2·2·0·3·2, zoning
read 2·2·3·3·3, UI legibility 4·2·2·2·2.

Round 5 also proved the ceiling from the other side: it **worked** and the
stranger test still did not move. The round-4 sentence — "the ground is one flat
colour and nothing is rooted in it" — is dead, settled on pixels: one sightline
down the aerial ground read 133/146/124 luminance in r4 (a 22-unit random wobble
with no depth direction) and 143/131/93 in r5 (a monotonic 50-unit falloff);
across 30k grass samples far/mid/near spread went 2.7 → 28.9 and distinct
colours 261 → 3472.

### The four findings worth keeping even though the loop stopped

- **Shadows were never drawn.** three r171's WebGPU node pipeline reads a light's
  shadow from the shadow target's *colour* attachment; the WebGL2 backend runs
  that pass depth-only, so the term collapsed to a constant and every shadow was
  multiplied away — while the depth pass was drawn and discarded every frame.
- **Every mapped surface rendered at 58% of its albedo.** `_grey()` centred each
  shared texture canvas on 0.78 sRGB while documenting it as "centred on 1.0";
  a map decodes to linear first, and 0.78 sRGB is 0.578 linear.
- **The harness lied four ways at once.** Two rounds scored vehicles and citizens
  at zero against a city whose crowd existed the whole time: censused before the
  roads were built, never stepped, culled invisible against a stale camera, and
  framed by a camera OrbitControls clamped above the rooftops.
- **The harness read the wall clock.** Every round was photographed at whatever
  hour it happened to run, so round 2's lighting was tuned at 15:00 and shot at
  20:17. Cross-round A/B was worthless until the clock was pinned.

### What the critic said to do instead, in its order

1. **Change the shot protocol.** Every claimed feature must be legible in a 1:1
   crop at the default camera, with the crop attached — "we built it but it is
   one pixel tall" must fail. And diff the framings between rounds.
   ✅ **DONE.** `capture.mjs --against <prevDir>` now reports per-framing pixel
   change and warns when one framing moved less than a quarter as much as the
   best. Run against r4 it independently reproduced the critic's own finding:
   aerial 48.9% changed, district 35%, **street 4%** — round 5's ground work
   never reached the street frame.
2. **Take the free five points in UI legibility.** It has scored 2 for four
   straight rounds while every round went after 3D. It is the first thing a
   stranger sees, it is pure 2D layout with zero engine risk, and it is the
   furthest below the bar: collapse the fourteen identical counters into a
   compact status bar, get the button clusters off the city, and build the BAR's
   actual ask — arrow-shaped demand meters with a signed causal list. One round
   from 2 to 7, and the only dimension where that is true.
3. **Stand up an asset pipeline.** glTF kits for buildings, props, vehicles and
   trees, loaded and GPU-instanced, replacing code-assembled primitives. The only
   change that moves silhouette, surface detail, vehicles, vegetation, street
   furniture and zoning read *together*, and the only one that can reach 8. It is
   a week of infrastructure with nothing visible at the end, "which is exactly
   why five rounds of screenshot-graded iteration have kept choosing not to do
   it."

And its alternative, which is a real option: **move the bar honestly.** Say the
target is a stylised low-poly city that reads well at the aerial camera — which
this genuinely almost is, and the buildings are good — and stop scoring it
against Cities: Skylines II frames it will never match.

### Known regressions from round 5, not fixed

- The kerbed street-tree pit (raised kerb frame, paved apron, recessed soil bed)
  was replaced with a flat lime quad. Street furniture 7 → 6.
- The new tree-base patches are a single flat over-saturated lime with a hard
  edge, sitting on the newly mottled ground without receiving the mottle.

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
