/* 👥 DRIVE THE DEMOGRAPHICS FIX on the 172-tile gauntlet district, in the page.
   Zones every housing plot as TOWERS — the case that used to lock into ~100%
   retired with a zero labour force from t5 onward — steps well past t5, and
   reads the cohort mix, the labour ladder, the closed-loop audit and the save
   round-trip back out.

   ⚠ THE HOST'S citycap GATE IS OPENED HERE BY SUPPLYING THE BUDGET, NOT BY
     DISABLING THE GATE. node-city grows cityPop() only while food/water/health
     coverage >= 90% and the gauntlet district never reaches it, so BOTH zonings
     sit at 4 residents and the zoning cannot be read at all. `DEMAND_PER_POP` is
     a top-level const and invisible from here anyway (the globals trap). So this
     calls the SHIPPED tick signature — MythicDemographics.tick(dtMin, {parcels,
     population}) — with the shipped `demogParcels()` handover and the population
     the host WOULD report if its coverage were good. Nothing in public/src is
     changed and the shipped gate is untouched.
   ⚠ shot.mjs truncates each console line at 400 chars, so every row is its own
     short line rather than one JSON blob that would silently lose its tail.
   ⚠ __nc.serialize() returns a JSON STRING, not an object. The original
     round-trip snippet parsed nothing and would have silently tested nothing. */
(() => {
  const say = (s) => console.log('DGF ' + s);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    if (!nc || !nc.demog || !DG) { say('FAIL no seam'); return; }

    // Zone every plot as towers: the job-poor city the ratchet fed on.
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };

    const BUDGET = 4000;                       // the host's cap, opened (see header)
    const step = (mins) => DG.tick(mins, { parcels: nc.demog.parcels(), population: BUDGET });

    const row = (t) => {
      const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a] || 0) + st.co[k]; hh += st.co[k]; }
      const r = nc.demog.report() || {}; const L = nc.demog.ladder() || {};
      const n = (v) => Math.round(v || 0);
      say(`t${t} pop${n(r.population)} hh${n(hh)} fam${n(by.family)} cpl${n(by.couple)} sgl${n(by.single)}` +
          ` stu${n(by.student)} ret${n(by.retired)} ladder ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)}` +
          ` lim:${r.limit}`);
    };

    say('zoned resHigh, homes=' + ((DG.survey() || {}).totalHomes));
    row(0);
    for (let t = 1; t <= 24; t++) { step(20); if (t <= 8 || t % 8 === 0) row(t); }

    // ── the closed loop must still balance
    try {
      /* `MythicEconomy.audit()` IS `Sim.state().lastAudit` — index.js:726 exposes
         it deliberately so a tester can prove the closed loop. Step the economy
         forward first: an audit read before any economic day has run reports the
         bootstrap window, not this run. */
      const E = window.MythicEconomy;
      if (E && typeof E.tick === 'function') for (let i = 0; i < 40; i++) E.tick(20);
      const a = E && typeof E.audit === 'function' ? E.audit() : null;
      /* Plain fields, not JSON: the harness prints its logs INSIDE a JSON blob,
         so a nested JSON string comes back escaped and unreadable. */
      say(a ? ('audit ok=' + a.ok + ' err=' + a.err + ' tol=' + a.tol + ' keys=' + Object.keys(a).join(','))
            : 'audit none');
    } catch (e) { say('audit threw ' + e.message); }

    // ── save round-trip, and the string/object trap the last driver fell into
    try {
      const before = JSON.stringify(nc.demog.blob());
      DG.load(JSON.parse(before));
      const raw = nc.serialize ? nc.serialize() : null;
      say('roundTrip ' + (JSON.stringify(nc.demog.blob()) === before) +
          ' citySaveIsString ' + (typeof raw === 'string') + ' blobBytes ' + before.length);
    } catch (e) { say('roundTrip threw ' + e.message); }

    // ── and the same land zoned three ways, to prove zoning still reads through
    for (const z of ['resLow', 'resLowRent', 'resHigh']) {
      window.MythicZoning = { zoneOf: () => z, zoneAt: () => z };
      DG.load({});                                  // fresh cohorts, same land
      for (let t = 0; t < 40; t++) step(20);
      const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a] || 0) + st.co[k]; hh += st.co[k]; }
      const r = nc.demog.report() || {}; const L = nc.demog.ladder() || {};
      const n = (v) => Math.round(v || 0);
      say(`AB ${z} pop${n(r.population)} homes${(DG.survey() || {}).totalHomes} hh${n(hh)}` +
          ` fam${n(by.family)} cpl${n(by.couple)} sgl${n(by.single)} stu${n(by.student)} ret${n(by.retired)}` +
          ` adv${n(L.advanced)} lim:${r.limit}`);
    }
  } catch (e) { say('THREW ' + e.message); }
})();
