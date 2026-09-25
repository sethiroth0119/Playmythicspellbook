/* 🕒 bug-mty87zhi — "There are two main clocks in the camp. One shows Day 047
   and 'local time' 2am; the other Day 100 and MY local time 11am. The website
   shows Day 112 and UTC 10am."

   The three clocks:
     • public/base (Bunker HUD): hard-coded "DAY 047", fake clock from 02:14:32
     • index.html _campHudTopBar: days since ACCOUNT creation + LOCAL time
     • mythicspellbook.xyz (app.js, not in this repo): SOCIETY_EPOCH =
       Date.UTC(2026, 4, 24); day = floor((now - epoch)/86400000) + 1; UTC clock
   Single source of truth chosen: the website's world calendar (shared by every
   player, already public). Pinned here:
     1. mythicWorldDay/mythicWorldClockUTC lifted from index.html agree with the
        website rule at sample instants, including both sides of 00:00 UTC
     2. the camp bar uses them (and labels the time UTC)
     3. the Bunker HUD uses the same epoch/UTC and no longer hard-codes DAY 047
     4. NEGATIVE CONTROL: the old account-age rule disagrees with the site for
        an account created after the epoch — the report's Day 100 vs Day 112.

   Run: node _worldclock_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const BASE_APP = readFileSync('./public/base/app.jsx', 'utf8');
const BASE_HUD = readFileSync('./public/base/hud.jsx', 'utf8');

// the website's rule, verbatim in meaning
const SITE_EPOCH = Date.UTC(2026, 4, 24);
const siteDay = (now) => Math.max(1, Math.floor((now - SITE_EPOCH) / 86400000) + 1);
const pad = (n) => String(n).padStart(2, '0');
const siteClock = (now) => { const d = new Date(now); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };

const i = SRC.indexOf('const MYTHIC_WORLD_EPOCH');
const j = SRC.indexOf('function mythicWorldClockUTC(');
const k = SRC.indexOf('\n}\n', j);
const lib = new Function(SRC.slice(i, k + 3) + '\nreturn { mythicWorldDay, mythicWorldClockUTC };')();

console.log('\n=== 1. index.html agrees with the website ===');
for (const iso of ['2026-05-24T00:00:00Z', '2026-09-16T23:59:59Z', '2026-09-17T00:00:00Z', '2026-09-17T10:05:00Z', '2027-01-01T12:00:00Z']) {
  const t = Date.parse(iso);
  ok(lib.mythicWorldDay(t) === siteDay(t) && lib.mythicWorldClockUTC(t) === siteClock(t), iso + ' → Day ' + lib.mythicWorldDay(t) + ' ' + lib.mythicWorldClockUTC(t) + ' UTC');
}

console.log('\n=== 2. the camp bar reads it ===');
{
  const f = SRC.slice(SRC.indexOf('function _campHudTopBar()'), SRC.indexOf('function _campHudTopBar()') + 6000);
  ok(/const day = \(typeof mythicWorldDay === 'function'\) \? mythicWorldDay\(\) : 1;/.test(f), 'day = mythicWorldDay()');
  ok(/mythicWorldClockUTC\(\) \+ ' UTC'/.test(f), "clock = mythicWorldClockUTC() + ' UTC'");
  ok(!/d\.getHours\(\)/.test(f.slice(0, f.indexOf('const items'))), 'no local getHours() left in the bar');
}

console.log('\n=== 3. the Bunker HUD reads the same calendar ===');
{
  ok(/Date\.UTC\(2026, 4, 24\)/.test(BASE_APP), 'base/app.jsx carries the same epoch');
  ok(/getUTCHours\(\)/.test(BASE_APP) && !/h: 2, m: 14, s: 32/.test(BASE_APP), 'real UTC clock, not the 02:14:32 fake');
  ok(!/day="DAY 047"/.test(BASE_APP) && !/"DAY 047"/.test(BASE_HUD), 'no hard-coded DAY 047');
  ok(/World Time/.test(BASE_HUD) && !/>Local Time</.test(BASE_HUD), 'labelled World Time (UTC), not Local Time');
}

console.log('\n=== 4. NEGATIVE CONTROL: the old account-age rule ===');
{
  const now = Date.parse('2026-09-13T10:00:00Z');
  const createdAt = Date.parse('2026-06-06T09:00:00Z');
  const oldDay = Math.floor((now - createdAt) / 86400000) + 1;
  ok(oldDay !== siteDay(now), 'account-age Day ' + oldDay + ' vs world Day ' + siteDay(now) + ' — they disagree, as reported');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
