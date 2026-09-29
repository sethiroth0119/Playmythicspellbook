/* ══════════════════════════════════════════════════════════════════════════
   CRIT-BATTLEUI-HEADROOM — was a head EVER cut off, and by how much is it
   clear now? The tallest thing the board can put on the far rank is the wyrm
   (PROC_DEFS h:1.30 x SPRITE_SCALE 1.30), and the far rank is where terrain
   elevation lifts a sprite further up the screen. Sweep every far-rank tile
   with a wyrm and report the smallest `top` in stage CSS px; <0 is a cut head.
   Also reports what the REAL match units are, so the sweep is not a straw man.
   Run: node .gauntlet/crit-battleui-headroom.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8500 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function run(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.route('**/*', r => { const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort(); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null); App.screen = 'battle'; render();
  });
  await page.waitForTimeout(7000);
  const out = await page.evaluate(() => {
    const win = document.querySelector('iframe.bb-stage').contentWindow;
    const B = win.Board, map = B.map, D = win.__bbDebug;
    const real = B.units.map(u => ({ side: u.side, x: u.x, z: u.z,
      defH: u.def && u.def.h, worldH: win.unitWorldH ? +win.unitWorldH(u.def).toFixed(3) : null }));
    /* the tallest procedural body, on every far-rank tile */
    for (let x = 0; x < map.cols; x++) { try { B.spawnUnit('wyrm', x, 0, 'foe'); } catch (e) {} }
    const far = B.units.filter(u => u.z === 0).map(u => {
      const b = B.unitScreenBox(u);
      return b ? { x: u.x, top: +b.top.toFixed(1), h: +b.height.toFixed(1),
                   elev: +D.tileElev(u.x, 0).toFixed(2), defH: u.def && u.def.h } : null;
    }).filter(Boolean);
    const worst = far.reduce((a, b) => b.top < a.top ? b : a, far[0]);
    return { ih: win.innerHeight, iw: win.innerWidth, real, farCount: far.length, worst,
             fit: win.__bbFitProbe() };
  });
  await page.close();
  return out;
}

for (const [w, h] of [[1600, 900], [1100, 800], [1366, 768]]) {
  const r = await run(w, h);
  console.log('\n══ ' + w + 'x' + h + ' ══ stage ' + r.iw + 'x' + r.ih +
    '  pitch ' + r.fit.pitchDeg + '  unitH ' + r.fit.unitH);
  console.log('  real match units: ' + JSON.stringify(r.real));
  console.log('  wyrm on all ' + r.farCount + ' far-rank tiles → worst head top = ' +
    r.worst.top + ' px   ' + JSON.stringify(r.worst));
  console.log('  ' + (r.worst.top >= 0 ? 'CLEAR by ' + r.worst.top.toFixed(0) + ' px'
                                       : '*** CUT OFF by ' + (-r.worst.top).toFixed(0) + ' px ***'));
}
await browser.close(); server.close();
