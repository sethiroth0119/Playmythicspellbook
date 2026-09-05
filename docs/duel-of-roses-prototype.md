# Duel of Roses — a Duelists-of-the-Roses-style mode on the Mythic combat system

Status: **playable rules prototype**, single-player vs a greedy AI. Lives at `/duel/`
(`public/duel/index.html` + `public/src/duel/`). Touches nothing in `index.html`.

## The pitch, and why it fits

*Yu-Gi-Oh! The Duelists of the Roses* (PS2, 2001) is a card game played as a board
game: a 7×7 grid of terrain, a Deck Leader that stands on the board and is the only
thing you have to kill, monsters summoned face-down beside the leader, one step at
a time across ground that helps or hinders them by type.

Mythic Spellbook is *already* a grid tactics battler: 8×7 board, Chebyshev movement
from SPD, per-move attack range, a 21-element type chart, terrain and location
cards. That is the part DotR players remember, and it is the part we do not have to
build. What DotR adds — and what this prototype layers on top without changing the
combat maths — is:

| DotR idea | Prototype rule | Where |
|---|---|---|
| Terrain with type affinity | Each tile carries one Mythic element. Own element under foot: **Empowered +25%** to ATK/DEF/MAG/RES. Ground whose element `STRONG_VS` yours: **Hindered −25%**. Flyers ignore terrain. | `rules.js` `terrainEffect` / `effectiveStat` |
| Deck Leader on the board | 60 HP, DEF/RES 10, moves 1, cannot attack, always guarded. Kill it to win. | `makeLeader` |
| Face-down summons | Every summon lands face-down in defense, hidden from the opponent. Flip is free on your turn; being attacked flips it. | `summon`, `flip`, `useMove` |
| Attack / defense position | Defense halves incoming damage and forbids attacking. One free stance change per turn. | `setStance`, `resolveAttack` |
| Summon beside the leader | Summon tiles = the 8 around your leader (`SUMMON_RANGE`). One summon per turn, **free**. | `summonTiles` |
| Summoning sickness | A unit cannot move or attack the turn it arrives. | `canAct` |
| Deck-out loss | Must draw and cannot → lose. Hand starts at 5, draws 1/turn, caps at 7. | `startTurn` |

Everything else is the live game: the damage formula `⌊power×ATK÷(DEF×4)⌋+2`, the
type chart (2× / 0.5×, attacker's strength wins ties), STAB 1.5×, 6% crit ×1.5,
pierce, accuracy with SPD penalties, status DoTs and stat mods from `STATUS_EFFECTS`,
the passives the base roster actually uses (swift, tough, thorns, lifesteal,
regeneration, venomous, xenoBond), element status immunities, Infected halving.
Energy is kept as the resource for **moves** only; summoning is free, so the two
systems do not double-tax a turn.

## Data: generated, never copied

`public/src/duel/catalogs.gen.js` is produced by `node tools/extract-duel-data.mjs`
from `public/index.html` (the same line-anchored extraction as
`tools/extract-engine-data.mjs`, plus `UNIT_CARDS`). `npm run duel:check` fails if
it is stale. `public/` is the deploy root, so a browser module cannot import
`engine/catalogs.gen.js`; generating a copy inside `public/src/duel` is the honest
way to stay identical to the live numbers.

## Verifying

```
npm run duel:test        # AI-vs-AI over 40 seeds; invariants + determinism
npm run duel:check       # generated catalogs current with index.html
cd public && npx http-server -p 8765   # then open /duel/?seed=4242
```

The self-test asserts: HP within bounds, no unit in a labyrinth wall, one unit per
tile, hand ≤ 7, energy ≥ 0, card conservation (hand+deck+grave+board = 24), every
duel ends, same seed → same board and decks. A 40-seed run today: 19/21 split,
average 24 turns, ~3 in 40 end by deck-out, ~36% of hits super-effective, ~23% of
hits involve terrain.

URL inputs: `?seed=`, `?deck=goblin,orc,unit:wolf` (Profile deck keys accepted
as-is), `?rival=`, `?first=p1|p2`. The page also accepts a `duel:init` postMessage
with `{seed, deck, rival}` so the main app can iframe it and hand over
`Profile.decks` from the host side — the bridge pattern, never a bare global.

## Deliberately out of scope

Weather, location/spell/trap/wall cards, Kalon transforms, held items, skill trees,
lane attacks, interactive counters, multiplayer. The omitted branches of
`calculateDamage` are listed by name in `resolveAttack` so the port can be widened
rather than rewritten.

## Open questions this prototype is for

1. **Face-down as the core tension.** Hidden identity plus half damage makes
   defense stance strong. The AI flips everything immediately; a human who baits
   attacks into face-down walls may find it too strong. Tunable via
   `RULES.DEFENSE_STANCE_MULT`.
2. **Terrain magnitude.** ±25% is DotR's ±500 in our scale. With 21 elements and
   3–4 terrain blobs per board, most units are unaffected most of the time. Bigger
   blobs or a stronger bonus would make positioning matter more.
3. **Leader 60 HP.** Games end in ~24 turns. DotR games are longer and grindier;
   the live game is faster. Pick a target and tune `RULES.LEADER.hp`.
4. **Unit level.** Units arrive at learnset level 3 (`RULES.UNIT_LEVEL`) so they
   have 2–3 moves. Level 1 leaves half the roster with a single basic strike.
5. **Should summons cost energy?** DotR: no. Mythic: yes. The prototype says no
   and spends energy on moves. Flip `summon()` to charge `card.cost` if it feels
   too swarmy.
6. **Movement metric.** 8-direction Chebyshev, because the live engine is. DotR is
   4-direction. Changing it changes every unit's effective reach.

## Next steps if it is worth pursuing

- Deck: add `decks()` / `resolveCard()` to `window.MythicBridge` and iframe `/duel/`
  from the main app with `duel:init` — the same pattern as battle-board.
- Forge cards: they carry only `atk`/`hp`; decide defaults for def/mag/res/spd
  before letting them in.
- Weather as a third layer (the `weather` argument is threaded but always null).
- Location cards as DotR "field" terrain overrides.
- Server authority: the rules module is pure and seeded, so it already satisfies
  the shared-engine contract in `docs/mp-server-authority-shared-engine.md`.
