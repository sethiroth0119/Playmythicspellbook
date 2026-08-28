/* ═══════════════════════════════════════════════════════════════════════════
   transport.bridge.js — THE SEAM between /src/transport and the legacy app.

   🔴 WHY THIS FILE EXISTS AT ALL. This is a LANGUAGE MECHANIC, not a style
   preference. index.html declares `Profile`, `Cloud`, `App`, `Corp` and `Forge`
   as top-level `const`. A top-level `const` in a classic script creates a global
   LEXICAL binding, and a lexical binding is NOT a property of the global object:
   `window.Profile` is `undefined` even though `const Profile` is right there on
   screen, and an ES module has no access to another script's lexical scope. So
   there is no expression this file could write that would reach them. It is not
   a matter of load order, of `defer`, or of trying harder.

   This has already cost real time TWICE — FoundationReserve and Profile, both in
   the Node City bridge — which is why it is written down here rather than left
   to be rediscovered a third time.

   So index.html hands this module exactly what it needs, once, as
   `window.MythicTransportBridge` (built next to `MythicCityBridge`, ~207415).
   Nothing in /src/transport reads a bare global, and nothing in /src/transport
   assumes `window.Foo` exists because `const Foo` does.

   ⚠ STANDING INSTRUCTION: if a module in this feature needs something new from
   the legacy app, ADD IT TO THE BRIDGE — in BOTH PLACES: the NULL_BRIDGE below
   AND the index.html block that builds the real one. Do not reach around.
   A capability added to one side only is precisely the failure this seam exists
   to prevent: the real bridge grows a method, NULL_BRIDGE does not, and the
   feature then works for a signed-in player on a live build and throws a
   TypeError for everyone else — offline, pre-migration, or on a test page.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Module-level, so the null toast is once per page load and not once per call.
   Declared ABOVE NULL_BRIDGE rather than below it: `let` is in its temporal dead
   zone until this line runs, and a circular import that reached toast() during
   module evaluation would get a ReferenceError instead of a log line. */
let _nullToastLogged = false;

/* A bridge-shaped object that does nothing, so this module can be imported and
   even rendered before index.html has published the real one (or in a test page
   that has no game at all). Every consumer is written against this shape, so
   "no bridge" is a designed state and not an error path.

   🔴 EVERY MUTATOR HERE RETURNS `false`. Never `undefined`, never a silent
   success. That is a DELIBERATE DEPARTURE from the file this one is modelled on:
   /src/community/community.bridge.js's NULL_BRIDGE has `addGems: () => {}` and
   `saveProfile: () => {}`. Those are safe there — community is a read-mostly
   Supabase feature and a swallowed no-op costs nobody anything. Transport spends
   Cinder, registers rigs and settles freight contracts, and this repo has
   already measured what the other choice costs:

     • index.html ~207446 — MythicCityBridge's `setProdState`/`save` were
       `try { … } catch (e) {}`. That made production.state.js's
       refund-on-record-failure branch DEAD CODE: a `saveProfile()` throw charged
       the player 50,000 Cinder for a building that never persisted, and
       `build()` still returned `{ok:true}`.
     • index.html ~207358 — MythicTradeBridge's banner: "/src/trading's
       settlement engine decides whether to unwind a whole trade from these
       return values, and a wrapper that returns `undefined` on success would
       make its rollback path fire on a leg that actually worked."

   A no-op that reports success in front of a Cinder spend is exactly how a
   player gets charged for something that never persisted. `false` IS the
   contract: the caller checks it, refuses, and prints why.

   ⏱ ACCESSORS ARE FUNCTIONS, NEVER SNAPSHOTS — every entry below except
   collectCdMs / accrualCapH. A value captured at bridge-construction time goes
   stale the moment the player loots, spends, or buys a rig, and a stale Cinder
   balance in front of a spend is an affordability check that fails open. */
export const NULL_BRIDGE = {
  // ── Identity / account ────────────────────────────────────────────────────
  cloud: null,
  // The duck-typed method. bridge() tests THIS, not truthiness — see below.
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',

  // ── Cinder. Never Profile.gems arithmetic; the real side routes through
  //    spendGems()/addGems() and both report whether they happened.
  gems: () => 0,
  spendGems: () => false,
  addGems: () => false,

  /* ── Resources.
     ⚠ READ THIS TOLERANTLY AT EVERY CALL SITE. The two bridges that already
     exist in index.html disagree about this exact key: MythicTradeBridge ships
     `resources: () => RESOURCES` (a function, ~207371) and MythicCityBridge
     ships `resources: RESOURCES` (a bare array, ~207415). A consumer that
     assumes either form breaks against the other. It is a function here because
     everything else on this bridge is, but consumers do
     `typeof b.resources === 'function' ? b.resources() : (b.resources || [])`. */
  resources: () => [],
  getRes: () => 0,
  spendRes: () => false,
  /* ↩️ addRes vs refundRes is the whole safety story, and it is NOT a naming
     nicety. addRes is the CAPPED add: it respects the stash cap and adds nothing
     when the vault is full, which is correct for a payout (a delivery that
     overflows is a smaller delivery) and catastrophic for an undo (an unwind
     that silently adds nothing has destroyed the units it was refunding).
     refundRes is the UNCAPPED undo and is only ever the reversal of a deduction
     the same call stack just made. Payouts: addRes. Refunds: refundRes. */
  addRes: () => false,
  refundRes: () => false,

  /* ── Operation economy. `_opEcon('transport')` is the ONLY sanctioned place a
     business is priced (CLAUDE.md). Nothing in /src/transport may hardcode a
     startup cost, a worker rate or a salary — it asks here and refuses if the
     answer is null, because a hardcoded copy is a second price the shop can
     advertise while the charge does something else. */
  opEcon: () => null,
  // Falls back to the raw key on purpose: OP_LABELS is built off Object.keys()
  // and a missing label ships a shop entry called "transport" rather than
  // nothing at all, so echoing the key is the honest degraded answer.
  opLabel: (t) => t,
  ownsCharter: () => false,
  charterWorkers: () => 0,

  /* ── Prince Portfolios lot. The real side hands back COPIES of the lot
     vehicles, so nothing in this module can mutate a player's vehicle by
     accident just by rendering it. setRigField is the ONLY writer and its keys
     are allow-listed on the index.html side — a writer that accepted any key
     would be a generic Profile write with extra steps, and the allow-list is
     what keeps "what can this module change?" answerable. */
  lot: () => [],
  lotCap: () => 0,
  // PP_COND_MULT lives in index.html and is the authority for what a condition
  // is worth. It is asked for, never copied: effective runs are
  // floor(rarityRuns × condMult), so a local copy that drifted would pay a
  // carrier for runs the auction floor does not think their truck can make.
  condMult: () => 1,
  conditions: () => [],
  // The game's existing rarity ladder (index.html ~39231). Asked for rather
  // than redeclared — the auction minigame already runs a SECOND, incompatible
  // ladder (PPA_RARITIES: five tiers, capitalised, no Uncommon), and a third
  // copy here is how a rig ends up with two contradictory rarities.
  rarities: () => [],
  setRigField: () => false,

  /* 🔴 GARAGE RIGS ARE A SEPARATE RAIL — RATIFIED, DO NOT RELITIGATE.
     Garage rigs are bought with REAL MONEY ($20/$60/$99) and are the player's
     OWN operative cap (`_convoyCapacity`) and OWN freight (`_jbConvoys`).
     PP fleet rigs bought with Cinder haul OTHER players' cargo and NEVER raise
     the owner's personal cap. Handing Cinder rigs comparable numbers would
     devalue a product people have already paid for, which is a refund
     conversation and not a balance conversation. Garage ownership instead pays
     out as a FLEET-WIDE perk (slots / runs-per-day), so shipping this feature
     makes the paid tier more valuable rather than less.
     The null shape is not invented: index.html's `_garageRig()` (~164225)
     already returns `{owned:false, name:'Hand-hauled'}` for the no-rig case and
     the UI already renders that string, so the empty state here is the empty
     state the game already has. */
  garageRig: () => ({ owned: false, name: 'Hand-hauled', tier: 0, load: 1, risk: 0, speed: 1 }),

  // ── Geography. A depot has a real map position; routes cross real ground.
  campNodeId: () => null,
  /* Territory Wars nodes, for routes and tolls. Routes POINT at these — there is
     no parallel node system — so an empty array must SAY the map is unavailable
     rather than let the exchange invent endpoints nobody can deliver to. */
  twNodes: () => [],
  regionControl: () => 0,
  myCorp: () => null,
  /* 🏭 The city production module, for the Freight Depot's placement and level.
     module → window is the direction that works; window → `const Profile` is the
     direction that does not, and is the trap this whole file documents. */
  cityProd: () => null,

  // ── Persistence + chrome
  save: () => false,
  /* Logged ONCE and then dropped. A null-bridge toast has no UI to land in, and
     a module whose refusals all fall back to console.log will happily print a
     hundred identical lines while a repaint loop runs — which buries the one
     line that mattered. The warn-once flag in index.js exists for the same
     reason and for the same failure. */
  toast: (m) => {
    if (_nullToastLogged) return;
    _nullToastLogged = true;
    try { console.log('[transport] (no bridge) ' + m + ' — further toasts suppressed.'); } catch (e) {}
  },
  // Async on purpose: gcConfirm() is async, so a caller written against the null
  // bridge and a caller written against the real one await the same thing.
  // Refusing is the safe default — an unattended confirm must not spend Cinder.
  confirm: async () => false,
  render: () => {},
  isAdmin: () => false,

  /* ⚠ todayKey() IS FOR OPTIMISTIC DISPLAY ONLY. index.html's getTodayKey()
     (~71039) is `new Date()` in the player's LOCAL timezone with no anchor, so
     moving the OS clock mints a fresh day. That is tolerable for a counter that
     only cheats the player themself (the convoy daily cap), and NOT tolerable
     for a carrier's runs/day, which other players pay Cinder for. The authority
     for `day_key` / `runs_used` is the DATABASE clock inside transport_dispatch().
     This value may be shown; it may never gate a dispatch. Same reasoning that
     moved world chat to the chat_send() RPC in v120g0 — the client keeps its
     copy purely as instant feedback, never as enforcement. */
  todayKey: () => null,

  /* ⏱ THE TWO NON-FUNCTION ENTRIES, AND THE ONLY ONES. These are the game's
     EXISTING idle contract (OP_COLLECT_CD_MS / OP_ACCRUAL_CAP_H), PASSED across
     the seam rather than redeclared, so transport cannot become a fourth idle
     policy alongside the Bunkhouse, the city Resting House and corp operations.
     The numbers below are index.html's own fallbacks and are a LAST RESORT, not
     an authority: whenever a real bridge is mounted its values win. If these two
     ever disagree with index.html, index.html is right and this line is stale. */
  collectCdMs: 6 * 3600000,
  accrualCapH: 36,

  // The marker bridgeReady() reads. Present on NULL_BRIDGE only — the real
  // bridge must never carry it, or the feature will report itself inert while
  // working perfectly.
  _null: true,
};

/* 🔴 DUCK-TYPED, NOT TRUTHINESS-TESTED, AND THE WHOLE RESOLVER IS WRAPPED.
   `window.MythicTransportBridge || NULL_BRIDGE` is the obvious version and it is
   wrong: it accepts a half-built object. If the index.html block throws part way
   through construction, or a future edit lands a partial bridge, `||` hands back
   an object that has `gems` but not `spendRes`, and the module then half-works —
   reads succeed, the first write throws a TypeError out of a click handler, and
   the player is looking at a panel that took their Cinder decision and did
   nothing. Testing one known method means a partial object is REJECTED and the
   feature degrades to fully inert, which is a state the UI knows how to draw.

   The try/catch is not decoration either: touching `window` can throw in a
   sandboxed/cross-origin frame, and this function is called from every render
   path in the feature. It must be total. */
export function bridge() {
  try {
    const b = (typeof window !== 'undefined') && window.MythicTransportBridge;
    return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE;
  } catch (e) { return NULL_BRIDGE; }
}

export function bridgeReady() { return !bridge()._null; }

/* ── Small shared helpers ───────────────────────────────────────────────────
   esc() lives here rather than being imported from the legacy app because every
   render path needs it and it must never be the reason a module fails to load.
   Five characters, and the apostrophe is not optional: rig names, company names
   and tariff notes are player-supplied text, and attributes in this feature's
   markup are single-quoted in places. An unescaped `'` there closes the
   attribute, which is the difference between an escaping helper and a decoration.

   These two are a deliberate duplicate of community.bridge.js's copies rather
   than a shared import. There is no authority to fight over — a formatter is
   display-only and two modules formatting a number differently cannot cost
   anyone anything — and a cross-feature import edge would mean /src/community
   failing to load takes freight down with it. Contrast the numbers that DO have
   an authority (collectCdMs / accrualCapH, condMult, rarities, opEcon): those
   are passed across the bridge, never copied. The thresholds match community's
   on purpose, so the same balance does not read two ways in two panels. */
export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
       : v >= 10000 ? (v / 1000).toFixed(1) + 'k'
       : Math.round(v).toLocaleString();
}
