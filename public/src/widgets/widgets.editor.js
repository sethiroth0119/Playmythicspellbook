/* ═══════════════════════════════════════════════════════════════════════════
   widgets.editor.js — the Widget Designer (Unreal's UMG editor, in the game).

   A full-screen overlay (#aw-root) with three views on one document:
     Designer  the widget tree drawn by the SAME renderer the game uses,
               palette on the left, details on the right, drag/resize inside
               a Canvas panel;
     Graph     the event graph: nodes joined by execution wires;
     Theme     (theme documents) CSS variables + rules, previewed live.
   Plus Target (where it shows: a slot or any element — 🎯 Pick lets the
   admin click a piece of the real game UI to capture its selector), a Library
   of saved documents, Preview (a live mount with real data), Save and ★ Live.

   Everything the game does with a document goes through widgets.runtime.js;
   this file only edits the JSON and re-renders. Nothing here reads a bare
   global from index.html — data comes through window.MythicBridge.ui.
   ═══════════════════════════════════════════════════════════════════════════ */

import { WIDGET_TYPES, GRAPH_NODES, STYLE_KEYS, ANCHORS, newWidget, newNode, newGraphNode, normalize, serialize, clone, walk, findNode, findParent, uid, interpolate } from './widgets.format.js';
import { render, mount, sampleData, listActions, knownSlots, themeCss, reload as reloadLive } from './widgets.runtime.js';
import * as api from './widgets.api.js';

let ED = null;
export function isOpen() { return !!ED; }
export function current() { return ED; }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function openDesigner(opts) {
  opts = opts || {};
  if (ED) return ED;
  ensureCss();
  const root = document.createElement('div'); root.id = 'aw-root'; root.innerHTML = TEMPLATE; document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const $ = (q) => root.querySelector(q), $$ = (q) => Array.from(root.querySelectorAll(q));
  const toastEl = $('.aw-toast'); let toastT = 0;
  const toast = (m, ms) => { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 2600); };
  const confirmDlg = async (m) => { try { const b = window.MythicBridge; if (b && b.confirm) return !!(await b.confirm(m)); } catch (e) {} return window.confirm(m); };
  const signedIn = () => { try { const b = window.MythicBridge; return !!(b && b.signedIn()); } catch (e) { return false; } };

  const S = { doc: null, source: null, mine: true, dirty: false, view: 'designer', sel: null, gsel: null, undo: [], redo: [], preview: null, themeStyle: null, drag: null, wire: null, pan: { x: 0, y: 0 } };
  ED = { root, S, toast, close: () => close(false), get doc() { return S.doc; } };

  // ── document ──
  let doc = null;
  if (opts.doc) doc = normalize(opts.doc);
  else if (opts.id) { const r = await api.load(opts.id, opts.source || 'local'); if (r.ok) { doc = r.doc; S.source = opts.source || 'local'; S.mine = r.mine !== false; } else toast('Could not load: ' + (r.error || 'unknown'), 4000); }
  if (!doc) { const d = api.loadDraft(); if (d) { doc = d; setTimeout(() => toast('Restored your unsaved draft.', 3000), 500); } }
  if (!doc) doc = newWidget({ author: api.displayName(), kind: opts.kind });
  if (!ED) return null;

  function loadDoc(d, source) {
    S.doc = d; S.source = source == null ? S.source : source; S.sel = d.root ? d.root.id : null; S.gsel = null; S.undo.length = 0; S.redo.length = 0;
    stopPreview(); $('.aw-top .name input').value = d.name; $('#aw-kind').textContent = d.kind === 'theme' ? '🎨 Theme' : '🧩 Widget';
    setView(d.kind === 'theme' ? 'theme' : 'designer'); renderAll(); setDirty(false); applyThemePreview();
  }
  function setDirty(v) { S.dirty = v; const st = $('.aw-top .state'); st.textContent = v ? '● Unsaved changes' : (S.source === 'cloud' ? '☁ Saved to cloud' : S.source === 'local' ? '💾 Saved on this device' : 'New document'); st.classList.toggle('dirty', v); if (v) { clearTimeout(draftT); draftT = setTimeout(() => api.saveDraft(S.doc), 2500); } }
  let draftT = 0;
  function snapshot() { S.undo.push(JSON.stringify(S.doc)); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; }
  function commit(fn) { snapshot(); fn(); setDirty(true); renderAll(); }
  function undo() { const s = S.undo.pop(); if (!s) return; S.redo.push(JSON.stringify(S.doc)); S.doc = normalize(JSON.parse(s)); setDirty(true); renderAll(); applyThemePreview(); }
  function redo() { const s = S.redo.pop(); if (!s) return; S.undo.push(JSON.stringify(S.doc)); S.doc = normalize(JSON.parse(s)); setDirty(true); renderAll(); applyThemePreview(); }

  /* ═══ VIEWS ═══ */
  function setView(v) { S.view = v; $$('.aw-views button').forEach(b => b.classList.toggle('on', b.dataset.view === v)); $$('.aw-view').forEach(p => p.classList.toggle('on', p.dataset.view === v)); if (v === 'graph') renderGraph(); if (v === 'theme') renderTheme(); }
  function renderAll() { renderStage(); renderTree(); renderDetails(); renderVars(); if (S.view === 'graph') renderGraph(); if (S.view === 'theme') renderTheme(); renderTarget(); $('#aw-undo').disabled = !S.undo.length; $('#aw-redo').disabled = !S.redo.length; }

  /* ═══ DESIGNER ═══ */
  const sampleCtx = () => ({ data: () => sampleData(), vars: Object.fromEntries(Object.keys(S.doc.vars).map(k => [k, { type: S.doc.vars[k].type, value: S.doc.vars[k].value }])), emit() {}, setVar() {} });
  function renderStage() {
    const stage = $('#aw-stage'); stage.innerHTML = '';
    if (S.doc.kind === 'theme' || !S.doc.root) { stage.innerHTML = '<div class="aw-empty">A theme has no widget tree — use the Theme view.</div>'; return; }
    const r = render(S.doc, sampleCtx(), { design: true });
    if (!r.el) return;
    const frame = document.createElement('div'); frame.className = 'aw-frame'; frame.style.width = ($('#aw-frame-w').value || 420) + 'px'; frame.appendChild(r.el); stage.appendChild(frame);
    r.els.forEach((el, id) => {
      el.classList.add('aw-d');
      if (id === S.sel) el.classList.add('aw-sel');
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); if (e.button !== 0) return;
        selectNode(id);
        const n = findNode(S.doc.root, id), parent = findParent(S.doc.root, id);
        if (parent && WIDGET_TYPES[parent.type].free) {
          const handle = e.target.classList.contains('aw-rz');
          S.drag = { id, x0: e.clientX, y0: e.clientY, lx: n.layout.x, ly: n.layout.y, lw: n.layout.w, lh: n.layout.h, resize: handle, anchor: n.layout.anchor };
          snapshot(); stage.setPointerCapture(e.pointerId);
        }
      });
      const parent = findParent(S.doc.root, id);
      if (parent && WIDGET_TYPES[parent.type].free) { const rz = document.createElement('i'); rz.className = 'aw-rz'; el.appendChild(rz); el.classList.add('aw-free'); }
    });
  }
  const stageEl = $('#aw-stage');
  stageEl.addEventListener('pointermove', (e) => {
    const d = S.drag; if (!d) return;
    const n = findNode(S.doc.root, d.id); if (!n) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    const sx = (d.anchor === 'tr' || d.anchor === 'br') ? -1 : 1, sy = (d.anchor === 'bl' || d.anchor === 'br') ? -1 : 1;
    if (d.resize) { n.layout.w = Math.max(10, Math.round(d.lw + dx)); n.layout.h = Math.max(10, Math.round(d.lh + dy)); }
    else { n.layout.x = Math.round(d.lx + dx * sx); n.layout.y = Math.round(d.ly + dy * sy); }
    const el = stageEl.querySelector('[data-aw-id="' + d.id + '"]'); if (el) { const st = layoutCss(n); el.style.cssText = el.style.cssText.replace(/position:absolute[^]*$/, '') + ';' + st; }
    setDirty(true);
  });
  stageEl.addEventListener('pointerup', () => { if (S.drag) { S.drag = null; renderDetails(); } });
  stageEl.addEventListener('pointerdown', (e) => { if (e.target === stageEl || e.target.classList.contains('aw-frame')) selectNode(S.doc.root ? S.doc.root.id : null); });
  function layoutCss(n) { const l = n.layout, a = l.anchor || 'tl'; return 'position:absolute;' + (a === 'c' ? 'left:calc(50% + ' + l.x + 'px);top:calc(50% + ' + l.y + 'px);transform:translate(-50%,-50%)' : ((a === 'tr' || a === 'br') ? 'right:' + l.x + 'px;' : 'left:' + l.x + 'px;') + ((a === 'bl' || a === 'br') ? 'bottom:' + l.y + 'px' : 'top:' + l.y + 'px')) + ';width:' + l.w + 'px;' + (l.h ? 'height:' + l.h + 'px;' : ''); }
  function selectNode(id) { S.sel = id; S.gsel = null; $$('#aw-stage .aw-sel').forEach(el => el.classList.remove('aw-sel')); const el = stageEl.querySelector('[data-aw-id="' + id + '"]'); if (el) el.classList.add('aw-sel'); renderTree(); renderDetails(); }
  function selectedNode() { return S.sel && S.doc.root ? findNode(S.doc.root, S.sel) : null; }
  function containerForAdd() { let n = selectedNode(); if (!n) return S.doc.root; if (WIDGET_TYPES[n.type].container) return n; return findParent(S.doc.root, n.id) || S.doc.root; }
  function addWidget(type) {
    if (S.doc.kind === 'theme') return;
    const parent = containerForAdd(); if (!parent) return;
    const n = newNode(type); const count = countType(type); n.name = (WIDGET_TYPES[type].label.split(' ')[0]) + '_' + count;
    if (WIDGET_TYPES[parent.type].free) { n.layout = { x: 16 + (parent.children.length % 6) * 14, y: 16 + (parent.children.length % 6) * 14, w: type === 'text' ? 180 : type === 'button' ? 140 : type === 'progress' ? 200 : 120, h: type === 'text' ? 24 : 36, anchor: 'tl' }; }
    commit(() => { parent.children.push(n); }); selectNode(n.id);
  }
  function countType(type) { let c = 0; walk(S.doc.root, n => { if (n.type === type) c++; }); return c + 1; }
  function removeNode(id) { const p = findParent(S.doc.root, id); if (!p) { toast('The root cannot be deleted.'); return; } commit(() => { p.children = p.children.filter(c => c.id !== id); }); selectNode(p.id); }
  function moveNode(id, dir) { const p = findParent(S.doc.root, id); if (!p) return; const i = p.children.findIndex(c => c.id === id); const j = i + dir; if (j < 0 || j >= p.children.length) return; commit(() => { const [n] = p.children.splice(i, 1); p.children.splice(j, 0, n); }); }
  function reparent(id, targetId, index) {
    if (id === targetId) return; const n = findNode(S.doc.root, id), t = findNode(S.doc.root, targetId); if (!n || !t) return;
    let inside = false; walk(n, x => { if (x.id === targetId) inside = true; }); if (inside) return;
    const p = findParent(S.doc.root, id); if (!p) return;
    commit(() => { p.children = p.children.filter(c => c.id !== id); if (WIDGET_TYPES[t.type].container) { if (index == null) t.children.push(n); else t.children.splice(index, 0, n); } else { const tp = findParent(S.doc.root, targetId); const ti = tp.children.findIndex(c => c.id === targetId); tp.children.splice(ti + 1, 0, n); } });
  }
  function duplicateNode(id) { const n = findNode(S.doc.root, id), p = findParent(S.doc.root, id); if (!n || !p) return; const c = clone(n); walk(c, x => { x.id = uid('n_'); }); c.name = (n.name || n.type) + '_copy'; if (c.layout) { c.layout.x += 12; c.layout.y += 12; } commit(() => { p.children.splice(p.children.indexOf(n) + 1, 0, c); }); selectNode(c.id); }

  /* ═══ TREE ═══ */
  function renderTree() {
    const box = $('#aw-tree'); if (!S.doc.root) { box.innerHTML = '<div class="aw-empty">No tree (theme).</div>'; return; }
    let html = '';
    walk(S.doc.root, (n, p, depth) => { const T = WIDGET_TYPES[n.type]; html += `<div class="aw-tr ${n.id === S.sel ? 'sel' : ''}" draggable="${p ? 'true' : 'false'}" data-id="${n.id}" style="--d:${depth}"><span class="ic">${T.icon}</span><span class="lb">${esc(n.name || T.label)}</span><span class="ty">${esc(T.label)}</span></div>`; });
    box.innerHTML = html;
    box.querySelectorAll('.aw-tr').forEach(row => {
      const id = row.dataset.id;
      row.onclick = () => selectNode(id);
      row.ondragstart = (e) => { e.dataTransfer.setData('text/aw-node', id); };
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = (e) => { e.preventDefault(); row.classList.remove('over'); const src = e.dataTransfer.getData('text/aw-node'); if (src) reparent(src, id); };
    });
  }
  /* ═══ VARIABLES ═══ */
  function renderVars() {
    const box = $('#aw-vars'); const V = S.doc.vars;
    box.innerHTML = Object.keys(V).map(k => `<div class="aw-var" data-k="${esc(k)}"><code>$${esc(k)}</code><select data-f="type"><option value="string" ${V[k].type === 'string' ? 'selected' : ''}>text</option><option value="number" ${V[k].type === 'number' ? 'selected' : ''}>number</option><option value="bool" ${V[k].type === 'bool' ? 'selected' : ''}>bool</option></select><input type="text" data-f="value" value="${esc(V[k].value == null ? '' : V[k].value)}" placeholder="default"><button data-f="del" title="Remove">✕</button></div>`).join('') || '<div class="aw-empty">No variables. Add one to hold state (a counter, a toggle) the graph reads and writes.</div>';
    box.querySelectorAll('.aw-var').forEach(row => { const k = row.dataset.k; row.querySelector('[data-f="type"]').onchange = (e) => commit(() => { V[k].type = e.target.value; }); row.querySelector('[data-f="value"]').onchange = (e) => commit(() => { V[k].value = V[k].type === 'number' ? (Number(e.target.value) || 0) : V[k].type === 'bool' ? /^(true|1|yes|on)$/i.test(e.target.value) : e.target.value; }); row.querySelector('[data-f="del"]').onclick = () => commit(() => { delete V[k]; }); });
  }
  $('#aw-var-add').onclick = () => { const k = String($('#aw-var-name').value || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40); if (!k) { toast('Variable names: letters, digits, underscore.'); return; } if (S.doc.vars[k]) { toast('That variable exists.'); return; } commit(() => { S.doc.vars[k] = { type: 'number', value: 0 }; }); $('#aw-var-name').value = ''; };

  /* ═══ DETAILS ═══ */
  function field(label, inner, hint) { return `<div class="aw-row"><label title="${esc(hint || '')}">${esc(label)}</label>${inner}</div>`; }
  function inp(id, v, ph) { return `<input type="text" data-id="${id}" value="${esc(v == null ? '' : v)}" placeholder="${esc(ph || '')}">`; }
  function renderDetails() {
    const box = $('#aw-details');
    const g = S.gsel && S.doc.graph.nodes.find(n => n.id === S.gsel);
    if (g) { renderGraphNodeDetails(box, g); return; }
    const n = selectedNode();
    if (!n) { box.innerHTML = '<div class="aw-empty">Select a widget in the designer or the hierarchy.</div>'; return; }
    const T = WIDGET_TYPES[n.type]; const parent = findParent(S.doc.root, n.id);
    const propRows = Object.keys(T.props || {}).map(k => {
      const v = n.props[k];
      let ctl;
      if (k === 'align' && n.type === 'text') ctl = sel('p:' + k, v, ['left', 'center', 'right']);
      else if (k === 'align') ctl = sel('p:' + k, v, ['stretch', 'flex-start', 'center', 'flex-end']);
      else if (k === 'variant') ctl = sel('p:' + k, v, ['primary', 'secondary', 'ghost', 'danger']);
      else if (k === 'fit') ctl = sel('p:' + k, v, ['contain', 'cover', 'fill']);
      else if (k === 'weight') ctl = sel('p:' + k, v, ['300', '400', '600', '700', '800']);
      else if (k === 'wrap') ctl = `<input type="checkbox" data-id="p:${k}" ${v ? 'checked' : ''}>`;
      else if (k === 'var') ctl = `<input type="text" data-id="p:${k}" list="aw-varlist" value="${esc(v)}" placeholder="variable name">`;
      else if (k === 'text' || k === 'message') ctl = `<textarea data-id="p:${k}" rows="2">${esc(v)}</textarea>`;
      else ctl = inp('p:' + k, v);
      return field(k, ctl, 'Static value — may contain {bindings}');
    }).join('');
    const bindKeys = Object.keys(T.props || {}).concat(['visible']);
    const bindRows = bindKeys.map(k => field(k, inp('b:' + k, n.bind[k], k === 'visible' ? '{gems} > 100' : '{expr|filter}'), 'Expression evaluated live; overrides the static value')).join('');
    const styleRows = STYLE_KEYS.filter(k => k !== 'gapOverride').map(k => field(k, k === 'pointer' ? sel('s:' + k, n.style[k] || '', ['', 'none']) : inp('s:' + k, n.style[k], { bg: 'rgba(0,0,0,.5) or #hex', color: '#e8e2d6', border: '1px solid #444', radius: '8', padding: '8px 12px', font: '600 14px system-ui', shadow: '0 4px 16px rgba(0,0,0,.4)', width: '200 or 50%', height: 'auto' }[k] || ''))).join('');
    const layoutRows = parent && WIDGET_TYPES[parent.type].free ? `<div class="aw-sec"><h4>Canvas slot</h4>${field('anchor', sel('l:anchor', n.layout.anchor, ANCHORS))}${['x', 'y', 'w', 'h'].map(k => field(k, `<input type="number" data-id="l:${k}" value="${n.layout[k]}">`)).join('')}</div>` : '';
    const evRows = (T.events || []).map(ev => field('On ' + ev, `<button data-ev="${ev}" class="small">＋ Add graph event</button>`, 'Creates an event node in the graph for this widget')).join('');
    box.innerHTML = `<div class="aw-sec"><h4>${T.icon} ${esc(T.label)} ${T.help ? '<small>' + esc(T.help) + '</small>' : ''}</h4>
        ${field('name', inp('n:name', n.name, 'unique name for the graph'))}
        <div class="aw-btns"><button data-act="dup">⧉ Duplicate</button><button data-act="up">▲</button><button data-act="down">▼</button>${parent ? '<button data-act="del" class="danger">✕ Delete</button>' : ''}</div></div>
      ${propRows ? '<div class="aw-sec"><h4>Properties</h4>' + propRows + '</div>' : ''}
      <div class="aw-sec"><h4>Bindings <small>live data → property</small></h4>${bindRows}</div>
      ${evRows ? '<div class="aw-sec"><h4>Events</h4>' + evRows + '</div>' : ''}
      ${layoutRows}
      <div class="aw-sec aw-collapsible"><h4 data-toggle="style">Style <small>▸ ${Object.keys(n.style).length} set</small></h4><div class="aw-body" data-body="style" ${Object.keys(n.style).length ? '' : 'hidden'}>${styleRows}</div></div>`;
    box.querySelectorAll('[data-id]').forEach(el => {
      const [kind, key] = el.dataset.id.split(':');
      const apply = () => commit(() => {
        const v = el.type === 'checkbox' ? el.checked : el.value;
        if (kind === 'p') n.props[key] = v; else if (kind === 'b') { if (v) n.bind[key] = v; else delete n.bind[key]; } else if (kind === 's') { if (v) n.style[key] = v; else delete n.style[key]; } else if (kind === 'l') n.layout[key] = key === 'anchor' ? v : (Number(v) || 0); else if (kind === 'n') n.name = String(v).trim().slice(0, 40);
      });
      el.onchange = apply; if (el.tagName === 'TEXTAREA') el.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply(); e.stopPropagation(); };
    });
    box.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { const ev = b.dataset.ev; if (!n.name) { commit(() => { n.name = n.type + '_' + countType(n.type); }); } const gn = newGraphNode(ev === 'click' ? 'ev_click' : 'ev_change', 60, 60 + S.doc.graph.nodes.length * 30); gn.props.widget = n.name; commit(() => { S.doc.graph.nodes.push(gn); }); S.gsel = gn.id; setView('graph'); renderDetails(); toast('Event node added — wire it to actions in the Graph.'); });
    const act = (a, fn) => { const b = box.querySelector('[data-act="' + a + '"]'); if (b) b.onclick = fn; };
    act('dup', () => duplicateNode(n.id)); act('up', () => moveNode(n.id, -1)); act('down', () => moveNode(n.id, +1)); act('del', () => removeNode(n.id));
    const tg = box.querySelector('[data-toggle="style"]'); if (tg) tg.onclick = () => { const b = box.querySelector('[data-body="style"]'); b.hidden = !b.hidden; };
  }
  function sel(id, v, opts) { return `<select data-id="${id}">${opts.map(o => '<option value="' + esc(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o || '—') + '</option>').join('')}</select>`; }
  function renderGraphNodeDetails(box, g) {
    const G = GRAPH_NODES[g.type];
    const rows = Object.keys(G.props || {}).map(k => {
      let ctl;
      if (k === 'widget') ctl = `<input type="text" data-k="${k}" list="aw-widgetlist" value="${esc(g.props[k])}">`;
      else if (k === 'action') ctl = `<input type="text" data-k="${k}" list="aw-actionlist" value="${esc(g.props[k])}">`;
      else if (k === 'var') ctl = `<input type="text" data-k="${k}" list="aw-varlist" value="${esc(g.props[k])}">`;
      else if (k === 'prop') ctl = sel2(k, g.props[k], ['text', 'label', 'value', 'max', 'src', 'glyph', 'placeholder', 'visible']);
      else if (k === 'message' || k === 'value' || k === 'cond' || k === 'args') ctl = `<textarea data-k="${k}" rows="2">${esc(g.props[k])}</textarea>`;
      else ctl = `<input type="text" data-k="${k}" value="${esc(g.props[k])}">`;
      return field(k, ctl);
    }).join('');
    box.innerHTML = `<div class="aw-sec"><h4><span class="aw-gdot" style="background:${G.color}"></span> ${esc(G.label)} ${G.help ? '<small>' + esc(G.help) + '</small>' : ''}</h4>${rows || '<div class="aw-empty">No fields.</div>'}<div class="aw-btns" style="margin-top:8px"><button data-act="gdel" class="danger">✕ Delete node</button></div></div>
      <div class="aw-sec"><h4>Expressions <small>cheat sheet</small></h4><div class="aw-hint"><code>{gems|num}</code> a game value with a filter · <code>{$count}</code> a variable · <code>{$count} + 1</code>, <code>{gems} > 100 && {farm.animals} < 3</code> · filters: num int fixed:1 pct upper lower cap time len default:x · functions: min max round floor len str num now</div></div>`;
    box.querySelectorAll('[data-k]').forEach(el => { el.onchange = () => commit(() => { g.props[el.dataset.k] = el.value; }); if (el.tagName === 'TEXTAREA') el.onkeydown = (e) => e.stopPropagation(); });
    box.querySelector('[data-act="gdel"]').onclick = () => { commit(() => { S.doc.graph.nodes = S.doc.graph.nodes.filter(n => n.id !== g.id); S.doc.graph.links = S.doc.graph.links.filter(l => l.from.n !== g.id && l.to.n !== g.id); }); S.gsel = null; renderDetails(); };
    function sel2(k, v, opts) { return `<select data-k="${k}">${opts.map(o => '<option value="' + o + '"' + (v === o ? ' selected' : '') + '>' + o + '</option>').join('')}</select>`; }
  }
  function renderLists() {
    $('#aw-varlist').innerHTML = Object.keys(S.doc.vars).map(k => '<option value="' + esc(k) + '">').join('');
    const names = []; if (S.doc.root) walk(S.doc.root, n => { if (n.name) names.push(n.name); });
    $('#aw-widgetlist').innerHTML = names.map(k => '<option value="' + esc(k) + '">').join('');
    $('#aw-actionlist').innerHTML = listActions().map(k => '<option value="' + esc(k) + '">').join('');
  }

  /* ═══ GRAPH ═══ */
  const gv = $('#aw-graph'), gsvg = $('#aw-wires'), gnodes = $('#aw-gnodes');
  function pinPos(nodeId, pin, out) {
    const el = gnodes.querySelector('[data-gid="' + nodeId + '"]'); if (!el) return null;
    const p = out ? el.querySelector('.aw-pin.out[data-pin="' + CSS.escape(pin) + '"]') : el.querySelector('.aw-pin.in'); if (!p) return null;
    const r = p.getBoundingClientRect(), b = gv.getBoundingClientRect();
    return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
  }
  function renderGraph() {
    renderLists();
    const G = S.doc.graph;
    gnodes.style.transform = 'translate(' + S.pan.x + 'px,' + S.pan.y + 'px)';
    gnodes.innerHTML = G.nodes.map(n => { const T = GRAPH_NODES[n.type]; const summary = Object.keys(T.props || {}).slice(0, 2).map(k => '<div class="f"><b>' + esc(k) + '</b> ' + esc(String(n.props[k] == null ? '' : n.props[k]).slice(0, 40)) + '</div>').join('');
      return `<div class="aw-gnode ${n.id === S.gsel ? 'sel' : ''} ${n.type.startsWith('ev_') ? 'ev' : ''}" data-gid="${n.id}" style="left:${n.x}px;top:${n.y}px"><div class="hd" style="background:${T.color}">${T.ins ? '<span class="aw-pin in" title="in"></span>' : ''}${esc(T.label)}</div><div class="bd">${summary}</div><div class="outs">${T.outs.map(o => '<div class="o">' + esc(o) + '<span class="aw-pin out" data-pin="' + esc(o) + '"></span></div>').join('')}</div></div>`; }).join('');
    drawWires();
    gnodes.querySelectorAll('.aw-gnode').forEach(el => {
      const id = el.dataset.gid; const n = G.nodes.find(x => x.id === id);
      el.querySelector('.hd').onpointerdown = (e) => { if (e.target.classList.contains('aw-pin')) return; e.stopPropagation(); S.gsel = id; S.sel = null; renderDetails(); gnodes.querySelectorAll('.aw-gnode.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); S.drag = { g: id, x0: e.clientX, y0: e.clientY, nx: n.x, ny: n.y }; snapshot(); gv.setPointerCapture(e.pointerId); };
      el.querySelectorAll('.aw-pin.out').forEach(p => p.onpointerdown = (e) => { e.stopPropagation(); S.wire = { from: id, pin: p.dataset.pin }; gv.setPointerCapture(e.pointerId); });
      const ip = el.querySelector('.aw-pin.in'); if (ip) ip.onpointerup = (e) => { if (!S.wire) return; e.stopPropagation(); const w = S.wire; S.wire = null; if (w.from === id) return; commit(() => { G.links = G.links.filter(l => !(l.from.n === w.from && l.from.pin === w.pin)); G.links.push({ from: { n: w.from, pin: w.pin }, to: { n: id } }); }); };
    });
  }
  function drawWires(tempTo) {
    const G = S.doc.graph; let html = '';
    G.links.forEach((l, i) => { const a = pinPos(l.from.n, l.from.pin, true), b = pinPos(l.to.n, null, false); if (!a || !b) return; html += `<path data-link="${i}" d="${curve(a, b)}" class="aw-wire"/>`; });
    if (S.wire && tempTo) { const a = pinPos(S.wire.from, S.wire.pin, true); if (a) html += `<path d="${curve(a, tempTo)}" class="aw-wire temp"/>`; }
    gsvg.innerHTML = html;
    gsvg.querySelectorAll('[data-link]').forEach(p => p.onclick = () => { const i = +p.dataset.link; commit(() => { G.links.splice(i, 1); }); });
  }
  function curve(a, b) { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; }
  gv.addEventListener('pointermove', (e) => {
    if (S.drag && S.drag.g) { const n = S.doc.graph.nodes.find(x => x.id === S.drag.g); if (!n) return; n.x = Math.round(S.drag.nx + e.clientX - S.drag.x0); n.y = Math.round(S.drag.ny + e.clientY - S.drag.y0); const el = gnodes.querySelector('[data-gid="' + n.id + '"]'); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawWires(); setDirty(true); return; }
    if (S.drag && S.drag.pan) { S.pan.x = S.drag.px + e.clientX - S.drag.x0; S.pan.y = S.drag.py + e.clientY - S.drag.y0; gnodes.style.transform = 'translate(' + S.pan.x + 'px,' + S.pan.y + 'px)'; drawWires(); return; }
    if (S.wire) { const b = gv.getBoundingClientRect(); drawWires({ x: e.clientX - b.left, y: e.clientY - b.top }); }
  });
  gv.addEventListener('pointerup', () => { if (S.wire) { S.wire = null; drawWires(); } if (S.drag) S.drag = null; });
  gv.addEventListener('pointerdown', (e) => { if (e.target === gv || e.target === gsvg || e.target === gnodes) { S.drag = { pan: true, x0: e.clientX, y0: e.clientY, px: S.pan.x, py: S.pan.y }; S.gsel = null; renderDetails(); gnodes.querySelectorAll('.aw-gnode.sel').forEach(x => x.classList.remove('sel')); } });
  gv.addEventListener('contextmenu', (e) => { e.preventDefault(); openNodeMenu(e.clientX, e.clientY); });
  $('#aw-gadd').onclick = (e) => openNodeMenu(e.clientX, e.clientY + 10);
  function openNodeMenu(cx, cy) {
    const menu = $('#aw-gmenu'); const cats = {}; Object.keys(GRAPH_NODES).forEach(k => { (cats[GRAPH_NODES[k].cat] = cats[GRAPH_NODES[k].cat] || []).push(k); });
    menu.innerHTML = Object.keys(cats).map(c => '<div class="c">' + esc(c) + '</div>' + cats[c].map(k => '<button data-type="' + k + '"><span class="aw-gdot" style="background:' + GRAPH_NODES[k].color + '"></span>' + esc(GRAPH_NODES[k].label) + '</button>').join('')).join('');
    const b = gv.getBoundingClientRect(); menu.style.left = Math.min(cx - b.left, b.width - 190) + 'px'; menu.style.top = Math.min(cy - b.top, b.height - 300) + 'px'; menu.hidden = false;
    menu.querySelectorAll('button').forEach(btn => btn.onclick = () => { const n = newGraphNode(btn.dataset.type, Math.round(cx - b.left - S.pan.x), Math.round(cy - b.top - S.pan.y)); commit(() => { S.doc.graph.nodes.push(n); }); S.gsel = n.id; renderDetails(); menu.hidden = true; });
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.hidden = true; document.removeEventListener('pointerdown', off, true); } }; setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  /* ═══ THEME ═══ */
  function renderTheme() {
    const box = $('#aw-theme'); const T = S.doc.theme;
    box.innerHTML = `<div class="aw-sec"><h4>CSS variables <small>${Object.keys(T.vars).length}</small></h4>
      <div class="aw-hint">Restyle the game without touching a screen: override any <code>--variable</code> the game's stylesheets use, or add rules below. Applied live while you edit; every player gets it once the theme is ★ Live.</div>
      <div class="aw-btns" style="margin:6px 0"><button id="aw-th-scan">🔍 Read the game's variables</button><button id="aw-th-add">＋ Variable</button></div>
      <div id="aw-th-vars">${Object.keys(T.vars).map(k => `<div class="aw-var"><input type="text" data-k="${esc(k)}" data-f="name" value="${esc(k)}"><input type="text" data-k="${esc(k)}" data-f="val" value="${esc(T.vars[k])}"><span class="sw" style="background:${esc(T.vars[k])}"></span><button data-k="${esc(k)}" data-f="del">✕</button></div>`).join('')}</div></div>
      <div class="aw-sec"><h4>Rules <small>plain CSS</small></h4><textarea id="aw-th-css" rows="14" spellcheck="false" placeholder=".farm-top h1 { color: #ffd23f }\n.btn-secondary { border-radius: 12px }">${esc(T.css)}</textarea></div>`;
    box.querySelectorAll('[data-f="val"], [data-f="name"]').forEach(el => el.onchange = () => commit(() => { const k = el.dataset.k; if (el.dataset.f === 'name') { const nk = String(el.value).trim(); if (/^--[A-Za-z0-9_-]{1,60}$/.test(nk) && nk !== k) { T.vars[nk] = T.vars[k]; delete T.vars[k]; } } else T.vars[k] = el.value; applyThemePreview(); }));
    box.querySelectorAll('[data-f="del"]').forEach(el => el.onclick = () => commit(() => { delete T.vars[el.dataset.k]; applyThemePreview(); }));
    $('#aw-th-css').onchange = (e) => commit(() => { T.css = e.target.value; applyThemePreview(); });
    $('#aw-th-css').onkeydown = (e) => e.stopPropagation();
    $('#aw-th-add').onclick = () => { const k = window.prompt('Variable name (e.g. --gold):', '--'); if (!k || !/^--[A-Za-z0-9_-]{1,60}$/.test(k.trim())) return; commit(() => { T.vars[k.trim()] = getComputedStyle(document.documentElement).getPropertyValue(k.trim()).trim() || '#ffffff'; applyThemePreview(); }); };
    $('#aw-th-scan').onclick = () => {
      const found = {};
      try { Array.from(document.styleSheets).forEach(sh => { let rules; try { rules = sh.cssRules; } catch (e) { return; } Array.from(rules || []).forEach(r => { if (r.selectorText && /:root|^html$|^body$/.test(r.selectorText) && r.style) { for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (p.startsWith('--') && !found[p]) found[p] = r.style.getPropertyValue(p).trim(); } } }); }); } catch (e) {}
      const keys = Object.keys(found).filter(k => !T.vars[k]).slice(0, 120);
      if (!keys.length) { toast('No new :root variables found in the loaded stylesheets.'); return; }
      commit(() => { keys.forEach(k => { T.vars[k] = found[k]; }); applyThemePreview(); }); toast('Read ' + keys.length + ' variables — change any of them.');
    };
  }
  function applyThemePreview() {
    if (S.themeStyle) { S.themeStyle.remove(); S.themeStyle = null; }
    if (S.doc.kind !== 'theme') return;
    const st = document.createElement('style'); st.id = 'aw-theme-preview'; st.textContent = themeCss(S.doc); document.head.appendChild(st); S.themeStyle = st;
  }

  /* ═══ TARGET ═══ */
  function renderTarget() {
    const t = S.doc.target; const box = $('#aw-target');
    const slots = knownSlots();
    box.innerHTML = `${field('show in', sel('t:mode', t.mode, ['none', 'slot', 'selector']), 'none = only on demand · slot = a named area the game exposes · selector = any element of the game UI')}
      ${t.mode === 'slot' ? field('slot', `<input type="text" data-id="t:slot" list="aw-slotlist" value="${esc(t.slot)}" placeholder="farm.hud">`) + '<datalist id="aw-slotlist">' + slots.map(s => '<option value="' + esc(s) + '">').join('') + '</datalist><div class="aw-hint">Known slots: ' + slots.map(esc).join(', ') + '</div>' : ''}
      ${t.mode === 'selector' ? field('selector', `<input type="text" data-id="t:selector" value="${esc(t.selector)}" placeholder="#some-id or .a-class">`) + field('place', sel('t:place', t.place, ['append', 'prepend', 'before', 'after', 'replace', 'contents']), 'replace hides the element and shows the widget instead; contents keeps the element but swaps what is inside it') + '<div class="aw-btns"><button id="aw-pick">🎯 Pick an element in the game</button></div>' : ''}
      ${S.doc.kind === 'theme' ? '<div class="aw-hint">A theme applies to the whole game — no target needed.</div>' : ''}`;
    box.querySelectorAll('[data-id]').forEach(el => el.onchange = () => commit(() => { t[el.dataset.id.split(':')[1]] = el.value; }));
    const pk = $('#aw-pick'); if (pk) pk.onclick = pickElement;
  }
  function pickElement() {
    root.style.display = 'none';
    const layer = document.createElement('div'); layer.id = 'aw-picklayer'; layer.innerHTML = '<div class="msg">Click any element to target it · <b>Esc</b> cancels</div>'; document.body.appendChild(layer);
    let hl = null, cur = null;
    const move = (e) => { layer.style.pointerEvents = 'none'; const el = document.elementFromPoint(e.clientX, e.clientY); layer.style.pointerEvents = ''; if (!el || el === cur || layer.contains(el)) return; cur = el; if (hl) hl.classList.remove('aw-pick-hl'); hl = el; el.classList.add('aw-pick-hl'); layer.querySelector('.msg').textContent = selectorFor(el); };
    const done = (sel) => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); if (hl) hl.classList.remove('aw-pick-hl'); layer.remove(); root.style.display = ''; if (sel) { commit(() => { S.doc.target.mode = 'selector'; S.doc.target.selector = sel; }); toast('Target: ' + sel, 3200); } };
    const click = (e) => { e.preventDefault(); e.stopPropagation(); done(cur ? selectorFor(cur) : null); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    document.addEventListener('mousemove', move, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  }
  function selectorFor(el) {
    if (el.id && !/\d{4,}/.test(el.id)) return '#' + CSS.escape(el.id);
    const parts = []; let cur = el, hops = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && hops++ < 5) {
      let s = cur.tagName.toLowerCase();
      if (cur.id && !/\d{4,}/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const cls = Array.from(cur.classList).filter(c => !/^(is-|on$|active|hover|aw-)/.test(c)).slice(0, 2); if (cls.length) s += '.' + cls.map(c => CSS.escape(c)).join('.');
      const attr = ['data-farm', 'data-act', 'data-fact', 'data-id', 'data-screen'].find(a => cur.hasAttribute(a)); if (attr) s += '[' + attr + '="' + cur.getAttribute(attr).replace(/"/g, '\\"') + '"]';
      else if (!cls.length) { const sib = Array.from(cur.parentNode ? cur.parentNode.children : []).filter(x => x.tagName === cur.tagName); if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(cur) + 1) + ')'; }
      parts.unshift(s); cur = cur.parentNode;
    }
    return parts.join(' > ');
  }

  /* ═══ PREVIEW ═══ */
  function startPreview() {
    stopPreview(); if (S.doc.kind === 'theme') { toast('Themes preview live as you edit.'); return; }
    const win = $('#aw-preview'); win.hidden = false; const host = win.querySelector('.body'); host.innerHTML = '';
    S.preview = mount(host, clone(S.doc), {}); $('#aw-run').classList.add('on');
  }
  function stopPreview() { if (S.preview) { S.preview.destroy(); S.preview = null; } const win = $('#aw-preview'); if (win) win.hidden = true; const b = $('#aw-run'); if (b) b.classList.remove('on'); }
  $('#aw-run').onclick = () => S.preview ? stopPreview() : startPreview();
  $('#aw-preview .x').onclick = stopPreview;

  /* ═══ LIBRARY / SAVE ═══ */
  async function renderLibrary() {
    const box = $('#aw-lib'); box.innerHTML = '<div class="aw-empty">Loading…</div>';
    const r = await api.listAll(); if (!ED) return;
    $('#aw-storage').textContent = r.cloudOk ? '☁ Cloud on · ' + api.displayName() : r.offline ? '💾 Not signed in — saving on this device' : r.cloudMissing ? '💾 Cloud table not set up (run sql/040_ui_widgets.sql)' : '⚠ ' + (r.error || 'cloud unavailable');
    box.innerHTML = r.rows.length ? r.rows.map(row => `<div class="aw-lrow ${row.id === S.doc.id ? 'cur' : ''}" data-id="${esc(row.id)}" data-src="${row.source}"><div class="t"><span>${row.kind === 'theme' ? '🎨' : '🧩'}</span><span class="lb">${esc(row.name)}</span>${row.live ? '<span class="tag live">LIVE</span>' : ''}<span class="tag">${row.source}</span>${!row.mine ? '<span class="tag">by ' + esc(row.owner_name || '?') + '</span>' : ''}</div><div class="m">${row.target && row.target.mode && row.target.mode !== 'none' ? esc(row.target.mode + ': ' + (row.target.slot || row.target.selector || '')) : (row.kind === 'theme' ? 'theme' : 'no target')}</div><div class="acts"><button data-act="open">Open</button>${row.mine ? (row.live ? '<button data-act="unlive">Unset live</button>' : '<button data-act="live">★ Set live</button>') + '<button data-act="del" class="danger">Delete</button>' : ''}</div></div>`).join('') : '<div class="aw-empty">Nothing saved yet.</div>';
    box.querySelectorAll('.aw-lrow').forEach(el => {
      const id = el.dataset.id, src = el.dataset.src;
      el.querySelector('[data-act="open"]').onclick = async () => { if (S.dirty && !(await confirmDlg('Discard unsaved changes?'))) return; const rr = await api.load(id, src); if (!rr.ok) { toast('Could not open: ' + rr.error, 3600); return; } S.mine = rr.mine !== false; loadDoc(rr.doc, src); api.clearDraft(); renderLibrary(); };
      const lv = el.querySelector('[data-act="live"], [data-act="unlive"]'); if (lv) lv.onclick = async () => { const on = lv.dataset.act === 'live'; if (on && src === 'cloud' && !api.isAdmin()) { toast('Only an admin can set a widget live for every player. Local live previews on this device only.', 4200); } const s = await api.setLive(id, src, on); toast(s.ok ? (on ? '★ Live — every player' + (src === 'local' ? ' on this device' : '') + ' gets it now.' : 'No longer live.') : 'Failed: ' + (s.error || 'unknown'), 3800); if (s.ok) { notify(); } renderLibrary(); };
      const del = el.querySelector('[data-act="del"]'); if (del) del.onclick = async () => { if (!(await confirmDlg('Delete this document permanently?'))) return; const d = await api.remove(id, src); toast(d.ok ? 'Deleted.' : 'Delete failed: ' + d.error); if (d.ok && id === S.doc.id) { S.source = null; setDirty(true); } notify(); renderLibrary(); };
    });
  }
  function notify() { try { window.dispatchEvent(new CustomEvent('athena-ui:changed', { detail: { id: S.doc.id } })); } catch (e) {} }
  async function save(forceSource) {
    if (!S.mine && S.source === 'cloud') { S.doc.id = uid('wg_'); S.doc.name = (S.doc.name + ' (copy)').slice(0, 80); S.mine = true; $('.aw-top .name input').value = S.doc.name; }
    S.doc.name = ($('.aw-top .name input').value || 'Untitled widget').trim().slice(0, 80);
    const source = forceSource || S.source || (signedIn() ? 'cloud' : 'local');
    const r = await api.save(S.doc, source);
    if (!r.ok) { toast('Save failed: ' + (r.error || 'unknown'), 5000); return false; }
    S.source = r.source; setDirty(false); api.clearDraft(); notify();
    toast(r.fellBack ? (r.missing ? 'Cloud widgets are not set up yet (run sql/040) — saved on this device.' : r.offline ? 'Not signed in — saved on this device.' : 'Cloud save failed (' + r.error + ') — saved on this device.') : (r.source === 'cloud' ? '☁ Saved to the cloud.' : '💾 Saved on this device.'), r.fellBack ? 5200 : 2600);
    renderLibrary(); return true;
  }
  async function newDoc(kind) { if (S.dirty && !(await confirmDlg('Discard unsaved changes and start a new ' + (kind === 'theme' ? 'theme' : 'widget') + '?'))) return; loadDoc(newWidget({ author: api.displayName(), kind }), null); S.mine = true; api.clearDraft(); renderLibrary(); }
  function exportJson() { const d = serialize(S.doc); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (d.name || 'widget').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.widget.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function importJson(file) { const rd = new FileReader(); rd.onload = () => { try { const d = normalize(JSON.parse(rd.result)); d.id = uid('wg_'); d.name = (d.name + ' (imported)').slice(0, 80); loadDoc(d, null); setDirty(true); toast('Imported — save to keep it.'); } catch (e) { toast('That file is not an Athena widget.', 3000); } }; rd.readAsText(file); }
  async function close(force) {
    if (!ED) return;
    if (!force && S.dirty && !(await confirmDlg('You have unsaved changes. Close anyway? (A draft is kept on this device.)'))) return;
    if (S.dirty) api.saveDraft(S.doc);
    stopPreview(); if (S.themeStyle) S.themeStyle.remove();
    window.removeEventListener('keydown', onKey, true);
    root.remove(); document.body.style.overflow = prevOverflow; ED = null;
    reloadLive();
    try { if (opts.onClose) opts.onClose(); } catch (e) {}
  }

  /* ═══ WIRING ═══ */
  $('#aw-palette').innerHTML = Object.keys(WIDGET_TYPES).map(k => `<button data-type="${k}" title="${esc(WIDGET_TYPES[k].help || WIDGET_TYPES[k].label)}"><span class="ic">${WIDGET_TYPES[k].icon}</span>${esc(WIDGET_TYPES[k].label)}</button>`).join('');
  $$('#aw-palette button').forEach(b => b.onclick = () => addWidget(b.dataset.type));
  $$('.aw-views button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#aw-frame-w').onchange = renderStage;
  $('.aw-top .name input').onchange = (e) => { S.doc.name = e.target.value.trim().slice(0, 80) || 'Untitled widget'; setDirty(true); };
  $('#aw-save').onclick = () => save(); $('#aw-save-local').onclick = () => save('local');
  $('#aw-new').onclick = () => newDoc('widget'); $('#aw-new-theme').onclick = () => newDoc('theme');
  $('#aw-export').onclick = exportJson; $('#aw-import').onclick = () => $('#aw-file').click(); $('#aw-file').onchange = (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; };
  $('#aw-undo').onclick = undo; $('#aw-redo').onclick = redo;
  $('#aw-close').onclick = () => close(false);
  $('#aw-help-btn').onclick = () => $('.aw-help').classList.toggle('on');
  $('.aw-help').onclick = (e) => { if (e.target === e.currentTarget || e.target.dataset.close) $('.aw-help').classList.remove('on'); };
  $('#aw-data-btn').onclick = () => { const d = $('#aw-data'); d.hidden = !d.hidden; if (!d.hidden) { let j = ''; try { j = JSON.stringify(sampleData(), (k, v) => typeof v === 'function' ? undefined : v, 1); } catch (e) { j = '{}'; } d.querySelector('pre').textContent = 'DATA (bind with {path}):\n' + j.slice(0, 20000) + '\n\nACTIONS (Call game action):\n' + listActions().join('\n'); } };
  function onKey(e) {
    if (!ED) return; const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (e.key === 'Escape') { if ($('.aw-help').classList.contains('on')) { $('.aw-help').classList.remove('on'); return; } if (typing) { t.blur(); return; } }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && S.sel) { e.preventDefault(); duplicateNode(S.sel); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.gsel) { const g = S.doc.graph.nodes.find(n => n.id === S.gsel); if (g) { commit(() => { S.doc.graph.nodes = S.doc.graph.nodes.filter(n => n.id !== g.id); S.doc.graph.links = S.doc.graph.links.filter(l => l.from.n !== g.id && l.to.n !== g.id); }); S.gsel = null; renderDetails(); } } else if (S.sel && S.view === 'designer') removeNode(S.sel); e.preventDefault(); }
    if (e.key === 'h' || e.key === 'H') $('.aw-help').classList.toggle('on');
  }
  window.addEventListener('keydown', onKey, true);

  loadDoc(doc, S.source); renderLibrary();
  return ED;
}
export function closeDesigner() { if (ED) ED.close(); }

function ensureCss() { if (document.getElementById('aw-css')) return; const l = document.createElement('link'); l.id = 'aw-css'; l.rel = 'stylesheet'; l.href = new URL('./widgets.css', import.meta.url).href; document.head.appendChild(l); }

const TEMPLATE = `
<div class="aw-top">
  <span class="brand">🧩 Athena Widgets</span>
  <span class="name"><input type="text" maxlength="80" placeholder="Widget name"></span>
  <span class="kind" id="aw-kind">🧩 Widget</span>
  <span class="state">New document</span>
  <span class="spacer"></span>
  <span class="aw-views"><button data-view="designer">Designer</button><button data-view="graph">Graph</button><button data-view="theme">Theme</button></span>
  <span class="grp"><button id="aw-undo" title="Undo (Ctrl+Z)">↶</button><button id="aw-redo" title="Redo (Ctrl+Y)">↷</button></span>
  <span class="grp"><button id="aw-run" title="Run the widget with live game data">▶ Preview</button><button id="aw-data-btn" title="What you can bind to">{ } Data</button></span>
  <span class="grp"><button id="aw-save" class="primary" title="Save (Ctrl+S)">💾 Save</button><button id="aw-save-local" title="Save on this device only">⇩ Device</button><button id="aw-export">⤓ Export</button><button id="aw-import">⤒ Import</button><input type="file" id="aw-file" accept=".json,application/json" hidden></span>
  <span class="grp"><button id="aw-help-btn" title="Help (H)">?</button><button id="aw-close" class="danger" title="Close">✕</button></span>
</div>
<div class="aw-left">
  <div class="aw-sec"><h3>Palette</h3><div class="aw-palette" id="aw-palette"></div><p class="aw-hint">Adds into the selected container (or next to the selected widget).</p></div>
  <div class="aw-sec"><h3>Hierarchy</h3><div class="aw-tree" id="aw-tree"></div><p class="aw-hint">Drag a row onto a container to move it there.</p></div>
  <div class="aw-sec"><h3>Variables</h3><div id="aw-vars"></div><div class="aw-btns" style="margin-top:6px"><input type="text" id="aw-var-name" placeholder="name" maxlength="40"><button id="aw-var-add">＋</button></div></div>
  <div class="aw-sec"><h3>Library</h3><div class="aw-btns" style="margin-bottom:6px"><button id="aw-new">✦ New widget</button><button id="aw-new-theme">🎨 New theme</button></div><p class="aw-hint" id="aw-storage"></p><div id="aw-lib"></div></div>
</div>
<div class="aw-center">
  <div class="aw-view on" data-view="designer">
    <div class="aw-stagebar"><label>Frame width</label><select id="aw-frame-w"><option value="320">320 phone</option><option value="420" selected>420</option><option value="640">640</option><option value="900">900</option><option value="1200">1200 desktop</option></select><span class="aw-hint" style="margin:0">Click to select · drag inside a Canvas panel · corner handle resizes · Del removes</span></div>
    <div class="aw-stage" id="aw-stage"></div>
  </div>
  <div class="aw-view" data-view="graph">
    <div class="aw-stagebar"><button id="aw-gadd">＋ Node</button><span class="aw-hint" style="margin:0">Right-click for nodes · drag a header to move · drag from an out-pin ● to an in-pin to wire · click a wire to cut it · Del removes the node</span></div>
    <div class="aw-graph" id="aw-graph"><svg id="aw-wires"></svg><div id="aw-gnodes"></div><div id="aw-gmenu" class="aw-gmenu" hidden></div></div>
  </div>
  <div class="aw-view" data-view="theme"><div class="aw-themebox" id="aw-theme"></div></div>
  <div class="aw-toast"></div>
  <div class="aw-previewwin" id="aw-preview" hidden><div class="hd">▶ Preview — live data, events run<button class="x">✕</button></div><div class="body"></div></div>
  <div class="aw-data" id="aw-data" hidden><pre></pre></div>
  <div class="aw-help"><div class="box">
    <h2>Athena Widgets — how it works</h2>
    <table>
      <tr><td>Designer</td><td>Build the tree from the Palette. <b>Canvas panel</b> children are free-placed (drag, resize); boxes stack. Every property can hold a <b>binding</b>: <code>{gems|num}</code>, <code>{farm.animals}</code>, <code>{$myVar}</code>. The <b>{ } Data</b> button lists everything you can bind to.</td></tr>
      <tr><td>Graph</td><td>Blueprint-style: an <b>event</b> node (On Construct, On Click, On Tick, On Change) starts a chain of <b>actions</b> (Toast, Set variable, Branch, Delay, Call game action, Set property, Set visible, Go to screen) joined by execution wires. Name a button, then add its On Click from the Details panel.</td></tr>
      <tr><td>Target</td><td>Where it shows in the game: a <b>slot</b> the game exposes (<code>farm.hud</code>, <code>game.overlay</code>, …) or any element by <b>selector</b> — use 🎯 <b>Pick</b> to click one in the real UI. <i>replace</i> swaps that element for your widget; <i>contents</i> keeps the element and replaces what is inside it.</td></tr>
      <tr><td>Theme</td><td>A theme document restyles the whole game: override CSS variables (🔍 reads the game's own) and add rules. Previewed live while editing.</td></tr>
      <tr><td>Live</td><td>Save, then ★ <b>Set live</b> in the Library. A live cloud document applies to every player (admin only — the server refuses otherwise); a live device document applies on this device only, for trying things.</td></tr>
      <tr><td>Keys</td><td><kbd>Ctrl+S</kbd> save · <kbd>Ctrl+Z</kbd>/<kbd>Y</kbd> undo/redo · <kbd>Ctrl+D</kbd> duplicate · <kbd>Del</kbd> remove · <kbd>H</kbd> this help</td></tr>
    </table>
    <div style="text-align:right;margin-top:10px"><button data-close="1" class="primary">Got it</button></div>
  </div></div>
</div>
<div class="aw-right">
  <div class="aw-sec"><h3>Target</h3><div id="aw-target"></div></div>
  <div class="aw-sec"><h3>Details</h3><div id="aw-details"></div></div>
  <datalist id="aw-varlist"></datalist><datalist id="aw-widgetlist"></datalist><datalist id="aw-actionlist"></datalist>
</div>`;
