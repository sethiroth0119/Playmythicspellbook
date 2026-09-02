/* mapforge.props.js — the built-in asset library.

   Every prop is procedural (boxes, cones, cylinders) so a map never depends
   on a file that might 404, and a placed prop costs one clone of a cached
   template. Custom .glb models are the 'glb' type and live in the map's
   `assets` list; they are loaded by mapforge.world.js, not here.

   `tint` props accept a colour: meshes flagged userData.tint take it, the
   rest (trunks, stone, metal) keep theirs — so a red-roofed house is one
   inspector field, not a second prop. `marker` props are editor-visible
   gameplay markers (spawn points, zones); the runtime can hide them. */

export const PROP_CATALOG = [
  // ── Nature ──
  { id: 'tree',     label: 'Oak tree',     icon: '🌳', cat: 'Nature', tint: true },
  { id: 'pine',     label: 'Pine',         icon: '🌲', cat: 'Nature', tint: true },
  { id: 'deadtree', label: 'Dead tree',    icon: '🪵', cat: 'Nature' },
  { id: 'bush',     label: 'Bush',         icon: '🌿', cat: 'Nature', tint: true },
  { id: 'grass',    label: 'Grass tuft',   icon: '🌾', cat: 'Nature', tint: true, col: false },
  { id: 'flowers',  label: 'Flowers',      icon: '🌼', cat: 'Nature', tint: true, col: false },
  { id: 'rock',     label: 'Rock',         icon: '🪨', cat: 'Nature', tint: true },
  { id: 'boulder',  label: 'Boulder',      icon: '⛰️', cat: 'Nature', tint: true },
  { id: 'log',      label: 'Fallen log',   icon: '🪵', cat: 'Nature' },
  { id: 'stump',    label: 'Stump',        icon: '🌰', cat: 'Nature' },
  { id: 'mushroom', label: 'Mushroom',     icon: '🍄', cat: 'Nature', tint: true, col: false },
  { id: 'crystal',  label: 'Crystals',     icon: '💎', cat: 'Nature', tint: true },
  // ── Structures ──
  { id: 'house',    label: 'House',        icon: '🏠', cat: 'Structures', tint: true },
  { id: 'cottage',  label: 'Cottage',      icon: '🛖', cat: 'Structures', tint: true },
  { id: 'tower',    label: 'Tower',        icon: '🗼', cat: 'Structures', tint: true },
  { id: 'wall',     label: 'Stone wall',   icon: '🧱', cat: 'Structures' },
  { id: 'fence',    label: 'Fence',        icon: '🪵', cat: 'Structures' },
  { id: 'arch',     label: 'Gate arch',    icon: '⛩️', cat: 'Structures' },
  { id: 'bridge',   label: 'Bridge',       icon: '🌉', cat: 'Structures' },
  { id: 'well',     label: 'Well',         icon: '🕳️', cat: 'Structures' },
  { id: 'pillar',   label: 'Pillar',       icon: '🏛️', cat: 'Structures' },
  { id: 'ruin',     label: 'Ruined wall',  icon: '🏚️', cat: 'Structures' },
  { id: 'altar',    label: 'Altar',        icon: '🔮', cat: 'Structures', tint: true },
  { id: 'statue',   label: 'Statue',       icon: '🗿', cat: 'Structures' },
  { id: 'tent',     label: 'Tent',         icon: '⛺', cat: 'Structures', tint: true },
  { id: 'stall',    label: 'Market stall', icon: '🏪', cat: 'Structures', tint: true },
  // ── Props ──
  { id: 'barrel',   label: 'Barrel',       icon: '🛢️', cat: 'Props' },
  { id: 'crate',    label: 'Crate',        icon: '📦', cat: 'Props' },
  { id: 'chest',    label: 'Chest',        icon: '🧰', cat: 'Props', tint: true },
  { id: 'lantern',  label: 'Lantern post', icon: '🏮', cat: 'Props', tint: true },
  { id: 'campfire', label: 'Campfire',     icon: '🔥', cat: 'Props', col: false },
  { id: 'banner',   label: 'Banner',       icon: '🚩', cat: 'Props', tint: true },
  { id: 'signpost', label: 'Signpost',     icon: '🪧', cat: 'Props' },
  // ── Ruins — the post-apocalyptic city ──
  { id: 'ruintower', label: 'Ruined tower',    icon: '🏢', cat: 'Ruins', tint: true },
  { id: 'collapsed', label: 'Collapsed block', icon: '🏚️', cat: 'Ruins', tint: true },
  { id: 'rubble',    label: 'Rubble pile',     icon: '🪨', cat: 'Ruins' },
  { id: 'road',      label: 'Cracked road',    icon: '🛣️', cat: 'Ruins', col: false },
  { id: 'overpass',  label: 'Overpass',        icon: '🌉', cat: 'Ruins' },
  { id: 'wreckcar',  label: 'Wrecked car',     icon: '🚗', cat: 'Ruins', tint: true },
  { id: 'lamppost',  label: 'Bent lamp post',  icon: '🪔', cat: 'Ruins' },
  { id: 'barrier',   label: 'Concrete barrier',icon: '🧱', cat: 'Ruins' },
  { id: 'barricade', label: 'Barricade',       icon: '🪵', cat: 'Ruins' },
  { id: 'container', label: 'Container',       icon: '📦', cat: 'Ruins', tint: true },
  { id: 'radiotower',label: 'Radio mast',      icon: '📡', cat: 'Ruins' },
  { id: 'billboard', label: 'Dead billboard',  icon: '🪧', cat: 'Ruins' },
  { id: 'burnttree', label: 'Burnt tree',      icon: '🌲', cat: 'Ruins' },
  { id: 'drum',      label: 'Oil drum',        icon: '🛢️', cat: 'Ruins', tint: true },
  { id: 'scrap',     label: 'Scrap heap',      icon: '⚙️', cat: 'Ruins' },
  { id: 'crater',    label: 'Crater',          icon: '💥', cat: 'Ruins', col: false },
  { id: 'generator', label: 'Generator',       icon: '🔋', cat: 'Ruins', tint: true },
  { id: 'pylon',     label: 'Energy pylon',    icon: '⚡', cat: 'Ruins', tint: true },
  { id: 'dronewreck',label: 'Drone wreck',     icon: '🛸', cat: 'Ruins' },
  { id: 'bunker',    label: 'Bunker door',     icon: '🚪', cat: 'Ruins' },
  { id: 'sfcrate',   label: 'Supply crate',    icon: '🗃️', cat: 'Ruins', tint: true },
  // ── Markers ──
  { id: 'spawn',    label: 'Player spawn', icon: '🎯', cat: 'Markers', marker: true, col: false },
  { id: 'enemy',    label: 'Enemy spawn',  icon: '💀', cat: 'Markers', marker: true, col: false },
  { id: 'waypoint', label: 'Waypoint',     icon: '📍', cat: 'Markers', marker: true, col: false },
  { id: 'zone',     label: 'Zone (10m)',   icon: '⭕', cat: 'Markers', marker: true, col: false },
];
/* Does this object block the player? Explicit o.col wins; else the prop's
   default (col: false above), else solid. Custom .glb models are solid. */
export function collides(o) { if (typeof o.col === 'boolean') return o.col; const m = PROP_BY_ID[o.t]; return m ? m.col !== false : true; }
export const PROP_BY_ID = Object.fromEntries(PROP_CATALOG.map(p => [p.id, p]));

const templates = new Map();
const matCache = new Map();

export function buildProp(THREE, id, tint) {
  const key = id + '|' + (tint || '');
  let tpl = templates.get(key);
  if (!tpl) {
    const fn = BUILDERS[id] || BUILDERS.placeholder;
    const ctx = makeCtx(THREE, tint);
    tpl = fn(ctx);
    tpl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    templates.set(key, tpl);
  }
  const g = tpl.clone();
  g.userData = { mfProp: id };
  return g;
}

function makeCtx(THREE, tint) {
  const mat = (color, o) => {
    o = o || {};
    const k = color + '|' + (o.rough == null ? 0.85 : o.rough) + '|' + (o.metal || 0) + '|' + (o.emissive || '') + '|' + (o.ei || '') + '|' + (o.op == null ? 1 : o.op) + '|' + (o.flat ? 1 : 0);
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: o.rough == null ? 0.85 : o.rough, metalness: o.metal || 0, emissive: o.emissive || 0x000000, emissiveIntensity: o.ei == null ? 1 : o.ei, flatShading: !!o.flat });
      if (o.op != null && o.op < 1) { m.transparent = true; m.opacity = o.op; m.depthWrite = false; }
      matCache.set(k, m);
    }
    return m;
  };
  const tintOr = (def) => tint || def;
  const M = (geo, color, o, isTint) => {
    const m = new THREE.Mesh(geo, mat(isTint ? tintOr(color) : color, o));
    if (isTint) m.userData.tint = true;
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, s, open) => new THREE.CylinderGeometry(rt, rb, h, s || 10, 1, !!open);
  const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 8);
  const sph = (r, s) => new THREE.SphereGeometry(r, s || 10, (s || 10) - 2);
  const ico = (r, d) => new THREE.IcosahedronGeometry(r, d == null ? 1 : d);
  const G = () => new THREE.Group();
  const at = (m, x, y, z, ry) => { m.position.set(x, y, z); if (ry) m.rotation.y = ry; return m; };
  // deterministic jitter so a template is the same every time
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jag = (geo, amt) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { p.setXYZ(i, p.getX(i) * (1 + (rnd() - 0.5) * amt), p.getY(i) * (1 + (rnd() - 0.5) * amt), p.getZ(i) * (1 + (rnd() - 0.5) * amt)); } geo.computeVertexNormals(); return geo; };
  return { THREE, M, box, cyl, cone, sph, ico, G, at, rnd, jag, tint };
}

const WOOD = '#6b4a2b', DARKWOOD = '#4a3119', STONE = '#8a8a86', DARKSTONE = '#5a5a58', IRON = '#3b3f46', ROPE = '#b89b6a';
const CONC = '#8d8a84', DARKCONC = '#5f5c58', ASPH = '#3d3f44', RUST = '#7a3b1e', SOOT = '#1f2022', GLASS = '#1a2430', NEON = '#4de3ff';

const BUILDERS = {
  placeholder: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(1, 1, 1), '#c66bff', { emissive: '#5a1a99', ei: 0.35 }), 0, 0.5, 0)); return g; },

  tree: ({ M, cyl, sph, G, at }) => { const g = G(); g.add(at(M(cyl(0.16, 0.24, 1.8, 7), WOOD), 0, 0.9, 0));
    g.add(at(M(sph(1.15, 9), '#3f8a3a', { flat: true }, true), 0, 2.5, 0)); g.add(at(M(sph(0.8, 8), '#4a9c42', { flat: true }, true), 0.6, 2.9, 0.3)); g.add(at(M(sph(0.7, 8), '#3a7f36', { flat: true }, true), -0.55, 2.2, -0.35)); return g; },
  pine: ({ M, cyl, cone, G, at }) => { const g = G(); g.add(at(M(cyl(0.12, 0.2, 1.4, 7), DARKWOOD), 0, 0.7, 0));
    [[1.3, 1.6, 1.4], [1.05, 1.5, 2.3], [0.75, 1.3, 3.1], [0.45, 1.0, 3.8]].forEach(([r, h, y]) => g.add(at(M(cone(r, h, 8), '#2f6b3a', { flat: true }, true), 0, y, 0))); return g; },
  deadtree: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(0.1, 0.24, 2.4, 6), '#4d4038'), 0, 1.2, 0));
    const b1 = at(M(cyl(0.05, 0.09, 1.2, 5), '#4d4038'), 0.35, 2.3, 0); b1.rotation.z = -0.9; g.add(b1);
    const b2 = at(M(cyl(0.04, 0.08, 1.0, 5), '#4d4038'), -0.3, 1.9, 0.1); b2.rotation.z = 0.8; b2.rotation.x = 0.4; g.add(b2); return g; },
  bush: ({ M, sph, G, at }) => { const g = G(); g.add(at(M(sph(0.55, 7), '#3e7d34', { flat: true }, true), 0, 0.45, 0)); g.add(at(M(sph(0.42, 7), '#488a3c', { flat: true }, true), 0.42, 0.38, 0.2)); g.add(at(M(sph(0.38, 7), '#376f2f', { flat: true }, true), -0.38, 0.35, -0.22)); return g; },
  grass: ({ M, cone, G, at, rnd }) => { const g = G(); for (let i = 0; i < 7; i++) { const c = at(M(cone(0.07, 0.55 + rnd() * 0.3, 4), '#6aa84f', { flat: true }, true), (rnd() - 0.5) * 0.5, 0.28, (rnd() - 0.5) * 0.5); c.rotation.z = (rnd() - 0.5) * 0.5; c.rotation.x = (rnd() - 0.5) * 0.5; g.add(c); } return g; },
  flowers: ({ M, cyl, sph, G, at, rnd }) => { const g = G(); for (let i = 0; i < 6; i++) { const x = (rnd() - 0.5) * 0.8, z = (rnd() - 0.5) * 0.8; g.add(at(M(cyl(0.015, 0.02, 0.35, 4), '#5f9a3e'), x, 0.17, z)); g.add(at(M(sph(0.08, 6), '#ffd23f', { flat: true }, true), x, 0.36, z)); } return g; },
  rock: ({ M, ico, jag, G, at }) => { const g = G(); const r = at(M(jag(ico(0.6, 1), 0.35), STONE, { flat: true }, true), 0, 0.4, 0); r.scale.set(1.2, 0.75, 1); g.add(r); return g; },
  boulder: ({ M, ico, jag, G, at }) => { const g = G(); const r = at(M(jag(ico(1.4, 1), 0.3), DARKSTONE, { flat: true }, true), 0, 1.0, 0); r.scale.set(1.3, 0.9, 1.1); g.add(r); g.add(at(M(jag(ico(0.6, 1), 0.3), STONE, { flat: true }, true), 1.4, 0.4, 0.4)); return g; },
  log: ({ M, cyl, G, at }) => { const g = G(); const l = at(M(cyl(0.28, 0.32, 2.4, 9), WOOD), 0, 0.3, 0); l.rotation.z = Math.PI / 2; l.rotation.y = 0.3; g.add(l); return g; },
  stump: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(0.4, 0.5, 0.5, 9), WOOD), 0, 0.25, 0)); g.add(at(M(cyl(0.36, 0.36, 0.04, 9), '#b58d5c'), 0, 0.52, 0)); return g; },
  mushroom: ({ M, cyl, sph, G, at }) => { const g = G(); g.add(at(M(cyl(0.12, 0.16, 0.5, 8), '#e8dcc0'), 0, 0.25, 0)); const cap = at(M(sph(0.42, 10), '#c0392b', { flat: true }, true), 0, 0.5, 0); cap.scale.y = 0.55; g.add(cap); return g; },
  crystal: ({ M, cone, G, at, rnd }) => { const g = G(); for (let i = 0; i < 5; i++) { const h = 0.8 + rnd() * 1.2; const c = at(M(cone(0.18 + rnd() * 0.12, h, 5), '#5ad4ff', { emissive: '#1a6cff', ei: 0.45, rough: 0.2, flat: true, op: 0.9 }, true), (rnd() - 0.5) * 0.9, h / 2 - 0.1, (rnd() - 0.5) * 0.9); c.rotation.z = (rnd() - 0.5) * 0.7; c.rotation.x = (rnd() - 0.5) * 0.7; g.add(c); } return g; },

  house: ({ M, box, cone, G, at, THREE }) => { const g = G(); g.add(at(M(box(4, 2.6, 3.4), '#d9c7a3'), 0, 1.3, 0)); const roof = at(M(cone(3.2, 1.8, 4), '#8a3b2a', { flat: true }, true), 0, 3.5, 0); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.85; g.add(roof);
    g.add(at(M(box(0.9, 1.5, 0.1), DARKWOOD), 0, 0.75, 1.72)); g.add(at(M(box(0.7, 0.7, 0.1), '#7fc2ff', { emissive: '#3b7fd6', ei: 0.3 }), 1.3, 1.5, 1.72)); g.add(at(M(box(0.7, 0.7, 0.1), '#7fc2ff', { emissive: '#3b7fd6', ei: 0.3 }), -1.3, 1.5, 1.72));
    g.add(at(M(box(0.5, 1.2, 0.5), DARKSTONE), 1.2, 3.8, -0.6)); return g; },
  cottage: ({ M, box, cyl, cone, G, at }) => { const g = G(); g.add(at(M(cyl(1.6, 1.7, 2.0, 12), '#e0d3b0'), 0, 1.0, 0)); g.add(at(M(cone(2.2, 1.7, 12), '#b48a4e', { flat: true }, true), 0, 2.85, 0)); g.add(at(M(box(0.8, 1.3, 0.1), DARKWOOD), 0, 0.65, 1.62)); return g; },
  tower: ({ M, cyl, cone, box, G, at }) => { const g = G(); g.add(at(M(cyl(1.3, 1.6, 6, 12), STONE), 0, 3, 0)); g.add(at(M(cyl(1.6, 1.6, 0.5, 12), DARKSTONE), 0, 6.2, 0)); g.add(at(M(cone(1.7, 2.2, 12), '#3b4c7a', { flat: true }, true), 0, 7.5, 0));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(at(M(box(0.4, 0.5, 0.4), DARKSTONE), Math.cos(a) * 1.45, 6.7, Math.sin(a) * 1.45, -a)); } g.add(at(M(box(0.5, 0.9, 0.1), '#1a1a20'), 0, 3.5, 1.58)); return g; },
  wall: ({ M, box, G, at, rnd }) => { const g = G(); g.add(at(M(box(4, 1.6, 0.6), STONE), 0, 0.8, 0)); for (let i = 0; i < 4; i++) g.add(at(M(box(0.6, 0.4, 0.62), DARKSTONE), -1.5 + i, 1.8, 0)); return g; },
  fence: ({ M, box, cyl, G, at }) => { const g = G(); for (let i = -1; i <= 1; i++) g.add(at(M(cyl(0.06, 0.07, 1.1, 6), WOOD), i * 1.5, 0.55, 0)); g.add(at(M(box(3.2, 0.1, 0.06), WOOD), 0, 0.85, 0)); g.add(at(M(box(3.2, 0.1, 0.06), WOOD), 0, 0.45, 0)); return g; },
  arch: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(0.8, 4, 0.8), STONE), -2, 2, 0)); g.add(at(M(box(0.8, 4, 0.8), STONE), 2, 2, 0)); g.add(at(M(box(5, 0.8, 0.9), DARKSTONE), 0, 4.4, 0)); g.add(at(M(box(1, 0.5, 1), '#d4af37', { metal: 0.6, rough: 0.35 }), 0, 5.05, 0)); return g; },
  bridge: ({ M, box, cyl, G, at }) => { const g = G(); for (let i = 0; i < 8; i++) g.add(at(M(box(0.72, 0.12, 2.2), i % 2 ? WOOD : '#7a5633'), -2.8 + i * 0.8, 0.4, 0));
    [-1, 1].forEach(s => { g.add(at(M(box(6.4, 0.08, 0.08), WOOD), 0, 1.2, s * 1.05)); for (let i = 0; i < 4; i++) g.add(at(M(cyl(0.05, 0.06, 0.9, 6), WOOD), -2.7 + i * 1.8, 0.85, s * 1.05)); });
    [-2.6, 2.6].forEach(x => [-0.9, 0.9].forEach(z => g.add(at(M(cyl(0.12, 0.14, 0.6, 7), DARKWOOD), x, 0.1, z)))); return g; },
  well: ({ M, cyl, box, cone, G, at }) => { const g = G(); g.add(at(M(cyl(0.9, 1.0, 0.9, 12), STONE), 0, 0.45, 0)); g.add(at(M(cyl(0.7, 0.7, 0.05, 12), '#1c3550'), 0, 0.92, 0));
    [-0.8, 0.8].forEach(x => g.add(at(M(box(0.12, 1.6, 0.12), WOOD), x, 1.6, 0))); g.add(at(M(cone(1.2, 0.7, 4), '#6b3d2a', { flat: true }), 0, 2.7, 0, Math.PI / 4)); g.add(at(M(cyl(0.05, 0.05, 1.7, 6), IRON), 0, 2.0, 0, 0)).rotation.z = Math.PI / 2; return g; },
  pillar: ({ M, cyl, box, G, at }) => { const g = G(); g.add(at(M(box(1.2, 0.3, 1.2), DARKSTONE), 0, 0.15, 0)); g.add(at(M(cyl(0.38, 0.42, 3.6, 12), STONE), 0, 2.1, 0)); g.add(at(M(box(1.1, 0.3, 1.1), DARKSTONE), 0, 4.05, 0)); return g; },
  ruin: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(2.2, 2.4, 0.7), DARKSTONE), -1.2, 1.2, 0)); g.add(at(M(box(1.6, 1.3, 0.7), STONE), 0.8, 0.65, 0)); g.add(at(M(box(0.8, 0.5, 0.75), STONE), 1.9, 0.25, 0)); g.add(at(M(box(0.9, 0.5, 0.9), DARKSTONE), -2.0, 0.25, 1.2, 0.5)); return g; },
  altar: ({ M, box, cyl, sph, G, at }) => { const g = G(); g.add(at(M(box(2.4, 0.4, 1.6), DARKSTONE), 0, 0.2, 0)); g.add(at(M(box(1.8, 0.8, 1.0), STONE), 0, 0.8, 0)); g.add(at(M(sph(0.32, 12), '#b46bff', { emissive: '#7a2cff', ei: 0.8, rough: 0.2 }, true), 0, 1.6, 0)); return g; },
  statue: ({ M, box, cyl, sph, G, at }) => { const g = G(); g.add(at(M(box(1.4, 0.6, 1.4), DARKSTONE), 0, 0.3, 0)); g.add(at(M(box(0.6, 1.2, 0.5), STONE), 0, 1.2, 0)); g.add(at(M(sph(0.28, 10), STONE), 0, 2.1, 0)); g.add(at(M(box(1.1, 0.22, 0.28), STONE), 0, 1.55, 0)); return g; },
  tent: ({ M, cone, box, G, at }) => { const g = G(); const t = at(M(cone(1.8, 2.2, 4), '#b9773c', { flat: true }, true), 0, 1.1, 0, Math.PI / 4); t.scale.z = 1.25; g.add(t); g.add(at(M(box(0.8, 1.1, 0.1), '#2b1b10'), 0, 0.55, 1.3)); return g; },
  stall: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(2.6, 0.9, 1.0), WOOD), 0, 0.45, 0)); [-1.2, 1.2].forEach(x => [-0.4, 0.4].forEach(z => g.add(at(M(cyl(0.05, 0.05, 2.3, 6), DARKWOOD), x, 1.15, z))));
    for (let i = 0; i < 6; i++) g.add(at(M(box(0.47, 0.06, 1.3), i % 2 ? '#c0392b' : '#f1e6c8', {}, i % 2 === 1), -1.2 + i * 0.47 + 0.23, 2.32, 0)); g.add(at(M(box(0.4, 0.3, 0.4), '#e0a040'), -0.6, 1.05, 0.2)); g.add(at(M(box(0.35, 0.25, 0.35), '#7cc36b'), 0.5, 1.02, -0.1)); return g; },

  barrel: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(0.38, 0.32, 1.0, 12), WOOD), 0, 0.5, 0)); [0.25, 0.75].forEach(y => g.add(at(M(cyl(0.4, 0.4, 0.06, 12), IRON, { metal: 0.6, rough: 0.5 }), 0, y, 0))); return g; },
  crate: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(1, 1, 1), '#a67c52'), 0, 0.5, 0)); g.add(at(M(box(1.04, 0.1, 1.04), DARKWOOD), 0, 0.5, 0)); g.add(at(M(box(0.1, 1.04, 1.04), DARKWOOD), 0, 0.5, 0)); return g; },
  chest: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(1.2, 0.6, 0.8), '#7a4a22', {}, true), 0, 0.3, 0)); const lid = at(M(cyl(0.4, 0.4, 1.2, 10, true), '#8d5a2b', {}, true), 0, 0.6, 0); lid.rotation.z = Math.PI / 2; lid.scale.z = 0.5; g.add(lid); g.add(at(M(box(0.2, 0.25, 0.1), '#d4af37', { metal: 0.7, rough: 0.3 }), 0, 0.55, 0.42)); return g; },
  lantern: ({ M, cyl, box, sph, G, at }) => { const g = G(); g.add(at(M(cyl(0.06, 0.09, 3.0, 7), IRON, { metal: 0.5, rough: 0.5 }), 0, 1.5, 0)); g.add(at(M(box(0.7, 0.06, 0.06), IRON), 0.3, 2.95, 0)); g.add(at(M(box(0.3, 0.4, 0.3), '#ffd27a', { emissive: '#ffb347', ei: 1.4, rough: 0.3, op: 0.9 }, true), 0.6, 2.7, 0)); return g; },
  campfire: ({ M, cyl, cone, ico, G, at, rnd }) => { const g = G(); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; g.add(at(M(ico(0.18, 0), DARKSTONE, { flat: true }), Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7)); }
    for (let i = 0; i < 3; i++) { const l = at(M(cyl(0.07, 0.08, 0.9, 6), DARKWOOD), 0, 0.15, 0, i * 1.05); l.rotation.z = Math.PI / 2 + 0.3; g.add(l); }
    g.add(at(M(cone(0.32, 0.8, 7), '#ff8c1a', { emissive: '#ff5a00', ei: 1.6, flat: true, op: 0.9 }), 0, 0.5, 0)); g.add(at(M(cone(0.18, 0.5, 6), '#ffe26b', { emissive: '#ffcc00', ei: 2, flat: true, op: 0.9 }), 0, 0.55, 0)); return g; },
  banner: ({ M, cyl, box, G, at }) => { const g = G(); g.add(at(M(cyl(0.05, 0.06, 3.2, 6), DARKWOOD), 0, 1.6, 0)); g.add(at(M(box(0.9, 0.05, 0.05), DARKWOOD), 0.45, 3.1, 0)); g.add(at(M(box(0.8, 1.4, 0.03), '#b0243a', {}, true), 0.48, 2.4, 0)); g.add(at(M(cyl(0.08, 0.08, 0.16, 6), '#d4af37', { metal: 0.7, rough: 0.3 }), 0, 3.25, 0)); return g; },
  signpost: ({ M, cyl, box, G, at }) => { const g = G(); g.add(at(M(cyl(0.06, 0.07, 2.0, 6), WOOD), 0, 1.0, 0)); g.add(at(M(box(1.2, 0.35, 0.06), '#b58d5c'), 0.4, 1.7, 0, 0.3)); g.add(at(M(box(1.0, 0.3, 0.06), '#b58d5c'), -0.35, 1.25, 0, -0.5)); return g; },

  /* ── Ruins ── */
  ruintower: ({ M, box, G, at, rnd }) => { const g = G(); const H = 14; g.add(at(M(box(5, H, 5), CONC, {}, true), 0, H / 2, 0));
    for (let f = 0; f < 5; f++) for (let w = -1; w <= 1; w++) { g.add(at(M(box(0.9, 1.1, 0.1), GLASS, { rough: 0.3, metal: 0.2 }), w * 1.5, 1.6 + f * 2.6, 2.52)); g.add(at(M(box(0.1, 1.1, 0.9), GLASS, { rough: 0.3, metal: 0.2 }), 2.52, 1.6 + f * 2.6, w * 1.5)); }
    // the broken crown: three slabs left standing at different heights
    g.add(at(M(box(1.6, 3.2, 0.5), DARKCONC), -1.7, H + 1.6, -2.2)); g.add(at(M(box(0.5, 2.0, 2.2), DARKCONC), 2.2, H + 1.0, 1.0)); g.add(at(M(box(1.0, 1.2, 1.0), DARKCONC), 0.5, H + 0.6, -0.5));
    for (let i = 0; i < 6; i++) g.add(at(M(box(0.6 + rnd(), 0.4, 0.6 + rnd()), DARKCONC, { flat: true }), 3 + rnd() * 2, 0.2, (rnd() - 0.5) * 6, rnd() * 3)); return g; },
  collapsed: ({ M, box, ico, jag, G, at, rnd }) => { const g = G(); const s = at(M(box(7, 5, 4), CONC, {}, true), 0, 2.2, 0); s.rotation.z = -0.28; s.rotation.x = 0.06; g.add(s);
    g.add(at(M(box(3, 2.4, 4.1), DARKCONC), -3.6, 1.2, 0)); for (let i = 0; i < 7; i++) g.add(at(M(jag(ico(0.5 + rnd() * 0.4, 0), 0.4), DARKCONC, { flat: true }), 3 + rnd() * 3, 0.35, (rnd() - 0.5) * 5)); g.add(at(M(box(0.15, 3, 0.15), RUST), 3.2, 3.6, 0.8)).rotation.z = 0.5; return g; },
  rubble: ({ M, ico, box, jag, G, at, rnd }) => { const g = G(); for (let i = 0; i < 10; i++) { const r = 0.25 + rnd() * 0.5; g.add(at(M(jag(ico(r, 0), 0.5), rnd() < 0.5 ? DARKCONC : CONC, { flat: true }), (rnd() - 0.5) * 2.4, r * 0.7, (rnd() - 0.5) * 2.4, rnd() * 3)); }
    g.add(at(M(box(1.6, 0.25, 0.9), CONC), 0.3, 0.9, -0.2, 0.4)).rotation.z = 0.35; g.add(at(M(box(0.08, 1.4, 0.08), RUST), -0.5, 0.7, 0.4)).rotation.x = 0.6; return g; },
  road: ({ M, box, G, at, rnd }) => { const g = G(); g.add(at(M(box(8, 0.16, 4), ASPH, { rough: 1 }), 0, 0.08, 0)); for (let i = 0; i < 4; i++) g.add(at(M(box(1.1, 0.02, 0.14), '#b8a340'), -3 + i * 2, 0.17, 0));
    for (let i = 0; i < 5; i++) { const c = at(M(box(0.9 + rnd() * 1.2, 0.03, 0.06), SOOT), (rnd() - 0.5) * 7, 0.17, (rnd() - 0.5) * 3.4, rnd() * 3); g.add(c); } g.add(at(M(box(0.8, 0.02, 0.6), '#2b2d31'), 2.5, 0.17, -1.2, 0.3)); return g; },
  overpass: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(10, 0.6, 4), CONC), 0, 4.3, 0)); [-3.5, 3.5].forEach(x => g.add(at(M(box(1.2, 4.0, 1.2), DARKCONC), x, 2.0, 0)));
    g.add(at(M(box(10, 0.5, 0.15), CONC), 0, 4.85, 1.95)); g.add(at(M(box(6, 0.5, 0.15), CONC), -2, 4.85, -1.95)); g.add(at(M(box(1.5, 0.6, 1.5), DARKCONC), 5.6, 0.3, 0.8, 0.4)); return g; },
  wreckcar: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(3.8, 0.7, 1.7), '#6e2b1f', { rough: 0.9 }, true), 0, 0.7, 0)); const cab = at(M(box(2.0, 0.6, 1.5), '#5a2418', { rough: 0.9 }, true), -0.2, 1.3, 0); cab.rotation.z = 0.06; g.add(cab);
    g.add(at(M(box(1.8, 0.45, 1.52), GLASS, { rough: 0.2 }), -0.2, 1.3, 0)); [[-1.3, 0.85], [1.3, 0.85], [-1.3, -0.85], [1.3, -0.85]].forEach(([x, z], i) => { const w = at(M(cyl(0.34, 0.34, 0.25, 12), SOOT), x, i === 1 ? 0.2 : 0.34, z); w.rotation.x = Math.PI / 2; g.add(w); }); g.add(at(M(box(0.9, 0.3, 1.2), RUST), 1.6, 1.15, 0)).rotation.z = 0.5; return g; },
  lamppost: ({ M, cyl, box, G, at }) => { const g = G(); g.add(at(M(cyl(0.08, 0.11, 3.6, 8), IRON, { metal: 0.5, rough: 0.6 }), 0, 1.8, 0)); const arm = at(M(cyl(0.06, 0.08, 2.4, 8), IRON, { metal: 0.5, rough: 0.6 }), 0.9, 4.2, 0); arm.rotation.z = -1.0; g.add(arm);
    g.add(at(M(box(0.6, 0.25, 0.3), SOOT), 1.85, 4.85, 0, 0.2)); g.add(at(M(box(0.3, 0.3, 0.3), IRON), 0, 0.15, 0)); return g; },
  barrier: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(3, 0.35, 0.7), CONC), 0, 0.17, 0)); g.add(at(M(box(3, 0.55, 0.45), CONC), 0, 0.6, 0)); g.add(at(M(box(3, 0.2, 0.28), DARKCONC), 0, 0.98, 0)); g.add(at(M(box(0.9, 0.04, 0.46), '#b8a340'), -0.8, 0.9, 0)); return g; },
  barricade: ({ M, box, sph, G, at, rnd }) => { const g = G(); for (let i = 0; i < 8; i++) { const b = at(M(sph(0.36, 7), '#6f6a55', { flat: true }), -1.2 + (i % 4) * 0.8, 0.3 + Math.floor(i / 4) * 0.5, (i % 2) * 0.25, rnd()); b.scale.y = 0.65; g.add(b); }
    g.add(at(M(box(2.6, 0.12, 0.12), DARKWOOD), 0, 1.25, -0.4)).rotation.z = 0.15; g.add(at(M(box(0.12, 1.4, 0.12), DARKWOOD), -1.2, 0.7, -0.4)); g.add(at(M(box(0.12, 1.2, 0.12), DARKWOOD), 1.1, 0.6, -0.4)); g.add(at(M(box(0.05, 0.05, 1.8), RUST), 0.3, 1.35, -0.3, 0.5)); return g; },
  container: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(6, 2.6, 2.4), '#8a4a2e', { rough: 0.85 }, true), 0, 1.3, 0)); for (let i = 0; i < 7; i++) g.add(at(M(box(0.12, 2.5, 2.5), '#6f3a22', { rough: 0.9 }, true), -2.7 + i * 0.9, 1.3, 0)); g.add(at(M(box(0.1, 2.2, 1.0), SOOT), 3.02, 1.2, -0.5)); return g; },
  radiotower: ({ M, cyl, box, sph, G, at }) => { const g = G(); const H = 12; [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]].forEach(([x, z]) => { const leg = at(M(cyl(0.05, 0.08, H, 6), IRON, { metal: 0.6, rough: 0.5 }), x * 0.55, H / 2, z * 0.55); leg.rotation.x = -z * 0.06; leg.rotation.z = x * 0.06; g.add(leg); });
    for (let y = 2; y < H; y += 2.5) g.add(at(M(box(1.5 - y * 0.08, 0.06, 1.5 - y * 0.08), IRON, { metal: 0.6, rough: 0.5 }), 0, y, 0)); g.add(at(M(cyl(0.03, 0.03, 3, 5), IRON), 0, H + 1.4, 0)); g.add(at(M(sph(0.16, 8), '#ff3b3b', { emissive: '#ff1a1a', ei: 1.6 }), 0, H + 2.9, 0)); return g; },
  billboard: ({ M, box, cyl, G, at }) => { const g = G(); [-1.6, 1.6].forEach(x => g.add(at(M(cyl(0.12, 0.14, 5, 8), IRON, { metal: 0.5, rough: 0.6 }), x, 2.5, 0))); const p = at(M(box(6, 3, 0.15), '#c9b79c', { rough: 0.95 }), 0, 6.2, 0); p.rotation.x = -0.08; g.add(p);
    g.add(at(M(box(2.2, 1.2, 0.17), '#a13b2c'), -1.2, 6.5, 0)); g.add(at(M(box(1.6, 0.5, 0.17), '#2c3e50'), 1.4, 5.6, 0)); const torn = at(M(box(1.6, 1.4, 0.16), '#8f8271'), 2.5, 5.0, 0.1); torn.rotation.z = 0.5; g.add(torn); return g; },
  burnttree: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(0.12, 0.28, 3.0, 6), SOOT, { rough: 1 }), 0, 1.5, 0)); const b1 = at(M(cyl(0.04, 0.09, 1.4, 5), SOOT), 0.4, 2.7, 0); b1.rotation.z = -1.0; g.add(b1); const b2 = at(M(cyl(0.03, 0.07, 1.0, 5), SOOT), -0.3, 2.2, 0.2); b2.rotation.z = 0.9; b2.rotation.x = 0.5; g.add(b2); g.add(at(M(cyl(0.6, 0.7, 0.06, 10), '#2a2a2a'), 0, 0.03, 0)); return g; },
  drum: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(0.3, 0.3, 0.9, 12), '#7a3b1e', { rough: 0.9 }, true), 0, 0.45, 0)); [0.2, 0.7].forEach(y => g.add(at(M(cyl(0.31, 0.31, 0.04, 12), SOOT), 0, y, 0))); g.add(at(M(cyl(0.28, 0.28, 0.02, 12), '#b8a340'), 0, 0.91, 0)); return g; },
  scrap: ({ M, box, cyl, ico, jag, G, at, rnd }) => { const g = G(); for (let i = 0; i < 9; i++) { const kind = rnd(); const m = kind < 0.4 ? M(box(0.3 + rnd(), 0.06, 0.4 + rnd() * 0.6), RUST, { metal: 0.4, rough: 0.7 }) : kind < 0.7 ? M(cyl(0.05, 0.05, 0.8 + rnd(), 5), IRON, { metal: 0.6, rough: 0.5 }) : M(jag(ico(0.3, 0), 0.5), '#5a5147', { metal: 0.3, flat: true });
    at(m, (rnd() - 0.5) * 2, 0.2 + rnd() * 0.6, (rnd() - 0.5) * 2, rnd() * 3); m.rotation.x = rnd(); m.rotation.z = rnd(); g.add(m); } g.add(at(M(cyl(0.34, 0.34, 0.25, 12), SOOT), 0.7, 0.34, 0.5)).rotation.x = Math.PI / 2; return g; },
  crater: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(4.4, 3.6, 0.5, 24, true), '#4a3d30', { flat: true }), 0, 0.25, 0)); g.add(at(M(cyl(3.6, 3.6, 0.04, 24), '#2a2320'), 0, 0.02, 0)); g.add(at(M(cyl(1.4, 1.4, 0.06, 18), '#3a5a2a', { emissive: '#3aa02a', ei: 0.25 }), 0, 0.05, 0)); return g; },
  generator: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(2.2, 1.4, 1.2), '#4a5563', { metal: 0.4, rough: 0.6 }, true), 0, 0.7, 0)); for (let i = 0; i < 4; i++) g.add(at(M(box(0.06, 1.0, 0.9), '#ff8a1a', { emissive: '#ff6a00', ei: 0.9 }), -0.75 + i * 0.5, 0.7, 0.62));
    g.add(at(M(cyl(0.12, 0.12, 1.0, 8), IRON), 0.8, 1.9, -0.3)); g.add(at(M(cyl(0.25, 0.25, 0.4, 10), IRON), -0.7, 1.6, -0.2)); g.add(at(M(box(0.5, 0.06, 0.5), '#3fd1ff', { emissive: '#1ab8ff', ei: 1.4 }), -0.7, 1.83, -0.2)); return g; },
  pylon: ({ M, cyl, sph, box, G, at }) => { const g = G(); g.add(at(M(box(1.4, 0.3, 1.4), DARKCONC), 0, 0.15, 0)); g.add(at(M(cyl(0.18, 0.28, 6, 8), '#3a4658', { metal: 0.5, rough: 0.5 }), 0, 3.15, 0));
    [2.2, 4.0, 5.6].forEach(y => g.add(at(M(cyl(0.5, 0.5, 0.12, 20, true), NEON, { emissive: NEON, ei: 1.5, op: 0.9 }, true), 0, y, 0))); g.add(at(M(sph(0.45, 14), NEON, { emissive: NEON, ei: 2.2, op: 0.85, rough: 0.1 }, true), 0, 7.0, 0)); return g; },
  dronewreck: ({ M, box, cyl, G, at }) => { const g = G(); const b = at(M(box(1.2, 0.35, 1.2), '#3b4148', { metal: 0.5, rough: 0.5 }), 0, 0.4, 0, 0.4); b.rotation.z = 0.25; g.add(b);
    [[1, 1], [-1, 1], [1, -1]].forEach(([x, z]) => { const arm = at(M(box(1.0, 0.08, 0.12), IRON), x * 0.9, 0.5, z * 0.9, Math.atan2(z, x)); arm.rotation.z = 0.2 * x; g.add(arm); const rot = at(M(cyl(0.45, 0.45, 0.03, 12), SOOT, { op: 0.8 }), x * 1.35, 0.62, z * 1.35); g.add(rot); });
    g.add(at(M(box(0.3, 0.12, 0.3), '#ff3b3b', { emissive: '#ff1a1a', ei: 1.2 }), 0, 0.62, 0)); g.add(at(M(box(0.6, 0.06, 0.1), IRON), -1.4, 0.05, -1.2, 0.7)); return g; },
  bunker: ({ M, box, cyl, G, at }) => { const g = G(); g.add(at(M(box(4, 3.2, 1.2), CONC), 0, 1.6, 0)); g.add(at(M(box(1.6, 2.4, 0.2), '#3a4148', { metal: 0.6, rough: 0.5 }), 0, 1.2, 0.68)); g.add(at(M(cyl(0.22, 0.22, 0.1, 12), '#ffd23f', { emissive: '#e0a800', ei: 0.9 }), 0, 1.2, 0.8)).rotation.x = Math.PI / 2;
    g.add(at(M(box(0.6, 0.2, 0.1), '#ff3b3b', { emissive: '#ff1a1a', ei: 1.0 }), 0, 2.8, 0.66)); g.add(at(M(box(4.4, 0.4, 1.6), DARKCONC), 0, 3.4, 0)); return g; },
  sfcrate: ({ M, box, G, at }) => { const g = G(); g.add(at(M(box(1.2, 1.0, 1.2), '#4b5563', { metal: 0.3, rough: 0.6 }, true), 0, 0.5, 0)); [-0.5, 0.5].forEach(x => g.add(at(M(box(0.12, 1.04, 1.24), '#2b3038'), x, 0.5, 0))); g.add(at(M(box(0.5, 0.05, 0.05), NEON, { emissive: NEON, ei: 1.3 }), 0, 0.75, 0.62)); g.add(at(M(box(0.3, 0.3, 0.02), '#ffb347', { emissive: '#ff8a00', ei: 0.6 }), 0, 0.4, 0.62)); return g; },

  spawn: ({ M, cyl, cone, G, at }) => { const g = G(); g.add(at(M(cyl(0.9, 0.9, 0.08, 24), '#42d77d', { emissive: '#1f9a4f', ei: 0.7, op: 0.75 }), 0, 0.04, 0)); g.add(at(M(cone(0.35, 0.9, 4), '#42d77d', { emissive: '#1f9a4f', ei: 0.7, op: 0.85, flat: true }), 0, 1.4, 0)).rotation.x = Math.PI; g.add(at(M(cyl(0.05, 0.05, 2.0, 6), '#42d77d', { emissive: '#1f9a4f', ei: 0.7 }), 0, 1.0, 0)); g.add(at(M(cone(0.25, 0.5, 6), '#42d77d', { emissive: '#1f9a4f', ei: 0.9, flat: true }), 0, 0.3, 0.65)).rotation.x = Math.PI / 2; return g; },
  enemy: ({ M, cyl, cone, sph, G, at }) => { const g = G(); g.add(at(M(cyl(0.9, 0.9, 0.08, 24), '#ff4d6d', { emissive: '#b3122f', ei: 0.7, op: 0.75 }), 0, 0.04, 0)); g.add(at(M(sph(0.35, 8), '#ff4d6d', { emissive: '#b3122f', ei: 0.8, flat: true, op: 0.9 }), 0, 1.5, 0)); g.add(at(M(cyl(0.05, 0.05, 1.3, 6), '#ff4d6d', { emissive: '#b3122f', ei: 0.7 }), 0, 0.65, 0)); return g; },
  waypoint: ({ M, cyl, cone, G, at }) => { const g = G(); g.add(at(M(cyl(0.5, 0.5, 0.06, 20), '#ffd23f', { emissive: '#c99a00', ei: 0.7, op: 0.8 }), 0, 0.03, 0)); const c = at(M(cone(0.3, 0.8, 8), '#ffd23f', { emissive: '#c99a00', ei: 0.8, op: 0.9 }), 0, 1.2, 0); c.rotation.x = Math.PI; g.add(c); return g; },
  zone: ({ M, cyl, G, at }) => { const g = G(); g.add(at(M(cyl(5, 5, 0.05, 40), '#3fa9ff', { emissive: '#1a5fb3', ei: 0.6, op: 0.28 }), 0, 0.03, 0)); g.add(at(M(cyl(5.05, 5.05, 0.12, 40, true), '#3fa9ff', { emissive: '#1a5fb3', ei: 1.0, op: 0.8 }), 0, 0.06, 0)); return g; },
};
