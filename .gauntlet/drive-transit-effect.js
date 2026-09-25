/* ══ 🚌 DOES TRANSIT CHANGE THE SIMULATION? — the A/B, with a control ═══════
   Builds a real bus line on the standard district (licence → stops → route →
   vehicles), snapshots every stateful module, runs the city forward with the
   line, restores the snapshot, DELETES the line, runs the identical forward
   again, and prints both sides.
   Math.random is re-seeded identically before each run, so the only difference
   between arm A and arm B is the line. ══════════════════════════════════════ */
(async () => {
  const nc = window.__nc, ops = window.__ncOps, T = window.MythicTransit;
  const E = window.MythicEconomy, D = window.MythicDemographics;
  const out = { steps: [] };
  if (!nc) return { err: 'no __nc' };
  if (!T) return { err: 'MythicTransit did not mount' };
  const B = window.MythicCityBridge;

  /* Cinder actually charged through the bridge (scene.js stubbed it to a
     no-op; wrap it so the spend is still countable). */
  let spent = 0;
  const _sc = B.spendCinders;
  B.spendCinders = async (n) => { spent += (+n || 0); return _sc ? _sc(n) : true; };

  /* deterministic RNG, re-armed identically for each arm */
  const _rand = Math.random;
  const seedRandom = (s) => { let a = s >>> 0; Math.random = () => {
    a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  /* ── 1. the licence ───────────────────────────────────────────────────── */
  ops.mockBuy('bus'); await ops.refresh(true);
  out.licence = T.hasLicence('bus');

  /* ── 2. where the homes and the jobs are ──────────────────────────────── */
  const wp = new Set(nc.workplaces());
  const tiles = nc.game.tiles;
  const K = (x, z) => x + ',' + z;
  const homeW = {}, workW = {};
  for (const k in tiles) {
    const t = tiles[k]; if (!t || t.type === 'anchor') continue;
    const def = nc.BUILDINGS[t.type]; if (!def) continue;
    if (t.type === 'housing') homeW[k] = Math.max(1, t.lvl | 0);
    else if (wp.has(t.type)) workW[k] = Math.max(1, def.crew | 0);
  }
  const isRoad = (x, z) => { const t = tiles[K(x, z)]; return !!t && t.type === 'road'; };
  const near = (W, x, z, R) => { let s = 0; for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) s += W[K(x + dx, z + dz)] || 0; return s; };
  const cand = [];
  for (let x = 1; x < 23; x++) for (let z = 1; z < 23; z++) {
    if (tiles[K(x, z)]) continue;
    if (!(isRoad(x - 1, z) || isRoad(x + 1, z) || isRoad(x, z - 1) || isRoad(x, z + 1))) continue;
    cand.push({ k: K(x, z), x, z, h: near(homeW, x, z, 2), w: near(workW, x, z, 2) });
  }
  const byHome = cand.slice().sort((a, b) => b.h - a.h).slice(0, 6);
  const byWork = cand.slice().sort((a, b) => b.w - a.w).slice(0, 6);
  out.pickedHome = byHome.map(c => c.k + ' h=' + c.h + ' w=' + c.w);
  out.pickedWork = byWork.map(c => c.k + ' h=' + c.h + ' w=' + c.w);

  /* ── 3. place the stops through the shipped placement path ────────────── */
  const P = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {}
    try { nc.build.finishAll('transit A/B'); } catch (e) {}
    return !!tiles[K(x, z)]; };
  const stopKeys = [];
  for (const c of byHome.concat(byWork)) {
    if (stopKeys.indexOf(c.k) >= 0) continue;
    if (await P('busstop', c.x, c.z)) stopKeys.push(c.k);
  }
  out.stopsPlaced = stopKeys;

  /* ── 4. draw the route ──────────────────────────────────────────────────
     Added ONE AT A TIME and rolled back if the line stops being runnable: the
     standard district's road grid is incomplete (the road cap runs out), so a
     stop beside an orphaned road square breaks the whole route and the line
     carries nobody. A faulted line is not a control, it is a bug in the test. */
  const L = T.newLine('bus'); L.name = 'Works Line'; L.closed = true;
  out.rejected = [];
  for (const k of stopKeys) {
    T.addStop(L.id, k);
    /* ⚠ Only roll back once the line HAS enough stops to be judged. Below
       minStops every line faults with "needs at least 2 stops", so testing
       from the first stop rejects every stop and leaves an empty route — which
       is exactly what the first cut of this driver did, silently. */
    if (L.stops.length >= 2 && (T.report(true).lines[L.id] || {}).fault) {
      T.addStop(L.id, k); out.rejected.push(k);
    }
  }
  out.routeStops = L.stops.slice();
  T.manage(); nc.manageAgents();
  const rep0 = T.report(true);
  out.line = { id: L.id, stops: L.stops.length, fault: (rep0.lines[L.id] || {}).fault,
    homeReach: +(rep0.lines[L.id] || {}).homeReach.toFixed(4),
    workReach: +(rep0.lines[L.id] || {}).workReach.toFixed(4),
    vehicles: (rep0.lines[L.id] || {}).vehicles | 0 };
  out.vehicleAgents = nc.agents().filter(a => a.line).length;

  /* ── 4b. GIVE THE CITY A POPULATION. The standard district tops out at four
     residents, and at four residents every band of the labour ladder is zero
     or one — an employment gate cannot be observed against a rounding error.
     Levelling the housing raises popCap through the SHIPPED path (popCap() is
     4 + 6 per housing level) rather than writing a number into game.pop. */
  for (const k in tiles) { const t = tiles[k]; if (t && t.type === 'housing') t.lvl = 5; }
  nc.game.pop.npc = 300;
  out.popCapPushed = nc.game.pop.npc;

  /* ── 5. THE SNAPSHOT, THROUGH THE SHIPPED SAVE PATH ─────────────────────
     🔴 The first cut of this driver restored only the three modules that own
     serialisable state and left node-city's own `vitals`, coverage and Cinder
     ledger carrying over between arms — so the control run second disagreed
     with the control run first on fourteen fields and the whole comparison was
     noise. `loadState()` restores ALL of it, and it is the shipped function:
     the only thing injected is the payload, by stubbing the bridge read it
     already makes. The economy and the demographics are re-applied by hand
     afterwards because loadState STASHES those two for boot(), which is not
     going to run again in this session.
     ⚠ nc.serialize() RETURNS A JSON STRING, not an object. */
  const S0 = {
    city: nc.serialize(),
    eco: JSON.stringify(E.serialize()),
    demog: JSON.stringify(D.serialize()),
    transit: JSON.stringify(T.save()),
  };
  out.snapshotIsString = typeof S0.city === 'string';
  const _loadCity = B.loadCity;
  const restore = async (s, withLine) => {
    B.loadCity = async () => s.city;
    B.loadUnsafe = false;
    await nc.loadState();
    B.loadCity = _loadCity;
    E.load(JSON.parse(s.eco));
    D.load(JSON.parse(s.demog));
    T.load(withLine ? JSON.parse(s.transit) : { v: 1, seq: 0, show: true, lines: [] });
    T.manage(); nc.manageAgents();
  };

  /* ── 6. one arm ───────────────────────────────────────────────────────── */
  const MINUTES = 400, BLOCKS = 40;
  const arm = async (label, withLine) => {
    seedRandom(12345);
    await restore(S0, withLine);
    spent = 0;
    let last = null;
    for (let b = 0; b < BLOCKS; b++) {
      last = await nc.step(MINUTES / BLOCKS, 10);
      try { T.manage(); nc.manageAgents(); } catch (e) {}
      for (let i = 0; i < 30; i++) nc.agentTick(1 / 30);
    }
    const s = E.snapshot(), r = T.report(true), led = T.ledger(), dr = nc.demog.report();
    const probe = { car: 100, civilian: 100 }; T.adjustAgentCounts(probe);
    return {
      label,
      cityPop: +nc.game.pop.npc.toFixed(2),
      ecoPop: +s.population.toFixed(2), laborForce: +s.laborForce.toFixed(2),
      employed: +s.employed.toFixed(2), vacancies: +s.vacancies.toFixed(2),
      unemployment: +s.unemployment.toFixed(4),
      firms: s.firms, bankrupt: s.bankrupt,
      firmCash: +s.firmCash.toFixed(2), savings: +s.savings.toFixed(2),
      treasury: +s.treasury.toFixed(2), totalCinder: +s.totalCinder.toFixed(2),
      auditOk: !!(s.audit && s.audit.ok), payoutAllowed: s.payoutAllowed,
      satisfaction: Object.fromEntries(Object.entries(s.satisfaction).map(([k, v]) => [k, +v.toFixed(4)])),
      jobAccess: +(nc.transit().jobAccess(true) || { access: -1 }).access.toFixed(4),
      jobAccessDetail: (() => { const a = nc.transit().jobAccess(true);
        return { walk: +a.walk.toFixed(4), car: a.car, served: +a.served.toFixed(4),
                 jobs: a.jobs, walkable: a.walkable, stranded: a.stranded }; })(),
      demogJobAccess: +(dr.jobAccess != null ? dr.jobAccess : -1).toFixed(4),
      ladder: nc.demog.ladder(),
      demogPop: +dr.population.toFixed(2), demogHouseholds: +dr.households.toFixed(2),
      demogAttract: +dr.attract.toFixed(4), demogNetPerDay: +dr.netPerDay.toFixed(4),
      demogFlow: dr.flow, demogLimit: dr.limit,
      vitals: last ? last.vitals : null, coverage: last ? last.cov : null,
      riders: +r.riders.toFixed(3), modeShare: +r.modeShare.toFixed(4),
      transitUpkeep: +led.upkeep.toFixed(4), transitFares: +led.fares.toFixed(4),
      transitNet: +led.net.toFixed(4), cinderSpentThroughBridge: +spent.toFixed(3),
      carsOutOf100: probe.car,
      liveAgents: nc.agents().reduce((a, g) => (a[g.kind] = (a[g.kind] || 0) + 1, a), {}),
      wantCounts: nc.counts(),
    };
  };

  /* 🔴 THE CONTROL IS RUN TWICE, AND THE SECOND ONE IS THE POINT. Arm A always
     ran first, and `restore()` only puts back the three modules that own
     state — node-city's own vitals, coverage and res ledger carry over between
     arms. So a bare A-vs-B diff cannot tell "the line did this" from "the arm
     that ran first did this". B2 is the control repeated in A's shadow: every
     field where B and B2 already disagree is CARRY-OVER, not effect, and is
     struck out of the verdict. */
  out.B_noLine  = await arm('line deleted (control)', false);
  out.A_withLine = await arm('line running', true);
  out.B2_noLine = await arm('control, repeated', false);

  /* ── 7. the diff, field by field ──────────────────────────────────────── */
  const diff = {}, noise = {};
  for (const k in out.A_withLine) {
    const a = JSON.stringify(out.A_withLine[k]);
    const b = JSON.stringify(out.B_noLine[k]), b2 = JSON.stringify(out.B2_noLine[k]);
    if (a === b && a === b2) continue;
    if (b !== b2) { noise[k] = { control: out.B_noLine[k], controlAgain: out.B2_noLine[k], withLine: out.A_withLine[k] }; continue; }
    diff[k] = { withLine: out.A_withLine[k], control: out.B_noLine[k] };
  }
  out.DIFF = diff;
  out.DIFF_KEYS = Object.keys(diff);
  out.NOISE_KEYS = Object.keys(noise);
  out.NOISE = noise;
  Math.random = _rand;
  return out;
})()
