/* 🧍 THE INFLUENCE TAB — every district in one place, and who to work on.

   Asked for: "add a tab that shows all of the places they are influenced with
   and who they need to work on. Add the influence tab in the camp as well."

   The district panel already tells the player what ONE district thinks of
   them. This is the whole city at a glance: each district with its citizens'
   standing, the band in words, the fuel it pays, who holds it — and a second
   list of the districts that still need work, with the concrete things that
   move the number (the three gains in citizens.js, and nothing invented).

   ONE renderer, two homes. The map's side panel shows it as a tab beside the
   district panel; the Camp's command bar opens the same HTML in an overlay
   (index.html's camp has no module CSS, so this file ships its own). Rows
   carry data-site so either home can jump to the district on the map.

   🔴 READ-ONLY. It reads S.citizens / S.hold and writes nothing — the standing
      moves only through citizens.gain() from the raid and fortify paths. */

import { SITES, SITE_BY_ID, FACTIONS, MISSION_POI } from './poi.js';
import * as S from './state.js';
import * as T from './train.js';
import { CIT_GAIN, CIT_BANDS } from './citizens.js';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function ensureCss() {
  if (document.getElementById('msn-inf-css')) return;
  const s = document.createElement('style'); s.id = 'msn-inf-css';
  s.textContent = `
  .inf{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#c9d2df;font-size:12.5px;line-height:1.5}
  .inf .inf-h{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:#7d8ba0;margin:14px 0 6px}
  .inf .inf-sum{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 6px}
  .inf .inf-sum b{color:#e8edf5;font-variant-numeric:tabular-nums}
  .inf .inf-row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 8px;border:1px solid rgba(120,180,220,.14);background:rgba(255,255,255,.025);margin-bottom:6px;cursor:pointer;border-radius:4px}
  .inf .inf-row:hover{border-color:rgba(127,216,200,.55);background:rgba(127,216,200,.06)}
  .inf .inf-row.cur{border-color:#7fd8c8}
  .inf .inf-n{font-weight:700;color:#e8edf5}
  .inf .inf-n small{font-weight:400;color:#7d8ba0;margin-left:6px}
  .inf .inf-b{text-align:right;color:#7fd8c8;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
  .inf .inf-t{grid-column:1/-1;height:5px;background:rgba(255,255,255,.07);overflow:hidden;border-radius:2px}
  .inf .inf-t i{display:block;height:100%;background:#7fd8c8;box-shadow:0 0 8px #7fd8c8}
  .inf .inf-m{grid-column:1/-1;color:#7d8ba0;font-size:11.5px}
  .inf .inf-m b{color:#c9d2df;font-weight:600}
  .inf .inf-todo{grid-column:1/-1;color:#ffcf6a;font-size:11.5px}
  .inf .inf-empty{color:#7d8ba0;font-style:italic;padding:6px 0}
  .inf .inf-key{display:flex;gap:10px;flex-wrap:wrap;color:#7d8ba0;font-size:11px;margin-top:10px}
  .inf .inf-key span{white-space:nowrap}
  .msn-ptabs{display:flex;border-bottom:1px solid rgba(120,180,220,.2);flex:0 0 auto}
  .msn-ptabs button{flex:1;background:transparent;border:0;border-bottom:2px solid transparent;color:#7d8ba0;font:600 11px/1 inherit;letter-spacing:.16em;text-transform:uppercase;padding:11px 8px;cursor:pointer}
  .msn-ptabs button.on{color:#e8edf5;border-bottom-color:#7fd8c8}
  .msn-ptabs button:hover{color:#e8edf5}`;
  document.head.appendChild(s);
}

/* One district, everything the tab wants to say about it. */
function rowData(site) {
  const c = S.citizens(site.id);
  const h = S.hold(site.id);
  const fac = h.f ? FACTIONS[h.f] : FACTIONS.survivors;
  const poi = MISSION_POI[site.poi] || { icon: '', label: '' };
  let parked = false, reach = false;
  try { parked = T.at() === site.id; reach = T.reaches(site.id); } catch (e) {}
  return { site, c, h, fac, poi, parked, reach, pct: Math.max(0, Math.min(100, Math.round((c.value / c.max) * 100))) };
}

/* The concrete things that raise THIS district, in the order they pay. Pulled
   from the same table the payout uses, so the numbers cannot drift. */
function todoFor(d) {
  const parts = [];
  if (d.h.f) parts.push('survive a raid here (+' + CIT_GAIN.raidSurvived + '), drive ' + d.fac.name + ' out (+' + CIT_GAIN.raidCleared + ' more)');
  else parts.push('raid from here when a faction takes it (+' + CIT_GAIN.raidSurvived + ')');
  if (d.parked) parts.push(d.h.f ? 'fortify once it is clear (+' + CIT_GAIN.fortified + ')' : 'fortify while parked (+' + CIT_GAIN.fortified + ')');
  else parts.push('park ' + T.TRAIN.name + ' here and fortify (+' + CIT_GAIN.fortified + ')');
  return parts.join(' · ');
}

function rowHtml(d, cur, withTodo) {
  return `<div class="inf-row${cur === d.site.id ? ' cur' : ''}" data-site="${esc(d.site.id)}" title="Open ${esc(d.site.name)} on the map">
    <div class="inf-n">${d.poi.icon} ${esc(d.site.name)}<small>${d.h.f ? esc(d.fac.name) + ' · ' + (d.h.g | 0) + '%' : 'Secure'}</small></div>
    <div class="inf-b">${d.c.band.icon} ${esc(d.c.band.name)} · ${d.c.value}/${d.c.max}</div>
    <div class="inf-t"><i style="width:${d.pct}%"></i></div>
    <div class="inf-m">${esc(d.c.band.blurb)}${d.c.fuel ? ' <b>+' + d.c.fuel + ' fuel</b> per run home.' : ''}${d.parked ? ' <b>🚂 Parked here.</b>' : d.reach ? ' In reach.' : ''}</div>
    ${withTodo ? '<div class="inf-todo">→ ' + esc(todoFor(d)) + '</div>' : ''}
  </div>`;
}

/* The tab. `cur` highlights a district; `compact` drops the legend (the map
   panel is narrow). Returns HTML; call bind() on the element it lands in. */
export function influenceHtml(opts) {
  opts = opts || {};
  const cur = opts.cur || null;
  const rows = SITES.map(rowData);
  const byStanding = rows.slice().sort((a, b) => b.c.value - a.c.value || a.site.name.localeCompare(b.site.name));
  const trustedAt = (CIT_BANDS.find(b => b.key === 'trusted') || { at: 45 }).at;
  const work = rows.filter(d => d.c.value < trustedAt).sort((a, b) => a.c.value - b.c.value || a.site.name.localeCompare(b.site.name));
  const backed = rows.filter(d => d.c.fuel > 0).length;
  const total = rows.reduce((n, d) => n + d.c.value, 0);
  const best = byStanding[0];
  return `<div class="inf">
    <div class="inf-sum msn-ui"><span>Standing <b>${total}</b> / ${rows.length * (best ? best.c.max : 100)}</span><span>Backing you <b>${backed}</b> / ${rows.length}</span><span>Need work <b>${work.length}</b></span></div>
    <div class="inf-h msn-ui">Where you stand</div>
    ${byStanding.map(d => rowHtml(d, cur, false)).join('')}
    <div class="inf-h msn-ui">Who to work on</div>
    ${work.length ? work.map(d => rowHtml(d, cur, true)).join('') : '<div class="inf-empty">Every district trusts you or better. Keep coming back alive and they will back you with fuel.</div>'}
    ${opts.compact ? '' : '<div class="inf-key">' + CIT_BANDS.map(b => '<span>' + b.icon + ' ' + esc(b.name) + ' ' + b.at + '+</span>').join('') + '</div>'}
  </div>`;
}

/* Wire the rows. onPick(siteId) is what "go there" means for that home. */
export function bindInfluence(rootEl, onPick) {
  if (!rootEl) return;
  rootEl.querySelectorAll('.inf-row[data-site]').forEach(el => {
    el.onclick = () => { const id = el.getAttribute('data-site'); if (SITE_BY_ID[id] && onPick) onPick(id); };
  });
}
