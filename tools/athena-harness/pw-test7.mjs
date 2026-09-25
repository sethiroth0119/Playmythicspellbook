/* Athena Engine round 7: physics (cannon-es, vendored). Dynamic bodies fall
   onto the terrain heightfield, static colliders block, Impulse / Set
   velocity / Set body kind nodes and the On Hit event work, kinematic bodies
   follow graph moves, stop restores, engine.mount runs it. harness2.html. */
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
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Physics', game: 'phys' }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);

await step('cannon-es loads from /vendor', async () => page.evaluate(async () => { const ok = await MythicMapForge.editor().world.physicsReady(); return { ok }; }).then(r => { if (!r.ok) throw new Error('no cannon'); return r; }));
await step('scene: hills + ball (dynamic sphere @ y=8), box (dynamic, Begin→Impulse), lift (kinematic, Begin→Move), wall', async () => {
  return page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    w.terrain.generate({ type: 'hills', seed: 7, amplitude: 6, scale: 0.35 }); w.onTerrainRebuilt();
    const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
    const hy = w.heightAt(10, 10);
    add({ id: 'o_ball', t: 'rock', n: 'ball', p: [10, hy + 8, 10], r: [0, 0, 0], s: [1, 1, 1], g: false, bp: { vars: { hits: { type: 'number', value: 0 } }, comps: [{ type: 'physics', kind: 'dynamic', shape: 'sphere', mass: 2, friction: 0.5, bounce: 0.1 }], graph: { nodes: [{ id: 'h', type: 'ev_hit', x: 0, y: 0, props: { with: 'ground', minImpact: 0.5 } }, { id: 's', type: 'setvar', x: 200, y: 0, props: { var: 'hits', value: '{$hits} + 1' } }], links: [{ from: { n: 'h', pin: 'then' }, to: { n: 's' } }] } } });
    const by = w.heightAt(-10, -10);
    add({ id: 'o_box', t: 'crate', n: 'box', p: [-10, by, -10], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'physics', kind: 'dynamic', shape: 'box', mass: 1, friction: 0.3, bounce: 0.1 }], graph: { nodes: [{ id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'i', type: 'impulse', x: 200, y: 0, props: { target: 'self', x: 6, y: 2, z: 0, local: 'false' } }], links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'i' } }] } } });
    const ly = w.heightAt(0, -20);
    add({ id: 'o_lift', t: 'crate', n: 'lift', p: [0, ly, -20], r: [0, 0, 0], s: [2, 0.3, 2], g: true, bp: { vars: {}, comps: [{ type: 'physics', kind: 'kinematic', shape: 'box', mass: 0, friction: 0.5, bounce: 0 }], graph: { nodes: [{ id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'mv', type: 'move', x: 200, y: 0, props: { target: 'self', x: 0, y: 2, z: 0, secs: 0.5, relative: 'true' } }], links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'mv' } }] } } });
    add({ id: 'o_wall', t: 'wall', n: 'wall', p: [-4, w.heightAt(-4, -10), -10], r: [0, 0, 0], s: [1, 2, 3], g: true });
    e.refresh();
    return { objs: m.objects.length, hy: +hy.toFixed(2), colliders: w.colliders.size };
  });
});
await step('Play: physics starts, ball lands on the hill (heightfield), box kicked, hit counted, lift follows Move', async () => {
  await page.keyboard.press('p'); await page.waitForTimeout(300);
  await page.waitForFunction(() => !!MythicMapForge.editor().world.physics, null, { timeout: 15000 });
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const w = e.world; const ph = w.physics;
    const ball = w.objects.get('o_ball'), box = w.objects.get('o_box'), lift = w.objects.get('o_lift');
    const y0 = ball.position.y, bx0 = box.position.x, ly0 = e.S.map.objects.find(o => o.id === 'o_lift').p[1];   // the doc y: the Move tween may already be running
    for (let i = 0; i < 240; i++) w.update(1 / 60, e.camera);   // 4 simulated seconds
    const ground = w.heightAt(ball.position.x, ball.position.z);
    return { bodies: ph.bodies.size, ballY0: +y0.toFixed(2), ballY: +ball.position.y.toFixed(2), ground: +ground.toFixed(2), restOk: Math.abs(ball.position.y - ground) < 1.2 && ball.position.y > ground - 0.2, boxDx: +(box.position.x - bx0).toFixed(2), hits: w.actors.vars('o_ball').hits.value, liftDy: +(lift.position.y - ly0).toFixed(2), liftBodyY: +ph.bodies.get('o_lift').body.position.y.toFixed(2), wallStatic: ph.world.bodies.some(b => b.userData && b.userData.id === 'o_wall') };
  });
  if (r.bodies !== 3 || !r.restOk || !(r.boxDx > 0.5) || !(r.hits >= 1) || Math.abs(r.liftDy - 2) > 0.05 || !r.wallStatic) throw new Error(JSON.stringify(r));
  return r;
});
await step('Set body kind static freezes; Set velocity moves; player pushes a dynamic body', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const w = e.world; const ph = w.physics;
    ph.setKind('o_ball', 'static'); const y1 = w.objects.get('o_ball').position.y; for (let i = 0; i < 60; i++) w.update(1 / 60, e.camera); const frozen = Math.abs(w.objects.get('o_ball').position.y - y1) < 0.01;
    ph.setKind('o_ball', 'dynamic'); ph.setVelocity('o_ball', [0, 0, 5]); const z0 = w.objects.get('o_ball').position.z; for (let i = 0; i < 30; i++) w.update(1 / 60, e.camera); const moved = w.objects.get('o_ball').position.z - z0;
    // walk the player into the box from the -x side
    const box = w.objects.get('o_box'); const bx = box.position.x, bz = box.position.z; e.play.pos.x = bx - 1.2; e.play.pos.z = bz; e.play.pos.y = box.position.y - 0.5;   // feet at the crate's base: the hills slope, so heightAt(feet) could sit the sphere above the crate
    for (let i = 0; i < 40; i++) { e.play.pos.x += 0.06; w.update(1 / 60, e.camera); }
    return { frozen, moved: +moved.toFixed(2), pushed: +(box.position.x - bx).toFixed(2) };
  });
  if (!r.frozen || !(r.moved > 1) || !(r.pushed > 0.2)) throw new Error(JSON.stringify(r));
  return r;
});
await step('Stop restores every body; edit mode has no physics', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const w = e.world; const b = e.S.map.objects.find(o => o.id === 'o_ball'); const root = w.objects.get('o_ball'); return { physics: !!w.physics, ballY: +root.position.y.toFixed(2), docY: +b.p[1].toFixed(2), dirty: e.S.dirty }; });
  if (r.physics || r.ballY !== r.docY) throw new Error(JSON.stringify(r));
  return r;
});
await step('engine.mount runs physics for a game', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 300)); await MythicMapForge.close();
    const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'phys', mode: 'fps', pointerLock: false });
    for (let i = 0; i < 40 && !g.world.physics; i++) await new Promise(r => setTimeout(r, 100));
    const ball = g.world.objects.get('o_ball'); const y0 = ball.position.y;
    for (let i = 0; i < 120; i++) g.world.update(1 / 60, g.camera);
    const out = { physics: !!g.world.physics, fell: y0 - ball.position.y > 3 };
    g.stop(); host.remove(); return out;
  });
  if (!r.physics || !r.fell) throw new Error(JSON.stringify(r));
  return r;
});
await step('normalize: physics component enums', async () => page.evaluate(() => { const m = MythicMapForge.format.normalize({ objects: [{ t: 'crate', bp: { comps: [{ type: 'physics', kind: 'bogus', shape: 'sphere', mass: 'x' }] } }] }); return m.objects[0].bp.comps[0]; }).then(c => { if (c.kind !== 'dynamic' || c.shape !== 'sphere' || c.mass !== 1) throw new Error(JSON.stringify(c)); return c; }));

console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
