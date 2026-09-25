/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE THE PLOT MOOD NUMBER — /src/plotmood/verdict.js, the score behind
   the face, proved WITHOUT DRAWING ANYTHING.

   ⚠ WHY THIS FILE EXISTS BESIDE .gauntlet/drive-plotverdict.mjs.
     That driver proves the same five claims on a 53-placement district and is
     the fuller instrument; on this box, with several other headless Chromiums
     running, its step 1 has now failed to finish inside 20 minutes twice (its
     own header records 35 minutes, twice, for the standard scene before it).
     This one is the SHORT instrument: ~30 placements, no roads at all, and a
     wall-clock stamp on every phase so a stall is visible in the transcript
     rather than inferred from silence. Whole run: about 13 seconds. It proves
     the same claims on a smaller board and adds three the other does not:
       · the WATER SOURCE HONESTY fix (claim 4b below),
       · that a home and a working building are judged by DIFFERENT ROWS
         (claim 6), and
       · the gcConfirm trap that is why the other driver never finishes — see
         the toolkit header further down, which is the most important comment
         in this file.

   🔴 NOTHING HERE PHOTOGRAPHS A FRAME. Every claim is about the SIM, so the
      framebuffer trap in .gauntlet/README.md item 6 cannot apply and no
      renderer.render() is needed. That is the point: this piece IS the number,
      and a number that can only be checked by looking at it is not checked.

   THE CLAIMS:
     1  WELL FORMED — a whole-grid sweep returns a row per built tile with no
        NaN / undefined / null score, every score inside 0..100, and every
        terms[] residual |Σv − score| under 0.5. (It is 0 by construction — the
        score IS the sum — so anything else is a real regression.)
     2a POWER, ON THE REAL SEAM — place a powered building with NO generation
        in the city, and the set of tiles carrying a non-zero power penalty must
        EQUAL, exactly, the set where the effective per-tile factor is under 1,
        computed HERE from __nc.pwFactorOf + __nc.power().factor, i.e. from the
        source, never from the module's own copy. Every term value is also
        checked against −(1 − min(1,f)) × the published weight, to the bit.
        🔴 `pwFactorOf` returning 0 is a BLACKOUT and returning null is "the
           ladder has no opinion"; a `|| 1` anywhere near it turns the first
           into a clean bill of health. Both are asserted separately.
     2b WATER AND THE OTHER NEEDS — let the population grow, and every need term
        on every home must equal −(1 − min(1,cov[n])) × its published weight,
        before AND after, with the delta equal to the coverage delta × weight.
     2c A POLLUTION SOURCE — ring the housing with works (none of which carries
        a `gen: { power }`, so the power terms cannot move underneath the
        measurement), soak until /src/pollution's own response actually crosses
        its 0.10 deadband at a HOME, and then the set of tiles whose pollution
        term moved must EQUAL the set where that response moved, with the term
        equal to −response × weight.
     3  SEPARABLE — two plots of the SAME TYPE at different exposures whose
        other rows are identical: score_A − score_B must equal
        pollutionTerm_A − pollutionTerm_B exactly.
     4a DEAD MEANS ZERO — stub MythicPollution and MythicDemographics absent:
        sources() must report them dead, their terms must read EXACTLY 0 (not a
        plausible substitute), and the score must move by precisely the terms
        lost.
     4b …AND THE WATER SOURCE, WHICH IS THE ONE THIS ROUND FIXED. node-city's
        `wtFactor()` returns exactly 1 both for "the aquifer here is nominal"
        and for "/src/water never mounted", so `Number.isFinite(wt)` cannot tell
        them apart and the module used to report `water: 'live'` with the module
        404'd. Delete window.MythicWater and sources() must say `absent` and
        list `ground` in `zeroed`.
     5  THE RAMP TRAP — `game.cov.ramp` blends every coverage figure toward a
        neutral 100% for DEMAND_RAMP_SEC after a load, so a sweep taken inside
        that window photographs a city that has not been asked the question yet.
        Two SEPARATE TABLES are printed, and the module must flag the first.
     6  TWO RULESETS — a home is judged on the six need_ rows plus rent and
        afford; a working building on halted, stock, staff and (with a firm on
        it) customers, inputs, broke and address. The two row sets
        must actually differ, or "residential and commercial are judged
        differently" is a claim with nothing behind it.

   Run:  node .gauntlet/drive-plotmood.mjs
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
const PORT = 8640 + (process.pid % 90);

const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6) + 's';
const phase = (s) => console.log('\n[' + stamp() + '] ' + s);

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
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
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
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};
const n = (v, d = 6) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const setEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

phase('0. boot');
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(9000);

const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  mod: !!(window.MythicPlotVerdict && window.MythicPlotVerdict.ready()),
  handle: typeof (window.__nc || {}).plotVerdict === 'function',
  sweepH: typeof (window.__nc || {}).plotVerdictSweep === 'function',
  pw: typeof (window.__nc || {}).pwFactorOf === 'function',
  wt: typeof (window.__nc || {}).wtFactorOf === 'function',
  mods: {
    power: !!(window.MythicPower && window.MythicPower.ready && window.MythicPower.ready()),
    water: !!(window.MythicWater && window.MythicWater.ready && window.MythicWater.ready()),
    pollution: !!(window.MythicPollution && window.MythicPollution.ready && window.MythicPollution.ready()),
    landvalue: !!(window.MythicLandValue && window.MythicLandValue.ready && window.MythicLandValue.ready()),
    demographics: !!(window.MythicDemographics && window.MythicDemographics.ready && window.MythicDemographics.ready()),
    economy: !!(window.MythicEconomy && window.MythicEconomy.ready && window.MythicEconomy.ready()),
    tenants: !!window.MythicTenants, zoning: !!window.MythicZoning,
  },
}));
ok('the page booted with the diagnostics seam', boot.nc);
ok('/src/plotmood/verdict.js mounted', boot.mod);
ok('__nc.plotVerdict / plotVerdictSweep / pwFactorOf / wtFactorOf are on the seam',
   boot.handle && boot.sweepH && boot.pw && boot.wt);
console.log('   optional sources: ' + JSON.stringify(boot.mods));

/* ── THE IN-PAGE TOOLKIT ─────────────────────────────────────────────────── */
await page.evaluate(() => {
  const N = window.__nc;
  window.__pm = {
    /* One snapshot of the whole board: score, reason, kind, and every term BY
       KEY, so a delta can be attributed to a NAMED row instead of to
       "something". */
    snap() {
      const s = N.plotVerdictSweep();
      if (!s || !s.ok) return { ok: false, why: (s && s.why) || 'no sweep' };
      const m = {};
      for (const r of s.rows) {
        const tv = {}, tl = {};
        for (const t of r.terms) { tv[t.k] = t.v; tl[t.k] = !!t.live; }
        m[r.key] = { score: r.score, reason: r.reason, kind: r.kind, type: r.type,
                     face: r.face && r.face.id, tv, tl, nTerms: r.terms.length,
                     keys: r.terms.map(t => t.k).sort() };
      }
      return { ok: true, m, ramping: s.ramping, rampLeftSec: s.rampLeftSec,
               judged: s.judged, skipped: s.skipped, cells: s.cells, sources: s.sources };
    },
    /* THE POWER TRUTH, READ OFF THE HOST SEAM — never off the module.
       `pwFactorOf` keeps its null; the effective factor when it is null is the
       city average, which is what node-city's own pwFactorAt() does and
       therefore what the module is required to agree with. */
    power() {
      const cityF = N.power().factor;
      const out = {};
      for (const k in N.game.tiles) {
        const c = k.indexOf(',');
        const raw = N.pwFactorOf(+k.slice(0, c), +k.slice(c + 1));
        const tile = (typeof raw === 'number' && isFinite(raw) && raw >= 0);
        out[k] = { raw: tile ? raw : null, eff: tile ? raw : cityF, which: tile ? 'tile' : 'city' };
      }
      return { cityF, gen: N.game.power.gen, demand: N.game.power.demand, tiles: out };
    },
    pollution() {
      const out = {}; const P = window.MythicPollution;
      if (!P || !P.ready || !P.ready()) return out;
      for (const k in N.game.tiles) {
        const c = k.indexOf(',');
        const e = P.explainAt(+k.slice(0, c), +k.slice(c + 1));
        if (e && isFinite(e.response)) out[k] = e.response;
      }
      return out;
    },
    cov() { return { ...(N.game.cov.pct || {}) }; },
    PV() { return window.MythicPlotVerdict.PV; },
  };

  /* 🔴 THE LONG-ORDER DIALOG, AND WHY `window.confirm = () => true` DOES NOT
        TOUCH IT. THIS COST THE WHOLE FIRST HALF OF THIS ROUND.
     ------------------------------------------------------------------------
     Every build-order call site in node-city reads
         typeof gcConfirm === 'function' ? gcConfirm(msg) : confirm(msg)
     and node-city DECLARES ITS OWN `gcConfirm` (index.html :34626) — a
     non-blocking in-world modal, added precisely so the player stops getting
     the grey OS box. So the `typeof` test is TRUE, the native branch is dead
     code, and a harness that stubs `window.confirm` has stubbed nothing: the
     placement awaits a Promise that only a click can resolve, and headless it
     never resolves at all. The tell is a driver that prints its step-1 header
     and then produces no further output, forever — which is exactly what
     .gauntlet/drive-plotverdict.mjs does on this tree, and it is not machine
     load.
     `gcConfirm` is a module-scope function declaration, so it is NOT on
     `window` (the globals trap, CLAUDE.md) and cannot be replaced from here.
     What CAN be done is answer the real dialog: it builds a real element with
     real buttons, and because it is non-blocking the page's event loop is free
     while a placement awaits it. A 20 ms poller clicks Confirm.
     ⚠ It answers YES. Every one of these gates a spend, and this harness has
       already stubbed the treasury rich; a driver that let them cancel would be
       measuring a city that was never built. The count is reported. */
  window.__pmConfirms = 0;
  window.__pmAuto = setInterval(() => {
    try {
      const b = document.querySelector('#ncconfirm [data-ncc="1"]');
      if (b) { window.__pmConfirms++; b.click(); }
    } catch (e) {}
  }, 20);
  return true;
});

/* ── 1. A TINY DISTRICT, THROUGH tryPlace, WITH EVERY GATE NAMED ─────────── */
phase('1. a tiny district, through the shipped tryPlace seam');
const built = await page.evaluate(async () => {
  const N = window.__nc, gates = [], fails = {}, why = {};
  /* COST — canAfford/payCost consult MythicCityBridge, not game.res. */
  const B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9;
           B.addCinders = async () => true; }
  gates.push('cost: MythicCityBridge stubbed rich — the standard harness stub');
  /* THE LONG-ORDER CONFIRM. Kept only to COUNT how often the native path is
     taken — it is zero, and that zero is the evidence for the toolkit header's
     claim that stubbing `window.confirm` stubs nothing. The dialog that is
     really shown is answered by the poller installed above. */
  const _c0 = window.confirm; let confirmed = 0;
  window.confirm = () => { confirmed++; return true; };
  /* THE MUNICIPAL BUILD CEILING — lifted, not answered with a Construction Co.
     It is a gate about BUILD TIME and has nothing to do with what a plot feels;
     .gauntlet/drive-pollution.js lifts the same one in the same words. */
  try { window.MythicEconomy.ECON.construction.municipal.maxSec = 9e6; } catch (e) {}
  gates.push('municipal ceiling: ECON.construction.municipal.maxSec raised — a BUILD TIME gate, not a mood one');
  /* CREW SLOTS — bldCommitted() >= bldSlots() refuses outright, so every
     placement is followed by finishAll(). */
  /* ⚠ 24, NOT 90, AND THE NUMBER IS LOAD-BEARING. `popUsed()` (:25913) counts
     `game.army.workers` against the SAME cap the buildings draw on, so hiring
     freely is not free: at 90 workers every subsequent placement was refused
     with "Not enough population — build Housing", which reads like a cost gate
     and is really a crew gate wearing its coat. Enough to staff nine crew
     slots, and no more. */
  try { N.game.army.workers = 24; } catch (e) {}
  gates.push('crew: 24 workers hired — enough to staff the works, and popUsed() counts them against popCap');
  /* THE PROGRESSION TREE — granted through the module's own documented test
     seam, and listed with its point cost, because a district built on 5
     development points is a different claim from one built on none.
     ⚠ NEEDED, not decorative: the first run of this driver had its Clinic and
       its Mine BOTH refused with "not researched yet", and because the refusals
       were silent to the assertions the coverage delta and the plume were then
       measured on a city where neither building existed — two checks passing on
       a dead branch. */
  const Pg = window.MythicProgress;
  if (Pg) {
    const WANT = [['civ_services', 1], ['civ_parks', 1], ['ind_extract', 1], ['ind_heavy', 2]];
    let pts = 0; const got = [];
    for (const [id, c] of WANT) { let o = false; try { o = Pg._grant(id); } catch (e) {} if (o) { pts += c; got.push(id); } }
    gates.push('progression: granted ' + pts + ' dp via _grant — ' + (got.join(', ') || 'nothing took'));
  } else gates.push('progression: MODULE ABSENT — nothing gated, nothing granted');

  let sink = null;
  window.__ncToastSink = (m, cls) => { if (cls === 'bad' && sink) sink.push(String(m).slice(0, 130)); };
  const done = () => { try { N.build.finishAll('plotmood'); } catch (e) {} };
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

  /* ⚠ NO ROADS AT ALL, AND THAT IS A DELIBERATE LIMITATION, NOT AN OVERSIGHT.
     tryPlace has no road-access gate (the four refusal points are cost, cap,
     card, concourse, progression, ground, water, road-cap and population — see
     :29948), so a district builds fine without one; and road tiles are the
     expensive mesh path in this renderer. What it COSTS is stated in claim 6:
     with no street there is no footfall, so /src/economy founds no firm on the
     works tiles and their `customers` / `inputs` / `broke` rows are dead rows
     of exactly 0. That is the correct answer for this board and it is the
     honest one — but it means this driver proves the SHAPE of the shop ladder,
     not a live no-customers reading. drive-plotverdict.mjs lays a street and
     proves that half. */
  /* 20 HOMES, WHICH IS A POPULATION BUDGET AND NOT A TASTE. popCap is 4 plus 6
     per Housing level plus the anchors; popUsed is the workers plus every
     building's `pop`. Eight homes left no headroom for a Clinic, three works
     and a Motor Pool, and the refusals were silent to the assertions above
     them — which is how two checks came to pass on a city that had none of
     those buildings in it. */
  for (let x = 3; x <= 7; x++) for (let z = 4; z <= 7; z++) await P('housing', x, z);  // 20 homes
  window.confirm = _c0; window.__ncToastSink = null;

  return { gates, fails, why, confirmed, gc: window.__pmConfirms,
           tiles: Object.keys(N.game.tiles).length };
});
for (const g of built.gates) console.log('   gate — ' + g);
console.log('   ' + built.tiles + ' tiles placed · ' + built.gc + " in-world gcConfirm dialogs clicked, " +
            built.confirmed + ' native confirm() calls (the native path is dead code — see the toolkit header)');
if (Object.keys(built.fails).length) console.log('   REFUSED: ' + JSON.stringify(built.fails) + ' ' + JSON.stringify(built.why));
ok('the district actually went up', built.tiles >= 8, built.tiles + ' tiles');

await page.evaluate(() => window.__nc.step(2, 4));

/* ── 2. CLAIM 1 — WELL FORMED ────────────────────────────────────────────── */
phase('2. claim 1 — a row per built tile, no NaN, and the terms sum to the score');
const wf = await page.evaluate(() => {
  const s = window.__pm.snap();
  if (!s.ok) return { ok: false, why: s.why };
  const bad = [];
  let worst = 0, rows = 0;
  const raw = window.__nc.plotVerdictSweep();
  for (const r of raw.rows) {
    rows++;
    const sum = r.terms.reduce((a, t) => a + t.v, 0);
    const d = Math.abs(sum - r.score);
    if (d > worst) worst = d;
    if (!Number.isFinite(r.score)) bad.push(r.key + ': score ' + r.score);
    if (r.score < 0 || r.score > 100) bad.push(r.key + ': score outside 0..100 (' + r.score + ')');
    if (d > 0.5) bad.push(r.key + ': residual ' + d);
    if (r.reason == null) bad.push(r.key + ': no reason');
    for (const t of r.terms) if (!Number.isFinite(t.v)) bad.push(r.key + '/' + t.k + ': term not finite');
  }
  return { ok: true, rows, worst, bad: bad.slice(0, 6), judged: raw.judged,
           skipped: raw.skipped, cells: raw.cells,
           verify: window.MythicPlotVerdict.verify() };
});
console.log('   judged ' + wf.judged + ' of ' + wf.cells + ' tiles (' + wf.skipped + ' skipped: roads, decor, sites)');
ok('every row has a finite score inside 0..100 and a reason', wf.bad.length === 0, JSON.stringify(wf.bad));
ok('worst terms[] residual under 0.5', wf.worst < 0.5, 'worst |Σv − score| = ' + n(wf.worst, 12));
ok("the module's own verify() agrees", wf.verify && wf.verify.ok,
   'worstResidual ' + n(wf.verify && wf.verify.worstResidual, 12) + ' judged ' + (wf.verify && wf.verify.judged));

/* ── 3. CLAIM 6 — TWO RULESETS ───────────────────────────────────────────── */
phase('3. claim 6 — a home and a working building are judged by DIFFERENT rows');
const kinds = await page.evaluate(async () => {
  const N = window.__nc;
  const B = window.MythicCityBridge;
  if (B) { B.getCinders = async () => 9e9; B.getRes = async () => 9e9;
           B.spendCinders = async () => true; B.spendRes = async () => true; }
  const _c0 = window.confirm; window.confirm = () => true;
  await N.place('motorpool', 9, 4);            // a working building: crew + powerNeed + svc
  try { N.build.finishAll('plotmood'); } catch (e) {}
  window.confirm = _c0;
  await N.step(1, 2);
  const s = window.__pm.snap();
  const home = Object.values(s.m).find(r => r.kind === 'home');
  const work = s.m['9,4'];
  return { home: home ? home.keys : null, homeKind: home ? home.kind : null,
           work: work ? work.keys : null, workKind: work ? work.kind : null,
           workPlaced: !!work };
});
ok('the working building was placed and judged', kinds.workPlaced, 'kind=' + kinds.workKind);
if (kinds.home && kinds.work) {
  const onlyHome = kinds.home.filter(k => kinds.work.indexOf(k) < 0);
  const onlyWork = kinds.work.filter(k => kinds.home.indexOf(k) < 0);
  console.log('   home-only rows: ' + JSON.stringify(onlyHome));
  console.log('   work-only rows: ' + JSON.stringify(onlyWork));
  ok('the two rulesets do not share a row set', onlyHome.length > 0 && onlyWork.length > 0);
  ok('the home ladder carries the six NEEDS, rent and afford',
     ['need_food', 'need_water', 'need_health', 'need_safety', 'need_light', 'need_deathcare', 'rent', 'afford']
       .every(k => kinds.home.indexOf(k) >= 0));
  ok('the work ladder carries halted / stock / staff', ['halted', 'stock', 'staff']
       .every(k => kinds.work.indexOf(k) >= 0));
}

/* ── 4. CLAIM 2a — POWER, ON THE REAL SEAM ───────────────────────────────── */
phase('4. claim 2a — a powered building with no generation, matched set for set');
const pwr = await page.evaluate(async () => {
  const N = window.__nc;
  const before = { snap: window.__pm.snap(), power: window.__pm.power() };
  /* THE REAL SEAM: the Motor Pool placed above draws 0.15/min and the city has
     no plant at all, so gen 0 against a real demand is a genuine blackout — the
     case where pwFactorOf answers 0, not null. That distinction is the whole
     reason this claim exists: `|| 1` turns a blackout into a clean bill. */
  await N.step(3, 6);
  const after = { snap: window.__pm.snap(), power: window.__pm.power() };
  const PV = window.__pm.PV();

  const judged = Object.keys(after.snap.m);
  const expect = judged.filter(k => after.power.tiles[k] && after.power.tiles[k].eff < 1 - 1e-12).sort();
  const actual = judged.filter(k => (after.snap.m[k].tv.power || 0) < -1e-12).sort();

  /* …and the VALUE, not just the set. */
  const valueBad = [];
  for (const k of judged) {
    const r = after.snap.m[k];
    const f = after.power.tiles[k].eff;
    const w = r.kind === 'shop' ? PV.shop.power : PV.any.power;
    const want = -(1 - Math.min(1, f)) * w;
    if (Math.abs((r.tv.power || 0) - want) > 1e-9)
      valueBad.push(k + ': term ' + (r.tv.power || 0) + ' want ' + want + ' (f=' + f + ', kind=' + r.kind + ')');
  }
  const zeroTiles = judged.filter(k => after.power.tiles[k].raw === 0);
  const nullTiles = judged.filter(k => after.power.tiles[k].raw === null);
  return {
    genA: before.power.gen, genB: after.power.gen,
    demA: before.power.demand, demB: after.power.demand,
    cityA: before.power.cityF, cityB: after.power.cityF,
    expect, actual, valueBad: valueBad.slice(0, 5), nValueBad: valueBad.length,
    zeroTiles: zeroTiles.length, nullTiles: nullTiles.length,
    flipped: judged.filter(k => (before.snap.m[k] ? before.snap.m[k].reason : null) !== after.snap.m[k].reason
                                && after.snap.m[k].reason === 'no_power').sort(),
    judged: judged.length,
  };
});
console.log('   grid: gen ' + n(pwr.genA, 3) + ' -> ' + n(pwr.genB, 3) +
            ' · demand ' + n(pwr.demA, 3) + ' -> ' + n(pwr.demB, 3) +
            ' · city factor ' + n(pwr.cityA, 4) + ' -> ' + n(pwr.cityB, 4));
console.log('   tiles the ladder priced at exactly 0 (a real blackout, not a null): ' + pwr.zeroTiles +
            ' · tiles the ladder had no opinion about (null -> city average): ' + pwr.nullTiles);
ok('the set carrying a power penalty EQUALS the set where the effective factor is under 1',
   setEq(pwr.expect, pwr.actual),
   pwr.actual.length + ' penalised vs ' + pwr.expect.length + ' under-1');
ok('every power term equals −(1 − min(1,f)) × its published weight, to 1e-9',
   pwr.nValueBad === 0, pwr.nValueBad ? JSON.stringify(pwr.valueBad) : 'checked ' + pwr.judged + ' tiles');
console.log('   tiles whose REASON flipped to no_power: ' + pwr.flipped.length +
            (pwr.flipped.length ? ' ' + JSON.stringify(pwr.flipped.slice(0, 6)) : ''));

/* ── 5. CLAIM 2b — THE NEEDS, AGAINST THEIR OWN COVERAGE ─────────────────── */
phase('5. claim 2b — let the population grow, and match every need term to cov.pct');
const need = await page.evaluate(async () => {
  const N = window.__nc;
  const A = { snap: window.__pm.snap(), cov: window.__pm.cov() };
  /* 🏥 THE MOVER IS A CLINIC, NOT THE PASSAGE OF TIME. A settled city's
     coverage is flat, and a "delta" test on a figure that did not move proves
     nothing — it passes on a dead branch, which is the failure mode
     .gauntlet/README.md item 6 is about in a different guise. So this places
     the ONE building that raises `health` and asserts the need terms followed
     it. Its 0.4/min draw moves the power rows too; that is fine and expected,
     because this claim only reads the six need_ rows. */
  const Br = window.MythicCityBridge;
  if (Br) { Br.getCinders = async () => 9e9; Br.getRes = async () => 9e9;
            Br.spendCinders = async () => true; Br.spendRes = async () => true; }
  let sink = [];
  window.__ncToastSink = (m, cls) => { if (cls === 'bad') sink.push(String(m).slice(0, 120)); };
  await N.place('clinic', 9, 5);
  try { N.build.finishAll('plotmood'); } catch (e) {}
  window.__ncToastSink = null;
  const placed = !!N.game.tiles['9,5'];
  await N.step(20, 10);
  const B = { snap: window.__pm.snap(), cov: window.__pm.cov() };
  const PV = window.__pm.PV();
  const NEEDS = ['food', 'water', 'health', 'safety', 'light', 'deathcare'];
  const bad = [];
  let checked = 0, moved = 0;
  for (const side of [A, B]) {
    for (const k in side.snap.m) {
      const r = side.snap.m[k];
      if (r.kind !== 'home') continue;
      for (const nd of NEEDS) {
        const v = side.cov[nd];
        const want = Number.isFinite(v) ? -(1 - Math.min(1, v)) * PV.home[nd] : 0;
        const got = r.tv['need_' + nd];
        checked++;
        if (Math.abs(got - want) > 1e-9)
          bad.push(k + '/' + nd + ': term ' + got + ' want ' + want + ' (cov ' + v + ')');
      }
    }
  }
  /* …and the DELTA is the coverage delta times the weight, per need. */
  const deltaBad = [];
  for (const k in B.snap.m) {
    const b = B.snap.m[k], a = A.snap.m[k];
    if (!a || b.kind !== 'home') continue;
    for (const nd of NEEDS) {
      const dTerm = b.tv['need_' + nd] - a.tv['need_' + nd];
      /* term = −(1 − min(1,cov)) × w, so Δterm = +Δmin(1,cov) × w. The sign
         here was inverted in the first cut and reported a correct +12 against
         an expected −12 — a driver bug that looked exactly like a module bug,
         which is the reason this line now carries its own derivation. */
      const dCov = (Math.min(1, B.cov[nd]) - Math.min(1, A.cov[nd])) * PV.home[nd];
      if (Math.abs(dTerm) > 1e-9) moved++;
      if (Math.abs(dTerm - dCov) > 1e-9) deltaBad.push(k + '/' + nd + ': Δterm ' + dTerm + ' Δcov×w ' + dCov);
    }
  }
  return { checked, bad: bad.slice(0, 5), nBad: bad.length, placed, refusal: sink[0] || null,
           deltaBad: deltaBad.slice(0, 5), nDeltaBad: deltaBad.length, moved,
           covA: A.cov, covB: B.cov, homes: Object.values(B.snap.m).filter(r => r.kind === 'home').length };
});
ok('the Clinic — the thing that MOVES health coverage — actually went up',
   need.placed, need.placed ? null : (need.refusal || 'refused silently'));
console.log('   cov.health ' + n(need.covA.health, 4) + ' -> ' + n(need.covB.health, 4) +
            ' · cov.water ' + n(need.covA.water, 4) + ' -> ' + n(need.covB.water, 4) +
            ' · cov.food ' + n(need.covA.food, 4) + ' -> ' + n(need.covB.food, 4) +
            ' · ' + need.homes + ' homes');
ok('every need term on every home equals −(1 − min(1,cov)) × its weight',
   need.nBad === 0, need.nBad ? JSON.stringify(need.bad) : need.checked + ' term readings checked');
ok('every need DELTA equals the coverage delta × the same weight',
   need.nDeltaBad === 0, need.nDeltaBad ? JSON.stringify(need.deltaBad) : need.moved + ' term deltas were non-zero');
/* 🔴 A DELTA TEST ON A FIGURE THAT DID NOT MOVE PASSES ON A DEAD BRANCH. */
ok('…and the coverage actually MOVED, so that check ran on live data',
   need.moved > 0, need.moved + ' need terms moved');

/* ── 6. CLAIM 2c + 3 — A POLLUTION SOURCE, AND SEPARABILITY ──────────────── */
phase('6. claim 2c — site a Mine, and attribute the delta to ONE term');
const air = await page.evaluate(async () => {
  const N = window.__nc;
  const A = { snap: window.__pm.snap(), pol: window.__pm.pollution() };
  const B = window.MythicCityBridge;
  if (B) { B.getCinders = async () => 9e9; B.getRes = async () => 9e9;
           B.spendCinders = async () => true; B.spendRes = async () => true; }
  const _c0 = window.confirm; window.confirm = () => true;
  /* ⛏ THE POLLUTER IS CHOSEN BY TRYING, NOT BY ASSERTING. The first cut named
     one building (`scrapmine`) and it was refused silently by a siting gate —
     which turned claim 2c into a test of a plume that never existed and still
     printed PASS, because "the set that moved equals the set that moved" is
     true when both are empty. So: a LIST, in order of how little else they
     disturb, the first one that actually lands wins, and every refusal is
     reported with the toast that caused it.
     ⚠ ORDER: the ones with no `powerNeed` first, because a draw changes
       game.power.factor and therefore every power row in the same breath —
       which does not invalidate the set-equality claim but does muddy what
       `otherMoved` is telling the reader. */
  const TRY = ['scrapmine', 'quarry', 'fuelrig', 'sawmill', 'weavery',
               'papermill', 'smelter', 'machineshop', 'powerstation'];
  const put = []; const refused = {};
  let sink = null;
  window.__ncToastSink = (m, cls) => { if (cls === 'bad' && sink) sink.push(String(m).slice(0, 120)); };
  /* THREE SPOTS, HARD UP AGAINST THE HOUSING BLOCK at x 4..7 / z 4..5. Distance
     is the whole mechanism — `deadband` is 0.10 of weighted exposure and a
     single works four tiles off never crosses it — so the plume is put where a
     player would be horrified to find it. */
  const SPOTS = [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 4], [8, 5]];  // wrapped round the block
  for (let i = 0, s = 0; i < TRY.length && s < SPOTS.length; i++) {
    const ty = TRY[i];
    if (!window.MythicPollution.emits(ty)) { refused[ty] = 'not in the emission table'; continue; }
    const [x, z] = SPOTS[s];
    sink = [];
    try { await N.place(ty, x, z); } catch (e) { sink.push('threw: ' + e); }
    try { N.build.finishAll('plotmood'); } catch (e) {}
    if (N.game.tiles[x + ',' + z]) { put.push(ty + '@' + x + ',' + z); s++; }
    else refused[ty] = (sink[0] || 'refused silently — no toast');
    sink = null;
  }
  window.__ncToastSink = null;
  window.confirm = _c0;
  /* 🏭 …AND IT HAS TO ACTUALLY RUN, AND THEN THE FIELD HAS TO FILL.
     node-city hands /src/pollution `mult: tileMult(...)` as the works'
     activity, so an unstaffed or unpowered chimney is a COLD one and emits
     nothing at all — hence the workers. And /src/pollution has a DEADBAND of
     0.10 weighted exposure, below which the response is exactly 0 on purpose
     (tuning.js: "a permanent tiny penalty that no action can clear is
     indistinguishable from a bug"). So this SOAKS rather than guessing a
     duration: it steps in 10-minute blocks until the module's own response
     rises off zero somewhere, and reports how many sim-minutes that took.
     ⚠ A FIXED `step(8)` IS WHAT THE FIRST CUT DID, and the field never crossed
       the deadband, so "the set that moved equals the set that moved" was true
       of two empty sets and printed PASS. Soaking to a MEASURED condition is
       the difference between a test and a ritual.
     ⚠ AND THE CONDITION IS MEASURED ON THE TILES THE CLAIM IS ABOUT — the
       homes that existed BEFORE the works went up. The second cut soaked until
       "any tile" read non-zero and stopped after one block, because the works
       tiles themselves were already over the deadband while every home was
       still under it: `shared` excludes the new tiles, so the comparison then
       ran over a set where nothing had moved and reported an empty match. */
  let mins = 0, peak = 0;
  /* HOMES ONLY, and pre-existing ones. The third cut soaked until "any tile"
     read non-zero and stopped at 200 minutes on the MOTOR POOL — a works that
     emits onto its own tile is over the deadband long before anything it is
     upwind of is, and the motor pool is `civic`, whose ladder deliberately
     carries no pollution row at all. So the soak stopped on a tile the claim
     cannot even see. */
  const HOMES = Object.keys(A.snap.m).filter(k => A.snap.m[k].kind === 'home');
  for (let i = 0; i < 60; i++) {
    await N.step(10, 10); mins += 10;
    const p = window.__pm.pollution();
    peak = Math.max(0, ...HOMES.map(k => p[k] || 0));
    if (peak > 0) break;
  }
  /* 🔴 AND THE MEASUREMENT IS TAKEN AT THE CROSSING, NOT AFTER A TIDY-UP STEP.
     A cut of this driver soaked three blocks PAST the condition to get a
     fatter number to print, and the plume went away: /src/pollution's wind is
     driven by `hourOf()`, so the field swings with the day and a home that is
     over the 0.10 deadband at 100 sim-minutes can be under it at 130. Stepping
     "a bit further for a nicer figure" is how a driver acquires an intermittent
     failure that looks like a module bug. Measure where you stopped. */
  const C = { snap: window.__pm.snap(), pol: window.__pm.pollution() };
  const PV = window.__pm.PV();

  /* ⚠ THE COMPARISON RUNS OVER THE TILES THAT HAVE A POLLUTION ROW, i.e. homes
     and shops. The CIVIC ladder deliberately carries none (verdict.js
     civicTerms: a Clinic docked for the neighbourhood is the model marking its
     own homework), so a civic tile can see MythicPollution's response move with
     no term to move — which is a design decision, not a mismatch, and is
     counted and reported separately below rather than silently dropped. */
  const shared = Object.keys(C.snap.m).filter(k => A.snap.m[k] && A.snap.m[k].kind !== 'civic' && C.snap.m[k].kind !== 'civic');
  const civicMoved = Object.keys(C.snap.m).filter(k => A.snap.m[k] && C.snap.m[k].kind === 'civic' &&
                       Math.abs((C.pol[k] || 0) - (A.pol[k] || 0)) > 1e-9);
  const movedResp = shared.filter(k => Math.abs((C.pol[k] || 0) - (A.pol[k] || 0)) > 1e-9).sort();
  const movedTerm = shared.filter(k => Math.abs(C.snap.m[k].tv.pollution - A.snap.m[k].tv.pollution) > 1e-9).sort();
  const valueBad = [];
  for (const k of shared) {
    const r = C.snap.m[k];
    const w = r.kind === 'shop' ? PV.shop.pollution : PV.home.pollution;
    if (r.kind === 'civic') continue;             // the civic ladder has no pollution row
    const want = -(C.pol[k] || 0) * w;
    if (Math.abs(r.tv.pollution - want) > 1e-9)
      valueBad.push(k + ': term ' + r.tv.pollution + ' want ' + want);
  }
  /* Which OTHER rows moved, named rather than waved at. */
  const otherMoved = {};
  for (const k of shared) {
    for (const tk in C.snap.m[k].tv) {
      if (tk === 'pollution') continue;
      if (Math.abs(C.snap.m[k].tv[tk] - (A.snap.m[k].tv[tk] || 0)) > 1e-9)
        otherMoved[tk] = (otherMoved[tk] || 0) + 1;
    }
  }
  const pols = shared.filter(k => C.snap.m[k].kind !== 'civic')
                     .map(k => C.snap.m[k].tv.pollution).filter(Number.isFinite);
  const st = (() => { try { return window.MythicPollution.state(); } catch (e) { return null; } })();
  return { put, refused, movedResp, movedTerm, otherMoved, mins, civicMoved,
           valueBad: valueBad.slice(0, 5), nValueBad: valueBad.length,
           worst: pols.length ? Math.min(...pols) : null,
           maxResp: Math.max(0, ...Object.values(C.pol)),
           cityExposure: st ? st.exposure : null,
           emitted: st ? (st.sources || []).map(s => s.type + '@' + s.x + ',' + s.z +
                     ' air ' + (Number(s.air) || 0).toFixed(4)) : null };
});
console.log('   polluters placed: ' + (air.put.join(', ') || 'NONE') +
            (Object.keys(air.refused).length ? ' · refused: ' + JSON.stringify(air.refused) : ''));
console.log('   soaked ' + air.mins + ' sim-minutes to get the field over the 0.10 deadband');
if (air.emitted) console.log('   what the host sent /src/pollution as emitting works: ' + JSON.stringify(air.emitted));
ok('polluting works actually went up', air.put.length > 0, air.put.length + ' works');
console.log('   ' + air.movedResp.length + " tiles saw MythicPollution's own response move; " +
            air.movedTerm.length + ' saw the pollution TERM move (peak response ' + n(air.maxResp, 4) +
            ', city exposure ' + n(air.cityExposure, 4) + ')');
console.log('   other rows that moved in the same window: ' + JSON.stringify(air.otherMoved));
console.log('   civic tiles whose exposure moved with NO pollution row to move (by design): ' +
            air.civicMoved.length + (air.civicMoved.length ? ' ' + JSON.stringify(air.civicMoved) : ''));
/* 🔴 AN EMPTY SET EQUALS AN EMPTY SET. The first run of this driver printed
   PASS here on a plume that never existed, because the building had been
   refused silently. The claim is only meaningful if something moved. */
ok('the plume is real — MythicPollution\'s own response moved somewhere',
   air.movedResp.length > 0, air.movedResp.length + ' tiles');
ok('the set whose pollution term moved EQUALS the set whose response moved',
   setEq(air.movedResp, air.movedTerm),
   air.movedTerm.length + ' term-movers vs ' + air.movedResp.length + ' response-movers');
ok('every pollution term equals −response × its published weight, to 1e-9',
   air.nValueBad === 0, air.nValueBad ? JSON.stringify(air.valueBad) : 'worst penalty ' + n(air.worst, 4) + ' points');

phase('7. claim 3 — same type, two exposures: Δscore must BE Δpollution');
const sep = await page.evaluate(() => {
  const s = window.__pm.snap();
  const rows = Object.entries(s.m);
  let best = null, anyDiff = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const [ka, a] = rows[i], [kb, b] = rows[j];
    if (a.type !== b.type || a.kind !== b.kind) continue;
    const dPol = a.tv.pollution - b.tv.pollution;
    if (Math.abs(dPol) < 1e-9) continue;
    anyDiff++;
    let other = 0; const otherBy = {};
    for (const tk in a.tv) if (tk !== 'pollution') {
      const d = a.tv[tk] - (b.tv[tk] || 0);
      if (Math.abs(d) > 1e-12) otherBy[tk] = d;
      other += Math.abs(d);
    }
    const cand = { ka, kb, type: a.type, dPol, dScore: a.score - b.score, other, otherBy,
                   polA: a.tv.pollution, polB: b.tv.pollution };
    if (!best || other < best.other || (other === best.other && Math.abs(dPol) > Math.abs(best.dPol))) best = cand;
  }
  return { best, anyDiff, pairs: rows.length };
});
if (!sep.best) { ok('a same-type pair at two different exposures exists', false, 'none found'); }
else {
  console.log('   ' + sep.best.ka + ' vs ' + sep.best.kb + ' (' + sep.best.type + '): pollution term ' +
              n(sep.best.polA, 4) + ' vs ' + n(sep.best.polB, 4) +
              ' · ' + sep.anyDiff + ' such pairs on the board');
  console.log('   every OTHER row differs by a total of ' + n(sep.best.other, 12) +
              (Object.keys(sep.best.otherBy).length ? ' — ' + JSON.stringify(sep.best.otherBy) : ''));
  ok('the pair differs in pollution and in nothing else', sep.best.other < 1e-9,
     'residual across all other rows: ' + n(sep.best.other, 12));
  ok('score_A − score_B EQUALS pollutionTerm_A − pollutionTerm_B',
     Math.abs(sep.best.dScore - sep.best.dPol) < 1e-9,
     'Δscore ' + n(sep.best.dScore, 10) + ' vs Δpollution ' + n(sep.best.dPol, 10));
}

/* ── 8. CLAIM 4 — A MISSING MODULE CONTRIBUTES EXACTLY 0 ─────────────────── */
phase('8. claim 4a — stub /src/pollution and /src/demographics absent');
const stub = await page.evaluate(() => {
  const A = window.__pm.snap();
  const srcA = window.MythicPlotVerdict.sources();
  const P = window.MythicPollution, D = window.MythicDemographics;
  try { delete window.MythicPollution; } catch (e) { window.MythicPollution = undefined; }
  try { delete window.MythicDemographics; } catch (e) { window.MythicDemographics = undefined; }
  const B = window.__pm.snap();
  const srcB = window.MythicPlotVerdict.sources();
  window.MythicPollution = P; window.MythicDemographics = D;
  const C = window.__pm.snap();
  const srcC = window.MythicPlotVerdict.sources();

  const bad = [], side = {};
  for (const k in B.m) {
    const b = B.m[k], a = A.m[k];
    if (!a) continue;
    /* ⚠ THE CIVIC LADDER HAS NO POLLUTION ROW AT ALL, by design: a Clinic docked
       for the air is the model marking its own homework (verdict.js
       civicTerms). So the assertion is "if the row exists it is exactly 0",
       not "every tile has one" — the first cut asserted the latter and failed a
       Motor Pool for a row it is correct not to carry. */
    if ('pollution' in b.tv) {
      if (b.tv.pollution !== 0) bad.push(k + ': pollution term is ' + b.tv.pollution + ', not exactly 0');
      if (b.tl.pollution !== false) bad.push(k + ': pollution row still claims live');
    }
    if ('afford' in b.tv) {
      if (b.tv.afford !== 0) bad.push(k + ': afford term is ' + b.tv.afford + ', not exactly 0');
      if (b.tl.afford !== false) bad.push(k + ': afford row still claims live');
    }
    /* The score must move by PRECISELY the terms lost — no substitute. */
    const lost = ((a.tv.pollution || 0) - (b.tv.pollution || 0)) + ((a.tv.afford || 0) - (b.tv.afford || 0));
    if (Math.abs((b.score - a.score) + lost) > 1e-9)
      bad.push(k + ': score moved ' + (b.score - a.score) + ' but the terms lost were ' + (-lost));
    for (const tk in b.tv) {
      if (tk === 'pollution' || tk === 'afford') continue;
      if (Math.abs(b.tv[tk] - (a.tv[tk] || 0)) > 1e-9) side[tk] = (side[tk] || 0) + 1;
    }
  }
  return { bad: bad.slice(0, 6), nBad: bad.length, side,
           srcA: { pollution: srcA.pollution, demographics: srcA.demographics, water: srcA.water },
           srcB: { pollution: srcB.pollution, demographics: srcB.demographics, zeroed: srcB.zeroed },
           srcC: { pollution: srcC.pollution, demographics: srcC.demographics },
           restored: C.ok };
});
console.log('   sources() before: ' + JSON.stringify(stub.srcA));
console.log('   sources() while stubbed: ' + JSON.stringify(stub.srcB));
console.log('   sources() after restore: ' + JSON.stringify(stub.srcC));
console.log('   rows that moved for any OTHER reason in the same window: ' + JSON.stringify(stub.side));
ok('sources() reports both modules dead while they are gone',
   stub.srcB.pollution === 'absent' && stub.srcB.demographics === 'absent');
ok('zeroed names the terms that are therefore exactly 0',
   ['pollution', 'afford'].every(t => (stub.srcB.zeroed || []).indexOf(t) >= 0),
   JSON.stringify(stub.srcB.zeroed));
ok('their terms read EXACTLY 0 and the score falls by precisely what was lost',
   stub.nBad === 0, stub.nBad ? JSON.stringify(stub.bad) : 'checked every judged tile');
ok('both come back live when the modules do',
   stub.srcC.pollution === 'live' && stub.srcC.demographics === 'live');

phase('8b. claim 4b — the WATER source, which reads 1 whether it is nominal or gone');
const wstub = await page.evaluate(() => {
  const A = window.__pm.snap(); const srcA = window.MythicPlotVerdict.sources();
  const W = window.MythicWater;
  try { delete window.MythicWater; } catch (e) { window.MythicWater = undefined; }
  const B = window.__pm.snap(); const srcB = window.MythicPlotVerdict.sources();
  window.MythicWater = W;
  /* ⚠ sources() REPORTS ON THE LAST CALL, so it has to be re-asked after a
     sweep, not straight after the restore — the first cut read it immediately
     and got the stubbed answer back, which looked exactly like the module
     failing to come home. */
  window.__pm.snap();
  const srcC = window.MythicPlotVerdict.sources();
  const bad = [];
  for (const k in B.m) {
    if (B.m[k].tv.ground !== 0) bad.push(k + ': ground term ' + B.m[k].tv.ground);
    if (B.m[k].tl.ground !== false) bad.push(k + ': ground row still claims live');
  }
  return { a: srcA.water, b: srcB.water, c: srcC.water, zeroed: srcB.zeroed,
           nBad: bad.length, bad: bad.slice(0, 4),
           wtStillOne: window.__nc.wtFactorOf(4, 4) };
});
console.log('   wtFactorOf(4,4) with /src/water deleted still reads ' + wstub.wtStillOne +
            ' — which is exactly why the number cannot be the source of truth');
ok('sources().water is live -> absent -> live across the stub',
   wstub.a === 'live' && wstub.b === 'absent' && wstub.c === 'live',
   wstub.a + ' -> ' + wstub.b + ' -> ' + wstub.c);
ok('ground is listed in zeroed and every ground row is exactly 0 and not live',
   (wstub.zeroed || []).indexOf('ground') >= 0 && wstub.nBad === 0,
   wstub.nBad ? JSON.stringify(wstub.bad) : JSON.stringify(wstub.zeroed));

/* ── 9. CLAIM 5 — THE DEMAND_RAMP_SEC TRAP ──────────────────────────────── */
phase('9. claim 5 — the ramp trap, printed as TWO SEPARATE TABLES');
const ramp = await page.evaluate(async () => {
  const N = window.__nc;
  const top = (s) => {
    const by = {};
    for (const k in s.m) by[s.m[k].reason] = (by[s.m[k].reason] || 0) + 1;
    const scores = Object.values(s.m).map(r => r.score);
    return { by, mean: scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length),
             min: Math.min(...scores), max: Math.max(...scores),
             ramping: s.ramping, rampLeftSec: s.rampLeftSec };
  };
  /* A: the ramp reset to 0, i.e. the first frame after a load. */
  N.game.cov.ramp = 0;
  await N.step(0.5, 1);
  const a = top(window.__pm.snap()); const covFresh = window.__pm.cov();
  /* B: the ramp expired. */
  N.game.cov.ramp = 100000;
  await N.step(0.5, 1);
  const b = top(window.__pm.snap()); const covSettled = window.__pm.cov();
  return { a, b, covFresh, covSettled };
});
console.log('   TABLE A — immediately after a load (ramp reset to 0)');
console.log('     ramping=' + ramp.a.ramping + ' rampLeftSec=' + n(ramp.a.rampLeftSec, 1) +
            ' · mean score ' + n(ramp.a.mean, 2) + ' (min ' + n(ramp.a.min, 2) + ', max ' + n(ramp.a.max, 2) + ')');
console.log('     reasons ' + JSON.stringify(ramp.a.by));
console.log('   TABLE B — after DEMAND_RAMP_SEC has expired');
console.log('     ramping=' + ramp.b.ramping + ' rampLeftSec=' + n(ramp.b.rampLeftSec, 1) +
            ' · mean score ' + n(ramp.b.mean, 2) + ' (min ' + n(ramp.b.min, 2) + ', max ' + n(ramp.b.max, 2) + ')');
console.log('     reasons ' + JSON.stringify(ramp.b.by));
ok('the sweep FLAGS the ramping window rather than photographing it silently',
   ramp.a.ramping === true && ramp.b.ramping === false);
ok('the two tables are different — a fresh city is not the settled one',
   Math.abs(ramp.a.mean - ramp.b.mean) > 1e-9 || JSON.stringify(ramp.a.by) !== JSON.stringify(ramp.b.by),
   'mean ' + n(ramp.a.mean, 3) + ' vs ' + n(ramp.b.mean, 3));

/* ── 10. WHAT A SWEEP COSTS ─────────────────────────────────────────────── */
phase('10. what a whole-board sweep costs');
const perf = await page.evaluate(() => {
  const t = [];
  for (let i = 0; i < 9; i++) {
    const a = performance.now();
    const s = window.__nc.plotVerdictSweep();
    t.push(performance.now() - a);
    if (i === 8) return { ms: t.sort((x, y) => x - y), judged: s.judged, cells: s.cells };
  }
});
console.log('   ' + perf.judged + '-tile sweep over ' + perf.cells + ' cells: median ' +
            perf.ms[4].toFixed(2) + ' ms (best ' + perf.ms[0].toFixed(2) + ', worst ' +
            perf.ms[perf.ms.length - 1].toFixed(2) + ')');

const gc = await page.evaluate(() => { clearInterval(window.__pmAuto); return window.__pmConfirms; });
console.log('   in-world gcConfirm dialogs answered across the whole run: ' + gc);

const errs = logs.filter(l => l.startsWith('pageerror') || l.indexOf('FAILED') >= 0);
if (errs.length) { console.log('\n   page errors / self-check failures:'); for (const e of errs.slice(0, 8)) console.log('     ' + e); }

console.log('\n[' + stamp() + '] ' + (fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
