/* ════════════════════════════════════════════════════════════════════════════
   🔀 _sidedeck_smoke.mjs — the side-deck rules and the best-of-3 match.
   ----------------------------------------------------------------------------
   The two things worth guarding here are both exploits rather than crashes:

     1. THE COPY LIMIT SPANS BOTH PILES. 3 in main + 1 in side is 4 copies in
        the match. Counting the piles separately is the classic side-deck
        cheat and it looks completely fine in review.
     2. A SWAP IS A MOVE, NOT AN ADDITION. The combined pool before and after
        siding must be identical, or a player sides in a card they never owned.

   Plus the match rule that makes best-of-3 worth having: the LOSER of a game
   chooses who starts the next one.

       node _sidedeck_smoke.mjs
   ════════════════════════════════════════════════════════════════════════════ */
import {
  SIDE_MAX, copiesOf, sideOf, inventory, legalityErrors, swapErrors, move,
} from './public/src/sidedeck/sideboard.js';
import { newMatch, recordGame, chooseFirst, commitSiding, scoreLine, isMatchPoint } from './public/src/sidedeck/match.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
};

// A 40-card main deck: 13 distinct cards, 3 copies each, plus one single.
const mk = () => {
  const cards = [];
  for (let i = 0; i < 13; i++) for (let c = 0; c < 3; c++) cards.push('unit:c' + i);
  cards.push('unit:solo');
  return { id: 'd1', name: 'Test', heroId: 'h1', cards, side: [] };
};
const ENV = { deckSize: 40, copyLimit: () => 3, nameOf: k => k };

console.log('\n🔀 SIDE DECK\n');

/* ── basics ────────────────────────────────────────────────────────────── */
{
  const d = mk();
  ok('a fresh deck is 40 cards', d.cards.length === 40);
  ok('a deck with no side field reads as an empty side', sideOf({ cards: [] }).length === 0);
  ok('a legal deck reports no errors', legalityErrors(d, ENV).length === 0,
     JSON.stringify(legalityErrors(d, ENV)));
}

/* ── 1. THE COPY LIMIT SPANS BOTH PILES ───────────────────────────────── */
{
  const d = mk();
  d.side = ['unit:c0'];                        // a 4th copy, hidden in the side
  ok('copiesOf counts main + side together', copiesOf(d, 'unit:c0') === 4);
  const errs = legalityErrors(d, ENV);
  ok('a 4th copy in the SIDE is illegal', errs.some(e => /unit:c0/.test(e)),
     JSON.stringify(errs));
}
{
  const d = mk();
  d.cards = d.cards.filter(c => c !== 'unit:c0').concat(['unit:c0', 'unit:c0']);  // 2 in main
  d.side = ['unit:c0'];                                                           // 1 in side = 3 total
  ok('3 across both piles is legal', !legalityErrors(d, ENV).some(e => /unit:c0/.test(e)));
}

/* ── banned cards ─────────────────────────────────────────────────────── */
{
  const d = mk();
  const banEnv = { ...ENV, copyLimit: (k) => (k === 'unit:c3' ? 0 : 3) };
  const errs = legalityErrors(d, banEnv);
  ok('a BANNED card is reported as banned', errs.some(e => /BANNED/.test(e)), JSON.stringify(errs));
}

/* ── side deck ceiling ────────────────────────────────────────────────── */
{
  const d = mk();
  d.side = new Array(SIDE_MAX + 1).fill('unit:x');
  ok(`a side deck over ${SIDE_MAX} is illegal`,
     legalityErrors(d, ENV).some(e => new RegExp('maximum is ' + SIDE_MAX).test(e)));
}

/* ── move() is pure ───────────────────────────────────────────────────── */
{
  const d = mk();
  const before = JSON.stringify(d);
  const after = move(d, 'unit:c0', 'toSide');
  ok('move() does not mutate the original (Cancel must be lossless)', JSON.stringify(d) === before);
  ok('…and the copy has one fewer in main', after.cards.length === 39);
  ok('…and one more in side', after.side.length === 1);
  const back = move(after, 'unit:c0', 'toMain');
  ok('moving it back restores the deck', back.cards.length === 40 && back.side.length === 0);
  ok('moving a card that is not there is a no-op', move(d, 'unit:nope', 'toSide') === d);
}

/* ── 2. A SWAP IS A MOVE, NOT AN ADDITION ─────────────────────────────── */
{
  const ref = mk();
  ref.side = ['unit:s0', 'unit:s1'];

  // Legal: swap one out, one in.
  let after = move(ref, 'unit:c0', 'toSide');
  after = move(after, 'unit:s0', 'toMain');
  ok('a 1-for-1 swap is legal', swapErrors(ref, after, ENV).length === 0,
     JSON.stringify(swapErrors(ref, after, ENV)));

  // Illegal: main shrinks.
  const shrunk = move(ref, 'unit:c0', 'toSide');
  ok('siding OUT without siding IN is refused',
     swapErrors(ref, shrunk, ENV).some(e => /Main deck must return to 40/.test(e)),
     JSON.stringify(swapErrors(ref, shrunk, ENV)));

  // Illegal: a card appears from nowhere, sizes still correct.
  const conjured = { ...ref, cards: ref.cards.slice(0, 39).concat(['unit:ghost']), side: ref.side.slice() };
  ok('conjuring a card while keeping the sizes right is refused',
     swapErrors(ref, conjured, ENV).some(e => /only be MOVED/.test(e)),
     JSON.stringify(swapErrors(ref, conjured, ENV)));

  // Illegal: side deck grows.
  const grown = { ...ref, cards: ref.cards.slice(), side: ref.side.concat(['unit:extra']) };
  ok('growing the side deck is refused',
     swapErrors(ref, grown, ENV).some(e => /Side deck must return to 2/.test(e)));
}

/* ── inventory drives the UI ──────────────────────────────────────────── */
{
  const d = mk();
  d.side = ['unit:c0'];
  const inv = inventory(d);
  const row = inv.find(r => r.key === 'unit:c0');
  ok('inventory splits a card across the piles', row && row.main === 3 && row.side === 1);
  ok('inventory lists each distinct card once', inv.length === 14, 'got ' + inv.length);
}

console.log('\n🏆 BEST-OF-3\n');

/* ── the match ────────────────────────────────────────────────────────── */
{
  const m = newMatch(mk());
  ok('a bo3 needs 2 wins', m.needed === 2);
  ok('siding is closed before any game', m.sidingOpen === false);
  ok('the deck snapshot is a COPY, not a reference', m.deckAtStart !== m.deckNow);

  recordGame(m, 'ai', { turns: 11 });
  ok('after game 1 the match is not over', m.over === false);
  ok('…siding opens', m.sidingOpen === true);
  ok('…and the LOSER (player) chooses who starts', m.chooserSide === 'player');
  ok('score line reads correctly', /Game 2 of up to 3 · 0–1/.test(scoreLine(m)), scoreLine(m));
  ok('1–0 is match point', isMatchPoint(m) === true);

  chooseFirst(m, 'ai');
  ok('the choice sticks', m.firstPlayer === 'ai');

  const sided = move(m.deckNow, 'unit:c0', 'toSide');
  commitSiding(m, sided);
  ok('committing siding closes the window', m.sidingOpen === false);
  ok('…and banks the new deck', m.deckNow.side.length === 1);
  ok('…while deckAtStart is untouched', m.deckAtStart.side.length === 0);

  recordGame(m, 'player');
  ok('1–1 re-opens siding', m.sidingOpen === true && m.over === false);
  ok('…and now the AI chooses', m.chooserSide === 'ai');

  recordGame(m, 'player');
  ok('2–1 ends the match', m.over === true && m.winner === 'player');
  ok('…and closes siding', m.sidingOpen === false);
  ok('…with a final score line', /Match won 2–1/.test(scoreLine(m)), scoreLine(m));

  recordGame(m, 'ai');
  ok('a finished match ignores further games', m.games.length === 3 && m.winner === 'player');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
