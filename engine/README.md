# `@mythic/engine` — the shared battle engine

This directory is the **single source of truth** for the battle simulation that BOTH
the browser client and the Colyseus server run, so server-authoritative multiplayer
is deterministic with **zero drift** between client and server. Plan + rationale:
`../docs/mp-server-authority-shared-engine.md`.

## What's here

- **`catalogs.gen.js`** — GENERATED, do not edit. The pure data catalogs
  (`STATUS_EFFECTS`, `PASSIVES`, `WEATHERBORN_PASSIVES`, `ELEMENTS`, `STRONG_VS`,
  `TYPE_CHART`, `MOVES`) extracted verbatim from `public/index.html`. Because they're
  generated from the client source, they can never silently diverge from it.

## Regenerating

After editing any catalog in `public/index.html`, run from `game-deploy/`:

```
node tools/extract-engine-data.mjs
```

It re-extracts the named top-level `const`s and rewrites `catalogs.gen.js`. The
extractor is line-anchored (top-level closers sit at column 0), so it's robust to the
nested braces inside the literals.

## Roadmap (see the design doc)

- ✅ **P1a** — pure data catalogs generated + importable (this commit).
- ⏳ **P1b** — pure helpers (`calculateDamage`, `applyDamageTriggers`, `applyStatusEffect`,
  `drawCards`, `hasPassive`, cost helpers) into the shared module; server imports them
  (replacing the hand-written `colyseus-server/src/engine/*.ts`).
- ⏳ **P0/parity** — a harness that runs identical inputs through the client core and
  this shared module and diffs the result, so any drift is caught before it ships.
- ⏳ **P2+** — resolvers (`executeMove`, `_fireTriggers`, `startTurn`, spell resolve)
  with presentation injected as hooks; then the server runs them authoritatively.

The engine is pure + synchronous + data-driven. It must NEVER read `App.*`, the DOM,
or call render/VFX/sound directly — presentation is supplied by the host via injected
hooks (browser = real, server = no-ops). See the hook contract in the design doc.
