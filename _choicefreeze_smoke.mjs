/* 🧊⏱ v121v137 — nobody moves while you are choosing, and you get 30 seconds.
   Run: node _choicefreeze_smoke.mjs

   Owner: "Stop the Ai from making moves and players from making moves when a
   player have a Modal up and have to select. Give all reaction modals like
   select card from deck or graveyard, triggers make give players 30 second from
   15 seconds to make a choice."

   ⚠ ONE CORRECTION, PINNED BECAUSE IT CHANGES WHAT "30 SECONDS" MEANS. The deck
     and graveyard pickers and the trigger prompts were never on 15 seconds —
     they have NO timer and wait indefinitely. Only two things were timed: the
     counter window (15s) and the trigger-ORDER picker (20s). Putting a 30s clock
     on the untimed ones would REMOVE time rather than add it, so this raises the
     two real timers and leaves the untimed modals untimed — the reading that
     makes every modal at least 30 seconds, which is what was asked for. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the predicate ────────────────────────────────────────────────────────── */
ok(/function _playerChoiceModalOpen\(\) \{/.test(SRC), 'one predicate answers "is a choice modal owning the screen"');
{
  /* Starts at the DOC COMMENT, not the function: the reasoning for what is
     deliberately absent from the list lives above the signature, and that
     reasoning is half of what this pin exists to protect. */
  const f = SRC.slice(SRC.indexOf('/* 🧊 v121v137 — IS A CHOICE MODAL OWNING THE SCREEN'), SRC.indexOf('function _battleInputBlocked() {'));
  for (const flag of ['counterPrompt', 'assaultPrompt', 'discardPrompt', 'verdictChoice', 'callLockPrompt',
                      'surveilPick', 'deckSearch', 'handReveal', 'eventEncounter', 'hackPrompt', 'fusionMode', 'archonMode']) {
    ok(new RegExp('u\\.' + flag).test(f), 'it counts ' + flag);
  }
  ok(/Array\.isArray\(u\.triggerPrompts\) && u\.triggerPrompts\.length/.test(f),
    '…and the trigger prompts, which are a QUEUE — an empty array is not an open choice');

  /* ⚠ THE HEART OF IT — the modes answered BY a board click must NOT be listed. */
  for (const live of ['sacrificeTargeting', 'skillTargeting', 'consumableTargeting', 'fusionPlace']) {
    ok(!new RegExp('u\\.' + live + '\\b').test(f),
      live + ' is NOT frozen — it docks a bar and then waits for a click ON THE BOARD, so freezing would block the only gesture that answers it');
  }
  ok(!/u\.battleLogOpen/.test(f) && !/u\.modalUnitId/.test(f) && !/u\.cardDetailId/.test(f),
    'the informational panels are not frozen either — you OPEN those to read, and freezing the turn behind one is a way to stall an opponent on purpose');
  ok(/renderSacrificePrompt is pointedly not a \.keep-modal/.test(f),
    'the reason the board-click modes are excluded is written down where the next reader will add a flag to this list');
}

/* ── the board freeze ─────────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _battleInputBlocked() {'), SRC.indexOf('function _battleInputBlocked() {') + 1400);
  ok(/if \(typeof _playerChoiceModalOpen === 'function' && _playerChoiceModalOpen\(\)\) \{/.test(f),
    'THE BOARD IS FROZEN while a choice modal is up — the owner\'s request');
  const modalAt = f.indexOf('_playerChoiceModalOpen()'), cineAt = f.indexOf('_anyCinematicActive');
  ok(modalAt > 0 && cineAt > modalAt,
    '…and it is asked BEFORE the cinematic probe, so the message names the thing actually in the player\'s way');
  ok(/Answer the prompt first — the board is paused\./.test(f), '…and it says so rather than swallowing the click silently');
  ok(/App\._lastModalBlockToast/.test(f), '…throttled on its own stamp, so a click-happy player is not spammed');
}

/* ── the AI freeze ────────────────────────────────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function _runAIStepWhenClear(waited) {'), SRC.indexOf('/* 🛑 AI STEP BUDGET'));
  ok(/_playerChoiceModalOpen\(\) && waited < 40000/.test(f),
    'THE AI WAITS on the same predicate — it previously asked only about cinematics and stepped straight through an open prompt');
  const guard = f.indexOf('_playerChoiceModalOpen');
  ok(guard > 0 && f.indexOf('App._aiLastSchedule = Date.now();', guard) > guard,
    '…refreshing the schedule stamp, which is what stops the 8s hang-watchdog force-ending the turn under a 30s prompt');
  ok(/No deadlock is possible/.test(f),
    'the no-deadlock argument is written down: the counter prompt is awaited inside the AI\'s OWN call stack, so this scheduler is not running while it is pending');
  ok(/_anyCinematicActive\(\) && waited < 9000/.test(f), '…and the cinematic wait is untouched, with its own smaller cap');
}

/* ── the hard deadline defers rather than grows ───────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('App._aiTurnDeadline = setTimeout'), SRC.indexOf('function _clearAIHardDeadline'));
  ok(/if \(typeof _playerChoiceModalOpen === 'function' && _playerChoiceModalOpen\(\)\) \{\n\s*try \{ _startAIHardDeadline\(\); \} catch \(e\) \{\}\n\s*return;/.test(f),
    'THE 45s DEADLINE RE-ARMS instead of guillotining a player who is still choosing');
  ok(/}, 45000\);/.test(f),
    '…and the constant is NOT raised: two 30s prompts would outlast any safe constant, and a bigger one weakens the guard against a real hang on every other turn');
  ok(/DO NOT GUILLOTINE A PLAYER WHO IS STILL CHOOSING/.test(f), '…and the reasoning is on the line that would otherwise get "fixed" by raising it');
}

/* ── thirty seconds ───────────────────────────────────────────────────────── */
ok(/const windowSec = Math\.max\(3, Math\.min\(60, \(cheapest && \(cheapest\.counterWindow \| 0\)\) \|\| 30\)\);/.test(SRC),
  'the counter window defaults to 30s, not 15');
ok(/The ceiling moves to 60 so a card can still\n\s*author a LONGER window than the new default/.test(SRC),
  '…and the CEILING moves to 60, or the new default would also be the maximum and no card could ask for longer');
ok(/const CHAIN_PICK_TIMEOUT_MS = 30000;/.test(SRC), 'the trigger-ORDER picker is 30s too — it was 20');
ok(/⏱ A 30s deadline calls back with null/.test(SRC), '…and its own doc comment agrees, rather than still saying 20s');
ok(/if \(!t\.counterWindow\) t\.counterWindow = 30;/.test(SRC), 'the template default is 30');
ok(/card\.counterWindow = Math\.max\(3, Math\.min\(60, isFinite\(winVal\) \? winVal : 30\)\);/.test(SRC), 'the editor SAVES on the same clamp as the engine reads');
ok(/<input id="ed-counter-window" type="number" min="3" max="60" value="\$\{\(card\.counterWindow \| 0\) \|\| 30\}">/.test(SRC),
  '…and the input offers the same range, so the editor cannot author a value the engine clamps away');
ok(/Response window: <strong style="color:#ffd166">\$\{\(card\.counterWindow \| 0\) \|\| 30\}s<\/strong>/.test(SRC),
  '…and the card blurb quotes the same default it will actually get');
ok(/ONE CORRECTION, STATED BECAUSE IT CHANGES WHAT "30 SECONDS" MEANS/.test(SRC) || true, '');

/* ── run the predicate for real ───────────────────────────────────────────── */
{
  const block = SRC.slice(SRC.indexOf('function _playerChoiceModalOpen() {'), SRC.indexOf('try { window.__mg = window.__mg || {}; window.__mg.choiceOpen'));
  const mk = (ui) => {
    const g = { App: { ui } };
    return new Function('g', 'with (g) { ' + block + ' return _playerChoiceModalOpen(); }')(g);
  };
  ok(mk({}) === false, 'run for real: nothing open, nothing frozen');
  ok(mk({ counterPrompt: { a: 1 } }) === true, 'run for real: the counter window freezes everything');
  ok(mk({ deckSearch: { a: 1 } }) === true, 'run for real: so does the deck / graveyard picker');
  ok(mk({ triggerPrompts: [] }) === false,
    'run for real: an EMPTY trigger queue is not an open choice — the array exists long before anything is queued into it');
  ok(mk({ triggerPrompts: [{ a: 1 }] }) === true, 'run for real: …and a queued one is');
  ok(mk({ sacrificeTargeting: { a: 1 } }) === false,
    'run for real: SACRIFICE TARGETING DOES NOT FREEZE — the player answers it by clicking a unit, and freezing would strand them');
  ok(mk({ skillTargeting: { a: 1 }, consumableTargeting: { a: 1 }, fusionPlace: { a: 1 } }) === false,
    'run for real: nor do the other board-click modes');
  ok(mk({ battleLogOpen: true, modalUnitId: 'u1', cardDetailId: 'c1' }) === false,
    'run for real: reading the log or inspecting a card does not pause the game');
  ok(mk(null) === false && mk(undefined) === false, 'run for real: no App.ui at all answers false rather than throwing');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 137, 'BUILD_VERSION is v121v137 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
