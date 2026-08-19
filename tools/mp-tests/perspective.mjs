#!/usr/bin/env node
/* 🪞 PERSPECTIVE PARITY — the PvP desync gate.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/perspective.mjs      (or via tools/mp-tests/run.mjs)

   WHY THIS EXISTS
   Multiplayer syncs by "alternating authority": the player whose turn it is
   sends its WHOLE board, and the receiver adopts it wholesale through
   swapBattlePerspective() — every 'player'/'ai' owner flipped, every board
   coordinate mirrored. So that function is the entire correctness boundary of
   PvP. Anything it forgets is a permanent, silent divergence between the two
   screens: an effect attributed to the wrong player, or landing on the wrong
   tile, for the rest of the match.

   It has forgotten things repeatedly. Its own comments record five:
   graveLock, _lastMove.owner, _atkFx, _counterChain and enchantments — each
   found in play, each fixed one at a time, none of them guarded afterwards.
   _mirrorPos's header still claims it mirrors "anywhere x/y lives"; it does not.

   WHY NOT THE OBVIOUS TEST
   The tempting property is involution: swap(swap(S)) === S. It is useless here.
   A field that is handled ASYMMETRICALLY breaks it, but a field that is simply
   IGNORED passes trivially — identity applied twice is still identity. Every
   bug in the list above is an ignored field, so involution would have caught
   none of them. Do not "simplify" this file into that test.

   WHAT THIS DOES INSTEAD — discovery, not a checklist
   Walk the state tree generically and demand that ONE swap changes everything
   that names a side or a square:
     • every value exactly 'player' or 'ai', at any depth, must have flipped
     • every {x, y} pair must have become {W-1-x, H-1-y}
   No field list is hardcoded, so a NEW field added to battle state is caught
   the first time this runs — which is the failure mode that keeps recurring.
   Intentional exceptions are named in EXPECT_UNCHANGED below, with a reason.
   Default is FAIL: an unrecognised field is a bug until someone says otherwise.
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* MP_SRC points the extraction at a DIFFERENT copy of index.html. run.mjs uses
   it to re-run this file against copies with one fix reverted, proving each
   check can actually fail — the repo has twice shipped a green test that was
   never comparing anything. Unset in normal use. */
const SRC  = process.env.MP_SRC || join(ROOT, 'public', 'index.html');
const BOARD_W = 8, BOARD_H = 7;   // must match index.html's `const BOARD_W = 8, BOARD_H = 7`

/* Extract the real functions from index.html.
   Line-anchored the same way tools/extract-engine-data.mjs does it: a
   top-level `function NAME(` through the first following line that begins with
   `}` at column 0. Nested braces are indented, so they never false-match.
   Testing the SHIPPED source (not a copy) is the point — a transcribed copy
   would drift and the gate would guard nothing. */
const lines = readFileSync(SRC, 'utf8').split('\n');
function extractFn(name) {
  const start = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (start === -1) throw new Error('could not find top-level `function ' + name + '(` in index.html');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('}')) { end = i; break; }
  if (end === -1) throw new Error('could not find the column-0 closing brace of ' + name);
  return lines.slice(start, end + 1).join('\n');
}

const FNS = ['_mirrorPos', '_mirrorAllPositions', 'swapBattlePerspective'];
/* `App` is a top-level `const` in index.html and therefore NOT on window — the
   documented globals trap. _mirrorAllPositions reads App.ui.aiMoveTrail, so the
   sandbox supplies a stub rather than pretending the real one is reachable. */
const sandbox = 'const BOARD_W = ' + BOARD_W + ', BOARD_H = ' + BOARD_H + ';\n'
  + 'const App = { ui: {} };\n'
  + FNS.map(extractFn).join('\n') + '\n'
  + 'return { ' + FNS.join(', ') + ' };';
const { swapBattlePerspective } = new Function(sandbox)();

/* THE FIXTURE
   One state carrying every side-keyed and position-keyed field the battle
   engine actually writes (enumerated from `state.<field> =` assignments in
   index.html). Values are deliberately ASYMMETRIC — never a self-mirroring
   coordinate — so a field left untouched cannot coincidentally look correct.
   BOARD_W is even, so no x is its own mirror; BOARD_H is odd, so y = 3 IS its
   own mirror and must never appear here. */
const pos = (x, y) => ({ x, y });
const fixture = () => ({
  currentTurn: 'player',
  turn: 'player',
  gameOver: null,
  turnNumber: 4,

  units: [
    { id: 'u1', owner: 'player', isHero: true,  currentHp: 30, pos: pos(1, 6), lastPos: pos(1, 5), targetPos: pos(2, 6) },
    { id: 'u2', owner: 'ai',     isHero: false, currentHp: 17, pos: pos(6, 0) },
  ],

  board: Array.from({ length: BOARD_H }, (_, y) =>
    Array.from({ length: BOARD_W }, (_, x) => {
      const t = { x, y };
      if (x === 2 && y === 5) t.wall = { owner: 'player', hp: 3 };
      if (x === 5 && y === 1) t.trap = { owner: 'ai', kind: 'spike' };
      if (x === 0 && y === 0) t.marker = 'CORNER';   // board content check below
      return t;
    })),

  // Side-keyed effect state — the class that has broken five times.
  graveLock:      { player: 2, ai: 0 },
  _lastMove:      { owner: 'player', cardId: 'c_strike' },
  _counterChain:  [{ owner: 'player', id: 'l1' }, { owner: 'ai', id: 'l2' }],
  enchantments:   [{ owner: 'ai', id: 'e1', turnsLeft: 3 }],
  weather:        { id: 'rain', ownerHint: 'player' },
  activeLocation: { id: 'ruins', ownerHint: 'ai' },
  _atkFx: {
    startedAt: 1,
    attacker: { owner: 'player', id: 'u1' },
    defender: { owner: 'ai', id: 'u2' },
    defenderPos: pos(6, 0),
  },
  _lastPlayerCounterCard: { owner: 'player', cardId: 'c_par' },
  _lastAiCounterCard:     { owner: 'ai',     cardId: 'c_rip' },

  // Position-keyed effect state.
  sealedTiles:   [{ x: 2, y: 5, turnsLeft: 2 }],
  smokedTiles:   [{ x: 7, y: 6, turnsLeft: 1 }],
  delayedBlasts: [{ x: 1, y: 4, turnsLeft: 2, amount: 15, radius: 1, owner: 'player' }],
  tombstones:    [{ x: 3, y: 2, cardId: 'c_dead' }],
  smokeClouds:   [{ x: 4, y: 6, turnsLeft: 2 }],
  mods: {
    twConvoy:    { exit: pos(7, 0) },
    /* Real shape is {pos, extracted, progress} — no owner. An earlier draft of
       this fixture invented one and the gate duly reported it as unswapped: a
       fixture that models a field the engine does not have manufactures its own
       failure. Check the write site before adding anything here. */
    twOilTowers: [{ pos: pos(0, 6), extracted: false, progress: 2 }],
    twVip:       { pos: pos(5, 4) },
  },

  // Private side blocks — adopted wholesale then DISCARDED by the receiver
  // (_onRemoteStateArrived keeps its own), so they are out of scope here.
  player: { hand: [{ cardId: 'a' }], deck: [], graveyard: [], energy: 3 },
  ai:     { hand: [{ cardId: 'b' }], deck: [], graveyard: [], energy: 5 },
  log: [{ msg: 'You play Strike', color: 'green' }],
});

/* Paths the scan must not police, each with the reason it is exempt.
   Anything NOT listed here is required to swap/mirror — new fields fail loudly.
   Matched as a prefix against the dotted path. */
const EXPECT_UNCHANGED = [
  ['player',           'private side block — receiver keeps its own, never adopted'],
  ['ai',               'private side block — receiver keeps its own, never adopted'],
  ['log',              'free text; re-attributed separately by _mpReattributeLogLine'],
  ['board',            'grid is rebuilt by index; content movement is checked separately'],
  ['_mirroredAiTrail', 'render hint derived from local App.ui, not from the wire state'],
  /* These two name their side in the KEY. The invariant is that the key and the
     inner owner AGREE, so `.owner` is supposed to read the same before and
     after — what has to move is the CONTENTS. The generic value-walker reads
     that correct behaviour as "never flipped", so the pair is checked by the
     exchange assertion below instead, which is the stronger test. */
  ['_lastPlayerCounterCard.owner', 'side lives in the key; the exchange check below covers it'],
  ['_lastAiCounterCard.owner',     'side lives in the key; the exchange check below covers it'],
];
const exempt = (p) => EXPECT_UNCHANGED.some(([pre]) => p === pre || p.startsWith(pre + '.') || p.startsWith(pre + '['));

function walk(node, path, onOwner, onPos) {
  if (node == null || typeof node !== 'object') return;
  if (typeof node.x === 'number' && typeof node.y === 'number') onPos(path, node);
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, path + '[' + i + ']', onOwner, onPos)); return; }
  for (const k of Object.keys(node)) {
    const v = node[k], p = path ? path + '.' + k : k;
    if (v === 'player' || v === 'ai') onOwner(p, v);
    else walk(v, p, onOwner, onPos);
  }
}
const collect = (s) => {
  const owners = new Map(), positions = new Map();
  walk(s, '', (p, v) => owners.set(p, v), (p, v) => positions.set(p, { x: v.x, y: v.y }));
  return { owners, positions };
};

const before = fixture();
const after  = swapBattlePerspective(fixture());
const B = collect(before), A = collect(after);
const failures = [];

// 1. Every side-keyed VALUE must have flipped.
for (const [p, v] of B.owners) {
  if (exempt(p)) continue;
  const got = A.owners.get(p);
  if (got === undefined) { failures.push('OWNER  ' + p + ": '" + v + "' vanished after swap (field dropped?)"); continue; }
  if (got === v) failures.push('OWNER  ' + p + ": still '" + v + "' after swap — side never flipped");
}
// 1b. graveLock is keyed BY side rather than valued by it, so the value-walker
//     cannot see it. Check the transpose directly.
if (before.graveLock && after.graveLock) {
  if (after.graveLock.player !== before.graveLock.ai || after.graveLock.ai !== before.graveLock.player) {
    failures.push('OWNER  graveLock: {player:' + after.graveLock.player + ', ai:' + after.graveLock.ai + '} did not transpose');
  }
}
// 1c. Side-NAMED sibling fields — a matched _lastPlayerX / _lastAiX pair has to
//     exchange contents, which the value-walker also cannot see.
for (const [pk, ak] of [['_lastPlayerCounterCard', '_lastAiCounterCard']]) {
  const bp = before[pk], ba = before[ak], ap = after[pk], aa = after[ak];
  if (!bp || !ba) continue;
  // Assert the EXACT exchange, not merely "something changed": the sender's
  // own stash must arrive as the receiver's opponent stash and vice versa,
  // with the inner owner rewritten to agree with its new key.
  if (!ap || ap.cardId !== ba.cardId || ap.owner !== 'player') {
    failures.push('OWNER  ' + pk + ": expected the opponent's card '" + ba.cardId + "' as owner 'player', got '"
      + (ap && ap.cardId) + "' / '" + (ap && ap.owner) + "'");
  }
  if (!aa || aa.cardId !== bp.cardId || aa.owner !== 'ai') {
    failures.push('OWNER  ' + ak + ": expected the sender's card '" + bp.cardId + "' as owner 'ai', got '"
      + (aa && aa.cardId) + "' / '" + (aa && aa.owner) + "'");
  }
}

// 2. Every COORDINATE must have mirrored.
for (const [p, v] of B.positions) {
  if (exempt(p)) continue;
  const got = A.positions.get(p);
  if (got === undefined) { failures.push('POS    ' + p + ': (' + v.x + ',' + v.y + ') vanished after swap (field dropped?)'); continue; }
  const wantX = (BOARD_W - 1) - v.x, wantY = (BOARD_H - 1) - v.y;
  if (got.x !== wantX || got.y !== wantY) {
    failures.push('POS    ' + p + ': (' + v.x + ',' + v.y + ') → (' + got.x + ',' + got.y + '), expected (' + wantX + ',' + wantY + ')');
  }
}

// 3. Board content must actually MOVE. Its tile.x/tile.y are rewritten to the
//    new index during the rebuild, so check 2 structurally cannot see it —
//    hence a marker tile and a known wall.
const corner = after.board && after.board[BOARD_H - 1] && after.board[BOARD_H - 1][BOARD_W - 1];
if (!corner || corner.marker !== 'CORNER') failures.push('BOARD  tile (0,0) did not move to the opposite corner');
const wRow = after.board && after.board[(BOARD_H - 1) - 5];
const wall = wRow && wRow[(BOARD_W - 1) - 2];
if (!wall || !wall.wall || wall.wall.owner !== 'ai') failures.push('BOARD  wall at (2,5) did not both move and flip owner');

const scanned = [...B.owners.keys(), ...B.positions.keys()].filter(p => !exempt(p)).length;
console.log('\n🪞 PERSPECTIVE PARITY — ' + scanned + ' side/position fields scanned across one swap\n');
if (!failures.length) {
  console.log('  ✅ every side flipped and every coordinate mirrored.\n');
  process.exit(0);
}
for (const f of failures) console.log('  ❌ ' + f);
console.log('\n  ' + failures.length + " field(s) survive a perspective swap unchanged.");
console.log("  Each one is a permanent divergence between the two players' screens.\n");
process.exit(1);
