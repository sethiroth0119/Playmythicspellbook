/* 📅 ONE WORLD DAY, ONE CLOCK (bug-mty87zhi).

   Reported: the Bunker said "Day 047" at 02:xx, the Camp console "Day 100" at
   the player's local 11:xx, and the website "Day 112" at 10:xx UTC. The
   Bunker's day was a hard-coded literal and its clock a counter from 02:14:32;
   the console used the ACCOUNT's age and the device's local time.

   Pins: gameClock() reproduces the website's reading on the reported instant
   (Day 112, 10:12 UTC), the Camp console prints it, and the Bunker reads the
   parent's gameClock instead of its own mock.

   Run: node _gameclock_smoke.mjs */
import { readFileSync } from 'fs';
import { loadEngine } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const e = loadEngine();
const S = e.sandbox;
ok(typeof S.gameClock === 'function' && e.window.gameClock === S.gameClock, 'gameClock exists and is on window for the bunker');
const g = S.gameClock(Date.parse('2026-09-12T10:12:41Z'));
ok(g.day === 112 && g.dayStr === '112', 'the report instant reads Day 112 (the website said 112)', g.day);
ok(g.hm === '10:12' && g.hms === '10:12:41' && g.tz === 'UTC', 'and 10:12 UTC (the website said 10am UTC)', g.hms);
ok(S.gameClock(Date.parse('2026-05-23T16:00:00Z')).day === 1, 'Day 1 is the initial global reset');
ok(S.gameClock(Date.parse('2026-01-01T00:00:00Z')).day === 1, 'never below Day 1');
const g2 = S.gameClock(Date.parse('2026-09-12T10:12:41Z') + 86400000);
ok(g2.day === 113, 'one real day later is the next day', g2.day);

const bar = String(S._campHudTopBar());
const now = S.gameClock();
ok(bar.includes('chud-day-val">' + now.day + '<'), 'the Camp console prints the world day', (bar.match(/chud-day-val">[^<]*/) || [])[0]);
ok(bar.includes(now.hm + ' UTC'), 'and the UTC time, labelled', (bar.match(/chud-clock">[^<]*/) || [])[0]);

const APP = readFileSync('./public/base/app.jsx', 'utf8');
ok(!/day="DAY 047"/.test(APP), 'the bunker no longer hard-codes DAY 047');
ok(/window\.parent\.gameClock/.test(APP), 'the bunker reads the parent gameClock');
ok(!/h: 2, m: 14, s: 32/.test(APP), 'the mock 02:14:32 counter is gone');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
