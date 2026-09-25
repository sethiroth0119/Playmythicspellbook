/* ══════════════════════════════════════════════════════════════════════════
   CRIT-BATTLEUI-FIT — the SECOND question about the framing, the one the
   "no head is cut off" check cannot answer: having backed the eye off to
   fillX 0.76 and spent 0.66 of the leftover height on sky, HOW BIG IS THE
   BOARD AND HOW BIG IS A UNIT?

   CAM_FIT declares its own acceptance criterion — `spriteMin: 1/13.5`, "near-
   row sprite height / box height, the floor" — and fitCamera() searches pitch
   against it. This driver reads what the search actually settled on.

   Real match, real stage, no pixels, no rAF: every number comes out of
   window.__bbFitProbe(), which is fitReport() over the projection that ran.
   Run: node .gauntlet/crit-battleui-fit.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8400 + (process.pid % 90);
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

async function probe(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.route('**/*', r => {
    const u = r.request().url();
    return (u.includes('127.0.0.1') || u.includes('localhost')) ? r.continue() : r.abort();
  });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction('typeof initGame === "function"', null, { timeout: 180000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    App.battlePrep = App.battlePrep || {};
    const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
    App.state = initGame(me, foe, [], true, null);
    App.screen = 'battle'; render();
  });
  await page.waitForTimeout(7000);
  const out = await page.evaluate(() => {
    const f = document.querySelector('iframe.bb-stage');
    const win = f && f.contentWindow;
    if (!win || !win.__bbFitProbe) return null;
    const fit = win.__bbFitProbe();
    const B = win.Board, map = B.map;
    /* fill the far and near ranks so the extremes are real, not seeded luck */
    for (let x = 0; x < map.cols; x++) for (const z of [0, map.rows - 1])
      { try { B.spawnUnit('knight', x, z, z === 0 ? 'foe' : 'mine'); } catch (e) {} }
    const boxes = B.units.map(u => { const b = B.unitScreenBox(u); return b ? { z: u.z, top: b.top, bottom: b.top + b.height, h: b.height } : null; }).filter(Boolean);
    const far = boxes.filter(b => b.z === 0), near = boxes.filter(b => b.z === map.rows - 1);
    const ih = win.innerHeight, iw = win.innerWidth;
    /* the widest the LATTICE reaches, left and right, at the near row */
    const { project, gw, tileR, tileElev } = win;
    let lo = 1e9, hi = -1e9;
    for (let z = 0; z < map.rows; z++) for (const x of [0, map.cols - 1]) {
      const q = project(gw(x, z, tileElev(x, z))); if (!q) continue;
      lo = Math.min(lo, q.x - tileR() * q.s); hi = Math.max(hi, q.x + tileR() * q.s);
    }
    return {
      fit, iw, ih,
      floorPx: +(ih * (1 / 13.5)).toFixed(1),          /* CAM_FIT.spriteMin * box.h */
      spriteMeetsFloor: fit.unitH >= ih * (1 / 13.5),
      boardPctH: fit.board.pctH,
      skyAboveFarEdgePx: fit.board.top,
      floorBelowNearEdgePx: +(ih - fit.board.bottom).toFixed(0),
      skyAboveTallestHeadPx: +Math.min(...boxes.map(b => b.top)).toFixed(0),
      floorBelowLowestFootPx: +(ih - Math.max(...boxes.map(b => b.bottom))).toFixed(0),
      farHeadTop: +Math.min(...far.map(b => b.top)).toFixed(0),
      nearFootBottom: +Math.max(...near.map(b => b.bottom)).toFixed(0),
      latticeLeftPx: +lo.toFixed(0), latticeRightPx: +hi.toFixed(0),
      latticeWidthPct: +(100 * (hi - lo) / iw).toFixed(0)
    };
  });
  await page.close();
  return out;
}

const sizes = [[1600, 900], [1100, 800], [1920, 1080], [1366, 768]];
const rows = [];
for (const [w, h] of sizes) {
  const r = await probe(w, h);
  rows.push({ win: w + 'x' + h, r });
  console.log('\n══ ' + w + 'x' + h + ' ══');
  console.log(JSON.stringify(r, null, 1));
}

console.log('\n╔══ SUMMARY ════════════════════════════════════════════════════════');
console.log('║ win        host      pitch  hexNear  unitH  floor  meets?  board%H  sky↑  floor↓  lattice%W');
for (const { win, r } of rows) {
  if (!r) { console.log('║ ' + win + '  (no stage)'); continue; }
  console.log('║ ' + win.padEnd(10) + ' ' + (r.fit.host.w + 'x' + r.fit.host.h).padEnd(9) +
    String(r.fit.pitchDeg).padEnd(7) + String(r.fit.hexNear).padEnd(9) +
    String(r.fit.unitH).padEnd(7) + String(r.floorPx).padEnd(7) +
    (r.spriteMeetsFloor ? 'YES   ' : 'NO    ').padEnd(8) +
    (r.boardPctH + '%').padEnd(9) + String(r.skyAboveTallestHeadPx).padEnd(6) +
    String(r.floorBelowLowestFootPx).padEnd(8) + r.latticeWidthPct + '%');
}
console.log('╚═══════════════════════════════════════════════════════════════════');

await browser.close(); server.close();
