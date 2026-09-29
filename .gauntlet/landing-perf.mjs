/* ══════════════════════════════════════════════════════════════════════════
   LANDING PERF + CEDRIC — what the first screen costs, and whether Cedric is on it.

   Owner: "The Cedric moving image is missing here and the game is loading slow
   look into the performance and optimize the game."

   Loads a page (default: the live site) in real Chromium with the cache empty,
   records every request (bytes, type, timing), the load milestones, and finds
   every <img> whose src names cedric across ALL frames — reporting whether it
   actually decoded (naturalWidth > 0) and whether it is on screen.

   Usage: node .gauntlet/landing-perf.mjs [url] [--shot out.png] [--wait ms]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = (args[0] && !args[0].startsWith('--')) ? args[0] : 'https://playmythicspellbook.com/';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const shot = flag('shot', null);
const waitMs = +flag('wait', 12000);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const reqs = new Map();
const t0 = Date.now();
page.on('request', r => reqs.set(r, { url: r.url(), type: r.resourceType(), start: Date.now() - t0 }));
page.on('requestfinished', async r => {
  const e = reqs.get(r); if (!e) return;
  e.end = Date.now() - t0;
  try { const sz = await r.sizes(); e.bytes = (sz.responseBodySize || 0) + (sz.responseHeadersSize || 0); } catch (x) { e.bytes = 0; }
});
page.on('requestfailed', r => { const e = reqs.get(r); if (e) { e.failed = r.failure() && r.failure().errorText; e.end = Date.now() - t0; } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));

const nav = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
const dcl = Date.now() - nav;
await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
const load = Date.now() - nav;
await page.waitForTimeout(waitMs);

const timing = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0] || {};
  const paints = {}; for (const p of performance.getEntriesByType('paint')) paints[p.name] = Math.round(p.startTime);
  return { ttfb: Math.round(n.responseStart || 0), domInteractive: Math.round(n.domInteractive || 0),
           domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0), loadEvent: Math.round(n.loadEventEnd || 0),
           docBytes: n.transferSize || 0, ...paints, screen: (window.MythicBridge && window.MythicBridge.screen) ? window.MythicBridge.screen() : null };
});

/* Cedric, in every frame */
const cedric = [];
for (const f of page.frames()) {
  try {
    const found = await f.evaluate(() => [...document.querySelectorAll('img')]
      .filter(i => /cedric/i.test(i.currentSrc || i.src || ''))
      .map(i => { const r = i.getBoundingClientRect(); const cs = getComputedStyle(i);
        return { src: (i.currentSrc || i.src).split('/').pop(), complete: i.complete, natural: i.naturalWidth + 'x' + i.naturalHeight,
                 box: Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top),
                 display: cs.display, visibility: cs.visibility, opacity: cs.opacity }; }));
    for (const c of found) cedric.push({ frame: f.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60) || '(top)', ...c });
  } catch (e) {}
}
const frames = page.frames().map(f => f.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 70));
if (shot) await page.screenshot({ path: shot });

const list = [...reqs.values()];
const byType = {};
for (const r of list) { const k = r.type; byType[k] = byType[k] || { n: 0, bytes: 0 }; byType[k].n++; byType[k].bytes += r.bytes || 0; }
const total = list.reduce((a, r) => a + (r.bytes || 0), 0);
const top = list.filter(r => r.bytes).sort((a, b) => b.bytes - a.bytes).slice(0, 15)
  .map(r => ({ mb: +(r.bytes / 1048576).toFixed(2), type: r.type, ms: (r.end || 0) - r.start, url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80) }));
const slow = list.filter(r => r.end).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 8)
  .map(r => ({ ms: r.end - r.start, url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80) }));
const failed = list.filter(r => r.failed).map(r => r.failed + ' ' + r.url.slice(0, 90)).slice(0, 10);

await browser.close();
console.log(JSON.stringify({ url, dclMs: dcl, loadMs: load, timing, requests: list.length, totalMB: +(total / 1048576).toFixed(2),
  byType, top, slow, failed, frames, cedric, errors: errors.slice(0, 6) }, null, 1));
