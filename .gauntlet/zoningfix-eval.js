(async () => {
  const nc = window.__nc, Z = window.MythicZoning;
  const R = { A: {}, B: {} };
  if (!nc || !Z) return { err: 'no seam', nc: !!nc, Z: !!Z };
  const { camera } = nc.three();
  const cv = document.querySelector('canvas');
  const HALF = 12;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function screenOf(x, z) {
    const r = cv.getBoundingClientRect();
    const v = new (nc.three().THREE.Vector3)(x - HALF + .5, 0, z - HALF + .5);
    v.project(camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
  }
  function click(x, z, button) {
    const p = screenOf(x, z);
    const o = { clientX: p.x, clientY: p.y, button: button || 0, buttons: button === 2 ? 2 : 1,
                bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', o));
  }
  const isRoad = (x, z) => { const t = nc.game.tiles[x + ',' + z]; return !!t && t.type === 'road'; };
  const front = (x, z) => isRoad(x+1,z) || isRoad(x-1,z) || isRoad(x,z+1) || isRoad(x,z-1);
  function freeTile() {
    for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++)
      if (!nc.game.tiles[x + ',' + z] && front(x, z) && screenOf(x, z).x > 40) return { x, z };
    return null;
  }
  R.tiles0 = Object.keys(nc.game.tiles).length;

  /* ═══ A. MODE EXCLUSION ═══════════════════════════════════════════════════ */
  const a = freeTile();
  R.A.tile = a;
  Z.panel(true);                                  // open the Zones panel (arms the tool)
  R.A.armedAfterPanel = Z.armed();
  R.A.modeAfterPanel = Z._ctx.mode();
  Z.select('r_low');
  Z._ctx.setMode('place', 'housing');             // exactly what a build-bar click runs
  R.A.armedAfterBuildPick = Z.armed();
  R.A.panelOpenAfterBuildPick = !!document.querySelector('#nz-panel.on');
  click(a.x, a.z);
  await sleep(1200);
  R.A.tileAfterClick = !!nc.game.tiles[a.x + ',' + a.z];
  R.A.typeAfterClick = (nc.game.tiles[a.x + ',' + a.z] || {}).type || null;
  R.A.zoneAfterClick = Z.zoneAt(a.x, a.z);
  R.A.tiles = Object.keys(nc.game.tiles).length;

  /* reverse direction: arming the zone tool must drop the held building */
  Z._ctx.setMode('place', 'housing');
  Z.panel(true);
  R.A.modeAfterArm = Z._ctx.mode();
  R.A.armedAfterArm = Z.armed();
  const b = freeTile();
  click(b.x, b.z);                                 // armed ⇒ this must ZONE, not build
  await sleep(400);
  R.A.zoneToolStillPaints = Z.zoneAt(b.x, b.z);
  R.A.noBuildOnPaint = !nc.game.tiles[b.x + ',' + b.z];
  Z.panel(false);
  Z.setZone(b.x, b.z, null);

  /* ═══ B. DEVELOP vs THE CREW LIMIT ═══════════════════════════════════════ */
  try { nc.build.finishAll('driver'); } catch (e) {}
  R.B.cfg = (window.MythicEconomy && window.MythicEconomy.ECON.construction.zoned) || null;
  R.B.slots = nc.build.slots();
  // zone a big block of low-density housing over open, road-fronted land
  const rect = Z.applyRect(0, 0, 23, 23, 'r_low');
  R.B.zonedTiles = rect.changed;
  const p0 = Z.plan(null);
  R.B.planned = p0.out.length;
  R.B.grow = p0.grow.length;

  const d = await Z.develop();
  R.B.developReturn = { started: d.started, running: d.running, built: d.built, planned: d.planned };
  R.B.afterFirstPermit = { devSites: nc.build.devSites(), crewLoad: nc.build.crewLoad(),
                           active: nc.build.active(), committed: nc.build.committed() };
  // step the run by hand: shot.mjs cannot wait out permitSec
  for (let i = 0; i < 10; i++) { await Z.step(); await sleep(60); }
  R.B.afterTenPermits = { devSites: nc.build.devSites(), crewLoad: nc.build.crewLoad(),
                          active: nc.build.active(), built: Z.stats().built, running: Z.developing() };
  R.B.buildList = nc.build.list().length;

  /* the crews are still the player's: a hand placement must still be accepted
     while the district is building itself */
  const h = freeTile();
  Z._ctx.setMode('place', 'housing');
  await nc.place('housing', h.x, h.z);
  await sleep(600);
  R.B.handPlaceWhileDeveloping = !!nc.game.tiles[h.x + ',' + h.z];
  R.B.crewLoadAfterHand = nc.build.crewLoad();

  /* let the sites land, then keep stepping — the run should grow / finish */
  try { nc.build.finishAll('driver'); } catch (e) {}
  R.B.devSitesAfterFinish = nc.build.devSites();
  for (let i = 0; i < 12; i++) { await Z.step(); await sleep(60); }
  R.B.afterMore = { built: Z.stats().built, devSites: nc.build.devSites(),
                    running: Z.developing(), tiles: Object.keys(nc.game.tiles).length };
  R.B.stopped = Z.developing() ? Z.stopDevelop() : 'already stopped';
  R.B.tilesEnd = Object.keys(nc.game.tiles).length;
  R.B.saveSlice = (() => { try { return nc.saveExt().collect().zoning; } catch (e) { return String(e); } })();
  return R;
})()
