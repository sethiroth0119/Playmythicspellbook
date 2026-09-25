/* ════════════════════════════════════════════════════════════════════════════
   🛠 THE FOUNDRY — admin model editor. Swap any machine for your own .glb.
   ----------------------------------------------------------------------------
   Mirrors the card shop's model editor (index.html ~160902), which already
   proved the shape in this game: a row per object with a `model_url` field, an
   upload button that pushes into the `models` Supabase bucket, and per-model
   scale / rotation trims you true up once after the asset lands.

   🔴 UPLOADS REUSE _csShopUploadModel THROUGH THE BRIDGE. That function already
   creates the bucket if missing, sets the right content type, enforces the size
   limit and turns a Supabase size error into a sentence a human can act on
   ("run the models-bucket size migration, raise the Storage upload limit, or
   compress the model"). A second uploader here would re-earn every one of those
   the hard way.

   🔴 A MODEL IS NEVER REQUIRED. Clearing the URL returns that machine to its
   procedural body instantly. models.js will not render an empty space no matter
   what is in this table, which is what makes it safe for an admin to experiment
   against a live game — the worst case is a machine that looks wrong, never a
   floor the player cannot navigate.

   ⚠ ROTATION IS ENTERED IN DEGREES AND STORED IN RADIANS. Every 3D field in
   this codebase stores radians (`rotation_y`), and every human types degrees.
   Converting at the edge, once, is why the field can say "180" and mean it.
   ════════════════════════════════════════════════════════════════════════════ */

import { MACHINES } from './machines.js';
import { STATIONS } from './models.js';
import { esc } from './render.js';

const DEG = 180 / Math.PI;
const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

/* Everything an admin can re-skin: the machines, then the three desks. */
export function skinnable() {
  return MACHINES.map(d => ({ id: d.id, name: d.name, emoji: d.emoji, kind: 'Machine' }))
    .concat(STATIONS.map(s => ({ id: s.id, name: s.label, emoji: s.emoji, kind: 'Station' })));
}

export function renderAdmin(h) {
  let forge = {};
  try { forge = h.forgeFoundry() || {}; } catch (e) { forge = {}; }
  const models = forge.models || {};
  const rows = skinnable().map(t => {
    const m = models[t.id] || {};
    const on = !!m.url;
    return `<div class="fdy-card ${on ? '' : 'halt'}" data-fdy-mrow="${esc(t.id)}">
      <h4>${t.emoji} ${esc(t.name)}<span class="fdy-lv">${on ? 'custom .glb' : 'built-in'}</span></h4>
      <input class="fdy-sel" data-mf="url" placeholder="https://….glb — blank uses the built-in shape" value="${esc(m.url || '')}">
      <div class="fdy-row" style="gap:5px">
        <label class="fdy-cost" style="flex:1;min-width:74px">Scale<input class="fdy-sel" data-mf="scale" type="number" step="0.05" min="0.01" value="${num(m.scale, 1)}"></label>
        <label class="fdy-cost" style="flex:1;min-width:74px">Turn°<input class="fdy-sel" data-mf="ry" type="number" step="15" value="${m.ry === undefined || m.ry === null ? '' : Math.round(m.ry * DEG)}"></label>
        <label class="fdy-cost" style="flex:1;min-width:74px">Lift<input class="fdy-sel" data-mf="y" type="number" step="0.05" value="${num(m.y, 0)}"></label>
      </div>
      <label class="fdy-cost" style="display:block">Animation clip <input class="fdy-sel" data-mf="clip" placeholder="name or index — blank plays all" value="${esc(m.clip == null ? '' : m.clip)}"></label>
      <div class="fdy-row">
        <button class="fdy-btn" data-fdy-upload="${esc(t.id)}">Upload .glb</button>
        <button class="fdy-btn pri" data-fdy-msave="${esc(t.id)}">Apply</button>
        ${on ? `<button class="fdy-btn" data-fdy-mclear="${esc(t.id)}">Use built-in</button>` : ''}
      </div>
      <div class="fdy-flow" data-fdy-mnote="${esc(t.id)}"></div>
    </div>`;
  }).join('');
  return `<div class="fdy-alert"><b>🛠 Model editor.</b> Drop a .glb on any machine and it swaps live for every
    player — no redeploy. Blank the URL to fall back to the built-in shape. Trim <b>Scale</b> / <b>Turn°</b> / <b>Lift</b>
    until it sits right on its plinth; the state glow stays on top of your model either way.</div>
    <div class="fdy-grid">${rows}</div>`;
}

/* Read one row's fields back into the stored shape. Returns null for "no model",
   which is what clears the override. */
export function readRow(rowEl) {
  const g = (k) => { const el = rowEl.querySelector(`[data-mf="${k}"]`); return el ? el.value.trim() : ''; };
  const url = g('url');
  if (!url) return null;
  const ryDeg = g('ry');
  const clip = g('clip');
  return {
    url,
    scale: Math.max(0.01, num(g('scale'), 1)),
    // Blank Turn° means "leave the model's own facing alone", which is a real
    // and different answer from 0 (force it to face north). Storing null keeps
    // that distinction; models.js only sets rotation.y when it is not null.
    ry: ryDeg === '' ? null : (num(ryDeg, 0) / DEG),
    y: num(g('y'), 0),
    clip: clip === '' ? null : (/^\d+$/.test(clip) ? parseInt(clip, 10) : clip),
  };
}

/* Persist. Writes through the bridge to Forge.foundry.models and saves. Returns
   { ok, why } like every other action in this feature — never throws. */
export function applyModel(h, id, cfg) {
  try {
    const forge = h.forgeFoundry() || {};
    if (!forge.models || typeof forge.models !== 'object') forge.models = {};
    if (cfg) forge.models[id] = cfg; else delete forge.models[id];
    if (!h.saveForge(forge)) return { ok: false, why: 'Could not save the model config.' };
    return { ok: true };
  } catch (e) { return { ok: false, why: 'Could not save the model config.' }; }
}

export default { renderAdmin, readRow, applyModel, skinnable };
