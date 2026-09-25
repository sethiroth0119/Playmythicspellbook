/* Load the harness, open the editor, and print every console error / page
   error / failed request — for diagnosing a harness that will not open. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const page = (process.argv[2] || 'harness2.html');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = [];
pg.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') out.push(t + ': ' + m.text().slice(0, 300)); });
pg.on('pageerror', e => out.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
pg.on('requestfailed', r => out.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
pg.on('response', r => { if (r.status() >= 400) out.push('http ' + r.status() + ': ' + r.url()); });
await pg.goto('http://127.0.0.1:8765/' + page);
await pg.waitForTimeout(3000);
const have = await pg.evaluate(() => ({ MF: !!window.MythicMapForge, AE: !!window.AthenaEngine, open: !!(window.MythicMapForge && window.MythicMapForge.open), showrooms: !!(window.MythicMapForge && window.MythicMapForge.showrooms), errors: window.__errors || [] }));
console.log('after load:', JSON.stringify(have));
try { await pg.evaluate(() => MythicMapForge.open({})); } catch (e) { out.push('open threw: ' + e.message); }
await pg.waitForTimeout(8000);
const st = await pg.evaluate(() => ({ root: !!document.querySelector('#mf-root'), loading: (document.querySelector('.mf-loading') || {}).textContent || null, errors: window.__errors || [], toasts: (window.__toasts || []).slice(-5) }));
console.log('after open:', JSON.stringify(st));
console.log(out.join('\n') || '(no console errors)');
await browser.close();
