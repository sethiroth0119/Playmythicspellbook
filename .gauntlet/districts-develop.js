(async () => {
  const nc = window.__nc, D = window.MythicDistricts, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, G = nc.game;
  const R = {}, K = (x, z) => x + ',' + z;
  const done = () => { try { nc.build.finishAll('districts driver'); } catch (e) {} };
  const place = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} done(); return !!G.tiles[K(x, z)]; };

  /* every node, so the band ladder is not reporting a research gap as a land
     value one — the two are different findings and must not be mixed */
  for (const n of P.tree.NODES) P._grant(n.id);

  /* ── 1. AN AMENITY CORE, out of buildings this city can actually afford to
        order (the municipal 40-minute build ceiling refuses shop/arena/club —
        scene.js has said so for ten rounds). Everything here is under it. ── */
  const C = 12, core = [];
  for (let x = C - 3; x <= C + 3; x++) for (let z = C - 3; z <= C + 3; z++) {
    if (G.tiles[K(x, z)]) continue;
    const t = ((x + z) % 4 === 0) ? 'foodtruck' : ((x + z) % 4 === 1) ? 'motorpool'
            : ((x + z) % 4 === 2) ? 'fountain' : 'garden';
    if (await place(t, x, z)) core.push([t, x, z]);
  }
  R.amenity = { placed: core.length, types: core.reduce((a, c) => (a[c[0]] = (a[c[0]] || 0) + 1, a), {}) };

  /* ── 2. WHERE THE LAND IS NOW ──────────────────────────────────────────── */
  const hist = {}, plots = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    const b = L.bandAt(x, z).id; hist[b] = (hist[b] || 0) + 1;
    if (G.tiles[K(x, z)]) continue;
    const road = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dz]) => {
      const t = G.tiles[K(x + dx, z + dz)]; return t && t.type === 'road';
    });
    if (road) plots.push({ x, z, prem: Math.round(L.premiumAt(x, z)), band: L.bandAt(x, z).id });
  }
  plots.sort((a, b) => b.prem - a.prem);
  R.bands = { hist, bestPlot: plots[0], freeRoadFronted: plots.length };

  /* ── 3. TWO STRIPS ON THE BEST LAND: one specialised, one not.
        Same zone, same band, adjacent — the control is the point. ────────── */
  const top = plots.slice(0, 8);
  const A = top.filter((_, i) => i % 2 === 0).slice(0, 3);   // 🃏 Mythic Retail
  const B = top.filter((_, i) => i % 2 === 1).slice(0, 3);   // plain c_high
  for (const p of A) Z.applyPaint(p.x, p.z, 'c_high', 'c_mythic');
  for (const p of B) Z.applyPaint(p.x, p.z, 'c_high', null);
  R.strips = {
    mythic: A.map(p => ({ ...p, would: nc.districtAt(p.x, p.z).wouldBuild, lvl: nc.districtAt(p.x, p.z).lvl })),
    control: B.map(p => ({ ...p, would: nc.districtAt(p.x, p.z).wouldBuild, lvl: nc.districtAt(p.x, p.z).lvl })),
  };

  /* ── 4. DEVELOP, through the SHIPPED path ─────────────────────────────── */
  const before = Object.keys(G.tiles).length;
  const dev = await Z.develop({ toggle: true });
  for (let i = 0; i < 60; i++) { await Z.step(); done(); }
  const stopped = Z.stopDevelop();
  done();
  R.devRun = { start: dev, stop: stopped, plan: (() => { const p = Z.plan(null); return { out: p.out.length, grow: p.grow.length, skip: p.skip }; })() };
  const built = {};
  for (const p of A.concat(B)) {
    const t = G.tiles[K(p.x, p.z)];
    built[K(p.x, p.z)] = { spec: D.specAt(p.x, p.z) || 'none', type: t ? t.type : null, lvl: t ? (t.lvl | 0) : null };
  }
  R.developed = { tilesBefore: before, tilesAfter: Object.keys(G.tiles).length, plots: built };

  /* ── 4b. THE LEVEL OVERRIDE, ON A PAIR THAT CAN ACTUALLY SHOW IT.
        `c_high` and `c_mythic` both target level 2, so the strip above cannot
        separate "the spec raised it" from "the zone did". `c_low` targets 1 and
        💎 Luxury Retail targets 3, so this pair can. ─────────────────────── */
  const lv = plots.filter(p => !G.tiles[K(p.x, p.z)] && !G.zones[K(p.x, p.z)]).slice(0, 2);
  if (lv[0] && lv[1]) {
    Z.applyPaint(lv[0].x, lv[0].z, 'c_low', null);
    Z.applyPaint(lv[1].x, lv[1].z, 'c_low', 'c_lux');
    R.levelOverride = {
      zoneOnly:  { at: lv[0], lvl: nc.districtAt(lv[0].x, lv[0].z).lvl, zoneTarget: Z.ZONE_BY_ID.c_low.lvl },
      specialised: { at: lv[1], lvl: nc.districtAt(lv[1].x, lv[1].z).lvl,
                     would: nc.districtAt(lv[1].x, lv[1].z).wouldBuild,
                     afterLand: nc.districtAt(lv[1].x, lv[1].z).afterLand },
    };
  }

  /* ── 5. WHAT THE ECONOMY MADE OF IT — the card chain, unforced ─────────── */
  R.cardSeam = D.cardSeam();
  R.verify = D.verify();
  R.stats = D.stats();
  return R;
})()
