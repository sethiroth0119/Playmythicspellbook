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
   bridge's wrappers over the sanctioned helpers (`spendGems`, index.html:64475
   / `addGems`, index.html:64499).
   `Profile.gems` is never written, never read, never named except in comments.

   🔴 THE BALANCE READS `number | null`, AND THE DIFFERENCE IS THE FEATURE.
   Round 1 built this file around an "unreadable balance" fallback that could
   never fire. Both wrappers on the way here collapsed every failure to the
   number 0 — `gems: () => { … return isFinite(n) ? n : 0; } catch { return 0; }`
   — so "the bridge threw" and "the player is broke" arrived as the same value.
   Driven against a bridge whose gems() throws, `payCost` really charged 1,600
   Cinder, computed `moved = 0 - 0`, and returned `{ ok:false, why:'Not enough
   Cinder.' }`. index.js toasts that and aborts, and the only refund path in the
   feature hangs off a COMMIT failure, so it never ran: the money was simply
   gone. The mirror case reported `cinder: 0` and "the purse never arrived" on
   900 Cinder that had landed.
   CONTRACT-R2 §2 settles it at the seam. `host.gems()` returns a number, or
   `null` when the balance could not be read; `0` now means zero Cinder and
   nothing else. Everything below reads it through `readGems()` and branches on
   null EXPLICITLY — and the direction of the fallback is chosen per leg,
   because "safe" points a different way for a charge than for a credit:
     • canAfford  — unreadable ⇒ FALSE. A paid choice we cannot price is
       disabled. Every dilemma authors a free refusal, so an unreadable wallet
       degrades the dilemma; it can never block it.
     • payCost    — `spendGems`'s own `true` is AUTHORITATIVE. The re-read may
       only turn a false NEGATIVE into a success; it may never turn a real
       charge into a refusal. That inversion is what took the 1,600.
     • grant      — unreadable ⇒ report the credit as DELIVERED, bounded by
       `addGems`'s own boolean. Telling a player their reward failed when it
       landed is the lie that matters here; the other direction costs them
       nothing they were promised.
     • refundCost — unreadable ⇒ fall back to the mutator's boolean, and the
       caller prints a different sentence for each.
   The `has(host, 'gems')` guard stays and it is not belt-and-braces: `sw.js`
   caches index.html and /src/* on separate keys, so a freshly-updated module
   can and does run against a cached index.html whose bridge has no `gems`
   accessor at all.

   💰 WHY THE PAYOUTS ARE SMALL, AND WHAT ACTUALLY BOUNDS THEM.
   `sql/AUDIT_farmed_cinder.sql:15` exists because of a mint that "left NO
   distinguishing record — a farmed Cinder and an earned Cinder are the same
   integer in the same column. There is no 'exploit' flag to filter on."
   `sql/034_wallet_credit_bounds.sql:18` records the live distribution this
   feature joins: `addGems max 250,000, MEDIAN 2, over 65k rows`. A new faucet
   that cannot be told apart after the fact must therefore be small enough that
   it never needs telling apart. Four things bound it:
     1. The BAND — here. Cinder amounts come from `DILEMMA_ECON.cinderBand`
        (120 / 400 / 900) and nowhere else — a choice names a band key, never
        a number, and an unknown key pays nothing.
     2. The CHANCE gate — here. `reward.chance` decides whether a reward lands
        at all, rolled once per resolution in `rollReward()`.
     3. The CLAMP — here. `influenceValue` is clamped into the table's own range
        before it can scale anything, and the result is clamped to
        MAX_CINDER_GRANT below — the largest number the table can express. A
        corrupt save with `influence: 10000` cannot turn a 400 into a fortune.
     4. The CADENCE — NOT here. `offerCooldownMs` is 45 minutes, so the feature
        is capped at roughly 1.3 resolutions an hour, but that gate lives in
        engine.js and this file cannot enforce it.
   ⚠ AND ONE THAT IS NOT A BOUND AT ALL, corrected in round 2 because the only
   thing this header is worth is being literally true. It used to list
   `validateCorpus()`'s `maxPayingRatio` — the 0.5 "a dilemma that always pays
   is a vending machine" ratio — beside the three this file actually enforces.
   It does not belong there: grep across /src/dilemma finds exactly one caller
   of `validateCorpus`,
   `MythicDilemmas.debug()` in index.js, so nothing on the open or the resolve
   path ever evaluates it. It is a DEVELOPER-TIME self-audit of the corpus, and
   a real one — the corpus sits at 0.134 against a 0.5 ceiling — but a reviewer
   who trusted the four-way claim would have believed in a runtime guard that
   does not exist.
   The admin has already switched a Cinder faucet off once for exactly this
   reason (`GEM_REWARDS` zeroed, index.html:64460-64472 — "it will devalue our
   money"). This one is built so it never has to be switched off.

   🔥 EVERY CREDIT CARRIES A DISTINCT REASON. `addGems(n, reason)` exists
   because "every Cinder faucet used to land in wallet_ledger as either
   'addGems' or an anonymous reconcile blob… Neither says WHERE the money came
   from, so the Cinder supply could not be audited" (index.html:64491-64496).
   Every credit from here reads `Dilemma: <dilemmaId>/<choiceId>` — greppable,
   attributable, one row per decision. sql/034 is blunt that this is for
   AUDITABILITY and never for authorisation: "p_reason CARRIES NO AUTHORITY.
   It is a client-supplied string." The bound is the amount; the reason is the
   paper trail.

   🔴 NO ROLLBACK, AND THAT IS THE DESIGN — see §"THE BASKET" above `grant()`.
   ⚙ ONE TUNING TABLE. Every number a reward is worth lives in `DILEMMA_ECON`
   (data.js) and nowhere else — the `_opEcon()` habit as index.html:80536-80537
   states it for CORP_LAWS ("Every number a policy is worth lives in CORP_LAWS
   and nowhere else"). Strip the comments and the only bare numbers left below
   are 0, 1 and the 100 that is the definition of "per cent" — including in
   REFUND_CEILING, whose fallback is written `-1 >>> 1` precisely so that the
   32-bit boundary the bridge's own `n | 0` imposes is DERIVED and named rather
   than typed as a magic 2147483647.
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

/* 🔴 THE ONE PLACE THE BALANCE IS READ. Returns a whole number of Cinder, or
   `null` for "could not be read" — the distinction CONTRACT-R2 §2.1 settles and
   the header above narrates. Four different things arrive here as null and they
   are all the same answer to the only question a caller has:
     • the host has no `gems` accessor at all (a service-worker-cached
       index.html whose bridge predates it);
     • the accessor threw (`Profile` not yet assigned during boot);
     • it returned null, which is now the seam's own word for unreadable;
     • it returned NaN / Infinity / a string that is not a number.
   Math.floor rather than `| 0`, because `| 0` is a 32-bit truncation and a
   balance is not bounded by 32 bits — production has reported a client wallet
   at 661,147 while the canonical row read 1,143, and the day a wallet passes
   2^31 a `| 0` read would report it as negative and every affordability test in
   this file would invert. This is a READ; it never touches the wallet, so it is
   safe to call twice around a mutator, which is exactly what the verification
   below does. */
function readGems(host) {
  if (!has(host, 'gems')) return null;
  let raw;
  try { raw = host.gems(); } catch (e) { return null; }
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!isFinite(n)) return null;
  return Math.floor(n);
}

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

/* 🔴 THE CEILING ON A REFUND — the round-2 fix for the only wallet mutator in
   this file that had no upper bound while `grant()` had one. A critic pushed
   1e12 through `refundCost` and the bridge's `addGems(n | 0, …)` turned a
   3,000,000,000 refund into a credit of −1,294,967,296: a NEGATIVE addGems,
   which decrements Profile.gems locally while `_serverMirrorCredit` clamps to
   Math.max(0, …) and returns early — the exact durable client/server
   divergence the comment above `refundCost` says this function avoids by "only
   ever adding". One Math.min closes it.

   The number is read, never typed. CONTRACT-R2 §5.7 puts `maxChoiceCost` in
   DILEMMA_ECON and makes `validateCorpus`'s R8 refuse any authored cost above
   it, so the clamp and the corpus can never disagree — that is the whole reason
   the constant lives in the table (index.html:80536-80537 again).
   ⚠ THE FALLBACK IS DELIBERATELY NOT A COPY OF THAT NUMBER. Typing 2000 here
   would be a second copy of the contract, free to drift from data.js the first
   time somebody retunes it. When the key is unreadable — an older data.js
   served from the service-worker cache beside a newer rewards.js, the same
   split that motivates the guard in readGems — we fall back to the boundary the
   DAMAGE has rather than the boundary the design has: `-1 >>> 1` is the largest
   integer the bridge's `n | 0` returns unchanged. That still makes a negative
   refund unreachable, which is the defect, and it can never shrink a refund
   below what `payCost` actually charged, which a guessed economy number could.
   Be clear about what that costs: with the key missing, an absurd authored cost
   is refunded in full instead of clamped. A refund is the player's own money
   coming back — over-returning it is a disappointment for an auditor, where
   under-returning it is a theft. */
const REFUND_CEILING = (() => {
  try {
    const n = Math.floor(Number(DILEMMA_ECON.maxChoiceCost));
    return (isFinite(n) && n > 0) ? n : (-1 >>> 1);
  } catch (e) { return (-1 >>> 1); }
})();

/* Standing scales the purse: ×0.6 at influence 0, ×1.0 at 50, ×1.4 at 100.
   This is Influence consumer #2 of three (CONTRACT §9.3) and the only one that
   lives in this file — consumer #1 is the eligibility band in engine.eligible()
   and #3 is the choice-count floor in engine.rollChoices(). The relationship is
   the one NODE_TIERS has to the Cinder pool slice (src/nodes/tiers.js:6-7 —
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
   starts lying. That drift is a live bug in a reference file —
   src/resonance/house.camp.js:152 promises "No rest-quality modifier here"
   while the same file's line 88 runs at CAMP_REST_QUALITY = 0.75. The same rule
   the citizens use for speech (src/city/citizens.city.js:407-410 — the bubble
   shows the worst mood term VERBATIM "so the bubble and the dialog can never
   disagree"), applied to money. */
function cinderFor(choice, influenceValue) {
  const key = choice && choice.reward && choice.reward.cinder;
  if (!key) return 0;                                   // card-only rewards are legal
  const band = (DILEMMA_ECON.cinderBand || {})[key];
  if (!(num(band) > 0)) return 0;                       // an unknown band key pays nothing
  const raw = Math.round(num(band) * rewardMult(influenceValue));
  // Math.max(1, …) so a real reward can never round away to zero, mirroring the
  // anti-rounding guard adjustBond uses on bond (index.html:72592-72594).
  return Math.min(MAX_CINDER_GRANT, Math.max(1, raw));
}

/* A choice's Cinder cost, normalised. Anything that is not a positive number is
   "no cost" — a cost leg that is present but zero is not a price, and letting
   it through would call spendGems(0), which returns TRUE (index.html:64477)
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
   economy will not make.

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
    // log ("−${cut} threat, +rep", index.html:65995-65996).
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
   (`_reconApplyEffects`, index.html:216559-216560) does a clamped direct
   decrement instead, which the 0.6s `_gemsTaxTick` poll then bills 2% civic tax
   on, a few lines below a comment arguing civic tax should not be booked on a
   fine. Choosing "cost, always" keeps this feature on the one sanctioned path
   and out of that argument. */

/* Drives the DISABLED state of the button. This must exist, because
   `spendGems()` returning false is the ONLY thing that happens on insufficient
   funds — no toast, no clamp, no render (index.html:64478). An ungated button
   would simply do nothing when pressed, which reads as a broken feature.

   ⚠ AN UNREADABLE BALANCE DISABLES A PAID CHOICE, and that is the safe
   direction rather than a convenient one. We cannot price the call, so we do
   not offer it. It degrades instead of breaking because every dilemma authors a
   free refusal that costs nothing (CONTRACT-R2 §3, rule R3, is the machine
   check that keeps that true) — so the dilemma is always still resolvable, and
   the player is never trapped in a modal with nothing they can press.
   The button then reads as "unaffordable" rather than as "unreadable", which is
   accepted rather than hidden: reaching it requires Profile.gems to be
   non-finite or the bridge to be missing the accessor, and round 1 behaved
   identically here (its `| 0` turned the same failure into 0, also
   unaffordable). Making the modal say which of the two happened would be a
   render change for a state a player can neither cause nor fix. */
export function canAfford(host, choice) {
  try {
    const n = costOf(choice);
    // A free choice is affordable without asking anybody. Consulting the host
    // first would let a missing bridge disable every free choice in the modal.
    if (n <= 0) return true;
    const bal = readGems(host);
    if (bal === null) return false;           // cannot verify a real cost ⇒ refuse
    return bal >= n;
  } catch (e) { return false; }
}

/* Charge the player. Returns { ok, why }; never throws.

   🔴 THE MUTATOR'S OWN `true` IS AUTHORITATIVE ON A CHARGE. THE RE-READ IS NOT.
   This is the round-2 correction and it is the most important line in the file.
   Round 1 had it the other way round — "balance is the authority when we can
   read it" — and the balance is exactly the thing that can lie. `spendGems`
   cannot: it returns `true` only after `Profile.gems` has already been
   decremented on the previous statement (index.html:64475-64479), so a `true`
   from it is a fact about what happened, not a report. A balance read is a
   fact about what the wallet says NOW, which is a different question the moment
   anything else in the tab has touched it.
   With the seam collapsing an unreadable balance to 0 (see the header), the
   inversion charged a player 1,600 Cinder and told them "Not enough Cinder.",
   and index.js aborted without refunding. So the rule is now one-directional:

     THE RE-READ MAY ONLY TURN A FALSE NEGATIVE INTO A SUCCESS.
     IT MAY NEVER TURN A REAL CHARGE INTO A REFUSAL.

   The predicate below is CONTRACT-R2 §2.3's table, in its order:

     cost <= 0                        → ok       (spendGems is never called)
     no spendGems accessor            → refuse   (nothing was charged)
     said === true                    → ok       (authoritative)
     moved !== null && moved >= cost  → ok       (spendGems under-reported)
     moved !== null && 0 < moved < c  → refuse, and say the charge was partial
     otherwise                        → refuse   ('Not enough Cinder.')

   `moved >= cost` rather than `=== cost` so a concurrent legitimate spend in
   another tab cannot make a real charge look like a failure.

   ⚠ THE PARTIAL BRANCH DOES NOT REFUND, and that is a decision. `spendGems`
   cannot partially charge — it is a single guarded subtraction — so reaching
   that branch means something OUTSIDE this file moved the balance between our
   two reads, and we cannot attribute the movement. Crediting the difference
   back would be minting against another system's spend. Refusing the decision
   and naming what we saw is the honest end of it; the player can see their own
   wallet and a generic "not enough" would read as us lying to them.

   The re-read is sound in the ordinary case because `spendGems` decrements
   `Profile.gems` synchronously (index.html:64479) and only fires the cloud
   write afterwards; nothing — including the 0.6s tax poll — can run between two
   adjacent synchronous statements. */
export function payCost(host, choice) {
  try {
    const n = costOf(choice);
    if (n <= 0) return { ok: true, why: '' };

    if (!has(host, 'spendGems')) return { ok: false, why: 'The ledger is unavailable — nothing was charged.' };

    const before = readGems(host);

    let said = false;
    try { said = host.spendGems(n) === true; } catch (e) { said = false; }

    const after = readGems(host);
    const moved = (before === null || after === null) ? null : (before - after);

    if (said) return { ok: true, why: '' };
    if (moved !== null && moved >= n) return { ok: true, why: '' };
    if (moved !== null && moved > 0 && moved < n) {
      return { ok: false, why: 'The charge only partly went through — the decision was not taken.' };
    }
    return { ok: false, why: 'Not enough Cinder.' };
  } catch (e) {
    return { ok: false, why: 'The ledger refused the charge — nothing was taken.' };
  }
}

/* Put a paid cost back. Called from exactly one place: index.js's resolve
   transaction, when `engine.commit()` could not persist the resolution
   (CONTRACT §9.4 step 2). The player paid for a decision the save never
   recorded, so the money comes back.

   🔴 THE BOOLEAN HAS TO CARRY INFORMATION, BECAUSE THE CALLER PRINTS IT.
   index.js branches on this return to choose between "Your Cinder came back."
   and "the refund could not be confirmed." Round 1 returned
   `host.addGems(n, …) !== false`, which against the shipped stack is
   CONSTANT TRUE: `addGems` returns undefined unconditionally
   (index.html:64499-64520, there is no return statement) and the bridge wrapper
   is `try { addGems(n | 0, …); return true; } catch { return false; }`. So the
   sentence was printed whether or not the money came back, and a driver proved
   it against an addGems that credited nothing. This was the one wallet mutator
   in the file that was neither verified nor clamped — and it is the refund
   path, the one that runs when the player has ALREADY been charged.
   It now does both, the way `payCost` and `grant` do:
     • CLAMP to REFUND_CEILING, so `n | 0` on the far side of the bridge can
       never turn a large positive into a negative credit.
     • VERIFY by reading the balance before and after. `true` iff the balance is
       readable and rose by at least `n`, or the balance is unreadable and
       `addGems` did not say `false`. When the wallet cannot be read there is
       nothing better than the mutator's word, and the caller has a sentence for
       exactly that case.
   The day `addGems` becomes a path that can decline — sql/034 states the
   planned real fix is per-faucet server RPCs, after which `wallet_credit` is
   revoked from `authenticated` — this boolean starts being the difference
   between a player who was told the truth and one who was not.

   ⚠ AND THE ONE CASE THIS STILL CANNOT SEE, stated rather than glossed, because
   a "there is no third outcome" claim that a driver can break is worth less
   than an honest bound. When the balance is UNREADABLE **and** `addGems` credits
   nothing while returning its usual undefined, this returns `true` and the
   player reads "Your Cinder came back." over money that did not come back.
   Driven, and it is the only surviving row of the sweep in which the report and
   the wallet disagree. There is no fix from inside this function: with no
   readable balance and a mutator that cannot decline, there is no third source
   of truth to consult, and inventing pessimism ("assume it failed") would make
   the far more common honest refund read as a failure. It shrank from round 1's
   EVERY case to this intersection of two simultaneous host failures, and it
   closes entirely the moment either the balance is readable or `addGems`
   reports. That is the real state of it.

   ⚠ NOTED DISAGREEMENT WITH CONTRACT-R2 §2.3, implemented as written.
   The amendment says "refuse (return false) if n <= 0". `costOf()` returns 0
   for a FREE choice, so a failed commit on a free refusal now returns false and
   the player reads "the refund could not be confirmed" over a call that cost
   them nothing. Round 1 returned true there, meaning "you are whole". Both are
   defensible and the amendment's is implemented: it makes the boolean mean
   exactly one thing — "a positive credit was verified to land" — and a return
   value that means two things is how this file got into trouble in the first
   place. Recorded here rather than quietly re-decided; the copy is index.js's
   to soften if anyone wants it softened.

   ⚠ THE 2% FOUNDATION SPEND TAX DOES NOT COME BACK, and that is stated rather
   than hidden. `_gemsTaxTick` (index.html:56834-56880) polls every ~0.6s, sees
   any net decrease of Profile.gems, and bills civic tax on it — so by the time
   this runs, the tax on the original spend may already be booked. The clean fix
   would be `_gemsTaxExempt` (index.html:56822), and it was deliberately NOT put
   on the bridge: this path only runs on a save failure, which is rare and is
   already being reported to the player, and adding a tax-suppression hole to
   the bridge to recover a few Cinder on a failure path is a worse trade than
   eating the asymmetry. If refunds ever become routine, revisit this first.

   ⚠ NEVER a negative addGems. `addGems` guards on `amount === 0`
   (index.html:64501), so a negative decrements Profile.gems locally while
   `_serverMirrorCredit` clamps to Math.max(0,…) and returns early — a durable
   client/server divergence. This function only ever adds, and REFUND_CEILING
   is what makes that sentence true rather than intended. */
export function refundCost(host, choice) {
  try {
    const n = Math.min(int(costOf(choice)), REFUND_CEILING);
    if (!(n > 0)) return false;                // nothing positive to credit back
    if (!has(host, 'addGems')) return false;
    // A refund is its own faucet in wallet_ledger and gets its own greppable
    // label. It carries the choice id but not a dilemma id, because refundCost
    // is deliberately callable without an instance — the failure it exists for
    // is a save that did not persist, and the instance is not what failed.
    const cid = (choice && choice.id) ? String(choice.id) : 'unknown';

    const before = readGems(host);
    // GENEROUS ON THE RETURN VALUE, STRICT ON THE BALANCE: `!== false`, because
    // a host adapter that returns undefined from a credit that actually worked
    // must not make this look like a failure. The re-read below is what decides
    // whenever it can decide.
    let said = false;
    try { said = host.addGems(n, 'Dilemma refund: ' + cid) !== false; } catch (e) { said = false; }
    const after = readGems(host);

    if (before !== null && after !== null) return (after - before) >= n;
    return said;
  } catch (e) { return false; }
}

/* ════════════════════════════════════════════════════════════════════════════
   3. THE ROLL — PURE
   ════════════════════════════════════════════════════════════════════════════
   No host, no side effects, no Math.random(). The rng arrives from the
   instance (engine.makeRng over the instance seed), so THIS ROLL is reproducible
   from (dilemma.id, openedAt, choiceId) and a bug report about the amount is
   actionable. ⚠ The narrowing is round 2's: what is reproducible is whether a
   reward landed, how much Cinder, and whether a card was REQUESTED in which
   rarity band. WHICH card arrives is not — that is three `Math.random()` picks
   inside the bridge's grantCard (index.html:207860, 207866, 207868) plus
   rollRarityFromWeights' own (index.html:65006), all on the far side of a seam
   this module does not thread an rng through. Threading one would be a
   bridge-surface change to make a comment true, so the comment was narrowed
   instead. Claiming the whole resolution was reproducible was an overreach.
   Being pure is also what lets the render layer show an honest preview band
   without minting anything.

   ⚠ NO RNG ⇒ NOTHING PAYS. That is the safe direction and it is deliberate:
   a caller that forgot the rng gets a disappointment, never a payout, and a
   preview path that accidentally reached this function cannot mint. */
export function rollReward(choice, influenceValue, rng) {
  const none = { cinder: 0, card: null, paid: false };
  try {
    if (!choice || !choice.reward || typeof choice.reward !== 'object') return none;
    if (typeof rng !== 'function') return none;

    const r = choice.reward;

    // 1. Does the reward land at all? This is the RUNTIME half of "not every
    //    dilemma pays", and it is the only half that runs. validateCorpus's
    //    maxPayingRatio bounds how many choices may carry a reward AT ALL, but
    //    it is a developer-time self-audit reachable only from
    //    MythicDilemmas.debug(); this line is what a player actually meets.
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
               published customs — getCardPoolForPacks, index.html:64954 and 64979). A
               declined card
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
   `pick.card.id`, so the id provably resolves (MythicDilemmaBridge.grantCard,
   index.html:207849-207880, over getCardPoolForPacks at 64952). This is
   the second: after the grant, the id is re-resolved through host.cardById()
   (_cardDefById, index.html:87378) and a miss is reported as a failed leg.
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
        const before = readGems(host);

        // 🔴 GENEROUS ON A CREDIT: `!== false`, not `=== true`. A host adapter
        // that returns undefined on a credit that actually worked must not make
        // this look like a failure — that exact shape (a mutator returning
        // undefined on success firing a rollback path) is a scar this repo
        // already carries. The balance re-read below is what really decides,
        // WHEN IT CAN.
        let said = false;
        try { said = host.addGems(want, reasonFor(instance, choice)) !== false; } catch (e) { said = false; }

        const after = readGems(host);

        /* 🔴 AN UNVERIFIABLE CREDIT IS REPORTED AS DELIVERED. Round 2's fix, and
           the direction is the opposite of payCost's on purpose.
           Round 1 read an unreadable balance as `delivered = said ? want : 0`,
           which sounds equivalent and was not, because the seam collapsed
           "unreadable" to the number 0 and the branch never ran: a driver saw
           900 Cinder actually land in the wallet while this function reported
           `cinder: 0`, `ok: false` and "The purse was counted out and never
           arrived." Telling a player their reward failed when it landed is the
           lie that matters — they go looking for money they already have, or
           they file a bug against a system that worked.
           The claim is still bounded: we only say "delivered" when `addGems`
           itself did not decline. Over-reporting is capped at one band times
           the multiplier (MAX_CINDER_GRANT) on a GIFT the player was not
           charged for; under-reporting corrodes every reward line in the
           feature. `verified` is what separates the two, and the readable path
           below is untouched — it still reports what LANDED, never what was
           requested. */
        const verified = (before !== null && after !== null);
        const delivered = verified ? Math.max(0, after - before) : (said ? want : 0);

        out.cinder = delivered;
        if (delivered >= want) {
          out.lines.push('🔥 The ward settled up on the spot — ' + fmt(want) + ' Cinder.');
        } else if (delivered > 0) {
          // Only reachable on a VERIFIED read — an unverifiable credit is
          // all-or-nothing above, never partial. addGems has no upper clamp, so
          // a short landing means something else moved the wallet between our
          // two reads. Reported rather than smoothed over: a short credit is
          // exactly the class of silent loss the verified-delivery check in
          // settle.js exists for, and guessing a top-up here risks
          // double-crediting on a lying read.
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
   when the reason is missing (`reason || 'addGems'`, index.html:64519), and that
   anonymous label is
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
