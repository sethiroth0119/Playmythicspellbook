/* Screenshots of the merged editor for the merge report: the FILES tab, the
   MENU tab, the Library with thumbnails, the battle-board game scene. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const S = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.goto('http://127.0.0.1:8765/harness2.html');
await page.waitForFunction(() => !!window.MythicMapForge && !!window.MythicMapForge.showrooms, null, { timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => MythicMapForge.open({}));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(800);
await page.click('.mf-tabs button[data-tab="files"]'); await page.waitForTimeout(600);
await page.screenshot({ path: S + '/shots/m1-files-tab.png' });
await page.click('.mf-tabs button[data-tab="menu"]'); await page.waitForTimeout(600);
await page.screenshot({ path: S + '/shots/m2-menu-tab.png' });
await page.click('.mf-tabs button[data-tab="scene"]'); await page.waitForTimeout(400);
await page.evaluate(() => { const e = MythicMapForge.editor(); if (e.library && e.library.setView) try { e.library.setView('grid'); } catch (x) {} });
await page.waitForTimeout(1500);
await page.screenshot({ path: S + '/shots/m3-scene-library.png' });
await page.evaluate(async () => { await MythicMapForge.close(); });
await page.waitForTimeout(300);
await page.evaluate(() => MythicMapForge.open({ game: 'battle' }));
await page.waitForSelector('#mf-root'); await page.waitForFunction(() => !document.querySelector('.mf-loading'), null, { timeout: 40000 }); await page.waitForTimeout(1200);
await page.screenshot({ path: S + '/shots/m4-battle-scene.png' });
console.log('shots written');
await browser.close();
