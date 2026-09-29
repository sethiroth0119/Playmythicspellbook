/* 🖥 CITY GRAPHICS-REFUSAL PROBE — bug-mtr5xz8t.
   Loads node-city in Chromium with the first N WebGL getContext calls refused
   (a GPU process still recovering after sleep) and reports whether the city
   recovers. three.js asks for two context types per attempt, so N=2 refuses
   one whole attempt.
   Usage: node .gauntlet/citygl-probe.mjs <refuseN> [waitMs] [--url base]
   Needs the `public` preview server (port 8787).
   Measured 2026-09-17: before the fix, N=1 → 1 load, no canvas, stuck on
   'detecting renderer…'. After: N=1 → 2 loads, city drawn; N=50 → 7 loads,
   then a Try again button. It drives whatever the server is serving, so the
   control is to run it with the pre-fix node-city/index.html in place. */

import { chromium } from 'playwright';
const refuseN = Number(process.argv[2] || 1); const ai = process.argv.indexOf('--url'); const BASE = ai > 0 ? process.argv[ai + 1] : 'http://localhost:8787';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript((n) => {
  // count across reloads of THIS tab
  const k = '__refused';
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/i.test(type)) {
      const used = Number(sessionStorage.getItem(k) || 0);
      if (used < n) { sessionStorage.setItem(k, String(used + 1)); return null; }
    }
    return orig.call(this, type, attrs);
  };
}, refuseN);
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
let loads = 0; p.on('load', () => loads++);
await p.goto(BASE + '/node-city/index.html', { waitUntil: 'load', timeout: 90000 });
await p.waitForTimeout(Number(process.argv[3] || 20000));
const st = await p.evaluate(() => {
  const c = document.querySelector('canvas');
  return { canvas: !!c, canvasSize: c ? [c.width, c.height] : null,
    bootgpu: (document.querySelector('#bootgpu') || {}).textContent || null, retryButton: !!document.querySelector('#bootgpu button'),
    refused: Number(sessionStorage.getItem('__refused') || 0),
    bodyTextSample: document.body.innerText.slice(0, 120).replace(/\s+/g, ' ') };
});

console.log(JSON.stringify({ refuseN, loads, ...st, errs: errs.slice(0, 4) }, null, 1));
await b.close();
