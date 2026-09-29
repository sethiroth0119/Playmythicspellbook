/* Drive the real Highway Haul run headless: which way the rig model faces,
   which side lights when you steer, and how much traffic is on the road over
   a long drive. node tools/athena-harness/pw-haul.mjs [cond] [seconds]
   (serve.mjs must be running on 8765; PLAYWRIGHT_PKG as for the other tests) */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const H = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const cond = process.argv[2] || 'Clean', secs = +(process.argv[3] || 60), model = process.argv[4] || '', tag = cond + (model ? '-' + model.split('/').pop().replace('.glb', '') : '');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pg = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errs = []; pg.on('pageerror', (e) => errs.push('pageerror ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 200)); });
await pg.goto('http://127.0.0.1:8765/haul.html?cond=' + cond + (model ? '&model=' + encodeURIComponent(model) : ''));
await pg.waitForFunction(() => (window.__HAUL_DEBUG.run && window.__HAUL_DEBUG.run.S.started) || window.__HAUL_DEBUG.err, null, { timeout: 60000 });
if (await pg.evaluate(() => window.__HAUL_DEBUG.err)) { console.log('ERR', await pg.evaluate(() => window.__HAUL_DEBUG.err)); process.exit(1); }
await pg.waitForFunction(() => window.__HAUL_DEBUG.run.rig.children.some((c) => c.userData.rigModel), null, { timeout: 60000 }).catch(() => console.log('model never landed'));
await pg.waitForTimeout(1500);
/* facing: where the model's cab (its tallest vertices) is, in screen space, versus its tail */
const probe = () => pg.evaluate(() => {
  const R = window.__HAUL_DEBUG.run, V = R.cam.position.constructor;
  const truck = R.rig.children.find((c) => c.userData.rigModel);
  const proj = (p) => { const v = p.clone().project(R.cam); return { x: Math.round((v.x + 1) * 500), y: Math.round((1 - v.y) * 380) }; };
  const out = { S: { z: Math.round(R.S.z), x: +R.S.x.toFixed(2), speed: Math.round(R.S.speed) }, halfL: R.halfL };
  if (truck) {
    truck.updateMatrixWorld(true);
    let hi = null, hiY = -1e9, loNose = null; const v = new V(), w = new V();
    truck.traverse((o) => { if (!o.isMesh) return; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 7) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y > hiY) { hiY = v.y; hi = v.clone(); } } });
    const c = new V(); R.rigOuter.getWorldPosition(c);
    out.cabWorldDz = +(hi.z - c.z).toFixed(2);   /* travel is toward −Z: the cab must be at NEGATIVE dz */
    out.cabScreen = proj(hi); out.rigScreen = proj(c);
  }
  const b = R.rig.userData.blink, lit = (m) => m.material && m.material.color && m.material.color.getHex() === 0xffa000;
  const side = (arr) => arr.map((m) => { const p = new V(); m.getWorldPosition(p); return { lit: lit(m), sx: proj(p).x, sy: proj(p).y }; });
  out.blinkL = side(b.L); out.blinkR = side(b.R);
  out.traffic = R.traffic.length; out.trafficAhead = R.traffic.filter((t) => t.z > R.S.z && t.z < R.S.z + 300).length;
  return out;
});
console.log('parked', JSON.stringify(await probe()));
await pg.screenshot({ path: H + '/shots/haul-' + tag + '-parked.png' });
await pg.keyboard.down('ArrowUp'); await pg.waitForTimeout(2500);
await pg.keyboard.down('ArrowLeft');
let lefts = []; for (let i = 0; i < 6; i++) { await pg.waitForTimeout(110); lefts.push(await probe()); }
await pg.screenshot({ path: H + '/shots/haul-' + tag + '-left.png' });
await pg.keyboard.up('ArrowLeft');
console.log('steer LEFT samples (lit side + screen x vs rig):', JSON.stringify(lefts.map((p) => ({ Llit: p.blinkL.some((q) => q.lit), Rlit: p.blinkR.some((q) => q.lit), Lsx: p.blinkL[0].sx, Rsx: p.blinkR[0].sx, rig: p.rigScreen && p.rigScreen.x }))));
await pg.waitForTimeout(800);
await pg.keyboard.down('ArrowRight');
let rights = []; for (let i = 0; i < 6; i++) { await pg.waitForTimeout(110); rights.push(await probe()); }
await pg.keyboard.up('ArrowRight');
console.log('steer RIGHT samples:', JSON.stringify(rights.map((p) => ({ Llit: p.blinkL.some((q) => q.lit), Rlit: p.blinkR.some((q) => q.lit), Lsx: p.blinkL[0].sx, Rsx: p.blinkR[0].sx }))));
/* long drive: traffic over time, steering gently to stay in lane */
const series = [];
for (let t = 0; t < secs; t++) {
  await pg.waitForTimeout(1000);
  const p = await probe(); series.push([t, p.S.z, p.S.speed, p.traffic, p.trafficAhead]);
  if (t % 15 === 0) await pg.screenshot({ path: H + '/shots/haul-' + tag + '-t' + t + '.png' });
}
console.log('t,z,speed,traffic,ahead300:', JSON.stringify(series));
console.log('final', JSON.stringify(await probe()));
console.log(errs.slice(0, 15).join('\n') || '(no errors)');
await browser.close();
