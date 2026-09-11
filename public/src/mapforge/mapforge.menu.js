/* mapforge.menu.js — a map that is a BUTTON on a game menu.

   Asked for: "the map can be turned into a button on the game's menu where I
   can name the button and pick what menu the button goes on."

   The editor's Menu tab writes map.menu (mapforge.format.js, normalizeMenu)
   and saving it to the cloud makes the map public. This module is the read
   side: ONE narrow select of every public map with menu.on, cached for the
   session, turned into hub tiles for index.html's renderTitle() through
   AthenaEngine.menuTiles(hub). The first call primes the cache in the
   background and asks the bridge to redraw once the tiles are known, so a
   hub never waits on the network to paint.

   🔴 THE GLOBALS TRAP: nothing here reads App/Profile. The bridge hands over
      render(); with no bridge the tiles simply never appear. */

import { menuMaps } from './mapforge.api.js';
import { bridge, signedIn } from './mapforge.bridge.js';
import { HUBS } from './mapforge.format.js';

let rows = null;          // [{ id, name, menu }] — null until loaded
let loading = null;
let loadedFor = null;     // the signed-in state the cache was taken under

function strip(s, n) { return String(s == null ? '' : s).replace(/[<>&"'`]/g, '').trim().slice(0, n); }

export function menuTiles(hub) {
  hub = HUBS.includes(hub) ? hub : 'main';
  const signed = signedIn();
  if (rows === null || loadedFor !== signed) prime(signed);
  return (rows || []).filter(r => r.menu && r.menu.on && (r.menu.hub || 'main') === hub).map(r => ({
    id: 'athena-' + r.id,
    mapId: r.id,
    icon: strip(r.menu.icon, 4) || '🌍',
    name: strip(r.menu.label, 40) || strip(r.name, 40) || 'World',
    sub: strip(r.menu.sub, 80) || (r.menu.mode === 'hub' ? 'Meet other players inside' : 'Walk in'),
    mode: r.menu.mode || 'interact',
  }));
}

export function prime(signed) {
  if (loading) return loading;
  const was = rows ? JSON.stringify(rows) : '';
  loadedFor = signed == null ? signedIn() : signed;
  loading = menuMaps().then(r => {
    rows = (r && r.ok && Array.isArray(r.rows)) ? r.rows : (rows || []);
    loading = null;
    const now = JSON.stringify(rows);
    if (now !== was && rows.length) { try { const b = bridge(); if (b && b.render) b.render(); } catch (e) {} }
    return rows;
  }).catch(() => { rows = rows || []; loading = null; return rows; });
  return loading;
}

/* After a save in the editor: forget the cache and redraw the hub. */
export function refreshMenu() { rows = null; loading = null; return prime(); }
export function cached() { return rows ? rows.slice() : []; }
