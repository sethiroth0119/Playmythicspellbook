/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM ↔ ⚒ ATHENA ENGINE — the farm as a GAME SCENE.
   ----------------------------------------------------------------------------
   Two directions, one file:

   1. ADAPTER (farm → Athena). The farm registers itself with
      AthenaEngine.games so the editor can open "Homestead Farm" from its
      Maps tab. build() turns FARM_GRID + FARM_BUILDINGS into a map document:
      a flat 20 m ground and one 🧩 slot object per building (objects[].k =
      the building id), sorted into two content folders. The map is tagged
      game: 'farm' and, by default, renders NONE of its own ground/water/sky
      in the game — the farm keeps those; the map only contributes the slot
      transforms, replacements and whatever else the admin places.

   2. OVERLAY (Athena → farm). When the 3D scene mounts it asks Athena for
      the LIVE farm map and gets back an overlay: the placed objects built
      into a group the scene adds as-is, plus placement() / replacement()
      per building so the farm draws each building where the admin put it,
      at the admin's scale and turn, or draws the admin's prop / .glb in its
      place. Yards (where the animals wander) and fences shift with their
      pen. Everything degrades: no Athena, no map, or a signed-out player →
      the farm draws exactly as it did before this file existed.

   ⚠ The live map is GLOBAL — one live 'farm' scene per owner, and the game
     loads the newest live one — so the "Open in Athena Engine" button is
     admin-only: this is how the game's farm is redesigned for everyone, not
     a per-player cosmetic (that is the Athena look tab next to it).
   ⚠ Coordinates: the farm's tileToWorld(gx, gy) = (gx - w/2, gy - h/2) in
     metres with the grid centred on the origin, which is exactly Athena's
     frame (terrain centred, metres, Y up) — so slot positions are used raw.
   ⚠ THREE: both sides use the r128 global build (window.THREE), so objects
     built by Athena can sit in the farm's scene graph. Never mix in the
     import-map three (0.171).
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_BUILDINGS, FARM_GRID } from './farm.data.js';

export const FARM_GAME_ID = 'farm';

function tileToWorld(gx, gy) { return { x: gx - FARM_GRID.w / 2, z: gy - FARM_GRID.h / 2 }; }
function uid(p) { return (p || 'o') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

/* ── 1. the adapter ──────────────────────────────────────────────────────── */
export function buildFarmMap() {
  const n = 20, cell = 1, verts = (n + 1) * (n + 1);
  const F_PENS = 'f_farm_pens', F_STATIONS = 'f_farm_stations';
  const objects = FARM_BUILDINGS.map(def => {
    const c = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
    return { id: 'o_farm_' + def.id, t: 'slot', k: def.id, n: def.name, c: def.accent, p: [c.x, 0, c.z], r: [0, 0, 0], s: [1, 1, 1], g: true, f: def.houses ? F_PENS : F_STATIONS };
  });
  return {
    v: 1, id: uid('map_'), name: 'Homestead Farm', description: 'The camp\'s homestead: one slot per building. Move a slot to move the building; replace it to swap the model.',
    game: FARM_GAME_ID,
    terrain: { n, cell, heights: new Array(verts).fill(0), paint: new Array(verts).fill(0) },
    water: { on: false, level: -1, color: '#2e6f9e', opacity: 0.78, wave: 0.12, speed: 1 },
    env: { preset: 'day', shadows: true, weather: 'none' },
    assets: [],
    folders: [
      { id: F_PENS, name: 'Pens', parent: null, open: true, vis: true, lock: false },
      { id: F_STATIONS, name: 'Stations', parent: null, open: true, vis: true, lock: false },
    ],
    objects,
    scene: { ground: false, water: false, sky: false },
    meta: { created: Date.now(), updated: Date.now(), author: 'Homestead Farm' },
  };
}

export const FARM_ADAPTER = {
  id: FARM_GAME_ID, label: 'Homestead Farm', icon: '🐄',
  describe: 'The camp\'s 3D homestead. One slot per building (pens and stations). Ground, sky and animals stay the farm\'s; everything else you place shows up on every player\'s farm once the map is live.',
  slots: FARM_BUILDINGS.map(def => ({ k: def.id, label: def.name, icon: def.emoji })),
  build: buildFarmMap,
};

let _registered = false;
export function registerWithAthena() {
  if (_registered) return true;
  try {
    const A = window.AthenaEngine || window.MythicMapForge;
    if (A && A.games && typeof A.games.register === 'function') { A.games.register(FARM_ADAPTER); _registered = true; return true; }
    // Athena has not loaded yet (module order is not guaranteed): queue it. index.js drains this.
    if (!window.__athenaGames) window.__athenaGames = [];
    window.__athenaGames.push(FARM_ADAPTER); _registered = true; return true;
  } catch (e) { return false; }
}

export function athenaAvailable() { try { const A = window.AthenaEngine || window.MythicMapForge; return !!(A && A.open); } catch (e) { return false; } }
export function openInAthena() {
  try { const A = window.AthenaEngine || window.MythicMapForge; if (!A || !A.open) return false; registerWithAthena(); A.open({ game: FARM_GAME_ID }); return true; } catch (e) { return false; }
}

/* ── 2. the overlay ──────────────────────────────────────────────────────── */
/* Resolves to null when there is nothing to overlay (no Athena, no live map). */
export async function loadOverlay(THREE, scene, opts) {
  opts = opts || {};
  let A; try { A = window.AthenaEngine || window.MythicMapForge; } catch (e) { A = null; }
  if (!A || !A.overlay || typeof A.overlay.forGame !== 'function') return null;
  let ov;
  try { ov = await A.overlay.forGame(FARM_GAME_ID, { THREE, scene, lights: false, force: !!opts.force }); } catch (e) { try { console.warn('[farm] athena overlay failed:', e); } catch (x) {} return null; }
  if (!ov) return null;
  const byKey = {}; ov.slots().forEach(s => { if (s) byKey[s.o.k] = s; });
  const placementOf = (def) => {
    const s = byKey[def.id];
    const home = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
    if (!s) return { x: home.x, z: home.z, y: 0, ry: 0, scale: 1, hidden: false, replaced: false, dx: 0, dz: 0, home: true };
    return { x: s.p[0], z: s.p[2], y: s.p[1] || 0, ry: s.r[1] || 0, scale: s.s[0] || 1, hidden: !!s.hidden, replaced: !!s.replaced, dx: s.p[0] - home.x, dz: s.p[2] - home.z, home: false };
  };
  return {
    group: ov.group, pieces: ov.pieces, map: ov.map, source: ov.source,
    placement: placementOf,
    /* the yard, shifted with its pen (rounded to whole tiles so the wander grid stays sane) */
    yardOf(def) {
      const y = def.yard || def.plot; const p = placementOf(def);
      if (p.home) return y;
      return { x: y.x + Math.round(p.dx), y: y.y + Math.round(p.dz), w: y.w, h: y.h };
    },
    /* an Object3D for a replaced slot (prop or .glb), or null */
    replacement(def) { try { return ov.buildReplacement(def.id); } catch (e) { return null; } },
    update(dt, camera) { try { ov.update(dt, camera); } catch (e) {} },
    dispose() { try { ov.dispose(); } catch (e) {} },
  };
}

/* Athena tells the page when a map is saved, set live or the editor closes;
   the farm reloads its overlay so what the admin just did shows at once. */
export function watchAthena(fn) {
  const h = (e) => { try { const g = e && e.detail && e.detail.game; if (!g || g === FARM_GAME_ID) fn(e.type); } catch (x) {} };
  ['athena:saved', 'athena:live', 'athena:closed'].forEach(t => window.addEventListener(t, h));
  return () => ['athena:saved', 'athena:live', 'athena:closed'].forEach(t => window.removeEventListener(t, h));
}
