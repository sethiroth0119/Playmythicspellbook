/* CRITIC PROBE 3 — does `h1,h2,h3,h4 { letter-spacing:0.08em !important }`
   (index.html:37967) outrank (a) the block's OWN rule 11 lines above it, and
   (b) the deliberately-WIDE label headings elsewhere in the app?
   Measured with getComputedStyle on real tags, not read off the cascade. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9300 + Math.floor(Math.random() * 200);
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
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdnjs.cloudflare') || u.includes('fonts.g') || u.includes('unpkg')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(2500);

/* [tag, className, ancestorChain, authored letter-spacing, note] */
const CASES = [
  ['h3', 'wfa-panel-h', ['wfa'], 'Oswald 0.14em', 'WFA skin, properly nested'],
  ['h1', 'wfa-header-title', ['wfa'], 'Oswald 0.10em', 'WFA masthead, properly nested'],
  ['h2', '', ['wfa'], 'Oswald', 'any WFA heading'],
  ['h1', '', ['br-page'], 'Oswald uppercase', 'BR skin'],
];

const rows = await pg.evaluate((CASES) => CASES.map(([tag, cls, chain, authored, note]) => {
  let root = document.body, host = document.body;
  for (const c of chain) { const d = document.createElement('div'); d.className = c; host.appendChild(d); host = d; }
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = 'Heading';
  host.appendChild(el);
  const cs = getComputedStyle(el);
  const out = { sel: (chain.length ? '.' + chain.join(' .') + ' ' : '') + tag + (cls ? '.' + cls : ''),
                authored, note, ls: cs.letterSpacing, fam: (cs.fontFamily || '').split(',')[0], fs: cs.fontSize };
  if (chain.length) root.removeChild(root.lastChild); else el.remove();
  return out;
}), CASES);

console.log('\nRESOLVED letter-spacing IN THE REAL BOOTED PAGE');
console.log('(the flag at :37967 forces 0.08em — at 16px that is 1.28px)\n');
console.log('  ' + 'selector'.padEnd(30) + 'authored'.padEnd(20) + 'resolved'.padEnd(12) + 'font-size  family');
for (const r of rows)
  console.log('  ' + r.sel.padEnd(30) + String(r.authored).padEnd(20) + String(r.ls).padEnd(12) + String(r.fs).padEnd(11) + r.fam);

console.log('\nWHAT THAT MEANS');
for (const r of rows) {
  const px = parseFloat(r.ls), size = parseFloat(r.fs);
  const em = (isFinite(px) && size) ? (px / size) : NaN;
  const forced = isFinite(em) && Math.abs(em - 0.08) < 0.005;
  console.log('  ' + r.sel.padEnd(30) + (forced ? '❌ FORCED to 0.08em — ' + r.note
                                                : '✅ kept its own (' + em.toFixed(3) + 'em)'));
}
await b.close(); srv.close();
