---
name: fix-bug
description: Diagnose and fix a bug in Mythic Spellbook's battle engine, cards, or effects with a headless reproduction first. Use for "X does nothing", "Y crashes", "Z deals the wrong damage", desyncs between client and server catalogs, or any regression report.
---

# Fix a bug

The rule: **reproduce headless before you touch the file, and keep the reproduction as
a check afterwards.** Guessing in an 11 MB file costs hours; a 0.3 s headless load costs
nothing.

## 1. Classify
| symptom | first tool |
|---|---|
| "effect X does nothing" | `node tools/gamedev/effects.mjs X --show X` — quiet vs threw vs queued |
| "move/status/passive is wrong" | `node tools/gamedev/catalog.mjs moves X` then `lint.mjs` (dangling id?) |
| "damage is wrong" | `node tools/gamedev/damage.mjs X --vs <unit>` and `--golden` |
| blank screen / page dies on load | `node _harness.js` (TDZ / const-order), `node _synckcheck.mjs` (syntax) |
| MP differs from single-player | `node tools/extract-engine-data.mjs --check` (stale server catalogs) |
| anything else in the resolver | write a 10-line script with `loadEngine()` from `tools/gamedev/headless.mjs`, build a minimal `state`, call the function |

## 2. Reproduce
Write the smallest state that shows the wrong output. For resolver bugs copy the fixture
shape from `window.__mg.testEffect` in index.html (units with `pos`, `owner`, `alive`,
`currentHp`, `statusEffects`; an 8×8 `board`; `player`/`ai` piles). Print before/after.

## 3. Locate
Grep by name, never by remembered line number. `_applyOnPlayOneRaw` for effects,
`executeMove` / `calculateDamage` / `applyDamageTriggers` for combat, `startTurn` for
ticks, `_fireTriggers` for trigger cards, `applyStatusEffect` / `isImmuneToStatus` for
statuses. Read the comments above the branch — they usually record the last bug here.

## 4. Fix minimally, explain in a comment
One behaviour per commit. The comment says what was wrong and why the fix is shaped this
way (the file's convention — see any `⚠` comment nearby). Do not "tidy" neighbours.

## 5. Lock it
- If it was a dangling id, lint already covers the class. Nothing more.
- If it was a formula, add a case to `damage.mjs --golden` AND to
  `colyseus-server/test/damage-golden.mjs` (they must agree).
- If it was an effect, make sure `effects.mjs` no longer reports it quiet; update the
  baseline only with `--write-baseline` and say so in the commit.

## 6. Gate
`node tools/gamedev/check.mjs` green. Commit: `Fix: <player-visible symptom> — <root cause in five words>`.
