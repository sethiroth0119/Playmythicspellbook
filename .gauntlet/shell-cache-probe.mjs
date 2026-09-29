/* ══════════════════════════════════════════════════════════════════════════
   SHELL CACHE PROBE — sw.js serveShell().

   1. first visit downloads index.html (nothing stored yet)
   2. a repeat visit, same build → the page comes from the service worker and
      NO full index.html download happens
   3. version.txt announces a NEW build → the next open downloads the page
      again (a deploy is never hidden behind the stored copy)
   4. the page that loads is a working game page each time

   Usage: node .gauntlet/shell-cache-probe.mjs [base]   (default :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8787';
const b = await chromium.launch();
const ctx = await b.newContext();
let fakeVer = null;
await ctx.route('**/version.txt*', async (r) => {
  if (!fakeVer) return r.continue();
  return r.fulfill({ status: 200, contentType: 'text/plain', body: fakeVer });
});
const R = [];
const ok = (l, c, d) => R.push({ l, c: !!c, d });

async function open(label) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  let doc = null;
  cdp.on('Network.responseReceived', (e) => { if (e.type === 'Document' && !doc) doc = { sw: !!e.response.fromServiceWorker, status: e.response.status, fromStore: Object.keys(e.response.headers || {}).some(k => k.toLowerCase() === 'x-shell-version') }; });
  let bigHtml = 0;
  ctx.on('requestfinished', async (rq) => {
    try { const u = new URL(rq.url()); if (u.pathname === '/' && rq.resourceType() !== 'document') bigHtml++; } catch (e) {}
  });
  const t = Date.now();
  await p.goto(base + '/', { waitUntil: 'load', timeout: 120000 });
  const ms = Date.now() - t;
  const good = await p.evaluate(() => typeof window._mmMount === 'function' && typeof window.BUILD_VERSION === 'string');
  await p.waitForTimeout(4000);   // let waitUntil store the shell
  const stored = await p.evaluate(async () => {
    const c = await caches.open('mythic-shell'); const m = await c.match('/__shell__');
    return m ? m.headers.get('x-shell-version') : null;
  });
  await p.close();
  return { label, ms, doc, good, stored };
}

const a = await open('first');
ok('1 first visit: the game page works', a.good);
ok('1b first visit came from the network', a.doc && !a.doc.fromStore, JSON.stringify(a.doc));
const b1 = await open('second');
ok('1c second open (worker now in control) stores the shell with its build tag', b1.stored && /^v/.test(b1.stored), b1.stored);
const b2 = await open('repeat');
ok('2 repeat, same build: page served from the stored shell', b2.doc && b2.doc.fromStore, JSON.stringify(b2.doc));
ok('2b …and it is a working game page', b2.good);
fakeVer = 'v999-new-build';
const c = await open('new-build');
ok('3 new build announced: page downloaded, NOT the stored copy', c.doc && !c.doc.fromStore, JSON.stringify(c.doc));
ok('3b …working page', c.good);
await b.close();
let f = 0;
for (const r of R) { if (!r.c) f++; console.log((r.c ? '  ok   ' : '  FAIL ') + r.l + (r.c ? '' : '  ← ' + r.d)); }
console.log([a, b1, b2, c].map(x => x.label + ' ' + x.ms + 'ms store=' + (x.doc && x.doc.fromStore)).join(' | '));
console.log(f ? f + ' FAILED' : 'ALL ' + R.length + ' PASS');
process.exit(f ? 1 : 0);
