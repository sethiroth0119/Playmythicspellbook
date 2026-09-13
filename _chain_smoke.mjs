/* ════════════════════════════════════════════════════════════════════════════
   ⛓ _chain_smoke.mjs — proves the chain's RULES, headlessly.
   ----------------------------------------------------------------------------
   Runs the pure engine (public/src/chain/chain.engine.js) with no DOM and no
   bridge. It deliberately does NOT touch chain.ui.js or index.js: those need a
   document, and the thing worth guarding here is the rules, which are the part
   that is easy to break and impossible to eyeball.

   What it locks down, and why each one earns a test:
     1. LIFO             — the last link resolves FIRST. Get this backwards and
                           negation silently stops working while everything
                           still "runs fine", which is the worst failure mode.
     2. Speed 1 can't respond   — the rule that stops normal spells chaining.
     3. Only 3 answers 3 — the TERMINATION guarantee. If this ever passes for a
                           speed-2 card, chains can grow without bound.
     4. Negation         — a negate kills the link beneath it…
     5. …and a negated link negates NOTHING — the rule that makes a three-deep
                           mutual-negate chain resolve to one answer instead of
                           two depending on which end you read from.
     6. 'chain' negation — blows out every link beneath it.
     7. MAX_LINKS        — the loop backstop actually refuses.

       node _chain_smoke.mjs
   ════════════════════════════════════════════════════════════════════════════ */
import {
  newChain, addLink, pass, applyNegations, resolutionOrder, canRespond, responsesFor,
  speedOf, topSpeedOf, SPEED, CHAIN_MAX_LINKS,
} from './public/src/chain/chain.engine.js';

let pass_ = 0, fail_ = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass_++; console.log('  ✓ ' + name); }
  else { fail_++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
};

const card = (id, over) => Object.assign({ id, name: id, kind: 'trap' }, over || {});

console.log('\n⛓ CHAIN RULES\n');

/* ── 1. speed inference ─────────────────────────────────────────────────── */
ok('unit card is speed 1',      speedOf(card('u', { kind: 'unit' })) === SPEED.NORMAL);
ok('normal spell is speed 1',   speedOf(card('s', { kind: 'spell' })) === SPEED.NORMAL);
ok('quick-play spell is speed 2', speedOf(card('q', { kind: 'spell', quickPlay: true })) === SPEED.QUICK);
ok('trap is speed 2',           speedOf(card('t', { kind: 'trap' })) === SPEED.QUICK);
ok('counter trap is speed 3',   speedOf(card('c', { kind: 'trap', counter: true })) === SPEED.COUNTER);
ok('explicit chainSpeed wins',  speedOf(card('x', { kind: 'unit', chainSpeed: 3 })) === SPEED.COUNTER);

/* ── 2 & 3. who may respond to what ─────────────────────────────────────── */
ok('speed 1 CANNOT respond to speed 1', !canRespond(card('s', { kind: 'spell' }), SPEED.NORMAL));
ok('speed 2 CAN respond to speed 1',     canRespond(card('t', { kind: 'trap' }),  SPEED.NORMAL));
ok('speed 2 CAN respond to speed 2',     canRespond(card('t', { kind: 'trap' }),  SPEED.QUICK));
ok('speed 2 CANNOT respond to speed 3', !canRespond(card('t', { kind: 'trap' }),  SPEED.COUNTER));
ok('speed 3 CAN respond to speed 3',     canRespond(card('c', { kind: 'trap', counter: true }), SPEED.COUNTER));
ok('any speed may OPEN a chain',         canRespond(card('s', { kind: 'spell' }), 0));

/* ── 4. LIFO ────────────────────────────────────────────────────────────── */
{
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('A', { kind: 'spell' }), side: 'player', label: 'A' });
  addLink(ch, { def: card('B'),                    side: 'ai',     label: 'B' });
  addLink(ch, { def: card('C'),                    side: 'player', label: 'C' });
  const order = resolutionOrder(ch).map(l => l.label).join('');
  ok('added A,B,C resolves C,B,A (LIFO)', order === 'CBA', 'got ' + order);
  ok('topSpeedOf reads the newest link', topSpeedOf(ch) === SPEED.QUICK);
}

/* ── 5. a speed-1 link is refused as a RESPONSE but fine as link 1 ─────── */
{
  const ch = newChain({ kind: 'test' });
  ok('speed 1 opens a chain', addLink(ch, { def: card('A', { kind: 'spell' }), side: 'player', label: 'A' }) === true);
  ok('speed 1 refused as a response',
     addLink(ch, { def: card('B', { kind: 'spell' }), side: 'ai', label: 'B' }) === false);
  ok('refused link did not land', ch.links.length === 1);
}

/* ── 6. negation kills the link beneath ────────────────────────────────── */
{
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('Snare', { kind: 'trap' }),                      side: 'player', label: 'Snare' });
  addLink(ch, { def: card('Veto',  { kind: 'trap', counter: true, negates: 'link' }), side: 'ai', label: 'Veto' });
  const r = applyNegations(ch);
  ok('Veto resolves first and is not negated', r[0].label === 'Veto' && !r[0].negated);
  ok('Snare is negated by Veto',               r[1].label === 'Snare' && r[1].negated === true);
  ok('negatedBy names the culprit',            r[1].negatedBy === r[0].id);
}

/* ── 7. a NEGATED link negates nothing (the ordering rule) ─────────────── */
{
  // Player: Snare → AI: Veto (negates Snare) → Player: Override (negates Veto).
  // Resolution: Override, Veto, Snare.
  //   Override resolves, negating Veto.
  //   Veto is negated, so it must NOT negate Snare.
  //   Snare therefore RESOLVES.
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('Snare',    { kind: 'trap' }),                                    side: 'player', label: 'Snare' });
  addLink(ch, { def: card('Veto',     { kind: 'trap', counter: true, negates: 'link' }),    side: 'ai',     label: 'Veto' });
  addLink(ch, { def: card('Override', { kind: 'trap', counter: true, negates: 'link' }),    side: 'player', label: 'Override' });
  const r = applyNegations(ch);
  ok('Override resolves',        r[0].label === 'Override' && !r[0].negated);
  ok('Veto is negated',          r[1].label === 'Veto' && r[1].negated === true);
  ok('Snare SURVIVES (a negated link negates nothing)',
     r[2].label === 'Snare' && r[2].negated === false,
     'Snare.negated=' + r[2].negated + ' — if true, applyNegations is letting a dead link act');
}

/* ── 8. 'chain' negation blows out everything beneath ──────────────────── */
{
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('A', { kind: 'trap' }), side: 'player', label: 'A' });
  addLink(ch, { def: card('B', { kind: 'trap' }), side: 'ai',     label: 'B' });
  addLink(ch, { def: card('Wipe', { kind: 'trap', counter: true, negates: 'chain' }), side: 'player', label: 'Wipe' });
  const r = applyNegations(ch);
  ok('Wipe resolves',          !r[0].negated);
  ok('everything beneath dies', r[1].negated === true && r[2].negated === true);
}

/* ── 9. two consecutive passes close the window ────────────────────────── */
{
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('A', { kind: 'trap' }), side: 'player', label: 'A' });
  ok('one pass does not close', pass(ch) === false && ch.closed === false);
  ok('two passes close',        pass(ch) === true  && ch.closed === true);
  ok('a closed chain refuses links',
     addLink(ch, { def: card('B', { kind: 'trap' }), side: 'ai', label: 'B' }) === false);
}

/* ── 10. a response RESETS the pass count ─────────────────────────────── */
{
  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('A', { kind: 'trap' }), side: 'player', label: 'A' });
  pass(ch);                                            // one pass
  addLink(ch, { def: card('B', { kind: 'trap' }), side: 'ai', label: 'B' });
  ok('a link resets passes to 0', ch.passes === 0);
  ok('so the chain is still open', ch.closed === false);
}

/* ── 11. a card is SPENT once it is on the chain ──────────────────────────
   Without this, a bridge whose pay() deducts a cost but does not remove the
   card from its zone re-offers the identical card forever, and the chain grows
   until MAX_LINKS trips. The browser mount probe produced exactly that: one
   trap answering itself twelve times. */
{
  /* `responsesFor` is the layer that filters, so it is the layer to test. It
     reads the bridge off `window`, so stand one up — a bridge that models the
     bug: it always returns the same card and always says the cost is payable,
     exactly like a zone that is never emptied. */
  globalThis.window = {
    MythicChainBridge: {
      hand: () => [{ uid: 'hand:veto', def: card('Veto', { kind: 'trap', counter: true, negates: 'link' }) }],
      field: () => [], grave: () => [],
      canPay: () => true, pay: () => true, cardDef: () => null,
    },
  };

  const ch = newChain({ kind: 'test' });
  addLink(ch, { def: card('Snare', { kind: 'trap' }), side: 'player', label: 'Snare', uid: 'hand:snare' });

  const first = responsesFor(ch, 'ai', {});
  ok('the Veto is offered while unspent', first.length === 1 && first[0].uid === 'hand:veto');

  addLink(ch, { def: first[0].def, side: 'ai', label: 'Veto', uid: first[0].uid });
  ok('playing it marks it spent', ch.spent['hand:veto'] === true);

  const second = responsesFor(ch, 'player', {});
  ok('…and it is NOT offered again on the same chain', second.length === 0,
     'still offered: ' + JSON.stringify(second.map(o => o.uid)));

  // A fresh chain must offer it again — spending is per-window, not permanent.
  const ch2 = newChain({ kind: 'test' });
  ok('a NEW chain offers it again', responsesFor(ch2, 'ai', {}).length === 1);

  delete globalThis.window;
}

/* ── 12. MAX_LINKS backstop ───────────────────────────────────────────── */
{
  const ch = newChain({ kind: 'test' });
  let added = 0;
  for (let i = 0; i < CHAIN_MAX_LINKS + 6; i++) {
    if (addLink(ch, { def: card('L' + i, { kind: 'trap', counter: true }), side: i % 2 ? 'ai' : 'player', label: 'L' + i })) added++;
  }
  ok('refuses past CHAIN_MAX_LINKS', added === CHAIN_MAX_LINKS && ch.links.length === CHAIN_MAX_LINKS,
     'added ' + added + ' / cap ' + CHAIN_MAX_LINKS);
}

console.log(`\n${pass_} passed, ${fail_} failed\n`);
process.exit(fail_ ? 1 : 0);
