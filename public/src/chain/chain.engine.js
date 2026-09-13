/* ════════════════════════════════════════════════════════════════════════════
   ⛓ THE CHAIN — priority passing and LIFO resolution.
   ----------------------------------------------------------------------------
   This is the piece the game was missing. Before this file a trap on a tile
   just *sprang*: the game decided, the player watched. There was `negate` in
   the card pool and nothing to negate INTO, because effects never queued — they
   applied the instant they fired, so there was no moment in which a second
   effect could be aimed at the first.

   A chain is that moment, made explicit:

     1. Something happens (an attack is declared, a card is activated, a unit is
        summoned, a trap springs). That becomes CHAIN LINK 1.
     2. Priority passes to the OTHER side. They may add Link 2 in response.
     3. Priority passes back. Alternates until BOTH sides pass in a row.
     4. The chain resolves BACKWARDS — the last link added resolves FIRST.

   Step 4 is the whole point and the part that feels wrong until it clicks: the
   card played LAST resolves FIRST, which is why a negate works at all. You
   respond to a trap with a counter; your counter is Link 2; Link 2 resolves
   before Link 1; Link 1 is gone before it ever did anything.

   🔴 SPEED IS THE ONLY THING STOPPING AN INFINITE CHAIN.
   Borrowed wholesale from Yu-Gi-Oh's spell speed, because thirty years of play
   testing beats anything invented here on a Tuesday:

     SPEED 1  normal spells, unit effects, on-play abilities.
              CAN START a chain. CAN NEVER RESPOND to one.
     SPEED 2  traps, quick-play spells, most reactions.
              Responds to speed 1 or 2.
     SPEED 3  counter traps ONLY.
              Responds to anything — and ONLY a speed 3 may respond to a speed 3.

   Read the last line again: it is the termination guarantee. Because a speed 3
   can only be answered by another speed 3, and the pool of speed 3 cards a
   player holds is finite and each is spent on use, every chain terminates. If
   you ever add a card that generates speed 3 cards, you have introduced a
   possible infinite loop, and CHAIN_MAX_LINKS below is the backstop that will
   catch it — it is not decoration.

   ⚠ THIS FILE RESOLVES NOTHING ITSELF. It decides WHAT resolves and in WHAT
   ORDER, and hands the ordered list back. The battle in index.html applies the
   effects, because that is where the board lives. Keeping application out of
   here is what lets the chain be unit-tested and what stops it from becoming a
   second, divergent copy of the combat rules.
   ════════════════════════════════════════════════════════════════════════════ */

import { bx } from './chain.bridge.js';

/* Hard ceiling. A legal chain in a shipped card game rarely passes 6 links;
   anything past this is a rules bug or a loop, and dropping the excess is
   strictly better than hanging the battle. See the speed-3 note above. */
export const CHAIN_MAX_LINKS = 12;

export const SPEED = { NORMAL: 1, QUICK: 2, COUNTER: 3 };

/* ── Speed of a card ──────────────────────────────────────────────────────
   Explicit `chainSpeed` on the card def wins (that is the admin-forged knob).
   Otherwise inferred from the kind the card already carries, so the entire
   existing card pool gets a sane speed without a data migration.

   The inference: traps are reactive by nature (speed 2); a trap flagged
   `counter: true` is a counter trap (speed 3); a spell flagged `quickPlay` is
   speed 2; everything else — units, normal spells, fields, relics — is speed 1
   and therefore may open a chain but never answer one. */
export function speedOf(def) {
  if (!def) return SPEED.NORMAL;
  const explicit = parseInt(def.chainSpeed, 10);
  if (explicit >= 1 && explicit <= 3) return explicit;
  const kind = String(def.kind || def.type || '').toLowerCase();
  if (kind === 'trap') return def.counter ? SPEED.COUNTER : SPEED.QUICK;
  if (kind === 'spell') return def.quickPlay ? SPEED.QUICK : SPEED.NORMAL;
  return SPEED.NORMAL;
}

export function speedLabel(s) {
  return s === SPEED.COUNTER ? 'Counter' : s === SPEED.QUICK ? 'Quick' : 'Normal';
}

/* ── May `def` be added on top of the chain as it currently stands? ───────
   `topSpeed` is the speed of the link currently on top (0 for an empty chain,
   i.e. the card would be opening the chain itself).

   Note the asymmetry, and that it is deliberate: opening a chain (topSpeed 0)
   accepts ANY speed, because a counter trap is allowed to be the thing that
   starts a chain. It is only RESPONDING that speed restricts. */
export function canRespond(def, topSpeed) {
  const s = speedOf(def);
  if (!topSpeed) return true;                  // opening the chain — no restriction
  if (topSpeed >= SPEED.COUNTER) return s >= SPEED.COUNTER;   // only a counter answers a counter
  return s >= SPEED.QUICK;                     // speed 1 can never respond
}

/* ── A chain in progress ──────────────────────────────────────────────────
   `links` is in the order added (Link 1 first). Resolution walks it BACKWARDS.
   `passes` counts CONSECUTIVE passes; two in a row closes the window. It is
   reset to 0 by every added link, which is what lets a chain keep growing as
   long as somebody keeps responding. */
export function newChain(trigger) {
  return {
    trigger: trigger || { kind: 'unknown' },
    links: [],
    passes: 0,
    priority: null,     // whose turn it is to respond — set by open()
    closed: false,
    /* 🔴 CARDS ALREADY SPENT ON THIS CHAIN. A card put on the chain is being
       USED; it must never be offered again in the same window. Without this,
       a bridge whose `pay()` deducts a cost but does not remove the card from
       the zone will keep re-offering the identical card until either the cost
       runs out or CHAIN_MAX_LINKS trips — which is exactly what the browser
       mount probe produced: a 12-link chain of one trap answering itself.
       The MAX_LINKS ceiling caught it, but a backstop that fires in ordinary
       play is not a backstop, it is the mechanism, and it would have shipped
       as "sometimes the chain goes mad". */
    spent: Object.create(null),
  };
}

export function topSpeedOf(chain) {
  if (!chain || !chain.links.length) return 0;
  return chain.links[chain.links.length - 1].speed | 0;
}

/* Add a link. Returns false (and changes nothing) if the card may not legally
   respond to the current top — the caller should never offer such a card, but
   this is the rule, so this is where it is enforced rather than in the UI. */
export function addLink(chain, link) {
  if (!chain || chain.closed) return false;
  if (chain.links.length >= CHAIN_MAX_LINKS) {
    try { console.warn('[chain] CHAIN_MAX_LINKS hit — refusing further links. This is a loop or a rules bug, not normal play.'); } catch (e) {}
    return false;
  }
  const def = link && link.def;
  if (!canRespond(def, topSpeedOf(chain))) return false;
  chain.links.push({
    id: link.id || ('lnk' + chain.links.length + '_' + Date.now()),
    side: link.side,                  // 'player' | 'ai'
    def,
    speed: speedOf(def),
    source: link.source || 'hand',    // 'hand' | 'field' | 'grave' | 'trap'
    targetId: link.targetId || null,
    tile: link.tile || null,
    label: link.label || (def && def.name) || 'Effect',
  });
  // Burn the card for the rest of this chain — see `spent` in newChain().
  if (link && link.uid) chain.spent[link.uid] = true;
  chain.passes = 0;                   // a response re-opens the window for the other side
  return true;
}

export function pass(chain) {
  if (!chain || chain.closed) return false;
  chain.passes++;
  if (chain.passes >= 2) chain.closed = true;
  return chain.closed;
}

/* ── Resolution order: LAST IN, FIRST OUT ────────────────────────────────
   The single most important four lines in this folder. A chain of
   [Link1, Link2, Link3] resolves Link3 → Link2 → Link1.

   Each entry is tagged `negated` by applyNegations below; the battle must SKIP
   a negated link's effect while still sending the card to the graveyard, which
   is how negation reads correctly to a player: the card was used, it just did
   nothing. */
export function resolutionOrder(chain) {
  if (!chain) return [];
  return chain.links.slice().reverse();
}

/* ── Negation ─────────────────────────────────────────────────────────────
   Walks the chain in RESOLUTION order and lets each link's negate flag knock
   out what it was aimed at. Two kinds, which is all the existing card pool
   needs:

     negates: 'link'  — kills the single link directly beneath it (the thing it
                        was played in response to). The common case.
     negates: 'chain' — kills EVERY unresolved link beneath it. The rare, loud
                        one; a full chain blowout.

   ⚠ ORDER MATTERS AND IT IS THE REVERSE OF INTUITION. We walk top-down (the
   resolution order), so a negate higher in the chain has already been evaluated by
   the time we reach what it negated. A negated link cannot itself negate —
   checked explicitly below, because a chain of three mutual negates otherwise
   produces a different answer depending on which end you start from, and this
   is the end the rules say to start from. */
export function applyNegations(chain) {
  const order = resolutionOrder(chain);
  const negated = Object.create(null);
  for (let i = 0; i < order.length; i++) {
    const link = order[i];
    if (negated[link.id]) continue;            // a negated link negates nothing
    const mode = link.def && link.def.negates;
    if (!mode) continue;
    if (mode === 'chain') {
      for (let j = i + 1; j < order.length; j++) negated[order[j].id] = link.id;
    } else {
      // 'link' (or any truthy value) — the one immediately below this one.
      const below = order[i + 1];
      if (below) negated[below.id] = link.id;
    }
  }
  return order.map(l => ({
    ...l,
    negated: !!negated[l.id],
    negatedBy: negated[l.id] || null,
  }));
}

/* ── What may this side legally add right now? ───────────────────────────
   Pulls the side's playable cards from the bridge and filters by speed and by
   whether the cost can be paid. The UI renders exactly this list; the AI picks
   from exactly this list. One source of truth for "what can respond".

   `source` filtering: a set trap on the board is answerable from 'field', a
   quick-play from 'hand'. Grave effects are included because this codebase
   already has in-grave triggers (_activateGraveCard), and they were the single
   clearest thing that wanted a response window and never had one. */
export function responsesFor(chain, side, state) {
  const b = bx();
  const top = topSpeedOf(chain);
  const out = [];
  const seen = Object.create(null);

  const consider = (entry, source) => {
    if (!entry) return;
    const def = entry.def || b.cardDef(entry.id || entry.cardId || entry);
    if (!def) return;
    if (!canRespond(def, top)) return;
    // A card may declare itself unusable as a response even at the right speed
    // (e.g. "only during your own turn"). Honour it; never guess around it.
    if (def.noResponse) return;
    const key = source + ':' + (entry.uid || entry.id || def.id);
    if (seen[key]) return;
    seen[key] = 1;
    // Already put on THIS chain — a card is used once per window. See `spent`.
    if (chain && chain.spent && chain.spent[entry.uid || key]) return;
    if (!b.canPay(def, side, state)) return;
    out.push({
      uid: entry.uid || key,
      def,
      side,
      source,
      speed: speedOf(def),
      tile: entry.tile || null,
      label: def.name || 'Effect',
    });
  };

  try { (b.hand(side, state) || []).forEach(e => consider(e, 'hand')); } catch (e) {}
  try { (b.field(side, state) || []).forEach(e => consider(e, e && e.isTrap ? 'trap' : 'field')); } catch (e) {}
  try { (b.grave(side, state) || []).forEach(e => consider(e, 'grave')); } catch (e) {}

  return out;
}

/* ── A readable transcript ────────────────────────────────────────────────
   Fed to the battle log so a player can see WHY the thing they played did
   nothing. "Your trap was negated" with no chain shown is the single most
   common complaint about games with a chain, and it is entirely a UI failure,
   not a rules one. */
export function describe(resolved) {
  return (resolved || []).map((l, i) => {
    const who = l.side === 'player' ? 'You' : 'Opponent';
    const n = resolved.length - i;              // link number, counting down
    if (l.negated) return `⛓ Link ${n} — ${who}: ${l.label} — 🚫 NEGATED`;
    return `⛓ Link ${n} — ${who}: ${l.label} resolves`;
  });
}
