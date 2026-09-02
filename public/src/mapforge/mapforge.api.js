/* mapforge.api.js — EVERY read/write of saved maps. Nothing else in
   /src/mapforge touches Supabase or localStorage for map data.

   Two stores, one shape:
     cloud  → public.world_maps (sql/038). Needs a signed-in player AND the
              migration applied. Every call degrades: `missing` means the
              table is not there yet, `offline` means not signed in.
     local  → localStorage. Always available, per device, no sync. This is
              where a guest's maps live, and where a cloud save lands when
              the cloud refuses (quota, offline, RLS) so work is never lost.
   A map lives in exactly one store; "upload" moves it local → cloud.

   The document itself is opaque here (see mapforge.format.js). The index
   row carries only what the Maps list needs so listing stays cheap. */

import { supabase, userId, displayName } from './mapforge.bridge.js';
import { serialize, normalize } from './mapforge.format.js';

const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;
const LS_INDEX = 'mf_maps_v1', LS_MAP = 'mf_map_', LS_DRAFT = 'mf_draft_v1';
const TABLE = 'world_maps';

function fail(e) { const msg = (e && (e.message || e.msg)) || String(e || ''); return { ok: false, missing: MISSING_RE.test(msg), error: msg }; }

/* ── local ── */
function lsIndex() { try { const x = JSON.parse(localStorage.getItem(LS_INDEX) || '{}'); return x && typeof x === 'object' ? x : {}; } catch (e) { return {}; } }
function lsWriteIndex(ix) { localStorage.setItem(LS_INDEX, JSON.stringify(ix)); }

export function localList() {
  const ix = lsIndex();
  return Object.keys(ix).map(id => Object.assign({ id, source: 'local', mine: true }, ix[id])).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}
export function localLoad(id) {
  try { const raw = localStorage.getItem(LS_MAP + id); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; }
}
export function localSave(map) {
  const doc = serialize(map);
  try {
    localStorage.setItem(LS_MAP + doc.id, JSON.stringify(doc));
    const ix = lsIndex();
    ix[doc.id] = { name: doc.name, description: doc.description, updated_at: doc.meta.updated, objects: doc.objects.length, n: doc.terrain.n };
    lsWriteIndex(ix);
    return { ok: true, source: 'local' };
  } catch (e) {
    // QuotaExceededError — the honest message beats a silent no-op
    return { ok: false, error: /quota/i.test(String(e && e.name || e)) ? 'This device is out of local storage — delete an old map or sign in to save to the cloud.' : (e && e.message) || String(e) };
  }
}
export function localDelete(id) {
  try { localStorage.removeItem(LS_MAP + id); const ix = lsIndex(); delete ix[id]; lsWriteIndex(ix); return { ok: true }; } catch (e) { return fail(e); }
}

/* Crash-safety draft: the editor autosaves here on every change (debounced)
   so a closed tab or a crashed GPU never eats an hour of sculpting. */
export function saveDraft(map) { try { localStorage.setItem(LS_DRAFT, JSON.stringify(serialize(map))); } catch (e) {} }
export function loadDraft() { try { const raw = localStorage.getItem(LS_DRAFT); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; } }
export function clearDraft() { try { localStorage.removeItem(LS_DRAFT); } catch (e) {} }

/* ── cloud ── */
export async function cloudList() {
  const c = supabase(); if (!c) return { ok: false, offline: true, rows: [] };
  try {
    const me = userId();
    const r = await c.from(TABLE).select('id,owner_id,owner_name,name,description,is_public,updated_at,created_at')
      .or('is_public.eq.true' + (me ? ',owner_id.eq.' + me : '')).order('updated_at', { ascending: false }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    const rows = (r.data || []).map(x => ({ id: x.id, name: x.name, description: x.description, is_public: !!x.is_public, owner_id: x.owner_id, owner_name: x.owner_name, updated_at: Date.parse(x.updated_at) || 0, source: 'cloud', mine: !!me && x.owner_id === me }));
    return { ok: true, rows };
  } catch (e) { return { ...fail(e), rows: [] }; }
}
export async function cloudLoad(id) {
  const c = supabase(); if (!c) return { ok: false, offline: true, map: null };
  try {
    const r = await c.from(TABLE).select('id,name,description,data,is_public,owner_id').eq('id', id).maybeSingle();
    if (r.error) return { ...fail(r.error), map: null };
    if (!r.data) return { ok: false, error: 'Map not found (it may have been deleted or made private).', map: null };
    const map = normalize(Object.assign({}, r.data.data || {}, { id: r.data.id, name: r.data.name, description: r.data.description }));
    return { ok: true, map, is_public: !!r.data.is_public, mine: r.data.owner_id === userId() };
  } catch (e) { return { ...fail(e), map: null }; }
}
export async function cloudSave(map, isPublic) {
  const c = supabase(); if (!c) return { ok: false, offline: true };
  const me = userId(); if (!me) return { ok: false, offline: true };
  try {
    const doc = serialize(map);
    const row = { id: doc.id, owner_id: me, owner_name: displayName(), name: doc.name, description: doc.description, data: doc };
    if (isPublic != null) row.is_public = !!isPublic;
    const r = await c.from(TABLE).upsert(row, { onConflict: 'id' }).select('id').maybeSingle();
    if (r.error) return fail(r.error);
    return { ok: true, source: 'cloud' };
  } catch (e) { return fail(e); }
}
export async function cloudDelete(id) {
  const c = supabase(); if (!c) return { ok: false, offline: true };
  try { const r = await c.from(TABLE).delete().eq('id', id); return r.error ? fail(r.error) : { ok: true }; } catch (e) { return fail(e); }
}
export async function cloudSetPublic(id, on) {
  const c = supabase(); if (!c) return { ok: false, offline: true };
  try { const r = await c.from(TABLE).update({ is_public: !!on }).eq('id', id); return r.error ? fail(r.error) : { ok: true }; } catch (e) { return fail(e); }
}

/* ── merged view the UI uses ── */
export async function listMaps() {
  const cloud = await cloudList();
  return { rows: cloud.rows.concat(localList()), cloudOk: !!cloud.ok, cloudMissing: !!cloud.missing, offline: !!cloud.offline, error: cloud.error };
}
export async function loadMap(id, source) {
  if (source === 'cloud') return cloudLoad(id);
  const map = localLoad(id);
  return map ? { ok: true, map, mine: true } : { ok: false, error: 'Local map not found.', map: null };
}
/* Save where the map lives; a cloud save that fails falls back to local so
   nothing is lost, and the caller is told where it actually went. */
export async function saveMap(map, source, isPublic) {
  if (source === 'cloud') {
    const r = await cloudSave(map, isPublic);
    if (r.ok) { localDelete(map.id); return r; }
    const l = localSave(map);
    return l.ok ? { ok: true, source: 'local', fellBack: true, error: r.error, offline: r.offline, missing: r.missing } : { ok: false, error: r.error || l.error };
  }
  return localSave(map);
}
export async function deleteMap(id, source) { return source === 'cloud' ? cloudDelete(id) : localDelete(id); }
