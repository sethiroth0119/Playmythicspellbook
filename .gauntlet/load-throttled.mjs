/* ══════════════════════════════════════════════════════════════════════════
   LOAD UNDER A PHONE PROFILE — cold visit, then a repeat visit (service worker
   installed, HTTP cache warm). Owner: "the game is loading slow".

   CDP throttling: 150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x slower.
   Reports DOMContentLoaded / load, request count and bytes, how many
   requests were revalidations, and the main-thread time spent in long tasks.

   Usage: node .gauntlet/load-throttled.mjs [url] [--fast]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';

const url = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'https://playmythicspellbook.com/';
const fast = process.argv.includes('--fast');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });

async function visit(label) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  if (!fast) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  let n = 0, bytes = 0, notModified = 0, fromSW = 0, fromCache = 0;
  cdp.on('Network.responseReceived', (e) => {
    n++;
    if (e.response.status === 304) notModified++;
    if (e.response.fromServiceWorker) fromSW++;
    if (e.response.fromDiskCache) fromCache++;
  });
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  await p.addInitScript(() => {
    window.__lt = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  });
  const t = Date.now();
  await p.goto(url, { waitUntil: 'load', timeout: 300000 });
  const loadMs = Date.now() - t;
  await p.waitForTimeout(3000);
  const m = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
    return { ttfb: Math.round(nav.responseStart), docDone: Math.round(nav.responseEnd), dcl: Math.round(nav.domContentLoadedEventEnd),
             load: Math.round(nav.loadEventEnd), fcp: Math.round(fcp), longTaskMs: Math.round(window.__lt), sw: !!navigator.serviceWorker.controller };
  });
  console.log(label.padEnd(8), JSON.stringify({ ...m, wallLoad: loadMs, requests: n, MB: +(bytes / 1048576).toFixed(2), '304': notModified, fromSW, fromCache }));
  await p.close();
}
await visit('cold');
await visit('repeat');
await visit('repeat2');
await b.close();
