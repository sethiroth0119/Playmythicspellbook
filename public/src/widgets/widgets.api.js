/* widgets.api.js — EVERY read/write of saved widgets. Two stores, one shape,
   exactly like mapforge.api.js: cloud (public.ui_widgets, sql/040) when
   signed in and the table exists, localStorage otherwise / as the fallback.

   LIVE is the whole point of a widget: a live document is applied to every
   player's game. That is why the trigger in sql/040 lets only public.is_admin()
   set live, and why the loader also caches the live set on the device
   (aw_live_cache) so a guest or an offline session keeps the last UI it saw. */

import { serialize, normalize } from './widgets.format.js';

const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;
const TABLE = 'ui_widgets';
const LS_INDEX = 'aw_widgets_v1', LS_DOC = 'aw_widget_', LS_LIVE_CACHE = 'aw_live_cache_v1', LS_DRAFT = 'aw_draft_v1';

function bridge() { try { return window.MythicBridge || null; } catch (e) { return null; } }
function supabase() { try { const b = bridge(); return (b && b.cloud && b.cloud.client && b.signedIn()) ? b.cloud.client : null; } catch (e) { return null; } }
export function userId() { try { const b = bridge(); return (b && b.userId()) || null; } catch (e) { return null; } }
export function displayName() { try { const b = bridge(); return (b && b.displayName()) || 'Designer'; } catch (e) { return 'Designer'; } }
export function isAdmin() { try { const b = bridge(); return !!(b && b.isAdmin()); } catch (e) { return false; } }
function fail(e) { const msg = (e && (e.message || e.msg)) || String(e || ''); return { ok: false, missing: MISSING_RE.test(msg), error: msg }; }

/* ── local ── */
function lsIndex() { try { const x = JSON.parse(localStorage.getItem(LS_INDEX) || '{}'); return x && typeof x === 'object' ? x : {}; } catch (e) { return {}; } }
function lsWrite(ix) { localStorage.setItem(LS_INDEX, JSON.stringify(ix)); }
export function localList() { const ix = lsIndex(); return Object.keys(ix).map(id => Object.assign({ id, source: 'local', mine: true }, ix[id])).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)); }
export function localLoad(id) { try { const raw = localStorage.getItem(LS_DOC + id); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; } }
export function localSave(doc) {
  const d = serialize(doc);
  try { localStorage.setItem(LS_DOC + d.id, JSON.stringify(d)); const ix = lsIndex(); const prev = ix[d.id] || {}; ix[d.id] = { name: d.name, kind: d.kind, target: d.target, live: !!prev.live, updated_at: d.meta.updated }; lsWrite(ix); return { ok: true, source: 'local' }; }
  catch (e) { return { ok: false, error: /quota/i.test(String(e && e.name || e)) ? 'This device is out of local storage.' : (e && e.message) || String(e) }; }
}
export function localDelete(id) { try { localStorage.removeItem(LS_DOC + id); const ix = lsIndex(); delete ix[id]; lsWrite(ix); return { ok: true }; } catch (e) { return fail(e); } }
export function localSetLive(id, on) { try { const ix = lsIndex(); if (!ix[id]) return { ok: false, error: 'not found' }; ix[id].live = !!on; lsWrite(ix); return { ok: true }; } catch (e) { return fail(e); } }
export function localLiveAll() { const ix = lsIndex(); return Object.keys(ix).filter(id => ix[id].live).map(localLoad).filter(Boolean); }
export function saveDraft(doc) { try { localStorage.setItem(LS_DRAFT, JSON.stringify(serialize(doc))); } catch (e) {} }
export function loadDraft() { try { const raw = localStorage.getItem(LS_DRAFT); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; } }
export function clearDraft() { try { localStorage.removeItem(LS_DRAFT); } catch (e) {} }

/* ── cloud ── */
export async function cloudList() {
  const c = supabase(); if (!c) return { ok: false, offline: true, rows: [] };
  try {
    const me = userId();
    const r = await c.from(TABLE).select('id,owner_id,owner_name,name,kind,target,live,updated_at').or('live.eq.true' + (me ? ',owner_id.eq.' + me : '')).order('updated_at', { ascending: false }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: (r.data || []).map(x => ({ id: x.id, name: x.name, kind: x.kind, target: x.target || {}, live: !!x.live, owner_id: x.owner_id, owner_name: x.owner_name, updated_at: Date.parse(x.updated_at) || 0, source: 'cloud', mine: !!me && x.owner_id === me })) };
  } catch (e) { return { ...fail(e), rows: [] }; }
}
export async function cloudLoad(id) {
  const c = supabase(); if (!c) return { ok: false, offline: true, doc: null };
  try {
    const r = await c.from(TABLE).select('id,name,kind,target,live,owner_id,data').eq('id', id).maybeSingle();
    if (r.error) return { ...fail(r.error), doc: null };
    if (!r.data) return { ok: false, error: 'Widget not found.', doc: null };
    return { ok: true, doc: normalize(Object.assign({}, r.data.data || {}, { id: r.data.id, name: r.data.name, kind: r.data.kind })), live: !!r.data.live, mine: r.data.owner_id === userId() };
  } catch (e) { return { ...fail(e), doc: null }; }
}
export async function cloudSave(doc) {
  const c = supabase(); if (!c) return { ok: false, offline: true };
  const me = userId(); if (!me) return { ok: false, offline: true };
  try {
    const d = serialize(doc);
    const r = await c.from(TABLE).upsert({ id: d.id, owner_id: me, owner_name: displayName(), name: d.name, kind: d.kind, target: d.target, data: d }, { onConflict: 'id' }).select('id').maybeSingle();
    return r.error ? fail(r.error) : { ok: true, source: 'cloud' };
  } catch (e) { return fail(e); }
}
export async function cloudDelete(id) { const c = supabase(); if (!c) return { ok: false, offline: true }; try { const r = await c.from(TABLE).delete().eq('id', id); return r.error ? fail(r.error) : { ok: true }; } catch (e) { return fail(e); } }
export async function cloudSetLive(id, on) { const c = supabase(); if (!c) return { ok: false, offline: true }; try { const r = await c.from(TABLE).update({ live: !!on }).eq('id', id); return r.error ? fail(r.error) : { ok: true }; } catch (e) { return fail(e); } }
export async function cloudLiveAll() {
  const c = supabase(); if (!c) return { ok: false, offline: true, docs: [] };
  try {
    const r = await c.from(TABLE).select('id,name,kind,data').eq('live', true).order('updated_at', { ascending: false }).limit(100);
    if (r.error) return { ...fail(r.error), docs: [] };
    return { ok: true, docs: (r.data || []).map(x => normalize(Object.assign({}, x.data || {}, { id: x.id, name: x.name, kind: x.kind }))) };
  } catch (e) { return { ...fail(e), docs: [] }; }
}

/* ── merged ── */
export async function listAll() { const cl = await cloudList(); return { rows: cl.rows.concat(localList()), cloudOk: !!cl.ok, cloudMissing: !!cl.missing, offline: !!cl.offline, error: cl.error }; }
export async function load(id, source) { if (source === 'cloud') return cloudLoad(id); const doc = localLoad(id); return doc ? { ok: true, doc, mine: true } : { ok: false, error: 'Local widget not found.', doc: null }; }
export async function save(doc, source) {
  if (source === 'cloud') { const r = await cloudSave(doc); if (r.ok) { localDelete(doc.id); return r; } const l = localSave(doc); return l.ok ? { ok: true, source: 'local', fellBack: true, error: r.error, offline: r.offline, missing: r.missing } : { ok: false, error: r.error || l.error }; }
  return localSave(doc);
}
export async function remove(id, source) { return source === 'cloud' ? cloudDelete(id) : localDelete(id); }
export async function setLive(id, source, on) { return source === 'cloud' ? cloudSetLive(id, on) : localSetLive(id, on); }
/* Everything that should be applied to the game right now: the cloud's live
   set (cached on the device for the next offline start) + this device's
   local live docs (a designer previewing before going cloud-live). */
export async function liveAll() {
  const cl = await cloudLiveAll();
  let cloudDocs = cl.docs;
  if (cl.ok) { try { localStorage.setItem(LS_LIVE_CACHE, JSON.stringify(cloudDocs.map(serialize))); } catch (e) {} }
  else { try { cloudDocs = (JSON.parse(localStorage.getItem(LS_LIVE_CACHE) || '[]') || []).map(normalize); } catch (e) { cloudDocs = []; } }
  const local = localLiveAll();
  const seen = new Set(); const out = [];
  cloudDocs.concat(local).forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); out.push(d); } });
  return { docs: out, cloudOk: !!cl.ok, cached: !cl.ok && cloudDocs.length > 0 };
}
