/* ============================================================================
   📊 THE DEMAND PANEL — BAR.md reference frame 4, built in node-city's chrome.
   ============================================================================
   Four arrow-shaped meters, a signed causal list beside each, and a detail pane
   that explains the selected one in plain prose. The model is demand.js; this
   file owns nothing but markup and clicks.

   ⚠ THE PANEL OWNS ITS OWN DOM, like /src/outside's chip and /src/power's
     panel. There is no markup for it in node-city/index.html, so a 404 on this
     module costs the player this panel and nothing else.
   ⚠ NOT aria-modal, and the backdrop closes it. Same call the dossier makes and
     for the same reason: this is a readout you glance at while playing, not a
     mode you enter.
   ============================================================================ */
import { read, CAT_ORDER } from './demand.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pc = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';

let _sel = 'res';
let _open = false;
let _last = null;

export const isOpen = () => _open;

function box() {
  let el = document.getElementById('ncdm');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'ncdm';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Zone demand');
  el.innerHTML = '<div class="ncdm-box">'
    + '<div class="ncdm-hd"><span class="hico">📊</span><h2>Zone Demand</h2>'
    + '<button type="button" class="ncdm-x" id="ncdm-x">✕ Close</button></div>'
    + '<div class="ncdm-body"><div class="ncdm-list" id="ncdm-list"></div>'
    + '<div class="ncdm-detail" id="ncdm-detail"></div></div>'
    + '<div class="ncdm-foot" id="ncdm-foot"></div>'
    + '</div>';
  document.body.appendChild(el);
  el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
  el.querySelector('#ncdm-x').addEventListener('click', close);
  el.querySelector('#ncdm-list').addEventListener('click', (ev) => {
    const row = ev.target.closest && ev.target.closest('.ncdm-row');
    if (!row) return;
    _sel = row.dataset.cat;
    render(true);
  });
  /* ⌨ Capture phase and stopPropagation, exactly as the rail dock's Escape
     handler does: three other Escape listeners are already on window in this
     game and without capture the keypress would also cancel whatever the player
     was placing. */
  addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !_open) return;
    ev.stopPropagation(); ev.preventDefault(); close();
  }, true);
  return el;
}

function causeHtml(c) {
  const up = c.sign === '+';
  return '<div class="dcause ' + (up ? 'up' : 'dn') + '"><span class="sgn">' + (up ? '+' : '−') + '</span>'
    + '<span class="lbl">' + esc(c.label) + '</span></div>';
}

function rowHtml(d) {
  const has = d.value != null;
  const sel = d.id === _sel;
  return '<button type="button" class="ncdm-row' + (sel ? ' sel' : '') + '" data-cat=' + '"' + d.id + '"'
    + ' aria-pressed="' + (sel ? 'true' : 'false') + '">'
    + '<div class="rhd">'
    + '<span class="rname">' + esc(d.ico + ' ' + d.name) + '</span>'
    + '<span class="dmeter' + (has ? '' : ' none') + '" style="color:' + esc(d.col) + '"'
    + ' role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (has ? Math.round(d.value * 100) : 0) + '">'
    + '<i style="width:' + (has ? pc(d.value) : '0%') + '"></i></span>'
    + '<span class="rval" style="color:' + esc(d.col) + '">' + (has ? pc(d.value) : '—') + '</span>'
    + '</div>'
    + (has
        ? (d.causes.length
            ? d.causes.map(causeHtml).join('')
            : '<div class="rnomodel">Nothing is pushing this either way right now.</div>')
        : '<div class="rnomodel">Not modelled yet. ' + esc(d.note) + '</div>')
    + (d.limit ? '<div class="rlimit">⛔ What is holding it back: ' + esc(d.limit) + '</div>' : '')
    + '</button>';
}

function detailHtml(d) {
  if (!d) return '';
  const stat = (d.stat || []).length
    ? '<div class="dstat">' + d.stat.map((s) => '<span><b>' + esc(s.v) + '</b><em>' + esc(s.k) + '</em></span>').join('') + '</div>'
    : '';
  const why = (d.causes || []).length
    ? '<div class="dwhy">' + d.causes.map((c) => {
        const up = c.sign === '+';
        return '<div class="drow"><div class="dtop ' + (up ? 'up' : 'dn') + '">'
          + '<span class="sgn">' + (up ? '+' : '−') + '</span><span>' + esc(c.label) + '</span></div>'
          + '<div class="dtxt">' + esc(c.why) + '</div>'
          + '<div class="dsrc">read from ' + esc(c.src) + '</div></div>';
      }).join('') + '</div>'
    : '';
  return '<h3>' + esc(d.ico + ' ' + d.name) + '</h3>'
    + '<p>' + esc(d.note) + '</p>'
    + stat + why;
}

export function render(force) {
  if (!_open && !force) return;
  const el = box();
  let rows = [];
  try { rows = read(); } catch (e) { rows = []; }
  if (!rows.length) return;
  _last = rows;
  const list = el.querySelector('#ncdm-list');
  const html = rows.map(rowHtml).join('');
  if (list.__h !== html) { list.__h = html; list.innerHTML = html; }
  const d = rows.find((r) => r.id === _sel) || rows[0];
  const det = el.querySelector('#ncdm-detail');
  const dh = detailHtml(d);
  if (det.__h !== dh) { det.__h = dh; det.innerHTML = dh; }
  const foot = el.querySelector('#ncdm-foot');
  const fh = 'Every line above is read from a live model and names the call it came from. '
    + 'Nothing here is invented: where a cause the reference panel lists has no model behind it in this game — taxes, land value, fuel retail — it is left out rather than filled in.';
  if (foot.__h !== fh) { foot.__h = fh; foot.innerHTML = fh; }
}

/** The compact reading the status bar prints. Same call, same numbers. */
export function strip() {
  try { return read(); } catch (e) { return []; }
}

export function open() {
  const el = box();
  /* 🪟 ONE DIALOG AT A TIME — the same housekeeping rule the rail dock keeps,
     and for the same reason: #railmodal and this panel both sit at z-index 42,
     so without it the two would stack on top of each other with one backdrop
     over the other. The rail's own API is the authority on closing it; nothing
     here reaches into its state. The dossier is the other body-level panel and
     it is NOT aria-modal, so it has to be closed explicitly too. */
  try { if (window.__ncRail) window.__ncRail.close(); } catch (e) {}
  try {
    const ins = document.getElementById('inspect');
    if (ins && ins.classList.contains('open') && window.__nc) window.__nc.closeInspect();
  } catch (e) {}
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  _open = true;
  render(true);
  try { el.querySelector('#ncdm-x').focus({ preventScroll: true }); } catch (e) {}
  return true;
}
export function close() {
  const el = document.getElementById('ncdm');
  if (el) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); }
  _open = false;
  return false;
}
export function toggle() { return _open ? close() : open(); }
export function select(cat) { if (CAT_ORDER.indexOf(cat) >= 0) { _sel = cat; render(true); } return _sel; }
export function last() { return _last; }

export default { open, close, toggle, render, isOpen, select, strip, last };
