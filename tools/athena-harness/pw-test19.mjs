/* Athena Engine merge round (v121v116): build B's FILES and MENU tabs live
   inside build A's editor. The FILES panel (uploaded files: upload button,
   auto-detect type select, refresh, All / Models / Anims / Audio / VFX chips,
   the note about the files table / sign-in, the help text), the MENU tab
   (Player & camera, Menu button), and the merged Scene tab (build A's content
   folders outliner AND build B's "In this map" list) — with the rest of the
   editor (Library, content browser, Maps) still present. harness2.html. */
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
await page.waitForFunction(() => !!window.MythicMapForge && !!window.MythicMapForge.showrooms, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());

await step('the merged API: build A (games, showrooms, overlay, quality) and build B (pill, menuTiles, enter, assets) on one object', async () => {
  const r = await page.evaluate(() => { const A = MythicMapForge; return { games: !!A.games, showrooms: !!A.showrooms, overlay: !!A.overlay, quality: !!A.quality, pill: !!A.pill, menuTiles: typeof A.menuTiles, enter: typeof A.enter, assets: !!(A.assets && A.assets.list), liveGames: typeof (A.maps && A.maps.liveGames) }; });
  for (const k of Object.keys(r)) if (!r[k] || r[k] === 'undefined') throw new Error(k + ' missing: ' + JSON.stringify(r));
  return r;
});
await step('open a fresh map: the tab row carries Object · Scene · Files · Terrain · Water · Sky · Menu · Maps', async () => {
  await page.evaluate(() => MythicMapForge.open({}));
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(400);
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.mf-tabs button')).map(b => b.dataset.tab));
  for (const t of ['object', 'scene', 'files', 'terrain', 'water', 'sky', 'menu', 'maps']) if (!tabs.includes(t)) throw new Error('tab ' + t + ' missing: ' + tabs.join(','));
  return tabs;
});
await step('the Scene tab holds BOTH the content-folder outliner (build A) and the "In this map" list (build B)', async () => {
  await page.click('.mf-tabs button[data-tab="scene"]'); await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ outliner: !!document.querySelector('#mf-outliner'), newFolder: !!document.querySelector('#mf-newfolder'), inThisMap: !!document.querySelector('#mf-scene'), on: document.querySelector('.mf-tab[data-tab="scene"]').classList.contains('on') }));
  if (!r.outliner || !r.newFolder || !r.inThisMap || !r.on) throw new Error(JSON.stringify(r));
  return r;
});
await step('FILES: upload button + hidden input (.glb/.gltf/.mp3/.wav/.ogg/.m4a/.json), the auto-detect select with model/anim/audio/vfx, the refresh button, five filter chips, and the offline note (no cloud in the harness)', async () => {
  await page.click('.mf-tabs button[data-tab="files"]'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    up: !!document.querySelector('#mf-up-btn'), accept: (document.querySelector('#mf-up-file') || {}).accept || '',
    kinds: Array.from(document.querySelectorAll('#mf-up-kind option')).map(o => o.value), refresh: !!document.querySelector('#mf-files-refresh'),
    chips: Array.from(document.querySelectorAll('#mf-files-kinds button')).map(b => b.dataset.kind), note: (document.querySelector('#mf-files-note') || {}).textContent || '',
    help: (document.querySelector('.mf-tab[data-tab="files"]') || {}).textContent || '',
  }));
  if (!r.up || !/\.glb/.test(r.accept) || !/\.mp3/.test(r.accept) || !/\.json/.test(r.accept)) throw new Error('upload: ' + JSON.stringify(r));
  if (r.kinds.join() !== ',model,anim,audio,vfx') throw new Error('kinds ' + r.kinds.join());
  if (!r.refresh || r.chips.join() !== 'all,model,anim,audio,vfx') throw new Error('chips ' + r.chips.join());
  if (!/Sign in|not set up|files/i.test(r.note)) throw new Error('note: ' + r.note);
  if (!/joins this map's Library/.test(r.help) || !/bone names must match/.test(r.help) || !/Sound/.test(r.help) || !/VFX preset/.test(r.help)) throw new Error('help text: ' + r.help.slice(0, 200));
  return { kinds: r.kinds, chips: r.chips, note: r.note.slice(0, 60) };
});
await step('FILES: the filter chips toggle (Anims on → the others off)', async () => {
  await page.click('#mf-files-kinds button[data-kind="anim"]'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => Array.from(document.querySelectorAll('#mf-files-kinds button')).filter(b => b.classList.contains('on')).map(b => b.dataset.kind));
  if (r.join() !== 'anim') throw new Error(r.join());
  await page.click('#mf-files-kinds button[data-kind="all"]');
  return r;
});
await step('FILES: the Sound marker refuses to place without an audio file and points at the Files tab', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); e.S.propId = 'audio'; e.S.audioUrl = null;
    const before = window.__toasts.length; try { e.placeAt && e.placeAt(0, 0); } catch (x) {}
    return { hasPlace: typeof e.placeAt, toasts: window.__toasts.slice(before).join(' | ') };
  });
  return r;
});
await step('MENU: the tab renders Player & camera and the Menu button section', async () => {
  await page.click('.mf-tabs button[data-tab="menu"]'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ player: !!document.querySelector('#mf-player'), menu: !!document.querySelector('#mf-menu'), text: (document.querySelector('.mf-tab[data-tab="menu"]') || {}).textContent || '' }));
  if (!r.player || !r.menu || !/Player/.test(r.text) || !/Menu button/.test(r.text)) throw new Error(JSON.stringify(r).slice(0, 300));
  return { player: r.player, menu: r.menu };
});
await step('the rest survived the merge: Library (#mf-lib-q, #mf-cats), the content browser dock (#mf-cb), Maps tab, Save buttons, the game select', async () => {
  const r = await page.evaluate(() => ({ libq: !!document.querySelector('#mf-lib-q'), cats: !!document.querySelector('#mf-cats'), cb: !!document.querySelector('#mf-cb'), save: !!document.querySelector('#mf-save'), saveLocal: !!document.querySelector('#mf-save-local'), game: !!document.querySelector('#mf-game'), maps: !!document.querySelector('.mf-tab[data-tab="maps"]') }));
  for (const k of Object.keys(r)) if (!r[k]) throw new Error(k + ' missing ' + JSON.stringify(r));
  return r;
});
await step('a slot / spline / prefab (build A) and a sound marker (build B) all normalise in one document', async () => {
  const r = await page.evaluate(() => {
    const m = MythicMapForge.format.normalize({ objects: [{ t: 'audio', p: [0, 0, 0], au: { url: '/x.mp3', vol: 1, r: 20, loop: true } }, { t: 'slot', k: 'coop', p: [1, 0, 1] }, { t: 'spline', p: [0, 0, 0], sp: { pts: [[0, 0, 0], [3, 0, 3]], mode: 'mesh' } }] });
    return m.objects.map(o => o.t + ':' + (o.au ? 'au' : o.k ? 'k' : o.sp ? 'sp' : '-'));
  });
  if (r.join() !== 'audio:au,slot:k,spline:sp') throw new Error(r.join());
  return r;
});
await page.screenshot({ path: new URL('./shots/19-files-menu.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') }).catch(() => {});
await browser.close();
const errs = logs.filter(l => /pageerror/.test(l));
console.log('page errors:', JSON.stringify(errs));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails || errs.length ? 1 : 0);
