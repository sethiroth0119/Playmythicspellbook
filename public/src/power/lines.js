/* ════════════════════════════════════════════════════════════════════════════
   🗼 POWER LINES AND THE GRID CONNECTOR — the conductor the player draws.
   ----------------------------------------------------------------------------
   grid.js has walked a network since it shipped. Until this round that network
   was made of ROADS and nothing else, it was seeded from PLANTS and nothing
   else, and — the part that mattered — it changed nothing: solve() computed
   `unserved`, the overlay painted it, and `POWER.transmission.enforce` was
   false so a building on an islanded road was powered exactly as well as one
   wired to the turbine hall. This file is the other half: a conductor the
   player lays deliberately, a source that exists on every map from the first
   frame, and therefore a reason for the walk to be allowed to matter.

   ── 🔴 THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM ─────────────────
   A LINE IS NOT A TILE. It is a key in this module's own set, saved in this
   module's own slice, and `game.tiles` is never written.

   The alternative — a `powerline` building type — was considered and refused,
   and the refusal is not stylistic. node-city's `game.tiles[k]` is ONE object
   with ONE `type`, and `t.type === 'road'` is re-derived independently in at
   least a dozen places across index.html and /src/{streets,zoning,naming,
   parking,crowd,power}. A new tile type therefore:
     · renders as an INVISIBLE BUILDING — buildMesh() has no arm for it and no
       default arm at all, so it returns an empty Group on a tile the player
       paid for;
     · DESPAWNS every agent standing on the tile, because agentTick reads a type
       change under an agent as "the road was demolished";
     · becomes zonable land AND stops bounding zoning's flood fill, so one click
       escapes the block and runs to FILL_MAX;
     · falls out of the road maintenance cap, i.e. is free and uncapped;
     · and needs a line in ~24 more `=== 'road'` comparisons, each of which
       looks fine in review when it is missing.
   index.html has already named that bug class twice by number. A cable is a
   thing that hangs ABOVE the ground, not a thing that occupies it, so the model
   that is cheap here is also the model that is true.

   THE PRICE OF THAT DECISION, STATED SO IT IS NOT DISCOVERED LATER: a save
   round-tripped through a build where /src/power 404s loses its lines. Nothing
   else about it changes — every tile is still exactly the tile it was, the city
   still loads, still renders and is still demolishable — and the player relays
   the run. That is a strictly smaller failure than any of the five above.

   ── 🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time) ──
   `THREE`, `scene`, `game`, `BUILDINGS`, `tileAt`, `payCost`, `toast`, `mode`
   are top-level `const`/`let` in node-city's module script — lexical bindings,
   NOT properties of `window`. This file imports nothing from the host and reads
   no bare global: everything arrives in the ctx object node-city hands to
   MythicPower.mount(), and every use is guarded, because a host that predates
   this round hands over a smaller ctx and must still boot.

   ── 🖱 AND IT IS THE FIFTH CLAIMANT ON THE SAME POINTER ─────────────────────
   node-city's canvas is wanted by its own click-to-place, by OrbitControls, by
   /src/zoning's paint tool and by /src/netdrag's road drag. /src/zoning/ui.js's
   header records the MEASURED bug that comes of wiring that pairwise: with the
   Zones panel open, picking Housing off the build bar and clicking silently
   painted a zone — no toast, no cue, "the worst class of UI bug: the player
   blames themselves". So this file registers ONE claim with
   /src/netdrag/rig.js and writes no listeners of its own. One armed tool
   city-wide, one dispatcher, one bindMode. A missing arbiter costs the DRAG and
   nothing else; it never falls back to a private listener stack, because two
   dispatchers IS the bug.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER, pw } from './tuning.js';

let C = null;             // the host ctx
let T = null;             // the THREE namespace, handed over
let GRID = 24, HALF = 12, APRON = 1;
let mounted = false;
let onChange = null;      // told when the conductor set changes (Grid.invalidate)

/* THE NETWORK. A Set of "x,z" cell keys. Insertion order is irrelevant and is
   never relied on — the walk in grid.js re-derives adjacency from the keys, the
   same way it re-derives it from road tiles. */
const cells = new Set();

/* The connector's cell, resolved against the handed-over GRID at mount rather
   than trusted from tuning: /src/outside makes the same move with EDGE_Z and
   says why — a constant written against GRID = 24 is a wrong answer the day the
   grid changes, and a silent one. */
let CONN = { x: -1, z: -1 };

const K = (x, z) => x + ',' + z;
const NEI = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function warn(m) { try { console.warn('[power/lines] ' + m); } catch (e) {} }

/* ── THE DOMAIN ─────────────────────────────────────────────────────────────
   The buildable plate (0 … GRID-1) plus a one-cell apron. The apron is not a
   generalisation for its own sake: it is the verge the Grid Connector stands
   on, at world z = -12.5, between the plate edge at -12 and the highway
   embankment's toe at -12.8 (/src/outside/tuning.js HW, and both of those
   numbers were pinned by photographing them). One cell, no more — a second
   apron row would put cable inside the earthworks. */
function inDomain(x, z) {
  return x >= -APRON && x <= GRID - 1 + APRON && z >= -APRON && z <= GRID - 1 + APRON;
}
function onPlate(x, z) { return x >= 0 && x < GRID && z >= 0 && z < GRID; }

/* Occupancy, asked of the HOST and never cached. `tileAt` closes over
   node-city's live `game.tiles`, so it answers for the city as it is at the
   instant the player drags — the same argument index.js makes for installing
   `occupied` as a predicate rather than copying a tile map once a tick. A cell
   off the plate can never be occupied; there are no tiles out there. */
function occupied(x, z) {
  if (!onPlate(x, z)) return false;
  try { return !!(C && typeof C.tileAt === 'function' && C.tileAt(x, z)); } catch (e) { return false; }
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC READ — what grid.js is handed each tick.
   ----------------------------------------------------------------------------
   ⚠ THE CONNECTOR IS A CONDUCTOR IN ITS OWN RIGHT, whether or not the player
     has laid anything. A substation with no cable in it is still a substation:
     the first span the player draws has to have something to attach TO, and a
     connector that only became conductive once a line reached it could never be
     reached at all.
   ════════════════════════════════════════════════════════════════════════════ */
let _cond = null, _sig = null;
function dirty() { _cond = null; _sig = null; }
export function conductors() {
  if (_cond) return _cond;
  const s = new Set(cells);
  s.add(K(CONN.x, CONN.z));
  _cond = s;
  return s;
}

/* Cells that INJECT — the seeds grid.js adds to its plant seeding. Only the
   connector today. It seeds unconditionally; see POWER.lines.connector.seeds on
   why "connected to the national grid" and "allowed to trade over it" are two
   questions with two owners. */
export function seeds() {
  return POWER.lines.connector.seeds ? [{ k: K(CONN.x, CONN.z), x: CONN.x, z: CONN.z, kind: 'connector' }] : [];
}

/* The topology cache's signature contribution. grid.js's header records two
   signatures that were silently wrong before the third; a conductor set that
   changed without changing the key would be the fourth, and a stale network
   looks exactly like a correct one. Sorted, because a Set's iteration order is
   insertion order and re-laying the same run in a different order must not read
   as a different network. */
export function signature() {
  if (_sig !== null) return _sig;
  if (!cells.size) { _sig = 'L0@' + CONN.x + ',' + CONN.z; return _sig; }
  const a = Array.from(cells); a.sort();
  _sig = 'L' + a.length + '@' + CONN.x + ',' + CONN.z + '|' + a.join(' ');
  return _sig;
}

export function has(x, z) { return cells.has(K(x, z)); }
export function count() { return cells.size; }
export function connector() { return { x: CONN.x, z: CONN.z, k: K(CONN.x, CONN.z), ...POWER.lines.connector }; }
export function ready() { return mounted; }

/* ════════════════════════════════════════════════════════════════════════════
   THE RUN — an L, not a rectangle.
   ----------------------------------------------------------------------------
   /src/zoning's marquee fills an AREA and that is the right verb for land use.
   A cable is a PATH, so the drag resolves to two axis-aligned legs between the
   two ends of the gesture. Which leg is drawn first is `POWER.lines.elbowFirst`
   and shift swaps it — the CS2 idiom, and the reason the preview is drawn live
   rather than only on release: the player has to be able to SEE which elbow
   they are about to get before they pay for it.
   ════════════════════════════════════════════════════════════════════════════ */
export function runCells(x0, z0, x1, z1, swap) {
  const out = [], seen = new Set();
  const push = (x, z) => { const k = K(x, z); if (!seen.has(k)) { seen.add(k); out.push({ x, z, k }); } };
  const zFirst = swap ? (POWER.lines.elbowFirst === 'x') : (POWER.lines.elbowFirst !== 'x');
  const stepX = (z) => { const d = x1 >= x0 ? 1 : -1; for (let x = x0; x !== x1 + d; x += d) push(x, z); };
  const stepZ = (x) => { const d = z1 >= z0 ? 1 : -1; for (let z = z0; z !== z1 + d; z += d) push(x, z); };
  if (zFirst) { stepZ(x0); stepX(z1); } else { stepX(z0); stepZ(x1); }
  return out;
}

/* What a proposed run would actually cost and change. Split out from apply()
   because the preview, the toast and the charge must all be quoting the SAME
   arithmetic — a preview that says "8 cells, 960🔥" and a charge that takes ten
   is the shape of bug that gets reported as theft. */
export function quote(run, erase) {
  const add = [], blocked = [], out = [];
  for (const c of run) {
    if (!inDomain(c.x, c.z)) { out.push(c); continue; }
    if (erase) { if (cells.has(c.k)) add.push(c); continue; }
    if (cells.has(c.k)) continue;
    if (occupied(c.x, c.z)) { blocked.push(c); continue; }
    add.push(c);
  }
  const per = pw('lines.costPerCell', 0);
  return { add, blocked, out, n: add.length, cinder: erase ? 0 : add.length * per };
}

/* ── LAY / LIFT ─────────────────────────────────────────────────────────────
   🔴 ONE CHARGE AND ONE TOAST FOR THE WHOLE DRAG, and both are the same rule
      /src/zoning's develop() states: node-city's toast rail holds three, so a
      forty-cell run that refused thirty of them must account for the thirty in
      ONE line or the player sees three arbitrary refusals and no account of the
      rest. And the charge is a SINGLE payCost for the whole run rather than one
      per cell: payCost is an awaited round trip over the iframe bridge, so N of
      them is N chances to be interrupted half-paid, and node-city's own
      _placing lock exists because that exact shape went wrong once already. */
export async function lay(run) {
  const say = POWER.lines.say;
  if (!mounted) return { ok: false, why: 'not mounted' };
  if (run.length > pw('lines.maxRun', 64)) return { ok: false, why: say.run, n: 0 };

  const q = quote(run, false);
  if (!q.n) {
    return { ok: false, n: 0,
             why: q.blocked.length ? say.occupied : (q.out.length ? say.outside : null) };
  }
  const cap = pw('lines.maxCells', 900);
  if (cells.size + q.n > cap) return { ok: false, why: say.cap, n: 0 };

  if (q.cinder > 0) {
    let paid = false;
    try { paid = await C.payCost({ cinder: q.cinder }); } catch (e) { paid = false; }
    if (!paid) return { ok: false, why: say.afford, n: 0, cinder: q.cinder };
  }
  for (const c of q.add) cells.add(c.k);
  changed();
  return { ok: true, n: q.n, cinder: q.cinder, blocked: q.blocked.length, out: q.out.length };
}

export function lift(run) {
  if (!mounted) return { ok: false, n: 0 };
  const q = quote(run, true);
  if (!q.n) return { ok: false, n: 0 };
  for (const c of q.add) cells.delete(c.k);
  changed();
  return { ok: true, n: q.n };
}

function changed() {
  dirty();
  rebuild();
  try { if (onChange) onChange(); } catch (e) {}
  try { if (C && C.saveSoon) C.saveSoon(); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   SAVE — this module's own slice, inside /src/power's blob.
   ----------------------------------------------------------------------------
   ⚠ THE PRESENCE OF THIS KEY IS THE VERSION STAMP. index.js's `wired` latch
     reads its own key the same way `metered` does, and a blob written before
     this round carries neither. See index.js load() — absence is what
     identifies an old city, and no version number is written or needed.
   ⚠ AND IT ROUND-TRIPS THROUGH A SMALLER GRID SAFELY. Cells outside the current
     domain are DROPPED on load rather than kept and never drawn: a key that the
     walk can reach but the mesh cannot draw is a network the player cannot see
     and cannot remove.
   ════════════════════════════════════════════════════════════════════════════ */
export function save() {
  return { cells: Array.from(cells).sort() };
}
export function load(blob) {
  cells.clear();
  const a = blob && blob.cells;
  if (Array.isArray(a)) {
    for (const k of a) {
      const p = String(k).split(',');
      const x = Number(p[0]), z = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !inDomain(x, z)) continue;
      cells.add(K(x, z));
    }
  }
  dirty();
  if (mounted) changed();
}

/* ════════════════════════════════════════════════════════════════════════════
   THE MESH — two draw calls for the whole network.
   ----------------------------------------------------------------------------
   One InstancedMesh of poles, one LineSegments of wire, both rebuilt only when
   the cell set changes. node-city reduced its ground from 576 meshes to 2 and
   the file guards that budget explicitly; a per-cell Group would spend it on a
   utility. Geometries created here are disposed on the next rebuild — nothing
   is stamped `userData.owned`, because these are OURS and never pass through
   node-city's dropTileMesh.

   ── 👁 TWO GROUPS, AND THE SPLIT IS THE WHOLE POINT OF IT ────────────────────
   `G`  the CABLE — poles and wire. GATED. Visible only while the line tool is
        armed or the panel's "Power Line Poles & Wires" layer is switched on.
   `GC` the GRID CONNECTOR. NEVER gated, added straight to the scene.

   The gate is /src/water/netui.js's syncVisible() copied deliberately rather
   than reinvented: `visible = armed || (layerOn && count > 0)`. Its argument is
   the one that applies here word for word — the other power layers are an INFO
   VIEW, a mode the player enters and leaves, but a cable run is an EDITING
   SURFACE, and a player dragging a run has to see the run they are dragging
   onto. So it is gated on the TOOL, not on the panel: closing the panel to get
   the cable back would make the tool unusable.

   🔴 AND THE CONNECTOR COMES OUT OF THE GATED GROUP, which is not tidiness.
      seeds() makes the connector conductive whether or not one cell of cable
      exists, so on a fresh city it is the ONLY instruction the feature gives —
      "run a line to the tower on the north-west verge". A connector that only
      appeared once the player had already drawn a line to it would be an
      instruction that is invisible until it has been obeyed. It is a permanent
      piece of the map, in the same standing as /src/outside's highway: it was
      already there. verify() asserts it is not parented to `G`, because moving
      one `add()` call back would re-hide it and every gate in this file would
      still pass.
   ════════════════════════════════════════════════════════════════════════════ */
let G = null, GC = null, poles = null, wires = null, poleGeo = null, wireGeo = null;
let MAT = null;
const wx = (x) => x - HALF + 0.5;
const wz = (z) => z - HALF + 0.5;

function makeMaterials() {
  const L = POWER.lines;
  MAT = {
    pole: new T.MeshStandardMaterial({ color: L.pole.col, roughness: 0.95 }),
    /* Unlit and double-sided: a wire is seen from above and from below as the
       camera swings, and an unlit dark ribbon holds its colour at dusk — which
       is half of every day in this game, and the finding meshes.js records
       against the solar field and the reservoir. */
    wire: new T.MeshBasicMaterial({ color: L.wire.col, transparent: true, opacity: 0.9,
                                    side: T.DoubleSide, depthWrite: false }),
    /* The connector's own palette. Deliberately node-city's naturalistic
       register — concrete, neutral steel — rather than a second look; BAR.md's
       first dimension is lost by a single saturated building. */
    conc: new T.MeshStandardMaterial({ color: 0x9a958b, roughness: 0.94 }),
    steel: new T.MeshStandardMaterial({ color: 0xb2b6ba, roughness: 0.5, metalness: 0.55 }),
    dark: new T.MeshStandardMaterial({ color: 0x3c3a38, roughness: 0.95 }),
    warn: new T.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.7, emissive: 0x39210a, emissiveIntensity: 0.6 }),
  };
}

/* Where a pole goes. Every cell that is a dead end, a junction or a CORNER gets
   one — the places a real line needs a structure, and the places the eye reads
   the run's shape from — plus every other cell along a straight span. A pole on
   every single cell reads as a fence, not a transmission line.
   ⚠ A corner has degree 2, exactly like a straight span, so degree alone is not
     enough: the two neighbours have to be tested for being OPPOSITE. Without
     that check an L-bend loses its pole half the time depending on the parity of
     the cell it happens to land on, which looks like a rendering bug. */
function poleAt(x, z, set) {
  let d = 0, mask = 0;
  for (let i = 0; i < 4; i++) {
    if (set.has(K(x + NEI[i][0], z + NEI[i][1]))) { d++; mask |= 1 << i; }
  }
  if (d !== 2) return true;                       // dead end, junction or isolated
  // NEI is N,E,S,W: opposite pairs are N|S (0b0101) and E|W (0b1010).
  if (mask !== 0b0101 && mask !== 0b1010) return true;   // a corner
  return ((x + z) & 1) === 0;                     // every other cell of a straight run
}

/* ── THE GATE ───────────────────────────────────────────────────────────────
   `layerOn` is the panel's `wires` checkbox, pushed in by index.js's refresh()
   BEFORE its Panel.isOpen() early-out — exactly where water/index.js pushes
   `Panel.layers.pipes` into netui.js, and for the identical reason: this one
   surface must keep answering after the panel closes.
   ⚠ `count > 0` matters. Without it a city with no cable and the layer on shows
     an empty group, which is harmless — but the same expression with the layer
     OFF and the tool armed is what makes an armed tool over an empty city show
     the preview against a clean map, and the two halves are read together. */
let layerOn = false;

function syncVisible() {
  if (G) G.visible = armed || (layerOn && cells.size > 0);
}
/* Pushed by index.js on every refresh; also the seam the panel checkbox reaches
   this file through. Idempotent and free — it is a boolean and one compare. */
export function syncLayer(on) {
  layerOn = !!on;
  syncVisible();
}
export function layerVisible() { return !!(G && G.visible); }

function rebuild() {
  if (!mounted || !T || !G) return;
  if (poles) { G.remove(poles); poles = null; }
  if (wires) { G.remove(wires); wires = null; }
  if (poleGeo) { poleGeo.dispose(); poleGeo = null; }
  if (wireGeo) { wireGeo.dispose(); wireGeo = null; }
  /* Before the early-out, not after it: the gate reads cells.size, and a run
     the player just lifted back to nothing has to hide the group on the way
     past rather than leave it showing an empty one. */
  syncVisible();
  if (!cells.size) return;

  const L = POWER.lines, y0 = L.y;
  const set = conductors();
  const list = [];
  for (const k of set) {
    const p = k.split(','); const x = Number(p[0]), z = Number(p[1]);
    list.push({ k, x, z });
  }

  /* ── poles ── */
  const want = [];
  for (const c of list) {
    if (c.x === CONN.x && c.z === CONN.z) continue;     // the connector has its own structure
    if (!L.pole.everyOther || poleAt(c.x, c.z, set)) want.push(c);
  }
  if (want.length) {
    poleGeo = new T.CylinderGeometry(L.pole.r * 0.72, L.pole.r, L.pole.h, 5);
    poles = new T.InstancedMesh(poleGeo, MAT.pole, want.length);
    poles.castShadow = false; poles.receiveShadow = false;
    const m = new T.Matrix4();
    for (let i = 0; i < want.length; i++) {
      m.makeTranslation(wx(want[i].x), y0 + L.pole.h / 2, wz(want[i].z));
      poles.setMatrixAt(i, m);
    }
    poles.instanceMatrix.needsUpdate = true;
    poles.renderOrder = 3;
    G.add(poles);
  }

  /* ── wire ──
     One non-indexed BufferGeometry for every span in the network: two triangles
     per sub-segment, forming a narrow horizontal RIBBON at crossarm height. The
     sag is `segs` steps of a parabola — not a catenary, and at one tile per span
     the difference is under a pixel — and it is the single detail that stops a
     wire reading as a debug line.

     🚫 REJECTED: THREE.LineSegments, which is the obvious answer and is the
        wrong one twice over. node-city runs three's WEBGPU build (see its
        importmap: three.webgpu.js r171) and nothing in this project renders a
        THREE line under it, so it would be the first — and a 1-pixel line is
        close to invisible from the aerial camera this game is actually played
        from, which is the camera BAR.md judges everything by. A ribbon is
        legible at any zoom, costs the same one draw call, and uses only the
        BufferGeometry + MeshBasicMaterial construction /src/netdrag/preview.js
        already proved against this renderer.
     ⚠ NORMALS ARE NOT OPTIONAL even for MeshBasicMaterial: three's node
       materials warn "TSL.NormalNode: Vertex attribute normal not found" once
       per geometry without them. preview.js records the same finding. The
       ribbon is flat and faces up, so one constant vector does it. */
  const pos = [], nrm = [];
  const yw = y0 + L.pole.h * L.wire.hFrac;
  const hw = Math.max(0.004, L.wire.w) / 2;
  const seen = new Set();
  const quad = (ax, ay, az, bx, by, bz, px, pz) => {
    const V = [ax - px, ay, az - pz, bx - px, by, bz - pz, bx + px, by, bz + pz,
               ax - px, ay, az - pz, bx + px, by, bz + pz, ax + px, ay, az + pz];
    for (let j = 0; j < 18; j++) pos.push(V[j]);
    for (let j = 0; j < 6; j++) { nrm.push(0, 1, 0); }
  };
  for (const c of list) {
    for (const [dx, dz] of NEI) {
      const nx = c.x + dx, nz = c.z + dz, nk = K(nx, nz);
      if (!set.has(nk)) continue;
      const pair = c.k < nk ? c.k + '>' + nk : nk + '>' + c.k;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const ax = wx(c.x), az = wz(c.z), bx = wx(nx), bz = wz(nz);
      // perpendicular to the span, in the horizontal plane
      const px = -dz * hw, pz = dx * hw;
      const n = Math.max(1, L.wire.segs | 0);
      let cx = ax, cy = yw, cz = az;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const qx = ax + (bx - ax) * t, qz = az + (bz - az) * t;
        const qy = yw - L.wire.sag * 4 * t * (1 - t);
        quad(cx, cy, cz, qx, qy, qz, px, pz);
        cx = qx; cy = qy; cz = qz;
      }
    }
  }
  if (pos.length) {
    wireGeo = new T.BufferGeometry();
    wireGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    wireGeo.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    wires = new T.Mesh(wireGeo, MAT.wire);
    wires.renderOrder = 3;
    wires.castShadow = false; wires.receiveShadow = false;
    G.add(wires);
  }
}

/* ── THE CONNECTOR'S STRUCTURE ──────────────────────────────────────────────
   Built once at mount and never rebuilt: it does not move and it does not have
   states. A lattice A-frame with a crossarm, a transformer drum and a fenced
   concrete pad — the silhouette has to read from the air as "this is where the
   grid arrives", because that is the only instruction the feature gives. */
function buildConnector() {
  const g = new T.Group();
  const L = POWER.lines;
  const h = 1.55;
  const leg = new T.BoxGeometry(0.045, h, 0.045);
  for (const sx of [-0.19, 0.19]) {
    const m = new T.Mesh(leg, MAT.steel);
    m.position.set(sx, h / 2, 0);
    m.rotation.z = -sx * 0.11;
    g.add(m);
  }
  const arm = new T.Mesh(new T.BoxGeometry(0.62, 0.036, 0.05), MAT.steel);
  arm.position.set(0, h * 0.93, 0); g.add(arm);
  const arm2 = new T.Mesh(new T.BoxGeometry(0.46, 0.032, 0.045), MAT.steel);
  arm2.position.set(0, h * 0.74, 0); g.add(arm2);
  for (const ix of [-0.26, 0, 0.26]) {
    const ins = new T.Mesh(new T.CylinderGeometry(0.022, 0.026, 0.07, 6), MAT.warn);
    ins.position.set(ix, h * 0.93 + 0.05, 0); g.add(ins);
  }
  // pad + transformer drum
  const pad = new T.Mesh(new T.BoxGeometry(0.86, 0.03, 0.7), MAT.conc);
  pad.position.set(0, 0.015, 0); g.add(pad);
  const drum = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.24, 10), MAT.dark);
  drum.position.set(0.24, 0.14, 0.17); g.add(drum);
  const box = new T.Mesh(new T.BoxGeometry(0.2, 0.22, 0.16), MAT.steel);
  box.position.set(-0.25, 0.13, 0.18); g.add(box);
  g.position.set(wx(CONN.x), 0, wz(CONN.z));
  /* Face the city. The connector stands on the north-west verge and the city is
     to the south-east of it, so the crossarms are turned 45° to present their
     span to the plate rather than to the highway. */
  g.rotation.y = Math.PI * 0.25;
  return g;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE DRAG PREVIEW — /src/netdrag/preview.js, NOT a second one.
   ----------------------------------------------------------------------------
   That file is already exactly this: "one non-indexed BufferGeometry has its
   position and colour buffers rewritten in place… a path's worth of quads
   instead of one", plus the cursor chip that prints the live price, plus the
   three colour states (ok / blocked / over) and — the part that is easy to get
   wrong and expensive to debug — the constant normal buffer that stops three's
   WebGPU node materials warning on every geometry. Writing a second one would
   be a second y-stack decision, a second colour space decision and a second
   place for the price chip to disagree with the charge.
   ⚠ IT IS IMPORTED DYNAMICALLY AND GUARDED. A static import would make a 404 on
     /src/netdrag take /src/power down with it — the whole grid model, the
     enforcement latch and the save slice, for want of a ghost. Absent, the tool
     simply does not arm and says so once; the network, the connector, the save
     and the API all still work.
   ════════════════════════════════════════════════════════════════════════════ */
let PREV = null;

/* Which colour a cell of the proposed run should paint, in preview.js's own
   vocabulary. `over` (amber) is its "will be refused for a reason you can fix"
   state, which is exactly what an over-cap cell and a lift target both are. */
function stateOf(c, erase, room) {
  if (erase) return cells.has(c.k) ? 'over' : 'blocked';
  if (!inDomain(c.x, c.z) || occupied(c.x, c.z)) return 'blocked';
  if (cells.has(c.k)) return 'over';
  return room > 0 ? 'ok' : 'over';
}
function preview(run, erase, ev) {
  if (!PREV) return;
  if (!run || !run.length) { PREV.hide(); return; }
  let room = Math.max(0, pw('lines.maxCells', 900) - cells.size);
  const film = [];
  for (const c of run) {
    const st = stateOf(c, erase, room);
    if (st === 'ok') room--;
    film.push({ x: c.x, z: c.z, state: st });
  }
  PREV.show(film);
  if (erase) {
    const n = film.filter(f => f.state === 'over').length;
    PREV.label(n ? 'Take down ' + n + ' cell' + (n === 1 ? '' : 's') : 'Nothing to take down', null, ev);
    return;
  }
  const q = quote(run, false);
  const warnTxt = q.blocked.length ? q.blocked.length + ' blocked by a building'
                : q.out.length ? q.out.length + ' off the map'
                : (cells.size + q.n > pw('lines.maxCells', 900)) ? 'over the network limit'
                : (run.length > pw('lines.maxRun', 64)) ? 'too long for one drag' : null;
  PREV.label(q.n + ' cell' + (q.n === 1 ? '' : 's') + ' · ' + q.cinder + '🔥', warnTxt, ev);
}

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT
   ════════════════════════════════════════════════════════════════════════════ */
export function mount(h, hooks) {
  if (mounted) return true;
  if (!h || !h.THREE || !h.scene) return false;
  C = h; T = h.THREE;
  onChange = (hooks && hooks.onChange) || null;
  GRID = Number(h.grid) || 24; HALF = GRID / 2;
  APRON = Math.max(1, pw('lines.apron', 1) | 0);
  /* The connector's cell, RESOLVED rather than trusted. cx/cz in tuning are
     written as offsets from the north-west corner of the apron, so a grid of
     any size keeps the corner instead of keeping a stale coordinate. */
  CONN = { x: POWER.lines.connector.cx, z: POWER.lines.connector.cz };
  if (CONN.x < 0) CONN.x = -APRON;
  if (CONN.z < 0) CONN.z = -APRON;
  /* The connector is part of the conductor set and part of the signature, so a
     resolved cell that arrived after load() must invalidate both. */
  dirty();

  try {
    makeMaterials();
    G = new T.Group();
    G.name = 'mythic-power-lines';
    G.visible = false;          // gated from the first frame; syncVisible owns it hereafter
    h.scene.add(G);
    /* 🗼 THE CONNECTOR IS ITS OWN GROUP AND IS NEVER GATED — see the note at the
       head of THE MESH. It is added to the SCENE, not to `G`; the one-line
       difference is the whole reason a fresh city can be told where to draw. */
    GC = new T.Group();
    GC.name = 'mythic-power-connector';
    GC.add(buildConnector());
    h.scene.add(GC);
    rebuild();
  } catch (e) { warn('mesh mount failed: ' + (e && e.message)); }

  /* Async because the arbiter and the preview are dynamic imports. Deliberately
     NOT awaited: mount() is called from node-city's boot and the network must
     be readable by the very first economy tick whether or not the pointer rig
     has finished loading. */
  try { mountTool().catch((e) => warn('tool mount failed: ' + (e && e.message))); }
  catch (e) { warn('tool mount failed: ' + (e && e.message)); }
  mounted = true;
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   🖱 THE TOOL — a claimant on /src/netdrag/rig.js, NOT a fourth listener stack.
   ----------------------------------------------------------------------------
   node-city's canvas already has three owners (its own click-to-place,
   OrbitControls, and /src/zoning's paint tool) and the road drag made four.
   /src/zoning/ui.js's header records the MEASURED bug that comes of wiring that
   pairwise: with the Zones panel open, picking Housing off the build bar and
   clicking silently painted a zone — no house, no toast, no cue, and "the
   player blames themselves". Its fix was written 1-vs-1. rig.js turned that
   into a REGISTRY: one armed claimant city-wide, ONE set of document
   capture-phase listeners dispatching only to that claimant, and a single
   bindMode that stands everyone down when the player picks a building. A fifth
   tool therefore costs one claim() call and cannot forget an edge, which is the
   whole reason not to write the listeners again here.

   ⚠ DYNAMICALLY IMPORTED AND GUARDED, for the reason the preview above gives:
     a static import would let a 404 on /src/netdrag take the grid model, the
     enforcement latch and the save slice down with it. Absent, this warns once
     and the button explains itself; everything that is not the pointer still
     works, including API.lines.lay().
   ⚠ AND THE ARBITER IS A window SINGLETON (`window.__ncTools`) BY DESIGN —
     rig.js's own header explains why: node-city imports with a cache-busting
     `?v=` query and other modules import without one, which are two URLs and
     therefore two module instances. Reading it through rig.js's `tools()`
     accessor is what makes this the same arbiter the road tool is using.

   ⚠ THE PICKER IS ctx.cellFromEvent, NOT ctx.tileFromEvent. node-city's
     tileFromEvent ends in `inGrid(x, z) ? {x, z} : null`, so it refuses every
     cell outside the plate — including the connector's. A tool that cannot pick
     the connector cannot connect to the connector. cellFromEvent is the same
     raycast against the same mathematical y=0 plane with the apron allowed; if
     the host is older and does not have it, the tool falls back to
     tileFromEvent, which costs the player the last cell of the run rather than
     the whole feature.
   ════════════════════════════════════════════════════════════════════════════ */
let armed = false, drag = null, erasing = false, ctrlWas = null, busy = false;
let barBtn = null, hint = null;
let TOOLS = null, TOK = null;

function pick(ev) {
  try {
    if (typeof C.cellFromEvent === 'function') return C.cellFromEvent(ev, APRON);
    if (typeof C.tileFromEvent === 'function') return C.tileFromEvent(ev);
  } catch (e) {}
  return null;
}

function hot(ev) {
  const canvas = C && C.canvas;
  if (!armed || !canvas || ev.target !== canvas) return false;
  /* 🛟 THE BELT TO THE RIG'S BRACES. rig.js only dispatches to the armed
     claimant, and bindMode stands every claimant down when the player picks a
     building — but against a host with no mode hook that half cannot fire, and
     a build click silently laying cable is precisely the bug /src/zoning's
     header records. Then the build click wins, which is the right way round:
     the player who just picked a building is holding it. */
  try { if (typeof C.mode === 'function' && C.mode() === 'place') return false; } catch (e) {}
  return true;
}
function holdControls() {
  if (ctrlWas === null && C && C.controls) { ctrlWas = C.controls.enabled; C.controls.enabled = false; }
}
function releaseControls() {
  if (ctrlWas !== null && C && C.controls) { C.controls.enabled = ctrlWas; }
  ctrlWas = null;
}

export function setArmed(v) {
  const was = armed;
  const want = !!v;
  /* 🖱 THE SEAT IS THE ARBITER'S TO GIVE. arm() broadcasts a stand-down to every
     other claimant before it returns, and it REFUSES while a broadcast is in
     flight — arming from inside another tool's stand-down is how two tools end
     up handing the pointer to each other forever. So the local flag is only set
     if the arbiter actually granted the seat. */
  if (want && TOK) { if (!TOK.arm()) return armed; }
  if (!want && TOK) TOK.disarm();
  armed = want;
  if (armed && C && C.setMode) {
    let held = false;
    try { held = typeof C.mode === 'function' && C.mode() === 'place'; } catch (e) {}
    try { C.setMode('inspect'); } catch (e) {}
    if (held && !was) say('🗼 Power line tool armed — the building you were holding was put back. Press Esc, or pick a building again, to build.', 'good');
  }
  if (!armed) { drag = null; preview(null, false); releaseControls(); }
  /* 👁 The cable follows the tool. This is the ONE line that makes "wires appear
     when you go to look at them" true, and it has to run on BOTH edges — arming
     shows the run the player is about to extend, disarming puts it away. */
  syncVisible();
  paintBtn();
  return armed;
}
export function isArmed() { return armed; }

/* What the arbiter calls when somebody else takes the pointer. rig.js is
   emphatic that a stand-down MUST end in something the player can see — "a
   silent stand-down is the bug, not the fix" — so this closes the hint, clears
   the button and names whoever took it. */
function standDown(reason) {
  if (!armed && !drag) return;
  armed = false; drag = null;
  preview(null, false); releaseControls(); syncVisible(); paintBtn();
  const who = reason && (reason.name || reason.label);
  /* 👁 …and the toast SAYS the cable went, because it did. rig.js's rule is that
     a stand-down ends in something the player can see; now that standing down
     also hides a layer, a stand-down that did not name that would be the player
     watching their network vanish and blaming the build. */
  const hidden = cells.size > 0 && !layerOn;
  say('🗼 Power lines put away' + (who ? ' — you picked ' + who : '') + '. Click 🗼 Lines to draw cable again' +
      /* ⚠ PLAIN TEXT. node-city's toast() assigns textContent, so markup here
         would be printed at the player as literal angle brackets. */
      (hidden ? ' — your cable is still there; switch on “Power Line Poles & Wires” in the ⚡ panel to keep it in view.' : '.'), 'good');
}

function say(msg, kind) { try { if (C && C.toast) C.toast(msg, kind || 'good'); } catch (e) {} }

function onDown(ev) {
  if (busy || !hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
  const c = pick(ev);
  if (!c) return;
  ev.preventDefault(); ev.stopPropagation();
  erasing = ev.button === 2;
  drag = { x0: c.x, z0: c.z, x1: c.x, z1: c.z, swap: !!ev.shiftKey };
  holdControls();
  preview(runCells(c.x, c.z, c.x, c.z, drag.swap), erasing, ev);
}
function onMove(ev) {
  if (!hot(ev)) return;
  const c = pick(ev);
  if (!drag) { if (c) preview(runCells(c.x, c.z, c.x, c.z, false), false, ev); return; }
  ev.preventDefault(); ev.stopPropagation();
  if (c) { drag.x1 = c.x; drag.z1 = c.z; }
  drag.swap = !!ev.shiftKey;
  preview(runCells(drag.x0, drag.z0, drag.x1, drag.z1, drag.swap), erasing, ev);
}
async function onUp(ev) {
  if (!drag) { if (hot(ev)) preview(null, false); return; }
  const d = drag; drag = null;
  releaseControls();
  if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); }
  preview(null, false);
  /* A single click on a cell that already carries a line is a no-op, and it is
     SILENT. It is the commonest accidental gesture with a paint-style tool —
     the player taps the run they just drew — and answering it with a refusal
     toast would burn one of the three toast slots to say nothing. */
  if (d.x0 === d.x1 && d.z0 === d.z1 && !erasing && cells.has(K(d.x0, d.z0))) return;
  const run = runCells(d.x0, d.z0, d.x1, d.z1, d.swap);
  if (erasing) {
    const r = lift(run);
    if (r.n) say('🧽 Took down ' + r.n + ' cell' + (r.n === 1 ? '' : 's') + ' of power line.', 'good');
    return;
  }
  /* ⚠ ONE AWAIT, AND A LOCK ACROSS IT. payCost is an awaited round trip over
     the iframe bridge; a second drag started mid-flight would quote against a
     wallet the first drag had not been charged from yet. node-city's own
     `_placing` lock exists for exactly this and this is the same lock. */
  busy = true; paintBtn();
  let r;
  try { r = await lay(run); } finally { busy = false; paintBtn(); }
  if (!r) return;
  if (!r.ok) { if (r.why) say('🗼 ' + r.why, 'bad'); return; }
  /* ONE LINE FOR THE WHOLE DRAG — the toast rail holds three, so a run that
     refused cells must account for them here or not at all. */
  let m = '🗼 Laid ' + r.n + ' cell' + (r.n === 1 ? '' : 's') + ' of power line for ' + r.cinder + '🔥';
  if (r.blocked) m += ' — ' + r.blocked + ' went round a building';
  if (r.out) m += (r.blocked ? ' and ' : ' — ') + r.out + ' fell off the map';
  say(m + '.', 'good');
}
function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
function onKey(ev) {
  if (!armed) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (ev.key === 'Escape') { setArmed(false); say('🗼 Power line tool put away.', 'good'); }
}

/* The build-bar button lives HERE rather than in node-city, so the whole
   feature is one import: if this module 404s there is no dead button pointing
   at nothing. Same argument /src/zoning/ui.js makes for its own. */
async function mountTool() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.body) return;

  if (!doc.getElementById('npl-style')) {
    const st = doc.createElement('style');
    st.id = 'npl-style';
    st.textContent =
      '#npl-btn{border:1px solid var(--edge,rgba(212,175,55,.3));background:#120e1c;color:var(--bone,#e9e0cc);' +
      'border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px}' +
      '#npl-btn:hover{border-color:var(--gold,#d4af37)}' +
      '#npl-btn.on{border-color:#ff7a2f;box-shadow:0 0 10px rgba(255,122,47,.28);color:#ffd08a}' +
      '#npl-btn[disabled]{opacity:.5;cursor:progress}' +
      '#npl-hint{position:absolute;left:50%;transform:translateX(-50%);bottom:150px;z-index:6;display:none;' +
      'background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));' +
      'border-radius:10px;padding:6px 11px;color:var(--bone,#e9e0cc);font-size:11.5px;line-height:1.45;' +
      'max-width:min(640px,calc(100% - 24px));box-shadow:0 14px 34px rgba(0,0,0,.55)}' +
      '#npl-hint.on{display:block}#npl-hint b{color:var(--gold,#d4af37)}';
    doc.head.appendChild(st);
  }

  hint = doc.createElement('div');
  hint.id = 'npl-hint';
  hint.innerHTML = '<b>🗼 POWER LINES</b> — drag to draw a run (it turns one corner; hold Shift to turn it the other way). ' +
    'Right-drag takes a line down. The <b>Grid Connector</b> stands on the north-west verge by the highway — ' +
    'run a line to it and the buildings you reach are on the grid. Esc puts the tool away.';
  doc.body.appendChild(hint);

  const bar = doc.getElementById('buildbar');
  if (bar) {
    barBtn = doc.createElement('button');
    barBtn.id = 'npl-btn'; barBtn.type = 'button';
    barBtn.title = 'Draw power lines to the Grid Connector';
    barBtn.textContent = '🗼 Lines';
    barBtn.addEventListener('click', () => setArmed(!armed));
    bar.appendChild(barBtn);
  }

  paintBtn();

  /* ── the shared arbiter and the shared run preview ─────────────────────── */
  try {
    const rig = await import('../netdrag/rig.js');
    TOOLS = (rig && typeof rig.tools === 'function') ? rig.tools() : null;
  } catch (e) { TOOLS = null; }
  if (!TOOLS) {
    /* 🔴 NO SECOND LISTENER STACK AS A FALLBACK, DELIBERATELY. Installing our
       own document-capture listeners "just in case" is exactly the shape rig.js
       exists to stop: two dispatchers, each convinced it holds the only armed
       tool, and a build click that silently lays cable. A missing arbiter costs
       the DRAG and nothing else — the network, the connector, the enforcement
       latch, the save slice and API.lines.lay() all still work — and the button
       says so instead of doing nothing when pressed. */
    warn('/src/netdrag/rig.js is absent, so the power-line drag cannot arm without becoming a second pointer owner. Everything else in /src/power is unaffected.');
    if (barBtn) {
      barBtn.disabled = true;
      barBtn.title = 'The shared map-pointer tool is not loaded, so lines cannot be drawn by hand right now.';
    }
    return;
  }
  try {
    const pv = await import('../netdrag/preview.js');
    if (pv && typeof pv.makeRunPreview === 'function' && T && C.scene) {
      PREV = pv.makeRunPreview({ THREE: T, scene: C.scene, HALF });
    }
  } catch (e) { PREV = null; }

  TOK = TOOLS.claim('power-lines', { label: '🗼 Power lines', standDown });
  TOK.on({ down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey,
           /* `cancel` is the mid-gesture case: the arbiter hands the seat away
              while a drag is in flight. Releasing OrbitControls here is not
              cosmetic — a tool that stands down holding `controls.enabled =
              false` kills the camera for the rest of the session.
              👁 syncVisible() rides along so that EVERY exit from a gesture
              leaves the group agreeing with the flags. rig.js calls cancel()
              before standDown(), so `armed` is usually still true here and this
              call is a no-op — but it is the only exit that does not go through
              setArmed/standDown, and "the one path that forgot" is exactly how
              the camera bug this handler exists for got written in the first
              place. Idempotent: it is a boolean and one compare. */
           cancel: () => { drag = null; preview(null, false); releaseControls(); syncVisible(); } });
  /* Registered ONCE by whichever module gets there first; a second call is a
     no-op that returns true, so neither this file nor /src/netdrag has to know
     which of them mounted earlier. */
  try { TOOLS.bindMode(C.onMode, C.BUILDINGS); } catch (e) {}
}

function paintBtn() {
  if (barBtn) { barBtn.classList.toggle('on', armed); barBtn.disabled = !!busy; }
  if (hint) hint.classList.toggle('on', armed);
}

/* 🔍 A self-check, reported by index.js ONLY when it fails. Two things can go
   wrong silently here and both look fine in a diff: a connector resolved off
   its own domain (unreachable, and the feature's one instruction becomes a
   lie), and a connector cell that is not in the conductor set (the walk would
   seed from a cell it cannot traverse, and every fresh city would read
   "unserved" with no explanation). */
export function verify() {
  const v = [];
  if (!inDomain(CONN.x, CONN.z)) v.push('connector cell ' + K(CONN.x, CONN.z) + ' is outside the line domain');
  if (onPlate(CONN.x, CONN.z)) v.push('connector cell ' + K(CONN.x, CONN.z) + ' sits ON the buildable plate; it must stand on the verge');
  if (!conductors().has(K(CONN.x, CONN.z))) v.push('connector cell is not a conductor');
  if (!(pw('lines.costPerCell', 0) > 0)) v.push('lines.costPerCell is not a positive price');
  /* 👁 THE GATE'S OWN INVARIANT. Moving one `add()` call would put the Grid
     Connector back inside the gated group, and every other check in this file —
     and both syntax gates — would still pass while a fresh city lost the only
     landmark the feature's instruction refers to. So it is asserted, not
     assumed: the connector's group must be parented to the SCENE. */
  if (GC && G && GC.parent === G) v.push('the Grid Connector is parented to the gated cable group; it must be added to the scene so it is never hidden');
  if (G && GC && G.visible !== (armed || (layerOn && cells.size > 0))) v.push('cable group visibility disagrees with the gate (armed=' + armed + ', layer=' + layerOn + ', cells=' + cells.size + ')');
  return { ok: !v.length, violations: v, connector: K(CONN.x, CONN.z), cells: cells.size,
           gate: { armed, layerOn, visible: !!(G && G.visible), connectorGated: !!(GC && G && GC.parent === G) } };
}
