/* ═══════════════════════════════════════════════════════════════════════════
   gridguide.api.js — EVERY cloud call for the Grid Guide. Nothing else in
   /src/gridguide touches the client.

   ⚠ EVERY call degrades (the Corp.* / campaigns.api pattern). sql/132 may not
   have been run, the player may be offline — none of that may throw at a
   caller. A failed read means "show the built-in guide", never a blank screen.

   🔴 THE GLOBALS TRAP (CLAUDE.md): Cloud / Profile are lexical globals in
   index.html and invisible here. Everything comes through window.MythicBridge.

   The client-side admin test only decides which BUTTONS to draw. The real
   gate is RLS: grid_guide_versions and the card-art bucket both accept writes
   only when ms_is_admin() is true for the caller's JWT.
   ═══════════════════════════════════════════════════════════════════════════ */

const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache|Could not find/i;
// Photos share card-art: public read, admin-only write, images only, 25 MB
// (sql/062). A folder of its own keeps them apart from card art.
const BUCKET = 'card-art';
const FOLDER = 'grid-guide';
const MAX_PHOTO = 25 * 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicBridge;
    return (b && typeof b.isAdmin === 'function') ? b : null;
  } catch (e) { return null; }
}
function client() {
  try { const b = bridge(); return (b && b.cloud && b.cloud.client) || null; } catch (e) { return null; }
}
function fail(e) {
  const msg = (e && (e.message || e.msg || e.error)) || String(e || '');
  return { ok: false, missing: MISSING_RE.test(msg), error: msg };
}

export function isAdmin() { try { const b = bridge(); return !!(b && b.isAdmin()); } catch (e) { return false; } }
export function toast(m) { try { const b = bridge(); if (b) b.toast(m, 4200); } catch (e) {} }

// The newest saved guide. Reads are open to everyone (signed out too), so a
// player who has never logged in still sees the admin's latest version.
export async function loadLatest() {
  const c = client(); if (!c) return { ok: false, offline: true, doc: null };
  try {
    const r = await c.from('grid_guide_versions').select('id, doc, created_at').order('id', { ascending: false }).limit(1);
    if (r.error) return Object.assign(fail(r.error), { doc: null });
    const row = (r.data || [])[0];
    return { ok: true, doc: row ? row.doc : null, id: row ? row.id : null, at: row ? row.created_at : null };
  } catch (e) { return Object.assign(fail(e), { doc: null }); }
}

// Every save is a NEW row, never an update: the history is the undo button,
// and a bad save can never overwrite the only good copy.
export async function saveDoc(doc) {
  const c = client(); if (!c) return { ok: false, error: 'You are offline or not signed in.' };
  if (!isAdmin()) return { ok: false, error: 'Only admins can edit this guide.' };
  try {
    const r = await c.from('grid_guide_versions').insert({ doc }).select('id').single();
    if (r.error) return fail(r.error);
    return { ok: true, id: r.data && r.data.id };
  } catch (e) { return fail(e); }
}

export async function uploadPhoto(file) {
  const c = client(); if (!c) throw new Error('You are offline or not signed in.');
  if (!isAdmin()) throw new Error('Only admins can add photos.');
  if (!file || PHOTO_TYPES.indexOf(file.type) < 0) throw new Error('Use a PNG, JPG, WebP or GIF image.');
  if (file.size > MAX_PHOTO) throw new Error('That photo is over 25 MB.');
  const safe = String(file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  const path = FOLDER + '/' + Date.now().toString(36) + '_' + safe;
  const up = await c.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(up.error.message || 'Upload failed.');
  const { data } = c.storage.from(BUCKET).getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error('Upload failed.');
  return data.publicUrl;
}
