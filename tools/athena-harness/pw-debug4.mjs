/* List the content browser's tree node ids (for pw-test17's Content/Props/Nature click). */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = [];
page.on('pageerror', e => out.push('pageerror: ' + (e.stack || e.message).slice(0, 300)));
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({}));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(500);
const r = await page.evaluate(async () => {
  const e = MythicMapForge.editor(); e.content.toggle(true); await new Promise(r => setTimeout(r, 400));
  return { nodes: Array.from(document.querySelectorAll('#mf-cb .mf-cb-node')).map(n => n.dataset.node), cb: !!document.querySelector('#mf-cb'), open: document.querySelector('#mf-cb') && document.querySelector('#mf-cb').className };
});
console.log(JSON.stringify(r));
console.log(out.join('\n') || '(no page errors)');
await browser.close();
