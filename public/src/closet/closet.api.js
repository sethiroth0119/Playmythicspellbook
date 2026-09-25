/* closet.api.js — where the closet's CATALOGUE lives: brands, items, bodies.

   Cloud: public.closet_brands / closet_items / closet_bodies (sql/132), one
   row per record, `data` = the record. Everyone signed in reads what is
   PUBLISHED plus their own drafts; only the owner (or an admin) writes.
   Device: localStorage `mythic_closet_v1` — the same three lists — for a
   signed-out studio session, a sandbox with no tables yet, or a cloud
   failure. The catalogue a scene sees is the UNION, cloud winning on an id
   clash, so nothing an author made ever vanishes because a table was
   missing that day (the Corp.* rule: degrade, never break).

   ⚠ Never a UPDATE of a balance here — money is not this file's business.
     Purchases go through closet.bridge.js → index.html's spendGems(). */

import { supabase, userId, displayName, isAdmin } from '../mapforge/mapforge.bridge.js';
import { normalizeBrand, normalizeItem, normalizeBody } from './closet.model.js';

const LS = 'mythic_closet_v1';
const TABLES = { brands: 'closet_brands', items: 'closet_items', bodies: 'closet_bodies' };
const NORM = { brands: normalizeBrand, items: normalizeItem, bodies: normalizeBody };
const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;
function fail(e) { const msg = (e && (e.message || e.msg)) || String(e || ''); return { ok: false, missing: MISSING_RE.test(msg), error: msg }; }

/* ── device store ── */
function readLS() { try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); return j && typeof j === 'object' ? { brands: j.brands || [], items: j.items || [], bodies: j.bodies || [] } : { brands: [], items: [], bodies: [] }; } catch (e) { return { brands: [], items: [], bodies: [] }; } }
function writeLS(d) { try { localStorage.setItem(LS, JSON.stringify(d)); return true; } catch (e) { return false; } }
export function localCatalog() { const d = readLS(); return { brands: d.brands.map(normalizeBrand), items: d.items.map(normalizeItem), bodies: d.bodies.map(normalizeBody) }; }
function localPut(kind, rec) { const d = readLS(); const i = d[kind].findIndex(x => x && x.id === rec.id); if (i >= 0) d[kind][i] = rec; else d[kind].push(rec); return writeLS(d); }
function localDel(kind, id) { const d = readLS(); d[kind] = d[kind].filter(x => x && x.id !== id); return writeLS(d); }

/* ── cloud ── */
let cache = { at: 0, cat: null, missing: false };
export function invalidate() { cache = { at: 0, cat: null, missing: false }; }

async function cloudList(kind) {
  const c = supabase(); if (!c) return { ok: false, offline: true, rows: [] };
  try {
    const r = await c.from(TABLES[kind]).select('id,owner_id,owner_name,published,data,updated_at').order('updated_at', { ascending: false }).limit(2000);
    if (r.error) return { ...fail(r.error), rows: [] };
    const rows = (r.data || []).map(x => NORM[kind](Object.assign({}, x.data || {}, { id: x.id, owner_id: x.owner_id, owner_name: x.owner_name, published: x.published !== false, created_at: Date.parse(x.updated_at) || 0 })));
    return { ok: true, rows };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* THE catalogue: cloud ∪ device, cached for a minute (a hub with twenty
   peers asks for it twenty times in a second). `force` refetches. */
let inflight = null;
export function catalog(force) {
  if (!force && cache.cat && Date.now() - cache.at < 60000) return Promise.resolve(cache.cat);
  if (inflight && !force) return inflight;
  inflight = fetchCatalog().finally(() => { inflight = null; });
  return inflight;
}
async function fetchCatalog() {
  const local = localCatalog();
  const out = { brands: [], items: [], bodies: [], cloud: false, missing: false, error: '' };
  const merged = { brands: new Map(), items: new Map(), bodies: new Map() };
  ['brands', 'items', 'bodies'].forEach(k => local[k].forEach(r => merged[k].set(r.id, Object.assign(r, { local: true }))));
  if (supabase()) {
    const rs = await Promise.all(['brands', 'items', 'bodies'].map(k => cloudList(k)));
    rs.forEach((r, i) => { const k = ['brands', 'items', 'bodies'][i]; if (r.ok) { out.cloud = true; r.rows.forEach(x => merged[k].set(x.id, x)); } else { if (r.missing) out.missing = true; if (r.error) out.error = r.error; } });
  }
  ['brands', 'items', 'bodies'].forEach(k => { out[k] = Array.from(merged[k].values()); });
  out.items.sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || a.name.localeCompare(b.name));
  out.brands.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), cat: out, missing: out.missing };
  return out;
}
export function cached() { return cache.cat; }

/* ── writes ──
   Cloud when signed in and the table answers; the device otherwise (and the
   result says which, so the studio can tell the author). An admin may write
   any row; anyone else only their own. */
async function put(kind, rec) {
  rec = NORM[kind](rec);
  const c = supabase(), me = userId();
  if (c && me) {
    try {
      const data = Object.assign({}, rec); delete data.owner_id; delete data.owner_name; delete data.created_at; delete data.local;
      const row = { id: rec.id, owner_id: rec.owner_id || me, owner_name: rec.owner_name || displayName(), published: rec.published !== false, data, updated_at: new Date().toISOString() };
      if (row.owner_id !== me && !isAdmin()) row.owner_id = me;
      const r = await c.from(TABLES[kind]).upsert(row, { onConflict: 'id' }).select('id').maybeSingle();
      if (!r.error) { invalidate(); localDel(kind, rec.id); return { ok: true, where: 'cloud', rec: Object.assign(rec, { owner_id: row.owner_id, owner_name: row.owner_name }) }; }
      const f = fail(r.error); if (!f.missing) { /* a policy refusal: keep it on the device rather than lose it */ localPut(kind, rec); invalidate(); return { ok: true, where: 'device', warn: f.error, rec }; }
    } catch (e) { const f = fail(e); if (!f.missing) { localPut(kind, rec); invalidate(); return { ok: true, where: 'device', warn: f.error, rec }; } }
  }
  const ok = localPut(kind, rec); invalidate();
  return ok ? { ok: true, where: 'device', rec } : { ok: false, error: 'This device refused to store the record (storage full?).' };
}
async function del(kind, id) {
  const c = supabase();
  let cloudOk = false;
  if (c) { try { const r = await c.from(TABLES[kind]).delete().eq('id', id); cloudOk = !r.error; } catch (e) {} }
  localDel(kind, id); invalidate();
  return { ok: true, cloud: cloudOk };
}
export const brands = { put: (r) => put('brands', r), remove: (id) => del('brands', id) };
export const items = { put: (r) => put('items', r), remove: (id) => del('items', id) };
export const bodies = { put: (r) => put('bodies', r), remove: (id) => del('bodies', id) };

/* Everything a MODEL could be: the closet's own record, or any Athena file /
   project model — the studio's "pick a model" list. Reads Athena's uploaded
   files (world_assets) and the project manifest through the same modules
   the editor uses; both are optional. */
export async function modelSources() {
  const out = [];
  try { const f = await import('../mapforge/mapforge.files.js'); const r = await f.list(); (r.rows || []).filter(x => x.kind === 'model').forEach(x => out.push({ label: x.name, url: x.url, from: 'files' })); } catch (e) {}
  try { const r = await fetch('/models/manifest.json', { cache: 'no-cache' }); if (r.ok) { const j = await r.json(); (j.models || []).forEach(m => { if (m && m.url) out.push({ label: m.label || m.id || m.url, url: m.url, from: 'project' }); }); } } catch (e) {}
  return out;
}
