/* ══════════════════════════════════════════════════════════════════════════
   🏙 PHARMACY ↔ CITY — the node-city adapter. The counter where NPCs buy.
   ──────────────────────────────────────────────────────────────────────────
   node-city/index.html mounts this the way it mounts the House, the Stadium
   and the Outbreak: `mount(ctx)`, and the ctx object IS the hand-over.

   🔴 THE GLOBALS TRAP, again (CLAUDE.md). `game`, `BUILDINGS`, `cityPop`,
   `staffingRatio` and `insHalted` are top-level `const`/functions inside
   node-city's own module script and are invisible here. Everything arrives
   through ctx, and nothing that writes to `game.tiles` is handed over — the
   pharmacy READS which clinics and med labs are standing and never touches
   the store. The only things it changes are the shelf (its own blob) and the
   player's Cinder, through the bridge.

   🔴 THE HOSPITAL MAKES MEDICINE; THE CITY'S BUILDINGS RETAIL IT. A city with
   no Clinic and no Med Lab sells nothing however full the shelf is. That is
   the connection the feature exists for: the Medical Corporation is a
   business only once the player has somewhere in their city to sell from.

   ⚠ It ticks on the economy's own clock (economyTick's dtMin), the way the
   House does, so an outbreak spike and a sales spike land on the same beat
   and the offline catch-up — which slices the real economyTick — pays the
   counter for an absence at the rate the city actually had.
   ══════════════════════════════════════════════════════════════════════════ */

import * as HS from './state.js';
import * as PH from './pharma.js';

export const V = 1;

let CTX = null;
let SAVE_ACC = 0;
const SAVE_EVERY_MIN = 0.5;       // city minutes between persists of the shelf

const DISPENSARY_TYPES = { clinic: 1, medlab: 1 };

function dispensaries() {
  const c = CTX || {};
  const out = [];
  try {
    const tiles = (c.tiles && c.tiles()) || {};
    for (const k of Object.keys(tiles)) {
      const t = tiles[k];
      if (!t || !DISPENSARY_TYPES[t.type] || t.damaged) continue;
      // A clinic that has stalled for want of an input is a clinic with its
      // shutters down — same test the dossier uses.
      try { if (c.halted && c.halted(t)) continue; } catch (e) {}
      out.push({ key: k, type: t.type, lvl: Math.max(1, t.lvl | 0) });
    }
  } catch (e) {}
  return out;
}

function outbreak() {
  try {
    const O = (typeof window !== 'undefined') && window.MythicOutbreak;
    const r = O && typeof O.report === 'function' ? O.report() : null;
    return { cases: (r && r.cases) | 0, family: (r && r.worst && r.worst.strain && r.worst.strain.family) || null };
  } catch (e) { return { cases: 0, family: null }; }
}

export function context() {
  const c = CTX || {};
  const ob = outbreak();
  let pop = 0, staffing = 1;
  try { pop = +(c.pop && c.pop()) || 0; } catch (e) {}
  try { staffing = c.staffing ? +c.staffing() : 1; } catch (e) {}
  return {
    pop, staffing,
    dispensaries: dispensaries(),
    cases: ob.cases, family: ob.family,
    cityId: (function () { try { return (c.cityId && c.cityId()) || 'city'; } catch (e) { return 'city'; } })(),
  };
}

export function mount(ctx) {
  CTX = ctx || {};
  SAVE_ACC = 0;
  try { if (typeof window !== 'undefined') window.MythicPharmacy = api; } catch (e) {}
  return api;
}

/* Called from economyTick. `dtMin` is city minutes. */
export function tick(dtMin) {
  if (!CTX || !HS.ready()) return null;
  const ctx = context();
  if (!ctx.dispensaries.length) return null;
  const r = HS.counterTick(dtMin, ctx);
  SAVE_ACC += Math.max(0, +dtMin || 0);
  if (SAVE_ACC >= SAVE_EVERY_MIN) { SAVE_ACC = 0; try { if (r && r.units) HS.persist(); } catch (e) {} }
  if (r && r.units && CTX.logEvent && r.cinder >= 25) {
    // Reported per tick only when it is worth a line; the desk has the full log.
    try {
      const what = Object.keys(r.sold).map((pid) => PH.PRODUCTS[pid].icon + ' ' + r.sold[pid]).join(' · ');
      CTX.logEvent('💊 Dispensaries sold ' + what + ' — +' + r.cinder + ' 🔥');
    } catch (e) {}
  }
  return r;
}

/* What the city HUD / dossier prints for a clinic or med lab tile. '' when
   the pharmacy has nothing to add, so the caller can skip the row. */
export function tipLine(t) {
  try {
    if (!t || !DISPENSARY_TYPES[t.type]) return '';
    if (!HS.ready()) return '';
    const units = HS.shelfUnits();
    if (!units) return '<div style="color:#8fd4c8">💊 No medicine on the shelf — compound some at your Medical Corporation.</div>';
    const ctx = context();
    const rate = PH.customersPerMin(ctx);
    const share = ctx.dispensaries.length ? 1 / ctx.dispensaries.length : 1;
    const pr = prophylaxis();
    return '<div style="color:#8fd4c8">💊 Retailing ' + units + ' units of hospital medicine · ~' +
      (rate * share * 20).toFixed(1) + ' sales per city day here' +
      (ctx.cases > 0 ? ' · <span style="color:#ffb0ba">outbreak demand</span>' : '') +
      (pr > 0 ? ' · prophylaxis −' + Math.round(pr * 100) + '% outbreak pressure' : '') + '</div>';
  } catch (e) { return ''; }
}

/* 💊 The counter's effect on the city: doses sold in the last six hours,
   weighted by product, over population — see pharma.prophylaxisOf. Read by
   outbreak.js through the host adapter every pressure check, so it is
   cached on the sales beat rather than recomputed per call. */
let PROPH = { at: 0, v: 0 };
export function prophylaxis() {
  try {
    if (!HS.ready()) return 0;
    const now = Date.now();
    if (now - PROPH.at < 5000) return PROPH.v;
    let pop = 0; try { pop = +(CTX && CTX.pop && CTX.pop()) || 0; } catch (e) {}
    PROPH = { at: now, v: PH.prophylaxisOf(HS.sales(), pop, now) };
    return PROPH.v;
  } catch (e) { return 0; }
}

export function report() {
  const ctx = context();
  return { ctx, ratePerMin: PH.customersPerMin(ctx), shelf: HS.ready() ? HS.stock() : {}, units: HS.ready() ? HS.shelfUnits() : 0, prophylaxis: prophylaxis() };
}

const api = {
  mount, tick, tipLine, report, context, prophylaxis,
  /* 🔬 Test seam. RAF is dead in this environment's Browser pane, so the
     counter is driven by hand here: `_sell(mins)` runs that many city minutes. */
  _sell: (mins) => HS.counterTick(mins, context()),
  _state: () => HS.blob(),
};
export default api;
