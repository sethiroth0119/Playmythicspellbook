# 🜂 Leylines — handoff (2026-09-13)

Everything below is verified against the branch, not from memory. Line numbers
are from `public/index.html` at `bf10dd3` and will drift — the grep next to each
one is the durable way to find it.

## Where things stand

| | |
|---|---|
| Branch | `claude/great-turing-r2vsu9` (pushed) |
| Base | `449ac97` (Athena Engine merge, v121v116) |
| Commits | 3 on top of base, 1,881 lines added, 3 files |
| Merged to main | **no** |
| PR opened | **no** |
| Deployed | **no** — not version-bumped (see *Before deploy*) |
| Supabase migrations | **none** — this feature adds no tables and no SQL |
| Tests | `node _ley_smoke.mjs` — 136 assertions, all passing |
| Live preview | https://claude.ai/code/artifact/8c039206-6e08-41a8-8730-44632ade5f80 |
| Working tree | clean |

**What it is.** Duelists-of-the-Roses terrain, adapted to a board with 11
terrain paints and 21 elements. A 1:1 port is not available to us (DotR had six
terrains for six attributes), so the paint and the charge are separate layers:

```
tile.terrain -> 'lava'                   the ART.  Athena owns it. Static.
tile.ley     -> { elem, power, owner }   the MECHANIC. Fought over.
tile.elevRung-> 0..4                     the HEIGHT. Was scenery until now.
```

Terrain seeds ley on first read; after that the ley layer is live, and all 21
elements are representable without one new sprite. `road` / `rubble` / `dirt`
seed **neutral** on purpose — they are most of the board and the contested
ground the match is decided on.

## The three rules

| | |
|---|---|
| **Attunement** | A unit fighting on ley matching the MOVE's element hits harder and takes less; on ley whose element beats the move, it hits softer. Read from the game's own `TYPE_CHART`, never a second table. **Elements own the damage numbers.** |
| **Territory** | Every living unit converts the hex it holds to its own element, automatically and free. Entrenched ley climbs; hostile ley must be ground down before it flips; unheld ley decays. |
| **Affinity** | Factions get **tactics** on home ground — movement, regen, hazard immunity, a defensive ward — **never damage.** This is what stops `2.0× chart × ley × crit` from one-shotting through the roster. |

## Architecture

`public/src/battle/ley.js` (978 lines) is the whole engine, registered as
`window.MythicLey`. `index.html` carries only seams. Loaded as a classic
deferred script exactly like `effects.js`.

**🔴 The globals trap (CLAUDE.md).** `TYPE_CHART`, `getElementsOf`,
`ELEMENT_DATA`, `isEffectivelyFlying` and `distance` are top-level `const` in
index.html — lexical bindings, **not** on `window` — so the module cannot see
one of them. They are handed over through `MythicLey.wire()` at `_ley()`.
Every wired function has a fallback, and every call site is `typeof`-guarded,
so an absent or unparseable module costs the ley layer and nothing else.

**🔴 Hex distance is wired, never reimplemented.** The board is odd-r and
`_paintSurface` once shipped a *square* disc on it that survived a whole wave
(HEXSPEC §6). The fount disc and the high-ground range test both measure with
the game's own `distance()`. `_ley_smoke.mjs` asserts the fount disc is **19
hexes** — the r=2 hex disc; a square would be 25 — so the geometry is checked,
not assumed.

**🔴 One clamp, one place.** Everything the module hands to `calculateDamage`
goes through `clampMod()`, capped at `LEY.CAP`, with `LEY.INTENSITY` applied
*inside* the clamp so a modifier added later cannot skip the dial and turning
intensity up cannot breach the cap. Measured: attuned power 3 on a 4-rung cliff
at range asks for **+74% and receives exactly +60%**. Full band across every
combination is **×0.61 – ×1.60**.

**Seeding is lazy and idempotent** (`state._leySeeded`), not done at each battle
constructor. index.html builds battle state in several places (solo, campaign,
roguelite, the multiplayer snapshot path) and seeding on first read cannot be
missed by a future one. It is deterministic from a map both clients already
agree on, so multiplayer seeds identically with nothing to sync; the ley then
lives on `state.board` and travels inside the normal state snapshot.

## Every seam in index.html

Seventeen touch points. Grep the string, not the line.

| Line | Grep | What |
|---|---|---|
| 84786 | `function _ley()` | the bridge + lazy `wire()` |
| 84803 | `distance: (a, b) => distance` | hex distance handed over |
| 84824 | `function _leyConfigure` | per-mode enable + intensity |
| 84850 | `function _leyMap` | editor paint + generator surfaces + elev |
| 84865 | `function tickLey` | territory tick wrapper (**returns state**) |
| 85038 | `_M.ignoresHazard(state` | faction hazard immunity, in `tickSurfaces` |
| 85256 | `_M.reactionFor(state` | ley → surface reaction chains |
| 85271 | `hasPassive(attacker, 'leybreaker')` | counterplay fires |
| 40548 | `leybreaker: { id:` | the passive's declaration |
| 100898 | `_M.moveBonus(App.state` | faction mobility, in `_getMoveRangeRaw` |
| 102360 | `_M.damageMod(App.state` | attunement + high ground, in `calculateDamage` |
| 119707 | `_M.knockbackBonus(s` | downhill shove |
| 121515 | `s = tickLey(s)` | the tick, beside `tickSurfaces` |
| 159562 | `M.control(s)` | control bar in the field-conditions strip |
| 167840 | `_M.isFount(s, x, y)` | fount marker |
| 167861 | `_M.project(s, sel` | move-tile projection |
| — | `{ aiExpectedValue: true }` | damage forecast on attack tiles |
| 178861 | `_M.aiTileScore(App.state` | AI leyline awareness |

⚠ `tickLey` follows `tickSurfaces`' contract and **returns state**. The call
site must assign the result — calling it as a bare statement silently drops
every conversion. Same footgun `_cpTickControlPoints` documents at its own call
site, in the opposite direction.

## Tuning

**All of it is in `LEY` at the top of `ley.js`** — the `_opEcon()` pattern
applied to combat. No ley constant is written down anywhere else, so balancing
is one edit and never a hunt through index.html. Tune `LEY`, never a call site.

Two dials worth knowing:

- `LEY.ENABLED` — false makes **every** entry point inert: no seeding, tick,
  modifier, tint, fount, control tally, AI score or break. Asserted in the smoke
  test.
- `LEY.INTENSITY` — scales every modifier the file produces. `_leyConfigure()`
  sets campaign/story to **0.5** (a full territory war on top of an authored
  fight fights the author) and everything else to 1. Goes through
  `configure()`, which clamps 0–3: a stray saved preference of `50` would
  otherwise scale `moveBonus` and the AI weights, neither of which passes
  through the cap.

### AI weights, calibrated against the existing scale

`aiTileScore` is deliberately narrow. `tryAttackFromPos(dest)` already probes
the **real** `calculateDamage` at the hypothetical tile, so attunement and high
ground were already priced into the AI's destination score before any of this
— adding them again would double-count. These cover only ground worth taking
when there is nothing to hit from it.

| Score | Source |
|---|---|
| 800 | a KO (existing, `aiScoreAttack`) |
| **190** | take an enemy-held fount |
| **130** | take an open fount |
| ~100 | one ordinary attack (existing — score *is* expected damage) |
| **90** | hold our own fount |
| 38 | ignite oil under a foe (existing) |
| **34** | grind enemy ground |
| **18** | claim bare ground |
| **−26** | discordant ground |

A kill still outranks any fount; a fount outranks a chip hit; claiming ground
never outranks a real swing.

## Open questions — not bugs, decisions

**1. Chaos vs scarcity.** Conversion is automatic and free, which is chaotic and
fun, but **abundance is not strategy**. Founts are currently the *only* scarce
thing on the board. If this should feel like a strategy game rather than a
lively modifier, the lever is making ground harder to hold — slower conversion,
faster decay, or restricting conversion to heroes/elementals. That is a `LEY`
edit, not a refactor. **Undecided on purpose; answer it by feel.**

**2. A fire unit on lava ley gets nothing.** Found by driving the preview, not
by reading the code. `lava` is its own element in `ELEMENTS`, `EDITOR_SEED` maps
lava terrain → `lava` ley, and attunement is an exact match — so an Inferno Lord
standing in molten rock reads as neutral ground. Correct code, questionable
design. Three options:

  1. seed lava terrain as `fire` ley — one line, but then `lava` has no home
     terrain at all;
  2. an adjacency table where `fire`/`lava` part-attune to each other at half
     weight — **recommended**; fixes the surprise without collapsing two
     elements into one;
  3. leave it — exact matching is the DotR rule.

**3. No ley-aware content yet.** `move.breakLey` and the `leybreaker` passive
are engine support with **no card, move or unit using them**. Counterplay
exists but nothing in the game currently grants it.

## Before deploy

1. **Version bump — deliberately not done.** `public/version.txt`,
   `window.BUILD_VERSION` and `sw.js` `CACHE_VERSION` move together, and the
   release sweep drags all nine knobs onto one string. Left for whoever runs
   that sweep. `src/battle/ley.js?v=` is currently `v121v117`.
2. **Drive the real battle screen.** ⚠ **The biggest gap.** The engine is
   verified headless (136 assertions) and the *module* was driven in a browser
   for the preview artifact, but `index.html` itself never was. Three things
   are unproven in situ:
   - the control bar in `.bc-fieldcond`;
   - the forecast and projection text on real `.tile` elements — `.tile` carries
     `contain: layout paint` (CONTRACT §6.10), which is why these are styled
     **inline**, and that is exactly the rule that needs a look;
   - fount markers at small tile sizes.

   Per CLAUDE.md the Browser pane composites at ~0.56 Hz, so call renderers
   directly and inject a `requestAnimationFrame = cb => setTimeout(cb,16)` shim
   into a throwaway copy of the page.
3. **The `.gauntlet` scan scripts CLAUDE.md names are not in this tree** — only
   `_forge-harness.mjs`. `comment-scan.mjs`, `modcheck.mjs` and
   `precommit-scan.mjs` could not be run. `node _synckcheck.mjs` is ALL CLEAN,
   `node --check public/src/battle/ley.js` passes, and the diff introduces no
   HTML comment markers (checked).
4. `npm install` is needed for `_synckcheck.mjs` — it imports `terser`, which is
   already in `package.json`. `node_modules` was empty on this container.

## Testing

```
node _ley_smoke.mjs        # 136 assertions — the whole feature
node _synckcheck.mjs       # index.html syntax gate
node --check public/src/battle/ley.js
```

The two checks in `_ley_smoke.mjs` most worth keeping:

- **id validity.** `ley.js` names elements, factions, terrain keys and surface
  ids as string literals in its own tables. A typo throws nothing, breaks no
  syntax gate, and shows up only as "that faction's perk never seems to fire" —
  so the test parses `ELEMENTS` / `FACTIONS` / `_BME_TERRAIN` / `SURFACE_TYPES`
  straight out of index.html and asserts every literal against them.
- **projection equals reality.** The move-tile preview is asserted to return
  exactly what `damageMod` returns, so the preview can never drift from the rule
  it previews.

Two failures during development were **wrong assertions, not wrong code** (lava
is a real element; discord is ground-beats-move, so an off-element move is only
neutral when the ground does not beat it). Both are now documented in the test.

## Commits

| | |
|---|---|
| `ef2e989` | phase 1 — seed, attunement, territory, affinity, hex tint, painted-map guard |
| `d650550` | phase 2 — founts, elevation, ley reaction chains |
| `bf10dd3` | phase 3 — AI awareness, forecast, projection, control bar, counterplay, mode dial |
