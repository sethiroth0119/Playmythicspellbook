/* ═══════════════════════════════════════════════════════════════════════════
   widgets.runtime.js — render a widget document into the live game.

   render(doc, ctx, opts)   → DOM for a widget tree, bindings resolved
   mount(host, doc, ctx)    → render + graph VM + refresh loop; returns a handle
   applyTheme(doc)          → a <style> with the theme's variables and rules
   boot()                   → load every LIVE document and attach it to its
                              target (a named slot or a CSS selector), now
                              and whenever the game's DOM changes

   The renderer is the same in the designer and in the game, which is what
   guarantees "what you designed is what players see". Data for bindings
   comes from the game through window.MythicBridge.ui (index.html hands it
   over — the globals trap) merged with whatever the slot's owner registers
   (the farm registers its view for its slots). Nothing here reads a bare
   global. Failures inside a widget never reach the game: every hook is
   wrapped, a bad expression reads as empty.
   ═══════════════════════════════════════════════════════════════════════════ */

import { WIDGET_TYPES, GRAPH_NODES, interpolate, evalExpr, truthy, walk, findNode, nodeByName , pageCss } from './widgets.format.js';
import * as api from './widgets.api.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssLen = (v) => (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) ? v + 'px' : String(v);
const SAFE_URL = /^(https?:\/\/|\/|\.\/|assets\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;

/* ── slot providers: data + actions a screen offers to widgets in its slots ── */
const providers = new Map();
export function registerSlotProvider(prefix, provider) { providers.set(prefix, provider || {}); return () => providers.delete(prefix); }
function providerFor(slotName) { let best = null, bestLen = -1; providers.forEach((p, k) => { if (slotName && slotName.indexOf(k) === 0 && k.length > bestLen) { best = p; bestLen = k.length; } }); return best; }

function bridgeUi() { try { const b = window.MythicBridge; return (b && b.ui) || null; } catch (e) { return null; } }
export function gameData(extra) {
  let base = {};
  try { const ui = bridgeUi(); if (ui && typeof ui.data === 'function') base = ui.data() || {}; } catch (e) { base = {}; }
  base.now = Date.now();
  return extra ? Object.assign({}, base, extra) : base;
}
export function gameActions() { try { const ui = bridgeUi(); return (ui && ui.actions) || {}; } catch (e) { return {}; } }
export function listActions() { const out = Object.keys(gameActions()); providers.forEach(p => Object.keys(p.actions || {}).forEach(k => { if (!out.includes(k)) out.push(k); })); return out; }
export function sampleData() { const d = gameData(); providers.forEach(p => { try { if (p.data) Object.assign(d, p.data()); } catch (e) {} }); return d; }
function toast(msg, ms) { try { const b = window.MythicBridge; if (b && b.toast) return b.toast(msg, ms); } catch (e) {} try { console.log('[widget]', msg); } catch (e) {} }

/* ═══ RENDER ═══ */
function styleOf(n, scope) {
  const st = n.style || {}; const css = [];
  const g = (k) => interpolate(st[k], scope);
  if (st.width) css.push('width:' + cssLen(g('width'))); if (st.height) css.push('height:' + cssLen(g('height')));
  if (st.minWidth) css.push('min-width:' + cssLen(g('minWidth'))); if (st.maxWidth) css.push('max-width:' + cssLen(g('maxWidth')));
  if (st.padding) css.push('padding:' + cssLen(g('padding'))); if (st.margin) css.push('margin:' + cssLen(g('margin')));
  if (st.bg) css.push('background:' + g('bg')); if (st.color) css.push('color:' + g('color'));
  if (st.border) css.push('border:' + g('border')); if (st.radius) css.push('border-radius:' + cssLen(g('radius')));
  if (st.opacity) css.push('opacity:' + g('opacity')); if (st.font) css.push('font:' + g('font'));
  if (st.shadow) css.push('box-shadow:' + g('shadow')); if (st.zIndex) css.push('z-index:' + g('zIndex'));
  if (st.pointer === 'none') css.push('pointer-events:none');
  return css.join(';');
}
function layoutOf(n) { const l = n.layout || {}; const a = l.anchor || 'tl'; const pos = a === 'c' ? 'left:calc(50% + ' + l.x + 'px);top:calc(50% + ' + l.y + 'px);transform:translate(-50%,-50%)' : ((a === 'tr' || a === 'br') ? 'right:' + l.x + 'px;' : 'left:' + l.x + 'px;') + ((a === 'bl' || a === 'br') ? 'bottom:' + l.y + 'px' : 'top:' + l.y + 'px'); return 'position:absolute;' + pos + ';width:' + l.w + 'px;' + (l.h ? 'height:' + l.h + 'px;' : ''); }

export function render(doc, ctx, opts) {
  opts = opts || {};
  const scope = { data: ctx.data(), vars: ctx.vars };
  const els = new Map();
  function build(n, parentFree) {
    const T = WIDGET_TYPES[n.type]; if (!T) return null;
    const p = {}; Object.keys(n.props || {}).forEach(k => { p[k] = interpolate(n.props[k], scope); });
    Object.keys(n.bind || {}).forEach(k => { if (n.bind[k]) p[k] = interpolate(n.bind[k], scope); });
    let el;
    switch (n.type) {
      case 'canvas': el = document.createElement('div'); el.className = 'aw-canvas'; break;
      case 'vbox': el = document.createElement('div'); el.className = 'aw-vbox'; el.style.gap = cssLen(p.gap || 0); el.style.alignItems = p.align || 'stretch'; break;
      case 'hbox': el = document.createElement('div'); el.className = 'aw-hbox'; el.style.gap = cssLen(p.gap || 0); el.style.alignItems = p.align || 'center'; if (truthy(p.wrap)) el.style.flexWrap = 'wrap'; break;
      case 'border': el = document.createElement('div'); el.className = 'aw-border'; el.style.padding = cssLen(p.padding || 0); break;
      case 'text': el = document.createElement('div'); el.className = 'aw-text'; el.textContent = p.text == null ? '' : String(p.text); el.style.fontSize = cssLen(p.size || 14); el.style.fontWeight = p.weight || '400'; el.style.textAlign = p.align || 'left'; break;
      case 'button': el = document.createElement('button'); el.type = 'button'; el.className = 'aw-button ' + (p.variant || 'primary'); el.textContent = p.label == null ? '' : String(p.label); if (opts.design) el.tabIndex = -1; break;
      case 'image': el = document.createElement('img'); el.className = 'aw-image'; el.alt = String(p.alt || ''); el.style.objectFit = p.fit || 'contain'; if (p.src && SAFE_URL.test(String(p.src))) el.src = String(p.src); else el.classList.add('empty'); break;
      case 'icon': el = document.createElement('span'); el.className = 'aw-icon'; el.textContent = String(p.glyph || ''); el.style.fontSize = cssLen(p.size || 20); break;
      case 'progress': { el = document.createElement('div'); el.className = 'aw-progress'; const v = Number(p.value) || 0, m = Number(p.max) || 100; const pct = Math.max(0, Math.min(100, m ? v / m * 100 : 0)); el.innerHTML = '<i style="width:' + pct.toFixed(1) + '%;background:' + esc(p.color || '#d4af37') + '"></i><span>' + esc(p.label || '') + '</span>'; break; }
      case 'spacer': el = document.createElement('div'); el.className = 'aw-spacer'; el.style.flex = '0 0 ' + cssLen(p.size || 8); el.style.width = cssLen(p.size || 8); el.style.height = cssLen(p.size || 8); break;
      case 'input': el = document.createElement('input'); el.type = 'text'; el.className = 'aw-input'; el.placeholder = String(p.placeholder || ''); if (p.var && ctx.vars[p.var]) el.value = String(ctx.vars[p.var].value == null ? '' : ctx.vars[p.var].value); if (opts.design) el.readOnly = true; break;
      case 'toggle': { el = document.createElement('label'); el.className = 'aw-toggle'; const on = !!(p.var && ctx.vars[p.var] && truthy(ctx.vars[p.var].value)); el.innerHTML = '<input type="checkbox" ' + (on ? 'checked' : '') + (opts.design ? ' disabled' : '') + '><span></span><b>' + esc(p.label || '') + '</b>'; break; }
      default: el = document.createElement('div');
    }
    el.setAttribute('data-aw-id', n.id); if (n.name) el.setAttribute('data-aw-name', n.name);
    const st = styleOf(n, scope); if (st) el.style.cssText += ';' + st;
    if (parentFree) el.style.cssText += ';' + layoutOf(n);
    if (p.visible != null && !truthy(p.visible) && !opts.design) el.hidden = true;
    if (p.visible != null && !truthy(p.visible) && opts.design) el.classList.add('aw-design-hidden');
    if (T.container) (n.children || []).forEach(c => { const ce = build(c, !!T.free); if (ce) el.appendChild(ce); });
    if (!opts.design) {
      if (n.type === 'button') el.addEventListener('click', (e) => { e.preventDefault(); ctx.emit('click', n, e); });
      if (n.type === 'input') el.addEventListener('input', () => { if (p.var) ctx.setVar(p.var, el.value); ctx.emit('change', n); });
      if (n.type === 'toggle') el.querySelector('input').addEventListener('change', (e) => { if (p.var) ctx.setVar(p.var, e.target.checked); ctx.emit('change', n); });
    }
    els.set(n.id, el);
    return el;
  }
  const root = build(doc.root, false);
  if (root) { root.classList.add('aw-root'); root.setAttribute('data-aw-doc', doc.id); }
  return { el: root, els };
}

/* ═══ MOUNT: renderer + graph VM + refresh ═══ */
export function mount(host, doc, ctx0) {
  ctx0 = ctx0 || {};
  const vars = {}; Object.keys(doc.vars || {}).forEach(k => { vars[k] = { type: doc.vars[k].type, value: doc.vars[k].value }; });
  let alive = true, view = null, lastHash = '', timers = [], listeners = [];
  const provider = ctx0.provider || null;
  const dataFn = () => { let d = gameData(ctx0.data ? ctx0.data() : null); if (provider && provider.data) { try { Object.assign(d, provider.data()); } catch (e) {} } return d; };
  const actions = Object.assign({}, gameActions(), (provider && provider.actions) || {}, ctx0.actions || {});
  const ctx = {
    data: dataFn, vars,
    setVar(k, v) { if (!vars[k]) vars[k] = { type: 'string', value: v }; const t = vars[k].type; vars[k].value = t === 'number' ? (Number(v) || 0) : t === 'bool' ? truthy(v) : v; scheduleRefresh(); },
    emit(kind, node) { fire(kind === 'click' ? 'ev_click' : 'ev_change', node); },
  };
  function scope() { return { data: dataFn(), vars }; }
  /* ── the VM: follow exec wires from an event node ── */
  const nodes = doc.graph.nodes, links = doc.graph.links;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const next = (n, pin) => links.filter(l => l.from.n === n.id && l.from.pin === pin).map(l => byId.get(l.to.n)).filter(Boolean);
  function fire(type, widgetNode) {
    nodes.filter(n => n.type === type).forEach(n => {
      if ((type === 'ev_click' || type === 'ev_change') && widgetNode) { const want = String(n.props.widget || '').trim(); if (want && want !== widgetNode.name && want !== widgetNode.id) return; }
      run(n, 0);
    });
  }
  function run(n, depth) {
    if (!alive || !n || depth > 500) return;
    const G = GRAPH_NODES[n.type]; if (!G) return;
    const P = (k) => interpolate(n.props[k], scope());
    const cont = (pin) => next(n, pin).forEach(m => run(m, depth + 1));
    try {
      switch (n.type) {
        case 'ev_construct': case 'ev_click': case 'ev_change': case 'ev_tick': cont('then'); break;
        case 'toast': toast(String(P('message') == null ? '' : P('message')), Number(P('ms')) || 3000); cont('then'); break;
        case 'setvar': { const k = String(n.props.var || '').trim(); if (k) ctx.setVar(k, evalExpr(stripBraces(n.props.value), scope())); cont('then'); break; }
        case 'branch': cont(truthy(evalExpr(stripBraces(n.props.cond), scope())) ? 'true' : 'false'); break;
        case 'sequence': cont('then 0'); cont('then 1'); cont('then 2'); break;
        case 'delay': { const t = setTimeout(() => { if (alive) cont('then'); }, Math.max(0, Number(P('ms')) || 0)); timers.push(t); break; }
        case 'call': { const name = String(n.props.action || '').trim(); const fn = actions[name]; const args = String(n.props.args || '').split(',').map(s => s.trim()).filter(Boolean).map(a => evalExpr(stripBraces(a), scope())); if (typeof fn === 'function') { try { fn.apply(null, args); } catch (e) {} } else toast('Widget: no game action named "' + name + '".', 2600); cont('then'); break; }
        case 'setprop': { const w = nodeByName(doc.root, String(n.props.widget || '')); if (w) { const k = String(n.props.prop || 'text'); if (k === 'visible') w.bind.visible = String(n.props.value); else w.props[k] = String(n.props.value); scheduleRefresh(); } cont('then'); break; }
        case 'visible': { const w = nodeByName(doc.root, String(n.props.widget || '')); if (w) { w.bind.visible = String(n.props.visible); scheduleRefresh(); } cont('then'); break; }
        case 'navigate': { const scr = String(P('screen') || '').trim(); if (actions.navigate) { try { actions.navigate(scr); } catch (e) {} } cont('then'); break; }
        case 'log': try { console.log('[widget ' + doc.name + ']', P('message')); } catch (e) {} cont('then'); break;
        default: cont('then');
      }
    } catch (e) { try { console.warn('[widget] node failed', n.type, e); } catch (x) {} }
  }
  /* ── render / refresh ── */
  let refreshT = 0;
  function scheduleRefresh() { if (!alive) return; clearTimeout(refreshT); refreshT = setTimeout(refresh, 16); }
  function refresh() {
    if (!alive || !host.isConnected) return;
    const r = render(doc, ctx, {});
    if (!r.el) return;
    // keep focus in an input across a re-render
    const ae = document.activeElement; const focusId = ae && view && view.el.contains(ae) ? ae.getAttribute('data-aw-id') : null; const sel = focusId && ae.selectionStart;
    if (view && view.el.parentNode) view.el.replaceWith(r.el); else host.appendChild(r.el);
    view = r;
    if (focusId) { const el = r.els.get(focusId); if (el) { try { el.focus(); if (sel != null && el.setSelectionRange) el.setSelectionRange(sel, sel); } catch (e) {} } }
  }
  function tick() {
    if (!alive) return;
    if (!host.isConnected) { handle.destroy(); return; }
    let h = ''; try { h = JSON.stringify(dataFn()) + JSON.stringify(vars); } catch (e) { h = String(Math.random()); }
    if (h !== lastHash) { lastHash = h; refresh(); }
  }
  refresh(); lastHash = ''; tick();
  const iv = setInterval(tick, 500); timers.push(iv);
  nodes.filter(n => n.type === 'ev_tick').forEach(n => { const ms = Math.max(100, Number(n.props.ms) || 1000); const t = setInterval(() => { if (alive) run(n, 0); }, ms); timers.push(t); });
  fire('ev_construct');
  const handle = {
    doc, host, get el() { return view && view.el; }, vars,
    refresh: scheduleRefresh, fire: (type) => fire(type),
    destroy() { if (!alive) return; alive = false; timers.forEach(t => { clearTimeout(t); clearInterval(t); }); listeners.forEach(f => { try { f(); } catch (e) {} }); try { if (view && view.el.parentNode) view.el.remove(); } catch (e) {} },
  };
  return handle;
}
function stripBraces(s) { s = String(s == null ? '' : s).trim(); const m = /^\{([^{}]*)\}$/.exec(s); return m ? m[1] : s; }

/* ═══ THEMES ═══ */
export function themeCss(doc) {
  const vars = Object.keys(doc.theme.vars || {}).map(k => '  ' + k + ': ' + String(doc.theme.vars[k]).replace(/[;{}]/g, '') + ';').join('\n');
  // raw rules are the designer's own CSS; strip anything that could load a resource or escape the sheet
  const css = String(doc.theme.css || '').replace(/@import[^;]*;/gi, '').replace(/url\((?!\s*['"]?(\/|assets\/|https:\/\/))[^)]*\)/gi, 'none').replace(/<\/style/gi, '');
  return (vars ? ':root {\n' + vars + '\n}\n' : '') + css;
}
export function applyTheme(doc) {
  const id = 'aw-theme-' + doc.id;
  let st = document.getElementById(id);
  if (!st) { st = document.createElement('style'); st.id = id; st.setAttribute('data-aw-theme', doc.id); document.head.appendChild(st); }
  st.textContent = themeCss(doc);
  return () => { try { st.remove(); } catch (e) {} };
}

/* ═══ BOOT: live documents → their targets ═══ */
const live = { docs: [], mounts: new Map(), themes: new Map(), observer: null, overlayHost: null, ready: false, pageDraft: null, pageStyle: null };
/* ── page overrides ── (round 14: the live UI editor). One <style> for every
   live page doc plus the editor's draft; text rules are written into the
   matching elements' own text nodes on every sync (re-renders put the
   original text back, the next sync puts ours back — marked so it is idempotent). */
function pageDocs() { const docs = live.docs.filter(d => d.kind === 'page'); if (live.pageDraft) return docs.filter(d => d.id !== live.pageDraft.id).concat([live.pageDraft]); return docs; }
function applyPageCss() {
  const css = pageCss(pageDocs());
  if (!live.pageStyle || !live.pageStyle.isConnected) { live.pageStyle = document.createElement('style'); live.pageStyle.id = 'aw-pages'; document.head.appendChild(live.pageStyle); }
  if (live.pageStyle.textContent !== css) live.pageStyle.textContent = css;
}
export function currentScreen() { try { const d = gameData(); return String(d.screen || ''); } catch (e) { return ''; } }
function syncScreenAttr() { try { const sc = currentScreen(); if (document.body.getAttribute('data-aw-screen') !== sc) document.body.setAttribute('data-aw-screen', sc); } catch (e) {} }
/* Direct text of an element = its own text nodes (children like icons stay). */
export function elementText(el) { return Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim(); }
export function setElementText(el, text) {
  const tn = Array.from(el.childNodes).filter(n => n.nodeType === 3);
  if (!el.__awOrigText) el.__awOrigText = tn.map(n => n.nodeValue);
  // keep the node's own leading/trailing whitespace so "<icon> Label" stays spaced
  if (tn.length) { let done = false; tn.forEach(n => { if (!done && n.nodeValue.trim()) { const m = /^(\s*)[\s\S]*?(\s*)$/.exec(n.nodeValue); n.nodeValue = (m ? m[1] : '') + text + (m ? m[2] : ''); done = true; } else if (done) n.nodeValue = ''; }); if (!done) tn[0].nodeValue = text; }
  else el.appendChild(document.createTextNode(text));
}
function restoreElementText(el) { const orig = el.__awOrigText; if (!orig) return; const tn = Array.from(el.childNodes).filter(n => n.nodeType === 3); tn.forEach((n, i) => { if (i < orig.length) n.nodeValue = orig[i]; else n.nodeValue = ''; }); if (!tn.length && orig.length) el.appendChild(document.createTextNode(orig.join(''))); delete el.__awOrigText; }
function syncPageText() {
  const sc = currentScreen(); const marks = new Map();   // el → key applied this pass
  pageDocs().forEach(d => {
    if (d.page.screen && d.page.screen !== sc) return;
    d.page.rules.forEach(r => {
      if (typeof r.text !== 'string' && !r.attrs) return;
      let els = []; try { els = Array.from(document.querySelectorAll(r.sel)); } catch (e) { return; }
      els.forEach(el => {
        if (el.closest('#aw-root, #aw-live, #mf-root, #aw-picklayer')) return;
        const key = d.id + ':' + r.id + ':' + (r.text || '') + ':' + JSON.stringify(r.attrs || {});
        if (typeof r.text === 'string' && (el.getAttribute('data-aw-text') !== key || elementText(el) !== r.text.trim())) { setElementText(el, r.text); }
        if (r.attrs) Object.keys(r.attrs).forEach(a => { if (el.getAttribute(a) !== r.attrs[a]) { if (!el.__awOrigAttrs) el.__awOrigAttrs = {}; if (!(a in el.__awOrigAttrs)) el.__awOrigAttrs[a] = el.getAttribute(a); el.setAttribute(a, r.attrs[a]); } });
        el.setAttribute('data-aw-text', key); marks.set(el, key);
      });
    });
  });
  // elements we touched before whose rule is gone: put the original back
  try { document.querySelectorAll('[data-aw-text]').forEach(el => { if (marks.has(el)) return; restoreElementText(el); if (el.__awOrigAttrs) { Object.keys(el.__awOrigAttrs).forEach(a => { const v = el.__awOrigAttrs[a]; if (v == null) el.removeAttribute(a); else el.setAttribute(a, v); }); delete el.__awOrigAttrs; } el.removeAttribute('data-aw-text'); }); } catch (e) {}
}
export function setPageDraft(doc) { live.pageDraft = doc ? JSON.parse(JSON.stringify(doc)) : null; applyPageCss(); syncScreenAttr(); syncPageText(); }
export function pageInfo() { return { screen: currentScreen(), docs: pageDocs().map(d => ({ id: d.id, name: d.name, screen: d.page.screen, rules: d.page.rules.length, draft: !!(live.pageDraft && live.pageDraft.id === d.id) })) }; }
function overlayHost() {
  if (live.overlayHost && live.overlayHost.isConnected) return live.overlayHost;
  const el = document.createElement('div'); el.id = 'aw-overlay'; el.setAttribute('data-athena-slot', 'game.overlay'); document.body.appendChild(el); live.overlayHost = el; return el;
}
export function knownSlots() {
  const out = new Set(['game.overlay']);
  try { document.querySelectorAll('[data-athena-slot]').forEach(el => out.add(el.getAttribute('data-athena-slot'))); } catch (e) {}
  providers.forEach((p, k) => (p.slots || []).forEach(s => out.add(s)));
  return Array.from(out).sort();
}
function targetsFor(doc) {
  const t = doc.target || {};
  try {
    if (t.mode === 'slot' && t.slot) return Array.from(document.querySelectorAll('[data-athena-slot="' + CSS.escape(t.slot) + '"]'));
    if (t.mode === 'selector' && t.selector) return Array.from(document.querySelectorAll(t.selector)).filter(el => !el.closest('#mf-root, #aw-root, #aw-overlay'));
  } catch (e) {}
  return [];
}
function attachOne(doc, target) {
  const key = doc.id + '@' + (target.getAttribute('data-aw-host-key') || (() => { const k = 'h' + Math.random().toString(36).slice(2, 8); target.setAttribute('data-aw-host-key', k); return k; })());
  if (live.mounts.has(key)) return;
  const t = doc.target || {}; let host = target;
  if (t.mode === 'selector') {
    host = document.createElement('div'); host.className = 'aw-host aw-host-' + t.place;
    if (t.place === 'replace') { target.setAttribute('data-aw-replaced', doc.id); target.style.display = 'none'; target.insertAdjacentElement('afterend', host); }
    else if (t.place === 'contents') { target.setAttribute('data-aw-contents', doc.id); Array.from(target.childNodes).forEach(c => { c.__awHidden = true; if (c.nodeType === 1) c.style.display = 'none'; }); target.appendChild(host); }
    else if (t.place === 'before') target.insertAdjacentElement('beforebegin', host);
    else if (t.place === 'after') target.insertAdjacentElement('afterend', host);
    else if (t.place === 'prepend') target.insertAdjacentElement('afterbegin', host);
    else target.appendChild(host);
  }
  const slotName = t.mode === 'slot' ? t.slot : '';
  const m = mount(host, doc, { provider: providerFor(slotName) });
  m.hostEl = host; m.targetEl = target; m.key = key;
  live.mounts.set(key, m);
}
function detachOne(key) {
  const m = live.mounts.get(key); if (!m) return; live.mounts.delete(key);
  m.destroy();
  try { if (m.hostEl !== m.targetEl) m.hostEl.remove(); const t = m.targetEl; if (t.getAttribute('data-aw-replaced') === m.doc.id) { t.style.display = ''; t.removeAttribute('data-aw-replaced'); } if (t.getAttribute('data-aw-contents') === m.doc.id) { Array.from(t.childNodes).forEach(c => { if (c.__awHidden && c.nodeType === 1) c.style.display = ''; }); t.removeAttribute('data-aw-contents'); } } catch (e) {}
}
let syncT = 0;
function sync() {
  if (!live.ready) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => {
    const wanted = new Set();
    syncScreenAttr(); syncPageText();
    live.docs.forEach(doc => {
      if (doc.kind === 'theme' || doc.kind === 'page') return;
      if (doc.target.mode === 'none') return;
      targetsFor(doc).forEach(target => { const k = doc.id + '@' + (target.getAttribute('data-aw-host-key') || ''); if (target.getAttribute('data-aw-host-key') && live.mounts.has(k)) { wanted.add(k); return; } attachOne(doc, target); wanted.add(doc.id + '@' + target.getAttribute('data-aw-host-key')); });
    });
    Array.from(live.mounts.keys()).forEach(k => { const m = live.mounts.get(k); if (!wanted.has(k) || !m.targetEl.isConnected) detachOne(k); });
  }, 60);
}
export function setLiveDocs(docs) {
  live.docs = docs.slice();
  // themes
  const want = new Set();
  docs.filter(d => d.kind === 'theme').forEach(d => { want.add(d.id); if (live.themes.has(d.id)) live.themes.get(d.id)(); live.themes.set(d.id, applyTheme(d)); });
  Array.from(live.themes.keys()).forEach(id => { if (!want.has(id)) { live.themes.get(id)(); live.themes.delete(id); } });
  // widgets: drop mounts of documents no longer live (or changed), sync the rest
  const ids = new Set(docs.map(d => d.id));
  Array.from(live.mounts.keys()).forEach(k => { const m = live.mounts.get(k); const cur = docs.find(d => d.id === m.doc.id); if (!ids.has(m.doc.id) || (cur && JSON.stringify(cur) !== JSON.stringify(m.doc))) detachOne(k); });
  live.ready = true; overlayHost(); applyPageCss(); sync();
}
export async function reload() {
  const r = await api.liveAll();
  setLiveDocs(r.docs);
  return r;
}
export function boot() {
  if (live.observer) return;
  overlayHost();
  live.observer = new MutationObserver(() => sync());
  try { live.observer.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  // signed-in state can arrive after load: reload a few times early on, then on demand
  reload(); [2500, 8000].forEach(ms => setTimeout(reload, ms));
  window.addEventListener('athena-ui:changed', () => reload());
}
export function refreshAll() { live.mounts.forEach(m => m.refresh()); }
export function mountsInfo() { return Array.from(live.mounts.values()).map(m => ({ doc: m.doc.name, target: m.doc.target })); }
export function liveDocs() { return live.docs.slice(); }
