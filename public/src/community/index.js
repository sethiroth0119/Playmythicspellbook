/* ═══════════════════════════════════════════════════════════════════════════
   /src/community/index.js — the module entry point.

   index.html loads exactly this file and nothing else from the feature. It
   publishes `window.MythicCommunity` so the legacy app has one function to
   call, and stays completely inert until someone calls open().

   ⚠ This module must never throw at import time. It is loaded on every page
   load, and a failure here would take a 215k-line app down with it — so the
   registration is wrapped and the feature simply does not appear if something
   is wrong, rather than breaking the game.
   ═══════════════════════════════════════════════════════════════════════════ */

import { open, close, paint } from './community.render.js';
import { Community, loadDirectory, loadCommunity, standings } from './community.state.js';
import { bridge, bridgeReady } from './community.bridge.js';
import * as roles from './community.roles.js';
import * as api from './community.api.js';

const MythicCommunity = {
  version: 'v1',
  open, close, paint,
  // Exposed for the console + for any future legacy call site. Everything the
  // feature can do is reachable from here, so nothing else needs to import
  // from inside /src/community.
  state: Community,
  loadDirectory, loadCommunity, standings,
  roles, api,
  bridgeReady,
  // Handy in the console: __mc.debug()
  debug() {
    return {
      bridgeReady: bridgeReady(),
      signedIn: bridge().signedIn(),
      userId: bridge().userId(),
      corp: bridge().myCorp(),
      communities: Community.list.length,
      missing: Community.missing,
      offline: Community.offline,
      error: Community.error,
    };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicCommunity = MythicCommunity;
    window.__mc = MythicCommunity;          // console shorthand, like __mg
    // Let the legacy app know it can show the entry point now. It listens for
    // this rather than polling, and the tile is hidden until it fires.
    try { window.dispatchEvent(new CustomEvent('mythic:community-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[community] registration failed —', e); } catch (e2) {}
}

export default MythicCommunity;
