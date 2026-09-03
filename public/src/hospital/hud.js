/* ══════════════════════════════════════════════════════════════════════════
   🖥 HUD — the hospital's 2D layer. Borrows the lab's chrome on purpose.
   ──────────────────────────────────────────────────────────────────────────
   The modal host, the toast stack, the prompt, the virtual stick and the
   panel styling are the containment lab's (/src/biolab/hud.js), imported
   rather than copied: the hospital's root carries BOTH classes (`bl-root
   hp-root`) so the lab's stylesheet lays it out and this file's overrides
   recolour it clinical. One modal() means one "detach the old handler before
   adding the new one" fix, not two — see the long note above the lab's.

   ⚠ EVERY STRING THAT COULD CONTAIN PLAYER DATA GOES THROUGH `esc`. Strain
   names, shipper names and carrier names come from other players.
   ══════════════════════════════════════════════════════════════════════════ */

import * as BL from '../biolab/hud.js';
import { SEALS, sealCount, exposureBand } from '../biolab/hazmat.js';
import { OBJECTIVES } from './floor.js';
import { PRODUCTS, PRODUCT_IDS, canMake, maxUnits, runCost, unitPrice, familyLabel } from './pharma.js';
import { GRADES } from '../plague/cures.js';

export const esc = BL.esc;
export const modal = BL.modal;
export const closeModal = BL.closeModal;
export const modalOpen = BL.modalOpen;
export const toast = BL.toast;
export const LAB_CSS = BL.CSS;

const num = (n) => (Number(n) || 0).toLocaleString();
const pct = (v) => Math.round((+v || 0) * 100) + '%';

export const CSS = `
.hp-root{background:#0b1216;color:#dde4ee}
.hp-root .bl-title{color:#8fd4c8}
.hp-root .bl-strain{color:#bfe8ff;background:#12202a;border-color:#244050}
.hp-root .bl-x:hover,.hp-root .bl-btn:hover:not(:disabled){border-color:#8fd4c8;color:#8fd4c8}
.hp-root .bl-btn.pri{background:#123028;border-color:#2f6f5c;color:#8fd4c8}
.hp-root .bl-panel h3{color:#8fd4c8}
.hp-root .bl-item.sel,.hp-root .bl-rg.sel{border-color:#8fd4c8}
.hp-root .bl-prompt kbd{color:#8fd4c8}
.hp-root .bl-act.hot{border-color:#8fd4c8;color:#8fd4c8}
.hp-root .bl-obj li.done{color:#8fd4c8}
.hp-root .bl-sealtxt{color:#9fb4c8}
.hp-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:7px;margin:10px 0}
.hp-prod{background:#111823;border:1px solid #202a38;border-radius:8px;padding:9px;font-size:11px;line-height:1.5}
.hp-prod.sel{border-color:#8fd4c8}
.hp-prod b{font-size:12px}
.hp-prod .meta{color:#8b93a3;font-size:10px;margin-top:3px}
.hp-prod.off{opacity:.5}
.hp-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px;margin:10px 0}
.hp-dial{height:16px;border-radius:8px;background:#1a222e;position:relative;overflow:hidden;margin:12px 0}
.hp-dial i{position:absolute;top:0;bottom:0;width:3px;background:#ffd166}
.hp-dial u{position:absolute;top:0;bottom:0;background:#2f6f5c;text-decoration:none}
.hp-ctl{display:flex;gap:6px;align-items:center;margin:8px 0}
.hp-ctl input[type=range]{flex:1}
.hp-ctl input[type=number]{width:74px;background:#0b0f16;border:1px solid #2b3644;color:#cfd8e6;border-radius:5px;padding:4px 6px;font:inherit;font-size:11px;text-align:center}
.hp-log{font-size:10.5px;color:#8b93a3;line-height:1.6}
.hp-log b{color:#dde4ee}
`;

/* ── the persistent overlay ─────────────────────────────────────────────── */
export function mountHud(root) {
  root.innerHTML = `
    <canvas class="bl-canvas"></canvas>
    <div class="bl-flatnote"></div>
    <div class="bl-layer">
      <div class="bl-top">
        <span class="bl-title">🏥 MEDICAL CORPORATION</span>
        <span class="bl-strain"></span>
        <span class="bl-spacer"></span>
        <button class="bl-x" data-act="exit">LEAVE ✕</button>
      </div>
      <div class="bl-gauges">
        <div class="bl-card">
          <h4>STERILE GOWN</h4>
          <div class="bl-seals"></div>
          <div class="bl-sealtxt"></div>
        </div>
        <div class="bl-card">
          <h4>EXPOSURE</h4>
          <div class="bl-expo"><i></i></div>
          <div class="bl-expo-lbl"><span class="band"></span><span class="val"></span></div>
        </div>
        <div class="bl-card">
          <h4>SHELF</h4>
          <div class="bl-sealtxt hp-shelfline"></div>
        </div>
      </div>
      <div class="bl-card bl-obj"><h4>SHIFT CHECKLIST</h4><ol></ol></div>
      <div class="bl-toasts"></div>
      <div class="bl-prompt"></div>
      <button class="bl-act" data-act="interact">USE</button>
      <div class="bl-stick"><div class="bl-stick-nub"></div></div>
      <div class="bl-modalhost"></div>
    </div>`;
  const q = (s) => root.querySelector(s);
  const nodes = {
    canvas: q('.bl-canvas'), flatnote: q('.bl-flatnote'), strain: q('.bl-strain'),
    seals: q('.bl-seals'), sealtxt: q('.bl-sealtxt'), expo: q('.bl-expo i'),
    expoBand: q('.bl-expo-lbl .band'), expoVal: q('.bl-expo-lbl .val'),
    shelf: q('.hp-shelfline'), obj: q('.bl-obj ol'), prompt: q('.bl-prompt'), act: q('.bl-act'),
    toasts: q('.bl-toasts'), modalhost: q('.bl-modalhost'),
  };
  nodes.seals.innerHTML = SEALS.map(() => '<div class="bl-seal"><i class="fill"></i></div>').join('');
  nodes.sealPips = Array.from(nodes.seals.querySelectorAll('.bl-seal'));
  nodes.obj.innerHTML = OBJECTIVES.map((o) => '<li data-obj="' + esc(o.key) + '"><b>○</b><span>' + esc(o.text) + '</span></li>').join('');
  nodes.objItems = {};
  for (const li of nodes.obj.querySelectorAll('li')) nodes.objItems[li.getAttribute('data-obj')] = li;
  return nodes;
}

export function refresh(nodes, st) {
  const suit = st.suit;
  const now = Date.now();
  for (let i = 0; i < nodes.sealPips.length; i++) {
    const s = SEALS[i], pip = nodes.sealPips[i], fill = pip.querySelector('.fill');
    const on = !!suit.seals[s.key];
    pip.classList.toggle('on', on);
    fill.style.width = (!on && suit.donning && suit.donning.key === s.key)
      ? (Math.min(1, (now - suit.donning.startedAt) / suit.donning.ms) * 100) + '%'
      : (on ? '100%' : '0');
  }
  const n = sealCount(suit);
  nodes.sealtxt.textContent = suit.sealed
    ? '✅ GOWNED — the clean room will run.'
    : suit.donning
      ? '⏳ ' + suit.donning.icon + ' ' + suit.donning.label + '… (' + (n + 1) + '/' + SEALS.length + ') — stand still.'
      : n === 0 ? '❌ Not gowned. Stand at the scrub station and press E.'
      : n + ' of ' + SEALS.length + ' seals — press E at the scrub station to resume.';

  const band = exposureBand(suit.exposure);
  nodes.expo.style.width = Math.min(100, suit.exposure * 260) + '%';
  nodes.expo.style.background = band.color;
  nodes.expoBand.textContent = band.label; nodes.expoBand.style.color = band.color;
  nodes.expoVal.textContent = (suit.exposure * 100).toFixed(1) + '%';

  nodes.shelf.textContent = st.shelfText || '—';

  for (const k of Object.keys(nodes.objItems)) {
    const done = !!st.done[k];
    nodes.objItems[k].classList.toggle('done', done);
    nodes.objItems[k].querySelector('b').textContent = done ? '●' : '○';
  }
  nodes.strain.textContent = st.chip || '';

  const near = st.near;
  if (!near) {
    nodes.prompt.classList.remove('on'); nodes.act.className = 'bl-act'; nodes.act.textContent = 'USE';
  } else {
    const s = near.station, blocked = st.blocked;
    nodes.prompt.classList.add('on');
    nodes.prompt.classList.toggle('blocked', !!blocked);
    nodes.prompt.innerHTML = blocked ? esc(blocked)
      : '<b>' + esc(s.icon + ' ' + s.name) + '</b> — ' + esc(s.prompt) + ' <kbd>E</kbd> <kbd>SPACE</kbd><br><span style="color:#77808f">' + esc(s.blurb) + '</span>';
    nodes.act.className = 'bl-act ' + (blocked ? 'no' : 'hot');
    nodes.act.textContent = blocked ? 'BLOCKED' : s.short;
  }
}

/* ══ PANELS — pure HTML strings ═══════════════════════════════════════════ */

function kpi(v, label, color) {
  return '<div class="bl-stat"><b style="color:' + (color || '#dde4ee') + '">' + v + '</b><span>' + esc(label) + '</span></div>';
}
function gradeChip(key) {
  const g = GRADES[key] || GRADES.inert;
  return '<span class="bl-grade" style="background:' + g.color + '22;color:' + g.color + ';border:1px solid ' + g.color + '55">' + esc(g.icon + ' ' + g.label) + '</span>';
}

export function deskPanel(ctx) {
  const { stats, day, week, atWard, transit, openLines, units, econ, sales, ownsResearch, ownsMedical } = ctx;
  const rate = econ ? num(econ.ratePerWorkerHr) : '—';
  const log = (sales || []).slice(0, 8).map((s) =>
    '<div class="hp-log">' + new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' +
    Object.keys(s.sold).map((pid) => (PRODUCTS[pid] ? PRODUCTS[pid].icon : '💊') + ' ' + s.sold[pid]).join(' · ') +
    ' → <b>+' + num(s.cinder) + ' 🔥</b></div>').join('');
  return '<h3>🏥 FRONT DESK</h3>' +
    '<p class="sub">The Medical Corporation, in numbers. Cures arrive by haulier from a Research Facility\'s containment lab; ' +
    'the ward opens them; the vault keeps a line of each; the clean room turns lines into medicine; the clinics and med labs ' +
    'in your city sell it to NPCs for Cinder.</p>' +
    (!ownsMedical ? '<div class="bl-warn">⚠ No Medical Corporation licence on this account. You can walk the building, but nothing here will trade until one is bought in Just Business → Found a Business.</div>' : '') +
    '<div class="hp-kpi">' +
      kpi('+' + num(day.cinder) + ' 🔥', 'SOLD · 24H', '#8fd4c8') +
      kpi(num(day.units), 'UNITS · 24H') +
      kpi('+' + num(week.cinder) + ' 🔥', 'SOLD · 7D', '#8fd4c8') +
      kpi(num(units), 'ON THE SHELF') +
      kpi(num(openLines), 'CURE LINES') +
      kpi(num(atWard), 'CRATES AT THE DOOR', atWard ? '#e0a860' : '#dde4ee') +
      kpi(num(transit), 'ON THE ROAD') +
      kpi(num(stats.runs | 0), 'RUNS · ALL TIME') +
    '</div>' +
    '<p class="sub">Prices are shares of this operation\'s own rate (' + rate + ' 🔥 per worker-hour). Staff it and level it in Just Business and every product on the counter is worth more.</p>' +
    (log ? '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:10px 0 6px">RECENT SALES</h4>' + log
         : '<div class="bl-empty">Nothing sold yet. Put medicine on the shelf and open your city — a Clinic or a Med Lab retails it.</div>') +
    '<div class="bl-row">' +
      (ownsResearch ? '<button class="bl-btn" data-act="go-lab">⚗️ CONTAINMENT LAB</button>' : '') +
      '<button class="bl-btn" data-act="go-ward">🛏 THE WARD</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function vaultPanel(ctx) {
  const { lines, sel } = ctx;
  if (!lines.length) {
    return '<h3>🧊 CONTAINMENT VAULT</h3>' +
      '<div class="bl-empty">Empty. A cure line appears here when a crate lands at a Medical Corporation you own and the ward ' +
      'administers it.<br><br><b>The chain:</b> Research Facility mixes it → Transportation Company hauls it → your ward opens it → ' +
      'the vault keeps samples → the clean room compounds them.</div>' +
      '<div class="bl-row"><button class="bl-btn" data-act="close">CLOSE</button></div>';
  }
  const rows = lines.map((l) => {
    const spent = l.status !== 'open' || (l.samples | 0) <= 0;
    return '<div class="bl-item' + (sel === l.id ? ' sel' : '') + (spent ? '" style="opacity:.5' : '') + '" data-act="pick-line" data-id="' + esc(l.id) + '">' +
      '<b>' + esc(l.strainName) + '</b> ' + (l.isolate ? '<span style="color:#8b93a3">' + esc(l.isolate) + '</span> ' : '') + gradeChip(l.grade) +
      '<div class="meta">' + esc(familyLabel(l)) + ' · efficacy ' + pct(l.efficacy) + ' · purity ' + (l.purity | 0) + '% · stability ' + (l.stability | 0) + '%' +
      ' · <b style="color:' + (spent ? '#8b93a3' : '#8fd4c8') + '">' + num(l.samples) + '/' + num(l.samplesTotal) + ' samples</b>' +
      (l.from ? ' · from ' + esc(l.from) : '') + (l.carrier ? ' via ' + esc(l.carrier) : '') +
      (l.status === 'discarded' ? ' · <span style="color:#ff8a94">DISCARDED</span>' : l.status === 'spent' ? ' · SPENT' : '') + '</div>' +
      (!spent ? '<div class="meta">' + PRODUCT_IDS.map((pid) => { const c = canMake(pid, l); return '<span title="' + esc(c.why) + '" style="color:' + (c.ok ? '#8fd4c8' : '#5f6878') + '">' + PRODUCTS[pid].icon + ' ' + (c.ok ? 'up to ' + num(maxUnits(pid, l)) : '✕') + '</span>'; }).join(' · ') + '</div>' : '') +
      '</div>';
  }).join('');
  return '<h3>🧊 CONTAINMENT VAULT</h3>' +
    '<p class="sub">Every delivered cure the ward opened, as a sample line. Samples are the scarce input — the clean room spends them, and there is no other way to get more than to receive more crates.</p>' +
    '<div class="bl-list">' + rows + '</div>' +
    '<div class="bl-row">' +
      '<button class="bl-btn danger" data-act="discard"' + (sel ? '' : ' disabled') + '>DISCARD LINE</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function stockPanel(ctx) {
  const { stock, econ, city, sel } = ctx;
  const cards = PRODUCT_IDS.map((pid) => {
    const p = PRODUCTS[pid], s = stock[pid];
    const units = s ? s.units | 0 : 0;
    return '<div class="hp-prod' + (sel === pid ? ' sel' : '') + (units ? '' : ' off') + '" data-act="pick-prod" data-id="' + esc(pid) + '">' +
      '<b>' + esc(p.icon + ' ' + p.name) + '</b><div class="meta">' + num(units) + ' on the shelf' +
      (s ? ' · quality ' + pct(s.quality) + ' · ' + num(unitPrice(pid, s.quality, econ)) + ' 🔥 each' : '') +
      (s && s.lineName ? '<br>from ' + esc(s.lineName) : '') + '</div></div>';
  }).join('');
  const cityLine = city
    ? (city.dispensaries ? '🏙 ' + city.dispensaries + ' dispensar' + (city.dispensaries === 1 ? 'y' : 'ies') + ' open in the city · ~' + (city.ratePerMin * 20).toFixed(1) + ' customers per city day' + (city.cases ? ' · <span style="color:#ffb0ba">outbreak demand ×' + city.boost.toFixed(1) + '</span>' : '')
                         : '🏙 Your city has no Clinic or Med Lab standing — nothing on this shelf can be sold until it does.')
    : '🏙 Open your city to sell. The counter runs inside it: Clinics and Med Labs there retail whatever is on this shelf.';
  return '<h3>📦 DISPENSARY STOCKROOM</h3>' +
    '<p class="sub">Finished medicine. Everything here is available to every Clinic and Med Lab in your city at once — NPCs buy it there, and the Cinder lands in your wallet as they do.</p>' +
    '<div class="hp-shelf">' + cards + '</div>' +
    '<div class="bl-item" style="border-color:#2f6f5c"><div class="meta">' + cityLine + '</div></div>' +
    '<div class="bl-row">' +
      '<button class="bl-btn danger" data-act="recall"' + (sel && stock[sel] ? '' : ' disabled') + '>RECALL &amp; DESTROY 10</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function compoundPanel(ctx) {
  const { lines, sel, have, econ } = ctx;
  if (!lines.length) {
    return '<h3>⚗️ COMPOUNDING LAB</h3>' +
      '<div class="bl-empty">No open cure line in the vault. The clean room compounds what a haulier delivered and the ward opened — nothing arrives that somebody did not send.</div>' +
      '<div class="bl-row"><button class="bl-btn" data-act="close">CLOSE</button></div>';
  }
  const line = lines.find((l) => l.id === sel.lineId) || lines[0];
  const lineRows = lines.map((l) => '<div class="bl-item' + (l.id === line.id ? ' sel' : '') + '" data-act="pick-line" data-id="' + esc(l.id) + '"><b>' +
    esc(l.strainName) + '</b> ' + gradeChip(l.grade) + '<div class="meta">' + esc(familyLabel(l)) + ' · ' + num(l.samples) + ' samples · stability ' + (l.stability | 0) + '%</div></div>').join('');
  const prods = PRODUCT_IDS.map((pid) => {
    const p = PRODUCTS[pid], c = canMake(pid, line);
    return '<div class="hp-prod' + (sel.productId === pid ? ' sel' : '') + (c.ok ? '' : ' off') + '" data-act="pick-prod" data-id="' + esc(pid) + '" title="' + esc(c.why) + '">' +
      '<b>' + esc(p.icon + ' ' + p.name) + '</b><div class="meta">' + esc(p.blurb) + '</div>' +
      '<div class="meta">' + Object.keys(p.inputs).map((id) => id + ' ×' + p.inputs[id]).join(' · ') + ' per unit · ' + p.perSample + ' units per sample · ~' + num(unitPrice(pid, 0.7, econ)) + ' 🔥 each</div>' +
      (c.ok ? '' : '<div class="meta" style="color:#ff8a94">' + esc(c.why) + '</div>') + '</div>';
  }).join('');
  const p = PRODUCTS[sel.productId];
  const ok = p ? canMake(p, line).ok : false;
  const max = p ? maxUnits(p, line) : 0;
  const units = Math.max(0, Math.min(sel.units | 0, max));
  const cost = p ? runCost(p, units) : { res: {}, samples: 0 };
  const shortIds = Object.keys(cost.res).filter((id) => (have[id] | 0) < cost.res[id]);
  const costLine = Object.keys(cost.res).map((id) => '<span style="color:' + ((have[id] | 0) < cost.res[id] ? '#ff8a94' : '#dde4ee') + '">' + id + ' ' + num(cost.res[id]) + '/' + num(have[id] | 0) + '</span>').join(' · ');
  return '<h3>⚗️ COMPOUNDING LAB</h3>' +
    '<p class="sub">Pick a line, pick a product, size the run, then titrate. The dial sets the yield; the line sets the quality; the gown sets whether it is fit to sell.</p>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:12px 0 6px">1 · THE LINE</h4><div class="bl-list">' + lineRows + '</div>' +
    '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:12px 0 6px">2 · THE PRODUCT</h4><div class="hp-shelf">' + prods + '</div>' +
    (p && ok
      ? '<h4 style="font-size:10px;letter-spacing:.14em;color:#8b93a3;margin:12px 0 6px">3 · THE RUN</h4>' +
        '<div class="hp-ctl"><input type="range" min="1" max="' + max + '" value="' + units + '" data-act="units=">' +
        '<input type="number" min="1" max="' + max + '" value="' + units + '" data-act="units="> <span style="font-size:11px;color:#8b93a3">of ' + num(max) + '</span></div>' +
        '<div class="bl-item"><div class="meta">Costs ' + num(cost.samples) + ' sample' + (cost.samples === 1 ? '' : 's') + ' · ' + costLine + '</div></div>'
      : '') +
    '<div class="bl-row">' +
      '<button class="bl-btn pri" data-act="titrate"' + (p && ok && units > 0 && !shortIds.length ? '' : ' disabled') + '>TITRATE &amp; COMPOUND</button>' +
      '<button class="bl-btn" data-act="close">CLOSE</button></div>';
}

export function dialPanel(ctx) {
  const { d, pos, running, result, product, units } = ctx;
  return '<h3>⚗️ TITRATION — ' + esc(product.icon + ' ' + product.name) + ' × ' + num(units) + '</h3>' +
    '<p class="sub">Stop the needle inside the band. Under-dose and half the run is filler; over-dose and it is unsellable. The band is this product\'s tolerance, narrowed by how shaky the cure line is.</p>' +
    '<div class="hp-dial"><u style="left:' + ((d.target - d.width / 2) * 100) + '%;width:' + (d.width * 100) + '%"></u><i style="left:' + ((pos || 0) * 100) + '%"></i></div>' +
    '<div class="bl-row">' +
      (result == null
        ? '<button class="bl-btn pri" data-act="dial-stop">' + (running ? 'STOP THE NEEDLE' : 'START') + '</button>'
        : '<button class="bl-btn pri" data-act="dial-commit">COMPOUND AT ' + pct(result) + '</button><button class="bl-btn" data-act="dial-retry">RE-TITRATE</button>') +
      '<button class="bl-btn" data-act="close">ABANDON</button></div>' +
    (result != null ? '<p class="sub" style="margin-top:10px">Titration <b style="color:' + (result > 0.7 ? '#8fd4c8' : result > 0.4 ? '#e0a860' : '#ff8a94') + '">' + pct(result) + '</b>. ' +
      (result > 0.7 ? 'Clean dose.' : result > 0.4 ? 'Uneven — some of the run will be lost.' : 'Off the band. Re-titrate unless you like waste.') + '</p>' : '');
}

export function labDoorPanel(ownsResearch) {
  return '<h3>⚗️ LAB CORRIDOR</h3>' +
    (ownsResearch
      ? '<p class="sub">Through here is the containment lab — the Research Facility side of the building, where cures are actually mixed and shipped.</p>' +
        '<div class="bl-row"><button class="bl-btn pri" data-act="go-lab">WALK THROUGH</button><button class="bl-btn" data-act="close">STAY</button></div>'
      : '<div class="bl-empty">Locked. The containment lab is a <b>Research Facility</b> licence — found one in Just Business, or buy cures from a player who has.<br><br>' +
        'A Medical Corporation without its own lab is still a business: other players\' hauliers deliver here.</div>' +
        '<div class="bl-row"><button class="bl-btn" data-act="close">CLOSE</button></div>');
}
