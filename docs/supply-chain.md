# 🗺 Supply Chain — the map of the whole economy

A read-only screen that answers, for every business and system in the game: **what it makes,
what it needs, who ships it there, who it is worth working with, and whether this business is
for you.** It is opened from a tile in the Ruin Exchange, or by the deep link `?supplychain=1`.

It is built from the owner's own hand-drawn map (nine PDF pages, transcribed into data) laid
over what the shipped game actually does. Where the two disagree, **the screen says so on the
player's screen** rather than picking one — see *LIVE vs PLANNED* below. That split is the
single most important property of this feature; every other rule here exists to protect it.

---

## 1. Where it lives

```
public/src/supplychain/          the whole feature, ES modules
public/index.html                THREE additive hunks, and nothing else
tools/supplychain/               generators, the node:http server, the harnesses, the suites
_supplychain_smoke.mjs           the repo-root gate (11 numbered pins)
```

Globals: `window.MythicSupplyChain` (the module API), `window.openSupplyChain()` (the door a
legacy `onclick` can reach), `window.__mg.supplyChain` (the read-only probe), and
`window.SupplyChainBridge` (the seam, installed by index.html).

### The three hunks in index.html, and why there are exactly three

Other sessions edit `public/index.html` constantly, so this feature's footprint is deliberately
tiny and every hunk is anchored on a **symbol**, never a line number:

| # | Anchored after | What it adds |
|---|---|---|
| 1 | the `btn-just-business` tile in `PORTALS.exchange` | the `btn-supply-chain` tile |
| 2 | `'btn-just-business':` in `HUB_TILE_ART` | one art line (`operations-mining-company.webp`) |
| 3 | `<script … src="src/carfactory/index.js…">` | the classic `SupplyChainBridge` block + the module tag |

104 added lines, **zero deleted**. Hunk 3's two halves are adjacent on purpose: classic scripts
run in document order and modules are deferred, so a bridge written above the module tag is
always there first. This is the same ordering rule `CarFactoryBridge` follows, immediately above.

**The tile is null when the module has not mounted.** The portal list is `.filter(Boolean)`ed,
which is how every conditional tile in that file hides itself; there is no `hidden` flag and
returning `null` *is* the flag. So a deploy that misses `src/supplychain/index.js` produces a
**missing tile, never a dead button** — the lesson from the weapon smith, where a module that
failed to mount reported at runtime as "not mounted (non-fatal)" and looked exactly like a
module that was never there. `tools/supplychain/pw-e2e.mjs` section 10 proves it by 404-ing the
module file and checking the tile is gone.

---

## 2. The seam — and the globals trap

`Profile`, `OPS_ECON`, `OP_LABELS`, `RESOURCES`, `SALVAGE_RES`, `LOOT_RES_IDS` and
`STRUCTURE_SALVAGE` are top-level `const` in index.html's classic script: global **lexical**
bindings, not properties of `window`. An ES module cannot see them at all. `window.SupplyChainBridge`
is the only door, and `public/src/supplychain/sc.bridge.js` is the only file in the folder that
touches `window`.

Measured on the running page (`tools/supplychain/real-page-probe.mjs`, which is a gate row so
this stays true or goes red):

| symbol | on `window`? | why |
|---|---|---|
| `getRes` `showToast` `gcConfirm` `_opEcon` `_ownsOp` | **function** | a top-level `function NAME(){}` in a *classic* script IS a window property — the trap is about `const`/`let`, not about every legacy symbol |
| `Profile` | **object** | one explicit read-only getter added for the Node City iframe |
| `MythicTransport` | **object** | an ES module, so it mounts LATE — look it up inside the member, never capture it |
| `OPS_ECON` `OP_LABELS` `RESOURCES` `SALVAGE_RES` `LOOT_RES_IDS` `STRUCTURE_SALVAGE` | **undefined** | the trap proper. This is why the bridge block cannot be skipped. |

The 15 members are listed once, as data, in `sc.bridge.js`'s `BRIDGE_MEMBERS`, so the block, the
fake bridge and the smoke all check themselves against one list.

Three members are easy to get subtly wrong, and all three are wrong in ways that pass review:

- **`opEcon` must be `_opEcon`, not the raw `OPS_ECON` row.** `_opEcon` applies the admin /
  published override, `OPS_FREE_LICENCE` and `OPS_PINNED_PRICE`. Wired to the table, the map
  would print prices no player is charged, and every harness in the feature would stay green.
- **`held` must be `getRes(id)`.** `Profile.salvage[id]` skips alias folding and under-reports a
  war-map key; `_foldResAliases()` *mutates* what it is handed and schedules a persist — a
  read-only map must never write the player's save.
- **`transportPhase` must be read lazily** from `window.MythicTransport.routes.PHASE`. The
  transport module mounts after this classic block runs, so a captured value would be `0`
  forever. `0` means **unknown**, and the map must then claim nothing is enforced. Hardcoding
  `1` was rejected: this screen must never state a rule it did not read out of the game.

**There is deliberately no `spendGems` / `addGems` / `addRes` / `saveProfile` / `rpc` on this
bridge.** The map explains the economy; it must not be able to move it. The only thing it can
change is where the player is standing, through `openBusiness(id)`, which hands them to a screen
that already owns its own purchase, confirm dialog and server check. `pw-e2e.mjs` asserts the
absence of those six members rather than trusting this paragraph.

---

## 3. LIVE vs PLANNED

Every fact on the screen carries one of two badges, and the difference is visible to the player:

- **LIVE** — true in the shipped game today, with a citation behind it.
- **PLANNED** — the owner's map or written goal wants it; the game does not do it yet.

Claiming a planned rule is enforced today is treated as a failure, not a rounding error. The
headline cases as of this writing:

- **Only six resources are consumed by any operation today** (fuel, food, metal, water, medicine,
  fresh fish), and nine of the 25 operations consume nothing at all. Every other "need" on the
  map is PLANNED.
- **Transport is at PHASE 1** (`public/src/transport/routes.js`) — a carrier is a bonus, not a
  gate. Only hospital pharma wholesale and plague-cure waybills are actually hauled today. Every
  other lane is drawn through Transport and labelled as planned.
- **Fashion Brand and Airport are on the owner's map and are not businesses in the game.** They
  are drawn ghosted, as the only two PLANNED tiles.
- **`gunOil`** is yielded by the Oil Company and spent by the Weapon Smith but exists in no
  resource catalogue, so the payout is silently dropped. It is flagged on both tiles and is never
  used as a need.

---

### A third status: what only an admin sees

Two kinds of text on the modal are gated on `vm.admin`: the per-row **citation** (which PDF page
or which file a fact came from) and the **"Open readings of the map"** block. The second one is
`businesses.js`'s `AMBIGUITIES` — the places where the owner's drawing can honestly be read two
ways ("does an icon under a business mean it buys, or that it sells?", "p3 says Car Dealer buys
from Car Factory, p8's arrows do not"). That is a design question for the owner, not information
a player can act on, and printed on a player-facing card it just reads as the map contradicting
itself. It shipped ungated once. If you add an ambiguity, it is admin-only by construction — keep
it that way, and put the owner-facing version in `sc/OWNER_DECISIONS.md` where they will read it.

---

## 4. Adding a business is a DATA ROW, not code

A new tile needs one row in `public/src/supplychain/businesses.js`:

```js
{ id: 'fashion', opId: null, label: 'Fashion Brand', pdfLabel: 'Fashion Brand',
  page: 8, status: 'planned', kind: 'producer',
  icons: { transport: true, market: true, carMarket: false, card: false },
  needs: [{ biz: 'agri', direction: 'supplier', confidence: 'sure' }],
  caption: '…', pdfCite: 'p8' }
```

…plus what it makes and which product rides each lane in `recipes.js`, and a use for anything new
in `coverage.js`. Everything else is derived: the 3D layout, the hover card, the modal's seven
sections, the partner ranking, the plan, the 2D fallback and the legend all read the merged graph
and none of them names a business id. `scene.js` in particular must never name a business — it
finds the hub by `kind === 'hub'`, and a `grep` for business ids in that file returns only comments.

`graph.js` merges the data files and **reports** contradictions rather than papering over them;
`_supplychain_smoke.mjs` pin 9 fails if `report.errors` is non-empty.

---

## 5. No economy number is written down

Startup cost, wages, rates, yields and inputs are read live through `opEcon(id)` at runtime, and
from `tools/supplychain/fixture.opsecon.json` (generated from the real table) in Node tests. The
feature's own knobs — camera angles, ring radii, plan thresholds, proposal tiers — live **only**
in `tuning.js` as `SC`. This is the `_opEcon()` / `ECON` pattern from CLAUDE.md.

`pw-e2e.mjs` closes the loop from the other end: it reads `_opEcon(id).startup` *inside the page*
for mining, medical and transport and requires the modal to have printed that exact figure.

---

## 6. How the owner switches the gameplay changes on

Nothing in this feature changes how the game plays. The proposals ship as **data, switched off**:

`proposal.js` emits an overlay in the exact `{inputs, yields}` shape the existing admin Ops-Econ
override already merges (`getOpsEconOverrides` → `_opEcon`). Publishing that overlay is what makes
"every business needs battle loot" and "every resource has a use" real — with no code change and
no edit to this feature. The modal has an admin-only button that copies the overlay for the
selected business.

The full list of what a yes would mean, in plain words and with its default of OFF, is in
`OWNER_DECISIONS.md` (in this run's scratch directory). It covers: mandatory Transport, Fashion
Brand, the Airport, the p9 hiring rule, the `gunOil` phantom, and the loot-lottery finding.

**No price is rebalanced by this feature, anywhere.**

---

## 7. Running it

```bash
# the gates (all five must be green)
node _synckcheck.mjs                    # index.html scripts parse
node .gauntlet/comment-scan.mjs         # the MARKUP comments are balanced
node .gauntlet/modcheck.mjs             # every ES module under public/src parses
node _supplychain_smoke.mjs --wiring    # 11 pins, including the index.html wiring
node .gauntlet/precommit-scan.mjs

# the feature's own suites
node tools/supplychain/serve.mjs                       # node:http, ephemeral port
node tools/supplychain/real-page-probe.mjs             # the fixture vs the RUNNING game
node tools/supplychain/pw-e2e.mjs --shots <dir>        # the map inside the real index.html
node tools/supplychain/mutants.mjs                     # negative controls for the smoke
```

`http-server` is **not** installed and must not be fetched; `tools/supplychain/serve.mjs` is a
`node:http` server on an ephemeral port so parallel runs never collide. Chromium comes from
`node_modules` and WebGL works through SwiftShader.

### Four traps when you drive this screen in a test

1. **`view().project(id)` answers in CANVAS-LOCAL pixels**, and `page.mouse` works in client
   pixels. The stage sits ~180 px down the overlay, so using the raw numbers aims above the
   plate and hits empty sky — a silent miss that reads exactly like "hover is broken". Add the
   canvas's own `getBoundingClientRect()`.
2. **The 3D map is a race — real by construction, but not observed.** `render.js` `mountView()`
   gives `mountScene()` `UI.sceneTimeoutMs` (2200 ms) and draws the 2D fallback otherwise — and a
   scene that arrives late is *disposed*, so the view never upgrades afterwards. Round 1 reported
   the first open "frequently" landing on 2D. That was **re-measured** and does not reproduce:
   12 fresh opens of the real `public/index.html` across two independent runs gave `scene`
   **12/12**, both immediately and re-read 4 s later (`sc/work/integration/race-remeasure.mjs`,
   8.5–10.2 s to open). `pw-e2e.mjs` still measures the race over several opens rather than
   asserting one lucky run, and now also enforces an 18 s open budget. The dispose-on-timeout path
   and the footer's wording ("2D view (no WebGL)" when the real cause is a slow load, not a
   missing GPU) are still `render.js`'s to fix; they are just not the frequent event round 1
   believed.
3. **A viewport-bounds check on the hover card is not a visibility check.** The card shipped at
   `z-index: 4` while `.sc-head` is 6 and spans the top ~182 px, so on businesses near the top of
   the stage the card's own NAME was painted behind the header — and "the hover card is inside the
   viewport" stayed green the whole time. Fixed by `SC.hover.zIndex` (10: clears `.sc-head` 6 and
   the mobile rail 8/9, stays under the modal host 20, which matters because the card hides when
   the modal opens and must never be able to cover it). The assertion that guards it is
   `hoverGeometry()` in `pw-e2e.mjs`: a **z-aware rect overlap** of the card and of its
   `.sc-hover-title` against every chrome element with z ≥ the card's, swept over 8 businesses at
   2 viewports. Do **not** reach for `elementFromPoint` here — the card is `pointer-events: none`,
   so a hit test at its own title returns whatever is behind it whether or not the card is on top.
4. **Seed the data before you assert on it.** The `held()` check compared 0 to 0 for a whole round,
   because a signed-out test profile holds nothing; it would have stayed green with `held()`
   hardwired to return 0. The same trap ate the first draft of the duplicate-tile-art check, which
   read a style attribute, found no paintings at all and passed vacuously. Both now assert that
   the sample was non-empty as a separate, named check.

Always photograph one deterministic frame: `view().pause()` then `renderNow()`, in the same task
(the map has an idle turntable and moving freight). Any A/B of the rendered frame must call
`renderer.render()` between the two reads and `drawImage` in the same task —
`preserveDrawingBuffer` is off. See `.gauntlet/README.md` item 6.

---

## 8. Bump `?v=` on every change

`src/supplychain/index.js?v=sc2` — the service worker caches `/src/*` like any other static
asset, and a missed bump ships invisibly. `SC.version` in `tuning.js` carries the same string and
the two are bumped together.
