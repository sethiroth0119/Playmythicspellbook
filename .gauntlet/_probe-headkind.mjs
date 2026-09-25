/* 🔎 PROBE-HEADKIND — is each remaining "heading" a heading, or a container?

   audit-form's heading query includes [class*="-h"], which matches page shells
   (.spellbook-hub, .keep-hud, .daily-hero-card). Small-caps on a shell cascades
   into every word inside it. This prints what each failing element actually IS
   — tag, element children, text length, sample — so the type pass can take the
   real headings and leave the shells failing on purpose.

   Run: node .gauntlet/_probe-headkind.mjs [screen ...]                         */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9950 + Math.floor(Math.random() * 40);
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
await pg.waitForTimeout(3000);

const SCREENS = ONLY.length ? ONLY : await pg.evaluate(() => {
  const set = new Set(); const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML; let m;
  while ((m = re.exec(src))) set.add(m[1]); return Array.from(set);
});

const seen = new Map();
for (const scr of SCREENS) {
  const rows = await pg.evaluate(async (s) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(90); } catch (e) { return []; }
    const out = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="-h"],[class*="head"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || !el.textContent.trim()) continue;
      const cinzel = /cinzel/i.test(cs.fontFamily || '');
      const ls = parseFloat(cs.letterSpacing);
      const caps = /uppercase/.test(cs.textTransform) || /small-caps/.test(cs.fontVariant + ' ' + cs.fontVariantCaps);
      if (cinzel && caps && ls >= 0.8) continue;
      const c = String(el.className || '').trim().split(/\s+/).filter(Boolean).join('.');
      out.push({ sel: c || '<' + el.tagName.toLowerCase() + '>', tag: el.tagName.toLowerCase(),
        kids: el.childElementCount, len: el.textContent.trim().length,
        w: Math.round(r.width), h: Math.round(r.height),
        ls: isNaN(ls) ? 0 : +ls.toFixed(2), fam: (cs.fontFamily || '').split(',')[0].replace(/["']/g, ''),
        txt: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 46), screen: s });
    }
    return out;
  }, scr);
  for (const r of rows) if (!seen.has(r.sel)) seen.set(r.sel, r);
}
await b.close(); srv.close();

console.log('\n  kids  len   w×h        ls   family          selector / text');
for (const r of [...seen.values()].sort((a, b2) => a.kids - b2.kids)) {
  const verdict = (r.kids <= 1 && r.len <= 60) ? 'HEADING?' : 'container';
  console.log('  ' + String(r.kids).padStart(4) + String(r.len).padStart(5) +
    ('  ' + r.w + '×' + r.h).padEnd(12) + String(r.ls).padStart(5) + '  ' +
    r.fam.padEnd(15) + ' ' + verdict.padEnd(10) + '.' + r.sel + '   "' + r.txt + '"');
}
