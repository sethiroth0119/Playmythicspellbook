/* 🔮🧱 v121v141 — an enchantment on the board is scenery. It does not move.
   Run: node _enchstill_smoke.mjs

   Owner: "Enchantments cannot move remove the fact that they can move they are
   like walls."

   ⚠ v121v135 ONLY STOPPED IT ON ITS FIRST TURN. The token was stamped
     hasMoved = true / hasAttacked = true at placement — but those are TURN flags
     that the turn refresh clears, so from its second turn the enchantment was an
     ordinary, fully mobile unit.

   ⚠ AND THE WALL RULE WAS ALREADY LEAKING. getSwapTargets never excluded walls,
     and swap RELOCATES a unit — so a wall whose own keyword row promises "never
     moves, can't be dragged or take a Move command" could be walked across the
     board by swapping it with the hero. Asking the question through one shared
     predicate closes that as a side effect, which is the whole argument for a
     shared predicate over a second isWall-shaped check. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the predicates ───────────────────────────────────────────────────────── */
ok(/function _isStationaryUnit\(u\) \{\n\s*return !!\(u && \(u\.isWall \|\| u\.isEnchantment\)\);\n\}/.test(SRC),
  'ONE predicate answers "does this move" for walls and board enchantments alike');
ok(/function _resistsForcedMove\(u\) \{/.test(SRC),
  '…and a SECOND for forced movement, kept separate on purpose');
{
  const f = SRC.slice(SRC.indexOf('function _resistsForcedMove(u) {'), SRC.indexOf('function _resistsForcedMove(u) {') + 260);
  ok(/if \(u\.isEnchantment\) return true;/.test(f), 'an enchantment never budges — it carries no pushable flag at all');
  ok(/return !!\(u\.isWall && !\(u\.wall && u\.wall\.canBePushed\)\);/.test(f),
    '…while a wall keeps its existing exception, so a wall authored as pushable still is');
}
ok(/a pushable wall DOES\n\s*move when shoved while still never taking a Move command of its own/.test(SRC),
  'the reason the two predicates are separate is written down — they are different questions');

/* ── every move gate ──────────────────────────────────────────────────────── */
ok(/if \(_isStationaryUnit\(unit\)\) return \[\];/.test(SRC),
  'getValidMoves returns ZERO tiles — the one line that blocks Move Piece, drag-to-move AND the AI together');
ok(/if \(!u\.hasMoved && !_incap && !faceDown && !_isStationaryUnit\(u\)\) \{/.test(SRC),
  'the hover menu offers no MOVE row at all, rather than one that is refused on click');
ok(/if \(_isStationaryUnit\(sel\)\) \{ showToast\(sel\.isEnchantment \? '🔮 Enchantments cannot move\.' : '🧱 Walls cannot move\.'\); return; \}/.test(SRC),
  'the teleport-move gate refuses it, naming which kind of thing it is');
ok(/if \(_isStationaryUnit\(sel\)\) \{ if \(typeof showToast === 'function'\) showToast\(sel\.isEnchantment \? '🔮 This is an Enchantment/.test(SRC),
  '…and so does the move-mode gate');
ok(!/if \(sel\.isWall\) \{ showToast\('🧱 Walls cannot move\.'\); return; \}/.test(SRC)
   && !/if \(unit && unit\.isWall\) return \[\];/.test(SRC),
  'no bare isWall move-gate is left behind — a second check that could drift from the predicate');

/* ── swap: the hole the wall rule already had ─────────────────────────────── */
{
  const f = SRC.slice(SRC.indexOf('function getSwapTargets(unit, units) {'), SRC.indexOf('function cancelAction()'));
  ok(/!_isStationaryUnit\(u\) &&/.test(f),
    'SWAP EXCLUDES A STATIONARY UNIT — it relocates one, which is movement by another name');
  ok(/This gate was MISSING for walls too/.test(f),
    '…and the note records that this was a pre-existing hole in the WALL rule, not new behaviour for enchantments');
  ok(/distance\(u\.pos, hero\.pos\) <= 1/.test(f), 'the adjacency rule itself is untouched');
}

/* ── forced movement, both verbs ──────────────────────────────────────────── */
ok((SRC.match(/!_resistsForcedMove\(updatedTarget\)/g) || []).length === 2,
  'BOTH knockback AND pull ask it — they are separate blocks with the same guard, and fixing one would leave the other dragging an enchantment off its tile');
ok(/&& !_resistsForcedMove\(u\)\);/.test(SRC), '…and so does the push/pull effect');
ok(!/updatedTarget\.isWall && !\(updatedTarget\.wall && updatedTarget\.wall\.canBePushed\)/.test(SRC),
  'no bare wall forced-move check survives either');

/* ── the card says so ─────────────────────────────────────────────────────── */
ok(/if \(u\.isEnchantment\) kw\.push\(\{ name: '🔮 Enchantment — Cannot Move'/.test(SRC),
  'the card carries the rule as a keyword, like the wall does — a rule you cannot read is one you discover by being refused');
ok(/Never moves, can\\'t be dragged, swapped or pushed\./.test(SRC),
  '…and it names all three ways it cannot be moved, including the swap that was leaking');
ok(/if \(u\.isWall\) kw\.push\(\{ name: '🧱 Wall — Cannot Move'/.test(SRC), 'the wall keeps its own row, unchanged');

/* ── run the rules for real ───────────────────────────────────────────────── */
{
  const stationary = (u) => !!(u && (u.isWall || u.isEnchantment));
  const resists = (u) => !u ? false : (u.isEnchantment ? true : !!(u.isWall && !(u.wall && u.wall.canBePushed)));

  ok(stationary({ isEnchantment: true }) === true, 'run for real: a board enchantment does not move');
  ok(stationary({ isWall: true }) === true, 'run for real: nor does a wall');
  ok(stationary({ isWall: true, wall: { canBePushed: true } }) === true,
    'run for real: a PUSHABLE wall still takes no Move command of its own — being shoved is not moving yourself');
  ok(stationary({}) === false && stationary(null) === false, 'run for real: an ordinary unit is unaffected');
  ok(stationary({ isHero: true }) === false, 'run for real: …and a hero certainly still moves');

  ok(resists({ isEnchantment: true }) === true, 'run for real: an enchantment resists knockback, push and pull');
  ok(resists({ isWall: true }) === true, 'run for real: an unflagged wall resists, as before');
  ok(resists({ isWall: true, wall: { canBePushed: true } }) === false,
    'run for real: A PUSHABLE WALL IS STILL PUSHABLE — the existing exception is not swallowed by the new rule');
  ok(resists({}) === false, 'run for real: an ordinary unit is still shoved normally');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 141, 'BUILD_VERSION is v121v141 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
