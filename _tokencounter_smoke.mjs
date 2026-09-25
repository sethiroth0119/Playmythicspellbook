/* 🔵🚫 v121v147 — a card already ON THE FIELD can spend its counters to negate,
   and the modal actually asks. Run: node _tokencounter_smoke.mjs

   Owner: "This do not work no modal appears to ask do the player want to negate
   when something happens. It should be a counter trigger type before the action
   happen if accurate ask player do they want to respond."

   ⚠ WHY NO MODAL EVER APPEARED. tryPromptCounter gathered candidates from
     exactly TWO places: the player's HAND (filtered to counter-type cards that
     declare a counterTriggers array) and the GRAVEYARD. A card carrying a
     🔵 Counters block with canCounter:true and counterTargets:[…] is NEITHER —
     it is on the field, it is an ordinary unit, and counterTargets is a
     DIFFERENT FIELD from counterTriggers. The engine half was already complete:
     MythicCounters.canPayWithCounters answers the whole question, but it was
     only ever consulted as an alternative way to AFFORD a card that had already
     passed the hand filter, so a field card could never reach it. The feature
     had no path to the prompt at all. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const FX = readFileSync('./public/src/battle/effects.js', 'utf8').replace(/\r\n/g, '\n');

/* ── the engine half was already right ────────────────────────────────────── */
ok(/canPayWithCounters: function \(state, owner, card, trigger\) \{/.test(FX),
  'the engine already answered "can this card negate by removing counters" — this release did not change how counters are spent');
ok(/if \(trigger && tok\.counterTargets\.length && tok\.counterTargets\.indexOf\(trigger\) < 0\) return false;/.test(FX),
  '…including the counterTargets match, with an empty list meaning "anything it can already answer"');
ok(/payForCounter: function \(state, owner, card\) \{/.test(FX), '…and already knew how to spend them');

/* ── the third candidate source ───────────────────────────────────────────── */
ok(/function _fieldCounterHolders\(state, trigger\) \{/.test(SRC), 'there is a THIRD candidate source: cards on the field');
{
  /* from the DOC COMMENT, not the signature — the reasoning lives above it, and
     that reasoning is half of what this pin protects. */
  const f = SRC.slice(SRC.indexOf('v121v147 — CARDS ALREADY ON THE FIELD'), SRC.indexOf('async function tryPromptCounter'));
  ok(/if \(!_counterPayableWithTokens\(state, 'player', card, trigger\)\) return;/.test(f),
    'each candidate is filtered by the ENGINE\'s own question, not a re-derived copy of it');
  ok(/if \(!u \|\| !u\.alive \|\| u\.owner !== 'player'\) continue;/.test(f),
    'only living units the player controls — an enemy unit\'s counters are not mine to spend');
  ok(/permanentsFor\(state, 'player'\)/.test(f),
    "…and the card-shaped permanents, asked of the engine's own permanentsFor rather than re-listed here");
  ok(/keeps this from drifting away from where counters can actually sit/.test(f),
    'the reason it asks rather than re-derives is written down');
  ok(/seen\[refId\]/.test(f), 'each holder is offered once');
}
ok(/const tokenHolders = _fieldCounterHolders\(state, opts\.trigger\);/.test(SRC), 'the prompt gathers them');
/* 🔴 THIS USED TO PIN THE GUARD'S EXACT TEXT — all three terms, in order. That
   made it go red the moment a FOURTH candidate source (set traps in 'counter'
   mode, v121v166) was added to the same guard, even though the property it
   cares about was untouched. A check pinned to today's spelling goes red when
   the product deliberately changes and green when the property quietly breaks;
   both directions are wrong. So: find the guard, and assert that tokenHolders
   is one of the sources it waits on. It still goes red if the term is dropped,
   which is the only way a field card alone stops opening the window. */
{
  const guard = /if \(([^)]*?)\) return false;\n  \/\/ Window length from the cheapest hand counter/.exec(SRC)
             || /if \(candidates\.length === 0 &&([\s\S]{0,300}?)\) return false;/.exec(SRC);
  ok(!!guard, 'the early-return guard is found');
  if (guard) {
    ok(/tokenHolders\.length === 0/.test(guard[0]),
       '…and the window OPENS for a field card alone — before, a player holding a fully-charged counter card saw nothing at all');
    ok(/candidates\.length === 0/.test(guard[0]) && /graveReactions\.length === 0/.test(guard[0]),
       '…without having dropped the hand or graveyard sources on the way past');
    ok(!/\|\|/.test(guard[0]),
       'every source must be empty to skip the window — one `||` in here and a player with counters is never asked');
  }
}
ok(/_tokenHolders: tokenHolders,/.test(SRC), '…and they travel on the prompt state');

/* ── the prompt renders them ──────────────────────────────────────────────── */
ok(/data-counter-pick="token:\$\{escapeHtml\(t\.ref\)\}"/.test(SRC), 'each is a pickable button');
{
  const f = SRC.slice(SRC.indexOf('cp._tokenHolders'), SRC.indexOf('cp._tokenHolders') + 1200);
  ok(/🚫 Remove \$\{t\.cost\}/.test(f), 'the button says what it costs');
  ok(/instead of energy/.test(f), '…and that it is paid in counters rather than energy');
  ok(/\$\{escapeHtml\(t\.where \|\| 'on the field'\)\}/.test(f), '…and where the card is, so two copies are told apart');
}

/* ── and the pick resolves ────────────────────────────────────────────────── */
ok(/if \(String\(cardInstanceId\)\.indexOf\('token:'\) === 0\) \{ _battleActivateTokenCounter\(cardInstanceId\.slice\(6\)\); return; \}/.test(SRC),
  'the click is routed — _battleActivateCounter only ever looked in the HAND, so even an offered field card had nothing to resolve it');
{
  /* from the DOC COMMENT, for the same reason. */
  const f = SRC.slice(SRC.indexOf('v121v147 — RESOLVE A FIELD CARD'), SRC.indexOf('function _battleActivateCounter(cardInstanceId) {'));
  ok(/\(s\.units \|\| \[\]\)\.find\(u => u && u\.alive && u\.owner === 'player' && String\(u\.id\) === id\)/.test(f),
    'the card is re-resolved from LIVE state, not a captured object');
  ok(/the prompt is a timed window and the board can change under\n\s*it/.test(f),
    '…and the reason is written down: the unit may have died while the player was deciding');
  ok(/if \(!_counterPayableWithTokens\(s, 'player', card, trigger\)\) \{/.test(f),
    'affordability is re-checked against live state — the counters could have been spent elsewhere since the prompt was drawn');
  ok(/window\.MythicCounters\.payForCounter\(s, 'player', card\)/.test(f),
    'payment goes through the SAME call the hand path uses, so counters are spent by one piece of code');
  ok(/prompt\.resolve\(true\)/.test(f), '…and answering the window negates the action, like every other pick');
  /* ⚠ tests the CALL, not the word: the source comment deliberately names
     'counterFire' to explain why it is not used, so a bare word test would fail
     on the very note that documents the fix. */
  ok(/playSfx\('abilityCast'\)/.test(f) && !/playSfx\('counterFire'\)/.test(f),
    "the sound is a REAL id — 'counterFire', the obvious name, is not in the SFX table and playSfx would have failed silently");
}

/* ── run the gating rule for real ─────────────────────────────────────────── */
{
  /* the engine's own predicate, transcribed */
  const canPay = (tok, held, trigger) => {
    if (!tok || !tok.canCounter) return false;
    if (trigger && tok.counterTargets.length && tok.counterTargets.indexOf(trigger) < 0) return false;
    return held >= tok.counterCost;
  };
  const tok = { canCounter: true, counterCost: 2, counterTargets: ['spell', 'summon'] };
  ok(canPay(tok, 2, 'spell') === true, 'run for real: enough counters and a listed trigger → offered');
  ok(canPay(tok, 1, 'spell') === false, 'run for real: too few counters → not offered');
  ok(canPay(tok, 4, 'attack') === false, 'run for real: an UNLISTED trigger → not offered, however many are held');
  ok(canPay({ canCounter: true, counterCost: 1, counterTargets: [] }, 1, 'attack') === true,
    'run for real: an EMPTY target list answers anything — the authored "leave all unticked" case in the editor');
  ok(canPay({ canCounter: false, counterCost: 1, counterTargets: [] }, 9, 'spell') === false,
    'run for real: the card must actually declare it can be spent to counter');
  ok(canPay(null, 9, 'spell') === false, 'run for real: a card with no counter block is never offered');
  /* the window-opens rule */
  const opens = (hand, grave, field) => !(hand === 0 && grave === 0 && field === 0);
  ok(opens(0, 0, 1) === true, 'run for real: A FIELD CARD ALONE OPENS THE WINDOW — the whole bug was that it did not');
  ok(opens(0, 0, 0) === false, 'run for real: nothing to offer still opens nothing');
  ok(opens(1, 0, 0) === true && opens(0, 1, 0) === true, 'run for real: the hand and grave sources are unchanged');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 147, 'BUILD_VERSION is v121v147 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
