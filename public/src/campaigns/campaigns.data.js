/* ═══════════════════════════════════════════════════════════════════════════
   campaigns.data.js — what a node campaign IS, plus the built-in catalog.

   A campaign is a drive attached to ONE City Node. Two kinds:
     relief  — players GIVE the node resources (a goal per resource). Giving
               lands them on the campaign leaderboard and mints Ⓜ Mythic Token
               airdrop entitlements (sql/038). A relief campaign also names a
               roguelite MISSION the player can run instead of giving.
     assault — the old "⚔ Attack PRN" flow, kept as a campaign so replacing
               the button lost nothing. It has no ledger and no mission.

   The live catalog is the `node_campaigns` table; SEED_CAMPAIGNS is the
   offline mirror of its seed rows so the drawer is never empty before the
   migration runs or when the player is signed out. Same ids on both sides —
   the id is the contract between the client and the ledger.
   ═══════════════════════════════════════════════════════════════════════════ */

// Only these four are giftable today. Ids are the legacy RESOURCES ids
// (Profile.salvage keys) — `cinder` is special-cased: it is Profile.gems and
// is debited SERVER-SIDE by the give RPC, never spent locally first.
export const CAMPAIGN_RESOURCES = {
  food:     { id: 'food',     name: 'Food',      icon: '🥫', color: '#9ad17a' },
  water:    { id: 'water',    name: 'Water',     icon: '💧', color: '#7fd6ff' },
  crudeOil: { id: 'crudeOil', name: 'Crude Oil', icon: '🛢', color: '#ffcf6b' },
  cinder:   { id: 'cinder',   name: 'Cinder',    icon: '🔥', color: '#d8b24a' },
};
export const RESOURCE_ORDER = ['food', 'water', 'crudeOil', 'cinder'];

export function resMeta(id) {
  return CAMPAIGN_RESOURCES[id] || { id, name: id, icon: '📦', color: '#cfd6e4' };
}

export const SEED_CAMPAIGNS = [
  {
    id: 'elpaso_relief',
    nodeId: 'N-42',
    // The seed is matched by NAME too: node ids differ between the starter
    // map and a published one, and the drive must show on El Paso regardless.
    nodeMatch: /el\s*paso/i,
    kind: 'relief',
    name: 'Standing With El Paso',
    icon: '🤝',
    tagline: 'Help make El Paso a better place.',
    description: 'El Paso is collapsing. Give the node food, water, crude oil and Cinder — 500,000,000 of each — to bring it back. Every gift lands on the leaderboard and earns Mythic Token airdrops.',
    goals: { food: 500000000, water: 500000000, crudeOil: 500000000, cinder: 500000000 },
    missionName: 'Standing With El Paso',
    missionId: null,
    airdropMtPerMillion: 1,
    active: true,
    seed: true,
  },
];

// The assault option every non-owner sees. Not a row anywhere.
export const ASSAULT_CAMPAIGN = {
  id: 'assault', kind: 'assault', name: 'Raid this PRN', icon: '⚔',
  tagline: 'Fight the guard deck and strip a control layer from this node.',
  description: 'The classic capture: clear the guards, claim the node for your corporation.',
  goals: {}, active: true,
};

// A DB row → the shape the UI uses (camelCase, numbers as numbers).
export function fromRow(r) {
  if (!r || !r.id) return null;
  const goals = {};
  try { Object.keys(r.goals || {}).forEach((k) => { const v = Number(r.goals[k]); if (v > 0) goals[k] = v; }); } catch (e) {}
  return {
    id: String(r.id), nodeId: String(r.node_id || ''), kind: r.kind || 'relief',
    name: r.name || r.id, icon: r.icon || '🤝', tagline: r.tagline || '',
    description: r.description || '', goals,
    missionName: r.mission_name || '', missionId: r.mission_id || null,
    airdropMtPerMillion: Number(r.airdrop_mt_per_million) || 0,
    active: r.active !== false, seed: false,
  };
}

// UI shape → DB row (admin save).
export function toRow(c) {
  return {
    id: c.id, node_id: c.nodeId, kind: c.kind || 'relief', name: c.name, icon: c.icon || '🤝',
    tagline: c.tagline || null, description: c.description || null, goals: c.goals || {},
    mission_name: c.missionName || null, mission_id: c.missionId || null,
    airdrop_mt_per_million: Number(c.airdropMtPerMillion) || 0, active: c.active !== false,
    updated_at: new Date().toISOString(),
  };
}

// 500000000 → "500M", 1234567 → "1.23M", 950 → "950".
export function fmtBig(n) {
  const v = Math.max(0, Number(n) || 0);
  // Trim trailing zeros ONLY after a decimal point — a bare /0+$/ turned
  // "500" into "5" and printed the 500M goal as "5M".
  const trim = (s) => (s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s);
  if (v >= 1e9) return trim((v / 1e9).toFixed(2)) + 'B';
  if (v >= 1e6) return trim((v / 1e6).toFixed(2)) + 'M';
  if (v >= 1e4) return trim((v / 1e3).toFixed(1)) + 'k';
  return Math.round(v).toLocaleString();
}

// Slug for an admin-created campaign id. Stable across saves once created.
export function slugify(name, nodeId) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return (s || 'campaign') + '_' + String(nodeId || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
