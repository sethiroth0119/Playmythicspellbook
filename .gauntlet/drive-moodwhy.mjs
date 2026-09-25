/* ══════════════════════════════════════════════════════════════════════════
   😟 DRIVE-MOODWHY — "the frown has to be actionable, and the panel has to
   agree with itself."

   Boots public/node-city/index.html in real Chromium, serves public/ over
   loopback and fulfils the page's three@0.171.0 import map out of the vendored
   copy at .gauntlet/three171 (this box cannot reach a CDN, and substituting a
   CDN script tag that carries an SRI hash fails SILENTLY — a blank page with a
   clean console).

   THREE CLAIMS, ALL COUNTED RATHER THAN DESCRIBED:

     1  THE PANEL AGREES WITH THE API — MISMATCH COUNT MUST BE 0.
        For every tile /src/plotmood judges, open the dossier through
        __nc.inspect(k), scrape the face glyph, the reason id and the printed
        number straight off the DOM, and compare them to __nc.plotMood(x,z) for
        the same tile. The reason id must be IDENTICAL and the printed number
        must match the API to its printed precision.
        ⚠ THE SCRAPE AND THE API CALL HAPPEN IN ONE SYNCHRONOUS TASK, on
          purpose. economyTick and the coverage pass run on intervals; read the
          DOM in one task and the API in the next and a tick can land between
          them, which would report a drift that is really a clock.

     2  THE CITIZEN MOOD BREAKDOWN SURVIVED — TWO BOOLEANS.
        ctHtml() SILENTLY DROPS its whole "What that mood is made of" section
        when citMoodTarget() and ctTerms() disagree by more than 0.1, and this
        round's standing instruction was to add NOTHING to that formula. So the
        block is asserted PRESENT in the DOM on the tree as it was BEFORE this
        piece (served from a pristine copy) and PRESENT on the tree as it is
        now. Two booleans, both must be true; the "before" leg is what makes
        the "after" leg mean anything.

     3  EVERY FROWN CARRIES A FIX — COUNT OF (face==frown && fix=='') MUST BE 0.
        A frowning face with no sentence under it is a happiness bar with extra
        steps, which is the single worst outcome this feature can have.

     4  THE "LIMITED BY" LINE CANNOT BE READ ON THE WRONG SCALE — TWO COUNTS.
        (a) the printed figure is never a bare 0 while the term it names says
            "no roads" / "no mains" / "no lamps". The line used to print the
            term's `raw`, and the three DISTANCE terms set raw=0 when nothing
            of that kind existed ANYWHERE — so a card headlined "😟 No road
            access · no roads" printed "📉 Limited by: ROAD 0" four lines
            below itself, and 0 on a distance scale reads as "it is here".
        (b) the printed figure always carries a unit token (%, tile/tiles, /,
            or one of the explicit "no mains"/"no roads"/"no lamps" strings).
            ROAD/DARK/WATER are tile distances where higher is WORSE and
            HEALTH/POWER/ROADCAP are percentages where higher is BETTER, so
            an unlabelled "ROAD 26" beside "HEALTH 38" put two opposite
            directions of badness on one line with nothing to tell them
            apart. Both counts must be 0, and §3d proves them non-vacuous:
            it seeds a city with ONE stranded building and NO roads and NO
            lamps anywhere, which is the only state that reaches the bug.

   Run:  node .gauntlet/drive-moodwhy.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
/* The tree as it stood BEFORE this piece, copied into the deploy root for the
   length of the run and removed in the finally. It is a real page served from
   the real place because ctHtml's block is DOM, and the only honest way to ask
   whether it is in the DOM is to put it in a browser. */
const BASE_SRC = path.resolve(process.cwd(), '.gauntlet/progress/p5/moodwhy-baseline.html');
const BASE_DST = path.join(ROOT, 'node-city', '__pmbase.html');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };


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
/* Port 0 lets the OS pick a free one. A pid-derived constant collided with a
   previous run of this same driver that had not released the socket yet, and
   the whole harness died on EADDRINUSE before a single check ran. */
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT_LIVE = server.address().port;

let baselineCopied = false;
if (fs.existsSync(BASE_SRC)) { fs.copyFileSync(BASE_SRC, BASE_DST); baselineCopied = true; }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
      /* FULFIL, never redirect: Playwright refuses to override an https request
         with an http URL, and the page's import map is pinned to the CDN. */
      const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
      const f = path.join(THREE_DIR, rel);
      return fs.existsSync(f)
        ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
        : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
    }
    if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
    return route.abort();
  });
  return page;
}

async function boot(page, file) {
  await page.goto('http://127.0.0.1:' + PORT_LIVE + '/node-city/' + file, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
  /* ⚠ WAIT FOR THE CITIZEN SEAM, do not assume it. CTALK_API attaches itself to
     __nc from a setTimeout retry loop (up to ~10 s), so a fixed sleep gave the
     baseline page "no citizen UI seam" and reported a MISSING mood breakdown
     that was actually present — a false negative on the one non-regression this
     round is required to prove. */
  await page.waitForFunction('!!(window.__nc && window.__nc.citizenUI)', null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(9000);
}

try {
const page = await newPage();
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 220)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 220)));
await boot(page, 'index.html');

/* ── 0. BOOT ─────────────────────────────────────────────────────────── */
console.log('\n0. boot');
const b0 = await page.evaluate(() => ({
  nc: !!window.__nc,
  pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready()),
  api: !!(window.__nc && typeof window.__nc.plotMood === 'function'),
  status: !!(window.__nc && typeof window.__nc.tileStatus === 'function'),
  place: !!(window.__nc && typeof window.__nc.place === 'function'),
  eco: !!(window.MythicEconomy && window.MythicEconomy.ready && window.MythicEconomy.ready()),
  tiles: window.__nc ? Object.keys(window.__nc.game.tiles).length : 0,
}));
ok('the page booted with the diagnostics seam', b0.nc);
ok('/src/plotmood mounted', b0.pm);
ok('__nc.plotMood is on the seam', b0.api);
ok('__nc.tileStatus is on the seam', b0.status);
console.log('   tiles at boot: ' + b0.tiles + ' · /src/economy ' + (b0.eco ? 'up' : 'absent'));
if (!b0.pm) {
  console.log('\n   /src/plotmood did not mount — every check below would be vacuous.');
  console.log('   console tail:\n     ' + logs.slice(-12).join('\n     '));
}

/* ── 1. A CITY WITH SOMETHING TO SAY ──────────────────────────────────────
   Types are CHOSEN BY PREDICATE off the live BUILDINGS table, never typed:
   a hard-coded 'clinic' is a test that breaks the day a row is renamed and
   passes the day one is added wrong. Placement goes through __nc.place —
   the real tryPlace — so meshes, links and coverage are all real; a refusal
   falls back to a direct tile write, which /src/plotmood reads just the same.
   A wrecked one and a half-built one are seeded deliberately: they are the
   two states where the status badge and the mood card could contradict. */
console.log('\n1. seed a city with real problems in it');
const seeded = await page.evaluate(async () => {
  const nc = window.__nc, B = nc.BUILDINGS, g = nc.game;
  /* tryPlace is ASYNC (it awaits payCost), so `!!nc.place(...)` is a truthy
     Promise and the first version of this driver placed nothing while
     reporting seventeen successes. Await every one. */
  for (const r in g.res) g.res[r] = 99999;
  try { g.wallet.cinder = 9e6; } catch (e) {}
  /* payCost awaits MythicCityBridge.spendCinders/spendRes. This page is served
     STANDALONE, not inside index.html's iframe, so if the bridge ever answers
     over postMessage there is nobody to answer and the await never settles.
     Race it and fall back to a direct tile write, which /src/plotmood reads
     exactly the same way — the feature under test is the verdict, not the till. */
  const raced = (p) => Promise.race([Promise.resolve(p),
    new Promise((r) => setTimeout(() => r(false), 1500))]);
  const pick = (fn) => Object.keys(B).find((t) => {
    const d = B[t];
    return d && !d.decor && !d.opType && !d.edgeOnly && (d.maxLvl == null || d.maxLvl > 0) && fn(d, t);
  });
  const home = pick((d) => (d.popCap | 0) > 0);
  const works = pick((d) => d.gen && !d.gen.cinder && !d.svc && !d.gen.power);
  const shop = pick((d) => d.gen && d.gen.cinder);
  const clinic = pick((d) => d.svc && d.svc.need === 'health');
  const kitchen = pick((d) => d.svc && d.svc.need === 'food');
  const lamp = pick((d) => d.lightRadius);
  const plan = [];
  const put = (type, x, z) => { if (type) plan.push({ type, x, z }); };
  /* A street with things on both sides, and then two buildings deliberately
     stranded miles from it — the road/dark reasons need a tile that really has
     no road, not a tile the test hopes has none. */
  for (let i = 0; i < 6; i++) put('road', 4 + i, 5);
  for (let i = 0; i < 4; i++) put(home, 4 + i, 4);
  put(works, 4, 6); put(works, 6, 6); put(shop, 8, 6);
  put(clinic, 4, 8); put(kitchen, 6, 8); put(lamp, 8, 8);
  put(home, 16, 16); put(shop, 18, 18);          // stranded, no road anywhere near
  const placed = [], fellBack = [];
  for (const p of plan) {
    const k = p.x + ',' + p.z;
    if (g.tiles[k]) continue;
    let done = false;
    try { done = !!(await raced(nc.place(p.type, p.x, p.z))); } catch (e) { done = false; }
    if (!g.tiles[k]) { g.tiles[k] = { type: p.type, lvl: 1 }; fellBack.push(k); }
    placed.push(k);
  }
  /* One wreck and one construction site — the two states the badge owns. */
  const built = Object.keys(g.tiles).filter((k) => {
    const d = B[g.tiles[k].type];
    return d && !d.decor && (d.popCap || d.gen || d.svc || d.crew);
  });
  let wrecked = null, site = null;
  if (built[0]) { g.tiles[built[0]].damaged = true; wrecked = built[0]; }
  if (built[1]) { g.tiles[built[1]].bld = { k: 0, s: Date.now(), d: 99999 }; site = built[1]; }
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('driver'); } catch (e) {}
  return { placed: placed.length, fellBack: fellBack.length, wrecked, site,
           types: { home, works, shop, clinic, kitchen, lamp },
           tiles: Object.keys(g.tiles).length };
});
console.log('   placed ' + seeded.placed + ' tiles (' + seeded.fellBack + ' by direct write) · board now ' + seeded.tiles);
console.log('   types chosen by predicate: ' + JSON.stringify(seeded.types));
console.log('   wrecked ' + seeded.wrecked + ' · site ' + seeded.site);
ok('a wrecked tile and a construction site are on the board',
  !!seeded.wrecked && !!seeded.site, seeded.wrecked + ' / ' + seeded.site);

await page.waitForTimeout(2500);

/* ── 2. THE MISMATCH COUNT ─────────────────────────────────────────────── */
console.log('\n2. every judged tile: DOM vs __nc.plotMood — mismatch count must be 0');
/* Run twice: once on the city as seeded (understaffed, wrecked, off-grid) and
   once with the workforce answered, so the sweep covers CONTENT faces as well
   as frowns. A check that only ever sees one face proves half a mapping. */
/* Takes the page as an argument: §3d sweeps a SECOND, separately booted city
   (one stranded building, no roads, no lamps) and must run the identical
   scrape rather than a second copy of it that could drift. */
const sweepOn = (pg) => pg.evaluate(() => {
  const nc = window.__nc;
  const PM = window.MythicPlotMood;
  const out = { judged: 0, carded: 0, mismatches: [], frownNoFix: [], faces: {},
                reasons: {}, pillCases: 0, pillAgreed: 0, threw: [],
                limCases: 0, limUnbounded: 0, limNoTerm: 0, limZero: [], limNoUnit: [] };
  if (!PM || !PM.ready()) return out;
  const all = PM.all();
  out.judged = all.length;
  /* The "Limited by" figure as the PLAYER sees it: the .fac row whose label
     carries the words, read off the DOM. Asking the API for it would prove
     nothing — the whole point is that the unit reaches the screen. */
  const scrapeLim = (card) => {
    for (const f of card.querySelectorAll('.fac')) {
      const l = (f.querySelector('.fac-l') || {}).textContent || '';
      if (l.indexOf('Limited by') >= 0) return ((f.querySelector('.fac-v') || {}).textContent || '').trim();
    }
    return null;
  };
  for (const m of all) {
    const k = m.k;
    /* ⚠ ONE SYNCHRONOUS TASK PER TILE: open, scrape, ask the API. Nothing may
       await in here or a tick can land between the DOM read and the API read
       and report a clock as a drift. */
    let dom = null, api = null;
    try {
      nc.inspect(k);
      const card = document.getElementById('pmcard');
      if (card) {
        const row = card.querySelector('[data-pm-reason]');
        const badge = document.getElementById('insstatus');
        dom = row ? {
          reason: row.getAttribute('data-pm-reason'),
          face: row.getAttribute('data-pm-face'),
          glyph: (row.querySelector('.pmf') || {}).textContent || '',
          num: ((row.querySelector('.pmn') || {}).textContent || '').trim(),
          fix: ((row.querySelector('.pmfix') || {}).textContent || '').trim(),
          badge: (badge ? badge.textContent : '').trim(),
        } : null;
      }
      if (dom && card) dom.lim = scrapeLim(card);
      api = nc.plotMoodKey(k);
    } catch (e) { out.threw.push(k + ': ' + String((e && e.message) || e)); continue; }

    if (!api) { out.mismatches.push({ k, why: 'API returned nothing for a judged tile' }); continue; }
    if (!dom) { out.mismatches.push({ k, why: 'no #pmcard in the dossier for a judged tile' }); continue; }
    out.carded++;
    out.faces[api.face] = (out.faces[api.face] || 0) + 1;
    out.reasons[api.reason] = (out.reasons[api.reason] || 0) + 1;

    if (dom.reason !== api.reason)
      out.mismatches.push({ k, why: 'reason id', dom: dom.reason, api: api.reason });
    if (dom.num !== api.valueTxt)
      out.mismatches.push({ k, why: 'printed number', dom: dom.num, api: api.valueTxt });
    if (dom.face !== api.face)
      out.mismatches.push({ k, why: 'face', dom: dom.face, api: api.face });
    if (dom.glyph !== api.glyph)
      out.mismatches.push({ k, why: 'glyph', dom: dom.glyph, api: api.glyph });
    if (dom.fix !== String(api.fix || ''))
      out.mismatches.push({ k, why: 'fix sentence', dom: dom.fix.slice(0, 40), api: String(api.fix || '').slice(0, 40) });

    /* THE PILL DID NOT GET CONTRADICTED. When the badge is in a hard state the
       card's headline must BE that state, not something else. */
    /* 📉 THE "LIMITED BY" LINE. Same task, same tile, scraped not asked.
       First it must agree with the API (a printer check), and then the two
       counts that a printer check is structurally blind to: the API and the
       DOM are the same function, so comparing them can never catch a figure
       that is wrong in BOTH. These two read the string itself. */
    if (String(dom.lim == null ? '' : dom.lim) !== String(api.limitedBy || ''))
      out.mismatches.push({ k, why: 'Limited by line', dom: dom.lim, api: api.limitedBy });
    if (dom.lim) {
      out.limCases++;
      const bind = (api.terms || []).find((o) => o.short && dom.lim.indexOf(o.short + ' ') === 0) || null;
      if (!bind) out.limNoTerm++;
      const fig = bind ? dom.lim.slice(bind.short.length + 1).trim()
                       : dom.lim.replace(/^[A-Z]+\s*/, '').trim();
      const unbounded = !!(bind && /^no /.test(String(bind.valueTxt || '')));
      if (unbounded) out.limUnbounded++;
      // (a) the inversion: a bare 0 printed for a distance that does not exist
      if (unbounded && /^0$/.test(fig)) out.limZero.push({ k, printed: dom.lim, valueTxt: bind.valueTxt });
      // (b) the unit token has to be on screen
      if (!/%/.test(fig) && !/\btiles?\b/.test(fig) && fig.indexOf('/') < 0 &&
          ['no mains', 'no roads', 'no lamps'].indexOf(fig) < 0)
        out.limNoUnit.push({ k, printed: dom.lim, fig });
    }

    const st = nc.tileStatus(k);
    const HARD = ['damaged', 'upgrading', 'halted', 'brownout', 'underfed', 'understaffed'];
    if (st && HARD.indexOf(st.key) >= 0) {
      out.pillCases++;
      const expect = { damaged: 'damaged', upgrading: 'upgrading', halted: 'no_input',
                       brownout: 'brownout', underfed: 'underfed', understaffed: 'understaffed' }[st.key];
      if (api.reason === expect && dom.badge.indexOf(st.txt) >= 0) out.pillAgreed++;
      else out.mismatches.push({ k, why: 'the card contradicted the status badge',
                                 dom: st.txt + ' / ' + dom.badge, api: api.reason + ' (expected ' + expect + ')' });
    }

    /* THE FROWN CARRIES A FIX. Checked on the PRINTED string, not the object:
       a fix that exists in the API and renders empty is the same bug. */
    if (api.face === 'frown' && (!dom.fix || !String(api.fix || '').trim()))
      out.frownNoFix.push({ k, reason: api.reason });
  }
  try { nc.inspect(all[0] ? all[0].k : ''); } catch (e) {}
  return out;
});
const doSweep = () => sweepOn(page);
const sweep = await doSweep();
console.log('   judged ' + sweep.judged + ' tiles · ' + sweep.carded + ' carried a card');
console.log('   faces:   ' + JSON.stringify(sweep.faces));
console.log('   reasons: ' + JSON.stringify(sweep.reasons));
console.log('   hard status-badge cases: ' + sweep.pillCases + ' · card agreed on ' + sweep.pillAgreed);
if (sweep.threw.length) console.log('   threw: ' + JSON.stringify(sweep.threw.slice(0, 4)));
ok('every judged tile carries a mood card', sweep.judged > 0 && sweep.carded === sweep.judged,
  sweep.carded + ' / ' + sweep.judged);
ok('MISMATCH COUNT IS 0 (reason id, printed number, face, glyph, fix, badge)',
  sweep.mismatches.length === 0, 'count=' + sweep.mismatches.length);
if (sweep.mismatches.length) console.log('   ' + JSON.stringify(sweep.mismatches.slice(0, 8), null, 1));
ok('no tile threw while its dossier was opened', sweep.threw.length === 0, 'count=' + sweep.threw.length);

/* ── 3. EVERY FROWN CARRIES A FIX ──────────────────────────────────────── */
console.log('\n3. frowns with no fix sentence — count must be 0');
ok('COUNT OF (face==frown && fix=="") IS 0', sweep.frownNoFix.length === 0,
  'count=' + sweep.frownNoFix.length + (sweep.frownNoFix.length ? ' ' + JSON.stringify(sweep.frownNoFix.slice(0, 6)) : ''));
/* And the module's own self-check makes the same claim about the roster it
   scores, which is the half this file does not own. */
const pv = await page.evaluate(() => { try { return window.MythicPlotMood.verify(); } catch (e) { return null; } });
ok('/src/plotmood self-check is clean', !!(pv && pv.ok),
  pv ? 'judged=' + pv.judged + ' problems=' + (pv.problems || []).length : 'no verify()');

/* ── 3b. THE SAME SWEEP ON A CITY THAT IS COPING ───────────────────────────
   Answer the workforce and repair the wreck, then sweep again. This is what
   makes the mapping claim total: the first pass never saw a content face, and
   a face word that is only ever "frown" would agree with anything. */
console.log('\n3b. the same sweep once the city is coping — happy faces must agree too');
await page.evaluate(() => {
  const nc = window.__nc;
  nc.game.army.workers = 500;
  for (const k in nc.game.tiles) { delete nc.game.tiles[k].damaged; delete nc.game.tiles[k].bld; }
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('driver-relief'); } catch (e) {}
});
await page.waitForTimeout(1200);
const sweep2 = await doSweep();
console.log('   judged ' + sweep2.judged + ' tiles · ' + sweep2.carded + ' carried a card');
console.log('   faces:   ' + JSON.stringify(sweep2.faces));
console.log('   reasons: ' + JSON.stringify(sweep2.reasons));
ok('MISMATCH COUNT IS 0 on the recovered city too', sweep2.mismatches.length === 0,
  'count=' + sweep2.mismatches.length);
if (sweep2.mismatches.length) console.log('   ' + JSON.stringify(sweep2.mismatches.slice(0, 8), null, 1));
ok('COUNT OF (face==frown && fix=="") IS 0 on the recovered city too',
  sweep2.frownNoFix.length === 0, 'count=' + sweep2.frownNoFix.length);

/* ── 3c. A CITY WITH NOTHING WRONG WITH IT ─────────────────────────────────
   The first two sweeps never produced a content face — the simulated firms are
   genuinely short of labour and the board is genuinely unlit — so the
   frown→'frown' half of the face mapping is the only half either of them
   proved. game.cov.pct is written directly here, and that is legitimate for
   THIS check and no other: it is the exact INPUT /src/plotmood reads, the thing
   under test is the DISPLAY agreement rather than the coverage arithmetic, and
   a mapping only one branch of which is ever exercised is a mapping that agrees
   with anything. Light and road are answered by BUILDING, not by writing. */
console.log('\n3c. a city with nothing wrong with it — the content face must agree too');
const relief = await page.evaluate(async () => {
  const nc = window.__nc, g = nc.game;
  g.army.workers = 4000;
  for (const k in g.tiles) { delete g.tiles[k].damaged; delete g.tiles[k].bld; }
  const lamp = Object.keys(nc.BUILDINGS).find((t) => nc.BUILDINGS[t].lightRadius);
  const spots = [];
  for (const k in g.tiles) { const c = k.indexOf(','); spots.push([+k.slice(0, c), +k.slice(c + 1)]); }
  /* One lamp every three tiles over the built area, and a road beside anything
     that has none — the two complaints the board can actually answer. */
  for (const [x, z] of spots) {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, nz = z + dz, kk = nx + ',' + nz;
      if (g.tiles[kk] || nx < 0 || nz < 0 || nx > 23 || nz > 23) continue;
      g.tiles[kk] = { type: (dx === 1 || dx === -1) ? lamp : 'road', lvl: 1 };
      break;
    }
  }
  const cov = g.cov.pct || (g.cov.pct = {});
  for (const n of nc.NEEDS) cov[n] = 1;
  g.power = { gen: 999, demand: 1, ratio: 999, factor: 1, model: g.power.model };
  /* …and the simulated firms are given a clean bill of health, on their OWN
     fields. `lastConstraints` is what bottleneck.diagnose reads; emptying it is
     the model's way of saying "nothing is binding". Every business on this
     board — housing included, which /src/economy founds as a landlord firm —
     otherwise reports workers at 0% forever in a headless run with no
     population, which would leave this whole check unable to reach a content
     face for reasons that have nothing to do with the card. */
  try {
    for (const f of window.MythicEconomy.firms()) {
      f.lastConstraints = []; f.idleForDemand = 0; f.lastNoLeg = false; f.rung = 'HEALTHY';
    }
  } catch (e) {}
  /* ⚡ …AND THE ONE AXIS THIS BOARD CANNOT ANSWER BY BUILDING: THE GRID.
     /src/power's ladder is fed by economyTick's pwPlants/pwLoads and its own
     TRANSMISSION model, so "enough generation" on a headless board with no
     population and no cable is not something a driver can arrange by placing a
     plant — every tile stays shed and the module's `power` term wins on every
     judged tile forever. Rather than fake a factor, this LIFTS THE MODULE OUT
     for the length of this one sweep, which is a state /src/plotmood documents
     as legal and prints in its own header: "Absent is a legal state and means
     this axis is not modelled in this build — never a defect, so an absent
     module can never produce a frown." It is the same technique
     drive-plotverdict uses to prove the exactly-zero contribution of a missing
     source, and it is put back the moment the sweep is over so §5 and §4 run
     against the real page. Without it the CONTENT branch of the face mapping is
     unreachable and the mapping check agrees with anything. */
  window.__pwStash = window.MythicPower || null;
  try { delete window.MythicPower; } catch (e) { window.MythicPower = undefined; }
  try { window.MythicPlotMood.invalidate('driver-relief-full'); } catch (e) {}
  return { lamp, tiles: Object.keys(g.tiles).length, powerLifted: !window.MythicPower };
});
console.log('   ' + JSON.stringify(relief));
await page.waitForTimeout(600);
const sweep3 = await doSweep();
console.log('   judged ' + sweep3.judged + ' tiles · faces: ' + JSON.stringify(sweep3.faces));
console.log('   reasons: ' + JSON.stringify(sweep3.reasons));
ok('MISMATCH COUNT IS 0 on the contented city too', sweep3.mismatches.length === 0,
  'count=' + sweep3.mismatches.length);
if (sweep3.mismatches.length) console.log('   ' + JSON.stringify(sweep3.mismatches.slice(0, 8), null, 1));
/* ── 3d. THE STATE THAT EXPOSED THE BUG ────────────────────────────────────
   ONE building, stranded, in a city with no roads and no lamps ANYWHERE.
   The seeds above all pave a street first, so none of them can reach the
   unbounded-distance arm — and that arm is the whole of defect (a). A fresh
   page, because the sweeps above have already paved and lit this one. */
console.log('\n3d. one stranded building, no roads and no lamps anywhere');
const strandPage = await newPage();
await boot(strandPage, 'index.html');
const strandSeed = await strandPage.evaluate(async () => {
  const nc = window.__nc, g = nc.game, B = nc.BUILDINGS;
  /* tryPlace awaits payCost, which awaits the bridge that is not there on a
     bare page — race it and fall back to a direct tile write, same as the
     seed above. The point of this city is the ABSENCE of roads. */
  const raced = (p) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(false), 1500))]);
  for (const k in g.res) g.res[k] = 99999;
  const home = Object.keys(B).find((t) => {
    const d = B[t];
    return d && !d.decor && !d.opType && !d.edgeOnly && (d.popCap | 0) > 0;
  });
  const k = '19,19';
  if (!g.tiles[k]) { try { await raced(nc.place(home, 19, 19)); } catch (e) {} }
  if (!g.tiles[k]) g.tiles[k] = { type: home, lvl: 1 };
  const roads = Object.keys(g.tiles).filter((kk) => (B[g.tiles[kk].type] || {}).road).length;
  const lamps = Object.keys(g.tiles).filter((kk) => (B[g.tiles[kk].type] || {}).lightRadius).length;
  try { nc.coverage(); } catch (e) {}
  try { window.MythicPlotMood.invalidate('driver-strand'); } catch (e) {}
  return { home, placed: !!g.tiles[k], tiles: Object.keys(g.tiles).length, roads, lamps };
});
console.log('   ' + JSON.stringify(strandSeed));
await strandPage.waitForTimeout(1500);
const sweep4 = await sweepOn(strandPage);
console.log('   judged ' + sweep4.judged + ' tiles · reasons: ' + JSON.stringify(sweep4.reasons));
ok('the stranded seed has no roads and no lamps on the board',
  strandSeed.roads === 0 && strandSeed.lamps === 0,
  'roads=' + strandSeed.roads + ' lamps=' + strandSeed.lamps);
ok('MISMATCH COUNT IS 0 on the stranded city too', sweep4.mismatches.length === 0,
  'count=' + sweep4.mismatches.length);
if (sweep4.mismatches.length) console.log('   ' + JSON.stringify(sweep4.mismatches.slice(0, 8), null, 1));

/* ── 3e. THE TWO "LIMITED BY" COUNTS, OVER EVERY SWEEP ──────────────────── */
console.log('\n3e. the "Limited by" line — both counts must be 0');
const SW = [['seeded', sweep], ['coping', sweep2], ['contented', sweep3], ['stranded', sweep4]];
let limCases = 0, limUnbounded = 0, limNoTerm = 0;
const limZero = [], limNoUnit = [];
for (const [nm, s] of SW) {
  limCases += s.limCases; limUnbounded += s.limUnbounded; limNoTerm += s.limNoTerm;
  for (const r of s.limZero) limZero.push(Object.assign({ sweep: nm }, r));
  for (const r of s.limNoUnit) limNoUnit.push(Object.assign({ sweep: nm }, r));
  console.log('   ' + nm.padEnd(10) + ' lines=' + s.limCases + ' unbounded=' + s.limUnbounded +
    ' zero=' + s.limZero.length + ' no-unit=' + s.limNoUnit.length);
}
ok('COUNT OF (printed "Limited by" figure == 0 while its term reads "no ...") IS 0',
  limZero.length === 0, 'count=' + limZero.length + (limZero.length ? ' ' + JSON.stringify(limZero.slice(0, 6)) : ''));
ok('COUNT OF (printed "Limited by" figure carrying no unit token) IS 0',
  limNoUnit.length === 0, 'count=' + limNoUnit.length + (limNoUnit.length ? ' ' + JSON.stringify(limNoUnit.slice(0, 6)) : ''));
/* ⚠ AND NEITHER COUNT IS VACUOUS. A run that printed no Limited-by line at
   all, or never reached the unbounded arm, would report 0 and 0 and prove
   nothing — which is exactly how this defect survived the last round. */
ok('the run actually printed "Limited by" lines to judge', limCases > 0, 'lines=' + limCases);
ok('the run actually reached the unbounded-distance state (no roads/mains/lamps)',
  limUnbounded > 0, 'unbounded lines=' + limUnbounded);
ok('every printed "Limited by" line matched a term on its own card', limNoTerm === 0,
  'unmatched=' + limNoTerm);
await strandPage.close();

const allFaces = Object.assign({}, sweep.faces, sweep2.faces, sweep3.faces, sweep4.faces);
console.log('   faces seen across all three sweeps: ' + JSON.stringify(allFaces));
/* THE MAPPING IS TOTAL, checked on real data rather than on a hoped-for city.
   Every face must be one of the three words, its glyph must be the one that
   word maps to, and — whenever the headline is the module's OWN term rather
   than a status-badge state — the card's face must be exactly the band mapping
   of the module's face. That is the claim "a happy city" was only ever a proxy
   for, and unlike the proxy it cannot be dodged by a simulation that refuses
   to cheer up. */
const mapping = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const GLYPH = { happy: '😀', meh: '😐', frown: '😟' };
  const BAND = { ok: 'happy', meh: 'meh', bad: 'frown' };
  const bad = [];
  let checked = 0, fromModule = 0;
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k); if (!v) continue;
    checked++;
    if (!GLYPH[v.face]) { bad.push(m.k + ': face "' + v.face + '" is not one of the three'); continue; }
    if (v.glyph !== GLYPH[v.face]) bad.push(m.k + ': glyph ' + v.glyph + ' is not ' + v.face + "'s");
    if (!v.fromPill && v.reason === v.base.reason) {
      fromModule++;
      if (v.face !== BAND[v.base.face])
        bad.push(m.k + ': card face ' + v.face + ' but module band ' + v.base.face);
    }
    if (v.face === 'frown' && !String(v.fix || '').trim()) bad.push(m.k + ': frown with no fix');
  }
  return { checked, fromModule, bad };
});
console.log('   mapping: checked ' + mapping.checked + ' tiles, ' + mapping.fromModule +
            ' of them headlined by the module\'s own term');
ok('the face mapping is total and the glyphs match it', mapping.bad.length === 0,
  'problems=' + mapping.bad.length + (mapping.bad.length ? ' ' + JSON.stringify(mapping.bad.slice(0, 5)) : ''));
/* 🔴 …AND THE CHECK ABOVE IS NOT VACUOUS. `fromModule` counts the tiles whose
   headline was /src/plotmood's OWN term rather than a status-badge state or a
   firm diagnosis — the only tiles on which "card face == band(module face)" is
   an assertion at all. It was 0 for a whole revision, because a landlord firm's
   NO_WORKERS was hijacking the headline on every house, and the mapping check
   passed anyway by never testing anything. Counted rather than hoped for. */
ok('the card was headlined by the module\'s own verdict on at least one tile',
  mapping.fromModule > 0, 'fromModule=' + mapping.fromModule);
/* And a CONTENT face was actually reached. A three-sweep run that only ever saw
   the word "frown" proves one third of a three-way mapping. */
ok('a content face was reached on a city with nothing wrong with it',
  (sweep3.faces.happy | 0) > 0, 'happy=' + (sweep3.faces.happy | 0) +
  ' of ' + sweep3.carded + ' · faces ' + JSON.stringify(sweep3.faces));
if (!(sweep3.faces.happy | 0)) {
  const dump = await page.evaluate(() => window.MythicPlotMood.all().map((m) => {
    const v = window.__nc.plotMoodKey(m.k);
    return { k: m.k, type: m.type, kind: m.kind, base: m.reason, card: v && v.reason,
             num: v && v.valueTxt, pill: v && v.pill };
  }));
  console.log('   per-tile: ' + JSON.stringify(dump, null, 1));
}

/* ⚡ PUT THE GRID BACK. §3c lifted /src/power out to reach a content face; §5
   and §4 are about the real page and must not inherit a stubbed one. Asserted
   rather than assumed — a restore that silently failed would make every check
   below a measurement of a build that does not exist. */
const restored = await page.evaluate(() => {
  if (window.__pwStash) { window.MythicPower = window.__pwStash; delete window.__pwStash; }
  try { window.MythicPlotMood.invalidate('driver-restore'); } catch (e) {}
  return !!(window.MythicPower && window.MythicPower.ready && window.MythicPower.ready());
});
ok('/src/power is back on the page after the §3c lift', restored);
await page.waitForTimeout(400);

/* ── 5. IT REACTS TO PLACEMENT ─────────────────────────────────────────── */
console.log('\n5. the verdict moves when the city moves');
const react = await page.evaluate(() => {
  const nc = window.__nc, PM = window.MythicPlotMood;
  const lamp = Object.keys(nc.BUILDINGS).find((t) => nc.BUILDINGS[t].lightRadius);
  const free = (x, z) => x >= 0 && z >= 0 && x <= 23 && z <= 23 && !nc.game.tiles[x + ',' + z];
  /* ⚠ THE OFFSETS ARE THE MODEL'S OWN, NOT A GUESS.
       road → the FOUR ORTHOGONAL neighbours, because that is literally what
              /src/plotmood's hasRoad() reads.
       dark → the CHEBYSHEV-2 ring, because litKeys() is a Chebyshev-2 lamp
              model — a lamp two tiles diagonally still lights this block.
     The first cut only ever tried the four orthogonals for BOTH, and §3c had
     already filled all four of every tile with the lamps and roads it built. So
     the one check that proves the card is an INSTRUCTION reported "nothing this
     driver can answer: dark" and skipped itself — on a board where four free
     tiles that would have answered it were two steps away. */
  const OFF = { road: [[1, 0], [-1, 0], [0, 1], [0, -1]], dark: [] };
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++)
    if (dx || dz) OFF.dark.push([dx, dz]);
  OFF.dark.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])));

  /* Pick by the ENRICHED verdict, not the module's raw one — the card is what
     told the player what to build, so the card is what has to move. And pick a
     tile the driver can ACTUALLY act on: a candidate with no free ground around
     it is not evidence about the card, and taking the first match regardless is
     how this check came to skip itself. */
  let home = null, before = null, plan = null;
  for (const m of PM.all()) {
    const v = nc.plotMoodKey(m.k);
    if (!v || v.reason !== 'road' && v.reason !== 'dark') continue;
    const type = v.reason === 'road' ? 'road' : lamp;
    if (!type) continue;
    const spot = OFF[v.reason].map(([dx, dz]) => [v.x + dx, v.z + dz]).find(([x, z]) => free(x, z));
    if (!spot) continue;
    home = v; before = v; plan = { type, x: spot[0], z: spot[1] };
    break;
  }
  if (!plan) return { ok: false, why: 'no tile with an answerable complaint and room to answer it' };
  /* Placement goes through the real tryPlace; a refusal falls back to a direct
     write, which the module reads exactly the same way. */
  try { nc.place(plan.type, plan.x, plan.z); } catch (e) {}
  if (!nc.game.tiles[plan.x + ',' + plan.z]) nc.game.tiles[plan.x + ',' + plan.z] = { type: plan.type, lvl: 1 };
  const acted = plan.type + ' at ' + plan.x + ',' + plan.z + ' (for ' + before.reason + ')';
  try { nc.coverage(); } catch (e) {}
  PM.invalidate('driver-place');
  const after = nc.plotMoodKey(home.k);
  return { ok: true, k: home.k, acted,
           before: { reason: before.reason, face: before.face, num: before.valueTxt },
           after: { reason: after.reason, face: after.face, num: after.valueTxt },
           moved: before.reason !== after.reason || before.valueTxt !== after.valueTxt };
});
console.log('   ' + JSON.stringify(react));
/* ⚠ A SKIP IS NOT A PASS. This printed "(skipped: nothing this driver can
   answer: firm:NO_WORKERS)" for a whole revision and the run still ended in ALL
   CHECKS PASSED — the one claim about the card being an INSTRUCTION was quietly
   not being made. It fails now, and the reason it can be made at all is the
   home/biz gate: a house headlined by a landlord firm's staffing has no fix a
   driver — or a player — can carry out. */
ok('placing what the card told the player to build changed the verdict',
  !!(react.ok && react.moved), react.ok ? '' : 'could not act: ' + react.why);

/* ── 4. THE CITIZEN MOOD BREAKDOWN — BEFORE AND AFTER ──────────────────── */
console.log('\n4. the citizen mood breakdown, before this piece and after it');
const MARK = 'What that mood is made of';
const readBreakdown = async (p) => p.evaluate((mark) => {
  const nc = window.__nc;
  /* ⚠ TWO ROUTES TO ONE OBJECT, ON PURPOSE. `__nc.citizenUI` is the seam, and
     `window.MythicCitizenUI` is the same API object under its own name. The
     seam used to LOSE its copy to a boot race (`window.__nc = {…}` is a
     wholesale replace that ran after CTALK_API's attach loop) — this driver is
     what caught it, and node-city now carries the previous object's keys
     forward. The fallback stays because the BASELINE page is served from the
     pre-fix tree and would otherwise report a MISSING mood breakdown that is
     plainly present, which is a false negative on the one non-regression this
     round is required to prove. `via` says which route answered. */
  const C = (nc && nc.citizenUI) || window.MythicCitizenUI || null;
  const via = (nc && nc.citizenUI) ? '__nc.citizenUI' : (C ? 'window.MythicCitizenUI (seam lost it)' : null);
  if (!C) return { ok: false, why: 'no citizen UI seam',
                   nc: !!nc, cits: !!window.MythicCitizens, ui: !!window.MythicCitizenUI };
  const roster = (window.MythicCitizens && window.MythicCitizens.list)
    ? window.MythicCitizens.list() : null;
  let id = null;
  if (roster && roster.length) id = roster[0].id;
  if (!id) { for (let i = 1; i < 400; i++) { if (C.html('c' + i)) { id = 'c' + i; break; } } }
  if (!id) return { ok: false, why: 'no citizen on the roster' };
  const html = C.html(id) || '';
  C.open(id);
  /* #citbox, and textContent rather than innerText: the dialogue animates in,
     and innerText reports nothing for a subtree the layout has not settled yet
     — which is a false negative about markup that is plainly there. */
  const box = document.getElementById('citbox');
  const dom = box ? (box.textContent || '') : '';
  const inDom = dom.indexOf(mark) >= 0;
  C.close();
  /* The two numbers the 0.1 agreement is over, printed rather than trusted. */
  const terms = C.terms(id) || [];
  const sum = terms.reduce((a, t) => a + t.w * t.v, 0) * 100;
  let target = null;
  try { target = window.MythicCitizens ? null : null; } catch (e) {}
  return { ok: true, id, via, inHtml: html.indexOf(mark) >= 0, inDom,
           terms: terms.length, weights: +terms.reduce((a, t) => a + t.w, 0).toFixed(3),
           sum: +sum.toFixed(3) };
}, MARK);

const after = await readBreakdown(page);
let before = { ok: false, why: 'baseline page not available' };
if (baselineCopied) {
  const bp = await newPage();
  await boot(bp, '__pmbase.html');
  before = await readBreakdown(bp);
  await bp.close();
}
console.log('   before: ' + JSON.stringify(before));
console.log('   after:  ' + JSON.stringify(after));
ok('BEFORE this piece the mood breakdown is in the DOM', !!(before.ok && before.inDom));
ok('AFTER this piece the mood breakdown is in the DOM', !!(after.ok && after.inDom));
ok('the five mood terms still weigh exactly 1.00', after.ok && Math.abs(after.weights - 1) < 1e-9,
  'weights=' + after.weights + ' terms=' + after.terms);
/* …and the seam kept the property it was handed. Separate from the check above
   on purpose: the fallback above makes the breakdown readable either way, so
   without this line the boot race would be invisible again the moment it came
   back. The BASELINE page is not asserted on — it is the tree from before the
   carry-forward landed and is expected to lose it sometimes. */
ok('the __nc seam still carries citizenUI on the live page (the boot race is closed)',
  after.ok && after.via === '__nc.citizenUI', 'via=' + (after.via || 'none') +
  ' · baseline via=' + (before.via || 'none'));

console.log('\n' + (fails ? 'FAILURES: ' + fails : 'ALL CHECKS PASSED'));
if (logs.length) console.log('\nconsole tail:\n  ' + logs.slice(-10).join('\n  '));
await page.close();
} finally {
  await browser.close();
  server.close();
  if (baselineCopied) { try { fs.unlinkSync(BASE_DST); } catch (e) {} }
}
process.exit(fails ? 1 : 0);
