/* ══════════════════════════════════════════════════════════════════════════
   👥 POPULATION — why people move here, why they leave, and where they went.
   ══════════════════════════════════════════════════════════════════════════
   THE ASK: a dynamic population system where "players should NOT simply place
   houses and automatically receive NPCs. NPCs should decide whether to move
   into a city, remain there, start families, move away, or die based on the
   actual condition of the city."

   WHAT IT REPLACES: node-city grew its citizenry on one rule — if Food, Water
   and Health coverage were all ≥ 90% it added 0.35 people a minute, and if any
   fell under 60% it removed up to 0.55. Housing was a hard ceiling. That is a
   thermostat, not a society: nobody arrived or left for a reason anyone could
   name, and the number could not be accounted for.

   🔴 THE ONE RULE THIS MODULE EXISTS TO KEEP (§23 of the ask):

          births + immigration − deaths − emigration = net change

      Not approximately. EXACTLY, every tick, or the tick is a bug. Every
      population figure the player is shown is a running total of four counted
      flows, and `audit()` re-derives the population from the ledger and returns
      the discrepancy — which must be zero. That constraint is what stops this
      becoming the thermostat again with more adjectives: you cannot fake a
      number that has to be the sum of four things you can point at.

   ⚠ IT DECIDES NOTHING ABOUT THE CITY. Every input is measured by the host and
     handed in; this module reads them and returns what should happen. It never
     touches game state, never writes a save, never renders. That is what makes
     the whole of it testable without a browser, which for a simulation nobody
     can watch directly is the difference between "it works" and "it looks like
     it works".

   ⚠ AND IT IS AGGREGATE, NOT PER-NPC, ABOVE A FEW HUNDRED PEOPLE. The ask is
     explicit that this may one day be "tens or hundreds of thousands of NPCs"
     and that per-NPC-per-frame work is forbidden. Named citizens stay
     individual — they have faces, jobs and moods elsewhere in the city — and
     everyone else is simulated as cohorts. A cohort is a real person's worth of
     demand; it just does not have a name.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── WHAT MAKES A CITY WORTH MOVING TO ─────────────────────────────────────
   🔴 THE WEIGHTS ARE THE DESIGN, AND THEY ARE NOT EQUAL — the ask says so in
      as many words: "Do NOT make every category equally important. Basic
      necessities such as housing, food, employment, water, electricity,
      healthcare, and safety should have significantly more influence than
      entertainment or parks."
      So the six things a person cannot live without carry 63 of the 100 points
      between them, and every comfort in the game put together carries 9. A city
      with a concert hall and no water should be unliveable, and with these
      weights it is.
   ⚠ EACH TERM IS 0..1 AND IS SUPPLIED BY THE HOST. A term the host cannot
     measure is ABSENT, not zero — see score(), where absent terms are dropped
     from both the numerator and the denominator. Scoring a missing sewage
     system as 0 would punish a player for a feature that does not exist yet. */
export const WEIGHTS = {
  // ── the six that decide whether life is possible at all: 63 points ──
  housing:      14,   // somewhere to live, and enough of it
  food:         12,
  water:        11,
  safety:       10,   // 🗡 heavier here than in an ordinary city builder, per the ask
  power:         8,
  healthcare:    8,
  // ── the things that decide whether life is worth living: 28 ──
  jobs:          9,   // work available, at wages worth taking
  affordability: 6,   // …and housing a working household can pay for
  wages:         4,
  education:     4,
  crime:         3,   // low crime scores high
  sanitation:    2,   // sewage + refuse
  // ── the comforts: 9 ──
  transport:     3,
  entertainment: 2,
  environment:   2,   // pollution, parks, the look of the place
  economy:       2,   // business activity, a city that is going somewhere
};
export const WEIGHT_TOTAL = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/* ── HOW THAT NUMBER READS ────────────────────────────────────────────────
   The bands the ask specifies, with the sentence a player sees. */
export const BANDS = [
  { at: 90, id: 'booming',    name: 'Booming',    tone: 'good',
    blurb: 'People are queuing at the gate. Large numbers want to move in.' },
  { at: 75, id: 'growing',    name: 'Growing',    tone: 'good',
    blurb: 'Strong immigration and healthy natural growth.' },
  { at: 60, id: 'stable',     name: 'Stable',     tone: 'ok',
    blurb: 'Moderate immigration and normal birth rates.' },
  { at: 45, id: 'stagnating', name: 'Stagnating', tone: 'warn',
    blurb: 'Very little population growth. People are staying put, not arriving.' },
  { at: 30, id: 'declining',  name: 'Declining',  tone: 'warn',
    blurb: 'More residents are thinking about leaving than arriving.' },
  { at: -1, id: 'crisis',     name: 'Crisis',     tone: 'bad',
    blurb: 'People are actively leaving. This does not stop until conditions do.' },
];
export function bandFor(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  for (const b of BANDS) if (s >= b.at) return b;
  return BANDS[BANDS.length - 1];
}

/* ── LIFE STAGES ──────────────────────────────────────────────────────────
   🔴 CHILDREN MUST GROW UP BEFORE THEY CAN WORK. The ask is explicit: "Do NOT
      spawn working adults from children." So the workforce is exactly the three
      middle stages, and a baby born today is a liability for years before it is
      an asset — which is the whole reason a city with a birth spike and no
      schools gets poorer before it gets richer. */
export const STAGES = [
  { id: 'baby',    name: 'Babies',       from: 0,  to: 3,   works: false, schools: null },
  { id: 'child',   name: 'Children',     from: 4,  to: 12,  works: false, schools: 'elementary' },
  { id: 'teen',    name: 'Teenagers',    from: 13, to: 17,  works: false, schools: 'high' },
  { id: 'young',   name: 'Young adults', from: 18, to: 29,  works: true,  schools: 'college' },
  { id: 'adult',   name: 'Adults',       from: 30, to: 64,  works: true,  schools: null },
  { id: 'elder',   name: 'Elderly',      from: 65, to: 999, works: false, schools: null },
];
export const WORKING_STAGES = STAGES.filter((s) => s.works).map((s) => s.id);

/* ── THE HOUSEHOLD SHAPES people arrive in ────────────────────────────────
   The ask: "NPCs should normally immigrate as households instead of individual
   random NPCs." `mix` is the share of each stage in that household, and `w` is
   how common the shape is. A city of nothing but single adults is a barracks. */
export const HOUSEHOLDS = [
  { id: 'single',    name: 'a single adult',            w: 22, size: 1, mix: { adult: 1 } },
  { id: 'couple',    name: 'a couple',                  w: 18, size: 2, mix: { adult: 2 } },
  { id: 'family',    name: 'a couple with children',    w: 20, size: 4, mix: { adult: 2, child: 2 } },
  { id: 'single_p',  name: 'a single parent',           w: 10, size: 3, mix: { adult: 1, child: 2 } },
  { id: 'large',     name: 'a large family',            w:  8, size: 6, mix: { adult: 2, teen: 2, child: 2 } },
  { id: 'elders',    name: 'an elderly couple',         w: 10, size: 2, mix: { elder: 2 } },
  { id: 'roommates', name: 'young adults sharing',      w: 12, size: 3, mix: { young: 3 } },
];

export const TUNING = {
  /* Per real minute, at attraction 100, per 100 residents already here — a city
     grows in proportion to itself, because people move where people are. The
     floor keeps a brand-new city from being unable to start.
     🔴 CALIBRATED AGAINST A 4,000-MINUTE RUN, NOT PICKED. The first set of
        numbers (0.9 / 0.35) read as "a fraction of a percent" and were nothing
        of the sort: proportional growth is exponential, and 0.9 per 100 per
        minute is 0.9%/min — a doubling every 77 minutes. A town of 120 churned
        407,000 arrivals and 422,000 departures in under three simulated days.
        At 0.025 a booming city gains about 1.5% of itself an hour, which is a
        boom a player can watch happen over an evening rather than a number
        that stops meaning anything by morning. */
  IMMIGRATION_RATE: 0.025,
  IMMIGRATION_FLOOR: 0.02,
  /* Births and deaths, per 100 residents per real minute. Deliberately far
     slower than migration: a city's shape is set by who moves in, and only its
     depth by who is born there — and a settlement that grows mostly from
     births is one the player cannot influence by building anything. */
  BIRTH_RATE: 0.004,
  DEATH_RATE: 0.0015,
  /* Emigration is driven by ACCUMULATED dissatisfaction, not by a bad minute —
     "Do NOT make NPCs leave immediately because one problem occurs." Strain
     builds while attraction is under STRAIN_AT and drains while it is over, and
     nobody leaves until it crosses LEAVE_AT. */
  STRAIN_AT: 50, STRAIN_UP: 0.55, STRAIN_DOWN: 0.85, LEAVE_AT: 12, STRAIN_MAX: 100,
  EMIGRATION_RATE: 0.03,
  /* A disaster is a shock that fades, not a scar: −25 attraction at the moment
     it lands, halving every DISASTER_HALFLIFE minutes. */
  DISASTER_HIT: 25, DISASTER_HALFLIFE: 12,
  /* Nobody arrives into a city that cannot take them. */
  MIN_LIVEABLE: { water: 0.25, food: 0.25, power: 0.15, safety: 0.20 },
  POP_FLOOR: 4,
};

/* ══════════════════════════════════════════════════════════════════════════
   THE SCORE
   ctx.terms — { housing: 0..1, food: 0..1, … } — any subset of WEIGHTS.
   ══════════════════════════════════════════════════════════════════════════ */
export function score(terms, opts) {
  const t = terms || {};
  let num = 0, den = 0;
  const parts = [];
  for (const key in WEIGHTS) {
    const v = t[key];
    /* 🔴 ABSENT ⇒ NOT SCORED, which is not the same as scored zero. A build with
       no sewage system must not be marked down for it; a city whose sewers have
       FAILED reports 0 and is. The host decides which of those it is. */
    if (v === null || v === undefined || !Number.isFinite(+v)) continue;
    const w = WEIGHTS[key];
    const val = Math.max(0, Math.min(1, +v));
    num += val * w; den += w;
    parts.push({ key, weight: w, value: val, points: val * w, lost: (1 - val) * w });
  }
  if (!den) return { score: 50, parts: [], measured: 0, why: 'nothing about this city has been measured yet' };
  let s = (num / den) * 100;
  /* Shocks come off the top, after the weighting — a zombie outbreak does not
     make the water worse, it makes the town frightening. */
  const shock = Math.max(0, Number(opts && opts.shock) || 0);
  s = Math.max(0, s - shock);
  return {
    score: Math.round(s * 10) / 10,
    shock,
    parts: parts.sort((a, b) => b.lost - a.lost),
    measured: parts.length,
  };
}

/* The player must never guess (§18). These are the same terms the score is made
   of, sorted by how much they are helping or hurting — so the explanation
   cannot drift from the number, because it IS the number. */
export function reasons(sc, n) {
  const parts = (sc && sc.parts) || [];
  const lim = n || 5;
  const up = parts.filter((p) => p.value >= 0.72).sort((a, b) => b.points - a.points).slice(0, lim);
  const down = parts.filter((p) => p.value < 0.55).sort((a, b) => b.lost - a.lost).slice(0, lim);
  return { up, down };
}

/* ══════════════════════════════════════════════════════════════════════════
   BOTTLENECKS (§16) — capacity is not a number somebody picked, it is whichever
   part of the city runs out first.
   caps: { housing: n, water: n, food: n, healthcare: n, jobs: n, education: n }
   ══════════════════════════════════════════════════════════════════════════ */
export function bottlenecks(pop, caps) {
  const p = Math.max(0, Math.round(Number(pop) || 0));
  const out = [];
  for (const key in (caps || {})) {
    const cap = Math.max(0, Math.round(Number(caps[key]) || 0));
    /* A capacity of zero is a real answer for a city with no hospital — it is
       at infinite percent, and that is exactly the thing to shout about. */
    const pct = cap > 0 ? (p / cap) * 100 : (p > 0 ? Infinity : 0);
    out.push({ key, cap, used: p, pct: Number.isFinite(pct) ? Math.round(pct) : Infinity,
               over: pct > 100 });
  }
  out.sort((a, b) => (b.pct === Infinity ? 1e9 : b.pct) - (a.pct === Infinity ? 1e9 : a.pct));
  /* The binding constraint: the smallest capacity, because that is the one the
     city actually stops at however generous everything else is. */
  const real = out.filter((o) => o.cap > 0);
  const limit = real.length ? real.reduce((a, b) => (b.cap < a.cap ? b : a)) : null;
  return { list: out, limit: limit ? limit.key : null, capacity: limit ? limit.cap : null };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE STATE
   ══════════════════════════════════════════════════════════════════════════ */
function blankStages() {
  /* A founding population that looks like a town rather than a work camp. */
  return { baby: 0.03, child: 0.11, teen: 0.07, young: 0.19, adult: 0.46, elder: 0.14 };
}
export function create(pop) {
  const p = Math.max(TUNING.POP_FLOOR, Math.round(Number(pop) || TUNING.POP_FLOOR));
  const mix = blankStages();
  const stages = {};
  for (const s of STAGES) stages[s.id] = p * (mix[s.id] || 0);
  return {
    pop: p,
    stages,
    strain: 0,          // accumulated dissatisfaction, 0..STRAIN_MAX
    shock: 0,           // disaster penalty, decays
    /* 🔴 THE LEDGER. Lifetime totals, and the only thing allowed to move `pop`.
       Every one of these is incremented by a counted event. */
    /* 🔴 EVERY ONE OF THESE IS A WHOLE NUMBER OF PEOPLE, FOREVER. The first
       version let age() add fractional deaths and the audit came out at
       −1.46e-11 — the identity was arithmetically right and reported FALSE,
       because floating point does not care what you meant. Half a person is
       not a person; the fractions live in _carry until they add up to one. */
    ledger: { births: 0, deaths: 0, immigration: 0, emigration: 0 },
    day: { births: 0, deaths: 0, immigration: 0, emigration: 0 },
    lastArrivals: [],   // household shapes that moved in recently, for the feed
    history: [],
    blocked: null,      // why immigration stopped, if it did
    /* sub-person fractions between ticks — `a` is ageing's own, kept separate
       so the long-term tick cannot borrow against the short one. */
    _carry: { b: 0, d: 0, i: 0, e: 0, a: 0 },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE TICK
   ══════════════════════════════════════════════════════════════════════════
   S      — state from create()
   ctx    — { terms, caps, dtMin, housingFree, jobsFree, liveable, rng }
   Returns a REPORT: what happened and why, with the four flows named.
   ══════════════════════════════════════════════════════════════════════════ */
export function tick(S, ctx) {
  const rep = { births: 0, deaths: 0, immigration: 0, emigration: 0, net: 0,
                score: 0, band: null, blocked: null, arrivals: [] };
  if (!S || !ctx) return rep;
  const dt = Math.max(0, Number(ctx.dtMin) || 0);
  if (dt <= 0) { const s0 = score(ctx.terms, { shock: S.shock }); rep.score = s0.score; rep.band = bandFor(s0.score); return rep; }

  /* 1 · the shock decays whatever else happens */
  if (S.shock > 0) {
    S.shock *= Math.pow(0.5, dt / TUNING.DISASTER_HALFLIFE);
    if (S.shock < 0.2) S.shock = 0;
  }

  const sc = score(ctx.terms, { shock: S.shock });
  const band = bandFor(sc.score);
  rep.score = sc.score; rep.band = band; rep.parts = sc.parts;

  /* 2 · strain: the memory that makes emigration a decision rather than a mood.
     Under STRAIN_AT it builds in proportion to how bad things are; above it,
     it drains. Nobody leaves until it crosses LEAVE_AT, so a bad afternoon
     costs nothing and a bad month empties the town. */
  const gap = (TUNING.STRAIN_AT - sc.score) / TUNING.STRAIN_AT;
  if (gap > 0) S.strain = Math.min(TUNING.STRAIN_MAX, S.strain + gap * TUNING.STRAIN_UP * dt);
  else S.strain = Math.max(0, S.strain + gap * TUNING.STRAIN_DOWN * dt);

  const per100 = (S.pop / 100) || 0.01;

  /* 3 · BIRTHS. Scaled by the conditions that actually decide whether people
     have children — a home, food, healthcare and a reason to be hopeful. */
  const t = ctx.terms || {};
  const fert = clamp01(avgOf([t.housing, t.food, t.healthcare, t.safety])) * (sc.score / 100);
  let births = TUNING.BIRTH_RATE * per100 * fert * dt;

  /* 4 · DEATHS. The floor is ordinary mortality; poor healthcare, hunger and
     danger raise it. The elderly share drives it, which is what makes a city
     that never attracts young families slowly stop. */
  const care = clamp01(avgOf([t.healthcare, t.food, t.water, t.safety]));
  const elderShare = S.pop > 0 ? (S.stages.elder || 0) / S.pop : 0.14;
  let deaths = TUNING.DEATH_RATE * per100 * (0.6 + elderShare * 1.6) * (1 + (1 - care) * 2.2) * dt;

  /* 5 · IMMIGRATION — and every gate it has to clear (§3).
     🔴 ATTRACTION ALONE NEVER GUARANTEES ANYBODY. "If the city has extremely
        high attraction but no housing, immigration should stop." A city can be
        the most desirable place in New America and still take nobody, because
        there is nowhere to put them. */
  let immigration = 0;
  const gateFail = immigrationBlock(ctx, sc);
  S.blocked = gateFail;
  rep.blocked = gateFail;
  if (!gateFail) {
    /* 🔴 THE TWO GATES DISAGREED, AND THE GAP WAS A SILENT DEAD ZONE.
       immigrationBlock() refuses everything below 30 and SAYS WHY — 'Nobody
       wants to move here right now'. This line then zeroed everything below
       40. So a city scoring 30-40 passed every stated gate, was told nothing
       was wrong, and still took zero arrivals for ever: 23 dwellings standing
       empty, a growth gate reading OPEN, and a population that never moved.
       Reported as "make it where our players city builder increase population
       for the city growth".
       The threshold is now the one the refusal already uses, so 'not blocked'
       and 'something arrives' finally mean the same thing. The top of the
       curve is UNCHANGED (score 100 still pulls 1.0) — this opens the floor,
       it does not make a good city grow faster than it used to. */
    const pull = Math.max(0, (sc.score - 30) / 70);          // matches immigrationBlock's floor
    immigration = (TUNING.IMMIGRATION_RATE * per100 + TUNING.IMMIGRATION_FLOOR) * pull * dt;
    /* …and never more than there are beds for. */
    const room = Math.max(0, Number(ctx.housingFree) || 0);
    immigration = Math.min(immigration, room);
  }

  /* 6 · EMIGRATION. Only once strain has crossed the line, and then in
     proportion to how far past it the city is. */
  let emigration = 0;
  if (S.strain > TUNING.LEAVE_AT) {
    const bite = (S.strain - TUNING.LEAVE_AT) / (TUNING.STRAIN_MAX - TUNING.LEAVE_AT);
    emigration = TUNING.EMIGRATION_RATE * per100 * bite * dt;
  }

  /* 7 · whole people only. The fractions carry, so a slow city still grows —
     rounding each tick to zero is how a small town becomes immortal. */
  const B = takeWhole(S._carry, 'b', births);
  const D = takeWhole(S._carry, 'd', deaths);
  const I = takeWhole(S._carry, 'i', immigration);
  const E = takeWhole(S._carry, 'e', emigration);

  /* 8 · …and the population is the LEDGER, not a number we adjust.
     ⚠ THE FLOOR IS APPLIED BY REFUSING DEPARTURES, NOT BY TOPPING UP. Clamping
       `pop` up to POP_FLOOR would invent people the ledger cannot account for,
       which is the exact failure §23 forbids. If the town is down to its last
       four, nobody else leaves — and that IS the reason the number stopped. */
    const outflow = D + E;
  const room = Math.max(0, S.pop - TUNING.POP_FLOOR);
  const allowed = Math.min(outflow, room);
  const dKept = Math.min(D, allowed);
  const eKept = allowed - dKept;

  S.pop = S.pop + B + I - dKept - eKept;
  S.ledger.births += B; S.ledger.deaths += dKept;
  S.ledger.immigration += I; S.ledger.emigration += eKept;
  S.day.births += B; S.day.deaths += dKept;
  S.day.immigration += I; S.day.emigration += eKept;

  rep.births = B; rep.deaths = dKept; rep.immigration = I; rep.emigration = eKept;
  rep.net = B + I - dKept - eKept;

  /* 9 · who those people were. Arrivals come as households; departures and
     deaths come out of the stages they plausibly came from. */
  if (I > 0) {
    const got = fillHouseholds(I, ctx.rng);
    rep.arrivals = got.shapes;
    for (const k in got.stages) S.stages[k] = (S.stages[k] || 0) + got.stages[k];
    S.lastArrivals = got.shapes.concat(S.lastArrivals).slice(0, 8);
  }
  if (B > 0) S.stages.baby = (S.stages.baby || 0) + B;
  if (dKept > 0) removeFrom(S.stages, dKept, ['elder', 'adult', 'young', 'teen', 'child', 'baby']);
  if (eKept > 0) removeFrom(S.stages, eKept, ['young', 'adult', 'teen', 'child', 'baby', 'elder']);

  return rep;
}

/* ══════════════════════════════════════════════════════════════════════════
   AGEING — the Long-Term tick (§20). Called far less often than tick().
   Everyone shifts a slice of a stage forward; the last stage leaves by dying,
   and those deaths go through the LEDGER like every other one.
   ══════════════════════════════════════════════════════════════════════════ */
export function age(S, years) {
  const y = Math.max(0, Number(years) || 0);
  if (!S || y <= 0) return { moved: 0, deaths: 0 };
  let moved = 0, died = 0;
  /* Walk oldest-first so nobody skips a whole stage in one call. */
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const st = STAGES[i];
    const span = Math.max(1, st.to - st.from + 1);
    const here = S.stages[st.id] || 0;
    if (here <= 0) continue;
    const leaving = Math.min(here, here * (y / span));
    if (leaving <= 0) continue;
    S.stages[st.id] = here - leaving;
    if (i === STAGES.length - 1) {
      /* 🔴 THE OLDEST STAGE EMPTIES INTO THE LEDGER, NOT INTO NOTHING. People
         ageing out of `elder` are dying, and a population that shrank without a
         counted death would break the identity audit() enforces. */
      died += leaving;
    } else {
      S.stages[STAGES[i + 1].id] = (S.stages[STAGES[i + 1].id] || 0) + leaving;
      moved += leaving;
    }
  }
  if (died > 0) {
    /* 🔴 WHOLE PEOPLE ONLY, THROUGH THE SAME CARRY THE TICK USES. Ageing
       produces fractional deaths by its nature — a slice of a cohort crosses
       the line every call — and adding those straight to the ledger is what
       put a 1.46e-11 hole in the identity. The remainder waits here until it
       is a person. */
    S._carry.a = (S._carry.a || 0) + died;
    let whole = Math.floor(S._carry.a);
    const room = Math.max(0, S.pop - TUNING.POP_FLOOR);
    const take = Math.min(whole, room);
    if (take > 0) {
      S._carry.a -= take;
      S.pop -= take;
      S.ledger.deaths += take; S.day.deaths += take;
    }
    /* Whatever the floor refused is still alive and still elderly — it must
       not vanish from the stages while staying in the population. */
    const unspent = died - take;
    if (unspent > 0) S.stages.elder = (S.stages.elder || 0) + unspent;
    died = take;
  }
  return { moved: Math.round(moved), deaths: died };
}

/* ══════════════════════════════════════════════════════════════════════════
   🔴 THE AUDIT (§23). Re-derives the population from the four flows and returns
   the difference, which must be zero. This is the assertion the whole module is
   built to satisfy: "Do NOT fake population growth. Every increase or decrease
   should have an identifiable cause."
   ══════════════════════════════════════════════════════════════════════════ */
export function audit(S, startPop) {
  /* 🔴 EVERY FIGURE HERE IS AN INTEGER BY CONSTRUCTION, so `ok` is an exact
     equality and not a tolerance. A tolerance would hide precisely the class
     of bug this exists to catch: a flow that half-counts, or a population
     nudged somewhere outside the ledger. If this ever needs an epsilon,
     something upstream has started inventing people. */
  const L = S.ledger;
  const expect = Math.round(Number(startPop) || 0) + L.births + L.immigration - L.deaths - L.emigration;
  return {
    startPop: Math.round(Number(startPop) || 0),
    births: L.births, immigration: L.immigration, deaths: L.deaths, emigration: L.emigration,
    net: L.births + L.immigration - L.deaths - L.emigration,
    expected: expect, actual: S.pop, discrepancy: S.pop - expect, ok: S.pop === expect,
  };
}

/* ── the immigration gates, each with the sentence a player is owed ──────── */
function immigrationBlock(ctx, sc) {
  const room = Math.max(0, Number(ctx.housingFree) || 0);
  if (room < 1) return { id: 'housing', text: 'Housing Shortage — population growth limited' };
  const L = ctx.liveable || {};
  const M = TUNING.MIN_LIVEABLE;
  if (num(L.water) < M.water)  return { id: 'water',  text: 'No running water — nobody is moving in' };
  if (num(L.food) < M.food)    return { id: 'food',   text: 'The city cannot feed the people it has' };
  if (num(L.power) < M.power)  return { id: 'power',  text: 'The lights are out — immigration has stopped' };
  if (num(L.safety) < M.safety) return { id: 'safety', text: 'Too dangerous — nobody will settle here' };
  if (sc.score < 30) return { id: 'attraction', text: 'Nobody wants to move here right now' };
  return null;
}
function num(v) { return Number.isFinite(+v) ? +v : 1; }
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0)); }
function avgOf(a) {
  const v = a.filter((x) => Number.isFinite(+x)).map(Number);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0.5;
}
/* Carry the fractional remainder between ticks so slow growth is not rounded to
   nothing forever. */
function takeWhole(carry, key, amount) {
  carry[key] = (carry[key] || 0) + amount;
  const whole = Math.floor(carry[key]);
  if (whole > 0) carry[key] -= whole;
  return whole;
}
/* Arrivals as households, not as a number of anonymous adults. */
function fillHouseholds(n, rng) {
  const R = typeof rng === 'function' ? rng : Math.random;
  const stages = {}, shapes = [];
  let left = n, guard = 0;
  const total = HOUSEHOLDS.reduce((a, h) => a + h.w, 0);
  while (left > 0 && guard++ < 200) {
    let pick = null, roll = R() * total, acc = 0;
    for (const h of HOUSEHOLDS) { acc += h.w; if (roll <= acc) { pick = h; break; } }
    pick = pick || HOUSEHOLDS[0];
    /* The last few places are filled by whoever fits, rather than by refusing a
       household that is one person too big and looping forever. */
    const take = Math.min(pick.size, left);
    const scale = take / pick.size;
    for (const k in pick.mix) stages[k] = (stages[k] || 0) + pick.mix[k] * scale;
    shapes.push({ id: pick.id, name: pick.name, size: take });
    left -= take;
  }
  return { stages, shapes };
}
function removeFrom(stages, n, order) {
  let left = n;
  for (const k of order) {
    if (left <= 0) break;
    const have = stages[k] || 0;
    const take = Math.min(have, left);
    stages[k] = have - take;
    left -= take;
  }
}

/* ── history (§22) ───────────────────────────────────────────────────────── */
export const RANGES = [
  { id: '24h',  name: '24 Hours', minutes: 1440 },
  { id: '7d',   name: '7 Days',   minutes: 1440 * 7 },
  { id: '30d',  name: '30 Days',  minutes: 1440 * 30 },
  { id: '1y',   name: '1 Year',   minutes: 1440 * 365 },
  { id: 'all',  name: 'All Time', minutes: Infinity },
];
export function record(S, at, extra) {
  if (!S) return;
  const row = Object.assign({
    t: Math.round(Number(at) || 0),
    pop: S.pop,
    b: S.ledger.births, d: S.ledger.deaths, i: S.ledger.immigration, e: S.ledger.emigration,
  }, extra || {});
  S.history.push(row);
  /* 🔴 BOUNDED. A city left running for a week at one row a minute is 10,000
     rows in a save blob that is pushed to the server on every autosave. The
     oldest half is thinned rather than dropped, so All Time keeps its shape. */
  if (S.history.length > 2000) {
    const keep = [];
    for (let i = 0; i < S.history.length; i++) {
      if (i >= S.history.length - 1000 || i % 4 === 0) keep.push(S.history[i]);
    }
    S.history = keep;
  }
}
export function series(S, rangeId, now) {
  const r = RANGES.find((x) => x.id === rangeId) || RANGES[0];
  const cut = (Number(now) || 0) - r.minutes;
  return (S.history || []).filter((row) => r.minutes === Infinity || row.t >= cut);
}

/* ── save / load (§21) ───────────────────────────────────────────────────── */
export function save(S) {
  if (!S) return null;
  return { v: 1, pop: S.pop, stages: S.stages, strain: S.strain, shock: S.shock,
           ledger: S.ledger, day: S.day, history: S.history };
}
export function load(raw, fallbackPop) {
  const S = create(fallbackPop);
  if (!raw || typeof raw !== 'object') return S;
  if (Number.isFinite(+raw.pop)) S.pop = Math.max(TUNING.POP_FLOOR, Math.round(+raw.pop));
  if (raw.stages && typeof raw.stages === 'object') {
    for (const s of STAGES) if (Number.isFinite(+raw.stages[s.id])) S.stages[s.id] = Math.max(0, +raw.stages[s.id]);
  }
  if (Number.isFinite(+raw.strain)) S.strain = Math.max(0, Math.min(TUNING.STRAIN_MAX, +raw.strain));
  if (Number.isFinite(+raw.shock)) S.shock = Math.max(0, +raw.shock);
  for (const k of ['births', 'deaths', 'immigration', 'emigration']) {
    if (raw.ledger && Number.isFinite(+raw.ledger[k])) S.ledger[k] = Math.max(0, Math.round(+raw.ledger[k]));
    if (raw.day && Number.isFinite(+raw.day[k])) S.day[k] = Math.max(0, Math.round(+raw.day[k]));
  }
  if (Array.isArray(raw.history)) S.history = raw.history.filter((r) => r && Number.isFinite(+r.pop)).slice(-2000);
  return S;
}
export function closeDay(S) {
  if (!S) return;
  S.day = { births: 0, deaths: 0, immigration: 0, emigration: 0 };
}

/* A disaster landed. Called by the host when something actually happened. */
export function shock(S, severity) {
  if (!S) return 0;
  const sev = Math.max(0, Math.min(2, Number(severity) || 1));
  S.shock = Math.min(60, S.shock + TUNING.DISASTER_HIT * sev);
  /* …and it also costs patience, which is what makes a run of raids empty a
     town that survived any one of them. */
  S.strain = Math.min(TUNING.STRAIN_MAX, S.strain + 8 * sev);
  return S.shock;
}

export default { WEIGHTS, WEIGHT_TOTAL, BANDS, STAGES, WORKING_STAGES, HOUSEHOLDS, TUNING, RANGES,
                 score, bandFor, reasons, bottlenecks, create, tick, age, audit,
                 record, series, save, load, closeDay, shock };
