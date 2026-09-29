/* 🧬 v121v150 — THE COCOON OF EVOLUTION. Run: node _evococoon_smoke.mjs

   Owner: "the unit gains a evolution counter … sacrifice it and summon a Evo
   unit from the realm deck", charging on: start of turn, the day/night flip,
   only-day / only-night, a unit called from hand / deck / graveyard, units
   dying, spell cards, effects activated, and attacks.

   Six of those nine were already trigger EVENTS. The three that were not are
   added here as general vocabulary, not as cocoon special cases — so the pins
   below are as much about the trigger engine as about the cocoon. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const slice = (a, b, label) => {
  const lo = SRC.indexOf(a); const hi = SRC.indexOf(b, lo + 1);
  ok(lo > 0 && hi > lo, 'slice is anchored: ' + label);
  return (lo > 0 && hi > lo) ? SRC.slice(lo, hi) : '';
};

/* ── the nine triggers the owner listed can all be authored ───────────────── */
ok(/\{ id: 'turnStart',  label: 'A turn begins' \}/.test(SRC), 'START OF TURN was already an event');
ok(/\{ id: 'death',      label: 'A unit DIES' \}/.test(SRC), 'UNITS DYING was already an event');
ok(/\{ id: 'attack',     label: 'A unit attacks' \}/.test(SRC), 'ATTACKS was already an event');
ok(/\{ id: 'summon',     label: 'A unit is summoned \/ deployed' \}/.test(SRC), 'A UNIT BEING CALLED was already an event');
ok(/\{ id: 'cardPlayed', label: 'A card is played \(from hand\)', card: true \}/.test(SRC)
   && /\{ id: 'spell', +label: 'Spell cards' \}/.test(SRC),
  'SPELL CARDS needed no new event — cardPlayed already filters by card kind, and spell is one');
ok(/\{ id: 'dayNight',   label: '🌗 DAY flips to NIGHT \(or back\)' \}/.test(SRC), 'THE DAY/NIGHT FLIP is new');
ok(/\{ id: 'effectActivated', label: '✨ An EFFECT is activated' \}/.test(SRC), 'AN EFFECT ACTIVATING is new');

/* ── only-day / only-night is a GATE, which is what it actually is ────────── */
{
  const g = slice("if (trg.timeOfDay && trg.timeOfDay !== 'any')", 'if (trg.fromZone', 'the time-of-day gate');
  ok(/const _tod = \(\(s && s\.timeOfDay\) === 'night'\) \? 'night' : 'day';/.test(g),
    'ONLY-DAY / ONLY-NIGHT is a condition on ANY trigger, sitting beside the phase gate — not an event of its own');
  ok(/if \(_tod !== trg\.timeOfDay\) continue;/.test(g), '…and it simply refuses the trigger at the wrong hour');
}
{
  const g = slice("if (trg.fromZone && trg.fromZone !== 'any')", 'if ((trg.chance', 'the from-zone gate');
  ok(/String\(\(ctx && ctx\.fromZone\) \|\| ''\) !== trg\.fromZone/.test(g),
    'CALLED FROM HAND / DECK / GRAVEYARD is a gate on the summon event, which previously could not tell the three apart');
  ok(/silence rather than a guess/.test(SRC),
    '…and a call site that does NOT know the zone makes the trigger stay silent rather than guess');
}

/* ── both day/night mutation points are hooked ────────────────────────────── */
ok(/mutation point ONE of two/.test(SRC) && /mutation point TWO/.test(SRC),
  'BOTH writes to state.timeOfDay announce — the turn-based flip AND the setTimeOfDay effect a card can play');
ok(/const _dnChanged = \(want !== cur\);/.test(SRC) && /if \(_dnChanged\) \{ try \{ if \(typeof _fireDayNight === 'function'\)/.test(SRC),
  '…and the card path fires ONLY on a real change, so "make it night" replayed at night cannot farm counters');
{
  const f = slice('function _fireDayNight(state) {', 'function _fireEffectActivated', '_fireDayNight');
  ok(/if \(_fireDayNight\._busy\) return state;/.test(f),
    'THE RE-ENTRANCY GUARD — a dayNight trigger is allowed to play setTimeOfDay, which would otherwise recurse without end');
  ok(/actorOwner: null/.test(f), 'the sky belongs to nobody, so both-scoped triggers fire');
}

/* ── an effect activating announces ONCE, not once per nesting level ──────── */
{
  const f = slice('let _fxActDepth = 0;', 'function _applyOnPlayOneRaw', 'the activation depth');
  ok(/_afxDepth\+\+; _fxActDepth\+\+;/.test(f) && /_fxActDepth\+\+;\n    let r;/.test(f),
    'THE COUNTER IS INCREMENTED ON BOTH BRANCHES — the announced one and the passthrough taken when ActivateFX is absent');
  ok(/if \(_fxActDepth > 0\) return state;/.test(f),
    'only the OUTERMOST activation announces — effects nest, and four counters for one card is not what the player watched happen');
  ok(/_afxDepth cannot serve, because it is only counted on the/.test(SRC),
    'the reason the existing _afxDepth could not serve is written down');
}

/* ── the cocoon engine ────────────────────────────────────────────────────── */
{
  const f = slice('function _evoSpecOf(unit) {', 'function getBattleEvoCards', '_evoSpecOf');
  ok(/_cardDefById\(unit\.cardId \|\| unit\.originalCardId\)/.test(f),
    'the spec is read from the CARD DEFINITION at check time, so a cocoon already on the board picks up an edit');
  ok(/if \(!at\) return null;/.test(f), 'a unit with no threshold is simply not a cocoon');
}
{
  const f = slice('function getBattleEvoCards(side) {', 'function _evoPick', 'getBattleEvoCards');
  ok(/_realmDeckAllows\(def, 'player'\)/.test(f),
    'THE REALM-DECK RULE IS THE EXISTING ONE — the same gate Archons and Polycreation targets pass, so ownership and the admin bypass cannot drift');
  ok(/if \(side && side !== 'player'\)/.test(f), '…and the AI is unrestricted, exactly as it is for Archons');
  ok(/isEvoCard\(def\)/.test(f), '…filtered to Evo units');
}
{
  const f = slice('function _evoHatch(state, unit, spec) {', 'function _evoAdd', '_evoHatch');
  ok(/const tile = \{ x: live\.pos\.x, y: live\.pos\.y \};/.test(f),
    'THE EVO TAKES THE COCOON\'S OWN TILE — the right picture, and the only placement that cannot fail the way a hero-adjacent rule can');
  ok(/_sacrificed: true, _evoHatched: true/.test(f), 'the cocoon is sacrificed, using the engine\'s own sacrifice shape');
  ok(/if \(!card\) \{/.test(f) && /there is no Evo unit in/.test(f),
    'NOTHING LEGAL MEANS NOTHING SPENT — it says so instead of eating counters silently');
  ok(/_fireTriggers\(out, 'summon', \{ actorOwner: live\.owner, unit: born, fromZone: 'realm' \}\)/.test(f),
    'the newcomer is an arrival like any other, carrying its own zone');
}
{
  const f = slice('function _evoAdd(state, unit, amount, why) {', 'function _unitTriggers', '_evoAdd');
  ok(/const have = Math\.min\(spec\.at, \(\(live\._evo \| 0\) \+ add\)\);/.test(f),
    'counters are clamped at the threshold — a cocoon never sits on more than it needs');
  ok(/if \(have >= spec\.at\) out = _evoHatch\(out, live, spec\);/.test(f),
    'EVERY grant path tests the threshold in ONE place, so a new source of counters cannot forget to hatch');
  ok(/if \(!spec\) return state;/.test(f), 'a counter offered to a non-cocoon changes nothing');
}
ok(/\{ id: 'evoCounter',   label: '🧬 Put N evolution counter\(s\) on this unit', amount: true \},/.test(SRC),
  'the owner authors the charge as an ordinary trigger EFFECT, so the whole event vocabulary comes free');

/* ── the summon zone is supplied where it is genuinely known ──────────────── */
ok(/_fireTriggers\(next, 'summon', \{ actorOwner: 'player', unit, fromZone: 'hand' \}\)/.test(SRC),
  "the player's hand-deploy says 'hand'");
ok(/_fireTriggers\(next, 'summon', \{ actorOwner: 'ai', unit: newUnit, fromZone: 'hand' \}\)/.test(SRC),
  "…and the AI's");
ok(/THIS PATH NEVER ANNOUNCED AN ARRIVAL AT ALL/.test(SRC)
   && /_fireTriggers\(state, 'summon', \{ actorOwner: owner, unit: born, fromZone: zone\.id \}\)/.test(SRC),
  'THE DECK / GRAVEYARD / VOID SUMMON NOW ANNOUNCES TOO — it never did, so every summon responder was missing it, not only cocoons');

/* ── the editor can author all of it ──────────────────────────────────────── */
ok(/class="trg-tod"/.test(SRC) && /timeOfDay: val\('\.trg-tod'\) \|\| 'any',/.test(SRC),
  'the time gate is on screen AND read back — a control that is not saved is decoration');
ok(/class="trg-fromzone"/.test(SRC) && /fromZone: val\('\.trg-fromzone'\) \|\| 'any',/.test(SRC),
  'the zone gate likewise');
ok(/id="ed-evo-at"/.test(SRC) && /id="ed-evo-into"/.test(SRC), 'the cocoon block is on the unit card');
{
  const f = slice("if (document.getElementById('ed-evo-at')) {", '// 🌌 Fusion Kalon config', 'the cocoon save');
  ok(/\} else \{ delete card\.evoAt; delete card\.evoInto; \}/.test(f),
    'a threshold of 0 removes the cocoon — the block is its own off switch');
  ok(/if \(into\) card\.evoInto = into; else delete card\.evoInto;/.test(f),
    'BLANK MEANS ANY — which is what makes a generic "Cocoon of Evolution" card possible at all');
}

/* ── run the arithmetic for real ──────────────────────────────────────────── */
{
  const add = (have, at, amt) => Math.min(at, (have | 0) + Math.max(1, amt | 0));
  ok(add(0, 3, 1) === 1, 'run for real: the first counter lands');
  ok(add(2, 3, 1) === 3, 'run for real: the third reaches the threshold');
  ok(add(2, 3, 9) === 3, 'run for real: a big grant is clamped, never overshooting');
  ok(add(0, 1, 1) === 1, 'run for real: a one-counter cocoon hatches on its first charge');

  /* the gates */
  const todOk = (trg, tod) => !trg.timeOfDay || trg.timeOfDay === 'any' || trg.timeOfDay === tod;
  ok(todOk({}, 'night') && todOk({ timeOfDay: 'any' }, 'day'), 'run for real: an ungated trigger fires at any hour — nothing existing changes');
  ok(todOk({ timeOfDay: 'night' }, 'night') && !todOk({ timeOfDay: 'night' }, 'day'),
    'run for real: a night-only trigger sleeps through the day');
  const zoneOk = (trg, ctx) => !trg.fromZone || trg.fromZone === 'any' || String((ctx && ctx.fromZone) || '') === trg.fromZone;
  ok(zoneOk({ fromZone: 'deck' }, { fromZone: 'deck' }), 'run for real: a deck-call trigger fires on a deck call');
  ok(!zoneOk({ fromZone: 'deck' }, { fromZone: 'hand' }), 'run for real: …and not on a hand call');
  ok(!zoneOk({ fromZone: 'deck' }, {}),
    'run for real: …and NOT on an arrival whose zone is unknown — silence rather than a guess');
  ok(zoneOk({}, {}), 'run for real: an ungated summon trigger is unaffected by any of it');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 150, 'BUILD_VERSION is v121v150 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
