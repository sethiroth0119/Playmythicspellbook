/* ══════════════════════════════════════════════════════════════════════════
   👁 SOURCES — the event bus. Everything the feed is ever allowed to say
   originates in this file, and every function in it reads a LIVE number.

   🔴 THE ARCHITECTURE DECISION, and it is the one that keeps the feed alive:
      THIS LAYER OBSERVES, IT IS NOT NOTIFIED. Nothing else in the codebase
      calls into /src/broadcast. A push design — "every module remembers to
      tell the feed" — goes quiet the first time somebody adds a system and
      forgets, and it goes quiet SILENTLY, which is the exact failure mode
      .gauntlet/modcheck.mjs exists because of. A pull design can only go quiet
      by the module it reads disappearing, and then it says nothing about that
      module and everything about the rest.

   ⚠ …WITH ONE EXCEPTION, AND IT IS THE RIGHT ONE. `game.log` is ALREADY the
     city's event stream: construction completion, raids, weather, damage and
     departures all land there, capped and rendered. Re-deriving those from
     tile state would be a second opinion about events the city has already
     recorded. So half of this file is a CONSUMER of game.log, and the state
     observers below add only what the log does not carry — coverage
     shortfalls, the grid's demand ladder, the aquifers, the air, the
     demographic flows, the labour market and the price book.

   🔴 EVERY EVENT CARRIES ITS `why`. That string is the trace back to the
      reading that produced it, it rides the save with the post, and the API
      hands it to the UI. A post whose provenance cannot be printed is a post
      nobody should act on.
   ══════════════════════════════════════════════════════════════════════════ */
import { BCAST } from './tuning.js';
import { SUBJECTS } from './subjects.js';
import * as LK from './likes.js';
import { rngFrom, pickWeighted, hashStr } from './rng.js';

/* Guarded window reads. Every one of them may be absent — a 404 on any sibling
   module costs the feed that subject and nothing else. */
const W  = () => (typeof window !== 'undefined' ? window : {});
const CZ = () => { try { return W().MythicCitizens || null; } catch (e) { return null; } };
const PW = () => { try { return W().MythicPower || null; } catch (e) { return null; } };
const WA = () => { try { return W().MythicWater || null; } catch (e) { return null; } };
const PO = () => { try { return W().MythicPollution || null; } catch (e) { return null; } };
const DE = () => { try { return W().MythicDemographics || null; } catch (e) { return null; } };
const EC = () => { try { return W().MythicEconomy || null; } catch (e) { return null; } };
const NM = () => { try { return W().MythicNaming || null; } catch (e) { return null; } };
const ST = () => { try { return W().MythicStreets || null; } catch (e) { return null; } };
const RC = () => { try { return W().MythicResourceChain || null; } catch (e) { return null; } };

/* Severity 0..1 → the band whose words are true of it. */
export function bandOf(sev, pole) {
  if (pole === 'good') return sev >= BCAST.severity.notable ? 'great' : 'good';
  if (sev >= BCAST.severity.notable) return 'severe';
  if (sev >= BCAST.severity.mild) return 'notable';
  return 'mild';
}

const pct = (v) => Math.round(Math.max(0, Math.min(9.99, v)) * 100) + '%';
const num = (v) => Math.round(v).toLocaleString();

/* ── POSTER RESOLUTION ────────────────────────────────────────────────────
   A citizen post needs a citizen who is ACTUALLY in the situation. Weighting
   by mood is how that is done without inventing a per-citizen model of every
   subject: node-city's own moodOf already folds coverage, staffing and the
   power factor into one number per person, so the people worst served by a
   failing city are the people with the lowest mood, and they are the people
   likeliest to complain about it. Contented posts weight the other way.
   🔴 SEEDED. The same event always picks the same speaker, so a driver can
      assert on it and a reload cannot hand yesterday's complaint to somebody
      who was not there. */
export function pickCitizen(seedKey, pole) {
  const cz = CZ(); if (!cz || typeof cz.list !== 'function') return null;
  let rows = [];
  try { rows = cz.list() || []; } catch (e) { return null; }
  if (!rows.length) return null;
  const T = BCAST.thresholds;
  const cand = rows.map((c) => {
    const m = Number.isFinite(c.mood) ? c.mood : 50;
    /* Weight, never a hard filter: a city where everyone is miserable must
       still be able to produce a contented post from its least-miserable
       resident, and a hard filter would make whole subjects unreachable. */
    const w = pole === 'good'
      ? 0.15 + Math.max(0, (m - T.moodLow) / 100)
      : 0.15 + Math.max(0, (T.moodHigh - m) / 100);
    return { w, c };
  });
  const hit = pickWeighted(rngFrom('bccz|' + seedKey), cand);
  return hit ? hit.c : null;
}

/* The business at a tile, by the name it was actually given. */
function bizNameAt(key, fallback) {
  try { const n = NM(); if (n) { const v = n.nameFor(key); if (v) return v; } } catch (e) {}
  return fallback || null;
}
function addrOf(key) {
  try { const n = NM(); const a = n && n.address(key); return (a && a.full) || null; } catch (e) { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 1 — THE LOG ADAPTER.

   game.log is `[{t, k, m}]`, capped at LOG_MAX and saved at LOG_SAVE. The
   cursor is a TIMESTAMP plus the hashes of the entries already consumed at
   that exact millisecond — not an index. Indexes are wrong here twice over:
   logEvent() splices off the front when the ring fills, and loadState()
   replaces the whole array. A timestamp cursor survives both, and the hash set
   is what stops two events logged in the same millisecond from costing each
   other. The cursor RIDES THE SAVE, so a returning player is not handed a feed
   full of posts about the forty log lines that were already on disk.
   ══════════════════════════════════════════════════════════════════════════ */
let logT = 0;
let logAtT = new Set();

export function logCursor() { return { t: logT, h: Array.from(logAtT) }; }
export function setLogCursor(c) {
  logT = (c && Number.isFinite(+c.t)) ? +c.t : 0;
  logAtT = new Set((c && Array.isArray(c.h)) ? c.h : []);
}
export function resetLog() { logT = 0; logAtT = new Set(); }

/* Seed the cursor to "everything already in the log has been seen". Called on
   the very first mount of a city whose save predates this module. */
export function skipExistingLog(game) {
  try {
    const rows = (game && game.log) || [];
    if (!rows.length) return;
    logT = rows[rows.length - 1].t | 0;
    logAtT = new Set(rows.filter((e) => (e.t | 0) === logT).map((e) => hashStr(e.m)));
  } catch (e) {}
}

const TILE_RE = /\bat (-?\d+,-?\d+)\b/;

/* One log line → zero or one events. Returns null for the many lines that are
   real and true and simply not worth a post (a repair receipt, a licence
   collection); the feed is not the log with avatars on it. */
function fromLogRow(row, ctx) {
  const m = String(row.m || '');
  const fam = String(row.k || '').split(' ')[0];
  const key = (m.match(TILE_RE) || [])[1] || null;
  const at = row.t | 0;
  const base = { at, src: 'log', key: 'log|' + at + '|' + hashStr(m) };

  /* 🏗 A BUSINESS OPENS AND SAYS SO ITSELF. This is the brief's "A new business
     was built, it tells the NPCs they are open for business", and the poster is
     the business BY NAME — /src/naming already gave it one, so the feed uses it
     rather than printing "Farm".  */
  if (/finished construction\.?$/.test(m) && key) {
    const t = ctx.game.tiles[key];
    const def = t && ctx.BUILDINGS[t.type];
    const nm = bizNameAt(key, def && def.name);
    if (!nm) return null;
    /* AFFECTED: the people this opening is true for — the crew it can seat.
       Deliberately not "the whole city": an opening is local news, and scoring
       it citywide would let a single shop outrank a water shortage. */
    const crew = (def && def.crew) | 0;
    return { ...base, subject: 'opening', pole: 'good', severity: 0.5,
             affected: Math.max(1, crew),
             facts: { p: addrOf(key) ? nm + ', ' + addrOf(key) : nm, n: crew > 0 ? String(crew) : null },
             posterKind: 'company', poster: { name: nm, sub: (def && def.name) || null, ico: def && def.ico },
             why: 'construction completed at ' + key };
  }

  /* 💥 DAMAGE and DESTRUCTION — already in the log with the cause on it. */
  if (/\bDESTROYED\b/.test(m) || /\bdamaged\b/.test(m)) {
    const destroyed = /\bDESTROYED\b/.test(m);
    const t = key ? ctx.game.tiles[key] : null;
    const def = t && ctx.BUILDINGS[t.type];
    const nm = (key && bizNameAt(key, def && def.name)) || (m.match(/(?:DESTROYED|damaged) ([^(]+?) \(/) || [])[1];
    if (!nm) return null;
    const crew = (def && def.crew) | 0;
    return { ...base, subject: 'damage', pole: 'bad', severity: destroyed ? 0.8 : 0.45,
             affected: Math.max(1, crew), facts: { p: nm.trim() },
             posterKind: destroyed ? 'dept' : 'citizen',
             why: (destroyed ? 'destroyed: ' : 'damaged: ') + nm.trim() };
  }

  /* 🛡 RAIDS. HELD and BREACHED are both news, in opposite directions. */
  if (fam === 'raid') {
    const held = /\bHELD\b/.test(m), breached = /\bBREACHED\b/.test(m);
    if (!held && !breached) return null;
    const wave = (m.match(/[Ww]ave (\d+)/) || [])[1] || null;
    const pop = ctx.cityPop();
    /* A raid is true for everyone in the city — it is the one subject where a
       citywide headcount is the honest reading rather than an inflation. */
    return { ...base, subject: 'raid', pole: held ? 'good' : 'bad',
             severity: breached ? 0.85 : 0.4,
             affected: Math.max(1, Math.round(pop)),
             facts: { n: num(pop), v: wave },
             posterKind: breached ? 'dept' : 'citizen',
             why: held ? 'raid wave held' : 'raid wave breached' };
  }

  /* ⚠ THERE IS DELIBERATELY NO DEPARTURE BRANCH HERE, and that is a finding
     rather than an omission. The first cut parsed "X left the city" out of the
     log — a line that /src/city/citizens.city.js really does write, and which
     nothing in the shipped game ever emits: node-city grew its OWN roster and
     that module is not mounted (see its header, "WHERE THE LIVE ROSTER
     ACTUALLY IS"). So the branch was a parser for a string with no writer,
     i.e. a life-path feature that would have shipped permanently silent and
     looked implemented in review. Departures, arrivals, hirings and layoffs
     are observed off the ROSTER instead — rosterDiff() below. */
  return null;
}

export function consumeLog(ctx, limit) {
  const out = [];
  let rows = [];
  try { rows = (ctx.game && ctx.game.log) || []; } catch (e) { return out; }
  let newestT = logT;
  const newestSet = new Set(logAtT);
  for (const r of rows) {
    const t = r.t | 0;
    if (t < logT) continue;
    const h = hashStr(r.m);
    if (t === logT && logAtT.has(h)) continue;
    if (t > newestT) { newestT = t; newestSet.clear(); }
    if (t === newestT) newestSet.add(h);
    if (out.length < (limit || 8)) {
      try { const ev = fromLogRow(r, ctx); if (ev) out.push(ev); } catch (e) {}
    }
  }
  logT = newestT; logAtT = newestSet;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   PART 2 — THE STATE OBSERVERS. What game.log does not carry.
   ══════════════════════════════════════════════════════════════════════════ */

/* 🍱 COVERAGE. The seven NEEDs node-city already computes every tick, read
   straight off `game.cov.pct` — the same numbers the vitals card prints, so
   the feed and the panel can never disagree about how bad it is. */
function fromCoverage(ctx, pop) {
  const out = [];
  const T = BCAST.thresholds;
  const pctMap = (ctx.game.cov && ctx.game.cov.pct) || {};
  /* 🪦 `deathcare` is node-city's EIGHTH need as of this round and it needs
     nothing here but its row: severity, affected count, provenance and both
     polarities all fall out of the loop below exactly as they do for Health.
     That is the whole of the "the complaint is free, not built" claim — the
     shortfall reaches the phone feed, the vitals card, the demand panel's fix
     list and the talk dialog through four mechanisms that already existed. */
  const MAP = { food: 'food', water: 'water', power: 'power', safety: 'safety',
                health: 'health', leisure: 'leisure', light: 'light',
                deathcare: 'deathcare' };
  for (const need in MAP) {
    const p = pctMap[need];
    if (!Number.isFinite(p)) continue;
    const subject = MAP[need];
    if (p < T.covBad) {
      const sev = Math.max(0, Math.min(1, (T.covBad - p) / T.covBad));
      const aff = LK.fromCoverage(pop, p);
      if (aff == null) continue;
      out.push({ src: 'cov', key: 'cov|' + need + '|' + Math.round(p * 20),
                 subject, pole: 'bad', severity: sev, affected: aff,
                 facts: { n: num(aff), v: pct(p) },
                 why: (ctx.NEED_META[need] ? ctx.NEED_META[need].name : need) +
                      ' coverage ' + pct(p) + ' of demand' });
    } else if (p > T.covGood) {
      /* 🔴 THE CONTENTED SIDE, AND WHY IT SCORES THE WAY IT DOES. `affected`
         here is how many people are WELL served — the number the post is true
         for. See likes.js: one rule, both polarities. */
      const sev = Math.max(0, Math.min(1, (p - T.covGood) / 0.5));
      const aff = LK.fromCoverageGood(pop, Math.min(1, p));
      if (aff == null) continue;
      out.push({ src: 'cov', key: 'covg|' + need + '|' + Math.round(p * 20),
                 subject, pole: 'good', severity: sev, affected: aff,
                 facts: { n: num(aff), v: pct(p) },
                 why: (ctx.NEED_META[need] ? ctx.NEED_META[need].name : need) +
                      ' coverage ' + pct(p) + ' of demand' });
    }
  }
  return out;
}

/* ⚡ THE GRID. /src/power's own solve, not the coverage proxy — this is what
   gives the Electricity Department the reference post's actual content:
   "our production is not meeting demand, so we're forced to import". */
function fromPower(ctx, pop) {
  const p = PW(); if (!p || typeof p.supply !== 'function') return [];
  let s = null; try { s = p.supply(); } catch (e) { return []; }
  if (!s || !(s.capacity > 0 || s.load > 0)) return [];
  const T = BCAST.thresholds;
  const f = Number.isFinite(s.factor) ? s.factor : 1;
  if (f >= T.powerFactor) {
    if (s.capacity <= s.load * 1.15) return [];
    return [{ src: 'power', key: 'pwrg|' + Math.round(s.capacity / Math.max(1, s.load) * 10),
              subject: 'power', pole: 'good', severity: 0.5,
              affected: Math.round(pop), facts: {},
              why: 'grid factor ' + f.toFixed(3) + ', capacity ' + Math.round(s.capacity) +
                   ' vs load ' + Math.round(s.load) }];
  }
  const sev = Math.max(0, Math.min(1, (1 - f) / 0.5));
  const aff = LK.fromPowerFactor(pop, f);
  const short = Math.max(0, s.load - s.capacity);
  return [{ src: 'power', key: 'pwr|' + Math.round(f * 50),
            subject: 'power', pole: 'bad', severity: sev, affected: aff,
            facts: { n: num(aff), v: short > 0 ? num(short) + ' units' : pct(1 - f) },
            why: 'grid factor ' + f.toFixed(3) + ', load ' + Math.round(s.load) +
                 ' vs capacity ' + Math.round(s.capacity) }];
}

/* 💧 THE AQUIFERS. shortfall/draw is the fraction that transfers to people;
   the absolute figure is in the module's own per-minute ledger units and
   printing it as a headcount would be a unit error that looks correct. */
function fromWater(ctx, pop) {
  const w = WA(); if (!w || typeof w.supply !== 'function') return [];
  let s = null; try { s = w.supply(); } catch (e) { return []; }
  if (!s || s.model !== 'hydro' || !(s.draw > 0)) return [];
  const T = BCAST.thresholds;
  const frac = Math.max(0, Math.min(1, (s.shortfall || 0) / s.draw));
  const out = [];
  /* 🔴 TWO DIFFERENT SHORTAGES, AND CONFLATING THEM SHIPPED THE LOUDEST WRONG
     POST IN THE FEED. /src/water's `shortfall` is draw MINUS CAPACITY in the
     module's per-minute ledger units — a PRODUCTION fact about the hydrology
     ("we are asking the ground for more than it yields"). node-city's
     `game.cov.pct.water` is the SERVICE fact the vitals card already prints to
     the player ("are the taps running"), and it is fed from stock, so a city
     can out-pump its aquifers for a long time with coverage still at 100%.
     The verifier found five posts a session screaming "the city is completely
     short of water, 8 residents unserved and rationing is in force" while
     `game.cov.pct.water === 1`. Nobody was unserved and nothing was rationed.
     So: the RATIONING claim is gated on the host's own coverage number, and the
     hydrology figure gets its own subject that says what it actually means.
     ⚠ `demandKnown` false means drinkPerMin never arrived from the host, so
     `draw` is missing the entire population term — a shortfall fraction built
     on it is meaningless and must not be published at all. */
  const cov = (ctx.game && ctx.game.cov && ctx.game.cov.pct) || {};
  const served = Number.isFinite(cov.water) ? cov.water : 1;
  const unserved = Math.max(0, 1 - served);
  if (s.demandKnown && unserved > T.waterShortFrac) {
    out.push({ src: 'water', key: 'wat|' + Math.round(unserved * 20),
               subject: 'water', pole: 'bad',
               severity: Math.max(0, Math.min(1, unserved / 0.5)),
               affected: Math.round(pop * unserved),
               facts: { n: num(Math.round(pop * unserved)), v: pct(unserved) },
               why: 'water coverage ' + pct(served) + ' of demand (game.cov.pct.water)' });
  }
  /* The hydrology one, worded as what it is: over-extraction, not thirst. */
  if (s.demandKnown && frac > T.waterShortFrac) {
    out.push({ src: 'water', key: 'watdraw|' + Math.round(frac * 20),
               subject: 'water_draw', pole: 'bad',
               severity: Math.max(0, Math.min(1, frac / 0.5)),
               affected: LK.fromWaterShortfall(pop, s),
               facts: { n: num(LK.fromWaterShortfall(pop, s) || 0), v: pct(frac) },
               why: 'extraction shortfall ' + pct(frac) + ' of draw (aquifer yield, not taps)' });
  }
  /* Purity is a DIFFERENT subject from supply, and conflating them was the
     first cut: "the taps are dry" and "the water is filthy" are two problems
     with two fixes, and one post claiming both would misdirect the player. */
  if (Number.isFinite(s.purity) && s.purity < 0.9) {
    out.push({ src: 'water', key: 'watq|' + Math.round(s.purity * 20),
               subject: 'water_q', pole: 'bad',
               severity: Math.max(0, Math.min(1, (0.9 - s.purity) / 0.6)),
               affected: Math.round(pop),
               facts: { n: num(pop), v: pct(1 - s.purity) },
               why: 'aquifer purity ' + pct(s.purity) });
  }
  return out;
}

/* ☁ THE AIR. `exposure()` is /src/pollution's POPULATION-WEIGHTED reading —
   it already accounts for where people actually live, which is exactly the
   headcount question likes.js asks. pop × exposure is therefore a derived
   headcount and not a rescaled index. */
function fromPollution(ctx, pop) {
  const P = PO(); if (!P || typeof P.ready !== 'function' || !P.ready()) return [];
  let ex = 0, air = 0;
  try { ex = +P.exposure() || 0; const st = P.state(); air = (st && st.airAtPeople) || 0; } catch (e) { return []; }
  const T = BCAST.thresholds;
  if (ex > T.airBad) {
    return [{ src: 'pollution', key: 'air|' + Math.round(ex * 20),
              subject: 'air', pole: 'bad',
              severity: Math.max(0, Math.min(1, ex)),
              affected: Math.round(pop * Math.min(1, ex)),
              facts: { n: num(pop * Math.min(1, ex)), v: pct(Math.min(1, ex)) },
              why: 'citizen air exposure ' + ex.toFixed(3) }];
  }
  if (ex < 0.04 && pop > 0) {
    return [{ src: 'pollution', key: 'airg|' + Math.round(air * 100),
              subject: 'air', pole: 'good', severity: 0.4,
              affected: Math.round(pop), facts: {},
              why: 'citizen air exposure ' + ex.toFixed(3) }];
  }
  return [];
}

/* 👥 LIFE PATH — /src/demographics. Graduations between education rungs,
   arrivals, and departures WITH A REASON (rent burden vs jobless). This is the
   brief's life-path integration, and it is already computed: the flows are on
   the report, per economic day. */
function fromDemographics(ctx, pop) {
  const D = DE(); if (!D || typeof D.ready !== 'function' || !D.ready()) return [];
  let r = null; try { r = D.report(); } catch (e) { return []; }
  if (!r || !r.ok) return [];
  const out = [];
  const T = BCAST.thresholds;
  const day = r.flow || {};

  if ((day.grad | 0) >= 1) {
    out.push({ src: 'demog', key: 'grad|' + Math.round(day.grad),
               subject: 'grad', pole: 'good', severity: 0.5,
               affected: null, personal: true, facts: {},
               why: (day.grad | 0) + ' residents graduated last cycle' });
  }
  if ((day.evicted | 0) >= 1) {
    out.push({ src: 'demog', key: 'rent|' + Math.round(day.evicted) + '|' + Math.round(r.rentIndex * 10),
               subject: 'rent', pole: 'bad',
               severity: Math.max(0, Math.min(1, (day.evicted | 0) / Math.max(4, pop * 0.05))),
               affected: LK.fromPeople(day.evicted),
               facts: { n: num(day.evicted), v: (r.rentIndex || 0).toFixed(2) },
               why: num(day.evicted) + ' priced out last cycle, rent index ' + (r.rentIndex || 0).toFixed(2) });
  }
  /* ⚠ NO ARRIVAL EVENT HERE. `flow.in` is an aggregate — "3.4 residents
     arrived" — and the roster diff below names the actual person who turned
     up. Two sources for one fact would give the player two arrival posts for
     the same arrival, one of them anonymous. Graduation stays here because it
     is a cohort transition the roster cannot see. */
  if (r.netPerDay < -T.netOutPerDay) {
    /* The reason the pipeline itself gives, not one this module guessed. */
    const cause = (r.limitText || '').slice(0, 60) || 'the city cannot hold them';
    out.push({ src: 'demog', key: 'net|' + Math.round(r.netPerDay),
               subject: 'rent', pole: 'bad',
               severity: Math.max(0, Math.min(1, -r.netPerDay / Math.max(6, pop * 0.08))),
               affected: LK.fromPeople(-r.netPerDay),
               facts: { n: num(-r.netPerDay), v: r.netPerDay.toFixed(1) + '/day' },
               why: 'net ' + r.netPerDay.toFixed(1) + '/day — ' + cause });
  }
  return out;
}

/* 💹 THE MARKET, THE EXCHANGE AND THE CRASH — the brief asked for these by
   name. Every figure is /src/economy's own: the price book, the firm rungs and
   the labour market. Nothing here re-prices anything (CLAUDE.md: no resource
   price is written down anywhere). */
function fromEconomy(ctx, pop) {
  const E = EC(); if (!E || typeof E.ready !== 'function' || !E.ready()) return [];
  let snap = null, movers = [];
  try { snap = E.snapshot(); movers = E.movers(4) || []; } catch (e) { return []; }
  if (!snap) return [];
  const out = [];
  const T = BCAST.thresholds;
  const basket = (() => { try { return E.basket || {}; } catch (e) { return {}; } })();
  const nameOfRes = (id) => {
    try { const c = RC(); const r = c && c.byId && c.byId(id); if (r && r.name) return r.name; } catch (e) {}
    return String(id);
  };

  for (const mv of movers) {
    const swing = Math.log(Math.max(1e-6, mv.mul || 1));
    if (Math.abs(swing) < T.priceMove) continue;
    const up = swing > 0;
    const inBasket = Object.prototype.hasOwnProperty.call(basket, mv.id);
    /* Consumers of an industrial input: the firms that eat it, and the people
       they employ. Asked of the economy rather than estimated. */
    let heads = 0;
    try {
      for (const f of (E.firms() || [])) {
        const rec = E.recipes && E.recipes.byId ? E.recipes.byId(f.out) : null;
        if (rec && rec.inputs && rec.inputs.some((i) => i.id === mv.id)) heads += (f.workers | 0) || 1;
      }
    } catch (e) { heads = 0; }
    const aff = LK.fromMarket(pop, inBasket, heads);
    if (aff == null || aff <= 0) continue;
    out.push({ src: 'econ', key: 'mkt|' + mv.id + '|' + Math.round(swing * 10),
               subject: 'market', pole: up ? 'bad' : 'good',
               severity: Math.max(0, Math.min(1, Math.abs(swing) / 0.9)),
               affected: aff,
               facts: { p: nameOfRes(mv.id), v: pct(Math.abs(mv.mul - 1)) },
               why: nameOfRes(mv.id) + ' at ×' + (mv.mul || 1).toFixed(2) + ' of base' });
    break;   // one price story per pass; the rest of the book is the panel's job
  }

  /* 📉 THE CRASH. Firms that have actually failed, counted off the rungs. */
  if ((snap.bankrupt | 0) >= 1) {
    const n = snap.bankrupt | 0;
    out.push({ src: 'econ', key: 'crash|' + n,
               subject: 'crash', pole: 'bad',
               severity: Math.max(0, Math.min(1, n / Math.max(3, (snap.firms | 0) * 0.4))),
               affected: LK.fromPeople(Math.max(n, Math.round((snap.employed || 0) *
                          (n / Math.max(1, (snap.firms | 0) + n))))),
               facts: { v: num(n) },
               why: n + ' of ' + ((snap.firms | 0) + n) + ' firms insolvent' });
  }

  /* 🔨 THE LABOUR MARKET, both ways. */
  const u = +snap.unemployment || 0;
  if (u > T.jobless && (snap.laborForce | 0) > 0) {
    const seekers = Math.round(u * snap.laborForce);
    out.push({ src: 'econ', key: 'jobs|' + Math.round(u * 20),
               subject: 'jobs', pole: 'bad',
               severity: Math.max(0, Math.min(1, u / 0.4)),
               affected: LK.fromPeople(seekers),
               facts: { n: num(seekers), v: pct(u) },
               why: 'unemployment ' + pct(u) + ' of a labour force of ' + num(snap.laborForce) });
  } else if ((snap.vacancies | 0) > 0 && u < 0.03) {
    out.push({ src: 'econ', key: 'jobsg|' + (snap.vacancies | 0),
               subject: 'jobs', pole: 'good', severity: 0.5,
               affected: LK.fromPeople(snap.vacancies),
               facts: { n: num(snap.vacancies), v: num(snap.vacancies) },
               why: num(snap.vacancies) + ' vacancies posted, unemployment ' + pct(u) });
  }

  /* 🚚 TRADE. `real` partners is the count that survived discovery. */
  try {
    const tr = snap.trade || {};
    if ((tr.imports || 0) > 0 && (tr.partners || 0) > 0) {
      out.push({ src: 'econ', key: 'trade|' + Math.round(tr.imports),
                 subject: 'trade', pole: 'good', severity: 0.4,
                 affected: Math.round(pop),
                 facts: { v: num(tr.partners) },
                 why: num(tr.partners) + ' trade partners active' });
    }
  } catch (e) {}
  return out;
}

/* 🌤 WEATHER AND SMALL TALK. The weather is real (node-city's own `wx`); what
   makes the post a MEASUREMENT is the headcount, and for a contented post that
   is how many people are content enough for it to be true of them. In a
   struggling city that is four, which is the reading. */
/* 🚨 THE FORECAST — the only source here that reports something that has NOT
   happened yet, which is the entire point of it.

   Every other post in this feed is a measurement of the city as it stands. This
   one exists because a disaster nobody saw coming is not a decision a player
   gets to make; it is a dice roll they watch land. node-city now warns a severe
   front several minutes before it arrives (see WX_WARN_LEAD) and hands the
   forecast over on ctx.weather().warn — this turns that into the story the
   mayor actually reads.

   Departmental voice, not a citizen's: the phrase table dept register is
   "factual, names the shortfall and the mitigation", which is exactly what a
   warning has to do. A resident saying "looks like rain" is not a warning.

   ⚠ Keyed on the front's TYPE, so the warning posts ONCE per incoming front
     rather than every tick of the notice period. */
function fromForecast(ctx, pop) {
  let w = null; try { w = ctx.weather(); } catch (e) { return []; }
  if (!w || !w.warn || !w.warn.name) return [];
  return [{ src: 'weather', key: 'wxwarn|' + w.warn.type,
            subject: 'weather', pole: 'bad', dept: true, severity: 0.9,
            affected: Math.round(pop), facts: { w: w.warn.name },
            why: w.warn.name + ' forecast to make landfall' }];
}

function fromWeather(ctx, pop) {
  let w = null; try { w = ctx.weather(); } catch (e) { return []; }
  if (!w || !w.name) return [];
  const cz = CZ();
  let content = 0, total = 0;
  try {
    for (const c of (cz ? cz.list() : [])) {
      total++;
      if (Number.isFinite(c.mood) && c.mood >= BCAST.thresholds.moodHigh) content++;
    }
  } catch (e) {}
  /* Scale the sampled roster up to the population it stands for — the named
     roster is capped (CZ_MAX) and IS a sample of a larger citizenry, which
     node-city's citizens layer states outright. Reporting the raw sample would
     under-read every city bigger than the cap. */
  const share = total > 0 ? content / total : 0;
  if (w.severe) {
    return [{ src: 'weather', key: 'wxbad|' + w.type,
              subject: 'weather', pole: 'bad', severity: 0.7,
              affected: Math.round(pop), facts: { w: w.name },
              why: w.name + ' over the city' }];
  }
  if (share <= 0) return [];
  return [{ src: 'weather', key: 'wx|' + w.type + '|' + Math.round(share * 20),
            subject: 'weather', pole: 'good',
            severity: Math.max(0, Math.min(1, share)),
            affected: Math.max(1, Math.round(pop * share)),
            facts: { w: w.name },
            why: w.name + ', ' + Math.round(share * 100) + '% of the roster content' }];
}

/* ══════════════════════════════════════════════════════════════════════════
   👤 THE ROSTER DIFF — life path, per person, observed rather than announced.

   node-city's live `MythicCitizens` roster moves every tick: citRefresh grows
   and trims it with the population, and citAssignJobs deals seats out and
   takes them away. None of that is logged, and nothing calls anybody about it.
   So the feed takes a snapshot each pass and reads the difference — exactly
   the technique node-city's own offline life-events layer uses (`lifeDiff`),
   and for exactly the same reason: the roster is the record, and a diff of it
   cannot miss an event that a notification could have forgotten to send.

   🔴 THE SNAPSHOT IS NOT PERSISTED, DELIBERATELY. Diffing across a reload
      would let the feed claim somebody left while the tab was shut — which is
      both unknowable at this layer and already reported, properly, by the away
      report. A fresh session takes a baseline and claims nothing about it.

   ⚠ THE PREVIOUS SNAPSHOT IS THE ONLY PLACE A LEAVER'S NAME STILL EXISTS.
     By the time this runs they are off the roster; `byId` returns null. Hence
     the name (and their last workplace) are carried in the snapshot, not
     looked up afterwards.
   ══════════════════════════════════════════════════════════════════════════ */
let snap = null;   // Map id -> { name, job }

export function resetRoster() { snap = null; }

function workName(ctx, key) {
  if (!key) return null;
  try {
    const n = NM(); const nm = n && n.nameFor(key); if (nm) return nm;
    const t = ctx.game.tiles[key], d = t && ctx.BUILDINGS[t.type];
    return (d && d.name) || null;
  } catch (e) { return null; }
}

function fromRoster(ctx, pop) {
  const cz = CZ(); if (!cz || typeof cz.list !== 'function') return [];
  let rows = []; try { rows = cz.list() || []; } catch (e) { return []; }
  const now = new Map();
  for (const c of rows) now.set(String(c.id), { name: c.name, job: c.job || null });

  const prev = snap;
  snap = now;
  if (!prev) return [];              // first pass: baseline only, claim nothing

  /* ⚰ WHY THEY LEFT, ASKED BEFORE IT IS ASSUMED.
     ─────────────────────────────────────────────────────────────────────────
     🔴 THIS OBSERVER USED TO ANNOUNCE EVERY DEATH AS "moved away". A vanished
     id was `subject: 'leaving'`, poster sub "former resident", body "I am
     leaving the city. It stopped working for me." — published in the first
     person, by somebody who had just died, blaming the city for it. It was
     the only place in the codebase where a named person's disappearance was
     narrated at all, so it was also the only place that could be wrong.
     node-city's roster now keeps a short ring of who DIED and when
     (CITIZENS_API.deaths(), written by the retire() verb), and this asks it.
     ⚠ An older host has no deaths() at all: the map comes back empty, every
       departure reads as `leaving` exactly as it did, and nothing throws. */
  const died = new Map();
  try {
    const rows = (typeof cz.deaths === 'function') ? cz.deaths() : null;
    if (Array.isArray(rows)) for (const d of rows) if (d && d.id) died.set(String(d.id), d);
  } catch (e) { /* the ring is a nicety; a departure is still reportable */ }

  const out = [];
  const at = Date.now();
  /* Capped per pass. A population collapse can empty forty seats at once and
     the feed's job is to say "the city is losing people", not to publish forty
     goodbyes — the citywide reading for that is `rent`/`netPerDay`, which the
     demographics observer already produces with a proper headcount. */
  let left = 0, joined = 0, moved = 0;
  for (const [id, b] of prev) {
    if (now.has(id)) continue;
    if (++left > 2) break;
    const d = died.get(id);
    if (d) {
      /* 🪦 SEVERITY IS THE CITY'S CAPACITY, NOT THE DEATH. A death is not more
         or less severe than another death; what changes — and what the player
         can act on — is whether there was anywhere to put them. So an unburied
         death reads `severe` and a buried one `notable`, which is also what
         selects between the two clause pools in phrases.js. */
      const un = (() => { try { const M = window.MythicMortality; const r = M && M.ready() && M.report(); return r ? r.unburied : 0; } catch (e) { return 0; } })();
      /* ⚠ `d.age == null ? NaN : Number(d.age)` and NOT `Number(d.age)`.
         Number(null) is 0 and 0 IS finite, so the plain coercion published the
         obituary "Ada Fallow died at 0" for every citizen whose age
         /src/lifepath could not supply. Measured in the first driven run of
         this feature. Absent must stay absent all the way to the clause
         filter, which then drops every template carrying {v}. */
      const age = (d.age == null) ? NaN : Number(d.age);
      out.push({ src: 'roster', at, key: 'died|' + id,
                 subject: 'death', pole: 'bad', severity: un > 0 ? 0.95 : 0.55,
                 affected: 1,
                 facts: { q: d.name, v: Number.isFinite(age) && age > 0 ? String(Math.round(age)) : null,
                          p: workName(ctx, b.job) },
                 posterKind: 'dept',
                 why: d.name + ' died' + (Number.isFinite(age) ? ' at ' + Math.round(age) : '') +
                      (un > 0 ? ' — ' + un + ' unburied in the city' : '') });
      continue;
    }
    out.push({ src: 'roster', at, key: 'left|' + id,
               subject: 'leaving', pole: 'bad', severity: 0.5,
               affected: 1, facts: { p: workName(ctx, b.job) },
               posterKind: 'citizen', poster: { name: b.name, id, sub: 'former resident' },
               why: b.name + ' left the roster' });
  }
  for (const [id, a] of now) {
    const b = prev.get(id);
    if (!b) {
      if (++joined > 2) continue;
      out.push({ src: 'roster', at, key: 'in|' + id,
                 subject: 'movedin', pole: 'good', severity: 0.4,
                 affected: null, personal: true, facts: {},
                 posterKind: 'citizen', poster: { name: a.name, id, job: a.job },
                 why: a.name + ' joined the roster' });
      continue;
    }
    if (b.job === a.job || moved >= 2) continue;
    const to = workName(ctx, a.job), from = workName(ctx, b.job);
    if (!b.job && a.job && to) {
      moved++;
      out.push({ src: 'roster', at, key: 'hired|' + id + '|' + a.job,
                 subject: 'hired', pole: 'good', severity: 0.5,
                 affected: null, personal: true, facts: { p: to },
                 posterKind: 'citizen', poster: { name: a.name, id, job: a.job },
                 why: a.name + ' took a seat at ' + to });
    } else if (b.job && !a.job && from) {
      moved++;
      out.push({ src: 'roster', at, key: 'laid|' + id + '|' + b.job,
                 subject: 'laid', pole: 'bad', severity: 0.6,
                 affected: null, personal: true, facts: { p: from },
                 /* THEIR OLD seat, so `bondsOf` counts the colleagues who
                    are still there — the people a layoff is additionally true
                    for. Passing null here scored every layoff at exactly 1. */
                 posterKind: 'citizen', poster: { name: a.name, id, job: b.job },
                 why: a.name + ' lost their seat at ' + from });
    }
  }
  return out;
}

/* 🙂 HOW IT IS GOING, personally. A mood band crossed is a real event about a
   real person, and node-city already speaks in these two numbers. */
function fromMood(ctx, pop) {
  const cz = CZ(); if (!cz || typeof cz.list !== 'function') return [];
  let rows = []; try { rows = cz.list() || []; } catch (e) { return []; }
  if (!rows.length) return [];
  const T = BCAST.thresholds;
  let low = 0, high = 0;
  for (const c of rows) {
    if (!Number.isFinite(c.mood)) continue;
    if (c.mood < T.moodLow) low++; else if (c.mood > T.moodHigh) high++;
  }
  const n = rows.length || 1;
  const out = [];
  if (low > 0) {
    out.push({ src: 'citizens', key: 'moodlow|' + Math.round(low / n * 20),
               subject: 'mood', pole: 'bad',
               severity: Math.max(0, Math.min(1, low / n)),
               affected: Math.max(1, Math.round(pop * (low / n))),
               facts: {},
               why: low + ' of ' + n + ' named residents below the slump line' });
  }
  if (high > 0) {
    out.push({ src: 'citizens', key: 'moodhigh|' + Math.round(high / n * 20),
               subject: 'mood', pole: 'good',
               severity: Math.max(0, Math.min(1, high / n)),
               affected: Math.max(1, Math.round(pop * (high / n))),
               facts: {},
               why: high + ' of ' + n + ' named residents above the content line' });
  }
  return out;
}

/* 🛣 TRAFFIC. /src/streets counts real vehicle passes and knows the corridor's
   capacity; the post names the street because the module already named it. */
function fromStreets(ctx, pop) {
  const S = ST(); if (!S || typeof S.streets !== 'function') return [];
  let worst = null;
  try {
    for (const st of (S.streets() || [])) {
      const k = st.tiles && st.tiles[0]; if (!k) continue;
      const s = S.statsAt(k); if (!s || !s.capParts) continue;
      const cap = Math.min(s.capParts.lane || Infinity, s.capParts.share || Infinity);
      if (!(cap > 0) || !(s.peakVolume > 0)) continue;
      const load = s.peakVolume / cap;
      if (!worst || load > worst.load) worst = { load, name: s.name, cap };
    }
  } catch (e) { return []; }
  if (!worst) return [];
  if (worst.load > 0.8) {
    return [{ src: 'streets', key: 'traf|' + Math.round(worst.load * 10),
              subject: 'traffic', pole: 'bad',
              severity: Math.max(0, Math.min(1, (worst.load - 0.8) / 0.6)),
              /* Everyone who commutes is on the roads; the corridor at capacity
                 is the one they are all in. */
              affected: Math.round(pop * Math.min(1, worst.load)),
              facts: { p: worst.name, v: pct(worst.load) },
              why: worst.name + ' at ' + pct(worst.load) + ' of capacity at peak' }];
  }
  return [];
}

/* ── THE PASS ──────────────────────────────────────────────────────────────
   Every observer is wrapped alone: a throw inside one costs that subject and
   nothing else. This module has ten sources and any of them may be reading a
   sibling that shipped a breaking change this round. */
function safe(fn, ctx, pop) { try { return fn(ctx, pop) || []; } catch (e) { return []; } }

export function observe(ctx) {
  const pop = (() => { try { return Math.max(0, +ctx.cityPop() || 0); } catch (e) { return 0; } })();
  const out = [];
  for (const ev of consumeLog(ctx, 8)) out.push(ev);
  for (const fn of [fromCoverage, fromPower, fromWater, fromPollution,
                    fromDemographics, fromEconomy, fromForecast, fromWeather, fromMood,
                    fromStreets, fromRoster]) {
    for (const ev of safe(fn, ctx, pop)) out.push(ev);
  }
  /* ── NORMALISE, AND FAN OUT INTO CANDIDATES ─────────────────────────────
     🔴 ONE READING CAN BE SPOKEN BY TWO DIFFERENT PEOPLE, and emitting only
     one of them was measured as a real defect. The first cut assigned the
     poster here — department for anything bad, citizen otherwise — and the
     feed came back 42 department posts to 17 citizen posts, i.e. a bulletin
     board. The reference is the other way round: a column of residents with
     the Electricity Department in among them. So a city-scope subject with a
     department emits BOTH candidates and the pass picks, under kind caps.

     `pref` is the tiebreak, and it is a judgement worth stating: when the
     reading is SEVERE the institution should be the one that says it (a
     collapse is announced, not overheard), and at every other intensity the
     resident should, because that is who the player is actually governing.

     `personal` events arrive with a null `affected` — they are the only ones
     that do — and index.js fills it from the citizen who actually turns out to
     be posting, which is a thing no observer here could know in advance. */
  const cand = [];
  for (const ev of out) {
    if (!SUBJECTS[ev.subject]) { ev.subject = 'mood'; }
    ev.band = bandOf(ev.severity, ev.pole);
    ev.at = ev.at || Date.now();
    const s = SUBJECTS[ev.subject];
    if (ev.posterKind) { cand.push(ev); continue; }
    const kinds = [];
    if (s.citizen) kinds.push('citizen');
    if (s.dept && s.scope !== 'person') kinds.push('dept');
    if (!kinds.length) kinds.push(s.dept ? 'dept' : 'company');
    for (const k of kinds) cand.push({ ...ev, posterKind: k });
  }
  for (const ev of cand) {
    const loud = ev.band === 'severe' || ev.band === 'great';
    ev.pref = loud ? (ev.posterKind === 'dept' ? 1 : 0)
                   : (ev.posterKind === 'citizen' ? 1 : 0);
    ev.seed = 'bc|' + ev.key + '|' + ev.posterKind;
  }
  return cand;
}

export default { observe, consumeLog, logCursor, setLogCursor, resetLog, resetRoster, skipExistingLog, pickCitizen, bandOf };
