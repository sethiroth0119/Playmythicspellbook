/* 🏢 TENANTS FIX DRIVER B — the LONG board: closures, the city log, the save.
   ---------------------------------------------------------------------------
   D10 asks how loud a closure is. The pre-fix policy is exactly "one
   `logEvent('city', …)` per closure" — three lines of `note()`, no branch — so
   the pre-fix count needs no separate run: it IS `lifetime.failed`. What has to
   be measured is the post-fix count and, more importantly, what the flood did
   to the feed: `LOG_MAX` is 140, so 345 closures do not just add lines, they
   EVICT every raid, contract and research line the city had.

   Same induced catchment as driver A, and said out loud for the same reason. */
(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        D = window.MythicDemographics, E = window.MythicEconomy, G = nc.game;
  const K = (x, z) => x + ',' + z, R = {};
  const done = () => { try { nc.build.finishAll('crit'); } catch (e) {} };
  const place = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} done(); return !!G.tiles[K(x, z)]; };
  const say = (k, v) => { R[k] = v; try { console.log('SEC ' + k + ' ' + JSON.stringify(v).slice(0, 900)); } catch (e) {} };

  for (const r of ['rations', 'remedies', 'goods', 'water']) { try { G.stock[r] = 900000; } catch (e) {} }
  for (let x = 16; x <= 22; x++) for (let z = 16; z <= 22; z++) {
    if (G.tiles[K(x, z)]) continue;
    const m = (x + z) % 3; await place(m === 2 ? 'foodtruck' : 'purifier', x, z);
  }
  for (let i = 0; i < 7; i++) { await nc.step(300, 150); }
  try { nc.eco.sync(); } catch (e) {}
  const r0 = D.residents.bind(D);
  D.residents = (k) => {
    const r = r0(k); const t = G.tiles[String(k)];
    if (r && r.ok && t && t.type === 'housing') {
      const x = +String(k).split(',')[0];
      return Object.assign({}, r, { occupied: 2, residents: 6, income: 8 + (x % 5) });
    }
    return r;
  };
  T._field().invalidate();
  say('board', { pop: D.population(), maxNear: T._field().field().maxNear, day: E.snapshot().day });

  const free = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    if (G.tiles[K(x, z)] || G.zones[K(x, z)]) continue;
    const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road'; });
    if (road) free.push({ x, z });
  }
  for (const p of free) Z.applyPaint(p.x, p.z, 'c_low', null);
  T._field().invalidate();
  await Z.develop({ toggle: true });
  for (let i = 0; i < 260; i++) { await Z.step(); done(); }
  Z.stopDevelop(); done();
  try { nc.eco.sync(); } catch (e) {} T.observe(true);
  say('built', { zoned: free.length, built: free.filter(p => G.tiles[K(p.x, p.z)]).length,
                 tenancies: T.stats().tenancies, refused: T.refused ? T.refused() : 'no seam' });

  /* ── drive the clock ─────────────────────────────────────────────────── */
  const logCount = () => {
    const l = G.log || [];
    let closures = 0, rollups = 0;
    for (const e of l) {
      const m = String(e.m || '');
      if (/^🏚 \d+ more businesses have closed/.test(m)) rollups++;
      else if (m.indexOf('🏚') === 0) closures++;
    }
    return { logLines: l.length, closureLines: closures, rollupLines: rollups };
  };
  const samples = [];
  for (let s = 0; s < 10; s++) {
    await nc.step(20 * 60, 200);
    try { nc.eco.sync(); } catch (e) {}
    const o = T.observe(true);
    const st = T.stats();
    samples.push({ day: E.snapshot().day, tenancies: st.tenancies, refused: st.refused,
                   lifetime: st.lifetime, log: logCount(),
                   obs: { failed: o.failed.length, relet: o.relet.length, noBidder: o.noBidder },
                   audit: E.snapshot().audit.ok });
    console.log('SMP ' + JSON.stringify(samples[samples.length - 1]).slice(0, 400));
  }
  const st = T.stats(), lc = logCount();
  say('D10_log', {
    closuresRecorded: st.lifetime.failed, ledgerRows: T.failures().length, failedLots: st.failedLots,
    cityLogLines: lc.logLines, tenantClosureLines: lc.closureLines, tenantRollupLines: lc.rollupLines,
    prePolicyWouldHaveLogged: st.lifetime.failed,
    shareOfFeedPre: st.lifetime.failed ? Math.min(1, st.lifetime.failed / 140) : 0,
    shareOfFeedPost: lc.logLines ? +((lc.closureLines + lc.rollupLines) / lc.logLines).toFixed(3) : 0,
  });
  say('D4_final', { vacant: st.vacant, refused: st.refused, parts: st.refusedParts,
                    vacancies: (nc.tenantVacancies() || []).length,
                    kinds: (nc.tenantVacancies() || []).reduce((a, v) => { a[v.kind] = (a[v.kind] || 0) + 1; return a; }, {}),
                    sample: (nc.tenantVacancies() || []).slice(0, 2) });
  say('verify', T.verify());

  /* ── D6: the save, round-tripped and then attacked ─────────────────────── */
  const coll = window.MythicCitySave.collect();
  const clean = JSON.parse(JSON.stringify(coll));
  window.MythicCitySave.restore(clean);
  const cleanLoad = T.afterLoad();
  say('D6_roundTrip', { saveV: (coll.tenants || {}).v, count: (coll.tenants || {}).count,
                        afterLoad: cleanLoad, lifetime: T.stats().lifetime, verify: T.verify().ok,
                        repairs: T.stats().counterRepairs });
  const hostile = JSON.parse(JSON.stringify(coll));
  hostile.tenants.count = { failed: 999999, let: 999999, grown: 999999, evicted: 999999 };
  hostile.tenants.let['999,999'] = { c: 'shop#99999', n: 'Hostile Ltd', want: 'shop', size: 'national', day: 0, lvl: 5, rung: 'HEALTHY', f: 12345, bid: 9999 };
  window.MythicCitySave.restore(hostile);
  const hl = T.afterLoad();
  say('D6_hostile', { afterLoad: hl, lifetime: T.stats().lifetime, repairs: T.stats().counterRepairs,
                      has999: !!T._store().tenancy('999,999'), verify: T.verify() });
  return R;
})()
