/* ════════════════════════════════════════════════════════════════════════════
   🧾 THE BUDGET RECONCILIATION — proof that /src/budget's lines are the
   treasury's own movements and not a plausible-looking selection of counters.

   Run from the repo root:   node tools/budget-recon.mjs
   Exits non-zero if the classification stops closing.

   ----------------------------------------------------------------------------
   WHY THIS FILE EXISTS. The budget panel claims that

     Δtreasury  ===  (its revenue lines) − (its expense lines) + estate receipts

   over one economic day. That claim is exactly the kind that looks obviously
   true in review and is not: `flow.imports` mixes treasury spending with
   private-sector spending, `flow.freight` and `flow.freightAsImport` are two
   counters for ONE payment, `flow.estate` is wiped before anything can read it,
   and two real debits against the treasury are written to no counter at all.
   Every one of those was found by running this, not by reading sim.js.

   THE METHOD. Drive the real simulation one WHOLE economic day at a time
   (`advance(ECON.clock.dayMin)` leaves no fractional remainder, so `flow.*` is
   exactly that day and nothing else), read the treasury either side, and
   compare. Nothing here writes to a ledger; it only advances the clock.

   ROUNDS
     1  A plain city. The lines must close EXACTLY — 0.00, not "small".
     2  A city with a bank. Must be off by exactly the bank's capitalisation
        seed, which sim.js records in no flow term.
     3  A churning city (buildings founded and demolished) whose charter fund
        runs dry, so foundings fall back on the treasury. Must be off, and
        setting `ECON.firm.charter.treasuryDrawPct = 0` in an otherwise
        identical run must collapse that gap to the bank seed alone — which is
        what proves the gap IS the founding draw rather than a mistake in the
        classification.
   ════════════════════════════════════════════════════════════════════════════ */
const P = '../public/src/economy/';
global.window = { MythicCityBridge: { addCinders: async () => true }, MythicResourceChain: null };
const chain = await import('../public/src/resources/chain.js');
global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
const Sim = await import(P + 'sim.js');
const HH = await import(P + 'households.js');
const { ECON } = await import(P + 'tuning.js');
await import(P + 'index.js');
const E = global.window.MythicEconomy;
const DAY = ECON.clock.dayMin;

let bad = 0;
const chk = (name, cond, extra) => {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra ? '  ::  ' + extra : ''));
  if (!cond) bad++;
};
const r2 = (v) => (Math.round(v * 100) / 100).toLocaleString();

/* THE CLASSIFICATION UNDER TEST. It must stay a copy of what
   /src/budget/model.js does — if the two drift, this gate is testing itself.
   ⚠ `estate` is read from the LIFETIME tally, not from `flow.estate`. A
     demolition happens between two economic days and the per-day counter is
     wiped at the top of the next one, so the daily figure is structurally
     blind. That is not a nicety: reading `flow.estate` here made round 3 report
     a false 1.6M gap. */
function classify(s) {
  const f = s.flow || {}, t = s.trade || {};
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const revenue = n(f.tax) + n(f.faucet);
  const expense = n(f.civic) + n(f.infrastructure) + n(f.welfare) + n(f.benefits)
                + n(f.freight) + n(f.freightAsImport) + n(t.importSpend)
                + n(f.utilityImport) + n(f.payout);
  return { revenue, expense, estate: n(s.estateReceived) };
}

const OUT = [['wheat', 'farm'], ['lumber', 'sawmill'], ['flour', 'mill'], ['bread', 'bakery'],
             ['concrete', 'concreteWorks'], ['freshWater', 'waterworks'],
             ['electricity', 'powerPlant'], ['cleaningProducts', 'chemicals'],
             ['metalComponents', 'metalworks'], ['asphalt', 'asphaltPlant']];
const tiles = (n, off) => {
  const o = [];
  for (let i = 0; i < n; i++) { const r = OUT[(i + off) % OUT.length];
    o.push({ key: 't' + i, out: r[0], ind: r[1], lvl: 1 + (i % 3) }); }
  return o;
};

function run(opts) {
  E.mount({ nodeId: opts.node, population: opts.pop, state: null, established: false });
  if (E.setLabourSupply) E.setLabourSupply(null);
  const host = { powerFactor: 1, waterFactor: 1, infrastructure: 0.7,
                 logisticsCounts: { warehouse: 2, depot: 2 }, hasBank: !!opts.bank };
  let resid = 0, auditOk = true, list = [];
  for (let d = 0; d < opts.days; d++) {
    if (opts.churn && d > 1 && d % 9 === 0) list = tiles(8 + ((d / 9) | 0) % 14, d % 7);
    /* ⚠ INSIDE the measured window on purpose. Foundings and wind-ups happen
       between ticks — that is the blind spot the whole exercise is about, and
       a window that excluded them would report a clean reconciliation of a
       ledger nobody could balance in the running game. */
    const t0 = Sim.treasury();
    const c0 = classify(E.snapshot());
    if (opts.churn) { try { E.syncBuildings(list); } catch (e) {} }
    E.tick(DAY, { ...host, population: opts.pop });
    const s = E.snapshot();
    const c1 = classify(s);
    /* `flow.*` was zeroed at the top of this day, so c1's revenue/expense ARE
       the day. Only the estate tally is cumulative and needs a difference. */
    resid += (Sim.treasury() - t0) - (c1.revenue - c1.expense + (c1.estate - c0.estate));
    if (!s.audit || !s.audit.ok) auditOk = false;
  }
  return { resid, auditOk };
}

console.log('— round 1: a plain city, no bank, no building churn');
for (const node of ['recon-a', 'recon-b', 'recon-c']) {
  const r = run({ node, pop: 160, days: 60, bank: false, churn: false });
  chk('60 days of ' + node + ' reconcile exactly', Math.abs(r.resid) < 1e-6, 'residual ' + r.resid);
  chk('…and the simulation audit held', r.auditOk);
}

console.log('— round 2: a city with a bank');
{
  const r = run({ node: 'recon-bank', pop: 220, days: 60, bank: true, churn: false });
  chk('the only gap is the bank capitalisation seed, and it is negative',
      r.resid < 0 && Math.abs(r.resid) < 30000,
      'residual ' + r2(r.resid) + ' 🔥 — sim.js debits the treasury by Bank.capitalise(seed) ' +
      'and writes no flow term for it');
  chk('…and the simulation audit held', r.auditOk);
}

console.log('— round 3: a churning city, and the controlled proof of what the gap is');
{
  const withDraw = run({ node: 'recon-churn', pop: 200, days: 200, bank: true, churn: true });
  const keep = ECON.firm.charter.treasuryDrawPct;
  ECON.firm.charter.treasuryDrawPct = 0;      // the ONE variable that changes
  const noDraw = run({ node: 'recon-churn', pop: 200, days: 200, bank: true, churn: true });
  ECON.firm.charter.treasuryDrawPct = keep;

  chk('a churning city does NOT reconcile from the ledger alone',
      Math.abs(withDraw.resid) > 1000,
      'residual ' + r2(withDraw.resid) + ' 🔥 over 200 days');
  chk('…and turning OFF the founding draw removes almost all of it',
      Math.abs(noDraw.resid) < Math.abs(withDraw.resid) * 0.05,
      'residual falls to ' + r2(noDraw.resid) + ' 🔥, i.e. the gap IS ' +
      'fundFounding()’s treasury draw (sim.js: S.treasury -= fromTreasury), which is ' +
      'recorded in no flow term');
  chk('…and the simulation audit held throughout both runs',
      withDraw.auditOk && noDraw.auditOk,
      'the money is not lost — it is in the new business, and the closed-loop audit sees it');
}

console.log(bad ? '\n❌ ' + bad + ' check(s) failed' : '\n✅ all checks passed');
process.exit(bad ? 1 : 0);
