/* 🔒 ADMIN-GRANT-ONLY CARDS ARE NOT REACHABLE BY PLAYERS.

   "Cards with the admin-grant only button cannot be accessed by the players by
   any means — their units cannot bring them back on missions or anything.
   Admin grant only cards are not released yet."

   WHY THIS IS EASY TO GET WRONG. `adminOnly` was enforced in two predicates
   consulted at FOUR call sites, while index.html increments
   Profile.cardCollection at THIRTY-NINE places. A flag checked in four places
   out of thirty-nine is a suggestion, not a lock. grantCard() is the door that
   asks; this file proves it asks, and COUNTS the raw writes that still bypass
   it so the number cannot quietly grow.

   Run: node _adminonly_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const NAMES = ['_ensureForgeObt', '_obtKey', 'getForgeObt', 'isForgeAdminOnly', 'isForgeCraftable', 'isForgeLootable',
               'grantCard', 'playerObtainablePool'];
const Profile = { cardCollection: {} };
const Forge = { obtainability: {
  'card:secret': { craftable: true, lootable: true, adminOnly: true },   // the trap: craftable AND admin-only
  'card:public': { craftable: true, lootable: true, adminOnly: false },
} };
const api = new Function('Profile', 'Forge', 'FORGE_OBT_DEFAULT', 'saveForge', 'console',
  NAMES.map(fnText).join('\n') + '\nreturn {' + NAMES.join(',') + '};'
)(Profile, Forge, { craftable: true, lootable: true, adminOnly: false }, () => {}, { info() {}, warn() {} });

const { grantCard, playerObtainablePool, isForgeAdminOnly, isForgeCraftable, isForgeLootable } = api;

console.log('\n=== 0. the flag reads ===');
ok(isForgeAdminOnly('card', 'secret') === true, 'the admin-only card is flagged');
ok(isForgeAdminOnly('card', 'public') === false, 'the public card is not');
ok(isForgeCraftable('card', 'secret') === false, 'admin-only overrides craftable');
ok(isForgeLootable('card', 'secret') === false, 'admin-only overrides lootable');

console.log('\n=== 1. THE DOOR REFUSES ===');
Profile.cardCollection = {};
ok(grantCard('secret', 1, { source: 'test' }) === 0, 'grantCard refuses an admin-only card');
ok(!Profile.cardCollection.secret, '…and nothing lands in the collection', JSON.stringify(Profile.cardCollection));
ok(grantCard('public', 1, { source: 'test' }) === 1, 'a normal card still grants');
ok(Profile.cardCollection.public === 1, '…and really lands');

console.log('\n=== 2. it returns WHAT HAPPENED, so a drop cannot lie ===');
ok(grantCard('secret', 3) === 0, 'a refused grant returns 0, not undefined');
ok(grantCard('public', 3) === 3, 'a granted stack returns the count');
ok(Profile.cardCollection.public === 4, '…and stacks');

console.log('\n=== 3. the ADMIN path still works — that is what the flag means ===');
Profile.cardCollection = {};
ok(grantCard('secret', 1, { adminGrant: true }) === 1, 'an explicit admin grant is allowed');
ok(Profile.cardCollection.secret === 1, '…and lands');
ok(grantCard('secret', 1, { source: 'loot' }) === 0, '…but a loot path still cannot, on the same card');

console.log('\n=== 4. random pools cannot even OFFER it ===');
const pool = [{ id: 'public', name: 'Public' }, { id: 'secret', name: 'Secret' }];
const filtered = playerObtainablePool(pool);
ok(filtered.length === 1 && filtered[0].id === 'public', 'playerObtainablePool drops the admin-only card', JSON.stringify(filtered.map(c => c.id)));
ok(playerObtainablePool([]).length === 0, 'an empty pool stays empty rather than throwing');

console.log('\n=== 5. a bad flag is not a free card ===');
/* If the obtainability store is unreadable, the safe answer is REFUSE. */
const broken = new Function('Profile', 'Forge', 'FORGE_OBT_DEFAULT', 'saveForge', 'console',
  NAMES.map(fnText).join('\n') + '\nreturn grantCard;'
)(Profile, { get obtainability() { throw new Error('boom'); } }, { craftable: true, lootable: true, adminOnly: false }, () => {}, { info() {}, warn() {} });
ok(broken('anything', 1, { source: 'loot' }) === 0, 'an unreadable flag refuses rather than granting');

console.log('\n=== 6. THE BYPASS COUNT — raw writes that skip the door ===');
/* grantCard only protects the paths that call it. This counts the ones that
   still write Profile.cardCollection directly, so the number is visible and
   cannot grow without somebody noticing. Lower it by converting a path; never
   raise it. */
const RAW_WRITE_BASELINE = 35;
const raws = [...SRC.matchAll(/Profile\.cardCollection\[[^\]]+\]\s*=\s*[^;]*?\+\s*(?:1|qty|n)\b/g)].length;
ok(raws <= RAW_WRITE_BASELINE,
   'raw cardCollection writes are at or below the baseline (' + RAW_WRITE_BASELINE + ')',
   raws + ' raw writes — a NEW one was added; route it through grantCard()');
if (raws < RAW_WRITE_BASELINE) console.log('        🎉 ' + raws + ' now — lower RAW_WRITE_BASELINE to ' + raws + ' in this commit.');

console.log('\n=== 7. the paths the report named go through the door ===');
for (const [label, needle] of [
  ['battle reward',    "grantCard(rewards.cardId"],
  ['encounter drop',   "grantCard(enc.cardDrop.id"],
  ['mission recovery', "source: 'mission recovery'"],
  ['random pools',     "playerObtainablePool"],
]) ok(SRC.includes(needle), label + ' is routed through grantCard/playerObtainablePool');

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
