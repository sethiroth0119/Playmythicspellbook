/* ══ 🎨 VISUAL CUSTOMIZATION — the player recolours their buildings ════════
   public/src/palette/  →  served as /src/palette/index.js
   Registered as `window.MythicPalette`. Mounted from node-city/index.html.

   THREE MATERIAL SLOTS per building (walls / roof / trim), a hand-built colour
   picker, a Historical pin and a ↻ Reset — the CS2 🎨 tab, in this game's
   dossier.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `THREE`, `BUILDINGS`, `saveSoon`
      and `toast` are top-level `const` in node-city's module script and are
      INVISIBLE to an ES module. The ctx object passed to mount() IS the
      hand-over. There is no `window.game` and this file never looks for one.

      ctx = { THREE, tiles: () => game.tiles, saveSoon, toast }
      — read access to the tile store, the renderer's THREE, and the two UI
      primitives. Nothing that spends and nothing that builds: a recolour is
      cosmetic and this module has no way to reach the ledger.

   ── How the colour actually reaches the mesh ────────────────────────────
   See slots.js's header — that is where the design decision and its cost are
   written down. Short version: buildings already draw as merged buckets with
   VERTEX COLOURS over ~11 shared materials, so a recolour is a rewrite of one
   `color` buffer. No new material, no new draw call, no new shader program.

   ── Why an override survives an upgrade ─────────────────────────────────
   It is reapplied at the ONE funnel every building passes through:
   `buildMesh()`. Upgrade, repair, un-lease, damage-clear, admin re-skin and
   loadState all call it, so all of them repaint. Nothing here hooks the
   individual call sites, and nothing here caches a mesh across a rebuild.

   ── Degradation ─────────────────────────────────────────────────────────
   A 404 on this module costs the player the 🎨 tab and NOTHING else: every
   hook in index.html is `if (window.MythicPalette)` inside a try/catch, the
   save field is written as `null` when we are absent, and a save that already
   carries paint data is simply left untouched on disk.
   ══════════════════════════════════════════════════════════════════════════ */
import { SLOTS, SLOT_IDS, classify, tint, restore, generatedHex, currentHex } from './slots.js';
import { createPicker } from './picker.js';
import { normHex, lum } from './color.js';

const SAVE_V = 1;
// save keys are one letter each — a painted city is thousands of tiles and this
// object rides the SAME single-row save the whole city does.
const KEY_OF = { wall: 'w', roof: 'r', trim: 'm' };

let CTX = null;
/** tileKey -> { w,r,m: hex|null, h: 0|1, hp: slotId[], ty: buildingType } */
let STATE = Object.create(null);

const tiles = () => { try { return (CTX && CTX.tiles && CTX.tiles()) || {}; } catch (e) { return {}; } };
const tileAt = (k) => tiles()[k] || null;
const saveSoon = () => { try { if (CTX && CTX.saveSoon) CTX.saveSoon(); } catch (e) {} };
const toast = (m, kind) => { try { if (CTX && CTX.toast) CTX.toast(m, kind); } catch (e) {} };

/* ── the slot map for a live mesh ─────────────────────────────────────────
   Cached on the GROUP, never on the tile key: the group is thrown away and
   rebuilt on every upgrade/repair/reload, so a cache keyed on the tile would
   hand out pointers into disposed geometry. */
function slotsOf(group) {
  if (!group) return { wall: null, roof: null, trim: null };
  const c = group.userData.ncSlots;
  /* Revalidate before trusting the cache. buildMesh's async GLB swap calls
     g.clear() AFTER we have classified, which would leave us holding meshes
     whose geometry has since been disposed — writing into those is silent and
     the panel would show a colour nothing is drawing. A detached mesh has no
     parent, which is the cheapest possible test for it. */
  if (c && (!c.wall || c.wall.parent) && (!c.roof || c.roof.parent) && (!c.trim || c.trim.parent)) return c;
  return (group.userData.ncSlots = classify(group));
}
function slotsForKey(k) {
  const t = tileAt(k);
  return t && t.mesh ? slotsOf(t.mesh) : { wall: null, roof: null, trim: null };
}

function rec(k, make) {
  let r = STATE[k];
  if (!r && make) r = STATE[k] = { w: null, r: null, m: null, h: 0, hp: [], ty: (tileAt(k) || {}).type || null };
  return r || null;
}
function isEmpty(r) {
  return !r || (!r.w && !r.r && !r.m && !r.h);
}

/* ══ THE BUILD HOOK ═══════════════════════════════════════════════════════
   Called from the tail of buildMesh(), which is every construction of every
   building mesh in the game. `tx`/`tz` may be undefined (the model preview and
   the harnesses call buildMesh without coords) — that is not an error, it just
   means there is no plot and therefore no override. */
function paint(group, tx, tz, type) {
  if (!group || typeof tx !== 'number' || typeof tz !== 'number') return;
  const k = tx + ',' + tz;
  const r = STATE[k];
  if (!r) return;
  /* A demolish-and-rebuild puts a DIFFERENT building on the plot. Inheriting
     the old one's colours would be a ghost the player never asked for, so the
     record is dropped the moment the type stops matching. This is also why
     there is no demolish hook in index.html. */
  if (r.ty && type && r.ty !== type) { delete STATE[k]; return; }
  const s = slotsOf(group);
  for (const def of SLOTS) {
    const hex = r[KEY_OF[def.id]];
    if (hex && s[def.id]) tint(CTX.THREE, s[def.id], hex);
  }
}

/** Repaint every standing building. The belt to the build hook's braces. */
function repaintAll() {
  const T = tiles();
  let n = 0;
  for (const k in T) {
    const t = T[k];
    if (!t || !t.mesh || !STATE[k]) continue;
    const [x, z] = k.split(',').map(Number);
    try { paint(t.mesh, x, z, t.type); n++; } catch (e) {}
  }
  return n;
}

/* ══ MUTATIONS ═══════════════════════════════════════════════════════════ */
function setSlot(k, slot, hex, opts) {
  const v = normHex(hex);
  if (!v || SLOT_IDS.indexOf(slot) < 0) return false;
  const mesh = slotsForKey(k)[slot];
  if (!mesh) return false;
  const r = rec(k, true);
  r.ty = (tileAt(k) || {}).type || r.ty;
  r[KEY_OF[slot]] = v;
  // Once you have chosen a colour by hand it is no longer a Historical pin.
  r.hp = (r.hp || []).filter(s => s !== slot);
  tint(CTX.THREE, mesh, v);
  if (!opts || opts.save !== false) saveSoon();
  return true;
}

function clearSlot(k, slot) {
  if (SLOT_IDS.indexOf(slot) < 0) return false;
  const r = STATE[k];
  const mesh = slotsForKey(k)[slot];
  if (mesh) restore(mesh);
  if (r) {
    r[KEY_OF[slot]] = null;
    r.hp = (r.hp || []).filter(s => s !== slot);
    if (isEmpty(r)) delete STATE[k];
  }
  saveSoon();
  return true;
}

/** ↻ — back to the colours the generator made. Drops Historical too. */
function resetTile(k) {
  const s = slotsForKey(k);
  for (const def of SLOTS) if (s[def.id]) restore(s[def.id]);
  delete STATE[k];
  saveSoon();
  return true;
}

/* ── Historical ───────────────────────────────────────────────────────────
   CS2's Historical locks a building so it never levels up and never changes
   appearance. Ours keeps the half that means something here: THE COLOURS ARE
   PINNED. Every slot that has no explicit colour is filled with the one it is
   currently showing, so a later rebuild cannot re-roll it.

   That is not a no-op even for a building whose look is already stable.
   makeHousing seeds itself off the tile coords precisely so a house does not
   re-roll on reload — but many other recipes still roll their palette from
   Math.random at construction, so an upgrade genuinely does repaint them.
   Historical is the switch that stops that.

   Turning it OFF releases only the slots Historical itself pinned (`hp`), so a
   colour the player actually chose is never thrown away by a checkbox. */
function setHistorical(k, on) {
  if (on) {
    const s = slotsForKey(k);
    const r = rec(k, true);
    r.ty = (tileAt(k) || {}).type || r.ty;
    r.h = 1; r.hp = r.hp || [];
    for (const def of SLOTS) {
      const kk = KEY_OF[def.id];
      if (r[kk] || !s[def.id]) continue;
      const cur = currentHex(CTX.THREE, s[def.id]);
      if (!cur) continue;
      r[kk] = cur;
      // tint() so the generated colour is captured for ↻ Reset even though the
      // pixels do not change — otherwise resetting a pinned building would have
      // nothing to restore.
      tint(CTX.THREE, s[def.id], cur);
      if (r.hp.indexOf(def.id) < 0) r.hp.push(def.id);
    }
  } else {
    const r = STATE[k];
    if (r) {
      const s = slotsForKey(k);
      for (const id of (r.hp || [])) { if (s[id]) restore(s[id]); r[KEY_OF[id]] = null; }
      r.hp = []; r.h = 0;
      if (isEmpty(r)) delete STATE[k];
    }
  }
  saveSoon();
  return true;
}

/* ══ PERSISTENCE ═════════════════════════════════════════════════════════
   Rides node-city's own single-row save as ONE optional field. A save written
   before this feature existed has no `paint` key, which correctly means "no
   building was ever recoloured" — there is nothing to migrate and no default
   to invent. A save WITH the key opened by a build that does not have this
   module loaded keeps the key on disk untouched (see the serialize hook). */
function save() {
  const T = tiles();
  const t = {};
  let n = 0;
  for (const k in STATE) {
    const r = STATE[k];
    if (isEmpty(r)) continue;
    // Prune plots that no longer carry a building — otherwise a city that has
    // been rebuilt a hundred times grows a save field forever.
    if (!T[k]) continue;
    const o = {};
    if (r.w) o.w = r.w;
    if (r.r) o.r = r.r;
    if (r.m) o.m = r.m;
    if (r.h) o.h = 1;
    if (r.hp && r.hp.length) o.p = r.hp.join(',');
    if (r.ty) o.t = r.ty;
    t[k] = o; n++;
  }
  return n ? { v: SAVE_V, t } : null;
}

function load(obj) {
  STATE = Object.create(null);
  if (!obj || typeof obj !== 'object' || !obj.t || typeof obj.t !== 'object') return 0;
  let n = 0;
  for (const k in obj.t) {
    const o = obj.t[k];
    if (!o || typeof o !== 'object') continue;
    if (!/^-?\d+,-?\d+$/.test(k)) continue;             // never trust a key
    const r = {
      w: normHex(o.w) || null, r: normHex(o.r) || null, m: normHex(o.m) || null,
      h: o.h ? 1 : 0,
      /* ⚠ SLOT_IDS.indexOf, not `KEY_OF[s]`. KEY_OF is a plain object literal,
         so a save carrying "constructor" or "__proto__" as a pinned slot would
         pass a truthy-lookup filter and put a Function where a hex belongs. A
         save file is untrusted input like any other. */
      hp: typeof o.p === 'string' ? o.p.split(',').filter(s => SLOT_IDS.indexOf(s) >= 0) : [],
      ty: typeof o.t === 'string' ? o.t : null,
    };
    if (isEmpty(r)) continue;
    STATE[k] = r; n++;
  }
  return n;
}

/* ══ THE PANEL ═══════════════════════════════════════════════════════════ */
function canPaint(k) {
  const s = slotsForKey(k);
  return !!(s.wall || s.roof || s.trim);
}

/** The pane's markup, as a string — openInspect assembles panes by innerHTML. */
function paneHtml(k) {
  return '<div class="np-root" data-k="' + String(k).replace(/[^0-9,\-]/g, '') + '"></div>';
}

let _picker = null, _openSlot = null;

/** Build the live DOM. Called right after openInspect writes `inspanes`. */
function bindPane(k) {
  const host = document.querySelector('#inspanes .np-root[data-k="' + k + '"]');
  if (!host) return;
  ensureStyle();
  _picker = null; _openSlot = null;
  host.innerHTML = '';

  const s = slotsForKey(k);
  const r = STATE[k];

  const card = document.createElement('div');
  card.className = 'ins-card';
  const avail = SLOTS.filter(d => s[d.id]).length;
  card.innerHTML =
    '<div class="ins-ch"><span class="eyeb">Visual customization</span>' +
    '<span class="eyeb">' + avail + ' of 3 slots</span></div>' +
    '<div class="ins-desc">Repaint this building. Each slot is one surface of the model; ' +
    'the colour is stored against the plot, so it survives an upgrade, a repair and a reload. ' +
    'A slot with no swatch means this model has no separate surface for it.</div>';
  host.appendChild(card);

  const row = document.createElement('div');
  row.className = 'np-slots';
  card.appendChild(row);

  const btns = {};
  for (const def of SLOTS) {
    const mesh = s[def.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'np-slot';
    b.dataset.slot = def.id;
    b.disabled = !mesh;
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'np-pop');
    b.innerHTML =
      '<span class="np-b" aria-hidden="true">' + def.ico + '</span>' +
      '<span class="np-sw"></span>' +
      '<span class="np-t"><b></b><i></i></span>';
    row.appendChild(b);
    btns[def.id] = b;
  }

  /* ⚠ THE FOOTER IS BUILT BEFORE THE POPOVER AND SITS ABOVE IT. First cut put
     Historical and ↻ at the bottom of the card, which is where they live on the
     reference panel — but the reference has the whole dialog to itself and this
     card sits inside a dossier pane that already scrolls. Measured at 1600x900:
     opening the picker pushed both controls below the fold, so the two things
     the panel exists to offer besides the picker were invisible exactly when a
     player was using it. Directly under the swatches, they never move. */
  const foot = document.createElement('div');
  foot.className = 'np-foot';
  const histWrap = document.createElement('label');
  histWrap.className = 'np-hist';
  const hist = document.createElement('input');
  hist.type = 'checkbox';
  hist.checked = !!(r && r.h);
  const histTxt = document.createElement('span');
  histTxt.innerHTML = '<b>Historical</b><i>pin these colours so a rebuild cannot re-roll them</i>';
  histWrap.appendChild(hist); histWrap.appendChild(histTxt);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'np-reset';
  reset.innerHTML = '<span aria-hidden="true">↻</span> Reset colours';
  foot.appendChild(histWrap); foot.appendChild(reset);
  card.appendChild(foot);

  const pop = document.createElement('div');
  pop.className = 'np-pop';
  pop.id = 'np-pop';                     // the aria-controls target of all three slots
  pop.hidden = true;
  card.appendChild(pop);

  function refresh() {
    const cur = STATE[k];
    for (const def of SLOTS) {
      const b = btns[def.id], mesh = s[def.id];
      const sw = b.querySelector('.np-sw');
      const nm = b.querySelector('.np-t b');
      const vl = b.querySelector('.np-t i');
      nm.textContent = def.name;
      if (!mesh) { sw.style.background = 'transparent'; vl.textContent = 'not on this model'; b.title = def.hint; continue; }
      const hex = currentHex(CTX.THREE, mesh) || '888888';
      const own = !!(cur && cur[KEY_OF[def.id]]);
      sw.style.background = '#' + hex;
      sw.style.borderColor = lum(hex) > .6 ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.28)';
      vl.textContent = hex.toUpperCase() + (own ? ' · custom' : '');
      b.classList.toggle('np-on', own);
      b.title = def.hint;
    }
    hist.checked = !!(STATE[k] && STATE[k].h);
    const has = !!STATE[k];
    reset.disabled = !has;
  }

  function closePop() {
    if (_picker) { _picker.destroy(); _picker = null; }
    pop.hidden = true; pop.innerHTML = '';
    for (const id in btns) btns[id].setAttribute('aria-expanded', 'false');
    _openSlot = null;
  }

  function openPop(slot) {
    const mesh = s[slot];
    if (!mesh) return;
    closePop();
    _openSlot = slot;
    const start = currentHex(CTX.THREE, mesh) || 'c9af8f';
    const head = document.createElement('div');
    head.className = 'np-pophead';
    const def = SLOTS.find(d => d.id === slot);
    head.innerHTML = '<span class="eyeb">' + def.ico + ' ' + def.name + '</span>';
    const revert = document.createElement('button');
    revert.type = 'button'; revert.className = 'np-mini';
    revert.textContent = 'Use generated';
    revert.addEventListener('click', () => { clearSlot(k, slot); const g = generatedHex(CTX.THREE, mesh); if (g && _picker) _picker.set(g); refresh(); });
    head.appendChild(revert);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'np-mini';
    close.textContent = 'Done';
    close.addEventListener('click', () => { closePop(); try { btns[slot].focus(); } catch (e) {} });
    head.appendChild(close);
    pop.appendChild(head);

    _picker = createPicker({
      value: start,
      // Live: rewrite the vertex buffer while dragging. The renderer runs a
      // continuous animation loop, so there is nothing to invalidate.
      onInput: (hex) => { tint(CTX.THREE, mesh, hex); },
      // Commit: record it and schedule the save. Never on every drag frame —
      // saveSoon is an 800 ms debounce and a drag is 60 events a second.
      onCommit: (hex) => { setSlot(k, slot, hex); refresh(); },
    });
    pop.appendChild(_picker.root);
    pop.hidden = false;
    for (const id in btns) btns[id].setAttribute('aria-expanded', String(id === slot));
    _picker.focus();
  }

  row.addEventListener('click', (ev) => {
    const b = ev.target.closest('.np-slot');
    if (!b || b.disabled) return;
    if (_openSlot === b.dataset.slot) { closePop(); return; }
    openPop(b.dataset.slot);
  });
  hist.addEventListener('change', () => { setHistorical(k, hist.checked); refresh();
    toast(hist.checked ? '🎨 Historical — these colours are pinned.' : '🎨 Historical off.', 'good'); });
  /* ↻ deliberately does NOT ask. CLAUDE.md reserves gcConfirm() for the actions
     that cost something; a recolour costs nothing, is undone by picking again,
     and node-city has no gcConfirm — so the guarded fallback here would be a
     NATIVE confirm(), which is exactly the modal-that-blocks-the-tab this file
     spent a round removing from the plot-lease flow. The reference panel's ↻
     does not ask either. The toast is the acknowledgement. */
  reset.addEventListener('click', () => {
    closePop(); resetTile(k); refresh();
    toast('🎨 Colours reset to the generated palette.', 'good');
  });
  pop.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closePop(); try { btns[_openSlot || 'wall'].focus(); } catch (e) {} } });

  refresh();
}

/* ══ STYLE ════════════════════════════════════════════════════════════════
   Injected from here rather than added to node-city/index.html's <style>, so
   the whole feature is one module and a 404 leaves no orphan CSS behind. Every
   rule is scoped under .np-root, which only ever exists inside the dossier. */
let _styled = false;
function ensureStyle() {
  if (_styled || typeof document === 'undefined') return;
  _styled = true;
  const st = document.createElement('style');
  st.id = 'np-style';
  st.textContent = `
.np-root{display:block;min-width:0}
.np-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.np-slot{display:flex;align-items:center;gap:8px;padding:8px 9px;min-width:0;
  background:rgba(255,255,255,.03);border:1px solid var(--edge,#2e2740);border-radius:9px;
  color:inherit;font:inherit;cursor:pointer;text-align:left}
.np-slot:hover:not(:disabled){border-color:rgba(212,175,55,.5);background:rgba(212,175,55,.06)}
.np-slot:disabled{opacity:.42;cursor:default}
.np-slot.np-on{border-color:rgba(212,175,55,.6)}
.np-slot:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px}
.np-slot .np-b{font-size:16px;line-height:1;flex:none}
.np-slot .np-sw{width:26px;height:26px;border-radius:6px;flex:none;
  border:1px solid rgba(255,255,255,.28);box-shadow:inset 0 0 8px rgba(0,0,0,.35)}
.np-slot .np-t{min-width:0;display:block}
.np-slot .np-t b{display:block;font-size:11px;font-weight:600;color:var(--bone,#e8e2d5);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-slot .np-t i{display:block;font-style:normal;font-size:9px;letter-spacing:.06em;
  color:var(--mist,#8f87a3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-pop{border:1px solid rgba(212,175,55,.35);border-radius:10px;padding:10px;
  background:rgba(8,7,16,.6);margin-top:10px}
.np-pop[hidden]{display:none}
.np-pophead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.np-pophead .eyeb{flex:1;min-width:0}
.np-mini{background:none;border:1px solid var(--edge,#2e2740);border-radius:6px;
  color:var(--mist,#8f87a3);font:inherit;font-size:10px;padding:3px 8px;cursor:pointer}
.np-mini:hover{color:var(--bone,#e8e2d5);border-color:rgba(212,175,55,.5)}
.np-mini:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px}
.np-picker{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;max-width:560px}
.np-cvwrap{flex:none}
.np-cv{display:block;width:190px;height:190px;border-radius:50%;touch-action:none;cursor:crosshair}
.np-cv:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:3px}
.np-sliders{flex:1;min-width:190px;max-width:330px;display:flex;flex-direction:column;gap:9px;padding-top:4px}
.np-srow{display:grid;grid-template-columns:66px 1fr 40px;align-items:center;gap:8px}
.np-slab{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mist,#8f87a3)}
.np-sval{font-size:10px;font-variant-numeric:tabular-nums;color:var(--bone,#e8e2d5);text-align:right}
.np-sl{-webkit-appearance:none;appearance:none;height:12px;border-radius:6px;width:100%;
  background:var(--np-track,#444);border:1px solid var(--edge,#2e2740);outline-offset:3px}
.np-sl::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
  background:#fff;border:2px solid rgba(0,0,0,.6);cursor:pointer}
.np-sl::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;
  border:2px solid rgba(0,0,0,.6);cursor:pointer}
.np-sl:focus-visible{outline:2px solid var(--sky,#7fb8ff)}
.np-hexrow{display:grid;grid-template-columns:22px 66px minmax(0,1fr);align-items:center;gap:8px;
  margin-top:2px}
.np-chip{width:22px;height:22px;border-radius:5px;border:1px solid rgba(255,255,255,.28)}
.np-hex{background:rgba(0,0,0,.35);border:1px solid var(--edge,#2e2740);border-radius:6px;
  color:var(--bone,#e8e2d5);font:inherit;font-size:12px;letter-spacing:.12em;
  font-variant-numeric:tabular-nums;padding:5px 8px;min-width:0;width:100%}
.np-hex:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px}
.np-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  border-top:1px solid var(--edge,#2e2740);padding-top:10px}
.np-hist{display:flex;align-items:flex-start;gap:8px;flex:1;min-width:180px;cursor:pointer}
.np-hist input{margin-top:2px;accent-color:var(--gold,#d4af37);flex:none}
.np-hist input:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px}
.np-hist b{display:block;font-size:11px;font-weight:600;color:var(--bone,#e8e2d5)}
.np-hist i{display:block;font-style:normal;font-size:10px;color:var(--mist,#8f87a3);line-height:1.4}
.np-reset{background:none;border:1px solid var(--edge,#2e2740);border-radius:7px;
  color:var(--mist,#8f87a3);font:inherit;font-size:11px;padding:6px 11px;cursor:pointer;flex:none}
.np-reset:hover:not(:disabled){color:var(--bone,#e8e2d5);border-color:rgba(212,175,55,.5)}
.np-reset:disabled{opacity:.4;cursor:default}
.np-reset:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px}
@media (max-width:760px){.np-slots{grid-template-columns:1fr}}
`;
  try { document.head.appendChild(st); } catch (e) { _styled = false; }
}

/* ══ MOUNT ═══════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  CTX = ctx || {};
  if (!CTX.THREE) throw new Error('[palette] ctx.THREE is required');
  const API = {
    version: 1,
    // build hook
    paint, repaintAll,
    // panel
    canPaint, paneHtml, bindPane, slots: SLOTS,
    // persistence
    save, load,
    // programmatic (diagnostics, tests, and driveIt)
    setSlot, clearSlot, resetTile, setHistorical,
    get: (k) => { const r = STATE[k]; return r ? { wall: r.w, roof: r.r, trim: r.m, historical: !!r.h } : null; },
    slotsForKey,
    currentOf: (k) => { const s = slotsForKey(k), o = {}; for (const d of SLOTS) o[d.id] = s[d.id] ? currentHex(CTX.THREE, s[d.id]) : null; return o; },
    generatedOf: (k) => { const s = slotsForKey(k), o = {}; for (const d of SLOTS) o[d.id] = s[d.id] ? generatedHex(CTX.THREE, s[d.id]) : null; return o; },
    count: () => Object.keys(STATE).length,
  };
  try { window.MythicPalette = API; } catch (e) {}
  return API;
}
export default { mount };
