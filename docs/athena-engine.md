# ⚒ Athena Engine — the 3D map creator and mini-game engine

(Product name: **Athena Engine**. The code lives in `/src/mapforge/` and the API
object is `window.AthenaEngine`, with `window.MythicMapForge` as an alias.)

`/src/mapforge/` is a free-form 3D world editor inside the game: sculpt and paint a
heightfield, set a water level, place props and your own `.glb` models with a
move/rotate/scale gizmo, tune sun/sky/fog, walk the map in Play mode, save it.

**Open it:** Pricing Admin panel → "⚒ Open Athena Engine", or `/?mapforge=1`
(`&map=<id>&src=cloud|local` opens a saved map). Press **H** inside for controls.

It is separate from the legacy *Battlemap Editor* in index.html, which paints the
fixed battle grid. The two coexist.

## Files

| File | Role |
|---|---|
| `index.js` | entry; registers `window.MythicMapForge`; handles `?mapforge=1` |
| `mapforge.editor.js` | the UI and tools (the only file that knows about the DOM) |
| `mapforge.world.js` | **runtime**: map document → three.js scene, incl. .glb loading and animation. Used by the editor *and* the game |
| `mapforge.engine.js` | **`engine.mount(el, { game })`** — a running scene for a mini-game in one call |
| `mapforge.player.js` | first-person walker shared by Play mode and the engine |
| `mapforge.terrain.js` | heightfield mesh, brushes, `heightAt(x, z)` |
| `mapforge.water.js` | the water plane (GLSL, no textures) |
| `mapforge.props.js` | built-in procedural asset library |
| `mapforge.format.js` | the map document: schema, defaults, validation, resampling |
| `mapforge.api.js` | saving/loading — Supabase `world_maps` + localStorage |
| `mapforge.bridge.js` | the only touch-point with index.html (`window.MythicBridge`) |
| `mapforge.three.js` | loads the r128 global three.js + addons on demand |

Migrations: `sql/038_world_maps.sql` then `sql/039_world_maps_games.sql` (apply by
hand in the Supabase SQL editor). Until they are applied the editor saves to the
device and says so.

## Why the r128 global build

The battle board, card shop and battlemap editor all run the legacy r128
`window.THREE`. World Forge uses the same one, so a map can be loaded into any
of those scenes without cross-version objects. The import-map `three` (0.171
WebGPU) is *not* used here — it has no `ShaderMaterial`, which the water and sky
need. three.js is fetched only when the editor opens (never at boot).

## Using it as the engine for a mini-game

```js
// any mini-game, any container element:
const g = await window.MythicMapForge.engine.mount(hostEl, { game: 'card-shop' });
g.on('frame', (dt) => { /* your loop */ });
g.world.find('enemy');                 // markers placed in the editor → your spawner
g.world.setAnim(objectId, { clip: 'Attack', speed: 1, loop: 'once' });
g.player.pos; g.camera; g.scene; g.world.heightAt(x, z);
g.stop();                              // tear down (renderer, listeners, canvas)
```

`{ game }` loads that mini-game's **live** world — the map you marked
"★ Set live" in the Maps tab (one per game; going live makes it public so
players can read it). No live map → newest map tagged with the game → the
device's local copy → an empty flat world (`onMissing` fires), so a mini-game
never crashes on a missing map. `mode`: `'fps'` (default, pointer-lock on
click), `'orbit'`, or `'none'`. Pass `{ map }` or `{ id, source }` to bypass
the lookup.

## Collision

Every object is either **solid** or not. Props ship with a sensible default
(walls, rocks, buildings solid; grass, flowers, markers, roads not) and custom
`.glb` models are solid. Select an object → **＋ Add collision / － Remove
collision** in the inspector, box or cylinder shape; **▢ Colliders** in the
viewport toolbar outlines all of them. Stored as `objects[].col` (true/false,
absent = prop default) and `objects[].cs` (`"cyl"` or absent = box).

Runtime: one world-space box per solid object, from its rendered bounds
("simple collision"). The player treats a collider taller than a 0.55 m step
as a wall (slid along, axis-separated) and a lower one as ground, so crates and
bridges are walkable. `world.groundAt(x, z, feet)`, `world.resolveMove(...)`,
`world.setCollision(id, on, shape)`, `world.colliders` (Map).

## Hotkeys

Two schemes, switchable in the top bar and remembered per device.
**Unreal** (default): `Q` select, `W` move, `E` rotate, `R` scale, `End` drop
to floor, right-mouse + `WASD` flies. **Simple**: `T`/`R`/`C` for the gizmo,
`WASD` always flies, `Q`/`E` down/up. Both: `1`–`6` tools, `F` focus,
`X` snap (size in the toolbar), World/Local gizmo space, `Ctrl+Z/Y`, `Del`,
`Ctrl+D`, `P` play, `H` help.

Play: `W` forward, `S` back, `A` left, `D` right (arrow keys too), `Space`
jump, `Shift` run, mouse looks, `Esc` returns.

## Post-apocalyptic set

Library → **Ruins**: ruined tower, collapsed block, rubble, cracked road,
overpass, wrecked car, bent lamp post, concrete barrier, barricade, container,
radio mast, dead billboard, burnt tree, oil drum, scrap heap, crater,
generator, energy pylon, drone wreck, bunker door, supply crate. Paint layers
Asphalt, Concrete, Rust, Toxic, Soot. Sky presets **Wasteland** and
**Fallout night**.

## Models and animation

- **Project library** — put `.glb` files in `/models/`, list them in
  `/models/manifest.json`; they appear under *Library → Models → Project* in
  every map. This is the production path: files are deployed and CDN-cached,
  and the map only stores a URL.
- **Drop a file** — drag a `.glb` onto the canvas or *Add .glb file*. It is
  embedded (base64) in the map document so the map stays a single portable
  file. Limits: 2.5 MB per file, 3.5 MB per cloud row. *Relink* (↗) converts an
  embed to a `/models/` URL once the file is deployed. Embedding is admin-only.
- **Animation** — clips in a `.glb` are detected on load (`assets[].anims`
  caches the names). Select the object → *Animation* / *Speed* / *Loop*
  (repeat, once, ping-pong) in the inspector; it previews in the editor and
  plays in the game via `world.setAnim(id, anim)`. Skinned characters are
  cloned with their skeletons rebound (SkeletonUtils-style), so many copies of
  one rig animate independently.

## Loading a map in the game (lower level)

```js
// anywhere index.html already has window.THREE (r128) and a scene:
const doc = (await window.MythicMapForge.maps.load(mapId, 'cloud')).map;
const world = window.MythicMapForge.buildWorld(window.THREE, doc, { scene, markers: false });
scene.add(world.group);
// each frame:
world.update(dt, camera);           // animates water, keeps the sky dome centred
// walking:
const y = world.heightAt(x, z);     // bilinear terrain height
const spawn = world.spawns()[0];    // { p:[x,y,z], r:[rx,ry,rz], ... }
// done:
scene.remove(world.group); world.dispose();
```

`buildWorld` returns `{ group, terrain, water, sky, sun, hemi, objects (Map id→Object3D),
addObject, removeObject, refreshObject, applyEnv, applyWater, heightAt, spawns,
setMarkersVisible, update, dispose }`. Pass `{ scene }` so fog and background are
applied; `{ gltfLoader }` to reuse a loader (index.html patches `THREE.GLTFLoader`
for Draco, so the default `new THREE.GLTFLoader()` picks that up). Camera `far`
must be > 1000 for the sky dome.

## The map document (schema v1)

```jsonc
{
  "v": 1, "id": "map_…", "name": "…", "description": "…",
  "game": "card-shop",                          // the mini-game this world is for
  "terrain": { "n": 64, "cell": 2,            // 64×64 cells of 2 m = 128 m square, centred on the origin
               "heights": [ /* (n+1)² numbers, row-major */ ],
               "paint":   [ /* (n+1)² PAINT indices */ ] },
  "water":   { "on": true, "level": -0.6, "color": "#2e6f9e", "opacity": 0.78, "wave": 0.12, "speed": 1 },
  "env":     { "preset": "day", "shadows": true, "skyTop": "#…", "skyBottom": "#…", "fogColor": "#…",
               "fogNear": 60, "fogFar": 320, "sunEl": 55, "sunAz": 40, "sunIntensity": 1.25,
               "sunColor": "#…", "ambient": "#…", "ambientIntensity": 0.55, "groundColor": "#…" },
  "assets":  [ { "id": "a_…", "label": "Duck", "url": "/models/duck.glb", "anims": ["Idle"] },
               { "id": "a_…", "label": "Dropped", "data": "<base64 .glb>", "size": 81234 } ],
  "objects": [ { "id": "o_…", "t": "house",           // prop id from PROP_CATALOG, or "glb"
                 "a": "a_…",                         // asset id when t === "glb"
                 "p": [x, y, z], "r": [rx, ry, rz],   // metres / radians (Euler XYZ)
                 "s": [sx, sy, sz], "c": "#hex",      // scale, optional tint
                 "n": "name", "g": true,              // g = grounded (y follows the terrain)
                 "anim": { "clip": "Idle", "speed": 1, "loop": "repeat" } } ],
  "meta":    { "created": 0, "updated": 0, "author": "…" }
}
```

Vertex `i = row * (n+1) + col` sits at `x = -n*cell/2 + col*cell`, `z = -n*cell/2 + row*cell`.
`normalize()` in `mapforge.format.js` brings *any* JSON into this shape with
defaults, so an old export never crashes the editor. **Never reorder `PAINT`** —
append only, indices are stored per vertex.

Gameplay markers (`spawn`, `enemy`, `waypoint`, `zone`) are ordinary objects; the
runtime hides them with `markers: false` and `world.spawns()` lists player spawns.

## Storage

- **cloud** — `public.world_maps`, one row per map, `data` = the document. Owner
  reads/writes their own; anyone signed in can *read* rows with `is_public`.
  Row cap 4 MB (a 160×160 map is ~600 KB). `game` + `live` (039) pick the
  world a mini-game loads; one live map per owner per game.
- **local** — `localStorage` (`mf_maps_v1` index + `mf_map_<id>`). Guests and
  cloud-failure fallback. "Upload" moves a local map to the cloud.
- **draft** — `mf_draft_v1`, autosaved on every change; offered back on open.

## Deliberately out of scope

- No player-facing uploads (repo rule). Models are referenced by URL from
  `/models/` or a CORS host; the admin-only file drop embeds into the map
  document rather than hosting a file.
- No physics beyond terrain height and water buoyancy in Play mode; no object
  collision.
- No multiplayer editing.

## Testing

`node _synckcheck.mjs` for index.html. For the modules there is no CDN in the
sandbox: serve `public/src` with a static server, point
`window.MF_THREE_URLS` at local copies of r128 + the three addons, and drive it
with Playwright (headless Chromium renders via SwiftShader at ~20 fps).
