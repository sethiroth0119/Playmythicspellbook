# ⚒ World Forge — the 3D map creator

`/src/mapforge/` is a free-form 3D world editor inside the game: sculpt and paint a
heightfield, set a water level, place props and your own `.glb` models with a
move/rotate/scale gizmo, tune sun/sky/fog, walk the map in Play mode, save it.

**Open it:** Pricing Admin panel → "⚒ Open World Forge", or `/?mapforge=1`
(`&map=<id>&src=cloud|local` opens a saved map). Press **H** inside for controls.

It is separate from the legacy *Battlemap Editor* in index.html, which paints the
fixed battle grid. The two coexist.

## Files

| File | Role |
|---|---|
| `index.js` | entry; registers `window.MythicMapForge`; handles `?mapforge=1` |
| `mapforge.editor.js` | the UI and tools (the only file that knows about the DOM) |
| `mapforge.world.js` | **runtime**: map document → three.js scene. Used by the editor *and* the game |
| `mapforge.terrain.js` | heightfield mesh, brushes, `heightAt(x, z)` |
| `mapforge.water.js` | the water plane (GLSL, no textures) |
| `mapforge.props.js` | built-in procedural asset library |
| `mapforge.format.js` | the map document: schema, defaults, validation, resampling |
| `mapforge.api.js` | saving/loading — Supabase `world_maps` + localStorage |
| `mapforge.bridge.js` | the only touch-point with index.html (`window.MythicBridge`) |
| `mapforge.three.js` | loads the r128 global three.js + addons on demand |

Migration: `sql/038_world_maps.sql` (apply by hand in the Supabase SQL editor).
Until it is applied the editor saves to the device and says so.

## Why the r128 global build

The battle board, card shop and battlemap editor all run the legacy r128
`window.THREE`. World Forge uses the same one, so a map can be loaded into any
of those scenes without cross-version objects. The import-map `three` (0.171
WebGPU) is *not* used here — it has no `ShaderMaterial`, which the water and sky
need. three.js is fetched only when the editor opens (never at boot).

## Loading a map in the game

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
  "terrain": { "n": 64, "cell": 2,            // 64×64 cells of 2 m = 128 m square, centred on the origin
               "heights": [ /* (n+1)² numbers, row-major */ ],
               "paint":   [ /* (n+1)² PAINT indices */ ] },
  "water":   { "on": true, "level": -0.6, "color": "#2e6f9e", "opacity": 0.78, "wave": 0.12, "speed": 1 },
  "env":     { "preset": "day", "shadows": true, "skyTop": "#…", "skyBottom": "#…", "fogColor": "#…",
               "fogNear": 60, "fogFar": 320, "sunEl": 55, "sunAz": 40, "sunIntensity": 1.25,
               "sunColor": "#…", "ambient": "#…", "ambientIntensity": 0.55, "groundColor": "#…" },
  "assets":  [ { "id": "a_…", "label": "Duck", "url": "/models/duck.glb" } ],
  "objects": [ { "id": "o_…", "t": "house",           // prop id from PROP_CATALOG, or "glb"
                 "a": "a_…",                         // asset id when t === "glb"
                 "p": [x, y, z], "r": [rx, ry, rz],   // metres / radians (Euler XYZ)
                 "s": [sx, sy, sz], "c": "#hex",      // scale, optional tint
                 "n": "name", "g": true } ],          // g = grounded (y follows the terrain)
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
  Row cap 4 MB (a 160×160 map is ~600 KB).
- **local** — `localStorage` (`mf_maps_v1` index + `mf_map_<id>`). Guests and
  cloud-failure fallback. "Upload" moves a local map to the cloud.
- **draft** — `mf_draft_v1`, autosaved on every change; offered back on open.

## Deliberately out of scope

- No image/video/GLB **upload** (repo rule: text only). Models are referenced by
  URL; put files under `/models/` or use a CORS-enabled host.
- No physics beyond terrain height and water buoyancy in Play mode; no object
  collision.
- No multiplayer editing.

## Testing

`node _synckcheck.mjs` for index.html. For the modules there is no CDN in the
sandbox: serve `public/src` with a static server, point
`window.MF_THREE_URLS` at local copies of r128 + the three addons, and drive it
with Playwright (headless Chromium renders via SwiftShader at ~20 fps).
