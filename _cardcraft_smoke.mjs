/* ❌ CARD CRAFTING IS REMOVED — all of it, and it has to stay removed.

   "I said I wanted crafting for cards to be removed. Remove all card forge."

   Earlier rounds turned crafting into a locked switch and then into a rule;
   this one deletes the machinery. The ⚒ Card Forge overlay, the bunker's
   FRG-01 room, craftCard / disenchantCard / canCraft, the craft-cost tables,
   the catalog lock and the Inventory's 🔨 / ♻ pills are gone. This file
   asserts their ABSENCE on the shipped page text, and drives the two things
   that replaced them: stranded Card Forge workers are released so their card
   copies come back to decks, and the Inventory shows each unit's LEVEL.

   Run: node _cardcraft_smoke.mjs */
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
const defined = (name) => SRC.indexOf('function ' + name + '(') >= 0;

console.log('\n=== 1. the crafting machinery is gone from the page ===');
for (const f of ['craftCard', 'disenchantCard', 'canCraft', 'cardCraftLocked', 'cardCraftLockMessage', 'setCardCraftLock',
                 'getCardCraftCost', 'getCardCraftRefund', 'openForgeCraftModal', '_campForgeArtificer', '_campForgeDiscount',
                 'getCraftCost', 'getDisenchantRefund']) {
  ok(!defined(f), f + '() no longer exists');
}
ok(SRC.indexOf('const _CRAFT_DEFAULT_BY_RARITY') < 0 && SRC.indexOf('const CRAFT_COST_BY_RARITY') < 0, 'no craft-cost table is defined');
ok(SRC.indexOf('__card_craft_lock__') < 0 && SRC.indexOf('CARD_CRAFT_LOCKED_DEFAULT') < 0, 'the catalog craft lock is gone (nothing to switch)');
ok(SRC.indexOf('__mg.setCardCraftLock') < 0, 'the console switch is gone');
ok(SRC.indexOf("data-act=\"craft\"") < 0 && SRC.indexOf("data-act=\"disenchant\"") < 0, 'the Inventory rows draw no 🔨 Craft or ♻ Scrap button');
ok(SRC.indexOf('⚒ Open Card Forge') < 0 && SRC.indexOf('⚒ Card Forge</div>') < 0, 'the Card Forge overlay and its door are gone');
ok(!/\{ id: 'FRG-01', name: 'Card Forge'/.test(SRC), 'the bunker no longer lists a Card Forge room');
ok(SRC.indexOf('data-craftcost=') < 0 && SRC.indexOf("const craftCostBlock = ''") >= 0, 'the admin editor no longer offers a card craft cost');
ok(/d\.action === 'craft'\) \{ try \{ showToast\('Card crafting has been removed/.test(SRC), 'a bunker room still posting "craft" gets a plain sentence, not a dead door');
/* item crafting is a DIFFERENT system and must survive */
ok(defined('canCraftRecipe'), 'item crafting (canCraftRecipe) is untouched');
ok(SRC.indexOf('data-it-craftcost=') >= 0, '…and the item editor still has its own cost fields');
ok(SRC.indexOf('_CRAFT_DEFAULT_BY_RARITY') < 0, 'nothing on the page still names the deleted card table (the item editor used to)');

console.log('\n=== 2. a worker stranded in the Card Forge is released ===');
{
  const saved = [];
  const Camp = { workers: [
    { id: 'w1', kind: 'unit', refId: 'u_smith', station: 'FRG-01' },
    { id: 'w2', kind: 'unit', refId: 'u_med',   station: 'MED-01' },
    { id: 'w3', kind: 'npc',  station: 'AIL-01' },
  ] };
  const env = { Camp, CAMP_STAFF_ROOMS: [{ id: 'MED-01' }, { id: 'AIL-01' }], saveCamp: () => saved.push(1) };
  const F = new Function(...Object.keys(env), fnText('_campWorkers') + '\nreturn { _campWorkers };')(...Object.values(env));
  const ws = F._campWorkers();
  ok(ws.length === 2 && !ws.some(w => w.station === 'FRG-01'), 'the FRG-01 worker is dropped, the others stay');
  ok(saved.length === 1, 'and the camp is saved once');
  F._campWorkers();
  ok(saved.length === 1, 'a second read changes nothing');
  ok(fnText('_campStationReserved').indexOf('_campWorkers()') >= 0, 'so the reserved-copy count reads the cleaned list and the card returns to decks');
}

console.log('\n=== 3. the Inventory shows each unit\'s level ===');
{
  const Profile = { units: { u1: { level: 7, xp: 30 }, u2: { level: 1, xp: 0 } }, heroes: { h1: { level: 12, xp: 5 } } };
  const env = { Profile, xpForLevel: (l) => 100 + 10 * l };
  const F = new Function(...Object.keys(env), fnText('cardLevelOf') + '\n' + fnText('cardLevelBadge') + '\nreturn { cardLevelOf, cardLevelBadge };')(...Object.values(env));
  ok(F.cardLevelOf({ id: 'u1' }, 'unit') === 7 && F.cardLevelOf({ id: 'h1' }, 'hero') === 12, 'the level comes from the player\'s own unit / hero record');
  ok(F.cardLevelOf({ id: 'u9' }, 'unit') === null, 'a unit with no record reads null');
  ok(/Lv 7/.test(F.cardLevelBadge({ id: 'u1' }, 'unit', 3)), 'an owned, fought unit wears Lv 7');
  ok(/Lv 1/.test(F.cardLevelBadge({ id: 'u9' }, 'unit', 2)), 'an owned unit with no record yet is Lv 1');
  ok(F.cardLevelBadge({ id: 'u9' }, 'unit', 0) === '', 'a unit you do not own has no level — it is your copy that levels');
  ok(F.cardLevelBadge({ id: 's1' }, 'spell', 4) === '', 'spells do not level');
  ok(/30 \/ 170 XP/.test(F.cardLevelBadge({ id: 'u1' }, 'unit', 1, { xp: true })), 'the detail view adds XP to next level (30 / 170)');
  ok(/\$\{lvlBadge\}/.test(SRC) && /cardLevelBadge\(c, kind, ownedCount, \{ xp: true \}\)/.test(SRC), 'both the table row and the detail modal draw it');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
