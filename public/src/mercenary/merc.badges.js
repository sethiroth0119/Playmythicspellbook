/* ═══════════════════════════════════════════════════════════════════════════
   merc.badges.js — 🎖 the badge catalogue.

   🔴 THIS FILE DOES NOT AWARD ANYTHING. It is a LOOKUP TABLE: it turns a
   `{badge_id, tier}` row that the server already wrote into an icon, a name
   and a sentence. The thresholds below are a MIRROR of the ones in
   sql/038_mercenary_board.sql § merc_award_badges(), kept here only so the
   UI can say "3 more runs to Runner II" without a round trip.

   ⚠ IF YOU CHANGE A THRESHOLD, CHANGE IT IN THE SQL FIRST. The SQL is the
     authority; this table is a caption. A drift between the two shows up as a
     progress bar that never fills, which is annoying — the reverse (trusting
     this file to award) would be a badge anyone could mint by editing a local
     file, which is why the award path lives in a SECURITY DEFINER function
     that no client role may even execute.
   ═══════════════════════════════════════════════════════════════════════════ */

export const BADGES = {
  first_contract: {
    icon: '🎖', name: 'Contracted', tiers: [1],
    of: () => 'Completed a mercenary contract.',
    stat: 'jobs',
  },
  runner: {
    icon: '🏃', name: 'Runner', tiers: [5, 25, 100],
    of: (n) => `${n} contracts delivered.`,
    stat: 'jobs',
  },
  quartermaster: {
    icon: '📦', name: 'Quartermaster', tiers: [10000, 100000, 1000000],
    of: (n) => `${n} units of Forge resources hauled.`,
    stat: 'units',
  },
  archivist: {
    icon: '🃏', name: 'Archivist', tiers: [10, 50, 250],
    of: (n) => `${n} custom cards delivered.`,
    stat: 'cards',
  },
  punctual: {
    icon: '⏱', name: 'Punctual', tiers: [5, 20, 50],
    of: (n) => `${n} contracts finished before the deadline.`,
    stat: 'early',
  },
  bankroll: {
    icon: '🔥', name: 'Bankroll', tiers: [100000, 1000000, 10000000],
    of: (n) => `${n} Cinder earned on contracts.`,
    stat: 'cinder',
  },
};

const ROMAN = ['', 'I', 'II', 'III'];

/** Display name for one awarded row. Tier I is left unmarked on a badge that
    only has one tier, so "Contracted I" never appears. */
export function label(badgeId, tier) {
  const b = BADGES[badgeId];
  if (!b) return badgeId;
  if (b.tiers.length < 2) return b.name;
  return b.name + ' ' + (ROMAN[Math.max(1, Math.min(3, tier | 0))] || 'I');
}

export function icon(badgeId) {
  const b = BADGES[badgeId];
  return b ? b.icon : '🏅';
}

export function describe(badgeId, tier) {
  const b = BADGES[badgeId];
  if (!b) return '';
  const need = b.tiers[Math.max(0, Math.min(b.tiers.length - 1, (tier | 0) - 1))];
  try { return b.of(Number(need).toLocaleString()); } catch (e) { return ''; }
}

/** The NEXT rung, for "2 more runs to Runner II". Returns null at the top.
    `have` is the raw stat the server counts, not the tier. */
export function next(badgeId, tier, have) {
  const b = BADGES[badgeId];
  if (!b) return null;
  const t = Math.max(0, tier | 0);
  if (t >= b.tiers.length) return null;
  const need = b.tiers[t];
  return { tier: t + 1, need, remaining: Math.max(0, need - (have | 0)), label: label(badgeId, t + 1) };
}

/** Normalise whatever the board handed us — merc_public_standing.badges is a
    jsonb array, and a stale row could be null or a string. Never throws: an
    unreadable badge list renders as no badges, not as a broken profile. */
export function normalise(raw) {
  let list = raw;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && b.id && BADGES[b.id])
    .map((b) => ({ id: b.id, tier: Math.max(1, Math.min(3, b.tier | 0) || 1) }));
}

/** Badge chips, ready to drop into innerHTML. Ordered by the catalogue rather
    than by award time so a mercenary's row keeps the same shape every render. */
export function chipsHtml(raw) {
  const list = normalise(raw);
  if (!list.length) return '<span class="mrc-dim">No badges yet</span>';
  const order = Object.keys(BADGES);
  list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return list.map((b) =>
    `<span class="mrc-badge" title="${describe(b.id, b.tier).replace(/"/g, '&quot;')}">` +
    `${icon(b.id)} ${label(b.id, b.tier)}</span>`).join('');
}
