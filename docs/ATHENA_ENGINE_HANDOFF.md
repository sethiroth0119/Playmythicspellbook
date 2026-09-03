# Athena Engine — handoff (2026-09-03)

Everything below is verified against the branch, not from memory.

## Where things stand

| | |
|---|---|
| Branch | `claude/game-map-creator-30vsmg` (pushed) |
| Base | `main` @ `4dbc4f9` (Resource chain wave 1) |
| Commits | 6 on top of main, 3,534 lines added, 20 files (+ this doc and `tools/athena-harness/`) |
| Merged to main | **no** |
| Deployed | **no** — live is still `v120w6` |
| Supabase migrations | **not applied** — `sql/038`, `sql/039` |
| Live preview | https://claude.ai/code/artifact/b76338f2-1f24-4eae-a2eb-9b4db9054ffc (same code, bundled into one page) |
| Working tree | clean |

What exists: a full 3D map creator (terrain, water, 57 props incl. a
post-apocalyptic set, `.glb` models with animation, collision, VFX and
weather, Play mode, cloud/local saves, one live world per mini-game) and a
one-call engine mount for mini-games. Product name **Athena Engine**; the
code lives in `public/src/mapforge/` and the API object is
`window.AthenaEngine` (`window.MythicMapForge` is an alias).

Detailed reference: `docs/athena-engine.md`. This file is the connection plan.

## 1. Ship it (in this order)

1. **Merge** the branch into `main`. It only adds files plus 34 lines in
   `public/index.html` (an admin-panel section + one `<script type="module">`
   tag), so there is nothing to resolve.
2. **Bump the three knobs together** or the update check breaks:
   `public/version.txt`, `window.BUILD_VERSION` in `public/index.html`
   (line ~36444), `CACHE_VERSION` in `public/sw.js` (line 414).
   All three are `v120w6` today; the module tag is already at `?v=mf5`.
3. **Deploy** as usual (`npm run deploy`).
4. **Verify at the edge, not the deploy log**, and poll — PoPs take a minute
   or two:
   ```bash
   curl -sS https://<host>/version.txt
   curl -sSI https://<host>/src/mapforge/index.js | head -1     # 200
   curl -sSI https://<host>/src/mapforge/mapforge.vfx.js | head -1
   ```
5. **Run the migrations by hand** in the Supabase SQL editor for project
   `ktsiasyjusesawtrwrjc`: `sql/038_world_maps.sql`, then
   `sql/039_world_maps_games.sql`. Each ends with a verify query; every row
   must say `ok`. Until they are applied the editor saves to the device and
   says so — nothing breaks.
6. **Open it**: Pricing Admin panel → *⚒ Open Athena Engine* (admin only),
   or `/?mapforge=1`. Press **H** inside for the controls.
7. **Make the first world**: Maps tab → *Mini-game* = the game's id (e.g.
   `card-shop`) → Save → **★ Set live**. That is the world the game loads.

## 2. Connect a mini-game (the normal path)

Anywhere in `index.html` that owns a container element and a screen lifecycle:

```js
// mount — the world the admin marked live for this game
const g = await window.AthenaEngine.engine.mount(hostEl, {
  game: 'card-shop',          // → live map, else newest tagged, else local, else empty
  mode: 'fps',                // 'fps' (walk, pointer-lock on click) | 'orbit' | 'none'
  markers: false,             // spawn/zone handles stay hidden in the game
  onMissing: () => showToast('No world set for card-shop yet'),
  onLightning: (v) => { /* 0..1 flash strength, storm only — sync SFX here */ },
});

// your loop
const off = g.on('frame', (dt) => {
  // g.player.pos (feet), g.player.yaw, g.camera, g.scene, g.world
});

// what the builder placed
g.world.spawns();             // [{ p:[x,y,z], r:[rx,ry,rz], ... }]
g.world.find('enemy');        // enemy spawn markers → your spawner
g.world.find('zone');         // 10 m zones → triggers
g.world.find('waypoint');

// moving anything of your own on the map
const y = g.world.heightAt(x, z);                    // terrain only
const gy = g.world.groundAt(x, z, feetY);            // terrain OR the top of a low collider (crates, bridges)
const r = g.world.resolveMove(x0, z0, x1, z1, feetY, 1.7, 0.35);   // slides along solid objects → { x, z, blocked }

// animation on a placed .glb (clip names from the file)
g.world.setAnim(objectId, { clip: 'Attack', speed: 1, loop: 'once' });

// leaving the screen
off(); g.stop();              // disposes renderer, listeners, canvas, particles, lights
```

Handle: `{ THREE, map, source, scene, camera, renderer, canvas, world, player,
controls, on, resize, stop }`. `player` has `pos`, `yaw`, `pitch`, `keys`,
`start()`, `stop()`, `frame(dt)`, `spawnAt(spawn)`.

Other sources: `mount(el, { map })` with a document you already have, or
`mount(el, { id, source: 'cloud' | 'local' })`.

**three.js version — read this.** `mount()` loads the **r128 global build**
(`window.THREE`) on demand — the same one the 3D battle board, card shop and
battlemap editor already use, from the same CDN URLs, with
`/assets/vfx/three.min.js` as the fallback. That is deliberate: a world can
be dropped into any existing r128 scene with no cross-version objects. The
import-map `three` (0.171 WebGPU, used by the sprite layer and node-city) is
a *different* instance — never hand an Athena object to it or vice versa. A
node-city screen can still call `mount()` (it brings its own THREE and its
own canvas); just don't mix scene graphs.

## 3. Load a world into a scene you already own (lower level)

For the 3D battle board (`_b3dBuild(host)`, `index.html` ~102939) or any
other r128 scene:

```js
const r = await window.AthenaEngine.maps.loadLive('battle');       // or maps.load(id, source)
const world = window.AthenaEngine.buildWorld(window.THREE, r.map, { scene, markers: false });
scene.add(world.group);
// per frame:
world.update(dt, camera);          // water, animation mixers, particles, weather, sky follow
// teardown:
scene.remove(world.group); world.dispose();
```

`buildWorld` returns `{ group, terrain, water, sky, sun, hemi, objects,
colliders, emitters, weather, addObject, removeObject, refreshObject,
setAnim, setCollision, groundAt, resolveMove, spawns, find, applyEnv,
applyWater, setMarkersVisible, setFxEnabled, update, dispose }`.
It sets `scene.fog` and `scene.background` from the map's sky when you pass
`{ scene }`. The camera's `far` must exceed 1000 for the sky dome. Fire
lights are budgeted to eight; `setFxEnabled(false)` is a low-end switch.

## 4. Content pipeline

- **Props** — 57 procedural props in the Library (Nature, Structures, Props,
  Ruins, VFX, Markers). No files, cached templates, one clone per placement.
- **Your models** — put `.glb` files in `public/models/` and list them in
  `public/models/manifest.json` (see `public/models/README.md`); they appear
  under Library → Models → Project. Y-up, metres, origin at the base, not
  rescaled (the object's stored scale is the only scale; first placement is
  auto-fitted to 2 m). Dropping a file on the canvas embeds it in the map
  (admin only, 2.5 MB per file, 3.5 MB per cloud row) — use it to try things,
  then *Relink* to the `/models/` URL for production.
- **Animation** — clips are read from the file; per object clip / speed /
  loop in the inspector, `objects[].anim` in the document, `world.setAnim()`
  at runtime. Skinned rigs clone with skeletons rebound.
- **Collision** — per object solid/none + box/cylinder; props carry a
  default; `.glb` models are solid. Simple collision (world-space bounds),
  recomputed on change, never per frame. Player treats > 0.55 m as a wall,
  lower as ground.
- **VFX** — GPU particles (`mapforge.vfx.js`), one draw call per emitter,
  canvas-drawn sprites. Emitters: fire, blaze, smoke, black smoke, steam,
  ground fog, sparks, toxic gas, dust, motes; built-in effects on campfire,
  crater, generator, wrecked car, burnt tree, pylon. Weather: rain, storm
  (lightning), snow, ash, dust storm + wind.
- **Markers** — `spawn`, `enemy`, `waypoint`, `zone` are ordinary objects;
  hidden with `markers: false`, read with `world.find(type)`.

## 5. Data

- **Document** — one JSON per map, schema v1 (`mapforge.format.js`,
  `normalize()` accepts anything and fills defaults). Terrain is an
  `(n+1)²` heightfield + paint indices; objects are `{ t, p, r, s, c?, n?,
  g, anim?, col?, cs?, fx?, a? }`; `env` holds sky, sun, fog, weather, wind;
  `assets` holds model URLs or embedded files; `game` tags the mini-game.
  **Never reorder `PAINT`** — append only.
- **Cloud** — `public.world_maps` (038) + `game`, `live` (039). Owner
  reads/writes own rows; any signed-in player reads `is_public` rows; going
  live forces public (trigger); one live per owner per game (partial unique
  index); 4 MB row cap. RLS is the whole boundary — it was reviewed line by
  line, re-review if you touch it.
- **Local** — `localStorage` (`mf_maps_v1` index, `mf_map_<id>`,
  `mf_draft_v1` autosave). Guests, and the fallback when the cloud refuses.
- **API** — `AthenaEngine.maps.{ list, load, save, remove, setLive, loadLive }`
  (all degrade: `{ ok:false, missing | offline, error }`, never throw).

## 6. The bridge (the globals trap)

The modules never touch `Profile`, `Cloud`, `App` (top-level `const`s,
invisible to modules). They read `window.MythicBridge` — `cloud`, `signedIn()`,
`userId()`, `displayName()`, `isAdmin()`, `confirm()` — all of which already
exist for the Community feature. With no bridge at all the editor still
runs and saves locally (that is how the hosted preview works). If you ever
open the editor from a page other than `index.html`, define the same six on
`window.MythicBridge` first.

## 7. Testing

`tools/athena-harness/` — headless Playwright suites that drive the real
editor with local copies of three r128 (no CDN needed). `setup.sh` once,
then the commands in its README. 4 suites (18 + 11 + 11 + 9 steps) + the
no-addon fallback + the bundled-page check were green at handoff. The
sandbox that built this had **no CDN access**, so the production script URLs
(cdnjs r128, jsdelivr addons — the same ones `index.html` already loads)
were never exercised here; first thing after deploy, open the editor once
and confirm the "addons did not load" toast does *not* appear.

## 8. Known limits — decide, don't discover

- Player-only physics: no object-vs-object collision, no rigid bodies, no
  ceilings. Terrain + simple colliders is the contract.
- No LOD / occlusion; a 160×160 map with a few hundred props renders fine on
  a laptop GPU, heavy `.glb` scenes are on you.
- Eight point lights for fires; further fires glow but do not light.
- Single global water level per map (no rivers at different heights).
- Editor is desktop-first; under 800 px it stacks but is not a touch tool.
- No multiplayer editing; last save wins.
- Hosted preview page cannot fetch (`/models/` library, URL models, Export
  are blocked there) — the game has none of these limits.

## 9. Suggested next steps

1. Wire one screen end to end (card shop is the natural first: it already
   has a walkable r128 scene) and set its live world.
2. Decide whether players may build (today: editor button is admin-only,
   nothing in the modules requires admin except embedding model files).
3. Terrain textures instead of vertex colours if the art direction wants
   detail up close; the paint indices are already there to drive it.
4. A `zone` trigger helper in the engine (`onEnter/onLeave`) — ten lines on
   top of `world.find('zone')` + `player.pos`.
