# Handoff — 2026-08-21

**Branch** `city-construction-timers` · **Live** `v121c5` · pushed, nothing ahead
**Gates** `_synckcheck` clean · `modcheck` 226 modules · MP gate 25/25 proven, 13 test files

⚠ The working tree has ~64 untracked entries — gauntlet driving harnesses under
`.gauntlet/` and scratch under `tmp/`. `tmp/` should never be committed. The
`.gauntlet/drive-*.mjs` and `shots/` are real evidence and worth keeping.

---

## 1 · What is unfinished, in the order I would do it

### 1a. The vault readout — SMALL, everything is ready
`window.__boeVault` is exposed with `cap()` / `fee()` / `used()` / `room()`, read
from the same numbers that ENFORCE the rule (`index.html`, search
`BOE_VAULT_CAP`). Nothing renders it yet.

Wire it into two places so they cannot disagree:
- `public/ethos/app.jsx` → the "Resources in bank" `Metric` (~line 1698). It
  currently says `x of 149 types`; it should also say `x / 8,000`.
- `public/node-city/index.html` → `openVaultPanel()` (~33649), the per-resource
  modal. Add room-remaining beside the amount input.

The cap and the 500 fee are already enforced in `boeDepositRes()`. **Do not
re-implement either in a UI** — that is the whole reason they live on the
deposit path.

### 1b. The outbreak progress model — CONTAINED, and it unblocks a shipped feature
`/src/zombie` is complete and **deliberately disarmed**: `ZOM.live = false` in
`zombie/tuning.js`, refused in `risk.js permit()`. The card, forecast, deathcare
meter and log all still work; only the roll is withheld.

It was disarmed because the gauntlet critic failed it three rounds on one gap:
**building a graveyard does not visibly move the meter.** So a player whose city
gets razed cannot tell whether their fix worked.

The change asked for IS that fix: make risk a PROGRESS value that rises on each
death and rises faster without burial capacity, instead of a timer. Once the
meter demonstrably responds to burial capacity, flip `ZOM.live` to `true` — one
line, and it is the only line.

⚠ It destroys real buildings (`zombie/index.js:321`, `damageTile`, up to
`maxStrikes: 4`, and above `razeRatio: 2.5` it razes rather than damages). Do not
arm it until someone has PLAYED an outbreak. `.gauntlet/util2-progress.html` has
the full argument.

### 1c. The two UI asks the player has raised twice
- **One in-city power connector.** A `Grid Connector` already exists but is
  auto-placed in the apron corner (`power/tuning.js`, `cx:-1, cz:-1, seeds:true`)
  — that is the OUTSIDE-grid link by the highway. The player wants an INTERNAL
  hub they place, that the city's power buildings connect to. Two different
  things; do not conflate them.
- **Merge ROADS and CLASS into one tab.** They are one tool split in two: ROADS
  holds the gesture (Straight / Elbow / Freehand), CLASS holds the class
  (Street … Highway). ⚠ While merging, reconcile the prices — ROADS shows 400 for
  an Elbow while CLASS shows 500 for a Curve and 2,400 for Highway. A split UI is
  exactly where two pricing paths drift.

### 1d. Highway width — the gauntlet refused it on purpose
A highway that is darker but not wider is not a highway. Moving `RD_HW` re-cuts
every kerb, verge, footway and apron in the city, so it was deferred as its own
round rather than faked. It is the single biggest remaining gap in the roads work.

### 1e. NOT STARTED — the request that arrived last
Stores that generate Cinder and employ NPCs (clothing, fast food, weapon shops,
furniture, pharmacy, "Great Buy", game stores, cinemas); **utility companies NPCs
pay for water and power**, gated on the city actually having both connected;
**schools** (elementary → middle → high → college → university → "online guru" as
the LOWEST tier) with education level driving job quality; **City Hall**;
**Welfare Labs** generating 1 research point per week. Bar: Cities Skylines 2.

This is a large, multi-system feature — jobs, education, a per-citizen attribute,
a utility billing loop. It is a gauntlet, not a single pass.

---

## 2 · Traps this session actually hit. Read before writing code.

1. **A backtick inside a JS template literal ends it.** Cost four separate
   failures writing edit scripts. CLAUDE.md already records it killing the HUD
   module. Use `String.raw` or avoid backticks in prose.
2. **Shell quoting eats regex backslashes.** `\w` → `w`, `[\s\S]` → `[sS]`,
   `\.` → `.`. The last one still PARSES and silently matches everything. Write
   edit scripts to a file with the Write tool; do not pass them through `node -e`.
3. **`index.html` is CRLF.** A multi-line anchor written with `\n` matches ZERO
   times and the edit is skipped **silently** — single-line edits succeed while
   multi-line ones vanish. That signature (some applied, some "matched 0x") means
   line endings, every time.
4. **`modcheck` only PARSES.** It passed a file that imported the tuning as `T`
   when the module exports `ZOM` — a ReferenceError at runtime. For anything
   load-bearing, EXECUTE it (`node --input-type=module -e "import …"`).
5. **`buildMesh` has no default arm.** A BUILDINGS type with no `case` renders an
   empty Group: an invisible building on a real tile. Road classes are the
   exception — they render through `makeRoad(rc)` off `ROAD_CLASSES`.
6. **The framebuffer trap.** An A/B without `renderer.render()` between reads
   returns a confident, wrong ZERO. Always report a control beside a pixel count.
   A red mutation reporting **0 findings** is a crash, not a detection.
7. **Deploy knobs — there are twelve now**, not the nine CLAUDE.md lists. Beyond
   `version.txt` / `BUILD_VERSION` / `sw.js` / `NC_BUILD` / node-city `?v=` /
   `BB_VER` / `hud.css` / `hud.js`: **`main-menu/index.html?v=`**,
   **`corp/?v=` (the iframe URL, separate from the .jsx tags inside it)**,
   **`warehouse/index.html?v=`**, and **`ethos/app.jsx?v=`** — that last one had
   NO buster at all until this session. `sw.js` is cache-first for sub-resources,
   so a missed knob means the change never reaches a returning player.
8. **"The feature is built, the door is missing" — four times this session.**
   The weapon smith bench, the warehouse yard, the land-value/pollution chips
   (which only render once the problem already exists), and `/src/resmap`
   (`togglePanel()` had zero call sites). Before building anything, check whether
   it exists and is simply unreachable.

---

## 3 · Database

All migrations are applied and verified: warpath (21 tables, with the
charge-without-entry refund fix), weaponsmith `040/041/042`, storage market
`043`, `tw_node_owners` RLS lockdown `044`, warehouse `20260812`.

- `tw_node_owners` was fully client-writable (INSERT/UPDATE/DELETE all `true`).
  Fixed and PROVEN with a real non-admin JWT: steal blocked, self-claim allowed,
  admin assign preserved.
- Warpath RLS verified live under real `authenticated` grants — fog of war holds,
  no client write path exists anywhere.
- **No SQL is needed for vault work.** `bank_of_ethos.resources` is jsonb.
  `.balance` and `.aza` are RPC-only; `.resources` is the only client-writable
  column.

---

## 4 · Never verified by a human

- **PvP desync fixes** — need two accounts in one corp. `AUTH_DEV_BYPASS` never
  runs in production.
- **The Ranch** — has still never been played.
- **Everything from both gauntlets** — roads, ocean, pipes, power lines,
  deathcare, the resource map. Critics drove them headless, which catches
  geometry and wiring but not whether laying a road FEELS right.
- **Weapon Smith bench** is not gated on owning the licence: `_wsOwnsLicense()`
  reads false and the bench still opens. Decide whether that is intended.
