/* ════════════════════════════════════════════════════════════════════════════
   🧟 OUTBREAK RISK — the mount, the beat, the card and the one damage call.
   ----------------------------------------------------------------------------
   risk.js is the model and knows nothing about a city. THIS file is the only
   part of the feature that touches the host, and it is deliberately small:

     · it ASKS the host for four things (tiles, population, the raid defence
       tally, the WX_SHIELD strength) and never derives any of them itself;
     · it WRITES to the city through exactly ONE function — ctx.damageTile().
       grep this file for `damageTile` and you have the complete list of ways an
       outbreak can hurt anything. That is criterion 5, and it is also the
       argument node-city:5875 already made: "a hazard that grows a new damage
       path picks up every consumer for free";
     · it persists through window.MythicCitySave.register('zombie', …), so
       node-city's serialize() literal is not edited at all.

   ── 🔴 THE GLOBALS TRAP, Nth MODULE TO HIT IT ──────────────────────────────
   `game`, `BUILDINGS`, `cityPop`, `bldSite`, `damageTile`, `toast`, `logEvent`
   and `isRoadTile` are top-level `const`/`function` in node-city's module
   script and are NOT on `window`. The object handed to mount() IS the
   hand-over. Nothing is read off a bare global here and nothing may be added
   that is.
   ⚠ WHAT DOES NOT CROSS IT: no `addRes`, no `spendCinders`, no `payCost`, no
     tile writer other than damageTile, no mesh handle, no scene. An outbreak
     costs buildings and bodies; it never mints or spends currency, which is
     also why this feature needs no econ table entry.

   ── WHERE THE DEAD COME FROM — ONE INGRESS, WITH A LATCH ───────────────────
   `reportDeaths(n, source)` is the ONLY way a body enters the backlog. The
   cemeteries/graveyards round, or any future mortality model on the named
   roster, calls it and becomes the city's death source permanently — the first
   external call LATCHES OFF the fallback below, so there can never be two
   opinions about how many people died.

   THE FALLBACK, until something better exists: node-city already kills people.
   `game.pop.perMin` goes NEGATIVE when Food, Water or Health coverage drops
   under POP_DECLINE_AT (index.html:31411) and `game.pop.npc` decays. That is
   the city starving, it is already simulated, it is already saved, and until
   now nothing narrated it at all. This module counts that decline as deaths and
   SAYS SO in the card ("deaths from coverage collapse"), which is honest in a
   way that inventing a second mortality curve would not be.
   ⚠ IT IS NOT A GUESS AT THE DEMOGRAPHICS MODEL. /src/demographics really does
     compute deaths (pipeline.js:473, retiredLeavePerDay) and really does dump
     them into `S.flow.out` alongside "moved away" — but there is no `died`
     bucket to read, so reading it would be inventing the split. When that
     bucket exists it calls reportDeaths() and this fallback goes quiet for
     good. That is the seam, and it is one function call wide.
   ════════════════════════════════════════════════════════════════════════════ */

import { ZOM } from './tuning.js';
import * as R from './risk.js';
import * as P from './panel.js';

let ctx = null;
let S = null;
let cap = { perDay: 0, sources: [], any: false };
let acc = 0;               // dt accumulator — the model beats at BEAT, not per frame
let paintAcc = 0;
let lastPop = null;
let externalLatched = false;
let lastDelta = { risk: 0, unburied: 0 };
let lastHtml = '', lastTimer = '';
let pending = null;        // save payload seen before mount
let mounted = false;
let busy = false;          // one resolve at a time; damageTile does real work
let pendingDeaths = 0;     // reported since the last beat — see beat()

const BEAT = 1;            // seconds of simulated time per model tick
const PAINT = 0.5;         // seconds between card repaints

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/* ── The horde the player is being shown, for the "Defence X vs horde Y" line.
      Same expression resolve() uses, so the card cannot promise a smaller
      horde than the one that arrives. Kept here rather than in risk.js because
      it is a PREVIEW of a number risk.js owns — one formula, two callers, and
      the formula lives with the model. */
function projectedStrength() {
  return Math.round(ZOM.strBase + S.unburied * ZOM.strPerBody + S.waves * ZOM.strPerWave);
}

/* ── Every type in the table that could bury someone, for the card's
      "build:" hint. DERIVED from the BUILDINGS rows, never typed — the same
      rule demogGrowth().fixFor follows at index.html:27204, so a new burial
      building appears in the hint automatically. */
function burialTypes() {
  const B = ctx && ctx.BUILDINGS;
  if (!B) return [];
  /* BOTH contracts, because there are two and neither is this module's:
     /src/mortality's rows declare `svc: { need: 'deathcare' }` (they answer the
     eighth NEED and carry `plots`), and the fallback contract is
     `deathcare: { inter }` for a build without that module. Reading the table
     rather than a list means a new burial building appears here the day it is
     added, which is the rule demogGrowth().fixFor already follows. */
  return Object.keys(B)
    .filter((k) => {
      const d = B[k]; if (!d) return false;
      if (d.svc && d.svc.need === 'deathcare') return true;
      return !!(d.deathcare && num(d.deathcare.inter) > 0);
    })
    .map((k) => ({ label: (B[k].ico || '') + ' ' + (B[k].name || k), lock: researchLock(k) }));
}

/* ── 🌳 IS THE ANSWER ACTUALLY BUILDABLE YET? ──────────────────────────────
   The engine arms on "this city HAS a deathcare system", which is the right
   question for whether an outbreak is possible — but graveyards sit behind the
   `civ_deathcare` research node, and a fresh city has zero development points.
   So there is a real window in which the player is being warned about a thing
   whose fix is not yet on the build bar. The bar for this piece is "knew what
   would stop it, AND COULD AFFORD TO", so the card has to name the node, not
   just the building.
   ⚠ GUARDED AND DEGRADES TO SILENCE, like every other cross-module read here:
     window.MythicProgress is a real window property (unlike `game`/`BUILDINGS`
     — see the globals trap above), and a 404 or a shape change on it costs
     this hint and nothing else. No lock claimed means no lock shown; the
     module never invents a gate it could not read. */
function researchLock(type) {
  try {
    const P = (typeof window !== 'undefined') && window.MythicProgress;
    if (!P || typeof P.buildingBlockedBy !== 'function') return null;
    const b = P.buildingBlockedBy(type);
    if (!b || !b.node) return null;
    return { name: String(b.name || b.node), cost: num(b.cost) };
  } catch (e) { return null; }
}

/* ══ 🪦 /src/mortality IS THE AUTHORITY ON THE DEAD ════════════════════════
   That module ships the city's graves — it counts the deaths, holds the
   `waiting` list, and works the backlog off against real plots. When it is
   live, THIS module owns none of that: it reads `unburied`, the burial rate
   and the death rate off MythicMortality.report() and turns them into a risk.
   One number, two cards, no possibility of disagreement.

   ⚠ EVERY READ IS GUARDED AND DEGRADES TO THE SELF-OWNED MODEL. A 404, a parse
     error or a shape change on the sibling costs the outbreak card its input
     and nothing else — it falls back to the `deathcare: { inter }` contract in
     capacityOf() plus the coverage-collapse fallback, which is exactly what
     this file shipped with before /src/mortality landed. It never guesses at
     the sibling's internals and never writes to it.
   ⚠ UNITS. mortality's rates are per REAL minute (its dtMin is wall clock over
     60000). This model is per CITY DAY. daySec/60 is the conversion and it is
     applied in ONE place, here.
   ⚠ AND `plotsFree` IS NOT A RATE. It is GROUND — how many more bodies this
     city has anywhere to put, ever, at the current build. It is handed across
     as `room` and it is the third term of the interment line; see the
     third-term block in risk.js for the forecast that lied without it. */
function mortality() {
  try {
    const M = (typeof window !== 'undefined') && window.MythicMortality;
    if (!M || typeof M.report !== 'function') return null;
    if (typeof M.ready === 'function' && !M.ready()) return null;
    const r = M.report();
    if (!r || !r.ok || !Number.isFinite(+r.unburied)) return null;
    const perDay = num(ctx.daySec, ZOM.daySec) / 60;
    /* 🔴 null IS NOT ZERO, AND num() CANNOT TELL THEM APART — `+null` is 0 and
       0 is finite, so `num(null, fallback)` returns 0 and the default never
       runs. mortality's demandPerMin() returns null deliberately ("never a
       plausible zero", index.js:232) when it has nothing to derive from, and
       flattening that to 0/day made the card forecast immortality for a city
       that was losing people. Passed through as null, risk.js falls back to
       estimating from the backlog's own arrivals instead. */
    const dpm = r.demandPerMin;
    return {
      unburied: Math.max(0, +r.unburied),
      capPerDay: Math.max(0, num(r.capPerMin)) * perDay,
      ratePerDay: (dpm == null || !Number.isFinite(+dpm)) ? null : Math.max(0, +dpm) * perDay,
      /* Free plots, less nothing: mortality's own `room` is `free - plotDebt`
         and plotDebt is in [0,1) — under one body, and it is already paid for.
         Rounding it in here would make the card disagree with the sibling's own
         "N/M plots free" over a fraction of a grave. */
      plots: num(r.plots), plotsFree: num(r.plotsFree), sites: num(r.sites),
    };
  } catch (e) { return null; }
}

function inputs() {
  const M = mortality();
  const daySec = num(ctx.daySec, ZOM.daySec);
  const base = {
    pop: ctx.pop ? num(ctx.pop()) : 0,
    daySec,
    shield: ctx.wxShieldStrength ? num(ctx.wxShieldStrength(ZOM.shieldHazard)) : 0,
  };
  if (M) {
    base.unburied = M.unburied;
    base.ratePerDay = M.ratePerDay;
    base.capPerDay = M.capPerDay;
    /* 🔴 THE THIRD TERM. Burial RATE and burial GROUND are two limits and the
       forecast needs both — it projects with the self-owned interment line, so
       whatever the sibling knows about plots has to be handed over explicitly
       or the projection digs holes that do not exist. This is the field whose
       absence printed "no outbreak in the next 60 city days" over a city with
       three plots left and an outbreak twelve days out. */
    base.room = M.plotsFree;
    /* ARMED because the city HAS a deathcare system — not because it has
       already built a grave. A city with a graveyard it has not raised yet can
       still be rolled against; a city where graves do not exist as a concept
       cannot. That is the same distinction capacityOf().any draws. */
    base.armed = true;
    return base;
  }
  base.capPerDay = cap.perDay;
  /* NO `room` ON THE FALLBACK PATH, AND THAT IS NOT AN OMISSION. The
     `deathcare: { inter }` contract states a rate and says nothing about
     ground, so the honest value is "no constraint stated" — risk.js reads an
     absent `room` as Infinity, which is byte-identical to the behaviour before
     the term existed. A default of 0 here would refuse to bury anybody. */
  base.armed = R.armed(cap);
  return base;
}

/* ══ THE FALLBACK DEATH SOURCE ═════════════════════════════════════════════
   Reads the decline node-city is ALREADY running and reports it once. Clamped
   to the population actually lost, so the POP_MIN floor (a city never fully
   empties) cannot manufacture bodies for ever out of a rate that is no longer
   moving anyone. */
function fallbackDeaths(dt) {
  if (externalLatched) return 0;
  const popNow = ctx.pop ? num(ctx.pop()) : 0;
  const was = lastPop == null ? popNow : lastPop;
  lastPop = popNow;
  const perMin = ctx.declinePerMin ? num(ctx.declinePerMin()) : 0;
  if (!(perMin < 0)) return 0;
  const modelled = -perMin * (dt / 60);
  const drop = Math.max(0, was - popNow);
  const d = Math.min(modelled, drop);
  if (d > 0 && S.src !== 'coverage collapse') S.src = 'coverage collapse';
  return d;
}

/* ══ THE BEAT ══════════════════════════════════════════════════════════════ */
function beat(dt) {
  const inp = inputs();
  if (inp.unburied != null) S.src = 'the city graves (/src/mortality)';
  /* 🔴 ONE INGRESS, AND IT IS THIS LINE. Externally reported deaths are
     BUCKETED and spent here rather than being added to the backlog on arrival.
     That is not tidiness — it is the fix for a defect the driver caught: deaths
     that skip tick() also skip the deaths-per-day EMA, so a city being fed
     bodies through reportDeaths() forecast its own death rate as ZERO, and the
     panel cheerfully promised no outbreak while the backlog climbed. A
     forecast fed by a different number from the model is the exact "decoration"
     failure this piece is not allowed to have. Every body now enters the model
     through inp.deaths, whatever reported it. */
  if (inp.unburied == null) {
    inp.deaths = pendingDeaths + fallbackDeaths(dt);
  } else {
    /* Mirrored: /src/mortality already counted these. Dropping the bucket is
       the point — two counts of the same body is the bug this branch exists to
       make impossible. */
    pendingDeaths = 0;
  }
  pendingDeaths = 0;
  const rep = R.tick(S, inp, dt);
  lastDelta = { risk: rep.dRisk, unburied: rep.dUnburied };
  if (!rep.due) return;

  /* The host's OWN tally, asked for rather than recomputed. node-city:31172
     carries the standing warning that a second defence number "promises a
     defence the raid does not deliver"; the way not to have a second number is
     not to write one. An outbreak is never a siege — walls do not count double
     against something that walks in through the gate you left open. */
  const def = ctx.raidDefence ? ctx.raidDefence(false) : null;
  const out = R.resolve(S, inp, def);
  if (out.fired) apply(out, def);
  if (ctx.saveSoon) { try { ctx.saveSoon(); } catch (e) {} }
}

/* ══ THE WAVE LANDS ════════════════════════════════════════════════════════
   raidTick()'s shape with a different strength source, as the brief asks: the
   tally, the ammo fuel and the breach are all the host's, and the only thing
   this feature contributes is where the strength came from.
   ⚠ NO CINDER CHANGES HANDS, in either direction. A raid pays out on a hold;
     an outbreak does not, because the reward for burying your dead is that
     nothing happens, and paying a bounty for it would make a backlog
     profitable. Nothing here touches the ledger, so nothing here can mint. */
function apply(out, def) {
  const D = def || { effDefense: 0, defense: 0, breakdown: 'no tally available', ammoNote: '' };
  const head = '🧟 Outbreak wave ' + out.wave;
  const tally = 'defence ' + D.effDefense + ' vs horde ' + out.strength +
    ' (' + (D.breakdown || '') + ')' + (D.ammoNote ? ' · ' + D.ammoNote : '') +
    ' · rolled ' + Math.round(out.p * 100) + '% and drew ' + out.r.toFixed(4);

  if (out.held) {
    if (ctx.toast) ctx.toast('🧟 ' + head + ' HELD — the dead were put down and buried. ' +
      Math.round(out.cleared) + ' interred.', 'good');
    if (ctx.logEvent) ctx.logEvent('raid good', head + ' HELD — ' + tally +
      '. ' + Math.round(out.cleared) + ' of the backlog was put down and interred; risk falls to ' +
      Math.round(S.risk) + '.');
    return;
  }

  if (ctx.toast) ctx.toast('🧟 ' + head + ' BREACHED — the dead are in the streets.', 'bad');

  /* ── THE ONLY WAY THIS FEATURE HURTS ANYTHING ────────────────────────────
     One loop, one call. Candidate tiles are chosen exactly as raidTick chooses
     them (no roads, no anchors), and the pick is a SEEDED draw so a headless
     run of the same city and roll index destroys the same building.
     The quarantine absorption was decided in resolve() off the WX_SHIELD row;
     here it is simply "skip the damageTile call", which is precisely what
     _wxShield() does for the four weather hazards. */
  const tiles = ctx.tiles ? (ctx.tiles() || {}) : {};
  const keys = Object.keys(tiles).filter((k) => {
    const t = tiles[k];
    if (!t || t.type === 'anchor') return false;
    if (ctx.isRoadTile && ctx.isRoadTile(t)) return false;
    return true;
  });
  let hit = 0, saved = 0;
  for (let i = 0; i < out.strikes.length; i++) {
    const st = out.strikes[i];
    if (st.absorbed) { saved++; continue; }
    if (!keys.length) break;
    /* WITHOUT REPLACEMENT. The first cut re-picked from the whole list and the
       driver printed three consecutive strikes on tile "2,2" — which reads to a
       player as one building being unlucky rather than four being overrun, and
       silently wastes strikes on an already-damaged tile (damageTile returns
       false on a second hit and the count would under-report). Splicing the
       picked key out is one line and makes the log line true. */
    const idx = Math.floor(R.draw(S.cityId, 'zombie-target', S.rolls * 64 + i) * keys.length) % keys.length;
    const pick = keys.splice(idx, 1)[0];
    if (ctx.damageTile && ctx.damageTile(pick, st.destroy, '💥 The outbreak')) hit++;
  }
  if (saved > 0 && ctx.toast) {
    ctx.toast('☣️ Quarantine held — ' + saved + ' strike' + (saved === 1 ? '' : 's') +
      ' contained. (' + Math.round((out.strikes[0] ? out.strikes[0].shield : 0) * 100) + '% cover)', 'good');
  }
  if (ctx.logEvent) ctx.logEvent('raid', head + ' BREACHED — ' + tally + '. ' +
    hit + ' building' + (hit === 1 ? '' : 's') + ' ' + (out.strikes.some((s) => s.destroy) ? 'levelled' : 'overrun') +
    (saved ? ', ' + saved + ' strike' + (saved === 1 ? '' : 's') + ' contained by quarantine' : '') +
    '. ' + out.newDead + ' more dead join the ' + Math.round(S.unburied) + ' unburied — bury them or this repeats.');
}

/* ══ THE CARD ══════════════════════════════════════════════════════════════
   Diffed against the last string, exactly as renderLog() and the economy card
   do: innerHTML on an unchanged string is a layout pass nobody asked for. */
function paint() {
  if (!ctx || !ctx.el) return;
  const card = ctx.el('zcard'); if (!card) return;
  /* 🔴 ASK THE SAME QUESTION THE MODEL ASKS. This gate used to read
     R.armed(cap), i.e. the FALLBACK `deathcare: { inter }` sweep — and that
     contract has no rows in the shipped table, so the flag was permanently
     false and the Dormant/Clear states never rendered even while the engine
     was armed through /src/mortality. inputs().armed is the flag resolve()
     actually rolls against, so the card is on screen exactly when the city can
     be rolled. One question, one answer. */
  const inp = inputs();
  const show = inp.armed || S.unburied > 0 || S.deaths > 0;
  const disp = show ? '' : 'none';
  if (card.style.display !== disp) card.style.display = disp;
  if (!show) return;

  const f = R.forecast(S, inp);
  const M = mortality();
  /* One shape for the card whichever module is holding the bodies. */
  const capView = M
    ? { perDay: M.capPerDay, any: true, plots: M.plots, plotsFree: M.plotsFree,
        sources: M.sites > 0
          ? [{ type: 'grave', name: M.sites + ' burial ground' + (M.sites === 1 ? '' : 's'),
               ico: '🪦', n: M.sites, perDay: M.capPerDay }]
          : [] }
    : cap;
  const html = P.render(f, {
    cap: capView, shield: inp.shield,
    def: ctx.raidDefence ? ctx.raidDefence(false) : null,
    projStrength: projectedStrength(),
    delta: lastDelta, src: S.src, waves: S.waves,
    deaths: S.deaths, interred: S.interred,
    cemeteryTypes: burialTypes(),
  });
  const tt = P.timerText(f);
  const meta = ctx.el('zmeta'), tim = ctx.el('ztimer');
  if (meta && html !== lastHtml) { lastHtml = html; meta.innerHTML = html; }
  if (tim && tt !== lastTimer) { lastTimer = tt; tim.textContent = tt; }
  const b = P.band(f);
  card.classList.toggle('warn', b.id === 'watch');
  card.classList.toggle('danger', b.id === 'danger');
}

/* ══ PUBLIC API ════════════════════════════════════════════════════════════ */
export function mount(host) {
  ctx = host || {};
  S = R.loadState(pending, ctx.cityId);
  externalLatched = !!(S.src && S.src !== 'coverage collapse');
  mounted = true;
  cap = R.capacityOf(ctx.tiles ? ctx.tiles() : {}, ctx.BUILDINGS, ctx.bldSite);
  try {
    if (typeof window !== 'undefined' && window.MythicCitySave) {
      window.MythicCitySave.register('zombie', { save: () => R.saveState(S), load: (b) => load(b) });
    }
  } catch (e) {}
  paint();
  return true;
}

export function load(blob) {
  pending = blob || null;
  if (!mounted) return true;
  S = R.loadState(pending, ctx.cityId);
  externalLatched = !!(S.src && S.src !== 'coverage collapse');
  lastPop = null; lastHtml = ''; lastTimer = '';
  paint();
  return true;
}

/* Driven from node-city's frame loop beside raidTick(dt). Cheap per frame: the
   accumulator means the model and the 576-tile capacity sweep run once a
   second, not sixty times. */
export function tick(dt) {
  if (!mounted || busy) return;
  const d = num(dt);
  if (!(d > 0)) return;
  acc += d; paintAcc += d;
  if (acc >= BEAT) {
    const step = acc; acc = 0;
    busy = true;
    try {
      cap = R.capacityOf(ctx.tiles ? ctx.tiles() : {}, ctx.BUILDINGS, ctx.bldSite);
      beat(step);
    } catch (e) { console.warn('[Zombie] beat', e); }
    busy = false;
  }
  if (paintAcc >= PAINT) { paintAcc = 0; try { paint(); } catch (e) {} }
}

/* 🔴 THE ONE INGRESS. Anything that kills a citizen calls this and becomes the
   city's death source; the fallback latches off on the first call and never
   comes back for this session. `source` is printed in the card, so the player
   can always see WHO says people are dying. */
export function reportDeaths(n, source) {
  if (!mounted) return 0;
  const d = Math.max(0, num(n));
  if (!(d > 0)) return 0;
  externalLatched = true;
  S.src = String(source || 'deathcare');
  /* Bucketed, not applied. beat() spends it through the model's one ingress
     line so the backlog AND the death-rate estimate see the same bodies. */
  pendingDeaths += d;
  return d;
}

export function report() {
  if (!mounted) return null;
  const inp = inputs();
  return {
    risk: S.risk, unburied: S.unburied, waves: S.waves, rolls: S.rolls,
    deaths: S.deaths, interred: S.interred, src: S.src,
    capacity: cap, forecast: R.forecast(S, inp), gate: R.permit(S, inp.armed),
    strength: projectedStrength(),
  };
}

export function state() { return S; }
export function verify() { return R.verify(); }

/* Exposed so the headless driver can run the identical model without a DOM,
   and so a future round has a seam that is not `import`ing a private. */
export const model = R;
export const tuning = ZOM;

if (typeof window !== 'undefined') {
  window.MythicZombie = { mount, load, tick, reportDeaths, report, state, verify, model, tuning, panel: P };
}

export default { mount, load, tick, reportDeaths, report, state, verify, model, tuning };
