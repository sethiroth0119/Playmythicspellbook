# 🐛 BUG-TRACKER HANDOFF — 2026-09-09

Live at **v121v90**. Tracker: **30 fixed / 13 open**. Ten builds shipped this
session (v121v81 → v121v90), every one full-gated and edge-verified.

Read this top to bottom before touching anything. The **Traps** section at the
end will cost you an hour each if you skip it.

---

## 0. THE STANDING JOB

> *"Keep track of the bug tracker, look at the photos that are uploaded by
> players and look at what they are saying and then fix them in the right way.
> After you are done the ones you deemed as fixed mark them as fixed."*

That is ongoing, not a one-off. Start a session by reading the tracker.

### Where the tracker is

The **Abraxas Codex** site (`D:\Abraxascodex`) runs on Supabase project
**`uvfhiqwvpixfobjnyqtf`**. The game (`D:\game-deploy`, Mythic Spellbook) is a
**different** project, `ktsiasyjusesawtrwrjc`.

🔴 **The tracker lives on the Codex site but every report in it is a MYTHIC
SPELLBOOK bug.** Reports are read from one repo and fixed in the other.

```sql
-- the open list
select id, data->>'severity' sev, data->>'reporter' who,
       left(data->>'title',80) title,
       jsonb_array_length(coalesce(data->'attachments','[]'::jsonb)) files
from public.bug_reports
where data->>'status' not in ('fixed','wont-fix','duplicate')
order by case data->>'severity' when 'critical' then 0 when 'high' then 1
                                when 'med' then 2 else 3 end, created_at;
```

`public.bug_reports` is one row per report: `id` (client text), `data` (jsonb —
the whole record, so the page's shape evolves without migrations), `created_by`,
`created_at`, `updated_at`. jsonb keys: `title description category severity
status reproSteps expected actual build platform reporter email msbEmail
msbUserId votes responses created updated`, plus optional `attachments`
`attachmentSlot` `reward` `_createdBy`.

Vocabulary (from `project/bugs.jsx`): severity `low|med|high|critical`; status
`open|triaged|in-progress|needs-info|fixed|wont-fix|duplicate`; category
`gameplay|ui|economy|other`.

⚠ `email` / `msbEmail` are PII. Do not print them.

### Marking fixed

```sql
update public.bug_reports set data = jsonb_set(data,'{status}','"fixed"')
where id in ('bug-xxxx') returning id, data->>'status', left(data->>'title',60);
```

Only mark what you **verified live at the edge**. The user has already been
burned once by a report marked fixed that wasn't ("This was said to be fixed but
isn't") — that is worse than leaving it open, because it stops being counted.

**Do not write `responses`.** Every existing response is authored by a named
person; posting under the user's name puts words in their mouth. Ask what name
to use if reply notes are wanted.

### 📷 THE ATTACHMENTS — STILL BLOCKED, AND THIS IS THE #1 UNBLOCK

Screenshots live in the **private** `bug-attachments` bucket (signed URLs only,
one folder per uploader uid). The file list is on `data->'attachments'` as
`{id,name,path,size,type,width,height,addedAt}`.

Signing needs the **user's own session**, so:
- The Supabase MCP cannot fetch them (no storage tool, and the bucket is private).
- The in-app Browser pane is a fresh browser with no session.
- **Claude in Chrome** would work — it uses the real Chrome with real sessions —
  but it would **not connect** all session (five retries). The user said "I am
  connected to chrome" and it still refused.

**Ask for either**: the Chrome side panel actually open and signed in to the same
account as this app (installed alone is not enough), **or** the images pasted
into chat. Three open reports are blocked on this and two are `high`.

---

## 1. WHAT SHIPPED THIS SESSION

| Build | What |
|---|---|
| v121v81 | Stash visibility — 265 SALVAGE_RES ids counted against the vault cap and could never be listed |
| v121v82 | Truck Yard: Bulk Feed + Livestock cargo classes, 3D models, yard made class-agnostic |
| v121v83 | 35 empty industrial buildings given recipes; ledger mirror derived from recipes + batched |
| v121v84 | steel↔metalAlloys deadlock + woodPanels broken → **15 firms unblocked**; 60× Cinder tooltip; 2 phantom venue types |
| v121v85 | **Businesses stop going bankrupt while profitable** |
| v121v86 | Athena Engine character cast (peers were blue capsules) |
| v121v87 | Camp defense cap; referral redeem direction; Trash Crusher label; Card Hunt repeats |
| v121v88 | Warehouse "Refined stock" card — the six city-stock goods had no view anywhere |
| v121v89 | Base Vault ceiling stopped moving; card purchases return you where you were |
| v121v90 | Corporation member cities filtered to nodes the member still owns |

New suites, all registered in `_checkall.mjs` (**86 suites** now):
`_rigyard_smoke.mjs` `_citychain_smoke.mjs` `_ecoreach_smoke.mjs`
`_firmcash_smoke.mjs` `_athenacast_smoke.mjs` `_openfour_smoke.mjs`
`_citystock_smoke.mjs` `_payreturn_smoke.mjs` `_corpcities_smoke.mjs`
Extended: `_vault_smoke.mjs` (§10, minPasses 20→27), `_citybiz_smoke.mjs`,
`_athena_smoke.mjs` (engine assertion split into three).

---

## 2. THE 13 OPEN REPORTS

### 🔴 Blocked on YOU — a decision or an image

| id | sev | What is needed |
|---|---|---|
| `bug-mtuadu79` | high | **Clinic remedies spiral.** 2 screenshots. Confirmed: the Clinic is the ONLY producer (`gen.remedies 0.45`) *and* the ONLY consumer (`svc.input remedies, rate 0.30`). Production is scaled by `tileOutputFactor` (city conditions); the `svc` draw is **not**. Below ~0.67 conditions the draw overtakes production and it spirals — exactly "it's eating its own lunch". **What the images settle:** whether that is the defect or the intended "a failing city runs down its stock". Do not guess on a `high` in a live economy. |
| `bug-mtuasm4d` | med | **Stadium not picking up Remedies/Goods/Rations.** 1 screenshot. First hypothesis was WRONG — `nodeStockView()` merges `res` then `stock` correctly, so it reads them fine. Need the image to see *which* panel: the tile inspect (which genuinely shows nothing — the stadium has no `gen`/`use` **by design**, see the comment at node-city ~5556: a `gen` there would make it an idle earner) or the event readiness panel. |
| `bug-mtp1ltjq` | high | **Employee wages.** Full analysis in §3 below. Needs a design decision. |
| `bug-mtttvge5` | med | **Beverages have no consumer.** Produced by Club, Gym, Cinema, Food Truck; consumed by nothing, so they pile in the vault. ⚠ There is a **recorded rejection** of the obvious fix at node-city ~4850: a `use:` input **halts** a building at zero, and "every restaurant in a city without them would have closed". The safe version is a *soft* draw (`svc.input`, which throttles instead of halting) — that is a venue-economics decision, not a bug fix. |
| `bug-mtrmzyhc` | med | **Hiring.** Full analysis in §4. Needs a tuning decision. |
| `bug-mtu9vzp3` | med | **Duplicate PRNs.** Almost certainly **working as designed** — `nodeEstablish()` caps at `NODE_MAX_PER_CORP = 6` **total, not per type**, and the only unique index on `economy_nodes` is `one_main_per_owner`. Six of any mix looks intended. He paid Cinder + materials for the second Supply PRN, so **do not delete it** without an explicit instruction. A second player also has a duplicate (2× Storage) and has not reported it. The real gap is that no UI states the rule. |

### 🟡 Diagnosed, needs work

| id | sev | Where it stands |
|---|---|---|
| `bug-mttcdw79` | high | **Population display.** Has 2 screenshots. The numbers are **several different true quantities with similar labels**: `popCap()` = beds + node-granted capacity + zoning delta; `popUsed()` = build slots (army.workers + army.soldiers + each building's `pop` cost), **not** residents; `cityPop()` = `game.pop.npc`, the actual residents, which does **not** consume popCap; `citCap()` = `min(400, cityPop())`. So "Free population 1089" beside "capacity 294" can both be correct. This is a labelling/reconciliation job — the screenshots say which panels he is comparing so you fix the right ones instead of all of them. |
| `bug-mtu13pzm` | med | **"Nobody is shopping."** Partly fixed in v121v84 (two of seven patron NEEDS pointed at buildings that do not exist — `cardshop`, `techstore` — now removed). **Not fully explained**: `_patronVenues()` pushes every tile and patronage never checks shop stock at all, so it is not refusing to shop. Suspect a **name collision**: the patron *need* id is `goods` and so is the CITY_STOCK *resource* — a "goods unmet" line reads as "your goods are not counted" when it means "nobody built a clothing store". 3 screenshots would finish it. |
| `bug-mttyizit` | med | **Living Economy 0%.** Mostly fixed in v121v84 (Structural Steel, Lumber, Metal Components). **`Workers` was never touched** — that is what is left. |
| `bug-mtrmi2e5` | med | **Workers bottleneck / housing.** Same cluster as population + hiring. |
| `bug-mtsq62mg` | med | **Out of Cash.** Root cause fixed in v121v85 (see §5). Left open deliberately — needs confirmation from the reporter that it is actually resolved in play, since he reported it as still broken once before. |
| `bug-mtr5xz8t` | high | **Managed cities not loading first time.** No repro. The user's own response on the report says "Likely a server/internet issue". Untouched. |
| `bug-mtr5bze0` | med | **Startup sequence should be automated.** A feature request, not a bug ("IMO this should all be handled in the background"). Note v121v89 fixed the *related* complaint — a card purchase used to dump you at the title screen — but the Bank → City Hall → Licences → PRNs walk is this separate item. |

---

## 3. THE WAGES QUESTION — recommendation already made, awaiting the call

Verified installed on the live game DB: `get_my_ledger`, `corp_staff_payroll`,
`corp_pay_member`, `corp_pay_member_from_treasury`.

**The game has three wage systems and only one is coherent:**

1. `/src/economy` firms → households — **coherent**. `households.js` states the
   invariant: *"a household can only spend Cinder it was actually paid. There is
   no 'consumer spending' term computed [from nothing]."*
2. **Corp operations (`op_salary`)** — a pure **sink**.
   `_opTreasuryRow(-salaryPay, 'op_salary', …)`. Destroyed. Nobody receives it.
3. **Patronage** — a pure **faucet**. `game.frac.cinder += P.credited` mints from
   nothing, capped at `DAY_CAP_TOP` 1,000,000/day at top tier.

NPC wages are destroyed over here; NPC shopping is invented over there; the two
are about the same NPCs and have **nothing to do with each other**. That is why
the report feels true even though nothing is technically broken.

**Recommended:** join #2 and #3 the way #1 already is. Wages paid into a city
Household Wage Pool; patronage spends from that pool **first** and only mints the
shortfall. Keep a 25–35% leak so wages stay a partial sink; keep the daily cap as
a ceiling. This makes the economy *tighter*, not looser, and gives a real reason
for factories and shops to share a city.

**Rejected:** paying NPC wages into player wallets (turns a 100k+/cycle sink into
a faucet and makes hiring NPCs a money printer). **Fallback:** relabel the line
"NPC payroll — leaves the economy" (honest, an hour, explains the hole rather
than filling it).

⚠ Complication: `op_salary` is in the **corp treasury on Supabase**; patronage is
in **node-city's local sim**. Different layers. Cheapest shape is a per-city pool
node-city owns, credited on op settle through the existing
`window.cityAddCinders` seam. A day of work, and the economy gauntlet will judge
it hard.

---

## 4. THE HIRING QUESTION — analysis done, needs a tuning call

Reported: 570 qualified citizens, **1,177 open positions**, 208 employed.

```
CIT.MAX     = 400                      named-citizen roster ceiling
citCap()    = min(400, cityPop())      570 residents → at most 400 workers
citTarget() = min(citCap, jobSlots)    → min(400, 1177) = 400
```

`citJobSlots()` sums `npcSeatsAt()` over every tile and businesses offer
**10–200 posts each**, so a developed city reaches 1,177 seats easily while the
roster that fills them is hard-capped at 400.

**1,177 open positions is a number that can never reach zero.** The comment on
`CIT.MAX` records it being raised 80 → 400 for exactly this reason; the same
thing has now happened one order of magnitude up.

1. **Make the number honest** (recommended, safe): Job Fair says "208 employed ·
   400 the city can name · 1,177 seats exist". No performance risk.
2. **Raise `CIT.MAX`**: every named citizen has a name, mood, job and tenure and
   is ticked every 2 s. **Measure before touching.**
3. **Decouple staffing from the roster**: `staffAt()` already blends city-wide
   hired workers with named residents, so seats could be filled by anonymous
   labour with named citizens as a bonus. Biggest change, probably right
   long-term.

Recommendation: **1 now, 3 later.**

---

## 5. THE FIX MOST WORTH UNDERSTANDING (v121v85)

`closeDay()` in `/src/economy/firms.js` had:

```js
if (f.cash <= 0) { f.badDays++; f.goodDays = 0; }
else if (profit > 0) { f.goodDays++; … }
```

`pay()` clamps to the balance rather than refusing, so a firm that spends what it
earns — wages, rent, inputs — **closes the day on zero**. That is a business at
the margin, the normal state of most of a young city. But `cash <= 0` alone
booked a bad day *and* reset `goodDays`, making the recovery branch unreachable
for exactly the firms that needed it. Throttle at 2 days, a quarter of the staff
sacked at 4, **BANKRUPT at 14** — and every consequence cut revenue, which cut
the next day's cash. The bank could not help either: capacity is
`revenueAvg × maxLoanToRevenueDays − debt`, so the earlier rungs shrink the very
number `autoBorrow()` is sized from.

Now `if (f.cash <= 0 && profit <= 0)`. A genuinely failing firm walks the same
rungs on the same day counts — `_firmcash_smoke.mjs` proves it by driving both
shapes through 30 modelled days.

---

## 6. PROCESS

```bash
npm run check          # fast gate, ~86 suites, seconds
npm run check:full     # + economy gauntlet + forgeab, ~10 min — BEFORE EVERY DEPLOY
npm run deploy
# then verify at the edge with a cache-buster (see Traps)
```

Economy gauntlet baseline is **3 documented known failures** (round0b dead-ground
gate, round0c business trading before upgrade, round0p farm/mine/quarry gen legs)
plus `_plague_smoke` 1. Anything else is a regression. **Never raise a baseline
to make a build pass** — the runner says so itself.

**SIX version knobs move together** (`bump` scripts in the scratchpad show the
shape): `window.BUILD_VERSION`, **`public/version.txt`**, `sw.js CACHE_VERSION`,
node-city `NC_BUILD`, `effects.js?v=`, `handset.js?v=` (last must EQUAL
BUILD_VERSION).

---

## 7. TRAPS — each of these cost real time this session

1. **`version.txt` must move WITH `BUILD_VERSION`.** Otherwise the app's update
   check calls `location.reload()` 500 ms after load and every headless suite
   dies with *"Execution context was destroyed"*.
2. **CRLF files.** `public/src/economy/firms.js`, `mapforge.format.js`,
   `mapforge.bridge.js`, `mapforge.editor.js` and `_athena_smoke.mjs` are CRLF.
   Anchors written with `\n` match nothing. Normalise, edit, write CRLF back.
3. **The file-lock trap.** `UNKNOWN: open index.html` intermittently, on read AND
   write. Always fails *before* writing. Use the `Atomics.wait` retry loop in the
   scratchpad patch scripts and just re-run.
4. **Never use heredocs for patch content.** Backticks and apostrophes corrupt
   `index.html`. Use the Write tool for patch scripts, then run them with node.
   Backticks inside a JS template literal in a patch script break it too.
5. **Minification changes quoting.** Verifying at the edge, `'x'` becomes `"x"`
   and spaces vanish. `grep -c "economy_nodes').select('id,owner_id')"` returns 0
   on a shipped file that definitely contains it. Search a looser pattern before
   concluding a deploy failed.
6. **CDN cache lag.** `version.txt` can read the *previous* build for ~30 s after
   a successful deploy. Re-check with `-H 'Cache-Control: no-cache'` and a
   cache-buster before panicking.
7. **`_checkall.mjs` is JS, not data.** An unescaped apostrophe in a `why:`
   string breaks the whole file — and a broken `_checkall.mjs` piped to `tail`
   reports **exit 0**, so a "gate run" can look green having executed nothing.
   `node --check _checkall.mjs` after every edit. Never `import()` it to test
   parsing — that *runs* the gate.
8. **`| 0` truncates timestamps.** `Date.now() | 0` is 32-bit garbage. Cost a
   silently-dead fix in v121v89, caught only because the suite drove the real
   lifted function instead of asserting on source text.
9. **Don't scan the live DB.** Targeted, `limit`-ed queries only. A full-table
   bug hunt once throttled production and looked like mass data loss.
10. **A building may only `use` a mirrored id or a CITY_STOCK key.** Since
    v121v83 `LEDGER_MIRROR_RES` is *derived* from the recipes, so this is now
    true by construction — **do not replace the derivation with a literal list.**
    That is what starved the Machine Shop and the Feedstock Plant, twice, both
    found by players.

---

## 8. THE PATTERN WORTH CARRYING FORWARD

**Roughly half the reports this session described a cause that was not the actual
cause.** The gas station's output was fine and its tooltip was lying by 60×. The
Card Hunt's RNG was fine and its pool was tiny. The duplicate PRN is the shipped
design. The referral system was never blocked. The vault's "random" max was two
identical jumps caused by a module not being mounted.

The **symptom** was real every single time. Read the report for the symptom,
then go and find the cause in the code — and when the reporter's diagnosis turns
out to be wrong, say so plainly and fix what is actually broken.

Corollary: three fixes this session were *already written elsewhere in the same
codebase* — `_warehouseCapacity()` held a last-trusted value, `households.js`
stated the wage invariant, `campFortify()` guarded the defense cap. **Look for
the pattern before inventing one.**

## v121v91 — shipped 2026-09-09 (later session), full-gated, edge-verified

Tracker after this build: 34 fixed / 9 open.

| Report | What shipped |
|---|---|
| bug-mtp1ltjq (wages, high) | Household Wage Pool per the §3 recommendation. `op_salary` (corp and local ops) credits `Profile.wagePool` less a 30% leak; node-city patronage draws from the pool through `window.cityWagePoolDraw` BEFORE minting. Takings unchanged, ceiling unchanged; the ledger verb now reads "paid worker wages into the city wage pool"; the Trading card shows the share wages paid for. Cloud-synced as `__wagePool__` (newest stamp wins). `_wagepool_smoke.mjs`. |
| bug-mtuadu79 (clinic, high) | Measured, not designed: the raw fallback in `svcDraw` drew MEDICINE for dispensing when the remedies shelf emptied — 1.9× the Clinic recipe, pinning the larder at one unit. A service building now never raids an ingredient its own `use` needs. Restaurant/food fallback byte-for-byte unchanged. The "A Cannery" note names the real maker. `_clinicloop_smoke.mjs`. |
| bug-mtrmzyhc (hiring) | §4 option 1: Job Fair states seats vs. what the roster can name (CIT.MAX / citizenry). Options 2–3 still open as design work. |
| bug-mtu9vzp3 (duplicate PRNs) | The six-in-any-mix rule is now printed on the licence dialog. The second node was NOT deleted. |

Still open and why: bug-mttcdw79 / bug-mtuasm4d / bug-mtu13pzm / bug-mttyizit need the screenshots (attachments still unreadable — see 📷). bug-mtttvge5 (beverages) and the Lumber "feeds nothing" line in bug-mttyizit are the same venue-economics decision. bug-mtsq62mg awaits reporter confirmation. bug-mtr5xz8t no repro. bug-mtr5bze0 feature request.

Note on the wages design: the pool REPLACES minted patronage; it does not raise a shop's takings. If the intent is that factories should make shops richer, that is a one-line follow-up (a bounded spend bonus funded from the pool) and a tuning decision, not done here.

## v121v92 — shipped 2026-09-09 (same later session), full-gated, edge-verified

Worked from the report TEXT alone (the user is asking players for screenshots; attachments still unreadable from here).

| Report | What shipped |
|---|---|
| bug-mtr5xz8t (managed cities not loading first time, high) | `cityStateLoad` retries a refused `city_state` read once behind a bounded `auth.refreshSession()`; node-city `boot()` reads again 2.5 s later when the first read was refused and nothing local stood in. No repro was available — this is the exit-and-re-enter the reporter does by hand, automated. If it recurs, the console line `[cityStateLoad] REJECTED <code>` names the real refusal. |
| bug-mtr5bze0 (startup sequence) | `_cityWarmup()` runs opFetch / frFetch / nodeFetch / cityHallFetch / corpTreasuryFetch in the background 7 s after load and again at the city door when the last pass is >5 min old (bounded 8 s, best-effort). This is what the Bank → City Hall → Licences → PRNs walk was fetching. The Bank of Ethos iframe itself is not touched — if a bank-side init is also load-bearing for the city, that is the remaining gap. |
| bug-mttcdw79 (population, high) | Three quantities shared one word. Army row is now "Free housing slots" (beds − slots) with a tooltip; Vital Signs reads "NPC residents N / M beds"; the economy panel says "Residents (economy model)". The 294 figure in the report was not located in code — it may be the Camp screen in index.html; the screenshots will settle it. Left OPEN. |
| bug-mtrmi2e5 (345 vs 346 residents) | Label only: the economy count is its own household model. Left OPEN with the workers bottleneck. |
| bug-mtsq62mg (Out of cash) | `bottleneck.classify` judged cash BEFORE the material: an input nobody makes read as "out of cash — failing". Material first now; cash only when a supplier exists. Fix text no longer says "failing" (v121v85 made break-even survivable). Still awaiting the reporter — left OPEN. |

Not touched, and why: bug-mtuasm4d (stadium) — readiness reads `game.stock` + `game.res` and the concession ids are CITY_STOCK only, so the panel should be right; needs the image to see which number he means. bug-mtu13pzm (nobody shopping) — the quoted notification text ("nobody is shopping yet", "no goods to buy") does not exist in the tree; needs the image. bug-mtttvge5 (beverages) — venue-economics decision (handoff §2); note the economy-side `beverages` recipe IS reachable (canecroft → sugarmill, hydrofarm fruit, timber packaging). bug-mttyizit — Lumber has a taker (Panel Plant, `use.lumber`) so "feeds nothing yet" only appears when none is built; Workers bottleneck untouched.

New suite: `_firstload_smoke.mjs` (39 passes) drives the lifted warm-up and `classify`.

## v121v93 — shipped 2026-09-09, full-gated, edge-verified

Reported by word of mouth (no tracker row): "players are able to craft booster packs". They could — the Crafting Station (`CRAFT_RECIPES_DEFAULT`, ~index.html:83714) shipped `pack` and `box` recipes whose grant (`_craftGrantPacks`) put REAL unopened packs in the inventory for salvage. It survived the Card Forge removal (`_cardcraft_smoke.mjs`) because it was never called a forge.

Instruction: "cannot craft anything that has anything to do with cards." So:
- `pack`, `box` and the `sleeve` (card sleeve) rows are gone from the defaults; only the dice skin remains.
- `_craftKindAllowed()` is enforced by `getAllCraftRecipes()`, `_craftProduce()` and `craftStationMake()` — a pack recipe in a published Catalog, a cached Forge copy or an old device is not listed, not made, and spends nothing. Resource recipes that would refine one of the five card GOODS ids are refused too.
- The recipe editor no longer offers pack or sleeve outputs.
- Untouched on purpose: the Foundation Reserve pack (a Cinder PURCHASE), shop purchases, gifts and chests; and the Living Economy's `boosterPacks` GOODS chain (sim inventory only — `cardOutput()` reports, never mints).

Suite: `_nocardcraft_smoke.mjs` (30 passes), drives the lifted station against a catalog that publishes pack/box/legacy/dice.

Git: local history repaired (a corrupt tree from 2026-08-17 rebuilt exactly); commit 07dc451367 on `weather-hotfix` is the full tree. GitHub remote `mythicspellbook` is a code-only mirror — pushed a code-only snapshot as branch `v121v92-code`; its `main` was left alone. v121v93 is NOT yet committed.

## v121v94 — shipped 2026-09-09, full-gated, edge-verified

Three handoffs arrived from other sessions (WOODS_FISHING_HANDOFF.md, FARM_HANDOFF.md, HighwayHaulTestDrive.html) plus one audio bug. What was actually recoverable, and what shipped:

| Ask | State |
|---|---|
| Guide audio overlapping | FIXED. `narrative/index.html` AudioSys keeps ONE voice (`playUrl` stops the last clip; `stopVoice` / `voicePlaying` / `onVoiceEnd`). Journal narration waits for its voice-over before moving on; a voiced dialogue line auto-advances when it ends; Next/Skip cut the clip and the next node starts its own; muted/blocked/404 counts as finished. The classic bubble player (index.html `typeBubble`) got the same rule. |
| Feed Operation | NEW. `OPS_ECON.feed` — 1,500,000 🔥 or `azaStartup: 55` (the one alternate price in the table). Yields `animalFeed` 3.0/worker-hr from food 1.0 + water 0.8. Registered in OP_LABELS, the Just Business catalogue (with a second "◈ Found for 55 Aza" button → `opFound` with `pay:'aza'`, charged through `spendSovereigns`, awaited against the ledger, refunded if unsettled, row written only then), the sidebar (`feed` → Homestead Farm), node-city `OP_BP.feed` (mesh farm) and `OP_ECO_MAP.feed` (a `mill` firm making `animalFeed`, the recipe the ranch/egg/dairy firms already draw on). |
| "Add the operations to my companies" | The owner's founded corporation is **Hidn Studios [HIDN]** (founder = the richaegisop admin account). A `feed` row was inserted into `corp_operations` for it after deploy. The other admin emails found no corporation; "Aurelia" is a member of Omnione, not the owner. |
| Homestead Farm | CONNECTED. The farm branch (`claude/3d-animal-farm-sim-02mrk9`, commits cdf3a83…) is on no reachable remote and its commits are not in local history. The ONLY copy of the code that reached this repo is the sandbox artifact the handoff links — a flat bundle of the six modules. It is lifted verbatim as ONE file, `public/src/farm/index.js` (273 KB), mounted by the new `farm` screen (`renderFarm`), bridged by `window.MythicFarmBridge`, saved on `Profile.farm` and cloud-synced as `__farm__`. Not recovered: `sql/038_farm_auction_and_ranch.sql` (player lots + corp ranch — the module prints "not set up on the server yet"), the Reconstruction workforce seams (`farmers()`/`builders()` return 0), the convoy `bestRig`, node-city's `STOCK_FARM_FALLBACK`/smokehouse/dairy and `OPS_FARM_MENU`. Thirteen ids promoted at the four RESOURCES_NEXT sites (RESOURCES 143 → 156). |
| Highway Haul | CONNECTED, practice mode. The freight game's seven files were lifted verbatim from the inlined test-drive bundle into `public/src/haul/index.js` (152 KB), bridged by `window.MythicHaulBridge`, launched from the Haulage Board's new "🛣️ Drive it" button. `animalFeed` hauls as heavy (bulk) and `livestock` as fragile. Its server side (`haul_*` tables and RPCs, that branch's sql/038–039) is NOT installed here and was not in the bundle, so shipments stay practice-mode; `cities()` returns [] (node rows carry no coordinates) so it drives its built-in 16-city map. |
| Woods Fishing expansion | NOT RECOVERABLE. The branch is on no reachable remote and no artifact exists. Round-2 code (WF3 threats, boats, crew, tournaments) IS already in the tree; `src/fishing/{demand,render,index}.js`, the bridge, the cannery op, the six fish buildings and sql/038_fishing_records are absent. Deliberately NOT retuned: switching `OPS_ECON.fishing` to fish yields without the missing Cold Storage bench would strand every Fishing Company owner's food. |

| Terroir charge on two-yield buildings | FIXED — the "eggs waits for that fix" defect in RESOURCE_CINDER_VALUE's own note. Promoting 13 ids re-dealt the ground and the gauntlet went red on the Smelting Foundry (`@dealt over-charged 264🔥 > one unit per leg (4🔥)`). `inputTerroirScale` charged inputs at the MAX of the yields' factors under a comment claiming every building was single-output; the Foundry has yielded metal + ingots since v121v70. It is now the value-weighted mean (Σ yield×V×tf ÷ Σ yield×V), the only factor that keeps a cycle at the catalogue ratio on every ground. New `resValue` seam on the city bridge (→ `_resCinderValue`), mirrored in the gauntlet's fake host; the gauntlet's drift check prices at the module's own rule while `amp` still asserts the ratio never rises, and its two ground checks read the forced yield's own factor (`tfOut`). Gauntlet back at its documented three. |

Verified: `_farmhaul_smoke.mjs` (147 passes, drives the AudioSys with a stub Audio and checks both bridges field-by-field against what each module dereferences); `tmp/_drive_modules.mjs` boots both modules in headless Chromium against mock bridges — overlay painted, farm shell mounted, zero page errors.

## v121v95 — shipped 2026-09-10, full-gated, edge-verified

The bunker (public/base): asked for "remove all of these modals from the bunker pictures when they are clicked on, I just want them to be for show. Remove the buttons down here but Assign change that to Camp and Ethos Heights. Make them big buttons next to the bunker images on the left side and give a tool tip above them."
- app.jsx: a Room renders with no click and never active; the room Panel is handed null. The A hotkey now reaches Camp Ops like the door.
- hud.jsx: the bottom action row (Build, Ethos Heights, Assign, Hire, Bunks) is gone; the minimap cells no longer open rooms; two full-width doors (`.doors .door`) sit at the top of LeftColumn — Camp → `nav:campOps`, Ethos Heights → `ethos` — each with a `data-tip` tooltip rendered ABOVE the button (styles.css `.door::after`, 78px headroom reserved).
- Measured in headless Chromium (tmp/_drive_bunker.mjs): 9 rooms, no panel on click, cursor default, no action row, two 235×99 doors at x=12 beside the bunker at x=319, both postMessages fire, tooltip opacity 1. Screenshot tmp/_bunker_v95.png.
- Suite: `_bunkerdoors_smoke.mjs` (27). base/index.html busters bumped to the build.

## v121v96 — shipped 2026-09-10, full-gated, edge-verified

- Highway Haul: "Drive it" closes the Haulage Board first, then refuses without a FREIGHT truck bought from Prince Portfolios (the charter gift rig is minted `issued: true`; a legacy unflagged gift is discounted; oil/feed/livestock rigs do not count). Bridge `rigs()` lists the lot's freight trucks; `canDrive()` exposes the gate.
- Feed Operation card prints "1,500,000 🔥 · or 55 ◈ Aza".
- Mayor reports (3): `cityResourceHeadroom` fell through to the MAYOR's own getResourceUnits in a client city — now the owner's units and an open vault (bug-mtul7bkt, bug-mtuqepq5); the crew picker read the mayor's cards — now `city_owner_cards_get` (sql/126, APPLIED) gated on the active mayoral contract, ids and counts only, empty roster on a failed read (bug-mtuqna3v). node_mayors data was checked: no self-owner rows, all match tw_node_owners.
- Woods Fishing round 1: RESOURCES 158 (primeSeafood, monsterParts appended); the live trip banks Fresh Fish / Shellfish / Prime Seafood (+ seaweed 1 in 6); fleet drops land as fish; the Fishing Company yields 1.5 fresh + 0.6 shellfish + 0.3 seaweed; Fish Cannery op (400k, 2 fresh fish → 2.8 food/worker-hr) at every op site; Cold Storage bench (5 → 7 etc.); CONTRACTS tab (4 per 8h window, deterministic per user, 1.25–1.70 premium, paid only against fish held) under a weekly tide event.
- Suite: `_fishing1_smoke.mjs` (51). Round 2 (threats, boats, crew, tournament) is the next build.

## v121v97 — shipped 2026-09-10, full-gated, edge-verified

Woods Fishing round 2, written from WOODS_FISHING_HANDOFF into the existing live trip (the branch never reached this repo). One block in index.html after `_wf3Close`, hooked at five seams (trip open, each frame, each cast, each catch, trip close) and never redefining an engine function:
- THREATS: a meter rises per cast (biome × weather ÷ boat sonar), decays idle; at 100 a Reef Shark / Ash Mako / Cinder Hammerhead / Drowned Anomaly / Ash Leviathan surfaces (weighted by biome tier) and bites the hull on a timer, armour soaking a share. Harpoon (4 per trip + mount; 15–30% + 2×level + mods), Flee (speed + stability odds), Fight (the existing card-battle route; a WON fight pays Leviathan Parts on the way back via `_fishingEncounterAfter.parts`). Kill → parts drop. Hull 0 → WRECK: boat docks damaged, trip over.
- BOATS: `WF3_BOAT_STATS` (armour / sonar / stability per class), XP per trip/expedition/kill, level every 100 (`WF_BOAT_XP_PER_LEVEL`), refit slots at L2/L4/L6, `WF_BOAT_MODS` (Harpoon Mount, Reinforced Hull, Sonar Array, Bilge Pumps) via a Docks refit modal (`data-wfa-refit`).
- CREW: `WF_CREW_RANKS` by exp; `_wfCrewHurt` (health, survive roll 70% / veterans 90%, death removed + logged); `_wfExpCrewHurt` on expeditions; the best idle crewman ships as deckhand (luck) and can be bitten.
- WEATHER + CLOCK per trip (`WF3_WEATHER`, night favours rare fish); HOLD = class capacity × 12, ends the trip when full.
- TOURNAMENT tab: `fishing_record_submit` / `fishing_records_top` (sql/127, APPLIED — one record per angler per week, kg clamped ≤120 server-side, read-only to clients); local best kept offline.
- Not built (no data in the handoff to build from): sonar/school VISUALS in the 3D scene, per-species day/night tables, the six fish city buildings, the anomaly hunter trait, coastal-claim luck. Documented, not faked.
- Suite: `_fishing2_smoke.mjs` (52) lifts the block into a vm with a stubbed engine and runs a scripted trip through every path.

A session cron (156f74e7, hourly at :23, 7-day expiry) sweeps the tracker for NEW reports and fixes them without being asked — the standing order of 2026-09-10. Recreate it in a new session.

## v121v98 — shipped 2026-09-10, full-gated, edge-verified

bug-mtvblyi9 (ClareyV, med): the Zone Demand residential tab at ~71% said "Nobody is moving in… Wages, rents, jobs and services are what move that; the Survey tab shows which one is worst" — and the only Survey tab (Econ → Survey) is the deposit survey. Real cause: `src/demographics/pipeline.js` folded the three draws (work × 0.5, rent-against-wages × 0.3, services × 0.2) into ONE meter and never published the parts, so the sentence promised a breakdown that nothing printed.
- pipeline.js: the arrival loop now accumulates the three draws over every household that looked (a household the rent or job gate turned away counts at the score that turned it away); `pullTerms()` publishes `{ terms, worst, worstText }` as `S.pull`. The cause line keeps its housing verdict and appends "Weakest right now: work / rents against wages / services — …" with the percentage and the fix (Job Fair wages, cheaper zoning, operations, Clinic/Market). No score at all → "the row under this meter shows which one is weakest".
- index.js publishes `pull`; render.js prints a "📊 What draws people here" row under the Move-in pressure meter (three bars, weakest in red) with the sentence beneath. Nothing was added to the Survey tab; the breakdown lives where the sentence is.
- Suite: `_pullrow_smoke.mjs` (24) runs pullTerms and renders the panel. Six knobs → v121v98-pullrow (the demographics module imports at `?v=NC_BUILD`).

## v121v99 — shipped 2026-09-10, full-gated, edge-verified

Two more Zone Demand reports from ClareyV, both the same shape as bug-mtvblyi9: a descriptor named a problem and not its parts.
- bug-mtvdb20t (med) "Services falling short — residents cannot buy what they need here" never said WHICH services or how to fix them. Real cause: `services` in the demographics tick is the MEAN of the economy's per-category satisfaction and the per-category table never left `src/demographics/index.js`. Now `servicesBreakdown(E, snap)` joins each category to the basket row and the INDUSTRIES shop that sells it (Food → Grocery Store, Healthcare → Pharmacy…), hands it to the pipeline as `ctx.servicesBy`, and the cause reads "Short: ⚕️ Healthcare 0% (Pharmacy), 🍞 Food 12% (Grocery Store)… Each is sold by the shop named: found one from the Operations catalogue, staff it at the Job Fair, and keep it stocked." Worst first, at most four, only those below `servicesGood`. The v98 weakest-draw sentence names them too when services is the weakest draw. No breakdown yet → says so.
- bug-mtvdpfce (med) Commercial "Almost Nobody Is Shopping Yet" said the basket was under one unit and that satisfaction reads N% "but there is nothing to satisfy" — the reporter read that as inconsistent, fairly. Real cause: the want figure is residents' savings × spend share, savings are wages, and none of that was printed. `src/hud/demand.js residentsSpending(snap)` now prints residents, savings, employed / working-age and wages last round from the snapshot, and ONE lever picked in order (nobody here → housing; under half employed → jobs; employed but wages under 1 🔥 per resident → firms' cash; under 20 residents → residents; else rents). The commercial tab shows the four as stat cells; `fold()` used to drop `stat` for every non-residential category, so this is the first time any of them has had one.
- What a screenshot would settle for bug-mtvdpfce: the reporter also says the descriptor is "inconsistent with the measure". If the meter shows a high commercial % beside this − term, that is the midpoint (50%) plus the other signed terms (labour slack, customers arriving, utilities) — the note under the panel already says the meter is the midpoint plus the weights. If the image shows something else, reopen.
- Suite: `_shopwhy_smoke.mjs` (32) runs servicesShortText and residentsSpending for real. Six knobs → v121v99-shopwhy.

## v121v100 — shipped 2026-09-10, full-gated, edge-verified (late-morning sweep: 7 new + 4 reopened)

| Report | Verdict |
|---|---|
| `bug-mtvg7q4f` (GreyDragon, **critical**) "Mayor resources showing in client city resources" — text says see PDF | FIXED (the code half). v96 fixed `cityGetRes` / `cityResourceHeadroom` / `cityResourceLedger`; three more bridges still answered for the MAYOR in a managed city: `cityGetResMany` (the bulk read the stock panel and the bottleneck plan use) read `_ensureResources()`; `cityVaultState` / `cityVaultMove` offered the mayor's own Bank of Ethos vault; `cityResourceNeeds` handed over the mayor's Forge needs list. All four now answer for the owner (stalled → zeros / refused; managing → `CityMgr.salvage`, vault reported `managed:true` and node-city's vault panel says whose it is). The PDF was never attached to the report — if it shows a surface other than stock/vault/needs, reopen with the panel name. |
| `bug-mtvg7l39` (Sausage) daily-limit toast covering Roads/Pipes/Zones | FIXED. `.toast` is `pointer-events:none` (no toast has a control), gets `.toast-top` while `#node-city-frame` is open, and the held-Cinder line toasts at most once per 30 min (the bell still gets every change). |
| `bug-mtvgyt59` (Sausage) campaign always fights as Cedric | FIXED. `rlcStartRun` fixed `heroId` before the deck pick (first hero unless the campaign pins one). The pick handler now sets `run.heroId` from the chosen deck (`_rlcDeckHero`: starter deck, `getDeckById`, `Profile.decks`; admin decks with no hero leave it alone). |
| `bug-mtty05g7` (Grimalkin Lord, reopened by Gary) game restarts after a dev-points purchase | FIXED. `payReturnRemember` now records the open city (`App._cityNodeId`); `payReturnRestore` reopens it and sets `window.__ncBootOpen = 'progression'`, which node-city reads after the progression module mounts and opens the tree (`progression/index.js` exports `open()`). The return still lands on the title for a second — that is the Stripe redirect reloading the page, which cannot be avoided. |
| `bug-mtvgfy5s` (ClareyV) services read 0% with two grocers, five power plants, a pharmacy | FIXED (the sentence). The shops ARE counted by the economy; satisfaction is take ÷ want and a grocer with nothing on the shelf reads 0% exactly like no grocer. `servicesBreakdown` now counts standing shops of each kind, the stock of what they sell and the producers that make it, so the row reads "2 Grocery Stores standing with nothing to sell: nothing here makes bread, packaged food — found a Bakery" / "no Pharmacy here — found one" / "stocked; residents could not pay". Electronics: a Tech Store IS in the catalogue (OP_ECO_MAP `techStore`); if the card is locked for them, that is a licence/level gate — a screenshot of the Build menu would settle it. |
| `bug-mtrm50hn` (Grimalkin Lord, reopened) referral box locked after entering the invitee's code | FIXED. The reporter typed the code of a player THEY invited into their own redeem box; the row was accepted (naming the newer player as inviter) and the primary key locked the box. `sql/128` (APPLIED) refuses a referrer whose account is newer than the redeemer's BEFORE the redemption is spent (`referrer_newer`), and the client explains it. The reporter's own wrong row still stands — deleting it from `referral_redemptions` is your call (it paid both sides 5,000 🔥 + 5 Aza + a pack). |
| `bug-mtqasoy6` (Gary via Anonymous, reopened) member cities: "numerous cities against my profile", others "no city founded" | FIXED (the label) — MEASURED on the live table: the CEO owns SIX economy_nodes and has five published cities on them (the five listed are real; the other six rows are a local save and five nodes no longer held, correctly hidden). The other four members own NO node; their city_profiles rows sit on the CEO's nodes because they opened and published the CEO's cities while working in them. The panel now says "no city of their own · works in <city> (<owner>)" for those instead of "no city founded". If one city per corp is what is wanted, that is a design change — say so. |
| `bug-mtvgtg34` (Sausage) cannot open the camp rooms from the grid | OPEN, by design. v95 made the bunker rooms "for show" on the owner's instruction ("remove all of these modals… I just want them to be for show"). Decide whether to keep that; nothing to fix in code. |
| `bug-mtvgecfl` (Aston Drakonis, iOS) "Campaign — the path is stretched out and cannot move the truck; straight lines as shown in video" | OPEN — the video is not attached and the text does not say which mode (Highway Haul is the only truck; its road is a three.js scene). What an image would settle: whether the 3D scene failed to build on iOS (only the route lines drew) or the tap controls did not register. Nothing changed. |
| `bug-mtvg117e` (Sausage, low) flickering number boxes "C96, C3, C80" bottom-centre in City mode | OPEN — nothing in node-city or the parent prints a bare "C" + number at the bottom centre (the parent toast is bottom-centre but prints words). The screenshot would settle it; it is attached but unreadable from here. |
| `bug-mtubctds` (Grimalkin Lord, reopened) Remedies absent from Bank Vault / Player Market / Foundation Reserve | OPEN — by design today: `remedies` (with rations, goods, reagents…) is CITY_STOCK, not a game RESOURCE; node-city documents the trap (sim.js header, CITY_STOCK §2b) and the promotion recipe (RESOURCES row + cloud whitelist + remove from CITY_STOCK). Promoting it is a design call with economy consequences (Health coverage draws from `game.stock.remedies`). Say the word and it gets the farm-id treatment. |

Suite: `_sweep3_smoke.mjs` (48) runs the three bridges, `_rlcDeckHero` and the new `servicesWhy` for real and diffs sql/128 against sql/058. `_corpcities_smoke.mjs` pin updated for the shared-row form. Six knobs → v121v100-sweep3.

## v121v101 — shipped 2026-09-10, full-gated, edge-verified (the owner's list, sent mid-sweep)

| Ask | Done |
|---|---|
| "When opening Feed operation it does not open, just a black screen" | FIXED. `renderFarm()` RETURNED its HTML; every other screen writes `root.innerHTML` itself and `render()` never paints a returned string, so the page cleared and nothing was drawn. Reproduced on the live build (App.screen = 'farm' → #app empty, no error). It now writes #app like the rest. |
| "Make the operation tab neater and cleaner" | DONE (a tidy, not a redesign): registry cards are flex columns with the stat block at the bottom so neighbours line up; every stat row shares one padding and one dashed rule; the description line has a minimum height. Say what else looks untidy and it gets a second pass. |
| "Open the Construction company to every player, licence free and open, but they must start a business and own it from Operations in Just Business; make it the cheapest company: 10 Aza or 20k Cinder" | DONE. `OPS_ECON.construction` = 20,000 🔥 or `azaStartup: 10` (the cheapest priced operation; the registry card shows both prices). `CITY_LICENSES.construction` = no fee, no materials, compliance floor 0. `cityHoldsLicense('construction')` / the licence row's "waived" line are also satisfied by OWNING a Construction Co. (`_ownsConstructionCo`, off the corp_operations rows Just Business already holds). A mayor's own Company now counts in a CLIENT's city: the parent publishes `cityMayorBuildCo()` (Companies + workers) and node-city's `bldSlots` / `bldSpeed` add it with the sited-Co arithmetic while `gov.isOwner === false` (v-earlier `bldMayorCo` only lifted the duration ceiling). |
| "In Bank of Ethos allow players once to obtain a loan for 40 cinder (only once)" | DONE as **40,000 🔥** — read as forty thousand, since 40 Cinder would not buy anything and the cheapest company is 20,000. If forty was meant literally, change `BOE_STARTER_LOAN_CINDER`. A "Starter loan · 40,000 🜂 (once)" button on the Ethos Loans page; no hero collateral; an ordinary boe_loans row tagged `note = 'starter'` (that tag is the once-only rule), four weekly installments, principal credited by the existing `boe_loan_disburse` RPC; refused while any loan is active. |
| "Random buildings appearing in players' cities due to being registered to another player's node… players joining guilds — random PRN nodes are spawning in players' cities" | FIXED at the cause found: the city rings itself with anchors from `FoundationReserve.nodes`, which is the whole CORPORATION's reserve — so joining a corp rang a member's own city with the founder's PRN anchors. `fetchNodes` (own city) now keeps only nodes whose `owner_id` is the viewer (rows without an owner are kept). A client city still rings with its OWNER's nodes (`cityOwnerNodes`, unchanged). Camp REGISTRATION never placed anchors (the Reconstruction seam is `tw_camp_registrations`, read only by the Employment Board); if a registered player still sees foreign buildings after this build, a screenshot of the building card would settle which path placed it. |
| "In Reconstruction pull from the city node the player is registered to and hire from the NPC population there; the message only when the node has no built city / no NPCs" | DONE. The owner's city now publishes EVERY resident not on an errand (not only the jobless) as its labour pool (`citLabourByRole`), so a built city always has people on the board; a hire still leaves it one short (sql/088). `sql/129` (APPLIED) makes `camp_labour_market` list every published trade including 0 free (the client already disables the button and prints "0 avail"), so an empty board means exactly "no city with residents on this node", and the board now says that. Reach and never-your-own-city rules from 088b are unchanged. ⚠ The pool is published from the OWNER's open game every 20 minutes (`cityTradePublish`); a node whose owner has not opened their city since this build still shows the old pool until they do. |
| "Build it where city builders of mayors, registered camps/cities and corporations do not clash — everyone has their own city data" | This build closes the two leaks found (corp-wide anchors above; the mayor's ledger/vault/needs in v100). City state itself is per node and per owner already (`city_states`, CityMgr owner ledger). Anything still crossing over needs the building name and whose city it appeared in. |
| "Account and device data transfer is still not working — different data on my other PC" | NOT CHANGED — nothing to act on yet. The sync guard is most-recent-write (cloudFetchProfile compares the cloud row's updated_at against the device's last local edit with a 5 s grace; a real sign-in forces the cloud copy). To find the cause I need, from the PC that shows the wrong data: which figures differ (Cinder? cards? camp level? the city?), the build number in the corner, and whether that PC was signed in with a persisted session or signed in fresh. A screenshot of the Profile page on both PCs would settle it. |

⚠ The Construction Co. price is PINNED, not merely tabled: h016 clamped it FREE through any published override so a stale catalog (350,000) could not paywall it; the same stale catalog would now reprice it, so `OPS_FREE_LICENCE` is empty and `OPS_PINNED_PRICE = { construction: 1 }` makes the table's startup / azaStartup the last word through any override. §8 of tools/economy-tests/run.mjs was re-pointed at the new rule (it pinned startup 0 and would otherwise fail for ever).

Suite: `_ownerlist_smoke.mjs` (47) runs renderFarm against a fake document, the licence/gang readers, the loan refusals, node-city's slots/speed with a mayor Co., the anchor filter, and diffs sql/129 against 088b. Six knobs → v121v101-ownerlist.

## v121v102 — shipped 2026-09-10, full-gated, edge-verified (the owner's afternoon list)

⚠ STANDING ORDER REVISED 2026-09-10 (afternoon): "before auto fixing things in the bug tracker let me approve it first." The hourly sweep (cron 862febcc, replaces 156f74e7) now TRIAGES only — it reads new reports, finds the cause, writes up the proposed fix, and waits for the owner's yes per report before any code change, deploy or "fixed" mark.

| Ask | Done |
|---|---|
| "Make sure the leaderboard stats on the little phone" | The phone's 🏆 Leaderboards app was already wired (window.MythicLeaderboard → sql/124 `lb_cities` / `lb_players` / `lb_city_resources`, all present and returning rows on the live DB: 25 cities on cinder and population, 25 players on wins and kills, 16 on rating, 4 on ranked). Your own row was marked "you" but nothing was said when you were outside the top — it now prints "You are #n of the N ranked" / "You are not in the top N on this board yet" / "Sign in to see where you stand". If the ask meant something else (a stat that is missing, a board that shows empty), say which board. |
| "Listing something for sale didn't list, but the resources were deducted" | Not reproducible from the code or the data: `resource_listings` shows listings landing (five in the last 24 h, three at 11:56–11:57 today), `rl_post_listing` RAISES on every refusal (TOO_MANY_LISTINGS, TOO_FAST, NOT_SIGNED_IN…) and the client unescrows on any error. What would settle it: the resource, the amount, the time, and whether it showed under My Listings after a refresh — a listing that was posted but not shown is a different bug from one that was refused. |
| "Depositing into the Foundation Reserve — nothing happened but the resources are gone" | One real hole closed: the refund of a FAILED contribution went through `addSalvage`, which clamps to the stash ceiling — on a full stash (the usual state right before contributing) the refund was silently eaten. It now goes through the unclamped `_refundRes` and persists. Contributions themselves are landing (172 rows updated in 24 h). |
| "…or in the vault" | One real hole closed: the bank's resource write (`_boeResTx`) updated `bank_of_ethos … eq(user_id)` without selecting, and a PostgREST update that matches no row returns success with nothing written — the stash was debited, the vault never moved. The write now selects the row it touched and a 0-row write fails, which makes `boeDepositRes` unwind and refund both the units and the 2,500 🔥 fee. 78 of 125 profiles have no bank row yet; those accounts open one on first bank visit, so a deposit before that ever loaded would have hit exactly this. |
| Homestead: "move the buttons at the bottom to the top because you cannot see them" | DONE. `.farm-bar` is at the top (10 px; 4 px on phones, with the HUD moved under it and the panel using the bottom). |
| "Make it where you need corn, bread, fruit to craft feed, after the Feed Mill is built" | DONE. `feedMillRecipe` = 6 corn + 4 bread + 4 fruit → 24 Animal Feed (all three are ledger resources the city farms and bakeries bank); the existing gate already refuses until the Feed Mill is built and ready. |
| "Increase the amount of resources needed to build these" | DONE. Every level of every farm building: resources ×2, Cinder ×1.5 (Feed Mill L1 22,000/30 wood/20 stone/10 water → 33,000/60/40/20; Cattle Barn L1 90,000/120/60/30 → 135,000/240/120/60). 35 cost rows. |

Suite: `_farmfeed_smoke.mjs` (26) runs the vault seam against fakes (0 rows → ok:false) and pins the recipe, the bar, and the raised costs. `_farmhaul_smoke.mjs` buster pin relaxed. Six knobs → v121v102-farmfeed; the farm module buster moved to farm2.

## v121v103 — shipped 2026-09-10, full-gated, edge-verified (Homestead: no flash, the city's sky)

Owner: "Fix the flashing that all of the pages do like it refreshes… and when it comes to pressing buttons on the feed stock it changes the weather. The weather should be exactly like how the city builder weather and time is."
- FLASH: `paint()` rebuilt the ledger, HUD and panel `innerHTML` on every 20 s tick AND every click, whether or not anything changed — a full rebuild reads as the page refreshing. A `setHtml(el, html)` helper now diffs against the last paint and writes only when the markup differs, keeping the scroll position. The 3D scene already re-lit only on a weather/sky key change.
- WEATHER ON A CLICK: the farm rolled its own 6-hour weather off the camp seed (`weatherAt(seed, now)`) and read it from two places (`seedOf(host)` vs `s.seed`) — a click could repaint through the other reader and flip the chip. Replaced at the source: node-city's live `wx` (which lives only in the iframe and was never serialised) is now PUBLISHED to `localStorage.nc_wx` ({type, until, at}) at the top of every weather tick when type or deadline changed; `MythicFarmBridge.cityWeather()` reads it and `cityHour()` gives the city's clock (America/New_York, the same formatter node-city `estClock` lights the city by). The farm's `weatherAt` takes the city's answer first (cloudy→overcast, snow→snow (new row, never rolled), tornado/fire rain/anomaly→storm; a front whose `until` passed while the city was shut reads as clear) and rolls its own only for a player whose city has never run. The 3D sky follows the clock (night <5 and ≥21, dusk 5–7 and 19–21, day between — node-city `phaseBlend` bands); the HUD prints "HH:MM city time".
- ⚠ Parity is exact while the city is running (it publishes on every change) and "last known, honouring the deadline" while it is shut — the city's weather is random per session and cannot be re-derived without it. The farm's raid/egg/graze multipliers still key off the mirrored weather.
- Suite: `_farmsky_smoke.mjs` (30) lifts `cityWeatherAt` / `skyForHour` / `setHtml` and runs them. Six knobs → v121v103-farmsky; the farm buster moved to farm3.

## v121v104 — shipped 2026-09-10, full-gated, edge-verified (Construction Co. at home AND in a client's city)

Owner: "a player cannot place his construction company in his city because it is saying his construction company is placed in another city. Allow only mayors' Construction Co. to be placed in other players' cities, and even if their construction companies are placed in another city allow them to place it in their own."
- Cause: an operation row carries ONE `meta.site`. A mayor who sited their Co. in a client's city (the one op a mayor may site there — `opsMayorMaySite` / `cityOpsSite`) then found the card locked at home: `opsRowsOf` read the row as `elsewhere`, the card said "Sited in another city", and `cityOpsSite` refused with `already-sited`.
- Fix (construction only): the build-menu card offers a Co. that stands elsewhere as placeable here (`resite`), `tryPlace` sites the elsewhere row when none stands here, and `cityOpsSite` lets a construction row be sited again — the one `site` MOVES to the city it is placed in (same city twice is still refused). The building already standing in the other city is left where it is: the reconcile there touches no row that points elsewhere, the tile still counts for `bldCoTiles()`, and a managing mayor's crews there are counted off the mayor's own manifest since v121v101 (`bldMayorCoStats`). Every other operation keeps the one-plot rule; the mayor rule (only construction in a city you manage) is unchanged.
- ⚠ The moved-away building has no live row behind it: `opsRowAt` there returns null, so its own workers read 0 in that city (the mayor's manifest fills that in while managing); demolishing it there is a plain demolition. If a Co. is wanted to keep TWO live rows, that is a multi-site row shape (`meta.sites` keyed by node) — say so.
- Suite: `_cohome_smoke.mjs` (20) runs the card gate and `cityOpsSite` against fakes for all four shapes. Six knobs → v121v104-cohome.

## TRIAGED 2026-09-10 evening — APPROVED by the owner ("Fix those bugs") and shipped in v121v105 below

| Report | Cause found | Proposed fix |
|---|---|---|
| `bug-mtvziq1a` (Grimalkin Lord, high) reagents read 0 while being produced | node-city `economyTick`: every consumer's `use` is added to `spendNeeds` BEFORE the input gate decides whether the building runs (29956 vs 29964), and the total is subtracted from city stock clamped at 0 (30282). When reagent demand exceeds supply (Smelter 0.09/min vs Research 0.30 + Med Lab 0.28 + …) the stock is drained to exactly 0 every tick, every consumer is gated offline and still charged, and the balance never accumulates. | Charge inputs only for buildings that actually run, and when short share stock proportionally (run and charge at supply ÷ demand, the way `opsLabTick` already does). ~10 lines in `economyTick`; economy gauntlet must pass. |
| `bug-mtw1n1bi` (Fuzzy, high) Construction Co. disappeared; a message when placing a new one | No code path deletes a Co. tile (the reconcile's deleting pass is dead code after `return;` — "left standing on purpose"; the anchor pass removes PRN anchors only). The MESSAGE is almost certainly the "sited in another city" lock that v121v104 lifted for construction — the reporter is in GreyDragon's corp with a camp registered elsewhere, and a mayor-placed Co. in a client city produced exactly that lock at home. The tile vanishing is unexplained without the image; the cross-device profile mismatch the owner reported is the other candidate. | Ask Fuzzy to reload (v121v104) and place again; if the message persists or the tile is still gone, the screenshot's message text settles which path. |
| `bug-mtw1v5e2` (ClareyV) cannot license more than 6 PRNs; has a duplicate | By design: `NODE_MAX_PER_CORP` = 6 total per corporation in any mix (`nodeEstablish`), and the Reserve panel says so. There is no "abandon a node" action, so a duplicate cannot be traded for another type. | Design call: raise the cap, or add "Release node" (delete the economy_nodes row, refund nothing / part) so a corp can swap a duplicate. Placement per city is already the anchor ring, unlimited by the licence count. |
| `bug-mtw1qg89` / `bug-mtw1jo7k` (Grimalkin Lord) Rations / Planks only on the phone leaderboard, not in the Ops Vault, Reserve or Market | Same shape as `bug-mtubctds` (Remedies): rations, planks, ingots, components, reagents, goods, remedies are CITY_STOCK — they live in the city builder only (node-city sim.js header, §2b). sql/124's `lb_city_resources` ranks `state.stock` keys, so the phone shows them as boards, which sets the expectation. | Either promote them to game RESOURCES (RESOURCES row + cloud whitelist + remove from CITY_STOCK, the farm-id recipe — an economy change: Health coverage draws from `game.stock.remedies`), or label the phone board "city stock — stays in the city builder". One decision covers all three reports. |
| `bug-mtw1eyki` (Grimalkin Lord) "Shut Down Corporation" button | Feature: there is no leave/dissolve path at all (grep: no corp_leave / corp_dissolve RPC or UI), and sql/078 enforces one corporation per founder, so a founder can never join another. | New RPC `corp_dissolve` (founder only; refuses while the treasury/vault hold anything or ops are sited, or sweeps them by rule) + a button in City Hall → Registry with a typed-name confirm. |
| `bug-mtvzvnwt` (Grimalkin Lord) Production Chain "Feeds" cut at 4 with "+N more" | node-city 34007-34008: the feeds line is `arr.slice(0, 4)` + " +N more". | Print the whole list (or a "show all" toggle) — a two-line change. |

## v121v105 — shipped 2026-09-10, full-gated, edge-verified (the approved batch + the 3D map only)

| Report | Done |
|---|---|
| `bug-mtvziq1a` (Grimalkin Lord, high) reagents read 0 while produced | FIXED in node-city `economyTick`: a consumer's inputs are charged ONLY when it runs, and every city-stock input is shared in proportion — `share = 0.9 × shelf ÷ last tick's full demand` (read at the top of the tick, after last tick's spend and before this tick's production), scaling the draw AND the output (goods, Cinder, power). With demand 7× supply the shelf settles above zero and every consumer keeps running at its share (the suite replays 40 ticks). No economics numbers changed. |
| `bug-mtvzvnwt` (Grimalkin Lord) Production Chain feeds cut at four | FIXED: the feeds / fed-by lists print every building. |
| `bug-mtw1v5e2` (ClareyV) six PRNs, one a duplicate, no way out | DONE: each node card in the Foundation Reserve has 🗑 Release — the member who licensed the node deletes it for good (economy_nodes `en_del`, owner only, the delete proves it touched a row), nothing is refunded, the reserve re-reads and a licence slot frees. The cap of six per corporation is unchanged. |
| `bug-mtw1qg89` / `bug-mtw1jo7k` / `bug-mtubctds` (Grimalkin Lord) rations / planks / remedies nowhere but the phone | DONE, player-driven: the three are game RESOURCES now (rows appended LAST after the fishing ids; SALVAGE_RES; Cinder values 5 / 6 / 9; MINIGAME_IDS), and the Warehouse's Refined stock card has "📤 Send N to stash" per good, which moves the pile out of city stock into the ledger through the bridge (put back if the stash refuses). Inside the city they are still CITY_STOCK — kitchens, clinics and yards draw from the shelf exactly as before; nothing leaves the city unless the player sends it. Once in the stash they show in the Ops Vault, the Reserve Contribute tab and the Player Market like any resource. Goods, components and reagents stay city-only. |
| `bug-mtw1eyki` (Grimalkin Lord) "Shut Down Corporation" | DONE: `sql/130` (APPLIED) `corp_dissolve(p_corp_id)` — founder only, refuses while the treasury holds Cinder or the vault holds items (pay out / withdraw first with the existing tools), then deletes the corporation row (members, requests, licences, operations, staff, offers, chat, policies cascade; licensed nodes survive under their owner via SET NULL). The founder's Guild & Hiring panel (where members see Leave) has "🏢 Shut down corporation" with a typed-name confirm; the parent action calls the RPC and resets the corp state like Leave. |
| `bug-mtw1n1bi` (Fuzzy, high) Construction Co. disappeared | Not reproducible in code (no path deletes the tile); the placement message is the one v121v104 lifted. Left OPEN until Fuzzy reloads and reports — a screenshot of the message text settles it. |
| Owner: "Remove Classic map from the rogue map — only the 3D map" | DONE: the in-map "🗺 Classic map" button is gone and `_rlcUseAscent` answers true regardless of the old localStorage opt-out or a campaign's `useAscentMap === false`. The 2D board code stays for the editor. |

Suite: `_batch1_smoke.mjs` (32) replays the share rule, lifts nodeRelease, corp_dissolve and the stash-send handler. Pins updated: `_citystock_smoke.mjs` (card title), `_fishing1_smoke.mjs` (the last five RESOURCES ids). Six knobs → v121v105-batch.

## v121v106 — shipped 2026-09-10, full-gated, edge-verified (the valuation panel tracks real player sales)

Owner: "keep track of real data when it comes to the sell price — this card (Bahamut King of Good Dragons) sold for 300,000 cinder to a player so the market should have tracked and counted that, and the price and chart should have reflected it… same as resources."
- Found: the server already had the sales — `card_market_listings` holds the sold rows (this card: 300,000 🔥 on 2026-09-09 and 500,000 🔥 on 2026-08-12) and sql/115 `luni_price_history('card', card_id)` is the public read the item pages already draw. The Digital Valuation modal (`renderDvsAssetModal`) never asked it: its "Recent sales" was the BUYER's own local `Market.salesLog`, its chart was the local hourly model snapshots, and its Suggested Cinder Value was the model alone — so the seller, and everyone else, saw "No recorded sales yet" and 468 🔥 beside a real 300,000 🔥 sale.
- Now: the modal fetches the real feed through the Luni cache (and repaints when it lands), lists the real sales with "Last sold N 🔥 · N recorded player sales", draws the chart from real sale points when two or more are in view (model snapshots only for an untraded card), takes the 24h/7d/30d deltas from them, and the value box becomes **Market Cinder Value** = 70% × the real average in view + 30% × the model (the model still anchors against a single outlier; Aza-priced sales are left out of the Cinder maths). For Bahamut that is 0.7 × 400,000 + 0.3 × 468 = 280,140 🔥.
- ⚠ Not changed: the market TILES' small "suggested" chip still shows the model (it has no feed per tile); and the wider Stock Market view (main chart + ticker) is still the local sales log — the owner's next ask (v121v107) is to rebuild that on real data across all players with 1 h / all-time highs.
- Suite: `_realsales_smoke.mjs` (17) lifts the modal and renders it against no sales, one, two, and an Aza-only sale. Six knobs → v121v106-realsales.

## v121v107 — shipped 2026-09-11, full-gated, edge-verified (the Crash/Exchange on the real shared tape)

Owner: "update the stock market to make it look and feel like a real stock market where it shows the 1 hour and all-time highs and real data vs all the players."
- Found: every player's buys and sells already moved ONE shared price per asset (`cx_prices`, realtime-synced). What nobody held was the HISTORY: each client kept its own 80-point local tape (`cx.history`) and padded it with a synthetic curve (`_cxGenSyntheticSeries`) when thin — so two players looking at the same asset saw different charts, and no 1-hour or all-time high could exist.
- `sql/131` (APPLIED): `cx_price_history` — a trigger on `cx_prices` appends every shared price change (skips writes where the price did not move); backfilled with the 666 current prices; read-only to players. `cx_history(asset, seconds)` returns a range downsampled to ~400 points; `cx_stats(asset)` returns 1 h / 24 h high-low, all-time high (with its date) and low, the price 24 h ago, point count, first point; `cx_stats_all()` the same per asset plus a 16-point spark.
- Client: `CXHist` cache (60 s TTL, one fetch in flight per key, repaint when a fetch lands). `_cxGetHistory` draws the shared tape when it has two points for the range (the live price appended as the last point); local tape / synthetic curve only until the first fetch lands or for an asset with fewer than two shared points. The focus toolbar shows **1H high/low**, the range **HIGH/LOW**, **ATH** (title carries the date) / **ATL**, VOL, and a ● LIVE mark when the line is the shared tape. Every market and portfolio row's 24H Δ is measured against the shared price 24 h ago (`_cxDelta24`; the base-price delta only until the tape has a day), and table sparks are the shared 24 h spark (no per-row fetch). The exchange asks for every asset's stats once a minute on open.
- ⚠ The tape starts today: until it has a day, "24 h ago" is empty and rows fall back to the base-price delta; ATH equals the current price for assets nobody has traded since the backfill. The order book, world events and insider intel panels are still the synthetic dressing they were.
- Suite: `_cxtape_smoke.mjs` (24) lifts the fetchers and runs the in-flight guard, the shared-series read and the 24 h delta. Six knobs → v121v107-cxtape.

## v121v108 — shipped 2026-09-11, full-gated, edge-verified ("check the bug checker and fix what is on there")

| Report | Verdict |
|---|---|
| `bug-mtsq62mg` (Grimalkin Lord, reopened ×4) "Out of Cash — Limited by Business 0%" for days, then bankrupt | FIXED at the root that was left: v91 stopped counting a zero balance alone as a bad day, but a firm that could not afford its FIRST inputs had `revenueAvg` 0, so `creditLimit()` (revenue × 90 days) was 0 and the bank could never lend; and `autoBorrow` fired only at DEBT/DEFAULT, which a firm that never trades (never loses money) never reaches — stuck at 0 for ever. Now `creditLimit` has a working-capital floor of five days of operating cost for a firm with no revenue history (`ECON.bank.startupDays`), and `autoBorrow` also fires for a firm at 0 cash with no revenue today (a firm breaking even at zero is left alone). Needs a Bank in the city — the Out-of-cash verdict now says so. Economy gauntlet unchanged at baseline. |
| `bug-mtrmi2e5` (Grimalkin Lord) "workers 0%" with 345 residents, 207 employed, 3% unemployment | FIXED (the sentence): all three numbers were true at once — residents include children and retirees, and 3% unemployment means the working-age pool is spent. The primary bottleneck now says "Only N of M working-age residents are free to hire (E already employed; P residents in all — children and retirees do not work)" and what raises them. |
| `bug-mtu13pzm` (Grimalkin Lord) nobody shopping + "a non-numeric value presented" | FIXED (the value): `qty()` printed `1e-7` for a basket under a hundredth — now "under 0.01". The shopping verdict itself was rebuilt in v121v99 (what makes a basket, and the one lever). |
| `bug-mtuasm4d` (Grimalkin Lord) Stadium not picking up Remedies, Goods, Rations | FIXED (the panel): the readiness reads city stock correctly (`nodeStockView` = city stock over ledger) but printed only one "N% served" figure, so a short line read as a resource not plugged in. Each concession line now shows HAVE (city stock) / NEED for the event's attendance and length, ✓ or short. |
| `bug-mttcdw79` (GreyDragon, high) population figures disagree | Already addressed in the tree (node-city `renderArmy` — the Army row is housing slots and says so; beds, slots, NPC residents and the model's households are four different true numbers). Verified served at the edge; marked fixed. |
| `bug-mttyizit` (Grimalkin Lord) values at 0% for all companies; "Lumber isn't going anywhere" | Explained: the Workers bar now moves (reporter's own follow-up); Lumber is a ledger resource, and its Production Chain line already reads "feeds nothing yet — it banks to your vault"; Structural Steel / Metal Components at 0% are inputs no building in that city makes (the chain says "nothing in this city makes it"). Marked fixed. |
| `bug-mtvgtg34` (Sausage) cannot open the camp rooms | WON'T FIX — by the owner's v121v95 instruction (rooms are for show; the two doors are Camp and Ethos Heights). |
| `bug-mtvg117e` (Sausage, low) flickering "C96, C3, C80" boxes bottom-centre in City mode | OPEN — those look like citizen ids (c96…), but no code path prints one as a label (hover tips print the name); the attached screenshot would settle it. |
| `bug-mtvgecfl` (Aston Drakonis, iOS) truck path stretched, cannot move | OPEN — needs the video. |
| `bug-mtw1n1bi` (Fuzzy) Construction Co. disappeared | OPEN — awaiting a reload on v121v104+. |

Suite: `_tracker_smoke.mjs` (21) runs creditLimit / autoBorrow / primary() / qty() / concessionFulfilment for real. `_firmcash_smoke.mjs` pin updated to the new lending rule. Six knobs → v121v108-tracker.

## v121v109 — shipped 2026-09-11, full-gated, edge-verified (candlesticks on the exchange; real exits in Highway Haul)

Owner: "change the chart lines to the stock bar candles… and show the price when a player hovers over the candles" / "in the 3D haul for the exit make it where it actually takes the exit and goes to a new highway instead of putting the car back on the road."
- **Candlesticks.** The Crash/Exchange focus chart buckets the shared tape (v121v107) into open/high/low/close bars — 12 per hour range, 24 per 6 h and 24 h, 28 per week, 30 per month, 40 for ALL (`CX_CANDLES_PER_RANGE`); green when the close is above the open, red below; the live price is the last point. One delegated `mousemove` listener (bound once) shows a tooltip beside the cursor with the bucket's time span, tick count, O / H / L / C and the bucket's % move. The old line chart stays for an asset with fewer than two candles (a card nobody has traded, or a range with one point).
- **Real exits.** Before: at a correct exit the rig was clamped straight back onto the same road (`S.x = min(x, ROAD_W/2 − …)`) — the ramp led nowhere. Now a correct, non-final exit leaves the highway: every segment is re-seeded (`legSeed` = hash of the road it is leaving for, folded into the prop RNG) and the building palette steps (four palettes, one per highway), a full-screen merge overlay names the new road ("↗ EXIT → CINDER FORK HIGHWAY · merging onto the new highway"), and the rig is eased from the ramp into the slow lane over 2.4 s with the rails held off, then a flash names the highway. A wrong exit (or the final exit into the destination) still clamps back and reroutes exactly as before, so the scoring is unchanged. The road centreline function is shared, so the two highways differ in scenery, palette and name rather than lane count.
- Suite: `_candles_smoke.mjs` (24) lifts the bucketing, the SVG and the tooltip, and runs the merge easing. `_farmhaul_smoke.mjs` buster pin relaxed (haul2). Six knobs → v121v109-candles.

## v121v110 — shipped 2026-09-11, full-gated, edge-verified (the flatbed semi and its containers; raiders cannot drive through traffic)

Owner (with three Meshy GLBs): "Make it where raiders cannot go through cars, where if they are coming to ram the player and there is traffic the traffic can help the player… Change the freight trucks into this and then change the freight truck model that the haul mini game [uses] into the freight truck… picked from Prince Portfolio. Also when it comes to the containers use these container models and still use the animations and physics of the containers that we already have."
- **The models.** Packed by `tools/glbprop.mjs` (masters in `assets-source/glb-masters/{trucks,containers}/`, never under public/): the white flatbed semi 26.7 MB / ~3M tris → 0.84 MB / 12k tris (`models/trucks/freight_semi.glb`), the blue 20-ft container 19.9 MB → 0.59 MB, the red 40-ft container 16.7 MB → 0.53 MB (512px WebP). Three re-include lines in `public/.assetsignore` — without them the blanket `**/*.glb` rule 404s a model in production only.
- **Prince Portfolio.** Every freight rig row in `src/transport/rigs.data.js` (six rows, five body types) now carries `FREIGHT_MODEL` (`rotY: 90` — the mesh's long axis is X with the cab at −X), so the Truck Yard card and the vehicle modal show the semi where they showed nothing. One body for five body types is the owner's call ("the freight trucks"). `_rigyard_smoke` pin updated (a freight rig resolved null by design before).
- **The haul drives the truck you picked.** The bridge's `rigs:` list copies `_ppModelOf(v)` onto each lot row; `rigProfile` keeps it; the run loads it with the GLTFLoader from the SAME three.js 0.171 build the run imports (the addon resolves its `three` import through the page's import map, so there is one instance — window.THREE's legacy loader would hand the WebGPU renderer foreign objects), flattens materials to Lambert, fits it uniformly to the traffic trucks' width (2.4 m) capped at 14 m, and hides (never removes) the procedural cab/bed/wheels — they are the fallback if the file fails, and the run starts on them before the file lands. The collision half-length becomes the fitted model's (per run, `let PLAYER_HALF_L`, capped at 7.2 m) and the chase camera backs off by the extra length.
- **Containers, same animation.** The three cargo crates became three GROUPS (`userData.cargo`) with the crate as a child, so the cargo animation in draw() (scale + tilt per cargo child with the cargo %) is untouched. When the semi lands, `haulDeckOf` finds the deck in the mesh (the low run of height bins behind the cab, sampled on the centre strip so the wheels stay out) and the slots are re-laid along it: the red 40-footer rear (58 %), the blue 20-footer front (42 %), each fitted to its slot on every axis via a scaled holder (scaling the turned model itself put the length scale on the width — caught by the suite). The third slot is hidden. A guard rides on the cab roof.
- **Raiders vs traffic.** A raider was a homing point that slid through every car. Now `raiderLead` (the nearest car ahead of it, in its width, not yet past the rig) is its lead; `raiderSteer` brakes it behind that lead and aims for the gap beside it on the rig's side (or the other side when that is off the road); it can never overlap the lead; and a raider held off for `RAIDER_GIVE_UP_S` = 6 s gives up — "🚗 TRAFFIC HELD THE RAIDERS OFF", counted as beaten. The how-to says so.
- Suite: `_semi_smoke.mjs` (41) pins the files, the allow-list, the rows, the bridge, the run wiring, and runs raiderLead / raiderSteer / haulFit / haulDeckOf for real on node's three. `_candles_smoke` buster pin relaxed. Six knobs → v121v110-semi.

## v121v111 — shipped 2026-09-11, full-gated, edge-verified (signals, A/D, the semi done properly, traffic)

Owner: "The turn signals are wrong… in the city builder A moves right and D moves left… the traffic in the haul flickers and does not appear after a while." Then, with a screenshot of a sideways box truck wearing containers: "This does not look right, make the truck look good and sizeable, facing the right way… and the turning signals are still wrong."
- **Blinkers.** Every vehicle in the run is built nose-at-+Z and turned 180°, so the model's local −x is the driver's RIGHT. `addBlinkers` put L at −x and R at +x — mirrored for the rig and every traffic car. Sides swapped; the steer sign and the traffic signal direction were already right.
- **City builder A/D.** `keyPanTick` built the camera-right vector as (fwd.z, 0, −fwd.x), which is forward × up NEGATED — left. D panned left, A panned right. Now (−fwd.z, 0, fwd.x).
- **What the screenshot was.** The owner's freight lot row carries an admin-uploaded box-truck render (`modelUrl`, rotY 0 — the HidnEx truck), and v110's bridge preferred a row upload over the catalogue, so the haul drove that box truck sideways (its long axis is X) and `haulDeckOf` could find no deck on a box body, so the "guessed" deck stacked both containers on its roof. Three fixes: (1) the haul now takes the CATALOGUE class model first (`_haulModelOf` — the semi for every freight rig), a row upload only when the class has none; the yard card keeps the other order. (2) `haulAutoOrient` measures the mesh — long axis to Z, tall end (the cab) to +Z — so no rotY knob can put a truck sideways or backwards. (3) A truck whose mesh has no deck (`deck.guessed`) gets NO containers and no crates; the cargo % and damage still run.
- **Bigger.** Fitted to 2.6 m wide / 15 m long (the semi lands at 2.37 × 15 × 3.1, a little larger than the traffic trucks); collision half-length cap 7.6 m; containers 2.1 m tall and the deck width less 15 cm.
- **Traffic.** Could not reproduce a flicker in the Browser pane (the sim does not step in a hidden tab). Two real jitter sources fixed by reading the tick: a car whose lead was in its target lane could be snapped INTO the lead's position every frame (now only ever eased back, 6 m/s, behind a lead that is actually ahead), and a side-swiped car was shoved 0.8 m per FRAME with no road clamp (now per second, clamped to the road). If the owner still sees it, a short video would settle it.
- Suite: `_signals_smoke.mjs` (21) runs the pan vector and haulAutoOrient on four synthetic orientations for real. `_semi_smoke` pins moved with the rule. Six knobs → v121v111-signals.

## v121v112 — shipped 2026-09-11, full-gated, edge-verified (tooltips everywhere)

Owner (with the Mission Debrief screenshot): "Add tool tips on all of the buttons on the menus, as well as the tool tips on everything in camp, as well as the hovering over the resources."
- **One engine, not a hundred render sites.** `src/hubui/tips.js` (classic script, so it can read the game's top-level tables by name) resolves what to say for the thing under the pointer in order: `data-tip` on the element or an ancestor → a `title` (every one of the ~600 titles already in the game now shows as the styled bubble; the native title is parked in `data-tip-title` while ours shows and put back after, so nothing shows twice and code reading `.title` still works) → `TIP_BY`, a selector → text table for controls that never had a title (main-menu rows, hub breadcrumb, Luni market bar, cinder/aza sprites, every camp control the inventory found without one: tabs, build/upgrade, collect, rescue, MIA, Deploy, storage, bed rack, debrief, cost editor, ambience) → the resource icon under the pointer.
- **Resources.** The character under the pointer is read from the text itself (`caretPositionFromPoint` / `caretRangeFromPoint`, grapheme-safe through `Intl.Segmenter`; both graphemes touching a caret boundary are tried, since the caret sits on a boundary), so "🥫 12 · 🔫 4" names each icon as the mouse crosses it wherever it is printed — debrief lines, loot lines, chips, tables. The icon → name map is built lazily from `RESOURCES`, `SALVAGE_RES`, `CITY_STOCK`/`CITY_RESOURCES` when present, the haul's materials, plus `TIP_ICONS` for 🔥 Cinder, 🪙 Aza, 🌙 Luni, ⛽ Fuel, ⭐ XP, 💊 Medicine, 🧂 Salvage.
- **Menus.** Every hub tile (`.hub-portal`, ~50 tiles across main / battle / forge / exchange / codex / field / arcanum) carries `data-tip="name — sub"` from its PORTALS row; every fallback Master-Duel item carries "title — subtitle" from MD_SECTIONS; every phone app carries "name — sub" from APPS; the cinematic main menu (`main-menu/index.html`, its own document) loads the same engine and its eight nav rows are named in TIP_BY. The camp HUD resource chips (Gold … Defenses) carry `CHUD_TIPS`.
- **Touch and keyboard.** A long press (450 ms) shows the tip for what is under the finger, lifting hides it after 1.4 s; focus shows it; scroll, mousedown, Escape and leaving hide it; a repaint that removes the anchor hides it (MutationObserver). Fixed layer at z-index 2147483000 — above every in-app modal, under the toast.
- Suite: `_tips_smoke.mjs` (42) runs the shipped engine on a fake DOM: the resolution order, the no-borrowing rule for buttons, the table, and the icon-under-pointer on a real loot line. Knobs → v121v112-tips, then v121v113-tips: the edge check found 🔥 naming "Cat Gasoline" (a chain resource in RESOURCES borrows the flame), so the currency names in TIP_ICONS are now entered before the tables — Cinder wins. Verified at the edge by dispatching mousemove over a loot line (🥫 Food, 🔫 Ammo) and over a titled element (title parked, bubble shown, title restored).

## v121v114 — shipped 2026-09-11, full-gated, edge-verified (Grant Passive effect; Spell counters; the semi done right)

Owner (with two screenshots — the field-ability editor with a "Ualit Counters" cost, and a crumpled white truck facing backwards): "Make an effect type where when X happens they can grant a passive for X turns or permanently — e.g. when this unit is sent to the graveyard give all units, fusions, archons called this turn the passive Speed until the end of the turn. Also Spell counters is not working. The truck is facing the wrong way… increase the res of the truck; it should look like this [only] if it is wrecked."
- **🧬 Grant Passive (effect id `grantPassive`, Buffs & Debuffs).** Every effect section (on-play, grave ability, on-grave trigger, field ability, hand ability, Kalon on-x chain) gets the same box: the passive (from PASSIVES, grouped by category), who gets it (this unit / all your units / all enemy units / every unit / your units, fusions and archons called this turn / your fusions and archons called this turn) and turns (0 = permanent, 1 = until the end of this turn, N = for N of your turns). A grant is a `statusEffects` entry `{ type: 'grantPassive', passiveId, turns, eot }` that `hasPassive` reads exactly like a printed passive (still nothing while field-negated); permanent grants go onto `unit.passives`. "Called this turn" = not on the board when the turn began (`state._idsAtTurnStart`, stamped in `startTurn`), never the hero. Units called LATER in the turn get it too: the grant is remembered on `App._battleTurnGrants` for the rest of that side's turn, applied in `applyOnPlayEffect`, and consulted by both summoning-sickness checks so a granted Speed really lets the unit act. End-of-turn hooks (`endPlayerTurn` / `endAITurn`) drop the until-end-of-turn grants and the pending turn grants of that side. Gate tokens `grantPassive` / `counterName` so the knobs hide for every other effect; the forge id suites' self-describing counts moved (380/460, 140 literal reads, `ed-kalon-onx-gturns` in BLIND_SPOTS, harness truth 88) — the checks, not the baselines.
- **🔵 Spell counters.** Three real mismatches: (1) "Add Counters" placed the SOURCE card's own token (or `charge` when it had none), so a card that had not enabled a token could never put "Spell Counters" on anything a field ability could spend — Add / Remove Counters now take a Counter name (`counterName`) and place that pile; (2) the two editor save sites, the field-ability cost and the module slugged independently and nobody singularised, so "Spell Counters" ≠ "Spell Counter" — one `_ctrSlug` (lower-case, letters and digits, trailing plural s dropped, -ss kept) on every side, `MythicCounters.slug` in the module, and the cost re-slugs its NAME on every read so old cards meet in one pile; (3) `_fieldcounter_smoke` lifts the slug now. Not touched: a `from: self` cost still reads one unit's pile (a counter on a location needs `pool`), and turn-end grants still come from units only.
- **🚛 The truck.** What the screenshot showed was a lot row from before `rigId` existed: with no catalogue row, v111's `_haulModelOf` fell to the admin's box-truck render, `haulAutoOrient` put its (taller) box at the nose, and the 9k-tri pack read as a wreck. Now `_haulModelOf` falls to the CLASS model (any catalogue rig of the row's cargo class with a model — the semi for freight) before a row upload; the semi is repacked at 45k tris / 2048px WebP (2.3 MB, from 12k / 0.84 MB); and `FREIGHT_MODEL.wrecked` is a 1.1k-tri sloppy pack of the same master that a Wrecked or Salvage rig drives, paint dimmed to 55 % — crumpled on purpose, clean otherwise. Containers repacked at 14k tris / 1024px. `_semi_smoke` / `_signals_smoke` pins moved with the rules.
- Suite: `_grantpassive_smoke.mjs` (50) runs the grant helpers, the scopes, the pending turn grants, the end-of-turn expiry and the counter module for real. Six knobs → v121v114-grant (effects.js buster too).

## v121v115 — shipped 2026-09-11, full-gated, edge-verified (lobby numbers off the Play Online tile)

Owner (with the tile screenshot "3 online · 0 searching / 3 ONLINE"): "Do not show how many players are online and searching on the Play Online post, never, for players — move the online count and searching to the User Management tab."
- **The tile.** `btn-play-online` said "🟢 N online · 🔍 M searching" with a "N online" badge and a queue pulse — all three already admin-gated, which is why the owner (an admin) still saw them. Now the tile carries only "Find a real opponent · ranked" (or "Sign in to face real players"), `badge: null`, `alertBadge: false` — for everyone. The matchmaking screen's own live stats were already admin-only and are untouched.
- **User Management.** `_umLobbyLine()` paints "🌐 Lobby right now: 🟢 N online · 🔍 M searching for a match" under the account line (presence count from the lobby channel and the matchmaking queue, both kept fresh by `joinLobbyPresence()`), and `_umLobbyWatch()` subscribes once via `onLobbyPresence` to re-paint that one line in place on every tick.
- Suite: `_lobby_smoke.mjs` (11) pins the tile to no counts / no badge / no pulse and runs the line for real. Knobs → v121v115-lobby.

## v121v116 — shipped 2026-09-11, full-gated, edge-verified (the Athena Engine merge: build A + build B)

Owner: "Update and merge this Athena Update" with `ATHENA_MERGE_HANDOFF.md`. Two Athena builds existed — A (repository `main` at `12297093`, rounds 5–18) and B (this checkout: FILES/MENU tabs, world_assets uploads, ⚒ pill, menu worlds, sessions, the player character). Common ancestor `eddeb0d093`. Build B was pushed as-is to `origin/athena/files-menu`; the merge was done on `athena/merge` from this tree, taking every module of A that B never touched, three-way merging the ten both changed (`mapforge.editor/world/engine/format/props/css/index`, the docs), renaming B's `mapforge.assets.js` (uploads API) to `mapforge.files.js` because A's asset-browser index owns that name, porting A's index.html hunks (MythicBridge slots/files/battle/ui, Forge.cityModels catalogue + hydrate, `__mythicCityModels`, the battle-board overlay + bmIndex, the admin buttons, the widgets/battle script tags) and A's node-city model-slot hook, and inlining A's farm adapter/overlay into B's farm bundle (`FarmAthena`) because the bundle may import nothing. Dropped, not silently: `MythicBridge.battle.openLegacyEditor` — this build retired the legacy Battlemap Forge (`_noboard3d`). `docs/athena-engine.md` → "Merge round" carries the full account; `CLAUDE.md` gained the Athena block.
- **Database.** `world_maps` (B's 091/092), `world_assets` (112), `ui_widgets` (040), the farm auction/ranch tables (038) were already live; A's 041 (`ui_widgets.kind` allows `page`) applied through the MCP as `athena_041_ui_pages_kind`.
- **Tests.** All nineteen harness suites plus the fallback green on this machine (`tools/athena-harness/serve.mjs` in place of the python server — the volume takes no symlinks; `PLAYWRIGHT_PKG` points at the repo's playwright; `beep.wav` generated for the audio suite; suite path handling fixed for Windows). New `pw-test19.mjs` covers the FILES panel, the MENU tab and the merged Scene tab. The game's own gates: fast + full green (`_athena_smoke` re-pointed at `mapforge.files.js`; farm buster pins relaxed to the v121v1xx series; forge-id counts moved with the layout).
- Busters: mapforge `mf18`, widgets `aw5`, battle `ba2`, farm `v121v116farm4`; six knobs → v121v116-athena.

## v121v117 — shipped 2026-09-11, full-gated, edge-verified (the ring includes linked nodes; the Foundry; the Node Inventory)

Owner approved two triaged reports and asked for one feature, with `FOUNDRY_HANDOFF.md`:

| Report | Verdict |
|---|---|
| `bug-mtwtxvg8` (Sausage, high) PRN nodes not spawning in city | FIXED. The 2026-09-10 rule rang a city only with nodes whose `owner_id` is the viewer; a corporation member whose licences the founder holds owns none by that column (Sausage: 0 owned, 12 `city_node_links` rows). A city_node_links row is the player's deliberate "this node is synced to my city", so the parent now hands those rows over (`window.cityLinkedNodes`: links → `economy_nodes`) and node-city rings the owner's licensed nodes PLUS the linked ones, deduped. A node obtained through the Foundation Reserve is placeable again. |
| `bug-mtwsvrtq` (Grimalkin Lord, high) "Post a Scrap Run" opens the Haulage Board, not a Trash Crusher mini-game | FIXED with the owner's file: the Trash Crusher's mini-game is **the Foundry** — the recycling plant from branch `claude/epic-heisenberg-64ym25` (15 machines, 34 materials, 22 recipes, 9 modules under `src/foundry/`, `_foundrysim.mjs` 34/34). Ported whole: the bridge (`MythicFoundryBridge`, placed before the mercenary bridge so that suite's segment stays clean), `__foundry__` / `foundry` on the cloud whitelists, the newest-save reconcile, `openFoundry()` + offline catch-up, the camp building (moved to x8-11 / y8-10, door 10,11 — the branch's x8-11 / y10-12 sat on Vex the Scout). The corp sidebar row is now two doors: 🗜️ Trash Crusher → the Foundry, 🚛 Post a Scrap Run → the Haulage Board (`openfour` pins moved with the rule). |

- **📦 Node Inventory.** Every node owner's node modal has a NODE INVENTORY section after Node Power: the node's resource fills on the wall clock at 10/h × a multiplier that climbs from ×1 to ×1.5 as the node's tier (meta.level, the level the city syncs up), its Node Power level (1–10) and its city's level (city_state.cityXp through the city builder's own curve, 1–25) climb — each a third. The shelf holds 48 h. Collect calls `node_inventory_claim` (sql/132, applied) which checks the owner, returns the hours since `meta.invAt` and stamps now (two devices cannot bank the same hours); the client turns hours into units and banks them through `addRes()`. Assumption stated to the owner: one combined bonus up to ×1.5, not ×1.5 per factor.
- Suite: `_nodeinv_smoke.mjs` (34) runs the multiplier and yield maths; `_foundrysim.mjs` registered (plain-text PASS lines). `_ownerlist` pin moved with the ring rule. Knobs → v121v117-foundry (`src/foundry/index.js?v=v121v117foundry5`).

## v121v118 — shipped 2026-09-11, full-gated, edge-verified (the reopened trio: Clinic, Rations, Planks — and planks as a build cost)

Owner: "The following defects failed retest… These are not fixed. Add the plank resource to certain buildings and they should be used to build buildings in the Feed business and some buildings in the city builder as well as the Camp."

| Report | Verdict |
|---|---|
| `bug-mtuadu79` (Grimalkin Lord, high, reopened ×2) the Clinic consumes more remedies than it creates | FIXED at the root this time. The output was scaled by city conditions and the dispensing draw was not, so below ~67 % conditions the shelf drained (the design note said "coverage must not amplify a slump" — the owner overruled it). `svcWantFor(def, s, mult, omRes, dtMin)`: a building that makes the very good it dispenses draws AT MOST what it prepared this tick, at the same conditions multiplier. Kitchens (which only dispense) are unchanged. The "cannery" wording was already gone since v121v108. |
| `bug-mtw1qg89` / `bug-mtw1jo7k` (Grimalkin Lord, med, reopened) Rations / Planks show ZERO in the Ops Vault, the Market and the Reserve with 4,000 "in the stash" | FIXED for real: the 4,000 were CITY stock (the city builder's shelf), and those screens read the player's stash; the v121v105 Send button moved them by hand and nobody found it. `autoStashTick` in node-city's economy tick now moves the SURPLUS of every stashable good (rations, planks, remedies) into the stash every five minutes by itself, keeping two hours of the city's own draw plus a 20-unit floor on the shelf (kitchens and the Clinic never run dry because of it); a full stash declines and the move is retried by halves; the player is told what moved. The phone leaderboard counts city stock, so a city that ships its planks ranks lower there — by design. |

- **🪚 Planks as a build cost.** City builder: thirteen buildings (Housing 4 → High-Rise 200; Barracks, Watchtower, City Gate, Player Shop, Office Block, Retail Parade, Club, Duel Arena). Homestead Farm (the feed business): the Feed Mill, the four pens and the Farm Kitchen from level 2 (40 / 100 at the Mill). Camp: the Resistance Ring, Training Center, Proving Ground, Black Market and Morale Lounge from level 2. All three pay from the ledger through the existing cost paths, which is exactly where the auto-stash now puts the planks the Sawmill mills.
- Suite: `_stockflow_smoke.mjs` (24) runs svcWantFor, the reserve maths and the whole auto-stash (including the halving retry) for real; `_farmfeed` pin moved with the costs; the auto-stash call sits just above the demand snapshot (`_batch1` pin). Knobs → v121v118-planks (`src/farm/index.js?v=v121v118farm5`).

## v121v119 — shipped 2026-09-11, full-gated, edge-verified (Athena renames; market-style candles)

Owner (with a model card labelled "[object Promise]", the rename modal showing the same, and a real broker chart beside ours): "Renaming 3D models in Athena Engine is not working. I want our stock candles to look like the actual stock market candles — ours are huge and big."
- **Renames.** The game replaces `window.prompt` with its themed "Enter a value" modal (`gcPrompt` → a Promise); build A's editor called `window.prompt(...)` synchronously and stored the Promise as the name. `askText(msg, def)` awaits whichever prompt is installed and is used at every name prompt: library / model / sound / prefab / cloud-file rename, F2 on an object, prefab rename, relink-a-model, the content browser's URL door, the custom mini-game id; the widget designer's new-variable prompt likewise. Harness suites 5, 6, 12, 17, 19 rerun green (the harness has a plain synchronous prompt, which askText passes through).
- **Candles.** `CX_CANDLES_PER_RANGE` is 60 / 72 / 96 / 84 / 120 / 120 buckets (1 min, 5 min, 15 min, 2 h, 6 h, and ALL) instead of 12–40; a bucket with no tick is carried forward as a doji at the last close (marked `quiet`) so the chart stays continuous; every candle gets one slot (the slot count floors at 24) and a body at most 9 units wide, right-aligned against a five-rung price axis on the right, with time labels along the bottom and the last price tagged on the axis with a dashed line. The hover tooltip (v121v109) is unchanged.
- Suite: `_prompts_smoke.mjs` (24) runs askText, the bucketing and the SVG for real; `_candles_smoke` count pin moved. Busters: mapforge `mf19`, widgets `aw6`; knobs → v121v119-candles2.

## v121v120 — shipped 2026-09-11, full-gated, edge-verified (the haul rig faces forward at full resolution; blinkers; traffic)

Owner (with a phone screenshot of a crumpled white truck showing its grille to the chase camera): "This is still not fixed where the truck still backwards and the things I asked to be fixed are not done on the haul. Like fix the resolution of the truck."
- **What the truck was.** Not the semi. The owner's rig is a Bulk Feeder: index.html stamps every bought rig `cargoClass: base.cargoClass === 'oil' ? 'oil' : 'freight'`, so a feed rig lands on the freight haul board and `_haulModelOf` hands the run its catalogue model, `feed_truck.glb` (the HidnEx box truck). Its box stands taller than its cab, and v111's `haulAutoOrient` ("the tall end is the cab") put the box at the nose — tail-first since v111. The semi itself was always right (verified in a headless render of the real module). The stamping is left as is (a separate decision: fixing it would move feed rigs off the freight board).
- **Orientation.** `HAUL_KNOWN_ROT` records the nose of every truck file the game ships (all long along X with the cab at −X → 90°, checked by eye in `tools/athena-harness/pw-truckview.mjs`). An upload is measured by its roofline instead of its tallest end: a step a short way in (back of the cab against a deck, or the cab/box gap) plus a ramp at the tip (bonnet below the roof, read as a median so a tow hitch cannot pass for one), sampled along triangle edges (vertex-only sampling read decimated roofs as dips). `pw-orient.mjs` runs it on the four real trucks each lying four ways round: 16/16 with no filename help.
- **Resolution.** The run's material is now MeshStandard with the scan's normal map (Lambert discarded it — the smudged look) and the renderer's anisotropy on both textures; metalness 0. `feed_truck.glb` and `livestock_truck.glb` repacked from `assets-source/glb-masters/trucks/` at 45k tris / 2048px (were 14k–26k / 1024px). A Wrecked or Salvage rig drives the same file with paint dimmed; `FREIGHT_MODEL.wrecked` is gone (the 1.1k-tri pack rendered as a handful of triangles; the bridge never passed `condition`, so it had not been reachable in the game anyway).
- **Blinkers.** The rig's four blinkers move onto the fitted model's corners (they sat at the old box rig's corners, inside a 15 m truck). Driven in the harness: steer left lights the screen-left pair, right the screen-right pair, on the semi, the feed truck and a wrecked livestock truck.
- **Traffic.** Boxes and paints are shared and despawned cars are pooled (every car used to allocate its own geometry and material and was dropped with its GPU buffers held). Cars enter at 85 % of the fog distance (they popped in 140 m ahead in clear weather), the window scales with the sight line, the first tick seeds the visible road, and below 20 m/s half the new cars come up from behind the camera faster than the rig (a slow rig used to watch the road empty). The shared paint block sits above the hazard setup (a breakdown hazard builds a car before makeCar's section). 90 s and 30 s drives held 10–13 cars with 6–11 within 300 m ahead.
- The haul module buster had sat at `v121v111haul4` since v111; it is `v121v120haul5` now. Harness: `haul.html` + `pw-haul.mjs [cond] [secs] [modelUrl]` (set MSYS_NO_PATHCONV=1 in Git Bash), `window.__HAUL_DEBUG` read-only handle in the run (off unless a page sets it), serve.mjs maps `/models/trucks/`.
- Suite: `_haulrig_smoke.mjs` (30) runs the orient step on a flatbed, a box truck with a hitch and a bonnet-cab tanker, four ways round each, plus the roofline score. `_semi_smoke` / `_signals_smoke` pins moved with the rule. Knobs → v121v120-haulrig.

## v121v121 - shipped 2026-09-11, full-gated, edge-verified (the exchange trades like a desk; player corporations; the Crash Herald)

Owner: "Remove this and I do not think we need this. We are just buying shares of the resources and companies. Make the crash exchange run like a real stock market, tracking data on the sells and buys all across the game and the world events that can affect the market. In OPERATIONS put all of the players corperations and allow players to buy shares... give their weekly treseary reports and judge by if they have add more resources, cinder and aza coin... Like a fake news site that keeps track of everything on the crash market and the player economy. A fix that need to be fixed is when buying stock the price of stock is charging more than what it is being bought for."
- **The overcharge, and its cause.** A buy was priced from the mark AFTER its own impact, multiplied by slippage against a reserve pool, then by a 4% spread, while the TOTAL box beside it quoted the tile price plus the 0.4% fee - about +17% on ten units, and a typed price could not lower it (Math.max against the post-impact mark). The Foundation Reserve model is gone from the trade path and the screen. A fill is now the geometric mean of the price before and after the order (the average price it walks through), quoted by the same function that charges it and requoted as the size changes. Measured: ten units of a 100 CR staple cost 117.41 then, 106.15 now; an instant round trip returns the fees and leaves the price where it started, which is what the spread was there to guarantee.
- **The tape.** Every price writer in the game (shop, craft, node yield, haul delivery, production, world event, desk order) records id, direction, size, price and SOURCE to one capped record. The asset panel shows 24h flow - bought, sold, net, and which parts of the game did it - where the reserve depth bar used to be.
- **OPERATIONS = player corporations.** sql/133_corp_market.sql: corp_market_list() is SECURITY DEFINER and publishes AGGREGATES ONLY (balance, balance a week ago, week inflow/outflow, vault units and kinds, members, live ops, float) because corp_treasury and corp_vault are members-only under sql/046 - a rival reads the published figures, never the books. corp_shares holds the float server-side with own-row RLS; corp_share_trade() owns the share leg and refuses a sale of shares nobody holds; the cinder leg stays the client wallet, as it is for every other CX trade. A share is priced off the book: cinder + units x 12 + members x 1500 + ops x 2500, over 10,000 shares, times a float premium capped at +75%. The weekly report prints the treasury, the change, inflow and outflow, and rates it STRONG BUY / BUY / HOLD / SELL / STRONG SELL with the reason beside the word.
- **THE CRASH HERALD** (third tab): stories written from the tape (movers, with the desks that moved them), the corporation register (who banked and who burned), the world-event log and the day in numbers. It says on the page that nothing in it is invented.
- Suite: `_cxdesk_smoke.mjs` (30) runs the fill maths, the round trip and the corporation pricing for real - against the live register's own numbers (Clarey Nexus 19.6M -> 1,997.35 a share, HOLD on a 4% dip). `_phonecx_smoke` pin moved to the new quote. Knobs -> v121v121-desk.

## v121v122 - shipped 2026-09-11, full-gated, edge-verified (the Player Closet; cards not released yet; dated sets)

Owner: "Add a cannot be not released yet button in here which will stop players from gaining access to cards that have not been released yet. Allow for me to create packs in the pack opening forge. Where I can make not releaed sets that will release on the date that is set and added to the Vendor market." Plus the two handoffs (BRUCE_IN_ATHENA, PLAYER_CLOSET).
- **The gate.** A fourth pill on the card row. While it is on - or the card belongs to a set whose date is ahead - no player obtains the card by ANY route: grantCard (the file's own "one door a card enters a collection through") refuses it, playerObtainablePool drops it, and getCardPoolForPacks, the shared pack / body-loot / dilemma pool that consulted NOTHING about obtainability, now consults it. Copies already owned are untouched on purpose: pulling a card out of a deck somebody built is worse than the leak it closes.
- **Sets.** A Forge tab: name, icon, the cards, the pack that carries them, and a release instant picked in local time. Before it, its cards cannot be obtained and its pack is off the vendor shelf; at it, both go live on every device with nothing to run - the check is a comparison against the clock, like the coupon expiry already shipped. (tier_drops, the pg_cron path, is not versioned in this repo at all: the client writes a table whose DDL is only in the live database.) "Release now" is there when the date is not wanted.
- **Player Closet** cherry-picked from claude/character-creator-clothing-y2lat6 - three commits, not the sixty under them. 11 modules, the outfit worn wherever Athena draws the player, a fit stored as RATIOS of a measured body part so one record fits every character. sql/134 applied (renumbered - 132 here is Node Inventory). Profile.closet is in all three whitelists.
- Two suite pins moved to follow code the closet extended, not to hide a break: a peer is rebuilt on a change of character OR outfit; the avatar is dressed on the way into createAvatar. **Every file the merge touched was re-normalised to LF** - git checked them out CRLF and my patch then converted the whole page, which broke ten suites that match across line breaks. Nothing was wrong with the code.
- Suite: `_release_smoke.mjs` (40), the release maths run for real. Knobs -> v121v122-closet.

## v121v123 - shipped 2026-09-11, full-gated, edge-verified (the Custom Audio Manager)

Owner: "I just changed the music to the main menu it have not changed and I want a save and update button... Also show me all of the old music and files incase I want to delete them. Also add a shuffle feature... Add a Just business, City builder, audio. Change the name from pricing Admin to Admin Controls."
- **Why it did nothing, and it was not a cache.** `playMenuMusic` tested the playlist with `length > 1`, so a zone holding EXACTLY ONE uploaded track fell through to the else branch and hard-set the built-in Settings theme: upload one track, tick "only mine", and the upload could never play. Without "only mine" the pool was two, shuffled, and started on the built-in about half the time. Menu and Camp now bind whenever the pool holds anything (Camp had the same `> 1` gate but its else used the pool, so it worked - mainMenu was the only zone with the defect).
- **It takes hold now.** A changed playlist starts playing instead of waiting for the current track to end, and 💾 Save & apply writes everything, clears the one-element "what is loaded" caches (`_menuAudioSrc`, every element's `_msSig`) and re-asks the router.
- **📁 Stored Audio.** Every clip on the device with its size, including ORPHANS - deleting a track blanked its record (`idbSet(key, "")`, never a delete) and left the bytes behind, and `forge_customMusic_idx` was written but never read back, so the space was unreclaimable and invisible. Each row plays and deletes, and deleting a track removes it from its zone too.
- **Shuffle is a switch** per zone, not a side effect of owning two tracks; the header says "shuffles" or "in order", and flipping it re-picks immediately.
- **Two silent rooms.** Just Business (a real screen) and the City Builder (an overlay that never changes App.screen, so _openNodeCity / _closeNodeCity call the router by hand). Neither child document owns any audio, so the element stays in the parent - no cross-frame plumbing. Both ship with no built-in track and stay silent until something is uploaded.
- **Admin Controls**: the tile, the heading, both back buttons and the admin-gate toast. The screen id `pricingAdmin` and the tile id `btn-pricing-admin` are untouched - 13 places route on the id, mapforge.pill.js hides itself on it, and the tile id keys the uploaded tile art.
- Suite: `_audiozones_smoke.mjs` (26), the ordering run for real. Knobs -> v121v123-audio.

## v121v127 — the Just Business collect exploit, and the blade that glows
Deployed 2026-09-12, edge-verified (v121v127, `_opClaimCollect` present, glow rule present).
Full gate: 127 suites, all at or below baseline.

**bug-mtxzznni (high, live) — "Just collecting wages from just business and it would
not stop coming up… I amassed a ton of food, metal and other resources."**
A collect pays a pure function of `now − meta.lastCollect`, capped at 36 h. Nothing is
spent and no counter decrements, so that one timestamp is the ONLY thing that ends the
accrual. Three failures compounded:
1. The client admits founder / owner / CEO / Corp CEO as an officer; the
   `corp_operations` UPDATE policy admitted the FOUNDER only — and PostgREST answers a
   row filtered out by a `USING` clause with **204 and no error**, so the throw never
   fired, `o.meta` was set in memory only, and the very next `opFetch()` re-read the
   stale row and offered the full 36 hours again. Forever.
2. The payout came FIRST and the marker was written after, so a refused write cost the
   game everything and recorded nothing.
3. No in-flight lock on a settle that is five to seven round trips long with the button
   still enabled, so click-spam paid the same accrual several times even for a founder.

Fixed: the policy now matches the client's roles (applied live); the collection is
CLAIMED before a single resource moves and the row is demanded back (`.select('id')`) so
a refusal is loud; a per-operation lock covers the in-flight window; and the Just
Business `postMessage` handler takes messages from its own origin only (it checked the
message *type* and nothing else). No player data was altered — that is the owner's call.

**The Abra Blade glows.** The pointer was reverting to the system hand over anything
clickable. There are 863 `cursor:pointer` declarations in index.html, many of them inline
styles that beat any stylesheet rule, so the fix is `!important` plus a
`[style*="cursor:pointer"]` selector, pointing at a purple-aura variant of the blade.
Verified in-browser: plain → blade, button → glow, inline-pointer → glow, text box → I-beam.

## v121v128 — three new card effects, the assault-prompt cost bug, spell counters (fourth report), victory & defeat music, six tracker reports

### The three card effects the owner asked for

**🔇 Suppression Aura** — "While this unit is on the field enemy players cannot
use spells, or activate units passive, or on play abilities." It is CONTINUOUS,
so it is never resolved: the engine asks the board. `_battleIsLocked(state,
side, cat)` is already the single choke point every spell / deploy / counter
path on both sides reads, so teaching it a second source of truth locks spells
everywhere at once with no new call sites. The two categories it did not have —
activating a unit's ability, and an on-play firing — were added at the three
functions that own them (`_canUseFieldAbility`, the AI's field-ability loop, and
`applyOnPlayEffect`). It is a LIVE BOARD READ, deliberately, not a status
stamped on the enemy's cards: the aura has to end the instant the unit leaves
the field, and a stamped status outlives its source. Memoised on the units array
by identity, so asking it on every effect resolution costs nothing.

**⚰️ Banish Unless Called From Hand** — needed a fact no unit had ever recorded:
where it came from. The two paths that ARE a hand play stamp `_fromHand`; the
other seven `buildUnit` callers (summon, raise, token, tunnel emergence, mutate)
leave it unset, which is precisely the card's condition. Swept at the end of its
owner's turn, after the turnEnd triggers so a card can answer before it goes.

**💥 Punish Arrivals** — hangs off the arrival event the engine already fires
from both hand-deploy paths, plus `_fireAnywhereForSummons`, the choke point
every effect-spawned unit passes — rather than a ninth hand-rolled hook. The
weakness bonus reads the same `MATCHUPS` / `getFactionMatchup` tables the damage
formula does, so "weak to" means on the card what it means in combat.

### The assault-prompt cost bug (owner)
"You pay the cost — for example you pay 50 health — then the modal appears to
play an assault card from your hand, you click skip and the spell does not play
even though you paid the cost."

`_interceptCardCost` pays the cost, sets `App._cardCostPaid`, re-enters
`playSpell`, and clears the receipt in a `finally`. But that re-entry does not
RESOLVE the spell when an assault card is in hand — it parks the play on
`App.ui.assaultPrompt` and returns immediately, waiting for a click. The
`finally` then wiped the receipt, so Skip re-entered with no receipt and
`_interceptCardCost` charged the cost a SECOND time; a hero that had just paid 50
life could not pay 50 more, the gate refused, and the spell never fired with the
life already gone. The receipt now survives a SUSPENDED play and is torn up by
whichever hand finishes it.

### Spell counters — the FOURTH report, and the bug standing behind the third
The owner's card, read out of the live catalog, settles what is authored:
`Ualti Spirit — counterToken {id:'ualticounter', name:'Ualti Counters', max:4},
onPlay {type:'addCounters', amount:2, counterName:'', radius:1,
counterSide:null, tSide:'enemy'}`. So v121v125 IS working: `counterSide` null
reads as 'self' and the token resolves off the card. The counters still never
arrived because the line that picks the recipient tested OBJECT IDENTITY:

    if (_side === 'self' && u !== unit) return;

`state.units` is rebuilt by half a dozen steps between a card being played and
its on-play resolving — the multiplayer on-play stamp remaps the whole array,
so does the infection zone, so can the weather summoner and the in-grave tick.
Each hands the board a COPY of the caster while `unit` still points at the
original, after which "itself" matched nothing and the log said "finds nothing
to put Ualti Counters on". Nothing else in this file tests a unit by object;
the engine compares ids, for exactly this reason. Also fixed alongside it: a
caster that is not on the board at all (a hand / grave / field ability resolves
through a hero-anchored synthetic) now gets its own counters, "self" no longer
demands a position, and the range test for OTHERS is the hex `distance()` rather
than Chebyshev, which on an odd row reaches non-neighbours and misses neighbours.

### Victory and defeat music (owner)
Victory had a loop and an Audio Manager slot. DEFEAT had neither — losing
dropped straight into silence, because `isVictoryActive()` is false the moment
the loser is you and the battle track is stopped by the same sync pass that
would have started the victory one. `assets/Audio/defeat music.mp3` has been in
the build all along, referenced by nothing. Defeat is now victory's exact mirror
— its own element, its own playlist slot in the Audio Manager, its own
`isDefeatActive()` — with one deliberate asymmetry: `stopVictoryMusic()` stops
BOTH, because it is called from fourteen places and every one of them means the
player has left the end-of-match moment.

### Six tracker reports
- **bug-mtxqh027** — Reconstruction's back button was the last one in the camp
  still naming a screen instead of asking `_campBackTarget()`. 'camp' is the
  BUNKER; 'campOps' is the camp page.
- **bug-mtxmvepn** — every deploy calls `render()`, which rebuilds the camp from
  a template string, so the two `.dpx-scroll` panes come back as new elements at
  zero. Remembered per pane AND per tab.
- **bug-mtxmdmq1** — `roadCapParts()` counted a Supply Depot as one building
  however tall it was. Housing is `popCap * t.lvl`, the barracks garrison is
  `garrison * t.lvl`, production is `RATE_MULT ** (t.lvl - 1)` — this line was
  the odd one out, so three upgrades bought no road.
- **bug-mtxkunre** — a new city starts with `stock: {}` and cannot make a plank
  until it has power, a Logging Camp and a Sawmill, each needing crew that needs
  housing. The BASIC house pays no planks; the sink stays on the Apartment (16),
  Block (40), Tower (90) and High-Rise (200).
- **bug-mtxl7z60** (high) — `planCost` summed `c.cinder` and threw the rest of
  `costOf` away, so the Develop button priced a district in 🔥 alone while the
  plan also needed metal, supplies and planks. Approving it stalled development
  one silent permit at a time, because each site pays as it STARTS. The panel
  now prints the full materials bill in the city's own cost chips.
- **bug-mtxq7yoy** — the "vault full" throttle is real, but the row asserted
  something the player cannot check: the ceiling counts the WHOLE Base Vault
  (every id in Profile.salvage) while the city's strip shows the twelve-id
  mirror. Both numbers were already read and discarded; the row names them now.
- **bug-mtxlmhvr** — "ometimes" in the Tutor Shop guide. Authored content, fixed
  in the catalog rather than in code.

## v121v129 — card art for cards that are played; spell counters land in the pile the card spends from

### 🎴 Card art in the battle log (owner, with a screenshot of a log that is all text)
v121v126 built the row that can draw it — `_bcLogRow` resolves the art at RENDER
time from `l.cardId`, falls back to the card frame, and suppresses it entirely
for a face-down card. What it never got was the ID: the five places that
announce a card being PLAYED all pushed a bare `{ msg, color }`, the oldest
shape in the file and the one thing the renderer cannot draw. So a whole match
of deploys scrolled past as sentences while the activations that followed them
showed their art. All five now carry the id the caller was already holding — a
unit you play, a unit the AI plays, the one it drops as an interception, an
opponent's unit arriving over the socket (`originalCardId`, not the battle
instance), and a spell the enemy casts. Each keeps its `msg` and `color`
exactly, so the filter chips, the relay and the replay snapshots are untouched.
🃏 A Subterfuge SET carries the id with `hidden: true` — the same redaction the
on-screen flourish uses, so a face-down play does not leak its art.

### 🔵 Spell counters — the FOURTH report, and a THIRD distinct cause
"I just summoned this archon who gets spell counters, it has the on play gain
spellcounters but still it has no spell counters when entered play" — the
ability row reading "Needs 2 🔵 Krystal Flutters · it holds 0".

Krystal Anomaly Opal Butterfly, read out of the live catalog:

    counterToken : null                                  ← the token block is OFF
    onPlay       : { type:'addCounters', amount:2, counterName:'' }
    fieldActive  : { counters: { n:2, id:'krystalflutter',
                                 name:'Krystal Flutter' } }

The card names its counter in exactly ONE place — the cost of the ability that
spends it — and the two halves of the engine resolved that name completely
differently. SPENDING (`_fieldAbilityCounterCost`) re-slugs `fc.name` and reads
the pile `krystalflutter`. PLACING tried `eff.counterName` (blank), the card's
own `counterToken` (absent), the effect's token (absent), and fell through to
`DEFAULT_TOKEN`, filling a pile called `charge`. Two piles, one card: the
counters really were placed, and logged, into somewhere nothing on that card
can see.

This is not an authoring mistake. The effect's counter-name box is blank by
default, the card's token block is optional and off by default, and the
ability's cost carries its own id and name — so authoring the card the obvious
way produces this every time, which is why the same symptom has now been
reported four times across three cards with three different causes underneath
(v125: the recipient side read the damage dropdown; v128: the recipient was
matched by object identity across a rebuilt units array; v129: this).

Fixed by adding one step to the token chain: when the effect names no counter
and the card carries no token of its own, use the counter the CARD'S OWN
ABILITIES SPEND — `_cardCounterDecl` reads `fieldActive` / `graveActive` /
`handActive` / `triggers[]` counter costs off the card definition and slugs the
NAME first, exactly as the spend side does, so the pile filled is byte-for-byte
the pile that ability reads. Precedence where the author was explicit is
unchanged: a name typed on the effect still wins over everything, and a card
with its own token block still uses it. The ability cost is a fallback, never an
override, and a card declaring no counter anywhere still falls to the default.

## v121v130 — the resource duplication exploit

Found by investigating an account the owner flagged for farming.

**THE BUG**, in one line of the profile hydration:

    for (const k in _cl) { const cv = _cl[k]|0, lv = _loc[k]|0; if (cv > lv) _loc[k] = cv; }

`Profile.salvage` was merged from the cloud row by taking the LARGER of the two
numbers per resource id, on every hydration. A spend can only ever make the
local number SMALLER — `spendResources()` decrements the client mirror alone,
and the server ledger (`user_resources`) is only ever topped UP by
`wh_resync_resources`. So any hydration whose snapshot predated a spend put the
resources straight back, and hydration happens on reload, on resume, on a second
device and on the periodic fetch. Resources could go up and could never come
down. `_whSeedLedger`'s own comment asserts the opposite — "a send deducts both,
so the client can only ever run AHEAD by what the city produced" — and it is
simply not true of any client-side spend.

**THE EVIDENCE.** The flagged profile blob held 57,046 fuel · 56,822 food ·
14,956 weaponParts · 7,350 metal against a stash ceiling of 2,000 + 250 per
bought vault row that `addRes()` clamps every gain at, while `user_resources`
for the same account held 227 fuel · 1,840 food · 0 weaponParts · 257 metal.
1,515 "Delivery paid" credits landed on 11–12 Sep — 1,092 inside a single hour,
90–500 ms apart — each supposedly SPENDING resources, and not one row of
`user_resources` moved after 10 Sep.

**THE FIX.** Salvage now obeys the same freshness rule every other field on that
row already obeys: the newer side is taken WHOLE, including ids where it is
smaller — precisely the spend the ratchet was swallowing. The max-merge survives
only for a cloud row with nothing local behind it, where taking the larger
cannot lose anything.

**THE CASH-OUT.** `_aiDeliver` had no lock and no interval: a 3-run contract was
drainable at 90 ms per press, and each run also raised rep, which raises the
pay. It gets an in-flight lock and a 2.5 s minimum interval, both before the
payout.

**THE BLADE** is 26px (was 40) with the hotspot re-measured on the smaller
render, and `html, body` joined the cursor selector — `*` matches ELEMENTS, so
over a full-bleed background with no child under the pointer it fell through to
the system arrow, which is why it was missing on the main menu.

## v121v131 — the AI trade cap, standing that buys bigger business, and the editor

**THE FAUCET.** The AI-corporation TRADE tab was the loop: `_aiEnterBusiness`
had no cooldown and no cost, each `_aiDeliver` spent the quantity CLIENT-side
and credited the pay SERVER-side while raising rep by 5 (which feeds
`_aiPayMul`, so a spammed contract inflated its own price), and completing the
third run DELETED the contract so the next signature was free. With ~12 corps it
ran in parallel against all of them. Measured on one account: 12,523 deliveries
at a 0.21 s median gap, 97.9% under one second, across 13-hour sittings.
v121v130 throttled `_aiDeliver` alone — 1,440 runs an hour, signature wide open.
Now: **two pieces of business per corporation per rolling 24 hours**, a spot
sale and a delivery both counting, asked at all THREE doors.

**STANDING BUYS THE SIZE OF THE BUSINESS.** It moved the price ±15% and nothing
else — every player got the same 3-run contract whether a corp loved them or
would not spit on them. The tier now sets whether they deal at all (hostile and
blacklisted do not), the contract's runs, the quantity per run, and the daily
slots. Allied: 5 slots, 6-run contracts, 1.6× quantity.

**EVERY VAULT HOLDS WHAT IT SHOULD.** `_stashEnforceCap()` is correct and
complete — and had exactly ONE caller, `renderStash()`. So the ceiling was only
enforced when a player opened that panel, throttled to once per 30 s, and a
vault that went over any other way (the v130 ratchet, `_refundRes`, an admin
grant, an old save) stayed over on every other screen. One account showed
141,598 units against a 31,250 absolute maximum. Enforcement now runs when the
cloud copy lands and again the moment the ceiling becomes vouchable (it refuses
to trim against an unread one, which is why a cold load needs the retry).

**THE WAGE DRAIN** is 12 h instead of 6; `OP_ACCRUAL_CAP_H` stays 36, so
collecting half as often loses nothing and halves how fast a treasury drains.

**PRN NODES IN A CITY THAT OWNS NONE** (MirageSoldier). `city_node_links` has
one writer, sql/105's `city_push_node_boost`, and it records *my city BOOSTS
that node* — a contribution with a pct. The 2026-09-11 change read it as *that
node belongs in my city*. Live: 64 rows across nine-plus players pointed at
nodes they do not own, and NOT ONE was backed by a claim. A city now rings a
node it owns or is the owner's ACTIVE MAYOR of.

**THE EDITOR.** A field ability could charge only energy and counters, so
"sacrifice 3 units, deal 100 damage to everything they control" was unauthorable
— `activationCost` (discard / payLifeHero / banish / tribute / tributeSelf) had
gated moves and on-play effects since it was written and was never wired to the
third activation. The effect filter never typed: it was bound for Escape and ✕
only, with typing left to a delegated listener that cannot reach a picker
outside its host. Passives got their own search (they could never qualify — the
picker test counts ONPLAY_TYPES ids and a passive list has none). Effect VFX can
carry a SOUND, fired independently of the picture through `playSfx` so the admin
override and volume still apply.

**THE RUIN EXCHANGE** plays the main menu music on every page but Just Business,
which keeps its own zone. The hub view already did; walking into a tile changed
it — Black Market Basement on five, Camp music on `vendorMarket` (which sits in
both sets) — so one building had three tracks. ⚠ The 💰 Black Market music slot
is now unrouted.

## v121v132 — bug-mtsq62mg: the NPCs were never allowed to take the jobs

Grimalkin Lord: "Out of Cash — Limited by Business 0% impacting many businesses
throughout the city… I've had buildings stuck on it for days and it results in
the businesses going bankrupt… Nothing James or myself do seems to move the
needle, so I am raising this as a bug as something either hasn't been built yet
or hasn't been plugged in yet." Owner, clarifying: "the businesses are not
making money and the npcs are not going to the businesses for jobs and working
in them like they are supposed to."

**THE DEADLOCK.** `citQualifies()` refuses to seat anyone in an ECONOMIC
building until the economy has banded the tile — correct on its own terms,
because a freshly built Clinic was otherwise crewed by whoever stood nearest and
tenure then locked them in permanently. Its comment says *"the wait is one sync
at most."* That holds only when the economy goes on to band the tile, and
`tileBands()` answers ONLY for a tile carrying a live firm with a headcount band:

    for (const f of Firms.alive()) { if (!f.tileKey) continue;
      const hc = Firms.headcountFor(f); if (hc && hc.band) out[f.tileKey] = hc.band; }

A building the economy never founded a firm on — or founded one without a
`tileKey`, or whose headcount yields no band — is never in that map. It then
fails the test on every 2-second citizen beat FOREVER: never staffed, earns
nothing, reaches zero cash, and is reported as **"Out of cash"** — the symptom,
not the cause. Which is exactly why the advice it printed (go to the bank, add
housing) could never move the needle, and why the reporter's instinct that
something "hasn't been plugged in" was right.

**THE FIX.** The guard stays — an economic building still should not be crewed
before the economy says what the work demands — but the wait now EXPIRES after
30 s (~8 syncs of the 4-second adopt beat). Past it the tile is treated as
unbanded-and-free, which is the same answer `citQualifies` already gives a
school or a barracks. A crew that can be replaced when the band arrives (tenure
only protects a seat that still exists) is far cheaper than a building that can
never open its doors. The stopwatch clears per tile the moment a real band
arrives, so a later rebuild on that key waits afresh.

## v121v133 — enchantments out of any zone, onto the board; the camp back button

**🔮 ENCHANTMENTS ARE SUMMONABLE** (owner): "Enchantments need to be able to be
summoned from the deck, hand, void, or graveyard. As they stay on the field
until destroyed" — and, clarifying, "enchantments get placed on the board like
units do". That clarification picked the design, and it is the simpler one.

🌟 Summon From Zone already reached all four piles with the Card Filter, the id
list, the picker modal and the placement search. The ONLY thing stopping it
carrying an enchantment was the type test — `t === 'unit' || t === 'summon'` —
so the test is widened rather than a parallel effect built. A permanent summoned
this way takes a tile exactly as a unit does, stays until destroyed (which is
what a permanent IS), and projects its auras from its OWN tile, because
`_auraSources` walks every entry in `state.units`. That is a real position,
unlike the hand-cast path's synthetic source anchored on the owner's hero.

The spawned token is marked `isEnchantment` because `buildUnit` carries no card
type onto a unit — and because `_zcCheck`'s "while you control an enchantment"
condition was ALREADY testing board units for exactly that flag. The engine
expected one to be able to stand there; nothing could put one there.

⚠ The cast-from-hand path is deliberately untouched: `playSpell` still pushes
onto `state.enchantments`, so every card authored against it behaves identically.

**🧭 bug-mtxkwv4m** — the camp's back button sat top-RIGHT because
`.forge-header` is `space-between` with two children, so a button in the
right-hand group is pinned right by the LAYOUT rather than by any decision about
that screen. It moves into a left group beside the title; the Cinder pill stays
right. `.forge-header` itself is NOT re-laid-out — it is shared by many screens,
and changing it globally to move one button is how a header regression reaches
pages nobody tested. (I had this filed as blocked on "which screen"; the repro
was in the report and I had not read it carefully enough.)

---

## v121v134 — the acting card's ART, on all three ability surfaces

Owner, pointing at the ⚡ ABILITY ACTIVATED panel: *"It is this black transparent
box line here you can remove this for me"* — and, separately, *"When Heros or
units use their ability show the card art right now it is show the old card
frame and an emoji"*.

**Both sentences are the same bug.** Three surfaces asked one resolver,
`_abilityCardArt`, for the acting card's picture, and it failed far more often
than it should — so each showed its own fallback:

| surface | fallback the player saw |
|---|---|
| the ⚡ panel | `.ab-card` with no `<img>` — `background:#0c0a12` inside a coloured border. **That is the black transparent box.** |
| the activation cinematic | `vfx-cine-card` painted with the frame PNG. **That is the "old card frame".** |
| the battle log | `_abilityFrameUrl` first, then the `.em` **emoji**. |

**Why it failed.** `_abilityCardArt` deliberately refuses any `blob:` URL,
because the art LRU can revoke one. But `_lazyLoadCardArt` stores every streamed
card art as exactly that — `Forge.cardArt[id] = _artBlobToUrl(v)`. So the art the
player was looking at **on the board** was resident, usable, and thrown away.
What was left was the thumbnail tier, which returns `null` on the FIRST ask by
design (`getThumb` kicks an async IDB read and answers null until it lands) — and
the panel is a one-shot DOM node, so "the next render" never comes for it.

**The fix** — one resolver, `_abilityArtBest(cardId, big)`, shared by all three:

1. a stable cloud/data URL first, as before — nothing can revoke it;
2. then the **resident art, `blob:` included**. Reading it LRU-touches the id, so
   it is the newest of 500 and a 14s panel cannot outlive it, and every call site
   already pairs its `<img>` with an `onerror` that hides a failed load. A
   revocable URL that renders beats a frame PNG that is not the card;
3. then the thumbnail tier and the multiplayer visualiser's art;
4. and when nothing is resident it **kicks the forced disk read**, so the next
   paint has it — which is what the constantly-repainting log needs.

`big` picks the order between 2 and 3: the 72px panel row and the log thumbnail
prefer the tiny thumb (no full-res decode for a postage stamp), the full-screen
cinematic does not. Sibling `h_`/`u_` ids are tried, because the Forge files hero
and unit art under them while a battle unit carries only the bare card id.

**And the black box is gone on both paths.** `_abilityCardHtml` emits no box at
all when there is no art and none coming; when a streamed read is still in
flight it emits the box **hidden** and `_abilityArtWatch` polls ~3.6s and reveals
it the moment the art lands. The poll stops dead when the panel closes.

⚠ The frame fallback is **removed** from the log — the owner named it as the
wrong thing to show. The cinematic keeps one only for a card with no art
anywhere, where an empty spotlight would be worse than a card back.

Suite: `_abilityart_smoke.mjs` (runs the resolution order for real, including the
`blob:` that used to be discarded). `_battlelog_smoke.mjs`'s art pin used to
REQUIRE the frame fallback; it now requires its absence, and the claim it was
written to protect — art resolved at render time, never stored on the entry,
because the log is copied into every replay snapshot and sent whole over the
socket — is asserted unchanged.

---

## v121v135 — an enchantment is placed on a tile next to your hero

Owner: *"When playing a Enchantment it should show heighlighted tiles next to
the hero to where it can be placed on the battlefield."*

**It was not merely unhighlighted — it was unplayable from hand.** The
card-detail Play button routes by type and knows four immediate plays: spell,
weather, a whole-board location, and a tunnelling unit. Everything else falls to
the `else`, which arms tile targeting by setting `App.ui.selectedCardId`. An
enchantment landed there, and then:

* the highlight pass built `validPlacement` only for unit / trap / wall /
  location, so **nothing lit up**; and
* `onTileClick`'s type switch had branches for unit / location / trap / wall and
  no other, so **the click did nothing**.

`playSpell`'s enchantment branch — the one that pushes to `state.enchantments` —
is reachable only for `card.type === 'spell'`, so no player route ever got to it.
An enchantment in hand armed a targeting mode with no lit tiles and no exit but
Escape. The highlight and the click therefore gain it **together**: lighting a
tile the click refuses is the same UI-lies-about-the-rules bug in reverse.

**The shape is the one already settled.** v121v133 put a *summoned* enchantment
on a tile as a real token in `state.units` marked `isEnchantment`. The hand play
now makes the same board object, so both routes produce one kind of enchantment
rather than two that behave differently.

**The entry is kept and linked, not replaced.** `state.enchantments` is read by
the aura layer (`_auraSources`), the curse release, the zone condition and the
side-swap; storing the permanent only as a token would silently drop all four.
So the play writes both — the entry as before, plus `pos` and `tokenId`, and a
board token. The link is read in one direction only:

* the aura source takes its position from the **live token**, never from the
  stored `pos`, so the two cannot drift apart; and
* an entry whose token is no longer alive stops projecting, and is swept.

That is what makes *"they stay on the field until destroyed"* true with no
removal hook. `alive:false` is set in about forty places in this file, and a
design that had to be notified at each of them would be broken by the first one
anybody forgot — so **liveness is derived**, not hooked.

The dry run answers before `_gateOnPlayThenPlace` takes any on-play cost, so a
refused play never costs the player a discard first, and it returns before the
negate check and the state write, which both mutate real game state.

⚠ The AI path is untouched — it plays straight into `state.enchantments` with no
pos and no token, and such an entry goes on anchoring on its owner's hero via
the `|| heroPos(eo)` fallback, exactly as before.

Suite: `_enchplace_smoke.mjs` (runs the ring, the tile filter and the liveness
rule for real).

---

## v121v136 — every log row that names a card shows that card, actor ➜ target

Owner: *"I want the card next to every single thing if it mentions them show the
card art and if is a card attacking or targeting another card show the card art
and a arrow to the card it attacked or targeted."*

*(This build also carries the v121v135 enchantment placement above — both shipped
in one deploy.)*

**Why almost no row had art.** `_bcLogArt` draws from `l.cardId`, and only the
handful of PLAY announcements v121v129 touched ever set one. Every other line —
every attack, heal, miss, status, trigger, consume, activation — is pushed as
`{ msg, color }` from one of several **hundred** `log.push` sites across the
engine. Stamping an id at each is hundreds of edits with no way to verify it
stayed complete: the next effect anybody authors adds site 301 with no id, and
the feature silently rots.

**So the card is resolved from the row's own text, at render time, in one place.**
The log already prints card names — that is why the rows are readable — so a
name→card index is built once per open of the log from everything this battle
can mention (board units, both players' hands, decks, graveyards, voids and
banished piles, the enchantments, the location, the weather) and each row's text
is matched against it. One card → its art. Two → actor, arrow, target.

It therefore works **retroactively** on every line already in the log, and on
every line any future effect pushes, without those effects knowing it exists.

⚠ **It cannot leak a hidden card.** The index only ever answers a name the log
itself already printed in words, so nothing becomes visible that was not already
on screen. A row flagged `hidden` (a face-down Set) still draws nothing.

The matching rules that make it reliable:

* **longest name wins** and a matched span is consumed — "Savage Demon sword of
  Sparta" cannot resolve as "Savage Demon";
* names must sit on **word boundaries**, so one cannot match inside a longer word,
  and a name under 3 characters never enters the index at all;
* the two cards drawn are the first two **by position in the sentence**, not by
  match order — "A strikes B" writes the actor first, while matching runs
  longest-first, which is unrelated. Sorting by match order would draw whichever
  name happened to be longer as the attacker;
* a card acting on itself draws **one** tile, not the same art twice with an
  arrow between; and it is both halves or neither, because one art and a
  dangling arrow reads as a bug.

The index is built once for the whole list, because `_bcLogRow` runs up to 400
times per render and walking both decks that often is the difference between a
modal that opens instantly and one that hitches. Art comes from
`_abilityArtBest` — the same resolver the ability panel and the cinematic use
(v121v134) — so a card that resolves anywhere resolves here.

Suite: `_logcards_smoke.mjs` (runs the index builder and the matcher for real).

---

## v121v137 — nobody moves while you are choosing, and you get 30 seconds

Owner: *"Stop the Ai from making moves and players from making moves when a
player have a Modal up and have to select. Give all reaction modals like select
card from deck or graveyard, triggers make give players 30 second from 15
seconds to make a choice."*

⚠ **One correction, because it changes what "30 seconds" means.** The deck and
graveyard pickers and the trigger prompts were **never on 15 seconds** — they
have no timer at all and wait indefinitely. Only two things were timed: the
counter window (15s, authorable 3–30) and the trigger-**order** picker (20s).
Putting a 30s clock on the untimed ones would *remove* time, not add it. So the
two real timers go to 30 and the untimed modals stay untimed — the reading that
makes every modal at least 30 seconds, which is what was asked for.

**The freeze.** `_battleInputBlocked()` only ever asked whether a cinematic was
playing, so every choice modal left the board fully live underneath it — and the
AI step loop asked the same question, so it stepped straight through an open
prompt. A shared `_playerChoiceModalOpen()` now answers both.

⚠ **The trap in "freeze the board"**, and why the predicate is a hand-written
list rather than "any `App.ui` flag": several choice modes **are answered by
clicking the board**. `sacrificeTargeting`, `skillTargeting`,
`consumableTargeting`, the generic on-play targeting queue and `fusionPlace` all
dock a bar and then wait for a click on a unit or a tile —
`renderSacrificePrompt` is pointedly not a `.keep-modal` for exactly that reason.
Freezing the board for those would block the only gesture that can answer them
and strand the player until a timeout. The informational panels (unit inspector,
card detail, battle log) are excluded too: you open those to *read*, and freezing
a turn behind one would be a way to stall a multiplayer opponent on purpose.

The AI waits on the same predicate inside the loop that already polls for
cinematics and already refreshes `App._aiLastSchedule` — which is what stops the
8s hang-watchdog force-ending the turn underneath a 30s prompt. Its cap is 40s
rather than the cinematic 9s, because a prompt is a person deciding rather than
an animation that should already have finished.

⚠ No deadlock is possible: the counter prompt is awaited inside the AI's **own
call stack**, so the scheduler is not running while that promise is pending.

⚠ **The 45s hard deadline is not raised.** Two 30s prompts in one AI turn would
outlast any constant big enough to be safe, and a bigger constant weakens the
guard against a real hang on every other turn. The deadline **re-arms** while a
prompt is open, so a genuine hang still dies 45s after the player stops being
asked anything, and a player who is thinking is never guillotined.

The counter window's ceiling moves to **60**, not 30 — otherwise the new default
would also be the maximum and no card could author a longer window. A card that
explicitly says 15 keeps 15: that is an authored decision, not the default. The
editor input, the save clamp, the template default and the card blurb all move
together, so the editor cannot author a value the engine clamps away.

Suite: `_choicefreeze_smoke.mjs` (runs the predicate for real — including that an
empty trigger queue is not an open choice, and that sacrifice targeting does NOT
freeze).

---

## v121v138 — Evo units, and the Realm-deck-only rule enforced for all three

Owner: *"This will be the new card type that can only go into Realm decks and
show the Fusions and Archon cards in the deck builder list so players can add
them to the deck but they will go into the realm deck (Fusions, Archons, Evo
Units)"* — and, restating it unprompted: *"Evo Units can only be in the realm
deck they do not get added to the main deck they are like the fusions and
Archons."*

⚠ **The rule was not being enforced for the two types that already existed.**
`addToDeck` gates deck size, copy limits, ownership and one-hero-per-deck — and
says nothing about Archons or Fusion Kalons. An Archon is an *ordinary unit*
carrying `archonSummon.enabled`, so `getAllDeckableCards` buckets it as a unit
and the **main** deck accepted it. A card in the main deck is a card you can
**draw**, and drawing the thing the Realm Deck exists to summon makes the summon
condition that pays for it free. The Realm Deck's own add button has always
checked its half ("Only Archons and Fusion/Polycreation cards can enter the Realm
Deck"); the check simply never existed in the other direction.

So this adds the Evo type **and** closes that hole for all three:

* `isEvoCard` / `_realmOnlyKind` / `isRealmOnlyCard` — one predicate trio that
  names the type, so a refusal can say which rule was hit and a fourth Realm type
  later is one line rather than a hunt.
* `addToDeck` refuses a Realm card outright. It lives there because `addToDeck`
  is the choke point every deck source funnels through — the copy-cap note in the
  same file records `buildDeckFromKeys`, two AI builders and `_legalizeDeck` each
  re-deriving their own idea of a rule and each breaking it — so a hand-edited
  save replayed through `buildDeckFromKeys` is covered too.
* The deck-builder **+** button **routes** rather than refuses, because the owner
  asked for these to be visible in the list and addable from it. It calls one
  `_realmDeckAdd` that reuses the Realm Deck's own cap, ownership, ban status and
  per-card copy limit — a second entrance that skipped them would be exactly the
  second-source-of-truth failure that copy-cap note describes.

An Archon card with `archonSummon.enabled` **false** is an ordinary unit and may
still be decked.

Suite: `_realmdeck_smoke.mjs` (runs the predicate for real, including that an
Archon is Realm-only — the case the main deck was silently accepting — and that
ordinary cards are untouched, so this cannot quietly shrink the main-deck pool).

---

## v121v139 — a battle loading screen that covers the REAL lag, and an AI that waits

Owner: *"The game lags hard before the battle starts so What I want to do is ad
the loading screen when the camera zoom out happens with the players cards in
their hand has this fade out to the zoomout from the camera and have the ai wait
until cards are drawn from both players and lag is over. Also that progress bar
in the image make it move to the full of the game starting."*

**What was actually wrong — the opening is three things racing, and nothing waits
for anything:**

* the board iframe boots and **bakes**. `battle-board/index.html`'s own budget
  note measures three bakes at **~435 ms in one frame** (vista 106, terrain 130,
  grade 59) plus refinements — and on `board:ready` the host answers with **eight
  push bursts**;
* the camera pull-back is 900 ms and its own comment says it **does not gate
  input**;
* the AI is kicked with `scheduleAIStep(900)` — and `applyAnimSpeed` can make
  that **shorter** — while the last hand card does not start arriving until
  1140 ms and finishes at ~1520 ms.

So the AI could legitimately act **before the player's hand had finished being
dealt**, on top of a stutter with nothing drawn over it. That is the report.

**The screen** is modelled on the existing `BootSplash` — same shape, same CSS
idiom, same safety net — and the bar tracks **real work**, which the owner chose
explicitly and which is the only version that cannot show 100% while the game is
still hitching:

| step | weight | completed by |
|---|---|---|
| `state` | .15 | both hands dealt — `initGame` slices **both** in the same object literal in one tick, which is exactly *"cards are drawn from both players"* |
| `stage` | .35 | the iframe reported `board:ready` — its bakes are done; the largest real non-settle cost |
| `reveal` | .20 | the 900 ms camera pull-back has run |
| `settle` | .30 | **eight consecutive rAF deltas under 40 ms** |

⚠ **`settle` is the honest part.** "Lag is over" is not a duration anybody can
guess from a desk — it depends on the machine — so it is **measured**, and it
carries the largest weight because it is what the player actually feels. `reveal`
is the one step honestly driven by a timer, because it is an animation we own
rather than work whose cost varies by machine; if `REVEAL.DUR` changes, that
number moves with it, exactly as the opening-deal delays already must.

⚠ **A floor and a ceiling.** 800 ms minimum so a fast rematch cannot flash the
screen for three frames; a 12 s ceiling (BootSplash's own safety value) so a
machine that never settles is never stranded.

⚠ **The AI is held by the same predicate the modals use.** v121v137 taught
`_runAIStepWhenClear` to wait on a player prompt; the intro is the same kind of
"not yet" and belongs in the same place, so the two answers cannot disagree. The
wait refreshes `App._aiLastSchedule`, or the 8 s hang-watchdog would force-end
the turn underneath the loading screen.

⚠ **The opening deal moves with it.** `_playOpeningDeal` fires off the
once-per-match turn-key baseline — i.e. on the **first render**, which is now
behind the cover, where nobody could see it and where its 1800 ms class removal
would strip it before the screen lifted. It is deferred to the moment the cover
clears, which is also when the camera pull-back is visible: that is what makes
the hand fade in *with* the zoom-out, as asked.

The art ships AVIF / WebP / JPEG at **254–344 KB** from a 3.5 MB source — a
screen whose whole job is to cover startup lag must not be a download that
causes it.

Suite: `_battleload_smoke.mjs` (runs the weighting and the settle detector for
real, including that a machine still stuttering sits at 85% and does not claim to
be ready, and that a stutter RESETS the smooth-frame streak rather than pausing
it).

---

## v121v140 — the FOURTH ability surface gets the card art; an Evo unit is a unit

Owner, with a screenshot of a frame PNG wearing a unicorn emoji: *"When a hero or
unit use their ability Show the card art not this emoji stuff."* And: *"Evo Units
are units It should be under summon."*

**The first is a miss in my own earlier fix.** v121v134 replaced the art lookup on
THREE surfaces — the ⚡ panel, the activation cinematic, the battle log — and
missed a **fourth**: `_afxAnnounce`, which builds the spec the ActivateFX module
draws as a full-screen card face. It still ran the pre-v134 lookup (refuse every
`blob:`, then fall to the thumbnail tier) — exactly the code v134 identified as
the bug, since `_lazyLoadCardArt` stores every streamed card art as a `blob:`. So
the art the board was already drawing was resident and thrown away, and
`activate.js` fell to `frameUrl` + an `.afx-glyph` of `s.icon`. That is the
screenshot.

⚠ The frame fallback is **kept** here, unlike in the log: there the owner named
the card back as wrong in a 34px row; this is a full-screen card face, and
`activate.js`'s own note says a bare dark rectangle is the worst of the three.

**The second looks like menu ordering and is not.** `_isSummonableCard` — the
test for "may this card be put on a tile" — listed unit / summon / enchantment /
curse. An `evo` type is none of those, so the Evo unit would have been refused
**by the very summon that exists to bring it out** of the Realm Deck, and the
Cocoon feature would have failed the moment it was built. It is a unit on the
board now, while staying Realm-deck-only for deckbuilding — separate questions,
and the code says so.

Suite: `_evoart_smoke.mjs`. `_enchzone_smoke`'s summonable pin carried the whole
line verbatim and so failed on an unrelated addition; it now asserts each type
separately, because a list that is only ever added to should not make every
addition look like a regression.

---

## v121v141 — an enchantment on the board is scenery

Owner: *"Enchantments cannot move remove the fact that they can move they are like
walls."*

⚠ **v121v135 only stopped it on its first turn.** The token was stamped
`hasMoved`/`hasAttacked` at placement — but those are **turn** flags that the
turn refresh clears, so from its second turn the enchantment was an ordinary,
fully mobile unit.

The rule follows the wall's, at every gate the wall uses: `getValidMoves` returns
zero tiles (the one line that blocks Move Piece, drag-to-move **and** the AI), the
hover menu offers no MOVE row, both `onTileClick` gates refuse it, and forced
movement — knockback, push, pull — resists.

⚠ **And mapping it found a hole in the wall rule itself.** `getSwapTargets` never
excluded walls, and swap **relocates** a unit — so a wall whose own keyword row
promises "never moves, can't be dragged or take a Move command" could be walked
across the board by swapping it with the hero. Asking through one shared
predicate closes that as a side effect, which is the whole argument for a shared
predicate over a second `isWall`-shaped check: adding the rule to five gates and
missing the sixth is exactly how swap went wrong.

⚠ **Two predicates, not one.** `_isStationaryUnit` answers "does it take a Move
command"; `_resistsForcedMove` answers "can it be shoved". A **pushable** wall
moves when shoved while still never moving itself — collapsing them would have
silently un-pushed every pushable wall in the game.

⚠ **The forced-move guard exists at TWO sites** — knockback and pull are separate
blocks with identical text. The patch asserts the count and rewrites both;
fixing one would have left forced *pull* dragging an enchantment off its tile.

The enchantment gets its own keyword row on the card, like the wall's, naming all
three ways it cannot be moved including the swap that was leaking.

Suite: `_enchstill_smoke.mjs` (runs both predicates for real, including that a
pushable wall is STILL pushable).

---

## v121v142 — Cedric is the standard menu character; three new cinematics

Owner: *"Replace the character that is on the main menu and that transfer on the
side of other menus. Have this breathing Cedric be the standard default across
all pages from on out."* Plus Cosmic Punch (Effect VFX), Geomax and Lord Gary
(per-unit Summon VFX).

**One change, three surfaces.** `_mdRoster()` is the single source for the iframe
main menu's `#charStage`, `_mdSideHeroHtml()` on every sub-page, and the classic
fallback menu — so the default moves once. An admin-curated roster still wins
(that is an explicit decision made in the Character Manager); the old hero-art
fallbacks are kept beneath Cedric as the last thing between a missing asset and
an empty silhouette.

⚠ **The Character Manager would have destroyed this asset.** Its upload path
decodes every image and re-encodes with `canvas.toDataURL('image/png')` — an
animated WebP dropped in there becomes a single still frame. Cedric is therefore
wired as a code-level default with a real file path; going through that screen
would have silently killed the animation and looked like a bad file.

**Every asset was recompressed first**, because these load on screens players see
constantly and there is an open laptop-performance report: Cedric **51 MB → 5.96
MB** at 640px (he renders ~600–700px tall, so that is roughly native), Geomax
**26 MB → 11 KB + 732 KB**, Gary **3.7 MB → 8 KB + 397 KB**, the Cosmic Punch
fist **2.1 MB → 234 KB**. The Geomax win came from its shape: a 23.9 MB HTML that
was 10 KB of code and three 2000×2000 base64 PNGs — and base64 is 33% larger than
the bytes it carries *and* cannot be cached apart from the page.

**A weak device gets a still** (owner's choice) — the loop's own first frame at
125 KB, so the fallback is the same pose. It triggers on `prefers-reduced-motion`,
on `gfxQuality: 'low'` (which `_memShedGraphics` latches under memory pressure),
or on the device probe **copied verbatim from `combat.js`'s `lowPower()`** — the
only capability test in the codebase, because a second differently-shaped one
would be a second opinion about the same machine. The decision is made in the
parent, not the iframe, which is handed a finished src; `_mmData()` never sends
the graphics setting across, so the menu could not decide correctly anyway.

⚠ **Gary's zip shipped an installer and it was NOT run** — it writes to
`D:/game-deploy-battle`, a different worktree, and patches `index.html` by string
replacement. But *reading* it earned its keep: it registers into
`_ACE_VFX_NAME_MAP` as well as `_UNIT_SUMMON_VFX`, and that second registry is
what fires a cinematic when a card's own `summonVfx` was never set or was
stripped on publish. Registering only the picker would have left both new summons
working in the Forge preview and silently dead in a real match.

⚠ **Cosmic Punch was adapted, not copied.** It is an ES module importing a bare
`'three'` specifier these pages cannot resolve; it used `import.meta.url` for its
art path, which is a **syntax** error in a classic script (the whole file would
have failed to parse and the effect would never have existed); and it set
`colorSpace = THREE.SRGBColorSpace`, an r152+ constant the vendored build
predates — which would have stored `undefined`, read the texture as linear and
rendered the fist washed out. A bug nobody reports, because it merely looks
slightly wrong.

Suite: `_cedricvfx_smoke.mjs`.

---

## v121v143 — an Evo unit is EDITED as a unit

Owner: *"Rvo Units are just like Summons and units they are units that can fight
you have them as Spells Give them where they two can have stats and attacks."*

⚠ **A bug in v121v138/v140, not a new request.** The `evo` type was added to the
Forge dropdown and the engine was taught it may stand on a tile — but the
editor's own test stayed `type === 'unit' || 'hero' || 'summon'`, so picking Evo
Unit rendered the non-unit form: no stats, no learnset, no passives, no factions.
A card summoned onto the board to fight had no way to be given anything to fight
with.

⚠ **The save side needed no change**, which is the tell that this was purely a
rendering gate: the stat capture is `if (document.getElementById('ed-hp'))`. The
stats were never refused, only never offered — noted in the source so nobody
hunts for a save bug that does not exist.

One `isUnitLikeType` predicate replaces **four** hand-rolled copies of the same
test. Four sites that can disagree is exactly how a type gets added to three of
them.

Suite: `_evounit_smoke.mjs`.

---

## v121v144 — Node Inventory collects; Vault Crafting removed; zero-cost Archons

Owner: *"This button is not working fix this here, Make sure it gives players
their node resource yield."* · *"Remove this crafting button from the Vault
base."* · *"Archon Summon should not consume Kalon Source Points. Have it where I
can make it zero."*

**Three stacked failures, which is why the Collect button did nothing at all:**

1. it looked the node up in `FoundationReserve.nodes` — PRN rows keyed by
   `economy_nodes.id`, a **UUID** — while the modal that renders the button shows
   **territory-war** nodes keyed `'N-01'` (`tw_node_owners.node_id`, **TEXT**).
   The `find()` missed on every click. This file already documents that exact
   mismatch for the "Make capital" button and concludes *"economy_nodes still has
   no column referencing a TW node, so that lookup can never be made to work"*;
2. its only fallback read `App._twSelNode` — a name appearing **there and nowhere
   else in the file**, never assigned, always null;
3. past both, it called `node_inventory_claim(uuid)` against `economy_nodes` — a
   table this node is not in.

The claim clock now lives in the TW id space (`sql/135`, `tw_node_inventory` +
`tw_node_inventory_claim(text, numeric)`), ownership checked against
`tw_node_owners`, upserted so two devices cannot bank the same hours. ⚠ Not a
re-point of 132: the id spaces cannot be joined, and 132 still serves PRN nodes
correctly.

**And the number was wrong too.** The panel offered a flat 10/h of a generic
resource while the RESOURCE YIELD panel *directly beside it* read
`selNode.resourceYield` and promised FUEL +7/hr — two panels on one modal
describing the same node differently. It now pays the node's own yield, every
resource it produces, still multiplied by the tier / node-power / city-level
curve. A node with no authored yield keeps the old flat rate, so nothing that
paid out before stops paying. The 24 h head start is kept (owner's choice), so
the first collect after the fix pays what players were already shown.

Also: the Vault's Crafting button and its handler are gone — which exposed that
the Crafting screen's Back defaulted to `'baseVault'` while that button was the
**only** caller that ever set `craftingReturnScreen`. Every other entrance had
been dumping players into a room they never came from; the default is the title
hub now, and the field is kept for callers that do know.

And an Archon may cost **zero** Kalon Source. The engine always understood it —
both the check and the spend use `Math.max(0, kalonCost|0)`, and spending 0 is a
no-op. Four `|| 1` fallbacks were the problem: `0` is falsy, so they could not
tell "unset" from "deliberately zero". The save wrote a typed 0 back as 1, the
editor re-rendered a stored 0 as 1, and the rules text and Realm Deck badge both
printed 1 for a free Archon.

Suites: `_nodeinvfix_smoke.mjs`. `_nodeinv_smoke`'s collect pin required the uuid
RPC — the call that could never work from this screen — so it now asserts the TW
one; the claim it was written to protect (hours claimed on the server, banked
through `addRes`) is unchanged.

---

## v121v145 — target range and sacrifice mode are authorable

Owner: *"Fix the targeting system where when a card effect has a target effect
that target 1 unit have it where it can be based on how far tiles are or Global.
Same as Sacrificing Allow where it can be random and targeting where player
target who they want to sacerfice. add these to drop downs when these effects are
selected."*

⚠ **Global was never an engine limitation.** `_targetCandidates` has read
`(eff.global === true) || ((eff.radius|0) >= 99)` since v120c3 — but nothing in
the Forge could **set** it. The only route was typing 99 into a Radius box that
every editor caps at 4, so "anywhere on the battlefield" was unauthorable in
practice while the code to do it sat there working. This adds the control and
changes nothing about how targeting resolves; a legacy radius-99 card still
reads as Global.

**The sacrifice half is a real engine change.** Four effects take a friendly unit
and each hard-coded its own rule — `sacrifice` lets the player pick (AI
auto-takes its weakest), while `sacrificeNearby` / `tributeRite` / `tributeDraw`
always took the weakest. `sacPick` makes that an authored choice.

⚠ **Random is seeded, not `Math.random()`.** `sacrificeNearby`'s own comment says
the weakest go first *"deterministically, so multiplayer stays in sync"* — a live
`Math.random()` would have two clients sacrificing **different** units from the
same board. The roll derives from the turn, the caster and the **sorted**
candidate ids through `_bbRng` / `_bbSeedFromString`, the mulberry32 pair this
codebase already uses because it yields an identical stream on every JS engine;
the shuffle runs over an id-sorted copy so a different input order on one client
cannot change the outcome.

⚠ **"Player picks" is labelled Sacrifice-Ally-only, and that is the truth rather
than a hedge.** Only that effect has a pick flow; the other three take a *set* of
victims at once and have no multi-pick UI, so the engine falls back to auto
there. Saying so on the option beats shipping a choice that silently does nothing
on three of four effects. Sacrifice Ally still defaults to `player`, so an
unauthored card behaves exactly as before.

Both pickers ride the **same completion pass** v121v124 built for the summon-zone
field, for the reason its own comment gives: seventeen editor blocks can hold
these effects, and a field written into each template is a field six of them get.
The save sweep writes back only for effects that **read** the value and deletes
the key for the default — so a "draw 2 cards" does not acquire a stray
`global`/`sacPick`, and switching back to "within N tiles" really does switch
back.

`.gauntlet/_fx-gate-audit.mjs` prints **zero** after the change, as the gate
table's own header requires.

⚠ The forge harness pins `truth === 106` — how many `.editor-field` elements live
inside the editor. Two new pickers took it to 130. That number is the *witness*
that `getElementById` and the editor disagree, not the claim being tested, so it
follows deliberate additions; updated with that reasoning recorded.

Suite: `_targetsac_smoke.mjs` (runs the seeded order for real, including that two
clients with **different input order** get the same victim).

---

## v121v146 — multiplayer shows the opponent's REAL deck, hero and cards

Owner, relaying a player report: *"Multiplayer is unplayable, they couldn't
select cards and or attack"* — and: *"It wasn't showing the right cards, deck or
the players correct hero."*

**Five distinct bugs. The report was accurate about all of them.**

### The root cause — the wire format carried ids only

This game's content is **player-forged**, and the deck payload was
`{ cards: ["unit:<id>", …] }` with no definitions anywhere. On the receiving
client:

1. the 40 keys arrive and pass the `length === DECK_SIZE` gate;
2. `lookupCustomCard` cannot resolve a card the other player forged and never
   published, so `buildDeckFromKeys` **drops it** — there is no `else`, the key
   simply vanishes;
3. `_legalizeDeck` sees a short deck and **pads it from `UNIT_CARDS` *and*
   `Forge.customCards`** — my own forged cards.

So the player watched their opponent play built-in goblins **and the player's own
deck**. That is "it wasn't showing the right cards, deck", exactly.

**Fix A — send the definitions.** Slimmed the same way `_slimHeroForMp` already
slims a hero for this same payload: art stripped, rules kept. Card art here is
base64 or cloud URLs, and forty raw definitions would be megabytes through a
realtime frame — which matters beyond bandwidth, because an oversized or dropped
frame is precisely how a client loses its turn permanently (see D). All three
payload paths carry them: matchmaking, the friend-challenge send (`deck1`), and
the accept. The opponent pool is consulted **last** inside `lookupCustomCard`, so
it can never shadow a card either player actually owns, and it is adopted
**before** the deck is built, because `buildDeckFromKeys` resolves each key as it
walks the list.

**Fix B — an opponent's deck is never padded from my collection.** Even with (A),
a banned card, a deleted one or a version skew still leaves a hole — and filling
*that* from my own cards is the visibly wrong answer. An opponent deck pads from
the built-in pool only. An undersized deck (they hit fatigue sooner) beats a
wrong one: the same judgement the existing note already makes about the copy
limit.

**Fix C — the wrong hero.** The challenge **accept** payload carried neither
`heroData` nor `heroProg`, while the send side and `deck1` both do. So the
challenger's client fell through to the stub branch and fabricated the other
player's hero: level 1, 30 HP, `{atk:14, def:12, mag:12, res:12, spd:1}`, shadow
element, 👤 icon. Being accept-only is why it would have looked intermittent.

**Fix D — the silent refusal.** `onTileClick` returned silently on
`s.turn !== 'player'`, and a multiplayer client is only ever granted a turn by
adopting a broadcast snapshot — the server writes `current_player_id` on end-turn
and **nothing reads it back**. One dropped frame leaves a player inert with no
explanation, which is exactly "couldn't select cards and or attack". It now says
so. ⚠ The turn-recovery itself (reading the server's turn back) is still open —
this makes the state visible, it does not yet repair it.

**Fix E — unit equipment has never crossed the wire.** At **four** payload sites,
each loop tested a DECK key (`"unit:<id>"`) with `startsWith('u_')` — while
equipment keys are `"u_<id>"`. The test never matched, the loop skipped every
card, and `unitEquipment` shipped as `{}` every time, silently. The hero half
works only because its key is built explicitly as `'h_' + id`. The conversion is
**idempotent**, so a pre-prefixed key never becomes `u_u_<id>` — that would be
the same silent miss in a new shape.

Suite: `_mpdecks_smoke.mjs` (runs the key conversion, the resolver order and the
pad for real — including that an opponent's short deck is never filled with my
cards while my own still is).

---

## v121v147 — a card on the field can actually spend its counters to negate

Owner: *"This do not work no modal appears to ask do the player want to negate
when something happens. It should be a counter trigger type before the action
happen if accurate ask player do they want to respond."*

**Why no modal ever appeared.** `tryPromptCounter` gathered candidates from
exactly two places:

* `state.player.hand` — filtered to `type === 'counter' || isCounter ||
  isCounterUnit` **and** requiring a `counterTriggers` array;
* `state.player.graveyard` — reactive `graveActive` abilities.

A card carrying a 🔵 Counters block with `canCounter: true` and
`counterTargets: […]` is **neither**. Three separate things excluded it:

1. it is on the **field**, not in hand;
2. it is an ordinary unit, so the counter-type test rejects it;
3. `counterTargets` is a **different field** from `counterTriggers`.

⚠ **The engine half was already complete and correct.**
`MythicCounters.canPayWithCounters(state, owner, card, trigger)` checks the flag,
the target list and whether the owner holds `counterCost`; `payForCounter` spends
them with a log line. But `canPayWithCounters` was only ever consulted as an
*alternative way to afford* a card that had already passed the three hand tests —
so for a field card it was unreachable. The feature had **no path to the prompt
at all**.

⚠ **The two vocabularies already match.** `counterTargets` and `counterTriggers`
are both authored from the same `COUNTER_TRIGGERS` list, so the ids line up and
no translation layer is needed — which is why this is a missing candidate source
rather than a redesign. The prompt also already fires *before* the action
resolves, which is the owner's "before the action happen" half.

**What this adds:** a third candidate source — board units the player controls,
plus the card-shaped permanents `Counters.permanentsFor` already enumerates
(location, enchantments, weather) — each filtered by the engine's own
`canPayWithCounters` rather than a re-derived copy of the rule, and offered in
the same timed window as hand counters and grave reactions. **The window now
opens for a field card alone**: before, a player whose only possible response was
a fully-charged counter card on the board saw nothing whatsoever.

The pick routes to `_battleActivateTokenCounter`, which:

* re-resolves the card from **live** state — the window is timed and the unit may
  have died while the player was deciding;
* re-checks affordability — the counters could have been spent elsewhere since
  the prompt was drawn;
* pays through the **same** `payForCounter` the hand path uses, so counters are
  spent by one piece of code and the log line is identical however the negation
  was reached;
* resolves the window `true`, so the action is negated like any other pick.

⚠ The sound uses `abilityCast`, a **real** id in the SFX table. `counterFire` —
the obvious name — is not, and `playSfx` fails silently on an unknown id, so that
would have shipped as a negation with no sound and no way to tell why.

Suite: `_tokencounter_smoke.mjs` (runs the engine's gating rule for real,
including that an empty target list answers anything — the editor's "leave all
unticked" case — and that a field card alone opens the window).

---

## v121v148 — 🍀 Luck is a real hero stat, and it makes battle loot better

> Owner: *"Add a new Stat to heros 'Luck' That will increase the better the loot
> that the hero and units finds in Battle. And replace the stats increase for
> Speed for luck in the Skill tree and only give where the points only give you
> 1% luck."*

⚠ **The swap is player-visible, and was flagged before it was built.** Speed
drives both movement range *and* attack reach, so a hero who had already spent
points on those nine stars loses reach and movement on the next load, with the
Respec button as the only recovery. The owner confirmed: *"yes"*.

### The 1% clamp lives at the BUILDERS, not on each node

This is the part that would have quietly broken the rule. Skill-tree stars come
from **two** sources:

* hand-authored constellation rows, every one built through `_cS({...})`;
* an **auto-generator** that derives each branch's theme from the tally of its
  authored stars, then emits minors at 3/4/5, a Mastery at 6/4 and an Ascendant
  keystone at 8/6/6.

The moment Luck replaced Speed it became a branch's top stat — so that generator
would have started handing out **luck 3, 4, 5, 6 and 8** nodes, which is exactly
what *"only give you 1% luck"* forbids. `_cLuck1` is therefore applied at `_cS`,
at `minor()` (`if (stat === 'luck') amt = 1;`) and at the Mastery/keystone `fx`
builders, so the rule is true however a node was produced rather than depending
on nobody authoring one later. Every other stat passes through untouched.

⚠ **The accumulator had to learn the stat or the whole feature was a no-op.**
`getHeroCosmicStatBonuses` filters with `if (k in out)`, so `luck` is declared in
that `out` object — without it every Luck node would have been dropped on the
floor silently, with the tree still displaying them.

`luck` is also added to `_COS_STAT_LABEL` (`'Luck %'`), `_COS_STAT_DESC` and the
generated-name bank, so a generated Luck star reads like the rest of the
constellation instead of printing the raw key.

### The swap itself

Nine Speed grants become `luck: 1`, including the bundled ones (GHOST,
Versatility, ASCENDANT ARTS, Shadow Clone). Four descriptions that promised
movement were reworded — *"Fleet: cover more ground each turn"* on a Luck star is
a lie the player reads every time they open the tree — while the node **names**
were kept, because saved allocations key off node identity and renaming would
orphan every hero who had already bought one.

SPD itself is untouched **outside** the tree: items, status effects and unit stat
blocks all still use it. This was scoped to the skill tree, not to the stat.

### Luck raises loot QUALITY, not frequency

Drop **chance** is deliberately unchanged. The owner asked for *better* loot, and
the two knobs compound far faster than they look — moving both at once leaves the
economy untunable afterwards. Two rolls decide quality and Luck bends each:

* **Card drops** roll a rarity from weighted tiers (common 600 … mythic 1.5).
  `_luckWeightedRarity` scales each tier by `1 + (luck/100) * tier * 0.4`, so the
  multiplier grows with how rare a tier already *is*: mythic gains
  proportionally more than rare, and **common is never inflated**.
* **Item drops** are price-weighted (`w = 3000 / price`) — which is what makes
  cheap consumables constant and relics jackpot-rare. Luck softens that exponent
  (1 → 0.7 at cap), flattening the curve toward the pricier end rather than
  adding a flat bonus, so the *shape* of the table is preserved and only its
  steepness changes.

Total Luck is capped at **60** (`LUCK_MAX_PCT`): a runaway multiplier on a rarity
table turns "better loot" into "only mythics", which is not better. At **zero**
Luck both formulas return the original values byte for byte.

`_playerLuckPct()` sums the live battle hero's cosmic tree plus any Luck authored
on the hero's own stat block, falling back to `App.battlePrep.hero` for grants
rolled outside a battle, and never throws — a loot roll must not be the thing
that breaks a victory screen.

Suite: `_luck_smoke.mjs` (44 checks; runs the re-weighting, the price curve and
the clamp for real, including that common is never inflated and that a mythic
stays rare even at max Luck).

---

## v121v149 — 🏹 the aiming arrow: who you are pointing at, and whether you may

> Owner: *"add the arrow for when a player is targeting to see who the player is
> hovering over or a Tile they are hovering over. Add the arrow for when a
> player is placing a unit or enchantment have the arrow green when it can be
> place in a tile and red when it cannot."*

Both halves are one arrow:

* **targeting** — an arc from the actor to whatever the pointer is over, unit or
  bare tile;
* **placement** — the same arc, **green** when the hovered tile will accept the
  card and **red** when it will not.

### The load-bearing claim is not that an arrow is drawn

It is that **green and red can never disagree with the click gate.**

The telegraph's own comments are emphatic on this point: it *must not become a
second opinion about the rules*. Every arrow the attack fan draws comes from the
very array `renderBattle` handed the click gate that same render, precisely so
the board can never offer an arrow the click then refuses — the
UI-lies-about-the-rules bug those comments warn about twice.

The aiming arrow obeys the same constraint. `renderBattle` already builds every
legal set for every aiming mode, so it now publishes them as-is under
`App._bbPaint.aim`:

| mode | set |
|---|---|
| a unit / wall / trap / enchantment / curse / location played from hand | `validPlacement` (already carries the v135 enchantment branch) |
| consumable, skill, **and** Polycreation placement | `consumableTargets` — they already share one pipeline |
| the queued effect-target step | `_tgtSet` |
| sacrifice targeting | `_sacSet` |

`_bbStagePushTele` then only asks *"is the hovered tile in that list"*. Green
means the click will accept it and red means it will refuse it **by
construction**, not by two pieces of code agreeing.

### Where the arrow starts

A queued effect arrow starts at its **caster** — the queue entry already carries
`casterId`. Everything else starts at the hero, who is the actor holding the card
or the item. ⚠ With no hero alive there is no honest origin, so **no arrow is
drawn**: an arrow from nowhere is worse than none.

### Two smaller calls

⚠ **The colours are the board's own existing vocabulary, not new ones.** `ok` is
`#7fe89f`, the exact green `PAINT.place` already strokes legal deploy tiles with;
`no` is `#ff5a4a`, the attack red. So a green arrow lands on a green tile and
reads as one statement rather than introducing a third palette. Anything that is
not an aim side still falls through to the original `mine`/`foe` pair, so the
attack telegraph is untouched.

⚠ **A denied arrow loses the travelling charge.** Those dots read as intent
flowing toward the target; on a tile the click is about to refuse, the animation
would be the picture contradicting the rule it is trying to state. Denied is a
static red line with a head — it points, it does not promise.

### It owns the telegraph while it is up

Aiming is a modal question, so the arrow clears the move ribbon and the attack
fan. Two routes drawn at once is the board telling two stories — the exact
failure the AI-trail branch above it is an `else if` to avoid. It needs a live
hover, so pointer-leave (the stage sends `x < 0`) removes it on the very next
push: no timer, no stale arrow left pointing at nothing.

`BB_VER` and `BB_BUILD` both move to `v121v149-aim`, because the board document
changed and that query string is the iframe's only cache-buster.

### A stale check, fixed rather than re-baselined

`_ritualart_smoke` pinned `BB_VER` to the literal range `v121v2[6-9]-`, so it
passed for exactly four builds and was **guaranteed** to fail the next time the
board legitimately moved — which is what happened here. The baseline was not
raised. The window was replaced with the claim it was actually making: `BB_VER`
equals the board's own `BB_BUILD`. That pair is what keeps a client off a stale
board; the four-build range never checked it at all.

Suite: `_aimarrow_smoke.mjs` (runs the legality decision for real, including that
an empty legal set makes every tile red — a mode with nothing playable never
shows green).

---

## v121v150 — 🧬 the Cocoon of Evolution

> Owner: *"the unit gains a evolution counter … sacrifice it and summon a Evo
> unit from the realm deck"*, charging on: start of turn, the day/night flip,
> only-day / only-night, a unit called from hand / deck / graveyard, units dying,
> spell cards, effects activated, and attacks.

### Built on the trigger engine, not beside it

That list of nine is almost exactly the vocabulary `card.triggers[]` already has
— complete with the who-scope, the per-turn and per-match limits, the cost, the
chance roll and the response prompt. A second subscription system for cocoons
would have duplicated every one of those and then drifted from them.

So **a cocoon is an ordinary trigger** whose effect happens to be *"🧬 put N
evolution counter(s) on this unit"*, and six of the nine needed no new code at
all. Spell cards in particular: `cardPlayed` already filters by card kind, and
`spell` is one of them.

Three were genuinely missing. They are added as **general vocabulary**, not as
cocoon special cases — every card gets them:

| added | what it is |
|---|---|
| `dayNight` | the flip itself |
| `effectActivated` | an effect resolving on the field |
| `fromZone` | a **gate** on `summon` — "called from hand / deck / graveyard", a distinction the event could not previously make at all |
| `timeOfDay` | a **gate** — "only during the day" is a condition on any trigger, exactly like the phase gate it now sits beside, not a fourth event |

### Day/night has two mutation points, and both are hooked

The turn-based flip in `endAITurn` and the `setTimeOfDay` effect a card can play
are separate writes to `state.timeOfDay`. Hooking only the first would mean a
cocoon that charges on the flip **ignored the card that caused one**.

⚠ The card path fires only on a *real* change — "make it night" played at night
is not a flip, and firing there would let the card be replayed to farm counters.

⚠ `_fireDayNight` carries a re-entrancy guard in the shape of
`_fireTriggers._phasing`, because a `dayNight` trigger is allowed to play
`setTimeOfDay` and would otherwise recurse without end.

### An effect activating announces ONCE — the hard part

Effects nest. An on-play resolves an effect that summons a unit whose own on-play
resolves two more, and every one of those re-enters `_applyOnPlayOne`.
Announcing at each re-entry would put **four** counters on a cocoon for one card,
which is not what the player watched happen.

⚠ **The existing `_afxDepth` cannot serve as that counter**, even though it looks
like exactly the right one. It is incremented only on the *announced* branch —
and the function's first line is a passthrough for when `ActivateFX` is absent,
where every nested call would see depth 0 and fire again. `_fxActDepth` is
therefore incremented on **both** branches, and only the outermost activation
announces.

### A real gap this surfaced

⚠ **`summonFromZone` never fired the `summon` event at all.** It is the deck /
graveyard / void summon — exactly the half of "called from hand, deck or
graveyard" the event could not answer — and *every* summon responder on the
board was missing those arrivals, not only cocoons. It announces now, with the
zone the effect itself resolved, so no guess is involved.

A call site that does **not** know the zone sends nothing, and a zone-gated
trigger then stays silent. A cocoon charging on the wrong arrival is worse than
one missing an unlabelled arrival.

### The hatch

⚠ **The Evo unit takes the cocoon's own tile**, which the sacrifice has just
freed. It is the right picture, and it is the only placement that cannot *fail*:
`sacrificeToSummon`'s hero-adjacent rule has to refuse the whole effect when the
hero is walled in, and refusing here would eat counters a player spent a whole
game accumulating.

⚠ **Counters are spent only if the hatch actually happens.** With no legal Evo in
the Realm Deck the cocoon keeps them and says so — a cocoon that silently ate its
own charge would be indistinguishable from a bug.

⚠ **The Realm-deck rule is the existing one.** `_realmDeckAllows` is the same gate
Archons and Polycreation targets pass, so ownership, the admin bypass and "the AI
is unrestricted" behave identically and cannot drift into two rules.

Authoring: a **🧬 Cocoon of Evolution** block on the unit card (counters needed +
which Evo it becomes, blank = strongest in the Realm Deck — which is what makes a
generic cocoon card possible), plus the two new gates beside the Phase gate in
the trigger row. Both are read back in the save handler; `forgeids` confirms it,
since that suite lifts every save-path id out of the running source and requires
it in the markup the editor actually renders.

### Still open on this feature

The player does not yet **choose** which Evo when `evoInto` is blank — it takes
the strongest in the Realm Deck. A picker is the natural follow-up, but it needs
care: evolution can fire during the AI's turn, and a modal opened inside that
loop hangs it (the same rule `summonFromZone`'s `_autoPick` guard follows).

### A stale check, fixed rather than re-baselined

`_forgeids_smoke` derives the editor's id counts from the running source and
compares them with the number written in its own header — 385/465 + 80. The two
cocoon fields make it 387/467 + 80. The number is the **witness**, not the claim,
so the header was corrected; the check itself was not weakened.

Suite: `_evococoon_smoke.mjs` (62 checks; runs the counter arithmetic and both
gates for real, including that an arrival with an unknown zone fires nothing).

---

## v121v151 — 🌌 a seized enemy unit shows up in the Polycreation modal

> Owner: *"When stealing a unit from your enemy to use for PolyCreation Make sure
> to show the unit in the modal if it qualify to be used."*

### The diagnosis was not a filter

Polycreation has **two** resolution paths, and ticking the `enemy` material
source moved the card from the one with a picker to the one without:

* `findLegalFusionMaterials` → the **selection modal**, where the player sees
  every slot and can swap each one;
* `_polyFuseFromSources` → deterministic, opens nothing at all, taken the moment
  `matSources` names anything other than `field`.

So the enemy unit was never missing *from* the modal — **the modal was never
opened.** The existing comment said exactly that: *"that modal cannot express it
— it only ever scans the field."* This makes it able to express it.

### The two halves must ask the same question

`findLegalFusionMaterials` chooses the material; `_polySlotAlts` re-derives the
legal bodies when the player clicks ⇄. If only the first learned about enemy
units, the modal would fill a slot with a seized unit and then offer **no way
back to it**, and would omit every other enemy body the fusion would accept.

Both now call one `_polyMatUsable`, and the protection rule inside it is the
deterministic path's own `_unitProtectedFrom` call rather than a re-derived copy
— what may be torn off a board is exactly the kind of rule that must not have two
opinions. `seizeTreatAs` is applied where the match happens, so the modal shows
what the fusion will actually accept.

### The regression this nearly shipped

⚠ Letting `enemy` skip the diversion **unconditionally** would send an AI card —
or a player **trap** resolving on the opponent's turn (`_autoPick`, where the
picker cannot open because the AI step loop overwrites `App.state` underneath it)
— into the branch below the diversion. That branch is a private auto-fuse whose
candidate scan is `u.owner === owner`: **it cannot see the enemy board at all.**
Those cards would have *stopped* finding materials `_polyFuseFromSources` finds
today — a regression in the opposite direction from the bug being fixed.

The skip is therefore scoped to `owner === 'player' && !eff._autoPick`, which is
the only situation a modal can open in. `hand` / `deck` / `graveyard` still divert
for every owner, because those are piles and the picker's whole vocabulary is
slots on the board.

### Two rules boundaries

⚠ **The permission is player-only at the gate.** The AI's own Polycreation
resolver consumes `gate.materials` by id and marks them `_fusionConsumed` without
filing anything, so a seized *player* card would vanish from the game instead of
reaching their graveyard. Widening the AI's hand-spell gate would also be a rules
change nobody asked for — the ask was about the modal, and the modal is the
player's own-turn flow. The AI keeps `_polyFuseFromSources`, which files
correctly.

⚠ **A seized body is filed to its own owner's pile.** The consume step pushed
every consumed material's card-def into `ns.player.graveyard` — correct while
every material was yours, and a gift the moment one is not: the opponent's card
would land in *your* graveyard, recoverable by any of this engine's recursion
effects. That is permanently stealing a card, not borrowing a body for a fusion.

The modal also **labels** a seized slot (*"· seized from the enemy"*). A slot that
reads exactly like one of your own units hides the most important fact about the
play.

### A check that broke for the right reason

`_ritualart_smoke` runs `_polySlotAlts` **for real**, lifting it out of the source
and evaluating it. Adding the `_polyMatUsable` / `_polyMatShape` dependency made
the lifted function throw on an undefined helper; its own `try/catch` swallowed
that and returned `[]`, so every slot came back with no alternatives. The fix was
to lift the two helpers as well — the suite now exercises *more* of the real code,
not less. Its existing *"not the enemy"* assertion still passing, with no `opts`
supplied, is independent confirmation that every fusion that exists today is
unchanged.

Suite: `_polyseize_smoke.mjs` (42 checks; runs the usability decision, the alias
and the diversion for real).

---

## v121v152 — 🎬 the three rebuilt cinematics, integrated (+ Cedric actually breathes)

> Owner: *"Replace the cinematic animation for these animations we already have
> with these new one and make sure card art is showing before the end result
> where it shows the Sprite or unit Character Box Portrait."*
> and, on the menu: *"Switch the still photo with the breathing Cedric we have here."*

Three separate sessions each rebuilt one cinematic — Kalon (cosmic portal),
Polycreation fusion, Archon (ritual) — each on its own branch cut from
**v121v118**, each bumping **the same** version knobs, none deployed. This repo
was at v151. Most of the work here is the things three parallel branches cannot
know about each other.

| taken from | what |
|---|---|
| `claude/practical-rubin-su6622` | `public/vfx/kalon.html` — rift → pull → the frame flipping at the camera → burst → reveal |
| `claude/sweet-noether-r2tleu` | `public/vfx/archon.html` — tribute card frames → ritual burn → portal → fall → land |
| `claude/wonderful-gauss-3fmz6c` | the `fcx-` fusion cinematic inside `index.html` (CSS block + six functions) |

### The shared stamp — the trap all three handoffs led with

Each `vfx/*.html` carries a `VFX_BUILD` that must **exactly** equal
`_MECH_VFX_STAMP` in `index.html`. Presence is not enough: a cached page from an
older deploy still carries *a* stamp. On a mismatch the host reloads once and
then **hides the overlay entirely**, which reads as *"the cinematic silently
stopped working"*.

The branches had **kalon at `v120t5`** and **archon at `v120t6`** against a repo
at **`v120t3`**. Taking either one alone would have silently killed the other
two. All four (three pages + the host) now read **`v120t7`**.

### Two things neither original session could have seen

⚠ **The service worker would not have parsed.** The cherry-pick left **two**
`const CACHE_VERSION` declarations in `sw.js` — a redeclaration, a SyntaxError,
and no service worker at all. Nothing upstream catches this: the `htmlsyntax`
gate does not read `sw.js`. `_cinemerge_smoke` now asserts exactly one.

⚠ **Fusion would have played two cinematics back to back.** The rebuilt overlay
is mounted from the poly-confirm handler and runs 6.2s; when it finishes it calls
`_resolvePolycreationFusion`, whose **tail** fires the old `vfx/fusion.html` for
another 7s — **13.2 seconds** of cinematic for one summon. The rebuild was
authored from the confirm side; the resolver's tail predates it by many builds.

Owner's call: the new cinematic owns the sequence (card art through the fusion,
then the unit reads as its sprite on the board). ⚠ The old overlay is
**suppressed, not deleted** — the mount sets a flag and the resolver **consumes**
it, so a fusion resolved by some path that never mounted the new overlay still
gets a cinematic rather than a silent summon.

### Card art before the body

Already true in all three by construction, and now pinned so it cannot quietly
regress:

* **Kalon** is sent the base **card face** and flips *that* into the new form —
  the same `CK.card` call x-squashed, which is why it reads as a becoming rather
  than a cross-fade;
* **Archon** is sent the tribute **card faces**, which fan in and burn before the
  Archon falls through the portal;
* **Fusion** draws every frame — materials *and* the result — from `_polyArtSrc`.

⚠ The body slot is never `null`: a null key is **skipped** by the page's `set()`,
which would leave its placeholder mech on screen. It falls back to the card face,
because a picture of the right unit beats the wrong unit.

### 🧍 Cedric

The loop is now the **jacket-only** one the owner pointed at — re-encoded to
640×960 at 9fps, **3.6MB**, *smaller* than the 6.0MB whole-body loop it replaces.
Far fewer pixels change per frame, so it compresses better and reads calmer; 9fps
is not a compromise when the motion is a slow wind drift.

⚠ **The reason the still was winning was a guess.** `_menuCharStill` had three
branches; two are requests from a person (`prefers-reduced-motion`, the game's own
`gfxQuality`) and one **inferred** from `hardwareConcurrency <= 4 ||
deviceMemory <= 4`. That third one was firing: a capable laptop reports those
numbers and silently lost the feature, with nothing on screen to say why. It is
removed. The header comment — which still explained why that probe was copied
from `combat.js` — was rewritten, because a comment describing deleted code is
worse than none: the next reader goes looking, and helpfully puts it back.

`_cedricvfx_smoke`'s pin was **inverted, not deleted**. It now asserts the
stronger rule: the still is served only when a person asked for less.

### Not done

* **None of the three has run in a real battle.** Every frame in the three
  handoffs is the page driven standalone with stand-in art. The gates and the
  edge check pass; a live Kalon transform / Archon summon / fusion is the real
  test.
* The fusion **backdrop artwork** is still missing — drop a file at
  `public/assets/background/Backgrounds/fusion-cine-bg.png` and it picks up with
  no code change. The shipped gradient fallback carries the layer until then.

Suite: `_cinemerge_smoke.mjs` (43 checks; runs the host's stamp rule for real,
including that presence is not equality).

---

## v121v153 — 🧍 Cedric, much bigger

> Owner, looking at the menu: *"Make him much bigger."*

**+37% linear, +88% in area.** Head level with the top of the screen, boots
running off under the button rail.

### The asset had to grow first

Cedric is 2:3 and `.char-img` is `object-fit: contain`, so the figure binds on
whichever cap is **tighter** — which on any ordinary viewport is the **height**.
At the old `86vh` he already rendered ~929px tall on a 1080p screen out of a
640×960 source: a slight upscale before anything changed. Growing the box alone
would have made him bigger **and softer**, which is not what bigger means.

So the loop is re-encoded at the source's native **768×1152** (4.66MB at 9fps —
still less than the 6.0MB whole-body loop that shipped before v152), and
`cedric-still.webp` / `.png` re-cut from the same frame at the same size, so the
two can never disagree about resolution.

### 100vh is the ceiling, and that was only +16%

Measured before deciding: raising the box to `100vh` bought **+16%**, because a
head-to-toe figure caps out at exactly the viewport height. That is "a bit
bigger", not "much bigger".

Going further means part of him leaves the frame, and **which part is the whole
decision**:

* the **head** — never. It is the focal point and what the silhouette is read
  from.
* the **boots** — yes. Standard framing for menu hero art, and on this screen the
  bottom strip already belongs to the banner and the button rail.

So `118vh`, with the image pushed down `18vh`.

⚠ **`height` and the image's `bottom` offset are one decision written twice.**
The offset must equal the overflow (118 − 100 = 18) or he floats up and gets
cropped **at the head** — the one outcome the whole arrangement exists to avoid.

### Then it was looked at on a phone

Which is how the second half was found. At 375×812 the new rules put his head
**459px down the page** with most of him behind the nav column — **lower** than
before, the exact opposite of the ask.

`object-fit: contain` binds on the tighter cap, and on a narrow screen the
**WIDTH** binds long before `118vh` is reached. The figure therefore never grows
into the taller box, and the `-18vh` push is pure loss: it only shoves a
width-limited figure below the fold.

The narrow breakpoint now overrides **both halves** — `88vw` for the size, but
`100vh` and `bottom:-2vh` restored — so he is still larger than the old `64vw`
without leaving the screen.

Verified in the browser at both sizes, not just on paper: desktop 708×1062 with
the head at y=0; phone head at 333px (was 459px) and fully on screen.

Suite: `_cedricsize_smoke.mjs` (22 checks; reads the VP8X canvas size out of the
WebP itself and runs the contain rule for real at desktop and phone sizes,
including which cap binds at each).

---

## v121v154–155 — 🚨 the Ethos Fuel payout exploit, four economy rails, two persistence bugs, four cinematics

### 🚨 bug-mtyjpcjg — the fuel vendor was paying out of a market it never synced

> Reported: *"price/bbl … steadily in the high 200's … approx ~25,000 cinder a
> tick … other users' value is showing in to 50-60bbl level."*

**The reporter's own comparison was the diagnosis.** Measured live on
`public.cx_prices` while fixing:

| | |
|---|---|
| shared fuel price | **59.45** → correct vendor mark **52.3/bbl** |
| eight profiles carrying a local mark of | 308.0, 299.2, 290.8, 267.4, 253.3, 217.2, 153.9, 102.5 |
| every other player | exactly **88** — the untouched default, `supply` 50, 18-entry history, never traded |

308 is `0.88 × 350`: that client's local exchange price was pinned at
`CX_PRICE_MAX_FACTOR`, as high as the system permits and **5.9×** what the shared
market said a barrel was worth.

**Why the divergence survived.** The crash exchange *is* shared, and
`_cxCloudMergeRow` writes the cloud value in absolutely — a pull heals any drift.
But the shared price was pulled in exactly two places: `renderCrashExchange()`
and `MythicExchange.list()`. `fcNpcMark()` — the one function that decides how
much **cash** a barrel is worth — pulled nothing. A player who trades fuel at the
pump but never opens the Crash Exchange moved their own local mark with their own
trades, never pulled the shared one back, and decayed at `CX_DECAY_FACTOR` 4% of
the gap per 6h — a **~4-day half-life**.

**Three guard rails:**

1. **The vendor syncs.** `fcNpcMark` now subscribes and pulls, throttled, exactly
   as the exchange screen does. Because the merge writes the shared value
   absolutely, this also **heals all eight profiles on their next visit** — no
   database surgery.
2. **A divergence rail**, because a pull can always fail (offline, signed out,
   RLS, migration not applied): when a shared mark is known the quote may not
   exceed `FC_NPC_DIVERGE_MAX` (1.35) × it. ⚠ One-sided, so it can never prop a
   *low* price up to dodge a crash, and skipped entirely when no shared mark is
   known so an offline player is not punished. `_fcSharedMark` reads the **cloud
   mirror**, not `cx.prices` — asking the pumped state for the shared price would
   be asking the suspect for its own alibi.
3. **`getMarketPrice` heals the ceiling as well as the floor.** It always
   re-established the floor on every read *"because a hand-edited profile must not
   be trusted"*. That argument is symmetric; the upper half was never written.

⚠ `CX_DECAY_FACTOR` is deliberately **not** retuned. The 4-day half-life is why a
pumped mark persists, but it governs every asset on the exchange — that is an
economy-wide decision, not a hotfix's.

### ⛽ Four economy rails (owner)

* **The vendor buys at a tenth of what it sells for.** The bid was
  `ask × (1 − 0.05)`, so a round trip was nearly free.
* **Fuel is only made in the Cracking Yard**, and only by one with process plant
  commissioned. `fcRefine` never asked about the yard at all.
* **The yard sets the throughput** — ratio × `FC_REFINE_SCALE` × build index, so a
  13%-built yard refines at 13%. The panel prints the ratio `fcRefine` actually
  uses.
* **One loan at a time across every business.** Each only checked its own
  `s.loan`; `BankEthos.businessLoans` is the shared registry both already wrote
  to and neither ever read.

### 🔴 An anti-exploit round had been crashing, unmeasured

`fuelarb.mjs` lifts the real fuel + order-desk code and evals it. Its **§9**
called `_cxExecuteBuy` → `_cxQuoteOrder` → `_cxFillPrice` → `CX_TRADE_FEE`, none
of which were on its lift lists — so it threw and **§9–§12** (impact sweeps,
typed-price guards, force-trigger dump) were never measured. Verified against
HEAD with HEAD's own harness: it crashes identically, so this predates the
release. Repaired: passes **1014 → 1048**.

**§10f re-dated, not deleted.** It asserted honest buy-and-hold must profit *at
the vendor*, and failed by name — *"the vendor has been neutered, not fixed"*.
Put to the owner with the measurements (1,250 bbl → −141,865); the decision was
to ship the 10× spread: the pump is a lowball counter and the exchange is where a
barrel gets a real price. The measurement is kept with its verdict inverted,
because if the vendor ever pays *more* than the market for held fuel the
arbitrage is back and this is the row that sees it.

**§11 left failing on purpose** (baseline 3 → 4, floor 1000 → 1040). It expects an
override *above* the mark to be charged — `_cxExecuteBuy`'s own comment says
*"you may always choose to pay MORE"* — but the v121v121 refactor replaced that
body with `_cxQuoteOrder`, which takes no override; the parameter is now
`_pxOverride` and never read. The dangerous direction is closed (a low typed price
cannot mint — the sibling row proves it), so only the harmless half is missing and
restoring limit orders is a design decision. Rewriting the check to match the code
would erase the only evidence the feature existed.

### 👤 Two persistence bugs

**"c87" in the city.** Not a GLB — a citizen chat bubble printing the citizen's
*id* as their name. `loadState` already carried a repair, added when this was
reported as *"c55 / c59 keeps appearing"*, whose comment states the rule
correctly — but the regex had lost a backslash: `/^cd+$/` matches a literal "c"
followed by literal "d"s and **never** a real id, so the repair never once fired.
⚠ Its own suite watched it ship: `_citname_smoke` **retyped** the rule into a `vm`
string under the comment *"the shipped expression, verbatim"*, typed it
correctly, and so tested a correct reimplementation while the page did something
else. It now **lifts the real predicate**, verified by reintroducing the typo and
watching it fail.

**The main-menu character that kept coming back.** Three separate places read an
empty roster as "nothing loaded yet" rather than "the admin removed it":
`persist()` refused to write it, the IDB restore put it back, and the catalogue
merge re-adopted the published list. `persist()`'s comment even named the cost —
*"clearing the LAST character is refused here on purpose… the one edit this guard
costs"*. A `mainMenuHeroesCleared` stamp now separates deliberate emptiness from
not-loaded-yet; the accident those guards exist for still cannot erase anything.

### 🎬 Four summon cinematics

**Vintrius** and **Abraxas** — art re-encoded 30MB → 3.7MB; Vintrius's default
source pointed at art not in this repo, so every play fired a failed request
before its `onerror` fallback.

**Hologram** and **Crimson Rupture** — taught the host's existing `?art=`/`?name=`
contract rather than teaching the host their postMessage API, so no second
mounting path. Both are marked `sprite: true`: they rebuild a *figure* out of
light, so they are fed the unit's **sprite**, not its card face. ⚠ Per-entry, not
global — restaging ten existing card-composed cinematics was not asked for.
**Crimson is the default for ACE and mythic-rare**, checked *after* the name map
so a card that names its own cinematic still wins.

Suites: `_fuelexploit_smoke.mjs` (56 checks, runs the arithmetic on the eight real
measured marks), `_citname_smoke.mjs` (repaired to lift the shipped predicate),
`_cinemerge_smoke.mjs`, `_cedricsize_smoke.mjs`.

---

## v121v156 — ⚡ the Elemental Arsenal on moves, and the menu stops rotating characters

### 🧍 The menu shows the live image. Full stop.

> Owner: *"Remove this and stop it from trying to show characters I just want the
> live image at the start showing."*

v155 fixed the **local** half — an admin clearing the Character Manager now has
that clear persist. But the menu never read the local copy alone: `_mdRoster`
returned the admin-curated roster **first**, and "Character 16" was still in the
**published** set. So the entry was gone from the working copy and still on the
screen — which is exactly what was being reported.

⚠ That precedence was a v142 decision of mine (*"an admin-curated roster still
wins… silently overriding it would make that screen a lie"*). The owner has made
the opposite decision explicitly, twice.

⚠ **Removed, not reordered.** Left below Cedric it would be dead code that still
reads as a feature, and the next person would "fix" the order back. The Character
Manager still edits and publishes its list; it simply no longer decides what the
main menu shows. The hero-art fallbacks stay — they are the last thing between a
missing Cedric asset and an empty silhouette.

### ⚡ The Elemental Arsenal, on moves, under the target, 1.5s late

> Owner: *"…so when players select a unit or hero move to attack the VFX play
> Under the target… the Lighting strike VFX should look like its hitting the
> attack target just as like missle. Play the VFX after the Combat Cinematic 1.5
> seconds after."*

**Not one effect function was touched**, and that is the point. All thirteen draw
into a **fixed 1000 × 562.5 logical space**, and the page maps that whole box onto
its canvas:

```
g.setTransform(canvas.width/1000, 0, 0, canvas.height/562.5, 0, 0)
```

Every effect is composed around `x=500` with its ground plane at `y=380` — so that
point is **always** 50% across and 67.6% down the canvas, at any size. "Play it
under the target" is therefore achieved by **positioning and sizing the canvas
element**, and nothing else. Verified live at 1280×800: requested 640,496 → ground
plane landed at 640,496. If those effects are ever revised, the placement keeps
working.

⚠ **Embed mode keeps the demo DOM.** The effect code reads `$('ground')` and
`$('loop')` every frame and would throw on the first render without them, so the
chrome is hidden by CSS rather than stripped. The **ground plate is forced off** —
it is a big opaque ellipse meant to give a preview a floor, and over a battlefield
it blacks out the board. A visit with no `?fx=` is left completely untouched, so
the artist's own preview still works.

⚠ **The anchor is resolved when the effect fires, not when it is scheduled.** 1.5
seconds is long enough for the target to move, die, or the board to scroll, and a
point captured at schedule time would drop the lightning where the unit *used* to
be. No anchor means no effect — a bolt striking empty ground reads as a bug, not
as a miss.

It hangs off `playMoveFx`, which the file already documents as *"decoupled from
the damage math (timed) so it can never change combat outcomes"* — exactly the
property a delayed cosmetic needs. The id rides on `move.vfx` beside the camera
settings, and ⚠ `impactFx` alone keeps that object: without it in the save
condition, picking *only* an impact effect would have saved nothing.

Thirteen entries, one page, selected by index — Lightning is 2 and Missile is 0,
the owner's two worked examples. Authored per move as **⚡ Impact VFX**.

### A suite pin inverted, and a fragile slice fixed

`_cedricvfx_smoke` pinned the roster precedence and failed correctly. Inverted
rather than deleted: it now asserts the **stronger** property — the menu has one
source, so nothing can put a character back on it. It also used a fixed
1400-character slice window that broke the moment the comment above the return
grew; the code was right and the slice was short. Now anchored on the next
function.

Suite: `_elemfx_smoke.mjs` (39 checks; runs the placement arithmetic for real at
three viewports and pins the 1000×562.5 contract the whole integration rests on).

---

## v121v157 — ☁ same cards for everyone, decks that follow you, onboarding that stays done

> Owner: *"The game is still not registering the same on different accounts … the
> effects of some cards are not the same as they have been updated and cards and
> decks are missing plus I have players who say they have to start the game and
> it makes them do the onboarding over and over again … what service I have to
> pay for what do I have to setup?"*

**Nothing needed buying.** The org is already on Supabase **Pro**, `card_catalog`
is a healthy server-side singleton (published the same day, 330 KB of cards +
151 KB of moves, with a Storage mirror fallback), `player_tutorials_seen` is live
with 109 rows across 52 players, and every active profile row had synced minutes
before this was written. **The data was always on the server. Three merge rules
for READING it were wrong — and all three were the same mistake: "local
non-empty wins".** Correct on the authoring device, wrong on every other one.

### 1. Card effects differed between accounts

`Forge.customCards` is stored **per player** inside `user_profiles.forge`, and
`getAllCustomCards()` let a local copy shadow the published one whenever its
`_editedAt` was newer. Measured against the 477-card published catalogue:

| account | private card definitions |
|---|---|
| Sethiroth Tha Dev (author) | 503 |
| Inergy *(last sync Sep 4)* | 248 |
| old test accounts | 240 × 3, 184 |
| Yamuns / LIDS / GreyDragon / Sausage | 4 / 7 / 6 / 1 |
| **Davos, ClareyV** | **0** ← which is why they looked correct |

Each of those can override a republished card with its own older effect text.

Card authoring is **admin-only** (`isAdmin()` is an email allowlist), so a normal
player never authored any of them — they are residue from older builds that
copied the catalogue into the profile. A non-admin now takes the published card
outright.

⚠ The **author is exempt** and still gets local-wins-unless-cloud-is-newer, which
is the only thing that makes unpublished work possible. ⚠ Local entries still
fill **gaps** for ids the catalogue lacks, so nothing a player can currently see
disappears. ⚠ Tombstones still win. ⚠ On any doubt it defaults to *author*, so an
`isAdmin()` that throws cannot silently discard unpublished work.

### 2. Onboarding repeated

`_ensureOnboardingState()` derived "is this player established" from
`Profile.records` — and then **saved** that derivation. On a new device the cloud
row has not landed at first render, so records are empty, `established` is false,
and it stamped `complete = false` onto the profile. The next debounced sync
uploaded it, marking the player un-onboarded **on the server**, so it happened
again next time. **The "over and over" was that write feeding itself.**

`_profileKnown()` now gates it: an offline player is always known (their local
save is the only truth there is); a signed-in player is known once the cloud
fetch answers **either way**; and in the window between, `shouldRunOnboarding()`
does not *decide* and `_ensureOnboardingState()` answers for that render
**without writing**.

### 3. Decks were missing

The side deck and the Realm deck restored from the cloud **only when local was
completely empty**:

```js
if (_localSide.length === 0) { ...adopt cloud... }
```

So a stale one-card local deck shadowed the full cloud copy and the rest read as
missing. The hazard the original guard names — *"a stale cloud copy can never
wipe a freshly-edited one"* — is real; **emptiness was simply the wrong proxy for
it**. It now adopts when local is empty **or** the cloud is fresher, using
`localIsFresher` — computed earlier in the same function, and the discriminator
every other field on that row already obeys. A freshly-edited deck sets it by
definition, because editing calls `saveProfile()`.

### Still open on the server-authoritative goal

Riskier, and deliberately not bundled here because they touch money and
collections: making the cloud profile **adopt rather than merge** on sign-in, and
**versioning the catalogue** so an update force-adopts. Also noted: the card
collection restore is a max-merge (`cv > lv`), so counts can only go up — a card
spent on one device is never removed on another.

Suite: `_cloudauth_smoke.mjs` (39 checks; runs all three decisions for real,
including that a player takes the published effect even when their private copy
is stamped newer, and that a stale local deck now adopts the cloud while a
freshly-edited one still wins).

---

## v121v158 — 🔥 every city building earns, and the money is held until collected

> Owner: *"Make it where city businesses and buildings generate cinder and make
> profit from NPCs Shopping and just based on the building what it produces,
> What the level upgrade it is, the units that is on it … All buildings should be
> bringing and generating profit and cinder cap them all at 150,000 … save the
> profit progress on every building"* and *"they can only have 15k transfer the
> rest is held basically never stopped"*.

### Most of the machinery already existed

`economyTick` already computes, once per tick, every factor named in the ask:
`mult` (tileMult — **level**, crew, adjacency, roads), `om`
(cityOutputMultipliers — city **needs**, morale, plague), the power pre-pass
(**utilities**), and `t.earn`, which is already **per-tile lifetime cinder** and
already read by the Ledger tab. So this adds an **earning rule** and a **holding
pool**, not a second multiplier chain.

### The yield is derived from OUTPUT, not cost — and that was measured first

Only **13 of 139** rows carry an authored `gen.cinder`, and **all thirteen are
retail or leisure** (shops, restaurant, club, cinema, arena, office, gas station)
paying 0.18–0.30/hr. That is the existing model: a shop earns Cinder because NPCs
shop there; a farm earns **food**.

A flat cost-proportional rule was tried on paper and rejected. At the authored
median of 0.346 Cinder per 100 cost it pays:

| building | cost | would pay |
|---|---|---|
| holdco | 11,000 | **38.1/hr** |
| indexfund | 3,200 | **11.1/hr** |
| highrise | 2,200 | 7.6/hr |

against a shop's 0.18 — more than a hundred times, for buildings that produce
nothing, purely for being expensive. That is exactly what the dry-shop block
already warns about: *"copying it is the only way to be sure a new shop is not
quietly the best earner in the game."* Output value avoids it by construction.

⚠ **An authored `gen.cinder` always wins** — those thirteen are hand-balanced
against named neighbours. ⚠ A building that produces nothing earns nothing.

### Three things that were nearly bugs

⚠ **The double pay.** City Cinder *auto-credited*: `economyTick` accrued into
`game.frac.cinder`, and the flush at the bottom is, in the file's own words,
*"the ONE place city Cinder becomes real money"*. Adding a held pool without
removing that would have paid **every Cinder twice** — the money-leak class
`ECONOMY.md` exists for. So this is a **redirect**: production banks to the tile,
and collect pays through the same bridge. Still exactly one payout path.

⚠ **The dead branch.** The production loop is `for (const r in def.gen)`, so a
building with **no cinder key never enters the cinder branch**. A fix written
inside it would have changed nothing for the 126 buildings this is for, while
looking correct. The derived credit therefore sits *after* the loop.

⚠ **The lost pool.** `serialize()` writes tiles from an **explicit field
whitelist**. A pool left off it is rebuilt as 0 on every load — the feature would
have worked for one session and then thrown the money away, which is the same
shape as two bugs already on the tracker (*"Trash Crusher … all the progress has
reset"*, *"Home Stead Farm — builds not saving"*). `hold` now rides the save and
is read back absent-tolerant and clamped.

### The rules, as asked

* accrual never stops until the pool is full
* the pool ceilings at **150,000** per building (`CITY_HOLD_CAP`)
* one collect transfers at most **15,000** (`CITY_COLLECT_MAX`) — ten collects
  empty a full building
* `cityHoldCollect` **puts the money back if the bridge did not deliver**:
  `addCinders` returns false on a refused or failed RPC, and keeping the debit
  would destroy the player's money on a dropped call

⚠ **Lot rent and patron income are deliberately left auto-crediting.** They are
the other two writers to `game.frac.cinder`, and neither is *a building
producing* — rent is land, patrons are footfall. Sweeping them in would silently
change land and venue income. If they should ever be held too, they route through
`cityHoldAdd` exactly as the two production paths now do.

### A gauntlet catch worth recording

§7 **scrapes `loadState`'s tile statement and runs it**, asserting *"every
identifier it reads is one it declares or is given"*. The new `CITY_HOLD_CAP`
clamp was not in that sandbox, so the statement threw — and §7's other two rows
(the 24-hour order round trip, the reloaded level) failed as a **cascade of that
throw**, not on their own merits. Fixed by giving the sandbox the constant
**scraped from source**, not by inlining `150000`: clamping on load is the right
place for it (the pool is money, and a hand-edited save must not present a larger
one than the rule allows), and a literal typed into the harness would keep the
round green through exactly the edit it exists to catch.

### Still to layer on

The node-power / cinder-level and registered-player bonuses, world events
depressing income, and the Collect button in the building panel. The engine is
in; those sit on top of it.

Suite: `_citycinder_smoke.mjs` (41 checks; runs the earning model and the pool
arithmetic for real, including that a farm lands in the shops' band and an
11,000-cost idle tower earns less than a 14-cost farm).
