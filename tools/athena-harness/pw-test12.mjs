/* Athena Engine round 12: the asset browser. Unified index over props,
   models, prefabs and sounds; search + tag filters; thumbnails rendered
   offscreen (props, models, prefabs); favourites and recents persisted;
   details panel with editable tags on prefabs/models; the legacy category
   views still work (with thumbnails); normalize keeps tags. harness2.html. */
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
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Browser', game: 'browser', n: 32, cell: 2 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);

await step('pure index + search: kinds, tag prefixes, label ranking, kind/cat/tag filters', async () => {
  const r = await page.evaluate(async () => {
    const A = await import('/src/mapforge/mapforge.assets.js'); const P = await import('/src/mapforge/mapforge.props.js');
    const idx = A.buildIndex({ props: P.PROP_CATALOG, assets: [{ id: 'a1', label: 'Duck', url: '/models/Duck.glb', anims: ['x'] }], project: [{ id: 'duck', label: 'Duck', url: '/models/Duck.glb' }, { id: 'fl', label: 'Flamingo', url: '/models/Flamingo.glb', tags: ['bird'] }], prefabs: [{ id: 'p1', name: 'Camp', objects: [{}, {}], tags: ['camp'] }], shelf: [{ id: 'p1', name: 'Camp', objects: [{}] }, { id: 'p2', name: 'Farm set', objects: [{}] }], sounds: [{ id: 's1', label: 'Rain', url: '/r.mp3' }], projectSounds: [{ id: 'rain', label: 'Rain', url: '/r.mp3' }, { id: 'c', label: 'Camp music', url: '/c.mp3' }] });
    const kinds = {}; idx.forEach(e => kinds[e.kind] = (kinds[e.kind] || 0) + 1);
    return {
      kinds, noSlot: !idx.find(e => e.id === 'slot' || e.id === 'prefab' && e.kind === 'prop'),
      rock: A.search(idx, 'rock').map(e => e.label), forest: A.search(idx, 'fores').map(e => e.label).sort(),
      camp: A.search(idx, 'camp').map(e => e.key), light: A.search(idx, 'light', { kind: 'prop', cat: 'Props' }).map(e => e.id),
      anim: A.search(idx, '', { tag: 'animated' }).map(e => e.key), bird: A.search(idx, 'bird').map(e => e.key),
      inMap: idx.find(e => e.key === 'project:duck').inMap, shelfDedup: idx.filter(e => e.kind === 'shelf').map(e => e.id),
      tags: A.collectTags(A.search(idx, 'wood'), 3).map(t => t.tag), empty: A.search(idx, 'zzzz').length, all: A.search(idx, '').length === idx.length,
    };
  });
  if (r.kinds.prop < 60 || r.kinds.model !== 1 || r.kinds.project !== 2 || r.kinds.prefab !== 1 || r.kinds.shelf !== 1 || r.kinds.sound !== 1 || r.kinds.psound !== 2 || !r.noSlot) throw new Error('kinds ' + JSON.stringify(r));
  if (r.rock[0] !== 'Rock' || !r.rock.includes('Boulder') || r.forest.join() !== 'Oak tree,Pine') throw new Error('rank ' + JSON.stringify(r));
  if (!r.camp.includes('prefab:p1') || !r.camp.includes('prop:campfire') || !r.camp.includes('psound:c') || !r.camp.includes('prop:tent')) throw new Error('camp ' + JSON.stringify(r.camp));
  if (!r.light.includes('lantern') || !r.light.includes('campfire') || r.light.includes('lamppost')) throw new Error('light ' + JSON.stringify(r.light));
  if (r.anim.join() !== 'model:a1' || r.bird.join() !== 'project:fl' || !r.inMap || r.shelfDedup.join() !== 'p2' || r.tags[0] !== 'wood' || r.empty !== 0 || !r.all) throw new Error(JSON.stringify(r));
  return { kinds: r.kinds, rock: r.rock, camp: r.camp.length };
});
await step('Library: search box → unified cards across kinds, tag chips narrow, count shown, Escape clears', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const q = document.getElementById('mf-lib-q');
    q.value = 'wood'; q.dispatchEvent(new Event('input'));
    const cards = Array.from(document.querySelectorAll('#mf-search .mf-card')).map(c => c.dataset.key);
    const tags = Array.from(document.querySelectorAll('#mf-tags button')).map(b => b.dataset.tag);
    const n = document.getElementById('mf-lib-n').textContent;
    const gridHidden = document.getElementById('mf-props').innerHTML === '';
    const chips = Array.from(document.querySelectorAll('#mf-tags button')); const chip = document.querySelector('#mf-tags button[data-tag="container"]') || chips[chips.length - 1]; const tag = chip.dataset.tag; chip.click();
    const narrowed = Array.from(document.querySelectorAll('#mf-search .mf-card')).map(c => c.dataset.key);
    const chipOn = document.querySelector('#mf-tags button.on') && document.querySelector('#mf-tags button.on').textContent;
    const subset = narrowed.every(k => cards.includes(k)) && narrowed.length < cards.length && narrowed.length > 0;
    const allTagged = narrowed.every(k => (e.library.index.find(x => x.key === k) || { tags: [] }).tags.includes(tag));
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { cards, tags, n, gridHidden, narrowed, chipOn, tag, subset, allTagged, cleared: document.getElementById('mf-search').style.display === 'none' && document.querySelectorAll('#mf-props button').length > 0, q: q.value };
  });
  if (!r.cards.includes('prop:barrel') || !r.cards.includes('prop:fence') || r.cards.includes('prop:rock') || r.tags.length < 3 || !/^\d+ \/ \d+$/.test(r.n) || !r.gridHidden) throw new Error(JSON.stringify(r));
  if (!r.subset || !r.allTagged || !r.chipOn.includes(r.tag) || !r.cleared || r.q !== '') throw new Error(JSON.stringify(r));
  return { hits: r.cards.length, tag: r.tag, narrowed: r.narrowed.length };
});
await step('thumbnails: offscreen renderer works; a prop card gets a PNG, VFX/markers keep their icon; prop grid uses pictures', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const th = e.thumbs();
    const tree = e.library.thumb('prop:tree'), fx = e.library.thumb('prop:fx_fire'), spawn = e.library.thumb('prop:spawn');
    document.querySelector('#mf-cats button[data-cat="Nature"]').click();
    const imgs = document.querySelectorAll('#mf-props button img.th').length, btns = document.querySelectorAll('#mf-props button').length;
    // the image is not blank: decode and count non-transparent pixels
    return new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; res({ ok: th.ok, size: th.size, w: im.width, png: tree.img.startsWith('data:image/png'), opaque: n, fxIcon: fx.icon === '🔥' && !fx.img, spawnIcon: !!spawn.icon, imgs, btns, cached: th.has('prop:tree') }); }; im.src = tree.img; });
  });
  if (!r.ok || r.size !== 96 || r.w !== 96 || !r.png || r.opaque < 400 || !r.fxIcon || !r.spawnIcon || r.imgs !== r.btns || !r.cached) throw new Error(JSON.stringify(r));
  return r;
});
await step('models: project card loads a template for its picture (no asset created); picking adds the asset; map-model thumb follows', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor();
    document.querySelector('#mf-cats button[data-cat="Models"]').click();
    await new Promise(r => setTimeout(r, 300));   // manifest fetch
    const t0 = Date.now(); while (!e.library.thumb('project:duck').img && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100));
    const projThumb = !!e.library.thumb('project:duck').img, assetsBefore = e.S.map.assets.length;
    document.querySelector('#mf-project [data-proj="0"]').click();
    await new Promise(r => setTimeout(r, 400));
    const t1 = Date.now(); while (!(e.library.thumb('model:' + e.S.assetId) || {}).img && Date.now() - t1 < 8000) await new Promise(r => setTimeout(r, 100));
    const rowImg = !!document.querySelector('#mf-assets .mf-asset img.th');
    const det = document.getElementById('mf-details').textContent;
    return { projThumb, assetsBefore, assets: e.S.map.assets.length, propId: e.S.propId, modelThumb: !!e.library.thumb('model:' + e.S.assetId).img, rowImg, det: /Triangles/.test(det) && /Size/.test(det) && /url/i.test(det), sel: e.library.selected, recent: e.library.prefs.recent[0] };
  });
  if (!r.projThumb || r.assetsBefore !== 0 || r.assets !== 1 || r.propId !== 'glb' || !r.modelThumb || !r.rowImg || !r.det || !/^model:/.test(r.sel) || r.recent !== r.sel) throw new Error(JSON.stringify(r));
  return r;
});
await step('details: editable tags on a model persist through normalize and are searchable; favourite toggles into ★', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const a = e.S.map.assets[0]; e.library.pick('model:' + a.id);
    const tin = document.getElementById('mf-dtag-in'); tin.value = 'Bird, WATER fowl, bird'; tin.dispatchEvent(new Event('change'));
    const tags = a.tags.slice();
    const norm = MythicMapForge.format.normalize(JSON.parse(JSON.stringify(MythicMapForge.format.serialize(e.S.map)))).assets[0].tags;
    const found = e.library.search('fowl').map(x => x.key);
    document.querySelector('#mf-details [data-act="fav"]').click();
    document.querySelector('#mf-cats button[data-cat="★"]').click();
    const favCards = Array.from(document.querySelectorAll('#mf-search .mf-card')).map(c => c.dataset.key);
    const stored = JSON.parse(localStorage.getItem('mf_assets_v1'));
    document.querySelector('#mf-search .mf-card .fav').click();   // un-favourite from the card
    const after = document.querySelectorAll('#mf-search .mf-card').length;
    return { tags, norm, found, favCards, stored: stored.fav, after, empty: /No favourites/.test(document.getElementById('mf-search').textContent), dirty: e.S.dirty };
  });
  if (r.tags.join() !== 'bird,water,fowl' || r.norm.join() !== 'bird,water,fowl' || r.found.length !== 1 || !/^model:/.test(r.found[0]) || r.favCards.length !== 1 || r.stored.length !== 1 || r.after !== 0 || !r.empty || !r.dirty) throw new Error(JSON.stringify(r));
  return r;
});
await step('prefabs: card thumbnail composes the parts; Apply invalidates it; prefab tags survive normalize; shelf entry indexed once', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    document.querySelector('#mf-cats button[data-cat="Props"]').click();
    document.querySelector('#mf-props button[data-prop="crate"]').click();
    [{ id: 'o1', t: 'crate', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }, { id: 'o2', t: 'barrel', p: [1.5, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }].forEach(o => { m.objects.push(o); e.world.addObject(o); });
    e.S.selectedId = 'o1'; e.S.multi.clear(); e.S.multi.add('o1'); e.S.multi.add('o2'); e.refresh();
    document.getElementById('mf-pf-create').click();
    await new Promise(r => setTimeout(r, 200));
    const pf = e.S.map.prefabs[0]; const key = 'prefab:' + pf.id;
    e.library.pick(key);
    const th = e.thumbs(); const k1 = Array.from(th.cache.keys()).find(k => k.startsWith(key + ':'));
    const img1 = th.get(k1);
    const tin = document.getElementById('mf-dtag-in'); tin.value = 'storage yard'; tin.dispatchEvent(new Event('change'));
    const normTags = MythicMapForge.format.normalize(JSON.parse(JSON.stringify(MythicMapForge.format.serialize(e.S.map)))).prefabs[0].tags;
    document.querySelector('#mf-details [data-act="shelf"]').click();
    const shelfKeys = e.library.index.filter(x => x.kind === 'shelf').length;   // in-map prefab must not double up as a shelf card
    return { parts: pf.objects.length, hasThumb: !!img1 && img1.startsWith('data:image/png'), normTags, shelfKeys, cardThumb: !!e.library.thumb(key).img, placedCount: /Placed/.test(document.getElementById('mf-details').textContent), yard: e.library.search('yard').map(x => x.key)[0] === key };
  });
  if (r.parts !== 2 || !r.hasThumb || (r.normTags || []).join() !== 'storage,yard' || r.shelfKeys !== 0 || !r.cardThumb || !r.placedCount || !r.yard) throw new Error(JSON.stringify(r));
  return r;
});
await step('recents row + list view + All category; legacy category clicks still pick props; thumbs disposed on close', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor();
    document.querySelector('#mf-cats button[data-cat="Nature"]').click();
    const recent = document.querySelectorAll('#mf-recent .mf-card').length, recentShown = document.getElementById('mf-recent').style.display !== 'none';
    document.getElementById('mf-lib-view').click();
    const listGrid = document.getElementById('mf-props').classList.contains('list');
    document.querySelector('#mf-cats button[data-cat="All"]').click();
    const all = document.querySelectorAll('#mf-search .mf-card').length, listCards = document.getElementById('mf-search').classList.contains('list');
    const sounds = Array.from(document.querySelectorAll('#mf-search .mf-card')).filter(c => c.dataset.key.startsWith('psound:')).length;
    document.getElementById('mf-lib-view').click();
    document.querySelector('#mf-cats button[data-cat="Nature"]').click();
    document.querySelector('#mf-props button[data-prop="pine"]').click();
    const picked = e.S.propId, tool = e.S.tool, view = JSON.parse(localStorage.getItem('mf_assets_v1')).view;
    const th = e.thumbs(); await MythicMapForge.close();
    return { recent, recentShown, listGrid, all, listCards, sounds, picked, tool, view, disposed: !th.ok, root: !document.getElementById('mf-root') };
  });
  if (r.recent < 2 || !r.recentShown || !r.listGrid || r.all < 70 || !r.listCards || r.sounds < 1 || r.picked !== 'pine' || r.tool !== 'place' || r.view !== 'grid' || !r.disposed || !r.root) throw new Error(JSON.stringify(r));
  return r;
});
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
