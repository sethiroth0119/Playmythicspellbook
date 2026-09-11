/* Athena Engine round 8: navigation + AI. Navmesh bake (slope, water,
   colliders), A* around a wall with string-pulling, Move To / Chase / Patrol /
   Wander / Look at, On See, a spawned enemy prefab that chases, the editor's
   navmesh overlay. harness2.html. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const S = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Nav', game: 'navgame', n: 48, cell: 1 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);

await step('bake: flat map with a long wall, a lake and a cliff → cells classified', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    // a lake: sink a patch below water; a cliff: raise a block
    const t = m.terrain, n1 = t.n + 1; for (let i = 0; i < t.heights.length; i++) { const c = i % n1, r = (i - c) / n1; const x = -24 + c, z = -24 + r; if (x > 10 && x < 18 && z > 10 && z < 18) t.heights[i] = -3; if (x < -14 && z < -14) t.heights[i] = 6; }
    w.terrain.setData(t); w.onTerrainRebuilt();
    const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
    // a wall across x from -8..8 at z = 0 (scaled stone wall)
    add({ id: 'o_wall', t: 'wall', n: 'wall', p: [0, 0, 0], r: [0, 0, 0], s: [8, 1.5, 1], g: true });
    e.refresh();
    const nav = w.nav.bake();
    return { cells: nav.cells, wallBlocked: !nav.walkable(0, 0), besideWall: nav.walkable(0, 3), lake: !nav.walkable(14, 14), cliffTop: nav.walkable(-20, -20), cliffEdge: !nav.walkable(-14, -20), open: nav.walkable(5, 10) };
  });
  if (!r.wallBlocked || !r.besideWall || !r.lake || !r.cliffEdge || !r.open) throw new Error(JSON.stringify(r));
  return r;
});
await step('A*: path from one side of the wall to the other goes around it', async () => {
  const r = await page.evaluate(() => {
    const nav = MythicMapForge.editor().world.nav; const p = nav.findPath([0, -5], [0, 5]);
    if (!p) return { err: 'no path' };
    const crosses = p.some(pt => Math.abs(pt.z) < 0.8 && Math.abs(pt.x) < 8.5);
    const len = p.reduce((a, pt, i) => i ? a + Math.hypot(pt.x - p[i - 1].x, pt.z - p[i - 1].z) : 0, 0);
    return { points: p.length, crosses, len: +len.toFixed(1), ends: [p[0], p[p.length - 1]], noPathIntoLake: nav.findPath([0, 20], [14, 14]) !== null };
  });
  if (r.err || r.crosses || r.points < 3 || r.len < 12 || r.len > 40) throw new Error(JSON.stringify(r));
  return r;
});
await step('navmesh overlay toggles in the Terrain tab', async () => {
  await page.click('.mf-tabs button[data-tab="terrain"]'); await page.click('#mf-t-nav');
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.scene.children.find(c => c.name === 'mf-navmesh'); return { shown: !!m, verts: m ? m.geometry.attributes.position.count : 0 }; });
  await page.click('#mf-t-nav');
  const off = await page.evaluate(() => !MythicMapForge.editor().scene.children.find(c => c.name === 'mf-navmesh'));
  if (!r.shown || !r.verts || !off) throw new Error(JSON.stringify({ r, off }));
  return r;
});
await step('agents: guard (Begin→Move To wp, arrived→Patrol), hunter (On See→Chase), enemy prefab spawner', async () => {
  return page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
    add({ id: 'o_wp1', t: 'waypoint', n: 'wp1', p: [-10, 0, 8], r: [0, 0, 0], s: [1, 1, 1], g: true });
    add({ id: 'o_wp2', t: 'waypoint', n: 'wp2', p: [10, 0, 8], r: [0, 0, 0], s: [1, 1, 1], g: true });
    add({ id: 'o_guard', t: 'statue', n: 'guard', p: [0, 0, -8], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: { arrivals: { type: 'number', value: 0 } }, comps: [{ type: 'agent', speed: 6, turn: 8, stop: 0.8 }], graph: {
      nodes: [{ id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'mv', type: 'moveto', x: 200, y: 0, props: { target: 'wp1', x: '', z: '' } }, { id: 'pt', type: 'patrol', x: 400, y: 0, props: { points: 'wp1, wp2', wait: 0.2, loop: 'true' } }, { id: 'cnt', type: 'setvar', x: 600, y: 0, props: { var: 'arrivals', value: '{$arrivals} + 1' } }],
      links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'mv' } }, { from: { n: 'mv', pin: 'arrived' }, to: { n: 'pt' } }, { from: { n: 'pt', pin: 'arrived' }, to: { n: 'cnt' } }] } } });
    add({ id: 'o_hunter', t: 'statue', n: 'hunter', p: [-6, 0, 14], r: [0, Math.PI, 0], s: [1, 1, 1], g: true, bp: { vars: { caught: { type: 'number', value: 0 }, seen: { type: 'number', value: 0 } }, comps: [{ type: 'agent', speed: 7, turn: 10, stop: 0.8 }], graph: {
      nodes: [{ id: 'see', type: 'ev_see', x: 0, y: 0, props: { target: 'player', range: 12, fov: 160 } }, { id: 's1', type: 'setvar', x: 200, y: 0, props: { var: 'seen', value: '{$seen} + 1' } }, { id: 'ch', type: 'chase', x: 400, y: 0, props: { target: 'player', range: 30, reach: 1.5 } }, { id: 'c1', type: 'setvar', x: 600, y: 0, props: { var: 'caught', value: '{$caught} + 1' } }],
      links: [{ from: { n: 'see', pin: 'then' }, to: { n: 's1' } }, { from: { n: 's1', pin: 'then' }, to: { n: 'ch' } }, { from: { n: 'ch', pin: 'caught' }, to: { n: 'c1' } }] } } });
    // an enemy prefab (one crate with a chase blueprint) + a spawner that spawns it on Begin
    m.prefabs.push({ id: 'pf_enemy', name: 'Enemy', icon: '👹', objects: [{ id: 'c_body', t: 'crate', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: false, bp: { vars: {}, comps: [], graph: { nodes: [], links: [] } } }] });
    add({ id: 'o_spawner', t: 'altar', n: 'spawner', p: [8, 0, -12], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [], graph: { nodes: [{ id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'sp', type: 'spawn', x: 200, y: 0, props: { what: 'Enemy', x: 0, y: 0, z: 2, name: 'mob' } }], links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'sp' } }] } } });
    add({ id: 'o_wanderer', t: 'rock', n: 'wanderer', p: [14, 0, -14], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'agent', speed: 4, turn: 8, stop: 0.5 }], graph: { nodes: [{ id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'wd', type: 'wander', x: 200, y: 0, props: { radius: 5, wait: 0.1 } }], links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'wd' } }] } } });
    e.refresh();
    return { objs: m.objects.length };
  });
});
await step('Play: guard walks to wp1 then patrols; wanderer moves; spawned mob exists', async () => {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });   // the navmesh checkbox still had focus: hotkeys ignore typing targets
  await page.keyboard.press('p'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const w = e.world;
    e.play.pos.x = 20; e.play.pos.z = -20;   // park the player far away in a corner
    const guard = w.objects.get('o_guard'), wand = w.objects.get('o_wanderer'); const wx0 = wand.position.x, wz0 = wand.position.z;
    let reachedWp1 = false;
    for (let i = 0; i < 600; i++) { w.update(1 / 60, e.camera); if (!reachedWp1 && Math.hypot(guard.position.x + 10, guard.position.z - 8) < 1.2) reachedWp1 = true; }
    const arrivals = w.actors.vars('o_guard').arrivals.value;
    const mob = e.S.map.objects.find(o => o._rt && o.n === 'mob');
    return { reachedWp1, arrivals, guardAt: [+guard.position.x.toFixed(1), +guard.position.z.toFixed(1)], wanderMoved: +Math.hypot(wand.position.x - wx0, wand.position.z - wz0).toFixed(2), mob: !!mob, mobType: mob && mob.t, nav: !!w.nav.baked };
  });
  if (!r.reachedWp1 || !(r.arrivals >= 1) || !(r.wanderMoved > 0.5) || !r.mob || r.mobType !== 'prefab') throw new Error(JSON.stringify(r));
  return r;
});
await step('hunter: On See fires when the player steps into view, then Chase catches the player', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const w = e.world; const h = w.objects.get('o_hunter');
    // hunter faces -z (rotation PI at z=14 → looks toward smaller z). Put the player behind it first (z=20): not seen.
    e.play.pos.x = -6; e.play.pos.z = 20; for (let i = 0; i < 20; i++) w.update(1 / 60, e.camera);
    const seenBehind = w.actors.vars('o_hunter').seen.value;
    // now in front, 8 m away
    e.play.pos.x = -6; e.play.pos.z = 6; for (let i = 0; i < 5; i++) w.update(1 / 60, e.camera);
    const seenFront = w.actors.vars('o_hunter').seen.value;
    const d0 = Math.hypot(h.position.x - e.play.pos.x, h.position.z - e.play.pos.z);
    for (let i = 0; i < 300; i++) w.update(1 / 60, e.camera);
    const d1 = Math.hypot(h.position.x - e.play.pos.x, h.position.z - e.play.pos.z);
    return { seenBehind, seenFront, d0: +d0.toFixed(1), d1: +d1.toFixed(1), caught: w.actors.vars('o_hunter').caught.value, moving: !!w.actors.actors.get('o_hunter').nav };
  });
  if (r.seenBehind !== 0 || r.seenFront !== 1 || !(r.d1 < 2) || r.caught !== 1) throw new Error(JSON.stringify(r));
  return r;
});
await step('Stop restores agents; runtime mob gone', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const g = e.world.objects.get('o_guard'); const d = e.S.map.objects.find(o => o.id === 'o_guard'); return { back: Math.abs(g.position.x - d.p[0]) < 0.01 && Math.abs(g.position.z - d.p[2]) < 0.01, rt: e.S.map.objects.filter(o => o._rt).length }; });
  if (!r.back || r.rt !== 0) throw new Error(JSON.stringify(r));
  return r;
});
await step('engine.mount: agents run for a game', async () => {
  const r = await page.evaluate(async () => {
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 300)); await MythicMapForge.close();
    const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'navgame', mode: 'fps', pointerLock: false });
    const guard = g.world.objects.get('o_guard'); const x0 = guard.position.x, z0 = guard.position.z;
    for (let i = 0; i < 200; i++) g.world.update(1 / 60, g.camera);
    const out = { moved: +Math.hypot(guard.position.x - x0, guard.position.z - z0).toFixed(1), baked: g.world.nav.baked };
    g.stop(); host.remove(); return out;
  });
  if (!(r.moved > 2) || !r.baked) throw new Error(JSON.stringify(r));
  return r;
});
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
