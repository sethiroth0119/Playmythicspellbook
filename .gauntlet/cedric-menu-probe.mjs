/* ══════════════════════════════════════════════════════════════════════════
   CEDRIC MENU PROBE — does the main-menu iframe end up showing Cedric?

   Owner: "The Cedric moving image is missing here" (main menu, logged in).

   The parent only ships the roster when its signature CHANGED (App._mmCharSig).
   _mmMount() is called on every renderTitle; a second call while the new
   iframe is still about:blank posts into the blank document, which drops it,
   but the signature is already recorded — so when the real menu says mm:ready
   the roster is "unchanged" and never sent. Cedric never appears.

   Drives the real _mmMount twice in a row (what two quick renders do), then
   reads #charA/#charB inside the menu frame.

   Usage: node .gauntlet/cedric-menu-probe.mjs [candidate.html]   (:8787 up)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
if (process.argv[2]) {
  const html = fs.readFileSync(process.argv[2], 'utf8');
  await p.route('**/index.html', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}
await p.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForFunction(() => typeof window._mmMount === 'function');

const results = [];
for (const mode of ['single', 'double']) {
  await p.evaluate((mode) => {
    try { _mmTeardown(); } catch (e) {}
    App.screen = 'title'; App.titleHub = 'main'; App._mmBroken = false;
    _mmMount();
    if (mode === 'double') _mmMount();       // a second render before the frame loads
  }, mode);
  await p.waitForTimeout(6000);
  const r = await p.evaluate(() => {
    const f = document.getElementById('mm-frame');
    if (!f || !f.contentDocument) return { frame: false };
    const imgs = [...f.contentDocument.querySelectorAll('.char-img')];
    return { frame: true, ready: !!App._mmReady,
      imgs: imgs.map(i => ({ src: (i.getAttribute('src') || '').split('/').pop(), on: i.classList.contains('on') })) };
  });
  const shown = r.frame && r.imgs.some(i => i.on && /cedric/i.test(i.src));
  results.push({ mode, shown, r });
}
await b.close();
let fails = 0;
for (const x of results) { if (!x.shown) fails++; console.log((x.shown ? '  ok   ' : '  FAIL ') + 'Cedric on the menu after a ' + x.mode + ' mount   ' + JSON.stringify(x.r)); }
console.log('\n' + (fails ? fails + ' FAILED' : 'ALL ' + results.length + ' PASS'));
process.exit(fails ? 1 : 0);
