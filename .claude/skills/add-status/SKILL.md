---
name: add-status
description: Add or fix a status effect (STATUS_EFFECTS) — DoT, stat modifier, skip-turn, or a new mechanic — and wire it to a source. Use when a move, effect or card needs a condition that does not exist yet, or when lint reports a status id nobody defined.
---

# Add a status

`const STATUS_EFFECTS = {` is read generically by the turn-start tick (DoT, `skipTurn`),
`getStatBonus`/`calculateDamage` (`atkMod`/`defMod`/…/`accMod`), and dedicated checks
(`dodgeChance`, `forceMiss`, `koOnExpire`, …). A status made of existing fields needs no
engine change.

## Steps
1. **Vocabulary:** `node tools/gamedev/catalog.mjs statuses --schema` — field frequencies
   tell you which mechanics are well-trodden (12 statuses use `defMod`) and which are
   one-offs (`statMult`, `koOnExpire`). Prefer well-trodden fields.
2. **Scaffold:** `node tools/gamedev/scaffold.mjs status <id> --stat def --mod -3`
   (or omit `--stat` for a DoT skeleton). Paste into `STATUS_EFFECTS`, comment the WHY.
3. **New mechanic?** If no field expresses it, add the field and read it exactly where the
   nearest sibling is read (`grep -n "skipChance" public/index.html` shows the pattern).
   Keep the read inside `startTurn`'s tick or the damage path — nowhere else.
4. **Immunities:** `isImmuneToStatus` — faction/element immunities live there.
5. **Source:** wire it to a `MOVES.applyStatus`, an on-play `status` field, or a trap.
   A status with no source is dead data; lint will not flag it but players never see it.
6. **Server + gate:** `node tools/extract-engine-data.mjs && node tools/gamedev/check.mjs`.

## Known gap (as of 2026-09-11)
`MOVES.sunder` applies `armorBreak`, which is undefined — the move has never halved DEF.
Its desc promises "halves the target's DEF for 2 turns"; the honest implementation is a
`defMod` roughly half a typical mid-game DEF (see `catalog.mjs units --stats`) or a
`statMult: { def: 0.5 }` if you first confirm `statMult` is read on the DEF path.
