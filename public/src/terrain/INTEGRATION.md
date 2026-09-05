# MythicTerrain — wiring it into the live battle

`public/src/terrain/terrain.js` + `terrain.css`. One rule, one global, seven
call sites in `public/index.html`. Every call site is guarded with
`typeof MythicTerrain !== 'undefined'`, so if the script is missing the game
plays exactly as it does today. Nothing here changes a number in the combat
formula: terrain is a flat stat bonus that enters through `getStatBonus`, the
same door auras, status buffs and Tough already use.

Line numbers are from v120w6 and will drift; re-grep the function names.

## The rule

- Every tile carries one element, or none.
- A unit on its **own element** is **Empowered: +25% ATK / DEF / MAG / RES**.
- A unit on ground whose element **beats one of its elements** (per `STRONG_VS`)
  is **Hindered: −25%** to the same four stats. Own element wins if both apply.
- Flyers ignore terrain. Elementless units (heroes) are unaffected.
- **Labyrinth** tiles block movement and placement.
- **Flux:** every 2 turns, 2 tiles change. Patches drift (60% chance a tile
  copies a neighbour), walls open, occasionally a wall appears (8%), never on a
  unit, never on a hero's tile, never on a spawn tile. Every shift is logged.

All knobs live in `MythicTerrain.RULES` and can be overridden at boot with
`MythicTerrain.configure({ rules: { BOOST: 0.3, FLUX_EVERY: 3 } })`.

## Where the data lives

`state.board[y][x].terrain = 'forest'` — a string on the tile the engine
already owns, exactly like `.surface`. That means it serialises with the match,
survives rewind, and rides `broadcastMyState` in multiplayer with no extra
plumbing. Tiles that carry a location marker, trap, event, wall or tombstone are
never painted; those systems own their tiles.

## Call sites

### 1. Load (in `<head>`, before the inline engine script)

```html
<link rel="stylesheet" href="/src/terrain/terrain.css">
<script src="/src/terrain/terrain.js"></script>
```

Classic script, not `type="module"`: the engine calls it synchronously from
`getStatBonus`, and a module would load after the engine has run. Same reason
`/src/battle/combat.js` is an IIFE. Absolute path, because `public/` is the
deploy root.

### 2. Configure — right after `getElementsOf` (~line 37631)

```js
// 🌍 Terrain. STRONG_VS and getElementsOf are top-level consts, invisible to
// the script — hand them over (CLAUDE.md, the globals trap).
if (typeof MythicTerrain !== 'undefined') MythicTerrain.configure({ strongVs: STRONG_VS, getElements: getElementsOf });
```

### 3. Seed — match creation, after `const state = { … }` (~line 97551)

```js
// 🌍 Terrain patches, mirrored top↔bottom. Spawn rows stay open ground.
if (typeof MythicTerrain !== 'undefined') {
  const _spawnTiles = [];
  for (let x = 0; x < BOARD_W; x++) { _spawnTiles.push({ x, y: 0 }, { x, y: BOARD_H - 1 }); }
  MythicTerrain.seed(state, { rng: Math.random, protect: _spawnTiles });
}
```

`protect` is optional; hero tiles are always protected. Pass a seeded rng
(`MythicTerrain.makeRng(seed)`) when both multiplayer clients must build the
same board, or let the host that builds the board be the only one that seeds.

### 4. Stats — inside `getStatBonus` (~line 84220), anywhere before `return bonus`

```js
// 🌍 Terrain: Empowered / Hindered, off the BASE stat so it stacks additively
// with the other flat bonuses instead of compounding on them.
if (typeof MythicTerrain !== 'undefined' && App.state) {
  bonus += MythicTerrain.statBonus(unit, statKey, unit.stats && unit.stats[statKey], App.state);
}
```

That single line puts terrain into `calculateDamage` (both attacker and
defender), the AI's damage probe, and every panel that reads effective stats.

### 5. Movement — `getValidMoves` (~line 83594) and the two other wall checks

```js
// existing
if (board && board[ny] && board[ny][nx] && board[ny][nx].wall) continue;
// add
if (typeof MythicTerrain !== 'undefined' && MythicTerrain.blocks({ board }, nx, ny)) continue;
```

Same one-liner beside the `.wall` checks at ~74887 and ~100283 (pass whatever
board those scopes hold).

### 6. Placement — `getValidPlacementTiles` (~line 83372)

Add `&& !(typeof MythicTerrain !== 'undefined' && MythicTerrain.blocks(state, p.x, p.y))`
to each of the three `cells.filter(...)` returns.

### 7. Flux — `startTurn`, beside the surface tick (~line 101214)

```js
try { if (typeof tickSurfaces === 'function') s = tickSurfaces(s); } catch (e) { … }
// 🌍 Terrain flux — the ground moves every FLUX_EVERY turns.
try {
  if (typeof MythicTerrain !== 'undefined') {
    const _tch = MythicTerrain.tick(s, { rng: Math.random });
    if (_tch.length) App.ui._terrainShift = _tch;   // renderBoard flashes these once
  }
} catch (e) { console.warn('[terrain tick]', e); }
```

`tick` reads `state.turnNumber` for cadence and pushes one `{ msg, color }`
log line per shift, the same shape `tickSurfaces` uses.

### 8. Paint — `renderBoard` (~line 142003)

```js
// where tileClasses is assembled:
if (typeof MythicTerrain !== 'undefined') tileClasses.push(MythicTerrain.cellClass(s, x, y, App.ui._terrainShift).trim());
// where surfHtml is built, prepend the terrain layer so surfaces draw over it:
const terrHtml = (typeof MythicTerrain !== 'undefined') ? MythicTerrain.cellHtml(s, x, y) : '';
html += `<div class="${…}" …>${terrHtml}${surfHtml}${bleedOverlay}${cellInner}</div>`;
// after the loop:
App.ui._terrainShift = null;
```

Optional, in the unit markup (~line 141846): drop
`${typeof MythicTerrain !== 'undefined' ? MythicTerrain.unitBadge(occupant, s) : ''}`
inside the `.unit` div for the ▲ / ▽ badge, and in the unit panel use
`MythicTerrain.describe(unit, App.state).label` for "Empowered +25%".

## What it deliberately does not do

- **AI positioning.** The AI's damage estimates include terrain (they go
  through `getStatBonus`), but it does not seek good ground. Add a term to its
  move scoring later if wanted.
- **Server authority.** In the Colyseus path the server should be the one to
  call `seed` and `tick` with its own rng; the client only paints. The module
  is pure and takes `rng` as an argument for exactly that.
- **Pixi board.** `App.flags.pixiBoard` skips the DOM cell path; the Pixi sync
  would read `state.board[y][x].terrain` and tint tiles itself.

## Verify

```
node tools/terrain-selftest.mjs      # rule maths, seeding guarantees, flux guarantees, determinism
```

Then open `/terrain-demo/` for a visual: a board seeded with the real
`STRONG_VS`, a unit you can move by clicking, and a turn button that runs flux.
