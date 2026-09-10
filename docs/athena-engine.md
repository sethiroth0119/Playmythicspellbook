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
| `mapforge.games.js` | the **game scenes** registry: a mini-game registers an adapter so its map opens in the editor |
| `mapforge.overlay.js` | the game side of game scenes: `AthenaEngine.overlay.forGame(id)` → the live map as an overlay (slot transforms, replacements, extra objects) |

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

## VFX and weather

`mapforge.vfx.js` is a GPU particle system: a particle's whole life is a
function of time in the vertex shader (start, velocity, gravity, wind,
turbulence, rebirth with a fresh hash), so an emitter is one draw call and no
per-frame CPU work. Sprites are drawn on a canvas at startup; nothing is
hosted. Fire is additive, smoke and weather are alpha-blended and take the
scene fog.

- **Emitters** — Library → VFX: fire, blaze, smoke, black smoke, steam, ground
  fog, sparks, toxic gas, dust, light motes. Select one for intensity, size
  and tint (`objects[].fx = { i, s }`, tint in `c`). Fire carries a flickering
  point light; eight lights are budgeted, the rest still glow.
- **Built-in effects** — campfire (fire), crater (toxic gas), generator
  (sparks), wrecked car and burnt tree (smoke), energy pylon (motes) carry
  their effect at a fixed offset; the inspector switches it off
  (`fx.off = true`).
- **Weather** — Sky tab: none, rain, storm (with lightning: a flash light and
  random bolts), snow, ash fall, dust storm; amount, wind direction and speed
  (`env.weather`, `weatherIntensity`, `windDir`, `windSpeed`). Weather lives
  in a box that travels with the camera and wraps. Wind pushes every smoke
  column too.
- Runtime: `world.emitters`, `world.weather`, `world.refreshFx(id)`,
  `world.setFxEnabled(false)` for a low-end mode; `mount({ onLightning })`
  is forwarded to the storm.

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

## Content folders (the outliner)

Right rail → **Scene**. Every placed object can live in a folder; folders nest.
Click a folder name to make it the **target** — everything you Place or Scatter
lands inside it (the HUD says `· into 📁 name`). Drag objects (or folders) between
folders, or set the folder in the inspector's **Folder** field. Per folder:
👁 hide / show its objects (hidden in the game too — park alternatives without
deleting them), 🔒 lock (objects cannot be picked in the viewport), ◎ select its
contents, ＋ sub-folder, ✕ delete (contents move up a level; nothing is removed
from the map). Undo covers all of it.

Document: `folders: [{ id, name, parent, open, vis, lock }]`, `objects[].f` = folder
id (absent = root). `normalize()` drops dangling parents and breaks cycles.

Runtime: `world.folders()`, `world.inFolder('Enemies')` (descendants included),
`world.setFolderVisible(name, on)`, `world.folderVisible(id)`. A spawner that
reads `world.inFolder('Wave 2')` is ten lines; hiding the "Night" folder by day
is one.

## Game scenes — editing a mini-game's own map (the Homestead Farm)

A mini-game that draws its own 3D scene registers an **adapter**:

```js
AthenaEngine.games.register({
  id: 'farm', label: 'Homestead Farm', icon: '🐄', describe: '…',
  slots: [{ k: 'feedmill', label: 'Feed Mill', icon: '🌾' }, …],   // for the inspector
  build() → map document,   // the game's layout as an Athena map: one `slot` object per game asset
});
```
(`window.__athenaGames.push(adapter)` works before Athena has loaded.)

Maps tab → **Game scenes** lists every adapter. **Open scene** loads the live map
tagged with that game, or builds one from the game (`build()`); **Rebuild from
game** always builds fresh; **Restore missing slots** adds back any asset the
current map has no slot for. The top bar shows `🐄 Homestead Farm scene`.

A **slot** (`t: 'slot'`, `objects[].k` = the game's id, Library category
*Slots* — never placed by hand) is a stand-in for something the game draws
itself. Move / turn / scale it and the game moves that asset. Select it and
**⇄ Replace with …** swaps in whatever prop or model is picked in the Library
(the slot keeps its `k`, so the game draws the replacement in that asset's
place); **↺ Restore game asset** puts the stand-in back. Deleting a slot means
the game keeps its default placement for that asset. Anything else you place
(trees, lanterns, fire, a `.glb`, weather) is drawn by the game around its own
assets.

**Overlay pieces** (Maps tab, under Game scenes): which of *this map's* ground,
water and sky the game renders. The farm adapter sets all three off — the farm
keeps its ground, sky and animals and takes only the objects; tick Ground to
replace the farm's tiles with sculpted, painted terrain.

Saving, ★ Set live and closing the editor each fire `athena:saved` /
`athena:live` / `athena:closed` on `window` (`detail.game`); the farm listens
and reloads its overlay at once, so a change shows behind the editor as soon
as it is saved.

⚠ A live game scene is **global**: the game loads the newest live map for its
id, for every player. That is why the farm's "⚒ Open in Athena Engine" button
(Athena tab) is admin-only — it is how the game's farm is redesigned, not a
per-player look. `scene: { ground, water, sky }` in the document records the
overlay pieces.

Game side (what the farm does in `farm.athena.js`):

```js
const ov = await AthenaEngine.overlay.forGame('farm', { THREE, scene });   // null → draw as usual
scene.add(ov.group);                       // props, models, VFX, weather; slot stand-ins are hidden
const s = ov.slot('feedmill');             // { o, p, r, s, hidden, replaced } or null
const body = ov.buildReplacement('coop');  // Object3D for a replaced slot (prop clone / .glb), else null
ov.update(dt, camera); ov.dispose();
```
`buildWorld(THREE, map, { ground, water, sky, lights })` accepts the same piece
toggles; `world.slots()`, `world.slot(k)`, `world.buildDetached(o)` are the
primitives underneath.

## Athena Widgets — the UI designer (`/src/widgets/`)

`window.AthenaUI` — a Blueprint-style widget editor for the game's UI, opened
from the admin panel (**🧩 Open Widget Designer**), the ⚒ Athena top bar
(**🧩 Widgets**) or `?widgets=1`. Press **H** inside.

- **Designer** — a tree of panels (Canvas: free placement with drag/resize;
  Vertical / Horizontal box; Border) and controls (Text, Button, Image, Icon,
  Progress bar, Spacer, Text input, Toggle) drawn by the SAME renderer the game
  uses. Every property can be a **binding**: `{gems|num}`, `{res.wood}`,
  `{farm.animals}`, `{$myVar}`; filters `num int fixed:1 pct upper lower cap
  time len default:x`; functions `min max round floor len str num now`;
  operators `+ - * / % > < >= <= == != && || !`. No `eval` — a fixed grammar
  in `widgets.format.js`. **{ } Data** lists everything bindable.
- **Graph** — event nodes (On Construct, On Click, On Change, On Tick) joined by
  execution wires to actions (Toast, Set variable, Branch, Sequence, Delay,
  Call game action, Set property, Set visible, Go to screen, Print). Drag from
  an out-pin to an in-pin; click a wire to cut it; right-click for nodes.
- **Target** — where it shows: a **slot** the game exposes
  (`data-athena-slot="farm.hud"`; the farm has `farm.top`, `farm.hud`,
  `farm.panel.top`, `farm.panel.bottom`; every page has `game.overlay`), or
  any element by **selector** (🎯 **Pick** clicks one in the real UI) with
  *append / prepend / before / after / replace / contents*. `replace` hides the
  element and shows the widget; `contents` keeps the element and swaps its
  insides. Unliving restores the original.
- **Theme** documents restyle the whole game: CSS variables (🔍 reads the
  game's own `:root` variables) plus rules, previewed live while editing.
- **Preview** mounts the widget with real data so clicks run the graph.
- **Live** — Save, then ★ Set live in the Library. A live cloud document applies
  to every player; **only an admin can set live** (trigger in `sql/040`, the
  server refuses otherwise). A live device document applies on this device
  only. The runtime (`widgets.runtime.js`) loads the live set at boot (cached
  on the device for offline starts), mounts into targets and follows DOM
  changes with a MutationObserver; bindings refresh when the data changes.

Data comes from `window.MythicBridge.ui.data()` (gems, name, level, res.*,
corp, farm summary, screen…) — add a field there and it is bindable. Actions
come from `MythicBridge.ui.actions` (toast, navigate, render, save) plus what a
screen registers for its slots: the farm registers `farm.tab`, `farm.build`,
`farm.feed`, `farm.collect`, `farm.tend` via `AthenaUI.slots.register('farm.', …)`.

Migration: `sql/040_ui_widgets.sql` (table `ui_widgets`, RLS, admin-only live).
