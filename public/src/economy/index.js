/* ════════════════════════════════════════════════════════════════════════════
   🏙 CITY ECONOMY — module entry point. Registers window.MythicEconomy.
   ----------------------------------------------------------------------------
   CLAUDE.md: "NEW features go in public/src/<feature>/ as ES modules. Never add
   a new top-level system to index.html." So the whole economy — data, model,
   tick and diagnosis — lives here, and the host adds ONE script tag and calls
   ONE function per tick.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has cost this project real time twice).
   `Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES` are top-level `const`
   in index.html — global LEXICAL bindings, NOT properties of `window`. An ES
   module cannot see them, and `window.Profile` is undefined however global
   `const Profile` looks. So this module reads NOTHING by itself. Everything
   arrives through `window.MythicCityBridge`, which node-city already owns and
   already mounts, and if the bridge is missing the module registers, stays
   inert, and says so exactly once.

   🔴 AND IT MUST DEGRADE TO NOTHING. node-city reads this defensively — every
   call site checks `window.MythicEconomy` first. A 404 on /src/economy/* costs
   the player the economy panel and nothing else: the city ticks, the buildings
   produce, and the game is unchanged. Same contract /src/nodes/tiers.js and
   /src/city/terroir.js already document for themselves.

   ── WHAT THIS TOUCHES, AND WHAT IT MUST NEVER TOUCH ─────────────────────────
   TOUCHES:
     • its own simulation state, persisted inside the city save blob
     • `MythicCityBridge.addCinders` — ONCE per tick, for the audited payout
   NEVER TOUCHES:
     • `addRes` / `spendRes` for any chain resource. The 258 ids in
       /src/resources/chain.js are NOT in index.html's `RESOURCES`, and writing
       one through the bridge invents a ledger key the camp UI cannot show and
       the cloud whitelist never syncs — node-city documents this trap at
       CITY_STOCK §2b. Economy goods live in the economy's own inventory.
     • battle, card or combat code (CLAUDE.md: out of scope).
     • `player_banks` and anything else holding real player Cinder. See bank.js.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON, econ } from './tuning.js';
import * as Tuning from './tuning.js';
import * as Recipes from './recipes.js';
import * as Endow from './endowment.js';
import * as Prices from './prices.js';
import * as HH from './households.js';
import * as Firms from './firms.js';
import * as Logistics from './logistics.js';
import * as Bank from './bank.js';
import * as Trade from './trade.js';
import * as Sim from './sim.js';
import * as Bottleneck from './bottleneck.js';
import * as Construction from './construction.js';
import * as Render from './render.js';

const B = () => (typeof window !== 'undefined' ? window.MythicCityBridge : null) || null;

/* ── 🏷 THE LAND VALUE READ ──────────────────────────────────────────────────
   /src/landvalue registers `window.MythicLandValue` — a real property of
   `window`, unlike the top-level `const`s of index.html (the globals trap at
   the top of this file), so it can be read from here. Every `window` read in
   this package lives in this file next to the bridge, so sim.js is handed a
   function instead: `Sim.setLandValueSource`.

   🔴 WHAT IS READ IS THE LOCATION PREMIUM, NOT `valueAt()`. The printed value
   is CITY + LOCAL and the CITY half — `20 + citySync×0.3 + decorPoints()` — is
   identical on every tile AND unbounded, because `decorPoints()` grows with
   every garden the player ever plants. Renting off it would charge every
   business in the city for landscaping across town, for ever. `premiumAt()` is
   the part that describes THIS plot, it is what /src/landvalue takes its own
   bands on, and it is capped by construction at the sum of that module's caps.

   🔴 ABSENT ⇒ null ⇒ NO RENT, and that is asked EVERY CALL rather than latched
   at mount. The module is imported asynchronously by node-city's boot and may
   land after the economy does; a source captured once at mount time would read
   "no land value in this city" for the whole session on exactly the builds
   where it is present. It is a property lookup and two calls, on ~30 firms,
   once an economic day.
   ⚠ AND null IS NOT 0. sim.js charges nothing for a null and would charge
     nothing for a 0 too — today. The distinction is kept because the day
     somebody adds a base rate, "no module" and "worthless land" must not
     silently mean the same thing. */
function landPremiumAt(x, z) {
  const LV = (typeof window !== 'undefined') ? window.MythicLandValue : null;
  if (!LV || typeof LV.premiumAt !== 'function') return null;
  if (typeof LV.ready === 'function' && !LV.ready()) return null;
  const p = LV.premiumAt(x, z);
  return (typeof p === 'number' && Number.isFinite(p)) ? p : null;
}
Sim.setLandValueSource(landPremiumAt);

let warned = false;
function warnOnce(msg) {
  if (warned) return; warned = true;
  try { console.warn('[economy] ' + msg); } catch (e) {}
}

let mounted = false;
let lastPayoutAt = 0;
/* 🔴 WHICH CITY IS ON THE BOOKS. Bumped by every mount(), and captured before
   the payout crosses the bridge so a rejection that lands AFTER a remount is
   discarded instead of refunded. `mount()` calls `Sim.reset()`, which zeroes
   `payoutOwed` — so without this, an in-flight rejection from the previous city
   would be credited to the new one, which is a mint by way of a stale promise.
   Narrow, but it is the same shape as every other defect in this file: money
   moving outside the window anything is watching. */
let mountGen = 0;
/* ⏳ MOUNTED, BUT THE BOOTSTRAP DECISION HAS NOT BEEN MADE — the third state.
   `mounted` stays FALSE while this is true, deliberately: `ready()`, `tick()`,
   `snapshot()` and `serialize()` all gate on `mounted`, and every one of them
   would be wrong on an un-bootstrapped simulation. `tick()` would advance a city
   with no firms and no charter; `serialize()` would write that emptiness into
   the save and the NEXT boot would read the blob as proof of an established
   city — turning a two-second network blip into a permanent refusal, which is
   the exact defect deferral exists to end. So a deferred economy is inert and
   invisible to the save, and `deferred()` is how the host tells that apart from
   "the module never loaded". */
let deferred = false;
let deferCtx = null;                 // {nodeId, population} — replayed by resolve()

/* Boolean or string → one of three verdicts. `true`/`'established'` and
   `false`/`'new'` are answers; `'unknown'` (or any other non-absent value) is
   the refusal to answer, and it is the only value that costs the player nothing
   in either direction.

   ⚠ AN ABSENT FLAG MEANS 'new', AND THAT IS NOT THE FAIL-OPEN DEFAULT THIS
     PACKAGE EXISTS TO KILL. `mount()` with no state and no flag is the literal
     statement "found a fresh city on this node" — it is what every test harness
     and every future embedder means by it, and it is what this module has always
     done (`opts.established === true` read an absent flag as `false`). The
     dangerous default was never here: it was in node-city, where the flag is
     DERIVED FROM A SAVE and an unreadable save used to collapse into one of the
     two answers. That is now three-valued at source — `_cityVerdict` is
     initialised to 'unknown' and is one of the three strings on every path
     including a throw before loadState runs — so the production caller can no
     longer reach this branch at all, and run.mjs asserts that its `E.mount({…})`
     literal still passes an explicit verdict. Deferring an absent flag instead
     would only move the guess into callers that have nothing to guess about. */
function verdictOf(v) {
  if (v === true || v === 'established') return 'established';
  if (v === false || v === 'new' || v === undefined) return 'new';
  return 'unknown';
}

/* ── MOUNT ──────────────────────────────────────────────────────────────────
   Called by the host once the bridge exists. `nodeId` decides the ground the
   city stands on and therefore everything else. */
function mount(opts) {
  opts = opts || {};
  const nodeId = opts.nodeId != null ? opts.nodeId : null;
  Sim.setNode(nodeId);

  let hadState = false;
  if (opts.state) {
    Sim.load(opts.state);
    Sim.setNode(nodeId);            // a save from another node must not move the ground
    hadState = true;
  } else {
    Sim.reset(nodeId);
  }
  if (typeof opts.population === 'number') HH.setPopulation(opts.population);
  /* 🔴 `established` — THE SAVE-KEY RE-ARM, AND THE HALF OF IT THIS MODULE CAN
     ACTUALLY REACH. sim.js `bootstrap()` issues a 300,000 🔥 founding tranche
     and re-opens the 700,000 🔥 lifetime allowance whenever it is called on a
     fresh state. node-city reads a missing `economy` key as `null`
     (node-city/index.html, `_pendingEconomy = (s.economy && …) ? s.economy :
     null`) and then mounts with `state: null` — so DELETING that one key from
     the save re-arms the tranche, with no console and surviving reloads.

     Nothing inside /src/economy persists across a reload except the blob it is
     handed, so this module structurally cannot tell a brand-new city from an
     established one that lost its economy key. The host can, and it is one
     line: node-city already has the parsed save in `loadState`, so

         E.mount({ nodeId, population: cityPop(), state: _pendingEconomy,
                   established: !!(s.tiles && Object.keys(s.tiles).length) })

     ✅ WIRED. node-city now derives it in `loadState()` from the parsed save
       (`_pendingEstablished`) and passes it here — see node-city/index.html,
       the `E.mount({ … established: _pendingEstablished })` call. Before that
       line existed the ONLY production caller passed no flag at all, so this
       refusal could never fire and the round that tested it passed
       `established: true` itself: a green test sitting on top of a fully open
       hole. MEASURED on the tree that had this refusal and no caller for it —
       a lived 180-day city, charterIssued 300,000.00 / totalCinder 293,295.48,
       remounted with the economy key deleted came back charterIssued 300,000.00
       / totalCinder 300,000.00, i.e. a fresh tranche AND the whole 700,000 🔥
       allowance re-armed (headroom back to 400,000.00), from deleting one JSON
       key, with no console and surviving reloads.

     🔴 `hadState` ALONE IS ALSO SUFFICIENT, AND IT IS THE SECOND DOOR. If this
        module was handed ANY state at all then the city already exists,
        whatever the blob says about itself — which is the whole of the
        `booted: false` defect: the save claimed it had never bootstrapped and
        sim.js `load()` believed it. That is fixed at source (sim.js now sets
        `S.booted = true` unconditionally in
        load()), but the two are deliberately independent: this one lives at the
        level that KNOWS whether a save was handed over, so a future edit to
        load() cannot silently reopen it. Reverting either one alone leaves the
        door shut; run.mjs breaks each in turn to prove it. */
  /* 🔴 …AND THE THIRD ANSWER, WHICH IS TO NOT ANSWER.
     `established` used to be read as `=== true`, i.e. a boolean with a default.
     Both defaults are wrong: `false` mints a fresh 300,000 🔥 tranche on any
     boot error, and `true` — the "fail closed" fix — PERMANENTLY DENIED a
     brand-new player their tranche whenever their very first city read was
     ambiguous (an RLS hiccup, a momentary offline, a save stamped for somebody
     else). Measured on that tree: charterIssued 0.00 🔥 against the 300,000.00 🔥
     a founded city receives, and nothing ever lowered it again.

     So an unrecognised or explicitly unknown verdict DEFERS: no bootstrap, no
     issuance, no refusal, no serialisation, and the host resolves it from the
     next trustworthy read through `resolve()` below. `hadState` still decides on
     its own — being handed a blob is proof the city exists whatever the caller
     believes, and it is the second door described above. */
  const verdict = hadState ? 'established' : verdictOf(opts.established);
  if (verdict === 'unknown') {
    deferred = true;
    mounted = false;
    deferCtx = { nodeId, population: (typeof opts.population === 'number') ? opts.population : null };
    mountGen++;                     // a payout in flight from a previous city is not ours
    try { console.warn('[economy] mounted DEFERRED — the host could not say whether this city already existed. No founding tranche has been issued OR refused; call resolve() when a trustworthy read arrives.'); } catch (e) {}
    return true;
  }
  deferred = false; deferCtx = null;
  Sim.bootstrap({ established: verdict === 'established' });
  mounted = true;
  mountGen++;

  /* 🔍 SELF-CHECKS. These are cheap, run once, and report rather than throw —
     a broken recipe must show up in the console with the offending id, not
     take the city down on load. */
  try {
    const chainIds = (window.MythicResourceChain && window.MythicResourceChain.ALL || []).map(r => r.id);
    const a = Recipes.audit(chainIds);
    if (!a.ok) {
      console.warn('[economy] recipe audit FAILED', a);
    } else if (a.orphans.length) {
      console.info('[economy] ' + a.orphans.length + ' catalogued resources have no producer yet (expected — see RESOURCES_NEXT.md).');
    }
    const resid = Prices.convergence();
    if (resid > 1e-3) console.warn('[economy] price relaxation did not converge (residual ' + resid + '). Check for a new recipe cycle.');
    const v = Endow.verify([String(nodeId || 'node')]);
    if (!v.ok) console.warn('[economy] endowment guarantees violated', v.violations);
  } catch (e) { /* diagnostics must never break the mount */ }

  return true;
}

/* ── ⏳ RESOLVE ─────────────────────────────────────────────────────────────
   The other half of a deferred mount, and the ONLY way out of it. The host calls
   this when — and only when — a trustworthy read has finally answered the
   question `mount()` refused to guess at.

   🔴 IT REFUSES AN 'unknown' JUST AS HARD AS mount() DOES. A retry that came
      back inconclusive is not new evidence, and accepting it here would put the
      guess back one function along, which is exactly how a three-valued state
      decays into a boolean with extra steps.

   ⚠ `Sim.bootstrap()` is idempotent by its own first line (`if (S.booted) return
     false`), so a double resolve cannot issue a second tranche even if a retry
     and a button land together. That guard is load-bearing here, not incidental.

   ⚠ mountGen IS BUMPED AGAIN. The deferred window is real time — a payout can
     have been claimed and be in flight from before it, and confirming it against
     the books of a city that has only just been founded would credit the wrong
     ledger. Same reasoning as mount()'s own bump. */
function resolve(opts) {
  if (!deferred) return false;
  opts = opts || {};
  let hadState = false;
  const nodeId = deferCtx ? deferCtx.nodeId : Sim.state().nodeId;
  if (opts.state) {
    Sim.load(opts.state);
    Sim.setNode(nodeId);
    hadState = true;
  }
  const verdict = hadState ? 'established' : verdictOf(opts.established);
  if (verdict === 'unknown') return false;      // still nothing to decide on
  if (deferCtx && typeof deferCtx.population === 'number') HH.setPopulation(deferCtx.population);
  Sim.bootstrap({ established: verdict === 'established' });
  deferred = false; deferCtx = null;
  mounted = true;
  mountGen++;
  try { console.warn('[economy] deferred mount RESOLVED as "' + verdict + '" — charterIssued ' + Sim.snapshot().charterIssued.toFixed(2) + ' 🔥'); } catch (e) {}
  return true;
}

/* ── THE TICK ───────────────────────────────────────────────────────────────
   Called from node-city's existing economyTick. `dtMin` is real minutes, the
   same figure the rest of the city runs on — a second clock would drift and
   two panels would disagree about how long a day is.

   Everything the simulation needs about the city arrives in `host`, gathered by
   the caller. This module never reaches out for it. */
function tick(dtMin, host) {
  if (!mounted) return null;
  try {
    const h = host || {};
    if (typeof h.population === 'number') HH.setPopulation(h.population);
    const snap = Sim.advance(dtMin, h);

    /* 💰 THE ONE WRITE TO THE REAL LEDGER, and it is audited on the way out.
       `claimPayout` returns 0 whenever the closed-loop audit has failed, so a
       simulation that cannot account for its own money pays nothing.

       🔴 AND IT IS ONLY SPENT WHEN THE BRIDGE CONFIRMS. This block used to read

           Promise.resolve(bridge.addCinders(owed)).catch(() => {});

       against a `claimPayout()` that decrements `payoutOwed` unconditionally
       and synchronously. So every rejection destroyed the player's money: the
       treasury had been debited on the day it was drawn and `flow.payout`
       recorded, which satisfied the day audit, and the Cinder then existed in
       NEITHER ledger. Measured against a bridge that rejected every call over
       400 ticks: 10,193 🔥 claimed, 0 🔥 delivered, `lastAudit.ok` true the
       whole way — because none of this happens inside runDay's window, which is
       the same blind spot the founding mint and the save-file mint lived in.
       'message' mode makes it ordinary rather than exotic: `addCinders` is an
       RPC there and rejects on a timeout or a dead parent.

       ⚠ THE `else` IS NOT DEFENSIVE PADDING. The bridge test used to sit AFTER
         the claim, so a missing bridge dropped the money down the same hole with
         no rejection involved at all. Whatever is claimed and not delivered goes
         back on the books, every path, no exceptions. */
    const owed = Sim.claimPayout();
    if (owed > 0) {
      const bridge = B();
      if (bridge && typeof bridge.addCinders === 'function') {
        const gen = mountGen;                       // see mountGen's declaration
        const back = () => { if (gen === mountGen) Sim.refundPayout(owed); };
        Promise.resolve(bridge.addCinders(owed))
          .then((res) => {
            /* 🔴 ONLY `true` IS A DELIVERY. THIS TEST USED TO BE `res === false`
               AND IT COULD NOT DETECT THE FAILURE IT WAS WRITTEN TO CATCH.
               The comment above it claimed "addCinders in 'message' mode is an
               RPC that rejects on timeout or a dead parent". It did not reject:
               node-city's `rpc()` resolved `null` from an 1800 ms setTimeout and
               `null` again when postMessage threw, and `B.addCinders` then did
               `await rpc(...); return;` — so it returned `undefined` on EVERY
               path, success and failure alike. `undefined !== false`, so a
               timed-out payout was booked as delivered and the player's Cinder
               was destroyed. MEASURED, 400 ticks against a parent that never
               answered: payoutLifetime 570.00 🔥 "delivered", payoutInFlight
               0.00 🔥, and 0.00 🔥 in the wallet.

               The bridge now returns a strict boolean (see B.addCinders), so the
               safe reading is the strict one: anything that is not a positive
               confirmation goes back on the books. `undefined` included — a
               bridge that cannot say "delivered" has not delivered.

               ⚠ THE DIRECTION IS DELIBERATE, and it is the opposite of the old
                 comment's fear. Re-owing at worst pays a queue the audit
                 reconciles (`payoutOwed` is not a term of `totalCinder()`, so a
                 refund moves the audited total by exactly zero and the next tick
                 simply tries the bridge again); reading a silence as success
                 destroys real money with nothing left to reconcile from. */
            if (res !== true) back();
            else {
              lastPayoutAt = Date.now();
              /* 💸 THE DELIVERY, CONFIRMED — and this is the ONLY line in the
                 codebase allowed to say so. It retires `payoutInFlight` and adds
                 to `payoutLifetime`; until it (or `back()`) runs, the money is
                 parked in `payoutInFlight` and therefore SURVIVES A TAB CLOSE.
                 ⚠ IT IS DELIBERATELY NOT IN claimPayout(). Tallying the CLAIM
                   would count money a rejecting bridge hands straight back via
                   refundPayout(), so a single Cinder would appear in two ledgers
                   at once. Claim and delivery are separate events; only the
                   second one is real.
                 Guarded by `gen` for the same reason `back()` is: a confirmation
                 that lands after a remount belongs to a city that no longer
                 exists. `mount()` calls `Sim.reset()`, which zeroes
                 `payoutInFlight`, so an ungated call here would decrement a
                 stranger's books. */
              if (gen === mountGen) Sim.notePayoutDelivered(owed);
            }
          })
          .catch(back);
      } else {
        Sim.refundPayout(owed);
      }
    }
    return snap;
  } catch (e) {
    /* A failure inside the economy must never take the city down. The city is
       a feature; the game is the product. */
    try { console.error('[economy] tick failed', e); } catch (e2) {}
    return null;
  }
}

/* ── FIRM ⇄ BUILDING SYNC ───────────────────────────────────────────────────
   The host owns the tiles; this owns the businesses. `syncBuildings` reconciles
   the two: a production building the player has placed becomes a firm, and a
   firm whose building is gone is closed.

   `list` is [{key, out, ind, capacity}] — the host maps its own tile types to
   resource ids, because only the host knows what its tiles mean.

   ⚠ THE GROUND STILL GATES IT. A building placed over a deposit this node does
     not have produces nothing (sim.js enforces it too), so the host should ask
     `canBuild()` BEFORE offering the blueprint — a building you can pay for and
     that then does nothing is worse than one you were never offered. */
function syncBuildings(list) {
  if (!mounted || !Array.isArray(list)) return { added: 0, removed: 0 };
  let added = 0, removed = 0;
  const wanted = new Map();
  for (const b of list) {
    if (!b || !b.out) continue;
    if (!Recipes.producible(b.out)) continue;
    wanted.set(String(b.key), b);
  }
  /* 🔴 A BAD READ MUST NEVER CLOSE A BUSINESS. Measured on a live city: 39
     firms alive against a highest issued id of 877 — 838 businesses founded
     and destroyed in 67 economic days, on a city that can only support 36.
     Every one of those reaps threw away that firm's cash, workers, suppliers
     and rung, so the economy could never compound: 9 residents and a 2,416
     treasury on a 153-tile city. The player reported it as "my city was
     removed", which is exactly what it looks like from inside.
     The cause is that `wanted` is trusted unconditionally. It is built from the
     host's ecoBuildings(), which returns [] when the economy is not mounted and
     drops EVERY tile at once if pickAvailable() cannot resolve the ground —
     both transient. One bad 4-second tick therefore bankrupts the whole city.
     Two guards, in order of bluntness:
       1. An EMPTY wanted list while tile-owned firms exist is never a real
          city. It is a failed read. Skip the reconcile entirely.
       2. Otherwise a firm must be missing on TWO CONSECUTIVE syncs before it
          is closed. A genuine demolition stays missing and closes on the next
          tick (4s later); a flapping read never gets its second strike.
     ⚠ This debounces ONLY the tile-missing reason. A firm the distress ladder
       marked BANKRUPT elsewhere is untouched and still reaps below. */
  const tileOwned = Firms.all().filter(f => f.tileKey).length;
  if (wanted.size === 0 && tileOwned > 0) {
    if (!syncBuildings._warned) {
      syncBuildings._warned = true;
      try { console.warn('[economy] syncBuildings got an EMPTY building list while ' + tileOwned +
        ' tile-owned firms exist — treating it as a failed read and closing nothing.'); } catch (e) {}
    }
    return { added: 0, removed: 0, skipped: 'empty-list' };
  }
  /* Collect the closures first, then decide whether the SHAPE of them is
     believable. Deciding per firm cannot tell a demolition from a failed read;
     deciding on the batch can. */
  const doomed = [];
  for (const f of Firms.all()) {
    if (!f.tileKey) continue;              // bootstrap firms are not tile-owned
    const b = wanted.get(String(f.tileKey));
    /* Gone, OR the tile was demolished and something else built on the same
       square. A key that now names a different business is not the same
       business — without this check a Sawmill rebuilt as a Clinic would keep
       the sawmill's balance sheet, payroll and supplier history. */
    if (!b || b.out !== f.out || b.ind !== f.ind) doomed.push(f);
  }
  /* ⚠ DEBOUNCE THE BATCH, NOT THE FIRM. An earlier version of this guard made
     EVERY closure wait for a second sighting, which also delayed the ordinary
     case — one building demolished, one business closed — and turned
     gauntlet3's "demolishing buildings closes their businesses" red. A player
     demolishes one tile at a time and syncs run every 4s, so a handful of
     closures in a single sync is normal play and closes immediately. A batch
     large enough to be most of the city is not something a player can do
     between two ticks; that is a failed read, and it waits for corroboration.
     MASS_CLOSE is deliberately generous: the failure this exists to stop takes
     out EVERY tile-owned firm at once, so it does not need a tight bar. */
  /* THE BAR IS "ALL OF THEM", not a tuned fraction. The observed failure is
     all-or-nothing — ecoBuildings() returns [] or resolves no ground at all, so
     EVERY tile-owned firm is doomed in the same sync. A partial batch, even a
     large one, is a thing the host can legitimately mean: gauntlet3 demolishes
     10 tiles of 25 in one go and must still close them. Picking a fraction that
     happened to let that through would be tuning the guard to the test rather
     than to the fault. 4 is a floor so a 2-firm city is not governed by noise. */
  if (tileOwned >= 4 && doomed.length >= tileOwned) {
    const sig = doomed.map(f => f.tileKey).sort().join('|');
    if (syncBuildings._massSig !== sig) {
      syncBuildings._massSig = sig;        // first sighting — corroborate before closing
      try { console.warn('[economy] syncBuildings would close ' + doomed.length + ' of ' + tileOwned +
        ' tile-owned firms in one sync — waiting for a second sighting before closing any.'); } catch (e) {}
      Firms.reap();                        // still reap anything the distress ladder bankrupted
      return { added: 0, removed: 0, skipped: 'mass-close-deferred' };
    }
    // same set missing twice running — it is real.
  }
  syncBuildings._massSig = null;
  for (const f of doomed) { f.rung = 'BANKRUPT'; f.reported = true; removed++; }
  Firms.reap();
  const have = new Set(Firms.alive().map(f => String(f.tileKey)).filter(Boolean));
  for (const [key, b] of wanted) {
    if (have.has(key)) continue;
    /* 📈 LEVEL SCALES CAPACITY, so upgrading a building means something
       economically rather than only visually. Explicit capacity wins if the
       host supplied one. */
    const lvl = Math.max(1, b.lvl | 0 || 1);
    const cap = b.capacity != null ? b.capacity : Firms.defaultCapacity(b.out) * lvl;
    Firms.found(b.out, { ind: b.ind, capacity: cap, tileKey: key, name: b.name });
    added++;
  }
  /* 👻 RETIRE THE BOOTSTRAP SCAFFOLD THE PLAYER HAS JUST REPLACED.
     The loop at the top of this function skips `!f.tileKey` on purpose, so it
     structurally CANNOT reap a firm `bootstrap()` seeded — which is how a city
     ended up with an invisible Waterworks pumping beside the Water Intake the
     player built, two payrolls for one job. sim.js owns both ends of a seeded
     firm's life and the reasoning is written at `retireSeededDuplicates`; it
     runs HERE, after the founding loop, because before it the replacement does
     not exist yet. Counted into `removed` so the host still saves. */
  const retired = Sim.retireSeededDuplicates();
  return { added, removed: removed + retired };
}

/* Can the player put an extractor for `resId` on this node at all?
   THE one gate — see endowment.js. Non-deposits always return true. */
function canBuild(resId) {
  return Endow.canExtract(Sim.state().nodeId, resId);
}

/* 🎯 Pick the best id this node can actually produce from a candidate list.
   ----------------------------------------------------------------------------
   The host maps a BUILDING to a set of plausible outputs — a Farm could grow
   wheat, corn, rice or potatoes — and this answers which one THIS ground
   supports, best seam first. Returns null when the node supports none of them,
   which is the host's cue not to offer the blueprint at all.

   🔴 THIS IS WHY A FARM IS NOT HARD-WIRED TO WHEAT. Pinning each building to a
   single resource would mean a node without wheat could not have a farm, and a
   player would pay for a building that then produced nothing — which is worse
   than never being offered it. It is also what makes one city a wheat town and
   its neighbour a rice town without either of them choosing. */
function pickAvailable(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const nodeId = Sim.state().nodeId;
  let best = null, bestRank = -1;
  for (const id of ids) {
    if (!Recipes.producible(id)) continue;
    // A non-deposit is always makeable; a deposit has to be in the ground.
    if (!Recipes.isDeposit(id)) return id;
    if (!Endow.canExtract(nodeId, id)) continue;
    const rank = (Endow.gradeDef(Endow.gradeOf(nodeId, id)) || {}).rank || 0;
    if (rank > bestRank) { bestRank = rank; best = id; }
  }
  return best;
}

/* ── 🃏 THE FOUNDATION RESERVE SEAM ─────────────────────────────────────────
   "NPCs buying cards puts Cinder back into that entire supply chain. This will
    connect to the foundation reserve."

   🔴 THIS REPORTS. IT DOES NOT MINT, AND IT MUST NOT.
   It tells the host how much Ouroboros product this city actually printed and
   sold — real units, out of a real chain that consumed real paper, ink and
   holographic foil. What the host chooses to do with that figure (a Foundation
   Reserve contribution, a leaderboard, a season metric) is the host's decision
   and belongs on the host's side of the bridge, where `FoundationReserve` and
   `Profile` actually live. Paying out from in here would be a second, unaudited
   faucet, which is the one thing this whole design exists to prevent. */
function cardOutput() {
  const ids = ['printedCards', 'boosterPacks', 'starterDecks', 'collectorPacks',
               'cardBoxes', 'tournamentProducts'];
  const out = { units: {}, totalUnits: 0, value: 0, exported: 0 };
  const st = Sim.state();
  const exported = (Trade.state().lastExported) || {};
  for (const id of ids) {
    const made = (st.observed[id] || {}).supply || 0;
    if (made <= 0 && !exported[id]) continue;
    out.units[id] = made;
    out.totalUnits += made;
    out.value += made * Prices.priceOf(id);
    out.exported += exported[id] || 0;
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   🌐 REAL CITY-TO-CITY TRADE — publish, discover, settle.
   ----------------------------------------------------------------------------
   🔴 NOT ONE SUPABASE CALL LIVES IN /src/economy, AND NONE MAY BE ADDED.
   `Cloud` and `Profile` are top-level `const` in index.html — invisible to an
   ES module (the globals trap, at the top of this file). The three network
   operations therefore live over there, next to the client that can actually
   make them, and reach this module through `MythicCityBridge.cityTrade`:

       publish(payload) -> bool      upsert city_profiles + city_trade_offers
       discover()       -> rows[]    other players' city_profiles
       fill(offerId, n) -> row       the city_trade_fill(offer_id, units) RPC

   This is the seam /src/trading/index.js already documents for the player
   market ("The Supabase calls stay in index.html next to ResMarket, because
   that is where Cloud, Profile and the realtime channel live"), and the shape
   is identical: primitives across the bridge, decisions on the side that owns
   the data.

   🔴 AND IT MUST DEGRADE TO NOTHING AT ALL. sql/038 is NOT APPLIED. There is no
      city_profiles table today, the client cannot know that, and it must not
      care: every step below is independently guarded, and any failure — no
      bridge, no network, no tables, an RLS refusal, a hostile row, a timeout —
      ends with `Trade.ensureSimulated()` and a city that keeps trading against
      the simulated neighbours it has always had. The migration upgrades the
      partners; it does not enable the feature. */

/* What this city publishes about itself. All primitives, freshly built — never
   a reference into Trade's own state (the past live bug on the card seam was a
   host object stored BY REFERENCE that leaked NaN into a panel). */
function tradePublishPayload() {
  const st = Sim.state();
  const tr = Trade.state();
  const sells = {}, buys = {};
  for (const o of tr.offers) if (o && o.res) sells[o.res] = o.units;
  /* The gaps this city structurally CANNOT make. A want gives the real
     quantity; a gap with no want yet still advertises the smallest quantity
     worth trading, so a neighbour can see the standing interest before this
     city has run short — which is the whole mechanism behind exportInterest(). */
  const wantUnits = {};
  for (const w of tr.wants) if (w && w.res) wantUnits[w.res] = w.units;
  for (const g of Bottleneck.structuralGaps()) {
    if (!g || !g.res) continue;
    buys[g.res] = wantUnits[g.res] || ECON.trade.minOffer;
  }
  const rows = [];
  for (const o of tr.offers) {
    rows.push({ side: 'sell', res: o.res, units: o.units, unitPrice: o.price, urgent: false });
  }
  for (const w of tr.wants) {
    if (rows.length >= ECON.trade.maxOpenOffers * 2) break;
    rows.push({ side: 'buy', res: w.res, units: w.units, unitPrice: w.maxPrice, urgent: !!w.urgent });
  }
  return {
    nodeId: st.nodeId != null ? String(st.nodeId) : null,
    specs: tr.active.slice(),
    sells, buys, offers: rows,
    day: st.day | 0,
    population: Math.round(HH.population()),
  };
}

/* One economic day's network round trip. Async, and the host must NOT await it
   inside a tick — nothing here may touch the treasury or the inventory, and
   nothing does: a confirmed fill is queued in trade.js and booked by match()
   inside the next audited day. See the settlement block in trade.js. */
async function tradeSync() {
  const out = { published: false, discovered: 0, real: 0, requested: 0,
                filled: 0, credited: 0, degraded: false, errors: [] };
  if (!mounted) { out.degraded = true; out.errors.push('not-mounted'); return out; }
  const nodeId = Sim.state().nodeId;
  const net = (() => { try { const b = B(); return (b && b.cityTrade) || null; } catch (e) { return null; } })();
  if (!net) {
    /* The overwhelmingly common case: standalone, offline, signed out, or an
       older host with no trade seam. Not an error and not logged as one. */
    out.degraded = true;
    Trade.ensureSimulated(nodeId);
    return out;
  }

  // ── 1. PUBLISH. A failure here costs this city visibility, nothing else.
  try {
    if (typeof net.publish === 'function') out.published = !!(await net.publish(tradePublishPayload()));
  } catch (e) { out.errors.push('publish'); }

  // ── 2. DISCOVER.
  let rows = null;
  try {
    if (typeof net.discover === 'function') rows = await net.discover();
  } catch (e) { out.errors.push('discover'); rows = null; }
  if (Array.isArray(rows) && rows.length) {
    /* THE ONLY CALL THE NETWORK PATH NEEDS. Matching, freight and pricing work
       against a real partner exactly as they do against a simulated one. */
    out.discovered = Trade.setPartners(rows);
  } else {
    /* No rows is the offline answer AND the "nobody else has published yet"
       answer, and they are indistinguishable from here. Both keep the partners
       already on the books rather than emptying a market on a transient read —
       a non-empty discovery replaces the real ones, this does not. */
    out.degraded = true;
  }
  Trade.ensureSimulated(nodeId);
  const partners = Trade.state().partners;
  out.real = partners.filter(p => !p.simulated).length;

  // ── 3. SETTLE. One RPC per planned line, and each one is caught alone.
  if (out.real && typeof net.fill === 'function') {
    const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
    out.requested = plan.length;
    for (const req of plan) {
      let row = null;
      try {
        row = await net.fill(req.offerId, req.units);
      } catch (e) {
        /* A throw or a timeout credits NOTHING, by not calling recordFill at
           all. That is the same outcome as a rejected row, reached without a
           second code path that could disagree with the first. */
        out.errors.push('fill');
        continue;
      }
      const r = Trade.recordFill(req, row);
      out.filled += r.filled; out.credited += r.credited;
    }
  }
  return out;
}

/* ── PERSISTENCE ────────────────────────────────────────────────────────────
   The host stores this blob inside its own city save. Absent-tolerant on load,
   like everything else in this codebase that loads. */
/* ⚠ `null` HERE IS NOT "NO ECONOMY", IT IS "NO ANSWER", AND THE HOST MUST NOT
     WRITE IT OVER A LIVED ONE. node-city used to do exactly that —
     `economy: window.MythicEconomy ? …serialize() : null` — so one failed import
     of this module, or one deferred mount, erased the player's whole city
     economy on the next save. The host now keeps the last blob it knows is real
     and only overwrites it when a MOUNTED module answers with one; see
     `_lastEconomyBlob` in node-city/index.html. This side stays honest and
     returns null, because inventing a blob for an unmounted simulation would be
     the same lie one layer down. */
function serialize() { return mounted ? Sim.serialize() : null; }
function load(raw) { const ok = Sim.load(raw); mounted = true; deferred = false; deferCtx = null; return ok; }

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC SURFACE
   ════════════════════════════════════════════════════════════════════════════ */
const api = {
  // lifecycle
  mount, tick, serialize, load, resolve,
  ready: () => mounted,
  /* ⏳ "Mounted, but the founding decision has not been made." Distinct from
     `!ready()`, which is also true when the module never loaded at all — the
     host renders a different, and much more reassuring, panel for each. */
  deferred: () => deferred,

  // the city ⇄ economy seam
  syncBuildings, canBuild, pickAvailable, cardOutput,
  setPopulation: (n) => HH.setPopulation(n),

  /* ── 👥 THE DEMOGRAPHICS SEAM ──────────────────────────────────────────────
     /src/demographics knows WHO the residents are; this module knows what its
     firms are asking for and what they pay. Three functions join them and every
     one of them is OPTIONAL on both sides:

       setLabourSupply(fn)   fn() -> { bands: { unskilled, skilled, technical,
                             advanced } } — how many residents are QUALIFIED for
                             each band. Unregistered, hiring is education-blind
                             exactly as it was before (households.js `hire`).
       setArrivalTierMix(fn) fn() -> { low, mid, high } weights for where NEW
                             residents land in the wealth tiers. Headcount only:
                             no savings move, so `totalCinder()` is invariant
                             across it and the audit is untouched.
       labourMarket()        the read back — what the city's firms posted and
                             what they filled, so the arrival pipeline can ask
                             "is there work here for someone like me".

     🔴 NOTHING HERE MOVES CINDER IN EITHER DIRECTION. That is not a promise
     about care, it is the shape of the interface: three functions that carry
     headcounts and weights, and no balance. ECONOMY.md documents four money
     leaks found during development and every one of them looked correct in
     review — the way a new seam avoids being the fifth is by having nothing to
     leak. */
  setLabourSupply: (fn) => HH.setLabourSupply(fn),
  setArrivalTierMix: (fn) => HH.setArrivalTierMix(fn),
  labourMarket: () => ({
    /* Fresh copies, never a reference into HH's own state — the live bug this
       codebase already paid for on the card seam was a host object stored BY
       REFERENCE that leaked NaN into a panel. */
    vacancies: { ...HH.state().vacancies },
    employed: { ...HH.state().employed },
    qualified: HH.labourSupply(),
  }),

  /* 🌐 THE TRADE NETWORK SEAM. `tradeSync()` is the whole of it for the host —
     one call per economic day. The rest is exposed so a driver can exercise
     each step alone, because the live path cannot be tested at all until
     sql/038 is applied and a second player exists.
     ⚠ `settle()` is `Trade.recordFill` itself, not a copy. A seam that
       re-implemented the credit rule would be testing itself, and the rule it
       enforces (credit `filled`, never the request) is the one that stops a
       seller shipping the same 40 units twice. */
  /* ── 🔌 THE UTILITY LINK SEAM (/src/power) ────────────────────────────────
     /src/power measures the electricity crossing the outside connection and
     prices it against node-city's own per-minute Cinder scale; THIS module
     settles it, inside runDay's audit window, through the two channels that are
     already audited — the treasury for the import leg, the one capped export
     faucet for the export leg. See sim.js's header above `settleUtility` for
     the full argument, including why the settlement cannot happen where the
     energy is measured.

     🔴 `utilityTrade()` MOVES NOTHING. It accumulates a bill. The whole reason
        the seam is shaped this way is that a module ticking at the host's
        cadence cannot move money without moving it between two audit windows,
        which is the structural blind spot ECONOMY.md's founding-mint entry
        lives in. `utilityReport()` is the read back — what actually CLEARED,
        never what was asked for. */
  utilityTrade: (t) => (mounted ? Sim.noteUtilityTrade(t) : false),
  utilityReport: () => (mounted ? Sim.utilityReport()
                                : { arrears: 0, pendingImport: 0, pendingExport: 0,
                                    pendingImportUnitMin: 0, pendingExportUnitMin: 0,
                                    last: { day: -1, billed: 0, paid: 0, arrears: 0, earned: 0,
                                            importUnitMin: 0, exportUnitMin: 0 } }),

  tradeSync,
  tradePayload: tradePublishPayload,
  tradePartners: (rows) => Trade.setPartners(rows),
  tradePlan: (cash) => Trade.planFills(cash != null ? cash : Sim.state().treasury, Sim.state().day),
  settle: (req, row) => Trade.recordFill(req, row),
  tradePending: () => Trade.pendingSettlements(),
  tradeStats: () => Trade.settleStats(),

  // reads for the UI
  snapshot: () => (mounted ? Sim.snapshot() : null),
  log: () => Sim.log(),
  firms: () => Firms.alive(),
  firm: (id) => Firms.byId(id),
  /* ⚰ THE BUSINESSES THAT ARE GONE. `firms()` is `Firms.alive()`, which filters
     the BANKRUPT rung out — and `Firms.reap()` deletes the record inside
     `runDay`, before any host tick can look at it. So without this there is no
     way at all, from outside this package, to tell "that shop went bankrupt"
     from "that shop was replaced": /src/tenants measured exactly that
     ambiguity and could only file every closure as "wound up, last seen
     HEALTHY". Bounded, read-only, and it moves nothing. */
  closures: (n) => (mounted ? Sim.closures(n) : []),

  /* 🏷 GROUND RENT, for a panel and for /src/tenants' overlay. `active` is the
     honest answer to "is /src/landvalue in this build" — see landValueActive().
     `today` is what was actually COLLECTED, never what was billed; the two
     differ by exactly the shortfall of the firms that could not pay, which is
     the number that says the mechanic is biting. */
  groundRent: () => (mounted
    ? { active: Sim.landValueActive(), today: Sim.state().flow.groundRent || 0 }
    : { active: false, today: 0 }),
  /* The distress ladder itself — its order, its labels and its colours. Read by
     any surface that draws a rung, so the map, the economy panel and the tenant
     ledger cannot show one business in three different colours. */
  RUNGS: Firms.RUNGS, RUNG_META: Firms.RUNG_META,
  /* 🏛 TAX POLICY — the four rates a mayor may set. See tuning.js for why the
     payout share, the daily ceiling and the faucet are NOT among them: a tax
     moves Cinder between pockets inside the city, those three govern what
     leaves it for a real wallet. setTaxPolicy CLAMPS and returns what it
     actually stored, so a panel can never show a rate the simulation is not
     using. */
  taxPolicy: () => Tuning.getTaxPolicy(),
  taxBounds: () => Tuning.taxPolicyBounds(),
  setTaxPolicy: (p) => Tuning.setTaxPolicy(p),
  taxRate: (k) => Tuning.taxRate(k),
  inventory: () => Sim.inventory(),
  /* 🚚 CITY TRADE. The only sanctioned way for goods to leave this city to
     another player's, and the read that goes with it. `inventory()` above hands
     back the LIVE map, which is fine for a panel and was never safe for a
     spender — see takeForExport's header for why subtracting is sound while
     the caller-drains-S.INV shape was not. Returns what it ACTUALLY took. */
  exportableStock: (id) => (mounted ? Sim.exportableStock(id) : 0),
  takeForExport: (id, units) => (mounted ? Sim.takeForExport(id, units) : 0),
  /* ↩ Refund-only. Undoes a takeForExport in the SAME call stack when a later
     leg of the shipment fails — never a general "add stock" verb, for the
     reason its header in sim.js gives. */
  returnFromExport: (id, units) => (mounted ? Sim.returnFromExport(id, units) : 0),
  price: (id) => Prices.priceOf(id),
  movers: (n) => Prices.movers(n),
  survey: () => ({
    nodeId: Sim.state().nodeId,
    have: Endow.have(Sim.state().nodeId),
    lack: Endow.lack(Sim.state().nodeId),
    gaps: Endow.strategicGaps(Sim.state().nodeId),
    strengths: Endow.strengths(Sim.state().nodeId),
    byIndustry: Endow.byIndustry(Sim.state().nodeId),
    grade: (id) => Endow.gradeOf(Sim.state().nodeId, id),
  }),

  // diagnosis
  diagnose: (firmId) => Bottleneck.diagnose(Firms.byId(firmId)),
  bottlenecks: (n) => Bottleneck.cityReport(n),
  primaryBottleneck: () => Bottleneck.primary(),
  trace: (resId) => Bottleneck.trace(resId),
  structuralGaps: () => Bottleneck.structuralGaps(),

  // firm actions the UI can offer
  levelCheck: (firmId) => Firms.levelCheck(Firms.byId(firmId)),
  borrow: (firmId, amount) => Bank.borrow(Firms.byId(firmId), amount, Sim.state().day),

  // rendering (markup only — the host owns the DOM)
  css: Render.ECONOMY_CSS,
  render: Render.renderPanel,
  renderFirm: Render.renderFirm,
  renderSurvey: Render.renderSurvey,
  renderChain: Render.renderChain,

  /* 🏗 CONSTRUCTION TIMERS — how long a building takes to go up.
     The host computes a PROFILE from `BUILDINGS` (which only it can see, and
     which no module can reach — the globals trap above) and hands it here. The
     curve and every number in it live in ECON.construction and NOWHERE else,
     so index.html carries not one literal from this feature.
     ⚠ THE ABSENCE OF THIS FUNCTION IS A DEFINED STATE, NOT A BUG. The host
       tests `typeof E.buildSeconds === 'function'` and, finding nothing,
       writes no timer and places instantly — and completes every job already
       on disk rather than parking it behind a module that never arrived. */
  buildSeconds: (profile) => Construction.seconds(profile),

  // the tuning table and the catalogues, for tools and tests
  ECON, econ,
  recipes: Recipes,
  endowment: Endow,
  specializations: Trade.SPECIALIZATIONS,
  basket: HH.BASKET,
  industries: Recipes.INDUSTRIES,

  // audit surface — deliberately public so a tester can prove the invariant
  audit: () => Sim.state().lastAudit,
  totalCinder: () => Sim.totalCinder(),
};

/* 🔌 THE BRIDGE. module → window is the direction that works; window → a
   top-level `const` in index.html is the direction that does not. Same pattern
   /src/resources/chain.js and /src/nodes/tiers.js already use. */
try {
  if (typeof window !== 'undefined') {
    window.MythicEconomy = api;
    if (!B()) warnOnce('window.MythicCityBridge is not mounted yet — the economy is registered but inert until mount() is called.');
  }
} catch (e) {}

export default api;
