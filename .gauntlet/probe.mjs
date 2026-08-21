/* Gauntlet probe — run JS inside the STAGE IFRAME and print the result.
   node .gauntlet/probe.mjs "<url-path>" "<expr-file.js>" [w] [h]
   The expression file's contents are evaluated inside the board iframe. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [pathArg, exprFile, w = '1600', h = '900'] = process.argv.slice(2);
const src = fs.readFileSync(exprFile, 'utf8');
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const srv = spawn('/opt/node22/bin/npx', ['http-server', 'public', '-p', String(port), '-s', '-c-1'], { cwd: '/home/user/Playmythicspellbook', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0,300)); });
await page.goto(`http://127.0.0.1:${port}${pathArg}`, { waitUntil: 'load', timeout: 45000 });
try { await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 30000 }); }
catch(e){ console.log('WARN not ready'); }
const fr = page.frames().find(f => f !== page.mainFrame()) || page.mainFrame();
const r = await fr.evaluate(new Function('return (' + JSON.stringify(src) + ')')() ? src : src).catch(e => 'EVAL ERROR ' + e.message);
console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
if (errs.length) console.log('ERRORS:\n' + errs.slice(0,10).join('\n'));
await browser.close(); srv.kill(); process.exit(0);
