/* VERIFIER run P: a GENUINELY JOB-POOR tower city — the condition the
   all-retired attractor needed. The economy seam is wrapped (not disabled) so
   labourMarket() posts almost nothing against a large labour force, driving
   jobFitByEducation() to ~0 for every rung. Everything else is the shipped path. */
(() => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    if (!nc || !nc.demog || !DG) { say('FAIL no seam'); return; }
    const real = window.MythicEconomy || {};
    const stub = Object.create(Object.getPrototypeOf(real));
    for (const k in real) { try { stub[k] = typeof real[k] === 'function' ? real[k].bind(real) : real[k]; } catch (e) {} }
    stub.ready = () => true;
    stub.labourMarket = () => ({ vacancies: { unskilled: 3, skilled: 0, technical: 0, advanced: 0 } });
    stub.snapshot = () => ({ laborForce: 2000, satisfaction: { food: 0.5, water: 0.5 } });
    window.MythicEconomy = stub;

    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => { const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      return { by, hh }; };
    const row = (t) => { const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{};
      const tot = m.hh || 1;
      say(`P t${t} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)} pop${n(r.population)} lim:${r.limit}`); };
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };
    DG.load({});
    say('P homes=' + ((DG.survey()||{}).totalHomes));
    for (let t = 1; t <= 600; t++) { step(); if (t<=9 || t===12 || t===20 || t===40 || t===100 || t===250 || t===600) row(t); }
  } catch (e) { say('THREW ' + e.message + ' ' + (e.stack||'').slice(0,150)); }
})();
