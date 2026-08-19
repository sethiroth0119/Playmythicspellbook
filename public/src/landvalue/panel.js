/* ════════════════════════════════════════════════════════════════════════════
   🏷 THE LAND VALUE INFO VIEW.
   ----------------------------------------------------------------------------
   Built to the SAME grammar as /src/power/panel.js and /src/water/panel.js on
   purpose, so the three info views read as one application rather than as three
   features:

     1. EVERY METER IS A STATIC GRADIENT WITH A MOVING MARKER. A bar that
        recolours itself makes the player re-learn the scale every time.
     2. THE LEGEND IS NOT A KEY, IT IS THE OVERLAY CONTROL. Every row has a
        checkbox that turns that layer on in the world.
     3. STATE IS A METER WITH A SIGNED CAUSAL LIST, NEVER A RAW NUMBER
        (BAR.md rubric 12).

   …and the one thing this panel has that neither of the other two does: THE
   LADDER ITSELF. "Land value 214 ₵" cannot tell a player what to do. "Prime —
   47 tiles — takes Club, Restaurant, Player Shop, Duel Arena" tells them what
   their own map will build, which is the only reading that leads to an action.

   🔴 THE PANEL'S OWN CSS IS SCOPED AND INJECTED FROM HERE, not added to
      index.html — every rule is prefixed `#nclv` so nothing can collide, and
      the colours are node-city's own custom properties.

   ⚠ IT DOCKS ON THE LEFT, BELOW /src/water's. All three info views can be open
     at once and a player comparing a plume against the land value under it is
     doing exactly what this batch is for.
   ════════════════════════════════════════════════════════════════════════════ */

import { LV } from './tuning.js';
import { BANDS } from './bands.js';

let root = null, open = false, api = null;

/* `need` names a capability the row depends on. A row whose capability is
   absent renders DISABLED and names the global it is waiting for, and can never
   be switched on — the anti-fallback rule /src/power/panel.js states: a layer
   that draws something plausible when its data source is missing is
   indistinguishable from a working feature and would have to be un-taught. */
export const LAYERS = [
  { id: 'bands', group: 'terrain', label: 'Land value bands', ramp: true },
  { id: 'poison', group: 'terrain', label: 'Pollution discount', sw: 'poison', need: 'MythicPollution' },
  { id: 'stops', group: 'building', label: 'Served transit stops', sw: 'stop', need: 'MythicTransit' },
];
const GROUP_LABEL = { terrain: 'Terrain color', building: 'Building color' };

/* Default-on is the story the panel is named after. An info view that lights
   every layer at once is a colour soup and its first read says nothing. */
export const layers = { bands: true, poison: true, stops: false };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();

function meter(t, label) {
  const p = Math.max(0, Math.min(1, Number(t) || 0));
  const stops = LV.col.band.map((c, i) => c + ' ' + ((i / LV.col.band.length) * 100).toFixed(1) + '%,' +
                                          c + ' ' + (((i + 1) / LV.col.band.length) * 100).toFixed(1) + '%').join(',');
  return '<div class="lvbar" role="meter" aria-valuenow="' + Math.round(p * 100) +
         '" aria-label="' + esc(label || '') + '"><div class="lvfill" style="background:linear-gradient(90deg,' + stops + ')"></div>' +
         '<div class="lvmark" style="left:' + (p * 100).toFixed(1) + '%"></div></div>';
}

/* ── THE SIGNED CAUSAL LIST ────────────────────────────────────────────────
   Built from the SAME per-term decomposition the field computed, never a second
   derivation of it, and the rows sum to the premium exactly. A term whose
   module is absent is printed DIM and named — "no /src/demographics" is a fact
   about the build, and hiding the row would let a missing module look like a
   neighbourhood with no wealthy households in it. */
function causes(terms) {
  if (!terms || !terms.length) return '';
  let h = '<div class="lvcauses">';
  for (const t of terms) {
    if (t.live === false) {
      h += '<div class="lvcause dim"><span class="lvsign">·</span><span class="lvci">' + t.ico + '</span>' +
           '<span class="lvcl">' + esc(t.label) + '</span><span class="lvcv">no module</span></div>';
      continue;
    }
    if (Math.abs(t.v) < 0.5) continue;
    const up = t.v > 0;
    h += '<div class="lvcause"><span class="lvsign ' + (up ? 'up' : 'dn') + '">' + (up ? '+' : '−') + '</span>' +
         '<span class="lvci">' + t.ico + '</span><span class="lvcl">' + esc(t.label) + '</span>' +
         '<span class="lvcv">' + n0(Math.abs(t.v)) + ' ₵</span></div>';
  }
  return h + '</div>';
}

/* ── THE LADDER ────────────────────────────────────────────────────────────
   One row per band: how much of the city is in it, and what it will take. This
   is the whole panel's reason to exist. */
function ladder(s) {
  const hist = (s && s.stats && s.stats.hist) || [0, 0, 0, 0, 0];
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  let h = '<div class="lvsec">THE LADDER<span class="lvsecv">' + n0(total) + ' tiles</span></div>';
  for (let i = BANDS.length - 1; i >= 0; i--) {
    const b = BANDS[i];
    const sets = (s.sets && s.sets[b.id]) || { com: [], off: [], ind: [], res: [] };
    const names = (ids) => ids.map(id => (s.nameOf ? s.nameOf(id) : id));
    const line = [];
    if (sets.com.length) line.push('🛒 ' + names(sets.com).join(' · '));
    if (sets.off.length) line.push('🧠 ' + names(sets.off).join(' · '));
    if (sets.ind.length) line.push('🏭 ' + names(sets.ind).join(' · '));
    const lo = i === 0 ? 0 : Math.round(LV.bandCuts[i - 1] * s.full);
    const hi = i === BANDS.length - 1 ? null : Math.round(LV.bandCuts[i] * s.full);
    h += '<div class="lvband">' +
      '<div class="lvbh"><span class="lvsw" style="background:' + LV.col.band[i] + '"></span>' +
      '<b>' + b.ico + ' ' + esc(b.name) + '</b>' +
      '<span class="lvrange">' + lo + (hi == null ? '+' : '–' + hi) + ' ₵ premium</span>' +
      '<span class="lvcount">' + hist[i] + '</span></div>' +
      '<div class="lvshare"><i style="width:' + ((hist[i] / total) * 100).toFixed(1) + '%;background:' + LV.col.band[i] + '"></i></div>' +
      (line.length
        ? '<div class="lvtenants">' + esc(line.join('   ')) + '</div>'
        : '<div class="lvtenants none">Nothing this city can build wants land at this grade — a plot here stays vacant, and the development run reports it.</div>') +
      (sets.locked && sets.locked.length
        ? '<div class="lvlocked">🔒 ' + esc(names(sets.locked).join(' · ')) + ' — not unlocked yet</div>' : '') +
      (sets.res && sets.res.grades && sets.res.grades.length
        ? '<div class="lvgrades">🏠 suits ' + esc(sets.res.grades.join(', ')) + ' <span class="lvadv">(advice)</span></div>' : '') +
      '</div>';
  }
  return h;
}

function legend(caps) {
  let h = '', group = null;
  for (const L of LAYERS) {
    if (L.group !== group) { group = L.group; h += '<div class="lvgrp">' + GROUP_LABEL[group] + '</div>'; }
    const ok = !L.need || (caps && caps[L.need]);
    h += '<label class="lvrow' + (ok ? '' : ' off') + '"><span class="lvkey">' +
      (L.ramp
        ? '<i class="lvramp" style="background:linear-gradient(90deg,' + LV.col.band.join(',') + ')"></i>'
        : '<i class="lvsw" style="background:' + (LV.col[L.sw] || '#888') + '"></i>') +
      esc(L.label) + '</span>' +
      '<input type="checkbox" data-layer="' + L.id + '"' + (layers[L.id] ? ' checked' : '') +
      (ok ? '' : ' disabled') + '></label>' +
      (ok ? '' : '<div class="lvsub">waiting on <code>window.' + L.need + '</code></div>');
  }
  return h;
}

function header(s) {
  return '<div class="lvhead"><span class="lvtitle">🏷 LAND VALUE</span>' +
    (s && s.stats ? '<span class="lvbadge">mean ' + n0(s.stats.mean) + ' ₵</span>' : '') +
    '<button class="lvx" data-lvclose aria-label="Close">×</button></div>';
}

function html(s, caps) {
  if (!s || !s.ok) {
    return header(s) + '<div class="lvempty">The land value model is not answering.' +
      (s && s.why ? '<br><span class="lvlo">' + esc(s.why) + '</span>' : '') + '</div>' + legend(caps);
  }
  const st = s.stats;
  let h = header(s);
  h += '<div class="lvintro">What a plot is worth is what is AROUND it. The city‑wide part of the number ' +
       '(' + n0(st.city) + ' ₵ here) is the same on every tile and sets the level; the band is taken on the ' +
       'location premium alone, which is the only part that can tell a downtown lot from a suburban one.</div>';

  h += '<div class="lvsec">SPREAD<span class="lvsecv">' + n0(st.min) + ' – ' + n0(st.max) + ' ₵</span></div>';
  h += meter((st.mean - st.city) / Math.max(1, s.full), 'Mean location premium');
  h += '<div class="lvends"><span>Cheapest: <b>' + n0(st.min) + ' ₵</b></span>' +
       '<span>Best: <b class="up">' + n0(st.max) + ' ₵</b></span></div>';

  if (s.terms && s.terms.length) {
    h += '<div class="lvsec">BEST PLOT IN THE CITY<span class="lvsecv">' + esc(s.bestKey || '') + '</span></div>';
    h += causes(s.terms);
  }

  h += ladder(s);

  if (s.flat) {
    h += '<div class="lvnote">Every tile in this city is in one band. That is not a bug — nothing here is ' +
         'separating one plot from another yet. Roads, an arena or a fountain on a corner, shops and a served ' +
         'bus stop within ' + LV.radius + ' tiles are what pull a district up.</div>';
  }
  h += '<div class="lvnote">🏠 The residential lines are <b>advice, not a rule</b>. The zoning tool will not ' +
       'refuse a grade this land does not suit — who moves in is /src/demographics\' model and is deliberately ' +
       'not changed by this layer.</div>';
  h += '<div class="lvsec">OVERLAY</div>' + legend(caps);
  return h;
}

const CSS = `
#nclv{position:absolute;top:calc(var(--topbarh) + 72px);left:260px;z-index:8;width:min(360px,calc(100vw - 300px));
  max-height:calc(100vh - var(--topbarh) - 92px);overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:10px;padding:10px 12px 12px;color:var(--bone);
  font-size:12px;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.55);}
@media (max-width:980px){ #nclv{top:calc(var(--topbarh) + 108px);left:12px;width:min(360px,92vw);z-index:9;
  max-height:calc(100vh - var(--topbarh) - 128px);} }
#nclv::-webkit-scrollbar{width:8px}#nclv::-webkit-scrollbar-thumb{background:var(--edge);border-radius:4px}
#nclv .lvhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#nclv .lvtitle{font-weight:700;letter-spacing:.06em;font-size:13px;flex:1}
#nclv .lvbadge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--sky,#8fd0e8);
  border:1px solid var(--edge);border-radius:4px;padding:1px 5px;white-space:nowrap}
#nclv .lvx{background:none;border:0;color:var(--mist);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
#nclv .lvx:hover{color:var(--bone)}
#nclv .lvintro{color:var(--mist);font-size:11px;margin-bottom:2px}
#nclv .lvsec{display:flex;align-items:baseline;gap:6px;margin:12px 0 5px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--mist);white-space:nowrap}
#nclv .lvsecv{margin-left:auto;color:var(--bone);letter-spacing:0;font-size:11px;
  text-transform:none;font-variant-numeric:tabular-nums}
/* No overflow:hidden on the bar — the marker is taller than the track so it
   reads as a needle, and clipping it hides the pinned readings at either end. */
#nclv .lvbar{position:relative;height:10px;border-radius:5px;background:#0d0b12;border:1px solid var(--edge)}
#nclv .lvfill{position:absolute;inset:0;opacity:.85;border-radius:4px}
#nclv .lvmark{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:var(--bone);
  border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
#nclv .lvends{display:flex;justify-content:space-between;gap:8px;margin-top:4px;color:var(--mist);font-size:11px}
#nclv .lvends b{color:var(--bone);font-weight:600}#nclv .lvends b.up{color:var(--valid)}
#nclv .lvcauses{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#nclv .lvcause{display:flex;align-items:center;gap:6px;padding:1.5px 0}
#nclv .lvcause.dim{opacity:.5}
#nclv .lvsign{width:9px;text-align:center;font-weight:700}
#nclv .lvsign.up{color:var(--valid)}#nclv .lvsign.dn{color:var(--invalid)}
#nclv .lvci{width:14px;text-align:center}
#nclv .lvcl{flex:1;color:var(--bone);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nclv .lvcv{color:var(--mist);font-variant-numeric:tabular-nums}
#nclv .lvband{border-top:1px solid var(--edge);padding:6px 0 5px}
#nclv .lvbh{display:flex;align-items:center;gap:6px}
#nclv .lvbh b{font-weight:600}
#nclv .lvrange{margin-left:auto;color:var(--mist);font-size:10px;font-variant-numeric:tabular-nums;white-space:nowrap}
#nclv .lvcount{width:34px;text-align:right;color:var(--bone);font-variant-numeric:tabular-nums}
#nclv .lvshare{height:4px;border-radius:2px;background:#0d0b12;margin:4px 0 4px;overflow:hidden}
#nclv .lvshare i{display:block;height:100%;opacity:.9}
#nclv .lvtenants{color:var(--mist);font-size:10.5px;line-height:1.45}
#nclv .lvtenants.none{opacity:.7;font-style:italic}
#nclv .lvlocked{color:#e0a060;font-size:10px;margin-top:2px}
#nclv .lvgrades{color:var(--mist);font-size:10px;margin-top:2px;opacity:.85}
#nclv .lvadv{opacity:.7}
#nclv .lvnote{margin-top:8px;font-size:11px;color:var(--mist);background:rgba(79,216,232,.06);
  border-left:2px solid var(--edge);padding:4px 7px;border-radius:0 4px 4px 0}
#nclv .lvgrp{margin:9px 0 3px;font-size:10px;color:var(--mist);opacity:.75;letter-spacing:.05em}
#nclv .lvrow{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
#nclv .lvrow.off{opacity:.42;cursor:default}
#nclv .lvkey{flex:1;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nclv .lvsw{width:10px;height:10px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5);display:inline-block}
#nclv .lvramp{display:inline-block;width:58px;height:7px;border-radius:3px;flex:none}
#nclv .lvsub{display:flex;align-items:center;gap:5px;padding:1px 0 3px 18px;color:var(--mist);font-size:10px}
#nclv .lvsub code{color:var(--sky,#8fd0e8);font-size:10px}
#nclv .lvlo{color:var(--mist);font-size:10px}
#nclv .lvempty{padding:14px 4px;color:var(--mist);text-align:center}
#nclv input[type=checkbox]{accent-color:var(--ember);flex:none;cursor:pointer}
#nclv input[type=checkbox]:disabled{cursor:default}
`;

export function isOpen() { return open; }

export function mount(a) {
  api = a;
  if (root) return;
  const st = document.createElement('style'); st.id = 'nclv-css'; st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'nclv'; root.style.display = 'none';
  // Delegated and bound once — re-binding per render is how a panel that
  // repaints on a timer fires its handler N times.
  root.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-layer]'); if (!cb) return;
    layers[cb.dataset.layer] = cb.checked;
    api.onLayers();
  });
  root.addEventListener('click', (ev) => { if (ev.target.closest('[data-lvclose]')) api.close(); });
  (document.body || document.documentElement).appendChild(root);
}

/* ⚠ THE CHECKBOXES ARE NOT REDRAWN WHILE THE POINTER IS INSIDE THE LEGEND.
   Replacing innerHTML underneath a player mid-click on a layer row swallows the
   click — the input is destroyed between mousedown and change. `:hover` is a
   live match, so this asks the real question rather than tracking enter/leave
   and getting it wrong when the panel scrolls under a stationary pointer. */
export function render(s, caps) {
  if (!root || !open) return;
  let hot = false;
  try { hot = !!root.querySelector('.lvrow:hover') || !!(document.activeElement && root.contains(document.activeElement)); }
  catch (e) { hot = false; }
  if (hot) return;
  root.innerHTML = html(s, caps);
}

export function show(s, caps) { if (!root) return; open = true; root.style.display = ''; render(s, caps); }
export function hide() { if (!root) return; open = false; root.style.display = 'none'; }
