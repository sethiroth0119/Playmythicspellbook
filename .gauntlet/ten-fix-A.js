/* 🏢 TENANTS FIX DRIVER A — the LIVE-MARKET board.
   ---------------------------------------------------------------------------
   The critic's crit-ten-6/7 need a city whose market is awake, and D3 is
   precisely that this box's boots land DORMANT: measured here four times over,
   `maxNear` 0 with `occupied:0` on every housing tile at demographics'
   `residents()` seam, pop 89, through 22 sim steps.

   ⚠ SO THE CATCHMENT IS INDUCED, AND SAID OUT LOUD. This driver wraps
     `MythicDemographics.residents` — the exact seam bid.js reads and NOTHING
     inside /src/tenants — so that housing tiles report the occupancy the
     upstream pipeline is not producing on this boot. Every line of the module
     under test then runs on real code paths with a real catchment. It is a
     stub of a SIBLING, in the driver, never of the module being judged.

   Sections: A = D1 (award on residential), B = D2/D4 (refusal recorded and
   counted), C = D5 (does the refusal reach the player), D = the dormancy seam.  */
(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        D = window.MythicDemographics, E = window.MythicEconomy, G = nc.game,
        L = window.MythicLandValue;
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
  T._field().invalidate();
  say('dormantBoot', { pop: D.population(), maxNear: T._field().field().maxNear,
                       day: E.snapshot().day,
                       dormantAPI: (typeof T.dormant === 'function') ? T.dormant() : 'no such seam',
                       statsDormant: T.stats().dormant === undefined ? 'no such field' : T.stats().dormant });

  /* ── induce the catchment (see header) ─────────────────────────────────── */
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
  say('liveBoard', { maxNear: T._field().field().maxNear, maxVal: T._field().field().maxVal,
                     dormantAPI: (typeof T.dormant === 'function') ? T.dormant() : 'no such seam' });

  const free = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    if (G.tiles[K(x, z)] || G.zones[K(x, z)]) continue;
    const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road'; });
    if (road) free.push({ x, z });
  }

  /* ══ A. D1 — award() on residential ══════════════════════════════════════ */
  const RES = free.slice(0, 24);
  for (const p of RES) Z.applyPaint(p.x, p.z, 'r_low', null);
  T._field().invalidate();
  const bidsOnHousing = RES.slice(0, 2).map((p) => {
    const e = nc.tenantBids(p.x, p.z, ['housing']);
    return { k: K(p.x, p.z), wants: T.wants(p.x, p.z, ['housing'], 'res'),
             rows: e && e.ok ? e.rows.map(r => ({ size: r.cand.size, total: r.total, bids: r.bids })) : null };
  });
  await Z.develop({ toggle: true });
  for (let i = 0; i < 150; i++) { await Z.step(); done(); }
  Z.stopDevelop(); done();
  try { nc.eco.sync(); } catch (e) {} T.observe(true);
  const lets = T._store().lets();
  const hk = Object.keys(lets).filter(k => lets[k].want === 'housing');
  say('A_residential', {
    zoned: RES.length, built: RES.filter(p => G.tiles[K(p.x, p.z)]).length,
    bidsOnHousing,
    HOUSING_TENANCIES: hk.length, allTenancies: T.stats().tenancies,
    sample: hk.slice(0, 4).map(k => ({ k, n: lets[k].n, size: lets[k].size, want: lets[k].want, bid: lets[k].bid,
      tileType: (G.tiles[k] || {}).type, tileLvl: (G.tiles[k] || {}).lvl,
      levelFor: T.levelFor(+k.split(',')[0], +k.split(',')[1]),
      firm: (() => { const t = T.tenantAt(+k.split(',')[0], +k.split(',')[1]); return t && t.firm ? { lvl: t.firm.level, rung: t.firm.rung, out: t.firm.out } : null; })() })),
    overlayPainted: (() => { T.overlay(true); return T.overlayPainted(); })(),
    panelHousingRows: (() => { try { T.openPanel(); const el = document.getElementById('ntn-panel');
      const m = el ? el.innerHTML.match(/Housing/g) : null; T.closePanel(); return m ? m.length : 0; } catch (e) { return 'err'; } })(),
    verify: T.verify(),
  });

  /* ══ B. D2 / D4 — commercial: refusals recorded, counted, explained ══════ */
  const COM = free.slice(24);
  for (const p of COM) Z.applyPaint(p.x, p.z, 'c_low', null);
  T._field().invalidate();
  const sink = []; const prev = window.__ncToastSink;
  window.__ncToastSink = (m, c) => { sink.push(String(m)); };
  await Z.develop({ toggle: true });
  for (let i = 0; i < 240; i++) { await Z.step(); done(); }
  const stopRet = Z.stopDevelop(); done();
  window.__ncToastSink = prev || null;
  try { nc.eco.sync(); } catch (e) {} T.observe(true);
  const l2 = T._store().lets(), v2 = T._store().vacs();
  const builtCom = COM.filter(p => G.tiles[K(p.x, p.z)]);
  const orph = builtCom.filter(p => !l2[K(p.x, p.z)] && !v2[K(p.x, p.z)]);
  const unbuilt = COM.filter(p => !G.tiles[K(p.x, p.z)]);
  const st = T.stats();
  say('B_commercial', {
    zoned: COM.length, built: builtCom.length, unbuiltZoned: unbuilt.length,
    tenanted: builtCom.length - orph.length, ORPHANED_no_tenancy_no_vacancy: orph.length,
    statsVacant: st.vacant, statsRefused: st.refused === undefined ? 'no such field' : st.refused,
    vacanciesSeam: (() => { const v = nc.tenantVacancies() || []; return { n: v.length, sample: v.slice(0, 3) }; })(),
    planSkip: (() => { const pl = Z.plan(null); return { out: pl.out.length, skip: pl.skip }; })(),
    lifetime: st.lifetime,
    overlayPainted: (() => { T.overlay(true); return T.overlayPainted(); })(),
    verify: T.verify(),
  });

  /* ══ C. D5 — does the refusal reach the player? ══════════════════════════ */
  say('C_report', {
    stopDevReturn: stopRet ? { built: stopRet.built, grown: stopRet.grown, refused: stopRet.refused,
                               nomix: stopRet.nomix === undefined ? 'no such field' : stopRet.nomix,
                               why: stopRet.why } : null,
    toastsAtStop: sink.slice(-4),
    mentionsMarket: sink.some(s => /company will take|no tenant the land will take|pitch/i.test(s)),
    developAgain: await (async () => { const r = await Z.develop({}); const t = sink.slice(-1)[0]; Z.stopDevelop(); return { r: r && { built: r.built, planned: r.planned }, t }; })(),
  });

  /* ══ D. panel + fiction + dormancy text ═════════════════════════════════ */
  T.openPanel();
  const html = (document.getElementById('ntn-panel') || {}).innerHTML || '';
  T.closePanel();
  say('D_panel', {
    lotsNobodyWillTakeRow: (html.match(/Lots nobody will take<\/span><span>([^<]*)</) || [])[1] || null,
    hasFiction: /fiction/i.test(html), hasRentBearing: /rentBearing/i.test(html),
    hasDormantLine: /dormant/i.test(html),
    failedRow: (html.match(/Businesses failed here<\/span><span>(.*?)<\/span>/) || [])[1] || null,
    fictionSeam: (typeof T.fiction === 'function') ? T.fiction().map(f => f.name) : 'no such seam',
    events: T.events().slice(-3).map(e => e.kind + ' ' + e.msg.slice(0, 70)),
  });
  return R;
})()
