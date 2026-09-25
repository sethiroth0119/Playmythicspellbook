/* CRITIC PASS 3 — IS THE 22 % PIXEL DELTA THE GLYPH, OR THE NEW LAMP MESH?
   drive-moodreact §5 crops ±75×52 px around the badge anchor over 14,11 and
   then places a STREET LIGHT AT 15,11 — one tile away. At that camera one tile
   is ~14 px in x, so the new pole is inside the crop. The reported 22 % is
   therefore glyph + lamp, and nothing in that section separates them.
   This runs the SAME A/B four ways in the same task, under README item 6:
     A_off → B_off   the world alone, badges hidden           (the confound)
     A_on  → B_on    the builder's number                     (glyph + world)
     A_off → A_on    the badge's own footprint before the fix
     B_off → B_on    the badge's own footprint after the fix
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8500 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'x' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => { setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) b.click(); }, 8); });

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true; B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('ab'); } catch (e) {} };
  for (let x = 4; x <= 20; x++) await put('road', x, 12);
  await put('housing', 14, 11);
  await put('housing', 22, 19); await put('road', 22, 20);
  window.confirm = _c;
  nc.game.army.workers = 8;
});
await page.waitForTimeout(400);

const r = await page.evaluate(async () => {
  const nc = window.__nc, M = window.MythicPlotMood, ICONS = window.MythicPlotIcons;
  const { renderer, scene, camera, THREE } = nc.three();
  camera.position.set(-2, 21, -9);
  if (nc.controls) { nc.controls.target.set(5, 0.6, 3); nc.controls.update(); }
  camera.position.set(-2, 21, -9);
  camera.lookAt(5, 0.6, 3);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  try { nc.cullAgents(0.001); } catch (e) {}
  const gl = renderer.domElement, CW = gl.width, CH = gl.height;
  const s = document.createElement('canvas'); s.width = CW; s.height = CH;
  const g2 = s.getContext('2d', { willReadFrequently: true });
  const shoot = () => { renderer.render(scene, camera); g2.clearRect(0, 0, CW, CH); g2.drawImage(gl, 0, 0, CW, CH); return g2.getImageData(0, 0, CW, CH).data; };
  const project = (a) => { const v = new THREE.Vector3(a.x, a.y, a.z).project(camera); return { sx: (v.x * .5 + .5) * CW, sy: (-v.y * .5 + .5) * CH }; };
  const HW = 75, HH = 52;
  const box = p => ({ x0: Math.max(0, Math.round(p.sx - HW)), y0: Math.max(0, Math.round(p.sy - HH)), x1: Math.min(CW, Math.round(p.sx + HW)), y1: Math.min(CH, Math.round(p.sy + HH)) });
  const diff = (A, B, b) => { let n = 0, tot = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = (y * CW + x) * 4; tot++;
      if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i + 1] - B[i + 1]) > 6 || Math.abs(A[i + 2] - B[i + 2]) > 6) n++; }
    return +(100 * n / Math.max(1, tot)).toFixed(2); };

  ICONS.show(); M.repaint(true); ICONS.sync();
  const aT = nc.plotIconAnchor(14, 11);
  const bT = box(project(aT));
  // where does the LAMP tile land relative to the crop?
  const lampGround = project({ x: (15 - 12) * 1 + 0.5, y: 0, z: (11 - 12) + 0.5 });   // rough; corrected below
  const moodA = M.moodAtKey('14,11');

  shoot();                                   // warm
  const A_on = shoot();
  ICONS.hide();
  shoot();                                   // warm after visibility flip
  const A_off = shoot();

  // STATE B — the shipped placement
  const _c = window.confirm; window.confirm = () => true;
  await nc.place('streetlight', 15, 11);
  try { nc.build.finishAll('ab'); } catch (e) {}
  window.confirm = _c;
  try { nc.cullAgents(0.001); } catch (e) {}
  M.repaint(true);
  // badges still hidden here
  shoot();
  const B_off = shoot();
  ICONS.show(); M.repaint(true); ICONS.sync();
  shoot();
  const B_on = shoot();
  const moodB = M.moodAtKey('14,11');

  return {
    crop: bT, anchorT: aT,
    moodA: moodA && { score: moodA.score, reason: moodA.reason },
    moodB: moodB && { score: moodB.score, reason: moodB.reason },
    world_only:  diff(A_off, B_off, bT),   // the confound: the lamp mesh + lighting
    builders:    diff(A_on,  B_on,  bT),   // what §5 reports
    glyph_before:diff(A_off, A_on,  bT),   // the badge's own footprint, state A
    glyph_after: diff(B_off, B_on,  bT),   // the badge's own footprint, state B
    lampGround,
    cost: ICONS.cost(),
  };
});

console.log('\ncrop over the badge at 14,11: ' + JSON.stringify(r.crop) + '  (anchor ' + JSON.stringify(r.anchorT) + ')');
console.log('mood 14,11: ' + JSON.stringify(r.moodA) + '  →  ' + JSON.stringify(r.moodB));
console.log('\n  A_off → B_off   world alone, badges HIDDEN            : ' + r.world_only + '%   ← the confound');
console.log('  A_on  → B_on    what drive-moodreact §5 reports        : ' + r.builders + '%');
console.log('  A_off → A_on    the badge footprint BEFORE the fix     : ' + r.glyph_before + '%');
console.log('  B_off → B_on    the badge footprint AFTER  the fix     : ' + r.glyph_after + '%');
console.log('  one mesh? ' + JSON.stringify(r.cost));
ok('the glyph is a real, measurable part of the crop (not the lamp mesh alone)', r.glyph_before > 1, r.glyph_before + '%');
ok('the reported delta is NOT dominated by the new lamp mesh', r.world_only < r.builders / 3,
   'world alone ' + r.world_only + '% vs reported ' + r.builders + '%');
console.log(fails ? '\nRED: ' + fails : '\nGREEN');
await browser.close(); server.close();
