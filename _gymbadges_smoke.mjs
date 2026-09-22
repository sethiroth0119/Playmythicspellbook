/* 🏛️ CORE TRIAL BADGES SURVIVE A RELOAD (bug-mu0lf3vw).

   Reported: "I completed 7 out of 8 of the core trials and as I went to
   complete the 8th they all reset. Not sure if this was a global US timezone
   reset." There is no timed reset of Gym badges anywhere. Profile.gymWars was
   in NONE of the three persistence whitelists — loadForge()'s field list, the
   forgeSmall cloud upload and the cloud hydration — so saveProfile() wrote the
   badges to localStorage and the next reload (or update) rebuilt Profile
   without them.

   Pins: the local loader restores them (driven through the real loadForge on
   the real engine, baseline measured 7 → 0), the upload carries __gymWars__,
   and the hydration merge can only ADD a badge — a stale cloud copy never
   removes one this device earned.

   Run: node _gymbadges_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
import { loadEngine } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');

/* 1 — the real loader, on the real engine. */
const e = loadEngine();
const S = e.sandbox;
const SEVEN = ['fire', 'void', 'nature', 'celestial', 'blood', 'machine', 'storm'];
SEVEN.forEach((id) => S.awardGymBadge(id));
ok(S.gymBadgeCount() === 7, 'seven Core Trials won', S.gymBadgeCount());
S.saveProfile();
const blob = JSON.parse(e.window.localStorage.getItem('hg_profile') || '{}');
ok(blob.gymWars && Object.keys(blob.gymWars.badges || {}).length === 7, 'saveProfile wrote the badges to localStorage');
S._ensureGymWars().badges = {};             // what a fresh page starts from
S.loadForge();
ok(S.gymBadgeCount() === 7, 'a reload restores all seven badges', S.gymBadgeCount());
ok(S.hasGymBadge('storm') && !S.hasGymBadge('chaos'), 'the same seven — nothing invented');

/* 2 — the cloud upload names the field. */
ok(/__gymWars__:\s*\(Profile\.gymWars && typeof Profile\.gymWars === 'object'\)/.test(SRC), 'forgeSmall uploads __gymWars__');

/* 3 — the hydration merge, lifted verbatim and driven. */
const at = SRC.indexOf('if (f.__gymWars__ && typeof f.__gymWars__');
ok(at > 0, 'cloud hydration reads __gymWars__');
let d = 0, end = -1;
for (let k = SRC.indexOf('{', at); k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) { end = k + 1; break; } } }
const block = SRC.slice(at, end);
function hydrate(local, cloud) {
  const ctx = { Profile: { gymWars: local }, f: { __gymWars__: cloud }, Set, Object, Array, Number, Math, Infinity };
  ctx._ensureGymWars = () => {
    const P = ctx.Profile;
    if (!P.gymWars || typeof P.gymWars !== 'object') P.gymWars = { badges: {}, history: [], supporterOf: null, seasonSeen: 1 };
    if (!P.gymWars.badges || typeof P.gymWars.badges !== 'object') P.gymWars.badges = {};
    if (!Array.isArray(P.gymWars.history)) P.gymWars.history = [];
    return P.gymWars;
  };
  vm.runInNewContext(block, ctx);
  return ctx.Profile.gymWars;
}
// a fresh device takes the cloud's badges
let g = hydrate({ badges: {}, history: [], supporterOf: null, seasonSeen: 1 },
  { badges: { fire: { earnedAt: 100 }, void: { earnedAt: 200 } }, history: [{ coreId: 'fire', claimedAt: 5 }], supporterOf: 'fire', bestPeakStreak: 3 });
ok(Object.keys(g.badges).length === 2, 'empty device adopts the cloud badges', JSON.stringify(g.badges));
ok(g.supporterOf === 'fire' && g.bestPeakStreak === 3 && g.history.length === 1, 'and the rest of the record');
// a stale cloud copy cannot take a badge away
g = hydrate({ badges: { fire: { earnedAt: 100 }, void: { earnedAt: 200 }, storm: { earnedAt: 300 } }, history: [{ coreId: 'fire', claimedAt: 5 }], bestPeakStreak: 9 },
  { badges: { fire: { earnedAt: 100 } }, history: [{ coreId: 'fire', claimedAt: 5 }, { coreId: 'void', claimedAt: 7 }], bestPeakStreak: 2 });
ok(Object.keys(g.badges).length === 3, 'a stale cloud copy removes nothing', JSON.stringify(g.badges));
ok(g.history.length === 2, 'history is a union, no duplicates', g.history.length);
ok(g.bestPeakStreak === 9, 'lifetime best keeps the max', g.bestPeakStreak);
// earliest earnedAt wins
g = hydrate({ badges: { fire: { earnedAt: 500 } }, history: [] }, { badges: { fire: { earnedAt: 100 }, chaos: { earnedAt: 50 } } });
ok(g.badges.fire.earnedAt === 100 && g.badges.chaos, 'badges union, earliest earnedAt wins');

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
