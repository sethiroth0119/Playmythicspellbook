/* 🔎 PROBE-INLINE — print the opening tag of every classless framed panel left
   below the bar, so a source edit can find it. Run: node .gauntlet/_probe-inline.mjs [screen…] */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ONLY = process.argv.slice(2);
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9880 + Math.floor(Math.random() * 40);
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
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);
for (const scr of ONLY) {
  const rows = await pg.evaluate(async (s) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(120); } catch (e) { return ['(render threw)']; }
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 60) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
      if (cs.borderTopWidth === '0px') continue;
      const rad = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
      const tex = /url\(|gradient/.test(cs.backgroundImage || '');
      const ins = /inset/.test(cs.boxShadow || '');
      if (rad <= 4 && tex && ins) continue;
      out.push(el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1) + '   [rad' + rad + (tex ? '' : ' no-tex') + (ins ? '' : ' no-inset') + ']');
    }
    return out;
  }, scr);
  console.log('\n=== ' + scr);
  rows.forEach(r => console.log('   ' + r));
}
await b.close(); srv.close();
