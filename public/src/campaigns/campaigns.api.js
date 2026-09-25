/* ═══════════════════════════════════════════════════════════════════════════
   campaigns.api.js — EVERY Supabase call for node campaigns. Nothing else in
   /src/campaigns touches the client.

   ⚠ EVERY call degrades (the Corp.* / community.api pattern). sql/038 may not
   have been run, the player may be signed out, the network may be gone — none
   of that may throw at a caller. Reads return empty data plus a `missing`
   flag; writes return { ok:false, error } and the UI says so.
   ═══════════════════════════════════════════════════════════════════════════ */
import { bridge } from './campaigns.bridge.js';

const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache|Could not find the function/i;

function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}
function fail(e) {
  const msg = (e && (e.message || e.msg || e.error)) || String(e || '');
  return { ok: false, missing: MISSING_RE.test(msg), error: msg };
}
const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

// Every active campaign. The table is tiny (a handful of drives), so one read
// serves every node and the client filters by node_id.
export async function listCampaigns() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('node_campaigns').select('*').eq('active', true).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

// Progress totals, top 25, my totals, my Ⓜ — aggregated server-side.
export async function board(campaignId) {
  const c = client(); if (!c) return { ...OFFLINE, data: null };
  try {
    const r = await c.rpc('node_campaign_board', { p_campaign_id: campaignId });
    if (r.error) return { ...fail(r.error), data: null };
    const d = r.data || null;
    if (!d || d.ok === false) return { ok: false, missing: false, error: (d && d.error) || 'rpc_failed', data: null };
    return { ok: true, data: d };
  } catch (e) { return { ...fail(e), data: null }; }
}

// The ONLY write. Cinder is debited by the server inside this call.
export async function give(campaignId, resource, amount) {
  const c = client(); if (!c) return { ...OFFLINE };
  try {
    const r = await c.rpc('node_campaign_give', {
      p_campaign_id: campaignId, p_resource: resource, p_amount: Math.floor(amount),
    });
    if (r.error) return fail(r.error);
    const d = r.data || null;
    if (!d || d.ok === false) return { ok: false, missing: false, error: (d && d.error) || 'rpc_failed', data: d };
    return { ok: true, data: d };
  } catch (e) { return fail(e); }
}

// Admin: create / update a campaign row. RLS enforces is_admin(); the client
// gate is only a courtesy so a non-admin never sees the form.
export async function saveCampaign(row) {
  const c = client(); if (!c) return { ...OFFLINE };
  try {
    const r = await c.from('node_campaigns').upsert(row, { onConflict: 'id' }).select('*').maybeSingle();
    if (r.error) return fail(r.error);
    return { ok: true, row: r.data || row };
  } catch (e) { return fail(e); }
}

export async function deactivateCampaign(id) {
  const c = client(); if (!c) return { ...OFFLINE };
  try {
    const r = await c.from('node_campaigns').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (r.error) return fail(r.error);
    return { ok: true };
  } catch (e) { return fail(e); }
}

// My Ⓜ entitlements for a campaign (RLS: own rows only).
export async function myAirdrops(campaignId) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [] };
  const b = bridge(); const uid = b && b.userId();
  if (!uid) return { ...OFFLINE, rows: [] };
  try {
    const r = await c.from('node_campaign_airdrops')
      .select('id,mt_amount,reason,status,created_at').eq('campaign_id', campaignId).eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(50);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}
