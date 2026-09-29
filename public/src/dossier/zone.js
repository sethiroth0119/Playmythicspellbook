/* ══════════════════════════════════════════════════════════════════════════
   🗺 ZONE & HOUSEHOLD WEALTH — two rows, both traced to something real.
   ──────────────────────────────────────────────────────────────────────────
   ZONE. If a zoning layer is mounted, IT is the authority and this module just
   reads it: a zone the player painted is a fact about the city, and deriving a
   second opinion beside it would be two answers to one question. With no
   zoning layer the zone is DERIVED from the building definition — `popCap`,
   `gen`, `use`, `svc`, `fin`, `defense`, `decorPts` are the only distinctions
   this game actually draws, so they are the only ones named. The density word
   comes from the tile's LEVEL, which is not decoration: makeHousing genuinely
   adds storeys per level, so a level-3 house IS the high-density case.

   HOUSEHOLD WEALTH. The economy layer owns wealth tiers if it is present
   (public/src/economy/households.js) and is asked first. It is not in every
   build, so there is a fallback — and the fallback is the part worth reading:

   🔴 THE WEALTH BAND IS A RANK, NOT A THRESHOLD, AND THAT IS DELIBERATE.
      The obvious version was `lotValue < 40 ⇒ Poor`. Three numbers pulled out
      of the air, in a codebase whose rule is that economy numbers are never
      hardcoded (CLAUDE.md, `_opEcon`). Worse, they would be wrong at both ends
      of the game: every house in a young city is "Poor" and every house in an
      old one is "Wealthy", because lotValue drifts upward with citySync and
      decorPoints city-wide. Ranking each home against the OTHER HOMES IN THIS
      CITY needs no constant, cannot drift, and is what "poor" means anyway —
      poor relative to your neighbours. The rank is printed next to the band so
      the label can always be checked against it.
   ══════════════════════════════════════════════════════════════════════════ */

function probe(obj, fns, args) {
  if (!obj) return null;
  for (const fn of fns) {
    if (typeof obj[fn] !== 'function') continue;
    for (const a of args) {
      let v = null;
      try { v = obj[fn].apply(obj, a); } catch (e) { v = null; }
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 48);
      if (v && typeof v === 'object') {
        for (const p of ['label', 'name', 'zone', 'tier', 'band', 'wealth']) {
          const q = v[p];
          if (typeof q === 'string' && q.trim()) return q.trim().slice(0, 48);
        }
      }
    }
  }
  return null;
}

/* ── ZONE ─────────────────────────────────────────────────────────────────── */
function zoningLayer() {
  try {
    if (typeof window === 'undefined') return null;
    return window.MythicZoning || window.MythicZones || window.NCZoning || null;
  } catch (e) { return null; }
}
import { isRoadTile } from '../roads/types.js';   // 🛣 the road resolver

export function zoneOf(C, k, t, x, z) {
  const fromModule = probe(zoningLayer(),
    ['zoneAt', 'zoneOf', 'zoneForTile', 'at', 'forTile', 'get'],
    [[x, z], [k]]);
  if (fromModule) return { label: fromModule, source: 'zoning' };

  const def = C.BUILDINGS[t.type] || {};
  const lvl = t.lvl || 1;
  let label;
  if (isRoadTile(t)) label = 'Street Network';
  else if (def.popCap > 0) {
    // The model really does gain storeys per level — see makeHousing.
    label = 'Residential — ' + (lvl >= 3 ? 'High' : lvl === 2 ? 'Medium' : 'Low') + ' Density Housing';
  } else if (def.fin) label = 'Office — Financial District';
  else if (def.gen && def.gen.cinder) label = 'Commercial — Retail';
  else if (def.svc) label = 'Commercial — Service';
  else if (def.gen && def.use) label = 'Industrial — Refining';
  else if (def.gen) label = 'Industrial — Extraction';
  else if (def.garrison || def.defense) label = 'Civic — Defence';
  else if (def.decorPts) label = 'Parks & Greenery';
  else {
    let sec = null;
    try { sec = C.sectionOf ? C.sectionOf(t.type) : null; } catch (e) { sec = null; }
    label = sec ? 'Civic — ' + sec.name : 'Civic';
  }
  return { label, source: 'derived' };
}

/* ── HOUSEHOLD WEALTH ─────────────────────────────────────────────────────── */
/* 👥 THE HOUSING LAYER IS ASKED FIRST, because it is the only source that
   answers about THIS HOUSEHOLD rather than about this plot of land:
   /src/demographics holds the cohort mix let at each address, and the books
   card two rows below now prints what those households earn. A rank by lot
   value beside a wage figure would be one panel holding two opinions.
   ⚠ ONLY WHEN A DWELLING HERE IS ACTUALLY LET. `residents()` reports tier
     "low" for an address with nobody in it (the mode of an empty tally), and
     printing "Struggling" over an empty house is a claim about people who do
     not exist. No tenant ⇒ fall through to the rank, which is a fact about the
     land and true either way. */
function demogWealth(k) {
  try {
    const D = (typeof window !== 'undefined') ? window.MythicDemographics : null;
    if (!D || typeof D.ready !== 'function' || !D.ready() || typeof D.residents !== 'function') return null;
    const r = D.residents(String(k));
    if (!r || !r.ok || !(r.occupied > 0) || !r.wealth || !r.wealth.label) return null;
    return r;
  } catch (e) { return null; }
}

function economyLayer() {
  try {
    if (typeof window === 'undefined') return null;
    const E = window.MythicEconomy;
    if (!E) return null;
    return E.households || E;
  } catch (e) { return null; }
}

const BANDS = ['Poor', 'Modest', 'Comfortable', 'Wealthy'];

/* The score a home is ranked by: its lot value, with its level as the
   tie-break. Both are the city's OWN numbers — lotValue() is index.html's and
   is already printed in this same panel's header. */
function scoreOf(C, k, t) {
  const p = String(k).split(',');
  let lv = 0;
  try { lv = C.lotValue(+p[0], +p[1]) | 0; } catch (e) { lv = 0; }
  return { lv, lvl: t.lvl || 1, s: lv * 100 + (t.lvl || 1) };
}

export function wealthOf(C, k, t, x, z) {
  const dw = demogWealth(k);
  if (dw) {
    return { label: dw.wealth.label, source: 'demographics',
      note: 'the band of the ' + dw.households.length + ' household' + (dw.households.length === 1 ? '' : 's') +
        ' actually let here (' + dw.households.map(h => h.label).slice(0, 2).join(', ') + ')' +
        (dw.income > 0 ? ', who earn ' + safeRate(C, dw.income) + ' 🔥 an economic day between them' : '') +
        (dw.rentBurden != null ? ' — rent takes ' + Math.round(dw.rentBurden * 100) + '% of it' : '') + '.' };
  }
  const fromModule = probe(economyLayer(),
    ['wealthOf', 'householdWealth', 'wealthAt', 'tierOf', 'bandOf'],
    [[k], [x, z]]);
  if (fromModule) return { label: fromModule, source: 'economy',
    note: 'from the economy layer’s own household tiers' };

  const def = C.BUILDINGS[t.type] || {};
  if (!(def.popCap > 0)) return null;          // only a home has a household

  const tiles = (C.game && C.game.tiles) || {};
  const all = [];
  for (const kk in tiles) {
    const tt = tiles[kk], dd = tt && C.BUILDINGS[tt.type];
    if (!dd || !(dd.popCap > 0)) continue;
    const s = scoreOf(C, kk, tt);
    all.push({ k: kk, lv: s.lv, lvl: s.lvl, s: s.s });
  }
  const me = scoreOf(C, k, t);
  if (all.length < 2) {
    return { label: 'Unranked', source: 'derived', rank: 1, of: all.length || 1,
      note: 'the only home in the city — there is nothing to rank it against. ' +
            'Lot value ' + me.lv + ' ₵ at level ' + me.lvl + '.' };
  }
  all.sort((a, b) => (a.s - b.s) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  let rank = 0;
  for (let i = 0; i < all.length; i++) if (all[i].k === k) { rank = i; break; }
  const q = Math.min(3, Math.floor((rank / all.length) * 4));
  return {
    label: BANDS[q], source: 'derived',
    rank: rank + 1, of: all.length, quartile: q,
    /* ⚠ THIS USED TO SAY "this city keeps no household income", and that stopped
       being true the day /src/demographics shipped — it prices a household's
       earnings off ECON.labor every tick. The sentence is now about what THIS
       PANEL could reach, which is the only thing it can honestly speak for. */
    note: 'ranked ' + (rank + 1) + ' of ' + all.length + ' homes by lot value (' +
          me.lv + ' ₵ at level ' + me.lvl + '). No housing layer answered for this ' +
          'address, so wealth is a rank against the other homes in this city rather than a wage.',
  };
}

/* C.rate is the panel's own formatter (insRate). Guarded because wealthOf is
   also called from the headless check, where a ctx may be a stub. */
function safeRate(C, v) { try { return C.rate(v); } catch (e) { return String(Math.round(v)); } }
