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
   `index.html:80478-80480` states it for CORP_LAWS ("the render code reads it,
   the scorer reads it, the mood pressure reads it… one table, no literals
   downstream"). engine.js, rewards.js, render.js and index.js must not carry a
   reward, cost, bond, cooldown, count or clamp literal of their own.

   🔴 `_opEcon()` ITSELF IS NOT USED AND MUST NOT BE — do not "fix" this.
   CLAUDE.md says all *operation* pricing goes through `_opEcon()`, and that is
   scoped to the word operation: `_opEcon(t)` is `OPS_ECON[t] || null` over the
   sixteen business-operation keys (`index.html:80021-80039`). It returns null
   for anything else, and adding a `dilemma` key would put a non-business into
   the Just Business catalog — that catalog is built from `Object.keys(OPS_ECON)`
   (`index.html:79986-79989`), so a fake op would appear as a BUYABLE BUSINESS
   in the shop. Not a risk; a certainty. The rule's spirit is honoured by the
   one-table discipline above, which is what CORP_LAWS does.

   ════════════════════════════════════════════════════════════════════════════
   VOICE — the eight rules, taken from the camp expedition log
   (`index.html:65863-66083`) and the Situation Board (`index.html:215986+`).
   `validateCorpus()` mechanically enforces rules 5, 6 and 8 so they cannot rot.

     1. Two clauses, rarely three. Eight to fourteen words is the beat.
     2. Simple past for what happened; present for what it now means.
        "They went in with hooks and lamps and came back with fewer than they
        took. The fence is further out. So is the grief."
     3. Third person about people (they/their). Second person about the player,
        used sparingly and only where it lands: "You did not build this pipe."
     4. The spaced em dash is the workhorse that hangs the consequence off the
        event — never a double hyphen, never a parenthesis doing that job.
     5. One leading emoji per outcome line. Never two. Never zero.
     6. Understatement. No exclamation marks anywhere in this file.
     7. Truncated fragments are correct and frequent. "Gone." "Halted."
     8. NEVER NAME THE NUMBER WHEN A PERSON WILL DO. LORE.md: "'Unemployment
        increased' is a number. 'I lost my job today' is a person." So no
        digits appear in any player-facing string here — the Cinder figure, the
        standing figure and the bond figure are all rendered from DILEMMA_ECON
        by `rewards.describeChoice()`. Retuning the table retunes the copy, and
        the copy can never drift from the constant.
        ⚠ That drift is a LIVE BUG in a reference file, not a hypothetical:
        `house.camp.js:151-153` promises the player "No rest-quality modifier
        here" while `house.camp.js:88` runs at `CAMP_REST_QUALITY = 0.75`.

   ════════════════════════════════════════════════════════════════════════════
   WHAT MAKES A DILEMMA A DILEMMA — the authoring rule that matters most.
   Every choice must be a call somebody sane would defend, and every choice must
   cost something. If one option is the obvious answer the entry is scenery, and
   `validateCorpus()` warns when a dilemma has nothing to lose on any branch.
   The refusal — the `always: true` row that is offered every single time — is
   never free either. Doing nothing in Ethos Heights is a decision the street
   watches you make.

   A CHOICE DOES NOT NAME UNITS, IT NAMES POLES. It cannot name units: the
   player's deck is unknown when this file is written and is frequently full of
   Forge cards that did not exist yet. So a choice declares the value poles it
   EMBODIES, from the shipped eight (`LQ_POLE_AXIS`, `index.html:72975`), and
   engine.js derives each companion's stance — support, middle, against — from
   the unit's own `valueProfile`. Opposition is derived from the AXIS, never
   authored: writing `oppose: ['mercy']` on a choice that also embodies mercy
   produces an incoherent entry no cheap validator could catch, and deriving it
   makes that entry unwritable. It is `_lqPoleVerdict` (`index.html:73224`)
   turned inside out — and that function's `null` return is this codebase's own
   name for the Middle stance.

   ⚠ A UNIT WITH NO POLES IS THE COMMON CASE, NOT AN EDGE CASE. A Forge card
   with a name, an icon and stats resolves to `[]` and is Middle on everything.
   Authoring to the poles is therefore how a dilemma earns any reaction at all,
   which is why `poles: []` here means "procedural, nobody has an opinion" and
   is used deliberately — mostly on the ward-office option, where the whole
   point is that passing the file along is not a moral act to anyone.
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
     `sql/034_wallet_credit_bounds.sql` records the measured live distribution of
     this game's Cinder faucets: `addGems max 250,000, MEDIAN 2, over 65k rows`.
     A four-figure dilemma payout would sit in the tail of every audit query the
     project has, and `sql/AUDIT_farmed_cinder.sql` states the thing that makes
     that unfixable after the fact: "a farmed Cinder and an earned Cinder are the
     same integer in the same column. There is no 'exploit' flag to filter on."
     120 / 400 / 900, behind a per-choice `chance` gate, behind a forty-five
     minute offer cooldown, is a faucet an audit can ignore.
     It is also the lore: LORE.md says Cinder "isn't supposed to simply appear
     because somebody completed an arbitrary videogame task", and the admin has
     already switched a faucet off once for exactly that reason —
     `GEM_REWARDS = { perBattle: 0, winBonus: 0, … }` at `index.html:64415-64427`,
     with the note "it will devalue our money". */
  cinderBand:       Object.freeze({ small: 120, mid: 400, large: 900 }),
  rewardFloorMult:  0.6,             // multiplier at influence 0
  rewardSpanMult:   0.8,             // + this * (influence/100)  ⇒ 1.0 at 50, 1.4 at 100
  maxPayingRatio:   0.5,             // corpus guard, see validateCorpus
});

/* 🪙 WHY COSTS ARE PER-CHOICE LITERALS WHILE REWARDS ARE BANDED, which looks
   inconsistent until you ask what each one is for. A REWARD is a faucet: it
   mints Cinder into a shared economy, so it must be bounded by one table an
   auditor can read in one place — hence `cinderBand` plus the influence
   multiplier, and nothing else. A COST is dramaturgy: it is sized to the
   specific ask in the fiction, and "pay the wages of every crew on Foundry Row"
   is honestly not the same number as "pay the grocer for a stolen loaf". Three
   bands would flatten exactly the distinction the dilemma is about. Costs also
   only ever REMOVE Cinder through `spendGems()`, which refuses rather than
   going negative, so a mis-tuned cost cannot inflate anything. */

/* ────────────────────────────────────────────────────────────────────────────
   INFLUENCE_RANKS — standing with ONE city, given a name a player can say.
   Modelled on RESERVE_RANKS (`index.html:56227-56240`): ascending, `min: 0` on
   the first row so a lookup can never miss and never returns null.
   ⚠ This ladder is DISPLAY. It is not one of Influence's three consumers (the
   gate band, the reward multiplier and the choice-count floor are). It is
   listed here so nobody counts it toward the two the BRIEF requires.
   Colours are `:root` tokens (`index.html:94-129`) by value, not new hexes:
   --ink-dim, --azure, --emerald, --gold, --gold-bright, --violet.
   ──────────────────────────────────────────────────────────────────────────── */
export const INFLUENCE_RANKS = deepFreeze([
  { min: 0,  name: 'Unknown Face',          icon: '👤', color: '#a89888' },
  { min: 20, name: 'Known on the Block',    icon: '🚪', color: '#4a8fd4' },
  { min: 40, name: 'Vouched For',           icon: '🤝', color: '#3aa86b' },
  { min: 60, name: 'Named in the Broadcast', icon: '📡', color: '#d4af37' },
  { min: 80, name: 'Called to the Table',   icon: '🏛', color: '#f5d76e' },
  { min: 95, name: 'The Heights Answers',   icon: '🗝', color: '#8b5cf6' },
]);

/* ────────────────────────────────────────────────────────────────────────────
   THE CORPUS.
   Twenty-six entries. Twelve is the floor at which the five-deep `recent` block
   plus the seventy-two hour repeat cooldown stops starving the pool on a normal
   session; more than doubling it means a player can go a long week without
   meeting the same street twice.

   Districts are places inside Ethos Heights, and they are consistent: the same
   name means the same street across entries (Foundry Row is always the furnaces
   and the crews; the Kessler Line is always the river side; Harrow Yards is
   always where the labs went in). Nothing here contradicts LORE.md, and nothing
   invents a faction it does not name.

   `minInfluence` / `maxInfluence` are Influence's first consumer, and the shape
   is not invented — it is `needMorale` on `RECON_EVENTS` (`index.html:216014`,
   filtered at `216133`) generalised to a band. Low standing means the Heights
   stops bringing you the decisions that matter. High standing means nobody asks
   you about a shop sign any more, which is its own quiet loss.
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
    brief: 'The old main under Ninth Street holds pressure for one side of the block or the other, never both. East is the clinic and the school. West is the market that pays the crews who keep the pipe alive at all. The valve is manual, and everyone on that street knows your face.',
    choices: [
      {
        id: 'east_clinic', always: false, weight: 1,
        label: 'Turn the pressure east, to the clinic',
        desc: 'The market runs dry and the traders remember who dried it.',
        poles: ['mercy'], influence: 3,
        cost: null, reward: null,
        outcome: '🚰 The clinic taps ran clear by dusk. The market shuttered early and said nothing to you.',
      },
      {
        id: 'west_market', always: false, weight: 1,
        label: 'Turn the pressure west, to the market',
        desc: 'Trade keeps the crews paid; the clinic carries water by hand.',
        poles: ['ambition'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🪙 The stalls opened on time and the crews got paid. The clinic carried buckets up the stairs all night.',
      },
      {
        id: 'split_valve', always: false, weight: 1.5,
        label: 'Split the valve and halve both',
        desc: 'Nobody gets enough and nobody gets nothing.',
        poles: ['temperance', 'caution'], influence: -1,
        cost: null, reward: null,
        outcome: '🚰 Both sides ran thin. Both sides complained. Neither side lost anybody.',
      },
      {
        id: 'cut_bypass', always: false, weight: 1,
        label: 'Pay a crew to cut a bypass tonight',
        desc: 'Your own Cinder buys a second line before dawn.',
        poles: ['honor', 'valor'], influence: 6,
        cost: { cinder: 600 }, reward: null,
        outcome: '🔧 They welded through the dark and both taps ran by morning. The bill was yours alone.',
      },
      {
        id: 'ask_survey', always: false, weight: 1,
        label: 'Ask the Foundation to survey the main',
        desc: 'They will find the fault and file it somewhere.',
        poles: ['honor', 'caution'], influence: 1,
        cost: null, reward: null,
        outcome: '🏛 A survey team walked the line and left a report nobody in the ward can read. The valve is still manual.',
      },
      {
        id: 'leave_valve', always: true, weight: 0.5,
        label: 'Leave the valve where it is',
        desc: 'You did not build this pipe and you do not owe it.',
        poles: ['caution'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 The valve stayed where the last person left it. By morning the street had stopped asking you.',
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
    brief: 'The reclaimed substation carries less than the district pulls. The Terrace has heat, light and a working lift for people who cannot manage the stairs. Foundry Row has the arc furnaces that pay half the wards. Load comes off somewhere tonight, or the transformer decides for you.',
    choices: [
      {
        id: 'shed_row', always: false, weight: 1,
        label: 'Shed the Row and keep the homes lit',
        desc: 'The furnaces go cold and the shift is sent home unpaid.',
        poles: ['mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '⚡ The lifts kept running. The Row stood in the dark and worked out what a cold shutdown costs.',
      },
      {
        id: 'shed_homes', always: false, weight: 1,
        label: 'Shed the Terrace and keep the furnaces hot',
        desc: 'Quota is met and the stairwells go dark for a week.',
        poles: ['ruthless', 'ambition'], influence: -3,
        cost: null, reward: { chance: 0.45, cinder: 'mid', card: null },
        outcome: '⚡ The Row made quota. On the Terrace they carried lamps and water up the stairs for days.',
      },
      {
        id: 'rolling', always: false, weight: 1.5,
        label: 'Rotate the outage across every block',
        desc: 'Everyone loses a share of the evening, nobody loses the night.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '⚡ Everyone lost an hour and nobody lost a night. The complaints were even, which is its own kind of fair.',
      },
      {
        id: 'standby_fuel', always: false, weight: 1,
        label: 'Buy fuel and bring up the standby plant',
        desc: 'It runs badly, it runs loud, and it runs.',
        poles: ['honor'], influence: 5,
        cost: { cinder: 900 }, reward: null,
        outcome: '🔧 The standby came up smoking and held. You paid for the fuel and the district paid you nothing.',
      },
      {
        id: 'kill_the_floodlights', always: false, weight: 1,
        label: 'Cut the wall floodlights and carry both',
        desc: 'Homes lit, furnaces hot, and the perimeter dark.',
        poles: ['valor', 'ambition'], influence: -2,
        cost: null, reward: null,
        outcome: '🌘 Homes lit, furnaces hot, and the wall walked its rounds on hand lamps. Nothing came that night.',
      },
      {
        id: 'let_it_trip', always: true, weight: 0.5,
        label: 'Let the transformer decide',
        desc: 'You refuse to be the one who chooses a dark block.',
        poles: ['caution'], influence: -5,
        cost: null, reward: null,
        outcome: '🌫 It tripped at dusk and took the whole grid with it. Nobody blamed you out loud.',
      },
    ],
  },

  {
    id: 'eh_tenement_nine',
    title: 'Tenement Nine',
    district: 'Northgate Wards',
    icon: '🏢',
    sev: 'quiet',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Tenement Nine was cleared, patched and listed for the families on the waiting register. Squatters lived in it while it was still a ruin and they are living in it now. Both groups have paperwork. Only one group has furniture.',
    choices: [
      {
        id: 'honour_register', always: false, weight: 1,
        label: 'Honour the register and move the families in',
        desc: 'The list is the only thing standing between here and nothing.',
        poles: ['honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🏢 The register held. It rained on the people carrying their beds back out to the yard.',
      },
      {
        id: 'keep_squatters', always: false, weight: 1,
        label: 'Let the ones already inside stay',
        desc: 'They mended the roof nobody else would climb.',
        poles: ['mercy'], influence: -2,
        cost: null, reward: null,
        outcome: '🏢 They stayed. The families on the register learned that a list is worth whoever enforces it.',
      },
      {
        id: 'split_floors', always: false, weight: 1.5,
        label: 'Split the floors between them',
        desc: 'One stairwell, two doors, and a long winter.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '🏢 Two doors, one stairwell, one bad winter. They have not come to blows, which counts.',
      },
      {
        id: 'open_next_door', always: false, weight: 1,
        label: 'Pay to open the building next door',
        desc: 'Both lists clear and your account does not.',
        poles: ['ambition', 'mercy'], influence: 7,
        cost: { cinder: 1400 }, reward: null,
        outcome: '🔧 Crews had the neighbouring block habitable by the end of the week. Both lists cleared. Yours did not.',
      },
      {
        id: 'draw_lots', always: false, weight: 1,
        label: 'Draw lots in front of both groups',
        desc: 'A hat, the names, and everybody watching.',
        poles: ['temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🏢 Names came out of a hat in the yard in front of everyone. The losers packed without arguing, which nobody expected.',
      },
      {
        id: 'ward_office', always: true, weight: 0.5,
        label: 'Hand the file to the ward office',
        desc: 'Somebody else signs it and somebody else is blamed.',
        poles: [], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The ward office took the file. It is on a desk somewhere, and everyone knows whose desk.',
      },
    ],
  },

  {
    id: 'eh_wage_slip',
    title: 'The Row Has Not Been Paid',
    district: 'Foundry Row',
    icon: '🪙',
    sev: 'pressing',
    weight: 11,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… no pay run logged this cycle … repeat, no pay run … kkzzt…',
    brief: 'The crews that reopened the Row have worked a full cycle on a promise. The Cinder that should have covered them went into rail plate, because without rail nothing leaves this district at all. They are not angry yet. They are waiting to hear what you say.',
    choices: [
      {
        id: 'cover_wages', always: false, weight: 1.5,
        label: 'Cover the wages out of your own pocket',
        desc: 'Every name on the sheet gets paid and everyone learns from where.',
        poles: ['honor'], influence: 9,
        cost: { cinder: 1800 }, reward: null,
        outcome: '🪙 Every name on the sheet got paid. They know exactly where it came from, and so does the Row.',
      },
      {
        id: 'pay_half', always: false, weight: 1,
        label: 'Pay half now and pledge the rest',
        desc: 'Half a wage buys half a week of patience.',
        poles: ['guile'], influence: -1,
        cost: { cinder: 700 }, reward: null,
        outcome: '🪙 Half a wage bought half a week of quiet. The tally against your name is written down somewhere.',
      },
      {
        id: 'rail_first', always: false, weight: 1,
        label: 'Finish the rail and pay when it earns',
        desc: 'The plate goes down first and the crews wait for the freight.',
        poles: ['ambition', 'caution'], influence: -2,
        cost: null, reward: { chance: 0.35, cinder: 'mid', card: null },
        outcome: '🚆 The plate went down and the first freight left loaded. The crews watched it go unpaid.',
      },
      {
        id: 'pay_in_cards', always: false, weight: 1,
        label: 'Pay them in cards out of your own stock',
        desc: 'Not money, but it is worth something in the ruins.',
        poles: ['guile', 'mercy'], influence: 2,
        cost: null, reward: null,
        outcome: '🃏 They took the cards. Some will sell by morning; one will keep hers and live longer for it.',
      },
      {
        id: 'tell_them_plainly', always: true, weight: 0.5,
        label: 'Tell them the truth and offer nothing',
        desc: 'No wage, no promise, no lie either.',
        poles: ['honor', 'temperance'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 You said it plainly and they heard it plainly. Half the crew did not come back the next day.',
      },
    ],
  },

  {
    id: 'eh_bread_line',
    title: 'The Convoy Came in Light',
    district: 'Old Battery Steps',
    icon: '🍞',
    sev: 'pressing',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… convoy manifest short against the book … kkzzt…',
    brief: 'There is enough on the Steps for the ration book or for the Warpath crews who came back through the road they keep open, and not for both. The queue forms before dawn. It knows exactly how long it is and it counts itself while it waits.',
    choices: [
      {
        id: 'ration_book', always: false, weight: 1,
        label: 'Honour the ration book',
        desc: 'The queue eats and the crews go back out on what they carry.',
        poles: ['honor', 'mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '🍞 Every book was stamped and the queue went home fed. The crews ate what they carried and said nothing.',
      },
      {
        id: 'feed_crews', always: false, weight: 1,
        label: 'Feed the crews first',
        desc: 'The road stays open or none of this matters.',
        poles: ['ruthless', 'caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🍞 The crews went back out strong. The queue was told to come tomorrow, and most of them did.',
      },
      {
        id: 'thin_both', always: false, weight: 1.5,
        label: 'Cut every share and feed everyone',
        desc: 'Nobody leaves full and nobody leaves empty.',
        poles: ['temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🍞 Nobody left full. Nobody left empty. The Steps have seen worse mornings and said so.',
      },
      {
        id: 'buy_shortfall', always: false, weight: 1,
        label: 'Buy the shortfall off the Arcade at market rate',
        desc: 'The traders know what you need and price it that way.',
        poles: ['mercy', 'ambition'], influence: 6,
        cost: { cinder: 700 }, reward: null,
        outcome: '🪙 The traders knew what you needed and charged for knowing. The queue never learned there was a shortfall.',
      },
      {
        id: 'ground_the_crews', always: false, weight: 1,
        label: 'Take the crews off the road for a week',
        desc: 'Nobody goes out and nobody eats short.',
        poles: ['mercy', 'caution'], influence: 0,
        cost: null, reward: null,
        outcome: '🍞 The road went unescorted for a week and everybody ate. The next convoy came in lighter still.',
      },
      {
        id: 'quartermaster', always: true, weight: 0.5,
        label: 'Leave it to the quartermaster',
        desc: 'He has split a short load before and taken the shouting for it.',
        poles: [], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 He split it the way he always splits it and took the shouting himself. He is used to it, which is not the same as it being fair.',
      },
    ],
  },

  /* ═══ CONTAINMENT — the things still in the basements ═══════════════════ */

  {
    id: 'eh_sublevel_four',
    title: 'The Seal Under the Shelf',
    district: 'Cathedral Shelf',
    icon: '🚪',
    sev: 'grave',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… sublevel four, seal intact, interior lamp still burning … kkzzt…',
    brief: 'Under the Cathedral Shelf there is a door with a Foundation seal on it and a light behind the glass that has been on since before the Collapse. The reclamation crew wants through it for the copper. The seal has held all this way. Whatever it was doing, it is still doing it.',
    choices: [
      {
        id: 'leave_sealed', always: false, weight: 1.5,
        label: 'Leave the seal and post a watch',
        desc: 'The copper stays where it is and so does everything else.',
        poles: ['caution', 'temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🚪 The door stayed shut. The light behind the glass has not changed, which is either good news or the only news.',
      },
      {
        id: 'cut_copper', always: false, weight: 1,
        label: 'Cut the door and take the copper',
        desc: 'The district needs wire more than it needs an unopened room.',
        poles: ['ambition', 'ruthless'], influence: -5,
        cost: null, reward: { chance: 0.5, cinder: 'mid', card: null },
        outcome: '🔦 They came up with the copper and a smell nobody could name. The corridor beyond has been quiet since. So far.',
      },
      {
        id: 'report_seal', always: false, weight: 1,
        label: 'Report the seal to the Foundation',
        desc: 'They will take it, and they will not tell you what it was.',
        poles: ['honor'], influence: 5,
        cost: null, reward: null,
        outcome: '🏛 A grey van came before dawn and left before the shift. The door is welded now and the crew was paid to forget it.',
      },
      {
        id: 'hire_ops', always: false, weight: 1,
        label: 'Hire H.I.S. OPS to open it properly',
        desc: 'Full kit, a written record, and a bill.',
        poles: ['ambition', 'caution'], influence: 4,
        cost: { cinder: 500 }, reward: { chance: 0.3, cinder: null, card: { chance: 1, rarity: null } },
        outcome: '🎯 They went down in kit and came back with a case and no answers. One of them kept looking at the stairs.',
      },
      {
        id: 'cut_a_viewport', always: false, weight: 1,
        label: 'Cut a viewport and look without opening',
        desc: 'A hole the size of a fist, and a lamp.',
        poles: ['guile', 'caution'], influence: 0,
        cost: null, reward: null,
        outcome: '🔦 They cut a viewport and put a lamp to it. What is in there is standing where it has always stood.',
      },
      {
        id: 'walk_and_say_nothing', always: true, weight: 0.5,
        label: 'Walk away and tell the crew nothing',
        desc: 'They will find another block to strip.',
        poles: ['guile'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The crew found another block to strip. Sublevel Four keeps its light on for nobody.',
      },
    ],
  },

  {
    id: 'eh_specimen_walks',
    title: 'It Has Been Moving the Furniture',
    district: 'Harrow Yards',
    icon: '🧫',
    sev: 'grave',
    weight: 8,
    minInfluence: 30,
    maxInfluence: 100,
    wire: '…kkzzt… cell status reads OPEN, occupant status reads OPEN … kkzzt…',
    brief: 'A basement lab under the Yards has power it should not have and a containment cell that opens from the inside. What was in it is not in it now, and it has not left the building. It has been rearranging the furniture, floor by floor, and the tenants above have started to notice.',
    choices: [
      {
        id: 'burn_block', always: false, weight: 1.5,
        label: 'Burn the building down to the slab',
        desc: 'It ends tonight and the families above lose the roof they just fixed.',
        poles: ['ruthless', 'caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🔥 It burned for a day and a night. Whatever was inside did not come out, and the families upstairs lost the roof they had just fixed.',
      },
      {
        id: 'brick_the_stair', always: false, weight: 1,
        label: 'Seal the stairwell and watch the door',
        desc: 'It stays down there and somebody stays up here.',
        poles: ['caution'], influence: 1,
        cost: null, reward: null,
        outcome: '🚪 The stair was bricked by evening. Something on the other side has been knocking politely ever since.',
      },
      {
        id: 'go_down', always: false, weight: 1.5,
        label: 'Go down and see what it is',
        desc: 'Nobody has actually looked at it yet.',
        poles: ['valor'], influence: 6,
        cost: null, reward: { chance: 0.4, cinder: null, card: { chance: 1, rarity: null } },
        outcome: '🔦 You went down. It watched the whole way and did not move. You came back up with something it let you take.',
      },
      {
        id: 'give_foundation', always: false, weight: 1,
        label: 'Give the site to the Foundation',
        desc: 'They take the building and the block around it.',
        poles: ['honor', 'caution'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 They took the building and the block around it. The families were rehoused and told nothing, which is how the Foundation says thank you.',
      },
      {
        id: 'flood_it', always: false, weight: 1,
        label: 'Flood the sublevel and leave it flooded',
        desc: 'Water and time, and nobody has to go down.',
        poles: ['ruthless', 'caution'], influence: 0,
        cost: null, reward: null,
        outcome: '🌊 They ran the hose until the sublevel filled. Something has been tapping the pipe from inside ever since.',
      },
      {
        id: 'empty_it', always: true, weight: 1,
        label: 'Empty the building and leave it standing',
        desc: 'Everyone out with their things and the lights left on.',
        poles: ['mercy'], influence: 0,
        cost: null, reward: null,
        outcome: '🏢 Everyone got out with their things. The basement lights are still on and rent on that block will never recover.',
      },
    ],
  },

  {
    id: 'eh_quarantine_green',
    title: 'A Bandage and a Story About a Nail',
    district: 'Quarantine Green',
    icon: '🩸',
    sev: 'grave',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… north gate holding one returned scavenger, unresolved … kkzzt…',
    brief: 'A scavenger came back through the north gate with a bandage on her forearm and a story about a nail. The gate crew does not believe her. The rules were written for exactly this, and nobody wants to be the one holding the pen.',
    choices: [
      {
        id: 'hold_her', always: false, weight: 1,
        label: 'Hold her in the green until it is certain',
        desc: 'A locked room with a window, and the wait.',
        poles: ['caution', 'mercy'], influence: 3,
        cost: null, reward: null,
        outcome: '🩸 She sat out the wait in a locked room with a window. It was a nail. She has not spoken to the gate crew since.',
      },
      {
        id: 'take_her_word', always: false, weight: 1,
        label: 'Take her word and let her through',
        desc: 'She has walked back through that gate a hundred times before.',
        poles: ['honor'], influence: 2,
        cost: null, reward: null,
        outcome: '🚪 She went home to her own bed. The gate crew slept badly and watched her door for a week.',
      },
      {
        id: 'put_her_out', always: false, weight: 1,
        label: 'Put her outside the wall',
        desc: 'The rule exists because of the one time it did not.',
        poles: ['ruthless'], influence: -6,
        cost: null, reward: null,
        outcome: '🌫 The gate closed behind her. She did not argue, which was worse than if she had.',
      },
      {
        id: 'pay_medic', always: false, weight: 1.5,
        label: 'Pay a Foundation medic to test her',
        desc: 'A strip, a needle, and an answer everybody can see.',
        poles: ['caution', 'honor'], influence: 5,
        cost: { cinder: 400 }, reward: null,
        outcome: '🏛 The medic drew blood and read the strip in front of everyone. It was a nail. Nobody had to take anybody\'s word.',
      },
      {
        id: 'gate_crew_call', always: true, weight: 0.5,
        label: 'Leave it to the gate crew',
        desc: 'They stand that wall every night and you do not.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 They settled it among themselves in the dark. Nobody will say what they settled.',
      },
    ],
  },

  {
    id: 'eh_zombie_block',
    title: 'The Fence on the Drowned Mile',
    district: 'The Drowned Mile',
    icon: '🧟',
    sev: 'grave',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… movement on the far side of the wire, same as last night … kkzzt…',
    brief: 'One street of the Drowned Mile is trading, hanging washing and running a bakery. The next street along has never been cleared, and the sound carries after dark. Between them is a chain fence and a habit. The bakery wants the fence moved outward.',
    choices: [
      {
        id: 'clear_it', always: false, weight: 1.5,
        label: 'Pay a clearance crew to take the block',
        desc: 'Street by street, at night, at cost.',
        poles: ['valor', 'ambition'], influence: 8,
        cost: { cinder: 1600 }, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🎯 They cleared it street by street over three nights and lost nobody. The Mile is longer this morning than it was.',
      },
      {
        id: 'hold_fence', always: false, weight: 1,
        label: 'Hold the fence where it is',
        desc: 'The wire has worked so far, which is the whole argument.',
        poles: ['caution'], influence: 1,
        cost: null, reward: null,
        outcome: '🧱 The fence held and the bakery kept its hours. Everyone on that side sleeps with the sound of the other.',
      },
      {
        id: 'volunteers', always: false, weight: 1,
        label: 'Let the block go in with what they have',
        desc: 'Hooks, lamps, and people who live there.',
        poles: ['valor'], influence: -2,
        cost: null, reward: null,
        outcome: '🧟 They went in with hooks and lamps and came back with fewer than they took. The fence is further out. So is the grief.',
      },
      {
        id: 'firebreak', always: false, weight: 1,
        label: 'Burn a firebreak between the two streets',
        desc: 'Buildings that could have been homes, for a quiet night.',
        poles: ['ruthless', 'caution'], influence: 0,
        cost: null, reward: null,
        outcome: '🔥 The break holds and the noise carries less. Buildings that could have been homes are ash.',
      },
      {
        id: 'leave_the_mile', always: true, weight: 0.5,
        label: 'Leave the Mile as it is',
        desc: 'It has been like this since the water went down.',
        poles: [], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 Nothing changed on either street. The bakery moved its ovens to the far wall.',
      },
    ],
  },

  /* ═══ THE FOUNDATION, WHICH IS THE GOVERNMENT NOW ═══════════════════════ */

  {
    id: 'eh_foundation_requisition',
    title: 'The Requisition',
    district: 'Kessler Line',
    icon: '🏛',
    sev: 'pressing',
    weight: 9,
    minInfluence: 20,
    maxInfluence: 100,
    wire: '…kkzzt… requisition served on the Kessler clinic, awaiting signature … kkzzt…',
    brief: 'A Foundation requisition arrived for the clinic generator on the Kessler Line. The paper is real and the signature is real, and the clinic is the only place this side of the river that can keep a premature baby warm. The officer serving it grew up on this street. He looks like he wants you to say no.',
    choices: [
      {
        id: 'comply', always: false, weight: 1,
        label: 'Sign it over',
        desc: 'The paper is lawful and the clinic runs on batteries.',
        poles: ['caution'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 The generator went out on a flatbed before noon. The clinic ran on batteries and the officer did not look up.',
      },
      {
        id: 'refuse', always: false, weight: 1.5,
        label: 'Refuse, and put your name on the refusal',
        desc: 'Signed, in front of him, in your own hand.',
        poles: ['valor', 'honor'], influence: -6,
        cost: null, reward: null,
        outcome: '🏛 You signed the refusal in front of him. It sits in a file now with your name on the top line.',
      },
      {
        id: 'swap_unit', always: false, weight: 1,
        label: 'Offer them the market generator instead',
        desc: 'They will not check the plate and the stalls will not know why.',
        poles: ['guile'], influence: 1,
        cost: null, reward: null,
        outcome: '🔧 They took the market unit and never checked the plate. The stalls run on lamp oil and blame the Foundation, which is convenient.',
      },
      {
        id: 'comply_and_replace', always: false, weight: 1,
        label: 'Comply, and buy the clinic another',
        desc: 'The requisition is served and nothing goes dark.',
        poles: ['honor', 'mercy'], influence: 8,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🔧 The requisition was served and the clinic never went dark. Two ledgers balanced. Yours was not one of them.',
      },
      {
        id: 'lose_the_file', always: true, weight: 0.5,
        label: 'Lose the paperwork for a week',
        desc: 'Delay is not refusal, and it is not nothing either.',
        poles: ['guile', 'caution'], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 The file went missing in the ward office. It came back with a second signature and a shorter deadline.',
      },
    ],
  },

  {
    id: 'eh_redaction_order',
    title: 'The Slot at Dusk',
    district: 'Broadcast Mast',
    icon: '📡',
    sev: 'pressing',
    weight: 8,
    minInfluence: 40,
    maxInfluence: 100,
    wire: '…kkzzt… citizen segment queued, dusk slot, hold for authorisation … kkzzt…',
    brief: 'The Emergency Broadcast runs a citizen segment at dusk. Tonight a warehouse hand was going to say on air what came out of the water at Riverworks. A Foundation liaison has asked, politely, for the segment to be cut. He asked you and not the operator, which tells you what he thinks you are.',
    choices: [
      {
        id: 'cut_it', always: false, weight: 1,
        label: 'Cut the segment',
        desc: 'The district hears a weather advisory instead.',
        poles: ['caution'], influence: 3,
        cost: null, reward: null,
        outcome: '📡 The slot ran a weather advisory. The warehouse hand went home and told the whole block anyway.',
      },
      {
        id: 'air_it', always: false, weight: 1.5,
        label: 'Let it run as recorded',
        desc: 'In his own words, at dusk, to everybody.',
        poles: ['honor', 'valor'], influence: -4,
        cost: null, reward: null,
        outcome: '📡 It went out at dusk in his own words. The liaison did not call again. Somebody else did.',
      },
      {
        id: 'air_edited', always: false, weight: 1,
        label: 'Run it with the location taken out',
        desc: 'The story survives and the map does not.',
        poles: ['guile', 'temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '📡 The story ran and the place did not. Half the district worked it out anyway; the other half sleeps better.',
      },
      {
        id: 'give_him_the_slot', always: false, weight: 1,
        label: 'Give him the slot and name who asked for it',
        desc: 'He can say it himself, on the record, as himself.',
        poles: ['honor'], influence: 1,
        cost: null, reward: null,
        outcome: '📡 The liaison read a prepared statement and the presenter said who wrote it. He has not asked for a slot since.',
      },
      {
        id: 'operators_call', always: true, weight: 0.5,
        label: 'Tell the operator it is her call',
        desc: 'It is her key and her name on the licence.',
        poles: [], influence: 0,
        cost: null, reward: null,
        outcome: '🌫 She ran it. She took the calls afterwards, and she knew that when she pressed the key.',
      },
    ],
  },

  {
    id: 'eh_his_ops_sweep',
    title: 'Empty the Meridian',
    district: 'Ash Meridian',
    icon: '🎯',
    sev: 'grave',
    weight: 8,
    minInfluence: 35,
    maxInfluence: 100,
    wire: '…kkzzt… tunnel sweep authorised, surface to be clear by dusk … kkzzt…',
    brief: 'H.I.S. OPS wants the Meridian empty for a night to sweep the tunnels beneath it. Empty means every household out by dusk carrying what they can carry. They will not say what is down there, and they are being unusually polite about not saying it.',
    choices: [
      {
        id: 'clear_block', always: false, weight: 1,
        label: 'Order the block cleared for the night',
        desc: 'Out by dusk, back at dawn, no questions answered.',
        poles: ['caution', 'honor'], influence: 5,
        cost: null, reward: null,
        outcome: '🎯 Everyone was out by dusk. There was shooting under the street at midnight and the block was signed back at dawn.',
      },
      {
        id: 'refuse_sweep', always: false, weight: 1,
        label: 'Refuse them the block',
        desc: 'Nobody moves and the tunnels keep whatever they have.',
        poles: ['valor'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 They stood down and filed it. Whatever is in the tunnels is still there, and now it knows it has time.',
      },
      {
        id: 'go_with_them', always: false, weight: 1.5,
        label: 'Clear it, and go down with them',
        desc: 'Behind the point man, in somebody else\'s war.',
        poles: ['valor', 'honor'], influence: 7,
        cost: null, reward: { chance: 0.35, cinder: null, card: { chance: 1, rarity: null } },
        outcome: '🎯 You went in behind the point man and came out with the squad. They speak to you differently now.',
      },
      {
        id: 'pay_beds', always: false, weight: 1,
        label: 'Clear it, and pay for beds for the night',
        desc: 'Nobody sleeps in the street for a sweep they did not ask for.',
        poles: ['mercy'], influence: 6,
        cost: { cinder: 600 }, reward: null,
        outcome: '🏢 Every household slept somewhere warm. The sweep ran clean and the Meridian came home to its own doors.',
      },
      {
        id: 'knock_yourselves', always: true, weight: 0.5,
        label: 'Tell them to knock on the doors themselves',
        desc: 'Your name is not going on an evacuation order.',
        poles: [], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 Half the block left and half did not. The sweep ran anyway, around the ones who stayed.',
      },
    ],
  },

  /* ═══ OUROBOROS AND THE CARDS ══════════════════════════════════════════ */

  {
    id: 'eh_uplink_window',
    title: 'One Window, One Beam',
    district: 'Ouroboros Pad',
    icon: '🛰',
    sev: 'pressing',
    weight: 8,
    minInfluence: 50,
    maxInfluence: 100,
    wire: '…kkzzt… orbital window opens at moonrise, single allocation, district … kkzzt…',
    brief: 'Ouroboros has a window over the Heights tonight and one beam allocation for the district. The salvage crews want it for a deep run under the old terminal. The wall wants it held back in case something comes over the river. The satellite does not care, and the window closes at moonrise.',
    choices: [
      {
        id: 'to_salvage', always: false, weight: 1,
        label: 'Give the window to the salvage crews',
        desc: 'They will go deeper than they should because they can.',
        poles: ['ambition'], influence: 1,
        cost: null, reward: { chance: 0.45, cinder: 'mid', card: { chance: 0.4, rarity: null } },
        outcome: '🛰 The beam came down over the terminal and they went deeper than they should have. What they brought up paid for itself.',
      },
      {
        id: 'to_wall', always: false, weight: 1,
        label: 'Hold it in reserve for the wall',
        desc: 'Spent on nothing, if the night is kind.',
        poles: ['caution'], influence: 3,
        cost: null, reward: null,
        outcome: '🛰 Nothing came over the river. The allocation expired unused, which is the only proof a reserve ever gets.',
      },
      {
        id: 'clinic_lift', always: false, weight: 1,
        label: 'Spend it lifting the clinic supply drop',
        desc: 'Medicine on the courtyard flags before dawn.',
        poles: ['mercy'], influence: 5,
        cost: null, reward: null,
        outcome: '🛰 The pallet came down in the courtyard and the clinic had medicine before dawn. The salvage crews watched it land.',
      },
      {
        id: 'sell_window', always: false, weight: 1.5,
        label: 'Sell the allocation to a Corporation',
        desc: 'Their beam, their district for a night, your Cinder.',
        poles: ['ambition', 'guile'], influence: -7,
        cost: null, reward: { chance: 0.6, cinder: 'large', card: null },
        outcome: '🪙 Somebody else\'s beam lit the district sky. The Cinder cleared that night and the wall heard about it by morning.',
      },
      {
        id: 'let_it_pass', always: true, weight: 0.5,
        label: 'Let the window pass unclaimed',
        desc: 'Nothing is summoned over the Heights tonight.',
        poles: ['temperance'], influence: -2,
        cost: null, reward: null,
        outcome: '🌘 The window opened and closed over a quiet city. Nothing was called and nothing was lost, and nobody thanks you for either.',
      },
    ],
  },

  {
    id: 'eh_counterfeit_deck',
    title: 'The Press in the Arcade',
    district: 'Market Arcade',
    icon: '🃏',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Somebody in the Arcade is printing cards that look right, weigh right and connect to nothing. A survivor who buys one finds that out in the ruins, once. The forger is a father who lost his shop in the flood, and he is very good at his job.',
    choices: [
      {
        id: 'turn_him_in', always: false, weight: 1,
        label: 'Turn him over to the ward',
        desc: 'The press is seized and his children go on the register.',
        poles: ['honor'], influence: 4,
        cost: null, reward: null,
        outcome: '🃏 The press was seized and the stall shuttered. His children are on the register now, which is a different problem.',
      },
      {
        id: 'shut_quietly', always: false, weight: 1.5,
        label: 'Shut the press and let him keep his name',
        desc: 'No charge, no record, no press.',
        poles: ['mercy', 'temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🃏 The press went into the river at night. He sells fruit now and does not look at you when you pass.',
      },
      {
        id: 'hire_him', always: false, weight: 1,
        label: 'Put him to work checking real cards',
        desc: 'He can spot his own work across a market.',
        poles: ['ambition', 'guile'], influence: 3,
        cost: null, reward: { chance: 0.35, cinder: 'small', card: null },
        outcome: '🃏 He can spot a bad print across the Arcade. The traders pay him for it and so, quietly, do you.',
      },
      {
        id: 'buy_the_fakes', always: false, weight: 1,
        label: 'Buy every fake off the market yourself',
        desc: 'They burn in a yard and nobody dies holding one.',
        poles: ['mercy', 'caution'], influence: 5,
        cost: { cinder: 900 }, reward: null,
        outcome: '🃏 You bought the lot and burned it in the yard. Nobody died in the ruins holding one, which is a result nobody will ever see.',
      },
      {
        id: 'name_him_on_air', always: false, weight: 1,
        label: 'Post his name on the Broadcast',
        desc: 'Every trader hears it, and so do his children.',
        poles: ['honor', 'ruthless'], influence: 1,
        cost: null, reward: null,
        outcome: '📡 The name went out at dusk. The press stopped that night and so did anybody willing to hire him.',
      },
      {
        id: 'warn_your_own', always: true, weight: 0.5,
        label: 'Say nothing and warn the crews you like',
        desc: 'Your people know which stall to walk past.',
        poles: ['guile'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 Your people know which stall to avoid. Somebody else\'s people do not.',
      },
    ],
  },

  {
    id: 'eh_beam_misfire',
    title: 'It Is Still in the Stairwell',
    district: 'Grand Concourse',
    icon: '🌌',
    sev: 'grave',
    weight: 8,
    minInfluence: 30,
    maxInfluence: 100,
    wire: '…kkzzt… uplink resolved off-mark, entity stationary, do not approach … kkzzt…',
    brief: 'A summon landed wrong on the Concourse and what came down is standing in a stairwell with its back to the wall. It has not moved since. The card that called it is still warm and it belongs to a boy who has not stopped crying.',
    choices: [
      {
        id: 'recall_it', always: false, weight: 1,
        label: 'Try to recall it through the card',
        desc: 'Send it back the way it came, if it goes.',
        poles: ['temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🌌 The card cooled in his hands and the stairwell was empty. He would not take it back.',
      },
      {
        id: 'keep_it_standing', always: false, weight: 1.5,
        label: 'Keep it standing and put it on the wall',
        desc: 'It does not sleep and the watch has stopped arguing.',
        poles: ['ambition', 'valor'], influence: 3,
        cost: null, reward: { chance: 0.3, cinder: null, card: { chance: 1, rarity: 'rare' } },
        outcome: '🌌 It walks the wall at night and does not sleep. The watch has stopped arguing about whose turn it is.',
      },
      {
        id: 'break_the_card', always: false, weight: 1,
        label: 'Destroy the card and end the connection',
        desc: 'The stairwell goes cold and so does something in him.',
        poles: ['ruthless', 'caution'], influence: -1,
        cost: null, reward: null,
        outcome: '🃏 The card split along the seam and the stairwell went cold. Something in the boy went with it.',
      },
      {
        id: 'foundation_collect', always: false, weight: 1,
        label: 'Call the Foundation to collect it',
        desc: 'They take the entity, the card and his statement.',
        poles: ['honor', 'caution'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 They took the entity, the card and the boy\'s statement. He was home by evening and does not remember the stairwell.',
      },
      {
        id: 'board_it_up', always: true, weight: 0.5,
        label: 'Board the stairwell and leave it be',
        desc: 'The Concourse can route around one stairwell.',
        poles: ['caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The boards went up and the Concourse routed around it. It is still in there, with its back to the wall.',
      },
    ],
  },

  /* ═══ THE REALMS, WHICH DO NOT KNOCK ═══════════════════════════════════ */

  {
    id: 'eh_portal_courtyard',
    title: 'The Door in the School Yard',
    district: 'Northgate Wards',
    icon: '🌀',
    sev: 'grave',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… aperture stable, courtyard evacuated, awaiting instruction … kkzzt…',
    brief: 'A portal opened in the school courtyard between the morning bell and the first lesson. It is the height of a door and the colour of nothing. The children were moved inside. Two teachers are standing between it and the window, which is not a plan.',
    choices: [
      {
        id: 'close_it', always: false, weight: 1,
        label: 'Pay a Foundation team to close it',
        desc: 'Collapsed by afternoon and invoiced by evening.',
        poles: ['caution', 'mercy'], influence: 7,
        cost: { cinder: 1500 }, reward: null,
        outcome: '🏛 They collapsed it before the afternoon and swept the flags for residue. The invoice arrived faster than the report.',
      },
      {
        id: 'let_them_study', always: false, weight: 1,
        label: 'Hold the yard and let them study it',
        desc: 'Lessons move to the hall and the readings go somewhere.',
        poles: ['ambition'], influence: 2,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🌀 The readings went somewhere useful and the school ran its lessons in the hall. Nothing came through. Nothing has, yet.',
      },
      {
        id: 'move_school', always: false, weight: 1,
        label: 'Move the school and give up the yard',
        desc: 'The children get a post office and the yard gets a fence.',
        poles: ['caution', 'temperance'], influence: 0,
        cost: null, reward: null,
        outcome: '🏢 Lessons run out of the old post office now. The yard has a fence and a name the children made up.',
      },
      {
        id: 'go_through', always: false, weight: 1.5,
        label: 'Send a team through it',
        desc: 'Somebody has to find out where a door goes.',
        poles: ['valor', 'ambition'], influence: 4,
        cost: null, reward: { chance: 0.35, cinder: null, card: { chance: 1, rarity: null } },
        outcome: '🌀 Three went in and three came out, which is not always how that ends. What they carried back is not from here.',
      },
      {
        id: 'gate_the_door', always: false, weight: 1,
        label: 'Wall the yard and put a gate on the door',
        desc: 'If it goes somewhere useful, somebody will pay to go there.',
        poles: ['ambition', 'guile'], influence: -2,
        cost: null, reward: { chance: 0.3, cinder: 'large', card: null },
        outcome: '🌀 The yard is walled and the door has a gate and a price. The school never came back.',
      },
      {
        id: 'fence_and_sign', always: true, weight: 0.5,
        label: 'Fence it and post the warning',
        desc: 'Wire, a sign, a lamp, and whatever happens next.',
        poles: [], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 Wire, a sign and a lamp. It is what the ward can afford and everybody knows it.',
      },
    ],
  },

  {
    id: 'eh_mind_realm_bleed',
    title: 'The Street Everyone Is Dreaming',
    district: 'Kessler Line',
    icon: '🌙',
    sev: 'quiet',
    weight: 7,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Everyone on the Kessler Line has been dreaming the same street. Same shopfronts, same rain, same woman waiting at the crossing. Nobody there has slept properly in days, and the woman has started to appear in the waking hours, at the edge of things.',
    choices: [
      {
        id: 'move_the_block', always: false, weight: 1,
        label: 'Move the block and let the street empty',
        desc: 'They pack in a morning and the dreams stop for whoever leaves.',
        poles: ['caution'], influence: 1,
        cost: null, reward: null,
        outcome: '🌙 They packed in a morning. The dreams stopped for everyone who left, which is its own kind of answer.',
      },
      {
        id: 'call_research', always: false, weight: 1,
        label: 'Hand it to Foundation research',
        desc: 'Statements from everyone and a monitor on the corner.',
        poles: ['honor'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 They took statements from everyone and left a monitor on the corner. The dreams continue. The monitor blinks.',
      },
      {
        id: 'sleep_there', always: false, weight: 1.5,
        label: 'Sleep on the Line and speak to her yourself',
        desc: 'Go to the crossing and ask what she is waiting for.',
        poles: ['valor', 'temperance'], influence: 5,
        cost: null, reward: { chance: 0.25, cinder: null, card: { chance: 1, rarity: null } },
        outcome: '🌙 You dreamed the street and she was at the crossing. She said a name you had never heard, and you woke holding it.',
      },
      {
        id: 'light_the_line', always: false, weight: 1,
        label: 'Light the whole Line through the night',
        desc: 'Lamps on every landing until dawn.',
        poles: ['mercy', 'caution'], influence: 3,
        cost: { cinder: 300 }, reward: null,
        outcome: '💡 Lamps on every landing until dawn. People slept. The street they dream is lit now too.',
      },
      {
        id: 'call_it_exhaustion', always: true, weight: 0.5,
        label: 'Tell them it is exhaustion',
        desc: 'It is the explanation that costs nobody anything.',
        poles: ['guile'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 They believed you for a while. She is on the Line most evenings now, at the edge of things.',
      },
    ],
  },

  {
    id: 'eh_vanish_line',
    title: 'He Wants His Door Key',
    district: 'The Vanish Line',
    icon: '👁',
    sev: 'grave',
    weight: 7,
    minInfluence: 45,
    maxInfluence: 100,
    wire: '…kkzzt… returned individual, no decay, no record of transit … kkzzt…',
    brief: 'A man who vanished off this street during the Collapse walked back onto it this morning, the same age, in the same coat. His wife is alive and remarried on the next block. He is asking for his door key, and he is very calm about it.',
    choices: [
      {
        id: 'give_key', always: false, weight: 1,
        label: 'Give him his door and let them settle it',
        desc: 'It was his house before it was anybody else\'s problem.',
        poles: ['mercy'], influence: 2,
        cost: null, reward: null,
        outcome: '🚪 He sat in his own kitchen for an hour and then walked out again. His wife has not opened her curtains since.',
      },
      {
        id: 'report_him', always: false, weight: 1,
        label: 'Report him to the Foundation',
        desc: 'Somebody in that office will know what he is. It will not be her.',
        poles: ['honor', 'caution'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 They took him without a word and gave the wife a form. Somebody in that office knows what he is now.',
      },
      {
        id: 'question_him', always: false, weight: 1.5,
        label: 'Ask him what he remembers of the night',
        desc: 'Everything he says will be correct. That is the test.',
        poles: ['temperance', 'guile'], influence: 3,
        cost: null, reward: null,
        outcome: '👁 He answered everything and got nothing wrong. It was the way he answered that emptied the room.',
      },
      {
        id: 'refuse_the_street', always: false, weight: 1,
        label: 'Refuse him the street entirely',
        desc: 'Walked to the line and let go of.',
        poles: ['ruthless', 'caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 He was walked to the line and released. He waits at the end of it in the evenings, in the same coat.',
      },
      {
        id: 'watch_him', always: true, weight: 0.5,
        label: 'Say nothing and watch what he does',
        desc: 'He has been patient. You can be patient.',
        poles: ['caution', 'guile'], influence: -1,
        cost: null, reward: null,
        outcome: '👁 He has been polite, patient and constant. The street watches him and he watches the door.',
      },
    ],
  },

  {
    id: 'eh_kalon_girl',
    title: 'She Put the Fire Out With Her Hands',
    district: 'Harrow Yards',
    icon: '✨',
    sev: 'grave',
    weight: 6,
    minInfluence: 55,
    maxInfluence: 100,
    wire: '…kkzzt… enquiries logged at the Yards, origin not local … kkzzt…',
    brief: 'A girl in the Yards changed for a moment during a tenement fire and put it out with her hands. She is fine. Her mother is not, and neither is the block, and there are already people asking after her by name who are not from the Yards.',
    choices: [
      {
        id: 'hide_her', always: false, weight: 1.5,
        label: 'Move her somewhere quiet and lose the record',
        desc: 'A different name, a different school, the same questions.',
        poles: ['mercy', 'guile'], influence: -2,
        cost: null, reward: null,
        outcome: '✨ She is somewhere with a different name and a school. The people asking after her are still asking.',
      },
      {
        id: 'register_her', always: false, weight: 1,
        label: 'Register her with the Foundation',
        desc: 'A stipend, a handler and a curfew, and her mother can visit.',
        poles: ['honor', 'caution'], influence: 5,
        cost: null, reward: null,
        outcome: '🏛 They took her details and left a card. She has a stipend, a handler and a curfew, and her mother can visit.',
      },
      {
        id: 'train_her', always: false, weight: 1,
        label: 'Pay for her to be taught properly',
        desc: 'Whatever she is becoming, she should not learn it alone.',
        poles: ['ambition', 'mercy'], influence: 6,
        cost: { cinder: 900 }, reward: { chance: 0.3, cinder: null, card: { chance: 1, rarity: 'epic' } },
        outcome: '✨ She trains at the pad three mornings a week. What she is learning to be is not on any register yet.',
      },
      {
        id: 'let_the_yards', always: false, weight: 1,
        label: 'Leave her alone and let the Yards handle it',
        desc: 'They close around their own and they always have.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '✨ The Yards closed around her the way the Yards do. She is a girl who put out a fire, and that is all anybody there will say.',
      },
      {
        id: 'hope_it_passes', always: true, weight: 0.5,
        label: 'Do nothing and hope the interest passes',
        desc: 'People ask about a lot of things and then stop.',
        poles: ['caution'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The interest did not pass. Somebody spoke to her mother while you were deciding.',
      },
    ],
  },

  /* ═══ LIGHT AND SHADOW — the clock is a hazard here ═════════════════════ */

  {
    id: 'eh_daylight_school',
    title: 'The Lamps Are Wanted Twice',
    district: 'Bellwether Heights',
    icon: '☀',
    sev: 'quiet',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'The school runs on daylight, because Shadow comes up with the moon and the older children know exactly what that means. Winter is shortening the day faster than the timetable can absorb it. The teachers want the lamps. The watch wants the lamps for the wall.',
    choices: [
      {
        id: 'lamps_to_school', always: false, weight: 1,
        label: 'Give the lamps to the school',
        desc: 'Lessons past dusk and a darker wall.',
        poles: ['mercy'], influence: 3,
        cost: null, reward: null,
        outcome: '☀ Lessons ran past dusk under lamplight. The wall walked its rounds darker and did not complain where the children could hear.',
      },
      {
        id: 'lamps_to_wall', always: false, weight: 1,
        label: 'Keep the lamps on the wall',
        desc: 'The wall is what the school is standing behind.',
        poles: ['caution'], influence: 2,
        cost: null, reward: null,
        outcome: '🌘 The wall stayed lit and the school lost its afternoons. The older children are already teaching the younger in the mornings.',
      },
      {
        id: 'shorter_day', always: false, weight: 1.5,
        label: 'Shorten the day and teach in the light you have',
        desc: 'They learn less and they are all home before moonrise.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '☀ The timetable shrank to fit the sun. They learn less and they are all home before the moon.',
      },
      {
        id: 'buy_lamps', always: false, weight: 1,
        label: 'Buy lamps enough for both',
        desc: 'The Shadow is no weaker; the district simply stops choosing.',
        poles: ['ambition', 'mercy'], influence: 5,
        cost: { cinder: 500 }, reward: null,
        outcome: '💡 Lamps on the wall and lamps in the hall. Shadow is no weaker; the district merely stopped choosing.',
      },
      {
        id: 'let_them_settle', always: true, weight: 0.5,
        label: 'Let the headmaster and the watch settle it',
        desc: 'Two reasonable people and one crate of lamps.',
        poles: [], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 They split the lamps down the middle without you, and both sides feel cheated. It works.',
      },
    ],
  },

  {
    id: 'eh_night_crews',
    title: 'The Moon Shift Pays Double',
    district: 'Riverworks',
    icon: '🌘',
    sev: 'pressing',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… night rota posted, full, waiting list … kkzzt…',
    brief: 'Riverworks pays double for the moon shift because what is in the water is stronger after dark and everybody knows it. The night crews are the only people at the Works earning enough to ever leave the Works. That is why the rota is full and the waiting list is longer.',
    choices: [
      {
        id: 'ban_night', always: false, weight: 1,
        label: 'Stop the moon shift entirely',
        desc: 'Nobody works the water after dark and nobody gets out.',
        poles: ['mercy', 'caution'], influence: 2,
        cost: null, reward: null,
        outcome: '🌘 The Works run daylight only. Output halved and the crews who were nearly out are back where they started.',
      },
      {
        id: 'let_them_choose', always: false, weight: 1,
        label: 'Leave it running and let them choose',
        desc: 'They are adults and the wage is the whole point.',
        poles: ['honor'], influence: 1,
        cost: null, reward: { chance: 0.4, cinder: 'mid', card: null },
        outcome: '🌘 They chose, the way they always choose. The Works made quota and the list of who did not come back got longer.',
      },
      {
        id: 'warded_escort', always: false, weight: 1.5,
        label: 'Pay a warded escort for every moon shift',
        desc: 'Lamps, wards and rifles, and the margin gone.',
        poles: ['mercy', 'ambition'], influence: 6,
        cost: { cinder: 800 }, reward: null,
        outcome: '🎯 Lamps, wards and rifles on every shift. Nobody has been taken since, and the margin is gone.',
      },
      {
        id: 'cap_shifts', always: false, weight: 1,
        label: 'Cap how many nights any one crew can take',
        desc: 'The risk spreads and so does the thin wage.',
        poles: ['temperance', 'caution'], influence: 3,
        cost: null, reward: null,
        outcome: '🌘 The rota spread the risk and thinned the wage. The ones closest to getting out are the angriest about it.',
      },
      {
        id: 'move_the_seam', always: false, weight: 1,
        label: 'Move the moon shift upriver, off the water',
        desc: 'Longer walk, thinner seam, the same wage.',
        poles: ['caution', 'ambition'], influence: 2,
        cost: null, reward: null,
        outcome: '🌘 The seam upriver is thinner and the walk is longer. The wage held and nobody has gone into the water since.',
      },
      {
        id: 'works_to_works', always: true, weight: 0.5,
        label: 'Leave the Works to the Works',
        desc: 'The foreman has run that river a long time.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The foreman runs it the way he has always run it. The river takes what it takes.',
      },
    ],
  },

  /* ═══ CORPORATIONS AND GOVERNORS ═══════════════════════════════════════ */

  {
    id: 'eh_corp_toll',
    title: 'The Toll on Kessler Bridge',
    district: 'Kessler Bridge',
    icon: '🌉',
    sev: 'pressing',
    weight: 9,
    minInfluence: 15,
    maxInfluence: 100,
    wire: '…kkzzt… cart traffic down on the bridge crossing, third day … kkzzt…',
    brief: 'A Corporation repaired the only clear bridge into the Heights and has put a toll on it. The repair is real and it was not cheap. So is the toll, and the carts that feed the Arcade cannot pay it twice a day.',
    choices: [
      {
        id: 'pay_for_carts', always: false, weight: 1,
        label: 'Pay the district\'s carts through for the season',
        desc: 'The Arcade stays stocked and they raise the rate on everyone else.',
        poles: ['mercy', 'ambition'], influence: 6,
        cost: { cinder: 1100 }, reward: null,
        outcome: '🌉 The carts roll and the Arcade is stocked. They banked your Cinder and raised the rate on everybody else.',
      },
      {
        id: 'negotiate', always: false, weight: 1.5,
        label: 'Sit down and negotiate the rate',
        desc: 'An afternoon, and both sides leave unsatisfied.',
        poles: ['temperance', 'honor'], influence: 4,
        cost: null, reward: null,
        outcome: '🤝 It took an afternoon and both sides walked away unsatisfied, which is what an agreement looks like.',
      },
      {
        id: 'reopen_ford', always: false, weight: 1,
        label: 'Reopen the old ford and route around them',
        desc: 'Slow, wet, and free.',
        poles: ['guile', 'caution'], influence: 2,
        cost: null, reward: null,
        outcome: '🌊 The ford is slow, wet and free. Half the carts use it and the bridge is quieter than they budgeted for.',
      },
      {
        id: 'seize_bridge', always: false, weight: 1,
        label: 'Declare the bridge district property and take it',
        desc: 'The barrier comes down and the lawyers start writing.',
        poles: ['ruthless', 'valor'], influence: -6,
        cost: null, reward: { chance: 0.35, cinder: 'large', card: null },
        outcome: '🌉 The barrier came down and the tolls stopped that morning. That Corporation has a long memory and a legal department.',
      },
      {
        id: 'toll_them_back', always: false, weight: 1,
        label: 'Put a gate on the north road and toll them back',
        desc: 'Their trucks use your road as well.',
        poles: ['guile', 'ruthless'], influence: -1,
        cost: null, reward: null,
        outcome: '🌉 A gate went up on the north road the same week. Both sides pay to move now and both sides call it principle.',
      },
      {
        id: 'let_them_argue', always: true, weight: 0.5,
        label: 'Let the carts and the Corporation argue',
        desc: 'Prices in the Arcade will tell you how it went.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The carts pay or they do not come. Prices in the Arcade tell you which, every morning.',
      },
    ],
  },

  {
    id: 'eh_zoning_seat',
    title: 'The Vacant Seat',
    district: 'Ward Hall',
    icon: '🗳',
    sev: 'pressing',
    weight: 7,
    minInfluence: 60,
    maxInfluence: 100,
    wire: '…kkzzt… ward hall confirms one vacancy, nominations open at dawn … kkzzt…',
    brief: 'A ward seat came vacant when its holder did not come back from a survey run. Whoever sits in it signs the zoning for the whole north bank. A Corporation has a candidate with money and a plan. The Row has a foreman with neither, and the Foundation has quietly indicated a preference.',
    choices: [
      {
        id: 'back_corp', always: false, weight: 1,
        label: 'Back the Corporation candidate',
        desc: 'The north bank gets built and it gets built for them.',
        poles: ['ambition'], influence: 3,
        cost: null, reward: { chance: 0.4, cinder: 'large', card: null },
        outcome: '🗳 He took the seat and the cranes were up inside a month. The north bank is being built for somebody, and it is not the Row.',
      },
      {
        id: 'back_foreman', always: false, weight: 1.5,
        label: 'Back the foreman from the Row',
        desc: 'He knows the ground and nothing about the paperwork.',
        poles: ['honor', 'mercy'], influence: 5,
        cost: null, reward: null,
        outcome: '🗳 He took the seat and has been out of his depth in public ever since. The zoning is slow and it is honest.',
      },
      {
        id: 'take_it_yourself', always: false, weight: 1,
        label: 'Take the seat yourself',
        desc: 'You sign the north bank and you own every line of it.',
        poles: ['ambition', 'valor'], influence: 8,
        cost: { cinder: 1200 }, reward: null,
        outcome: '🏛 The seat is yours and so is the north bank. Everything built there now has your name under it, including the mistakes.',
      },
      {
        id: 'defer_foundation', always: false, weight: 1,
        label: 'Take the Foundation\'s preference',
        desc: 'A safe pair of hands, and whose hands is the question.',
        poles: ['caution', 'guile'], influence: 4,
        cost: null, reward: null,
        outcome: '🏛 Their candidate was sworn in without a word of debate. The seat has been quiet and useful ever since.',
      },
      {
        id: 'leave_vacant', always: true, weight: 0.5,
        label: 'Leave the seat empty',
        desc: 'Nothing is signed until somebody sits in it.',
        poles: ['temperance'], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 The seat stayed empty and the north bank stayed rubble. Nobody built anything wrong there this year.',
      },
    ],
  },

  {
    id: 'eh_warpath_returnees',
    title: 'They Came Back With More Than They Took',
    district: 'Northgate',
    icon: '⛺',
    sev: 'pressing',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… gate reports unregistered arrivals, holding outside the line … kkzzt…',
    brief: 'A Warpath crew came out of the frontier with more people than they went in with. Strangers are camped at Northgate with nothing and no papers, and the crew that brought them out will not leave until somebody opens the gate. The register was already long.',
    choices: [
      {
        id: 'open_gate', always: false, weight: 1.5,
        label: 'Open the gate and take them all',
        desc: 'The Heights gets bigger, hungrier and more crowded.',
        poles: ['mercy', 'valor'], influence: 5,
        cost: null, reward: null,
        outcome: '⛺ They came in and the register grew by a page. The Heights is more crowded, hungrier, and larger than it was.',
      },
      {
        id: 'vouched_only', always: false, weight: 1,
        label: 'Take only those who can be vouched for',
        desc: 'Some come in and the rest watch the gate close.',
        poles: ['caution', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🚪 Some came in. The rest watched the gate close from outside, with the crew that had saved them.',
      },
      {
        id: 'turn_them_out', always: false, weight: 1,
        label: 'Turn them out to the camps',
        desc: 'A day\'s water and a direction.',
        poles: ['ruthless', 'caution'], influence: -6,
        cost: null, reward: null,
        outcome: '🌫 They were pointed at Camp Heights and given a day\'s water. That Warpath crew has not signed on since.',
      },
      {
        id: 'fund_outside_camp', always: false, weight: 1,
        label: 'Fund a camp outside the wall and feed it',
        desc: 'Tents, a well and a fence, and everyone knows what it is not.',
        poles: ['temperance', 'mercy'], influence: 7,
        cost: { cinder: 1400 }, reward: null,
        outcome: '⛺ Tents, a well and a fence outside the wall. It is not the city, and everybody involved knows it is not the city.',
      },
      {
        id: 'children_first', always: false, weight: 1,
        label: 'Take the children and hold the rest outside',
        desc: 'The young come through and their people wait at the wire.',
        poles: ['temperance', 'caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🚪 The children came through the gate alone. Their people are still at the wire, and they can see the lamps.',
      },
      {
        id: 'let_register_decide', always: true, weight: 0.5,
        label: 'Leave it to the gate register',
        desc: 'The rules were written down for a reason.',
        poles: [], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 The register did what a register does. The line at Northgate is shorter this morning and nobody asked where they went.',
      },
    ],
  },

  /* ═══ QUIET ONES — nothing supernatural happens at all ══════════════════ */

  {
    id: 'eh_the_thief',
    title: 'The Boy at the Grocer',
    district: 'Market Arcade',
    icon: '🧒',
    sev: 'quiet',
    weight: 10,
    minInfluence: 0,
    maxInfluence: 75,
    wire: null,
    brief: 'A boy has been lifting from the reopened grocer three mornings running. The grocer caught him today and is holding him by the collar in front of the stall, waiting for somebody with standing to say what happens next. The boy is not hungry. His sister is.',
    choices: [
      {
        id: 'pay_grocer', always: false, weight: 1,
        label: 'Pay what he took and let him go',
        desc: 'The grocer is square and the boy owes nobody.',
        poles: ['mercy'], influence: 3,
        cost: { cinder: 200 }, reward: null,
        outcome: '🪙 The grocer took the Cinder and let go of the collar. The boy came back the next morning to sweep, unasked.',
      },
      {
        id: 'work_it_off', always: false, weight: 1.5,
        label: 'Put him to work in the stall until it is square',
        desc: 'Early shifts, and he eats where he stole.',
        poles: ['honor', 'temperance'], influence: 5,
        cost: null, reward: null,
        outcome: '🧹 He works the early shift and eats at the stall. The grocer has stopped counting the crates.',
      },
      {
        id: 'ward_it', always: false, weight: 1,
        label: 'Hand him to the ward office',
        desc: 'A file is opened and his sister goes on the register.',
        poles: ['honor', 'ruthless'], influence: 0,
        cost: null, reward: null,
        outcome: '🏛 The file was opened and the sister went on the register. It is the correct process and everybody involved feels worse.',
      },
      {
        id: 'eat_the_loss', always: false, weight: 1,
        label: 'Tell the grocer to let it go and eat the loss',
        desc: 'It costs him a morning and he will remember that.',
        poles: ['mercy', 'guile'], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 The grocer let go and lost the morning\'s takings. He will not be the one who calls you next time.',
      },
      {
        id: 'feed_the_sister', always: false, weight: 1,
        label: 'Have the Arcade feed the sister and let him be',
        desc: 'The stalls can carry one child between them.',
        poles: ['mercy', 'temperance'], influence: 2,
        cost: null, reward: null,
        outcome: '🍞 The stalls fed her without being told twice. The boy stopped lifting and started carrying crates.',
      },
      {
        id: 'not_yours', always: true, weight: 0.5,
        label: 'Say it is not yours to settle',
        desc: 'The Arcade has always sorted the Arcade.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The Arcade settled it the way the Arcade does. Nobody has seen the boy since the weekend.',
      },
    ],
  },

  {
    id: 'eh_shop_sign',
    title: 'His Father\'s Shop Sign',
    district: 'Foundry Row',
    icon: '🪧',
    sev: 'quiet',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 70,
    wire: null,
    brief: 'A man has been carrying his father\'s shop sign around the Row for a week, looking for somebody with the authority to let him put it back up. The building it belongs to is a stairwell and a facade. He is not asking for the building. He is asking for the sign.',
    choices: [
      {
        id: 'hang_it', always: false, weight: 1,
        label: 'Have the crew hang it on the facade',
        desc: 'Half an hour of a working crew, for a sign.',
        poles: ['mercy', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🪧 It went up crooked and stayed up. People give directions by it now, which is more than the building ever did.',
      },
      {
        id: 'store_it', always: false, weight: 1,
        label: 'Put it in the ward store until the block is rebuilt',
        desc: 'A shelf, a tag, and a date nobody will name.',
        poles: ['caution', 'temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '📦 It is on a shelf with a tag on it. He asks after it. The shelf does not move.',
      },
      {
        id: 'fund_frontage', always: false, weight: 1.5,
        label: 'Fund the frontage so the sign has a wall',
        desc: 'A shop, on the Row, that will sell almost nothing.',
        poles: ['ambition', 'mercy'], influence: 6,
        cost: { cinder: 1000 }, reward: null,
        outcome: '🔧 The frontage went up before the frost. He opens at dawn, sells almost nothing, and opens again the next day.',
      },
      {
        id: 'refuse_facade', always: false, weight: 1,
        label: 'Tell him the facade is not safe',
        desc: 'It is true, and he knew it before he asked.',
        poles: ['caution'], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 It is true, and he knew it before he asked. He carries the sign somewhere else now.',
      },
      {
        id: 'look_away', always: true, weight: 0.5,
        label: 'Let him hang it himself and look away',
        desc: 'Nobody signed for it and nobody stopped him.',
        poles: ['guile'], influence: 0,
        cost: null, reward: null,
        outcome: '🪧 He got it up alone before anyone could stop him. Nobody has taken it down, and nobody signed for it.',
      },
    ],
  },

  {
    id: 'eh_carrion_park',
    title: 'The Only Flat Green Left',
    district: 'Carrion Park',
    icon: '⚰',
    sev: 'quiet',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Carrion Park is the only flat green in the district and it is full. The wards want it for glasshouses and the families want it left alone. Every name in that ground belongs to somebody still living on this side of the river.',
    choices: [
      {
        id: 'keep_ground', always: false, weight: 1.5,
        label: 'Leave the ground as it is',
        desc: 'The glasshouses go on the roofs at twice the cost.',
        poles: ['mercy', 'temperance'], influence: 4,
        cost: null, reward: null,
        outcome: '⚰ The park stays. The glasshouses go on the roofs instead, which costs more and yields less and is worth it.',
      },
      {
        id: 'build_glass', always: false, weight: 1,
        label: 'Clear it and build the glasshouses',
        desc: 'The district eats better and nobody walks that path again.',
        poles: ['ruthless', 'ambition'], influence: -5,
        cost: null, reward: { chance: 0.5, cinder: 'mid', card: null },
        outcome: '🌱 The frames went up fast and the district eats better for it. Nobody walks that path any more.',
      },
      {
        id: 'relocate_graves', always: false, weight: 1,
        label: 'Pay to move the graves properly',
        desc: 'Lifted, recorded, reinterred by the river.',
        poles: ['honor', 'mercy'], influence: 7,
        cost: { cinder: 1300 }, reward: null,
        outcome: '⚰ Every name was lifted, recorded and laid down again by the river. It took a month and cost more than the crop is worth.',
      },
      {
        id: 'half_park', always: false, weight: 1,
        label: 'Take half the park and fence the rest',
        desc: 'Half glass, half grass, one gate everybody resents.',
        poles: ['temperance'], influence: 1,
        cost: null, reward: null,
        outcome: '🌱 Half glass, half grass, one gate. Both halves resent the fence and both halves use it.',
      },
      {
        id: 'refuse_to_rule', always: true, weight: 0.5,
        label: 'Refuse to rule on it',
        desc: 'Let the committees keep meeting.',
        poles: [], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 The park is neither built on nor blessed. Two committees meet about it and nothing grows.',
      },
    ],
  },

  {
    id: 'eh_wedding_watchtower',
    title: 'Under the North Tower',
    district: 'Northgate Wards',
    icon: '🕯',
    sev: 'quiet',
    weight: 7,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'Two people from the north wards want to be married under the watchtower at dusk, with lamps, and the whole ward is invited. The watch says lamps at dusk on the wall line is exactly what the standing order forbids. Nobody has been married in this district since before the water came.',
    choices: [
      {
        id: 'allow_it', always: false, weight: 1,
        label: 'Allow it, lamps and all',
        desc: 'A lit wall line for one evening.',
        poles: ['mercy', 'valor'], influence: 4,
        cost: null, reward: null,
        outcome: '🕯 They were married under lamplight with the whole ward watching. The wall line was lit for an hour and nothing came.',
      },
      {
        id: 'move_it_inside', always: false, weight: 1,
        label: 'Move it inside the hall',
        desc: 'Safe, warm, and not what they asked for.',
        poles: ['caution'], influence: 1,
        cost: null, reward: null,
        outcome: '🏢 It happened in the ward hall with the shutters closed. It was a good evening and it was not the tower.',
      },
      {
        id: 'daylight_wedding', always: false, weight: 1.5,
        label: 'Hold it at noon under the tower',
        desc: 'The tower, the ward, and no lamps at all.',
        poles: ['temperance', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '☀ They were married at noon under the tower with the sun on the wall. Half the ward had to work through it.',
      },
      {
        id: 'double_watch', always: false, weight: 1,
        label: 'Allow it and pay a double watch',
        desc: 'The lamps burn and somebody is paid to look outward.',
        poles: ['mercy', 'caution'], influence: 5,
        cost: { cinder: 350 }, reward: null,
        outcome: '🎯 Lamps at dusk and twice the watch on the line. Nobody saw the ceremony except the people in it.',
      },
      {
        id: 'standing_order', always: true, weight: 0.5,
        label: 'Uphold the standing order and refuse',
        desc: 'The order was written by people who lost a wall.',
        poles: ['caution', 'honor'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 They were married in a kitchen with the curtains drawn. The standing order held, and everybody knows who held it.',
      },
    ],
  },

  {
    id: 'eh_clinic_debt',
    title: 'The Ledger at the Clinic',
    district: 'Lower Reclaim',
    icon: '🩹',
    sev: 'quiet',
    weight: 8,
    minInfluence: 0,
    maxInfluence: 100,
    wire: null,
    brief: 'The clinic treats whoever walks in and writes down what they owe. The ledger is now longer than the district can pay and the doctor has stopped pretending otherwise. She will keep the door open either way. She wants to know whether she should keep writing.',
    choices: [
      {
        id: 'clear_ledger', always: false, weight: 1,
        label: 'Clear the ledger out of your own account',
        desc: 'Every name struck out, once.',
        poles: ['mercy', 'honor'], influence: 8,
        cost: { cinder: 1600 }, reward: null,
        outcome: '🩹 Every name was struck out in one afternoon. The ledger started filling again the following week.',
      },
      {
        id: 'enforce_it', always: false, weight: 1,
        label: 'Enforce the debts through the ward',
        desc: 'The clinic gets paid and people stop coming in early.',
        poles: ['ruthless', 'honor'], influence: -4,
        cost: null, reward: { chance: 0.45, cinder: 'small', card: null },
        outcome: '🩹 The ward collected and the clinic bought supplies. People come in later now, and sicker.',
      },
      {
        id: 'work_debts', always: false, weight: 1.5,
        label: 'Let debts be worked off on the reclamation crews',
        desc: 'Hours on the rubble instead of Cinder nobody has.',
        poles: ['temperance'], influence: 5,
        cost: null, reward: null,
        outcome: '🔧 The debtors clear rubble on the early shift. The ledger empties slowly and the streets clear faster than they did.',
      },
      {
        id: 'stop_writing', always: false, weight: 1,
        label: 'Tell her to stop writing them down',
        desc: 'Treatment is free and the shortfall is somebody\'s problem later.',
        poles: ['mercy'], influence: 2,
        cost: null, reward: null,
        outcome: '🩹 She closed the ledger and kept the door open. The supply orders are going to come due on somebody.',
      },
      {
        id: 'her_ledger', always: true, weight: 0.5,
        label: 'Tell her it is her ledger',
        desc: 'She has run that clinic longer than you have been here.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 She kept writing. She has never once shown the book to anybody, and she never will.',
      },
    ],
  },

  {
    id: 'eh_dog_at_the_gate',
    title: 'The Dog at the North Gate',
    district: 'Northgate',
    icon: '🐕',
    sev: 'quiet',
    weight: 6,
    minInfluence: 0,
    maxInfluence: 80,
    wire: null,
    brief: 'A dog has been sitting outside the north gate for a week. It is not sick and it is not aggressive, and it will not come in and will not go away. The gate crew has been feeding it out of their own rations. Somebody has finally asked what the rule is.',
    choices: [
      {
        id: 'bring_it_in', always: false, weight: 1,
        label: 'Bring it in and let the gate crew keep it',
        desc: 'One more mouth and one more thing that barks at strangers.',
        poles: ['mercy'], influence: 2,
        cost: null, reward: null,
        outcome: '🐕 It came in on a rope and would not leave the gatehouse. The night crew sleeps better with it there.',
      },
      {
        id: 'quarantine_it', always: false, weight: 1,
        label: 'Hold it in the green until it is cleared',
        desc: 'The rule for a bite is the rule for a dog.',
        poles: ['caution', 'honor'], influence: 3,
        cost: null, reward: null,
        outcome: '🩸 It sat out the wait like everything else does. It came out clear and went straight back to the gate.',
      },
      {
        id: 'drive_it_off', always: false, weight: 1,
        label: 'Drive it off and stop the feeding',
        desc: 'Rations are counted and the crew is not.',
        poles: ['ruthless'], influence: -3,
        cost: null, reward: null,
        outcome: '🌫 They drove it off and stopped writing rations against it. It is somewhere on the approach road, still waiting.',
      },
      {
        id: 'feed_it_properly', always: false, weight: 1.5,
        label: 'Put it on the ward\'s rations properly',
        desc: 'Written down, counted, and nobody has to hide it.',
        poles: ['temperance', 'mercy'], influence: 4,
        cost: null, reward: null,
        outcome: '🐕 It is on the ward book now, between the lamp oil and the wire. The crew stopped hiding the scraps.',
      },
      {
        id: 'no_rule', always: true, weight: 0.5,
        label: 'Say there is no rule and walk on',
        desc: 'It is a dog at a gate.',
        poles: [], influence: -1,
        cost: null, reward: null,
        outcome: '🌫 There is no rule. The crew keeps feeding it and nobody writes it down, which is how it was before you were asked.',
      },
    ],
  },

  {
    id: 'eh_arcade_water_tax',
    title: 'The Levy on the Arcade',
    district: 'Market Arcade',
    icon: '📜',
    sev: 'pressing',
    weight: 9,
    minInfluence: 25,
    maxInfluence: 100,
    wire: '…kkzzt… ward revenue short against the pump schedule … kkzzt…',
    brief: 'The pumps that keep the Lower Reclaim dry have to be paid for and the ward is short. A levy on the Arcade would cover it. The traders are the reason there is anything to keep dry, and they have already been taxed once this season by somebody wearing a different badge.',
    choices: [
      {
        id: 'levy_traders', always: false, weight: 1,
        label: 'Levy the Arcade',
        desc: 'The pumps run and the stalls put their prices up.',
        poles: ['ruthless', 'caution'], influence: -3,
        cost: null, reward: null,
        outcome: '📜 The pumps ran all season. Every price in the Arcade went up by the same amount and everybody knew why.',
      },
      {
        id: 'levy_everyone', always: false, weight: 1.5,
        label: 'Spread it across every household instead',
        desc: 'A little from everyone who lives where it is dry.',
        poles: ['temperance', 'honor'], influence: 2,
        cost: null, reward: null,
        outcome: '📜 Every household paid a little and nobody paid much. The complaints were quiet and constant, like the pumps.',
      },
      {
        id: 'fund_it_yourself', always: false, weight: 1,
        label: 'Fund the pump season yourself',
        desc: 'No levy, no prices, no ledger but yours.',
        poles: ['honor', 'mercy'], influence: 7,
        cost: { cinder: 1500 }, reward: null,
        outcome: '🔧 The pumps ran and nobody was taxed. The ward has written down who paid, which is the part you cannot spend.',
      },
      {
        id: 'run_pumps_half', always: false, weight: 1,
        label: 'Run the pumps at half and hope for a dry season',
        desc: 'Cheaper, and the Reclaim floods if the river turns.',
        poles: ['guile', 'ambition'], influence: -1,
        cost: null, reward: { chance: 0.4, cinder: 'small', card: null },
        outcome: '🌊 The pumps ran at half and the season was dry. The Reclaim never knew how close it came.',
      },
      {
        id: 'let_ward_decide', always: true, weight: 0.5,
        label: 'Send it back to the ward to solve',
        desc: 'They raised the question. Let them answer it.',
        poles: [], influence: -2,
        cost: null, reward: null,
        outcome: '🌫 The ward levied the Arcade anyway and used your name doing it. Nobody asked whether you had agreed.',
      },
    ],
  },

  {
    id: 'eh_salvage_claim',
    title: 'Two Crews, One Terminal',
    district: 'Old Terminal',
    icon: '⚒',
    sev: 'pressing',
    weight: 9,
    minInfluence: 0,
    maxInfluence: 100,
    wire: '…kkzzt… two claims filed on one concourse, both standing … kkzzt…',
    brief: 'Two salvage crews have filed on the same terminal concourse. One found it and marked it and went back for lamps. The other was already working the floor below and says a mark on a wall is not a claim. Both crews drink in the same room and neither will stand down.',
    choices: [
      {
        id: 'first_mark', always: false, weight: 1,
        label: 'Uphold the mark on the wall',
        desc: 'A claim is a claim or nothing on this map is.',
        poles: ['honor'], influence: 4,
        cost: null, reward: null,
        outcome: '⚒ The mark held and the concourse went to the crew that made it. The other crew has stopped marking anything.',
      },
      {
        id: 'possession', always: false, weight: 1,
        label: 'Give it to the crew already working it',
        desc: 'They are down there now and the lamps are lit.',
        poles: ['ruthless', 'ambition'], influence: -2,
        cost: null, reward: null,
        outcome: '⚒ The crew on the floor kept the concourse. Marks on walls mean less in the Heights than they did last week.',
      },
      {
        id: 'split_it', always: false, weight: 1.5,
        label: 'Split the concourse down the middle',
        desc: 'Two halves, one stairwell, and a line on a map.',
        poles: ['temperance'], influence: 3,
        cost: null, reward: null,
        outcome: '⚒ A line was drawn on the map and both crews worked either side of it, loudly. Nothing came to blows.',
      },
      {
        id: 'buy_the_claim', always: false, weight: 1,
        label: 'Buy the claim out and open it to everyone',
        desc: 'Both crews paid off and the concourse is common ground.',
        poles: ['mercy', 'ambition'], influence: 6,
        cost: { cinder: 1000 }, reward: null,
        outcome: '⚒ Both crews were paid and the concourse went on the common register. It was stripped bare inside a fortnight.',
      },
      {
        id: 'let_them_settle_it', always: true, weight: 0.5,
        label: 'Let them settle it themselves',
        desc: 'They drink in the same room. They will work it out.',
        poles: [], influence: -4,
        cost: null, reward: null,
        outcome: '🌫 They settled it in the room where they drink. One crew is short a hand and neither will say how.',
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

   Errors are things that would ship a broken or dishonest entry. Warnings are
   things that would ship a boring one — and a boring dilemma is the failure mode
   this corpus is actually at risk of, so they are worth reading.
   ──────────────────────────────────────────────────────────────────────────── */

const POLE_IDS = Object.freeze([
  'honor', 'guile', 'mercy', 'ruthless', 'valor', 'caution', 'ambition', 'temperance',
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

export function validateCorpus() {
  const errors = [];
  const warnings = [];
  try {
    const seenIds = Object.create(null);
    let totalChoices = 0;
    let payingChoices = 0;

    const prose = (where, s, fieldMax) => {
      if (typeof s !== 'string' || !s.length) { errors.push(where + ': missing text'); return; }
      if (s.indexOf('<') >= 0) errors.push(where + ': contains "<" — the corpus is escaped at render time and must never be the reason markup leaks');
      if (DIGIT_RE.test(s)) errors.push(where + ': contains a digit — effect numbers are derived by rewards.describeChoice(), never authored');
      if (s.indexOf('!') >= 0) errors.push(where + ': contains an exclamation mark — house voice is understatement');
      if (s.indexOf('--') >= 0) errors.push(where + ': contains "--" — use the spaced em dash');
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
      if (cs.length === DILEMMA_ECON.choicesMin) warnings.push(at + ': exactly the minimum choices — rollChoices() can never vary the set');
      if (!cs.some(c => c && c.always === true)) errors.push(at + ': no choice marked always:true — every offered set must contain one');

      const seenChoiceIds = Object.create(null);
      let anyPoles = false;
      let anyLoss = false;

      cs.forEach((c, ci) => {
        const cat = at + '.choices[' + ci + ']' + (c && c.id ? ' ' + c.id : '');
        if (!c || typeof c !== 'object') { errors.push(cat + ': not an object'); return; }
        totalChoices++;

        if (typeof c.id !== 'string' || !CHOICE_ID_RE.test(c.id)) errors.push(cat + ': id must match /^[a-z0-9_]+$/');
        else if (seenChoiceIds[c.id]) errors.push(cat + ': duplicate choice id within this dilemma'); else seenChoiceIds[c.id] = 1;

        prose(cat + '.label', c.label, LABEL_MAX);
        prose(cat + '.desc', c.desc, 0);
        prose(cat + '.outcome', c.outcome, 0);
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
        }

        if (DILEMMA_ECON.choiceWeights.indexOf(c.weight) < 0) errors.push(cat + ': weight must be one of ' + DILEMMA_ECON.choiceWeights.join('/'));

        if (!Number.isInteger(c.influence)) errors.push(cat + ': influence must be an integer');
        else {
          if (Math.abs(c.influence) > DILEMMA_ECON.influenceMax) errors.push(cat + ': |influence| above influenceMax');
          if (c.influence < 0) anyLoss = true;
        }

        if (c.cost != null) {
          if (typeof c.cost !== 'object') errors.push(cat + '.cost: must be an object or null');
          else if (!(Number.isInteger(c.cost.cinder) && c.cost.cinder > 0)) errors.push(cat + '.cost.cinder: must be a positive integer');
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
      });

      /* A dilemma where nothing can go wrong is scenery, and a dilemma no
         companion can have an opinion about is a menu. Both ship fine and both
         are the failure mode this corpus exists to avoid, so they warn loudly. */
      if (!anyLoss) warnings.push(at + ': no choice loses standing — a decision with no downside is not a dilemma');
      if (!anyPoles) warnings.push(at + ': no choice declares a pole — no unit in any deck can react to this');
    });

    /* 🚫 THE VENDING-MACHINE GUARD, and it is an ERROR rather than a warning.
       The BRIEF says "a dilemma that always pays is a vending machine", and the
       admin has already acted on that instinct once in this codebase:
       `index.html:64415-64421` zeroes every match Cinder reward with the note
       "it will devalue our money". This is the mechanical form of the same
       instruction, checked over the WHOLE corpus rather than per entry, because
       the thing a player experiences is the rate across a session. */
    if (totalChoices > 0) {
      const ratio = payingChoices / totalChoices;
      if (ratio > DILEMMA_ECON.maxPayingRatio) {
        errors.push('vending-machine guard: ' + payingChoices + ' of ' + totalChoices +
          ' choices carry a reward (' + ratio.toFixed(3) + '), above maxPayingRatio ' + DILEMMA_ECON.maxPayingRatio);
      }
    }

    if (DILEMMAS.length < 12) {
      errors.push('corpus has only ' + DILEMMAS.length + ' dilemmas — below twelve the recentDepth block plus the repeat cooldown starves the pool in one session');
    }

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

/* Local mirror of LQ_POLE_AXIS (`index.html:72975`). It is duplicated here and
   not imported for the reason the whole feature exists: `LQ_POLE_AXIS` is a
   top-level `const` in index.html, a lexical global that an ES module cannot
   see (CLAUDE.md, the globals trap). engine.js gets the real one through the
   bridge; this copy exists ONLY so validateCorpus can catch a same-axis pole
   pair without data.js growing an import or a window reference. If the eight
   poles ever change in index.html, this list is one of the two places to fix. */
function axisOf(pole) {
  switch (pole) {
    case 'honor': case 'guile': return 'honor';
    case 'mercy': case 'ruthless': return 'mercy';
    case 'valor': case 'caution': return 'valor';
    case 'ambition': case 'temperance': return 'ambition';
    default: return null;
  }
}
