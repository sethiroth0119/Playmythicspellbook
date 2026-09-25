/* Athena Engine round 6: actor blueprints (components, event graph, Play
   execution, engine + overlay) and prefabs (create, place, edit/apply, unpack,
   shelf). Runs on harness2.html. */
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
await page.waitForFunction(() => !!window.MythicMapForge && !!window.AthenaUI, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.clear(); });
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Round 6' }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);
const ed = () => page.evaluate(() => { const e = MythicMapForge.editor(); const m = e.S.map; return { objs: m.objects.length, prefabs: m.prefabs.length, sel: e.S.selectedId, multi: Array.from(e.S.multi), types: m.objects.map(o => o.t) }; });

/* ── prefabs ── */
await step('multi-select three placed props → Create prefab', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const mk = (t, x, z, n) => { const o = { id: 'o_' + t + n, t, p: [x, e.world.heightAt(x, z), z], r: [0, 0, 0], s: [1, 1, 1], g: true, n }; m.objects.push(o); e.world.addObject(o); return o.id; };
    const ids = [mk('house', 0, 0, 'hut'), mk('fence', 3, 0, 'fenceA'), mk('lantern', -3, 0, 'lamp')];
    e.refresh();
    e.S.selectedId = ids[0]; e.S.multi.clear(); ids.forEach(id => e.S.multi.add(id)); e.refresh();
    const inp = document.getElementById('mf-pf-name'); if (!inp) return { err: 'no multi inspector' }; inp.value = 'Camp';
    document.getElementById('mf-pf-create').click();
    const inst = m.objects.find(o => o.t === 'prefab');
    const root = e.world.objects.get(inst.id);
    return { prefabs: m.prefabs.length, parts: m.prefabs[0].objects.length, objs: m.objects.length, instPos: inst.p.map(v => +v.toFixed(2)), partsBuilt: root.children.length, colliders: e.world.colliders.size, partIds: Array.from(e.world.parts.keys()).length };
  });
  if (r.err || r.prefabs !== 1 || r.parts !== 3 || r.objs !== 1 || r.partsBuilt !== 3 || r.partIds !== 3) throw new Error(JSON.stringify(r));
  return r;
});
await step('Library → Prefabs → place a second instance', async () => {
  await page.click('#mf-cats button[data-cat="Prefabs"]'); await page.waitForSelector('#mf-prefabs [data-pf]');
  await page.click('#mf-prefabs [data-pf] .lb');
  const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.7, bb.y + bb.height * 0.6); await page.waitForTimeout(80); await page.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height * 0.6);
  const r = await ed(); if (r.objs !== 2 || r.types.filter(t => t === 'prefab').length !== 2) throw new Error(JSON.stringify(r)); return r;
});
await step('Edit prefab → move a piece → Apply → both instances rebuilt', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const inst = m.objects.find(o => o.t === 'prefab');
    document.querySelector('.mf-tabs button[data-tab="object"]').click(); e.S.selectedId = inst.id; e.S.multi.clear(); e.S.multi.add(inst.id); e.refresh();
    document.getElementById('mf-pf-edit').click();
    const unpacked = m.objects.filter(o => o.t !== 'prefab').length, editing = !!e.S.editingPrefab;
    const lamp = m.objects.find(o => o.n === 'lamp'); lamp.p[1] += 2; lamp.g = false; e.world.refreshObject(lamp);
    document.getElementById('mf-pf-apply').click();
    const def = m.prefabs[0]; const lampDef = def.objects.find(c => c.n === 'lamp');
    const insts = m.objects.filter(o => o.t === 'prefab');
    return { unpacked, editing, prefabs: m.prefabs.length, insts: insts.length, lampY: +lampDef.p[1].toFixed(2), partsPerInst: insts.map(i => e.world.objects.get(i.id).children.length), stillEditing: !!e.S.editingPrefab };
  });
  if (r.unpacked !== 3 || !r.editing || r.prefabs !== 1 || r.insts !== 2 || r.lampY < 1.9 || r.partsPerInst.join() !== '3,3' || r.stillEditing) throw new Error(JSON.stringify(r));
  return r;
});
await step('Unpack breaks the link; shelf save + import into a fresh map', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map; const inst = m.objects.find(o => o.t === 'prefab');
    e.S.selectedId = inst.id; e.S.multi.clear(); e.S.multi.add(inst.id); e.refresh();
    document.getElementById('mf-pf-shelf').click();
    document.getElementById('mf-pf-unpack').click();
    const after = { objs: m.objects.length, prefabs: m.objects.filter(o => o.t === 'prefab').length, shelf: JSON.parse(localStorage.getItem('mf_prefabs_v1')).length };
    // fresh map, pull from shelf
    await MythicMapForge.close(); await MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Fresh' }) });
    await new Promise(r => setTimeout(r, 800));
    const e2 = MythicMapForge.editor(); document.querySelector('#mf-cats button[data-cat="Prefabs"]').click();
    const row = document.querySelector('[data-shelf]'); row.click();
    return Object.assign(after, { imported: e2.S.map.prefabs.length, propId: e2.S.propId, tool: e2.S.tool });
  });
  if (r.objs !== 4 || r.prefabs !== 1 || r.shelf !== 1 || r.imported !== 1 || r.propId !== 'prefab' || r.tool !== 'place') throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r6-01-prefabs.png' });

/* ── blueprints ── */
await step('add blueprint: trigger + spin components, graph Begin→Toast, Enter→Move, Interact→Spawn, Tick→SetVar', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const o = { id: 'o_actor', t: 'crate', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, n: 'chest' }; o.p[1] = e.world.heightAt(0, 0); m.objects.push(o); e.world.addObject(o);
    document.querySelector('.mf-tabs button[data-tab="object"]').click(); e.S.selectedId = o.id; e.S.multi.clear(); e.S.multi.add(o.id); e.refresh();
    const addc = document.getElementById('mf-bp-addc'); addc.value = 'trigger'; addc.dispatchEvent(new Event('change'));
    document.getElementById('mf-bp-addc').value = 'spin'; document.getElementById('mf-bp-addc').dispatchEvent(new Event('change'));
    document.getElementById('mf-bp-vname').value = 'ticks'; document.getElementById('mf-bp-vadd').click();
    document.getElementById('mf-bp-graph').click();
    const g = o.bp.graph;
    const mkn = (type, x, props) => { const n = MythicMapForge.editor().S.map.objects[0] && null; const node = { id: 'g_' + type, type, x, y: 40, props: Object.assign({}, props) }; g.nodes.push(node); return node; };
    const begin = g.nodes[0];
    mkn('toast', 300, { message: 'Chest awake at {self.x|fixed:1}', ms: 500 }); g.links.push({ from: { n: begin.id, pin: 'then' }, to: { n: 'g_toast' } });
    mkn('ev_enter', 40, {}); mkn('move', 300, { target: 'self', x: 0, y: 1, z: 0, secs: 0, relative: 'true' }); g.links.push({ from: { n: 'g_ev_enter', pin: 'then' }, to: { n: 'g_move' } });
    mkn('ev_interact', 40, { prompt: 'Open' }); mkn('spawn', 300, { what: 'barrel', x: 0, y: 0, z: 2, name: 'loot' }); g.links.push({ from: { n: 'g_ev_interact', pin: 'then' }, to: { n: 'g_spawn' } });
    mkn('ev_tick', 40, { ms: 60 }); mkn('setvar', 300, { var: 'ticks', value: '{$ticks} + 1' }); g.links.push({ from: { n: 'g_ev_tick', pin: 'then' }, to: { n: 'g_setvar' } });
    e.refresh(); document.getElementById('mf-bp-graph').click(); document.getElementById('mf-bp-graph').click();
    return { comps: o.bp.comps.map(c => c.type), vars: Object.keys(o.bp.vars), nodes: g.nodes.length, links: g.links.length, panel: !document.getElementById('mf-bp').hidden, gnodes: document.querySelectorAll('#mf-bp-canvas .aw-gnode').length, ring: e.scene.children.some(c => c.geometry && c.geometry.type === 'RingGeometry' && c.visible) };
  });
  if (r.comps.join() !== 'trigger,spin' || r.nodes !== 8 || r.links !== 4 || !r.panel || r.gnodes !== 8) throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r6-02-graph.png' });
await step('Play: Begin toast, spin turns, walk into trigger → move, E → spawn, tick counts; Stop restores', async () => {
  const before = await page.evaluate(() => window.__toasts.length);
  await page.keyboard.press('p'); await page.waitForTimeout(400);
  // the editor's Play starts the player at the camera target (the origin here) — inside the trigger, so On Enter fires at once (y += 1)
  const r1 = await page.evaluate((b) => { const e = MythicMapForge.editor(); const root = e.world.objects.get('o_actor'); return { playing: e.S.playing, running: e.world.playing, toast: document.querySelector('.mf-toast').textContent, rotY: +root.rotation.y.toFixed(3), y: +root.position.y.toFixed(2) }; }, before);
  if (!r1.running || !/Chest awake at 0\.0/.test(r1.toast) || r1.y !== 1) throw new Error('begin: ' + JSON.stringify(r1));
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => { const e = MythicMapForge.editor(); const root = e.world.objects.get('o_actor'); const y0 = root.position.y; e.play.pos.x = 10; e.play.pos.z = 10; e.world.update(0.05, e.camera); const outPrompt = document.getElementById('mf-prompt').hidden; e.play.pos.x = 0.5; e.play.pos.z = 0.5; e.world.update(0.05, e.camera); e.world.update(0.05, e.camera); return { rotY: +root.rotation.y.toFixed(3), outPrompt, movedY: +(root.position.y - y0).toFixed(2), prompt: document.getElementById('mf-prompt').textContent, objs: e.S.map.objects.length }; });
  if (!(r2.rotY > 0.01) || !r2.outPrompt || Math.abs(r2.movedY - 1) > 0.01 || !/Open/.test(r2.prompt)) throw new Error('enter/exit: ' + JSON.stringify(r2));
  await page.keyboard.press('e'); await page.waitForTimeout(50);
  const r3 = await page.evaluate(() => { const e = MythicMapForge.editor(); e.world.update(0.05, e.camera); e.world.update(0.05, e.camera); const spawned = e.S.map.objects.filter(o => o._rt); return { spawned: spawned.map(o => o.t + '@' + o.p.map(v => +v.toFixed(1)).join(',')), objs: e.S.map.objects.length, ticks: e.world.actors.vars('o_actor').ticks.value }; });
  if (r3.spawned.length !== 1 || !/barrel@/.test(r3.spawned[0]) || !(r3.ticks >= 3)) throw new Error('interact: ' + JSON.stringify(r3));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const r4 = await page.evaluate(() => { const e = MythicMapForge.editor(); const root = e.world.objects.get('o_actor'); const o = e.S.map.objects.find(x => x.id === 'o_actor'); return { playing: e.S.playing, running: e.world.playing, rotY: +root.rotation.y.toFixed(3), y: +root.position.y.toFixed(2), docY: +o.p[1].toFixed(2), objs: e.S.map.objects.length, rt: e.S.map.objects.filter(x => x._rt).length }; });
  if (r4.running || r4.rotY !== 0 || r4.y !== r4.docY || r4.rt !== 0 || r4.objs !== 1) throw new Error('stop: ' + JSON.stringify(r4));
  return { r1, r2, r3, r4 };
});
await step('save local → engine.mount runs the blueprint (spin) with a player; overlay runs it too', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); document.querySelector('.mf-top .name input').value = 'BP world'; document.getElementById('mf-game').value = 'bpgame'; document.getElementById('mf-game').dispatchEvent(new Event('change'));
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 400));
    await MythicMapForge.close();
    const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'bpgame', mode: 'fps', pointerLock: false });
    await new Promise(r => setTimeout(r, 400));
    const root = g.world.objects.get('o_actor'); const rot = root.rotation.y;
    const diag = { playing: g.world.playing, actors: g.world.actors.actors.size, hasBp: !!(g.map.objects.find(o => o.id === 'o_actor') || {}).bp, source: g.source, name: g.map.name, errors: window.__errors.slice() };
    g.world.update(0.5, g.camera); const rotManual = root.rotation.y - rot;   // delta of ONE manual step (the absolute angle depends on how many RAF frames ran)
    const prefabInst = g.map.objects.filter(o => o.t === 'prefab').length;
    g.stop(); host.remove();
    const ov = await MythicMapForge.overlay.forGame('bpgame', { THREE: window.THREE });
    ov.update(0.5, null); const ovRot = ov.world.objects.get('o_actor').rotation.y; ov.dispose();
    return { engineRunning: rot > 0.01, rotManual, diag, prefabInst, overlayRunning: ovRot > 0.01, actors: ov.actors ? 1 : 0 };
  });
  // engineRunning is the RAF loop over wall-clock (flaky on SwiftShader; pw-test2 covers the loop) — the manual world step is the assertion
  if (!(r.rotManual > 0.01) || !r.diag.playing || r.diag.actors !== 1 || !r.overlayRunning) throw new Error(JSON.stringify(r));
  return r;
});
await step('normalize: blueprint + prefab garbage', async () => page.evaluate(() => { const m = MythicMapForge.format.normalize({ prefabs: [{ id: 'p', objects: [{ t: 'tree', p: [0, 0, 0] }, { t: 'prefab', pf: 'p' }] }], objects: [{ t: 'prefab', pf: 'nope' }, { t: 'prefab', pf: 'p' }, { t: 'crate', bp: { comps: [{ type: 'zzz' }, { type: 'trigger', r: 'x' }], graph: { nodes: [{ id: 'a', type: 'toast' }, { type: 'bogus' }], links: [{ from: { n: 'a', pin: 'then' }, to: { n: 'zz' } }] } } }] }); return { prefabParts: m.prefabs[0].objects.length, objs: m.objects.map(o => o.t), comps: m.objects[1].bp.comps, nodes: m.objects[1].bp.graph.nodes.length, links: m.objects[1].bp.graph.links.length }; }));

console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
