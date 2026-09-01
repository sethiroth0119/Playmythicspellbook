/* VERIFIER run A: the all-retired ratchet, towers, long horizon. */
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
      say(`A t${t} hh${n(m.hh)} f${n(m.by.family)} c${n(m.by.couple)} s${n(m.by.single)} u${n(m.by.student)} r${n(m.by.retired)} r%${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)} pop${n(r.population)} lim:${r.limit}`); };
    window.MythicZoning = { zoneOf: () => 'resHigh', zoneAt: () => 'resHigh' };
    DG.load({});
    say('A homes=' + ((DG.survey()||{}).totalHomes));
    row(0);
    for (let t = 1; t <= 400; t++) { step(); if (t<=9 || t===12 || t===20 || t===40 || t===80 || t===150 || t===250 || t===400) row(t); }
    const E = window.MythicEconomy; const a = E && E.audit ? E.audit() : null;
    say('A audit ok=' + (a&&a.ok) + ' err=' + (a&&a.err) + ' tol=' + (a&&a.tol));
  } catch (e) { say('THREW ' + e.message); }
})();
