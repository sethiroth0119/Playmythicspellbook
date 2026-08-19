#!/usr/bin/env node
/* 🔒 PRIVATE-ZONE REMOVALS — the second PvP desync gate.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/private-zones.mjs   (or via tools/mp-tests/run.mjs)

   WHY THIS EXISTS
   The adopt path keeps the receiver's own `player` block rather than the
   sender's stale model of it. Correct for hands and decks; wrong for the five
   effects that legitimately reach into the OPPONENT's zones — hand disruption
   (discard / banish-to-Void), forced discard, hand theft, and graveSteal. Each
   is a removal performed inside the ACTOR's engine, and each was reverted by
   the victim. The thief saw the card gone; the victim still held it and could
   spend it again. Silent card duplication in any match using those cards.

   WHAT IS BEING GUARDED
   _mpApplyPrivateRemovals is deliberately REMOVALS-ONLY and idempotent. Two
   properties matter, and the second matters more than the first:

     1. LIVENESS  — a named card is actually removed, and lands in the zone the
                    op names (graveyard for a discard, void for a banish, gone
                    for a theft).
     2. SAFETY    — nothing else is ever touched. This function must not be able
                    to empty a hand. The blanket keep it replaces exists because
                    an earlier design DID wipe real hands, and a regression here
                    reintroduces the worse bug while fixing the smaller one.

   Property 2 is why the ops carry explicit instanceIds instead of the sender's
   view of zone membership: that view can be stale by a turn-start draw, and
   adopting it is precisely how a hand disappears.
*/
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC  = process.env.MP_SRC || join(ROOT, 'public', 'index.html');

const lines = readFileSync(SRC, 'utf8').split('\n');
function extractFn(name) {
  const start = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (start === -1) throw new Error('could not find top-level `function ' + name + '(` in index.html');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (lines[i].startsWith('}')) { end = i; break; }
  if (end === -1) throw new Error('could not find the column-0 closing brace of ' + name);
  return lines.slice(start, end + 1).join('\n');
}

/* MatchBroadcast is where the applied-op ledger lives; App gates the recorder on
   multiplayer. Both are top-level `const` in index.html (the globals trap), so
   the sandbox supplies them. Each case resets MatchBroadcast so the idempotence
   ledger from one case cannot mask a failure in the next. */
const build = () => {
  const src = 'const MatchBroadcast = { myUserId: "u_me" };\n'
    + 'const App = { battlePrep: { multiplayer: true } };\n'
    + extractFn('_mpNotePrivateRemoval') + '\n'
    + extractFn('_mpApplyPrivateRemovals') + '\n'
    + 'return { _mpNotePrivateRemoval, _mpApplyPrivateRemovals, MatchBroadcast };';
  return new Function(src)();
};

const card = (id, inst, name) => ({ id, instanceId: inst, name });
const myBlock = () => ({
  hand:      [card('c_bolt', 'i1', 'Bolt'), card('c_ward', 'i2', 'Ward'), card('c_bolt', 'i3', 'Bolt')],
  graveyard: [card('c_old', 'i9', 'Old')],
  void:      [],
  deck:      [card('c_deep', 'i7', 'Deep')],
  energy:    4,
});

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: cond ? '' : detail });
const ids = (z) => (z || []).map(c => c.instanceId).join(',');

// ── 1. LIVENESS ────────────────────────────────────────────────────────────
{
  const { _mpApplyPrivateRemovals } = build();
  const out = _mpApplyPrivateRemovals(myBlock(), [
    { id: 'op1', from: 'hand', to: 'graveyard', instanceId: 'i2', cardId: 'c_ward' },
  ]);
  check('discard removes from hand', ids(out.hand) === 'i1,i3', 'hand is ' + ids(out.hand));
  check('discard lands in graveyard', ids(out.graveyard) === 'i9,i2', 'graveyard is ' + ids(out.graveyard));
}
{
  const { _mpApplyPrivateRemovals } = build();
  const out = _mpApplyPrivateRemovals(myBlock(), [
    { id: 'op1', from: 'hand', to: 'void', instanceId: 'i1', cardId: 'c_bolt' },
  ]);
  check('banish lands in void', ids(out.void) === 'i1', 'void is ' + ids(out.void));
  check('banish leaves the OTHER copy of the same cardId', ids(out.hand) === 'i2,i3', 'hand is ' + ids(out.hand));
}
{
  const { _mpApplyPrivateRemovals } = build();
  const out = _mpApplyPrivateRemovals(myBlock(), [
    { id: 'op1', from: 'graveyard', to: null, instanceId: 'i9', cardId: 'c_old' },
  ]);
  check('graveSteal empties the named grave card', ids(out.graveyard) === '', 'graveyard is ' + ids(out.graveyard));
  check('graveSteal does not resurrect it elsewhere', ids(out.hand) === 'i1,i2,i3' && ids(out.void) === '', 'leaked into another zone');
}

// ── 2. IDEMPOTENCE ─────────────────────────────────────────────────────────
// The resync path replays a CACHED snapshot from the server, so the same op
// arrives twice. Without the id ledger the second pass removes a SECOND card.
{
  const { _mpApplyPrivateRemovals } = build();
  const op = [{ id: 'op1', from: 'hand', to: 'graveyard', instanceId: 'i1', cardId: 'c_bolt' }];
  const once  = _mpApplyPrivateRemovals(myBlock(), op);
  const twice = _mpApplyPrivateRemovals(once, op);
  check('replayed op removes nothing further', ids(twice.hand) === ids(once.hand),
    'first pass left ' + ids(once.hand) + ', replay left ' + ids(twice.hand));
}

// ── 3. SAFETY — the property that matters most ─────────────────────────────
{
  const { _mpApplyPrivateRemovals } = build();
  const before = myBlock();
  // Ops naming cards this client does not have: a stale/hostile/duplicated op
  // set must be inert, not destructive.
  const out = _mpApplyPrivateRemovals(before, [
    { id: 'x1', from: 'hand', to: 'graveyard', instanceId: 'NOPE', cardId: 'c_nope' },
    { id: 'x2', from: 'nonsense', to: 'graveyard', instanceId: 'i1', cardId: 'c_bolt' },
    { id: 'x3', from: 'hand', to: 'graveyard' },
  ]);
  check('unknown instanceId removes nothing', ids(out.hand) === 'i1,i2,i3', 'hand is ' + ids(out.hand));
  check('unknown zone name is inert', ids(out.graveyard) === 'i9', 'graveyard is ' + ids(out.graveyard));
  check('non-card fields survive', out.energy === 4 && ids(out.deck) === 'i7', 'energy/deck altered');
}
{
  const { _mpApplyPrivateRemovals } = build();
  // The catastrophic shape: many ops at once must never clear the hand beyond
  // the cards they name. Three ops, only one of which matches.
  const out = _mpApplyPrivateRemovals(myBlock(), [
    { id: 'y1', from: 'hand', to: null, instanceId: 'i2', cardId: 'c_ward' },
    { id: 'y2', from: 'hand', to: null, instanceId: 'GONE', cardId: 'c_ghost' },
    { id: 'y3', from: 'hand', to: null, instanceId: 'ALSO', cardId: 'c_ghost' },
  ]);
  check('a burst of ops removes exactly the matched cards', ids(out.hand) === 'i1,i3', 'hand is ' + ids(out.hand));
}
{
  const { _mpApplyPrivateRemovals } = build();
  const b = myBlock();
  check('empty / absent op list is a no-op', ids(_mpApplyPrivateRemovals(b, []).hand) === 'i1,i2,i3'
    && ids(_mpApplyPrivateRemovals(b, null).hand) === 'i1,i2,i3', 'mutated on an empty op list');
}

// ── 4. THE RECORDER ────────────────────────────────────────────────────────
{
  const { _mpNotePrivateRemoval } = build();
  const st = {};
  _mpNotePrivateRemoval(st, card('c_bolt', 'i1', 'Bolt'), 'hand', 'graveyard');
  _mpNotePrivateRemoval(st, card('c_ward', 'i2', 'Ward'), 'hand', 'void');
  const ops = st._mpPrivateRemovals || [];
  check('recorder appends one op per card', ops.length === 2, 'recorded ' + ops.length);
  check('recorder issues distinct ids', ops.length === 2 && ops[0].id !== ops[1].id, 'duplicate op ids');
  check('recorder carries instanceId + destination',
    ops.length === 2 && ops[0].instanceId === 'i1' && ops[0].to === 'graveyard' && ops[1].to === 'void',
    'op payload wrong: ' + JSON.stringify(ops[0]));
}
{
  // Solo play must not accumulate ops — App.battlePrep.multiplayer gates it.
  const src = 'const MatchBroadcast = { myUserId: "u_me" };\n'
    + 'const App = { battlePrep: { multiplayer: false } };\n'
    + extractFn('_mpNotePrivateRemoval') + '\nreturn { _mpNotePrivateRemoval };';
  const { _mpNotePrivateRemoval } = new Function(src)();
  const st = {};
  _mpNotePrivateRemoval(st, card('c_bolt', 'i1', 'Bolt'), 'hand', 'graveyard');
  check('solo play records nothing', !st._mpPrivateRemovals, 'ops recorded outside multiplayer');
}

/* ── 4b. THE OPS MUST SURVIVE THE WIRE ──────────────────────────────────────
   _serializeBattleStateForBroadcast strips heavy media and slims every card
   zone to id-only stubs — that slimming is what fixed a 100 MB snapshot and a
   1009 disconnect, so it is aggressive and it will be extended again. If it
   ever drops `_mpPrivateRemovals`, every fix above silently stops working and
   nothing else would notice: the helpers still pass, the wiring scan still
   passes, and the ops just never arrive. Guard the round trip explicitly. */
{
  const src = 'const App = { battlePrep: { multiplayer: true } };\n'
    + extractFn('_serializeBattleStateForBroadcast') + '\n'
    + 'return { _serializeBattleStateForBroadcast };';
  const { _serializeBattleStateForBroadcast } = new Function(src)();
  const wire = _serializeBattleStateForBroadcast({
    units: [], player: { hand: [card('c_bolt', 'i1', 'Bolt')], deck: [], graveyard: [] },
    ai: { hand: [], deck: [], graveyard: [] },
    _mpPrivateRemovals: [{ id: 'op1', from: 'hand', to: 'graveyard', instanceId: 'i1', cardId: 'c_bolt', name: 'Bolt' }],
  });
  const ops = wire && wire._mpPrivateRemovals;
  check('serializer keeps _mpPrivateRemovals', Array.isArray(ops) && ops.length === 1,
    'ops did not survive serialization: ' + JSON.stringify(ops));
  check('serializer keeps the instanceId the removal matches on',
    Array.isArray(ops) && ops[0] && ops[0].instanceId === 'i1' && ops[0].to === 'graveyard',
    'op payload mangled: ' + JSON.stringify(ops && ops[0]));
  // And confirm the slimming this rides alongside is still happening, so the
  // check above cannot pass merely because the serializer became a no-op.
  check('serializer still slims card zones to stubs',
    wire && wire.player && wire.player.hand && wire.player.hand[0]
      && wire.player.hand[0].cardId === 'c_bolt' && wire.player.hand[0].name === 'Bolt',
    'zone slimming changed shape: ' + JSON.stringify(wire && wire.player && wire.player.hand));
}

/* ── 5. THE WIRING ──────────────────────────────────────────────────────────
   The properties above test the two helpers. They cannot see whether the effect
   code actually CALLS the recorder — and "a cross-side write with no op" is the
   entire bug class. So scan the source: every write into a side block that is
   not the actor's own must have a _mpNotePrivateRemoval nearby.

   Default is FAIL. A side-index identifier that is not classified below is
   reported rather than ignored, so the next effect that reaches into the
   opponent's zones trips this on the first run instead of in a live match. */
{
  /* An earlier version of this scan matched `state[X] =` for ANY identifier and
     reported 250 hits — every dictionary write in a 215k-line file. A check
     that floods you with false positives is one you learn to ignore, which is
     strictly worse than not having it. So discover foe identifiers by the exact
     idiom the engine uses to name the other side, and police only those.

       foeSide    = owner === 'player' ? 'ai' : 'player'
       targetSide = owner === 'player' ? 'ai' : 'player'
       foe        = side  === 'player' ? 'ai' : 'player'
       gSide      = (…own…) ? owner : foeSide          ← derived */
  const DIRECT  = /\b([a-zA-Z_][\w]*)\s*=\s*[\w.]*\s*===\s*'player'\s*\?\s*'ai'\s*:\s*'player'/;
  const DERIVED = /\b([a-zA-Z_][\w]*)\s*=\s*[^;]*\?\s*owner\s*:\s*([a-zA-Z_][\w]*)/;
  const WINDOW  = 6;   // lines to look ahead for the recorder call

  const foeIds = new Set();
  for (const line of lines) {
    const d = line.match(DIRECT);
    if (d) foeIds.add(d[1]);
    const v = line.match(DERIVED);
    if (v && foeIds.has(v[2])) foeIds.add(v[1]);
  }
  check('the foe-side naming idiom is still recognisable', foeIds.size > 0,
    'found no `X = owner === \'player\' ? \'ai\' : \'player\'` — the scan below is inert, fix the pattern');

  // A WRITE through one of those: `state[foe] = …` or `[gSide]: { …` in a
  // spread. Reads (`state[foe].hand.length`) are harmless and must not trip.
  const ids = [...foeIds].join('|');
  const writeRe = new RegExp('(?:state\\[(?:' + ids + ')\\]\\s*=[^=]|\\[(?:' + ids + ')\\]\\s*:\\s*\\{)');
  let guarded = 0;
  lines.forEach((line, i) => {
    if (!writeRe.test(line)) return;
    if (lines.slice(i, i + WINDOW).join('\n').includes('_mpNotePrivateRemoval')) { guarded++; return; }
    results.push({ ok: false, name: 'cross-side write at line ' + (i + 1) + ' has no removal op',
      detail: line.trim().slice(0, 90) });
  });

  /* Nine known sites. Five were found by reading the code: hand-disrupt discard,
     hand-disrupt banish, graveSteal, hand theft, forced discard. This scan then
     found four MORE that the manual pass had missed — millEnemy, banishDeck,
     banishHand and discardEnemy — which is the whole argument for having it.
     If the count drops, a call site was deleted and that effect silently
     stopped syncing again. */
  check('all nine known cross-side writes are still wired', guarded >= 9,
    'only ' + guarded + ' guarded — a call site was dropped');
}

// ── Report ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log('\n🔒 PRIVATE-ZONE REMOVALS — ' + results.length + ' properties\n');
for (const r of results) console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  → ' + r.detail));
if (failed.length) {
  console.log('\n  ' + failed.length + ' propert' + (failed.length === 1 ? 'y' : 'ies') + ' failed.\n');
  process.exit(1);
}
console.log('\n  ✅ removals land, replays are inert, and nothing unnamed is ever touched.\n');
process.exit(0);
