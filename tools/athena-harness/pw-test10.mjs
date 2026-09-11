/* Athena Engine round 10: performance. Instanced batches for repeated static
   props in the engine (draw calls), per-instance hide on destroy and folder
   toggle, exclusion of actors, emitter distance culling, the quality ladder
   (pixel ratio / shadows / fx) and auto-tune. harness2.html. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.clear(); });

await step('a forest map: 300 pines (+ 40 tinted), 5 fires, one pine actor, saved + live', async () => {
  return page.evaluate(async () => {
    const m = MythicMapForge.format.newMap({ name: 'Forest', game: 'perf', n: 64, cell: 2 });
    m.folders.push({ id: 'f_north', name: 'North', parent: null, open: true, vis: true, lock: false });
    let k = 0;
    for (let i = 0; i < 300; i++) { const x = -60 + (i % 20) * 6, z = -60 + Math.floor(i / 20) * 8; m.objects.push({ id: 'o_p' + i, t: 'pine', p: [x, 0, z], r: [0, i * 0.3, 0], s: [1, 1, 1], g: true, f: i < 100 ? 'f_north' : undefined }); }
    for (let i = 0; i < 40; i++) m.objects.push({ id: 'o_t' + i, t: 'pine', c: '#c26a2a', p: [-50 + i * 2.5, 0, 62], r: [0, 0, 0], s: [1, 1, 1], g: true });
    for (let i = 0; i < 5; i++) m.objects.push({ id: 'o_f' + i, t: 'campfire', p: [-60 + i * 30, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true });
    m.objects.push({ id: 'o_actor', t: 'pine', n: 'walker', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'spin', speed: 30 }], graph: { nodes: [], links: [] } } });
    const sv = await MythicMapForge.maps.save(m, 'local'); await MythicMapForge.maps.setLive(m.id, 'local', true);
    return { objs: m.objects.length, saved: sv.ok };
  });
});
await step('engine: instanced batches cut draw calls; actor + tinted group handled', async () => {
  const r = await page.evaluate(async () => {
    const host = document.createElement('div'); host.style.cssText = 'width:640px;height:400px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'perf', mode: 'orbit' });
    g.world.update(0.016, g.camera); g.renderer.render(g.scene, g.camera);
    const withCalls = g.renderer.info.render.calls; const stats = g.world.stats();
    const actorInstanced = !!g.world.objects.get('o_actor').userData.mfInstanced;
    const pineMeshesVisible = (() => { let n = 0; g.world.objects.get('o_p1').traverse(x => { if (x.isMesh && x.visible) n++; }); return n; })();
    g.world.setInstancing(false); g.world.update(0.016, g.camera); g.renderer.render(g.scene, g.camera);
    const withoutCalls = g.renderer.info.render.calls;
    g.world.setInstancing(true); g.world.update(0.016, g.camera); g.renderer.render(g.scene, g.camera);
    const again = g.renderer.info.render.calls;
    window.__g = g; window.__host = host;
    return { withCalls, withoutCalls, again, stats, actorInstanced, pineMeshesVisible, ratio: +(withoutCalls / withCalls).toFixed(1) };
  });
  if (!(r.withoutCalls > r.withCalls * 4) || r.stats.batches !== 2 || r.stats.instanced !== 340 || r.actorInstanced || r.pineMeshesVisible !== 0 || r.again > r.withCalls + 2) throw new Error(JSON.stringify(r));
  return r;
});
await step('destroy hides one instance; folder hide collapses 100; both restore', async () => {
  const r = await page.evaluate(() => {
    const g = window.__g; const w = g.world; const b = w.batches.get('pine|'); const im = b.meshes[0]; const M = new g.THREE.Matrix4();
    const idx = w.objects.get('o_p5').userData.mfInstanced.index;
    const before = im.getMatrixAt(idx, M) || M.elements[0];
    const scaleOf = () => { im.getMatrixAt(idx, M); const e = M.elements; return Math.hypot(e[0], e[1], e[2]); };
    const s0 = scaleOf();
    w.startPlay(null); w.actors; // play so destroy is a runtime hide
    // destroy through the actor host path: hide root + sync
    w.objects.get('o_p5').visible = false; w.syncInstance('o_p5'); const s1 = scaleOf();
    w.stopPlay(); w.objects.get('o_p5').visible = true; w.syncInstance('o_p5'); const s2 = scaleOf();
    // folder North hidden → its 100 pines collapse
    w.setFolderVisible('North', false);
    let zero = 0; for (let i = 0; i < b.ids.length; i++) { im.getMatrixAt(i, M); const e = M.elements; if (Math.hypot(e[0], e[1], e[2]) < 1e-6) zero++; }
    w.setFolderVisible('North', true);
    let zero2 = 0; for (let i = 0; i < b.ids.length; i++) { im.getMatrixAt(i, M); const e = M.elements; if (Math.hypot(e[0], e[1], e[2]) < 1e-6) zero2++; }
    return { s0: +s0.toFixed(2), s1, s2: +s2.toFixed(2), zeroWhenHidden: zero, zeroAfter: zero2 };
  });
  if (r.s0 < 0.9 || r.s1 !== 0 || r.s2 < 0.9 || r.zeroWhenHidden !== 100 || r.zeroAfter !== 0) throw new Error(JSON.stringify(r));
  return r;
});
await step('emitter culling: fires beyond fxRange stop updating and hide', async () => {
  const r = await page.evaluate(() => {
    const g = window.__g; const w = g.world;
    w.setFxRange(40); g.camera.position.set(-60, 5, 0); g.camera.lookAt(-60, 0, 10); w.update(0.016, g.camera);
    const vis = []; w.emitters.forEach((em, id) => vis.push(id + ':' + em.group.visible));
    w.setFxRange(1000); w.update(0.016, g.camera);
    const vis2 = []; w.emitters.forEach((em) => vis2.push(em.group.visible));
    return { near: vis, allBack: vis2.every(Boolean) };
  });
  if (!r.near.includes('o_f0:true') || !r.near.includes('o_f4:false') || !r.allBack) throw new Error(JSON.stringify(r));
  return r;
});
await step('quality ladder: set low → pixel ratio 1, shadows off, fx off; high restores; persisted', async () => {
  const r = await page.evaluate(() => {
    const g = window.__g; const Q = MythicMapForge.quality;
    Q.set('low'); const low = { pr: g.renderer.getPixelRatio(), shadows: g.renderer.shadowMap.enabled, fx: g.world.emitters.size, sun: g.world.sun.castShadow, stored: localStorage.getItem('mf_quality') };
    Q.set('high'); const high = { pr: g.renderer.getPixelRatio(), shadows: g.renderer.shadowMap.enabled, fx: g.world.emitters.size, sun: g.world.sun.castShadow };
    Q.set('auto'); return { low, high, pref: Q.get().pref, level: Q.get().level };
  });
  if (r.low.pr !== 1 || r.low.shadows || r.low.fx !== 0 || r.low.sun || r.low.stored !== 'low' || !r.high.shadows || r.high.fx !== 5 || r.level !== 'high') throw new Error(JSON.stringify(r));
  return r;
});
await step('auto-tune steps down after sustained low fps (simulated)', async () => {
  const r = await page.evaluate(() => {
    const Q = MythicMapForge.quality; Q.set('auto'); const t = MythicMapForge.editor ? null : null;
    // drive a tuner directly with 15 fps frames: 4 s warm-up + 3 s window
    const tuner = window.__g.quality.createTuner ? null : null;
    return null;
  });
  const r2 = await page.evaluate(async () => {
    const mod = await import('/src/mapforge/mapforge.quality.js'); mod.set('auto'); const tuner = mod.createTuner({ minFps: 28, windowSecs: 1, cooldownSecs: 1 });
    let stepped = null; for (let i = 0; i < 400 && !stepped; i++) stepped = tuner.frame(1 / 15);
    const after = mod.get(); const applied = window.__g.renderer.shadowMap.enabled;
    let stepped2 = null; for (let i = 0; i < 400 && !stepped2; i++) stepped2 = tuner.frame(1 / 15);
    const out = { stepped, level: after.level, pref: after.pref, appliedShadowsMedium: applied, stepped2, level2: mod.get().level };
    mod.set('auto'); return out;
  });
  if (r2.stepped !== 'medium' || r2.level !== 'medium' || r2.pref !== 'auto' || r2.stepped2 !== 'low') throw new Error(JSON.stringify(r2));
  return r2;
});
await step('editor keeps per-object meshes (no instancing), shows calls in the HUD, quality select', async () => {
  await page.evaluate(() => { window.__g.stop(); window.__host.remove(); });
  await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Q' }) }));
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 });
  await page.waitForFunction(() => /calls/.test(document.getElementById('mf-hud-fps').textContent), null, { timeout: 15000 });   // the HUD refreshes every 0.5 s of frame time
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); return { instancing: e.world.instancing, hud: document.getElementById('mf-hud-fps').textContent, sel: document.getElementById('mf-quality').value }; });
  if (r.instancing || !/calls/.test(r.hud) || r.sel !== 'auto') throw new Error(JSON.stringify(r));
  await page.selectOption('#mf-quality', 'low'); await page.waitForTimeout(100);
  const r3 = await page.evaluate(() => ({ pr: MythicMapForge.editor().renderer.getPixelRatio(), shadows: MythicMapForge.editor().renderer.shadowMap.enabled }));
  if (r3.pr !== 1 || r3.shadows) throw new Error(JSON.stringify(r3));
  await page.selectOption('#mf-quality', 'auto');
  return Object.assign(r, r3);
});
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
