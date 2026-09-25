/* ══════════════════════════════════════════════════════════════════════════
   🔠 DRIVE-BUTTON-CONTRAST — which button labels cannot be read?

   THE REPORT: "there are buttons the text are not white."

   The one in the screenshot is Rewards & Gifts' 🎁 Claim, and it is a COLLISION
   between two rules that are each correct alone:
     · .btn-primary paints a bright gold gradient and sets color:#1b1508 —
       near-black ink, which is right on gold.
     · .btn-mini (ruin skin, round 1) repaints the ground to
       rgba(20,18,14,0.9) with !important — right for a small ghost button.
   A button carrying BOTH gets the dark ink and the dark ground: near-black on
   near-black. Nobody wrote that rule; it fell out of the cascade, which is why
   it survived a full theme pass.

   So this does not go looking for that one button. It walks every screen, finds
   every button, composites the real background (the element's own colour over
   its ancestors', since most are translucent) and computes the WCAG contrast
   ratio against the label colour.

   THRESHOLD: 4.5:1 is the WCAG AA floor for body text; button labels are short
   and often bold, so 3.0:1 is used as the "actually unreadable" line and
   anything under 4.5 is listed as marginal. A ratio near 1.0 means the ink and
   the ground are the same colour.

   ⚠ A GRADIENT GROUND IS AN ESTIMATE, AND IS NOT IN THE VERDICT. For a
     gradient the stops are parsed and the WORST one is scored, which is
     pessimistic by design: a label only has to survive the part of the button
     it actually sits on, and a bright stop at one edge does not make it
     unreadable. Sampling rendered pixels under the glyphs is the honest way to
     score those, and this file does not do it. So gradient buttons are LISTED
     with their worst-stop figure and the pass/fail verdict is computed from
     FLAT-ground buttons only, where the composite is exact.
     Getting this wrong once already cost a round: the first cut composited only
     background-colour, scored every gold .btn-primary at ~1.05 against the
     charcoal beneath it, and reported 19 false failures.

   Run: node .gauntlet/drive-button-contrast.mjs [--all]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ALL = process.argv.includes('--all');
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 8020 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
pg.on('pageerror', () => {});
await pg.route('**/*', (r) => { const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g') || u.includes('cdnjs.cloudflare')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof render === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3500);

await pg.evaluate(() => {
  window.__btnScan = function () {
    const px = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : parseFloat(m[4]) } : null; };
    const over = (fg, bg) => ({                       // src-over composite
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, c) => { const l1 = lum(a), l2 = lum(c);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const groundOf = (el) => {
      let acc = null, node = el;
      while (node && node !== document.documentElement) {
        const c = px(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) break; }
        node = node.parentElement;
      }
      if (!acc) acc = { r: 10, g: 9, b: 8, a: 1 };
      if (acc.a < 0.999) acc = over(acc, { r: 10, g: 9, b: 8, a: 1 });   // page ground
      return acc;
    };
    const out = [];
    for (const el of document.querySelectorAll('button, .btn, [role="button"]')) {
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const q = el.getBoundingClientRect();
      if (q.width < 24 || q.height < 12) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.25) continue;
      const ink = px(cs.color); if (!ink) continue;
      let ground = groundOf(el);
      /* 🔴 A GOLD BUTTON IS NOT ITS FALLBACK COLOUR. The first cut of this file
         composited only background-COLOUR, so every .btn-primary — bright gold
         gradient, near-black ink, about 10:1 — scored 1.05 against the charcoal
         underneath and 19 of 22 reported failures were that mistake. The
         gradient stops are the real ground, so they are parsed and the WORST
         stop is the one scored: a label has to survive the darkest part of its
         own button. */
      const stops = (cs.backgroundImage || '').match(/rgba?\([^)]+\)/g) || [];
      let grounds = [ground];
      if (/gradient/.test(cs.backgroundImage || '') && stops.length) {
        const parsed = stops.map(px).filter(c => c && c.a > 0.15).map(c => (c.a < 0.999 ? over(c, ground) : c));
        if (parsed.length) grounds = parsed;
      }
      const inkOn = ink.a < 0.999 ? over(ink, grounds[0]) : ink;
      let rMin = Infinity, gWorst = grounds[0];
      for (const g of grounds) { const rr = ratio(ink.a < 0.999 ? over(ink, g) : ink, g); if (rr < rMin) { rMin = rr; gWorst = g; } }
      ground = gWorst;
      out.push({
        sel: String(el.className || el.tagName).trim().split(/\s+/).filter(Boolean).join('.').slice(0, 46),
        text: t.replace(/\s+/g, ' ').slice(0, 22),
        ink: cs.color, ground: 'rgb(' + [ground.r, ground.g, ground.b].map(Math.round).join(',') + ')',
        gradient: /gradient/.test(cs.backgroundImage || ''),
        ratio: +rMin.toFixed(2),
      });
    }
    return out;
  };
});

const SCREENS = await pg.evaluate(() => {
  const set = new Set(); const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML; let m;
  while ((m = re.exec(src))) set.add(m[1]); return Array.from(set);
});
const worst = new Map();
for (const scr of SCREENS) {
  const rows = await pg.evaluate(async (s) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(90); } catch (e) { return []; }
    return window.__btnScan().map(r => ({ ...r, screen: s }));
  }, scr);
  for (const r of rows) {
    const k = r.sel + '|' + r.ink;
    const prev = worst.get(k);
    if (!prev || r.ratio < prev.ratio) worst.set(k, r);
  }
}
await b.close(); srv.close();

const rows = [...worst.values()].sort((a, b2) => a.ratio - b2.ratio);
const scored = rows.filter(r => !r.gradient);
const bad = scored.filter(r => r.ratio < 3.0);
const gradLow = rows.filter(r => r.gradient && r.ratio < 3.0);
const marginal = scored.filter(r => r.ratio >= 3.0 && r.ratio < 4.5);
console.log('\n🔠 BUTTON LABEL CONTRAST · ' + rows.length + ' distinct button styles across ' + SCREENS.length + ' screens\n');
console.log('  ratio  gradient  selector / label                                ink → ground');
const line = (r) => '  ' + String(r.ratio).padStart(5) + '   ' + (r.gradient ? 'grad ' : '     ')
  + '  .' + r.sel.padEnd(40).slice(0, 40) + '  "' + r.text + '"  ' + r.ink + ' → ' + r.ground + '  [' + r.screen + ']';
console.log('\n  ── UNREADABLE (< 3.0:1)');
if (!bad.length) console.log('     none');
bad.forEach(r => console.log(line(r)));
console.log('\n  ── MARGINAL (3.0–4.5:1)');
if (!marginal.length) console.log('     none');
marginal.slice(0, 14).forEach(r => console.log(line(r)));
if (ALL) { console.log('\n  ── ALL'); rows.forEach(r => console.log(line(r))); }
console.log('\n  VERDICT: ' + (bad.length === 0 ? '\x1b[32mEVERY BUTTON LABEL IS READABLE\x1b[0m'
  : '\x1b[31m' + bad.length + ' BUTTON STYLE(S) UNREADABLE\x1b[0m') + '\n');
process.exit(bad.length === 0 ? 0 : 1);
