/* closet.studio.js — the CLOSET STUDIO: where clothing is made in Athena.

   Asked for: "in the Athena Engine make it where I can add clothing and
   connect it correctly to the models, so when I add a watch and measure it
   to the human models it will fit them rightfully; make clothing brands
   like Watch Dogs 2 and add what we create to the Player Closet."

   Three lists on the left — Brands, Clothing, Characters (the bodies the
   creator dresses) — the stage in the middle, the inspector on the right.
   A piece of clothing is any .glb (an Athena FILES upload, a project model
   or a URL) plus a category and a FIT. Auto-fit measures the chosen body
   (closet.rig.js) and sizes the item to it — k × the part's width, sat on
   the part's face — and every slider after that is relative to the part
   (fractions, ratios), so the same record fits a bigger character bigger.
   Change the body in the top bar and the piece re-fits itself: that is
   the check that a fit is portable, and the studio shows the numbers.

   Saved through closet.api.js: the cloud when signed in and sql/132 is
   applied, this device otherwise (the list says which). */

import { CATEGORIES, CAT_BY_ID, CURRENCIES, CURRENCY_LABEL, normalizeItem, normalizeBrand, normalizeBody, normalizeFit, normalizeOutfit, uid } from './closet.model.js';
import * as api from './closet.api.js';
import { isAdmin, toast as bridgeToast, confirm as ask } from './closet.bridge.js';
import { createStage } from './closet.stage.js';
import { measureItem } from './closet.dress.js';
import { ensureCss } from './closet.creator.js';

let UI = null;
export function isStudioOpen() { return !!UI; }
export function closeStudio() { if (UI) UI.close(); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cm = (m) => (m * 100).toFixed(1) + ' cm';
const deg = (r) => Math.round(r * 180 / Math.PI);

export async function openStudio(opts) {
  opts = opts || {};
  if (UI) return UI;
  if (!isAdmin() && !opts.force) { bridgeToast('👑 The Closet Studio is admin-only.', 2600); return null; }
  ensureCss();
  const root = document.createElement('div'); root.id = 'closet-studio'; root.className = 'cl-root';
  root.innerHTML = `
    <div class="cl-top">
      <span class="brand">👕 Closet Studio</span>
      <label style="color:var(--cl-dim);font-size:11.5px">Fit on</label><select id="cs-body" style="width:auto;max-width:200px"></select>
      <button id="cs-whole" title="See the whole character">🧍 Whole</button>
      <button id="cs-spin" title="Turn the character">↻ Turn</button>
      <label style="display:flex;align-items:center;gap:4px;font-size:11.5px;color:var(--cl-dim)"><input type="checkbox" id="cs-keep"> keep other pieces on</label>
      <span class="sp" style="flex:1"></span>
      <span class="cl-state" id="cs-state"></span>
      <button id="cs-reload" title="Reload the catalogue">↻ Reload</button>
      <button id="cs-creator" title="Open the Player Closet as a player sees it">🛍 Player view</button>
      <button id="cs-close">✕ Close</button>
    </div>
    <div class="cl-left">
      <div class="cl-sec"><h3>Brands <span class="sp"></span><button id="cs-newbrand">＋ New</button></h3><div class="cl-list" id="cs-brands"></div></div>
      <div class="cl-sec"><h3>Clothing <span class="sp"></span><button id="cs-newitem">＋ New</button></h3><div id="cs-catchips" style="margin-bottom:4px"></div><div class="cl-list" id="cs-items"></div></div>
      <div class="cl-sec"><h3>Characters <span class="sp"></span><button id="cs-newbody">＋ New</button></h3><div class="cl-list" id="cs-bodies"></div><p class="cl-hint">The bodies players dress. A rigged human (Mixamo, VRM, Ready Player Me, Rigify, Unreal) is measured bone by bone; an unrigged mannequin is measured by proportion.</p></div>
    </div>
    <div class="cl-stage" id="cs-stage"><div class="cl-focus" id="cs-focus" hidden></div><div class="cl-hint">drag to orbit · wheel to zoom</div><div class="cl-empty" id="cs-empty" hidden></div></div>
    <div class="cl-right" id="cs-insp"></div>`;
  document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const $ = (s) => root.querySelector(s);
  const S = { catalog: { brands: [], items: [], bodies: [] }, stage: null, sel: null /* { kind, rec } */, body: null, keep: false, worn: {}, catFilter: '', dirty: false, spinning: false, sources: [], where: '' };
  let toastT = 0; const toast = (m, ms) => { let t = $('.cl-toast'); if (!t) { t = document.createElement('div'); t.className = 'cl-toast'; $('#cs-stage').appendChild(t); } t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2800); };
  UI = { root, close, get state() { return S; }, select, reload };

  function state(msg, cls) { const el = $('#cs-state'); el.textContent = msg || ''; el.className = 'cl-state' + (cls ? ' ' + cls : ''); }
  function brandOf(id) { return S.catalog.brands.find(b => b.id === id) || null; }

  /* ── lists ── */
  function renderLists() {
    const bl = $('#cs-brands');
    bl.innerHTML = S.catalog.brands.map(b => '<div class="cl-item' + (S.sel && S.sel.kind === 'brand' && S.sel.rec.id === b.id ? ' on' : '') + '" data-brand="' + esc(b.id) + '"><span>' + esc(b.logo) + '</span><span class="lb" style="color:' + esc(b.color) + '">' + esc(b.name) + '</span>' + (b.local ? '<span class="tag local">device</span>' : '') + (b.published ? '' : '<span class="tag">draft</span>') + '</div>').join('') || '<p class="cl-hint">No brands yet. A brand is a label players shop by — make one, then hang clothing on it.</p>';
    bl.querySelectorAll('[data-brand]').forEach(el => { el.onclick = () => select('brand', S.catalog.brands.find(b => b.id === el.dataset.brand)); });
    const chips = $('#cs-catchips');
    chips.innerHTML = '<span class="cl-brandchip' + (!S.catFilter ? ' on' : '') + '" data-cf="">All</span>' + CATEGORIES.map(c => '<span class="cl-brandchip' + (S.catFilter === c.id ? ' on' : '') + '" data-cf="' + c.id + '">' + c.icon + ' ' + esc(c.label) + '</span>').join('');
    chips.querySelectorAll('[data-cf]').forEach(el => { el.onclick = () => { S.catFilter = el.dataset.cf; renderLists(); }; });
    const il = $('#cs-items');
    const items = S.catalog.items.filter(i => !S.catFilter || i.cat === S.catFilter);
    il.innerHTML = items.map(i => { const b = brandOf(i.brand), C = CAT_BY_ID[i.cat]; return '<div class="cl-item' + (S.sel && S.sel.kind === 'item' && S.sel.rec.id === i.id ? ' on' : '') + '" data-item="' + esc(i.id) + '"><span>' + (C ? C.icon : '👕') + '</span><span class="lb">' + esc(i.name) + (b ? ' <span style="color:' + esc(b.color) + '">· ' + esc(b.name) + '</span>' : '') + '</span>' + (i.local ? '<span class="tag local">device</span>' : '') + (i.published ? '<span class="tag pub">shop</span>' : '<span class="tag">draft</span>') + '</div>'; }).join('') || '<p class="cl-hint">No clothing yet. ＋ New, pick a model, choose a category, Auto-fit.</p>';
    il.querySelectorAll('[data-item]').forEach(el => { el.onclick = () => select('item', S.catalog.items.find(i => i.id === el.dataset.item)); });
    const bo = $('#cs-bodies');
    bo.innerHTML = S.catalog.bodies.map(b => '<div class="cl-item' + (S.sel && S.sel.kind === 'body' && S.sel.rec.id === b.id ? ' on' : '') + '" data-body="' + esc(b.id) + '"><span>🧍</span><span class="lb">' + esc(b.name) + '</span>' + (b.local ? '<span class="tag local">device</span>' : '') + (b.published ? '<span class="tag pub">closet</span>' : '<span class="tag">draft</span>') + '</div>').join('') || '<p class="cl-hint">No characters yet.</p>';
    bo.querySelectorAll('[data-body]').forEach(el => { el.onclick = () => select('body', S.catalog.bodies.find(b => b.id === el.dataset.body)); });
    const sel = $('#cs-body');
    sel.innerHTML = S.catalog.bodies.length ? S.catalog.bodies.map(b => '<option value="' + esc(b.id) + '"' + (S.body && S.body.id === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') : '<option value="">— add a character —</option>';
  }

  /* ── the preview outfit: the selected item, plus whatever was kept on ── */
  function previewOutfit() {
    const wear = S.keep ? Object.assign({}, S.worn) : {};
    if (S.sel && S.sel.kind === 'item' && S.sel.rec.url) { wear[S.sel.rec.cat] = S.sel.rec.id; if (S.keep) S.worn[S.sel.rec.cat] = S.sel.rec.id; }
    return normalizeOutfit({ body: S.body ? S.body.id : '', wear });
  }
  function previewCatalog() {
    // the selected (possibly unsaved) record replaces its saved twin
    const items = S.catalog.items.slice();
    if (S.sel && S.sel.kind === 'item') { const i = items.findIndex(x => x.id === S.sel.rec.id); if (i >= 0) items[i] = S.sel.rec; else items.push(S.sel.rec); }
    return Object.assign({}, S.catalog, { items });
  }
  function showPreview() { if (!S.stage) return; S.stage.setCatalog(previewCatalog()); S.stage.setOutfit(previewOutfit()); }

  /* ── selection ── */
  function select(kind, rec) {
    if (!rec) return;
    S.sel = { kind, rec: kind === 'item' ? normalizeItem(rec) : kind === 'brand' ? normalizeBrand(rec) : normalizeBody(rec) };
    S.dirty = false; state('');
    renderLists(); renderInspector();
    if (kind === 'item') { showPreview(); swingTo(S.sel.rec.cat); if (!(S.sel.rec.dims[0] > 0) && S.sel.rec.url) measureDims(S.sel.rec); }
    else if (kind === 'body') { if (S.body && S.body.id !== rec.id) setBody(S.catalog.bodies.find(b => b.id === rec.id) || rec); }
  }
  function swingTo(cat) { const C = CAT_BY_ID[cat]; const f = $('#cs-focus'); if (C) { f.hidden = false; f.textContent = C.icon + ' ' + C.label; } if (S.stage && S.stage.meas && C) { stopSpin(); if (S.stage.body) S.stage.body.rotation.y = S.body && S.body.faces === 'z' ? Math.PI : 0; S.stage.swingToCategory(cat, 'l'); } }
  async function setBody(rec) {
    S.body = rec || null; renderLists();
    if (!S.stage) return;
    S.stage.setCatalog(previewCatalog()); S.stage.setOutfit(previewOutfit());
    await S.stage.setBody(rec);
    if (!UI) return;
    if (S.sel && S.sel.kind === 'item') { swingTo(S.sel.rec.cat); renderInspector(); } else S.stage.swingToBody();
  }

  /* ── the inspector ── */
  function renderInspector() {
    const box = $('#cs-insp');
    if (!S.sel) { box.innerHTML = '<div class="cl-sec"><h3>Inspector</h3><p class="cl-hint">Select a brand, a piece of clothing or a character on the left — or make a new one.</p><p class="cl-hint"><b>How a fit works.</b> The body is measured part by part (head, neck, chest, wrists, hands, feet, ears). Auto-fit sizes the item to its part — a watch is 1.05 wrists wide — and every offset is a fraction of that part, so the same record fits every character.</p></div>'; return; }
    if (S.sel.kind === 'brand') return renderBrand(box);
    if (S.sel.kind === 'body') return renderBody(box);
    return renderItem(box);
  }
  const modelPicker = (id, cur) => '<select id="' + id + '-src"><option value="">— choose a model —</option>' + (S.sources.length ? '<optgroup label="Athena files">' + S.sources.filter(s => s.from === 'files').map(s => '<option value="' + esc(s.url) + '"' + (s.url === cur ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</optgroup><optgroup label="Project models">' + S.sources.filter(s => s.from === 'project').map(s => '<option value="' + esc(s.url) + '"' + (s.url === cur ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</optgroup>' : '') + '</select>' +
    '<div class="cl-row"><label>URL</label><input type="text" id="' + id + '-url" value="' + esc(cur) + '" placeholder="/models/…glb or https://…"></div>';

  function renderBrand(box) {
    const b = S.sel.rec;
    box.innerHTML = `<div class="cl-sec"><h3>Brand</h3>
      <div class="cl-row"><label>Name</label><input type="text" id="cb-name" maxlength="40" value="${esc(b.name)}"></div>
      <div class="cl-row"><label>Tagline</label><input type="text" id="cb-tag" maxlength="90" value="${esc(b.tagline)}" placeholder="one line under the name in the shop"></div>
      <div class="cl-row"><label>Logo</label><input type="text" id="cb-logo" maxlength="4" value="${esc(b.logo)}" style="width:60px;flex:0 0 60px"><label style="flex:0 0 auto">Colour</label><input type="color" id="cb-color" value="${esc(b.color)}"></div>
      <div class="cl-row"><label>In the shop</label><input type="checkbox" id="cb-pub" ${b.published ? 'checked' : ''}><span class="cl-hint" style="margin:0">players see this brand's clothing</span></div>
      <div class="cl-btns"><button id="cb-save" class="primary">💾 Save brand</button><button id="cb-del" class="danger">🗑</button></div>
      <p class="cl-hint">${S.catalog.items.filter(i => i.brand === b.id).length} piece(s) carry this brand.</p></div>`;
    const upd = () => { b.name = $('#cb-name').value; b.tagline = $('#cb-tag').value; b.logo = $('#cb-logo').value || '🏷'; b.color = $('#cb-color').value; b.published = $('#cb-pub').checked; S.dirty = true; state('unsaved', 'dirty'); };
    box.querySelectorAll('input').forEach(el => { el.oninput = upd; el.onchange = upd; });
    $('#cb-save').onclick = () => saveRec('brands', b);
    $('#cb-del').onclick = () => delRec('brands', b);
  }
  function renderBody(box) {
    const b = S.sel.rec; const meas = S.stage && S.body && S.body.id === b.id ? S.stage.meas : null;
    box.innerHTML = `<div class="cl-sec"><h3>Character</h3>
      <div class="cl-row"><label>Name</label><input type="text" id="cy-name" maxlength="40" value="${esc(b.name)}"></div>
      <div class="cl-row"><label>Model</label>${modelPicker('cy', b.url)}</div>
      <div class="cl-row"><label>Scale</label><input type="number" id="cy-scale" step="0.01" min="0.01" max="50" value="${b.scale}"><label style="flex:0 0 auto">Faces</label><select id="cy-faces" style="flex:0 0 90px"><option value="-z" ${b.faces !== 'z' ? 'selected' : ''}>−Z</option><option value="z" ${b.faces === 'z' ? 'selected' : ''}>+Z</option></select></div>
      <div class="cl-row"><label>Idle clip</label><input type="text" id="cy-idle" maxlength="80" value="${esc(b.anim && b.anim.idle || '')}" placeholder="clip name (optional)"></div>
      <div class="cl-row"><label>In the closet</label><input type="checkbox" id="cy-pub" ${b.published ? 'checked' : ''}><span class="cl-hint" style="margin:0">players can pick this character</span></div>
      <div class="cl-btns"><button id="cy-fit" title="Load this character on the stage">👁 Show</button><button id="cy-save" class="primary">💾 Save</button><button id="cy-del" class="danger">🗑</button></div></div>
      <div class="cl-sec"><h3>Measurements</h3>${meas ? measTable(meas) : '<p class="cl-hint">Show the character to measure it.</p>'}</div>`;
    const upd = () => { b.name = $('#cy-name').value; b.url = $('#cy-url').value.trim(); b.scale = +$('#cy-scale').value || 1; b.faces = $('#cy-faces').value; b.anim = { idle: $('#cy-idle').value.trim() }; b.published = $('#cy-pub').checked; S.dirty = true; state('unsaved', 'dirty'); };
    box.querySelectorAll('input,select').forEach(el => { el.oninput = upd; el.onchange = upd; });
    $('#cy-src').onchange = () => { if ($('#cy-src').value) { $('#cy-url').value = $('#cy-src').value; upd(); } };
    $('#cy-fit').onclick = () => { upd(); setBody(b); };
    $('#cy-save').onclick = () => saveRec('bodies', b);
    $('#cy-del').onclick = () => delRec('bodies', b);
  }
  function measTable(m) {
    const p = m.parts;
    const row = (k, v) => '<span>' + k + '</span><span>' + v + '</span>';
    return '<div class="cl-meas">' + row('Height', cm(m.height)) + row('Rig', m.skinned ? m.skinned + ' skinned mesh(es), ' + Object.keys(m.bones).length + ' bones found' : 'no skeleton — proportions') +
      row('Head', cm(p.head.size.x) + ' wide · ' + cm(p.head.size.y) + ' tall') + row('Neck', cm(p.neck.size.x)) + row('Chest', cm(p.chest.size.x) + ' wide · ' + cm(p.chest.size.z) + ' deep') +
      row('Wrist L', cm(p['wrist.l'].size.x) + (p['wrist.l'].virtual ? ' (est.)' : '')) + row('Hand L', cm(p['hand.l'].size.y) + ' long') + row('Foot L', cm(p['foot.l'].size.z) + ' long') + row('Ear', cm(p['ear.l'].size.y)) + '</div>';
  }
  function renderItem(box) {
    const it = S.sel.rec, C = CAT_BY_ID[it.cat], f = it.fit;
    const meas = S.stage ? S.stage.meas : null;
    const pk = C.part + (['wrist', 'hand', 'foot', 'ear'].includes(C.part) ? '.l' : '');
    const part = meas && meas.parts[pk];
    const worn = part ? { target: f.k * part.size[C.paxis], scale: it.dims[['x', 'y', 'z'].indexOf(f.axis)] > 0 ? f.k * part.size[C.paxis] / it.dims[['x', 'y', 'z'].indexOf(f.axis)] : 0 } : null;
    const an = f.anchor || C.anchor;
    box.innerHTML = `<div class="cl-sec"><h3>Clothing</h3>
      <div class="cl-row"><label>Name</label><input type="text" id="ci-name" maxlength="60" value="${esc(it.name)}"></div>
      <div class="cl-row"><label>Brand</label><select id="ci-brand"><option value="">— none —</option>${S.catalog.brands.map(b => '<option value="' + esc(b.id) + '"' + (b.id === it.brand ? ' selected' : '') + '>' + esc(b.logo + ' ' + b.name) + '</option>').join('')}</select></div>
      <div class="cl-row"><label>Category</label><select id="ci-cat">${CATEGORIES.map(c => '<option value="' + c.id + '"' + (c.id === it.cat ? ' selected' : '') + '>' + c.icon + ' ' + esc(c.label) + '</option>').join('')}</select></div>
      <div class="cl-row"><label>Model</label>${modelPicker('ci', it.url)}</div>
      <p class="cl-hint">Model size at scale 1: ${it.dims[0] > 0 ? cm(it.dims[0]) + ' × ' + cm(it.dims[1]) + ' × ' + cm(it.dims[2]) : 'not measured yet — pick a model'}</p>
      <div class="cl-row"><label>Price</label><input type="number" id="ci-price" min="0" step="1" value="${it.price}"><select id="ci-cur" style="flex:0 0 100px">${CURRENCIES.map(c => '<option value="' + c + '"' + (c === it.currency ? ' selected' : '') + '>' + CURRENCY_LABEL[c] + '</option>').join('')}</select></div>
      <div class="cl-row"><label>Tags</label><input type="text" id="ci-tags" value="${esc(it.tags.join(', '))}" placeholder="street, gold, summer"></div>
      <div class="cl-row"><label>In the shop</label><input type="checkbox" id="ci-pub" ${it.published ? 'checked' : ''}><span class="cl-hint" style="margin:0">players can see and buy it</span></div>
      <div class="cl-btns"><button id="ci-save" class="primary">💾 Save clothing</button><button id="ci-dup" title="Duplicate">⧉</button><button id="ci-del" class="danger">🗑</button></div></div>
      <div class="cl-sec"><h3>Fit <span class="sp"></span><button id="ci-auto" title="Measure the body and size the item to its part">📏 Auto-fit</button></h3>
      <p class="cl-hint">Hangs from the <b>${esc(C.part)}</b>${C.pair ? ' (both sides — the right is mirrored)' : ''}. ${part ? 'This body’s ' + esc(C.part) + ' is <b>' + cm(part.size.x) + ' × ' + cm(part.size.y) + ' × ' + cm(part.size.z) + '</b>' + (part.virtual ? ' (estimated — no bone owns it)' : '') + '.' : 'Pick a character to measure against.'}</p>
      <div class="cl-row"><label>Size</label><input type="range" id="ci-k" min="0.2" max="3" step="0.01" value="${f.k}"><span class="v" id="ci-k-v">${f.k.toFixed(2)}×</span></div>
      <p class="cl-hint">The item's <b>${f.axis}</b> = size × the part's <b>${C.paxis}</b>${worn ? ' → worn <b>' + cm(worn.target) + '</b> (model × ' + worn.scale.toFixed(3) + ')' : ''}.</p>
      <div class="cl-row"><label>Item axis</label><select id="ci-axis" style="flex:0 0 70px">${['x', 'y', 'z'].map(a => '<option value="' + a + '"' + (a === f.axis ? ' selected' : '') + '>' + a + ' (' + { x: 'width', y: 'height', z: 'depth' }[a] + ')</option>').join('')}</select></div>
      <div class="cl-row"><label>Anchor</label><select id="ci-an0">${['c', 'top', 'bottom', 'front', 'back'].map(a => '<option value="' + a + '"' + (a === an[0] ? ' selected' : '') + '>item ' + (a === 'c' ? 'centre' : a) + '</option>').join('')}</select><select id="ci-an1">${['c', 'top', 'bottom', 'front', 'back'].map(a => '<option value="' + a + '"' + (a === an[1] ? ' selected' : '') + '>on part ' + (a === 'c' ? 'centre' : a) + '</option>').join('')}</select></div>
      ${['x', 'y', 'z'].map((a, i) => '<div class="cl-row"><label>Offset ' + a + '</label><input type="range" data-off="' + i + '" min="-1.5" max="1.5" step="0.01" value="' + f.off[i] + '"><span class="v" data-offv="' + i + '">' + f.off[i].toFixed(2) + '</span></div>').join('')}
      <p class="cl-hint">Offsets are fractions of the part (0.5 = half a ${esc(C.part)} across), so they carry to every character.</p>
      ${['x', 'y', 'z'].map((a, i) => '<div class="cl-row"><label>Rotate ' + a + '</label><input type="range" data-rot="' + i + '" min="-180" max="180" step="1" value="' + deg(f.rot[i]) + '"><span class="v" data-rotv="' + i + '">' + deg(f.rot[i]) + '°</span></div>').join('')}
      <div class="cl-btns"><button id="ci-reset">↺ Reset fit</button><button id="ci-look">🎥 Look at it</button></div>
      ${f.ref && f.ref.body ? '<p class="cl-hint">Fitted against <b>' + esc((S.catalog.bodies.find(b => b.id === f.ref.body) || {}).name || f.ref.body) + '</b>.</p>' : ''}
      </div>`;
    const live = () => { S.sel.rec = normalizeItem(it); if (S.stage) S.stage.replaceItem(it.cat, S.sel.rec); S.dirty = true; state('unsaved', 'dirty'); };
    const upd = (reload) => {
      it.name = $('#ci-name').value; it.brand = $('#ci-brand').value; const cat = $('#ci-cat').value; const catChanged = cat !== it.cat; it.cat = cat;
      const url = $('#ci-url').value.trim(); const urlChanged = url !== it.url; it.url = url;
      it.price = +$('#ci-price').value || 0; it.currency = $('#ci-cur').value; it.tags = $('#ci-tags').value; it.published = $('#ci-pub').checked;
      S.dirty = true; state('unsaved', 'dirty');
      if (catChanged) { it.fit = normalizeFit({ rot: it.fit.rot }, cat); S.sel.rec = normalizeItem(it); renderInspector(); showPreview(); swingTo(cat); return; }
      if (urlChanged) { S.sel.rec = normalizeItem(it); measureAndPreview(); return; }
      S.sel.rec = normalizeItem(it); if (reload) showPreview();
    };
    ['#ci-name', '#ci-brand', '#ci-cat', '#ci-price', '#ci-cur', '#ci-tags', '#ci-pub', '#ci-url'].forEach(s => { const el = $(s); el.onchange = () => upd(false); });
    $('#ci-src').onchange = () => { if ($('#ci-src').value) { $('#ci-url').value = $('#ci-src').value; upd(false); } };
    const fitInputs = () => {
      it.fit.k = +$('#ci-k').value; $('#ci-k-v').textContent = it.fit.k.toFixed(2) + '×';
      it.fit.axis = $('#ci-axis').value; it.fit.anchor = [$('#ci-an0').value, $('#ci-an1').value];
      box.querySelectorAll('[data-off]').forEach(r => { it.fit.off[+r.dataset.off] = +r.value; box.querySelector('[data-offv="' + r.dataset.off + '"]').textContent = (+r.value).toFixed(2); });
      box.querySelectorAll('[data-rot]').forEach(r => { it.fit.rot[+r.dataset.rot] = +r.value * Math.PI / 180; box.querySelector('[data-rotv="' + r.dataset.rot + '"]').textContent = r.value + '°'; });
      live();
    };
    box.querySelectorAll('#ci-k,[data-off],[data-rot]').forEach(r => { r.oninput = fitInputs; });
    ['#ci-axis', '#ci-an0', '#ci-an1'].forEach(s => { $(s).onchange = fitInputs; });
    $('#ci-auto').onclick = () => autoFit(it);
    $('#ci-reset').onclick = () => { it.fit = normalizeFit({ ref: it.fit.ref }, it.cat); S.sel.rec = normalizeItem(it); renderInspector(); showPreview(); };
    $('#ci-look').onclick = () => swingTo(it.cat);
    $('#ci-save').onclick = () => saveRec('items', it);
    $('#ci-dup').onclick = () => { const d = normalizeItem(Object.assign({}, it, { id: uid('ci_'), name: it.name + ' copy', owner_id: null, owner_name: '', created_at: 0 })); S.catalog.items.push(d); select('item', d); };
    $('#ci-del').onclick = () => delRec('items', it);
  }
  /* an item saved without its size (seeded by hand, an older record): measure it quietly */
  async function measureDims(it) {
    if (!S.stage) return;
    try { const d = await measureItem(S.stage.THREE, it.url); if (!UI || !S.sel || S.sel.rec !== it) return; it.dims = d; renderInspector(); S.stage.replaceItem(it.cat, it); } catch (e) {}
  }
  /* pick a model → measure it (dims) → show it */
  async function measureAndPreview() {
    const it = S.sel && S.sel.kind === 'item' ? S.sel.rec : null; if (!it || !it.url || !S.stage) return;
    state('measuring model…');
    try { const d = await measureItem(S.stage.THREE, it.url); if (!UI || !S.sel || S.sel.rec !== it) return; it.dims = d; state('unsaved', 'dirty'); }
    catch (e) { toast('The model could not be loaded: ' + ((e && e.message) || e), 3600); state('model failed', 'dirty'); return; }
    if (!it.fit.ref) autoFit(it); else { renderInspector(); showPreview(); swingTo(it.cat); }
  }
  /* AUTO-FIT: the category's defaults, and remember what body it was measured against */
  function autoFit(it) {
    const C = CAT_BY_ID[it.cat]; const meas = S.stage && S.stage.meas;
    it.fit = normalizeFit({ rot: it.fit.rot }, it.cat);
    if (meas) { const pk = C.part + (['wrist', 'hand', 'foot', 'ear'].includes(C.part) ? '.l' : ''); const part = meas.parts[pk]; if (part) it.fit.ref = { body: S.body ? S.body.id : '', part: [part.size.x, part.size.y, part.size.z], item: it.dims.slice() }; }
    S.sel.rec = normalizeItem(it); S.dirty = true; state('unsaved', 'dirty');
    renderInspector(); showPreview(); swingTo(it.cat);
    toast(meas ? '📏 Fitted to ' + (S.body ? S.body.name : 'the body') + ': ' + C.label.toLowerCase() + ' sized to the ' + C.part + '.' : 'Pick a character first to measure against.', 3000);
  }

  /* ── saving ── */
  async function saveRec(kind, rec) {
    state('saving…');
    const r = await (api[kind].put(rec));
    if (!UI) return;
    if (!r.ok) { state('save failed', 'dirty'); toast('Save failed: ' + (r.error || 'unknown'), 4000); return; }
    S.dirty = false; state(r.where === 'cloud' ? 'saved to the cloud' : 'saved on this device', 'ok');
    if (r.warn) toast('Kept on this device — the cloud refused it: ' + r.warn, 4800);
    else if (r.where === 'device' && !(api.cached() && api.cached().cloud)) toast('Saved on this device. Sign in and apply sql/132_player_closet.sql to publish to every player.', 4200);
    await reload(true);
  }
  async function delRec(kind, rec) {
    if (!(await ask('Delete <b>' + esc(rec.name) + '</b>? ' + (kind === 'items' ? 'Players who own it keep a record that no longer resolves.' : kind === 'bodies' ? 'Outfits saved on it fall back to another character.' : 'Its clothing becomes unbranded.')))) return;
    await api[kind].remove(rec.id); S.sel = null; S.dirty = false; state('deleted', 'ok'); await reload(true);
  }
  async function reload(keep) {
    const sel = keep && S.sel ? S.sel : null;
    try { S.catalog = await api.catalog(true); } catch (e) {}
    if (!UI) return;
    if (!S.body || !S.catalog.bodies.some(b => b.id === S.body.id)) S.body = S.catalog.bodies[0] || null;
    if (sel) { const list = sel.kind === 'item' ? S.catalog.items : sel.kind === 'brand' ? S.catalog.brands : S.catalog.bodies; const fresh = list.find(x => x.id === sel.rec.id); S.sel = fresh ? { kind: sel.kind, rec: sel.kind === 'item' ? normalizeItem(fresh) : sel.kind === 'brand' ? normalizeBrand(fresh) : normalizeBody(fresh) } : null; }
    renderLists(); renderInspector(); showPreview();
    if (S.catalog.missing) state('cloud table missing — device only', 'dirty');
  }
  function stopSpin() { S.spinning = false; if (S.stage) S.stage.setSpin(0); $('#cs-spin').classList.remove('on'); }
  function close() {
    if (!UI) return;
    if (S.stage) { try { S.stage.dispose(); } catch (e) {} }
    root.remove(); document.body.style.overflow = prevOverflow; UI = null;
    window.removeEventListener('keydown', onKey, true);
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape' && UI) { e.preventDefault(); close(); } }
  window.addEventListener('keydown', onKey, true);

  $('#cs-close').onclick = close;
  $('#cs-reload').onclick = () => reload(true);
  $('#cs-whole').onclick = () => { $('#cs-focus').hidden = true; if (S.stage) S.stage.swingToBody(); };
  $('#cs-spin').onclick = () => { S.spinning = !S.spinning; if (S.stage) S.stage.setSpin(S.spinning ? 0.9 : 0); $('#cs-spin').classList.toggle('on', S.spinning); };
  $('#cs-keep').onchange = (e) => { S.keep = e.target.checked; if (!S.keep) S.worn = {}; showPreview(); };
  $('#cs-body').onchange = (e) => setBody(S.catalog.bodies.find(b => b.id === e.target.value) || null);
  $('#cs-newbrand').onclick = () => { const b = normalizeBrand({ name: 'New brand' }); S.catalog.brands.push(b); select('brand', b); };
  $('#cs-newitem').onclick = () => { const it = normalizeItem({ name: 'New piece', cat: S.catFilter || 'hat', brand: S.sel && S.sel.kind === 'brand' ? S.sel.rec.id : '' }); S.catalog.items.push(it); select('item', it); };
  $('#cs-newbody').onclick = () => { const b = normalizeBody({ name: 'New character' }); S.catalog.bodies.push(b); select('body', b); };
  $('#cs-creator').onclick = async () => { try { const m = await import('./closet.creator.js'); m.openCreator({ fresh: true }); } catch (e) { toast('Could not open the Player Closet.'); } };

  await reload(false);
  if (!UI) return null;
  api.modelSources().then(s => { S.sources = s; if (UI) renderInspector(); }).catch(() => {});
  try {
    S.stage = await createStage($('#cs-stage'), { catalog: previewCatalog(), outfit: previewOutfit() });
    if (!UI) { S.stage.dispose(); return null; }
    S.stage.on('measure', () => { if (UI) renderInspector(); });
    if (S.body) await setBody(S.body);
    if (opts.item) { const it = S.catalog.items.find(i => i.id === opts.item); if (it) select('item', it); }
  } catch (e) { const el = $('#cs-empty'); el.hidden = false; el.innerHTML = '<div>3D could not start here (' + esc((e && e.message) || e) + ').</div>'; }
  return UI;
}
