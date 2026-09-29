/* ══════════════════════════════════════════════════════════════════════════
   🏙 FIXTURE-SERVICED-CITY — a city that is actually LIVING, as a reusable part.

   WHY THIS EXISTS. Three separate claims were left unprovable at the end of the
   camp/mood run, all for one reason: every harness city is a slum. The mood
   driver's scene is 42 houses, two farms and two turbines, and it holds FOUR
   population. In a city like that:

     · `_stashChoke` never bites, so the Camp card's amber "vault full" state is
       unreachable — the branch is proven correct against its rule and has never
       been seen alive;
     · MythicPower.factorAt holds ONE value for the whole run, so any assertion
       about the power number is a target that cannot move and therefore a check
       that cannot fail;
     · every city-wide need sits near 0.27, and plotMood takes the MIN, so a
       city-wide need ALWAYS wins the badge and no LOCAL reason (`road`, `dark`,
       `water`) can ever be the printed verdict — the local half of the mood
       layer has never been observed deciding anything.

   A serviced city fixes all three at once, which is why it is worth building
   once and importing rather than open-coding a fourth time.

   WHAT "SERVICED" MEANS HERE. node-city has eight NEEDS — food, water, power,
   safety, light, health, leisure, deathcare — and a building declares what it
   serves through `svc: { need, supply }`. This puts a real supplier behind
   every one of them, plumbs and wires the block, and then TICKS UNTIL THE
   NUMBERS SAY SO rather than assuming a placement worked.

   ⚠ IT ASSERTS ITS OWN POSTCONDITION. A fixture that half-built and returned
     quietly would hand every importing driver a slum wearing a fixture's name,
     and those drivers would report confident greens about a city that never
     existed. build() THROWS unless the city it promised is the city it made.

   Import:  import { boot, build } from './fixture-serviced-city.mjs';
   Self-test:  node .gauntlet/fixture-serviced-city.mjs
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

/* ── boot: server + browser + a node-city page with __nc up ───────────────── */
export async function boot(opts = {}) {
  const PORT = (opts.port || 8990) + (process.pid % 40);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  /* three@0.171 is vendored — the CDN is blocked, and a missing three is a
     blank canvas with a clean console, which reads as "the scene is empty". */
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
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 240)));
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

  await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('!!window.__nc', null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(14000);
  return { server, browser, page, logs, port: PORT,
           close: async () => { await browser.close(); server.close(); } };
}

/* ── the plan. One supplier per NEED, named so a failure says which. ──────── */
export const PLAN = {
  housing:   { n: 24, why: 'population — every per-head demand scales off it' },
  grocery:   { n: 2,  why: 'food (svc supply 4.8, the strongest food row)' },
  farm:      { n: 3,  why: 'rations, so grocery has an input and the larder fills' },
  clinic:    { n: 2,  why: 'health (svc 1.5)' },
  police:    { n: 1,  why: 'safety (svc 2.2)' },
  club:      { n: 1,  why: 'leisure (svc 1.8)' },
  cemetery:  { n: 1,  why: 'deathcare (svc 0.020, 3x the graveyard)' },
  streetlight: { n: 6, why: 'light — per block, not per head' },
  waterintake: { n: 1, why: 'raw water into the pipe network' },
  purifier:  { n: 1,  why: 'potable water — the intake alone does not serve' },
  wind:      { n: 4,  why: 'power, and enough of it that factorAt can MOVE' },
};

export async function build(page, opts = {}) {
  const O = Object.assign({ x0: 6, z0: 6, w: 6, ticksPerRound: 6, rounds: 14 }, opts);
  const res = await page.evaluate(async (O) => {
    const nc = window.__nc, BR = window.MythicCityBridge;
    /* A fixture must not be gated by a wallet — this is the same reason
       MythicWater.pipes.add exists beside the pipe tool. */
    BR.spendCinders = async () => true; BR.spendRes = async () => true;
    BR.getCinders = async () => 9e9; BR.getRes = async () => 9e9; BR.addCinders = async () => true;

    /* ⚠ TWO BUILD SLOTS. nc.build.slots() is 2 and a third place() is refused
       SILENTLY with the same falsy return as success — the mood driver's first
       cut measured a 12-tile city that never existed. One at a time, with
       finishAll() behind each. */
    const placed = [];
    const put = async (type, x, z) => {
      await nc.place(type, x, z);
      try { nc.build.finishAll(); } catch (e) {}
      const t = nc.game.tiles[x + ',' + z];
      placed.push({ type, x, z, ok: !!(t && t.type === type) });
      return !!(t && t.type === type);
    };

    const spots = [];
    for (let z = O.z0; z < O.z0 + 12; z++) for (let x = O.x0; x < O.x0 + O.w; x++) spots.push([x, z]);
    let si = 0;
    const next = () => spots[si++];

    /* Roads first — they are not sites and go straight down, and roadcap is one
       of the mood terms, so an unroaded block never reads clean. */
    for (let x = O.x0 - 1; x <= O.x0 + O.w; x++) await nc.place('road', x, O.z0 - 1);
    for (let z = O.z0; z < O.z0 + 12; z++) await nc.place('road', O.x0 - 1, z);

    const order = ['waterintake', 'purifier', 'wind', 'farm', 'grocery', 'clinic',
                   'police', 'club', 'cemetery', 'streetlight', 'housing'];
    const PLAN = O.plan;
    for (const type of order) {
      const n = (PLAN[type] || {}).n || 0;
      for (let i = 0; i < n; i++) { const s = next(); if (s) await put(type, s[0], s[1]); }
    }

    /* 💧 PLUMB IT. A purifier with no pipe serves nobody, and `water` is a mood
       term, so an unplumbed block reads `water` forever. */
    let pipes = 0;
    try {
      const W = window.MythicWater;
      const cells = [];
      for (let z = O.z0 - 1; z < O.z0 + 12; z++) for (let x = O.x0 - 1; x <= O.x0 + O.w; x++) cells.push(x + ',' + z);
      pipes = W.pipes.add(cells) || 0;
    } catch (e) {}

    /* ⚡ WIRE IT, for the same reason. */
    let lines = 0;
    try {
      const P = window.MythicPower;
      P.lines.arm(true);
      P.lines.lay(O.x0, O.z0, O.x0 + O.w - 1, O.z0);
      P.lines.lay(O.x0, O.z0, O.x0, O.z0 + 11);
      P.lines.lay(O.x0, O.z0 + 11, O.x0 + O.w - 1, O.z0 + 11);
      P.lines.arm(false);
      lines = P.lines.count ? P.lines.count() : 1;
    } catch (e) {}

    /* 🔴 TICK UNTIL THE NUMBERS SAY SO. Coverage phases in over DEMAND_RAMP_SEC
       and population only grows once food/water/health clear — so a fixture
       that placed and returned would hand back a city mid-ramp and every
       importer would measure the ramp instead of the city. */
    const trace = [];
    for (let r = 0; r < O.rounds; r++) {
      await nc.step(O.ticksPerRound, 6);
      trace.push({ r, pop: nc.game.pop | 0,
                   avg: +(nc.game.cov.avg || 0).toFixed(3),
                   cov: Object.fromEntries(Object.entries(nc.game.cov.pct || {}).map(([k, v]) => [k, +v.toFixed(2)])) });
    }
    try { window.MythicPlotMood.invalidate('fixture'); } catch (e) {}

    return {
      tiles: Object.keys(nc.game.tiles).length,
      pop: nc.game.pop | 0,
      placed, pipes, lines, trace,
      cov: Object.fromEntries(Object.entries(nc.game.cov.pct || {}).map(([k, v]) => [k, +v.toFixed(3)])),
      avg: +(nc.game.cov.avg || 0).toFixed(3),
      powerFactor: (() => { try { return window.MythicPower.factorAt(O.x0 + 1, O.z0 + 1); } catch (e) { return null; } })(),
      waterServed: (() => { try { return window.MythicWater.servedAt((O.x0 + 1) + ',' + (O.z0 + 1)); } catch (e) { return null; } })(),
    };
  }, Object.assign({}, O, { plan: PLAN }));

  /* ── THE POSTCONDITION. A fixture that lies is worse than no fixture. ───── */
  const refused = res.placed.filter((p) => !p.ok);
  const problems = [];
  if (refused.length) problems.push(refused.length + ' placement(s) refused: ' +
    refused.slice(0, 6).map((p) => p.type + '@' + p.x + ',' + p.z).join(', '));
  if (!(res.pop > 4)) problems.push('population is ' + res.pop + ' — the slum this fixture exists to replace holds 4');
  const NEEDS = ['food', 'water', 'power', 'safety', 'light', 'health', 'leisure', 'deathcare'];
  const dark = NEEDS.filter((n) => !(res.cov[n] > 0.5));
  if (dark.length) problems.push('need(s) still under 50%: ' + dark.map((n) => n + '=' + res.cov[n]).join(', '));
  if (problems.length && !opts.lenient) {
    const e = new Error('the serviced-city fixture did not build the city it promises:\n   · ' +
                        problems.join('\n   · '));
    e.detail = res;
    throw e;
  }
  res.problems = problems;
  return res;
}

/* ── self-test ───────────────────────────────────────────────────────────── */
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('fixture-serviced-city.mjs')) {
  const H = await boot();
  let fails = 0;
  const ok = (name, cond, detail) => {
    if (!cond) fails++;
    console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
  };
  console.log('\n\u{1F3D9} SERVICED-CITY FIXTURE — self-test\n');
  let r = null, err = null;
  try { r = await build(H.page, { lenient: true }); } catch (e) { err = e; }
  if (err) { console.log('  build threw: ' + err.message); fails++; }
  else {
    console.log('   ' + r.tiles + ' tiles · pop ' + r.pop + ' · ' + r.pipes + ' pipe cells · avg coverage ' + r.avg);
    console.log('   coverage ' + JSON.stringify(r.cov));
    console.log('   power factor ' + r.powerFactor + ' · water served ' + r.waterServed);
    console.log('   pop trace ' + r.trace.map((t) => t.pop).join(' → '));
    ok('every placement was accepted (a silent refusal is the trap here)',
       r.placed.every((p) => p.ok),
       r.placed.filter((p) => !p.ok).length + ' refused of ' + r.placed.length);
    ok('the city is populated — not the 4-pop slum', r.pop > 4, 'pop ' + r.pop);
    ok('every one of the eight needs has a real supplier above 50%',
       r.problems.every((p) => p.indexOf('under 50%') < 0), r.problems.join(' | ') || 'all covered');
    ok('the block is plumbed', (r.pipes | 0) > 0, r.pipes + ' cells');
    ok('the block is served water', r.waterServed === true, String(r.waterServed));
    ok('a power factor exists to move', r.powerFactor != null, String(r.powerFactor));
  }
  console.log('\npage errors: ' + H.logs.filter((l) => l.startsWith('pageerror')).length);
  H.logs.filter((l) => l.startsWith('pageerror')).slice(0, 3).forEach((l) => console.log('   ' + l));
  console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
  await H.close();
  process.exit(fails ? 1 : 0);
}
