/* ══════════════════════════════════════════════════════════════════════════
   CRITZ-P4-CADENCE — independent critic probe, round 2.

   The builder moved the plot-mood tick hook from economyTick's tail (1 s) to
   vitalsTick's tail (2 s) to fix a coverage-staleness bug. The fix is real and
   drive-moodreact §9b proves it. THIS probe asks the question §9b cannot ask,
   because §9b drives __nc.step — which calls economyTick and vitalsTick 1:1,
   every single step.

   THE SHIPPED LOOP DOES NOT PAIR THEM. animate() runs economyTick on a 1 s
   accumulator (:42019) and vitalsTick on a 2 s one (:42050). HALF of all
   economy beats are NOT followed by a vitals beat. MythicPower.solve() runs
   inside economyTick and takes `pop` — so factorAt changes on those lone beats
   with NO placement at all. Nothing now invalidates /src/plotmood on them, so
   the memo the BADGE and the DOSSIER both read is a beat behind its own source
   for a full second — which is the exact class of defect §9b was written to
   catch, moved from `need:*` onto `power`.

   Q1 Under the SHIPPED cadence, does the memo disagree with factorAt on the
      lone economy beats?
   Q2 Does putting the O(1) invalidate BACK at economyTick's tail — leaving the
      eager sync() where the builder correctly moved it — close Q1 without
      reopening the coverage bug?

   ⚠ WHAT IS SYNTHETIC HERE, STATED. The city clock is real EST wall clock
     (estClock(), :5541), so an hour-driven solar swing cannot be driven in a
     60-frame test. Population is nudged at each VITALS beat instead — which is
     the thing vitalsTick itself writes there (game.pop.npc, :33176) — because
     the subject under test is the ORDER OF THE HOOKS, not what moved the
     number. Any pure-tick change to the power snapshot reproduces it.

   Run: node .gauntlet/critz-p4-cadence.mjs
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
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__ncModals = 0;
  setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) { window.__ncModals++; b.click(); } }, 8);
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

/* ── 0. board — a grid whose ratio is FRACTIONAL, so factorAt is sensitive ── */
console.log('\n0. board — one small generator against real draws, so the demand ladder is not pinned');
const boot = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { try { const r = await nc.place(t, x, z); try { nc.build.finishAll('critz'); } catch (e) {} return !!r; } catch (e) { return false; } };
  for (let x = 3; x <= 21; x++) await put('road', x, 12);
  const built = [];
  if (await put('wind', 3, 8)) built.push('wind');
  if (await put('solar', 5, 8)) built.push('solar');
  for (let i = 0; i < 6; i++) if (await put('housing', 5 + i * 2, 11)) built.push('housing' + i);
  for (let i = 0; i < 5; i++) if (await put('workshop', 6 + i * 2, 13)) built.push('workshop' + i);
  await put('streetlight', 5, 10);
  await put('purifier', 4, 11);
  try { nc.build.finishAll('critz'); } catch (e) {}
  window.confirm = _c;
  nc.game.army.workers = 40;
  await nc.step(2.0, 4);
  return { pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready()),
           icons: !!window.MythicPlotIcons,
           tiles: Object.keys(nc.game.tiles).length, built,
           power: { model: nc.game.power.model, factor: nc.game.power.factor,
                    gen: nc.game.power.gen, demand: nc.game.power.demand },
           report: nc.plotMoodReport() };
});
ok('/src/plotmood is mounted', boot.pm, JSON.stringify({ tiles: boot.tiles, power: boot.power }));
console.log('   built ' + JSON.stringify(boot.built));
console.log('   byReason ' + JSON.stringify(boot.report && boot.report.byReason));

/* the faithful replay of animate()'s accumulators */
await page.evaluate(() => {
  window.__critzRun = async function (opts) {
    const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons, T = nc.ticks;
    const key = opts.key, X = opts.x, Z = opts.z;
    if (opts.layer) { I && I.show(); } else { I && I.hide(); }
    const rows = [];
    let ecoAcc = 0, vitAcc = 0, hudAcc = 0, k = 0;
    const DT = 0.5;
    for (let f = 0; f < opts.frames; f++) {
      ecoAcc += DT; vitAcc += DT; hudAcc += DT;
      let ranEco = false, ranVit = false;
      if (ecoAcc >= 1) { await T.economyTick(ecoAcc / 60); ecoAcc = 0; ranEco = true;
        if (opts.ecoInvalidate) M.invalidate('tick-eco');       /* ← THE LINE UNDER TEST */
      }
      if (vitAcc >= 2) { T.vitalsTick(vitAcc); vitAcc = 0; ranVit = true;
        /* the pure-tick perturbation: pop, the field vitalsTick itself writes */
        k++; nc.game.pop.npc = 20 + (k % 9) * 14;
        M.invalidate('tick');                                   /* the SHIPPED hook */
        if (I && I.visible && I.visible()) I.sync();             /* the SHIPPED hook */
      }
      if (hudAcc > 0.5) { hudAcc = 0;
        if (!(I && I.mounted && I.mounted() && !I.visible())) M.beat();   /* moodBeat() */
      }
      if (!ranEco) continue;
      const memo = M.moodAtKey(key);
      let live = null;
      try { const r = window.MythicPower.factorAt(X, Z); live = (r && isFinite(r.factor)) ? r.factor : null; } catch (e) {}
      const term = memo && memo.terms ? (memo.terms.find(t => t.k === 'power') || null) : null;
      rows.push({ f, ranVit, memoPower: term ? term.s : null, live: live == null ? null : +live.toFixed(4),
                  agree: (term && live != null) ? Math.abs(term.s - live) <= 2e-4 : null,
                  score: memo && memo.score, reason: memo && memo.reason });
    }
    return rows;
  };
});

const target = await page.evaluate(() => {
  const M = window.MythicPlotMood;
  for (const k of Object.keys(window.__nc.game.tiles)) {
    const m = M.moodAtKey(k);
    if (!m || !m.terms) continue;
    const t = m.terms.find(x => x.k === 'power');
    if (t) { const c = k.split(','); return { key: k, x: +c[0], z: +c[1], term: t.s }; }
  }
  return null;
});
console.log('   target ' + JSON.stringify(target));

const summarise = (rows, label) => {
  const live = [...new Set(rows.map(r => r.live))];
  const lone = rows.filter(r => !r.ranVit);
  const paired = rows.filter(r => r.ranVit);
  const loneBad = lone.filter(r => r.agree === false);
  const pairBad = paired.filter(r => r.agree === false);
  console.log('   ' + label);
  console.log('     factorAt values seen: ' + JSON.stringify(live.slice(0, 12)) + '  (' + live.length + ' distinct)');
  console.log('     disagreements — LONE economy beats:   ' + loneBad.length + '/' + lone.length);
  console.log('     disagreements — PAIRED (eco+vitals):  ' + pairBad.length + '/' + paired.length);
  for (const r of loneBad.slice(0, 4))
    console.log('        e.g. frame ' + r.f + '  memo.power=' + r.memoPower + '  MythicPower.factorAt=' + r.live + '  face=' + r.score + '/' + r.reason);
  return { moved: live.length > 1, loneBad: loneBad.length, lone: lone.length, pairBad: pairBad.length, paired: paired.length };
};

console.log('\n1. THE SHIPPED CADENCE (eco 1 s / vitals 2 s) — badge memo vs MythicPower.factorAt');
const A = summarise(await page.evaluate((t) => window.__critzRun({ key: t.key, x: t.x, z: t.z, frames: 64, layer: true, ecoInvalidate: false }), target), 'as shipped');
ok('THE RUN WAS CAPABLE OF FAILING — factorAt actually moved', A.moved, 'distinct live values');

console.log('\n2. THE PROPOSED FIX — invalidate() ALSO at economyTick; sync() stays at vitalsTick');
const B = summarise(await page.evaluate((t) => window.__critzRun({ key: t.key, x: t.x, z: t.z, frames: 64, layer: true, ecoInvalidate: true }), target), 'with the eco invalidate restored');
ok('control — factorAt moved in this run too', B.moved, 'distinct live values');
ok('THE FIX CLOSES IT — zero lone-beat disagreements with the eco invalidate back',
   B.loneBad === 0, 'shipped ' + A.loneBad + '/' + A.lone + '   →   fixed ' + B.loneBad + '/' + B.lone);

/* ── 3. …and does the proposed fix REOPEN the coverage bug §9b closed? ──── */
console.log('\n3. the regression guard — with the eco invalidate ADDED, do need:* terms still agree with game.cov.pct?');
const cov = await page.evaluate(async (t) => {
  const nc = window.__nc, M = window.MythicPlotMood, I = window.MythicPlotIcons, T = nc.ticks;
  nc.game.cov.ramp = 5; nc.game.pop.npc = Math.max(nc.game.pop.npc, 60);
  I && I.show();
  /* the SAME predicate /src/plotmood:356 uses:  v < needFloor ? clamp(v) : 1 */
  const FLOOR = ((window.MythicPlotMood.tuning || {}).needFloor) || 0.85;
  const out = { beats: 0, movedBeats: 0, short: 0, stale: 0, sample: null };
  let ecoAcc = 0, vitAcc = 0, hudAcc = 0, prev = null;
  for (let f = 0; f < 64; f++) {
    ecoAcc += 0.5; vitAcc += 0.5; hudAcc += 0.5;
    if (ecoAcc >= 1) { await T.economyTick(ecoAcc / 60); ecoAcc = 0; M.invalidate('tick-eco'); }
    if (vitAcc >= 2) { T.vitalsTick(vitAcc); vitAcc = 0; M.invalidate('tick'); if (I && I.visible()) I.sync(); }
    if (hudAcc > 0.5) { hudAcc = 0; if (!(I.mounted() && !I.visible())) M.beat(); }
    const memo = M.moodAtKey(t.key);
    if (!memo || !memo.terms) continue;
    out.beats++;
    const pct = nc.game.cov.pct || {};
    const now = JSON.stringify(pct);
    if (prev && prev !== now) out.movedBeats++;
    prev = now;
    for (const term of memo.terms) {
      if (term.k.indexOf('need:') !== 0) continue;
      const n = term.k.slice(5), c = pct[n];
      if (c == null) continue;
      if (c < FLOOR) out.short++;
      const expect = +(c < FLOOR ? Math.max(0, Math.min(1, c)) : 1).toFixed(4);
      if (Math.abs(expect - term.s) > 2e-4) { out.stale++; if (!out.sample) out.sample = { n, term: term.s, cov: c, expect }; }
    }
  }
  return out;
}, target);
console.log('   ' + JSON.stringify(cov));
ok('THE RUN WAS CAPABLE OF FAILING — coverage moved and terms sat under the floor',
   cov.movedBeats > 0 && cov.short > 0, 'moved ' + cov.movedBeats + ' · short ' + cov.short);
ok('with the eco invalidate ADDED, every need:* term STILL agrees with game.cov.pct',
   cov.stale === 0, JSON.stringify(cov));

console.log('\n' + (fails ? '🔴 ' + fails + ' assertion(s) FAILED' : '🟢 no assertion failed') +
            '  ·  page errors: ' + logs.filter(l => l.startsWith('pageerror')).length);
for (const l of logs.filter(l => l.startsWith('pageerror')).slice(0, 5)) console.log('   ' + l);
await browser.close();
server.close();
