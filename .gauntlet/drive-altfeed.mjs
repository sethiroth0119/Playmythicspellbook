/* ══════════════════════════════════════════════════════════════════════════
   ⚡ THE ALT_FEEDSTOCK ROUND — production out of nothing.
   ----------------------------------------------------------------------------
   A Purifier with zero rawWater in the city reported HEALTHY and made 1,200
   freshWater. This drives the shipped modules and PRINTS the mechanism rather
   than describing it.

     §1  the unit mechanism: bestLeg() + produce() against a hand-built
         availability map, with a single-leg control beside it.
     §2  the sim mechanism: the same firm inside runDay(), day by day, with the
         city's own inventory of BOTH feedstocks printed beside the output.
     §3  the blast radius: all seven ALT_FEEDSTOCK ids, one city each, zero
         inventory, N days — how much each made out of nothing.
     §4  leg switching still works: coal in the yard, no gas, must run on coal.
     §5  a long run: closures, distress ladder, unfunded seed capital, audit.

   node .gauntlet/drive-altfeed.mjs
   ══════════════════════════════════════════════════════════════════════════ */
global.window = global.window || {};
window.MythicCityBridge = { addCinders: async () => true, getCinders: async () => 9e9 };

/* 🔵 THE BEFORE/AFTER SEAM. `ECON_ALTFEED_TREE=/some/copy/of/src/economy` runs
   this identical script against a different build of the module, so the "before"
   figures come from the SAME instrument as the "after" ones. Round 0s' technique:
   rebuild the tree into a temp directory with the change reverted and import THAT
   — the shipped tree is never written to, and a re-typed copy of the probe would
   be testing a fiction the moment the two drift. */
const TREE = process.env.ECON_ALTFEED_TREE || new URL('../public/src/economy', import.meta.url).pathname;
console.log('# module tree: ' + TREE);
const E      = (await import(TREE + '/index.js')).default;
const Firms  = await import(TREE + '/firms.js');
const Prices = await import(TREE + '/prices.js');
const R      = await import(TREE + '/recipes.js');

const DAY  = 24 * 60;
const HOST = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: .8,
               logisticsCounts: { warehouse: 3, depot: 3 } };
const ALT_IDS = Object.keys(R.ALT_FEEDSTOCK);
let bad = 0;
const chk = (name, cond, extra) => {
  console.log((cond ? '✅ ' : '❌ ') + name + (cond ? '' : (extra ? ' :: ' + extra : '')));
  if (!cond) bad++; return cond;
};
const n0 = (x) => (x || 0).toFixed(0);

/* 🔵 AN EMPTY CITY IS NOT `established:false`. Both mount paths seed a STARTER
   SLATE of un-tiled firms — a Waterworks, a Coal Mine, a Power Plant, nine
   farms — and a probe city with a coal mine in it is not a starved one. That
   read as 46% of phantom electricity which was in fact honestly mined coal.
   Bootstrap firms have no `tileKey`, so `syncBuildings` never reaps them
   (`if (!f.tileKey) continue`); this does, and only the tile the probe places
   is left standing. */
const stripBootstrap = () => {
  for (const f of Firms.all()) if (!f.tileKey) { f.rung = 'BANKRUPT'; f.reported = true; }
  Firms.reap();
};

/* ── §1 THE UNIT MECHANISM ─────────────────────────────────────────────── */
console.log('\n########## §1 the mechanism, executed ##########');
E.mount({ nodeId: 'altfeed-unit', population: 200, established: true });
{
  const mk = (out) => {
    const f = Firms.found(out, { capacity: 100, name: 'probe:' + out });
    f.plannedRate = 100;
    for (const b in f.workers) f.workers[b] = 999;   // fully staffed, so LABOUR is never the binding row
    return f;
  };
  const ctx = { power: 1, water: 1, freight: 1 };

  console.log('  legsOf(freshWater) → ' + JSON.stringify(R.legsOf('freshWater').map(l => l.tag + ':' + Object.keys(l.in))));

  // A. what sim.js actually hands produce(): only the inputs of the leg the
  //    firm ran LAST are in the map. On day 1 that is legs[0].
  const simLike = { rawWater: 0 };                 // reclaimedWater ABSENT
  const both    = { rawWater: 0, reclaimedWater: 0 };

  const bA = Prices.bestLeg('freshWater', simLike);
  const bB = Prices.bestLeg('freshWater', both);
  console.log('  bestLeg(freshWater, {rawWater:0})                    → leg ' + bA.leg.tag +
              ', availability ' + bA.availability.toFixed(2) + ', eff ' + bA.eff.toFixed(3));
  console.log('  bestLeg(freshWater, {rawWater:0, reclaimedWater:0})  → leg ' + bB.leg.tag +
              ', availability ' + bB.availability.toFixed(2) + ', eff ' + bB.eff.toFixed(3));

  const fA = mk('freshWater'); const uA = Firms.produce(fA, 1, simLike, ctx);
  const fB = mk('freshWater'); const uB = Firms.produce(fB, 1, both, ctx);
  // single-leg control: bottledWater needs freshWater and has ONE leg
  const fC = mk('bottledWater'); const uC = Firms.produce(fC, 1, { freshWater: 0 }, ctx);

  console.log('  produce(freshWater, {rawWater:0})                    → ' + n0(uA) +
              ' units, fill ' + fA.lastFill.toFixed(2) + ', bottleneck ' + (fA.lastBottleneck ? fA.lastBottleneck.key : 'NONE'));
  console.log('  produce(freshWater, {rawWater:0, reclaimedWater:0})  → ' + n0(uB) +
              ' units, fill ' + fB.lastFill.toFixed(2) + ', bottleneck ' + (fB.lastBottleneck ? fB.lastBottleneck.key : 'NONE'));
  console.log('  produce(bottledWater, {freshWater:0}) [1 leg, ctrl]  → ' + n0(uC) +
              ' units, fill ' + fC.lastFill.toFixed(2) + ', bottleneck ' + (fC.lastBottleneck ? fC.lastBottleneck.key : 'NONE'));

  chk('single-leg firm with a zero input is correctly stopped', uC === 0, n0(uC));
  chk('multi-leg firm with EVERY leg at zero is stopped', uB === 0, n0(uB));
  console.log('  \u2192 THE MECHANISM: the only difference between those two lines is that');
  console.log('    `reclaimedWater` is ABSENT from the first map, and both bestLeg() and');
  console.log('    produce() read an absent key as 100% available (`== null ? 1`).');
  console.log('    produce() still does, DELIBERATELY \u2014 a caller that passes no map at all');
  console.log('    must be unconstrained, and that is a real call shape. The fix is that');
  console.log('    sim.js no longer leaves a firm\u2019s own leg out of the map. \u00a7\u00a72\u20134 drive that.');
}

/* ── §2 THE SIM MECHANISM ──────────────────────────────────────────────── */
console.log('\n########## §2 the same firm inside runDay() ##########');
{
  /* established:false — no bootstrap firms, so the ONLY business in this city
     is the Purifier and the only rawWater is the rawWater it is given. */
  E.mount({ nodeId: 'altfeed-sim', population: 200, established: false });
  stripBootstrap();
  const PT = [{ key: 'p1', out: 'freshWater', ind: 'utility', lvl: 3, name: 'Purifier' }];
  E.syncBuildings(PT);
  let made = 0;
  const tags = [];
  for (let d = 0; d < 12; d++) {
    E.tick(DAY, HOST);
    E.syncBuildings(PT);
    const f = E.firms().find(x => x.out === 'freshWater');
    const inv = E.inventory();
    made += f.lastProduced || 0;
    tags.push(f.lastLeg ? f.lastLeg.tag : '-');
    if (d < 6 || d === 11) {
      console.log('  d' + (d + 1) + ' leg=' + (f.lastLeg ? f.lastLeg.tag : '-') +
                  ' produced=' + n0(f.lastProduced) +
                  ' rawWater=' + n0(inv.rawWater) + ' reclaimedWater=' + n0(inv.reclaimedWater) +
                  ' rung=' + f.rung + ' fill=' + (f.lastFill || 0).toFixed(2));
    }
  }
  const f = E.firms().find(x => x.out === 'freshWater');
  const dg = E.diagnose(f.id);
  console.log('  tracer says: rung ' + dg.rung + ' · efficiency ' + (dg.efficiency * 100).toFixed(0) +
              '% · cause ' + dg.cause.key + ' (' + dg.cause.label + ') · bottleneck ' +
              (dg.bottleneck ? dg.bottleneck.key : 'NONE'));
  console.log('  legs run over 12 days: ' + tags.join(','));
  console.log('  TOTAL freshWater made from 0 rawWater and 0 reclaimedWater: ' + n0(made));
  console.log('  trace("freshWater") →');
  E.trace('freshWater').forEach(x => console.log('    ' + x.cause.ico + ' ' + x.res + ' · ' + x.step + ' — ' + x.detail));
}

/* ── §3 BLAST RADIUS ───────────────────────────────────────────────────── */
console.log('\n########## §3 blast radius: all seven ALT_FEEDSTOCK ids ##########');
{
  const Sim = await import(TREE + '/sim.js');
  /* Two runs per id, one variable. STARVED zeroes every input of every leg in
     the city's inventory before each tick, so ANY output is output from
     nothing. FED tops up the PRIMARY leg's inputs instead, and is the reference
     for what a supplied plant of the same size makes — without it "it produced
     92,880" is a number with nothing to compare it to. */
  const run = (id, mode) => {
    /* 🔵 established:false, AND THAT MATTERS. On an established node the
       bootstrap founds a full slate of businesses — a probe city with a coal
       mine in it is not a starved one, and it read as 3% of phantom
       electricity that was in fact 2,311 units of honestly mined coal. */
    E.mount({ nodeId: 'radius-' + mode + '-' + id, population: 200, established: false });
    stripBootstrap();
    const TT = [{ key: 't1', out: id, ind: R.industryOf(id), lvl: 3, name: 'probe' }];
    E.syncBuildings(TT);
    const legs = R.legsOf(id);
    const all = new Set(); for (const l of legs) for (const k in l.in) all.add(k);
    let made = 0; const seen = new Set();
    for (let d = 0; d < 30; d++) {
      const INV = Sim.state().INV;
      if (mode === 'starved') { for (const k of all) INV[k] = 0; }
      else { for (const k in legs[0].in) INV[k] = 1e6; }
      E.tick(DAY, HOST);
      E.syncBuildings(TT);
      const f = E.firms().find(x => x.out === id);
      if (!f) break;
      made += f.lastProduced || 0;
      if (f.lastLeg) seen.add(f.lastLeg.tag);
    }
    const f = E.firms().find(x => x.out === id);
    return { made, tags: Array.from(seen).join('/'), rung: f ? f.rung : '-',
             diag: f ? E.diagnose(f.id) : null };
  };
  /* 🔵 THE CONTROL, and it is required. Zeroing the yard before each tick does
     NOT make a city airtight: sim.js still IMPORTS shortfalls inside the same
     tick, so a starved plant can genuinely buy a little fuel and genuinely burn
     it. `bottledWater` has ONE leg and has always been constrained correctly,
     so whatever IT makes under the identical procedure is the import floor —
     the number every ALT_FEEDSTOCK figure has to be read against. */
  const CONTROL = 'bottledWater';
  const rows = ALT_IDS.concat([CONTROL]).map(id => {
    const a = run(id, 'starved'), b = run(id, 'fed');
    /* Do the legs share an input? A shared input is always in the map whichever
       leg is running, so it is the one thing that accidentally protected an id. */
    const legs = R.legsOf(id);
    const sets = legs.map(l => Object.keys(l.in));
    const shared = sets.reduce((acc, k) => acc.filter(x => k.includes(x)));
    return { id, legs: legs.length, starved: a.made, fed: b.made,
             tags: a.tags, cause: a.diag ? a.diag.cause.key : '-', shared: shared.join('+') || '—' };
  });
  console.log('  id             legs  STARVED 30d   FED 30d   phantom%  legs it ran        shared input');
  for (const r of rows) {
    if (r.id === CONTROL) continue;
    const pct = r.fed > 0 ? (100 * r.starved / r.fed) : (r.starved > 0 ? Infinity : 0);
    console.log('  ' + r.id.padEnd(14) + ' ' + String(r.legs).padStart(4) + '  ' +
                n0(r.starved).padStart(11) + '  ' + n0(r.fed).padStart(8) + '  ' +
                (pct.toFixed(0) + '%').padStart(8) + '  ' + r.tags.padEnd(18) + ' ' + r.shared);
  }
  const ctl = rows.find(r => r.id === CONTROL);
  const floor = ctl.fed > 0 ? 100 * ctl.starved / ctl.fed : 0;
  console.log('  \u2500\u2500 control (one leg, always constrained correctly) \u2500\u2500');
  console.log('  ' + ctl.id.padEnd(14) + '    1  ' + n0(ctl.starved).padStart(11) + '  ' +
              n0(ctl.fed).padStart(8) + '  ' + (floor.toFixed(0) + '%').padStart(8) +
              '   \u2190 THE IMPORT FLOOR');
  const affected = rows.filter(r => r.id !== CONTROL &&
                                    r.fed > 0 && (100 * r.starved / r.fed) > floor + 5);
  console.log('  AFFECTED: ' + affected.length + '/' + rows.length + ' → ' + affected.map(r => r.id).join(', '));
  const el = rows.find(r => r.id === 'electricity');
  console.log('  \u26a1 ELECTRICITY: ' + n0(el.starved) + ' units in 30 days with every fuel forced to 0 — ' +
              (el.fed > 0 ? (100 * el.starved / el.fed).toFixed(0) : '?') + '% of what a fully fuelled plant makes.');
  chk('NOTHING is produced above the import floor by a city with none of its feedstocks', affected.length === 0,
      affected.map(r => r.id + '=' + n0(r.starved)).join(' '));
  chk('a FED plant still produces', rows.every(r => r.fed > 0),
      rows.filter(r => !(r.fed > 0)).map(r => r.id).join(','));
}

/* ── §4 LEG SWITCHING MUST STILL WORK ──────────────────────────────────── */
console.log('\n########## §4 coal in the yard, no gas — must still run, on COAL ##########');
{
  const Sim = await import(TREE + '/sim.js');
  const fuels = new Set(); for (const l of R.legsOf('electricity')) for (const k in l.in) fuels.add(k);
  E.mount({ nodeId: 'legswitch', population: 200, established: false });
  stripBootstrap();
  const GT = [{ key: 'g1', out: 'electricity', ind: R.industryOf('electricity'), lvl: 3, name: 'Power Plant' }];
  E.syncBuildings(GT);
  let made = 0; const tags = new Set();
  for (let d = 0; d < 20; d++) {
    const INV = Sim.state().INV;
    for (const k of fuels) INV[k] = 0;          // no gas, no oil, no nuclear, no biomass…
    INV.coal = 100000;                          // …and a full coal yard
    E.tick(DAY, HOST);
    E.syncBuildings(GT);
    const f = E.firms().find(x => x.out === 'electricity');
    if (!f) break;
    made += f.lastProduced || 0;
    if (f.lastLeg) tags.add(f.lastLeg.tag);
  }
  const f = E.firms().find(x => x.out === 'electricity');
  console.log('  20 days, coal only \u2192 ' + n0(made) + ' electricity, legs used: ' +
              Array.from(tags).join(',') + ', rung ' + (f ? f.rung : '-'));
  chk('a plant with coal and no gas still RUNS', made > 100, n0(made));
  chk('and it runs on the COAL leg, not one it has no fuel for',
      tags.size === 1 && tags.has('coal'), Array.from(tags).join(','));
}

/* ── §5 A LONG RUN ─────────────────────────────────────────────────────── */
console.log('\n########## §5 400 economic days, a real board ##########');
{
  /* ⚠ A PRODUCTION CUT HAS SECOND-ORDER EFFECTS AND THIS IS WHERE THEY SHOW.
     Plants that could run on nothing kept a city in electricity, water, steel
     and paper for free. If they now stop, firms fail, the distress ladder
     fills, seed capital goes unfunded and the city browns out — so the numbers
     that matter here are not "did it still tick" but closures, the ladder,
     unfunded foundings and how many days the lights were actually off. */
  E.mount({ nodeId: 'longrun-alt', population: 260, established: true });
  const tiles = [
    { key: 'a', out: 'electricity', lvl: 3, name: 'Power Plant' },
    { key: 'b', out: 'freshWater',  lvl: 2, name: 'Purifier' },
    { key: 'c', out: 'steel',       lvl: 2, name: 'Steel Mill' },
    { key: 'd', out: 'paper',       lvl: 1, name: 'Paper Mill' },
    { key: 'e', out: 'bread',       lvl: 2, name: 'Bakery' },
    { key: 'f', out: 'flour',       lvl: 2, name: 'Mill' },
    { key: 'g', out: 'wheat',       lvl: 2, name: 'Farm' },
    { key: 'h', out: 'coal',        lvl: 2, name: 'Coal Mine' },
    { key: 'i', out: 'rawWater',    lvl: 2, name: 'Water Intake' },
    { key: 'j', out: 'timber',      lvl: 2, name: 'Logging Camp' },
  ].map(t => ({ ...t, ind: R.industryOf(t.out) }));
  E.syncBuildings(tiles);
  let auditFails = 0, worst = 0, darkDays = 0, dryDays = 0, noFeedDays = 0;
  const noFeed = {};
  for (let d = 0; d < 400; d++) {
    E.tick(DAY, HOST);
    E.syncBuildings(tiles);
    const a = E.audit();
    if (a) { if (!a.ok) auditFails++; worst = Math.max(worst, Math.abs(a.err || 0)); }
    const pp = E.firms().find(f => f.tileKey === 'a');
    const pw = E.firms().find(f => f.tileKey === 'b');
    if (pp && (pp.lastProduced || 0) <= 0) darkDays++;
    if (pw && (pw.lastProduced || 0) <= 0) dryDays++;
    let any = false;
    for (const f of E.firms()) if (f.lastNoLeg) { noFeed[f.out] = (noFeed[f.out] || 0) + 1; any = true; }
    if (any) noFeedDays++;
  }
  const snap = E.snapshot();
  const rungs = {};
  for (const f of E.firms()) rungs[f.rung] = (rungs[f.rung] || 0) + 1;
  const inv = E.inventory();
  /* Unfunded seed capital has no snapshot field — it is a log line, so read the
     log, which is what a player would see too. */
  const log = E.log() || [];
  const unf = log.filter(l => /could not be funded/.test(l.text || l.msg || String(l)));
  console.log('  day ' + snap.day + ' · firms ' + E.firms().length + ' · closures ' + E.closures(9999).length);
  console.log('  rungs: ' + JSON.stringify(rungs));
  console.log('  unemployment ' + (snap.unemployment * 100).toFixed(1) + '% · household savings ' +
              n0(snap.savings) + ' · firm cash ' + n0(snap.firmCash) + ' · treasury ' + n0(snap.treasury));
  console.log('  charterIssued ' + n0(snap.charterIssued) + '/' + n0(snap.charterCap) +
              ' · charter fund ' + n0(snap.charter) + ' · equity subscribed ' + n0(snap.equitySubscribed));
  console.log('  under-capitalised foundings logged: ' + unf.length);
  console.log('  DAYS THE POWER PLANT MADE NOTHING: ' + darkDays + '/400 · the Purifier: ' + dryDays + '/400');
  console.log('  days at least one firm had NO FEEDSTOCK AT ALL: ' + noFeedDays + '/400');
  console.log('    which outputs, and on how many days: ' +
              (Object.keys(noFeed).map(k => k + ' ' + noFeed[k]).join(', ') || 'none'));
  console.log('  audit: fails ' + auditFails + '/400, worst |err| ' + worst.toExponential(2) +
              ', ok=' + (E.audit() ? E.audit().ok : '?'));
  console.log('  inventory: electricity ' + n0(inv.electricity) + ' coal ' + n0(inv.coal) +
              ' freshWater ' + n0(inv.freshWater) + ' rawWater ' + n0(inv.rawWater) +
              ' steel ' + n0(inv.steel) + ' bread ' + n0(inv.bread));
  console.log('  totalCinder ' + n0(E.totalCinder()) + ' · payout lifetime ' + n0(snap.payoutLifetime));
  chk('audit closed on every one of the 400 days', auditFails === 0, auditFails + ' failures');
  chk('the city is still standing (firms alive)', E.firms().length > 0, String(E.firms().length));
}

/* ── §6 THE BARE BOARD — a city with NO extraction under it ────────────── */
console.log('\n########## §6 300 days, the same board WITHOUT its mine and intake ##########');
{
  /* The honest worst case, and the one the fix is most likely to be blamed for:
     the same factories with nothing digging anything up. Before the fix this
     city ran on free electricity and free water for ever. */
  E.mount({ nodeId: 'bare-alt', population: 260, established: true });
  const tiles = [
    { key: 'a', out: 'electricity', lvl: 3, name: 'Power Plant' },
    { key: 'b', out: 'freshWater',  lvl: 2, name: 'Purifier' },
    { key: 'c', out: 'steel',       lvl: 2, name: 'Steel Mill' },
    { key: 'e', out: 'bread',       lvl: 2, name: 'Bakery' },
  ].map(t => ({ ...t, ind: R.industryOf(t.out) }));
  E.syncBuildings(tiles);
  let auditFails = 0, darkDays = 0;
  for (let d = 0; d < 300; d++) {
    E.tick(DAY, HOST); E.syncBuildings(tiles);
    const a = E.audit(); if (a && !a.ok) auditFails++;
    const pp = E.firms().find(f => f.tileKey === 'a');
    if (pp && (pp.lastProduced || 0) <= 0) darkDays++;
  }
  const snap = E.snapshot();
  const rungs = {}; for (const f of E.firms()) rungs[f.rung] = (rungs[f.rung] || 0) + 1;
  console.log('  firms ' + E.firms().length + ' · closures ' + E.closures(9999).length +
              ' · rungs ' + JSON.stringify(rungs));
  console.log('  DAYS THE POWER PLANT MADE NOTHING: ' + darkDays + '/300');
  console.log('  unemployment ' + (snap.unemployment * 100).toFixed(1) + '% · treasury ' + n0(snap.treasury) +
              ' · totalCinder ' + n0(E.totalCinder()));
  const pp = E.firms().find(f => f.tileKey === 'a');
  if (pp) {
    const d = E.diagnose(pp.id);
    console.log('  the Power Plant now reads: ' + d.cause.ico + ' ' + d.cause.label +
                ' \u2014 ' + d.cause.fix);
    if (d.noLeg) console.log('    feedstocks it could use: ' + d.feedstocks.join(', '));
  }
  chk('audit closed on every one of the 300 bare days', auditFails === 0, String(auditFails));
}

console.log('\n' + (bad ? '❌ ' + bad + ' failed' : '✅ all checks passed'));
