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
| `check.mjs` | the gate: syntax, runtime, engine freshness, lint, effects, golden, version knobs |

`npm run gd:check` / `gd:lint` / `gd:effects` / `gd:catalog` are shortcuts.

The Claude Code agent that uses these lives in `.claude/agents/game-dev.md`; the step-by-step
workflows are the skills in `.claude/skills/` (`/add-move`, `/add-card-effect`, `/add-status`,
`/fix-bug`, `/balance-review`, `/ship-check`). Design notes and the roadmap for a visual
effect composer: `docs/game-dev-agent.md`.

## Adding a tool
Import `loadEngine` from `headless.mjs`. If you need an engine name it does not export, add
it to `EXPORTS` there (guarded with `typeof`, so a rename yields `undefined`, not a crash).
Read the "Limits" block in `headless.mjs` before trusting a result that touches the DOM,
timers or `Math.random`.
