/* ═══════════════════════════════════════════════════════════════════════════
   /src/market/index.js — the Bazaar module entry point.

   index.html loads exactly this file and nothing else from the feature. It
   publishes `window.MythicBazaar` and stays inert until open() is called.

   ⚠ This module must never throw at import time. It is loaded on every page
   load, and a failure here would take a 215k-line app down with it — so the
   registration is wrapped and the feature simply does not appear if something
   is wrong. The tile in index.html is `window.MythicBazaar ? {…} : null`, so a
   broken module is a missing tile rather than a dead button.
   ═══════════════════════════════════════════════════════════════════════════ */
import { Bazaar, open, close, paint, refresh, handleReturn } from './bazaar.render.js';
import { bridge, bridgeReady, usd } from './bazaar.bridge.js';
import * as api from './bazaar.api.js';

const MythicBazaar = {
  version: 'v1',
  open, close, paint, refresh, handleReturn,
  state: Bazaar,
  api, bridgeReady, usd,
  debug() {
    return {
      bridgeReady: bridgeReady(),
      signedIn: bridge().signedIn(),
      cfg: Bazaar.cfg,
      listings: Bazaar.listings.length,
      mine: Bazaar.mine.length,
      waiting: Bazaar.waiting.length,
      notSetup: Bazaar.notSetup,
      error: Bazaar.error,
    };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicBazaar = MythicBazaar;
    window.__bz = MythicBazaar;            // console shorthand, like __mc
    // 🔙 Buyers come back from Stripe on a full page load, so the return leg
    // has to run at boot rather than when the overlay happens to be open.
    try { handleReturn(window.location.search); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('mythic:bazaar-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[bazaar] registration failed —', e); } catch (e2) {}
}

export default MythicBazaar;
