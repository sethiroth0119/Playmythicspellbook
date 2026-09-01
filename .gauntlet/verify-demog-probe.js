/* VERIFIER probe: WHY do students still decay in a standalone low-rent run?
   Imports the real modules in the page and reads rent, income, burden, fit. */
(async () => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    const A = await import('/src/demographics/archetypes.js?probe=1');
    const Z = await import('/src/demographics/zones.js?probe=1');
    const P = await import('/src/demographics/pipeline.js?probe=1');
    const T = await import('/src/economy/tuning.js?probe=1');
    const dm = T.ECON.demographics;
    say('X turnover resLowRent=' + Z.turnoverOf('resLowRent') + ' resHigh=' + Z.turnoverOf('resHigh') +
        ' life=' + JSON.stringify(dm.lifecycle) + ' draw=' + dm.arrival.workerlessDrawPerWorkerHH +
        ' sup=' + dm.income.studentSupportShare);
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    window.MythicZoning = { zoneOf: () => 'resLowRent', zoneAt: () => 'resLowRent' };
    DG.load({});
    const rowP = (t) => {
      const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      const tight = st.rentIndex;
      const rent = dm.zones.resLowRent.rent * (T.ECON.demographics.rent.base || 1) * tight;
      const E = window.MythicEconomy;
      let lm = null; try { lm = E && E.labourMarket ? E.labourMarket() : null; } catch (e) {}
      let sk = 0; try { const s = E && E.snapshot ? E.snapshot() : null; sk = s ? s.laborForce : -1; } catch (e) {}
      const fit = P.jobFitByEducation(lm && lm.vacancies, Math.max(1, sk > 0 ? sk : Math.round(P.population()*0.62)));
      const inc = A.incomeOf('student', 'basic', fit.basic);
      const r2 = (typeof P.rentOf === 'function') ? P.rentOf('resLowRent', tight) : rent;
      say(`X t${t} hh${n(hh)} stu${n(by.student)} occ${(100*hh/1296).toFixed(1)} tight${tight.toFixed(3)} rent${r2.toFixed(2)} stuInc${inc.toFixed(2)} burden${(r2/inc).toFixed(3)} max${dm.rent.burdenMax} fitB${(fit.basic||0).toFixed(3)} seek${n(sk)}`);
    };
    rowP(0);
    for (let t = 1; t <= 60; t++) { step(); if (t<=6 || t===10 || t===20 || t===40 || t===60) rowP(t); }
  } catch (e) { say('X THREW ' + e.message + ' | ' + (e.stack||'').slice(0,200)); }
})()
