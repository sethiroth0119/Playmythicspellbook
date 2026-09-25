/* Athena Engine round 15: the battle board as a game scene. Adapter build
   (v3 → Athena: terrain keys → paint, models → slots drawn with the board's
   own props, .glb slots → assets), editing (move / delete / replace a slot,
   paint, add a prop), write-back on Save (Athena → v3: terrain sampled per
   cell, transforms, removals), publish on ★ Live, and the overlay the board
   reads back (extra objects + replacement). harness2.html. */
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
await page.waitForFunction(() => !!window.MythicMapForge && !!window.MythicBattleAthena, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());

await step('adapter registered; build(): terrain paint from board keys, one slot per model, glb slot → asset, folders, scale ×3', async () => {
  const r = await page.evaluate(() => {
    const g = MythicMapForge.games.get('battle'); const m = MythicMapForge.format.normalize(g.build());
    const W = m.terrain.n + 1, half = m.terrain.n * m.terrain.cell / 2;
    const paintAt = (x, z) => m.terrain.paint[Math.round((z + half) / m.terrain.cell) * W + Math.round((x + half) / m.terrain.cell)];
    // board cell (0,0) is grass (paint 1), (3,6) water (7), (7,2) lava (9), (4,3) road (10) — centres at ((c+0.5-4)*3, (r+0.5-3.5)*3)
    const at = (c, r) => paintAt((c + 0.5 - 4) * 3, (r + 0.5 - 3.5) * 3);
    const slots = m.objects.filter(o => o.t === 'slot');
    return { reg: !!g, n: m.terrain.n, game: m.game, grass: at(0, 0), water: at(3, 6), lava: at(7, 2), road: at(4, 3), slots: slots.length, k: slots.map(o => o.k), p0: slots[0].p, s1: slots[1].s[0], rot0: +slots[0].r[1].toFixed(3), assets: m.assets.map(a => a.url), folders: m.folders.map(f => f.id), noGround: m.scene.ground === false };
  });
  if (!r.reg || r.n !== 24 || r.game !== 'battle' || r.grass !== 1 || r.water !== 7 || r.lava !== 9 || r.road !== 10 || r.slots !== 4 || r.k.join() !== 'bm.0,bm.1,bm.2,bm.3' || r.p0.join() !== '-7.5,0,-4.5' || Math.abs(r.s1 - 3.6) > 1e-6 || Math.abs(r.rot0 - 1.571) > 0.001 || r.assets.join() !== '/models/Duck.glb' || r.folders.join() !== 'f_bm_props,f_bm_models' || !r.noGround) throw new Error(JSON.stringify(r));
  return r;
});
await step('open({ game: "battle" }): slots drawn with the board\'s own prop builder (slotBody), not placeholders', async () => {
  await page.evaluate(() => MythicMapForge.open({ game: 'battle' }));
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const roots = e.S.map.objects.filter(o => o.t === 'slot').map(o => e.world.objects.get(o.id));
    return { game: e.S.map.game, bodies: roots.map(r => r.children[0] && r.children[0].userData.bmProp), slotBody: roots.slice(0, 3).every(r => r.children[0] && r.children[0].userData.mfSlotBody), glbPlaceholder: !!(roots[3].children[0] && roots[3].children[0].userData.mfProp === 'slot'), objs: e.S.map.objects.length };
  });
  // the .glb board slot keeps the generic 🧩 stand-in (the board loads that model itself)
  if (r.game !== 'battle' || r.bodies.join() !== 'tower,house,rock,' || !r.slotBody || !r.glbPlaceholder || r.objs !== 4) throw new Error(JSON.stringify(r));
  return r;
});
await step('edit: move tower, delete rock, replace house with a crate, paint snow over cell (0,0), add a lantern; Save → v3 written back correctly', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const tower = m.objects.find(o => o.k === 'bm.0'), house = m.objects.find(o => o.k === 'bm.1'), rock = m.objects.find(o => o.k === 'bm.2');
    tower.p[0] = 3; tower.p[2] = 6; tower.r[1] = Math.PI; tower.s = [4.5, 4.5, 4.5]; e.world.refreshObject(tower);
    m.objects.splice(m.objects.indexOf(rock), 1); e.world.removeObject(rock.id);
    // replace the house with a crate through the inspector button
    e.library.pick('prop:crate'); e.S.tool = 'select'; e.S.selectedId = house.id; e.S.multi.clear(); e.S.multi.add(house.id); e.refresh();
    document.getElementById('mf-o-slot-replace').click();
    // paint snow (layer 5) over board cell (0,0): centre (-10.5, -9)
    e.world.terrain.applyBrush({ x: -10.5, z: -9, radius: 2, strength: 1, falloff: 0.1, mode: 'paint', paint: 5 });
    // add a lantern (no board equivalent → overlay only)
    const o = { id: 'o_extra', t: 'lantern', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true }; m.objects.push(o); e.world.addObject(o);
    e.refresh();
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 400));
    const w = window.__battleWrites; const v3 = w[w.length - 1];
    const idx = (c, r) => c * 7 + r;
    return { writes: w.length, v: v3.v, cols: v3.cols, rows: v3.rows, tlen: v3.terrain.length, t00: v3.terrain[idx(0, 0)], t01: v3.terrain[idx(0, 1)], t36: v3.terrain[idx(3, 6)], t72: v3.terrain[idx(7, 2)], models: v3.models, glb: v3.glbSlots.map(s => s.id), refreshed: window.__boardRefreshed, replacedT: house.t, published: window.__battlePublished };
  });
  const mv = r.models;
  if (r.writes !== 1 || r.v !== 3 || r.cols !== 8 || r.rows !== 7 || r.tlen !== 56 || r.t00 !== 'snow' || r.t01 !== 'grass' || r.t36 !== 'water' || r.t72 !== 'lava' || mv.length !== 3 || r.glb.join() !== 'g1' || r.replacedT !== 'crate' || r.published !== 0 || r.refreshed < 1) throw new Error(JSON.stringify(r));
  if (mv[0].t !== 'tower' || mv[0].x !== 1 || mv[0].z !== 2 || mv[0].rot !== 180 || mv[0].sc !== 1.5 || mv[1].t !== 'house' || mv[1].sc !== 1.2 || mv[2].t !== 'g1') throw new Error(JSON.stringify(mv));
  return { t00: r.t00, models: mv };
});
await step('★ Set live: v3 written again and published; the board overlay carries the lantern and the crate replacement (rock slot gone)', async () => {
  await page.click('.mf-tabs button[data-tab="maps"]'); await page.waitForSelector('.mf-map'); await page.click('.mf-map [data-act="live"]'); await page.waitForTimeout(400);
  const r = await page.evaluate(async () => {
    const pub = window.__battlePublished, writes = window.__battleWrites.length, lw = window.MythicBattleAthena.lastWrite;
    await MythicMapForge.close();
    const T = window.THREE; const scene = new T.Scene();
    const ov = await MythicMapForge.overlay.forGame('battle', { THREE: T, scene });
    if (!ov) return { pub, writes, ov: false };
    const slots = ov.slots().map(s => ({ k: s.o.k, replaced: s.replaced }));
    const rep = ov.buildReplacement('bm.1');
    let lantern = 0; ov.group.traverse(o => { if (o.userData && o.userData.mfProp === 'lantern') lantern++; });
    const hidden = ov.world.objects.get('o_bm_0').visible === false;   // slot placeholders hidden in the overlay
    ov.dispose();
    return { pub, writes, ov: true, slots, rep: !!rep && rep.children.length > 0, lantern, hidden, published: lw.published };
  });
  if (r.pub !== 1 || r.writes !== 2 || !r.ov || r.slots.length !== 3 || !r.slots.find(s => s.k === 'bm.1' && s.replaced) || r.slots.find(s => s.k === 'bm.2') || !r.rep || r.lantern !== 1 || !r.hidden || !r.published) throw new Error(JSON.stringify(r));
  return r;
});
await step('reopen loads the LIVE battle map (edits kept); toBoardMap is idempotent on an unchanged map', async () => {
  await page.evaluate(() => MythicMapForge.open({ game: 'battle' }));
  await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map;
    const again = window.MythicBattleAthena.toBoard(m, null); const prev = window.__battleWrites[window.__battleWrites.length - 1];
    const same = JSON.stringify(again.terrain) === JSON.stringify(prev.terrain) && JSON.stringify(again.models) === JSON.stringify(prev.models);
    await MythicMapForge.close();
    return { source: e.S.source, objs: m.objects.length, crate: !!m.objects.find(o => o.k === 'bm.1' && o.t === 'crate'), same };
  });
  if (r.source !== 'local' || r.objs !== 4 || !r.crate || !r.same) throw new Error(JSON.stringify(r));
  return r;
});
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
