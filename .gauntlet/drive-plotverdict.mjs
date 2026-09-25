/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE /src/plotmood/verdict.js — the NUMBER behind the face, proved
   without drawing anything.

   Boots public/node-city/index.html in real Chromium, serves public/ over
   loopback, fulfils the page's three@0.171.0 import map out of the vendored
   copy, builds the standard gauntlet city, and then drives the sim through the
   SHIPPED seams only: __nc.place (tryPlace) and __nc.step (economyTick +
   vitalsTick + periodicSaveTick).

   🔴 NOTHING HERE PHOTOGRAPHS A FRAME. Every claim below is about the SIM, so
      the framebuffer trap in .gauntlet/README.md item 6 cannot apply and no
      renderer.render() is needed. That is deliberate: this piece is the number,
      and a number that can only be checked by looking at it is not checked.

   THE FIVE CLAIMS:
     1  WELL FORMED — a whole-grid sweep returns a row per built tile with no
        NaN / undefined / null score, and every terms[] residual |Σv − score|
        is under 0.5 (measured: it is 0, by construction — the score IS the sum).
     2  CAUSAL, PROVED ON THE SIM, THREE TIMES:
          a POWER  brown the city out through the demand side (place draws with
                   no new generation) and the set of tiles carrying a non-zero
                   power penalty must EQUAL, exactly, the set where the
                   effective per-tile factor is under 1 — computed here from
                   __nc.pwFactorOf and __nc.power().factor, i.e. from the
                   SOURCE, never from the module's own copy. The reason-flip set
                   is reported beside it.
          b WATER  raise the population and the water term must move by exactly
                   −Δ(min(1, cov.water)) × the published weight. Checked for all
                   six needs at once, per tile, to the last bit.
          c AIR    site a coal plant and the set of tiles whose pollution term
                   moved must EQUAL the set where MythicPollution's own
                   `response` moved, and the term must equal −Δresponse × weight.
     3  SEPARABLE — two houses at different exposures: scoreA − scoreB must
        equal pollutionTermA − pollutionTermB, with every other term equal.
     4  DEAD MEANS ZERO — stub MythicPollution and MythicDemographics absent and
        sources() must report them dead while their terms read EXACTLY 0. Not a
        plausible substitute: the score must fall by precisely the terms lost.
     5  THE RAMP TRAP — a sweep taken with game.cov.ramp at 0 and one taken
        after DEMAND_RAMP_SEC has expired are printed as TWO SEPARATE TABLES, so
        a fresh city cannot be photographed as falsely happy.

   Run:  node .gauntlet/drive-plotverdict.mjs
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
const PORT = 8760 + (process.pid % 60);

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
    /* FULFIL, never redirect: Playwright refuses to override an https request
       with an http URL, and NEVER substitute a CDN tag that carries an
       integrity hash — SRI rejects it silently and the page goes blank with a
       clean console. */
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
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 240)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};
const n = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

/* ── THE IN-PAGE TOOLKIT. Installed once; every phase calls it. ──────────── */
await page.evaluate(() => {
  const N = window.__nc;
  window.__pv = {
    /* One snapshot of the whole board: score, reason, and every term BY KEY, so
       a delta can be attributed to a named row instead of to "something". */
    snap() {
      const s = N.plotVerdictSweep();
      if (!s || !s.ok) return { ok: false, why: (s && s.why) || 'no sweep' };
      const m = {};
      for (const r of s.rows) {
        const tv = {}, tl = {};
        for (const t of r.terms) { tv[t.k] = t.v; tl[t.k] = !!t.live; }
        m[r.key] = { score: r.score, reason: r.reason, kind: r.kind, type: r.type, tv, tl,
                     nTerms: r.terms.length };
      }
      return { ok: true, m, ramping: s.ramping, rampLeftSec: s.rampLeftSec,
               judged: s.judged, skipped: s.skipped, cells: s.cells, sources: s.sources };
    },
    /* THE SOURCE OF THE POWER TRUTH, read straight off the host seam — NOT off
       the module. `pwFactorOf` keeps its null; the effective factor is the
       city average when it is null, which is what node-city's own pwFactorAt()
       does and therefore what the module is required to agree with. */
    power() {
      const cityF = N.power().factor;
      const out = {};
      for (const k in N.game.tiles) {
        const c = k.indexOf(',');
        const x = +k.slice(0, c), z = +k.slice(c + 1);
        const raw = N.pwFactorOf(x, z);
        const tile = (typeof raw === 'number' && isFinite(raw) && raw >= 0);
        out[k] = { raw: tile ? raw : null, eff: tile ? raw : cityF, which: tile ? 'tile' : 'city' };
      }
      return { cityF, model: N.power().model, tiles: out };
    },
    pollution() {
      const out = {};
      const P = window.MythicPollution;
      if (!P || !P.ready()) return out;
      for (const k in N.game.tiles) {
        const c = k.indexOf(',');
        const e = P.explainAt(+k.slice(0, c), +k.slice(c + 1));
        if (e && isFinite(e.response)) out[k] = e.response;
      }
      return out;
    },
    cov() { return { ...(N.game.cov.pct || {}) }; },
  };
  return true;
});

/* ── 0. BOOT ─────────────────────────────────────────────────────────────── */
console.log('\n0. boot');
const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  mod: !!(window.MythicPlotVerdict && window.MythicPlotVerdict.ready()),
  handle: typeof (window.__nc || {}).plotVerdict === 'function',
  pw: typeof (window.__nc || {}).pwFactorOf === 'function',
  wt: typeof (window.__nc || {}).wtFactorOf === 'function',
  mods: {
    power: !!(window.MythicPower && window.MythicPower.ready()),
    water: !!(window.MythicWater && window.MythicWater.ready()),
    pollution: !!(window.MythicPollution && window.MythicPollution.ready()),
    landvalue: !!(window.MythicLandValue && window.MythicLandValue.ready()),
    demographics: !!(window.MythicDemographics && window.MythicDemographics.ready()),
    tenants: !!window.MythicTenants,
    economy: !!(window.MythicEconomy && window.MythicEconomy.ready()),
    zoning: !!window.MythicZoning,
  },
}));
ok('the page booted with the diagnostics seam', boot.nc);
ok('/src/plotmood/verdict.js mounted', boot.mod);
ok('__nc.plotVerdict / pwFactorOf / wtFactorOf are on the seam', boot.handle && boot.pw && boot.wt);
console.log('   optional sources: ' + JSON.stringify(boot.mods));

/* ── 1. BUILD THE CITY ───────────────────────────────────────────────────── */
/* ⚠ NOT .gauntlet/scene.js, AND THE REASON IS MEASURED RATHER THAN ASSUMED.
   The standard scene is ~200 awaited placements, each followed by
   bld.finishAll(); on a box already running several headless Chromiums it did
   not finish step 1 in 35 minutes, twice. Nothing about this feature needs 172
   tiles — it needs homes, businesses, a generator, a polluter and variation —
   so this builds a compact district through the SAME shipped seam (__nc.place
   -> tryPlace) and states every gate it opens, in the scene's own style. A
   harness that quietly unlocks a gate is indistinguishable from one that never
   met it. */
console.log('\n1. a compact district, through tryPlace, with every gate named');
const built = await page.evaluate(async () => {
  const N = window.__nc, gates = [], fails = {}, why = {};
  /* 1. COST — canAfford/payCost consult MythicCityBridge, not game.res. */
  const B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9;
           B.addCinders = async () => true; }
  gates.push('cost: MythicCityBridge stubbed rich — the standard harness stub');
  /* 2. THE LONG-ORDER CONFIRM — headless Chromium auto-DISMISSES an unhandled
     dialog, i.e. answers Cancel, and tryPlace then returns with no toast at
     all. Answered, counted, and put back. */
  const _confirm0 = window.confirm; let confirmed = 0;
  window.confirm = () => { confirmed++; return true; };
  /* 3. THE MUNICIPAL BUILD CEILING. Lifted outright rather than answered with a
     Construction Co.: it is a gate about BUILD TIME and has nothing to do with
     what a plot feels. .gauntlet/drive-pollution.js lifts the same one, for the
     same reason and in the same words. */
  try { window.MythicEconomy.ECON.construction.municipal.maxSec = 9e6; } catch (e) {}
  gates.push('municipal ceiling: ECON.construction.municipal.maxSec raised — a BUILD TIME gate, not a mood one');
  /* 4. THE PROGRESSION TREE — granted through the module's own documented test
     seam, and listed with its point cost, because a district built on 8
     development points is a different claim from one built on none. */
  const Pg = window.MythicProgress;
  if (Pg) {
    const WANT = [['civ_services', 1], ['civ_parks', 1], ['com_high', 2], ['off_low', 2], ['ind_extract', 1]];
    let pts = 0; const got = [];
    for (const [id, c] of WANT) { let o = false; try { o = Pg._grant(id); } catch (e) {} if (o) { pts += c; got.push(id); } }
    gates.push('progression: granted ' + pts + ' dp via _grant — ' + got.join(', '));
  } else gates.push('progression: MODULE ABSENT — nothing gated, nothing granted');
  /* 5. CREW SLOTS — bldCommitted() >= bldSlots() refuses outright, so every
     placement is followed by finishAll(). */
  const done = () => { try { N.build.finishAll('plotverdict'); } catch (e) {} };
  let sink = null;
  window.__ncToastSink = (m, cls) => { if (cls === 'bad' && sink) sink.push(String(m).slice(0, 130)); };
  const P = async (t, x, z) => {
    sink = [];
    try { await N.place(t, x, z); } catch (e) { sink.push('threw: ' + e); }
    const msgs = sink; sink = null; done();
    if (!N.game.tiles[x + ',' + z]) {
      fails[t] = (fails[t] || 0) + 1;
      const r = (msgs[0] || 'refused silently — no toast').slice(0, 130);
      (why[t] || (why[t] = {}))[r] = ((why[t] || {})[r] || 0) + 1;
      return false;
    }
    return true;
  };
  /* 6. ROAD CAP — ROAD_CAP_BASE 40, +10 per finished Supply Depot, and depots
     cost pop, so the order is forced: housing, then depots, then roads. */
  try { N.game.army.workers = 80; } catch (e) {}
  gates.push('crew: 80 workers hired — an unstaffed works has a cold chimney and no output at all');

  for (let x = 4; x <= 9; x++) for (let z = 4; z <= 6; z++) await P('housing', x, z);   // 18 homes
  for (const [x, z] of [[16, 4], [17, 4], [16, 5]]) await P('depot', x, z);             // road cap 70
  for (let x = 3; x <= 14; x++) await P('road', x, 7);                                   // the street
  for (let z = 4; z <= 12; z++) await P('road', 10, z);
  for (const [t, x, z] of [['grocery', 4, 8], ['shop', 5, 8], ['restaurant', 6, 8],
                           ['office', 7, 8], ['clinic', 8, 8], ['police', 9, 8],
                           ['farm', 12, 4], ['purifier', 12, 5], ['streetlight', 11, 7],
                           ['wind', 13, 10], ['wind', 14, 10]]) await P(t, x, z);
  window.confirm = _confirm0; window.__ncToastSink = null;
  await N.step(3, 6);
  return { gates, fails, why, confirmed, tiles: Object.keys(N.game.tiles).length };
});
for (const g of built.gates) console.log('   gate · ' + g);
if (Object.keys(built.fails).length) console.log('   refused: ' + JSON.stringify(built.fails) + ' :: ' + JSON.stringify(built.why).slice(0, 400));
const city = await page.evaluate(() => {
  const N = window.__nc, by = {};
  for (const k in N.game.tiles) { const t = N.game.tiles[k]; by[t.type] = (by[t.type] || 0) + 1; }
  return { tiles: Object.keys(N.game.tiles).length, by, pop: +N.pop().toFixed(1) };
});
console.log('   ' + city.tiles + ' tiles, pop ' + city.pop + ' — ' + JSON.stringify(city.by));
ok('the district went up', city.tiles > 40 && (city.by.housing || 0) >= 10);

/* ── 2. CLAIM 1 — THE SWEEP IS WELL FORMED ───────────────────────────────── */
console.log('\n2. claim 1 — a row per built tile, no NaN, terms sum to the score');
const wf = await page.evaluate(() => {
  const s = window.__pv.snap();
  if (!s.ok) return { ok: false, why: s.why };
  const sw = window.__nc.plotVerdictSweep();
  let bad = 0, worst = 0, nulls = 0, badReason = 0, noFix = 0;
  const samples = [];
  for (const r of sw.rows) {
    if (!Number.isFinite(r.score)) nulls++;
    const sum = r.terms.reduce((a, t) => a + t.v, 0);
    const d = Math.abs(sum - r.score);
    if (d > worst) worst = d;
    if (d >= 0.5) bad++;
    if (r.reason !== 'ok' && !window.MythicPlotVerdict.REASONS[r.reason]) badReason++;
    if (r.reason !== 'ok' && !r.reasonFix) noFix++;
    for (const t of r.terms) if (!Number.isFinite(t.v)) nulls++;
  }
  for (const r of sw.rows.slice(0, 3).concat(sw.rows.slice(-2))) {
    samples.push(r.key + ' ' + r.type + '/' + r.kind + ' ' + r.score.toFixed(2) +
                 ' ' + r.face.ico + ' ' + r.reason + ' :: ' + r.reasonLabel);
  }
  const kinds = {};
  for (const r of sw.rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  return { ok: true, judged: sw.judged, skipped: sw.skipped, cells: sw.cells,
           bad, worst, nulls, badReason, noFix, samples, kinds,
           verify: window.MythicPlotVerdict.verify() };
});
console.log('   judged ' + wf.judged + ' of ' + wf.cells + ' tiles (' + wf.skipped +
            ' skipped: roads, decor, sites) — kinds ' + JSON.stringify(wf.kinds));
for (const s of (wf.samples || [])) console.log('     ' + s);
ok('a row for every judged tile, and there are some', wf.judged > 30);
ok('no NaN / undefined / null in any score or term', wf.nulls === 0, 'nulls=' + wf.nulls);
ok('every residual |Sum(terms) - score| < 0.5', wf.bad === 0, 'worst residual = ' + n(wf.worst, 12));
ok('every reason is in the catalogue and carries a fix', wf.badReason === 0 && wf.noFix === 0);
ok('the module self-check passes', wf.verify && wf.verify.ok, JSON.stringify(wf.verify).slice(0, 220));

/* ── 3. CLAIM 2c — AIR. Site a coal plant; attribute the delta. ──────────── */
console.log('\n3. claim 2c — a pollution source, and the delta attributable to ONE term');
const air = await page.evaluate(async () => {
  const N = window.__nc;
  const A = window.__pv.snap(), polA = window.__pv.pollution();
  /* The plant goes upwind of the western housing blocks, the same siting
     .gauntlet/drive-pollution.js argues for, and through the SHIPPED
     __nc.place -> tryPlace path. */
  const refusals = [];
  window.__ncToastSink = (m) => refusals.push(String(m).slice(0, 100));
  try { await N.place('coal', 3, 10); } catch (e) { refusals.push('threw ' + e); }
  try { N.build.finishAll('plotverdict'); } catch (e) {}
  window.__ncToastSink = null;
  const placed = !!N.game.tiles['3,10'];
  await N.step(4, 8);
  const B = window.__pv.snap(), polB = window.__pv.pollution();

  const W = window.MythicPlotVerdict.PV;
  const movedTerm = [], movedSrc = [], mismatch = [];
  for (const k in A.m) {
    if (!B.m[k]) continue;
    const dTerm = (B.m[k].tv.pollution || 0) - (A.m[k].tv.pollution || 0);
    const dResp = (polB[k] || 0) - (polA[k] || 0);
    if (Math.abs(dTerm) > 1e-9) movedTerm.push(k);
    if (Math.abs(dResp) > 1e-9) movedSrc.push(k);
    /* THE IDENTITY: the term IS -response x weight, so its delta must be
       -dResponse x weight, exactly. Weight depends on the ruleset, which is the
       whole point of judging a home and a shop differently. */
    const w = B.m[k].kind === 'shop' ? W.shop.pollution : (B.m[k].kind === 'home' ? W.home.pollution : 0);
    if (w > 0 && Math.abs(dTerm - (-dResp * w)) > 1e-9) {
      mismatch.push(k + ' dTerm=' + dTerm.toFixed(9) + ' expected=' + (-dResp * w).toFixed(9));
    }
  }
  movedTerm.sort(); movedSrc.sort();
  /* Only home and shop tiles carry a pollution term at all; civic tiles do not,
     so the SOURCE set is filtered to the kinds that can express it — otherwise
     the comparison would fail on a Clinic that got dirtier and correctly said
     nothing about it. */
  const srcJudged = movedSrc.filter(k => B.m[k] && (B.m[k].kind === 'home' || B.m[k].kind === 'shop'));
  return { placed, refusals: refusals.slice(0, 3),
           movedTerm: movedTerm.length, movedSrc: movedSrc.length, srcJudged: srcJudged.length,
           setsEqual: JSON.stringify(movedTerm) === JSON.stringify(srcJudged),
           onlyInTerm: movedTerm.filter(k => srcJudged.indexOf(k) < 0).slice(0, 5),
           onlyInSrc: srcJudged.filter(k => movedTerm.indexOf(k) < 0).slice(0, 5),
           mismatch: mismatch.slice(0, 5), mismatches: mismatch.length,
           worstDelta: Math.min(...movedTerm.map(k => (B.m[k].tv.pollution - A.m[k].tv.pollution))),
  };
});
ok('the coal plant was actually sited', air.placed, air.refusals.join(' | '));
console.log('   ' + air.movedSrc + ' tiles saw MythicPollution move; ' + air.srcJudged +
            ' of them carry a pollution term; ' + air.movedTerm + ' terms moved');
ok('the set of tiles whose pollution TERM moved EQUALS the set the source moved on',
   air.setsEqual, air.setsEqual ? '' : 'term-only ' + JSON.stringify(air.onlyInTerm) +
                                    ' src-only ' + JSON.stringify(air.onlyInSrc));
ok('every pollution delta equals -dResponse x the published weight, exactly',
   air.mismatches === 0, air.mismatch.join(' | '));
console.log('   worst single-tile pollution penalty introduced: ' + n(air.worstDelta, 4) + ' points');

/* ── 4. CLAIM 3 — SEPARABLE. Two houses, two exposures. ──────────────────── */
console.log('\n4. claim 3 — the same building type at two exposures differs by exactly its pollution term');
const sep = await page.evaluate(() => {
  const s = window.__nc.plotVerdictSweep();
  const homes = s.rows.filter(r => r.type === 'housing');
  const byPol = homes.slice().sort((a, b) => {
    const pa = a.terms.find(t => t.k === 'pollution'), pb = b.terms.find(t => t.k === 'pollution');
    return (pa ? pa.v : 0) - (pb ? pb.v : 0);
  });
  const pick = (r) => { const o = {}; for (const t of r.terms) o[t.k] = t.v; return o; };
  /* The pair has to differ in the pollution term and in NOTHING ELSE, or the
     identity is being asserted about two tiles that also differ in rent. Walk
     the dirtiest-first list against the cleanest and take the first pair that
     is otherwise identical. */
  for (const A of byPol) {
    for (let i = byPol.length - 1; i >= 0; i--) {
      const B = byPol[i];
      if (A.key === B.key) continue;
      const ta = pick(A), tb = pick(B);
      let other = 0;
      for (const k in ta) if (k !== 'pollution' && Math.abs((ta[k] || 0) - (tb[k] || 0)) > 1e-9) other++;
      if (other) continue;
      if (Math.abs(ta.pollution - tb.pollution) < 1e-6) continue;
      return { found: true, a: A.key, b: B.key,
               scoreA: A.score, scoreB: B.score, polA: ta.pollution, polB: tb.pollution,
               dScore: A.score - B.score, dPol: ta.pollution - tb.pollution,
               err: Math.abs((A.score - B.score) - (ta.pollution - tb.pollution)),
               reasonA: A.reason, reasonB: B.reason };
    }
  }
  return { found: false, homes: homes.length };
});
if (sep.found) {
  console.log('   ' + sep.a + ' score ' + n(sep.scoreA, 6) + ' (pollution ' + n(sep.polA, 6) + ')');
  console.log('   ' + sep.b + ' score ' + n(sep.scoreB, 6) + ' (pollution ' + n(sep.polB, 6) + ')');
  ok('score_A - score_B == pollutionTerm_A - pollutionTerm_B', sep.err < 1e-9,
     'dScore ' + n(sep.dScore, 9) + ' vs dPol ' + n(sep.dPol, 9) + ' (err ' + n(sep.err, 12) + ')');
} else {
  ok('two housing tiles at different exposures, otherwise identical', false,
     'no such pair among ' + sep.homes + ' housing tiles');
}

/* ── 5. CLAIM 2a — POWER. Brown the city out from the demand side. ───────── */
console.log('\n5. claim 2a — cut the power on the real seam, and match the set exactly');
const pwr = await page.evaluate(async () => {
  const N = window.__nc;
  const A = window.__pv.snap(), pA = window.__pv.power();
  /* THE REAL SEAM, AND IT IS THE DEMAND SIDE ON PURPOSE. Placing draws through
     tryPlace is exactly how a player browns their own city out; there is no
     test-only "set the grid to zero" hook and this driver does not invent one.
     Street lights are the cheapest thing in the table with a powerNeed and are
     under the municipal build ceiling. */
  const refusals = [];
  window.__ncToastSink = (m) => refusals.push(String(m).slice(0, 80));
  let put = 0, tried = 0;
  for (let x = 0; x < 24 && put < 40 && tried < 90; x++) {
    for (let z = 0; z < 24 && put < 40 && tried < 90; z++) {
      if (N.game.tiles[x + ',' + z]) continue;
      tried++;
      try { await N.place('streetlight', x, z); } catch (e) {}
      try { N.build.finishAll('plotverdict'); } catch (e) {}
      if (N.game.tiles[x + ',' + z]) put++;
    }
  }
  window.__ncToastSink = null;
  await N.step(4, 8);
  const B = window.__pv.snap(), pB = window.__pv.power();

  const W = window.MythicPlotVerdict.PV;
  /* THE SET TEST. Not "whose reason flipped" — the reason is the WORST term, so
     a tile can lose power and still be angrier about the rent, and a set test
     on the reason would be a test of the reason ordering rather than of
     causality. The causal claim is about the TERM: a non-zero power penalty
     must appear on exactly the tiles whose effective factor is under 1, no
     more and no less. The reason-flip set is reported beside it. */
  const termSet = [], srcSet = [], mismatch = [];
  for (const k in B.m) {
    const t = B.m[k].tv.power;
    if (t < -1e-9) termSet.push(k);
    const eff = pB.tiles[k] ? pB.tiles[k].eff : null;
    if (eff != null && eff < 1 - 1e-12) srcSet.push(k);
    /* …and the value itself, against the source, with the ruleset's weight. */
    if (pB.tiles[k]) {
      const w = B.m[k].kind === 'shop' ? W.shop.power : W.any.power;
      const want = -(1 - Math.min(1, pB.tiles[k].eff)) * w;
      if (Math.abs(t - want) > 1e-9) mismatch.push(k + ' term=' + t.toFixed(9) + ' want=' + want.toFixed(9));
    }
  }
  termSet.sort(); srcSet.sort();
  const flipped = Object.keys(B.m).filter(k => A.m[k] && A.m[k].reason !== 'no_power' && B.m[k].reason === 'no_power').sort();
  return {
    put, refusals: refusals.slice(0, 2),
    modelA: pA.model, modelB: pB.model, cityA: pA.cityF, cityB: pB.cityF,
    tileMetered: Object.values(pB.tiles).filter(v => v.which === 'tile').length,
    termSet: termSet.length, srcSet: srcSet.length,
    setsEqual: JSON.stringify(termSet) === JSON.stringify(srcSet),
    onlyTerm: termSet.filter(k => srcSet.indexOf(k) < 0).slice(0, 5),
    onlySrc: srcSet.filter(k => termSet.indexOf(k) < 0).slice(0, 5),
    mismatch: mismatch.slice(0, 4), mismatches: mismatch.length,
    flipped: flipped.length, flippedSubset: flipped.every(k => srcSet.indexOf(k) >= 0),
    zeroFactorTiles: Object.values(pB.tiles).filter(v => v.raw === 0).length,
  };
});
console.log('   placed ' + pwr.put + ' street lights · grid model ' + pwr.modelA + ' -> ' + pwr.modelB +
            ' · city factor ' + n(pwr.cityA, 3) + ' -> ' + n(pwr.cityB, 3) +
            ' · ' + pwr.tileMetered + ' tiles metered by the ladder');
ok('the power cut actually landed (the city factor moved below 1)', pwr.cityB < 1 || pwr.srcSet > 0,
   'city ' + n(pwr.cityA, 4) + ' -> ' + n(pwr.cityB, 4));
ok('the set carrying a power penalty EQUALS the set with an effective factor < 1',
   pwr.setsEqual, pwr.setsEqual ? (pwr.termSet + ' tiles')
     : 'term-only ' + JSON.stringify(pwr.onlyTerm) + ' src-only ' + JSON.stringify(pwr.onlySrc));
ok('every power penalty equals -(1 - factor) x the published weight, exactly',
   pwr.mismatches === 0, pwr.mismatch.join(' | '));
ok('every tile whose REASON flipped to no_power is inside that set', pwr.flippedSubset,
   pwr.flipped + ' reasons flipped');
console.log('   tiles the ladder priced at exactly 0 (a real blackout, not a null): ' + pwr.zeroFactorTiles);

/* ── 6. CLAIM 2b — WATER (and the other five needs), by identity. ────────── */
console.log('\n6. claim 2b — raise the population and match every need term to its own coverage');
const wat = await page.evaluate(async () => {
  const N = window.__nc;
  const A = window.__pv.snap(), covA = window.__pv.cov();
  /* MORE PEOPLE, THROUGH tryPlace. Demand for every per-head need rises with
     population, so cov.water falls — the honest way to make the city thirsty
     without reaching past the sim. */
  let put = 0, tried = 0;
  for (let x = 0; x < 24 && put < 24 && tried < 70; x++) {
    for (let z = 0; z < 24 && put < 24 && tried < 70; z++) {
      if (N.game.tiles[x + ',' + z]) continue;
      tried++;
      try { await N.place('housing', x, z); } catch (e) {}
      try { N.build.finishAll('plotverdict'); } catch (e) {}
      if (N.game.tiles[x + ',' + z]) put++;
    }
  }
  await N.step(4, 8);
  const B = window.__pv.snap(), covB = window.__pv.cov();

  const W = window.MythicPlotVerdict.PV.home;
  const NEEDS = { food: W.food, water: W.water, health: W.health,
                  safety: W.safety, light: W.light, deathcare: W.deathcare };
  const bad = [];
  let homes = 0, waterMoved = 0;
  const cap = (v) => Math.min(1, Number.isFinite(v) ? v : 1);
  for (const k in A.m) {
    if (!B.m[k] || B.m[k].kind !== 'home') continue;
    homes++;
    for (const nd in NEEDS) {
      const d = (B.m[k].tv['need_' + nd] || 0) - (A.m[k].tv['need_' + nd] || 0);
      const want = -(cap(covB[nd]) - cap(covA[nd])) * NEEDS[nd];
      if (nd === 'water' && Math.abs(d) > 1e-9) waterMoved++;
      if (Math.abs(d - want) > 1e-9) bad.push(k + '/' + nd + ' d=' + d.toFixed(9) + ' want=' + want.toFixed(9));
    }
  }
  /* AND THE SET: only homes carry a need term, so nothing else may have moved. */
  const nonHomeMoved = Object.keys(B.m).filter(k =>
    A.m[k] && B.m[k].kind !== 'home' &&
    Math.abs((B.m[k].tv.need_water || 0) - (A.m[k].tv.need_water || 0)) > 1e-9).length;
  return { put, homes, waterMoved, nonHomeMoved, bad: bad.slice(0, 4), bads: bad.length,
           covA, covB, popA: A.judged, popB: B.judged };
});
console.log('   placed ' + wat.put + ' more homes · cov.water ' + n(wat.covA.water, 4) +
            ' -> ' + n(wat.covB.water, 4) + ' · cov.food ' + n(wat.covA.food, 4) + ' -> ' + n(wat.covB.food, 4));
ok('the water term moved on every home and on nothing else',
   wat.waterMoved === wat.homes && wat.nonHomeMoved === 0,
   wat.waterMoved + '/' + wat.homes + ' homes, ' + wat.nonHomeMoved + ' non-homes');
ok('every need delta equals -d(coverage) x its published weight, exactly, for all six needs',
   wat.bads === 0, wat.bad.join(' | '));

/* ── 7. CLAIM 4 — A DEAD MODULE CONTRIBUTES EXACTLY 0 ────────────────────── */
console.log('\n7. claim 4 — stub /src/pollution and /src/demographics absent');
const stub = await page.evaluate(() => {
  const before = window.__pv.snap();
  const P = window.MythicPollution, D = window.MythicDemographics;
  try { delete window.MythicPollution; } catch (e) { window.MythicPollution = undefined; }
  try { delete window.MythicDemographics; } catch (e) { window.MythicDemographics = undefined; }
  const after = window.__pv.snap();
  const src = window.MythicPlotVerdict.sources();
  let nonZero = 0, stillLive = 0, driftBad = 0;
  const drift = [], sideMoved = {};
  for (const k in after.m) {
    if (!before.m[k]) continue;
    const a = after.m[k];
    if (Math.abs(a.tv.pollution || 0) > 0) nonZero++;
    if (a.tl.pollution) stillLive++;
    if (a.kind === 'home') {
      if (Math.abs(a.tv.afford || 0) > 0) nonZero++;
      if (a.tl.afford) stillLive++;
    }
    /* NOT A SUBSTITUTE: the score must fall by EXACTLY the terms that changed,
       and the ONLY terms allowed to change are the two that died plus the ones
       that legitimately depend on them.
       ⚠ `rent` AND `address` ARE ALLOWED TO MOVE, and finding that out is why
         this check is written this way round. /src/landvalue's own premium
         reads BOTH of the modules being stubbed — MythicPollution as a
         multiplier and MythicDemographics as its `wealth` term (field.js's
         five-term table) — so pulling them changes the BAND, and the band is
         what the rent and address rows are taken on. That is a real cascade in
         the shipped model, not this file substituting anything, and hiding it
         behind a looser tolerance would have hidden a substitution too. So the
         terms that moved are NAMED, and the score is still required to equal
         the sum of its own rows to the last bit. */
    let lost = 0;
    for (const t in { ...before.m[k].tv, ...a.tv }) {
      const d = (a.tv[t] || 0) - (before.m[k].tv[t] || 0);
      if (Math.abs(d) > 1e-9) { sideMoved[t] = (sideMoved[t] || 0) + 1; lost += d; }
    }
    const want = before.m[k].score + lost;
    if (Math.abs(a.score - want) > 1e-9) { driftBad++; if (drift.length < 4) drift.push(k + ' got ' + a.score.toFixed(6) + ' want ' + want.toFixed(6)); }
  }
  window.MythicPollution = P; window.MythicDemographics = D;
  const restored = window.__pv.snap();
  let restoreBad = 0;
  for (const k in before.m) if (restored.m[k] && Math.abs(restored.m[k].score - before.m[k].score) > 1e-9) restoreBad++;
  return { src, nonZero, stillLive, driftBad, drift, restoreBad, sideMoved,
           rows: Object.keys(after.m).length };
});
console.log('   sources(): pollution=' + stub.src.pollution + ' demographics=' + stub.src.demographics +
            ' zeroed=' + JSON.stringify(stub.src.zeroed));
ok('sources() reports both modules dead', stub.src.pollution === 'absent' && stub.src.demographics === 'absent');
ok('sources().zeroed names the terms that went to 0',
   stub.src.zeroed.includes('pollution') && stub.src.zeroed.includes('afford'));
ok('their terms are EXACTLY 0 and flagged not-live', stub.nonZero === 0 && stub.stillLive === 0,
   'nonZero=' + stub.nonZero + ' stillLive=' + stub.stillLive);
console.log('   terms that moved when the two modules went away: ' + JSON.stringify(stub.sideMoved));
ok('every score still equals the sum of its own rows — no plausible substitute',
   stub.driftBad === 0, stub.drift.join(' | '));
ok('restoring the modules restores every score exactly', stub.restoreBad === 0);

/* ── 8. CLAIM 5 — THE DEMAND_RAMP_SEC TRAP, AS TWO TABLES ────────────────── */
console.log('\n8. claim 5 — the DEMAND_RAMP_SEC trap, reported as two separate tables');
const ramp = await page.evaluate(async () => {
  const N = window.__nc;
  /* THE RAMP IS A FIELD, AND loadState SETS IT. Resetting it to 0 is precisely
     what a fresh load does (index.html :36432 clamps a saved ramp into it), so
     this reproduces the "photograph a city that has not been asked the question
     yet" state without a page reload the harness cannot afford. */
  N.game.cov.ramp = 0;
  N.coverage();
  const fresh = window.__pv.snap();
  const covFresh = window.__pv.cov();
  await N.step(5, 10);                       // 300 s of vitals > DEMAND_RAMP_SEC
  const settled = window.__pv.snap();
  const covSettled = window.__pv.cov();
  const summarise = (s) => {
    const faces = {}, reasons = {};
    let tot = 0;
    for (const k in s.m) { tot += s.m[k].score; reasons[s.m[k].reason] = (reasons[s.m[k].reason] || 0) + 1; }
    for (const r of window.__nc.plotVerdictSweep().rows) faces[r.face.id] = (faces[r.face.id] || 0) + 1;
    return { judged: s.judged, ramping: s.ramping, rampLeftSec: Math.round(s.rampLeftSec),
             mean: +(tot / Math.max(1, s.judged)).toFixed(2), reasons };
  };
  const a = summarise(fresh), b = summarise(settled);
  let moved = 0;
  for (const k in fresh.m) if (settled.m[k] && Math.abs(settled.m[k].score - fresh.m[k].score) > 1e-9) moved++;
  return { a, b, moved, covFresh, covSettled, rows: Object.keys(fresh.m).length };
});
console.log('   TABLE A — immediately after a load (ramp reset to 0)');
console.log('     ramping=' + ramp.a.ramping + ' rampLeftSec=' + ramp.a.rampLeftSec +
            ' judged=' + ramp.a.judged + ' mean score=' + ramp.a.mean);
console.log('     reasons ' + JSON.stringify(ramp.a.reasons));
console.log('     cov ' + JSON.stringify(Object.fromEntries(Object.entries(ramp.covFresh).map(([k, v]) => [k, +v.toFixed(3)]))));
console.log('   TABLE B — after DEMAND_RAMP_SEC has expired');
console.log('     ramping=' + ramp.b.ramping + ' rampLeftSec=' + ramp.b.rampLeftSec +
            ' judged=' + ramp.b.judged + ' mean score=' + ramp.b.mean);
console.log('     reasons ' + JSON.stringify(ramp.b.reasons));
console.log('     cov ' + JSON.stringify(Object.fromEntries(Object.entries(ramp.covSettled).map(([k, v]) => [k, +v.toFixed(3)]))));
ok('table A declares itself ramping, table B does not', ramp.a.ramping === true && ramp.b.ramping === false);
ok('the two tables are genuinely different — the trap is real and now visible',
   ramp.moved > 0 || ramp.a.mean !== ramp.b.mean,
   ramp.moved + ' tiles moved, mean ' + ramp.a.mean + ' -> ' + ramp.b.mean);

/* ── 9. PERFORMANCE ──────────────────────────────────────────────────────── */
console.log('\n9. what a whole-board sweep costs');
const perf = await page.evaluate(() => {
  const t = [];
  for (let i = 0; i < 5; i++) { const a = performance.now(); window.__nc.plotVerdictSweep(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  return { median: +t[2].toFixed(2), best: +t[0].toFixed(2), worst: +t[4].toFixed(2),
           judged: window.__nc.plotVerdictSweep().judged };
});
console.log('   ' + perf.judged + '-tile sweep: median ' + perf.median + ' ms (best ' + perf.best +
            ', worst ' + perf.worst + ') — read-only, no draw calls, nothing cached');

console.log('\n' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
const noisy = logs.filter(l => /pageerror|PlotVerdict/i.test(l));
if (noisy.length) { console.log('\nconsole:'); console.log(noisy.slice(0, 12).join('\n')); }
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
