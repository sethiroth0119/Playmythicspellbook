/* ══ 🅿 KERBSIDE PARKING ═══════════════════════════════════════════════════
   A CS2 street is never only moving traffic. The bar's night frame counts a
   queue of twelve cars AND the ones standing at the kerb; ours had neither,
   and the whole-frame critic scored vehicles 0/10 twice running.

   Moving traffic is capped for a reason — AGENTS.carMax / truckMax / policeMax
   are a measured frame-rate decision and this module does not touch them. What
   it adds is the half of a street's vehicle population that does not move, and
   therefore costs no tick, no pathing and no BFS: a parking bay cut into the
   footway of a road tile whose plot side actually has a building on it, with
   one standing vehicle in it.

   ── 🔴 THE GLOBALS TRAP ────────────────────────────────────────────────────
   `game`, `scene`, `THREE`, `MAT`, `makeVehicle`, `limitShadowCasters` and
   `HALF` are all top-level `const` in node-city/index.html. They are lexical
   globals and are NOT on `window`, so nothing below may reach for them. The
   ctx object mount() takes IS the hand-over, exactly as /src/streets does it.

   ── WHERE A BAY MAY STAND, AND WHY IT IS THE ONE FREE SLOT ─────────────────
   The road recipe's cross-section (r1_road.js) is fixed and known:

       0.000 … 0.200   carriageway   (RD_HW — two 0.20 lanes, and a vehicle is
                                      0.16 wide, so there is NO room to park on
                                      it; that was the first design and it put
                                      parked cars through moving ones)
       0.200 … 0.245   kerb band     (RD_IN)
       0.245 … 0.325   verge         (RD_VG, straight runs only)
       0.325 … 0.500   footway

   So a bay has to be cut from the verge+footway band, 0.245…0.500, which is
   0.255 wide against a vehicle's 0.19 — it fits, parallel to the road.

   ⚠ AND IT MAY ONLY BE CUT ON THE +LATERAL SIDE, CENTRED ON THE TILE. That is
     not a style choice, it is the ONLY slot on the tile that no prop can ever
     occupy, and each of the four was checked against the recipe:
       · the LAMP stands at tile-local (+.36, +.36) on every road tile, with a
         .095 base plate reaching .3125….4075 ALONG the road. A bay is ±.24
         along, so it stops .07 short of it. The cranked arm reaches inboard at
         y .546, five times the height of a car roof.
       · the BUS SHELTER is always at lateral −.42 — the far side.
       · the three SMALL-PROP corners are (+.40,−.40), (−.40,−.40), (−.40,+.40).
         Every one of them is ±.40 ALONG, outside the bay's ±.24.
       · the JUNCTION SIGN owns (−.40,+.40), also outside ±.24.
     Move the bay off the tile centre, or onto the −lateral side, and it starts
     eating street furniture. Do not.

   ── COST ──────────────────────────────────────────────────────────────────
   The bays themselves are ONE mesh for the whole city: every slab and bay line
   is a flat quad written straight into one vertex-coloured buffer, the same
   trick the road and housing recipes use. So the only per-vehicle cost is the
   vehicle, which makeVehicle already merges to 4 meshes and 0 materials.

   ⚠ THE SHADOW-CASTER CAP IS RE-APPLIED. limitShadowCasters(g, 3) on every
     parked vehicle, matching agentMesh() exactly — that cap is a measured
     frame-rate decision (a vehicle's 21 meshes were all being drawn into the
     shadow map) and a second fleet that ignored it would undo the measurement.
   ══════════════════════════════════════════════════════════════════════════ */

/* 🛣 The road resolver — same reason as /src/crowd: this file re-derives the
   N/S/E/W mask, and a bay cut into a tile the host does not think is road is a
   parked car in somebody's garden. */
import { isRoadTile } from '../roads/types.js';

const MAX_PARKED = 44;      // ceiling on the standing fleet, ~176 meshes
const BAY_LAT    = 0.355;   // bay centre, lateral — spans .26….45
const BAY_HALF   = 0.300;   // bay half-length along the road
const CAR_SCALE  = 1.2;     // identical to agentMesh(), or parked and moving
                            // vehicles read as two different scales of city

let CTX = null, group = null, sig = '', parked = [], bayMesh = null;

/* Tile-seeded xorshift32, the same shape r1_road.js uses: a bay's vehicle must
   be a property of the TILE, not of the moment the layer happened to rebuild,
   or every placement anywhere in the city would reshuffle every parked car. */
function rngOf(x, z) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ 0x9e3779b9) >>> 0;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/* ── the bay surface ────────────────────────────────────────────────────────
   One flat quad per piece, pushed into shared arrays. Non-indexed and
   vertex-coloured so the asphalt and the white bay lines share one buffer and
   one material. Y is stacked, not coincident: the road recipe already owns
   RD_PT for the footway, so the slab clears it by 1.5mm and the paint clears
   the slab by another 1.5mm. Two coplanar slabs here would z-fight the length
   of every street, which is the bug that pinned the road's own four heights. */
function quad(P, C, U, cx, cz, ax, az, hl, hw, y, col) {
  const lx = -az, lz = ax;                       // lateral unit = along rotated 90°
  const ex = ax * hl, ez = az * hl, fx = lx * hw, fz = lz * hw;
  const p = [[cx - ex - fx, cz - ez - fz], [cx + ex - fx, cz + ez - fz],
             [cx + ex + fx, cz + ez + fz], [cx - ex + fx, cz - ez + fz]];
  const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
  /* ⚠ WINDING IS [0,2,1 / 0,3,2] AND THAT IS NOT A STYLE CHOICE. The first cut
     used the intuitive [0,1,2 / 0,2,3]; in the XZ plane that is clockwise seen
     from +Y, so every bay faced DOWNWARDS, was back-face culled by the default
     FrontSide material, and computeVertexNormals gave it a −Y normal into the
     bargain. Twenty parked cars rendered correctly on twenty invisible bays and
     read as cars standing on the pavement. Reverse this and they vanish again.
     ⚠ UVs ARE REQUIRED, not optional: the material carries MAT.road's asphalt
     map, and a mapped material with no `uv` attribute samples garbage. World
     x/z is the right source — it makes the bay's grain continuous with the
     carriageway it opens off instead of restarting per bay. */
  for (const i of [0, 2, 1, 0, 3, 2]) {
    P.push(p[i][0], y, p[i][1]); C.push(r, g, b); U.push(p[i][0], p[i][1]);
  }
}

/* Which road tiles get a bay. Straight runs only — a junction tile's corners
   are where the sign and the crossings live, and its lateral neighbours are
   roads rather than plots — and only where the +lateral neighbour is a real
   building, so a bay always serves a frontage instead of standing in a field. */
function bayTiles() {
  const { game, isRoad, isPlot } = CTX;
  const out = [];
  for (const k in game.tiles) {
    if (!isRoadTile(game.tiles[k])) continue;
    const [x, z] = k.split(',').map(Number);
    const N = isRoad(x, z - 1), S = isRoad(x, z + 1), E = isRoad(x + 1, z), W = isRoad(x - 1, z);
    const cnt = (N ? 1 : 0) + (S ? 1 : 0) + (E ? 1 : 0) + (W ? 1 : 0);
    let ax = 0, az = 0;
    if (cnt === 2 && E && W) { ax = 1; az = 0; }
    else if (cnt === 2 && N && S) { ax = 0; az = 1; }
    else continue;
    // the plot the bay serves is the one on the +lateral side (see the header)
    const px = x + (ax ? 0 : 1), pz = z + (ax ? 1 : 0);
    if (!isPlot(game.tiles[px + ',' + pz])) continue;
    const R = rngOf(x, z);
    /* 6 frontages in 7. It was 2 in 3 and that measured at 20 standing
       vehicles across a 100-tile network — enough to prove the layer worked and
       not enough for the frame the bar asks for, where a street is lined with
       parked cars rather than sprinkled with them. The roll stays, because a
       kerb with a gap in it reads as a street and a solid unbroken rank reads
       as a car park. */
    if (R() > 0.86) continue;
    out.push({ x, z, ax, az, R });
  }
  return out;
}

function clear() {
  const { disposeOwnedGeo } = CTX;
  for (const g of parked) {
    group.remove(g);
    try { const d = g.userData && g.userData.disposeGeo; if (d) d(); } catch (e) {}
    try { disposeOwnedGeo(g); } catch (e) {}
  }
  parked = [];
  if (bayMesh) { group.remove(bayMesh); bayMesh.geometry.dispose(); bayMesh = null; }
}

function build() {
  const { THREE, HALF, RD_PT, makeVehicle, limitShadowCasters, bayMat } = CTX;
  clear();
  const P = [], C = [], U = [];
  let n = 0;
  for (const t of bayTiles()) {
    if (n >= MAX_PARKED) break;
    const wx = t.x - HALF + .5, wz = t.z - HALF + .5;
    const cx = wx + (t.ax ? 0 : BAY_LAT) * 1, cz = wz + (t.ax ? BAY_LAT : 0);
    /* lateral unit is (−az, ax); for an east-west tile that is (0,1) → +z, for
       a north-south tile (−1,0) → −x. The bay must sit on the SAME side the
       plot test above picked, so the centre is offset by hand rather than by
       the lateral unit, whose sign flips between the two orientations. */
    const y0 = RD_PT + .0015, y1 = RD_PT + .0030;
    quad(P, C, U, cx, cz, t.ax, t.az, BAY_HALF, .110, y0, 0x565350);      // hard standing
    for (const s of [-1, 1])                                              // bay end lines
      quad(P, C, U, cx + t.ax * s * BAY_HALF, cz + t.az * s * BAY_HALF, t.ax, t.az, .008, .105, y1, 0xd8d3c4);
    n++;
    const g = makeVehicle('parked', null, (t.x * 73856093) ^ (t.z * 19349663));
    g.scale.setScalar(CAR_SCALE);
    limitShadowCasters(g, 3);
    g.position.set(cx, RD_PT + .002, cz);
    // vehicles are authored pointing along +X; the agent tick uses the same
    // −90° term, so a parked car and a moving one are oriented identically.
    g.rotation.y = Math.atan2(t.ax, t.az) - Math.PI / 2 + (t.R() < .5 ? Math.PI : 0);
    group.add(g); parked.push(g);
  }
  if (P.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
    geo.computeVertexNormals();
    bayMesh = new THREE.Mesh(geo, bayMat);
    bayMesh.castShadow = false; bayMesh.receiveShadow = true;   // flat: casts nothing
    group.add(bayMesh);
  }
  return n;
}

/* Cheap enough to call from manageAgents(), which every city-change path
   already runs through — but only if the road/plot layout actually moved. */
function signature() {
  const { game } = CTX;
  let h = 0, n = 0;
  /* ⚠ THE TYPE IS IN THE HASH, not just the road keys. The first cut hashed
     road keys and counted everything else, so demolishing a house and building
     a shop on the same tile produced an identical signature — and a bay serves
     a FRONTAGE, so the layer would have kept a rank of cars outside a plot that
     no longer had a building on it. One pass over game.tiles either way. */
  for (const k in game.tiles) {
    const ty = game.tiles[k].type; n++;
    for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
    for (let i = 0; i < ty.length; i++) h = (Math.imul(h, 33) + ty.charCodeAt(i)) | 0;
  }
  return h + ':' + n;
}

export function mount(ctx) {
  CTX = ctx;
  const { THREE, scene } = ctx;
  group = new THREE.Group(); group.name = 'parking'; scene.add(group);
  const api = {
    refresh() {
      const s = signature();
      if (s === sig) return parked.length;
      sig = s;
      return build();
    },
    count: () => parked.length,
    // for a driver: the world positions, so a test can assert they are on road
    // tiles without reading the scene graph.
    /* ⚠ `rot` IS ADDITIVE AND WAS ADDED FOR /src/contact. A parked car's
       contact patch is an ELLIPSE lying along the car, and the yaw that puts it
       there is set six lines above from the tile's own axis and its seeded
       flip. Re-deriving it in the reader would be a second copy of that roll —
       the thing this file's header warns about — and the failure mode is a
       shadow lying across a car instead of under it. */
    spots: () => parked.map(g => ({ x: +g.position.x.toFixed(3), z: +g.position.z.toFixed(3),
                                    rot: +g.rotation.y.toFixed(4),
                                    cls: g.userData.vclass || null })),
    group: () => group,
  };
  api.refresh();
  return api;
}
