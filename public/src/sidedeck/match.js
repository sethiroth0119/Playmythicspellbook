/* ════════════════════════════════════════════════════════════════════════════
   🏆 BEST-OF-THREE — the match that gives a side deck somewhere to matter.
   ----------------------------------------------------------------------------
   A side deck is meaningless in a single game: you never learn what you are
   playing against in time to use it. The match is the container that makes it
   a decision — lose game 1 to a strategy, side against it, play game 2.

   State shape (small on purpose; it rides in App, not the profile):

       { id, bestOf, games: [{ winner, turns, at }], wins: {player, ai},
         sidingOpen, deckAtStart, deckNow, firstPlayer }

   🔴 WHO GOES FIRST IN GAME 2+ IS THE LOSER'S CHOICE. This is not flavour, it
   is the balance lever the whole format rests on: going first is a real
   advantage here (you set traps before anything can spring them), so handing
   the choice to the player who just LOST is what stops a game-1 win from
   snowballing into a match win. Take it away and best-of-3 is just "the better
   deck wins three times instead of once".

   ⚠ THE MATCH IS NOT PERSISTED. It lives for the duration of the match and
   dies with it. Persisting it would mean a player could close the tab mid-match
   to dodge a loss, and there is no server arbitration here to stop them — the
   ladder already records per-match results through its own path.
   ════════════════════════════════════════════════════════════════════════════ */

export const BEST_OF = 3;

export function newMatch(deck, opts) {
  const bestOf = (opts && opts.bestOf) || BEST_OF;
  return {
    id: 'm' + Date.now().toString(36),
    bestOf,
    needed: Math.floor(bestOf / 2) + 1,       // 2 for a bo3, 3 for a bo5
    games: [],
    wins: { player: 0, ai: 0 },
    sidingOpen: false,
    // The deck as it stood when the match began — the reference the swap
    // validator measures against, and what the match resets to when it ends.
    deckAtStart: cloneDeck(deck),
    deckNow: cloneDeck(deck),
    firstPlayer: 'player',
    over: false,
    winner: null,
  };
}

function cloneDeck(d) {
  if (!d) return null;
  return { ...d, cards: (d.cards || []).slice(), side: Array.isArray(d.side) ? d.side.slice() : [] };
}

/* Record a finished game. Returns the match, mutated — the caller owns it. */
export function recordGame(match, winner, meta) {
  if (!match || match.over) return match;
  const w = winner === 'player' ? 'player' : 'ai';
  match.games.push({ winner: w, turns: (meta && meta.turns) | 0, at: Date.now() });
  match.wins[w]++;

  if (match.wins[w] >= match.needed) {
    match.over = true;
    match.winner = w;
    match.sidingOpen = false;
    return match;
  }

  // Match continues — siding opens, and the LOSER of the game just played
  // chooses who starts the next one. See the note at the top of this file.
  match.sidingOpen = true;
  match.chooserSide = w === 'player' ? 'ai' : 'player';
  return match;
}

/* The loser's choice of who starts game N+1. */
export function chooseFirst(match, who) {
  if (!match) return match;
  match.firstPlayer = who === 'ai' ? 'ai' : 'player';
  return match;
}

/* Close the siding window with the arranged deck. The caller must have already
   validated it with sideboard.swapErrors — this only commits. */
export function commitSiding(match, deck) {
  if (!match) return match;
  match.deckNow = cloneDeck(deck);
  match.sidingOpen = false;
  return match;
}

/* A human-readable score, for the siding header and the match banner. */
export function scoreLine(match) {
  if (!match) return '';
  const g = match.games.length;
  if (match.over) {
    return match.winner === 'player'
      ? `Match won ${match.wins.player}–${match.wins.ai}`
      : `Match lost ${match.wins.player}–${match.wins.ai}`;
  }
  return `Game ${g + 1} of up to ${match.bestOf} · ${match.wins.player}–${match.wins.ai}`;
}

/* Is a game's result a match point for either side? Used to colour the banner. */
export function isMatchPoint(match) {
  if (!match || match.over) return false;
  return match.wins.player === match.needed - 1 || match.wins.ai === match.needed - 1;
}
