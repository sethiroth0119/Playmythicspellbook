/* ============================================================================
   PAGE-SIDE DRIVER — runs inside the real public/index.html.
   ----------------------------------------------------------------------------
   This is the piece that makes the claim "we drove the REAL engine" true.
   Nothing here reimplements a rule. It builds a battle with the game's own
   `initGame`, hands each side a deck built by the game's own
   `buildDeckFromKeys`, and then lets the game's own AI controller (`doAIStep`
   / `finishAIPhase` / `endAITurn`) play BOTH sides.

   ── HOW BOTH SIDES GET PLAYED ────────────────────────────────────────────
   The engine speaks one owner vocabulary: 'player' is you, 'ai' is the enemy,
   and the AI controller only ever pilots 'ai'. So a naive harness has to
   hand-roll a turn loop for the 'player' side — which is a much weaker claim,
   because the hand-rolled half is not the game.

   Instead we use the production function `swapBattlePerspective`
   (public/index.html:173901), the same transform multiplayer applies to every
   snapshot that arrives from the other client. Its documented invariant is
   "swapping TWICE must be the identity". Before each half-turn we swap, which
   makes whichever side is about to act the 'ai' side, and then run the real AI
   controller on it. The result is the shipped game playing itself, with the
   shipped board mirror keeping both sides geometrically identical.

   ── WHAT IS DELIBERATELY NOT REAL (declare these in any report) ───────────
   1. PRESENTATION IS STUBBED. renderBattle / render / showToast / playSfx are
      no-ops and applyAnimSpeed returns 0. The engine's *rules* are untouched;
      only the paint and the AI's cosmetic pacing are removed. Without this a
      single match takes ~40s instead of ~0.4s.
   2. `endPlayerTurn` NEVER RUNS. Because every side acts as 'ai', every turn
      ends through `endAITurn`. Consequence: `state.turnNumber` advances once
      per HALF-turn instead of once per round, so the day/night cycle
      (DAY_NIGHT_PERIOD = 5) flips twice as often as in a human game. It hits
      both sides identically, so it cannot bias a win rate, but it is not the
      human-facing cadence.
   3. HERO / UNIT PROGRESSION IS PINNED. buildHero and buildUnit roll a random
      Nature and Trait per card id and persist them to Profile, and kills bank
      EVs and bond mid-battle (public/index.html:95466). Left alone, match N+1
      is played by stronger units than match N. `neutralise()` pins every
      nature to 'hardy' (the no-bias nature), every trait to a nonexistent id
      (applyTrait no-ops on an unknown id) and clears EV/statGain tables before
      every match, so every match starts from the same baseline.
   ========================================================================= */
(function () {
'use strict';

var W = window;
if (W.__wpd) return;

/* ── 1. Presentation stubs ────────────────────────────────────────────── */
function stubPresentation() {
  var noop = function () {};
  // The AI paces itself with setTimeout(applyAnimSpeed(700)). Zero it.
  W.applyAnimSpeed = function () { return 0; };
  W.renderBattle = noop;
  W.renderBattleNow = noop;
  W._renderBattleImmediate = noop;
  W.render = noop;
  W.showToast = noop;
  W.playSfx = noop;
  W.playMoveFx = noop;
  W.saveProfile = noop;              // called on every kill; pure I/O
  // The AI holds its next step while any cinematic plays. There are none.
  W._anyCinematicActive = function () { return false; };
  ['playSpellActivationVfx', 'playCardPlayVfx', 'playAttackFx', 'playHitVfx',
   'playDeathVfx', 'showFloatingText', 'playBattleMusic', 'stopBattleMusic',
   'playCampaignMusic', 'renderBattleAnim', '_renderCounterChainOverlay',
  ].forEach(function (n) { if (typeof W[n] === 'function') W[n] = noop; });
}

/* ── 2. Progression neutraliser ───────────────────────────────────────── */
// 'hardy' is one of the five NATURES with plus/minus null (index.html:69751).
// getTrait() returns null for an unknown id, and applyTrait() no-ops on null.
var NEUTRAL_NATURE = 'hardy';
var NEUTRAL_TRAIT  = '__wpd_none';

function blankProf(isHero) {
  var g = (typeof emptyGains === 'function') ? emptyGains() : {};
  var e = (typeof emptyEvs === 'function') ? emptyEvs() : {};
  var p = { level: 1, xp: 0, kills: 0, statGains: g, evs: e,
            nature: NEUTRAL_NATURE, trait: NEUTRAL_TRAIT, bond: 100 };
  if (isHero) p.wins = 0; else p.fielded = 0;
  return p;
}

function neutralise(heroIds, cardIds) {
  var P = W.Profile;
  P.heroes = {}; P.units = {}; P.aiHeroes = {}; P.aiUnits = {};
  P.equipped = {}; P.relics = {}; P.loadouts = {};
  // Exhaustion is a player-side-only −2-to-every-stat penalty (index.html:92860).
  // A fresh pool is full, but a stale one would silently nerf side A's hero.
  P.heroEnergy = {};
  (heroIds || []).forEach(function (id) {
    P.heroes[id] = blankProf(true); P.aiHeroes[id] = blankProf(true);
  });
  (cardIds || []).forEach(function (id) {
    P.units[id] = blankProf(false); P.aiUnits[id] = blankProf(false);
  });
  var s = (typeof getSettings === 'function') ? getSettings() : null;
  if (s) { s.animSpeed = 1.0; s.skipEmptyTurns = false; s.aiDifficulty = 'normal'; s.pixiBoard = false; }
}

/* ── 3. Deck helpers that use the GAME's own resolvers ─────────────────── */
function cardIdsOf(keys) {
  var out = {};
  (keys || []).forEach(function (k) {
    var c = resolveDeckCard(k);
    if (c && c.id) out[c.id] = 1;
  });
  return Object.keys(out);
}

/* Legality, measured with the game's own constants and resolver. This is a
   REPORT, not an enforcement — nothing here rejects a deck, because the
   question we are answering is whether the shipped pipeline produces a legal
   one. */
function inspectDeck(keys) {
  var counts = {}, byType = {}, curve = {}, unresolved = [], n = 0;
  var costs = [];
  (keys || []).forEach(function (k) {
    var c = resolveDeckCard(k);
    if (!c) { unresolved.push(k); return; }
    n++;
    var id = c.id;
    counts[id] = (counts[id] || 0) + 1;
    var t = c.type || 'unit';
    byType[t] = (byType[t] || 0) + 1;
    var cost = (c.cost | 0);
    costs.push(cost);
    curve[cost] = (curve[cost] || 0) + 1;
  });
  var over = Object.keys(counts).filter(function (id) { return counts[id] > MAX_COPIES_PER_CARD; })
    .map(function (id) { return { id: id, copies: counts[id] }; });
  return {
    size: n, unresolved: unresolved, distinct: Object.keys(counts).length,
    byType: byType, curve: curve,
    avgCost: costs.length ? (costs.reduce(function (a, b) { return a + b; }, 0) / costs.length) : 0,
    overLimit: over,
    legalSize: n === DECK_SIZE,
    legalCopies: over.length === 0,
    maxCopies: MAX_COPIES_PER_CARD, deckSize: DECK_SIZE,
  };
}

/* The SHIPPED battle-bridge padding path, verbatim from the game — this is
   what a real Warpath pool goes through on the way into a match.
   public/index.html:215643. */
function padLikeWarpath(keys) {
  return (typeof warpathPadDeck === 'function') ? warpathPadDeck(keys) : keys.slice(0, DECK_SIZE);
}

/* ── 4. One match, driven by the real AI on both sides ─────────────────── */
function findHero(id) {
  var hs = (typeof getAllHeroes === 'function') ? getAllHeroes() : STARTER_HEROES;
  for (var i = 0; i < hs.length; i++) if (hs[i].id === id) return hs[i];
  return hs[0];
}

function runAiTurn(timeoutMs) {
  return new Promise(function (resolve) {
    App.ui.aiBusy = true;
    try { if (typeof _startAIHardDeadline === 'function') _startAIHardDeadline(); } catch (e) {}
    App.state = Object.assign({}, App.state, {
      units: App.state.units.map(function (u) {
        return u && u.owner === 'ai' ? Object.assign({}, u, { aiActed: false }) : u;
      }),
    });
    scheduleAIStep(0);
    var t0 = Date.now();
    var iv = setInterval(function () {
      if (!App.ui.aiBusy) { clearInterval(iv); resolve('done'); return; }
      // A hero dying mid-step ends the match; some AI paths then return
      // without ever reaching finishAIPhase, so aiBusy stays true forever.
      // 250ms of grace lets any in-flight step land, then we stop waiting.
      if (App.state && App.state.gameOver && Date.now() - t0 > 250) {
        clearInterval(iv); resolve('gameover'); return;
      }
      if (Date.now() - t0 > (timeoutMs || 20000)) {
        clearInterval(iv);
        try { finishAIPhase(); } catch (e) {}
        resolve('timeout');
      }
    }, 2);
  });
}

/* keysA / keysB are 40-card key lists (already padded by the caller through
   whichever path is being tested). aFirst decides who takes turn 1. */
async function playMatch(cfg) {
  var hA = findHero(cfg.heroA), hB = findHero(cfg.heroB);
  neutralise([hA.id, hB.id], cardIdsOf(cfg.keysA).concat(cardIdsOf(cfg.keysB)));

  App.battlePrep = { hero: hA, opponent: hB, customCards: [], multiplayer: false, rlc: false };
  App.activeCampaignNode = null;
  App.activeDailyChallenge = null;
  App.screen = 'battle';
  App.ui = Object.assign({}, App.ui, {
    selectedUnitId: null, selectedMoveId: null, selectedCardId: null, actionMode: null,
    aiBusy: false, aiActorId: null, aiActionLabel: '', counterPrompt: null,
    _gameOverHidden: false, verdictChoice: null,
  });

  var st = initGame(hA, hB, [], !!cfg.aFirst, null);
  var dA = buildDeckFromKeys(cfg.keysA);   // the game's own builder — it shuffles
  var dB = buildDeckFromKeys(cfg.keysB);
  st.player = Object.assign({}, st.player,
    { hand: dA.slice(0, STARTING_HAND_SIZE), deck: dA.slice(STARTING_HAND_SIZE) });
  st.ai = Object.assign({}, st.ai,
    { hand: dB.slice(0, STARTING_HAND_SIZE), deck: dB.slice(STARTING_HAND_SIZE) });
  App.state = st;

  var swapped = false;               // is the frame currently mirrored?
  var half = 0, timeouts = 0;
  var MAX_HALF = cfg.maxHalfTurns || 200;
  var err = null;
  var sawLocation = false, sawWeather = false, sawTrap = false;

  try {
    while (!App.state.gameOver && half < MAX_HALF) {
      if (App.state.turn === 'player') {
        App.state = swapBattlePerspective(App.state);
        swapped = !swapped;
      }
      if (App.state.gameOver) break;
      var r = await runAiTurn(cfg.turnTimeoutMs);
      if (r === 'timeout') timeouts++;
      // Did any card of these kinds ever reach the field? placeLocation
      // (index.html:143456) writes state.player.hand directly and is only
      // reachable from the human UI — doAIStep has no 'location' branch at
      // all — so this is how we prove locations are dead under AI pilot.
      if (App.state.activeLocation) sawLocation = true;
      if (App.state.weather) sawWeather = true;
      if ((App.state.board || []).some(function (row) { return row.some(function (t) { return t && t.trap; }); })) sawTrap = true;
      half++;
    }
  } catch (e) { err = String((e && e.message) || e); }

  var go = App.state && App.state.gameOver;   // 'player' | 'ai' — names the WINNER
  var winner = null;
  if (go === 'player') winner = swapped ? 'B' : 'A';
  else if (go === 'ai') winner = swapped ? 'A' : 'B';

  // Cause of death, read from the engine's own log tail.
  var log = (App.state && App.state.log) || [];
  var tail = log.slice(-14).map(function (l) { return l && l.msg; }).filter(Boolean);
  var deckOut = tail.some(function (m) { return /no cards left to draw/.test(m); });

  var heroHp = {};
  (App.state.units || []).forEach(function (u) {
    if (u && u.isHero) {
      var side = (u.owner === 'player') ? (swapped ? 'B' : 'A') : (swapped ? 'A' : 'B');
      heroHp[side] = { hp: u.currentHp | 0, max: u.maxHp | 0, alive: !!u.alive };
    }
  });

  // Card economy. Everything not still in hand or deck was played, discarded
  // or destroyed — so `stranded` (hand at the end) is the closest honest read
  // on cards the deck could not use in the time the match lasted.
  var piles = {};
  ['player', 'ai'].forEach(function (o) {
    var side = (o === 'player') ? (swapped ? 'B' : 'A') : (swapped ? 'A' : 'B');
    var b = App.state[o] || {};
    piles[side] = {
      hand: (b.hand || []).length, deck: (b.deck || []).length,
      grave: (b.graveyard || []).length,
      handCosts: (b.hand || []).map(function (c) { return c ? (c.cost | 0) : 0; }),
      maxEnergy: b.maxEnergy | 0,
    };
    piles[side].played = 40 - piles[side].hand - piles[side].deck;
  });

  return {
    winner: winner, halfTurns: half, turnNumber: App.state.turnNumber | 0,
    unresolved: !winner, deckOut: deckOut, timeouts: timeouts, error: err,
    heroHp: heroHp, tail: tail, piles: piles,
    sawLocation: sawLocation, sawWeather: sawWeather, sawTrap: sawTrap,
    survivorsA: (App.state.units || []).filter(function (u) {
      var side = (u.owner === 'player') ? (swapped ? 'B' : 'A') : (swapped ? 'A' : 'B');
      return u && u.alive && !u.isHero && side === 'A';
    }).length,
    survivorsB: (App.state.units || []).filter(function (u) {
      var side = (u.owner === 'player') ? (swapped ? 'B' : 'A') : (swapped ? 'A' : 'B');
      return u && u.alive && !u.isHero && side === 'B';
    }).length,
  };
}

/* ── 5. Catalog export, so the Node side can build decks from the truth ── */
function catalog() {
  var out = {};
  var add = function (arr, kind) {
    (arr || []).forEach(function (c) {
      if (!c || !c.id) return;
      out[kind + ':' + c.id] = {
        id: c.id, name: c.name, type: c.type || kind, cost: c.cost | 0,
        elements: c.elements || (c.element ? [c.element] : []),
        stats: c.stats || null, passive: c.passive || null, flying: !!c.flying,
        restriction: (c.restriction != null) ? c.restriction : null,
      };
    });
  };
  add(UNIT_CARDS, 'unit'); add(SPELL_CARDS, 'spell'); add(TRAP_CARDS, 'trap');
  add(LOCATION_CARDS, 'location'); add(WEATHER_CARDS, 'weather');
  return { cards: out, deckSize: DECK_SIZE, maxCopies: MAX_COPIES_PER_CARD,
           handSize: STARTING_HAND_SIZE,
           heroes: (typeof getAllHeroes === 'function' ? getAllHeroes() : STARTER_HEROES)
             .map(function (h) { return { id: h.id, name: h.name, elements: h.elements || [] }; }) };
}

/* ── 6. Reference decks from the MAIN collection ───────────────────────────
   getGeneratedDeckForHero (index.html:71040) is the game's own themed
   40-card builder — 22 units / 8 spells / 4 traps / 3 locations / 3 weather,
   themed to the hero. It is what campaign and AI opponents are built from, so
   it is the fairest available stand-in for "a normal collection deck", and it
   is not something this harness invented. */
function generatedDeck(heroId) {
  return getGeneratedDeckForHero(heroId);
}

/* A tuned catalogue deck: the same 22/8/4/3/3 shape, but units chosen by
   stats-per-energy off the FULL built-in catalogue rather than by hero theme,
   capped at the real 3-copy limit. This is the "somebody who knows what they
   are doing built this from packs" upper bound. */
function tunedDeck() {
  var score = function (c) {
    var s = c.stats || {};
    return ((s.hp | 0) + Math.max(s.atk | 0, s.mag | 0) * 1.5 + ((s.def | 0) + (s.res | 0)) * 0.5)
           / Math.max(1, c.cost | 0);
  };
  var byScore = function (arr) {
    return arr.slice().sort(function (a, b) { return score(b) - score(a); });
  };
  var out = [];
  var take = function (arr, kind, n) {
    var i = 0;
    var pool = (kind === 'unit') ? byScore(arr) : arr.slice().sort(function (a, b) { return (a.cost | 0) - (b.cost | 0); });
    while (out.length < 40 && n > 0 && pool.length) {
      var c = pool[i % pool.length];
      var k = kind + ':' + c.id;
      var have = out.filter(function (x) { return x === k; }).length;
      if (have < MAX_COPIES_PER_CARD) { out.push(k); n--; }
      i++;
      if (i > pool.length * (MAX_COPIES_PER_CARD + 1)) break;
    }
  };
  take(UNIT_CARDS, 'unit', 22);
  take(SPELL_CARDS, 'spell', 8);
  take(TRAP_CARDS, 'trap', 4);
  take(LOCATION_CARDS, 'location', 3);
  take(WEATHER_CARDS, 'weather', 3);
  return out.slice(0, DECK_SIZE);
}

stubPresentation();
W.__wpd = {
  playMatch: playMatch, inspectDeck: inspectDeck, padLikeWarpath: padLikeWarpath,
  catalog: catalog, neutralise: neutralise, cardIdsOf: cardIdsOf,
  generatedDeck: generatedDeck, tunedDeck: tunedDeck,
  ready: true,
};
})();
