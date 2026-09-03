import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');   // this folder; setup.sh creates three/, www/, shots/, artifact/ here
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = []; page.on('console', m => { if (m.type() === 'error' || /THREE\.WebGLProgram/.test(m.text())) logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('pageerror: ' + e.message));
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness.html');
await page.waitForFunction(() => !!window.AthenaEngine);
await page.evaluate(() => { localStorage.clear(); return AthenaEngine.open({ map: AthenaEngine.format.newMap({ name: 'VFX test', game: 'wasteland' }) }); });
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 40000 });
await page.waitForTimeout(400);
const put = (t, x, z, extra) => page.evaluate(([t, x, z, extra]) => { const e = AthenaEngine.editor(); const o = Object.assign({ id: 'o_' + t + '_' + Math.random().toString(36).slice(2, 6), t, p: [x, e.world.heightAt(x, z), z], r: [0, 0, 0], s: [1, 1, 1], g: true }, extra || {}); e.S.map.objects.push(o); e.world.addObject(o); e.refresh(); return o.id; }, [t, x, z, extra]);
await step('VFX category in library', async () => { await page.click('#mf-cats button[data-cat="VFX"]'); return await page.evaluate(() => [...document.querySelectorAll('#mf-props button')].map(b => b.dataset.prop)); });
await step('place every emitter + props with built-in fx', async () => {
  const kinds = ['fx_fire', 'fx_bigfire', 'fx_smoke', 'fx_darksmoke', 'fx_steam', 'fx_fog', 'fx_sparks', 'fx_toxic', 'fx_dust', 'fx_motes'];
  for (let i = 0; i < kinds.length; i++) await put(kinds[i], -18 + i * 4, -6);
  await put('campfire', 0, 6); await put('crater', 12, 10); await put('generator', -10, 8); await put('wreckcar', 8, 4); await put('burnttree', -6, 12); await put('pylon', 16, -2);
  await page.waitForTimeout(600);
  return await page.evaluate(() => { const e = AthenaEngine.editor(); let lights = 0; e.scene.traverse(o => { if (o.isPointLight) lights++; }); return { emitters: e.world.emitters.size, pointLights: lights, systems: [...e.world.emitters.values()].reduce((n, em) => n + em.systems.length, 0), tris: e.renderer.info.render.triangles, pts: e.renderer.info.render.points }; });
});
await step('fire emitter tuning from inspector', async () => {
  const id = await page.evaluate(() => AthenaEngine.editor().S.map.objects.find(o => o.t === 'fx_fire').id);
  await page.evaluate((id) => { const e = AthenaEngine.editor(); e.S.selectedId = id; e.refresh(); }, id);
  const hasUI = await page.evaluate(() => ({ fxi: !!document.getElementById('mf-o-fxi'), tint: !!document.getElementById('mf-o-fxc'), noCol: !document.getElementById('mf-o-col-off') && !!document.getElementById('mf-o-col-on') }));
  await page.evaluate(() => { const el = document.getElementById('mf-o-fxs'); el.value = '3'; el.dispatchEvent(new Event('input')); const c = document.getElementById('mf-o-fxc'); c.value = '#3fa9ff'; c.dispatchEvent(new Event('input')); });
  return await page.evaluate((id) => { const e = AthenaEngine.editor(); const o = e.S.map.objects.find(o => o.id === id); const em = e.world.emitters.get(id); return { ui: undefined, fx: o.fx, c: o.c, flameC1: '#' + em.systems[0].material.uniforms.uC1.value.getHexString() }; }, id).then(r => Object.assign(r, { hasUI }));
});
await step('built-in effect can be switched off', async () => await page.evaluate(() => { const e = AthenaEngine.editor(); const cf = e.S.map.objects.find(o => o.t === 'campfire'); e.S.selectedId = cf.id; e.refresh(); const before = e.world.emitters.has(cf.id); document.getElementById('mf-o-fxon').click(); const after = e.world.emitters.has(cf.id); return { before, after, off: cf.fx && cf.fx.off }; }));
await page.evaluate(() => { const e = AthenaEngine.editor(); e.S.selectedId = null; e.refresh(); e.world.terrain.generate({ type: 'hills', seed: 5, amplitude: 3, scale: 0.35 }); e.S.map.objects.forEach(o => { o.p[1] = e.world.heightAt(o.p[0], o.p[2]); e.world.applyTransform(e.world.objects.get(o.id), o); }); e.camera.position.set(2, 6, 22); e.camera.lookAt(0, 2, 0); });
await page.waitForTimeout(700); await page.screenshot({ path: S + '/shots/t4-fire.png' });
await step('weather: rain → storm → snow → ash → duststorm', async () => {
  const out = {};
  for (const w of ['rain', 'storm', 'snow', 'ash', 'duststorm']) {
    await page.click('.mf-tabs button[data-tab="sky"]'); await page.selectOption('#mf-e-weather', w); await page.waitForTimeout(250);
    out[w] = await page.evaluate(() => { const e = AthenaEngine.editor(); const w = e.world.weather; return w ? { kind: w.kind, pts: w.group.children[0].geometry.attributes.position.count, flash: !!w.group.children[1] } : null; });
  }
  await page.selectOption('#mf-e-preset', 'dusk'); await page.selectOption('#mf-e-weather', 'storm');
  await page.evaluate(() => { const el = document.getElementById('mf-e-windSpeed'); el.value = '6'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600); await page.screenshot({ path: S + '/shots/t4-storm.png' });
  await page.selectOption('#mf-e-preset', 'fallout'); await page.selectOption('#mf-e-weather', 'ash'); await page.waitForTimeout(600); await page.screenshot({ path: S + '/shots/t4-ash.png' });
  return out;
});
await step('save + reload keeps fx, weather, wind', async () => { await page.click('#mf-save'); await page.waitForTimeout(300); const id = await page.evaluate(() => AthenaEngine.editor().S.map.id); await page.click('#mf-close'); await page.waitForTimeout(200); await page.evaluate((id) => AthenaEngine.open({ id, source: 'local' }), id); await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 30000 }); await page.waitForTimeout(500); return await page.evaluate(() => { const e = AthenaEngine.editor(); return { weather: e.S.map.env.weather, wind: e.S.map.env.windSpeed, emitters: e.world.emitters.size, weatherLive: !!e.world.weather, fireFx: e.S.map.objects.find(o => o.t === 'fx_fire').fx }; }); });
await step('engine mount runs fx + weather', async () => { await page.click('#mf-close'); await page.waitForTimeout(200); return await page.evaluate(async () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(d); const g = await AthenaEngine.engine.mount(d, { game: 'wasteland', mode: 'orbit' }); await new Promise(r => setTimeout(r, 800)); const r = { emitters: g.world.emitters.size, weather: g.world.weather && g.world.weather.kind, pts: g.renderer.info.render.points }; g.stop(); d.remove(); return r; }); });
console.log('--- errors:', await page.evaluate(() => window.__errors), logs.slice(0, 6));
await browser.close();
