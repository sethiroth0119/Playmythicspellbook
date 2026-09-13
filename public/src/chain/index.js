/* ════════════════════════════════════════════════════════════════════════════
   ⛓ CHAIN — module entry point. Registers window.MythicChain.
   ----------------------------------------------------------------------------
   The battle in index.html calls exactly ONE function:

       const result = await window.MythicChain.open({
         trigger:   { kind: 'trapSpring', label: 'Bone Snare springing' },
         initiator: 'player',              // whose effect opened the chain
         link1:     { def, side, source, tile, targetId },   // optional
         state,                            // the live battle state (read-only here)
         difficulty: 'normal',
       });

       // result.resolved — links in RESOLUTION order (last played first),
       //                   each tagged { negated, negatedBy }.
       // result.log      — ready-to-print transcript lines.
       // result.chained  — false when nobody responded (the fast path).

   The battle then applies `result.resolved` top to bottom, SKIPPING the effect
   of any link with `negated: true` while still sending that card to the
   graveyard. That last part matters: a negated card was still used.

   🔴 WHEN NOBODY CAN RESPOND, NOTHING CHANGES. If neither side holds a legal
   answer, `open()` returns immediately with `chained: false` and the single
   link it was handed. No modal, no delay, no behavioural difference from the
   game before this folder existed. That is the design contract — the chain is
   additive, and a battle where no one owns a quick effect plays exactly as it
   always did.

   🔴 THE GLOBALS TRAP (CLAUDE.md): nothing here reads a legacy global. Without
   window.MythicChainBridge this module registers, reports `available: false`,
   and every call falls through to the no-chain path.
   ⚠ Everything is wrapped. A failure in the chain can never take the battle
   down — it degrades to the old immediate-resolution behaviour.
   ════════════════════════════════════════════════════════════════════════════ */

import { bridgeReady, bx } from './chain.bridge.js';
import {
  newChain, addLink, pass, responsesFor, applyNegations, describe,
  speedOf, canRespond, topSpeedOf, SPEED, CHAIN_MAX_LINKS,
} from './chain.engine.js';
import { prompt, flashResolution, DEFAULT_WINDOW_MS } from './chain.ui.js';
import { choose } from './chain.ai.js';

const OTHER = { player: 'ai', ai: 'player' };

/* One chain at a time, always. A response window opening inside another one is
   a bug in the caller (usually an effect that re-entered the battle loop), and
   allowing it would interleave two chains into one stack. Refuse loudly. */
let _busy = false;

async function open(req) {
  const state = req && req.state;
  const initiator = (req && req.initiator) === 'ai' ? 'ai' : 'player';
  const difficulty = (req && req.difficulty) || 'normal';

  const chain = newChain(req && req.trigger);

  // Seed Link 1 if the caller handed us one. A chain can also open with no
  // link at all — that is the "respond to an attack declaration" case, where
  // the trigger itself is the thing being answered.
  if (req && req.link1) {
    addLink(chain, { ...req.link1, side: req.link1.side || initiator });
  }

  const fail = () => ({
    chained: false,
    resolved: applyNegations(chain),
    log: [],
    links: chain.links,
  });

  if (!bridgeReady()) return fail();
  if (_busy) {
    try { console.warn('[chain] a response window is already open — refusing to nest.'); } catch (e) {}
    return fail();
  }

  _busy = true;
  try {
    // Priority starts with whoever did NOT open the chain.
    let side = OTHER[initiator] || 'ai';
    let guard = 0;

    while (!chain.closed && guard++ < CHAIN_MAX_LINKS * 2 + 4) {
      let options = [];
      try { options = responsesFor(chain, side, state) || []; } catch (e) { options = []; }

      if (!options.length) {
        // Nothing legal to add — an automatic pass. Two in a row closes.
        if (pass(chain)) break;
        side = OTHER[side];
        continue;
      }

      let picked = null;
      if (side === 'ai') {
        try { picked = choose(chain, options, state, difficulty); } catch (e) { picked = null; }
      } else {
        // Only ever prompt a human when there is a real decision to make.
        try {
          picked = await prompt(chain, options, {
            timeoutMs: (req && typeof req.timeoutMs === 'number') ? req.timeoutMs : DEFAULT_WINDOW_MS,
            triggerLabel: (chain.links.length
              ? chain.links[chain.links.length - 1].label
              : (req && req.trigger && req.trigger.label) || 'that'),
          });
        } catch (e) { picked = null; }
      }

      if (!picked) {
        if (pass(chain)) break;
        side = OTHER[side];
        continue;
      }

      // 💸 Pay BEFORE the link goes on the chain. A cost that fails after the
      // link is added leaves a free effect on the stack — this codebase has
      // shipped a "charged for a building that never persisted" bug (see
      // /src/plague/state.js craftBatch) and this is the same shape of it,
      // inverted. Pay first; on refusal, treat the window as a pass.
      let paid = false;
      try { paid = !!bx().pay(picked.def, side, picked, state); } catch (e) { paid = false; }
      if (!paid) {
        if (pass(chain)) break;
        side = OTHER[side];
        continue;
      }

      addLink(chain, {
        def: picked.def, side, source: picked.source,
        // ⚠ `uid` is what burns the card for the rest of this chain
        // (chain.engine.js `spent`). Dropping it here re-opens the loop that
        // let one trap answer itself twelve times.
        uid: picked.uid,
        tile: picked.tile, targetId: picked.targetId, label: picked.label,
      });

      side = OTHER[side];          // priority passes back
    }

    const resolved = applyNegations(chain);
    const log = describe(resolved);

    // Only announce a chain that actually became one. A single uncontested
    // link is just a card resolving, and narrating it would be noise on every
    // single trap in the game.
    if (chain.links.length > 1) flashResolution(log);

    return { chained: chain.links.length > 1, resolved, log, links: chain.links };
  } catch (e) {
    try { console.warn('[chain] open() failed — falling back to immediate resolution', e); } catch (e2) {}
    return fail();
  } finally {
    _busy = false;
  }
}

/* Would a window even do anything? The battle can call this SYNCHRONOUSLY to
   skip the async path entirely on the overwhelmingly common "nobody holds a
   quick effect" turn. Cheap: it only asks for the legal list and its length. */
function wouldOpen(req) {
  try {
    if (!bridgeReady()) return false;
    const chain = newChain(req && req.trigger);
    if (req && req.link1) addLink(chain, { ...req.link1, side: (req.link1.side || req.initiator || 'player') });
    const other = OTHER[(req && req.initiator) === 'ai' ? 'ai' : 'player'];
    return (responsesFor(chain, other, req && req.state) || []).length > 0;
  } catch (e) { return false; }
}

try {
  window.MythicChain = {
    open,
    wouldOpen,
    available: () => bridgeReady(),
    // Rules helpers — exposed so the deck builder and card inspector can show a
    // card's speed without importing the engine themselves.
    speedOf, canRespond, topSpeedOf, SPEED,
    VERSION: 'chain-1.0.0',
  };
  try { console.info('%c⛓ MythicChain%c ready — response windows active.', 'color:#b58cff;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
