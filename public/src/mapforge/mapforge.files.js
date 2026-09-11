/* (was mapforge.assets.js in build B — renamed in the merge because build A's asset-browser index owns that name)
/* mapforge.assets.js — the FILES uploaded to the engine.

   Asked for: "add a section where all of the files that were uploaded to
   the engine are; allow me to upload GLB, audio, animations and VFX files."

   Bytes go to the public `models` storage bucket under
   {uid}/athena/{kind}/{stamp}_{name} — the owner-folder policy that already
   covers player shop models covers this — and one row per file lands in
   public.world_assets (sql/112) so the Files tab can list every upload,
   whoever made it. A map never copies a file: it references the URL.

   Kinds, and how a file is told apart:
     model  .glb / .gltf with meshes                → Library → Models, place it
     anim   .glb / .gltf whose clips are the point  → apply to a placed model
     audio  .mp3 / .wav / .ogg / .m4a               → a 🔊 sound marker
     vfx    .json preset { kind, tint, s, i, label } → an fx_* emitter
   `inspect(file)` — handed in by the editor because only it has three.js —
   reads clip names and mesh counts off a GLB so the kind can be decided and
   the clips remembered without loading the file twice. */

import { supabase, userId, displayName } from './mapforge.bridge.js';
import { uid } from './mapforge.format.js';

const TABLE = 'world_assets', BUCKET = 'models';
const MISSING_RE = /PGRST205|PGRST202|does not exist|schema cache/i;
const MAX_BYTES = 60 * 1024 * 1024;
export const KINDS = ['model', 'anim', 'audio', 'vfx'];
export const KIND_ICON = { model: '🧊', anim: '🎞', audio: '🔊', vfx: '✨' };
export const KIND_LABEL = { model: 'Model', anim: 'Animation', audio: 'Audio', vfx: 'VFX preset' };
export const ACCEPT = '.glb,.gltf,.mp3,.wav,.ogg,.m4a,.json,model/gltf-binary,audio/*,application/json';

function fail(e) { const msg = (e && (e.message || e.msg)) || String(e || ''); return { ok: false, missing: MISSING_RE.test(msg), error: msg }; }
const ext = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

/* What a file IS, from its name and — for a GLB — what inspect() found. */
export function kindOf(file, meta, forced) {
  if (forced && KINDS.includes(forced)) return forced;
  const x = ext(file && file.name);
  if (x === 'mp3' || x === 'wav' || x === 'ogg' || x === 'm4a' || x === 'aac') return 'audio';
  if (x === 'json') return 'vfx';
  if (x === 'glb' || x === 'gltf') {
    const clips = meta && Array.isArray(meta.clips) ? meta.clips.length : 0;
    const meshes = meta && Number.isFinite(meta.meshes) ? meta.meshes : 1;
    if (clips && (meshes === 0 || /anim|clip|motion|walk|idle|run/i.test(file.name))) return 'anim';
    return 'model';
  }
  return null;
}
export function contentTypeOf(file) {
  const x = ext(file && file.name);
  if (x === 'glb') return 'model/gltf-binary';
  if (x === 'gltf') return 'model/gltf+json';
  if (x === 'mp3') return 'audio/mpeg'; if (x === 'wav') return 'audio/wav'; if (x === 'ogg') return 'audio/ogg'; if (x === 'm4a' || x === 'aac') return 'audio/mp4';
  if (x === 'json') return 'application/json';
  return (file && file.type) || 'application/octet-stream';
}

export async function list() {
  const c = supabase(); if (!c) return { ok: false, offline: true, rows: [] };
  try {
    const me = userId();
    const r = await c.from(TABLE).select('id,owner_id,owner_name,kind,name,url,path,bytes,meta,created_at').order('created_at', { ascending: false }).limit(500);
    if (r.error) return { ...fail(r.error), rows: [] };
    const rows = (r.data || []).map(x => ({ id: x.id, kind: x.kind, name: x.name, url: x.url, path: x.path, bytes: x.bytes | 0, meta: x.meta || {}, owner_id: x.owner_id, owner_name: x.owner_name, created_at: Date.parse(x.created_at) || 0, mine: !!me && x.owner_id === me }));
    return { ok: true, rows };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* Upload one file: bytes to the bucket, then the index row. A row that
   cannot be written removes the bytes again, so the bucket never carries a
   file the list does not know about. */
export async function upload(file, opts) {
  opts = opts || {};
  const c = supabase(); if (!c) return { ok: false, offline: true, error: 'Sign in to upload files.' };
  const me = userId(); if (!me) return { ok: false, offline: true, error: 'Sign in to upload files.' };
  if (!file) return { ok: false, error: 'No file.' };
  if (file.size > MAX_BYTES) return { ok: false, error: file.name + ' is ' + (file.size / 1048576).toFixed(1) + ' MB — over the ' + (MAX_BYTES / 1048576) + ' MB limit.' };
  let meta = {};
  try { if (opts.inspect) meta = (await opts.inspect(file)) || {}; } catch (e) { meta = {}; }
  const kind = kindOf(file, meta, opts.kind);
  if (!kind) return { ok: false, error: 'Unsupported file: ' + file.name + '. Upload .glb / .gltf, .mp3 / .wav / .ogg / .m4a, or a .json VFX preset.' };
  if (kind === 'vfx') {
    try { const p = JSON.parse(await file.text()); if (!p || typeof p !== 'object' || !p.kind) return { ok: false, error: 'A VFX preset is JSON with at least { "kind": "fire" } — kinds: fire, bigfire, smoke, darksmoke, steam, fog, sparks, toxic, dust, motes.' }; meta = { preset: p.kind, label: p.label || '' }; }
    catch (e) { return { ok: false, error: file.name + ' is not valid JSON.' }; }
  }
  const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = me + '/athena/' + kind + '/' + Date.now().toString(36) + '_' + safe;
  try {
    const up = await c.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: contentTypeOf(file) });
    if (up.error) return fail(up.error);
    const pub = c.storage.from(BUCKET).getPublicUrl(path);
    const url = pub && pub.data && pub.data.publicUrl;
    if (!url) { try { await c.storage.from(BUCKET).remove([path]); } catch (e) {} return { ok: false, error: 'No public URL came back for the upload.' }; }
    const row = { id: uid('wa_'), owner_id: me, owner_name: displayName(), kind, name: String(opts.name || file.name || 'file').slice(0, 120), url, path, bytes: file.size | 0, meta };
    const r = await c.from(TABLE).insert(row).select('id').maybeSingle();
    if (r.error) { try { await c.storage.from(BUCKET).remove([path]); } catch (e) {} return fail(r.error); }
    return { ok: true, row: Object.assign({ mine: true, created_at: Date.now() }, row) };
  } catch (e) { return fail(e); }
}

export async function remove(row) {
  const c = supabase(); if (!c) return { ok: false, offline: true };
  try {
    const r = await c.from(TABLE).delete().eq('id', row.id);
    if (r.error) return fail(r.error);
    if (row.path) { try { await c.storage.from(BUCKET).remove([row.path]); } catch (e) {} }
    return { ok: true };
  } catch (e) { return fail(e); }
}
