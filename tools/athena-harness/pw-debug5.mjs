/* Report every console error WITH its source location, and the state pw-test5/6 wait for. */
import { createRequire } from 'module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/playwright/package.json')('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const pg = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = [];
pg.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning') { const l = m.location() || {}; out.push(t + ': ' + m.text().slice(0, 200) + '  @ ' + (l.url || '?') + ':' + (l.lineNumber || '?')); } });
pg.on('pageerror', e => out.push('pageerror: ' + (e.stack || e.message).slice(0, 500)));
pg.on('requestfailed', r => out.push('requestfailed: ' + r.url()));
pg.on('response', r => { if (r.status() >= 400) out.push('http ' + r.status() + ': ' + r.url()); });
await pg.goto('http://127.0.0.1:8765/harness2.html');
await pg.waitForTimeout(4000);
const st = await pg.evaluate(() => ({ MF: !!window.MythicMapForge, farm: !!window.MythicFarm, farmReady: !!(window.MythicFarm && window.MythicFarm.ready && window.MythicFarm.ready()), games: window.MythicMapForge && window.MythicMapForge.games ? window.MythicMapForge.games.list().map(g => g.id) : null, AthenaUI: !!window.AthenaUI, battle: !!window.MythicBattleAthena }));
console.log(JSON.stringify(st));
console.log(out.join('\n') || '(no errors)');
await browser.close();
