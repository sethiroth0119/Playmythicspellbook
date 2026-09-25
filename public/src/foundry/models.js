/* ════════════════════════════════════════════════════════════════════════════
   🏗 THE FOUNDRY — floor layout, machine models, and the admin override.
   ----------------------------------------------------------------------------
   Two things live here: WHERE each machine stands on the floor, and WHAT it
   looks like when it gets there.

   🔴 EVERY MACHINE HAS PROCEDURAL GEOMETRY AND ALWAYS WILL.
   The walkable card shop set this rule and it is the right one — its comment
   reads: "Missing/failed models fall back to the built-in procedural geometry,
   so the shop never breaks while you swap assets in one at a time." An admin
   uploading a bad .glb, a Supabase outage, a slow phone that times out: none of
   those may produce an empty room the player cannot navigate. So `build()` below
   never returns null, and the .glb is an UPGRADE over a shape that already
   works, never a dependency.

   🔴 THREE IS PASSED IN, NEVER IMPORTED. `window.THREE` is the r128 global build
   the card shop lazy-loads (`_csLoadThree`). This module takes `T` as an
   argument so it has no opinion about how Three got there and can be unit-tested
   with a stub. It also means nothing here breaks if the app later moves to the
   module build in the importmap.

   ⚠ SCALE IS IN METRES AND THE PLAYER IS 1.6 m TALL. The camera eye sits at
   y=1.6 (same as the card shop). A machine modelled at 8 units tall is a
   four-storey building the player cannot see the top of. Keep procedural pieces
   between 1.5 m and 4 m, and give admin models a `scale` they can tune.
   ════════════════════════════════════════════════════════════════════════════ */

import { MACHINES, machineById } from './machines.js';

/* 🗺 THE FLOOR. A 44 × 30 m shed, origin at the middle, player spawns at the
   south door looking north (−z is forward, matching the card shop's camera).

   Laid out so the CHAIN READS AS A WALK: the crush line runs left-to-right down
   the west aisle in process order (shred → sort → crush → smelt → convert →
   roll), and the refinery runs down the east aisle. A player who follows their
   own material sees it get more refined at every stop, which is a thing a list
   of cards can never do. Do not "tidy" these into a grid — the order is the
   teaching.

   `ry` faces each machine's working side toward the aisle the player walks. */
export const FLOOR = { w: 44, d: 30 };
export const SPAWN = { x: 0, z: 12.5, yaw: 0 };

export const LAYOUT = {
  // ── West aisle: the crush line, in process order walking north ──────────
  shredder:   { x: -14, z:  8, ry:  Math.PI / 2 },
  sorter:     { x: -14, z:  3, ry:  Math.PI / 2 },
  baler:      { x: -14, z: -2, ry:  Math.PI / 2 },
  recycler:   { x: -19, z: -2, ry:  Math.PI / 2 },
  ewaste:     { x: -19, z:  3, ry:  Math.PI / 2 },
  furnace:    { x: -14, z: -7, ry:  Math.PI / 2 },
  converter:  { x:  -9, z: -10, ry: 0 },
  mill:       { x:  -3, z: -10, ry: 0 },
  // End of the metal road, next to the Mill it shares a feedstock with.
  caster:     { x:   3, z: -10, ry: 0 },
  // ── East aisle: the refinery ────────────────────────────────────────────
  still:      { x:  14, z:  3, ry: -Math.PI / 2 },
  cracker:    { x:  14, z: -2, ry: -Math.PI / 2 },
  digester:   { x:  19, z:  3, ry: -Math.PI / 2 },
  blender:    { x:  14, z:  8, ry: -Math.PI / 2 },
  // ── Utilities, central so both lines read as feeding off them ───────────
  powerhouse: { x:   9, z: -10, ry: 0 },
  /* The stockpile is the centrepiece of the shed, not the doormat. At z=6 it
     stood 6.5 m from the spawn point and filled the entire entrance view, so the
     first thing a new player saw was a wall of crates with the factory hidden
     behind it. At the origin it reads as the central island the two aisles run
     either side of — which is also what it is. */
  yard:       { x:   0, z:  0, ry: Math.PI },
};

/* 🏢 FIXED STATIONS — the desks, not the machines. These are always present and
   are not built or upgraded; they are how the player buys, sells and reads the
   line. Kept separate from LAYOUT because a station has no condition, no recipe
   and no build cost, and folding them into MACHINES would put a "…but is it a
   desk?" branch in every machine read site. */
export const STATIONS = [
  { id: 'supply',  label: 'Supply Office', panel: 'supply', emoji: '📦', color: 0xd4af37, x: -6, z: 10, ry: 0,        r: 1.8, ir: 3.2 },
  { id: 'weigh',   label: 'Weighbridge',   panel: 'taps',   emoji: '💰', color: 0x7fd6a0, x:  6, z: 10, ry: 0,        r: 1.8, ir: 3.2 },
  { id: 'control', label: 'Control Room',  panel: 'control',emoji: '🎛️', color: 0x5aa9e6, x:  0, z: -14, ry: Math.PI, r: 2.2, ir: 3.6 },
];

/* 🎨 Admin overrides. Shape stored on Forge.foundry.models:
     { shredder: { url, scale, ry, y, clip }, … }
   Only `url` is required; the rest are per-model trims an admin trues up once
   after uploading, exactly like the shop editor's scale / rotation_y fields. */
export function overrideFor(forge, id) {
  try {
    const m = forge && forge.models && forge.models[id];
    if (!m || typeof m !== 'object' || !m.url) return null;
    return {
      url: String(m.url),
      scale: (+m.scale > 0 ? +m.scale : 1),
      ry: (typeof m.ry === 'number' ? m.ry : null),
      y: (typeof m.y === 'number' ? m.y : 0),
      clip: (m.clip === undefined ? null : m.clip),
    };
  } catch (e) { return null; }
}

/* ── Procedural builders ─────────────────────────────────────────────────────
   Each returns { group, glow } — `glow` is the mesh whose emissive colour the
   world drives from machine state, so a running furnace is visibly hot and a
   broken one is visibly dead FROM ACROSS THE FLOOR. That readability is the
   whole reason a 3D floor beats a list of cards; a room full of identical grey
   boxes would be strictly worse than the 2D panel it replaced. */

/* 🔴 HEX LITERALS IN THIS FILE ARE sRGB AND MUST BE CONVERTED TO LINEAR.
   r128 predates THREE.ColorManagement (r152), so `color: 0x2b3038` is fed to the
   shader as if it were already linear. With the renderer's sRGB output encoding
   on top, the pipeline gamma-corrects a value that was never linearised — and
   every dark material comes out washed. That is why a 0x1a1d23 floor and a
   0x2b3038 conveyor were both rendering as pale tan no matter how far the lights
   came down: it was never a lighting problem.
   Converting once, here, means every colour below can stay a normal sRGB hex
   picked from the 2D palette and actually look like it. Guarded, so the helper
   still works on a build without convertSRGBToLinear. */
export function srgb(T, hex) {
  const c = new T.Color(hex);
  try { if (c.convertSRGBToLinear) c.convertSRGBToLinear(); } catch (e) {}
  return c;
}
const mat = (T, hex, opts) => {
  const o = Object.assign({ roughness: 0.72, metalness: 0.35 }, opts || {});
  o.color = srgb(T, hex);
  if (o.emissive !== undefined) o.emissive = srgb(T, o.emissive);
  return new T.MeshStandardMaterial(o);
};
const box = (T, w, h, d, hex, opts) => new T.Mesh(new T.BoxGeometry(w, h, d), mat(T, hex, opts));
const cyl = (T, rt, rb, h, hex, seg, opts) => new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), mat(T, hex, opts));

/* The shared plinth every machine stands on. Gives the floor a rhythm and,
   more usefully, makes the interact radius legible as a thing you step onto. */
function plinth(T, w, d, hex) {
  const p = box(T, w, 0.18, d, 0x23262c, { roughness: 0.95, metalness: 0.1 });
  p.position.y = 0.09;
  const trim = box(T, w * 1.02, 0.05, d * 1.02, 0x191d23, { emissive: hex, emissiveIntensity: 0.35 });
  trim.position.y = 0.2;
  const g = new T.Group(); g.add(p); g.add(trim);
  return g;
}

const BUILDERS = {
  shredder(T, c) {
    const g = new T.Group();
    const body = box(T, 2.6, 2.0, 2.0, 0x3a4048); body.position.y = 1.1; g.add(body);
    const hopper = new T.Mesh(new T.CylinderGeometry(1.5, 0.7, 1.1, 4), mat(T, 0x4a515a));
    hopper.position.y = 2.5; hopper.rotation.y = Math.PI / 4; g.add(hopper);
    const drum = cyl(T, 0.55, 0.55, 2.4, 0x605c53, 14); drum.rotation.z = Math.PI / 2; drum.position.set(0, 1.1, 1.05); g.add(drum);
    const glow = box(T, 2.2, 0.16, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.5, 1.02); g.add(glow);
    g.userData.spin = drum; return { group: g, glow };
  },
  sorter(T, c) {
    const g = new T.Group();
    const belt = box(T, 5.2, 0.22, 1.3, 0x2b3038); belt.position.y = 1.0; g.add(belt);
    for (const x of [-2.4, 2.4]) { const leg = box(T, 0.18, 1.0, 1.1, 0x40464f); leg.position.set(x, 0.5, 0); g.add(leg); }
    const magnet = cyl(T, 0.62, 0.62, 1.5, 0x6d7f9c, 18); magnet.rotation.x = Math.PI / 2; magnet.position.set(1.9, 1.55, 0); g.add(magnet);
    const arch = box(T, 0.2, 1.5, 0.2, 0x40464f); arch.position.set(1.9, 1.0, 0.8); g.add(arch);
    const glow = box(T, 4.8, 0.1, 0.9, c, { emissive: c, emissiveIntensity: 0.9 }); glow.position.set(0, 1.13, 0); g.add(glow);
    g.userData.spin = magnet; return { group: g, glow };
  },
  baler(T, c) {
    const g = new T.Group();
    const frame = box(T, 2.4, 2.6, 2.4, 0x4a3a34); frame.position.y = 1.4; g.add(frame);
    const ram = box(T, 1.6, 0.5, 1.6, 0x6b5248); ram.position.y = 2.9; g.add(ram);
    const rod = cyl(T, 0.16, 0.16, 1.2, 0x7d776d, 10); rod.position.y = 3.5; g.add(rod);
    const bale = box(T, 1.0, 0.8, 1.0, 0x9fb4c6); bale.position.set(1.7, 0.5, 0); g.add(bale);
    const glow = box(T, 2.0, 0.14, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.65, 1.22); g.add(glow);
    g.userData.piston = ram; return { group: g, glow };
  },
  furnace(T, c) {
    const g = new T.Group();
    const stack = cyl(T, 1.15, 1.5, 3.4, 0x5a4038, 18); stack.position.y = 1.9; g.add(stack);
    const cap = cyl(T, 0.55, 1.1, 0.7, 0x3f2e28, 18); cap.position.y = 3.9; g.add(cap);
    const mouth = cyl(T, 0.72, 0.72, 0.3, 0xff7a3a, 18, { emissive: 0xff5a1a, emissiveIntensity: 1.6 });
    mouth.position.y = 4.2; g.add(mouth);
    const glow = cyl(T, 1.18, 1.18, 0.5, c, { emissive: c, emissiveIntensity: 1.4 }); glow.position.y = 0.75; g.add(glow);
    g.userData.flare = mouth; return { group: g, glow };
  },
  converter(T, c) {
    const g = new T.Group();
    const vessel = cyl(T, 0.85, 1.35, 2.6, 0x6b4a3c, 18); vessel.position.y = 1.7; vessel.rotation.z = 0.22; g.add(vessel);
    const ring = cyl(T, 1.45, 1.45, 0.28, 0x5f5c54, 20); ring.position.y = 1.6; g.add(ring);
    for (const s of [-1, 1]) { const p = box(T, 0.26, 2.4, 0.26, 0x3f454e); p.position.set(s * 1.6, 1.2, 0); g.add(p); }
    const glow = box(T, 2.8, 0.14, 0.12, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.55, 1.0); g.add(glow);
    g.userData.tilt = vessel; return { group: g, glow };
  },
  mill(T, c) {
    const g = new T.Group();
    const bed = box(T, 4.4, 0.8, 1.8, 0x363c45); bed.position.y = 0.6; g.add(bed);
    for (const x of [-1.1, 0.4]) { const r = cyl(T, 0.5, 0.5, 1.7, 0x77869c, 16); r.rotation.x = Math.PI / 2; r.position.set(x, 1.25, 0); g.add(r); g.userData.spin = r; }
    const sheet = box(T, 2.6, 0.05, 1.2, 0x93a0b2, { metalness: 0.8, roughness: 0.3 }); sheet.position.set(1.9, 1.25, 0); g.add(sheet);
    const glow = box(T, 4.0, 0.12, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.35, 0.94); g.add(glow);
    return { group: g, glow };
  },
  recycler(T, c) {
    const g = new T.Group();
    const body = box(T, 2.2, 1.8, 2.0, 0x2f4a34); body.position.y = 1.0; g.add(body);
    const chute = box(T, 1.0, 0.9, 1.0, 0x3d5c42); chute.position.set(0, 2.2, 0); chute.rotation.y = 0.4; g.add(chute);
    const bales = new T.Group();
    [[1.6, 0.4, 0.4], [1.6, 1.2, 0.4], [1.6, 0.4, -0.7]].forEach(([x, y, z]) => { const b = box(T, 0.8, 0.7, 0.8, 0x7fd6ff); b.position.set(x, y, z); bales.add(b); });
    g.add(bales);
    const glow = box(T, 1.9, 0.12, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.55, 1.02); g.add(glow);
    return { group: g, glow };
  },
  caster(T, c) {
    const g = new T.Group();
    // A tilting ladle over a row of moulds — reads as "metal comes out here".
    const furnaceBody = cyl(T, 0.95, 1.1, 1.5, 0x6b5340, 18); furnaceBody.position.set(-1.1, 1.4, 0); g.add(furnaceBody);
    const spout = cyl(T, 0.2, 0.34, 0.8, 0x8a6a48, 12); spout.rotation.z = -0.7; spout.position.set(-0.25, 1.7, 0); g.add(spout);
    // The pour itself, emissive so a running Caster is obvious across the shed.
    const pour = cyl(T, 0.1, 0.14, 1.0, 0xffb04a, 8, { emissive: 0xff8a1a, emissiveIntensity: 1.8 });
    pour.position.set(0.1, 1.0, 0); g.add(pour);
    const bed = box(T, 3.0, 0.5, 1.6, 0x33383f); bed.position.set(0.9, 0.45, 0); g.add(bed);
    [-0.2, 0.7, 1.6].forEach((x, i) => {
      const ingot = box(T, 0.7, 0.26, 1.0, 0xc8b48a, { metalness: 0.7, roughness: 0.35 });
      ingot.position.set(x, 0.82, 0); g.add(ingot);
      if (!i) g.userData.flare = pour;
    });
    const glow = box(T, 3.8, 0.14, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.42, 1.4); g.add(glow);
    return { group: g, glow };
  },
  ewaste(T, c) {
    const g = new T.Group();
    const bench = box(T, 3.0, 0.16, 1.2, 0x39424f); bench.position.y = 1.0; g.add(bench);
    for (const x of [-1.3, 1.3]) { const l = box(T, 0.14, 1.0, 1.0, 0x2c343f); l.position.set(x, 0.5, 0); g.add(l); }
    const bin = box(T, 0.8, 0.7, 0.8, 0x2a3b52); bin.position.set(-1.0, 1.45, 0); g.add(bin);
    const glow = box(T, 2.6, 0.1, 0.9, c, { emissive: c, emissiveIntensity: 0.85 }); glow.position.set(0, 1.09, 0); g.add(glow);
    return { group: g, glow };
  },
  still(T, c) {
    const g = new T.Group();
    const col = cyl(T, 0.85, 0.95, 5.2, 0xb8a06a, 20); col.position.y = 2.8; g.add(col);
    for (let i = 0; i < 4; i++) { const r = cyl(T, 1.05, 1.05, 0.16, 0x8a7448, 20); r.position.y = 1.2 + i * 1.15; g.add(r); }
    const top = cyl(T, 0.5, 0.9, 0.7, 0x8a7448, 20); top.position.y = 5.6; g.add(top);
    const pipe = cyl(T, 0.16, 0.16, 2.2, 0x9aa2ae, 10); pipe.rotation.z = Math.PI / 2; pipe.position.set(1.4, 4.6, 0); g.add(pipe);
    const glow = cyl(T, 1.0, 1.0, 0.4, c, { emissive: c, emissiveIntensity: 1.2 }); glow.position.y = 0.5; g.add(glow);
    return { group: g, glow };
  },
  cracker(T, c) {
    const g = new T.Group();
    const sphere = new T.Mesh(new T.SphereGeometry(1.25, 20, 14), mat(T, 0x7fa05a)); sphere.position.y = 2.4; g.add(sphere);
    const neck = cyl(T, 0.45, 0.45, 1.6, 0x5f7a44, 14); neck.position.y = 1.1; g.add(neck);
    for (const s of [-1, 1]) { const p = cyl(T, 0.13, 0.13, 2.6, 0x9aa2ae, 10); p.position.set(s * 1.5, 1.6, 0.5); g.add(p); }
    const glow = cyl(T, 1.0, 1.0, 0.35, c, { emissive: c, emissiveIntensity: 1.2 }); glow.position.y = 0.45; g.add(glow);
    return { group: g, glow };
  },
  digester(T, c) {
    const g = new T.Group();
    const tank = cyl(T, 1.5, 1.5, 2.0, 0x4a7a48, 22); tank.position.y = 1.2; g.add(tank);
    const dome = new T.Mesh(new T.SphereGeometry(1.5, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(T, 0x5c9455));
    dome.position.y = 2.2; g.add(dome);
    const vent = cyl(T, 0.13, 0.13, 1.4, 0x9aa2ae, 10); vent.position.set(1.0, 3.2, 0); g.add(vent);
    const glow = cyl(T, 1.56, 1.56, 0.32, c, { emissive: c, emissiveIntensity: 1.1 }); glow.position.y = 0.4; g.add(glow);
    return { group: g, glow };
  },
  blender(T, c) {
    const g = new T.Group();
    [-0.95, 0, 0.95].forEach((x, i) => { const t = cyl(T, 0.44, 0.44, 2.0 + i * 0.25, 0xa8763f, 16); t.position.set(x, 1.1 + i * 0.12, 0); g.add(t); });
    const manifold = box(T, 2.6, 0.22, 0.5, 0x8a6a3a); manifold.position.y = 2.5; g.add(manifold);
    const glow = box(T, 2.5, 0.12, 0.1, c, { emissive: c, emissiveIntensity: 1 }); glow.position.set(0, 0.42, 0.6); g.add(glow);
    return { group: g, glow };
  },
  powerhouse(T, c) {
    const g = new T.Group();
    const hall = box(T, 4.4, 2.6, 3.0, 0x2e3a44); hall.position.y = 1.4; g.add(hall);
    const stack = cyl(T, 0.5, 0.66, 4.6, 0x59636e, 16); stack.position.set(-1.5, 3.0, -0.9); g.add(stack);
    const turbine = cyl(T, 0.85, 0.85, 1.6, 0x8affd6, 18, { emissive: 0x2f8a6a, emissiveIntensity: 0.5 });
    turbine.rotation.z = Math.PI / 2; turbine.position.set(1.2, 2.9, 0); g.add(turbine);
    const glow = box(T, 4.2, 0.16, 0.12, c, { emissive: c, emissiveIntensity: 1.2 }); glow.position.set(0, 0.5, 1.52); g.add(glow);
    g.userData.spin = turbine; return { group: g, glow };
  },
  yard(T, c) {
    const g = new T.Group();
    const rack = new T.Group();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const crate = box(T, 1.1, 0.9, 1.1, j ? 0xb08a4a : 0x8a7a5a);
      crate.position.set(-1.4 + i * 1.4, 0.55 + j * 0.95, 0); rack.add(crate);
    }
    g.add(rack);
    const post = box(T, 0.16, 2.6, 0.16, 0x4a505a); post.position.set(-2.4, 1.3, 0); g.add(post);
    const glow = box(T, 4.2, 0.1, 0.1, c, { emissive: c, emissiveIntensity: 0.8 }); glow.position.set(0, 0.06, 0.7); g.add(glow);
    return { group: g, glow };
  },
};

/* Desks for the fixed stations. Deliberately plainer than the machines so the
   eye reads them as furniture rather than as another thing to run. */
function buildStation(T, st) {
  const g = new T.Group();
  const desk = box(T, 2.6, 1.0, 1.1, 0x2f3540); desk.position.y = 0.55; g.add(desk);
  const top = box(T, 2.8, 0.1, 1.3, 0x3c4450); top.position.y = 1.1; g.add(top);
  /* Dark base, emissive does the work — see the blown-out-sign note in world.js. */
  const sign = box(T, 2.0, 0.7, 0.08, 0x1a1f27, { emissive: st.color, emissiveIntensity: 0.5 });
  sign.position.set(0, 2.1, -0.2); g.add(sign);
  for (const s of [-1, 1]) { const p = box(T, 0.1, 1.1, 0.1, 0x4a525e); p.position.set(s * 0.9, 1.6, -0.2); g.add(p); }
  return { group: g, glow: sign };
}

/* 🔴 THE ONE ENTRY POINT — always returns something drawable.
   `id` may be a machine id or a station id. Never returns null: an unknown id
   gets a marked placeholder crate rather than a hole in the floor, because a
   missing machine the player can still walk up to and read is debuggable and an
   invisible one is not. */
export function build(T, id) {
  const st = STATIONS.find(s => s.id === id);
  if (st) return buildStation(T, st);
  const def = machineById(id);
  const color = def ? parseInt(String(def.accent).replace('#', ''), 16) : 0x8d97a8;
  const b = BUILDERS[id];
  if (b) {
    const made = b(T, color);
    const foot = footprintOf(id);
    const g = new T.Group();
    g.add(plinth(T, foot.w, foot.d, color));
    g.add(made.group);
    return { group: g, glow: made.glow };
  }
  const g = new T.Group();
  const crate = box(T, 1.6, 1.6, 1.6, 0x555b66); crate.position.y = 0.8; g.add(crate);
  const glow = box(T, 1.7, 0.12, 0.1, 0xff8a8a, { emissive: 0xff8a8a, emissiveIntensity: 1 });
  glow.position.set(0, 0.3, 0.85); g.add(glow);
  return { group: g, glow };
}

/* Collision + interact radii. Derived from the geometry above rather than
   hand-listed a second time, so a machine cannot end up with a body the player
   walks through or a prompt they can never reach. */
const FOOT = {
  shredder:{w:3.2,d:2.6}, sorter:{w:5.6,d:2.0}, baler:{w:3.0,d:3.0}, furnace:{w:3.4,d:3.4},
  converter:{w:3.6,d:2.8}, mill:{w:4.8,d:2.4}, recycler:{w:3.2,d:2.6}, ewaste:{w:3.4,d:1.8},
  still:{w:2.6,d:2.6}, cracker:{w:3.2,d:2.6}, digester:{w:3.4,d:3.4}, blender:{w:3.0,d:1.6},
  powerhouse:{w:4.8,d:3.4}, yard:{w:4.6,d:1.6}, caster:{w:4.2,d:2.8},
  // The three desks. Same table so blocks() needs no station branch.
  supply:{w:2.8,d:1.3}, weigh:{w:2.8,d:1.3}, control:{w:2.8,d:1.3},
};
export function footprintOf(id) { return FOOT[id] || { w: 2.0, d: 2.0 }; }

/* 🔴 COLLISION IS AN ORIENTED BOX, NOT A CIRCLE — because these machines are not
   round. One radius has to serve both the 3.4 m furnace and the 5.6 × 2.0 m
   conveyor, and there is no value that works for both: sized to the conveyor's
   length it blocks a 3 m circle of empty aisle either side of it; sized to its
   depth the player walks through both ends. Sized to the furnace's average, the
   camera pushes inside the stack — which is what the first pass did, and it
   looks like the model has failed to load.
   Testing |dx| and |dz| in the spot's own rotated frame costs two trig calls and
   fits every machine exactly. PLAYER_R is the body radius that keeps the near
   face out of the camera's near plane. */
export const PLAYER_R = 0.45;
export function blocks(id, ry, px, pz, cx, cz) {
  const f = footprintOf(id);
  const dx = px - cx, dz = pz - cz;
  const c = Math.cos(-ry || 0), s = Math.sin(-ry || 0);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) < f.w / 2 + PLAYER_R && Math.abs(lz) < f.d / 2 + PLAYER_R;
}
/* 🔴 THE UNSTICK. Returns the shortest push that gets a point OUT of a body, or
   null if it is already clear.

   You can end up inside a machine without ever walking into one: stand on an
   empty pad, press Build, and the walkable ghost becomes a solid body around
   you. Collision alone then traps you permanently — every candidate move is
   inside the box, so every move is rejected, and the only way out is to close
   the panel. That is the bug this exists for, and blocking the build while a
   player stands there would only trade it for "why can't I build here?".

   Pushing along the axis of SMALLEST penetration is what makes the ejection feel
   like being nudged aside rather than flung: from just inside the north face you
   pop out north, not out the long end of a conveyor. */
export function pushOut(id, ry, px, pz, cx, cz) {
  const f = footprintOf(id);
  const hw = f.w / 2 + PLAYER_R, hd = f.d / 2 + PLAYER_R;
  const dx = px - cx, dz = pz - cz;
  const c = Math.cos(-ry || 0), sn = Math.sin(-ry || 0);
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  const ox = hw - Math.abs(lx), oz = hd - Math.abs(lz);
  if (ox <= 0 || oz <= 0) return null;               // already outside
  /* 🔴 CLEAR THE FACE BY EPS, DO NOT LAND ON IT. Pushing to exactly ±hw put the
     point on the boundary, where `blocks` is false only by a strict <. Rotating
     that back into world space and re-testing reintroduced float error, and 971
     of 3,583 interior points tested as STILL STUCK — the unstick silently did
     nothing for a quarter of the floor. 2 cm is imperceptible and unambiguous. */
  const EPS = 0.02;
  let nlx = lx, nlz = lz;
  // Ties go to x so the choice is deterministic; dead centre (lx === 0) takes
  // the positive face rather than needing a special case.
  if (ox <= oz) nlx = (lx >= 0 ? 1 : -1) * (hw + EPS);
  else nlz = (lz >= 0 ? 1 : -1) * (hd + EPS);
  // Back to world space (inverse of the -ry rotation above).
  const ic = Math.cos(ry || 0), is = Math.sin(ry || 0);
  return { x: cx + (nlx * ic - nlz * is), z: cz + (nlx * is + nlz * ic) };
}

/* Still a circle — a prompt that only appears inside a rectangle would feel
   arbitrary, and generous is the right failure mode for "can I reach this?". */
export function interactRadius(id) { const f = footprintOf(id); return Math.max(f.w, f.d) * 0.5 + 2.2; }
export function blockRadius(id) { const f = footprintOf(id); return Math.max(f.w, f.d) * 0.5 + PLAYER_R; }

export default { FLOOR, SPAWN, LAYOUT, STATIONS, build, overrideFor, footprintOf, blockRadius, interactRadius, blocks, pushOut, PLAYER_R, srgb };
