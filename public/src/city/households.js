/* ══════════════════════════════════════════════════════════════════════════
   🏠 HOUSEHOLDS — who those people actually are, and where they live.
   ══════════════════════════════════════════════════════════════════════════
   population.js counts the city: four flows, one ledger, an identity that has
   to balance. This is the layer above it — the same people, grouped into the
   units they actually arrive, live and leave in.

   THE ASK (§4, §9, §10, §11, §12, §15): households rather than loose NPCs, with
   an age, an education, a career, an income and a personality; a housing market
   with tiers and costs and a homeless count; NPCs who move between homes for
   reasons; NPCs who leave for accumulated reasons; and refugees at the gate.

   🔴 THE SECOND INVARIANT, AND IT IS AS LOAD-BEARING AS THE FIRST:

          Σ household sizes + homeless = population

      population.js already guarantees that the head-count is the sum of four
      counted flows. This guarantees that every one of those people is somewhere
      — in a household with an address, or explicitly homeless. A household
      layer that drifted from the ledger would be worse than no household layer,
      because the dashboard would show a demographic breakdown of a city that
      does not exist. `audit()` below returns the difference, and it must be 0.

   ⚠ AGGREGATE ABOVE A LIMIT, AND THAT IS DELIBERATE. The ask wants hundreds of
     thousands of NPCs and forbids per-NPC-per-frame work. So households are
     real objects up to MAX_TRACKED, and beyond that the remainder is carried as
     a statistical tail with the same average size — the identity still holds,
     because the tail is counted, it just has no names. A city of 300,000 does
     not need 90,000 objects to know that 12% of it is unhoused.

   ⚠ IT DECIDES NOTHING ABOUT THE CITY. Like population.js: inputs in, decisions
     out, no game state touched, no rendering, no save written. Testable in
     node, which for a simulation nobody can watch is the whole difference
     between "it works" and "it looks like it works".
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 🏢 HOUSING TIERS (§10) ────────────────────────────────────────────────
   `cap` is how many people the building holds; `rent` is the cost per person
   per day in Cinder; `needs` is the infrastructure multiple it demands — the
   ask asks that "higher-density housing should require stronger
   infrastructure", so a high-rise counts for more than its head-count when the
   city works out whether the water holds.
   ⚠ THE BUILDING IDS ARE node-city's, AND EVERY ONE OF THEM CARRIES A popCap.
     🔴 THEY DID NOT AT FIRST, AND IT WAS A REAL BUG IN THIS TABLE. Only two
        buildings in node-city's catalogue of 175 had a popCap — Housing and
        the Storm Shelter — so the middle rungs were mapped onto Retail Parade,
        Office Block and Stadium, none of which house anybody. The market was
        reporting a stadium as 180 beds and counting shoppers as residents.
        The fix was not to re-point this table at other borrowed buildings; it
        was to give the city the residential ladder it did not have. These four
        ids are now real buildings with real popCaps, real power draw and real
        sewage load, so `cap` here and popCap() over there are the same claim
        about the same thing.
     ⚠ `cap` MUST MATCH THE BUILDING'S popCap. They are the same number in two
       files and the driver asserts it, because a drift would mean the housing
       market and the city's own housing ceiling quietly disagreed about how
       many people fit — and the population sim reads one while the dashboard
       shows the other. */
export const TIERS = [
  { id: 'house',    name: 'House',             build: ['housing'],   cap: 6,   rent: 3,  needs: 1.0,  band: 'low' },
  { id: 'apartment',name: 'Apartment Building',build: ['apartment'], cap: 24,  rent: 5,  needs: 1.15, band: 'low' },
  { id: 'aptblock', name: 'Apartment Block',   build: ['aptblock'],  cap: 70,  rent: 8,  needs: 1.3,  band: 'mid' },
  { id: 'apttower', name: 'Apartment Tower',   build: ['apttower'],  cap: 180, rent: 12, needs: 1.5,  band: 'mid' },
  { id: 'highrise', name: 'High-Rise',         build: ['highrise'],  cap: 320, rent: 18, needs: 1.8,  band: 'high' },
];
export const TIER_BY_ID = {};
for (const t of TIERS) TIER_BY_ID[t.id] = t;

/* ── 💼 CAREERS, and the schooling each one needs ─────────────────────────
   Deliberately the same four education bands the city's own Job Fair uses, so a
   household's education means the same thing here as it does when they apply
   for work. */
export const CAREERS = [
  { id: 'labour',   name: 'Labourer',      needs: 'unskilled', pay: 1.0 },
  { id: 'service',  name: 'Service work',  needs: 'unskilled', pay: 1.1 },
  { id: 'trade',    name: 'Skilled trade', needs: 'skilled',   pay: 1.6 },
  { id: 'clerk',    name: 'Clerical',      needs: 'skilled',   pay: 1.5 },
  { id: 'tech',     name: 'Technician',    needs: 'technical', pay: 2.2 },
  { id: 'medic',    name: 'Medical',       needs: 'technical', pay: 2.6 },
  { id: 'engineer', name: 'Engineer',      needs: 'advanced',  pay: 3.2 },
  { id: 'scholar',  name: 'Researcher',    needs: 'advanced',  pay: 3.0 },
];
export const EDU_ORDER = ['unskilled', 'skilled', 'technical', 'advanced'];

/* ── 🙂 PERSONALITY — small, and it changes behaviour rather than decorating.
   Each trait moves ONE decision, named in `does`. A trait that only appears in
   a tooltip is a costume; these are why two identical households behave
   differently when the rent goes up. */
export const TRAITS = [
  { id: 'rooted',   name: 'Rooted',      w: 20, does: 'slow to leave, slow to move house',  leave: 0.55, move: 0.6 },
  { id: 'restless', name: 'Restless',    w: 16, does: 'quick to try somewhere better',      leave: 1.4,  move: 1.6 },
  { id: 'thrifty',  name: 'Thrifty',     w: 18, does: 'will downsize before they will go',  leave: 0.8,  move: 1.3, cheap: true },
  { id: 'proud',    name: 'House-proud', w: 14, does: 'wants the best they can afford',     leave: 1.0,  move: 1.2, rich: true },
  { id: 'stoic',    name: 'Stoic',       w: 18, does: 'tolerates a bad patch',              leave: 0.6,  move: 0.9 },
  { id: 'anxious',  name: 'Anxious',     w: 14, does: 'first to go when it gets dangerous', leave: 1.5,  move: 1.1, safety: 1.6 },
];

export const HTUNING = {
  /* Real objects up to here; beyond it the remainder is a counted tail. */
  MAX_TRACKED: 600,
  /* Rent moves with scarcity — the ask asks for exactly this in both
     directions: "Housing shortages should increase housing costs. Large housing
     surpluses should reduce pressure on housing costs." */
  RENT_MIN: 0.55, RENT_MAX: 2.6, RENT_LERP: 0.06,
  /* A household will not take a home it cannot pay for. This is the gate that
     stops "poor NPCs automatically occupying expensive housing". */
  AFFORD_RATIO: 0.42,       // rent may take at most this share of income
  /* Moving house is a real decision with a real threshold, or everybody churns
     every tick and the city is a game of musical chairs. */
  MOVE_GAIN: 0.18,          // the new place must be this much better
  MOVE_CHANCE: 0.05,        // …and even then, only sometimes
  HOMELESS_STRAIN: 2.4,     // being unhoused wears patience down fast
};

/* ══════════════════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════════════════ */
export function create() {
  return {
    list: [],                 // tracked households
    tail: { people: 0, housed: 0 },   // the statistical remainder
    /* 🔴 HOMELESSNESS IS DERIVED, NOT STORED — see homeless(). Keeping it as
       its own counter double-counted every unhoused person: they were in
       S.homeless AND in their household's `size`, so the invariant broke by
       exactly the homeless count. Measured at 2, 92 and 3 across three
       housing markets, which is the tell — a discrepancy that tracks one
       quantity IS that quantity, counted twice. A number that can be computed
       from the objects should never also be maintained beside them. */
    rentMul: 1,               // market pressure on rent, RENT_MIN..RENT_MAX
    seq: 0,
    moves: 0, evictions: 0,   // lifetime, for the dashboard
    refugees: null,           // a pending offer, if any
    lastReasons: {},          // why households left, counted
  };
}

/* Everyone with no address: unhoused households, plus whatever part of the
   statistical tail has nowhere to go. */
export function homeless(S) {
  let n = 0;
  for (const h of S.list) if (!h.home) n += h.size;
  return n + Math.max(0, S.tail.people - S.tail.housed);
}

let _rng = Math.random;
export function seed(fn) { _rng = typeof fn === 'function' ? fn : Math.random; }
function pick(arr) { return arr[Math.floor(_rng() * arr.length) % arr.length]; }
function weighted(arr) {
  const total = arr.reduce((a, x) => a + (x.w || 1), 0);
  let roll = _rng() * total;
  for (const x of arr) { roll -= (x.w || 1); if (roll <= 0) return x; }
  return arr[arr.length - 1];
}

/* ══════════════════════════════════════════════════════════════════════════
   MAKING A HOUSEHOLD (§4)
   `shape` comes from population.js's HOUSEHOLDS table, so the two agree about
   what kinds of household exist and how big they are.
   ══════════════════════════════════════════════════════════════════════════ */
export function make(S, shape, opts) {
  const o = opts || {};
  /* Education is drawn against the city's own schooling, not from nowhere — a
     town with no colleges attracts and produces fewer graduates, which is what
     makes building them matter. */
  const lean = Math.max(0, Math.min(1, o.eduLevel == null ? 0.35 : o.eduLevel));
  const roll = _rng();
  let edu = 'unskilled';
  if (roll < lean * 0.22) edu = 'advanced';
  else if (roll < lean * 0.55) edu = 'technical';
  else if (roll < 0.3 + lean * 0.4) edu = 'skilled';
  const career = pick(CAREERS.filter((c) => EDU_ORDER.indexOf(c.needs) <= EDU_ORDER.indexOf(edu))) || CAREERS[0];
  const trait = weighted(TRAITS);
  const size = Math.max(1, Math.round(o.size || (shape && shape.size) || 1));
  /* Earners are the working-age members; a household of children and elders has
     none, which is exactly why an ageing city gets poorer. */
  const earners = Math.max(0, Math.round(o.earners == null ? Math.max(1, Math.round(size * 0.55)) : o.earners));
  const income = earners * career.pay * (0.8 + _rng() * 0.5) * 10;
  return {
    id: 'hh' + (++S.seq),
    shape: (shape && shape.id) || 'single',
    label: (shape && shape.name) || 'a household',
    size, earners, edu, career: career.id, careerName: career.name,
    trait: trait.id, traitName: trait.name,
    income: Math.round(income),
    home: null,               // tier id, or null when unhoused
    rent: 0,
    strain: 0,                // this household's own patience
    age: 0,                   // minutes resident
    seeking: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE HOUSING MARKET (§9)
   stock: { tierId: unitsOfThatTier }  — from the city's actual buildings
   ══════════════════════════════════════════════════════════════════════════ */
export function market(S, stock, pop) {
  const st = stock || {};
  let capacity = 0, weightedNeed = 0;
  const byTier = {};
  for (const t of TIERS) {
    const units = Math.max(0, Math.round(Number(st[t.id]) || 0));
    const cap = units * t.cap;
    byTier[t.id] = { units, cap, used: 0, rent: Math.round(t.rent * S.rentMul * 10) / 10 };
    capacity += cap;
    weightedNeed += cap * t.needs;
  }
  /* Who is where. Tracked households first, then the tail. */
  for (const h of S.list) if (h.home && byTier[h.home]) byTier[h.home].used += h.size;
  if (S.tail.housed > 0) {
    /* The tail is spread across whatever has room, cheapest first — it is the
       part of the city nobody is looking at closely. */
    let left = S.tail.housed;
    for (const t of TIERS) {
      const b = byTier[t.id]; if (!b) continue;
      const room = Math.max(0, b.cap - b.used);
      const take = Math.min(room, left);
      b.used += take; left -= take;
      if (left <= 0) break;
    }
  }
  const occupied = Object.values(byTier).reduce((a, b) => a + b.used, 0);
  const vacant = Math.max(0, capacity - occupied);
  const P = Math.max(0, Math.round(Number(pop) || 0));
  /* 🔴 RENT FOLLOWS SCARCITY, IN BOTH DIRECTIONS. Occupancy over 90% pushes it
     up, under 60% pulls it down, and it LERPS rather than jumping — a market
     that repriced instantly every tick would make the affordability term in the
     attraction score flap, and a player would see their city's desirability
     oscillate for no reason they did anything about. */
  const occ = capacity > 0 ? occupied / capacity : 1;
  const target = occ > 0.9 ? HTUNING.RENT_MAX
    : occ < 0.6 ? HTUNING.RENT_MIN
    : 1 + (occ - 0.6) * 1.6;
  S.rentMul += (target - S.rentMul) * HTUNING.RENT_LERP;
  S.rentMul = Math.max(HTUNING.RENT_MIN, Math.min(HTUNING.RENT_MAX, S.rentMul));

  const avgRent = capacity > 0
    ? TIERS.reduce((a, t) => a + byTier[t.id].cap * t.rent * S.rentMul, 0) / capacity
    : 0;
  return {
    byTier, capacity, occupied, vacant,
    homeless: homeless(S),
    occupancy: Math.round(occ * 1000) / 1000,
    rentMul: Math.round(S.rentMul * 100) / 100,
    avgRent: Math.round(avgRent * 10) / 10,
    /* 🏗 …and what that density asks of the infrastructure (§10). */
    infraLoad: Math.round(weightedNeed),
    demand: Math.max(0, P - capacity),
  };
}

/* Can this household pay for that tier, and would they want it? */
function affordable(h, tier, rentMul) {
  const rent = tier.rent * rentMul * h.size;
  return rent <= h.income * HTUNING.AFFORD_RATIO;
}
function desirability(h, tier, rentMul) {
  /* 🔴 CAPACITY IS A REQUIREMENT, NOT A PREFERENCE, and getting that backwards
     was a real design bug measured on a 2,600-minute run: `fit` was
     min(1, cap / size*2), which rewards the BIGGEST building — so a couple
     with two children preferred a 320-person high-rise to a house, and 86 of
     98 households piled into apartment blocks while 22 houses stood empty.
     Nobody chooses a home by how many strangers it holds.
     What a household actually weighs: can it hold us at all (a gate), how
     nice is it (tier), and what does it cost. The traits then pull those apart
     — House-proud reaches for the best they can afford, Thrifty for the
     cheapest that will do — which is what stops every household in the city
     wanting the same building. */
  if (tier.cap < h.size) return -1;
  const rent = tier.rent * rentMul * h.size;
  const quality = TIERS.indexOf(tier) / Math.max(1, TIERS.length - 1);
  const cost = 1 - Math.min(1, rent / Math.max(1, h.income * HTUNING.AFFORD_RATIO));
  /* 🏠 …and a small household in a huge block is a slight negative, because a
     family of three does not want to be one of three hundred. */
  const scale = 1 - Math.min(0.35, Math.max(0, (tier.cap / Math.max(1, h.size)) - 12) / 200);
  const T = TRAITS.find((t) => t.id === h.trait) || {};
  const w = T.cheap ? [0.15, 0.85] : T.rich ? [0.70, 0.30] : [0.42, 0.58];
  return (quality * w[0] + cost * w[1]) * scale;
}

/* ══════════════════════════════════════════════════════════════════════════
   PLACING PEOPLE — the arrival path (§3, §4)
   Returns { placed, homeless } for the people offered.
   ══════════════════════════════════════════════════════════════════════════ */
export function house(S, mk, opts) {
  const M = market(S, (opts && opts.stock) || {}, (opts && opts.pop) || 0);
  const wanted = [];
  for (const t of TIERS) {
    const b = M.byTier[t.id];
    if (b.cap - b.used > 0) wanted.push(t);
  }
  if (!wanted.length) return { placed: false, why: 'no vacancies' };
  /* 🔴 POOR HOUSEHOLDS DO NOT LAND IN EXPENSIVE BUILDINGS. The ask says so in
     as many words. Affordability is a filter, not a preference — a household
     that cannot pay simply does not appear on that tier's list. */
  const can = wanted.filter((t) => affordable(mk, t, S.rentMul) && (M.byTier[t.id].cap - M.byTier[t.id].used) >= mk.size);
  if (!can.length) return { placed: false, why: 'nothing they can afford' };
  can.sort((a, bb) => desirability(mk, bb, S.rentMul) - desirability(mk, a, S.rentMul));
  mk.home = can[0].id;
  mk.rent = Math.round(can[0].rent * S.rentMul * mk.size * 10) / 10;
  return { placed: true, tier: can[0].id };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE TICK — moving, evictions, and the reasons people go (§11, §12)
   ctx: { stock, pop, dtMin, terms, threat }
   ══════════════════════════════════════════════════════════════════════════ */
export function tick(S, ctx) {
    const out = { moved: 0, evicted: 0, homeless: 0, reasons: {} };
  if (!S || !ctx) return out;
  const dt = Math.max(0, Number(ctx.dtMin) || 0);
  if (dt <= 0) return out;
  const M = market(S, ctx.stock || {}, ctx.pop || 0);
  const terms = ctx.terms || {};

  for (const h of S.list) {
    h.age += dt;
    /* 🏚 EVICTION when the rent outruns the income — the market moving against
       a household that did nothing wrong, which is the point of a market. */
    if (h.home) {
      const t = TIER_BY_ID[h.home];
      const rent = t.rent * S.rentMul * h.size;
      h.rent = Math.round(rent * 10) / 10;
      if (rent > h.income * (HTUNING.AFFORD_RATIO * 1.6)) {
        /* They try to downsize first. Only if nothing cheaper has room do they
           lose the roof — a city with spare small housing catches its poor. */
        const cheaper = TIERS.filter((x) => x.rent < t.rent
          && affordable(h, x, S.rentMul)
          && (M.byTier[x.id].cap - M.byTier[x.id].used) >= h.size);
        if (cheaper.length) {
          h.home = cheaper[cheaper.length - 1].id;
          S.moves++; out.moved++;
          h.lastMove = 'priced out of their old home';
        } else {
          /* No counter to bump — losing the address IS becoming homeless. */
          h.home = null; S.evictions++; out.evicted++;
          out.reasons.rent = (out.reasons.rent || 0) + 1;
        }
        continue;
      }
    }
    /* 🔎 UNHOUSED HOUSEHOLDS KEEP LOOKING, and wear down while they do. */
    if (!h.home) {
      const r = house(S, h, { stock: ctx.stock, pop: ctx.pop });
      if (r.placed) h.lastMove = 'found a place at last';
      else h.strain += HTUNING.HOMELESS_STRAIN * dt;
      continue;
    }
    /* 🚚 MOVING UP (§11). Only when something is meaningfully better, only
       sometimes, and traits decide how restless a household is. A city where
       everybody re-optimises every tick is a city of removal vans. */
    if (_rng() < HTUNING.MOVE_CHANCE * dt) {
      const T = TRAITS.find((x) => x.id === h.trait) || {};
      const here = desirability(h, TIER_BY_ID[h.home], S.rentMul);
      const better = TIERS.filter((x) => x.id !== h.home
        && affordable(h, x, S.rentMul)
        && (M.byTier[x.id].cap - M.byTier[x.id].used) >= h.size
        && desirability(h, x, S.rentMul) > here + HTUNING.MOVE_GAIN / (T.move || 1));
      if (better.length) {
        better.sort((a, bb) => desirability(h, bb, S.rentMul) - desirability(h, a, S.rentMul));
        h.home = better[0].id;
        h.lastMove = 'moved somewhere better';
        S.moves++; out.moved++;
      }
    }
    /* 😖 …and the reasons a household loses patience (§12). Accumulated, never
       instant, and weighted by the trait — an Anxious family leaves a dangerous
       city long before a Stoic one does. */
    const T = TRAITS.find((x) => x.id === h.trait) || {};
    let bite = 0;
    const worry = (v, w) => { if (Number.isFinite(+v) && +v < 0.5) bite += (0.5 - +v) * w; };
    worry(terms.safety, 2.2 * (T.safety || 1));
    worry(terms.jobs, 1.6);
    worry(terms.food, 1.8);
    worry(terms.water, 1.8);
    worry(terms.power, 1.2);
    worry(terms.healthcare, 1.2);
    worry(terms.affordability, 1.4);
    if (ctx.threat > 0.5) bite += (ctx.threat - 0.5) * 2.4 * (T.safety || 1);
    h.strain = Math.max(0, h.strain + (bite - 0.45) * (T.leave || 1) * dt);
  }
  out.homeless = homeless(S);
  return out;
}

/* Which households are ready to go, and why — the emigration candidates. */
export function leaving(S, n) {
  const ready = S.list.filter((h) => h.strain > 40)
    .sort((a, b) => b.strain - a.strain);
  return ready.slice(0, Math.max(0, n | 0));
}

/* ══════════════════════════════════════════════════════════════════════════
   🚸 REFUGEES (§15)
   ══════════════════════════════════════════════════════════════════════════ */
export function offerRefugees(S, count, opts) {
  const n = Math.max(1, Math.round(Number(count) || 0));
  S.refugees = {
    id: 'ref' + (++S.seq),
    people: n,
    at: (opts && opts.at) || 0,
    /* What they will cost, said before the Governor decides rather than after —
       "this creates strategic decisions" only if the decision is informed. */
    needs: { housing: n, food: n, healthcare: n, jobs: Math.round(n * 0.55), education: Math.round(n * 0.22) },
    text: n + ' survivors have arrived outside the city gates requesting shelter.',
  };
  return S.refugees;
}
/* Returns how many the Governor actually took. `how` is 'all' | 'some' | 'none'.
   ⚠ IT RETURNS A NUMBER FOR THE LEDGER TO COUNT, and does not move the
     population itself — refugees are immigration, and immigration is one of the
     four flows population.js owns. A second path that added people directly
     would put a hole in the identity on the first refugee event. */
export function decideRefugees(S, how, some) {
  const R = S.refugees;
  if (!R) return { taken: 0, of: 0 };
  const of = R.people;
  let taken = 0;
  if (how === 'all') taken = of;
  else if (how === 'some') taken = Math.max(0, Math.min(of, Math.round(Number(some) || Math.floor(of / 3))));
  S.refugees = null;
  return { taken, of, turned: of - taken };
}

/* ══════════════════════════════════════════════════════════════════════════
   🔴 THE SECOND INVARIANT
   ══════════════════════════════════════════════════════════════════════════ */
export function audit(S, pop) {
  /* 🔴 EVERY PERSON IS COUNTED ONCE. A tracked household's members are in
     `tracked` whether or not they have an address — homelessness is a property
     of the household, not a separate pile of people — and the tail is counted
     once. Adding a homeless figure here is exactly the double-count that broke
     this the first time. */
  const tracked = S.list.reduce((a, h) => a + h.size, 0);
  const total = tracked + S.tail.people;
  const P = Math.round(Number(pop) || 0);
  return {
    tracked, tail: S.tail.people, homeless: homeless(S),
    accounted: total, population: P,
    discrepancy: total - P, ok: total === P,
    households: S.list.length,
  };
}

/* Keep the household layer in step with a population that moved underneath it.
   🔴 THIS IS THE ONLY PLACE THE TWO LAYERS ARE RECONCILED, and it is called
      with the ledger's own numbers rather than with a target — so the household
      layer can never disagree with the head-count without audit() saying so. */
export function sync(S, opts) {
  const o = opts || {};
  const arrivals = Math.max(0, Math.round(o.arrived || 0));
  const departures = Math.max(0, Math.round(o.left || 0));
  const stock = o.stock || {};
  const res = { made: 0, removed: 0, housed: 0, unhoused: 0 };

  /* People who left take whole households with them where they can, and are
     taken out of the tail otherwise. */
  let toRemove = departures;
  while (toRemove > 0 && S.list.length) {
    const cand = leaving(S, 1)[0] || S.list[S.list.length - 1];
    if (cand.size <= toRemove) {
      const i = S.list.indexOf(cand);
      if (i >= 0) S.list.splice(i, 1);
      toRemove -= cand.size; res.removed++;
    } else break;
  }
  if (toRemove > 0) {
    const fromTail = Math.min(S.tail.people, toRemove);
    S.tail.people -= fromTail;
    S.tail.housed = Math.max(0, Math.min(S.tail.housed, S.tail.people));
    toRemove -= fromTail;
  }
  if (toRemove > 0) {
    /* Last resort: shrink a household rather than lose the identity. */
    for (const h of S.list) {
      if (toRemove <= 0) break;
      const take = Math.min(h.size - 1, toRemove);
      if (take > 0) { h.size -= take; toRemove -= take; }
    }
    /* Anything still owed comes out of the tail's housed share, so the two
       tail numbers stay consistent with each other. */
    if (toRemove > 0) { S.tail.people = Math.max(0, S.tail.people - toRemove); S.tail.housed = Math.min(S.tail.housed, S.tail.people); }
  }

  /* Arrivals become households while there is room to track them, and join the
     tail after that. */
  let toAdd = arrivals;
  while (toAdd > 0 && S.list.length < HTUNING.MAX_TRACKED) {
    const shape = o.shape || { id: 'single', name: 'a single adult', size: 1 };
    const size = Math.min(toAdd, Math.max(1, shape.size || 1));
    const h = make(S, shape, { size, eduLevel: o.eduLevel });
    const r = house(S, h, { stock, pop: o.pop });
    if (!r.placed) { h.home = null; res.unhoused += h.size; }
    else res.housed += h.size;
    S.list.push(h); res.made++;
    toAdd -= size;
  }
  if (toAdd > 0) { S.tail.people += toAdd; S.tail.housed += toAdd; }
  return res;
}

export function save(S) {
  if (!S) return null;
  /* ⚠ homeless is NOT saved — it is derived from the households, and a saved
     copy is one more thing that can disagree with them. */
  return { v: 1, seq: S.seq, rentMul: S.rentMul,
           tail: S.tail, moves: S.moves, evictions: S.evictions,
           /* Only the tracked households ride the save; the tail is two numbers. */
           list: S.list.map((h) => ({ i: h.id, s: h.shape, z: h.size, e: h.earners,
             d: h.edu, c: h.career, t: h.trait, m: h.income, h: h.home, r: h.strain })) };
}
export function load(raw) {
  const S = create();
  if (!raw || typeof raw !== 'object') return S;
  S.seq = Math.max(0, Math.round(+raw.seq || 0));
  S.rentMul = Math.max(HTUNING.RENT_MIN, Math.min(HTUNING.RENT_MAX, +raw.rentMul || 1));
  if (raw.tail && Number.isFinite(+raw.tail.people)) {
    S.tail.people = Math.max(0, Math.round(+raw.tail.people));
    S.tail.housed = Math.max(0, Math.round(+raw.tail.housed || 0));
  }
  S.moves = Math.max(0, Math.round(+raw.moves || 0));
  S.evictions = Math.max(0, Math.round(+raw.evictions || 0));
  if (Array.isArray(raw.list)) {
    for (const r of raw.list) {
      if (!r || !Number.isFinite(+r.z)) continue;
      const career = CAREERS.find((c) => c.id === r.c) || CAREERS[0];
      S.list.push({
        id: String(r.i || ('hh' + (++S.seq))), shape: String(r.s || 'single'),
        label: 'a household', size: Math.max(1, Math.round(+r.z)),
        earners: Math.max(0, Math.round(+r.e || 0)),
        edu: EDU_ORDER.indexOf(r.d) >= 0 ? r.d : 'unskilled',
        career: career.id, careerName: career.name,
        trait: (TRAITS.find((t) => t.id === r.t) || TRAITS[0]).id,
        traitName: (TRAITS.find((t) => t.id === r.t) || TRAITS[0]).name,
        income: Math.max(0, Math.round(+r.m || 0)),
        home: TIER_BY_ID[r.h] ? r.h : null, rent: 0,
        strain: Math.max(0, +r.r || 0), age: 0, seeking: false,
      });
    }
  }
  return S;
}

export default { TIERS, TIER_BY_ID, CAREERS, EDU_ORDER, TRAITS, HTUNING,
                 create, seed, make, market, house, tick, leaving,
                 offerRefugees, decideRefugees, audit, sync, save, load };
