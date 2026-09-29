/* ════════════════════════════════════════════════════════════════════════════
   🏭 PRODUCTION UI — the blueprint list and the placed-building panel.
   ----------------------------------------------------------------------------
   Two rules drive every choice here:
     1. A cost shows EVERY leg, with its RESOURCES icon and colour, shortfalls
        in red (§2 UI). See costHtml() in cost.js.
     2. A halted building SAYS WHY, in the card, in words. An invisible halt
        reads as a bug and this project has shipped that mistake before.
   ════════════════════════════════════════════════════════════════════════════ */

import { CITY_PRODUCTION, cityProdDef } from './production.data.js';
import { buildingCostAt, canAfford, costHtml } from './cost.js';
import { placed, pending, haltState, cityBudget, storageState, HALT } from './production.state.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const PRODUCTION_CSS = `
.cprod-wrap{display:flex;flex-direction:column;gap:14px;font-family:inherit}
.cprod-vitals{display:flex;flex-wrap:wrap;gap:8px}
.cprod-vital{flex:1 1 120px;padding:8px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;background:linear-gradient(180deg,#0c1118,#070a0f)}
.cprod-vital b{display:block;font-family:'Cinzel',serif;font-size:1.05rem;color:#ffd166}
.cprod-vital span{font-size:0.72rem;letter-spacing:0.08em;opacity:0.7;text-transform:uppercase}
.cprod-vital.is-bad b{color:#e0556a}
.cprod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.cprod-card{border:1px solid rgba(255,255,255,0.12);border-left:3px solid var(--acc,#d4af37);border-radius:6px;padding:10px 12px;background:linear-gradient(180deg,#0c1118,#070a0f)}
.cprod-card h4{margin:0 0 2px;font-family:'Cinzel',serif;font-size:0.98rem;color:var(--acc,#ffd166)}
.cprod-desc{font-size:0.78rem;opacity:0.72;line-height:1.5;margin-bottom:6px}
.cprod-io{font-size:0.76rem;line-height:1.7;margin:4px 0}
.cprod-io em{font-style:normal;opacity:0.6;letter-spacing:0.06em;font-size:0.68rem;text-transform:uppercase;margin-right:4px}
.cprod-cost{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;margin:2px 4px 2px 0;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;white-space:nowrap;font-size:0.78rem}
.cprod-cost strong{font-weight:700}
.cprod-cost-n{opacity:0.85}
.cprod-cost-have{opacity:0.9;font-size:0.9em}
.cprod-cost.is-short{background:rgba(224,85,106,0.10)}
/* 🛑 The halt banner is deliberately loud. A stopped building that looks the
   same as a running one is the single most common "the game is broken" report. */
.cprod-halt{margin-top:6px;padding:6px 8px;border-radius:4px;font-size:0.78rem;line-height:1.5;
  background:rgba(224,85,106,0.12);border:1px solid rgba(224,85,106,0.45);color:#ffb3c0}
.cprod-halt.is-warn{background:rgba(255,194,74,0.10);border-color:rgba(255,194,74,0.45);color:#ffd79a}
.cprod-halt.is-ok{background:rgba(154,209,122,0.10);border-color:rgba(154,209,122,0.40);color:#bfe6a8}
.cprod-fix{display:block;margin-top:3px;opacity:0.85;font-size:0.74rem}
.cprod-btn{margin-top:8px;padding:5px 10px;border-radius:4px;cursor:pointer;font:inherit;font-size:0.8rem;
  background:transparent;border:1px solid var(--acc,#d4af37);color:var(--acc,#d4af37)}
.cprod-btn[disabled]{opacity:0.4;cursor:not-allowed;border-color:#555;color:#777}
.cprod-note{font-size:0.76rem;opacity:0.75;line-height:1.6;padding:8px 10px;border-radius:5px;
  border:1px dashed rgba(212,175,55,0.4);background:rgba(212,175,55,0.06);color:#e7d6a2}
`;

function ioLine(host, map, label, lvl) {
  if (!map || !Object.keys(map).length) return '';
  const parts = Object.keys(map).map(k => {
    const m = host.resMeta(k);
    return `<span style="color:${m.color || '#cfd6e4'}">${m.icon} ${(map[k] | 0) * (lvl || 1)} ${esc(m.name)}</span>`;
  }).join(' · ');
  return `<div class="cprod-io"><em>${label}</em>${parts}</div>`;
}

function drawLine(d) {
  if (!d) return '';
  const bits = [];
  if (d.power) bits.push(`⚡${d.power}`);
  if (d.water) bits.push(`💧${d.water}`);
  if (d.workers) bits.push(`👷${d.workers}`);
  if (d.pollution) bits.push(`☁${d.pollution}`);
  if (d.heat) bits.push(`🌡+${d.heat}`);
  if (d.fireRisk === 'high') bits.push('<span style="color:#e0556a">🔥 fire risk</span>');
  return bits.length ? `<div class="cprod-io"><em>draw</em>${bits.join(' · ')}</div>` : '';
}

/* The city's three budgets, up top, so a halt further down is already explained
   by the time the player reads it. */
export function renderVitals(host) {
  const b = cityBudget(host);
  const st = storageState(host);
  const cell = (label, val, bad) => `<div class="cprod-vital${bad ? ' is-bad' : ''}"><b>${val}</b><span>${label}</span></div>`;
  return `<div class="cprod-vitals">
    ${cell('Power free', `${b.powerFree}⚡`, b.powerFree < 0)}
    ${cell('Crew free', `${b.workersFree}👷`, b.workersFree < 0)}
    ${cell('Storage', `${st.used.toLocaleString()} / ${st.cap.toLocaleString()}`, st.free <= 0)}
    ${cell('Pollution', `☁${b.pollution}`, b.pollution > 80)}
  </div>`;
}

/* 📦 BLUEPRINTS — catalog order is preserved, which puts the Warehouse first.
   See the comment on CITY_PRODUCTION: without storage every other building
   fills its buffer and stops, and that reads as a bug rather than as a cap. */
export function renderBlueprints(host) {
  const cards = CITY_PRODUCTION.map(def => {
    const cost = buildingCostAt(def, 1);
    const aff = canAfford(host, cost);
    return `<div class="cprod-card" style="--acc:${def.accent}">
      <h4>${def.emoji} ${esc(def.name)}</h4>
      <div class="cprod-desc">${esc(def.desc)}</div>
      ${ioLine(host, def.yields, 'yields', 1)}
      ${ioLine(host, def.inputs, 'burns', 1)}
      ${drawLine(def.draw)}
      <div class="cprod-io"><em>cost</em></div>
      <div>${costHtml(host, cost)}</div>
      <button class="cprod-btn" data-cprod-build="${def.id}" ${aff ? '' : 'disabled'}>🔨 Build</button>
    </div>`;
  }).join('');
  return `<div class="cprod-wrap">
    <div class="cprod-note">📦 <strong>Build the Warehouse first.</strong> Production halts when the stash is full —
      without storage every other building fills its buffer and stops.</div>
    ${renderVitals(host)}
    <div class="cprod-grid">${cards}</div>
  </div>`;
}

/* 🏭 PLACED BUILDINGS — every card states its status in words. */
export function renderPlaced(host) {
  const rows = placed(host);
  if (!rows.length) {
    return `<div class="cprod-wrap"><div class="cprod-note">No production buildings yet. Open the blueprints and start with the Warehouse.</div></div>`;
  }
  const cards = rows.map(p => {
    const def = cityProdDef(p.defId); if (!def) return '';
    const pend = pending(host, p);
    const halt = pend.halt || haltState(host, p);
    const cls = halt.code === HALT.NONE ? 'is-ok' : (halt.code === HALT.BROWNOUT ? 'is-warn' : '');
    const banked = Object.keys(pend.gain || {}).map(k => {
      const m = host.resMeta(k);
      return `<span style="color:${m.color || '#cfd6e4'}">${m.icon} ${pend.gain[k]}</span>`;
    }).join(' · ');
    const up = (p.level < def.maxLevel) ? buildingCostAt(def, p.level + 1) : null;
    return `<div class="cprod-card" style="--acc:${def.accent}">
      <h4>${def.emoji} ${esc(def.name)} · Lv ${p.level}/${def.maxLevel}</h4>
      ${ioLine(host, def.yields, 'yields', p.level)}
      ${ioLine(host, def.inputs, 'burns', p.level)}
      <div class="cprod-halt ${cls}">${esc(halt.reason)}
        ${halt.fix ? `<span class="cprod-fix">→ ${esc(halt.fix)}</span>` : ''}</div>
      ${pend.cappedByTime ? `<div class="cprod-halt is-warn">⏳ ACCRUAL CAP — this building stopped banking at ${host.accrualCapH}h. Collect more often.</div>` : ''}
      ${pend.clipped ? `<div class="cprod-halt is-warn">📦 Output was clipped to the space left in the stash.</div>` : ''}
      ${/* 🔴 The panel used to render "banked 270 (6 cycles)" with Collect
            enabled while collect() answered "Not enough Water — need 180, have
            40". pending() now clamps cycles to what the inputs fund, and this
            line states the reason instead of leaving a shrunken number
            unexplained. */''}
      ${pend.inputLimited ? `<div class="cprod-halt is-warn">🧪 INPUTS SHORT — only ${pend.cycles} cycle${pend.cycles === 1 ? '' : 's'} of inputs are in the stash. The rest keeps accruing until you have more.</div>` : ''}
      ${banked ? `<div class="cprod-io"><em>banked</em>${banked} <span style="opacity:0.6">(${pend.cycles} cycle${pend.cycles === 1 ? '' : 's'})</span></div>` : ''}
      <button class="cprod-btn" data-cprod-collect="${p.id}" ${pend.cycles ? '' : 'disabled'}>📥 Collect</button>
      ${up ? `<div class="cprod-io" style="margin-top:8px"><em>upgrade to Lv ${p.level + 1}</em></div>
        <div>${costHtml(host, up)}</div>
        <button class="cprod-btn" data-cprod-upgrade="${p.id}" ${canAfford(host, up) ? '' : 'disabled'}>⬆ Upgrade</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="cprod-wrap">${renderVitals(host)}<div class="cprod-grid">${cards}</div></div>`;
}
