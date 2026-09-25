/* ══════════════════════════════════════════════════════════════════════════
   CRITZ-P4-DOSSIER — the sharper half of the cadence finding.

   /src/plotmood's header opens with: "`score` is the MINIMUM of those terms and
   `reason` is the id of whichever one produced it. So the face and the sentence
   under it can never disagree."

   node-city :31456 (pmEnrich, the `power` arm) re-reads MythicPower.factorAt
   LIVE, while the FACE that selected `id === 'power'` came from the memo. As
   long as the memo is invalidated in the same breath as the power solve, those
   are the same number. Since the tick hook moved off economyTick's tail, they
   are not — on every economy beat that is not also a vitals beat.

   This measures the two against each other on the shipped cadence.
   Run: node .gauntlet/critz-p4-dossier.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 90);
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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
                            : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => { setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) b.click(); }, 8); });

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

console.log('\n0. board');
const boot = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { try { const r = await nc.place(t, x, z); try { nc.build.finishAll('cz'); } catch (e) {} return !!r; } catch (e) { return false; } };
  for (let x = 3; x <= 21; x++) await put('road', x, 12);
  await put('wind', 3, 8); await put('solar', 5, 8);
  for (let i = 0; i < 6; i++) await put('housing', 5 + i * 2, 11);
  for (let i = 0; i < 5; i++) await put('workshop', 6 + i * 2, 13);
  for (let x = 4; x <= 20; x++) await put('streetlight', x, 10);   // kill `dark` so power can win
  await put('purifier', 4, 11);
  try { nc.build.finishAll('cz'); } catch (e) {}
  window.confirm = _c;
  nc.game.army.workers = 40;
  await nc.step(2.0, 4);
  return { tiles: Object.keys(nc.game.tiles).length, byReason: nc.plotMoodReport().byReason };
});
console.log('   tiles ' + boot.tiles + ' · byReason ' + JSON.stringify(boot.byReason));

/* Drive the shipped cadence and, on every economy beat, ask BOTH halves of the
   card the same question: the memo (which picked the face) and the live read
   (which writes the sentence under it). */
const run = await page.evaluate(async () => {
  const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons, T = nc.ticks;
  I && I.show();
  /* Pick by MEASURED VARIANCE, not by score. The first cut picked "the tile
     whose power term is lowest", which selected an OFF-GRID tile pinned at the
     POWER_FLOOR of 0.5 — a number that cannot move and therefore cannot be
     caught being a beat behind. Sample factorAt at two very different
     populations and take the tile that actually responds. */
  const fac = (x, z) => { try { const r = window.MythicPower.factorAt(x, z); return (r && isFinite(r.factor)) ? r.factor : null; } catch (e) { return null; } };
  const cands = [];
  for (const k of Object.keys(nc.game.tiles)) {
    const m = M.moodAtKey(k); if (!m || !m.terms) continue;
    if (!m.terms.find(x => x.k === 'power')) continue;
    const c = k.split(','); cands.push({ key: k, x: +c[0], z: +c[1] });
  }
  nc.game.pop.npc = 20; await T.economyTick(1 / 60);
  for (const c of cands) c.lo = fac(c.x, c.z);
  nc.game.pop.npc = 160; await T.economyTick(1 / 60);
  for (const c of cands) c.hi = fac(c.x, c.z);
  let best = null;
  for (const c of cands) {
    if (c.lo == null || c.hi == null) continue;
    const d = Math.abs(c.hi - c.lo);
    if (!best || d > best.d) best = { key: c.key, x: c.x, z: c.z, lo: c.lo, hi: c.hi, d };
  }
  if (!best || best.d < 1e-3) return { err: 'no tile on this board has a factorAt that responds to demand (candidates ' + cands.length + ')' };
  const rows = [];
  let ecoAcc = 0, vitAcc = 0, hudAcc = 0, k = 0;
  for (let f = 0; f < 64; f++) {
    ecoAcc += 0.5; vitAcc += 0.5; hudAcc += 0.5;
    let ranEco = false, ranVit = false;
    if (ecoAcc >= 1) { await T.economyTick(ecoAcc / 60); ecoAcc = 0; ranEco = true; }
    if (vitAcc >= 2) { T.vitalsTick(vitAcc); vitAcc = 0; ranVit = true;
      k++; nc.game.pop.npc = 20 + (k % 9) * 16;
      M.invalidate('tick'); if (I && I.visible()) I.sync(); }
    if (hudAcc > 0.5) { hudAcc = 0; if (!(I.mounted() && !I.visible())) M.beat(); }
    if (!ranEco) continue;
    const memo = M.moodAtKey(best.key);
    const memoTerm = memo && memo.terms ? memo.terms.find(t => t.k === 'power') : null;
    let live = null;
    try { const r = window.MythicPower.factorAt(best.x, best.z); live = (r && isFinite(r.factor)) ? r.factor : null; } catch (e) {}
    // THE CARD ITSELF — plotMoodAt() is what openInspect renders (:31623)
    const card = nc.plotMood(best.x, best.z);
    rows.push({ f, ranVit,
                faceReason: memo && memo.reason, faceScore: memo && memo.score,
                memoPower: memoTerm ? memoTerm.s : null,
                livePower: live == null ? null : +live.toFixed(4),
                cardTop: card && card.top ? { id: card.top.id, value: card.top.value, txt: card.top.valueTxt } : null });
  }
  return { target: best, rows };
});
if (run.err) { console.log('  ABORT ' + run.err); }
else {
  const lone = run.rows.filter(r => !r.ranVit);
  const paired = run.rows.filter(r => r.ranVit);
  const bad = lone.filter(r => r.memoPower != null && r.livePower != null && Math.abs(r.memoPower - r.livePower) > 2e-4);
  const pbad = paired.filter(r => r.memoPower != null && r.livePower != null && Math.abs(r.memoPower - r.livePower) > 2e-4);
  console.log('\n1. the memo that chose the FACE vs the live read that writes the SENTENCE');
  console.log('   target ' + JSON.stringify(run.target));
  console.log('   distinct live factorAt values: ' + [...new Set(run.rows.map(r => r.livePower))].length);
  console.log('   LONE economy beats where they disagree:   ' + bad.length + '/' + lone.length);
  console.log('   PAIRED beats (control) where they disagree: ' + pbad.length + '/' + paired.length);
  for (const r of bad.slice(0, 6))
    console.log('      frame ' + r.f + '  face=' + r.faceScore + '/' + r.faceReason +
                '   memo.power=' + r.memoPower + '   MythicPower.factorAt=' + r.livePower +
                '   card.top=' + JSON.stringify(r.cardTop));
  ok('THE RUN WAS CAPABLE OF FAILING — factorAt moved', [...new Set(run.rows.map(r => r.livePower))].length > 1);
  ok('the face and the number under it never disagree (the header\'s own promise)', bad.length === 0,
     bad.length + '/' + lone.length + ' lone beats disagree · control ' + pbad.length + '/' + paired.length);
}
console.log('\n' + (fails ? '🔴 ' + fails + ' FAILED' : '🟢 clean') + ' · page errors ' + logs.length);
await browser.close(); server.close();
