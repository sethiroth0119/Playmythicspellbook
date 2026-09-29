/* ══════════════════════════════════════════════════════════════════════════
   🔎 PROBE-GRADIENTS — the surfaces BOTH audits are blind to

   audit-theme parses `backgroundColor`. audit-form asks whether
   `backgroundImage` is non-empty. An element painted ONLY by a gradient
   therefore reads as: no colour to judge (theme skips it) and "textured, ✓"
   (form passes it). `.profile-hero-card` is
       linear-gradient(135deg, rgba(45,30,70,.85), rgba(20,18,38,.95))
   at radius 14px — the most violet surface left in the game, on the screen the
   worklist ranked fifth-worst, and it scores 100% on both audits and 0
   offenders. It is also the first thing you see on that screen.

   So this parses the colour STOPS out of background-image and runs
   audit-theme's own cool() test on them: blue above red by more than 8, and
   blue the dominant channel (which is what keeps greens and teals out of it).
   It also reports the radius, since a gradient-only panel is invisible to the
   form audit's radius test for the same reason.

   Run: node .gauntlet/_probe-gradients.mjs                                     */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const P = 9770 + Math.floor(Math.random() * 40);
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
const hits = new Map();
for (const scr of SCREENS) {
  const rows = await pg.evaluate(async (s) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(80); } catch (e) { return []; }
    const cool = (r, g, b2) => (b2 - r) > 8 && b2 >= g;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'CANVAS' || tag === 'svg' || tag === 'VIDEO') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 40) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
      const img = cs.backgroundImage || '';
      if (!/gradient/.test(img)) continue;
      const stops = [...img.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/g)]
        .map(m => ({ r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] }))
        .filter(c => c.a > 0.15);
      const bad = stops.filter(c => cool(c.r, c.g, c.b));
      if (!bad.length) continue;
      const c = String(el.className || '').trim().split(/\s+/).filter(Boolean).join('.');
      out.push({ sel: c || '<' + tag.toLowerCase() + '>', screen: s,
        rad: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
        worst: bad.map(c2 => 'rgb(' + [c2.r, c2.g, c2.b].join(',') + ')')[0],
        lead: Math.max(...bad.map(c2 => c2.b - c2.r)),
        area: Math.round(r.width) + '×' + Math.round(r.height) });
    }
    return out;
  }, scr);
  for (const r of rows) {
    const k = r.sel;
    if (!hits.has(k)) hits.set(k, { ...r, n: 0, screens: new Set() });
    const h = hits.get(k); h.n++; h.screens.add(r.screen);
    if (r.lead > h.lead) { h.lead = r.lead; h.worst = r.worst; }
  }
}
await b.close(); srv.close();
const rows = [...hits.values()].sort((a, b2) => b2.lead - a.lead);
console.log('\n🎨 COOL GRADIENTS · surfaces painted only by a gradient, which neither audit judges\n');
console.log('  b-r    n  radius  worst stop        size        selector   [screens]');
for (const h of rows) {
  console.log('  ' + String(h.lead).padStart(3) + String(h.n).padStart(5) + String(h.rad).padStart(7) + 'px  ' +
    h.worst.padEnd(18) + h.area.padEnd(12) + '.' + h.sel + '   [' +
    [...h.screens].slice(0, 3).join(' ') + ([...h.screens].length > 3 ? ' +' + ([...h.screens].length - 3) : '') + ']');
}
console.log('\n  ' + rows.length + ' selectors, ' + rows.reduce((a, h) => a + h.n, 0) + ' instances');
