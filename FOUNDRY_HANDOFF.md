# The Foundry — handoff

Written after the build session that created it. **Everything below is verified by
running it, not remembered.** Anything unverified is called out as such.

## Where things stand

| | |
|---|---|
| Branch | `claude/epic-heisenberg-64ym25` |
| Commits | 5, all pushed |
| Working tree | clean |
| Version triple | `v120x3` — `version.txt`, `BUILD_VERSION`, `sw.js CACHE_VERSION` |
| Module cache key | `src/foundry/index.js?v=v120x3foundry4` |
| Deployed | **NO.** Nothing has gone to Cloudflare. |
| Regression suite | `node _foundrysim.mjs` — **34/34 passing** |
| Verified in the real `index.html` | yes — 16/16 probe checks, both view modes rendered |

## What it is

A recycling plant you walk around in first person. Trash goes in one end and
Metal comes out the other; crude oil goes in the other end and becomes four kinds
of fuel, one of which powers the machines doing the crushing.

**15 machines · 34 materials · 22 recipes · ~4,000 lines in 9 ES modules.**

```
waste → Shredder → Magnetic Sorter ─┬→ ferrous → Crusher → scrapMetal
                                    ├→ non-ferrous ─┐
                                    └→ plastic/glass → Recyclate Baler → Supplies
  scrapMetal + coal → Blast Furnace → pigIron → Oxygen Converter → steel → Rolling Mill → METAL
  non-ferrous + recyclate ─────────→ Casting Line → metalIngot ──────────────────────→ METAL

  crudeOil → Distillation → gasoline + diesel + heavyEnds   (joint products)
  heavyEnds → Catalytic Cracker → aviationFuel              (best tap in the game)
  organicWaste → Bio-Digester → biogas → Fuel Blender → industrialFuel → burns in the Powerhouse
```

## File map

| File | Owns |
|---|---|
| `public/src/foundry/recipes.js` | materials, the recipe graph, taps, the purity curve |
| `public/src/foundry/machines.js` | machine defs, build-time-from-worth, fuel order, trim dial |
| `public/src/foundry/state.js` | inventory, the clock, accrual, construction, build/upgrade/repair |
| `public/src/foundry/taps.js` | **the only door to the real economy** — contracts in, taps out, disposal |
| `public/src/foundry/guide.js` | per-hour throughput, station text, city/ops cross-reference |
| `public/src/foundry/render.js` | all CSS + every panel. Both view modes render from here |
| `public/src/foundry/models.js` | floor layout, procedural geometry, collision, `pushOut` |
| `public/src/foundry/world.js` | the 3D shed: camera, input, proximity, state→visuals |
| `public/src/foundry/admin.js` | the `.glb` model editor |
| `public/src/foundry/index.js` | entry, host adapter, mode switching, event wiring |

In `public/index.html`: `window.MythicFoundryBridge` (search that string),
`__foundry__` on the cloud whitelist, `foundry:` on the forge whitelist,
`openFoundry()`, and a camp building in `CAMP_BUILDINGS`.

## 🔴 Five rules that must not be broken

1. **The globals trap.** `Profile`, `Forge`, `_csLoadThree` etc. are top-level
   `const`/function declarations — **not on `window`**. A module cannot see them.
   Everything crosses through `window.MythicFoundryBridge`. If the Foundry needs
   something new, **add it to the bridge**; never reach for a bare global.

2. **`taps.js` is the only door to the real economy.** Intermediates (steel, pig
   iron, biogas, ingots) live in `Profile.foundry.inv` and are invisible to
   `RESOURCES`, the market and the vault. They pay out through taps into ids the
   ledger already has: `metal`, `fuel`, `supplies`. A recipe that writes a live
   resource directly would be a second door *and* would skip the stash-cap
   handling `cashOut` earns the hard way. **Promote nothing** — `RESOURCES_NEXT.md`
   explains why a bankable-but-unmakeable pile is worse than a missing one.

3. **Every machine keeps procedural geometry, forever.** A bad admin `.glb`, a
   dead bucket or a slow phone must leave a shape standing, never a hole in the
   floor. `models.js build()` never returns null.

4. **Blueprint is a peer, not a legacy fallback.** No WebGL, a blocked CDN or an
   old phone degrades to the flat panels *with a toast*. Both modes render from
   the same `render.js` functions — if a card needs to differ in 3D, that is CSS.

5. **A machine that MAKES fuel must never be stoppable by lacking it.** The
   Distillation Column and Bio-Digester have `burn: 0`. Giving them a burn rate
   creates an unrecoverable death spiral (measured, see below). Any new
   fuel-producing machine inherits this rule.

## Verifying

```bash
node _foundrysim.mjs     # 34 checks: graph, layout, collision, build times, fuel, economy, bridge
node _synckcheck.mjs     # index.html syntax (terser; needs npm install first)
```

`_foundrysim.mjs` exits non-zero on failure. **Run it after any change to
recipes, machines, state, taps or models** — this is a simulation, and its
failures are emergent and invisible in review.

### Verifying the wiring inside the real page

Modules won't load from `file://` (CORS). Make a throwaway copy and serve it:

```bash
T=/tmp/livetest && rm -rf $T && mkdir -p $T && cd $T
ln -s /path/to/public/src src
cp /path/to/public/index.html .
# append a probe script before </body>, then:
python3 -m http.server 8731 --bind 127.0.0.1
```

Load `http://127.0.0.1:8731/index.html` in headless Chromium
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --no-sandbox
--use-gl=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=25000
--screenshot=out.png`). Never edit `public/index.html` for this.

**Note:** the 3D floor fetches three.js r128 from cdnjs. If your sandbox blocks
that, `loadThree` fires `cb(false)` and the module degrades to Blueprint — that
is correct behaviour, not a bug. To test 3D offline, `npm pack three@0.128.0` and
rewrite the two CDN URLs in the throwaway copy only.

## Balance, and how it was reached

Machine costs and feedstock prices are calibrated against the game's **own trader
table** (`index.html` `TRADER_DEFAULTS`, ~line 76586: metal 90, fuel 110,
supplies 80). Build time is derived from that same worth, so cost and duration
can never drift.

Current measured return: **1.10x running dirty, 1.35x running clean**, never runs
dry over 24h. If you retune anything, re-measure — do not eyeball. Four numbers
multiply together (feed price, recipe yield, purity curve, tap rate).

## ⚠ Bugs that were fixed — do not reintroduce

These all shipped as working-looking code and were caught only by simulation:

| Bug | Symptom |
|---|---|
| `Math.floor(qty * mult)` on outputs | 1-unit outputs **silently never existed**; the sorter's glass and non-ferrous streams were absent, starving downstream machines |
| Space checked on gross output | A full yard **permanently bricked every machine** — refining is usually space-negative |
| `carryMs` dropped by the state normaliser | Any recipe slower than one 60s slice **could never finish a batch** |
| Purity penalty applied at every stage | Compounded 6 deep: trim 0 yielded **1 sheet metal against 126** |
| Every converter burning fuel | **Unrecoverable spiral** — fuel dips, grid dies, brownout halves output, still makes less fuel |
| `pushOut` landing on the box face | Float error after rotation put **a quarter of points back inside** |
| Emissive *and* colour both driven | Station signs rendered as **blown-out white slabs** |
| Pause freezing the whole scene | The shed looked **switched off** the moment you opened a panel |
| Caster fed from aluminium/copper | The machine **never ran** — a 24h economy run came back byte-identical with it built |

**Two wrong diagnoses, both now commented in the code:**
- A 0.40x return was blamed on fuel burn; cutting burn 60% moved it to 0.41x. The
  real cap was the still's **output buffer** jamming at 280 units. *Suspect
  backpressure before burn rates.*
- Point lights were set to 5.5 reasoning in lumens, but `physicallyCorrectLights`
  is off, where ~1 is a lamp. A near-black floor rendered as pale tan.

## What is NOT done

1. **Not deployed.** Version triple is staged at `v120x3`. `deploy.mjs` minifies
   `index.html` in place — commit first (done). Verify at the **edge** with curl,
   not the deploy log, and poll: propagation takes minutes.
2. **The camp door tile is unwalked.** The Foundry building sits at
   `x8–11, y10–12` with its door at `(10, 13)` on the 20×15 camp map. The
   arithmetic is verified against all five existing footprints; **nobody has
   walked a character to it.** First thing to check in a real session.
3. **Mobile untested.** The thumb pad and touch-look follow the card shop's
   proven pattern but have only been seen at desktop size.
4. **`OPS_USES` in `guide.js` is hand-mirrored** from `OPS_ECON` (a `const` a
   module cannot read). It is the one table here that can go stale.
5. **No PR opened.**

## Good next steps

- Walk the camp door tile; confirm the building is enterable.
- Deploy and edge-verify.
- Upload a real `.glb` through 🛠 Models and true up Scale / Turn° / Lift.
- Consider a Cinder "rush the build" option — an obvious sink, deliberately not
  added because it was not asked for.
