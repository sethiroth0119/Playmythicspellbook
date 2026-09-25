/* 🔎 PROBE-GROUNDS — what ground does each selector actually have?

   Written after the round-2 frame pass put `background-image: var(--tex-stone)
   !important` on a selector list drawn partly from a source reading rather than
   from measurement, and two of them were wrong in ways the audit cannot see:

     · .cx-chart-wrap's background IS the chart grid (three stacked gradients).
       Replacing it deleted the grid.
     · .cx-mkt-table-wrap has NO background-colour, so `background-blend-mode:
       overlay` had nothing to blend with and the grain painted as raw grey
       noise over the order book.

   Both still score 100% on audit-form, because "has a background-image" is
   exactly what the texture test asks. So this prints the two things that
   decide whether a texture is safe on a selector: the ALPHA of its own
   background-colour, and whether it already carries an image worth keeping.

   Run against the ORIGINAL build (git checkout the file first).
   Usage: node .gauntlet/_probe-grounds.mjs sel,sel,sel                         */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const SELS = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const P = 9820 + Math.floor(Math.random() * 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdnjs.cloudflare') || u.includes('unpkg')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);
const SCREENS = await pg.evaluate(() => {
  const set = new Set(); const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML; let m;
  while ((m = re.exec(src))) set.add(m[1]); return Array.from(set);
});
const found = new Map();
for (const scr of SCREENS) {
  const rows = await pg.evaluate(async ({ s, sels }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(80); } catch (e) { return []; }
    const out = [];
    for (const sel of sels) {
      let els = []; try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) {
        const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 20) continue;
        const cs = getComputedStyle(el);
        const a = /rgba\([^)]*?,\s*([\d.]+)\)/.exec(cs.backgroundColor);
        out.push({ sel, alpha: a ? +a[1] : 1, bg: cs.backgroundColor,
          img: (cs.backgroundImage || 'none').slice(0, 74), screen: s,
          w: Math.round(r.width), h: Math.round(r.height) });
        break;
      }
    }
    return out;
  }, { s: scr, sels: SELS });
  for (const r of rows) if (!found.has(r.sel)) found.set(r.sel, r);
}
await b.close(); srv.close();
console.log('\n  alpha  size        background-color        background-image           selector');
for (const s of SELS) {
  const r = found.get(s);
  if (!r) { console.log('      -  (not seen on any screen)'.padEnd(58) + s); continue; }
  const risk = r.alpha < 0.35 ? ' ⚠ NO GROUND' : (r.img !== 'none' ? ' ⚠ HAS IMAGE' : '');
  console.log('  ' + String(r.alpha).padStart(5) + ('  ' + r.w + '×' + r.h).padEnd(12) +
    r.bg.padEnd(24) + r.img.padEnd(28) + s + risk);
}
