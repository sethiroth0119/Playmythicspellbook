/* ════════════════════════════════════════════════════════════════════════════
   ⚔ BATTLE BOARD ↔ ⚒ ATHENA ENGINE — the live battle board as a GAME SCENE.
   ----------------------------------------------------------------------------
   The board everyone fights on is a v3 battlemap document
   (`{ v:3, cols, rows, terrain:[cols*rows keys, column-major], glbSlots, models:[{t,x,z,rot,sc}] }`,
   kept on Forge.battleMap3d.active and published with the catalogue). This
   module opens it inside Athena and writes edits back:

   1. ADAPTER (board → Athena). build() turns the v3 doc into an Athena map:
      the board's cells become a terrain painted with the nearest Athena
      layer per cell; every placed board model becomes a 🧩 slot object
      (`k = 'bm.<index>'`) drawn with the board's OWN procedural builder
      (bridge.battle.buildProp — same r128 THREE) so the editor shows the
      real props, not placeholders. Units: BOARD_ATHENA_SCALE (3) metres per
      board cell, so metre-scaled Athena props look right next to them.

   2. WRITE-BACK (Athena → board). On Save the edited map is converted back:
      terrain paint → board terrain keys (sampled at each cell centre),
      slot transforms → model x/z/rot/sc, deleted slots → removed models.
      On ★ Live it is also published to every player (bridge.battle.publish).
      Whatever v3 cannot express — extra props, splines, .glb models, a slot
      REPLACED by another prop — stays in the Athena map and reaches the live
      board through the overlay hook in _b3dBuild (index.html), which draws
      the group at 1/3 scale and hides a replaced board model.

   Everything goes through window.MythicBridge.battle (never Forge directly —
   the globals trap) and degrades: no bridge → the adapter is not registered;
   no Athena → the board draws exactly as before.
   ════════════════════════════════════════════════════════════════════════════ */

export const BATTLE_GAME_ID = 'battle';
const SLOT_PREFIX = 'bm.';

function bridge() { try { return (window.MythicBridge && window.MythicBridge.battle) || null; } catch (e) { return null; } }
function uid(p) { return (p || 'o') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function scaleK() { const b = bridge(); try { return (b && b.scale && b.scale()) || 3; } catch (e) { return 3; } }

/* Board terrain key ↔ Athena paint layer (index into mapforge.format PAINT,
   append-only there: 0 grass 1 dark grass 2 dirt 3 sand 4 rock 5 snow 6 stone
   path 7 mud 8 ash 9 ember 10 asphalt 11 concrete 12 rust 13 toxic 14 soot). */
export const TERRAIN_TO_PAINT = { road: 10, rubble: 11, dirt: 2, grass: 1, stone: 4, sand: 3, snow: 5, ash: 8, water: 7, blight: 13, lava: 9 };
export const PAINT_TO_TERRAIN = { 0: 'grass', 1: 'grass', 2: 'dirt', 3: 'sand', 4: 'stone', 5: 'snow', 6: 'stone', 7: 'water', 8: 'ash', 9: 'lava', 10: 'road', 11: 'rubble', 12: 'rubble', 13: 'blight', 14: 'ash' };
const PROP_ICON = { house: '🏚️', tower: '🗼', deadtree: '🪵', pine: '🌲', rock: '🪨', rubble: '🧱', wall: '🧱', fence: '🚧', gate: '🏛️', statue: '🗿', wreck: '🚗', crates: '📦', tent: '⛺', lamp: '💡', bonfire: '🔥', crystal: '💠', spawn: '✨', banner: '🚩' };

/* ── 1. board → Athena ─────────────────────────────────────────────────── */
export function buildBattleMap(v3, opts) {
  opts = opts || {};
  const b = bridge();
  const size = (b && b.size && b.size()) || { cols: 8, rows: 7 };
  const map = v3 || (b && b.getMap && b.getMap()) || { cols: size.cols, rows: size.rows, terrain: null, glbSlots: [], models: [] };
  const cols = map.cols || size.cols, rows = map.rows || size.rows, K = scaleK();
  const defT = (b && b.defaultTerrain && b.defaultTerrain()) || 'road';
  const n = Math.max(cols, rows) * K, cell = 1, half = n * cell / 2, W = n + 1;
  const HX = cols / 2, HZ = rows / 2;
  const at = (c, r) => { const t = map.terrain; if (!t) return defT; if (Array.isArray(t[c])) return t[c][r] || defT; return t[c * rows + r] || defT; };
  const heights = new Array(W * W).fill(0), paint = new Array(W * W).fill(TERRAIN_TO_PAINT[defT] == null ? 10 : TERRAIN_TO_PAINT[defT]);
  for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) {
    const x = -half + c * cell, z = -half + r * cell;                                  // Athena world (metres)
    const bc = Math.floor(x / K + HX), br = Math.floor(z / K + HZ);                     // board cell under this vertex
    if (bc < 0 || br < 0 || bc >= cols || br >= rows) continue;
    const key = at(bc, br); paint[r * W + c] = TERRAIN_TO_PAINT[key] == null ? 10 : TERRAIN_TO_PAINT[key];
  }
  const F_PROPS = 'f_bm_props', F_MODELS = 'f_bm_models';
  const labels = (b && b.props && b.props()) || {};
  const glbById = {}; (map.glbSlots || []).forEach(s => { if (s && s.id) glbById[s.id] = s; });
  const assets = (map.glbSlots || []).filter(s => s && s.url).map(s => ({ id: 'a_bm_' + s.id, label: s.label || s.id, url: s.url }));
  const objects = (map.models || []).map((m, i) => {
    if (!m) return null;
    const isGlb = !!glbById[m.t]; const meta = labels[m.t];
    const o = { id: 'o_bm_' + i, t: 'slot', k: SLOT_PREFIX + i, n: isGlb ? ((glbById[m.t].label || m.t) + ' #' + (i + 1)) : ((meta ? meta.label : m.t) + ' #' + (i + 1)),
      p: [m.x * K, 0, m.z * K], r: [0, (m.rot || 0) * Math.PI / 180, 0], s: [(m.sc || 1) * K, (m.sc || 1) * K, (m.sc || 1) * K], g: true, f: isGlb ? F_MODELS : F_PROPS };
    return o;
  }).filter(Boolean);
  return {
    v: 1, id: uid('map_'), name: 'Battle board', description: 'The live ' + cols + ' × ' + rows + ' battle board. Paint the ground (each layer maps to a board terrain), move / turn / scale the board\'s props, replace one with anything, or add more — Save writes the board, ★ Set live publishes it to every player.',
    game: BATTLE_GAME_ID,
    terrain: { n, cell, heights, paint },
    water: { on: false, level: -1, color: '#2e6f9e', opacity: 0.78, wave: 0.12, speed: 1 },
    env: { preset: 'dusk', shadows: true, weather: 'none' },
    assets,
    folders: [
      { id: F_PROPS, name: 'Board props', parent: null, open: true, vis: true, lock: false },
      { id: F_MODELS, name: 'Board models (.glb)', parent: null, open: true, vis: true, lock: false },
    ],
    objects,
    scene: { ground: false, water: false, sky: false },   // the board keeps its floor and lights; the overlay only adds
    meta: { created: Date.now(), updated: Date.now(), author: 'Battle board', board: { cols, rows, v3: map } },
  };
}

/* The stand-in Athena draws for a board slot: the board's own prop (or the
   placeholder for a .glb slot, which the world swaps for the model). Scaled
   to Athena units by the slot's `s` (already × K), so the builder's 1-unit
   props come out K metres — the same relative size as on the board. */
export function slotBody(o, THREE) {
  const b = bridge(); if (!b || !b.buildProp) return null;
  const v3 = currentV3(); if (!v3) return null;
  const idx = slotIndex(o.k); const m = v3.models && v3.models[idx]; if (!m) return null;
  try { const body = b.buildProp(m.t); if (body) { body.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } }); return body; } } catch (e) {}
  return null;
}
function slotIndex(k) { return /^bm\.(\d+)$/.test(k || '') ? +k.slice(SLOT_PREFIX.length) : -1; }
let lastV3 = null;
function currentV3() { const b = bridge(); try { lastV3 = (b && b.getMap && b.getMap()) || lastV3; } catch (e) {} return lastV3; }

/* ── 2. Athena → board ─────────────────────────────────────────────────── */
export function toBoardMap(athena, prev) {
  const b = bridge();
  const base = prev || (athena.meta && athena.meta.board && athena.meta.board.v3) || (b && b.getMap && b.getMap()) || {};
  const size = (b && b.size && b.size()) || { cols: 8, rows: 7 };
  const cols = base.cols || size.cols, rows = base.rows || size.rows, K = scaleK();
  const defT = (b && b.defaultTerrain && b.defaultTerrain()) || 'road';
  const known = (b && b.terrain && b.terrain()) || null;
  const t = athena.terrain, n = t.n, cell = t.cell, half = n * cell / 2, W = n + 1;
  const HX = cols / 2, HZ = rows / 2;
  // terrain: the paint at each board cell's centre (majority of the 4 nearest vertices)
  const terrain = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x = (c + 0.5 - HX) * K, z = (r + 0.5 - HZ) * K;
    const gx = (x + half) / cell, gz = (z + half) / cell;
    const votes = {};
    [[Math.floor(gx), Math.floor(gz)], [Math.ceil(gx), Math.floor(gz)], [Math.floor(gx), Math.ceil(gz)], [Math.ceil(gx), Math.ceil(gz)]].forEach(([vc, vr]) => {
      if (vc < 0 || vr < 0 || vc > n || vr > n) return; const p = t.paint[vr * W + vc]; const key = PAINT_TO_TERRAIN[p] || defT; votes[key] = (votes[key] || 0) + 1;
    });
    let best = defT, bn = -1; Object.keys(votes).forEach(k => { if (votes[k] > bn) { bn = votes[k]; best = k; } });
    terrain.push(known && !known[best] ? defT : best);
  }
  // models: every slot that still exists keeps its board type, with the new transform
  const prevModels = base.models || [];
  const models = [];
  (athena.objects || []).forEach(o => {
    if (!o.k) return; const idx = slotIndex(o.k); const pm = prevModels[idx]; if (!pm) return;
    models.push({ t: pm.t, x: +(o.p[0] / K).toFixed(3), z: +(o.p[2] / K).toFixed(3), rot: Math.round((o.r[1] || 0) * 180 / Math.PI) % 360, sc: +((o.s[0] || K) / K).toFixed(3) });
  });
  return { v: 3, cols, rows, terrain, glbSlots: (base.glbSlots || []).map(s => ({ id: s.id, label: s.label, url: s.url })), models, backdrop: base.backdrop };
}

/* ── registration + the save/live hooks ─────────────────────────────────── */
export const BATTLE_ADAPTER = {
  id: BATTLE_GAME_ID, label: 'Battle board', icon: '⚔',
  describe: 'The board every battle is fought on. Board props are slots you can move, turn, scale or replace; paint layers map to the board\'s terrain types (road, rubble, dirt, grass, stone, sand, snow, scorched, water, blight, lava). Save writes the board; ★ Set live publishes it to all players.',
  slots: [], build: () => buildBattleMap(null),
  slotBody,
};
let _registered = false;
export function registerWithAthena() {
  if (_registered) return true;
  if (!bridge()) return false;
  try {
    const A = window.AthenaEngine || window.MythicMapForge;
    if (A && A.games && typeof A.games.register === 'function') { A.games.register(BATTLE_ADAPTER); _registered = true; return true; }
    window.__athenaGames = window.__athenaGames || []; window.__athenaGames.push(BATTLE_ADAPTER); _registered = true; return true;
  } catch (e) { return false; }
}
export function openInAthena() {
  try { const A = window.AthenaEngine || window.MythicMapForge; if (!A || !A.open) return false; registerWithAthena(); A.open({ game: BATTLE_GAME_ID }); return true; } catch (e) { return false; }
}
/* Save → board (Forge + device); Live → board + publish to every player. */
export const lastWrite = { v3: null, published: false, at: 0 };
async function onAthena(e) {
  const d = e && e.detail; if (!d || d.game !== BATTLE_GAME_ID || !d.map) return;
  const b = bridge(); if (!b) return;
  try {
    const v3 = toBoardMap(d.map, null);
    lastWrite.v3 = v3; lastWrite.at = Date.now(); lastWrite.published = false;
    b.setMap(v3);
    if (e.type === 'athena:live' && b.publish) { const ok = await b.publish(); lastWrite.published = !!ok; try { const B = window.MythicBridge; if (B && B.toast) B.toast(ok ? '⚔ Board published — every player now fights on it.' : '⚔ Board saved on this device (cloud offline).'); } catch (x) {} }
    else if (b.refreshBoard) b.refreshBoard();
  } catch (x) { try { console.warn('[battle-athena] write-back failed', x); } catch (_) {} }
}
try { ['athena:saved', 'athena:live'].forEach(t => window.addEventListener(t, onAthena)); } catch (e) {}
try { registerWithAthena(); setTimeout(registerWithAthena, 1500); setTimeout(registerWithAthena, 6000); } catch (e) {}
try { window.MythicBattleAthena = { open: openInAthena, build: buildBattleMap, toBoard: toBoardMap, adapter: BATTLE_ADAPTER, lastWrite, TERRAIN_TO_PAINT, PAINT_TO_TERRAIN }; } catch (e) {}
