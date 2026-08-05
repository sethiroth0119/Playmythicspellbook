/* ═══════════════════════════════════════════════════════════════════════════
   community.state.js — the Community object + fetch/cache.
   Mirrors the Corp.* pattern: one module-level object, guarded loaders that
   never throw, and a `_missing` flag so the UI can say "run the SQL" instead
   of "something went wrong".
   ═══════════════════════════════════════════════════════════════════════════ */

import * as api from './community.api.js';
import { bridge } from './community.bridge.js';

export const Community = {
  // directory
  list: [],
  memberships: [],        // [{community_id, role, status}] for THIS player
  // the open community
  current: null,          // communities row
  members: [],
  corps: [],              // community_corps rows
  corpMeta: {},           // corpId -> {name, tag, faction, element}
  ledger: [],
  audit: [],
  // Phase 2
  announcements: [],
  votes: [],
  ballots: [],            // [{vote_id,user_id,choice}] for the listed votes
  objectives: [],
  rewards: [],
  // status
  loading: false,
  missing: false,         // the migrations have not been run
  offline: false,         // not signed in / no cloud
  error: null,
  loadedAt: 0,
};

// Any loader can set these; one place decides what the banner says.
function note(res) {
  if (!res) return;
  if (res.missing) Community.missing = true;
  if (res.offline) Community.offline = true;
  if (res.error && !res.missing && !res.offline) Community.error = res.error;
}

function resetFlags() {
  Community.missing = false;
  Community.offline = false;
  Community.error = null;
}

export function myMembershipFor(communityId) {
  return (Community.memberships || []).find((m) => m && m.community_id === communityId) || null;
}

/** Directory + which of them this player is already in. */
export async function loadDirectory() {
  Community.loading = true;
  resetFlags();
  try {
    const [list, mine] = await Promise.all([api.listCommunities(), api.myMemberships()]);
    note(list); note(mine);
    Community.list = list.rows || [];
    Community.memberships = mine.rows || [];
  } finally {
    Community.loading = false;
    Community.loadedAt = Date.now();
  }
  return Community;
}

/** Everything for one community. Audit is leadership-only and is allowed to
 *  come back empty — that is RLS doing its job, not an error. */
export async function loadCommunity(id) {
  Community.loading = true;
  resetFlags();
  try {
    const [row, members, corps, ledger] = await Promise.all([
      api.getCommunity(id), api.listMembers(id), api.listCorps(id), api.listLedger(id),
    ]);
    note(row); note(members); note(corps); note(ledger);
    Community.current = row.row || null;
    Community.members = members.rows || [];
    Community.corps = corps.rows || [];
    Community.ledger = ledger.rows || [];

    // Corp names are a second call so a corporations RLS change cannot take
    // the affiliation list down with it.
    const ids = Community.corps.map((c) => c.corp_id).filter(Boolean);
    Community.corpMeta = {};
    if (ids.length) {
      const meta = await api.corpsByIds(ids);
      (meta.rows || []).forEach((c) => { Community.corpMeta[c.id] = c; });
    }

    // Best-effort; empty for a non-leader by design.
    try { const a = await api.listAudit(id); Community.audit = a.rows || []; }
    catch (e) { Community.audit = []; }

    // Phase 2. Each is independently guarded — a community that has not run
    // sql/005 yet still shows everything Phase 1 provides.
    try { const r = await api.listAnnouncements(id); note(r); Community.announcements = r.rows || []; }
    catch (e) { Community.announcements = []; }
    try {
      const v = await api.listVotes(id); note(v);
      Community.votes = v.rows || [];
      const ids = Community.votes.map((x) => x.id).filter((x) => x != null);
      const bal = ids.length ? await api.listBallots(ids) : { rows: [] };
      Community.ballots = bal.rows || [];
    } catch (e) { Community.votes = []; Community.ballots = []; }
    try { const o = await api.listObjectives(id); note(o); Community.objectives = o.rows || []; }
    catch (e) { Community.objectives = []; }
    try { const w = await api.listRewards(id); note(w); Community.rewards = w.rows || []; }
    catch (e) { Community.rewards = []; }
  } finally {
    Community.loading = false;
    Community.loadedAt = Date.now();
  }
  return Community;
}

/* ── STANDINGS ────────────────────────────────────────────────────────────
   The whole reason this feature is not "a worse Discord": Discord cannot see
   game state. Everything here is derived from systems that already exist —
   nothing is a new parallel economy.

   ⚠ Territory and treasury come through the bridge, which reads the legacy
   app's own functions. Those are per-player-visible values, so a corp the
   player has no visibility into contributes 0 rather than a wrong number. The
   board is honest about that (see `partial`). */
export function standings() {
  const b = bridge();
  const rows = [];
  let partial = false;

  for (const link of Community.corps) {
    if (!link || link.status !== 'active') continue;
    const meta = Community.corpMeta[link.corp_id] || {};
    let territory = 0, treasury = 0, known = false;
    try {
      territory = b.corpRegionControl(link.corp_id) || 0;
      treasury = b.corpTreasury(link.corp_id) || 0;
      known = territory > 0 || treasury > 0;
    } catch (e) { /* stays 0 */ }
    if (!known) partial = true;
    rows.push({
      corpId: link.corp_id,
      name: meta.name || 'Unknown corporation',
      tag: meta.tag || '—',
      faction: meta.faction || null,
      territory, treasury,
      since: link.affiliated_at,
    });
  }
  rows.sort((a, b2) => (b2.territory - a.territory) || (b2.treasury - a.treasury));

  // Contribution is fully ours, so it is always exact.
  const byUser = {};
  let contributed = 0;
  for (const e of Community.ledger) {
    if (!e || e.kind !== 'contribution') continue;
    const amt = Number(e.amount) || 0;
    contributed += amt;
    const k = e.user_id || e.user_name || '?';
    if (!byUser[k]) byUser[k] = { name: e.user_name || 'Survivor', amount: 0 };
    byUser[k].amount += amt;
  }
  const contributors = Object.values(byUser).sort((a, b2) => b2.amount - a.amount);

  return {
    corps: rows,
    partial,
    contributed,
    contributors,
    activeMembers: Community.members.filter((m) => m && m.status === 'active').length,
    pendingMembers: Community.members.filter((m) => m && m.status === 'pending').length,
    pendingCorps: Community.corps.filter((c) => c && c.status === 'pending').length,
  };
}

/* ── PHASE 2 derivations ─────────────────────────────────────────────────── */

// Tally a vote from the ballots themselves rather than trusting a stored count.
// A tally nobody can audit is not a vote.
export function tally(voteId) {
  const rows = Community.ballots.filter((b) => b && b.vote_id === voteId);
  const counts = {};
  rows.forEach((b) => { counts[b.choice] = (counts[b.choice] || 0) + 1; });
  const uid = bridge().userId();
  const mine = rows.find((b) => b.user_id === uid);
  return { counts, total: rows.length, myChoice: mine ? mine.choice : null };
}

/* Objectives are POINTERS at Territory Wars nodes — progress is read live from
   TW every time, never stored. A stored copy would drift from the real war the
   moment anyone captured anything, and then the board would be lying. */
export function objectives() {
  const b = bridge();
  let nodes = [];
  try { nodes = b.twNodes() || []; } catch (e) { nodes = []; }
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });
  return Community.objectives.map((o) => {
    const n = byId[o.node_id] || null;
    return {
      id: o.id,
      nodeId: o.node_id,
      label: o.label || (n && n.name) || o.node_id,
      known: !!n,                 // false → TW has no such node for this client
      held: !!(n && n.owned),
      heldByOurCorp: !!(n && n.oursByCorp),
      region: n && n.region,
    };
  });
}

// The community pot IS the ledger: balance = sum(amount), contributions
// positive and distributions negative. There is no balance column to drift.
export function pot() {
  let total = 0;
  for (const e of Community.ledger) total += Number(e.amount) || 0;
  return Math.floor(total);
}

// What THIS player can claim right now.
export function myUnclaimedRewards() {
  const uid = bridge().userId();
  if (!uid) return 0;
  return Community.rewards
    .filter((r) => r && r.user_id === uid && !r.claimed_at)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

export { api };
