(async () => {
  const nc = window.__nc, ops = window.__ncOps;
  if (!nc) return { err: 'no __nc' };
  const T0 = window.MythicTransit;
  if (!T0) return { err: 'MythicTransit did not mount' };
  const out = { steps: [] };
  const PANEL = !window.__NO_PANEL;

  // 1. buy both licences (standalone mock — the real one is City Hall)
  ops.mockBuy('bus'); ops.mockBuy('rail');
  await ops.refresh(true);
  out.licences = { bus: T0.hasLicence('bus'), rail: T0.hasLicence('rail') };

  const P = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} return !!nc.game.tiles[x + ',' + z]; };

  // a few workplaces on the northern strip, so the rail line has a job end
  for (const [x, z] of [[7,1],[13,1],[19,1]]) await P('shop', x, z);

  // 2. site the two operation buildings (depot + rail control)
  out.depot = await P('op_bus', 2, 6);
  out.railops = await P('op_rail', 22, 6);

  // 3. bus stops beside the road grid the standard district built
  const busStops = [[3,3],[9,3],[13,3],[17,3],[21,3],[16,9],[3,9]];
  out.stops = [];
  for (const [x, z] of busStops) out.stops.push([x, z, await P('busstop', x, z)]);

  // 4. rail: a run of track and three stations on it
  out.track = 0;
  for (let x = 3; x <= 21; x++) if (await P('railtrack', x, 2)) out.track++;
  const stations = [[6,3],[11,3],[19,3]];
  out.stations = [];
  for (const [x, z] of stations) out.stations.push([x, z, await P('trainstation', x, z)]);

  // 5. draw the routes — the thing a player actually does
  const bus = T0.newLine('bus');
  bus.name = 'Northline Express';
  for (const [x, z] of busStops) T0.addStop(bus.id, x + ',' + z);
  bus.closed = true;
  const rail = T0.newLine('rail');
  rail.name = 'Ridge Line';
  for (const [x, z] of stations) T0.addStop(rail.id, x + ',' + z);
  T0.setShow(true);

  // 6. run the fleet and the economy for a few beats
  T0.manage(); nc.manageAgents();
  await nc.step(2, 6);
  T0.manage();
  await new Promise(r => setTimeout(r, 600));

  const rep = T0.report(true), led = T0.ledger();
  out.lines = T0.lines().map(L => ({ name: L.name, mode: L.mode, closed: L.closed,
    stops: L.stops.length, colour: '#' + L.color.toString(16),
    fault: (rep.lines[L.id] || {}).fault || null,
    riders: +((rep.lines[L.id] || {}).riders || 0).toFixed(2),
    homeReach: +((rep.lines[L.id] || {}).homeReach || 0).toFixed(3),
    workReach: +((rep.lines[L.id] || {}).workReach || 0).toFixed(3),
    vehicles: (rep.lines[L.id] || {}).vehicles | 0 }));
  out.vehicles = T0.vehicles().map(a => ({ kind: a.kind, line: a.line, at: a.path[a.i], stopIdx: a.stopIdx }));
  out.riders = +rep.riders.toFixed(2);
  out.modeShare = +rep.modeShare.toFixed(3);
  out.subsidyPerHr = +led.net.toFixed(3);
  out.upkeep = +led.upkeep.toFixed(3);
  out.fares = +led.fares.toFixed(3);
  // the sim wire, proved directly: what 100 private cars becomes
  const probe = { car: 100 }; T0.adjustAgentCounts(probe); out.carsOutOf100 = probe.car;
  out.overlaySegments = (T0.state._overlay && T0.state._overlay.children.length) | 0;
  out.agentKinds = nc.agents().reduce((a, g) => (a[g.kind] = (a[g.kind] || 0) + 1, a), {});

  // 7. save round-trip: the routes must survive a serialize/load, and a save
  //    written BEFORE transit existed (no `transit` key at all) must still open.
  let snapshot = null;
  try {
    snapshot = JSON.parse(nc.serialize()).transit || null;
    out.saved = snapshot && snapshot.lines ? snapshot.lines.length : 0;
    T0.load(JSON.parse(JSON.stringify(snapshot)));
    out.reloaded = T0.lines().map(L => L.name + '/' + L.stops.length).join(', ');
    T0.load(undefined);
    out.oldSaveOk = T0.lines().length === 0;
    T0.load(JSON.parse(JSON.stringify(snapshot)));      // restore the real one
    out.restored = T0.lines().map(L => L.name + '/' + L.stops.length).join(', ');
  } catch (e) { out.saveErr = String(e); }
  T0.manage();
  await new Promise(r => setTimeout(r, 400));
  out.vehiclesAfterReload = T0.vehicles().length;

  // 8. frame the northern strip, and open the panel if this run wants it
  try { nc.closeInspect(); } catch (e) {}
  if (PANEL) T0.open(); else T0.close();

  // 9. exercise the PANEL ITSELF — rename a line and recolour it through the
  //    real DOM controls, not through the model, so the wiring is proved too.
  if (PANEL) {
    const id = T0.lines()[0].id;
    const inp = document.querySelector('[data-trname="' + id + '"]');
    if (inp) { inp.value = 'Harbour Loop'; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    const sw = document.querySelectorAll('[data-trcol="' + id + '"]')[4];
    if (sw) sw.click();
    out.renamed = T0.lines()[0].name;
    out.recoloured = '#' + T0.lines()[0].color.toString(16);
    out.panelOpen = !!document.getElementById('tr-ov');
    out.stillRunning = (T0.report(true).lines[id] || {}).fault || 'running';
  }

  const c = nc.camera, ct = nc.controls;
  c.position.set(-1.5, 7.5, 6.0);
  if (ct && ct.target) { ct.target.set(0.5, 0, -8.0); ct.update(); }
  return out;
})()
