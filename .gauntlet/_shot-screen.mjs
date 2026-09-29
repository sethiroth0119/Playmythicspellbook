import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 9600 + Math.floor(Math.random() * 300);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1500, height: 980 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,150)));
await pg.route('**/*', r => { const u=r.request().url();
  if (u.includes('127.0.0.1')||u.includes('fonts.googleapis')||u.includes('fonts.gstatic')||u.includes('cdn.jsdelivr')) return r.continue(); return r.abort(); });
await pg.addInitScript(() => { try { localStorage.setItem('mg_onboarded','1'); } catch(e){} });
await pg.goto('http://127.0.0.1:'+P+'/index.html', { waitUntil:'domcontentloaded', timeout:120000 });
await pg.waitForFunction('typeof render === "function" && typeof App === "object"', null, { timeout: 150000 });
await pg.waitForTimeout(4000);
const OUT = process.argv[2] || 'tmp/screens';
try { fs.mkdirSync(OUT, { recursive: true }); } catch(e){}
for (const scr of (process.argv[3] || 'vendorMarket,camp,collection').split(',')) {
  try {
    await pg.evaluate((s) => { try { const g=document.getElementById('auth-gate'); if(g) g.remove(); } catch(e){}
      App.screen = s; render(); }, scr);
    await pg.waitForTimeout(2500);
    const n = await pg.evaluate(() => ({ panels: document.querySelectorAll('.panel').length,
      btns: document.querySelectorAll('.btn-primary,.btn-secondary').length,
      title: (document.querySelector('h1,h2') || {}).textContent || '' }));
    await pg.screenshot({ path: path.join(OUT, scr + '.png') });
    console.log(scr.padEnd(16) + ' panels=' + n.panels + ' buttons=' + n.btns + '  ' + String(n.title).trim().slice(0,40));
  } catch (e) { console.log(scr + ' FAILED ' + String(e).slice(0,100)); }
}
console.log('errors: ' + errs.length); errs.slice(0,3).forEach(e=>console.log('  '+e));
await b.close(); srv.close();
