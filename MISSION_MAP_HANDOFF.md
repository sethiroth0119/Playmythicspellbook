# 🗺 Mission Map — handoff (written 2026-09-01)

The roguelite campaign **list** is now a **map of ruined New York**. Everything below is
verified against the code at the commit named here, not written from memory.

## Where things stand

| | |
|---|---|
| Branch | `claude/mission-selector-faction-control-dl152k` |
| HEAD | `52c5404` |
| PR | [#5](https://github.com/sethiroth0119/Playmythicspellbook/pull/5) — open, CI green, mergeable clean |
| `main` | untouched (`4dbc4f9`) |
| Working tree | clean, pushed |
| Version knobs | all three bumped to **v120x0** — `version.txt`, `BUILD_VERSION`, `sw.js CACHE_VERSION` |
| Deployed | **no.** Cloudflare built a branch preview only |

Nothing is half-finished. The one thing deliberately *not* built is the co-op layer (§ Next).

---

## THE PINNED DESIGN DECISION

> **Grip is not a tint on a district. It is the percentage of that district's BUILDINGS
> wearing the faction colour.**

Blocks flip one at a time, spreading outward from an epicentre with a ragged edge, so a
contested district genuinely looks contested and losing ground reads as lights going out
one by one rather than a bar moving. This is the whole visual idea; `city.js` computes the
flip order and normalises it per district so `grip%` maps to exactly that share of blocks.

### The second decision, and the one most likely to be broken by accident

**Faction pressure rides on ONE STRING.** `index.html` already reads a campaign's
`difficulty` twice:

- `_rlcDiffBand(camp)` → picks `RLC_HAUL_PROFILES` (what the run drops)
- `_rlcDiffBonus(camp)` → adds **+4** (`/hard|veteran|elite/`) or **+8** (`/night|brutal|…/`) enemy levels

So "a held district drops better loot **and** fights harder" needed **no engine change** —
only the right word. `poi.js` `BANDS[].diff` emits `Normal` / `Hard` / `Veteran` /
`Nightmare`, chosen to land on those regexes.

> ⚠ **Do not tidy those four strings.** Renaming `Veteran` to something nicer silently
> removes +4 enemy levels and downgrades the loot table, with no error anywhere.

---

## VERIFIED ANCHORS (checked against `52c5404`)

| What | Where |
|---|---|
| **Module** | `public/src/missions/` — 1,326 lines across 7 files |
| Registers | `window.MythicMissions` (`index.js`) |
| The seam | `window.MythicMissionBridge` — **index.html:207369** |
| Campaign resolution | `_rlcCampaign(id)` — **index.html:183536**, falls back to the module for `msn_*` |
| Router | `if (App.screen === 'rlcList')` — **index.html:111360**, tries the map, falls back to `renderRlcList()` |
| Script tag | **index.html:223238** — `src/missions/index.js?v=r13msn1` |
| Camp tile | `id: 'btn-rlc'` — **index.html:114572** ("Sector Map") |
| Builder field | `data-rlc-path="missionSite"` — **index.html:184672** |
| Grip state | `Profile.missionMap = { v, day, lastTick, grip{}, fort{}, credited[] }` |
| Mission id | `msn_<site>_<faction|none>_<grip>_<day>` — **the id is the whole recipe** |

### The module, file by file

| file | lines | what it holds |
|---|---|---|
| `poi.js` | 111 | districts, POIs, the 3 factions + push profiles, `BANDS` |
| `city.js` | 156 | the seeded procedural city — island, grid, park, buildings, flip order |
| `bridge.js` | 55 | the seam + `NULL_BRIDGE` + `esc` |
| `state.js` | 159 | grip, the faction tick, crediting a survived raid |
| `graph.js` | 322 | `(district, faction, grip, day)` → a campaign the engine eats |
| `render.js` | 450 | the screen (canvas 2D + DOM pins) |
| `index.js` | 73 | registration + `__mg.msn*` dev handles |

---

## THREE THINGS THAT WILL BITE YOU IF YOU DON'T KNOW THEM

### 1. The 3D Ascent map is the DEFAULT renderer, not the 2D board

`_rlcAscentOn()` returns **true** unless a campaign sets `useAscentMap === false` — the
comment in `index.html` says it outright: *"the Ascent map IS the roguelite map now."*
So every generated mission is handed to `_ascentMapFromCampaign()` and drawn in 3D; the
classic 2D board is a button away, not the default.

This was **verified, not assumed**: all 40 district × faction campaigns were run through
the real converter in the real page — 40/40 valid manifests, 9–27 nodes, every one with a
boss and **no flat edges** (the 3D runtime only walks to a *higher* tier, so two connected
same-tier nodes would be silently unreachable).

> ⚠ The node types in `graph.js` are a **contract with `ASCENT_TYPE_MAP`**. Add a type
> there without adding it to that table and it is unmapped in 3D. There is a comment at
> the generator saying so.

### 2. Crediting a raid is a POLL, not a hook

The map credits a run when it **next renders** and finds the id in `Profile.rlcCompleted`,
which the engine only writes on a `finalBoss` clear. Dying never lands there — so *"you
only take ground by getting out alive"* is true **by construction**, and the run flow (the
part of `index.html` least safe to touch) gained **no new call site**.

### 3. The id is the recipe, so nothing is persisted

A run outlives the state that made it — the map can tick while the player is inside
Midtown. `generate()` is a pure function of the id, so an in-progress run survives a reload
**and** a tick with nothing stored. One memo entry stops `_rlcCampaign` rebuilding a graph
dozens of times per screen.

---

## Verifying (this environment)

```bash
python3 -m http.server 8765
# then open:
#   http://localhost:8765/_msn_harness.html        24 assertions, green = pass
#   http://localhost:8765/_msn_harness.html#map    hides the report, just the map
```

`_msn_harness.html` (repo root, alongside `_synckcheck.mjs`) drives the module with a
stand-in bridge. It covers: all 40 generated graphs (574 nodes) for orphans, dangling
edges, stray start nodes and an unreachable final boss; determinism of regeneration; the
difficulty strings against index.html's own regexes; the raid → grip → faction-push loop
including double-credit; pinned vs unpinned campaign placement and locked rendering; and
the Cinder compensation when no card catalogue exists.

⚠ `node _synckcheck.mjs` needs **terser**, which is a declared devDependency but is *not
installed* here (no `node_modules`). Either `npm install`, or extract the inline
`<script>` blocks and run `node --check` over each.

⚠ The Browser pane does not composite (CLAUDE.md) — `requestAnimationFrame` never fires
and canvas rects read 0×0. Everything above was verified with headless Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, which does composite.

### Dev handles

```js
__mg.msnTick()                  // force one faction push
__mg.msnSet('hells','scp',95)   // put a faction on a district at a grip
__mg.msnReset()                 // back to the opening board
```

---

## Live previews

| | |
|---|---|
| The map alone | https://claude.ai/code/artifact/60c55720-e054-48f7-b405-951710cdaa24 |
| Design prototype (superseded) | https://claude.ai/code/artifact/ab85a36b-af13-4851-866c-176713dffa6d |
| Branch preview (whole game) | https://claude-mission-selector-faction-contro-a228-playmythicspellbook.play-a3d.workers.dev |

⚠ The branch preview was **never opened by the agent** — `workers.dev` is 403'd by the
sandbox proxy. It is the one thing verified only indirectly. Hard-refresh it: the service
worker cache version changed, and a stale SW will serve the old campaign list.

---

## NEXT — scoped, not started

### 1. The co-op layer (the big one)

Grip lives in `Profile.missionMap` and the tick is **client-side**. Fine solo, wrong the
moment it is shared: a player who never opens the game has a map that never decays, and
two clients disagreeing about who holds a district is a week of desync debugging.

```
mission_sites     (id, poi_type, x, y, name, campaign_id nullable, seed)
mission_pressure  (id, site_id, faction_id, delta, source, user_id, created_at)
```

- Grip = `sum(delta)` clamped 0–100. **Append-only** — never UPDATE a grip column.
- RLS in the same migration, both tables. Read-all-authenticated; insert scoped to
  `auth.uid()`; the tick inserts service-side.
- **The tick must move server-side** (Supabase cron or an edge function).
- Numbered `.sql` files in `/sql`, idempotent, applied by hand in the SQL editor for
  project `ktsiasyjusesawtrwrjc`.
- The current state shape (apply a delta, read a total) was chosen to port without a rewrite.

### 2. Influence / contribution

A per-district contribution score so a player can see their share. Deliberately **not** a
new spendable currency — there are already seven.

### 3. Smaller

- More districts. Boroughs are cheap: `poi.js` + an island profile in `city.js`.
- Faction unit art on the map (Scum and SCP art already exists in the repo).
- `docs/prototypes/mission-map.html` is the standalone design prototype — fastest way to
  iterate on the look without booting the app. Not deployed (`docs/`, not `public/`).

---

## Unrelated bug found in passing — NOT fixed

The bunker's **Gas Station Run** button is dead. `index.html:82878` sends
`'gas-station-run'` (hyphens); `GS_RUN_ID` at `index.html:182708` is `'gas_station_run'`
(underscores). `rlcStartRun` can't resolve it and toasts *"That campaign has no map yet."*
`grep -n "gas-station-run\|gas_station_run" public/index.html` returns only those two
lines — there is no alias.

Fix: use the constant instead of a second hand-typed literal, so they can't drift again.
**Own branch off `main`** — nothing to do with this work.

---

## What is deliberately still there

`getPlayableCampaigns()` and `renderRlcList()` are **untouched and still reachable**. They
are the fallback when the module doesn't load, and the whole design leans on that safety
net — `render()` returning false drops straight back to the old list. Do not delete them
as "dead code".
