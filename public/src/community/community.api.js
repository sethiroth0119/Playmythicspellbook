/* ═══════════════════════════════════════════════════════════════════════════
   community.api.js — EVERY Supabase call for the Community feature.
   Nothing else in /src/community touches the client. If a query lives
   somewhere else, that is the bug.

   ⚠ EVERY call degrades. The tables do not exist until sql/001..003 are run in
   the Supabase editor, and the app must stay usable before that. So no call
   here ever throws at its caller: it returns empty data plus a `missing` flag,
   and the UI says "not set up yet" instead of breaking the hub. This mirrors
   how Corp.* already behaves.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge } from './community.bridge.js';

// PostgREST codes that mean "the migration has not been run", as opposed to a
// real failure. Distinguishing them is what lets the UI say something useful.
const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;

function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}

function fail(e) {
  const msg = (e && (e.message || e.msg)) || String(e || '');
  return { ok: false, missing: MISSING_RE.test(msg), error: msg };
}
const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

/* ── READS ───────────────────────────────────────────────────────────────── */

// The directory. Every community, newest first, with member + corp counts
// resolved client-side so a missing count can never blank the whole list.
export async function listCommunities(limit = 60) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('communities')
      .select('id,name,tag,owner_id,description,banner_url,join_policy,created_at')
      .order('created_at', { ascending: false }).limit(limit);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function getCommunity(id) {
  const c = client(); if (!c) return { ...OFFLINE, row: null };
  try {
    const r = await c.from('communities').select('*').eq('id', id).maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

export async function listMembers(communityId) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('community_members')
      .select('community_id,user_id,user_name,role,status,joined_at')
      .eq('community_id', communityId).limit(500);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

// Every community THIS player belongs to (any status) — drives "my community"
// and stops the directory offering Join on one they already applied to.
export async function myMemberships() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const b = bridge();
  const uid = b && b.userId();
  if (!uid) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('community_members')
      .select('community_id,role,status').eq('user_id', uid).limit(100);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function listCorps(communityId) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('community_corps')
      .select('community_id,corp_id,status,affiliated_at')
      .eq('community_id', communityId).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

// Corp names/tags for the standings board. Separate call rather than a join so
// a corporations RLS change can never take the affiliation list down with it.
export async function corpsByIds(ids) {
  const c = client(); if (!c || !ids || !ids.length) return { ok: true, rows: [] };
  try {
    const r = await c.from('corporations').select('id,name,tag,faction,element').in('id', ids.slice(0, 200));
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function listLedger(communityId, limit = 200) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('community_ledger')
      .select('id,user_id,user_name,amount,kind,note,created_at')
      .eq('community_id', communityId)
      .order('created_at', { ascending: false }).limit(limit);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

export async function listAudit(communityId, limit = 60) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('community_audit')
      .select('id,actor_name,action,target,created_at')
      .eq('community_id', communityId)
      .order('created_at', { ascending: false }).limit(limit);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ── WRITES ──────────────────────────────────────────────────────────────── */

export async function createCommunity({ name, tag, description, joinPolicy }) {
  const c = client(); if (!c) return OFFLINE;
  const b = bridge();
  const uid = b && b.userId();
  if (!uid) return OFFLINE;
  try {
    const r = await c.from('communities').insert({
      name: String(name || '').trim().slice(0, 48),
      tag: String(tag || '').trim().slice(0, 8).toUpperCase(),
      owner_id: uid,
      description: String(description || '').trim().slice(0, 400) || null,
      join_policy: ['open', 'apply', 'closed'].includes(joinPolicy) ? joinPolicy : 'apply',
    }).select('id,name,tag,join_policy').maybeSingle();
    if (r.error) return fail(r.error);
    // The founder is their own first active member — otherwise is_community_member()
    // is false for them and they cannot read their own ledger.
    try {
      await c.from('community_members').insert({
        community_id: r.data.id, user_id: uid,
        user_name: (b.displayName() || 'Survivor').slice(0, 40),
        role: 'leader', status: 'active',
      });
    } catch (e) { /* the owner is still leadership via communities.owner_id */ }
    return { ok: true, row: r.data };
  } catch (e) { return fail(e); }
}

// Server decides open-vs-apply — see community_apply() in 001.
export async function applyToCommunity(communityId) {
  const c = client(); if (!c) return OFFLINE;
  const b = bridge();
  try {
    const r = await c.rpc('community_apply', {
      p_community_id: communityId,
      p_user_name: (b.displayName() || 'Survivor').slice(0, 40),
    });
    if (r.error) return fail(r.error);
    return { ok: true, status: r.data || 'pending' };
  } catch (e) { return fail(e); }
}

export async function setMember(communityId, userId, role, status) {
  const c = client(); if (!c) return OFFLINE;
  try {
    const r = await c.rpc('community_set_member', {
      p_community_id: communityId, p_user_id: userId,
      p_role: role || null, p_status: status || null,
    });
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function leaveCommunity(communityId) {
  const c = client(); if (!c) return OFFLINE;
  const b = bridge();
  const uid = b && b.userId();
  if (!uid) return OFFLINE;
  try {
    const r = await c.from('community_members').update({ status: 'left' })
      .eq('community_id', communityId).eq('user_id', uid);
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

// The corp founder applies; RLS re-checks founder_id, so a tampered client
// gets a policy violation rather than an affiliation.
export async function affiliateCorp(communityId, corpId) {
  const c = client(); if (!c) return OFFLINE;
  try {
    const r = await c.from('community_corps')
      .upsert({ community_id: communityId, corp_id: corpId, status: 'pending' },
              { onConflict: 'community_id,corp_id' });
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setCorpStatus(communityId, corpId, status) {
  const c = client(); if (!c) return OFFLINE;
  try {
    const r = await c.from('community_corps').update({ status })
      .eq('community_id', communityId).eq('corp_id', corpId);
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ⚠ Append-only. There is no update/delete counterpart on purpose, and the
//   grants are revoked server-side so adding one here would not work anyway.
export async function addContribution(communityId, amount, note) {
  const c = client(); if (!c) return OFFLINE;
  const b = bridge();
  const uid = b && b.userId();
  if (!uid) return OFFLINE;
  try {
    const r = await c.from('community_ledger').insert({
      community_id: communityId, user_id: uid,
      user_name: (b.displayName() || 'Survivor').slice(0, 40),
      amount: Math.floor(amount) || 0, kind: 'contribution',
      note: String(note || '').slice(0, 120) || null,
    });
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function logAction(communityId, action, target) {
  const c = client(); if (!c) return OFFLINE;
  const b = bridge();
  try {
    await c.rpc('community_log', {
      p_community_id: communityId, p_action: action,
      p_target: target || null, p_actor_name: (b.displayName() || '—').slice(0, 40),
    });
    return { ok: true };
  } catch (e) { return fail(e); }
}
