/* ═══════════════════════════════════════════════════════════════════════════
   community.bridge.js — THE SEAM between this module and the legacy app.

   🔴 WHY THIS FILE EXISTS AT ALL.
   index.html declares Profile, Cloud, App, Corp and Forge as top-level `const`.
   Those are global LEXICAL bindings — they are NOT properties of `window`, so
   an ES module genuinely cannot see them. `window.Profile` is undefined even
   though `const Profile` is right there. This has already cost real time twice
   (FoundationReserve and Profile, both in the Node City bridge).

   So index.html hands this module exactly what it needs, once, as
   `window.MythicBridge`. Nothing in /src/community reads a bare global.

   If a module needs something new from the legacy app, ADD IT TO THE BRIDGE
   (both here and in the index.html block that builds it). Do not reach around.
   ═══════════════════════════════════════════════════════════════════════════ */

// A bridge-shaped object that does nothing, so the module can be imported and
// even rendered before index.html has published the real one (or in a test
// page that has no game at all). Every consumer is written against this shape.
const NULL_BRIDGE = {
  cloud: null,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  gems: () => 0,
  spendGems: () => false,
  addGems: () => {},
  saveProfile: () => {},
  toast: (m) => { try { console.log('[community]', m); } catch (e) {} },
  confirm: async () => false,
  myCorp: () => null,
  amCorpFounder: () => false,
  corpRegionControl: () => 0,
  corpTreasury: () => 0,
  // Territory Wars nodes, for objectives. Objectives POINT at these — there is
  // no parallel mission system, so if this returns [] the objectives tab says
  // so rather than inventing targets.
  twNodes: () => [],
  // 📻 The corporation's Guild Wire, hosted inside this hub.
  guildChat: () => [],
  guildChatRefresh: () => {},
  guildChatSend: async () => false,
  guildChatAppend: () => {},
  isAdmin: () => false,
  render: () => {},
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicBridge;
    return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}

export function bridgeReady() { return !bridge()._null; }

// Small shared helpers. escapeHtml lives here rather than being imported from
// the legacy app because every render path needs it and it must never be the
// reason a module fails to load.
export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
       : v >= 10000 ? (v / 1000).toFixed(1) + 'k'
       : Math.round(v).toLocaleString();
}

export function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString(); } catch (e) { return '—'; }
}
