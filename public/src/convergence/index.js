/* ══════════════════════════════════════════════════════════════════════════
   ⟁ window.MythicConvergence — the Convergence summon (see convergence.logic.js
   for the rules and why every one of them is shaped the way it is).

   This file is the seam and the one piece of UI the feature owns:
     · the API the legacy app calls (sets, availability, AI, card text)
     · the material-set picker overlay the Realm Deck opens

   🔴 THE GLOBALS TRAP (CLAUDE.md). App / Profile / Forge / buildUnit /
   hexNeighbors are top-level `const` in index.html and are NOT on window. The
   only door is window.MythicConvergenceBridge, a classic script index.html
   runs just above this module's tag. Nothing here reaches for a bare global;
   every call below goes through bridge() and degrades to "nothing available"
   when the bridge is missing, so a page without it simply has no Convergence.

   ⚠ STATE. The only game state this feature writes is App.state, through
   bridge.commit — the same assignment every other action makes, so it rides
   the normal multiplayer snapshot and runs the graveyard reconciler. The
   picker's own selection lives in this module because it is UI, exactly as
   App.ui.archonMode is UI; it never needs to reach the other client.
   ══════════════════════════════════════════════════════════════════════════ */
import {
  isConvergence, isAnchor, specOf, findSets, validateSet, applyConvergence,
  ruleLine, CV_MAX_UNITS,
} from './convergence.logic.js';

const bridge = () => {
  try { return (typeof window !== 'undefined' && window.MythicConvergenceBridge) || null; } catch (e) { return null; }
};
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* The logic's `api`, built from the bridge on every call rather than cached —
   the bridge is a plain object index.html may replace, and a stale capture of
   it is the kind of bug that only shows after a hot reload. */
function api() {
  const B = bridge();
  if (!B) return null;
  return {
    neighbours: (x, y) => B.neighbours(x, y),
    cardOf: (u) => B.cardOf(u),
    buildUnit: (card, owner, pos) => B.buildUnit(card, owner, pos),
    hasPassive: (u, id) => B.hasPassive(u, id),
    applyOnPlay: (st, u, card) => B.applyOnPlay(st, u, card),
    leyElemAt: (st, x, y) => B.leyElemAt(st, x, y),
    elementName: (e) => B.elementName(e),
  };
}

/* The side's Convergence cards in its Realm Deck — asked of the bridge, which
   asks the same _realmDeckAllows gate Archons use, so "in your Realm Deck and
   owned" means one thing everywhere. */
function realmCards(side) {
  const B = bridge();
  if (!B || typeof B.realmCards !== 'function') return [];
  try { return (B.realmCards(side) || []).filter(isConvergence); } catch (e) { return []; }
}

/* ⚡ The availability glow is asked on EVERY render of the battle rail. The
   search is bounded, but a bounded search per card per frame is still waste.
   Memoised on the identity of state.units — every action that moves, kills or
   summons a unit replaces that array, so a stale answer cannot outlive the
   board it was computed for. */
let _memoUnits = null, _memo = new Map();
function setsFor(state, side, card, opts) {
  const A = api();
  if (!A || !state || !card) return { sets: [], truncated: false };
  if (!opts) {
    if (_memoUnits !== state.units) { _memoUnits = state.units; _memo = new Map(); }
    const k = side + '|' + card.id + '|' + JSON.stringify(card.convergence || {});
    if (_memo.has(k)) return _memo.get(k);
    const r = findSets(state, side, card, A);
    _memo.set(k, r);
    return r;
  }
  return findSets(state, side, card, A, opts);
}

function availableIds(side) {
  const B = bridge();
  const st = B && B.state();
  const out = [];
  if (!st) return out;
  for (const c of realmCards(side || 'player')) {
    try { if (setsFor(st, side || 'player', c).sets.length) out.push(c.id); } catch (e) {}
  }
  return out;
}

/* ── card text ─────────────────────────────────────────────────────────────── */
function elementName(e) {
  const B = bridge();
  try { return (B && B.elementName && B.elementName(e)) || e; } catch (err) { return e; }
}
function detailHtml(card) {
  if (!card) return '';
  let h = '';
  if (isAnchor(card)) {
    h += '<div class="cv-detail cv-detail-anchor"><div class="cv-detail-h">⚓ Anchor</div>'
      + '<div class="cv-detail-b">This unit can anchor a <strong>Convergence</strong>: with non-Anchor allies in one connected chain '
      + 'whose printed costs total the Convergence value, it becomes the tile the Convergence unit is summoned onto.</div></div>';
  }
  const sp = specOf(card);
  if (sp) {
    h += '<div class="cv-detail cv-detail-card"><div class="cv-detail-h">⟁ Convergence ' + sp.value + '</div>'
      + '<div class="cv-detail-b">' + esc(ruleLine(card, elementName)) + '.</div>'
      + '<div class="cv-detail-s">Summoned onto the Anchor\'s tile from your 🜂 Realm Deck. Every material goes to your graveyard.'
      + (sp.element ? ' If every material stands on ' + esc(String(elementName(sp.element)).toLowerCase()) + ' ley, it can act the turn it arrives.' : '')
      + '</div></div>';
  }
  return h;
}

/* ══ THE PICKER ═════════════════════════════════════════════════════════════
   One overlay for both cases the owner described: exactly one legal set reads
   as a confirm listing the materials; several read as a list to choose from,
   the selected chain drawn as a little hex map beside it. Always a Cancel. */
let _pick = null;   // { cardId, sets, idx }

function ensureStyle() {
  if (document.getElementById('cv-style')) return;
  const st = document.createElement('style');
  st.id = 'cv-style';
  st.textContent = [
    '.cv-back{position:fixed;inset:0;z-index:1500;background:rgba(6,4,14,.72);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.cv-modal{width:min(620px,100%);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#171127,#0d0a18);border:1px solid rgba(120,220,255,.55);border-radius:12px;box-shadow:0 0 28px rgba(80,200,255,.25);color:#e8e2f4;font-size:.9rem}',
    '.cv-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(120,220,255,.25)}',
    '.cv-title{font-family:Cinzel,serif;font-weight:800;color:#8fe3ff;letter-spacing:.06em;flex:1}',
    '.cv-sub{font-size:.78rem;color:#b9c7d8;margin-top:2px}',
    '.cv-body{padding:12px 16px;display:flex;gap:14px;flex-wrap:wrap}',
    '.cv-sets{flex:1 1 250px;display:flex;flex-direction:column;gap:6px;min-width:0}',
    '.cv-set{display:block;text-align:left;width:100%;padding:7px 10px;border-radius:8px;border:1px solid rgba(120,220,255,.3);background:rgba(40,110,160,.10);color:#dce8ff;cursor:pointer;font:inherit}',
    '.cv-set.on{border-color:#8fe3ff;background:rgba(80,200,255,.18);box-shadow:0 0 10px rgba(80,200,255,.25)}',
    '.cv-set-h{font-weight:700;font-size:.8rem;color:#8fe3ff}',
    '.cv-set-l{font-size:.8rem;line-height:1.45}',
    '.cv-ley{color:#c9a6ff;font-weight:700}',
    '.cv-map{flex:0 0 220px;min-height:160px;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(120,220,255,.3);border-radius:8px;background:rgba(10,20,40,.4)}',
    '.cv-foot{display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid rgba(120,220,255,.25)}',
    '.cv-btn{padding:8px 16px;border-radius:8px;border:1px solid rgba(120,220,255,.6);background:linear-gradient(180deg,#2a6f93,#173e57);color:#fff;font-weight:800;cursor:pointer;font:inherit;font-weight:800}',
    '.cv-btn.cancel{background:rgba(120,40,40,.35);border-color:rgba(255,120,120,.55)}',
    '.cv-detail{margin-top:.6rem;padding:.6rem .8rem;border:1px solid rgba(120,220,255,.45);border-radius:8px;background:rgba(80,200,255,.07)}',
    '.cv-detail-h{font-family:Cinzel,serif;font-weight:700;color:#8fe3ff;font-size:.88rem;margin-bottom:.3rem}',
    '.cv-detail-b{font-size:.82rem;color:#e6eef8;line-height:1.5}',
    '.cv-detail-s{font-size:.74rem;color:#a9bccc;margin-top:.35rem;line-height:1.45}',
    '.cv-realm-go{position:absolute;left:3px;right:3px;top:3px;z-index:3;font-size:9px;font-weight:800;padding:2px 0;border-radius:4px;border:1px solid #8fe3ff;background:rgba(20,70,100,.92);color:#dff6ff;cursor:pointer;box-shadow:0 0 8px rgba(80,200,255,.6)}',
  ].join('\n');
  document.head.appendChild(st);
}

/* The chain, drawn. Pixel layout only — which tiles TOUCH comes from the
   bridge's neighbours(), never from this geometry. Odd-r, pointy-top: odd rows
   sit half a hex to the right, as on the board. */
function chainSvg(set) {
  const A = api();
  if (!set || !set.tiles || !set.tiles.length) return '';
  const r = 20, w = Math.sqrt(3) * r;
  const pts = set.tiles.map(t => ({ t, px: t.x * w + ((t.y & 1) ? w / 2 : 0), py: t.y * 1.5 * r }));
  const minX = Math.min(...pts.map(p => p.px)) - w, maxX = Math.max(...pts.map(p => p.px)) + w;
  const minY = Math.min(...pts.map(p => p.py)) - r * 1.3, maxY = Math.max(...pts.map(p => p.py)) + r * 1.3;
  const hex = (cx, cy) => {
    const a = [];
    for (let i = 0; i < 6; i++) { const ang = Math.PI / 180 * (60 * i - 30); a.push((cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1)); }
    return a.join(' ');
  };
  const at = new Map(pts.map(p => [p.t.x + ',' + p.t.y, p]));
  let edges = '';
  for (const p of pts) {
    let nb = [];
    try { nb = A ? (A.neighbours(p.t.x, p.t.y) || []) : []; } catch (e) { nb = []; }
    for (const n of nb) {
      const q = at.get(n.x + ',' + n.y);
      if (q && (q.t.y > p.t.y || (q.t.y === p.t.y && q.t.x > p.t.x))) {
        edges += '<line x1="' + p.px.toFixed(1) + '" y1="' + p.py.toFixed(1) + '" x2="' + q.px.toFixed(1) + '" y2="' + q.py.toFixed(1) + '" stroke="#8fe3ff" stroke-width="3" stroke-linecap="round" opacity=".85"/>';
      }
    }
  }
  /* Layered: tiles, then the links, then the labels on top with a dark halo —
     the first cut drew the links under translucent tiles and they struck
     straight through the cost numbers. */
  const cells = pts.map(p => '<polygon points="' + hex(p.px, p.py) + '" fill="' + (p.t.anchor ? 'rgba(120,90,20,.85)' : 'rgba(20,60,90,.85)')
    + '" stroke="' + (p.t.anchor ? '#ffd86b' : '#8fe3ff') + '" stroke-width="2"/>').join('');
  const labels = pts.map(p => '<text x="' + p.px.toFixed(1) + '" y="' + (p.py + 5).toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="800" fill="#fff"'
    + ' stroke="#0b0b14" stroke-width="3" paint-order="stroke">' + (p.t.anchor ? '⚓' : '') + (p.t.cost | 0) + '</text>').join('');
  const W = Math.max(60, maxX - minX), H = Math.max(60, maxY - minY);
  return '<svg class="cv-chain" viewBox="' + minX.toFixed(1) + ' ' + minY.toFixed(1) + ' ' + W.toFixed(1) + ' ' + H.toFixed(1)
    + '" width="200" height="' + Math.min(220, Math.round(200 * H / W)) + '" aria-label="Material chain">'
    + cells + '<g opacity=".55">' + edges + '</g>' + labels + '</svg>';
}

function unitName(st, id) {
  const u = ((st && st.units) || []).find(x => x && x.id === id);
  return (u && u.name) || 'Unit';
}

function renderPicker() {
  closeDom();
  if (!_pick) return;
  const B = bridge();
  const st = B && B.state();
  const card = B && B.cardById(_pick.cardId);
  if (!st || !card) { _pick = null; return; }
  ensureStyle();
  const sp = specOf(card);
  const sets = _pick.sets;
  const idx = Math.max(0, Math.min(sets.length - 1, _pick.idx | 0));
  const one = sets.length === 1;
  /* Two copies of one card read identically, and then two different chains
     look like the same line twice. Where a name is shared by more than one
     unit across the offered sets, say which tile each one stands on. */
  const byName = new Map();
  sets.forEach(s => s.tiles.forEach(t => {
    const n = unitName(st, t.id);
    if (!byName.has(n)) byName.set(n, new Set());
    byName.get(n).add(t.id);
  }));
  const label = (t) => {
    const n = unitName(st, t.id);
    return esc(n) + ((byName.get(n) || new Set()).size > 1 ? ' <span style="opacity:.6">@' + t.x + ',' + t.y + '</span>' : '');
  };
  const list = sets.map((s, i) => {
    const parts = s.tiles.map(t => (t.anchor ? '⚓ ' : '') + label(t) + ' <span style="opacity:.7">(' + (t.cost | 0) + ')</span>').join(' + ');
    return '<button type="button" class="cv-set' + (i === idx ? ' on' : '') + '" data-cv-set="' + i + '">'
      + '<div class="cv-set-h">' + (one ? 'Materials' : 'Set ' + (i + 1)) + ' · total ' + s.total + (s.ley ? ' · <span class="cv-ley">ley ✓ ready</span>' : '') + '</div>'
      + '<div class="cv-set-l">' + parts + '</div></button>';
  }).join('');
  const el = document.createElement('div');
  el.className = 'cv-back';
  el.id = 'cv-overlay';
  el.innerHTML = '<div class="cv-modal" role="dialog" aria-modal="true" aria-label="Convergence">'
    + '<div class="cv-head"><div style="flex:1"><div class="cv-title">⟁ CONVERGENCE ' + sp.value + ' → ' + esc(card.name || 'Convergence') + '</div>'
    + '<div class="cv-sub">' + esc(ruleLine(card, elementName)) + '</div></div></div>'
    + '<div class="cv-body"><div class="cv-sets">'
    + (one ? '' : '<div class="cv-sub" style="margin:0 0 2px">' + sets.length + ' legal chains — pick the one to converge (weakest first).</div>')
    + list + '</div><div class="cv-map">' + chainSvg(sets[idx]) + '</div></div>'
    + '<div class="cv-sub" style="padding:0 16px 8px">All materials go to your graveyard. ' + esc(card.name || 'It') + ' is summoned onto the ⚓ Anchor\'s tile.</div>'
    + '<div class="cv-foot"><button type="button" class="cv-btn cancel" id="cv-cancel">✕ Cancel</button>'
    + '<button type="button" class="cv-btn" id="cv-confirm">⟁ CONVERGE</button></div></div>';
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) cancel(); });
  el.querySelectorAll('[data-cv-set]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); if (_pick) { _pick.idx = parseInt(b.getAttribute('data-cv-set'), 10) || 0; renderPicker(); } });
  });
  const c1 = el.querySelector('#cv-cancel'); if (c1) c1.addEventListener('click', cancel);
  const c2 = el.querySelector('#cv-confirm'); if (c2) c2.addEventListener('click', confirm);
}
function closeDom() {
  try { const o = document.getElementById('cv-overlay'); if (o) o.remove(); } catch (e) {}
}
function cancel() { _pick = null; closeDom(); }
function onKey(e) { if (_pick && e.key === 'Escape') { e.stopPropagation(); cancel(); } }
try { document.addEventListener('keydown', onKey, true); } catch (e) {}

/* Open the picker for one Convergence card in the player's Realm Deck. */
function open(cardId) {
  const B = bridge();
  if (!B) return false;
  const toast = (m) => { try { B.toast(m); } catch (e) {} };
  const st = B.state();
  if (!st || !B.isPlayerTurn()) { toast('⟁ You can only Converge on your own turn.'); return false; }
  const card = realmCards('player').find(c => c && c.id === cardId);
  if (!card) { toast('⟁ That card is not a Convergence in your Realm Deck.'); return false; }
  const r = setsFor(st, 'player', card);
  if (!r.sets.length) {
    toast('⟁ No legal chain for ' + (card.name || 'that card') + ' — ' + ruleLine(card, elementName) + '.');
    return false;
  }
  try { B.closeRealm(); B.render(); } catch (e) {}
  _pick = { cardId: card.id, sets: r.sets.slice(), idx: 0 };
  renderPicker();
  return true;
}

function confirm() {
  const B = bridge();
  const p = _pick;
  if (!B || !p) { cancel(); return; }
  const set = p.sets[p.idx | 0];
  const card = B.cardById(p.cardId);
  const res = converge('player', card, set && set.unitIds);
  cancel();
  if (!res || res.refused) { try { B.toast('⟁ Convergence refused — ' + ((res && res.refused) || 'the board changed.')); } catch (e) {} return; }
  try { B.afterAction(); } catch (e) {}
}

/* Headless resolve + commit, shared by the picker and the AI. Re-validates
   against the LIVE state — the overlay may have been open while the board
   moved (a trigger, the opponent's snapshot) — and never opens UI. */
function converge(side, card, unitIds) {
  const B = bridge();
  const A = api();
  if (!B || !A || !card) return null;
  const st = B.state();
  if (!st) return null;
  if (!realmCards(side).some(c => c && c.id === card.id)) return { refused: 'not in the Realm Deck' };
  const res = applyConvergence(st, { side, card, unitIds }, A);
  if (!res || res.refused) return res;
  B.commit(res.state);
  if (res.spawnedId) {
    try { const live = (B.state().units || []).find(u => u && u.id === res.spawnedId); if (live) B.markSummon(live); } catch (e) {}
    try { B.sfx('unitSummon'); } catch (e) {}
  }
  return res;
}

/* 🤖 The AI converges when a legal chain INCLUDES the unit whose step this is —
   so marking that unit as having acted is honest (it is in the graveyard now).
   Highest Convergence value first (the strongest body it can make), and within
   a card the weakest materials first, which is the order findSets returns. */
function aiTry(actingUnitId) {
  const B = bridge();
  const st = B && B.state();
  if (!st || st.turn !== 'ai') return null;
  const cards = realmCards('ai').slice().sort((a, b) => (specOf(b).value - specOf(a).value));
  for (const c of cards) {
    // The memoised "any chain at all?" first — it is shared with the rail glow
    // and answers most AI steps (nothing to do) without a second search.
    if (!setsFor(st, 'ai', c).sets.length) continue;
    const r = setsFor(st, 'ai', c, { mustInclude: actingUnitId || null, maxSets: 8 });
    if (!r.sets.length) continue;
    const res = converge('ai', c, r.sets[0].unitIds);
    if (res && !res.refused && res.spawnedId) return { spawnedId: res.spawnedId, name: res.name, ley: res.ley, cardId: c.id };
  }
  return null;
}

/* The Realm Deck tile's ⟁ Converge button is styled by this sheet too, and it
   renders before the picker ever opens — so the sheet goes in at load. */
try { if (typeof document !== 'undefined' && document.head) ensureStyle(); } catch (e) {}

try {
  window.MythicConvergence = {
    version: 'cv1',
    isConvergence, isAnchor, specOf, ruleLine: (c) => ruleLine(c, elementName),
    findSets: (st, side, card, opts) => setsFor(st, side, card, opts || { maxSets: 32 }),
    validate: (st, side, card, ids) => { const A = api(); return A ? validateSet(st, side, card, ids, A) : { ok: false, reason: 'no bridge' }; },
    apply: (st, opts) => { const A = api(); return A ? applyConvergence(st, opts, A) : null; },
    availableIds, open, cancel, converge, aiTry, detailHtml,
    isPickerOpen: () => !!_pick,
    MAX_UNITS: CV_MAX_UNITS,
  };
} catch (e) {}
