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
# ⚠ in the Claude Code sandbox the server does not survive a turn — start it in the same command as the test
node tools/athena-harness/check-modules.mjs   # syntax of every module (terser, module mode)
node _synckcheck.mjs                          # index.html, as always
node tools/athena-harness/pw-test.mjs         # editor core: sculpt, paint, place, gizmo, undo, scatter,
                                              #   water, sky, .glb by URL, resize, save/reopen, play, fallbacks
node tools/athena-harness/pw-test2.mjs        # project library, .glb file embed, animation, live worlds, engine.mount
node tools/athena-harness/pw-test3.mjs        # collision, Play movement, Unreal hotkeys, toolbar, Ruins props
node tools/athena-harness/pw-test4.mjs        # VFX emitters, built-in effects, weather, save/reload, engine
node tools/athena-harness/pw-fallback.mjs     # no OrbitControls / TransformControls at all
node tools/athena-harness/pw-test5.mjs        # round 5 on harness2.html (farm + Athena + widgets with faked bridges):
                                              #   content folders, game-scene slots, farm overlay, widget designer,
                                              #   graph execution, slot/selector targets, themes, the expression language
node tools/athena-harness/pw-test6.mjs        # round 6: prefabs (create/place/edit/apply/unpack/shelf) and actor
                                              #   blueprints (components, graph, Play, engine, overlay)
node tools/athena-harness/pw-test7.mjs        # round 7: physics — heightfield, static colliders, dynamic/kinematic
                                              #   bodies, Impulse / Set velocity / Set body kind, On Hit, player push, engine
node tools/athena-harness/pw-test8.mjs        # round 8: navmesh bake, A* around walls, Move To / Patrol / Wander,
                                              #   On See → Chase, spawned enemy prefab, navmesh overlay, engine
node tools/athena-harness/pw-test9.mjs        # round 9: audio — Sounds library, Sound emitter, Play/Stop sound, engine
                                              #   (needs three/models/beep.wav: `node -e` in pw-test9's header comment, or any small wav)
node tools/athena-harness/pw-test10.mjs       # round 10: instancing draw calls, per-instance hide, emitter culling,
                                              #   quality ladder + auto-tune, editor HUD
node tools/athena-harness/pw-test11.mjs       # round 11: textured terrain layers, material overrides (props + .glb),
                                              #   tone mapping / exposure, bloom + vignette post pass, Look controls
node tools/athena-harness/pw-test12.mjs       # round 12: asset browser — index/search/tags, thumbnails (props, models, prefabs),
                                              #           favourites/recents, details panel, legacy category views
node tools/athena-harness/pw-test13.mjs       # round 13: splines — sampling, mesh bending, scatter, terrain apply, drawing,
                                              #           handles, .glb sources, normalize, engine build
node tools/athena-harness/pw-test14.mjs       # round 14: ✎ Edit UI — page rules, runtime text/style/hide, pick layer,
                                              #           save + live, screen scoping, replace-with-widget, admin gate
node tools/athena-harness/pw-test15.mjs       # round 15: battle board — v3 ↔ Athena, slotBody props, edits written back,
                                              #           publish on live, board overlay (extra objects + replacement)
node tools/athena-harness/pw-test16.mjs       # round 16: Screens & Strings — scan, edit → live rule, find & replace, rules,
                                              #           save + live, off-stage screens, export/import, widgets, admin gate
node tools/athena-harness/pw-test17.mjs       # round 17: cloud files (bridge bucket), upload, rename everywhere, F2,
                                              #           the content browser dock, context menu
node tools/athena-harness/pw-test18.mjs       # round 18: mini-game model showrooms — build, replace/restore/append,
                                              #           save → bridge, live → publish, city registry, chooser, admin gate
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
