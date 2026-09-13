/* ════════════════════════════════════════════════════════════════════════════
   ⛓ THE AI's SIDE OF THE WINDOW — does the opponent respond, and with what?
   ----------------------------------------------------------------------------
   The AI gets the SAME legal-response list the player does (chain.engine's
   `responsesFor`), so it can never answer with something a player could not.
   That symmetry is the whole design: one rule set, two consumers.

   🔴 IT MUST NOT PLAY PERFECTLY. An opponent that always counters at the exact
   right moment is not "hard", it is unreadable — the player stops trying to
   play around it because there is nothing to play around. So the AI holds back
   by a threshold that scales with difficulty, and it deliberately misses some
   windows it could have won. Read `HOLD` below before tuning any of it.

   The scoring is intentionally small. A chain decision only has to answer one
   question — "is this worth spending my counter on?" — and the honest inputs
   are: how big is the threat, how good is my answer, and how many answers do I
   still hold. Everything else is noise dressed as intelligence.
   ════════════════════════════════════════════════════════════════════════════ */

import { bx } from './chain.bridge.js';
import { SPEED, topSpeedOf } from './chain.engine.js';

/* How reluctant the AI is to spend a response, per difficulty. Higher = holds
   its cards longer = easier to play around. These are thresholds on the 0..1
   score below, not probabilities.

   ⚠ `easy` is above 1.0 on purpose: an easy opponent essentially never chains,
   because the FIRST thing a new player must learn is that the chain exists and
   that their own plays resolve. Teaching that with an opponent who negates
   everything is how a mechanic gets a reputation for being unfair. */
const HOLD = { easy: 1.10, normal: 0.62, hard: 0.44, brutal: 0.30 };

/* A counter trap answering a mere unit effect is a waste, and the AI knowing
   that is most of what makes it feel competent. Value of what is being stopped,
   roughly normalised to 0..1. */
function threatScore(chain, state) {
  const b = bx();
  const top = chain.links[chain.links.length - 1];
  if (!top) {
    // Responding to the raw trigger (an attack declaration, a summon) rather
    // than to a card. Ask the bridge what it is worth; it sees the board.
    try { return Math.max(0, Math.min(1, +b.triggerThreat(chain.trigger, state) || 0)); } catch (e) { return 0.4; }
  }
  const def = top.def || {};
  let s = 0.34;
  if (def.negates) s += 0.34;                       // stopping a negate is high value
  if (top.speed >= SPEED.COUNTER) s += 0.16;
  if (def.destroy || def.banish) s += 0.18;
  if (def.massRemoval || def.aoe) s += 0.16;
  const cost = Math.max(0, Math.min(8, (def.cost | 0)));
  s += cost * 0.04;                                  // expensive cards tend to matter
  return Math.max(0, Math.min(1, s));
}

/* Is this particular answer a good fit for that threat? A negate scores high
   against anything; a damage trap scores poorly against a negate it cannot
   actually stop. */
function answerScore(opt, chain) {
  const def = opt.def || {};
  let s = 0.32;
  if (def.negates === 'chain') s += 0.40;
  else if (def.negates) s += 0.34;
  if (opt.speed >= SPEED.COUNTER) s += 0.12;
  // Prefer the CHEAPEST adequate answer — spending a counter trap where a quick
  // trap would do is the classic AI tell.
  s -= Math.max(0, Math.min(6, (def.cost | 0))) * 0.05;
  // Responding to nothing with a reactive card wastes it.
  if (!chain.links.length && def.negates) s -= 0.22;
  return Math.max(0, Math.min(1, s));
}

/* Pick a response, or null to pass.

   `options` comes from chain.engine.responsesFor — already speed-legal and
   already affordable, so this function only decides WHETHER and WHICH. */
export function choose(chain, options, state, difficulty) {
  if (!options || !options.length) return null;

  const hold = HOLD[String(difficulty || 'normal')] != null
    ? HOLD[String(difficulty || 'normal')]
    : HOLD.normal;

  const threat = threatScore(chain, state);

  // Scarcity: the fewer answers left, the more the AI hoards them. An opponent
  // down to its last counter should be visibly reluctant to burn it.
  const scarcity = options.length >= 3 ? 0 : options.length === 2 ? 0.06 : 0.13;

  let best = null, bestScore = -1;
  for (const o of options) {
    const score = threat * 0.62 + answerScore(o, chain) * 0.38 - scarcity;
    if (score > bestScore) { bestScore = score; best = o; }
  }

  if (bestScore < hold) return null;                 // holds the card — passes

  /* 🎲 THE DELIBERATE MISS. Even when the maths says respond, the AI passes a
     slice of the time. Without this the opponent is a wall: the player learns
     "my plays never resolve" instead of "I should bait the counter first",
     which is the actual skill the chain is there to teach. The slice shrinks
     as difficulty rises but never reaches zero, because a perfectly consistent
     opponent is unreadable at every difficulty. */
  const miss = difficulty === 'brutal' ? 0.05 : difficulty === 'hard' ? 0.12 : 0.22;
  if (Math.random() < miss) return null;

  return best;
}
