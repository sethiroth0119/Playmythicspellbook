import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');   // this folder; setup.sh creates three/, www/, shots/, artifact/ here
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const logs = []; page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); }); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness.html');
await page.waitForFunction(() => !!window.MythicMapForge);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Anim test', game: 'card-shop' }) }));
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 40000 });
await page.waitForTimeout(500);
const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
await step('project library from manifest', async () => { await page.click('#mf-cats button[data-cat="Models"]'); await page.waitForFunction(() => document.querySelectorAll('#mf-project [data-proj]').length > 0, null, { timeout: 5000 }); return await page.evaluate(() => [...document.querySelectorAll('#mf-project .lb')].map(x => x.textContent)); });
await step('add project model (Duck) by click', async () => { await page.click('#mf-project [data-proj="0"]'); await page.waitForFunction(() => /ready/.test(document.querySelector('.mf-toast').textContent), null, { timeout: 15000 }); return await page.evaluate(() => MythicMapForge.editor().S.map.assets.map(a => ({ label: a.label, url: a.url }))); });
await step('add .glb FILE (Flamingo, animated) via file input', async () => { await page.setInputFiles('#mf-glb-file', S + '/three/models/Flamingo.glb'); await page.waitForFunction(() => /Flamingo ready/.test(document.querySelector('.mf-toast').textContent), null, { timeout: 15000 }); return await page.evaluate(() => { const e = MythicMapForge.editor(); const a = e.S.map.assets.find(a => a.data); return { label: a.label, embeddedKB: Math.round(a.data.length * 0.75 / 1024), anims: a.anims, toast: document.querySelector('.mf-toast').textContent }; }); });
await step('place flamingo + set animation from inspector', async () => {
  await page.keyboard.press('4'); await page.mouse.move(cx, cy); await page.waitForTimeout(100); await page.mouse.click(cx, cy);
  await page.waitForFunction(() => { const e = MythicMapForge.editor(); const o = e.S.map.objects.find(o => o.t === 'glb'); return o && e.world.clipsOf(o.id).length > 0; }, null, { timeout: 10000 });
  const proj = await page.evaluate(([bx, by, bw, bh]) => { const e = MythicMapForge.editor(); const T = window.THREE; const o = e.S.map.objects[0]; const root = e.world.objects.get(o.id); const c = new T.Vector3(); new T.Box3().setFromObject(root).getCenter(c); const v = c.project(e.camera); return [(v.x + 1) / 2 * bw + bx, (1 - v.y) / 2 * bh + by]; }, [bb.x, bb.y, bb.width, bb.height]);
  await page.keyboard.press('1'); await page.mouse.click(proj[0], proj[1]); await page.waitForTimeout(200);
  const sel = await page.evaluate(() => !!MythicMapForge.editor().S.selectedId); if (!sel) throw new Error('not selected');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#mf-o-anim option')].map(o => o.value)); if (opts.length < 2) throw new Error('no clips in inspector: ' + opts);
  await page.selectOption('#mf-o-anim', opts[1]); await page.selectOption('#mf-o-aloop', 'pingpong');
  await page.waitForTimeout(600);
  return await page.evaluate(() => { const e = MythicMapForge.editor(); const o = e.S.map.objects[0]; const m = e.world.mixers.get(o.id); return { anim: o.anim, mixerTime: m && +m.mixer.time.toFixed(2), running: m && m.action.isRunning() }; });
});
await step('undo removes the animation', async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(100); return await page.evaluate(() => { const e = MythicMapForge.editor(); const o = e.S.map.objects[0]; return { anim: o.anim || null, mixers: e.world.mixers.size }; }); });
await step('redo restores it', async () => { await page.keyboard.press('Control+y'); await page.waitForTimeout(100); return await page.evaluate(() => { const e = MythicMapForge.editor(); const o = e.S.map.objects[0]; return { anim: o.anim && o.anim.clip, mixers: e.world.mixers.size }; }); });
await step('save local with embedded model, set live for card-shop', async () => { await page.click('#mf-save'); await page.waitForTimeout(300); await page.click('.mf-tabs button[data-tab="maps"]'); await page.waitForSelector('.mf-map'); await page.click('.mf-map [data-act="live"]'); await page.waitForTimeout(300); return await page.evaluate(() => ({ heads: [...document.querySelectorAll('.mf-gamehead')].map(x => x.textContent), live: !!document.querySelector('.mf-map .tag.live'), game: document.getElementById('mf-game').value })); });
await step('loadLive("card-shop") returns it with the embed and anim', async () => await page.evaluate(async () => { const r = await MythicMapForge.maps.loadLive('card-shop'); return { ok: r.ok, source: r.source, name: r.map && r.map.name, assets: r.map && r.map.assets.map(a => ({ l: a.label, emb: !!a.data, anims: a.anims })), anim: r.map && r.map.objects[0] && r.map.objects[0].anim }; }));
await page.screenshot({ path: S + '/shots/t2-editor.png' });
await step('close editor, mount engine in a div for game card-shop', async () => {
  await page.click('#mf-close'); await page.waitForTimeout(300);
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'game'; d.style.cssText = 'position:fixed;inset:0;'; document.body.appendChild(d); });
  const r = await page.evaluate(async () => { const g = await MythicMapForge.engine.mount(document.getElementById('game'), { game: 'card-shop', mode: 'orbit' }); window.__g = g; let frames = 0; g.on('frame', () => frames++); await new Promise(r => setTimeout(r, 1500)); return { source: g.source, name: g.map.name, frames, objs: g.map.objects.length, mixers: g.world.mixers.size, mixerTime: g.world.mixers.size ? +[...g.world.mixers.values()][0].mixer.time.toFixed(2) : null, tris: g.renderer.info.render.triangles, canvasInHost: !!document.querySelector('#game canvas') }; });
  await page.screenshot({ path: S + '/shots/t2-engine.png' });
  return r;
});
await step('engine fps mode + stop', async () => await page.evaluate(async () => { window.__g.stop(); const g = await MythicMapForge.engine.mount(document.getElementById('game'), { game: 'card-shop', mode: 'fps', pointerLock: false }); await new Promise(r => setTimeout(r, 300)); const cam = g.camera.position.toArray().map(x => +x.toFixed(1)); const h = +g.world.heightAt(cam[0], cam[2]).toFixed(1); g.stop(); return { cam, groundBelow: h, eyeOk: Math.abs(cam[1] - h - 1.7) < 0.05, canvasGone: !document.querySelector('#game canvas') }; }));
await step('missing game falls back to empty world', async () => await page.evaluate(async () => { let missing = false; const g = await MythicMapForge.engine.mount(document.getElementById('game'), { game: 'nope', mode: 'none', onMissing: () => { missing = true; } }); const r = { missing, name: g.map.name, game: g.map.game }; g.stop(); return r; }));
console.log('--- errors:', await page.evaluate(() => window.__errors), logs.slice(0, 10));
await browser.close();
