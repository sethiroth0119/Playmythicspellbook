import { createRequire } from 'module';
import { readFileSync } from 'fs';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const S = new URL('.', import.meta.url).pathname.replace(/\/$/, '');   // this folder; setup.sh creates three/, www/, shots/, artifact/ here
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
// serve the artifact page with the CDN scripts swapped for local copies
await page.route('**/*', async (route) => {
  const u = route.request().url();
  const local = { 'three.js/r128/three.min.js': '/three/three.min.js', 'controls/OrbitControls.js': '/three/js/controls/OrbitControls.js', 'controls/TransformControls.js': '/three/js/controls/TransformControls.js', 'loaders/GLTFLoader.js': '/three/js/loaders/GLTFLoader.js' };
  for (const k in local) if (u.includes(k) && !u.startsWith('http://127.0.0.1')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(S + local[k], 'utf8') });
  if (u.includes('fonts.googleapis')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return route.continue();
});
await page.goto('http://127.0.0.1:8765/artifact/worldforge.html');
await page.screenshot({ path: S + '/shots/art-landing.png' });
await page.click('#open');
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 40000 });
await page.waitForTimeout(500);
const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
await page.keyboard.press('2'); await page.mouse.move(cx - 40, cy); await page.mouse.down(); for (let i = 0; i < 8; i++) { await page.mouse.move(cx - 40 + i * 8, cy); await page.waitForTimeout(40); } await page.mouse.up();
await page.click('#mf-cats button[data-cat="Models"]');
await page.setInputFiles('#mf-glb-file', S + '/three/models/Flamingo.glb'); await page.waitForFunction(() => /Flamingo ready/.test(document.querySelector('.mf-toast').textContent), null, { timeout: 15000 });
await page.keyboard.press('4'); await page.mouse.move(cx, cy - 30); await page.waitForTimeout(80); await page.mouse.click(cx, cy - 30);
await page.click('.mf-tabs button[data-tab="maps"]'); await page.fill('#mf-game', 'card-shop'); await page.click('#mf-save'); await page.waitForTimeout(400);
await page.waitForSelector('.mf-map'); await page.click('.mf-map [data-act="live"]'); await page.waitForTimeout(400);
await page.screenshot({ path: S + '/shots/art-editor.png' });
const st = await page.evaluate(() => { const e = AthenaEngine.editor(); return { objs: e.S.map.objects.length, assets: e.S.map.assets.length, rightRailLeft: document.querySelector('.mf-right').getBoundingClientRect().left, canvasRight: document.querySelector('.mf-canvas').getBoundingClientRect().right, tabs: [...document.querySelectorAll('.mf-tabs button')].map(b => b.getBoundingClientRect().left | 0), status: document.getElementById('status').textContent }; });
console.log(JSON.stringify(st)); console.log('errors', errs);
await browser.close();
