(async () => {
  const nc = window.__nc, Z = window.MythicZoning, R = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  try { nc.build.finishAll('driver'); } catch (e) {}
  // a SMALL zone: 3 vacant road-fronted plots + some standing housing at low level
  const houses = Object.entries(nc.game.tiles).filter(([, t]) => t.type === 'housing').slice(0, 4).map(([k]) => k);
  R.houses = houses.map(k => ({ k, lvl: nc.game.tiles[k].lvl }));
  Z.setZone(0, 0, null);
  for (const k of Object.keys(Z.save())) delete Z.save()[k];      // clear the map for a clean read
  for (const k of houses) { const [x, z] = k.split(',').map(Number); Z.setZone(x, z, 'r_high'); }
  // three vacant road-fronted plots
  const isRoad = (x, z) => { const t = nc.game.tiles[x + ',' + z]; return !!t && t.type === 'road'; };
  let n = 0;
  for (let x = 0; x < 24 && n < 3; x++) for (let z = 0; z < 24 && n < 3; z++)
    if (!nc.game.tiles[x + ',' + z] && (isRoad(x+1,z)||isRoad(x-1,z)||isRoad(x,z+1)||isRoad(x,z-1))) { Z.setZone(x, z, 'r_high'); n++; }
  const p = Z.plan(null);
  R.plan = { out: p.out.length, grow: p.grow.length, skip: p.skip };
  await Z.develop();
  R.afterStart = { built: Z.stats().built, sites: Z.stats().sites, running: Z.developing() };
  // while the three sites are open, the grow half must NOT touch them
  R.planMidRun = (() => { const q = Z.plan(null); return { out: q.out.length, grow: q.grow.length, building: q.skip.building }; })();
  for (let i = 0; i < 4; i++) { await Z.step(); await sleep(60); }
  R.afterSteps = { built: Z.stats().built, sites: Z.stats().sites, running: Z.developing() };
  try { nc.build.finishAll('driver'); } catch (e) {}
  for (let i = 0; i < 12; i++) { await Z.step(); await sleep(80); }
  R.end = { built: Z.stats().built, sites: Z.stats().sites, running: Z.developing() };
  R.houseLvls = houses.map(k => ({ k, lvl: nc.game.tiles[k] ? nc.game.tiles[k].lvl : null }));
  R.toasts = Array.from(document.querySelectorAll('.toast, #toasts > *')).map(e => e.textContent.trim().slice(0, 190));
  R.developAgain = await Z.develop();     // nothing left ⇒ the honest refusal
  return R;
})()
