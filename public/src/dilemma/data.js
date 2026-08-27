/* ════════════════════════════════════════════════════════════════════════════
   🏛 ETHOS HEIGHTS — THE DILEMMA CORPUS.  Pure data. Zero I/O.
   ----------------------------------------------------------------------------
   New York died. Ethos Heights is what is being welded onto the corpse, and
   this file is the pile of decisions that lands on the desk of somebody the
   district has decided to ask. One street trades; the next street has never
   been cleared; under both of them is a door with a Foundation seal on it.

   THIS FILE IMPORTS NOTHING, ON PURPOSE. The feature's dependency graph is a
   strict DAG — data → engine/rewards → render → index — and a native ES module
   graph with a cycle in it does not load. A bundler would have hidden that; the
   app has no bundler. So `data.js` sits at the bottom and reaches for nothing.
   Nothing here touches `window`, the DOM, `Math.random()`, or the clock.
   Selection RNG is `engine.js`; every string that states a NUMBER is built by
   `rewards.describeChoice()`. That split is the point (see VOICE, rule 8).

   ⚙ ONE TUNING TABLE. Every number this feature is worth lives in
   `DILEMMA_ECON` below and nowhere else. That is the `_opEcon()` habit as
   `index.html:80536-80538` states it for CORP_LAWS ("the render code reads it,
   the scorer reads it, the mood pressure reads it… one table, no literals
   downstream"). engine.js, rewards.js, render.js and index.js must not carry a
   reward, cost, bond, cooldown, count or clamp literal of their own.

   🔴 `_opEcon()` ITSELF IS NOT USED AND MUST NOT BE — do not "fix" this.
   CLAUDE.md says all *operation* pricing goes through `_opEcon()`, and that is
   scoped to the word operation: `_opEcon(t)` (`index.html:80080`) is
   `OPS_ECON[t] || null` over the business-operation keys (`OPS_ECON`,
   `index.html:79791`). It returns null for anything else, and adding a
   `dilemma` key would put a non-business into the Just Business catalog — that
   catalog is built from `Object.keys(OPS_ECON)` (`index.html:80045`, built at
   `index.html:159765`), so a fake op would appear as a BUYABLE BUSINESS in the
   shop. Not a risk; a certainty. The rule's spirit is honoured by the
   one-table discipline above, which is what CORP_LAWS does.

   ════════════════════════════════════════════════════════════════════════════
   VOICE — the rules, taken from the camp expedition log (`CAMP_LOOT_FLAVOR`,
   `index.html:65663-65671`) and the Situation Board (`RECON_EVENTS`,
   `index.html:216440+`).

   🔴 ROUND ONE WROTE THESE RULES DOWN AND THEN BROKE THEM, WHICH IS WHY THEY
   ARE NOW MEASURED. The first corpus declared "eight to fourteen words is the
   beat" and "truncated fragments are correct and frequent — Gone. Halted." and
   then shipped a median outcome of TWENTY words, zero of one hundred and
   seventy-two lines under twelve, and not one single-word sentence in the whole
   file. A rule that lives only in a comment is a rule that rots. Rules V1-V10
   in `validateCorpus()` are those rules again, as errors, counting words.

     1. Two clauses, rarely three. Eight to fourteen words is the beat. (V1, V2)
     2. Simple past for what happened; present for what it now means.
     3. Third person about people (they/their). Second person about the player,
        used sparingly and only where it lands: "You did not build this pipe."
     4. The spaced em dash is the workhorse that hangs the consequence off the
        event — never a double hyphen, never a parenthesis doing that job. (V10)
     5. One leading emoji per outcome line. Never two. Never zero.
     6. Understatement. No exclamation marks anywhere in this file. (V10)
     7. Truncated fragments are correct and frequent. "Gone." "Even." "Cold."
        At least one line in seven lands in six words or fewer. (V3, V4)
     8. NEVER NAME THE NUMBER WHEN A PERSON WILL DO. LORE.md: "'Unemployment
        increased' is a number. 'I lost my job today' is a person." So no
        digits appear in any player-facing string here — the Cinder figure, the
        standing figure and the bond figure are all rendered from DILEMMA_ECON
        by `rewards.describeChoice()`. Retuning the table retunes the copy, and
        the copy can never drift from the constant.
        ⚠ That drift is a LIVE BUG in a reference file, not a hypothetical:
        `public/src/resonance/house.camp.js:152` promises the player "No
        rest-quality modifier here" while `house.camp.js:30` runs at
        `CAMP_REST_QUALITY = 0.75`.
     9. Tics are how generated prose reveals itself. Round one used
        nobody/Nobody fifty-three times in one hundred and seventy-two lines and
        hung twenty-one ", which …" riders off its sentences. Both are capped
        now (V8, V9). Vary the negation; drop the rider.

   ════════════════════════════════════════════════════════════════════════════
   WHAT MAKES A DILEMMA A DILEMMA — the authoring rules that matter most.

   🔴 MONEY BUYS THE OUTCOME, NEVER THE STANDING. This is the rule round one
   got wrong, and it was the whole feature: twenty-six of twenty-seven
   cost-gated choices carried POSITIVE standing, mean +5.85 against +0.39 on the
   free ones, and in twenty-two of thirty-two entries no free branch even tied
   the paid one. The prose confirmed it — the paid branch was the only branch
   where nobody ate the loss. A player learns that loop in two sessions and the
   feature stops being a set of dilemmas and becomes a published Cinder-to-
   standing exchange rate. Rules R1 and R2 make it unwritable: a paid choice can
   never beat the best free choice in its own dilemma, and across the corpus
   paying must cost you standing on average. Every paid outcome line here names
   somebody who is still unhappy afterwards. The crew that was never asked. The
   boy who watched you pay. The seller who now names his own price.

   Every choice must be a call somebody sane would defend, and every choice must
   cost something. If one option is the obvious answer the entry is scenery.
   R4 makes "obvious" mechanical: no choice may be beaten by a sibling on cost,
   standing, poles and expected payout at once. Round one shipped nine of those.

   THE REFUSAL — the `always: true` row offered every single time — is never
   free. Doing nothing in Ethos Heights is a decision the street watches you
   make. Round one asserted that in this very comment and then shipped three
   refusals at zero standing, so R3 checks it: a refusal costs standing, cannot
   be gated behind money, and never pays.

   A CHOICE DOES NOT NAME UNITS, IT NAMES POLES. It cannot name units: the
   player's deck is unknown when this file is written and is frequently full of
   Forge cards that did not exist yet. So a choice declares the value poles it
   EMBODIES, from the shipped eight (`LQ_POLE_AXIS`, `index.html:73034`), and
   engine.js derives each companion's stance — support, middle, against — from
   the unit's own `valueProfile` (`_lqUnitValueProfile`, `index.html:73089`).
   Opposition is derived from the AXIS, never authored: writing
   `oppose: ['mercy']` on a choice that also embodies mercy produces an
   incoherent entry no cheap validator could catch, and deriving it makes that
   entry unwritable. It is `_lqPoleVerdict` (`index.html:73283`) turned inside
   out — and that function's `null` return is this codebase's own name for the
   Middle stance.

   🔴 THE POLE BUDGET IS A BALANCE DECISION, SO IT IS CHECKED (R5, R6). Round
   one authored caution fifty-two times against valor sixteen, while valor is
   matched by one of the broadest regexes in the shipped archetype table
   (`LQ_ARCHETYPE_POLE`, `index.html:73066` — warrior|vanguard|champion|fighter|
   brawler|gladiator|knight|barbar|hunter|warlord|storm|bird). A deck of common
   melee archetypes therefore took a systematic net bond DRAIN from simply
   playing the feature, on the owner's headline mechanic, because of a ratio
   nobody chose. R6 holds each opposed pair inside three to two. R5 stops the
   paid branch owning the warm poles as well as the standing, which is R1
   wearing a second hat.

   ⚠ A UNIT WITH NO POLES IS THE COMMON CASE, NOT AN EDGE CASE. A Forge card
   with a name, an icon and stats resolves to `[]` and is Middle on everything.
   Authoring to the poles is therefore how a dilemma earns any reaction at all.
   ════════════════════════════════════════════════════════════════════════════ */

export const DILEMMA_SCHEMA_VERSION = 1;

/* Deep-freeze so a consumer cannot mutate the corpus by accident. engine.js
   snapshots choices onto an Instance and render.js interpolates them; a shared
   mutable object between those two is the kind of bug that only shows up on the
   second dilemma of a session. Pure, iterative-safe, no cycles in this data. */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) deepFreeze(o[keys[i]]);
  }
  return o;
}

/* ────────────────────────────────────────────────────────────────────────────
   DILEMMA_ECON — the one tuning table.
   ──────────────────────────────────────────────────────────────────────────── */
export const DILEMMA_ECON = Object.freeze({
  // ── Offer cadence
  offerCooldownMs:  45 * 60 * 1000,       // no new dilemma offered before this elapses
  repeatCooldownMs: 72 * 60 * 60 * 1000,  // the same dilemma id cannot return inside this
  recentDepth:      5,                    // the last N resolved ids are blocked outright

  // ── Choice count. Expected value 4.13 — "around 4".
  choiceBag:        Object.freeze([[3, 25], [4, 45], [5, 22], [6, 8]]), // [count, weight]
  choicesMin:       4,               // a dilemma must AUTHOR at least this many
  choiceFloorHigh:  4,               // influence >= highInfluence ⇒ never fewer than this
  choiceCeilLow:    4,               // influence <  lowInfluence  ⇒ never more than this
  choiceWeights:    Object.freeze([0.5, 1, 1.5]),

  // ── Influence
  influenceSeed:    50,              // a new player's standing with Ethos Heights
  influenceMin:     0,
  influenceCap:     100,
  influenceMax:     12,              // max |delta| a single choice may declare
  highInfluence:    70,
  lowInfluence:     25,

  // ── Bond
  bondCapPerResolve: 12,             // absolute clamp on |delta| handed to adjustBond
  rosterMax:         8,              // most reacting units shown/paid in one dilemma

  /* 💰 WHY THESE CINDER NUMBERS ARE SMALL, AND WHY THEY STAY SMALL.
     `sql/034_wallet_credit_bounds.sql:18` records the measured live distribution
     of this game's Cinder faucets: `addGems max 250,000, MEDIAN 2, over 65k
     rows`. A four-figure dilemma payout would sit in the tail of every audit
     query the project has, and `sql/AUDIT_farmed_cinder.sql:15` states the thing
     that makes that unfixable after the fact: farmed Cinder and earned Cinder
     "are the same integer in the same column. There is no 'exploit' flag".
     120 / 400 / 900, behind a per-choice `chance` gate, behind a forty-five
     minute offer cooldown, is a faucet an audit can ignore.
     It is also the lore: LORE.md says Cinder "isn't supposed to simply appear
     because somebody completed an arbitrary videogame task", and the admin has
     already switched a faucet off once for exactly that reason —
     `GEM_REWARDS = { perBattle: 0, winBonus: 0, … }` at `index.html:64467`,
     with the note "it will devalue our money" (`index.html:64460`). */
  cinderBand:       Object.freeze({ small: 120, mid: 400, large: 900 }),
  rewardFloorMult:  0.6,             // multiplier at influence 0
  rewardSpanMult:   0.8,             // + this * (influence/100)  ⇒ 1.0 at 50, 1.4 at 100
  maxPayingRatio:   0.5,             // corpus guard, see validateCorpus

  /* 🔴 THE CEILING ON A SINGLE CHOICE'S COST, AND WHY IT IS A SHARED CONSTANT.
     `rewards.refundCost()` clamps a refund with `Math.min(cost, maxChoiceCost)`
     because the bridge evaluates `addGems(n | 0, …)` and `| 0` is a 32-bit
     truncation: an unclamped three-billion cost would arrive at the wallet as a
     NEGATIVE credit. The clamp and the corpus must never disagree about the
     bound, so the corpus is checked against the same key (R8) instead of the
     refund path carrying a literal of its own. The largest authored cost below
     is 1800; the headroom is deliberate and the check is the contract. */
  maxChoiceCost:    2000,
});

/* 🪙 WHY COSTS ARE PER-CHOICE LITERALS WHILE REWARDS ARE BANDED, which looks
   inconsistent until you ask what each one is for. A REWARD is a faucet: it
   mints Cinder into a shared economy, so it must be bounded by one table an
   auditor can read in one place — hence `cinderBand` plus the influence
   multiplier, and nothing else. A COST is dramaturgy: it is sized to the
   specific ask in the fiction, and "cover a week of payroll on Foundry Row" is
   honestly not the same number as "pay the grocer for a stolen loaf". Three
   bands would flatten exactly the distinction the dilemma is about. Costs also
   only ever REMOVE Cinder through `spendGems()` (`index.html:64481`), which
   refuses rather than going negative, so a mis-tuned cost cannot inflate
   anything — and R8 bounds it from above. */

/* ────────────────────────────────────────────────────────────────────────────
   INFLUENCE_RANKS — standing with ONE city, given a name a player can say.
   Modelled on RESERVE_RANKS (`index.html:56269`): ascending, `min: 0` on the
   first row so a lookup can never miss and never returns null.
   ⚠ This ladder is DISPLAY. It is not one of Influence's three consumers (the
   gate band, the reward multiplier and the choice-count floor are). It is
   listed here so nobody counts it toward the two the BRIEF requires.
   Colours are `:root` tokens (`index.html:95-132`) by value, not new hexes:
   --ink-dim, --azure, --emerald, --gold, --gold-bright, --violet.
   ──────────────────────────────────────────────────────────────────────────── */
export const INFLUENCE_RANKS = deepFreeze([
  { min: 0,  name: 'Unknown Face',           icon: '👤', color: '#a89888' },
  { min: 20, name: 'Known on the Block',     icon: '🚪', color: '#4a8fd4' },
  { min: 40, name: 'Vouched For',            icon: '🤝', color: '#3aa86b' },
  { min: 60, name: 'Named in the Broadcast', icon: '📡', color: '#d4af37' },
  { min: 80, name: 'Called to the Table',    icon: '🏛', color: '#f5d76e' },
  { min: 95, name: 'The Heights Answers',    icon: '🗝', color: '#8b5cf6' },
]);

/* ────────────────────────────────────────────────────────────────────────────
   THE CORPUS. Twenty entries.

   🔴 IT WAS THIRTY-TWO AND THE TRIM IS THE POINT. More entries is not more
   content when every entry is the same entry: round one authored five or six
   choices every single time and never the minimum of four, put a pay-it-
   yourself branch in twenty-six of thirty-two, an institutional-handoff branch
   in twenty-one, and opened twenty-eight of thirty-two refusals on the identical
   fog glyph. By the fourth dilemma a player could predict the option list before
   reading it, which removes the surprise a random-event system exists to
   produce. Twenty entries with a broken skeleton beats thirty-two with an intact
   one. R9 holds the shape: the corpus stays between eighteen and twenty-two, at
   least a quarter of entries author exactly four choices, no entry authors more
   than six, and the refusals stop sharing one glyph.
   Twelve remains the floor at which the five-deep `recent` block plus the
   seventy-two hour repeat cooldown starves the pool on a normal session; R9's
   eligibility counts (ten at standing zero, fourteen at fifty) are that floor
   restated per band, because a corpus can be large and still starve at one end.

   No file outside this one references a dilemma id — verified before the trim —
   so removing an entry breaks nothing but this file.

   Districts are places inside Ethos Heights, and they are consistent: the same
   name means the same street across entries (Foundry Row is always the furnaces
   and the crews; the Kessler Line is always the river side; Harrow Yards is
   always where the labs went in; the Ledge is where cards are traded).

   🏛 THE CANON IS ON SCREEN, NOT IN THE IDENTIFIERS. Round one named entries
   `eh_kalon_girl` and `eh_mind_realm_bleed` and then never said Kalon, Mind
   Realm, Archon, Governor or New America in a single brief, label, desc or
   outcome — the words existed only in source strings no player will ever read,
   so the entries rendered as a generic girl with powers and a generic shared
   dream. If a dilemma is named for a piece of canon the player must meet that
   canon on screen.

   🛰 AND THE SATELLITES DO ONE THING. LORE.md scopes the Ouroboros network
   exactly: a Survivor activates a card, the card acts as part of the
   connection, and the entity is projected onto the ground. Round one made the
   beam an orbital cargo lift with a per-district allocation the ward could sell
   to a Corporation — orbital freight and beam quotas are not in the canon and a
   governance model for them is not ours to invent. `eh_uplink_window` below is
   the same window with the canon function: one carrier, one card, one entity,
   and an argument about what that entity should be asked to do.

   `minInfluence` / `maxInfluence` are Influence's first consumer, and the shape
   is not invented — it is `needMorale` on `RECON_EVENTS` (`index.html:216507`,
   filtered at `index.html:216587`) generalised to a band. Low standing means the
   Heights stops bringing you the decisions that matter. High standing means
   nobody asks you about a shop sign any more, which is its own quiet loss.
   ──────────────────────────────────────────────────────────────────────────── */
export const DILEMMAS = deepFreeze([

  /* ═══ CIVIC — the things a city stops being a city without ═══════════════ */

  {
    id: 'eh_ninth_street_main',
    title: 'The Ninth Street Main',
    district: 'Lower Reclaim',
    icon: '🚰',
    sev: 'pressing',
    weight: 12,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… pressure dropping on the west feed … advise … stand by …',
    brief: 'The old main under Ninth Street holds pressure for one side of the block, never both. East is the clinic. West is the market that pays the pipe crews. The valve is manual.',
    choices: [
      {
        id: 'east_clinic', always: false, weight: 1,
        label: 'Turn the pressure east',
        desc: 'The market runs dry and the traders remember it.',
        poles: ['mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '🚰 Clinic taps ran clear by dusk. The market shuttered early.',
      },
      {
        id: 'west_market', always: false, weight: 1,
        label: 'Turn the pressure west',
        desc: 'Trade keeps the crews paid and the clinic carries buckets.',
        poles: ['ambition'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🪙 The stalls opened on time. At the clinic they carried water all night.',
      },
      {
        id: 'split_valve', always: false, weight: 1.5,
        label: 'Split the valve',
        desc: 'Nobody gets enough. Nobody gets nothing.',
        poles: ['temperance', 'caution'], influence: -1,
        cost: null, reward: null,
        outcome: '🚰 Both ran thin. Both complained. Even.',
      },
      /* The paid branch, and the shape every paid branch in this file takes:
         it buys the OUTCOME (both taps run) and pays for it in standing (two
         below the best free call) and in the fiction (the crew whose pipe it is
         was cut out of the decision). */
      {
        id: 'cut_bypass', always: false, weight: 1,
        label: 'Pay a crew to cut a bypass',
        desc: 'Your own Cinder buys a second line before dawn.',
        poles: ['guile'], influence: 2,
        cost: { cinder: 600 }, reward: null,
        outcome: '🔧 They welded through the dark. Both taps ran by morning. The pipe crew was never asked.',
      },
      {
        id: 'leave_valve', always: true, weight: 0.5,
        label: 'Leave the valve alone',
        desc: 'You did not build this pipe.',
        poles: ['caution'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 The valve stayed. By morning the street had stopped asking you.',
      },
    ],
  },

  {
    id: 'eh_grid_brownout',
    title: 'Load on the Terrace',
    district: 'Blackout Terrace',
    icon: '⚡',
    sev: 'pressing',
    weight: 11,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… substation reading over draw … shed something … kkzzt…',
    brief: 'The reclaimed substation carries less than the district pulls. The Terrace has a lift for people who cannot manage the stairs. Foundry Row has the furnaces that pay half the wards.',
    choices: [
      {
        id: 'shed_row', always: false, weight: 1,
        label: 'Shed the Row, keep the homes lit',
        desc: 'The furnaces cool and the shift goes home unpaid.',
        poles: ['mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '⚡ The lifts kept running. The Row costed out a cold restart.',
      },
      {
        id: 'shed_homes', always: false, weight: 1,
        label: 'Shed the Terrace, keep the furnaces',
        desc: 'Quota is met and the stairwells go dark.',
        poles: ['ruthless', 'ambition'], influence: -3,
        cost: null, reward: { chance: 0.45, cinder: 'mid', card: null },
        outcome: '⚡ The Row made quota. Upstairs they carried lamps for a week.',
      },
      {
        id: 'rolling', always: false, weight: 1.5,
        label: 'Rotate the outage block by block',
        desc: 'Everyone loses an hour of the evening.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '⚡ An hour each. Even.',
      },
      {
        id: 'let_it_trip', always: true, weight: 0.5,
        label: 'Let the transformer decide',
        desc: 'You refuse to be the one who picks a dark block.',
        poles: ['caution'], influence: -5,
        cost: null, reward: null,
        outcome: '🌑 It tripped at dusk and took the grid with it.',
      },
    ],
  },

  {
    id: 'eh_wage_slip',
    title: 'The Slip on Foundry Row',
    district: 'Foundry Row',
    icon: '🧾',
    sev: 'pressing',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… payroll query on the Row … no comment from the ward … kkzzt…',
    brief: 'Foundry Row came up a week short on payroll. The crews worked it anyway. The ledger says the money went to furnace parts that kept them working.',
    choices: [
      {
        id: 'open_books', always: false, weight: 1.5,
        label: 'Open the books to the crews',
        desc: 'They see the shortfall and who signed for it.',
        poles: ['honor'], influence: 5,
        cost: null, reward: null,
        outcome: '🧾 The crews read the ledger. Two foremen left the Row.',
      },
      {
        id: 'stretch_it', always: false, weight: 1,
        label: 'Stretch the next month thin',
        desc: 'Half now, half later, and the halves never match.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '🧾 Half landed. The rest is a promise the Row has heard before.',
      },
      {
        id: 'cover_wages', always: false, weight: 1,
        label: 'Cover the wages yourself',
        desc: 'Your Cinder closes the gap and the ledger stays shut.',
        poles: ['guile'], influence: 2,
        cost: { cinder: 1500 }, reward: null,
        outcome: '🪙 Everyone got paid. The books stayed shut. The Row learned the gap can be papered over.',
      },
      {
        id: 'name_the_thief', always: false, weight: 1,
        label: 'Name who signed the transfer',
        desc: 'One clerk carries it for the whole office.',
        poles: ['ruthless'], influence: 3,
        cost: null, reward: null,
        outcome: '🧾 They took the clerk at dawn. The office is very quiet. Careful.',
      },
      {
        id: 'say_nothing', always: true, weight: 0.5,
        label: 'Say nothing about the slip',
        desc: 'It is not your ledger and not your Row.',
        poles: ['guile'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 Payday came and went. Two families left the Row that week.',
      },
    ],
  },

  {
    id: 'eh_the_thief',
    title: 'The Bread on Vance Street',
    district: 'Vance Street',
    icon: '🍞',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'A boy took bread from the grocer twice this week. The grocer wants it stopped in front of witnesses. The boy is not hungry. His sister is.',
    choices: [
      {
        id: 'work_it_off', always: false, weight: 1.5,
        label: 'Put him to work in the shop',
        desc: 'He carries sacks until the grocer says enough.',
        poles: ['temperance', 'mercy'], influence: 5,
        cost: null, reward: null,
        outcome: '🍞 He swept the shop for a month. The grocer taught him the scales.',
      },
      {
        id: 'pay_grocer', always: false, weight: 1,
        label: 'Pay the grocer for the bread',
        desc: 'The debt closes and the boy learns the price of nothing.',
        poles: ['ambition'], influence: 2,
        cost: { cinder: 200 }, reward: null,
        outcome: '🪙 The grocer was made whole. The boy watched you pay. He took again in spring.',
      },
      {
        id: 'hand_to_ward', always: false, weight: 1,
        label: 'Hand him to the ward office',
        desc: 'A file is opened and his sister is listed on it.',
        poles: ['honor'], influence: 1,
        cost: null, reward: null,
        outcome: '📋 The ward opened a file. His sister is on it too.',
      },
      {
        id: 'look_the_other_way', always: true, weight: 0.5,
        label: 'Look the other way',
        desc: 'It is bread, and it is not your shop.',
        poles: ['guile'], influence: -3,
        cost: null, reward: null,
        outcome: '📪 The grocer stopped asking. He bars the door at dusk now.',
      },
    ],
  },

  /* ═══ ANOMALOUS — the labs went in first and never came out ══════════════ */

  {
    id: 'eh_kalon_girl',
    title: 'The Girl Who Turned',
    district: 'Harrow Yards',
    icon: '✨',
    sev: 'grave',
    weight: 7,
    minInfluence: 30,
    maxInfluence: 100,
    wire: '…kkzzt… incident on Harrow … no casualties reported … kkzzt…',
    brief: 'A tenement burned in Harrow Yards and a girl put it out with her hands. The Yards word for what she did is Kalon. The Foundation liaison has asked twice where she sleeps.',
    choices: [
      {
        id: 'hide_her', always: false, weight: 1.5,
        label: 'Move her out to the camps',
        desc: 'The Yards lose her and the liaison loses the file.',
        poles: ['guile', 'mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '✨ She left on the night truck. Her mother stayed to answer questions.',
      },
      {
        id: 'hand_over', always: false, weight: 1,
        label: 'Give the liaison her address',
        desc: 'Containment is a word the Foundation still uses kindly.',
        poles: ['honor', 'ruthless'], influence: 2,
        cost: null, reward: { chance: 0.5, cinder: 'mid', card: null },
        outcome: '🏛 They came in daylight and were polite. The stairwell has not spoken since.',
      },
      {
        id: 'teach_her', always: false, weight: 1,
        label: 'Ask the Yards to teach her',
        desc: 'Old hands, no paperwork, and no promises.',
        poles: ['temperance'], influence: 3,
        cost: null, reward: null,
        outcome: '✨ Two old hands took her mornings. She has burned nothing since. Yet.',
      },
      {
        id: 'pay_the_liaison', always: false, weight: 1,
        label: 'Pay the liaison to lose the file',
        desc: 'Cinder buys a clerical error that holds for a season.',
        poles: ['ambition'], influence: 1,
        cost: { cinder: 900 }, reward: null,
        outcome: '🪙 The file went missing. The liaison now knows what you will pay.',
      },
      {
        id: 'say_nothing_yards', always: true, weight: 0.5,
        label: 'Say nothing to anyone',
        desc: 'You were not there and you saw no hands.',
        poles: ['guile'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The liaison asked again. Somebody answered.',
      },
    ],
  },

  {
    id: 'eh_mind_realm_bleed',
    title: 'The Bleed on Kessler Line',
    district: 'Kessler Line',
    icon: '🌀',
    sev: 'grave',
    weight: 7,
    minInfluence: 30,
    maxInfluence: 100,
    wire: '…kkzzt… four blocks reporting the same dream … stand by … kkzzt…',
    brief: 'Four blocks dream the same corridor and wake saying the same word. The Foundation liaison calls it a Mind Realm bleed. The dreamers want it studied. Their neighbours want it sealed.',
    choices: [
      {
        id: 'let_them_study', always: false, weight: 1,
        label: 'Let the dreamers keep a log',
        desc: 'They write it down and the liaison reads it later.',
        poles: ['ambition'], influence: 3,
        cost: null, reward: null,
        outcome: '🌀 The log filled in a fortnight. One dreamer stopped waking up.',
      },
      {
        id: 'seal_the_blocks', always: false, weight: 1,
        label: 'Seal the four blocks at night',
        desc: 'Curfew, shutters, and nobody sleeps in the corridor.',
        poles: ['caution', 'ruthless'], influence: 1,
        cost: null, reward: null,
        outcome: '🌀 The dreaming stopped. So did the market. Gone.',
      },
      {
        id: 'call_his_ops', always: false, weight: 1,
        label: 'Call H.I.S. OPS to walk it',
        desc: 'Operatives, lamps, and a report you will not read.',
        poles: ['honor', 'valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🛡 The squad walked the corridor twice. Two of them dream it now.',
      },
      {
        id: 'refuse_the_bleed', always: true, weight: 0.5,
        label: 'Leave the dreamers to it',
        desc: 'A dream is not a fire and not your street.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '⏳ By the third week the word had reached two more blocks.',
      },
    ],
  },

  {
    id: 'eh_uplink_window',
    title: 'The Uplink Window',
    district: 'Foundry Row',
    icon: '🛰',
    sev: 'pressing',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… Ouroboros window over the district at moonrise … one carrier … kkzzt…',
    brief: 'Ouroboros holds a window over the district tonight. One carrier, one card, one entity on the ground before the orbit moves on. Three people have asked for it.',
    choices: [
      {
        id: 'lift_the_stair', always: false, weight: 1,
        label: 'Summon something that can lift',
        desc: 'A collapsed stair, and forty people behind it.',
        poles: ['mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '🛰 The beam came down at the stair. It carried stone until dawn, then went.',
      },
      {
        id: 'guard_the_market', always: false, weight: 1,
        label: 'Put a guard on the market',
        desc: 'Something armed stands in the square until the window closes.',
        poles: ['valor'], influence: 3,
        cost: null, reward: null,
        outcome: '🛰 It stood in the square all night. Nothing came. The stair is still down.',
      },
      {
        id: 'foundation_takes_it', always: false, weight: 1,
        label: 'Give the window to the Foundation',
        desc: 'They will not say what they intend to call down.',
        poles: ['caution', 'honor'], influence: 1,
        cost: null, reward: { chance: 0.35, cinder: 'mid', card: null },
        outcome: '🏛 Whatever they called stayed inside the cordon. The carrier was paid and sent home.',
      },
      {
        id: 'buy_the_card', always: false, weight: 1,
        label: 'Buy a card off the Ledge for it',
        desc: 'A stronger summon, bought at the seller price.',
        poles: ['ambition'], influence: 1,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🪙 The card called something bigger. The stair cleared. The seller names his own price now.',
      },
      {
        id: 'let_it_pass', always: true, weight: 0.5,
        label: 'Let the window pass',
        desc: 'The orbit comes round again in a season.',
        poles: ['temperance'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The window closed over an empty square. Nothing came down.',
      },
    ],
  },

  {
    id: 'eh_governor_visit',
    title: 'The Governor\'s Column',
    district: 'Civic Mile',
    icon: '🏛',
    sev: 'quiet',
    weight: 8,
    minInfluence: 30,
    maxInfluence: 100,
    wire: null,
    brief: 'A Governor rides through on the New America circuit next week. The ward wants the burned block hidden behind hoarding. The people living in it were not asked.',
    choices: [
      {
        id: 'show_the_block', always: false, weight: 1.5,
        label: 'Walk the column past the burned block',
        desc: 'Let the Governor see what the ward is hiding.',
        poles: ['honor', 'valor'], influence: 5,
        cost: null, reward: null,
        outcome: '🏛 The column stopped at the burned block. The ward clerk was replaced by winter.',
      },
      {
        id: 'build_hoarding', always: false, weight: 1,
        label: 'Put up the hoarding',
        desc: 'Paint, boards, and a street that photographs well.',
        poles: ['guile'], influence: -2,
        cost: null, reward: { chance: 0.5, cinder: 'small', card: null },
        outcome: '🎨 The boards went up overnight. Behind them nothing changed.',
      },
      {
        id: 'ask_for_money', always: false, weight: 1,
        label: 'Ask the column for reconstruction funds',
        desc: 'You spend the visit asking instead of showing.',
        poles: ['ambition'], influence: 2,
        cost: null, reward: null,
        outcome: '🏛 The request was noted. Noted.',
      },
      {
        id: 'feed_the_column', always: false, weight: 1,
        label: 'Pay for the reception yourself',
        desc: 'Tables, lamps, and a ward that owes you nothing.',
        poles: ['temperance'], influence: 2,
        cost: { cinder: 700 }, reward: null,
        outcome: '🪙 The reception went well. The burned block ate cold that night.',
      },
      {
        id: 'move_the_tenants', always: false, weight: 1,
        label: 'Move the tenants for a week',
        desc: 'They come back to the same walls.',
        poles: ['ruthless'], influence: -1,
        cost: null, reward: null,
        outcome: '🏛 They were gone for the visit. Two families did not come back.',
      },
      {
        id: 'say_nothing_gov', always: true, weight: 0.5,
        label: 'Stay off the route',
        desc: 'Let the ward stage whatever it likes.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🔇 The column came and went. Nothing on that block moved.',
      },
    ],
  },

  {
    id: 'eh_archon_seal',
    title: 'The Seal Under Harrow',
    district: 'Harrow Yards',
    icon: '⛓',
    sev: 'grave',
    weight: 6,
    minInfluence: 70,
    maxInfluence: 100,
    wire: '…kkzzt… seal integrity query, Harrow sublevel … no comment … kkzzt…',
    brief: 'Under the old laboratory is a door with an Archon mark burned into it. The Foundation seal is older than the mark. Somebody has been leaving food at the stair.',
    choices: [
      {
        id: 'weld_it', always: false, weight: 1,
        label: 'Weld the stair shut',
        desc: 'Nothing goes down and nothing comes up.',
        poles: ['caution'], influence: 3,
        cost: null, reward: null,
        outcome: '⛓ Closed by Thursday. Still fed.',
      },
      {
        id: 'find_the_feeder', always: false, weight: 1,
        label: 'Find who is feeding it',
        desc: 'Somebody down there is being spoken to.',
        poles: ['guile'], influence: 4,
        cost: null, reward: null,
        outcome: '🕯 An old caretaker. She has been going down for years.',
      },
      {
        id: 'call_foundation', always: false, weight: 1,
        label: 'Call the Foundation to the door',
        desc: 'They own the seal and they will own the street.',
        poles: ['honor'], influence: 2,
        cost: null, reward: { chance: 0.3, cinder: 'large', card: null },
        outcome: '🏛 A containment team took the block for a month. The seal was left alone.',
      },
      {
        id: 'open_it', always: false, weight: 1.5,
        label: 'Pay a crew to open the seal',
        desc: 'Whatever is behind it has been patient.',
        poles: ['valor', 'ruthless'], influence: 1,
        cost: { cinder: 1800 }, reward: null,
        outcome: '🚪 The door came open on a Tuesday. Three of the crew came back up.',
      },
      {
        id: 'leave_the_stair', always: true, weight: 0.5,
        label: 'Leave the stair as it is',
        desc: 'The seal has held longer than the city has.',
        poles: ['caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🪨 Nothing changed at the door. The food kept going down.',
      },
    ],
  },

  {
    id: 'eh_carrion_park',
    title: 'Carrion Park',
    district: 'Kessler Line',
    icon: '🌳',
    sev: 'grave',
    weight: 7,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… survey dispute on the Kessler green … kkzzt…',
    brief: 'The park on the Kessler Line is a burial ground nobody surveyed. The reconstruction plan puts housing over it. The families who buried there still come on Sundays.',
    choices: [
      {
        id: 'build_over', always: false, weight: 1,
        label: 'Build the housing over the park',
        desc: 'Four hundred beds and a ground nobody names.',
        poles: ['ambition', 'ruthless'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🏗 Foundations went in by autumn. The Sunday crowd stopped coming.',
      },
      {
        id: 'move_the_dead', always: false, weight: 1.5,
        label: 'Exhume and rebury them properly',
        desc: 'Slow, costly in labour, and every stone named.',
        poles: ['mercy', 'honor'], influence: 5,
        cost: null, reward: null,
        outcome: '⚱ It took the crews a season. Every stone got a name back.',
      },
      {
        id: 'park_stays', always: false, weight: 1,
        label: 'Leave the park as it is',
        desc: 'The housing goes somewhere with worse light.',
        poles: ['temperance'], influence: 3,
        cost: null, reward: null,
        outcome: '🌳 The plan moved north.',
      },
      {
        id: 'ignore_it', always: true, weight: 0.5,
        label: 'Say nothing to the planners',
        desc: 'The survey is not your paperwork.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The plan went through unread. The first cut turned up bone.',
      },
    ],
  },

  {
    id: 'eh_specimen_walks',
    title: 'Specimen Walks',
    district: 'Harrow Yards',
    icon: '🧪',
    sev: 'grave',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… containment query, Harrow perimeter … advise lamps … kkzzt…',
    brief: 'Something got out of a Harrow Yards lab and walks the same three streets each night. It has touched nobody. It is waiting for somebody.',
    choices: [
      {
        id: 'call_ops', always: false, weight: 1,
        label: 'Call H.I.S. OPS to take it',
        desc: 'Operatives, nets, and a truck with no windows.',
        poles: ['honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🛡 They took it before dawn. Whoever it waited for never came out.',
      },
      {
        id: 'burn_block', always: false, weight: 1,
        label: 'Burn the block it walks',
        desc: 'Nothing lives there now, and nothing will.',
        poles: ['ruthless', 'valor'], influence: -2,
        cost: null, reward: null,
        outcome: '🔥 The block burned two days. Four cleared buildings went with it.',
      },
      {
        id: 'wards_and_lamps', always: false, weight: 1,
        label: 'Pay for lamps on every corner',
        desc: 'Light, salt and a night watch you fund.',
        poles: ['temperance'], influence: 1,
        cost: { cinder: 1000 }, reward: null,
        outcome: '🧪 It walks the Yards now.',
      },
      {
        id: 'watch_it', always: false, weight: 1.5,
        label: 'Follow it and learn what it wants',
        desc: 'Somebody walks behind it for a week.',
        poles: ['valor', 'guile'], influence: 4,
        cost: null, reward: null,
        outcome: '🧪 It goes to a door on Harrow. It stands there. Then leaves.',
      },
      /* Not a refusal in the comfortable sense — abandoning three streets is an
         act, and it is authored as one (ruthless, and the deepest standing loss
         in the entry). R3 only requires that the always-row costs standing and
         cannot be bought; it does not require the row to be passive. */
      {
        id: 'empty_it', always: true, weight: 0.5,
        label: 'Empty the three streets',
        desc: 'The families go and the thing keeps walking.',
        poles: ['ruthless'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 Nine households moved by the weekend. It still walks.',
      },
    ],
  },

  /* ═══ STREET — small enough that only the neighbours will remember ═══════ */

  {
    id: 'eh_shop_sign',
    title: 'The Sign on Vance Street',
    district: 'Vance Street',
    icon: '🪧',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 40,
    wire: null,
    brief: 'A returning shopkeeper hung the old pre-collapse sign over her door. Two people on the street lost family to what that company sold.',
    choices: [
      {
        id: 'let_it_hang', always: false, weight: 1,
        label: 'Let the sign hang',
        desc: 'It is her door and her name above it.',
        poles: ['honor', 'valor'], influence: 3,
        cost: null, reward: null,
        outcome: '🪧 The sign stayed up. Two neighbours cross the street now.',
      },
      {
        id: 'ask_her_down', always: false, weight: 1.5,
        label: 'Ask her to take it down',
        desc: 'You are asking her to give up what she carried back.',
        poles: ['mercy', 'temperance'], influence: 4,
        cost: null, reward: null,
        outcome: '🪧 She took it down herself. Boxed.',
      },
      {
        id: 'take_it_down', always: false, weight: 1,
        label: 'Take the sign down yourself',
        desc: 'It comes down at night and nobody sees who.',
        poles: ['ruthless', 'guile'], influence: -1,
        cost: null, reward: null,
        outcome: '🪧 The sign was gone by morning. She never opened the shop again.',
      },
      {
        id: 'look_away', always: true, weight: 0.5,
        label: 'Look away from the sign',
        desc: 'Signs are not your business on this street.',
        poles: ['guile'], influence: -2,
        cost: null, reward: null,
        outcome: '🧊 The argument found the street without you. Somebody broke the window.',
      },
    ],
  },

  {
    id: 'eh_dog_at_the_gate',
    title: 'The Dog at the Gate',
    district: 'North Camp',
    icon: '🐕',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'A dog has sat at the north gate for three days. It is thin and it will not leave. The gate crew have started naming it.',
    choices: [
      {
        id: 'feed_properly', always: false, weight: 1.5,
        label: 'Put it on the ward rations',
        desc: 'A share off every plate, written down.',
        poles: ['temperance', 'mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '🐕 It sleeps inside now.',
      },
      {
        id: 'work_dog', always: false, weight: 1,
        label: 'Make it work the wall',
        desc: 'It hears what the watch cannot.',
        poles: ['valor', 'ambition'], influence: 3,
        cost: null, reward: null,
        outcome: '🐕 It works the wall at night. It found something on Tuesday.',
      },
      {
        id: 'drive_it_off', always: false, weight: 1,
        label: 'Drive it off the gate',
        desc: 'The rations are already thin enough.',
        poles: ['ruthless'], influence: -2,
        cost: null, reward: null,
        outcome: '🐕 They chased it into the dark. The youngest of the crew stopped speaking to them.',
      },
      {
        id: 'leave_it', always: true, weight: 0.5,
        label: 'Leave it at the gate',
        desc: 'It will move on or it will not.',
        poles: ['temperance'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 It was gone by Friday. The crew still leave a bowl out.',
      },
    ],
  },

  /* ═══ RUIN — the parts of the corpse nobody has finished cutting off ═════ */

  {
    id: 'eh_zombie_block',
    title: 'The Block That Was Not Cleared',
    district: 'Lower Reclaim',
    icon: '🧟',
    sev: 'grave',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… survey party overdue, river side … kkzzt…',
    brief: 'The reclamation map says the block between Third and the river is clear. It is not. A survey crew went in on Monday and two came back.',
    choices: [
      {
        id: 'clear_it_yourself', always: false, weight: 1.5,
        label: 'Take a crew in yourself',
        desc: 'You go first and the map gets corrected.',
        poles: ['valor', 'honor'], influence: 6,
        cost: null, reward: null,
        outcome: '🧟 Two names went onto the wall.',
      },
      {
        id: 'fix_the_map', always: false, weight: 1,
        label: 'Correct the map and warn the wards',
        desc: 'Paper, not rifles, and the block stays shut.',
        poles: ['caution', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '📋 The map was corrected. Four wards read it. The block waits.',
      },
      {
        id: 'hire_hunters', always: false, weight: 1,
        label: 'Hire hunters off the Ledge',
        desc: 'They ask no questions and keep the salvage.',
        poles: ['guile'], influence: 2,
        cost: { cinder: 1400 }, reward: null,
        outcome: '🪙 Cleared in a night and stripped bare. The tenants came home to nothing.',
      },
      {
        id: 'wall_it', always: false, weight: 1,
        label: 'Wall the block off',
        desc: 'Brick and wire, and the river side stays lost.',
        poles: ['caution', 'temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '🧱 The wall went up in a week. The river road is closed for good.',
      },
      {
        id: 'call_ops_block', always: false, weight: 1,
        label: 'Ask H.I.S. OPS for a sweep',
        desc: 'Operatives work it and the ward pays in access.',
        poles: ['ambition'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🛡 The sweep took three days. The ward signed something it has not read.',
      },
      {
        id: 'leave_map', always: true, weight: 0.5,
        label: 'Leave the map as it is',
        desc: 'You did not draw it and cannot correct it.',
        poles: ['caution'], influence: -5,
        cost: null, reward: null,
        outcome: '🗺 Another crew went in on the strength of the map.',
      },
    ],
  },

  {
    id: 'eh_redaction_order',
    title: 'The Redaction Order',
    district: 'Civic Mile',
    icon: '📄',
    sev: 'pressing',
    weight: 8,
    minInfluence: 30,
    maxInfluence: 100,
    wire: '…kkzzt… records amendment pending ward signature … kkzzt…',
    brief: 'The Foundation liaison wants three pages taken out of the ward record. The pages name a street that is on no map now. The clerk is waiting.',
    choices: [
      {
        id: 'comply', always: false, weight: 1,
        label: 'Sign the redaction',
        desc: 'The pages go and the liaison remembers you helped.',
        poles: ['caution', 'ambition'], influence: 2,
        cost: null, reward: { chance: 0.35, cinder: 'mid', card: null },
        outcome: '📄 The pages went into a bag. The clerk asked for a transfer.',
      },
      {
        id: 'copy_first', always: false, weight: 1.5,
        label: 'Copy the pages before they go',
        desc: 'One set for the liaison, one for a drawer.',
        poles: ['guile'], influence: 4,
        cost: null, reward: null,
        outcome: '📄 The redaction was signed. A second set sits in a drawer. Quietly.',
      },
      {
        id: 'refuse_order', always: false, weight: 1.5,
        label: 'Refuse the redaction',
        desc: 'The record stays whole and the liaison stops calling.',
        poles: ['honor', 'valor'], influence: 5,
        cost: null, reward: null,
        outcome: '📄 The pages stayed. Barely.',
      },
      {
        id: 'read_them_out', always: false, weight: 1,
        label: 'Read the pages to the ward',
        desc: 'Whatever the street was, everybody hears it.',
        poles: ['ruthless'], influence: 3,
        cost: null, reward: null,
        outcome: '📄 The ward heard the street name. Two families packed that night.',
      },
      {
        id: 'operators_call', always: true, weight: 0.5,
        label: 'Leave it to the clerk',
        desc: 'It is the ward record and the ward spine.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The clerk signed it alone. He was moved to another ward.',
      },
    ],
  },

  {
    id: 'eh_tenement_nine',
    title: 'Tenement Nine',
    district: 'Lower Reclaim',
    icon: '🏚',
    sev: 'pressing',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… allocation list posted, Tenement Nine … kkzzt…',
    brief: 'Nine is habitable again. Twenty-two families are on the ward list and eleven doors are sound. The list was written by a clerk who is on it.',
    choices: [
      {
        id: 'by_the_list', always: false, weight: 1,
        label: 'Fill the doors off the list',
        desc: 'The clerk keeps his place and everyone sees it.',
        poles: ['honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🏚 Eleven doors filled in order. The clerk moved in on Friday.',
      },
      {
        id: 'by_need', always: false, weight: 1.5,
        label: 'Fill them by need instead',
        desc: 'You rank strangers by how badly they are doing.',
        poles: ['mercy'], influence: 5,
        cost: null, reward: null,
        outcome: '🏚 The worst cases went in first. The list holders have not forgiven it.',
      },
      {
        id: 'lottery', always: false, weight: 1,
        label: 'Draw the doors by lot',
        desc: 'No judgement, no favour, and no sense.',
        poles: ['temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🏚 The draw was public. Two winners sold their door by spring.',
      },
      {
        id: 'fix_more_doors', always: false, weight: 1,
        label: 'Pay to make more doors sound',
        desc: 'Timber, glass and a month of trades.',
        poles: ['valor'], influence: 2,
        cost: { cinder: 1600 }, reward: null,
        outcome: '🔨 Six more doors by the thaw. The ward stopped budgeting for repairs.',
      },
      {
        id: 'clerk_off_list', always: false, weight: 1,
        label: 'Strike the clerk off the list',
        desc: 'He wrote himself in and everybody knew.',
        poles: ['ruthless'], influence: 1,
        cost: null, reward: null,
        outcome: '🏚 He was struck off.',
      },
      {
        id: 'leave_nine', always: true, weight: 0.5,
        label: 'Leave Nine boarded',
        desc: 'An empty building argues with nobody.',
        poles: ['temperance'], influence: -4,
        cost: null, reward: null,
        outcome: '🧱 Nine stayed shut. By winter people were living in it anyway.',
      },
    ],
  },

  {
    id: 'eh_his_ops_sweep',
    title: 'The Sweep',
    district: 'Blackout Terrace',
    icon: '🛡',
    sev: 'pressing',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… squad requesting floor by floor access … kkzzt…',
    brief: 'H.I.S. OPS want to walk every floor of the Terrace looking for something they will not name. The ward can refuse once. The stairwells are full of people with reasons to hide.',
    choices: [
      {
        id: 'allow_sweep', always: false, weight: 1,
        label: 'Let the operatives walk the floors',
        desc: 'They find what they came for, and other things.',
        poles: ['honor', 'caution'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🛡 They took two people and a crate. Neither was what they announced.',
      },
      {
        id: 'warn_first', always: false, weight: 1.5,
        label: 'Warn the stairwells first',
        desc: 'Everyone gets a night to move what they have.',
        poles: ['mercy', 'guile'], influence: 5,
        cost: null, reward: null,
        outcome: '🛡 The sweep found empty rooms. The squad leader knows why.',
      },
      {
        id: 'refuse_sweep', always: false, weight: 1,
        label: 'Spend the ward one refusal',
        desc: 'You use it here and not on whatever comes next.',
        poles: ['valor'], influence: 3,
        cost: null, reward: null,
        outcome: '🛡 The operatives left. Angry.',
      },
      {
        id: 'stand_aside', always: true, weight: 0.5,
        label: 'Stand aside and watch',
        desc: 'It is their squad and the ward decides.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The sweep went floor to floor. Four doors did not open again.',
      },
    ],
  },

  {
    id: 'eh_portal_courtyard',
    title: 'The Courtyard Door',
    district: 'Kessler Line',
    icon: '🚪',
    sev: 'grave',
    weight: 6,
    minInfluence: 70,
    maxInfluence: 100,
    wire: '…kkzzt… aperture stable eleven days, Kessler courtyard … kkzzt…',
    brief: 'A door opened in a courtyard on the Kessler Line and it goes somewhere with a different sky. It has stayed open for eleven days. Three people have gone through.',
    choices: [
      {
        id: 'seal_courtyard', always: false, weight: 1,
        label: 'Wall the courtyard off',
        desc: 'Brick to the roofline and a watch on it.',
        poles: ['caution'], influence: 3,
        cost: null, reward: null,
        outcome: '🧱 Bricked by Sunday. Something knocks.',
      },
      {
        id: 'study_it', always: false, weight: 1,
        label: 'Let the Foundation study the door',
        desc: 'They bring instruments and a cordon that never leaves.',
        poles: ['ambition', 'honor'], influence: 2,
        cost: null, reward: { chance: 0.3, cinder: 'large', card: null },
        outcome: '🏛 The cordon is permanent. Two streets need a pass to go home.',
      },
      {
        id: 'send_through', always: false, weight: 1.5,
        label: 'Pay a Survivor to go through',
        desc: 'Somebody willing, equipped, and told the odds.',
        poles: ['ruthless'], influence: 1,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🚪 She came back coughing.',
      },
      {
        id: 'bring_back_one', always: false, weight: 1.5,
        label: 'Go in after the ones who went',
        desc: 'You do not know what is on the other side.',
        poles: ['mercy', 'valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🚪 Two came out with you. The third is still walking that sky.',
      },
      {
        id: 'leave_the_door', always: true, weight: 0.5,
        label: 'Leave the door open',
        desc: 'It was here before you and it is not yours.',
        poles: ['temperance'], influence: -4,
        cost: null, reward: null,
        outcome: '⏳ The door is still open. Two more went through this week.',
      },
    ],
  },

  {
    id: 'eh_camp_intake',
    title: 'Intake at the North Camp',
    district: 'North Camp',
    icon: '⛺',
    sev: 'pressing',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 40,
    wire: '…kkzzt… arrivals at the north wire … beds unavailable … kkzzt…',
    brief: 'Forty people walked in from the ruins this week. The camp has beds for nine of them and food for a fortnight. Some of them are armed.',
    choices: [
      {
        id: 'take_all', always: false, weight: 1.5,
        label: 'Take all of them in',
        desc: 'Everyone eats less and the wall gets thicker.',
        poles: ['mercy', 'valor'], influence: 5,
        cost: null, reward: null,
        outcome: '⛺ Everyone ate less by spring. The wall has never been better manned.',
      },
      {
        id: 'take_the_useful', always: false, weight: 1,
        label: 'Take the ones who can work',
        desc: 'Trades in, and the rest walk back to the ruins.',
        poles: ['ruthless', 'ambition'], influence: -1,
        cost: null, reward: null,
        outcome: '⛺ The camp gained four trades. The rest went south.',
      },
      {
        id: 'take_nine', always: false, weight: 1,
        label: 'Take nine and no more',
        desc: 'You count beds and stop counting faces.',
        poles: ['temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '⛺ Nine got beds. Cold.',
      },
      {
        id: 'buy_food', always: false, weight: 1,
        label: 'Buy a month of food for all of them',
        desc: 'Your Cinder feeds forty and the camp learns to ask.',
        poles: ['honor'], influence: 2,
        cost: { cinder: 1100 }, reward: null,
        outcome: '🪙 They ate through the month. When it ran out they came to you.',
      },
      {
        id: 'turn_them_away', always: true, weight: 0.5,
        label: 'Turn them back at the wire',
        desc: 'The camp keeps what it already has.',
        poles: ['ruthless'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 They walked south at first light. Some will be back armed.',
      },
    ],
  },

  {
    id: 'eh_ledge_market',
    title: 'The Ledge',
    district: 'The Ledge',
    icon: '🃏',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Somebody is selling cards on the Ledge that were pulled off the dead in the ruins. The families recognise them. The seller has a licence and the ward has no rule.',
    choices: [
      {
        id: 'write_the_rule', always: false, weight: 1.5,
        label: 'Write the rule the ward lacks',
        desc: 'Names on the cards go back to names on stones.',
        poles: ['honor', 'temperance'], influence: 5,
        cost: null, reward: null,
        outcome: '🃏 The rule passed in a fortnight. Half the Ledge moved to the river.',
      },
      {
        id: 'buy_them_back', always: false, weight: 1,
        label: 'Buy the named cards back',
        desc: 'You pay a fair price for what was already theirs.',
        poles: ['mercy'], influence: 3,
        cost: { cinder: 1300 }, reward: null,
        outcome: '🪙 The families got their cards. The seller doubled his prices by summer.',
      },
      {
        id: 'let_it_trade', always: false, weight: 1,
        label: 'Let the Ledge trade',
        desc: 'A card is a card and a market is a market.',
        poles: ['ambition'], influence: 1,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🃏 Trade went on.',
      },
      {
        id: 'take_the_licence', always: false, weight: 1,
        label: 'Pull the seller licence',
        desc: 'One trader loses everything and the rest take note.',
        poles: ['ruthless'], influence: 2,
        cost: null, reward: null,
        outcome: '🃏 His stall was gone by Tuesday. The same cards turn up on the river.',
      },
      {
        id: 'ask_the_families', always: false, weight: 1,
        label: 'Ask the families what they want',
        desc: 'You hand the decision to people who are grieving.',
        poles: ['valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🃏 They asked for the cards and for his name. You gave one.',
      },
      {
        id: 'leave_the_ledge', always: true, weight: 0.5,
        label: 'Leave the Ledge alone',
        desc: 'Trade is not a thing you police.',
        poles: ['temperance'], influence: -2,
        cost: null, reward: null,
        outcome: '🃏 The stalls stayed. A widow broke one with a bar.',
      },
    ],
  },

]);

/* id → dilemma. Built from DILEMMAS so the two can never disagree, which is the
   same reason CITY_PRODUCTION_BY_ID is a reduce over its own array rather than
   a second hand-maintained literal (`production.data.js:293`).

   🔴 THE GUARD ON `d && typeof d.id === 'string'` IS NOT DEFENSIVE PADDING, and
   it was added because the plain reduce actually broke. Running validateCorpus
   against a deliberately corrupted copy of this corpus never reached the
   validator: `m[d.id]` on a null entry threw during MODULE EVALUATION, which is
   the one failure this file cannot be allowed to have. index.js imports data.js
   at the top of the graph, so a throw here happens before any try/catch in
   index.js exists to catch it — the module never registers, the hub tile never
   appears, and the reviewer sees a dead feature rather than a bad entry. With
   the guard, a malformed entry is simply absent from the lookup and is reported
   by validateCorpus() as data, which is where a corpus problem belongs. */
export const DILEMMA_BY_ID = Object.freeze(
  DILEMMAS.reduce((m, d) => {
    if (d && typeof d.id === 'string' && !m[d.id]) m[d.id] = d;
    return m;
  }, Object.create(null))
);

/* ────────────────────────────────────────────────────────────────────────────
   validateCorpus() — the self-audit, in the shape of production.data.js's
   auditCatalog() (`public/src/city/production.data.js:360`).

   🔴 IT NEVER THROWS AND IT IS NEVER ON THE HOT PATH. It is called by
   MythicDilemmas.debug() and by a reviewer, and a corrupt corpus must surface as
   `{ ok:false, errors:[…] }` rather than as an exception inside a modal that the
   player is looking at. A dilemma is a feature; the game is the product.

   🔴 WHY THE BALANCE AND VOICE RULES ARE ERRORS AND NOT WARNINGS. Round one
   shipped a corpus whose paid branches dominated, whose refusals were free,
   whose prose ran at twenty words against a declared beat of eight to fourteen,
   and whose pole budget ran caution to valor at more than three to one — and
   every one of those was invisible to this function, which only warned when NO
   choice in an entry lost standing. A rule that produces a warning nobody reads
   is the same as a rule written in a comment: it rots. Every rule below prints
   the offending id AND both measured numbers, because a rule a writer cannot
   act on is a rule that gets suppressed instead of fixed.

   Errors are things that would ship a broken, dishonest or unbalanced entry.
   Warnings are things that would ship a boring one.
   ──────────────────────────────────────────────────────────────────────────── */

const POLE_IDS = Object.freeze([
  'honor', 'guile', 'mercy', 'ruthless', 'valor', 'caution', 'ambition', 'temperance',
]);
/* The four opposed pairs, exactly LQ_POLE_AXIS (`index.html:73034`). Duplicated
   rather than imported for the reason the whole feature exists: LQ_POLE_AXIS is
   a top-level `const` in index.html, a lexical global an ES module cannot see
   (CLAUDE.md, the globals trap). engine.js gets the real one through the bridge;
   this copy exists ONLY so validateCorpus can check axis coherence (R6) and
   catch a same-axis pole pair without data.js growing an import or a window
   reference. If the eight poles ever change in index.html, this is one of the
   two places to fix. */
const POLE_PAIRS = Object.freeze([
  Object.freeze(['honor', 'guile']),
  Object.freeze(['mercy', 'ruthless']),
  Object.freeze(['valor', 'caution']),
  Object.freeze(['ambition', 'temperance']),
]);
const SEV_IDS = Object.freeze(['quiet', 'pressing', 'grave']);
const ID_RE = /^eh_[a-z0-9_]+$/;
const CHOICE_ID_RE = /^[a-z0-9_]+$/;
/* Rule 8 of VOICE, mechanically. A digit in a player-facing string means
   somebody wrote an effect into prose instead of letting describeChoice() derive
   it, and the copy will drift from DILEMMA_ECON the first time it is retuned. */
const DIGIT_RE = /[0-9]/;
const TITLE_MAX = 48;
const DISTRICT_MAX = 28;
const LABEL_MAX = 56;

/* ── The corpus shape and voice budget (R9, V1-V10). One table, same habit as
   DILEMMA_ECON: a reviewer arguing with a threshold edits it here, not in the
   middle of a loop. These are AUDIT constants, not gameplay tuning, which is
   why they live beside the validator rather than in DILEMMA_ECON — nothing the
   player ever touches reads them. */
const CORPUS_MIN            = 18;   // below this the recent-block starves a band
const CORPUS_MAX            = 22;   // above this the entries start repeating each other
const MIN_MINIMAL_RATIO     = 0.25; // share of entries that must author exactly choicesMin
const CHOICES_MAX           = 6;    // no entry may author more than this
const MIN_ELIGIBLE_AT_ZERO  = 10;
const MIN_ELIGIBLE_AT_MID   = 14;
const ELIGIBLE_MID          = 50;
const MAX_REFUSAL_GLYPH_PCT = 0.60; // no single glyph may open more refusals than this
const PAID_MEAN_MARGIN      = -1.0; // mean(paid influence - best free influence) ceiling
const MAX_PAID_POLE_SHARE   = 0.25; // no pole may own more of the paid branch than this
const MIN_PAID_POLES        = 6;    // of eight, how many must appear on paid choices
const AXIS_RATIO_MAX        = 1.5;  // max(count) <= this * min(count), per opposed pair
const MIN_CHOICES_PER_POLE  = 6;    // every pole must reach at least this many choices
const OUTCOME_WORDS_MIN_MED = 8;
const OUTCOME_WORDS_MAX_MED = 14;
const OUTCOME_WORDS_MAX     = 24;
const SHORT_OUTCOME_WORDS   = 6;
const SHORT_OUTCOME_RATIO   = 0.15;
const MIN_ONE_WORD_LINES    = 8;
const LABEL_WORDS_MAX       = 9;
const DESC_WORDS_MED_MAX    = 14;
const DESC_WORDS_MAX        = 20;
const BRIEF_WORDS_MAX       = 45;
const BRIEF_WORDS_MED_MAX   = 34;
const NOBODY_RATIO_MAX      = 0.10;
const WHICH_RIDERS_MAX      = 4;

/* 🔤 THE WORD COUNTER. Written once and used by every voice rule so two rules
   can never disagree about what a word is. The leading glyph is not a word; an
   em dash is punctuation, not a word; a token with no letter or digit in it
   (a bare dash, a lone ellipsis) is not a word. Everything else is. */
function wc(s) {
  return String(s == null ? '' : s)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[—–]/g, ' ')
    .trim().split(/\s+/).filter(t => /[A-Za-z0-9]/.test(t)).length;
}

/* V4's model line, from the camp expedition log: a sentence that is one word.
   "Gone." "Even." "Cold." The corpus had none at all before this rule. */
const ONE_WORD_SENTENCE = /(^|[.!?…]["')\]]?\s+)[A-Za-z][A-Za-z'-]*[.!?]/;
const NOBODY_RE = /\bnobody\b/i;
const WHICH_RIDER_RE = /,\s+which\b/;

/* Median with the even case averaged. Returns 0 for an empty list rather than
   NaN — a NaN would make every comparison below silently false, which is the
   quiet way an audit stops auditing. */
function median(list) {
  if (!list.length) return 0;
  const a = list.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* The four measurements R1-R4 are all defined in terms of, pulled out so the
   rules read like the contract that specifies them. */
function costOf(c) {
  return (c && c.cost && Number.isFinite(c.cost.cinder)) ? Math.floor(c.cost.cinder) : 0;
}
function isPaid(c) { return costOf(c) > 0; }
/* Expected Cinder value of a choice's reward, used only to compare siblings.
   Card rewards are deliberately excluded: their value is not expressible in the
   same unit, and a rule that guessed at it would be a rule nobody could check. */
function evOf(c) {
  const r = c && c.reward;
  if (!r) return 0;
  const band = (r.cinder != null && Object.prototype.hasOwnProperty.call(DILEMMA_ECON.cinderBand, r.cinder))
    ? DILEMMA_ECON.cinderBand[r.cinder] : 0;
  const ch = (typeof r.chance === 'number') ? r.chance : 1;
  return band * ch;
}
function isSubset(a, b) {
  for (let i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
  return true;
}
function firstGlyph(s) {
  const a = Array.from(String(s == null ? '' : s));
  return a.length ? a[0] : '';
}

export function validateCorpus() {
  const errors = [];
  const warnings = [];
  try {
    const seenIds = Object.create(null);
    let totalChoices = 0;
    let payingChoices = 0;

    /* Corpus-wide accumulators. Collected in the single pass below so the rules
       at the bottom are pure arithmetic over measurements, not a second walk
       that could drift out of step with the first. */
    const paidMargins = [];                       // R2
    const paidPoleCount = Object.create(null);    // R5
    const poleCount = Object.create(null);        // R6, occurrences
    const poleChoices = Object.create(null);      // R6, distinct choices
    const refusalGlyphs = Object.create(null);    // R9
    let minimalChoiceEntries = 0;                 // R9
    const outcomes = [];                          // V1-V4, V8
    const labels = [];                            // V5
    const descs = [];                             // V6
    const briefs = [];                            // V7
    POLE_IDS.forEach(p => { paidPoleCount[p] = 0; poleCount[p] = 0; poleChoices[p] = 0; });

    const prose = (where, s, fieldMax) => {
      if (typeof s !== 'string' || !s.length) { errors.push(where + ': missing text'); return; }
      if (s.indexOf('<') >= 0) errors.push(where + ': contains "<" — the corpus is escaped at render time and must never be the reason markup leaks');
      if (DIGIT_RE.test(s)) errors.push(where + ': contains a digit — effect numbers are derived by rewards.describeChoice(), never authored');
      if (s.indexOf('!') >= 0) errors.push(where + ': contains an exclamation mark — house voice is understatement (V10)');
      if (s.indexOf('--') >= 0) errors.push(where + ': contains "--" — use the spaced em dash (V10)');
      if (s.indexOf('’') >= 0) errors.push(where + ': contains a curly apostrophe — this file is plain ASCII apostrophes');
      if (fieldMax && s.length > fieldMax) errors.push(where + ': ' + s.length + ' chars, max ' + fieldMax);
    };

    if (!Array.isArray(DILEMMAS) || !DILEMMAS.length) {
      errors.push('DILEMMAS is empty');
      return { ok: false, errors: errors, warnings: warnings };
    }

    DILEMMAS.forEach((d, di) => {
      const at = 'dilemma[' + di + ']' + (d && d.id ? ' ' + d.id : '');

      if (!d || typeof d !== 'object') { errors.push(at + ': not an object'); return; }
      if (typeof d.id !== 'string' || !ID_RE.test(d.id)) errors.push(at + ': id must match /^eh_[a-z0-9_]+$/');
      else if (seenIds[d.id]) errors.push(at + ': duplicate id'); else seenIds[d.id] = 1;

      prose(at + '.title', d.title, TITLE_MAX);
      prose(at + '.district', d.district, DISTRICT_MAX);
      prose(at + '.brief', d.brief, 0);
      if (typeof d.brief === 'string') briefs.push({ at: at, n: wc(d.brief), s: d.brief });
      /* A quiet street matter would never reach the Emergency Broadcast, so a
         missing wire line is only worth flagging on something the district
         would actually hear about. */
      if (d.wire != null) prose(at + '.wire', d.wire, 0);
      else if (d.sev !== 'quiet') warnings.push(at + ': no wire line, but sev is "' + d.sev + '" — the Broadcast would have carried this');

      if (typeof d.icon !== 'string' || !d.icon.length) errors.push(at + ': icon must be a non-empty string');
      else if (Array.from(d.icon).length > 2 || /[\x00-\x7F]/.test(d.icon)) errors.push(at + ': icon must be exactly one emoji');

      if (SEV_IDS.indexOf(d.sev) < 0) errors.push(at + ': sev must be one of ' + SEV_IDS.join('/'));
      if (!(typeof d.weight === 'number' && isFinite(d.weight) && d.weight > 0)) errors.push(at + ': weight must be a positive finite number');

      const lo = d.minInfluence, hi = d.maxInfluence;
      if (!Number.isInteger(lo) || lo < DILEMMA_ECON.influenceMin || lo > DILEMMA_ECON.influenceCap) errors.push(at + ': minInfluence out of range');
      if (!Number.isInteger(hi) || hi < DILEMMA_ECON.influenceMin || hi > DILEMMA_ECON.influenceCap) errors.push(at + ': maxInfluence out of range');
      if (Number.isInteger(lo) && Number.isInteger(hi) && lo > hi) errors.push(at + ': minInfluence above maxInfluence — this dilemma can never fire');

      const cs = Array.isArray(d.choices) ? d.choices : [];
      if (cs.length < DILEMMA_ECON.choicesMin) errors.push(at + ': ' + cs.length + ' choices, needs at least ' + DILEMMA_ECON.choicesMin);
      /* Round one warned here that exactly-the-minimum "can never vary the set".
         That warning is deleted, not softened: R9 now REQUIRES a quarter of the
         corpus to author exactly four, because a corpus where every entry has
         five or six rows is a corpus whose option list a player can predict by
         the fourth dilemma. Variety across entries beats variety inside one. */
      if (cs.length > CHOICES_MAX) errors.push(at + ': ' + cs.length + ' choices, more than ' + CHOICES_MAX + ' — past six the rows stop being distinct calls (R9)');
      if (cs.length === DILEMMA_ECON.choicesMin) minimalChoiceEntries++;
      if (!cs.some(c => c && c.always === true)) errors.push(at + ': no choice marked always:true — every offered set must contain one');

      const seenChoiceIds = Object.create(null);
      let anyPoles = false;
      let anyLoss = false;

      /* R1/R2 need the best FREE standing in this entry. Computed before the
         per-choice sweep so the paid rows can be judged against it as they are
         visited. R3 guarantees at least one free row exists (the refusal), so
         this is never -Infinity on a corpus that passes. */
      let maxFree = null;
      cs.forEach(c => {
        if (c && typeof c === 'object' && !isPaid(c) && Number.isInteger(c.influence)) {
          maxFree = (maxFree === null) ? c.influence : Math.max(maxFree, c.influence);
        }
      });
      if (maxFree === null && cs.length) errors.push(at + ': every choice costs Cinder — a dilemma must always be resolvable without money (R1)');

      cs.forEach((c, ci) => {
        const cat = at + '.choices[' + ci + ']' + (c && c.id ? ' ' + c.id : '');
        if (!c || typeof c !== 'object') { errors.push(cat + ': not an object'); return; }
        totalChoices++;

        if (typeof c.id !== 'string' || !CHOICE_ID_RE.test(c.id)) errors.push(cat + ': id must match /^[a-z0-9_]+$/');
        else if (seenChoiceIds[c.id]) errors.push(cat + ': duplicate choice id within this dilemma'); else seenChoiceIds[c.id] = 1;

        prose(cat + '.label', c.label, LABEL_MAX);
        prose(cat + '.desc', c.desc, 0);
        prose(cat + '.outcome', c.outcome, 0);
        if (typeof c.label === 'string') labels.push({ at: cat, n: wc(c.label), s: c.label });
        if (typeof c.desc === 'string') descs.push({ at: cat, n: wc(c.desc), s: c.desc });
        if (typeof c.outcome === 'string') outcomes.push({ at: cat, n: wc(c.outcome), s: c.outcome });
        if (typeof c.outcome === 'string' && /^[\x00-\x7F]/.test(c.outcome)) errors.push(cat + '.outcome: must open with one emoji, as every camp log line does');

        if (typeof c.always !== 'boolean') errors.push(cat + ': always must be a boolean');

        if (!Array.isArray(c.poles)) errors.push(cat + ': poles must be an array (an empty one is legal and means "procedural")');
        else {
          if (c.poles.length > 2) errors.push(cat + ': more than two poles — a choice that is about everything is about nothing');
          if (c.poles.length) anyPoles = true;
          c.poles.forEach(p => { if (POLE_IDS.indexOf(p) < 0) errors.push(cat + ': unknown pole "' + p + '"'); });
          if (new Set(c.poles).size !== c.poles.length) errors.push(cat + ': duplicate pole');
          /* Two poles on the SAME axis is self-contradiction: engine.stanceFor
             would find a support hit and an oppose hit from one unit pole and
             fall through to 'torn' for everybody, every time. */
          if (c.poles.length === 2 && axisOf(c.poles[0]) === axisOf(c.poles[1])) {
            errors.push(cat + ': both poles sit on the same axis — no unit could ever land support or against');
          }
          new Set(c.poles).forEach(p => {
            if (POLE_IDS.indexOf(p) < 0) return;
            poleCount[p]++;
            poleChoices[p]++;
            if (isPaid(c)) paidPoleCount[p]++;
          });
        }

        if (DILEMMA_ECON.choiceWeights.indexOf(c.weight) < 0) errors.push(cat + ': weight must be one of ' + DILEMMA_ECON.choiceWeights.join('/'));

        if (!Number.isInteger(c.influence)) errors.push(cat + ': influence must be an integer');
        else {
          if (Math.abs(c.influence) > DILEMMA_ECON.influenceMax) errors.push(cat + ': |influence| above influenceMax');
          if (c.influence < 0) anyLoss = true;
        }

        if (c.cost != null) {
          if (typeof c.cost !== 'object') errors.push(cat + '.cost: must be an object or null');
          /* R8 — the cost ceiling. Bounded from above by the same constant the
             refund clamp uses, so the corpus and rewards.refundCost() can never
             disagree about what an unrefundable cost would be. */
          else if (!Number.isInteger(c.cost.cinder) || c.cost.cinder < 1 || c.cost.cinder > DILEMMA_ECON.maxChoiceCost) {
            errors.push(cat + '.cost.cinder: ' + c.cost.cinder + ' — must be an integer in one to ' + DILEMMA_ECON.maxChoiceCost + ' (R8)');
          }
        }

        if (c.reward != null) {
          payingChoices++;
          if (typeof c.reward !== 'object') errors.push(cat + '.reward: must be an object or null');
          else {
            const r = c.reward;
            if (r.chance != null && !(typeof r.chance === 'number' && r.chance >= 0 && r.chance <= 1)) errors.push(cat + '.reward.chance: must be a number in [0,1]');
            if (r.cinder != null && !Object.prototype.hasOwnProperty.call(DILEMMA_ECON.cinderBand, r.cinder)) errors.push(cat + '.reward.cinder: must be a key of DILEMMA_ECON.cinderBand');
            if (r.card != null) {
              if (typeof r.card !== 'object') errors.push(cat + '.reward.card: must be an object or null');
              else {
                if (!(typeof r.card.chance === 'number' && r.card.chance >= 0 && r.card.chance <= 1)) errors.push(cat + '.reward.card.chance: must be a number in [0,1]');
                if (r.card.rarity != null && typeof r.card.rarity !== 'string') errors.push(cat + '.reward.card.rarity: must be a rarity id string or null');
              }
            }
            if (r.cinder == null && r.card == null) errors.push(cat + '.reward: pays nothing — use null instead');
          }
        }

        /* ── R3. THE REFUSAL COSTS STANDING, CANNOT BE BOUGHT, AND NEVER PAYS.
           The always-row is offered in every set, so if it were free of standing
           it would also be the risk-free row and the entry would have a correct
           answer. Round one asserted this rule in its own header and then
           shipped three refusals at zero. It also guarantees maxFree exists for
           R1 and R2, since a refusal can never be a paid choice. */
        if (c.always === true) {
          if (costOf(c) !== 0) errors.push(cat + ': always:true but costs ' + costOf(c) + ' Cinder — you can always walk away (R3)');
          if (Number.isInteger(c.influence) && !(c.influence < 0)) errors.push(cat + ': always:true at influence ' + c.influence + ' — doing nothing in Ethos Heights costs standing (R3)');
          if (c.reward != null) errors.push(cat + ': always:true carries a reward — refusing never pays (R3)');
          if (typeof c.outcome === 'string') {
            const g = firstGlyph(c.outcome);
            refusalGlyphs[g] = (refusalGlyphs[g] || 0) + 1;
          }
        }

        /* ── R1. PAID DOMINANCE, PER DILEMMA. Money buys the OUTCOME, never the
           STANDING. eh_the_thief is the pattern: work_it_off at plus five, free,
           beats pay_grocer at plus two for two hundred Cinder. */
        if (isPaid(c) && Number.isInteger(c.influence) && maxFree !== null) {
          if (c.influence > maxFree) {
            errors.push(cat + ': paid choice at influence ' + c.influence + ' beats the best free choice at ' + maxFree +
              ' — money buys the outcome, never the standing (R1)');
          }
          paidMargins.push(c.influence - maxFree);
        }
      });

      /* ── R4. NO STRICTLY DOMINATED CHOICE. `b` dominates `a` when it is at
         least as good on all four axes a player can read — price, standing,
         the units it reaches for bond, and expected payout — and strictly
         better on one. A row nobody optimising would ever pick is padding
         toward a choice count, not a call. Refusals are exempt as the DOMINATED
         side: the always-row is deliberately the worst deal in the entry and is
         present for what it says about you, not for what it returns. */
      cs.forEach((a, ai) => {
        if (!a || typeof a !== 'object' || a.always === true) return;
        if (!Number.isInteger(a.influence) || !Array.isArray(a.poles)) return;
        cs.forEach((b, bi) => {
          if (ai === bi || !b || typeof b !== 'object') return;
          if (!Number.isInteger(b.influence) || !Array.isArray(b.poles)) return;
          const ca = costOf(a), cb = costOf(b), ea = evOf(a), eb = evOf(b);
          if (!(cb <= ca && b.influence >= a.influence && isSubset(a.poles, b.poles) && eb >= ea)) return;
          /* Strictly better on at least one axis. The pole clause reads as a
             bare `!isSubset(b, a)` because the guard above already established
             a ⊆ b, so "b is not inside a" is exactly "b reaches units a does
             not". Ties on all four are legal: two choices can be equally good
             and still be different calls. */
          const strict = (cb < ca) || (b.influence > a.influence) || (eb > ea) || !isSubset(b.poles, a.poles);
          if (!strict) return;
          errors.push(at + ': choice "' + a.id + '" is dominated by "' + b.id + '" — cost ' + ca + ' vs ' + cb +
            ', influence ' + a.influence + ' vs ' + b.influence + ', poles [' + a.poles.join(',') + '] inside [' + b.poles.join(',') + '] (R4)');
        });
      });

      /* A dilemma where nothing can go wrong is scenery, and a dilemma no
         companion can have an opinion about is a menu. Both ship fine and both
         are the failure mode this corpus exists to avoid, so they warn loudly.
         (R3 makes anyLoss structurally true; the check stays because a future
         schema change to `always` should not silently take it with it.) */
      if (!anyLoss) warnings.push(at + ': no choice loses standing — a decision with no downside is not a dilemma');
      if (!anyPoles) warnings.push(at + ': no choice declares a pole — no unit in any deck can react to this');
    });

    /* 🚫 R7 — THE VENDING-MACHINE GUARD, and it is an ERROR rather than a
       warning. The BRIEF says "a dilemma that always pays is a vending
       machine", and the admin has already acted on that instinct once in this
       codebase: `index.html:64467` zeroes every match Cinder reward with the
       note "it will devalue our money". This is the mechanical form of the same
       instruction, checked over the WHOLE corpus rather than per entry, because
       the thing a player experiences is the rate across a session. */
    if (totalChoices > 0) {
      const ratio = payingChoices / totalChoices;
      if (ratio > DILEMMA_ECON.maxPayingRatio) {
        errors.push('R7 vending-machine guard: ' + payingChoices + ' of ' + totalChoices +
          ' choices carry a reward (' + ratio.toFixed(3) + '), above maxPayingRatio ' + DILEMMA_ECON.maxPayingRatio);
      }
    }

    /* ── R2. PAID DOMINANCE, CORPUS MEAN. R1 alone permits every paid branch to
       TIE the best free one, which still reads to a player as "paying is never
       worse". Averaged over the corpus, paying must cost you standing against
       the best free call. Round one measured plus 5.85 on paid against plus
       0.39 on free — the exact inversion of this rule. */
    if (paidMargins.length) {
      const mean = paidMargins.reduce((a, b) => a + b, 0) / paidMargins.length;
      if (!(mean <= PAID_MEAN_MARGIN)) {
        errors.push('R2 paid standing: mean(paid influence - best free influence) is ' + mean.toFixed(2) +
          ' over ' + paidMargins.length + ' paid choices, must be at most ' + PAID_MEAN_MARGIN.toFixed(1));
      }
    }

    /* ── R5. PAID CHOICES DO NOT OWN THE WARM POLES. Round one put mercy on
       nineteen paid choices, ambition on eleven and honor on eight against
       guile one, temperance one and ruthless zero — so the money branch
       maximised BOND as well as standing. That is R1 wearing a second hat and
       it has to be checked separately, because R1 and R2 are satisfied by
       standing alone. */
    let paidPoleTotal = 0;
    let paidPolesSeen = 0;
    POLE_IDS.forEach(p => { paidPoleTotal += paidPoleCount[p]; if (paidPoleCount[p] > 0) paidPolesSeen++; });
    if (paidPoleTotal > 0) {
      POLE_IDS.forEach(p => {
        const share = paidPoleCount[p] / paidPoleTotal;
        if (share > MAX_PAID_POLE_SHARE) {
          errors.push('R5 paid poles: "' + p + '" is on ' + paidPoleCount[p] + ' of ' + paidPoleTotal +
            ' paid pole slots (' + share.toFixed(3) + '), above ' + MAX_PAID_POLE_SHARE);
        }
      });
      if (paidPolesSeen < MIN_PAID_POLES) {
        errors.push('R5 paid poles: only ' + paidPolesSeen + ' of the eight poles appear on a paid choice, needs at least ' + MIN_PAID_POLES);
      }
    }

    /* ── R6. AXIS BALANCE, AND WHY IT IS THE MOST EXPENSIVE MISTAKE IN THE
       FILE. Bond is the owner's headline mechanic and a unit's stance is
       derived from the corpus's pole budget, so an unbalanced budget is a
       silent, permanent bond bias applied to whole archetypes. Round one wrote
       caution fifty-two times against valor sixteen while LQ_ARCHETYPE_POLE's
       valor regex (`index.html:73066`) is one of the broadest in the shipped
       table, so a deck of common melee archetypes lost bond for playing the
       feature at all. Nobody decided that. This rule means nobody can. */
    POLE_PAIRS.forEach(pair => {
      const a = poleCount[pair[0]], b = poleCount[pair[1]];
      const hi = Math.max(a, b), lo = Math.min(a, b);
      if (!(hi <= AXIS_RATIO_MAX * lo)) {
        errors.push('R6 axis balance: ' + pair[0] + ' ' + a + ' against ' + pair[1] + ' ' + b +
          ' — the larger must be at most ' + AXIS_RATIO_MAX + ' times the smaller');
      }
    });
    POLE_IDS.forEach(p => {
      if (poleChoices[p] < MIN_CHOICES_PER_POLE) {
        errors.push('R6 pole reach: "' + p + '" appears on only ' + poleChoices[p] +
          ' choices, needs at least ' + MIN_CHOICES_PER_POLE + ' or no deck can meet it');
      }
    });

    /* ── R9. STRUCTURAL VARIETY. Every clause here is a round-one measurement
       turned into a bound: thirty-two entries all authored at five or six
       choices, and twenty-eight of thirty-two refusals opened on the same fog
       glyph. The eligibility floors are the recentDepth starve check restated
       per band — a corpus can be large and still empty at one end of the
       standing range. */
    if (DILEMMAS.length < CORPUS_MIN || DILEMMAS.length > CORPUS_MAX) {
      errors.push('R9 corpus size: ' + DILEMMAS.length + ' dilemmas, must be between ' + CORPUS_MIN + ' and ' + CORPUS_MAX);
    }
    if (DILEMMAS.length > 0) {
      const minimalRatio = minimalChoiceEntries / DILEMMAS.length;
      if (!(minimalRatio >= MIN_MINIMAL_RATIO)) {
        errors.push('R9 choice counts: only ' + minimalChoiceEntries + ' of ' + DILEMMAS.length +
          ' entries author exactly ' + DILEMMA_ECON.choicesMin + ' choices (' + minimalRatio.toFixed(3) +
          '), needs at least ' + MIN_MINIMAL_RATIO);
      }
    }
    const eligAt = (v) => DILEMMAS.filter(d => d && Number.isInteger(d.minInfluence) && Number.isInteger(d.maxInfluence)
      && v >= d.minInfluence && v <= d.maxInfluence).length;
    const atZero = eligAt(DILEMMA_ECON.influenceMin);
    const atMid = eligAt(ELIGIBLE_MID);
    if (atZero < MIN_ELIGIBLE_AT_ZERO) errors.push('R9 eligibility: only ' + atZero + ' dilemmas at standing ' + DILEMMA_ECON.influenceMin + ', needs ' + MIN_ELIGIBLE_AT_ZERO);
    if (atMid < MIN_ELIGIBLE_AT_MID) errors.push('R9 eligibility: only ' + atMid + ' dilemmas at standing ' + ELIGIBLE_MID + ', needs ' + MIN_ELIGIBLE_AT_MID);
    const refusalTotal = Object.keys(refusalGlyphs).reduce((a, k) => a + refusalGlyphs[k], 0);
    if (refusalTotal > 0) {
      Object.keys(refusalGlyphs).forEach(g => {
        const share = refusalGlyphs[g] / refusalTotal;
        if (share > MAX_REFUSAL_GLYPH_PCT) {
          errors.push('R9 refusal glyphs: "' + g + '" opens ' + refusalGlyphs[g] + ' of ' + refusalTotal +
            ' refusals (' + share.toFixed(3) + '), above ' + MAX_REFUSAL_GLYPH_PCT);
        }
      });
    }

    /* ── V1-V10. THE VOICE, COUNTED. See the header: these are the rules the
       file already declared and then broke by a factor of two. The reference is
       the camp expedition log (`index.html:65663-65671`), which runs at a
       median of nine words and is full of fragments. */
    const oN = outcomes.length;
    if (oN) {
      const oWords = outcomes.map(o => o.n);
      const med = median(oWords);
      if (med < OUTCOME_WORDS_MIN_MED || med > OUTCOME_WORDS_MAX_MED) {
        errors.push('V1 outcome beat: median is ' + med + ' words, must be between ' +
          OUTCOME_WORDS_MIN_MED + ' and ' + OUTCOME_WORDS_MAX_MED);
      }
      outcomes.forEach(o => {
        if (o.n > OUTCOME_WORDS_MAX) errors.push('V2 ' + o.at + '.outcome: ' + o.n + ' words, max ' + OUTCOME_WORDS_MAX);
      });
      const shortN = outcomes.filter(o => o.n <= SHORT_OUTCOME_WORDS).length;
      if (!(shortN >= SHORT_OUTCOME_RATIO * oN)) {
        errors.push('V3 compression: ' + shortN + ' of ' + oN + ' outcomes land in ' + SHORT_OUTCOME_WORDS +
          ' words or fewer, needs at least ' + Math.ceil(SHORT_OUTCOME_RATIO * oN));
      }
      const fragN = outcomes.filter(o => ONE_WORD_SENTENCE.test(o.s)).length;
      if (fragN < MIN_ONE_WORD_LINES) {
        errors.push('V4 fragments: ' + fragN + ' outcome lines contain a one-word sentence, needs at least ' +
          MIN_ONE_WORD_LINES + ' — "Gone." "Even." "Cold."');
      }
      const nobodyN = outcomes.filter(o => NOBODY_RE.test(o.s)).length;
      if (!(nobodyN <= NOBODY_RATIO_MAX * oN)) {
        errors.push('V8 tic: "nobody" appears in ' + nobodyN + ' of ' + oN + ' outcomes, max ' +
          Math.floor(NOBODY_RATIO_MAX * oN) + ' — vary the negation');
      }
    }
    labels.forEach(l => {
      if (l.n > LABEL_WORDS_MAX) errors.push('V5 ' + l.at + '.label: ' + l.n + ' words, max ' + LABEL_WORDS_MAX + ' — labels are buttons');
    });
    if (descs.length) {
      const dm = median(descs.map(x => x.n));
      if (dm > DESC_WORDS_MED_MAX) errors.push('V6 desc beat: median is ' + dm + ' words, max ' + DESC_WORDS_MED_MAX);
      descs.forEach(x => { if (x.n > DESC_WORDS_MAX) errors.push('V6 ' + x.at + '.desc: ' + x.n + ' words, max ' + DESC_WORDS_MAX); });
    }
    if (briefs.length) {
      const bm = median(briefs.map(x => x.n));
      if (bm > BRIEF_WORDS_MED_MAX) errors.push('V7 brief beat: median is ' + bm + ' words, max ' + BRIEF_WORDS_MED_MAX);
      briefs.forEach(x => { if (x.n > BRIEF_WORDS_MAX) errors.push('V7 ' + x.at + '.brief: ' + x.n + ' words, max ' + BRIEF_WORDS_MAX); });
    }
    /* V9 — the ", which …" rider was the single most repeated sentence shape in
       round one: twenty-one of them across one hundred and seventy-two lines.
       It is the construction that makes prose read as generated, because it is
       how a sentence gets extended without a second thought behind it. */
    const riderN = outcomes.concat(descs, briefs).filter(x => WHICH_RIDER_RE.test(x.s)).length;
    if (riderN > WHICH_RIDERS_MAX) {
      errors.push('V9 tic: ' + riderN + ' lines carry a ", which" rider, max ' + WHICH_RIDERS_MAX + ' — drop the rider');
    }
    /* V10's exclamation, double-hyphen and curly-apostrophe halves are enforced
       per field by prose() above, which is where the offending field name is
       still in hand. Nothing to re-check here; this comment exists so a reader
       looking for V10 finds it rather than assuming it went missing. */

    /* INFLUENCE_RANKS must be ascending and start at zero or rank() can miss. */
    if (!Array.isArray(INFLUENCE_RANKS) || !INFLUENCE_RANKS.length) errors.push('INFLUENCE_RANKS is empty');
    else {
      if (!INFLUENCE_RANKS[0] || INFLUENCE_RANKS[0].min !== DILEMMA_ECON.influenceMin) errors.push('INFLUENCE_RANKS[0].min must equal influenceMin so a lookup can never miss');
      for (let i = 1; i < INFLUENCE_RANKS.length; i++) {
        if (!(INFLUENCE_RANKS[i].min > INFLUENCE_RANKS[i - 1].min)) errors.push('INFLUENCE_RANKS must ascend strictly at index ' + i);
      }
    }

    /* Every band of standing must reach SOMETHING, or a player at that standing
       opens the modal to nothing and the degradation ladder runs on every open.
       Checked at each rank floor rather than every integer — that is where a
       player actually sits long enough to notice. */
    INFLUENCE_RANKS.forEach(r => {
      /* Skip entries already reported as malformed above. Without the guard a
         single null row aborts the whole sweep through the outer catch, and the
         report a reviewer reads is missing the vending-machine ratio and the
         rank checks — the audit stops being an audit exactly when it is most
         needed. Caught by running this function against a corrupted copy. */
      const n = DILEMMAS.filter(d => d && Number.isInteger(d.minInfluence) && Number.isInteger(d.maxInfluence)
        && r.min >= d.minInfluence && r.min <= d.maxInfluence).length;
      if (n === 0) errors.push('no dilemma is eligible at standing ' + r.min + ' (' + r.name + ')');
      else if (n <= DILEMMA_ECON.recentDepth) warnings.push('only ' + n + ' dilemmas eligible at standing ' + r.min + ' (' + r.name + ') — the recent block can empty the pool there');
    });
  } catch (e) {
    /* The audit must not be the thing that breaks. Report the failure as data. */
    errors.push('validateCorpus threw: ' + (e && e.message ? e.message : String(e)));
  }
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

/* Local mirror of LQ_POLE_AXIS (`index.html:73034`), same reasoning as
   POLE_PAIRS above: a lexical global an ES module cannot see, duplicated here
   ONLY so validateCorpus can catch a same-axis pole pair. */
function axisOf(pole) {
  switch (pole) {
    case 'honor': case 'guile': return 'honor';
    case 'mercy': case 'ruthless': return 'mercy';
    case 'valor': case 'caution': return 'valor';
    case 'ambition': case 'temperance': return 'ambition';
    default: return null;
  }
}
