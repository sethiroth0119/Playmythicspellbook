# 🐛 BUG-TRACKER HANDOFF — 2026-09-22 (cloud session)

55 open reports on the Abraxas Codex tracker, all investigated. Fixed on branch
`claude/optimistic-curie-up22w8`, **against v121v116** — the newest code on GitHub.
Live is **v121v185**, which exists only on the owner's machine. So:

- **Nothing here is deployed.** Every fix must be carried onto v121v185 — cherry-pick the
  commit, or re-apply it by hand where the code moved. One commit per bug (listed below),
  each message naming the root cause, each with a smoke test that fails on the old code.
- The other machine fixed tracker bugs on 2026-09-22 14:03–14:47 UTC (water purity, own +
  another node's PRNs, de-zone on roads, stadium headroom, smelter ingots/re-agents…).
  Check each fix below against v121v185 first — some may already be done there.
- **No version knobs were bumped.** Bump them at deploy as usual, plus the `?v=` busters on
  `pack-opener/index.html`, `src/hubui/tips.js`, `src/hubui/hub-transitions.css`,
  `public/base/app.jsx`, `public/base/hud.jsx`.
- **Nothing was marked fixed on the tracker.** Round 1 needs no SQL; **round 2 (bottom of this
  file) adds five SQL files to apply by hand** — see "SQL to apply by hand". Decisions 1, 2, 5, 6
  and 7 below were made and implemented in round 2.
- Bruce (`claude/magical-edison-kx2o64`) is merged into this branch.

## A pattern worth checking in v121v185 directly
Five separate reports were the SAME defect: a `Profile.*` field saved by `saveProfile()` but
missing from one of the three persistence lists (`loadForge` whitelist, the cloud upload in
`cloudSyncProfile`, the hydration in `cloudFetchProfile`). Every reload/other device reset it.
Found: `gymWars`, `missions`, `seasonPass`, `aiTrade`, `research`, `campWorkforce` (+ camp
route/prestige/name). Audit all `Profile.*` fields against all three lists.

## Fixed — commits to carry over
| Bug(s) | Commit | What it was |
|---|---|---|
| mu83ph17 (high) donations come back | 7dc274b0 | cloud hydrate took MAX(local, cloud) per resource, so a 2nd device re-uploaded the donated stock; also read-only tabs debited only in memory. ⚠ see decision 1 |
| mu17gpcz corp withdraw (request) | 16a11211 | founder button → existing `corp_pay_member_from_treasury` |
| mu7bk9gy mu8x9c2u mu8rh141 mu2s9wa7 Aza | 37cb9f93 | Aza bumped locally + "+N" printed even when `sov_reward` refused; weekly gate counted by start, server by collect |
| mu9clqwc season pass re-claim | a2992c86 | missions/seasonPass never restored on reload |
| mu1i6hd6 mu7azbpf mu8vi4pp AI trades | c77a116f | no daily allowance existed (30 paid deliveries/day headless). ⚠ decision 2 |
| mtyp80rx camp double charge | 3e8869b2 | hire balance adopted without `_gemsTaxExempt` → spend watcher charged again |
| mtyp80rx mu8rpr6s staff vanish | 97663dfd | camp roster missing from `loadForge` |
| mu84559b hire as citizen | c2c00e2f | panel not redrawn from Reconstruction (not reproduced as described) |
| mtyp80rx guards lost | c4e8e6ed | failed mission's cost now shown |
| mucgicr6 research reset | 091a238a | research never uploaded to cloud |
| mu8xil3s Bulwark | 6fbc31ac | Scrap Metal cost hidden from the cost display |
| mu0lf3vw gym trials reset | 31e7bbf8 | `gymWars` never persisted |
| mucgw4pi table count | 8b7fc2dd | badge never repainted; requests unfillable at the Table |
| mucr6azr stadium rations | 57f2d06a | no stash → city mover existed |
| mty87zhi clocks | 5ab0c958 | bunker clock was mock data. ⚠ decision 3 |
| mtr5xz8t mu6bxip6 blank city / "other device" | 4f769e51 | city reads had no timeout; late read overwrote row version |
| mu424ej6 storage warning | 7d8e2f9b + d51b9613 | every opened city cached ~150 KB forever in 5 MB localStorage |
| mu2oevqf stale notifications | 7b61b09e | offline catch-up toasts shown as live |
| mtwtxvg8 mtr5bze0 PRN spawn / startup sequence | 24475705 | city read nodes once at boot, never retried |
| mtwuhbwu PRN level mismatch | b0ce51b1 | Reserve read `level` column, city writes `meta.level`; city exceeded 50 |
| mtsq62mg out of cash | 0afa4b70 | verdict wrong — cash never gates inputs (verified in sim.js) |
| mu2tq6op gas station crude | e020db03 | every rig worked the node's one best seam. ⚠ decision 4 |
| mu2p9ya7 mttyizit structural steel | 75d0d56d | nothing produced Structural Steel; added a plain-steel recipe option |
| mu2oz3ve food feedstock | 596f2b80 | display only. ⚠ decision 5 |
| mu4mc2c8 post a worker | 40007099 | handoff §4 option 1: show boost + cap |
| mtzfzejp mu2wufcq PvP hand | 8acc5c2b | wire stubs adopted as own hand on reconnect; turn-start latch never reset |
| mtylr070 can't end match | 26104622 | concede called nonexistent `MatchBroadcast.send` |
| mtyl7vad crash banner | 8795cfd0 | mobile never fires pagehide/beforeunload |
| mu0pk7ah pack opening | a88a3ae1 | canvas had no CSS size → devicePixelRatio overscale |
| mu0l80ou card shop typing | 830b8ac8 | window-level WASD/E handler reopened the panel |
| mu0kgo44 inventory flicker | 4fdbe3f1 | tooltip engine lost the parked title |
| mu1pbwb4 exchange redraw | 13b8f33c | entrance animation replayed on every repaint |
| mtxkwv4m / mu0minh8 back buttons | 50648f08 / 4c366e60 | moved / added top-left |
| mtxq2arc laptop | 696cafd1 | page zoom not reset when the city iframe opened |

## Not bugs / couldn't reproduce — reply to the player
- **mtyhj5yx wages every 10 min** — each charge is hours actually worked × wage; hourly total unchanged.
- **muctcdw3 manager sees 2 of 9 research points** — bought points belong to the buyer's account.
- **mtyn1mcn Luni water unpaid** — all three matching sales were paid; a seller is paid when their client next opens the market (one took ~6 h).
- **mtzmjvgz Trash Crusher** — all 4 Trash Crusher businesses intact; need the account and whether their corp was shut down.
- **mtw1n1bi / mu6weezm building vanished** — only weather/siege removes buildings, logged as "DESTROYED … at x,z"; ask for that log line.

## Decisions for the owner
1. **Resource sync (7dc274b0):** newest salvage ledger now wins instead of MAX. Stops donated/spent
   items coming back, but the stamp is the device clock, so a device with a clock set ahead can
   win and **erase gains made on another device**. Safer permanent fix: server-side 3-way merge of
   `forge.__salvage__` (also the real fix for **mu8vnos5 ammo not received** — two devices open,
   the idle one's stale stash overwrote the purchase). The read-only-tab guards in the same commit
   are safe on their own.
2. `AI_TRADE_DAILY = 2` per corp per day; client-only (spoofable) — server guard wanted?
3. World-day epoch guessed as 2026-05-23T16:00Z (matches website Day 112 on one sample) — confirm.
4. Seam spread: existing cities' 2nd+ extractor of a type may re-found once on deploy.
5. Nothing makes cooking oil or meat — add an oil press / abattoir?
6. **mucvogzk** 2nd city stalled at ~1,070 🔥/hr = free-tier patronage ceiling (uses pledge tier, not
   city tier) — check the player's tier. Also: all a player's PRN anchors ring EVERY city they own,
   and each city's economy uses `anchors[0]` as its ground. **mucu5m51** population 1206 vs 55 is two
   separate population models plus the same anchor issue.
7. **mtqasoy6** corp cities listed twice — city_profiles keyed by first anchor (unstable order).
   Options: stable per-city key / deterministic anchor / delete extra rows. Touches live data.
8. **mu2s9wa7** 94 Aza — inspect that account's `user_progress.sovereigns` vs wallet_ledger.
9. Lost camp rosters could be rebuilt from "Hired N <Role> from <City>" charge records.
10. Design: water-source highlight on the map (mu2r4z2p); Battle Hall → camp shortcut (mu0pejur);
    top-left back buttons everywhere; 7-day window for evicting other players' cached cities;
    CEO (not just founder) treasury withdraw.

## Environment notes (cloud sessions)
- `npm install --no-package-lock` needed (lockfile out of sync: cannon-es, meshoptimizer).
- `_checkall`: 115 green; 11 red are environment only (no pinned Chromium, two truck `.glb`
  files never committed, missing `.gauntlet/comment-scan.mjs` / `modcheck.mjs` and a few
  scripts, `battleperf` red on the baseline).
- `git stash` is shared across worktrees — don't use it with parallel agents.

---

# Round 2 (same day) — owner decisions implemented

All on `claude/optimistic-curie-up22w8`, still against v121v116. Merge commits (carry each branch's
commits over): fix/persist 73ef00bd, fix/aitradesrv 5a133346, fix/foodchain 91bd434f,
fix/stashsync d4b6971c (+67b4e7f1), fix/packrewards 19f1b57b, web purchases f002a60b,
fix/auctionescrow 644f2cc6, fix/prnhome e8b93342 (+0709b494).

| What | Decision / result |
|---|---|
| **Persistence audit** (persist) | ~60 Profile fields were saved but not restored on a same-device reload, then the blank was uploaded (bought furniture, gems, dice skins, crafted items, businesses, kitchen, rentals, convoys, unit state, Ethos standing hidden inside the Bunkhouse `if`, reset stamps). All fixed; `_persistaudit_smoke` now FAILS on any new unrestored field. |
| **Stash merge** (stashsync) | Server merges each device's stash deltas — fixes mu8vnos5 (ammo) and mu83ph17 (donations) for good. **sql/190** |
| **AI trades** (aitradesrv) | 2 per corp per UTC day enforced server-side, pay bounded. **sql/191** (bounds derived from v116 pricing — re-check if v185 changed `_aiSpotOffer`/`_aiContractTerms`) |
| **PRN per city** (prnhome) | A PRN rings only the city it is sited in; unsited → honest message. Build ceiling + thrive stay player-wide. Existing cities are PINNED to today's economy ground (0 of 866 extractors lose a deposit); new cities get their own ground. city_profiles keyed by map node. **sql/192** |
| **Oil Press + Abattoir** (foodchain) | Meals now run (potato + veg + oil). Open: meat-from-scratch blocked on biomass; 25% of nodes lack soybeans; a "stranded firm" sim tweak doubled meals (not shipped). |
| **Pack rewards** (packrewards) | Season Pass / coupon packs were never delivered (`grantUnopenedPack` didn't exist). Now real packs + a one-time make-good. Decide: "Starter Pack" label vs Basic Pack; `Catalog.coupons` may never reach players. |
| **Auction escrow** (auctionescrow) | Cloud auction bids held server-side. **sql/193**. Later: tighten `cml_upd` once all clients use the RPCs. |
| **Web-purchase forge wipe** (f002a60b) | Receipts written as one key, never the whole forge; whole-row saves no longer erase receipts. **sql/195** |

## SQL status (project ktsiasyjusesawtrwrjc) — updated 2026-09-22 late
**APPLIED to production by Claude via the Supabase connection, owner-approved, each verify query green:**
190 (7/7 ok — this also completed the earlier partial run), 191 (5 rows, bound 598),
193 (2 tables RLS on, 8 policies, 4 RPCs authenticated, 5 helpers not), 195 (3/3 ok).
**Also APPLIED (2026-09-23):** 197 (boe_adjust_balance refuses credits — closed an unbounded
Bank of Ethos mint; the owner pasted it, Claude verified), 196 (faucet_settlements + 4 faucet RPCs;
the owner's paste ran partially — only the table — so Claude re-applied the whole file in one
transaction; verify: RLS true, 1 policy, core+helper not executable, 4 RPCs executable, bounds
188 / 8846 / 6630). The 196 daily caps are uncalibrated estimates (see the calibration query in
the faucets report); the client that calls them is not deployed yet.
**HELD: 192.** It re-keys city_profiles to map-node ids, but live v121v185 still publishes and
filters by PRN id, so applying it before the new client ships would drop members' cities from
the corp roster until they republish, and the live client would recreate the PRN-keyed rows.
Apply 192 AFTER the fix/prnhome client is deployed.

## SQL to apply by hand (Supabase SQL editor, project ktsiasyjusesawtrwrjc)
Paste the WHOLE file into an EMPTY tab, Ctrl+A, Run (a partial selection runs only that part).
Each is idempotent and ends with a verify query. Renumber against v185's `sql/` if needed.
The client works the old way until each is applied; order does not matter.

| File | Verify |
|---|---|
| `sql/190_salvage_merge.sql` | 7 rows, all ok. ⚠ Was run PARTIALLY on 2026-09-22 (functions + trigger exist, table `salvage_sync_devices` missing). Harmless for live clients (they never send `__salvageSync__`), but re-run the whole file. |
| `sql/191_ai_trade_settle.sql` | 5 rows; bound `ninthvein deliver` = 598 |
| `sql/192_city_profiles_rekey.sql` | backup table created; `uuid_keyed` ≈ 10, `dup_owner_node` = 0 (dry run: 9 re-keyed, 45 deleted, 10 kept for open offers) |
| `sql/193_auction_escrow.sql` | 2 tables RLS true, 8 policies, 4 RPCs executable by authenticated, 5 helpers not |
| `sql/195_web_purchases_key.sql` | 3 rows, all ok |

## Still open
- `wallet_credit` is callable by any signed-in client (daily ceiling only) — every Cinder source should get its own RPC like sql/191.
- `mucvogzk` 1,070 🔥/hr = free-tier patronage ceiling (check pledge tier); `mucu5m51` two population models.
- A mayor's resource map shows the mayor's own ground; `campWorkforce` hydration is a blind assign; `lockedSov`/local auctions are client-only.
