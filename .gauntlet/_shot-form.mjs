/* 📸 SHOT-FORM — render named screens and write a PNG of each, so the round-2
   form pass is judged by eye (DESIGN-BAR §9: "render it for real and screenshot
   it, do not judge from source") and not only by the audit's percentages.
   Also reports horizontal overflow, because the added tracking is the one
   change here that could push a three-column shell past the viewport (§5).

   ⚠ Fonts are allowed through the route filter — Cinzel arriving or not is
     the whole subject of the type pass. Run: node .gauntlet/_shot-form.mjs out/dir screen… */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ARGV = process.argv.slice(2);
/* --freeze kills every animation and transition before the shot. The Crash
   Exchange runs a light sweep across the whole page, so two un-frozen shots of
   the same screen differ by wherever the sweep happened to be — an A/B of them
   measures the animation and not the CSS. Same family of trap as the RAF note
   in CLAUDE.md: the frame you photograph is not always the frame you think. */
const FREEZE = ARGV.includes('--freeze');
const REST = ARGV.filter(a => a !== '--freeze');
const OUT = REST[0] || 'tmp/shot-form';
const SCREENS = REST.slice(1);
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain' };
const P = 9700 + Math.floor(Math.random() * 150);
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
  if (u.includes('127.0.0.1') || u.includes('fonts.g') || u.includes('cdnjs.cloudflare') || u.includes('unpkg')) return r.continue();
  return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3500);
try { await pg.evaluate(() => document.fonts.ready); } catch (e) {}
fs.mkdirSync(OUT, { recursive: true });
for (const s of SCREENS) {
  const info = await pg.evaluate(async (scr) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try { App.screen = scr; render(); await sleep(400); } catch (e) { return { err: String(e).slice(0, 90) }; }
    const de = document.documentElement;
    return { over: de.scrollWidth - de.clientWidth, nodes: document.querySelectorAll('*').length };
  }, s);
  if (FREEZE) await pg.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important}' });
  await pg.screenshot({ path: path.join(OUT, s + '.png') });
  console.log(String(s).padEnd(18) + (info.err ? 'THREW ' + info.err
    : 'h-overflow ' + String(info.over).padStart(4) + 'px' + (info.over > 0 ? '  ⚠' : '')));
}
await b.close(); srv.close();
