/* INDEPENDENT VERIFIER driver. Not the fixer's. Same seam, different questions. */
(() => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics;
    if (!nc || !nc.demog || !DG) { say('FAIL no seam'); return; }
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => {
      const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a] || 0) + st.co[k]; hh += st.co[k]; }
      return { by, hh };
    };
    const row = (tag, t) => {
      const m = mix(); const r = nc.demog.report() || {}; const L = nc.demog.ladder() || {};
      const tot = m.hh || 1;
      say(`${tag} t${t} pop${n(r.population)} hh${n(m.hh)} fam${n(m.by.family)} cpl${n(m.by.couple)} sgl${n(m.by.single)} stu${n(m.by.student)} ret${n(m.by.retired)} retpc${(100*(m.by.retired||0)/tot).toFixed(1)} lad ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)} lim:${r.limit}`);
    };
    const zone = (z) => { window.MythicZoning = { zoneOf: () => z, zoneAt: () => z }; DG.load({}); };

    // ═══ 1. THE RATCHET: towers, job-poor, long horizon
    zone('resHigh');
    say('A homes=' + ((DG.survey() || {}).totalHomes));
    row('A', 0);
    for (let t = 1; t <= 12; t++) { step(); row('A', t); }
    for (let t = 13; t <= 300; t++) { step(); if (t===20||t===40||t===80||t===120||t===200||t===300) row('A', t); }

    // ═══ 2. THE STUDENTS: low rent, every step
    zone('resLowRent');
    say('B homes=' + ((DG.survey() || {}).totalHomes));
    for (let t = 0; t <= 60; t++) {
      if (t) step();
      if (t <= 20 || t % 5 === 0) {
        const m = mix(); const r = nc.demog.report() || {};
        const tot = m.hh || 1;
        say(`B t${t} hh${n(m.hh)} stu${n(m.by.student)} stupc${(100*(m.by.student||0)/tot).toFixed(1)} sgl${n(m.by.single)} ret${n(m.by.retired)} pop${n(r.population)} lim:${r.limit}`);
      }
    }
    for (let t = 61; t <= 200; t++) { step(); }
    { const m = mix(); const tot = m.hh || 1;
      say(`B t200 hh${n(m.hh)} stu${n(m.by.student)} stupc${(100*(m.by.student||0)/tot).toFixed(1)} sgl${n(m.by.single)} ret${n(m.by.retired)}`); }

    // ═══ 3. DIVERGENCE A/B, identical land
    for (const z of ['resLow', 'resLowRent', 'resHigh']) {
      zone(z);
      for (let t = 0; t < 40; t++) step();
      const m = mix(); const r = nc.demog.report() || {}; const L = nc.demog.ladder() || {};
      say(`C ${z} pop${n(r.population)} homes${(DG.survey()||{}).totalHomes} hh${n(m.hh)} fam${n(m.by.family)} cpl${n(m.by.couple)} sgl${n(m.by.single)} stu${n(m.by.student)} ret${n(m.by.retired)} lad ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)} lim:${r.limit}`);
    }

    // ═══ 4. AUDIT
    try {
      const E = window.MythicEconomy;
      const a0 = E && E.audit ? E.audit() : null;
      say('D auditBefore ok=' + (a0 && a0.ok) + ' err=' + (a0 && a0.err) + ' tol=' + (a0 && a0.tol));
      if (E && typeof E.tick === 'function') for (let i = 0; i < 60; i++) { E.tick(20); step(); }
      const a = E && E.audit ? E.audit() : null;
      say('D auditAfter ok=' + (a && a.ok) + ' err=' + (a && a.err) + ' tol=' + (a && a.tol));
      const s = window.Sim && window.Sim.state ? window.Sim.state() : null;
      say('D simLastAudit ' + (s && s.lastAudit ? ('ok=' + s.lastAudit.ok + ' err=' + s.lastAudit.err) : 'n/a'));
    } catch (e) { say('D audit threw ' + e.message); }

    // ═══ 5. SAVE ROUND TRIP + legacy save with no demog key
    try {
      const before = JSON.stringify(nc.demog.blob());
      DG.load(JSON.parse(before));
      const after = JSON.stringify(nc.demog.blob());
      say('E roundTrip ' + (after === before) + ' bytes ' + before.length);
      const raw = nc.serialize ? nc.serialize() : null;
      say('E serializeType ' + (typeof raw) + ' hasDemogKey ' + (typeof raw === 'string' ? ('demog' in (JSON.parse(raw)||{})) : 'n/a'));
      if (typeof raw === 'string') {
        const obj = JSON.parse(raw); delete obj.demog;
        nc.loadState(JSON.stringify(obj));
        say('E legacyLoadOK popAfter=' + n((nc.demog.report()||{}).population) + ' ready=' + DG.ready());
        nc.loadState(raw);
        say('E reloadOK pop=' + n((nc.demog.report()||{}).population));
      }
    } catch (e) { say('E roundTrip threw ' + e.message); }
  } catch (e) { say('THREW ' + e.message + ' | ' + (e.stack||'').slice(0,200)); }
})();
