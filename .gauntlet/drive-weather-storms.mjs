/* ══════════════════════════════════════════════════════════════════════════
   ⛈ DRIVE-WEATHER-STORMS — "storms are still landing back to back"

   Two separate complaints wearing one name, and the previous retune only
   answered the first:
     RATE      — how often a storm happens.  (retuned before: ~1 per 12.9 days)
     CLUSTERING — whether two can land on consecutive days. (untouched)
   An event at 1-in-13 days average can still fire twice in a row, and that is
   the one a player notices and reports. The ask: 5% of days, never inside three
   days of the last one, and being eligible must not mean it happens.

   ⚠ IT DRIVES THE SHIPPED ROLL, NOT A COPY OF IT. __nc.wxRoll() steps the real
     weatherTick dice at the real WX_ROLL_EVERY cadence against the real
     WX_CHANCES table. A test that re-implemented the probability arithmetic
     would be a test of the re-implementation — and this is a file whose own
     header warns that its per-day figures go stale when the constants move.

   ⚠ 5% IS PER DAY AND THE TEST SAYS WHICH. Eight rolls fit in a city day, so
     5%-per-roll and 5%-per-day differ by a factor of seven in the observed
     rate. The run asserts the PER-DAY figure, because that is what was asked
     for and what a player experiences.

   ⚠ A LONG RUN, NOT A LUCKY ONE. Storm rate is asserted over 4,000 simulated
     city days with a margin, not over a handful where any answer is plausible.

   Run:  node .gauntlet/drive-weather-storms.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain' };
/* ⚠ A RANDOM PORT, NOT A pid-DERIVED ONE. pid%40 collided with a server left
   behind by an earlier killed run and the driver died on EADDRINUSE before it
   measured anything — a red run that says nothing about the code. */
const P = 9100 + Math.floor(Math.random() * 700);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.wxSim)', null, { timeout: 200000 });
await pg.waitForTimeout(2000);

const r = await pg.evaluate(() => window.__nc.wxSim(600));

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const pct = (x) => (x * 100).toFixed(2) + '%';

console.log('\n\u{26C8} STORMS — 5% OF ELIGIBLE DAYS, NEVER INSIDE THREE\n');
console.log('  simulated ' + r.days.toLocaleString() + ' city days · ' +
            r.rolls.toLocaleString() + ' rolls (' + r.rollsPerDay + ' per day)\n');

console.log('  ── the constants are what was asked for');
ok('the storm chance is 5% per day', r.dayChance === 0.05, pct(r.dayChance));
ok('the lockout is 3 days', r.minDays === 3, r.minDays + ' days');

console.log('\n  ── the gap · the complaint that was actually filed');
ok('\u{1F3AF} NO two storms ever landed inside 3 days of each other',
  r.minGapSeen >= 3, 'closest pair: ' + r.minGapSeen.toFixed(2) + ' days apart');
ok('\u{1F3AF} …and none landed on the same day as another severe front',
  r.severeMinGapSeen >= 1, 'closest severe pair: ' + r.severeMinGapSeen.toFixed(2) + ' days');

console.log('\n  ── the rate · 5% of ELIGIBLE days, per day not per roll');
ok('\u{1F3AF} storms fire on ~5% of the days they are allowed to',
  Math.abs(r.eligibleHitRate - 0.05) < 0.012,
  pct(r.eligibleHitRate) + ' of eligible days (target 5%, ±1.2 points)');
ok('\u{1F3AF} CONTROL · eligibility is NOT a guarantee — most eligible days stay clear',
  r.eligibleHitRate < 0.25, pct(1 - r.eligibleHitRate) + ' of eligible days had no storm');
ok('storms are rarer overall than before the change', r.avgGap > 13,
  'one storm every ' + r.avgGap.toFixed(1) + ' days (was ~12.9 with no lockout)');

console.log('\n  ── CONTROL · the rest of the weather is untouched');
/* ⚠ RAIN IS STILL PER-ROLL AND THAT IS DELIBERATE. Only the four SEVERE fronts
   moved to real days. Rain, snow and cloudy are production-cycle weather and are
   MEANT to be common — they carry multipliers, not damage. The target here was
   originally 0.163/day, which was 0.022/roll × 8 rolls per PRODUCTION cycle; in
   real-day units the same untouched rate is ~12.7, and asserting the old number
   was asserting a unit conversion rather than a behaviour. What must be true is
   that this pass did not touch it. */
ok('rain is untouched — still the per-roll rate it always was',
  r.rainPerDay > 8 && r.rainPerDay < 18,
  r.rainPerDay.toFixed(2) + ' rain rolls per real day (0.022/roll × 576 = 12.7 expected)');
ok('cloudy is still the common filler', r.cloudyPerDay > r.rainPerDay,
  r.cloudyPerDay.toFixed(3) + ' cloudy/day');
ok('\u{1F3AF} a blocked storm does NOT become a clear day — the mass moves down the table',
  r.blockedRolls > 0 && r.frontsOnBlockedRolls > 0,
  r.blockedRolls.toLocaleString() + ' rolls happened inside a lockout, ' +
  r.frontsOnBlockedRolls.toLocaleString() + ' of them still produced some front');

console.log('\n  ── the lockout survives a reload, which is the whole point');
ok('\u{1F3AF} the stamps are written to the save', r.savedStorm != null && r.savedSevere != null,
  'wxLastStorm=' + r.savedStorm + ' wxLastSevere=' + r.savedSevere);
ok('\u{1F3AF} …and are read back, so a refresh cannot clear the cooldown',
  r.reloadKeptLockout === true,
  'after a simulated reload the storm was still ' + r.reloadDaysLeft.toFixed(2) + ' days from eligible');
ok('CONTROL · a save with no stamps loads as eligible, not blocked',
  r.legacyEligible === true, 'a pre-existing city is not retro-locked');
ok('CONTROL · a corrupt future stamp cannot lock the weather out forever',
  r.futureStampEligible === true);

console.log('\n  ── the calendar day · a full 24 real hours, anchored to a saved stamp');
ok('the day you found a city is Day 1', r.dayAtFounding === 1, 'day ' + r.dayAtFounding);
ok('\u{1F3AF} it does NOT tick over early — 23h59m in is still Day 1',
  r.dayJustBeforeMidnight === 1, 'day ' + r.dayJustBeforeMidnight);
ok('\u{1F3AF} …and a full 24 hours later it is Day 2', r.dayJustAfter === 2, 'day ' + r.dayJustAfter);
ok('six and a half days in reads Day 7', r.daySixAndAHalf === 7,
  'day ' + r.daySixAndAHalf + ', ' + Math.round(r.fracAtSixAndAHalf * 100) + '% through it');
ok('\u{1F3AF} a RELOAD keeps the day — the whole point of the request',
  r.dayAfterReload === r.daySixAndAHalf,
  'day ' + r.dayAfterReload + ' after reload vs ' + r.daySixAndAHalf + ' before');
ok('\u{1F3AF} CONTROL · a city with NO anchor starts at Day 1, not day 20,000',
  r.dayAfterWipe === 1, 'day ' + r.dayAfterWipe);
ok('the anchor is written to the save', r.serialisesFounded != null,
  'foundedAt=' + r.serialisesFounded);

console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
