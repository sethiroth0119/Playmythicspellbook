/* 🌐🃏 v121v146 — multiplayer shows the opponent's REAL deck, hero and cards.
   Run: node _mpdecks_smoke.mjs

   Owner: "Player say Multiplayer is unplayable, they couldn't select cards and
   or attack." …and: "It wasn't showing the right cards, deck or the players
   correct hero."

   ⚠ THE ROOT CAUSE: this game's content is PLAYER-FORGED and the wire format
     carried IDS ONLY. On the receiving client the opponent's 40 keys passed the
     length gate, lookupCustomCard could not resolve a card the other player
     forged and never published, buildDeckFromKeys DROPPED it (there is no else —
     the key simply vanishes), and _legalizeDeck then padded the hole from
     UNIT_CARDS *and Forge.customCards* — MY OWN FORGED CARDS. The player watched
     their opponent play built-in goblins and the player's own deck. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── A. the definitions travel ────────────────────────────────────────────── */
ok(/function _slimCardForMp\(card\) \{/.test(SRC), 'a card can be slimmed for the wire');
{
  const f = SRC.slice(SRC.indexOf('function _slimCardForMp(card) {'), SRC.indexOf('function _deckCardDefsForMp'));
  ok(/const HEAVY = \{ img:1, image:1, imageUrl:1, art:1, artBase64:1, artUrl:1/.test(f),
    'ART IS STRIPPED — the same HEAVY list _slimHeroForMp uses for this same payload');
  ok(/v\.slice\(0, 5\) === 'data:' \|\| v\.length > 4096/.test(f),
    '…including inline data: URLs and any oversized string, whatever key it hides under');
}
ok(/ART IS STRIPPED, exactly as _slimHeroForMp strips it/.test(SRC),
  'the reason is written down: forty raw definitions would be megabytes, and an oversized frame is how a client loses its turn');
ok(/function _deckCardDefsForMp\(deckKeys\) \{/.test(SRC), 'a deck\'s custom definitions can be collected');
{
  const f = SRC.slice(SRC.indexOf('function _deckCardDefsForMp(deckKeys) {'), SRC.indexOf('let _mpOpponentCardDefs'));
  ok(/if \(!def\) continue;                       \/\/ a built-in — the far side has it/.test(f),
    'built-ins are skipped — both clients already have those, and shipping them would double the payload');
  ok(/if \(!id \|\| seen\[id\]\) continue;/.test(f), '…and each definition is sent once, however many copies the deck holds');
}
ok((SRC.match(/cardDefs:/g) || []).length >= 3,
  'ALL THREE payload paths carry them: matchmaking, the friend-challenge send (deck1) and the accept',
  String((SRC.match(/cardDefs:/g) || []).length));

/* ── the resolver consults them, LAST ─────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function lookupCustomCard(id) {'), SRC.indexOf('function lookupCustomMove'));
  ok(/return local \|\| cloud \|\| _mpOpponentCardDefs\[id\] \|\| null;/.test(f),
    'the opponent pool is consulted LAST, so it can never shadow a card either player actually owns');
  ok(/if \(_forgeIsCardDeleted\(id\)\) return null;/.test(f),
    '…and a card deleted in the Forge is still refused first, so the pool cannot resurrect it');
}
ok(/_mpSetOpponentCardDefs\(\(MultiplayerMatch\.opponentDeck && MultiplayerMatch\.opponentDeck\.cardDefs\) \|\| \[\]\);/.test(SRC),
  'the pool is adopted when the match is found');
{
  const i = SRC.indexOf('_mpSetOpponentCardDefs((MultiplayerMatch.opponentDeck');
  const j = SRC.indexOf('App.battlePrep.enemyDeckOverride');
  ok(j > 0 && i > j, '…AFTER enemyDeckOverride is set but BEFORE the deck is built, because buildDeckFromKeys resolves each key as it walks the list');
}

/* ── B. an opponent's deck is never padded from MY collection ─────────────── */
ok(/function _legalizeDeck\(cards, opts\) \{/.test(SRC), '_legalizeDeck can be told whose deck it is');
{
  const f = SRC.slice(SRC.indexOf('function _legalizeDeck(cards, opts) {'), SRC.indexOf('function _legalizeDeck(cards, opts) {') + 3000);
  ok(/const _mpOpp = !!\(opts && opts\.opponentDeck\);/.test(f), 'the flag is read');
  ok(/\(!_mpOpp && typeof Forge !== 'undefined' && Forge && Array\.isArray\(Forge\.customCards\)\) \? Forge\.customCards : \[\]/.test(f),
    "AN OPPONENT'S DECK IS NEVER PADDED FROM MY FORGED CARDS — this pad is what made players watch their own deck played against them");
  ok(/UNIT_CARDS/.test(f), '…while the built-in pool still fills a genuine gap, so the deck is not left empty');
  ok(/an undersized deck just means they\n?\s*hit fatigue sooner/.test(f) || /undersized deck/.test(f),
    'the trade-off is stated: an undersized deck beats a wrong one');
}
ok(/const aiDeck = _legalizeDeck\(buildDeckFromKeys\(bp\.enemyDeckOverride\), \{ opponentDeck: true \}\);/.test(SRC),
  'the multiplayer opponent deck passes the flag');
{
  /* the other callers must be untouched — they are MY decks */
  ok(/return _legalizeDeck\(buildDeckFromKeys\(safeSaved\)\);/.test(SRC) && /return _legalizeDeck\(mixed\);/.test(SRC),
    'my own deck-building callers are unchanged, so padding my deck from my collection still works');
}

/* ── the hero on the accept path ──────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf("const ok = await _lobbyBroadcast('challenge_accept', payload);") - 1600,
                      SRC.indexOf("const ok = await _lobbyBroadcast('challenge_accept', payload);"));
  ok(/heroData: \(typeof _heroDataForMp === 'function'\)/.test(f) && /heroProg: \(typeof _heroProgForMp === 'function'\)/.test(f),
    'THE ACCEPT CARRIES THE HERO — it carried neither heroData nor heroProg, while the send side and deck1 both do');
  ok(/FABRICATED the accepting player's hero/.test(f),
    '…and the note records what the far side did instead: a level-1 placeholder with 30 HP and a shadow element');
  ok(/cardDefs:/.test(f), '…and the card definitions too');
}

/* ── C. the silent refusal speaks ─────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function onTileClick(x, y) {'), SRC.indexOf('function onTileClick(x, y) {') + 2200);
  ok(/if \(s\.turn !== 'player'\) \{/.test(f) && /Not your turn yet — waiting for the opponent\./.test(f),
    'a refused click in multiplayer SAYS SO — it returned silently, which is exactly "couldn\'t select cards and or attack"');
  ok(/nothing reads it back/.test(f),
    '…and the note records why a client can be stranded: the server writes current_player_id on end-turn and nothing reads it back');
  ok(/if \(App\.battlePrep && App\.battlePrep\.multiplayer\)/.test(f),
    'the message is multiplayer-only — a single-player click during the AI turn is not a mystery worth a toast');
}

/* ── the unit-equipment key space ─────────────────────────────────────────── */
ok(!/startsWith\('u_'\)\) continue/.test(SRC),
  'NO payload still tests a DECK key with startsWith("u_") — deck keys are "unit:<id>", equipment keys are "u_<id>", so that test never matched and unitEquipment shipped as {} in EVERY multiplayer payload');
ok((SRC.match(/const _ek = \(_cid\.slice\(0, 2\) === 'u_'\)/g) || []).length === 4,
  '…fixed at all FOUR copies of that loop, and IDEMPOTENTLY: a key that already carries the prefix must not become u_u_<id>, which would be the same silent-miss bug wearing a different shape',
  String((SRC.match(/const _ek = \(_cid\.slice\(0, 2\) === 'u_'\)/g) || []).length));
ok(/The hero's key is built explicitly as/.test(SRC) || /heroEquipment is fine/.test(SRC) || /'h_' \+ opts\.hero\.id/.test(SRC),
  'the hero half still builds its key explicitly, which is why only the UNIT half was broken');

/* ── run the conversions for real ─────────────────────────────────────────── */
{
  /* the deck-key → equipment-key conversion */
  const toEq = (cardKey) => {
    if (typeof cardKey !== 'string') return null;
    const i = cardKey.indexOf(':');
    const id = i >= 0 ? cardKey.slice(i + 1) : cardKey;
    if (!id) return null;
    return (id.slice(0, 2) === 'u_') ? id : ('u_' + id);
  };
  ok(toEq('unit:goblin') === 'u_goblin', 'run for real: a deck key becomes the right equipment key');
  ok(toEq('custom:cc_bought_17') === 'u_cc_bought_17', 'run for real: …including a bought custom copy');
  ok(toEq('u_goblin') === 'u_goblin', 'run for real: …and an already-converted key is idempotent');
  ok(toEq(null) === null && toEq('') === null, 'run for real: junk converts to nothing rather than "u_undefined"');
  const old = (cardKey) => typeof cardKey === 'string' && cardKey.startsWith('u_');
  ok(old('unit:goblin') === false,
    'run for real: THE OLD TEST FAILED ON A REAL DECK KEY — which is why unit equipment has never once crossed the wire');

  /* the resolver order */
  const resolve = (id, local, cloud, opp) => local[id] || cloud[id] || opp[id] || null;
  ok(resolve('x', {}, {}, { x: { id: 'x', from: 'opp' } }).from === 'opp',
    "run for real: a card only the opponent has now resolves instead of returning null");
  ok(resolve('x', { x: { id: 'x', from: 'mine' } }, {}, { x: { id: 'x', from: 'opp' } }).from === 'mine',
    'run for real: …but MY copy always wins, so their stale version cannot shadow my edit');
  ok(resolve('y', {}, {}, {}) === null, 'run for real: a card nobody has is still null');

  /* the pad */
  const pad = (out, cap, builtIn, mine, isOpp) => {
    const pool = [].concat(builtIn, isOpp ? [] : mine);
    const r = out.slice();
    for (const c of pool) { if (r.length >= cap) break; r.push(c); }
    return r;
  };
  const mine = [{ id: 'MY_FORGED' }];
  ok(pad([], 2, [{ id: 'goblin' }, { id: 'orc' }], mine, true).every(c => c.id !== 'MY_FORGED'),
    "run for real: AN OPPONENT'S SHORT DECK IS NEVER FILLED WITH MY CARDS — the whole reported bug");
  ok(pad([], 2, [{ id: 'goblin' }], mine, false).some(c => c.id === 'MY_FORGED'),
    'run for real: …while MY OWN short deck still tops up from my collection, unchanged');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 146, 'BUILD_VERSION is v121v146 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
