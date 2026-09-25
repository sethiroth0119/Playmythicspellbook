/* 🏢 TENANTS FIX DRIVER E — THE DORMANT REGIME, ON PURPOSE.
   ---------------------------------------------------------------------------
   D3 is that whether the market runs at all is a coin flip across boots — 155,
   155, 0, 0 on the critic's four, and 0 on three of my five. A defect you can
   only reproduce half the time is a defect nobody can close, so this driver
   FORCES the dormant regime instead of waiting for it: `residents()` is wrapped
   to answer `ok:false` (the honest answer for a tile nobody lives in) for every
   housing tile, which is exactly what this box's dormant boots produce upstream.

   Then it wakes the city up again and watches what the module does about the
   lots that were built while it slept. Both halves are the same stub, at a
   sibling module's seam, in the driver.                                       */
(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        D = window.MythicDemographics, E = window.MythicEconomy, G = nc.game;
  const K = (x, z) => x + ',' + z, R = {};
  const done = () => { try { nc.build.finishAll('crit'); } catch (e) {} };
  const place = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} done(); return !!G.tiles[K(x, z)]; };
  const say = (k, v) => { R[k] = v; try { console.log('SEC ' + k + ' ' + JSON.stringify(v).slice(0, 900)); } catch (e) {} };
  const panel = () => { T.openPanel(); const h = (document.getElementById('ntn-panel') || {}).innerHTML || ''; T.closePanel(); return h; };

  for (const r of ['rations', 'remedies', 'goods', 'water']) { try { G.stock[r] = 900000; } catch (e) {} }
  for (let x = 16; x <= 22; x++) for (let z = 16; z <= 22; z++) {
    if (G.tiles[K(x, z)]) continue;
    const m = (x + z) % 3; await place(m === 2 ? 'foodtruck' : 'purifier', x, z);
  }
  for (let i = 0; i < 6; i++) { await nc.step(300, 150); }
  try { nc.eco.sync(); } catch (e) {}

  /* ── FORCE DORMANT ─────────────────────────────────────────────────────── */
  const r0 = D.residents.bind(D);
  let awake = false;
  D.residents = (k) => {
    const r = r0(k); const t = G.tiles[String(k)];
    if (t && t.type === 'housing') {
      if (!awake) return { ok: false, why: 'driver: nobody lives here yet' };
      const x = +String(k).split(',')[0];
      return Object.assign({}, r || {}, { ok: true, occupied: 2, residents: 6, income: 8 + (x % 5) });
    }
    return r;
  };
  T._field().invalidate();
  say('dormant_state', { dormant: T.dormant(), statsDormant: T.stats().dormant,
                         panelHasBanner: /THE MARKET IS DORMANT/.test(panel()) });

  const free = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    if (G.tiles[K(x, z)] || G.zones[K(x, z)]) continue;
    const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road'; });
    if (road) free.push({ x, z });
  }
  for (const p of free) Z.applyPaint(p.x, p.z, 'c_low', null);
  T._field().invalidate();
  await Z.develop({ toggle: true });
  for (let i = 0; i < 240; i++) { await Z.step(); done(); }
  Z.stopDevelop(); done();
  try { nc.eco.sync(); } catch (e) {} T.observe(true);
  const builtA = free.filter(p => G.tiles[K(p.x, p.z)]);
  const stA = T.stats();
  const l1 = T._store().lets(), v1 = T._store().vacs();
  say('A_builtWhileDormant', {
    zoned: free.length, built: builtA.length,
    tenancies: stA.tenancies, vacant: stA.vacant, refused: stA.refused,
    dormant: stA.dormant, awardsWhileDormant: stA.awardsWhileDormant, waking: stA.waking,
    ORPHANED: builtA.filter(p => !l1[K(p.x, p.z)] && !v1[K(p.x, p.z)]).length,
    panelHasBanner: /THE MARKET IS DORMANT/.test(panel()),
    panelSaysHashChose: /the zoning hash chose every one of them/.test(panel()),
    verify: T.verify(),
  });

  /* ── WAKE IT UP ────────────────────────────────────────────────────────── */
  awake = true;
  T._field().invalidate();
  const drain = [];
  for (let i = 0; i < 8; i++) {
    const o = T.observe(true);
    drain.push({ woke: o.woke | 0, noBidder: o.noBidder | 0, waiting: o.waiting | 0,
                 tenancies: T.stats().tenancies, waking: T.stats().waking });
  }
  const stB = T.stats();
  const l2 = T._store().lets(), v2 = T._store().vacs();
  say('B_afterWaking', {
    maxNear: T._field().field().maxNear, dormant: stB.dormant,
    drain, tenancies: stB.tenancies, vacant: stB.vacant, refused: stB.refused,
    refusedParts: stB.refusedParts, waking: stB.waking,
    ORPHANED: builtA.filter(p => !l2[K(p.x, p.z)] && !v2[K(p.x, p.z)]).length,
    sampleTenancy: Object.keys(l2).slice(0, 3).map(k => ({ k, n: l2[k].n, want: l2[k].want, bid: l2[k].bid })),
    sampleRefusal: Object.keys(v2).slice(0, 2).map(k => ({ k, never: v2[k].never, why: v2[k].why })),
    panelHasBanner: /THE MARKET IS DORMANT/.test(panel()),
    verify: T.verify(),
  });
  return R;
})()
