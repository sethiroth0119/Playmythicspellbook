/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.format.js — the World Forge map document. Pure data, no THREE.

   A map is ONE JSON object (schema `v: 1`). Everything the runtime needs to
   rebuild the scene is in here — terrain heights, paint layers, water, sky,
   every placed object — so a map is a self-contained file that can be saved
   to Supabase, kept in localStorage, or exported and re-imported as JSON.

   WHY a heightfield rather than free meshes: it keeps the file small (a 64×64
   map is ~40 KB), gives a cheap heightAt(x,z) for walking, and is what every
   engine's terrain tool does underneath. Objects sit ON the field; they never
   deform it.

   Coordinates: metres, Y up, terrain centred on the origin. Object rotation is
   Euler XYZ in radians (stored as-is from three.js), scale is per-axis.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MAP_VERSION = 1;

// Paint layers. Index is what gets stored per vertex — never reorder this
// list, only append, or every saved map's paint shifts.
export const PAINT = [
  { id: 'grass',  label: 'Grass',      color: '#5a8f3c' },
  { id: 'meadow', label: 'Dark grass', color: '#3f6e2a' },
  { id: 'dirt',   label: 'Dirt',       color: '#8a6a44' },
  { id: 'sand',   label: 'Sand',       color: '#d9c58a' },
  { id: 'rock',   label: 'Rock',       color: '#7b7d80' },
  { id: 'snow',   label: 'Snow',       color: '#e9eef2' },
  { id: 'path',   label: 'Stone path', color: '#9b968a' },
  { id: 'mud',    label: 'Mud',        color: '#5b4a35' },
  { id: 'ash',    label: 'Ash',        color: '#3a3a3a' },
  { id: 'ember',  label: 'Ember',      color: '#c2451c' },
  // post-apocalyptic city set (appended — never reorder)
  { id: 'asphalt',  label: 'Asphalt',   color: '#3d3f44' },
  { id: 'concrete', label: 'Concrete',  color: '#8d8a84' },
  { id: 'rust',     label: 'Rust',      color: '#7a3b1e' },
  { id: 'toxic',    label: 'Toxic',     color: '#5fbf3a' },
  { id: 'soot',     label: 'Soot',      color: '#1f2022' },
];

export const ENV_PRESETS = {
  day:      { skyTop: '#3f7fd6', skyBottom: '#cfe6ff', fogColor: '#c9dcf2', fogNear: 60,  fogFar: 320, sunEl: 55, sunAz: 40,  sunIntensity: 1.25, sunColor: '#fff4dc', ambient: '#8fb4ff', ambientIntensity: 0.55, groundColor: '#5c4a2f' },
  dawn:     { skyTop: '#4a4f9e', skyBottom: '#ffb27a', fogColor: '#e8b48f', fogNear: 40,  fogFar: 260, sunEl: 12, sunAz: 100, sunIntensity: 1.0,  sunColor: '#ffc38a', ambient: '#8d7cc0', ambientIntensity: 0.5,  groundColor: '#4a3a2a' },
  dusk:     { skyTop: '#2c2352', skyBottom: '#ff8a5c', fogColor: '#c47a62', fogNear: 40,  fogFar: 240, sunEl: 8,  sunAz: 260, sunIntensity: 0.9,  sunColor: '#ff9e6a', ambient: '#6a5aa8', ambientIntensity: 0.45, groundColor: '#3b2e22' },
  night:    { skyTop: '#050716', skyBottom: '#16223f', fogColor: '#0e1526', fogNear: 30,  fogFar: 200, sunEl: 35, sunAz: 200, sunIntensity: 0.35, sunColor: '#a9c4ff', ambient: '#3b4b7a', ambientIntensity: 0.35, groundColor: '#0f1420' },
  overcast: { skyTop: '#6b7280', skyBottom: '#b8bec8', fogColor: '#aeb4bd', fogNear: 30,  fogFar: 220, sunEl: 60, sunAz: 0,   sunIntensity: 0.55, sunColor: '#e8ecf2', ambient: '#aab4c4', ambientIntensity: 0.75, groundColor: '#4a4a44' },
  // the wasteland: dust-choked afternoon, sun a dull coin behind haze
  wasteland:{ skyTop: '#6e5a48', skyBottom: '#c9a274', fogColor: '#b8946a', fogNear: 18,  fogFar: 150, sunEl: 28, sunAz: 230, sunIntensity: 0.8,  sunColor: '#ffb86b', ambient: '#8a7a68', ambientIntensity: 0.6,  groundColor: '#3a2f26' },
  // after the fallout: green-tinged night, everything lit from the sky
  fallout:  { skyTop: '#06110c', skyBottom: '#1f3a2a', fogColor: '#132419', fogNear: 15,  fogFar: 120, sunEl: 40, sunAz: 120, sunIntensity: 0.3,  sunColor: '#9be7a7', ambient: '#3f6b4e', ambientIntensity: 0.5,  groundColor: '#0e1a12' },
};

export function uid(prefix) {
  return (prefix || 'o') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function newMap(opts) {
  opts = opts || {};
  const n = clampInt(opts.n, 16, 160, 64);
  const cell = clampNum(opts.cell, 0.5, 8, 2);
  const verts = (n + 1) * (n + 1);
  return {
    v: MAP_VERSION,
    id: opts.id || uid('map_'),
    name: opts.name || 'Untitled world',
    description: '',
    game: String(opts.game || 'sandbox').slice(0, 40),   // which mini-game this world belongs to
    terrain: {
      n, cell,
      heights: new Array(verts).fill(0),
      paint: new Array(verts).fill(0),
    },
    water: { on: true, level: -0.6, color: '#2e6f9e', opacity: 0.78, wave: 0.12, speed: 1 },
    env: Object.assign({ preset: 'day', shadows: true, weather: 'none', weatherIntensity: 1, windDir: 45, windSpeed: 1.5 }, ENV_PRESETS.day),
    assets: [],
    objects: [],
    meta: { created: Date.now(), updated: Date.now(), author: opts.author || '' },
  };
}

/* Bring ANY parsed JSON into a valid v1 document. Every field gets a default,
   arrays are re-sized to the grid, numbers are clamped — so an old export,
   a hand-edited file, or a row from a future schema never crashes the
   editor; the worst case is a flat map. */
export function normalize(raw) {
  const base = newMap();
  if (!raw || typeof raw !== 'object') return base;
  const m = base;
  m.id = typeof raw.id === 'string' && raw.id ? raw.id : m.id;
  m.name = String(raw.name || m.name).slice(0, 80);
  m.description = String(raw.description || '').slice(0, 2000);
  m.game = gameId(raw.game) || 'sandbox';

  const t = raw.terrain || {};
  const n = clampInt(t.n, 16, 160, 64);
  const cell = clampNum(t.cell, 0.5, 8, 2);
  const verts = (n + 1) * (n + 1);
  const heights = Array.isArray(t.heights) ? t.heights : [];
  const paint = Array.isArray(t.paint) ? t.paint : [];
  m.terrain = {
    n, cell,
    heights: Array.from({ length: verts }, (_, i) => clampNum(heights[i], -200, 200, 0)),
    paint: Array.from({ length: verts }, (_, i) => clampInt(paint[i], 0, PAINT.length - 1, 0)),
  };

  const w = raw.water || {};
  m.water = {
    on: w.on !== false,
    level: clampNum(w.level, -200, 200, -0.6),
    color: hex(w.color, '#2e6f9e'),
    opacity: clampNum(w.opacity, 0, 1, 0.78),
    wave: clampNum(w.wave, 0, 2, 0.12),
    speed: clampNum(w.speed, 0, 5, 1),
  };

  const e = raw.env || {};
  const preset = ENV_PRESETS[e.preset] ? e.preset : 'day';
  const p = ENV_PRESETS[preset];
  m.env = {
    preset,
    shadows: e.shadows !== false,
    skyTop: hex(e.skyTop, p.skyTop), skyBottom: hex(e.skyBottom, p.skyBottom),
    fogColor: hex(e.fogColor, p.fogColor),
    fogNear: clampNum(e.fogNear, 1, 2000, p.fogNear), fogFar: clampNum(e.fogFar, 2, 4000, p.fogFar),
    sunEl: clampNum(e.sunEl, -10, 90, p.sunEl), sunAz: clampNum(e.sunAz, 0, 360, p.sunAz),
    sunIntensity: clampNum(e.sunIntensity, 0, 4, p.sunIntensity), sunColor: hex(e.sunColor, p.sunColor),
    ambient: hex(e.ambient, p.ambient), ambientIntensity: clampNum(e.ambientIntensity, 0, 3, p.ambientIntensity),
    groundColor: hex(e.groundColor, p.groundColor),
    // weather + wind (mapforge.vfx.js); wind also pushes emitter smoke
    weather: ['rain', 'storm', 'snow', 'ash', 'duststorm'].includes(e.weather) ? e.weather : 'none',
    weatherIntensity: clampNum(e.weatherIntensity, 0.1, 3, 1),
    windDir: clampNum(e.windDir, 0, 360, 45), windSpeed: clampNum(e.windSpeed, 0, 20, 1.5),
  };

  /* An asset is EITHER a URL (a file under /models/ or any CORS-enabled host)
     OR an embedded .glb (`data`, base64) dropped in from disk. `anims` caches
     the clip names found in the file so the inspector can list them before
     the model has loaded. */
  m.assets = (Array.isArray(raw.assets) ? raw.assets : []).map(a => a && typeof a === 'object' ? ({
    id: String(a.id || uid('a_')), label: String(a.label || 'Model').slice(0, 60),
    url: a.url ? String(a.url).slice(0, 1000) : undefined,
    data: (typeof a.data === 'string' && a.data.length) ? a.data : undefined,
    anims: Array.isArray(a.anims) ? a.anims.map(x => String(x).slice(0, 80)).slice(0, 64) : undefined,
    size: Number.isFinite(+a.size) ? +a.size : undefined,
  }) : null).filter(a => a && (a.url || a.data));

  const assetIds = new Set(m.assets.map(a => a.id));
  m.objects = (Array.isArray(raw.objects) ? raw.objects : []).map(o => normalizeObject(o, assetIds)).filter(Boolean);

  const meta = raw.meta || {};
  m.meta = { created: +meta.created || Date.now(), updated: +meta.updated || Date.now(), author: String(meta.author || '').slice(0, 80) };
  return m;
}

export function normalizeObject(o, assetIds) {
  if (!o || typeof o !== 'object' || !o.t) return null;
  const t = String(o.t);
  if (t === 'glb' && assetIds && !assetIds.has(o.a)) return null;   // orphaned model reference
  return {
    id: String(o.id || uid('o_')),
    t,
    a: t === 'glb' ? String(o.a) : undefined,
    p: vec3(o.p, [0, 0, 0]),
    r: vec3(o.r, [0, 0, 0]),
    s: vec3(o.s, [1, 1, 1]),
    c: o.c ? hex(o.c, null) || undefined : undefined,
    n: o.n ? String(o.n).slice(0, 60) : undefined,
    g: o.g !== false,
    anim: normalizeAnim(o.anim),
    // collision: undefined = the prop's default (see PROP_CATALOG.col), true/false = the builder's choice
    col: typeof o.col === 'boolean' ? o.col : undefined,
    cs: o.cs === 'cyl' ? 'cyl' : undefined,          // collider shape: box (default) or cylinder
    fx: normalizeFx(o.fx),                            // emitter tuning for fx_* objects / attached effects
  };
}

export function normalizeFx(f) {
  if (!f || typeof f !== 'object') return undefined;
  const out = { i: clampNum(f.i, 0.1, 4, 1), s: clampNum(f.s, 0.2, 6, 1) };
  if (f.off === true) out.off = true;        // a prop's built-in effect switched off
  return out;
}
export const LOOP_MODES = ['repeat', 'once', 'pingpong'];
export function normalizeAnim(a) {
  if (!a || typeof a !== 'object' || !a.clip) return undefined;
  return { clip: String(a.clip).slice(0, 80), speed: clampNum(a.speed, 0, 8, 1), loop: LOOP_MODES.includes(a.loop) ? a.loop : 'repeat' };
}
export function gameId(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

/* Bytes of an asset as stored: embedded data dominates. Used for the
   "this map is getting heavy" warnings and the cloud row cap. */
export function assetBytes(a) { return a && a.data ? Math.round(a.data.length * 0.75) : 0; }
export function embeddedBytes(m) { return (m.assets || []).reduce((n, a) => n + assetBytes(a), 0); }

/* Deep copy suitable for storage/export. Heights are rounded to cm so the
   JSON stays compact without visibly changing the terrain. */
export function serialize(m) {
  const out = JSON.parse(JSON.stringify(m));
  out.terrain.heights = out.terrain.heights.map(h => Math.round(h * 100) / 100);
  out.meta = out.meta || {};
  out.meta.updated = Date.now();
  return out;
}

export function clone(m) { return JSON.parse(JSON.stringify(m)); }

/* Resample the heightfield onto a new grid (bilinear), used by "Resize". */
export function resampleTerrain(t, n2, cell2) {
  const n1 = t.n, c1 = t.cell, half1 = n1 * c1 / 2, half2 = n2 * cell2 / 2;
  const heights = new Array((n2 + 1) * (n2 + 1)), paint = new Array((n2 + 1) * (n2 + 1));
  for (let r = 0; r <= n2; r++) for (let c = 0; c <= n2; c++) {
    const x = -half2 + c * cell2, z = -half2 + r * cell2;
    const gx = Math.min(Math.max((x + half1) / c1, 0), n1), gz = Math.min(Math.max((z + half1) / c1, 0), n1);
    const c0 = Math.floor(gx), r0 = Math.floor(gz), c1i = Math.min(c0 + 1, n1), r1i = Math.min(r0 + 1, n1);
    const fx = gx - c0, fz = gz - r0;
    const i00 = r0 * (n1 + 1) + c0, i10 = r0 * (n1 + 1) + c1i, i01 = r1i * (n1 + 1) + c0, i11 = r1i * (n1 + 1) + c1i;
    const h = (t.heights[i00] * (1 - fx) + t.heights[i10] * fx) * (1 - fz) + (t.heights[i01] * (1 - fx) + t.heights[i11] * fx) * fz;
    const i = r * (n2 + 1) + c;
    heights[i] = h;
    paint[i] = t.paint[fx < 0.5 ? (fz < 0.5 ? i00 : i01) : (fz < 0.5 ? i10 : i11)];
  }
  return { n: n2, cell: cell2, heights, paint };
}

/* Deterministic value noise for the terrain generators — seeded so "Random
   hills" with the same seed gives the same map on every device. */
export function makeNoise(seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const P = 256, perm = new Uint8Array(P * 2), grid = new Float32Array(P);
  for (let i = 0; i < P; i++) perm[i] = i;
  for (let i = P - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < P; i++) perm[i + P] = perm[i];
  for (let i = 0; i < P; i++) grid[i] = rnd();
  const lat = (x, y) => grid[perm[perm[x & 255] + (y & 255)]];
  const fade = t => t * t * (3 - 2 * t);
  const v2 = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0);
    const a = lat(x0, y0), b = lat(x0 + 1, y0), c = lat(x0, y0 + 1), d = lat(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  // fractal sum, returns roughly -1..1
  return (x, y, octaves) => {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < (octaves || 4); o++) { sum += (v2(x * freq, y * freq) * 2 - 1) * amp; norm += amp; amp *= 0.5; freq *= 2.1; }
    return sum / norm;
  };
}

/* ── tiny validators ── */
function clampNum(v, lo, hi, def) { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; }
function clampInt(v, lo, hi, def) { return Math.round(clampNum(v, lo, hi, def)); }
function hex(v, def) { return (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v.toLowerCase() : def; }
function vec3(v, def) { return Array.isArray(v) && v.length === 3 ? v.map((x, i) => clampNum(x, -10000, 10000, def[i])) : def.slice(); }
