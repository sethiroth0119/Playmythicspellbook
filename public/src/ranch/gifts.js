/* ══════════════════════════════════════════════════════════════════════════
   🎁 GIFTS — the favourite, and giving before you are asked.
   ──────────────────────────────────────────────────────────────────────────
   PURE LOGIC. No DOM, no globals, no imports (CLAUDE.md's globals trap:
   `Profile`, `HELD_ITEMS`, `adjustBond` are top-level `const` in index.html
   and an ES module cannot see them). The host hands in the pool, the card and
   the profile entry; this file decides and the host writes.

   🔴 WHAT THIS FIXES
   Items already flowed between the player and a companion — but only in ONE
   direction and only on demand: `_lqGenerate` opens a request, the unit asks
   for a specific thing, and `_LQ.equip` pays it off. The player could never
   simply GIVE. That is the half Monster Rancher's favourite food occupies:
   you know what your monster likes, nobody prompts you, and handing it over
   is a small ritual you perform because you want to.

   🔴 THE FAVOURITE IS DERIVED FROM THE CARD ID, NOT ROLLED.
   Exactly the rule `getUnitTemper` follows and for the same reason: every
   player's Ashen Pikeman wants the same thing, so a favourite is a knowable
   FACT about the card that can be learned, traded on and talked about — not a
   slot-machine pull that makes each copy a different puzzle. A Forge author
   can override it per card (`card.favourite` / `card.favorite`); absent that
   the hash is the source of truth, so a unit can never silently change taste.

   ⚖ WHY GIFTS ARE ON A COOLDOWN
   The request path is self-limiting: at most LQ_REQ_CAP requests are open at
   once and you must happen to hold the item. Unprompted giving has no such
   brake — without one, a player sitting on twenty Power Bands could buy a
   companion from Wary to Sworn in a single sitting, and every other loyalty
   source in the game (battles, banter, judgement, fulfilled requests) would
   become decorative. One gift per unit per 20h keeps it a ritual instead of a
   faucet. It is the same cooldown shape breeding already uses.
   ══════════════════════════════════════════════════════════════════════════ */

export const GIFT_COOLDOWN_MS = 20 * 3600 * 1000;   // as BREED_COOLDOWN_MS

/* Bond paid, before adjustBond() applies temperament.
   The favourite is worth roughly what fulfilling a REQUEST is worth, and no
   more — a gift you chose to give should not out-earn the thing they actually
   asked you for, or the request system becomes the worse option and dies. */
export const FAVOURITE_BASE = 34;   // + 5 per bond tier  →  34 (Wary) … 59 (Sworn)
export const FAVOURITE_PER_TIER = 5;
export const ORDINARY_GIFT = 8;     // flat. Kind, but they wanted something else.

/* Lines the companion says. Split by whether you got it right, because
   "thank you" for the wrong thing is the tell that they have a right thing. */
export const REPLIES = {
  favourite: [
    'You remembered. You actually remembered.',
    'How did you — no. Never mind. Thank you.',
    'I did not think anyone had noticed.',
  ],
  ordinary: [
    'Thank you. I will find a use for it.',
    'Appreciated. It is not what I would have picked, but appreciated.',
    'Kind of you.',
  ],
  unknown: [
    'Thank you.',
    'I will take it. Thank you.',
  ],
};

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Deterministic favourite. Same card, same favourite, for every player.
 *  `pool` is the host's gift pool (the union of LQ_ITEM_POOL); an empty or
 *  missing pool returns null rather than throwing, so a host that has not
 *  wired the bridge yet renders no gift panel instead of breaking the Table. */
export function favouriteOf(cardId, card, pool) {
  try {
    const p = Array.isArray(pool) ? pool.filter(Boolean) : [];
    if (!p.length) return null;
    const authored = card && (card.favourite || card.favorite);
    if (authored && p.indexOf(authored) >= 0) return authored;
    // An authored favourite OUTSIDE the pool is still honoured — a Forge author
    // naming a custom item means it, and silently overriding them with a hash
    // would look like the field does nothing.
    if (authored) return String(authored);
    const s = 'fav:' + String(cardId || '');
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return p[Math.abs(h) % p.length];
  } catch (e) { return null; }
}

/** Discovery follows the rule the card-detail modal set and the Table repeats:
 *  Steady (tier index 2). Below it you are still guessing, and the panel says
 *  so rather than printing the answer — otherwise bond stops gating anything. */
export const FAVOURITE_KNOWN_TIER = 2;
export function favouriteKnown(tierIdx) { return (tierIdx | 0) >= FAVOURITE_KNOWN_TIER; }

/** ms until this unit will accept another gift. 0 = ready. */
export function cooldownLeft(entry, now) {
  const t = num(entry && entry.lastGiftAt);
  if (t <= 0) return 0;
  const n = num(now) || Date.now();
  // A future-dated stamp (clock skew, a doctored save) must not lock the unit
  // out forever — treat anything ahead of now as ready.
  if (t > n) return 0;
  return Math.max(0, (t + GIFT_COOLDOWN_MS) - n);
}

/**
 * Resolve one unprompted gift. PURE — the caller consumes the item, applies
 * `bond` through the game's own adjustBond(), pushes `bind` onto boundItems
 * and stamps `lastGiftAt`.
 *
 * @returns {{ok, reason?, isFavourite, bond, line, bind}}
 */
export function give(o) {
  o = o || {};
  const entry = o.entry || {};
  const itemId = o.itemId;
  if (!itemId) return { ok: false, reason: 'noitem' };
  if (!(num(o.owned) > 0)) return { ok: false, reason: 'notowned' };
  const cd = cooldownLeft(entry, o.now);
  if (cd > 0) return { ok: false, reason: 'cooldown', cdLeft: cd };

  const fav = o.favourite || null;
  const isFavourite = !!fav && fav === itemId;
  const tierIdx = Math.max(0, o.tierIdx | 0);

  const bond = isFavourite
    ? FAVOURITE_BASE + FAVOURITE_PER_TIER * tierIdx
    : ORDINARY_GIFT;

  /* 🔴 THE REPLY DOES NOT LEAK THE ANSWER. Below Steady the companion thanks
     you the same way whether you guessed right or not, even though the BOND
     still lands in full. Printing "You remembered!" at Wary would hand the
     player the favourite through the back door and make FAVOURITE_KNOWN_TIER
     decorative — but withholding the loyalty too would punish a lucky guess,
     which is the one thing that should feel great. So: pay it, do not say it. */
    const known = favouriteKnown(tierIdx);
  const poolKey = !known ? 'unknown' : isFavourite ? 'favourite' : 'ordinary';
  const lines = REPLIES[poolKey];
  const line = lines[Math.abs(o.seed | 0) % lines.length];

  return { ok: true, isFavourite, bond, line, bind: itemId, known };
}

/** Short human string for the cooldown, for a disabled button. */
export function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}
