/* CRIT-BATTLEUI-LOOK2 — close crops of the three places the report's claims
   live: the top edge of the stage (heads), the bottom edge (near row vs the
   hand strip), and the battle-log modal that #bsxLog is the only door to.
   The click is dispatched in-page — playwright's actionability wait never
   settles here because the pane composites at ~0.56 Hz.
   node .gauntlet/crit-battleui-look2.mjs */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('D:/game-deploy', 'public');
const OUT = path.resolve('D:/game-deploy', 'tmp'); fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp' };
const PORT = 8900 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

for (const [w, h] of [[1600, 900], [1100, 800]]) {
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
  await page.waitForTimeout(8000);
  /* put a unit on every far-rank and near-rank tile so the extremes are visible,
     then drive the stage clock directly */
  const info = await page.evaluate(() => {
    const win = document.querySelector('iframe.bb-stage').contentWindow;
    const B = win.Board, map = B.map;
    for (let x = 0; x < map.cols; x++) { try { B.spawnUnit('wyrm', x, 0, 'foe'); } catch (e) {} }
    for (let x = 0; x < map.cols; x++) { try { B.spawnUnit('wyrm', x, map.rows - 1, 'mine'); } catch (e) {} }
    let t = 700000, n = 0;
    for (let i = 0; i < 40; i++) { t += 16.7; try { win.frame(t); n++; } catch (e) {} }
    const hr = document.querySelector('iframe.bb-stage').getBoundingClientRect();
    const tops = B.units.filter(u => u.z === 0).map(u => B.unitScreenBox(u)).filter(Boolean).map(b => b.top);
    const bots = B.units.filter(u => u.z === map.rows - 1).map(u => B.unitScreenBox(u)).filter(Boolean).map(b => b.top + b.height);
    return { frames: n, host: { x: hr.x, y: hr.y, w: hr.width, h: hr.height },
             farHeadTop: Math.min(...tops), nearFootBottom: Math.max(...bots), ih: win.innerHeight };
  });
  console.log('\n' + w + 'x' + h + '  frames landed=' + info.frames +
    '  far head top=' + info.farHeadTop.toFixed(1) + 'px  near foot bottom=' +
    info.nearFootBottom.toFixed(1) + 'px  stage h=' + info.ih);

  /* ⚠ page.screenshot() blocks on document.fonts.ready, which never settles on
     this page once the battle screen is up — the same 0.56 Hz compositor
     problem in a different coat. CDP Page.captureScreenshot has no such wait. */
  const cdp = await page.context().newCDPSession(page);
  const shot = async (name, clip) => {
    const f = path.join(OUT, name);
    const args = { format: 'png', captureBeyondViewport: false };
    if (clip) args.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', args);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('  -> ' + f);
  };
  await shot('bui-' + w + '-top.png',
    { x: info.host.x, y: info.host.y, width: info.host.w, height: Math.min(info.host.h, 330) });
  await shot('bui-' + w + '-bottom.png',
    { x: info.host.x, y: Math.max(0, info.host.y + info.host.h - 300), width: info.host.w, height: Math.min(300, h - (info.host.y + info.host.h - 300)) });

  /* the battle log — dispatched, not playwright-clicked */
  const opened = await page.evaluate(() => {
    const b = document.getElementById('bsxLog'); if (!b) return 'no button';
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return !!(App.ui && App.ui.battleLogOpen);
  });
  await page.waitForTimeout(1500);
  console.log('  battleLogOpen after dispatching a click on #bsxLog: ' + opened);
  await shot('bui-' + w + '-log.png', undefined);
  await page.close();
}
await browser.close(); server.close();
