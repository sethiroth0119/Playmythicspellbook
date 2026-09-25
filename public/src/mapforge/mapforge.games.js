/* mapforge.games.js — the GAME SCENES registry.

   A mini-game that draws its own 3D scene (Homestead Farm, later the card
   shop, the city…) registers an ADAPTER here so its map can be opened and
   edited inside Athena Engine, and so the game can read back what the
   builder did. The adapter is small on purpose:

     AthenaEngine.games.register({
       id: 'farm',                       // = the map's `game` tag
       label: 'Homestead Farm', icon: '🐄',
       describe: 'What the slots are…',  // shown in the Maps tab
       build(THREE?) → map document      // the game's scene as an Athena map:
                                         //   terrain sized to the game, one
                                         //   `slot` object per game asset
                                         //   (objects[].k = the game's id),
                                         //   folders for the groups
       slots: [{ k, label, icon }]       // optional, for the inspector
     });

   The game then loads the live map with AthenaEngine.overlay.forGame(id)
   (see mapforge.overlay.js) and applies slot transforms / replacements to
   its own scene. Nothing here touches THREE or the DOM.

   Registration order is not guaranteed (the farm module may load before this
   one), so adapters can also be pushed onto window.__athenaGames; index.js
   drains that queue when Athena loads. */

const adapters = new Map();
const listeners = [];

export function register(a) {
  if (!a || typeof a !== 'object' || !a.id || typeof a.build !== 'function') return false;
  const id = String(a.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
  adapters.set(id, Object.assign({ label: id, icon: '🎮', describe: '', slots: [] }, a, { id }));
  listeners.forEach(fn => { try { fn(id); } catch (e) {} });
  return true;
}
export function get(id) { return adapters.get(String(id || '').toLowerCase()) || null; }
export function list() { return Array.from(adapters.values()); }
export function onRegister(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

/* Drain the pre-load queue — safe to call any number of times. */
export function drainQueue() {
  try {
    const q = window.__athenaGames;
    if (Array.isArray(q)) { q.splice(0).forEach(register); }
    // after draining, turn the queue into a live sink so late pushes register at once
    window.__athenaGames = { push: (a) => register(a) };
  } catch (e) {}
}
