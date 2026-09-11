/* live-editor.js — ✎ Edit UI: click anything on the real game page and change it.

   Unreal's UMG lets you open the widget that IS the screen and edit it in
   place. This game's screens are legacy DOM, so the equivalent is a layer
   over the running page: hover highlights any element, a click selects it,
   the panel edits its TEXT, LOOK (a fixed list of CSS properties) and
   VISIBILITY, or hands it to the Widget Designer to be replaced by a widget.
   Every change is a RULE in a "page" document (widgets.format.js →
   normalizePage) keyed by a CSS selector and scoped to the screen it was
   made on; the runtime applies live page docs to every player (styles as a
   stylesheet, text through the mutation sync), so the game's own code is
   never touched and a rule can be reverted by deleting it.

   Admin-only, like everything that changes the UI for every player. Reads
   the game only through window.MythicBridge (isAdmin, ui.data().screen,
   toast, confirm) and the widgets API. */

import { normalize, newWidget, clone, selectorFor, PAGE_STYLE_PROPS, uid } from './widgets.format.js';
import { setPageDraft, currentScreen, elementText, liveDocs, reload as reloadLive } from './widgets.runtime.js';
import { openDesigner } from './widgets.editor.js';
import * as api from './widgets.api.js';

let LE = null;
export function isLiveOpen() { return !!LE; }
export function liveEditor() { return LE; }
export function closeLiveEditor() { if (LE) LE.close(true); }

const FIELDS = [
  ['color', 'Text colour', 'color'], ['background', 'Background', 'color'], ['font-size', 'Font size', 'text', '14px'], ['font-weight', 'Weight', 'select', ['', '300', '400', '500', '600', '700', '800', '900']],
  ['text-transform', 'Case', 'select', ['', 'none', 'uppercase', 'lowercase', 'capitalize']], ['text-align', 'Align', 'select', ['', 'left', 'center', 'right']], ['letter-spacing', 'Spacing', 'text', '0.04em'],
  ['padding', 'Padding', 'text', '6px 10px'], ['margin', 'Margin', 'text', '0'], ['border-radius', 'Radius', 'text', '8px'], ['border', 'Border', 'text', '1px solid #d4af37'],
  ['opacity', 'Opacity', 'text', '1'], ['width', 'Width', 'text', 'auto'], ['height', 'Height', 'text', 'auto'], ['box-shadow', 'Shadow', 'text', '0 0 12px #d4af37'], ['order', 'Order', 'text', '0'],
];

export async function openLiveEditor(opts) {
  opts = opts || {};
  if (LE) return LE;
  if (!api.isAdmin() && !opts.force) { bridgeToast('Editing the game UI is admin-only.'); return null; }
  ensureCss();
  const screen = opts.screen || currentScreen();
  // the document: the live page doc for this screen, else a saved one, else new
  let doc = null, source = null;
  if (opts.doc) doc = normalize(opts.doc);
  else {
    const lv = liveDocs().find(d => d.kind === 'page' && d.page.screen === screen);
    if (lv) { doc = clone(lv); source = await sourceOf(lv.id); }
    else { const rows = (await api.listAll()).rows.filter(r => r.kind === 'page' && r.target && r.target.slot === 'page:' + screen && r.mine); if (rows[0]) { const r = await api.load(rows[0].id, rows[0].source); if (r.ok) { doc = r.doc; source = rows[0].source; } } }
  }
  if (!doc) { doc = newWidget({ kind: 'page', author: api.displayName(), screen, name: 'Page · ' + (screen || 'game') }); }
  doc.page.screen = doc.page.screen || screen; doc.target = { mode: 'none', slot: 'page:' + doc.page.screen, selector: '', place: 'append' };

  const root = document.createElement('div'); root.id = 'aw-live'; document.body.appendChild(root);
  const $ = (q) => root.querySelector(q);
  const S = { doc, source, screen, sel: null, el: null, picking: true, undo: [], redo: [], dirty: false, hl: null };
  const toast = (m, ms) => { const t = $('.aw-ltoast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2600); };
  const confirmDlg = async (m) => { try { const b = window.MythicBridge; if (b && b.confirm) return !!(await b.confirm(m)); } catch (e) {} return window.confirm(m); };

  // ── pick layer ──
  const layer = document.createElement('div'); layer.id = 'aw-picklayer'; layer.className = 'live'; layer.innerHTML = '<div class="msg">Hover to inspect · click to select · <b>Esc</b> stops picking</div>'; document.body.appendChild(layer);
  let hoverEl = null;
  const elAt = (e) => { layer.style.pointerEvents = 'none'; const el = document.elementFromPoint(e.clientX, e.clientY); layer.style.pointerEvents = ''; return el; };
  const isOurs = (el) => !el || el === document.body || el === document.documentElement || !!el.closest('#aw-live, #aw-picklayer, #aw-root, #mf-root, #aw-overlay');
  const onMove = (e) => { if (!S.picking) return; const el = elAt(e); if (isOurs(el)) { setHover(null); return; } if (el !== hoverEl) { setHover(el); layer.querySelector('.msg').textContent = describe(el) + ' — ' + selectorFor(el); } };
  const onClick = (e) => { if (!S.picking) return; const el = elAt(e); if (isOurs(el)) return; e.preventDefault(); e.stopPropagation(); selectEl(el); };
  const onKey = (e) => { if (e.key === 'Escape') { if (S.picking) setPicking(false); else if (S.sel) { selectEl(null); } e.stopPropagation(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } };
  function setHover(el) { if (hoverEl) hoverEl.classList.remove('aw-pick-hl'); hoverEl = el; if (el) el.classList.add('aw-pick-hl'); }
  function setPicking(on) { S.picking = on; layer.style.display = on ? '' : 'none'; if (!on) setHover(null); const b = $('#aw-l-pick'); if (b) b.classList.toggle('on', on); }
  layer.addEventListener('mousemove', onMove); layer.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  function describe(el) { const t = el.tagName.toLowerCase(); const tx = elementText(el); return t + (el.id ? '#' + el.id : '') + (tx ? ' “' + tx.slice(0, 30) + (tx.length > 30 ? '…' : '') + '”' : ''); }

  // ── selection ──
  function selectEl(el, sel) {
    if (S.hl) S.hl.classList.remove('aw-live-sel');
    S.el = el || null; S.sel = el ? (sel || selectorFor(el)) : (sel || null); S.hl = el;
    if (el) el.classList.add('aw-live-sel');
    renderPanel();
  }
  function selectRule(r) { let el = null; try { el = document.querySelector(r.sel); } catch (e) {} selectEl(el, r.sel); }
  function ruleFor(sel, create) {
    let r = S.doc.page.rules.find(x => x.sel === sel);
    if (!r && create) { r = { id: uid('r_'), sel, label: S.el ? describe(S.el).slice(0, 80) : sel }; S.doc.page.rules.push(r); }
    return r;
  }
  function snapshot() { S.undo.push(JSON.stringify(S.doc)); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; }
  function apply() { S.doc = normalize(S.doc); S.doc.target = { mode: 'none', slot: 'page:' + S.doc.page.screen, selector: '', place: 'append' }; setPageDraft(S.doc); }
  function commit(fn) { snapshot(); fn(); prune(); S.dirty = true; apply(); renderPanel(); }
  function prune() { S.doc.page.rules = S.doc.page.rules.filter(r => typeof r.text === 'string' || r.hide || (r.style && Object.keys(r.style).length) || r.attrs); }
  function undo() { const s = S.undo.pop(); if (!s) return; S.redo.push(JSON.stringify(S.doc)); S.doc = normalize(JSON.parse(s)); S.dirty = true; apply(); renderPanel(); }
  function redo() { const s = S.redo.pop(); if (!s) return; S.undo.push(JSON.stringify(S.doc)); S.doc = normalize(JSON.parse(s)); S.dirty = true; apply(); renderPanel(); }

  // ── panel ──
  root.innerHTML = `<div class="aw-lhead"><span class="brand">✎ EDIT UI</span><span class="scr" id="aw-l-screen"></span><span class="state" id="aw-l-state"></span><button id="aw-l-close" title="Close">✕</button></div>
    <div class="aw-lbar"><button id="aw-l-pick" class="on" title="Pick an element (Esc stops)">🎯 Pick</button><button id="aw-l-undo" title="Undo (Ctrl+Z)">↶</button><button id="aw-l-redo" title="Redo">↷</button><button id="aw-l-save" class="primary">💾 Save</button><button id="aw-l-live" title="Apply to every player (admin)">★ Live</button></div>
    <div class="aw-lbody" id="aw-l-body"></div>
    <div class="aw-ltoast"></div>`;
  $('#aw-l-close').onclick = () => close(false);
  $('#aw-l-pick').onclick = () => setPicking(!S.picking);
  $('#aw-l-undo').onclick = undo; $('#aw-l-redo').onclick = redo;
  $('#aw-l-save').onclick = save; $('#aw-l-live').onclick = setLive;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toHex(c) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'; return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''); }
  function renderPanel() {
    $('#aw-l-screen').textContent = 'screen: ' + (S.doc.page.screen || 'any') + (currentScreen() !== S.doc.page.screen && S.doc.page.screen ? ' (now on ' + (currentScreen() || '?') + ')' : '');
    $('#aw-l-state').textContent = S.dirty ? '● unsaved' : (S.source === 'cloud' ? '☁ saved' : S.source === 'local' ? '💾 device' : 'new');
    const body = $('#aw-l-body'); const rules = S.doc.page.rules;
    let html = '';
    if (S.sel) {
      const r = ruleFor(S.sel, false) || {}; const st = r.style || {};
      let n = 0; try { n = document.querySelectorAll(S.sel).length; } catch (e) {}
      const cs = S.el ? getComputedStyle(S.el) : null;
      const curText = typeof r.text === 'string' ? r.text : (S.el ? elementText(S.el) : '');
      html += `<div class="aw-lsel"><div class="t">${S.el ? esc(describe(S.el)) : '<i>element not on this screen right now</i>'}</div><div class="s"><code>${esc(S.sel)}</code>${n > 1 ? '<span class="warn">applies to ' + n + ' elements</span>' : ''}</div></div>
        <div class="aw-lrow"><label>Text</label><textarea id="aw-l-text" rows="2" placeholder="(no direct text)">${esc(curText)}</textarea></div>
        <div class="aw-lrow"><label>Hidden</label><input type="checkbox" id="aw-l-hide" ${r.hide ? 'checked' : ''}><span class="hint">remove it from the page for everyone</span></div>
        <div class="aw-lgrid">${FIELDS.map(([k, lb, kind, ph]) => { const v = st[k] || ''; const cur = cs ? cs.getPropertyValue(k) : '';
          if (kind === 'color') return `<label>${lb}</label><div class="c"><input type="color" data-prop="${k}" data-kind="color" value="${toHex(v || cur)}"><input type="text" data-prop="${k}" value="${esc(v)}" placeholder="${esc(cur ? toHex(cur) : '')}"></div>`;
          if (kind === 'select') return `<label>${lb}</label><select data-prop="${k}">${ph.map(o => '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + (o || '(default' + (cur ? ': ' + cur : '') + ')') + '</option>').join('')}</select>`;
          return `<label>${lb}</label><input type="text" data-prop="${k}" value="${esc(v)}" placeholder="${esc(cur || ph)}">`; }).join('')}</div>
        <div class="aw-lrow"><label>More CSS</label><input type="text" id="aw-l-css" placeholder="prop: value; prop: value" value="${esc(Object.keys(st).filter(k => !FIELDS.find(f => f[0] === k)).map(k => k + ': ' + st[k]).join('; '))}"></div>
        <div class="aw-lbtns"><button id="aw-l-widget">🧩 Replace with a widget…</button><button id="aw-l-reset" class="danger" ${r.id ? '' : 'disabled'}>↺ Reset this element</button></div>`;
    } else html += '<div class="aw-lempty">🎯 Hover anything on the page and click it. Buttons, titles, cards, panels, the sidebar — every element can be retitled, restyled or hidden. Changes are saved as rules for this screen and applied to every player once live.</div>';
    html += `<div class="aw-lrules"><div class="h">Rules on this page <span>${rules.length}</span>${rules.length ? '<button id="aw-l-clear" class="danger">Reset page</button>' : ''}</div>${rules.map(r => `<div class="r ${r.sel === S.sel ? 'cur' : ''}" data-rule="${esc(r.id)}"><span class="lb">${esc(r.label || r.sel)}</span><span class="what">${[typeof r.text === 'string' ? 'text' : '', r.hide ? 'hidden' : '', r.style ? Object.keys(r.style).length + ' style' : ''].filter(Boolean).join(' · ')}</span><span class="x" data-del="${esc(r.id)}" title="Delete rule">✕</span></div>`).join('')}</div>
      <p class="aw-lhint">Rules match by selector, so they survive re-renders and updates as long as the element keeps its id/classes. Text with child icons keeps the icons. Undo: Ctrl+Z.</p>`;
    body.innerHTML = html;
    const tx = $('#aw-l-text'); if (tx) tx.onchange = () => commit(() => { const r = ruleFor(S.sel, true); const v = tx.value; if (S.el && v.trim() === (S.el.__awOrigText ? S.el.__awOrigText.join('').trim() : elementText(S.el)) && !r.text) delete r.text; else r.text = v; });
    const hd = $('#aw-l-hide'); if (hd) hd.onchange = () => commit(() => { const r = ruleFor(S.sel, true); if (hd.checked) r.hide = true; else delete r.hide; });
    body.querySelectorAll('[data-prop]').forEach(inp => {
      const set = () => commit(() => { const r = ruleFor(S.sel, true); r.style = r.style || {}; const v = inp.value.trim(); if (v) r.style[inp.dataset.prop] = v; else delete r.style[inp.dataset.prop]; if (!Object.keys(r.style).length) delete r.style; });
      if (inp.dataset.kind === 'color') { inp.oninput = () => { const twin = body.querySelector('input[type=text][data-prop="' + inp.dataset.prop + '"]'); if (twin) twin.value = inp.value; const r = ruleFor(S.sel, true); r.style = r.style || {}; r.style[inp.dataset.prop] = inp.value; apply(); }; inp.onchange = set; }
      else inp.onchange = set;
    });
    const more = $('#aw-l-css'); if (more) more.onchange = () => commit(() => { const r = ruleFor(S.sel, true); r.style = r.style || {}; FIELDS.forEach(() => {}); Object.keys(r.style).forEach(k => { if (!FIELDS.find(f => f[0] === k)) delete r.style[k]; }); more.value.split(';').forEach(pair => { const i = pair.indexOf(':'); if (i < 0) return; const k = pair.slice(0, i).trim().toLowerCase(), v = pair.slice(i + 1).trim(); if (PAGE_STYLE_PROPS.includes(k) && v) r.style[k] = v; }); if (!Object.keys(r.style).length) delete r.style; });
    const rs = $('#aw-l-reset'); if (rs) rs.onclick = () => commit(() => { S.doc.page.rules = S.doc.page.rules.filter(r => r.sel !== S.sel); });
    const wg = $('#aw-l-widget'); if (wg) wg.onclick = () => replaceWithWidget();
    const cl = $('#aw-l-clear'); if (cl) cl.onclick = async () => { if (await confirmDlg('Remove every rule on this page?')) commit(() => { S.doc.page.rules = []; }); };
    body.querySelectorAll('.aw-lrules .r').forEach(row => row.onclick = (e) => { if (e.target.dataset.del) { commit(() => { S.doc.page.rules = S.doc.page.rules.filter(r => r.id !== e.target.dataset.del); }); return; } const r = rules.find(x => x.id === row.dataset.rule); if (r) selectRule(r); });
  }
  async function replaceWithWidget() {
    if (!S.sel) return;
    const sel = S.sel; setPicking(false);
    const d = await openDesigner({ kind: 'widget', target: { mode: 'selector', selector: sel, place: 'replace' } });
    if (d) toast('Designer opened — Save + ★ Set live there puts the widget in place of the element.', 4200);
  }
  async function save() {
    const src = S.source || (api.userId() ? 'cloud' : 'local');
    S.doc.name = S.doc.name || ('Page · ' + S.doc.page.screen);
    const r = await api.save(S.doc, src);
    if (!r.ok) { toast('Save failed: ' + (r.error || 'unknown')); return r; }
    S.source = r.source || src; S.dirty = false; renderPanel();
    toast(r.fellBack ? 'Saved on this device (cloud: ' + (r.error || 'offline') + ')' : 'Saved' + (S.source === 'cloud' ? ' to the cloud' : ' on this device') + '.');
    return r;
  }
  async function setLive() {
    if (S.dirty || !S.source) { const r = await save(); if (!r.ok) return; }
    const r = await api.setLive(S.doc.id, S.source, true);
    if (!r.ok) { toast('Could not set live: ' + (r.error || 'unknown')); return; }
    toast('★ Live — every player on “' + (S.doc.page.screen || 'this screen') + '” now sees these changes.', 3600);
    try { window.dispatchEvent(new CustomEvent('athena-ui:changed')); } catch (e) {}
    await reloadLive(); apply();
  }
  async function close(force) {
    if (!LE) return;
    if (!force && S.dirty && !(await confirmDlg('You have unsaved UI changes. Close anyway?'))) return;
    setPicking(false); if (S.hl) S.hl.classList.remove('aw-live-sel');
    layer.remove(); root.remove(); window.removeEventListener('keydown', onKey, true);
    setPageDraft(null); LE = null;
    try { window.dispatchEvent(new CustomEvent('athena-ui:live-closed')); } catch (e) {}
  }
  LE = { root, S, close, select: (el) => selectEl(el), selectSelector: (sel) => selectEl((() => { try { return document.querySelector(sel); } catch (e) { return null; } })(), sel), commit, apply, save, setLive, undo, redo, get doc() { return S.doc; }, setPicking, rule: (sel) => ruleFor(sel, false) };
  apply(); renderPanel(); setPicking(opts.picking !== false);
  return LE;
}
async function sourceOf(id) { try { const rows = (await api.listAll()).rows; const r = rows.find(x => x.id === id); return r ? r.source : null; } catch (e) { return null; } }
function bridgeToast(m) { try { const b = window.MythicBridge; if (b && b.toast) return b.toast(m); } catch (e) {} try { console.warn('[widgets] ' + m); } catch (e) {} }
function ensureCss() { if (document.getElementById('aw-css')) return; const l = document.createElement('link'); l.id = 'aw-css'; l.rel = 'stylesheet'; l.href = new URL('./widgets.css', import.meta.url).href; document.head.appendChild(l); }
