/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE RESOURCE INFO VIEW.
   ----------------------------------------------------------------------------
   Built to the same grammar as /src/water/panel.js and /src/power/panel.js on
   purpose, so the five info views read as one application rather than as five
   features:

     1. THE LEGEND IS NOT A KEY, IT IS THE OVERLAY CONTROL. Every row has a
        checkbox that turns that layer on in the world.
     2. LAYERS ARE GROUPED BY WHERE THE DATA COMES FROM, because after this
        round that grouping IS the mental model: half of what this panel draws
        belongs to another module and is merely being SHOWN here.
     3. A ROW WHOSE CAPABILITY IS ABSENT RENDERS DISABLED AND NAMES THE GLOBAL
        IT IS WAITING FOR. It can never be switched on, and nothing plausible
        is drawn in its place.

   …and the two things a colour ramp can never say, which are the whole reason
   the player asked for this:

     · THE READOUT. The exact number under the cursor, for every field at once,
       AND the multiplier a building that eats that resource would collect
       there. "62% ore · a Mine here runs at ×1.41" is a decision; a gradient is
       a mood.
       🔴 IT IS THE SAME CALL THE TICK MAKES. The factor printed here comes from
          fields.js `yieldOf()` — the identical function node-city's pre-pass
          calls — not from a second derivation of it. A panel that computes its
          own version of the number the city was charged is a panel that will
          eventually contradict the game while looking authoritative.
     · THE DEPOSIT TABLE. Named bodies with a centre and a richness, so a player
       can read "the Redseam lode is at 6,17" off the panel and go there,
       instead of hunting the map by dragging the camera.

   🔴 THE PANEL'S OWN CSS IS SCOPED AND INJECTED FROM HERE, not added to
      index.html — every rule is prefixed `#ncrm` so nothing can collide, and
      the colours are node-city's own custom properties.

   ⚠ IT DOCKS ON THE LEFT, BELOW /src/water. The HUD owns both edges and
     /src/power already parks inboard of the RIGHT rail; the hydrology panel
     takes left:260. This one offsets further down so a player comparing the
     aquifer against the ore under it can have both open, which is exactly what
     the round is for.
   ════════════════════════════════════════════════════════════════════════════ */

import { RES } from './tuning.js';
import { yieldOf, fieldForRes } from './fields.js';

let root = null, open = false, api = null;

/* ── LAYERS ─────────────────────────────────────────────────────────────────
   Derived from RES.fields and RES.read rather than typed out again. Two lists
   that have to agree is how a row quietly stops matching — the bug class
   node-city has corrected three times by number. */
export const LAYERS = [
  ...RES.fields.map(f => ({
    id: f.id, group: 'field', label: f.label, ico: f.ico, ramp: f.ramp,
    lo: 'None', hi: 'Rich', note: f.note, key: f.key, res: f.res,
  })),
  ...RES.read.map(f => ({
    id: f.id, group: 'map', label: f.label, ico: f.ico, ramp: f.ramp,
    lo: 'Thin', hi: 'Deep', note: f.note, key: f.key, need: f.need, from: f.from, res: [],
  })),
];
const GROUP_LABEL = {
  field: 'This city’s ground',
  map: 'Drawn by another system',
};

/* Defaults live in tuning so a retune is one file. Copied, never aliased: the
   checkbox handler writes into this object and a shared reference would edit
   the tuning table. */
export const layers = Object.assign({}, RES.defaultLayers);

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';
const mult = (v) => '×' + (Number(v) || 1).toFixed(2);

function swatch(col) { return '<i class="rmsw" style="background:' + col + '"></i>'; }
function rampStrip(stops) {
  return '<i class="rmramp" style="background:linear-gradient(90deg,' + (stops || []).join(',') + ')"></i>';
}

function header(F) {
  const badge = F
    ? '<span class="rmbadge" title="The two richest fields in this city">' + esc(F.summary()) + '</span>'
    : '<span class="rmbadge">static</span>';
  return '<div class="rmhead"><span class="rmtitle">🗺 RESOURCES</span>' + badge +
         '<button class="rmx" data-rmclose="1" aria-label="Close">×</button></div>';
}

/* ── THE READOUT ────────────────────────────────────────────────────────────
   Every field at ONE tile, plus what a building that eats it would collect.
   🔴 THE HONEST EMPTY STATE COMES FIRST. Before the player has moved the
      pointer over the map there is no tile to read, and an empty table showing
      0% everywhere would teach them the city has nothing in it. */
function readout(st) {
  const at = st.at;
  if (!at) {
    return '<div class="rmsec">UNDER THE CURSOR</div>' +
      '<div class="rmnote">Move the pointer over the city. This reads every field at that tile, and what a ' +
      'building that eats it would run at if you put one there.</div>';
  }
  const F = st.F;
  let h = '<div class="rmsec">UNDER THE CURSOR<span class="rmsecv">' + at.x + ',' + at.z + '</span></div>';
  h += '<div class="rmread">';
  for (const l of LAYERS) {
    const v = st.valueOf(l.id, at.x, at.z);
    if (v == null) continue;                       // read-through owner absent
    const on = !!layers[l.id];
    /* The yield is only printed for a field that actually feeds something —
       groundwater and heat carry none here BY DESIGN (their owners charge for
       them), and printing a multiplier beside them would be this module
       claiming a number it does not apply. See RES.read's header. */
    const r = l.res && l.res[0];
    const y = r ? yieldOf(r, v, true) : null;
    /* 🔴 A NUMBER UNDER THE SITE LINE IS SAID TO BE UNDER IT. The readout used
       to print a bare "2%" for a groundwater tile the Water Station gate
       refuses, beside an overlay that had coloured it — three surfaces, two
       stories. The value is still shown (it is the truth about the ground), but
       it is marked, and the mark comes from the same `lines` the paint used. */
    const line = st.lines && st.lines[l.id];
    const under = line && isFinite(Number(line.mark)) && v < Number(line.mark);
    h += '<div class="rmrow2' + (on ? '' : ' dim') + '">' +
      '<span class="rmk">' + swatch(l.key) + esc(l.ico) + ' ' + esc(l.label) + '</span>' +
      '<span class="rmv' + (under ? ' rmunder' : '') + '"' +
        (under ? ' title="Below the site line (' + pct(line.mark) + ') — nothing is licensed on this tile"' : '') +
        '>' + pct(v) + (under ? '<i class="rmdag">*</i>' : '') + '</span>' +
      '<span class="rmy">' + (y ? mult(y.factor) : '—') + '</span>' +
      '</div>';
  }
  h += '</div>';
  const best = bestHere(st, at);
  if (best) {
    h += '<div class="rmnote">' + esc(best) + '</div>';
  }
  return h;
}

/* One sentence: what this tile is actually FOR. Derived from the same values
   the table above prints, so the advice and the numbers cannot disagree. */
function bestHere(st, at) {
  let top = null;
  for (const f of RES.fields) {
    const v = st.valueOf(f.id, at.x, at.z);
    if (v == null) continue;
    if (!top || v > top.v) top = { f, v };
  }
  if (!top) return '';
  if (top.v < RES.minRead) return 'Nothing worth extracting under this tile. Every field here is at or near zero — a producer sited here runs at the ' + mult(RES.yield.floor) + ' floor.';
  const y = yieldOf(top.f.res[0], top.v, true);
  return top.f.ico + ' ' + top.f.label + ' at ' + pct(top.v) + ' is the best thing under this tile — a producer that eats ' +
         top.f.res.join(' or ') + ' runs at ' + mult(y.factor) + ' here.';
}

/* ── THE DEPOSIT TABLE ──────────────────────────────────────────────────────
   Named bodies, with a centre a player can navigate to and the best tile in the
   field. Only for layers that are SWITCHED ON: a table of fifteen bodies across
   five fields is a wall, and the panel's own checkboxes are the filter the
   player already understands. */
function deposits(st) {
  const shown = RES.fields.filter(f => layers[f.id]);
  if (!shown.length) {
    return '<div class="rmsec">DEPOSITS</div>' +
      '<div class="rmnote">No field is switched on. Turn one on below and its bodies are listed here with ' +
      'their centres, so you can go to the good ground instead of hunting for it.</div>';
  }
  let h = '<div class="rmsec">DEPOSITS</div><div class="rmsrc">';
  for (const f of shown) {
    const bodies = st.F.bodies(f.id).slice().sort((a, b) => b.strength - a.strength);
    const best = st.F.best(f.id);
    h += '<div class="rmgrp2">' + swatch(f.key) + esc(f.ico) + ' ' + esc(f.label) +
         '<span class="rmbest">best tile ' + best.x + ',' + best.z + ' · ' + pct(best.v) + '</span></div>';
    let folded = 0;
    bodies.forEach((b, i) => {
      if (i >= RES.table.maxRows) { folded++; return; }
      h += '<div class="rmsrow">' +
        '<span class="rmsn">' + esc(b.name) + '</span>' +
        '<span class="rmsv" title="Centre">' + Math.round(b.cx) + ',' + Math.round(b.cz) + '</span>' +
        '<span class="rmsv" title="Richness at its centre">' + pct(b.strength) + '</span>' +
        '<span class="rmsv" title="Radius, in tiles">r' + b.r.toFixed(1) + '</span>' +
        '</div>';
    });
    if (folded) h += '<div class="rmsrow dim"><span class="rmsn">…and ' + folded + ' smaller</span></div>';
    if (f.surface) h += '<div class="rmsub2">Grows on the surface — an INDOOR building ignores it entirely.</div>';
  }
  return h + '</div>';
}

/* ── THE LADDER, STATED ─────────────────────────────────────────────────────
   🔴 A legend that promises a colour the simulation does not use is the failure
      mode this whole feature has to avoid, so the panel says out loud what the
      map is worth — the exact floor and the exact top, read off the tuning
      table rather than typed, and the sentence that it is never a gate. */
function ladder() {
  const Y = RES.yield;
  return '<div class="rmsec">WHAT THE MAP IS WORTH</div>' +
    '<div class="rmnote">A producer standing on nothing runs at <b>' + mult(Y.floor) + '</b>. On the core of a ' +
    'good body it runs at <b>' + mult(Y.top) + '</b>, and it reaches that anywhere the field is above <b>' +
    pct(Y.full) + '</b> — you do not have to find the exact peak tile. ' +
    'Nothing here can ever stop you building: the ground makes a site better or worse, never illegal.</div>';
}

/* ── WHERE THE LINE IS, IN THE LEGEND, AS A NUMBER ──────────────────────────
   🔴 DERIVED FROM THE VALUE THE OVERLAY ACTUALLY DREW WITH — the same
      `st.lines` object index.js handed the painter — and never typed into the
      note. The sentence this replaced was typed ("the outline is the legal-site
      line, and /src/water refuses anything outside it") and it was FALSE:
      nothing read `markFrom`, the outline sat at 0.12 against a gate at 0.10,
      and the paint ran all the way down to the alpha floor. A number printed
      here and a number used there, from one read, cannot drift.
   ⚠ Only for the READ-THROUGH rows. A generated field's `mark` is a richness
     contour that gates nothing but this module's own refusal, and calling it a
     site line in the legend would be the same overclaim in the other
     direction. */
function lineNote(st, l) {
  if (l.group !== 'map') return '';
  const line = st.lines && st.lines[l.id];
  if (!line || !isFinite(Number(line.mark))) return '';
  const at = ' Outline at ' + pct(line.mark) + ', read live from ' + (line.from || 'its owner') + '.';
  return line.cut == null
    ? at + ' Below that the ground is drawn but is not a licensed site.'
    : at + ' Nothing below that line is drawn, because nothing below it is a site.';
}

function legend(st) {
  let h = '<div class="rmsec">MAP LEGEND</div>';
  for (const g of ['field', 'map']) {
    const rows = LAYERS.filter(l => l.group === g);
    if (!rows.length) continue;
    h += '<div class="rmgrp">' + GROUP_LABEL[g] + '</div>';
    for (const l of rows) {
      const okCap = !l.need || !!st.caps[l.need];
      const on = !!layers[l.id] && okCap;
      h += '<label class="rmrow' + (okCap ? '' : ' off') + '">' +
             '<span class="rmkey">' + swatch(l.key) + esc(l.ico) + ' ' + esc(l.label) + '</span>' +
             '<input type="checkbox" data-layer="' + l.id + '"' + (on ? ' checked' : '') +
             (okCap ? '' : ' disabled') + '>' +
           '</label>';
      h += '<div class="rmsub"><span class="rmlo">' + esc(l.lo) + '</span>' + rampStrip(l.ramp) +
           '<span class="rmlo">' + esc(l.hi) + '</span></div>';
      /* 🔴 THE WAIT NAMES WHAT IS ACTUALLY MISSING. A row can be dark for two
         different reasons — the owner never mounted, or it mounted and would
         not state the line its own gate cuts at — and "awaiting
         MythicWater.endowment()" would be a lie in the second case. index.js
         puts the specific reason in `why` when it has one. */
      if (!okCap) h += '<div class="rmsub rmwait">awaiting <code>' +
                       esc((st.why && st.why[l.id]) || l.from) + '</code></div>';
      else if (l.note) h += '<div class="rmsub2">' + esc(l.note) + esc(lineNote(st, l)) + '</div>';
    }
  }
  return h;
}

function html(st) {
  if (!st || !st.F) {
    return header(null) + '<div class="rmempty">The resource model is not answering.' +
      (st && st.why ? '<br><span class="rmlo">' + esc(st.why) + '</span>' : '') + '</div>';
  }
  return header(st.F) + readout(st) + deposits(st) + ladder() + legend(st);
}

const CSS = `
/* 🪟 WHERE IT SITS. node-city's HUD owns both edges — #leftcol (left:12px,
   236px) and #rightcol (right:12px, 232px) — and #railbar is a full-width dock
   that always draws over a panel. /src/water parks inboard of the LEFT rail at
   left:260px and /src/power mirrors it on the right. This one takes the left
   column too but starts lower, so the two can be open together: comparing an
   ore body against the aquifer under it is exactly what this round is for. */
#ncrm{position:absolute;top:calc(var(--topbarh) + 96px);left:260px;z-index:8;width:min(352px,calc(100vw - 300px));
  max-height:calc(100vh - var(--topbarh) - 116px);overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:10px;padding:10px 12px 12px;color:var(--bone);
  font-size:12px;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.55);}
@media (max-width:980px){ #ncrm{top:calc(var(--topbarh) + 108px);left:12px;width:min(352px,92vw);z-index:9;
  max-height:calc(100vh - var(--topbarh) - 128px);} }
#ncrm::-webkit-scrollbar{width:8px}#ncrm::-webkit-scrollbar-thumb{background:var(--edge);border-radius:4px}
#ncrm .rmhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#ncrm .rmtitle{font-weight:700;letter-spacing:.06em;font-size:13px;flex:1}
#ncrm .rmbadge{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--sky,#8fd0e8);
  border:1px solid var(--edge);border-radius:4px;padding:1px 5px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:170px}
#ncrm .rmx{background:none;border:0;color:var(--mist);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
#ncrm .rmx:hover{color:var(--bone)}
#ncrm .rmsec{display:flex;align-items:baseline;gap:6px;margin:12px 0 5px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--mist);white-space:nowrap}
#ncrm .rmsecv{margin-left:auto;color:var(--bone);letter-spacing:0;font-size:11px;
  text-transform:none;font-variant-numeric:tabular-nums}
#ncrm .rmread{border-top:1px solid var(--edge);padding-top:5px}
#ncrm .rmrow2{display:flex;align-items:center;gap:6px;padding:2px 0}
#ncrm .rmrow2.dim{opacity:.45}
#ncrm .rmk{flex:1;display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncrm .rmv{width:42px;text-align:right;font-variant-numeric:tabular-nums;color:var(--bone)}
/* Under the owner's site line: the ground reads something, but nothing may be
   built on it. Dimmed and daggered rather than hidden — the number is true. */
#ncrm .rmv.rmunder{color:var(--mist);opacity:.75}
#ncrm .rmdag{font-style:normal;color:var(--mist);margin-left:1px}
#ncrm .rmy{width:52px;text-align:right;font-variant-numeric:tabular-nums;color:var(--mist)}
#ncrm .rmnote{margin-top:6px;font-size:11px;color:var(--mist);background:rgba(79,216,232,.06);
  border-left:2px solid var(--edge);padding:4px 7px;border-radius:0 4px 4px 0}
#ncrm .rmnote b{color:var(--bone)}
#ncrm .rmnote code{color:var(--sky,#8fd0e8);font-size:10px}
#ncrm .rmsrc{border-top:1px solid var(--edge);padding-top:5px}
#ncrm .rmgrp2{display:flex;align-items:center;gap:6px;margin:7px 0 2px;color:var(--bone);font-size:11px}
#ncrm .rmbest{margin-left:auto;color:var(--mist);font-size:10px;font-variant-numeric:tabular-nums}
#ncrm .rmsrow{display:flex;align-items:center;gap:6px;padding:1.5px 0 1.5px 18px}
#ncrm .rmsrow.dim{opacity:.55}
#ncrm .rmsn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bone)}
#ncrm .rmsv{width:44px;text-align:right;font-variant-numeric:tabular-nums;color:var(--mist);font-size:11px}
#ncrm .rmgrp{margin:9px 0 3px;font-size:10px;color:var(--mist);opacity:.75;letter-spacing:.05em}
#ncrm .rmrow{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
#ncrm .rmrow.off{opacity:.42;cursor:default}
#ncrm .rmkey{flex:1;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncrm .rmsw{width:10px;height:10px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
#ncrm .rmramp{display:inline-block;width:58px;height:7px;border-radius:3px;flex:none}
#ncrm .rmsub{display:flex;align-items:center;gap:5px;padding:1px 0 3px 18px;color:var(--mist);font-size:10px}
#ncrm .rmsub2{color:var(--mist);font-size:10px;padding:0 0 4px 18px;opacity:.8}
#ncrm .rmlo{color:var(--mist);font-size:10px}
#ncrm .rmwait code{color:var(--sky,#8fd0e8);font-size:10px}
#ncrm .rmempty{padding:14px 4px;color:var(--mist);text-align:center}
#ncrm input[type=checkbox]{accent-color:var(--ember);flex:none;cursor:pointer}
#ncrm input[type=checkbox]:disabled{cursor:default}
`;

export function isOpen() { return open; }

export function mount(h, a) {
  api = a;
  if (root) return true;
  if (typeof document === 'undefined') return false;
  const st = document.createElement('style'); st.id = 'ncrm-css'; st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ncrm'; root.style.display = 'none';
  // Delegated and bound once — re-binding per render is how a panel that
  // repaints on a pointer move fires its handler N times.
  root.addEventListener('change', (ev) => {
    const cb = ev.target.closest && ev.target.closest('input[data-layer]'); if (!cb) return;
    layers[cb.dataset.layer] = cb.checked;
    api.onLayers();
  });
  root.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('[data-rmclose]')) api.close(); });
  (document.body || document.documentElement).appendChild(root);
  return true;
}

/* ⚠ THE CHECKBOXES ARE NOT REDRAWN WHILE THE POINTER IS INSIDE THE LEGEND.
   This panel re-renders on every pointer move over the map, and replacing
   innerHTML underneath a player mid-click on a layer row swallows the click —
   the input is destroyed between mousedown and change. `:hover` is a live
   match, so this asks the real question rather than tracking enter/leave and
   getting it wrong when the panel scrolls under a stationary pointer.
   (Copied from /src/water/panel.js, which found this the hard way.) */
export function render(st) {
  if (!root || !open) return;
  let hot = false;
  try {
    hot = !!root.querySelector('.rmrow:hover') ||
          !!(document.activeElement && root.contains(document.activeElement));
  } catch (e) { hot = false; }
  if (hot) return;
  root.innerHTML = html(st);
}

export function show(st) { if (!root) return; open = true; root.style.display = ''; render(st); }
export function hide() { if (!root) return; open = false; root.style.display = 'none'; }

export { fieldForRes };
