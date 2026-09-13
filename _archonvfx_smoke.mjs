/* _archonvfx_smoke.mjs — drives vfx/archon.html end to end and gates the one
   thing that has bitten this page's whole family: the WHITE SCREEN.
     node _archonvfx_smoke.mjs [outDir]
   Needs playwright + the pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH).

   ⚠ WHY IT SEEKS AND STEPS RATHER THAN WATCHING IT PLAY. rAF runs at ~0.56 Hz
   in the agent browser pane, so "let it play and screenshot" samples three
   frames out of six seconds and misses everything. fx-core exposes
   window.__vfxStep(dt) for exactly this: seek to a time, force ONE
   deterministic frame, then read the canvas. See CLAUDE.md, Verifying. */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const OUT = process.argv[2] || null;          /* screenshots are optional */
const ROOT = 'public', PORT = 8099;
const MT = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const BIN = process.env.CHROMIUM_BIN
  || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']
       .find(p => fs.existsSync(p));

const srv = http.createServer((q, r) => {
  const f = path.join(ROOT, q.url.split('?')[0]);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'content-type': MT[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));

const b = await chromium.launch(BIN ? { executablePath: BIN, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1000, height: 640 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto(`http://localhost:${PORT}/vfx/archon.html`);
await pg.waitForFunction(() => window.ArchonVFX && window.__vfxStep);

/* Every slot filled. An EMPTY payload is the easy case — the page ships
   placeholder-free and the white bug only ever showed up with real art in. */
const art = await pg.evaluate(() => {
  const mk = (w, h, c1, c2, label) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, c1); lg.addColorStop(1, c2);
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#fff' : '#000';
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, Math.random() * w * 0.12, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#f4e6bd'; g.textAlign = 'center';
    g.font = 'bold ' + Math.round(h * 0.1) + 'px Georgia'; g.fillText(label, w / 2, h * 0.9);
    return c.toDataURL('image/png');
  };
  return { tribs: [mk(300, 420, '#3a1d5c', '#8b2f2f', 'TRIBUTE I'),
                   mk(300, 420, '#123a52', '#2f7f6a', 'TRIBUTE II'),
                   mk(300, 420, '#4a2c0a', '#a05a12', 'TRIBUTE III')],
           unit: mk(520, 520, '#1a1040', '#6d3fd6', 'ARCHON') };
});
await pg.evaluate(a => window.ArchonVFX.set({
  name: 'Astraeus, the Void Crown', eyebrow: 'ARCHON  //  TRIBUTE SUMMON',
  tributes: a.tribs, tributeTint: ['#c084fc', '#5eead4', '#fbbf24'], unit: a.unit }), art);
await pg.waitForTimeout(900);

const D = await pg.evaluate(() => window.ArchonVFX.duration);
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let worstWhite = 0, blank = 0, n = 24;
for (let i = 0; i < n; i++) {
  const t = +(i * D / (n - 1)).toFixed(3);
  const s = await pg.evaluate(tt => {
    window.ArchonVFX.seek(tt); window.__vfxStep(0.016);
    const c = document.getElementById('fx'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let nz = 0, white = 0, tot = 0;
    for (let k = 0; k < d.length; k += 4 * 17) {
      tot++; if (d[k + 3] > 6) nz++;
      /* THE GATE: a pixel both opaque and bright is a pixel that washed the
         board out. This is the metric the two-layer ATMO/HERO seal exists to
         hold at zero; see the CINE KIT header in vfx/archon.html. */
      if (d[k + 3] > 200 && (d[k] + d[k + 1] + d[k + 2]) / 3 > 200) white++;
    }
    return { nz, tot, white };
  }, t);
  if (s.nz === 0 && t > 0) blank++;
  if (s.white > worstWhite) worstWhite = s.white;
  console.log(String(t).padStart(6), 'cover', (100 * s.nz / s.tot).toFixed(1).padStart(5) + '%',
              'whitewash', s.white);
  if (OUT) await pg.screenshot({ path: path.join(OUT, 'f' + String(i).padStart(2, '0') + '_' + t + '.png') });
}
await b.close(); srv.close();

const bad = [];
if (errs.length)     bad.push('page errors: ' + errs.join(' | '));
if (worstWhite > 0)  bad.push('white-wash: ' + worstWhite + ' px at alpha>200 AND lum>200');
if (blank > 0)       bad.push(blank + ' blank frame(s) after t=0');
console.log(bad.length ? '\nFAIL\n  ' + bad.join('\n  ') : '\nPASS — no page errors, no white-wash, no blank frames');
process.exit(bad.length ? 1 : 0);
