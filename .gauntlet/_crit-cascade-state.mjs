/* CRITIC PROBE — does the RUIN SKIN ROUND 2 `!important` block outrank a
   pre-existing STATE VARIANT?  Measured with getComputedStyle in the real
   booted page, not reasoned about from the cascade rules.
   Harness conventions copied from .gauntlet/audit-form.mjs. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9700 + Math.floor(Math.random() * 200);
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

const out = await pg.evaluate(() => {
  const probe = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.width = '80px'; el.style.height = '30px';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const r = { cls, bgImage: (cs.backgroundImage || '').slice(0, 90), bgColor: cs.backgroundColor, borderColor: cs.borderTopColor, boxShadow: (cs.boxShadow || '').slice(0, 50) };
    el.remove();
    return r;
  };
  return ['vault-cell', 'vault-cell hi-ok', 'vault-cell hi-bad',
          'tw-wm-bay', 'tw-wm-bay warn', 'tw-wm-bay crit',
          'mp-option', 'mp-option is-selected'].map(probe);
});

console.log('\nRESOLVED STYLES IN THE REAL BOOTED PAGE\n');
for (const r of out) console.log('  ' + r.cls.padEnd(22) + '\n      bg-image : ' + r.bgImage + '\n      bg-color : ' + r.bgColor + '\n      border   : ' + r.borderColor);

let bad = 0;
const cmp = (baseCls, stateCls, label, expectOutranked) => {
  const a = out.find(x => x.cls === baseCls), c = out.find(x => x.cls === stateCls);
  const imgSame = a.bgImage === c.bgImage;
  const outranked = imgSame && a.bgImage !== 'none';
  console.log('\n' + label);
  console.log('   base and state share the SAME background-image?  ' + (imgSame ? 'YES' : 'no'));
  console.log('   state background-color still distinct?           ' + (a.bgColor === c.bgColor ? 'NO' : 'yes — but it sits UNDER that image'));
  console.log('   state border still distinct?                     ' + (a.borderColor === c.borderColor ? 'NO' : 'yes'));
  console.log('   VERDICT: ' + (outranked ? '❌ STATE VARIANT OUTRANKED by the !important base'
                                          : '✅ state variant survives'));
  if (outranked !== expectOutranked) console.log('   (differs from what the static read predicted)');
  if (outranked) bad++;
};
cmp('vault-cell', 'vault-cell hi-ok', '.vault-cell.hi-ok   — the green "valid drop target" highlight', true);
cmp('vault-cell', 'vault-cell hi-bad', '.vault-cell.hi-bad  — the red "invalid drop target" highlight', true);
cmp('tw-wm-bay', 'tw-wm-bay warn', '.tw-wm-bay.warn     — warehouse bay nearing capacity', true);
cmp('tw-wm-bay', 'tw-wm-bay crit', '.tw-wm-bay.crit     — warehouse bay AT capacity', true);
cmp('mp-option', 'mp-option is-selected', '.mp-option.is-selected — CONTROL: ring is box-shadow, must survive', false);

console.log('\n' + (bad ? '❌ ' + bad + ' state variant(s) outranked by RUIN SKIN ROUND 2'
                        : '✅ no state variant outranked'));
await b.close(); srv.close();
