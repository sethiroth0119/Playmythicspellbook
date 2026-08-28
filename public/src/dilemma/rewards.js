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
   bridge's wrappers over the sanctioned helpers (`spendGems`,
   index.html:64490-64505 / `addGems`, index.html:64514-64535).
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
   CONTRACT-R3 §2 settles it at the seam — and what follows is an ASSUMPTION
   THIS FILE IS GRANTED, not a fact it can verify. The seam is two wrappers in
   two files, neither of them this one, and the contract assigns both to another
   owner. `host.gems()` returns a number, or `null` when the balance could not
   be read; `0` means zero Cinder and nothing else.
   ⚠ AND THE ASSUMPTION HAS BEEN FALSE FOR TWO ROUNDS RUNNING, which is why it
   is labelled as an assumption instead of narrated as a fact. Rounds 1 and 2
   both shipped an adapter wrapper that ran `Number(B.gems())` over the bridge's
   `null`. `Number(null)` is 0 and `isFinite(0)` is true, so every unreadable
   balance arrived here as the number 0, every `=== null` branch below was dead
   code that READ as live code, and this paragraph asserted a distinction the
   stack was not making. A comment a single coercion falsifies is a defect.
   So the file no longer depends on it. `grant()` decides nothing on
   `before === null` any more (CONTRACT-R3 §2.4 — see the predicate in LEG 2),
   so the headline harm of the collapse is unreachable from here whether the
   seam is fixed or not; the remaining null branches all fail in the direction
   that costs the player nothing if a future wrapper collapses them again.
   Everything below still reads the balance through `readGems()` and branches on
   null EXPLICITLY, and the direction of each fallback is chosen per leg,
   because "safe" points a different way for a charge than for a credit:
     • canAfford  — unreadable ⇒ FALSE. A paid choice we cannot price is
       disabled. Every dilemma authors a free refusal, so an unreadable wallet
       degrades the dilemma; it can never block it.
     • payCost    — `spendGems`'s own `true` is AUTHORITATIVE. The re-read may
       only turn a false NEGATIVE into a success; it may never turn a real
       charge into a refusal. That inversion is what took the 1,600.
     • grant      — a credit is called LOST only on EVIDENCE OF FAILURE, and the
       only evidence that exists is `addGems` itself declining. An unreadable
       balance — or a readable one that did not appear to move — reports the
       credit as DELIVERED. Telling a player their reward failed when it landed
       is the lie that matters here; the other direction costs them nothing they
       were promised and is bounded by MAX_CINDER_GRANT on a gift.
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
   path ever evaluates it. It is a DEVELOPER-TIME self-audit of the corpus and a
   real one — rule R7 caps the paying ratio at `DILEMMA_ECON.maxPayingRatio` and
   `validateCorpus()` is what measures it — but a reviewer who trusted the
   four-way claim would have believed in a runtime guard that does not exist.
   ⚠ AND THE MEASUREMENT IS NOT REPEATED HERE, deliberately. Round 2's version
   of this paragraph transcribed the ratio as "0.134"; by the time anyone read
   it the corpus measured 0.124, and the corpus moves again every round the
   content changes. A number measured in one file and typed into a comment in
   another cannot be kept true by anybody editing either file — it is a defect
   with a fuse on it, and it burned down twice in two rounds. The rule lives in
   R7, the measurement lives in `validateCorpus()`, and this file asserts
   neither. That discipline applies to every number in this header: the ones
   that remain are quoted from a file that is under version control beside the
   quote, or derived at load from `DILEMMA_ECON`.
   The admin has already switched a Cinder faucet off once for exactly this
   reason (`GEM_REWARDS` zeroed, index.html:64475-64487 — "it will devalue our
   money"). This one is built so it never has to be switched off.

   🔥 EVERY CREDIT CARRIES A DISTINCT REASON. `addGems(n, reason)` exists
   because "every Cinder faucet used to land in wallet_ledger as either
   'addGems' or an anonymous reconcile blob… Neither says WHERE the money came
   from, so the Cinder supply could not be audited" (the `reason` note above
   `addGems`, index.html:64506-64513).
   Every credit from here reads `Dilemma: <dilemmaId>/<choiceId>` — greppable,
   attributable, one row per decision. sql/034 is blunt that this is for
   AUDITABILITY and never for authorisation: "p_reason CARRIES NO AUTHORITY.
   It is a client-supplied string." The bound is the amount; the reason is the
   paper trail.

   🔴 NO ROLLBACK, AND THAT IS THE DESIGN — see §"THE BASKET" above `grant()`.
   ⚙ ONE TUNING TABLE. Every number a reward is worth lives in `DILEMMA_ECON`
   (data.js) and nowhere else — the `_opEcon()` habit as index.html:80551-80552
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
   the constant lives in the table (index.html:80551-80552 again).
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
  // anti-rounding guard `adjustBond` uses on bond (index.html:72607-72609).
  return Math.min(MAX_CINDER_GRANT, Math.max(1, raw));
}

/* A choice's Cinder cost, normalised. Anything that is not a positive number is
   "no cost" — a cost leg that is present but zero is not a price, and letting
   it through would call spendGems(0), which returns TRUE (`spendGems`,
   index.html:64492)
   and reads in a log as a successful charge that never happened. */
function costOf(choice) {
  const n = int(choice && choice.cost && choice.cost.cinder);
  return n > 0 ? n : 0;
}

/* The six shipped rarity ids capitalise to their exact display names — verified
   against `RARITIES` at index.html:39231-39238 (common → Common, … mythic →
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
          // ⚠ THE RARITY IS A REQUEST, NOT A PROMISE, and this line is the one
          // place in the feature that can overstate it. `grantCard` filters the
          // pack pool by the requested rarity and, when that filter is empty,
          // falls through to a DEFAULT_PACK_RARITY_WEIGHTS roll and finally to
          // any lootable card (index.html:207944-207953). Driven against a pool
          // with no Legendary in it: the modal read "a Legendary card" and an
          // Uncommon arrived. Two things keep it honest rather than a third
          // rewrite of this string: CONTRACT-R3 §3.2 caps authored requests at
          // the four commonest rarities, which is where the pool is deepest;
          // and the aftermath line below reports `picked.rarity` — WHAT CAME
          // BACK — never what was asked for, so the player is never told the
          // wrong thing about a card they are holding.
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
    // log ("−${cut} threat, +rep", index.html:66010-66011).
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
   (`_reconApplyEffects`, index.html:216661-216662) does a clamped direct
   decrement instead, which the 0.6s `_gemsTaxTick` poll then bills 2% civic tax
   on, a few lines below a comment arguing civic tax should not be booked on a
   fine. Choosing "cost, always" keeps this feature on the one sanctioned path
   and out of that argument. */

/* Drives the DISABLED state of the button. This must exist, because
   `spendGems()` returning false is the ONLY thing that happens on insufficient
   funds — no toast, no clamp, no render (`spendGems`, index.html:64493). An ungated button
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
   cannot: its only `return true` on a real charge (`spendGems`,
   index.html:64504) is ten lines BELOW the decrement of `Profile.gems`
   (index.html:64494), with nothing between them but the fire-and-forget cloud
   write — so a `true` from it is a fact about what happened, not a report. A balance read is a
   fact about what the wallet says NOW, which is a different question the moment
   anything else in the tab has touched it.
   With the seam collapsing an unreadable balance to 0 (see the header), the
   inversion charged a player 1,600 Cinder and told them "Not enough Cinder.",
   and index.js aborted without refunding. So the rule is now one-directional:

     THE RE-READ MAY ONLY TURN A FALSE NEGATIVE INTO A SUCCESS.
     IT MAY NEVER TURN A REAL CHARGE INTO A REFUSAL.

   The predicate below is CONTRACT-R2 §2.3's table with CONTRACT-R3 §5.1 and
   §5.2's two additions, in its order:

     cost <= 0                        → ok       (spendGems is never called)
     cost > REFUND_CEILING            → refuse   (nothing was charged — §5.1)
     no spendGems accessor            → refuse   (nothing was charged)
     said === true                    → ok       (authoritative)
     moved !== null && moved >= cost  → ok       (spendGems under-reported)
     moved !== null && 0 < moved < c  → refuse, and say the charge was partial
     moved === 0 && before >= cost    → refuse   ('the ledger refused' — §5.2)
     otherwise                        → refuse   ('Not enough Cinder.')

   `moved >= cost` rather than `=== cost` so a concurrent legitimate spend in
   another tab cannot make a real charge look like a failure.

   🔴 THE CHARGE AND THE REFUND NOW READ THE COST THROUGH THE SAME EXPRESSION,
   and this is round 3's money fix. Round 2 clamped `refundCost` to
   REFUND_CEILING and left `payCost` reading a bare `costOf(choice)`, so the two
   functions disagreed about the bound on the SAME NUMBER — which is precisely
   the hazard the REFUND_CEILING comment above reasons about at length and then
   applies to one side only. Driven at an authored cost of 2500 against a 2000
   ceiling: charged 2500, refunded 2000, `refundCost` returned TRUE because the
   balance had risen by at least its own clamped n, and index.js printed "Your
   Cinder came back." over a net loss of 500. At 50000 the loss was 48,000, with
   the same confirmed-refund sentence. That is round 1's money defect wearing a
   new coat, and a clamp on one side of a pair is how it got in.
   A cost above the ceiling is REFUSED rather than clamped. Clamping the charge
   would sell the outcome at a discount the author never wrote, and R8 already
   makes such a corpus invalid — so the only corpus that can reach this branch
   is one that is already broken, and refusing is the reading of "broken" that
   cannot take a player's money. Two things it buys:
     • payCost and refundCost can no longer disagree about the same number, in
       either direction, at any input.
     • It closes the truncation surface at the bridge, where `spendGems(n | 0)`
       turns an authored cost of 2^32 + 100 into a charge of 100 and a `true`.
   ⚠ NOTHING IN THE RUNNING APP ENFORCES R8. `validateCorpus()` has exactly one
   caller — `MythicDilemmas.debug()` — so the corpus/clamp agreement CONTRACT-R2
   §5.7 relies on is a developer-time promise, not a runtime one. That is why
   the bound has to be in the code and not only in the validator.

   ⚠ THE PARTIAL BRANCH DOES NOT REFUND, and that is a decision. `spendGems`
   cannot partially charge — it is a single guarded subtraction — so reaching
   that branch means something OUTSIDE this file moved the balance between our
   two reads, and we cannot attribute the movement. Crediting the difference
   back would be minting against another system's spend. Refusing the decision
   and naming what we saw is the honest end of it; the player can see their own
   wallet and a generic "not enough" would read as us lying to them.

   The re-read is sound in the ordinary case because `spendGems` decrements
   `Profile.gems` synchronously (`spendGems`, index.html:64494) and only fires
   the cloud write afterwards; nothing — including the 0.6s tax poll — can run
   between two adjacent synchronous statements.

   🔴 A BROKEN LEDGER IS NOT POVERTY, and until round 3 this function said it
   was. CONTRACT-R3 §5.2. The adapter converts a throwing `spendGems` into a
   plain `false` — that conversion is correct and is not being changed — so the
   outer catch below, which already holds the right sentence for a refusing
   ledger, is unreachable across the shipped seam. Driven with `spendGems`
   throwing and 5,000 🔥 in the wallet: `said` false, the balance reads fine,
   `moved === 0`, and a player who could obviously afford the call was told
   "Not enough Cinder." about a 1,600 charge. Money and state were safe; the
   sentence was a lie about the player.
   The split needs no adapter change and no second owner, because this function
   already holds the evidence: the player DEMONSTRABLY had the money (`before`
   was readable and `before >= n`) and NOTHING MOVED (`moved === 0`). Poverty
   cannot produce that pair. Only a ledger that declined without deducting can.
   ⚠ It is a strict `moved === 0`, not `!moved`: `moved` is `null` when the
   balance could not be read, and an unreadable balance is no evidence of
   anything. That case keeps the generic sentence. */
export function payCost(host, choice) {
  try {
    // 🔴 THE SAME EXPRESSION refundCost uses, character for character. If one of
    // these two lines is ever edited, the other one must be edited with it.
    const n = Math.min(int(costOf(choice)), REFUND_CEILING);
    if (n <= 0) return { ok: true, why: '' };
    // Refuse a price the refund could not fully return, BEFORE anything is
    // charged. Reached only by a corpus R8 would have rejected.
    if (int(costOf(choice)) > REFUND_CEILING) {
      return { ok: false, why: 'That price is not one the Heights will take.' };
    }

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
    if (moved === 0 && before !== null && before >= n) {
      return { ok: false, why: 'The ledger refused the charge — nothing was taken.' };
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
   (`addGems`, index.html:64514-64535 — there is no return statement on the
   crediting path) and the bridge wrapper
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

   ⚠ FALSE FOR A FREE CHOICE, AND THE COPY PROBLEM THAT CAUSED IS NOT THIS
   FILE'S TO SOLVE. `costOf()` returns 0 for a free choice, so a failed commit
   on a free refusal returns false here. 86.6% of the corpus is free and all
   twenty `always:true` refusals are, so round 2 made "the refund could not be
   confirmed" the ORDINARY commit-failure sentence — printed about money on
   decisions that charged nothing. Round 1 returned `true` there, meaning "you
   are whole", which was reassuring and also wrong.
   The boolean stays as it is, because it makes the return value mean exactly
   one thing — "a positive credit was verified to land" — and a return value
   that means two things is how this file got into trouble in the first place.
   CONTRACT-R3 §4 fixes it where it belongs: at the call site, which already
   holds `choice.cost` and can therefore tell "nothing was charged" from "the
   refund could not be confirmed" without asking this function anything. A
   consequence worth naming: under §4 this function is no longer CALLED for a
   free choice at all, which takes a pointless `addGems`-adjacent call off the
   commonest failure path in the feature.

   🔴 AND THE BOOLEAN NOW TELLS THE TRUTH ABOUT A SHORT REFUND. Round 2 clamped
   `n` to REFUND_CEILING and then reported `(after - before) >= n` — a test
   against the CLAMPED number, so an authored cost above the ceiling was charged
   in full by `payCost`, refunded short here, and reported as confirmed. §5.1
   closes that at the source: `payCost` now refuses such a cost before charging
   anything, so this branch is unreachable through the shipped call path.
   IT IS STILL CHECKED HERE. That redundancy is CONTRACT-R3's rule 2 and it is
   deliberate — the round-2 lesson is that two owners can each implement their
   half correctly and still leave the seam open, and this pair is one function
   call apart in one file. If a charge above the ceiling ever happens again, by
   any route, this function credits back everything it safely can and reports
   `false`, so the caller prints "the refund could not be confirmed" rather than
   "your Cinder came back." It never reports a shortfall as whole.

   ⚠ THE 2% FOUNDATION SPEND TAX DOES NOT COME BACK, and that is stated rather
   than hidden. `_gemsTaxTick` (index.html:56849-56895) polls every ~0.6s, sees
   any net decrease of Profile.gems, and bills civic tax on it — so by the time
   this runs, the tax on the original spend may already be booked. The clean fix
   would be `_gemsTaxExempt` (index.html:56837), and it was deliberately NOT put
   on the bridge: this path only runs on a save failure, which is rare and is
   already being reported to the player, and adding a tax-suppression hole to
   the bridge to recover a few Cinder on a failure path is a worse trade than
   eating the asymmetry. If refunds ever become routine, revisit this first.

   ⚠ NEVER a negative addGems. `addGems` guards on `amount === 0`
   (index.html:64516), so a negative decrements Profile.gems locally while
   `_serverMirrorCredit` clamps to Math.max(0,…) and returns early — a durable
   client/server divergence. This function only ever adds, and REFUND_CEILING
   is what makes that sentence true rather than intended. */
export function refundCost(host, choice) {
  try {
    // 🔴 THE SAME EXPRESSION payCost uses, character for character.
    const n = Math.min(int(costOf(choice)), REFUND_CEILING);
    // An authored cost the ceiling had to clamp cannot be returned in full, so
    // whatever else happens below, this call cannot report a whole refund.
    // Unreachable through payCost (§5.1); checked anyway, on purpose.
    const clamped = int(costOf(choice)) > REFUND_CEILING;
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

    // Credit first, report second: the player gets back everything this
    // function can safely return even when it must call the result unconfirmed.
    if (clamped) return false;
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
   inside the bridge's `grantCard` (index.html:207945, 207951, 207953) plus
   `rollRarityFromWeights`' own (index.html:65016), all on the far side of a seam
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
               published customs (`getCardPoolForPacks`, index.html:64967, whose
               built-in pools are skipped wholesale at 64994 when that toggle is
               on). A declined card before any credit costs nothing and needs no
               unwind.
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
   `pick.card.id`, so the id provably resolves (`MythicDilemmaBridge.grantCard`,
   index.html:207934-207965, over `getCardPoolForPacks` at 64967). This is
   the second: after the grant, the id is re-resolved through host.cardById()
   (`_cardDefById`, index.html:87393) and a miss is reported as a failed leg.
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
      /* `unconfirmed` means "a promised card whose fate we cannot state", and
         it is kept SEPARATE from the empty-pool branch because that branch
         tells the player the ruins were bare — a sentence we would have no
         grounds for if we never got to look.
         ⚠ AND ACROSS THE SHIPPED ADAPTER, ONLY THE MISSING-HOST-ACCESSOR HALF
         OF IT CAN FIRE. Round 2's version of this comment claimed the branch
         covered a THROWING accessor too. Driven in round 3, it does not: the
         bridge's `grantCard` already ends `catch (e) { return null; }`
         (index.html:207964) and the adapter wraps it in a second try/catch that
         also returns `null`, so a pool that blows up and a bridge accessor that
         has been deleted BOTH arrive here as `picked === null` — indistinguish-
         able from an empty pool, and both print "Nothing came out of the ruins
         this time." Driven: `getCardPoolForPacks` throwing, and the bridge's
         `grantCard` deleted, produce that line, not this one.
         That degradation is defensible and is not being "fixed" by reaching
         across the seam: the bridge's own catch already means no card was
         minted, and "nothing came out of the ruins" is a true sentence about a
         card that does not exist. What was not defensible was a comment
         asserting a distinction the stack does not make — the same class of
         defect as `payCost`'s unreachable ledger message was before §5.2.
         The branch stays because it is not dead: a host that genuinely lacks
         the accessor — a partial test double, or an adapter that stops
         wrapping — reaches it, and this file guards for totality everywhere.
         Driven, that host reports `ok:false` and the line below. */
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

        /* 🔴 A CREDIT IS CALLED LOST ONLY ON EVIDENCE OF FAILURE — never on the
           absence of evidence of success. CONTRACT-R3 §2.4, and it is the round
           where this stopped being a matter of taste.
           Round 1 read an unreadable balance as `delivered = said ? want : 0`.
           Round 2 fixed that and still got the wrong answer, because both
           rounds hung the decision on `before === null`, and for two rounds
           running the adapter above this file collapsed the bridge's `null` to
           the number 0 before it ever arrived. So `verified` came back TRUE on
           a wallet nobody could read, `after - before` was `0 - 0`, and a
           driver watched 900 Cinder land (3400 → 4300) while this function
           reported `{ ok:false, cinder:0 }` and "The purse was counted out and
           never arrived." Telling players their reward failed when it landed
           is the lie that matters: they go looking for money they already have,
           or they file a bug against a system that worked.
           The predicate no longer asks whether the balance was READABLE. It
           asks whether anything actually DECLINED:

             addGems declined (said === false)   → LOST. ok:false, cinder 0.
             balance readable and it rose        → report what LANDED, capped at
                                                   what was promised. ok:true.
             anything else                       → report the PROMISED amount.
                                                   ok:true.

           The third row is the whole point. It covers an unreadable balance, a
           balance collapsed to 0 by a wrapper two files away, and a readable
           balance that did not appear to move — three different failures of
           OBSERVATION, none of them evidence about the money. With this
           predicate, the seam being wrong (again) costs the player nothing and
           tells them nothing false, which is the only property this file can
           guarantee on its own.
           ⚠ A THROW COUNTS AS A DECLINE. `said` is false when `addGems` threw,
           and that is kept rather than treated as "no evidence": the shipped
           adapter converts a throwing host mutator to `false` before it reaches
           here, so folding the two together is what makes this function behave
           the same against a raw bridge and against the adapter, instead of
           differently. It is the same reading `payCost` gives `spendGems`.
           ⚠ AND ACROSS THE SHIPPED STACK, A THROW IS THE ONLY WAY `said` GOES
           FALSE — stated because the predicate above names "addGems declined"
           as its one piece of evidence, and a reader should know how rare that
           value actually is. The bridge wrapper is
           `try { addGems(n | 0, …); return true; } catch { return false; }`
           (index.html:207912), so it answers `true` for ANY non-throwing call,
           and the real `addGems` has no `return false` in it at all
           (index.html:64514-64535). Driven: a host mutator returning a literal
           `false` never reaches this file as `false`, because the bridge has
           already turned it into `true`. So a genuinely lost credit is reported
           as lost only when something THREW on the way to the wallet — and
           when nothing threw, this function says the money arrived, which is
           the direction §2.4 chose on purpose. sql/034's planned per-faucet
           RPCs are what would give `addGems` a real way to decline; on the day
           it gets one, this predicate starts carrying much more weight and
           should be re-read rather than assumed still adequate.
           WHAT IT COSTS, stated rather than glossed: an `addGems` that credits
           nothing while returning its usual `undefined` is reported as
           delivered. Over-reporting is capped at one band times the multiplier
           (MAX_CINDER_GRANT) on a GIFT the player was never charged for — the
           basket's own asymmetry, see §"THE BASKET" — where under-reporting
           corrodes every reward line in the feature. That is the trade, and it
           is the same one `refundCost`'s fallback makes for the same reason. */
        const verified = (before !== null && after !== null);
        const rose = verified ? Math.max(0, after - before) : 0;

        if (!said) {
          out.ok = false;
          out.why = out.why || 'The promised Cinder did not arrive.';
          out.lines.push('⚠ The purse was counted out and never arrived. Nothing was taken from you.');
        } else if (verified && rose > 0) {
          // VERIFIED DELIVERY, unchanged: report what LANDED, never what was
          // requested. Math.min so a concurrent credit from somewhere else in
          // the tab cannot be booked to this dilemma's line.
          const delivered = Math.min(want, rose);
          out.cinder = delivered;
          if (delivered >= want) {
            out.lines.push('🔥 The ward settled up on the spot — ' + fmt(want) + ' Cinder.');
          } else {
            // A short landing means something else moved the wallet between our
            // two reads — addGems has no upper clamp of its own. The line says
            // so plainly. `ok` stays true because nothing DECLINED, and the
            // shortfall is disclosed where the player actually reads it rather
            // than in a warning banner that would repeat this same sentence.
            out.lines.push('🔥 Part of the purse arrived — ' + fmt(delivered) + ' Cinder, short of what was counted.');
          }
        } else {
          out.cinder = want;
          out.lines.push('🔥 The ward settled up on the spot — ' + fmt(want) + ' Cinder.');
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
   when the reason is missing (`reason || 'addGems'`, index.html:64534), and that
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
