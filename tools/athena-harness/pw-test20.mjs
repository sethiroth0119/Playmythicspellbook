/* 👕 Player Closet (round 20): the fit engine on a real rig (Soldier.glb,
   Mixamo bones), the creator (categories swing the camera, try-on, buy &
   equip, save), the studio (auto-fit, save to the device), the packet form,
   and a hub-style avatar dressed through createAvatar. harness3.html.
   Run:  node tools/athena-harness/serve.mjs & node tools/athena-harness/pw-test20.mjs */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || new URL('../../node_modules/playwright/package.json', import.meta.url).pathname)('playwright');
const exe = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text()); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
let fails = 0;
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r === undefined ? '' : JSON.stringify(r)); } catch (e) { fails++; console.log('✘', name, e.message); } };
await page.goto('http://127.0.0.1:8765/harness3.html');
await page.waitForFunction(() => !!window.MythicCloset && !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());

/* the catalogue on this device: one rigged body (Soldier), a brand, and a duck in every category */
await step('seed: a brand, a rigged body and eight pieces on this device', async () => {
  return await page.evaluate(async () => {
    const C = window.MythicCloset;
    await C.brands.put({ id: 'br_plain', name: 'Plainstock', tagline: 'Everyday, everywhere', logo: '🏬', color: '#e7c757' });
    await C.bodies.put({ id: 'cb_soldier', name: 'Soldier', url: '/models/Soldier.glb', scale: 1, faces: '-z', anim: { idle: 'Idle' } });   // the three.js Soldier already looks down −z
    const cats = ['hat', 'shirt', 'backpack', 'sneakers', 'watch', 'earrings', 'chain', 'gloves', 'scarf'];
    for (const cat of cats) await C.items.put({ id: 'ci_' + cat, brand: 'br_plain', cat, name: 'Duck ' + cat, url: '/models/Duck.glb', price: cat === 'hat' ? 0 : 120, currency: cat === 'hat' ? 'free' : 'gems' });
    await C.items.put({ id: 'ci_draft', brand: 'br_plain', cat: 'hat', name: 'Draft hat', url: '/models/Duck.glb', published: false });
    const cat = await C.catalog(true);
    return { brands: cat.brands.length, bodies: cat.bodies.length, items: cat.items.length, cloud: cat.cloud };
  });
});
await step('the outfit packet round-trips and drops unknown slots', async () => {
  return await page.evaluate(() => {
    const C = window.MythicCloset;
    const s = C.packOutfit({ body: 'cb_soldier', wear: { hat: 'ci_hat', watch: 'ci_watch', bogus: 'x', shirt: 'bad id!' } });
    const o = C.unpackOutfit(s);
    if (s !== 'cb_soldier|hat=ci_hat,watch=ci_watch') throw new Error(s);
    if (o.body !== 'cb_soldier' || Object.keys(o.wear).length !== 2) throw new Error(JSON.stringify(o));
    if (C.unpackOutfit('garbage').body !== '') throw new Error('garbage parsed');
    return s;
  });
});
await step('open the Player Closet: the store panel, nine categories, the body select', async () => {
  await page.evaluate(() => MythicCloset.open());
  await page.waitForSelector('#closet-root');
  await page.waitForFunction(() => !!(window.MythicCloset.isOpen() && document.querySelector('#cl-cats button')), null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ cats: document.querySelectorAll('#cl-cats button').length, body: document.querySelector('#cl-body').value, tabs: Array.from(document.querySelectorAll('.cl-tabs button')).map(b => b.dataset.tab) }));
  if (r.cats !== 9 || r.body !== 'cb_soldier' || r.tabs.join() !== 'wardrobe,shop') throw new Error(JSON.stringify(r));
  return r;
});
await step('the body loads and is MEASURED bone by bone (Mixamo rig: head, neck, chest, hands, feet)', async () => {
  const r = await page.evaluate(async () => {
    // the creator does not expose its stage; drive the measurement directly on the same model
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset;
    const tpl = await C.loadModel(THREE, '/models/Soldier.glb');
    const scene = new THREE.Scene(); const body = C.cloneModel(tpl); scene.add(body);
    const bb = new THREE.Box3().setFromObject(body); body.position.y = -bb.min.y; body.updateMatrixWorld(true);
    const m = C.measure(THREE, body);
    window.__soldierMeas = { height: m.height, head: [m.parts.head.size.x, m.parts.head.size.y], wrist: m.parts['wrist.l'].size.x, foot: m.parts['foot.l'].size.z, chest: m.parts.chest.size.x, bones: Object.keys(m.bones), skinned: m.skinned, headVirtual: m.parts.head.virtual, handBone: m.parts['hand.l'].bone && m.parts['hand.l'].bone.name };
    return window.__soldierMeas;
  });
  if (!r.skinned) throw new Error('no skinned mesh measured');
  for (const k of ['head', 'neck', 'chest', 'hips', 'hand.l', 'hand.r', 'foot.l', 'foot.r']) if (!r.bones.includes(k)) throw new Error('bone family ' + k + ' not found: ' + r.bones.join(','));
  if (r.headVirtual) throw new Error('head fell back to proportions');
  if (!(r.height > 1.5 && r.height < 2.1)) throw new Error('height ' + r.height);
  if (!(r.head[0] > 0.1 && r.head[0] < 0.35)) throw new Error('head width ' + r.head[0]);
  if (!(r.wrist > 0.03 && r.wrist < 0.15)) throw new Error('wrist ' + r.wrist);
  if (!(r.foot > 0.15 && r.foot < 0.45)) throw new Error('foot length ' + r.foot);
  return { height: +r.height.toFixed(2), headW: +r.head[0].toFixed(3), wrist: +r.wrist.toFixed(3), foot: +r.foot.toFixed(3), chest: +r.chest.toFixed(3), handBone: r.handBone };
});
await step('picking Watches SWINGS THE CAMERA to the wrist; Hats to the head; Backpacks looks from behind', async () => {
  const before = await page.evaluate(() => { const c = document.querySelector('#closet-root canvas'); return c ? 1 : 0; });
  if (!before) throw new Error('no canvas');
  const cam = async (cat) => { await page.click('#cl-cats button[data-cat="' + cat + '"]'); await page.waitForTimeout(900); return await page.evaluate(() => { const f = document.querySelector('#cl-focus'); return { focus: f.textContent, hidden: f.hidden, cat: document.querySelector('#cl-cats button.on').dataset.cat }; }); };
  const w = await cam('watch'); if (w.hidden || !/Watches/.test(w.focus) || w.cat !== 'watch') throw new Error(JSON.stringify(w));
  const h = await cam('hat'); if (!/Hats/.test(h.focus)) throw new Error(JSON.stringify(h));
  const b = await cam('backpack'); if (!/Backpacks/.test(b.focus)) throw new Error(JSON.stringify(b));
  // the focus maths itself, on the measured rig
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset;
    const tpl = await C.loadModel(THREE, '/models/Soldier.glb'); const scene = new THREE.Scene(); const body = C.cloneModel(tpl); scene.add(body);
    const bb = new THREE.Box3().setFromObject(body); body.position.y = -bb.min.y; body.updateMatrixWorld(true);
    const m = C.measure(THREE, body);
    const fw = C.focusFor(THREE, m, C.CAT_BY_ID.watch, 'l'), fh = C.focusFor(THREE, m, C.CAT_BY_ID.hat), fb = C.focusFor(THREE, m, C.CAT_BY_ID.backpack), fs = C.focusFor(THREE, m, C.CAT_BY_ID.sneakers);
    return { watchY: fw.target.y, headY: fh.target.y, feetY: fs.target.y, height: m.height, backZ: fb.position.z - fb.target.z, hatZ: fh.position.z - fh.target.z, watchDist: fw.dist };
  });
  if (!(r.headY > r.watchY && r.watchY > r.feetY)) throw new Error('targets not ordered head > wrist > feet: ' + JSON.stringify(r));
  if (!(r.headY > r.height * 0.8)) throw new Error('head target too low ' + r.headY + ' of ' + r.height);
  if (!(r.backZ > 0 && r.hatZ < 0)) throw new Error('backpack should look from +z (behind), hat from -z (front): ' + JSON.stringify(r));
  if (!(r.watchDist < 1.2)) throw new Error('watch framing too far: ' + r.watchDist);
  return { headY: +r.headY.toFixed(2), watchY: +r.watchY.toFixed(2), feetY: +r.feetY.toFixed(2), watchDist: +r.watchDist.toFixed(2) };
});
await step('the fit: a duck as a WATCH is 1.05 wrists wide, hangs on the hand bone, faces the body axes; sneakers come in a mirrored pair; a hat sits on the head top', async () => {
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset;
    const tpl = await C.loadModel(THREE, '/models/Soldier.glb'); const scene = new THREE.Scene(); const body = C.cloneModel(tpl); scene.add(body);
    const bb = new THREE.Box3().setFromObject(body); body.position.y = -bb.min.y; body.updateMatrixWorld(true);
    const cat = await C.catalog(true);
    const d = C.dress(THREE, body, { body: 'cb_soldier', wear: { watch: 'ci_watch', sneakers: 'ci_sneakers', hat: 'ci_hat' } }, cat);
    await new Promise(r => setTimeout(r, 1500));
    const m = d.meas;
    const w = d.pieces.get('watch'), sl = d.pieces.get('sneakers.l'), sr = d.pieces.get('sneakers.r'), h = d.pieces.get('hat');
    if (!w || !sl || !sr || !h) throw new Error('pieces: ' + Array.from(d.pieces.keys()).join(','));
    body.updateMatrixWorld(true);
    const wb = new THREE.Box3().setFromObject(w.obj), ws = new THREE.Vector3(); wb.getSize(ws);
    const hb = new THREE.Box3().setFromObject(h.obj), hs = new THREE.Vector3(); hb.getSize(hs);
    const slb = new THREE.Box3().setFromObject(sl.obj), srb = new THREE.Box3().setFromObject(sr.obj); const slc = new THREE.Vector3(), src = new THREE.Vector3(); slb.getCenter(slc); srb.getCenter(src);
    // the socket's world axes should match the scene's (body-aligned) axes
    const q = new THREE.Quaternion(); w.socket.getWorldQuaternion(q); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return { wristW: m.parts['wrist.l'].size.x, watchW: ws.x, watchBone: w.socket.parent.name, socketUp: up.y, headTop: m.parts.head.max.y, hatBottom: hb.min.y, hatW: hs.x, headW: m.parts.head.size.x, shoeLx: slc.x, shoeRx: src.x, shoeLy: slc.y, mirror: sr.obj.scale.x < 0, keys: Array.from(d.pieces.keys()) };
  });
  if (!/hand/i.test(r.watchBone)) throw new Error('watch not on a hand bone: ' + r.watchBone);
  if (Math.abs(r.watchW / r.wristW - 1.05) > 0.08) throw new Error('watch width ' + r.watchW + ' vs wrist ' + r.wristW + ' (want 1.05×)');
  if (r.socketUp < 0.98) throw new Error('socket not body-aligned: up.y=' + r.socketUp);
  if (Math.abs(r.hatBottom - r.headTop) > 0.03) throw new Error('hat bottom ' + r.hatBottom + ' vs head top ' + r.headTop);
  if (Math.abs(r.hatW / r.headW - 1.08) > 0.08) throw new Error('hat width ratio ' + (r.hatW / r.headW));
  // a body facing −z has its left at −x
  if (!(r.shoeLx < 0 && r.shoeRx > 0) || !r.mirror) throw new Error('sneakers not a mirrored pair: ' + JSON.stringify(r));
  if (r.shoeLy > 0.35) throw new Error('shoe too high: ' + r.shoeLy);
  return { wristW: +r.wristW.toFixed(3), watchW: +r.watchW.toFixed(3), bone: r.watchBone, hatW: +r.hatW.toFixed(3), headW: +r.headW.toFixed(3), keys: r.keys };
});
await step('the fit is PORTABLE: the same records on a body twice the size wear a watch twice as wide', async () => {
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset; const cat = await C.catalog(true);
    const tpl = await C.loadModel(THREE, '/models/Soldier.glb');
    const one = async (scale) => { const scene = new THREE.Scene(); const body = C.cloneModel(tpl); scene.add(body); body.scale.setScalar(scale); body.updateMatrixWorld(true); const d = C.dress(THREE, body, { body: 'cb_soldier', wear: { watch: 'ci_watch' } }, cat); await new Promise(r => setTimeout(r, 900)); const w = d.pieces.get('watch'); body.updateMatrixWorld(true); const s = new THREE.Vector3(); new THREE.Box3().setFromObject(w.obj).getSize(s); return s.x; };
    const a = await one(1), b = await one(2);
    return { a, b, ratio: b / a };
  });
  if (Math.abs(r.ratio - 2) > 0.1) throw new Error('ratio ' + r.ratio);
  return { small: +r.a.toFixed(3), big: +r.b.toFixed(3) };
});
await step('a model with NO skeleton still gets parts by proportion, so every category has somewhere to hang', async () => {
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset; const scene = new THREE.Scene();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshBasicMaterial()); body.position.y = 0.9; scene.add(body); body.updateMatrixWorld(true);
    const m = C.measure(THREE, body);
    return { skinned: m.skinned, height: m.height, headY: m.parts.head.center.y, wristVirtual: m.parts['wrist.l'].virtual, footZ: m.parts['foot.l'].size.z, parts: Object.keys(m.parts).length };
  });
  if (r.skinned || !r.wristVirtual || r.parts < 12) throw new Error(JSON.stringify(r));
  if (!(r.headY > 1.5 && r.headY < 1.8)) throw new Error('head at ' + r.headY);
  return r;
});
await step('Wardrobe shows the free hat only; Shop shows the priced duck; try-on wears it; Buy & Equip charges 120 Cinder and grants it', async () => {
  await page.click('#cl-cats button[data-cat="watch"]'); await page.waitForTimeout(300);
  let n = await page.evaluate(() => document.querySelectorAll('#cl-grid .cl-card[data-item]:not([data-item=""])').length);
  if (n !== 0) throw new Error('wardrobe should have no watches, has ' + n);
  await page.click('.cl-tabs button[data-tab="shop"]'); await page.waitForTimeout(300);
  n = await page.evaluate(() => document.querySelectorAll('#cl-grid .cl-card[data-item="ci_watch"]').length);
  if (n !== 1) throw new Error('shop watch cards ' + n);
  await page.click('#cl-grid .cl-card[data-item="ci_watch"]'); await page.waitForTimeout(300);
  const t = await page.evaluate(() => ({ status: document.querySelector('#cl-status').textContent, buy: !!document.querySelector('#cl-buy'), price: document.querySelector('#cl-selprice').textContent }));
  if (!t.buy || !/Trying/.test(t.status) || !/120/.test(t.price)) throw new Error(JSON.stringify(t));
  await page.click('#cl-buy'); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ gems: window.__profile.gems, owned: window.__profile.closet.owned, off: !!document.querySelector('#cl-off'), worn: !!document.querySelector('#cl-grid .cl-card[data-item="ci_watch"].on') }));
  if (r.gems !== 880 || !r.owned.includes('ci_watch') || !r.off || !r.worn) throw new Error(JSON.stringify(r));
  return r;
});
await step('Save outfit: the owned watch and the free hat are saved; an unowned try-on is dropped; the profile holds the body', async () => {
  await page.click('#cl-cats button[data-cat="hat"]'); await page.waitForTimeout(200);
  await page.click('#cl-grid .cl-card[data-item="ci_hat"]'); await page.waitForTimeout(200);
  await page.click('#cl-cats button[data-cat="scarf"]'); await page.waitForTimeout(200);
  await page.click('#cl-grid .cl-card[data-item="ci_scarf"]'); await page.waitForTimeout(200);
  await page.click('#cl-save'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => window.__profile.closet.outfit);
  if (!r || r.body !== 'cb_soldier' || r.wear.watch !== 'ci_watch' || r.wear.hat !== 'ci_hat' || r.wear.scarf) throw new Error(JSON.stringify(r));
  return r;
});
await step('draft items never reach the shop; Esc closes the creator', async () => {
  await page.click('#cl-cats button[data-cat="hat"]'); await page.waitForTimeout(200);
  const n = await page.evaluate(() => document.querySelectorAll('#cl-grid .cl-card[data-item="ci_draft"]').length);
  if (n) throw new Error('draft visible');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const open = await page.evaluate(() => !!document.querySelector('#closet-root'));
  if (open) throw new Error('still open');
  return 'closed';
});
await step('the STUDIO: brands, clothing and characters listed; select the watch → the fit inspector with size, offsets, rotation; Auto-fit records the body it was fitted on; save lands on the device', async () => {
  await page.evaluate(() => MythicCloset.openStudio());
  await page.waitForSelector('#closet-studio');
  await page.waitForFunction(() => document.querySelectorAll('#cs-items .cl-item').length >= 9, null, { timeout: 20000 });
  const lists = await page.evaluate(() => ({ brands: document.querySelectorAll('#cs-brands .cl-item').length, items: document.querySelectorAll('#cs-items .cl-item').length, bodies: document.querySelectorAll('#cs-bodies .cl-item').length }));
  if (lists.brands !== 1 || lists.items !== 10 || lists.bodies !== 1) throw new Error(JSON.stringify(lists));
  await page.click('#cs-items .cl-item[data-item="ci_watch"]'); await page.waitForTimeout(1500);
  const insp = await page.evaluate(() => ({ k: !!document.querySelector('#ci-k'), off: document.querySelectorAll('[data-off]').length, rot: document.querySelectorAll('[data-rot]').length, auto: !!document.querySelector('#ci-auto'), focus: document.querySelector('#cs-focus').textContent, hint: document.querySelector('#cs-insp').textContent }));
  if (!insp.k || insp.off !== 3 || insp.rot !== 3 || !insp.auto || !/Watches/.test(insp.focus)) throw new Error(JSON.stringify(insp));
  if (!/wrist is/.test(insp.hint)) throw new Error('no measurement in the fit hint: ' + insp.hint.slice(0, 300));
  await page.click('#ci-auto'); await page.waitForTimeout(400);
  const fitted = await page.evaluate(() => /Fitted against/.test(document.querySelector('#cs-insp').textContent) && /Soldier/.test(document.querySelector('#cs-insp').textContent));
  if (!fitted) throw new Error('auto-fit did not record the body');
  // a slider changes the fit live and marks it unsaved
  await page.evaluate(() => { const r = document.querySelector('#ci-k'); r.value = '1.5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => document.querySelector('#cs-state').textContent);
  if (!/unsaved/.test(st)) throw new Error('state ' + st);
  await page.click('#ci-save'); await page.waitForTimeout(800);
  const saved = await page.evaluate(async () => { const c = await MythicCloset.catalog(true); const it = c.items.find(i => i.id === 'ci_watch'); return { k: it.fit.k, ref: it.fit.ref && it.fit.ref.body, state: document.querySelector('#cs-state').textContent }; });
  if (saved.k !== 1.5 || saved.ref !== 'cb_soldier' || !/device/.test(saved.state)) throw new Error(JSON.stringify(saved));
  return saved;
});
await step('the studio makes a brand and a character; the character inspector measures the rig', async () => {
  await page.click('#cs-newbrand'); await page.waitForTimeout(200);
  await page.fill('#cb-name', 'Nudle'); await page.fill('#cb-tag', 'Search it. Wear it.'); await page.click('#cb-save'); await page.waitForTimeout(600);
  const b = await page.evaluate(async () => (await MythicCloset.catalog(true)).brands.map(x => x.name));
  if (!b.includes('Nudle')) throw new Error(b.join());
  await page.click('#cs-bodies .cl-item[data-body="cb_soldier"]'); await page.waitForTimeout(300);
  const m = await page.evaluate(() => document.querySelector('#cs-insp').textContent);
  if (!/Wrist L/.test(m) || !/skinned mesh/.test(m)) throw new Error('measurements missing: ' + m.slice(0, 200));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  return b;
});
await step('a hub-style avatar (createAvatar with an outfit) is dressed; a map with NO character draws the closet body', async () => {
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const { createAvatar } = await import('/src/mapforge/mapforge.avatar.js');
    const scene = new THREE.Scene();
    const av = createAvatar(THREE, { world: null, scene, outfit: { body: 'cb_soldier', wear: { hat: 'ci_hat', watch: 'ci_watch' } }, player: { model: null, anim: {} } });
    const t0 = Date.now(); while (!av.ready && !av.error && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1200));
    av.update(0.016, new THREE.Vector3(3, 0, 4), 1.2, 'walk');
    let pieces = 0, bones = 0; av.group.traverse(o => { if (/^closet:/.test(o.name)) pieces++; if (o.isBone) bones++; });
    const y = av.group.position.y, x = av.group.position.x;
    av.dispose();
    return { ready: av.ready, error: av.error, pieces, bones, x, clips: av.clipNames().length };
  });
  if (!r.ready || r.pieces !== 2 || !r.bones || r.x !== 3) throw new Error(JSON.stringify(r));
  return r;
});
await step('engine.mount wears the outfit on the map author\'s character too', async () => {
  const r = await page.evaluate(async () => {
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px'; document.body.appendChild(host);
    const map = MythicMapForge.format.newMap({ name: 't' });
    map.assets = [{ id: 'a_s', label: 'Soldier', url: '/models/Soldier.glb' }];
    map.player = { view: 'tps', model: { a: 'a_s', scale: 1, faces: '-z' }, anim: {}, animFiles: [], cast: [] };
    const g = await MythicMapForge.engine.mount(host, { map, mode: 'fps', pointerLock: false, outfit: { body: '', wear: { hat: 'ci_hat' } } });
    const t0 = Date.now(); while (!(g.avatar && g.avatar.ready) && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 1200));
    let pieces = 0; g.avatar.group.traverse(o => { if (/^closet:/.test(o.name)) pieces++; });
    const view = g.view; g.stop(); host.remove();
    return { pieces, view };
  });
  if (r.pieces !== 1 || r.view !== 'tps') throw new Error(JSON.stringify(r));
  return r;
});

await step('character.spawn gives any scene the dressed closet body; replace() takes a stand-in\'s place and hides it; a saved outfit rebuilds a following character', async () => {
  const r = await page.evaluate(async () => {
    const { THREE } = await import('/src/mapforge/mapforge.three.js').then(m => m.ensureThree());
    const C = window.MythicCloset;
    window.__profile.closet.outfit = { body: 'cb_soldier', wear: { hat: 'ci_hat' } };
    const scene = new THREE.Scene();
    const d = await C.character.describe();
    const me = await C.character.spawn(THREE, { scene, follow: true });
    const wait = async (h) => { const t0 = Date.now(); while (!h.ready && !h.error && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 900)); };
    await wait(me);
    const count = (g) => { let n = 0; g.traverse(o => { if (/^closet:/.test(o.name)) n++; }); return n; };
    const p1 = count(me.group);
    me.update(0.016, new THREE.Vector3(1, 0, 2), 0.5, 'walk');
    // the stand-in: a capsule the train would hand over
    const standIn = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8), new THREE.MeshBasicMaterial()); standIn.position.set(4, 0, -3); standIn.rotation.y = 1.1; scene.add(standIn);
    const rep = await C.character.replace(THREE, standIn);
    await wait(rep);
    const repPos = rep.group.position.clone(), hidden = !standIn.visible;
    rep.dispose();
    const shownAgain = standIn.visible;
    // save a new outfit → the following character is rebuilt with the new pieces
    window.dispatchEvent(new CustomEvent('closet:outfit', { detail: { body: 'cb_soldier', wear: { hat: 'ci_hat', watch: 'ci_watch', sneakers: 'ci_sneakers' } } }));
    await new Promise(r => setTimeout(r, 200)); await wait(me);
    const p2 = count(me.group), pos2 = me.group.position.clone();
    me.dispose();
    const none = await C.character.spawn(THREE, { scene, outfit: { body: '', wear: {} } });
    return { body: d.body && d.body.name, p1, p2, x: pos2.x, repX: repPos.x, repZ: repPos.z, hidden, shownAgain, none };
  });
  if (r.body !== 'Soldier' || r.p1 !== 1 || r.p2 !== 4 || r.x !== 1) throw new Error(JSON.stringify(r));
  if (r.repX !== 4 || r.repZ !== -3 || !r.hidden || !r.shownAgain || r.none !== null) throw new Error(JSON.stringify(r));
  return r;
});

const errs = await page.evaluate(() => window.__errors);
console.log('\npage errors:', errs.length ? errs : 'none');
console.log('console:', logs.filter(l => !/favicon|WebGL|GPU stall|swiftshader|Automatic fallback/i.test(l)).slice(0, 12));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
