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
    exemptTypes: ['road', 'wall', 'streetlight', 'lot'],  // + anything def.decor
    opSec:     900,        // every op_* is a flat 15 min. Ops carry cost:{}
                           // (index.html:21491) so no cost curve applies, and
                           // reading OPS_MOCK_PRICE would be a Rule-4 breach.
    upgrade:   { base: 0.75, mulPerLevel: 1.6 },
    municipal: { slots: 2, maxSec: 2400 },   // free crew; 40-minute ceiling
    slots:     { perCo: 1, perWorkerStep: 6, max: 6 },
    speed:     { perCo: 0.20, perWorker: 0.025, maxMul: 2.0 },
    confirmOverSec: 3600,  // gcConfirm anything over an hour
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

export default ECON;
