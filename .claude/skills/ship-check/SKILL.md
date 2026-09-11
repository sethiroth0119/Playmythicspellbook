---
name: ship-check
description: Run the full pre-commit / pre-deploy verification gate for Mythic Spellbook and bump the deploy version knobs consistently. Use before committing game-logic or data changes, and before any deploy.
---

# Ship check

```
node tools/gamedev/check.mjs            # full gate
node tools/gamedev/check.mjs --quick    # syntax + runtime + freshness + lint only
node tools/gamedev/check.mjs --fix      # regenerate engine catalogs first, then gate
node tools/gamedev/check.mjs --verbose  # print every step's output
```

Steps and what a failure means:
1. **syntax** (`_synckcheck.mjs`) — an inline `<script>` no longer parses. Fix the code.
2. **runtime** (`_harness.js`) — the script throws at top level (usually a `const` used
   before its declaration — the blank-screen bug). Reorder, do not wrap in try/catch.
3. **engine** (`extract-engine-data.mjs --check`) — server catalogs are stale. Run the
   extractor and commit the three generated files.
4. **lint** — a dangling id, a registered effect with no resolver branch, a cardset that
   drifted from `public/cardsets/`. Fix the data, not the rule.
5. **effects** — an on-play effect threw, or a new/regressed one is quiet. Both are yours.
6. **damage golden** — the client formula changed. Deliberate? Update both goldens
   (client `damage.mjs --golden` and `colyseus-server/test/damage-golden.mjs`) in the same
   commit and say so. Accidental? Revert.
7. **versions** — `public/version.txt`, `window.BUILD_VERSION`, and `sw.js` `CACHE_VERSION`
   disagree. Bump all three together (CLAUDE.md); the update check breaks otherwise.

Never weaken a step to go green. If a step is wrong, fix the step and say so in the
commit message.

## Deploying (only when asked)
Pushes to `main` auto-deploy via GitHub Actions. Verify the EDGE with
`curl -s https://<host>/version.txt` and poll — PoP propagation takes up to two minutes.
Never trust the deploy log alone.
