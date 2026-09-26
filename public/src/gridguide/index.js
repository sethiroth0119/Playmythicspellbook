/* ════════════════════════════════════════════════════════════════════════════
   📖 GRID GUIDE — module entry point. Registers window.MythicGridGuide.
   ----------------------------------------------------------------------------
   "How Nodes Pay": the player-facing explainer for owning a node, hiring a
   Grid Manager (the game's Mayor Hall "mayor"), how a city's Cinder is split,
   and every way the game lets you earn. Opened from the City Nodes header.

   EVERYONE reads it. Only ADMINS edit it: text in place, photos, new blocks,
   new sections. A save is a new row in grid_guide_versions (sql/132); the
   newest row is the guide. Until the first save (or offline, or before sql/132
   is applied) players see DEFAULT_DOC from gridguide.content.js.

   Lives OUTSIDE index.html (CLAUDE.md). index.html contributes only the
   header button and the <script type="module"> tag.

   🔴 Player text never reaches innerHTML. Every string from the doc goes in
     through textContent, and a photo URL must be https or it is not drawn —
     the doc is admin-written, but a guide every player opens is exactly where
     a stored-XSS would do the most damage if an admin account were ever taken.
   ⚠ Everything is wrapped. A failure here can never take the node map down.
   ════════════════════════════════════════════════════════════════════════════ */
import { DEFAULT_DOC, DOC_VERSION } from './gridguide.content.js';
import { CSS } from './gridguide.style.js';
import * as api from './gridguide.api.js';

const RATE = 5000;                        // Vault base rate, 5,000 Cinder = $1.00 (sql/017)
const CACHE_KEY = 'mythic_gridguide_v1';  // last guide seen, so offline players still get the admin's copy
const MAX_DOC_CHARS = 180000;             // mirrors the CHECK in sql/132

const S = { doc: null, saved: null, editing: false, dirty: false, saving: false, armed: null, root: null, note: '' };

/* ── doc hygiene ────────────────────────────────────────────────────────── */
const clone = (o) => JSON.parse(JSON.stringify(o));
const str = (v) => (typeof v === 'string' ? v : '');
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '');
// A doc from the cloud or localStorage is accepted only in the shape this file
// draws. Anything else falls back to the built-in guide rather than half-rendering.
function valid(d) {
  return !!(d && typeof d === 'object' && d.hero && typeof d.hero === 'object' && Array.isArray(d.sections)
    && d.sections.every((s) => s && typeof s === 'object' && typeof s.kind === 'string'));
}
function normalise(d) {
  d.hero.meta = Array.isArray(d.hero.meta) ? d.hero.meta : [];
  d.sections.forEach((s, i) => {
    if (!s.id) s.id = 's' + i;
    if (!Array.isArray(s.extras)) s.extras = [];
    if (s.kind !== 'calc' && s.kind !== 'custom' && !Array.isArray(s.items)) s.items = [];
  });
  return d;
}
function readCache() { try { const d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return valid(d) ? normalise(d) : null; } catch (e) { return null; } }
function writeCache(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) {} }

/* ── DOM helpers ────────────────────────────────────────────────────────── */
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function add(p, ...kids) { kids.forEach((k) => { if (k) p.appendChild(k); }); return p; }
function btn(label, cls, fn, title) { const b = h('button', 'gg-btn ' + (cls || ''), label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; }
function dirty() { S.dirty = true; paintTop(); }
const plainOK = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; } catch (e) { return false; } })();

// What the admin TYPED. Not innerText: that applies CSS text-transform, so every
// uppercase heading was saved in capitals and lost its real casing on the next load.
function plainText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  c.querySelectorAll('div,p').forEach((d) => d.prepend('\n'));
  return (c.textContent || '').replace(/^\n/, '').replace(/\n$/, '');
}
// Text bound to obj[key]; editable in place for an admin in edit mode.
function ed(tag, cls, obj, key) {
  const e = h(tag, cls, str(obj[key]));
  e.setAttribute('data-ed', '');
  if (S.editing) {
    e.contentEditable = plainOK ? 'plaintext-only' : 'true';
    if (!plainOK) e.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text/plain')); });
    e.addEventListener('input', () => { obj[key] = plainText(e); dirty(); });
    // Typing inside the guide must not reach the game's global key handlers.
    e.addEventListener('keydown', (ev) => ev.stopPropagation());
  }
  return e;
}
function xBtn(arr, i, what) { const b = h('button', 'gg-x', '✕'); b.type = 'button'; b.title = 'Remove ' + what; b.setAttribute('aria-label', b.title); b.addEventListener('click', () => { arr.splice(i, 1); dirty(); paint(); }); return b; }
function row(el, arr, i, what) { if (!S.editing) return el; return add(h('div', 'gg-row'), el, xBtn(arr, i, what)); }
function adder(label, arr, make) { return add(h('div', 'gg-ctl'), btn('+ ' + label, 'sm', () => { arr.push(make()); dirty(); paint(); })); }
function img(url, alt) { const u = safeUrl(url); if (!u) return null; const i = h('img'); i.src = u; i.alt = str(alt); i.loading = 'lazy'; return i; }

function pickPhoto(done) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    api.toast('Uploading ' + f.name + '…');
    try { const url = await api.uploadPhoto(f); done(url); dirty(); paint(); api.toast('Photo added. Save to publish it.'); }
    catch (e) { api.toast('📷 ' + ((e && e.message) || 'Upload failed.')); }
  });
  inp.click();
}

/* ── admin-added blocks, available under every section ──────────────────── */
function extras(sec) {
  const wrap = h('div', 'gg-extras');
  sec.extras.forEach((b, i) => {
    let el;
    if (b.type === 'photo') {
      el = h('figure', 'gg-blk photo' + (b.wide ? ' wide' : ''));
      add(el, img(b.url, b.caption), (b.caption || S.editing) ? ed('figcaption', 'gg-pw', b, 'caption') : null);
    } else {
      el = h('div', 'gg-blk' + (b.wide ? ' wide' : ''));
      add(el, ed('h3', '', b, 'title'), ed('p', 'gg-pw', b, 'body'));
    }
    if (S.editing) {
      const c = h('div', 'gg-ctl');
      if (i > 0) add(c, btn('↑', 'sm', () => { sec.extras.splice(i - 1, 0, sec.extras.splice(i, 1)[0]); dirty(); paint(); }, 'Move earlier'));
      if (i < sec.extras.length - 1) add(c, btn('↓', 'sm', () => { sec.extras.splice(i + 1, 0, sec.extras.splice(i, 1)[0]); dirty(); paint(); }, 'Move later'));
      add(c, btn(b.wide ? 'Half width' : 'Full width', 'sm', () => { b.wide = !b.wide; dirty(); paint(); }));
      add(c, btn('Remove', 'sm dan', () => { sec.extras.splice(i, 1); dirty(); paint(); }));
      add(el, c);
    }
    add(wrap, el);
  });
  const f = document.createDocumentFragment();
  add(f, wrap, add(h('div', 'gg-add'),
    btn('+ Add text', 'sm', () => { sec.extras.push({ type: 'text', title: 'New heading', body: 'Write here.' }); dirty(); paint(); }),
    btn('+ Add photo', 'sm', () => pickPhoto((url) => sec.extras.push({ type: 'photo', url, caption: '' })))));
  return f;
}

/* ── section kinds ──────────────────────────────────────────────────────── */
const KIND = {
  doors(sec) {
    const g = h('div', 'gg-doors');
    sec.items.forEach((d, i) => {
      d.bullets = Array.isArray(d.bullets) ? d.bullets : [];
      const ul = h('ul');
      d.bullets.forEach((_, j) => add(ul, add(h('li'), row(ed('span', '', d.bullets, j), d.bullets, j, 'point'))));
      const card = add(h('div', 'gg-card'), ed('div', 'who', d, 'who'), ed('h3', '', d, 'title'), ed('p', 'hook gg-pw', d, 'hook'), ul,
        adder('point', d.bullets, () => 'New point'));
      if (S.editing) add(card, add(h('div', 'gg-ctl'), btn('Remove card', 'sm dan', () => { sec.items.splice(i, 1); dirty(); paint(); })));
      add(g, card);
    });
    return add(document.createDocumentFragment(), g, adder('card', sec.items, () => ({ who: 'Path', title: 'New path', hook: 'One line on what it is.', bullets: ['First point'] })));
  },
  flow(sec) {
    const g = h('div', 'gg-flow');
    sec.items.forEach((s, i) => add(g, add(h('div', 'gg-step'), row(ed('b', '', s, 'title'), sec.items, i, 'step'), ed('p', 'gg-pw', s, 'body'))));
    return add(document.createDocumentFragment(), g, adder('step', sec.items, () => ({ title: 'New step', body: 'What happens here.' })));
  },
  calc(sec) {
    const c = h('div', 'gg-calc');
    const pay = h('input'); pay.type = 'number'; pay.min = '0'; pay.step = '1000'; pay.value = '50000'; pay.id = 'gg-pay';
    const pct = h('input'); pct.type = 'range'; pct.min = '0'; pct.max = '100'; pct.step = '5'; pct.value = '30'; pct.id = 'gg-pct';
    [pay, pct].forEach((i) => i.addEventListener('keydown', (ev) => ev.stopPropagation()));
    const pctOut = h('span', '', '30%');
    const l1 = add(h('label'), document.createTextNode('Example city payout (🔥 Cinder)'), pay); l1.htmlFor = 'gg-pay';
    const l2 = add(h('label'), document.createTextNode('Grid Manager’s share: '), pctOut, pct); l2.htmlFor = 'gg-pct';
    const bm = h('div', 'm'), bo = h('div', 'o');
    const mOut = h('strong'), oOut = h('strong'), mUsd = h('span', 'gg-fine'), oUsd = h('span', 'gg-fine');
    add(c, add(h('div', 'gg-cr'), l1, l2), add(h('div', 'gg-split'), bm, bo),
      add(h('div', 'gg-ro'), add(h('div'), h('small', '', 'Grid Manager gets'), mOut, mUsd), add(h('div'), h('small', '', 'Owner gets'), oOut, oUsd)),
      ed('p', 'gg-fine gg-pw', sec, 'note'));
    const fmt = (n) => n.toLocaleString('en-US') + ' 🔥';
    const usd = (n) => '$' + (n / RATE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const upd = () => {
      const d = Math.max(0, Math.floor(Number(pay.value) || 0)), p = Math.min(100, Math.max(0, Number(pct.value) || 0));
      // The same arithmetic as sql/121: the cut is FLOORED and the owner takes the exact remainder.
      const cut = (d > 0 && p > 0) ? Math.floor(d * p / 100) : 0, own = d - cut;
      pctOut.textContent = p + '%'; mOut.textContent = fmt(cut); oOut.textContent = fmt(own); mUsd.textContent = usd(cut); oUsd.textContent = usd(own);
      bm.style.flex = String(p || 0.0001); bo.style.flex = String((100 - p) || 0.0001);
      bm.textContent = p >= 12 ? 'Manager ' + p + '%' : ''; bo.textContent = p <= 88 ? 'Owner ' + (100 - p) + '%' : '';
    };
    pay.addEventListener('input', upd); pct.addEventListener('input', upd); upd();
    return c;
  },
  map(sec) {
    const g = h('div', 'gg-map');
    sec.items.forEach((d, i) => {
      d.routes = Array.isArray(d.routes) ? d.routes : [];
      const ul = h('ul');
      d.routes.forEach((rt, j) => {
        const own = rt.k === 'own', tag = h('button', 'gg-tag ' + (own ? 'own' : 'play'), own ? 'own' : 'play');
        tag.type = 'button'; tag.tabIndex = S.editing ? 0 : -1;
        if (S.editing) { tag.title = 'Switch between play and own'; tag.addEventListener('click', () => { rt.k = own ? 'play' : 'own'; dirty(); paint(); }); }
        add(ul, add(h('li'), tag, row(ed('b', '', rt, 't'), d.routes, j, 'route'), ed('span', 'gg-pw', rt, 'b')));
      });
      const el = add(h('div', 'gg-dist'), add(h('h3'), ed('span', '', d, 'name'), ed('small', '', d, 'sub')), ul,
        adder('route', d.routes, () => ({ k: 'play', t: 'New route', b: 'How it earns.' })));
      if (S.editing) add(el, add(h('div', 'gg-ctl'), btn('Remove district', 'sm dan', () => { sec.items.splice(i, 1); dirty(); paint(); })));
      add(g, el);
    });
    return add(document.createDocumentFragment(), g, adder('district', sec.items, () => ({ name: 'New district', sub: 'TYPE', routes: [] })));
  },
  faq(sec) {
    const g = h('div', 'gg-faq');
    sec.items.forEach((it, i) => add(g, add(h('div'), row(ed('div', 'q', it, 'q'), sec.items, i, 'question'), ed('p', 'a gg-pw', it, 'a'))));
    return add(document.createDocumentFragment(), g, adder('question', sec.items, () => ({ q: 'New question?', a: 'The answer.' })));
  },
  check(sec) {
    const ul = h('ul', 'gg-check');
    sec.items.forEach((_, i) => add(ul, add(h('li'), row(ed('span', '', sec.items, i), sec.items, i, 'line'))));
    return add(document.createDocumentFragment(), ul, adder('line', sec.items, () => 'New line'));
  },
  custom() { return null; },
};

/* ── page ───────────────────────────────────────────────────────────────── */
function hero() {
  const H = S.doc.hero, el = h('header', 'gg-hero'), meta = h('div', 'gg-meta');
  H.meta.forEach((_, i) => add(meta, add(h('span'), ed('span', '', H.meta, i), S.editing ? xBtn(H.meta, i, 'fact') : null)));
  if (S.editing) add(meta, btn('+ fact', 'sm', () => { H.meta.push('New fact'); dirty(); paint(); }));
  add(el, ed('div', 'gg-eb', H, 'eyebrow'), add(h('h1'), ed('span', '', H, 't1'), ed('span', '', H, 't2'), ed('span', '', H, 't3')),
    ed('p', 'gg-lede gg-pw', H, 'lede'), meta);
  const p = H.photo && img(H.photo.url, H.photo.alt);
  if (p) add(el, add(h('div', 'gg-hphoto'), p));
  if (S.editing) {
    add(el, add(h('div', 'gg-ctl'),
      btn(p ? 'Replace top photo' : '+ Add top photo', 'sm', () => pickPhoto((url) => { H.photo = { url, alt: '' }; })),
      p ? btn('Remove top photo', 'sm dan', () => { H.photo = null; dirty(); paint(); }) : null));
  }
  return el;
}
function section(sec, i) {
  const el = h('section', 'gg-sec'), list = S.doc.sections;
  if (S.editing) {
    const armed = S.armed === sec.id;
    add(el, add(h('div', 'gg-bar'), h('span', 'lbl', 'Section ' + (i + 1)),
      i > 0 ? btn('↑ Move up', 'sm', () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); dirty(); paint(); }) : null,
      i < list.length - 1 ? btn('↓ Move down', 'sm', () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); dirty(); paint(); }) : null,
      btn(armed ? 'Click again to delete' : 'Delete section', 'sm dan', () => {
        if (S.armed === sec.id) { list.splice(i, 1); S.armed = null; dirty(); } else S.armed = sec.id;
        paint();
      })));
  }
  const head = add(h('div', 'gg-head'), ed('div', 'gg-eb', sec, 'eyebrow'), ed('h2', '', sec, 'title'));
  if (sec.intro || S.editing) add(head, ed('p', 'gg-pw', sec, 'intro'));
  add(el, head);
  try { add(el, (KIND[sec.kind] || KIND.custom)(sec)); } catch (e) { console.warn('[gridguide] section', sec.kind, e); }
  add(el, extras(sec));
  return el;
}

let bodyEl = null, topEl = null, stEl = null, saveB = null, editB = null, discardB = null;
function paint() {
  if (!bodyEl) return;
  const y = bodyEl.scrollTop;
  S.root.classList.toggle('gg-editing', S.editing);
  bodyEl.textContent = '';
  add(bodyEl, hero());
  if (S.note) add(bodyEl, h('div', 'gg-note', S.note));
  S.doc.sections.forEach((s, i) => add(bodyEl, section(s, i)));
  if (S.editing) add(bodyEl, add(h('div', 'gg-add'), btn('+ Add a new section', '', () => {
    S.doc.sections.push({ id: 's' + Date.now().toString(36), kind: 'custom', eyebrow: 'New section', title: 'Section title', intro: 'Write an intro, then add text or photos below.', extras: [] });
    dirty(); paint();
  })));
  bodyEl.scrollTop = y;
}
function paintTop() {
  if (!stEl) return;
  const admin = api.isAdmin();
  [editB, saveB, discardB].forEach((b) => { b.hidden = !admin; });
  if (!admin) { stEl.textContent = ''; return; }
  stEl.textContent = S.saving ? 'Saving…' : S.dirty ? 'Unsaved changes' : S.editing ? 'Editing. Click any text to change it.' : '👑 Admin: you can edit this guide.';
  stEl.className = 'gg-st' + (S.dirty ? ' dirty' : '');
  saveB.disabled = !S.dirty || S.saving; discardB.disabled = !S.dirty || S.saving;
  editB.textContent = S.editing ? 'Done editing' : '✎ Edit guide';
}

async function save() {
  if (!S.dirty || S.saving || !api.isAdmin()) return;
  const doc = clone(S.doc); doc.v = DOC_VERSION;
  if (JSON.stringify(doc).length > MAX_DOC_CHARS) { api.toast('The guide is too long to save. Remove some text blocks.'); return; }
  S.saving = true; paintTop();
  const r = await api.saveDoc(doc);
  S.saving = false;
  if (r.ok) { S.saved = clone(doc); S.dirty = false; S.note = ''; writeCache(doc); paintTop(); api.toast('📖 Guide saved. Every player now sees this version.'); return; }
  paintTop();
  api.toast(r.missing ? 'The guide table is not set up yet. Run sql/132_grid_guide.sql in Supabase.'
    : /row-level security|permission|42501/i.test(r.error || '') ? 'The server refused the save: this account is not an admin.'
    : 'The save didn’t go through: ' + (r.error || 'unknown error'));
}

function close() {
  if (S.dirty && api.isAdmin()) {
    const b = api.bridge();
    const go = () => { S.dirty = false; S.editing = false; teardown(); };
    if (b && b.confirm) { b.confirm('Close the guide and lose your unsaved changes?').then((ok) => { if (ok) go(); }); return; }
  }
  S.editing = false; teardown();
}
function teardown() {
  try { if (S.root) S.root.remove(); } catch (e) {}
  S.root = null; bodyEl = topEl = stEl = null;
  document.removeEventListener('keydown', onKey, true);
}
function onKey(ev) { if (ev.key === 'Escape' && S.root && !S.editing) { ev.stopPropagation(); close(); } }

function mountStyle() {
  if (document.getElementById('gg-style')) return;
  const st = document.createElement('style'); st.id = 'gg-style'; st.textContent = CSS; document.head.appendChild(st);
}

export function open() {
  try {
    if (S.root) return;
    mountStyle();
    if (!S.doc) { const c = readCache(); S.saved = c || clone(DEFAULT_DOC); S.doc = clone(S.saved); }
    const ov = h('div', 'gg-overlay'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'How Nodes Pay');
    const sheet = h('div', 'gg-sheet');
    topEl = h('div', 'gg-top'); stEl = h('span', 'gg-st');
    editB = btn('✎ Edit guide', '', () => { S.editing = !S.editing; S.armed = null; paint(); paintTop(); });
    discardB = btn('Discard', '', () => { S.doc = clone(S.saved); S.dirty = false; S.armed = null; paint(); paintTop(); api.toast('Changes discarded.'); });
    saveB = btn('Save & publish', 'pri', save);
    const closeB = btn('✕ Close', '', close);
    add(topEl, stEl, editB, discardB, saveB, closeB);
    bodyEl = h('div', 'gg-body');
    add(sheet, topEl, bodyEl); add(ov, sheet);
    ov.addEventListener('click', (ev) => { if (ev.target === ov && !S.editing) close(); });
    S.root = ov; document.body.appendChild(ov);
    document.addEventListener('keydown', onKey, true);
    paint(); paintTop();
    closeB.focus();
    refresh();
  } catch (e) { console.warn('[gridguide] open failed', e); }
}

// Pull the newest saved guide. Never replaces what an admin is in the middle of editing.
async function refresh() {
  const r = await api.loadLatest();
  if (r.ok && valid(r.doc)) {
    const d = normalise(r.doc);
    writeCache(d);
    S.saved = clone(d);
    if (!S.dirty) { S.doc = clone(d); S.note = ''; paint(); }
  } else if (r.missing && api.isAdmin()) {
    S.note = '👑 Admin note: saving needs sql/132_grid_guide.sql applied in Supabase. Players see the built-in guide until then.';
    paint();
  }
}

try {
  window.MythicGridGuide = { open, close: () => { if (S.root) close(); } };
  window.addEventListener('beforeunload', (e) => { if (S.dirty && S.root) { e.preventDefault(); e.returnValue = ''; } });
} catch (e) {}
