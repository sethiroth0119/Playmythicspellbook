# 🛢 Hidn Petro — The Cracking Yard · handoff

Written 2026-09-03. Branch `claude/fuel-refinery-tycoon-game-ra2jdz`, 5 commits,
+6,104 lines. **Nothing is merged and nothing is deployed** — this document is
what you need to do both.

---

## What it is, and where it sits

The refinery that goes **between two things the game already had**:

| | |
|---|---|
| **Black River Petroleum** | pulls crude out of the ground → `Profile.blackRiver.crude` |
| **← this →** | refines, blends, tests, ships it |
| **Ethos Fuel Command** | sells it at the pump → `Profile.fuelCommand` |

Before this, the only thing joining them was `brRefineBatch()` — 40 crude in, a
fixed yield out, an 18% fire roll. **That function is untouched and still
works.** It is the one-click path for a player who does not want to run a
plant; this is the version for one who does.

You walk the site as its operator. Panels open because you went and stood at
the thing.

---

## Merging it

```bash
git checkout main
git merge claude/fuel-refinery-tycoon-game-ra2jdz
node _synckcheck.mjs            # must print ALL CLEAN
node _refinery_layout.mjs       # must print "layout is clear"
```

`_synckcheck.mjs` is the syntax gate for `index.html` (**not** `build.mjs`).
`_refinery_layout.mjs` is new — see *Site plan* below.

### Deploying

```bash
npm run deploy                  # minify → wrangler → restore
```

**Three knobs must move together or the update check breaks.** They are already
consistent on the branch at `v120x3`; bump all three the same way next time:

| File | Current |
|---|---|
| `public/version.txt` | `v120x3` |
| `public/index.html` → `window.BUILD_VERSION` | `v120x3` |
| `public/sw.js` → `CACHE_VERSION` | `mythic-v120x3-model-settle` |

There is a fourth for this feature: the module's cache-buster,
`src/refinery/index.js?v=v120x3models1` in `index.html`. The service worker
caches `/src/*` like any other static asset, so **a missed bump ships
invisibly.**

⚠ **Verify the EDGE with curl, never the deploy log**, and poll — propagation
across PoPs takes a couple of minutes.

```bash
curl -s https://<your-domain>/version.txt
curl -s "https://<your-domain>/src/refinery/index.js?v=v120x3models1" | head -3
```

### No new dependencies, no SQL

`package.json` is untouched. There are **no migrations** — all state lives on
`Profile.refinery` and rides the existing profile sync. Nothing to run in the
Supabase editor.

---

## Where it plugs into `index.html`

Seven touch points, all already applied on the branch. Listed so you know what
to look at if something goes wrong.

| Line | What |
|---|---|
| `~223399` | `<script type="module" src="src/refinery/index.js?v=…">` |
| `~207561` | `window.MythicRefineryBridge = { … }` — the entire seam |
| `~199368` | Entry card in the BRP **Refinery Complex** tab |
| `~199386` | Its click handler |
| `~167124` | `CAMP_ROUTE_OPTIONS.crackingYard` — a Camp-Heights portal |
| `~50642` | `__refinery_models__` in the **publish** payload |
| `~49984` | `Catalog.refineryModels` on the **load** side |

### 🔴 The globals trap

`Profile`, `Forge`, `Catalog`, `Operations` and the gem helpers are top-level
`const`/`function` in `index.html` — lexical bindings an ES module **cannot
see**. Nothing in `/src/refinery` reaches for a bare global; everything comes
through `window.MythicRefineryBridge`. That is also why the whole feature lifts
into a standalone preview page with a different object behind the same seam.

The bridge surface, if you need to extend it:

```
state · save · gems · spendGems · addGems · toast · confirm · isAdmin
loadThree · brOwned · getRes · spendRes · refundRes · modelUrls · setModelUrl
ownStation · directory · demandNodes · fillOwnStation · onDelivered
```

**Every one of them is optional.** With no Fuel Command, no station directory
and no district nodes, the yard generates NPC customers and plays identically.
Same degrade-to-empty rule the Supabase paths follow.

### Public API

`window.MythicRefinery` — `open(onClose)` · `close()` · `unlocked()` ·
`summary()` · `status()` · `wholesaleIndex()` · `grades`.
Debug helpers: `window.__mgModels` (registry), `window.__mgYard`
(`.where()`, `.teleport(x,z)`, `.player()`).

---

## Admin: changing the 3D models

Twenty-two slots. Every one has a built-in procedural shape and an optional
`.glb` url.

| Group | Slots |
|---|---|
| People | `character` |
| Process | `column` `cracker` `reformer` `treater` `alky` `pumps` `flare` |
| Storage | `crudeTank` `storeTank` `blendTank` |
| Logistics | `bay` `truck` |
| Office | `office` `officeRoof` `door` `desk` `computer` `chair` |
| Site | `lab` `automation` `buildPad` |

**To change one:** walk into the office → **E** on the terminal → **Plant** tab
→ Model Registry → paste an `https://` url → Apply.

### ⚠ It reaches other players only after you PUBLISH

Setting a url writes `Forge.refineryModels`, which syncs to **your own**
`user_profiles.forge` row. It becomes public through the same route as Black
River's machine models and the tuned economy tables:

```
admin edits Forge  →  Publish  →  __refinery_models__  →  Catalog.refineryModels  →  every player
```

Readers take `Forge` first, then `Catalog` — so you see your change instantly
and everyone else sees it once published. **If you set a url and other players
still see the built-in shape, you have not published.**

`http(s)` only. A `data:` or `blob:` url resolves in your browser and nowhere
else, so the bridge refuses it rather than accepting something that looks like
it worked.

### Model requirements

Scale and orientation are **measured and corrected on load** — a Blender export
in centimetres, one in millimetres, and one authored below the origin all land
correctly. You do not need to match the yard's units.

For the **character** slot specifically:

- Y-up, **feet at the origin**, facing **−Z**
- Clips named `idle` / `walk` / `run`. Matching is loose and
  case-insensitive, so `Armature|walk` is picked up.
- With no clips, the model still renders — it just will not animate.

A model that fails to load reports a readable reason in the panel and falls
back to its built-in shape. Verified against: empty file, flat file, 404.

---

## Building, and why the costs are what they are

Every unit you do not own leaves a **surveyed plot where it will physically
stand** — corner stakes, a ring, green if the materials are on site and amber
if not. Walk on, **E**, read the bill of materials, commission it.

### 🔴 Costs use the live fourteen, deliberately

Your resource ledger has 395 entries but **only fourteen are live** —
obtainable, spendable, priceable. The other 245 industrial ids (`steelBeam`,
`industrialPump`, …) sit in `chain.js` as a catalogue with **no producer**, and
`RESOURCES_NEXT.md` is explicit about what happens if you spend them anyway:

> *"A resource you can loot, bank, and be capped by — but cannot sell, spend,
> make, or see. That is not 'wood is missing'; it is worse than missing,
> because the player's pile of it is real and inert."*

A Cracking Unit priced in `industrialPump` would be a unit no player could ever
build. So costs draw on **metal, stone, supplies, wood, cloth, fuel, corrupted
essence and memory shards** — plus the yard's **own heavy oil and naphtha**,
which is both obtainable and exactly right: a refinery lines its own tanks with
its own residue.

**If you promote the industrial ids later** (the documented five-site process,
*with* a producer), the `res` maps in `build.js` are the only thing that
changes. Nothing else knows or cares.

Cinder is still charged, at ~55% of the old equipment price, as labour and
contractors. Materials carry the rest.

---

## Site plan — run the checker

`_refinery_layout.mjs` (repo root) verifies **every footprint pair at full
build-out** including the office box, then flood-fills the site to prove the
gate spawn is clear and that every first plot and the office door are reachable
on foot.

```bash
node _refinery_layout.mjs     # "layout is clear" + all reachable
```

**Run it after touching `PLOT_GRID` in `build.js` or `OFFICE` in `scene.js`.**
The hand-written version of that layout shipped **43 overlapping footprints** —
the lab and automation suite ignored their index so every copy stacked, the
automation suite stood inside the office, bays overlapped parked trucks, and
the spawn point was inside a truck. Overlapping blockers are not cosmetic: a
blocker inside a blocker is how a player gets wedged.

---

## Design decisions that will look like bugs if you don't know them

Things a reasonable person might "fix" and shouldn't.

**Octane and vapour pressure do not blend linearly.** Ethanol gives a
saturating octane bonus (big at 3%, flat by 10%), and RVP blends on an index
(`Σ v·rvp^1.25`), so a small slug of butane dominates. These two facts are the
entire skill ceiling of the blend stage — they turn "I'm 0.6 octane short" into
a decision instead of arithmetic. **Do not simplify them to linear mixes.**

**Sulfur cannot be bought away.** Octane *can* — reformate and cat gasoline are
on the merchant market at 2.15×. Hydrotreated cut and alkylate are not, at any
price. That asymmetry is what makes the Hydrotreater a capability gate rather
than a discount, and it is why cheap sour crude is worth buying once you own
one.

**Wear and incident rolls run on real time; throughput runs on sim time.**
1 real second = 17 column seconds. Risk you can fast-forward past is not risk.

**Cut quality is weighted by litres, not seconds.** Weighting it on the wall
clock made a slow run score worse than a fast one at the same wrong setpoint,
which rewarded not steering.

**Autopilot holds the setpoint but never chases the drift.** That is why it is
for low-value batches only, and why it is not simply "better".

**Contracts cap at one blending tank.** One batch = one tank. Extra tanks buy
*parallel* contracts, not bigger ones — which is what the equipment blurb
promises, so the two must agree.

**A move that escapes a blocker is always allowed**, even one you are already
inside. That is not sloppiness; it is the guarantee that no state of the world
can permanently trap the player.

---

## Still open

**The character model.** The slot is ready and everything around it is
verified. Send the `.glb` (Y-up, feet at origin, facing −Z, clips
`idle`/`walk`/`run`) and it drops straight in. Until then a jointed placeholder
operator ships — hi-vis, hard hat, a walk cycle driven by distance covered.

**One unproven hop.** Egress is blocked in the sandbox this was built in, so no
*real* `.glb` has been fetched and parsed. Normalisation is verified across
four export states through a stubbed loader, and every failure mode falls back
correctly — but the actual network fetch is written and guarded rather than
exercised. **Test the first real model on a staging deploy before publishing
it to everyone.**

**Preview build:** <https://claude.ai/code/artifact/7665026d-fb4e-4970-939e-7f30723e4b33>
(currently on `v120x2` — one commit behind the branch.)

---

## Files

```
public/src/refinery/
  data.js       419   crude grades, blend components, the blending maths, grades, equipment
  state.js      334   Profile.refinery, the bridge seam, resources, reputation
  sim.js        404   assay, desalting, the live column run, incidents
  blend.js      535   the bench, lab readings, the four exits, spot & merchant markets
  contracts.js  435   demand from real stations, the board, dispatch, payment
  models.js     280   the 22-slot model registry, normalisation, fallbacks
  walk.js       487   the operator, camera, collision, E-to-interact
  build.js      232   bills of materials, the site plan grid, commissioning
  scene.js      727   the 3D yard, the office, plots, flare
  ui.js       1,350   HUD, panels, build modal, admin registry
  refinery.css  342
_refinery_layout.mjs  108   site-plan checker (repo root)
```
