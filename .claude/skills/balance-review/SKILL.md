---
name: balance-review
description: Review game balance from the live catalogs — move power curves by cost/element, thin or crowded elements, statuses without sources, and hits-to-kill against real units. Use when asked whether something is over/under-powered, or before adding a batch of content.
---

# Balance review

Everything comes from the live data; do not reason from memory.

```
node tools/gamedev/catalog.mjs moves --stats          # element / kind / cost / range / power distribution
node tools/gamedev/catalog.mjs units --stats          # cost and tribe spread
node tools/gamedev/catalog.mjs moves --json > /tmp/moves.json   # then compute power-per-cost by element
node tools/gamedev/damage.mjs --compare <a>,<b>,<c> --def 10    # like-for-like at one DEF
node tools/gamedev/damage.mjs <move> --vs <unit>       # hits to kill against a real body
```

Look for:
- **Power per cost outliers** within a kind and element (a cost-1 with cost-3 power and
  no self-cost).
- **Rider stacking**: damage + status + displacement on one cheap move.
- **Dead statuses / passives**: defined but never applied by any move, effect, or trap
  (`catalog.mjs statuses` vs `catalog.mjs moves --grep <status>`; grep the resolver for
  `'<passiveId>'`).
- **Thin elements**: `moves --stats` element column; the v119j0 note in `MOVES` shows the
  design intent (fill void/psychic/sound/poison/blood).
- **Type chart traps**: an element with no 2× into anything or no 0.5× from anything
  (`catalog.mjs elements`, then inspect `TYPE_CHART` via a `loadEngine()` script).

Report as a short table: entry, number now, comparable entries, proposed number, why.
Changing numbers is a `/add-move`-style edit followed by `extract-engine-data.mjs` and
`check.mjs`. Do not change economy or Cinder values here — that is `_opEcon()` territory.
