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

#### Four-player harness round — B1 (P0) through B9

The simulator (`tools/warpath-sim/`) ran four real sessions against real Postgres and found what
nine review rounds could not, because every previous round had been run against the offline mock.

**B1 (P0) — the shipped client could not perform a single mutating action.** Every mutating RPC
took `p_exp uuid` as its first argument **with no default**, and nothing in `public/` ever sent
it. PostgREST resolves by argument *name*, so all eleven call sites failed with PGRST202 before
reaching the database — and `public/index.html` rewrote that into *"The Warpath is not installed
on this server yet"*, which reads like a deployment note. End turn and Abandon were both dead,
and since a run can only close inside `warpath_end_turn`, `warpath_enter` then answered
`already_in_a_warpath` forever: **a player paid a ticket or 3 AZA and was locked out permanently.**

Fixed by **deriving the expedition server-side from `auth.uid()`** (`wp_active_exp()`), not by
making the client pass an id. That is strictly stronger — a client cannot name an expedition it
does not own, because it never names one at all — and it removes eleven call sites that each had
to get it right. Passing `p_exp` explicitly still works and is still ownership-checked, which is
what the SQL suite and the simulator do.

**The systemic fix matters more than the bug.** `warpath-net.js`'s offline mock *reimplements* the
RPCs in JavaScript with its own signatures — it is not an optimistic server, it is a **different
API**, and nothing compared the two. `public/warpath/_contractcheck.js` now scrapes every
`rpc(...)`/`act(...)` call site out of the shipped client, reads the real signatures from
`pg_proc`, and applies PostgREST's own resolution rule. Proven to catch the regression: reinstating
`p_exp` on one function alone produces `FAIL public/warpath/warpath-app.js:954 warpath_move(p_x, p_y)`.
(Its first version had three false positives of its own — a loose regex matching `expedition_id :`
inside a ternary — now fixed with balanced-bracket parsing, because a contract test that cries
wolf gets switched off.)

| # | Finding | Fix | Verified |
|---|---|---|---|
| **B2** (P0) | Four simultaneous `end_turn`s neither advanced the clock nor avoided deadlocking — 7/30 rounds advanced zero times, 20 raw `40P01`s returned to callers. Each transaction set its own flag then counted the others in the same READ COMMITTED snapshot; on retry all four ran the advance block in ABBA order. | `pg_advisory_xact_lock(hashtext('warpath_turn:' || run_id))` — the same medicine `warpath_enter` already took for the lobby, keyed per run. | **30/30 rounds advance exactly once, 0 deadlocks.** |
| **B3** | Losing a battle did not interrupt an extraction — a hero beaten mid-countdown finished extracting two turns later from nowhere near a gate. | Defeat resets `status` to `active` and `extract_left` to 0, and logs `extraction_broken`. | Asserted; probe P7 passes. |
| **B4** | A hero could be pinned at its own camp indefinitely (8 turns in a probe) — defeat teleports the loser home with `moves_left = 0` and there is no death. | `protected_until` grace of 2 turns after a PvP defeat; `battle_open` refuses with `target_regrouping`. | Asserted; probe P8 reports the refusal. |
| **B5** | A PvP verdict was decided by whichever client posted first. | **Conceding is believed immediately** (nobody lies to lose); **agreement** resolves immediately; a **bare win claim waits** and is settled by a sweep at the next turn boundary, so a silent opponent cannot freeze two heroes. | Probes P5/P6: two contradictory claims settle **neither**, the battle stays open, and the turn sweep resolves it. |
| **B6** | The extraction broadcast published exact coordinates to everyone, ignoring fog — the harness's hunter used it as a homing beacon. | Names the **gate**, not the tile. Anyone who has explored that gate can act on it; anyone who has not gets the warning without a map pin. Decided on purpose and documented. | Probe P7 shows the payload is now `{gate, hero, turns}`. |
| **B7** | `turn_ended` was a readiness flag, not a lock — after ending a turn a hero still had full movement. | Guard in move / harvest / camp_place / camp_build / secure / recruit / battle_open / extract_begin. | Asserted; probe P1 passes. |
| **B8** | The completion screen lied twice: `cards_secured` was `null` (`array_length` on an empty array), and `resources_extracted` counted the 70-unit starting stipend that `warpath_grants` never carries home. | `coalesce(..., 0)`, and the honest number — `resources_gathered`, read from the node claims actually made. | Asserted both ways; probe P11 shows a clean empty-run summary. |
| **B9** | The loser was told nothing — `hero_defeated` was in `warpath_state` but nothing read it, on a 12s poll. | `announceNewEvents()` surfaces anything that happened *to me* since the last read; poll tightened to 5s. | — |

Suite is now **71 assertions**; probes **20 passed, 0 failed**; the four-player sim completes runs
with real extractions and materials home.

#### PvP visibility — information, not proximity

Built pieces **1, 3 and 4** of the agreed plan. Piece 2 (the spawn ring) is **held** pending a
look at a real turn-1 frame.

**Instrumented first, and baselined before touching behaviour.** The measurement is *"did this
player ever learn the other three exist"*, not battle count — battle count is hunter-dominated
(one bot produced every battle in the mixed batch) and says nothing about the other three.
`tools/warpath-sim/` now records five signal channels per player and their union (`aware`).

| signal | nohunter (control) | mixed |
|---|---|---|
| | before → after | before → after |
| received **any** signal | 81% → **83%** | 75% → **83%** |
| saw a rival hero | 75% → 63% | 63% → **79%** |
| discovered a rival camp | 25% → 21% | 44% → **50%** |
| extraction warning | 75% → 75% | 75% → 75% |
| **Watchtower report** | **0% → 17%** | **0% → 13%** |
| actually fought | 0% → 0% | 56% → 46% |
| runs with any camp found | 3/4 → 4/6 | 4/4 → **6/6** |

*(4-run baseline, 6-run after; single-digit percentages here are noise.)*

**Battle count did not move — and that is the pass condition we agreed.** PvP went 5.25 → 4.00
per run in mixed and stayed at 0 in the control. What moved is the thing that was measured for:
a channel that reported *nothing at all* now fires, and in the mixed roster every run ends with
a rival camp discovered.

**The Watchtower was a broken promise, and that is a finding in its own right.**
`warpath-data.js` has advertised *"Enemy camps within 8 tiles are reported"* since the first
commit; the building costs 🪵40 🪨20 and the effect was **implemented nowhere**. Any player who
built it paid for a fog bonus and a lie. It now reports rival **camps** — never live hero
positions; that is what fog is for — by revealing the camp tile in the observer's own fog, so it
flows through exactly the same explored-once path `warpath_state` already uses.

**And its advertised range was wrong for the world it shipped into.** At 8 tiles it reported
**0%** on the mixed roster: spawns land 29–35 tiles apart, so an 8-tile tower covers ~0.5% of a
44×30 map. The radius is now tied to the thing that decides whether it can ever fire — Tower I
reaches 12, Tower II reaches 20, so a fully-upgraded tower can just about see its nearest
neighbouring spawn and never the whole map. The advertised text was corrected to match.

**Extraction reciprocal (3).** `warpath_extract_begin` now returns how many rivals have explored
*that gate* — exactly the set who can act on the broadcast, since B6 stripped the coordinates. A
neat consequence fell out of testing: the **main gate always reads as watched**, because
`warpath_enter` reveals it to every entrant by design. So "two turns at the Warpath Gate" and
"two turns at a portal nobody has found" are now visibly different decisions, priced before you
commit.

**Scout Report (4).** One movement, once per turn, at your own campfire. Adds **no** information —
it re-surfaces rival camps already in your explored fog as a direction and a distance band, never
coordinates and never a live hero. Camp discovery is durable but one-shot; this turns a memory
into something actionable.

All three are covered by **12 deterministic assertions** rather than sim samples, including the
negative cases: no tower → no report; the tower does not re-report known camps; no hero position
leaks through the tower channel; the scout reports nothing for a camp its owner never found.

**Honest limits.** 6 runs is a small sample and the per-signal deltas outside the Watchtower row
are within noise. BOLT (the rusher) still ends some runs having learned nothing — it extracts
around turn 7, so it barely plays; that is a bot archetype, not a mode failure. The 7:1
carry-to-bank ratio is still untouched, waiting on the deck-quality harness.

Suite is now **83 assertions**; probes 20/20; contract check clean.

#### Battle safety, notification, and the harness that asserts the fix

**B5 — split into the half that is closable here and the half that is not.**

*Closed:* an unreported battle no longer soft-locks two players. While a battle is open
`warpath_move` refuses with `battle_pending` — for the attacker, who chose it, **and the
defender, who did not and cannot decline**. If the attacker closes the tab between opening and
reporting, both heroes were pinned for the rest of the run. Two full turns with no claim from
either side and the battle expires: no winner, no loot, no injury, both released — deliberately
the gentlest resolution, because the one thing known about that battle is that nothing is known
about it. A disagreement (both sides claiming victory) is now **logged** as `battle_disputed`
before the sweep settles it, so an operator can audit it later.

*Not closed, and waiting for Colyseus:* **who is telling the truth.** `warpath_battle_report`
still takes a client's word. Conceding is believed immediately, agreement is believed
immediately, and a bare win claim waits — so being fast buys nothing and the exploit is not
free — but two colluding or lying clients are not detectable from here. The real answer is
server-side battle resolution, `docs/mp-server-authority-shared-engine.md`. This is a mitigation,
not a fix, and should not be described as one.

**B9 — the loser is told.** Already landed in an earlier round and confirmed here: the 12s poll
is 5s, and `announceNewEvents()` surfaces anything that happened *to me* since the last read
(defeat, extraction broken, a rival leaving, a Watchtower sighting, a camp striking). It is still
a **poll**, so a window remains; a realtime subscription would close it and that is the same
channel the Colyseus work brings.

**P9 — a packed camp no longer just vanishes.** A scout that discovered a camp saw it disappear
with no explanation, because `warpath_state` gates rival camps on explored fog and the new site
is unexplored. Anyone who had explored the **old** site is now told the camp struck — only them,
by the same rule that let them see it — and nobody is told where it went.

**`browser-sim.mjs` phase A now asserts the contract, not the bug.** It expected the client's
calls to *fail*; they resolve now, so it asserts they resolve **and take effect** (the camp is
really on the server, the turn is really ended). This is the phase that would have caught B1:
four real browsers, the real bridge, nothing added to the arguments the client sends.

**Two things the harness caught while being fixed:**

1. Phase B drove only the *attacker's* browser, so one unilateral win claim left the battle open —
   correct under B5, and the probe was reading it as a failure. It now drives the **defender's**
   client too (the pending battle appears in its own action button), which is also what makes it
   a real end-to-end test of B9.
2. A genuine client bug: the **Challenge button was enabled when the hero could not afford the
   2-movement cost**, so pressing it produced `need_2_moves_to_attack` and never reached the
   battle bridge. Every other action's enabled state agrees with the server; this one did not.

**Closed on the coordinator's measurement:** vault capacity / the carried-to-secured ratio. The
bug fixes moved it from 7:1 to 2.6:1 on their own — defeats costing the loser nothing went
34% → 0%, materials transferred 0.49 → 2.10 — so no tuning was applied and none should be until
real players, not bots, are generating the numbers.

Suite is now **89 assertions**.

#### The turn clock (P3), and the deadlock it is built around

`waiting_for` blocked a four-player world until every living expedition ended its turn. One
player closing a tab froze the run **indefinitely** for three people who did nothing wrong —
a live-service failure rather than a game bug: it makes the mode grief-able by accident and
unshippable to strangers.

**⚠ The circular dependency, fixed before building.** The deadline is paused for players in an
open battle (a card battle happens outside the Warpath's clock and would blow the deadline every
time). The first design also expired an unreported battle after **two turns**. Those two rules
deadlock: A and B open a battle and neither reports → both paused → neither auto-ends → the
barrier still waits on them → the turn cannot advance → the battle is waiting for turns that
never arrive. C and D freeze, by exactly the failure the timer exists to prevent, and now
unreachable by the auto-end as well.

So **a battle expires on its own wall clock** (`warpath_battles.expires_at`, 4 minutes), never on
the turn counter, swept by the same enforcement point independently of the barrier. And **the
pause is bounded by that expiry** rather than by the battle merely existing — otherwise "open a
challenge and never report" is a free way to stop your own clock. The rule generalises: *nothing
that pauses the turn clock may also be the thing the turn clock is responsible for ending.*

| piece | as built |
|---|---|
| deadline | `warpath_runs.turn_seconds` **column default 90**, so it retunes without a migration |
| enforcement | `warpath_state` calls `wp_tick()` — every client polls it every 5s, so the first to look pays. Same lazy-on-read shape as `tw_node_sim_sync`. A run nobody is watching does not advance, which is correct: the deadline protects *present* players |
| expiry | auto-end the turn of anyone still thinking, unless paused by a live battle |
| repeat offenders | 3 consecutive auto-ends → `away`; away heroes leave the barrier entirely, so the rest play at full speed. The hero **stays on the map, lootable and attackable** — walking away has a real cost |
| re-entry | any action clears `away` and resets the strike count (9 call sites) |
| extraction | `away` **freezes** `extract_left`. You have to be present to leave, or going away becomes the safest way to extract and B3 is undone. Frozen, not cancelled — a disconnect should cost tempo, not the run |
| client | turn countdown pill (amber ≤20s, pulsing ≤5s) and **per-seat barrier dots** — thinking / ended / away / gone. "Why is nothing happening" now has a visible answer, which is most of the harm a stalled player does |

`wp_advance_turn()` was extracted from `warpath_end_turn` so both the last player to press the
button and the deadline sweep drive the identical path.

**12 new assertions**, including the deadlock as a permanent test: a battle carries a wall clock;
both combatants are exempt while it is live; the turn does **not** advance during the pause; the
pause **stops** at the battle's expiry; and then the tick expires the battle and the run moves on.
Also asserted: one absent player no longer freezes three others, three timeouts mark `away`, an
away hero is skipped by the barrier but stays on the map, and acting clears the flag.

Suite is now **101 assertions**; probes 20/20; contract clean.

*(The two probes requested live in the assertion suite rather than `probes.mjs` — they need a
forced deadline and a forced battle expiry, which is deterministic in SQL and timing-dependent in
the sim. They are permanent tests either way.)*

#### The deck harness's three findings — the offer tables, and what the bridge did with them

One investigation, because they are one question: what the world hands a player, and what the
bridge does with it on the way to a battle. Every number below is `tools/warpath-deck` at
`--scale 2`, the same scale as the baseline it is compared against.

**Where the answer turned out to be.** Both of the first two findings were the *same bug*, and
it was neither of the two candidates on the table. `warpathPadDeck` ended in
`pool.slice(0, DECK_SIZE)`. The server hands the pool over in acquisition order
(`order by acquired_turn, id`) and the 24 starter cards are inserted at entry — so the first 24
of those 40 slots were **always** the starter issue, and no run could ever field more than 16
drafted cards however long it lasted.

`probe-truncation.mjs` measures the consequence directly. `draftedSLOTS` is the number of the
40 slots holding a key the starter could never have given you:

| gained | pool | draftedSLOTS | distinct drafted in deck | distinct drafted LOST | over-3-copies |
|---|---|---|---|---|---|
| 0 | 24 | 0 | 0 | 0 | 3 |
| 13 | 37 | 7.1 | 9.1 | 0 | 1.6 |
| 20 | 44 | 9.7 | 10.7 | 1.8 | 0.3 |
| 25 | 49 | 9.6 | 11.8 | 3.8 | 0.4 |
| 35 | 59 | **8.0** | 15.5 | 8.0 | 0.5 |
| 40 | 64 | **8.0** | 14.0 | 10.0 | 1.0 |

It peaks around +20 and then **falls**. Past about twenty cards, drafting made the deck worse.

That also settles which candidate cause it was. **It was not recruitment.** At +40 the deck
fields the same 8 novel slots it fields at +20, so multiplying recruitment tenfold would move
nothing. (Recruitment being a rounding error — 25.3 discovered against 1.05 recruited — is real
and separate, and it is *by design*: three sites on the map, one claim each, so the entire
recruitment half of the mode can contribute at most 3 cards to a run.) **And it was not
dilution**, in the sense meant: padding was not filling a good pool with copies, it was
throwing drafted cards away.

The old bridge was also dealing an **illegal deck**. From the same q1 table, baseline:

```
starter only (24 cards)   units 20 traps 8 loc 10 spell 2   over-3: goblin×4, wolf×4, forest×4
                          single-slot surplus 9
```

Ten Locations, nine of them competing for the one board slot the engine has, and four copies of
three different cards against a limit of three. The harness's own calibration line says what
that cost: a tuned catalogue deck used to beat the Warpath starting deck **75.8%**; against the
same 24-card pool built properly it wins **53.8%**. Twenty-two points of the mode's difficulty
were the bridge, not the mode.

**The fix: the bridge selects a deck instead of truncating a pool.** `warpathPadDeck` now builds
the best legal 40 the pool can make — the same 22/8/4/3/3 shape `getGeneratedDeckForHero` builds
for every AI in the game, quotas as ceilings rather than floors so a pool that drafted no traps
does not get traps invented for it, `MAX_COPIES_PER_CARD` respected, and Locations and Weather
held to three because only one of each can ever be in play. It is behind
`WARPATH_DECK_SELECT`, a one-line flip back to the shipped behaviour, and it is still
battle-only: nothing is written back to the pool and a duplicated card is never extractable.

**And then the fill order, which was a second finding inside the first.** The first version
filled breadth-first — every distinct card got a first copy before any card got a second. That
is monotone on paper and wrong in play: a newly drafted mediocre card *always* displaced a
second copy of a better one. So each **copy** is now scored separately, discounted by how many
copies are already in. A second Goblin beats a first Spider; a third Spider beats nothing.

The discount was measured, not chosen. Same probe, same donor runs
(`probe-progression.mjs`, four independent runs that each reached a 60-card pool):

| fill | rungs where a bigger pool made a worse deck | what the whole draft is worth |
|---|---|---|
| breadth-first | 2 (−13.1, −14.4 pts) | +3.8% |
| copies at 0.95 / 0.90 (near depth-first) | 3 | **−2.5%** |
| copies at 0.85 / 0.72 | 1 (−6.9 pts) | +5.6% |
| **copies at 0.75 / 0.55** — shipped | 2 (−3.2, −4.4 pts, both inside noise) | **+10.6%** |

Near-depth-first is the worst of the four by a distance: it collapses the deck onto 14 distinct
cards and the pool stops mattering at all.

**One more thing was tried here and measured worse, and is written down so it is not
rediscovered.** q5 kept finding rungs where a bigger pool made a worse deck, and the thing that
moved with them was average cost — a 1.93 deck losing to a 1.80 one, repeatedly. `s -= 1.2 * cost`
looked obviously right. It turned two small backward rungs into one 15.6-point cliff and cut what
the whole draft is worth from +10.6% to +6.9%. The correlation was real and the causal reading of
it was wrong.


**What moved.** Same harness, same `--scale 2`, baseline in `tools/warpath-deck/out/baseline/`.

`q4` — Warpath pools against normal collection decks:

| pool | vs `generated` (was) | vs `tuned` (was) |
|---|---|---|
| starter pool only (24) | **48.8%** (26.3%) | **43.1%** (21.3%) |
| typical run (+13) | **66.3%** (32.5%) | **63.7%** (29.4%) |
| good run (+35) | **59.4%** (28.7%) | **50.0%** (28.7%) |
| brief intent (+40) | **50.6%** (35.0%) | **47.5%** (31.9%) |

Every cell up 15–35 points, and the level shift is the repair, not a buff: the four rows are
*different draft streams*, so `q4` is a level check and not a progression test — `q5` is the
progression test.

`q6` says the same thing from the other side. Removing the starter pool's eight Location cards
used to be worth **59.8%** — i.e. a fifth of the deck was dead weight the AI pilot could not use.
It is now **48.8%**: nothing left to remove.

`q2` — two independently drafted pools, which is where the coordinator's "15–85% pool matchups"
lived:

| | baseline | now |
|---|---|---|
| per-pairing spread (sd) | 17.4% | **10.3%** |
| range | **15.0%–85.0%** | **28.7%–67.5%** |
| statistically lopsided pairings | 4/24 | **1/24** |

Replicated across three runs of the same code (sd 8.9 / 8.5 / 10.3). **The correlation between
"drafted more cards" and "won" is not evidence either way** and should not be quoted: the same
three runs gave r = +0.314, −0.160, +0.227. With 24 pairings its standard error is about 0.21.

`q5` — the milestone curve, which is the honest weak spot:

| pool | baseline | now |
|---|---|---|
| 25 | 48.1% | 40.6% |
| 31 | 61.3% | 62.5% |
| 38 | 49.4% | 58.1% |
| 46 | 46.3% | 55.0% |
| 52 | 52.5% | 44.4% |
| 60 | 55.0% | 46.3% |

**Say it plainly: `q5` is not fixed, and its top two rungs got worse.** `q5` runs ONE donor at
n=160, and the two rows at 52 and 60 build a deck with the same distinct count and the same
average cost — so most of the difference between them is noise, and the whole shape swung by 14
points across three runs of identical code. `probe-progression.mjs` exists because of that: four
independent donors, common opponent, and it reads +10.6% end to end with two backward rungs of
3–4 points. The two instruments disagree about the top of the curve and I trust neither to
±5 points.

There is also a **ceiling nobody put there on purpose**: a 40-card deck cannot express a 60-card
pool. Past roughly pool 46 the deck stops changing — `distinct` sticks at 26 and `avgCost` at
1.93 — so the last two `DECK_MILESTONES` rungs cannot be worth much in deck power however the
bridge is written. If 52 and 60 are meant to feel like progress they have to pay in something
other than the battle deck (extraction capacity, choice, a second deck slot). That is a design
call, not a bug, and it is not mine to make.

**Finding 2 — the inverted biome payoff — was the same bug, and is fixed by the same change.**

| biome | baseline | now | encounter chance | cards a 60-turn run drafts |
|---|---|---|---|---|
| wastes | 57.4% | **57.8%** | 11 | 19.0 |
| graveyard | **46.7%** (worst) | **52.1%** | 18 (highest) | 22.2 |
| plains | 49.2% | 48.8% | 9 (lowest) | 14.1 |
| mountain | 52.1% | 48.6% | 15 | 19.9 |
| forest | 46.9% | 46.4% | 16 | 19.3 |
| facility | 47.8% | 46.4% | 17 | 22.2 |
| **spread** | **10.7%** | **11.4%** | | |

The inversion was exactly this: the Barrow Gate has the **highest** encounter chance and among the
highest yields, and it finished **last**. It finished last because its table is expensive and
Location-heavy, and the old bridge turned a Location-heavy pool into ten Locations and threw the
rest away. Selecting the deck fixed it without a single weight changing: **46.7% → 52.1%, worst to
second.** The spread did not widen (10.7% → 11.4%, and the same code gave 14.9 / 12.8 / 11.4
across three runs — run-to-run variation on this metric is about ±2 points).

**What is NOT fixed, and one falsified hypothesis.** The Ashen Wastes is still the strongest
biome at ~58% and still beats all five others head to head. The obvious explanation — its two
heaviest slots are Golem and Goblin, the two strongest cards in the starter pool, so a Wastes run
buys extra copies of what it already owns — was tested by moving that weight onto the Lich and the
Ice elemental and re-running `q3` at the same scale: **59.3% → 58.8%, inside the noise.** The
change was reverted rather than kept for its flavour. It is wrong because `warpathPadDeck` already
pads a short pool up to three copies of the best cards in it — a starter deck runs three Goblins
whether or not the Wastes ever offered one. Whatever the Wastes' advantage is, it is not its unit
weights, and the next place to look is that it is the only biome whose *entire* table is castable
on curve. Written into `warpath-data.js` next to the weights so it is not rediscovered.

**Finding 3 — the Guardian had no deck, and now has two.** `enemyDeckOverride: null` handed the
mode's only authored PvE encounter to `buildAIDeck()` — a generic AI deck at best, and on an
install with no published AI decks an **empty array**: 20/20 to the player, median **1.5
half-turns**. Two authored decks now, one per guarded landmark, exactly `DECK_SIZE`, never more
than `MAX_COPIES_PER_CARD`, built only from ids that exist in the catalogue, and each a different
fight on purpose — the Black Pyramid an Ouroboros swarm under Zarra, the Drowned Choir a cold
attrition deck under Vex. The Hero is now fixed **per landmark**: the old comment claimed the
battle-id hash made "the same Guardian the same foe", but a battle id is per battle, so every run
met a different one.

| pool | vs Black Pyramid | vs Drowned Choir | vs the old empty deck |
|---|---|---|---|
| starter pool only (24) | 58.3% | 53.3% | 100% |
| typical run (+13) | 77.5% | 62.5% | 100% |
| good run (+35) | 73.3% | 53.3% | 100% |
| median half-turns | 17–18 | 16 | **1.5** |

The Pyramid needed one measured revision: its first build ran ten traps and **three** five-energy
Brood Tyrants and measured 80.8% to the player, because a swarm that cannot deploy until turn five
is not a swarm. Twenty two-and-three-drops and one fewer Tyrant took it to 58.3%. It is still the
softer of the two against drafted pools and that is stated rather than smoothed over. Neither
number includes `enemyLevel: 6`, which the bridge sets and the harness does not model, so the real
fight is harder than this by whatever six levels are worth.

**The harder question: is the landmark findable?** Measured over 480 real 60-turn runs
(`probe-landmark.mjs`), and the answer is worse than "rare":

| | turn 20 | turn 40 | turn 60 |
|---|---|---|---|
| the landmark came out from under the fog | 17.5% | 29.2% | **36.7%** |
| the hero actually stood on it | 5.8% | 9.0% | **14.0%** |

So it is **not primarily a discovery problem**. Two of every three players who are *shown* it walk
straight past — it is one painted structure on a 1320-tile map and nothing says it matters. (The
four-player sim's "zero Guardian battles in 16 runs" is unremarkable against a 13.6% rate; that
part was not overstated.)

It now announces itself, the way the extraction broadcast does — and **privately, with no
coordinates**. It tells you that you have seen something; it does not tell your rivals where you
are or where it is. Which required fixing something else first: **the run feed had no audience.**
`warpath_state` returned the last 40 events by `run_id` alone and did not even return
`expedition_id` for the client to filter on — so `watchtower_report`, which posts a **rival camp's
coordinates**, was being read by the three players who never built a tower. A `private` column and
one predicate; every existing broadcast still broadcasts.

#### Pool context at the moment of the pick — built

Proposed in `docs/warpath-draft-context-proposal.md`, approved, and shipped as three parts plus a
readability defect found while checking whether they would fit.

**The case, measured.** The pick-1-of-3 is the product: a median of **26 encounters a run**, and
the one decision the client asked a player to make with no sight of the pile the card was joining.
Over 300 real runs (`probe-draft.mjs`): **58.5% of offers are a card the player already holds** —
1.75 of every 3 — and **13.9% are already at the 3-copy limit** `warpathPadDeck` enforces, so
taking them cannot change a battle deck at all.

The cost of that silence was not a guess. `draft.mjs` already held the experiment: `PICK_POLICIES`
`value` and `greedy` share one value function and differ in exactly one thing — whether they can
see how many copies they hold — and `greedy` is what the modal permitted. Same seeds, same walk,
same offers:

| | can see its pool | cannot |
|---|---|---|
| picks of a **dead** card (≥3 held) | 0.9% | **29.4%** |
| picks of a card already held | 62.4% | 74.1% |
| distinct cards in the pool | 29.7 | 26.7 |
| cards drafted per run | 26.7 | 26.7 |

The coordinator verified this from a different angle — copies beyond the deck cap sitting in the
final pool — and got **0.6 unplayable cards a run (1.2% of pool) informed against 7.8 (15.4%)
blind**: thirteen times the waste, a different metric, the same direction.

**1. The copy badge**, in the type line the card already draws, silent at zero. Three states, and
the silence is as deliberate as the text: nothing at 0 copies (41.5% of offers — writing "you
carry 0" on all of them is how a decision becomes a spreadsheet), `you carry 2` at 1–2, and
`your deck is already full of these` at 3+, styled as a refusal rather than a statistic. Chosen
over a curve strip and over a pool peek because it is the fact that moves the measured number, and
because it costs **zero new rows**.

**2. The consequence footer**, one line: *"Nothing you take is yours until it is secured at camp
and carried out. **4 of 6** extraction slots spoken for."*

**3. The FULL DECK ladder, demoted.** It was the loudest progress affordance in the mode and it
pointed at a milestone the deck harness showed does not pay — past roughly a 46-card pool the
battle deck stops changing at all, `distinct` sticks at 26 and `avgCost` at 1.93. It is quiet now
and still says how big the pool is, which is true and worth knowing. The number that actually
decides the run — what would come home if you extracted right now — was three taps down and is now
a HUD pill. The two swapped places.

**And the defect found while checking fit.** At 360×640 the encounter modal needed **774px of a
587px box**: only two of three offers were on screen at once, and rotated it was **zero**. A player
was choosing between three things while looking at two, in the mode's central interaction, on the
most common phone size there is. One card measured 238px — icon 34, name 16, type 12, elements 14,
**stats 55**, tags 11, flavour 18, and 78 of padding — so below 720px of height the card stops
being a poster and becomes a row: the icon moves up beside the name and the six stats go on one
line. **Nothing is removed except a unit's flavour line**, and that distinction is load-bearing:
`desc` is charm on a unit ("Fast but fragile.") and **rules text on everything else** ("15 dmg",
"3 dmg/turn to all units & heroes"). They are tagged apart so the layout can drop the charm without
deleting the only functional description a trap, spell or location has.

Result, with the *longest* badge text in place: **3/3 offers visible at every viewport**, modal 542
of 640 at 360×640. Asserted permanently in `_layoutcheck.js` alongside the ≥120px map-band floor.

Also fixed there: `#boot` is `z-index:90` against the veil's `40`, so a faded-out boot curtain was
still composited on top of every modal — `visibility` now flips with the opacity.

**What the screenshot caught that four assertions did not.** Every card rendered `[object Object]`:
`cardFace(key, extra)` already took an HTML string as its second argument and the new options
object was being concatenated into it. Every geometric and text assertion passed, because they all
queried specific selectors. Looking at the thing found it in one frame.

**How we will know it worked, honestly.** `probe-draft.mjs` is the pre-change baseline and can
answer whether dead picks fall, whether pool distinctness rises, and whether what comes home gets
less uniform. It **cannot** answer whether the choice still feels like an encounter rather than an
audit. And the 0.9% figure is a **ceiling produced by a machine that counts perfectly and never
misreads a badge** — a real player lands somewhere between 29.4% and 0.9% and nothing in this repo
can say where. Quoting the ceiling as the expected outcome would be the same error as reporting
`viewH()` as an observed band. Four people playing one run each would settle what no probe here
can.

**Still waiting for Colyseus:** who is telling the truth about a battle result. Conceding and
agreement are believed immediately and a bare win claim waits, so being fast buys nothing — but
two lying clients are not detectable from here. See `docs/mp-server-authority-shared-engine.md`.

**Known P1 gap, deliberately not closed:** no Warpath-*exclusive* cards are minted. Doing so
means writing new entries into the card catalog inside the 215k-line production monolith, which
is the one thing hard constraint #1 says not to risk. Exclusivity in Milestone 1 is expressed
as *where* a card can be drafted and how scarce it is, and every grant carries an
`acquisition: 'warpath'` provenance tag so a real exclusive set drops in later without
re-plumbing. Reasoning is in the header of `public/warpath/warpath-data.js`.
