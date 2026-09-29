/* ════════════════════════════════════════════════════════════════════════════
   💰 THE CITY BUDGET — the model. Every figure on this panel is named here,
   and every one of them names the live call it came from.
   ----------------------------------------------------------------------------
   This is a READOUT of `/src/economy`. It moves nothing, it owns nothing, and
   it holds no economy number of its own. `render.js` next door is markup only,
   exactly as /src/economy/render.js is ("No number is computed in this file") —
   so all of the arithmetic this panel does at all is in this one file, where it
   can be read in one sitting.

   🔴 THE RULE THIS FILE EXISTS TO KEEP. node-city has already had to rip
   content out of two panels for inventing numbers — a demand cause with no
   model behind it, and a water alarm that contradicted the panel above it. So:

     · every line carries `source`, the exact expression it was read from, and
       the panel prints it. A figure that cannot name its call does not ship.
     · a figure with no model behind it is `available: false` with the REAL
       reason in `why`. It is never shown as a plausible number, and it is
       never quietly dropped either — a missing expense line reads as a city
       that does not have that expense.
     · nothing here combines two of the simulation's numbers except where the
       combination is itself checked. See `reconcile()`: the totals are proved
       against the treasury balance rather than asserted.

   ⚠ THE ACCOUNTING PERIOD IS THE LEDGER'S, NOT A CALENDAR MONTH. `S.flow.*` is
     zeroed by `zeroFlow()` at the top of every `runDay()` and accumulated
     through it; `runPartial()` (the sub-day remainder) then keeps adding to the
     SAME counters without zeroing them. So a read of `snapshot().flow` is
     "the last economic day the city closed, plus whatever has moved since it
     closed" — and that is what the panel says. Calling it "monthly" (or even
     "daily") would be a number with a wrong label on it, which is the same
     defect as a wrong number.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── 🎨 THE CHART PALETTE ────────────────────────────────────────────────────
   Two revenue hues and one expense hue, validated against node-city's own card
   surface (#14161d) rather than chosen by eye: OKLCH lightness inside the dark
   band, chroma above the gray floor, adjacent-pair separation ΔE 21.1 for
   normal vision and 20.1 under deuteranopia, all three above 3:1 contrast on
   the surface.
   ⚠ COLOUR IS NEVER THE ONLY ENCODING HERE. Every row is labelled, every value
     is signed (+ / −), and the two bars are captioned REVENUES and EXPENSES —
     which is what makes the green/red pair (ΔE 6.3 deutan, the one weak pair in
     the set) legible anyway. Do not remove the signs to tidy the layout. */
export const PALETTE = {
  rev: ['#3fa85f', '#2f86c9'],   // fixed order, never cycled
  revOther: '#5b6376',           // an unrecognised revenue key folds in here
  exp: '#c9455a',
  surface: '#14161d',
};

/* Read a flow counter that may not exist. `S.flow` gained `utilityImport` and
   `utilityExport` while this panel was being written, and it will gain more —
   so an absent key is a defined state (the feature is not in this build), not
   a zero and not a crash. */
function flowOf(f, key) {
  if (!f || typeof f !== 'object') return null;
  const v = f[key];
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}
const sum = (arr) => arr.reduce((a, b) => a + (b || 0), 0);

/* ── THE REVENUE LINES ──────────────────────────────────────────────────────
   Only what actually lands in `S.treasury`. Both of these were traced through
   sim.js line by line and then MEASURED — see tools/budget-recon.mjs, which
   drives the real simulation and checks these lines against the treasury
   balance itself. */
function revenueLines(s) {
  const f = s.flow || {};
  const out = [];

  const tax = flowOf(f, 'tax');
  out.push({
    id: 'tax', label: 'Taxes & permits', sign: +1,
    value: tax, available: tax != null,
    why: 'The economy did not publish a tax counter in this build.',
    source: 'snapshot().flow.tax',
    detail: 'four taxes and one fee, added into one counter',
    explain:
      'Everything the city collects from the businesses and residents inside it. Five ' +
      'separate charges are added together here: payroll tax on every wage a firm pays, ' +
      'sales tax on household purchases, corporate tax on firm profit, property tax out of ' +
      'the rent landlords collect, and the fee a business pays the city when it expands to ' +
      'its next level.\n\n' +
      'Every one of those comes OUT of a payment that was already made, never on top of it. ' +
      'Taxing on top would hand the treasury Cinder nobody earned, and two of the four money ' +
      'leaks this economy was rebuilt to close were exactly that mistake.\n\n' +
      'The five figures cannot be shown separately. sim.js adds all of them into a single ' +
      'counter at four different points in the day and keeps no per-tax total, so a split ' +
      'here would be a guess. The rates themselves are on the Taxation tab.',
  });

  const faucet = flowOf(f, 'faucet');
  out.push({
    id: 'faucet', label: 'Export earnings', sign: +1,
    value: faucet, available: faucet != null,
    why: 'The economy did not publish an export-earnings counter in this build.',
    source: 'snapshot().flow.faucet',
    detail: 'the only Cinder entering the city',
    explain:
      'The only Cinder that enters this city from outside it. Somebody in another city ' +
      'bought something yours made, and this is what they paid once freight was taken out ' +
      'of the sale.\n\n' +
      'It is capped per minute, and it only ever pays against volume that actually shipped. ' +
      'That is deliberate and it is the whole safety rule of this economy: everything else ' +
      'on this page is Cinder moving between people who are already here, and the city ' +
      'stops paying you the moment it cannot account for the difference.',
  });
  return out;
}

/* ── THE EXPENSE LINES ──────────────────────────────────────────────────────
   🚚 HAULAGE IS ONE PAYMENT IN TWO COUNTERS AND IS SHOWN AS ONE LINE. sim.js
   debits the treasury once (`freightPaid`) and then books it to `flow.freight`
   if the city has haulage firms of its own and to `flow.imports` +
   `flow.freightAsImport` if it does not. Showing the two counters as two lines
   would read as two bills. It used to be double-booked for real, and the
   payout basis subtracted it twice; the fix was to stop double-booking, not to
   subtract it back out, and this panel must not undo that by adding it twice. */
function expenseLines(s) {
  const f = s.flow || {};
  const t = s.trade || {};
  const out = [];

  const civic = flowOf(f, 'civic');
  out.push({
    id: 'civic', label: 'Civic payroll', sign: -1,
    value: civic, available: civic != null,
    why: 'The economy did not publish a civic-payroll counter in this build.',
    source: 'snapshot().flow.civic',
    detail: 'wages for the people the city employs',
    explain:
      'Wages for the people the city employs itself — clerks, crews, maintenance staff. ' +
      'It is the larger half of what the city spends on itself each day.\n\n' +
      'It leaves the treasury and arrives in residents’ savings the same day, so it is a ' +
      'cost to the city and income to the town at the same time. A city that spends nothing ' +
      'is not a thrifty city: the treasury becomes a place money goes to stop, businesses ' +
      'starve of customers, and every balance still looks healthy while it happens.',
  });

  const infra = flowOf(f, 'infrastructure');
  out.push({
    id: 'infrastructure', label: 'Procurement', sign: -1,
    value: infra, available: infra != null,
    why: 'The economy did not publish a procurement counter in this build.',
    source: 'snapshot().flow.infrastructure',
    detail: 'goods the city buys from its own firms',
    explain:
      'What the city buys from its own businesses: concrete, asphalt, lumber, construction ' +
      'components, electricity, fresh water, medical and emergency supplies — in that order, ' +
      'so it fills potholes before it buys office chairs.\n\n' +
      'It is bought at the day’s market price from the firms that actually made it, out of ' +
      'the city’s own inventory. This is what makes a Concrete Works worth building even ' +
      'when no other business in town wants concrete.',
  });

  const benefits = flowOf(f, 'benefits');
  out.push({
    id: 'benefits', label: 'Unemployment benefit', sign: -1,
    value: benefits, available: benefits != null,
    why: 'The economy did not publish a benefits counter in this build.',
    source: 'snapshot().flow.benefits',
    detail: 'paid to residents with no job',
    explain:
      'Paid to residents who have no job. It is an automatic stabiliser: when the city sheds ' +
      'jobs this line rises on its own, which keeps people spending, which keeps open the ' +
      'shops that would otherwise close and shed more jobs.\n\n' +
      'The city pays what it can. If the treasury is short, the remainder is simply not paid ' +
      '— nothing is borrowed and nothing is created to cover it.',
  });

  const welfare = flowOf(f, 'welfare');
  out.push({
    id: 'welfare', label: 'Food relief', sign: -1,
    value: welfare, available: welfare != null,
    why: 'The economy did not publish a welfare counter in this build.',
    source: 'snapshot().flow.welfare',
    detail: 'subsistence the households could not pay for',
    explain:
      'Residents eat whether or not they can afford to. Households pay first, out of their ' +
      'own savings; where they cannot, the city covers the rest out of the treasury as far ' +
      'as the treasury goes.\n\n' +
      'Whatever is still unpaid after that is a loss the producer absorbs. No Cinder is ' +
      'invented to cover it, and that is exactly how a household crisis reaches business ' +
      'balance sheets in this simulation — through the accounts, not through a script.',
  });

  const freight = flowOf(f, 'freight');
  const freightOut = flowOf(f, 'freightAsImport');
  const haulAvail = freight != null || freightOut != null;
  out.push({
    id: 'freight', label: 'Haulage', sign: -1,
    value: haulAvail ? sum([freight, freightOut]) : null, available: haulAvail,
    why: 'The economy did not publish a freight counter in this build.',
    source: 'snapshot().flow.freight + snapshot().flow.freightAsImport',
    detail: 'one bill, whether it stays in town or leaves',
    explain:
      'The day’s freight bill — what it cost to move everything the city bought, sold and ' +
      'shipped between its own businesses.\n\n' +
      'It is paid once. If the city has haulage businesses of its own, that payment is ' +
      'revenue for them and stays in town; if it does not, the same payment leaves the city ' +
      'to outside carriers and is booked as an import. The simulation keeps those in two ' +
      'counters and this line adds them, because they are one bill — it was genuinely ' +
      'double-booked once, and every Cinder the treasury failed to find for haulage then ' +
      'raised the recorded surplus by two.',
  });

  const impSpend = (typeof t.importSpend === 'number' && isFinite(t.importSpend)) ? t.importSpend : null;
  out.push({
    id: 'imports', label: 'Imported goods', sign: -1,
    value: impSpend, available: impSpend != null,
    why: 'The trade layer did not publish an import settlement in this build.',
    source: 'snapshot().trade.importSpend',
    detail: 'bought from other cities',
    explain:
      'What the city paid other cities for things it could not make or could not make ' +
      'enough of. Freight to get it here is included in the delivered price.\n\n' +
      'One caveat, stated because the panel cannot detect it: this is the trade layer’s own ' +
      'settlement for the day, and it equals what left the treasury in every case except ' +
      'one — a fill already committed on another city’s books can be larger than this ' +
      'treasury can cover, and then the city pays what it has, takes a part load, and this ' +
      'line reads higher than the payment. That path needs the networked trade tables, which ' +
      'are written but not yet applied, so today it cannot happen.',
  });

  const util = flowOf(f, 'utilityImport');
  if (util != null) {
    out.push({
      id: 'utilityImport', label: 'Imported electricity', sign: -1,
      value: util, available: true, why: '',
      source: 'snapshot().flow.utilityImport',
      detail: 'power drawn over the outside connection',
      explain:
        'Power the city drew over its outside connection and paid for out of the treasury.\n\n' +
        'The energy is delivered before it is billed, so an unpaid bill is not forgiven — it ' +
        'becomes arrears, and the neighbouring grid stops sending power until the arrears ' +
        'clear. Writing it off instead would be free electricity, which is the same shape as ' +
        'a leak this economy has already had to close once.',
    });
  }

  const payout = flowOf(f, 'payout');
  out.push({
    id: 'payout', label: 'Paid to you', sign: -1,
    value: payout, available: payout != null,
    why: 'The economy did not publish a payout counter in this build.',
    source: 'snapshot().flow.payout',
    detail: 'your share of the day’s surplus',
    explain:
      'Your share, drawn out of the treasury and held until the game hands it to your wallet.\n\n' +
      'It is a percentage of the day’s municipal SURPLUS — taxes and export earnings, less ' +
      'benefits, imports and haulage — and never a percentage of the balance. Taking a slice ' +
      'of the balance each day liquidates the city’s working capital instead of ' +
      'distributing its earnings, and does it slowly enough that every panel still reads ' +
      'healthy while the economy shrinks. A city with no surplus pays you nothing.\n\n' +
      'If the treasury audit ever fails, this stops completely until the books balance again.',
  });
  return out;
}

/* ── 🕳 THE TREASURY MOVEMENTS WITH NO LEDGER TERM ───────────────────────────
   These are not "lines we chose not to show". They are two real debits against
   `S.treasury` that sim.js records in NO flow counter, so no panel can put a
   number on them — and a budget that quietly omitted them would be a budget
   that does not add up, with nothing on it saying why.

   MEASURED, tools/budget-recon.mjs: over 200 economic days of a churning city
   the classified lines above reconcile against the treasury to −124,256.09 🔥,
   and setting `ECON.firm.charter.treasuryDrawPct = 0` in an otherwise identical
   run collapses that to −32.59 🔥 on day 0 alone. The first figure is the
   founding draw; the remainder is the bank seed. With neither in play the
   reconciliation is EXACTLY zero over 60, 80 and 200 day runs. */
function unmeasuredLines() {
  return [
    { id: 'founding', label: 'Business start-up capital', sign: -1,
      value: null, available: false,
      why: 'Real, and recorded in no counter — sim.js debits the treasury here without ' +
           'writing a flow term, so there is nothing for a panel to read.',
      source: 'sim.js fundFounding() — S.treasury -= fromTreasury',
      detail: 'not measured',
      explain:
        'When a new business opens, its seed capital comes from the charter fund first. If ' +
        'that fund is dry, the city backs the business out of the treasury instead.\n\n' +
        'That payment is real and it happens whenever you build. The simulation records it ' +
        'in no flow counter, so this panel will not put a number on it — and it is the usual ' +
        'reason the reconciliation below comes up short on a day you built something. It is ' +
        'a transfer, not a leak: the money is in the new business, and the closed-loop audit ' +
        'sees it.' },
    { id: 'bankseed', label: 'Bank capitalisation', sign: -1,
      value: null, available: false,
      why: 'Real, and recorded in no counter — the same blind spot as the line above.',
      source: 'sim.js — S.treasury -= Bank.capitalise(seed)',
      detail: 'not measured',
      explain:
        'The first day the city has a bank, the treasury seeds its reserve. Like the line ' +
        'above it moves real Cinder and is written to no flow counter, so it cannot be shown ' +
        'as a figure. It happens once in a city’s life.' },
  ];
}

/* ── ⚰ NOT PART OF THE DAY, AND HERE IS WHY ─────────────────────────────────
   `flow.estate` exists and is a genuine treasury RECEIPT, but reading it as a
   day line would be a number with a wrong label. A demolition happens BETWEEN
   two economic days (the host syncs buildings on its own timer), and
   `zeroFlow()` wipes the counter at the top of the next day — so by the time
   any panel reads it, it is almost always already zero while the treasury has
   visibly jumped. The LIFETIME tally is the honest figure, and it is the one
   sim.js itself calls "the number that proves the wind-up path actually ran". */
function estateLine(s) {
  const v = (typeof s.estateReceived === 'number' && isFinite(s.estateReceived)) ? s.estateReceived : null;
  return {
    id: 'estate', label: 'Estate receipts', sign: +1,
    value: v, available: v != null, lifetime: true,
    why: 'The economy did not publish an estate tally in this build.',
    source: 'snapshot().estateReceived (lifetime)',
    detail: 'lifetime, not this day',
    explain:
      'When a business is wound up, whatever cash it still holds goes to the city. Money has ' +
      'to arrive somewhere or it is destroyed, and destroyed Cinder fails the city’s audit ' +
      'exactly as invented Cinder does — only more quietly, because the number only ever ' +
      'goes down.\n\n' +
      'It is NOT municipal income, and it is deliberately left out of what your payout is ' +
      'calculated from: a city must not be able to pay its owner out of the wreckage of its ' +
      'own factories.\n\n' +
      'Only a lifetime total is shown here. Demolitions happen between two economic days and ' +
      'the per-day counter is wiped at the top of the next one, so the daily figure is ' +
      'almost always zero by the time a panel can read it. A lifetime figure that is true ' +
      'beats a daily figure that is structurally blind.',
  };
}

/* ── 🔍 THE RECONCILIATION ───────────────────────────────────────────────────
   The panel proving its own arithmetic against the thing it is describing.

   Between two readings taken INSIDE THE SAME economic day, the treasury must
   have moved by exactly (revenue lines − expense lines + estate receipts).
   Both sides are differences of live reads, so the check is exact:
     · `Δflow` is exact within a day because the counters only accumulate.
     · `ΔestateReceived` is exact over ANY window because it is a lifetime tally.
     · `Δtreasury` is the balance itself.

   ⚠ A WINDOW THAT CROSSES A DAY BOUNDARY CANNOT BE CHECKED AND IS DISCARDED,
     not approximated. `zeroFlow()` wipes the counters at the top of each day, so
     the flow read after the boundary is missing everything that moved between
     the previous read and the boundary. Reporting that difference as a residual
     would be inventing a discrepancy; reporting it as zero would be hiding one.
     The panel says how many windows it has checked instead.

   WHAT A NON-ZERO RESIDUAL MEANS: the two unmeasured debits above, and in
   practice almost always the first one. It is a real gap in the ledger's
   readouts and not a mistake in the arithmetic — which is precisely why it is
   printed rather than absorbed. */
export function newReconciler() {
  return { prev: null, windows: 0, resid: 0, worst: 0, dTreasury: 0, dLines: 0, skipped: 0 };
}

export function sample(rec, s, model) {
  if (!rec || !s) return rec;
  const now = {
    day: s.day,
    treasury: (typeof s.treasury === 'number' && isFinite(s.treasury)) ? s.treasury : null,
    estate: (typeof s.estateReceived === 'number' && isFinite(s.estateReceived)) ? s.estateReceived : 0,
    net: model.totals.measurable ? (model.totals.revenue - model.totals.expense) : null,
  };
  const p = rec.prev;
  rec.prev = now;
  if (!p || now.treasury == null || p.treasury == null || now.net == null || p.net == null) return rec;
  if (p.day !== now.day) { rec.skipped++; return rec; }
  const dT = now.treasury - p.treasury;
  const dL = (now.net - p.net) + (now.estate - p.estate);
  const r = dT - dL;
  rec.windows++; rec.resid += r; rec.dTreasury += dT; rec.dLines += dL;
  if (Math.abs(r) > Math.abs(rec.worst)) rec.worst = r;
  return rec;
}

/* ── THE MODEL ──────────────────────────────────────────────────────────────
   One object, everything the markup needs, nothing it has to work out. */
export function buildModel(s) {
  if (!s) return null;
  const revenues = revenueLines(s);
  const expenses = expenseLines(s);
  const unmeasured = unmeasuredLines();
  const estate = estateLine(s);

  const revAvail = revenues.filter(l => l.available);
  const expAvail = expenses.filter(l => l.available);
  const revenue = sum(revAvail.map(l => l.value));
  const expense = sum(expAvail.map(l => l.value));
  const measurable = revAvail.length > 0 || expAvail.length > 0;

  /* 🎨 COLOUR FOLLOWS THE LINE, NEVER ITS SIZE. Each revenue line takes its hue
     from its FIXED position in the list, so a line that falls to zero on a quiet
     day does not hand its colour to the one below it — the chart and the row
     would then disagree about which was which, and the row's swatch is the only
     thing tying the two together. An unrecognised line folds into one neutral
     rather than generating a hue. */
  for (let i = 0; i < revenues.length; i++) {
    revenues[i].color = PALETTE.rev[i] !== undefined ? PALETTE.rev[i] : PALETTE.revOther;
  }
  for (const l of expenses) l.color = PALETTE.exp;

  /* The chart geometry. Computed here so render.js stays what its neighbour in
     /src/economy already promises to be: markup, and no arithmetic. */
  const scale = Math.max(revenue, expense, 1);
  const segments = revAvail
    .filter(l => l.value > 0)
    .map((l) => ({ id: l.id, label: l.label, value: l.value,
                   frac: l.value / scale, color: l.color }));

  const audit = s.audit || null;
  return {
    day: s.day, treasury: s.treasury,
    revenues, expenses, unmeasured, estate,
    totals: { revenue, expense, balance: revenue - expense, measurable },
    chart: { segments, revFrac: revenue / scale, expFrac: expense / scale, scale,
             expColor: PALETTE.exp },
    audit,
    payout: { allowed: !!s.payoutAllowed, owed: s.payoutOwed, inFlight: s.payoutInFlight,
              lifetime: s.payoutLifetime },
  };
}

/* ── THE TAXATION TAB ───────────────────────────────────────────────────────
   Rates, read live out of ECON. There is no setter for any of them anywhere in
   the codebase, so this tab is a statement of the rules and not a control
   panel — and it says so rather than offering a slider that does nothing. */
/* @param ECON   the tuning table
   @param live   optional { rate(key), bounds } — the ECONOMY's live view, so a
                 row shows the rate the simulation is ACTUALLY charging rather
                 than the shipped default. Absent (a test, or an old caller) and
                 every row reads exactly as it did before policy existed.
   ⚠ `bounds` is what makes a row adjustable in the renderer, so it is attached
     to the four policy taxes and to NOTHING else. The payout share, the daily
     ceiling and the faucet must not grow a slider by accident — see the note in
     tuning.js on why those three are not policy. */
export function taxModel(ECON, live) {
  if (!ECON || !ECON.tax) return null;
  const T = ECON.tax, F = ECON.faucet || {};
  const P = (live && live.bounds) || null;
  const rateOf = (k, dflt) => (live && typeof live.rate === 'function') ? live.rate(k) : dflt;
  const rows = [
    { id: 'payroll', label: 'Payroll tax', rate: rateOf('payroll', T.payroll), shipped: T.payroll, bounds: P && P.payroll, unit: '%',
      base: 'every wage a firm pays', payer: 'the business',
      source: 'ECON.tax.payroll',
      explain: 'Charged on wages when a business runs its payroll. It comes out of the ' +
        'payroll the firm was already paying — the worker’s wage and the city’s share ' +
        'sum to what the firm spent. Crediting the city on top of the wage minted about 6% ' +
        'of every wage in this city for a while, and it looked completely correct.' },
    { id: 'sales', label: 'Sales tax', rate: rateOf('sales', T.sales), shipped: T.sales, bounds: P && P.sales, unit: '%',
      base: 'household purchases', payer: 'the shopper, collected from the shop',
      source: 'ECON.tax.sales',
      explain: 'Charged on what residents spend in shops. The household pays the gross, the ' +
        'shop keeps the net, and the city takes the difference out of the middle.' },
    { id: 'corporate', label: 'Corporate tax', rate: rateOf('corporate', T.corporate), shipped: T.corporate, bounds: P && P.corporate, unit: '%',
      base: 'business profit', payer: 'the business',
      source: 'ECON.tax.corporate',
      explain: 'Charged when a business closes its books for the day and shows a profit. A ' +
        'business making nothing pays nothing.' },
    { id: 'property', label: 'Property tax', rate: rateOf('property', T.property), shipped: T.property, bounds: P && P.property, unit: '%',
      base: 'rent collected', payer: 'the landlord, out of the rent',
      source: 'ECON.tax.property',
      explain: 'Charged out of the rent, not on top of it. The tenant paid the rent and that ' +
        'is all that left their savings; the landlord receives the net and the city receives ' +
        'the tax, and the two sum to what was actually paid.' },
    { id: 'payoutRate', label: 'Your share of the surplus', rate: T.payoutRate, unit: '%',
      base: 'the day’s municipal surplus', payer: 'the treasury, to you',
      source: 'ECON.tax.payoutRate',
      explain: 'The share of each day’s surplus — taxes and export earnings less benefits, ' +
        'imports and haulage — that you may withdraw. A share of income, never of the ' +
        'balance.' },
    { id: 'payoutMax', label: 'Daily payout ceiling', rate: T.payoutMaxPerDay, unit: '\u{1F525}',
      base: 'per economic day', payer: '—',
      source: 'ECON.tax.payoutMaxPerDay',
      explain: 'A hard cap on what a single day can pay you, whatever the surplus was.' },
    { id: 'faucetCap', label: 'Export earnings ceiling', rate: F.maxPerMin, unit: '\u{1F525}/min',
      base: 'the one tap into this economy', payer: '—',
      source: 'ECON.faucet.maxPerMin',
      explain: 'Export earnings are the only Cinder that enters the city, and this is the ' +
        'hard ceiling on the rate at which it can. Every other number on these tabs is money ' +
        'that was already here changing hands.' },
  ];
  return { rows };
}
