/* 🎴➜ v121v136 — every log row that NAMES a card shows that card, and a row
   naming two shows actor ➜ target. Run: node _logcards_smoke.mjs

   Owner: "I want the card next to every single thing if it mentions them show
   the card art and if is a card attacking or targeting another card show the
   card art and a arrow to the card it attacked or targeted."

   WHY ALMOST NO ROW HAD ART. _bcLogArt draws from l.cardId, and only the handful
   of PLAY announcements v121v129 touched ever set one. Every other line — every
   attack, heal, miss, status, trigger, consume, activation — is pushed as
   { msg, color } from one of several HUNDRED log.push sites across the engine.
   Stamping an id at each is hundreds of edits with no way to verify it stayed
   complete: the next effect anybody authors adds site 301 with no id and the
   feature silently rots. So the card is resolved FROM THE ROW'S OWN TEXT at
   render time, in one place — the log already prints the names, which is why
   the rows are readable — and it then works retroactively on every line already
   in the log and on every line any future effect pushes. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the index ────────────────────────────────────────────────────────────── */
ok(/function _bcCardNameIndex\(s\) \{/.test(SRC), 'a name → card index is built from the battle');
{
  const f = SRC.slice(SRC.indexOf('function _bcCardNameIndex(s) {'), SRC.indexOf('/* Which cards does this row talk about?'));
  ok(/for \(const zone of \['hand', 'deck', 'graveyard', 'void', 'banished'\]\)/.test(f),
    'it covers every pile a log line can name — a card in the graveyard is still named by the line that put it there');
  ok(/\(s\.units \|\| \[\]\)\.forEach/.test(f) && /s\.enchantments/.test(f) && /s\.activeLocation/.test(f) && /s\.weather/.test(f),
    '…as well as the board, the enchantments, the location and the weather');
  ok(/if \(nm\.length < 3 \|\| seen\[nm\]\) return;/.test(f),
    'a two-character name is refused — it is a substring waiting to match the middle of a word');
  ok(/out\.sort\(\(a, b\) => b\.name\.length - a\.name\.length\);/.test(f),
    'LONGEST FIRST — "Savage Demon sword of Sparta" must not resolve as "Savage Demon"');
  ok(/NO LEAK IS POSSIBLE/.test(SRC.slice(SRC.indexOf('v121v136 — NAME → CARD'), SRC.indexOf('function _bcCardNameIndex(s) {'))),
    'the reason this cannot leak a hidden card is written down: it only answers a name the log ALREADY printed in words');
}

/* ── the matcher ──────────────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _bcLogCardsIn(l, idx) {'), SRC.indexOf('/* One art tile.'));
  ok(/if \(!l \|\| l\.hidden\) return out;/.test(f), '🃏 a face-down Set still draws nothing at all');
  ok(/if \(l\.cardId\) out\.push/.test(f), 'an explicitly stamped id still wins — the play rows are unchanged');
  ok(/const clean = !isWordChar\(before\) && !isWordChar\(after\);/.test(f),
    'a name must sit on word boundaries, so it cannot match inside a longer word');
  ok(/const overlaps = taken\.some\(r => i < r\.e && \(i \+ e\.name\.length\) > r\.s\);/.test(f),
    '…and a span already claimed by a longer name is not matched again');
  ok(/hits\.sort\(\(a, b\) => a\.at - b\.at\);/.test(f),
    'BY POSITION IN THE SENTENCE, not by match order — the actor is written first in "A strikes B", and matching runs longest-name-first, which is unrelated');
  ok(/if \(out\.some\(o => o\.cardId === h\.cardId\)\) continue;/.test(f),
    '"X heals X" draws ONE card, not the same art twice with an arrow between');
  ok(/if \(out\.length >= 2\) break;/.test(f), '…and at most two are ever drawn');
}

/* ── the row ──────────────────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _bcLogRow(l, idx) {'), SRC.indexOf('function _bcLogModal(s) {'));
  ok(/<span class="logarrow" aria-label="acts on">➜<\/span>/.test(f),
    'TWO CARDS GET AN ARROW BETWEEN THEM — the owner\'s second sentence');
  ok(/if \(a && b\) art = /.test(f) && /else art = a \|\| b;/.test(f),
    'both halves or neither — one art and a dangling arrow reads as a bug');
  ok(/if \(!art\) art = _bcLogArt\(l\);/.test(f),
    'the stamped-id path is still there underneath, unchanged');
  ok(/\(cards\.length >= 2 \? ' lk-pair' : ''\)/.test(f), '…and a pair row is marked, so the CSS can size two tiles to fit');
}
ok(/_abilityArtBest\(c && c\.cardId, false\)/.test(SRC),
  'the art comes from the SAME resolver as the ⚡ panel and the cinematic (v121v134) — a card that resolves anywhere resolves here');
ok(/const _idx = _bcCardNameIndex\(s\); return visible\.slice\(-400\)\.reverse\(\)\.map\(l => _bcLogRow\(l, _idx\)\)/.test(SRC),
  'ONE index for the whole list — _bcLogRow runs up to 400 times per render, and walking both decks that often is a modal that hitches');
ok(/\.bchrome \.logrow \.logarrow\{/.test(SRC) && /\.bchrome \.logrow \.logpair\{/.test(SRC), 'the arrow and the pair have styling');

/* ── run the matcher for real ─────────────────────────────────────────────── */
{
  const block = SRC.slice(SRC.indexOf('function _bcLogCardsIn(l, idx) {'), SRC.indexOf('/* One art tile.'));
  const api = new Function('return (' + block.replace('function _bcLogCardsIn(l, idx) {', 'function (l, idx) {') + ')')();
  const mk = (name, id) => ({ name, cardId: id, cardType: 'unit' });
  const idx = [
    mk('Savage Demon sword of Sparta', 'c_sword'),
    mk('Aroa Stormrider Survivor', 'c_aroa'),
    mk('Jacklin The Realm solider', 'c_jack'),
    mk('Crystal Of Nuwa', 'c_nuwa'),
    mk('Savage Demon', 'c_demon'),
    mk('Nu', 'c_short'),
  ].sort((a, b) => b.name.length - a.name.length);

  let r = api({ msg: 'Crystal Of Nuwa heals Aroa Stormrider Survivor for 15' }, idx);
  ok(r.length === 2 && r[0].cardId === 'c_nuwa' && r[1].cardId === 'c_aroa',
    'run for real: two cards, in the order the sentence names them', JSON.stringify(r.map(x => x.cardId)));

  r = api({ msg: 'Savage Demon sword of Sparta consumes 3 cards from your graveyard.' }, idx);
  ok(r.length === 1 && r[0].cardId === 'c_sword',
    'run for real: THE LONGEST NAME WINS — it is not read as "Savage Demon"', JSON.stringify(r.map(x => x.cardId)));

  r = api({ msg: "Jacklin The Realm solider's Quick Shot → Savage Demon cutthroat (15)" }, idx);
  ok(r.length === 2 && r[0].cardId === 'c_jack' && r[1].cardId === 'c_demon',
    'run for real: an attack line resolves actor then target', JSON.stringify(r.map(x => x.cardId)));

  r = api({ msg: 'Crystal Of Nuwa heals Crystal Of Nuwa for 15' }, idx);
  ok(r.length === 1, 'run for real: a card acting on itself draws ONE tile, not a pair', JSON.stringify(r.map(x => x.cardId)));

  r = api({ msg: 'Nothing here names a card at all.' }, idx);
  ok(r.length === 0, 'run for real: a row naming nothing resolves nothing — it keeps its emoji');

  /* ⚠ THE 2-CHARACTER GUARD LIVES IN THE INDEX BUILDER, NOT THE MATCHER, so it
     is tested against the real builder. Asserting it here against a hand-built
     idx tested nothing: the matcher is right to match a word-boundary `Nu`, and
     the reason it never sees one is that the index refuses to carry it. */
  {
    const ib = SRC.slice(SRC.indexOf('function _bcCardNameIndex(s) {'), SRC.indexOf('/* Which cards does this row talk about?'));
    const mkIdx = new Function('return (' + ib.replace('function _bcCardNameIndex(s) {', 'function (s) {') + ')')();
    const built = mkIdx({
      units: [{ name: 'Nu', cardId: 'c_short' }, { name: 'Aroa Stormrider Survivor', cardId: 'c_aroa' }],
      player: { graveyard: [{ name: 'Crystal Of Nuwa', id: 'c_nuwa', type: 'spell' }] },
      ai: {}, enchantments: [],
    });
    const names = built.map(e => e.name);
    ok(!names.includes('Nu'), 'run for real: a 2-character name never ENTERS the index — it is a substring waiting to match inside a word');
    ok(names.includes('Crystal Of Nuwa'), 'run for real: a card in the GRAVEYARD is indexed — the line that put it there names it');
    ok(names[0] === 'Aroa Stormrider Survivor', 'run for real: the index comes out longest-first', JSON.stringify(names));
  }

  r = api({ msg: 'Crystal Of Nuwa plays', cardId: 'c_stamped', cardType: 'spell' }, idx);
  ok(r[0].cardId === 'c_stamped', 'run for real: a stamped id is first — the play rows keep their exact card');

  r = api({ msg: 'Crystal Of Nuwa is set face-down', hidden: true }, idx);
  ok(r.length === 0, 'run for real: a hidden row resolves NOTHING, whatever its text says');

  r = api({ msg: 'Aroa Stormrider Survivor, Jacklin The Realm solider and Crystal Of Nuwa all act' }, idx);
  ok(r.length === 2 && r[0].cardId === 'c_aroa' && r[1].cardId === 'c_jack',
    'run for real: three names still draw only the first two', JSON.stringify(r.map(x => x.cardId)));
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 136, 'BUILD_VERSION is v121v136 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
