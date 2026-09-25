/* ══════════════════════════════════════════════════════════════════════════
   📐 AUDIT-FORM — the half audit-theme.mjs cannot see

   audit-theme measures HUE. It reached zero, and the owner's answer was "it is
   still the same" — which is correct and is the more useful result, because
   colour is exactly the property that can be fully corrected while a screen
   keeps the same shape, weight and rhythm it always had.

   DESIGN-BAR.md's own measurable rules are mostly NOT about colour:
       · frame radius 3–4px            (the references are cut stone, not cards)
       · Cinzel on headings            (a serif display face, small-caps)
       · letter-spacing on labels      (~0.12–0.14em, uppercase/small-caps)
       · a texture on panel grounds    (--tex-stone / --tex-parch)
       · an inset double rule          (inset 0 0 0 2-3px + a gold hairline)

   This measures those five, per screen, on the elements that carry the frame.
   A screen can pass every hue check and fail all five of these — which is what
   "it is still the same" means in numbers.

   Run:  node .gauntlet/audit-form.mjs [screen ...]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ONLY = process.argv.slice(2).filter(a => !a.startsWith('-'));
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp' };
const P = 9200 + Math.floor(Math.random() * 400);
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

await pg.evaluate(() => {
  window.__formScan = function () {
    const o = { panels: 0, radiusOk: 0, texOk: 0, gradOnly: 0, insetOk: 0,
                heads: 0, cinzel: 0, tracked: 0, radii: {}, headFonts: {} };
    /* A PANEL is a framed surface: real area, a background, and a border. That
       is what the references make out of cut stone, and what the app makes out
       of rounded cards. */
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 60) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const hasBd = cs.borderTopWidth !== '0px';
      if (!hasBg || !hasBd) continue;
      o.panels++;
      const rad = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
      o.radii[rad] = (o.radii[rad] || 0) + 1;
      if (rad <= 4) o.radiusOk++;
      /* 🔴 A GRADIENT IS NOT A TEXTURE, AND COUNTING IT AS ONE OVERSTATED
         EVERY FIGURE THIS FILE HAS EVER PRINTED. The first version tested
         /url\(|gradient/, so a panel painted with a plain linear-gradient —
         which is what most of the pre-Ruin panels already were — scored as
         textured. That is the exact blind spot behind "it is still the same":
         a screen could read 100% on this column while carrying no grain at
         all. Rule 2 asks for --tex-stone / --tex-parch, and those are url()
         data URIs. Only a url() counts. A gradient is tracked separately so
         the distinction is visible rather than silently dropped. */
      const bi = cs.backgroundImage || '';
      if (/url\(/.test(bi)) o.texOk++;
      else if (/gradient/.test(bi)) o.gradOnly++;
      if (/inset/.test(cs.boxShadow || '')) o.insetOk++;
    }
    /* HEADINGS: h1–h4 and anything the app calls a title. */
    for (const el of document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="-h"],[class*="head"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || !el.textContent.trim()) continue;
      o.heads++;
      const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
      o.headFonts[fam] = (o.headFonts[fam] || 0) + 1;
      if (/cinzel/i.test(cs.fontFamily || '')) o.cinzel++;
      const ls = parseFloat(cs.letterSpacing);
      const caps = /uppercase/.test(cs.textTransform) || /small-caps/.test(cs.fontVariant + ' ' + cs.fontVariantCaps);
      if (caps && ls >= 0.8) o.tracked++;
    }
    return o;
  };
});

const SCREENS = ONLY.length ? ONLY : await pg.evaluate(() => {
  const set = new Set();
  const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML;
  let m; while ((m = re.exec(src))) set.add(m[1]);
  return Array.from(set);
});

const rows = [];
for (const scr of SCREENS) {
  const res = await pg.evaluate(async (s) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(90); return { ok: true, ...window.__formScan() }; }
    catch (e) { return { ok: false }; }
  }, scr);
  if (res.ok && res.panels >= 3) rows.push({ screen: scr, ...res });
}
await b.close(); srv.close();

const pct = (a, b2) => b2 ? Math.round((a / b2) * 100) : 0;
const scored = rows.map(r => ({
  screen: r.screen, panels: r.panels, heads: r.heads,
  radius: pct(r.radiusOk, r.panels),
  tex:    pct(r.texOk, r.panels),
  grad:   pct(r.gradOnly, r.panels),
  inset:  pct(r.insetOk, r.panels),
  cinzel: pct(r.cinzel, r.heads),
  track:  pct(r.tracked, r.heads),
  radii: r.radii, headFonts: r.headFonts,
}));
scored.forEach(s => { s.score = Math.round((s.radius + s.tex + s.inset + s.cinzel + s.track) / 5); });
scored.sort((a, b2) => a.score - b2.score);

console.log('\n\u{1F4D0} FORM AUDIT · shape, not hue\n');
console.log('  Percentage of framed panels / headings on each screen that meet the bar.');
console.log('  radius = frame radius <= 4px · tex = textured ground · inset = inset rule');
console.log('  cinzel = display serif heading · track = tracked small-caps/upper\n');
console.log('  screen                 score  radius   tex  inset  cinzel  track   panels');
for (const s of scored) {
  console.log('  ' + s.screen.padEnd(22) +
    String(s.score).padStart(4) + '%' +
    String(s.radius).padStart(7) + '%' +
    String(s.tex).padStart(6) + '%' +
    String(s.inset).padStart(6) + '%' +
    String(s.cinzel).padStart(7) + '%' +
    String(s.track).padStart(6) + '%' +
    String(s.panels).padStart(8));
}
const avg = (k) => Math.round(scored.reduce((a, s) => a + s[k], 0) / scored.length);
console.log('\n  AVERAGE   radius ' + avg('radius') + '%   tex ' + avg('tex') + '%   inset ' + avg('inset')
  + '%   cinzel ' + avg('cinzel') + '%   track ' + avg('track') + '%');

const allRadii = {};
scored.forEach(s => { for (const k in s.radii) allRadii[k] = (allRadii[k] || 0) + s.radii[k]; });
console.log('\n  ── frame radius, every panel in the game');
Object.entries(allRadii).sort((a, b2) => b2[1] - a[1]).slice(0, 10)
  .forEach(([r, n]) => console.log('     ' + String(n).padStart(5) + '  ' + r + 'px' + (+r <= 4 ? '   ✓ bar' : '')));

const allFonts = {};
scored.forEach(s => { for (const k in s.headFonts) allFonts[k] = (allFonts[k] || 0) + s.headFonts[k]; });
console.log('\n  ── heading typeface, every heading in the game');
Object.entries(allFonts).sort((a, b2) => b2[1] - a[1]).slice(0, 8)
  .forEach(([f, n]) => console.log('     ' + String(n).padStart(5) + '  ' + f + (/cinzel/i.test(f) ? '   ✓ bar' : '')));

fs.writeFileSync('tmp/form-audit.json', JSON.stringify(scored, null, 2));
console.log('\n  full report → tmp/form-audit.json');
