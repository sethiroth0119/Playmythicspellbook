/* CRITIC PASS 2 — THE BAR'S bldFinish TEST, done the way the brief words it:
   "place a TIMED build: the face must NOT clear at tryPlace time, and MUST
    clear at bldFinish".
   Subject: a house whose worst term is `power` (0.5, the shed floor). The fix
   is a GAS PLANT, which is timed. A scaffold generates nothing, so the
   neighbour must keep its frown across a full tick while only the site stands,
   and must clear at bldFinish.
   Plus: does the water seam give feedback with NO tick at all? */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8600 + (process.pid % 90);
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
const logs = [];
page.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => { window.__ncModals = 0; setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) { window.__ncModals++; b.click(); } }, 8); });

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const sr = m => (m ? m.score + '/' + m.reason : String(m));
const term = (m, k) => { if (!m || !m.terms) return null; const t = m.terms.find(x => x.k === k); return t ? t.s : null; };

console.log('\n1. board — a spine, a target house, a control house');
const b = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true; B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('crit'); } catch (e) {} };
  for (let x = 4; x <= 20; x++) await put('road', x, 12);
  await put('housing', 8, 11);
  await put('housing', 18, 11);
  await put('streetlight', 8, 11); await put('streetlight', 9, 11); await put('streetlight', 18, 11);
  window.confirm = _c;
  nc.game.army.workers = 12;
  await nc.step(0.5, 1);
  return { gasSec: nc.build.timeFor('gas', 1, 0, 1), t: window.MythicPlotMood.moodAtKey('8,11'), c: window.MythicPlotMood.moodAtKey('18,11'),
           pw: window.MythicPower ? window.MythicPower.report && window.MythicPower.report() : null };
});
console.log('   gas plant build time: ' + b.gasSec + ' s');
console.log('   target 8,11 = ' + sr(b.t) + ' · control 18,11 = ' + sr(b.c));
ok('the target is frowning on `power` before anything is built', b.t && b.t.reason === 'power', sr(b.t));

console.log('\n2. order a TIMED gas plant that would fix it — and DO NOT finish it');
const scaf = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const before = PM.moodAtKey('8,11');
  const cBefore = PM.moodAtKey('18,11');
  const _c = window.confirm; window.confirm = () => true;
  await nc.place('gas', 6, 11);
  window.confirm = _c;
  const t = nc.game.tiles['6,11'];
  const site = !!(t && t.bld);
  const lastWhy = nc.plotMoodReport().lastWhy;
  const immediately = PM.moodAtKey('8,11');
  await nc.step(0.6, 1);                       // a full tick with only the SITE standing
  const stillSite = !!(nc.game.tiles['6,11'] && nc.game.tiles['6,11'].bld);
  const afterTick = PM.moodAtKey('8,11');
  const cAfterTick = PM.moodAtKey('18,11');
  const cap = window.MythicPower && window.MythicPower.report ? window.MythicPower.report() : null;
  const fac = window.__nc.pwFactorOf(8, 11);
  return { before, cBefore, site, lastWhy, immediately, stillSite, afterTick, cAfterTick, cap, fac };
});
console.log('   at order   : site=' + scaf.site + ' lastWhy=' + scaf.lastWhy + ' · target read immediately ' + sr(scaf.immediately));
console.log('   after a tick with only the SCAFFOLD : stillSite=' + scaf.stillSite + ' · target ' + sr(scaf.afterTick)
  + ' · pwFactorOf(8,11)=' + JSON.stringify(scaf.fac) + ' · grid ' + JSON.stringify(scaf.cap && { capacity: scaf.cap.capacity, factor: scaf.cap.factor }));
ok('the order really is a TIMED build (a scaffold that survives a full tick)', scaf.site === true && scaf.stillSite === true,
   'site=' + scaf.site + ' stillSite=' + scaf.stillSite);
ok('the tryPlace wrapper said SITE, not building', scaf.lastWhy === 'place-site', 'lastWhy=' + scaf.lastWhy);
ok('THE BAR — the neighbour face did NOT clear while only the scaffold stood',
   term(scaf.afterTick, 'power') === term(scaf.before, 'power') && scaf.afterTick.reason === scaf.before.reason,
   sr(scaf.before) + '  →  ' + sr(scaf.afterTick));

console.log('\n3. now bldFinish it — the shipped completion path');
const fin = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const before = PM.moodAtKey('8,11');
  const cBefore = PM.moodAtKey('18,11');
  try { nc.build.finishAll('crit'); } catch (e) {}
  const lastWhy = nc.plotMoodReport().lastWhy;
  const exists = !nc.game.tiles['6,11'].bld;
  await nc.step(0.6, 1);
  const after = PM.moodAtKey('8,11');
  const cAfter = PM.moodAtKey('18,11');
  const cap = window.MythicPower && window.MythicPower.report ? window.MythicPower.report() : null;
  return { before, after, cBefore, cAfter, lastWhy, exists, fac: nc.pwFactorOf(8, 11), cap };
});
console.log('   finished=' + fin.exists + ' lastWhy=' + fin.lastWhy);
console.log('   target  ' + sr(fin.before) + '  →  ' + sr(fin.after) + ' · pwFactorOf(8,11)=' + JSON.stringify(fin.fac));
console.log('   control ' + sr(fin.cBefore) + '  →  ' + sr(fin.cAfter));
console.log('   grid ' + JSON.stringify(fin.cap && { capacity: fin.cap.capacity, factor: fin.cap.factor }));
ok('bldFinish fired the seam', fin.lastWhy === 'finish', 'lastWhy=' + fin.lastWhy);
ok('THE BAR — the neighbour face CLEARED at bldFinish, same session, no reload',
   term(fin.after, 'power') === 1 && fin.after.reason !== 'power',
   sr(fin.before) + '  →  ' + sr(fin.after));

console.log('\n4. water seam with NO tick at all — is the feedback immediate?');
const wat = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood, W = window.MythicWater;
  if (!W || !W.ready()) return { err: 'no water' };
  const before = PM.moodAtKey('8,11');
  const n = W.pipes.add([{ x: 8, z: 12 }, { x: 9, z: 12 }, { x: 10, z: 12 }]);
  const immediately = PM.moodAtKey('8,11');            // NO tick between these two
  const why = nc.plotMoodReport().lastWhy;
  await nc.step(0.6, 1);
  const afterTick = PM.moodAtKey('8,11');
  return { before, n, immediately, why, afterTick, served: W.servedAt('8,11') };
});
if (wat.err) console.log('   ' + wat.err);
else {
  console.log('   before ' + sr(wat.before) + ' → immediately after pipes.add (' + wat.n + ' cells, no tick) ' + sr(wat.immediately) + ' · lastWhy=' + wat.why);
  console.log('   after one tick ' + sr(wat.afterTick) + ' · servedAt=' + wat.served);
  ok('the water seam moved the reading with NO tick in between (immediate feedback)',
     JSON.stringify(wat.before) !== JSON.stringify(wat.immediately),
     sr(wat.before) + ' → ' + sr(wat.immediately));
}

console.log('\n5. verify + cost');
const v = await page.evaluate(() => ({ verify: window.__nc.plotMoodVerify(), cost: window.__nc.plotIconCost ? window.__nc.plotIconCost() : null,
   report: window.__nc.plotMoodReport() }));
console.log('   ' + JSON.stringify(v.verify));
console.log('   cost ' + JSON.stringify(v.cost));
console.log('\npageerrors: ' + (logs.length ? logs.join(' | ') : 'none'));
console.log(fails ? '\nRED: ' + fails + ' failures' : '\nGREEN');
await browser.close(); server.close();
