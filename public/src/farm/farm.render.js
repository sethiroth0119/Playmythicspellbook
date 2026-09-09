/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the side panel (HTML) beside the 3D homestead.
   ----------------------------------------------------------------------------
   Render functions return HTML strings; index.js owns the DOM, the delegated
   click handler and the scene. No number in here is economic — every price,
   rate and yield is read from FARM_ECON / state at render time.
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, RECIPE_LABELS, animalDef, buildingDef, buildingCostAt } from './farm.data.js';
import { isAdult, animalsOf } from './farm.state.js';

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
.farm-body{display:flex;flex:1;min-height:0}
.farm-stage{flex:1;min-width:0;position:relative;background:#1a2233}
.farm-stage .farm-hint{position:absolute;left:10px;bottom:8px;font-size:.72rem;color:#c9c3b6;background:rgba(8,10,16,.55);padding:3px 8px;border-radius:5px;pointer-events:none}
.farm-panel{width:min(420px,46vw);min-width:300px;overflow:auto;background:#10141d;border-left:1px solid #2a3140;display:flex;flex-direction:column}
.farm-tabs{display:flex;border-bottom:1px solid #2a3140;position:sticky;top:0;background:#10141d;z-index:2}
.farm-tab{flex:1;padding:9px 6px;background:none;border:none;border-bottom:2px solid transparent;color:#9aa3b5;cursor:pointer;font-size:.82rem;letter-spacing:.03em}
.farm-tab.is-active{color:#f2d98a;border-bottom-color:#d4af37}
.farm-cards{padding:10px;display:flex;flex-direction:column;gap:10px}
.farm-card{background:#151b26;border:1px solid #2a3140;border-radius:8px;padding:10px;border-left:3px solid var(--accent,#d4af37)}
.farm-card.is-focus{box-shadow:0 0 0 2px #d4af3788}
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
.farm-btn.primary{background:#5a4a1e;border-color:#d4af37;color:#f8e8b0}
.farm-btn.primary:hover:not(:disabled){background:#6e5a24}
.farm-btn.danger{background:#4a1e24;border-color:#b8404a;color:#f8c0c8}
.farm-btn.danger:hover:not(:disabled){background:#5e2630}
.farm-cost{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 8px}
.farm-cost .c{display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 6px;font-size:.75rem;white-space:nowrap}
.farm-cost .c.short{color:#e0556a;border-color:#e0556a66}
.farm-yield{display:flex;gap:4px;flex-wrap:wrap}
.farm-empty{padding:16px;color:#9aa3b5;font-size:.82rem;text-align:center}
.farm-onboard{margin:10px;padding:10px;border:1px dashed #d4af3766;border-radius:8px;font-size:.8rem;color:#e8e2d6;background:#1a1a12}
.farm-onboard b{color:#f2d98a}
.farm-toastline{font-size:.74rem;color:#9aa3b5;margin-top:4px}
@media (max-width:760px){.farm-body{flex-direction:column}.farm-panel{width:auto;min-width:0;max-height:52vh;border-left:none;border-top:1px solid #2a3140}.farm-stage{min-height:42vh}}
`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n | 0).toLocaleString();
const hrs = (h) => !isFinite(h) ? '∞' : (h >= 48 ? Math.round(h / 24) + 'd' : h >= 1 ? Math.round(h) + 'h' : Math.max(0, Math.round(h * 60)) + 'm');

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

export function renderLedger(host) {
  const ids = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'food', 'cloth'];
  return `<span class="farm-chip cinder">🔥 <b>${fmt(host.gems())}</b></span>` + ids.map(id => { const m = host.resMeta(id); return `<span class="farm-chip" title="${esc(m.name)}">${m.icon} <b>${fmt(host.getRes(id))}</b></span>`; }).join('');
}

/* ── Homestead tab: every building, built or not ─────────────────────────── */
export function renderHomestead(host, s, view, focus) {
  const now = Date.now();
  const cards = FARM_BUILDINGS.map(def => {
    const b = s.buildings[def.id];
    const cls = 'farm-card' + (focus === def.id ? ' is-focus' : '');
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
    if (pen) {
      const pct = pen.troughCap ? Math.min(100, Math.round(pen.feed / pen.troughCap * 100)) : 0;
      const ready = now >= pen.readyAt, hasPending = Object.keys(pen.pending).length > 0;
      const wait = ready ? '' : ` (${hrs((pen.readyAt - now) / 3600000)} left)`;
      body = `
        <div class="farm-row"><span class="k">Herd</span><b>${pen.herd}/${pen.capacity}</b><span class="k">· ${pen.adults} grown, ${pen.herd - pen.adults} young</span></div>
        <div class="farm-row"><span class="k">Trough</span><span class="farm-meter"><i class="${pen.feed <= 0 ? 'empty' : pct < 25 ? 'low' : ''}" style="width:${pct}%"></i></span><b>${pen.feed}/${pen.troughCap}</b><span class="k">· ${pen.herd ? hrs(pen.hoursLeft) + ' of feed' : 'no animals'}</span></div>
        <div class="farm-row"><span class="k">Yield</span>${yieldHtml(host, pen.ratePerH, true)}</div>
        <div class="farm-row"><span class="k">Ready</span>${yieldHtml(host, pen.pending)}</div>
        <div class="farm-row">
          <button class="farm-btn" data-fact="feed" data-id="${def.id}" title="Move Animal Feed from your stash into the trough">🌾 Fill trough</button>
          <button class="farm-btn primary" data-fact="collect" data-id="${def.id}" ${(ready && hasPending) ? '' : 'disabled'}>🧺 Collect${wait}</button>
        </div>
        <div class="farm-row">${(def.houses || []).map(sp => { const a = animalDef(sp), e = FARM_ECON.animals[sp]; return `<button class="farm-btn" data-fact="buy" data-id="${sp}" ${pen.herd >= pen.capacity || host.gems() < e.cinder ? 'disabled' : ''}>${a.emoji} Buy ${esc(a.name)} · 🔥${fmt(e.cinder)}</button>`; }).join('')}</div>`;
    } else if (def.role === 'feed') {
      const r = FARM_ECON.feedMillRecipe;
      const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body = `<div class="farm-row"><span class="k">Grind</span>${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="1">Grind ×1</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="5">×5</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="999">Max</button></div>`;
    } else if (def.role === 'slaughter') {
      const mul = 1 + FARM_ECON.butcherBonusPerLevel * (b.level - 1);
      body = `<div class="farm-row"><span class="k">Yield bonus</span><b>+${Math.round((mul - 1) * 100)}%</b><span class="k">· see the Livestock tab to slaughter stock</span></div>
        <div class="farm-row"><button class="farm-btn" data-fact="tab" data-id="livestock">🔪 Open Livestock</button></div>`;
    } else if (def.role === 'craft') {
      const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body = (def.recipes || []).map(rk => { const r = FARM_ECON.recipes[rk]; return `<div class="farm-row"><span class="k">${esc(RECIPE_LABELS[rk] || rk)}</span></div>
        <div class="farm-row">${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="1">Make ×1</button><button class="farm-btn" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="999">Max</button></div>`; }).join('');
    }
    let up = '';
    if (b.level < def.maxLevel) {
      const cost = buildingCostAt(def, b.level + 1);
      up = `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:.78rem;color:#9aa3b5">⬆ Upgrade to level ${b.level + 1}</summary>${costHtml(host, cost)}<button class="farm-btn" data-fact="upgrade" data-id="${def.id}">⬆ Upgrade</button></details>`;
    }
    return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}">
      <h3>${def.emoji} ${esc(def.name)}<span class="lv">Level ${b.level}/${def.maxLevel}</span></h3>
      <p>${esc(def.desc)}</p>${body}${up}</div>`;
  }).join('');
  const onboard = !s.buildings.feedmill
    ? `<div class="farm-onboard"><b>Start here.</b> Build the <b>Feed Mill</b> first — nothing on the homestead eats or produces without Animal Feed. Then put up a pen, buy stock, fill the trough and come back to collect.</div>` : '';
  return onboard + `<div class="farm-cards">${cards}</div>`;
}

function scale(map, mul) { const o = {}; Object.keys(map).forEach(k => { o[k] = Math.round(map[k] * mul); }); return o; }

/* ── Livestock tab: species, buying, slaughter ───────────────────────────── */
export function renderLivestock(host, s, view, focus) {
  const butcher = s.buildings.butcher;
  const cards = FARM_ANIMALS.map(a => {
    const pen = buildingDef(a.pen), penRow = s.buildings[a.pen], e = FARM_ECON.animals[a.id];
    const list = animalsOf(s, a.id), adults = list.filter(isAdult).length;
    const room = penRow ? (pen.capacity(penRow.level) - view.pens.find(p => p.id === a.pen).herd) : 0;
    const sl = FARM_ECON.slaughter[a.id];
    const mul = butcher ? 1 + FARM_ECON.butcherBonusPerLevel * (butcher.level - 1) : 1;
    const per = {}; Object.keys(sl).forEach(k => { per[k] = Math.max(1, Math.round(sl[k] * mul)); });
    const growing = list.filter(x => !isAdult(x)).map(x => Math.max(0, e.growH - x.ageH));
    const nextGrown = growing.length ? Math.min(...growing) : null;
    return `<div class="farm-card ${focus === a.id ? 'is-focus' : ''}" style="--accent:#${(a.colors.accent | 0).toString(16).padStart(6, '0')}" data-fid="${a.id}">
      <h3>${a.emoji} ${esc(a.plural)}<span class="lv">${list.length} owned · ${adults} grown</span></h3>
      <p>${esc(a.desc)}</p>
      <div class="farm-row"><span class="k">Pen</span><b>${pen.emoji} ${esc(pen.name)}</b>${penRow ? `<span class="k">· ${room} free</span>` : '<span class="k" style="color:#e0a060">· not built</span>'}</div>
      <div class="farm-row"><span class="k">Eats</span><b>${e.feedPerH * (a.ground ? FARM_ECON.grazeDiscount : 1)} feed/h</b><span class="k">· grows in ${e.growH} fed hours${nextGrown != null ? ` · next in ${hrs(nextGrown)}` : ''}</span></div>
      <div class="farm-row"><span class="k">Alive gives</span>${yieldHtml(host, FARM_ECON.yieldsPerH[a.id], true)}</div>
      <div class="farm-row"><span class="k">Slaughter gives</span>${yieldHtml(host, per)}</div>
      <div class="farm-row">
        <button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="1" ${!penRow || room < 1 || host.gems() < e.cinder ? 'disabled' : ''}>Buy 1 · 🔥${fmt(e.cinder)}</button>
        <button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="${Math.max(1, room)}" ${!penRow || room < 2 || host.gems() < e.cinder * room ? 'disabled' : ''}>Fill pen (${Math.max(0, room)}) · 🔥${fmt(e.cinder * Math.max(0, room))}</button>
      </div>
      <div class="farm-row">
        <button class="farm-btn danger" data-fact="slaughter" data-id="${a.id}" data-n="1" ${!butcher || adults < 1 ? 'disabled' : ''}>🔪 Slaughter 1</button>
        <button class="farm-btn danger" data-fact="slaughter" data-id="${a.id}" data-n="${adults}" ${!butcher || adults < 2 ? 'disabled' : ''}>🔪 Slaughter all grown (${adults})</button>
        ${!butcher ? '<span class="farm-toastline">Needs the Butcher\'s Block.</span>' : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="farm-cards">${cards}</div>`;
}

export function renderShell(sub) {
  return `<div class="farm-page">
    <div class="farm-top">
      <button class="farm-back" data-fact="back">← Camp</button>
      <div><h1>🐄 Homestead Farm</h1><div class="farm-sub">${esc(sub || 'Raise stock, feed it, collect what it gives — and send it to the block when it is grown.')}</div></div>
      <div class="farm-ledger" data-farm="ledger"></div>
    </div>
    <div class="farm-body">
      <div class="farm-stage" data-farm="stage"><div class="farm-hint">Drag to orbit · wheel / pinch to zoom · tap a building or animal</div></div>
      <div class="farm-panel">
        <div class="farm-tabs">
          <button class="farm-tab is-active" data-fact="tab" data-id="homestead">🏡 Homestead</button>
          <button class="farm-tab" data-fact="tab" data-id="livestock">🐑 Livestock</button>
        </div>
        <div data-farm="panel"></div>
      </div>
    </div>
  </div>`;
}
