/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the side panel (HTML) beside the 3D homestead.
   ----------------------------------------------------------------------------
   Render functions return HTML strings; index.js owns the DOM, the delegated
   click handler and the scene. No number in here is economic — every price,
   rate and yield is read from FARM_ECON / state at render time.
   Tabs: Homestead (buildings) · Livestock (every animal) · Journal (events,
   weather, season, town demand, stats) · Athena (the look editor).
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, FARM_LOOKS, RECIPE_LABELS, animalDef, buildingDef, buildingCostAt } from './farm.data.js';
import { uncrateCost, shipFee, carrierById } from './farm.state.js';
import { ranchView } from './farm.cloud.js';
import { ageLabel } from './farm.events.js';

export const FARM_CSS = `
.farm-page{position:relative;display:flex;flex-direction:column;height:100dvh;min-height:100vh;background:#0c0f16;color:#e8e2d6;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.farm-top{display:flex;align-items:center;gap:10px;padding:8px 12px;background:linear-gradient(180deg,#151a25,#0f131b);border-bottom:1px solid #2a3140;flex-wrap:wrap}
.farm-top h1{font-size:1.05rem;margin:0;letter-spacing:.04em;color:#f2d98a}
.farm-top .farm-sub{font-size:.75rem;color:#9aa3b5}
.farm-back{background:#1d2431;border:1px solid #3a4457;color:#e8e2d6;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.85rem}
.farm-back:hover{background:#27303f}
.farm-ledger{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.farm-chip{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:2px 7px;font-size:.78rem;white-space:nowrap}
.farm-chip b{font-weight:700;color:#fff}
.farm-chip.cinder{border-color:#d4af3766;color:#f2d98a}
.farm-chip.wx{border-color:#7fd6ff55}
.farm-body{display:flex;flex:1;min-height:0}
.farm-stage{flex:1;min-width:0;position:relative;background:#1a2233}
.farm-stage .farm-hint{position:absolute;left:10px;bottom:8px;font-size:.72rem;color:#c9c3b6;background:rgba(8,10,16,.55);padding:3px 8px;border-radius:5px;pointer-events:none}
.farm-stage .farm-banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(8,10,16,.8);border:1px solid #d4af37aa;color:#f4efe4;padding:8px 14px;border-radius:8px;font-size:.85rem;max-width:80%;text-align:center;pointer-events:none;animation:farmBanner .5s ease-out}
@keyframes farmBanner{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
.farm-panel{width:min(440px,46vw);min-width:300px;overflow:auto;background:#10141d;border-left:1px solid #2a3140;display:flex;flex-direction:column}
.farm-tabs{display:flex;border-bottom:1px solid #2a3140;position:sticky;top:0;background:#10141d;z-index:2}
.farm-tab{flex:1;padding:9px 2px;background:none;border:none;border-bottom:2px solid transparent;color:#9aa3b5;cursor:pointer;font-size:.78rem;letter-spacing:.03em;white-space:nowrap}
.farm-tab.is-active{color:#f2d98a;border-bottom-color:#d4af37}
.farm-cards{padding:10px;display:flex;flex-direction:column;gap:10px}
.farm-card{background:#151b26;border:1px solid #2a3140;border-radius:8px;padding:10px;border-left:3px solid var(--accent,#d4af37)}
.farm-card.is-focus{box-shadow:0 0 0 2px #d4af3788}
.farm-card.is-damaged{border-color:#e0556a88;background:#1c1418}
.farm-card h3{margin:0 0 3px;font-size:.95rem;display:flex;align-items:center;gap:6px}
.farm-card h3 .lv{margin-left:auto;font-size:.72rem;color:#9aa3b5;font-weight:400}
.farm-card p{margin:0 0 8px;font-size:.78rem;color:#b3bccb;line-height:1.35}
.farm-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:5px 0;font-size:.8rem}
.farm-row .k{color:#9aa3b5}
.farm-meter{height:6px;background:#0c0f16;border-radius:3px;overflow:hidden;flex:1;min-width:60px}
.farm-meter i{display:block;height:100%;background:#8fc46a}
.farm-meter i.low{background:#e0a060}.farm-meter i.empty{background:#e0556a}
.farm-btn{background:#1d2431;border:1px solid #3a4457;color:#e8e2d6;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.8rem}
.farm-btn:hover:not(:disabled){background:#27303f}
.farm-btn:disabled{opacity:.45;cursor:not-allowed}
.farm-btn:focus-visible,.farm-tab:focus-visible,.farm-back:focus-visible{outline:2px solid #f2d98a;outline-offset:1px}
.farm-btn.primary{background:#5a4a1e;border-color:#d4af37;color:#f8e8b0}
.farm-btn.primary:hover:not(:disabled){background:#6e5a24}
.farm-btn.danger{background:#4a1e24;border-color:#b8404a;color:#f8c0c8}
.farm-btn.danger:hover:not(:disabled){background:#5e2630}
.farm-btn.tiny{padding:2px 7px;font-size:.72rem}
.farm-cost{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 8px}
.farm-cost .c{display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 6px;font-size:.75rem;white-space:nowrap}
.farm-cost .c.short{color:#e0556a;border-color:#e0556a66}
.farm-yield{display:flex;gap:4px;flex-wrap:wrap}
.farm-empty{padding:16px;color:#9aa3b5;font-size:.82rem;text-align:center}
.farm-onboard{margin:10px;padding:10px;border:1px dashed #d4af3766;border-radius:8px;font-size:.8rem;color:#e8e2d6;background:#1a1a12}
.farm-onboard b{color:#f2d98a}
.farm-toastline{font-size:.74rem;color:#9aa3b5;margin-top:4px}
.farm-select{background:#0c0f16;border:1px solid #3a4457;color:#e8e2d6;border-radius:5px;padding:3px 6px;font-size:.78rem}
.farm-input{background:#0c0f16;border:1px solid #3a4457;color:#e8e2d6;border-radius:5px;padding:4px 7px;font-size:.8rem;min-width:0}
.farm-beast{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;padding:7px 8px;border-top:1px solid #1e2532;font-size:.78rem}
.farm-beast:first-of-type{border-top:none}
.farm-beast.is-sick{background:#1c1418}
.farm-beast .nm{font-weight:700;color:#f4efe4;display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.farm-beast .nm .tag{font-size:.66rem;padding:0 5px;border-radius:3px;background:#2a3140;color:#c9c3b6;font-weight:400}
.farm-beast .nm .tag.prize{background:#5a4a1e;color:#f8e8b0}.farm-beast .nm .tag.rare{background:#2a4a3a;color:#8affd6}.farm-beast .nm .tag.guard{background:#2a3350;color:#a8c0ff}.farm-beast .nm .tag.young{background:#3a3a2a;color:#e8dcc0}
.farm-beast .st{display:flex;gap:8px;flex-wrap:wrap;color:#9aa3b5}
.farm-beast .st b{color:#e8e2d6;font-weight:600}
.farm-beast .hp{display:flex;align-items:center;gap:6px;min-width:120px}
.farm-beast .acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.farm-journal{display:flex;flex-direction:column;gap:6px;padding:0 10px 10px}
.farm-entry{display:grid;grid-template-columns:auto 1fr;gap:8px;padding:7px 9px;background:#151b26;border:1px solid #2a3140;border-radius:6px;font-size:.78rem;line-height:1.35}
.farm-entry .ic{font-size:1.1rem}
.farm-entry .when{color:#9aa3b5;font-size:.7rem;margin-top:2px}
.farm-entry.raid,.farm-entry.wolves,.farm-entry.fox,.farm-entry.hawk,.farm-entry.death{border-left:3px solid #b8404a}
.farm-entry.birth,.farm-entry.gift,.farm-entry.repair,.farm-entry.tend{border-left:3px solid #8fc46a}
.farm-entry.ufo{border-left:3px solid #8affd6}.farm-entry.storm{border-left:3px solid #7fd6ff}.farm-entry.ship,.farm-entry.build{border-left:3px solid #d4af37}
.farm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 10px 10px}
.farm-stat{background:#151b26;border:1px solid #2a3140;border-radius:6px;padding:6px 8px;text-align:center}
.farm-stat b{display:block;font-size:1.1rem;color:#f4efe4;font-variant-numeric:tabular-nums}
.farm-stat span{font-size:.68rem;color:#9aa3b5;letter-spacing:.03em;text-transform:uppercase}
.farm-swatches{display:flex;gap:6px;flex-wrap:wrap}
.farm-swatch{width:34px;height:26px;border-radius:5px;border:2px solid transparent;cursor:pointer;padding:0}
.farm-swatch.is-on{border-color:#f2d98a}
.farm-check{display:inline-flex;align-items:center;gap:5px;font-size:.78rem;background:#1d2431;border:1px solid #3a4457;border-radius:6px;padding:4px 8px;cursor:pointer}
.farm-check.is-on{border-color:#d4af37;color:#f8e8b0}
.farm-roofs{display:grid;grid-template-columns:1fr auto auto;gap:4px 8px;align-items:center;font-size:.78rem}
.farm-beast .nm .tag.ill{background:#4a1e24;color:#f8c0c8}.farm-beast .nm .tag.royal{background:#5a4a1e;color:#ffe08a}.farm-beast .nm .tag.mythic{background:#4a2a5a;color:#e8c0ff}.farm-beast .nm .tag.away{background:#2a3350;color:#a8c0ff}
.farm-ring{background:#0c0f16;border:1px solid #d4af3755;border-radius:8px;padding:8px 10px;margin:6px 0}
.farm-ring .ath{font-style:italic;color:#f2d98a;font-size:.8rem;margin-bottom:6px}
.farm-bid{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;padding:3px 0;border-top:1px solid #1e2532}
.farm-bid:first-of-type{border-top:none}
.farm-bid.you{color:#8affd6}
.farm-coll{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
.farm-coll .b{background:#0c0f16;border:1px solid #2a3140;border-radius:6px;padding:6px 4px;text-align:center;font-size:.68rem;color:#9aa3b5}
.farm-coll .b.on{border-color:#d4af37;color:#f4efe4}
.farm-coll .b i{display:block;width:18px;height:18px;border-radius:50%;margin:0 auto 3px;border:1px solid #0008}
@media (max-width:760px){.farm-body{flex-direction:column}.farm-panel{width:auto;min-width:0;max-height:52vh;border-left:none;border-top:1px solid #2a3140}.farm-stage{min-height:42vh}.farm-beast{grid-template-columns:1fr auto}.farm-beast .hp{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.farm-stage .farm-banner{animation:none}}
`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n | 0).toLocaleString();
const hrs = (h) => !isFinite(h) ? '∞' : (h >= 48 ? Math.round(h / 24) + 'd' : h >= 1 ? Math.round(h) + 'h' : Math.max(0, Math.round(h * 60)) + 'm');
const hex6 = (n) => '#' + (n | 0).toString(16).padStart(6, '0');
const ago = (t) => { const m = Math.max(0, Date.now() - t) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.floor(m) + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago'; };

export function costHtml(host, cost) {
  if (!cost) return '';
  return '<div class="farm-cost">' + Object.keys(cost).map(k => {
    const n = cost[k] | 0; if (!n) return '';
    if (k === 'cinder') return `<span class="c ${host.gems() < n ? 'short' : ''}">🔥 <b>${fmt(n)}</b> Cinder</span>`;
    const m = host.resMeta(k);
    return `<span class="c ${host.getRes(k) < n ? 'short' : ''}" title="${esc(m.name)}">${m.icon} <b>${fmt(n)}</b> ${esc(m.name)}</span>`;
  }).join('') + '</div>';
}
export function yieldHtml(host, map, perH) {
  const keys = Object.keys(map || {}).filter(k => map[k] > 0);
  if (!keys.length) return '<span class="k">—</span>';
  return '<span class="farm-yield">' + keys.map(k => { const m = host.resMeta(k); const v = perH ? (Math.round(map[k] * 100) / 100) + '/h' : fmt(map[k]); return `<span class="c farm-chip" title="${esc(m.name)}">${m.icon} ${v} ${esc(m.name)}</span>`; }).join('') + '</span>';
}
function scale(map, mul) { const o = {}; Object.keys(map).forEach(k => { o[k] = Math.round(map[k] * mul); }); return o; }

export function renderLedger(host, view) {
  const ids = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'livestock', 'food', 'cloth'];
  const wx = view ? `<span class="farm-chip wx" title="Weather until ${new Date(view.weather.until).toLocaleTimeString()}">${view.weather.icon} ${esc(view.weather.label)}</span><span class="farm-chip wx" title="Season">${view.season.icon} ${esc(view.season.label)}</span><span class="farm-chip wx" title="Guard defense (fence adds per pen)">🛡 <b>${Math.round(view.guardDefense)}</b></span>` : '';
  return wx + `<span class="farm-chip cinder">🔥 <b>${fmt(host.gems())}</b></span>` + ids.map(id => { const m = host.resMeta(id); return `<span class="farm-chip" title="${esc(m.name)}">${m.icon} <b>${fmt(host.getRes(id))}</b></span>`; }).join('');
}

/* ── Homestead tab ──────────────────────────────────────────────────────── */
export function renderHomestead(host, s, view, focus, ui) {
  const now = Date.now();
  const cards = FARM_BUILDINGS.map(def => {
    const b = s.buildings[def.id];
    const cls = 'farm-card' + (focus === def.id ? ' is-focus' : '') + (b && b.damaged ? ' is-damaged' : '');
    if (!b) {
      const cost = buildingCostAt(def, 1);
      const affordable = Object.keys(cost).every(k => k === 'cinder' ? host.gems() >= cost[k] : host.getRes(k) >= cost[k]);
      return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}">
        <h3>${def.emoji} ${esc(def.name)}<span class="lv">not built</span></h3>
        <p>${esc(def.desc)}</p>${costHtml(host, cost)}
        <button class="farm-btn primary" data-fact="build" data-id="${def.id}" ${affordable ? '' : 'disabled'}>🔨 Build</button>
      </div>`;
    }
    const pen = view.pens.find(p => p.id === def.id);
    let body = '';
    const prog = view.construction.find(c => c.id === def.id);
    if (prog) {
      const pr = prog.progress;
      body += `<div class="farm-row"><span class="k">${pr.upgrading ? '⬆ Upgrading to level ' + pr.toLevel : '🏗 Under construction'}</span><span class="farm-meter"><i style="width:${pr.pct}%;background:#d4af37"></i></span><b>${hrs(pr.left / 3600000)} left</b></div>
        <div class="farm-row"><button class="farm-btn" data-fact="rush" data-id="${def.id}" ${host.gems() >= prog.rush ? '' : 'disabled'} title="Pay the crews to finish now">⚡ Rush · 🔥${fmt(prog.rush)}</button>${view.builders ? `<span class="k">👷 ${view.builders} Builder${view.builders === 1 ? '' : 's'} · −${Math.round(view.buildersBonus * 100)}% build time</span>` : '<span class="k">Hire Builders on the Employment Board to build faster.</span>'}</div>`;
      if (!pr.upgrading) {
        return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}"><h3>${def.emoji} ${esc(def.name)}<span class="lv">building…</span></h3><p>${esc(def.desc)}</p>${body}</div>`;
      }
    }
    if (b.damaged) body += `<div class="farm-row" style="color:#f8c0c8">🌪 Roof torn off — nothing here produces or breeds until it is repaired.</div>${costHtml(host, FARM_ECON.events.storm.repair)}<div class="farm-row"><button class="farm-btn primary" data-fact="repair" data-id="${def.id}">🔨 Repair</button></div>`;
    if (pen) {
      const pct = pen.troughCap ? Math.min(100, Math.round(pen.feed / pen.troughCap * 100)) : 0;
      const ready = now >= pen.readyAt, hasPending = Object.keys(pen.pending).length > 0;
      const wait = ready ? '' : ` (${hrs((pen.readyAt - now) / 3600000)} left)`;
      const isGuardPost = def.id === 'guardpost';
      body += `
        <div class="farm-row"><span class="k">${isGuardPost ? 'Guards' : 'Herd'}</span><b>${pen.herd}/${pen.capacity}</b><span class="k">· ${pen.adults} grown, ${pen.herd - pen.adults} young${pen.inTransit ? ` · 🚚 ${pen.inTransit} on the road` : ''}</span>${def.id === 'pasture' ? `<span class="k">· ground ${esc(view.terroir.toLowerCase())}</span>` : ''}</div>
        <div class="farm-row"><span class="k">Trough</span><span class="farm-meter"><i class="${pen.feed <= 0 ? 'empty' : pct < 25 ? 'low' : ''}" style="width:${pct}%"></i></span><b>${pen.feed}/${pen.troughCap}</b><span class="k">· ${pen.herd ? hrs(pen.hoursLeft) + ' of feed' : 'no animals'}</span></div>
        <div class="farm-row"><span class="k">Defense</span><b>🛡 ${Math.round(pen.defense * 10) / 10}</b><span class="k">· guards + fence (level ${b.level})</span></div>
        <div class="farm-row"><span class="k">Yield</span>${yieldHtml(host, pen.ratePerH, true)}</div>
        <div class="farm-row"><span class="k">Ready</span>${yieldHtml(host, pen.pending)}</div>
        <div class="farm-row">
          <button class="farm-btn" data-fact="feed" data-id="${def.id}" title="Move Animal Feed from your stash into the trough">🌾 Fill trough</button>
          <button class="farm-btn primary" data-fact="collect" data-id="${def.id}" ${(ready && hasPending) ? '' : 'disabled'}>🧺 Collect${wait}</button>
        </div>
        <div class="farm-row">${(def.houses || []).map(sp => { const a = animalDef(sp), e = FARM_ECON.animals[sp]; const fee = shipFee(carrierById(host, ui && ui.carrier), sp, 1); return `<button class="farm-btn" data-fact="buy" data-id="${sp}" ${pen.herd + pen.inTransit >= pen.capacity || host.gems() < e.cinder + fee ? 'disabled' : ''} title="${esc(a.desc)} · haulage ${fmt(fee)}">${a.emoji} ${esc(a.name)} · 🔥${fmt(e.cinder + fee)}${e.defense ? ' · 🛡' + e.defense : ''}</button>`; }).join('')}</div>
        <div class="farm-toastline">Prices include haulage by ${esc(carrierById(host, ui && ui.carrier).name)} — change the carrier on the Livestock tab.</div>`;
    } else if (def.role === 'feed') {
      const r = FARM_ECON.feedMillRecipe, mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body += `<div class="farm-row"><span class="k">Grind</span>${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="1">Grind ×1</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="5">×5</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="999">Max</button></div>
        ${view.farmers ? `<div class="farm-row"><span class="k">👷 ${view.farmers} Farmer${view.farmers === 1 ? '' : 's'}</span><span>top up troughs from the stash · +${Math.round(view.farmersBonus * 100)}% yield</span></div>` : '<div class="farm-toastline">Hire Farmers on the Employment Board and they will keep the troughs topped up.</div>'}`;
    } else if (def.role === 'slaughter') {
      const mul = 1 + FARM_ECON.butcherBonusPerLevel * (b.level - 1);
      body += `<div class="farm-row"><span class="k">Yield bonus</span><b>+${Math.round((mul - 1) * 100)}%</b><span class="k">· ${b.level >= 2 ? 'trophy cut unlocked' : 'level 2 unlocks the trophy cut'}</span></div>
        <div class="farm-row"><button class="farm-btn" data-fact="tab" data-id="livestock">🔪 Open Livestock</button></div>`;
    } else if (def.role === 'craft') {
      const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body += (def.recipes || []).map(rk => { const r = FARM_ECON.recipes[rk]; return `<div class="farm-row"><span class="k">${esc(RECIPE_LABELS[rk] || rk)}</span></div>
        <div class="farm-row">${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="1">Make ×1</button><button class="farm-btn" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="999">Max</button></div>`; }).join('');
    }
    let up = '';
    if (b.level < def.maxLevel) {
      const cost = buildingCostAt(def, b.level + 1);
      up = `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:.78rem;color:#9aa3b5">⬆ Upgrade to level ${b.level + 1}${def.houses ? ' (bigger pen, stouter fence)' : ''}</summary>${costHtml(host, cost)}<button class="farm-btn" data-fact="upgrade" data-id="${def.id}">⬆ Upgrade</button></details>`;
    }
    return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}">
      <h3>${def.emoji} ${esc(def.name)}<span class="lv">Level ${b.level}/${def.maxLevel}</span></h3>
      <p>${esc(def.desc)}</p>${body}${up}</div>`;
  }).join('');
  const onboard = !s.buildings.feedmill
    ? `<div class="farm-onboard"><b>Start here.</b> Build the <b>Feed Mill</b> first — nothing on the homestead eats or produces without Animal Feed. Then put up a pen, buy stock, fill the trough and come back to collect. Put up a <b>Guard Post</b> before the foxes find you.</div>` : '';
  return onboard + `<div class="farm-cards">${cards}</div>`;
}

/* ── Livestock tab: species cards + every animal ───────────────────────── */
export function renderLivestock(host, s, view, focus, ui) {
  const butcher = s.buildings.butcher;
  const cut = (ui && ui.cut) || 'balanced';
  const cutOpts = Object.keys(FARM_ECON.cuts).map(k => { const c = FARM_ECON.cuts[k]; const locked = !butcher || butcher.level < c.minLevel; return `<option value="${k}" ${k === cut ? 'selected' : ''} ${locked ? 'disabled' : ''}>${esc(c.label)}${locked ? ' (L' + c.minLevel + ')' : ''}</option>`; }).join('');
  const carrier = carrierById(host, ui && ui.carrier);
  const carrierOpts = view.carriers.map(c => `<option value="${c.id}" ${c.id === carrier.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)} · ${Math.round(c.hours * 60)} min · ${c.risk ? Math.round(c.risk * 100) + '% risk' : 'no risk'}${c.insured ? ' · ' + Math.round(c.insured * 100) + '% insured' : ''}${c.feeBase ? ' · from 🔥' + fmt(c.feeBase) : ' · free'}</option>`).join('');
  const roads = view.shipments.length ? view.shipments.map(x => { const a = animalDef(x.sp); return `<div class="farm-row"><span>${a.emoji} ${x.n} ${esc(x.n === 1 ? a.name : a.plural)}</span><span class="farm-meter"><i style="width:${Math.round(x.progress * 100)}%;background:#7fd6ff"></i></span><b>${hrs(Math.max(0, x.arriveAt - Date.now()) / 3600000)}</b><span class="k">· ${esc(x.label)}</span></div>`; }).join('') : '';
  const transport = `<div class="farm-card" style="--accent:#7fd6ff"><h3>🚚 Haulage<span class="lv">${view.shipments.length ? view.shipments.length + ' on the road' : 'nothing on the road'}</span></h3>
    <p>Bought stock is hauled in from market. Pick who drives: cheap and risky, insured, armoured — or your own rig if you own one.</p>
    <div class="farm-row"><select class="farm-select" data-fsel="carrier" style="max-width:100%">${carrierOpts}</select></div>
    <div class="farm-toastline">${esc(carrier.blurb || '')}</div>
    <div class="farm-row"><span class="k">🐕 Escort</span><select class="farm-select" data-fsel="escort"><option value="">none</option>${view.escorts.map(g => `<option value="${g.id}" ${ui && (ui.escort | 0) === g.id ? 'selected' : ''}>${animalDef(g.sp).emoji} ${esc(g.name)} · 🛡${g.defense} · risk ×${Math.max(FARM_ECON.escort.minRiskMul, 1 - g.defense / FARM_ECON.escort.div).toFixed(2)}</option>`).join('')}</select><span class="k">rides with the next order; the pens lose that guard until it is back</span></div>
    ${view.holding.length ? `<div class="farm-row" style="color:#e0a060">🚧 ${view.holding.map(a => esc(a.name)).join(', ')} waiting at the gate — make room in the pen.</div>` : ''}${roads}</div>`;
  const header = transport + `<div class="farm-card" style="--accent:#b8404a"><h3>🔪 The block<span class="lv">${butcher ? 'Level ' + butcher.level : 'not built'}</span></h3>
    <div class="farm-row"><span class="k">Cut</span><select class="farm-select" data-fsel="cut">${cutOpts}</select><span class="k">${esc(cutBlurb(cut))}</span></div>
    <div class="farm-row"><span class="k">Season</span><b>${view.season.icon} ${esc(view.season.label)}</b><span class="k">· meat ×${view.season.meatMul} · breeding ×${view.season.breedMul} · feed ×${view.season.feedMul}</span></div>
    ${host.getRes('livestock') > 0 ? `<div class="farm-row"><span class="k">📦 ${host.getRes('livestock')} crate${host.getRes('livestock') === 1 ? '' : 's'}</span>${FARM_ANIMALS.filter(a => !a.guard).map(a => { const c = uncrateCost(a.id); const pen = s.buildings[a.pen]; return `<button class="farm-btn tiny" data-fact="uncrate" data-id="${a.id}" ${pen && host.gems() >= c.cinder ? '' : 'disabled'} title="1 crate + 🔥${fmt(c.cinder)}">Uncrate ${a.emoji}</button>`; }).join('')}</div>` : ''}
  </div>`;
  const cards = FARM_ANIMALS.map(a => {
    const pen = buildingDef(a.pen), penRow = s.buildings[a.pen], e = FARM_ECON.animals[a.id];
    const list = view.animals.filter(x => x.sp === a.id).sort((x, y) => y.ageH - x.ageH);
    const adults = list.filter(x => x.adult).length;
    const penView = view.pens.find(p => p.id === a.pen);
    const room = penRow && penView ? penView.capacity - penView.herd - penView.inTransit : 0;
    const fee1 = shipFee(carrier, a.id, 1), feeAll = shipFee(carrier, a.id, Math.max(1, room));
    const penReady = !!(penView && penView.ready);
    const sl = FARM_ECON.slaughter[a.id];
    const mul = (butcher ? 1 + FARM_ECON.butcherBonusPerLevel * (butcher.level - 1) : 1);
    const per = {}; if (sl) Object.keys(sl).forEach(k => { per[k] = Math.max(1, Math.round(sl[k] * mul * (k === 'meat' ? FARM_ECON.cuts[cut].meat * view.season.meatMul : k === 'hide' ? FARM_ECON.cuts[cut].hide : FARM_ECON.cuts[cut].other))); });
    const rows = list.map(x => {
      const hpc = x.health < FARM_ECON.health.sickBelow ? 'empty' : x.health < 60 ? 'low' : '';
      const tags = [x.prize ? '<span class="tag prize">🏅 prize</span>' : '', x.breedLabel ? `<span class="tag ${x.tier === 'royal' ? 'royal' : x.tier === 'mythic' ? 'mythic' : 'rare'}">${x.tier === 'mythic' ? '🌟' : x.tier === 'royal' ? '👑' : '✨'} ${esc(x.breedLabel)}</span>` : '', x.guard ? `<span class="tag guard">🛡 ${e.defense}</span>` : '', x.away ? '<span class="tag away">🚚 escorting</span>' : '', !x.adult ? '<span class="tag young">young</span>' : '', x.illLabel ? `<span class="tag ill">🦠 ${esc(x.illLabel)}</span>` : (x.sick ? '<span class="tag ill">sick</span>' : '')].join('');
      const grow = x.adult ? '' : ` · grown in ${hrs(Math.max(0, e.growH - x.grownH))} fed`;
      return `<div class="farm-beast ${x.sick ? 'is-sick' : ''}" data-aid="${x.id}">
        <div class="nm">${a.emoji} ${esc(x.name)}${tags}<button class="farm-btn tiny" data-fact="rename" data-id="${x.id}" title="Rename">✎</button></div>
        <div class="st"><span>⚖ <b>${x.weight} kg</b></span><span>🎂 <b>${ageLabel(x.ageH)}</b>${grow}</span><span class="hp">❤ <span class="farm-meter"><i class="${hpc}" style="width:${Math.round(x.health)}%"></i></span><b>${Math.round(x.health)}</b></span></div>
        <div class="acts">
          ${x.ill ? `<button class="farm-btn tiny primary" data-fact="treat" data-id="${x.id}" ${host.getRes('medicine') >= FARM_ECON.disease.handCure.medicine ? '' : 'disabled'} title="${FARM_ECON.disease.handCure.medicine} medicine → cured">💊 Cure</button>` : x.health < 100 ? `<button class="farm-btn tiny" data-fact="treat" data-id="${x.id}" ${host.getRes('medicine') >= 1 ? '' : 'disabled'} title="1 medicine → +${FARM_ECON.health.treatHeal} health">💊 Treat</button>` : ''}
          ${!x.guard && x.adult && !x.ill && !x.sick && (x.tier || x.prize) && view.auction.ringReady ? `<button class="farm-btn tiny" data-fact="consign" data-id="${x.id}" ${view.auction.open ? '' : 'disabled'} title="Sale Ring · value ${fmt(x.value)}${view.auction.open ? '' : ' · opens ' + new Date(view.auction.next).toLocaleString()}">🏛 Ring</button><button class="farm-btn tiny" data-fact="p2p-post" data-id="${x.id}" title="List for other players (Cinder) · value ${fmt(x.value)}">🌐 List</button>` : ''}
          ${x.adult && !x.sick ? `<button class="farm-btn tiny" data-fact="crate" data-id="${x.id}" title="Crate for the Exchange (1 livestock)">📦</button>` : ''}
          ${!x.guard && x.adult ? `<button class="farm-btn tiny danger" data-fact="slaughter-one" data-id="${x.id}" ${butcher ? '' : 'disabled'} title="To the block">🔪</button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="farm-card ${focus === a.id ? 'is-focus' : ''}" style="--accent:${hex6(a.colors.accent)}" data-fid="${a.id}">
      <h3>${a.emoji} ${esc(a.plural)}<span class="lv">${list.length} owned · ${adults} grown</span></h3>
      <p>${esc(a.desc)}</p>
      <div class="farm-row"><span class="k">Pen</span><b>${pen.emoji} ${esc(pen.name)}</b>${penRow ? (penReady ? `<span class="k">· ${room} free${penView.inTransit ? ' · 🚚 ' + penView.inTransit + ' on the road' : ''}</span>` : '<span class="k" style="color:#e0a060">· under construction</span>') : '<span class="k" style="color:#e0a060">· not built</span>'}</div>
      <div class="farm-row"><span class="k">Eats</span><b>${Math.round(e.feedPerH * view.season.feedMul * (a.ground ? 100 : 100)) / 100} feed/h${a.ground ? ' (grazes)' : ''}</b><span class="k">· grows in ${e.growH} fed hours · ${e.adultWeight} kg grown</span></div>
      ${a.guard ? `<div class="farm-row"><span class="k">Defense</span><b>🛡 ${e.defense}</b><span class="k">· halves when hurt (below ${FARM_ECON.health.guardHalfBelow} health)</span></div>` : `<div class="farm-row"><span class="k">Alive gives</span>${yieldHtml(host, FARM_ECON.yieldsPerH[a.id], true)}</div>
      <div class="farm-row"><span class="k">Slaughter gives</span>${yieldHtml(host, per)}<span class="k">· at grown weight</span></div>`}
      <div class="farm-row">
        <button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="1" ${!penReady || room < 1 || host.gems() < e.cinder + fee1 ? 'disabled' : ''} title="🔥${fmt(e.cinder)} + haulage 🔥${fmt(fee1)} · ${Math.round(carrier.hours * 60)} min">Order 1 · 🔥${fmt(e.cinder + fee1)}</button>
        ${a.guard ? '' : `<button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="${Math.max(1, room)}" ${!penReady || room < 2 || host.gems() < e.cinder * room + feeAll ? 'disabled' : ''} title="one shipment, one haulage fee">Fill pen (${Math.max(0, room)}) · 🔥${fmt(e.cinder * Math.max(0, room) + feeAll)}</button>
        <button class="farm-btn danger" data-fact="slaughter" data-id="${a.id}" data-n="${adults}" ${!butcher || adults < 2 ? 'disabled' : ''}>🔪 All grown (${adults})</button>`}
      </div>
      ${list.length ? `<div style="margin-top:6px;border:1px solid #1e2532;border-radius:6px;overflow:hidden">${rows}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="farm-cards">${header}${cards}</div>`;
}
function cutBlurb(k) {
  return { balanced: 'everything the beast has', meat: 'more meat, half the hide', hide: 'more hide, less meat', trophy: 'less of all, chance of a Memory Shard' }[k] || '';
}

/* ── Journal tab ────────────────────────────────────────────────────────── */
export function renderJournal(host, s, view) {
  const t = view.town;
  const canGive = Object.keys(t.give).every(k => host.getRes(k) >= t.give[k]);
  const stats = view.stats;
  const S = (k, label) => `<div class="farm-stat"><b>${fmt(stats[k])}</b><span>${label}</span></div>`;
  const entries = view.journal.length ? view.journal.map(j => `<div class="farm-entry ${esc(j.kind)}"><div class="ic">${j.icon}</div><div>${esc(j.text)}<div class="when">${ago(j.t)}</div></div></div>`).join('')
    : '<div class="farm-empty">Nothing has happened yet. Stock the pens and the story starts — births, raids, foxes, storms, and the odd light in the sky.</div>';
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#7fd6ff"><h3>${view.weather.icon} ${esc(view.weather.label)} · ${view.season.icon} ${esc(view.season.label)}<span class="lv">ground: ${esc(view.terroir.toLowerCase())}</span></h3>
      <p>${esc(weatherBlurb(view.weather.key))} ${esc(seasonBlurb(view.season.key))}</p>
      <div class="farm-row"><span class="k">Defense</span><b>🛡 ${Math.round(view.guardDefense)}</b><span class="k">from guards · each pen level adds ${FARM_ECON.fenceDefensePerLevel} · raids roll ${FARM_ECON.events.raid.strength[0]}–${FARM_ECON.events.raid.strength[1]}, wolves ${FARM_ECON.events.wolves.strength[0]}–${FARM_ECON.events.wolves.strength[1]}</span></div>
    </div>
    <div class="farm-card" style="--accent:#d4af37"><h3>🏘 Town demand<span class="lv">${t.left}/${FARM_ECON.townDemand.perDay} deliveries left today</span></h3>
      <p>The town posts one want a day and pays in goods, never Cinder.</p>
      <div class="farm-row">${yieldHtml(host, t.give)}<span class="k">→</span>${yieldHtml(host, t.get)}</div>
      <div class="farm-row"><button class="farm-btn primary" data-fact="deliver" ${canGive && t.left > 0 ? '' : 'disabled'}>🚚 Deliver</button></div>
    </div>
  </div>
  <div class="farm-stats">${S('births', 'Births')}${S('slaughtered', 'Butchered')}${S('meat', 'Meat')}${S('raidsRepelled', 'Raids beaten')}${S('raidsLost', 'Raids lost')}${S('predatorsRepelled', 'Predators beaten')}${S('lost', 'Stock lost')}${S('died', 'Died')}${S('returned', 'UFO returns')}${S('shipped', 'Hauled in')}${S('lostInTransit', 'Lost on road')}${S('built', 'Built')}</div>
  <div class="farm-journal">${entries}</div>`;
}
function weatherBlurb(k) {
  return { clear: 'Clear skies. Nothing unusual.', cloud: 'Overcast. The animals do not care.', rain: 'Rain: the grass grows and the pasture trough fills itself a little.', storm: 'Storm: hens stop laying and roofs are at risk.', fog: 'Fog: raiders love it. Defense matters tonight.' }[k] || '';
}
function seasonBlurb(k) {
  return { spring: 'Spring: breeding doubles.', summer: 'Summer: grazing is cheap.', autumn: 'Autumn: the cull season — meat yields +15%, feed a little dearer.', winter: 'Winter: feed costs double and little is born.' }[k] || '';
}

/* ── Athena Editor tab ──────────────────────────────────────────────────── */
export function renderAthena(host, s, view) {
  const L = view.look;
  const grounds = Object.keys(FARM_LOOKS.ground).map(k => { const g = FARM_LOOKS.ground[k]; return `<button class="farm-swatch ${L.ground === k ? 'is-on' : ''}" data-fact="look-ground" data-id="${k}" title="${esc(g.label)}" style="background:linear-gradient(135deg,${hex6(g.a)},${hex6(g.b)})"></button>`; }).join('');
  const skies = Object.keys(FARM_LOOKS.sky).map(k => { const g = FARM_LOOKS.sky[k]; return `<button class="farm-swatch ${L.sky === k ? 'is-on' : ''}" data-fact="look-sky" data-id="${k}" title="${esc(g.label)}" style="background:linear-gradient(180deg,${hex6(g.top)},${hex6(g.bottom)})"></button>`; }).join('');
  const decor = Object.keys(FARM_LOOKS.decor).map(k => `<button class="farm-check ${L.decor[k] ? 'is-on' : ''}" data-fact="look-decor" data-id="${k}">${L.decor[k] ? '☑' : '☐'} ${esc(FARM_LOOKS.decor[k].label)}</button>`).join('');
  const roofs = FARM_BUILDINGS.filter(b => s.buildings[b.id] && b.id !== 'pasture').map(b => `<span>${b.emoji} ${esc(b.name)}</span><input type="color" class="farm-input" data-froof="${b.id}" value="${esc(L.roofs[b.id] || b.accent)}" style="width:44px;height:26px;padding:0"><button class="farm-btn tiny" data-fact="look-roof-reset" data-id="${b.id}" ${L.roofs[b.id] ? '' : 'disabled'}>reset</button>`).join('');
  return `<div class="farm-cards">
    <div class="farm-onboard"><b>Athena Editor.</b> Restyle the homestead. Everything here is cosmetic, saves with your farm, and shows to anyone who visits.</div>
    <div class="farm-card" style="--accent:#f2d98a"><h3>🏷 Name</h3><div class="farm-row"><input class="farm-input" data-fname="1" maxlength="28" value="${esc(L.name)}" placeholder="Name your homestead" style="flex:1"><button class="farm-btn primary" data-fact="look-name">Save</button></div></div>
    <div class="farm-card" style="--accent:#8fc46a"><h3>🌿 Ground</h3><div class="farm-swatches">${grounds}</div><div class="farm-toastline">${esc(FARM_LOOKS.ground[L.ground].label)}</div></div>
    <div class="farm-card" style="--accent:#7fb8ff"><h3>🌅 Sky</h3><div class="farm-swatches">${skies}</div><div class="farm-toastline">${esc(FARM_LOOKS.sky[L.sky].label)} · live weather still paints rain and storm over it</div></div>
    <div class="farm-card" style="--accent:#c08a4a"><h3>🌳 Decor</h3><div class="farm-row">${decor}</div></div>
    <div class="farm-card" style="--accent:#c25a3a"><h3>🏠 Roofs</h3>${roofs ? `<div class="farm-roofs">${roofs}</div><div class="farm-toastline">Pick a colour and it applies at once.</div>` : '<div class="farm-empty">Build something and its roof shows up here.</div>'}</div>
  </div>`;
}

/* ── Market tab: the Sale Ring (NPC + players), contracts, the collection ── */
export function renderMarket(host, s, view, ui, cloud) {
  const now = Date.now();
  const A = view.auction;
  const ring = !A.ringBuilt ? '<div class="farm-empty">Build the Sale Ring to auction prize or bred stock.</div>'
    : !A.ringReady ? '<div class="farm-empty">The Sale Ring is still under construction.</div>'
    : `<div class="farm-row"><span class="k">${A.open ? '🔔 The ring is OPEN' : '🔒 Closed'}</span><span class="k">· ${A.open ? 'consign from the Livestock tab' : 'next sale ' + new Date(A.next).toLocaleString()}</span></div>`;
  const npcLots = view.lots.map(l => {
    const tl = l.timeline; const a = l.animal; const shown = tl.bids.filter(b => b.at <= now);
    const nextBid = tl.bids.find(b => b.at > now);
    const done = tl.hammerAt <= now;
    return `<div class="farm-ring"><div class="ath">🅰 Athena: “${esc(tl.athena)}”</div>
      <div class="farm-row"><b>${animalDef(a.sp).emoji} ${esc(a.name)}</b><span class="k">${esc(a.breed && FARM_ECON.breeds[a.breed] ? FARM_ECON.breeds[a.breed].label : animalDef(a.sp).name)}${a.prize ? ' · 🏅 prize' : ''} · reserve ${fmt(l.reserve)}</span></div>
      ${shown.length ? shown.map(b => `<div class="farm-bid"><span>${esc(b.who)}</span><b>${fmt(b.amount)}</b></div>`).join('') : '<div class="farm-bid"><span class="k">The regulars are looking it over…</span></div>'}
      <div class="farm-toastline">${done ? 'Hammer down — paid in goods, see the Journal.' : nextBid ? `Next bid in ${hrs((nextBid.at - now) / 3600000)} · hammer in ${hrs((tl.hammerAt - now) / 3600000)}` : `Hammer in ${hrs((tl.hammerAt - now) / 3600000)}`}</div></div>`;
  }).join('');
  const C = cloud || {};
  const me = C.userId || null;
  const rows = C.lots || [];
  const lotRow = (l) => {
    const a = l.animal || {}; const ends = new Date(l.ends_at).getTime(); const left = ends - now;
    const isMine = l.seller_id === me, high = l.high_bidder === me;
    const minNext = Math.max(l.min_bid | 0, (l.current_bid | 0) + Math.max(100, Math.floor((l.current_bid | 0) * FARM_ECON.auction.p2p.stepPct)));
    const claimable = (l.status === 'sold' && high && !l.claimed) || (l.status === 'unsold' && isMine && !l.claimed);
    return `<div class="farm-ring" data-lot="${esc(l.id)}">
      <div class="farm-row"><b>${animalDef(a.sp) ? animalDef(a.sp).emoji : '🐾'} ${esc(a.name || '?')}</b><span class="k">${esc(a.breed && FARM_ECON.breeds[a.breed] ? FARM_ECON.breeds[a.breed].label : (animalDef(a.sp) || {}).name || '')}${a.prize ? ' · 🏅' : ''} · ${a.weight ? a.weight + ' kg · ' : ''}seller ${esc(l.seller_name || 'someone')}${isMine ? ' (you)' : ''}</span></div>
      <div class="farm-row"><span class="k">Bid</span><b>🔥${fmt(l.current_bid || l.min_bid)}</b>${high ? '<span class="tag" style="color:#8affd6">you lead</span>' : ''}<span class="k">· ${l.status === 'open' ? (left > 0 ? 'ends in ' + hrs(left / 3600000) : 'ended — settle it') : l.status}</span></div>
      ${l.status === 'open' && left > 0 && !isMine ? `<div class="farm-row"><input class="farm-input" type="number" min="${minNext}" step="100" value="${minNext}" data-fbidamt="${esc(l.id)}" style="width:120px"><button class="farm-btn tiny primary" data-fact="p2p-bid" data-id="${esc(l.id)}">🔨 Bid</button><span class="k">min ${fmt(minNext)} · escrowed from your wallet, refunded if outbid</span></div>` : ''}
      ${l.status === 'open' && left <= 0 ? `<div class="farm-row"><button class="farm-btn tiny" data-fact="p2p-settle" data-id="${esc(l.id)}">⚖ Settle</button></div>` : ''}
      ${claimable ? `<div class="farm-row"><button class="farm-btn tiny primary" data-fact="p2p-claim" data-id="${esc(l.id)}">🚪 ${l.status === 'sold' ? 'Bring it home' : 'Take it back'}</button></div>` : ''}
    </div>`;
  };
  const p2p = C.why ? `<div class="farm-empty">${esc(C.why)}</div>` : (rows.length ? rows.map(lotRow).join('') : '<div class="farm-empty">No player lots open right now.</div>');
  const mineRows = (C.mine || []).filter(l => l.status !== 'open' || !rows.some(r => r.id === l.id));
  const contracts = view.contracts;
  const offerRow = (o) => `<div class="farm-ring"><div class="farm-row">${yieldHtml(host, o.give)}<span class="k">→</span>${yieldHtml(host, o.get)}</div><div class="farm-row"><span class="k">${o.days} days</span><button class="farm-btn tiny primary" data-fact="contract-accept" data-id="${o.id}" ${contracts.active.length >= FARM_ECON.contracts.maxActive ? 'disabled' : ''}>Sign</button></div></div>`;
  const activeRow = (c) => { const can = Object.keys(c.give).every(k => host.getRes(k) >= c.give[k]); const left = c.deadline - now; return `<div class="farm-ring" style="border-color:${left < 86400000 ? '#e0556a88' : '#7fd6ff55'}"><div class="farm-row">${Object.keys(c.give).map(k => { const m = host.resMeta(k); const have = host.getRes(k); return `<span class="c farm-chip" style="${have >= c.give[k] ? 'color:#8affd6' : ''}">${m.icon} ${fmt(have)}/${fmt(c.give[k])}</span>`; }).join('')}<span class="k">→</span>${yieldHtml(host, c.get)}</div><div class="farm-row"><span class="k">${left > 0 ? hrs(left / 3600000) + ' left' : 'overdue'}</span><button class="farm-btn tiny primary" data-fact="contract-deliver" data-id="${c.id}" ${can ? '' : 'disabled'}>🚚 Deliver</button></div></div>`; };
  const tiers = ['rare', 'royal', 'mythic'];
  const coll = tiers.map(tier => { const ks = Object.keys(FARM_ECON.breeds).filter(k => FARM_ECON.breeds[k].tier === tier); const have = ks.filter(k => view.collection[k]).length; return `<div class="farm-row"><span class="k">${tier}</span><b>${have}/${ks.length}</b>${view.collectionRewarded[tier] ? '<span class="tag" style="color:#f2d98a">🏆 rewarded</span>' : `<span class="k">· full set pays ${Object.keys(FARM_ECON.lines.collectionReward[tier]).map(r => FARM_ECON.lines.collectionReward[tier][r] + ' ' + host.resMeta(r).name).join(', ')}</span>`}</div><div class="farm-coll">${ks.map(k => { const B = FARM_ECON.breeds[k]; return `<div class="b ${view.collection[k] ? 'on' : ''}"><i style="background:${hex6(B.color)}"></i>${esc(B.label)}</div>`; }).join('')}</div>`; }).join('');
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#d4af37"><h3>🏛 Sale Ring<span class="lv">${view.lots.length} in the ring</span></h3><p>Prize and bred stock only. The regulars pay in goods; other players pay in Cinder, settled on the server.</p>${ring}${npcLots}</div>
    <div class="farm-card" style="--accent:#8affd6"><h3>🌐 Player lots<span class="lv">${C.loading ? 'loading…' : rows.length + ' open'}</span></h3>
      <div class="farm-row"><button class="farm-btn tiny" data-fact="p2p-refresh">↻ Refresh</button><span class="k">Bids are escrowed; the seller is paid at the hammer less the 2% Foundation Tax.</span></div>
      ${p2p}${mineRows.length ? '<div class="farm-row"><span class="k">Yours</span></div>' + mineRows.map(lotRow).join('') : ''}</div>
    <div class="farm-card" style="--accent:#7fd6ff"><h3>📜 Contracts<span class="lv">rep ${contracts.rep >= 0 ? '+' : ''}${contracts.rep} · ${contracts.demandPerDay}/day demand</span></h3>
      <p>Multi-day orders from the town. Deliver and the daily demand grows; miss one and it shrinks.</p>
      ${contracts.active.length ? '<div class="farm-row"><span class="k">Signed</span></div>' + contracts.active.map(activeRow).join('') : ''}
      ${contracts.offers.length ? '<div class="farm-row"><span class="k">This week\'s offers</span></div>' + contracts.offers.map(offerRow).join('') : '<div class="farm-empty">No more offers this week.</div>'}</div>
    <div class="farm-card" style="--accent:#c0a8ff"><h3>🧬 Bloodlines<span class="lv">${Object.keys(view.collection).length} breeds seen</span></h3><p>Two rare parents can throw a royal; two royals a mythic. Every breed you have ever owned counts.</p>${coll}</div>
  </div>`;
}

/* ── Ranch tab: the corporation's shared pasture ─────────────────────────── */
export function renderRanch(host, view, R) {
  if (!R) return '<div class="farm-empty">Loading the ranch…</div>';
  if (!R.ok) return `<div class="farm-cards"><div class="farm-card" style="--accent:#8fc46a"><h3>🤝 Corp ranch</h3><p>A pasture every member feeds. Your claim is your share of the feed over the last ${FARM_ECON.ranch.shareWindowDays} days.</p><div class="farm-empty">${esc(R.why)}</div></div></div>`;
  const v = ranchView(R.state, R.meta);
  const pct = Math.round(v.feed / v.troughCap * 100);
  const herd = v.herd.map(a => `<div class="farm-beast"><div class="nm">${animalDef(a.sp).emoji} ${esc(a.name)}${a.adult ? '' : '<span class="tag young">young</span>'}</div><div class="st"><span>by <b>${esc(a.by || '?')}</b></span></div><div class="acts">${a.adult ? `<button class="farm-btn tiny danger" data-fact="ranch-butcher" data-id="${a.id}" ${v.share > 0 ? '' : 'disabled'}>🔪</button>` : ''}</div></div>`).join('');
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#8fc46a"><h3>🤝 ${esc(R.corp.name)} ranch<span class="lv">${v.herd.length}/${v.capacity} head</span></h3>
      <p>Everyone feeds it; everyone claims their share. Your share right now: <b>${Math.round(v.share * 100)}%</b> (${fmt(R.meta.my_feed)} of ${fmt(R.meta.all_feed)} feed this week).</p>
      <div class="farm-row"><span class="k">Trough</span><span class="farm-meter"><i class="${v.feed <= 0 ? 'empty' : pct < 25 ? 'low' : ''}" style="width:${pct}%"></i></span><b>${v.feed}/${v.troughCap}</b><span class="k">· ${v.herd.length ? hrs(v.hoursLeft) + ' of feed' : 'no stock'}</span></div>
      <div class="farm-row"><span class="k">Pool</span>${yieldHtml(host, v.pending)}</div>
      <div class="farm-row"><span class="k">Your cut</span>${yieldHtml(host, v.mine)}</div>
      <div class="farm-row"><button class="farm-btn" data-fact="ranch-feed" data-n="60" ${host.getRes('animalFeed') >= 1 ? '' : 'disabled'}>🌾 Add 60 feed</button><button class="farm-btn" data-fact="ranch-feed" data-n="240" ${host.getRes('animalFeed') >= 1 ? '' : 'disabled'}>🌾 Add 240</button><button class="farm-btn primary" data-fact="ranch-claim" ${Object.keys(v.mine).length ? '' : 'disabled'}>🧺 Claim my share</button><button class="farm-btn tiny" data-fact="ranch-refresh">↻</button></div>
      <div class="farm-row">${FARM_ECON.ranch.species.map(sp => { const a = animalDef(sp), e = FARM_ECON.animals[sp]; return `<button class="farm-btn" data-fact="ranch-stock" data-id="${sp}" ${v.herd.length >= v.capacity || host.gems() < e.cinder ? 'disabled' : ''}>${a.emoji} Add ${esc(a.name)} · 🔥${fmt(e.cinder)}</button>`; }).join('')}</div>
      ${herd ? `<div style="margin-top:6px;border:1px solid #1e2532;border-radius:6px;overflow:hidden">${herd}</div>` : '<div class="farm-empty">No stock yet. Add a sheep, goat or cow — it grazes for the whole corporation.</div>'}
    </div>
    <div class="farm-card" style="--accent:#9aa3b5"><h3>📒 Ranch ledger</h3>${(R.meta.ledger || []).length ? (R.meta.ledger || []).slice(0, 15).map(e => `<div class="farm-bid"><span>${esc(e.who || '?')} · ${esc(e.kind)} ${esc(e.resource || '')}</span><b>${fmt(e.amount)}</b></div>`).join('') : '<div class="farm-empty">Nothing yet.</div>'}</div>
  </div>`;
}

export function renderShell(sub) {
  return `<div class="farm-page">
    <div class="farm-top">
      <button class="farm-back" data-fact="back">← Camp</button>
      <div><h1 data-farm="title">🐄 Homestead Farm</h1><div class="farm-sub">${esc(sub || 'Raise stock, feed it, guard it, collect what it gives — and send it to the block when it is grown.')}</div></div>
      <div class="farm-ledger" data-farm="ledger"></div>
    </div>
    <div class="farm-body">
      <div class="farm-stage" data-farm="stage"><div class="farm-hint">Drag to orbit · wheel / pinch to zoom · tap a building or animal</div></div>
      <div class="farm-panel">
        <div class="farm-tabs">
          <button class="farm-tab is-active" data-fact="tab" data-id="homestead">🏡 Homestead</button>
          <button class="farm-tab" data-fact="tab" data-id="livestock">🐑 Livestock</button>
          <button class="farm-tab" data-fact="tab" data-id="market">🏛 Market</button>
          <button class="farm-tab" data-fact="tab" data-id="ranch">🤝 Ranch</button>
          <button class="farm-tab" data-fact="tab" data-id="journal">📜 Journal</button>
          <button class="farm-tab" data-fact="tab" data-id="athena">🅰 Athena</button>
        </div>
        <div data-farm="panel"></div>
      </div>
    </div>
  </div>`;
}
