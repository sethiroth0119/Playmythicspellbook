/* VERIFIER run H: the fit cliff. Sweep job fit finely across arrival.jobFloor
   (0.05) and departure.jobPanic (0.35) and report the steady state at 300 days. */
(() => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    const real = window.MythicEconomy || {};
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => { const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      return { by, hh }; };
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };
    const SEEK = 2000;
    for (const f of [0.60, 0.40, 0.30, 0.12, 0.08, 0.06, 0.055, 0.045, 0.02]) {
      const v = Math.round(f * SEEK);
      const stub = {}; for (const k in real) { try { stub[k] = typeof real[k]==='function'?real[k].bind(real):real[k]; } catch(e){} }
      stub.ready = () => true;
      stub.labourMarket = () => ({ vacancies: { unskilled: v, skilled: 0, technical: 0, advanced: 0 } });
      stub.snapshot = () => ({ laborForce: SEEK, satisfaction: { food: 0.6, water: 0.6 } });
      window.MythicEconomy = stub;
      DG.load({});
      for (let t = 0; t < 300; t++) step();
      const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{}; const tot = m.hh||1;
      say(`H fit${f} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.advanced)} pop${n(r.population)} lim:${r.limit}`);
    }
    window.MythicEconomy = real;
  } catch (e) { say('H THREW ' + e.message); }
})();
