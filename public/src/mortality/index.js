/* ══════════════════════════════════════════════════════════════════════════
   🪦 MORTALITY — module entry point. Registers window.MythicMortality.

   WHAT THIS IS. Citizens die, the city has to put them somewhere, and until
   this round neither half of that was true: /src/lifepath's own header records
   that "nobody on the named roster ever dies, retires off it, or leaves", and
   /src/demographics was already rating people through a terminal stage and
   posting the result into `S.flow.out` beside "the rent went up".

   FOUR SEAMS, NO FIFTH — and three of them are edits to things that already
   exist rather than anything in this folder:
     1. node-city CITIZENS_API.retire(id, cause) — the removal verb. It lives
        in the layer that MINTS citizens, because /src/lifepath's seed() says
        so in writing: "If the roster is ever given its own mortality it
        belongs in the citizens layer that mints them."
     2. /src/demographics `died` — a breakdown of `out`, not a fifth bucket.
     3. /src/broadcast `death` + `deathcare` subjects.
     4. `graveyard` / `cemetery` BUILDINGS rows carrying `plots` and
        `svc: { need: 'deathcare' }`.
   This module is the join: it reads the demographic model's deaths, spends
   them against the graves the city has built, retires named citizens at the
   roster's own share of the same deaths, and answers two questions for the
   host — how much interment the city needs, and whether a given graveyard is
   full.

   🔴 IT IS NOT A SECOND POPULATION MODEL AND IT MUST NEVER BECOME ONE.
   Nothing here decides how many people die. It differences a counter
   /src/demographics owns. It writes to exactly one thing outside itself — the
   named roster, through the host's own guarded verb — and it writes nothing at
   all to game.tiles, to the ledger, or to the economy.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `bldSite` and
   `cityGroundId` are top-level `const` in node-city's module script and are
   invisible to an ES module. mount()'s ctx IS the hand-over. What crosses:
   four readers and nothing that writes a tile.

   A 404 or a parse error here costs the player deathcare and nothing else:
   `dem.deathcare` falls back to node-city's own per-capita constant, every
   graveyard runs at full plot factor forever, and no named citizen ever dies —
   i.e. exactly the behaviour that shipped last round.
   ══════════════════════════════════════════════════════════════════════════ */

import { MORT, clock, crudeRatePerMin } from './tuning.js';
import * as M from './model.js';

export const V = 1;

let CTX = null;
let mounted = false;
let ticker = null;
let lastAt = 0;
let lastDeathsTotal = null;      // the demographic counter as of the last step
let rosterDebt = 0;              // fractional named deaths owed
let cityId = null;
let lastStep = null;             // what the most recent step() returned
let shelved = false;
let source = 'none';             // which read answered last: 'exact' | 'crude' | 'none'

const S = M.makeState();

const DEM = () => { try { return window.MythicDemographics; } catch (e) { return null; } };
const CZ  = () => { try { return window.MythicCitizens; } catch (e) { return null; } };
const LP  = () => { try { return window.MythicLifepath; } catch (e) { return null; } };

function warn(msg, e) { try { console.warn('[Mortality] ' + msg, e || ''); } catch (x) {} }

/* ── THE SITES ────────────────────────────────────────────────────────────
   Every tile whose BUILDINGS row declares `plots`. The flag is ON THE ROW and
   is never a list in this file — node-city has corrected that mistake three
   times, and a module-side id table is stale the moment a row is added.

   ⚠ A DAMAGED GRAVEYARD IS STILL A GRAVEYARD. It is included here with its
     full capacity, because the graves in it did not stop existing when the
     wall came down. What it does NOT do is take anybody new — the host's own
     `mult` is what carries the damage, so `capPerMin` (which is the host's
     supply figure) falls to zero on its own. Excluding it here instead would
     make model.js's reconcile() DISINTER everybody the moment a storm passed
     and re-bury them on repair, which is both grotesque and a flapping audit.
   🏗 A construction site is excluded: nothing has been dug yet. */
function sites() {
  const out = [];
  if (!CTX) return out;
  const { game, BUILDINGS, bldSite } = CTX;
  for (const k in game.tiles) {
    const t = game.tiles[k]; if (!t) continue;
    const d = BUILDINGS[t.type];
    if (!d || !(d.plots > 0)) continue;
    if (bldSite && bldSite(t)) continue;
    out.push({ key: k, plots: Math.floor(d.plots * Math.max(1, t.lvl | 0)) });
  }
  /* Stable order so the same graveyard fills first in every session and a save
     round-trip cannot shuffle who is buried where. */
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/* ── HOW MANY DIED SINCE THE LAST STEP ────────────────────────────────────
   EXACT first: /src/demographics keeps a monotone count of people who have
   reached the life course's terminal stage. Differencing it means this module
   never assumes a cadence, never double-counts a long tick and picks up
   node-city's offlineCatchUp() (which runs real economy ticks) for free.

   ⚠ THE COUNTER CAN GO BACKWARDS EXACTLY ONCE — on a load, when pipeline
     reset() zeroes it. A negative difference is therefore a RE-BASE, not a
     resurrection: the cursor is moved and nothing is claimed. */
function deathsSince(dtMin) {
  const D = DEM();
  if (D && typeof D.ready === 'function' && D.ready() && typeof D.state === 'function') {
    let st = null; try { st = D.state(); } catch (e) { st = null; }
    const tot = st && Number(st.deaths);
    if (Number.isFinite(tot) && tot >= 0) {
      source = 'exact';
      if (lastDeathsTotal == null || tot < lastDeathsTotal) { lastDeathsTotal = tot; return 0; }
      const d = tot - lastDeathsTotal;
      lastDeathsTotal = tot;
      return d;
    }
  }
  /* CRUDE. No demographic model, so the only honest read left is the city's
     own headcount against the life expectancy /src/lifepath derives. Returns 0
     rather than a guess when even that cannot be derived. */
  const rate = crudeRatePerMin(CTX && CTX.dayMin);
  if (!(rate > 0)) { source = 'none'; return 0; }
  source = 'crude';
  const pop = popOf();
  return rate * pop * Math.max(0, dtMin);
}

function popOf() {
  try {
    const p = CTX && typeof CTX.pop === 'function' ? Number(CTX.pop()) : NaN;
    return Number.isFinite(p) && p > 0 ? p : 0;
  } catch (e) { return 0; }
}

/* Interments per minute the city can actually perform — READ OFF THE HOST'S
   OWN COVERAGE SUPPLY, which is the number the vitals card prints.
   🔴 THIS IS THE SINGLE-TRUTH RULE, and it is the same one /src/water/hydro.js
   keeps ("the HOST owns the rate, the MODULE owns the ground"). Re-deriving
   Σ svc.supply × lvl here would produce a number WITHOUT the host's staffing,
   weather, morale and power multipliers folded in — visibly close, always
   wrong, and it would let the card say a city is covered while the backlog
   grew. `game.cov.supply.deathcare` already has plotFactor() in it, because
   node-city multiplies by it in the same line that accumulates the supply. */
function capPerMin() {
  try {
    const s = CTX && CTX.game && CTX.game.cov && CTX.game.cov.supply;
    const v = s ? Number(s.deathcare) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) { return 0; }
}

/* ── ⚱ THE NAMED ROSTER'S SHARE ───────────────────────────────────────────
   The roster is at most CIT.MAX people standing in for a city of hundreds, so
   it dies at the city's rate scaled by its share of the city. That is a SAMPLE
   of the deaths /src/demographics already counted — never a second source of
   them, which is the distinction this codebase has had to fix four times (see
   node-city :37905, :38310, :38400).

   ⚠ WHO DIES: THE OLDEST. citEnsure() pops from the END of a LIFO stack, so
     before this existed the roster's only exit killed the NEWEST person and
     never the oldest — /src/lifepath measured the consequence at +400 real
     hours: 30 of 40 named residents past life expectancy, ages 119 to 178.
     Age comes from /src/lifepath; with that module absent the fallback is the
     lowest sequence number, i.e. the longest-resident, which is the best
     available proxy and is stated as one. */
function oldestId(rows) {
  const L = LP();
  let best = null, bv = -Infinity;
  for (const c of rows) {
    if (!c || !c.id) continue;
    let v = NaN;
    if (L && typeof L.age === 'function') { try { const a = L.age(c.id); v = a && Number.isFinite(a.years) ? a.years : Number(a); } catch (e) { v = NaN; } }
    if (!Number.isFinite(v)) { const m = /^c(\d+)$/.exec(String(c.id)); v = m ? -(+m[1]) : -1e9; }
    if (v > bv) { bv = v; best = c.id; }
  }
  return best;
}

function retireSome(deaths) {
  const cz = CZ();
  if (!cz || typeof cz.retire !== 'function' || typeof cz.list !== 'function') return 0;
  let rows = []; try { rows = cz.list() || []; } catch (e) { return 0; }
  const pop = popOf();
  if (!rows.length || !(pop > 0)) return 0;
  rosterDebt += deaths * (rows.length / pop);
  let n = 0;
  while (rosterDebt >= 1 && n < MORT.rosterMaxPerTick && rows.length > 1) {
    const id = oldestId(rows);
    if (!id) break;
    let ok = false;
    try { ok = cz.retire(id, 'age'); } catch (e) { ok = false; }
    if (!ok) break;
    rosterDebt -= 1; n++;
    rows = rows.filter((c) => c.id !== id);
  }
  /* A debt that can never be spent is a debt that grows forever. Capped at one
     whole person so a population collapse cannot empty the roster on the frame
     the tab regains focus — and note that citEnsure()'s own trim (which fires
     when cityPop falls) is NOT a death and is left exactly alone. */
  if (rosterDebt > 1) rosterDebt = 1;
  return n;
}

/* ── THE TICK ─────────────────────────────────────────────────────────────
   Its own interval, like /src/progression's. That is honest about cadence: a
   burial is an observation, not a simulation step, and every read it makes is
   differenced or idempotent so a missed tick costs nothing. */
function tick() {
  if (!mounted || !CTX) return null;
  const now = Date.now();
  const dtMin = Math.min(MORT.maxStepMin, Math.max(0, (now - lastAt) / 60000));
  lastAt = now;
  const deaths = Math.max(0, deathsSince(dtMin));
  const r = M.step(S, { dtMin, deaths, capPerMin: capPerMin(), sites: sites() });
  lastStep = r;
  if (deaths > 0) { try { r.retired = retireSome(deaths); } catch (e) { warn('roster', e); } }
  return r;
}

/* ══ THE PUBLIC SEAM ══════════════════════════════════════════════════════ */

/* Interments the city needs per REAL MINUTE. This is node-city's
   `dem.deathcare` — the coverage denominator — and it is the same override
   shape `dem.power = game.power.demand` and `dem.light` already use.
   SMOOTH by construction: the last WHOLE economic day's death rate, because a
   per-tick figure as a denominator is the −1,167/day bug /src/demographics
   pipeline.js's `acc` block exists to prevent. Falls through to the derived
   crude rate before the first whole day has elapsed, and returns null — never
   a plausible zero — when nothing can be derived at all, so the host keeps its
   own constant instead. */
export function demandPerMin() {
  const D = DEM();
  if (D && typeof D.ready === 'function' && D.ready() && typeof D.state === 'function') {
    let st = null; try { st = D.state(); } catch (e) { st = null; }
    const perDay = st && st.day ? Number(st.day.died) : NaN;
    const c = clock(CTX && CTX.dayMin);
    if (Number.isFinite(perDay) && perDay > 0 && c && c.ok && c.dayMin > 0) return perDay / c.dayMin;
  }
  const rate = crudeRatePerMin(CTX && CTX.dayMin);
  if (!(rate > 0)) return null;
  const pop = popOf();
  return pop > 0 ? rate * pop : 0;
}

/* 1 while this graveyard still has a plot free, 0 when it is full. node-city
   multiplies `svc.supply` by it, so a full graveyard stops covering Deathcare
   and the vitals card goes red without anything else in the city moving.
   ⚠ Returns 1 for everything that is not a deathcare building AND for every
     tile when this module has not mounted — the identity, so the host line is
     byte-identical to what it computed before this existed. */
export function plotFactor(key, plots) {
  if (!mounted) return 1;
  const cap = Math.floor(Number(plots) || 0);
  if (!(cap > 0)) return 1;
  return M.plotFactor(S, key, cap);
}

export function report() {
  const list = sites();
  let cap = 0;
  for (const s of list) cap += s.plots;
  const used = M.plotsUsed(S);
  return {
    ok: mounted,
    source,                                   // which read answered: exact / crude / none
    sites: list.length,
    plots: cap, plotsUsed: used, plotsFree: Math.max(0, cap - used),
    waiting: S.waiting, unburied: Math.floor(S.waiting + 1e-9),
    noticing: Math.floor(S.waiting + 1e-9) >= MORT.backlogNotice,
    deaths: S.lifetime, interred: S.interredLife, disinterred: S.lost,
    demandPerMin: demandPerMin(), capPerMin: capPerMin(),
    last: lastStep,
  };
}

/* Silence is a pass — the same contract every self-check in this codebase
   keeps. Two things can go wrong invisibly: the books stop balancing, and the
   BUILDINGS table stops carrying a row that can answer Deathcare at all. */
export function verify(buildingIds) {
  const problems = [];
  const a = M.audit(S);
  if (!a.ok) problems.push(a.why);
  if (Array.isArray(buildingIds) && CTX) {
    const B = CTX.BUILDINGS;
    const plotted = buildingIds.filter((t) => B[t] && B[t].plots > 0);
    const svcd = buildingIds.filter((t) => B[t] && B[t].svc && B[t].svc.need === 'deathcare');
    if (!plotted.length) problems.push('no BUILDINGS row declares `plots`, so nothing in the city can bury anybody');
    for (const t of plotted) if (!(B[t].svc && B[t].svc.need === 'deathcare'))
      problems.push(t + ' has plots but no svc.need "deathcare" — it would take bodies and never appear on the vitals card');
    for (const t of svcd) if (!(B[t].plots > 0))
      problems.push(t + ' supplies deathcare but declares no plots — it would cover the need forever and never fill up');
  }
  return { ok: !problems.length, problems, audit: a };
}

function shelfRegister() {
  if (shelved) return true;
  try {
    const shelf = window.MythicCitySave;
    if (!shelf || typeof shelf.register !== 'function') return false;
    shelved = shelf.register('mortality', {
      save: () => M.save(S, cityId),
      load: (p) => {
        const r = M.load(S, p, cityId);
        if (!r.ok) warn(r.why);
      },
    });
  } catch (e) { warn('save shelf unavailable (non-fatal)', e); }
  return shelved;
}

export function mount(ctx) {
  CTX = ctx || null;
  if (!CTX || !CTX.game || !CTX.BUILDINGS) { warn('mount: no host context — deathcare is off'); return api; }
  cityId = CTX.cityId == null ? null : String(CTX.cityId);
  S.city = cityId;
  mounted = true;
  lastAt = Date.now();
  lastDeathsTotal = null;
  shelfRegister();
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => { try { tick(); } catch (e) { warn('tick', e); } }, MORT.tickMs);
  return api;
}

export function unmount() {
  if (ticker) clearInterval(ticker);
  ticker = null; mounted = false; CTX = null;
}

const api = {
  V, mount, unmount, tick,
  ready: () => mounted,
  demandPerMin, plotFactor, report, verify,
  state: () => S,
  audit: () => M.audit(S),
  /* Test seam. `step` drives one interval by hand with an explicit death
     count, which is what lets a driver prove a hundred burials in a frame
     instead of waiting a hundred real hours for them. */
  step: (deaths, dtMin) => M.step(S, { dtMin: Math.max(0, Number(dtMin) || 0), deaths: Math.max(0, Number(deaths) || 0),
                                       capPerMin: capPerMin(), sites: sites() }),
  retireSome,
  save: () => M.save(S, cityId),
  load: (raw) => M.load(S, raw, cityId),
};

try { if (typeof window !== 'undefined') window.MythicMortality = api; } catch (e) {}

export default api;
