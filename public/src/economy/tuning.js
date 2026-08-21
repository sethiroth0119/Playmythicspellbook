/* ════════════════════════════════════════════════════════════════════════════
   🎛 ECON — THE ONE TUNING TABLE FOR THE LIVING ECONOMY.
   ----------------------------------------------------------------------------
   CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." This file is that path for the city economy, exactly as
   /src/city/terroir.js is that path for terroir. Every number the simulation
   uses is HERE. Callers ask; they never carry a copy, and render code never
   holds a literal — if a panel prints a rate, it prints the one the tick used.

   🔴 THE FAUCET RULE — READ THIS BEFORE ADDING A SINGLE NUMBER.
   node-city retired the Cinder Forge because it MINTED currency: fuel + metal
   went in, Cinder came out, and no customer was ever on the other side. One
   player reached ~16,000,000 🔥/day through it. The comment left in
   node-city/index.html is unambiguous:

       "Cinder is now only made the way a real economy makes it — by SELLING
        something to somebody (gas station, arena, shop, club)."

   This simulation therefore runs a CLOSED LOOP. Wages, shopping, supplier
   payments, rent, loan interest and taxes all move Cinder BETWEEN internal
   accounts (firms ⇄ households ⇄ city treasury ⇄ banks). The sum of those
   accounts is invariant across a tick except at two audited seams:

     • THE FAUCET — `externalSalesPerMin`, Cinder entering from OUTSIDE the
       city (exports to other cities, visitors, SCP contracts). Bounded by
       `faucet.maxPerMin` and by real export volume. Never free.
     • THE DRAIN — `taxPayoutRate`, the share of city treasury the player may
       actually withdraw to their wallet, paid through the EXISTING bridge
       path. Everything else stays inside the simulation.

   sim.js asserts the invariant every tick (`audit()`), and a breach disables
   the payout rather than paying it. A simulation that cannot prove where its
   money came from does not get to pay any out.
   ════════════════════════════════════════════════════════════════════════════ */

export const ECON = {
  /* ── ⏱ CLOCK ──────────────────────────────────────────────────────────────
     The city already ticks on `dtMin` (real minutes) in economyTick. The
     economy runs on the SAME clock — a second clock would drift and the two
     panels would disagree about how long a day is.
     `dayMin` is how many real minutes make one economic day: wages are paid,
     rent is charged and loan interest accrues per economic day. */
  clock: {
    dayMin: 20,              // 20 real minutes = 1 economic day
    maxCatchUpDays: 3,       // offline catch-up ceiling. See sim.advance().
    /* ⚠ Catch-up is CAPPED, and low, on purpose. The idle contract elsewhere in
       this game is 36h (OP_ACCRUAL_CAP_H). Letting a closed-loop economy fast
       forward 36 hours in one frame does not just pay more — it runs 108
       economic days of compounding bankruptcy, price drift and population
       change in a single tick, and the player opens the tab to a dead city
       they never saw die. Three days is enough to feel continuous and short
       enough that the state on screen is one the player can still recognise. */
  },

  /* ── 👷 LABOUR ────────────────────────────────────────────────────────────
     Wages are per worker per economic day, by skill band. These are the ONLY
     wage numbers in the codebase; firms.js multiplies them by headcount and
     by the firm's wage policy, and nothing else invents a wage.

     Bands exist because "NPCs need jobs" is not one job. A grocery clerk and a
     reality-stabilisation technician cannot draw the same wage or the advanced
     industries are free to staff and the whole late game is trivially
     profitable. */
  labor: {
    bands: {
      unskilled: { wage: 42,  label: 'Unskilled', ico: '🧹' },
      skilled:   { wage: 96,  label: 'Skilled',   ico: '🔧' },
      technical: { wage: 210, label: 'Technical', ico: '🔬' },
      advanced:  { wage: 520, label: 'Advanced',  ico: '🧬' },
    },
    /* Fraction of a firm's posted jobs that go unfilled when the city's labour
       pool is short. Firms bid against each other: the highest-wage band fills
       first, which is why a city with one Anomaly Lab and no housing sees its
       restaurants lose staff. */
    fillOrder: ['advanced', 'technical', 'skilled', 'unskilled'],
    /* 📉 The wage a firm pays when it cannot afford the full bill. It pays what
       it has, pro rata, and the shortfall becomes MISSED WAGES — which is what
       actually drives morale down and starts the recession loop. */
    minWagePct: 0.35,        // below this a worker quits rather than stays
    quitChancePerDay: 0.22,  // ...at this rate
    /* Unemployment benefit, paid by the city treasury. This is the automatic
       stabiliser: without it a recession has no floor and every city that dips
       dies. With it, a downturn is survivable and the player watches their
       treasury drain — which is the interesting version. */
    benefitPct: 0.30,        // of the unskilled wage
  },

  /* ── 🏠 HOUSEHOLDS ────────────────────────────────────────────────────────
     What a resident does with the Cinder they earned. Shares of DISPOSABLE
     income (income minus tax minus rent), and they sum to ≤ 1 — the remainder
     is saved, which is what lets households ride out a short downturn instead
     of collapsing on the first missed payday.

     🔴 THE CATEGORY LIST IS THE ANNOUNCEMENT'S LIST, IN ITS ORDER. Housing,
     food, utilities, transport, healthcare, clothing, electronics, restaurants,
     entertainment, cards, luxury. Each maps to real resources in demand.js —
     a category with no resource behind it is a happiness bar with extra steps,
     which is precisely what this update exists to stop being. */
  household: {
    savingsRate: 0.12,
    /* Rent is charged BEFORE the basket, because a household that cannot make
       rent is a different problem from one that cannot buy electronics. */
    rentPctOfIncome: 0.28,
    /* When savings run dry the basket is cut in this order — luxuries first,
       food last. Nobody stops eating to keep their card habit. */
    cutOrder: ['luxury', 'cards', 'entertainment', 'restaurants', 'electronics',
               'clothing', 'transport', 'healthcare', 'utilities', 'food'],
    /* 🍞 SUBSISTENCE — the demand floor, in units per resident per economic day.
       ----------------------------------------------------------------------
       🔴 WITHOUT THIS THE ECONOMY DEFLATION-TRAPS AND CANNOT ESCAPE.
       Households only spend Cinder they were paid (households.js's invariant,
       and it is the right one). But firms size their crews to demand, so a city
       that dips has: no wages → no spending → no orders → no hiring → no wages.
       A 200-day run fell into exactly that and sat at 100% unemployment with a
       perfectly balanced ledger. Every account was correct and the city was
       dead.

       People eat whether or not they were paid this week. Subsistence is
       demand that exists because the population exists, so there are always
       orders on the books for the basics and the loop can restart. What a
       household cannot pay for is covered by benefits and municipal spending —
       both already modelled, both bounded by the treasury.

       ⚠ DERIVED FROM node-city's `DEMAND_PER_POP`, NOT INVENTED.
         That table is per-POP-per-MINUTE (food 0.100, water 0.075, power
         0.0625) and is the city's existing, tuned answer to "how much does one
         resident consume". These are the same numbers × `clock.dayMin`, so the
         economy and the city's own vitals panel can never disagree about how
         hungry a citizen is. If DEMAND_PER_POP is retuned, retune these with it. */
    subsistence: {
      bread:        2.00,       // = DEMAND_PER_POP.food  (0.100/min) × dayMin (20)
      freshWater:   1.50,       // = DEMAND_PER_POP.water (0.075/min) × dayMin
      electricity:  1.25,       // = DEMAND_PER_POP.power (0.0625/min) × dayMin
      /* Below subsistence proper, but a population always generates some floor
         of demand for these — they are what a resident replaces, not stockpiles. */
      medicine:     0.05,
      clothing:     0.04,
      preparedMeals:0.30,
    },

    /* Elasticity: how much demand falls per 1% price rise, per category.
       Food is inelastic (0.2 — people buy it anyway), luxury is elastic (1.6 —
       they simply stop). This is what makes a supply shock propagate into
       revenue instead of just changing a number. */
    elasticity: {
      housing: 0.15, food: 0.20, utilities: 0.25, transport: 0.55,
      healthcare: 0.20, clothing: 0.80, electronics: 1.10, restaurants: 1.25,
      entertainment: 1.35, cards: 1.45, luxury: 1.60,
    },
  },

  /* ── 👥 DEMOGRAPHICS ──────────────────────────────────────────────────────
     WHO lives in the city, and WHY they chose to. Read by /src/demographics.

     🔴 THE FEATURE IN ONE SENTENCE: the same tile count zoned differently gives
     a different population AND a different city, because a zone decides how
     many DWELLINGS stand on a tile and which HOUSEHOLDS want one. Low-density
     detached housing is one big family per tile; a tower is fourteen small
     households on the same square. That is the whole of `zones` below.

     🔴 NOTHING IN THIS GROUP MOVES A SINGLE CINDER, AND THAT IS STRUCTURAL.
     `rent` here is an AFFORDABILITY INDEX — the question "could this household
     pay to live in that zone", asked before they move in. The only rent that
     ever debits anybody is `HH.chargeRent()`, which is inside sim.js's audited
     day. A second rent that actually charged would be a fifth leak of exactly
     the shape ECONOMY.md documents four of, and every one of those looked
     correct in review. Demographics decides WHO; the economy decides WHOSE
     MONEY MOVES, and they meet only at headcount. */
  demographics: {
    on: 1,

    /* 🎓 EDUCATION → WHICH JOBS A CITIZEN MAY HOLD.
       The ladder is the labour bands' ladder, one rung each, so a resident is
       qualified for their own band AND every band below it — an overqualified
       person takes a lesser job when there is nothing better, which is what
       makes "graduates stacking shelves" a readable state rather than an
       unemployment number. The reverse is refused: no amount of demand lets a
       school-leaver run a reality-stabilisation line, which is the feedback
       that makes zoning a decision (zone only low-rent housing and the advanced
       industries stay unstaffed however many people arrive). */
    education: {
      order: ['none', 'school', 'college', 'university'],
      levels: {
        none:       { label: 'No schooling', short: 'None',    ico: '📕', band: 'unskilled' },
        school:     { label: 'Schooled',     short: 'School',  ico: '📗', band: 'skilled' },
        college:    { label: 'College',      short: 'College', ico: '📘', band: 'technical' },
        university: { label: 'University',   short: 'Uni',     ico: '🎓', band: 'advanced' },
      },
      /* The minimum education a band's jobs demand. Mirrors `levels[*].band`
         from the other side; both are read, neither is derived, because a
         future band with no education of its own must still be answerable. */
      requires: { unskilled: 'none', skilled: 'school', technical: 'college', advanced: 'university' },
      /* 🎒 …AND EDUCATION IS NOT FIXED AT BIRTH. A student household graduates
         at this rate per economic day and its members move UP one rung, which
         is why low-rent housing is not a dead end: it is where a city's future
         skilled labour lives while it is still cheap.
         ⚠ 0.012 ≈ 83 economic days ≈ 28 real hours of play for a cohort to turn
           over. It was 0.020 and that was measurably too fast: a low-rent
           district emptied of students in 60 simulated days and read as a
           district of singles, which is the wrong CITY, not just the wrong
           number — the whole point of low-rent zoning is that students are
           what it holds. */
      graduatePerDay: 0.012,
    },

    /* ── 🔁 TENANCY TURNOVER — WHY A STUDENT DISTRICT STAYS A STUDENT DISTRICT
       Share of a zone's OCCUPIED dwellings whose tenancy ends per economic day,
       for reasons that are not economic distress: the lease ran out, the flat
       was always temporary, the job was in another city. The dwelling is re-let
       the same step from the zone's own bag, so this does not empty a district —
       it REFRESHES it.

       🔴 THIS IS THE FIX FOR A MEASURED, SEVERE BUG, AND IT IS STRUCTURAL.
       Before it existed the only ways out of a dwelling were eviction, economic
       distress, and — for students alone — graduation, which converted the
       household to `single` IN PLACE. So every zone was a RATCHET: once it
       filled, the only composition change left was students turning into
       singles, one way, forever. Measured on the 172-tile gauntlet district, a
       low-rent block peaked at 80 student households on day 3 and then decayed
       80 → 56 → 39 → 27 → 19 → 13 → 9 while singles climbed to 282. The student
       share ratcheted toward ~1% of residents and could never recover, because
       new students can only arrive into a VACANCY and there were none.
       ECON.demographics.zones[*].bag says a low-rent block is 47% students; the
       district it actually produced was 1%, so the bag was a decoration.

       With turnover, out_i = τ·n_i and in_i = τ·N·bag_i for every archetype, so
       a zone's composition CONVERGES ON ITS OWN BAG instead of ratcheting away
       from it. Students settle at τ/(τ+graduatePerDay) of their bag share —
       ~35% of a low-rent block's households — because the room a graduate frees
       is taken by the next student. That is what a student district is.

       ⚠ REJECTED: making graduates leave the city instead (`graduateMovesOut`).
         It frees the room, but the refill is bag-weighted, so ~53% of the freed
         rooms go to non-students who then sit there forever and the ratchet just
         runs slower: dS/dt = −S·g·(1−f_stu) still decays to zero. The defect was
         never about students specifically — it was that NOTHING ever moved out
         of a full district. Turnover is the general answer and the student case
         falls out of it.
       ⚠ REJECTED: a uniform city-wide churn rate. Turnover is a property of the
         HOUSING, not of the city: a cheap flat turns over most of a year, a
         detached house people bought turns over once a generation. A single rate
         would have made a suburb as transient as a student block, which is the
         opposite of what the zones are for.

       🔢 Read them as annual turnover — an economic year is ~24 economic days
       (graduatePerDay's 83 days ≈ a 3.5-year degree), so 0.035/day ≈ 84%/yr for
       cheap flats and 0.004/day ≈ 10%/yr for detached houses. Both are close to
       the real figures for those tenures, which is why they were chosen there
       and not by feel. Turnover creates real vacancy — steady-state occupancy is
       0.30·att/(τ + 0.30·att), so these are also the numbers that decide a
       district's standing vacancy rate. Above ~0.05 a district cannot re-let
       fast enough and starts to hollow out. */
    turnover: {
      resLow: 0.004, resRow: 0.010, resApt: 0.020,
      resHigh: 0.028, resMixed: 0.024, resLowRent: 0.035,
      /* A zone with no entry above churns at this rate. Never 0: a zone that
         never turns over is a zone whose bag stops meaning anything the moment
         it fills, which is the bug this whole block exists to retire. */
      dflt: 0.015,
    },

    /* ── 🧬 THE LIFE COURSE — where a city's pensioners actually come from ────
       🔴 THIS RETIRES THE ALL-RETIRED ATTRACTOR, AND IT IS THE ROOT CAUSE, NOT
       A CAP. Measured before it existed: a job-poor tower district went
       20 family / 81 couple / 100 single / 27 retired on day 2, then
       2 / 7 / 8 / 393 on day 3, then 0 / 0 / 0 / 578 from day 5 ONWARD, with a
       labour ladder of 0/0/0/0 and 868 people in it. Reproduced against the real
       pipeline in Node: 158 retired of 259 households on day 0, 558 of 561 by
       day 39. A player's reward for zoning a big city was a dead one, because
       zoning dense housing is exactly what makes a city job-poor.

       The mechanism was an ABSORBING STATE, and it needed only two ordinary-
       looking lines to exist:
         · arrivals exempted pensioners from the job gate — correct in itself, a
           retired household genuinely does not need a vacancy — so once job fit
           approached zero they were the ONLY archetype that could still move in;
         · departures charged jobless stress to EVERY cohort, including the one
           with no workers in it, which cannot be jobless by definition.
       Workers left, pensioners never did, and only pensioners could arrive. Any
       inflow into a state with no outflow converges on 100% of the system. That
       is the whole bug in one sentence, and it is why the fix has to be an
       OUTFLOW rather than a limit on the inflow.

       ⚠ REJECTED: exempting pensioners from departures too. It is the obvious
         reading of "a pensioner is not jobless", and on its own it makes the
         ratchet STRICTLY WORSE — they would then be immortal as well as
         unlimited. The jobless-stress exemption below is only safe BECAUSE
         `retiredLeavePerDay` gives the state a door.
       ⚠ REJECTED: capping retired households at some share of the city. It hides
         the attractor without removing it — the pressure is still there, pinned
         against a clamp, and the next person to touch the arrival scorer
         reintroduces it with the clamp still in the file looking deliberate.
       ⚠ REJECTED: gating pensioners on vacancies like everybody else. That is
         simply false. A retired household is limited by rent it can pay out of a
         fixed pension, by services, and by there being a FINITE SUPPLY OF
         PENSIONERS — never by whether the city posted a job.

       So: pensioners are MADE, not moved. `agePerDay` is the domestic source —
       working households ageing out of the labour force — and it is the finite
       supply the arrival meter below is measured against. A city with no working
       households produces no new pensioners and attracts none, so the attractor
       cannot form at all rather than being caught after it forms.

       🔢 At ~24 economic days to the year, agePerDay 0.0008 ≈ a 52-year working
       life and retiredLeavePerDay 0.004 ≈ 10 years of retirement. Their RATIO is
       the number that matters: retired households settle at agePerDay /
       retiredLeavePerDay ≈ 20% of working households, and since a retired
       household is small (1.5 heads against ~2.5), that is ~14% of residents —
       a real city's senior share, arrived at from two rates rather than picked.
       ⚠ `family` is deliberately NOT in `ages`. A family becoming a couple when
         its children move out is a real life event, but it is the SAME event the
         `student` and `single` arrival draws already represent from the other
         end; modelling both would count one household leaving home twice. */
    lifecycle: {
      agePerDay: 0.0008,
      ages: { couple: 'retired', single: 'retired' },
      retiredLeavePerDay: 0.004,
    },

    /* 🏘 THE ZONES. `homes` is DWELLINGS on one tile at level 1, `perLevel` what
       each further level adds. `rentMul` multiplies the rent index below.
       `bag` is the weighted draw of household archetypes that WANT that zone —
       not a filter: a family can live in a tower, it is simply not what towers
       mostly fill up with.
       ⚠ ids are this module's vocabulary. /src/zoning may name its zones
         anything it likes; zones.js aliases them onto these six. */
    /* 🔴 `eduTilt` IS THE HALF THAT MAKES ZONING A DECISION RATHER THAN A LOOK.
       Without it every zone drew the same education mix — its BAG changed which
       archetypes arrived, but a `single` was equally likely to be a graduate in
       a low-rent block and in a penthouse, so a city of nothing but low-rent
       housing still staffed its research labs and the whole education→jobs
       feedback did nothing. Measured on the tree before this existed: a 10-tile
       all-low-rent city produced 18 university-educated residents and filled
       every advanced vacancy it was offered.
       It multiplies the ARCHETYPE's own education weights, so it tilts a draw
       rather than replacing it: a low-rent district still turns out the
       occasional graduate, it just does not turn out a workforce of them. */
    zones: {
      resLow:     { name: 'Low Density Housing', short: 'Low Density', ico: '🏡',
                    homes: 1,  perLevel: 0.5, rentMul: 2.20,
                    bag: { family: 7, couple: 3, retired: 2, single: 1, student: 0 },
                    eduTilt: { none: 0.45, school: 0.9, college: 1.35, university: 1.7 },
                    desc: 'Detached houses on their own plots. Few, large, wealthy households.' },
      resRow:     { name: 'Row Housing', short: 'Row Housing', ico: '🏘️',
                    homes: 3,  perLevel: 1.2, rentMul: 1.35,
                    bag: { family: 4, couple: 4, single: 2, retired: 2, student: 1 },
                    eduTilt: { none: 0.8, school: 1.05, college: 1.1, university: 1.0 },
                    desc: 'Wall-to-wall terraces. Mid-size households at mid rents.' },
      resApt:     { name: 'Apartments', short: 'Apartments', ico: '🏢',
                    homes: 6,  perLevel: 2.5, rentMul: 0.95,
                    bag: { couple: 4, single: 4, family: 2, student: 2, retired: 2 },
                    eduTilt: { none: 1, school: 1, college: 1, university: 1 },
                    desc: 'Medium-density blocks. The city\'s ordinary middle.' },
      resHigh:    { name: 'High Density Towers', short: 'Towers', ico: '🏙️',
                    homes: 14, perLevel: 6, rentMul: 0.72,
                    bag: { single: 6, couple: 4, student: 3, family: 1, retired: 1 },
                    eduTilt: { none: 0.85, school: 1, college: 1.2, university: 1.25 },
                    desc: 'Many small households on one square. Upkeep is split so many ways that the rent is low.' },
      resMixed:   { name: 'Mixed Use', short: 'Mixed', ico: '🏬',
                    homes: 5,  perLevel: 2, rentMul: 1.10,
                    bag: { single: 4, couple: 4, student: 3, retired: 2, family: 1 },
                    eduTilt: { none: 0.8, school: 1, college: 1.25, university: 1.3 },
                    desc: 'Retail below, homes above. The city-centre demographic.' },
      resLowRent: { name: 'Low Rent Housing', short: 'Low Rent', ico: '🏚️',
                    homes: 8,  perLevel: 3, rentMul: 0.50,
                    bag: { student: 7, single: 4, retired: 2, couple: 1, family: 1 },
                    eduTilt: { none: 1.8, school: 1.25, college: 0.5, university: 0.18 },
                    desc: 'Cheap first apartments. Students and young adults who have just left home.' },
    },

    /* 👨‍👩‍👧 THE ARCHETYPES. `size` is a DISTRIBUTION — [people, weight] — not an
       average, because a street of identical households is the thing this
       feature exists to stop being. `workers` is adults in the labour force per
       household; `edu` and `wealth` are weighted draws; `ages` splits the
       household's heads across the four age bands and must sum to 1. */
    archetypes: {
      family:  { name: 'Families', ico: '👨‍👩‍👧', workers: 2,
                 size: [[3, 4], [4, 5], [5, 2], [6, 1]],
                 edu: { none: 1, school: 4, college: 4, university: 2 },
                 /* ⚠ THE WEALTH WEIGHTS ARE DELIBERATELY POOR AT THE TOP. They
                    decide which of households.js's three tiers an ARRIVAL joins,
                    and the high tier weights its consumption basket 2.4× and its
                    luxury 3.2× — so a generous draw here does not read as a
                    nicer city, it reads as an economy with demand nobody earned.
                    The first cut gave a 63-resident starter town 24 well-off
                    residents (38%). This is the retune. */
                 wealth: { low: 3, mid: 5, high: 1.6 },
                 ages: { child: 0.44, young: 0.03, adult: 0.51, senior: 0.02 },
                 desc: 'Two earners and children. Fewer households per tile, and the cost of living is split across fewer of them — so a low-density street reads wealthy.' },
      couple:  { name: 'Couples', ico: '👫', workers: 2,
                 size: [[2, 8], [3, 2]],
                 edu: { none: 1, school: 4, college: 4, university: 3 },
                 wealth: { low: 4, mid: 6, high: 1.2 },
                 ages: { child: 0.05, young: 0.28, adult: 0.63, senior: 0.04 },
                 desc: 'Two earners, no dependants. The most mobile households in the city.' },
      single:  { name: 'Singles', ico: '🧍', workers: 1,
                 size: [[1, 9], [2, 1]],
                 edu: { none: 2, school: 5, college: 3, university: 2 },
                 wealth: { low: 6, mid: 4, high: 0.6 },
                 ages: { child: 0, young: 0.42, adult: 0.52, senior: 0.06 },
                 desc: 'One earner carrying one rent. Densest per square metre and the first to leave when work dries up.' },
      student: { name: 'Students & Young Adults', ico: '🎒', workers: 1,
                 size: [[1, 4], [2, 3], [3, 2], [4, 1]],
                 edu: { none: 0, school: 7, college: 3, university: 0 },
                 wealth: { low: 9, mid: 1, high: 0 },
                 ages: { child: 0, young: 1, adult: 0, senior: 0 },
                 inSchool: 1,
                 desc: 'Moved out of their parents\' home into a first apartment. Small households, low wealth, and an education still in progress.' },
      retired: { name: 'Retired', ico: '🧓', workers: 0,
                 size: [[1, 5], [2, 5]],
                 edu: { none: 3, school: 4, college: 2, university: 1 },
                 wealth: { low: 5, mid: 4, high: 0.7 },
                 ages: { child: 0, young: 0, adult: 0, senior: 1 },
                 desc: 'Out of the labour force. They consume, they pay rent, and they never fill a vacancy.' },
    },
    ages: {
      child:  { label: 'Children', ico: '🧒' },
      young:  { label: 'Young adults', ico: '🧑' },
      adult:  { label: 'Adults', ico: '🧔' },
      senior: { label: 'Seniors', ico: '🧓' },
    },

    /* 💸 THE RENT INDEX — an affordability signal, never a transfer (see the
       header). `baseDaysOfWage` prices a rentMul-1.0 dwelling as a share of one
       unskilled day's wage, deliberately equal to `household.rentPctOfIncome`
       so the two halves of "rent" cannot drift apart in meaning even though
       only one of them moves money. `tightnessK` is the market: a city with no
       vacancies is an expensive city, which is what stops a player solving
       housing once and never thinking about it again. */
    rent: {
      baseDaysOfWage: 0.28,
      tightnessK: 0.90, maxTightness: 2.2,
      burdenMax: 0.55,        // a would-be arrival refuses a home above this share of income
      burdenLeave: 0.78,      // …and a sitting household starts looking elsewhere above this
    },

    /* 🚚 ARRIVALS. A fraction of the VACANT dwellings of a zone fill per
       economic day, scaled by how attractive the city is to the households that
       zone draws. Not a flat immigration number: people arrive because
       something attracted them, and the three weights are what.
       `minAttract` keeps a dying city from freezing solid — somebody always
       moves in — while being small enough that it cannot repopulate one. */
    arrival: {
      ratePerDay: 0.30,
      minAttract: 0.03,
      weight: { jobs: 0.50, rent: 0.32, services: 0.18 },
      /* Jobs, as seen by a household: what share of this band's seekers find
         work. Below this the band is read as "no work here" outright. */
      jobFloor: 0.05,
      /* An existing save (or any first mount) is SEEDED at this share of what
         its zoning can hold, because the people were already living there — a
         lived city must not empty itself and refill over twenty simulated days
         the first time this module loads. */
      seedFill: 0.85,

      /* 🧓 …AND THE OTHER HALF OF THE ALL-RETIRED FIX (see `lifecycle` above).
         Households with NO WORKERS skip the job gate, because they genuinely do
         not need a vacancy. What was missing is that nothing else limited them,
         so in a job-poor city they took every dwelling that came free.

         The honest limit is that there are only so many pensioners looking to
         move, and the ones who do move follow the working city — you retire to
         where your family lives and works, not to an empty district. So the
         workerless arrival stream is metered against the city's WORKING
         households: this many workerless households per working household per
         economic day, across the whole city, however many dwellings stand empty.

         🔴 THIS IS A RATE, NOT A CAP. It gives retired households a stationary
         share (inflow / `retiredLeavePerDay`) exactly like every other cohort
         has, and it collapses to zero on its own in a city whose workers have
         gone — which is the case that used to lock. A cap would have left the
         pressure intact behind a clamp.
         🔢 0.0002/day adds ~5% of working households to the retired stock at
         equilibrium, on top of the ~20% `lifecycle` makes domestically. Most of
         a city's pensioners lived there already; this is the minority who move,
         and it is sized to read as one. */
      workerlessDrawPerWorkerHH: 0.0002,
    },

    /* 🧳 DEPARTURES. A pipeline that only ever adds is a population counter.
       `joblessGraceDays` is how long a household rides out unemployment on
       savings before it goes; `ratePerDay` is how fast the ones who have given
       up actually leave. Eviction (the dwelling itself is gone — demolished or
       re-zoned) is immediate and is not a rate. */
    departure: {
      ratePerDay: 0.09,
      joblessGraceDays: 5,
      /* Below this share of a band's seekers finding work, a household with no
         other qualification starts counting grace days.
         ⚠ AND IT IS CHARGED ONLY TO HOUSEHOLDS THAT HAVE WORKERS IN THEM. It
           used to be charged to every cohort, which meant a retired household —
           zero workers, by definition unjobbable — was pushed out of town by a
           labour market it does not participate in. That was one of the two
           lines that built the all-retired attractor; see ECON.demographics
           .lifecycle for the whole story, including why fixing ONLY this makes
           the attractor worse rather than better. */
      jobPanic: 0.35,
    },

    /* Income a household is assumed to be able to offer for rent, per economic
       day. Wages come from ECON.labor — these are the two groups that are NOT
       on a wage, and inventing a number for them elsewhere would be the same
       duplication the wage table exists to prevent. */
    income: {
      studentPct: 0.38,       // of the unskilled wage, PER STUDENT IN THE SHARE
      studentWorkerPct: 0.50, // …and only half of a student household seeks work at all
      /* 🎓 …AND HOW MUCH OF `studentPct` IS *SUPPORT* RATHER THAN WORK — grants,
         loans, parents. The rest is the part-time shift, and only that part
         moves with the local labour market.
         🔴 THIS SPLIT IS WHY STUDENTS CAN LIVE IN A CITY THAT HAS NO WORK, and
         its absence was half of why student districts stopped being student
         districts. The whole student income used to be multiplied by job fit,
         so in the slack labour market a student district actually has (fit 0.48)
         a student household offered 15.4/day against a low-rent dwelling at
         9.77 — a burden of 0.63, over `rent.burdenMax`, so students were blocked
         from THE CHEAPEST ZONE IN THE CITY and the resLowRent bag's student
         weight of 7 delivered literally 0% of arrivals. Measured.
         ⚠ The file already knew this idea and had only applied it to the other
           end of life: `incomeOf` adds the pension with no `fit` on it at all,
           because "retired heads draw a pension whatever the labour market is
           doing". Student maintenance is the same kind of money. Real student
           towns are counter-cyclical for exactly this reason. */
      studentSupportShare: 0.55,
      pensionPct: 0.42,       // of the unskilled wage, per retired head
      /* An arriving household is assumed to hold at least this fraction of a
         full wage even in a slack labour market — nobody moves to a city on the
         promise of literally zero income, but they do move on a part-time one. */
      floorPct: 0.25,
    },

    /* 💰 HOW FAR EDUCATION MOVES A HOUSEHOLD UP THE WEALTH TIERS, per rung of
       ECON.demographics.education.order. Multiplies the archetype's own weights
       — schooling is how a household climbs, which is what makes the graduation
       rate above worth having at all.
       ⚠ THESE LIVE HERE AND NOT IN archetypes.js. They were three literals in
         that file for one round, which is exactly the rule this whole table
         exists to enforce: a wealth coefficient is an economy number, it feeds
         households.js's arrival tier mix, and a copy outside ECON is a copy
         that survives the next retune. */
    wealthLift: { low: -0.16, mid: 0.08, high: 0.30 },

    ui: {
      maxCauses: 5,
      /* A cause has to be MATERIAL or it is noise: some household type is
         turned away from some zone in every city that has ever existed
         (students cannot afford detached houses anywhere), and reporting that
         made a thriving town print "rents are above what arrivals can pay"
         while it filled up. Share of the households that actually looked. */
      materialShare: 0.15,
      /* …and "people are leaving" needs a margin and a smoothed rate, or a
         steady city flickers in and out of it every 4 s repaint. `leavingFloor`
         is the absolute half of that guard: in a city moving one resident a day
         the multiplicative margin is worth 0.15 of a person, which is noise. */
      leavingMargin: 1.15,
      leavingFloor: 0.05,
      /* Vacancy below this share of the city's dwellings reads as full. */
      fullShare: 0.01,

      /* 🗣 THE THRESHOLDS THE CAUSAL LIST SPEAKS AT. These decide what the panel
         SAYS, which is the only thing most players ever read, so they are
         behavioural numbers and they live here with the rest of them.
         ⚠ THEY WERE LITERALS IN pipeline.js FOR TWO ROUNDS. Commit 02ccda2 said
           it had moved "the three numbers that had escaped ECON" and left five
           of them behind — `meanFit > 0.8`, `meanFit < 0.3`, `services > 0.75`,
           `services < 0.4` and `tight > 1.4`, plus a bare `+ 0.05` in the limit
           test. A number that only LOOKS like presentation is still a number
           somebody has to retune, and finding it means grepping a file the
           tuning table exists so nobody has to read. */
      jobsPlentyFit: 0.80,   // above this mean job fit: "+ Work for most people"
      jobsScarceFit: 0.30,   // below it: "− Not enough jobs"
      servicesGood:  0.75,   // above this service satisfaction: "+ keeping up"
      servicesPoor:  0.40,   // below it: "− falling short"
      tightNotice:   1.40,   // rent index above this is worth telling the player about
    },
  },

  /* ── 🏭 FIRMS ─────────────────────────────────────────────────────────────
     A business is not a tile that prints goods. It is a balance sheet.
     `startCash` is seeded at founding and is the buffer between a bad week and
     bankruptcy — the whole "businesses can fail" feature lives in this number
     and in `distress` below. */
  firm: {
    startCashDays: 12,       // days of operating cost, seeded as cash at founding
    /* ── 🏦 THE CHARTER FUND — where that seed cash COMES FROM ───────────────
       🔴 RULE 1, AND IT WAS BROKEN HERE FOR THE WHOLE LIFE OF firms.js.
       `Firms.found()` used to do `f.cash = dailyOperatingCost × startCashDays`
       and debit NOTHING. Because the host founds firms from `syncBuildings`
       (a 4 s setInterval) while sim.js captures the audit's `before` INSIDE
       runDay, every one of those mints happened between audit windows and the
       closed-loop audit never saw a Cinder of it. Measured on the pre-fix tree,
       a city holding all 47 mapped tile types over 240 days minted 721,771 🔥
       at founding (69 foundings — a bankrupt tile-owned firm is RE-founded at
       the next sync, so it is a pump, not a one-off) plus 182,997 🔥 at
       bootstrap, against −6,159 🔥 of audited flow, with a perfectly clean audit
       and payouts still enabled.

       So seed capital now comes out of an ACCOUNT. The charter fund is a real
       balance inside `totalCinder()`; founding is a transfer out of it, and the
       ONLY Cinder ever created for it is issued inside runDay, counted in
       `S.flow.founding`, carried in the audit identity next to the export
       faucet, and capped for the lifetime of the city by `lifetimeCap`.

       ⚠ REJECTED: funding founding straight out of the treasury with no fund.
         The treasury is 0 at bootstrap and households start at 0 savings, so
         every seeded firm would open with no cash, pay no wages, and the city
         would have no money in it at all — the export faucet cannot start an
         economy that has nobody able to buy anything. The mint was load-
         bearing; making it finite and audited is the fix, pretending it was
         never needed is not.
       ⚠ REJECTED: drawing the shortfall from the bank reserve. The reserve is
         the credit capacity behind the DEBT rung (bank.js); spending it as
         equity would quietly defund the ladder that the debt rung round exists
         to keep alive. Treasury is the second source; the reserve is not. */
    /* 🔢 THE NUMBERS ARE MEASURED, NOT PICKED. Scanning 120 cities (60 nodes ×
       2 populations), bootstrap alone asks for a median of 74,600 🔥, 197,000 🔥
       at p90 and 244,000 🔥 at the worst — an unusually rich node seeds 34
       businesses. `seed` therefore has to clear ~250,000 or the FIRST building
       a player puts up on a good node opens with literally nothing (that is not
       hypothetical: at 200,000 it did, and round 0c caught it). Above that the
       fund keeps a working balance for the buildings that follow. */
    charter: {
      seed: 300000,          // 🔥 issued ONCE at bootstrap, before any audit window
      fundTarget: 80000,     // 🔥 the balance the fund is topped back up toward
      maxPerDay: 4000,       // 🔥/day ceiling on issuance, mirroring the faucet's
      /* 🔥 EVERY Cinder this city may ever create as seed capital, for its whole
         life. For scale: the un-audited mint this replaces had reached 904,768 🔥
         in one 240-day city and had no ceiling of any kind — it grew with every
         founding, forever, and a bankrupt tile is re-founded. */
      lifetimeCap: 700000,
      /* How deep FOUNDING AS A WHOLE may dig into the city's own money in one
         window, once the fund is dry. Not 1.0: the treasury also pays benefits,
         imports and freight, and foundings that empty it starve the stabilisers
         and the player's payout with them.

         🔴 PER WINDOW, NOT PER FOUNDING — the distinction is the whole value of
         this number. It was first written as a per-call clamp on the balance
         REMAINING, which reads identically and behaves nothing like it: the
         host founds every new tile in ONE `syncBuildings` pass, so N foundings
         compounded to 1 − 0.65^N of the treasury. Nine tiles in a single sync
         measured 91.15% taken (10,000.00 → 885.39 🔥) — a clamp whose comment
         promised the opposite of what it did. sim.js now computes the allowance
         once per founding window (`armFoundingWindow`) and decrements it, and
         round0e asserts no single sync can beat it. */
      treasuryDrawPct: 0.35,
    },

    /* ── 💼 PRIVATE CAPITAL — the arc that was missing from the circular flow ──
       🔴 THE FINDING THIS ANSWERS. A 34-lot commercial district driven for 600
       economic days re-founded its shopfronts 90 times and, past day 480, every
       one of them opened with NOTHING: `charterIssued` sat pinned at its
       700,000 🔥 lifetime ceiling and `charter` drained to 0, so `fundFounding`
       had one dry account and a treasury holding 72 🔥. Every new business then
       walked the distress ladder from an empty till and died, for ever. The
       ledger row was always the same sentence and it named the wrong cause.

       🔴 AND THE CITY WAS NOT POOR. Measured on that same board at day 600:
       696,048 🔥 in the city, of which 692,528 🔥 was FIRM CASH — 295,636 🔥 in
       one landlord and 218,585 🔥 in one power plant, i.e. 74% of the entire
       money supply sitting in two incumbents' tills. Households held 2,275 🔥
       and the treasury held 72 🔥. The city had 190× the capital a shopfront
       needed and no way to reach it.

       So this is not a shortage of money, it is a MISSING ARROW. Every other
       arc of the circular flow exists — wages, dividends, b2b, rent, tax,
       benefits, upkeep, municipal spending — and the one that does not is
       SAVINGS → NEW BUSINESS. Retained earnings in this model are the residents'
       money parked in a business (that is exactly what `dividendRate` says the
       profit is), so a new business founded in this city is founded out of them.
       It is a transfer between two terms of `totalCinder()` and moves the
       audited total by zero, precisely like the charter draw beside it.

       ⚠ WHY THIS IS DRAWN BEFORE THE CHARTER FUND AND NOT AFTER. The charter
         allowance is finite and irreplaceable — 700,000 🔥 for the entire life
         of a city. Private surplus regenerates every day the city trades.
         Spending the irreplaceable account while the replaceable one is holding
         692,528 🔥 is the whole of the finding above. At bootstrap there IS no
         private surplus (see the floor), so the ordering costs the opening city
         nothing.
       ⚠ REJECTED: raising `lifetimeCap`. It is a number tuned until a symptom
         goes away, it makes the founding mint bigger rather than finite, and it
         would postpone the treadmill by however many days the new ceiling buys
         instead of removing it. The cap is not the fault; the missing arrow is.
       ⚠ REJECTED: giving the investing firm an equity stake with a dividend.
         It is the more realistic instrument, and it needs a shareholder
         register on every firm, in the save, in the audit's sights, for a
         return that already reaches households through `payDividend`. The
         residents own both sides of this transfer; the money never leaves their
         hands, so nothing has to be paid back to make the books honest.
       ⚠ REJECTED: drawing on household savings first. It is where the model
         says the owners are — and on the measured board they held 2,275 🔥
         against a 3,600 🔥 shopfront. Taking it would have funded nothing and
         cut consumption, which is the demand that keeps the shop alive. */
    privateCapital: {
      /* 🔴 THE FLOOR IS THE WHOLE SAFETY ARGUMENT, AND IT IS A FLOOR RATHER
         THAN A PERCENTAGE ON PURPOSE. `treasuryDrawPct` was written as a
         per-call share of the balance REMAINING and `syncBuildings` founds
         every new tile in ONE pass, so N foundings compounded to 1 − 0.65^N —
         nine tiles took 91.15% of the treasury. A FLOOR does not have that
         failure mode: draining N firms down to the same floor N times still
         leaves every one of them standing on the floor.
         30 days of a firm's own operating cost, i.e. 2.5× the 12 days a firm is
         seeded with. A freshly-founded firm is therefore structurally incapable
         of being a source — which is what stops a bootstrap from cannibalising
         itself while it is still seeding its first businesses. */
      floorDays: 30,
      /* ...and it must have EARNED the surplus. `lifetimeProfit > 0` and the
         HEALTHY rung: you may invest money you made and do not need. A firm
         that is merely holding a large seed it has not yet lost is not a saver,
         and a firm on the distress ladder is not lending anybody anything. */
      requireProfit: true,
      /* No single founding may take more than this share of the city's whole
         investable surplus, so the second entrant in the same `syncBuildings`
         pass can always be funded too. A Semiconductor Fab's seed is two orders
         of magnitude above a grocer's; without this one of them arriving first
         decides whether the other exists. */
      maxShareOfPool: 0.5,
    },

    /* ── 🏷 GROUND RENT — what a business pays for the plot it stands on ──────
       "Eventually one FAILS because rent gets too expensive."

       🔴 BEFORE THIS, IT COULD NOT HAPPEN, AND THAT WAS CHECKED RATHER THAN
       ASSUMED: `dailyOperatingCost()` is wages + inputs and nothing else,
       `tax.property` is charged on HOUSEHOLD rent in `runShopping`, and no file
       in /src/economy mentioned `MythicLandValue` at all. Land value decided
       what DEVELOPED on a plot and then never appeared on a balance sheet
       again, so rent could deter a company from opening and could never once
       pressure one that was already there.

       🔴 PRICED OFF THE *PREMIUM*, NOT OFF `valueAt()`, AND THE DIFFERENCE IS
       NOT COSMETIC. /src/landvalue's own tuning header says it: the printed
       value is CITY + LOCAL, the CITY half is `20 + citySync×0.3 +
       decorPoints()` and it is IDENTICAL ON EVERY TILE — which also means it is
       UNBOUNDED, because `decorPoints()` grows with every garden the player
       ever plants anywhere. Renting off that would charge every business in the
       city more because somebody landscaped a park across town, and it would
       climb for ever. The LOCAL premium is the part that describes THIS plot,
       it is the part /src/landvalue takes its own bands on for exactly this
       reason, and it is capped by construction at the sum of that module's
       caps (110 + 60 + 45 + 35 + 25 = 275 at the time of writing). A rent with
       a ceiling is the first of the four brakes doing its job.

       🔢 THE RATE, DERIVED RATHER THAN PICKED. At full premium (275) this is
       60.5 🔥/day. The grocers and restaurants this district is made of run at
       300–330 🔥/day of operating cost, so the very best land the model can
       produce costs a small shop ~19% of its running costs, and an ordinary
       corner at premium 60 costs it 13 🔥/day — about 4%. That is a charge a
       healthy business absorbs and a marginal one cannot, which is the whole
       point of the mechanic; below ~0.1 nothing ever fails of it and above
       ~0.4 nothing survives on good land at all.

       ⚠ FLAT PER PLOT — IT DOES NOT SCALE WITH THE TENANT, and that is the
         mechanism rather than a simplification. A rent that scaled with a
         firm's size or revenue would shrink as the firm failed, and no business
         could ever be pushed under by it; a fixed cost against a variable
         revenue is what operating leverage IS. It does not scale with LEVEL
         either, which gives the answer a real tenant has: build up. The same
         ground spread over more floors is the city's own intensification
         pressure, and it is why `/src/tenants`' ambition seam finally has
         something pushing on it.
       ⚠ NOT FOLDED INTO `dailyOperatingCost()`. That function is the basis for
         seed capital and for the `cashDays` level gate, and both are asked in
         places that know nothing about land: folding a location-dependent
         charge in would make a firm's charter draw depend on a module that may
         be absent. The firm's BOOKS see the rent — it goes through `pay()`, so
         it lands in `costDay`, in the day's profit and therefore in the
         distress ladder, which is the only place it has to be seen for a
         business to fail of it.
       ⚠ LANDLORDS ARE EXEMPT. A `landlord` firm's business IS the ground:
         charging it ground rent and then paying that same rent back to it as
         landlord revenue is a round trip that moves nothing and inflates two
         readouts. Their plots are already priced — households pay rent on them
         in `runShopping`, and charging both would be the "property tax on top
         of the rent instead of out of it" leak with a new name.
       ⚠ NO MODULE ⇒ NO RENT. /src/landvalue may 404. The source then returns
         null and NOT A NUMBER, and sim.js charges nothing at all — a default
         premium would be a plausible substitute for a measurement, which is the
         failure /src/landvalue's own header calls this branch's most expensive
         lesson. */
    groundRent: {
      perPremiumDay: 0.22,     // 🔥 per point of LOCATION PREMIUM per economic day
      /* Industries that own their ground rather than rent it. */
      exemptIndustries: ['landlord'],
    },
    /* 💰 DIVIDENDS — the share of after-tax profit that reaches RESIDENTS.
       ----------------------------------------------------------------------
       🔴 WITHOUT THIS THE ECONOMY UNDER-CONSUMES AND CANNOT BE FIXED BY TUNING.
       Wages were the only path from firms to households. But a chain marks up
       `baseMarkup` at every step, so the price of a finished good is far above
       the wages embodied in it — households were being asked to buy output they
       structurally could never earn enough to afford. A 200-day run showed it
       exactly: 16 healthy businesses, household savings pinned at 0, and 664 🔥
       of subsistence going unmet every day in a city with 171,000 🔥 in it.

       Businesses in this city are owned by the people who live in it. Profit is
       income too, and it lands in the `high` wealth tier — which is also what
       finally makes the tiers mean something, and what lets a city that builds
       real industry grow the middle and upper class that then demands
       electronics, restaurants and cards. */
    dividendRate: 0.45,      // of after-tax profit, paid to households
    marginTarget: 0.22,      // markup a firm tries to hold over unit cost
    minMargin: -0.35,        // ...and how deep underwater it will trade before cutting
    /* 📉 THE FAILURE LADDER. Consecutive economic days cash-negative:
         → REDUCED    production throttled to `throttlePct`
         → LAYOFFS    sheds `layoffPct` of headcount
         → DEBT       draws on a bank line if it has one (bank.js)
         → DEFAULT    stops paying suppliers; its inputs dry up
         → BANKRUPT   closes. Its workers are unemployed the same tick.
       Each step is a real state on the firm, visible in the panel, and each is
       REVERSIBLE except the last — a firm that returns to profit climbs back
       up the ladder. A one-way ladder makes a single bad day terminal, which
       reads as punishment rather than as an economy. */
    distress: {
      reducedAfterDays: 2,  throttlePct: 0.60,
      layoffsAfterDays: 4,  layoffPct: 0.25,
      debtAfterDays: 6,
      defaultAfterDays: 9,
      bankruptAfterDays: 14,
      recoverDays: 3,        // consecutive profitable days to climb one rung
    },
    /* 🏢 LEVELS 1–5, and the gates are the announcement's gates: customers,
       revenue, profit, employees, suppliers, resources, infrastructure, cash.
       ⚠ EVERY gate must be met — this is deliberately not a points total.
       "You won't simply click an upgrade button" is the design, and a weighted
       score always collapses back into "grind the cheapest axis". */
    levels: [
      { lv: 1, name: 'Local Business',      ico: '🏪',
        gate: null, capMul: 1.00, wageMul: 1.00 },
      { lv: 2, name: 'Established Business', ico: '🏬',
        gate: { customersPerDay: 40,   revenuePerDay: 1200,   profitDays: 6,
                employees: 4,  suppliers: 1, cashDays: 10, infrastructure: 0.55 },
        capMul: 1.85, wageMul: 1.05 },
      { lv: 3, name: 'Major Business',       ico: '🏢',
        gate: { customersPerDay: 180,  revenuePerDay: 7500,   profitDays: 12,
                employees: 12, suppliers: 2, cashDays: 14, infrastructure: 0.70 },
        capMul: 3.40, wageMul: 1.12 },
      { lv: 4, name: 'Regional Corporation', ico: '🏛️',
        gate: { customersPerDay: 700,  revenuePerDay: 38000,  profitDays: 20,
                employees: 34, suppliers: 3, cashDays: 18, infrastructure: 0.82 },
        capMul: 6.20, wageMul: 1.22 },
      { lv: 5, name: 'Industry Leader',      ico: '👑',
        gate: { customersPerDay: 2200, revenuePerDay: 165000, profitDays: 30,
                employees: 80, suppliers: 4, cashDays: 24, infrastructure: 0.92 },
        capMul: 11.0, wageMul: 1.35 },
    ],
  },

  /* ── 🏗 CONSTRUCTION ────────────────────────────────────────────────────
     How long a building takes to go up. node-city holds NO copy of any of
     these: it computes a PROFILE from BUILDINGS (which only it can see) and
     hands it to Construction.seconds() below. If this module never loads,
     buildSeconds is unreachable, no timer is ever written, and the city
     places buildings instantly exactly as it did before this feature — and
     any job already on disk is COMPLETED, never parked. That is the degrade
     path and it is why there is no fallback literal in index.html (Rule 4).
     Time scales with what a building is WORTH: 65% of the signal is what it
     PRODUCES (cinder, tier-weighted resources, service), 35% is what it cost.
     maxSec is the ceiling the feature was asked for. */
  construction: {
    on:        1,
    formulaV:  1,          // bump on ANY retune below; rescales in-flight jobs
    minSec:    60,
    maxSec:    86400,      // 🔒 24 HOURS. The only place this number exists.
    gamma:     1.7,        // compresses the starter shelf into minutes
    costExp:   0.62,       // compresses a 3400x cost range into a usable band
    weight: { cinder: 0.20, resource: 0.30, service: 0.15, cost: 0.35 },
    full:   { cinderPerHr: 0.30, resource: 1400, service: 3.0, cost: 1200 },
    costResWeight: 2,      // one raw non-cinder unit ≈ 2 raw cinder on the shelf
    tierMul:   4,          // unit value = tierMul^tier  →  1 / 4 / 16 / 64
    defaultTier: 1,
    resSkip:  ['cinder', 'power'],   // ⚠ 'power' is never banked (index.html:2211)
    resTier: { food:0, water:0, wood:0, stone:0, cloth:0, metal:0,
               fuel:1, planks:1, supplies:1, rations:1, goods:1, ingots:1, ammo:1,
               reagents:2, medicine:2, remedies:2, components:2,
               memoryShards:3, corruptedEssence:3 },
    /* 🚧 LINEAR INFRASTRUCTURE — laid by the RUN, not raised one at a time.
       Exempt ⇒ instant, no timer, no crew slot (+ anything def.decor).
       ⚠ THE TEST FOR THIS LIST IS "IS IT DRAWN, OR IS IT BUILT?", and it is not
         "is it cheap". A cheap BUILDING belongs on the shelf with the rest of
         them; what belongs here is the stuff a player paints across the map in
         one gesture — the curve puts a road at about a minute, and paving a
         grid then becomes twenty countdowns against two free crew slots.
       🛤️ `railtrack` was MISSING and it was the same defect the Train Station
         had, one tile further down: 9🔥/4⛓ ⇒ 223s (3:43) each, cap 200, and a
         rail line is a CONTINUOUS RUN of it between stations. Measured on a
         fresh city: eight tiles attempted, ONE laid, seven refused with
         "Every crew is working — 2 / 2 on site". Track is the rail network's
         road and it is auto-tiled off its neighbours exactly like road, so it
         is drawn, not built. It also means the 10,000,000 🔥 Rail Operator
         licence was blocked twice over. */
    /* ⚠ 'road' HERE IS THE LEGACY CLASS ONLY, and that is deliberate. This is
       a static table in an ES module and cannot call node-city's road
       resolver, so node-city's bldExempt() ORs this list with isRoadType() —
       EVERY carriageway class is exempt there. Adding class ids to this array
       would be the list-shaped form of the bare-string tile-type bug and would
       drift the moment a class is renamed. */
    exemptTypes: ['road', 'wall', 'streetlight', 'lot', 'railtrack'],
    opSec:     900,        // every op_* is a flat 15 min. Ops carry cost:{}
                           // (index.html:21491) so no cost curve applies, and
                           // reading OPS_MOCK_PRICE would be a Rule-4 breach.
    upgrade:   { base: 0.75, mulPerLevel: 1.6 },
    municipal: { slots: 2, maxSec: 2400 },   // free crew; 40-minute ceiling
    slots:     { perCo: 1, perWorkerStep: 6, max: 6 },
    speed:     { perCo: 0.20, perWorker: 0.025, maxMul: 2.0 },
    confirmOverSec: 3600,  // gcConfirm anything over an hour
    /* 🗺 ZONED DEVELOPMENT — the second, slower way a building goes up, and the
       ONLY thing in this file that is not about the city's own crews.

       🔴 WHY IT EXISTS. `municipal.slots` is 2, deliberately: the crew limit is
          what gates hand placement and it is a real cost the player plays
          against. Zoning is the tool that develops a DISTRICT — measured, a
          476-tile rectangle planned 107 buildings, built 2, and refused the
          other 105 with "Every crew is working — 2 / 2 on site". Those two
          facts collide, and raising `slots` to reconcile them would silently
          re-tune hand placement and the whole construction feature for the
          entire game. So they are reconciled the way CS2 reconciles them
          instead: the mayor's crews build what the MAYOR places, and zoned land
          is built out by PRIVATE developers on their own schedule — the mayor
          permits land use, and buildings appear over time without a crew.

       WHAT KEEPS IT FROM BEING A LOOPHOLE, since it walks past the crew slot:
         • it can only raise what a zone MIX lists (housing, shops, works,
           sheds) — never an op, a plant, a service or anything else on the
           shelf, all of which still queue behind the two crews;
         • every OTHER refusal still applies, the municipal ceiling included, so
           a city with no Construction Co. still cannot grow a zone full of
           Cinder earners past 40 minutes of build time;
         • it is a DRIP, not a burst: one permit per `permitSec`, at most
           `sites` under construction at once, each still paying the shipped
           price and each still serving its full build timer;
         • nothing is ever paid in advance. The plan is re-derived from the zone
           map on every permit, so there is no queue on disk to cancel, refund
           or reconcile — which is the same objection that killed the paid crew
           queue (see the order gate in node-city).
       Development sites are counted OUT of the crew load (node-city
       bldCrewLoad), so a district building itself can never starve the player's
       own two crews — and with /src/zoning absent that count is 0 and every
       number here is unreachable, i.e. exactly the behaviour before it shipped.
       ⚠ `sites` is a CONCURRENCY, not a speed: six 3-minute houses is a house
         every 30 seconds, and six 3-hour factories is still a slow street. That
         is the intended read — density costs time, not just Cinder. */
    zoned: {
      on:        1,
      sites:     6,    // zoned plots under construction at once (crews: 2)
      permitSec: 10,   // seconds between permits while development is running
      perPermit: 1,    // plots permitted per tick — a drip, never a burst
      /* Consecutive refusals that pause the run. Money is the refusal that
         repeats, and a run that keeps asking would empty a treasury one plot at
         a time with no summary until it finished. Three is enough to be sure it
         was not one odd plot. */
      stopAfterRefusals: 3,
    },
  },

  /* ── 📈 PRICES ────────────────────────────────────────────────────────────
     A price is cost-plus, then moved by the market. `baseMarkup` is applied at
     each step of the chain, which is why a Reality Stabilisation Component
     costs what it does without a single hand-written price: the graph in
     recipes.js derives it. See prices.js `basePrice()`.

     🔴 NO RESOURCE HAS A HAND-WRITTEN PRICE ANYWHERE IN THIS CODEBASE. If you
     find yourself typing one, the recipe is wrong instead. */
  price: {
    /* 🔗 LABOUR COST IS DERIVED FROM THE WAGE, NOT TYPED IN.
       A recipe's `labor` is in labour-units; a worker delivers
       `laborUnitsPerDay` of them for one day's wage. So the cost of a
       labour-unit is `bands[band].wage / laborUnitsPerDay` and NOTHING sets it
       independently. This matters: a flat "Cinder per labour-unit" constant
       sitting next to the wage table is two numbers that mean the same thing,
       and the first wage retune makes them disagree — every price in the game
       then drifts away from every payroll in the game, silently. */
    /* ⚠ 12, AND DO NOT "IMPROVE" IT WITHOUT THE HOST'S POPULATION CAP IN HAND.
       Lowering this raises headcount everywhere, and a sweep against a test
       city whose population grew freely made 5 look strictly better —
       employment 27→90, unemployment 92%→73%. That test was wrong: node-city
       gates population on HOUSING (`popCap()` = 4 + 6 per housing level), so a
       real city never has hundreds of residents and a handful of businesses.
       Re-run against the real cap, 5 pins the city at 0% unemployment forever
       — which does not "fix" unemployment, it DELETES it, along with
       "high unemployment means less consumer spending". At 12 a city runs at
       full employment while it is small and starts shedding jobs once it
       outgrows its own demand, which is the arc the feature is for. */
    laborUnitsPerDay: 12,
    /* ⚡ FALLBACK ONLY. The real price of power is the derived price of the
       `electricity` resource — prices.js reads that and only falls back here if
       electricity is somehow absent from the graph. Do not tune this expecting
       power bills to move; tune the electricity recipe or the coal seam. */
    powerCost: 0.9,
    baseMarkup: 0.18,        // value added per chain step
    /* 🔴 THE FLOOR IS A DIVIDE-BY-ZERO GUARD, NOT A PRICE.
       Keep it far below the cheapest real raw. It was 4 once, which sat ABOVE
       the derived cost of every high-yield deposit (water, wheat, gravel, iron)
       and clamped them all to the same number — flattening the entire bottom of
       the economy and quietly deleting the yield-based scarcity that DEPOSITS
       exists to express. If a tuning change ever makes this bind on a real
       resource again, the floor is wrong, not the recipe. */
    rawFloor: 0.25,
    /* Market movement. `k` is how hard the price reacts to the supply/demand
       ratio; the clamps stop a single empty warehouse pricing steel at 400×. */
    k: 0.55,
    minMul: 0.35, maxMul: 4.0,
    /* How fast the printed price chases the computed one. Instant prices make
       the market unreadable — the number changes before the player finishes
       the sentence explaining it. */
    lerpPerDay: 0.45,
    /* Scarcity kicker: an id nobody in the region can produce. This is what
       makes "your node has no Iron" cost money rather than just being flavour. */
    unavailableMul: 1.9,
    /* ── ⚡ ALTERNATE FEEDSTOCKS: the two numbers `bestLeg()` ranks with ──
       A resource in ALT_FEEDSTOCK can be made several ways, and `bestLeg()`
       scores each leg as cost / availability so a coal shortage moves a plant
       onto gas on its own.

       `legRankFloor` is the DIVIDE GUARD in that score, not a price and not a
       policy: a leg at 0% availability would otherwise score Infinity for every
       leg at once and the ranking would be arbitrary. Floored, a fully blocked
       leg still ranks by cost, so a city with every leg blocked picks a leg
       deterministically instead of picking none.

       🔴 `legBlockedBelow` IS THE ONE THAT MATTERS, AND IT EXISTS BECAUSE OF A
          REAL BUG. A firm whose EVERY leg is below this has no feedstock at all,
          and must be diagnosed as such rather than as "short of reclaimed
          water" — the alternate leg is not the player's problem, the empty yard
          is. Measured before it existed: a Purifier with 0 rawWater AND 0
          reclaimedWater in the city reported HEALTHY at 100% and made 92,880
          units in 30 days, because sim.js only measured the inputs of the leg
          the firm ran LAST and an unmeasured input read as fully available.
          Five of the seven ALT_FEEDSTOCK ids did it, electricity included.
       ⚠ NOT 0, AND VERY SMALL. Not 0 because a yard holding a rounding error of
         one fuel is not a running power station, and a threshold of exactly zero
         would let 1e-9 units of nuclear fuel keep the old behaviour alive on one
         leg. Very small because this is a LABEL, not a throttle — it changes
         nothing about how much the plant makes, and a plant running on a genuine
         trickle is "Starved of inputs", which is already the right sentence and
         already names the fuel. Measured on a 400-day board: at 0.02 the power
         plant was called "no feedstock at all" on 255 days while it was in fact
         producing on 394 of them, i.e. the label was describing a brownout as an
         empty yard. At 0.001 it fires on the days the yard is actually empty. */
    legRankFloor: 0.05,
    legBlockedBelow: 0.001,
    /* Distance/logistics premium is applied per hop by logistics.js and is NOT
       a price number — see ECON.logistics. */
  },

  /* ── 🌩 DISASTERS: THERE IS NO `shock` GROUP, DELIBERATELY ────────────────
     This is where `ECON.shock` lived — the raid/weather → price mapping AND the
     counterweight built to pay for it (emergency response bill, austerity
     register, export blocking, output loss, the sample meter). All of it was
     REMOVED: the feature made a siege PROFITABLE for the city's owner, nine
     rounds failed to close that, and `shock = 1` always — what this game shipped
     before — is provably safe because the multiplier never moves.
     🔴 DO NOT RE-DERIVE THE MAPPING FROM THE DESIGN DOC. The two independent
        channels that made it exploitable, and what a rebuild would actually have
        to do about each, are written out in full at the removed hook site in
        prices.js `targetMul()`. Start there, not here — a coefficient in this
        file was never what was wrong. */

  /* ── 🚚 LOGISTICS ─────────────────────────────────────────────────────────
     "Buying something doesn't mean it magically appears."
     Every unit that crosses a link consumes freight capacity. A city short on
     freight does not get its goods, however much Cinder it has — which is the
     entire point of building warehouses and terminals. */
  logistics: {
    /* Capacity granted by each logistics building kind, in units per day. */
    capacity: { warehouse: 900, depot: 450, terminal: 2600, railhead: 5200, port: 8800, airfreight: 2100 },
    /* Cost to move one unit one hop, before fuel. */
    costPerUnitHop: 0.55,
    /* Fuel burned per unit per hop; billed at the live diesel price, so a fuel
       shock raises the price of EVERYTHING. That coupling is deliberate. */
    fuelPerUnitHop: 0.02,
    /* Hops in the announcement's chain: producer → warehouse → export terminal
       → freight → import terminal → warehouse → buyer. Local trade is 1 hop. */
    localHops: 1, tradeHops: 5,
    /* Over-capacity does not fail — it queues, and the queue raises delivered
       cost. A hard fail at 101% capacity would make the number unplayable. */
    congestionK: 0.85,
    maxCongestionMul: 3.2,
  },

  /* ── 🏦 BANKING ───────────────────────────────────────────────────────────
     ⚠ THIS IS THE CITY'S INTERNAL COMMERCIAL BANK AND IT IS NOT `player_banks`.
     The repo already has a player-facing bank (player_banks.sql,
     bank_products.sql, bank_charter_pricing.sql) tied to REAL player Cinder.
     Nothing here touches it, borrows from it, or writes to it. These loans are
     simulated firm credit inside the closed loop. Wiring the two together
     would let a simulated NPC bakery draw on a real chartered bank's reserves,
     which is a duplication bug wearing a feature's clothes. */
  bank: {
    baseRate: 0.055,         // per economic year (= 365 economic days)
    riskPremium: { 1: 0.075, 2: 0.052, 3: 0.034, 4: 0.021, 5: 0.013 },
    maxLoanToRevenueDays: 90,
    termDays: 180,
    /* A firm that defaults cannot borrow again for this long. */
    blacklistDays: 60,
  },

  /* ── 🏛 CITY / TAX ────────────────────────────────────────────────────────
     Taxes are the ONLY route from the simulation to the city treasury, and the
     treasury is the only thing the payout drain reads. */
  tax: {
    payroll: 0.06,           // on wages, paid by the firm
    sales: 0.05,             // on household purchases
    corporate: 0.11,         // on firm profit
    property: 0.02,          // on rent collected
    /* 🚰 THE DRAIN. Share of the day's MUNICIPAL SURPLUS — taxes and export
       income less benefits, imports and freight — that the player may withdraw
       into their real wallet, through the existing bridge path.
       ⚠ A SHARE OF INCOME, NOT OF THE BALANCE. Taking a percentage of the
       treasury each day liquidates the city's working capital instead of
       distributing its earnings, and does it slowly enough that every panel
       still reads healthy while the economy shrinks. sim.js enforces it; see
       the note at the payout step. A city with no surplus pays nothing. */
    payoutRate: 0.25,
    payoutMaxPerDay: 2500,
  },

  /* ── 🚰 THE FAUCET — CINDER ENTERING FROM OUTSIDE ────────────────────────
     The only place new Cinder is created, and it is created ONLY against real
     exported volume: someone outside the city bought something the city made.
     `maxPerMin` is the hard ceiling and sim.js clamps to it every tick. */
  faucet: {
    perExportUnit: 1.0,      // multiplier on the goods' market value
    maxPerMin: 900,
    /* Visitors and SCP contracts are exports of a SERVICE — same rule, same
       ceiling, and they only pay if the city actually has the capacity. */
    tourismPerVisitor: 12,
    scpContractMul: 2.4,
  },

  /* ── ⭐ SPECIALIZATION ────────────────────────────────────────────────────
     Earned, never chosen: a city specialises in what it has actually been
     producing and exporting for a sustained period. Picking from a menu makes
     the node endowment decorative, which is the fault this whole update fixes. */
  specialization: {
    minDays: 14,             // sustained output before a claim can be made
    minShareOfOutput: 0.22,  // ...and this share of the city's total output value
    maxActive: 2,            // a city is known for one or two things, not eleven
    prodBonus: 0.18, effBonus: 0.12, tradeBonus: 0.15, growthBonus: 0.10,
  },

  /* ── 🤝 TRADE ─────────────────────────────────────────────────────────────
     Between cities. `spreadPct` is the market maker's cut and is what stops
     two cities from laundering goods back and forth for free. */
  trade: {
    spreadPct: 0.04,
    minOffer: 10,
    maxOpenOffers: 12,
    offerTtlDays: 7,
    /* An offer from a city with a matching specialization clears first, which
       is the mechanical reward for specialising at all. */
    specPriority: 1.35,
  },
};

/* 🔍 One accessor, so a future retune has exactly one call site to audit.
   Path form: econ('labor.bands.skilled.wage'). Returns `dflt` (default 0)
   rather than throwing — a missing tuning key must degrade, never crash a
   tick that is halfway through moving money. */
export function econ(path, dflt) {
  try {
    let v = ECON;
    for (const k of String(path).split('.')) {
      if (v == null) break;
      v = v[k];
    }
    return (v === undefined || v === null) ? (dflt === undefined ? 0 : dflt) : v;
  } catch (e) { return dflt === undefined ? 0 : dflt; }
}

/* ════════════════════════════════════════════════════════════════════════════
   🏛 TAX POLICY — the four rates a mayor may actually set
   ----------------------------------------------------------------------------
   The budget tab used to say, truthfully, "these rates are fixed; no code
   anywhere sets any of them". These four now have a slider, and the other three
   rows on that tab deliberately do NOT:

     payroll · sales · corporate · property     ← policy, adjustable
     payoutRate · payoutMaxPerDay · faucet.maxPerMin  ← NOT, and never

   🔴 WHY THE LAST THREE ARE NOT NEGOTIABLE. A tax is a TRANSFER inside the
      city: the payroll tax comes out of the payroll the firm was already
      paying, the sales tax out of the money the shopper already spent. Move a
      tax rate and the same Cinder lands in a different pocket — the closed loop
      the tick audit checks is untouched, which is exactly why this is safe.
      The other three are the guards on the way OUT: payoutRate and
      payoutMaxPerDay bound what leaves the city into a real wallet, and
      faucet.maxPerMin bounds the only Cinder that enters the economy at all.
      A slider on those is a slider on how fast a player pays themselves, and
      Aza settles at 1 ◈ = $1. They stay in this file, where changing them is a
      deploy and not a click.

   ⚠ BOUNDS ARE TUNING, SO THEY LIVE HERE. `_opEcon()`'s rule: no operation
     number written down anywhere but this table. The ceilings are not there to
     stop a rate being INTERESTING — they stop one being incoherent. A 100%
     corporate tax means no firm ever books a profit, every business stalls, and
     the resulting city is not a hard mode, it is a broken one.
   ⚠ A POLICY IS PER CITY and rides that city's save. Nothing here is global:
     setTaxPolicy() is called on mount with whatever the save held. */
ECON.taxPolicy = {
  payroll:   { min: 0, max: 0.25, step: 0.005, label: 'Payroll tax' },
  sales:     { min: 0, max: 0.25, step: 0.005, label: 'Sales tax' },
  corporate: { min: 0, max: 0.40, step: 0.005, label: 'Corporate tax' },
  property:  { min: 0, max: 0.15, step: 0.005, label: 'Property tax' },
};
/* The live override. Null means "no policy set" — read the shipped default —
   and that is NOT the same as a policy of 0, which is a mayor choosing to
   charge nothing. Every read goes through taxRate() so the two never blur. */
let _taxPolicy = null;

export function taxPolicyBounds() { return ECON.taxPolicy; }

/* Clamp and store. Returns the policy actually stored, which is what the panel
   should render — a slider that shows a number the simulation is not using is
   the whole problem this replaces. */
export function setTaxPolicy(p) {
  if (!p || typeof p !== 'object') { _taxPolicy = null; return null; }
  const out = {};
  for (const k in ECON.taxPolicy) {
    const b = ECON.taxPolicy[k];
    const v = Number(p[k]);
    if (!Number.isFinite(v)) continue;              // absent key keeps the default
    out[k] = Math.min(b.max, Math.max(b.min, v));
  }
  _taxPolicy = Object.keys(out).length ? out : null;
  return _taxPolicy;
}
export function getTaxPolicy() { return _taxPolicy ? { ..._taxPolicy } : null; }

/* THE ONE READ. Every site that used to say `ECON.tax.payroll` says
   `taxRate('payroll')`, so a policy cannot be honoured in one place and ignored
   in another — the shape that has bitten this project repeatedly (one seam that
   knows the rule, another that writes the store). */
export function taxRate(key) {
  const dflt = (ECON.tax && ECON.tax[key]) || 0;
  if (!_taxPolicy || !(key in _taxPolicy)) return dflt;
  const v = _taxPolicy[key];
  return Number.isFinite(v) ? v : dflt;
}

export default ECON;
