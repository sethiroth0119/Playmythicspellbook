/* 🔒🗓👕 v121v122 — a card can be held back until a date and no player can
   obtain it by any route; sets carry a release instant and put their pack on
   the vendor's shelf by themselves; the Player Closet lands from its branch.
   Run: node _release_smoke.mjs */
import { readFileSync, existsSync, statSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the gate ── */
ok(/function cardReleaseAt\(id\) \{/.test(SRC) && /function isCardReleased\(id\) \{ const at = cardReleaseAt\(id\); return !at \|\| Date\.now\(\) >= at; \}/.test(SRC), 'a card\'s release instant, and the question asked of it');
/* ⚠ THESE TWO WERE REGEX MATCHES ON grantCard's AND playerObtainablePool's
   INLINE WORDING, and they broke the moment v121v169 moved both rules into the
   shared cardGrantRefusalReason predicate — while the behaviour they protect was
   not only intact but enforced in one more place than before. A check pinned to
   the TEXT of a rule fails on a refactor and passes on a re-implementation,
   which is the wrong way round. They are asserted by RUNNING the predicate in
   §4 now; see the two checks added there. */
/* Matches the CALL, not its argument list: grantCard now forwards its options
   (`cardGrantRefusalReason(id, o)`) so the serialized press can present a
   server-issued number, and pinning the old one-argument shape failed on that
   while the door itself never moved. */
ok(/cardGrantRefusalReason\(id[,)]/.test(SRC), 'grantCard — the one door a card enters a collection through — asks the shared refusal predicate');
ok(/cardGrantRefusalReason\(cid\) === null/.test(SRC), 'every "pick a random card" pool asks the same predicate, so the two cannot drift');
ok(/\.filter\(c => \{ try \{ return \(typeof isCardReleased === 'function'\) \? isCardReleased\(c\.id\) : true; \} catch \(e\) \{ return true; \} \}\);/.test(SRC), '…including the shared pack / body-loot / dilemma pool, which consulted nothing before');
ok(/const _held = !!\(p && p\.unreleased\) \|\| \(_rAt && Date\.now\(\) < _rAt\);/.test(SRC) && /🔒 UNRELEASED/.test(SRC) && /🔓 RELEASED/.test(SRC), 'the card row carries the pill, and says which state it is in');
ok(/data-obt-key="unreleased"/.test(SRC) && /key === 'unreleased' \? \(!cur\[key\] \? '🔒 Not released yet/.test(SRC), 'the pill is wired to the same toggle the other three use');

/* ── 2. sets ── */
ok(/function renderForgeSets\(\)/.test(SRC) && /\{ id: 'sets',       label: '🗓 Sets',     count: \(Forge\.cardSets \|\| \[\]\)\.length \},/.test(SRC) && /else if \(App\.forgeTab === 'sets'\) body = renderForgeSets\(\);/.test(SRC), 'the Forge has a Sets tab');
ok(/function _newCardSet\(\)/.test(SRC) && /releaseAt: at\.getTime\(\), cardIds: \[\], packId: '', notes: ''/.test(SRC), 'a set is a name, a date, its cards and the pack that carries it');
ok(/function _dtLocalValue\(ms\)/.test(SRC) && /type="datetime-local"/.test(SRC), 'the date is picked in local time and stored as a real instant');
ok(/data-set-act="now"/.test(SRC) && /🚀 Release now/.test(SRC), 'a scheduled set can be released early by hand');
ok(/function packReleaseAt\(p\)/.test(SRC) && /\.filter\(d => \{ try \{ return isPackReleased\(d\); \} catch \(e\) \{ return true; \} \}\);/.test(SRC), 'the vendor does not stock a pack whose set has not arrived');
ok(/__card_sets__:         \(Forge\.cardSets \|\| \[\]\)\.filter\(st => st && st\.id\)/.test(SRC) && /if \(Array\.isArray\(rawMoves\.__card_sets__\)\) Catalog\.cardSets = rawMoves\.__card_sets__;/.test(SRC) && /delete cleanMoves\.__card_sets__;/.test(SRC),
  'sets travel INSIDE the catalogue blob, where obtainability and the structure decks ride — card_catalog has no column of its own, and asking for one took every publish down (v121v124)');
ok(/function _setsOfCard\(id\)/.test(SRC) && /Catalog\.cardSets/.test(SRC), '…and a player\'s copy of the sets is read back');

/* ── 3. the closet arrived ── */
for (const f of ['index.js', 'closet.rig.js', 'closet.dress.js', 'closet.character.js', 'closet.studio.js', 'closet.creator.js', 'closet.api.js', 'closet.bridge.js', 'closet.model.js', 'closet.stage.js', 'closet.css']) {
  ok(existsSync('./public/src/closet/' + f) && statSync('./public/src/closet/' + f).size > 200, 'public/src/closet/' + f);
}
ok(/<script type="module" src="src\/closet\/index\.js\?v=pc1"><\/script>/.test(SRC), 'the closet module is loaded by the page');
ok(/closet: \{ outfit: null, owned: \[\] \},/.test(SRC), 'Profile.closet exists');
ok(/__closet__:           \(Profile\.closet && typeof Profile\.closet === 'object'\)/.test(SRC) && /if \(f\.__closet__ && typeof f\.__closet__ === 'object'\) \{/.test(SRC) && /if \(p\.closet          && typeof p\.closet          === 'object'\)/.test(SRC),
  'it is in ALL THREE whitelists — the cloud upload, the cloud hydration and the local loader (two of three is how Covert Actions lost a day)');
ok(/closet: \{\n\s*signedIn: \(\)/.test(SRC) && /charge: \(amount, cur, reason\)/.test(SRC), 'MythicBridge.closet is the module\'s only door, and charge goes through spendGems / spendSovereigns');
ok(existsSync('./sql/134_player_closet.sql') && /create table if not exists public\.closet_items/.test(readFileSync('./sql/134_player_closet.sql', 'utf8')), 'the migration is checked in, renumbered (132 is this tree\'s Node Inventory)');

/* ── 4. run the release maths for real ── */
{
  const block = SRC.slice(SRC.indexOf('const CARD_SET_KEY = '), SRC.indexOf('function grantCard(id, qty, opts) {'));
  const g = {
    Forge: { cardSets: [], obtainability: {} },
    Catalog: { cardSets: [] },
    getForgeObt: (kind, id) => (g.Forge.obtainability[kind + ':' + id] || { craftable: true, lootable: true, adminOnly: false, unreleased: false }),
    isForgeAdminOnly: (kind, id) => !!(g.Forge.obtainability[kind + ':' + id] || {}).adminOnly,
    getAllCustomPacks: () => [],
    Date, Math, Infinity, isFinite, Array, Object, String, Number,
  };
  const api = new Function('g', 'with (g) { ' + block + ' return { cardReleaseAt, isCardReleased, packReleaseAt, isPackReleased, releaseWhenText, getCardSets, cardGrantRefusalReason }; }')(g);
  ok(api.isCardReleased('cc_1') === true, 'run for real: a card in no set, with no pill, is out now');
  /* The two source-regex checks at the top of this file used to assert that
     grantCard and the pool refused an unreleased card by matching their inline
     text. Asserted here by RUNNING the predicate both of them now call, which
     survives a refactor and would not survive the rule actually going away. */
  ok(api.cardGrantRefusalReason('cc_1') === null, 'run for real: a released, obtainable card is not refused');
  g.Forge.obtainability['card:cc_1'] = { craftable: true, lootable: true, adminOnly: false, unreleased: true };
  ok(api.isCardReleased('cc_1') === false && api.cardReleaseAt('cc_1') === Infinity, 'run for real: the 🔒 pill holds it back with no date');
  ok(api.cardGrantRefusalReason('cc_1') === 'unreleased', 'run for real: grantCard refuses an unreleased card, via the shared predicate', String(api.cardGrantRefusalReason('cc_1')));
  const soon = Date.now() + 3 * 86400000, past = Date.now() - 1000;
  g.Forge.cardSets = [{ id: 'set_a', name: 'Set 2', releaseAt: soon, cardIds: ['cc_2', 'cc_3'], packId: 'pk_1' }];
  ok(api.isCardReleased('cc_2') === false && Math.abs(api.cardReleaseAt('cc_2') - soon) < 5, 'run for real: a card in a set dated three days out is not obtainable yet');
  ok(api.isPackReleased({ id: 'pk_1' }) === false && api.isPackReleased({ id: 'pk_other' }) === true, 'run for real: that set\'s pack is off the shelf; every other pack is not');
  g.Forge.cardSets[0].releaseAt = past;
  ok(api.isCardReleased('cc_2') === true && api.isPackReleased({ id: 'pk_1' }) === true, 'run for real: the instant the date passes, the card and its pack are live — nothing had to run');
  g.Forge.cardSets = [{ id: 'a', releaseAt: Date.now() + 900000, cardIds: ['cc_4'] }, { id: 'b', releaseAt: past, cardIds: ['cc_4'] }];
  ok(api.isCardReleased('cc_4') === true, 'run for real: a card in two sets releases with the earliest of them');
  ok(/^in \d+ min · /.test(api.releaseWhenText(Date.now() + 1800000)) && api.releaseWhenText(0) === 'released' && api.releaseWhenText(Infinity) === 'held back', 'run for real: the row says when, in words', JSON.stringify([api.releaseWhenText(Date.now() + 1800000), api.releaseWhenText(0), api.releaseWhenText(Infinity)]));
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 122, 'BUILD_VERSION is v121v122 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
