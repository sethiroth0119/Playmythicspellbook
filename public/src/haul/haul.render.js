/* ═══════════════════════════════════════════════════════════════════════════
   haul.render.js — every pixel of the Highway Haul hub, and the run flow.

   Four tabs: DISPATCH (the board + my shipments + my runs), SHIP (post a
   job), COMPANY (the transport business: terms, drivers, worth vs wage) and
   RANK (my driver record). The overlay is one element, repainted whole from
   state — the same paint() discipline as /src/community, so there is never a
   stale button.

   The run flow lives here too (startRun / practiceRun): claim → play →
   settle → result card. play() is the 3D game and knows nothing about money;
   settle is the sql/038 RPC and knows nothing about the road.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, esc, fmtNum, fmtKm, fmtTime } from './haul.bridge.js';
import { normalizeCities, route, parSeconds } from './haul.map.js';
import { econOf, minFare, defaultTerms, settle, rating, rankFor, worth, verdict, RANKS,
         cargoClass, CARGO_CLASSES, cargoRisk, UPGRADES, UPGRADE_MAX, upgradePrice, insurancePremium, guardFee, tollPct, bonusEarned } from './haul.economy.js';
import { Haul, loadAll, loadCompany, postJob, cancelJob, claimJob, completeRun, claimGoods, saveCompany, setWage, practiceAdd, practiceStats, hireGuard, buyUpgrade } from './haul.api.js';
import { play, planRun, GAME_CSS } from './haul.game.js';

const OV = 'haul-ov';
let tab = 'dispatch';
let form = { fromId: '', toId: '', resource: '', qty: 10, fare: 0, recipientId: '', insured: false, bonus: 0 };
let practice = { fromId: '', toId: '', guard: false };
let busy = false;

/* ── Terms the CURRENT player drives under. Company terms if their corp runs a
   transport op, else freelance (null). Mirrors _haul_company_of in sql/038. */
function myTerms() {
  const b = bridge(); const corp = b.myCorp();
  if (!corp || !Haul.transportOp) return null;
  const t = Haul.company || defaultTerms(b.econ());
  const me = b.userId();
  const override = me && Haul.wages[me];
  return Object.assign({}, t, override != null ? { wage_pct: override } : {});
}
function cities() { return normalizeCities(bridge().cities()); }
function cityName(id) { const c = cities().find((x) => x.id === id); return c ? c.name : id; }
function myStats() {
  const me = bridge().userId();
  const row = me && Haul.board.find((r) => r.driver_id === me);
  return row || practiceStats();
}

/* ── Paint ───────────────────────────────────────────────────────────────── */
export function paint() {
  const ov = document.getElementById(OV); if (!ov) return;
  const b = bridge();
  const mode = Haul.offline ? '📴 Practice · sign in for live freight' : Haul.missing ? '🔌 Practice · sql/038 not applied' : '🟢 Live freight';
  ov.innerHTML = `
    <div class="hl-panel">
      <div class="hl-head">
        <div><div class="hl-title">🚚 Highway Haul</div><div class="hl-sub">${esc(mode)}${Haul.error && !Haul.missing ? ' · <span class="hl-err">' + esc(Haul.error.slice(0, 90)) + '</span>' : ''}</div></div>
        <div class="hl-head-r"><span class="hl-pill">🔥 ${fmtNum(b.gems())}</span><button class="hl-x" data-h="close">✕</button></div>
      </div>
      <div class="hl-tabs">
        ${[['dispatch', '📋 Dispatch'], ['ship', '📦 Ship goods'], ['company', '🏢 Company'], ['garage', '🔧 Garage'], ['rank', '🪪 Driver rank']].map(([id, n]) => `<button class="hl-tab${tab === id ? ' on' : ''}" data-h="tab" data-tab="${id}">${n}</button>`).join('')}
      </div>
      <div class="hl-body">${busy ? '<div class="hl-busy">Working…</div>' : ''}${({ dispatch: paintDispatch, ship: paintShip, company: paintCompany, garage: paintGarage, rank: paintRank })[tab]()}</div>
    </div>`;
}

function jobCard(j, opts) {
  opts = opts || {};
  const b = bridge(); const m = b.meta(j.resource);
  const terms = myTerms();
  const prev = settle({ fare: j.fare, cargoPct: 1, crashesCar: 0, crashesRail: 0, terms });
  const par = parSeconds(Number(j.distance_km));
  const st = j.status;
  const me = b.userId();
  const mineAsShipper = j.shipper_id === me, mineAsDriver = j.driver_id === me, mineAsRecipient = j.recipient_id === me;
  let actions = '';
  if (opts.board && !mineAsShipper) actions = `<button class="hl-btn hl-btn-go" data-h="claim" data-id="${j.id}">🛣 Take the wheel</button>`;
  if (mineAsDriver && st === 'claimed') actions = `<button class="hl-btn hl-btn-go" data-h="drive" data-id="${j.id}">🚚 Drive now</button>`;
  if (mineAsShipper && st === 'open') actions += `<button class="hl-btn" data-h="cancel" data-id="${j.id}">Cancel · refund</button>`;
  if (mineAsRecipient && st === 'delivered' && !j.goods_claimed_at) actions += `<button class="hl-btn hl-btn-go" data-h="collect" data-id="${j.id}">📦 Collect ${Math.floor(j.qty * Number(j.cargo_pct || 0))} ${esc(m.name)}</button>`;
  const statusTxt = { open: 'On the board', claimed: 'Driver: ' + (j.driver_name || '—'), delivered: 'Delivered · ' + Math.round(Number(j.cargo_pct || 0) * 100) + '% intact' + (j.goods_claimed_at ? ' · collected' : ''), cancelled: 'Cancelled' }[st] || st;
  return `<div class="hl-job hl-${st}">
    <div class="hl-job-route"><b>${esc(j.from_name)}</b> → <b>${esc(j.to_name)}</b> <span class="hl-dim">· ${fmtKm(j.distance_km)} · par ${fmtTime(par)}</span></div>
    <div class="hl-job-meta">${m.icon || '📦'} ${j.qty}× ${esc(m.name)} <span class="hl-dim">${CARGO_CLASSES[cargoClass(j.resource)].label}</span> · fare <b>🔥 ${fmtNum(j.fare)}</b>${j.bonus > 0 ? ' · 🎁 bonus 🔥 ' + fmtNum(j.bonus) + ' if on time' : ''}${j.insured ? ' · 🛡 insured' : ''}${j.guard_hired ? ' · 🪖 guard' : ''} · by ${esc(j.shipper_name || 'Survivor')}</div>
    <div class="hl-job-meta hl-dim">${esc(statusTxt)}${opts.board && !mineAsShipper ? ' · your cut at 100% cargo: <b>🔥 ' + fmtNum(prev.driverPay) + '</b>' + (terms ? ' (' + prev.wagePct + '% wage)' : ' (freelance)') : ''}</div>
    ${actions ? '<div class="hl-job-act">' + actions + '</div>' : ''}
  </div>`;
}

function citySelect(name, val, exclude) {
  return `<select class="hl-in" data-f="${name}">` + cities().filter((c) => c.id !== exclude).map((c) => `<option value="${esc(c.id)}"${c.id === val ? ' selected' : ''}>${esc(c.name)}${c.mine ? ' ★' : c.owned ? ' ·' : ''}</option>`).join('') + '</select>';
}

function paintDispatch() {
  const b = bridge(); const me = b.userId();
  const C = cities();
  if (!practice.fromId) { const mine = C.find((c) => c.mine) || C[0]; practice.fromId = mine.id; practice.toId = (C.find((c) => c.id !== mine.id) || C[1]).id; }
  const r = route(C, practice.fromId, practice.toId);
  const open = Haul.jobs.filter((j) => j.status === 'open');
  const myRuns = Haul.mine.filter((j) => j.driver_id === me && j.status === 'claimed');
  const myShip = Haul.mine.filter((j) => j.shipper_id === me || (j.recipient_id === me && j.status === 'delivered'));
  return `
    <div class="hl-card hl-practice">
      <div class="hl-card-t">🏁 Practice run <span class="hl-dim">— no cargo, no Cinder, but it counts toward your feel for the road</span></div>
      <div class="hl-row">${citySelect('pfrom', practice.fromId, '')} <span>→</span> ${citySelect('pto', practice.toId, '')}
        <span class="hl-pill">${r ? fmtKm(r.km) + ' · ' + (r.path.length - 1) + ' junction' + (r.path.length > 2 ? 's' : '') + ' · par ' + fmtTime(parSeconds(r.km)) : '—'}</span>
        <label class="hl-chk"><input type="checkbox" data-f="pguard"${practice.guard ? ' checked' : ''}> 🪖 bring a guard (free in practice)</label>
        <button class="hl-btn hl-btn-go" data-h="practice">Drive</button></div>
      ${r && r.direct ? '<div class="hl-dim hl-small">⚠ No supply line links these cities — straight-line distance used.</div>' : ''}
    </div>
    ${myRuns.length ? '<div class="hl-card-t">🚚 Your claimed run</div>' + myRuns.map((j) => jobCard(j)).join('') : ''}
    <div class="hl-card-t">📋 Open shipments <span class="hl-dim">(${open.length})</span> <button class="hl-btn hl-btn-sm" data-h="refresh">↻</button></div>
    ${open.length ? open.map((j) => jobCard(j, { board: true })).join('')
      : `<div class="hl-empty">${Haul.offline ? 'Sign in to see live shipments.' : Haul.missing ? 'The freight board is not set up on the server yet.' : 'Nobody is shipping right now. Post one under 📦 Ship goods.'}</div>`}
    ${myShip.length ? '<div class="hl-card-t">📦 Your shipments</div>' + myShip.slice(0, 12).map((j) => jobCard(j)).join('') : ''}
  `;
}

function paintShip() {
  const b = bridge(); const C = cities();
  const res = b.resources().filter((x) => x && x.id);
  if (!form.fromId) { const mine = C.find((c) => c.mine) || C[0]; form.fromId = mine.id; }
  if (!form.toId || form.toId === form.fromId) form.toId = (C.find((c) => c.id !== form.fromId) || C[1]).id;
  if (!form.resource) { const held = res.find((x) => b.getRes(x.id) > 0); form.resource = (held || res[0] || {}).id || ''; }
  const r = route(C, form.fromId, form.toId);
  const econ = econOf(b.econ());
  const min = r ? minFare(econ, r.km, form.qty, form.resource) : 0;
  if (!(form.fare >= min)) form.fare = min;
  const cc = CARGO_CLASSES[cargoClass(form.resource)]; const risk = cargoRisk(econ, form.resource);
  const premium = insurancePremium(econ, form.fare);
  const tollNodes = r ? r.path.slice(1, -1).map((id) => C.find((c) => c.id === id)).filter((c) => c && c.ownerId && c.ownerId !== b.userId()) : [];
  const have = b.getRes(form.resource);
  const roster = b.corpRoster().filter((m) => m.userId && m.userId !== b.userId());
  const terms = Haul.transportOp ? (Haul.company || defaultTerms(econ)) : null;
  return `
    <div class="hl-card">
      <div class="hl-card-t">📦 Post a shipment</div>
      <div class="hl-grid">
        <label>From city ${citySelect('fromId', form.fromId, '')}</label>
        <label>To city ${citySelect('toId', form.toId, form.fromId)}</label>
        <label>Goods <select class="hl-in" data-f="resource">${res.map((x) => `<option value="${esc(x.id)}"${x.id === form.resource ? ' selected' : ''}>${x.icon || '📦'} ${esc(x.name)} (${fmtNum(b.getRes(x.id))})</option>`).join('')}</select></label>
        <label>Quantity <input class="hl-in" type="number" min="1" max="${Math.max(1, have)}" data-f="qty" value="${form.qty}"></label>
        <label>Fare in Cinder <input class="hl-in" type="number" min="${min}" data-f="fare" value="${form.fare}"><span class="hl-small hl-dim">minimum 🔥 ${fmtNum(min)} — base ${econ.fareBase} + ${econ.farePerKm}/km + ${econ.farePerUnit}/unit${risk !== 1 ? ' × ' + risk + ' (' + cc.label.replace('· ', '') + ' cargo)' : ''}. Pay more to pull drivers.</span></label>
        <label>On-time bonus 🎁 <input class="hl-in" type="number" min="0" data-f="bonus" value="${form.bonus}"><span class="hl-small hl-dim">Escrowed with the fare. The driver earns it by arriving within par with ≥ 90% cargo; otherwise it comes back to you.</span></label>
        <label class="hl-chk-lab"><span>Insurance 🛡</span><span class="hl-chk"><input type="checkbox" data-f="insured"${form.insured ? ' checked' : ''}> Insure for 🔥 ${fmtNum(premium)} (${econ.insurePct}% of fare)</span><span class="hl-small hl-dim">The recipient collects the FULL ${form.qty} units whatever arrives. The premium is not refunded on cancel.</span></label>
        <label>Deliver to <select class="hl-in" data-f="recipientId"><option value="">Myself (goods wait for me at the destination)</option>${roster.map((m) => `<option value="${esc(m.userId)}"${m.userId === form.recipientId ? ' selected' : ''}>${esc(m.name)} (corp)</option>`).join('')}</select></label>
      </div>
      <div class="hl-route">${r ? `Route: ${r.path.map(cityName).map(esc).join(' → ')} · <b>${fmtKm(r.km)}</b> · par ${fmtTime(parSeconds(r.km))}${r.direct ? ' · ⚠ no supply line, straight-line distance' : ''}${tollNodes.length ? ' · 💰 ' + tollNodes.length + ' toll gate' + (tollNodes.length > 1 ? 's' : '') + ' (' + tollNodes.map((c) => esc(c.name)).join(', ') + ') — ' + tollPct(econ) + '% of the fare each, paid to the node owner out of the carrier\'s side' : ''}` : 'Pick two cities.'}</div>
      <div class="hl-dim hl-small">The fare is escrowed now and paid out on delivery. Damaged cargo is refunded to you pro rata; a failed run puts the shipment back on the board with your escrow intact. Your ${form.qty} units leave your stash when you post.</div>
      <div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="post" ${Haul.offline || Haul.missing || have < form.qty ? 'disabled' : ''}>Post for 🔥 ${fmtNum(form.fare + (form.bonus | 0) + (form.insured ? premium : 0))}${(form.bonus | 0) || form.insured ? ' <span class="hl-small">(fare' + ((form.bonus | 0) ? ' + bonus' : '') + (form.insured ? ' + insurance' : '') + ')</span>' : ''}</button>
        ${have < form.qty ? '<span class="hl-err">You hold ' + fmtNum(have) + '.</span>' : ''}
        ${Haul.offline ? '<span class="hl-dim">Sign in to post.</span>' : Haul.missing ? '<span class="hl-dim">Server tables missing (sql/038).</span>' : ''}</div>
    </div>
    <div class="hl-card hl-dim hl-small">How the money splits on delivery (server-settled): a company driver gets their wage % of the fare that arrived, minus ${terms ? terms.car_penalty_pct : econ.carPenaltyPct}% of that per car hit and ${terms ? terms.rail_penalty_pct : econ.railPenaltyPct}% per rail hit (capped at ${terms ? terms.max_penalty_pct : econ.maxPenaltyPct}%); the rest goes to the company treasury. A freelancer keeps the whole fare, and their crash penalties are burned.</div>`;
}

function paintCompany() {
  const b = bridge(); const corp = b.myCorp();
  if (!corp) return '<div class="hl-empty">Join or found a corporation in Just Business. A transport company IS a corporation that owns a <b>Transport Company</b> operation.</div>';
  const econ = econOf(b.econ());
  const founder = b.amCorpFounder();
  const terms = Haul.company || defaultTerms(econ);
  if (!Haul.transportOp) {
    return `<div class="hl-card"><div class="hl-card-t">🏢 ${esc(corp.name)}</div>
      <div>${esc(corp.name)} does not run a Transport Company yet. ${founder ? 'Found one in <b>Just Business → Operations</b> (startup 🔥 ' + fmtNum(econ.startup || 0) + '). Until then your members drive as freelancers and keep their whole fare.' : 'Ask your founder to open one in Just Business. Until then you drive freelance and keep the whole fare.'}</div></div>`;
  }
  const roster = b.corpRoster();
  const rows = roster.map((m) => {
    const st = Haul.board.find((r) => r.driver_id === m.userId) || null;
    const W = worth(st, terms, econ);
    const cur = Haul.wages[m.userId] != null ? Haul.wages[m.userId] : Number(terms.wage_pct);
    const V = verdict(cur, W.worthPct);
    return `<tr>
      <td><b>${esc(m.name)}</b><div class="hl-small hl-dim">${esc(m.role || 'member')}</div></td>
      <td><span style="color:${W.rank.accent}">${W.rank.icon} ${W.rank.name}</span><div class="hl-small hl-dim">rating ${W.rating.score}${W.rating.provisional ? ' (provisional)' : ''}</div></td>
      <td>${st ? (st.runs | 0) + ' runs · ' + fmtKm(st.km) : '<span class="hl-dim">no runs</span>'}<div class="hl-small hl-dim">${st ? 'crashes ' + ((st.crashes_car | 0) + (st.crashes_rail | 0)) + ' · cargo ' + Math.round(Number(st.cargo_avg) * 100) + '%' : ''}</div></td>
      <td>🔥 ${fmtNum(W.companyNetPerRun)}<div class="hl-small hl-dim">to treasury / run</div></td>
      <td><b>${W.worthPct}%</b><div class="hl-small hl-dim">worth</div></td>
      <td>${founder ? `<input class="hl-in hl-in-sm" type="number" min="0" max="100" value="${cur}" data-wage="${esc(m.userId)}">` : cur + '%'}<div class="hl-small" style="color:${V.color}">${esc(V.label)}</div></td>
    </tr>`;
  }).join('');
  return `
    <div class="hl-card">
      <div class="hl-card-t">🏢 ${esc(corp.name)} Transport Company <span class="hl-dim">· treasury 🔥 ${fmtNum(b.corpTreasury())}</span></div>
      <div class="hl-grid hl-grid-4">
        <label>Default driver wage % <input class="hl-in" type="number" min="0" max="100" data-t="wage_pct" value="${terms.wage_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Car hit penalty % <input class="hl-in" type="number" min="0" max="100" data-t="car_penalty_pct" value="${terms.car_penalty_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Rail hit penalty % <input class="hl-in" type="number" min="0" max="100" data-t="rail_penalty_pct" value="${terms.rail_penalty_pct}" ${founder ? '' : 'disabled'}></label>
        <label>Max penalty % <input class="hl-in" type="number" min="0" max="100" data-t="max_penalty_pct" value="${terms.max_penalty_pct}" ${founder ? '' : 'disabled'}></label>
      </div>
      <div class="hl-dim hl-small">Penalties come out of the DRIVER's wage on each run, never out of the fare the company keeps. ${Haul.company ? '' : 'These are the game defaults — save to write your own.'}</div>
      ${founder ? '<div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="save-terms">Save terms</button></div>' : ''}
    </div>
    <div class="hl-card">
      <div class="hl-card-t">👥 Drivers <span class="hl-dim">— what each is worth vs what they are paid</span></div>
      <div class="hl-tblwrap"><table class="hl-tbl"><thead><tr><th>Driver</th><th>Rank</th><th>Record</th><th>Company net</th><th>Worth</th><th>Wage</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="hl-dim">No members yet.</td></tr>'}</tbody></table></div>
      ${founder ? '<div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="save-wages">Save driver wages</button> <span class="hl-dim hl-small">Blank a box to fall back to the default.</span></div>' : ''}
      <div class="hl-dim hl-small">Worth is the wage share a driver's record justifies: rating 50 = your default, a perfect record ≈ 1.6× it, a wrecker ≈ half. Company net is the average Cinder their runs have actually put in the treasury.</div>
    </div>`;
}

function paintGarage() {
  const b = bridge(); const econ = econOf(b.econ()); const U = Haul.upgrades || {};
  return `<div class="hl-card"><div class="hl-card-t">🔧 Your rig <span class="hl-dim">— upgrades are yours, whoever you drive for</span></div>
    ${UPGRADES.map((u) => { const lvl = U[u.id] | 0; const next = lvl + 1; const price = upgradePrice(econ, u.id, next);
      return `<div class="hl-run"><span>${u.icon} <b>${u.name}</b> <span class="hl-dim">L${lvl}/${UPGRADE_MAX} · ${esc(u.desc)}</span></span>
        <span>${lvl >= UPGRADE_MAX ? '<span class="hl-dim">maxed</span>' : `<button class="hl-btn hl-btn-sm hl-btn-go" data-h="buy" data-id="${u.id}" ${Haul.offline || Haul.missing ? 'disabled' : ''}>Buy L${next} · 🔥 ${fmtNum(price)}</button>`}</span></div>`; }).join('')}
    <div class="hl-dim hl-small">${Haul.offline ? 'Sign in to buy upgrades.' : Haul.missing ? 'Server tables missing (sql/039).' : 'Charged to your wallet by the server; the level applies on your next run.'}</div>
  </div>
  <div class="hl-card"><div class="hl-card-t">📦 Cargo handling</div>
    ${Object.values(CARGO_CLASSES).map((c) => `<div class="hl-run"><span><b>${c.id}</b> <span class="hl-dim">${c.id === 'standard' ? 'drives normally' : c.id === 'fragile' ? 'rail scrapes and hazards hurt 1.7×' : c.id === 'flammable' ? 'car hits hurt 1.6×; a hard hit starts a fire' : 'slower to accelerate and stop, tougher cargo'}</span></span><span class="hl-dim">fare × ${cargoRisk(econ, { fragile: 'medicine', flammable: 'fuel', heavy: 'metal', standard: 'food' }[c.id])}</span></div>`).join('')}
  </div>`;
}

function paintRank() {
  const b = bridge(); const st = myStats();
  const R = rating(st); const rk = rankFor(R.score);
  const next = RANKS.find((x) => x.min > R.score);
  const terms = myTerms();
  const W = worth(st, terms, b.econ());
  const runs = Haul.runs.length ? Haul.runs : [];
  const top = Haul.board.map((r) => ({ r, s: rating(r).score })).sort((a, b2) => b2.s - a.s).slice(0, 10);
  return `
    <div class="hl-card hl-rankcard" style="--acc:${rk.accent}">
      <div class="hl-rank-big">${rk.icon}</div>
      <div><div class="hl-rank-name">${esc(rk.name)}</div>
        <div class="hl-dim">${esc(b.displayName())} · rating <b>${R.score}</b>/100${R.provisional ? ' · provisional until 3 runs' : ''}${next ? ' · ' + (next.min - R.score) + ' to ' + next.name : ''}</div>
        <div class="hl-bars">${[['Cargo integrity', R.parts.cargo], ['Clean driving', R.parts.clean], ['Pace', R.parts.pace], ['Reliability', R.parts.reliability]].map(([n, v]) => `<div class="hl-bar"><span>${n}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`).join('')}</div>
        <div class="hl-dim hl-small">${st ? (st.runs | 0) + ' runs · ' + fmtKm(st.km) + ' · earned 🔥 ' + fmtNum(st.earned || 0) : 'No runs on record yet — practice runs count toward this preview.'}${terms ? ' · your wage ' + terms.wage_pct + '% · a record like yours is worth ' + W.worthPct + '%' : ' · driving freelance'}</div>
      </div>
    </div>
    <div class="hl-card"><div class="hl-card-t">🧾 Recent runs</div>
      ${runs.length ? runs.slice(0, 12).map((r) => `<div class="hl-run"><span>${r.outcome === 'delivered' ? '✅' : '❌'} ${fmtKm(r.distance_km)} · ${fmtTime(r.time_s)}/${fmtTime(r.par_s)} · 🚗${r.crashes_car} 🛤${r.crashes_rail} · cargo ${Math.round(Number(r.cargo_pct) * 100)}%</span><span>🔥 ${fmtNum(r.driver_pay)}${r.penalty > 0 ? ' <span class="hl-err">−' + fmtNum(r.penalty) + '</span>' : ''}${r.corp_id ? '' : ' <span class="hl-dim">freelance</span>'}</span></div>`).join('') : '<div class="hl-dim">Nothing settled yet.</div>'}
    </div>
    ${Haul.records.length ? '<div class="hl-card"><div class="hl-card-t">⏱ Route records</div>' + Haul.records.slice(0, 15).map((x) => `<div class="hl-run"><span>${esc(cityName(x.from_node))} → ${esc(cityName(x.to_node))}</span><span><b>${fmtTime(x.time_s)}</b> · ${esc(x.driver_name || 'Driver')}</span></div>`).join('') + '</div>' : ''}
    <div class="hl-card"><div class="hl-card-t">🏆 Top drivers</div>
      ${top.length ? top.map((x, i) => { const k = rankFor(x.s); return `<div class="hl-run"><span>${i + 1}. ${k.icon} <b>${esc(x.r.driver_name || 'Driver')}</b> <span class="hl-dim">${k.name}</span></span><span>${x.s} · ${x.r.runs} runs · ${fmtKm(x.r.km)}</span></div>`; }).join('') : '<div class="hl-dim">No drivers on the board yet.</div>'}
    </div>`;
}

/* ── Run flow ────────────────────────────────────────────────────────────── */
function ensureGameCss() { if (!document.getElementById('haul-game-css')) { const s = document.createElement('style'); s.id = 'haul-game-css'; s.textContent = GAME_CSS; document.head.appendChild(s); } }

async function runGame(params) {
  ensureGameCss();
  const ov = document.getElementById(OV); if (ov) ov.style.display = 'none';
  try { return await play(params); }
  finally { if (ov) ov.style.display = ''; }
}

async function practiceRun() {
  const C = cities(); const r = route(C, practice.fromId, practice.toId);
  if (!r || r.km <= 0) return bridge().toast('Pick two different cities.');
  let out;
  try { out = await runGame({ cities: C, fromId: practice.fromId, toId: practice.toId, cargoLabel: 'practice load', guard: practice.guard, upgrades: Haul.upgrades, driverId: bridge().userId(), forceToll: true }); }
  catch (e) { return bridge().toast('⚠ ' + (e && e.message), 6000); }
  practiceAdd(out);
  const fare = minFare(bridge().econ(), r.km, 10);
  const prev = settle({ fare, cargoPct: out.cargoPct, crashesCar: out.crashesCar, crashesRail: out.crashesRail, terms: myTerms() });
  // Paint FIRST: paint() rebuilds the overlay's innerHTML and would wipe the
  // card if it came after. (Driven test: the result never appeared.)
  paint();
  resultCard(out, prev, { practice: true, fare });
}

async function startRun(job) {
  const b = bridge();
  if (job.driver_id !== b.userId() || job.status !== 'claimed') {
    const c = await claimJob(job);
    if (!c.ok) return b.toast('⚠ ' + c.why, 4200);
    job = c.job || job;
  }
  const m = b.meta(job.resource);
  // 🪖 One guard per run, offered before the wheel turns. Paid by the company
  //    treasury (or the freelancer) through sql/039; the job row remembers it.
  if (!job.guard_hired && !Haul.missing) {
    const fee = guardFee(b.econ()); const corp = Haul.transportOp ? b.myCorp() : null;
    const yes = await b.confirm('Hire a guard for this run? 🔥 ' + fmtNum(fee) + (corp ? ' from the ' + corp.name + ' treasury' : ' from your wallet') + '.\n\nRaiders on long routes try to ram you off the road. A guard opens fire once per run, the first time they close in.');
    if (yes) { const g = await hireGuard(job); if (g.ok) { job.guard_hired = true; b.toast('🪖 Guard hired for this run.', 3000); } else b.toast('⚠ ' + g.why, 4200); }
  }
  let out;
  try { out = await runGame({ cities: cities(), fromId: job.from_node, toId: job.to_node, resource: job.resource, cargoLabel: job.qty + '× ' + m.name, cargoColor: m.color, guard: !!job.guard_hired, upgrades: Haul.upgrades, driverId: b.userId() }); }
  catch (e) { b.toast('⚠ ' + (e && e.message), 6000); await loadAll(); paint(); return; }
  busy = true; paint();
  const s = await completeRun(job, out);
  busy = false;
  if (!s.ok) { b.toast('⚠ Run not settled: ' + s.why, 6000); await loadAll(); paint(); return; }
  const run = s.run || {};
  await loadAll(); paint();   // repaint before the card, see practiceRun()
  resultCard(out, {
    failed: run.outcome === 'failed', farePaid: run.fare_paid | 0, refund: (run.fare | 0) - (run.fare_paid | 0), wagePct: Number(run.wage_pct), wageGross: run.wage_gross | 0,
    penalty: run.penalty | 0, driverPay: run.driver_pay | 0, companyNet: run.company_net | 0, burned: run.corp_id ? 0 : (run.penalty | 0),
    bonusPaid: run.bonus_paid | 0, tollPaid: run.toll_paid | 0,
  }, { fare: job.fare, corp: !!run.corp_id, bonus: job.bonus | 0 });
}

function resultCard(out, s, o) {
  const ov = document.getElementById(OV); if (!ov) return;
  const ok = out.completed && !s.failed;
  const d = document.createElement('div'); d.className = 'hl-result';
  d.innerHTML = `<div class="hl-result-card">
    <div class="hl-result-t">${ok ? '🏁 Delivered' : out.abandoned ? '🚫 Run abandoned' : '💥 Cargo lost'}</div>
    <div class="hl-result-grid">
      <div><span>Time</span><b>${fmtTime(out.timeS)} <i class="hl-dim">/ par ${fmtTime(out.parS)}</i></b></div>
      <div><span>Cargo intact</span><b>${Math.round(out.cargoPct * 100)}%</b></div>
      <div><span>Car hits</span><b>${out.crashesCar}</b></div>
      <div><span>Rail hits</span><b>${out.crashesRail}</b></div>
      <div><span>Exits</span><b>${out.wrongExits ? '<span class="hl-err">' + out.wrongExits + ' wrong · +' + out.detourM + ' m</span>' : 'all correct'}</b></div>
      <div><span>Raiders</span><b>${out.raiders ? out.raidersBeaten + '/' + out.raiders + ' beaten' + (out.guardUsed ? ' · 🪖 guard fired' : '') : 'none'}</b></div>
    </div>
    ${o.practice ? `<div class="hl-dim hl-small">Practice — nothing was paid. On a real 🔥 ${fmtNum(o.fare)} fare this run would have paid you <b>🔥 ${fmtNum(s.driverPay)}</b>${s.penalty ? ' after a 🔥 ' + fmtNum(s.penalty) + ' crash penalty' : ''}${bonusEarned(out, bridge().econ()) ? ', and you would have earned any on-time bonus' : ', and missed any on-time bonus'}.</div>`
      : ok ? `<div class="hl-settle">
          <div><span>Fare escrowed</span><b>🔥 ${fmtNum(o.fare)}</b></div>
          <div><span>Shipper charged (${Math.round(out.cargoPct * 100)}% arrived)</span><b>🔥 ${fmtNum(s.farePaid)}</b>${s.refund ? '<i class="hl-dim"> · 🔥 ' + fmtNum(s.refund) + ' refunded</i>' : ''}</div>
          <div><span>Your wage (${s.wagePct}%)</span><b>🔥 ${fmtNum(s.wageGross)}</b></div>
          <div><span>Crash penalty</span><b class="hl-err">− 🔥 ${fmtNum(s.penalty)}</b></div>
          ${o.bonus ? `<div><span>On-time bonus 🎁</span><b>${s.bonusPaid ? '🔥 ' + fmtNum(s.bonusPaid) : '<span class="hl-dim">missed — refunded to the shipper</span>'}</b></div>` : ''}
          ${s.tollPaid ? `<div><span>Tolls to node owners</span><b class="hl-err">− 🔥 ${fmtNum(s.tollPaid)}</b></div>` : ''}
          <div class="hl-settle-big"><span>Paid to you</span><b>🔥 ${fmtNum(s.driverPay + (s.bonusPaid | 0))}</b></div>
          ${o.corp ? `<div><span>To the company treasury</span><b>🔥 ${fmtNum(s.companyNet)}</b></div>` : `<div class="hl-dim hl-small">Freelance run — the penalty was burned, not paid to anyone.</div>`}
        </div>`
      : '<div class="hl-dim hl-small">Nothing was paid. The shipment is back on the board and the failed run is on your record.</div>'}
    <div class="hl-job-act"><button class="hl-btn hl-btn-go" data-h="result-close">Done</button></div>
  </div>`;
  ov.appendChild(d);
}

/* ── Events ──────────────────────────────────────────────────────────────── */
async function onClick(ev) {
  const t = ev.target.closest('[data-h]'); if (!t) return;
  const b = bridge(); const h = t.dataset.h;
  const byId = (id) => Haul.jobs.concat(Haul.mine).find((j) => j.id === id);
  if (h === 'close') return close();
  if (h === 'result-close') { const r = t.closest('.hl-result'); if (r) r.remove(); return; }
  if (h === 'tab') { tab = t.dataset.tab; if (tab === 'company') { busy = true; paint(); await loadCompany(); busy = false; } paint(); return; }
  if (h === 'refresh') { busy = true; paint(); await loadAll(); busy = false; paint(); return; }
  if (h === 'practice') return practiceRun();
  if (h === 'buy') {
    const u = UPGRADES.find((x) => x.id === t.dataset.id); if (!u) return;
    const price = upgradePrice(b.econ(), u.id, (Haul.upgrades[u.id] | 0) + 1);
    if (!(await b.confirm('Buy ' + u.name + ' L' + ((Haul.upgrades[u.id] | 0) + 1) + ' for 🔥 ' + fmtNum(price) + '?'))) return;
    busy = true; paint(); const r = await buyUpgrade(u.id); busy = false;
    b.toast(r.ok ? '🔧 ' + u.name + ' is now L' + r.level + '.' : '⚠ ' + r.why, 4000); paint(); return;
  }
  if (h === 'claim' || h === 'drive') { const j = byId(t.dataset.id); if (j) return startRun(j); }
  if (h === 'cancel') {
    const j = byId(t.dataset.id); if (!j) return;
    if (!(await b.confirm('Cancel this shipment? The fare is refunded and the goods return to your stash.'))) return;
    busy = true; paint(); const ok = await cancelJob(j); busy = false;
    b.toast(ok ? '↩ Shipment cancelled — fare and goods returned.' : '⚠ Could not cancel (a driver may have just taken it).', 4200);
    await loadAll(); paint(); return;
  }
  if (h === 'collect') {
    const j = byId(t.dataset.id); if (!j) return;
    busy = true; paint(); const r = await claimGoods(j); busy = false;
    b.toast(r.ok ? '📦 Collected ' + r.units + ' ' + b.meta(r.resource).name + '.' : '⚠ ' + r.why, 4200);
    await loadAll(); paint(); return;
  }
  if (h === 'post') {
    const C = cities(); const r = route(C, form.fromId, form.toId);
    if (!r) return b.toast('Pick two cities.');
    const min = minFare(b.econ(), r.km, form.qty, form.resource);
    const fare = Math.max(min, Math.floor(form.fare));
    const bonus = Math.max(0, Math.floor(form.bonus || 0)); const prem = form.insured ? insurancePremium(b.econ(), fare) : 0;
    if (!(await b.confirm('Post ' + form.qty + '× ' + b.meta(form.resource).name + ' from ' + cityName(form.fromId) + ' to ' + cityName(form.toId) + ' (' + fmtKm(r.km) + ') for 🔥 ' + fmtNum(fare) + (bonus ? ' + 🔥 ' + fmtNum(bonus) + ' bonus escrow' : '') + (prem ? ' + 🔥 ' + fmtNum(prem) + ' insurance' : '') + '?\n\nThe Cinder is escrowed now and the goods leave your stash.'))) return;
    busy = true; paint();
    const res = await postJob({ fromId: form.fromId, fromName: cityName(form.fromId), toId: form.toId, toName: cityName(form.toId), resource: form.resource, qty: form.qty, km: r.km, fare, recipientId: form.recipientId || null, path: r.path, insured: form.insured, bonus });
    busy = false;
    if (res.ok) { b.toast('📦 Shipment posted. Drivers can see it now.', 4200); tab = 'dispatch'; await loadAll(); }
    else b.toast('⚠ ' + res.why, 5200);
    paint(); return;
  }
  if (h === 'save-terms') {
    const ov = document.getElementById(OV); const terms = {};
    ov.querySelectorAll('[data-t]').forEach((i) => { terms[i.dataset.t] = Math.max(0, Math.min(100, Number(i.value) || 0)); });
    busy = true; paint(); const ok = await saveCompany(terms); busy = false;
    b.toast(ok ? '🏢 Company terms saved.' : '⚠ Could not save terms.', 3600); paint(); return;
  }
  if (h === 'save-wages') {
    const ov = document.getElementById(OV); let n = 0, bad = 0;
    busy = true; paint();
    for (const i of ov.querySelectorAll('[data-wage]')) {
      const uid = i.dataset.wage; const v = i.value === '' ? null : Math.max(0, Math.min(100, Number(i.value) || 0));
      const cur = Haul.wages[uid];
      if ((v == null && cur == null) || (v != null && cur === v)) continue;
      if (await setWage(uid, v)) n++; else bad++;
    }
    busy = false;
    b.toast(bad ? '⚠ ' + bad + ' wage(s) failed to save.' : n ? '💼 ' + n + ' driver wage(s) saved.' : 'No wage changes.', 3600); paint(); return;
  }
}
function onInput(ev) {
  const f = ev.target.dataset.f; if (!f) return;
  const v = ev.target.value;
  if (f === 'pguard') { practice.guard = !!ev.target.checked; return; }
  if (f === 'insured') { form.insured = !!ev.target.checked; paint(); return; }
  if (f === 'bonus') { form.bonus = Math.max(0, parseInt(v, 10) || 0); if (ev.type === 'change') paint(); return; }
  if (f === 'pfrom' || f === 'pto') { practice[f === 'pfrom' ? 'fromId' : 'toId'] = v; if (practice.fromId === practice.toId) { const C = cities(); practice.toId = (C.find((c) => c.id !== practice.fromId) || C[0]).id; } paint(); return; }
  if (f === 'qty') form.qty = Math.max(1, parseInt(v, 10) || 1);
  else if (f === 'fare') form.fare = Math.max(0, parseInt(v, 10) || 0);
  else form[f] = v;
  if (f === 'fromId' && form.toId === form.fromId) form.toId = '';
  if (f !== 'fare') { form.fare = 0; }   // re-derive the minimum for the new route/load
  if (ev.type === 'change' || f !== 'fare') paint();
}

/* ── Open / close ────────────────────────────────────────────────────────── */
export function open() {
  injectStyle();
  let ov = document.getElementById(OV);
  if (!ov) {
    ov = document.createElement('div'); ov.id = OV;
    ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
    ov.addEventListener('click', onClick);
    ov.addEventListener('change', onInput);
    ov.addEventListener('input', (ev) => { if (['fare', 'qty', 'bonus'].includes(ev.target.dataset.f)) onInput(ev); });
    document.body.appendChild(ov);
  }
  tab = 'dispatch'; busy = true; paint();
  Promise.all([loadAll(), bridge().nodeOwnersRefresh ? bridge().nodeOwnersRefresh() : null]).then(() => { busy = false; paint(); });
}
export function close() { const ov = document.getElementById(OV); if (ov) ov.remove(); }

function injectStyle() {
  if (document.getElementById('haul-css')) return;
  const s = document.createElement('style'); s.id = 'haul-css';
  s.textContent = `
#haul-ov{position:fixed;inset:0;z-index:100040;background:rgba(4,6,12,.78);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:12px;font-family:inherit;color:#e8e0d0}
.hl-panel{width:min(980px,100%);max-height:96vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#171a24,#0f1118);border:1px solid rgba(255,176,96,.35);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
.hl-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.hl-title{font-size:1.35rem;font-weight:900;color:#ffb060;letter-spacing:.02em}
.hl-sub{font-size:.78rem;color:#a89880}
.hl-head-r{display:flex;gap:10px;align-items:center}
.hl-x{background:none;border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:1rem}
.hl-pill{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 10px;font-size:.82rem;font-weight:700}
.hl-tabs{display:flex;gap:4px;padding:8px 12px 0;overflow-x:auto}
.hl-tab{flex:1;min-width:120px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-bottom:none;border-radius:10px 10px 0 0;color:#c8bca8;padding:9px 8px;font-weight:700;cursor:pointer;white-space:nowrap}
.hl-tab.on{background:rgba(255,176,96,.16);color:#ffd9a8;border-color:rgba(255,176,96,.4)}
.hl-body{overflow:auto;padding:14px;position:relative;flex:1}
.hl-busy{position:sticky;top:0;z-index:2;background:rgba(255,176,96,.18);color:#ffd9a8;text-align:center;padding:4px;border-radius:8px;margin-bottom:8px;font-size:.8rem}
.hl-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 14px;margin-bottom:12px}
.hl-card-t{font-weight:800;color:#f0e6d0;margin:10px 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hl-card .hl-card-t{margin-top:0}
.hl-dim{color:#a89880}.hl-small{font-size:.78rem}.hl-err{color:#ff8aa0}
.hl-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hl-row .hl-in{width:auto;flex:1;min-width:150px}
.hl-job{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);border-left:4px solid #6cd4ff;border-radius:10px;padding:10px 12px;margin-bottom:8px}
.hl-job.hl-claimed{border-left-color:#ffd166}.hl-job.hl-delivered{border-left-color:#9ad17a}.hl-job.hl-cancelled{border-left-color:#666;opacity:.7}
.hl-job-route{font-size:1rem}.hl-job-meta{font-size:.84rem;margin-top:3px}
.hl-job-act{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.hl-btn{background:#2a2d38;border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:9px;padding:8px 14px;font-weight:700;cursor:pointer}
.hl-btn:disabled{opacity:.45;cursor:default}
.hl-btn-go{background:linear-gradient(180deg,#ff9a40,#e06a1a);border-color:#ffb060;color:#1a0d00}
.hl-btn-sm{padding:3px 9px;font-size:.8rem}
.hl-empty{padding:18px;text-align:center;color:#a89880;border:1px dashed rgba(255,255,255,.12);border-radius:10px}
.hl-in{background:#0c0e14;border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:8px;padding:7px 9px;width:100%;box-sizing:border-box;font:inherit}
.hl-in-sm{width:76px;padding:4px 6px}
.hl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.hl-grid-4{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.hl-grid label{display:flex;flex-direction:column;gap:4px;font-size:.8rem;color:#c8bca8}
.hl-chk{display:inline-flex;align-items:center;gap:6px;font-size:.84rem;color:#e8e0d0;cursor:pointer}
.hl-chk input{width:auto}
.hl-route{margin-top:10px;padding:8px 10px;background:rgba(108,212,255,.08);border-radius:8px;font-size:.86rem}
.hl-tblwrap{overflow-x:auto}
.hl-tbl{width:100%;border-collapse:collapse;font-size:.84rem}
.hl-tbl th{text-align:left;color:#a89880;font-weight:600;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}
.hl-tbl td{padding:8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}
.hl-rankcard{display:flex;gap:16px;align-items:flex-start;border-color:var(--acc)}
.hl-rank-big{font-size:3.4rem;line-height:1;filter:drop-shadow(0 0 12px var(--acc))}
.hl-rank-name{font-size:1.3rem;font-weight:900;color:var(--acc)}
.hl-bars{display:grid;gap:5px;margin:10px 0;max-width:420px}
.hl-bar{display:grid;grid-template-columns:120px 1fr 32px;gap:8px;align-items:center;font-size:.78rem}
.hl-bar i{display:block;height:8px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden}
.hl-bar b{display:block;height:100%;background:var(--acc)}
.hl-bar em{font-style:normal;text-align:right}
.hl-run{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.84rem;flex-wrap:wrap}
.hl-result{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px}
.hl-result-card{background:#171a24;border:1px solid rgba(255,176,96,.4);border-radius:14px;padding:18px;width:min(460px,100%)}
.hl-result-t{font-size:1.4rem;font-weight:900;color:#ffb060;margin-bottom:10px}
.hl-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.hl-result-grid div{background:rgba(255,255,255,.05);border-radius:8px;padding:8px}
.hl-result-grid span,.hl-settle span{display:block;font-size:.72rem;color:#a89880}
.hl-settle div{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:8px;flex-wrap:wrap}
.hl-settle-big b{font-size:1.25rem;color:#9ad17a}
@media (max-width:640px){.hl-tab{min-width:100px;font-size:.8rem}.hl-rankcard{flex-direction:column}}
`;
  document.head.appendChild(s);
}
