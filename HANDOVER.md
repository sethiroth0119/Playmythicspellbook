# Node City — handover

**Branch:** `claude/city-builder-visual-upgrade-g9deb4` · 217 commits · everything pushed.
Supersedes `HANDOFF-CITY-2026-08-18.md`, which predates most of what is here and
should be read only for its round 0–9 visual history.

---

## 1. Read these four things before touching anything

| File | Why |
|---|---|
| `CLAUDE.md` | The non-negotiables. The globals trap is the one that has cost real time repeatedly. |
| `ECONOMY.md` | Cinder is never minted. Four historical leaks are documented; one **destroyed** Cinder rather than minting it. |
| `.gauntlet/README.md` | Six things that each cost an agent a full debugging round. Item 6 is a measurement contract — read it before you A/B anything on screen. |
| The `FIX-RECORD.md` files | `demographics`, `districts`, `wild`, `parcel`, `lifepath`. Each says where work **actually** landed when a commit subject misfiled it. |

## 2. Three gates, and you need all three

```bash
node _synckcheck.mjs            # <script> blocks in the two index.html files
node .gauntlet/modcheck.mjs     # every ES module under public/src  (172 today)
node .gauntlet/precommit-scan.mjs   # refuses a line marked deliberately broken
node tools/economy-tests/run.mjs    # 663 assertions; the audit is the point
```

The first two answer *"does this parse"*. The third answers *"did anyone mean this"* —
it exists because a checkpoint once shipped a build where a fix was **disabled while
appearing present**, and both syntax gates passed, because the injected line was valid
JavaScript.

The economy suite can be made to fail on purpose — `ECON_TEST_SABOTAGE=seed-mint`
returns a red round. A suite that cannot be made to fail is not a gate.

## 3. What is on the branch

32 feature modules under `public/src/`, each on a `window.Mythic*` global, each guarded
so a 404 costs that feature and nothing else. `node .gauntlet/modcheck.mjs` prints the
live count — trust that, not this table.

**Zoning stack**, four layers meeting at one function (`/src/zoning`'s `typeFor()`, the
single point where "what goes on this plot" is decided):

| Layer | Module | What it decides |
|---|---|---|
| 1 | `zoning` | Land use — 11 zone ids, fill/marquee/paint, right-click de-zone |
| 2 | `districts` | Specialisation — 13 district types incl. the 🃏 Mythic card districts |
| — | `landvalue` | Which of that set *this ground* will take — five bands |
| 3 | `tenants` | **Which company** wins the lot, by auction rather than by hash |

**City systems:** `demographics` `power` `water` `pollution` `outside` `transit` `streets`
`progression` `budget` `naming` `palette` `dossier` `citizen` `lifepath` `broadcast`
`economy` `city` `trading` `nodes` `resources` `community` `resonance` `battle` `sprites`
`hud`

**Rendering:** `wild` (ground scatter) `parcel` (the plot under non-housing) `crowd`
(standing figures) `parking`

## 4. 🔴 The save layer — read before wiring the cloud

Modules do **not** edit node-city's `serialize()` literal. They register a slice on a
shelf, and `serialize()` collects them into `payload.ext` with a manifest in
`payload.meta`:

```js
window.MythicCitySave.register('<key>', { save: () => ({…}), load: (p) => {…} })
```

Registered today: `progress` `zoning` `names` `districts` `tenants` `lifepath`
`broadcast` `streets`.

**Registering late is safe and is the documented behaviour** — the shelf stashes the
payload and replays it to whoever registers next.

Everything else that persists rides existing state deliberately:
- **`palette`** (player building colours) — one-letter keys on the tile record, in the
  same single row the city already writes.
- **`transit`** (player-built routes) — one `transit` field in `serialize()`, with
  `game._transitRaw` as a **load-bearing fallback**: a save written with the module
  present must not be emptied by a boot where it 404s.
- **`landvalue`, `wild`, `parcel`, `crowd`, `citizen`, `budget`** — **no save field at
  all, by design.** Every fact they show is derived from state already persisted.

⚠ **Two rules the modules follow and a new one must too:** an **unknown key from a newer
build is kept, never stripped** (an older build must not silently empty a save it does not
understand), and hostile input is dropped rather than carried (a key that is not `"x,z"`
becomes a lookup that never matches and a district you can see in the count and never on
the map).

## 5. 🚀 Nothing here has been deployed

The branch has never shipped. Three knobs move **together** or the update check breaks:

```
public/version.txt            v120w9   ← unchanged by all of this
window.BUILD_VERSION          v120w9
public/sw.js  CACHE_VERSION   mythic-v120w9-battlefield-and-city
```

Verify the **edge** with `curl`, never the deploy log, and poll — propagation across PoPs
takes a couple of minutes.

**SQL:** `sql/038_city_economy_trade.sql` is the only migration this work added. Migrations
are applied **by hand** in the Supabase SQL editor for project `ktsiasyjusesawtrwrjc`. Each
file is idempotent, ends with a verify query, and ships its RLS in the same file. **RLS is
the entire security boundary — review every policy line by line.** A missing
`using (auth.uid() = …)` is a data breach and looks fine in review.

## 6. Known open, honestly

**Named and unfixed:**
- `/src/parcel` is effectively dead on 16 of 24 non-housing buildings — `HAS_OWN_GROUND`
  grew until it swallows them. Diagnosed, worked around, not fixed.
- Demolish-and-rebuild demotes a whole workforce: `firms.js` writes no founding time, so
  tenure is capped by the building's age. Every cure is a write into another layer.
- The Job level row's *"of 3"* still reads as a reading when it is an analogy.
- The charter fund still exhausts on a 220-firm board. The fix added the missing
  investment arrow; on that board **the richest firm holds 10.65 days of its own operating
  cost against a 12-day founding buffer** — the city is thin, not hoarding. **The cap was
  deliberately not raised**; that is the tuned-number move.
- Rent → failure → land value falls is **open, not closed**: no land-value term reads firm
  health, and a bankrupt firm leaves its building standing.
- No office building exists in the game, though the panel shows office demand.
- Road condition does not move within a session. The geology→water link is unverified.

**Visual, standing at mean 6.46 across 12 dimensions:** the glass reflects the sky and now
has interior content, but nothing casts *into* it, so a street canyon reads as if it had no
other side. Fog dissolves the far third of the aerial. No lamp, sign or bollard casts a
visible shadow — a mast is ~3 shadow-map texels. Road paint stands proud. The arena reads
civic rather than duel, and is tower-proportioned on a one-tile footprint.

**Not built from the zoning brief:** Layer 4 ownership and player-owned parcels · district
policies (taxes/subsidies/regulations) · government policy system · faction territories ·
Mythic tournament economy · Signature Buildings · city achievements unlocking cards ·
**cards affecting the city** (a bridge change, deliberately deferred).

## 7. The harness, and why its history matters

`.gauntlet/capture.mjs` boots the real page in headless Chromium, builds a district through
the **shipped placement path**, and photographs it in five framings.

🔴 **It was building the wrong district for most of this project's life.** `retail`, `shop`,
`arena`, `medlab`, `tenantbiz`, the trees, bushes, gardens and the fountain were **all
refused**, for four separate reasons — the research tree, the municipal build ceiling, a
scene line naming a *mesh* rather than a building, and headless Chromium auto-dismissing
`window.confirm` on any order over an hour. Rounds 0–12 were judged on a warehouse estate
with no commercial building in it, so **every "can you tell commercial from industrial from
the air" judgement before round 13 is void.**

🔴 **Cross-boot per-framing percentages are retired.** A null control on the fixed district
reads a **6.6× spread between framings with nothing changed**. Quote no percentage from it,
and no ratio below about 7×. `.gauntlet/layer-ab.mjs` is the instrument: one boot, layer
toggled, `render()` then `drawImage` **in the same task** — its do-nothing control is
exactly **0.000%**.

## 8. The rule that governs everything here

**Never ship a number with no model behind it, and never ship a rule nobody enforces.**

Two panels have had content torn out for the first; four gates have been closed for the
second. The pattern that keeps recurring is one seam that knows the rules and another that
writes the store — it has now been found three times (`districts` via `store.load()`,
`tenants` via `award()`, `landvalue`'s vitals chip) and will be found again.

When a panel cannot honestly show something, it says so. The citizen dossier marks a row
`UNAVAIL` with the reason; the budget names two lines the ledger cannot separate; the
card-value seam returns `null` **and not zero**, because zero is a number and this is an
absence.
