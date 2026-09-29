I've verified the load-bearing claims myself. Here is the synthesis.

---

# 1. RECOMMENDATION: **NO-SHIP**

Do not deploy this branch in this run, and do not bump the deploy knobs.

Two independent reasons, either sufficient. **First, nothing here has actually been tested in the form it would ship.** The brief's premise is false — I confirmed `git status --porcelain -uno` reports ` M public/index.html` and ` M tools/economy-tests/run.mjs`, 587 uncommitted insertions. The green gate I ran is the *working tree's* gate: uncommitted test code exercising uncommitted product code. HEAD contains neither the loot fix (`git show HEAD:public/index.html | grep -c 'const LOOT_RES_IDS'` → 0) nor the round that detects its absence (`ROUND 0q` → 0). A clean checkout of 8587778 would report a green gate while shipping the regression. **Second, this session's headline feature contains a live Cinder mint on the most ordinary path a player can take** — closing the tab with a building under construction — and it is not a subtle one: the file's own comment at `public/node-city/index.html:18706-18710` describes this exact scenario verbatim as "a Cinder mint, and it is the single most dangerous thing this feature could have done." The ordering slip that causes it is two statements in `boot()`. Combined with a save format that mints real currency and a population function that destroys it, three separate Rule 1 violations are open, and the gate is structurally incapable of seeing any of them because all three move money outside `runDay`'s audit window — which is the exact bug class this session was built around.

---

# 2. CONFIRMED DEFECTS, ranked by real player impact

### 🔴 1. Boot completes offline builds at the wall clock *before* the virtual-clock catch-up — a Cinder mint on every absence
**Verified by me, statically and unambiguously.** `boot()` calls `bldNormalize()` at `public/node-city/index.html:27367`; `bldNormalize` ends with `bldSweep(Date.now())` at `:18802`. `offlineCatchUp()` is awaited ~118 lines later at `:27485`. So every job with `s + d*1000 <= Date.now()` is completed *before* the absence is simulated, and the building then produces for the **entire** absence rather than from the moment it finished. `offlineCatchUp` monkey-patches `addRes/addCinders/spendRes` for the whole slice loop, so those are real ledger writes.

The in-loop virtual sweep at `:23285` is dead code on the cold-boot path — `_bldRebuildDue()` builds an empty list because the queue was already cleared. The reporter's measurement (12 clubs, 6h absence: 103 → 1101 cinder, delta 998 against a predicted 1080) is consistent with the mechanism.

**Proof it is a slip, not intent:** the resume path (`visibilitychange`, `:23429`) calls `offlineCatchUp(away)` with no pre-sweep and is correct. So is the post-catch-up backstop sweep at `:27505`, which is well-commented and genuinely needed. Only `boot()` is wrong.

**Bound:** up to `OFFLINE_CAP_H = 36h` of unearned production per in-flight job, every absence. Worse, `bldNormalize`'s sweep runs with `_bldOffline === false`, so it fires the full trailer including `ecoSync()` — firms are founded and draw charter capital *before* the absence is simulated.

**Fix:** remove the `bldSweep(Date.now())` tail from `bldNormalize()` (`:18802`) and let the existing, correctly-placed sweep at `:27505` do the work after the catch-up. Small change; the hazard is that `bldNormalize` is deliberately outside the economy `try` block for the degrade path, so verify the degrade path (`bldFinishAll`) still completes orders when the module 404s. Needs a gate round that asserts no ledger write happens between load and the end of catch-up.

---

### 🔴 2. `HH.setPopulation()` silently destroys household savings, structurally outside every audit window
**Reproduced exactly.** My own probe:
```
setPopulation: savings 2168.38 -> 1238.95   DESTROYED 929.43
```
`public/src/economy/households.js:169` — `for (const t of TIERS) if (S.pop[t] === 0) { S.savings[t] = 0; }`. A tier that rounds to zero population has its savings zeroed.

The call order is the whole bug, and I confirmed it at `public/src/economy/index.js:111-112`: `HH.setPopulation(h.population)` runs, **then** `Sim.advance(...)`. `sim.js:1080` takes `before = totalCinder()` *inside* `runDay`. So the destruction is complete before the audit window opens, and `delta` and `expected` both miss it. Identical blind spot to the charter note's own description.

The reporter measured 178 destructive calls totalling 37,627 Cinder across gauntlet2's own round-1 loop, with `lastAudit.ok` never going red. That is consistent with gauntlet2's structure (see defect 8) — it calls `setPopulation` 4,800 times and can only ask the audit whether it noticed.

Live path confirmed: `ecoHost()` passes `population: cityPop()`, which moves on every migration and every housing build or demolish.

**Fix:** either redistribute an emptied tier's savings into the surviving tiers (conserving), or move `setPopulation` inside the audit window so the transfer is accounted. The comment at `:166-168` claiming the zeroing *prevents* breaking the audit has it exactly backwards — the destruction is what's placed where the audit cannot look.

---

### 🔴 3. Cancelling an operation's construction leaves its licence sited → the next load resurrects it **finished**
**Confirmed by code reading.** `bldCancel()` (`:18351`) does `delete game.tiles[kk]` for `k === 0` and never calls `opsUnsite` — I grepped: `opsUnsite` has exactly one call site, `:24612`, inside `opsReconcile`. The boot branch at `:24596` reads:
```js
if (boot && !t) { ... const nt = { type: opsKeyOf(o.type), lvl: 1, rot: (o.site.rot|0)&3, bld: null };
```
`bld: null` means **finished**. So place → cancel (full refund) → reload → free, instant, crew-slot-free operation. Applied to `op_construction` this is a bootstrap: a free Construction Co. lifts the 2400s municipal ceiling and raises crew slots and build speed, unlocking the entire gated feature. No save editing, no console — three ordinary UI actions.

**Fix:** `bldCancel()` must `await opsUnsite(o.id)` when the cancelled tile is an op site. Note both reconcile branches currently favour the exploiter (the 4s beat unsites, returning the licence to the player).

---

### 🟠 4. The city save mints Cinder — 4 of the 5 `totalCinder()` terms are unclamped on load
**Reproduced with my own probe.** From an honest bootstrap at 300,000:
```
doctor treasury                 -> totalCinder 1,000,299,999.99   delta +999,999,999.99
doctor bank.reserve             -> totalCinder 1,000,299,999.99   delta +999,999,999.99
doctor households.savings.low   -> totalCinder 1,000,299,999.99   delta +999,999,999.99
doctor firms.firms.0.cash       -> totalCinder 1,000,298,487.99   delta +999,998,487.99
doctor charter (the clamped one)-> totalCinder     384,801.85     delta +84,801.85
```
`sim.js:1512` asserts "🔴 THE SAVE FILE IS NOT ALLOWED TO MINT EITHER, and this is the one field where it could" — referring to `charter`. That is false for the other four. `S.treasury = Math.max(0, Number(raw.treasury) || 0)` has no ceiling; `HH.load`, `Firms.load` and `Bank.load` coerce for NaN safety but never bound magnitude. Every one passes the audit forever, because `load()` runs outside `runDay`.

Note even the *clamped* field leaks: `fundMax = max(seed 300000, fundTarget)` is well above what the fund honestly holds mid-life, so `charter` still gained 84,801.

**Related, same class:** `Sim.reset()` (`sim.js:124`) zeroes `charterIssued` and `booted`, and `node-city:23457` does `_pendingEconomy = (s.economy && typeof s.economy === 'object') ? s.economy : null` — I confirmed both. Deleting the `economy` key from the save re-arms a fresh 300,000 tranche and the full 700,000 lifetime allowance.

**Reachability caveat, stated honestly:** the city is client-authoritative — `payCost` is client-side and a console user can already reach `addGems`. The genuinely new thing is that this is reachable from a *persisted file*, needs no console, and survives reloads. Treat as a "don't make it trivially copy-pasteable" fix, not as the sole line of defence.

**Fix:** clamp every `totalCinder()` term on load the way `charter` is, and add a whole-total sanity ceiling derived from day count. Make gauntlet1's corrupt-save round assert `totalCinder` did not move, not merely "no NaN, no throw" — it currently feeds a corrupt save and never checks the balance.

---

### 🟠 5. The audited payout is silently destroyed whenever `bridge.addCinders()` rejects
**Confirmed by code.** `economy/index.js:118` — `Promise.resolve(bridge.addCinders(owed)).catch(() => {})`, and `sim.js:1418-1424` `claimPayout()` does `S.payoutOwed -= whole; return whole;` **unconditionally, before the await**. The Cinder has left the sim's books; the treasury was debited and `flow.payout` recorded, so the audit is satisfied. The money exists in neither ledger.

Reachable in production: `MythicCityBridge.addCinders` in `'message'` mode is `await rpc('addCinders', {n})`, which rejects on timeout or a dead parent. No retry, no re-credit path. This one loses the *player's* money, not the house's.

**Fix:** only decrement `payoutOwed` after the bridge confirms, or restore it in the `.catch`.

---

### 🟠 6. `bldLoad()` passes `pc`/`pr` through unsanitised — an unbounded refund basis reaching real gems
**Confirmed at `:18584-18586`:**
```js
pc: Math.max(0, Math.round(+raw.pc || 0)),
pr: (raw.pr && typeof raw.pr === 'object') ? raw.pr : null
```
No upper clamp on `pc`; `pr` is an arbitrary object with unvalidated keys. Flows `bldOrderRefund` → `bldPayRefund` → `addCinders` → `addGems` → `Profile.gems` + `saveProgressCloud`. Contrast the pre-existing demolish refund, which derives from `costOf(type, lvl)` and is bounded by the price table — this feature introduced the first attacker-controlled magnitude into the save format. Unvalidated `pr` keys also mean a chain-resource id can reach `addRes` (Rule 2).

**Fix:** clamp `pc` to `costOf(type, lvl)` and whitelist `pr` keys against the camp ledger.

---

### 🟡 7. Damage taken while a building is **upgrading** is erased by any reload — a free repair
`loadState()` ~`:23604` does `if (t.bld) t.damaged = false;` — unconditional on kind. `damageTile()` (`:3776`) and `decayTick()` (`:21977`) both refuse only `bldSite(t)`, so they happily damage a *standing* `k=1` tile. The justifying comment asserts the `(bld && damaged)` pair is "unreachable by construction" — true for `k=0`, false for `k=1`, and an upgrade window is up to 24h wide. Waives `REPAIR_COST_FRAC 0.4 × costOf()`.
**Fix:** gate the line on `t.bld.k === 0`.

---

### 🟡 8. `opsFindLab()` is the one production read site with no `bldSite` gate
`~:24872`, consumed by `opsLabTick()` — an Anomaly Lab that is still a hole in the ground produces Anomaly X (sellable for Cinder) and consumes the player's reagents. `opsResearchAdj()` (`~:24881`) has the same omission for the adjacency bonus. The adversary swept all 33 other read sites and found them correctly gated; this is the single miss.
**Fix:** add the `bldSite` guard to both.

---

### 🟡 9. Backwards clock step restarts every in-flight build from zero
`bldLoad():18575` — `const s = Math.min(s0, now);`. A 24h job 22h complete reloads as 24h to go. The clamp exists to stop a future stamp parking a tile forever, but resolves toward **restart**, contradicting `bldLoad`'s own stated principle at `:18554` ("EVERY AMBIGUITY RESOLVES TOWARD COMPLETION"). A routine NTP correction is exactly this size. The forward direction is the exploit (finishes everything, then pays up to 36h of catch-up, and stepping back costs nothing because `awayMs < 0` returns null at `:23183`).
**Fix:** persist elapsed progress rather than a start stamp, or keep a monotonic high-water mark.

---

### 🟡 10. `bldCancel()` pays a real refund then only schedules an 800ms debounced save
`:18363` `await bldPayRefund(...)` then `:18366` `try { computeLinks(); manageAgents(); updateHUD(); saveSoon(); } catch (e) {}`. The money has moved; the order justifying it is still on disk. Contrast `bldSweep`, which uses `saveNow()` (`:18767`) with the comment "A completion is exactly the moment a crash hands out a free building." A refund moves *real currency* and gets the weaker treatment — and `saveSoon()` sits last inside a bare `catch {}` after three UI calls, so a throw in any of them skips the save entirely. Honestly scoped: `pagehide`/`visibilitychange` → `saveNow()` close this on a clean F5; the window needs a crash inside ~800ms (much wider in `'message'` bridge mode).
**Fix:** `saveNow()` before `bldPayRefund`, and move it out of the UI `try`.

---

### 🟡 11. `_bdParseSide` — both `RESOURCES` lookups are dead branches; unfillable broker deals
`public/index.html:209419-209421`. `RESOURCES` is an **array** (`const RESOURCES = [` at `:39272`), so `RESOURCES[id]` for a string id is always `undefined`. Both branches unreachable; the only surviving test is `getRes(id) > 0` — an id counts as a resource only if you *currently hold some*. Otherwise it falls through to `s.cards[id]`.

**I verified this is PRE-EXISTING** — present at merge-base `c8c80acb`. But the 14→70 promotion is what makes it bite: the 56 chain ids are exactly the ones a camp player holds 0 of, and they are now legal, visible ledger ids a player will reasonably type. `_bdCanPay` is called only on `give`, never on `want`, and `_bdSide` renders both legs identically — so the deal posts, looks normal, and nobody can ever accept it.
**Fix:** `RESOURCE_IDS.includes(id)` / a Set lookup instead of array indexing, and validate the `want` side.

---

### 🟢 Low / cosmetic (fix opportunistically)
- **Mesh↔tile desync** — a standing, working, mid-upgrade building renders as a foundation pad after any reload (`loadState:23623` + `rebuildSlot:22388` fire on any `t.bld`; the online upgrade path deliberately does not touch the mesh). Self-heals at `bldFinish`, but can show an empty lot for 24h.
- **`LOOT_RES_WEIGHTS.offPool` is a dead knob below 0.025** — confirmed: `Math.round(w * LOOT_WEIGHT_SCALE)` with scale 20 rounds anything under 0.025 to zero copies. The comment promises a tunable "trickle"; the first effective value jumps to 16.67%. Fix: raise `LOOT_WEIGHT_SCALE`.
- **`_lootResBag` cache key is a compile-time constant** — confirmed: keyed on `RESOURCE_IDS.length`, which is derived from a `const` literal nothing mutates. The guard is shaped like invalidation and performs none.
- **Admin "grant +250 of every resource"** delivers to ~9 of 70 ids (cap-clipped) and toasts full success. Admin-only.
- **Stale comment at `:39339`** still claims the stash floor is 10,010; the uncommitted fix makes it 2,002.
- **`settle-requested` missing from run.mjs's sabotage index**, which declares itself complete. Documentation only — I confirmed the sabotage itself works.

---

# 3. THE TEST DEFECTS — why none of the above was caught

These are not findings *about* the tests so much as the explanation for everything above.

### 🔴 A. `gauntlet2`'s headline conservation assertion cannot report a leak
**Verified by reading `tools/economy-tests/gauntlet2.mjs:16-28`:**
```js
if(a&&!a.ok){const e=Math.abs(a.err);if(e>worstErr){worstErr=e;...}}
chk('conservation under 40 randomized cities x 120 days', worstErr===0, ...)
```
`worstErr` is only ever *written* inside `if (!a.ok)`. The test does not compute conservation — it asks the audited system whether it approved of itself. It therefore cannot see anything that moves money outside `runDay`, which is the entire bug class of defects 1, 2 and 4.

### 🔴 B. The audit's absolute tolerance floor is ~10 orders of magnitude above real noise
**Reproduced directly:**
```
city totalCinder 300000.00  => tol = max(1, 0.3000) = 1
  mint 0.50 /day -> err 0.5000  tol 1  AUDIT ok: true
  mint 0.99 /day -> err 0.9900  tol 1  AUDIT ok: true
  mint 1.00 /day -> err 1.0000  tol 1  AUDIT ok: true
  mint 1.50 /day -> err 1.5000  tol 1  AUDIT ok: false
```
`sim.js:1380` — `const tol = Math.max(1, Math.abs(after) * 1e-6)`. Observed float noise is ~1e-11. A steady 0.99🔥/day/city mint (361🔥/year/city) is invisible to Rule 1, to the payout tripwire, and to the headline gauntlet round. The comment justifies the *relative* 1e-6 term but never the absolute floor of 1 — which is the binding term for every city under 1,000,000🔥.

### 🟠 C. Round 0 is blind to four `ECON.construction` knobs it claims to guard
**I reproduced this myself.** Mutating `ECON.construction.costResWeight` from 2 to 3 before importing the unmodified `run.mjs`:
```
✅ ECONOMY GAUNTLET: all rounds passed
EXIT=0
```
Round 0's header states "change any number in ECON.construction and this round reprints the shelf and fails on the ones that moved." False for `costResWeight`, `resTier`, `tierMul` and `defaultTier` — those are consumed only by node-city's `bldProfile()`, which the gate never runs. I confirmed by grep: `resTier` and `tierMul` appear **zero times** in the gate; `defaultTier` and `costResWeight` appear only inside prose comments.

Round 0 pins 6 of 46 buildings, and the 5 closest to the 2400s municipal ceiling are all unpinned. The reporter measured `barracks` 2016s→2405s under that retune — crossing the ceiling — while the gate stays green. `barracks` is named by round 0's own header as one of "the tight ones."

### 🟠 D. Round 0q measures a 26-character statement, not `_campGrantLoot`'s output
For `_campGrantLoot` it scrapes exactly `const rid = _lootResPick()` out of a 4,239-char function, then rebuilds a synthetic `__campPick` and draws from *that*. The reporter demonstrated a genuine second ledger-drawn drop injected into the same function passes all three checks green. `_campLootContainer` has the same hole; `_smugglerDeal` is scraped whole via `fnText` and is genuinely covered. I confirmed round 0q's own sabotages *do* redden it, so the round is not vacuous — its weakness is scope.

### 🟡 E. Round 0q's leg-count assertion has ~22,000 legs of margin against a ~75-leg effect
`legs > 100000` on a 122,010-leg binomial aggregate. `index.html` claims the leg count *proves* the pick consumes exactly one RNG draw; the reporter showed +1, +2 and +5 extra draws all keep the round green while every deal's contents change. The certified property ("bit-identical apart from ids") is untested.

---

# 4. FINDINGS I REJECTED OR RE-SCOPED — I checked each

**REJECTED: "The loot fix quintupled the container double-payout rate to 7.16% — a 5× regression."**
The underlying bug is real — `pick(res1 ? res1.name : null)` at `:170035` passes a *name* to a parameter filtered against `r.id`, so the exclusion never excludes. But the **regression framing is wrong**, and I checked the actual history:

| | `resPool` | distinct ids | collision rate |
|---|---|---|---|
| merge-base `c8c80acb` (what players have) | `RESOURCES` | **14** | **7.14%** |
| HEAD `8587778` (unshipped intermediate) | `RESOURCES` | 70 | 1.43% |
| working tree (uncommitted fix) | `_lootResRows()` | **14** | **7.14%** |

The uncommitted fix *restores* the rate that has been shipping to players all along. Measuring against HEAD — an unpushed intermediate commit no player has ever seen — manufactures a regression that does not exist. Fix the name/id bug on its own merits; do not treat it as a blocker introduced by this work.

**RE-SCOPED: "HEAD ships a 5× loot-pool dilution" (reported as critical/high by three separate lenses).**
Factually correct and I confirmed every part of it — HEAD lacks `LOOT_RES_IDS`, `_resStashFloor()` returns 10,010 at HEAD vs 2,002 in the tree, and round 0q does not exist at HEAD. But three agents independently ranked this as a top defect, which overweights it: HEAD is an intermediate commit on an unpushed local branch. No player is exposed. The *real* finding underneath is the process one — the tree is dirty and the gate result is therefore not attributable to any commit. That belongs in the ship decision (it is), not in the defect list as a player-facing bug.

**REJECTED as a blocker: the charter bootstrap tranche as "a per-city faucet into real currency."**
The mechanics check out — `reset()` does zero `charterIssued` (`sim.js:124`), and `node-city:23457`'s `_pendingEconomy` guard does mean a missing `economy` key re-arms a fresh 300,000. But the reporter's own framing concedes the design deliberately calls the tranche an initial condition, and `tuning.js:197` documents it as such. A city paying its owner tax on circulating seed capital is a *tuning* question (is 11–15k Cinder per 200 wall-clock hours right?), not a correctness one. The genuinely defective part — that deleting a save key re-arms it — is the same save-editing vector as defect 4 and should be fixed there, not treated as a separate faucet.

**ACCEPTED AS GENUINE NEGATIVES (do not re-run these):**
- **`syncBuildings()` founding/estate conservation holds exactly.** 600 days of build-12/bulldoze-12 churn moved `totalCinder` by 0.000000 across every sync, over 1.9M of estate receipts. This session's headline fix is sound.
- **Bulldozing for profit does not work** — churn yields −49.9% vs never demolishing. The two-hop route through the treasury loses to lost productive capacity.
- **Hostile trade settlement rows are handled.** Nine adversarial shapes (`1e12`, negative price, `Infinity`, string, `-40`, `{}`, `null`) all credited `min(filled, asked)` or 0, ΔtotalCinder 0.000000.
- **Crew-slot and cap:1 races are closed** by the synchronous `bldReserveCrew()` / `_pendingOrders` reservation in the outermost `tryPlace` wrapper.
- **Place→cancel arithmetic is exact** (net zero, both directions, no rounding drift), and **demolish-while-upgrading cannot profit** — `0.5·Cₙ + Cₙ₊₁ < ` sum paid, for every type.
- **Firms survive upgrades** (`ecoBuildings` gates on `bldSite`, not `bldBusy`).
- **All 20 sabotage switches genuinely redden the gate.** I confirmed the fail-provability infrastructure is real and unusually well built — no tripwire is a comment.
- **Round 0's six pinned literals are accurate** against a verbatim reconstruction of `bldProfile()`. The defect is coverage, not correctness.
- **The corrupted-build-record surface is solid** — NaN, Infinity, negative/zero `d`, multi-level jumps all clamp or drop toward completion.

---

# 5. WHAT NOBODY EXAMINED — still unknown

1. **Cross-player trade settlement.** Every lens explicitly declined this: whether the server-side offer row stays decremented when the buyer's client dies between the RPC returning and `match()` draining. It needs SQL nobody was permitted to apply. Real city-to-city trade is one of this session's headline features and its multiplayer failure mode is entirely untested.
2. **The RLS on whatever tables city trade uses.** CLAUDE.md says RLS is the entire security boundary and every policy needs line-by-line review. No lens reviewed a single policy — all five worked client-side. If this feature shipped SQL, it has not been security-reviewed.
3. **`guild_chat` / the Guild Wire** still inserts directly per CLAUDE.md, unlike world chat. Untouched by this session but unexamined and adjacent.
4. **Concurrency between the city and the parent app.** Three lenses hit each other on the same localStorage origin and one noted `pagehide → saveNow()` silently overwriting doctored saves. Nobody tested two tabs of the *real* game writing `Profile.gems` through `cityAddCinders` simultaneously.
5. **`MythicCityBridge` in `'message'` mode generally.** Defect 5 surfaced one failure, but the 1800ms RPC timeout path was never exercised systematically — `spendRes` failing mid-`offlineCatchUp` is unexamined, and that loop does real ledger writes.
6. **`cityCardConsume` does not exist.** One lens found `MythicCityBridge.consumeCard` calls `P.cityCardConsume`, which is defined nowhere in `public/index.html` — so card-consuming builds burn nothing and the card reappears on reload. Pre-existing no-op, but it means `bldCancel` has **no card-return path**, so implementing `cityCardConsume` later silently turns "full refund" into a card burn. Worth a comment at minimum.
7. **The degrade path as a rush button.** `bldNormalize()` calls `bldFinishAll()` when `bldCfg()` returns null, completing every order including a 24h one, free. Never deliberately reproduced (nobody could fail the import from the page), but a real log line from a prior session on this machine shows it firing: `🏗 3 construction orders completed on load — the construction module did not load.` Any request-blocking extension or stale service-worker cache triggers it.
8. **Nobody ran the game.** All work was on the node-city page and the economy modules in Node. Battle, cards and the main app were correctly not touched — but `public/index.html` has 208 uncommitted lines in it, and no lens loaded the actual game to see whether the camp still works with 70 resources.

---

# 6. THE DEPLOY KNOBS

**Do not bump `public/version.txt`, `window.BUILD_VERSION`, or `sw.js` `CACHE_VERSION` in this run.**

Defect 1 alone justifies this: it is a Cinder mint that fires for ordinary players on an ordinary path, with no exploit required, in the feature this session exists to deliver. Shipping it caches a currency faucet into every client's service worker, and the fix then has to propagate through the same cache. Defects 2 and 4 are two further Rule 1 violations, and the gate that is supposed to guard Rule 1 has been shown — by my own reproduction — to be structurally incapable of seeing any of the three.

**Before any deploy is even discussable:**
1. **Commit the working tree, `public/index.html` first or in the same commit as `run.mjs`.** Committing `run.mjs` alone ships a red gate (round 0q hits its `gotAll` guard at `run.mjs:4126-4135` and prints "THE SOURCE COULD NOT BE READ", `bad++`). Committing `index.html` alone silently ships a 14→70 ledger change with no measurement. Nothing in the repo currently records that this ordering is required — it should.
2. **Fix defects 1, 2 and 3.** All three are small, localised changes.
3. **Fix `gauntlet2`'s conservation round to measure `totalCinder()` across the out-of-window calls it already makes** — it calls `setPopulation` 4,800 times — rather than reading `lastAudit.ok`. Without this, the same class of bug ships again next session.
4. **Re-run the gate on a clean tree and confirm the result is attributable to a commit.**

Both syntax checks are clean (`node _synckcheck.mjs` on both files: ALL CLEAN), and the gate is genuinely green at exit 0 — but green against a tree that does not correspond to any commit, using a conservation assertion that cannot fail. That combination is precisely the failure mode the brief warns about, and it is live right now.