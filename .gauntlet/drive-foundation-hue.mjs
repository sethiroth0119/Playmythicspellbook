/* ══════════════════════════════════════════════════════════════════════════
   🏛 DRIVE-FOUNDATION-HUE — the Reserve, measured with the theme audit's test

   THE REPORT: "the Foundation Reserve still has the blue look."

   WHY audit-theme.mjs CALLED THIS SCREEN CLEAN: it never renders it. That audit
   walks screens by setting App.screen and calling render(); the Reserve is not
   a screen — it is a DOM overlay (#fr-modal) built by openFoundationReserve()
   when the hub tile is CLICKED, out of INLINE styles. So it is invisible to the
   hue audit (never in the DOM while it runs) and unreachable by the CSS skin
   block (an inline style outranks a stylesheet). 45 distinct blue values lived
   in there: rgba(120,170,255,…) borders, rgba(40,70,130,…) grounds, #dce8ff
   ink, on a rgba(2,4,10,…) backdrop.

   TWO CHECKS, AND THEY ARE NOT EQUALLY STRONG — read the labels:

   1. RENDERED (strong, narrow). The modal is opened for real and every painted
      surface in it goes through audit-theme's own cool() test: (blue - red) > 8
      AND blue >= green — the test that admits violet and cool grey while
      rejecting every green and amber. Ink is counted separately, because text
      is what you actually read.
      ⚠ SIGNED OUT, THE MODAL RENDERS ONE SENTENCE, so what this measures is the
        SHELL: backdrop, frame, header, footer, button. An earlier draft faked
        sign-in to reach the grid and the tabs — the Reserve begins polling the
        moment it believes it is online and the page never came back. Rather
        than leave a harness that hangs, that half is done by check 2 and
        labelled as the weaker thing it is.

   2. SOURCE (weak, total). Every colour literal inside the function's own span
      is classified. This reaches the tab bodies, the resource grid, the rank
      ladder and the tax rows — everything check 1 cannot open — but it reads
      source, not glass, so it cannot see a colour arriving from anywhere else.

   Neither replaces the other; the verdict needs both.

   Run: node .gauntlet/drive-foundation-hue.mjs [out.png]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const SHOT = process.argv.find(a => a.endsWith('.png'));
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 7970 + (process.pid % 25);

/* ── CHECK 2 · the source, first: it needs no browser ───────────────────── */
const srcAll = fs.readFileSync('public/index.html', 'utf8');
const lines = srcAll.split(/\r?\n/);
const fnStart = lines.findIndex(l => l.startsWith('function openFoundationReserve()'));
let fnEnd = -1;
for (let i = fnStart + 1; i < lines.length; i++) if (lines[i] === '}') { fnEnd = i; break; }
const body = lines.slice(fnStart, fnEnd + 1).join('\n');
const toHue = (r, g, b) => { r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0;
  if (mx !== mn) { const d = mx - mn;
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return h * 360; };
const parseC = (c) => c[0] === '#'
  ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
  : (() => { const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c); return m ? [+m[1], +m[2], +m[3]] : null; })();
const lits = [...new Set(body.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\)|#[0-9a-fA-F]{6}/g) || [])];
const srcBlue = [], srcExcused = [];
for (const c of lits) {
  const p = parseC(c); if (!p) continue;
  const [r, g, bl] = p;
  if (!((bl - r) > 8 && bl >= g)) continue;
  /* Violet and above is a CATEGORY here — Black Market, "not yours", Aza — the
     same class audit-theme excuses by name for .csx-chip and .sov-pkg. */
  (toHue(r, g, bl) > 255 ? srcExcused : srcBlue).push(c);
}

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
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('fonts.g')) return r.continue(); return r.abort(); });
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof openFoundationReserve === "function"', null, { timeout: 180000 });
await pg.waitForTimeout(3000);

const out = await pg.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    localStorage.setItem('mg_onboarded', '1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay').forEach(e => e.remove());
  } catch (e) {}
  openFoundationReserve();
  await sleep(900);
  const root = document.getElementById('fr-modal');
  if (!root) return { fatal: 'fr-modal did not open' };
  const parse = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || '');
    if (!m) return null; const a = m[4] == null ? 1 : parseFloat(m[4]);
    if (!(a > 0.06)) return null; return { r: +m[1], g: +m[2], b: +m[3], a }; };
  const cool = (p) => p && (p.b - p.r) > 8 && p.b >= p.g;
  const hue = (p) => { const r = p.r / 255, g = p.g / 255, bl = p.b / 255;
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); let h = 0;
    if (mx !== mn) { const d = mx - mn;
      h = mx === r ? (g - bl) / d + (g < bl ? 6 : 0) : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return h * 360; };
  const offenders = []; let surfaces = 0, excused = 0;
  for (const el of root.querySelectorAll('*')) {
    const t = el.tagName;
    if (t === 'IMG' || t === 'CANVAS' || t === 'VIDEO') continue;
    const q = el.getBoundingClientRect();
    if (q.width < 44 || q.height < 22) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
    const bg = parse(cs.backgroundColor);
    const bd = cs.borderTopWidth !== '0px' ? parse(cs.borderTopColor) : null;
    if (!bg && !bd) continue;
    surfaces++;
    const bad = [];
    if (cool(bg)) { if (hue(bg) > 255) excused++; else bad.push('bg ' + cs.backgroundColor); }
    if (cool(bd)) { if (hue(bd) > 255) excused++; else bad.push('border ' + cs.borderTopColor); }
    if (bad.length) offenders.push({ what: String(el.className || el.tagName).slice(0, 36), why: bad.join(' · ') });
  }
  const inks = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (!el.textContent || !el.textContent.trim()) continue;
    const q = el.getBoundingClientRect(); if (q.width < 20 || q.height < 8) continue;
    const cs = getComputedStyle(el), p = parse(cs.color);
    if (cool(p) && hue(p) <= 255) inks.add(cs.color);
  }
  return { surfaces, excused, offenders, inks: [...inks], backdrop: getComputedStyle(root).backgroundColor };
});
if (SHOT && !out.fatal) { fs.mkdirSync(path.dirname(SHOT), { recursive: true }); await pg.screenshot({ path: SHOT }); }
await b.close(); srv.close();

const ok = (v) => v ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
console.log('\n🏛 FOUNDATION RESERVE · is the blue gone?\n');
console.log('  1 · RENDERED  (the shell — signed out, so the tabs are not on screen)');
if (out.fatal) { console.log('      FATAL: ' + out.fatal); process.exit(1); }
console.log('      surfaces measured   ' + out.surfaces + '   backdrop ' + out.backdrop);
console.log('      cool chrome         ' + out.offenders.length + '   ' + ok(out.offenders.length === 0));
out.offenders.slice(0, 12).forEach(o => console.log('         🔴 .' + o.what + '  ' + o.why));
console.log('      cool ink            ' + out.inks.length + '   ' + ok(out.inks.length === 0)
  + (out.inks.length ? '   ' + out.inks.join(' ') : ''));
console.log('\n  2 · SOURCE  (every literal in openFoundationReserve — reaches the tabs)');
console.log('      colour literals     ' + lits.length);
console.log('      blue chrome left    ' + srcBlue.length + '   ' + ok(srcBlue.length === 0)
  + (srcBlue.length ? '   ' + srcBlue.slice(0, 10).join(' ') : ''));
console.log('      excused as category ' + srcExcused.length + '   ' + srcExcused.join(' '));
if (SHOT) console.log('\n  → ' + SHOT);
const pass = out.offenders.length === 0 && out.inks.length === 0 && srcBlue.length === 0;
console.log('\n  VERDICT: ' + (pass ? '\x1b[32mTHE BLUE IS GONE\x1b[0m' : '\x1b[31mSTILL BLUE\x1b[0m') + '\n');
process.exit(pass ? 0 : 1);
