/* ════════════════════════════════════════════════════════════════════════════
   ⚖ THE BID — what a company works out before it signs a lease.
   ----------------------------------------------------------------------------
   "Companies calculate traffic, population, income, rent, nearby competitors,
    transit, parking, tourism, crime, taxes, customer demographics. Then BID
    for locations."

   🔴 THE ONE RULE THIS FILE EXISTS TO KEEP: EVERY TERM IS A LIVE READ.
      Not one number below is typed in about the world. Each term names the
      sibling module it asked and the call it made (`TEN.bid.sources`), and the
      five factors from the brief that nothing in this game models are NOT
      scored, are listed in `OMITTED`, and are printed in the panel. Five of the
      eleven, said out loud, is the honest answer — a sixth invented row would
      make the whole list untrustworthy.

   🔴 THE ROWS SUM TO THE TOTAL, EXACTLY. Same contract /src/landvalue's
      `terms()` ships under and for the same reason: a causal list that does not
      add up is a decoration, and `verify()` re-adds it rather than asserting it.

   ⚠ EVERY SIBLING IS OPTIONAL, IN THE SAME DIRECTION. A module that is absent
     contributes a ZERO term, never a guessed one, and the term is flagged
     `n/a` so a reader can tell "this lot has no customers" from "nobody could
     be asked". A guarded read that silently substitutes a plausible value is
     indistinguishable from a working integration — the handover's own lesson.
   ════════════════════════════════════════════════════════════════════════════ */

import { TEN } from './tuning.js';

const W = () => (typeof window !== 'undefined' ? window : {});
const LV = () => { try { const m = W().MythicLandValue; return (m && m.ready && m.ready()) ? m : null; } catch (e) { return null; } };
const DEM = () => { try { const m = W().MythicDemographics; return (m && m.ready && m.ready()) ? m : null; } catch (e) { return null; } };
const TR = () => { try { return W().MythicTransit || null; } catch (e) { return null; } };
const ECO = () => { try { const m = W().MythicEconomy; return (m && m.ready && m.ready()) ? m : null; } catch (e) { return null; } };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/* The catchment radius. ASKED of /src/landvalue rather than held here, so the
   two models cannot come to disagree about how far "nearby" is. */
export function radiusOf() {
  const L = LV();
  try { if (L && L.tuning && L.tuning.radius > 0) return L.tuning.radius | 0; } catch (e) {}
  return TEN.radiusFallback;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE FIELD — everything city-wide the bid needs, measured once per refresh.
   ----------------------------------------------------------------------------
   Rebuilt on demand and cached for `ttl`, because `plan()` in /src/zoning
   re-derives itself on EVERY permit and each derivation asks for a bid on every
   vacant plot. Without this the demographics survey would be walked once per
   plot per permit.
   ══════════════════════════════════════════════════════════════════════════ */
export function makeField(ctx) {
  const keyOf = (x, z) => (ctx.key ? ctx.key(x, z) : x + ',' + z);
  let C = null, at = 0, ttl = 1200;
  let lots = new Map();

  function tiles() { try { return (ctx.game && ctx.game.tiles) || {}; } catch (e) { return {}; } }

  /* Every housing tile with its head count and its household income, from
     /src/demographics and nowhere else. `residents()` answers ok:false for a
     tile nobody lives in, which is a real answer and is treated as zero. */
  function homes() {
    const D = DEM(), out = [];
    if (!D) return out;
    const g = tiles();
    for (const k in g) {
      const t = g[k];
      if (!t || t.type !== 'housing') continue;
      let r = null;
      try { r = D.residents(k); } catch (e) { r = null; }
      if (!r || !r.ok) continue;
      const p = k.split(',');
      out.push({ k, x: +p[0], z: +p[1], n: num(r.residents), inc: num(r.income) });
    }
    return out;
  }

  /* Transit stops that the network actually SERVES. The gate is the same one
     /src/landvalue's own overlay uses: a stop on a line nobody rides is a bus
     shelter, not access, and `jobAccess().served` is the city's mode share. */
  function stops() {
    const T = TR(), L = LV();
    const out = { list: [], served: 0 };
    if (!T || typeof T.jobAccess !== 'function') return out;
    let a = null;
    try { a = T.jobAccess(); } catch (e) { a = null; }
    if (!a || !(a.served > 0)) return out;
    out.served = clamp(num(a.served), 0, 1);
    let wmap = null;
    try { wmap = L && L.tuning && L.tuning.transit ? L.tuning.transit.weight : null; } catch (e) { wmap = null; }
    const g = tiles();
    for (const k in g) {
      const t = g[k];
      if (!t || !wmap || !wmap[t.type]) continue;
      const p = k.split(','); out.list.push({ x: +p[0], z: +p[1] });
    }
    return out;
  }

  /* 📉 SATURATION — the city's own books, not a model of them.
     sim.js sets `f.idleForDemand = 1 - allowed/units` on every firm every day:
     the share of what it COULD make that nobody has ordered. Averaged over the
     firms already selling a resource, that is precisely "the city already has
     more of this trade than it needs", measured by the economy rather than
     asserted by this module. It is the term that makes over-zoning bite.
     ⚠ NO SELLERS ⇒ 0, and that is not a fallback: an unserved trade is not a
       saturated one, it is an opportunity, and the first shop should bid. */
  function saturation() {
    const E = ECO(), out = {};
    if (!E || typeof E.firms !== 'function') return out;
    let list = [];
    try { list = E.firms() || []; } catch (e) { list = []; }
    const acc = {};
    for (const f of list) {
      if (!f || !f.out) continue;
      const a = acc[f.out] || (acc[f.out] = { n: 0, idle: 0 });
      a.n++; a.idle += clamp(num(f.idleForDemand), 0, 1);
    }
    for (const id in acc) out[id] = { sellers: acc[id].n, idle: acc[id].idle / acc[id].n };
    return out;
  }

  function build() {
    const L = LV();
    const H = homes();
    let pop = 0, incW = 0;
    for (const h of H) { pop += h.n; incW += h.n * h.inc; }
    const D = DEM();
    let cityPop = pop;
    try { const p = D && D.population(); if (p != null && p > 0) cityPop = p; } catch (e) {}

    /* ── 📏 EVERY NORMALISER IS A RANK INSIDE THIS CITY ─────────────────────
       🔴 THIS WAS MEASURED WRONG FIRST AND THE FIX IS THE INTERESTING PART.
          `customers` began as `catchment ÷ CITY POPULATION` — "what share of the
          city's customers are on this doorstep". It is a perfectly honest ratio
          and it made the whole feature inert: driven on the real board, the
          best-sited plot in a 54-house city saw a single-digit percentage of the
          city, so the term paid ~2 points against a rent term of −6 to −22 and
          NOT ONE COMPANY IN THE POOL BID ON ANY LOT ANYWHERE. The auction
          silently handed every plot back to /src/zoning's hash and looked like
          it was working.

          The reason is that a bid is a CHOICE BETWEEN LOTS, not a verdict on a
          lot. What a company compares is this pitch against the others it could
          have — so the denominators are the best figures available IN THIS CITY,
          which is what `rent` was already doing (`value ÷ the dearest lot`).
          Making customers agree with it is what lets the terms trade off at all.
       ⚠ CONSEQUENCE, SAID OUT LOUD: growing the whole city's population does not
         raise anybody's bid, because every lot rises together. What moves a bid
         is where the people are RELATIVE to the alternatives — which is the
         question a location decision actually asks. The absolute figure is still
         published in the row's note (`N residents within R tiles`), so a reader
         can see both. */
    let maxVal = 0, maxNear = 0;
    const G = ctx.GRID | 0 || 24;
    if (L) {
      for (let x = 0; x < G; x++) for (let z = 0; z < G; z++) {
        const v = num(L.valueAt(x, z)); if (v > maxVal) maxVal = v;
      }
    }
    /* The best catchment on the board. Brute force over the grid × the housing
       tiles — 576 × (houses), once per refresh and cached, which is cheaper than
       any of the sibling calls it sits next to. */
    {
      const r = radiusOf();
      for (let x = 0; x < G; x++) for (let z = 0; z < G; z++) {
        let n = 0;
        for (const h of H) if (Math.abs(h.x - x) <= r && Math.abs(h.z - z) <= r) n += h.n;
        if (n > maxNear) maxNear = n;
      }
    }
    C = {
      r: radiusOf(),
      homes: H, cityPop: Math.max(0, cityPop),
      meanIncome: pop > 0 ? incW / pop : 0,
      stops: stops(), maxVal, maxNear, sat: saturation(),
      has: { land: !!L, demog: !!D, transit: !!TR(), eco: !!ECO() },
    };
    at = Date.now(); lots = new Map();
    return C;
  }

  function field(force) {
    if (force || !C || Date.now() - at > ttl) return build();
    return C;
  }

  /* ── PER-LOT, CANDIDATE-INDEPENDENT ─────────────────────────────────────── */
  function lot(x, z) {
    const F = field();
    const k = keyOf(x, z);
    const hit = lots.get(k);
    if (hit) return hit;
    const r = F.r;
    let near = 0, incW = 0;
    for (const h of F.homes) {
      if (Math.abs(h.x - x) > r || Math.abs(h.z - z) > r) continue;
      near += h.n; incW += h.n * h.inc;
    }
    let stop = 0;
    for (const s of F.stops.list) {
      if (Math.abs(s.x - x) <= r && Math.abs(s.z - z) <= r) { stop = 1; break; }
    }
    const L = LV();
    const val = L ? num(L.valueAt(x, z)) : 0;
    const o = {
      near, cityPop: F.cityPop,
      /* This lot's catchment against the BEST catchment on the board. Two
         measured head counts, no scale invented — see the note on `maxNear`. */
      customers: F.maxNear > 0 ? clamp(near / F.maxNear, 0, 1) : 0,
      /* Centred on the CITY mean, so the term is + in a well-off catchment and
         − in a poor one rather than always positive. */
      income: (F.meanIncome > 0 && near > 0) ? clamp((incW / near) / F.meanIncome - 1, -1, 1) : 0,
      transit: F.stops.served * stop,
      rentShare: F.maxVal > 0 ? clamp(val / F.maxVal, 0, 1) : 0,
      value: val,
      has: F.has,
    };
    lots.set(k, o);
    return o;
  }

  /* Standing buildings of the same TYPE inside the catchment. The host's own
     tile map — the one thing in this whole bid that needs no module at all. */
  function competitors(x, z, type) {
    const r = field().r, g = tiles();
    let n = 0;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (!dx && !dz) continue;
      const t = g[keyOf(x + dx, z + dz)];
      if (t && t.type === type) n++;
    }
    return n;
  }

  return { field, lot, competitors, invalidate: () => { C = null; lots = new Map(); }, keyOf };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE BID ITSELF.
   Returns { total, terms[], why } where Σ terms[].v === total, exactly.
   `src` on every row is 'live' or 'n/a' — an unaskable module scores 0 and
   SAYS it scored 0 for want of an answer, which is a different fact from a lot
   with no customers.
   ══════════════════════════════════════════════════════════════════════════ */
export function bidFor(F, cand, x, z, outOf) {
  const L = F.lot(x, z), w = TEN.bid.w, sz = cand.size;
  const out = outOf ? outOf(cand.want) : null;
  const sat = out ? (F.field().sat[out] || null) : null;
  const comp = F.competitors(x, z, cand.want);

  const rows = [
    { key: 'customers', ico: '👥', label: 'Customers in reach',
      raw: L.customers, v: w.customers * L.customers, src: L.has.demog ? 'live' : 'n/a',
      note: L.has.demog ? Math.round(L.near) + ' residents within ' + F.field().r + ' tiles — ' +
                          Math.round(L.customers * 100) + '% of the best catchment in the city (' +
                          Math.round(F.field().maxNear) + '), out of ' + Math.round(L.cityPop) + ' living here'
                        : '/src/demographics is not mounted' },
    { key: 'income', ico: '💷', label: 'Customer income',
      raw: L.income, v: w.income * L.income, src: L.has.demog ? 'live' : 'n/a',
      note: L.has.demog ? (L.income >= 0 ? '+' : '') + Math.round(L.income * 100) + '% against the city mean household income'
                        : '/src/demographics is not mounted' },
    { key: 'transit', ico: '🚌', label: 'Transit',
      raw: L.transit, v: w.transit * L.transit, src: L.has.transit ? 'live' : 'n/a',
      note: L.has.transit ? (L.transit > 0 ? 'a served stop is inside the catchment (mode share ' + Math.round(F.field().stops.served * 100) + '%)'
                                           : 'no served stop in reach') : '/src/transit is not mounted' },
    { key: 'rent', ico: '🏷', label: 'Rent',
      raw: -L.rentShare * sz.rentBearing, v: -w.rent * L.rentShare * sz.rentBearing, src: L.has.land ? 'live' : 'n/a',
      note: L.has.land ? L.value + ' ₵ ground — ' + Math.round(L.rentShare * 100) + '% of the dearest lot in the city, borne at ' + sz.name + ' scale (×' + sz.rentBearing + ')'
                       : '/src/landvalue is not mounted' },
    { key: 'competition', ico: '⚔', label: 'Nearby competitors',
      raw: -clamp(comp / TEN.bid.compFull, 0, 1), v: -w.competition * clamp(comp / TEN.bid.compFull, 0, 1), src: 'live',
      note: comp + ' of the same trade standing within ' + F.field().r + ' tiles' },
    { key: 'saturation', ico: '📉', label: 'Trade already over-supplied',
      raw: sat ? -sat.idle : 0, v: sat ? -w.saturation * sat.idle : 0, src: L.has.eco ? 'live' : 'n/a',
      note: !L.has.eco ? '/src/economy is not mounted'
            : !sat ? 'nobody sells this yet — the trade is open'
            : sat.sellers + ' firm' + (sat.sellers === 1 ? '' : 's') + ' already selling it, idle for want of orders ' + Math.round(sat.idle * 100) + '% of the time' },
  ];

  let total = 0;
  for (const r of rows) { r.v = Math.round(r.v * 1000) / 1000; total += r.v; }
  total = Math.round(total * 1000) / 1000;
  return { total, terms: rows, out, competitors: comp };
}

export default { makeField, bidFor, radiusOf };
