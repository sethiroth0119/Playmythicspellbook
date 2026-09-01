/* 🔌 THE SEAM between /src/missions and the legacy app.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE GLOBALS TRAP (CLAUDE.md). index.html declares Profile, App, Forge,
   Cloud and Corp as top-level `const`. Those are global LEXICAL bindings —
   they are NOT properties of `window`, so an ES module genuinely cannot see
   them. `window.Profile` is undefined even though `const Profile` is right
   there. That has already cost real time twice on the Node City bridge.

   So index.html hands this module exactly what it needs, once, as
   `window.MythicMissionBridge`. Nothing in /src/missions reads a bare global.
   If something new is needed from the legacy app, ADD IT TO THE BRIDGE — both
   here and in the index.html block that builds it. Do not reach around.
   ═══════════════════════════════════════════════════════════════════════════ */

/* A bridge-shaped object that does nothing, so the module imports, registers
   and even renders before index.html has published the real one (or in a test
   page with no game at all). Every consumer is written against this shape. */
const NULL_BRIDGE = {
  profile: () => ({}),
  saveProfile: () => {},
  root: () => (typeof document !== 'undefined' ? document.getElementById('app') : null),
  toast: (m) => { try { console.log('[missions]', m); } catch (e) {} },
  confirm: async () => false,
  render: () => {},
  goCamp: () => {},
  // the run engine — the ONLY four things this module asks of it
  startRun: () => false,
  activeRun: () => null,
  resumeRun: () => {},
  abandonRun: () => {},
  campaignName: () => '',
  // the admin's hand-built campaigns — the map is their surface now
  authoredCampaigns: () => [],
  // reward pool for generated nodes; empty is safe (the reward screen falls
  // back to its own pool rather than showing nothing)
  cardKeys: () => [],
  isAdmin: () => false,
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicMissionBridge;
    return (b && typeof b.profile === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}
export function bridgeReady() { return !bridge()._null; }

/* Lives here rather than being imported from the legacy app because every
   render path needs it and it must never be the thing that is missing. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
