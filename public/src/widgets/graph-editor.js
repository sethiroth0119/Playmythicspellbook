/* graph-editor.js — a reusable Blueprint-style node editor (DOM + SVG wires).

   createGraphEditor(container, { catalog, get: () => graph, onChange, onSelect, newNode })
     graph = { nodes: [{ id, type, x, y, props }], links: [{ from: { n, pin }, to: { n } }] }
     catalog = { type: { cat, label, color, ins?, outs: [], props?, help? } }
   Exec pins only: one in-pin on the left, named out-pins on the right. Drag a
   header to move, drag from an out-pin to an in-pin to wire (one wire per
   out-pin — dropping a new one replaces it), click a wire to cut it,
   right-click (or the ＋ button the host provides) for the node menu.
   The host owns undo: it is told through onChange() after every edit.
   Used by Athena's actor blueprints; the widget designer has an older inline
   copy of the same code (kept as is — it is tested — until it is migrated). */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createGraphEditor(container, opts) {
  const catalog = opts.catalog;
  container.classList.add('aw-graph');
  container.innerHTML = '<svg class="aw-wires"></svg><div class="aw-gnodes"></div><div class="aw-gmenu" hidden></div>';
  const svg = container.querySelector('.aw-wires'), nodesEl = container.querySelector('.aw-gnodes'), menu = container.querySelector('.aw-gmenu');
  const st = { sel: null, drag: null, wire: null, pan: { x: 0, y: 0 } };
  const G = () => opts.get();
  const changed = () => { if (opts.onChange) opts.onChange(); };
  function pinPos(nodeId, pin, out) {
    const el = nodesEl.querySelector('[data-gid="' + nodeId + '"]'); if (!el) return null;
    const p = out ? el.querySelector('.aw-pin.out[data-pin="' + CSS.escape(pin) + '"]') : el.querySelector('.aw-pin.in'); if (!p) return null;
    const r = p.getBoundingClientRect(), b = container.getBoundingClientRect();
    return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
  }
  const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5); return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' + (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y; };
  function drawWires(tempTo) {
    const g = G(); let html = '';
    g.links.forEach((l, i) => { const a = pinPos(l.from.n, l.from.pin, true), b = pinPos(l.to.n, null, false); if (a && b) html += '<path data-link="' + i + '" d="' + curve(a, b) + '" class="aw-wire"/>'; });
    if (st.wire && tempTo) { const a = pinPos(st.wire.from, st.wire.pin, true); if (a) html += '<path d="' + curve(a, tempTo) + '" class="aw-wire temp"/>'; }
    svg.innerHTML = html;
    svg.querySelectorAll('[data-link]').forEach(p => p.onclick = () => { G().links.splice(+p.dataset.link, 1); changed(); render(); });
  }
  function render() {
    const g = G();
    nodesEl.style.transform = 'translate(' + st.pan.x + 'px,' + st.pan.y + 'px)';
    nodesEl.innerHTML = g.nodes.map(n => { const T = catalog[n.type]; if (!T) return ''; const summary = Object.keys(T.props || {}).slice(0, 2).map(k => '<div class="f"><b>' + esc(k) + '</b> ' + esc(String(n.props[k] == null ? '' : n.props[k]).slice(0, 40)) + '</div>').join('');
      return '<div class="aw-gnode ' + (n.id === st.sel ? 'sel' : '') + ' ' + (n.type.startsWith('ev_') ? 'ev' : '') + '" data-gid="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px"><div class="hd" style="background:' + T.color + '">' + (T.ins ? '<span class="aw-pin in"></span>' : '') + esc(T.label) + '</div><div class="bd">' + summary + '</div><div class="outs">' + T.outs.map(o => '<div class="o">' + esc(o) + '<span class="aw-pin out" data-pin="' + esc(o) + '"></span></div>').join('') + '</div></div>'; }).join('');
    drawWires();
    nodesEl.querySelectorAll('.aw-gnode').forEach(el => {
      const id = el.dataset.gid; const n = g.nodes.find(x => x.id === id);
      el.querySelector('.hd').onpointerdown = (e) => { if (e.target.classList.contains('aw-pin')) return; e.stopPropagation(); select(id); st.drag = { g: id, x0: e.clientX, y0: e.clientY, nx: n.x, ny: n.y }; container.setPointerCapture(e.pointerId); };
      el.querySelectorAll('.aw-pin.out').forEach(p => p.onpointerdown = (e) => { e.stopPropagation(); st.wire = { from: id, pin: p.dataset.pin }; container.setPointerCapture(e.pointerId); });
      const ip = el.querySelector('.aw-pin.in'); if (ip) ip.onpointerup = (e) => { if (!st.wire) return; e.stopPropagation(); const w = st.wire; st.wire = null; if (w.from === id) { drawWires(); return; } const gg = G(); gg.links = gg.links.filter(l => !(l.from.n === w.from && l.from.pin === w.pin)); gg.links.push({ from: { n: w.from, pin: w.pin }, to: { n: id } }); changed(); render(); };
    });
  }
  function select(id) { st.sel = id; nodesEl.querySelectorAll('.aw-gnode').forEach(x => x.classList.toggle('sel', x.dataset.gid === id)); if (opts.onSelect) opts.onSelect(id ? G().nodes.find(n => n.id === id) : null); }
  container.addEventListener('pointermove', (e) => {
    if (st.drag && st.drag.g) { const n = G().nodes.find(x => x.id === st.drag.g); if (!n) return; n.x = Math.round(st.drag.nx + e.clientX - st.drag.x0); n.y = Math.round(st.drag.ny + e.clientY - st.drag.y0); const el = nodesEl.querySelector('[data-gid="' + n.id + '"]'); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } drawWires(); st.drag.moved = true; return; }
    if (st.drag && st.drag.pan) { st.pan.x = st.drag.px + e.clientX - st.drag.x0; st.pan.y = st.drag.py + e.clientY - st.drag.y0; nodesEl.style.transform = 'translate(' + st.pan.x + 'px,' + st.pan.y + 'px)'; drawWires(); return; }
    if (st.wire) { const b = container.getBoundingClientRect(); drawWires({ x: e.clientX - b.left, y: e.clientY - b.top }); }
  });
  container.addEventListener('pointerup', () => { if (st.wire) { st.wire = null; drawWires(); } if (st.drag) { if (st.drag.g && st.drag.moved) changed(); st.drag = null; } });
  container.addEventListener('pointerdown', (e) => { if (e.target === container || e.target === svg || e.target === nodesEl) { st.drag = { pan: true, x0: e.clientX, y0: e.clientY, px: st.pan.x, py: st.pan.y }; select(null); } });
  container.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY); });
  function openMenu(cx, cy) {
    const cats = {}; Object.keys(catalog).forEach(k => { (cats[catalog[k].cat] = cats[catalog[k].cat] || []).push(k); });
    menu.innerHTML = Object.keys(cats).map(c => '<div class="c">' + esc(c) + '</div>' + cats[c].map(k => '<button data-type="' + k + '" title="' + esc(catalog[k].help || '') + '"><span class="aw-gdot" style="background:' + catalog[k].color + '"></span>' + esc(catalog[k].label) + '</button>').join('')).join('');
    const b = container.getBoundingClientRect(); menu.style.left = Math.max(0, Math.min(cx - b.left, b.width - 190)) + 'px'; menu.style.top = Math.max(0, Math.min(cy - b.top, b.height - 300)) + 'px'; menu.hidden = false;
    menu.querySelectorAll('button').forEach(btn => btn.onclick = () => { const n = opts.newNode(btn.dataset.type, Math.round(cx - b.left - st.pan.x), Math.round(cy - b.top - st.pan.y)); G().nodes.push(n); changed(); menu.hidden = true; render(); select(n.id); });
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.hidden = true; document.removeEventListener('pointerdown', off, true); } }; setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  return {
    render, select, openMenu, get selected() { return st.sel; },
    deleteSelected() { if (!st.sel) return false; const g = G(); g.nodes = g.nodes.filter(n => n.id !== st.sel); g.links = g.links.filter(l => l.from.n !== st.sel && l.to.n !== st.sel); st.sel = null; changed(); render(); if (opts.onSelect) opts.onSelect(null); return true; },
    destroy() { container.innerHTML = ''; container.classList.remove('aw-graph'); },
  };
}
