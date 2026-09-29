/* Athena Engine round 18: every mini-game's models as showroom scenes.
   Adapters from MythicBridge.slots (fishing, auction, extraction, city),
   showroom build (slots on pedestals, filled ones as .glb objects, "· new"
   slots), open in Athena, replace / restore / append / scale, Save → bridge
   set/clear in the right order, ★ Live → publish, city write reaches the
   device registry key, skipped built-in props, the chooser. harness2.html. */
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
await page.waitForFunction(() => !!window.MythicMapForge && !!window.MythicMapForge.showrooms, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());

await step('adapters: four showroom games registered; build(): slots on pedestals in folders, filled slots as .glb objects with scale/yaw, "· new" slots, assets deduped', async () => {
  const r = await page.evaluate(() => {
    const A = MythicMapForge; A.showrooms.register();
    const ids = A.games.list().map(g => g.id).filter(id => id.startsWith('models-'));
    const m = A.format.normalize(A.games.get('models-fishing').build());
    const slots = m.objects.filter(o => o.k); const glb = slots.filter(o => o.t === 'glb'), news = slots.filter(o => /new$/.test(o.k));
    const boat = m.objects.find(o => o.k === 'ship.0');
    return { ids, n: slots.length, glb: glb.map(o => o.k), news: news.length, boatScale: boat && boat.s[0], boatAsset: boat && (m.assets.find(a => a.id === boat.a) || {}).url, folders: m.folders.map(f => f.name), game: m.game, spaced: new Set(slots.map(o => o.p[0] + ',' + o.p[2])).size === slots.length };
  });
  if (r.ids.length !== 4 || r.n !== 5 || r.glb.join() !== 'ship.0' || r.news !== 4 || r.boatScale !== 1.5 || r.boatAsset !== '/models/Duck.glb' || r.folders.join() !== 'Boats,Species,Fallback fish per tier' || r.game !== 'models-fishing' || !r.spaced) throw new Error(JSON.stringify(r));
  return r;
});
await step('open the fishing showroom; replace the "new boat" slot with a cloud model + scale, restore the old skiff, replace pike "new" with a built-in prop (skipped); Save → set/clear through the bridge', async () => {
  await page.evaluate(() => MythicMapForge.open({ game: 'models-fishing' }));
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    await e.content.reloadCloud(); await new Promise(r => setTimeout(r, 200));
    // pick the cloud Flamingo, replace ship/+
    e.library.pick(e.library.index.find(x => x.kind === 'cloud').key); await new Promise(r => setTimeout(r, 200));
    const plus = m.objects.find(o => o.k === 'ship.new'); e.S.selectedId = plus.id; e.S.multi.clear(); e.S.multi.add(plus.id); e.S.tool = 'select'; e.refresh();
    document.getElementById('mf-o-slot-replace').click(); await new Promise(r => setTimeout(r, 100));
    plus.s = [0.02, 0.02, 0.02]; plus.r = [0, 1.5, 0]; e.world.refreshObject(plus);
    // restore ship/0 (delete the old skiff entry)
    const skiff = m.objects.find(o => o.k === 'ship.0'); e.S.selectedId = skiff.id; e.S.multi.clear(); e.S.multi.add(skiff.id); e.refresh();
    document.getElementById('mf-o-slot-restore').click(); await new Promise(r => setTimeout(r, 100));
    // a built-in prop on species/pike/+ → skipped
    e.library.pick('prop:crate'); const pk = m.objects.find(o => o.k === 'species.pike.new'); e.S.selectedId = pk.id; e.S.multi.clear(); e.S.multi.add(pk.id); e.refresh();
    document.getElementById('mf-o-slot-replace').click(); await new Promise(r => setTimeout(r, 100));
    window.__slotWrites.length = 0;
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 400));
    const lw = MythicMapForge.showrooms.lastWrite;
    return { writes: window.__slotWrites, skipped: lw.diff.skipped.map(s => s.k), ships: window.__forge.woodsFishing.models.ship.map(x => [x.url, x.scale, x.rotY]), published: window.__published, toast: window.__toasts.slice(-2) };
  });
  const w = r.writes;
  if (w.length !== 2 || w[0][0] !== 'clear' || w[0][2] !== 'ship/0' || w[1][0] !== 'set' || w[1][2] !== 'ship/+' || w[1][3] !== '/models/Flamingo.glb' || w[1][4] !== 0.02 || w[1][5] !== 1.5 || r.skipped.join() !== 'species/pike/+' || r.ships.length !== 1 || r.ships[0][0] !== '/models/Flamingo.glb' || r.published !== 0) throw new Error(JSON.stringify(r));
  return r;
});
await step('★ Set live publishes the catalogue; reopening builds from the updated slots (the new boat is now ship/0)', async () => {
  await page.click('.mf-tabs button[data-tab="maps"]'); await page.waitForSelector('.mf-map'); await page.click('.mf-map [data-act="live"]'); await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const pub = window.__published; await MythicMapForge.close();
    const m = MythicMapForge.format.normalize(MythicMapForge.games.get('models-fishing').build());
    const boat = m.objects.find(o => o.k === 'ship.0');
    return { pub, boat: boat && boat.t, url: boat && (m.assets.find(a => a.id === boat.a) || {}).url, scale: boat && boat.s[0], lw: MythicMapForge.showrooms.lastWrite.published };
  });
  if (r.pub !== 1 || r.boat !== 'glb' || r.url !== '/models/Flamingo.glb' || Math.abs(r.scale - 0.02) > 1e-9 || !r.lw) throw new Error(JSON.stringify(r));
  return r;
});
await step('city showroom: setting a building writes Forge.cityModels AND the device registry key the city reads; extraction machine slot; diff is empty on an untouched map', async () => {
  const r = await page.evaluate(async () => {
    const A = MythicMapForge; const g = A.showrooms.list().find(x => x.id === 'city');
    const m = A.format.normalize(A.games.get('models-city').build());
    const farm = m.objects.find(o => o.k === 'farm'); const a = { id: 'a_x', label: 'Farm hut', url: '/models/Duck.glb' }; m.assets.push(a); farm.t = 'glb'; farm.a = a.id; farm.s = [2, 2, 2];
    const diff = A.showrooms.diff(m, g);
    window.MythicBridge.slots.set('city', 'farm', diff.sets[0]);
    const ls = JSON.parse(localStorage.getItem('mythic_city_models_v1'));
    const ex = A.format.normalize(A.games.get('models-extraction').build()); const nodeObj = ex.objects.find(o => o.k === 'node');
    const untouched = A.showrooms.diff(A.format.normalize(A.games.get('models-extraction').build()), A.showrooms.list().find(x => x.id === 'extraction'));
    return { sets: diff.sets, cityForge: window.__forge.cityModels.farm, ls: ls && ls.farm, nodeT: nodeObj && nodeObj.t, machines: ex.objects.filter(o => /^machine\./.test(o.k)).length, untouched: untouched.sets.length + untouched.clears.length + untouched.skipped.length };
  });
  if (r.sets.length !== 1 || r.sets[0].k !== 'farm' || r.sets[0].scale !== 2 || !r.cityForge || r.cityForge.url !== '/models/Duck.glb' || !r.ls || r.ls.scale !== 2 || r.nodeT !== 'glb' || r.machines !== 2 || r.untouched !== 0) throw new Error(JSON.stringify(r));
  return r;
});
await step('chooser lists the four games with counts; non-admin save is refused', async () => {
  const r = await page.evaluate(async () => {
    const el = MythicMapForge.showrooms.pick(); const rows = Array.from(el.querySelectorAll('button[data-g]')).map(b => b.dataset.g + ':' + b.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)); el.remove();
    const a = window.MythicBridge.isAdmin; window.MythicBridge.isAdmin = () => false;
    const g = MythicMapForge.showrooms.list().find(x => x.id === 'auction'); const m = MythicMapForge.format.normalize(MythicMapForge.games.get('models-auction').build());
    const rare = m.objects.find(o => o.k === 'rare.0'); rare.s = [5, 5, 5];
    const diff = MythicMapForge.showrooms.diff(m, g);
    const before = window.__slotWrites.length;
    window.dispatchEvent(new CustomEvent('athena:saved', { detail: { game: 'models-auction', id: m.id, source: 'local', map: m } }));
    await new Promise(r => setTimeout(r, 100));
    window.MythicBridge.isAdmin = a;
    return { rows, diff: diff.sets.length, writes: window.__slotWrites.length - before, toast: window.__toasts.slice(-1)[0] };
  });
  if (r.rows.length !== 4 || !r.rows.some(x => /fishing/.test(x) && /slots/.test(x)) || r.diff !== 1 || r.writes !== 0 || !/admin/.test(r.toast)) throw new Error(JSON.stringify(r));
  return r;
});
await page.evaluate(() => MythicMapForge.open({ game: 'models-city' }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(800);
await page.screenshot({ path: S + '/shots/r18-01-showroom.png' });
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
