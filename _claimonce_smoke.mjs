/* 🔁 A REWARD IS CLAIMED ONCE (bug-mu9clqwc).

   Reported: "Season Pass — you can keep claiming the daily and weekly task
   and be rewarded for it multiple times in xp etc."

   claimMission's guard was always correct. The flag it reads was not
   persisted: Profile.missions and Profile.seasonPass were written by
   saveProfile() but were on neither the local-load whitelist nor the cloud
   row, so every reload handed back empty claimed maps and re-rolled the same
   seeded mission set. This drives the REAL engine headless: claim, save,
   "reload" (wipe + loadForge), and try again; then hydrate an older cloud
   copy over a fresh claim and make sure it cannot re-open it.

   Run: node _claimonce_smoke.mjs */
import { loadEngine, EXPORTS } from './tools/gamedev/headless.mjs';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
EXPORTS.push('loadForge', 'saveProfile', 'claimMission', '_missionsResetIfNeeded', '_ensureMissions',
  '_ensureSeasonPass', 'claimSeasonReward', 'addSeasonXp', '_missionsMerge', '_seasonPassMerge',
  'SEASON_XP_PER_TIER');
const e = loadEngine();
const P = e.Profile;
const reload = () => {
  e.saveProfile();
  // The blank initialiser is what a reload hands back for anything the
  // whitelist does not name.
  P.missions = { daily: [], weekly: [], dailyRolledAt: 0, weeklyRolledAt: 0, claimedDaily: {}, claimedWeekly: {} };
  P.seasonPass = null;
  e.loadForge();
};

console.log('— missions survive a reload');
e._missionsResetIfNeeded();
let m = e._ensureMissions();
const d0 = m.daily[0], w0 = m.weekly[0];
d0.completed = true; d0.progress = 99; w0.completed = true; w0.progress = 99;
ok(e.claimMission(d0.id, 'daily').ok, 'first daily claim pays');
ok(e.claimMission(w0.id, 'weekly').ok, 'first weekly claim pays');
ok(!e.claimMission(d0.id, 'daily').ok, 'second daily claim refused (same session)');
reload();
e._missionsResetIfNeeded();
m = e._ensureMissions();
ok(!!m.claimedDaily[d0.id], 'claimedDaily survives reload', JSON.stringify(m.claimedDaily));
ok(!!m.claimedWeekly[w0.id], 'claimedWeekly survives reload', JSON.stringify(m.claimedWeekly));
const slot = m.daily.find(s => s.id === d0.id); if (slot) slot.completed = true;
const r2 = e.claimMission(d0.id, 'daily');
ok(!r2.ok && r2.error === 'already claimed', 'daily claim after reload refused', JSON.stringify(r2));
const r3 = e.claimMission(w0.id, 'weekly');
ok(!r3.ok, 'weekly claim after reload refused', JSON.stringify(r3));

console.log('— an older cloud copy cannot re-open a claim');
const stale = JSON.parse(JSON.stringify(m));
stale.claimedDaily = {}; stale.claimedWeekly = {};
P.missions = e._missionsMerge(P.missions, stale);
ok(!e.claimMission(d0.id, 'daily').ok, 'daily still refused after merging a stale cloud copy');
ok(!e.claimMission(w0.id, 'weekly').ok, 'weekly still refused after merging a stale cloud copy');
const prev = JSON.parse(JSON.stringify(P.missions));
prev.dailyRolledAt = 1000; prev.claimedDaily = {};     // yesterday's set
const mm = e._missionsMerge(P.missions, prev);
ok(!!mm.claimedDaily[d0.id], 'a previous-period cloud set loses to the current one');
const fresh = { daily: [], weekly: [], dailyRolledAt: 0, weeklyRolledAt: 0, claimedDaily: {}, claimedWeekly: {} };
const mf = e._missionsMerge(fresh, P.missions);
ok(!!mf.claimedDaily[d0.id] && !!mf.claimedWeekly[w0.id], 'a blank device adopts the cloud claims');

console.log('— season pass tiers survive a reload');
const sp = e._ensureSeasonPass();
e.addSeasonXp(e.SEASON_XP_PER_TIER * 2 + 1, 'test');
ok(sp.tier >= 2, 'reached tier 2', sp.tier);
ok(e.claimSeasonReward(1, 'free').ok, 'tier 1 free claim pays');
reload();
const sp2 = e._ensureSeasonPass();
ok(sp2.tier >= 2 && !!sp2.claimedFreeTiers['1'], 'tier and claim survive reload', JSON.stringify(sp2));
ok(!e.claimSeasonReward(1, 'free').ok, 'tier 1 free claim refused after reload');
const staleSp = Object.assign({}, sp2, { xp: 0, tier: 0, claimedFreeTiers: {}, seasonStartedAt: sp2.seasonStartedAt + 5000 });
const ms = e._seasonPassMerge(sp2, staleSp);
ok(ms.tier === sp2.tier && ms.claimedFreeTiers['1'] && ms.seasonStartedAt === sp2.seasonStartedAt, 'stale cloud pass merges without losing tier/claim/start');
ok(e._seasonPassMerge(sp2, Object.assign({}, sp2, { seasonNumber: (sp2.seasonNumber | 0) + 1, xp: 0, tier: 0, claimedFreeTiers: {} })).tier === 0,
  'a later season from the cloud supersedes');

console.log(fails ? `\n${fails} FAIL, ${passes} pass` : `\nall ${passes} pass`);
process.exit(fails ? 1 : 0);
