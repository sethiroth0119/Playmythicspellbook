# tools/warpath-deck — does a drafted Warpath pool make a playable deck?

WARPATH's whole claim is that it is MTG Limited by another route: you build a deck by
surviving a world. Nothing in this repo had ever tested whether the pool you come home
with is a **deck**. The four-player harness in `tools/warpath-sim/` resolves every battle
with `rand() < 0.55`; the offline mock never touches the battle engine at all.

This harness drafts real pools and plays them through the **real Mythic Spellbook battle
engine**.

## What "real" means here

| piece | where it comes from |
|---|---|
| the map, biomes, water, move cost | `public/warpath/warpath-mapgen.js` |
| the encounter roll and the 3-card offer | `warpath-mapgen.js` + `public/warpath/warpath-data.js`, transcribed from `warpath_encounter_open` in the migration — and **cross-checked against real Postgres** by `verify.mjs` |
| the starter pool, recruit pools, camp costs, extraction cap | `public/warpath/warpath-data.js` |
| turning a pool into a 40-card deck | the shipped `warpathPadDeck` (`public/index.html:215643`), called in the browser |
| the battle | `initGame` / `doAIStep` / `executeMove` / `_fireTriggers` / `startTurn` in `public/index.html`, running in headless Chromium |

Nothing in `public/` is modified. The harness loads `public/index.html` over a local
static server and calls into it.

### Both sides are played by the game's own AI

The engine speaks one owner vocabulary — `'player'` is you, `'ai'` is the enemy — and the
AI controller only pilots `'ai'`. Rather than hand-rolling a turn loop for the other half
(which would make half the match not-the-game), the harness calls the production function
`swapBattlePerspective` (`public/index.html:173901`) before each half-turn. That is the
same transform multiplayer applies to every snapshot arriving from the other client, and
its documented invariant is "swapping twice must be the identity". Whichever side is about
to act becomes `'ai'`, and the shipped AI plays it, on the shipped mirrored board.

### What is deliberately not real

Stated in full at the top of `page-driver.js`, and repeated here because a result is only
as honest as its caveats:

1. **Presentation is stubbed.** `renderBattle` / `render` / `showToast` / `playSfx` are
   no-ops and `applyAnimSpeed` returns 0. Rules untouched; only paint and the AI's
   cosmetic pacing. Without it a match takes ~40 s instead of ~1.4 s.
2. **`endPlayerTurn` never runs.** Every side acts as `'ai'`, so every turn ends through
   `endAITurn`, which increments `state.turnNumber`. Turn numbers therefore advance once
   per *half*-turn instead of once per round, and the day/night cycle
   (`DAY_NIGHT_PERIOD = 5`) flips twice as often as in a human game. It hits both sides
   identically.
3. **Progression is pinned.** `buildHero`/`buildUnit` roll and persist a random Nature and
   Trait per card id, and kills bank EVs and bond mid-battle
   (`public/index.html:95466`). Left alone, match N+1 would be played by stronger units
   than match N. Every match is preceded by a reset that pins Nature to `hardy`
   (the no-bias nature) and Trait to an unknown id (`applyTrait` no-ops), and clears EV
   and stat-gain tables.
4. **The draft POLICY is this harness's, not the server's.** Where a hero walks, which of
   three offers it takes, what it builds and what it recruits are decisions the server has
   no opinion about. They live in `draft.mjs` and are named in the output.
5. **The hero is held constant on both sides** (`--hero`, default `cedric`) so a result is
   about the deck rather than the hero matchup.

## Running it

```sh
# one-time: the browser bindings this harness needs, without touching package.json
ln -s /opt/node22/lib/node_modules/playwright      tools/warpath-deck/node_modules/playwright
ln -s /opt/node22/lib/node_modules/playwright-core tools/warpath-deck/node_modules/playwright-core

# check the draft mirror against the real SQL (needs the scratch cluster)
tools/warpath-sim/pg.sh up
node tools/warpath-deck/verify.mjs

# the experiment
node tools/warpath-deck/run.mjs                     # every stage
node tools/warpath-deck/run.mjs --stage q4          # one stage
node tools/warpath-deck/run.mjs --workers 6 --scale 2
```

`--workers` is the number of browser tabs matches are spread across (one full copy of the
game each, ~250 MB). `--scale` multiplies match counts. Results land in
`tools/warpath-deck/out/<stage>.json`.

### Stages

| stage | question |
|---|---|
| `control` | seat and first-player bias, measured on a mirror match. **Read this first** — every other number is only as trustworthy as this one. |
| `q1` | is a drafted pool legal and playable? size, curve, unit count, dead cards |
| `q2` | two independently drafted pools — is it fair, and how wide is the spread? |
| `q3` | is any biome archetype dominant? |
| `q4` | do Warpath pools beat normal collection decks? |
| `q5` | does the 25 → 31 → 38 → 46 → 52 → 60 progression work? |

## Files

- `serve.mjs` — static server for `public/`
- `engine.mjs` — boots Chromium, installs the driver, spreads matches over a tab pool
- `page-driver.js` — runs inside the game. The AI-vs-AI loop, deck inspection, catalogue export
- `draft.mjs` — a real expedition: map, encounters, harvest, camp, recruit, extract
- `pools.mjs` — pool → the 40 cards the engine is handed
- `verify.mjs` — the draft mirror vs real Postgres
- `stats.mjs` — Wilson intervals, quantiles, a seeded PRNG
- `run.mjs` — the five questions
