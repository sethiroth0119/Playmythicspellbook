/* closet.creator.js — the PLAYER CLOSET: the character creator players use.

   Watch Dogs 2's Plainstock, in the Character Forge: a store panel on the
   right (Wardrobe = what you own, Shop = everything published, grouped by
   BRAND), the category rail (Hats · Shirts · … · Scarves), and the character
   on the left in the shared stage. Picking a category SWINGS THE CAMERA to
   that part of the body (closet.stage.js → closet.rig.js focusFor). Clicking
   an item tries it on at once — owned or not — so shopping is dressing;
   Buy & Equip charges through the bridge (index.html's spendGems: the only
   path that spends Cinder) and then it is yours. Save writes the outfit to
   the profile, which is what every hub reads.

   ⚠ TRY-ON IS NOT OWNERSHIP. The saved outfit only ever carries items the
     player owns or that are free: an unowned item worn in the preview is
     dropped on save, and the panel says so, rather than letting a player
     walk into a hub in a jacket they did not pay for. */

import { CATEGORIES, CAT_BY_ID, normalizeOutfit, priceLabel, outfitEquals } from './closet.model.js';
import { catalog as loadCatalog } from './closet.api.js';
import * as me from './closet.bridge.js';
import { createStage } from './closet.stage.js';

let UI = null;
export function isOpen() { return !!UI; }
export function closeCreator() { if (UI) { UI.close(); } }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let cssOn = false;
export function ensureCss() { if (cssOn) return; cssOn = true; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./closet.css', import.meta.url).href; document.head.appendChild(l); }

export async function openCreator(opts) {
  opts = opts || {};
  if (UI) return UI;
  ensureCss();
  const root = document.createElement('div'); root.id = 'closet-root'; root.className = 'cl-root';
  root.innerHTML = `
    <div class="cl-top">
      <span class="brand">👕 Player Closet</span>
      <select id="cl-body" title="Which character you dress"></select>
      <button id="cl-whole" title="See the whole character">🧍 Whole body</button>
      <button id="cl-spin" title="Turn the character">↻ Turn</button>
      <span class="sp"></span>
      <span class="bal" id="cl-bal"></span>
      <button id="cl-save" class="primary">💾 Save outfit</button>
      <button id="cl-close">✕ Close</button>
    </div>
    <div class="cl-stage" id="cl-stage"><div class="cl-focus" id="cl-focus" hidden></div><div class="cl-hint">drag to orbit · wheel to zoom</div><div class="cl-empty" id="cl-empty" hidden></div></div>
    <div class="cl-panel">
      <div class="cl-store" id="cl-store"><div class="name">Player Closet</div><div class="tag">Every brand · every piece you own, in one place</div></div>
      <div class="cl-tabs"><button data-tab="wardrobe" class="on">Wardrobe</button><button data-tab="shop">Shop</button></div>
      <div class="cl-cats" id="cl-cats"></div>
      <div class="cl-grid" id="cl-grid"></div>
      <div class="cl-foot">
        <div class="sel"><b id="cl-selname">Pick a category to start</b><span class="pr" id="cl-selprice"></span></div>
        <div class="btns" id="cl-btns"></div>
        <div class="cl-hintline" id="cl-status"></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const $ = (s) => root.querySelector(s);
  const S = { tab: 'wardrobe', cat: '', sel: null, cat$: null, stage: null, catalog: { brands: [], items: [], bodies: [] }, saved: me.outfit(), outfit: me.outfit(), brandFilter: '', busy: false, spinning: false };
  S.outfit = normalizeOutfit(S.saved);
  let toastT = 0; const toast = (m, ms) => { let t = $('.cl-toast'); if (!t) { t = document.createElement('div'); t.className = 'cl-toast'; $('#cl-stage').appendChild(t); } t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2800); };

  UI = { root, close, get state() { return S; }, refresh };

  function bodyRec() { return S.catalog.bodies.find(b => b.id === S.outfit.body) || S.catalog.bodies.find(b => b.published) || S.catalog.bodies[0] || null; }
  function itemsFor(cat) { return S.catalog.items.filter(i => i.published && i.url && (!cat || i.cat === cat)); }
  function ownedSet() { return new Set(me.owned()); }
  function isOwned(it) { return it.currency === 'free' || !(it.price > 0) || ownedSet().has(it.id); }
  function brandOf(id) { return S.catalog.brands.find(b => b.id === id) || null; }

  function renderBal() {
    const g = me.balance('gems'), s = me.balance('sovereigns');
    $('#cl-bal').innerHTML = me.signedIn() ? '🔥 <b>' + g.toLocaleString() + '</b> Cinder &nbsp; 🪙 <b>' + s.toLocaleString() + '</b> Aza' : '<span style="color:var(--cl-dim)">signed out — try on, cannot buy</span>';
  }
  function renderBodies() {
    const sel = $('#cl-body'); const cur = bodyRec();
    const list = S.catalog.bodies.filter(b => b.published && b.url);
    sel.innerHTML = list.length ? list.map(b => '<option value="' + esc(b.id) + '"' + (cur && cur.id === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') : '<option value="">— no characters yet —</option>';
    sel.disabled = !list.length;
  }
  function renderCats() {
    const box = $('#cl-cats');
    const owned = ownedSet();
    box.innerHTML = CATEGORIES.map(c => {
      const all = itemsFor(c.id); const n = S.tab === 'wardrobe' ? all.filter(i => isOwned(i) || owned.has(i.id)).length : all.length;
      return '<button data-cat="' + c.id + '"' + (S.cat === c.id ? ' class="on"' : '') + ' title="' + esc(c.label) + '">' + c.icon + ' ' + esc(c.label) + '<span class="n">' + n + '</span></button>';
    }).join('');
    box.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => pickCat(b.dataset.cat); });
  }
  function renderGrid() {
    const grid = $('#cl-grid');
    if (!S.cat) { grid.innerHTML = '<div class="cl-empty-grid">Choose a category above.<br>The camera goes to that part of your character.</div>'; return; }
    const C = CAT_BY_ID[S.cat];
    let items = itemsFor(S.cat);
    if (S.tab === 'wardrobe') items = items.filter(i => isOwned(i));
    if (S.brandFilter) items = items.filter(i => i.brand === S.brandFilter);
    const worn = S.outfit.wear[S.cat] || '';
    const groups = new Map();
    items.forEach(i => { const k = i.brand || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    let html = '<div class="cl-card none' + (!worn ? ' on' : '') + '" data-item=""><div class="ic">' + C.icon + '</div><div class="nm">Nothing</div><div class="pr">take it off</div></div>';
    if (!items.length) html += '<div class="cl-empty-grid">' + (S.tab === 'wardrobe' ? 'You own no ' + esc(C.label.toLowerCase()) + ' yet — the Shop tab has them.' : 'No ' + esc(C.label.toLowerCase()) + ' in the shop yet.') + '</div>';
    groups.forEach((list, brandId) => {
      const b = brandOf(brandId);
      html += '<div class="cl-brandhead"><span class="logo">' + esc(b ? b.logo : '🏷') + '</span><span style="color:' + esc(b ? b.color : '#d4af37') + '">' + esc(b ? b.name : 'Unbranded') + '</span>' + (b && b.tagline ? '<span class="sub">' + esc(b.tagline) + '</span>' : '') + '</div>';
      html += list.map(i => '<div class="cl-card' + (i.id === worn ? ' on' : '') + (isOwned(i) ? ' worn-owned' : '') + '" data-item="' + esc(i.id) + '" title="' + esc(i.name) + '">' +
        (b ? '<span class="br" style="color:' + esc(b.color) + '">' + esc(b.name.slice(0, 10)) + '</span>' : '') +
        '<div class="ic">' + C.icon + '</div><div class="nm">' + esc(i.name) + '</div><div class="pr' + (isOwned(i) ? ' owned' : '') + '">' + (isOwned(i) ? (i.price > 0 ? 'Owned' : 'Free') : esc(priceLabel(i))) + '</div></div>').join('');
    });
    grid.innerHTML = html;
    grid.querySelectorAll('[data-item]').forEach(el => { el.onclick = () => tryOn(el.dataset.item); });
  }
  function renderFoot() {
    const nameEl = $('#cl-selname'), priceEl = $('#cl-selprice'), btns = $('#cl-btns'), st = $('#cl-status');
    const it = S.sel ? S.catalog.items.find(i => i.id === S.sel) : null;
    const dirty = !outfitEquals(S.outfit, S.saved);
    $('#cl-save').disabled = !dirty;
    if (!S.cat) { nameEl.textContent = 'Pick a category to start'; priceEl.textContent = ''; btns.innerHTML = ''; st.textContent = ''; return; }
    if (!it) { nameEl.textContent = CAT_BY_ID[S.cat].label + ' — nothing worn'; priceEl.textContent = ''; btns.innerHTML = ''; st.textContent = dirty ? 'Unsaved changes — Save outfit keeps them.' : ''; return; }
    const b = brandOf(it.brand);
    nameEl.textContent = (b ? b.name + ' · ' : '') + it.name; priceEl.textContent = isOwned(it) ? (it.price > 0 ? 'Owned' : 'Free') : priceLabel(it);
    const worn = S.outfit.wear[it.cat] === it.id;
    btns.innerHTML = isOwned(it)
      ? (worn ? '<button id="cl-off">Take off</button>' : '<button id="cl-equip" class="primary">Equip</button>')
      : '<button id="cl-buy" class="primary"' + (me.signedIn() ? '' : ' disabled title="Sign in to buy"') + '>🛍 Buy &amp; Equip · ' + esc(priceLabel(it)) + '</button>';
    st.textContent = isOwned(it) ? (dirty ? 'Unsaved changes — Save outfit keeps them.' : '') : 'Trying it on. Unowned pieces are not saved.';
    const eq = $('#cl-equip'), off = $('#cl-off'), buy = $('#cl-buy');
    if (eq) eq.onclick = () => { wear(it.cat, it.id); };
    if (off) off.onclick = () => { wear(it.cat, ''); };
    if (buy) buy.onclick = () => buyItem(it);
  }
  function refresh() { renderBal(); renderBodies(); renderCats(); renderGrid(); renderFoot(); }

  function wear(cat, id) { const o = normalizeOutfit(S.outfit); if (id) o.wear[cat] = id; else delete o.wear[cat]; S.outfit = o; if (S.stage) S.stage.setOutfit(o); S.sel = id || null; renderGrid(); renderFoot(); }
  function tryOn(id) { wear(S.cat, id); }
  function pickCat(cat) {
    S.cat = cat; S.brandFilter = ''; S.sel = S.outfit.wear[cat] || null;
    renderCats(); renderGrid(); renderFoot();
    const C = CAT_BY_ID[cat];
    const f = $('#cl-focus'); f.hidden = false; f.textContent = C.icon + ' ' + C.label;
    if (S.stage) { stopSpin(); if (S.stage.body) S.stage.body.rotation.y = S.stage.bodyRec && S.stage.bodyRec.faces === 'z' ? Math.PI : 0; S.stage.swingToCategory(cat, 'l'); }
  }
  async function buyItem(it) {
    if (S.busy) return; S.busy = true;
    try {
      if (!me.signedIn()) { toast('Sign in to buy clothes.'); return; }
      const bal = me.balance(it.currency);
      if (bal < it.price) { toast('Not enough ' + (it.currency === 'sovereigns' ? 'Aza coin' : 'Cinder') + ' — ' + priceLabel(it) + '.', 3400); return; }
      const b = brandOf(it.brand);
      const ok = await me.confirm('<div style="text-align:center"><div style="font-size:34px">' + CAT_BY_ID[it.cat].icon + '</div><div style="margin-top:6px;font-weight:800;color:#ffd166">' + esc((b ? b.name + ' · ' : '') + it.name) + '</div><div class="small-text ink-dim">' + esc(priceLabel(it)) + '</div></div>');
      if (!ok) return;
      if (!me.charge(it.price, it.currency, 'Player Closet: ' + it.name)) { toast('The purchase did not go through.', 3200); return; }
      me.grant(it.id);
      wear(it.cat, it.id);
      toast('🛍 ' + it.name + ' is yours — equipped.', 3200);
      renderBal(); renderCats();
    } finally { S.busy = false; }
  }
  function stopSpin() { S.spinning = false; if (S.stage) S.stage.setSpin(0); $('#cl-spin').classList.remove('on'); }
  async function save() {
    // only owned or free pieces leave with the player
    const o = normalizeOutfit(S.outfit); let dropped = 0;
    Object.keys(o.wear).forEach(c => { const it = S.catalog.items.find(i => i.id === o.wear[c]); if (!it || !isOwned(it)) { delete o.wear[c]; dropped++; } });
    if (!me.setOutfit(o)) { toast('Could not save the outfit.', 3000); return; }
    S.saved = normalizeOutfit(o); S.outfit = normalizeOutfit(o); if (S.stage) S.stage.setOutfit(S.outfit);
    toast(dropped ? '💾 Saved — ' + dropped + ' unowned piece' + (dropped > 1 ? 's' : '') + ' left behind.' : '💾 Outfit saved. Every hub you enter shows it.', 3400);
    try { window.dispatchEvent(new CustomEvent('closet:outfit', { detail: S.saved })); } catch (e) {}
    renderGrid(); renderFoot();
  }
  function close() {
    if (!UI) return;
    if (S.stage) { try { S.stage.dispose(); } catch (e) {} }
    root.remove(); document.body.style.overflow = prevOverflow; UI = null;
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
  }

  root.querySelectorAll('.cl-tabs button').forEach(b => { b.onclick = () => { S.tab = b.dataset.tab; root.querySelectorAll('.cl-tabs button').forEach(x => x.classList.toggle('on', x === b)); renderCats(); renderGrid(); }; });
  $('#cl-close').onclick = close;
  $('#cl-save').onclick = save;
  $('#cl-whole').onclick = () => { S.cat = ''; S.sel = null; $('#cl-focus').hidden = true; renderCats(); renderGrid(); renderFoot(); if (S.stage) S.stage.swingToBody(); };
  $('#cl-spin').onclick = () => { S.spinning = !S.spinning; if (S.stage) S.stage.setSpin(S.spinning ? 0.9 : 0); $('#cl-spin').classList.toggle('on', S.spinning); };
  $('#cl-body').onchange = async (e) => { const o = normalizeOutfit(S.outfit); o.body = e.target.value; S.outfit = o; if (S.stage) { S.stage.setOutfit(o); await S.stage.setBody(bodyRec()); if (S.cat) S.stage.swingToCategory(S.cat, 'l'); else S.stage.swingToBody(); } renderFoot(); };
  window.addEventListener('keydown', onKey, true);
  function onKey(e) { if (!UI) { window.removeEventListener('keydown', onKey, true); return; } if (e.key === 'Escape') { e.preventDefault(); close(); } }

  // catalogue first (the panel is usable before three.js arrives), then the stage
  try { S.catalog = await loadCatalog(!!opts.fresh); } catch (e) {}
  if (!UI) return null;
  refresh();
  const empty = $('#cl-empty');
  if (!S.catalog.bodies.some(b => b.published && b.url)) { empty.hidden = false; empty.innerHTML = '<div><div style="font-size:40px">🧍</div>No characters have been added to the closet yet.<br><span style="font-size:12px">An admin adds bodies and clothing in Athena Engine → 👕 Closet Studio.</span></div>'; }
  try {
    S.stage = await createStage($('#cl-stage'), { catalog: S.catalog, outfit: S.outfit });
    if (!UI) { S.stage.dispose(); return null; }
    S.stage.on('measure', () => { if (S.cat) S.stage.swingToCategory(S.cat, 'l'); else S.stage.swingToBody(); });
    S.stage.on('bodyError', (e) => { empty.hidden = false; empty.innerHTML = '<div><div style="font-size:40px">🧍</div>The character could not be loaded.<br><span style="font-size:12px">' + esc((e && e.message) || e) + '</span></div>'; });
    S.stage.on('body', (b) => { if (b) empty.hidden = true; });
    const rec = bodyRec();
    if (rec) { const o = normalizeOutfit(S.outfit); if (o.body !== rec.id) { o.body = rec.id; S.outfit = o; S.stage.setOutfit(o); } await S.stage.setBody(rec); }
    if (opts.cat && CAT_BY_ID[opts.cat]) pickCat(opts.cat);
  } catch (e) { empty.hidden = false; empty.innerHTML = '<div>3D could not start here (' + esc((e && e.message) || e) + ').<br>The wardrobe still works; the preview does not.</div>'; }
  return UI;
}
