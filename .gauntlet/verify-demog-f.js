/* VERIFIER run F: towers with the ECONOMY TICKING ALONGSIDE, the faithful
   host ordering, plus a job-market gradient at the end. */
(async () => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics, E0 = window.MythicEconomy;
    const P = await import('/src/demographics/pipeline.js?f=1');
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => { const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      return { by, hh }; };
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };
    DG.load({});
    const row = (tag, t) => { const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{};
      const tot = m.hh || 1; let lm=null, sk=-1;
      try { lm = E0.labourMarket().vacancies; } catch(e){}
      try { sk = E0.snapshot().laborForce; } catch(e){}
      say(`${tag} t${t} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.advanced)} pop${n(r.population)} posts${JSON.stringify(lm).slice(0,50)} seek${n(sk)}`); };
    for (let t = 1; t <= 400; t++) { E0.tick(20); step(); if (t<=4||t===10||t===40||t===100||t===200||t===400) row('F', t); }
    const a = E0.audit ? E0.audit() : null;
    say('F audit ok=' + (a&&a.ok) + ' err=' + (a&&a.err) + ' tol=' + (a&&a.tol));

    // ── gradient: how job-poor does it have to be before the city dies?
    const real = E0;
    for (const v of [200, 80, 30, 10, 3]) {
      const stub = {}; for (const k in real) { try { stub[k] = typeof real[k]==='function'?real[k].bind(real):real[k]; } catch(e){} }
      stub.ready = () => true;
      stub.labourMarket = () => ({ vacancies: { unskilled: v, skilled: v, technical: Math.round(v/3), advanced: Math.round(v/6) } });
      stub.snapshot = () => ({ laborForce: 2000, satisfaction: { food: 0.6, water: 0.6 } });
      window.MythicEconomy = stub;
      DG.load({});
      for (let t = 0; t < 300; t++) step();
      const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{}; const tot = m.hh||1;
      say(`G posts${v} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.advanced)} pop${n(r.population)} lim:${r.limit}`);
    }
    window.MythicEconomy = real;
  } catch (e) { say('F THREW ' + e.message + ' | ' + (e.stack||'').slice(0,180)); }
})()
