/* ══ 🚶 THE COMMUTE GATE — degradation, monotonicity and the panel ═════════
   Three claims the A/B driver cannot make, checked against the live page. */
(async () => {
  const nc = window.__nc, ops = window.__ncOps, T = window.MythicTransit, D = window.MythicDemographics;
  const out = {};
  if (!nc || !T || !D) return { err: 'modules missing' };
  const B = window.MythicCityBridge;
  B.spendCinders = async () => true;

  ops.mockBuy('bus'); await ops.refresh(true);
  const tiles = nc.game.tiles, K = (x, z) => x + ',' + z;
  const isRoad = (x, z) => { const t = tiles[K(x, z)]; return !!t && t.type === 'road'; };
  const P = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {}
    try { nc.build.finishAll('probe'); } catch (e) {} return !!tiles[K(x, z)]; };

  /* 1. NO NETWORK AT ALL: access is 1 and demographics agrees. */
  out.emptyCity = { access: T.jobAccess(true).access, demog: nc.demog.report().jobAccess };

  /* 2. STOPS BUT NO LINE, then a growing line: access must never fall. */
  const wp = new Set(nc.workplaces());
  const homeW = {}, workW = {};
  for (const k in tiles) { const t = tiles[k]; if (!t) continue;
    const def = nc.BUILDINGS[t.type]; if (!def) continue;
    if (t.type === 'housing') homeW[k] = Math.max(1, t.lvl | 0);
    else if (wp.has(t.type)) workW[k] = Math.max(1, def.crew | 0); }
  const near = (W, x, z) => { let s = 0; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) s += W[K(x + dx, z + dz)] || 0; return s; };
  const cand = [];
  for (let x = 1; x < 23; x++) for (let z = 1; z < 23; z++) {
    if (tiles[K(x, z)]) continue;
    if (!(isRoad(x - 1, z) || isRoad(x + 1, z) || isRoad(x, z - 1) || isRoad(x, z + 1))) continue;
    cand.push({ x, z, k: K(x, z), h: near(homeW, x, z), w: near(workW, x, z) });
  }
  const picks = cand.slice().sort((a, b) => b.h - a.h).slice(0, 5)
    .concat(cand.slice().sort((a, b) => b.w - a.w).slice(0, 5));
  const keys = [];
  for (const c of picks) if (keys.indexOf(c.k) < 0 && await P('busstop', c.x, c.z)) keys.push(c.k);
  out.stops = keys;
  out.stopsNoLine = { access: T.jobAccess(true).access, demog: nc.demog.report().jobAccess };

  const L = T.newLine('bus'); L.closed = true;
  const walk = [];
  for (const k of keys) {
    T.addStop(L.id, k);
    if (L.stops.length >= 2 && (T.report(true).lines[L.id] || {}).fault) { T.addStop(L.id, k); continue; }
    T.manage(); nc.manageAgents();
    const a = T.jobAccess(true);
    walk.push({ stops: L.stops.length, served: +a.served.toFixed(4), access: +a.access.toFixed(4) });
  }
  out.growth = walk;
  out.monotonic = walk.every((v, i) => i === 0 || v.access >= walk[i - 1].access - 1e-9);
  out.neverBelowBaseline = walk.every(v => v.access >= out.stopsNoLine.access - 1e-9);

  /* 3. DELETE THE LINE: access must return exactly to the no-line value. */
  const withLine = T.jobAccess(true).access;
  T.removeLine(L.id); T.manage();
  out.afterDelete = T.jobAccess(true).access;
  out.deleteRestoresExactly = Math.abs(out.afterDelete - out.stopsNoLine.access) < 1e-9;

  /* 4. THE GUARDED-IMPORT CONTRACT: no MythicTransit ⇒ full access, i.e.
        hiring behaves exactly as it did before this wire existed. */
  const saved = window.MythicTransit;
  window.MythicTransit = undefined;
  out.transitAbsent = nc.demog.report().jobAccess;
  window.MythicTransit = { jobAccess: () => ({ access: NaN }) };
  out.providerNaN = nc.demog.report().jobAccess;
  window.MythicTransit = { jobAccess: () => ({ access: 4.2 }) };
  out.providerOutOfRange = nc.demog.report().jobAccess;
  window.MythicTransit = { jobAccess: () => { throw new Error('boom'); } };
  out.providerThrows = nc.demog.report().jobAccess;
  window.MythicTransit = saved;

  /* 5. THE PANEL — the row a player actually reads. */
  const L2 = T.newLine('bus'); L2.closed = true;
  for (const k of keys) { T.addStop(L2.id, k); if (L2.stops.length >= 2 && (T.report(true).lines[L2.id] || {}).fault) T.addStop(L2.id, k); }
  T.manage(); nc.manageAgents();
  T.open();
  await new Promise(r => setTimeout(r, 400));
  const host = document.getElementById('tr-panel');
  const txt = host ? host.innerText.replace(/\s+/g, ' ') : null;
  const i = txt ? txt.indexOf('Jobs your citizens can get to') : -1;
  out.panelRow = i >= 0 ? txt.slice(i, i + 320) : 'NOT RENDERED';
  out.demogNote = (nc.demog.report().labourNote || '').slice(-220);
  out.finalAccess = T.jobAccess(true);
  return out;
})()
