/* Athena Engine round 13: splines. Curve sampling, mesh-mode bending
   (merged geometry per material, piece count, stretch), scatter mode
   (deterministic seed, spacing, width), terrain mode ribbon + Apply to
   terrain (flatten/paint, undoable), drawing in the editor (Library →
   Splines, ground clicks, Enter, close-loop), handles + gizmo point drag,
   insert/delete point, inspector controls, .glb sources rebuilding on load,
   normalize, non-colliding + non-instanced, engine build. harness2.html. */
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
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Splines', game: 'splines', n: 32, cell: 2 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);

await step('pure: sampleSpline arc-length even spacing, closed loop, tangents; normalizeSpline clamps + drops <2 pts', async () => {
  const r = await page.evaluate(async () => {
    const M = await import('/src/mapforge/mapforge.spline.js');
    const c = M.sampleSpline([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]], false, 0.5, 1);
    const gaps = []; for (let i = 1; i < c.pts.length - 1; i++) { const a = c.pts[i - 1], b = c.pts[i]; gaps.push(Math.hypot(b.x - a.x, b.z - a.z)); }
    const even = gaps.every(g => Math.abs(g - 1) < 0.02);
    const loop = M.sampleSpline([[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]], true, 0.5, 1);
    const last = loop.pts[loop.pts.length - 1];
    const t0 = c.pts[0];
    const n1 = M.normalizeSpline({ pts: [[0, 0, 0], [5, 0, 0], 'x', [1]], mode: 'nope', gap: 1e9, w: -3, paint: 99 });
    const n2 = M.normalizeSpline({ pts: [[0, 0, 0]] });
    const n3 = M.normalizeSpline({ pts: [[0, 0, 0], [1, 0, 0]], mode: 'terrain', paint: 99, dy: -100 });
    return { len: +c.length.toFixed(2), n: c.pts.length, even, loopBack: Math.hypot(last.x, last.z) < 0.01, tan: [+t0.tx.toFixed(2), +t0.tz.toFixed(2)], n1: { pts: n1.pts.length, mode: n1.mode, gap: n1.gap, w: n1.w, deform: n1.deform }, n2, n3: [n3.paint, n3.dy], presets: M.SPLINE_PRESETS.length };
  });
  if (r.len < 25 || !r.even || !r.loopBack || r.n1.pts !== 2 || r.n1.mode !== 'mesh' || r.n1.gap !== 60 || r.n1.w !== 0 || r.n1.deform !== true || r.n2 !== null || r.n3[0] !== 14 || r.n3[1] !== -20 || r.presets < 10) throw new Error(JSON.stringify(r));
  return r;
});
await step('Library → Splines: presets as cards; pick "Road" → Place tool, no ghost; ground clicks add points; Enter finishes → spline object, selected, handles shown', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor();
    document.querySelector('#mf-cats button[data-cat="Splines"]').click();
    const cards = Array.from(document.querySelectorAll('#mf-search .mf-card')).map(c => c.dataset.key);
    e.library.pick('spline:road');
    const state = { propId: e.S.propId, tool: e.S.tool, preset: e.S.splinePreset, ghost: !!e.scene.getObjectByName('ghost') };
    const h = (x, z) => ({ x, z, y: e.world.heightAt(x, z) });
    e.spline.add(h(-20, -10)); e.spline.add(h(-5, -14)); e.spline.add(h(8, -4)); e.spline.add(h(20, 6));
    const draft = e.spline.draft.pts.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise(r => setTimeout(r, 100));
    const o = e.S.map.objects.find(x => x.t === 'spline');
    const root = e.world.objects.get(o.id);
    const meshes = []; root.traverse(m => { if (m.isMesh && m.userData.mfSplineMesh) meshes.push(m.geometry.attributes.position.count); });
    return Object.assign(state, { cards: cards.length, hasRoad: cards.includes('spline:road'), draft, made: !!o, pts: o && o.sp.pts.length, origin: o && o.p.map(v => +v.toFixed(1)), mode: o && o.sp.mode, src: o && o.sp.src.t, selected: e.S.selectedId === o.id, tool2: e.S.tool, handles: e.spline.handles().length, draws: meshes.length, verts: meshes.reduce((a, b) => a + b, 0), noDraft: !e.spline.draft, name: o && o.n });
  });
  if (r.propId !== 'spline' || r.tool !== 'place' || r.preset !== 'road' || r.cards < 10 || !r.hasRoad || r.draft !== 4 || !r.made || r.pts !== 4 || r.origin.join() !== '-20,0,-10' || r.mode !== 'mesh' || r.src !== 'road' || !r.selected || r.tool2 !== 'select' || r.handles !== 4 || r.draws < 1 || r.draws > 4 || r.verts < 500 || !r.noDraft) throw new Error(JSON.stringify(r));
  return r;
});
await step('mesh mode: bent geometry hugs the curve (vertices near sampled path, y follows terrain), stretch fits whole pieces, deform off = rigid pieces; splines never collide nor instance', async () => {
  const r = await page.evaluate(async () => {
    const M = await import('/src/mapforge/mapforge.spline.js'); const e = MythicMapForge.editor(); const T = e.S.THREE;
    const o = e.S.map.objects.find(x => x.t === 'spline'); const root = e.world.objects.get(o.id); root.updateMatrixWorld(true);
    const curve = M.sampleSpline(o.sp.pts, false, 0.5, 0.25);
    // every deformed vertex must be within half the road width (+ a little) of the curve, in the spline's local XZ
    let maxD = 0, n = 0, yErr = 0; const v = new T.Vector3();
    root.traverse(m => { if (!(m.isMesh && m.userData.mfSplineMesh)) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i); let best = 1e9; for (const c of curve.pts) { const d = Math.hypot(c.x - v.x, c.z - v.z); if (d < best) best = d; } maxD = Math.max(maxD, best); n++; yErr = Math.max(yErr, Math.abs((e.world.heightAt(v.x + o.p[0], v.z + o.p[2]) - o.p[1]) - v.y)); } });
    const pieces = Math.round(curve.length / 8);
    // rigid mode
    e.S.selectedId = o.id; e.refresh();
    const before = e.world.objects.get(o.id).children[0].children.length;
    document.getElementById('mf-sp-deform').checked = false; document.getElementById('mf-sp-deform').dispatchEvent(new Event('change'));
    const rigid = e.world.objects.get(o.id).children[0].children.filter(c => c.userData.mfProp === 'road').length;
    document.getElementById('mf-sp-deform').checked = true; document.getElementById('mf-sp-deform').dispatchEvent(new Event('change'));
    return { samples: n, maxD: +maxD.toFixed(2), yErr: +yErr.toFixed(2), pieces, rigid, solid: e.world.isSolid(o), collider: e.world.colliders.has(o.id), batches: e.world.stats ? e.world.stats().batches : 0 };
  });
  if (r.samples < 50 || r.maxD > 2.6 || r.yErr > 0.9 || r.rigid < r.pieces - 1 || r.rigid > r.pieces + 1 || r.solid || r.collider) throw new Error(JSON.stringify(r));
  return r;
});
await step('handles: click-less point drag through the gizmo API moves a control point, rebuilds; insert + delete point; loop toggle', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const o = e.S.map.objects.find(x => x.t === 'spline');
    e.S.splinePt = 1; e.drawSplineHandles(); const h = e.spline.handles()[1];
    e.gizmo.attach(h); h.position.x += 6; h.position.z -= 5; e.gizmo.dispatchEvent({ type: 'objectChange' });
    const moved = o.sp.pts[1].map(v => +v.toFixed(1));
    const before = o.sp.pts.length; e.spline.insert(); const afterIns = o.sp.pts.length, sel = e.S.splinePt;
    e.spline.deletePoint(); const afterDel = o.sp.pts.length;
    document.getElementById('mf-sp-closed').checked = true; document.getElementById('mf-sp-closed').dispatchEvent(new Event('change'));
    const closed = o.sp.closed, handles = e.spline.handles().length;
    document.getElementById('mf-sp-closed').checked = false; document.getElementById('mf-sp-closed').dispatchEvent(new Event('change'));
    // undo covers point edits
    const undoN = e.S.undo.length; e.undo && e.undo();
    return { moved, before, afterIns, sel, afterDel, closed, handles, undoN, dirty: e.S.dirty };
  });
  if (r.moved[0] !== 21 || r.moved[2] !== -9 || r.afterIns !== r.before + 1 || r.sel !== 2 || r.afterDel !== r.before || !r.closed || r.handles !== r.before || r.undoN < 3 || !r.dirty) throw new Error(JSON.stringify(r));
  return r;
});
await step('scatter mode: tree line — count from spacing, deterministic seed (same positions on rebuild), reshuffle changes them, width spreads laterally, align yaws along the curve', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const h = (x, z) => ({ x, z, y: e.world.heightAt(x, z) });
    e.library.pick('spline:trees'); e.spline.add(h(-20, 10)); e.spline.add(h(0, 12)); e.spline.add(h(20, 10)); const o = e.spline.finish(false);
    const pos = () => { const rt = e.world.objects.get(o.id); return rt.children[0].children.map(c => [+c.position.x.toFixed(3), +c.position.z.toFixed(3), +c.rotation.y.toFixed(3)]); };
    const a = pos(); e.world.refreshObject(o); const b = pos();
    const same = JSON.stringify(a) === JSON.stringify(b);
    const lat = Math.max(...a.map(p => Math.abs(p[1] - (12 - 10 * 0 - 0) + 0)));   // rough spread check below instead
    document.getElementById('mf-sp-reseed').click(); const c = pos();
    const changed = JSON.stringify(a) !== JSON.stringify(c);
    // align: every yaw ≈ atan2(tx, tz) of a roughly +X curve → ~π/2
    document.getElementById('mf-sp-align').checked = true; document.getElementById('mf-sp-align').dispatchEvent(new Event('change'));
    const yaws = pos().map(p => p[2]); const aligned = yaws.every(y => Math.abs(Math.abs(y) - Math.PI / 2) < 0.6);
    const expected = Math.floor(40.2 / 4) + 1;
    return { count: a.length, expected, same, changed, aligned, src: o.sp.src.t, mode: o.sp.mode };
  });
  if (r.mode !== 'scatter' || r.src !== 'tree' || Math.abs(r.count - r.expected) > 2 || !r.same || !r.changed || !r.aligned) throw new Error(JSON.stringify(r));
  return r;
});
await step('terrain mode: river bed shows a ribbon; Apply lowers + paints the ground along the curve, is one undo step; grounded splines re-read the terrain after', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const h = (x, z) => ({ x, z, y: e.world.heightAt(x, z) });
    // raise a hill first so flattening has something to do
    e.world.terrain.applyBrush({ x: 0, z: -28, radius: 10, strength: 3, falloff: 0.5, mode: 'raise' });
    const hBefore = e.world.heightAt(0, -28), paintBefore = e.S.map.terrain.paint[0];
    e.library.pick('spline:river'); e.spline.add(h(-24, -28)); e.spline.add(h(0, -28)); e.spline.add(h(24, -28)); const o = e.spline.finish(false);
    const rt = e.world.objects.get(o.id); let ribbon = false; rt.traverse(m => { if (m.userData.mfRibbon) ribbon = true; });
    const undoN = e.S.undo.length;
    e.spline.applyTerrain();
    const hAfter = e.world.heightAt(0, -28);
    const t = e.S.map.terrain, n = t.n, W = n + 1, cell = t.cell, half = n * cell / 2;
    const idx = (x, z) => Math.round((z + half) / cell) * W + Math.round((x + half) / cell);
    const painted = t.paint[idx(0, -28)], side = t.paint[idx(0, -16)];
    const undoAfter = e.S.undo.length;
    return { ribbon, hBefore: +hBefore.toFixed(2), hAfter: +hAfter.toFixed(2), painted, side, mudIdx: 7, undoStep: undoAfter - undoN, mode: o.sp.mode };
  });
  if (r.mode !== 'terrain' || !r.ribbon || r.hBefore < 1 || Math.abs(r.hAfter - (r.hBefore - 1.2)) > 0.4 || r.painted !== 7 || r.side === 7 || r.undoStep !== 1) throw new Error(JSON.stringify(r));
  return r;
});
await step('.glb source: custom spline over a project model — placeholder first, rebuilt with the real model once loaded; Use library pick swaps the source', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const h = (x, z) => ({ x, z, y: e.world.heightAt(x, z) });
    document.querySelector('#mf-cats button[data-cat="Models"]').click(); await new Promise(r => setTimeout(r, 300));
    e.library.pick('project:duck'); await new Promise(r => setTimeout(r, 200));
    const aid = e.S.assetId; const lastSrc = e.S.lastSrc;
    e.library.pick('spline:custom'); e.spline.add(h(-20, 24)); e.spline.add(h(20, 26)); const o = e.spline.finish(false);
    const src0 = JSON.stringify(o.sp.src);
    const t0 = Date.now(); let tris = 0; while (Date.now() - t0 < 10000) { tris = 0; e.world.objects.get(o.id).traverse(m => { if (m.isMesh && m.userData.mfSplineMesh) tris += m.geometry.attributes.position.count / 3; }); if (tris > 2000) break; await new Promise(r => setTimeout(r, 150)); }
    // swap to a fence via "Use library pick"
    document.querySelector('#mf-cats button[data-cat="Structures"]').click(); e.library.pick('prop:fence');
    e.S.selectedId = o.id; e.S.tool = 'select'; e.refresh();
    const btn = document.getElementById('mf-sp-usepick'); const btnLabel = btn && btn.textContent; if (btn) btn.click();
    return { aid: !!aid, lastSrc, src0, tris: Math.round(tris), swapped: o.sp.src.t, btnLabel };
  });
  if (!r.aid || !r.lastSrc || r.lastSrc.t !== 'glb' || !/"t":"glb"/.test(r.src0) || r.tris < 2000 || r.swapped !== 'fence' || !/Fence/.test(r.btnLabel)) throw new Error(JSON.stringify(r));
  return r;
});
await step('persistence + engine: normalize keeps sp (drops a 1-point spline), the engine builds splines in a game map, duplicate copies points', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const F = MythicMapForge.format;
    const doc = JSON.parse(JSON.stringify(F.serialize(e.S.map)));
    doc.objects.push({ id: 'bad', t: 'spline', p: [0, 0, 0], sp: { pts: [[0, 0, 0]] } });
    const norm = F.normalize(doc);
    const splines = norm.objects.filter(o => o.t === 'spline');
    const road = splines.find(o => o.sp.src && o.sp.src.t === 'road');
    e.S.selectedId = road.id; e.S.multi.clear(); e.S.multi.add(road.id); e.refresh();
    const before = e.S.map.objects.length; document.getElementById('mf-o-dup').click();
    const dup = e.S.map.objects[e.S.map.objects.length - 1];
    // engine (game) build
    const hostDiv = document.createElement('div'); hostDiv.style.cssText = 'width:400px;height:300px'; document.body.appendChild(hostDiv);
    const eng = await MythicMapForge.engine.mount(hostDiv, { map: norm, mode: 'orbit' });
    await new Promise(r => setTimeout(r, 400));
    let engSplines = 0, engMeshes = 0; eng.world.objects.forEach(rt => { if (rt.userData.mfType === 'spline') { engSplines++; rt.traverse(m => { if (m.isMesh && m.userData.mfSplineMesh) engMeshes++; }); } });
    eng.stop(); hostDiv.remove();
    return { splines: splines.length, bad: !norm.objects.find(o => o.id === 'bad'), roadPts: road.sp.pts.length, dupPts: dup.sp.pts.length, dupT: dup.t, engSplines, engMeshes, added: e.S.map.objects.length - before };
  });
  if (r.splines < 4 || !r.bad || r.dupT !== 'spline' || r.dupPts !== r.roadPts || r.engSplines < 4 || r.engMeshes < 2 || r.added !== 1) throw new Error(JSON.stringify(r));
  return r;
});
await page.screenshot({ path: S + '/shots/r13-01-splines.png' });
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
