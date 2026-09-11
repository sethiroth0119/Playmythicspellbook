/* 🛡 ONE COMMAND — `npm run check`.
   ═══════════════════════════════════════════════════════════
   Asked for as: "how do we get coverage for this to protect the players
   accounts so people stuff stop vanishing and things stop breaking."

   THE COVERAGE ALREADY EXISTED. This repo has ~350 scripts under .gauntlet/
   plus a dozen _*_smoke.mjs files, and between them they already cover the
   things that have actually gone wrong: paid vault capacity, account switching,
   save payload round-trips, the operations wiring, the economy. What it did not
   have was a way to RUN them. There is no test script in package.json, so
   "did I break something" meant remembering which of 350 files to run — and the
   honest answer is that nobody remembers, which is why the Trash Crusher shipped
   unbuyable and the Genetics Lab has been unbuyable for months.
   A gate nobody runs is a comment.

   🔴 WHY A BASELINE AND NOT A GREEN BOARD.
   Two suites have KNOWN failures that are decisions, not breakage — the economy
   gauntlet's three (a dead gate, a fixture, a promoted-id gen) and _plague_smoke's one.
   A runner that is permanently red teaches everybody to ignore it, which is the
   same uselessness as having no runner at all. So each suite records the number
   of failures it is EXPECTED to have, and this goes red only when a suite gets
   WORSE than its baseline — or better, which is also worth knowing, because a
   baseline that is too high hides the next regression behind it.
   Lower a baseline in the same commit that fixes the failure. Never raise one
   to make a build pass; that is the failure mode every gate in here warns about.

   Usage:
     node _checkall.mjs            fast gates only (~seconds) — use before every commit
     node _checkall.mjs --full     everything, including the economy gauntlet (~10 min)
     node _checkall.mjs --list     print the suites and their baselines
*/
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

/* `expect` is the number of individual check FAILURES this suite is known to
   report today. `exit` is whether a non-zero exit code alone means broken —
   false for suites that exit non-zero purely because of their baseline. */
const SUITES = [
  // ── the account-protection tier. These are the ones that answer "my stuff
  //    vanished": every one of them exists because something really did.
  { id: 'accountowner',   cmd: ['node', '_accountowner_smoke.mjs'],  expect: 0, minPasses: 10, tier: 'fast',
    why: 'two players on one computer, with a RELOAD between them, are not one account' },
  { id: 'accountswitch', cmd: ['node', '_accountswitch_smoke.mjs'], expect: 0, minPasses: 15, tier: 'fast',
    why: 'account A must not follow the device into account B' },
  { id: 'vault',         cmd: ['node', '_vault_smoke.mjs'],         expect: 0, minPasses: 27, tier: 'fast',
    why: 'paid vault capacity can never shrink' },
  { id: 'savepayload',   cmd: ['node', '.gauntlet/save-payload-check.mjs'], expect: 0, minPasses: 15, tier: 'fast',
    why: 'a save round-trips, and a module-less build never writes null over player data' },
  /* Under a second (measured 1.0 s, 88 checks). It seeds its own deterministic
     world and drives its own CLI in child processes — no browser, no network,
     nothing written outside tmpdir. It was NOT registered here for its first 47
     assertions, so `npm run check` ran none of them and the proof existed only
     while a human was typing the command by hand: the undo path the live-data
     migration pieces run before they write to a paid game was the one thing in
     the tree with no gate on it. Reopening the hole it guards (letting a source
     that cannot yield a structure read as empty again) turns 27 of these red —
     measured, by running the selftest against a copy with the resolve pass
     removed. Its section 9 also drives six named bypasses through the real CLI,
     each runnable alone as `forge-export.mjs mutant <name>`. */
  { id: 'forgeexport',   cmd: ['node', '.gauntlet/forge-export.mjs', 'selftest'], expect: 0, minPasses: 58, tier: 'fast',
    why: 'the Forge/deck export-restore-diff undo path: the five structures round-trip byte-for-byte through memory and through a localStorage dump, a restore never moves the wallet or re-assigns a container, an absent field is skipped rather than blanked — and an UNREADABLE one is refused loudly instead of read as empty, which used to export 3-of-5 at exit 0 and let a restore rewrite hg_profile from 8 keys to 3 with gems 4242 and sovereigns 7 inside the 5 it deleted. The refusal sits where a structure is RESOLVED, not at a string parse, because four documented shapes (payload/raw/snapshot with the profile half a truncated string, and hg_customCards="null") walked past the parse-only version; and a salvage export can no longer be laundered clean by re-exporting it' },
  /* ~35 s — it boots public/index.html in headless chromium, because the Forge
     editor's save path can only be proved against a real DOM (bindCardEditor
     RE-PARENTS the markup). Every off-origin request is aborted, so it never
     touches Supabase. `node _forgeids_smoke.mjs --selftest` mutates the editor
     in memory and shows the suite failing, which is how you know it can, and
     `--mutate=NAME` (see `--list`) runs the gate itself under one named mutant
     so its FAIL lines and non-zero exit are the gate's own. Two critics broke
     the previous revision by construction — a renamed id that was only ever
     read through a helper, and a dropped field no pool card stored — so the
     read forms are now CLASSIFIED out of the source instead of listed (436 ids
     over 17 forms, not 356 over 3), coverage is per card type from an
     instrumented copy of the real function rather than a union, and the
     perturbation moves every input kind off its own derived fallback. */
  { id: 'forgeids',      cmd: ['node', '_forgeids_smoke.mjs'],      expect: 0, minPasses: 25, tier: 'fast',
    why: 'a Forge card saved with no user input comes back identical — a field missing from the editor rewrites the live card to a literal and cloud-pushes it' },
  /* ~55 s, three headless cycles. forgeids proves the GENERAL contract over 153
     shipped cards; it cannot prove a specific defect is gone, because no shipped
     card carries the value the defect ate. This authors those cards. Each check
     is one command, and FORGE_PROOF_INDEX=<a pre-change index.html> runs the
     same command against the build the defects were found in and watches all
     three go red — a check that cannot fail is a comment. */
  { id: 'forgesave',     cmd: ['node', '_forgesave_proof.mjs'],     expect: 0, minPasses: 10, tier: 'fast',
    why: 'the three card-definition defects the contract net found: a two-element spell keeps both elements, a vanishUnit gate keeps its minCost, and a value the editor cannot re-render (a void-only Card Filter, a hand-authored onResurrect) is not overwritten by the editor default on the next save' },
  /* ⚠ THE DRIVER EVERY FORGE SCREENSHOT PIECE IMPORTS, and until now it was
     registered NOWHERE — so `npm run check` never ran it and an index.html edit
     could invalidate it silently, which is the one thing it exists to prevent
     (renderForge's admin gate bounces a signed-out driver to the TITLE screen
     without erroring, and the house driver photographed that and reported a
     pass). ~9 s: it boots public/index.html in headless chromium, aborts every
     off-origin request, and asserts on counts read out of the real DOM — 289
     .editor-field in exactly ONE .card-editor, 86 under #fx-onplay, 0 → 71
     really visible after forceOpen. It also runs its own MUTANTS: forceOpen
     with its single `el.open = true;` deleted must FAIL the visibility clause,
     and a second editor left in the document must be REFUSED by name — as must
     a DUPLICATE ID (an empty <div id="fx-onplay"> in <body> leaves every count
     green and makes getElementById read 0 .editor-field against a truth of 86)
     and seven empty <details class="fx-sec"> (.fx-sec 5 → 8, .fx-sub 13 → 17
     with no field count moving at all).
     29 passes measured (23 before the paint gate). The floor is 26 rather than
     29 because the page clauses are the ones an index.html edit legitimately
     reshapes; `expect: 0` still reddens the suite on any single FAIL.
     ⚠ AND SINCE 2026-09-08 IT ALSO ASKS WHETHER THE EDITOR IS PAINTED, not
       merely present. Two critics got confident wrong numbers past the count
       clauses above: `body{opacity:0}` left forceOpen reporting shown=71 of 86
       "really visible" on a frame whose screenshot was 9,243 bytes against
       497,843, and an opaque full-viewport overlay did the same while
       elementFromPoint said ZERO of the sampled fields were on top. The gate
       now samples 16 points over the editor plus the fields it CLAIMS are
       visible, and asserts a PNG byte floor (0.02 B/px against a clean 0.24-
       0.41 and a blank 0.0054). It found a real one on its first run: after the
       admin gate bounces a driver to the title screen this app opens
       #narr-overlay, z-index 2147483400, an opaque full-viewport iframe, and
       every DOM count under it is clean. Each bypass ships as a named mutant —
       `--mutant=opacity-zero|overlay|shadow-clone|no-open` — runnable on its
       own, exit 1 when caught.
     The A/B half (git worktrees, ~4 min) is the 'forgeab' suite below, --full. */
  { id: 'forgeharness',  cmd: ['node', '.gauntlet/_forge-harness.mjs', '--no-ab'], expect: 0, minPasses: 26, tier: 'fast',
    why: 'the Forge driver harness still reaches a real card editor AND that editor is really painted — the admin gate, exactly ONE editor with all 289 .editor-field inside it, showToast restored, a visibility check its own mutant kills, elementFromPoint and a screenshot byte floor that kill body{opacity:0} and an opaque overlay, and a git verb that would move the main tree refused' },

  /* ~22 s. The effect gate: for every one of the 118 ONPLAY_TYPES ids, driven
     through the REAL editor with .value + input + change, the fields the ENGINE
     reads for that effect are visible, nothing else gated is, nothing leaves the
     DOM, no drawer is left open on nothing and no nav chip points at a hidden
     section. 🔴 The requirement is computed by .gauntlet/_fx-engine-needs.mjs,
     which attributes every `eff.<key>` read in _applyOnPlayOneRaw to the
     `eff.type === …` branch it sits in — NOT from ONPLAY_TYPES[].needs, which
     is what the gate itself reads: the first cut of this driver scored the gate
     against its own input and reported zero failures while fifteen effects hid a
     field the engine reads. Clause G ships the mutant that proves it can still
     fail: one line of FX_GATE_NEEDS_PATCH deleted in a scratch copy must hide
     Intimidate's Chance box. */
  { id: 'fxgate',        cmd: ['node', '.gauntlet/drive-fx-gate.mjs'], expect: 0, minPasses: 3, tier: 'fast',
    why: 'the on-play editor shows exactly the fields the chosen effect uses — and hides them with a class instead of removing them, because a field missing from the DOM makes num() write its literal fallback over the live card' },

  // ── the "it shipped broken and nobody noticed" tier.
  { id: 'ops',           cmd: ['node', '_opscheck.mjs'],            expect: 0, minPasses: 12, tier: 'fast',
    why: 'every priced operation is actually buyable' },
  { id: 'adminonly',     cmd: ['node', '_adminonly_smoke.mjs'],     expect: 0, minPasses: 20, tier: 'fast',
    why: 'admin-grant-only cards cannot reach a player by any path' },
  { id: 'cardcraft',     cmd: ['node', '_cardcraft_smoke.mjs'],     expect: 0, minPasses: 20, tier: 'fast',
    why: 'card crafting is deleted outright — no Card Forge, no craft or scrap pills — and units show their level' },
  { id: 'nodeowners',    cmd: ['node', '_nodeowners_smoke.mjs'],    expect: 0, minPasses: 30, tier: 'fast',
    why: 'a node list we could not read never renders as an unowned world' },
  { id: 'worldmap',      cmd: ['node', '_worldmap_smoke.mjs'],      expect: 0, minPasses: 48, tier: 'fast',
    why: 'a fallback map can never be published over the shared world' },
  { id: 'citybuilder',   cmd: ['node', '_citybuilder_smoke.mjs'],   expect: 0, minPasses: 25, tier: 'fast',
    why: 'street lights keep their turn, residents take the open jobs, the restaurant eats and pays, saves carry vitals' },
  { id: 'convoy',        cmd: ['node', '_convoy_smoke.mjs'],        expect: 0, minPasses: 20, tier: 'fast',
    why: 'supply crates ride convoys, land in the pantry once, and are never paid as food' },
  { id: 'progression',   cmd: ['node', '_progression_smoke.mjs'],   expect: 0, minPasses: 25, tier: 'fast',
    why: 'city-level gates lock and fail open, the point bank pays after milestones, the milestone list keeps its scroll' },
  { id: 'ritualart',     cmd: ['node', '_ritualart_smoke.mjs'],     expect: 0, minPasses: 14, tier: 'fast',
    why: 'fusion/archon modals show card art and let the player pick among qualifying materials; the board paints the hand-made grass/water/street hex tiles' },
  { id: 'cardfilter',    cmd: ['node', '_cardfilter_smoke.mjs'],    expect: 0, minPasses: 10, tier: 'fast',
    why: 'the search rule on the picker bar (any Unit costing ≤ N) is obeyed — an untouched shared Card Filter no longer overrides it' },
  { id: 'activatefx',    cmd: ['node', '_activatefx_smoke.mjs'],    expect: 0, minPasses: 16, tier: 'fast',
    why: 'a card activation raises its art centre-screen for 2 s; a chain raises one splash wearing the chain size; hidden cards never do' },
  { id: 'heroes',        cmd: ['node', '_heroes_smoke.mjs'],        expect: 0, minPasses: 12, tier: 'fast',
    why: 'custom heroes always win over the emoji starter mockups — by id, then by name — and their art reaches every screen' },
  { id: 'facedown',      cmd: ['node', '_facedown_smoke.mjs'],      expect: 0, minPasses: 14, tier: 'fast',
    why: 'a set card is secret from the other player and the AI: no name, no HP bar, no stats in AI scoring; it wears the card back and glows' },
  { id: 'handset',       cmd: ['node', '_handset_smoke.mjs'],       expect: 0, minPasses: 12, tier: 'fast',
    why: 'the bell is a phone: a handset with Notifications, Chat and Broadcast as apps, a real clock and battery, and every seam it reads' },
  { id: 'citymove',      cmd: ['node', '_citymove_smoke.mjs'],      expect: 0, minPasses: 14, tier: 'fast',
    why: 'a player can move a standing building to any tile it could have been built on, keeping its name and staff; one named player never sees the button' },
  { id: 'skilltree',     cmd: ['node', '_skilltree_smoke.mjs'],     expect: 0, minPasses: 30, tier: 'fast',
    why: 'the constellation is nine rings deep with four 10-SP Learned Arts per class, the pool obeys element / hero / faction pins, and the SELECTED badge cannot stretch into a gold capsule' },
  { id: 'nodesales',     cmd: ['node', '_nodesales_smoke.mjs'],    expect: 0, minPasses: 22, tier: 'fast',
    why: 'nodes for sale with Hidn Studios escrow (sql/118): owner-only listing, the map sign, Cinder + USD + includes + escrow note, a one-transaction purchase, and an owner starting a second city on a second node' },
  { id: 'civmodels',     cmd: ['node', '_civmodels_smoke.mjs'],    expect: 0, minPasses: 24, tier: 'fast',
    why: 'the city builder walkers and standing crowd wear the four packed Meshy characters at the measured mock-up height, walking through their own clips; the files stay under 600 KB with one skin and one clip each' },
  { id: 'walkerkeys',    cmd: ['node', '_walkerkeys_smoke.mjs'],   expect: 0, minPasses: 18, tier: 'fast',
    why: 'the Containment Lab and Hospital walker never latches a key: physical-code tracking, interact / focus / hidden-tab / dialog release, a lost keyup expires after auto-repeat, the stick lets go on any cancel' },
  { id: 'pwreset',       cmd: ['node', '_pwreset_smoke.mjs'],      expect: 0, minPasses: 16, tier: 'fast',
    why: 'forgot password answers as well as asks: the mail carries an explicit redirectTo back into the game, PASSWORD_RECOVERY (or the URL marker) opens a set-a-new-password step, the spent token is scrubbed from the address bar, a dead link says how to get a new one, and the screens name Hidn Studios as the sender' },
  { id: 'campaigns',     cmd: ['node', '_campaigns_smoke.mjs'],   expect: 0, minPasses: 28, tier: 'fast',
    why: 'node campaigns (relief drives, leaderboard, M airdrops) reach the app ONLY through MythicBridge.nodeCampaigns. Pins the correction the handoff needed: it said to rename tw-act-attack to Do Campaign, but in THIS tree that id is City Trade and the raid moved to tw-act-raid — following it literally would have deleted a shipped feature, so Do Campaign is its own button and all three must coexist' },
  { id: 'awaynet',       cmd: ['node', '_awaynet_smoke.mjs'],     expect: 0, minPasses: 16, tier: 'fast',
    why: 'the away report printed a resource the city both makes and eats TWICE — water +305 produced and -305 consumed — which reads as a bug in the numbers when it is really a city consuming everything it makes. Both figures were always real ledger writes; a two-sided resource is now ONE net line with the gross underneath, and one-sided resources are untouched' },
  { id: 'citygrow',      cmd: ['node', '_citygrow_smoke.mjs'],    expect: 0, minPasses: 18, tier: 'fast',
    why: 'a city could be frozen at zero arrivals with empty homes and an open growth gate: immigrationBlock refuses below an attraction score of 30 and says why, but pull zeroed everything below 40 — so 30-40 was a silent dead zone. The two floors are now the same number and the top of the curve is unchanged. Also pins that the cap cause stops telling players to build housing they already have, and the milestone toast is baselined at load so a returning player is never congratulated for the town they had' },
  { id: 'corpcities',    cmd: ['node', '_corpcities_smoke.mjs'], expect: 0, minPasses: 13, tier: 'fast',
    why: 'a corporation member city list was every city that member had ever had. Measured on the live table before the fix: 68 city_profiles rows across 23 owners, and ONE MEMBER HAD ELEVEN — 22 of the 68 were node_id local-city (the pre-claim LOCAL save, which is named, populated and freshly updated exactly like any other row so its id is the only thing that tells it apart), 18 were on a node the member no longer owns and left behind when they moved, and only 28 were real. Nothing cleaned up after a move and the panel listed all three kinds, so a player saw eleven copies of their own city at eleven populations and eleven economy days with no way to tell which was current. The rule is deliberately not a heuristic and not a date window: a corporation city is a city standing on a node that member STILL OWNS, keyed on owner AND node so a member is never credited with somebody else node. A failed ownership read filters NOTHING and shows everything, which is the behaviour the panel already had — the same rule syncBuildings states for its own reconcile after a bad read closed 838 businesses on a live city' },
  { id: 'payreturn',     cmd: ['node', '_payreturn_smoke.mjs'],  expect: 0, minPasses: 14, tier: 'fast',
    why: 'buying development points "dumps you right back at the start - the game re-starts, so you have to go through the whole Open bank / City Hall / PRNs / City to get back". The game really does restart and no code was misbehaving: a card purchase is a Stripe REDIRECT, location.href leaves the site and Stripe returns the player to a COLD PAGE LOAD, which opens where a cold page load opens. Nobody had written down where they came from. Both redirecting flows (development points and paid licences) now drop a crumb BEFORE navigating — after that line the page is gone — and read it back on the confirmed return. It expires after 30 minutes and is consumed once, so a later cold load cannot be hijacked by a stale one, and it is localStorage rather than sessionStorage because a player who pays on a phone can come back in a different tab. The suite also caught a real defect in the fix itself: the freshness test used v.at bitwise-or-zero, and a bitwise operator truncates a ~1.75e12 millisecond timestamp to 32 bits, so every crumb read as ancient and the restore never fired' },
  { id: 'citystock',     cmd: ['node', '_citystock_smoke.mjs'],  expect: 0, minPasses: 18, tier: 'fast',
    why: 'two reports, one cause: reagents and remedies "are not being shown through any of the game" and "there is no place in the vault for them". Both true, neither a ledger bug. The six CITY_STOCK goods (rations, components, reagents, goods, remedies, planks) are the CITY inventory, not the player salvage ledger: produced, consumed, saved, and held against a WAREHOUSE ceiling, which is what makes "without storage, production stops when full" a real constraint. They are deliberately absent from Profile.salvage so the Ops Vault cannot list them and never could. What was missing is that NOTHING SHOWED THE SHELF — the only numbers anywhere were a have-N beside one input inside a producer own panel and a build-cost tooltip, so a player who filled a warehouse with reagents had no view of them and concluded the resource was untracked. The Warehouse inspect panel now prints all six against the ceiling its own levels set, with a neutral note naming why the vault does not carry them. NOT a new rail launcher: node-city own note says a sixteenth would have to be measured for a third row, and this spends none of that' },
  { id: 'openfour',      cmd: ['node', '_openfour_smoke.mjs'],   expect: 0, minPasses: 22, tier: 'fast',
    why: 'four open reports, four different shapes. (1) THE CAMP WORKSHOP CHARGED FOR A LEVEL IT COULD NOT GIVE: one action has TWO implementations and only campFortify() guarded. The workshop button spent the resources FIRST and clamped AFTERWARDS, so at CAMP_DEFENSE_MAX it took the metal and supplies and moved nothing — reported by a player who paid for level 10 three times. It refuses before spending now, and the button is disabled and relabelled. (2) THE REFERRAL REDEEM BOX RAN THE OPPOSITE WAY TO HOW IT READ: it records who invited YOU, once and irreversibly, but sat under the player own referral stats and looked like a way to credit somebody they had invited. Half the report — that referring others was then blocked — did NOT happen and the fix does not pretend it did; their code kept working throughout. The box now names its direction and its irreversibility BEFORE it is used. (3) TWO OPERATIONS SIDEBAR ROWS BOTH READ Haulage Board. The destination is correct and unchanged — shell.jsx records why the crusher posts to the shared board rather than owning a private shipping panel, so there is no missing mini-game — but two rows with one name read as a duplicate. (4) THE CARD HUNT RETURNED THE SAME CARD 9 OF 11 TIMES: the roll was already a fair flat pick and the odds are NOT touched; the pool is small and invisible and each hunt is twelve real hours, so repeats read as a broken generator. It now skips the previous card when there is anything else to give, and explains a one-card pool instead of looking broken' },
  { id: 'athenacast',    cmd: ['node', '_athenacast_smoke.mjs'], expect: 0, minPasses: 32, tier: 'fast',
    why: 'the Athena player hub dressed only the LOCAL player. map.player.model set your own avatar; every OTHER person in the room was makeFigure() drawing a hardcoded blue cylinder with a sphere on top — so an author could build a hub, set a character, walk in and find the place full of capsules. A hub mounts in first person, where your own model is deliberately not drawn, so an fps hub was capsules and nothing else: the character was real and nobody could see anyone wearing it. Adds a CAST of characters a player may choose between, a choice that is ACCOUNT-WIDE and reconciled per map (an id a map does not offer falls back to that author default, never to nothing), the choice riding the position packet that already existed rather than a second channel, and peers drawn through the same world asset cache so two people in one character share a single loaded template. The capsule survives as the FALLBACK on purpose: a peer whose model is still downloading, unavailable on this map, or 404 must still be visible, because someone you can hear and walk into but cannot see is worse than a plain shape. Pins the normalizer, the per-map reconciliation both ways, disposal of the second scene group and its mixer, and that the topbar-equivalent - the picker - is not drawn for a map offering one character' },
  { id: 'lobby',         cmd: ['node', '_lobby_smoke.mjs'],      expect: 0, minPasses: 10, tier: 'fast',
    why: 'v121v115 (owner): no online / searching counts on the Play Online tile for anyone — the live lobby numbers paint in User Management instead, re-painted in place on every presence tick.' },
  { id: 'grantpassive',  cmd: ['node', '_grantpassive_smoke.mjs'], expect: 0, minPasses: 46, tier: 'fast',
    why: 'v121v114 (owner): the Grant Passive effect type — a passive to this unit / your units / the units, fusions and archons called this turn, for N turns or for good (statusEffects grantPassive read by hasPassive; eot grants cleared at end of turn; pending turn grants reach units called later and clear summoning sickness for a granted Speed). And the counter fixes behind "Spell counters is not working": one slug (plural s dropped) on the token, the field-ability cost, both editor save sites and the module; Add/Remove Counters take a counter NAME. Also the haul class-model fallback, the 45k-tri semi and its wrecked pack.' },
  { id: 'tips',          cmd: ['node', '_tips_smoke.mjs'],       expect: 0, minPasses: 38, tier: 'fast',
    why: 'v121v112 (owner): tooltips on every menu button, everything in camp, and every resource icon. One engine (src/hubui/tips.js, classic script) resolves data-tip → title → a selector table → the resource icon under the pointer (caret-from-point, grapheme-safe, icon→name from the game tables); hover, long-press and focus; parked native titles. Hub tiles, MD menu items, phone apps and camp HUD chips carry data-tip. Runs the shipped engine on a fake DOM.' },
  { id: 'signals',       cmd: ['node', '_signals_smoke.mjs'],    expect: 0, minPasses: 16, tier: 'fast',
    why: 'v121v111 (owner): blinkers lit the wrong side for the rig and traffic (every vehicle is turned 180°, so local −x is the right side); the city builder panned left on D and right on A (the right vector was forward×up negated); the haul drives the CATALOGUE truck (the semi for freight) over a row upload, auto-orients any model from its mesh (long axis to Z, cab to +Z), fits it bigger, and stacks no containers on a truck with no deck; traffic is never snapped into its lead or shoved off the road by the frame. Runs haulAutoOrient on four synthetic orientations and the pan vector for real.' },
  { id: 'semi',          cmd: ['node', '_semi_smoke.mjs'],       expect: 0, minPasses: 38, tier: 'fast',
    why: 'v121v110: the white flatbed semi GLB on every freight rig (Truck Yard card + the Highway Haul run, fitted over the procedural rig with the collision box and chase camera following its length), the two shipping-container GLBs laid on the deck the mesh reveals while the old shrink-and-tilt cargo animation still drives them, and raiders that treat traffic as vehicles: brake behind a lead car, swing round it, give up after six seconds held off (beaten). Pins the three packed files, their allow-list lines, and runs raiderLead/raiderSteer/haulFit/haulDeckOf for real.' },
  { id: 'candles',       cmd: ['node', '_candles_smoke.mjs'],    expect: 0, minPasses: 20, tier: 'fast',
    why: 'v121v109: the Crash/Exchange focus chart is candlesticks (the shared tape bucketed into open/high/low/close per range, green up / red down) with a delegated hover tooltip showing the prices, the line only for an asset with fewer than two candles; Highway Haul: a correct exit leaves the highway — every segment is re-seeded with a new palette, a merge overlay names the new road and the rig is eased from the ramp into the slow lane with the rails held off — a wrong exit still clamps and reroutes.' },
  { id: 'tracker',       cmd: ['node', '_tracker_smoke.mjs'],    expect: 0, minPasses: 19, tier: 'fast',
    why: 'v121v108, the open tracker reports the owner approved: a starved firm (0 cash, no revenue today) can borrow working capital — creditLimit floor of five days operating cost for a firm with no revenue history and autoBorrow at zero (bug-mtsq62mg); the primary bottleneck names free / working-age / employed / residents when workers are the limit (bug-mtrmi2e5); qty() prints under 0.01 instead of 1e-7 (bug-mtu13pzm); the Stadium readiness table lists have / need per concession line (bug-mtuasm4d).' },
  { id: 'cxtape',        cmd: ['node', '_cxtape_smoke.mjs'],     expect: 0, minPasses: 22, tier: 'fast',
    why: 'v121v107: the Crash/Exchange draws the SHARED price tape (sql/131 cx_price_history, fed by a trigger on cx_prices; cx_history / cx_stats / cx_stats_all) — every player sees the same chart, the toolbar shows 1H high/low, the range high/low, the all-time high with its date and low, table rows measure 24h change against the shared price 24h ago and spark from the shared 24h tape; fetches cache 60 s with an in-flight guard and the local tape or synthetic curve only fills in until the shared history lands.' },
  { id: 'realsales',     cmd: ['node', '_realsales_smoke.mjs'],  expect: 0, minPasses: 14, tier: 'fast',
    why: 'v121v106: the Digital Valuation modal reads the real player-sale feed (sql/115 luni_price_history card) — lists the real sales with Last sold, draws the chart from real sale points when two or more are in view, takes deltas from them, and the Suggested Cinder Value becomes a Market value (70% real average + 30% model). Before, it read only local hourly snapshots and the buyer own local log, so a 300,000 Cinder player sale showed as No recorded sales yet.' },
  { id: 'batch1',        cmd: ['node', '_batch1_smoke.mjs'],     expect: 0, minPasses: 30, tier: 'fast',
    why: 'v121v105, the approved batch: economyTick charges inputs only for buildings that run and shares a scarce city stock in proportion (0.9 x shelf / last tick demand) so reagents no longer read 0 while produced; the Production Chain feeds list prints every building; Foundation Reserve nodes can be released to free a licence slot; rations, planks and remedies are game RESOURCES and the Warehouse card sends a pile to the stash; founders can shut a corporation down (sql/130 corp_dissolve, refuses with money or items held); the roguelite map is the 3D Ascent map only (Classic map button and opt-outs removed).' },
  { id: 'cohome',        cmd: ['node', '_cohome_smoke.mjs'],     expect: 0, minPasses: 18, tier: 'fast',
    why: 'v121v104: the Construction Co. can always be placed in the owner own city even while it stands in a client city (the one site MOVES; the other building stays), and only a mayor may site it in someone else city (unchanged). Every other operation keeps the one-plot rule. A player whose Co. a mayor had put in a client city was locked out of placing it at home with sited in another city.' },
  { id: 'farmsky',       cmd: ['node', '_farmsky_smoke.mjs'],    expect: 0, minPasses: 28, tier: 'fast',
    why: 'v121v103, Homestead: paint() diffs the ledger, HUD and panel markup and writes only what changed (the page-refresh flash); node-city publishes its live weather to localStorage and the farm bridge reads it plus the city clock (America/New_York), so the farm sky and weather are the city builder sky and weather and a click can no longer flip the weather; the seeded roll is only the fallback for a city that never ran.' },
  { id: 'farmfeed',      cmd: ['node', '_farmfeed_smoke.mjs'],   expect: 0, minPasses: 24, tier: 'fast',
    why: 'v121v102, the owner afternoon list: the Homestead tab bar is at the top; Animal Feed is ground from corn, bread and fruit after the Feed Mill stands; every farm building costs more (resources x2, Cinder x1.5); a failed Reserve contribution refunds through the unclamped _refundRes; the vault write selects the row it touched so a 0-row update fails and the deposit unwinds; the phone leaderboard says where you stand.' },
  { id: 'ownerlist',     cmd: ['node', '_ownerlist_smoke.mjs'],  expect: 0, minPasses: 40, tier: 'fast',
    why: 'v121v101, the owner list of 2026-09-10: renderFarm writes #app itself (the Feed Operation black screen); Construction Co. is the cheapest op at 20,000 cinder or 10 Aza, the Construction License is free and open and owning a Co. holds it, a mayor Co. adds build gangs and speed in a client city; a once-per-account 40,000 cinder starter loan in the Bank of Ethos; the Reconstruction labour pool is every resident and the board says no city built there yet; sql/129 lists cities with 0 free; PRN anchors ring a city with the viewer own nodes only; registry cards line up.' },
  { id: 'sweep3',        cmd: ['node', '_sweep3_smoke.mjs'],     expect: 0, minPasses: 40, tier: 'fast',
    why: 'v121v100, seven tracker fixes: cityGetResMany/cityVaultState/cityVaultMove/cityResourceNeeds answer for the OWNER in a managed city (bug-mtvg7q4f, critical); toasts are pointer-events none, float at the top over the city builder, and the held-Cinder line toasts once per half hour (bug-mtvg7l39); the campaign deck pick sets run.heroId from the deck (bug-mtvgyt59); a dev-points checkout return reopens the city and the Progression tree (bug-mtty05g7); the services row counts standing shops and stock so two empty grocers read as empty shelves not absent shops (bug-mtvgfy5s); sql/128 refuses a referrer newer than the redeemer before the one redemption is spent (bug-mtrm50hn); members working in another member corp city read as such (bug-mtqasoy6).' },
  { id: 'shopwhy',       cmd: ['node', '_shopwhy_smoke.mjs'],    expect: 0, minPasses: 28, tier: 'fast',
    why: 'v121v99, bug-mtvdb20t + bug-mtvdpfce: two Zone Demand descriptors named a problem and not its parts. Services falling short now lists the short basket categories worst-first with the shop that sells each and one fix sentence (the tick hands the pipeline the economy per-category satisfaction joined to the basket and INDUSTRIES). Almost Nobody Is Shopping Yet prints residents, savings, employed and wages last round and the one lever those point at (jobs, wages, residents, rents), and the commercial tab shows the four as stat cells; fold() used to drop stat.' },
  { id: 'pullrow',       cmd: ['node', '_pullrow_smoke.mjs'],    expect: 0, minPasses: 20, tier: 'fast',
    why: 'v121v98, bug-mtvblyi9: the Zone Demand residential cause line said the Survey tab shows which of wages, rents, jobs and services is worst, and the only Survey tab is the deposit survey. The pipeline now measures the three draws it already scores (work, rents against wages, services) over every household that looked, names the weakest in the sentence with its percentage and the fix, and the panel prints the three under the meter with the weakest in red.' },
  { id: 'fishing2',      cmd: ['node', '_fishing2_smoke.mjs'],   expect: 0, minPasses: 50, tier: 'fast',
    why: 'v121v97, Woods Fishing round 2 from WOODS_FISHING_HANDOFF, written into the live trip that already existed because the branch never reached the repo. A threat meter rises per cast (biome, weather and the boat sonar scale it) and decays while the line is idle; at 100 a shark or anomaly surfaces and bites the hull on a timer, armour soaking a share; the player harpoons it (ammo per trip, 15-30% plus 2x fishing level, a Harpoon Mount adds more), flees (odds off speed and stability) or fights it in the card battle the trip already routes through, and a won fight pays Leviathan Parts on the way back; hull 0 is a wreck that docks the boat damaged. Boats carry armour, sonar and stability by class, gain XP per trip, expedition and kill, level every 100, and take refits in slots that open at L2/L4/L6 through a Docks refit modal. Crew rank by exp, are hurt by bad expeditions and bites, and at health 0 roll to survive (70%, veterans 90%) - a death is removed from the roster and logged. Weather and the clock are rolled per trip and feed luck and swell; the hold is capacity x 12 and ends the trip when full. A weekly tournament board posts each catch weight through fishing_record_submit and reads fishing_records_top (sql/127, applied: one record per angler per week, clamped to 120 kg server-side, read-only to the client). The suite lifts the whole block into a vm with a stubbed engine and runs a scripted trip through every one of those paths' },
  { id: 'fishing1',      cmd: ['node', '_fishing1_smoke.mjs'],   expect: 0, minPasses: 48, tier: 'fast',
    why: 'v121v96. (1) Highway Haul: Drive it now closes the Haulage Board first and refuses without a FREIGHT truck bought from Prince Portfolios - the charter gift rig is minted flagged and a legacy unflagged gift is discounted, oil/feed/livestock rigs do not count; driven with lots of every shape. (2) The Feed Operation card prints both prices. (3) Two mayor reports: a client city printed the MAYOR own vault totals because cityResourceHeadroom fell through to getResourceUnits - it now reports the owner units and an open vault; and the crew picker read the mayor own cards - it now reads the owner collection through city_owner_cards_get (sql/126, gated on the active mayoral contract, ids and counts only) and a failed read is an empty roster. (4) Woods Fishing round 1 from WOODS_FISHING_HANDOFF: the catch is a RESOURCE - the live trip banks Fresh Fish / Shellfish / Prime Seafood (with seaweed one cast in six), fleet drops land as fish at the old food quantities, the Fishing Company yields 1.5 fresh + 0.6 shellfish + 0.3 seaweed instead of 2.4 food, a Fish Cannery op eats the catch (shelf, label, tile, firm), the Cold Storage bench turns fish into rations, and a CONTRACTS tab posts four NPC contracts per 8-hour window (deterministic per user and window, a 1.25-1.70 premium over the ledger price, paid only against fish actually held) under a weekly world-wide tide event - all driven' },
  { id: 'bunkerdoors',   cmd: ['node', '_bunkerdoors_smoke.mjs'], expect: 0, minPasses: 25, tier: 'fast',
    why: 'the bunker screen (public/base): asked for "remove all of these modals from the bunker pictures when they are clicked on, I just want them to be for show. Remove the buttons down here but Assign change that to Camp and Ethos Heights. Make them big buttons next to the bunker images on the left side and give a tool tip above them." A room now renders with no click and never active, the room panel is handed nothing, the minimap cells no longer open rooms, the bottom action row (Build, Ethos Heights, Assign, Hire, Bunks) is gone, and two full-width doors sit at the top of the left column - Camp on the old nav:campOps seam, Ethos Heights on the old ethos seam - each with a data-tip tooltip positioned above the button and headroom reserved so the first one fits. Measured in headless Chromium (tmp/_drive_bunker.mjs): 9 rooms, no panel on click, cursor default, no action row, two 235x99 doors at x=12 beside a bunker at x=319, both postMessages fire, tooltip opacity 1' },
  { id: 'farmhaul',      cmd: ['node', '_farmhaul_smoke.mjs'],   expect: 0, minPasses: 130, tier: 'fast',
    why: 'v121v94, four things. (1) "the audio is overlapping each other": the cinematic guide player made a fresh Audio() per node and stopped none of them, and the classic bubble player advanced on a typing timer that knew nothing about its clip. The AudioSys now keeps ONE voice: playUrl stops the last clip, the engine waits for ended before any automatic advance, Next and Skip cut the clip and the next node starts its own, and a muted, blocked or erroring clip counts as finished so a scene never hangs - driven with a stub Audio. (2) The Feed Operation asked for by name: 1,500,000 Cinder or 55 Aza, feed out of food and water, registered in OPS_ECON, OP_LABELS, the Just Business catalogue and sidebar, node-city OP_BP, with an opFound Aza branch that charges, awaits the ledger, refunds a failed charge and only then writes the row. (3) Thirteen farm ids promoted at the four sites RESOURCES_NEXT names. (4) The Homestead Farm and Highway Haul modules, lifted from the only copies that reached this repo (the farm sandbox artifact and the haul test-drive bundle), loaded from index.html and reading nothing but bridges this suite checks field by field against what each module actually dereferences' },
  { id: 'nocardcraft',   cmd: ['node', '_nocardcraft_smoke.mjs'], expect: 0, minPasses: 28, tier: 'fast',
    why: 'players were crafting booster packs. The Crafting Station shipped a pack recipe (one sealed booster for 8 supplies and 4 shards) and a box recipe (eight of them) whose grant put REAL unopened packs in the inventory - cards for salvage, on a station that outlived the removal of the Card Forge because it was never called a forge. The instruction is "cannot craft anything that has anything to do with cards", so packs, boxes and card sleeves are gone from the defaults and from the recipe editor, and the rule is enforced at the GRANT: _craftKindAllowed is asked by the list, the grant and the make routine, so a pack recipe still sitting in a published Catalog, a cached Forge copy or an old device is not listed, is not made and spends nothing. A resource recipe refining one of the five card goods ids is refused for the same reason. Dice skins are the one thing left to craft. Driven headless against a catalog that publishes pack, box, legacy-no-kind and dice recipes' },
  { id: 'firstload',     cmd: ['node', '_firstload_smoke.mjs'],  expect: 0, minPasses: 38, tier: 'fast',
    why: 'four reports read from their text. (1) "Managed cities not loading first time after a break of more than a couple of hours - exit and re-enter and they reload immediately": the second open works because the session has refreshed by then; the first read went out on an expired token, was refused, and the player got an empty grid. cityStateLoad now retries a refused read once behind a bounded session refresh, and node-city reads again 2.5 s later when the first read was refused and nothing local stood in - nothing is written between the reads. (2) "Start game, Ruin Exchange, Bank of Ethos, City Hall, Licenses, PRNs - now the City Builder is ready": that walk fetched the node rows (anchors and the population capacity they grant), the operations list (licences) and the registry that the city reads on open. The same fetches now run 7 s after load and at the city door when the last pass is older than five minutes, bounded at 8 s, every leg best-effort, driven headless. (3) "free population 1089 / capacity 294 / 457 of 1546 / residents 166": beds, housing slots, residents and the economy model own household count all shared one word; each row now names its own quantity. (4) "Out of Cash - Limited by 0%" on a Cannery, a Farm, a Cinema: the cash verdict sat above the material verdict in bottleneck.classify, so an input NOBODY MAKES was reported as a cash problem and the fix text sent the player to the bank instead of to the missing building. Driven: broke plus no producer is NOBODY MAKES IT; broke plus a producer is out of cash; bankrupt stays out of cash; the text no longer calls a break-even firm failing, which firms.js closeDay stopped treating as failing in v121v85' },
  { id: 'wagepool',      cmd: ['node', '_wagepool_smoke.mjs'],   expect: 0, minPasses: 34, tier: 'fast',
    why: 'reported as "Employee Wages Not Reaching Employee Accounts": 107,050 of op_salary left four businesses in one cycle and no account gained it. True, and not a leak - the game had three wage systems and only one was closed. The economy sim pays firms to households and states the invariant; corp operations paid op_salary as a PURE SINK (the treasury row was the whole event); patronage MINTED every Cinder the residents spent. Same NPCs, two unrelated facts. NPC wages now go into a per-player household wage pool, less a 30 percent leak that keeps hiring a real cost, and patronage spends from the pool BEFORE it mints. The player takings do not move by one Cinder - the daily ceiling still binds and the pool can only replace minted money, never add to it - but the corp ledger line and the shop till are now two ends of one flow. Rejected: paying NPC wages into player wallets, which turns a six-figure sink into a faucet. Pins the pool by driving the lifted functions: leak in band, credit and draw reconcile to the unit, an empty or absent or throwing parent means mint-it-all, cloud merge is newest-stamp-wins because a balance must never be unioned, and all six version knobs moved together' },
  { id: 'clinicloop',    cmd: ['node', '_clinicloop_smoke.mjs'], expect: 0, minPasses: 20, tier: 'fast',
    why: 'reported as the Clinic "eating its own lunch": drawing remedies faster than it makes them. Preparing and dispensing in one building is the design and the draw is deliberately not scaled by city conditions while the output is, so below 67 percent conditions the shelf empties - and then the raw fallback drew MEDICINE at 2x from the ledger, the same medicine the Clinic own recipe needs. Measured at 50 percent conditions with a Med Lab: 0.263 medicine a minute burned against a recipe of 0.140, the city medicine pinned at one unit for the whole slump, and 95 percent coverage bought with it, which is why the conditions problem underneath was invisible. A service building now never raids an ingredient its own recipe uses; every other fallback is byte-for-byte unchanged. Also pins that the empty-shelf note names the real maker instead of "A Cannery" under a Clinic, that the Job Fair says how many of its seats the roster can actually fill (570 qualified, 1177 open, 208 employed was a roster capped at 400 against seats that follow the 10-200 posts a business offers), and that the node licence dialog states the six-in-any-mix rule that made a second Supply PRN look like a bug' },
  { id: 'firmcash',      cmd: ['node', '_firmcash_smoke.mjs'],   expect: 0, minPasses: 18, tier: 'fast',
    why: 'a business that was MAKING MONEY every day was walked to bankruptcy on a fortnight timer, and the player could do nothing about it. Reported as "Out of Cash - Limited by 0% impacting many businesses throughout the city... stuck on it for days and it results in the businesses going bankrupt. Nothing James or myself do seems to move the needle", and marked fixed once while it was not. The needle was one condition in closeDay: pay() clamps to the balance rather than refusing, so a firm that spends what it earns on wages, rent and inputs CLOSES THE DAY ON ZERO — a business at the margin, which is the normal state of most of a young city. But cash <= 0 alone booked the day as bad AND reset goodDays, making the recovery branch unreachable for exactly the firms that needed it. badDays then climbed monotonically: throttle at 2, a quarter of the staff sacked at 4, BANKRUPT at 14 — and every one of those cut revenue, which cut the next day cash, which guaranteed the next bad day. The bank could not help either: capacity is revenueAvg x maxLoanToRevenueDays - debt, so the earlier rungs shrink the number autoBorrow is sized from before it fires at DEBT. Insolvency now needs BOTH no cash and no profit. Pins it by MEASUREMENT, not by reading the line: it drives a profitable-but-broke firm and a genuinely failing one through 30 modelled days under the old and new conditions, and asserts the failing firm hits every rung on exactly the day it always did' },
  { id: 'ecoreach',      cmd: ['node', '_ecoreach_smoke.mjs'],   expect: 0, minPasses: 28, tier: 'fast',
    why: 'four retail/economy reports, three distinct causes. (1) THE LIVING ECONOMY AT 0%: firms are a separate simulation from the city tiles with their own inventory, so a resource the tiles pour out is still 0% here unless a FIRM makes it. Walking the recipe graph from what a player can actually found, 26 of 123 foundable outputs were ARITHMETICALLY UNREACHABLE — no sequence of buildings, in any order, with any money, produces the first unit. Two roots were requirements nothing could satisfy: steel[blast] wanted metalAlloys while EVERY metalAlloys leg wants steel (a closed loop with no entry, and the arc leg is no escape because it runs on recycledMetal from industrialWaste and BYPRODUCTS is declared, priced and never once emitted by the sim), and woodPanels wanted raw wood on top of lumber when no building yields wood as a firm output. Those two numbers unblocked 15 firms including every id the report named — metalComponents, sheetMetal, lumber — plus the entire automotive tree. The remaining 11 are pinned as a KNOWN set so a new one fails instead of joining a silent pile; each is blocked on a missing PRODUCER, which is a content decision. (2) THE 60x CINDER LIE: def.gen.cinder is per-minute NOMINAL and the tick banks it at /CINDER_PERIOD_DIV, which is what genOf() exists for — the bldProfile header already said in capitals "genOf(), NEVER def.gen.cinder", and two panels read it directly anyway, so a Gas Station hover said 0.72/min while the inspect row three hundred lines away said 0.01. (3) two patron needs pointed at buildings (cardshop, techstore) that do not exist, so those needs were permanently harder to meet and read as a pass from the need side' },
  { id: 'citychain',     cmd: ['node', '_citychain_smoke.mjs'],  expect: 0, minPasses: 20, tier: 'fast',
    why: 'five reports filed in one day said the Electricals Bench, Engine Works, Chemical Works, Polymer Plant and Industrial Gas Plant had no supply chain. Reading the table rather than the reports it was THIRTY-FIVE rows: crew, pop and powerNeed, some with descriptions naming a recipe ("Pig iron, coal and alloy into structural steel"), and no gen and no use at all — a player built them, paid the crew, burned the power and got nothing, and the Production-chain panel had nothing to draw. They were node-city facades added so /src/economy had buildings to attach to: their ECONOMY output was declared in ECO_BUILDING_MAP, their TILE recipe never was, and the silent table is the one the city runs. All 35 now produce their already-declared output from inputs that exist, so nothing is promoted and the foundry charge-path defect is untouched. The second half is structural: haveOf() reads game.res, which holds exactly what refreshLedgerMirror fetched, so an input the mirror misses reads 0 FOREVER and the building never runs once — that starved the Machine Shop on ingots and the Feedstock Plant on industrialWater, both found by players. The mirror list is now DERIVED from the recipes (true by construction, not by a test somebody remembers), split from HUD_DISPLAY_RES so the topbar keeps its 8 chips while the mirror grew 15 to 44, and fetched in ONE batched call instead of one per id — which is what made growing it affordable. Pins: no dead-end inputs, no cycle that cannot produce a first unit, tile and economy tables agreeing, and the topbar NOT growing' },
  { id: 'rigyard',       cmd: ['node', '_rigyard_smoke.mjs'],    expect: 0, minPasses: 50, tier: 'fast',
    why: 'the Truck Yard gained two cargo classes — Bulk Feed (tonnes) and Livestock (head), two classes rather than one farm class because rollRig() picks WITHIN a class and a player who wants to move cattle must not be handed a grain hopper. Adding the rows alone would have shipped trucks that price, roll and sell correctly and are INVISIBLE: six sites in index.html branched on `=== "oil"` (the class reader, tab counts, the empty-tab fallback, the TABS literal, the tab click, the empty-tab sentence) and the stocker took its class list from the floor-DEPTH map, so every feed and livestock rig would have answered freight, filed under the freight tab, with two tabs that never appear and a floor that never stocks them. All seven are derived from the module class list now. Second half: no surface rendered a model for a rig at all — modelUrl is stamped per-row by the CAR auction from an admin upload, so all three vehicle modals printed "[VEHICLE PHOTO · drop a 3/4 render]" over every truck in the game. _ppModelOf() resolves the row first and the CATALOGUE second, at render time, so a truck bought before models existed still shows one and no bundle path is ever written into a saved profile. The yard card and the listing modal also had no _ppaFillThumbs call, so the markup alone would have left them on "rendering 3D…" forever under a caption promising a click-to-orbit that was never bound. Pins that every model path is both on disk and re-included in .assetsignore — the blanket ignore makes a missing line work in dev and 404 only in production' },
  { id: 'stashvis',      cmd: ['node', '_stashvis_smoke.mjs'],   expect: 0, minPasses: 24, tier: 'fast',
    why: 'the vault charged for roughly three times what it showed. Profile.salvage is ONE map holding TWO catalogues — RESOURCES (143 chain/city ids) and SALVAGE_RES (397 loot and crafting ids), 265 of which appear in no RESOURCES row. getResourceUnits() sums every key so all 265 counted against the ceiling, while the panel rendered RESOURCES.filter(held) and could never show one of them: a player could be pushed into a full vault by crystal dust and drone parts they had no way to look at. The panel now renders the LEDGER, resolving each id through RESOURCES then SALVAGE_RES then a humanised fallback that can always answer. Pins the invariant that broke: the rows printed must sum to the units charged' },
  { id: 'cityfarm',      cmd: ['node', '_cityfarm_smoke.mjs'],   expect: 0, minPasses: 28, tier: 'fast',
    why: 'the Feedstock Plant declared pop, crew, powerNeed and a description naming a recipe — and no gen and no use at all, so it drew power and did nothing while the Production-chain card had nothing to draw. It was one of three rows on that rung in the same state; they now feed each other (water to the Process Water Plant, fuel to the Refinery, both into the Feedstock Plant), which is what makes what should come before it an answerable question. Also adds the Livestock Farm as the first half of the coming animal business: it works today (feed and water in, livestock and eggs out) and it PROMOTES livestock into a real resource through ECO_BUILDING_MAP, so a slaughterhouse only has to declare use.livestock. Pins the promotion (derived, alphabetical, matching chain.js glyph verbatim) and the explicit tier-1 price, without which the pair fall through the crash guard at 3 — above their own inputs — and the farm becomes a Cinder faucet' },
  { id: 'citynode',      cmd: ['node', '_citynode_smoke.mjs'],   expect: 0, minPasses: 26, tier: 'fast',
    why: 'a player had two Supply PRNs they could not move, demolish or get rid of, and the placement had eaten a building to put them there. spawnAnchors rings owned nodes at slots derived from the node COUNT and wrote game.tiles[k] unconditionally; it runs BEFORE loadState on an empty grid, so the loss happened one step later where loadState skipped any key an anchor held and SILENTLY DROPPED the saved building. The anchor could not be moved (moveRefusal blocked it, and tryMove/moveCheck would have thrown on BUILDINGS[anchor] anyway) and the panel hid all six action buttons with no sentence. Now: a building is never displaced, the anchor yields and is reseated on free ground after the load, its plot rides the save so a move sticks, Move works, and the card explains why Demolish is not the right action for a node you own' },
  { id: 'citybiz',       cmd: ['node', '_citybiz_smoke.mjs'],    expect: 0, minPasses: 28, tier: 'fast',
    why: 'businesses never worked and it was three defects. STAFFING: tileMult multiplied a crewed building by staffingRatio(), one city-wide number counting HIRED workers only — so a city staffed by its own residents ran every business at zero output for ever, which is why a Pharmacy (gen cinder 0.18) went bankrupt. staffAt() now adds the seats residents actually hold, with the old value as the FLOOR so a hired city is unchanged. MACHINE SHOP: it declares use.ingots but ingots was never added to HUD_DISPLAY_RES, the list refreshLedgerMirror fetches into game.res — so its input read 0 for ever and it never ran, and it is one of only two buildings making the `goods` a Cinema sells. SUGAR MILL: pop, crew, powerNeed, a description promising it feeds the Cinema, and no gen and no use at all. This suite also pins the INVARIANT that would have caught the machine shop: every building input must be a mirrored id or a city-stock key' },
  { id: 'cures',         cmd: ['node', '_cures_smoke.mjs'],      expect: 0, minPasses: 32, tier: 'fast',
    why: 'the Containment Lab could not make a cure that worked, and it was three defects at once. GEOMETRY: blendOf is a weighted average so every mix lands inside the CONVEX HULL of the reagent points, and the 13 shipped reagents had no vertex in four corners the strain generator produces — 7.8% of strains could never reach broad-spectrum however well played. Twelve more reagents drawn from RESOURCES (which had grown to 142 while this table was still built against the original 14) took that to 0.8%. THE HELPER: suggestMix picked the nearest reagent per axis INDEPENDENTLY and mixed all four, but a weighted average does not compose — it reached broad 0.0% of the time and produced something worse than a viable cure 19.5% of the time. It is now a real solver that plans inside the player stock. THE BENCH: every jar now prints what ONE MORE UNIT does to the vessel in front of you and the list is ordered by it, because "adjusting anything else moves it from that marker" is the coupling a weighted average creates and the UI showed no trace of it' },
  { id: 'cinderrate',    cmd: ['node', '_cinderrate_smoke.mjs'], expect: 0, minPasses: 20, tier: 'fast',
    why: 'the Cinder-per-minute chip flicked between two numbers once a second, and BOTH were real. Rent and building output are continuous; patronage is not, so most ticks took nothing and the occasional tick took a lump — which the old line booked as an INSTANTANEOUS rate (credited/dtMin, i.e. x60) and contributed nothing in between because it sat inside if(credited>0). The rate is now averaged over whole CLOSED minutes, which is piecewise constant rather than merely damped (a decaying average was tried and still rippled 21.8 -> 18.5 at one lump a minute, which on a one-decimal chip is still a number changing every second), and the chip holds its value until the figure leaves a proportional band. The ACCRUAL is untouched — this suite pins that the city earns exactly what it earned before' },
  { id: 'centrifuge',    cmd: ['node', '_centrifuge_smoke.mjs'],  expect: 0, minPasses: 14, tier: 'fast',
    why: 'the Containment Lab centrifuge sealed players in: the rotor tick called the panel full render every frame and modal() assigns innerHTML, so every button was destroyed between mousedown and mouseup and NO click could complete — neither STOP THE ROTOR nor CLOSE. The needle is now moved in place and the panel re-renders only when its content changes' },
  { id: 'noboard3d',     cmd: ['node', '_noboard3d_smoke.mjs'],    expect: 0, minPasses: 16, tier: 'fast',
    why: 'the 3D battle board is retired: the settings card, toggle and Battlemap Editor button are gone and _b3dEnabled() returns false as its FIRST statement, so no old save, published Forge row, durable key or runtime override can mount it. Pins the two things that must NOT have gone with it — the summon-cinematic previews (live in battle, they only shared the card) and the classic board guards' },
  { id: 'citname',       cmd: ['node', '_citname_smoke.mjs'],      expect: 0, minPasses: 14, tier: 'fast',
    why: 'two things that were invisible for the same reason: a citizen whose NAME is its own id (c55) printed the id everywhere c.name is shown, repaired on load because the value round-trips through citSave; and the sell-node button read UNKNOWN ownership as NOT YOURS and returned an empty string, so the owner got no button and no reason — _twOwnersReady exists to tell those apart and this render site was the one not asking' },
  { id: 'ingots',        cmd: ['node', '_ingots_smoke.mjs'],       expect: 0, minPasses: 16, tier: 'fast',
    why: 'ingots was promoted out of CITY_STOCK into the real ledger, which only works if THREE things move together: the RESOURCES row, the CITY_STOCK removal (so production banks to the player instead of the city), and the migration of stock a city already holds — STOCK_KEYS no longer names ingots, so anything left behind is dropped by serialize(). Measured live before shipping: 2 cities holding 2,934' },
  { id: 'leaderboard',   cmd: ['node', '_leaderboard_smoke.mjs'],  expect: 0, minPasses: 26, tier: 'fast',
    why: 'the leaderboards are DERIVED, never submitted: sql/124 creates no table and grants no insert, so there is nowhere for a modified client to type a score. Ranked wins are counted from the matches table rather than the competitive blob, because that is the one figure a save cannot edit; and lb_cities deliberately does not join city_profiles, whose 57 rows join city_state exactly zero times' },
  { id: 'mapmerge',      cmd: ['node', '_mapmerge_smoke.mjs'],     expect: 0, minPasses: 20, tier: 'fast',
    why: 'a shrink refusal on the AUTOMATIC publish path is no longer a dead end: this device being behind plus the dirty-map fetch guard made the same refusal repeat forever, so an admin could never save a new node. The two lists are both true, so they are UNIONed by node id and the union is published — never forced, once per attempt, and the explicit Publish Map button still asks a human so deleting a node stays possible' },
  { id: 'mayordash',     cmd: ['node', '_mayordash_smoke.mjs'],    expect: 0, minPasses: 26, tier: 'fast',
    why: 'the phone mayor dashboard lists every client city, the owner gamer name and what each city pays: earnings come from mayor_earnings (sql/123), written in the same transaction that pays the mayor, so the phone never recomputes a share and cannot disagree with the wallet. Pins that an unapplied migration and an in-flight fetch each say so — never "you are not a mayor anywhere", which would read to a mayor with six clients as their contracts having vanished' },
  { id: 'vaultcap',      cmd: ['node', '_vaultcap_smoke.mjs'],     expect: 0, minPasses: 20, tier: 'fast',
    why: 'the vault ceiling must not sag on a cold load: Operations.list is EMPTY until opFetch answers, so _warehouseCapacity reported 0 and getResourceCap dropped by whatever the paid, staffed Warehouse was worth — and _stashEnforceCap JETTISONED real resources against that missing ceiling. An unread list is now "unknown", not zero: the last TRUSTED figure holds (carried in all THREE persistence lists), it still falls when staff or the operation go, and the enforcer refuses to trim a ceiling it cannot vouch for' },
  { id: 'mercenary',     cmd: ['node', '_mercenary_smoke.mjs'],    expect: 0, minPasses: 32, tier: 'fast',
    why: 'the mercenary escrow board is wired in and on the phone: the module reaches the app ONLY through window.MythicMercBridge (Profile/RESOURCES/Forge/Cloud are top-level consts an ES module cannot see), the deferred module dispatches mythic:mercenaries-ready and index.html now LISTENS for it so the tile is not absent on a cold load, the migration is filed as 122 because three sql/038_* files already collide, and the phone Collect tab checks stash room BEFORE claiming since a claim is a one-shot server insert' },
  { id: 'mayorsplit',    cmd: ['node', '_mayorsplit_smoke.mjs'],   expect: 0, minPasses: 30, tier: 'fast',
    why: 'the Mayor Hall revenue split actually pays: sql/121 applies node_mayors.player_pct inside city_owner_ledger_apply, so a hired mayor is paid their share of every city payout. The split is server side because the client running the city is the mayor own client and Cinder withdraws to real money; cut is floored and the owner takes the exact remainder so cut + owner = delta always; a SPEND is never split, and the mayor is paid only after the owner side commits' },
  { id: 'payoutconn',    cmd: ['node', '_payoutconnect_smoke.mjs'], expect: 0, minPasses: 26, tier: 'fast',
    why: 'connecting Stripe from the profile reuses the ONE onboarding flow — BAZAAR_ACTIVATION.md: two account maps for one player is how a payout reaches the wrong Stripe account, so exactly one /api/cashout/connect call may exist in the client; also pins the return trip from Stripe, which nothing read before, so a player finished onboarding and landed on the title screen with a stale not-connected status' },
  { id: 'pwchange',      cmd: ['node', '_pwchange_smoke.mjs'],     expect: 0, minPasses: 20, tier: 'fast',
    why: 'changing a password from the profile PROVES the old one first: Supabase updateUser rewrites whatever session the browser holds without asking, so the function signs in with the current password and a wrong guess never reaches updateUser at all; the three fields are cleared on success and the flow never re-renders mid-type' },
  { id: 'welcome',       cmd: ['node', '_welcome_smoke.mjs'],      expect: 0, minPasses: 30, tier: 'fast',
    why: 'a new member gets ONE welcome mail from Hidn Studios: sql/120 backfills every existing account as already-welcomed so shipping it does not greet the whole game, the claim is a keyed insert so two tabs make one winner, the Worker reads the recipient off the JWT and never off the request body, and env.EMAIL is checked before the claim so finishing the Cloudflare onboarding later is retroactive' },
  { id: 'mayorco',       cmd: ['node', '_mayorco_smoke.mjs'],      expect: 0, minPasses: 14, tier: 'fast',
    why: 'a hired mayor whose Construction Co. stands anywhere lifts the build ceiling in the client city they are managing — and only the ceiling: no borrowed crews, no borrowed speed, nothing for an owner or an unresolved identity, and the shop card asks the same predicate as both gates' },
  { id: 'luniphone',     cmd: ['node', '_luniphone_smoke.mjs'],   expect: 0, minPasses: 30, tier: 'fast',
    why: 'the phone has a Luni app: browse and buy other players listings, list resources by the lot and held items, pull your own back down — all through the market screen\'s own post / take / cancel functions' },
  { id: 'phonecx',       cmd: ['node', '_phonecx_smoke.mjs'],      expect: 0, minPasses: 15, tier: 'fast',
    why: 'the phone has a Crash Exchange app: market list, ticket with sparkline and Buy / Sell through the exchange screen\'s own executors, portfolio with P&L' },
  { id: 'battleart',     cmd: ['node', '_battleart_smoke.mjs'],    expect: 0, minPasses: 23, tier: 'fast',
    why: 'battle modals show card art not emojis, graveyard alternate costs are paid on every play path, the zero-cost graveyard test is lenient, and admin node edits publish the shared map' },
  { id: 'corpstaff',     cmd: ['node', '_corpstaff_smoke.mjs'],    expect: 0, minPasses: 36, tier: 'fast',
    why: 'player staff on operations with negotiated wages (sql/117): offer / apply / counter / accept / end, payroll from the treasury into wallets, production counts players while op_salary counts NPCs, city income named and caught up for a week' },
  { id: 'ledgerwhy',     cmd: ['node', '_ledgerwhy_smoke.mjs'],    expect: 0, minPasses: 34, tier: 'fast',
    why: 'every Cinder move is booked with a reason (raids, businesses, city builder, screen fallback), the valuation never says LOCAL, camp sub-screens return to the Camp page and the Camp page to the Bunker' },
  { id: 'spriteguard',   cmd: ['node', '_spriteguard_smoke.mjs'],  expect: 0, minPasses: 30, tier: 'fast',
    why: 'Sprite Atelier guardline: a corrupt or silently-shorter sprite save is refused and disk untouched, publish / migrate cannot drop frames, a failed cloud upload never removes the local copy, delete buttons snapshot to spr:__undo first with a 10 s Undo, and forge_sprites_idx is only ever a superset of disk' },
  { id: 'wages',         cmd: ['node', '_wages_smoke.mjs'],        expect: 0, minPasses: 24, tier: 'fast',
    why: 'corp pay reaches the recipient on screen: the incoming-Cinder watcher adopts a server debit, only adopts a gain the server ledger explains, books it by reason, and sql/116 installs get_my_ledger' },
  { id: 'luni',          cmd: ['node', '_luni_smoke.mjs'],         expect: 0, minPasses: 25, tier: 'fast',
    why: 'Luni: the storefront header, item pages with seller ratings and price action, the watchlist, the tile opener, the cloud-aware bid modal, and sql/115' },
  { id: 'fieldcounter',  cmd: ['node', '_fieldcounter_smoke.mjs'], expect: 0, minPasses: 14, tier: 'fast',
    why: 'field abilities can be paid with counters: the real gate on the real Counters engine, the editor, the activation, the AI and the last-counter clause' },
  { id: 'duel',          cmd: ['node', '_duel_smoke.mjs'],         expect: 0, minPasses: 30, tier: 'fast',
    why: 'the duel passives, card effects and arena moves exist, resolve through real hooks, and only use statuses and executor fields that exist' },
  { id: 'whanyres',      cmd: ['node', '_whanyres_smoke.mjs'],     expect: 0, minPasses: 12, tier: 'fast',
    why: 'the warehouse send modal offers every stash id (named via _meta), the page is handed names for all of them, sql/114 widens the server id rule' },
  { id: 'marketrepair',  cmd: ['node', '_marketrepair_smoke.mjs'], expect: 0, minPasses: 20, tier: 'fast',
    why: 'resource market: the archive trigger returns NEW (updates stick), clawback ledger rows settle capped and gated, price_total is never money on them' },
  { id: 'athena',        cmd: ['node', '_athena_smoke.mjs'],       expect: 0, minPasses: 60, tier: 'fast',
    why: 'Athena Engine: Scene + Files tabs, uploads (glb / anim / audio / vfx), maps as menu buttons, player hubs with chat + prox voice, interactions → screens / hubs / Forge guides' },
  { id: 'whvisit',       cmd: ['node', '_warehouse_visit_smoke.mjs'], expect: 0, minPasses: 25, tier: 'fast',
    why: 'in another player\'s warehouse a renter may only pay rent they owe (after Later); the resource depot holds 20,000 of any wallet resource' },
  { id: 'spriteidle',    cmd: ['node', '_spriteidle_smoke.mjs'],    expect: 0, minPasses: 24, tier: 'fast',
    why: 'battlefield idle loops never change a sprite\'s size (no scale() in any idle keyframe, 0% == 100%) and the stage frame index wraps 0..n-1 off the shared clock with a stable phase' },
  { id: 'spritefit',     cmd: ['node', '_spritefit_smoke.mjs'],     expect: 0, minPasses: 52, tier: 'fast',
    why: 'one footprint on the battlefield: the VISIBLE silhouette is fitted to the unit height, feet on the tile centre, snapped to device pixels; a unit is only bigger through an explicit normal|large|huge class from metadata, never from image size' },
  { id: 'daynightperf',  cmd: ['node', '_daynightperf_smoke.mjs'],  expect: 0, minPasses: 130, tier: 'fast',
    why: 'a day/night change bakes the ground ONCE and cross-fades it, STAGES its two sky plates and the ground pair after the press in band-sliced steps (one staging task per frame, kicked to the GPU, never read back, never in the press or in a frame), grades the backdrop over its own sky in two steps, drains before any readback, pre-warms the likely next preset at idle, parks on the last plate, skips the grade readback and never re-bakes a silhouette while the light lerps — the lag when the sun changes' },
  { id: 'battleperf',    cmd: ['node', '_battleperf_smoke.mjs'],    expect: 0, minPasses: 250, tier: 'fast',
    why: 'with the stage on, the hidden DOM board under it runs no animations (pseudo-elements included) and the sprite ticker skips it; a host day→night change posts exactly one board:timeOfDay (no location re-push, never init/defs); the white guard\'s stage-canvas score comes from the wash the stage reports itself (board:wash, measured on the vista\'s own readback) so the guard never reads the GPU canvas back for it; its cost-aware readback stays for every other layer and holds during a sky change — the host share of the lag when the sun changes; the stage clips each actor ONCE (terrace overlaps subtracted geometrically, per-slab loop only as the cap fallback) and blits each boulder from a sprite keyed on the quantised light rig (budgeted re-bakes, live painter as the fallback)' },
  { id: 'htmlsyntax',    cmd: ['node', '_htmlsyntax.cjs', 'public/index.html', 'public/node-city/index.html', 'public/warehouse/index.html', 'public/dwelling/index.html', 'public/battle-board/index.html'], expect: 0, tier: 'fast',
    why: 'every inline <script> in the two pages still compiles — a patch that broke the page JS fails here, not on a player' },

  // ── syntax and structure. Cheap, and they catch the whole class of
  //    "the page went white".
  { id: 'synck',         cmd: ['node', '_synckcheck.mjs'],          expect: 0, tier: 'fast',
    why: 'index.html parses' },
  { id: 'comments',      cmd: ['node', '.gauntlet/comment-scan.mjs'], expect: 0, tier: 'fast',
    why: 'markup comments are balanced' },
  { id: 'modules',       cmd: ['node', '.gauntlet/modcheck.mjs'],   expect: 0, tier: 'fast',
    why: 'every ES module under public/src parses' },

  // ── feature smokes.
  { id: 'hospital',      cmd: ['node', '_hospital_smoke.mjs'],      expect: 0, minPasses: 100, tier: 'fast',
    why: 'the Medical Corporation minigame' },
  { id: 'refinery',      cmd: ['node', '_refinery_layout.mjs'],     expect: 0, tier: 'fast',
    why: 'every refinery plot is reachable' },
  /* ⚠ BASELINE 1, and it is a real bug, not an accepted one: the outbreak never
     spreads past its two index cases. It fails identically on a clean checkout
     of HEAD — verified by stashing — so it is older than the work that found it.
     Lower this to 0 when somebody fixes the spread. */
  { id: 'plague',        cmd: ['node', '_plague_smoke.mjs'],        expect: 1, minPasses: 30, tier: 'fast',
    why: 'the plague model (1 known failure: outbreaks do not spread)' },

  /* ⚠ BASELINE 3 — re-measured 2026-09-04 on a full run: 3 ❌ and 1048 ✅ by
     this runner's own counters (5 and 1046 before the two round0b reds below
     went green — exactly the two checks moved), all three in rounds 0b, 0c and
     0p, nothing red after 0p, 7m30s wall. Each red below is a DECISION and
     carries the date it was decided, because "pre-existing" with no date is
     how a baseline outlives the reason for it: nobody can tell a two-week-old
     decision from a regression that happened to land on the same check.
     Lower this in the commit that turns one of them green.
       ✓ WAS 5, LOWERED 2026-09-04. round0b ×2 — "exactly the 3 licence
         operations have no business" and "all 19 non-licence operations are
         wired" — went green when op_restaurant (v121n3, b873db4f4e) and
         op_transport (v121p1, 9c6e884002) got their OP_ECO_MAP rows. The
         baseline had carried them since 2026-08-28 as "they trade as ledger
         operations, not chain firms", which described the gap rather than
         arguing for it: neither is a licence by OP_ECO_MAP's own rule. The
         measurement it hid was "17 of 19".
       · round0b ×1 — the ground gate: "the gate still has something to gate".
         ecoGroundRefusal waves `gen:` rows through (a945fd1661, 2026-08-20)
         and the refinery feedstock routes (39040ba2d0, 2026-09-03) gave the
         last chain-only all-deposit rows a `gen:`, so the deposit test now
         gates 0 of 13 rows. The check stays red on purpose as the reminder
         that the gate is dead code until a new chain-only row arrives.
         decided 2026-09-03 (v121t9).
       · round0c ×1 — "the business is trading before the upgrade": the
         firm-stability fixture (2aa817c6fb, 2026-08-13) reaches its upgrade
         with rev 0 and no supplier; the checks around it (founding, charter
         capital, survival mid-upgrade) still pass on the same firm.
         decided 2026-09-03 (v121t9), not re-fixtured.
       · round0p ×1 — "no node-city BUILDINGS row gens, uses or costs a
         promoted chain id": 52 farm/mine/quarry `gen:` legs bank promoted ids
         straight into the camp ledger. Rule 2 as written on 2026-08-14
         (3a5d7da4c4: the city banks none of them) was overtaken by the seam
         rows; the half that matters — /src/economy never calls addRes or
         spendRes — is a separate check in the same round and is green.
         decided 2026-09-03 (v121t9).
     Slow — about nine minutes — so it is --full only. */
  { id: 'economy',       cmd: ['node', 'tools/economy-tests/run.mjs'], expect: 3, minPasses: 1000, tier: 'full',
    why: 'the economy gauntlet, ~1050 checks (3 known failures, each dated above)' },

  /* ⚠ --full ONLY, AND SAYING SO IS THE POINT: this is the same harness as the
     'forgeharness' suite (fast tier) with its A/B half switched on, and that half
     builds TEN git worktrees and runs a dozen child node processes — 3m20s
     measured, against 8.5 s for the page half. Putting that in the pre-commit
     gate would make people stop running the gate, which is the failure this
     whole runner was written to avoid, so the fast tier gets the part an
     index.html edit can break and this gets the part a git or worktree change
     can break: the no-op A/B is byte-identical, the worktree paths are per-run
     (they used to be a fixed ../head-ab, so two agents A/Bing at once was a
     hard refusal and a killed run blocked the next one), a killed run's
     leftover is reaped while a LIVE owner's is never taken, and a metric that
     reads a path existing on only ONE side is REFUSED by name instead of
     reported as a difference — measured: it caught 17 uncommitted public/src
     modules the live page loads and HEAD does not, and four one-line drivers
     (readdir of a parent directory, opendirSync, a re-cased path) that used to
     walk straight past that refusal. Plus the two that got past THAT: the
     guard's own wrapper re-exported fs.realpathSync.native unwrapped (the
     property is now asserted over the whole wrapped surface — 123/123 wrapped,
     0 of 2 sub-functions unwrapped, where unguarded it reads 0/123 and 2), and
     a driver holding an ABSOLUTE path into the main tree A/B'd nothing and
     reported identical=true (15,860,682 bytes on BOTH sides for a file that
     really differs by 61,642) — now AbEscapedTreeError, by name.
     ⚠ IT MUST STAY GREEN WHILE A COLLEAGUE IS WORKING, and that is why nothing
       in it asserts on `git worktree list` or on `git status` compared across
       the run: both are machine-global, other agents A/B and save files on this
       box, and two critics got four red runs out of four on exactly that — a
       gate that reddens when somebody else is at their desk is the gate nobody
       runs. Re-measured here with a noisy neighbour looping its own A/Bs and
       churning an untracked file: exit 0, worktree list string identical=false,
       `?? …` vanishing mid-run, 32 passes.
     ⚠ AND THE PATH GUARDS NOW NORMALISE THE SPELLING, which is how both of
       them were walked through in one line: path.toNamespacedPath() — the \\?\
       extended-length prefix node itself hands out — is not stripped by
       path.resolve(), so `fs.existsSync(toNamespacedPath(cwd + '/public/
       assets'))` was recorded by NEITHER guard and reported base=true /
       head=false, identical=false, exit 0. Every path now goes through one
       canonPath() (resolve + prefix strip + case-fold), shared by value with
       the preload shim so the two cannot drift, and both spellings ship as
       named mutants: `--mutant=namespaced-asym|namespaced-escape`.
     ⚠ AND CLAUSE (12b) NO LONGER REDDENS BECAUSE A COLLEAGUE IS WORKING: it
       used to end in "every other entry in `git worktree list` survived the
       reap", and a critic's first full run exited 1 (36 PASS / 1 FAIL) purely
       because another agent's dead-owner worktree was on the machine and the
       reaper correctly took it. Re-measured 2026-09-08 with three foreign
       worktrees planted (one dead, one whose owner dies mid-run, one owned by a
       live process): exit 0 and 45 PASS on BOTH runs, the live one untouched,
       the dead ones named in the report as evidence.
     45 passes measured; the floor is 40 because the A/B clauses are the ones a
     git-version or worktree change legitimately reshapes, and expect:0 still
     reddens the suite on any single FAIL. */
  { id: 'forgeab',       cmd: ['node', '.gauntlet/_forge-harness.mjs'],  expect: 0, minPasses: 40, tier: 'full',
    why: 'the Forge harness A/B half: no-op diffs are byte-identical, worktrees are per-run, reaped when dead and never taken when alive, the main tree is proved untouched by this run\'s own fs writes and git verbs rather than by a shared counter, one-sided reads — including a listing of a directory whose children are one-sided, and fs.realpathSync.native off the guard\'s own wrapper — are refused instead of reported as a difference, and a driver that reads the MAIN tree instead of the tree under test is refused too rather than reporting identical=true — in every spelling, including the \\?\ namespaced one that used to walk past both guards' },
];

const args = process.argv.slice(2);
const full = args.includes('--full');
if (args.includes('--list')) {
  console.log('\n  suite          tier   baseline  why');
  for (const s of SUITES) console.log('  ' + s.id.padEnd(14) + s.tier.padEnd(7) + String(s.expect).padEnd(10) + s.why);
  console.log('\n  ' + SUITES.length + ' suites. Baselines are failures a suite is KNOWN to report.\n');
  process.exit(0);
}

const run = SUITES.filter((s) => s.tier !== 'parked' && (full || s.tier === 'fast'));   // 'parked' = owned by a loop still in flight; never part of a gate
console.log('\n🛡 CHECKALL — ' + run.length + ' suites' + (full ? ' (full)' : ' (fast; --full adds the economy gauntlet)') + '\n');

/* Count the FAILING checks a suite reported. Every suite in this repo prints
   either "  FAIL " or "❌" per failed check, so one counter covers both — and
   counting is what lets a baseline mean something more precise than "red". */
function countFails(out) {
  let n = 0;
  for (const line of out.split('\n')) {
    if (/^\s*FAIL\s/.test(line)) n++;
    else if (/^\s*❌/.test(line) && !/^\s*❌\s*\d+\s*FAILURES/.test(line)
             && !/ECONOMY GAUNTLET:/.test(line)) n++;
  }
  return n;
}
/* Passing checks, counted for one reason: to know whether a suite RAN. */
function countPasses(out) {
  let n = 0;
  for (const line of out.split('\n')) {
    if (/^\s*(PASS|ok)\s/.test(line)) n++;
    else if (/^\s*✅/.test(line)) n++;
    else if (/^\s*OK\s/.test(line) || /ALL CLEAN/.test(line) || /MODULES PARSE/.test(line)) n++;
  }
  return n;
}

const results = [];
for (const s of run) {
  const file = s.cmd[1];
  if (!existsSync(file)) { results.push({ ...s, state: 'MISSING', got: null }); continue; }
  const t0 = Date.now();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const got = countFails(out);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const passes = countPasses(out);
  /* 🔴 "CRASHED" MEANS THE SUITE PRODUCED NO RESULTS — NOT THAT ITS OUTPUT
     CONTAINS THE WORD "TypeError".
     The first version grepped for /ReferenceError|TypeError|SyntaxError/ and
     flagged the economy gauntlet as a crash on a completely healthy run: one of
     its PASSING checks is captioned "✅ KNOWN, out of scope: the push is a
     no-op (`const t = _boeRow()` is a Promise, `t.update` is undefined,
     TypeError swallowed)". A gate that cries crash on good output trains people
     to ignore it just as fast as one that is permanently red — the exact
     failure this runner exists to avoid, committed by the runner itself.
     So it is one condition: A NON-ZERO EXIT WHILE REPORTING ZERO FAILURES.
     That means the suite died somewhere its own accounting never saw. A suite
     that exits non-zero BECAUSE of baseline failures reports those failures and
     is never caught by it.
     ⚠ "PRODUCED NO PARSEABLE LINES" IS NOT A CRASH, and the second draft got
       that wrong too — it flagged _refinery_layout.mjs, which prints
       "reachable   alky (first plot)" and matches none of the PASS/ok/✅
       markers, yet exits 0 and is perfectly healthy. A suite's own exit code is
       its verdict; this runner does not get to overrule it because it could not
       recognise the prose. `passes` is still counted, but only to SHOW in the
       report that the suite did something. */
  const crashed = r.status !== 0 && got === 0;
  /* 🔴 A SUITE THAT DIES AFTER ITS KNOWN FAILURES READ AS GREEN. The economy
     gauntlet threw ReferenceError at round 0r — after rounds 0b and 0c had already
     printed their five baseline failures — so it exited 1 with got === 5 === expect,
     and this runner said OK on 332 passes where 1045 are normal. Two full-gate
     runs said green on a suite that had checked a third of itself. "At baseline"
     has to mean the pass count too: each suite carries a floor set at roughly
     two-thirds of what it produces today, and a run under it is SHORT — the suite
     stopped checking, whatever it printed first. Raise a floor when a suite
     grows; never lower one to make a run pass. */
  const short = !crashed && s.minPasses != null && passes < s.minPasses;
  const state = crashed ? 'CRASH' : short ? 'SHORT' : got > s.expect ? 'WORSE' : got < s.expect ? 'BETTER' : 'OK';
  results.push({ ...s, state, got, passes, secs, out, minPasses: s.minPasses });
}

let bad = 0;
for (const r of results) {
  const tag = { OK: '✅', WORSE: '❌', BETTER: '🎉', CRASH: '💥', SHORT: '🩸', MISSING: '⚠️' }[r.state];
  const detail = r.state === 'MISSING' ? 'script not found'
    : r.state === 'CRASH' ? 'the suite threw — it checked NOTHING'
    : r.state === 'SHORT' ? r.passes + ' passes against a floor of ' + r.minPasses + ' — the suite STOPPED partway and did not finish checking'
    : r.state === 'WORSE' ? r.got + ' failures against a baseline of ' + r.expect + ' — THIS IS NEW'
    : r.state === 'BETTER' ? r.got + ' failures, baseline says ' + r.expect + ' — lower the baseline in this commit'
    : r.got + '/' + r.expect + ' known' + (r.passes ? ', ' + r.passes + ' passed' : '');
  console.log('  ' + tag + '  ' + r.id.padEnd(14) + (r.secs ? (r.secs + 's').padStart(7) : '       ') + '  ' + detail);
  if (r.state === 'WORSE' || r.state === 'CRASH' || r.state === 'SHORT' || r.state === 'MISSING') {
    bad++;
    const lines = (r.out || '').split('\n').filter((l) => /^\s*FAIL\s|^\s*❌/.test(l));
    for (const l of lines.slice(0, 6)) console.log('        ' + l.trim().slice(0, 150));
  }
}

console.log('');
if (bad) {
  console.log('❌ ' + bad + ' suite(s) got worse. A baseline is not a target — fix the check, do not raise the number.\n');
  process.exit(1);
}
console.log('✅ every suite is at or below its baseline.' + (full ? '' : '  (run --full before a deploy)') + '\n');
process.exit(0);
