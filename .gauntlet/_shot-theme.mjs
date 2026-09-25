/* Render the real pages and measure the chrome against DESIGN-BAR.md §1.
   The bar's test: sample the page and panel chrome; fail if the BLUE channel
   leads RED by more than 8/255. That is what "the app is violet-tinted" means
   as a number rather than as an opinion. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 9500 + Math.floor(Math.random() * 300);
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
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('unpkg.com') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});

const OUT = process.argv[2] || 'tmp/theme';
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

const rgb = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; };

for (const [name, url] of [['main', '/index.html'], ['city', '/node-city/'], ['corp', '/corp/']]) {
  try {
    await pg.goto('http://127.0.0.1:' + P + url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await pg.waitForTimeout(name === 'city' ? 14000 : 7000);
    const probe = await pg.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      const tok = (n) => root.getPropertyValue(n).trim();
      return { bodyBg: cs.backgroundColor,
               tokens: { bgDeep: tok('--bg-deep'), bgPanel: tok('--bg-panel'),
                         bgCard: tok('--bg-card'), border: tok('--border'),
                         panelSolid: tok('--panel-solid'), edge: tok('--edge') },
               title: document.title };
    });
    await pg.screenshot({ path: path.join(OUT, name + '.png') });
    const hexes = Object.entries(probe.tokens).filter(([, v]) => v);
    console.log('\n── ' + name + '  (' + probe.title.slice(0, 40) + ')');
    console.log('   body background: ' + probe.bodyBg);
    for (const [k, v] of hexes) {
      const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
      let verdict = '';
      if (m) {
        const r2 = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), bl = parseInt(m[1].slice(4,6),16);
        verdict = (bl - r2 > 8) ? '  ❌ VIOLET (blue leads red by ' + (bl - r2) + ')' : '  ✅ warm (' + (bl - r2) + ')';
      }
      console.log('   ' + k.padEnd(12) + v.padEnd(10) + verdict);
    }
  } catch (e) { console.log('   ' + name + ' FAILED: ' + String(e).slice(0, 120)); }
}
console.log('\npage errors: ' + errs.length);
errs.slice(0, 5).forEach(e => console.log('   ' + e));
console.log('screenshots → ' + OUT);
await b.close(); srv.close();
