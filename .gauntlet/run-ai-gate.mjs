#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   🚦 RUN-AI-GATE — the runner the AI and MP drivers never had.

   WHY THIS FILE EXISTS. Eight pieces of work were built into public/index.html
   in sequence, each with its own driver, and every driver was HAND-RUN ONLY.
   Nothing referenced them: no gate, no manifest, no runner. So when a later
   edit silently reverted piece A1 — the deterministic damage estimate, three
   rounds of work — the tree kept reporting A1 as passed for hours. Its own
   driver was sitting in this directory, correct, and would have gone red the
   moment the code vanished. Nobody ran it.

   A test that is not wired to a runner is a test nobody runs. This is the wire.

   TWO SPEEDS, because the reason A1 went unnoticed is that the real proof is
   slow and nobody pays seven minutes on a whim:

     --quick   (~50ms)  MARKER SCAN. Greps public/index.html for the mechanism
                        each piece installed. It cannot tell you the code is
                        CORRECT — only that it is still THERE. That is the exact
                        failure this run missed, and it is cheap enough to run
                        after every edit. Run it before you commit.

     (default) (~25min) THE DRIVERS. Boots the real page in Playwright and
                        exercises the behaviour. This is the one that decides.

   Use:
     node .gauntlet/run-ai-gate.mjs --quick
     node .gauntlet/run-ai-gate.mjs
     node .gauntlet/run-ai-gate.mjs --only damage-determinism
     node .gauntlet/run-ai-gate.mjs --skip-slow

   ⚠ ADDING A PIECE? Add BOTH a marker and a driver row. A driver with no marker
     leaves the fast path blind to a deletion; a marker with no driver certifies
     that a string exists, which is not a behaviour.
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
/* 🔴 THE SCAN READS EVERY FILE THE WIRING LIVES IN, NOT JUST index.html.
   The Restaurant shipped priced, labelled and UNBUYABLE because the shop the
   player uses renders a hardcoded array in public/corp/screens.jsx, and a scan
   pointed only at index.html could never have seen that it was missing. A
   feature that spans files needs a scan that spans files. */
const SRC_FILES = [
  path.join(ROOT, 'public', 'index.html'),
  /* ⚠ worker.js IS SOURCE TOO, and was not scanned until U22. The Transport
     Keys endpoint, the Aza store, the Shop and the Stripe Connect payout rail
     all live in it — every real-money path the game has — and none of it was
     covered. A file nothing scans is a file nothing notices, which is exactly
     how the warehouse mock drifted three keys away from its own server. */
  path.join(ROOT, 'worker.js'),
  /* 🚢 …and the deploy script, which is the only thing that keeps version.txt
     in step with BUILD_VERSION. Those two drifting apart is not cosmetic: the
     client compares them to decide whether a new build exists, so a stale
     version.txt silently switches off delivery of every fix. It went
     unnoticed for seventy builds precisely because nothing scanned this. */
  path.join(ROOT, 'deploy.mjs'),
  path.join(ROOT, 'public', 'src', 'economy', 'tuning.js'),   // the crew ladder, and every economic constant
  path.join(ROOT, 'public', 'src', 'broadcast', 'phone.js'),
  path.join(ROOT, 'public', 'src', 'broadcast', 'sources.js'),
  path.join(ROOT, 'public', 'src', 'work', 'work.js'),
  path.join(ROOT, 'public', 'src', 'work', 'crew.city.js'),
  /* 🛍 …and the retail layer that decides what every shop in every city earns.
     It is the only file in the tree that can hand a player a million Cinder a
     day, which is precisely the reason it is scanned. */
  path.join(ROOT, 'public', 'src', 'city', 'patronage.js'),
  /* 👥 …and the population simulation, which is the only thing allowed to move
     a city's head-count. Its ledger has to balance exactly; U36 audits it. */
  path.join(ROOT, 'public', 'src', 'city', 'population.js'),
  /* 🏠 …and the household layer above it, which has its own invariant: every
     person the ledger counts is in a household or explicitly homeless. */
  path.join(ROOT, 'public', 'src', 'city', 'households.js'),
  /* 🗺 …and Ethos Heights. poi.js in particular: the four difficulty strings
     it emits are what carry faction pressure into the run engine, matching
     index.html's OWN regexes, so a well-meant rename there removes enemy
     levels and downgrades the loot table with nothing failing anywhere.
     state.js holds the shared-city seam — and the rule that the LOCAL tick
     stands down once the server is ticking. */
  path.join(ROOT, 'public', 'src', 'missions', 'poi.js'),
  path.join(ROOT, 'public', 'src', 'missions', 'state.js'),
  path.join(ROOT, 'public', 'src', 'missions', 'train.js'),
  path.join(ROOT, 'public', 'src', 'missions', 'render.js'),
  path.join(ROOT, 'public', 'src', 'missions', 'encounters.js'),
  /* 🧍 …and the district standing, which is the one thing on the map the
     CLIENT is allowed to move. It buys gameplay and must never buy Cinder —
     /src/influence is the server-owned ladder and this only reads it. */
  path.join(ROOT, 'public', 'src', 'missions', 'citizens.js'),
  /* 🏛 …and Ethos Heights' civic dilemmas, which write BOND — the one player
     asset in this game that cannot be re-earned by grinding. The corpus, the
     one tuning table, the bond arithmetic, the modal and the host whitelist:
     all five, because the seam that actually broke during this work was a
     capability present in the bridge and absent from makeHost, which is a
     silent no-op in a file nothing was scanning. */
  path.join(ROOT, 'public', 'src', 'dilemma', 'data.js'),
  path.join(ROOT, 'public', 'src', 'dilemma', 'engine.js'),
  path.join(ROOT, 'public', 'src', 'dilemma', 'index.js'),
  path.join(ROOT, 'public', 'src', 'dilemma', 'render.js'),
  path.join(ROOT, 'public', 'src', 'dilemma', 'rewards.js'),
  /* 🗺 …and the three files that decide WHERE the ground is. They all hash one
     string — the city's ground id — to place the aquifers, the ore and the oil,
     so a change to any of them moves the world under every existing city. The
     seed itself lives in node-city/index.html, which is scanned below. */
  path.join(ROOT, 'public', 'src', 'resmap', 'fields.js'),
  path.join(ROOT, 'public', 'src', 'resmap', 'index.js'),
  path.join(ROOT, 'public', 'src', 'water', 'network.js'),
  path.join(ROOT, 'public', 'src', 'water', 'index.js'),
  /* 💵 …and the dollar peg, which is the only place in the tree that says what
     a Cinder is worth in real money. Both the Bank of Ethos and the Crash
     Exchange read it; a drift here shows up as two screens disagreeing in
     front of a player about how much they have. */
  path.join(ROOT, 'public', 'src', 'econ', 'peg.js'),
  /* 🏅 …and the milestone table, which is the only thing that pays for the
     development tree. It is scanned because the two have to stay in balance
     and had already fallen out of it — see U32. */
  path.join(ROOT, 'public', 'src', 'progression', 'milestones.js'),
  /* 🚜 the warehouse forklift.
     ⚠ public/warehouse/index.html IS ALREADY IN THIS LIST, higher up. Adding
       it again made the gate concatenate the file TWICE, so every marker in it
       counted double and U15 went red for a line nobody had touched. A list of
       paths has no natural defence against that — check before appending. */
  path.join(ROOT, 'public', 'src', 'warehouse', 'forklift.js'),
  // …and the build script for the model, so a re-export cannot skip the squeeze
  path.join(ROOT, 'tools', 'build-forklift.mjs'),
  path.join(ROOT, 'public', 'corp', 'screens.jsx'),
  path.join(ROOT, 'public', 'corp', 'shell.jsx'),
  /* 🏢 …and the two the corporation UI actually lives in. app.jsx holds every
     Just Business screen (the switcher, Contribute); corp/index.html holds the
     cache-bust query on all five .jsx tags, without which a change to any of
     them never reaches a player who has loaded the page before.
     ⚠ Adding files here shifts the COUNT of any existing marker that also
       appears in them. Re-verified after adding: the scan reported the same
       pass on every other piece, before and after. */
  path.join(ROOT, 'public', 'corp', 'app.jsx'),
  path.join(ROOT, 'public', 'corp', 'index.html'),
  path.join(ROOT, 'public', 'node-city', 'index.html'),   // the city builder is a fourth catalog
  /* 🚛 …and freight, which spans FIVE files: the truck yard is in index.html,
     the rig table and the refusal sentences are ES modules under public/src,
     and the destination rule is a migration. The same reasoning as the line
     above — T1's yard is stocked by index.html and rendered from a catalogue
     that only exists in /src/transport, so a scan that cannot see both cannot
     tell a live feature from half of one.
     ⚠ Adding a file here changes the COUNT of every existing marker that also
       appears in it. Checked before adding: the scan reported the same 20
       markers, all passing, before and after. */
  path.join(ROOT, 'public', 'src', 'transport', 'contracts.js'),
  /* 🗣 …and the four the two panels a player reads are WRITTEN in. The Zone
     Demand meter and the citizen dossier both live entirely under public/src,
     so a scan that stops at index.html could not see that either of them said
     anything at all — which is how they came to be printing "read from
     /src/economy snapshot().want / .unmet" at a player for as long as they
     did. lifepath is here because its sentences are quoted VERBATIM into the
     citizen panel: "/src/mortality retires the OLDEST resident" reached the
     screen from a file the panel does not contain.
     ⚠ Adding a file here changes the COUNT of every existing marker that also
       appears in it. Checked with --quick before and after: 160 markers, all
       27 pieces passing, identical both ways. */
  path.join(ROOT, 'public', 'src', 'hud', 'demand.js'),
  path.join(ROOT, 'public', 'src', 'hud', 'panel.js'),
  path.join(ROOT, 'public', 'src', 'citizen', 'facts.js'),
  path.join(ROOT, 'public', 'src', 'citizen', 'render.js'),
  path.join(ROOT, 'public', 'src', 'lifepath', 'model.js'),
  /* 🖥 …and the manifest, which is a FIX and not configuration: one word in
     it is the whole of "open the installed app fullscreen", and it lives in
     a file nobody opens twice. Everything else about that feature is
     defensive scaffolding around browsers that ignore it. */
  path.join(ROOT, 'public', 'manifest.json'),
  /* 💵 …and the Bank of Ethos app, whose entire UI is one .jsx the scan could
     not see. Its cache-bust lives in its host page, so both are listed. */
  path.join(ROOT, 'public', 'ethos', 'app.jsx'),
  path.join(ROOT, 'public', 'ethos', 'Bank of Ethos.html'),
  /* 🧰 …and the Dwelling app, which owns the storage chest. */
  path.join(ROOT, 'public', 'dwelling', 'index.html'),
  path.join(ROOT, 'public', 'src', 'transport', 'index.js'),
  path.join(ROOT, 'public', 'src', 'transport', 'depot.render.js'),
  path.join(ROOT, 'sql', '075_node_depot_index.sql'),
  /* 🗑 …and the migration that lets the corporation ledger tell a destruction
     apart from a withdrawal. The client prefers it and falls back silently, so
     without it in the scan set a deleted migration would never be noticed. */
  path.join(ROOT, 'sql', '087_corp_vault_drop.sql'),
  path.join(ROOT, 'sql', '088b_labour_reach.sql'),   // the reach rule 088 shipped without
  path.join(ROOT, 'sql', '089_shipment_cap_tracks_bays.sql'),
  /* 🚚 …and the warehouse app itself, which was NOT in this list — which is
     part of why its mock config drifted three keys away from the server
     (max_shipment_kg 1,800 vs a 20,000 kg warehouse, rent_grace_days 3 vs 1,
     rent_max_days 30 vs 90) directly beneath a comment saying it must mirror
     wh_config exactly. A file nothing scans is a file nothing notices. */
  path.join(ROOT, 'public', 'warehouse', 'index.html'),
  /* 💼 …and the economy seam the job fair reads. jobs() is where housing stops
     being advertised as employment and where tileBands() publishes the schooling
     each building demands — both are load-bearing for U19 and neither is visible
     from any file that was already scanned.
     ⚠ Adding a file here shifts the COUNT of any marker that also appears in it.
       Re-verified after adding: every other piece reported the same pass before
       and after. */
  path.join(ROOT, 'public', 'src', 'economy', 'index.js'),
  path.join(ROOT, 'public', 'src', 'economy', 'firms.js'),   // the wage bill, and the books a tile reads
  path.join(ROOT, 'sql', '076_depot_earnings.sql'),
  /* ⚡ …and the power package, which spans four files the same way freight does:
     the placement rule is in lines.js, the walk and the hook-up gate in grid.js,
     the animation in overlay.js and every number in tuning.js. A scan that could
     only see one of them would call the feature present while the half that
     makes it work had been reverted. */
  path.join(ROOT, 'public', 'src', 'power', 'lines.js'),
  path.join(ROOT, 'public', 'src', 'power', 'grid.js'),
  path.join(ROOT, 'public', 'src', 'power', 'overlay.js'),
  path.join(ROOT, 'public', 'src', 'power', 'tuning.js'),
];

const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const SKIP_SLOW = argv.includes('--skip-slow');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };

/* ── the pieces ────────────────────────────────────────────────────────────
   `markers` are the smallest strings that prove the mechanism is still in the
   file, with the count expected. Counts are asserted, not just presence: A1's
   flag must appear at EXACTLY two call sites, and a third would mean the live
   combat path had been given the AI's deterministic oracle by accident. */
const PIECES = [
  {
    id: 'A1', name: 'damage-determinism',
    what: 'the AI plans against an expectation, not one dice roll',
    driver: 'drive-ai-damage-determinism.mjs', slow: true,
    markers: [
      [', { aiExpectedValue: true }', 2],   // aiEstimateThreat + aiScoreAttack, no more
      ['hitChance: _evHit', 1],             // the estimate returns its own landing rate
      ['aiIncomingThreatDetailAt', 6],      // defender side: ev + landed + pHit
      ['const _isKO', 1],                   // attacker side: lethality read as landed
    ],
  },
  {
    id: 'A2', name: 'threat-reach',
    what: 'the threat map uses real range + move, not range 1',
    driver: 'drive-ai-threat-reach.mjs', slow: true,
    markers: [['_aiThreatReachOf', 2], ['_aiThreatReachFor', 2]],
  },
  {
    id: 'A3', name: 'spent-swing',
    what: 'the AI stops walking toward a swing it already spent',
    driver: 'drive-ai-spent-swing.mjs', slow: true,
    markers: [['!unit.hasAttacked', 3]],
  },
  {
    id: 'A4', name: 'summon-surface',
    what: 'the AI stops summoning onto burning tiles',
    driver: 'drive-ai-summon-surface.mjs', slow: true,
    markers: [['SURFACE AWARENESS', 1], ['_surfaceAt(state, t.x, t.y)', 1]],
  },
  {
    id: 'M1', name: 'mp-authority',
    what: 'a client without the turn cannot overwrite the one that has it',
    driver: 'drive-mp-authority-gate.mjs', slow: true,
    markers: [],
  },
  {
    id: 'M2', name: 'mp-resync-stale',
    what: 'the resync dedup bypass is live on the Supabase path',
    driver: 'drive-mp-resync-stale.mjs', slow: true,
    markers: [['_wantResyncAnswer', 3]],
  },
  /* 🍔 Not AI and not multiplayer — but this runner exists because a driver
     nobody runs is not a test, and the kitchen is the newest thing in the tree
     with the most seams to come loose. Its three blocks were hand-ported from a
     branch whose index.html is 3 MB smaller, so the markers below are exactly
     the three joins that porting could have missed. */
  {
    id: 'K1', name: 'kitchen-restaurant',
    what: 'the Mythic Kitchen bridge is wired and the Restaurant op exists',
    driver: 'drive-kitchen-restaurant.mjs', slow: true,
    markers: [
      ['window.MythicKitchenBridge = {', 1],        // the seam
      ["id: 'btn-kitchen'", 0],                     // the title tile is REMOVED on purpose
      ["_ownsRestaurant", 3],                         // the 20x food ownership test
      ["RESTAURANT_FOOD_MUL", 2],                     // named once, used once
      ["openKitchen", 4],                             // index.html: method + guard · node-city: branch + call
      ['src/kitchen/index.js', 1],                  // the module <script>
      ['  restaurant:   { startup: 320000', 1],     // the economy row
      ["  restaurant: 'Restaurant',", 1],           // the shop label
      // the three joins the OperaFind miss proved were NOT covered by OPS_ECON
      ["{ id: 'restaurant',", 1],                    // the hardcoded shop registry
      ["openMythicKitchen", 3],                      // shell.jsx: the action + its comment; index.html: the handler
    ],
  },
  /* 🚛 FREIGHT. Both pieces below are the same class of bug as the Restaurant:
     a thing that exists, is priced, is saved — and has no screen. The rigs were
     rolled onto the Prince Portfolios floor for a week and no renderer drew
     them, which is indistinguishable from the generator being broken. */
  {
    id: 'T1', name: 'pp-haul-rigs',
    what: 'a Prince Portfolios owner has a screen that sells trucks',
    driver: 'drive-pp-rigs.mjs', slow: true,
    markers: [
      // The four places a PP tab must appear, which is the local version of the
      // four-catalogue trap: miss one and the tab is unreachable, or reachable
      // and blank, or painted and dead.
      ["rigs:     { title: 'HAUL RIGS'", 1],          // the header
      ["navItem('rigs',", 1],                         // the nav entry
      ["else if (tab === 'rigs')     body = _ppRenderRigs(p);", 1],
      ["else if (tab === 'rigs')    _ppBindRigs();", 1],
      ['function _ppRenderRigs(', 1], ['function _ppBindRigs(', 1],
      // …and the stocker, without which the tab is an empty shop at random.
      ['function _ppGenRigListing(', 1],
      ['_ppStockRigs(p)', 3],                         // ppTick + ppForceRefresh + its own definition
      ['function _ppGenListing(forceHaul)', 1],       // the one argument the stocker needs
    ],
  },
  {
    id: 'T2', name: 'depot-gate',
    what: 'freight can only be delivered where a Transport Depot stands',
    driver: 'drive-depot-gate.mjs', slow: false,
    markers: [
      // the server rule
      ['create trigger transport_contracts_depot_gate', 1],
      ["raise exception 'no_depot_at_destination'", 1],
      ['create or replace function public.node_has_depot', 1],
      /* THE COLUMN AND ITS ONE READER, not a count of the NAME. The first cut
         of this marker counted every `require_depot_at_destination` in the file
         at 7 — and adding a paragraph to the header that quoted the column name
         made it 8 and turned the gate red for a comment. A marker that a
         comment can break is a marker people learn to edit rather than trust. */
      ['add column if not exists require_depot_at_destination', 1],
      ['f.require_depot_at_destination into v_req', 1],
      // the client's three halves: the sentence, the pre-flight, the panel
      ['no_depot_at_destination:', 1],                // the CODES entry
      ['const gate = await depotGate();', 1],         // the pre-flight, above the escrow
      ['function depotGateNote(', 1],
      ['explainError:', 1],                           // lent to index.html's board
    ],
  },
  {
    id: 'T3', name: 'truck-depot',
    what: 'any player can build the depot freight needs, and it pays them',
    driver: 'drive-truck-depot.mjs', slow: true,
    markers: [
      // the building, and the two places it has to appear or it is unreachable
      ["truckdepot:{ name: 'Truck Depot'", 1],
      ["'depot', 'truckdepot'", 1],                   // the Infrastructure section
      /* 🔴 THE STRING THE SERVER MATCHES ON, pinned in BOTH files. This is the
         bug T3 exists for: sql/075 indexed `transport`, a type no tile has ever
         had, so the destination gate was unsatisfiable and looked exactly like
         "nobody has built one yet". If either side is edited alone, this goes
         red instead of freight silently going nowhere. */
      ["in ('truckdepot', 'op_transport', 'transport')", 1],
      ['TD_TYPES = { truckdepot: 1, op_transport: 1 }', 1],
      // the money: the fee, its funding leg, and the claim
      // 2: the definition and its revoke. Counted rather than "present" so
      // deleting the revoke — which would publish a config probe to every
      // client — fails here too.
      ['function public.depot_fee_for', 2],
      ["kind, memo)", 1],                             // the negative 'toll' leg
      ['create or replace function public.depot_claim', 1],
      ['depotClaim: async', 1],                       // the bridge seam
      ['function truckDepotAugmentInspect(', 1],      // the panel
    ],
  },
  {
    id: 'C1', name: 'menu-heroes-never-wipe',
    what: 'a live character roster cannot be shown as empty, or published away',
    driver: 'drive-menu-heroes.mjs', slow: true,
    markers: [
      ['function _mdPublishedHeroes(', 1],            // reads what is LIVE, not local
      // 3: the button in each of the two banners, plus the click handler. A
      // banner without a handler is a dead button; a handler without a banner
      // is a feature nobody can reach.
      ['data-restore', 3],
      ["refused to write an empty roster", 1],        // the IDB guard
      ['🛑 Refused: this would remove all ', 1],       // the publish refusal
      ['_pubShrinkOk', 4],                            // declare, test, set, clear
    ],
  },
  {
    id: 'C2', name: 'card-effects',
    what: 'grave-fusion Polycreation, and an alias that counts in chosen zones',
    driver: 'drive-card-effects.mjs', slow: true,
    markers: [
      ["{ id: 'polyFromGrave'", 1],
      ["'polycreate','polyFromGrave'", 1],            // grouped in the dropdown
      ["ga.effect.type === 'polycreate' || ga.effect.type === 'polyFromGrave'", 1],
      ['const _pin = String(ga.effect.summonCardId', 1],   // the Kalon pin
      ['const TREAT_AS_ZONES', 1],
      ['function _treatAsZonesOf(', 1],
      ['ed-treatas-zone', 2],                         // the four tickboxes + their save
    ],
  },
  {
    id: 'W1', name: 'power-grid',
    what: 'cable crosses the city, what it runs through is powered, plants must reach the connector',
    driver: 'drive-power-grid.mjs', slow: false,
    markers: [
      // the placement rule that used to make the tool unusable
      ['THE OCCUPANCY REFUSAL USED TO BE HERE', 1],
      ['if (occupied(c.x, c.z)) continue;', 1],       // …and the pole that is still refused
      // the load attaches to a cable on its OWN tile
      ['const own = road.get(K(l.x, l.z));', 1],
      // the hook-up rule and its two switches
      // 4: the tuning key, its own long comment, the gate's read, and the
      // note in grid.js that names it. Counted, so deleting the gate while
      // leaving the prose that describes it fails here.
      ['requireConnector', 4],
      ['const fromConn = new Set();', 1],
      // the evening peak
      ['byHour: {', 1],
      ['const _peakMult', 1],
    ],
  },
  {
    id: 'W2', name: 'power-surge',
    what: 'a cable that is carrying current visibly surges, and a dead one does not',
    driver: 'drive-power-surge.mjs', slow: true,
    markers: [
      ['function surge(x, z, col, w)', 1],
      ['surge: { on: true', 1],
      ['lvSurge', 2],                                 // the colour in tuning + the read in overlay
      ['function flowFrame(', 1],
      ['export function __canvasData()', 1],          // the seam the A/B photographs
    ],
  },
  /* 🃏 THE FOUR SCOPED CARD FEATURES, built this round. Each has a driver that
     exercises it on a real board, and markers that pin the mechanism so a later
     edit cannot quietly revert one while the suite still reads green. */
  {
    id: 'X1', name: 'multi-target',
    what: 'a card can hit N things, picked one at a time, with a confirm',
    driver: 'drive-multi-target.mjs', slow: true,
    markers: [
      ['function _targetCountOf(', 1],
      ['function _applyEffectToTargets(', 1],
      ['function _aiPickTargetsFor(', 1],
      ['const alreadyPicked', 1],                     // the double-pick refusal
      ['function _confirmTargeting(', 1],
      ['ed-onplay-targetcount', 2],                   // the editor field + its save
      // ⛓ the chain mode lives in the same driver
      ['const _chainTogether', 1],
      ['const _pinnedPrimary', 1],                    // pins taken BEFORE anything resolves
      ['ed-onplay-chain', 2],
      ['ed-onplayx-add', 1],                          // the compact + control
    ],
  },
  {
    id: 'X2', name: 'zone-triggers',
    what: 'cards act from the graveyard AND from the Void, on the turn beat',
    driver: 'drive-zone-triggers.mjs', slow: true,
    markers: [
      ['function _applyInZoneTick(', 1],
      ['function _applyInVoidTick(', 1],
      // 5: one definition + the four beats it was wired into
      ['_applyInVoidTick(', 6],
      ["const FIELD = isVoid ? 'inVoid' : 'inGrave'", 1],
      ['ed-ig-where', 2],
    ],
  },
  {
    id: 'X3', name: 'mutate',
    what: 'a unit played onto another, with host legality — and the AI plays it too',
    driver: 'drive-mutate.mjs', slow: true,
    markers: [
      ['function _mutateHostCheck(', 1],
      ['function mutateOnto(', 1],
      ['function _mutateHosts(', 1],
      ['const hostFrac', 1],                          // proportional wear, not absolute
      ['ed-mutate-on', 3],                            // the toggle, its read, its save
      // the click path — a mutate card on an occupied tile is the PLAY
      ['_mutateSpecOf(card) : null', 1],
      /* 🔴 …AND THE PLAYER CAN ACTUALLY REACH IT. Every rule above passed for
         months while the card was unplayable: BOTH boards send a click that
         landed on a unit to onUnitClick (the DOM board via its .unit handler,
         the 3D board via board:tileClick with a unitId), and onUnitClick
         opened with `if (App.ui.selectedCardId) return;` — so holding a mutate
         card and clicking the host did nothing at all. No play, no details,
         no refusal. The seam could do what the UI could not. */
      ['if (_mt) { onTileClick(_mt.pos.x, _mt.pos.y); return; }', 1],
      /* 🎯 …and the legal hosts light up. A mutate card's targets are OCCUPIED
         tiles, exactly what getValidPlacementTiles filters out, so holding one
         lit up nothing standing and the player had to guess. */
      ["_mutateHosts(s, 'player', moveCard).forEach", 1],
      // 🤖 the AI side: it decides, and it resolves on its own board
      ['function _aiPickMutate(', 1],
      ['function _aiMutateResolve(', 1],
      ['Phase 0.9: MUTATE', 1],
      // the margin is the one tunable number in the decision
      ['best.worth * 1.35 + 10', 1],
    ],
  },
  {
    id: 'X4', name: 'scale-per',
    what: '"…for EACH Abra Morpher in your graveyard" — one multiplier, every effect',
    driver: 'drive-scale-per.mjs', slow: true,
    markers: [
      // the engine multiplier itself, and the fact it is read off the effect
      // being resolved (which is what makes the extras scale for free)
      ['const _sp = card && card.onPlay && card.onPlay.scalePer', 1],
      ['_scaledBy: _n', 1],
      // the card must SAY what it counts, or the printed Amount is a lie
      ['function _describeScalePer(', 1],
      ['+ _aoeSuf + _scaleSuf', 1],
      // authoring: the primary slot (render + save) and the extra slots
      // the block now lives in the targeting section and names its own card:
      // render + save + the live preview all reference these
      ['ed-onplay-scalezone', 3],
      ['ed-onplay-scalename', 3],          // its OWN name field, not the hit filter
      ['ed-scale-preview', 2],             // the sentence read back to the author
      ['ed-onplayx-${i}-scalezone', 1],              // the render
      ["'ed-onplayx-' + i + '-scalezone'", 1],        // the save
    ],
  },
  {
    id: 'W3', name: 'power-why',
    what: 'a plant making nothing says what is stopping it, instead of reading as a broken grid',
    driver: 'drive-power-why.mjs', slow: true,
    markers: [
      // the seam that was dropping it: the host took the factor and binned the reason
      ['const _pwWhy = Object.create(null)', 1],
      ['p.why = _pwWhy[p.k]', 1],
      // grid.js carries it onto the row the panel and the tooltip read
      ["why: link ? (p.why || '')", 1],
      // …and the tile tooltip turns the module's token into a sentence
      ["night: 'The sun is down", 1],
    ],
  },
  {
    id: 'W4', name: 'battery',
    what: 'a buildable battery banks the daytime surplus and carries the city after dark',
    driver: 'drive-battery.mjs', slow: true,
    markers: [
      // the building itself, and the flag that makes it storage rather than a plant
      ["battery:  { name: 'Grid Battery'", 1],
      ['if (def.pwStore) pwStores.push(', 1],
      ['stores: pwStores,', 1],
      // capacity and discharge, both scaled by REACHABLE banks
      ['perBatteryUnitMin: 600', 1],
      ['dischargePerMinPerBattery: 6.0', 1],
      ['const batts = byStore.filter(b => b.linked)', 1],
      // …and the per-bank rows the tile tooltip reads
      ['batteries: batts.length }, byStore', 1],
    ],
  },
  {
    id: 'U1', name: 'notify-bell',
    what: 'passive alerts wait in a bell instead of painting over the screen',
    driver: 'drive-notify-bell.mjs', slow: true,
    markers: [
      ['function notify(msg, opts)', 1],
      ['function notifOpen(', 1],
      // the bell itself, and the modal it opens
      ["b.id = 'notif-bell'", 1],
      ['id="notif-list"', 1],
      // the reported message takes the quiet channel now, not showToast
      ["notify('⚠ Camp ran out of '", 1],
      // …and a repeat bumps the row already there rather than stacking
      ['last.count = (last.count || 1) + 1', 1],
    ],
  },
  {
    id: 'U2', name: 'corp-contribute',
    what: 'one corp per player, the bank funds YOURS, and joined corps get Contribute',
    driver: 'drive-corp-contribute.mjs', slow: true,
    markers: [
      // the founded corp is resolved once, and the bank targets it
      ['const _target = Corp.owned || null;', 1],
      ['corp_id: _target.id, user_id: Profile.cloud.userId,', 1],
      // the payload the panel switches on
      ['actingInJoined:', 1],
      ['founded: !!(Corp.owned && Corp.owned.id === x.id)', 1],
      // the two new surfaces
      ["a.kind === 'corpContribute'", 1],
      ['function ContributePanel(', 1],
      ['function _corpOnlyOneModal(', 1],
      /* …and the cache-bust, without which none of the .jsx above reaches a
         player. ⚠ PINS THAT THERE IS ONE, NOT WHICH ONE. This marker used to
         carry the literal v121q10 and went red the first time the bust was
         bumped for an unrelated fix — reporting U2 as LOST when nothing about
         U2 had changed. A gate that cries wolf on every deploy is a gate
         people learn to skip. */
      ['shell.jsx?v=', 1],
    ],
  },
  {
    id: 'U3', name: 'prn-collect',
    what: 'each PRN pays its own 24h allowance instead of sharing one across them all',
    driver: 'drive-prn-collect.mjs', slow: true,
    markers: [
      // the allowance reader takes a node; without it one collect zeroed them all
      ['function _nodeDayUsed(n) {', 1],
      ['function _nodeDayLeft(n) { return Math.max(0, _nodeDailyCap() - _nodeDayUsed(n)); }', 1],
      // …and both callers pass their own node
      ['const dayLeft = _nodeDayLeft(n);', 1],
      ['const _left = _nodeDayLeft(n), _capD = _nodeDailyCap();', 1],
      // the refusal names the PRN rather than the player
      ["has reached its daily payout limit", 1],
    ],
  },
  {
    id: 'U4', name: 'scroll-keep',
    what: 'a re-render no longer throws the player back to the top, and the Forge keeps its sections open',
    driver: 'drive-scroll-keep.mjs', slow: true,
    markers: [
      // positions are recorded passively, never scanned per render
      ['window.__scrollMem = { map: new Map(), screen: null, userAt: 0 };', 1],
      ['function _scrollScreenKey(', 1],
      ['M.map.set(key, { top: el.scrollTop, left: el.scrollLeft });', 1],
      // …and the guard asks the recorder, not the snapshot it used to compare to itself
      ['const sameScreen = !!(mem && window.__scrollMem.screen === _nowKey);', 1],
      // the Forge accordion, remembered across the rebuild
      ['function _fxOpen(id) {', 1],
      ['_edRoot._fxOpenBound = true;', 1],
      ["_fxOpen('fx-effects')", 1],
    ],
  },
  {
    id: 'U5', name: 'mayor-city',
    what: 'a mayor gets into the cities they run, and the way home lands on their own',
    driver: 'drive-mayor-city.mjs', slow: true,
    markers: [
      // owning land and having a city are different facts
      ['const myCities = (cities.error ? [] : (cities.data || []))', 1],
      ['App._myCityNodes = myCities.map', 1],
      // …and a city of my own is the third way in
      ['const iHaveACityHere =', 1],
      ['if (!iOwnIt && !iAmMayor && !iHaveACityHere) {', 1],
      // the client list, and the door to it
      ['function _twMyMayorNodes(', 1],
      ['function _openClientCity(', 1],
      ['__mg._openClientCity = _openClientCity', 1],
    ],
  },
  {
    id: 'U6', name: 'city-mesh',
    what: 'every building builds its mesh — a throw there aborts the load and silently blocks every save',
    driver: 'drive-city-mesh.mjs', slow: true,
    markers: [
      // the two arms that read variables which do not exist in that scope
      ["case 'college':    { _adopt(g, makeOffice(lvl, tx, tz), true); break; }", 1],
      ["case 'university': { _adopt(g, makeOffice(lvl, tx, tz), true); break; }", 1],
      ['makeOffice(lvl, x, z)', 0],
      // …and the three rows that had no recipe at all
      ["ico: '📊', mesh: 'office'", 1],
      ["ico: '🏦', mesh: 'office'", 1],
      ["ico: '🔧', mesh: 'machineshop'", 1],
    ],
  },
  {
    id: 'U7', name: 'listing-cap',
    what: 'the browser, the RPC and the trigger all read the membership the player paid for',
    driver: 'drive-listing-cap.mjs', slow: true,
    markers: [
      // the browser stopped carrying its own number
      ['function _traderSlots()', 1],
      ['RES_MARKET_MAX_ACTIVE    = 15', 0],
      // …and both markets ask it, counting one shared pool
      ['const _slots = _traderSlots();', 3],
      // 3 client guards + the 2 in the server-error handler
      ['Marketplace full — ', 5],
      // the fallback is the free tier and nothing else
      ['const RES_MARKET_FREE_SLOTS    = 15;', 1],
    ],
  },
  {
    id: 'U8', name: 'plain-english',
    what: 'the panels tell a player where a number came from in words, not in module paths and call names',
    driver: 'drive-plain-english.mjs', slow: true,
    markers: [
      /* 🔴 EVERY MARKER HERE IS A ZERO EXCEPT THE LAST TWO, and that is the
         point: this piece is the ABSENCE of something. A count of 1 on any of
         these means a line of code speak came back into a panel. */
      // the Zone Demand provenance lines, exactly as they were reported
      ["src: '/src/economy snapshot().want / .unmet'", 0],
      ["src: '/src/economy labourMarket() + /src/demographics ladder()'", 0],
      ["src: '/src/zoning stats()'", 0],
      ['>read from ', 0],
      // the citizen dossier's
      ["'agent.phase = ' + a.phase", 0],
      ["'MythicDossier.householdOf('", 0],
      ["'MythicCitizens.get().job = '", 0],
      ["'citEmpSync() found no firm on tile '", 0],
      ["and ECON.demographics.education.requires.' + bi.band", 0],
      ["+ ' on ECON.firm.levels ' +", 0],
      // …and the one quoted in from the ageing model
      ["retires the OLDEST resident (never citEnsure()", 0],
      // what replaced them: the panels still name their source, in words
      ['Where this comes from: ', 1],
      ['Every row above says where its answer came from.', 1],
    ],
  },
  {
    id: 'U9', name: 'auto-fullscreen',
    what: 'the installed app opens fullscreen by itself, and a browser tab is still left alone',
    driver: 'drive-autofullscreen.mjs', slow: true,
    markers: [
      // 🔴 THE FIX. One word, in a file that is read once a year.
      ['"display": "fullscreen"', 1],
      ['"display_override": ["fullscreen", "standalone", "minimal-ui"]', 1],
      ['"display": "standalone"', 0],
      // …and the arm that covers the launches the manifest cannot reach
      ['window.FS.launchedAsApp = function ()', 1],
      ['function _armAutoFs()', 1],
      ["var AUTOFS_KEY = 'hg_pwa_autofs';", 1],
      // the player's way out of it
      ['id="set-autofs"', 1],
    ],
  },
  {
    id: 'U10', name: 'corp-pay',
    what: 'paying a colleague moves real Cinder into their wallet instead of writing a note about it',
    driver: 'drive-corp-pay.mjs', slow: true,
    markers: [
      // the payment goes through the server function that actually moves it
      ['corp_pay_member', 5],
      ['it is in their wallet now', 1],
      // …and the payer is not taxed a second time for their own wages bill
      ['_gemsTaxExempt(() => { Profile.gems = Math.floor(_bal); });', 1],
      // 🔴 the ReferenceError that broke every non-Cinder transfer AND every
      //    claim of one, for as long as it stood in the wrong block
      ['HOISTED OUT OF THE corpKick BRANCH', 1],
      ['function _corpAssetMove(row, dir)', 1],
      // a server without the migration is named rather than swallowed
      ['sql/080_corp_pay_member.sql', 1],
    ],
  },
  {
    id: 'U11', name: 'rest-bonfire-scroll',
    what: 'battles tire heroes, the bonfire actually rests them, and a list stays where the player put it',
    driver: 'drive-rest-bonfire-scroll.mjs', slow: true,
    markers: [
      /* 🔴 THE OFF SWITCHES ARE GONE. v121q19 shipped this, v121q20 disabled it
         after a bad report, and this asserts we are not sitting in the
         half-state where the panel counts down a recovery that is not
         running — which is exactly what players saw between the two. */
      ['⛔ OFF (v121q20)', 0],
      ['const restedFully = isFull && (e.fatigue | 0) === 0;', 1],
      // the bonfire rests rather than only calming
      ['HERO_BONFIRE_FATIGUE  = 25', 1],
      ['Nothing to rest off', 1],
      /* the scroll abort, and NOT with `| 0` on it — a ms timestamp overflows
         32 bits, which made the first version of this fix silently inert. */
      ['Number(window.__scrollMem.userAt)', 1],
      ['userAt: 0', 1],
    ],
  },
  {
    id: 'U12', name: 'stamina-modal',
    what: 'the stamina panel stops rebuilding itself every second, which was eating both the scroll and the clicks',
    driver: 'drive-stamina-modal.mjs', slow: true,
    markers: [
      // the tick re-times the text instead of rebuilding the DOM
      ['const _tickCountdowns = (host, heroes) => {', 1],
      ['const _panelSig = (heroes) => {', 1],
      ['data-hr-tick', 3],
      // …and a rebuild that does happen keeps the place
      ['let _keepScroll = null;', 1],
      /* a player action always repaints, whatever the signature says.
         ⚠ Pinned on the SIGNATURE, not on a count of render(true) calls —
            the scan spans several files and other panels have their own. */
      ['const render = (force) => {', 1],
    ],
  },
  {
    id: 'U13', name: 'ethos-usd',
    what: 'the Bank of Ethos shows what the account is worth in USD instead of a fabricated live session',
    driver: 'drive-ethos-usd.mjs', slow: true,
    markers: [
      /* 💵 THE TWO RATES, NAMED ONCE SO A PEG CHANGE IS ONE LINE — and as of
         U30 that one line is in public/src/econ/peg.js, not in app.jsx. They
         moved because the Crash Exchange needed the same peg from a different
         document and app.jsx (Babel, no imports) could not export them.
         ⚠ THE MARKERS FOLLOWED THE CODE rather than being deleted: what U13
           actually claims is that the Bank values an account at the owner's
           rates, and that claim is still true — it just reads them now. */
      ['var USD_PER_CINDER = 1 / 5000;', 1],
      ['var USD_PER_AZA    = 1;', 1],
      ['const USD_PER_CINDER = _PEG ? _PEG.USD_PER_CINDER : 1 / 5000;', 1],
      ['const usdOf = (cinder, aza) => _PEG ? _PEG.usdOf(cinder, aza) : (', 1],
      // the panel that replaced the demo furniture
      ['<h3>Account Value</h3>', 1],
      ['function UsdCard(', 1],
      // …and the fabricated one is gone
      /* the rendered heading, not the words — app.jsx carries a comment
         explaining what was removed and why, and the marker must not fire on it */
      ['<h3>Live Session', 0],
      ['+12/sec · battle stream', 0],
      /* Without a cache-bust none of it reaches a returning player.
         ⚠ THE VERSION IS DELIBERATELY NOT PINNED HERE. This marker used to read
           the literal `app.jsx?v=v121q30`, which turned every ROUTINE bump of
           that bust into a red "MISSING FROM THE FILE" — the gate crying that
           work had been deleted when the only thing that changed was a version
           string. A marker that fires on correct maintenance teaches you to
           ignore it, and this gate already lost a piece that way. What actually
           matters is that the tag is busted AT ALL, so that is what is asserted;
           whether the bump is fresh is the deploy checklist's job, not this scan's.
         ⚠ AND IT IS ANCHORED TO THE TAG ABOVE IT, because `app.jsx?v=` on its own
           matches TWO files in the scan set — the bank loads ethos/app.jsx and the
           corporation shell loads corp/app.jsx, with tags identical but for the
           indentation. A bare needle counted 2 and reported this piece GONE. The
           tweaks-panel tag directly above it exists only in the bank, so the pair
           names the bank's tag and nothing else, at any version. */
      /* ⚠ THE ADJACENCY IS THE POINT, and U30 proved it. The identical
         app.jsx tag also exists in corp/index.html and base/index.html, both
         scanned — so `src="app.jsx?v=` alone matches three files and says
         nothing about THIS one. tweaks-panel.jsx is unique to the Bank, and
         pairing them is what makes this marker about the Bank's bust.
         U30 briefly inserted the shared peg tag between these two lines; the
         tag was moved above tweaks-panel rather than this marker weakened. */
      ['src="tweaks-panel.jsx"></script>\n<script type="text/babel" src="app.jsx?v=', 1],
      /* …and the printed statement carries the same figure, from the same
         helpers, so a PDF cannot disagree with the screen it was printed from */
      ['<h2>Account Value</h2>', 1],
      ['Banked resources listed below are <b>not</b> included', 1],
    ],
  },
  {
    id: 'U14', name: 'vault-caps',
    what: 'the base vault stops at 31,250 - exactly where the thirteenth Relic door lands - with its surplus counted, the bank stays at 15,500, the market stops selling at the same place the maths does, and a storage chest is the size of its property',
    driver: 'drive-vault-caps.mjs', slow: true,
    markers: [
      // the ceiling, and the row limit that must land exactly on it
      /* 🔴 RAISED ON THE OWNER'S INSTRUCTION, 2026-09-02. The old pair was a
         real decision — this piece pinned a vault with 9,000 stashExtra as
         STILL reading 15,500, i.e. the surplus was clamped away on purpose.
         The new pair honours it: 72 rows x 250 = 18,000 plus twelve Relic
         doors x 1,000 = 30,000. The rule that the row limit and the unit
         limit must be the SAME limit is unchanged; only the instruction is. */
      ['const RES_STASH_MAX = 31250;', 1],
      ['const VAULT_MAX_ROWS = 73;', 1],
      /* ⚠ …and the BANK is a different vault that only shared the number. */
      ['const BOE_VAULT_CAP = 15500;', 1],
      /* the ceiling caps PURCHASES; the free floor sits outside it */
      ['Math.max(_resStashFloor(), Math.min(RES_STASH_MAX, bought))', 1],
      // the chest takes its size from the property
      ['function _dwStashSlots()', 1],
      ['function _chestCap(meta)', 1],
      ['stashSlots: _dwStashSlots()', 2],
      // …and no chest carries the old flat 200 any more
      ['g.userData.cap=meta.cap||200', 0],
      /* 🏦 a full corp vault is a STANDING state, not a retryable mistake, so
         it gets a modal that says nothing was taken and names the number to
         withdraw down to. The other refusal reasons keep their toast. */
      ['function _corpVaultFullModal(', 1],
      ["if (d.reason === 'vault_full') {", 1],
    ],
  },
  {
    id: 'U15', name: 'wh-rpc-allow',
    what: 'every warehouse RPC the client calls is on the allowlist that gates it — a new RPC left off ships dead',
    driver: 'drive-wh-rpc-allow.mjs', slow: true,
    markers: [
      // the three that were left off and shipped dead features
      ['wh_set_rent_rate: 1, wh_renew_unit: 1,', 1],
      ['van_livery_begin_logo: 1,', 1],
      // …and the gate itself, which is the right design and must stay
      ['if (!WH_RPC_ALLOW[fn]) return null;', 1],
      /* 🚚 ONE NUMBER, THREE COPIES, AND THEY MUST AGREE. max_shipment_kg lives
         in wh_config() (the authority), in the standalone yard mock, and in the
         host fallback used before the RPC answers. It sat at 1,800 in all three
         for six months after sql/083 made a tier-1 bay ten times larger, so
         filling one starter warehouse took twelve trips. The SQL derives it
         from the bay floor now; these two mirrors are literals because neither
         has a server to ask, which is exactly why they need pinning. */
      ['max_shipment_kg: 18000,', 1],
      ['WH_MAXKG = 18000', 1],
      ["'max_shipment_kg', (public.wh_bay_floor(1) * 4 * 9 / 10)::int,", 1],
    ],
  },
  {
    id: 'U16', name: 'food-fallback',
    what: 'a kitchen with no rations is charged for no more raw food than the coverage layer will credit it for',
    driver: 'drive-food-fallback.mjs', slow: false,
    markers: [
      // the cap, and the uncapped charge that ate every farm output
      ['const maxFromRaw = want * RAW_FOOD_SUBSISTENCE;', 1],
      ['const need = Math.min(short, maxFromRaw);', 1],
      ['const cost = short * RAW_FALLBACK_MULT;', 0],
    ],
  },
  {
    id: 'U17', name: 'resource-editor',
    what: 'the Forge can re-skin all 394 resources, weigh them, create new ones, and say which city buildings consume them',
    driver: 'drive-resource-editor.mjs', slow: true,
    markers: [
      // the 245 chain resources are storable, and carry weights
      ['THE CHAIN CATALOGUE, PROMOTED TO STORABLE', 1],
      ['function resourceWeight(id)', 1],
      // the editor: weight, needs, and a filter for 394 rows
      ['id="res-wt"', 1],
      ['id="res-needs"', 1],
      ['id="res-filter"', 1],
      ['function _needsFromText(t)', 1],
      // …and the half that makes a declaration real
      ['window.cityResourceNeeds', 1],
      ['async function _ncResourceNeeds()', 1],
      ['await _ncResourceNeeds();', 1],
      // the silent weight reset the driver caught
      ["if (wtBad || (wtRaw !== '' && !(isFinite(wtNum) && wtNum > 0))) {", 1],
    ],
  },
  {
    id: 'U18', name: 'vault-drop',
    what: 'both vaults can be emptied without needing anywhere to put it — and the drop paths credit nothing, anywhere',
    driver: 'drive-vault-drop.mjs', slow: true,
    markers: [
      // the two destroyers
      ['async function boeDropRes(id, qty) {', 1],
      ["} else if (a.kind === 'vaultDrop') {", 1],
      // …reached from the bank bridge and the corp modal
      ["op === 'drop' ? boeDropRes(d.resId, amt)", 1],
      ["kind: wdMode === 'drop' ? 'vaultDrop' : 'vaultWithdraw',", 1],
      // …and from a button in each vault
      ['onClick={() => act("drop")}', 1],
      ["setWdMode('drop'); setWd(v);", 1],
      /* The hazard _boeResTx documents: a sufficiency check read OUTSIDE the
         section. The drop re-reads inside it, and this is that line. */
      ['const have = live[id] | 0;', 1],
      /* The corp drop prefers the RPC that logs a drop AS a drop — and falls
         back, because without that it ships dead until sql/087 is applied. */
      ["let r = await Cloud.client.rpc('corp_vault_drop', args);", 1],
      ["r = await Cloud.client.rpc('corp_vault_withdraw', args);", 1],
      ["values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'drop', p_kind, p_item_id,", 1],
    ],
  },
  {
    id: 'U19', name: 'jobfair-people',
    what: 'houses are out of the job adverts, the people with no work have names and schooling, and the player can send them to a job or to school',
    driver: 'drive-jobfair-people.mjs', slow: true,
    markers: [
      // housing is out of the paper but its upkeep posts are still counted
      ['const upkeep = { posts: 0, byBand: {} };', 1],
      ["if (f.ind === 'landlord') {", 1],
      ['Housing upkeep is also taking', 1],
      // the people half
      ['function citAptOf(id)', 1],
      ['unemployed: () => citizens.filter(c => !c.job)', 1],
      ['function _jfPeople(esc)', 1],
      // …and the two verbs, which are errands rather than instant switches
      ['function citTaskStart(citId, kind, targetKey)', 1],
      ['function citTaskTick()', 1],
      // the qualification gate that makes an unfilled seat possible at all
      ['function citQualifies(c, tileKey)', 1],
      ['  tileBands: () => {', 1],
      // the building, and the rate it moves
      ['employoffice:{name:', 1],
      ['function citHireChance()', 1],
      ["case 'employoffice':", 1],
    ],
  },
  {
    id: 'U20', name: 'building-ledger',
    what: 'every building keeps its own books — what customers spent, what it cost, whether it is making or losing money, and its lifetime trade',
    driver: 'drive-building-ledger.mjs', slow: true,
    markers: [
      // the seam that hands a firm's books to its tile
      ['  firmAt: (tileKey) => {', 1],
      // the card, and the verdict a player reads
      ["insCardHtml('Trading', 'measured by the economy, per economic day',", 1],
      ['Taken from customers today', 1],
      ['Trade profit, lifetime', 1],
      /* …and the sentence that replaced the stale claim. NOT written as an
         absence marker for the old text: three comments in these files QUOTE it
         to explain what was wrong and why, and a scan over file text cannot tell
         a quotation from a live string — it would have failed forever while the
         UI was correct. The absence is asserted where it can be judged properly,
         against the RENDERED pane, in the driver. */
      ['A projection of the rates above held for one cycle, not a measurement. ', 1],
      // the phantom field, now written
      ['f.lastWageBill = days > 0 ? bill / days : 0;', 1],
      // staffing on the tab the player opens first
      ["out.push({ e: 'Staff', v: fin.staffed", 1],
    ],
  },
  {
    id: 'U21', name: 'camp-labour',
    what: 'the Employment Board hires real residents out of other players cities instead of a constant it invented, and a city can see who could be taken',
    driver: 'drive-camp-labour.mjs', slow: true,
    markers: [
      // 🔴 the fiction is DELETED — the definition, not the explanation of it
      ['function _campRolePool(node, role)', 0],
      // the board asks the server, and hires through it
      ["rpc('camp_labour_market')", 1],
      ["rpc('camp_hire_from_city'", 1],
      ["rpc('city_labour_publish'", 1],
      // …and the city half of the ask
      ['function citLabourByRole()', 1],
      ['Camps can hire these people', 1],
      ["key: 'guard',   name: 'Standing watch'", 1],
      /* 🔴 THE REACH RULE. 088 alone matched NOTHING on the live database —
         measured: 21 camps registered to another player's node, 0 with a
         reachable city, because cities sit in nodes their owners do not own. */
      ['and (p.node_id = v_node or cp.owner_id = v_owner)', 1],
    ],
  },
  {
    id: 'U22', name: 'tkeys-worker',
    what: 'Transport Keys sell from the Worker where the Stripe key already lives, instead of an edge function whose secret store never had one',
    driver: 'drive-tkeys-worker.mjs', slow: false,
    markers: [
      // the module and its route
      ['async function handleTKeys(request, env, u)', 1],
      ["if (u.pathname.startsWith('/api/tkeys/')) {", 1],
      // the price table, server-side and authoritative
      ["'5': { name: 'Ashgate Key',  cents: 9900", 1],
      /* 🔴 THE CLIENT MUST NO LONGER CALL THE FUNCTION THAT CANNOT SELL.
         supabase/functions/transport-keys reads STRIPE_SECRET_KEY from a
         secret store the key was never put in, which is why transport_keys
         has 0 rows ever. An absence marker, so a revert cannot go unnoticed. */
      ["invoke('transport-keys'", 0],
      ['async function _tkeyApi(path, opts)', 1],
    ],
  },
  {
    id: 'U23', name: 'build-brief',
    what: 'a shop card opens a brief saying what the building is for, who it employs and what schooling they need — then the player places it or walks away',
    driver: 'drive-build-brief.mjs', slow: true,
    markers: [
      ['function openBuildBrief(type)', 1],
      /* 🔴 The card must NOT arm placement any more — that is the change. */
      ["b.onclick = () => openBuildBrief(b.getAttribute('data-build'));", 1],
      ["b.onclick = () => { closeBuildShop(); setMode('place', b.getAttribute('data-build')); };", 0],
      // the seam that can answer for a building that does not exist yet
      ['  previewBuilding: (outs, ind) => {', 1],
      /* …and the sentence that stands where an income estimate is NOT. An
         unexplained blank reads as a broken panel. */
      ['No income estimate is shown on purpose', 1],
    ],
  },
  {
    id: 'U24', name: 'coin-float',
    what: 'a coin floats off a business when somebody spends there — reading money that really moved, and minting none of it',
    driver: 'drive-coin-float.mjs', slow: true,
    markers: [
      ['function _coinPoll()', 1],
      ['function _coinFloat(tileKey, amount)', 1],
      ['@keyframes coinrise', 1],
      /* 🔥 IT READS CINDER, not the simulation's internal revenueDay — the
         first version watched the latter, which moves for firms with no Cinder
         line at all and never reaches the wallet. t.earn is what economyTick
         banks and what a player watches go up. */
      ['const earn = Number(t.earn) || 0;', 1],
      /* ⚠ NO ABSENCE MARKER FOR f.revenueDay HERE. It is READ legitimately in
         two other places — jobs() and firmAt() both need it — so a file-wide
         count can never say 'the coin poll stopped using it', only 'nothing in
         the scan set uses it', which would be false and would fail forever. The
         behaviour is proved where it can be judged: the driver banks Cinder to
         t.earn and watches the float appear. */
      /* …and a FALL is a rebuilt tile, never a refund. */
      ['if (earn < prev.rev) { prev.rev = earn; continue; }   // rebuilt: re-baseline', 1],
      // …and the layer must never intercept a click
      ['#coinlayer{position:fixed;inset:0;z-index:44;pointer-events:none;overflow:hidden}', 1],
    ],
  },
  {
    id: 'U25', name: 'build-crew-25',
    what: 'a Construction Company can be staffed up to 25 crews, so an invested city builds far more at once — while an unstaffed one still gets 2',
    driver: '', slow: false,
    markers: [
      /* 2 free + 1 per Co + 1 per worker, capped at 25. The free crew is",
         deliberately still 2 — see the note in tuning.js. */
      ['slots:     { perCo: 1, perWorkerStep: 1, max: 25 },', 1],
      ['municipal: { slots: 2, maxSec: 2400 },', 1],
      // …and a Company big enough to actually reach the ceiling
      ['salaryPerWorkerHr: 200, maxWorkers: 25', 1],
      /* 🔴 …AND A PLAYER WHO CAN ACTUALLY STAFF IT, which is the half this
         piece was missing and the reason the ceiling was unreachable in
         practice. Just Business drew the staffing controls behind `hasCorp`,
         disabled them on `!isOwner` and disabled the + on an empty corp labour
         pool — three conditions opAssign has ALWAYS exempted personally-funded
         operations from. The panel could not tell a personal op from a corp
         one because the payload never said, so a player who funded their own
         Construction Co. could not hire a single worker and their city sat at
         3 / 3 build gangs forever. A tuning table nobody can climb is not a
         feature, so the markers for it live in the same piece as the numbers. */
      ['localOnly: !!(o.meta && o.meta.localOnly),', 1],
      ['const mayStaff = local || (hasCorp && isOwner);', 1],
      /* 🔢 …and reaching 25 must not cost 25 clicks. opAssign already takes an
         absolute target, so Max needs no new handler. */
      ['onClick={() => setTo(cur + headroom)}>Max</button>', 1],
      // 🏗 the number's consequence, said on the screen that sets it
      ['🏗 Build gangs in your city:', 1],
    ],
  },
  {
    id: 'U26', name: 'prn-siting',
    what: 'a PRN licensed at the Foundation Reserve appears in the build shop and stands where the player puts it, instead of existing only as a row',
    driver: 'drive-prn-siting.mjs', slow: true,
    markers: [
      // the host seam, and the city half
      ['window.cityPrnSite = async function (prnId, x, y, rot)', 1],
      ['function prnReconcile()', 1],
      ["id: 'prn', name: 'Foundation Reserve'", 1],
      /* 🔴 undefined IS THE DELETE SENTINEL for _nodeMetaWrite. A 
         inside the mutate does nothing — the writer merges the returned PATCH
         onto the fresh server copy, so an absent key keeps the server value and
         the site would survive every unsite. */
      ['const r = await _nodeMetaWrite(n, () => ({ site: undefined }));', 1],
      /* 🔒 the third decorator has to know PRNs exist, or it strips their lock */
      ['const isOwnedElsewhere = isOp || isPrn;', 1],
      /* …and the TDZ guard: buildShopBody runs before this block is evaluated */
      ['var _prnReady = false;', 1],
      // the panel a sited PRN gets, and the figures it must not re-derive
      ['function prnAugmentInspect(k)', 1],
      ['          eff: _nodeEff(n),', 1],
      ['          claimable: Math.floor(_nodeClaimable(n) || 0),', 1],
      /* 🔴 status IS NEVER FLIPPED — measured live, all 30 PRNs finished weeks
         ago and every one still reads 'building'. The card must read the
         COMPUTED active flag or it calls every finished node unbuilt. */
      ['          active: _nodeActive(n),', 1],
      ['const building = free.some(r => r.active === false);', 1],
    ],
  },
  {
    id: 'U27', name: 'phone-jobs',
    what: 'the phone pings on news, a hiring business advertises itself, and an Unemployed tab places a resident into a job that needs one',
    driver: 'drive-phone-jobs.mjs', slow: true,
    markers: [
      // 🔔 the ping, and the two traps it has to avoid
      ['export function pingTick()', 1],
      ["src: '/assets/Audio/Phone notification.mp3',", 1],
      /* ⭐ the hiring subject was WRITTEN AND NEVER WIRED — sources.js warns
         about exactly this class of dead observer. */
      ['function fromHiring(ctx, pop)', 1],
      ['fromStreets, fromRoster, fromSchools, fromHiring]) {', 1],
      // 💼 the tab, the modal, and the one hiring path they must go through
      ["{ id: 'jobs',  label: 'Unemployed', view: 'jobs' },", 1],
      ['function openHireModal(personId)', 1],
      // 🎓 the schooling on both sides of the comparison, and 👤 the name route
      /* 3 = the CSS rule, the roster card's badge, and the modal header's. */
      ['bcp-jb-edu', 3],
      ["'<button type=\"button\" class=\"bcp-jb-name\" data-go=\"cit:' + esc(p.id) + '\"' +", 1],
      /* 🔴 An out-of-reach place is SHOWN and explained, not hidden — hiding it
         silently answered the question the player was asking. It carries no
         data-hire, so the refusal is unreachable rather than reachable. */
      ['bcp-hire-row locked', 1],
      ['const reachable = !need || (have >= 0 && lo >= 0 && have <= lo);', 1],
      ['try { r = M && M.sendToJob(who, at); } catch (e) { r = null; }', 1],
    ],
  },
  {
    id: 'U28', name: 'work-crew',
    what: 'units have work suitabilities and passives, are posted to buildings by hand, eat, and cap a building at x2.00 — ported onto this city rather than merged over it',
    driver: 'drive-work-crew.mjs', slow: true,
    markers: [
      ['function profileFor(card, salt)', 1],
      ["import('../src/work/crew.city.js", 1],
      ["MythicCitySave.register('crew'", 1],
      /* 🔴 THE PICKER FLAG IS THE SIXTH ARGUMENT HERE. The branch this came
         from had a three-argument picker and passed it fourth; this tree keeps
         emptyMsg and onClose there, so ported as-is the flag would have become
         the empty message and no work profile would ever have rendered. */
      ['function openCardPicker(title, filter, onPick, emptyMsg, onClose, showWork)', 1],
      /* ⚠ slot five now carries `restore`, not null — the enlist dialog hides
         itself while the picker is up and puts itself back on every exit (U31).
         The claim this marker makes is unchanged and is about slot SIX: the
         flag still has to sit past emptyMsg and onClose. */
      ['}, null, restore, true);', 1],
      /* 🔴 AND THE IFRAME BUST IS DERIVED. A literal here is served from the
         service-worker cache: found at v121h8 against a v121q47 build, which
         would have shown a returning player the OLD city inside the new shell
         with every other knob reporting success. */
      ["f.src = 'node-city/index.html?v=' + (window.BUILD_VERSION || 'dev');", 1],
    ],
  },
  {
    id: 'U29', name: 'patronage',
    what: 'residents get sick, get hungry, get lazy, work out and play Mythic Spellbook — and the standing shops they visit take their Cinder, scaled by mood, economy and how well the city is built, to a ceiling of 1,000,000 a day at the highest node tier',
    driver: 'drive-patronage.mjs', slow: true,
    markers: [
      /* 🔴 THE PROMISE, AS A LITERAL. "the highest node level can generate 1
         million cinder a day" is a number the owner asked for by name; if it
         moves, it must move deliberately and this line must move with it. */
      ['DAY_CAP_TOP: 1000000,', 1],
      ['TOP_TIER_RATE: 20,', 1],
      /* 🏅 the ladder reaches the city through ONE resolver, and the city has
         no copy of tiers.js — a second reading would drift in the direction
         that pays. */
      ['nodeTierRate: () => { try { const r = _nodePaidRate();', 1],
      ['function _patronTierRate()', 1],
      // 🛍 the needs the ask named, each by id
      ["id: 'sick', icon: '🤒'", 1],
      ["id: 'lazy', icon: '🍟'", 1],
      ["id: 'fitness', icon: '🏋'", 1],
      ["id: 'fun', icon: '🎴', label: 'Playing Mythic Spellbook'", 1],
      /* 🏋 THE GYM ITSELF. The ask names it and the city did not have one; a
         need pointing at a type nobody can build is permanently unmet, and
         from the need's side that is indistinguishable from working. */
      ["gym:      { name: 'Gym',", 1],
      ["case 'gym':        { _adopt(g, makeRetail(lvl, 0xd4744a), true); break; }", 1],
      /* 🔴 THE ONE PLACE PATRONAGE IS BANKED, and it is the path that already
         carries Cinder to the wallet, the Ledger, the lifetime figure and the
         coin floats. A second banking path is a money leak with four ways to
         be subtly wrong. */
      ['game.frac.cinder = (game.frac.cinder || 0) + P.credited;', 1],
      ['if (t) t.earn = (t.earn || 0) + P.byTile[k];', 1],
      // 😊 "Happy NPCS spend more cinder" — the multiplier, by name
      ['export function moodMul(mood)', 1],
      /* ⚠ THE TRAILING SEMICOLON IS DELIBERATELY NOT PINNED. U31 appended a
         work-crew factor to this line, and a marker that pinned the end of the
         expression went red for a line that had GAINED a term rather than lost
         one. What U29 claims is that spend is scaled by mood, city, economy and
         tier — so that is what it pins, and a later factor can join them. */
      ['need.base * jitter * mm * cityMul * econMul * tierMul', 1],
      // 🏗/📉 the two conditions the ask named, read rather than invented
      ['function _patronCityMul()', 1],
      ['function _patronEconMul()', 1],
      /* 🏚 "businesses that are not destroyed" — the qualifier, enforced. */
      ['open: !t.damaged && !bldSite(t)', 1],
      // 🚶 the life-like half: the errand a player can actually see
      ['export function doingFor(citId)', 1],
    ],
  },
  {
    id: 'U30', name: 'cx-usd',
    what: 'the Crash Exchange names its prices as Cinder and shows what they and the portfolio are worth in USD, off the same peg the Bank of Ethos uses',
    driver: 'drive-cx-usd.mjs', slow: true,
    markers: [
      /* 🔴 ONE PEG, IN ONE FILE, READ BY BOTH DOCUMENTS. The count on each of
         these is 1 across the WHOLE scan — two copies of an exchange rate is
         precisely the failure this piece exists to prevent, so a second
         declaration anywhere turns the count to 2 and goes red. */
      ['root.MythicPeg = {', 1],
      ['<script src="src/econ/peg.js?v=', 1],
      // …and the Bank loads the same file rather than owning the numbers
      ['<script src="../src/econ/peg.js?v=', 1],
      ['const _PEG = (typeof window !== \'undefined\' && window.MythicPeg) ? window.MythicPeg : null;', 1],
      // 💵 the exchange's own converters
      ['function _cxUsd(cinder)', 1],
      ['function _cxUsdAza(aza)', 1],
      ['function _cxUsdMix(cinder, aza)', 1],
      ['function _cxUsdLine(cinder, cls)', 1],
      /* 🔴 A SUB-CENT PRICE MUST STILL BE A NUMBER. At 5,000 Cinder to the
         dollar most of the resource board is under a cent, and two-decimal
         formatting would print every cheap asset as $0.00 — i.e. as free. */
      ['function usdPrice(cinder)', 1],
      ['if (v > 0 && v < 0.01) {', 1],
      // 🔥 the unit, said out loud where it was only ever implied
      ["'<div class=\"cind\">' + cinderBal.toLocaleString() + '<small> 🔥 CINDER</small></div>' +", 1],
      // 💼 what the whole pile is worth — the headline the ask asked for
      ["'<div class=\"lbl\">// NET WORTH</div>' +", 1],
      ['const _pfNetUsd = _cxUsdMix(_pfCinder, azaBal || 0);', 1],
      ['.cx-pf-card.net { border-top-color:', 1],
      ['.cx-usd {', 1],
    ],
  },
  {
    id: 'U31', name: 'crew-city',
    what: 'units can be posted across the whole city — the industrial chain, the power stations, the schools and the high street — and a posted unit lifts that building alone, on its output and on its till',
    driver: 'drive-crew-city.mjs', slow: true,
    markers: [
      /* 🔴 THE COVERAGE ITSELF. The work system shipped whole and then covered
         31 of 175 building types; everything else had a crew requirement and no
         trade, so slotsAt answered 0 and the Work Crew card never rendered. The
         driver counts the table, so these pin the ENDS of the range that were
         missing rather than a number that moves whenever one is added. */
      ["  steelmill:   ['kindling', 'mining'],", 1],
      ["  nuclear:     ['generating', 'research'],", 1],
      ["  chipfab:     ['research', 'generating'],", 1],
      ["  college:     ['research', 'performing'],", 1],
      ["  gym:         ['performing', 'guarding'],", 1],
      /* 🔴 THE SECOND BLOCK, WHICH WAS THE SUBTLE ONE. slotsAt refuses anything
         with neither gen nor svc — true when written, and false once patronage
         started paying shops from residents walking in. Without this the whole
         high street stayed uncrewable however complete the work table was. */
      ['if (!def.gen && !def.svc && !paidByCustomers) return 0;', 1],
      /* 🔴 THE ENLIST DIALOG'S THREE FAULTS, all reported off one screenshot.
         1 · the collection opened BEHIND the dialog that opened it (#crewpick
             is z-index 70; #cardpicker is 45 by design) and the dialog never
             stepped aside, so the list was a dim smear behind a modal;
         2 · that list was one 420px column of 20+ units, which is a scroll-bar
             with names in it;
         3 · a unit could be put on a building with no visible way off it.
         The driver proves 1 with elementFromPoint rather than by reading
         z-index — the numbers being in the right order says nothing about what
         a click at that pixel actually hits. And it restores on EVERY exit,
         cancel included, or changing your mind leaves a dimmed city with no
         dialog and no way back. */
      ['host.style.display', 1],
      ['}, null, restore, true);', 1],
      ['.cpbox.wide .cplist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));', 1],
      ['Remove from this building', 1],
      ['const rid = rem.dataset.unpost, rc = cardOf(rid);', 1],
      /* 🔴 …and the trade line under every name in that picker rendered the
         literal text u-n-d-e-f-i-n-e-d twice over: it read sv.id / sv.label off
         a suitability that has only { type, level }. The list was populated,
         correctly sorted, and told the player nothing about any of them — which
         is the entire job of the dialog. Fixed by delegating to work.js's
         suitsLabel, the one formatter, so a second hand-rolled copy cannot
         drift out of step with it again. The driver now asserts no row renders
         that word, because counting rows never could. */
      ['? CREW.work.suitsLabel({ suits: p.suits.slice(0, 3) })', 1],
      ['earnsFromCustomers: (type) => _patronPaysType(type),', 1],
      ['function _patronPaysType(type)', 1],
      /* 👷 …and the lift reaching the till. Same crewMult tileMult uses, so a
         unit in a Gym works exactly like a unit in a Farm — one multiplier, one
         cap, one place to change it. */
      ['open: !t.damaged && !bldSite(t), boost: crewMult(k) });', 1],
      ['const boost = Math.max(1, Math.min(PATRON.BOOST_CAP, Number(pick.boost) || 1));', 1],
      ['const spend = need.base * jitter * mm * cityMul * econMul * tierMul * boost;', 1],
      /* 🔴 ONE CAP, NOT TWO. A second ceiling that disagreed with the city's
         x2.00 would be a bug wearing a constant's name. */
      ['BOOST_CAP: 2,', 1],
      /* 🏠 "housing is not a job" — the owner's words. It left the job adverts
         in an earlier round and must not reappear as a work posting. */
      ["  housing:     ['", 0],
      /* 🔴 THE PLAYER COULD NOT ADD A UNIT AT ALL, and this driver passed the
         whole time because every stage called the seam instead of clicking.
         Their route — building → 'Post a worker here' → 'Enlist someone
         first' → only a Close button — was a dead end; the enlist control was
         on a side card nothing on that path mentions. */
      ['id=\"pk-enlist\">➕ Enlist a unit from your collection', 1],
      ['function enlistFlow(toTile)', 1],
      ['export function canEnlistMore()', 1],
    ],
  },
  {
    id: 'U32', name: 'milestones-prn',
    what: 'fourteen more milestones measuring what a player DOES rather than what accumulates — and the development tree can actually be cleared again, which it could not; plus a sited PRN can be taken up from the city and returns to the Reserve un-sited',
    driver: 'drive-milestones-prn.mjs', slow: true,
    markers: [
      /* 🔴 THE INVARIANT ITSELF IS ASSERTED BY THE DRIVER, NOT BY A MARKER —
         it compares totalPointsOnOffer() against the summed node costs, which
         is the only check that catches the failure this piece exists for. It
         had already happened: 36 nodes · 91 ⬡ to clear · 76 ⬡ on offer, short
         by fifteen, with nothing red anywhere because nothing compared them.
         These markers pin the five new METRICS, because a milestone whose
         metric quietly disappears is greyed out forever and looks identical
         to one the player simply has not reached. */
      ["    id: 'employed', label: 'Residents in work'", 1],
      ["    id: 'mood', label: 'Average resident mood'", 1],
      ["    id: 'crewPosted', label: 'Units posted to work'", 1],
      ["    id: 'earned', label: 'Cinder earned by your buildings'", 1],
      ["    id: 'schooled', label: 'Residents with schooling'", 1],
      // …and the five readers the city has to hand over for them to work
      ['employed: () => { try { return citizens.filter(c => c && c.job).length; }', 1],
      ['crewPosted: () => { try { return CREW ? CREW.state().filter(m => m && m.post).length : null; }', 1],
      /* 🔥 LIFETIME, not today. Patronage keeps a per-day figure and it was the
         obvious thing to hang these on — but a milestone on a resetting counter
         is one a player can watch themselves LOSE after midnight. */
      ['for (const t of Object.values(game.tiles)) { if (t && Number.isFinite(t.earn)) { n += t.earn; any = true; } }', 1],
      /* 🔌 THE PRN LABEL, WHICH IS THE WHOLE OF THE SECOND ASK. Taking a node
         up always worked; the button said "Demolish (50% refund)" over a
         licence the player had paid for, so nobody ever pressed it. */
      ["    : _isPrnTile ? '🔌 Take up this node (back to the Reserve)'", 1],
      ['<button class="obtn" id="prn-lift"', 1],
      /* ⚠ ONE DEMOLISH PATH. The card's button CLICKS the footer control
         rather than reimplementing the tear-down — a second path that skipped
         prnUnsite would strand the Reserve row against a plot the player can
         see is empty, un-placeable, with nothing left to click. */
      ['if (b) b.click();', 1],
    ],
  },
  {
    id: 'U33', name: 'phone-iphone',
    what: 'the broadcast handset is shaped like the phone it is drawn from — real ratio, chassis and display radii, a notch cut out of the screen — and its ring/silent switch actually silences the notification sound',
    driver: 'drive-phone-iphone.mjs', slow: true,
    markers: [
      /* 🔴 THE WIDTH IS DERIVED, NOT LEFT TO aspect-ratio. The shell carried
         aspect-ratio with width:auto for its whole life and NEVER honoured it:
         it is a flex item, so its base size came from its content and the only
         thing holding the width in was max-width. Measured 420x676 against a
         ratio asking for 312x676 — it read as a slab because it was one. */
      ['width:min(94vw,calc(var(--ph) * 9 / 19.5));', 1],
      ['border-radius:56px;padding:11px;box-sizing:border-box;', 1],
      ['border-radius:46px;position:relative;', 1],
      // 📱 the notch belongs to the display, and cannot take a click
      ['#bcp-screen .bcp-notch-hw{position:absolute;', 1],
      ['#bcp-status .bcp-notch{display:none;}', 1],
      // 🔕 the switch, its state, and the sound it gates
      ['export function isMuted()', 1],
      ['export function setMuted(on)', 1],
      ['if (isMuted()) return false;', 1],
      ["const MUTE_KEY = 'mythic_phone_muted';", 1],
      /* 🔴 WIRED ON THE WRAPPER, NOT ON #bcp-screen. The main delegate is bound
         to the screen and this button is on the shell beside it — the hire
         modal shipped with exactly that geometry, rendered perfectly and did
         nothing at all. */
      ["ev.target.closest('#bcp-mute')", 1],
      /* 🔔 …AND THE ONE A PLAYER CAN SEE. The chassis switch is a 4px sliver on
         the rail — right for a real handset, useless on a picture of one, where
         there is no thumb to find it with. The bell is in the app bar and is
         wired through the SAME setMuted, so the two cannot disagree. */
      ['id=\"bcp-bell\"', 1],
      ["if (act === 'mute') {", 1],
      /* 🔴 THE TABS WRAP INSTEAD OF SCROLLING SIDEWAYS. At 312px the fifth tab
         sat cut in half behind an invisible scrollbar — nothing looked broken,
         the content had simply left the screen. */
      ['#bcp-tabs{flex:none;display:flex;flex-wrap:wrap;', 1],
    ],
  },
  {
    id: 'U34', name: 'forklift',
    what: 'the tier-4 lifter is a real forklift: board it with Space, drive it in first person from the seat, carry ten crates while five are drawn on the forks, unload into a bay with E, and step out leaving the load where it stands',
    driver: 'drive-forklift.mjs', slow: true,
    markers: [
      /* 🔴 THE ASSET. It arrived at 122 MB and 3,038,154 triangles — a render
         farm model, on a page a player opens to move crates. The build script
         is committed so the next export is reproducible, and the driver
         measures the SHIPPED file, because the way this regresses is somebody
         dropping the raw Meshy file back in. */
      ['simplify({ simplifier: MeshoptSimplifier', 1],
      /* 🚜 ONE PURCHASE, NOT TWO. Tier 4 has been called Forklift since it
         shipped; owning it now parks a real one. A second wh_buy_forklift with
         its own price and its own migration was written and then deleted. */
      ['function ownsForklift()', 1],   // one definition, in warehouse/index.html
      /* ⚠ NOT a 0-count on the rpc NAME: this file's own comment explains why
         the second purchase was rejected, so the string legitimately appears in
         prose. The positive assertion is the one that matters — ownership is
         READ off the lifter tier and decided nowhere else. */
      ['((st && st.lifter_tier) | 0) >= 4;', 1],
      // 📦 ten carried, five drawn — the ask, as two constants
      ['MAX_BOXES: 10,', 1],
      ['SHOWN_BOXES: 5,', 1],
      ['const shown = Math.min(FORK.SHOWN_BOXES, S.crates.length);', 1],
      /* 🔴 THE LOAD BELONGS TO THE VEHICLE, which is the whole of "if the
         player exits with boxes keep them there" — nothing is dropped, given
         back or destroyed on exit because it was never on the player. */
      ['driving: false, crates: [], boxMeshes: [],', 1],
      // ⌨ one key in, one key out
      ['toggle: () => (S.driving ? alight() : board()),', 1],
      /* 🔴 STORAGE STAYS THE SERVER'S. A forklift deposit is the same
         wh_store_crate the walker makes, one crate at a time. */
      ["WH.rpc('wh_store_crate', { p_crate_id: p.c.id, p_unit_id: unit.id })", 1],
      /* 🔴 AND THE FRAME IS STILL DRAWN WHILE DRIVING. tick() renders once, at
         its very end, so the early return that skips the WALKER had to render
         first or the screen froze for as long as the player drove. */
      /* ⚠ ANCHORED ON ITS OWN COMMENT, not on the render call — that line
         appears three times in this page and pinning it counted them all. */
      ['point of the early return is to skip the WALKER, not the picture.', 1],
      ['  if (Fork && Fork.isDriving()) {', 1],
      /* 🔴 WHICH WAY THE MACHINE FACES. At +π/2 the forks pointed BACKWARDS and
         the pallet rendered at the counterweight end — reported as "the boxes is
         not on the forklift, its backwards". The sign is the fix. */
      ['if (size.x > size.z) inner.rotation.y = -Math.PI / 2;', 1],
      /* 📦 …and the load sits on the BLADES, measured off them (Z −1.31 tip to
         −0.21 heel) rather than eyeballed from the cab, where anything ahead of
         you looks like it is on the forks. 0.82 floated it 0.85 m past the tips. */
      ['FORK_F: 0.32, FORK_Y: 0.30,', 1],
      /* 🚧 SOLID — and  is what stops it being solid to ITSELF, which is
         how this feature would cancel itself out: immovable the moment it works. */
      ['function blocked(x, z, self) {', 1],
      ["if (self && c[self]) continue;", 1],
      ['HULL_HW: 0.62, HULL_HD: 0.95,', 1],
    ],
  },
  {
    id: 'U35', name: 'wh-from-city',
    what: 'the storage buttons on the city bar open their modal INSIDE the City Builder, on top and clickable, instead of throwing the player out to the node map',
    driver: 'drive-warehouse-ui.mjs', slow: true,
    markers: [
      /* 🔴 THIS PIECE EXISTS BECAUSE ITS DRIVER ROTTED IN SILENCE. It was
         written, it passed, and it was never REGISTERED — so when the game grew
         an auth gate and a node-ownership refusal, the driver's SETUP stopped
         working and all ten of its checks began failing. Nothing ran it, so
         nobody knew; and when it was finally run the report read as ten storage
         regressions, not one of which was real. A driver nothing runs is a
         driver that is already broken and has not been told yet.
         The markers pin what the feature actually claims. */
      /* 🎯 THE MODAL STACKS ABOVE THE CITY IFRAME — the whole of the original
         bug. Pinned on _whModal's own style line, not on the bare number: 2147483350
         is a band four other overlays legitimately share. */
      ["z-index:2147483350;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center, rgba(8,4,20,0.65)", 1],
      // …and the two buttons that open it are CREATED on the city bar
      ["whm.id = 'node-city-mystorage';", 1],
      ["wh.id = 'node-city-storage';", 1],
    ],
  },
  {
    id: 'U59', name: 'influence-citizens',
    what: 'the Influence feature is in, and every district on the mission map keeps its own standing with the people who live there — earned by raiding, clearing and fortifying, paid in fuel, and never in Cinder',
    driver: 'drive-influence-citizens.mjs', slow: true,
    markers: [
      /* the three things index.html contributes to /src/influence */
      ['window.MythicInfluenceBridge = {', 1],
      ['data-influence="1"', 1],
      /* 🔴 ALL THREE WHITELISTS. The feature shipped with the cloud upload and
         the cloud restore; loadForge is a third, LOCAL list, and a field
         missing from it is dropped on every offline reload. That two-of-three
         gap is what made a vault ceiling move twice per page load. */
      ['__influence__:', 1],
      ['Profile.influence       = p.influence;', 1],
      /* 🧍 the district track: earned from real events, paid in fuel */
      ['CIT.CIT_GAIN.raidSurvived', 2],
      ['CIT.CIT_GAIN.fortified', 1],
      ['TRN.refuel(CIT.fuelBonus(', 2],
      /* 🔴 AND IT NEVER PAYS CINDER. If this ever fails, the client-written
         track has been wired to the server-owned wallet and sql/038 has been
         undone from the other end. */
      ['export function fuelBonus', 1],
    ],
  },
  {
    id: 'U58', name: 'guide-seen',
    what: 'a page guide is remembered by the ACCOUNT and never auto-plays again once seen — it used to live in localStorage and, worse, only silenced guides the author had marked once-only',
    driver: 'drive-guide-seen.mjs', slow: true,
    markers: [
      /* 🔴 SEEN IS A FACT ABOUT THE ACCOUNT. It lived in localStorage alone, so
         a second device, another browser, a cleared cache or a private window
         all read as never-seen for someone who had sat through it many times. */
      ['function _guideIsDone(id) {', 1],
      ['if (_guideFlags()[_guideSeenFlagKey(id)]) return true;', 1],
      /* 🔴 …AND `done` NOW SILENCES EVERY TRIGGER. It used to read
         `!((g.showOnce || g.triggerType === 'firstVisit') && done)`, so a guide
         authored `everyVisit` or `load` replayed for ever no matter how many
         times it had been dismissed. That was the complaint. */
      ['        && !done', 1],
      ["!((g.showOnce || g.triggerType === 'firstVisit') && done)", 0],
      /* …an established account is not shown them one last time, and a brand
         new one still is */
      ['function _guideBackfillSeenOnce()', 1],
      ['__guideBackfill_v1', 2],
    ],
  },
  {
    id: 'U57', name: 'vault-crate-cap',
    what: 'the shop stops selling vault containers at the cap and cannot be talked past it by a confirm dialog — while still selling everything below it',
    driver: 'drive-vault-crate-cap.mjs', slow: true,
    markers: [
      /* 🔴 THE CAP IS TESTED AGAIN AFTER THE DIALOG. The check at the top of
         the handler runs BEFORE `await showGameConfirm` and nothing re-tested
         afterwards, so a vault that filled while the dialog was open was not
         noticed and the purchase applied over it — measured at 78 rows against
         a cap of 73, with 120 Aza taken for rows the clamp throws away. */
      ['const vNow = getVaultLayout();', 1],
      ['vNow.rows + c.rows > VAULT_MAX_ROWS || unitsAfter > RES_STASH_MAX', 1],
      /* ⚠ AND IT RE-READS THE LAYOUT RATHER THAN REUSING THE CAPTURED `v`.
         That reference is only live while Profile.vaultLayout is MUTATED; a
         hydration or a reset REPLACES the object, and then every write lands
         on a detached copy nothing reads. */
      ['vNow.rows += c.rows;', 1],
      /* …and the tile itself still refuses and says why */
      ['VAULT AT MAX', 1],
    ],
  },
  {
    id: 'U56', name: 'mutate-hostcost',
    what: 'a mutate card finds its hosts by their REAL cost even when the catalogue cannot resolve them — every unit used to read as costing 0, so any host-cost filter refused the whole board',
    driver: 'drive-mutate-hostcost.mjs', slow: true,
    markers: [
      /* 🔴 A UNIT NOW CARRIES ITS OWN PRINTED COST. buildUnit copied a dozen
         fields off the card and not that one, so anything asking what a unit
         cost had to go back through _cardDefById — and when that did not
         resolve (a Forge card never published on this device, a catalogue
         still loading, a summon token) the answer was 0. */
      ['cost: (cardData.cost | 0),', 1],
      ['cost: (def.cost | 0),', 1],
      /* …and the read tries def -> unit -> card rather than treating a missing
         DEFINITION as a missing COST. `!= null` because 0 is a real printed
         cost that a truthiness test would step over. */
      ['const _hostDef = (typeof _cardDefById ===', 1],
      ['(_hostDef && _hostDef.cost != null) ? (_hostDef.cost | 0)', 1],
      /* the old form, which is what refused every host */
      ["(_cardDefById(host.cardId || host.originalCardId) || {}).cost | 0", 0],
    ],
  },
  {
    id: 'U55', name: 'vault-space',
    what: 'the Base Vault stops changing size on its own, and capacity bought with Aza survives every reset — with a server-side receipt that can only give space back',
    driver: 'drive-vault-space.mjs', slow: true,
    markers: [
      /* 🔴 THE UP AND DOWN WAS A WHITELIST GAP. getResourceCap() adds the
         storage every Warehouse standing in the city contributes, and that
         reads Profile.cityProduction — named in the cloud upload and the
         cloud hydration and in NEITHER local whitelist, so every local load
         started low and jumped when the cloud answered. */
      ['Profile.cityProduction  = p.cityProduction;', 1],
      ['Profile.recon           = p.recon;', 1],
      /* 🏰 FOUR RESET PATHS, AND ONLY ONE USED TO KEEP THE PAID SIZE. A crate
         is bought on the client and nothing server-side knew, so the three
         that wiped the object destroyed paid capacity with nothing to rebuild
         it from — and getVaultLayout() fills in the DEFAULT rows, so it
         rendered as an ordinary 8-row vault rather than as an error. */
      ['function _vaultKeepPaid(prev) {', 1],
      ['_vaultKeepPaid(Profile.vaultLayout)', 3],
      ['Profile.vaultLayout = {};', 0],
      ['Profile.vaultLayout = null;', 0],
      /* …and the receipt only ever RAISES. Clamping down to a stale record
         would be a second way to lose space, which is the same bug again. */
      ['if ((paid.rows | 0) > (v.rows | 0))', 1],
      ["rpc('vault_paid_sync')", 1],
      /* 🏰 THE CEILING AND THE ROW CAP MUST STAY DERIVED FROM EACH OTHER,
         INCLUDING stashExtra — leaving it out is exactly how the clamp came to
         swallow 10,000 units from every Relic-door buyer while looking like a
         tidy derivation (62 x 10 x 25 = 15,500). The driver re-derives it; these
         pin the two figures the owner set. */
      ['const RES_STASH_MAX = 31250;', 1],
      ['const VAULT_MAX_ROWS = 73;', 1],
    ],
  },
  {
    id: 'U54', name: 'wallet-bounds',
    what: 'the client Cinder faucet is bounded by what real play measurably does — including a DAILY ceiling that never existed — the reconcile path names no amount at all, and version.txt cannot go stale again',
    driver: 'drive-wallet-bounds.mjs', slow: false,
    markers: [
      /* 🔴 THE RECONCILE STOPPED NAMING AN AMOUNT. Of the three client call
         sites this was the only one that could be closed properly, and it is
         the one with any reason to move a large number. Both halves of the
         sum are server-side and gems is not player-writable (sql/026). */
      ["rpc('wallet_reconcile_self')", 1],
      /* …and the two that remain are counted by the driver, so a THIRD
         client-named amount cannot appear without somebody arguing for it. */
      ["rpc('wallet_credit'", 2],
      /* 🔄 version.txt is written from BUILD_VERSION at deploy time. It sat at
         v121q15 for seventy builds while BUILD_VERSION marched on, so the
         auto-update check never fired and shipped fixes reached nobody. */
      ['function syncVersionTxt()', 1],
    ],
  },
  {
    id: 'U53', name: 'server-ground',
    what: 'every account gets its own ground from the SERVER instead of the whole game sharing one local seed, and the one-off re-roll compensation is claimed once per account with the amount out of the client\'s reach',
    driver: 'drive-server-ground.mjs', slow: true,
    markers: [
      /* 🔴 THE SERVER OUTRANKS THE LOCAL PIN, AND THIS IS THE ONLY PLACE IN
         the codebase where a derived answer beats a saved one. It is the one
         authorised re-roll: nearly every city was pinned to the shared
         'local-city' seed, so honouring the pins would have left every
         account on one world for ever. After this build the server id is the
         stable thing and the pin follows it. */
      ['MythicCityBridge.serverGroundId()', 1],
      ['B.serverGroundId = serverGroundId;', 1],
      /* …and REPORTING it is not enough. resmap pins the first answer it is
         given, so an id arriving after mount is ignored without this. */
      ['rm0.adoptCityId(sg)', 1],
      /* the parent resolves it BEFORE the iframe exists, clears it first, and
         throws away a reply for a city the player already left */
      ["Cloud.client.rpc('city_ground_id'", 1],
      ['if (App._cityNodeId !== _wantNode) return;', 1],
      /* 💰 THE FAUCET TAKES NO AMOUNT FROM THE CLIENT. sql/034 records that
         wallet_credit accepting one is the known hole and that per-faucet
         RPCs are the fix; this grant is written as one, so a player who finds
         the call cannot ask it for more than it pays. */
      ["Cloud.client.rpc('claim_ground_reroll_grant')", 1],
      ['_rerollGrantTried', 3],
    ],
  },
  {
    id: 'U52', name: 'ground-stable',
    what: 'the ground under a city is seeded from ONE id that never changes, and a pipe network whose stamp disagrees is adopted rather than thrown away',
    driver: 'drive-ground-stable.mjs', slow: false,
    markers: [
      /* 🔴 THE SEED MUST NOT TOUCH THE STORAGE KEY. cityKey() is DESIGNED to
         change as identity resolves — bare base, then base:owner, then
         base:owner@node — which is right for a save slot and catastrophic for
         a world seed. It was reachable from cityGroundId() and the term was
         dead (B.cityKey is never assigned), so the real behaviour was a coin
         flip between the anchor id and the literal. Both halves are pinned:
         the ban, and the reason the ban has to hold. */
      ['const GROUND_LEGACY_ID', 1],
      ['if (built > 0) return GROUND_LEGACY_ID;', 1],
      ['if (pinnedId) return pinnedId;', 1],
      /* 🔴 AN ALREADY-BUILT CITY IS NEVER MOVED, not even to a better id.
         Promoting an existing city to its anchor id would be an improvement
         that relocates somebody's oil field, which is the complaint and not
         the fix. */
      ['A city with tiles predates this fix', 1],
      /* 🚰 …and the mains are adopted rather than binned, with the ground
         re-pinned to follow them — the pipe stamp is the oldest surviving
         evidence of what this city was actually seeded from. */
      ['export function adoptedId()', 1],
      ['if (rm && rm.adoptCityId) rm.adoptCityId(adopted);', 1],
      ['adoptCityId(id) {', 1],
      /* the refusal that deleted the pipes must not come back */
      ["pipe network belongs to", 0],
    ],
  },
  {
    id: 'U51', name: 'player-maintenance',
    what: 'one player can be put in maintenance mode from User Management — held on the same screen the whole-game lock uses, with their downtime not billed to their cities — and nothing lets them back in on a guess',
    driver: 'drive-player-maintenance.mjs', slow: true,
    markers: [
      /* the button, in both states, so a toggle can never render blank */
      ['id="um-maint-on"', 1],
      ['id="um-maint-off"', 1],
      /* 🔴 THE RLS TRAP THIS PROJECT HAS ALREADY BEEN BITTEN BY TWICE.
         `to authenticated` returns ZERO ROWS WITH NO ERROR to an anon client.
         Here that would wave a held player through for the seconds before
         their session resolves — long enough to play and save over the data
         the hold exists to protect. The guard is the marker. */
      ['if (!(Profile.cloud && Profile.cloud.userId)) return null;   // no session', 1],
      /* …and an ERROR is not an answer either — the last known state stands */
      ['if (!r || r.error) return _maintMine;', 1],
      /* 🔴 THE CACHE IS ONE-DIRECTIONAL. A remembered HOLD is replayed at boot
         so a reload cannot outrun the network; a remembered RELEASE never is.
         Both halves, because storing the release is what would turn this from
         a safety net into the hole it was built to close. */
      ['if (_maintMine.enabled) localStorage.setItem(MAINT_MINE_KEY, JSON.stringify(_maintMine));', 1],
      ['else localStorage.removeItem(MAINT_MINE_KEY);', 1],
      /* 🔴 TWO WINDOWS, COUNTED ONCE. A global window nested inside a player
         window must not hand back more downtime than actually elapsed, and two
         disjoint ones must not collapse to one. The union merge is the fix. */
      ['spans.sort((x, y) => x[0] - y[0]);', 1],
      ['push(cfg.mineSince, cfg.mineEndedAt, cfg.mine);', 1],
      ['mineSince:   mine ?', 1],
      /* the server op, and that RELEASE KEEPS THE ROW — a deleted one loses
         the frozen window and bills the player for the lockout */
      ["op === 'maint_on' || op === 'maint_off'", 1],
      ['enabled: false, ended_at: nowIso', 1],
    ],
  },
  {
    id: 'U50', name: 'ethos-dilemmas',
    what: 'Ethos Heights stops you on the rails and on the way out to a raid — the deck you last took into battle is in the room, takes sides, and its bonds move on your answer',
    driver: 'drive-ethos-dilemma.mjs', slow: true,
    markers: [
      /* 🎲 the two call sites, and the ODDS THE MODULE OWNS. The frozen
         contract said there was no auto-fire anywhere, for a real reason — a
         modal over a battle or a full-viewport iframe. These two moments are
         on one screen with nothing running, which is why they are the only
         two. A third call site added elsewhere is what this pins against. */
      ["heightsRoll('move')", 1],
      ["heightsRoll('deploy')", 1],
      ['fireOnMove:', 1],
      ['fireOnDeploy:', 1],
      /* 🔴 A REFUSED DILEMMA MUST NEVER EAT A DEPLOY. The interrupt is a
         garnish on that path, not a gate across it. */
      ['const launch = () =>', 1],
      /* 🎴 card art, all four layers of it: the host whitelist, the bridge,
         the engine row and the renderer's own gate */
      ['cardArt: (cardId) =>', 1],
      /* ⚠ PINNED TO ITS OWN BODY, NOT TO THE BARE SIGNATURE. `cardArt: (id) =>`
         is also the shape of the INFLUENCE bridge's accessor in index.html, so
         the bare form started matching twice the moment /src/influence was
         scanned — a shared literal across two files, which is the third time
         this class of marker has broken a build here. The dilemma one is
         identified by what it delegates to. */
      ['cardArt: (id) => { try { return B.cardArt ? (B.cardArt(id) || null) : null; } catch (e) { return null; } },', 1],
      ['const ART_OK = ', 1],
      ['const ART_BAD = ', 1],
      /* …and the glyph that stays UNDER the art, so a dead URL is a face and
         not an empty bordered box */
      ['md-uglyph', 3],
      /* 🔴 'Reset all progress' ERASED EVERY BOND IN THE GAME with one
         confirm, and bonds are now earned through dilemmas as well as battle.
         Markup and handler both, or it is one edit from coming back. */
      ['btn-reset-progress', 0],
      /* the standing blob is in all THREE whitelists — upload, hydration and
         loadForge. Two out of three is how cityProduction gets dropped. */
      /* 🔴 THREE WHITELISTS, THREE MARKERS, NOT ONE COUNT. The blob has to be
         named in the cloud UPLOAD, the cloud HYDRATION and loadForge — and a
         count of the string cannot tell which one went missing. Profile.recon
         and Profile.cityProduction are each in two of the three today, which is
         why an offline reload drops them and why this is spelled out. */
      ['__dilemma__:', 1],
      ['f.__dilemma__ && typeof f.__dilemma__', 1],
      ['Profile.dilemma = p.dilemma;', 1],
    ],
  },
  {
    id: 'U49', name: 'vault-skill-tree',
    what: 'the hero loadout page is retired into the Base Vault, which now carries the Skill Tree button — and no entry point can reopen the old screen',
    driver: 'drive-vault-skill-tree.mjs', slow: true,
    markers: [
      /* 🔴 RETIRED AT THE ROUTER, NOT AT ITS BUTTONS. There were at least two
         ways in and a saved App.screen can land on it after a reload; only the
         screen itself catches all of them. A marker on the two buttons would
         pass while a third entry point quietly reopened a dead page. */
      ["if (App.screen === 'heroLoadout') {", 1],
      /* …and it PAINTS the vault, rather than setting a screen and returning
         nothing — the router below is the only other renderBaseVault call. */
      ['return renderBaseVault();', 2],
      ["if (!App.vaultReturnScreen) App.vaultReturnScreen = App.loadoutReturnScreen || 'camp';", 1],
      /* …carrying the hero the player actually clicked */
      ['if (App.loadoutHeroId && !App.vaultHeroId) App.vaultHeroId = App.loadoutHeroId;', 1],
      /* 🌲 the button itself, and the handler that opens the tree on the hero
         the VAULT is showing */
      ['id="vault-skill-tree"', 1],
      ["App.skillTreeReturnScreen = 'baseVault';", 1],
      /* ⚠ and the tree's own back buttons no longer name the retired screen —
         both of them, the skill tree and the cosmic tree */
      ["App.skillTreeReturnScreen || 'heroLoadout'", 0],
    ],
  },
  {
    id: 'U48', name: 'deck-picker-art',
    what: 'the starting-deck picker is a gallery of real card art in portrait frames, not twenty-nine identical playing-card glyphs',
    /* markers-only — this is layout, and the one thing worth protecting is that
       the art and the frame that fits it do not quietly revert. (A piece with
       no driver used to be REPORTED AS A FAILURE by this gate: driver:'' made
       path.join resolve to the .gauntlet DIRECTORY, which exists, so it ran
       `node .gauntlet` and logged a 0s failure. Fixed in U25/U38's pass — this
       piece is the first to rely on that.) */
    driver: '', slow: false,
    markers: [
      /* 🎴 the deck wears its most-copied card, not the first key in authoring
         order — a deck's identity is whatever it runs four of */
      ['const _ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);', 1],
      /* 🔴 CARD ART IS PORTRAIT AND THE FRAME WAS LANDSCAPE. 230x120 with
         object-fit:cover took a thin horizontal slice out of the MIDDLE of a
         tall painting, which is why every tile looked mis-cropped. 4/5 with the
         crop anchored high is the fix, and both halves matter. */
      ['.dpk-art { position:relative; width:100%; aspect-ratio:4/5;', 1],
      ['object-position:50% 30%', 1],
      /* …the fade that removes the hard seam between art and label */
      ['.dpk-art::after', 1],
      /* …a real plate for the seven decks with no art, so the grid stays a grid */
      ['.dpk-none span', 1],
      /* …and the whole tile is the button. There were two targets per card on a
         screen whose entire job is picking one. */
      ['<button class="dpk-tile" data-rlc-pickdeck=', 1],
    ],
  },
  {
    id: 'U47', name: 'world-map-shared',
    what: 'the War Map is ONE map every player reads, instead of ninety private copies reconciled by weight — and no blank world can be published or adopted',
    driver: 'drive-world-map-shared.mjs', slow: true,
    markers: [
      /* 🔴 THE ARCHITECTURAL FINDING, measured on production before any code
         changed: the map lived inside each player's user_profiles.forge blob
         and copies were reconciled by _preferRicherObj, which keeps whichever
         WHOLE object weighs more. 40 nodes on 31 profiles, 39 on 12, 38 on 8,
         37 on 9, 36 on 5, 34 on 18 — and FIFTEEN accounts on the 16-node
         starter seed. Two players could stand on the same node id and read
         different names off it. A shared world cannot be stored per player. */
      ['async function tw_cloudFetchWorldMap()', 1],
      ['async function tw_cloudPublishWorldMap()', 1],
      ["from('tw_world_map')", 1],
      ["rpc('tw_publish_world_map',", 1],
      /* 🔴 AND NEITHER END WILL TOUCH A BLANK WORLD. A map with no nodes
         winning a merge is the failure that started this whole thread; the
         client refuses to send one, refuses to adopt one, and the server
         refuses to store one. */
      ['if (!Array.isArray(t.nodes) || !t.nodes.length) return null;   // never publish a blank world', 1],
      ['if (!doc || !Array.isArray(doc.nodes) || !doc.nodes.length) return null;', 1],
      /* ⚠ publishing is a deliberate admin act, on a button — this writes the
         world every other player reads. */
      ['id="tw-publish-btn"', 1],
      /* 🔴 AND THE SHARED MAP IS HELD AND RE-ASSERTED, not adopted once.
         Adopting it at fetch time was not enough and the starter map kept
         coming back: cloudFetchProfile runs on its own schedule and hands
         Forge.territoryWars to _preferRicherObj, which keeps whichever WHOLE
         object weighs more — and a 16-node profile blob carrying a fat
         worldFeed outweighs a 40-node shared map. _twForge() is the single
         accessor every consumer goes through, so re-asserting there is the one
         place no ordering can race. */
      ['App._twWorldMapDoc = doc;', 1],
      ['if (_wm && Array.isArray(_wm.nodes) && _wm.nodes.length && t.nodes !== _wm.nodes) {', 1],
    ],
  },
  {
    id: 'U46', name: 'tw-nodes-survive',
    what: 'the War Map\'s settlements cannot be wiped out by a Forge merge, and a map that has lost its nodes puts them back',
    driver: 'drive-tw-nodes-survive.mjs', slow: true,
    markers: [
      /* 🔴 HOW THEY VANISHED. Forge.territoryWars is CLOUD-ONLY and hydrates
         through _preferRicherObj, which weighs the WHOLE object and keeps the
         heavier one — but that object also carries worldFeed and darkEvents,
         which grow without limit. A copy with a fat feed and an EMPTY nodes
         array outweighs one holding the real map, wins, and every settlement
         disappears at once. The driver measures that hazard rather than
         asserting it. */
      ["for (const _k of ['regions', 'sectors', 'nodes']) {", 1],
      /* ⚠ NARROW ON PURPOSE — it rescues only a list that came out COMPLETELY
         empty. "Keep the longer one" was the first version and it is wrong: an
         admin DELETING a node is a real edit, and a rescue that resurrected it
         would trade a data-loss bug for a data-integrity one. */
      ['if (_won.length) continue;                       // not empty → not our business', 1],
      /* …and the seed can now put a map back when only the NODES were lost.
         It used to require regions AND nodes to both be empty, so the one
         failure that actually happens left the map blank for good.
         🔴 BUT NEVER BEFORE THE CLOUD MAP HAS BEEN ASKED FOR. Forge.territoryWars
            is cloud-only and lands asynchronously; a signed-in player who opens
            the War Map inside that window has an empty node list for entirely
            ordinary reasons, and seeding 16 generic PRNs into it — which then
            SAVE — is how a real 40-node map becomes the starter set. Production
            carries exactly that fingerprint: 32 profiles with all 40 nodes and
            FIFTEEN with exactly 16. */
      ['if (t.nodes.length === 0 && !_twAwaitingCloud) { _twSeedStarterData(); }', 1],
      /* ⚠ TWO, and that is the assertion. It is set where the profile's copy
         lands AND where the shared world map lands — either counts as "a real
         map has been consulted", and a count of 1 would pass while one of the
         two paths quietly stopped marking it and let the starter seed fire
         over a real map again. */
      ['App._twForgeSeen = true;', 2],
      /* the 16 canonical settlements themselves */
      ["{ n: 'CARRION GAP',  s: 1, r: 'METAL'   },", 1],
      ["{ n: 'VEINSHEAR',    s: 2, r: 'CRYSTAL' },", 1],
    ],
  },
  {
    id: 'U45', name: 'node-lockout',
    what: 'a player who owns a node is never told they own none — an unauthenticated read of the owner table returns zero rows with NO error, and believing it locked owners out of the Camp, Cashout Vault, Tutor Shop and Player Market for the whole session',
    driver: 'drive-node-lockout.mjs', slow: true,
    markers: [
      /* 🔴 THE ROOT CAUSE, CONFIRMED AGAINST THE LIVE DATABASE: tw_node_owners'
         select policy is granted TO authenticated USING (true) and the table
         has rows — so an anon read (auth unresolved, or a token mid-refresh)
         returns an EMPTY RESULT AND NO ERROR. The old code cached that as the
         answer and _campOwnerDataEnsure never asked again for the session.
         An empty map and a missing map mean different things; storing them
         the same way is what produced the report. */
      /* ⚠ TWO: the owners table AND the shared world map. Both are granted to
         `authenticated` only, so BOTH return zero rows with no error when read
         anonymously — the same trap, and it has to be shut in both places or
         the second one becomes the next report. */
      /* 🔴 PINNED TO ITS OWN TWO CALL SITES, NOT TO A COUNT OF THE GUARD.
         This started as a bare count of 2 and broke the build the first time
         a THIRD reader correctly adopted the same fix (the per-player
         maintenance read, U51). A marker that fails when the pattern it
         protects spreads is teaching the wrong lesson — the guard becoming
         more common is the good outcome. Each site is pinned by the table it
         guards instead, which is what this piece is actually about. */
      ['⚠ SO: no session, no cache.', 1],
      ['the shared map is readable by authenticated players only', 1],
      ['App._twNodeOwners = { at: Date.now(), byNode, count: Object.keys(byNode).length };', 1],
      /* …so an empty map is retried — throttled and capped, because a
         genuinely ownerless world is a real answer worth keeping. */
      ['if (_own && (_own.count | 0) > 0) return;', 1],
      ['App._twNodeOwnersTries', 3],
      /* 🔒 …and a confirmed owner LATCHES, so no later blip can take back an
         unlock the game has already granted. Latches on a positive
         confirmation only — never on an absence, or it would latch on the
         very failure it exists to survive. */
      ['function _ownedNodeEverLatch()', 1],
      ['if (Profile.ownedNodeEver) return true;', 1],
    ],
  },
  {
    id: 'U44', name: 'search-by-cost',
    what: 'a card can search the deck by a COST RULE — at most / at least / exactly N — with an empty allow-list, instead of naming every card it could ever find',
    driver: 'drive-search-cost.mjs', slow: true,
    markers: [
      /* 🔴 THE ENGINE ALREADY DID THIS. _cardMatchesFilter has honoured
         costMode since the filter existed, and searchDeck forwards the shared
         filter straight into the pool — so "any card costing 4 or less" was
         expressible with no chips at all.
         WHAT WAS MISSING WAS ANY WAY TO KNOW. The Search Deck help said the
         Card Filter narrows by "element/faction/name" and omitted COST
         entirely, while the card PICKER directly above it has its own Cost
         box that only filters the browse list. Two cost controls, one of
         which does the job, and the label pointed at the other — so the only
         documented route was to list every card by hand. */
      ["const mode = f.costMode || 'exact';", 1],
      /* ⚠ THREE, and that is the assertion. There are three Card Filter
         editors in this file (the on-play one, the generic builder, and the
         prefixed one), and a designer who learns "at most" on one screen must
         find the same three words on the other two. A count of 1 would have
         passed while two of them silently offered something else. */
      ["['exact','exactly'],['min','at least'],['max','at most']", 3],
      ['You do not have to list every card', 1],
      ['element, faction, type, name and COST', 1],
      ['only filters this browse list', 1],
    ],
  },
  {
    id: 'U43', name: 'mission-days',
    what: 'a day is 24 REAL hours and belongs to everyone — the daily rollover is when the factions push, for every player at the same moment — while moving the train costs 2 fuel and touches nobody else\'s clock',
    driver: 'drive-mission-days.mjs', slow: true,
    markers: [
      /* 🕛 THE DAY IS THE WORLD'S. It used to be a private counter on each
         train that ticked when its owner travelled, so your day 14 and someone
         else's day 3 were both true and neither meant anything. In a city
         everyone raids, "day 6" has to mean ONE thing. */
      ['const DAY_MS    = 24 * 60 * 60 * 1000;', 1],
      ['const TICK_MS   = DAY_MS;               // the factions move once a day, together', 1],
      ['export function day() { return mm().day | 0; }', 1],
      ['export function msToNextDay() {', 1],
      /* 🔴 AND TRAVEL CANNOT TOUCH IT. A move costs fuel; if it still spent a
         day, one player riding back and forth would drag a clock every other
         player is reading. */
      ['  HOP_COST: 2,             // one adjacent district', 1],
      /* 📓 …and the journal is READ, not drained. It was a one-shot queue, so
         a travel day's line lived for exactly one paint and clicking any
         district wiped the player's own journey. Selecting a district is not
         an acknowledgement that you have finished reading. */
      ['export function journal() { return journalLines.slice(); }', 1],
      ['const JOURNAL_MAX = 12;', 1],
    ],
  },
  {
    id: 'U42', name: 'mission-author',
    what: 'missions are written FOR A DISTRICT, from the map: stand on Midtown, author the operation that happens there, and Back returns you to Midtown',
    driver: 'drive-mission-author.mjs', slow: true,
    markers: [
      /* ✎ THE REFRAME. The Builder was a LIST reached through the Forge and a
         district was a dropdown filled in afterwards — the map and the thing
         that fills it were two unrelated screens. The district is now the
         starting point. */
      ['authorAt: (siteId) => {', 1],
      ['editMission: (id) => {', 1],
      ['msn-author', 2],
      /* ⚠ ONE EDITOR, TWO DOORS. authorAt creates the row, pins it, names it
         after the district and opens the EXISTING builder. A second authoring
         UI would drift from the first within a month. */
      ["c.name = 'Operation — ' + st.name;", 1],
      ["c.missionSite = siteId;", 1],
      /* 🗺 …and Back goes where you came from, or the admin is dropped two
         screens from the map they were standing on. Both doors honour it. */
      ['App._rlcFromMap', 7],
      /* 🔴 THE SILENT FALLBACK BIT TWICE WHILE BUILDING THIS. panelHtml now
         asks who is looking, and without its own bridge handle that was a
         ReferenceError — which screen() caught and index.js turned into a
         quiet fall back to the OLD campaign list. A blank map here means an
         exception, not a missing feature. */
      ['const B = bridge();', 3],
    ],
  },
  {
    id: 'U41', name: 'mission-train',
    what: 'the train is a mobile base that makes the map a POSITION rather than a menu — it deploys only where it is parked or next door, moving costs fuel, and surviving a raid brings fuel home',
    driver: 'drive-mission-train.mjs', slow: true,
    markers: [
      /* 🚂 THE GATE IS THE FEATURE. Without it every district is one click
         away and the map is a list with a nicer background. */
      ['export function reaches(siteId)', 1],
      ['const inReach = T.reaches(sel);', 1],
      /* 🚂 the owner's model, baked to a sprite at the map's own isometric
         angle by tools/bake-train.mjs — the supplied .glb is 37.8 MB and one
         asset over 25 MiB aborts an entire Cloudflare deploy. The DRAWN train
         is still behind it, so the feature survives a missing file.
         ⚠ This used to pin `art: null`, which was true only while no model
           existed — a correct change then failed the build. */
      ["art: 'assets/artwork/train-ironhold.png',", 1],
      ['export function drawTrain(c, x, y, k, art)', 1],
      /* 🚂 …AND IT TRAVELS. Clicking Move here animates the run between the two
         districts instead of teleporting the marker.
         🔴 DRAWN ON THE FX CANVAS, which is the whole trick: the city canvas
            paints once per render() — fine for a marker that jumps, useless for
            one that moves — while the fx canvas already runs a rAF loop for the
            embers and ash and sits ABOVE the city. No second loop to leak.
         ⚠ The journey keeps that loop alive even under prefers-reduced-motion,
           which stops the ambient drift after one frame. Right for ash; wrong
           for a train the player just told to move and is waiting on. */
      ['export function travel(fromId, toId, ms)', 1],
      ['drawTrainMarker(ctx, t);', 1],
      ['if (!still || trainTrip) requestAnimationFrame(frame);', 1],
      /* 🔴 fuel is not an eighth currency: poi.js was already printing it on
         the district panel as part of the haul, long before the train. */
      ["haul:'fuel · medicine · corrupted essence'", 1],
      /* 🔴 GUARDED, because the map's failure mode HIDES a crash: a missing
         #msn-go threw, screen() threw, and index.js quietly fell back to the
         old campaign list. It did not error — it just stopped being the map. */
      ["const goBtn = document.getElementById('msn-go');", 1],
    ],
  },
  {
    id: 'U40', name: 'mission-coop',
    what: 'Ethos Heights is ONE city: the roguelite campaign list is a map of it, every player raids the same districts, and the factions push back on a clock the SERVER owns',
    driver: 'drive-mission-coop.mjs', slow: true,
    markers: [
      /* 🗺 the map replaced the list, and the list is still the fallback */
      ['if (window.MythicMissions && window.MythicMissions.render()) return;', 1],
      ['window.MythicMissionBridge = {', 1],
      /* 🔴 THE ONE STRING FACTION PRESSURE RIDES ON. poi.js emits Normal /
         Hard / Veteran / Nightmare specifically to land on index.html's OWN
         regexes, so a held district drops better loot AND fights harder with
         no engine change at all. Renaming one of these four words silently
         removes enemy levels and downgrades the loot table, with no error
         anywhere — which is why they are pinned as literals. */
      ["diff:'Veteran'", 1],
      ["diff:'Nightmare'", 1],
      /* ☁ ONE CITY. The server owns the clock and the cut; the client sends an
         id and nothing else. */
      ["rpc('mission_tick')", 1],
      ["rpc('mission_raid', { p_mission_id: id })", 1],
      ['export function isShared() { return CLOUD; }', 1],
      /* 🔴 THE DOUBLE-RATE BUG THIS PREVENTS: the server already applied those
         pushes, so running the local simulation on top would advance the
         factions faster for whoever happened to have the game open. */
      ['if (CLOUD && !force) return [];', 1],
      /* ⚠ and the throttle must not burn a window when there is no database —
         the first paint happens before auth resolves. */
      ['if (!db) return;', 1],
    ],
  },
  {
    id: 'U39', name: 'city-pop',
    what: 'the node counts the REAL people living in the cities built on it, against the REAL homes they have — instead of a 200,000 baseline bled by corruption that was connected to nothing',
    driver: 'drive-city-pop.mjs', slow: true,
    markers: [
      /* 👥 the city finally says how many people it has */
      ['cityPop: _cityPop, cityCap: _cityCap,', 1],
      ["rpc('tw_set_city_pop',", 1],
      /* 🔴 THE TRAP. CIVILIZATION feeds TRADE STABILITY feeds the resource
         payout. Real population over the FICTIONAL 200,000 denominator reads
         0 on every node in the game — the driver measures exactly that build
         and it comes out at 0 against 73 for the honest pair. Population and
         capacity travel together or neither is used. */
      ['const popFrac = (r.cityCap > 0)', 1],
      ['? Math.max(0, Math.min(1, r.cityPop / r.cityCap))', 1],
      /* ⚠ …and a node nobody has built on still runs the OLD arithmetic. */
      ['    : (r.civiliansTotal > 0 ? (r.population / r.civiliansTotal) : 0);', 1],
      /* 🔴 tw_set_city_pop keys on auth.uid(), so a mayor with a client's city
         open would file the CLIENT's people under the MAYOR's row and the
         node's SUM would count them twice. */
      ['if (App._cityOwnerId && me && App._cityOwnerId !== me) return;', 1],
      /* ⚠ _popMax is ALSO the CIVILIANS SHELTERED denominator — repointing it
         at a city's housing capacity turns that row into "33.7K / 460". */
      ['const _liveMax  = _hasCity', 1],
      ['const _popMax = _rc.civiliansTotal || 200000;', 1],
    ],
  },
  {
    id: 'U38', name: 'mayor-saves',
    what: 'a mayor whose read of a client city is PROVEN permitted may start that city, instead of being trapped in local-only saves that never reach the owner',
    driver: '', slow: false,
    markers: [
      /* 🔴 THE MAYOR-CANNOT-SAVE BUG, and it cost paying customers their work.
         A zero-row read as a mayor means one of two things — "RLS refused" or
         "the owner has no city yet" — and the guard could not tell them apart,
         so it assumed refused. That sets __cityLoadUnsafe, which makes
         node-city's _cityVerdict 'unknown', which makes _savePolicy() return
         'local', which means the work goes to localStorage and NEVER to the
         server. And because nothing reaches the server, the next read is zero
         rows again and the policy is 'local' again: a permanent trap.
         Measured on production: 8 of 15 ACTIVE contracts had a client with no
         city row at all, while sql/014 WAS applied and city_state_can_write
         returned true for all 15 mayors — the guard was firing on the wrong
         case every time.
         The fix asks the database instead of inferring. */
      ["Cloud.client.rpc('city_state_can_write', { p_owner: target })", 1],
      ['if (_mayorMayWrite === true) {', 1],
      /* 🔴 THE DOWNGRADE THIS DEFEATS IS STILL THERE AND STILL CORRECT — it is
         what protects an owner's real city from a genuinely refused read. */
      ["if (_cityVerdict === 'unknown') return real ? 'local' : 'none';", 1],
      /* ⚠ …and the mayor is TOLD when the probe cannot prove it, rather than
         finding out a week later that a build session never left the device. */
      ['App._cityMgrReadWarned', 2],
    ],
  },
  {
    id: 'U36', name: 'population',
    what: 'people move to a city for reasons and leave it for reasons, and every single one of them is accounted for — births + immigration − deaths − emigration equals the population, exactly',
    driver: 'drive-population.mjs', slow: true,
    markers: [
      /* 🔴 THE IDENTITY IS THE FEATURE. Everything else here is how the four
         flows get their values; this is the rule that stops the whole thing
         being a thermostat with adjectives. audit() re-derives the population
         from the ledger and the driver requires the difference to be ZERO —
         not small, zero, on integers. */
      ['export function audit(S, startPop)', 1],
      ['discrepancy: S.pop - expect, ok: S.pop === expect,', 1],
      /* …and the one line in the city that is allowed to move the number. */
      /* ⚠ Pinned on the COMMENT above it, not the line: the assignment also
         appears in the mount and in the ageing tick, which are the two other
         legitimate places the head-count is synced from the ledger. */
      ['THE ONLY LINE THAT MOVES THE POPULATION, and it moves it by the sum of', 1],
      /* ⚖ THE WEIGHTS ARE NOT EQUAL, which the ask insists on: the six things
         a person cannot live without carry 63 of the 100 points, and every
         comfort in the game together carries 9. */
      ['  housing:      14,', 1],
      ['  entertainment: 2,', 1],
      /* 🚧 ATTRACTION ALONE NEVER BRINGS ANYBODY — "if the city has extremely
         high attraction but no housing, immigration should stop". */
      ["return { id: 'housing', text: 'Housing Shortage — population growth limited' };", 1],
      /* ⏳ …and nobody leaves over one bad minute: strain accumulates. */
      ['STRAIN_AT: 50,', 1],
      /* 👶 children cannot be spawned as workers — they have to age into it. */
      ['export const WORKING_STAGES', 1],
      /* 💥 a disaster is a shock that halves, not a permanent scar. */
      ['DISASTER_HIT: 25, DISASTER_HALFLIFE: 12,', 1],
      // 📊 the dashboard puts the ledger and the reasons on screen
      ['function popDashHtml()', 1],
      // 🗣 …and the feed only says things that are true of this city right now
      ['function popBroadcast()', 1],
      // 💾 the whole ledger rides the save, or a reload loses the accounting
      ['pop: (function () { try { return POP && POPS ? POP.save(POPS) : null; }', 1],
      /* ══ 🏠 THE HOUSEHOLD LAYER ═══════════════════════════════════════════
         🔴 THE SECOND INVARIANT, and it broke the first time by EXACTLY the
            homeless count (2, 92 and 3 across three housing markets) because
            unhoused people were counted in their household's size AND in a
            separate tally. A discrepancy that tracks one quantity IS that
            quantity, counted twice. Homelessness is derived now. */
      ['export function homeless(S)', 1],
      ['const total = tracked + S.tail.people;', 1],
      /* 🏢 the density ladder the ask asked for, and the rent that moves with
         scarcity in BOTH directions */
      /* 🏢 THE DENSITY LADDER, AND IT IS FIVE REAL BUILDINGS NOW. The market
         used to map its middle rungs onto Retail Parade, Office Block and
         Stadium — only Housing and the Storm Shelter had a popCap in a
         catalogue of 175 — so a stadium was being reported as 180 beds and
         shoppers were being counted as residents. U36 asserts both files agree
         about every capacity, and that power draw climbs with density. */
      ["{ id: 'highrise', name: 'High-Rise',", 1],
      ["  highrise: { name: 'High-Rise',", 1],
      ["  apttower: { name: 'Apartment Tower',", 1],
      ["    case 'highrise':   { g.add(makeHousing(Math.min(6, lvl + 4), tx, tz)); break; }", 1],
      ['RENT_MIN: 0.55, RENT_MAX: 2.6, RENT_LERP: 0.06,', 1],
      /* 🔴 "Poor NPCs should not automatically occupy expensive housing" — the
         affordability gate, and capacity as a REQUIREMENT rather than a
         preference (getting that backwards put 86 of 98 households into
         apartment blocks while 22 houses stood empty). */
      ['AFFORD_RATIO: 0.42,', 1],
      ['  if (tier.cap < h.size) return -1;', 1],
      // 🙂 personality that changes a decision rather than decorating a tooltip
      ["{ id: 'anxious',  name: 'Anxious',", 1],
      // 🚚 moving house, and 🚸 refugees answerable three ways
      ['MOVE_GAIN: 0.18,', 1],
      ['export function offerRefugees(S, count, opts)', 1],
      ['export function decideRefugees(S, how, some)', 1],
      /* 🔴 …and accepting them is IMMIGRATION, through the ledger's own flow —
         people appearing directly would hole the first identity on the first
         refugee event. */
      ['POPS.ledger.immigration += r.taken;', 1],
    ],
  },
  {
    id: 'U37', name: 'battle-cam',
    what: 'the battlefield zooms with the wheel or R/F and rotates with Q/E, while the hand, the rails and the HUD stay exactly where they were — and the backdrop photo is gone',
    driver: 'drive-battle-cam.mjs', slow: true,
    markers: [
      /* 🔍 TWO VARIABLES ON THE BOARD, DEFAULTING TO IDENTITY — which is how
         "still make the game look the same" is kept as a property rather than
         as an intention. */
      ['rotateZ(var(--bf-rot, 0deg))', 1],
      ['function bfZoom(by)', 1],
      ['function bfRotate(deg)', 1],
      /* 🔴 THE FLAT BOARD IS 2D ONLY, AND THIS IS THE LOAD-BEARING ONE. That
         board is flat because any perspective/rotateX makes it a projected
         layer the browser re-samples whenever a sprite animates — which is the
         board-shifting bug its own comment was written after chasing. */
      ['transform: translateZ(0) rotate(var(--bf-rot, 0deg)) scale(var(--bf-zoom, 1));', 1],
      /* 🖱 the wheel cannot be passive: it has to stop the page scrolling out
         from under a board that is growing. */
      ['bfZoom(-e.deltaY * BFCAM.STEP_WHEEL);', 1],
      /* 🔴 THE 3D TERRAIN MOVES WITH THE TILES, AND FOV IS WHY. With the admin
         3D board on, the ground is painted in a WebGL canvas and the tiles and
         units are HTML on a CSS layer ABOVE it. A dolly changes perspective and
         peels one off the other — every unit slides off its hex, and the
         further you zoom the wronger it gets. Narrowing the FIELD OF VIEW is an
         image-space scale about the centre, which is exactly what CSS scale()
         is, so the two track by construction. U37 measures the equivalence and
         reads 2.000x against a CSS 2x. */
      ['const fov = 2 * Math.atan(Math.tan(halfRad) / Math.max(0.05, vz)) * 180 / Math.PI;', 1],
      ['function _b3dSetView(zoom, yaw)', 1],
      /* ⚠ …and the player's live view NEVER writes the admin's saved camera,
         which is persisted for everybody on Publish. */
      ['const vz = _B3D.viewZoom || 1, vy = (_B3D.viewYaw || 0) * Math.PI / 180;', 1],
      // 🖼 …and the backdrop photo is gone from both places that asked for it
      ["url('assets/background/Backgrounds/Combatbackground.png')", 0],
      ["backdrop: 'assets/background/Backgrounds/Combatbackground.png'", 0],
    ],
  },
];

/* ── the fast path ────────────────────────────────────────────────────────── */
function markerScan() {
  const src = SRC_FILES.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  let bad = 0, checked = 0;
  console.log('\n🔎 MARKER SCAN · is each piece still in the file?');
  console.log(C.d + '   (presence and count only — this proves nothing about correctness)' + C.x + '\n');
  for (const p of PIECES) {
    if (ONLY && p.name !== ONLY && p.id !== ONLY) continue;
    if (!p.markers.length) {
      console.log('   ' + C.y + 'skip' + C.x + ' ' + p.id.padEnd(3) + ' ' + p.name.padEnd(22) + C.d + 'no marker declared' + C.x);
      continue;
    }
    const misses = [];
    for (const [needle, want] of p.markers) {
      checked++;
      const got = src.split(needle).length - 1;
      if (got !== want) misses.push(needle + ' — found ' + got + ', expected ' + want);
    }
    if (misses.length) {
      bad++;
      console.log('   ' + C.r + 'GONE' + C.x + ' ' + p.id.padEnd(3) + ' ' + p.name.padEnd(22) + p.what);
      for (const m of misses) console.log('          ' + C.r + m + C.x);
    } else {
      console.log('   ' + C.g + 'ok  ' + C.x + ' ' + p.id.padEnd(3) + ' ' + p.name.padEnd(22) + C.d + p.what + C.x);
    }
  }
  console.log('\n   ' + checked + ' markers checked across ' + PIECES.length + ' pieces');
  return bad;
}

/* ── the real thing ───────────────────────────────────────────────────────── */
function runDrivers() {
  const rows = [];
  for (const p of PIECES) {
    if (ONLY && p.name !== ONLY && p.id !== ONLY) continue;
    if (SKIP_SLOW && p.slow) { rows.push({ p, status: 'skipped', ms: 0 }); continue; }
    /* 🔴 A PIECE WITH NO DRIVER IS MARKERS-ONLY, NOT A FAILURE.
       path.join(ROOT, '.gauntlet', '') is the .gauntlet DIRECTORY, and a
       directory very much exists — so the existsSync guard waved it through,
       spawnSync ran `node .gauntlet`, node exited non-zero instantly, and the
       piece was recorded as a driver failure at 0s. Every markers-only piece
       (U25, U38, …) failed that way, which made a FULL gate run red no matter
       what the code did, and made the one number the gate exists to produce
       untrustworthy. --quick never showed it because --quick never runs
       drivers. */
    if (!p.driver) { rows.push({ p, status: 'skipped', ms: 0 }); continue; }
    const file = path.join(ROOT, '.gauntlet', p.driver);
    if (!fs.existsSync(file)) { rows.push({ p, status: 'missing', ms: 0 }); continue; }
    process.stdout.write('   ▸ ' + p.id + ' ' + p.name + ' … ');
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - t0;
    const ok = r.status === 0;
    rows.push({ p, status: ok ? 'pass' : 'fail', ms, out: (r.stdout || '') + (r.stderr || '') });
    console.log((ok ? C.g + 'pass' : C.r + 'FAIL') + C.x + ' ' + C.d + (ms / 1000).toFixed(0) + 's' + C.x);
  }
  console.log('');
  for (const row of rows) {
    if (row.status !== 'fail') continue;
    console.log(C.r + '── ' + row.p.id + ' ' + row.p.name + ' failed ──' + C.x);
    /* Only the failing lines — a driver prints hundreds of OKs and burying the
       one red line in them is how a red run gets read as green. */
    const lines = String(row.out).split(/\r?\n/).filter(l => /FAIL|Error|ABORT/.test(l));
    for (const l of lines.slice(0, 12)) console.log('   ' + l);
    console.log('   ' + C.d + 'full output: node .gauntlet/' + row.p.driver + C.x + '\n');
  }
  return rows;
}

/* ── main ─────────────────────────────────────────────────────────────────── */
console.log('\n🚦 FEATURE GATE · AI · multiplayer · kitchen');
const bad = markerScan();

if (bad) {
  console.log('\n' + C.r + '❌ ' + bad + ' piece(s) MISSING FROM THE FILE.' + C.x);
  console.log('   A later edit removed work that is recorded as done. This is exactly');
  console.log('   how piece A1 was lost. Recover it before running anything else.\n');
  process.exit(1);
}
console.log('   ' + C.g + 'every piece is still present' + C.x + '\n');

if (QUICK) { console.log(C.d + '   --quick: markers only, no behaviour was exercised.' + C.x + '\n'); process.exit(0); }

console.log('🎬 DRIVERS · booting the real page' + (SKIP_SLOW ? C.d + '  (--skip-slow: nothing to run)' + C.x : '') + '\n');
const rows = runDrivers();
const failed = rows.filter(r => r.status === 'fail');
const passed = rows.filter(r => r.status === 'pass');
const skipped = rows.filter(r => r.status === 'skipped' || r.status === 'missing');

console.log('   ' + passed.length + ' passed · ' + failed.length + ' failed'
  + (skipped.length ? ' · ' + skipped.length + ' not run (' + skipped.map(s => s.p.id).join(', ') + ')' : ''));
console.log('\n' + (failed.length ? C.r + '❌ GATE RED' : C.g + '✅ GATE GREEN') + C.x + '\n');
process.exit(failed.length ? 1 : 0);
