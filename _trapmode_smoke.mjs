/* ============================================================================
 * _trapmode_smoke.mjs — 🪤 TRAP MODES gate.          node _trapmode_smoke.mjs
 * ----------------------------------------------------------------------------
 * Three ways to spring a trap: walked on, flipped up by its owner, or flipped
 * in answer to an enemy action.
 *
 * 🔴 WHY THIS SUITE PARSES INSTEAD OF GREPPING. The first version of this
 * feature was written one line too early and landed INSIDE getCardRange's body.
 * That is valid JavaScript. Both syntax gates passed. `grep 'const TRAP_MODES'`
 * found it. Every regex you would naturally write to check "the vocabulary
 * exists" was satisfied — and TRAP_MODES was a function-local const that ceased
 * to exist the moment getCardRange returned, so the Forge's trap-mode dropdown
 * rendered with zero options and nothing anywhere said why.
 * A text search cannot tell you what SCOPE something is in. So this file parses
 * the script with acorn and asks the only question that matters: is this
 * declaration a top-level statement?
 *
 * 🟢 AND IT CARRIES A NEGATIVE CONTROL. Four separate checks in this repo have
 * been caught reporting "nothing wrong" when what they meant was "I checked
 * nothing" — one threw before asserting, two ENOENT'd on a moved drive, one
 * tested a button nothing called. The defence is cheap and it is to break the
 * check on purpose the day you write it: `topLevelNames` below is run against a
 * snippet whose answer is known, and this suite FAILS if it comes back happy.
 * ==========================================================================*/
import fs from 'fs';
import * as acorn from 'acorn';

const SRC = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

let fails = 0;
const ok = (n, c, extra = '') => { console.log((c ? '  PASS ' : '  FAIL ') + n + (c ? '' : '   <-- ' + extra)); if (!c) fails++; };

/* ── the walker: every name DECLARED as a top-level statement ────────────── */
function topLevelNames(code) {
  const out = new Set();
  let prog;
  try {
    prog = acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
  } catch (e) { return null; }
  for (const node of prog.body) {
    if (node.type === 'FunctionDeclaration' && node.id) out.add(node.id.name);
    else if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) if (d.id && d.id.type === 'Identifier') out.add(d.id.name);
    } else if (node.type === 'ClassDeclaration' && node.id) out.add(node.id.name);
  }
  return out;
}

/* ── 🟢 NEGATIVE CONTROL. Run first, because every assertion below is worth
   exactly nothing if the walker answers "yes" to everything. ─────────────── */
{
  const probe = topLevelNames('const OUTER = 1;\nfunction f(){ const INNER = 2; function g(){} }\n');
  ok('negative control: the walker parses at all', !!probe, 'acorn threw on a three-line snippet — nothing below this line ran');
  if (probe) {
    ok('negative control: it SEES a top-level const', probe.has('OUTER'));
    ok('negative control: it REFUSES a const nested in a function', !probe.has('INNER'),
       'the walker says yes to everything, so every scope assertion in this file is meaningless');
    ok('negative control: it REFUSES a nested function declaration', !probe.has('g'));
  }
}

/* ── find the script that carries the trap vocabulary ────────────────────── */
const re = /<script\b((?![^>]*\bsrc=)[^>]*)>([\s\S]*?)<\/script>/gi;
let host = null, m;
while ((m = re.exec(SRC)) !== null) {
  if (m[2].indexOf('const TRAP_MODES') >= 0) { host = m[2]; break; }
}
ok('the trap vocabulary lives in an inline script', !!host);

const names = host ? topLevelNames(host) : null;
ok('that script parses', !!names, 'acorn rejected the host script — the scope assertions below did not run');

if (names) {
  /* 🔴 THE REGRESSION THIS FILE EXISTS FOR. */
  ok('TRAP_MODES is declared at TOP LEVEL', names.has('TRAP_MODES'),
     'it parsed and it exists, but it is nested inside a function — the Forge dropdown will render empty and nothing will throw');
  ok('_trapMode is top-level', names.has('_trapMode'));
  ok('_trapCanFlip is top-level', names.has('_trapCanFlip'));
  ok('_trapFlipVictim is top-level', names.has('_trapFlipVictim'));
  ok('_trapFlipConfirm is top-level', names.has('_trapFlipConfirm'));
  ok('_trapSpringManually is top-level', names.has('_trapSpringManually'));
  ok('_trapManualFlipAt is top-level', names.has('_trapManualFlipAt'));
  ok('_battleActivateTrapResponse is top-level', names.has('_battleActivateTrapResponse'));
}

/* ── the ladder, and the default that must not move ──────────────────────── */
{
  /* Scoped to the ARRAY, not the file. 'counter' is also a card type, an effect
     kind and a Forge filter option, so a file-wide count of `{ id: 'counter',`
     was passing on matches that had nothing to do with traps — green for the
     wrong reason, which is the same defect as red for the wrong reason. */
  const arr = /const TRAP_MODES = \[([\s\S]*?)\n\];/.exec(SRC);
  ok('the TRAP_MODES array is found', !!arr);
  if (arr) {
    const ids = (arr[1].match(/id: '(\w+)'/g) || []).map(x => x.slice(5, -1));
    ok('there are exactly three modes, in ladder order',
       ids.join(',') === 'walk,flip,counter', 'got: ' + ids.join(','));
  }
}
ok("'walk' is the fallback for anything unrecognised",
   /const m = String\(\(card && card\.trapMode\) \|\| 'walk'\);[\s\S]{0,120}\? m : 'walk';/.test(SRC),
   'every trap authored before this field exists has no trapMode — it must keep behaving exactly as it did');
ok("the editor stores 'walk' as ABSENT rather than writing it out",
   /_trapMode\(\) reads that as 'walk'/.test(SRC),
   'writing the default would change the bytes of cards nobody edited');

/* ── "face-down for a turn" ──────────────────────────────────────────────── */
ok('a trap stamps the turn it was set', /trap: \{ card, owner: 'player', setTurn: \(s\.turnNumber \| 0\)[,} ]/.test(SRC));
/* v173: a counter or flip trap is SET without paying and marked costDeferred
   (owner: "Play should set it, it do not have me play the cost"). A walk-on
   trap still pays at set, since nobody can be asked when the opponent steps on it. */
ok('a counter/flip trap defers its cost; a walk-on trap does not',
   /const _deferCost = _trapMode\(card\) !== 'walk' && !_costIsEmpty\(_playCostOf\(card\)\);/.test(SRC)
   && /if \(!_deferCost && _interceptCardCost\(card, /.test(SRC));
ok('…and cannot be flipped on that same turn', /return !set \|\| now > set;/.test(SRC),
   'without this a flippable trap is an expensive instant — set it and spring it in one breath');
ok("'walk' can never be flipped by hand", /if \(_trapMode\(trapRec\.card\) === 'walk'\) return false;/.test(SRC));
ok('only the owner may flip it', /if \(trapRec\.owner !== side\) return false;/.test(SRC));

/* ── the manual flip ─────────────────────────────────────────────────────── */
const vic = /function _trapFlipVictim\(s, pos, side\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_trapFlipVictim found', !!vic);
if (vic) {
  ok('the nearest-enemy pick breaks ties deterministically',
     /d === bestD && best && String\(u\.id\) < String\(best\.id\)/.test(vic[0]),
     'two equidistant enemies must resolve identically on every machine replaying this match');
  ok('…and it skips vanished units', /isVanished/.test(vic[0]));
}
const flip = /async function _trapManualFlipAt\(x, y\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_trapManualFlipAt found', !!flip);
if (flip) {
  ok('no enemy on the board REFUSES the flip rather than fizzling the card',
     /the trap stays set/.test(flip[0]),
     'consuming a card to do nothing reads as a bug, not a rule');
  ok('🔴 the board is RE-READ after the confirm is awaited',
     /const live = App\.state;/.test(flip[0]) && /const rec2/.test(flip[0]),
     'anything can happen while a modal is open — springing against the pre-await snapshot is how a card is consumed twice');
  ok('…and the victim is re-picked from that live state', /_trapFlipVictim\(live/.test(flip[0]));
}
ok('a flipped trap resolves through applyTrapToUnit, not a second copy of it',
   /return applyTrapToUnit\(s, victim, onBoard\);/.test(SRC),
   'a parallel implementation drifts from the walked-on path the first time either is edited');
ok('…and it hands over the record that is ON THE BOARD',
   /const onBoard = \(s\.board\[pos\.y\]/.test(SRC),
   'applyTrapToUnit matches the tile by identity (t.trap === trap) — a copy would never be cleared');

/* ── the confirm modal shows the card ────────────────────────────────────── */
const conf = /function _trapFlipConfirm\(card, why\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_trapFlipConfirm found', !!conf);
if (conf) {
  ok('the modal shows the CARD ART, not an emoji', /_abilityArtBest\(card && card\.id, true\)/.test(conf[0]));
  ok('…and it goes through showGameConfirm', /showGameConfirm\(\{/.test(conf[0]));
}

/* ── counter mode hangs off the window that already exists ───────────────── */
ok('counter-mode traps are gathered as a fourth counter source', /const trapResponders = \[\];/.test(SRC));
ok('…and the window still opens when traps are the ONLY responder',
   /trapResponders\.length === 0\) return false;/.test(SRC),
   'left out of this guard, a player with a set counter trap and an empty hand is never asked');
ok('…and they ride on the prompt', /_trapResponders: trapResponders/.test(SRC));
ok('…and render with their art', /data-counter-pick="trap:\$\{escapeHtml\(t\.ref\)\}"/.test(SRC));
ok('…and the pick is routed', /indexOf\('trap:'\) === 0\) \{ _battleActivateTrapResponse/.test(SRC));
const resp = /function _battleActivateTrapResponse\(ref\) \{[\s\S]*?\n\}/.exec(SRC);
ok('_battleActivateTrapResponse found', !!resp);
if (resp) {
  /* 🔴 v173 OWNER RULING, replacing "a trap does NOT negate": for the COUNTER
     mode, "if it is yes it negate and destroy". The old worry (every trap
     becoming a negation card) is held by scope: only a counter-mode trap is
     ever offered in the window, and this function refuses any other. */
  ok('a counter-mode trap answering the window NEGATES (resolves TRUE)', /_finish\(true\)/.test(resp[0]));
  ok('…only a counter-mode trap reaches it',
     /_trapMode\(rec\.card\) !== 'counter'/.test(resp[0])
     && /if \(!tr \|\| _trapMode\(tr\.card\) !== 'counter'\) continue;/.test(SRC),
     'widening this is exactly the "every trap negates" failure');
  ok('…the cost is paid on use, and a cancel declines with nothing spent',
     /_trapPayDeferredInteractive\(rec\)/.test(resp[0]) && /if \(!paid\) \{ _finish\(false\); return; \}/.test(resp[0]));
  ok('the victim is the unit that ACTED', /prompt\._sourceId/.test(resp[0]));
  /* the nearest-enemy fallback is gone ON PURPOSE: an answer strikes the unit
     that acted or nobody; with no acting unit it still negates */
  ok('…and no bystander is struck when there is no acting unit', !/_trapFlipVictim\(/.test(resp[0]));
  ok('the trap is re-checked against LIVE state, not the prompt snapshot',
     /if \(!_trapCanFlip\(rec, s, 'player'\)/.test(resp[0]),
     'the window is timed and the board moves under it');
}

/* ── the click path ──────────────────────────────────────────────────────── */
ok('a click on your own ready trap offers the flip',
   /if \(_trapCanFlip\(_tt, s, 'player'\)\) \{ _trapManualFlipAt\(x, y\); return; \}/.test(SRC));
ok('…but only when nothing else is pending',
   /if \(!App\.ui\.selectedMoveId && !App\.ui\.actionMode\) \{/.test(SRC),
   'a tile with a trap on it is also a tile you may be trying to move onto or attack across');
ok('a ready trap looks ready', /tileClasses\.push\('trap-ready'\)/.test(SRC));
ok('…and the styling exists', /\.tile\.has-trap\.trap-ready \{/.test(SRC));

console.log('');
if (fails) { console.log('❌ ' + fails + ' FAILED'); process.exit(1); }
console.log('✅ ALL PASS');
