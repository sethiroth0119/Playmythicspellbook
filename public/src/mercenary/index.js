/* ═══════════════════════════════════════════════════════════════════════════
   /src/mercenary/index.js — the module entry point.

   ⚔ THE MERCENARY BOARD. A player posts a contract for Forge resources and/or
   custom cards, their Cinder goes into escrow, another player delivers, and
   the escrow releases itself the moment the manifest is met. Jobs, applications
   and badges all surface on EMERGENCY BROADCAST (mythicspellbook.xyz) — the
   feed post, the notifications and the public standing view are written by
   sql/122_mercenary_board.sql, so the website needs no game client to show them.

   index.html loads exactly this file and nothing else from the feature. It
   publishes `window.MythicMercenaries` so the legacy app has one function to
   call, and stays completely inert until someone calls open().

   ⚠ This module must never throw at import time. It is loaded on every page
     load, and a failure here would take a 215k-line app down with it — so the
     registration is wrapped and the feature simply does not appear if
     something is wrong, rather than breaking the game.

   ⚠ It must also never require the migration to have been applied. Every
     Supabase call in merc.api.js reports `missing` instead of throwing, and
     the hub renders "not set up on this world yet". That is the same contract
     Corp.* honours, and CLAUDE.md makes it non-negotiable.
   ═══════════════════════════════════════════════════════════════════════════ */

import { open, close, paint } from './merc.render.js';
import { Merc, loadAll, refreshProgress, myPostings, myJobs, claimCount } from './merc.state.js';
import { bridge, bridgeReady, ctx, io } from './merc.bridge.js';
import * as api from './merc.api.js';
import * as manifest from './merc.manifest.js';
import * as badges from './merc.badges.js';

const MythicMercenaries = {
  version: 'v1',
  open, close, paint,

  // Everything the feature can do is reachable from here, so nothing else
  // needs to import from inside /src/mercenary.
  state: Merc,
  loadAll, refreshProgress, myPostings, myJobs, claimCount,
  api, manifest, badges, ctx, io,
  bridgeReady,

  // Handy in the console: __merc.debug()
  debug() {
    const b = bridge();
    return {
      bridgeReady: bridgeReady(),
      signedIn: b.signedIn(),
      userId: b.userId(),
      open: Merc.open.length,
      mine: Merc.mine.length,
      roster: Merc.mercs.length,
      waiting: claimCount(),
      missing: Merc.missing,
      offline: Merc.offline,
      error: Merc.error,
      resources: (ctx().resources() || []).length,
      cards: (ctx().customCards() || []).length,
    };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicMercenaries = MythicMercenaries;
    window.__merc = MythicMercenaries;   // console shorthand, like __mg / __mc
    // Let the legacy app know it can show the entry point now. It listens for
    // this rather than polling, and the tile is hidden until it fires.
    try { window.dispatchEvent(new CustomEvent('mythic:mercenaries-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[mercenary] registration failed —', e); } catch (e2) {}
}

export default MythicMercenaries;
