/* Athena Engine round 17: cloud files, rename, the content browser dock.
   Cloud models/sounds listed through MythicBridge.files, upload → cloud +
   map asset, rename: map model label, map sound label, prefab, cloud file
   (storage move + URL rewrite in the map), F2, dock: toggle, tree, crumbs,
   tiles, search, double-click picks, context menu, admin gate. harness2.html. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
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
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Content', n: 32, cell: 2 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);

await step('cloud lists come through the bridge: cloud model + sound in the index; Models view shows the Cloud list; picking a cloud model adds the asset', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); await e.content.reloadCloud(); await new Promise(r => setTimeout(r, 200));
    const idx = e.library.index; const cl = idx.filter(x => x.kind === 'cloud'), cs = idx.filter(x => x.kind === 'csound');
    document.querySelector('#mf-cats button[data-cat="Models"]').click(); await new Promise(r => setTimeout(r, 200));
    const rows = document.querySelectorAll('#mf-cloud [data-cloud]').length;
    document.querySelector('#mf-cloud [data-cloud]').click(); await new Promise(r => setTimeout(r, 300));
    return { cl: cl.map(x => [x.label, x.url]), cs: cs.map(x => x.label), rows, assets: e.S.map.assets.map(a => a.url), propId: e.S.propId, lastSrc: e.S.lastSrc && e.S.lastSrc.t };
  });
  if (r.cl.length !== 1 || r.cl[0][0] !== 'Flamingo' || r.cs.join() !== 'beep' || r.rows !== 1 || r.assets.join() !== '/models/Flamingo.glb' || r.propId !== 'glb' || r.lastSrc !== 'glb') throw new Error(JSON.stringify(r));
  return r;
});
await step('upload (admin): a .glb goes to the cloud (bucket record) and becomes a map asset; a sound upload goes to audio and the map sounds; non-admin refused', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor();
    const f1 = new File([new Uint8Array(64)], 'Tower Ruin.glb', { type: 'model/gltf-binary' });
    const up = await e.content.upload(f1); await new Promise(r => setTimeout(r, 200));
    const f2 = new File([new Uint8Array(32)], 'wind.wav', { type: 'audio/wav' });
    const up2 = await e.content.upload(f2);
    const a = window.MythicBridge.isAdmin; window.MythicBridge.isAdmin = () => false;
    const denied = await e.content.upload(new File([new Uint8Array(8)], 'x.glb')); window.MythicBridge.isAdmin = a;
    return { path: up && up.path, name: up && up.name, bucket: window.__files.models.length, assetLabels: e.S.map.assets.map(x => x.label), snd: e.S.map.sounds.map(s => s.label), audioBucket: window.__files.audio.length, denied: denied === null, toast: window.__toasts.slice(-1)[0] };
  });
  if (!/^athena\/models\/.*Tower_Ruin\.glb$/.test(r.path) || r.bucket !== 2 || !r.assetLabels.includes('Tower_Ruin') || r.snd.join() !== 'wind' || r.audioBucket !== 2 || !r.denied) throw new Error(JSON.stringify(r));
  return r;
});
await step('rename: map model label, map sound label, prefab, cloud file (storage move + URL rewritten in the map + label follows), built-in prop refused', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const flam = m.assets.find(a => a.url === '/models/Flamingo.glb');
    await e.content.rename('model:' + flam.id, 'Pink bird');
    const snd = m.sounds[0]; await e.content.rename('sound:' + snd.id, 'Breeze');
    [{ id: 'o1', t: 'crate', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }, { id: 'o2', t: 'barrel', p: [2, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }].forEach(o => { m.objects.push(o); e.world.addObject(o); });
    e.S.selectedId = 'o1'; e.S.multi.clear(); e.S.multi.add('o1'); e.S.multi.add('o2'); e.refresh(); document.getElementById('mf-pf-create').click(); await new Promise(r => setTimeout(r, 150));
    const pf = m.prefabs[0]; await e.content.rename('prefab:' + pf.id, 'Supply dump');
    // cloud rename: the Tower_Ruin file → URL changes and the map asset follows
    const cloudKey = e.library.index.find(x => x.kind === 'cloud' && /Tower_Ruin/.test(x.ref.name)).key;
    const before = m.assets.find(a => /Tower_Ruin/.test(a.url)).url;
    await e.content.rename(cloudKey, 'Watchtower'); await new Promise(r => setTimeout(r, 250));
    const after = m.assets.find(a => /Watchtower/.test(a.url));
    const propOk = await e.content.rename('prop:tree', 'Nope');
    return { flam: flam.label, snd: snd.label, pf: pf.name, before, after: after && after.url, afterLabel: after && after.label, renames: window.__renames.length, propOk, dirty: e.S.dirty, sel: e.library.selected };
  });
  if (r.flam !== 'Pink bird' || r.snd !== 'Breeze' || r.pf !== 'Supply dump' || !/Tower_Ruin/.test(r.before) || !/Watchtower\.glb$/.test(r.after) || r.afterLabel !== 'Watchtower' || r.renames !== 1 || r.propOk !== false || !r.dirty || !/^cloud:/.test(r.sel)) throw new Error(JSON.stringify(r));
  return r;
});
await step('F2 renames the selected object first (outliner), else the selected library item', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const o = { id: 'o3', t: 'barrel', p: [4, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }; m.objects.push(o); e.world.addObject(o);
    e.S.selectedId = 'o3'; e.S.multi.clear(); e.S.multi.add('o3'); e.refresh();
    window.prompt = () => 'Rum barrel';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' })); await new Promise(r => setTimeout(r, 100));
    const objName = o.n;
    e.S.selectedId = null; e.S.multi.clear(); e.refresh();
    const flam = m.assets.find(a => a.label === 'Pink bird'); e.library.pick('model:' + flam.id);
    window.prompt = () => 'Blue bird';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' })); await new Promise(r => setTimeout(r, 100));
    return { objName, label: flam.label };
  });
  if (r.objName !== 'Rum barrel' || r.label !== 'Blue bird') throw new Error(JSON.stringify(r));
  return r;
});
await step('content browser: Ctrl+Space toggles; tree folders filter; breadcrumb; tiles with type bars; search; double-click picks; status', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true })); await new Promise(r => setTimeout(r, 100));
    const open = !document.getElementById('mf-cb').hidden;
    const rootTiles = document.querySelectorAll('#mf-cb .mf-cb-tile').length, folders = document.querySelectorAll('#mf-cb .mf-cb-tile.folder').length;
    document.querySelector('#mf-cb .mf-cb-node[data-node="Content/Models"]').click(); await new Promise(r => setTimeout(r, 50));
    const modelsSub = document.querySelectorAll('#mf-cb .mf-cb-node').length;
    document.querySelector('#mf-cb .mf-cb-node[data-node="Content/Models/Cloud"]').click(); await new Promise(r => setTimeout(r, 50));
    const cloudTiles = Array.from(document.querySelectorAll('#mf-cb .mf-cb-tile[data-key]')).map(t => t.dataset.key);
    const crumbs = Array.from(document.querySelectorAll('#mf-cb .mf-cb-crumbs .crumb')).map(c => c.textContent);
    const bar = document.querySelector('#mf-cb .mf-cb-tile[data-key] .bar').style.background;
    document.querySelector('#mf-cb .mf-cb-crumbs .crumb').click(); await new Promise(r => setTimeout(r, 50));
    const q = document.getElementById('mf-cb-q'); q.value = 'lantern'; q.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 50));
    const hits = Array.from(document.querySelectorAll('#mf-cb .mf-cb-tile[data-key]')).map(t => t.dataset.key);
    document.querySelector('#mf-cb .mf-cb-tile[data-key="prop:lantern"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(r => setTimeout(r, 50));
    const status = document.querySelector('#mf-cb .mf-cb-status').textContent;
    document.getElementById('mf-cb-btn').click();
    return { open, rootTiles, folders, modelsSub, cloudTiles, crumbs, bar, hits, picked: e.S.propId, tool: e.S.tool, status, closed: document.getElementById('mf-cb').hidden, btnOn: document.getElementById('mf-cb-btn').classList.contains('on') };
  });
  if (!r.open || r.folders !== 5 || r.rootTiles < 80 || r.modelsSub < 10 || r.cloudTiles.length !== 2 || !r.cloudTiles.every(k => k.startsWith('cloud:')) || r.crumbs.join('/') !== 'Content/Models/Cloud' || !/rgb\(90, 165, 255\)|#5aa5ff/.test(r.bar) || !r.hits.includes('prop:lantern') || r.hits.some(k => !/lantern/i.test(k)) || r.picked !== 'lantern' || r.tool !== 'place' || !/2 items/.test(r.status) || !r.closed || r.btnOn) throw new Error(JSON.stringify(r));
  return r;
});
await step('context menu: rename + delete-from-cloud actions; deleting a cloud file removes it from the bucket and the list', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); e.content.toggle(true);
    document.querySelector('#mf-cb .mf-cb-node[data-node="Content/Sounds"]').click(); await new Promise(r => setTimeout(r, 50));
    const wind = e.library.index.find(x => x.kind === 'csound' && /wind/.test(x.ref.name));
    e.content.menu(wind.key);
    const items = Array.from(document.querySelectorAll('.mf-cb-menu button')).map(b => b.dataset.a);
    window.MythicBridge.confirm = async () => true;
    document.querySelector('.mf-cb-menu button[data-a="remove"]').click(); await new Promise(r => setTimeout(r, 300));
    const gone = !window.__files.audio.find(x => /wind/.test(x.name)), listed = !e.library.index.find(x => x.kind === 'csound' && /wind/.test(x.ref.name));
    e.content.toggle(false);
    return { items, gone, listed, menuClosed: !document.querySelector('.mf-cb-menu') };
  });
  if (!r.items.includes('rename') || !r.items.includes('play') || !r.items.includes('remove') || !r.gone || !r.listed || !r.menuClosed) throw new Error(JSON.stringify(r));
  return r;
});
await page.evaluate(async () => { const e = MythicMapForge.editor(); e.content.toggle(true); document.querySelector('#mf-cb .mf-cb-node[data-node="Content/Props/Nature"]').click(); });
await page.waitForTimeout(400);
await page.screenshot({ path: S + '/shots/r17-01-content.png' });
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
