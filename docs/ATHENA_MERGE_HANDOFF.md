# Athena Engine — merge & ship hand-off

**For the agent that owns the build with the FILES and MENU tabs.** Read all of it
before touching anything. The job is ONE combined Athena Engine with every feature
from both builds, deployed, verified at the edge, with the migrations applied.
Nothing from either side may be dropped. If a feature cannot be carried over as-is,
it is re-implemented, not removed — and the removal is never silent.

---

## 0. The situation

Two Athena Engine builds exist:

| build | where it lives | what it has |
|---|---|---|
| **A — repository `main`** (`v120y9`, commit `12297093`) | `sethiroth0119/Playmythicspellbook`, branch `main` (identical to `claude/quirky-dirac-d3xbdj`) | everything in §2 below — 18 rounds, 18 headless test suites, docs |
| **B — the live site** | deployed from a LOCAL checkout; **not in git on any branch** | the editor with **FILES** and **MENU** sidebar tabs, the "Uploaded files" panel (Upload · auto-detect · All / Models / Anims / Audio / VFX · "stored in the models bucket · up to 60 MB each" · Place / ✕ per file, "A model joins this map's Library. An animation applies to the selected model (bone names must match). Audio arms the Sound marker. A VFX preset is JSON…"), an "Untitled world" default name, and whatever else that checkout carries |

Build B was never pushed, so build A does not contain it, and a deploy of A would
erase it. **First action: push build B to a branch** (`athena/files-menu` or similar)
so it can be diffed and merged. Do not deploy anything until §5 is complete.

Production deploys have been broken since 2026-08-13 (the Action installed Wrangler
3.90, which cannot read `wrangler.jsonc`). `main` now pins Wrangler 4, and the
remaining blocker is that the repository has **no `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` secrets** (§6).

---

## 1. Non-negotiable rules (from `CLAUDE.md` — read that file too)

- New features live in `public/src/<feature>/` as ES modules. Never a new top-level
  system in `public/index.html`.
- **The globals trap:** `Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level
  `const`s in index.html and are NOT on `window`. A module reads the game ONLY
  through `window.MythicBridge` (and per-feature bridges). Need something new →
  add it to the bridge in index.html, never reach for a global.
- Every Supabase access is guarded; the app must work offline / before tables exist.
- Migrations are numbered files in `/sql`, applied BY HAND in the Supabase SQL
  editor (project `ktsiasyjusesawtrwrjc`), idempotent, RLS in the same file.
- **No image or video upload** (UGC legal obligation). `.glb` models and audio are
  the accepted upload types — build B's panel must stay within that.
- **No Discord integration.** Do not re-propose it.
- Deploy bumps three knobs together: `public/version.txt`, `window.BUILD_VERSION`
  (index.html), `sw.js` `CACHE_VERSION`. Also bump `?v=` on every module script
  tag you touch (`src/mapforge/index.js?v=mf17`, `src/widgets/index.js?v=aw4`,
  `src/battle/battle.athena.js?v=ba1`, `src/farm/index.js?v=…`, node-city iframe
  `?v=`). The merged build must be **above `v120y9`**.
- Syntax-check index.html with `node _synckcheck.mjs` — and check the file SIZE
  too (a truncated file passes the syntax check). Never write index.html through
  Python's utf-8 codec (lone surrogates in emoji truncate it).
- Comments explain WHY, including past bugs. Keep them.

---

## 2. Feature inventory of build A — the checklist. Every line must survive.

Docs: `docs/athena-engine.md` (one section per round), `docs/ATHENA_ENGINE_HANDOFF.md`,
`tools/athena-harness/README.md`. Tests: `tools/athena-harness/pw-test*.mjs`.

### Athena Engine (`public/src/mapforge/`, `window.AthenaEngine` = `window.MythicMapForge`)
- **Map document** `mapforge.format.js` — schema v1, `normalize()` accepts anything:
  terrain (heights/paint, `PAINT` layers append-only), water, sky/env (look fields:
  `tone, exposure, bloom, bloomThreshold, vignette, terrainDetail, terrainTile`),
  `assets[]` (url or embedded base64 `.glb`, `tags`), `folders[]`, `prefabs[]`
  (`tags`), `sounds[]`, `objects[]` with `t, p, r, s, c, g, f (folder), k (slot key),
  a (asset), pf (prefab), bp (blueprint), anim, col, cs, fx, mat, sp (spline)`,
  `scene:{ground,water,sky}`, `game`, `normalizeTags`, `slotKey`.
- **World** `mapforge.world.js` `buildWorld(THREE, map, opts)` — terrain, water, sky,
  lights, every object, colliders, folders (`setFolderVisible`), slots
  (`slots()`, `slot(k)`, `buildDetached`, `opts.slotBody` hook), prefab parts,
  actors/play (`startPlay/stopPlay/interact`), physics, nav, audio, instancing
  (`setInstancing`, `stats()`), `refreshMat`, `groundAt/resolveMove`, `dispose`.
- **Editor** `mapforge.editor.js` — tools (Select/Sculpt/Paint/Place/Scatter/Erase),
  gizmo (translate/rotate/scale, snap, world/local), Unreal + default hotkeys,
  outliner with content folders (Scene tab), inspector (transform, tint, grounded,
  collision, effect, material, animation, slot replace/restore, prefab ops,
  blueprint section + `#mf-bp` graph panel), Terrain/Water/Sky/Maps tabs, Play
  (fps/orbit), quality select, Look controls, undo/redo, save (cloud/device),
  export/import JSON, drag-and-drop `.glb` embed, Library (see rounds 12/17),
  `ED.*` API used by tests (`editor()`, `S`, `world`, `refresh`, `library`,
  `content`, `spline`, `thumbs`, `gizmo`, `drawSplineHandles`).
- **Round 5 — game scenes:** `mapforge.games.js` adapter registry
  (`AthenaEngine.games.register/get/list`, `window.__athenaGames` queue),
  `mapforge.overlay.js` (`overlay.forGame(id)` → group + slot lookups +
  `buildReplacement`), slot objects `t:'slot'` + `k`, admin-only "Open in Athena".
  Farm adapter `src/farm/farm.athena.js` + overlay in `farm.scene.js`.
- **Athena Widgets** (`public/src/widgets/`, `window.AthenaUI`): `widgets.format.js`
  (WIDGET_TYPES, GRAPH_NODES, `evalExpr`, `interpolate`, filters, `normalize`,
  page rules `normalizePage` / `pageCss` / `PAGE_STYLE_PROPS`, `selectorFor`,
  `uid`), `widgets.api.js` (`ui_widgets` cloud + local, live cache),
  `widgets.runtime.js` (`boot`, `mount`, `render`, slots
  `data-athena-slot`, `registerSlotProvider`, themes, page docs → `<style
  id="aw-pages">` + text sync, `setPageDraft`, `pageInfo`, `currentScreen`),
  `widgets.editor.js` (designer: palette, tree, props, graph, theme, pick element,
  `opts.target`), `graph-editor.js` (shared node editor), `live-editor.js`
  (round 14), `screens.js` (round 16), `widgets.css`, `index.js`
  (`?widgets=1`, `?uiedit=1`, `?screens=1`). `MythicBridge.ui = { data(), actions }`.
- **Round 6 — actor blueprints & prefabs:** `mapforge.actors.js` (`COMPONENTS`:
  trigger/light/spin/bob/tag/physics/agent/sound; `ACTOR_NODES`: events
  begin/tick/enter/exit/interact/hit/see + actions move/rotate/scale/spin/visible/
  tint/anim/fx/light/spawn/destroy/teleport/impulse/velocity/bodykind/moveto/chase/
  patrol/wander/stopmove/lookat/playsound/stopsound/toast/setvar/branch/sequence/
  delay/call/log), `prefabs[]` + instances `{t:'prefab', pf}` (parts
  `'instance:child'`), create/unpack/apply/rename/delete, device shelf
  (`mf_prefabs_v1`), multi-select (`S.multi`).
- **Round 7 — physics:** cannon-es 0.20.0 VENDORED at `public/vendor/cannon-es.js`
  (+LICENSE, pinned in package.json — never a CDN), `mapforge.physics.js`
  (heightfield, boxes/cylinders, dynamic/static/kinematic, impulses), simulates
  only while playing.
- **Round 8 — navigation/AI:** `mapforge.nav.js` grid navmesh (bake from terrain +
  colliders, A*, string pulling), agent component, Move To/Chase/Patrol/Wander/
  Stop/Look at, On See, Terrain tab navmesh overlay.
- **Round 9 — audio:** `mapforge.audio.js` (listener on camera, positional
  emitters), `map.sounds[]` (URLs only), project sounds in
  `public/models/manifest.json → sounds`, Library → Sounds, preview ▶.
- **Round 10 — performance:** InstancedMesh batches for static repeated props in
  games only (`buildWorld({instancing:true})` in engine + overlay, never the
  editor), emitter distance culling, `mapforge.quality.js` ladder
  (auto/high/medium/low, `post` flag, auto-tune), HUD fps/tris/calls.
- **Round 11 — look:** `mapforge.terrain.js` splat shader (procedural 4×4 detail
  atlas, layer-index texture, `setDetail/setTile`), `objects[].mat` overrides
  (cloned per object, excluded from instancing), tone mapping/exposure via
  `onEnv` → `applyTone` (engine/editor), `mapforge.post.js` bloom + vignette.
- **Round 12 — asset browser:** `mapforge.assets.js` (index over props/models/
  project/cloud/prefabs/shelf/sounds/splines, `search` with prefix + label
  ranking, `collectTags`, `PROP_TAGS`, favourites/recents `mf_assets_v1`,
  offscreen `createThumbs` 96 px WebGLRenderer, session cache only), Library:
  search box, All/★/category chips, tag chips, recent row, grid/list view, cards
  with thumbnails, details panel (facts, tags editing, actions).
- **Round 13 — splines:** `mapforge.spline.js` (`t:'spline'` + `sp`, Catmull-Rom
  arc-length sampling, mesh mode BENDS vertices merged per material, stretch/
  rigid/forward axis, scatter mode seeded with jitter/width/align, terrain mode
  ribbon + Apply to terrain through `terrain.applyBrush`, `SPLINE_PRESETS`:
  road, wall, fence, barriers, tree line, pines, lamp posts, lanterns, colonnade,
  dirt track, stone path, river bed, custom), editor: Library → Splines,
  click-to-draw (Enter / double-click / close-loop / Backspace / Esc), world-space
  gold handles driven by the gizmo, insert/delete point, inspector section,
  catalogue entry `spline` (never collides, never instanced).
- **Round 14 — ✎ Edit UI:** `widgets/live-editor.js` — pick layer over the running
  page, panel: text (icons/sub-labels kept), hidden, whitelisted style props,
  More CSS, Replace with a widget… (designer with selector target), rules list,
  reset element/page, undo/redo, Save, ★ Live (admin), `AthenaUI.openLiveEditor`,
  admin button "✎ Edit the game UI (live)", `sql/041_ui_pages.sql` (kind `page`).
- **Round 15 — battle board:** `src/battle/battle.athena.js` — v3 battlemap ↔ Athena
  (3 m per cell, `TERRAIN_TO_PAINT` / `PAINT_TO_TERRAIN`, models → slots `bm.<i>`
  drawn with the board's own builder via `slotBody`, write-back on `athena:saved`,
  publish on `athena:live`), `MythicBridge.battle` (size/terrain/props/
  defaultTerrain/scale/getMap/setMap/publish/buildProp/boardOpen/refreshBoard/
  openLegacyEditor), `_b3dAthenaOverlay` in index.html (overlay at ⅓ scale, hides
  replaced models via `userData.bmIndex`, stepped in the frame loop, disposed on
  unmount), save events carry `detail.map`, admin button "⚔ Battle board in
  Athena Engine".
- **Round 16 — Screens & Strings:** `widgets/screens.js` — screen list
  (`SCREEN_CATALOG` + `MythicBridge.ui.screens()` + saved docs + on stage),
  Strings tab (`scanStrings` of the on-stage DOM → text rules, ↺ reset, find &
  replace, search), Rules tab, Widgets tab, Go there (bridge navigate), ✎ Edit UI,
  Save per screen, ★ Live, text-only JSON export/import, `AthenaUI.openScreens`,
  admin button "🗂 Screens & Strings".
- **Round 17 — cloud files / rename / content browser:** `MythicBridge.files`
  (the existing public `models` bucket under `athena/models` and `athena/audio`:
  `ready/canWrite/bucket/list/upload/rename(=move)/remove`, admin writes),
  Library → Models: Cloud list + ☁ Upload to cloud; index kinds `cloud`/`csound`;
  rename for map models/sounds, prefabs, shelf, cloud files (URLs rewritten),
  F2 (selected object first, else library item); the content browser dock
  `#mf-cb` (🗂 Content / Ctrl+Space): tree, breadcrumb, ☁ Upload / ⤒ Embed /
  🔗 URL / ↻, search, tile size, tiles with type bars, dbl-click picks,
  right-click menu (place/preview/rename/favourite/copy URL/remove/delete).
- **Round 18 — showrooms:** `MythicBridge.slots` (games: `fishing` boats/species/
  fallback fish, `auction` cars per rarity, `extraction` core/node/machines,
  `city` agents/buildings/levels; `set/clear/publish/canWrite` writing the SAME
  Forge fields the games' own panels write), `mapforge.showroom.js` (game scenes
  `models-<id>`, `buildShowroom`, `diffShowroom`, `encodeKey`, `pick()` chooser,
  save/live hooks), `Forge.cityModels` in the catalogue payload + hydrate,
  node-city merges `window.__mythicCityModels` at boot, admin button
  "🎮 Mini-game models in Athena", node-city iframe `?v=` bumped.
- **Bug fixes to keep:** `.glb` swap regression (`let body = null` hoisted in
  `addObject`), spline geometry freed on `world.dispose`, removed model →
  spline source falls back to placeholder, TDZ ordering in the editor
  (`trigRing`, `bpGraph`, `outlinerT`, `splineDraft/splineH` declared early),
  pw-test6 spin assertion measures a step delta.
- **Admin panel buttons (index.html):** ⚒ map creator, 🧩 Widget Designer,
  ✎ Edit the game UI (live), 🗂 Screens & Strings, ⚔ Battle board in Athena
  Engine, 🎮 Mini-game models in Athena, plus the legacy ⚔ Battlemap Forge.
- **Migrations:** `sql/038_farm_auction_and_ranch.sql`, `sql/038_world_maps.sql`,
  `sql/039_world_maps_games.sql`, `sql/040_ui_widgets.sql`, `sql/041_ui_pages.sql`.
- **Test harness:** `tools/athena-harness/` (`setup.sh` fetches r128 + addons +
  Duck/Flamingo, `harness2.html` fakes `MythicBridge` incl. `files`, `slots`,
  `battle`, `ui`, `MythicFarmBridge`; `www/` symlinks). Suites pw-test, 2, 3, 4,
  5 … 18 — all green on `main` as of `12297093`.

---

## 3. Feature inventory of build B — YOU fill this in, then keep all of it

From the screenshots the following exist and must be carried into the merged
build (add anything else the checkout has):

- Sidebar tabs **FILES** and **MENU** (in addition to OBJECT / SCENE / TERRAIN /
  WATER / SKY / MAPS).
- **Uploaded files** panel: Upload button, auto-detect type select, refresh, filter
  chips All / Models / Anims / Audio / VFX, count line "N files · up to 60 MB each ·
  stored in the models bucket", per-file rows (icon, name, "Model · 13.0 MB · ⤿ 1",
  Place, ✕), the help text about models joining the Library, animations applying
  to the selected model (bone names must match), audio arming the Sound marker,
  VFX presets as JSON.
- Default map name "Untitled world"; anything else that differs (MENU tab
  contents, inspector fields, toolbar items, hotkeys, save/menu behaviour).

**How to carry it over without forking:** build A already has the bucket seam
(`MythicBridge.files`), the cloud lists in the Library, the content browser, and
the anim/audio/VFX plumbing (clips on `assets[].anims` + inspector Animation;
`map.sounds[]` + Sound emitter component; VFX presets are `objects[].fx` /
`fx_*` props). Port build B's FILES panel ONTO those: one bucket (`models`,
`athena/…` prefix, or unify the prefixes), one index (`mapforge.assets.js`), one
card renderer. Do not ship two upload panels or two file lists. Keep build B's
UI affordances (type auto-detect, Anims category, "apply animation to selected
model", "arm the Sound marker", VFX-preset JSON) as features of the merged
panel. If build B's uploads used a different storage path, keep READING the old
path so existing uploads still list.

---

## 4. Merge procedure

1. `git fetch`; branch from `main` (`12297093`): `git checkout -b athena/merge main`.
2. Push build B as-is to its own branch first (`athena/files-menu`) — never
   overwrite `main` with it. `git diff main..athena/files-menu --stat` and read
   every hunk under `public/src/mapforge`, `public/src/widgets`, `public/index.html`,
   `public/sw.js`, `public/version.txt`, `public/models/`, `sql/`, `tools/`.
3. Merge B into `athena/merge`. Expected conflicts in `public/index.html`: the
   `MythicBridge` object (`battle`, `files`, `slots`, `ui.data`), the admin panel
   buttons, the catalogue publish payload + hydrate (`cityModels`, `battleMap3d`),
   `_b3dBuild` / `_b3dUnmount` (overlay hook), `_bmPopulateBattleBoard`
   (`bmIndex`), the module script tags, the three version knobs. Resolve by
   KEEPING BOTH sides; the only thing you pick one of is the version string
   (choose a new one above both).
4. In `mapforge.editor.js`, keep the existing tab set and ADD FILES and MENU;
   keep every DOM id the tests use (`#mf-cats`, `#mf-props`, `#mf-assets`,
   `#mf-project`, `#mf-cloud`, `#mf-prefabs`, `#mf-sounds`, `#mf-lib-q`,
   `#mf-search`, `#mf-details`, `#mf-cb*`, `#mf-sp-*`, `#mf-o-*`, `#mf-pf-*`,
   `#mf-bp*`, `.mf-tabs button[data-tab=…]`, `#mf-save`, `#mf-save-local`,
   `.mf-map [data-act="live"]`). Declare any new closure state BEFORE `loadDoc`
   runs (the editor has bitten four TDZ bugs already).
5. Bump: `public/version.txt`, `window.BUILD_VERSION`, `sw.js CACHE_VERSION`, and
   every `?v=` you touched (mapforge `mf18`+, widgets `aw5`+, battle `ba2`+,
   node-city iframe).
6. Update `docs/athena-engine.md` (a "Files & Menu" section), `CLAUDE.md`'s Athena
   block (one bullet for the merge round), `tools/athena-harness/README.md`, and
   the harness fake bridge if the FILES panel needs new bridge calls. Add a
   `pw-test19.mjs` covering the FILES panel (list, filter, auto-detect, place,
   apply animation, arm sound, VFX preset) and the MENU tab.

---

## 5. Verification — all of it, before any deploy

```
node _synckcheck.mjs                      # must print ALL CLEAN; also `wc -c public/index.html` ≈ 11.6 MB+
node --check public/src/mapforge/*.js public/src/widgets/*.js public/src/battle/battle.athena.js
node tools/farm_harness.mjs               # farm economy, no browser
cd tools/athena-harness && bash setup.sh  # once; needs network for three r128 + models
(cd www && python3 -m http.server 8765 --bind 127.0.0.1 &) ; \
for t in pw-test pw-test2 pw-test3 pw-test4 pw-test5 pw-test6 pw-test7 pw-test8 pw-test9 pw-test10 \
         pw-test11 pw-test12 pw-test13 pw-test14 pw-test15 pw-test16 pw-test17 pw-test18 pw-test19; do
  echo "== $t"; node $t.mjs 2>&1 | grep -E "^✘|page errors" ; done
```
Every suite must show zero `✘` and `page errors: []`. The static server does not
survive between shell calls in a sandbox — start it in the same command as the
tests. pw-test (scatter) and pw-test3 (hotkeys) are seed/timing sensitive on
SwiftShader; rerun once before calling them broken. Playwright is at
`/opt/node22/lib/node_modules/playwright` in the cloud sandbox
(`createRequire('/opt/node22/lib/node_modules/playwright/package.json')('playwright')`).

Then screenshot the merged editor (harness2, `MythicMapForge.open({...})`) showing:
Library with thumbnails, the content browser dock, the FILES tab, the MENU tab, a
spline with handles, ✎ Edit UI, Screens & Strings, the battle board scene, a
showroom. Attach them to the report.

---

## 6. Deploy and confirm

- Every push to `main` runs `.github/workflows/deploy.yml` (Wrangler 4 pinned).
  The repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must exist
  (GitHub → Settings → Secrets and variables → Actions). Without them the run
  fails at "In a non-interactive environment, it's necessary to set a
  CLOUDFLARE_API_TOKEN". Ask the owner to add them; never paste a token into the
  repo.
- Alternative: from a local checkout of `main`, `npm run login` then
  `npm run deploy` (`deploy.mjs` minifies index.html, deploys, restores).
- Merge `athena/merge` → `main` with a fast-forward or a merge commit; never
  force-push `main`; never rewrite other agents' branches.
- Verify the EDGE, never the deploy log: `curl -s https://<site>/version.txt`
  must print the new version; poll for a couple of minutes across PoPs. Then load
  the game, open the admin panel, and click each of the six Athena buttons.
- Apply the SQL by hand in the Supabase SQL editor (project `ktsiasyjusesawtrwrjc`),
  in order: `sql/038_farm_auction_and_ranch.sql`, `sql/038_world_maps.sql`,
  `sql/039_world_maps_games.sql`, `sql/040_ui_widgets.sql`, `sql/041_ui_pages.sql`
  (all idempotent; each ends with a verify query). If build B added a migration or
  a bucket policy (the 60 MB / models-bucket size migration), apply that too.

---

## 7. Report back with

1. The branch and commit of build B as pushed, and of the merged `main`.
2. The full §2 checklist with each line marked kept / re-implemented, and the §3
   list of build B features likewise — no line may be missing.
3. The test matrix (19 suites) with pass counts, `_synckcheck` output, farm
   harness result, and the screenshots.
4. The deploy run URL, the edge `version.txt` value, and which SQL files were
   applied with their verify-query output.
5. Anything you could not carry over, with the reason and what you built instead.
