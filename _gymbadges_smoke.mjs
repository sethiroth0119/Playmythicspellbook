/* 🏛 bug-mu0lf3vw — "I completed 7 out of 8 of the core trials and as I went to
   complete the 8th they all reset. Not sure if this was a global US timezone
   reset."

   There is no reset rule for Core Trial badges (nothing daily/weekly; the
   admin "Advance Season" clears online gym ownership only). The loss was
   sync: Profile.gymWars never rode the cloud row, so any rebuild of the
   profile from the cloud (account-isolation hydrate, another device, cleared
   storage, a quota-failed local save reloaded over) came back with no badges.

   Pinned here against the REAL _gymWarsMerge lifted from index.html:
     1. the cloud payload carries __gymWars__ and hydration merges it
     2. an EMPTY local copy + the cloud's 7 badges → 7 badges (the report)
     3. a stale cloud copy never removes a local badge; earliest earnedAt wins
     4. lifetime counters take the max; history is a de-duplicated union
     5. a played profile's deliberate supporterOf:null is not overwritten
     6. the UI states badges never reset
     7. NEGATIVE CONTROL: a plain cloud-over-local replace (what a missing key
        amounts to after a from-empty rebuild) loses the badges.

   Run: node _gymbadges_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const i = SRC.indexOf('function _gymWarsMerge(');
const merge = new Function(SRC.slice(i, SRC.indexOf('\n}\n', i) + 3) + '\nreturn _gymWarsMerge;')();

const CORES = ['fire', 'void', 'nature', 'celestial', 'blood', 'machine', 'storm'];
const seven = {}; CORES.forEach((c, n) => { seven[c] = { earnedAt: 1000 + n }; });

console.log('\n=== 1. payload + hydration wiring ===');
ok(/__gymWars__:\s+\(typeof _gymWarsForCloud === 'function'\) \? _gymWarsForCloud\(\) : \{\},/.test(SRC), 'forge payload carries __gymWars__');
ok(/Profile\.gymWars = _gymWarsMerge\(Profile\.gymWars, f\.__gymWars__\)/.test(SRC), 'cloud hydration merges it');

console.log('\n=== 2. empty local + cloud 7 → 7 ===');
{
  const out = merge({ badges: {}, history: [], supporterOf: null, seasonSeen: 1 }, { badges: seven, history: [], supporterOf: 'fire' });
  ok(Object.keys(out.badges).length === 7, '7 badges back', Object.keys(out.badges).length);
  ok(out.supporterOf === 'fire', 'a fresh copy takes the cloud supporterOf');
}
console.log('\n=== 3. stale cloud never removes; earliest wins ===');
{
  const local = { badges: Object.assign({}, seven, { chaos: { earnedAt: 5000 } }) };
  local.badges.fire = { earnedAt: 900 };
  const out = merge(local, { badges: { fire: { earnedAt: 1000 }, void: { earnedAt: 800 } } });
  ok(Object.keys(out.badges).length === 8, 'all 8 kept', Object.keys(out.badges).length);
  ok(out.badges.fire.earnedAt === 900 && out.badges.void.earnedAt === 800, 'earliest earnedAt on each side');
}
console.log('\n=== 4. counters max, history union ===');
{
  const out = merge({ bestPeakStreak: 3, predWins: 2, history: [{ coreId: 'fire', claimedAt: 5 }] },
                    { bestPeakStreak: 7, predWins: 1, history: [{ coreId: 'fire', claimedAt: 5 }, { coreId: 'void', claimedAt: 2 }] });
  ok(out.bestPeakStreak === 7 && out.predWins === 2, 'max of each counter');
  ok(out.history.length === 2 && out.history[0].coreId === 'void', 'history de-duplicated, oldest first');
}
console.log('\n=== 5. deliberate unsupport survives ===');
{ const out = merge({ badges: { fire: { earnedAt: 1 } }, supporterOf: null }, { badges: {}, supporterOf: 'void' }); ok(out.supporterOf === null, 'played profile keeps supporterOf:null'); }
console.log('\n=== 6. the UI says so ===');
ok(/id="gym-badge-permanence"[^>]*>🔒 Badges are permanent and saved to your account — they never reset/.test(SRC), 'Gym Core Wars states badges never reset');
console.log('\n=== 7. NEGATIVE CONTROL ===');
{
  // HEAD control (while HEAD has the old payload): badges never reached the cloud.
  let head = null;
  try { head = (await import('child_process')).execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
  if (!head || /__gymWars__/.test(head)) console.log('  (skipped: HEAD already carries the fix)');
  else ok(!/__gymWars__|gymWars:\s*Profile/.test(head.slice(head.indexOf('const forgeSmall = {'), head.indexOf('const rowRaw = {'))), 'OLD payload has no gymWars at all — a cloud rebuild comes back with 0 badges');
}
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
