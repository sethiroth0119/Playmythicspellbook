/* CRITIC HARNESS for P4 — independent of the builder's drive-moodreact.mjs.
   Three questions the builder's own driver does not answer:
     A. Is the purifier order really instant (the builder's stated limitation),
        or is `timed:false` a bug in his own driver (t.bld read AFTER finishAll)?
     B. THE BAR'S ACTUAL bldFinish TEST — a NEIGHBOUR's frown must NOT clear at
        tryPlace time and MUST clear at bldFinish. His §3 only reads the placed
        tile itself.
     C. RED MUTATION — if MythicPlotMood.invalidate() is stubbed to a no-op, do
        the before/after pairs still "pass"? If they do, the five seam wrappers
        are decorative and the whole piece is a tautology.
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'D:/game-deploy';
const ROOT = path.resolve(REPO, 'public');
const THREE_DIR = path.resolve(REPO, '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 90);

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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__ncModals = 0;
  setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) { window.__ncModals++; b.click(); } }, 8);
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const sr = (m) => (m ? m.score + '/' + m.reason : String(m));
const termOf = (m, k) => { if (!m || !m.terms) return null; const t = m.terms.find(x => x.k === k); return t ? t.s : null; };

console.log('\nA. is /src/economy mounted, and is a service building actually TIMED?');
const dur = await page.evaluate(() => {
  const nc = window.__nc;
  const out = { econ: !!(window.MythicEconomy && window.MythicEconomy.ready && window.MythicEconomy.ready()) };
  const tf = nc.build && nc.build.timeFor;
  out.timeFor = typeof tf === 'function';
  const probe = {};
  for (const ty of ['purifier', 'streetlight', 'road', 'clinic', 'housing', 'sawmill', 'well', 'shrine', 'watchtower'])
    if (nc.BUILDINGS[ty]) probe[ty] = tf ? tf(ty, 1, 0, 1) : null;
  out.probe = probe;
  // which rows supply health / food / safety?
  const svc = [];
  for (const ty in nc.BUILDINGS) { const d = nc.BUILDINGS[ty]; if (d && d.svc && d.svc.need) svc.push([ty, d.svc.need, tf ? tf(ty, 1, 0, 1) : null]); }
  out.svc = svc.slice(0, 40);
  return out;
});
console.log('   economy mounted: ' + dur.econ + ' · build.timeFor: ' + dur.timeFor);
console.log('   durations(s): ' + JSON.stringify(dur.probe));
console.log('   service rows [type, need, seconds]: ' + JSON.stringify(dur.svc));

/* Build a board: a road spine and a target house whose worst need is a service. */
console.log('\nB. board');
const built = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true; B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('crit'); } catch (e) {} };
  for (let x = 4; x <= 20; x++) await put('road', x, 12);
  await put('housing', 8, 11);
  await put('housing', 18, 11);
  await put('streetlight', 8, 11 - 0 + 0);   // no-op tile guard; lamp placed next line
  await put('streetlight', 9, 11);
  await put('streetlight', 17, 11);
  window.confirm = _c;
  nc.game.army.workers = 8;
  await nc.step(0.5, 1);
  return { tiles: Object.keys(nc.game.tiles).length, t: window.MythicPlotMood.moodAtKey('8,11'), c: window.MythicPlotMood.moodAtKey('18,11') };
});
console.log('   tiles ' + built.tiles + ' · target 8,11 = ' + sr(built.t) + ' · control 18,11 = ' + sr(built.c));
console.log('   target terms: ' + JSON.stringify(built.t && built.t.terms));

/* ── C. THE BAR'S bldFinish TEST — a NEIGHBOUR's frown, not the placed tile ── */
console.log('\nC. bldFinish — does a TIMED service leave the NEIGHBOUR frowning until it finishes?');
const bf = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const K = '8,11';
  const before = PM.moodAtKey(K);
  const worst = before && before.reason;
  // pick a service building that supplies the target's worst NEED
  let want = null;
  if (worst && worst.indexOf('need:') === 0) want = worst.slice(5);
  let type = null;
  for (const ty in nc.BUILDINGS) {
    const d = nc.BUILDINGS[ty];
    if (d && d.svc && d.svc.need === want) { type = ty; break; }
  }
  if (!type) return { err: 'no service row supplies ' + want, worst };
  const _c = window.confirm; window.confirm = () => true;
  await nc.place(type, 6, 11);
  window.confirm = _c;
  const t = nc.game.tiles['6,11'];
  const isSite = !!(t && t.bld);
  const bldSnapshot = t && t.bld ? JSON.parse(JSON.stringify(t.bld)) : null;
  // step the clock WITH the scaffold standing — coverage must NOT improve
  await nc.step(0.5, 1);
  const t2 = nc.game.tiles['6,11'];
  const stillSite = !!(t2 && t2.bld);
  const atScaffold = PM.moodAtKey(K);
  const covScaffold = want ? nc.game.cov.pct[want] : null;
  // now finish it through the shipped path and step again
  try { nc.build.finishAll('crit'); } catch (e) {}
  const finished = !nc.game.tiles['6,11'].bld;
  const lastWhyAtFinish = nc.plotMoodReport().lastWhy;
  await nc.step(0.5, 1);
  const atFinish = PM.moodAtKey(K);
  const covFinish = want ? nc.game.cov.pct[want] : null;
  return { worst, want, type, isSite, bldSnapshot, stillSite, finished, lastWhyAtFinish,
           before, atScaffold, atFinish, covScaffold, covFinish };
});
if (bf.err) { console.log('   ERR ' + bf.err); }
else {
  console.log('   target worst term = ' + bf.worst + ' → service row chosen: ' + bf.type);
  console.log('   at order  : site=' + bf.isSite + ' bld=' + JSON.stringify(bf.bldSnapshot));
  console.log('   after a tick with the SCAFFOLD standing : still a site=' + bf.stillSite
    + ' · target ' + sr(bf.atScaffold) + ' · cov.' + bf.want + '=' + bf.covScaffold);
  console.log('   after bldFinish + a tick               : finished=' + bf.finished
    + ' · target ' + sr(bf.atFinish) + ' · cov.' + bf.want + '=' + bf.covFinish + ' · lastWhy=' + bf.lastWhyAtFinish);
  ok('the order really is TIMED (a scaffold that survives a tick)', bf.isSite === true && bf.stillSite === true,
     'isSite=' + bf.isSite + ' stillSite=' + bf.stillSite);
  ok('the NEIGHBOUR frown did NOT clear while only the scaffold stood',
     JSON.stringify(bf.before) === JSON.stringify(bf.atScaffold),
     sr(bf.before) + '  →  ' + sr(bf.atScaffold));
  ok('the NEIGHBOUR frown DID clear at bldFinish, same session, no reload',
     bf.atFinish && (bf.atFinish.score > (bf.atScaffold ? bf.atScaffold.score : 0) || bf.atFinish.reason !== bf.atScaffold.reason),
     sr(bf.atScaffold) + '  →  ' + sr(bf.atFinish));
  ok('bldFinish is the seam that fired', bf.lastWhyAtFinish === 'finish', 'lastWhy=' + bf.lastWhyAtFinish);
}

/* ── D. RED MUTATION — stub invalidate() and re-run the lamp seam ── */
console.log('\nD. RED MUTATION — with MythicPlotMood.invalidate() stubbed to a no-op,');
console.log('   does the same lamp placement still appear to clear the frown?');
const red = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const _c = window.confirm; window.confirm = () => true;
  // a fresh dark house far from the lamps, on the spine
  await nc.place('housing', 14, 11); try { nc.build.finishAll('crit'); } catch (e) {}
  const K = '14,11';
  const before = PM.moodAtKey(K);
  // RED: kill every seam ping
  const real = PM.invalidate;
  PM.invalidate = () => {};
  await nc.place('streetlight', 15, 11); try { nc.build.finishAll('crit'); } catch (e) {}
  const redAfter = PM.moodAtKey(K);
  // GREEN: restore the seam and ask again — nothing else changes
  PM.invalidate = real;
  PM.invalidate('crit-restore');
  const greenAfter = PM.moodAtKey(K);
  window.confirm = _c;
  return { before, redAfter, greenAfter, lit: true };
});
console.log('   before (no lamp)        : ' + sr(red.before) + '  dark=' + termOf(red.before, 'dark'));
console.log('   lamp placed, seam KILLED: ' + sr(red.redAfter) + '  dark=' + termOf(red.redAfter, 'dark'));
console.log('   seam restored           : ' + sr(red.greenAfter) + '  dark=' + termOf(red.greenAfter, 'dark'));
ok('RED — with the seam stubbed the reading is STALE (so the wrapper is load-bearing, not decorative)',
   JSON.stringify(red.before) === JSON.stringify(red.redAfter), sr(red.before) + ' → ' + sr(red.redAfter));
ok('GREEN — restoring the seam moves it', termOf(red.greenAfter, 'dark') === 1, 'dark=' + termOf(red.greenAfter, 'dark'));

/* ── E. Does the unconditional tick invalidate MASK the water/power wrappers? ── */
console.log('\nE. is the water seam wrapper load-bearing, or masked by invalidate(\'tick\')?');
const mask = await page.evaluate(async () => {
  const nc = window.__nc, PM = window.MythicPlotMood, W = window.MythicWater;
  if (!W || !W.ready()) return { err: 'no water module' };
  const K = '8,11';
  const b0 = PM.moodAtKey(K);
  const real = PM.invalidate;
  PM.invalidate = () => {};                       // kill EVERY seam, tick included
  const n = W.pipes.add([{ x: 8, z: 12 }, { x: 9, z: 12 }]);
  const immediately = PM.moodAtKey(K);            // no tick yet
  await nc.step(0.5, 1);                          // a tick — its invalidate is stubbed too
  const afterTickStubbed = PM.moodAtKey(K);
  PM.invalidate = real; PM.invalidate('crit');
  const afterRestore = PM.moodAtKey(K);
  return { b0, n, immediately, afterTickStubbed, afterRestore, served: W.servedAt ? W.servedAt(K) : null };
});
if (mask.err) console.log('   ' + mask.err);
else {
  console.log('   before           : ' + sr(mask.b0));
  console.log('   pipe laid (' + mask.n + ' cells), seams KILLED, read immediately : ' + sr(mask.immediately));
  console.log('   …after a full tick with every invalidate stubbed              : ' + sr(mask.afterTickStubbed));
  console.log('   …after restoring the seam                                     : ' + sr(mask.afterRestore) + ' · servedAt=' + mask.served);
}

console.log('\nlogs (last 12): ' + logs.slice(-12).join(' | '));
console.log(fails ? '\nRED: ' + fails + ' failures' : '\nGREEN');
await browser.close(); server.close();
