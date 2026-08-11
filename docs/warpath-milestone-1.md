# WARPATH — Milestone 1 build log

> **Live status doc.** Updated as the build runs. Piece / round / verdict / remaining gap.
> Scope ceiling is Milestone 1 from the product brief: *4 players → one procedural map →
> one Hero each → one movable camp → six resources → fog of war → turn-based movement →
> resource nodes → three recruitment locations → temporary card pool → player encounter →
> existing card battle → winner/loser returns to map → extraction → permanent rewards.*

---

## Process note — no subagent fan-out was available

The run was specified as a builder/critic fan-out using the Agent tool. **That tool is not
present in this environment** (`ToolSearch` for `Task` / `Agent` / `Explore` returns nothing;
this session is itself a leaf agent and cannot re-delegate). The loop was therefore run as
strictly separated *passes* with adversarial framing, and — importantly — with **real
inspection rather than self-report**:

- A **live PostgreSQL 16 cluster** was started (`/tmp/wpg`, port 55432) so every migration and
  every RPC is actually executed, not eyeballed. `docs/` records the transcript summaries.
- The map generator is exercised by a **Node harness** over thousands of seeds.
- The client screen is opened in **headless Chromium** (Playwright, `/opt/pw-browsers`) and
  screenshotted; failures come from the real console, not from reading the source.
- The JS map generator and the SQL validator share one hash function; a **cross-language
  equality test** runs the same 20,000 inputs through both and diffs them.

Where the protocol called for a blind A/B judge, the honest substitute used was a
**side-by-side rubric pass against the named house-style references**
(`public/main-menu/index.html`, `public/node-city/index.html`, `public/pack-opener/index.html`)
with the rubric fixed *before* looking at our output. This is weaker than a fresh unlabeled
judge and is called out as such in the final report.

---

## Architecture decisions (and why)

**1. The map is a seed, not a table.**
`warpath_runs.seed` is assigned server-side. Both the client and the SQL validator derive the
world from it with the *same* deterministic hash. There are no tile rows — a 48×32 world would
be 1,536 rows per run, and the map is immutable anyway. Fog of war, node depletion and camp
position are the only mutable spatial state, and those *are* rows.

**2. One hash, two languages.** `wp_hash32(seed, x, y)` exists in `public/warpath/warpath-mapgen.js`
and in the migration as `public.wp_hash32(bigint, int, int)`. It is the contract between client
and server: the client says "I harvested the iron node at (14,7)", the server independently
re-derives what is at (14,7) and rejects the claim if it disagrees. This is what stops a
crafted client from inventing a Dragon Heart node.

**3. Run tables are RPC-only.** The `warpath_*` run tables carry `select` RLS for participants
and **no client insert/update/delete policies at all**. Every mutation goes through a
`security definer` RPC that re-validates. This is deliberately stricter than the neighbouring
`tw_*` tables, because hard constraint #4 (temporary state must never corrupt the permanent
collection) is only credible if the client cannot write run state directly.

**4. Extraction is the only bridge.** `warpath_extract()` is the single function that touches
anything permanent. It reads secured loot, applies the extraction cap, and writes to
`warpath_extract_grants` — an outbox the *game client* drains into `Profile.cardCollection` on
next load. Nothing else in the schema can reach the permanent collection.

**5. The Warpath server never resolves a battle.** `warpath_battle_open()` creates a row and
returns an id. The battle itself is the existing `App.battlePrep` → `vsScreen` path in
`public/index.html` — untouched engine. `warpath_battle_report()` consumes a result. The bridge
is a ~180-line additive block in the monolith plus one call site.

**6. The screen is a sub-app iframe.** `public/warpath/index.html`, mounted the way
`node-city` and `ascent-map` already are (`public/index.html:200481`, `:179755`). The monolith
edit is a mount/close pair, a message handler, and a battle-result hook — no changes to
existing flow, and the whole thing is behind `WARPATH_ENABLED`.

---

## Decomposition

Ordered so dependencies come first.

| # | Piece | Real inspectable output | Depends on |
|---|---|---|---|
| **P1** | Deterministic seeded world generation — biomes, resource nodes, recruitment sites, camps-legal terrain, extraction gates, rare landmark | `public/warpath/warpath-mapgen.js` + node harness output | — |
| **P2** | Run/turn state machine + Postgres schema + RPCs (entry, join, move, harvest, camp, recruit, vault, battle open/report, extraction) | `supabase/migrations/20260811000000_warpath_milestone_1.sql`, executed against a live PG16 | P1 (shares the hash) |
| **P3** | The Warpath screen — fog-of-war map, hero movement, camp, encounter draft, vault, extraction, other players | `public/warpath/index.html` opened in headless Chromium | P1, P2 |
| **P4** | Battle bridge + Warpath Gate — the additive hook in the monolith, entry cost, result consumption, permanent grant drain | diff of `public/index.html`, `_synckcheck.mjs` clean | P2, P3 |

Deliberately **out** of Milestone 1 (brief says so): guilds, espionage, diplomacy, world bosses,
20-player servers, camp raiding of *offline* players, Elite/Mythic warpath rarities, crafting
tree beyond Blacksmith I, forward outposts (camp is movable but singular).

---

## Status table

| Piece | Round | Verdict | Remaining gap |
|---|---|---|---|
| P1 mapgen | 3 | **WINS** | Warpath-exclusive *cards* are not minted (deliberate — see below) |
| P2 schema | 5 | **critic-fixed, ready for re-critique** | `warpath_state()` is one big query; fine at 4 players, needs splitting at 20 |
| P3 screen | 5 | **critic-fixed, ready for re-critique** | Risk/reward is thin, and the mock cannot test it — rivals never fight, so the drop rule is untested rather than absent |
| P4 bridge | 4 | **critic-fixed, ready for re-critique** | The general stale-writer clobber is a pre-existing save-layer property; only the two Warpath-owned fields are defended |

### P1 — world generation · round history

**Files:** `public/warpath/warpath-mapgen.js`, `public/warpath/warpath-data.js`,
`public/warpath/_selftest.js`

| Round | What the critic actually did | Verdict | Gap sent back |
|---|---|---|---|
| 1 | Ran `_selftest.js` over 60 seeds | **LOSES** | 11/60 seeds put a structure on top of another — spawns landing exactly on recruitment sites (a free turn-1 draft) and portals on the Barrow Gate. Cause: each structure list was deduped separately (`dedupePoints`), so cross-list collisions were never checked. |
| 2 | Reran 250 seeds — clean. Then dumped seed 1337 to ASCII and *looked at it* | **LOSES** | The four pack biomes were in the top row of cells on **every seed**. `biomeCores` put core *i* in cell *i*, and cores 0-3 are the forced pack biomes, so Dragon Mountain was always north-east. The brief explicitly rejects this ("players shouldn't memorize 'Dragon is always at coordinate 42'"). |
| 3 | 250-seed self-test + a 400-seed quadrant histogram + a card-key resolution check against the live catalogs | **WINS** | — |

**Round 3 evidence.** 250 seeds, all invariants clean:
water 6.5% (range 3.6–10.2%), 452 resource nodes/world (389–534), 49 extraction-material
nodes/world (20–85), smallest pack biome 92 tiles (worst 62). Pack-biome quadrant spread over
400 seeds is now flat — e.g. Dragon Mountain NW/NE/SW/SE = 83/113/112/92. All 63 card keys
referenced by `warpath-data.js` resolve against the real `UNIT_CARDS`/`SPELL_CARDS`/
`TRAP_CARDS`/`LOCATION_CARDS`/`WEATHER_CARDS` in `public/index.html:39625`+.

**The lattice claim.** Water can enclose land, and a connectivity pass would break the
"purely local" rule the SQL mirror depends on. Instead every row `y%6==3` and column `x%7==4`
is declared permanently land — a connected grid spanning the map — and every structure the run
cannot function without is snapped onto it. `_selftest.js` flood-fills from spawn 0 on every
seed and asserts it reaches all 11 structures. That is the invariant, and it is tested, not
asserted in a comment.

### P2 — schema, world mirror and RPCs · round history

**Files:** `supabase/migrations/20260811000000_warpath_milestone_1.sql`,
`supabase/tests/warpath_milestone_1_test.sql`, `public/warpath/_sqlcheck.js`

Inspection was done against a **live PostgreSQL 16 cluster**, not by reading. The migration
was applied for real and the RPCs were called for real.

| Round | What the critic actually did | Verdict | Gap sent back |
|---|---|---|---|
| 1 | Applied the migration; ran `_sqlcheck.js` (JS vs plpgsql) | **LOSES** | 4,794 mismatches. `0x2545f491` had been transcribed as `624134277` instead of `625341585`, so the hash diverged at its final multiply and *every* derived quantity — biome, water, node, structures, path cost — disagreed between browser and server. Everything downstream cascaded from one wrong digit. |
| 2 | Reran `_sqlcheck.js`; wrote and ran the end-to-end RPC test | **LOSES** | `warpath_battle_report` contained `update warpath_battles set spoils = spoils` — ambiguous against the plpgsql local, so *every PvP battle report raised an exception*. Even resolved, it was a no-op. Only surfaced because the test actually fought a battle. |
| 3 | Reran the full test to completion | **LOSES** | Re-entry after extracting matchmade the player straight back into the world they had just left, hit `unique (run_id, user_id)` and threw — **after** the entry ticket had been debited. A player's second run ate their ticket and crashed. |
| 4 | Full test + RLS test **as a non-owner role** + content-table diff | **WINS** | — |

**Round 4 evidence.** 52 assertions pass: 46 gameplay + 6 RLS.
`_sqlcheck.js` reports `JS AND SQL AGREE` across 11,200 tiles, 308 structures, 166 path costs,
and the duplicated content tables (9 recruit offers, 76 discovery rows, 14 building costs,
24 starter cards).

**Two design flaws the critic pass found by reading, not by running:**

1. *Starter cards were extractable.* The 24 loaner cards arrive `secured` on turn 1, so they
   sorted to the front of the extraction query and filled the entire cap with cards the player
   already owned — the mode would have rewarded nothing. Fixed by excluding `source = 'starter'`
   and asserted in the test ("no starter card came home").
2. *Every Guardian dropped an Ouroboros Core*, regardless of which landmark it guarded, which
   flattens the exact "where did you get that?" moment the brief is built around. Each landmark
   now drops its own material.

**The RLS test matters more than it looks.** The gameplay test runs as the table owner, and
owners bypass RLS entirely — so it proved nothing about hard constraint #4. The second block
drops to a plain `authenticated` role and confirms a client cannot insert into `warpath_cards`,
cannot rewrite `warpath_inventory`, cannot move its hero by writing the table, cannot read a
non-participant's run, and — the one that actually matters — **cannot forge a `warpath_grants`
row**, which is the only table that reaches the permanent collection.

### P3 — the Warpath screen · round history

**Files:** `public/warpath/index.html`, `public/warpath/warpath-app.js`,
`public/warpath/warpath-net.js`

Inspected in **headless Chromium** (Playwright, `/opt/pw-browsers`), screenshotted, and driven
through scripted playthroughs — not reviewed by reading.

| Round | What the critic actually did | Verdict | Gap sent back |
|---|---|---|---|
| 1 | Opened the page at 1440×900 and looked at the screenshot | **LOSES** | The world was invisible. Unexplored tiles were filled `#08070d` against a `#07060b` page, so 95% of the screen was indistinguishable from the background and the map read as a bug. The camera also pinned the map to one side instead of centring it, and the gold reachability overlay was painted over **unexplored** tiles — a fog-of-war leak that showed which hidden tiles were water. |
| 2 | Re-screenshotted; then ran a scripted 26-turn playthrough through the real RPC surface | **LOSES** | **The mode was unplayable from most spawns.** The run harvested 26 nodes over 14 turns and finished with *zero wood*. Every building needs wood, so it could raise neither a Supply Tent (vault stayed at 0 slots) nor a Recruitment Tent (no recruiting at all, for the entire run). It harvested a **Dragon Heart and lost it at extraction** because there was nowhere to secure it. Wood only appeared in the forest and plains node tables. |
| 3 | Replayed after the fix; drove the recruitment modal through the real DOM | **ready for independent critic** | — |

**Round 3 evidence.** A scripted expedition now completes the whole loop: pitch camp → gather →
draft cards from discovery encounters → return → secure → build Supply Tent → travel to a
recruitment site → travel to the Warpath Gate → 2-turn extraction countdown → EXPEDITION
COMPLETE. Materials now actually come home (`{"void_crystal":1,"ancient_bone":3}`), which was
impossible before. No page errors in any run.

**The balance fix, in all three copies.** Wood was added to the mountain/wastes/graveyard/
facility node tables (scarce, never absent), and a `STARTING_STIPEND` of 🪵25 🍖20 🪨15 🪙10
arrives secured. The stipend is deliberately sized to buy **one** tier-1 tent, not both — the
SQL suite asserts exactly that, so a future "make it more generous" edit fails the test.

**Renderer boundary.** Per the map bar, `warpath-app.js` no longer paints terrain. It owns fog
*state*, the actor list, camera, input, panels and modals, and calls
`WarpathRender.bakeTerrain(seed)` / `.draw(ctx, opts)` / `.screenToTile(...)`. Two things are
deliberate: the reachability overlay is filtered to explored tiles **before** it reaches the
renderer (the paint layer cannot know it would be leaking fog), and if the module is absent or
throws, a plain fallback painter takes over so the screen degrades instead of going black. The
404 for `warpath-render.js` was confirmed in the browser and the fallback engaged cleanly.

### P4 — battle bridge and the Warpath Gate · round history

**Files:** `public/index.html` (+411 lines, 0 deletions), `public/main-menu/index.html` (+6)

| Round | What the critic actually did | Verdict | Gap sent back |
|---|---|---|---|
| 1 | Booted the real `public/index.html` in headless Chromium and probed the bridge | **LOSES** | The `MD_SECTIONS` entry carried a `hidden:` predicate that **nothing reads** — `_masterMenuHtml` maps over every section unconditionally. A reader would have believed the mode could be hidden from the menu when it could not. Also: the mode was only reachable from the *classic* menu; the cinematic `public/main-menu/` iframe routes by label and had no Warpath button, so most players would never find it. |
| 2 | Re-probed; exercised the gate with a stubbed `Cloud`; ran the whole suite again | **ready for independent critic** | — |

**Round 2 evidence** (all from a real browser, not from reading):

- Monolith boots, `NO PAGE ERRORS`, `render` intact, `getAllHeroes()` = 6, `DECK_SIZE` = 40.
- `MD_SECTIONS.length` 7 → 8; the classic menu binds by index so an 8th entry is safe.
- **The RPC whitelist actually refuses**: `_warpathRpc('boe_withdraw')` →
  `refused: warpath: boe_withdraw is not a permitted call`. The iframe is same-origin and could
  otherwise have asked the parent to proxy any RPC in the database, including the bank's.
- `warpathPadDeck(['unit:goblin','unit:wolf','trap:spikes'])` → 40 cards, every one resolving
  through the real `resolveDeckCard`.
- The gate overlay opens, lists 6 heroes, enables entry only after a hero is picked, calls
  `warpath_state` then `warpath_enter`, mounts the iframe, and **leaves `App.screen`
  unchanged** — the whole entry flow is a body-level overlay, so `render()` and the screen
  router are untouched.

**Why the diff is 411 lines and still additive.** One contiguous host block, plus exactly three
one-line hooks, each guarded by `App._warpathAfter` — which is only ever set when a battle
carrying `battlePrep.warpath` finishes. With the mode off, nothing sets it and the hooks are
dead code. `localStorage.hg_warpath = '0'` is the kill switch, mirroring `hg_ascent_map`.

**The architectural rule, in the diff.** `warpathStartBattle()` builds an ordinary
`App.battlePrep` and sets `App.screen = 'vsScreen'` — the same path ranked, roguelite and gym
battles take. No engine change, no Warpath combat code. `warpathAfterBattle()` reports the
verdict the engine produced through `warpath_battle_report`, which is race-gated server-side,
so an authoritative server reporting it later instead is a no-op rather than a conflict.

**Renderer integration.** `warpath-app.js` was reconciled to the landed `WarpathRender 1.0.0`
contract (`opts.cam` / `opts.reach` / `opts.fogState` / `opts.fogKey` / `opts.markers`,
`bakeTerrain(seed, opts)`, `screenToTile(cam, sx, sy)`). At time of writing that module has a
**syntax error at line 109** — a stray `*/` leaves comment prose outside the comment, so
`window.WarpathRender` is `undefined` in the browser. The screen stays fully usable because the
adapter falls back to the plain painter, which is exactly what the fallback is for. That file is
another agent's and has been left untouched.

#### P4 round 3 — independent critic verdict: LOSES. All findings fixed.

The critic confirmed at line level that constraint #1 holds (0 deletions, 6 hunks, byte-identical
boot against a `3a8f800~1` baseline) and then found that **the grant drain destroyed player
cards**. Every fix below was re-verified in a real browser with a **real MultiTab election**
(two pages in one Playwright context — shared `localStorage` and `BroadcastChannel`), stubbing
only the network.

| # | Finding | Fix | Verified |
|---|---|---|---|
| 1 | **Permanent card destruction.** The drain ran on a timer in *every* tab. `warpath_grants_claim()` marks delivered in the same call that returns, then `saveProfile()` returns early in a non-writer tab. Server said delivered, disk had nothing, server had nothing left to re-issue. | Split the RPC into **`warpath_grants_pending()` (read-only)** and **`warpath_grants_ack(ids)`**. The client now: writer-tab gate → peek → apply → `saveProfile()` → **read the blob back and prove the cards are on disk** → roll back if not → only then ack. | Reader tab: `rpcLog: []`, `serverStillOwes: 1` — it does not even call. Writer tab: `persisted: 2`, `acked: ["g-1"]`. |
| 2 | A malformed key threw outside the try and took the grant with it. | Whole apply loop guarded; `_wpResolveGrantKey` rejects non-strings before `resolveDeckCard`. | `card_keys: [null, 42, 'nonsense', {a:1}, …]` → `threw: null`, grant still applied and acked. |
| 3 | No validation: 30 copies wrote `copiesNow: 34`; `{"<img src=x onerror=alert(1)>": 5}` landed in `Profile.warpathMaterials` and travels via `buildExportPayload`. | Copies clamped by **`_cardCopyLimit`** (so Banned/Limited cards cannot arrive this way either); material ids checked against the six the mode defines. | 10× `unit:wolf` → `wolfCopies: 3` (MAX 3). Hostile key dropped: `materialKeys: ["void_crystal"]`. |
| 4 | No local idempotency — the server's claimed flag was the only defence. | Local ledger keyed on `grant.id` in `hg_warpath_grants`, written before the ack. | Same grant id offered twice → `goblinAfterReplay: 2`, not 4. |
| 5 | Whitelist decorative; prototype keys (`constructor`, `toString`, `__proto__`) all passed. | `Object.create(null)` + `hasOwnProperty`. **Comment corrected** — it is a guardrail against mistakes, not a security boundary; same-origin frames are not one, and the real boundary is RLS. | All five prototype keys and `boe_withdraw` → `refused`; `Object.getPrototypeOf(WARPATH_RPCS)` → `null`. |
| 6 | `p_hero_name` uncapped/unsanitised server-side. | Stripped to `[alnum space ' _ -]` and capped at 24 chars in `warpath_enter`; `hero_id` capped at 64. | `<img src=x onerror=alert(1)>Bob` → `img srcx onerroralert1Bob`. |
| 7 | Flag-off dishonest; `WARPATH_ENABLED` referenced but never existed. | Both menus hide the entry; `mm:data` carries `warpath`; the phantom comment is gone. | Flag off → `inClassicMenu: false`; flag on → `true`. |
| 8 | Default-on cost every signed-in player an RPC on boot. | Gated on `hg_warpath_seen`, set only on a successful `warpath_enter`, plus the writer-tab gate. | A plain boot makes no Warpath call. |

**Rollback path** (not in the critic's list, added because the ordering fix demands it): with
`localStorage.setItem` throwing `QuotaExceededError` on the profile key, the grant is rolled out
of memory, nothing is acked, `serverStillOwes: 1`, ledger empty — and the retry after recovery
lands it exactly once.

**Baseline re-run:** 9 console errors before the Warpath commits, 9 after, identical set.

#### P2 round 5 — independent critic verdict: LOSES. All six findings fixed.

The critic ran against a real PG16 with Supabase's actual role shape and confirmed the
direct-write half of constraint #4 holds completely, that extraction cannot be forged or
replayed, and that re-derivation is exact across **118,800 tile-field comparisons** on 18 seeds.
Then it found the mode was not multiplayer.

| # | Finding | Fix | Verified **concurrently** |
|---|---|---|---|
| 1 | **The lobby could not form a shared world — 4 entrants → 4 separate single-player maps, 12/12 rounds.** Cold: all four ran the SELECT before any INSERT committed (READ COMMITTED). Warm: `for update skip locked` made every concurrent joiner *skip* the open run and fork a new one. `skip locked` prevented slot collisions by making the lobby unable to fill. | `pg_advisory_xact_lock(hashtext('warpath_lobby'))` before the SELECT, and a plain blocking `for update`. `unique (run_id, slot)` still backstops. | **12/12 rounds now form a full four-player world** — 4 psql processes on a wall-clock barrier, 6 cold + 6 warm. `dup_slots=0`, `over_capacity=0`, tickets spent == expeditions created, every round. |
| 2 | `wp_level()` returned **NULL** for a campless hero and 5 of 6 callers didn't coalesce. A campless hero passed the Recruitment Tent gate a camped one failed; and `6 + 3 * NULL` → NULL made `limit cap` into **`LIMIT ALL`** — 41 cards into `warpath_grants` where the cap was 6. | One `coalesce` inside `wp_level`. | Campless hero refused the rank-4 offer; campless extraction returns **exactly 6** of 30 secured cards. |
| 3 | `wp_reveal` / `wp_log` are security definer, mutating, take an arbitrary expedition id, and the grant loop only matched `warpath\_%` — so they kept EXECUTE **TO PUBLIC**. One REST call cleared another player's fog (34 → 1320 bits). | Revoke EXECUTE on every `wp_*` from `public` and `authenticated`, re-granting only `wp_in_run` / `wp_is_mine`, which RLS policy expressions evaluate as the querying role. | `has_function_privilege` asserts both directions. |
| 4 | The fog leak the code argues against existed **via the table**: `wp_exp_sel` granted SELECT on the whole row, so PostgREST returned `x=37 y=3 hp=100` for an unseen hero. | `wp_exp_sel` and `wp_camps_sel` restricted to own rows. Rivals arrive only through `warpath_state()`, which applies fog. | A rival's row reads 0 as `authenticated`; own row still readable; **`warpath_state` still returns rivals** (verified as the role, not the owner). |
| 5 | PvP was free and repeatable — nine battles in one turn, zero movement, stripped a neighbour to nothing. | 2 movement per challenge (1 for a Guardian) and no repeat pairing in the same turn (`opened_turn`). Self-declared victory is left alone: it is inherent to the repo's existing client-authoritative MP model. | Cost, cooldown and the no-movement refusal each asserted. |
| 6 | `seed bigint` had no `CHECK` — negative seeds are the one input where JS and plpgsql drift, asserted only in a comment. | `CHECK (seed >= 0)`. | Insert of `-1` raises `check_violation`. |

**A harness bug worth recording:** the first concurrent run still showed 0/12, because the test
stub stored `auth.uid()` in a *shared table* — four concurrent sessions overwrote each other's
identity. The bootstrap now uses a session-local GUC (`request.jwt.claim.sub`), which is what
Supabase actually reads. Any concurrency result taken with the old stub was meaningless.

Suite is now **62 assertions**: 47 gameplay + 6 RLS + 8 regressions + 1 fog.

#### P3 round 4 — independent critic verdict: LOSES. Gap plus five of seven fixed.

The critic re-tested the economy fix properly (28 runs, 28 seeds, fog-honest bot) and confirmed
it: **28/28 built Supply Tent I on turn 1**, every extraction came home with 2–7 materials, and
**zero rule refusals in 28 runs** — every button's enabled state agreed with the server. Its
summary: *playable, but not yet worth playing.*

| # | Finding | Fix |
|---|---|---|
| **GAP** | **The draft modal was a blind pick.** Three identical biome icons, a title-cased id and a category word — no name, cost, stats, element, text or art. The mode's entire identity is that choice, and `cardName()` carried a comment claiming the catalogs were out of reach. | They were one postMessage away. `warpath:cardmeta` now carries the **real catalogs** from the parent (including admin-forged cards); `warpath-data.js` ships a generated fallback for standalone use. `cardFace()` renders name, type + cost, elements as tinted pills, the full 6-stat block, passive/flying, and the card's own text. Used by the draft, the recruit modal and the pool list. |
| 1 | Recruitment fired 7 times in 28 runs. Tent I cost 🪵30 against a 🪵25 stipend — five short, so the "turn-1 choice" was not one. And **building spends `secured` while recruiting spends `carried`**, with no withdraw and no explanation. | Tent I is 🪵25 — you can afford **either** tent on turn 1, never both. The two wallets are now stated outright in the Hold panel, build costs are tagged `secured` and recruit costs `carried`. |
| 2 | *"Nothing to deposit."* was shown exactly when the player was losing materials — the vault warning only fired when something else moved. | The no-vault / vault-full warnings fire on their own, count the materials at risk, and name the building that fixes it. |
| 3 | No risk/reward: securing was free and always correct; a loss only took carried *resources*, worthless once banked. | A PvP loss now also drops your newest **unsecured card** (server + mock). Pushing deeper costs something. |
| 5 | `DECK_FULL` (40) vs `DECK_MILESTONES` (→60) clamped the 46/52/60 ticks onto one pixel; the HUD hardcoded "→ 25" against a 24-card starter pool. | Bar scales to the last milestone with `DECK_FULL` marked as its own line; the "25" is gone. |
| 6 | **Phone layout broken** — the 340px dossier covered 87% of a 390px screen, the map was a 50px strip, and every action button was buried. | The panel is a collapsing bottom sheet on narrow screens. Measured at 390×844: map visible **802px** (was ~50), rail above the sheet, End Turn on screen. |

**A bug the critic did not find, surfaced by the fix:** `location:siphoned` sat in the facility
discovery table and **is not a card** — it is a status effect declared inside one. The original
"all 63 keys resolve" check pulled ids out of `index.html` with a regex that also matched nested
objects. Drafting it would have handed the player a card that resolves to nothing: dropped from
the battle deck, dropped again at extraction. `_selftest.js` now `eval`s the catalog arrays —
the only check that agrees with `resolveDeckCard()` — and `_sqlcheck.js` caught the SQL copy
still holding the bad key.

**Deliberately not fixed, and why:** items 4 (Expedition Gold and Food have almost no sinks) and
5's volume half (3–13 cards found against the brief's ~40) are balance, and **the only evidence
available is the offline mock — which the critic itself warns flatters the design**: a rival
entered vision zero times in 28 runs and the mock hardcodes `camp: null` for every other player,
so it measures a solitaire resource walk. Tuning the economy against that would be fitting to the
wrong game. These need a real four-player run first.

**Item 7, stated honestly:** fog of war is **server-enforced but client-transparent**. The server
will not tell you where an unseen hero is (and, after the P2 fix, will not let you read it off
the table either) — but `S.world = M.generate(seed)` means the client holds every tile, the
landmark's identity and all four spawn points. Anyone with a console can read the map. Milestone 1
does not close this; doing so means streaming tiles instead of deriving them, which trades away
the "world is a seed" architecture. It is a real asymmetry gap, not a solved one.

#### P4 round 4 — independent critic verdict: LOSES. Three findings, all fixed.

The critic confirmed round 3 held — `warpath_grants_ack` survives forged/mixed/100k id arrays,
the two-tab kill is closed, all 26 hostile card keys drop, Banned→0 / Limited→1 / plain→3,
materials `-3` dropped and `1e9`→999. Then it found the reward was being destroyed anyway.

**GAP — `Profile.warpathMaterials` was written and never read back.** The profile loader at
`:65896`+ is a field-by-field allowlist; `p.cardCollection` is restored, `p.warpathMaterials`
had **no clause anywhere** (`grep -c 'p\.warpathMaterials'` → 0). Every extracted Dragon Heart,
Void Crystal and Ouroboros Core survived in memory until the next reload and was then dropped —
*after* the grant had been acked and was unrecoverable. 100% of extractions, one tab, no race,
just F5. Hard constraint #4 failing in the direction that matters: run state crossed the bridge
and the permanent side ended up with nothing.

**The general audit the critic asked for.** Every `Profile.*` key the Warpath block writes,
checked against both persistence paths:

| Key | Local loader `:65896`+ | Cloud round-trip |
|---|---|---|
| `Profile.cardCollection` | ✅ `:66030` | ✅ `__cardCollection__` piggyback |
| `Profile.warpathMaterials` | ❌ **missing** → fixed | ❌ **missing on both sides** → fixed |
| `Profile.decks` (`warpath_run_deck`) | ✅ `:66007` | n/a — transient battle deck, same as `rlc_run_deck` |
| `Profile.heroes` | read-only in this block | — |

So it was worse than one clause: materials were absent from the **cloud upload and the cloud
restore too**, meaning a material extracted on a phone never existed on a laptop. Three fixes —
loader clause, `__warpathMaterials__` piggyback in `forgeSmall`, and a MAX-merge restore matching
the `__itemInventory__` policy. Verified: `{"dragon_heart":2,"void_crystal":3,"ouroboros_core":1}`
survives reload *and* a subsequent save; cloud merge takes `dragon_heart 1→7`, keeps a local-only
`void_crystal 5`, adds `ouroboros_core 3`; both piggybacks confirmed inside the object that
becomes `rowRaw.forge`.

**2 — the read-back proof compared a delta against an absolute.** It asked "does disk hold ≥1
copy?" rather than "before + delta?", so on an untouched disk it returned `true`. It now takes a
BEFORE snapshot as ids are touched and asserts `after >= before + delta`. Verified both ways:
no-write → `proofSays: false`; real write → `true`. The election is also re-checked **after** the
`pending()` await, since promotion needs only `STALE_MS` and the await is a network round trip.

**3 — a promoted writer clobbered the persisted blob.** `_amWriterCheck` (`:67103`) flips
`amWriter` true and reloads nothing, so a reader tab promoted after boot writes its boot-time
`Profile` over everything since. Reproduced with two real tabs and the genuine election. Fixed by
registering through the existing `onMultiTab()` listener registry — on the reader→writer edge,
the two Warpath-owned fields are reconciled from disk (disk wins; a reader's in-memory divergence
was never going to be persisted anyway). Also runs immediately before applying a grant.
Verified: B promoted, B saves, `diskWolf: 1, diskOre: 4` intact — previously `{}`.

**Scope I did not take, stated plainly:** the general stale-writer clobber is a **pre-existing
property of the save layer** and affects every field, not just ours. Rewriting the election to
reload on promotion is the correct global fix but it is a change to the core save path, which
constraint #1 says not to risk from here. This defends the property the Warpath put at risk and
leaves the general bug documented rather than silently half-fixed.

**Also fixed:** the vault-ceiling assertion was **seed-dependent** — on some seeds the harvest
step banked a second extraction material that competed for the same five slots, so it read 4 and
passed only by luck. The rule was right; the test now clears other materials first and is stable
across three consecutive runs.

**Baseline re-run:** 20 console errors before, 20 after, identical set.

#### P3 round 5 — independent critic verdict: LOSES. Gap plus four fixed.

The critic confirmed the draft fix at scale: **659 encounters across 60 runs**, 61 of 63 catalog
cards appearing, no duplicate keys inside a triple, 4.1% single-type triples. Funded Tent I built
turn-1 **30/30 on both branches** with a real exclusive fork (Recruitment-first: 27 recruits,
12.8 cards discovered; Supply-first: 7 recruits, 8.33 materials home). Recruitment went from
**7 recruits in 28 runs to 34 in 60**. Zero pageerrors across ~400 interactions and 120 runs.

**GAP — the phone panel could never be opened.** `#side.open` is the class that raises the bottom
sheet and **nothing in the codebase ever added it** (`grep` for `classList.*open` → nothing);
the only toggle shipped was `classList.toggle('hidden')`, and under the breakpoint `hidden` and
the default state resolve to the *same* transform. So on every viewport ≤900px the camp builder,
both wallet explanations, the extraction-cap readout, `#f-secure` and `#f-extract` were all
unreachable — and since `#b-endturn` disables at `status === 'ready'`, **a phone run could not be
completed at all**. "802px of map, up from ~50px" was true and was a regression: the old layout
buried the map under a usable panel, the new one buried the panel under a usable map.

Fixed with a viewport-aware `setPanel()`: `open` under the breakpoint, `hidden` above it, the rail
pushed clear via `body.sheet-open`, a breakpoint-crossing resize handler that re-normalises, and
tab presses raising the sheet (the tab strip *is* the visible lip of a closed sheet). **Measured,
not screenshotted** — `#sidebody` top coordinate and `elementFromPoint` hit-testing:

| viewport | closed | after tapping the handle |
|---|---|---|
| 390×844 phone | `body.top=845` · inView **false** · camp/secure **false** | `cls=open` · `body.top=414` · inView **true** · camp **true** · secure **true** |
| 820×1180 tablet | `body.top=1181` · inView **false** | `cls=open` · `body.top=562` · inView **true** |
| 899×600 edge | `body.top=601` · inView **false** | `cls=open` · `body.top=307` · inView **true** |
| 1440×900 desktop | inView **true** (unchanged) | `cls=hidden` collapses as before |

`#f-extract` on a phone: present and **tappable at y=800–832 in an 844px viewport**, with End Turn
still reachable throughout. A phone run can be finished.

| # | Finding | Fix | Verified |
|---|---|---|---|
| 1 | Escape or a reload discarded a pick irrecoverably — the server kept `picked:null` but nothing re-opened it and `#b-act` stayed disabled. | The action button offers **"Open encounter"** on that tile, and a pending encounter under the hero re-opens itself on load unless explicitly dismissed. Matters more live, where a dropped connection is normal. | `autoOpenedOnRefresh: true`, `actBtn: "Open encounter"`, enabled. |
| 2 | `why()` said "you have 0" without naming the wallet — `cannot_afford_carried` on **122 site visits** against 34 hires. | Server returns `wallet: 'carried' | 'secured'` on both refusals; the client names it *and* reports the other wallet's balance with the reason it cannot help. | Two new SQL assertions: build refusal names `secured`, recruit refusal names `carried`. |
| 3 | `warpath-data.js` still advertised the old 🪵30 cost. | Corrected, plus a note that raising it again without raising the stipend silently removes the decision. | — |
| 4 | `warpath_extract_begin` had no already-extracting guard **in the mock**; the critic could not check the server. | Mock guarded. **The server already was** (`status <> 'active'`) — but that is now an assertion rather than a reading. | Mock: second call `not_active`, countdown `1 → 1`. SQL: countdown unaffected, and an *extracted* hero cannot begin again. |

**Disclosure, the one risk/reward change made without guessing.** Extraction committed on one
click and reported the outcome only afterwards. It now shows exactly what is coming home *before*
committing, with an explicit warning when nothing is secured — the critic's own case rendered as:
*"Cards coming home · 0 / 6 — Nothing you found out here is secured, so no cards will come home."*
plus a **Stay out here** button that leaves the run untouched (`status: 'ready'` after cancelling).

**Held the line on the risk model.** The gate is a median 2.7 turns away, `warpath_secure` still
flips every unsecured card free, and only a PvP defeat costs a card. Those are real, but the mock
saw rivals adjacent **64 times and fought zero battles** — its rivals never challenge, build or
extract, and it hardcodes `camp: null` where the server returns rival camps. The card-drop rule,
injury/retreat, `waiting_for` turn sync and camp discovery are **untested, not absent**. Tuning
them against a solitaire harness would be fitting to the wrong game.

Suite is now **66 assertions** (47 + 6 RLS + 8 regressions + 1 fog + 2 extraction guards + 2 wallets).

**Known P1 gap, deliberately not closed:** no Warpath-*exclusive* cards are minted. Doing so
means writing new entries into the card catalog inside the 215k-line production monolith, which
is the one thing hard constraint #1 says not to risk. Exclusivity in Milestone 1 is expressed
as *where* a card can be drafted and how scarce it is, and every grant carries an
`acquisition: 'warpath'` provenance tag so a real exclusive set drops in later without
re-plumbing. Reasoning is in the header of `public/warpath/warpath-data.js`.
