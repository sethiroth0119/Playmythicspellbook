/* Athena Engine round 11: materials and lighting. Textured terrain layers
   (shader injection, layer-index texture follows paint), material overrides
   on props and .glb models (never on the shared template), tone mapping +
   exposure on the renderer, the bloom/vignette post pass, Look controls,
   instancing exclusion, normalize. harness2.html. */
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
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'Look', game: 'look', n: 32, cell: 2 }) }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(600);

await step('terrain: splat shader compiled, atlas + layer texture bound, paint updates the layer texture', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const w = e.world; const t = w.terrain; const U = t.shaderUniforms;
    e.renderer.render(e.scene, e.camera);
    const prog = e.renderer.info.programs.find(p => p.cacheKey && /mf-terrain-splat/.test(p.cacheKey));
    const before = U.uLayer.value.image.data[0];
    t.applyBrush({ x: -t.half, z: -t.half, radius: 1, strength: 1, falloff: 0.5, mode: 'paint', paint: 4 });
    const after = U.uLayer.value.image.data[0];
    return { compiled: !!prog, atlas: U.uAtlas.value.image.width, layerW: U.uLayer.value.image.width, before, after, detail: U.uDetail.value, needsUpdate: U.uLayer.value.needsUpdate || U.uLayer.value.version > 0, mapTex: t.material.map === null };
  });
  if (!r.compiled || r.atlas !== 1024 || r.layerW !== 33 || r.before !== 0 || r.after !== 4 || !r.mapTex) throw new Error(JSON.stringify(r));
  return r;
});
await step('Look: env fields default, sliders drive tone mapping / exposure on the renderer, terrain detail uniform', async () => {
  await page.click('.mf-tabs button[data-tab="sky"]');
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const env = e.S.map.env; const T = e.S.THREE;
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
    set('mf-e-exposure', 1.6); set('mf-e-terrainDetail', 0.3); document.getElementById('mf-e-tone').value = 'reinhard'; document.getElementById('mf-e-tone').dispatchEvent(new Event('change'));
    return { tone: env.tone, exposure: env.exposure, rTone: e.renderer.toneMapping === T.ReinhardToneMapping, rExp: e.renderer.toneMappingExposure, detailU: e.world.terrain.shaderUniforms.uDetail.value, defaults: [env.bloom, env.vignette, env.bloomThreshold] };
  });
  if (r.tone !== 'reinhard' || r.exposure !== 1.6 || !r.rTone || r.rExp !== 1.6 || Math.abs(r.detailU - 0.3) > 1e-6 || r.defaults.join() !== '0,0,0.75') throw new Error(JSON.stringify(r));
  return r;
});
await step('post pass: bloom renders through the composite (targets allocated), bloom 0 bypasses; Low quality skips it', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const env = e.S.map.env;
    const rt0 = e.renderer.info.memory.textures;
    document.getElementById('mf-e-bloom').value = 0.8; document.getElementById('mf-e-bloom').dispatchEvent(new Event('input'));
    // drive two frames manually through the same call the loop uses
    const { createPost } = window.__postMod || {}; return null;
  });
  const r2 = await page.evaluate(async () => {
    const mod = await import('/src/mapforge/mapforge.post.js'); const e = MythicMapForge.editor(); const post = mod.createPost(e.S.THREE, e.renderer);
    const used = post.render(e.scene, e.camera, { bloom: 0.8, threshold: 0.6, vignette: 0.3 });
    const gl = e.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const bypass = post.render(e.scene, e.camera, { bloom: 0, vignette: 0 });
    post.enabled = false; const off = post.render(e.scene, e.camera, { bloom: 1, vignette: 1 });
    post.dispose();
    MythicMapForge.quality.set('low'); const q = MythicMapForge.quality.get().settings.post; MythicMapForge.quality.set('auto');
    return { used, centre: Array.from(px), bypass, off, lowPost: q };
  });
  if (!r2.used || r2.bypass || r2.off || r2.lowPost !== false || (r2.centre[0] + r2.centre[1] + r2.centre[2]) === 0) throw new Error(JSON.stringify(r2));
  return r2;
});
await step('material override: prop → cloned material with the knobs; template untouched; reset restores; excluded from instancing', async () => {
  const r = await page.evaluate(() => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    const add = (o) => { m.objects.push(o); w.addObject(o); return o; };
    const a = add({ id: 'o_a', t: 'lantern', p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true });
    const b = add({ id: 'o_b', t: 'lantern', p: [3, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true });
    document.querySelector('.mf-tabs button[data-tab="object"]').click(); e.S.selectedId = a.id; e.S.multi.clear(); e.S.multi.add(a.id); e.refresh();
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
    set('mf-o-metal', 0.9); set('mf-o-em', '#ff8800'); set('mf-o-ei', 3);
    const meshA = [], meshB = []; w.objects.get('o_a').traverse(x => { if (x.isMesh) meshA.push(x); }); w.objects.get('o_b').traverse(x => { if (x.isMesh) meshB.push(x); });
    const shared = meshA.some(x => meshB.some(y => y.material === x.material));
    const out = { mat: a.mat, metalA: meshA[0].material.metalness, emA: '#' + meshA[0].material.emissive.getHexString(), eiA: meshA[0].material.emissiveIntensity, metalB: meshB[0].material.metalness, shared, resetBtn: !!document.getElementById('mf-o-mat-reset') };
    document.getElementById('mf-o-mat-reset').click();
    out.afterReset = { mat: a.mat, metalA: meshA[0].material.metalness, sharedAgain: meshA.some(x => meshB.some(y => y.material === x.material)) };
    return out;
  });
  // the lantern template's own metalness is 0.5 (the metal post): B keeps it, A returns to it after Reset
  if (!r.mat || r.metalA !== 0.9 || r.emA !== '#ff8800' || r.eiA !== 3 || r.metalB !== 0.5 || r.shared || !r.resetBtn || r.afterReset.mat || r.afterReset.metalA !== 0.5 || !r.afterReset.sharedAgain) throw new Error(JSON.stringify(r));
  return r;
});
await step('material override on a .glb applies after the model loads', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    m.assets.push({ id: 'a_duck', label: 'Duck', url: '/models/Duck.glb' });
    const o = { id: 'o_duck', t: 'glb', a: 'a_duck', p: [6, 0, 0], r: [0, 0, 0], s: [1, 1, 1], g: true, mat: { rough: 0.1, metal: 1, em: '#2040ff', ei: 2 } };
    m.objects.push(o); w.addObject(o);
    for (let i = 0; i < 300 && w.objects.get('o_duck').userData.mfPending !== false && !w.objects.get('o_duck').userData.mfError; i++) await new Promise(r => setTimeout(r, 100));
    const meshes = []; w.objects.get('o_duck').traverse(x => { if (x.isMesh) meshes.push(x); });
    return { err: !!w.objects.get('o_duck').userData.mfError, gltf: !!e.S.THREE.GLTFLoader, loaded: w.objects.get('o_duck').userData.mfPending === false, meshes: meshes.length, rough: meshes[0] && meshes[0].material.roughness, metal: meshes[0] && meshes[0].material.metalness, keptMap: !!(meshes[0] && meshes[0].material.map), em: meshes[0] && '#' + meshes[0].material.emissive.getHexString() };
  });
  if (!r.loaded || !r.meshes || r.rough !== 0.1 || r.metal !== 1 || !r.keptMap || r.em !== '#2040ff') throw new Error(JSON.stringify(r));
  return r;
});
await step('engine: instancing skips overridden objects; renderer gets the map tone/exposure; post attached', async () => {
  const r = await page.evaluate(async () => {
    const e = MythicMapForge.editor(); const m = e.S.map; const w = e.world;
    for (let i = 0; i < 6; i++) { const o = { id: 'o_c' + i, t: 'crate', p: [i * 2, 0, 6], r: [0, 0, 0], s: [1, 1, 1], g: true, mat: i === 0 ? { metal: 1 } : undefined }; m.objects.push(o); w.addObject(o); }
    m.env.tone = 'aces'; m.env.exposure = 1.3; m.env.bloom = 0.5;
    document.getElementById('mf-save-local').click(); await new Promise(r => setTimeout(r, 300)); await MythicMapForge.close();
    const host = document.createElement('div'); host.style.cssText = 'width:400px;height:300px;position:fixed;left:0;top:0'; document.body.appendChild(host);
    const g = await MythicMapForge.engine.mount(host, { game: 'look', mode: 'orbit' });
    g.world.update(0.016, g.camera); const inst = g.world.objects.get('o_c0').userData.mfInstanced, inst1 = g.world.objects.get('o_c1').userData.mfInstanced;
    const out = { c0Instanced: !!inst, c1Instanced: !!inst1, tone: g.renderer.toneMapping === g.THREE.ACESFilmicToneMapping, exposure: g.renderer.toneMappingExposure, post: !!g.post };
    g.stop(); host.remove(); return out;
  });
  if (r.c0Instanced || !r.c1Instanced || !r.tone || r.exposure !== 1.3 || !r.post) throw new Error(JSON.stringify(r));
  return r;
});
await step('normalize: look fields clamp, mat validated', async () => page.evaluate(() => { const m = MythicMapForge.format.normalize({ env: { tone: 'weird', exposure: 99, bloom: -1, vignette: 2, terrainDetail: 'x' }, objects: [{ t: 'crate', mat: { rough: 5, metal: -1, em: 'red', ei: 100 } }, { t: 'crate', mat: {} }] }); return { tone: m.env.tone, exposure: m.env.exposure, bloom: m.env.bloom, vignette: m.env.vignette, detail: m.env.terrainDetail, mat: m.objects[0].mat, none: m.objects[1].mat }; }).then(r => { if (r.tone !== 'aces' || r.exposure !== 3 || r.bloom !== 0 || r.vignette !== 1 || r.detail !== 0.8 || r.mat.rough !== 1 || r.mat.metal !== 0 || r.mat.em || r.mat.ei !== 8 || r.none !== undefined) throw new Error(JSON.stringify(r)); return r; }));
console.log('--- page errors:', await page.evaluate(() => window.__errors));
console.log('--- console:', logs.filter(l => !/favicon|404|ledger/.test(l)).slice(0, 20));
await browser.close();
process.exit(fails ? 1 : 0);
