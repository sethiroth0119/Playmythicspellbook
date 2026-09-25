/* CRITIC PROBE 2 — corrected control + the mitigation question.
   Probe 1's .mp-option control compared background-image, but that state's
   signal is a box-shadow RING, so the control could not have gone green.
   Here every property is compared, and the inner warehouse bar is probed too. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9500 + Math.floor(Math.random() * 200);
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

const res = await pg.evaluate(() => {
  const read = (el) => { const c = getComputedStyle(el); return { bgImage: c.backgroundImage, bgColor: c.backgroundColor, border: c.borderTopColor, shadow: c.boxShadow, outline: c.outlineColor }; };
  const probe = (cls) => { const e = document.createElement('div'); e.className = cls; e.style.cssText = 'width:80px;height:30px'; document.body.appendChild(e); const r = read(e); e.remove(); return r; };
  /* the inner capacity bar — <i> inside .tw-wm-bay-bar inside .tw-wm-bay */
  const inner = (state) => {
    const bay = document.createElement('div'); bay.className = 'tw-wm-bay ' + state;
    const bar = document.createElement('div'); bar.className = 'tw-wm-bay-bar';
    const i = document.createElement('i'); i.style.cssText = 'display:block;width:20px;height:6px';
    bar.appendChild(i); bay.appendChild(bar); document.body.appendChild(bay);
    const r = read(i); bay.remove(); return r;
  };
  return {
    mp: { base: probe('mp-option'), sel: probe('mp-option is-selected') },
    bay: { base: inner(''), warn: inner('warn'), crit: inner('crit') },
  };
});

const diff = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]);

console.log('\n=== CORRECTED CONTROL — .mp-option.is-selected ===');
const md = diff(res.mp.base, res.mp.sel);
console.log('  properties that still differ: ' + (md.length ? md.join(', ') : 'NONE'));
console.log('  base  box-shadow: ' + res.mp.base.shadow.slice(0, 80));
console.log('  sel   box-shadow: ' + res.mp.sel.shadow.slice(0, 80));
console.log('  VERDICT: ' + (md.includes('shadow') ? '✅ the selection RING survives — probe 1 raised a false positive here'
                                                   : '❌ the selection ring is gone too'));

console.log('\n=== MITIGATION — the inner capacity bar inside .tw-wm-bay ===');
for (const s of ['warn', 'crit']) {
  const d = diff(res.bay.base, res.bay[s]);
  console.log('  .tw-wm-bay.' + s + ' <i> differs in: ' + (d.length ? d.join(', ') : 'NONE'));
  console.log('     base bg-color: ' + res.bay.base.bgColor + '   ' + s + ' bg-color: ' + res.bay[s].bgColor);
}
await b.close(); srv.close();
