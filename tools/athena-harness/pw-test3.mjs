import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');   // this folder; setup.sh creates three/, www/, shots/, artifact/ here
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
const logs = []; page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness.html');
await page.waitForFunction(() => !!window.AthenaEngine);
await page.evaluate(() => { localStorage.clear(); const m = AthenaEngine.format.newMap({ name: 'Ruins test', game: 'wasteland' }); return AthenaEngine.open({ map: m }); });
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 40000 });
await page.waitForTimeout(400);
const ed = () => page.evaluate(() => AthenaEngine.editor());
const add = (t, x, z, extra) => page.evaluate(([t, x, z, extra]) => { const e = AthenaEngine.editor(); const o = Object.assign({ id: 'o_' + t + '_' + Math.random().toString(36).slice(2, 6), t, p: [x, e.world.heightAt(x, z), z], r: [0, 0, 0], s: [1, 1, 1], g: true }, extra || {}); e.S.map.objects.push(o); e.world.addObject(o); e.refresh(); return o.id; }, [t, x, z, extra]);
await step('brand + defaults', async () => ({ brand: await page.textContent('.mf-top .brand'), hotkeys: await page.inputValue('#mf-hotkeys'), toolbar: await page.evaluate(() => [...document.querySelectorAll('.mf-gizmo button')].map(b => b.textContent.trim())) }));
await step('ruins props build without error', async () => await page.evaluate(() => { const e = AthenaEngine.editor(); const ids = AthenaEngine.format.PROP_CATALOG.filter(p => p.cat === 'Ruins').map(p => p.id); let n = 0; ids.forEach((t, i) => { const o = { id: 'r' + i, t, p: [-40 + i * 4, 0, -40], r: [0, 0, 0], s: [1, 1, 1], g: true }; e.S.map.objects.push(o); e.world.addObject(o); n++; }); e.refresh(); return { built: n, colliders: e.world.colliders.size, tris: e.renderer.info.render.triangles }; }));
await step('wasteland preset + new paint layers', async () => { await page.click('.mf-tabs button[data-tab="sky"]'); await page.selectOption('#mf-e-preset', 'wasteland'); return await page.evaluate(() => ({ preset: AthenaEngine.editor().S.map.env.preset, layers: [...document.querySelectorAll('#mf-palette button')].map(b => b.textContent).slice(-5) })); });
// collision: wall in front of the spawn
await step('collision blocks the player in Play', async () => {
  await page.evaluate(() => { const e = AthenaEngine.editor(); e.S.map.objects.length = 0; Array.from(e.world.objects.keys()).forEach(id => e.world.removeObject(id)); e.world.terrain.generate({ type: 'flat' }); e.refresh(); });
  await add('spawn', 0, 0); const wall = await add('wall', 0, -3, { r: [0, 0, 0] });   // spawn faces -z (yaw = r[1] + PI → forward is +z?) check both
  const r = await page.evaluate(async (wall) => { const e = AthenaEngine.editor(); e.S.selectedId = null; document.getElementById('mf-play').click(); await new Promise(r => setTimeout(r, 200)); const p = e.play; const fwd = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
    // put the wall exactly 3 m ahead of the player along its facing
    const o = e.S.map.objects.find(o => o.id === wall); o.p = [p.pos.x + fwd[0] * 3, 0, p.pos.z + fwd[1] * 3]; e.world.refreshObject(o);
    p.keys.w = true; for (let i = 0; i < 60; i++) p.frame(0.05); p.keys.w = false; const d = Math.hypot(p.pos.x, p.pos.z);
    const col = e.world.colliders.get(wall); return { walked: +d.toFixed(2), wallTop: col && +col.top.toFixed(2), blockedBeforeWall: d < 2.9 && d > 1.5 }; }, wall);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  if (!r.blockedBeforeWall) throw new Error(JSON.stringify(r)); return r; });
await step('Remove collision via inspector → walks through', async () => {
  const r = await page.evaluate(async () => { const e = AthenaEngine.editor(); const wall = e.S.map.objects.find(o => o.t === 'wall'); e.S.selectedId = wall.id; e.refresh(); const before = document.querySelector('.mf-col .st').textContent; document.getElementById('mf-o-col-off').click(); await new Promise(r => setTimeout(r, 50)); const after = document.querySelector('.mf-col .st').textContent; const hasAdd = !!document.getElementById('mf-o-col-on');
    document.getElementById('mf-play').click(); await new Promise(r => setTimeout(r, 200)); const p = e.play; p.keys.w = true; for (let i = 0; i < 60; i++) p.frame(0.05); p.keys.w = false; return { before, after, hasAdd, walked: +Math.hypot(p.pos.x, p.pos.z).toFixed(2), col: wall.col }; });
  await page.keyboard.press('Escape'); await page.waitForTimeout(100); if (r.walked < 4) throw new Error(JSON.stringify(r)); return r; });
await step('Add collision back + undo', async () => await page.evaluate(async () => { const e = AthenaEngine.editor(); const wall = e.S.map.objects.find(o => o.t === 'wall'); e.S.selectedId = wall.id; e.refresh(); document.getElementById('mf-o-col-on').click(); await new Promise(r => setTimeout(r, 50)); const solid = e.world.colliders.has(wall.id); return { solid, col: wall.col, undoDepth: e.S.undo.length }; }));
await step('step onto a crate (low collider = ground)', async () => {
  const r = await page.evaluate(async () => { const e = AthenaEngine.editor(); e.S.map.objects.filter(o => o.t === 'wall').forEach(o => { e.S.map.objects.splice(e.S.map.objects.indexOf(o), 1); e.world.removeObject(o.id); });
    document.getElementById('mf-play').click(); await new Promise(r => setTimeout(r, 200)); const p = e.play; const fwd = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
    const c = { id: 'crate1', t: 'crate', p: [p.pos.x + fwd[0] * 2.5, 0, p.pos.z + fwd[1] * 2.5], r: [0, 0, 0], s: [2, 0.5, 2], g: true }; e.S.map.objects.push(c); e.world.addObject(c);
    let onTop = false; p.keys.w = true; for (let i = 0; i < 40; i++) { p.frame(0.05); if (Math.abs(p.pos.y - e.world.colliders.get('crate1').top) < 0.05) { onTop = true; break; } } p.keys.w = false; return { y: +p.pos.y.toFixed(2), crateTop: +e.world.colliders.get('crate1').top.toFixed(2), onTop }; });
  await page.keyboard.press('Escape'); if (!r.onTop) throw new Error(JSON.stringify(r)); return r; });
await step('WASD + arrows move in Play (keyboard events)', async () => {
  await page.keyboard.press('p'); await page.waitForTimeout(200);
  const p0 = await page.evaluate(() => AthenaEngine.editor().play.pos.toArray());
  const held = async (key, n) => { await page.keyboard.down(key); const k = await page.evaluate((n) => { const p = AthenaEngine.editor().play; const before = p.pos.clone(); for (let i = 0; i < n; i++) p.frame(0.05); return { keys: Object.keys(p.keys).filter(x => p.keys[x]), moved: +p.pos.distanceTo(before).toFixed(2) }; }, n); await page.keyboard.up(key); return k; };
  const kw = await held('w', 20), kd = await held('d', 10), kl = await held('ArrowLeft', 10); if (!kw.keys.includes('w') || !kd.keys.includes('d') || !kl.keys.includes('arrowleft') || kw.moved < 4 || kd.moved < 2 || kl.moved < 2) throw new Error(JSON.stringify({ kw, kd, kl }));
  const p1 = await page.evaluate(() => AthenaEngine.editor().play.pos.toArray());
  await page.keyboard.press('Escape');
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]); if (moved < 1) throw new Error('moved ' + moved); return { moved: +moved.toFixed(2) }; });
await step('Unreal hotkeys: Q/W/E/R switch, W does not fly without RMB', async () => {
  await page.evaluate(() => { const e = AthenaEngine.editor(); e.S.selectedId = 'crate1'; e.refresh(); });
  await page.mouse.move(600, 400);
  const cam0 = await page.evaluate(() => AthenaEngine.editor().camera.position.toArray());
  await page.keyboard.press('e'); const m1 = await page.evaluate(() => AthenaEngine.editor().S.gizmoMode);
  await page.keyboard.press('r'); const m2 = await page.evaluate(() => AthenaEngine.editor().S.gizmoMode);
  await page.keyboard.press('w'); const m3 = await page.evaluate(() => AthenaEngine.editor().S.gizmoMode);
  await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
  const cam1 = await page.evaluate(() => AthenaEngine.editor().camera.position.toArray());
  await page.keyboard.press('2'); const tool = await page.evaluate(() => AthenaEngine.editor().S.tool);
  await page.keyboard.press('q'); const tool2 = await page.evaluate(() => AthenaEngine.editor().S.tool);
  // RMB + W flies
  await page.mouse.down({ button: 'right' }); await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w'); await page.mouse.up({ button: 'right' });
  const cam2 = await page.evaluate(() => AthenaEngine.editor().camera.position.toArray());
  const still = Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]) < 0.01, flew = Math.hypot(cam2[0] - cam1[0], cam2[2] - cam1[2]) > 0.5;
  if (!(m1 === 'rotate' && m2 === 'scale' && m3 === 'translate' && tool === 'sculpt' && tool2 === 'select' && still && flew)) throw new Error(JSON.stringify({ m1, m2, m3, tool, tool2, still, flew })); return { m1, m2, m3, still, flew }; });
await step('local/world space + snap size + colliders view', async () => { await page.click('#mf-space'); await page.selectOption('#mf-snapsize', '2'); await page.click('#mf-snap'); await page.click('#mf-colview'); return await page.evaluate(() => { const e = AthenaEngine.editor(); return { space: e.S.gizmoSpace, gizmoSpace: e.gizmo.space, snap: e.S.snap, tsnap: e.gizmo.translationSnap, colBoxes: e.scene.children.filter(c => c.type === 'Group' && c.children.length && c.children[0].type === 'Box3Helper').length }; }); });
await page.evaluate(() => { const e = AthenaEngine.editor(); e.S.map.objects.length = 0; Array.from(e.world.objects.keys()).forEach(id => e.world.removeObject(id)); e.world.terrain.generate({ type: 'hills', seed: 77, amplitude: 4, scale: 0.4 }); e.refresh(); });
await step('ruined city scene render', async () => {
  await page.evaluate(() => { const e = AthenaEngine.editor(); const put = (t, x, z, ry, s) => { const o = { id: 'c' + Math.random().toString(36).slice(2, 7), t, p: [x, e.world.heightAt(x, z), z], r: [0, ry || 0, 0], s: [s || 1, s || 1, s || 1], g: true }; e.S.map.objects.push(o); e.world.addObject(o); };
    put('road', -6, 0, 0); put('road', 2, 0, 0); put('road', 10, 0, 0); put('ruintower', -8, -9, 0.3); put('ruintower', 12, -10, -0.2, 0.8); put('collapsed', 4, -9, 0.1); put('overpass', 20, 2, 1.57); put('wreckcar', -2, 3, 0.4); put('wreckcar', 7, -3, 2.6); put('lamppost', -10, 3, 0); put('lamppost', 6, 3, 0); put('barrier', 0, 5, 0); put('barrier', 3.2, 5, 0); put('barricade', 12, 4, 0.5); put('container', -16, 6, 0.4); put('radiotower', 18, -20, 0); put('billboard', -14, -14, 0.6); put('burnttree', 14, 10, 0); put('burnttree', -20, -3, 0); put('drum', 2, 7, 0); put('drum', 2.8, 7, 0); put('scrap', -6, 8, 0); put('crater', 24, 12, 0); put('generator', 9, 8, 0); put('pylon', -22, 12, 0); put('dronewreck', 16, 6, 0); put('bunker', -26, -8, 1.2); put('sfcrate', 10, 10, 0.3); put('rubble', -12, -4, 0); put('spawn', 0, 12, 0);
    e.S.map.env.preset = 'wasteland'; Object.assign(e.S.map.env, AthenaEngine.format.ENV_PRESETS.wasteland, { preset: 'wasteland' }); e.world.applyEnv(e.S.map.env); e.S.map.water.on = false; e.world.applyWater(e.S.map.water);
    for (let i = 0; i < 300; i++) { const x = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 60; e.world.terrain.applyBrush({ x, z, radius: 6, strength: 1, falloff: 0.5, mode: 'paint', paint: Math.random() < 0.5 ? 10 : Math.random() < 0.5 ? 11 : 14 }); }
    e.camera.position.set(-6, 14, 30); e.camera.lookAt(2, 3, -6); e.S.selectedId = null; e.refresh(); });
  await page.waitForTimeout(800); await page.screenshot({ path: S + '/shots/t3-ruins.png' }); return 'ok'; });
console.log('--- errors:', await page.evaluate(() => window.__errors), logs.slice(0, 8));
await browser.close();
