/* ════════════════════════════════════════════════════════════════════════════
   🏛 ETHOS HEIGHTS — REWARDS, COSTS AND INFLUENCE.
   ----------------------------------------------------------------------------
   This is the only file in /src/dilemma that touches the economy, which makes
   it the only one able to do lasting damage. Everything here is written to be
   read by somebody deciding whether to trust it with a player's wallet.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `App`, `Forge` are top-level
   `const` declarations in index.html — lexical globals, NOT properties of
   `window`. An ES module cannot see them, and `window.Profile` is `undefined`
   however global `const Profile` looks. There is not one bare global below.
   Cinder moves only through `host.spendGems` / `host.addGems`, which are the
   bridge's wrappers over the sanctioned helpers (index.html:64430 / 64454).
   `Profile.gems` is never written, never read, never named except in comments.

   💰 WHY THE PAYOUTS ARE SMALL, AND WHAT BOUNDS THEM.
   `sql/AUDIT_farmed_cinder.sql` exists because of a mint that "left NO
   distinguishing record — a farmed Cinder and an earned Cinder are the same
   integer in the same column. There is no 'exploit' flag to filter on."
   `sql/034_wallet_credit_bounds.sql` records the live distribution this feature
   joins: `addGems max 250,000, MEDIAN 2, over 65k rows`. A new faucet that
   cannot be told apart after the fact must therefore be small enough that it
   never needs telling apart. Four things bound it, and all four are enforced
   in this file rather than assumed:
     1. The BAND. Cinder amounts come from `DILEMMA_ECON.cinderBand`
        (120 / 400 / 900) and nowhere else — a choice names a band key, never
        a number.
     2. The CHANCE gate. `reward.chance` decides whether a reward lands at all,
        and `validateCorpus()` caps the share of choices that carry any reward
        at `maxPayingRatio`. "A dilemma that always pays is a vending machine."
     3. The CLAMP. `influenceValue` is clamped into the table's own range before
        it can scale anything, and the result is clamped to MAX_CINDER_GRANT
        below — the largest number the table can express. A corrupt save with
        `influence: 10000` cannot turn a 400 into a fortune.
     4. The CADENCE. `offerCooldownMs` is 45 minutes, so the whole feature is
        capped at roughly 1.3 resolutions an hour before any of the above.
   The admin has already switched a Cinder faucet off once for exactly this
   reason (`GEM_REWARDS` zeroed at index.html:64415-64421 — "it will devalue
   our money"). This one is built so it never has to be switched off.

   🔥 EVERY CREDIT CARRIES A DISTINCT REASON. `addGems(n, reason)` exists
   because "every Cinder faucet used to land in wallet_ledger as either
   'addGems' or an anonymous reconcile blob… Neither says WHERE the money came
   from, so the Cinder supply could not be audited" (index.html:64447-64453).
   Every credit from here reads `Dilemma: <dilemmaId>/<choiceId>` — greppable,
   attributable, one row per decision. sql/034 is blunt that this is for
   AUDITABILITY and never for authorisation: "p_reason CARRIES NO AUTHORITY.
   It is a client-supplied string." The bound is the amount; the reason is the
   paper trail.

   🔴 NO ROLLBACK, AND THAT IS THE DESIGN — see §"THE BASKET" above `grant()`.
   ⚙ ONE TUNING TABLE. Every number a reward is worth lives in `DILEMMA_ECON`
   (data.js) and nowhere else — the `_opEcon()` habit as index.html:80478-80480
   states it for CORP_LAWS. The only bare numbers below are 0, 1 and the 100
   that is the definition of "per cent".
   ⚠ THIS FILE NEVER WRITES DILEMMA STATE. It computes an Influence *delta* and
   hands it back; `engine.commit()` applies it. That split keeps the module DAG
   acyclic (rewards.js must not import engine.js) and keeps "who wrote this
   number" answerable.
   ════════════════════════════════════════════════════════════════════════════ */

import { DILEMMA_ECON } from './data.js';

/* ── Total helpers ──────────────────────────────────────────────────────────
   Every export below wraps its own body and returns a documented failure value
   rather than throwing. The dilemma is a feature; the game is the product, and
   a civic side-panel must never be the reason a session ends. */

function num(x) { const n = Number(x); return isFinite(n) ? n : 0; }
function int(x) { const n = Math.floor(num(x)); return isFinite(n) ? n : 0; }
function fmt(n) { try { return int(n).toLocaleString(); } catch (e) { return String(int(n)); } }
/* 🔴 EXISTENCE CHECK, NOT EXTRACTION — and this is not style.
   The first cut of this file did `const spend = host.spendGems; spend(n);`,
   which DETACHES `this`. The contracted bridge happens to use arrow properties
   so it survived, but a host written with method shorthand — including every
   test double anyone will ever write — throws on its first `this.` access, and
   the throw lands inside a try/catch that reads it as "the player cannot
   afford this". A driven test caught exactly that: every charge and every
   credit silently refused against a stub host. Every call below is
   `host.thing(...)` so the receiver is never lost. */
function has(host, name) { return !!(host && typeof host[name] === 'function'); }

/* Influence arrives from a save file, so it is treated as hostile input every
   time it is read. Clamping HERE rather than trusting engine.ensureState() is
   deliberate: this is the function that turns the number into money, and it
   must be correct even if it is called from a console, a test, or a future
   caller that skipped the normaliser. */
function clampInfluence(v) {
  const lo = num(DILEMMA_ECON.influenceMin);
  const hi = num(DILEMMA_ECON.influenceCap);
  return Math.max(lo, Math.min(hi, num(v)));
}

/* 🔴 THE HARD CEILING ON A SINGLE GRANT, derived from the table rather than
   typed. It is the largest band at the largest multiplier — no reward this
   feature can legitimately produce exceeds it, so anything that does is an
   arithmetic bug or a corrupt input, and it stops here rather than at the
   wallet. Computed once at load, because it cannot change while the page is up.
   A corrupt DILEMMA_ECON yields 0 and the feature pays nothing at all: paying
   nothing is a disappointment, paying an unbounded number is an incident. */
const MAX_CINDER_GRANT = (() => {
  try {
    const band = DILEMMA_ECON.cinderBand || {};
    let top = 0;
    for (const k in band) if (num(band[k]) > top) top = num(band[k]);
    const topMult = num(DILEMMA_ECON.rewardFloorMult) + num(DILEMMA_ECON.rewardSpanMult);
    const v = Math.round(top * topMult);
    return (isFinite(v) && v > 0) ? v : 0;
  } catch (e) { return 0; }
})();

/* Standing scales the purse: ×0.6 at influence 0, ×1.0 at 50, ×1.4 at 100.
   This is Influence consumer #2 of three (CONTRACT §9.3) and the only one that
   lives in this file — consumer #1 is the eligibility band in engine.eligible()
   and #3 is the choice-count floor in engine.rollChoices(). The relationship is
   the one NODE_TIERS has to the Cinder pool slice (src/nodes/tiers.js:30-38 —
   "the pool now distributes by standing rather than first-come-first-served")
   and frRankFor has to the Foundation Reserve. */
function rewardMult(influenceValue) {
  const inf = clampInfluence(influenceValue);
  const cap = num(DILEMMA_ECON.influenceCap) || 1;   // never divide by a corrupt 0
  return num(DILEMMA_ECON.rewardFloorMult) + num(DILEMMA_ECON.rewardSpanMult) * (inf / cap);
}

/* 🔴 ONE ARITHMETIC, TWO CALLERS. `describeChoice()` shows this number and
   `rollReward()` pays it. They call the same function on purpose: the moment
   a preview computes its own version of a payout, the two drift and the modal
   starts lying. That drift is a live bug in a reference file — house.camp.js:
   151-153 promises "No rest-quality modifier here" while house.camp.js:88 runs
   at CAMP_REST_QUALITY = 0.75. The same rule the citizens use for speech
   (citizens.city.js:406-408 — the bubble shows the worst mood term VERBATIM
   "so the bubble and the dialog can never disagree"), applied to money. */
function cinderFor(choice, influenceValue) {
  const key = choice && choice.reward && choice.reward.cinder;
  if (!key) return 0;                                   // card-only rewards are legal
  const band = (DILEMMA_ECON.cinderBand || {})[key];
  if (!(num(band) > 0)) return 0;                       // an unknown band key pays nothing
  const raw = Math.round(num(band) * rewardMult(influenceValue));
  // Math.max(1, …) so a real reward can never round away to zero, mirroring the
  // anti-rounding guard adjustBond uses on bond (index.html:72533-72534).
  return Math.min(MAX_CINDER_GRANT, Math.max(1, raw));
}

/* A choice's Cinder cost, normalised. Anything that is not a positive number is
   "no cost" — a cost leg that is present but zero is not a price, and letting
   it through would call spendGems(0), which returns TRUE (index.html:64432)
   and reads in a log as a successful charge that never happened. */
function costOf(choice) {
  const n = int(choice && choice.cost && choice.cost.cinder);
  return n > 0 ? n : 0;
}

/* The six shipped rarity ids capitalise to their exact display names — verified
   against RARITIES at index.html:39231-39238 (common → Common, … mythic →
   Mythic). Deriving the label rather than copying the table means a seventh
   rarity added upstream still reads sensibly here instead of showing an id. */
function rarityLabel(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* A probability as a whole per cent. The 100 is the definition of the unit, not
   a dial. Math.max(1, …) so a genuinely possible reward never advertises "0%"
   — a one-in-three-hundred chance is small, but it is not none, and the modal
   must not say otherwise. */
function pct(p) {
  const v = num(p);
  if (v <= 0) return 0;
  if (v >= 1) return 100;
  return Math.max(1, Math.round(v * 100));
}

function probOf(x, fallback) {
  const v = Number(x);
  if (!isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/* ════════════════════════════════════════════════════════════════════════════
   1. DERIVED EFFECT TEXT
   ════════════════════════════════════════════════════════════════════════════
   Every player-facing number in this feature is generated here from
   DILEMMA_ECON and the choice — never hand-written in data.js. Retuning the
   table retunes the copy, and the corpus author cannot promise a payout the
   economy will not make. That is the single most reviewable difference between
   this feature and the reference files.

   The chance is SHOWN, not hidden. "Not every dilemma pays" is the mechanism
   the whole reward design rests on; a player who is not told the odds reads a
   dry roll as a broken button. */
export function describeChoice(choice, influenceValue) {
  const out = { costText: '', rewardText: '', influenceText: '', affordable: null };
  try {
    if (!choice || typeof choice !== 'object') return out;

    const cost = costOf(choice);
    if (cost > 0) out.costText = 'costs ' + fmt(cost) + ' 🔥';

    const r = choice.reward;
    if (r && typeof r === 'object') {
      const landP = probOf(r.chance, 1);                 // the reward lands AT ALL
      const parts = [];

      const cinder = cinderFor(choice, influenceValue);
      if (cinder > 0 && landP > 0) {
        parts.push('+' + fmt(cinder) + ' 🔥' + (landP < 1 ? ' (' + pct(landP) + '%)' : ''));
      }

      // The card's odds are CONDITIONAL on the reward landing, so the number
      // shown is the product. Showing the nested chance on its own would
      // overstate it, which is the kind of small dishonesty a player finds out
      // about across twenty resolutions.
      if (r.card && typeof r.card === 'object') {
        const cardP = landP * probOf(r.card.chance, 1);
        if (cardP > 0) {
          const lab = rarityLabel(r.card.rarity);
          // 'an Epic card', 'an Uncommon card' — two of the six shipped rarity
          // ids start with a vowel, and "a Epic card" in a gold modal reads as
          // machine output rather than as somebody telling you what happened.
          const art = /^[aeiou]/i.test(lab) ? 'an ' : 'a ';
          parts.push((lab ? art + lab + ' card' : 'a card') + (cardP < 1 ? ' (' + pct(cardP) + '%)' : ''));
        }
      }

      out.rewardText = parts.join(' · ');
    }

    const inf = influenceDelta(choice);
    if (inf > 0) out.influenceText = '+' + inf + ' standing';
    // U+2212 MINUS, not a hyphen: it sits on the same optical line as the plus
    // and this codebase already uses it for a computed subtraction in the camp
    // log ("−26 threat, +rep", index.html:65949).
    else if (inf < 0) out.influenceText = '−' + Math.abs(inf) + ' standing';

    return out;
  } catch (e) { return { costText: '', rewardText: '', influenceText: '', affordable: null }; }
}

/* ════════════════════════════════════════════════════════════════════════════
   2. COST — GATED, NEVER A FINE
   ════════════════════════════════════════════════════════════════════════════
   CONTRACT §8.2: every Cinder loss in this feature is a COST the choice is
   gated on. Unavoidable losses are Influence only.

   Two shipped precedents conflict and picking one makes the ambiguity
   unreachable. `spendGems()` refuses when the player cannot afford it — right
   for a cost, wrong for a fine that must still land. `_reconApplyEffects`
   (index.html:216107-216108) does a clamped direct decrement instead, which the
   0.6s `_gemsTaxTick` poll then bills 2% civic tax on, two lines below a comment
   arguing civic tax should not be booked on a fine. Choosing "cost, always"
   keeps this feature on the one sanctioned path and out of that argument. */

/* Drives the DISABLED state of the button. This must exist, because
   `spendGems()` returning false is the ONLY thing that happens on insufficient
   funds — no toast, no clamp, no render (index.html:64434). An ungated button
   would simply do nothing when pressed, which reads as a broken feature. */
export function canAfford(host, choice) {
  try {
    const n = costOf(choice);
    // A free choice is affordable without asking anybody. Consulting the host
    // first would let a missing bridge disable every free choice in the modal.
    if (n <= 0) return true;
    if (!has(host, 'gems')) return false;     // cannot verify a real cost ⇒ refuse
    return int(host.gems()) >= n;
  } catch (e) { return false; }
}

/* Charge the player. Returns { ok, why }; never throws.

   🔴 THE STRICTNESS HERE IS ASYMMETRIC TO grant()'s, ON PURPOSE.
   For a CHARGE, an ambiguous return must never be read as "paid" — that hands
   out a free choice. For a CREDIT (see grant) an ambiguous return must never be
   read as "failed" — this repo has already been bitten by a mutator that
   returned undefined on success and made a rollback path fire on a leg that
   actually worked, which is why the index.html bridge wrappers end in
   `return true` rather than falling off the end (settle.js's io contract).
   Both directions are then settled by re-reading the balance, which is the
   settle.js "VERIFIED DELIVERY" precedent: it turns "should not happen" into
   "cannot happen unnoticed".

   The re-read is sound because `spendGems` decrements `Profile.gems`
   synchronously (index.html:64433) and only fires the cloud write afterwards;
   nothing — including the 0.6s tax poll — can run between two adjacent
   synchronous statements. */
export function payCost(host, choice) {
  try {
    const n = costOf(choice);
    if (n <= 0) return { ok: true, why: '' };

    if (!has(host, 'spendGems')) return { ok: false, why: 'The ledger is unavailable — nothing was charged.' };

    const canRead = has(host, 'gems');
    let before = null, after = null;
    try { before = canRead ? int(host.gems()) : null; } catch (e) { before = null; }

    let said = false;
    try { said = host.spendGems(n) === true; } catch (e) { said = false; }

    try { after = canRead ? int(host.gems()) : null; } catch (e) { after = null; }

    const moved = (before === null || after === null) ? null : (before - after);

    // Balance is the authority when we can read it; the return value only when
    // we cannot. `moved >= n` rather than `=== n` so a concurrent legitimate
    // spend in another tab cannot make a real charge look like a failure.
    if (moved === null) {
      if (said) return { ok: true, why: '' };
      return { ok: false, why: 'Not enough Cinder.' };
    }
    if (moved >= n) return { ok: true, why: '' };
    if (moved <= 0) return { ok: false, why: 'Not enough Cinder.' };

    // Cinder left the wallet but not the full amount. spendGems cannot do this,
    // so reaching here means something outside this file moved the balance
    // mid-charge. Refusing is right — the choice does not proceed — and saying
    // so plainly is better than a generic "not enough", because the player can
    // see their own wallet and would otherwise think we are lying to them.
    return { ok: false, why: 'The charge only partly went through — the decision was not taken.' };
  } catch (e) {
    return { ok: false, why: 'The ledger refused the charge — nothing was taken.' };
  }
}

/* Put a paid cost back. Called from exactly one place: index.js's resolve
   transaction, when `engine.commit()` could not persist the resolution
   (CONTRACT §9.4 step 2). The player paid for a decision the save never
   recorded, so the money comes back.

   ⚠ THE 2% FOUNDATION SPEND TAX DOES NOT COME BACK, and that is stated rather
   than hidden. `_gemsTaxTick` (index.html:56789-56834) polls every ~0.6s, sees
   any net decrease of Profile.gems, and bills civic tax on it — so by the time
   this runs, the tax on the original spend may already be booked. The clean fix
   would be `_gemsTaxExempt` (index.html:56777), and it was deliberately NOT put
   on the bridge: this path only runs on a save failure, which is rare and is
   already being reported to the player, and adding a tax-suppression hole to
   the bridge to recover a few Cinder on a failure path is a worse trade than
   eating the asymmetry. If refunds ever become routine, revisit this first.

   ⚠ NEVER a negative addGems. `addGems` guards on `amount === 0`
   (index.html:64456), so a negative decrements Profile.gems locally while
   `_serverMirrorCredit` clamps to Math.max(0,…) and returns early — a durable
   client/server divergence. This function only ever adds. */
export function refundCost(host, choice) {
  try {
    const n = costOf(choice);
    if (n <= 0) return true;                   // nothing was charged; nothing to give back
    if (!has(host, 'addGems')) return false;
    // A refund is its own faucet in wallet_ledger and gets its own greppable
    // label. It carries the choice id but not a dilemma id, because refundCost
    // is deliberately callable without an instance — the failure it exists for
    // is a save that did not persist, and the instance is not what failed.
    const cid = (choice && choice.id) ? String(choice.id) : 'unknown';
    return host.addGems(n, 'Dilemma refund: ' + cid) !== false;
  } catch (e) { return false; }
}

/* ════════════════════════════════════════════════════════════════════════════
   3. THE ROLL — PURE
   ════════════════════════════════════════════════════════════════════════════
   No host, no side effects, no Math.random(). The rng arrives from the
   instance (engine.makeRng over the instance seed), so a resolution is
   reproducible from (dilemma.id, openedAt) alone and a bug report is
   actionable. Being pure is also what lets the render layer show an honest
   preview band without minting anything.

   ⚠ NO RNG ⇒ NOTHING PAYS. That is the safe direction and it is deliberate:
   a caller that forgot the rng gets a disappointment, never a payout, and a
   preview path that accidentally reached this function cannot mint. */
export function rollReward(choice, influenceValue, rng) {
  const none = { cinder: 0, card: null, paid: false };
  try {
    if (!choice || !choice.reward || typeof choice.reward !== 'object') return none;
    if (typeof rng !== 'function') return none;

    const r = choice.reward;

    // 1. Does the reward land at all? This gate plus validateCorpus's
    //    maxPayingRatio is the whole of "not every dilemma pays".
    const landP = probOf(r.chance, 1);
    if (!(rng() < landP)) return none;

    const cinder = cinderFor(choice, influenceValue);

    // 2. The card is a REQUEST, not a grant. Nothing is minted in a pure
    //    function; grant() executes this against the host.
    let card = null;
    if (r.card && typeof r.card === 'object') {
      if (rng() < probOf(r.card.chance, 1)) card = { rarity: r.card.rarity || null };
    }

    // A reward that "landed" and produced neither Cinder nor a card is not a
    // payout. This happens on a card-only reward whose nested card roll misses,
    // and on a corpus edit that names a band key cinderBand does not carry.
    // ⚠ NOTED DISAGREEMENT WITH THE CONTRACT, and it changes nothing the player
    // sees: a strict reading of §8's step list returns paid:true with an empty
    // basket here. grant() then does nothing and falls through to its own
    // "nothing was set aside" line, so both readings render the same modal.
    // paid:false is chosen because it makes the flag mean what it says, and
    // because a downstream reader that trusts paid:true would otherwise
    // announce a purse that is empty.
    if (cinder <= 0 && !card) return none;
    return { cinder, card, paid: true };
  } catch (e) { return none; }
}

/* The Influence a choice moves. Signed, integer, clamped to the table's
   declared maximum so a hand-edited corpus cannot mint standing.
   rewards.js computes it; engine.commit() applies and persists it. This file
   never writes Profile.dilemma. */
export function influenceDelta(choice) {
  try {
    const raw = choice && choice.influence;
    if (typeof raw !== 'number' || !isFinite(raw)) return 0;
    const cap = Math.abs(int(DILEMMA_ECON.influenceMax));
    const v = Math.trunc(raw);
    return Math.max(-cap, Math.min(cap, v));
  } catch (e) { return 0; }
}

/* ════════════════════════════════════════════════════════════════════════════
   4. THE BASKET — grant()
   ════════════════════════════════════════════════════════════════════════════
   🔴 THERE IS NO ROLLBACK IN THIS BASKET, AND THAT IS THE DESIGN.

   cost.js and settle.js both unwind on a failed leg, and both can: a resource
   or a Cinder deduction has an exact inverse (`refundRes`, `addGems`) that puts
   the player back where they were. This basket does not have that property, in
   either leg:
     • A granted CARD cannot be un-granted. The bridge's grantCard() has already
       incremented Profile.cardCollection and saved; there is no take-back on
       the bridge and adding one would hand a module the ability to delete a
       player's property to recover from its own bug.
     • Granted CINDER cannot be un-granted honestly. `addGems(-n)` is a durable
       client/server divergence (the guard is `amount === 0`, and
       _serverMirrorCredit clamps to Math.max(0,…) and returns early). Clawing
       it back with `spendGems(n)` would be billed 2% Foundation Tax by the
       _gemsTaxTick poll — charging the player tax on money they never spent —
       and would simply refuse if they had already spent it, leaving a partial
       unwind anyway.

   So instead of an unwind that cannot be honest, the legs are ORDERED so that
   none is ever needed. This is settle.js's rule ("the leg most likely to fail
   is then the cheapest to unwind") applied to a basket where one leg has no
   inverse at all:

       LEG 1 — THE CARD, first, because it is the leg that can legitimately
               decline. grantCard() returns null whenever the pack pool is empty,
               which is legal any time Forge.useCustomOnlyPool is on with no
               published customs (index.html:64909, 64934). A declined card
               before any credit costs nothing and needs no unwind.
       LEG 2 — THE CINDER, last, because it is the leg with no inverse. Nothing
               runs after it that could want it back.

   AND THE ASYMMETRY THAT MAKES "NO ROLLBACK" SAFE: this basket is a GIFT. The
   choice's cost was charged earlier, by payCost(), and it bought the DECISION,
   not the reward — index.js refunds it only when engine.commit() fails to
   persist (CONTRACT §9.4 step 2). So a half-landed reward leaves the player
   strictly better off than before it ran and never worse. A shortfall in a gift
   is not a debt. What the system owes them is the truth about it: `ok` goes
   false, `why` names the leg, and `lines` says so in the modal.

   A failed leg 1 does NOT abort leg 2. Withholding the Cinder because our card
   grant misbehaved punishes the player for our bug.

   🃏 THE INERT-CARD CHECK. Granting an id the game has no definition for is
   worse than granting nothing: the row in cardCollection is real, permanent and
   unusable — the same failure the repo already recorded for resource ids that
   exist in a loot table and not in the ledger ("their pile of it is real and
   inert"). The first line of defence is on the far side of the bridge, where
   grantCard picks the CARD OBJECT out of getCardPoolForPacks() and uses
   `pick.card.id`, so the id provably resolves (index.html:64907-64953). This is
   the second: after the grant, the id is re-resolved through host.cardById()
   (_cardDefById, index.html:87319) and a miss is reported as a failed leg.
   Belt and braces, exactly as settle.js re-reads a balance after addRes().
   ⚠ If the host cannot verify (no cardById accessor) we do NOT flag — an
   unverifiable grant is not a bad grant, and crying wolf on a partial bridge
   would make the honest signal worthless.

   `lines` are PLAIN TEXT in the house voice, one leading emoji each, no markup.
   They interpolate card names, which on a Forge card are player-authored, so
   render.js escapes them with its local esc(). Never hand these to innerHTML
   directly. */
export function grant(host, instance, choice, rolled) {
  const fail = (why) => ({ ok: false, cinder: 0, card: null, lines: [], why: why });
  try {
    if (!host) return fail('The ledger is unavailable — nothing was granted.');

    const out = { ok: true, cinder: 0, card: null, lines: [], why: '' };
    const roll = rolled || {};

    // Nothing was promised: stay quiet. A "nothing came of it" line on a choice
    // that never carried a reward is noise, and most choices carry none.
    if (!choice || !choice.reward) return out;

    if (!roll.paid) {
      out.lines.push('🌫 Nothing was set aside for you this time.');
      return out;
    }

    // ── LEG 1: THE CARD ────────────────────────────────────────────────────
    if (roll.card) {
      // `unconfirmed` covers both "the accessor is missing" and "the accessor
      // threw". They are the same thing from here: a promised card whose fate
      // we cannot state. A missing accessor is NOT folded into the empty-pool
      // branch, because that branch tells the player the ruins were bare — a
      // sentence we would have no grounds for.
      let picked = null, unconfirmed = false;
      if (!has(host, 'grantCard')) {
        unconfirmed = true;
      } else {
        try { picked = host.grantCard({ rarity: roll.card.rarity || null }); }
        catch (e) { unconfirmed = true; picked = null; }
      }

      if (unconfirmed) {
        out.ok = false;
        out.why = 'The card grant failed and could not be confirmed.';
        out.lines.push('⚠ The find could not be confirmed — check your collection before you count on it.');
      } else if (!picked || !picked.id) {
        // NOT a failure. The pool is legitimately empty sometimes, and the
        // honest answer is that the ruins had nothing, not that we broke.
        out.lines.push('🌫 Nothing came out of the ruins this time.');
      } else {
        let def = null, checked = false;
        if (has(host, 'cardById')) {
          checked = true;
          try { def = host.cardById(picked.id); } catch (e) { def = null; }
        }
        if (checked && !def) {
          out.ok = false;
          out.why = 'The granted card id does not resolve to a definition on this device.';
          out.lines.push('⚠ Ouroboros logged the find and could not read it — the card sits in your collection, inert.');
        } else {
          out.card = picked;
          const lab = rarityLabel(picked.rarity);
          const name = String(picked.name || picked.id);
          out.lines.push('📦 One card came back out of the ruins — ' + name + (lab ? ', ' + lab + '.' : '.'));
        }
      }
    }

    // ── LEG 2: THE CINDER ──────────────────────────────────────────────────
    const want = Math.min(MAX_CINDER_GRANT, Math.max(0, int(roll.cinder)));
    if (want > 0) {
      if (!has(host, 'addGems')) {
        out.ok = false;
        out.why = out.why || 'The wallet is unavailable — the purse did not arrive.';
        out.lines.push('⚠ The purse was counted out and never arrived. Nothing was taken from you.');
      } else {
        const canRead = has(host, 'gems');
        let before = null, after = null;
        try { before = canRead ? int(host.gems()) : null; } catch (e) { before = null; }

        // 🔴 GENEROUS ON A CREDIT: `!== false`, not `=== true`. A host adapter
        // that returns undefined on a credit that actually worked must not make
        // this look like a failure — that exact shape (a mutator returning
        // undefined on success firing a rollback path) is a scar this repo
        // already carries. The balance re-read below is what really decides.
        let said = false;
        try { said = host.addGems(want, reasonFor(instance, choice)) !== false; } catch (e) { said = false; }

        try { after = canRead ? int(host.gems()) : null; } catch (e) { after = null; }

        const delivered = (before === null || after === null)
          ? (said ? want : 0)
          : Math.max(0, after - before);

        out.cinder = delivered;
        if (delivered >= want) {
          out.lines.push('🔥 The ward settled up on the spot — ' + fmt(want) + ' Cinder.');
        } else if (delivered > 0) {
          // addGems has no upper clamp, so this should be unreachable. Reported
          // rather than smoothed over: a short credit is exactly the class of
          // silent loss the verified-delivery check in settle.js exists for,
          // and guessing a top-up here risks double-crediting on a lying read.
          out.ok = false;
          out.why = out.why || 'Part of the promised Cinder did not arrive.';
          out.lines.push('🔥 Part of the purse arrived — ' + fmt(delivered) + ' Cinder, short of what was counted.');
        } else {
          out.ok = false;
          out.why = out.why || 'The promised Cinder did not arrive.';
          out.lines.push('⚠ The purse was counted out and never arrived. Nothing was taken from you.');
        }
      }
    }

    // Everything rolled, nothing landed, nothing broke — say it plainly rather
    // than showing an empty aftermath panel.
    if (!out.lines.length) out.lines.push('🌫 Nothing was set aside for you this time.');
    return out;
  } catch (e) {
    return fail('The reward could not be granted: ' + ((e && e.message) ? e.message : String(e)));
  }
}

/* ── Attribution ────────────────────────────────────────────────────────────
   The reason string every credit carries. Built defensively because it must
   never be blank or defaulted: `addGems` falls back to the literal 'addGems'
   when the reason is missing (index.html:64472), and that anonymous label is
   precisely why the Cinder supply could not be audited in the first place.
   A dilemma with a broken instance still produces an attributable row. */
function choiceRef(instance, choice) {
  const d = (instance && instance.dilemma && instance.dilemma.id) ? String(instance.dilemma.id) : 'unknown';
  const c = (choice && choice.id) ? String(choice.id) : 'unknown';
  return d + '/' + c;
}

function reasonFor(instance, choice) {
  return 'Dilemma: ' + choiceRef(instance, choice);
}
