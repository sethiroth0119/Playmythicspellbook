import { createRequire } from 'module';
const __req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = __req('playwright')); } catch (e) { ({ chromium } = __req(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright')); }
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:8765/harness.html');
await page.waitForFunction(() => !!window.MythicMapForge);
await page.evaluate(() => { window.MF_THREE_URLS = { core: ['/three/three.min.js'], addons: {} }; });
await page.evaluate(() => MythicMapForge.open({ map: MythicMapForge.format.newMap({ name: 'fallback' }) }));
await page.waitForFunction(() => document.getElementById('mf-root') && !document.querySelector('.mf-loading'), null, { timeout: 30000 });
await page.waitForTimeout(500);
const cv = await page.$('.mf-canvas canvas'); const bb = await cv.boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
console.log('addons present?', await page.evaluate(() => ({ orbit: !!window.THREE.OrbitControls, tc: !!window.THREE.TransformControls, gizmo: !!MythicMapForge.editor().gizmo })));
await page.keyboard.press('4'); await page.click('#mf-cats button[data-cat="Structures"]'); await page.click('#mf-props button[data-prop="house"]'); await page.mouse.move(cx, cy); await page.mouse.click(cx, cy);
const proj = await page.evaluate(([bx, by, bw, bh]) => { const e = MythicMapForge.editor(); const T = window.THREE; const o = e.S.map.objects[0]; const v = new T.Vector3(o.p[0], o.p[1] + 1.2, o.p[2]).project(e.camera); return { x: (v.x + 1) / 2 * bw + bx, y: (1 - v.y) / 2 * bh + by, p: o.p.map(n => +n.toFixed(2)) }; }, [bb.x, bb.y, bb.width, bb.height]);
await page.keyboard.press('1'); await page.mouse.move(proj.x, proj.y); await page.mouse.down(); await page.mouse.move(proj.x + 120, proj.y, { steps: 6 }); await page.mouse.up();
const after = await page.evaluate(() => { const e = MythicMapForge.editor(); const o = e.S.map.objects[0]; return { sel: e.S.selectedId, p: o.p.map(n => +n.toFixed(2)), undo: e.S.undo.length }; });
console.log('before', proj.p, 'after', after);
// right-drag orbit with the built-in fallback controls
const cam0 = await page.evaluate(() => MythicMapForge.editor().camera.position.toArray().map(n => +n.toFixed(1)));
await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 150, cy + 40, { steps: 5 }); await page.mouse.up({ button: 'right' });
await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
const cam1 = await page.evaluate(() => MythicMapForge.editor().camera.position.toArray().map(n => +n.toFixed(1)));
console.log('orbit fallback cam', cam0, '->', cam1);
await browser.close();
