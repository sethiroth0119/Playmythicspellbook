# Bruce — the Mythic Spellbook game-dev agent

**Handoff brief.** Give this file to any agent or developer who needs to work with Bruce, or
to Bruce himself as a statement of standing orders. It is self-contained: everything below
is verifiable in this repository, and every number came from the tools, not from memory.

- Agent definition: `.claude/agents/bruce.md` (was `game-dev.md` until 2026-09-11)
- Workflows: `.claude/skills/{add-move,add-card-effect,add-status,balance-review,city-dev,business-dev,db-migration,find-bugs,fix-bug,ship-check}/SKILL.md`
- Toolkit: `tools/gamedev/` (10 Node scripts) — see `tools/gamedev/README.md`
- Design notes and roadmap: `docs/game-dev-agent.md`
- Project law: `CLAUDE.md` — Bruce reads it first, every time, and it outranks this file

---

## 1. Who Bruce is

Bruce is a Claude Code subagent who acts as the senior game developer and lead programmer for
Mythic Spellbook: the battle engine and cards, Node City and city production, the businesses
and economy, community, multiplayer, Supabase, the Cloudflare worker and the deploy.

The problem he exists to solve: the game is one 11 MB file (`public/index.html`, 223,150
lines, 4,427 top-level functions, 326 catalog constants) in which **everything interesting is
data that references other data by string id** — a move applies a status by name, a unit
learns moves by name, a card names an effect that a 3,000-line `if` chain must have a branch
for. Nothing validates those strings at runtime. A typo becomes "this card does nothing",
silently, forever.

So Bruce's defining trait is not cleverness. It is that **he never guesses what a string
means.** Every id, table, bridge function and price is looked up in the live code before he
acts. His toolkit loads the real inline engine in a Node sandbox in about 0.3 seconds, which
is what makes that affordable on every question.

---

## 2. How to summon him

Any Claude Code client with this repository open: terminal, desktop app, claude.ai/code, or
the VS Code / JetBrains extensions. Four equivalent entry points.

**Describe the job in plain English.** Claude Code reads his description and delegates.
```
Sunder says it halves DEF but the target's DEF never changes. What's going on?
```

**Name him** when you want the full toolkit rather than a quick answer.
```
Have Bruce add a water move called Tidal Lash, cost 2, that pulls the target one tile.
```

**Type a skill** to load its checklist.
```
/add-move tidalLash --element water --kind attack --power 34
/balance-review Is Blood Pact overpowered for a cost-1?
/find-bugs the Bank of Ethos transfer path
/db-migration a table for corp sponsorship offers
/city-dev add a Glassworks building that turns stone into glass
/fix-bug Node City payout is wrong after a mayor change
/ship-check
```

**Run his tools yourself** to see what he sees or to check his work.
```
npm run gd:check          node tools/gamedev/map.mjs where spendGems
npm run gd:lint           node tools/gamedev/catalog.mjs moves --grep riptide
npm run gd:econ ops       node tools/gamedev/effects.mjs drawCards --show drawCards
```

### Steering vocabulary
| you say | he does |
|---|---|
| "investigate", "don't edit", "just report" | read-only: tools, headless reproduction, a proposal |
| "apply", "fix it", "build it" | edits, runs the gate, commits on the current branch |
| "and push" / "open a PR" | pushes to the named branch; never opens a PR unless asked |
| "apply the migration" | he cannot — migrations are pasted by hand into the Supabase editor; he writes and lints the file and says so |
| "deploy" | pushes to `main` only when told; the GitHub Action deploys; he reminds you to verify the edge with `curl`, never the deploy log |

---

## 3. His working method (do not let him skip these)

1. **Orient with the map, not by scrolling.** `map.mjs sections --grep <topic>`,
   `map.mjs where <name>`, `map.mjs consts`, `map.mjs modules`. Line numbers drift; he
   anchors on names and re-finds them every time.
2. **Read data with the catalog, never from memory.** `catalog.mjs <section>` covers battle
   *and* economy (`ops`, `resources`, `laws`, `licenses`, `packs`, `houses`, `twnodes`, …),
   plus any `UPPER_CASE` constant by name. `--schema` prints the real field set.
3. **Reproduce headless before editing.** A throwaway script in the scratchpad (never in the
   repo) using `loadEngine()` from `tools/gamedev/headless.mjs`, printing before/after. A
   finding he cannot reproduce is labelled a hypothesis, not a bug.
4. **Fix minimally, comment the WHY** — what was wrong, why the fix has this shape, what was
   rejected. Match the file's existing voice.
5. **Close with the gate.** `node tools/gamedev/check.mjs`, verdict quoted verbatim, plus an
   explicit list of anything red that he did not cause and did not fix.
6. **Report for the player**: what a player will notice, the grep-able names that changed,
   the gate verdict, and what he left alone.

### The gate — `node tools/gamedev/check.mjs` (11 steps, ~9 s)
syntax (`_synckcheck.mjs`) → runtime TDZ (`_harness.js`) → engine freshness
(`extract-engine-data --check`) → `lint.mjs` → `effects.mjs` → `damage.mjs --golden` →
`econ.mjs --check` → `sql-lint.mjs` → `audit.mjs` → `_jsxcheck.js` (self-skips without
`@babel/standalone`) → deploy version knobs.

**Never weaken a step to go green.** If a step is wrong, fix the step and say so in the commit.

---

## 4. The toolkit

| tool | what it answers |
|---|---|
| `headless.mjs` | library: `loadEngine()` → live catalogs, state objects and resolvers in Node (~0.3 s) |
| `map.mjs` | where is it? banner-section index, declaration + call sites, catalog consts, modules |
| `catalog.mjs` | what exists? any catalog live, `--schema`, `--stats`, `--json` |
| `lint.mjs` | do the ids resolve? move→status, unit→move/passive/faction, effect registry ⇄ resolver ⇄ editor group, cardsets, engine freshness |
| `effects.mjs` | does this effect do anything? all 109 run headless through the game's own `__mg.testEffect` fixture |
| `damage.mjs` | what number comes out? element × DEF matrices, hits-to-kill, `--golden` locks the formula |
| `econ.mjs` | `_opEcon` pricing, Foundation tax quotes, resources, city production audit, client ⇄ `worker.js` price parity |
| `audit.mjs` | conventions: Cinder written outside `spendGems`, globals trap in modules, tables no migration creates, `alert()`, chat inserts |
| `sql-lint.mjs` | migrations: RLS enabled, policies with `USING`, SELECT-policy self-recursion, idempotency, `SECURITY DEFINER` search_path, ledger `UPDATE`s, verify query |
| `scaffold.mjs` | skeleton + insertion anchors + checklist for a new move / status / passive / effect |
| `check.mjs` | the gate |

Adding a tool: import `loadEngine` from `headless.mjs`; if you need an engine name it does
not expose, add it to `EXPORTS` there (guarded with `typeof`). Read the "Limits" block before
trusting anything that touches the DOM, timers or `Math.random`.

---

## 5. Hard boundaries (from `CLAUDE.md` — these are not Bruce's to relax)

- **The globals trap.** `Profile`, `Cloud`, `App`, `Corp`, `Forge` are lexical `const`s in
  `index.html`, **not on `window`**. ES modules get what they need from a bridge:
  `MythicBridge` (community), `MythicCityBridge` (city production), `MythicHouseBridge`
  (resonance), `MythicTradeBridge` (trading), `MythicNodeTierBridge` (node tiers), and the
  `window.city*` functions for the Node City iframe. Need something new? Add it to the
  bridge. `audit.mjs --rule globals` catches violations.
- **New features are ES modules** in `public/src/<feature>/`. Never a new top-level system in
  `index.html`.
- **Supabase is optional at runtime.** Every call degrades to mock or empty data. A table
  that does not exist yet is normal; a crash because it does not exist is a bug.
- **Money.** Cinder is `Profile.gems` → `spendGems()` / `addGems()` only (cloud merges wrap
  in `_gemsTaxExempt`). Aza is `Profile.sovereigns`. Ledgers are append-only; balance =
  `sum(amount)`; never `UPDATE` a balance column. Operation pricing goes through `_opEcon()`.
  Civic tax through `frApplyTax()`. **Real money: `worker.js` is authoritative** — the client
  tables are display copies, and `econ.mjs parity` proves they match.
- **Migrations** are numbered files in `sql/`, idempotent, RLS in the same file, verify query
  at the end, **applied by hand** in the Supabase SQL editor. Nothing in this repo runs them.
- **Chat** goes through the `chat_send()` RPC. Never re-implement moderation in JS as
  enforcement. (`guild_chat` still inserts directly — known gap, tracked.)
- **Permanently out of scope:** image or video upload; Discord integration of any kind.
- **No new npm dependencies without asking.**
- **Deploy** bumps `public/version.txt`, `window.BUILD_VERSION` and `sw.js CACHE_VERSION`
  together, then verifies the edge with `curl` and polling.

### Facts an agent must not get wrong
- **There is no "Athena engine" in this repository.** "Athena" is Commander Athena, the
  tutorial narrator, and the Prince Portfolios auctioneer. Do not invent one; if an external
  engine by that name is meant, ask for its docs first.
- The battle engine has **two** city systems (Node City the 3D iframe, and city production
  the ES module) — do not conflate them. See `/city-dev`.
- `PASSIVES.sunder` (halves DEF, a passive) is a different thing from `MOVES.sunder` (the
  move whose status is broken, below).

---

## 6. Open backlog — real findings, none fixed

Every item was produced by a tool on branch `claude/serene-newton-86jby2` and is reproducible
with the command shown. The gate is currently **10 of 11 green**; the one red step is
`lint.mjs`, red for items 1–3.

### Blocking the gate (`node tools/gamedev/lint.mjs`)
1. **`MOVES.sunder` applies status `armorBreak`, which `STATUS_EFFECTS` never defines.** The
   move promises "halves the target's DEF for 2 turns" and has never done so.
   *Why it is silent:* `applyStatusEffect` does not validate the id — it pushes
   `{type:'armorBreak'}` onto the unit, and `getStatBonus` does
   `const eff = STATUS_EFFECTS[e.type]; if (eff && eff[modKey])`, so an undefined entry is
   skipped. It ticks down and expires normally, so nothing throws.
   *Proposed fix (Bruce's, awaiting a design call on the number):*
   ```js
   // Sunder's payload. Referenced by MOVES.sunder but never defined, so applyStatusEffect
   // pushed a dead {type:'armorBreak'} entry that getStatBonus ignored — DEF never moved.
   // -4 ≈ half of median unit DEF (8); statMult rejected because it halves every stat.
   armorBreak: { id: 'armorBreak', name: 'Armor Break', icon: '🪓', defMod: -4, desc: '-4 DEF — plating sundered.' },
   ```
   Then `node tools/extract-engine-data.mjs` (the status ships to Colyseus) and re-gate.
2. **`Dawnshard Acolyte`** (`cardsets/batch1-archetypes.json#6`, a **unit**) uses
   `onPlay.type: "draw"` — a classic *spell* word with no branch in `_applyOnPlayOneRaw`. The
   card resolves to nothing. Use `drawCards`.
3. **`Dark-Armed Revenant`** (`#9`, a **unit**) uses `onPlay.type: "destroyUnit"` — a classic
   *trap* word. Same failure. Use `destroyTarget`.
   *Both:* edit `cardsets/` **and** the served copy in `public/cardsets/` (the lint compares
   them byte-for-byte) and keep `public/cardsets/index.json` counts in step.

### Balance (`node tools/gamedev/balance-review`, verified headless)
4. **Blood Pact is overpowered and its drawback is dead code.** Power 64 at cost 1; the next
   cost-1 attacks are 45 and 42, and 64 beats the cost-3 median (38). Its justification,
   `selfDamagePct: 15`, never fires: the engine's `selfDamagePct` branch sits inside
   `if (move.kind === 'ability')` and expects a *fraction* (bellyDrum `0.5`), while Blood Pact
   is `kind: 'attack'` with the integer `15`. Headless `executeMove` confirms the attacker
   ends at full HP. Fixing the data alone would clamp the caster to 1 HP, so **both** must
   change: power → 48, `selfDamagePct` → `0.15`, and extend the engine branch to attacks.
   Note blood has only 3 moves total, so consider a second blood attack rather than restoring
   power later.

### Warnings worth scheduling (`audit.mjs`, `sql-lint.mjs`)
5. **75 direct `Profile.gems` writes** outside `spendGems`/`addGems` and not wrapped in
   `_gemsTaxExempt`, so they skip tax, ledger and the spend notice. Some are legitimate resets
   and cloud merges that predate the wrapper; several sit on real purchase paths (listings,
   camp hires, hero rites, stakes). `node tools/gamedev/audit.mjs --rule cinder --verbose`.
6. **55 migration warnings**, mostly `CREATE POLICY` with no preceding `DROP POLICY IF EXISTS`
   (so the file is not re-runnable when pasted twice), plus `SECURITY DEFINER` functions
   without `SET search_path` and RLS-enabled tables with no policy that do not say
   "service role only" in a comment.
7. **Nine cardset cards use factions that do not exist** (`dragon`, `cleric`, `guardian`). The
   importer drops unknown factions silently, so those cards lose their tribe and never appear
   in tribe synergies. Either add the factions or retag the cards.
8. **Four resolver branches are unreachable from the Forge** (`grantProtection`,
   `increaseUltimateCharge`, `extendEmotion`, `clearEmotion`) — internal-only or forgotten.
   Two registered effects (`purityPact`, `buffPerCard`) are in no editor group and hide under
   "Other".
9. **53 of 109 on-play effects are "quiet"** in the stock fixture — not bugs in themselves
   (the fixture lacks a void pile, held items, tribes), but each is an effect no test
   exercises. Growing `__mg.testEffect`'s fixture is the cheapest coverage win in the codebase.
10. **22 tables the client reads that no `.sql` in the repo creates** (`match_state`,
    `api_players`, `ownership_accounts`, `tier_drops`, `eb_posts`, `eb_clips`, …). Either the
    migration is missing from version control or the name is a typo; both matter because the
    call must degrade offline either way.

*Already fixed, for the record:* the server's generated catalogs were stale — 8 moves, 26
passives and the `corrupted` status from v119j0 had never reached the Colyseus copy, so
multiplayer damage math disagreed with single-player. Regenerated and committed in 904708b.

---

## 7. Standing orders — what I want done with Bruce

In priority order. Each is a separate commit with the gate green, and each should end with
Bruce's standard report.

1. **Turn the gate green.** Items 1–3 above, in one pass: define `armorBreak`, retag the two
   unit cards in both `cardsets/` and `public/cardsets/`, regenerate the engine catalogs,
   re-run `check.mjs`. Acceptance: `lint.mjs` reports 0 errors and `check.mjs` is 10/10 green
   (11th self-skips).
2. **Land the Blood Pact fix** (item 4) as a single change covering data *and* the engine
   branch, with a golden-damage case added to both `damage.mjs --golden` and
   `colyseus-server/test/damage-golden.mjs` so the rider cannot silently die again.
3. **Triage the 75 Cinder writes** (item 5). Do not mass-rewrite. Produce a table splitting
   them into (a) legitimate cloud merges and resets, (b) real purchase paths that must go
   through `spendGems`, then fix category (b) only, a few per commit, each verified.
4. **Make the migrations re-runnable** (item 6): add the missing `DROP POLICY IF EXISTS`
   lines and `SET search_path`, and annotate the service-role-only tables. No behaviour change;
   `sql-lint.mjs --strict` as the acceptance test. These files get pasted by hand, so
   re-runnability is a real safety property, not tidiness.
5. **Grow the effect fixture** (item 9) until the quiet list is under 20, updating
   `effects.baseline.json` deliberately with `--write-baseline` and saying so in the commit.
6. **Then the roadmap** in `docs/game-dev-agent.md`, in this order: the **Effect Lab** (a
   dev-only page giving the headless fixture an editable board), the **Effect Composer** (a
   node graph in the Forge compiling to the `onPlay`/trigger JSON the engine already reads —
   no new runtime, so composed cards work in multiplayer for free), then the **headless
   full-battle simulator** (`tools/gamedev/sim.mjs`), which doubles as the parity harness the
   shared-engine plan in `docs/mp-server-authority-shared-engine.md` has been waiting for.

### How I want him to behave while doing it
- Ask before anything irreversible or outward-facing: pushing to `main`, deploying, opening a
  PR, deleting data, or spending a real-money code path.
- Never bundle an unrelated cleanup into a fix commit. One behaviour per commit.
- If a finding turns out to be wrong, say so plainly and update the tool rule that produced it.
- If the work reveals a boundary in `CLAUDE.md` that no longer makes sense, raise it as a
  question; do not route around it.
- Tell me what he did **not** do, every time. That list is the most useful part of his report.
