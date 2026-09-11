---
name: add-move
description: Add a new attack / ability / movement move to the MOVES catalog in public/index.html, wire it to units, verify its numbers, and regenerate the server catalogs. Use when asked for a new move, attack, spell-like ability, or a new "move type" (a new mechanical field moves can carry).
---

# Add a move

A move is a data entry in `const MOVES = {` in `public/index.html`. Its fields are read by
`calculateDamage`, `executeMove` and the status/aoe/pull/knockback sub-resolvers. Most new
moves need **no code** — only a well-chosen combination of existing fields.

## 1. Learn the vocabulary first
```
node tools/gamedev/catalog.mjs moves --schema        # every field, how common, an example
node tools/gamedev/catalog.mjs moves --stats         # element / kind / cost distribution (find the thin spots)
node tools/gamedev/catalog.mjs moves --grep <word>   # siblings to copy from
```
A field that appears in ≥1 existing move is implemented. If the move you want needs a
field that does NOT exist yet, that is a **new move type** — see §5.

## 2. Scaffold
```
node tools/gamedev/scaffold.mjs move <camelId> --element fire --kind attack --type magic --power 30 [--status burn]
```
Paste the printed line inside `MOVES`, grouped with its element's siblings. Write the
comment: which unit/card wanted it and what gap in the catalogue it fills.

## 3. Reach it
A move nobody learns is dead data. Either add `{ lvl: N, m: '<id>' }` to a `learnset` in
`UNIT_CARDS` / `STARTER_HEROES`, or confirm it is Forge-pickable (the Forge lists `MOVES`).

## 4. Numbers
```
node tools/gamedev/damage.mjs <id>                    # element × DEF matrix
node tools/gamedev/damage.mjs <id> --vs troll         # hits-to-kill against a real body
node tools/gamedev/damage.mjs --compare <id>,<sibling1>,<sibling2> --def 10
```
Rule of thumb from the catalogue: cost-1 attacks sit around power 24-36, cost-2 around
36-50, cost-3 up to 64 with a self-cost. A rider (status, pull, aoe) is worth ~8 power.

## 5. A NEW move type (a field the resolver does not know yet)
1. Name it like the existing riders (`pull`, `knockback`, `selfDamagePct`, `scaleByTargetCost`).
2. Find where the closest sibling field is read: `grep -n "move\.pull\|mv\.pull" public/index.html`.
   Add your branch beside it, in `executeMove` (post-damage riders) or `calculateDamage`
   (damage modifiers). Pure logic only; VFX goes through the existing hook calls.
3. Add the field to at least one move so the lint and the AI see a real example.
4. Document the field in the comment block above `const MOVES`.

## 6. Server + gate
```
node tools/extract-engine-data.mjs        # MOVES ships to Colyseus
node tools/gamedev/check.mjs
```
Commit message: `Moves: add <Name> (<element> <kind>, power N) — <one line of why>`.
