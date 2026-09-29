/* VERIFIER run A2: is it converging or crawling? plus job-poorness evidence. */
(() => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    if (!nc || !nc.demog || !DG) { say('FAIL no seam'); return; }
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => { const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      return { by, hh }; };
    const row = (t) => { const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{};
      const tot = m.hh || 1;
      const cz = (r.causes||[]).map(c=>c.sign+c.label).join(';').slice(0,90);
      say(`A2 t${t} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(2)} lad ${n(L.unskilled)}/${n(L.advanced)} pop${n(r.population)} [${cz}]`); };
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };
    DG.load({});
    step();
    const E = window.MythicEconomy;
    let lm = null; try { lm = E && E.labourMarket ? E.labourMarket() : null; } catch(e){}
    say('A2 posts=' + JSON.stringify(lm && lm.vacancies ? lm.vacancies : lm).slice(0,150));
    for (let t = 2; t <= 3000; t++) { step(); if (t===400||t===800||t===1200||t===1600||t===2000||t===2500||t===3000) row(t); }
  } catch (e) { say('THREW ' + e.message); }
})();
