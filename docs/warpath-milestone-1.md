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
| P2 schema | — | not started | — |
| P3 screen | — | not started | — |
| P4 bridge | — | not started | — |

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

**Known P1 gap, deliberately not closed:** no Warpath-*exclusive* cards are minted. Doing so
means writing new entries into the card catalog inside the 215k-line production monolith, which
is the one thing hard constraint #1 says not to risk. Exclusivity in Milestone 1 is expressed
as *where* a card can be drafted and how scarce it is, and every grant carries an
`acquisition: 'warpath'` provenance tag so a real exclusive set drops in later without
re-plumbing. Reasoning is in the header of `public/warpath/warpath-data.js`.
