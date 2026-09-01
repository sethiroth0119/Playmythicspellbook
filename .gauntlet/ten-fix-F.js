/* 🏢 TENANTS FIX DRIVER F — DEGRADE TO NOTHING, on a LIVE board.
   ---------------------------------------------------------------------------
   crit-ten-4 runs this A/B and lands in the dormant regime on most boots here,
   where the module says nothing and the two plans are identical for a reason
   that proves very little. This is the same A/B with the catchment induced (see
   driver A's header), so the market is genuinely deciding — and then the module
   is switched off mid-flight and the planner's whole output string has to fall
   back to /src/zoning's own hash, byte for byte, and back again.            */
(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        D = window.MythicDemographics, E = window.MythicEconomy, G = nc.game;
  const K = (x, z) => x + ',' + z, R = {};
  const done = () => { try { nc.build.finishAll('crit'); } catch (e) {} };
  const place = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} done(); return !!G.tiles[K(x, z)]; };

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
  R.board = { maxNear: T._field().field().maxNear, dormant: T.stats().dormant };

  const free = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    if (G.tiles[K(x, z)] || G.zones[K(x, z)]) continue;
    const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road'; });
    if (road) free.push({ x, z });
  }
  /* a mixed board on purpose: residential AND commercial, so the category half
     of the gate is in the picture and the pool is sized off commercial land. */
  for (let i = 0; i < free.length; i++) Z.applyPaint(free[i].x, free[i].z, i % 4 === 0 ? 'r_low' : 'c_low', null);
  T._field().invalidate();
  R.zoned = { total: free.length, res: free.filter((p, i) => i % 4 === 0).length };
  R.poolLots = T.stats().pool;

  const planStr = () => { const pl = Z.plan(null);
    return { str: pl.out.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z)).map(o => K(o.x, o.z) + ':' + o.type).join(' '),
             n: pl.out.length, skip: JSON.parse(JSON.stringify(pl.skip)) }; };
  const A = planStr();
  const hash = {}; for (const p of free) { const d = nc.districtAt(p.x, p.z); if (d) hash[K(p.x, p.z)] = d.wouldBuild; }
  const saved = window.MythicTenants; window.MythicTenants = null;
  const B = planStr(); window.MythicTenants = saved; const C = planStr();
  const M = (s) => { const o = {}; for (const t of s.split(' ')) { if (!t) continue; const i = t.lastIndexOf(':'); o[t.slice(0, i)] = t.slice(i + 1); } return o; };
  const aM = M(A.str), bM = M(B.str);
  let hm = 0, miss = []; for (const k in bM) { if (bM[k] === hash[k]) hm++; else miss.push(k + ' ' + bM[k] + '/' + hash[k]); }
  const moved = [], lost = [];
  for (const k in bM) { if (!(k in aM)) lost.push(k); else if (aM[k] !== bM[k]) moved.push(k + ' ' + bM[k] + '→' + aM[k]); }
  R.AB = { withMarket: A.n, withoutMarket: B.n, restoredSameAsA: C.str === A.str,
           skipWith: A.skip, skipWithout: B.skip, identical: A.str === B.str,
           hashProof: { planned: Object.keys(bM).length, matchesHash: hm, miss: miss.slice(0, 5) },
           changedType: moved.length, refusedByMarket: lost.length,
           sampleChanged: moved.slice(0, 10), sampleRefused: lost.slice(0, 6) };
  R.residentialUntouched = (() => {
    /* every residential plot must plan the same thing with the market on and
       off — the market is not allowed to have an opinion about a house. */
    let same = 0, diff = [];
    for (let i = 0; i < free.length; i += 4) {
      const k = K(free[i].x, free[i].z);
      if (aM[k] === bM[k]) same++; else diff.push(k + ' ' + bM[k] + '→' + aM[k]);
    }
    return { plots: Math.ceil(free.length / 4), same, diff: diff.slice(0, 5) };
  })();
  R.refusalSentence = lost.length ? T.refusal(+lost[0].split(',')[0], +lost[0].split(',')[1]) : null;
  return R;
})()
