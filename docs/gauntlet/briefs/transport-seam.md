# BRIEF — transport.bridge.js + index.js — the module-side seam and the entry point

## GOAL
Write TWO new files. (1) /home/user/Playmythicspellbook/public/src/transport/transport.bridge.js: the module-side half of the seam — a full-shape NULL_BRIDGE, a bridge() resolver that duck-types rather than testing truthiness, bridgeReady(), and the local esc/fmtNum helpers every render path needs. (2) /home/user/Playmythicspellbook/public/src/transport/index.js: the entry point that registers window.MythicTransport, mounts the overlay, injects the stylesheet once, delegates events, warns once when the bridge is absent, and stays completely inert without it. Together these are the file that decides whether a broken transport feature can take the game down. It must not be able to.

## FILES YOU OWN (write ONLY these)
- public/src/transport/transport.bridge.js
- public/src/transport/index.js

## ACCEPTANCE CRITERIA (a critic verifies each against your real output)
1. Both files exist; `node --check` passes on each. (Do NOT cite `node _synckcheck.mjs` on a .js path — it only extracts inline <script> blocks from HTML and prints ALL CLEAN on a .js file. False green.)
2. transport.bridge.js exports exactly: NULL_BRIDGE, bridge(), bridgeReady(), esc(t), fmtNum(n). bridge() NEVER returns null — it substitutes NULL_BRIDGE.
3. bridge() duck-types one known method (`typeof b.signedIn === 'function'`) rather than `window.MythicTransportBridge || NULL_BRIDGE`, so a half-built object is rejected rather than half-used, and the whole resolver is inside try/catch.
4. NULL_BRIDGE's key set is IDENTICAL to the key set of the real bridge built in index.html (the list is pinned verbatim in the context below). A critic can extract both key sets and diff them; a key on one side only is a fail.
5. Every NULL_BRIDGE MUTATOR returns false, never undefined and never a silent success: spendGems, addGems, spendRes, addRes, refundRes, setRigField, save all return false. A comment states why — a no-op that reports success in front of a Cinder spend is how a player gets charged for something that never persisted.
6. esc() escapes five characters including the apostrophe, and a comment says it is defined here rather than imported from the legacy app because every render path needs it and it must never be the reason a module fails to load.
7. index.js registers `window.MythicTransport` inside try/catch and nothing throws at import time. No top-level await, no top-level DOM query outside a guard, no nested property read of a possibly-absent object at module scope.
8. window.MythicTransport exposes at minimum: version, ready(), open(), close(), paint(), bridgeReady(), debug(), rigCatalog(), rollRig(), rarityIndex(id), onCharterFounded(opts). The last four are called BY index.html and their names are frozen.
9. onCharterFounded({free:true}) is idempotent: calling it twice does not mint a second free starter rig. A guard is present and commented.
10. With no bridge present, importing the module registers it, warns EXACTLY ONCE via a module-level `let _warned` flag, and every mutating entry point returns `{ ok:false, why: … }` with a printable reason rather than throwing or silently succeeding.
11. The stylesheet is injected lazily and once, guarded by `document.getElementById(<id>)`, from index.js — not at import of the render module and not on every paint.
12. Overlay listeners are DELEGATED on the overlay root (`ev.target.closest('[data-mt]')`), not attached to elements a repaint replaces, and there is a re-entrancy `busy` flag around async actions. close() removes the node.
13. `grep -nE "\\b(Profile|Cloud|App|Corp|Forge|RESOURCES|OPS_ECON|Catalog|Camp|Operations|root|showToast|gcConfirm|spendGems|addGems)\\b" public/src/transport/*.js` returns zero non-comment hits in these two files other than as property names on the bridge object.
14. Neither file contains `.from(` or `.rpc(` — all Supabase access lives in contracts.js.
15. A header comment names the globals trap as a LANGUAGE MECHANIC (lexical const bindings are not window properties), names that it has already cost real time twice, and carries the standing instruction: if a module needs something new, add it to the bridge in BOTH places; do not reach around.
16. No 'discord' / 'webhook' anywhere including comments. No file upload, FormData, createObjectURL, or storage.from(.

## CONTEXT
You are writing TWO new files and no others:
  /home/user/Playmythicspellbook/public/src/transport/transport.bridge.js
  /home/user/Playmythicspellbook/public/src/transport/index.js
`public/` is the deploy root, so these are served at /src/transport/*.js.

WHY THIS FILE EXISTS AT ALL — read the bar file first. /home/user/Playmythicspellbook/public/src/community/community.bridge.js is 76 lines and is the shortest complete statement of the pattern. Its header, verbatim: "index.html declares Profile, Cloud, App, Corp and Forge as top-level `const`. Those are global LEXICAL bindings — they are NOT properties of `window`, so an ES module genuinely cannot see them. `window.Profile` is undefined even though `const Profile` is right there. This has already cost real time twice (FoundationReserve and Profile, both in the Node City bridge). So index.html hands this module exactly what it needs, once, as `window.MythicBridge`. Nothing in /src/community reads a bare global. If a module needs something new from the legacy app, ADD IT TO THE BRIDGE (both here and in the index.html block that builds it). Do not reach around." Its NULL_BRIDGE comment: "A bridge-shaped object that does nothing, so the module can be imported and even rendered before index.html has published the real one (or in a test page that has no game at all). Every consumer is written against this shape." Its resolver:
  export function bridge() {
    try { const b = (typeof window !== 'undefined') && window.MythicBridge;
          return (b && typeof b.signedIn === 'function') ? b : NULL_BRIDGE; }
    catch (e) { return NULL_BRIDGE; }
  }
  export function bridgeReady() { return !bridge()._null; }
And its utilities carry reasons: esc() "lives here rather than being imported from the legacy app because every render path needs it and it must never be the reason a module fails to load"; `twNodes: () => []` is annotated with a design rule so an empty return "says so rather than inventing targets."

🔴 ONE DELIBERATE DEPARTURE FROM THE BAR, AND YOU MUST WRITE THE REASON DOWN. community's NULL_BRIDGE has `addGems: () => {}` and `saveProfile: () => {}` — mutators that succeed silently. That is safe for a read-only Supabase feature and DANGEROUS here, because Transport spends Cinder and buys rigs. index.html:207446-207451 records the measured cost of the same mistake on the city bridge: "🔴 RETURN FALSE ON FAILURE — DO NOT SWALLOW IT. These two were `try { … } catch (e) {}`, which made the module's refund-on-record-failure path dead code: a saveProfile() throw charged the player 50,000 Cinder for a building that never persisted, and build() still returned {ok:true}." And MythicTradeBridge's banner at index.html:207358-207362: "🔴 EVERY MUTATOR RETURNS A BOOLEAN. That is not decoration: /src/trading's settlement engine decides whether to unwind a whole trade from these return values, and a wrapper that returns `undefined` on success would make its rollback path fire on a leg that actually worked." So: every NULL_BRIDGE mutator returns FALSE. Say so, and say why, in the file.

═══ THE PINNED BRIDGE KEY SET ═══
The index.html half (`window.MythicTransportBridge`) is being written in parallel by another builder from the SAME list. Your NULL_BRIDGE must have exactly these keys and no others; a mismatch on either side is a fail for both:

  cloud            getter → the Supabase Cloud object or null   (NULL: null)
  signedIn()       → boolean                                    (NULL: false)   ← the duck-typed method
  userId()         → string|null                                (NULL: null)
  displayName()    → string                                     (NULL: 'Survivor')
  gems()           → integer                                    (NULL: 0)
  spendGems(n)     → boolean                                    (NULL: false)
  addGems(n,why)   → boolean                                    (NULL: false)
  resources        → array of {id,name,icon,color} defs         (NULL: [])
  getRes(id)       → integer                                    (NULL: 0)
  spendRes(id,n)   → boolean                                    (NULL: false)
  addRes(id,n)     → boolean  (CAPPED add — payouts)            (NULL: false)
  refundRes(id,n)  → boolean  (UNCAPPED undo — refunds only)    (NULL: false)
  opEcon(t)        → object|null                                (NULL: null)
  opLabel(t)       → string                                     (NULL: t)
  ownsCharter()    → boolean                                    (NULL: false)
  charterWorkers() → integer                                    (NULL: 0)
  lot()            → array of COPIES of PP lot vehicles         (NULL: [])
  lotCap()         → integer                                    (NULL: 0)
  condMult(c)      → number                                     (NULL: 1)
  conditions()     → array of condition strings                 (NULL: [])
  rarities()       → array of {id,name,color}                   (NULL: [])
  setRigField(vehicleId, key, val) → boolean (allow-listed keys)(NULL: false)
  garageRig()      → {owned,name,tier,load,risk,speed}          (NULL: {owned:false,name:'Hand-hauled',tier:0,load:1,risk:0,speed:1})
  campNodeId()     → string|null                                (NULL: null)
  twNodes()        → array of {id,name,regionId,resourceYield}  (NULL: [])
  regionControl(regionId, corpId) → number 0..100               (NULL: 0)
  myCorp()         → {id,name,tag}|null                         (NULL: null)
  cityProd()       → window.MythicCityProduction or null        (NULL: null)
  save()           → boolean                                    (NULL: false)
  toast(m,ms)      → void                                       (NULL: console.log once)
  confirm(m)       → Promise<boolean>                           (NULL: async () => false)
  render()         → void                                       (NULL: noop)
  isAdmin()        → boolean                                    (NULL: false)
  todayKey()       → 'YYYY-MM-DD' or null                       (NULL: null)
  collectCdMs      → number (NOT a function — a constant passed through)
  accrualCapH      → number (NOT a function)
Plus `_null: true` on NULL_BRIDGE only, which is the marker bridgeReady() reads.
Note the two non-function entries: collectCdMs / accrualCapH are the shared idle contract, PASSED rather than redeclared, so transport cannot become a fourth idle policy alongside the Bunkhouse, the city Resting House and corp operations. Every other accessor is a FUNCTION, never a snapshot, because a captured value goes stale the moment the player loots or spends.

⚠ `todayKey()` is for OPTIMISTIC DISPLAY ONLY and must be commented as such. index.html:71039's getTodayKey() is `new Date()` in the player's LOCAL timezone with no anchor — changing the OS clock mints a fresh day. That is tolerable for a counter that only cheats the player themself, but a carrier's runs/day is paid for in Cinder by other players, so the authority is the database clock inside transport_dispatch(). Same reasoning that moved world chat to the chat_send() RPC in v120g0: the client keeps its copy purely as instant feedback, never as enforcement.

═══ index.js — THE ENTRY POINT ═══
PINNED MODULE CONTRACT. Six files are being written in parallel. You import from five of them; match these names and arities exactly.
  from './rigs.data.js'    : PP_RIGS, PP_RIGS_BY_ID, RIG_RARITIES, rollRig, rigById, rarityIndex, effectiveRuns, fleetSlotBonus, runsPerDayBonus, auditRigs
  from './routes.js'       : PHASE, MERIDIAN, MERIDIAN_TARIFF_MULT, MERIDIAN_TIME_MULT, hops, inReach, tariffCap, quote, meridianQuote
  from './contracts.js'    : MISSING_RE, OFFLINE, myCompany, listCarriers, listMyRigs, listContracts, createCompany, setTariff, registerRig, dispatch, settle, repair
  from './depot.js'        : DEPOT_DEF_ID, depots, bestDepot, depotEffect, fleetCap, bays, depotReady
  from './depot.render.js' : TRANSPORT_CSS, renderTransport

renderTransport(view) is PURE — it returns an HTML string and attaches nothing. index.js assembles `view` and owns all DOM. The view shape is fixed:
  { ready, offline, missing, error, tab:'depot'|'fleet'|'exchange',
    charter:{owned,workers,label,startup},
    depot:{ok,why,fix,level,bays,fleetCap,radius},
    garage:{owned,name,tier,slotBonus,runBonus},
    fleet:[{vehicleId,name,rarity,rarityName,rarityColor,condition,runs,runsUsed,runsLeft,assignedTo,status}],
    carriers:[{id,name,tariff,reliability,coverage,freeBays,meridian}],
    contracts:[{id,fromName,toName,cargoText,price,etaText,progress,status,risk}],
    quote:{carrierId,carrierName,price,capped,hops,etaText,riskPct,meridian}|null,
    cinder }
Every clickable element the renderer emits carries a `data-mt="<action>"` attribute plus `data-mt-id` where relevant. You bind ONE delegated click handler on the overlay root and dispatch on `ev.target.closest('[data-mt]')`, because paint() replaces the inner HTML and a direct listener would not survive it (this is the community.render.js pattern, and the reason is stated there).

STRUCTURE TO COPY, from /home/user/Playmythicspellbook/public/src/city/index.js:
- The header block: what it registers, that new features live outside index.html per CLAUDE.md, the globals-trap paragraph, and "⚠ Everything here is wrapped so a failure inside production can never take the game down. The city is a feature; the game is the product."
- Warn-once degradation, verbatim shape (city/index.js:87-96):
    let _warned = false;
    function host() { const h = makeHost(); if (!h && !_warned) { _warned = true; try { console.warn('[city/production] window.MythicCityBridge is absent — production is inert. index.html must hand the module its capabilities (the globals trap).'); } catch (e) {} } return h; }
- Every public method re-derives the bridge per call — "Bound to the live bridge on each call so a late-mounted bridge still works" — and returns a TYPED no-bridge value, never a throw: `{ ok:false, why:'no bridge' }`, `''`, `false`, `[]`.
- Lazy one-shot CSS injection (city/index.js:143-157): "Inject the stylesheet once, lazily — a module that appends a <style> on import costs nothing when the panel is never opened." Use id `mt-css`.
- Registration tail wrapped: `try { if (typeof window !== 'undefined') { window.MythicTransport = api; … } } catch (e) { try { console.warn('[transport] registration failed:', e); } catch (e2) {} }`.
- From /home/user/Playmythicspellbook/public/src/community/index.js: fire a `mythic:transport-ready` CustomEvent so the legacy launcher tile can appear, and add a `debug()` returning `{ bridgeReady, signedIn, missing, offline, error, rigs: PP_RIGS.length, phase: PHASE }`. Add a console shorthand — but `window.__mt` may collide with Mythic Token naming elsewhere; grep first (`grep -n "window.__mt\\b" public/index.html` currently returns 0) and pick something unambiguous like `window.__mtr` if in doubt, and say in a comment that you checked.

FROZEN NAMES CALLED BY index.html (another builder is writing those call sites right now — do not rename):
  window.MythicTransport.rigCatalog()      → PP_RIGS (or null/[] when unavailable)
  window.MythicTransport.rollRig()         → one weighted rig entry or null
  window.MythicTransport.rarityIndex(id)   → 0..5
  window.MythicTransport.onCharterFounded({ free: true })  → seeds the free starter rig, idempotent
  window.MythicTransport.open()            → opens the overlay
The index.html founding hook has an else-branch that toasts when this module is absent, so open() must exist as soon as the module registers even if the bridge is not there yet — in that state it should open and show the 'not set up yet' state rather than doing nothing silently.

⚠ onCharterFounded seeds "the rig every carrier starts with", exactly as index.html:80205 does for fishing (`wfBuyBoat('skiff', { free: true, name: 'The Starter' })`). It must be idempotent: index.html:80217 guards the analogous cars unlock with `if (!_pp.owned)`, and _opAfterFound is reachable from THREE call sites (index.html:79968, 82273, 82388). Founding twice must not mint two free rigs.

HARD RULES: no npm dependencies, no bare-specifier or CDN imports (every import is a relative path ending in .js); no `.from(`/`.rpc(` in these two files; nothing throws at import; no image/video upload of any kind; never write 'discord' or 'webhook', including in a comment — that decision is settled and a comment proposing it counts as re-proposing it.
