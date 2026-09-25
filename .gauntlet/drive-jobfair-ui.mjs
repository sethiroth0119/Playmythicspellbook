/* ══════════════════════════════════════════════════════════════════════════
   📰 DRIVE-JOBFAIR-UI — can a Governor actually read why nobody is hired?

   tools/jobfair-tests/run.mjs proves the ARITHMETIC (the cascade especially).
   This proves the SCREEN: the button, the badge, the classifieds, the ticks,
   and — the point of the whole feature — the shortage notice.

   ⚠ THE ECONOMY SEAM IS STUBBED, THE UI IS NOT. window.MythicEconomy.jobs() is
     replaced with the shape the real seam returns, so every line of bulletin
     and markup code runs for real against realistic figures. Standing up a
     whole simulated city just to get four numbers would make this a test of
     the economy, which already has its own gauntlet.

   ⚠ IT PROVES THE TEST CAN FAIL. A city with plenty of graduates must show NO
     shortage notice. If the notice appeared for both, it would be decoration
     rather than a diagnosis and the run says so.

   Run:  node .gauntlet/drive-jobfair-ui.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
const P = 8480 + (process.pid % 50);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.jobfair)', null, { timeout: 150000 }).catch(() => {});
await pg.waitForTimeout(2500);

/* The starved city: plenty of labourers, almost no graduates. */
const STARVED = {
  market: {
    vacancies: { advanced: 14, technical: 15, skilled: 12, unskilled: 8 },
    employed: { advanced: 3, technical: 10, skilled: 20, unskilled: 24 },
    qualified: { advanced: 1, technical: 6, skilled: 7, unskilled: 30 },
  },
  firms: [
    { id: 11, name: 'Foundation Research Lab', ind: 'scpFoundry', industry: 'Research', ico: '🔬', band: 'advanced', openings: 14, staffed: 3, seats: 17, wage: 1450 },
    { id: 12, name: 'Prince Advanced Manufacturing', ind: 'autoPlant', industry: 'Manufacturing', ico: '🏭', band: 'technical', openings: 15, staffed: 10, seats: 25, wage: 1100 },
    { id: 13, name: 'Steel Works', ind: 'steelMill', industry: 'Heavy Industry', ico: '🏗', band: 'skilled', openings: 12, staffed: 20, seats: 32, wage: 800 },
    { id: 14, name: 'Ethos General Market', ind: 'grocer', industry: 'Retail', ico: '🛒', band: 'unskilled', openings: 8, staffed: 24, seats: 32, wage: 450 },
  ],
};
/* The healthy city: same jobs, a well-schooled population. */
const HEALTHY = {
  market: {
    vacancies: STARVED.market.vacancies, employed: STARVED.market.employed,
    qualified: { advanced: 40, technical: 40, skilled: 40, unskilled: 40 },
  },
  firms: STARVED.firms,
};

const r = await pg.evaluate(async ({ STARVED, HEALTHY }) => {
  const o = {};
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  /* node-city's main script is a MODULE, so nothing in it is on window.
     window.__nc is the file's own diagnostics seam and the only way in. */
  const JF = window.__nc && window.__nc.jobfair;
  o.reachable = !!(JF && JF.open && JF.badge && window.__nc.rail);
  if (!o.reachable) return o;

  window.MythicEconomy = Object.assign(window.MythicEconomy || {}, {
    ready: () => true, jobs: () => window.__jf,
  });

  /* ── A. THE LAUNCHER ──────────────────────────────────────────────────
     📰 IT MOVED. The Job Fair was a card at the top of #leftcol; it is now the
     `hirecard` launcher in the rail, beside ⚡ Utility. So this section reads
     the RAIL button, and the rail's own beat (railSync) is what has to paint
     the badge — asking _jfTickBadge would be testing a function the shipped
     page no longer has a button for. */
  const RAIL = window.__nc.rail;
  const railBtn = () => document.querySelector('[data-rail="hirecard"]');
  const railBadge = () => { const b = railBtn(); const e = b && b.querySelector('.rlbadge'); return e ? e.textContent.trim() : null; };

  window.__jf = STARVED;
  try { JF.bind(); } catch (e) {}
  RAIL.sync();
  const btn = railBtn();
  o.btnVisible = !!btn && btn.style.display !== 'none';
  o.railListed = RAIL.list().indexOf('hirecard');
  o.railAfterUtility = RAIL.list().indexOf('hirecard') === RAIL.list().indexOf('utilcard') + 1;
  o.badgeCount = railBadge();
  o.badgeShown = !!o.badgeCount;

  /* 🔴 THE MEASUREMENT THE RAIL'S OWN HEADER DEMANDS BEFORE A SIXTEENTH BUTTON:
     does the dock spill onto a THIRD row? Grouped by top edge, because a
     clocked button sits 1px high and counting distinct offsetTop calls two
     rows three (that mistake is written up in the RAILS header). */
  {
    const bar = document.getElementById('railbar');
    const tops = [];
    for (const b of bar.querySelectorAll('button.rl')) {
      if (b.style.display === 'none') continue;
      const t = Math.round(b.getBoundingClientRect().top);
      if (!tops.some(x => Math.abs(x - t) <= 6)) tops.push(t);
    }
    o.railRows = tops.length;
    o.railShown = bar.querySelectorAll('button.rl:not([style*="display: none"])').length;
  }

  // a city with nothing open must show no badge at all — but the launcher stays
  window.__jf = { market: STARVED.market, firms: [] };
  RAIL.sync();
  o.badgeHiddenWhenQuiet = !railBadge();
  o.stillVisibleWhenQuiet = (() => { const b = railBtn(); return !!b && b.style.display !== 'none'; })();

  // …and with no employment model at all the launcher must disappear entirely
  window.__jf = null;
  RAIL.sync();
  o.hiddenWithNoSeam = (() => { const b = railBtn(); return !b || b.style.display === 'none'; })();

  // clicking it opens the bulletin, and clicking again shuts it
  window.__jf = STARVED;
  RAIL.sync();
  railBtn().click();
  await sleep(500);
  o.clickOpens = !document.getElementById('jf-ov').hidden;
  railBtn().click();
  await sleep(250);
  o.clickCloses = document.getElementById('jf-ov').hidden;

  // ── B. THE BULLETIN, starved city ─────────────────────────────────────
  window.__jf = STARVED;
  JF.badge();
  await JF.open();
  await sleep(400);
  const ov = document.getElementById('jf-ov'), paper = document.getElementById('jf-paper');
  o.opened = !!ov && !ov.hidden;
  o.ads = paper ? paper.querySelectorAll('.jf-ad').length : 0;
  o.checks = paper ? paper.querySelectorAll('.jf-chk').length : 0;
  o.text = paper ? (paper.textContent || '') : '';
  o.hasMasthead = /Job Fair/i.test(o.text) && /Daily Employment Bulletin/i.test(o.text);
  o.showsEduLevels = /Level 4/.test(o.text) && /Level 1/.test(o.text);
  o.statNums = paper ? Array.from(paper.querySelectorAll('.jf-stat b')).map(e => e.textContent) : [];
  o.problemShown = !!(paper && paper.querySelector('.jf-problem'));
  o.problemText = (paper && paper.querySelector('.jf-problem')) ? paper.querySelector('.jf-problem').textContent.replace(/\s+/g, ' ').trim().slice(0, 190) : null;
  // nothing may be painted outside the sheet
  o.paperScrolls = paper ? getComputedStyle(paper).overflowY : null;

  // ── C. TICKING A BUSINESS PRIORITISES IT ──────────────────────────────
  const cb = paper.querySelector('[data-jf-id="14"]');       // the retail shop
  if (cb) { cb.checked = true; cb.onchange(); }
  document.getElementById('jf-go').click();
  await sleep(250);
  const res = document.getElementById('jf-result');
  o.resultShown = !!res && !res.hidden;
  o.resultText = res ? res.textContent.replace(/\s+/g, ' ').trim().slice(0, 130) : null;
  // reopening keeps the tick
  await JF.open(); await sleep(350);
  const again = document.getElementById('jf-paper').querySelector('[data-jf-id="14"]');
  o.tickPersists = !!(again && again.checked);
  o.pickedFirst = (function () {
    const first = document.getElementById('jf-paper').querySelector('.jf-ad .jf-co-name');
    return first ? first.textContent : null;
  })();

  // ── D. CONTROL — a well-schooled city shows NO shortage notice ────────
  window.__jf = HEALTHY;
  await JF.open(); await sleep(350);
  const p2 = document.getElementById('jf-paper');
  o.healthyProblem = !!p2.querySelector('.jf-problem');
  o.healthyStillLists = p2.querySelectorAll('.jf-ad').length;

  JF.close();
  o.closed = document.getElementById('jf-ov').hidden;
  return o;
}, { STARVED, HEALTHY });

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F4F0} JOB FAIR — THE SCREEN\n');
ok('the Job Fair is wired into the City Builder (else nothing below ran)', r.reachable === true);
if (r.reachable) {
  console.log('  ── the launcher, in the rail beside ⚡ Utility');
  ok('it is visible in the city', r.btnVisible === true);
  ok('\u{1F3AF} it sits DIRECTLY after Utility', r.railAfterUtility === true, 'index ' + r.railListed);
  ok('\u{1F3AF} the badge counts open positions', r.badgeShown === true && r.badgeCount === '49',
     'badge: ' + r.badgeCount + ' (14+15+12+8)');
  ok('\u{1F3AF} …and disappears when nothing is hiring', r.badgeHiddenWhenQuiet === true);
  ok('…while the launcher itself stays', r.stillVisibleWhenQuiet === true);
  ok('\u{1F3AF} CONTROL · no employment model ⇒ no launcher at all', r.hiddenWithNoSeam === true);
  ok('clicking it opens the bulletin', r.clickOpens === true);
  ok('…and clicking it again shuts it', r.clickCloses === true);
  ok('\u{1F3AF} the dock did NOT spill onto a third row', r.railRows <= 2,
     r.railShown + ' launchers over ' + r.railRows + ' row(s)');

  console.log('\n  ── the bulletin');
  ok('the modal opens', r.opened === true);
  ok('it reads as a newspaper', r.hasMasthead === true);
  ok('every hiring business is a classified ad', r.ads === 4, r.ads + ' ads');
  ok('each has a checkbox', r.checks === 4, r.checks + ' boxes');
  ok('the stat strip carries the headline figures', (r.statNums || []).join('/') === '4/49/57/44',
     (r.statNums || []).join(' / '));
  ok('education levels are stated per business', r.showsEduLevels === true);
  ok('a long bulletin scrolls rather than clipping', r.paperScrolls === 'auto', String(r.paperScrolls));

  console.log('\n  ── the point of the feature');
  ok('\u{1F3AF} the shortage notice explains WHY hiring is stuck', r.problemShown === true);
  console.log('     ' + (r.problemText || '(none)'));

  console.log('\n  ── prioritising');
  ok('ticking a business and confirming reports back', r.resultShown === true);
  console.log('     ' + (r.resultText || ''));
  ok('the tick survives a reopen', r.tickPersists === true);
  ok('\u{1F3AF} …and that business is listed first', /Ethos General Market/.test(r.pickedFirst || ''),
     r.pickedFirst || '');

  console.log('\n  ── CONTROL · a well-schooled city');
  ok('\u{1F3AF} shows NO shortage notice (so the notice is a diagnosis, not decoration)',
     r.healthyProblem === false);
  ok('…but still lists the same jobs', r.healthyStillLists === 4, r.healthyStillLists + ' ads');
  ok('the modal closes', r.closed === true);
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
