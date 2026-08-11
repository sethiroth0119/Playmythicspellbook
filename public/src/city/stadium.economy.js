/* ══════════════════════════════════════════════════════════════════════════
   🏟 THE STADIUM ECONOMY  (CLAUDE_TASK_stadium_economy.md — Phase E)
   ──────────────────────────────────────────────────────────────────────────
   "An event is a demand shock you schedule yourself."

   PURE. No DOM, no globals, no imports, no persistence, no clock of its own.
   Everything this file needs is passed in: the stadium, the event, a `node`
   snapshot (population, stock, coverage, morale, hope, buildings, roads) and
   a `world` snapshot (neighbour cities, trade routes, region). It returns
   plain data. The host wires it up — see /src/city/stadium.city.js.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Cloud`, `App`, `Corp`, `Forge`,
   and node-city's `game` / `vitals` / `BUILDINGS`, are top-level `const` in the
   legacy pages. They are lexical bindings, NOT window properties, so an ES
   module cannot see them and must never pretend it can. Nothing below reads a
   global. If you need something new from the host, add it to the ctx the host
   hands over — do not reach.

   🔴 ONE TUNING TABLE. Every economy number in the stadium lives in
   STADIUM_ECON below, the same way all operation pricing goes through
   `_opEcon()` (CLAUDE.md: "Never hardcode economy numbers"). Render code reads
   this table; it never carries a number of its own. If you find a bare
   constant anywhere outside STADIUM_ECON in this file or in stadium.city.js,
   that is a bug.

   ⚖ SCALE — HOW THE DESIGN PACK'S NUMBERS REACH THIS CITY.
   The pack is written against a corporate economy (a Stadium costs 2,400,000 🔥,
   an event grosses ~1,100,000 🔥, a Cannery makes 200 rations per cycle).
   node-city already established the two conversions and this file reuses both
   rather than inventing a third:
     • `cinderDivisor` 2000 — node-city/index.html:1909 ("💱 THE COST DIVISOR IS
       2,000"), the same divisor that turned a 400,000 🔥 power station into 200.
       Ticket and concession prices below are the pack's RAW figures; the divisor
       is applied ONCE, at the payout boundary (`toCinder`). Keeping the raw
       numbers in the table is what lets anyone check them against the doc.
     • `cycleMinutes` 75 — node-city/index.html:1978-1990 scaled the pack's
       per-cycle production figures to per-minute by ÷75 (a Restaurant's 60
       rations/cycle became 0.80/min, a Grocery's 180 became 2.40, a Cannery's
       200 became 2.60). So one "cycle" is 75 real minutes here, and one
       Cannery cycle is 2.60 × 75 = 195 rations. That is the number concession
       demand has to beat.

   👥 `nodePopulation` — WHICH POPULATION, AND WHY THERE ARE TWO.
   The pack's attendance formulas read `nodePopulation` as a real city's
   population. That number EXISTS in this game and it is not a headcount:
   `_twNodeReconDefaults()` (index.html) gives every world node
   `population: 200000` alongside `roadsTotal: 60` / `roadsRepaired` — the same
   two road counters §1 of the spec asks for. That is the authoritative figure,
   and when the host can reach it, `node.residents` carries it here and the
   catchment is never used.

   ⚠ THE FALLBACK, NAMED SO IT CAN BE ARGUED WITH: `catchment`.
   node-city runs inside an iframe and its own `game.pop.npc` is a headcount in
   the TENS (POP_MIN is 4; a developed city runs 30-80). Feeding 40 into
   `pop × 0.06` gives a local draw of 2.4 people and the whole mechanic reads as
   broken. `catchment` converts the tracked citizenry into residents, and it is
   CALIBRATED, not guessed: 6,000 × 33 tracked citizens ≈ 198,000, i.e. the
   world node's own 200,000. It is here in the table where a retune can reach
   it rather than buried in a formula, and `node.residents` overrides it
   entirely whenever the real figure is available.

   🍹 THE FOURTH CONCESSION LINE. The pack's four are rations, water, goods and
   `energyDrink`. There is no energy drink in this game and inventing a resource
   to satisfy a doc is exactly the "no invented data" failure (_BAR9.md). The
   fourth line is `remedies` — the city's real prepared-medicine stock, the one
   Health coverage already reads (node-city CITY_STOCK). It carries the pack's
   0.015/attendee rate and it is the crowd-medical line the satisfaction table's
   "Injuries, heat, crowd medical" factor is talking about.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 🎛 THE TUNING TABLE. All of it. ────────────────────────────────────── */
export const STADIUM_ECON = {
  /* Scale bridges — see the header. */
  cinderDivisor: 2000,
  cycleMinutes: 75,
  catchment: 6000,
  /* node-city's own `RATE_MULT` (index.html:1848) — a building's output scales
     ×2 per level. It lives here because stadium.city.js derives a shop's
     per-cycle takings from it, and a bare `|| 2` in the host adapter was one of
     the twelve constants that escaped this table in r9. */
  rateMultPerLevel: 2,

  /* 🏟 The building. `seats` is per LEVEL — capacity is the only thing a
     stadium level buys, plus the prestige floor that comes with a bigger room.
     The pack's 8,000-seat stadium is level 3.
     `costDoc` is the pack's own price so the city's divided-down cost can be
     checked against it: 1.2M / 2.4M / 4.8M ÷ 2000 = 600 / 1200 / 2400 🔥.
     2,400 🔥 makes it far and away the most expensive thing in the city
     (the Power Station, previously the ceiling, is 200) — which is what the
     price band in node-city's own comment says a Stadium should be. */
  seats: [900, 2600, 8000],
  costDoc: [1200000, 2400000, 4800000],
  /* 🅿 FOOTPRINT. node-city tiles are one building each; there is no multi-tile
     placement anywhere in the game and adding one for a single building would
     be a rewrite of tryPlace with nothing else to justify it. A stadium's
     footprint is expressed instead as the CONCOURSE it demands: every tile in
     this Chebyshev radius must be free ground or road at placement time. Same
     observable consequence — a stadium cannot be crammed into a dense block —
     without a second placement model. */
  concourseRadius: 1,
  maxPerCity: 1,

  /* ── §1 ATTENDANCE ─────────────────────────────────────────────────── */
  draw: {
    localPerResident: 0.06,
    visitorPerResident: 0.004,
    regionalPerResident: 0.002,
    interestBase: 0.5,          // interest = base + morale/moraleDiv + hope/hopeDiv
    moraleDiv: 200,
    hopeDiv: 200,
    interestMin: 0.5,
    interestMax: 1.5,
    routeLinked: 1.0,           // ⭐ the tourism hook: a trade route DOUBLES…
    routeUnlinked: 0.35,        // …(near enough) the tourist flow between two cities
    tradeStabilityDiv: 100,
    /* Regional draw is NOT invented population. It is the Node Anchors this
       city actually holds in the world — each anchor is a Production Reserve
       Node with a level and a link %, and the region it sits in is where the
       NPC crowd comes from. residentsPerAnchorLevel × level × link/100.
       80,000 is the same order as the world node's own 200,000 population:
       a reserve node's hinterland, not a city. */
    residentsPerAnchorLevel: 80000,
  },
  transit: {
    base: 400,
    perMotorPoolLevel: 120,     // ⭐ Motor Pools finally matter
    perRailYardLevel: 2500,
    roadsFull: 1800,            // ×(roadsRepaired / roadsTotal)
  },

  /* ── §2 TICKETS ────────────────────────────────────────────────────── */
  tiers: {
    standing: { share: 0.60, basePrice: 60,  satisfactionWeight: 0.7, spendWeight: 0.85 },
    seated:   { share: 0.32, basePrice: 180, satisfactionWeight: 1.0, spendWeight: 1.00 },
    box:      { share: 0.08, basePrice: 650, satisfactionWeight: 1.6, spendWeight: 1.90 },
  },
  ticket: {
    minRatio: 0.25, maxRatio: 4,
    /* demand = clamp(0, demandMax, a - b × effectiveRatio^exp)
       effectiveRatio = priceRatio / (flattenBase + prestige × flattenPer)
       ⚠ Note where the neutral point sits: at prestige 1.0 the denominator is
         exactly 1, so a stadium at the STARTING prestige of 0.6 sells at 0.83×
         demand even at list price. Prestige is not a bonus bolted on top —
         it is the thing that makes list price actually work. */
    a: 1.9, b: 0.9, exp: 1.35, demandMax: 1.6,
    flattenBase: 0.7, flattenPer: 0.3,
  },

  /* ── §3 CONCESSIONS ────────────────────────────────────────────────── */
  concession: {
    /* Per attendee, per cycle. At 8,000 that is 640 rations against ONE
       Cannery cycle of 195. You cannot supply an event from live production;
       you stockpile or you fail. That is the whole mechanic. */
    perAttendee: { rations: 0.08, water: 0.05, goods: 0.03, remedies: 0.015 },
    spendPerAttendee: 34,       // raw doc 🔥, before cinderDivisor
    defaultMarkupPct: 240,
    markupMin: 100, markupMax: 400,
  },

  /* ── §4 SATISFACTION ───────────────────────────────────────────────── */
  satisfaction: {
    weights: { concessions: 35, security: 20, power: 15, health: 10, transit: 10, match: 10 },
    /* A blackout is not a low score, it is a catastrophe: −40 outright, on top
       of whatever the weighted power factor already took. */
    blackoutBelow: 0.60,        // power ratio under this = the lights went out
    blackoutPenalty: 40,
    /* 🔴 THE FULFILMENT GATE — added r10, and it is the reason the prep phase
       exists at all.
       ⚠ THE BUG IT FIXES, measured: concessions carry 35 of 100, so a TOTAL
         failure to feed the crowd in an otherwise well-built city floored
         satisfaction at 65 → morale +7.5, revenueMult 1.005, no refund, no
         incident. Serving the crowd literally nothing paid ABOVE list revenue,
         so stockpiling was a net loss and nobody would ever have done it.
         Spec §4 is explicit: "A bad event must be worse than no event."
       The shape is the blackout rule eight lines above: below the floor it is
       not a low score, it is a disaster, applied after the weighted sum and
       shown as its own row.
       🔢 WHERE 45 COMES FROM — it is derived, not picked. A PERFECT city
         (security 100, health 100, grid 100%, transit clear, ⚡11 headliner)
         scores 65 on the other five factors alone. For a total concession
         failure to reach the criteria the spec names — refunds (`refundBelow`
         35) AND incidents (`incidentBelow` 25) AND a negative morale delta
         (zero crossing at 40) — the penalty must exceed 65 − 25 = 40. 45 is
         that bound with a 5-point margin, which puts the theoretical BEST case
         of an unprepared event at 20: −6.0 morale, 19% refunded, incidents. */
    fulfilmentFloorBelow: 0.35,
    fulfilmentPenalty: 45,
    transitCrushAt: 0.90,       // attendance/transit above this → crush and delays
    /* Match quality: the headliner. A stadium with a card socketed runs a
       better card than one running an exhibition. Card power is real data
       (cardById(t.card).power); with no card slotted the event scores the
       baseline, which is deliberately mediocre. */
    matchBaseline: 0.45, matchPerCardPower: 0.05, matchCardPowerFull: 11,

    revenueMultAt0: 0.55, revenueMultAt100: 1.25,
    moraleAt0: -12, moraleAt100: 18,     // ⭐ a bad event LOWERS morale
    hopeAt0: -6,   hopeAt100: 12,
    prestigeAt0: -0.08, prestigeAt100: 0.06,
    refundBelow: 35, refundMax: 0.45,     // score 0 → 45% of ticket gross refunded
    /* Presentation, not economy — the score at or above which the city log and
       the settlement toast read as a success. It is in the table anyway because
       "every number in one place" is easier to keep than "every number except
       the ones I judged cosmetic". */
    goodEventAt: 50,
    incidentBelow: 25, incidentsPerThousand: 1.5,
    effectExpiryDays: 3,                  // morale/hope deltas expire after this
  },

  /* ── §5 PRESTIGE ───────────────────────────────────────────────────── */
  prestige: {
    min: 0.4, max: 2.0, start: 0.6,
    perEvent: 0.02,
    highSatisfactionBonus: 0.04, highSatisfactionAt: 75,
    prizeMax: 0.15, prizeFull: 400000,    // raw doc 🔥 prize pool for the full +0.15
    entrantMax: 0.10, entrantRRFull: 2000,
    decayPerWeek: 0.01, weekMs: 7 * 24 * 3600 * 1000,
    /* A bigger room is a better room. Level 3 opens at a higher floor than
       level 1 — but it is a FLOOR, not a gift: a badly run L3 still decays. */
    floorPerLevel: [0.0, 0.05, 0.10],
  },

  /* ── §6 SPILLOVER ──────────────────────────────────────────────────── */
  spillover: {
    radius: 6,
    /* The pack's list (Restaurants, Clubs, Groceries, Card Shops, Vendor
       stalls) mapped onto buildings this game actually has. `shop` is the
       Player Shop — the storefront on the world marketplace, i.e. the card
       shop. `foodtruck` is the vendor stall. `lot` counts ONLY when it has a
       tenant, because an empty leased plot has no revenue to multiply. */
    types: ['restaurant', 'club', 'grocery', 'shop', 'foodtruck', 'lot'],
    /* 💰 WHAT A SHOP'S "REVENUE FOR THE EVENT CYCLE" IS, and the one gap this
       had to fill. Spillover multiplies a target's takings — but in node-city
       a Restaurant and a Grocery produce COVERAGE, not Cinder: they have no
       `gen.cinder` at all, so their takings are literally zero and the pack's
       two headline spillover targets would never be paid a penny.
       Rather than drop them (which guts the mechanic) or invent a revenue
       figure per building (which is unauditable), takings are derived from the
       ONE thing the catalog already states about them: how much refined stock
       they serve per minute (`svc.rate`). `servicePricePerUnit` is the single
       new number, and it is here in the table where it can be retuned:
         Restaurant  0.80 rations/min × 75 min × 600 = 36,000 🔥/cycle
         Grocery     2.40             × 75      × 600 = 108,000 🔥/cycle
       against the pack's own 180,000 / 120,000 build prices — i.e. a shop
       turns over roughly its build cost every couple of cycles, which is the
       right order for a service business. A building that DOES have
       `gen.cinder` (Club, Player Shop) uses its real yield instead; this is
       only the fallback for the ones that do not. */
    servicePricePerUnit: 600,
    perThousand: 0.18,
    falloffAt1: 1.0, falloffAtMax: 0.4,
    cap: 3.0,
  },
  vendorFee: { minPct: 0, maxPct: 25, defaultPct: 10 },

  /* ── §7 MIGRATION ──────────────────────────────────────────────────── */
  migration: {
    perVisitor: 0.015,
    hopeRef: 60, hopeFactorMin: 0.5, hopeFactorMax: 1.5,
    unhousedHopeCost: 2,
    /* Arrivals are people; the citizenry node-city tracks is in `catchment`
       units. One tracked citizen per this many arrivals, or a single event
       would double the city. Deliberately the SAME number as `catchment` —
       if these two ever diverge, migration is measured in different people
       from the ones who attended. */
    residentsPerCitizen: 6000,
  },

  /* ── §8 READINESS ──────────────────────────────────────────────────── */
  readiness: {
    powerWarnRatio: 1.00,       // draw ≥ generation → WARN
    powerFailRatio: 0.80,
    securityWarn: 60, securityFail: 35,
    healthWarn: 60, healthFail: 35,
    transitWarnRatio: 0.90, transitFailRatio: 0.70,
    concessionWarnRatio: 1.00, concessionFailRatio: 0.90,
    powerPerThousand: 1.2,      // event power draw per 1,000 attendees, per minute
    /* 🏗 WHAT ONE BUILDING IS WORTH — the numbers every "→ Build 3 ⚡ Power
       Stations" line is computed from. These were twelve bare constants buried
       in the fix strings until r10, which is exactly the failure the module
       header warns about: if node-city retunes a Power Station from 6 to 8, the
       readiness panel confidently tells the player to build the wrong number of
       buildings and nothing errors. They are node-city's own catalog figures,
       cited so a drift can be checked in one grep:
         powerstation gen.power 6.0   (node-city/index.html:1998)
         cannery      gen.rations 2.60             (:1992)
         purifier     gen.water   1.2              (:1857)
         machineshop  gen.goods   0.35             (:2012)
         clinic       gen.remedies 0.45            (:2018)
         housing      popCap      6                (:1876)
       The two that are NOT catalog figures are named as such: `securityPerPolice`
       and `healthPerClinic` are calibrated coverage points per building — service
       coverage is a supply/demand ratio, so there is no catalog number to cite
       and these are the panel's own advice heuristic. */
    powerStationGen: 6,
    canneryRationsPerMin: 2.6,
    purifierWaterPerMin: 1.2,
    machineShopGoodsPerMin: 0.35,
    clinicRemediesPerMin: 0.45,
    housingCapPerBuilding: 6,
    securityPerPolice: 12,      // calibrated, not a catalog figure — see above
    healthPerClinic: 15,        // calibrated, not a catalog figure — see above
    /* The satisfaction the HOUSING row assumes when it projects arrivals. The
       event has not happened yet, so migration has to be estimated against
       something; a mildly-good event is the honest guess and a bare `70` in the
       middle of eventReadiness was a thirteenth escaped constant. */
    projectedSatisfaction: 70,
  },
};

/* ── tiny helpers, no economy numbers ──────────────────────────────────── */
const TIER_IDS = ['standing', 'seated', 'box'];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
/* Raw design-pack 🔥 → this city's Cinder. Applied ONCE, here, and nowhere
   else. Every `*Doc` field in a result is the pack's own scale. */
export function toCinder(docFigure, E = STADIUM_ECON) {
  return Math.round(num(docFigure) / E.cinderDivisor);
}

/* ══ §1 ATTENDANCE ═════════════════════════════════════════════════════ */

/** Seats for a stadium level (1-based). */
export function stadiumSeats(stadium, E = STADIUM_ECON) {
  const lvl = clamp(Math.round(num(stadium && stadium.lvl) || 1), 1, E.seats.length);
  return E.seats[lvl - 1];
}

/**
 * Capped TWICE — by the room and by the road.
 * "An 8,000-seat stadium with no parking and broken roads seats 900 people."
 * node = { motorPoolCapacity, railYardCapacity, roadsTotal, roadsRepaired }
 */
export function stadiumAttendanceCap(stadium, node, E = STADIUM_ECON) {
  const T = E.transit;
  const seats = stadiumSeats(stadium, E);
  const mp = Math.max(0, num(node && node.motorPoolCapacity));
  const ry = Math.max(0, num(node && node.railYardCapacity));
  const rt = Math.max(0, num(node && node.roadsTotal));
  const rr = clamp(num(node && node.roadsRepaired), 0, rt);
  /* No roads at all is a ratio of 0, not 1. A city with no road network cannot
     move a crowd, and reading 0/0 as "fully repaired" would hand a brand-new
     city 1,800 free transit for infrastructure it has not built. */
  const roadRatio = rt > 0 ? rr / rt : 0;
  const parts = {
    base: T.base,
    motorPools: mp * T.perMotorPoolLevel,
    railYards: ry * T.perRailYardLevel,
    roads: Math.round(roadRatio * T.roadsFull),
  };
  const transit = parts.base + parts.motorPools + parts.railYards + parts.roads;
  return {
    seats, transit, effective: Math.min(seats, transit),
    limitedBy: transit < seats ? 'transit' : (seats < transit ? 'seats' : 'both'),
    parts, roadRatio,
  };
}

/** interest = 0.5 + morale/200 + hope/200, clamped 0.5–1.5. */
export function crowdInterest(node, E = STADIUM_ECON) {
  const D = E.draw;
  return clamp(D.interestBase + num(node && node.morale) / D.moraleDiv
                              + num(node && node.hope) / D.hopeDiv,
               D.interestMin, D.interestMax);
}

/**
 * The residents this stadium draws on. `node.residents` is the world node's own
 * `recon.population` when the host can reach it — the real figure, and the one
 * the design pack means. Only when it is absent does the tracked citizenry get
 * converted through `catchment`. See the header.
 */
export function nodeResidents(node, E = STADIUM_ECON) {
  const real = num(node && node.residents);
  if (real > 0) return real;
  return Math.max(0, num(node && node.population)) * E.catchment;
}

/** Region population, derived from the Node Anchors this city really holds. */
export function regionResidents(world, E = STADIUM_ECON) {
  const anchors = (world && world.anchors) || [];
  let r = 0;
  for (const a of anchors) {
    const lvl = Math.max(1, num(a && a.level) || 1);
    const link = clamp(num(a && a.link), 0, 100) / 100;
    r += E.draw.residentsPerAnchorLevel * lvl * link;
  }
  return r;
}

/**
 * computeAttendance(stadium, event, node, world, now)
 *   -> { local, visitors, regional, total, turnedAway, byTier, demand, cap }
 *
 * Price elasticity is applied to the DRAW, not to the revenue: raise prices and
 * fewer people come. Each tier's slice of demand is multiplied by that tier's
 * own ticketDemandMultiplier, so pricing the boxes into orbit empties the boxes
 * and leaves the terraces full — which is the decision the pack is asking for.
 */
export function computeAttendance(stadium, event, node, world, now, E = STADIUM_ECON) {
  const D = E.draw;
  const interest = crowdInterest(node, E);
  const prestige = stadiumPrestige(stadium, event, now, E);

  const local = nodeResidents(node, E) * D.localPerResident * interest;

  let visitors = 0;
  const neighbours = (world && world.neighbours) || [];
  for (const n of neighbours) {
    const pop = nodeResidents(n, E);            // same rule as our own node
    const rq = (n && n.route) ? D.routeLinked : D.routeUnlinked;
    visitors += pop * D.visitorPerResident * rq * prestige;
  }

  const stability = clamp(num(world && world.tradeStability), 0, 100);
  const regional = regionResidents(world, E) * D.regionalPerResident * prestige
                 * (stability / D.tradeStabilityDiv);

  const rawDemand = local + visitors + regional;

  /* Per-tier elasticity on the demand, then cap the TOTAL. */
  const prices = eventPrices(event, E);
  const byTierDemand = {}; let elasticDemand = 0;
  for (const id of TIER_IDS) {
    const t = E.tiers[id];
    const ratio = prices[id] / t.basePrice;
    const m = ticketDemandMultiplier(ratio, prestige, E);
    const d = rawDemand * t.share * m;
    byTierDemand[id] = d; elasticDemand += d;
  }

  const cap = stadiumAttendanceCap(stadium, node, E);
  const total = Math.min(Math.floor(elasticDemand), cap.effective);
  const turnedAway = Math.max(0, Math.round(elasticDemand) - total);

  /* Seat the crowd in proportion to the elastic demand that actually showed up,
     not to the catalogue shares — the boxes you priced out stay empty. */
  const byTier = {}; let seated = 0;
  for (let i = 0; i < TIER_IDS.length; i++) {
    const id = TIER_IDS[i];
    const n = i === TIER_IDS.length - 1
      ? total - seated
      : Math.floor(total * (elasticDemand > 0 ? byTierDemand[id] / elasticDemand : E.tiers[id].share));
    byTier[id] = Math.max(0, n); seated += byTier[id];
  }

  /* Where the crowd came FROM, in the same proportion as the raw draw — the
     visitor count is what migration reads, so it has to survive the cap. */
  const scale = rawDemand > 0 ? total / rawDemand : 0;
  return {
    local: Math.round(local * scale),
    visitors: Math.round(visitors * scale),
    regional: Math.round(regional * scale),
    total, turnedAway, byTier, byTierDemand,
    rawDemand: Math.round(rawDemand), elasticDemand: Math.round(elasticDemand),
    interest, prestige, cap,
  };
}

/* ══ §2 TICKETS ════════════════════════════════════════════════════════ */

/** Player-set prices, clamped to 0.25×–4× of base. Raw doc 🔥. */
export function clampTicketPricing(tiers, E = STADIUM_ECON) {
  const out = {};
  for (const id of TIER_IDS) {
    const base = E.tiers[id].basePrice;
    const want = (tiers && num(tiers[id])) || base;
    out[id] = Math.round(clamp(want, base * E.ticket.minRatio, base * E.ticket.maxRatio));
  }
  return out;
}
export function eventPrices(event, E = STADIUM_ECON) {
  return clampTicketPricing((event && event.pricing) || null, E);
}

/** demand = clamp(0, 1.6, 1.9 − 0.9 × (ratio / (0.7 + prestige×0.3))^1.35). */
export function ticketDemandMultiplier(priceRatio, prestige, E = STADIUM_ECON) {
  const T = E.ticket;
  const r = clamp(num(priceRatio), T.minRatio, T.maxRatio);
  const p = clamp(num(prestige) || E.prestige.start, E.prestige.min, E.prestige.max);
  const eff = r / (T.flattenBase + p * T.flattenPer);
  return clamp(T.a - T.b * Math.pow(eff, T.exp), 0, T.demandMax);
}

/** Gross ticket revenue in RAW doc 🔥, plus the Cinder figure. */
export function ticketRevenue(event, attendanceByTier, E = STADIUM_ECON) {
  const prices = eventPrices(event, E);
  const byTier = {}; let gross = 0;
  for (const id of TIER_IDS) {
    const n = Math.max(0, Math.round(num(attendanceByTier && attendanceByTier[id])));
    byTier[id] = n * prices[id];
    gross += byTier[id];
  }
  return { gross, byTier, prices, cinder: toCinder(gross, E) };
}

/* ══ §3 CONCESSIONS ════════════════════════════════════════════════════ */

/** What the crowd eats and drinks. Per attendee, per cycle. */
export function concessionDemand(attendance, eventLengthCycles, E = STADIUM_ECON) {
  const n = Math.max(0, num(attendance));
  const cycles = Math.max(1, num(eventLengthCycles) || 1);
  const out = {};
  for (const r in E.concession.perAttendee) {
    out[r] = +(n * E.concession.perAttendee[r] * cycles).toFixed(3);
  }
  return out;
}

/**
 * 🔴 THE MINIMUM, NOT THE AVERAGE.
 * Running out of water ruins an event even if food was plentiful — the same
 * law-of-the-minimum rule node-city's vitals already run on. An average would
 * let a mountain of rations paper over an empty cistern, and the whole point of
 * the prep phase is that it cannot.
 */
export function concessionFulfilment(demand, stock, E = STADIUM_ECON) {
  const per = {}, short = [], consumed = {};
  let ratio = 1;
  for (const r in demand) {
    const want = Math.max(0, num(demand[r]));
    const have = Math.max(0, num(stock && stock[r]));
    const p = want > 0 ? clamp(have / want, 0, 1) : 1;
    per[r] = p;
    if (p < 1) short.push(r);
    if (p < ratio) ratio = p;
  }
  /* 🔴 CHARGE FOR THE ATTEMPT. `min(demand, stock)`, per line — NOT
     `demand × ratio`.
     ⚠ THE BUG THIS FIXES, measured r9: with the ratio taken from the SHORTEST
       line, `demand × ratio` at ratio 0 consumed literally nothing. An
       unprepared event therefore cost 0 rations, 0 water, 0 goods and 0
       remedies while a prepared one cost 525 units — not preparing SAVED
       stock. Combined with a satisfaction floor of 65 that made stockpiling a
       strictly dominated strategy, which is the opposite of the design.
     The model is per-line and it is the physical one: each counter serves what
     it has until demand is met. The crowd that ate the last 400 rations before
     the water ran out still ate them. Fulfilment stays the MINIMUM (a mountain
     of rations still cannot paper over an empty cistern — that is what gates
     revenue and satisfaction); only the DRAW is per-line. */
  for (const r in demand) {
    const want = Math.max(0, num(demand[r]));
    const have = Math.max(0, num(stock && stock[r]));
    consumed[r] = +Math.min(want, have).toFixed(3);
  }
  return { ratio: +ratio.toFixed(4), short, per, consumed, demand };
}

/** Σ share × spendWeight — box holders spend nearly twice a terrace ticket. */
export function tierSpendFactor(attendanceByTier, E = STADIUM_ECON) {
  let total = 0, weighted = 0;
  for (const id of TIER_IDS) {
    const n = Math.max(0, num(attendanceByTier && attendanceByTier[id]));
    total += n; weighted += n * E.tiers[id].spendWeight;
  }
  return total > 0 ? weighted / total : 1;
}

/** revenue = attendance × 34 × (markup/100) × fulfilment.ratio × tierFactor. */
export function concessionRevenue(attendance, fulfilment, markupPct, tierMix, E = STADIUM_ECON) {
  const C = E.concession;
  const n = Math.max(0, num(attendance));
  const mk = clamp(num(markupPct) || C.defaultMarkupPct, C.markupMin, C.markupMax);
  const ratio = clamp(num(fulfilment && fulfilment.ratio), 0, 1);
  const tf = typeof tierMix === 'number' ? tierMix : tierSpendFactor(tierMix, E);
  const gross = n * C.spendPerAttendee * (mk / 100) * ratio * tf;
  return { gross: Math.round(gross), markupPct: mk, tierFactor: +tf.toFixed(4), cinder: toCinder(gross, E) };
}

/**
 * ⚠ THE ONE MUTATING EXPORT, and it mutates only the object it is handed.
 * Deducts the consumed stock from a node snapshot. `rations`, `goods` and
 * `remedies` are CITY stock (node.stock); `water` is a game-ledger resource
 * (node.res) — node-city's `haveOf()` reads both and so does this.
 * The host calls its own recompute afterwards; this function does not know
 * what a vital is. Food coverage falls because the rations went; Water
 * coverage falls because the water went. Nothing is hidden.
 */
export function applyEventDrain(node, consumed) {
  const drained = { stock: {}, res: {} };
  if (!node || !consumed) return drained;
  node.stock = node.stock || {}; node.res = node.res || {};
  for (const r in consumed) {
    const want = Math.max(0, num(consumed[r]));
    if (want <= 0) continue;
    if (Object.prototype.hasOwnProperty.call(node.stock, r) || r !== 'water') {
      const take = Math.min(want, Math.max(0, num(node.stock[r])));
      node.stock[r] = +(Math.max(0, num(node.stock[r])) - take).toFixed(4);
      drained.stock[r] = take;
    } else {
      const take = Math.min(Math.ceil(want), Math.max(0, num(node.res[r])));
      node.res[r] = Math.max(0, num(node.res[r])) - take;
      drained.res[r] = take;
    }
  }
  return drained;
}

/* ══ §4 SATISFACTION ═══════════════════════════════════════════════════ */

/**
 * eventSatisfaction -> { score, factors: [{ label, delta, weight, detail }] }
 * ⭐ ALWAYS returns the breakdown. A bare score tells a player nothing about
 * what to fix, and "never show a bare score" is an acceptance criterion.
 */
export function eventSatisfaction(event, node, fulfilment, attendance, cap, E = STADIUM_ECON) {
  const S = E.satisfaction, W = S.weights;
  const factors = [];
  const add = (label, weight, factor, detail) => {
    const delta = +(weight * clamp(factor, 0, 1)).toFixed(2);
    factors.push({ label, weight, factor: +clamp(factor, 0, 1).toFixed(3), delta, detail });
    return delta;
  };
  let score = 0;

  const fr = clamp(num(fulfilment && fulfilment.ratio), 0, 1);
  score += add('🍽 Concession fulfilment', W.concessions, fr,
    Math.round(fr * 100) + '% served' + (fulfilment && fulfilment.short && fulfilment.short.length
      ? ' — ran out of ' + fulfilment.short.join(', ') : ''));

  const sec = clamp(num(node && node.security) / 100, 0, 1);
  score += add('🛡 Security coverage', W.security, sec, 'Coverage ' + Math.round(sec * 100));

  const pr = clamp(num(node && node.powerRatio), 0, 1);
  score += add('⚡ Power stability', W.power, pr,
    pr < S.blackoutBelow ? 'BLACKOUT — grid at ' + Math.round(pr * 100) + '%'
                         : 'Grid at ' + Math.round(pr * 100) + '%');

  const hea = clamp(num(node && node.health) / 100, 0, 1);
  score += add('🩹 Health coverage', W.health, hea, 'Coverage ' + Math.round(hea * 100));

  const transit = Math.max(1, num(cap && cap.transit));
  const load = num(attendance) / transit;
  /* Headroom is 1 up to the crush point, then falls away linearly to 0 at
     transit saturation. A stadium that seats exactly what the roads can carry
     is a stadium with queues out the gate. */
  const head = load <= S.transitCrushAt ? 1
             : clamp(1 - (load - S.transitCrushAt) / (1 - S.transitCrushAt), 0, 1);
  score += add('🅿 Transit headroom', W.transit, head,
    Math.round(attendance).toLocaleString() + ' of ' + Math.round(transit).toLocaleString()
    + ' (' + Math.round(load * 100) + '% loaded)');

  const power = Math.max(0, num(event && event.headlinerPower));
  const mq = event && event.headlinerPower != null
    ? clamp(S.matchBaseline + power * S.matchPerCardPower, 0, 1)
    : S.matchBaseline;
  score += add('🃏 Match quality', W.match, mq,
    event && event.headlinerName ? event.headlinerName + ' — ⚡' + power : 'No headliner slotted');

  /* The blackout is not a weighting, it is a disaster. Applied after the sum
     and shown as its own row so the report says what happened. */
  let blackout = false;
  if (pr < S.blackoutBelow) {
    blackout = true;
    score -= S.blackoutPenalty;
    factors.push({ label: '💥 Blackout mid-event', weight: 0, factor: 0,
                   delta: -S.blackoutPenalty, detail: 'The lights went out. Nothing recovers from this.' });
  }

  /* 🔴 …AND NEITHER IS A CROWD YOU COULD NOT FEED. Same shape, same place, for
     the same reason: below the floor this is not a low score, it is a
     disaster with the host's name on it (spec §0). Without this row the 35
     concession points alone could not carry a well-built city under the refund
     threshold, and an unprepared event paid a MORALE BONUS — see
     STADIUM_ECON.satisfaction.fulfilmentFloorBelow for the measurement and for
     where 45 comes from. */
  let starved = false;
  if (fr < S.fulfilmentFloorBelow) {
    starved = true;
    score -= S.fulfilmentPenalty;
    factors.push({ label: '🥀 The crowd went hungry', weight: 0, factor: 0,
                   delta: -S.fulfilmentPenalty,
                   detail: 'Only ' + Math.round(fr * 100) + '% of the crowd was served. '
                     + 'They queued, they paid, they got nothing.' });
  }

  score = clamp(Math.round(score), 0, 100);
  return { score, factors, blackout, starved, transitLoad: +load.toFixed(3) };
}

/** ⭐ A bad event must be worse than no event. */
export function satisfactionEffects(score, E = STADIUM_ECON) {
  const S = E.satisfaction;
  const s = clamp(num(score), 0, 100) / 100;
  const refundPct = score < S.refundBelow
    ? +clamp((S.refundBelow - score) / S.refundBelow * S.refundMax, 0, S.refundMax).toFixed(4)
    : 0;
  return {
    revenueMult: +lerp(S.revenueMultAt0, S.revenueMultAt100, s).toFixed(4),
    moraleDelta: +lerp(S.moraleAt0, S.moraleAt100, s).toFixed(2),
    hopeDelta:   +lerp(S.hopeAt0,   S.hopeAt100,   s).toFixed(2),
    prestigeDelta: +lerp(S.prestigeAt0, S.prestigeAt100, s).toFixed(4),
    refundPct,
    incidents: 0,   // always 0 here; settleEvent overwrites it — it knows attendance
    expiryDays: S.effectExpiryDays,
  };
}
export function eventIncidents(score, attendance, E = STADIUM_ECON) {
  const S = E.satisfaction;
  if (score >= S.incidentBelow) return 0;
  const severity = (S.incidentBelow - score) / S.incidentBelow;
  return Math.ceil(severity * (Math.max(0, num(attendance)) / 1000) * S.incidentsPerThousand);
}

/* ══ §5 PRESTIGE ═══════════════════════════════════════════════════════ */

/**
 * stadiumPrestige(stadium, event?, now?) -> 0.4 – 2.0, starts at 0.6.
 * Derived, never stored as a mutable score you could desync: the stadium
 * carries its HISTORY (events run, average satisfaction, last event time) and
 * this recomputes from it. A dark stadium is forgotten — the decay is a
 * function of `now`, so it happens whether or not anyone opened the panel.
 */
export function stadiumPrestige(stadium, event, now, E = STADIUM_ECON) {
  const P = E.prestige;
  const s = stadium || {};
  const lvl = clamp(Math.round(num(s.lvl) || 1), 1, P.floorPerLevel.length);
  let p = P.start + P.floorPerLevel[lvl - 1];

  const events = Math.max(0, num(s.eventsCompleted));
  p += events * P.perEvent;
  if (events > 0 && num(s.avgSatisfaction) > P.highSatisfactionAt) p += P.highSatisfactionBonus;

  const prize = Math.max(0, num(event && event.prizePool) || num(s.bestPrizePool));
  p += clamp(prize / P.prizeFull, 0, 1) * P.prizeMax;

  const rr = Math.max(0, num(event && event.topEntrantRR) || num(s.bestEntrantRR));
  p += clamp(rr / P.entrantRRFull, 0, 1) * P.entrantMax;

  const last = num(s.lastEventAt);
  const t = num(now) || 0;
  if (last > 0 && t > last) p -= ((t - last) / P.weekMs) * P.decayPerWeek;

  return +clamp(p, P.min, P.max).toFixed(4);
}

/* ══ §6 SPILLOVER — other players get paid ═════════════════════════════ */

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** Restaurants, Clubs, Groceries, Card Shops and vendor stalls within radius 6. */
export function spilloverTargets(stadium, buildings, E = STADIUM_ECON) {
  const S = E.spillover;
  const out = [];
  for (const b of (buildings || [])) {
    if (!b || !S.types.includes(b.type)) continue;
    if (b.type === 'lot' && !b.tenant) continue;          // an empty plot earns nothing
    if (b.key && stadium && b.key === stadium.key) continue;
    const d = cheb(b, stadium || { x: 0, z: 0 });
    /* 🔴 A MONEY FILTER MUST FAIL CLOSED. `cheb` returns NaN when either side
       has no x/z, and every comparison against NaN is false — so `d < 1 ||
       d > radius` let EVERY building through, and `distanceFalloff(NaN)`
       clamped to 1.0, paying a range-9 shop the full rate. `settleEvent`'s own
       fallback stadium is `{ lvl: 1 }` with no coordinates, so this was one
       missing argument away from live. Reproduced r9; guarded r10. */
    if (!Number.isFinite(d) || d < 1 || d > S.radius) continue;
    out.push({ ...b, distance: d });
  }
  return out;
}

export function distanceFalloff(d, E = STADIUM_ECON) {
  const S = E.spillover;
  const r = clamp(num(d), 1, S.radius);
  if (S.radius <= 1) return S.falloffAt1;
  return +lerp(S.falloffAt1, S.falloffAtMax, (r - 1) / (S.radius - 1)).toFixed(4);
}

/**
 * 🔴 THIS PAYS OTHER PLAYERS. Every row here becomes an append-only ledger
 * entry carrying the event id, so a dispute can be audited line by line.
 * Returns PLANNED payouts — it moves nothing. Only commitSettlement moves money.
 */
export function applySpillover(stadium, event, attendance, satisfaction, buildings, E = STADIUM_ECON) {
  const S = E.spillover;
  const targets = spilloverTargets(stadium, buildings, E);
  const sat = clamp(num(satisfaction), 0, 100);
  const payouts = [];
  for (const b of targets) {
    const fall = distanceFalloff(b.distance, E);
    const mult = clamp(1 + (num(attendance) / 1000) * S.perThousand * fall * (sat / 100), 1, S.cap);
    const base = Math.max(0, num(b.baseRevenue));
    const gain = base * (mult - 1);
    if (gain <= 0) continue;
    payouts.push({
      buildingKey: b.key, type: b.type, ownerId: b.ownerId || null, ownerName: b.ownerName || null,
      distance: b.distance, falloff: fall, mult: +mult.toFixed(4),
      baseRevenue: Math.round(base), gain: Math.round(gain), gainCinder: toCinder(gain, E),
    });
  }
  return payouts;
}

/**
 * Vendor fees take a cut of the SPILLOVER GAIN only, never base revenue.
 * Shops keep what they would have earned anyway — that is the promise that
 * makes a 0% district worth flocking to and a 25% district worth avoiding.
 */
export function collectVendorFees(event, payouts, pct, E = STADIUM_ECON) {
  const V = E.vendorFee;
  const p = clamp(Math.round(num(pct != null ? pct : (event && event.vendorFeePct))), V.minPct, V.maxPct);
  let fee = 0;
  const net = (payouts || []).map(row => {
    const cut = Math.round(row.gain * (p / 100));
    fee += cut;
    return { ...row, vendorFee: cut, net: row.gain - cut, netCinder: toCinder(row.gain - cut, E) };
  });
  return { pct: p, fee, feeCinder: toCinder(fee, E), payouts: net };
}

/* ══ §7 MIGRATION ══════════════════════════════════════════════════════ */

export function computeMigration(event, satisfaction, node, visitors, E = STADIUM_ECON) {
  const M = E.migration;
  const hope = num(node && node.hope);
  const hopeFactor = clamp(hope / M.hopeRef, M.hopeFactorMin, M.hopeFactorMax);
  const arrivals = Math.round(Math.max(0, num(visitors)) * M.perVisitor
                   * (clamp(num(satisfaction), 0, 100) / 100) * hopeFactor);
  /* Housing headroom is measured in TRACKED citizens, arrivals in people. */
  const headroomPeople = Math.max(0, num(node && node.housingHeadroom)) * M.residentsPerCitizen;
  const housed = Math.min(arrivals, headroomPeople);
  const turnedAway = arrivals - housed;
  return {
    arrivals, housed: Math.round(housed), turnedAway: Math.round(turnedAway),
    citizens: +(housed / M.residentsPerCitizen).toFixed(3),
    hopeFactor: +hopeFactor.toFixed(3),
    /* ⭐ A city that draws people it cannot house looks bad, and should. */
    hopeCost: turnedAway > 0 ? M.unhousedHopeCost : 0,
  };
}

/* ══ §8 THE PREP PHASE — the actual gameplay ═══════════════════════════ */

/**
 * eventReadiness(event, node) -> { ready, projectedAttendance, checks[] }
 * ⭐ EVERY FAILING CHECK NAMES ITS FIX. That is what turns an event from a
 * button into a three-day project. A check with `status: 'fail'` and no `fix`
 * is a bug — `assertReadinessContract()` below will say so.
 */
export function eventReadiness(event, node, world, now, E = STADIUM_ECON) {
  const R = E.readiness;
  const stadium = (event && event.stadium) || (node && node.stadium) || { lvl: 1 };
  const att = computeAttendance(stadium, event, node, world, now, E);
  const cap = att.cap;
  const cycles = Math.max(1, num(event && event.lengthCycles) || 1);
  const demand = concessionDemand(att.total, cycles, E);
  const stock = nodeStockView(node);
  const checks = [];
  const push = (id, ico, label, status, detail, fix) => checks.push({ id, ico, label, status, detail, fix: fix || null });

  /* 🍽 Concessions — one row per resource, because "concessions FAIL" without
     naming the resource is not a fix, it is a mood. */
  for (const r of Object.keys(demand)) {
    const want = demand[r], have = Math.max(0, num(stock[r]));
    const ratio = want > 0 ? have / want : 1;
    const status = ratio >= R.concessionWarnRatio ? 'ok' : ratio >= R.concessionFailRatio ? 'warn' : 'fail';
    const shortBy = Math.max(0, Math.ceil(want - have));
    push('conc_' + r, CONC_ICO[r] || '📦', CONC_NAME[r] || r, status,
      fmt(have) + ' / ' + fmt(Math.ceil(want)) + ' ' + (CONC_NAME[r] || r).toLowerCase(),
      status === 'ok' ? null : concessionFix(r, shortBy, E));
  }

  /* ⚡ Power */
  const draw = num(node && node.powerDemand) + (att.total / 1000) * R.powerPerThousand;
  const gen = num(node && node.powerGen);
  const pratio = draw > 0 ? gen / draw : 1;
  push('power', '⚡', 'Power', pratio >= R.powerWarnRatio ? 'ok' : pratio >= R.powerFailRatio ? 'warn' : 'fail',
    'Draw ' + draw.toFixed(1) + ', generating ' + gen.toFixed(1)
      + (pratio < 1 ? ' → blackout risk ' + Math.round((1 - pratio) * 100) + '%' : ''),
    pratio >= R.powerWarnRatio ? null
      : '→ Build ' + Math.max(1, Math.ceil((draw - gen) / R.powerStationGen)) + ' ⚡ Power Station'
        + (Math.ceil((draw - gen) / R.powerStationGen) > 1 ? 's' : ''));

  /* 🛡 Security */
  const sec = num(node && node.security);
  push('security', '🛡', 'Security', sec >= R.securityWarn ? 'ok' : sec >= R.securityFail ? 'warn' : 'fail',
    'Coverage ' + Math.round(sec),
    sec >= R.securityWarn ? null : '→ Build ' + Math.max(1, Math.ceil((R.securityWarn - sec) / R.securityPerPolice)) + ' 🚓 Police Station'
      + (Math.ceil((R.securityWarn - sec) / R.securityPerPolice) > 1 ? 's' : ''));

  /* 🩹 Health */
  const hea = num(node && node.health);
  push('health', '🩹', 'Health', hea >= R.healthWarn ? 'ok' : hea >= R.healthFail ? 'warn' : 'fail',
    'Coverage ' + Math.round(hea),
    hea >= R.healthWarn ? null : '→ Build ' + Math.max(1, Math.ceil((R.healthWarn - hea) / R.healthPerClinic)) + ' 🏥 Clinic'
      + (Math.ceil((R.healthWarn - hea) / R.healthPerClinic) > 1 ? 's' : ''));

  /* 🅿 Transit — the check the pack leads with, and the one that names Motor Pools. */
  const expected = Math.max(att.total, Math.min(Math.round(att.elasticDemand), cap.seats));
  const tratio = expected > 0 ? cap.transit / expected : 1;
  const shortSeats = Math.max(0, expected - cap.transit);
  push('transit', '🅿', 'Transit',
    tratio >= 1 ? 'ok' : tratio >= R.transitWarnRatio ? 'warn' : 'fail',
    'Capacity ' + fmt(cap.transit) + ' vs ' + fmt(expected) + ' expected',
    tratio >= 1 ? null : '→ Build ' + Math.ceil(shortSeats / E.transit.perMotorPoolLevel) + ' 🅿️ Motor Pool'
      + (Math.ceil(shortSeats / E.transit.perMotorPoolLevel) > 1 ? 's' : '')
      + (cap.roadRatio < 1 ? ', or repair ' + Math.round((1 - cap.roadRatio) * 100) + '% of your roads' : '')
      + (num(node && node.railYardCapacity) <= 0 ? ', or a 🚉 Rail Yard (+' + fmt(E.transit.perRailYardLevel) + ')' : ''));

  /* 🏘 Housing — migration is the compounding payoff, and it needs beds. */
  const projMig = computeMigration(event, R.projectedSatisfaction, node, att.visitors, E);
  const headroomPeople = Math.max(0, num(node && node.housingHeadroom)) * E.migration.residentsPerCitizen;
  push('housing', '🏘', 'Housing',
    headroomPeople >= projMig.arrivals ? 'ok' : headroomPeople > 0 ? 'warn' : 'fail',
    'Headroom ' + fmt(headroomPeople) + ', expect ~' + fmt(projMig.arrivals) + ' arrivals',
    headroomPeople >= projMig.arrivals ? null
      : '→ Build ' + Math.max(1, Math.ceil((projMig.arrivals - headroomPeople)
          / (E.migration.residentsPerCitizen * R.housingCapPerBuilding)))
        + ' 🏠 Housing');

  const ready = checks.every(c => c.status !== 'fail');
  return { ready, projectedAttendance: att.total, attendance: att, cap, demand, checks };
}

/* Exported so the readiness panel, the settlement report and the city log all
   label the same four lines the same way from ONE definition. */
export const CONC_ICO = { rations: '🍽', water: '💧', goods: '🎁', remedies: '🩹' };
export const CONC_NAME = { rations: 'Rations', water: 'Water', goods: 'Goods', remedies: 'Remedies' };
function concessionFix(r, shortBy, E) {
  const cyc = E.cycleMinutes, R = E.readiness;
  if (r === 'rations') return '→ Buy ' + fmt(shortBy) + ' on the Exchange, or run a 🥫 Cannery for '
    + Math.ceil(shortBy / R.canneryRationsPerMin) + ' more minutes ('
    + fmt(Math.round(R.canneryRationsPerMin * cyc)) + '/cycle)';
  if (r === 'water') return '→ Buy ' + fmt(shortBy) + ' 💧, or build ' + Math.max(1, Math.ceil(shortBy / (R.purifierWaterPerMin * cyc))) + ' 💧 Purifier';
  if (r === 'goods') return '→ Buy ' + fmt(shortBy) + ' 🎁, or build ' + Math.max(1, Math.ceil(shortBy / (R.machineShopGoodsPerMin * cyc))) + ' 🔧 Machine Shop';
  if (r === 'remedies') return '→ Buy ' + fmt(shortBy) + ' 🩹, or build ' + Math.max(1, Math.ceil(shortBy / (R.clinicRemediesPerMin * cyc))) + ' 🏥 Clinic';
  return '→ Buy ' + fmt(shortBy) + ' ' + r;
}
function fmt(n) { return Math.round(num(n)).toLocaleString('en-US'); }

/** Merged stock view: city stock first, game ledger second (node-city haveOf). */
export function nodeStockView(node) {
  const s = {}, st = (node && node.stock) || {}, rs = (node && node.res) || {};
  for (const k in rs) s[k] = rs[k];
  for (const k in st) s[k] = st[k];
  return s;
}

/**
 * A failing check with no fix is the failure mode this whole panel exists to
 * prevent. Returns the offending ids; the host console-warns on a non-empty
 * result rather than shipping a dead-end checklist.
 */
export function assertReadinessContract(readiness) {
  return ((readiness && readiness.checks) || [])
    .filter(c => c.status !== 'ok' && !c.fix).map(c => c.id);
}

/* ══ §9 SETTLEMENT ═════════════════════════════════════════════════════
   🔴 TWO HALVES, ON PURPOSE.

   `settleEvent` is PURE. It computes the entire outcome and returns a PLAN —
   an append-only ledger, a stock drain, morale/hope deltas, migration and a
   prestige move. It mutates nothing, touches no network and cannot half-happen.

   `commitSettlement` is the only thing that moves anything, and it is
   all-or-nothing. Other players are being paid here: a settlement that credits
   three shops and then throws has stolen from the fourth and paid the first
   three out of a pot that was never debited. So the commit journals an inverse
   for every op it applies and, on ANY failure, unwinds in reverse before
   returning — and it reports `applied: 0`, never a partial count.

   The server RPC (sql/015_stadium_events.sql: `stadium_settle_event`) is the
   same contract in one Postgres transaction. This client path exists because
   the game must work offline / before the tables exist (CLAUDE.md).
   ═══════════════════════════════════════════════════════════════════════ */

export function settleEvent(event, node, world, now, E = STADIUM_ECON) {
  const stadium = (event && event.stadium) || (node && node.stadium) || { lvl: 1 };
  const t = num(now) || 0;
  const cycles = Math.max(1, num(event && event.lengthCycles) || 1);

  const att = computeAttendance(stadium, event, node, world, t, E);
  const demand = concessionDemand(att.total, cycles, E);
  const ful = concessionFulfilment(demand, nodeStockView(node), E);
  const sat = eventSatisfaction(event, node, ful, att.total, att.cap, E);
  const eff = satisfactionEffects(sat.score, E);
  eff.incidents = eventIncidents(sat.score, att.total, E);

  const tickets = ticketRevenue(event, att.byTier, E);
  const conc = concessionRevenue(att.total, ful, event && event.markupPct, att.byTier, E);

  /* Refunds come off the TICKET gross only — you do not refund a hot dog the
     crowd already ate. The satisfaction revenue multiplier applies to both. */
  const refund = Math.round(tickets.gross * eff.refundPct);
  const ticketNet = Math.round((tickets.gross - refund) * eff.revenueMult);
  const concNet = Math.round(conc.gross * eff.revenueMult);

  const payoutsRaw = applySpillover(stadium, event, att.total, sat.score,
                                    (node && node.buildings) || [], E);
  const vendor = collectVendorFees(event, payoutsRaw,
                                   stadium.vendorFeePct != null ? stadium.vendorFeePct : (event && event.vendorFeePct), E);

  const mig = computeMigration(event, sat.score, node, att.visitors, E);

  const prestigeBefore = stadiumPrestige(stadium, event, t, E);
  const prestigeAfter = +clamp(prestigeBefore + eff.prestigeDelta, E.prestige.min, E.prestige.max).toFixed(4);

  /* ── THE LEDGER. Append-only rows, every one carrying the event id
        (CLAUDE.md: "Ledgers are append-only. Balance = sum(amount)").
        Amounts are CINDER — the raw doc figure rides along as `amountDoc` so a
        dispute can be traced back to the pack's own scale. ── */
  const eventId = (event && event.id) || null;
  const hostId = (stadium && stadium.ownerId) || (node && node.ownerId) || null;
  const hostName = (stadium && stadium.ownerName) || null;
  const ledger = [];
  const row = (kind, toId, toName, amountDoc, memo, buildingKey) => {
    const amount = toCinder(amountDoc, E);
    if (!amount) return;
    ledger.push({ eventId, kind, toId, toName, amount, amountDoc: Math.round(amountDoc), memo, at: t,
                  buildingKey: buildingKey || null });
  };
  /* 🔴 TICKETS GROSS, THEN THE REFUND AS ITS OWN ROW.
     ⚠ r9 shipped a single `ticket_revenue` row already net of the refund: at
       score 0 a 202,572🔥 haircut appeared NOWHERE in the ledger, against
       spec §11's "every payout goes through an append-only ledger row … so any
       dispute can be audited". sql/015 already defines the `refund` kind and
       nothing ever emitted it. Two rows now, and they still sum to exactly
       (gross − refund) × revenueMult, so nothing is double-counted. */
  row('ticket_revenue', hostId, hostName, Math.round(tickets.gross * eff.revenueMult),
      att.total.toLocaleString() + ' tickets · satisfaction ' + sat.score
      + ' · ×' + eff.revenueMult);
  if (refund > 0) {
    row('refund', hostId, hostName, -Math.round(refund * eff.revenueMult),
        Math.round(eff.refundPct * 100) + '% of the gate refunded — satisfaction ' + sat.score);
  }
  row('concession_revenue', hostId, hostName, concNet,
      Math.round(ful.ratio * 100) + '% served · markup ' + conc.markupPct + '%');
  for (const p of vendor.payouts) {
    /* 🏪 THE HOST'S OWN SHOPS ARE THE HOST'S. A building with no tenant carries
       `ownerId: null` (stadium.city.js's nodeSnapshot), so r9 addressed the
       host's own restaurant to nobody: the row was written to an append-only
       ledger and then filtered out of `hostCinder` by `toId === hostId`, paid
       to no one. Resolving null → the host here is what makes that filter and
       `credit()`'s own `hostId != null` guard agree. Signed out, hostId is null
       too and the two nulls still match — which is correct, because every
       building in a signed-out city is the player's. */
    row('spillover_payout', p.ownerId || hostId, p.ownerName || hostName, p.net,
        p.type + ' @ ' + p.buildingKey + ' · ×' + p.mult.toFixed(2) + ' at range ' + p.distance,
        p.buildingKey);
  }
  row('vendor_fee', hostId, hostName, vendor.fee,
      vendor.pct + '% of spillover gain from ' + vendor.payouts.length + ' businesses');

  const hostNet = ledger.filter(r => r.toId === hostId).reduce((s, r) => s + r.amount, 0);
  const paidOut = ledger.filter(r => r.kind === 'spillover_payout').reduce((s, r) => s + r.amount, 0);
  /* Split out on purpose: `spilloverCinder` is the whole district's gain, but
     only `spilloverToOthers` is money leaving this player — and only that half
     needs a server to actually arrive. The UI must not claim the other half
     was paid to anybody. */
  const paidToOthers = ledger.filter(r => r.kind === 'spillover_payout' && r.toId !== hostId)
                             .reduce((s, r) => s + r.amount, 0);
  const orphaned = ledger.filter(r => r.amount > 0 && r.toId !== hostId
                                   && r.kind !== 'spillover_payout').length;

  return {
    ok: true, eventId, at: t,
    attendance: att, cap: att.cap, demand, fulfilment: ful,
    satisfaction: sat, effects: eff,
    tickets: { ...tickets, refund, refundCinder: toCinder(refund, E), net: ticketNet, netCinder: toCinder(ticketNet, E) },
    concessions: { ...conc, net: concNet, netCinder: toCinder(concNet, E) },
    spillover: vendor.payouts, vendorFee: { pct: vendor.pct, gross: vendor.fee, cinder: vendor.feeCinder },
    migration: mig,
    prestige: { before: prestigeBefore, delta: eff.prestigeDelta, after: prestigeAfter },
    deltas: {
      morale: eff.moraleDelta,
      hope: +(eff.hopeDelta - mig.hopeCost).toFixed(2),
      expiryDays: eff.expiryDays,
    },
    drain: ful.consumed,
    ledger,
    totals: { hostCinder: hostNet, spilloverCinder: paidOut, spilloverToOthers: paidToOthers,
              orphanedRows: orphaned, rows: ledger.length },
  };
}

/**
 * 🔴 ALL OR NOTHING. `sink` is the host's mutation surface:
 *   { drain(consumed), credit(row), morale(d), hope(d), migrate(citizens),
 *     prestige(value), markSettled(eventId) }
 * Every method may throw or return false. Anything the sink does not implement
 * is simply skipped (and skipped on the way back out too), so a host can adopt
 * this incrementally without ever risking a half-applied settlement.
 *
 * 🔴 …AND THAT SENTENCE USED TO BE A LIE FOR TWO OF THEM. `drain` and `credit`
 *   have NO usable negation fallback — the r9 fallbacks were literally
 *   `() => {}`, and `failedInverses` only counts inverses that THROW, so a
 *   no-op was invisible. Measured: a sink with `drain` but no `undrain`
 *   reported `rolledBack=7, failedInverses=0` — a fully clean unwind — over a
 *   settlement that had drained the larder and left six ledger rows standing,
 *   three of them payouts to other players. `stadium.city.js` happens to supply
 *   both inverses, which is the only reason the shipped host was ever safe.
 *   REQUIRE_INVERSE names the ops whose forward move cannot be undone by
 *   negation; `run()` now refuses the whole settlement up front rather than
 *   discovering it half way through. Refusing to start is the only honest
 *   answer: an unwind that cannot unwind is worse than never applying.
 *
 * ⚠ INVERSES: `un<name>` is used when the sink provides one, and it is ALWAYS
 *   the better answer. The built-in fallback re-calls the same method with a
 *   negated argument, which is only exact for an unclamped accumulator — a
 *   morale that saturated at 100 on the way in does NOT come back to where it
 *   started when you subtract the same delta. Hosts that clamp (and node-city
 *   clamps morale and hope to 0-100) must supply `unmorale`/`unhope`, and
 *   stadium.city.js does: it snapshots the exact prior value and restores it.
 */
/* Ops whose inverse CANNOT be synthesised by negation: un-draining is not
   "drain a negative amount" and un-crediting is not "credit a negative amount"
   into an append-only ledger. A sink that implements the forward half of one of
   these and not the `un` half cannot be rolled back, and must not be run. */
const REQUIRE_INVERSE = ['drain', 'credit'];

export function commitSettlement(plan, sink) {
  if (!plan || plan.ok === false) return { ok: false, applied: 0, error: 'no plan' };
  const S = sink || {};
  /* Checked BEFORE anything is applied, so the refusal costs nothing. */
  for (const name of REQUIRE_INVERSE) {
    if (typeof S[name] === 'function' && typeof S['un' + name] !== 'function') {
      return { ok: false, applied: 0, rolledBack: 0, failedInverses: 0,
               error: 'sink implements ' + name + ' but not un' + name
                      + ' — settlement could not be rolled back, so it was not started' };
    }
  }
  const journal = [];
  const run = (name, fwd, back) => {
    if (typeof S[name] !== 'function') return true;
    const r = fwd();
    if (r === false) throw new Error('sink.' + name + ' refused');
    const un = S['un' + name];
    journal.push({ name, back: typeof un === 'function' ? back.un : back.fallback });
    return true;
  };
  try {
    /* The `fallback` arms below are unreachable — REQUIRE_INVERSE has already
       refused a sink that would need them. They throw rather than no-op so that
       if that guard is ever weakened, `failedInverses` counts it instead of
       silently reporting a clean unwind over a dirty city. */
    run('drain', () => S.drain(plan.drain),
        { un: () => S.undrain(plan.drain), fallback: () => { throw new Error('no undrain'); } });
    for (const r of plan.ledger) {
      /* Captured per row so the inverse names the exact row, not the loop var. */
      const row = r;
      run('credit', () => S.credit(row),
          { un: () => S.uncredit(row), fallback: () => { throw new Error('no uncredit'); } });
    }
    run('morale', () => S.morale(plan.deltas.morale, plan.deltas.expiryDays),
        { un: () => S.unmorale(plan.deltas.morale), fallback: () => S.morale(-plan.deltas.morale, plan.deltas.expiryDays) });
    run('hope', () => S.hope(plan.deltas.hope, plan.deltas.expiryDays),
        { un: () => S.unhope(plan.deltas.hope), fallback: () => S.hope(-plan.deltas.hope, plan.deltas.expiryDays) });
    run('migrate', () => S.migrate(plan.migration.citizens),
        { un: () => S.unmigrate(plan.migration.citizens), fallback: () => S.migrate(-plan.migration.citizens) });
    run('prestige', () => S.prestige(plan.prestige.after, plan),
        { un: () => S.unprestige(plan), fallback: () => S.prestige(plan.prestige.before, plan) });
    run('markSettled', () => S.markSettled(plan.eventId, plan),
        { un: () => S.unmarkSettled(plan), fallback: () => S.markSettled(null, plan) });
    return { ok: true, applied: journal.length, rolledBack: 0 };
  } catch (err) {
    /* Unwind in reverse. An inverse that itself throws is swallowed — we are
       already failing and the alternative is to abandon the remaining
       inverses, which is precisely the partial state this exists to prevent.
       `failedInverses` is reported so it is never silent. */
    let failedInverses = 0;
    for (let i = journal.length - 1; i >= 0; i--) {
      try { journal[i].back(); } catch (e) { failedInverses++; }
    }
    return { ok: false, applied: 0, rolledBack: journal.length, failedInverses,
             error: (err && err.message) || String(err) };
  }
}

/* ══ SELF-CHECK — numbers the design pack asserts, checkable in one call ══
   Not a test framework; a function a harness (or a console) can call to get
   the pack's own claims back as measured values. If one of these drifts, the
   piece has been retuned out from under its own design. */
export function econSelfCheck(E = STADIUM_ECON) {
  const seats = E.seats[2];                                     // 8,000
  const d = concessionDemand(seats, 1, E);
  const canneryPerCycle = E.readiness.canneryRationsPerMin * E.cycleMinutes;   // node-city cannery gen
  const byTier = {};
  for (const id of TIER_IDS) byTier[id] = Math.round(seats * E.tiers[id].share);
  const tr = ticketRevenue({}, byTier, E);
  return {
    seatsL3: seats,
    concessionRations: d.rations,
    canneryOneCycle: +canneryPerCycle.toFixed(1),
    concessionExceedsOneCycle: d.rations > canneryPerCycle,
    exceedsBy: +(d.rations / canneryPerCycle).toFixed(2),
    crossoverAttendance: Math.ceil(canneryPerCycle / E.concession.perAttendee.rations),
    ticketGrossDoc: tr.gross,
    ticketGrossCinder: tr.cinder,
    boxShareOfRevenue: +(tr.byTier.box / tr.gross).toFixed(3),
    buildCostL3Cinder: toCinder(E.costDoc[2], E),
    eventsToPayBackL3: +(toCinder(E.costDoc[2], E) / Math.max(1, tr.cinder)).toFixed(2),
    badEventMoraleAt20: satisfactionEffects(20, E).moraleDelta,
    goodEventMoraleAt90: satisfactionEffects(90, E).moraleDelta,
    refundAt34: satisfactionEffects(34, E).refundPct,
    refundAt36: satisfactionEffects(36, E).refundPct,
    /* 🔴 THE CENTRAL INVARIANT, checkable in one call: the BEST an unprepared
       event can possibly do — a flawless city that serves the crowd nothing —
       must still be a disaster. If any of these four flips, the prep phase has
       been tuned back out of the game. */
    unpreparedFloor: (() => {
      const perfect = { security: 100, health: 100, powerRatio: 1 };
      const s = eventSatisfaction({ headlinerPower: E.satisfaction.matchCardPowerFull, headlinerName: 'x' },
                                  perfect, { ratio: 0, short: ['rations'] }, 1000, { transit: 1e6 }, E);
      const f = satisfactionEffects(s.score, E);
      return { score: s.score, morale: f.moraleDelta, refundPct: f.refundPct,
               revenueMult: f.revenueMult,
               incidents: eventIncidents(s.score, 1000, E),
               moraleIsNegative: f.moraleDelta < 0,
               refundsFire: f.refundPct > 0,
               incidentsFire: eventIncidents(s.score, 1000, E) > 0,
               revenueIsPunished: f.revenueMult < 1 };
    })(),
    /* And the draw is charged for whether or not the crowd was served. */
    unpreparedStillEatsStock: concessionFulfilment({ rations: 100, water: 100 },
                                                   { rations: 100, water: 0 }, E).consumed.rations === 100,
  };
}

export default {
  STADIUM_ECON, CONC_ICO, CONC_NAME,
  toCinder, stadiumSeats, stadiumAttendanceCap, crowdInterest,
  nodeResidents, regionResidents, computeAttendance, clampTicketPricing, eventPrices,
  ticketDemandMultiplier, ticketRevenue, concessionDemand, concessionFulfilment,
  tierSpendFactor, concessionRevenue, applyEventDrain, eventSatisfaction,
  satisfactionEffects, eventIncidents, stadiumPrestige, spilloverTargets,
  distanceFalloff, applySpillover, collectVendorFees, computeMigration,
  eventReadiness, assertReadinessContract, nodeStockView, settleEvent,
  commitSettlement, econSelfCheck,
};
