/* VERIFIER run C: divergence on identical land, audit, save round-trip. */
(() => {
  const say = (s) => console.log('VER ' + s);
  const n = (v) => Math.round(v || 0);
  try {
    const nc = window.__nc, DG = window.MythicDemographics, E = window.MythicEconomy;
    const BUDGET = 4000;
    const step = () => DG.tick(20, { parcels: nc.demog.parcels(), population: BUDGET });
    const mix = () => { const st = DG.state(); const by = {}; let hh = 0;
      for (const k in st.co) { const a = k.split('|')[1]; by[a] = (by[a]||0) + st.co[k]; hh += st.co[k]; }
      return { by, hh }; };
    const a0 = E && E.audit ? E.audit() : null;
    say('C auditAtStart ok=' + (a0&&a0.ok) + ' err=' + (a0&&a0.err));
    for (const z of ['resLow', 'resLowRent', 'resHigh']) {
      window.MythicZoning = { zoneOf: () => z, zoneAt: () => z };
      DG.load({});
      for (let t = 0; t < 60; t++) { E.tick(20); step(); }
      const m = mix(); const r = nc.demog.report()||{}; const L = nc.demog.ladder()||{}; const tot = m.hh||1;
      say(`C ${z} pop${n(r.population)} homes${(DG.survey()||{}).totalHomes} hh${n(m.hh)} fam${n(m.by.family)}(${(100*(m.by.family||0)/tot).toFixed(0)}%) cpl${n(m.by.couple)} sgl${n(m.by.single)}(${(100*(m.by.single||0)/tot).toFixed(0)}%) stu${n(m.by.student)}(${(100*(m.by.student||0)/tot).toFixed(0)}%) ret${n(m.by.retired)} lad ${n(L.unskilled)}/${n(L.skilled)}/${n(L.technical)}/${n(L.advanced)} lim:${r.limit}`);
      const a = E && E.audit ? E.audit() : null;
      say(`C ${z} audit ok=${a&&a.ok} err=${a&&a.err} tol=${a&&a.tol}`);
    }
    try {
      const before = JSON.stringify(nc.demog.blob());
      DG.load(JSON.parse(before));
      say('C roundTrip ' + (JSON.stringify(nc.demog.blob()) === before) + ' bytes ' + before.length);
      const raw = nc.serialize ? nc.serialize() : null;
      say('C serializeType ' + (typeof raw));
      if (typeof raw === 'string') {
        const obj = JSON.parse(raw); const had = 'demog' in obj; delete obj.demog;
        nc.loadState(JSON.stringify(obj));
        say('C legacySaveNoDemogKey hadKey=' + had + ' loadedOK pop=' + n((nc.demog.report()||{}).population) + ' ready=' + DG.ready() + ' seeded=' + !!(DG.state()&&Object.keys(DG.state().co).length));
        nc.loadState(raw);
        say('C reloadWithDemog pop=' + n((nc.demog.report()||{}).population));
      }
    } catch (e) { say('C save threw ' + e.message); }
    const s = window.Sim && window.Sim.state ? window.Sim.state() : null;
    say('C SimLastAudit ' + (s && s.lastAudit ? ('ok=' + s.lastAudit.ok + ' err=' + s.lastAudit.err) : 'no Sim global (lexical const)'));
  } catch (e) { say('C THREW ' + e.message); }
})();
