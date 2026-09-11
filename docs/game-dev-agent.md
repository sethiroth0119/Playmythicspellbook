# The game-dev agent — what it is, what it found, where it goes next

Status: **v2 (2026-09-11) — whole game.** v1 covered the battle engine; v2 adds the city
builder, businesses and economy, Supabase migrations, the worker, and a bug-hunt workflow.
Toolkit in `tools/gamedev/`, agent (named **Bruce** as of 2026-09-11) in `.claude/agents/bruce.md`, workflows in
`.claude/skills/`.

## Scope (v2)
| domain | tools | skills |
|---|---|---|
| battle engine, cards, moves, effects | `lint` `effects` `damage` `scaffold` `catalog` | `/add-move` `/add-card-effect` `/add-status` `/balance-review` |
| Node City, city production, dwellings, resonance, node tiers | `econ city` `catalog resources` `map` | `/city-dev` |
| Corp ops, Just Business, banks, wallets, markets, cars, garage/Aza, Territory Wars | `econ ops\|tax\|parity` `catalog ops\|…` `audit --rule cinder` | `/business-dev` |
| Supabase | `sql-lint` `audit --rule supabase` | `/db-migration` |
| everything | `map` `audit` `check` | `/find-bugs` `/fix-bug` `/ship-check` |

**"Athena engine":** there is none in this repository. "Athena" is Commander Athena, the
tutorial narrator, and the Prince Portfolios auctioneer. If an external engine by that name
is meant, the agent needs a pointer to its docs before it can "know" it — nothing here
pretends otherwise.

## The problem it solves

The battle engine is one 11 MB inline script. Everything interesting in it is **data that
references other data by string id**: a move applies a status id, a unit learns move ids, a
card's `onPlay.type` names an effect id that a 3,000-line `if` chain must have a branch for.
None of those strings are checked anywhere at runtime — a typo becomes "this card does
nothing", forever, silently. Meanwhile nobody (human or model) can hold the vocabulary in
their head: 180 moves, 59 statuses, 174 passives, 109 authorable effects, 21 elements,
42 factions.

So the agent's job is not to be clever; it is to **never guess**. Every tool below reads the
live file, so its answers are always current, and the gate refuses a commit that leaves a
dangling reference.

## How it works: the headless engine

`tools/gamedev/headless.mjs` extracts the inline script and runs it in a Node `vm` with a
persistent `window`, an in-memory `localStorage`, no-op timers and a Proxy stub for every
DOM/network object. Because catalogs are lexical `const`s (see CLAUDE.md, "the globals
trap"), it appends an exports epilogue that copies the wanted names onto `window.__gd`
before execution. Load time ≈ 0.3 s. The in-app effect harness `window.__mg.testEffect`
survives the load, so the exact fixture the browser console uses runs in CI.

What this cannot do: anything that needs layout, real timers or an interactive counter
chain. Rolls use the real `Math.random`; deterministic tools pass `accuracy:100, crit:0`.

## The tools

| tool | what it answers |
|---|---|
| `catalog.mjs` | "what exists?" — any catalog, one entry, `--schema` (field frequency = the real schema), `--stats` (distribution) |
| `lint.mjs` | "is every id real?" — moves→statuses, units→moves/passives/factions, ONPLAY registry⇄resolver⇄groups, cardsets JSON, `public/cardsets` mirror, server catalog freshness |
| `effects.mjs` | "does this effect do anything?" — all 109 in 50 ms; verdicts works / queued / quiet / threw, with a committed quiet-baseline so only regressions fail |
| `damage.mjs` | "what number comes out?" — element × DEF matrices, hits-to-kill vs a real unit, side-by-side compares, and `--golden` (the same seven cases the server locks to) |
| `scaffold.mjs` | "where do I put it and what else must I touch?" — skeleton + insertion anchors + checklist for move / status / passive / effect |
| `check.mjs` | "can I commit?" — syntax, runtime TDZ, engine freshness, lint, effects, golden, deploy version knobs |

## What the v2 tools found (whole game)

- **`audit.mjs`** — 75 direct `Profile.gems` writes outside `spendGems/addGems` and not
  wrapped in `_gemsTaxExempt`. Some are legitimate resets and cloud merges that predate the
  wrapper; several sit on purchase paths (listings, camp hires, hero rites, stakes) and
  therefore skip the tax, ledger and spend-notice that `spendGems` provides. Each is a
  five-minute fix; the list is the backlog. Also 4 native `alert()`s and one `guild_chat`
  direct insert (known).
- **`sql-lint.mjs`** — 0 errors after calibration; 55 warnings, mostly `CREATE POLICY`
  without a preceding `DROP POLICY IF EXISTS` (so the file is not re-runnable), a handful
  of `SECURITY DEFINER` functions without `SET search_path`, and RLS-enabled tables with no
  policy that do not say "service role only" in a comment.
- **`econ.mjs`** — city production catalog clean (17 buildings, 14 resources); Garage rigs
  and Aza packages match `worker.js` names, prices and grants.
- **`check.mjs`** now runs eleven steps in about ten seconds.

## What the first (battle) run found (all real, none fixed here on purpose)

1. **`MOVES.sunder` applies status `armorBreak`, which is not defined.** The move's text
   promises "halves the target's DEF for 2 turns"; it has never done so. `/add-status`
   documents the fix.
2. **Server catalogs were stale.** The v119j0 content (8 moves, 26 passives, `corrupted`)
   never reached `engine/` or the Colyseus copy. Regenerated in this commit — that is a
   generated-file refresh, not a logic change.
3. **Cardset batches reference three factions that do not exist** (`dragon`, `cleric`,
   `guardian`). The importer drops unknown factions silently, so nine cards lose their
   tribe on import. Either add the factions or retag the cards.
4. **Two unit cards in the batches carry effect words the unit path cannot resolve**
   (`destroyUnit`, `draw` — classic spell/trap words, not on-play ids). Those units will
   resolve to nothing when played. The on-play equivalents exist (`destroyTarget`,
   `drawCards`).
5. **Four resolver branches are not authorable** (`grantProtection`,
   `increaseUltimateCharge`, `extendEmotion`, `clearEmotion`) — internal-only or forgotten.
6. **`purityPact` and `buffPerCard` are in no editor group**, so they hide under "Other".
7. **53 of 109 effects are quiet in the stock fixture.** Not bugs by themselves — the
   fixture lacks a void pile, held items, tribes — but each is an effect no test exercises.
   Growing the fixture is the cheapest coverage win in the codebase.

## Roadmap — the "Playmaker"-shaped question

Playmaker is a visual state machine: designers wire *events → conditions → actions* with
no code and the runtime interprets the graph. Mythic Spellbook is already 80% of the way
there without knowing it: cards ARE data (`onPlay`, `onPlayExtra`, `scalePer`, `filter`,
triggers with `TRIGGER_EVENTS` × `TRIGGER_EFFECTS`, in-grave triggers, counter modes), and
the resolver is an interpreter. What is missing is the *authoring surface* and the *safety
net*. In order of value:

### 1. Effect Lab (weeks, not months) — a page in `public/src/lab/`
A dev-only page that loads the engine the same way `headless.mjs` does (a `<script>` with
the inline source is not needed — the page IS the app; the Lab runs inside it behind a
flag) and exposes the fixture as an editable board: drop units, set piles, pick weather,
then run any `ONPLAY_TYPES` id with any `needs` values and watch the before/after diff and
log. It is `__mg.testEffect` with a UI. Every quiet effect becomes a five-minute check.

### 2. Effect Composer (the Playmaker part) — `public/src/forge-composer/`
A node graph inside the Forge editor that compiles to the JSON the engine already reads:

```
[Trigger: A unit dies (death)]  ──▶ [Condition: it was an ally, within 2 tiles]
        └─▶ [Action: buffAllies status=rage duration=2]
        └─▶ [Action: drawCards amount=1 scalePer=grave/owner/nameIncludes:"Ualti"]
```

Nodes are `TRIGGER_EVENTS`, `filter` predicates, and `ONPLAY_TYPES` with their `needs`.
Compilation target is exactly `{ triggers:[{event, effect|onPlay, filter}], onPlay,
onPlayExtra }` — **no new runtime**, so the server-authority plan in
`docs/mp-server-authority-shared-engine.md` is untouched and every composed card works in
MP for free. The `lint.mjs` registry check guarantees every node the palette offers has a
resolver branch. Text-only, so no UGC image obligations.

### 3. Headless full-battle simulator — `tools/gamedev/sim.mjs`
`executeMove`, `startTurn`, `_fireTriggers`, `applyOnPlayEffect` all load today. The next
tool builds a real `initGame`-shaped state from two deck ids and lets the AI (`doAIStep` is
also in the file) play both sides for N games with a seeded RNG. Output: win rate per deck,
average turns, damage share per move, effects that never fired. That is the balance tool
`/balance-review` currently approximates with tables — and it is also the **parity harness
P0** the shared-engine doc has been waiting for: run the same seed through the client core
and `engine/`, diff.

### 4. Agent loop on top
With 1–3 in place the `game-dev` agent can take a card idea in plain English, compose the
JSON, prove it in the Lab headless, run 200 sims against the meta decks, and hand back a
diff plus a balance table — which is the "agent game developer" asked for, done on rails
the codebase already has rather than on a second engine.

## Roadmap additions for the whole game
- **`sim-econ.mjs`** — run `OPS_ECON` + terroir + tax over N simulated hours for a corp
  with a given roster and report Cinder/hour, payback and resource flows per op. The
  numbers are already reachable headless (`econ.mjs ops`); the loop is the missing part.
- **Bridge contract tests** — for each `window.MythicXBridge` and `window.city*` function,
  a table of (input → expected shape) run headless, so an iframe/module never breaks on
  a host refactor. `map.mjs modules` already lists the surfaces.
- **SQL apply log** — a `sql/APPLIED.md` the human ticks when a file has been run in the
  Supabase editor, so `audit.mjs` can distinguish "migration missing from repo" from
  "migration not yet applied".

## Conventions this toolkit follows
- Never edits `index.html` itself; it prints and checks. The edit is a human's or the
  agent's, with anchors, so the 11 MB file never gets a mechanical rewrite.
- Anchors are names, not line numbers. Every tool re-finds `^const MOVES = ` etc.
- Every rule in `lint.mjs` states what the failure means for the player.
- Baselines (`effects.baseline.json`) are committed and only change via `--write-baseline`,
  stated in the commit.
