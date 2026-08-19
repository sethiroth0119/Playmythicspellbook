/* 🔌 THE POWER-TRADE GATE — /src/power/link.js + /src/economy settleUtility().
   ----------------------------------------------------------------------------
   Run:  node .gauntlet/verify-power-trade.mjs
   Exits non-zero on any failure.

   Six rounds, and every one of them exists because ECONOMY.md says the four
   money leaks it documents "all looked correct in review":

     1 CONSERVATION      240 economic days with the link running flat out in
                         each direction. `audit().ok` every single day, and the
                         audit is the thing that suspends the payout when Cinder
                         is created or destroyed.
     2 EXPORT IS NOT A   The Cinder an export earns must arrive through the ONE
       SECOND FAUCET     capped faucet, so `flow.faucet` moves and nothing else
                         creates money. Checked by DELTA, not by inspection.
     3 IMPORT IS PAID    Energy delivered and not paid for must become arrears,
       OR OWED           never a write-off — the "credited whether or not the
                         shop could pay" leak, in the other direction.
     4 NO ROUND TRIP     Import then export the same energy and the city must be
                         POORER. If the spread ever inverts, two cities can
                         launder electricity between them forever.
     5 SAVE/LOAD         An unpaid bill must survive a reload, or the reload
                         button clears the debt — exactly the bug gauntlet2
                         caught twice already (`loanId`, `blacklistUntil`).
     6 THE PAYOUT        sim.js warns that any new claim on the treasury "buys
       CHANNEL           itself back out of the payout basis, and can hand the
                         player MORE than it took" (measured once at +61.3%).
                         An import must not RAISE the owner's take.

   🧨 AND IT HAS BEEN SEEN TO FAIL. "A tripwire nobody has ever seen trip is a
      comment" (run.mjs). Both halves were proved by injuring sim.js once each
      and running this file against the injury:
        · `S.treasury += earned` in settleUtility() — i.e. crediting the export
          straight to the city instead of through the faucet, which is the
          Cinder Forge's exact shape → round 1 reported 240 audit failures out
          of 240 days and round 2's day-of-arrival check went red.
        · `U.arrears = 0` — i.e. writing off energy the city could not pay for
          → rounds 3 and 5 went red (0.00 🔥 of arrears, and nothing to survive
          the reload) while the audit stayed perfectly clean, which is exactly
          why round 3 does not settle for asking the audit. */

const root = '/home/user/Playmythicspellbook';
const E = await import(root + '/public/src/economy/index.js');
const api = E.default || E;

let bad = 0;
const ok  = (m) => console.log('✅ ' + m);
const err = (m) => { bad++; console.log('❌ ' + m); };
const chk = (c, m) => (c ? ok(m) : err(m));

const HOST = { population: 40, powerFactor: 1, waterFactor: 1, logisticsCounts: {},
               hasBank: false, infrastructure: 0.6 };

/* A city, run for `days` economic days, with `per(day)` returning the utility
   trade to note during that day. dtMin 20 = exactly one economic day. */
function city(days, per) {
  api.mount({ nodeId: 'ouro-2', population: 40, established: false });
  let audits = 0, bads = 0;
  for (let d = 0; d < days; d++) {
    const t = per ? per(d) : null;
    if (t) api.utilityTrade(t);
    api.tick(20, HOST);
    const a = api.snapshot().audit;
    if (a) { audits++; if (!a.ok) bads++; }
  }
  return { snap: api.snapshot(), audits, bads };
}

/* Full-tilt link, priced exactly as /src/power/link.js prices it. 12 unit/min
   over a 20-minute economic day = 240 unit-minutes. */
const P = await import(root + '/public/src/power/tuning.js');
const POWER = P.POWER;
const UM   = POWER.trade.linkUnitMin * 20;
const IMPV = UM * POWER.trade.tariff * (1 + POWER.trade.spread);
const EXPV = UM * POWER.trade.tariff * (1 - POWER.trade.spread);
console.log('link ' + POWER.trade.linkUnitMin + ' unit/min → ' + UM + ' unit-min/day; import ' +
            IMPV.toFixed(2) + ' 🔥/day, export ' + EXPV.toFixed(2) + ' 🔥/day');

/* ── 1. CONSERVATION ─────────────────────────────────────────────────────── */
{
  const a = city(240, () => ({ exportValue: EXPV, exportUnitMin: UM }));
  chk(a.bads === 0, 'exporting 240 days: audit clean every day (' + a.audits + ' audits, ' + a.bads + ' failures)');
  chk(a.snap.payoutAllowed, 'exporting 240 days: payouts never suspended');
  const b = city(240, () => ({ importValue: IMPV, importUnitMin: UM }));
  chk(b.bads === 0, 'importing 240 days: audit clean every day (' + b.audits + ' audits, ' + b.bads + ' failures)');
  chk(b.snap.payoutAllowed, 'importing 240 days: payouts never suspended');
  const c = city(240, (d) => (d % 2 ? { importValue: IMPV, importUnitMin: UM }
                                    : { exportValue: EXPV, exportUnitMin: UM }));
  chk(c.bads === 0, 'alternating 240 days: audit clean every day');
}

/* ── 2. THE EXPORT ARRIVES THROUGH THE ONE FAUCET ────────────────────────── */
{
  api.mount({ nodeId: 'ouro-2', population: 40, established: false });
  for (let d = 0; d < 30; d++) api.tick(20, HOST);
  const base = api.snapshot();
  api.utilityTrade({ exportValue: EXPV, exportUnitMin: UM });
  api.tick(20, HOST);
  const after = api.snapshot();
  chk(Math.abs(after.flow.faucet - EXPV) < 0.01,
      'export revenue enters as faucet: flow.faucet = ' + after.flow.faucet.toFixed(2) + ' (expected ' + EXPV.toFixed(2) + ')');
  chk(Math.abs(after.flow.utilityExport - EXPV) < 0.01, 'flow.utilityExport is the same Cinder, broken out');
  chk(after.audit.ok, 'and the day it arrives audits clean');
  chk(base.flow.faucet === 0, 'control: this city has no goods faucet of its own, so the figure is unambiguous');
}

/* ── 2b. AND IT IS UNDER THE SAME CEILING ────────────────────────────────────
   The whole argument for routing the export through the goods faucet rather
   than beside it is that `ECON.faucet.maxPerMin` then bounds BOTH. A second
   faucet with its own clamp is still two faucets, and the Forge is what two
   faucets look like from inside. So: hand it an absurd figure and check the
   clamp bites at the shared per-day ceiling and not at some larger number. */
{
  const ECON = (await import(root + '/public/src/economy/tuning.js')).ECON;
  const capPerDay = ECON.faucet.maxPerMin * ECON.clock.dayMin;
  api.mount({ nodeId: 'ouro-2', population: 40, established: false });
  for (let d = 0; d < 30; d++) api.tick(20, HOST);
  api.utilityTrade({ exportValue: 1e9, exportUnitMin: 1e9 });
  api.tick(20, HOST);
  const s = api.snapshot();
  chk(Math.abs(s.flow.faucet - capPerDay) < 0.01,
      'an absurd export is clamped to the SHARED faucet ceiling (' + s.flow.faucet.toFixed(0) +
      ' vs ' + capPerDay + ' 🔥/day), not to a ceiling of its own');
  chk(s.audit.ok, 'and the clamped day still audits clean');
}

/* ── 3. UNPAYABLE IMPORT BECOMES ARREARS, NOT A GIFT ─────────────────────── */
{
  api.mount({ nodeId: 'ouro-2', population: 40, established: false });
  for (let d = 0; d < 30; d++) api.tick(20, HOST);
  const bill = api.snapshot().treasury + 5000;      // deliberately unaffordable
  api.utilityTrade({ importValue: bill, importUnitMin: UM });
  api.tick(20, HOST);
  const s = api.snapshot();
  chk(s.utility.arrears > 0, 'an unpayable bill leaves arrears (' + s.utility.arrears.toFixed(2) + ' 🔥), it is not written off');
  chk(s.audit.ok, 'and the audit is clean — nothing was created to cover it');
  chk(Math.abs((s.utility.last.paid + s.utility.arrears) - bill) < 0.01,
      'paid + arrears === billed (' + s.utility.last.paid.toFixed(2) + ' + ' + s.utility.arrears.toFixed(2) + ')');
  // …and it keeps being chased on later days rather than fading.
  const a0 = s.utility.arrears;
  api.tick(20, HOST);
  const s2 = api.snapshot();
  chk(s2.utility.arrears <= a0 + 0.001, 'the debt is re-billed the next day, never grown by the re-bill');
}

/* ── 4. A ROUND TRIP LOSES MONEY ─────────────────────────────────────────── */
{
  const flat = city(120, null).snap;
  const loop = city(120, () => ({ importValue: IMPV, importUnitMin: UM,
                                  exportValue: EXPV, exportUnitMin: UM })).snap;
  chk(IMPV > EXPV, 'the tariff spread runs against the city in both directions (' +
      IMPV.toFixed(2) + ' in vs ' + EXPV.toFixed(2) + ' out per day)');
  chk(loop.totalCinder < flat.totalCinder + 0.01,
      'importing and exporting the same energy leaves the city no better off (' +
      loop.totalCinder.toFixed(1) + ' vs ' + flat.totalCinder.toFixed(1) + ')');
}

/* ── 5. THE DEBT SURVIVES A RELOAD ───────────────────────────────────────── */
{
  api.mount({ nodeId: 'ouro-2', population: 40, established: false });
  for (let d = 0; d < 30; d++) api.tick(20, HOST);
  api.utilityTrade({ importValue: api.snapshot().treasury + 5000, importUnitMin: UM });
  api.tick(20, HOST);
  const before = api.snapshot().utility.arrears;
  const blob = JSON.parse(JSON.stringify(api.serialize()));
  api.load(blob);
  const after = api.snapshot().utility.arrears;
  chk(before > 0 && Math.abs(after - before) < 0.02,
      'an unpaid electricity bill survives save/load (' + before.toFixed(2) + ' → ' + after.toFixed(2) + ')');
  // …and so does an unsettled bill that has not reached a day boundary yet.
  api.utilityTrade({ importValue: 40, importUnitMin: 10 });
  const b2 = JSON.parse(JSON.stringify(api.serialize()));
  api.load(b2);
  chk(Math.abs(api.snapshot().utility.pendingImport - 40) < 0.02,
      'energy burned between two economic days is still owed after a reload');
}

/* ── 6. THE IMPORT DOES NOT FUND ITSELF ──────────────────────────────────── */
{
  const flat = city(240, null).snap;
  const imp  = city(240, () => ({ importValue: IMPV, importUnitMin: UM })).snap;
  const dOwner = imp.payoutLifetime + imp.payoutOwed - (flat.payoutLifetime + flat.payoutOwed);
  console.log('   owner take: flat ' + (flat.payoutLifetime + flat.payoutOwed).toFixed(2) +
              ' 🔥, importing ' + (imp.payoutLifetime + imp.payoutOwed).toFixed(2) + ' 🔥  (Δ ' + dOwner.toFixed(2) + ')');
  chk(dOwner <= 0.5,
      'a city that BUYS power does not pay its owner MORE than one that does not — the self-funding-charge channel sim.js warns about is shut');
  const exp = city(240, () => ({ exportValue: EXPV, exportUnitMin: UM })).snap;
  const eOwner = exp.payoutLifetime + exp.payoutOwed - (flat.payoutLifetime + flat.payoutOwed);
  console.log('   owner take: exporting ' + (exp.payoutLifetime + exp.payoutOwed).toFixed(2) + ' 🔥  (Δ ' + eOwner.toFixed(2) + ')');
  chk(eOwner > 0, 'and a city that SELLS power does pay its owner more — the feature is worth using');
}

console.log(bad ? '\n❌ POWER TRADE: ' + bad + ' failure(s)' : '\n✅ POWER TRADE: all rounds passed');
process.exit(bad ? 1 : 0);
