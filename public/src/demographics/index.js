/* ════════════════════════════════════════════════════════════════════════════
   👥 DEMOGRAPHICS — module entry point. Registers window.MythicDemographics.
   ----------------------------------------------------------------------------
   "Zones bring different levels of population and the types of people that come
    move into the city."

   That is the whole feature, and it is a CONSEQUENCE model, not a counter: what
   you zoned decides how many dwellings stand on a tile and which households
   want one; who lives in them decides what educations the city has; what
   educations the city has decides which industries can staff up; and that feeds
   back into who wants to come. Zone only low-rent housing and the advanced
   industries never open. Zone only detached houses and the city is small,
   wealthy and short of hands.

   🔴 THE GLOBALS TRAP (CLAUDE.md, twice paid for). `game`, `BUILDINGS`,
   `NODE_TYPES`, `Profile` are top-level `const` in their hosts and invisible to
   an ES module — `window.game` does not exist. So this module reads NOTHING by
   itself. The tiles arrive in `tick(dtMin, host)`, gathered by the caller, and
   everything economic arrives through `window.MythicEconomy`, which IS on
   window because a module put it there.

   🔴 AND EVERYTHING DEGRADES.
     · no /src/zoning → zones.js derives a zone from the building the player
       already placed, and the feature works alone (zones.js header).
     · no window.MythicEconomy → no wages, no vacancies, no rent index; the
       pipeline reads "no information" rather than "no work" and the city simply
       fills its zoning (pipeline.js `jobFitByEducation`).
     · a 404 on THIS module → node-city's guarded import catches it, the People
       tab never appears, and the city ticks exactly as it did before. Nothing
       in node-city depends on a return value from here.

   ── WHAT THIS TOUCHES, AND WHAT IT MUST NEVER TOUCH ─────────────────────────
   TOUCHES: its own cohort state, persisted inside the city save blob; two
     OPTIONAL providers registered on the economy (a labour ladder and an
     arrival wealth mix), both of which the economy ignores if absent.
   NEVER TOUCHES: any balance, anywhere. Not `addCinders`, not `addRes`, not the
     treasury, not a firm's cash, not `HH.savings`. 🔴 Cinder is never minted,
     and sim.js asserts a closed loop every tick — this module's entire output is
     headcount and composition, so the audit identity is untouched by
     construction rather than by care. See pipeline.js's header.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';
/* 🔴 ONE CONSTANT, AND IT IS IMPORTED RATHER THAN COPIED. households.js already
   owns "what fraction of a citizenry is of working age", and a second copy here
   would be a number that means the same thing in two files — the exact
   duplication ECON.price's header describes ("the first wage retune makes them
   disagree, silently"). It is only ever read as a FALLBACK, for the case where
   the economy has not mounted and cannot report its own labour force.
   ⚠ NO ?v= ON THIS IMPORT. index.html's roster seam documents why: a module is
     identified by its resolved URL, and /src/economy/index.js imports
     './households.js' with no query — a cache-buster here would instantiate a
     SECOND households.js with its own population and savings. */
import { WORKING_AGE_PCT } from '../economy/households.js';
import * as A from './archetypes.js';
import * as Z from './zones.js';
import * as P from './pipeline.js';
import * as R from './render.js';

const D = () => ECON.demographics;

let mounted = false;
let cssInjected = false;
let wired = false;
/* The last tick's survey and derived figures. Read by `residents()` (the
   dossier can be opened between ticks) and by `capacityDelta()`, which
   node-city calls from popCap() — a function that runs inside loops over every
   tile in the city, so it must be a field read and never a re-survey. */
const LAST = { survey: null, delta: 0, budget: 0, posts: null, seekers: 0, services: 1, at: 0 };

function eco() {
  try { return (typeof window !== 'undefined' && window.MythicEconomy) || null; } catch (e) { return null; }
}

/* ── 🚶 CAN THEY ACTUALLY GET THERE? ────────────────────────────────────────
   A resident who is QUALIFIED for a job and cannot reach it does not hold that
   job, and until this existed nothing anywhere in the city modelled the second
   half of that sentence — /src/transit was measured end to end and moved
   employment, vacancies, unemployment, satisfaction and migration by exactly
   ZERO (see TRANSIT_ECON.commute in /src/transit/tuning.js for the run).

   /src/transit owns the geometry — it already knows every home tile, every
   workplace tile and how much of the commute its lines carry — so it answers
   the question and this module consumes the answer. One number, `access`: the
   share of the city's jobs its residents can turn up to.

   🔴 ABSENT ⇒ 1, AND THAT IS THE OLD CONTRACT, NOT A FALLBACK. No /src/transit
      (404, or an older build with no `jobAccess`) means full access, which is
      exactly how hiring behaved before this wire existed. Same shape as
      `jobFitByEducation`'s "no posts is no information": a missing sibling
      module must never be read as a hostile fact about the city.
   ⚠ AND IT IS CLAMPED TO (0,1]. A provider answering 0, NaN or 1.4 would
     respectively empty the city's payrolls, poison the ladder with NaN, or
     invent workers — so an answer outside the range is treated as no answer. */
function commuteAccess() {
  try {
    const T = (typeof window !== 'undefined' && window.MythicTransit) || null;
    if (!T || typeof T.jobAccess !== 'function') return 1;
    const a = T.jobAccess();
    const v = a ? Number(a.access) : NaN;
    return (Number.isFinite(v) && v > 0 && v <= 1) ? v : 1;
  } catch (e) { return 1; }
}

/* ── 🔌 THE TWO PROVIDERS ───────────────────────────────────────────────────
   Registered on the economy the first time it is ready, and only then. Both are
   PULL: the economy calls them when it wants an answer, so there is no cached
   copy of this module's state living over there to go stale — the bug shape
   ECONOMY.md records as "host object stored BY REFERENCE leaked NaN into a
   panel while every internal number stayed correct".

   ⚠ IF EITHER FUNCTION IS MISSING FROM THE ECONOMY, NOTHING BREAKS. An older
     /src/economy simply has no `setLabourSupply`, in which case hiring stays
     education-blind exactly as it was and this module is descriptive only. */
function wireEconomy() {
  if (wired) return false;
  const E = eco();
  if (!E) return false;
  let any = false;
  try {
    if (typeof E.setLabourSupply === 'function') {
      /* 🎓 QUALIFIED, AND 🚶 ABLE TO GET THERE. `labourLadder()` stays PURE —
         it is the education answer and the People panel prints it as such —
         and the commute is applied HERE, on the way out, because `hire()`'s
         cap means "how many residents are available to this band" and reach is
         the other half of available. Floored, like the ladder itself, so the
         cap stays a whole headcount. */
      E.setLabourSupply(() => {
        const bands = P.labourLadder();
        const reach = commuteAccess();
        if (reach < 1) for (const b in bands) bands[b] = Math.floor((bands[b] || 0) * reach);
        return { bands };
      });
      any = true;
    }
  } catch (e) {}
  try {
    if (typeof E.setArrivalTierMix === 'function') {
      E.setArrivalTierMix(() => P.arrivalTierMix());
      any = true;
    }
  } catch (e) {}
  wired = any;
  return any;
}

function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  try {
    const st = document.createElement('style');
    st.textContent = R.DEMOG_CSS;
    document.head.appendChild(st);
    cssInjected = true;
  } catch (e) {}
}

/* ── MOUNT ──────────────────────────────────────────────────────────────────
   `state` is the blob from the save, or null for a city that has never carried
   one. An absent blob is not an empty city: the first tick SEEDS the cohorts
   from the population the host already has (pipeline.js `seed`), because those
   people were already living there and a lived city must not empty itself the
   day this module ships. */
function mount(opts) {
  opts = opts || {};
  P.reset();
  if (opts.state) P.load(opts.state);
  injectCss();
  mounted = true;
  wireEconomy();
  return true;
}

/* ── THE TICK ───────────────────────────────────────────────────────────────
   `dtMin` is real minutes — the same clock node-city and the economy already
   run on. A second clock would drift and two panels would disagree about how
   long a day is (ECON.clock.dayMin is the one conversion).

   `host` is { parcels, population }:
     parcels    [{ key, x, z, type, lvl, popCap, site }] — every tile that could
                hold homes. `popCap` is what that tile already contributes to
                node-city's own cap, and it is the field that stops zoned
                capacity being counted twice (zones.js `capacityDelta`).
     population the most residents the city says it supports. This module never
                invents people: it decides how many of THOSE the zoning houses,
                and who they are. */
function tick(dtMin, host) {
  if (!mounted) return null;
  try {
    const h = host || {};
    Z.beginTick();
    const sv = Z.survey(h.parcels);
    LAST.survey = sv;
    LAST.delta = Z.capacityDelta(sv);
    const budget = Math.max(0, Number(h.population) || 0);
    LAST.budget = budget;

    /* 👷 WHAT THE LABOUR MARKET LOOKS LIKE FROM A DOORSTEP. Read fresh every
       tick and never stored on the economy's side. `posts` null means "no
       economy mounted", which the pipeline reads as no information rather than
       as no work — a 404 on a sibling module must not depose the population. */
    let posts = null, seekers = 0, services = 1;
    const E = eco();
    if (E) {
      try {
        if (typeof E.labourMarket === 'function') {
          const lm = E.labourMarket();
          if (lm && lm.vacancies) posts = lm.vacancies;
        }
        const snap = (typeof E.ready === 'function' && E.ready() && typeof E.snapshot === 'function') ? E.snapshot() : null;
        if (snap) {
          seekers = Math.max(0, snap.laborForce || 0);
          const sat = snap.satisfaction || {};
          let n = 0, k = 0;
          for (const key in sat) { n += Math.max(0, Math.min(1, sat[key] || 0)); k++; }
          if (k > 0) services = n / k;
        }
      } catch (e) { posts = null; }
    }
    if (!(seekers > 0)) seekers = Math.max(1, Math.round(P.population() * WORKING_AGE_PCT));
    LAST.posts = posts; LAST.seekers = seekers; LAST.services = services;

    /* 🌱 First run on a city with no saved cohorts: place the people who are
       already here into the zoning that is already there. */
    if (!P.seeded()) P.seed(sv, Math.min(budget, sv.totalCapacity));

    const days = Math.max(0, (Number(dtMin) || 0) / ECON.clock.dayMin);
    const st = P.step(days, { survey: sv, budget, posts, seekers, services });
    LAST.at = Date.now();
    wireEconomy();
    return st;
  } catch (e) {
    /* A failure in here must never take the city down. The city is a feature;
       the game is the product. */
    try { console.error('[demographics] tick failed', e); } catch (e2) {}
    return null;
  }
}

/* ── 🏙 WHAT THE HOST READS BACK ────────────────────────────────────────────
   `population()` is how many people the zoning actually houses, and it is what
   the economy is handed instead of the raw city figure. It can only ever be
   LOWER: this module never invents a resident, so a city whose zoning cannot
   house its people has fewer of them working and spending, which is the feature
   ("zones bring different levels of population") pointing the only direction it
   is allowed to point.
   ⚠ Returns null when this module has nothing to say, so the caller can fall
     back to its own figure rather than reading a 0 as an answer. */
function population() {
  if (!mounted || !P.seeded()) return null;
  const n = P.population();
  return isFinite(n) ? Math.max(0, Math.round(n)) : null;
}
/* What zoning adds to the city's own population ceiling — explicitly zoned land
   only, never a derived guess. See zones.js `capacityDelta`. */
function capacityDelta() { return mounted ? (LAST.delta | 0) : 0; }
function capacity() { return LAST.survey ? Math.round(LAST.survey.totalCapacity) : 0; }

/* ════════════════════════════════════════════════════════════════════════════
   📊 THE READ API
   ----------------------------------------------------------------------------
   Two consumers, one contract each.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🏛 FOR /src/dossier — THE BUILDING PANEL'S "RESIDENTS" AND "HOUSEHOLD WEALTH".
   ----------------------------------------------------------------------------
       window.MythicDemographics.residents(tileKey) -> {
         ok, why,                                   // ok:false + a sentence
         key, zone: { id, name, ico, src },         // src 'zoned' | 'derived'
         homes, occupied, residents,                // integers
         wealth: { tier, label, ico },              // the building's household wealth
         rent, rentBurden,                          // per dwelling per economic day
         income, jobFit,                            // what the households here earn
         households: [ { archetype, name, ico, label, size, education, eduLabel,
                         wealth, income, jobFit,
                         ages: {child,young,adult,senior} } ]
       }

   💸 `rent` and `income` ARE DENOMINATED IN CINDER PER ECONOMIC DAY — both are
   priced off `ECON.labor.bands.*.wage` and nothing else — but NEITHER IS A
   TRANSFER. They are the two sides of the affordability test this pipeline runs
   every tick to decide who moves in and who leaves (pipeline.js step 2 and 4).
   The Cinder that actually moves is `HH.chargeRent()` and `HH.payWages()`,
   city-wide, inside sim.js's audited day. A consumer printing these MUST say
   which it is showing; /src/dossier's books card does.
   Guarded on both sides: call it inside a try, and treat `ok:false` as "this
   building has no residents" rather than as an error. Markup for the two rows
   is available as `renderResidents(d)` if the dossier wants it, but the numbers
   are the contract and the markup is not.

   🔴 THE HOUSEHOLDS ARE DRAWN, NOT SIMULATED, AND THEY ARE STABLE. The model
   underneath is cohort counts — there is no per-building object anywhere — so
   the individual households here are drawn deterministically from the tile key
   and the zone's LIVE cohort mix. Same technique citizens.city.js uses for
   names: citizen #7 is Ilva Vantree in every session. Open the same building
   twice and it is the same three people; open it after a tower filled up and
   the mix has moved because the city has. */
function residents(tileKey) {
  try {
    if (!mounted || !LAST.survey) return { ok: false, why: 'The city has not been surveyed yet.' };
    const info = LAST.survey.byKey.get(String(tileKey));
    if (!info) return { ok: false, why: 'Nobody lives here — this land is not zoned for housing.' };
    const zdef = Z.zoneDef(info.zone);
    const zoneHomes = LAST.survey.homes[info.zone] || 0;
    const zoneOcc = P.occupiedHomes(info.zone);
    const fill = zoneHomes > 0 ? Math.max(0, Math.min(1, zoneOcc / zoneHomes)) : 0;
    const occupied = Math.round(info.homes * fill);

    /* The bag is the zone's REAL cohort mix, so the dossier shows who actually
       lives in this district rather than who the zone was designed for. */
    const bag = {};
    for (const k in P.state().co) {
      const c = P.parseKey(k);
      if (c.zone !== info.zone) continue;
      bag[c.arch + '|' + c.edu] = (bag[c.arch + '|' + c.edu] || 0) + P.state().co[k];
    }
    /* 👷 THE LABOUR MARKET AS THIS ADDRESS SEES IT, recomputed from the fields
       the last tick left behind rather than stored: `jobFitByEducation` is a
       pure function of (posts, seekers) and pipeline.js calls it with exactly
       these two every step. A cached copy would be a second opinion about the
       same city — the failure terroir.js's rule names, and one this codebase
       has already paid for. Null posts is "no economy mounted", which the
       pipeline reads as no information rather than as no work. */
    const fit = P.jobFitByEducation(LAST.posts, LAST.seekers);

    const out = [];
    let heads = 0, incomeTotal = 0;
    const tierScore = { low: 0, mid: 0, high: 0 };
    for (let i = 0; i < occupied; i++) {
      const seed = A.seedOf(String(tileKey) + '#' + i);
      const pick = A.pickWeighted(bag, A.rnd(seed));
      if (!pick) break;
      const [arch, edu] = pick.split('|');
      const size = A.drawSize(arch, A.rnd(seed ^ 0x5bf03635));
      const def = A.archetype(arch), ed = A.eduDef(edu);
      const tier = A.wealthTier(arch, edu);
      tierScore[tier] += size;
      heads += size;
      /* 💸 …AND WHAT THEY EARN, at the job fit their education actually reads —
         the SAME call, with the SAME argument, that step 2 uses to decide
         whether this household can still afford to live here. Passing 1 here
         instead (see `rentBurden` below, which used to) prints the income they
         would have in a city with work for everybody, which is not the income
         the model is about to evict them over. */
      const inc = A.incomeOf(arch, edu, fit[edu]);
      incomeTotal += inc;
      out.push({
        archetype: arch, name: def ? def.name : arch, ico: def ? def.ico : '🏠',
        label: A.describe(arch, edu), size,
        education: edu, eduLabel: ed ? ed.label : edu,
        wealth: tier, wealthLabel: A.TIER_LABEL[tier],
        income: Math.round(inc * 100) / 100,
        jobFit: Math.round((fit[edu] || 0) * 1000) / 1000,
        ages: A.agesOf(arch, size),
      });
    }
    let tier = 'low', best = -1;
    for (const t in tierScore) if (tierScore[t] > best) { best = tierScore[t]; tier = t; }
    const rent = P.rentOf(info.zone);
    /* One representative burden, from the FIRST household here — the panel
       wants "can these people afford this", not a city average.
       ⚠ AT THE LIVE JOB FIT, NOT AT 1. This passed a hardcoded `1`, i.e. full
         employment, so the dossier printed a burden the city's own departure
         test (pipeline.js step 2, `rent / incomeOf(..., fit[edu])`) disagreed
         with — and it disagreed in the direction that matters, reading a
         household as comfortable in the same tick the model was deciding they
         could no longer pay. One question, one answer. */
    const lead = out[0];
    const income = lead ? lead.income : 0;
    return {
      ok: true, key: String(tileKey),
      zone: { id: info.zone, name: zdef ? zdef.name : info.zone, ico: zdef ? zdef.ico : '🏠', src: info.src },
      homes: info.homes, occupied, residents: Math.round(heads),
      wealth: { tier, label: A.TIER_LABEL[tier], ico: A.TIER_ICO[tier] },
      rent: Math.round(rent * 10) / 10,
      rentBurden: income > 0 ? Math.round((rent / income) * 100) / 100 : null,
      /* Cinder per economic day, summed over the households actually let here.
         See the header: an affordability figure, not a payment. */
      income: Math.round(incomeTotal * 100) / 100,
      jobFit: (() => { const o = {}; for (const e in fit) o[e] = Math.round(fit[e] * 1000) / 1000; return o; })(),
      households: out,
    };
  } catch (e) {
    return { ok: false, why: 'Resident records could not be read.' };
  }
}

/* 📊 FOR THE CITY PANEL — population by wealth, by education, by age, and what
   is limiting growth. Every figure is a sum the pipeline already holds; nothing
   here computes a second opinion. */
const LIMIT_TEXT = {
  nohousing: 'nothing is zoned residential',
  homes: 'every dwelling is occupied',
  citycap: 'the city itself supports no more residents',
  rent: 'rents are above what arrivals can pay',
  jobs: 'there is no work they qualify for',
  leaving: 'more people are leaving than arriving',
};
function report() {
  if (!mounted) return { ok: false, why: 'The people of this city have not been counted yet.' };
  try {
    const sv = LAST.survey;
    const st = P.state();
    const pop = P.population();
    const wealth = P.byWealth(), edu = P.byEducation(), ages = P.byAge();
    const archHH = P.byArchetype(), zoneHH = P.byZone();
    let adults = 0; for (const e in edu) adults += edu[e];
    const zones = [];
    for (const zid of Z.zoneIds()) {
      const homes = sv ? (sv.homes[zid] || 0) : 0;
      if (homes <= 0) continue;
      const zd = Z.zoneDef(zid);
      let residentsIn = 0;
      for (const k in st.co) {
        const c = P.parseKey(k);
        if (c.zone === zid) residentsIn += st.co[k] * A.avgSize(c.arch);
      }
      zones.push({
        id: zid, name: zd.name, ico: zd.ico, desc: zd.desc,
        homes, occupied: zoneHH[zid] || 0, residents: residentsIn,
        rent: P.rentOf(zid),
        /* ⚠ PER ZONE, NOT PER CITY. This read `sv.zonedTiles > 0`, so one
           zoned tile anywhere labelled every district "zoned" — including the
           ones the module had guessed from a Housing building, which is the one
           thing the player most needs to be able to tell apart. */
        src: (sv && sv.zoned[zid] > 0) ? 'zoned' : 'derived',
        tiles: sv ? (sv.tiles[zid] || 0) : 0,
      });
    }
    const ladder = P.labourLadder();
    const bandNames = Object.keys(ECON.labor.bands);
    /* 🚶 The commute, read fresh rather than off LAST.access: the panel can be
       opened between hires, and a stale number in a readout that exists to
       explain an unfilled vacancy is worse than no readout. */
    const access = commuteAccess();
    const labourNote = bandNames.map(b => ECON.labor.bands[b].label + ' ' + Math.round(ladder[b] || 0)).join(' · ') +
      ' — that is how many residents are QUALIFIED for each band of work, not how many hold it.' +
      (access < 0.999
        ? ' Only ' + Math.round(access * 100) + '% of the city\'s jobs are within reach of anybody, ' +
          'so the rest go unfilled however many people are standing about — put a transit line through them.'
        : '');
    return {
      ok: true,
      population: Math.round(pop), households: Math.round(P.households()),
      homes: sv ? sv.totalHomes : 0,
      capacity: sv ? Math.round(sv.totalCapacity) : 0,
      occupancy: sv && sv.totalHomes > 0 ? P.households() / sv.totalHomes : 0,
      netPerDay: st.rate.in - st.rate.out,
      attract: st.attract, causes: st.causes.slice(),
      limit: st.limit, limitText: st.limit ? LIMIT_TEXT[st.limit] : '',
      rentIndex: st.rentIndex,
      /* The LAST WHOLE DAY, not the last tick — a tick is a quarter of a day and
         printing one as a daily figure is how the panel reported −1,167
         residents/day in a city of 249. See pipeline.js `acc`. */
      flow: { ...st.day },
      adults,
      wealth: ['low', 'mid', 'high'].map(t => ({ k: t, label: A.TIER_LABEL[t], v: wealth[t] })),
      education: A.eduOrder().map(e => ({ k: e, label: A.eduDef(e).short, v: edu[e] || 0 })),
      ages: Object.keys(D().ages).map(g => ({ k: g, label: D().ages[g].label, v: ages[g] || 0 })),
      archetypes: A.archetypeIds().map(a => ({
        id: a, name: A.archetype(a).name, ico: A.archetype(a).ico,
        households: archHH[a] || 0, avgSize: A.avgSize(a),
      })),
      zones, ladder, labourNote,
      /* The commute gate, published so a driver (and the panel) can read the
         number rather than infer it from an employment figure that moved. */
      jobAccess: access,
      zoning: Z.zoningPresent(),
      sourceNote: Z.zoningPresent()
        ? 'Zones come from the zoning tool. Rent here is an affordability index used to decide who moves in — it never moves Cinder; the rent that does is charged inside the economy.'
        : 'No zoning tool is loaded, so each district was READ OFF the building standing on it (a level-1 Housing is a detached house, a level-5 is a tower). Zoning land explicitly is what raises the city\'s own population ceiling.',
    };
  } catch (e) {
    return { ok: false, why: 'The demographic panel could not be drawn.' };
  }
}

function serialize() { return mounted ? P.serialize() : null; }
function load(raw) { P.reset(); const ok = P.load(raw); mounted = true; return ok; }

const api = {
  // lifecycle
  mount, tick, serialize, load,
  ready: () => mounted,

  // what the host reads back
  population, capacity, capacityDelta,

  // the read API — see the headers above each
  residents, report,
  render: () => R.renderPanel(report()),
  renderResidents: (key) => R.renderResidents(residents(key)),
  css: R.DEMOG_CSS,

  // seams a driver and a sibling module can use
  zoneOf: (parcel) => Z.zoneOf(parcel),
  survey: () => LAST.survey,
  ladder: () => P.labourLadder(),
  tierMix: () => P.arrivalTierMix(),
  state: () => P.state(),
  ECON: () => D(),
};

/* 🔌 module → window is the direction that works; window → a top-level `const`
   in a host is the direction that does not. Same pattern /src/economy/index.js
   and /src/resources/chain.js already use. */
try { if (typeof window !== 'undefined') window.MythicDemographics = api; } catch (e) {}

export default api;
