/* Diagnose the audio play path and engine.mount objects in the merged build. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') out.push(t + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', e => out.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Audio', game: 'sndgame', n: 32, cell: 1 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);
await page.click('#mf-cats button[data-cat="Sounds"]'); await page.waitForSelector('#mf-snd-url');
await page.fill('#mf-snd-url', '/models/beep.wav'); await page.fill('#mf-snd-label', 'Beep'); await page.click('#mf-snd-add');
await page.evaluate(() => {
  const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world; const sid = m.sounds[0].id;
  const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
  add({ id: 'o_em', t: 'campfire', n: 'fire', p: [4, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'sound', s: sid, vol: 0.8, dist: 8, loop: 'true', auto: 'true' }], graph: { nodes: [], links: [] } } });
  e.refresh();
});
await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
await page.keyboard.press('p'); await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const e = MythicMapForge.editor(); const w = e.world;
  const fire = w.objects.get('o_em'); let sounds = 0; if (fire) fire.traverse(o => { if (o.panner || o.gain) sounds++; });
  return { playing: e.S.playing, worldPlaying: w.playing, audio: !!w.audio, count: w.audio ? w.audio.count : null, actors: w.actors && w.actors.actors ? w.actors.actors.size : null, fireSounds: sounds, bpSize: (w.map.objects.find(o => o.id === 'o_em') || {}).bp ? 1 : 0, toasts: (window.__toasts || []).slice(-4), listenerOnCam: e.camera.children.filter(c => c.type === 'AudioListener').length };
});
console.log('audio:', JSON.stringify(r));
// engine.mount with a saved local map
const g = await page.evaluate(async () => {
  const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
  m.objects.push({ id: 'o_actor', t: 'crate', n: 'spinner', p: [0, 0, 4], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'spin', speed: 1 }], graph: { nodes: [], links: [] } } }); w.addObject(m.objects[m.objects.length - 1]);
  document.querySelector('.mf-top .name input').value = 'BP world'; document.getElementById('mf-game').value = 'bpgame'; document.getElementById('mf-game').dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 300));
  document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 400));
  const gameAfter = MythicMapForge.editor().S.map.game;
  await MythicMapForge.close();
  const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
  const g = await MythicMapForge.engine.mount(host, { game: 'bpgame', mode: 'fps', pointerLock: false });
  await new Promise(r => setTimeout(r, 400));
  return { gameAfter, source: g.source, name: g.map.name, mapGame: g.map.game, objs: g.map.objects.length, built: g.world.objects.size, hasActor: !!g.world.objects.get('o_actor'), keys: Array.from(g.world.objects.keys()).slice(0, 5), errors: window.__errors.slice() };
});
console.log('engine:', JSON.stringify(g));
console.log(out.join('\n') || '(no console errors)');
await browser.close();
