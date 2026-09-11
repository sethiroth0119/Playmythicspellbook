---
name: add-card-effect
description: Add a new on-play card effect (ONPLAY_TYPES id + resolver branch) so it can be authored in the Forge and used by units, spells, traps, and triggers. Use when asked for a new card ability, effect, keyword, or when a cardset JSON references an effect type that does not exist.
---

# Add a card effect

Card effects are data-driven: a card carries `onPlay: { type: '<id>', …fields }`, the Forge
editor offers every id in `ONPLAY_TYPES`, and `_applyOnPlayOneRaw(state, unit, card)` is a
long `if (eff.type === '<id>')` chain — a pure state→state reducer. Triggers, grave
abilities, field abilities and Kalon abilities all funnel into the same chain, so one
branch serves every activation context.

## 1. Check it does not already exist
```
node tools/gamedev/catalog.mjs effects --grep <word>
node tools/gamedev/catalog.mjs effects <id>
```
Many "new" ideas are an existing effect plus `scalePer`, `filter`, `tSide` or `radius`.
Read the header comment of `_applyOnPlayOneRaw` for the generic modifiers before adding
a bespoke type.

## 2. Scaffold the three insertions
```
node tools/gamedev/scaffold.mjs effect <camelId> --needs radius,amount --group "💥 Damage & Removal"
```
It prints: the `ONPLAY_TYPES` row, the group to join, and a resolver branch skeleton with
the anchor lines. `needs` must be field names the Forge editor already renders (the
scaffold lists them); a brand-new field name also needs an input in the editor form —
grep `_onplayTypeOptgroups` and the `needs` handling nearby.

## 3. Write the resolver branch
- Mutate copies, return `state`. Never touch the DOM, VFX or `App.*` except the
  established `App.ui.<picker>` deferred-target pattern (copy `callLock` / `verdict`).
- Fizzle quietly with a log line when there is nothing to act on.
- Respect the guards siblings use: `!u.isHero`, `spellshield`, walls, `alive`.
- Player-facing text goes in `state.log` with a colour the neighbours use.

## 4. Prove it headless
```
node tools/gamedev/effects.mjs <id> --show <id>      # must change state or queue a target — never "quiet", never "threw"
node tools/gamedev/effects.mjs <id> --opts '{"radius":1,"amount":9}'
node tools/gamedev/lint.mjs                          # effects.unhandled / effects.unregistered / effects.ungrouped must be clean for your id
```
If your effect needs board furniture the fixture lacks, extend the fixture in
`window.__mg.testEffect` (grep it) rather than accepting "quiet".

## 5. Make the rest of the game aware
- **Describer** — if card text is auto-generated, add a line in `_afxLineFor` / the
  effect describer so the card face reads correctly.
- **AI** — `_aiEffectValue` decides whether the AI ever plays it. Add a value or the AI
  treats the card as a blank body.
- **Server** — no catalog change → no regen needed. If you touched `STATUS_EFFECTS` for
  a companion status, regenerate.

## 6. Gate + commit
```
node tools/gamedev/check.mjs
```
Commit: `Effects: add <id> — <what the card does for the player>`.
