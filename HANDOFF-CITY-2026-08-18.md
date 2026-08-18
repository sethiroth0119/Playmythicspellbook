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

## 7. The visual loop, honestly

`.gauntlet/BAR.md` transcribes five Cities: Skylines II reference screenshots
into a 12-dimension rubric. Fresh-context critics score the real render each
round and A/B it blind against the previous one.

| Round | Mean | Stranger test |
|---|---|---|
| 0 baseline | — | instantly |
| 1 | 3.63 | instantly |
| 2 | 3.64 (against a night frame — see below) | instantly |
| 3 | **4.57** | instantly |

"Stranger test" is: shown our frame beside a real CS2 screenshot, does a stranger
pick the real game instantly, after a moment, or not at all. **It has been
"instantly" every round.** We are not at the bar.

Three findings from that loop are worth keeping even if the loop stops:

- **Shadows were never drawn.** three r171's WebGPU node pipeline reads a
  light's shadow from the shadow target's *colour* attachment; the WebGL2
  backend runs that pass depth-only, so the term collapsed to a constant and
  every shadow was multiplied away — while the depth pass was drawn and thrown
  out every frame.
- **Every mapped surface rendered at 58% of its stated albedo.** `_grey()`
  centred each shared texture canvas on 0.78 sRGB while documenting it as
  "centred on 1.0"; a map decodes to linear before it multiplies the colour, and
  0.78 sRGB is 0.578 linear.
- **The harness lied four different ways at once.** Two rounds scored vehicles
  and citizens at zero against a city whose crowd existed the whole time: agents
  were censused before the roads were built, never stepped, culled invisible
  against a stale camera, and framed by a camera OrbitControls clamped above the
  rooftops. A pixel diff of the rendered buffer — with-crowd vs without-crowd,
  exactly 0 of 1,440,000 pixels — found in one run what two rounds of art work
  could not.

**The dimension that has never moved is the plot** (3, 4, 2, 2). Buildings meet
the pavement with no setback, garden or boundary, and the critic named that
single fact as the reason the city reads as models on a board.

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
