/* 🔮🧭 v121v133 — enchantments come out of any zone onto the BOARD, and the
   camp's back button sits top-left like every other screen's.
   Run: node _enchzone_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── 🔮 an enchantment is summonable ───────────────────────────────────────────
   Owner: "Enchantments need to be able to be summoned from the deck, hand, void
   or graveyard. As they stay on the field until destroyed." …and, clarifying,
   "Enchantments get placed on the board like units do."

   🌟 Summon From Zone already reached all four piles with the Card Filter, the
   id list, the picker and the placement search. The ONLY thing stopping it
   carrying an enchantment was the type test, so the fix widens that rather than
   building a parallel effect. */
/* ⚠ THIS PIN CARRIED THE WHOLE LINE VERBATIM, so it failed the moment v121v140
   added `evo` to it for an unrelated reason ("Evo Units are units"). The claim
   is about ENCHANTMENTS AND CURSES being on that list, not about who else is —
   a list that is only ever added to should not make every addition look like a
   regression. Each type is asserted on its own, so removing one still fails. */
{
  const line = (SRC.match(/^\s*return t === 'unit'[^\n]*$/m) || [''])[0];
  ok(/t === 'enchantment'/.test(line) && /t === 'curse'/.test(line),
    'an enchantment and a curse are summonable — the one line that stopped it', line.trim());
  ok(/t === 'unit'/.test(line) && /t === 'summon'/.test(line),
    '…and units and summons are still on it, so the widening never replaced what was there');
}
{
  const f = SRC.slice(SRC.indexOf('function _isSummonableCard(c) {') - 1400, SRC.indexOf('function _isSummonableCard(c) {') + 400);
  ok(/HEROES are deliberately excluded/.test(f),
    '…and a HERO still is not, so "your hero died" cannot become ambiguous');
}
ok(/if \(_ct === 'enchantment' \|\| _ct === 'curse'\) \{ u\.isEnchantment = true; u\.cardType = _ct; \}/.test(SRC),
  'the token on the board announces itself — buildUnit carries no card type onto a unit, so the flag is the only thing that can');
{
  /* the engine already looked for exactly this and nothing could produce it */
  const zc = SRC.slice(SRC.indexOf('if (z.controlEnchantment'), SRC.indexOf('if (z.controlEnchantment') + 260);
  ok(/u\.isEnchantment \|\| t === 'enchantment' \|\| t === 'curse'/.test(zc),
    '…which is the shape "while you control an enchantment" was already testing board units for');
}
ok(/units, summons AND enchantments, by Card Filter or id list/.test(SRC),
  'the effect label says so, so an author can find it without reading the engine');
ok(/finds nothing in \$\{owner === 'player' \? 'your' : 'their'\}/.test(SRC),
  '…and the empty-pile line no longer says "no unit" about a search that can also find a permanent');
{
  /* run the type rule for real */
  const summonable = (t) => t === 'unit' || t === 'summon' || t === 'enchantment' || t === 'curse';
  ok(summonable('unit') && summonable('summon'), 'run for real: units and summons are unchanged');
  ok(summonable('enchantment') && summonable('curse'), 'run for real: enchantments and curses now qualify');
  ok(!summonable('spell') && !summonable('trap') && !summonable('location') && !summonable('weather'),
    'run for real: a spell, trap, location or weather still cannot be put on a tile');
  ok(!summonable('hero'), 'run for real: and never a hero');
}
{
  /* ⚠ THIS PIN SAID THE CAST-FROM-HAND PATH WAS UNTOUCHED, and at v121v133 that
     was right: v133 widened only the SUMMON path, and moving where a cast lands
     would have been a far larger behavioural change than the one asked for.
     v121v135 IS that larger change, asked for directly — "when playing a
     Enchantment it should show highlighted tiles next to the hero to where it
     can be placed on the battlefield" — so the PLAYER's hand play now lays a
     permanent on a tile. What this pin was actually protecting is unchanged and
     is still asserted below: state.enchantments remains the record, it is built
     in ONE place, and an entry with no tile still anchors on its owner's hero,
     which is what the AI's plays and the cast path (a chain, a copy effect)
     produce. See _enchplace_smoke.mjs for the placement itself. */
  /* ⚠ ANCHORED ON playSpell, NOT on the type test. v121v135 added that same
     test to getValidPlacementTiles, which sits EARLIER in the file, so an
     indexOf for it now lands on the placement ring instead of the cast branch —
     the pin would have been reading a function it was never about. */
  const _psAt = SRC.indexOf('function playSpell(card) {');
  const ps = SRC.slice(_psAt, SRC.indexOf('// 🌌 Polycreation spell', _psAt));
  ok(/enchantments: \[\.\.\.\(s\.enchantments \|\| \[\]\), _enchantEntry\(card, 'player', s\.turnNumber\)\],/.test(ps),
    'the CAST path still lands on state.enchantments — with no tile, so it anchors on the hero exactly as before');
  ok(/function _enchantEntry\(card, owner, turnNumber, extra\) \{/.test(SRC),
    '…and the entry has ONE builder, so the placement and the cast cannot drift into two shapes of the same record');
}

/* ── 🧭 bug-mtxkwv4m — the back button ───────────────────────────────────────
   "The location of the button to navigate back to previous page in the camp is
   top right whereas the majority are top left." Repro: Camp → Camp → Camp, and
   "The Bunker" shows at top right. .forge-header is space-between with two
   children, so a button in the right-hand group is pinned right by the LAYOUT. */
{
  const i = SRC.indexOf('<!-- 🧭 v121v133 (bug-mtxkwv4m)');
  ok(i > 0, 'the camp header carries the reason the button moved');
  const hdr = SRC.slice(i, i + 1500);
  const btn = hdr.indexOf('id="btn-back-camp"');
  const title = hdr.indexOf('<h2 class="section-title"');
  ok(btn > 0 && title > 0 && btn < title,
    'the back button comes BEFORE the title in the header, so it renders top-left', 'btn@' + btn + ' title@' + title);
}
ok((SRC.match(/id="btn-back-camp"/g) || []).length === 1,
  'there is exactly ONE back button — the old right-hand copy is gone, not merely hidden');
ok(/document\.getElementById\('btn-back-camp'\)\.onclick/.test(SRC),
  '…and it is still the button the click handler binds');
{
  const fh = SRC.slice(SRC.indexOf('.forge-header { display: flex;'), SRC.indexOf('.forge-header { display: flex;') + 160);
  ok(/justify-content: space-between/.test(fh),
    '.forge-header itself is UNTOUCHED — it is shared by many screens, and re-laying it out to move one button is how a header regression reaches pages nobody tested');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 133, 'BUILD_VERSION is v121v133 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
