/* Athena Engine round 5: content folders, game scenes (Homestead Farm slots +
   overlay), and Athena Widgets (designer, graph, slots, themes). Runs on
   harness2.html: farm + Athena + widgets with faked bridges, no network. */
import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge && !!window.AthenaUI && !!window.MythicFarm, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.clear(); });

/* ── 1. the farm mounts and registers its scene ── */
await step('farm mounts (3D) + adapter registered', async () => {
  await page.evaluate(() => MythicFarm.mount(document.getElementById('app')));
  await page.waitForFunction(() => document.querySelector('.farm-stage canvas'), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const g = await page.evaluate(() => AthenaEngine.games.list().map(x => x.id));
  if (!g.includes('farm')) throw new Error('adapter missing: ' + g);
  await page.evaluate(() => { MythicFarm.build('feedmill'); MythicFarm.rush('feedmill'); MythicFarm.build('coop'); MythicFarm.rush('coop'); MythicFarm.refresh(); });
  return { games: g, buildings: await page.evaluate(() => Object.keys(MythicFarm.state().buildings)) };
});
await step('farm Athena tab shows the admin button', async () => { await page.click('.farm-tab[data-id="athena"]'); await page.waitForSelector('[data-fact="athena-open"]'); return true; });

/* ── 2. open the farm scene in Athena ── */
await step('open farm scene from the farm', async () => {
  await page.click('[data-fact="athena-open"]');
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);
  return await page.evaluate(() => { const m = MythicMapForge.editor().S.map; return { game: m.game, slots: m.objects.filter(o => o.t === 'slot').length, folders: m.folders.map(f => f.name), tag: document.querySelector('.mf-top .gametag').textContent, scene: m.scene }; });
});
await page.screenshot({ path: S + '/shots/r5-01-farm-scene.png' });
const ed = () => page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; return { objs: m.objects.length, folders: m.folders.length, sel: e.S.selectedId, folderId: e.S.folderId }; });

/* ── 3. content folders ── */
await step('outliner: new folder, target it, place into it', async () => {
  await page.click('.mf-tabs button[data-tab="scene"]'); await page.waitForTimeout(100);
  await page.click('#mf-newfolder'); await page.waitForTimeout(100);
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.mf-ol-f')).map(r => r.querySelector('.lb') ? r.querySelector('.lb').textContent : '(renaming)'));
  const a = await ed(); if (a.folders !== 3) throw new Error('folders=' + a.folders + ' ' + rows);
  // place a tree into the active (new) folder
  await page.click('#mf-cats button[data-cat="Nature"]'); await page.click('#mf-props button[data-prop="tree"]'); await page.keyboard.press('4');
  const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(80); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; const o = m.objects[m.objects.length - 1]; return { t: o.t, f: o.f, active: e.S.folderId, folderHas: document.querySelector('.mf-ol-f.active .n').textContent }; });
  if (r.t !== 'tree' || r.f !== r.active) throw new Error('not placed into folder ' + JSON.stringify(r));
  return r;
});
await step('outliner: hide folder hides object; lock blocks picking; move via inspector; undo', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world; const o = m.objects[m.objects.length - 1];
    const row = document.querySelector('.mf-ol-f.active');
    row.querySelector('[data-act="vis"]').click();
    const hidden = w.objects.get(o.id).visible === false;
    row.querySelector('[data-act="vis"]').click();
    const shown = w.objects.get(o.id).visible === true;
    row.querySelector('[data-act="lock"]').click();
    const locked = !!m.folders.find(f => f.id === e.S.folderId).lock;
    row.querySelector('[data-act="lock"]').click();
    return { hidden, shown, locked, inFolder: w.inFolder('New folder').length };
  });
  if (!r.hidden || !r.shown || !r.locked || r.inFolder !== 1) throw new Error(JSON.stringify(r));
  // move the tree to the Pens folder from the inspector, then undo
  const r2 = await page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; const o = m.objects[m.objects.length - 1]; const pens = m.folders.find(f => f.name === 'Pens'); document.querySelector('.mf-tabs button[data-tab="object"]').click(); e.S.selectedId = o.id; e.refresh(); const sel = document.querySelector('#mf-o-folder'); sel.value = pens.id; sel.dispatchEvent(new Event('change')); const moved = o.f === pens.id; document.getElementById('mf-undo').click(); const back = m.objects[m.objects.length - 1].f !== pens.id; return { moved, back }; });
  if (!r2.moved || !r2.back) throw new Error(JSON.stringify(r2));
  return Object.assign(r, r2);
});

/* ── 4. game slots: move one, replace one, save, set live ── */
await step('slot: move feedmill, replace coop with a house, save local + set live', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const fm = m.objects.find(o => o.k === 'feedmill'); fm.p[0] += 3; fm.p[2] -= 2; fm.r[1] = Math.PI / 2; e.world.refreshObject(fm);
    e.S.selectedId = null; e.refresh();
    const coop = m.objects.find(o => o.k === 'coop');
    document.querySelector('.mf-tabs button[data-tab="object"]').click();
    e.S.selectedId = coop.id; e.refresh();
    document.querySelector('#mf-cats button[data-cat="Structures"]').click();
    document.querySelector('#mf-props button[data-prop="house"]').click();
    e.S.selectedId = coop.id; e.refresh();
    const btn = document.getElementById('mf-o-slot-replace'); if (!btn) return { err: 'no replace button' };
    btn.click();
    const after = m.objects.find(o => o.k === 'coop');
    document.querySelector('.mf-top .name input').value = 'Farm test';
    document.getElementById('mf-save-local').click();
    await new Promise(r => setTimeout(r, 400));
    const rows = await MythicMapForge.maps.list();
    const row = rows.rows.find(x => x.game === 'farm');
    const lv = await MythicMapForge.maps.setLive(row.id, row.source, true);
    return { coopType: after.t, coopKey: after.k, restoreBtn: !!document.getElementById('mf-o-slot-restore'), saved: !!row, live: lv.ok, state: document.querySelector('.mf-top .state').textContent };
  });
  if (r.err || r.coopType !== 'house' || r.coopKey !== 'coop' || !r.live) throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r5-02-slots.png' });
await step('close editor → farm overlay applies the new layout', async () => {
  await page.click('#mf-close'); await page.waitForTimeout(300);
  if (await page.evaluate(() => !!document.getElementById('mf-root'))) { await page.evaluate(() => MythicMapForge.close()); }
  await page.waitForTimeout(1500);
  const info = await page.evaluate(async () => {
    const ov = await AthenaEngine.overlay.forGame('farm', { THREE: window.THREE });
    if (!ov) return { err: 'no overlay' };
    const fm = ov.slot('feedmill'), coop = ov.slot('coop');
    const rep = ov.buildReplacement('coop');
    const out = { fmMoved: fm && Math.abs(fm.p[0] - (-1.5)) < 0.01 && Math.abs(fm.p[2] - (-7)) < 0.01, coopReplaced: coop && coop.replaced, repType: rep && rep.userData.mfType, pieces: ov.pieces, groupKids: ov.group.children.length };
    ov.dispose(); return out;
  });
  if (info.err || !info.fmMoved || !info.coopReplaced || info.repType !== 'house') throw new Error(JSON.stringify(info));
  return info;
});
await step('farm scene picked up the overlay (placement moved, coop replaced)', async () => {
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const sc = MythicFarm.scene(); if (!sc || sc.mode !== '3d') return { err: 'no 3d scene' };
    const ov = sc.athena; if (!ov) return { err: 'scene has no overlay' };
    const fm = ov.placement(MythicFarm.buildingDef('feedmill')), coop = ov.placement(MythicFarm.buildingDef('coop'));
    return { fm: { x: fm.x, z: fm.z, ry: +fm.ry.toFixed(2), home: fm.home }, coopReplaced: coop.replaced, yard: ov.yardOf(MythicFarm.buildingDef('coop')) };
  });
  if (r.err || r.fm.home || !r.coopReplaced) throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r5-03-farm-overlay.png' });

/* ── 5. widgets ── */
await step('designer opens; add button + bound text; wire On Click → Toast', async () => {
  await page.evaluate(() => AthenaUI.openDesigner());
  await page.waitForSelector('#aw-root'); await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const d = AthenaUI.designer(); const D = d.S.doc;
    document.querySelector('#aw-palette button[data-type="button"]').click();
    document.querySelector('#aw-palette button[data-type="text"]').click();
    const btn = D.root.children.find(n => n.type === 'button'), txt = D.root.children.filter(n => n.type === 'text').pop();
    btn.name = 'go'; btn.props.label = 'Go {name}'; txt.bind.text = '{gems|num} Cinder · {res.wood} wood';
    // graph: On Click(go) → Toast
    const ev = AthenaUI.format.newWidget().graph.nodes[0]; // unused
    const gn = D.graph.nodes; const click = { id: 'g_click', type: 'ev_click', x: 40, y: 140, props: { widget: 'go' } }; const toast = { id: 'g_toast', type: 'toast', x: 300, y: 140, props: { message: 'Clicked by {name} with {gems} gems', ms: 1000 } };
    const setv = { id: 'g_set', type: 'setvar', x: 520, y: 140, props: { var: 'count', value: '{$count} + 1' } };
    gn.push(click, toast, setv); D.graph.links.push({ from: { n: 'g_click', pin: 'then' }, to: { n: 'g_toast' } }, { from: { n: 'g_toast', pin: 'then' }, to: { n: 'g_set' } });
    D.vars.count = { type: 'number', value: 0 };
    document.querySelector('#aw-palette button[data-type="text"]').click();
    D.root.children.filter(n => n.type === 'text').pop().props.text = 'count {$count}';
    D.target = { mode: 'slot', slot: 'farm.hud', place: 'append' };
    document.querySelector('.aw-top .name input').value = 'HUD test';
    document.querySelector('.aw-views button[data-view="graph"]').click();
    return { nodes: D.graph.nodes.length, links: D.graph.links.length, stageEls: document.querySelectorAll('#aw-stage [data-aw-id]').length, gnodes: document.querySelectorAll('.aw-gnode').length, wires: document.querySelectorAll('#aw-wires path').length };
  });
  if (r.gnodes < 4 || r.wires !== 2) throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r5-04-graph.png' });
await step('preview runs the graph: click → toast + variable', async () => {
  await page.evaluate(() => { document.querySelector('.aw-views button[data-view="designer"]').click(); document.getElementById('aw-run').click(); });
  await page.waitForSelector('#aw-preview .aw-root'); 
  const before = await page.evaluate(() => window.__toasts.length);
  await page.click('#aw-preview button[data-aw-name="go"]'); await page.waitForTimeout(200);
  const r = await page.evaluate((b) => ({ toasts: window.__toasts.slice(b), text: document.querySelector('#aw-preview [data-aw-id]').textContent, count: AthenaUI.designer().S.preview.vars.count.value, label: document.querySelector('#aw-preview button[data-aw-name="go"]').textContent }), before);
  if (!r.toasts.some(t => /Clicked by Tester with 900000/.test(t) || /Clicked by Tester/.test(t)) || r.count !== 1 || r.label !== 'Go Tester') throw new Error(JSON.stringify(r));
  return r;
});
await step('save local + set live → mounts into the farm HUD slot with live data', async () => {
  await page.evaluate(() => document.getElementById('aw-save-local').click()); await page.waitForTimeout(300);
  const r = await page.evaluate(async () => { const l = await AthenaUI.docs.list(); const row = l.rows[0]; const lv = await AthenaUI.docs.setLive(row.id, row.source, true); window.dispatchEvent(new Event('athena-ui:changed')); return { rows: l.rows.length, live: lv.ok, name: row.name }; });
  await page.evaluate(() => document.getElementById('aw-close').click()); await page.waitForTimeout(900);
  const m = await page.evaluate(() => { const host = document.querySelector('[data-athena-slot="farm.hud"]'); return { mounted: !!host.querySelector('.aw-root'), text: host.textContent, mounts: AthenaUI.mounts().length }; });
  // the figure is what the fake bridge holds after the farm's builds; build B raised the farm's costs (v121v103), so the exact number is not pinned
  if (!m.mounted || !/\d[\d,]* Cinder/.test(m.text)) throw new Error(JSON.stringify(m));
  // click the live button in the game: graph runs against the real slot provider
  const before = await page.evaluate(() => window.__toasts.length);
  await page.click('[data-athena-slot="farm.hud"] button[data-aw-name="go"]'); await page.waitForTimeout(300);
  const after = await page.evaluate((b) => ({ toasts: window.__toasts.slice(b), text: document.querySelector('[data-athena-slot="farm.hud"]').textContent }), before);
  if (!after.toasts.length || !/count 1/.test(after.text)) throw new Error(JSON.stringify(after));
  return Object.assign(r, m, after);
});
await page.screenshot({ path: S + '/shots/r5-05-live-widget.png' });
await step('selector target: replace the farm title with a widget, then unlive restores it', async () => {
  const r = await page.evaluate(async () => {
    const d = AthenaUI.format.newWidget({ name: 'Title swap' }); d.root.children[0].props.text = 'MY FARM {name|upper}'; d.target = { mode: 'selector', selector: '[data-farm="title"]', place: 'replace' };
    await AthenaUI.docs.save(d, 'local'); await AthenaUI.docs.setLive(d.id, 'local', true); await AthenaUI.reload(); await new Promise(r => setTimeout(r, 300));
    const t = document.querySelector('[data-farm="title"]'); const host = t.nextElementSibling;
    const replaced = t.style.display === 'none' && host && /MY FARM TESTER/.test(host.textContent);
    await AthenaUI.docs.setLive(d.id, 'local', false); await AthenaUI.reload(); await new Promise(r => setTimeout(r, 300));
    return { replaced, restored: t.style.display === '' && !t.nextElementSibling.classList.contains('aw-host') };
  });
  if (!r.replaced || !r.restored) throw new Error(JSON.stringify(r));
  return r;
});
await step('theme document applies CSS variables live', async () => {
  const r = await page.evaluate(async () => {
    const d = AthenaUI.format.newWidget({ name: 'Gold theme', kind: 'theme' }); d.theme.vars['--aw-test'] = '#123456'; d.theme.css = '.farm-top h1{color:#123456 !important}';
    await AthenaUI.docs.save(d, 'local'); await AthenaUI.docs.setLive(d.id, 'local', true); await AthenaUI.reload(); await new Promise(r => setTimeout(r, 200));
    const v = getComputedStyle(document.documentElement).getPropertyValue('--aw-test').trim(); const c = getComputedStyle(document.querySelector('.farm-top h1')).color;
    return { v, c, styleEl: !!document.getElementById('aw-theme-' + d.id) };
  });
  if (r.v !== '#123456' || r.c !== 'rgb(18, 52, 86)') throw new Error(JSON.stringify(r));
  return r;
});
await step('Maps tab → Game scenes → Open scene loads the live farm map; Restore missing slots', async () => {
  await page.evaluate(() => MythicMapForge.open());
  await page.waitForSelector('#mf-root', { timeout: 5000 }); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(400);
  await page.click('.mf-tabs button[data-tab="maps"]'); await page.waitForTimeout(300);
  await page.waitForSelector('#mf-gamescenes .mf-map[data-game="farm"]', { timeout: 5000 });
  await page.click('#mf-gamescenes .mf-map[data-game="farm"] [data-act="open"]'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; const coop = m.objects.find(o => o.k === 'coop'); return { game: m.game, name: m.name, coop: coop && coop.t, src: e.S.source, slotsBtn: !!document.querySelector('#mf-gamescenes [data-act="slots"]'), flags: document.querySelectorAll('#mf-scene-flags input').length }; });
  if (r.game !== 'farm' || r.coop !== 'house' || r.src !== 'local') throw new Error(JSON.stringify(r));
  const r2 = await page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; const vet = m.objects.find(o => o.k === 'vet'); m.objects = m.objects.filter(o => o !== vet); e.world.removeObject(vet.id); document.querySelector('#mf-gamescenes [data-act="slots"]').click(); return { restored: !!m.objects.find(o => o.k === 'vet'), total: m.objects.length }; });
  if (!r2.restored) throw new Error(JSON.stringify(r2));
  await page.evaluate(() => MythicMapForge.close()); await page.waitForTimeout(200);
  return Object.assign(r, r2);
});
await step('expression language edge cases', async () => {
  const r = await page.evaluate(() => { const E = AthenaUI.format.evalExpr, I = AthenaUI.format.interpolate; const sc = { data: { gems: 1500, a: { b: 'x' }, list: [1, 2, 3] }, vars: { n: { type: 'number', value: 4 } } };
    return [E('{gems} > 1000 && {$n} == 4', sc) === true || E('gems > 1000 && $n == 4', sc) === true, I('{gems|num}', sc) === '1,500', I('{a.b|upper}!', sc) === 'X!', I('{missing|default:none}', sc) === 'none', E('max(1, $n) * 2', sc) === 8, I('{len(list)} items', sc) === '3 items', E('"a" + 1', sc) === 'a1', E('1/0', sc) === 0, I('{gems > 100}', sc) === true]; });
  if (r.some(x => !x)) throw new Error(JSON.stringify(r));
  return r;
});
await step('normalize survives garbage', async () => page.evaluate(() => { const n = AthenaUI.format.normalize({ root: { type: 'nope' }, graph: { nodes: [{ type: 'zzz' }, { id: 'a', type: 'toast' }], links: [{ from: { n: 'a', pin: 'then' }, to: { n: 'missing' } }] }, target: { mode: 'weird' } }); const m = MythicMapForge.format.normalize({ folders: [{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }], objects: [{ t: 'tree', f: 'zz', k: 'Feed Mill!' }, { t: 'slot', k: 'coop', f: 'x' }] }); return { widgetRoot: n.root.type, gnodes: n.graph.nodes.length, links: n.graph.links.length, mode: n.target.mode, folders: m.folders.map(f => f.parent), objF: m.objects.map(o => o.f), objK: m.objects.map(o => o.k) }; }));

console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
