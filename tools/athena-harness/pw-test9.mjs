/* Athena Engine round 9: audio. Sound list, Sound emitter component
   (positional, auto), Play sound (self / player / 2d) and Stop sound nodes,
   the Sounds library, stop silences all, engine mount. harness2.html.
   Chromium runs with autoplay allowed so the AudioContext is not suspended. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Audio', game: 'sndgame', n: 32, cell: 1 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);

await step('Library → Sounds: add by URL, list, preview button', async () => {
  await page.click('#mf-cats button[data-cat="Sounds"]'); await page.waitForSelector('#mf-snd-url');
  await page.fill('#mf-snd-url', '/models/beep.wav'); await page.fill('#mf-snd-label', 'Beep'); await page.click('#mf-snd-add');
  const r = await page.evaluate(() => { const m = MythicMapForge.editor().S.map; return { sounds: m.sounds.map(s => s.label), rows: document.querySelectorAll('#mf-sounds [data-snd]').length, preview: !!document.querySelector('#mf-sounds [data-sact="play"]') }; });
  if (r.sounds.join() !== 'Beep' || r.rows !== 1 || !r.preview) throw new Error(JSON.stringify(r));
  return r;
});
await step('objects: emitter (auto loop) + a caster (Begin → Play sound 2d, Play sound at player; Tick → Stop sound self)', async () => {
  return page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world; const sid = m.sounds[0].id;
    const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
    add({ id: 'o_em', t: 'campfire', n: 'fire', p: [4, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [{ type: 'sound', s: sid, vol: 0.8, dist: 8, loop: 'true', auto: 'true' }], graph: { nodes: [], links: [] } } });
    add({ id: 'o_cast', t: 'altar', n: 'caster', p: [-4, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, bp: { vars: {}, comps: [], graph: { nodes: [
      { id: 'b', type: 'ev_begin', x: 0, y: 0, props: {} }, { id: 'p2d', type: 'playsound', x: 200, y: 0, props: { sound: 'Beep', at: '2d', vol: 1, loop: 'false' } }, { id: 'ppl', type: 'playsound', x: 400, y: 0, props: { sound: 'Beep', at: 'player', vol: 1, loop: 'true' } }, { id: 'pself', type: 'playsound', x: 600, y: 0, props: { sound: 'Beep', at: 'fire', vol: 1, loop: 'true' } },
      { id: 'st', type: 'ev_tick', x: 0, y: 200, props: { ms: 400 } }, { id: 'stop', type: 'stopsound', x: 200, y: 200, props: { at: 'fire' } } ],
      links: [{ from: { n: 'b', pin: 'then' }, to: { n: 'p2d' } }, { from: { n: 'p2d', pin: 'then' }, to: { n: 'ppl' } }, { from: { n: 'ppl', pin: 'then' }, to: { n: 'pself' } }, { from: { n: 'st', pin: 'then' }, to: { n: 'stop' } }] } } });
    e.refresh(); return { objs: m.objects.length };
  });
});
await step('Play: listener on the camera, emitters created (positional on fire, 2d, player), playing', async () => {
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.press('p'); await page.waitForTimeout(250);
  await page.waitForFunction(() => { const w = MythicMapForge.editor().world; return w.audio && w.audio.count >= 4; }, null, { timeout: 8000 });
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const w = e.world; const au = w.audio; const fire = w.objects.get('o_em'); const pos = []; fire.traverse(o => { if (o.panner && o.listener) pos.push({ playing: o.isPlaying, loop: o.getLoop(), ref: o.getRefDistance ? o.getRefDistance() : null }); }); return { count: au.count, onCamera: au.camera === e.camera, listenerAttached: e.camera.children.includes(au.listener), firePositional: pos, ctx: au.listener.context.state }; });
  if (r.count < 4 || !r.onCamera || !r.listenerAttached || r.firePositional.length !== 2 || !r.firePositional.some(p => p.ref === 8)) throw new Error(JSON.stringify(r));
  return r;
});
await step('Stop sound (Tick) silences the fire; the 2d one-shot ends on its own; Stop play silences everything', async () => {
  await page.waitForTimeout(1200);
  const r1 = await page.evaluate(() => { const w = MythicMapForge.editor().world; const fire = w.objects.get('o_em'); let n = 0; fire.traverse(o => { if (o.gain && o.listener) n++; }); return { fireSounds: n, count: w.audio.count }; });
  if (r1.fireSounds !== 0 || r1.count !== 1) throw new Error('stopsound: ' + JSON.stringify(r1));   // only the looping "at player" one remains
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const r2 = await page.evaluate(() => { const w = MythicMapForge.editor().world; return { audio: !!w.audio, listenerOnCam: MythicMapForge.editor().camera.children.some(c => c.type === 'AudioListener') }; });
  if (r2.audio) throw new Error('after stop: ' + JSON.stringify(r2));
  return { r1, r2 };
});
await step('engine.mount: audio attaches to the engine camera and plays', async () => {
  const r = await page.evaluate(async () => {
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 300)); await MythicMapForge.close();
    const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'sndgame', mode: 'fps', pointerLock: false });
    for (let i = 0; i < 40 && !(g.world.audio && g.world.audio.count >= 3); i++) await new Promise(r => setTimeout(r, 100));
    const out = { count: g.world.audio ? g.world.audio.count : 0, onCam: g.world.audio && g.world.audio.camera === g.camera };
    g.stop(); host.remove(); return out;
  });
  if (r.count < 3 || !r.onCam) throw new Error(JSON.stringify(r));
  return r;
});
await step('normalize: sounds list survives garbage', async () => page.evaluate(() => { const m = MythicMapForge.format.normalize({ sounds: [{ url: '/a.mp3' }, { nope: 1 }, 'x'] }); return m.sounds.length; }).then(n => { if (n !== 1) throw new Error('n=' + n); return n; }));
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
