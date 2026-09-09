/* ═══════════════════════════════════════════════════════════════════════════
   haul.bridge.js — THE SEAM between /src/haul and the legacy app.

   🔴 WHY THIS FILE EXISTS. index.html declares Profile, Cloud, Corp, Forge and
   Operations as top-level `const`. Those are global LEXICAL bindings — NOT
   properties of `window` — so an ES module cannot see them and `window.Profile`
   is undefined however global it looks. It has cost real time twice already
   (CLAUDE.md). index.html therefore hands this module exactly what it needs as
   `window.MythicHaulBridge`, every entry an accessor. Nothing in /src/haul reads
   a bare global. Need something new? Add it to the bridge on BOTH sides.

   ⚠ NULL_BRIDGE is what a test page (or a broken load) gets. Every consumer is
   written against this shape, so the module renders — in practice mode, with
   the built-in map — with no game around it at all.
   ═══════════════════════════════════════════════════════════════════════════ */

const NULL_BRIDGE = {
  cloud: null,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  gems: () => 0,
  refreshWallet: async () => {},
  resources: () => [],
  meta: (id) => ({ id, name: id, icon: '📦' }),
  getRes: () => 0,
  spendRes: () => false,
  addRes: () => false,
  refundRes: () => false,
  cities: () => [],
  econ: () => null,
  myCorp: () => null,
  amCorpFounder: () => false,
  corpRoster: () => [],
  corpEnsure: async () => {},
  transportOp: async () => null,
  corpTreasuryRefresh: async () => 0,
  corpTreasury: () => 0,
  nodeOwnersRefresh: async () => {},
  rigs: () => [{ id: 'issued_hauler', name: 'Scrap Hauler', kind: 'issued' }],
  toast: (m) => { try { console.log('[haul]', m); } catch (e) {} },
  confirm: async () => false,
  saveProfile: () => {},
  isAdmin: () => false,
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicHaulBridge;
    return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}
export function bridgeReady() { return !bridge()._null; }

/* The Supabase client, or null. Every API call checks this first and degrades
   to practice mode — the app MUST work offline / before sql/038 exists. */
export function client() {
  try { const c = bridge().cloud; return (c && c.client) ? c.client : null; } catch (e) { return null; }
}

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
export function fmtKm(km) { return (Math.round((Number(km) || 0) * 10) / 10).toFixed(1) + ' km'; }
export function fmtTime(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
