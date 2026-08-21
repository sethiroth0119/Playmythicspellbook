/* ══════════════════════════════════════════════════════════════════════════
   🪦 DRIVE-MORTALITY — the node half of the mortality round's evidence.

   Six checks, none of which needs a browser:
     A  the conservation law holds over a randomised run (deaths, capacity
        changes, demolitions)                              — model.js audit()
     B  a save round-trips, and a FOREIGN city's graveyard map is refused
     C  a graveyard FILLS: plots run out, plotFactor drops to 0, the surplus
        goes on the waiting list
     D  demolishing a graveyard returns its dead to the waiting list and the
        books still balance
     E  /src/lifepath's stamp table SHRINKS to match a roster that loses people
        — i.e. mortality does not leak stamps into the save forever
     F  /src/demographics writes `died` where and only where it writes the
        terminal-stage half of `out`, and `died <= out` — the "it is a
        breakdown, not a fifth bucket" claim, checked rather than asserted

   Run:  node .gauntlet/drive-mortality.mjs
   ══════════════════════════════════════════════════════════════════════════ */

/* A window, because /src/lifepath probes one. Nothing here is a browser. */
globalThis.window = globalThis.window || {};

const M = await import('../public/src/mortality/model.js');
const LP = await import('../public/src/lifepath/model.js');
const PIPE = await import('../public/src/demographics/pipeline.js');
const Z = await import('../public/src/demographics/zones.js');
const A = await import('../public/src/demographics/archetypes.js');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-6 : t);

/* ── A. THE CONSERVATION LAW UNDER ABUSE ──────────────────────────────── */
console.log('\nA. conservation — 600 randomised steps with capacity churn');
{
  const S = M.makeState();
  // a deterministic LCG so a failure is reproducible
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const ALL = [
    { key: '3,3', plots: 24 }, { key: '4,9', plots: 24 },
    { key: '10,2', plots: 90 }, { key: '11,11', plots: 270 },
  ];
  let worst = 0, totalDeaths = 0, demolitions = 0;
  for (let i = 0; i < 600; i++) {
    // a random subset of the graveyards exists this step — that is the churn
    const sites = ALL.filter(() => rnd() > 0.18);
    if (sites.length !== ALL.length) demolitions++;
    const deaths = rnd() * 2.5;
    totalDeaths += deaths;
    M.step(S, { dtMin: 0.5 + rnd() * 2, deaths, capPerMin: rnd() * 1.2, sites });
    const a = M.audit(S);
    worst = Math.max(worst, Math.abs(a.gap));
    if (!a.ok) { ok('audit at step ' + i, false, a.why); break; }
  }
  const a = M.audit(S);
  ok('books balance every step', a.ok, 'worst gap ' + worst.toExponential(2));
  ok('deaths were actually driven', near(S.lifetime, totalDeaths, 1e-6),
     S.lifetime.toFixed(3) + ' recorded vs ' + totalDeaths.toFixed(3) + ' driven');
  ok('graves + part-dug + waiting === deaths',
     near(M.plotsUsed(S) + S.plotDebt + S.waiting, S.lifetime, 1e-9),
     M.plotsUsed(S) + ' + ' + S.plotDebt.toFixed(4) + ' + ' + S.waiting.toFixed(4) +
     ' = ' + S.lifetime.toFixed(4));
  ok('demolitions actually happened during the run', demolitions > 50, demolitions + ' steps had a site missing');
}

/* ── B. SAVE ROUND TRIP, AND THE FOREIGN-CITY REFUSAL ─────────────────── */
console.log('\nB. persistence');
{
  const S = M.makeState();
  const sites = [{ key: '3,3', plots: 24 }, { key: '9,9', plots: 90 }];
  M.step(S, { dtMin: 60, deaths: 40, capPerMin: 5, sites });
  const blob = M.save(S, 'city-alpha');

  const T = M.makeState();
  const r = M.load(T, blob, 'city-alpha');
  ok('load accepted', r.ok && r.adopted, r.why || '');
  ok('graves survived the trip', M.plotsUsed(T) === M.plotsUsed(S),
     M.plotsUsed(T) + ' vs ' + M.plotsUsed(S));
  ok('waiting survived the trip', near(T.waiting, S.waiting, 5e-4),
     T.waiting.toFixed(4) + ' vs ' + S.waiting.toFixed(4));
  ok('the loaded state passes its own audit', M.audit(T, 1e-3).ok, M.audit(T, 1e-3).why || '');

  const F = M.makeState();
  const fr = M.load(F, blob, 'city-beta');
  ok('a graveyard map from another city is REFUSED, not merged', !fr.ok && M.plotsUsed(F) === 0, fr.why);
}

/* ── C. A GRAVEYARD FILLS ─────────────────────────────────────────────── */
console.log('\nC. plots run out (one Graveyard, 24 plots, 30 dead)');
{
  const S = M.makeState();
  const sites = [{ key: '5,5', plots: 24 }];
  // capacity far above the death rate so PLOTS are the only binding constraint
  M.step(S, { dtMin: 1000, deaths: 30, capPerMin: 10, sites });
  ok('exactly 24 in the ground', M.plotsUsed(S) === 24, M.plotsUsed(S) + ' graves');
  ok('6 waiting', near(S.waiting, 6, 1e-6), S.waiting.toFixed(4));
  ok('plotFactor is 0 for the full plot', M.plotFactor(S, '5,5', 24) === 0);
  ok('plotFactor is 1 for a fresh plot', M.plotFactor(S, '6,6', 24) === 1);
  ok('…and 1 again once the ground is extended (level 2 = 48)',
     M.plotFactor(S, '5,5', 48) === 1);
  ok('books balance', M.audit(S).ok);
}

/* ── D. DEMOLITION RETURNS THE DEAD ───────────────────────────────────── */
console.log('\nD. bulldozing a graveyard');
{
  const S = M.makeState();
  const sites = [{ key: '5,5', plots: 24 }];
  M.step(S, { dtMin: 1000, deaths: 20, capPerMin: 10, sites });
  const buried = M.plotsUsed(S);
  const r = M.step(S, { dtMin: 1, deaths: 0, capPerMin: 0, sites: [] });
  ok('20 were buried first', buried === 20, buried + ' graves');
  ok('all 20 came back to the waiting list', near(S.waiting, 20, 1e-6), S.waiting.toFixed(4));
  ok('the step reported the return', r.returned === 20, String(r.returned));
  ok('no graves left', M.plotsUsed(S) === 0);
  ok('books still balance', M.audit(S).ok, M.audit(S).why || '');
}

/* ── E. STAMPS SHRINK WITH THE ROSTER ─────────────────────────────────── */
console.log('\nE. /src/lifepath stamps follow the roster through N deaths');
{
  const N = 40, KILL = 12;
  let roster = [];
  for (let i = 0; i < N; i++) roster.push({ id: 'c' + i, name: 'Person ' + i, job: null, mood: 60 });

  /* The two seams /src/lifepath probes, shimmed. Nothing here is node-city —
     the point is that seed()'s cleanup is driven by the ROSTER SHRINKING,
     whoever shrank it. */
  window.MythicCitizens = { list: () => roster.map(c => ({ ...c })) };
  window.MythicDemographics = {
    report: () => ({ ok: true, ages: [{ k: 'child', v: 18 }, { k: 'young', v: 22 },
                                      { k: 'adult', v: 44 }, { k: 'senior', v: 16 }] }),
  };
  let t = 400000;                                   // game.cityAge seconds
  LP.bind({ now: () => t, cycleMin: () => 20 });

  const s1 = LP.seed();
  ok('the roster was stamped', s1.ok && LP.count() === N, LP.count() + ' stamps for ' + N + ' people');

  /* The removal: the OLDEST first, which is the order /src/mortality retires
     in and the opposite of citEnsure()'s LIFO pop. */
  for (let i = 0; i < KILL; i++) {
    let best = null, bv = -Infinity;
    for (const c of roster) { const a = LP.ageOf(c.id); const v = a && a.ok ? a.years : -1; if (v > bv) { bv = v; best = c.id; } }
    roster = roster.filter(c => c.id !== best);
  }
  ok('the roster shrank', roster.length === N - KILL, roster.length + ' left');
  ok('…but the stamps have NOT been cleaned yet', LP.count() === N,
     LP.count() + ' stamps still held before seed() runs');

  const s2 = LP.seed();
  ok('seed() dropped every stamp for a person who is gone',
     LP.count() === N - KILL, LP.count() + ' stamps for ' + (N - KILL) + ' people');
  ok('…and re-dealt nobody who is still here', s2.stamped === 0, s2.stamped + ' new stamps');

  /* And the regrowth case: citEnsure() mints NEW ids, never the dead ones. */
  for (let i = 0; i < KILL; i++) roster.push({ id: 'c' + (N + i), name: 'New ' + i, job: null, mood: 60 });
  const s3 = LP.seed();
  ok('replacements were stamped', s3.stamped === KILL, s3.stamped + ' new stamps');
  ok('the table is exactly the roster, no leak', LP.count() === roster.length,
     LP.count() + ' stamps for ' + roster.length + ' people');
  const st = LP.stamps();
  ok('no dead id survived in the table',
     Object.keys(st).every(k => roster.some(c => c.id === k)));
}

/* ── F. `died` IS A BREAKDOWN OF `out`, NOT A FIFTH BUCKET ────────────── */
console.log('\nF. /src/demographics — the died bucket');
{
  PIPE.reset();
  const S = PIPE.state();
  const zids = Z.zoneIds();
  const zid = zids.includes('resLow') ? 'resLow' : zids[0];
  const edu = A.eduOrder()[0];

  /* A city that is nothing but pensioners: the terminal stage is then the
     ONLY outflow the life course can produce, which is what isolates it. */
  S.co[zid + '|retired|' + edu] = 400;
  S.seeded = true;

  const survey = {
    totalHomes: 900, totalCapacity: 2200,
    homes: { [zid]: 900 }, capacity: { [zid]: 2200 },
  };
  const ctx = { survey, budget: 5000, posts: null, seekers: 50, services: 1 };

  let died = 0, out = 0;
  for (let i = 0; i < 8; i++) {
    PIPE.step(1, ctx);
    died += S.flow.died; out += S.flow.out;
  }
  ok('somebody died', died > 0, died.toFixed(3) + ' people over 8 economic days');
  ok('the monotone cursor agrees with the per-step bucket',
     near(S.deaths, died, 1e-6), S.deaths.toFixed(3) + ' vs ' + died.toFixed(3));
  ok('died is a SUBSET of out (out >= died)', out + 1e-9 >= died,
     'out ' + out.toFixed(3) + ' vs died ' + died.toFixed(3));
  ok('the day rollover carries died', S.day.died > 0, S.day.died.toFixed(4) + '/day');
  ok('rate.out did NOT double-count it',
     near(S.rate.out, S.day.out + S.day.evicted, 1e-9),
     S.rate.out.toFixed(4) + ' === out ' + S.day.out.toFixed(4) + ' + evicted ' + S.day.evicted.toFixed(4));

  /* THE JOIN: /src/mortality differences exactly this counter, so a driver can
     integrate it and get graves. Proved here end to end. */
  const G = M.makeState();
  M.step(G, { dtMin: 60, deaths: S.deaths, capPerMin: 1, sites: [{ key: '2,2', plots: 24 }] });
  ok('mortality buries what demographics counted',
     near(M.plotsUsed(G) + G.plotDebt + G.waiting, S.deaths, 1e-6),
     M.plotsUsed(G) + ' graves + ' + G.waiting.toFixed(3) + ' waiting = ' + S.deaths.toFixed(3) + ' deaths');
}

console.log('\n' + (fails ? '❌ ' + fails + ' CHECK(S) FAILED' : '✅ MORTALITY MODEL GATE PASSED'));
process.exit(fails ? 1 : 0);
