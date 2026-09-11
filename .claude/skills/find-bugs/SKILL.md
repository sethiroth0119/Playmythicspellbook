---
name: find-bugs
description: Systematic bug hunt across Mythic Spellbook — run every static and headless check, triage the findings by player impact, reproduce the top ones headless, and report (or fix, when asked) with file:line evidence. Use when asked to find bugs, review a system, or audit the game.
---

# Find bugs

Bugs in this codebase are mostly **silent**: a string id that resolves to nothing, a
table that does not exist, a price the worker charges differently, a Cinder write that
skips the ledger. So the hunt starts with the machines, then goes to the code.

## 1. Run everything (≈10 s)
```
node tools/gamedev/check.mjs --verbose         # syntax, runtime TDZ, engine freshness, lint, effects, golden, econ, audit, sql-lint, versions
node tools/gamedev/audit.mjs --verbose          # whole-game conventions with every site listed
node tools/gamedev/lint.mjs                     # battle data
node tools/gamedev/sql-lint.mjs                 # migrations
node tools/gamedev/econ.mjs --check             # city catalog + client⇄worker parity
node tools/gamedev/effects.mjs                  # quiet/threw effects
```
Also `cd colyseus-server && npm test` if the server or its catalogs changed.

## 2. Triage by player impact, not by count
| impact | examples |
|---|---|
| money wrong | direct `Profile.gems` writes on a purchase path, parity mismatch with worker.js, an UPDATE of a balance, a claim without idempotency |
| feature silently dead | effect id with no resolver, status id nobody defined, unit card carrying a spell-only word, table no migration creates |
| crash | ES module touching a bare global, `alert()` in a flow that expects a toast, TDZ at load |
| security | policy without USING, SECURITY DEFINER without search_path, recursion |
| drift | stale engine catalogs (MP disagrees with SP), cardsets vs public/cardsets |

## 3. Reproduce the top items headless
Write a throwaway script in the scratchpad with `loadEngine()`; build the smallest state;
call the function; print before/after. For SQL, read the policy and say who can do what.
A finding without a reproduction or a quoted line is a hypothesis — label it as one.

## 4. Look where the tools cannot
- Async paths: `await` inside loops that mutate `Profile`, missing `try/catch` around
  `Cloud.client.from(...)`, promises never awaited before `saveProfile()`.
- Race conditions between the poll watchers (`_spendNotice`, wallet outbox) and direct writes.
- Iframe bridges: every `window.city*` / `JB_action` handler must survive garbage input.
- Colyseus: client message names vs `BattleRoom.onMessage` names; schema fields vs
  `BattleState.ts`.

## 5. Report
One table: severity, file:line, what the player sees, root cause in one line, fix size.
Then fix only what the user asked for, each via `/fix-bug`, and re-run `check.mjs`.
