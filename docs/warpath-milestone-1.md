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
| P2 schema | 4 | **WINS** | `warpath_state()` is one big query; at 4 players it is fine, at 20 it will need splitting |
| P3 screen | 3 | **ready for independent critic** | Terrain art is the fallback painter until `warpath-render.js` lands |
| P4 bridge | 2 | **ready for independent critic** | The cinematic menu entry is untested against a live main-menu build |

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

**Known P1 gap, deliberately not closed:** no Warpath-*exclusive* cards are minted. Doing so
means writing new entries into the card catalog inside the 215k-line production monolith, which
is the one thing hard constraint #1 says not to risk. Exclusivity in Milestone 1 is expressed
as *where* a card can be drafted and how scarce it is, and every grant carries an
`acquisition: 'warpath'` provenance tag so a real exclusive set drops in later without
re-plumbing. Reasoning is in the header of `public/warpath/warpath-data.js`.
