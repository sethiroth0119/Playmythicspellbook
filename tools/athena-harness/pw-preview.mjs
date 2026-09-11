import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');   // this folder; setup.sh creates three/, www/, shots/, artifact/ here
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
await page.goto('http://127.0.0.1:8765/harness.html');
await page.waitForFunction(() => !!window.MythicMapForge);
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Emberwatch Isle' }) }));
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 40000 });
await page.waitForTimeout(500);
// build a little scene through the editor's own API/state
await page.evaluate(() => {
  const e = MythicMapForge.editor(), w = e.world, m = e.S.map;
  w.terrain.generate({ type: 'island', seed: 4242, amplitude: 7, scale: 0.4 });
  m.water.level = -0.4; w.applyWater(m.water);
  const put = (t, x, z, ry, s, c) => { const o = { id: 'o_' + Math.random().toString(36).slice(2, 8), t, p: [x, w.heightAt(x, z), z], r: [0, ry || 0, 0], s: [s || 1, s || 1, s || 1], g: true }; if (c) o.c = c; if (o.p[1] < m.water.level) return; m.objects.push(o); w.addObject(o); };
  put('house', 2, 4, 0.6, 1, '#7a2a2a'); put('cottage', -8, 6, -0.3); put('tower', 10, -6, 0, 1.1, '#2c3f6e'); put('well', -3, 10, 0); put('lantern', 5, 9, 0); put('lantern', -1, -2, 0); put('campfire', -9, -4, 0); put('tent', -13, -7, 0.8); put('stall', 7, 12, -1.2); put('fence', -6, 13, 0); put('fence', -6, 16.2, 0); put('banner', 4, -3, 0); put('statue', 0, -10, 0); put('altar', 15, 4, 0); put('spawn', -4, 0, 0); put('chest', 13, 10, 0.4, 1, '#3a2a1a');
  let seed = 9; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 60; i++) { const a = r() * 6.28, d = 14 + r() * 24; const x = Math.cos(a) * d, z = Math.sin(a) * d; put(r() < 0.6 ? 'pine' : 'tree', x, z, r() * 6.28, 0.8 + r() * 0.6); }
  for (let i = 0; i < 30; i++) { const x = (r() - 0.5) * 60, z = (r() - 0.5) * 60; put(r() < 0.5 ? 'rock' : 'bush', x, z, r() * 6.28, 0.7 + r() * 0.8); }
  for (let i = 0; i < 25; i++) { const x = (r() - 0.5) * 50, z = (r() - 0.5) * 50; put(r() < 0.5 ? 'grass' : 'flowers', x, z, r() * 6.28); }
  put('bridge', -16, 2, 1.2); put('boulder', 18, -12, 0.3);
  e.camera.position.set(46, 30, 52); e.S.selectedId = null; e.refresh();
});
await page.evaluate(() => { const e = MythicMapForge.editor(); e.S.tool = 'select'; });
await page.keyboard.press('1');
// select the house so the gizmo + inspector show
await page.evaluate(() => { const e = MythicMapForge.editor(); const h = e.S.map.objects.find(o => o.t === 'house'); document.querySelector('.mf-tabs button[data-tab="object"]').click(); });
const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox();
const proj = await page.evaluate(([bx, by, bw, bh]) => { const e = MythicMapForge.editor(); const T = window.THREE; e.camera.lookAt(0, 0, 0); e.camera.updateMatrixWorld(); const o = e.S.map.objects.find(o => o.t === 'house'); const v = new T.Vector3(o.p[0], o.p[1] + 1.5, o.p[2]).project(e.camera); return [(v.x + 1) / 2 * bw + bx, (1 - v.y) / 2 * bh + by]; }, [bb.x, bb.y, bb.width, bb.height]);
await page.waitForTimeout(600);
await page.mouse.click(proj[0], proj[1]);
await page.waitForTimeout(800);
await page.screenshot({ path: S + '/shots/preview-1-editor.png' });
// dusk + water tab
await page.click('.mf-tabs button[data-tab="sky"]'); await page.selectOption('#mf-e-preset', 'dusk');
await page.evaluate(() => { const e = MythicMapForge.editor(); e.S.selectedId = null; e.gizmo.detach(); e.camera.position.set(-30, 9, 44); e.camera.lookAt(4, 2, 0); });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.screenshot({ path: S + '/shots/preview-2-dusk.png' });
// sculpt view with brush ring, terrain tab
await page.click('.mf-tabs button[data-tab="terrain"]'); await page.keyboard.press('2');
await page.evaluate(() => { const e = MythicMapForge.editor(); e.camera.position.set(20, 14, 30); e.camera.lookAt(-4, 0, -2); });
await page.mouse.move(bb.x + bb.width * 0.45, bb.y + bb.height * 0.55); await page.waitForTimeout(700);
await page.screenshot({ path: S + '/shots/preview-3-sculpt.png' });
// play mode
await page.keyboard.press('p'); await page.waitForTimeout(400); await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w'); console.log(JSON.stringify(await page.evaluate(() => { const e = MythicMapForge.editor(); return { pitch: e.play.pitch, yaw: e.play.yaw, pos: e.play.pos.toArray() }; })));
await page.screenshot({ path: S + '/shots/preview-4-play.png' });
await browser.close();
console.log('done');
