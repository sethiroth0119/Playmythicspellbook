/* 🏢 TENANTS FIX DRIVER C — the seams, called directly. Short.
   ---------------------------------------------------------------------------
   Driver A proves the fix through the shipped develop path. This one calls the
   two write seams by hand, so the guard is separated from everything else that
   could produce the same numbers, and it measures D7 the only way it can be
   measured: by counting the reads the observer makes.                        */
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
  for (let i = 0; i < 6; i++) { await nc.step(300, 150); }
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
  say('board', { maxNear: T._field().field().maxNear, dormant: T.stats().dormant });

  const free = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    if (G.tiles[K(x, z)] || G.zones[K(x, z)]) continue;
    const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road'; });
    if (road) free.push({ x, z });
  }
  /* ══ D1 — the two seams, called by hand on the SAME tile ═══════════════ */
  const res = free.slice(0, 4), com = free.slice(4, 8);
  for (const p of res) Z.applyPaint(p.x, p.z, 'r_low', null);
  for (const p of com) Z.applyPaint(p.x, p.z, 'c_low', null);
  T._field().invalidate();
  const rows = [];
  for (const p of res) {
    const k = K(p.x, p.z);
    const e = nc.tenantBids(p.x, p.z, ['housing']);
    const clears = e && e.ok ? e.rows.filter(r => r.bids).length : 0;
    const before = T.stats().tenancies;
    const a = T.award(p.x, p.z, 'housing');
    rows.push({ k, zone: 'r_low', bidsOverReserve: clears,
                bestTotal: e && e.ok && e.rows.length ? e.rows[0].total : null,
                wants: T.wants(p.x, p.z, ['housing'], 'res'),
                awardReturned: a, tenancyWritten: !!T._store().tenancy(k),
                vacancyWritten: !!T._store().vacancy(k),
                tenanciesDelta: T.stats().tenancies - before });
  }
  /* …and a dwelling on land with NO zone at all: the category test cannot fire,
     so this is the popCap half of the gate on its own. */
  const bare = free.slice(20, 21)[0];
  let bareRow = null;
  if (bare) {
    const k = K(bare.x, bare.z);
    const a = T.award(bare.x, bare.z, 'housing');
    bareRow = { k, zone: Z.zoneAt(bare.x, bare.z), awardReturned: a,
                tenancyWritten: !!T._store().tenancy(k) };
  }
  /* the control: the same call on COMMERCIAL land must still sign a lease */
  const ctrl = [];
  for (const p of com) {
    const k = K(p.x, p.z);
    const a = T.award(p.x, p.z, 'shop');
    ctrl.push({ k, zone: 'c_low', awardReturned: a ? { n: a.n, want: a.want, bid: a.bid } : null,
                tenancyWritten: !!T._store().tenancy(k), vacancy: T._store().vacancy(k) });
  }
  say('D1_seams', { residential: rows, unzonedDwelling: bareRow, commercialControl: ctrl,
                    verify: T.verify() });

  /* ══ D7 — does the second observe of a tick re-read the firm set? ══════
     `firmAt()` cached for 1000 ms and node-city calls observe(true) →
     syncBuildings → observe() all in one synchronous tick, so the call whose
     comment says it exists to see the NEW set of firms was reading the old map.
     Counting the reads is the measurement: a second observe that never asks the
     economy cannot possibly have noticed anything change. */
  let calls = 0;
  const f0 = E.firms.bind(E);
  E.firms = () => { calls++; return f0(); };
  calls = 0; T.observe(true); const afterFirst = calls;
  T.observe();               const afterSecond = calls;
  T.observe();               const afterThird = calls;
  /* THE CONTROL, and it is the half that shows the cache was not simply
     deleted: `levelFor` is the per-plot read /src/zoning makes on every permit,
     and it MUST still be served from the 1000 ms map. Three calls, zero reads. */
  const beforeLvl = calls;
  T.levelFor(com[0].x, com[0].z); T.levelFor(com[1].x, com[1].z); T.levelFor(com[2].x, com[2].z);
  const afterLvl = calls;
  E.firms = f0;
  say('D7_reads', { afterFirst, afterSecond, afterThird,
                    secondObserveReRead: afterSecond > afterFirst,
                    thirdObserveReRead: afterThird > afterSecond,
                    levelForReads: afterLvl - beforeLvl, cacheStillServesReads: afterLvl === beforeLvl });

  /* ══ D6 — the save, round-tripped and attacked ═════════════════════════ */
  const coll = window.MythicCitySave.collect();
  say('D6_shape', { v: (coll.tenants || {}).v, count: (coll.tenants || {}).count,
                    pend: ((coll.tenants || {}).pend || []).length });
  const hostile = JSON.parse(JSON.stringify(coll));
  hostile.tenants.count = { failed: 999999, let: 999999, grown: 999999 };
  hostile.tenants.let['999,999'] = { c: 'shop#99999', n: 'Hostile Ltd', want: 'shop', size: 'national', day: 0, lvl: 5, rung: 'HEALTHY', f: 12345, bid: 9999 };
  hostile.tenants.let['3,3'] = { c: 'shop#0', n: 'Ghost', want: 'shop', size: 'national', day: 0, lvl: 5, rung: 'HEALTHY', f: 1, bid: 1 };
  window.MythicCitySave.restore(hostile);
  const hl = T.afterLoad();
  say('D6_hostile', { afterLoad: hl, lifetime: T.stats().lifetime,
                      repairs: T.stats().counterRepairs, has999: !!T._store().tenancy('999,999'),
                      verify: T.verify() });
  /* …and a save that carries a lease on a HOUSE, which is what a save written
     by the build with the defect looks like. */
  const legacy = JSON.parse(JSON.stringify(coll));
  const houseKey = Object.keys(G.tiles).filter(k => G.tiles[k].type === 'housing')[0];
  legacy.tenants.let[houseKey] = { c: 'housing#3', n: 'Nakamura Rise', want: 'housing', size: 'chain', day: 1, lvl: 1, rung: 'HEALTHY', f: null, bid: 6 };
  window.MythicCitySave.restore(legacy);
  const ll = T.afterLoad();
  say('D6_legacyHouseLease', { houseKey, afterLoad: ll,
                               stillThere: !!T._store().tenancy(houseKey),
                               levelFor: T.levelFor(+houseKey.split(',')[0], +houseKey.split(',')[1]),
                               verify: T.verify() });
  return R;
})()
