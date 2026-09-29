/* ════════════════════════════════════════════════════════════════════════════
   🖥 THE FOUNDRY — rendering. CSS + the four panels.
   ----------------------------------------------------------------------------
   🔴 THE BOTTLENECK IS THE UI'S ONE JOB. src/city/production.data.js records
   the lesson this whole screen is built around:

     "Production halts at full storage. A player … watches it fill its buffer and
      stop, which reads as a broken building rather than as a storage cap."

   A Foundry line halts for six different reasons and five of them are the
   player's move to make. So every machine card leads with its halt state in
   plain words, and the line header names the FIRST stalled stage — because in a
   twelve-machine chain the thing you need to know is not "something is wrong",
   it is "the sorter is jammed and everything behind it is idle for that reason".

   ⚠ ALL MARKUP IS BUILT WITH esc() ON ANY VALUE THAT COULD CARRY A NAME. Machine
   and material names are ours today, but admin overrides (Forge.foundry) can
   reach the econ table, and "it is our own data" is exactly the assumption that
   makes an injection bug ship.
   ════════════════════════════════════════════════════════════════════════════ */

import { MATERIALS, matById, matName, matIcon, recipesFor, recipeById, normIn, normOut, TAPS, tapFor } from './recipes.js';
import { MACHINES, machineById, machinesForLine, repairCost, COND_WORN, buildSeconds, fmtDur } from './machines.js';
import {
  HALT, machineState, isBuilt, builtMachines, stockOf, qtyOf,
  storageCap, storageUsed, powerCapacity, powerDemand, machineStatus, nextCost, fuelOnHand, buildInfo,
} from './state.js';
import { FEED_PRICES, FEED_GRADE, CONTRACT_SIZES, DISPOSAL_IDS, feedPrice, contractCost, tapPreview, haulCost } from './taps.js';
import { ratePerHour, STATION_INFO, purposeOf } from './guide.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => Math.floor(Number(x) || 0).toLocaleString();
const pct = (x) => Math.round((Number(x) || 0) * 100) + '%';

export const FOUNDRY_CSS = `
.fdy-wrap{position:fixed;inset:0;z-index:9400;background:#0d0f12;color:#e6e9ef;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.fdy-top{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#14171c;border-bottom:1px solid #262b33;flex:0 0 auto}
.fdy-title{font-weight:700;font-size:16px;letter-spacing:.3px}
.fdy-x{margin-left:auto;background:#20242c;border:1px solid #333a45;color:#cfd6e4;border-radius:8px;padding:6px 12px;cursor:pointer}
.fdy-x:hover{background:#2a2f39}
.fdy-tabs{display:flex;gap:6px;padding:8px 14px;background:#111419;border-bottom:1px solid #222831;flex:0 0 auto;overflow-x:auto}
.fdy-tab{background:#1a1e25;border:1px solid #2b313b;color:#9aa4b4;border-radius:999px;padding:6px 14px;cursor:pointer;white-space:nowrap}
.fdy-tab.on{background:#2b3442;color:#fff;border-color:#3d4756}
.fdy-body{flex:1 1 auto;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch}
.fdy-vitals{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.fdy-v{background:#161a21;border:1px solid #262c36;border-radius:10px;padding:8px 12px;min-width:110px}
.fdy-v b{display:block;font-size:16px;color:#fff}
.fdy-v span{font-size:11px;color:#8d97a8;text-transform:uppercase;letter-spacing:.5px}
.fdy-v.warn{border-color:#8a5a2a;background:#1e1712}
.fdy-v.bad{border-color:#8a3a3a;background:#1e1214}
.fdy-alert{background:#241a12;border:1px solid #7a5324;border-radius:10px;padding:10px 12px;margin-bottom:12px;color:#ffcf8b}
.fdy-alert b{color:#ffd9a0}
.fdy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.fdy-card{background:#161a21;border:1px solid #262c36;border-radius:12px;padding:12px}
.fdy-card.halt{border-color:#6b4a24}
.fdy-card.broke{border-color:#8a3a3a}
.fdy-card h4{margin:0 0 2px;font-size:15px;display:flex;align-items:center;gap:7px}
.fdy-lv{margin-left:auto;font-size:11px;color:#8d97a8;font-weight:400}
.fdy-desc{color:#8d97a8;font-size:12px;margin:4px 0 8px}
.fdy-state{font-size:12px;font-weight:600;margin:6px 0}
.fdy-state.ok{color:#7fd6a0}.fdy-state.warn{color:#ffb86b}.fdy-state.bad{color:#ff8a8a}
.fdy-bar{height:5px;background:#22272f;border-radius:3px;overflow:hidden;margin:6px 0}
.fdy-bar i{display:block;height:100%;background:#5aa9e6}
.fdy-bar i.warn{background:#e0a860}.fdy-bar i.bad{background:#e06a6a}
.fdy-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.fdy-btn{background:#232a34;border:1px solid #333c48;color:#dbe2ee;border-radius:8px;padding:6px 11px;cursor:pointer;font-size:12px}
.fdy-btn:hover{background:#2c3540}
.fdy-btn.pri{background:#2f5d8a;border-color:#3d7ab3;color:#fff}
.fdy-btn.pri:hover{background:#376ca0}
.fdy-btn[disabled]{opacity:.4;cursor:not-allowed}
.fdy-sel{width:100%;background:#1b2027;border:1px solid #2d343f;color:#dbe2ee;border-radius:8px;padding:6px;font-size:12px;margin-top:6px}
.fdy-flow{font-size:11px;color:#8d97a8;margin-top:5px;line-height:1.5}
.fdy-flow b{color:#b9c4d4;font-weight:600}
.fdy-cost{font-size:11px;color:#9aa4b4;margin-top:6px}
.fdy-cost i{font-style:normal;color:#e0c07a}
.fdy-cost .no{color:#e08a8a}
.fdy-trim{background:#161a21;border:1px solid #262c36;border-radius:12px;padding:12px;margin-bottom:14px}
.fdy-trim input{width:100%;margin:8px 0 4px}
.fdy-trim .ends{display:flex;justify-content:space-between;font-size:11px;color:#8d97a8}
.fdy-inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.fdy-i{background:#161a21;border:1px solid #262c36;border-radius:10px;padding:9px 11px;display:flex;align-items:center;gap:9px;min-height:52px}
.fdy-i .ic{font-size:19px}
.fdy-i .nm{flex:1;min-width:0}
.fdy-i .nm b{display:block;font-size:13px;color:#e6e9ef;line-height:1.25;overflow-wrap:anywhere}
.fdy-i .nm span{font-size:11px;color:#8d97a8}
.fdy-i .qt{font-size:15px;font-weight:700;color:#fff}
.fdy-i.liab{border-color:#6b4a24;background:#1b1610}
.fdy-empty{color:#7b8494;text-align:center;padding:26px;font-size:13px}
.fdy-sec{font-size:12px;text-transform:uppercase;letter-spacing:.7px;color:#7b8494;margin:16px 0 8px;font-weight:700}
.fdy-sec:first-child{margin-top:0}
@media(max-width:560px){.fdy-grid{grid-template-columns:1fr}.fdy-body{padding:10px}}

/* The machine briefing — a label column and a value column, so Needs / Makes /
   Burns / Rate line up and can be read down rather than parsed. */
.fdy-brief{margin-top:9px;padding:9px 10px;background:#11151b;border:1px solid #232a33;border-radius:9px}
.fdy-b-row{display:flex;gap:9px;font-size:12px;line-height:1.65;color:#b9c4d4}
.fdy-b-row+.fdy-b-row{margin-top:3px}
.fdy-b-row .k{flex:0 0 46px;color:#7b8494;text-transform:uppercase;font-size:10px;letter-spacing:.7px;padding-top:3px}
.fdy-b-row b{color:#fff}
.fdy-b-row i{font-style:normal;color:#7b8494}
.fdy-b-row .no{color:#e08a8a}
.fdy-brief .fdy-flow{margin-top:6px;padding-top:6px;border-top:1px solid #202730}
.fdy-build{margin-top:9px;padding:9px 10px;background:#101822;border:1px solid #24384d;border-radius:9px}
.fdy-build .fdy-bar i{background:#5aa9e6}
/* What a desk is for, at the top of its own panel. */
.fdy-what{background:#12161d;border:1px solid #252d38;border-radius:11px;padding:11px 13px;margin-bottom:13px}
.fdy-what h3{margin:0 0 3px;font-size:14.5px}
.fdy-what p{margin:0;color:#8d97a8;font-size:12.7px;line-height:1.55}
.fdy-what .tip{margin-top:7px;padding-top:7px;border-top:1px solid #212832;color:#b9a06a;font-size:12.3px}

/* ══ 3D FLOOR CHROME ═══════════════════════════════════════════════════════
   Everything overlaid on the walkable shed. The rule for all of it: the canvas
   is the content, so chrome sits at the edges and never boxes the view in. */
.fdy-3d{position:absolute;inset:0;overflow:hidden;background:#0b0d11}
.fdy-3d canvas{position:absolute;inset:0}
/* Crosshair — a dot, not a reticle. It marks where "forward" is without
   pretending this is a shooter. */
.fdy-x2{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:#ffffff5c;pointer-events:none}
/* The walk-up prompt. Anchored low-centre because that is where the eye already
   is when you are steering, and it must never cover the machine you walked to. */
.fdy-prompt{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);max-width:min(92%,460px);
  background:#12161ceb;border:1px solid #333c48;border-radius:12px;padding:10px 15px;color:#e6e9ef;
  font-size:13.5px;text-align:center;cursor:pointer;display:none;backdrop-filter:blur(7px);
  box-shadow:0 10px 34px #0009}
.fdy-prompt b{display:block;font-size:15px;margin-bottom:2px}
.fdy-prompt .k{display:inline-block;border:1px solid #4a5563;border-radius:5px;padding:0 6px;margin-right:6px;
  font:600 11px/1.6 ui-monospace,monospace;color:#9fb4d8}
.fdy-prompt .st{font-size:12px;color:#8d97a8}
.fdy-prompt .st.warn{color:#ffb86b}.fdy-prompt .st.bad{color:#ff8a8a}.fdy-prompt .st.ok{color:#7fd6a0}
/* Mobile thumb pad. Hidden on pointer:fine — a mouse user has WASD and the pad
   would just eat screen. */
.fdy-pad{position:absolute;left:14px;bottom:14px;display:grid;grid-template-columns:repeat(3,44px);
  grid-template-rows:repeat(2,44px);gap:5px;opacity:.85}
.fdy-pad button{background:#151a21d9;border:1px solid #333c48;color:#cfd6e4;border-radius:9px;font-size:15px;
  touch-action:none;-webkit-user-select:none;user-select:none}
.fdy-pad button:active{background:#2a3340}
.fdy-pad .sp{visibility:hidden}
@media(pointer:fine){.fdy-pad{display:none}}
/* Top-left HUD: the three numbers you steer by, always visible so you never
   have to open a panel to learn the line is browning out. */
.fdy-hud{position:absolute;left:12px;top:12px;display:flex;gap:7px;flex-wrap:wrap;max-width:calc(100% - 24px);pointer-events:none}
.fdy-hud i{background:#11151bd9;border:1px solid #2a323d;border-radius:9px;padding:5px 10px;font-style:normal;font-size:12px;color:#b9c4d4}
.fdy-hud i b{color:#fff;font-weight:700}
.fdy-hud i.bad{border-color:#8a3a3a;color:#ff9a9a}
.fdy-hud i.warn{border-color:#8a5a2a;color:#ffbe80}
/* Mode switch + admin entry, top-right. */
.fdy-modes{position:absolute;right:12px;top:12px;display:flex;gap:6px}
.fdy-modes button{background:#151a21d9;border:1px solid #333c48;color:#cfd6e4;border-radius:9px;padding:6px 11px;font-size:12px;cursor:pointer}
.fdy-modes button:hover{background:#222a34}

/* ══ POP-UP PANEL ══════════════════════════════════════════════════════════
   The whole point of the 3D mode: a panel that ARRIVES when you walk up to a
   machine, rather than a tab strip that is always there. It scales out of the
   middle and dims the shed behind, so the room is still visibly running while
   you work — which is what stops it feeling like the flat UI with a picture
   behind it. */
.fdy-pop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;
  background:#05070ab8;backdrop-filter:blur(3px);z-index:20}
.fdy-pop-in{width:min(760px,100%);max-height:100%;overflow-y:auto;background:#0f1319;border:1px solid #2b333f;
  border-radius:15px;box-shadow:0 26px 70px -12px #000;animation:fdyPop .17s cubic-bezier(.2,.9,.3,1)}
@keyframes fdyPop{from{opacity:0;transform:translateY(12px) scale(.965)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.fdy-pop-in{animation:none}}
.fdy-pop-top{position:sticky;top:0;display:flex;align-items:center;gap:9px;padding:12px 15px;
  background:#131820;border-bottom:1px solid #262e39;border-radius:15px 15px 0 0}
.fdy-pop-top h3{margin:0;font-size:16px;flex:1;min-width:0}
.fdy-pop-top .sub{font-size:12px;color:#8d97a8;font-weight:400}
.fdy-pop-body{padding:14px 15px 17px}
/* Inside a popup a machine card is the ONLY card, so it drops its own frame —
   a card inside a card reads as a mistake. Its <h4> goes too: the popup header
   already names the machine, and printing "Blast Furnace" twice, six lines
   apart, reads as a rendering bug rather than as emphasis. The level moves to
   the header's .sub so nothing is lost with it. */
.fdy-pop-body .fdy-card{border:0;background:transparent;padding:0}
/* ⚠ SCOPED TO .fdy-solo, NOT TO EVERY CARD IN A POPUP. Unscoped, this rule also
   hid the <h4> of every row in the admin model editor — which is where the
   machine's NAME lives — leaving seventeen identical anonymous forms. Only the
   single-machine popup has a header that already says the name. */
.fdy-pop-body .fdy-solo .fdy-card>h4{display:none}
.fdy-pop-body .fdy-grid{grid-template-columns:1fr}
`;

/* Purity → a word, because "0.83" is not a thing a player has an opinion about
   but "Clean" is. Thresholds line up with yieldAtPurity's shape. */
export function gradeLabel(p) {
  if (p >= 0.9) return ['Pristine', '#7fd6a0'];
  if (p >= 0.75) return ['Clean', '#9ad17a'];
  if (p >= 0.55) return ['Fair', '#e0c07a'];
  if (p >= 0.35) return ['Dirty', '#e0a860'];
  return ['Contaminated', '#e06a6a'];
}

function costHtml(h, cost) {
  if (!cost) return '';
  const legs = Object.keys(cost).map(k => {
    const need = cost[k] | 0;
    const have = k === 'cinder' ? h.gems() : h.getRes(k);
    const ok = have >= need;
    const label = k === 'cinder' ? 'Cinder' : (h.resName(k) || k);
    return `<i class="${ok ? '' : 'no'}">${n(need)} ${esc(label)}</i>`;
  });
  return `<div class="fdy-cost">${legs.join(' · ')}</div>`;
}

/* ── Vitals ──────────────────────────────────────────────────────────────── */
export function renderVitals(st, h) {
  const used = storageUsed(st), cap = storageCap(st);
  const cp = powerCapacity(st), dm = powerDemand(st);
  const full = used / Math.max(1, cap);
  const brown = dm > cp;
  return `<div class="fdy-vitals">
    <div class="fdy-v ${full > 0.95 ? 'bad' : full > 0.8 ? 'warn' : ''}"><b>${n(used)} / ${n(cap)}</b><span>Yard</span></div>
    <div class="fdy-v ${brown ? 'bad' : ''}"><b>${n(cp)} / ${n(dm)}</b><span>Grid${brown ? ' · brownout' : ''}</span></div>
    <div class="fdy-v"><b>${n(h.gems())}</b><span>Cinder</span></div>
  </div>`;
}

/* 🔴 NAME THE FIRST STALLED STAGE. In a twelve-machine chain, ten cards saying
   "Waiting on input" is technically accurate and useless — they are all waiting
   on the ONE machine that is actually stuck. runOrder is upstream-first, so the
   earliest halted machine that is not merely starved is the real culprit. */
export function renderAlert(st, h) {
  const cp = powerCapacity(st), dm = powerDemand(st);
  if (dm > cp) {
    const p = machineState(st, 'powerhouse');
    return `<div class="fdy-alert"><b>⚡ Brownout.</b> The line is drawing ${n(dm)} against ${n(cp)} of capacity, so every machine is running at 40%. ${
      !p ? 'Build a Powerhouse.' : (cp === 0 ? 'The Powerhouse has no fuel — refine some, or switch machines off.' : 'Upgrade the Powerhouse, or switch machines off.')}</div>`;
  }
  const used = storageUsed(st), cap = storageCap(st);
  if (used >= cap * 0.98) {
    const liab = DISPOSAL_IDS.filter(i => qtyOf(st, i) >= 1);
    return `<div class="fdy-alert"><b>🏗️ The yard is full.</b> ${liab.length ? 'Haul the ' + liab.map(i => esc(matName(i))).join(' and ') + ', sell finished stock, or upgrade the Scrap Yard.' : 'Sell finished stock or upgrade the Scrap Yard.'}</div>`;
  }
  if (fuelOnHand(st) < 1) {
    const burners = MACHINES.filter(d => (d.burn || 0) > 0 && machineStatus(st, d.id));
    if (burners.length) return `<div class="fdy-alert"><b>⛽ Out of fuel.</b> Every machine burns fuel to run and the tanks are empty. Refine some at the Distillation Column, or buy diesel at the Supply Office to get going again.</div>`;
  }
  for (const d of MACHINES) {
    const s = machineStatus(st, d.id);
    if (!s) continue;
    if (s.halt === HALT.BROKEN) return `<div class="fdy-alert"><b>🔧 ${esc(d.name)} has broken down.</b> Everything downstream of it is idle. Repair it to restart the line.</div>`;
    if (s.halt === HALT.BUFFER_FULL) return `<div class="fdy-alert"><b>🚧 ${esc(d.name)} is backed up.</b> Its output has nowhere to go — give the next stage a recipe that consumes it, or sell the stock.</div>`;
  }
  return '';
}

/* ── The line ────────────────────────────────────────────────────────────── */
export function renderTrim(st) {
  const v = Math.round((Number(st.trim) || 0) * 100);
  return `<div class="fdy-trim">
    <div style="display:flex;align-items:center"><b>Line trim</b><span style="margin-left:auto;color:#8d97a8;font-size:12px">${v}% grade</span></div>
    <input type="range" min="0" max="100" value="${v}" data-fdy-trim>
    <div class="ends"><span>◀ Tonnage — faster, dirtier</span><span>Grade — slower, cleaner ▶</span></div>
  </div>`;
}

/* 🔴 EXPORTED SO THE 3D FLOOR CAN REUSE IT VERBATIM.
   world.js opens this same card in a popup when you walk up to a machine. Two
   renderers for one card would mean every change to a cost line, a halt reason
   or a recipe dropdown gets made twice — and the copy nobody is looking at
   would quietly rot. If the 3D card needs to look different, that is CSS. */
export function machineCard(st, h, def) {
  const s = machineStatus(st, def.id);
  if (!s) {
    const cost = nextCost(def, 0);
    return `<div class="fdy-card">
      <h4>${def.emoji} ${esc(def.name)}<span class="fdy-lv">not built</span></h4>
      <div class="fdy-desc">${esc(def.desc)}</div>
      ${costHtml(h, cost)}
      <div class="fdy-row"><button class="fdy-btn pri" data-fdy-build="${esc(def.id)}">Build · ${esc(fmtDur(buildSeconds(cost)))}</button></div>
    </div>`;
  }
  const cls = s.halt === HALT.BROKEN ? 'broke' : (s.halt !== HALT.OK ? 'halt' : '');
  const tone = s.halt === HALT.OK ? 'ok' : (s.halt === HALT.BROKEN ? 'bad' : 'warn');
  const condCls = s.cond <= 0 ? 'bad' : s.cond < COND_WORN ? 'warn' : '';

  let recipeUi = '';
  const rs = recipesFor(def.id);
  if (rs.length) {
    recipeUi = `<select class="fdy-sel" data-fdy-recipe="${esc(def.id)}">
      <option value="">— idle —</option>
      ${rs.map(r => `<option value="${esc(r.id)}"${r.id === s.recipe ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}
    </select>`;
    const r = s.recipe ? recipeById(s.recipe) : null;
    if (r) {
      const ins = Object.keys(normIn(r)).map(k => `${matIcon(k)} ${normIn(r)[k]}`).join(' + ');
      const outs = Object.keys(normOut(r)).map(k => `${matIcon(k)} ${normOut(r)[k]}`).join(' + ');
      recipeUi += `<div class="fdy-flow"><b>${esc(ins)}</b> → <b>${esc(outs)}</b> · ${r.secs}s<br>${esc(r.note)}</div>`;
    }
  } else if (def.effect) {
    const e = def.effect(s.lv) || {};
    const bits = Object.keys(e).map(k => `+${n(e[k])} ${k}`).join(', ');
    recipeUi = `<div class="fdy-flow"><b>${esc(bits)}</b></div>`;
  }

  const up = s.lv < def.maxLevel ? nextCost(def, s.lv) : null;
  const rep = s.cond < 100 ? repairCost(def, s.cond) : null;

  return `<div class="fdy-card ${cls}">
    <h4>${def.emoji} ${esc(def.name)}<span class="fdy-lv">Lv ${s.lv}/${def.maxLevel}</span></h4>
    <div class="fdy-state ${tone}">${s.on ? esc(s.haltText) : 'Switched off'}${
      /* Speed is only meaningful for a machine that runs batches. The Scrap Yard
         is storage and the Powerhouse is a grid — both were reporting things like
         "Running · ×0.78 speed", which invites the player to wonder why their
         warehouse is running slowly and what they should do about it. */
      s.halt === HALT.OK && s.on && def.kind === 'converter' ? ` · ×${s.speed.toFixed(2)} speed` : ''}</div>
    <div class="fdy-bar"><i class="${condCls}" style="width:${s.cond.toFixed(0)}%"></i></div>
    <div class="fdy-cost">Condition ${s.cond.toFixed(0)}%${def.power ? ` · draws ${def.power} power` : ''}</div>
    ${recipeUi}
    ${s.building ? `<div class="fdy-build">
        <div class="fdy-bar" style="height:8px"><i style="width:${(s.building.pct * 100).toFixed(0)}%"></i></div>
        <div class="fdy-cost">${s.building.fresh ? 'Building' : 'Upgrading to Lv ' + s.building.to} — <b>${esc(s.building.text)}</b> left of ${esc(fmtSecs(s.building.secs))}</div>
      </div>` : machineDetail(st, h, def, s)}
    ${up && !s.building ? costHtml(h, up) : ''}
    <div class="fdy-row">
      ${up && !s.building ? `<button class="fdy-btn" data-fdy-up="${esc(def.id)}">Upgrade${up ? ' · ' + esc(fmtDur(buildSeconds(up))) : ''}</button>` : ''}
      ${rep && !s.building ? `<button class="fdy-btn" data-fdy-rep="${esc(def.id)}">Repair (${n(Object.values(rep).reduce((a, b) => a + b, 0))})</button>` : ''}
      ${!s.building ? `<button class="fdy-btn" data-fdy-tog="${esc(def.id)}">${s.on ? 'Switch off' : 'Switch on'}</button>` : ''}
    </div>
  </div>`;
}

export function renderLine(st, h, line) {
  const defs = machinesForLine(line);
  return `${renderVitals(st, h)}${renderAlert(st, h)}${renderTrim(st)}
    <div class="fdy-grid">${defs.map(d => machineCard(st, h, d)).join('')}</div>`;
}

/* 📖 THE MACHINE BRIEFING — what it needs, what it makes, how fast, and why you
   should care. Everything here answers a question a player was otherwise left to
   work out from a recipe line and a stopwatch:
     "10 → 9 per batch, 26s"  becomes  "≈1,240 shredded waste an hour".
   Per-hour is the unit a factory owner thinks in; per-batch is an implementation
   detail of the simulation.

   ⚠ RATES ARE LIVE, NOT NOMINAL. They fold in the machine's condition, the trim
   dial and whether the grid is browning out — so a number here always matches
   what the line will actually deliver in the next hour, and a rate that has
   halved is itself the symptom that sends a player looking for the cause. */
function rateRow(icons, perHr) {
  const parts = Object.keys(perHr).filter(k => perHr[k] > 0.05)
    .map(k => `${matIcon(k)} <b>${n(Math.round(perHr[k]))}</b> ${esc(matName(k))}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function machineDetail(st, h, def, s) {
  if (!s || !s.recipe || s.building) return '';
  const now = ratePerHour(st, def.id);
  if (!now) return '';
  const next = (s.lv < def.maxLevel) ? ratePerHour(st, def.id, s.lv + 1) : null;

  // Inputs, with what you actually hold — a shortfall is the usual reason a
  // machine is stopped, so show the gap rather than making them go and look.
  const needs = Object.keys(now.inputs).map(k => {
    const have = Math.floor(qtyOf(st, k));
    const short = have < Math.ceil(now.recipe.in[k] || 0);
    return `<span class="${short ? 'no' : ''}">${matIcon(k)} ${esc(matName(k))} <b>${n(Math.round(now.inputs[k]))}</b>/hr <i>(${n(have)} held)</i></span>`;
  }).join(' · ');

  // Anything this machine makes that has a buyer, collectable right here.
  const takes = Object.keys(now.outputs).map(k => {
    const t = tapFor(k); if (!t) return null;
    const p = tapPreview(st, h, k, 1e9);
    if (!p || p.units <= 0) return `<button class="fdy-btn" disabled>${matIcon(k)} ${esc(matName(k))} — none yet</button>`;
    return `<button class="fdy-btn pri" data-fdy-take="${esc(k)}">Take ${n(p.pays)} ${esc(h.resName(t.to) || t.to)}<span style="opacity:.7"> · ${n(p.units)} ${esc(matName(k))}</span></button>`;
  }).filter(Boolean);

  // Why it matters, once it reaches the real ledger.
  let good = '';
  const purpose = purposeOf(st, def.id);
  if (purpose && purpose.length) {
    good = purpose.map(pr => {
      const city = pr.uses.city.map(c => esc(c.name)).join(', ');
      const ops = pr.uses.ops.map(o => esc(o.name)).join(', ');
      const bits = [];
      if (city) bits.push(`<b>City:</b> ${city}`);
      if (pr.uses.builds) bits.push(`<b>${pr.uses.builds}</b> building costs`);
      if (ops) bits.push(`<b>Ops:</b> ${ops}`);
      return bits.length ? `<div class="fdy-flow">⇢ Its ${esc(h.resName(pr.res) || pr.res)} feeds — ${bits.join(' · ')}</div>` : '';
    }).join('');
  }

  return `<div class="fdy-brief">
    <div class="fdy-b-row"><span class="k">Needs</span><span>${needs || '—'}</span></div>
    <div class="fdy-b-row"><span class="k">Makes</span><span>${rateRow(null, now.outputs)}</span></div>
    ${now.fuelPerHr > 0.05 ? `<div class="fdy-b-row"><span class="k">Burns</span><span class="${fuelOnHand(st) < (def.burn || 0) ? 'no' : ''}">⛽ <b>${n(Math.round(now.fuelPerHr))}</b> fuel/hr <i>(${n(Math.floor(fuelOnHand(st)))} in the tanks)</i></span></div>` : ''}
    <div class="fdy-b-row"><span class="k">Rate</span><span><b>${now.bph.toFixed(1)}</b> batches/hr · one every ${esc(fmtSecs(now.secsPerBatch))}${
      next ? ` <i>→ Lv ${next.lv}: <b>${next.bph.toFixed(1)}</b>/hr (+${Math.round((next.bph / now.bph - 1) * 100)}%)</i>` : ' <i>· max level</i>'}</span></div>
    ${good}
    ${takes.length ? `<div class="fdy-row" style="margin-top:9px">${takes.join('')}</div>` : ''}
  </div>`;
}

function fmtSecs(x) { x = Math.max(0, x); return x < 60 ? x.toFixed(0) + 's' : (x / 60).toFixed(1) + 'm'; }

/* ── Control Room ────────────────────────────────────────────────────────── */
/* The whole-line view, for the desk you walk to rather than a machine you
   operate. Deliberately NOT a fourth copy of the vitals strip: it adds the power
   breakdown and the trim dial, which are the only two things that are a property
   of the LINE rather than of one machine. */
export function renderControl(st, h) {
  const cp = powerCapacity(st), dm = powerDemand(st);
  const rows = MACHINES.map(d => ({ d, s: machineStatus(st, d.id) })).filter(x => x.s);
  const drawing = rows.filter(x => x.d.power && x.s.on && x.s.cond > 0);
  const trouble = rows.filter(x => x.s.halt !== HALT.OK);
  return `${renderVitals(st, h)}${renderAlert(st, h)}${whatIs('control')}${renderTrim(st)}
    <div class="fdy-sec">Grid load</div>
    <div class="fdy-card">
      <div class="fdy-bar" style="height:9px"><i class="${dm > cp ? 'bad' : ''}" style="width:${Math.min(100, cp ? (dm / cp) * 100 : 100).toFixed(0)}%"></i></div>
      <div class="fdy-cost">${n(dm)} drawn of ${n(cp)} available${dm > cp ? ' — <span class="no">short ' + n(dm - cp) + '</span>' : ''}</div>
      <div class="fdy-flow">${drawing.length ? drawing.map(x => `${x.d.emoji} ${esc(x.d.name)} <b>${x.d.power}</b>`).join(' · ') : 'Nothing is drawing power.'}</div>
    </div>
    <div class="fdy-sec">Line status</div>
    ${trouble.length ? `<div class="fdy-grid">${trouble.map(x => `<div class="fdy-card ${x.s.halt === HALT.BROKEN ? 'broke' : 'halt'}">
        <h4>${x.d.emoji} ${esc(x.d.name)}</h4>
        <div class="fdy-state ${x.s.halt === HALT.BROKEN ? 'bad' : 'warn'}">${esc(x.s.haltText)}</div>
        <div class="fdy-cost">Condition ${x.s.cond.toFixed(0)}%</div></div>`).join('')}</div>`
      : '<div class="fdy-empty">Every machine on the line is running.</div>'}`;
}

/* ── Yard ────────────────────────────────────────────────────────────────── */
export function renderYard(st, h) {
  const rows = MATERIALS.map(m => ({ m, s: stockOf(st, m.id) })).filter(x => x.s.qty >= 1);
  if (!rows.length) return `${renderVitals(st, h)}<div class="fdy-empty">The yard is empty. Buy feedstock from Supply, then give your machines a recipe.</div>`;
  const group = (title, list) => list.length ? `<div class="fdy-sec">${title}</div><div class="fdy-inv">${list.map(({ m, s }) => {
    const liab = DISPOSAL_IDS.indexOf(m.id) >= 0;
    /* 🔴 NO GRADE ON A LIABILITY. gradeLabel is honest arithmetic but nonsense as
       a label here — slag came out of a clean furnace charge, so the yard proudly
       announced "Slag · Pristine · 96%" for a material whose entire role is to
       cost money to remove. Grade is a claim about how good a pile is, and these
       piles are not good at any purity. Say what the player can do instead. */
    const sub = liab
      ? `<span style="color:#e0a860">No buyer · haul it</span>`
      : (([lab, col]) => `<span style="color:${col}">${esc(lab)} · ${pct(s.purity)}</span>`)(gradeLabel(s.purity));
    return `<div class="fdy-i ${liab ? 'liab' : ''}"><span class="ic">${m.icon}</span>
      <span class="nm"><b>${esc(m.name)}</b>${sub}</span>
      <span class="qt">${n(s.qty)}</span></div>`;
  }).join('')}</div>` : '';
  return renderVitals(st, h)
    + group('Liabilities — haul these', rows.filter(x => DISPOSAL_IDS.indexOf(x.m.id) >= 0))
    + group('Feedstock', rows.filter(x => x.m.feed))
    + group('Process streams', rows.filter(x => x.m.local && DISPOSAL_IDS.indexOf(x.m.id) < 0))
    + group('Product', rows.filter(x => x.m.tap));
}

/* ── Supply ──────────────────────────────────────────────────────────────── */
function whatIs(key) {
  const i = STATION_INFO[key]; if (!i) return '';
  return `<div class="fdy-what"><h3>${esc(i.title)}</h3><p>${esc(i.what)}</p>
    <div class="tip">💡 ${esc(i.tip)}</div></div>`;
}

export function renderSupply(st, h) {
  const cards = Object.keys(FEED_PRICES).map(id => {
    const m = matById(id); if (!m) return '';
    const [lab, col] = gradeLabel(FEED_GRADE[id] || 0.5);
    return `<div class="fdy-card">
      <h4>${m.icon} ${esc(m.name)}<span class="fdy-lv">${n(feedPrice(h, id))} ea</span></h4>
      <div class="fdy-flow">Arrives at <b style="color:${col}">${esc(lab)}</b> · ${pct(FEED_GRADE[id] || 0.5)}</div>
      <div class="fdy-row">${CONTRACT_SIZES.map(q =>
        `<button class="fdy-btn" data-fdy-buy="${esc(id)}" data-q="${q}">${n(q)} · ${n(contractCost(h, id, q))}</button>`).join('')}</div>
    </div>`;
  }).join('');
  const liab = DISPOSAL_IDS.filter(i => qtyOf(st, i) >= 1);
  const haul = liab.length ? `<div class="fdy-sec">Disposal</div><div class="fdy-grid">${liab.map(id => {
    const m = matById(id);
    return `<div class="fdy-card halt"><h4>${m.icon} ${esc(m.name)}<span class="fdy-lv">${n(qtyOf(st, id))} held</span></h4>
      <div class="fdy-desc">No buyer wants it. It fills the yard until you pay to move it.</div>
      <div class="fdy-row"><button class="fdy-btn" data-fdy-haul="${esc(id)}">Haul all · ${n(haulCost(h, st, id))} Cinder</button></div></div>`;
  }).join('')}</div>` : '';
  return `${renderVitals(st, h)}${whatIs('supply')}<div class="fdy-sec">Supply contracts</div><div class="fdy-grid">${cards}</div>${haul}`;
}

/* ── Taps ────────────────────────────────────────────────────────────────── */
export function renderTaps(st, h) {
  const rows = TAPS.map(t => ({ t, p: tapPreview(st, h, t.from, 1e9) })).filter(x => x.p && x.p.units > 0);
  if (!rows.length) return `${renderVitals(st, h)}${whatIs('weigh')}<div class="fdy-empty">Nothing finished yet. Steel, sheet and the fuels pay out here.</div>`;
  return renderVitals(st, h) + whatIs('weigh') + `<div class="fdy-grid">${rows.map(({ t, p }) => {
    const m = matById(t.from); const [lab, col] = gradeLabel(p.purity);
    return `<div class="fdy-card">
      <h4>${m.icon} ${esc(m.name)}<span class="fdy-lv">${n(p.units)} held</span></h4>
      <div class="fdy-flow"><b style="color:${col}">${esc(lab)}</b> · ${pct(p.purity)} → pays <b>${n(p.pays)} ${esc(h.resName(t.to) || t.to)}</b></div>
      <div class="fdy-row"><button class="fdy-btn pri" data-fdy-sell="${esc(t.from)}">Sell all</button></div>
    </div>`;
  }).join('')}</div>`;
}

export default { FOUNDRY_CSS, renderLine, renderYard, renderSupply, renderTaps, renderControl, machineCard, machineDetail, renderVitals, renderAlert, gradeLabel, esc };
