# Athena Engine — test harness

Headless, CDN-free tests for `/public/src/mapforge`. This is how the engine was
verified while it was built; keep it green when you change the editor.

## Setup (once)

```bash
tools/athena-harness/setup.sh            # fetches three r128 + addons + 2 test models, builds www/
npm install                              # terser, for the syntax check
npm i -g playwright && npx playwright install chromium   # if you do not have it
```

`www/` serves the live `public/src` next to local copies of the three.js files
the editor normally loads from cdnjs / jsdelivr. `harness.html` sets
`window.MF_THREE_URLS` to those local copies and provides a fake
`window.MythicBridge` (not signed in, admin) — so everything runs without the
game or a network.

## Run

```bash
(cd tools/athena-harness/www && python3 -m http.server 8765 --bind 127.0.0.1) &
node tools/athena-harness/check-modules.mjs   # syntax of every module (terser, module mode)
node _synckcheck.mjs                          # index.html, as always
node tools/athena-harness/pw-test.mjs         # editor core: sculpt, paint, place, gizmo, undo, scatter,
                                              #   water, sky, .glb by URL, resize, save/reopen, play, fallbacks
node tools/athena-harness/pw-test2.mjs        # project library, .glb file embed, animation, live worlds, engine.mount
node tools/athena-harness/pw-test3.mjs        # collision, Play movement, Unreal hotkeys, toolbar, Ruins props
node tools/athena-harness/pw-test4.mjs        # VFX emitters, built-in effects, weather, save/reload, engine
node tools/athena-harness/pw-fallback.mjs     # no OrbitControls / TransformControls at all
```

Each prints ✔/✘ per step and the page's error list; screenshots land in
`shots/`. Chromium runs on SwiftShader here (~20 fps), which is why the Play
tests step the player deterministically (`player.frame(0.05)`) instead of
waiting on wall-clock time.

## Hosted preview page

```bash
node tools/athena-harness/bundle.mjs > tools/athena-harness/artifact/bundle.js
python3 tools/athena-harness/make-page.py      # → artifact/worldforge.html (single file, CDN three)
node tools/athena-harness/pw-bundle.mjs        # drives that page with the CDN scripts swapped for local copies
```

`bundle.mjs` is a small regex bundler tuned to this codebase (one IIFE per
module); `worldforge.html` is what was published as the live preview.
