/* ═══════════════════════════════════════════════════════════════════════════
   campaigns.bridge.js — the ONLY way this feature reaches the legacy app.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Profile / Cloud / App / Forge are top-level
   `const` in index.html: global LEXICAL bindings, not window properties, so a
   module cannot see them. index.html hands over `window.MythicBridge`, and
   the node-campaign accessors live under `MythicBridge.nodeCampaigns`. Nothing
   in /src/campaigns reads a bare global. If the bridge is missing the module
   registers, stays inert and warns once.
   ═══════════════════════════════════════════════════════════════════════════ */

const NULL_NC = {
  node: () => null,
  selectedNode: () => null,
  canAttack: () => false,
  attack: () => {},
  getRes: () => 0,
  spendRes: () => false,
  refundRes: () => {},
  adoptCinder: () => {},
  local: () => ({}),
  missions: () => [],
  missionRun: () => null,
  missionStart: () => {},
  missionResume: () => {},
  goMissions: () => {},
  onNodeScreen: () => false,
};

const NULL_BRIDGE = {
  cloud: null,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  gems: () => 0,
  toast: (m) => { try { console.log('[campaigns]', m); } catch (e) {} },
  confirm: async () => false,
  render: () => {},
  isAdmin: () => false,
  saveProfile: () => {},
  nodeCampaigns: NULL_NC,
  _null: true,
};

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicBridge;
    if (!b || typeof b.signedIn !== 'function') return NULL_BRIDGE;
    if (!b.nodeCampaigns) return Object.assign({}, b, { nodeCampaigns: NULL_NC, _null: true });
    return b;
  } catch (e) { return NULL_BRIDGE; }
}
export function nc() { return bridge().nodeCampaigns || NULL_NC; }
export function bridgeReady() { return !bridge()._null; }

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
