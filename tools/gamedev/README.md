# tools/gamedev — the game-developer toolkit

Headless tooling for the battle engine in `public/index.html`. Every tool loads the real
inline script in a Node `vm` (see `headless.mjs`, ~0.3 s) and works on the LIVE data and
functions, so nothing here can drift from the game.

| tool | one line |
|---|---|
| `headless.mjs` | `loadEngine()` → catalogs + resolvers out of index.html. Library, not a CLI. |
| `catalog.mjs` | browse/inspect any catalog; `--schema` shows the real field set, `--stats` the distribution |
| `lint.mjs` | id cross-references, ONPLAY registry ⇄ resolver parity, cardsets, server-catalog freshness |
| `effects.mjs` | run every on-play effect through the in-app `__mg.testEffect` harness, headless |
| `damage.mjs` | deterministic damage matrices from `calculateDamage`; `--golden` locks the formula |
| `scaffold.mjs` | paste-ready skeleton + anchors + checklist for a new move / status / passive / effect |
| `check.mjs` | the gate: syntax, runtime, engine freshness, lint, effects, golden, economy, sql, audit, jsx, version knobs |
| `map.mjs` | navigate: banner-section index, `where <name>` (declaration + section + call sites), catalog consts, modules |
| `econ.mjs` | economy headless: `_opEcon` pricing table, tax quotes, resources, city production audit, client ⇄ worker.js parity |
| `audit.mjs` | whole-game conventions: direct Cinder writes, globals trap in modules, tables no migration creates, `alert()`, chat inserts |
| `sql-lint.mjs` | migration rules from CLAUDE.md: RLS enabled + policies + USING, recursion, idempotency, verify query, ledger UPDATEs |
| `mcp.mjs` | **the live page as an MCP server** — boots index.html in headless Chromium and answers what only a browser knows: which ES modules mounted, the real `MythicBridge` surface, Athena's registered scenes, whether a screen paints. Zero npm deps; all off-origin traffic aborted, so it never touches Supabase or the worker. |

`npm run gd:mcp` starts the MCP server (normally Claude Code starts it from `.mcp.json`).

`npm run gd:check` / `gd:lint` / `gd:effects` / `gd:catalog` / `gd:econ` / `gd:audit` / `gd:sql` / `gd:map` are shortcuts.

The Claude Code agent that uses these is **Bruce** (`.claude/agents/bruce.md`); the step-by-step
workflows are the skills in `.claude/skills/` (`/add-move`, `/add-card-effect`, `/add-status`,
`/balance-review`, `/city-dev`, `/business-dev`, `/db-migration`, `/find-bugs`, `/fix-bug`, `/ship-check`). Design notes and the roadmap for a visual
effect composer: `docs/game-dev-agent.md`.

## Adding a tool
Import `loadEngine` from `headless.mjs`. If you need an engine name it does not export, add
it to `EXPORTS` there (guarded with `typeof`, so a rename yields `undefined`, not a crash).
Read the "Limits" block in `headless.mjs` before trusting a result that touches the DOM,
timers or `Math.random`.
