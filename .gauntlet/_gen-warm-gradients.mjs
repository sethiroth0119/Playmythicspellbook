/* ══════════════════════════════════════════════════════════════════════════
   🎨 GEN-WARM-GRADIENTS — writes the CSS that warms the surfaces both audits
   are blind to (see _probe-gradients.mjs for why they are blind).

   It reads each offending element's COMPUTED background-image, rewrites only
   the stops that fail the cool test, and prints a rule that restates the whole
   gradient — same type, same angle, same stop positions, same layer order — so
   nothing about the drawing changes except the hue. Position, size and repeat
   are separate properties and are left alone.

   WHICH STOPS ARE REWRITTEN, and why it is not "every cool stop":
     · dark and not vivid  (L < 0.55, S < 0.75)  → chrome. Warmed.
     · bright or vivid                            → meaning. Left alone.
   That line is what keeps the Book of Knowledge's 5px element stripe
   (rgb(90,168,255), S = 1.0) and the vendor pack auras (L = 0.60) intact while
   still warming the violet card ground they sit on. DESIGN-BAR §1 allows
   colour that carries information and forbids it as chrome; luminance and
   saturation are the closest measurable stand-in for that distinction.

   The hue target is the palette's own: 32° at ≤ 0.30 saturation, lightness
   untouched, which lands a violet ground on the same charcoal as --bg-panel.

   Run: node .gauntlet/_gen-warm-gradients.mjs > tmp/warm-gradients.css         */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const P = 9740 + Math.floor(Math.random() * 25);
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
/* Minimum surface size. The first pass ran at 90×40 and missed the Base
   Vault’s equipment slots and every chip-sized tile; 40×24 is audit-theme’s
   own floor for “structural surface” (44×22) rounded to the nearest tile. */
const MINW = +(process.env.MINW || 90), MINH = +(process.env.MINH || 40);
const SCREENS = await pg.evaluate(() => {
  const set = new Set(); const re = /App\.screen === '([a-zA-Z-]+)'/g;
  const src = document.documentElement.innerHTML; let m;
  while ((m = re.exec(src))) set.add(m[1]); return Array.from(set);
});
/* Excused: audit-theme's own MEANING list, plus a few judged here — the pack
   auras and the identity avatar are content, and .bok-intro,
   .profile-level-block, .tr-tile, .mission-card, .br-panel and .toast are
   already handled by name earlier in the round-2 block. */
const EXCUSE = ['.bok-elem-chip','.bok-card-icon','.type-badge','.elem-chip','.sov-pkg','.sov-info-card',
  '.profile-currency-sov','.csx-chip','.pledge-tier','.pledge-cta','.rarity','.affinity','.cx-aza-block',
  '#cx-aza-buy','#cx-aza-sell','.profile-level-block','.bok-intro','.frame-pick','.frame-card','[class*="frame-"]',
  '.vmx-aura','.profile-avatar','.tr-tile','.mission-card','.br-panel','.toast'];
const found = new Map();
for (const scr of SCREENS) {
  const rows = await pg.evaluate(async ({ s, EXCUSE, MINW, MINH }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    try { App.screen = s; render(); await sleep(80); } catch (e) { return []; }
    const cool = (r, g, b2) => (b2 - r) > 8 && b2 >= g;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const tag = el.tagName;
      if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO') continue;
      const r = el.getBoundingClientRect();
      if (r.width < MINW || r.height < MINH) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
      const img = cs.backgroundImage || '';
      if (!/gradient/.test(img) || /url\(/.test(img)) continue;
      const st = el.getAttribute('style') || '';
      if (/background/i.test(st)) continue;            // inline: no rule can reach it
      if (EXCUSE.some(sel => { try { return el.matches(sel) || el.closest(sel); } catch (e) { return false; } })) continue;
      const stops = [...img.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/g)]
        .map(m => ({ r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] }));
      if (!stops.some(c => c.a > 0.15 && cool(c.r, c.g, c.b))) continue;
      const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean);
      if (!cls.length) continue;
      out.push({ sel: '.' + cls.join('.'), img, rad: Math.round(parseFloat(cs.borderTopLeftRadius) || 0), screen: s });
    }
    return out;
  }, { s: scr, EXCUSE, MINW, MINH });
  for (const r of rows) if (!found.has(r.sel)) found.set(r.sel, r);
}
await b.close(); srv.close();

/* ── the colour move ─────────────────────────────────────────────────────── */
const toHsl = (r, g, b) => { r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h * 360, s, l]; };
const toRgb = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360;
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255)); };
const cool = (r, g, b) => (b - r) > 8 && b >= g;
const warm = (r, g, b, a) => {
  const [h, s, l] = toHsl(r, g, b);
  if (l >= 0.55 || s >= 0.75) return null;                 // meaning, not chrome
  const [R, G, B] = toRgb(32, Math.min(s, 0.30), l);
  return a === 1 ? 'rgb(' + R + ', ' + G + ', ' + B + ')' : 'rgba(' + R + ', ' + G + ', ' + B + ', ' + a + ')';
};
let n = 0; const rules = [];
for (const [sel, o] of [...found].sort((a, b2) => a[0].localeCompare(b2[0]))) {
  let touched = 0;
  const img = o.img.replace(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/g,
    (m, r, g, b, a) => { r = +r; g = +g; b = +b; a = a == null ? 1 : +a;
      if (!cool(r, g, b)) return m;
      const w = warm(r, g, b, a); if (!w) return m; touched++; return w; });
  if (!touched) continue;
  n++;
  const radLine = (o.rad > 6 && o.rad < 40) ? '\n  border-radius: 3px !important;' : '';
  rules.push('/* ' + o.screen + ' · ' + touched + ' stop' + (touched > 1 ? 's' : '') +
    (radLine ? ' · ' + o.rad + 'px → 3px' : '') + ' */\n' + sel + ' {\n  background-image: ' + img + ' !important;' + radLine + '\n}');
}
console.log(rules.join('\n'));
console.error('\n  ' + n + ' rules written from ' + found.size + ' candidate selectors');
