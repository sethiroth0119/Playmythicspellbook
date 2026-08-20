/* Gauntlet capture rig — screenshot the battle stage headlessly.
   node .gauntlet/shot.mjs <url-path> <out.png> [width] [height] [waitMs]
   Serves ./public on a random port, drives real Chromium, writes a PNG.

   READINESS. `waitMs` is a guess, and a guess is wrong in both directions: too
   short and you capture a half-decoded board, too long and every capture costs
   the extra seconds. So: if the page publishes `window.__harnessReady` (see
   public/battle-board/_harness.html), wait for that instead — a real signal
   meaning the stage reported board:ready, the scenario was pushed, and a full
   second of animation actually rendered. Pages that publish nothing (the
   stage's own standalone demo, the game itself) keep the fixed delay exactly
   as before, so the CLI contract is unchanged.                              */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const [pathArg = '/battle-board/index.html', out = 'shot.png', w = '1600', h = '900', waitMs = '2600'] = process.argv.slice(2);

const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const srv = spawn('/opt/node22/bin/npx', ['http-server', 'public', '-p', String(port), '-s', '-c-1'], { cwd: '/home/user/Playmythicspellbook', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}${pathArg}`, { waitUntil: 'load', timeout: 45000 });

/* Probe for the signal rather than assuming it. A harness declares
   `window.__harnessReady = false` before anything else can throw, so presence
   is knowable almost immediately; 1.5s is generous headroom for a slow parse.
   Absence is not an error — it just means "fall back to the fixed delay". */
let hasSignal = false, stalled = false;
try {
  await page.waitForFunction(() => typeof window.__harnessReady !== 'undefined', null, { timeout: 1500 });
  hasSignal = true;
} catch (e) { /* no signal on this page — fixed delay below */ }

if (hasSignal) {
  try {
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 30000 });
    const deg = await page.evaluate(() => window.__harnessDegraded || null).catch(() => null);
    console.log(deg ? 'ready (DEGRADED: ' + deg + ')' : 'ready via __harnessReady');
  } catch (e) {
    /* Capture anyway — a picture of the stall is more useful than no picture.
       But EXIT NON-ZERO for it: a stalled capture that exits 0 is
       indistinguishable from a good one to any script, and the whole point of
       the readiness signal is that a capture is not a guess. The PNG is still
       written, so a human can look at the stall; a caller in a loop sees the
       failure. */
    console.log('WARN __harnessReady never went true within 30s — capturing anyway');
    stalled = true;
  }
} else {
  await page.waitForTimeout(+waitMs);
}

await page.screenshot({ path: out });
console.log('WROTE ' + out);
if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 25).join('\n'));
else console.log('no page errors');
await browser.close();
srv.kill();
process.exit(stalled ? 1 : 0);
