# tools/supplychain — the Supply Chain harness

Everything a builder or critic needs to run `public/src/supplychain/` with **no game, no install and no fixed port**.

| file | what it is |
|---|---|
| `serve.mjs` | `node:http` static server. `/…` → `public/` (the deploy root), `/__sc/…` → this folder, `/__sc/selftest.html` is generated. Port 0 by default (the OS picks), `PORT=n` to pin. First stdout line is `PORT=<n>`. Exports `startServer({port})` → `{server, port, base, close()}`. |
| `shoot.mjs` | The camera. Exports `withPage(fn, {w,h,webgl,reducedMotion,dpr,touch})`, `shot(pageOrLocator, file, opts)`, `selftest(out)`, `SWIFTSHADER_ARGS`. Starts its own in-process server on an ephemeral port, launches Playwright Chromium from `node_modules` with the SwiftShader flags, fresh context with `serviceWorkers:'block'`, captures console / pageerror / failed requests / HTTP >= 400. |
| `gen-fixture.mjs` | Cuts `OPS_ECON`, `OP_LABELS`, `RESOURCES`, `SALVAGE_RES`, `LOOT_RES_IDS`, `STRUCTURE_SALVAGE` out of `public/index.html` **by symbol**, evaluates them, and reads Transport's `PHASE` from `public/src/transport/routes.js`. Writes `fixture.opsecon.json`. |
| `fixture.opsecon.json` | GENERATED. Never hand-edit. The only place a Node test may get an economy number from. |
| `fake-bridge.js` | Classic script that builds `window.SupplyChainBridge` from the fixture. Personas on the query string. |
| `real-page-probe.mjs` | Loads the **real** `/index.html` in Chromium (read-only) and diffs the LIVE `_opEcon` for all 25 ops, plus `MythicTransport.routes.PHASE`, against the fixture. The only check that can see an admin override or a clamp. Also records which legacy symbols an ES module can actually reach. |
| `shoot-control.mjs` | The camera's negative control: the real `shoot.mjs` must exit 1 on a 404, and a **mutant** copy with the exit guard cut out (written to the OS temp dir, never into this tree) must exit 0 on the same 404. Without it the exit-code fix is a claim. |
| `seam-smoke.mjs` | The seam's bar as a committed test: fixture == index.html, `drift()` seen to fire (value, missing op, key order), the hostile-bridge matrix (17 setups x 17 accessors x 9 ids, async-reject included, unhandled rejections counted), `healthy()`, copies-not-live-rows, one-seam and no-money-in-tuning checks. `--browser` adds all six personas in one Chromium. |

## Run it

```
node tools/supplychain/gen-fixture.mjs            # write the fixture (prints "unchanged" when nothing moved)
node tools/supplychain/gen-fixture.mjs --check    # exit 1 + a per-field diff when index.html and the fixture disagree (key ORDER counts)
node tools/supplychain/seam-smoke.mjs             # ~1 s, Node only. Add --browser for the personas in Chromium (~5 s)
node tools/supplychain/shoot.mjs --selftest out.png   # proves WebGL + three r128 + fake bridge on this machine
node tools/supplychain/shoot.mjs "__sc/harness-modal.html?owns=mining" out.png --w 1600 --h 900 --wait 800
node tools/supplychain/shoot.mjs "__sc/harness-fallback2d.html" out.png --no-webgl --full
node tools/supplychain/shoot.mjs --url "__sc/harness-scene3d.html" out.png   # same thing, named
node tools/supplychain/real-page-probe.mjs        # the fixture vs the GAME RUNNING (~8 s Chromium, read-only); --json, --shot f.png
node tools/supplychain/shoot-control.mjs          # the camera's exit code + its mutant control (~25 s); --quick skips the mutant
node tools/supplychain/serve.mjs                  # a server to click around in; read PORT= from the first line
node .gauntlet/supplychain-scan.mjs               # ⬅ ALL SIX of the above that are gates, exit 1 on any (~16 s)
```

**The one command is `.gauntlet/supplychain-scan.mjs`.** Everything in this folder that is a
gate is a row in it — fixture, drop rates, proposal gate, seam smoke, live-page probe, camera
control — so none of them depends on a person remembering a command. `--no-browser` drops the
last two and says so in the verdict line; `--quiet` prints only the verdicts.

### 🔴 Two things about `shoot.mjs` that used to hand back a confident wrong green

**No leading slash on the url path.** Agents in this repo get Git Bash, whose MSYS layer
rewrites any argv that starts with `/` into a Windows path. `"/__sc/harness-scene3d.html"`
arrived inside the process as `/C:/Program Files/Git/__sc/harness-scene3d.html`; the server
404'd and a black PNG was saved. Write it as `__sc/…` (or `--url __sc/…`) and it works in
every shell. A mangled path is now repaired anyway, with a warning on stderr — but the
documented form is the one without the slash. PowerShell was never affected, which is
exactly why this survived a round: the same command passed in one shell and lied in another.

**The CLI's exit code is the verdict.** It exits **1** when the page reported any error
(console error, pageerror, or any response >= 400) or when the main navigation itself
returned >= 400, printing the reasons on stderr; the JSON still goes to stdout either way.
Before this, `errors` was reported *inside* the JSON and the process exited 0, so a
photograph of a 404 read as a pass to anything that checked `$?`. Pass `--allow-errors`
(or set `t.allowErrors = true` in a script) when you are deliberately photographing a
broken state. In a suite, call `t.assertClean()` — same rule, as a throw. `t.navStatus`
holds the main navigation's status, kept separate from `errors` because a 404'd harness
still renders, still screenshots, and still reports zero page errors.

From a script:

```js
import { withPage, shot } from '../../tools/supplychain/shoot.mjs';
await withPage(async (page, t) => {
  await t.goto('/__sc/harness-scene3d.html?owns=mining,transport');
  await t.ready();                                       // waits for [data-ready="1"] to be ATTACHED — see below
  await shot(page, 'C:/…/sc/shots/scene3d/round1/home.png');
  await shot(page.locator('#sc-hover'), 'C:/…/hover.png'); // a locator crops for you
  if (t.errors.length) throw new Error(t.errors.join('\n'));
}, { w: 1600, h: 900 });
```

`t` = `{ base, port, logs, errors, goto(path), url(path), ready(sel?, {timeout, page}?), newPage(label?), shot, browser, context }`.

**Wait with `t.ready()`, not `page.waitForSelector(sel)`.** `waitForSelector` defaults to `state:'visible'`. A harness page whose only content is a fixed/absolute overlay (`#sc-overlay` is exactly that) has a zero-height `<body>`, so `body[data-ready="1"]` counts as hidden and the wait fails after 30 s on a page that is fine. `t.ready()` uses `waitForFunction` on the DOM. If you must use `waitForSelector`, pass `{ state: 'attached' }`.

**Several states, one Chromium.** Each `withPage` launches a browser (~1.7 s) — right for parallel critics, wasteful for a six-state suite. Inside one `withPage`:

```js
for (const mode of ['full', 'none', 'reject']) {
  const p = await t.newPage(mode);                       // same fresh context, same capture; logs prefixed "[mode] "
  await p.goto(t.url('/__sc/harness-modal.html?scbridge=' + mode));
  await t.ready('[data-ready="1"]', { page: p });
  await shot(p, `…/modal-${mode}.png`);
  await p.close();
}
```
 Log prefixes: `l:`/`w:`/`e:` console, `E:` pageerror, `F:` request failed, `H:` HTTP status >= 400.

## A harness page (one per UI piece: `tools/supplychain/harness-<pieceId>.html`)

```html
<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark">
<script src="/__sc/fake-bridge.js"></script>            <!-- classic, ABOVE the module: it must run first -->
<script src="/assets/vfx/three.min.js"></script>        <!-- only if the piece draws 3D; three.boot.js also finds it -->
<script type="module">
  import { mountHover } from '/src/supplychain/hover.js';
  // … build data, mount, then: document.body.dataset.ready = '1';
</script>
```

Harness pages live here and not under `public/` because `public/` **is** the deploy.

### fake-bridge personas (query string of the harness page)

| param | values | meaning |
|---|---|---|
| `scbridge` | `full` (default) · `none` · `half` · `throw` · `reject` · `junk` | whole bridge · no bridge · only `opEcon`+`opLabel` · every member throws · every member returns a rejected promise (`__scFake.unhandled` counts what escaped — must stay 0) · every member returns the wrong type |
| `owns` | `mining,transport` | businesses the player owns (default none) |
| `held` | `some` (default) · `none` · `all` | deterministic stash, same on every run |
| `gems` | `poor` · `mid` (default) · `rich` | wallet as a quantile of the fixture's licence asks — relative, so it survives a retune |
| `admin=1` `signedin=0` `confirm=no` `phase=2` | | |

What the feature did is recorded on `window.__scFake` = `{mode, toasts[], confirms[], opened[], fixture, error}`.

## Node tests: economy numbers without a browser

```js
const fx = JSON.parse(fs.readFileSync('tools/supplychain/fixture.opsecon.json', 'utf8'));
const opEcon = (id) => fx.opsEcon[id] ?? null;          // same contract as sc.bridge.js opEcon: row or null
```

Pure files take `opEcon` as an injected parameter. They never import `sc.bridge.js`, and nobody retypes a figure.

## The bridge contract (for the integration piece)

`public/src/supplychain/sc.bridge.js` exports `BRIDGE_MEMBERS` — the 15 members the classic-script block in `index.html` must put on `window.SupplyChainBridge`:

`opEcon(id)` → `_opEcon(id)` · `opLabel(id)` → `OP_LABELS[id]` · `ownsOp(id)` → `_ownsOp` · `resources()` → `RESOURCES` · `salvageRes()` → `SALVAGE_RES` · `lootResIds()` → `LOOT_RES_IDS` · `structureSalvage()` → `STRUCTURE_SALVAGE` · `held(id)` → **`getRes(id)`** · `gems()` → `Profile.gems` · `isAdmin()` · `signedIn()` · `toast(m, ms)` → `showToast` · `confirm(m)` → `gcConfirm` · `openBusiness(id)` → returns `true` only when it actually routed · `transportPhase()` → **`window.MythicTransport && window.MythicTransport.routes.PHASE`, read on every call**.

⚠ **`held(id)` is `getRes(id)` (`public/index.html:43873`) and nothing else.** It is the
read that folds resource aliases through `_ensureResources()`. The two wrong answers are
both easy to reach: `Profile.salvage[id]` skips alias folding and under-reports, and
`_foldResAliases(obj)` (`public/index.html:43725`) is **not a read at all** — it MUTATES
the object handed to it and schedules a persist, so calling it from this read-only map
would have the map writing the player's save.

⚠ **`transportPhase()` must be looked up lazily, inside the member.** `MythicTransport` is
registered by an **ES module** (`public/src/transport/index.js:1802`), so at the moment the
classic bridge block in `index.html` evaluates it does not exist yet; a captured reference
is permanently `undefined`. The value itself is `routes.PHASE` (`PHASE = 1`,
`public/src/transport/routes.js:331`) — i.e. Transport is optional today. And note the
ambiguity the UI has to respect: the accessor answers `0` for "no bridge / member threw",
and a not-yet-mounted transport module is **indistinguishable** from that, so `0` means
*unknown*, never "phase zero, nothing is enforced".

**Every member except `confirm` must be SYNCHRONOUS.** The accessors are synchronous, so a promise is not an answer: `sc.bridge.js` defuses any thenable a member returns (a rejection never becomes "Uncaught (in promise)") and then answers with the accessor's default. In practice: `openBusiness(id)` must decide `true`/`false` before it returns — kick an async legacy opener off inside it, `.catch` it there, and return `true` for "routed"; do not `return` the opener's promise, or the modal will say "open it from Just Business" while the screen opens anyway. `confirm(m)` is the one member that returns a promise (of a boolean); a rejection or a non-`true` answer reads as "no".

### What an ES module can actually reach on the shipped page (measured, not assumed)

`real-page-probe.mjs` reads this off the **running** `/index.html` every time the gate runs.
It matters because "the globals trap" is stated in this repo as if nothing legacy were on
`window`, and that is not what the page does:

| symbol | on `window`? | why |
|---|---|---|
| `getRes`, `showToast`, `gcConfirm`, `_opEcon`, `_ownsOp` | **yes**, `function` | a top-level `function NAME(){}` in a **classic** script *is* a window property. The trap is about `const`/`let`, not about every legacy symbol |
| `Profile` | **yes**, `object` | not an accident: `index.html:258162` defines an explicit read-only getter (`get: () => Profile, set: () => {}`) so the Node City **iframe** can read the name. A dozen comments in this repo say `window.Profile` is undefined; on the shipped page it is not, and only because of that one line |
| `MythicTransport` | **yes**, `object` | registered by an ES module, so it mounts **late** — look it up inside the member, never capture it |
| `OPS_ECON`, `OP_LABELS`, `RESOURCES`, `SALVAGE_RES`, `LOOT_RES_IDS`, `STRUCTURE_SALVAGE` | **no**, `undefined` | the trap proper: `const` at the top level of a classic script. **The W5 bridge block is the only way to get these**, and `OPS_ECON` only reaches the map at all because `_opEcon` is published beside it as `window.__mg.opsEcon = { table, live, computed }` (`index.html:98164`) |

So `held()` and `gems()` are the only two members that *could* have been wired without a
bridge at all — and they must not be. One seam per feature (CLAUDE.md); the `Profile` getter
is a courtesy for one iframe, not a contract; and `opEcon` has to keep going through
`_opEcon` or a published admin override never reaches the map.

**`confirmAsync` has a ceiling.** It is the one member that returns a promise, so it is the
one member that can be total in *value* and not in *time*: a `confirm` that never settles
used to hang its caller forever (in Node, an unsettled top-level await exits 13 with no
message). It now races `SC.bridge.confirmTimeoutMs` (120 s, `tuning.js`) and answers
**false** — an unanswered question is a "no", the same answer as a missing bridge. A late
`true` is still a no. `confirmAsync(msg, ms)` takes an override; views pass nothing.

**`transportPhase()` is clamped to 0..3.** The number is *printed* ("stage 1 of 3"), and
`num()` rejects only non-positive and non-finite values, so a bridge answering 99 used to
print 99. Out of range is not information, it is a bridge this folder does not understand.

**`ready()` vs `healthy(opIds?)`.** `ready()` is a typeof: there is a bridge with an `opEcon`. It is `true` for a bridge whose every member throws. `healthy()` asks whether `opEcon` actually returns a row for any of the given op ids (default: `transport`) — the shell should gate its offline notice on `healthy(liveOpIds)`, not on `ready()`.

**z-order.** `SC.overlay.zIndex` (2147483400) is deliberately below `.toast` and `#gc-confirm-backdrop` (both 2147483647 in index.html), so a toast or confirm opened from the map lands above it. The integration piece should still look at one of each over the open overlay.

The module side deep-copies everything it receives, so handing over the live tables is safe. Each member should still be wrapped in its own try/catch on the index.html side, like `CarFactoryBridge`. `transportPhase()` answers `0` for "unknown": the UI must not claim a rule is enforced when it reads 0.

## Known limits

- `gen-fixture.mjs` evaluates each table with no scope. If a row ever references another constant it fails loudly — extend the generator, do not paste the value.
- `--check` compares DATA (per field) and is the only drift test that means anything.
  **Do not script on `source.sourceHash`** — it is a hash of the extracted source text, so a
  comment-only edit inside a table moves it while every value is unchanged, and a critic
  watching the hash will chase a drift that is not there. Compare `dataHash`, or just run
  `--check` and read its exit code.
- The fixture is the **base** `OPS_ECON` table, with no admin Ops-Econ overrides applied.
  That is deliberate (it is the thing `--check` can compare against index.html), but it
  means a figure a live admin has overridden will differ from what a player sees; only the
  bridge's `opEcon()`, which goes through `_opEcon`, shows the overridden value.
  **Three things inside `_opEcon` can make the live row differ from this table**, and a
  source-text diff is blind to all three — which is why `real-page-probe.mjs` exists:
  | clamp | where | today | effect |
  |---|---|---|---|
  | `getOpsEconOverrides()` | `index.html:98109` | none published | merges a local (`Forge.opsEcon`) or **published** (`Catalog.opsEcon`) admin override over the base row |
  | `OPS_FREE_LICENCE` | `index.html:98127` | `{}` | forces a row's acquisition price to 0 whatever the table or an override says. Free to **acquire** only — wages, inputs and the city's build time are untouched |
  | `OPS_PINNED_PRICE` | `index.html:98135` | `{ construction: 1 }` | the opposite: for a pinned row the **table's** `startup`/`azaStartup` are the last word and an override cannot reprice it. So `construction` is the one op immune to overrides and the other 24 are not — the rest of the row (workers, yields, wages) still merges |
  Measured on this tree (2026-09-25): all 25 live rows are byte-identical to the fixture,
  `construction` included. `real-page-probe.mjs` is the thing that will say so next time.
- `webgl:false` removes the WebGL contexts at the canvas API (what `three.boot.js webglOk()` probes); it does not switch the GPU process off.
- This is real headless Chromium: `requestAnimationFrame` runs at full rate. The 0.56 Hz RAF trap in CLAUDE.md is the desktop Browser pane. A frame A/B must still `render()` and read in the same task.

## The proposal overlay (piece "proposal") — drop rates and the repo gate

| file | what it is |
|---|---|
| `gen-flux.mjs` | Cuts `_rollUnitSalvage`, `_rollStructureSalvage`, `SALVAGE_RES`, `LOOT_RES_IDS`, `STRUCTURE_SALVAGE`, `STRUCTURE_ORDER` out of `public/index.html` and `FARM_ECON` out of `public/src/farm/index.js` **by symbol**, rolls the drop code with a seeded PRNG and writes `public/src/supplychain/flux.snapshot.js` (GENERATED, never hand-edit). `--check` exits 1 when the loot tables, the roll code or the farm table moved. The assumed casualty mix is `PANEL` in this file. |
| `proposal-gate.mjs` | Re-proves `proposal.js` from the repo in ~5 s: six negative controls that must fail first (A inputs merge, B price pin, C round-1 sourcing rule, D rate-matching remove, E swapped ruin id, F planted importer), the `_opEcon` before/after diff on the local AND published override path, the as-shipped "every business gets battle loot" check, the default-OFF importer scan, and the throttle / stage-4 measurements on the real `_opComputed`. `--emit <dir>` writes the JSON the memo is built from. |
| `proposal-browser.mjs` | The admin copy / remove payload in Chromium over the fake bridge (imports resolve from the deploy root; a changed loot table arriving over the bridge refuses the copy). |
| `proposal-memo.mjs` | `--in <emit dir> --out <file.md>`: the owner-facing memo, every figure read from the gate's output. |
| `.gauntlet/supplychain-scan.mjs` | **The automatic guard.** Runs `gen-fixture --check`, `gen-flux --check`, `proposal-gate.mjs`, `seam-smoke.mjs`, `real-page-probe.mjs` and `shoot-control.mjs`, each in its own process, and exits non-zero on any of them (~16 s; `--no-browser` drops the last two and says so). This is the only thing that catches a stale drop-rate measurement in full: the browser-side `tableSignature` check at copy time sees the ruin tables and the loot id list, NOT the roll counts, the body-salvage roll, the staple tables or `FARM_ECON`. **It is not yet listed in `_checkall.mjs`** (another session is editing that file); until the lead adds a row, run it by hand after touching the loot code in `public/index.html`, `public/src/farm/index.js` or anything under `public/src/supplychain/`. Proven to go red, each mutation reverted immediately: a one-character edit to `flux.snapshot.js` fails 2 rows; deleting the thenable defuse in `sc.bridge.js` fails the seam row (126 unhandled rejections); a +1 on `medical.startup` in the fixture fails both the fixture row and the live-page row, the latter naming the field. |

```
node .gauntlet/supplychain-scan.mjs               # six rows, exit 1 on any; the one to wire into _checkall.mjs
node tools/supplychain/gen-flux.mjs --check
node tools/supplychain/proposal-gate.mjs
node tools/supplychain/proposal-browser.mjs      # Chromium; not part of the scan

The loot-appetite knobs (`haulsPerWindow`, `windowHours`, `madeShare`, …) live in `tuning.js` as `SC.proposal.lootGate` and nowhere else; `proposal.js` carries no fallback and proposes nothing without them, and the gate fails if a value is typed into `proposal.js`.
```
