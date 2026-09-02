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
   `index.html:80622-80624` states it for CORP_LAWS ("the render code reads it,
   the scorer reads it, the mood pressure reads it… one table, no literals
   downstream"). engine.js, rewards.js, render.js and index.js must not carry a
   reward, cost, bond, cooldown, count or clamp literal of their own.

   🔴 `_opEcon()` ITSELF IS NOT USED AND MUST NOT BE — do not "fix" this.
   CLAUDE.md says all *operation* pricing goes through `_opEcon()`, and that is
   scoped to the word operation: `_opEcon(t)` (index.html) is
   `OPS_ECON[t] || null` over the business-operation keys (`OPS_ECON`,
   index.html). It returns null for anything else, and adding a
   `dilemma` key would put a non-business into the Just Business catalog — that
   catalog is built from `Object.keys(OPS_ECON)` (index.html, built by the Creator ops-econ
   overlay's `draw()`, `index.html:159849`), so a fake op would appear as a BUYABLE BUSINESS in the
   shop. Not a risk; a certainty. The rule's spirit is honoured by the
   one-table discipline above, which is what CORP_LAWS does.

   ════════════════════════════════════════════════════════════════════════════
   VOICE — the rules, taken from the camp expedition log (`CAMP_LOOT_FLAVOR`,
   index.html) and the Situation Board (`RECON_EVENTS`,
   index.html).

   🔴 ROUND ONE WROTE THESE RULES DOWN AND THEN BROKE THEM, WHICH IS WHY THEY
   ARE NOW MEASURED. The first corpus declared "eight to fourteen words is the
   beat" and "truncated fragments are correct and frequent — Gone. Halted." and
   then shipped a median outcome of TWENTY words, zero of one hundred and
   seventy-two lines under twelve, and not one single-word sentence in the whole
   file. A rule that lives only in a comment is a rule that rots. Rules V1-V12
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
    10. 🔴 AND THE WORST TIC IS NOT A WORD, IT IS A RHYTHM. Rules 1-9 all judge
        a line on its own, and a corpus can pass every one of them and still be
        written in a single tune. This one was: seventy-two of ninety-seven
        outcomes were exactly two sentences with the sting in the second, and
        forty-five of them opened on the word "The". Any one is a good line.
        Nine in a row and the reader hears the shape before the sentence, which
        is the sound of a machine and not of somebody telling you what happened.
        Fixed by rewriting sixty-eight lines, and then BOUNDED, because it had
        already been measured and deferred twice: the shares are now zero and
        forty-five, and V11 and V12 hold the ceilings. Start on the thing that
        happened. Let a line be one sentence, or three, when three is what it
        is.

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
   EMBODIES, from the shipped eight (`LQ_POLE_AXIS`, index.html), and
   engine.js derives each companion's stance — support, middle, against — from
   the unit's own `valueProfile` (`_lqUnitValueProfile`, index.html).
   Opposition is derived from the AXIS, never authored: writing
   `oppose: ['mercy']` on a choice that also embodies mercy produces an
   incoherent entry no cheap validator could catch, and deriving it makes that
   entry unwritable. It is `_lqPoleVerdict` (index.html) turned inside
   out — and that function's `null` return is this codebase's own name for the
   Middle stance.

   🔴 THE POLE BUDGET IS A BALANCE DECISION, SO IT IS CHECKED (R5, R6). Round
   one authored caution fifty-two times against valor sixteen, while valor is
   matched by one of the broadest regexes in the shipped archetype table
   (`LQ_ARCHETYPE_POLE`, index.html — warrior|vanguard|champion|fighter|
   brawler|gladiator|knight|barbar|hunter|warlord|storm|bird). A deck of common
   melee archetypes therefore took a systematic net bond DRAIN from simply
   playing the feature, on the owner's headline mechanic, because of a ratio
   nobody chose. R6 holds each opposed pair inside three to two. R5 stops the
   paid branch owning the warm poles as well as the standing, which is R1
   wearing a second hat.

   🔴 AND R6 WAS NOT ENOUGH, WHICH IS THE MOST IMPORTANT LINE IN THIS HEADER.
   Round two satisfied R6 handsomely — mercy thirteen against ruthless
   seventeen, every opposed pair inside one point four to one — and then parked
   ruthless, ambition and caution on rows nobody takes. Over the twenty rows
   that were the per-dilemma standing MAXIMUM, the population a player who reads
   the "+N standing" tags actually plays, those three poles scored ZERO. So the
   archetype bond drain survived its own fix at one remove: every berserker,
   raider, reaver, alien, swarm and vampiric class routes to `ruthless` and
   every mage, summoner, warlock, archon and necro class routes to `ambition`
   (`LQ_ARCHETYPE_POLE` again), and both buckets took twelve against hits and
   zero support hits from one pass of the corpus played the obvious way.
   R10 is R6's arithmetic run over top(D) instead of over every choice. R14
   caps how often that top row may be a LONE row, because round two shipped
   twenty of twenty entries where the largest number on screen was the answer
   and the mean margin over second place was under two. R13 replaces a warning
   that had gone permanently silent: at least half the corpus must contain an
   ACTION that costs standing, or the street rewards intervening for its own
   sake and the entry asks how much you want rather than what you will give up.
   Between them: the corpus is balanced, AND the line through it is balanced.

   🃏 A CARD IS THE ONE REWARD WITH NO INVERSE, SO IT IS AUTHORED LIKE ONE.
   The owner asked for cards by name and round two shipped none at all — twelve
   rewarding choices, every one of them `card: null`, and four downstream code
   paths dead against shipped content. R11 makes their absence an error. It also
   fixes the shape: a card-carrying choice is always FREE (`grant()` cannot take
   a card back, so it must never share a row with a charge), never certain
   (chance is open at zero and closed at a half), never behind a dead outer gate
   (R11.10), and never stacked on the top Cinder band. And in this world a card
   is not a loot table entry — it is Ouroboros technology, part of the connection
   that puts an entity on the ground, and LORE.md says finding one "could
   fundamentally change a Survivor's chances of living through their next
   expedition". So it is authored onto a choice that plausibly puts a hand into
   the ruins or into somebody's stock: a block gone into, a door walked through,
   a stall impounded, a stair opened for the first time since the water. Never a
   civic bonus. Never a thank-you.

   🔴 AND THE ROW MAY NOT NAME A RARITY THE GAME CANNOT MINT. Round three
   authored uncommon, rare and epic requests and `describeChoice` printed them
   on the row before the player chose. Every built-in card in this codebase
   resolves to Common — 75 poolable cards across six arrays, not one `rarity:`
   field between them — so the game handed over a Common every time and the tag
   was false on 56% of grants. Four of the five card rows now request nothing at
   all, which is both the truth and the better line: what is behind that stair
   has not been reached since the water, so nobody knows what it is. The fifth
   is a market stall's impounded inventory and asks for `common`, the one band
   the pool can fill. What makes a card an EVENT here is not a word on a tag; it
   is that five rows in twenty entries can produce one, at a joint probability
   between eleven and twenty per cent, behind a forty-five-minute cooldown. The
   scarcity is real, so the line does not have to oversell it. CARD_RARITY_IDS
   carries the measurement and the argument.

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
     `GEM_REWARDS = { perBattle: 0, winBonus: 0, … }` in index.html,
     with the note "it will devalue our money" directly above it. */
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
   only ever REMOVE Cinder through `spendGems()` (index.html), which
   refuses rather than going negative, so a mis-tuned cost cannot inflate
   anything — and R8 bounds it from above. */

/* ────────────────────────────────────────────────────────────────────────────
   INFLUENCE_RANKS — standing with ONE city, given a name a player can say.
   Modelled on RESERVE_RANKS (index.html): ascending, `min: 0` on the
   first row so a lookup can never miss and never returns null.
   ⚠ This ladder is DISPLAY. It is not one of Influence's three consumers (the
   gate band, the reward multiplier and the choice-count floor are). It is
   listed here so nobody counts it toward the two the BRIEF requires.
   Colours are `:root` tokens (`index.html:94-129`) by value, not new hexes:
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
   is not invented — it is `needMorale` on `RECON_EVENTS` (index.html),
   read by that table's own pool filter and generalised to a band. Low standing means the
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
        outcome: '🚰 Clinic taps ran clear by dusk and the market shuttered early.',
      },
      {
        id: 'west_market', always: false, weight: 1,
        label: 'Turn the pressure west',
        desc: 'Trade keeps the crews paid and the clinic carries buckets.',
        poles: ['ambition'], influence: 4,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🪙 Stalls opened on time. At the clinic they carried water all night.',
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
        outcome: '🌫 Valve stayed shut. By morning the street had stopped asking you.',
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
        poles: ['mercy'], influence: 3,
        cost: null, reward: null,
        outcome: '⚡ Lifts kept running while the Row costed out a cold restart.',
      },
      {
        id: 'shed_homes', always: false, weight: 1,
        label: 'Shed the Terrace, keep the furnaces',
        desc: 'Quota is met and the stairwells go dark.',
        poles: ['ruthless', 'ambition'], influence: -3,
        cost: null, reward: { chance: 0.45, cinder: 'mid', card: null },
        outcome: '⚡ Quota made. Upstairs they carried lamps for a week.',
      },
      {
        id: 'rolling', always: false, weight: 1.5,
        label: 'Rotate the outage block by block',
        desc: 'Everyone loses an hour of the evening.',
        poles: ['temperance'], influence: 4,
        cost: null, reward: null,
        outcome: '⚡ Everyone dark an hour. Even.',
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
        outcome: '🧾 Crews read the ledger. A foreman left the Row. Then another.',
      },
      {
        id: 'stretch_it', always: false, weight: 1,
        label: 'Stretch the next month thin',
        desc: 'Half now, half later, and the halves never match.',
        poles: ['temperance'], influence: -2,
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
        poles: ['ruthless'], influence: 5,
        cost: null, reward: null,
        outcome: '🧾 They took the clerk at dawn. The office is very quiet. Careful.',
      },
      {
        id: 'say_nothing', always: true, weight: 0.5,
        label: 'Say nothing about the slip',
        desc: 'It is not your ledger and not your Row.',
        poles: ['guile'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 Payday came and went. A family left the Row that week. Unpaid.',
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
        outcome: '🪙 You made the grocer whole. The boy watched you pay. He took again in spring.',
      },
      {
        id: 'hand_to_ward', always: false, weight: 1,
        label: 'Hand him to the ward office',
        desc: 'A file is opened and his sister is listed on it.',
        poles: ['honor'], influence: 1,
        cost: null, reward: null,
        outcome: '📋 Ward clerks opened a file with his sister already on it.',
      },
      {
        id: 'look_the_other_way', always: true, weight: 0.5,
        label: 'Look the other way',
        desc: 'It is bread, and it is not your shop.',
        poles: ['guile'], influence: -3,
        cost: null, reward: null,
        outcome: '📪 Grocer stopped asking after a week. He bars the door at dusk now.',
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
        poles: ['guile', 'mercy'], influence: 3,
        cost: null, reward: null,
        outcome: '✨ She left on the night truck and her mother stayed to answer questions.',
      },
      {
        id: 'hand_over', always: false, weight: 1,
        label: 'Give the liaison her address',
        desc: 'Containment is a word the Foundation still uses kindly.',
        poles: ['honor', 'ruthless'], influence: -2,
        cost: null, reward: { chance: 0.5, cinder: 'mid', card: null },
        outcome: '🏛 They came in daylight and were polite. The stairwell has not spoken since.',
      },
      {
        id: 'teach_her', always: false, weight: 1,
        label: 'Ask the Yards to teach her',
        desc: 'Old hands, no paperwork, and no promises.',
        poles: ['temperance'], influence: 4,
        cost: null, reward: null,
        outcome: '✨ Two old hands took her mornings. She has burned nothing since. Yet.',
      },
      {
        id: 'pay_the_liaison', always: false, weight: 1,
        label: 'Pay the liaison to lose the file',
        desc: 'Cinder buys a clerical error that holds for a season.',
        poles: ['ambition'], influence: 1,
        cost: { cinder: 900 }, reward: null,
        outcome: '🪙 File gone by Friday. Your liaison knows what you will pay now.',
      },
      {
        id: 'say_nothing_yards', always: true, weight: 0.5,
        label: 'Say nothing to anyone',
        desc: 'You were not there and you saw no hands.',
        poles: ['guile'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 He asked again. Somebody answered.',
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
      /* 🔴 THE ONE ENTRY WHERE THE STANDING TAG SAYS NOTHING AT ALL. All three
         actions sit at the same standing, so the "+N" render.js prints on every
         row before the player reads a line is identical across the three and
         chooses nothing. What is left is the pole set — study, seal, or hand it
         to H.I.S. OPS — and the three are mutually disjoint, so this entry is
         purely "which of your companions do you want to be right". Authored
         once, deliberately: it is the shape R14 exists to permit, not a shape
         the whole corpus should take. */
      {
        id: 'let_them_study', always: false, weight: 1,
        label: 'Let the dreamers keep a log',
        desc: 'They write it down and the liaison reads it later.',
        poles: ['ambition'], influence: 4,
        cost: null, reward: null,
        outcome: '🌀 Their log filled in a fortnight. One dreamer stopped waking up.',
      },
      {
        id: 'seal_the_blocks', always: false, weight: 1,
        label: 'Seal the four blocks at night',
        desc: 'Curfew, shutters, and nobody sleeps in the corridor.',
        poles: ['caution', 'ruthless'], influence: 4,
        cost: null, reward: null,
        outcome: '🌀 Dreaming stopped. So did the market. Gone.',
      },
      {
        id: 'call_his_ops', always: false, weight: 1,
        label: 'Call H.I.S. OPS to walk it',
        desc: 'Operatives, lamps, and a report you will not read.',
        poles: ['honor', 'valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🛡 They walked the corridor twice. Two of them dream it now.',
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
      /* 🃏 CARD, BAND NOT NAMED (rarity null). The beam lifts stone off a stair
         that has been shut since the water came, and nothing behind it has been
         reached by anybody — so nobody in the fiction knows what is down there
         and this row must not pretend to. Round three wrote `rarity: 'common'`
         here and justified it as "ordinary stock"; the stock is a room nobody
         has opened. `null` is the honest request and it is also the only one
         that lets the install's own pool answer. See CARD_RARITY_IDS. */
      {
        id: 'lift_the_stair', always: false, weight: 1,
        label: 'Summon something that can lift',
        desc: 'A collapsed stair, and forty people behind it.',
        poles: ['mercy'], influence: 3,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: { chance: 0.3, rarity: null } },
        outcome: '🛰 Beam carried stone off the stair until dawn. Rooms behind had been shut since the water. Then it went.',
      },
      {
        id: 'guard_the_market', always: false, weight: 1,
        label: 'Put a guard on the market',
        desc: 'Something armed stands in the square until the window closes.',
        poles: ['valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🛰 Stalls opened late and stayed open. Traders slept. The stair is still down.',
      },
      {
        id: 'foundation_takes_it', always: false, weight: 1,
        label: 'Give the window to the Foundation',
        desc: 'They will not say what they intend to call down.',
        poles: ['caution', 'honor'], influence: -2,
        cost: null, reward: { chance: 0.35, cinder: 'mid', card: null },
        outcome: '🏛 Whatever they called stayed inside the cordon. The carrier was paid and sent home.',
      },
      /* 🪙 THE LABEL NAMES THE SUMMON, NOT THE CARD, AND THAT IS LOAD-BEARING.
         This row charges 1,200 Cinder and carries `reward: null` because R11.3
         keeps cards off paid rows — a card cannot be refunded, so it can never
         ride on a charge. Round three labelled it "Buy a card off the Ledge for
         it", and the first in-game run caught what that does to a player: "a
         card" is the exact string `describeChoice` prints for a card that lands
         in the collection, and the sibling row four lines up (`lift_the_stair`)
         prints "a card (12%)" in its own consequence footer. Read together, the
         paid row reads as the way to buy that card outright — and what 1,200
         Cinder actually buys is a cleared stair and an empty collection, with no
         "May return" line at all. The Ledge sells the card; what the player gets
         for the money is what comes down the beam. Do NOT close this the other
         way by hanging a card reward here: validateCorpus rejects it (R11.3). */
      {
        id: 'buy_the_card', always: false, weight: 1,
        label: 'Buy the stronger summon off the Ledge',
        desc: 'A stronger summon, bought at the seller price.',
        poles: ['ambition'], influence: 1,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🪙 Something bigger came down. The stair cleared by dawn. He names his own price now.',
      },
      {
        id: 'let_it_pass', always: true, weight: 0.5,
        label: 'Let the window pass',
        desc: 'The orbit comes round again in a season.',
        poles: ['temperance'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 Moonrise over an empty square. Nothing came down.',
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
        outcome: '🏛 He stopped at the burned block. By winter the ward clerk had been replaced.',
      },
      {
        id: 'build_hoarding', always: false, weight: 1,
        label: 'Put up the hoarding',
        desc: 'Paint, boards, and a street that photographs well.',
        poles: ['guile'], influence: -2,
        cost: null, reward: { chance: 0.5, cinder: 'small', card: null },
        outcome: '🎨 Boards up overnight, and behind them nothing changed.',
      },
      {
        id: 'ask_for_money', always: false, weight: 1,
        label: 'Ask the column for reconstruction funds',
        desc: 'You ask in the open, with the burned block behind you.',
        poles: ['ambition'], influence: 5,
        cost: null, reward: null,
        outcome: '🏛 Money was pledged in front of the column. Paper. The block is still burned.',
      },
      {
        id: 'feed_the_column', always: false, weight: 1,
        label: 'Pay for the reception yourself',
        desc: 'Tables, lamps, and a ward that owes you nothing.',
        poles: ['temperance'], influence: 2,
        cost: { cinder: 700 }, reward: null,
        outcome: '🪙 Reception went well. On the burned block they ate cold. Again.',
      },
      {
        id: 'move_the_tenants', always: false, weight: 1,
        label: 'Move the tenants for a week',
        desc: 'They come back to the same walls.',
        poles: ['ruthless'], influence: -1,
        cost: null, reward: null,
        outcome: '🏛 Gone for the visit, every one of them. Two families did not come back.',
      },
      {
        id: 'say_nothing_gov', always: true, weight: 0.5,
        label: 'Stay off the route',
        desc: 'Let the ward stage whatever it likes.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🔇 They came and went and nothing on that block moved.',
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
        poles: ['caution'], influence: 4,
        cost: null, reward: null,
        outcome: '⛓ Closed by Thursday. Still fed.',
      },
      {
        id: 'find_the_feeder', always: false, weight: 1,
        label: 'Find who is feeding it',
        desc: 'Somebody down there is being spoken to.',
        poles: ['guile'], influence: 4,
        cost: null, reward: null,
        outcome: '🕯 It was the caretaker. She has been going down there for years.',
      },
      {
        id: 'call_foundation', always: false, weight: 1,
        label: 'Call the Foundation to the door',
        desc: 'They own the seal and they will own the street.',
        poles: ['honor'], influence: -2,
        cost: null, reward: { chance: 0.3, cinder: 'large', card: null },
        outcome: '🏛 Containment took the block for a month. Nobody touched the seal.',
      },
      {
        id: 'open_it', always: false, weight: 1.5,
        label: 'Pay a crew to open the seal',
        desc: 'Whatever is behind it has been patient.',
        poles: ['valor', 'ruthless'], influence: 1,
        cost: { cinder: 1800 }, reward: null,
        outcome: '🚪 It came open on a Tuesday. Three of the crew came back up.',
      },
      {
        id: 'leave_the_stair', always: true, weight: 0.5,
        label: 'Leave the stair as it is',
        desc: 'The seal has held longer than the city has.',
        poles: ['caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🪨 Nothing changed at the door. The food kept going down. Nightly.',
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
        poles: ['ambition', 'ruthless'], influence: -2,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🏗 Foundations went in by autumn and the Sunday crowd stopped coming.',
      },
      {
        id: 'move_the_dead', always: false, weight: 1.5,
        label: 'Exhume and rebury them properly',
        desc: 'Slow, costly in labour, and every stone named.',
        poles: ['mercy', 'honor'], influence: 5,
        cost: null, reward: null,
        outcome: '⚱ It took the crews a season to give every stone a name back.',
      },
      {
        id: 'park_stays', always: false, weight: 1,
        label: 'Leave the park as it is',
        desc: 'The housing goes somewhere with worse light.',
        poles: ['temperance'], influence: 3,
        cost: null, reward: null,
        outcome: '🌳 They will build north instead.',
      },
      {
        id: 'ignore_it', always: true, weight: 0.5,
        label: 'Say nothing to the planners',
        desc: 'The survey is not your paperwork.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 It went through unread. First cut turned up bone.',
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
        /* Raised from three to four so it TIES `watch_it` for the standing
           maximum. R1's third clause (the lone top row) fired here and nowhere
           else: `watch_it` was the only row in this entry with the best standing
           AND the only row with a payout tag, so a player reading the two
           numbers render prints had no call to make. The Yards mostly want the
           thing gone, so the removal being worth as much as the curiosity is
           what the street would actually pay for.
           ⚠ Its pole stays `honor`. Re-poling it to `caution` would have taken
           R10's valor/caution ratio from 1.75 to 1.40 and left honor/guile at
           1.50 instead of the 1.75 this edit costs — and that is exactly the
           "content decision made for arithmetic reasons" R10's own comment says
           not to make. The ratio is stated below rather than engineered. */
        poles: ['honor'], influence: 4,
        cost: null, reward: null,
        outcome: '🛡 They took it before dawn. Whoever it waited for never came out.',
      },
      {
        id: 'burn_block', always: false, weight: 1,
        label: 'Burn the block it walks',
        desc: 'Nothing lives there now, and nothing will.',
        poles: ['ruthless', 'valor'], influence: -2,
        cost: null, reward: null,
        outcome: '🔥 It burned for two days and took four cleared buildings with it.',
      },
      {
        id: 'wards_and_lamps', always: false, weight: 1,
        label: 'Pay for lamps on every corner',
        desc: 'Light, salt and a night watch you fund.',
        poles: ['temperance'], influence: 1,
        cost: { cinder: 1000 }, reward: null,
        outcome: '🧪 It walks the Yards now.',
      },
      /* 🃏 CARD, BAND NOT NAMED. Whoever walked behind the specimen for a week
         followed it to a door and then went in. No Cinder on this row: nobody
         paid them, and what they carried back out is whatever was behind that
         door. Round three wrote `rarity: 'uncommon'` here for a reason that was
         not fictional at all — it was the vowel-initial request the retired
         R11.9 demanded, so `describeChoice` would have an "an Uncommon card"
         to print. It printed it. The game then handed over a Common, every
         time, because there is no uncommon card in the built-in pool to hand
         over. Making a downstream branch live by writing a line the game cannot
         honour is not keeping code live; it is buying coverage with a lie. */
      {
        id: 'watch_it', always: false, weight: 1.5,
        label: 'Follow it and learn what it wants',
        desc: 'Somebody walks behind it for a week.',
        poles: ['valor', 'guile'], influence: 4,
        cost: null, reward: { chance: 0.45, cinder: null, card: { chance: 0.25, rarity: null } },
        outcome: '🧪 It goes to a door on Harrow. It stands there. Somebody went in after it left.',
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
        outcome: '🪧 Sign stayed up, and neighbours cross the street now.',
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
        outcome: '🪧 Gone by morning. She never reopened.',
      },
      {
        id: 'look_away', always: true, weight: 0.5,
        label: 'Look away from the sign',
        desc: 'Signs are not your business on this street.',
        poles: ['guile'], influence: -2,
        cost: null, reward: null,
        outcome: '🧊 It found the street without you. Somebody broke the window.',
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
        poles: ['valor', 'ambition'], influence: 4,
        cost: null, reward: null,
        outcome: '🐕 It works the wall at night, and on Tuesday it found something.',
      },
      {
        id: 'drive_it_off', always: false, weight: 1,
        label: 'Drive it off the gate',
        desc: 'The rations are already thin enough.',
        poles: ['ruthless'], influence: -2,
        cost: null, reward: null,
        outcome: '🐕 They chased it into the dark. The youngest stopped speaking to them. For weeks.',
      },
      {
        id: 'leave_it', always: true, weight: 0.5,
        label: 'Leave it at the gate',
        desc: 'It will move on or it will not.',
        poles: ['temperance'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 Gone by Friday, though the crew still leave a bowl out.',
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
      /* 🃏 CARD, BAND NOT NAMED — this is the row the other three were rewritten
         to look like. It is the canonical Survivor expedition in LORE.md's own
         words: leave civilization, enter danger, discover something valuable,
         survive the journey home. Two people did not, and the outcome line says
         so and stops there. Asking the ruins rather than asking for a band is
         what puts grantCard's weighted roll and its any-lootable fallback on
         the live path (R11.7). */
      {
        id: 'clear_it_yourself', always: false, weight: 1.5,
        label: 'Take a crew in yourself',
        desc: 'You go first and the map gets corrected.',
        poles: ['valor', 'honor'], influence: 5,
        cost: null, reward: { chance: 0.5, cinder: null, card: { chance: 0.4, rarity: null } },
        outcome: '🧟 Two names went onto the wall.',
      },
      {
        id: 'fix_the_map', always: false, weight: 1,
        label: 'Correct the map and warn the wards',
        desc: 'Paper, not rifles, and the block stays shut.',
        poles: ['caution', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '📋 Corrected on paper. Four wards read it. The block waits.',
      },
      {
        id: 'hire_hunters', always: false, weight: 1,
        label: 'Hire hunters off the Ledge',
        desc: 'They ask no questions and keep the salvage.',
        poles: ['guile'], influence: 2,
        cost: { cinder: 1400 }, reward: null,
        outcome: '🪙 Cleared in a night. Stripped bare. The tenants came home to nothing.',
      },
      {
        id: 'wall_it', always: false, weight: 1,
        label: 'Wall the block off',
        desc: 'Brick and wire, and the river side stays lost.',
        poles: ['caution', 'temperance'], influence: 5,
        cost: null, reward: null,
        outcome: '🧱 Up in a week, and the river road is closed for good.',
      },
      {
        id: 'call_ops_block', always: false, weight: 1,
        label: 'Ask H.I.S. OPS for a sweep',
        desc: 'Operatives work it and the ward pays in access.',
        poles: ['ambition'], influence: -2,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🛡 Three days to sweep it. The ward signed something it has not read.',
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
        outcome: '📄 Pages into a bag, sealed. The clerk asked for a transfer.',
      },
      {
        id: 'copy_first', always: false, weight: 1.5,
        label: 'Copy the pages before they go',
        desc: 'One set for the liaison, one for a drawer.',
        poles: ['guile'], influence: 5,
        cost: null, reward: null,
        outcome: '📄 You signed the redaction. A second set sits in a drawer. Quietly.',
      },
      {
        id: 'refuse_order', always: false, weight: 1.5,
        label: 'Refuse the redaction',
        desc: 'The record stays whole and the liaison stops calling.',
        poles: ['honor', 'valor'], influence: 4,
        cost: null, reward: null,
        outcome: '📄 Pages stayed. Barely.',
      },
      {
        id: 'read_them_out', always: false, weight: 1,
        label: 'Read the pages to the ward',
        desc: 'Whatever the street was, everybody hears it.',
        poles: ['ruthless'], influence: 5,
        cost: null, reward: null,
        outcome: '📄 You read the street name aloud. Two families packed that night.',
      },
      {
        id: 'operators_call', always: true, weight: 0.5,
        label: 'Leave it to the clerk',
        desc: 'It is the ward record and the ward spine.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 He signed it alone. By spring he was in another ward.',
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
        outcome: '🏚 Eleven doors filled in order and the clerk moved in on Friday.',
      },
      {
        id: 'by_need', always: false, weight: 1.5,
        label: 'Fill them by need instead',
        desc: 'You rank strangers by how badly they are doing.',
        poles: ['mercy'], influence: 5,
        cost: null, reward: null,
        outcome: '🏚 Worst cases went in first. List holders have not forgiven it.',
      },
      {
        id: 'lottery', always: false, weight: 1,
        label: 'Draw the doors by lot',
        desc: 'No judgement, no favour, and no sense.',
        poles: ['temperance'], influence: -2,
        cost: null, reward: null,
        outcome: '🏚 Drawn in public, drawn fair. Two winners sold their door by spring.',
      },
      {
        id: 'fix_more_doors', always: false, weight: 1,
        label: 'Pay to make more doors sound',
        desc: 'Timber, glass and a month of trades.',
        poles: ['valor'], influence: 2,
        cost: { cinder: 1600 }, reward: null,
        outcome: '🔨 Six more doors by the thaw, and then the ward stopped budgeting for repairs.',
      },
      {
        id: 'clerk_off_list', always: false, weight: 1,
        label: 'Strike the clerk off the list',
        desc: 'He wrote himself in and everybody knew.',
        poles: ['ruthless'], influence: 5,
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
        outcome: '🛡 They took two people and a crate, and neither was what they announced.',
      },
      {
        id: 'warn_first', always: false, weight: 1.5,
        label: 'Warn the stairwells first',
        desc: 'Everyone gets a night to move what they have.',
        poles: ['mercy', 'guile'], influence: 5,
        cost: null, reward: null,
        outcome: '🛡 They found empty rooms and their squad leader knows why.',
      },
      {
        id: 'refuse_sweep', always: false, weight: 1,
        label: 'Spend the ward one refusal',
        desc: 'You use it here and not on whatever comes next.',
        poles: ['valor'], influence: 3,
        cost: null, reward: null,
        outcome: '🛡 Operatives left. Angry.',
      },
      {
        id: 'stand_aside', always: true, weight: 0.5,
        label: 'Stand aside and watch',
        desc: 'It is their squad and the ward decides.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 Floor to floor, all night. Four doors did not open again.',
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
        poles: ['caution'], influence: 4,
        cost: null, reward: null,
        outcome: '🧱 Bricked by Sunday. Something knocks.',
      },
      {
        id: 'study_it', always: false, weight: 1,
        label: 'Let the Foundation study the door',
        desc: 'They bring instruments and a cordon that never leaves.',
        poles: ['ambition', 'honor'], influence: 2,
        cost: null, reward: { chance: 0.3, cinder: 'large', card: null },
        outcome: '🏛 That cordon is permanent now. Two streets need a pass to go home.',
      },
      {
        id: 'send_through', always: false, weight: 1.5,
        label: 'Pay a Survivor to go through',
        desc: 'Somebody willing, equipped, and told the odds.',
        poles: ['ruthless'], influence: 1,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🚪 She came back coughing.',
      },
      /* 🃏 CARD, BAND NOT NAMED, and this is the row where that matters most.
         Somebody walks through a door into another sky and comes back out
         carrying something. Round three wrote `rarity: 'epic'` here — the
         biggest word the old list allowed — and the row then advertised "an
         Epic card (12%)" before the player chose and minted a Common after.
         The event is the door, not the word: what makes this a real find is
         that hardly anything in the feature hands a card over at all, and this
         row is one of five that ever can. Not on the top standing row either —
         sealing the courtyard scores higher with the district, and the player
         choosing the rescue is choosing it for its own sake. */
      {
        id: 'bring_back_one', always: false, weight: 1.5,
        label: 'Go in after the ones who went',
        desc: 'You do not know what is on the other side.',
        poles: ['mercy', 'valor'], influence: 3,
        cost: null, reward: { chance: 0.4, cinder: null, card: { chance: 0.3, rarity: null } },
        outcome: '🚪 Two came out with you. The third is still walking that sky.',
      },
      {
        id: 'leave_the_door', always: true, weight: 0.5,
        label: 'Leave the door open',
        desc: 'It was here before you and it is not yours.',
        poles: ['temperance'], influence: -4,
        cost: null, reward: null,
        outcome: '⏳ Still open, and two more went through this week.',
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
        outcome: '⛺ Everyone ate less by spring. The wall has never been better manned. Worth it.',
      },
      {
        id: 'take_the_useful', always: false, weight: 1,
        label: 'Take the ones who can work',
        desc: 'Trades in, and the rest walk back to the ruins.',
        poles: ['ruthless', 'ambition'], influence: -1,
        cost: null, reward: null,
        outcome: '⛺ Camp gained four trades and the rest went south.',
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
        outcome: '🌫 They walked south at first light and some will be back armed.',
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
        outcome: '🃏 Passed in a fortnight. Half the Ledge moved to the river.',
      },
      {
        id: 'buy_them_back', always: false, weight: 1,
        label: 'Buy the named cards back',
        desc: 'You pay a fair price for what was already theirs.',
        poles: ['mercy'], influence: 3,
        cost: { cinder: 1300 }, reward: null,
        outcome: '🪙 Families got their cards back. He doubled his prices by summer.',
      },
      {
        id: 'let_it_trade', always: false, weight: 1,
        label: 'Let the Ledge trade',
        desc: 'A card is a card and a market is a market.',
        poles: ['ambition'], influence: 1,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🃏 Trade went on.',
      },
      /* 🃏 CARD, and THE ONLY ROW IN THE CORPUS THAT NAMES A BAND: `common`.
         It is the only row whose card is not a find. This is impounded stock —
         a market stall's inventory, counted by a clerk. Half the box was pulled
         off the dead and has a family waiting for it; the rest has no name on
         the back and nobody to give it to. Ordinary is the point, and `common`
         is also the one request a stock install can actually honour, because it
         is the one rarity `grantCard`'s byRarity filter finds anything under
         (CARD_RARITY_IDS). So the single named request in the file sits on the
         single row whose fiction is an inventory. The stall's till comes in
         with it, which is the small Cinder band and is exactly as comfortable
         as it sounds. This row ties `write_the_rule` on standing and reaches the
         opposite pole, so the ruthless call is the one that pays and the
         honourable one is not — which is the entry, and is why R11 keeps cards
         off paid rows but never off cold ones. */
      {
        id: 'take_the_licence', always: false, weight: 1,
        label: 'Pull the seller licence',
        desc: 'One trader loses everything and the rest take note.',
        poles: ['ruthless'], influence: 5,
        cost: null, reward: { chance: 0.5, cinder: 'small', card: { chance: 0.35, rarity: 'common' } },
        outcome: '🃏 His stall was gone by Tuesday. Half the box carried no name at all. River traders got the rest.',
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
        outcome: '🃏 Stalls stayed. A widow broke one with a bar.',
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

   🔴 AND WHY A RULE THAT CANNOT FAIL IS WORSE THAN NO RULE. Round two shipped a
   warning here — "no choice loses standing" — whose own comment conceded R3 had
   made it structurally impossible to fire. It sat in the file looking like a
   guard while the thing it nominally watched regressed from twenty-six entries
   in thirty-two to seven in twenty. It is DELETED, and R13 asks the live
   version of the question as an error. Every rule added this round was driven
   against a deliberately broken copy of this corpus before it was trusted; a
   rule nobody has watched fail is a rule nobody has tested.

   Errors are things that would ship a broken, dishonest or unbalanced entry.
   Warnings are things that would ship a boring one.

   The inventory, so a reader can find a rule by what it is for:
     R1  paid choice may not beat the best free choice in its entry
     R2  paying costs standing on average across the corpus
     R3  the refusal costs standing, cannot be bought, and never pays
     R4  no choice is dominated by a sibling on cost/standing/poles/payout
     R5  paid choices do not own the warm poles
     R6  axis balance and pole reach, over EVERY choice
     R7  the vending-machine guard on the reward ratio
     R8  the per-choice cost ceiling, shared with rewards.refundCost()
     R9  structural variety — corpus size, choice counts, eligibility, glyphs
     R10 axis balance over the per-dilemma standing MAXIMA — the play-line
     R11 the card rewards exist, can land, name only a band the pool can fill
     R13 at least half the corpus has an ACTION that costs standing
     R14 the largest STANDING on screen is not the answer in every entry
     R15 no single row is worth a good outcome every time it is taken
     V1-V10 the voice, counted, line by line
     V11-V12 the voice, counted ACROSS lines — the metronome
   (There is no R12. R11 grew numbered clauses of its own and renumbering the
   rest would break every citation in the four files that quote these ids.
   There is no R11.9 either, for a better reason: it was a live rule that made
   the corpus lie, and the retirement note where it used to fire is the point.)
   ──────────────────────────────────────────────────────────────────────────── */

const POLE_IDS = Object.freeze([
  'honor', 'guile', 'mercy', 'ruthless', 'valor', 'caution', 'ambition', 'temperance',
]);
/* The four opposed pairs, exactly LQ_POLE_AXIS (index.html). Duplicated
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
/* 🃏 THE ONE RARITY THIS FEATURE MAY REQUEST, AND WHY THE LIST USED TO HAVE
   FOUR NAMES IN IT.

   🔴 A RARITY IS A FILTER, NOT A PROMISE, AND ROUND THREE WROTE IT AS A PROMISE.
   `grantCard` (index.html) does exactly three things with the id it is
   handed: it filters the pack pool by it; if that filter is EMPTY it rolls
   `DEFAULT_PACK_RARITY_WEIGHTS` (index.html) up to six times; and if
   that finds nothing either it takes any lootable card at all. So an
   unsatisfiable request is not refused and does not fail — it silently becomes
   a different roll, and the player has already been shown the word.

   AND ON A STOCK INSTALL EVERY REQUEST ABOVE COMMON IS UNSATISFIABLE. Measured,
   not assumed: the six built-in pool arrays in index.html — UNIT_CARDS,
   SPELL_CARDS, LOCATION_CARDS, TRAP_CARDS, WALL_CARDS and WEATHER_CARDS, each
   a top-level `const` a grep for the name lands on —
   hold 75 cards between them and NOT ONE of them carries a `rarity` field.
   `getRarity` (index.html) is `RARITY_BY_ID[card && card.rarity] ||
   RARITY_BY_ID.common`, so the histogram over that whole pool is
   `{common: 75}`. Round three shipped requests for uncommon, rare and epic on
   three of the five card rows and `describeChoice` printed them on the row
   BEFORE the pick — "an Epic card (12%)" — while the game minted a Common
   every single time. That is the one dishonesty this file's comments keep
   promising not to commit, committed in the round that was called to deliver
   cards.

   SO THE LIST IS NOW WHAT THE SHIPPED GAME CAN ACTUALLY HAND OVER: `common`,
   and `null` for "whatever the ruins hold", which is not in the list because it
   is the absence of a request. Four of the five card rows ask for nothing and
   read like it; the fifth is a stall inventory and asks for `common`, which is
   the ONLY id whose byRarity filter is non-empty and therefore the only request
   in the file that actually binds the grant.

   ⚠ AND IT CAPS THE REQUEST, NOT THE GRANT — the old comment had this exactly
   backwards. It argued the four-name cap kept "a Legendary or a Mythic out of a
   forty-five-minute faucet". It cannot. Custom Forge and Catalog cards carry
   whatever rarity their author gave them and they are in the same pack pool
   (`getCardPoolForPacks`, index.html), so on an install with one custom
   Legendary in it a `null` request reaches Legendary through the weighted roll
   and the old `'epic'` request reached it through the SAME roll, because the
   epic filter was empty and fell through. Naming a band never bounded the
   outcome; it only bounded what we told the player. What is actually true is
   narrower and worth having: on a stock install this feature cannot mint above
   Common at all, because there is nothing above Common to mint.

   Driven end to end against the real arrays and a verbatim reconstruction of
   `grantCard`, 200,000 resolutions per card row: 145,664 cards minted, 75
   distinct ids, delivered rarity Common 145,664 times, and ZERO grants whose
   delivered rarity contradicted a named request. The same run with one custom
   Legendary and one custom Mythic added: the four `null` rows deliver Legendary
   1.4% and Mythic 0.26% of the time — the pool's own weighting, which is the
   install's business and not this file's promise — while the one `'common'`
   row delivers Common 35,224 of 35,224. That is the asymmetry stated above,
   measured: naming `common` BINDS the grant; every other value, `null`
   included, hands it to the pack weights.

   The Cinder analogy the old comment leaned on does not carry across.
   `sql/AUDIT_farmed_cinder.sql:15` is right that farmed and earned Cinder "are
   the same integer in the same column", which is why DILEMMA_ECON.cinderBand
   has a ceiling this file can enforce. A card's ceiling lives in a pool this
   module cannot see and did not fill. LORE.md's stake — "Finding a powerful
   card in the ruins could fundamentally change a Survivor's chances of living
   through their next expedition" — is met by SCARCITY, which R11.4 and R11.10
   do bound, and not by a word on a tag.

   The list is DUPLICATED rather than imported for the reason the whole feature
   exists: RARITIES is a top-level `const` in index.html, a lexical global an ES
   module cannot see (CLAUDE.md, the globals trap). R11.5 checks against THIS
   list, so if index.html ever starts shipping built-in cards with rarities,
   this constant is the one line to widen and R11 is where the mismatch
   surfaces. Not exported — `CONTRACT.md §2` freezes this file's export list at
   six names and a seventh is a contract change. */
const CARD_RARITY_IDS = Object.freeze(['common']);

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
/* V11/V12 — the metronome ceilings. Both are shares of the outcome lines, both
   are ceilings and not bans, and both are set with headroom above where the
   corpus now measures (0 of 97 and 45 of 97) so that a future entry is free to
   use either shape. They are not set where the corpus sits, because a bound
   fitted to today's numbers is a bound that fails on the next honest edit. What
   they refuse is the DEFAULT: the corpus they were written against was 49% and
   74%. */
const ARTICLE_OPEN_MAX_RATIO = 0.15;
const TWO_SENTENCE_MAX_RATIO = 0.60;
/* ── R10 / R13 / R14 — the TOP-ROW budget. These three exist because R6 was
   right and still missed the thing it was written to catch; see the block above
   R10 in validateCorpus() for the measurement that proved it. */
const TOP_POLE_MIN          = 2;    // every pole must top at least this many entries
const TOP_AXIS_RATIO_MAX    = 2.0;  // per opposed pair, over the top rows only
const MIN_COSTLY_ACTION_PCT = 0.5;  // share of entries where an ACTION loses standing
const MAX_UNIQUE_TOP_PCT    = 0.6;  // share of entries allowed a lone highest row
/* ── R11 — the card budget. Four to six is the band; the floor is what makes
   their ABSENCE an error, which is the whole point of the rule. */
const CARD_REWARDS_MIN      = 4;
const CARD_REWARDS_MAX      = 6;
const CARD_DILEMMAS_MIN     = 4;
const CARD_CHANCE_MAX       = 0.5;  // a card is never certain and never frequent
/* ── R15 — the per-row payout ceiling, named as a BAND rather than as a number
   so that retuning DILEMMA_ECON.cinderBand retunes the rule with it and the two
   can never disagree. R7 bounds how MANY rows pay; nothing bounded how much any
   one of them was worth, which is the hole the round-3 critic walked through
   with a free row carrying `{chance: 1, cinder: 'large'}` — 900 Cinder at
   certainty, legal under every rule in the file. */
const MAX_CHOICE_EV_BAND    = 'mid';

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
/* V11/V12's two measurements. Every outcome opens with one emoji and a space
   (enforced above), so "opens on an article" means the first WORD, and the
   leading glyph plus any punctuation has to come off first — which is the same
   thing wc() does for a different reason. Sentence counting splits on terminal
   punctuation followed by a space, so "Gone." at the end of a line counts as
   its own sentence, which is exactly the shape V4 rewards and V12 must be able
   to see. An em dash does NOT end a sentence here; it is punctuation inside
   one, per rule 5 of VOICE. */
const ARTICLE_OPEN_RE = /^(?:the|a|an)\b/i;
function stripGlyph(s) {
  return String(s == null ? '' : s).replace(/^[^A-Za-z0-9"']+/, '');
}
function sentenceCount(s) {
  return stripGlyph(s).split(/(?<=[.!?…])\s+/).filter(x => x.trim().length).length;
}

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
function hasCard(c) { return !!(c && c.reward && c.reward.card); }
/* "a out-pays b ON THE ROW", which is not the same question as evOf's. render's
   `choiceHtml` prints the Cinder tag and the card tag side by side, so a row
   with a card and no Cinder still reads as the richer row next to one with
   neither. evOf cannot say that — it deliberately values a card at zero,
   because a card's worth is not expressible in Cinder and a rule that guessed
   at it would be a rule nobody could check. This predicate does not guess
   either: it only ever says "strictly more visible payout", never how much
   more, which is all R1's third clause needs. */
function paysMoreThan(a, b) {
  if (evOf(a) > evOf(b)) return true;
  return hasCard(a) && !hasCard(b) && evOf(a) >= evOf(b);
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
    const topPoleCount = Object.create(null);     // R10, poles on the per-entry standing maxima
    let uniqueTopEntries = 0;                     // R14
    let lossyActionEntries = 0;                   // R13
    let cardRewardChoices = 0;                    // R11.1
    const cardRewardDilemmas = Object.create(null); // R11.2
    let cardRarityNull = 0;                       // R11.7
    let cardRarityNamed = 0;                      // R11.8
    /* R11.9's counter is GONE, not zeroed — see the retirement note at R11's
       aggregate block. A counter nobody reads is the same class of thing as the
       `!anyLoss` warning this file deleted a round ago. */
    const outcomes = [];                          // V1-V4, V8
    const labels = [];                            // V5
    const descs = [];                             // V6
    const briefs = [];                            // V7
    POLE_IDS.forEach(p => { paidPoleCount[p] = 0; poleCount[p] = 0; poleChoices[p] = 0; topPoleCount[p] = 0; });

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
      /* R13's per-entry term. Note the `always !== true`: round two's predicate
         counted the REFUSAL, which R3 forces negative, so it was true for every
         entry that could possibly exist. See R13 below. */
      let anyActionLoss = false;

      /* R1/R2 need the best FREE standing in this entry. Computed before the
         per-choice sweep so the paid rows can be judged against it as they are
         visited. R3 guarantees at least one free row exists (the refusal), so
         this is never -Infinity on a corpus that passes. */
      let maxFree = null;
      /* R1's tie clause needs the best free PAYOUT as well as the best free
         standing — see the second half of R1 below. */
      let maxFreeEv = 0;
      cs.forEach(c => {
        if (c && typeof c === 'object' && !isPaid(c) && Number.isInteger(c.influence)) {
          maxFree = (maxFree === null) ? c.influence : Math.max(maxFree, c.influence);
          maxFreeEv = Math.max(maxFreeEv, evOf(c));
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
          if (c.influence < 0 && c.always !== true) anyActionLoss = true;
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
            /* ── R11. THE CARD REWARD, PER CHOICE. The owner asked for cards by
               NAME, and a card is the one reward in this feature with no
               inverse: `grantCard` (index.html) mints into
               Profile.cardCollection and calls saveProfile(), and rewards.js
               spends a whole paragraph on the fact that there is no take-back.
               So the shape of a card-carrying choice is constrained harder than
               anything else here, and every clause below is one of those
               constraints made unwritable rather than merely agreed.
               `reward.card` is a REQUEST, not a grant — which card arrives is
               four Math.random() calls inside the bridge, none of them ours. */
            if (r.card != null) {
              cardRewardChoices++;
              if (typeof d.id === 'string') cardRewardDilemmas[d.id] = 1;
              if (typeof r.card !== 'object') errors.push(cat + '.reward.card: must be an object or null');
              else {
                /* R11.4 — open at zero, closed at a half. A card that always
                   lands is a vending machine with a better glyph on it; a card
                   at chance zero is a dead branch that reads as content. The
                   odds a player is shown are the PRODUCT of this and the
                   reward's own chance (`rewards.js` describeChoice), so the
                   joint figure is what an auditor sees, not this one. */
                if (!(typeof r.card.chance === 'number' && r.card.chance > 0 && r.card.chance <= CARD_CHANCE_MAX)) {
                  errors.push(cat + '.reward.card.chance: ' + r.card.chance + ' — must be a number in (0, ' + CARD_CHANCE_MAX + '] (R11.4)');
                }
                /* R11.5 — NO ROW MAY NAME A BAND THE SHIPPED POOL CANNOT FILL.
                   `null` means "whatever the ruins hold" and is a legal, useful
                   value: it exercises grantCard's weighted branch and its
                   any-lootable fallback, which is the half of that accessor
                   nothing else in the corpus reaches. A NAMED band is only
                   legal when byRarity can actually return something under it,
                   which on the built-in pool is `common` and nothing else — see
                   CARD_RARITY_IDS for the measurement. This clause is the one
                   that would have caught round three's 'uncommon' / 'rare' /
                   'epic'; it did not, because the list it checks against had
                   four names in it and only one of them was true. */
                if (r.card.rarity === null || r.card.rarity === undefined) {
                  cardRarityNull++;
                } else if (typeof r.card.rarity !== 'string' || CARD_RARITY_IDS.indexOf(r.card.rarity) < 0) {
                  errors.push(cat + '.reward.card.rarity: ' + JSON.stringify(r.card.rarity) +
                    ' — must be null, or a band the shipped card pool can actually fill (' +
                    CARD_RARITY_IDS.join('/') + '); anything else is printed on the row before the pick and then not delivered (R11.5)');
                } else {
                  cardRarityNamed++;
                }
                /* 🔴 R11.10 — THE OUTER GATE, WHICH IS THE FIELD THAT DECIDES
                   WHETHER A CARD CAN LAND AT ALL, AND WHICH R11 DID NOT READ.
                   `rollReward` tests `reward.chance` FIRST and returns "none"
                   before it ever looks at `reward.card`, so a card sitting
                   behind `chance: 0` is unreachable: zero cards in a million
                   rolls, and `describeChoice` prints the empty string, so the
                   row never even OFFERS one. Round three's R11.1 counted five
                   card rewards on such a corpus and returned
                   {ok:true, errors:[], warnings:[]} — the regression R11.1's own
                   comment promises to turn this function red for was one
                   character away and invisible. R11.4 bounded the NESTED chance
                   and stopped there, which is the same mistake at one remove:
                   a rule that counts a reward without checking that the reward
                   can arrive is a rule that certifies dead content. */
                if (!(typeof r.chance === 'number' && r.chance > 0 && r.chance <= 1)) {
                  errors.push(cat + '.reward.chance: ' + r.chance +
                    ' — a card-carrying reward must itself be able to land; rollReward gates on this before it reads reward.card, so at zero the card is unreachable and the row advertises nothing (R11.10)');
                }
                /* R11.3 — a card never rides on a charge. `grant()` cannot take
                   a card back and says so at length, so a row that both takes
                   Cinder and mints a card is a row where a partial failure has
                   no honest report. Keeping cards free also keeps R1, R2, R4 and
                   R5 out of the argument entirely: the card branch cannot become
                   a second Cinder-to-standing exchange rate because it is never
                   on the branch that costs Cinder. */
                if (costOf(c) !== 0) {
                  errors.push(cat + ': carries a card reward and costs ' + costOf(c) +
                    ' Cinder — a card cannot be refunded, so it never sits on a row that charges (R11.3)');
                }
                /* R11.6 — a card is already the largest thing this feature can
                   hand over. Stacking the top Cinder band on top of it makes one
                   row of one entry worth more than an hour of the loop. */
                if (r.cinder === 'large') {
                  errors.push(cat + ': carries a card reward and the "large" Cinder band — small or mid or nothing (R11.6)');
                }
                /* The refusal case needs no rule of its own: R3 already errors
                   on any reward at all on an always:true row, so a card on a
                   refusal is unwritable twice over. Stated here so the rule
                   reads whole rather than looking like an omission. */
              }
            }
            if (r.cinder == null && r.card == null) errors.push(cat + '.reward: pays nothing — use null instead');

            /* ── R15. NO SINGLE ROW IS WORTH MORE THAN A GOOD OUTCOME.
               R7 bounds how MANY rows pay, because the BRIEF's vending machine
               is a rate. Nothing bounded how much any ONE row was worth, and
               that gap is not theoretical: the round-3 critic closed it by
               writing `{ chance: 1, cinder: 'large' }` onto a free row — nine
               hundred Cinder, at certainty, on a row that also tied the best
               standing in its entry — and every rule in this file passed it
               green. R1 could not see it because R1's tie clause only looks at
               PAID rows; R4 could not, because the sibling it beat had disjoint
               poles; R7 could not, because one more paying row barely moves a
               corpus ratio.
               The ceiling is the MID band, expressed as a band and not as a
               number so cinderBand stays the single tuning table. The reasoning
               is the band's own meaning: mid is what this feature calls a good
               outcome, so a row whose EXPECTATION reaches it is a row paying a
               good outcome every time it is taken, which is the vending machine
               restated per-row. The corpus's largest is 270 (`study_it`, the
               large band at 0.3), so there is real headroom and this is a
               ceiling rather than a fitted bound — but it is not inert, and the
               fixture above is the proof: it fires at 900. */
            const evCeiling = DILEMMA_ECON.cinderBand[MAX_CHOICE_EV_BAND];
            if (Number.isFinite(evCeiling) && evOf(c) > evCeiling) {
              errors.push(cat + ': expected payout ' + evOf(c).toFixed(0) +
                ' Cinder is above the "' + MAX_CHOICE_EV_BAND + '" band (' + evCeiling +
                ') — one row may not be worth a good outcome every time it is taken (R15)');
            }
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
          /* 🔴 R1's SECOND HALF, AND IT IS INERT TODAY ON PURPOSE. R1 permits a
             paid row to TIE the best free one, which is correct — money may buy
             the same standing at a price. But nothing stopped that same row from
             also carrying the largest expected payout in its entry, and a row
             that ties on standing and beats everything on money is strictly
             correct while passing R1, R2, R4, R5 and R7. No entry does this
             (every paid row here carries reward: null, so the term is zero), and
             that is exactly when to write the rule: the stated point of R1-R9
             was to make round one's failure UNWRITABLE, and this variant of it
             was still writable. R4 does not reach it because R4 needs a pole
             subset and two rows with disjoint poles are never comparable there. */
          if (evOf(c) > maxFreeEv && c.influence >= maxFree) {
            errors.push(cat + ': paid choice ties the best free standing (' + maxFree +
              ') and out-pays every free choice (' + evOf(c).toFixed(0) + ' against ' + maxFreeEv.toFixed(0) +
              ') — paying would be strictly correct in this entry (R1)');
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

      /* ── THE TOP ROW OF THIS ENTRY, which is the row a player who reads only
         the standing tags will take. render.js prints "+N standing" on every
         positive row BEFORE the player has read a word of the fiction, so the
         set below is not a curiosity — it is the play-line, and the corpus is
         balanced over it or it is not balanced at all.
         Refusals are excluded: R3 forces them negative, so a refusal can never
         be a standing maximum and counting one would only ever be a bug that
         made the numbers look better than they are. */
      const acts = cs.filter(c => c && typeof c === 'object' && c.always !== true && Number.isInteger(c.influence));
      if (acts.length) {
        let mx = acts[0].influence;
        for (let i = 1; i < acts.length; i++) if (acts[i].influence > mx) mx = acts[i].influence;
        const top = acts.filter(c => c.influence === mx);
        top.forEach(c => {
          if (!Array.isArray(c.poles)) return;
          new Set(c.poles).forEach(p => { if (POLE_IDS.indexOf(p) >= 0) topPoleCount[p]++; });
        });
        if (anyActionLoss) lossyActionEntries++;
        if (top.length === 1) {
          uniqueTopEntries++;
          /* 🔴 R1's THIRD CLAUSE — THE LONE TOP ROW THAT ALSO OUT-PAYS.
             R1's second clause asks "does paying buy the standing?" and is
             gated on isPaid, and the round-3 critic was right that the same
             SHAPE is legal on a free row. It is not the same DEFECT, and the
             difference is worth stating because the corpus deliberately ships
             two of them. A free row that TIES the top and out-pays is answered
             by the row it ties with: R14's disjointness clause below forces the
             two to reach different companions, so the player is trading bond
             for money and that is a call. `take_the_licence` against
             `write_the_rule` is the corpus's best fork and it is exactly this
             shape; forcing them to tie on the payout tag as well would delete
             the entry rather than fix it.
             A LONE top row has no such answer. Nothing ties it, so there is no
             bond trade; it is free, so there is no price; and if it also pays
             more than every sibling then both numbers render prints point the
             same way and the fiction is decoration. That is dominance with no
             counterweight at all, and R4 misses it for the reason R4 always
             misses these: the rows it beats have disjoint poles.
             This fired on exactly one shipped row when it was written —
             `watch_it` in eh_specimen_walks, the best standing in its entry and
             the only payout in it — and that entry was rewritten rather than
             the rule weakened. See `call_ops`. The payout comparison is
             `paysMoreThan`, the row-visible one, not evOf: `watch_it` pays no
             Cinder at all and an evOf-only test would have shrugged at it. */
          const t = top[0];
          if (t.reward != null && cs.every(s => s === t || paysMoreThan(t, s))) {
            errors.push(at + ': "' + t.id + '" is the only choice at the top standing (' + mx +
              ') and out-pays every other row — nothing ties it, it costs nothing, so both numbers on screen point at it (R1)');
          }
        } else {
          /* ── R14, second half. A tie at the top is only a choice if the two
             rows please DIFFERENT units. Two rows that share a pole tie on the
             number and then reach the same companions for bond, which is a
             coin flip wearing a dilemma's clothes. Both sets must be non-empty:
             two pole-less rows are trivially disjoint and please nobody, which
             is the degenerate case this clause exists to refuse. */
          let disjoint = false;
          for (let i = 0; i < top.length && !disjoint; i++) {
            for (let j = i + 1; j < top.length && !disjoint; j++) {
              const A = Array.isArray(top[i].poles) ? top[i].poles : [];
              const B = Array.isArray(top[j].poles) ? top[j].poles : [];
              if (A.length && B.length && !A.some(p => B.indexOf(p) >= 0)) disjoint = true;
            }
          }
          if (!disjoint) {
            errors.push(at + ': ' + top.length + ' choices tie for the highest standing (' + mx +
              ') and no two of them have disjoint poles — ' + top.map(c => c.id + ' [' + (c.poles || []).join(',') + ']').join(', ') +
              ' — a tie between rows that please the same units is not a choice (R14)');
          }
        }
      }

      /* A dilemma no companion can have an opinion about is a menu. It ships
         fine and it is the failure mode this corpus exists to avoid, so it warns
         loudly.
         🔴 THE `!anyLoss` WARNING THAT USED TO SIT HERE IS DELETED, NOT MOVED.
         Its own comment conceded it could no longer fire — R3 forces every
         refusal negative, so "some choice loses standing" was true for every
         entry that could legally exist. A permanently silent guard is a false
         comment wearing a validator's clothes, and it cost this corpus the thing
         it was nominally watching: round two shipped thirteen of twenty entries
         in which only the refusal cost anything, a nineteen-per-cent-to-sixty-
         five-per-cent regression that no rule saw. R13 below is the live version
         of the question, as an error, over ACTIONS. */
      if (!anyPoles) warnings.push(at + ': no choice declares a pole — no unit in any deck can react to this');
    });

    /* 🚫 R7 — THE VENDING-MACHINE GUARD, and it is an ERROR rather than a
       warning. The BRIEF says "a dilemma that always pays is a vending
       machine", and the admin has already acted on that instinct once in this
       codebase: `GEM_REWARDS` in index.html zeroes every match Cinder reward with the
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
       valor regex (index.html) is one of the broadest in the shipped
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

    /* ══ R10. AXIS BALANCE OVER THE ROWS A PLAYER ACTUALLY TAKES ══════════
       🔴 R6 IS CORRECT AND R6 MISSED THIS, WHICH IS THE WHOLE REASON R10
       EXISTS. R6 counts pole occurrences over ALL choices, and by that measure
       the round-two corpus was near perfect — mercy thirteen against ruthless
       seventeen, every opposed pair inside one point four to one. And over the
       twenty rows that were the per-dilemma standing MAXIMUM, the same corpus
       measured mercy twelve, valor seven, honor seven, guile four, temperance
       four — and ruthless ZERO, ambition ZERO, caution ZERO. The cold poles
       were all present; they were parked on rows nobody takes.

       That is not a cosmetic difference. `render.js` tags every positive row
       with "+N standing" before the player has read a line of fiction, so the
       standing maximum is legible without the entry being read at all, and a
       player optimising for standing plays one pole every single time.
       `LQ_ARCHETYPE_POLE` (index.html) routes every berserker, raider,
       reaver, alien, swarm and vampiric class to `ruthless` and every mage,
       summoner, warlock, archon and necro class to `ambition`, so two of the
       broadest archetype buckets in the shipped table could not earn one point
       of bond from this feature played the obvious way: zero support hits and
       twelve against hits over a single pass of the corpus. That is round one's
       systematic archetype bond drain, on the owner's headline mechanic,
       surviving its own fix at one remove and invisible to the rule written to
       prevent it.

       So the population is the thing that had to change, not the threshold.
       R10 runs the same arithmetic as R6 over top(D) instead of over every
       choice, and the two together say: the corpus is balanced, AND the
       play-line through it is balanced. The pair ratio is looser than R6's —
       two to one rather than three to two — because top(D) is a much smaller
       sample and a tighter bound on it would force content decisions for
       arithmetic reasons rather than fictional ones. The FLOOR is the half that
       matters: a pole that never tops a single dilemma is a pole an optimising
       player never once supports.

       ⚠ THE SENTENCE ABOVE USED TO CARRY ITS OWN MEASUREMENT AND THE
       MEASUREMENT WAS WRONG. It said "only about twenty-five pole slots up here
       against a hundred and thirty below". Counted: top(D) carries 46 pole
       slots and all 97 choices carry 128 — 36%, not 19%. The number was
       load-bearing, because it is the entire argument for loosening the ratio
       from R6's 1.5 to 2.0 and this corpus measures 1.75 on three of its four
       axes; at 1.5 it would fail. So the rule passes because of a loosening
       whose stated reason was wrong by most of its own size. The loosening is
       kept and the reason is now the plain one — a 46-slot sample moves by whole
       ratio points when one row changes rank — but the false figure is recorded
       here rather than quietly corrected, because a comment that argues from a
       number nobody re-derived is the exact defect class this file's §7 exists
       to end, and it happened here.

       ⚠ AND R10 MEASURES THE AUTHORED CORPUS, NOT THE SCREEN. top(D) is the
       maximum over every row an entry AUTHORS. `rollChoices` in engine.js
       samples a subset of them per opening, so the set a player is shown is a
       sample of this one and its pole balance is a sample of these numbers, not
       these numbers. That is the same class of gap as R6's — a rule measuring
       one population while the player lives in another — one level up, and it
       is not closed here: closing it would mean duplicating the sampler in this
       file, and two copies of a weighted sampler is a worse bug than a stated
       limitation. The floor clause is the part that survives sampling intact:
       a pole that tops nothing can never be sampled into a top row. */
    const topPoleTotal = POLE_IDS.reduce((a, p) => a + topPoleCount[p], 0);
    if (topPoleTotal > 0) {
      POLE_IDS.forEach(p => {
        if (topPoleCount[p] < TOP_POLE_MIN) {
          errors.push('R10 top-row poles: "' + p + '" appears on ' + topPoleCount[p] + ' of the ' + topPoleTotal +
            ' pole slots on a per-dilemma standing maximum, needs at least ' + TOP_POLE_MIN +
            ' — a pole that never tops an entry is a pole a standing-maximising player never supports');
        }
      });
      POLE_PAIRS.forEach(pair => {
        const a = topPoleCount[pair[0]], b = topPoleCount[pair[1]];
        const hi = Math.max(a, b), lo = Math.min(a, b);
        if (!(hi <= TOP_AXIS_RATIO_MAX * lo)) {
          errors.push('R10 top-row axis balance: ' + pair[0] + ' ' + a + ' against ' + pair[1] + ' ' + b +
            ' over the per-dilemma standing maxima — the larger must be at most ' + TOP_AXIS_RATIO_MAX + ' times the smaller');
        }
      });
    }

    /* ── R13. ACTING HAS A PRICE. Round one: twenty-six of thirty-two entries
       contained an ACTION that cost standing. Round two: seven of twenty — a
       regression by a factor of three that arrived as a side effect of pushing
       refusals negative (R3) and paid rows down (R1, R2) while nothing pushed
       any action down. In thirteen of twenty entries the street rewarded any
       intervention at all, so "act, take the top free row" was unconditionally
       correct and the entry asked how much you wanted rather than what you would
       give up. Half the corpus is the floor, not the target. */
    if (DILEMMAS.length > 0 && !(lossyActionEntries >= MIN_COSTLY_ACTION_PCT * DILEMMAS.length)) {
      errors.push('R13 acting has a price: only ' + lossyActionEntries + ' of ' + DILEMMAS.length +
        ' dilemmas contain a non-refusal choice that costs standing, needs at least ' +
        Math.ceil(MIN_COSTLY_ACTION_PCT * DILEMMAS.length) +
        ' — a corpus where only walking away costs anything rewards intervening for its own sake');
    }

    /* ── R14. THE LARGEST NUMBER ON SCREEN IS NOT ALWAYS THE ANSWER. Round two
       shipped twenty of twenty entries whose standing maximum was a single free
       row, mean margin one point seven five over the second-best, and never the
       paid one — so a player reading only the green tags picked correctly in
       every entry without reading a line. Capping the share of lone maxima
       forces entries where the player is choosing WHICH units to please rather
       than reading a number, and the per-entry half of this rule (above) makes
       sure such a tie is a real fork and not two names for the same call.
       This is a CEILING, not a quota: an entry with one clearly best row is a
       legitimate shape and most of the corpus is still allowed to be one.

       ⚠ R14 BOUNDS THE STANDING TAG AND ONLY THE STANDING TAG. Say so here
       rather than let the next reader assume otherwise, because `choiceHtml`
       prints the cost, the payout and the standing on the same row and a tie on
       one of three tags is not a tie on screen. Measured on this corpus: 9 of
       20 entries have a lone standing maximum; 13 of 20 have a single best row
       once the payout tag counts too. Four authored ties separate on money —
       eh_ninth_street_main (`west_market` +48 against `east_clinic` nothing),
       eh_specimen_walks and eh_zombie_block (the tied row carries the card) and
       eh_ledge_market (`take_the_licence` +60 AND the card).
       FOLDING THE PAYOUT INTO THIS COUNT WAS WRITTEN AND REJECTED, and the
       honest reason is that it fails: 13 of 20 is 65% against a 60% cap, so
       adopting it means stripping the payout difference out of at least two of
       those four entries. Those differences are the best forks in the file —
       in eh_ledge_market the ruthless call is the one that pays and the
       honourable one is not, which IS the entry — and deleting a fork to make
       a rule pass is the rule failing the corpus, not the corpus failing the
       rule. R1's third clause takes the half of this concern that is a real
       defect (a LONE top row that also out-pays has no counterweight at all)
       and leaves the half that is a design decision, stated here with its
       number so the next reader argues with the number rather than rediscovering
       it.

       ⚠ AND LIKE R10, THIS IS MEASURED OVER THE AUTHORED CORPUS. `rollChoices`
       shows a player a sample of each entry's rows, so an authored tie can
       arrive on screen with only one of its two halves in it and the on-screen
       lone-maximum rate runs well above this ceiling. The rule still earns its
       place — an authored tie is the only way a sampled tie can ever happen —
       but it is a bound on what is WRITTEN, not on what is SEEN, and the same
       argument against duplicating the sampler here applies verbatim. */
    if (DILEMMAS.length > 0 && !(uniqueTopEntries <= MAX_UNIQUE_TOP_PCT * DILEMMAS.length)) {
      errors.push('R14 top row: ' + uniqueTopEntries + ' of ' + DILEMMAS.length +
        ' dilemmas have a single highest-standing ACTION as authored, above ' + MAX_UNIQUE_TOP_PCT +
        ' — at most ' + Math.floor(MAX_UNIQUE_TOP_PCT * DILEMMAS.length) + ' may be that shape (standing tag only)');
    }

    /* ══ R11. THE CARD REWARDS EXIST, AND THEIR ABSENCE IS AN ERROR ═════════
       🔴 THIS RULE IS HERE BECAUSE THE FEATURE SHIPPED WITHOUT THE THING THE
       OWNER ASKED FOR BY NAME. The BRIEF lists the rewards as "Cinder, cards,
       Influence". Round one authored eight card rewards; round two's trim from
       thirty-two entries to twenty dropped every one of them without anybody
       noticing, because nothing counted them. Across eighty-one driven
       resolutions `Profile.cardCollection` never changed once, and every
       downstream path went dead against shipped content: rollReward's card
       branch, grant()'s first leg and its entire no-rollback argument, the a/an
       rarity article, and the whole `grantCard` bridge accessor.

       R11.1 is the clause that makes that unrepeatable: a future trim that drops
       the last card reward turns this function red — but only in the company of
       R11.10, which is the clause round three left out. R11.1 counts card
       rewards. It does not ask whether one can arrive. On a corpus with all five
       outer `reward.chance` values set to zero — one character each — R11.1
       counted five, R11.2 counted five dilemmas, R11.5 through R11.8 were all
       satisfied, this function returned green, and a million driven rolls
       produced no card and no offer of one. A rule that counts a reward without
       checking that the reward can land certifies dead content, which is the
       failure it was written to end, wearing the validator's own colours.

       🔴 AND THE SECOND HALF OF ROUND THREE'S FIX WAS WORSE THAN THE GAP.
       R11.9 required a vowel-initial rarity so `describeChoice`'s article branch
       would be reachable from shipped content. It made a dead branch live by
       making it say something untrue: the shipped pool cannot mint above Common,
       so "an Epic card (12%)" was printed on the row before the pick and a
       Common was handed over after it, 56% of grants over a driven pass. R11.9
       is retired — see the note where it used to fire — and R11.5 now says the
       honest thing instead. Keeping a downstream branch warm is not a reason to
       author a promise the game cannot keep.

       And a card is not a loot drop here. LORE.md: "A card isn't just a
       collectible; it can represent power." Ouroboros is the company behind the
       technology and the card is part of the connection that puts an entity on
       the ground. So a card reward is authored onto a choice that plausibly puts
       a hand into the ruins or into somebody's stock — a block gone into, a door
       walked through, a stall impounded, a stair opened for the first time since
       the water. Never a civic bonus and never a thank-you. */
    if (cardRewardChoices < CARD_REWARDS_MIN || cardRewardChoices > CARD_REWARDS_MAX) {
      errors.push('R11.1 card rewards: the corpus carries ' + cardRewardChoices +
        ' card rewards — the owner asked for cards by name; ' + CARD_REWARDS_MIN + ' to ' + CARD_REWARDS_MAX + ' is the band (R11)');
    }
    const cardDilemmaN = Object.keys(cardRewardDilemmas).length;
    if (cardDilemmaN < CARD_DILEMMAS_MIN) {
      errors.push('R11.2 card spread: ' + cardRewardChoices + ' card rewards sit in only ' + cardDilemmaN +
        ' dilemmas, needs at least ' + CARD_DILEMMAS_MIN + ' — a card the player meets only in one entry is not in the loop');
    }
    if (cardRewardChoices > 0) {
      /* R11.7 and R11.8 are a coverage pair, not a balance one: the two are
         DIFFERENT code paths inside `grantCard`. A null rarity takes the
         DEFAULT_PACK_RARITY_WEIGHTS roll and the any-lootable fallback under it;
         a named rarity takes the byRarity filter. Shipping only one kind leaves
         half of an irreversible accessor unexercised. */
      if (cardRarityNull < 1) {
        errors.push('R11.7 card rarity: no card reward requests rarity null — grantCard\'s weighted roll and its any-card fallback are unreachable from shipped content (R11)');
      }
      if (cardRarityNamed < 1) {
        errors.push('R11.8 card rarity: no card reward names a rarity — grantCard\'s byRarity branch is unreachable from shipped content (R11)');
      }
      /* 🔴 R11.9 IS RETIRED. THE NUMBER IS NOT REUSED AND THE CLAUSE IS NOT
         REPLACED, BECAUSE IT SHOULD NEVER HAVE EXISTED.
         It read: "at least one card reward uses a vowel-initial rarity
         (uncommon or epic)", and its stated purpose was to keep the a/an
         article branch in `describeChoice` exercised by shipped content instead
         of merely defended against content that did not exist. It worked. Three
         rows named uncommon, rare and epic, the article branch went live, and
         the modal began telling players about Epic and Rare cards the game
         cannot mint — 75 built-in poolable cards, zero `rarity:` fields between
         them, every request above common falling through `grantCard`'s weighted
         roll into a Common. The measurement is in CARD_RARITY_IDS above.
         So the rule bought downstream coverage with a line the game could not
         honour, and it did it in a validator whose entire job is to make
         dishonest content unwritable. There is no honest version of it: the
         only band the shipped pool can fill is `common`, which begins with a
         consonant, so any rule demanding a vowel-initial REQUEST is a rule
         demanding a false one. R11.5 now carries the true form of the same
         concern — no row may name a band the pool cannot fill — and the article
         branch is left as what it actually is: defensive code, correct for the
         delivered rarity `grant()` reports in its aftermath line, and for
         whatever a future pool holds.
         The gap in the numbering is deliberate and stays. There is no R12
         either, for the different and duller reason recorded in the inventory
         at the top of this file. */
    }

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
       the camp expedition log (`CAMP_LOOT_FLAVOR`, index.html), which runs at a
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

      /* ── V11 AND V12. THE METRONOME.
         🔴 THIS IS THE ONE VOICE PROBLEM THE FIRST THREE ROUNDS COULD NOT SEE,
         BECAUSE EVERY RULE ABOVE MEASURES A LINE AND THE DEFECT IS IN THE GAP
         BETWEEN LINES. Every V1-V10 bound passed while the corpus settled into
         a single tune: 72 of 97 outcomes were exactly two sentences with the
         sting in the second, and 45 of them opened on the word "The". Read one
         line and it is good. Read nine in a row — which is what a player does
         over an evening — and the ninth is audible before it is read, and a
         voice you can predict stops sounding like a person.
         An earlier round measured this, deferred it as a whole-file rewrite,
         and bound only the lines it happened to touch. That is why the two
         numbers barely moved across two rounds. They are now bounds, because
         the deferral is the thing that let the tune survive being noticed
         twice.
         Both are CEILINGS on a share, not bans on a shape. Two sentences with a
         sting in the second is the best shape this corpus has and roughly half
         the file is still allowed to be it; the article opener is the natural
         English sentence and one line in seven may start that way. What is
         forbidden is the DEFAULT — reaching for the same bar every time because
         it is the bar that worked last time.
         Measured after the rewrite that motivated them: 0 of 97 opening on an
         article, 45 of 97 at exactly two sentences, against 48 and 72 before.
         The reference file does not have this problem for a dull reason worth
         copying: its lines were written by different hands on different days. */
      const articleN = outcomes.filter(o => ARTICLE_OPEN_RE.test(stripGlyph(o.s))).length;
      if (!(articleN <= ARTICLE_OPEN_MAX_RATIO * oN)) {
        errors.push('V11 metronome: ' + articleN + ' of ' + oN + ' outcomes open on "the", "a" or "an", max ' +
          Math.floor(ARTICLE_OPEN_MAX_RATIO * oN) + ' — start on the thing that happened, not on the noun it happened to');
      }
      const twoSentN = outcomes.filter(o => sentenceCount(o.s) === 2).length;
      if (!(twoSentN <= TWO_SENTENCE_MAX_RATIO * oN)) {
        errors.push('V12 metronome: ' + twoSentN + ' of ' + oN + ' outcomes are exactly two sentences, max ' +
          Math.floor(TWO_SENTENCE_MAX_RATIO * oN) + ' — the corpus has one beat and a reader hears it by the ninth line');
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

/* Local mirror of LQ_POLE_AXIS (index.html), same reasoning as
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
