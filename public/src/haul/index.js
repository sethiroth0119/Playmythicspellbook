/* ═══════════════════════════════════════════════════════════════════════════
   /src/haul/index.js — the module entry point for HIGHWAY HAUL.

   index.html loads exactly this file. It publishes `window.MythicHaul` so the
   legacy app has one tile to draw and one function to call, and stays
   completely inert until open().

   WHAT THE FEATURE IS
     Crazy-Taxi-style freight. A shipper posts goods to move from one city
     node to another and escrows a Cinder fare. A driver takes the wheel in a
     3D highway run whose LENGTH comes from the city node map. Every car or
     rail they hit damages the cargo and — if they drive for a transport
     company — comes out of their wage, not the company's take. Every run
     builds a driver rank the company owner can read against the wage they
     pay. Files: haul.map (routes), haul.economy (fares/wages/rank),
     haul.game (the 3D run), haul.api (Supabase, guarded), haul.render (UI).

   ⚠ This module must never throw at import time. It loads on every page
     load; a failure here would take a 215k-line app down with it, so the
     registration is wrapped and the tile simply does not appear.
   ═══════════════════════════════════════════════════════════════════════════ */

import { open, close, paint } from './haul.render.js';
import { Haul, loadAll } from './haul.api.js';
import { bridge, bridgeReady } from './haul.bridge.js';
import * as map from './haul.map.js';
import * as economy from './haul.economy.js';
import { play } from './haul.game.js';

const MythicHaul = {
  version: 'v1',
  open, close, paint,
  state: Haul, loadAll,
  map, economy, play,          // pure pieces, exposed for the console and tests
  bridgeReady,
  /* The portal tile's badge. Cheap and synchronous — it is called on every
     hub repaint, so it must never fetch. */
  badge() {
    try {
      const n = Haul.jobs.filter((j) => j.status === 'open').length;
      return n ? n + ' shipments waiting' : 'Freight · drive for Cinder';
    } catch (e) { return 'Freight'; }
  },
  debug() {
    return { bridgeReady: bridgeReady(), signedIn: bridge().signedIn(), cities: bridge().cities().length, econ: bridge().econ(), jobs: Haul.jobs.length, missing: Haul.missing, offline: Haul.offline, error: Haul.error };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicHaul = MythicHaul;
    window.__haul = MythicHaul;
    if (!bridgeReady()) { try { console.warn('[haul] MythicHaulBridge missing — practice mode with the built-in map.'); } catch (e) {} }
    try { window.dispatchEvent(new CustomEvent('mythic:haul-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[haul] registration failed —', e); } catch (e2) {}
}

export default MythicHaul;
