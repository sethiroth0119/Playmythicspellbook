/* VERIFIER run B: the student district. Low-rent zoning, filled past the
   'homes' limit, student household count at every step. */
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
    window.MythicZoning = { zoneOf: () => 'resLowRent', zoneAt: () => 'resLowRent' };
    DG.load({});
    const sv = DG.survey() || {};
    say('B homes=' + sv.totalHomes);
    const row = (t) => { const m = mix(); const r = nc.demog.report()||{}; const tot = m.hh || 1;
      say(`B t${t} hh${n(m.hh)} stu${n(m.by.student)} stu%${(100*(m.by.student||0)/tot).toFixed(1)} sgl${n(m.by.single)} cpl${n(m.by.couple)} fam${n(m.by.family)} ret${n(m.by.retired)} pop${n(r.population)} lim:${r.limit}`); };
    row(0);
    for (let t = 1; t <= 200; t++) { step(); if (t<=12 || t===20 || t===30 || t===40 || t===60 || t===100 || t===200) row(t); }
  } catch (e) { say('THREW ' + e.message); }
})();
