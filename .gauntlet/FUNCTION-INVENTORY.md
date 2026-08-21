# BATTLEFIELD FUNCTION INVENTORY — every function that existed before the hex/terrain/ruins/CP waves

Built by reading the code, then **executed** in real Chromium against a real match
(`startBattleWithPrep` → `App.state`), not by inspection alone. Method and rigs are at the
bottom. Status legend:

- **WORKS** — executed on the 14×12 hex board and observed to behave correctly.
- **BROKEN** — executed and observed to misbehave, or proven wrong by construction.
- **UNTESTABLE-HERE** — needs a live Supabase session, a second client, or an admin catalog;
  reasoned from the code and labelled as such.

`file:line` are current as of the sweep; re-grep the name before editing.

---

## 0. The metric and the edge (the two single sources of truth)

| Function | Where | Status |
|---|---|---|
| `offsetToCube(x,y)` | index.html:74488 | WORKS |
| `distance(a,b)` — cube distance | index.html:74498 | WORKS — symmetric over all 168×168 pairs, 0 violations |
| `HEX_DIRS_EVEN` / `HEX_DIRS_ODD` / `hexDirs(y)` | index.html:74517-74519 | WORKS |
| `hexNeighbors(x,y)` | index.html:74523 | WORKS — every neighbour is exactly `distance()===1`, and the set of tiles at distance 1 equals the neighbour set for all 168 tiles |
| `inBounds(x,y)` | index.html:74524 | WORKS |
| `inBoundsOf(state,x,y)` | index.html:74541 | WORKS |
| `_boardDims(state)` | index.html:75364 | WORKS — `{W:14,H:12}` matches `state.board` 12×14 |
| `clampUnitsToBoard(state)` | index.html:74564 | WORKS — 0 legal units moved |

## 1. Summon / placement

| Function | Where | Status |
|---|---|---|
| `getCardRange(card)` | index.html:84738 | WORKS |
| `tilesWithinRange(origin,range)` | index.html:84748 | WORKS — the square enumerator provably covers the whole hex disc: brute-forced r=1..5 from all 168 origins, 0 tiles missing |
| `getValidPlacementTiles(card,hero,state)` | index.html:84759 | WORKS — unit range 1 → exactly the 6 hex neighbours; trap range 2 → 18 tiles, none beyond hex 2 |
| `getOccupant` / `getEmptyAdjacent` | index.html:84721 / :84723 | WORKS |
| `placeUnit(card,pos,opts)` | index.html:150472 | WORKS — summoned onto a hex-adjacent tile |
| `placeTrap` | index.html:151188 | WORKS |
| `placeWall` | index.html:151230 | WORKS |
| `placeLocation` | index.html:151006 | WORKS — 166 of 168 tiles highlighted (the two occupied by heroes) |
| `initGame` / `initBoard` / deployment | index.html:98942 / :86321 | WORKS — hero at (6,9), AI hero at (7,2), `DEPLOY_INSET=2`, hex distance 7 (was Chebyshev 6 on 8×7) |

## 2. Movement

| Function | Where | Status |
|---|---|---|
| `getMoveRange` / `_getMoveRangeRaw` | index.html:84908 / :84921 | WORKS |
| `getValidMoves(unit,units,weather,board)` | index.html:84947 | WORKS — spd 3 → 34 tiles, identical to a brute-forced free-hex-disc of radius 3; max distance 3; no dupes; no out-of-bounds |
| `getMovePath(unit,units,weather,target)` | index.html:101732 | WORKS — contiguous 6-way route, length ≤ speed |
| `moveUnit(state,unit,pos)` | index.html:102344 | WORKS — trap trigger + `_ambushReactToMove` fire |
| zone-of-control gating inside `getValidMoves` | index.html:84960-84970 | WORKS — 6 neighbours, destination-but-not-through |
| `onTileClick(x,y)` move branch | index.html:146077 | WORKS — clicked (8,6) from (6,6), unit landed on (8,6) |

## 3. Attack, counter, ranged, AoE

| Function | Where | Status |
|---|---|---|
| `getEffectiveAttackRange(attacker,move)` | index.html:84853 | WORKS |
| `getAvailableMoves(unit)` | index.html:85109 | WORKS |
| `executeMove(...)` primary hit | index.html:99915 | WORKS — melee at hex distance 1 damaged the target through the real click path |
| `findNearestReachableEnemy` | index.html:85150 | WORKS (uses `distance()`) |
| `_squadSightCanSee` | index.html:84898 | WORKS (uses `distance()`) |
| Counter Stance retaliation | index.html:100118 | WORKS — status-driven, no distance term |
| `_ambushReactToMove` (Overwatch / Predator's Eye) | index.html:102043 | WORKS — radius test is `distance(w.pos, toPos)` |
| `move.aoeRadius` splash | index.html:101163-101178 | WORKS — cleave r1 hit the hex neighbour and left a square-diagonal tile at hex distance 2 untouched |
| `move.laneDepth` lane sweep | index.html:101181-101200 | WORKS — `(x, y+k)` is a genuine straight hex ray on odd-r; distance to `(x,y+k)` is exactly `k` |
| Ranged attack | — | UNTESTABLE-HERE with the seeded roster (starter heroes only know `slash`, range 1). Range gating is `distance() <= getEffectiveAttackRange()` in both the highlight (`renderBoard`:143873) and the click gate, so a range-3 move is the same code path with a larger constant. |
| `move.knockback` displacement | index.html:101006-101031 | **BROKEN** — see Breakage 2 |
| `move.pull` displacement | index.html:101036-101062 | **BROKEN** — same defect |
| vortex / shockwave AoE displacement | index.html:93303-93318 | **BROKEN** — same defect, and undisclosed |
| `_slideOnIce(state,cx,cy,dx,dy)` | index.html:75437 | **BROKEN** — inherits the same square direction vector |

## 4. Abilities, passives, fusion, Kalon, consumables

| Function | Where | Status |
|---|---|---|
| `_fieldAbilityOf` / `_canUseFieldAbility` / `_activateFieldAbility` | index.html:89028 | WORKS — present and callable; the hover row renders from them |
| `hasPassive` / `sideHasPassive` / `anyUnitHasPassive` | index.html:41244 / :41256 / :41269 | WORKS |
| `hasAdjacentAllyWithPassive` | index.html:41304 | WORKS (routes through `hexNeighbors`) |
| `_unitIsFusionCost` / `_unitIsFusionReady` / `_unitFusionCastable` | index.html:70796-70810 region | WORKS |
| `_resolveFusionPlacement(x,y)` + `fusionPlace` highlight | index.html:95947 / renderBoard `adjacentTile` :143927 | WORKS — exactly 6 lit tiles, all at hex distance 1 |
| `resolveHeroConsumable(slotIdx,pos,unit)` | index.html:203779 | WORKS by construction — AoE loop is `distance(u.pos, center) > radius` (:203973). Full end-to-end firing UNTESTABLE-HERE (needs an equipped Field Bag). |
| Kalon transform (`executeKalonTransform`) | reached from `_dispatchHoverAction` case `kalon` :71111 | UNTESTABLE-HERE — needs a Kalon-eligible unit from the admin catalog. No geometry in the path. |
| Archon summon (`canActivateArchonSummon`) | `_dispatchHoverAction` case `archon` :71126 | UNTESTABLE-HERE — same reason |

## 5. Traps, walls, tombstones, ruins, looting

| Function | Where | Status |
|---|---|---|
| `placeTrap` + `applyTrapToUnit` | index.html:151188 / :101829 | WORKS — trap laid, enemy stepped on it, damage applied, trap consumed |
| `placeWall` + wall blocking | index.html:151230 | WORKS — wall tile excluded from the hex BFS |
| `tickTombstones` | index.html:75782 | WORKS |
| `tileBlockedByTombstone` | index.html:75882 | WORKS |
| `_unitCanLoot(u)` | index.html:78345 | WORKS |
| `_lootWithUnit(unitId,mode)` | index.html:78102 | WORKS — **calls the real `_lootGridOpen`** (verified by instrumenting the global: 1 call) |
| `openExtractionMenu(unitId)` | index.html:78291 | WORKS |
| `_unitCanLootStructure(u)` | index.html:78972 | WORKS |
| `_lootStructureWithUnit(unitId,mode)` | index.html:78992 | WORKS — **calls the real `_lootGridOpen`** (1 call, ctx `{tombName,unitName,icon,lootTitle}`) |
| `openStructureExtractionMenu` | index.html:79169 | WORKS |
| `_lootGridOpen(got,ctx)` | index.html:77926 | WORKS — one definition, reached from both the tombstone and the ruin path |
| `_rollStructurePlacements` / `_seedBattleStructures` | index.html:78544 / :78639 | WORKS — 5 ruins every seed, height-aware keep-out, mirrored keep-out for the guest |

## 6. Control points (new, but on the inventory because they gate victory)

| Function | Where | Status |
|---|---|---|
| `_cpRollTruckTiles` / `_cpSeedControlPoints` | index.html:78737 / :78797 | WORKS — 3 trucks, never on a ruin tile |
| `_cpHolderOf` | index.html:78819 | WORKS — capture region is the truck tile + its 6 hexes; a unit at hex distance 2 does not capture |
| `_cpHeldCount` | index.html:78836 | WORKS |
| `_cpTickControlPoints(state,who)` | index.html:78857 | WORKS — score +1/truck/turn, streak advances, streak resets when a truck is lost |
| `_cpEvalVictory(state)` | index.html:78956 | WORKS — returns the winner side name (the `gameOver` convention), consumed at :136253 |
| `_cpObjectiveBanner` / `_cpTracker` | index.html:143243 / :143255 | WORKS — both in the rail |

## 7. Surfaces and status effects

| Function | Where | Status |
|---|---|---|
| `_setSurface` | index.html:75373 | WORKS |
| `_paintSurface(state,cx,cy,type,r,turns)` | index.html:75386 | WORKS — r=1 paints exactly the 7-tile hex disc, nothing outside |
| `_floodCollectSurface` | index.html:75415 | WORKS — 6-connected |
| `_floodConvertSurface` | index.html:75430 | WORKS |
| `tickSurfaces(state)` | index.html:75454 | WORKS — fire spread ran on the 14×12 board with no throw |
| `_seedBattleSurfaces` | index.html:75613 | WORKS |
| `applyStatusEffect` / `isImmuneToStatus` | index.html:99105 / :99043 | WORKS — no geometry |
| `_slideOnIce` | index.html:75437 | **BROKEN** — see Breakage 2 |

## 8. UI — board, hover menu, details, hand, rail, end turn

| Function | Where | Status |
|---|---|---|
| `renderBoard()` | index.html:143831 | WORKS — 168 tiles, `grid-column: 2x+1+(y&1) / span 2`, `grid-row: y+1`, 29×12 tracks, 3-colouring via `(cube.x-cube.z) mod 3` |
| `renderBattle()` / `_renderBattleImmediate()` | index.html:135988 / :136010 | WORKS |
| `renderUnitModal()` | index.html:142346 | WORKS — 10.9 KB of modal, `.unit-modal` lands in the DOM |
| `renderHandStrip()` | index.html:144851 | WORKS |
| side rail `.bc-rail` | index.html:136400 region | WORKS — children: `tw-objective-banner`, `cp-track panel`, `bc-fieldcond`, `bcp`, `bc-wrap-action` |
| end-turn button | index.html:5671 CSS / rail | WORKS |
| `_hoverButtonsFor(u,s)` | index.html:70743 | WORKS — hero → `attack,move,details`; enemy → `details`; spent unit → `details`; on a ruin → `attack,move,lootStruct,details` |
| `_dispatchHoverAction(act,unitId)` | index.html:71093 | WORKS for `details`/`move`/`attack`/`loot`/`lootStruct` |
| `onUnitClick(unitId)` | index.html:145960 | WORKS |
| `getSwapTargets(unit,units)` | index.html:146059 | WORKS |
| DOM tile click delegation | index.html:145644 | WORKS — reads `dataset.x/y`, exact by construction |
| `startTurn` / `endPlayerTurn` / `endAITurn` | index.html:102573 / :103295 / :103309 | WORKS |
| `checkPostAction()` | index.html:151736 | WORKS |
| `_twTickGameMode` / `_twEvalObjectives` | index.html:216350 / :216058 | WORKS — both run, no throw |

## 9. AI

| Function | Where | Status |
|---|---|---|
| `scheduleAIStep` / `doAIStep` / `finishAIPhase` | index.html:152310 / :152985 / :152359 | WORKS — a full AI turn ran end to end: three AI units moved legally (7,2)→(7,3), (6,4)→(5,5), (7,4)→(4,5), all in bounds, turn handed back to the player, `turnNumber` 1→2 |
| AI target scoring / pathing | inside `doAIStep` | WORKS — no `BOARD_W`/`BOARD_H` literal, no `dx=-1..1` loop, no inline metric anywhere in :152985-155200 |
| convoy greedy step (`_twTickGameMode`) | index.html:216380-216398 | WORKS — rewritten to order the real 6 neighbours by `distance()` |
| minefield band | index.html:216646-216658 | WORKS — deliberately square, disclosed in place, board-array lookup is the bounds test |

## 10. Replays

| Function | Where | Status |
|---|---|---|
| `cloneStateLight(state)` | index.html:71718 | **BROKEN** — see Breakage 1 |
| `recordReplaySnapshot` | index.html:71751 | WORKS (records what `cloneStateLight` gives it) |
| `commitReplayToProfile` | index.html:71774 | WORKS |
| `rebuildReplayState(rep,index)` | index.html:71831 | WORKS |
| `openReplayViewer` / `renderReplayViewer` | index.html:71808 / :168874 | WORKS — renders without throwing, but on a battlefield stripped of ruins, trucks and terrain seed |

## 11. Multiplayer

| Function | Where | Status |
|---|---|---|
| `_mirrorPos(p)` | index.html:181968 | WORKS — hex-distance preserving over a sampled sweep of the board (0 violations); valid only while `BOARD_H` is even, which is documented at the site |
| `_mirrorAllPositions(state)` | index.html:181976 | WORKS — involution over units; `structures` and `controlPoints` both mirrored |
| `_serializeBattleStateForBroadcast(state)` | index.html:182194 | WORKS — deny-list, so `structures`, `controlPoints`, `cpScore`, `cpStreak`, `tombstones`, `_bbMapSeed` all survive; 17.5 KB snapshot |
| `_onRemoteStateArrived`, Colyseus relays | index.html:45775 region | UNTESTABLE-HERE — needs two live clients. Reasoned: the coordinate surface is `_mirrorAllPositions` + `_serializeBattleStateForBroadcast`, both exercised above. |

## 12. The canvas stage (`public/battle-board/index.html`) and the bridge

| Function | Where | Status |
|---|---|---|
| `gw(gx,gz,y)` | battle-board:553 | WORKS — HEXW/SIZE = √3, HEXV/SIZE = 1.5000, odd-row shift 0.5000 |
| `hexCorners` / `tilePoly` | battle-board:563 / :1423 | WORKS — 6 vertices |
| `worldToTile` / `pickTile` | battle-board:5282 / :5325 | WORKS — plane-sweep over the elevation rungs; `project(gw(x,z,tileElev(x,z))) → pickTile` is exact for **all 168 tiles**, elevation included |
| `window.__bbHexCheck()` | battle-board:5537 | WORKS — `ok:true`, 4368 centre samples, 2856 slab samples, 0 fails, 0 dead centres |
| `tileAt` / `rebuildTileIndex` | battle-board:678 / :652 | WORKS — now a `Map` lookup, not the O(n) scan the CONTRACT flagged |
| `tileElev` / `tileElevRungs` / `tileBlocked` | battle-board:682 / :677 / :683 | WORKS |
| `drawStruct` (ruins) / `drawTruck` (control points) / `drawTomb` / `drawUnit` | battle-board:3887 / :4376 / :3796 / :4589 | WORKS — STRUCTS 5, CPS 3, TOMBS 0, units 2 on the stage |
| `handleHostMessage` (`board:pointer` → `pickTile` → `board:tileClick`) | battle-board:5797 / :5879 | WORKS |
| host `board:tileClick` → `onTileClick(d.x, d.z)` | index.html:106261 | WORKS — real Playwright clicks on 168 projected tile centres resolved to the right tile everywhere the centre was on-canvas |
| `_bbStageCatcher` / `_bbSyncCatcher` | index.html:106485 / :106467 | WORKS |
| `_bbMapSeed` | index.html:104733 | WORKS in a live match; **its replay contract is broken by `cloneStateLight`** — see Breakage 1 |
| `_bbGenTerrain` / `_bbMapFromEditor` | index.html:104808 / :105269 | WORKS — 168 tiles with `surf` + `elev`, 4 elevation rungs live |
| `_bbStagePayload` | index.html:105914 | WORKS — cols 14, rows 12, 168 tiles, elev + surf present, none out of range |
| `_bbStageUnitList` / `_bbStagePushPaint` / `_bbStagePushTombs` / `_bbStagePushStructs` / `_bbStagePushCPs` / `_bbStagePushSurfaces` | index.html:105943 / :105966 / :105979 / :106004 / :106030 / :106147 | WORKS |
| camera framing at the shipped host rect | battle-board `fitAim` :841 / `fitCamera` :872 / `applyFit` :906 | **BROKEN** — see Breakage 3 |

## 13. Board-adjacent DOM/CSS that had fixed dimensions

| Thing | Where | Status |
|---|---|---|
| `.board` grid tracks | index.html:11352 / renderBoard :143971 | WORKS — 29 × 12, written from `BOARD_W`/`BOARD_H` on every render |
| `.unit[data-y]` depth ladder | index.html:13595-13606 | WORKS — extended to row 11 |
| event-marker lift ladder | index.html:8400-8411 | WORKS — extended to row 11 |
| `src/battle/targeting.js` `cols()` / `rows()` / `domPos()` | targeting.js:340 / :379 / :364 | WORKS — half-column-aware, reads `BOARD_W`/`BOARD_H` first |
| `src/battle/alive.css` back-row wash | alive.css:60-91 | WORKS — rows 0-2 only, intentional |
| `.tile` aspect | index.html:11940 | Cosmetic nit — see Nit 2 |

---

## Method

* Rig: `scratchpad/gdrive2.mjs` — serves `public/`, loads the **real** `public/index.html` in
  Playwright Chromium, drives `startBattleWithPrep(true)` with `STARTER_HEROES[0..1]`, then
  evaluates a probe in the main frame and a second probe inside the live stage iframe.
  The game's top-level `const`s (`distance`, `BOARD_W`, `App`, …) resolve as global lexical
  bindings from `page.evaluate`, so every test below calls the shipping function, not a copy.
* Rig: `scratchpad/clicktest.mjs` — issues **real Playwright mouse clicks** at the projected
  screen position of each of the 168 tiles and records what `onTileClick`/`onUnitClick` received.
* `renderBattle()` is rAF-batched; probes call `_renderBattleImmediate()` to force a DOM landing.
  `renderBattle` has a crash guard that keeps the last good board — a probe that skips the
  immediate render can read a stale DOM and score a false pass. Two early results in this sweep
  did exactly that and were re-run.

## What could not be executed here, and why

* **Ranged / high-range attack moves** — the seeded roster only carries `slash`. Same code path.
* **Consumables end to end** — needs an equipped Field Bag from the profile.
* **Kalon transform, Archon summon, Polycreation resolution** — need catalog cards
  (`[AI] No admin AI decks and no custom cards` in this environment).
* **Multiplayer** — needs two clients and a live Supabase/Colyseus session.
* **Supabase-backed loot persistence** — the loot grid opens; the write does not run offline.

---

# BREAKAGES

## Breakage 1 — `cloneStateLight` is an allow-list, and the new battlefield is not on it

`public/index.html:71718`

```js
const slim = {
  board: state.board, units: state.units, weather: …, turn: …, turnNumber: …,
  timeOfDay: …, gameOver: …, mods: …, comboHits: …, log: …, player: …, ai: …,
};
```

Executed: `cloneStateLight(App.state)` in a live match drops
`structures`, `controlPoints`, `cpScore`, `cpStreak`, `tombstones`, `_bbMapSeed`,
`heroUltimates`, `heroEmotions`.

Then `rebuildReplayState` → `_renderBattleImmediate()` on the rebuilt state, measured:

| | live match | replay |
|---|---|---|
| `.ruin-marker` on the board | 5 | **0** |
| `.cp-marker` on the board | 3 | **0** |
| `.cp-track` in the rail | present | **absent** |
| `.tw-objective-banner` | present | **absent** |
| `_bbMapSeed()` | 4070270336 | **817283149** (a different number every time) |

No throw anywhere — every consumer is guarded, so the replay renders a *plausible* board that
is simply not the board the match was fought on. The terrain seed is the sharpest case: the
comment at `_bbMapSeed` (`index.html:104744-104748`) states the seed is stamped on the state
*specifically* so "a replay re-renders from the recorded state" and does not get "a different
battlefield from the match it claims to be replaying". The allow-list defeats that contract.

`tombstones` was already missing before these waves (pre-existing); the other six are new state
that the waves added and the replay path was never extended to carry.

**Smallest fix** — add the keys to the slim object at `index.html:71718`:

```js
    // 🏚🚚 The lootable ruins, the SCP trucks and their score/streak are board
    // STATE, not derived — a replay without them renders a different match.
    structures: state.structures,
    controlPoints: state.controlPoints,
    cpScore: state.cpScore,
    cpStreak: state.cpStreak,
    tombstones: state.tombstones,
    // The terrain seed. _bbMapSeed() re-rolls when it is absent, which is
    // exactly the "different battlefield" its own header warns about.
    _bbMapSeed: state._bbMapSeed,
```

(`heroUltimates` / `heroEmotions` are cosmetic in the viewer; add them in the same edit or
state that they are deliberately out.)

## Breakage 2 — displacement steps along one of EIGHT square directions on a six-direction lattice

`public/index.html:101011` (knockback), `:101041` (pull), `:93303-93304` (vortex / shockwave
AoE inside `_applyOnPlayOneRaw`), and `:75437` `_slideOnIce`, which is handed the same vector
by all three.

```js
const dx = Math.sign(tx - ax), dy = Math.sign(ty - ay);
…
const nx = cx + dx, ny = cy + dy;      // stepped `move.knockback` times
```

On odd-r, `(±1, ∓1)` and `(±1, ±1)` are hex neighbours from **one** row parity and are at hex
**distance 2** from the other. Executed with the real `executeMove` and a `knockback: 1` move:

| attacker | target | landed on | hexes moved |
|---|---|---|---|
| (6,7) | (7,6) | (8,5) | **2** |
| (6,5) | (7,6) | (8,7) | **2** |
| (5,7) | (6,6) | (7,5) | **2** |

And it steps **over** occupied ground: with an enemy standing on (7,5) — the genuine hex
neighbour of (7,6) in the away direction — the shoved unit still landed on (8,5). The
`getOccupant` guard only tests the square-diagonal destination, so the body in between is
invisible to it. A `knockback: 2` move therefore travels up to 4 hexes and can pass through
two occupied tiles.

Half of this is disclosed: the comment at `index.html:100995-101005` names it precisely and
says the fix "needs the combat owner". **The vortex/shockwave copy at `:93303` carries no such
note** and was not covered by that disclosure.

**Smallest fix** — one helper beside `hexDirs`, then three call sites:

```js
// The hex step that best matches an arbitrary away/toward vector. Re-picked at
// every step because the six offsets change with row parity (HEXSPEC §5) —
// reusing one (dx,dy) is what makes a 1-tile shove travel 2 hexes.
const hexStepToward = (from, aim) => {
  let best = null, bestD = Infinity;
  for (const d of hexDirs(from.y)) {
    const c = { x: from.x + d[0], y: from.y + d[1] };
    const dd = distance(c, aim);
    if (dd < bestD) { bestD = dd; best = c; }
  }
  return best;
};
```

At `:101011` / `:101041` / `:93303` replace the fixed `(dx,dy)` walk with a per-step
`hexStepToward(current, awayPoint)` (for knockback, `awayPoint` is the target reflected through
the attacker; for pull it is the attacker). `_slideOnIce` takes the same treatment: pass it the
aim point rather than a `(dx,dy)` pair. Rules-visible change, so it belongs to the combat owner
— but it is a break, not a tradeoff, and the `:93303` copy is not disclosed anywhere.

## Breakage 3 — two of the 168 tiles project off the canvas and cannot be clicked

The camera is still the fixed `CONFIG.camera` (`battle-board:209`, never mutated at runtime),
and the board is now 14 columns wide with up to 1.02–1.36 world units of terrain relief.
Measured inside the live stage, at three different viewports:

| viewport | `.board-area` / canvas | tile centres outside the canvas | board screen bbox X |
|---|---|---|---|
| 1366×768 | 712×560 | **(0,10)** @ x=−6, **(13,11)** @ x=717 | −37 … 750 of 0…712 |
| 1600×900 | 802×688 | **(0,10)** @ x=−6, **(13,11)** @ x=807 | −41 … 844 of 0…802 |
| 1920×1080 | 1111×868 | **(0,10)** @ x=−9, **(13,11)** @ x=1120 | −58 … 1172 of 0…1111 |

Six tiles are edge-clipped at every size: (0,8) (0,9) (13,9) (0,10) (0,11) (13,11).
`applyFit` fits the **vertical** FOV to the safe box; horizontal FOV falls out of the host's
aspect (CONTRACT §1.6), and at every host aspect the game actually produces, the board is about
5 % wider than the frame.

Confirmed by real mouse clicks, not only by geometry: in a sweep of all 168 projected tile
centres, the click at (0,10) landed on `DIV.battle-grid` (page background left of the stage) and
the click at (13,11) landed on `DIV.battle-grid` to its right. Neither produced a
`board:tileClick`, so neither `onTileClick` nor `onUnitClick` ever fired. `.bb-catch` is sized to
the stage host, so there is no fallback: the DOM board underneath is covered for the rest of the
rect and absent outside it.

Those two tiles are fully legal game tiles — `inBounds(0,10)` and `inBounds(13,11)` are both
true, and `getValidMoves` for a unit at (1,10) **offers (0,10) as a destination**. So the rules
will send a unit somewhere the player cannot see or click it back off. (Ruins and trucks are
mostly safe: 0 landings on either tile across 250 seeds, because `_rollStructurePlacements`
prefers non-edge tiles — but that is a preference, dropped from attempt 2 on, not a guarantee.)

Everything else about picking is correct: `project(gw(x,z,tileElev(x,z))) → pickTile` is exact
for **all 168** tiles, `__bbHexCheck()` returns `ok:true` with 0 fails over 4368 centre samples
and 2856 slab samples. This is purely framing.

**Smallest fix** — `fitAim` (`battle-board:841`) already walks the left and right columns and
already measures `lo`/`hi` in screen px. It uses them only to CENTRE the lattice
(`off = (hi + lo)/2`) and never asks whether `hi - lo` fits. It also samples `gw(gx, gz, 0)` —
**flat** — so it cannot see that terrain relief pushes the near corners further out, and it
samples tile CENTRES rather than hex corners, so it is short by half a hex on each side even on
the flat.

Three lines inside the existing loop:

```js
        const q = project(gw(gx, gz, tileElev(gx, gz)));   // was: …, 0)
```

then after the centring branch, before `dist = fitDistance(pitch, tx)`:

```js
    /* CENTRING IS NOT FITTING. lo/hi were only ever used to slide the lattice
       to the middle of the frame; nothing asked whether it FITS in it. At 14
       columns plus terrain relief it does not — (0,10) and (13,11) project
       outside the canvas at every host aspect the game produces, and a tile
       you cannot click is a tile the rules still let you walk onto. */
    const halfW = Math.max(hi, -lo) + hexW() * 0.5 * VIEW.scale / dist;
    if (halfW > VIEW.box.w / 2) { dist *= halfW / (VIEW.box.w / 2); continue; }
```

`VIEW.scale` is derived from the vertical FOV only (`battle-board:489`), so the horizontal
answer has to be a dolly, not a scale change. No protocol change, no host change; ~5 % further
back at 1600×900.

---

# NITS (not breakages, recorded so they are not re-derived)

1. **Stale comment**, `index.html:101150`: *"N=1 means the 8 surrounding tiles, N=2 expands to
   24"*. The code beneath it is `distance(u.pos, attacker.pos) <= r`, which is 6 and 18. Doc rot
   only, but it is exactly the sentence a future reader would re-implement from.
2. **DOM board hex proportion**, `index.html:11940` + the `.board` sizing block. Measured tile
   box 53.3 × 49.0 px, ratio 1.0886, against the ideal HEXW/HEXV of √3/1.5 = 1.1547 — a ~6 %
   vertical stretch, because `aspect-ratio: var(--board-aspect)` computes to `auto` at the
   sizes the game actually lays out. The DOM board is the hidden fallback layer (the canvas
   stage covers it) and clicks there go through `data-x`/`data-y`, so nothing about the rules is
   affected; the hexes just read slightly tall if the stage is ever off.
3. **Pre-existing, unrelated to these waves**: `onTileClick`'s sacrifice-targeting branch at
   `index.html:146180` reads `occupantHere`, which is only declared inside the two earlier
   blocks (`:146109`, `:146130`). Taking that branch throws `ReferenceError: occupantHere is not
   defined`. Introduced in `66a504f` (2026-08-11), well before the battlefield work — flagged
   here only so it is not mistaken for wave damage. Fix is one line: re-declare it above the
   branch.
4. **Mixed sources of truth in the MP mirror**: `_mirrorAllPositions` mirrors `board` from
   *derived* W/H (`:182000-182002`) but `tombstones` / `structures` / `controlPoints` /
   `smokeClouds` from the *constants* `BOARD_W`/`BOARD_H` (`:182018`, `:182025`, `:182033`,
   `:182037`). They agree at 14×12 and nothing is wrong today; it is the same split
   `clampUnitsToBoard` was already burned by once (see its header at `:74553`).
