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
| `mapforge.actors.js` | **actor blueprints**: components + an event graph on any object, and the runtime that executes them (`world.actors`) |
| `mapforge.nav.js` | **navigation**: a grid navmesh baked from terrain + colliders, A* with string-pulling (`world.nav`) |
| `mapforge.audio.js` | **positional audio** (three.js WebAudio): one listener on the camera, emitters on objects, one-shots at the player or in 2D |
| `mapforge.post.js` | the **look pass**: bloom + vignette composited over the scene (self-contained, no addons) |
| `mapforge.spline.js` | **splines**: Catmull-Rom curves, mesh bending / scatter / terrain shaping, the Library presets |
| `mapforge.assets.js` | the **asset browser** behind Library: one index over props / models / prefabs / sounds, search + tags, favourites + recents, offscreen thumbnails |
| `mapforge.quality.js` | the **quality ladder** (pixel ratio, shadows, effects, effect range) with auto-tune; remembered per device |
| `mapforge.physics.js` | **rigid-body physics** (cannon-es, vendored at `/vendor/cannon-es.js`): terrain heightfield, static colliders, dynamic/kinematic bodies, the player as a kinematic sphere |
| `../widgets/graph-editor.js` | the shared Blueprint-style node editor (used by the actor graph panel) |

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

## Actor Blueprints — behaviour on any object (round 6)

Select an object → inspector → **⚡ Add blueprint**. An actor carries
**components** and an **event graph**, like an Unreal Actor:

- **Components** — Trigger volume (radius around the actor; drawn as an orange
  ring while selected), Point light (colour, intensity, distance; eight are
  budgeted per world), Rotating (deg/s around Y), Floating (bob amplitude and
  speed), Tag (a label the game can query with `world.actors.withTag('loot')`).
- **Variables** — typed (`num` / `text` / `bool`), read as `{$name}`.
- **Event graph** — the bottom panel (⚡ Event graph). Events: Begin Play, On
  Tick (ms), On Enter / On Exit (the player crosses the trigger radius), On
  Interact (the player presses **E** inside it; the prompt text shows on
  screen). Actions: Move (offset or absolute, over seconds), Rotate, Scale,
  Spin on/off, Set visible, Set tint, Play animation, Effect on/off, Light
  on/off, Spawn (a prop id or a prefab name at an offset), Destroy, Teleport
  player, Toast, Set variable, Branch, Sequence, Delay, Call game action,
  Print. Targets: `self`, `player`, another object's name, or a prefab part as
  `self.partName`. Every field takes the widget expression language
  (`{$hp} - 1`, `{dist} < 3`, `{self.x}`, `{player.z}`, `{gems|num}`).
  Right-click the graph for nodes, drag pins to wire, click a wire to cut it.

It runs only while **playing**: the editor's Play (P), `engine.mount()`
(E is the interact key; pass `interactKey` to change it), and a game
overlay (Begin Play / Tick / components run without a player; the host may
pass `player` to `overlay.forGame` or call `ov.setPlayer` for triggers). In
edit mode a blueprint is data. Play snapshots every actor's transform, tint
and effects and puts them back on stop; spawned objects are runtime-only
(`_rt`) and are removed; a destroyed persistent object is hidden, not deleted.

Document: `objects[].bp = { vars, comps, graph }` (see `mapforge.actors.js`,
`normalizeBp`). Runtime: `world.actors` (`start/stop/update/fire/vars/withTag/
adopt/forget`), `world.startPlay(player)`, `world.stopPlay()`, `world.interact()`,
`world.playing`; `buildWorld` accepts `toast`, `onPrompt`, `actions` for the
graph's Toast / prompt / Call nodes.

## Prefabs — reusable groups (round 6)

**Ctrl/Shift+click** several objects (the inspector switches to the
multi-selection view) → name it → **📦 Create prefab**; or 📦 on a folder in
the outliner. The pieces are replaced by ONE instance and the definition goes
to Library → **Prefabs**, from where instances are placed like props (Place
and Scatter both work). An instance moves, turns and scales as one; its parts
collide individually and animate / emit effects like top-level objects.

- **✎ Edit prefab** unpacks an instance in place (its pieces are selected);
  change them, then **⤴ Apply to prefab** rewrites the definition and every
  instance in the map is rebuilt. **⤵ Unpack** just breaks the link.
- **📚 Shelf** keeps a prefab on this device across maps (Library → Prefabs
  → Shelf → click to add to the current map). URL models travel with it;
  embedded models do not.
- Blueprints on an instance address its parts as `self.partName`; a Spawn node
  can spawn a prefab by name.
- A game slot can be **replaced** with a prefab like any prop.

Document: `prefabs: [{ id, name, icon, objects: [child objects relative to the
instance origin] }]`, instances are `{ t: 'prefab', pf: id }`. No nesting (a
prefab inside a prefab is flattened by `normalize()`). Runtime: `world.parts`
(`'instance:child'` → Object3D), `world.partDoc(id)`, `world.prefabOf(o)`.

Multi-selection also drives Duplicate all, Delete all and the folder move.

## Physics (round 7)

Add a **Physics body** component to an object: `kind` dynamic (mass, gravity,
collides with everything) or kinematic (moved by the graph, pushes dynamic
bodies), `shape` box / sphere / cylinder sized from the object's rendered
bounds, `mass`, `friction`, `bounce`. While playing, the world simulates:

- the terrain as a heightfield (exactly the heights the player walks on),
- every solid collider — props, models, prefab parts — as a static body,
- each Physics-body object, synced back to its three.js root every frame,
- the player as a kinematic sphere, so walking into a barrel shoves it.

Graph: **Impulse** (a kick in N·s, `local` = the body's own frame with +z
forward), **Set velocity**, **Set body kind** (dynamic / kinematic / static),
and the event **On Hit** (`with`: empty for anything, `player`, `ground`, an
object name or a tag; `minImpact` in m/s; `{hit.impact}` and `{hit.other}`
are readable in the chain). A Spawn followed by an Impulse on the spawned
name throws things.

Engine: cannon-es 0.20.0 (MIT), ~340 KB of plain JavaScript, **vendored** at
`public/vendor/cannon-es.js` (copied from `node_modules/cannon-es/dist/`; the
version is pinned in `package.json` devDependencies) so gameplay never
depends on a CDN. It is loaded with one dynamic `import()` the first time a
map with a Physics component is played (`window.MF_CANNON_URL` overrides the
URL; the harness serves a local copy). Chosen over a WebAssembly engine
because the game's props are boxes, cylinders and heightfields — exactly
cannon-es's shapes — and because WASM adds a loading/CSP story for no
visible gain at this art style.

Play with physics starts the actors only after the library is in (a few
hundred ms the first time, instant after), so an Impulse on Begin Play
lands. Stop restores every body's transform (the actor snapshot) and
removes the bodies; edit mode never simulates. Runtime: `world.physics`
(`bodies`, `impulse`, `setVelocity`, `setKind`, `drainHits`, `adopt`,
`forget`), `world.physicsReady()`; `buildWorld(…, { gravity })`.

Limits: no joints or constraints yet, no water buoyancy for bodies, shapes
are primitives (no convex hulls from .glb geometry), one gravity per world.

## Navigation and AI (round 8)

A **navmesh** is a grid (1 m cells) over the terrain square, baked from the
heightfield and the solid colliders: a cell is walkable unless it is too
steep (rise over one cell > 0.9), under water (deeper than a wade) or under
a collider taller than a step, padded by the agent radius. Terrain tab →
View → **Navmesh** draws it (green walkable, red blocked). It bakes when
play starts if any actor needs it, and re-bakes after terrain or collider
edits. Paths are A* over the grid with line-of-sight string-pulling, so
agents cut corners instead of zig-zagging.

**Nav agent** component: `speed` (m/s), `turn` (how fast it faces its
heading), `stop` (arrival distance). Nodes (all take `player`, an object
name, `self.part`, or `x, z` where a point is expected):

- **Move To** — walk to a target or to `x`/`z`; `arrived` / `failed` fire later.
- **Chase** — re-path toward the target every 0.4 s while it is within
  `range`; `caught` inside `reach`, `lost` when it leaves range.
- **Patrol** — `points`: waypoint names (`wp1, wp2`) or `folder:Route`
  (every waypoint in that folder, in order); `wait` seconds at each;
  `arrived` fires at each point; `loop`.
- **Wander** — random walkable points within `radius` of where it started.
- **Stop moving**, **Look at**.
- Event **On See** — the target is within `range` and inside `fov` degrees
  in front of the actor; fires once per sighting (re-arms when it leaves).

Bindings: `{dist}` (to the player), `{agent.moving}`, `{agent.mode}`.
Agents move kinematically along the path, slide along colliders (the same
`resolveMove` the player uses), re-path when stuck, and stand on the ground
(colliders included). A kinematic Physics body on an agent pushes dynamic
bodies out of its way.

Enemy recipe: a prefab whose part carries a Nav agent and `On See → Chase
→ (caught) Toast`, and a spawner actor with `Begin Play → Spawn Enemy`.

Runtime: `world.nav` (`bake`, `walkable`, `nearestWalkable`, `findPath`,
`debugMesh`, `invalidate`), `world.navBake()`, `world.navInvalidate()`;
`buildWorld(…, { nav: { cell, maxSlope, agentRadius, step } })`.

Limits: agents avoid static colliders, not each other; no crowd
separation, no flying; the grid is one level (no bridges over walkable
ground — a bridge deck counts as ground where it is low enough to step onto).

## Audio (round 9)

Library → **Sounds**: add files the game already ships (`/assets/Audio/…`,
listed in `/models/manifest.json` → `sounds`) or any URL; ▶ previews.
Nothing is uploaded (repo rule). The map keeps `sounds: [{ id, label, url }]`.

- **Sound emitter** component — a positional loop (or one-shot) on the object:
  `s` (a Library sound), `vol`, `dist` (reference distance; it fades beyond),
  `loop`, `auto` (start at Begin Play). Pans and fades as the player walks.
- **Play sound** node — `sound` (label, id or URL), `at`: `self` / an object
  name (positional), `player`, or `2d` (UI-style); `vol`, `loop`.
- **Stop sound** node — `at`: a target, `player`, `2d`, or `all`.

One `AudioListener` rides on the active camera (editor Play, `engine.mount`,
or the camera passed to `world.update` by an overlay host). Browsers gate
audio behind a user gesture: the context resumes on the first click or key,
so a game opened by clicking simply plays. Runs only while playing; stop
silences everything. Runtime: `world.audio` (`play`, `stopWhere`, `count`,
`listener`), `world.setAudioCamera(cam)`.

## Performance (round 10)

- **Instancing** — in the game (`engine.mount`, overlays) repeated static
  props with the same tint and no blueprint or effect are drawn as
  `InstancedMesh` batches: one draw call per template mesh instead of one per
  placement (400 scattered pines: ~1,200 draw calls → 3). Every object keeps
  its root (transform, bounds, collider); only its meshes are hidden and the
  batch draws in their place. Destroying, hiding a folder or moving an object
  updates its instance; objects added at runtime rebuild the batches lazily.
  The editor keeps per-object meshes (picking, gizmo): `world.instancing`,
  `world.setInstancing(v)`, `world.stats()` → batches / instanced / draws.
- **Effect culling** — emitters farther than `fxRange` from the camera are
  neither updated nor drawn (`world.setFxRange`).
- **Quality** — `AthenaEngine.quality` / the editor's top-bar select:
  `auto` (default; starts high and steps *down* while the frame rate stays
  under 28 fps for a few seconds — never up), `high`, `medium`, `low`. Each
  level sets pixel ratio (2 / 1.5 / 1), shadows and shadow-map size (2048 /
  1024 / off), effects on/off and effect range (160 / 80 / 40 m). Remembered
  per device (`mf_quality`); `quality.onChange` lets a host react.
- The editor HUD shows fps, triangles and draw calls.

Still open: level-of-detail for `.glb` models, chunked terrain. A 160×160
terrain is 25k vertices in one draw call and has not needed either.

## Materials and lighting (round 11)

- **Textured terrain layers.** The paint indices now drive a detail texture
  per layer: a procedural 4×4 atlas (grass strokes, dirt speckle, sand
  ripples, rock cracks, snow, cobbles, asphalt, concrete slabs, rust, toxic,
  soot — one tile per `PAINT` entry, append-only like `PAINT`) sampled per
  cell through a layer-index texture and feathered across the four
  surrounding cells; steep faces switch to the rock tile. The shader is
  injected into `MeshStandardMaterial` (`onBeforeCompile`), so lighting,
  shadows and fog are untouched. Sky tab → Look: **Ground detail**
  (strength) and **Ground tile** (repeats per metre) — `env.terrainDetail`,
  `env.terrainTile`.
- **Material override per object** — inspector → **Material**: roughness,
  metalness, emissive colour and intensity, on props and whole `.glb` models
  (textures kept). Stored as `objects[].mat = { rough, metal, em, ei }`;
  materials are cloned per object (the shared prop templates are never
  mutated); overridden objects are not instanced. `world.refreshMat(id)`.
- **Look pass** — Sky tab → Look: **tone mapping** (ACES filmic default,
  Reinhard, linear) and **exposure** on the renderer (`env.tone`,
  `env.exposure`; the world calls `opts.onEnv(env)` and the host applies
  them — `applyTone(THREE, renderer, env)` in `mapforge.engine.js`);
  **bloom** (strength + threshold) and **vignette** through
  `mapforge.post.js` — scene → bright pass → two blur iterations →
  composite; with both at zero the scene renders straight to the canvas.
  Low quality skips the pass (`LEVELS.low.post = false`).

Limits: no environment maps / reflections, no SSAO; the terrain detail is
procedural (no texture assets are hosted), one tile set for every map.

## Asset browser (round 12)

Library is now a content browser rather than a flat list — the part of
Unreal's Content Browser / Unity's Project window that matters for a map
maker: **find it, see it, place it**.

- **Search everything.** The box at the top of Library searches props,
  this map's models, project models (`/models/manifest.json`), prefabs (map
  + shelf) and sounds at once, by name and by tag; every token must
  prefix-match, label hits rank above tag hits. Typing ignores the prop
  category you were on (a category only scopes the idle grid); **Models /
  Prefabs / Sounds** still scope a search to that kind, **★** to favourites,
  **All** is the whole index. `Esc` clears.
- **Tags.** Built-in props carry hand-written tags (`PROP_TAGS` in
  `mapforge.assets.js`: a barrel is *wood, container, storage*; a lantern is
  *light, lamp, glow, night*), plus derived ones (*tintable*, *effect*,
  *marker*, *no-collision*, *animated*, *embedded*). Manifest entries may
  carry `tags: []`. Your own models and prefabs take tags in the details
  panel (comma-separated; stored as `assets[].tags` / `prefabs[].tags`,
  normalised to ≤ 12 short lower-case words). The chips under the search are
  the tag cloud of the current results — click one to narrow.
- **Thumbnails.** A 96 px offscreen renderer draws each prop, model and
  prefab once from a ¾ view and caches the PNG for the session; VFX
  emitters and markers keep their icon. Project models not yet in the map
  are loaded once for their picture (no asset is created; capped at 24 per
  session). Prefab pictures are recomposed after **Apply**. If a second
  WebGL context cannot be created the cards fall back to icons.
- **Favourites and recents** (`localStorage` → `mf_assets_v1`): ★ on any
  card or in the details panel; the last twelve things picked show as a
  Recent row above the grid. Grid / list toggle next to the search box.
- **Details panel** under the grid: picture, kind and source (built-in /
  this map / project / this device), tags, and per kind: collision + tint +
  placed count (props), source URL or embedded size, clip names, dimensions
  and triangle count (models), parts and placed count (prefabs); actions —
  favourite, add to map, relink, rename, shelf, remove.
- Editor API (tests, hosts): `editor.library.search(q, filters)`,
  `.pick(key)`, `.setQuery(q)`, `.setCat(c)`, `.thumb(key)`, `.prefs`,
  `.index`; `editor.thumbs()` is the renderer. Keys are `kind:id`
  (`prop:tree`, `model:a_…`, `project:duck`, `prefab:pf_…`, `shelf:…`,
  `sound:s_…`, `psound:rain`).

Limits: thumbnails are session-only (never persisted — a hundred PNGs is
cheap to redraw and expensive to store); no folders inside the Library (map
content folders are the outliner's job); no drag-and-drop from a card (pick,
then click the ground, as before).

## Splines (round 13)

Draw a curve on the ground and a mesh follows it — Unreal's spline mesh
component, Unity's spline package. A spline is an object (`t: 'spline'`)
whose body is generated from control points; it saves, undoes, duplicates,
folders and instances into games like any other object.

- **Drawing.** Library → **Splines** (or search: road, wall, fence, tree
  line, lamp posts, colonnade, dirt track, stone path, river bed, custom).
  With Place active every ground click adds a point; **Enter** or a
  double-click finishes, clicking the first point again closes a loop,
  **Backspace** removes the last point, **Esc** cancels. The spline's origin
  is its first point; points are stored relative to it (`sp.pts`), so
  moving the object moves the whole curve.
- **Editing.** A selected spline shows gold handles on its control points
  (green = first, blue = selected). Click a handle and the gizmo moves that
  point; the curve rebuilds live. Inspector → Spline: mode, source, piece
  length / spacing, width, bend, stretch, forward axis, jitter, align,
  reshuffle, paint layer, depth, tension, loop, ＋ Add point (after the
  selected one, or extending the end), － Delete point, ⛰ Apply to terrain.
- **Modes.**
  - *Mesh* — the source (a built-in prop or any model in the map — drop a
    road `.glb` in, pick **Custom**) is repeated along the curve and
    **bent** to it: vertices are mapped by arc length, so a straight slab
    becomes a curved road. Geometry is merged per material (a 40-piece road
    is a handful of draw calls). *Stretch* fits a whole number of pieces
    exactly; *Bend* off places rigid pieces yawed to the tangent. The
    forward axis is the source's longer horizontal side unless overridden.
  - *Scatter* — the source is dropped every *spacing* metres with jitter,
    spread across *width*, random yaw or aligned to the curve; the seed is
    stored so the game sees the same trees as the editor.
  - *Terrain* — a translucent ribbon shows the path; **Apply to terrain**
    flattens the ground to the (smoothed) curve, sinks or raises it by
    *depth*, and paints the layer under it — all through the terrain brush,
    so it is one undo step. Mesh/scatter splines can Apply too, so a road
    sits in the hillside rather than on it.
- Grounded splines (the default) read the terrain height at every sample
  and rebuild after sculpting; a `.glb` source shows the placeholder until
  the model loads, then rebuilds.
- Schema: `sp = { pts, closed, mode, src:{t|glb,a,c}, gap, w, tension,
  deform, stretch, axis, jitter, align, seed, paint, dy }`
  (`normalizeSpline`); a spline with fewer than two points is dropped.

Limits: splines never collide (one box around a curve would be wrong — put
a wall prop where the player must be stopped, or bake navigation around the
generated pieces later); no per-point width or roll; mesh mode bends static
geometry only (skinned models are placed rigid).

## ✎ Edit UI — the live page editor (round 14)

The Unreal move of opening the screen you are looking at and editing it in
place. Admin panel → **✎ Edit the game UI (live)** (or `?uiedit=1`, or
`AthenaUI.openLiveEditor()`). A layer covers the running game: hover
highlights any element, a click selects it, and the panel on the right edits
it. Everything is stored as **rules** in a *page* document (kind `page`,
same store, RLS and admin-only live trigger as widgets — apply
`sql/041_ui_pages.sql`, which only widens the kind check).

- **What you can change on any element:** its direct **text** (child icons
  and sub-labels are kept), **hidden**, and a fixed list of look properties —
  colour, background, font size / weight / case / spacing / alignment,
  padding, margin, radius, border, opacity, width, height, shadow, order,
  plus a *More CSS* line for the rest of `PAGE_STYLE_PROPS`. Anything else
  (`url()`, unknown properties, event attributes, `javascript:` links) is
  dropped by `normalizePage`. **Replace with a widget…** opens the Widget
  Designer with the element as its selector target (`place: replace`).
- **How it applies:** styles and hides become one stylesheet
  (`<style id="aw-pages">`, `!important`), scoped by `body[data-aw-screen]`
  which the runtime keeps equal to `MythicBridge.ui.data().screen`; text
  and attributes are written into the element's own text nodes on every
  mutation sync, so a re-render that puts the old text back is corrected
  immediately, and deleting a rule restores the original. Rules match by
  selector (`selectorFor`: id, classes, data attributes, nth-of-type last),
  so they survive updates as long as the element keeps its identity.
- **Workflow:** edit → **Save** (cloud when signed in, else this device) →
  **★ Live** (admin) → every player on that screen sees it. Reopening on a
  screen loads its live page doc. Undo/redo (Ctrl+Z), a rules list with
  per-rule delete and **Reset page**, and *Reset this element*.
- Non-admins cannot open it (bridge `isAdmin`), and going live is refused
  by the database trigger regardless of the client.

Limits: one rule per selector per page doc; no drag-to-move or reorder
beyond CSS `order`; no new elements (build those as widgets); the game's
own JavaScript behaviour is untouched — a button keeps doing what it did.

## ⚔ The battle board as a game scene (round 15)

Admin panel → **⚔ Battle board in Athena Engine** (`src/battle/battle.athena.js`,
`window.MythicBattleAthena.open()`). The live board is a v3 battlemap
document (`cols × rows` cells, a terrain key per cell, `models[{t,x,z,rot,sc}]`,
`glbSlots`), kept on the catalogue and published to every player. Athena
opens it as a game scene tagged `battle` and writes edits back.

- **Board → Athena.** 3 metres per board cell (`bridge.battle.scale()`),
  so metre-scaled Athena props sit right next to board props. Each cell's
  terrain key paints the Athena ground (`TERRAIN_TO_PAINT`: road→asphalt,
  rubble→concrete, dirt, grass→dark grass, stone→rock, sand, snow,
  scorched→ash, water→mud, blight→toxic, lava→ember). Every placed board
  model is a 🧩 slot (`k = 'bm.<index>'`) drawn with the board's OWN
  procedural builder (`bridge.battle.buildProp`, same r128 THREE) through
  the new `buildWorld({ slotBody })` hook, so the editor shows the real
  props; a `.glb` slot shows the generic stand-in. Two folders: Board props,
  Board models.
- **Athena → board (Save).** `toBoardMap`: the paint under each cell's centre
  becomes its terrain key (`PAINT_TO_TERRAIN`, majority of the four nearest
  vertices); every surviving slot keeps its board type with the new
  x/z/rot/sc; a deleted slot removes the model; `glbSlots` and the backdrop
  are kept. `bridge.battle.setMap` stores it (Forge + device) and rebuilds an
  open board. **★ Set live** also publishes it (`bridge.battle.publish` →
  the catalogue) — every player fights on it.
- **What v3 cannot hold** — extra props, splines, models, a board prop
  *replaced* with another prop — stays in the Athena map. `_b3dBuild`
  (index.html) asks `AthenaEngine.overlay.forGame('battle')` after placing
  the board's models, adds the group at ⅓ scale, hides a replaced model
  (meshes carry `userData.bmIndex`) and draws the replacement; the overlay
  is stepped in the board's frame loop and disposed on unmount. No live
  map, no module → the board is exactly as before.
- Bridge (`MythicBridge.battle`): `size, terrain, props, defaultTerrain,
  scale, getMap, setMap, publish, buildProp, boardOpen, refreshBoard,
  openLegacyEditor` — all functions, never Forge directly.

Limits: slots are matched to board models by index, so edit the board in
ONE editor at a time (Athena or the legacy Battlemap Forge); the perspective
hex stage (`public/battle-board/`, an iframe) receives the written-back v3
(terrain + models) but not the overlay's extra objects; the 3D board's
gameplay rules (hazards per terrain key) come from v3, so a painted layer
changes the rule where the key changes.
