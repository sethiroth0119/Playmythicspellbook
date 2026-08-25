# FINAL REGRESSION GATE — battlefield function inventory

**Verdict: 102 PASS · 0 FAIL · 17 UNVERIFIED.**
*(wave 8 sign-off. The gate's own tally was 90 PASS · 1 FAIL · 17 UNVERIFIED — its header
said 91, which was an off-by-one; counted by table row, it was 90. The sign-off flipped
the FAIL to PASS and added 11 rows for what this wave introduced and re-measured.)*

**Does every battlefield function that worked before still work? — YES.**

The one FAIL this gate recorded (click precision on the canvas stage) is **CLOSED**, and
the one substantive gap the wave-7 walk fix left open — a move that arrives with **no
telegraph**, i.e. every multiplayer receive and every replay step — is **CLOSED**. Both
were re-measured from scratch by the sign-off, not read off the patch:

* **The FAIL.** 24 random match seeds at the neutral fit, 1600×900 (host 802×688):
  `deadCentres 0` on **24 of 24** (was 1–6 on 24 of 24), `buriedFails 0`,
  `offFrameFails 0`, `nullOverDrawn 0`, `slabFails 0`, `centreFails 0`, `jitterFails 0`,
  `click.hard 0`, `painter.inversions 0` — `__bbHexCheck().ok === true` on all 24.
  Confirmed with **real Playwright mouse clicks on all 168 projected tile centres**:
  **168/168 correct** on six seeds, and 168/168 again after `R` restores the pose.
* **The route.** The walked route now travels with the move as `unit.walkPath`, so the
  two routeless arrival shapes walk the real bent route: MP receive **10 legs / 1.35 s**,
  replay stepper **10 legs / 1.35 s**, both identical to `getMovePath`. Strip the route
  from the same push and the old bug returns (1 leg / 0.34 s straight through a wall of
  bodies) — the teeth are real.

**What is left, stated plainly and not counted as the FAIL.** The FREE CAMERA away from
the neutral fit can still stand terrain in front of a tile's anchor. Real mouse clicks,
default seed: neutral 0 wrong · yaw 45 0 wrong · yaw 180 0 wrong · yaw 45 + pan(1.8,1.4)
3 wrong · yaw 90 14 wrong · yaw 137 + pan 12 wrong · yaw 270 + pan 14 wrong; and a pan can
push up to 10 tile centres off the canvas, where a click answers nothing at all. In every
one of those poses `click.hard === 0` — the pick returns the tile the renderer actually
painted, so the picture and the pick still agree — and `R` restores the neutral pose
exactly (measured: yaw 0 / pan (0,0), then 168/168 again). That is the disclosed BAR R1 vs
BAR R2 trade in `battle-board/index.html:7568-7845`, not the failure this gate recorded,
which was about every match seed at the shipped framing.

Everything below was **executed** in real Chromium against a real match
(`startBattleWithPrep` → `App.state`), with real Playwright mouse clicks where a click
is the thing under test. Static-only checks are labelled UNVERIFIED, never PASS.
Rigs and method at the bottom. `file:line` are current at the time of the sweep — re-grep
the name before editing.

Legend — **PASS**: executed on the 14×12 hex board and observed correct ·
**FAIL**: executed and observed wrong · **UNVERIFIED**: could not be exercised in this
environment (no Supabase, no second client, no admin catalog, starter roster only).

Gate ran against the working tree at `47fbbe5` **plus an uncommitted change to
`public/battle-board/index.html`** (105 insertions — occlusion clip / audit work by
another builder). Everything measured here includes that change.

⏭ **SIGN-OFF PASS (wave 8)** re-ran against the working tree at `503db38` plus the
uncommitted comment-only edit to `public/battle-board/index.html`. Rows re-measured this
pass are marked **PASS ✓w8**; the rest are the gate's own results and were not re-run —
this pass was deliberately narrow (the FAIL, the route, the three OPEN-BREAKS, picking,
painter order, the harness scenes and the deploy knobs), not a second full 109-item sweep.
`node _synckcheck.mjs` → ALL CLEAN. `node _harness.js public/index.html` → ALL CHECKS
PASSED. Capture: `.gauntlet/SIGNOFF.png` (`scene=gamemap`, 1600×900, host 802×688) —
1.55% of pixels differ from `GATE-final.png`, all of it rain and brazier animation.

---

## Deploy knobs — IN SYNC

| knob | value |
|---|---|
| `public/version.txt` | `v120x3` |
| `window.BUILD_VERSION` (`index.html:36771`) | `v120x3` |
| `public/sw.js` `CACHE_VERSION` (`sw.js:414`) | `mythic-v120x3-sprites-ui` |

`node _synckcheck.mjs` → ALL CLEAN. `node _harness.js public/index.html` → ALL CHECKS PASSED.

⚠ **The three knobs AGREE WITH EACH OTHER, but they are STALE against the code.**
`public/version.txt` was last bumped at `e085032` (wave 5). Waves 6, 7 and 8 all shipped
real changes to `public/index.html` and `public/battle-board/index.html` under the same
`v120x3`. Nothing is out of sync *between* the three, so the check passes as written — but
deploying this tree as-is means the update check never fires and every existing client
keeps the wave-5 bundle out of its service-worker cache. **The three must be bumped
together before this ships** (`public/version.txt`, `window.BUILD_VERSION` at
`index.html:36771`, `CACHE_VERSION` at `sw.js:414`), and the EDGE verified with curl.

---

## §0 — Metric and lattice (the single sources of truth)

| Function | Where | Status | Evidence |
|---|---|---|---|
| `distance(a,b)` cube distance | index.html:74498 | **PASS** | 0 asymmetries over all 28,224 ordered tile pairs |
| `hexNeighbors(x,y)` | index.html:74523 | **PASS** | 1008 neighbours returned (168×6), every one at `distance()===1`. The 48 tiles whose *in-bounds* distance-1 set is smaller are exactly the 48 perimeter tiles (2·14+2·12−4) — the function returns all six unfiltered and callers bound-check |
| `hexDirs` / `hexStep` / `hexDirToward` | :74658, :74687 | **PASS** | 4,730 attacker/target pairs at hex distance ≤3: every away-step lands **exactly 1 hex** away. 0 violations |
| `offsetToCube` → 3-colouring | :74488, renderBoard | **PASS** | 168 DOM tiles, **0** neighbour pairs sharing a tone |
| `inBounds` / `inBoundsOf` / `_boardDims` | :74524, :74541, :75364 | **PASS** | `BOARD_W=14 BOARD_H=12`, `state.board` is 12 rows × 14 cols |
| `tilesWithinRange(origin,r)` | :84748 | **PASS** | r=2 → 18 in-bounds tiles, all at hex distance ≤2 |

## §1 — Placement and summon

| Function | Where | Status | Evidence |
|---|---|---|---|
| `getValidPlacementTiles` | :84759 | **PASS** | unit card → exactly the 6 hex neighbours, max hex distance 1 |
| `placeUnit` (summon from hand) | :150472 | **PASS** | played "Stone Golem" from the real hand onto (6,8); roster 2 → 3 |
| Summon ceremony bridge | :106933-106937 | **PASS** | the push emitted `defs` → `units` → `summonFx` in that order |
| Placement highlight parity | renderBoard `.tile.placement` | **PASS** | DOM 6 == `getValidPlacementTiles` 6 |
| `placeTrap` | :151188 | **PASS** | trap written to `board[7][5]` on a hex-adjacent tile |
| `placeWall` | :151230 | **PASS** | wall written; tile then absent from `getValidMoves` |
| `placeLocation` | :151006 | UNVERIFIED | not exercised this run |
| `initGame` / deployment | :98942, :86321 | **PASS** | hero (6,9), AI hero (7,2) on the 14×12 board |

## §2 — Movement

| Function | Where | Status | Evidence |
|---|---|---|---|
| `getMoveRange` / `_getMoveRangeRaw` | :85177, :85207 | **PASS** | `stats.spd` 3 → 32 reachable tiles |
| `getValidMoves` | :85238 | **PASS** | 32 tiles, max hex distance 3, 0 out-of-bounds, 0 duplicates |
| `getMovePath` | :102056 | **PASS** | walled maze: hex distance 5, route 6 steps, every step a true hex neighbour |
| `moveUnit` | :102344 | **PASS** | unit landed on the clicked destination; game `pos` == board `gx,gz` |
| `onTileClick` move branch | :146077 | **PASS** | real mouse click on the destination moved the hero |
| Wall blocks the BFS | inside `getValidMoves` | **PASS** | wall tile never offered |
| **`moveUnit` writes `unit.walkPath`** (the route travels with the move) | :102672-102729 | **PASS ✓w8** | a 10-step detour round a full row of bodies: `walkPath` == `getMovePath` with the start tile prepended; truncated at the tile a trap stops the walk on; `null` when there is no multi-tile route, and re-assigned on **every** branch so a unit can never keep an older move's route |
| `_bbStageUnitList` forwards the route on the per-unit `path` channel | :106481-106497 | **PASS ✓w8** | a shove ray still wins over `walkPath`; the board re-validates either with `shoveLegs` |
| Zone-of-control gating | :84960-84970 | UNVERIFIED | no ZoC-passive unit in the seeded roster |
| **Move highlight: DOM vs canvas** | renderBoard / `_bbStagePushPaint` | **PASS** | `.tile.move-target` set is **byte-identical** to the canvas `paint.move` set and to `getValidMoves` — 32/32/32, same tiles. The two layers do not disagree about reachability |

## §3 — Attack, displacement

| Function | Where | Status | Evidence |
|---|---|---|---|
| `getEffectiveAttackRange` | :84853 | **PASS** | Slash → 1 |
| `getAvailableMoves` | :85109 | **PASS** | returns the hero's moveset |
| `executeMove` primary hit | :99915 | **PASS** | melee at hex distance 1: 250 → 229 HP |
| Attack highlight parity | renderBoard / paint push | **PASS** | DOM `.tile.attack-target` 1 == canvas `paint.attack` 1 |
| Attack **arc** telegraph | `_bbStagePushTele` | **PASS** | `arc {from:{6,9}, to:{7,9}, side:'mine'}` pushed on hover-over-enemy |
| `move.knockback` displacement | :101314-101347 | **PASS** | now `hexDirToward` + per-step `hexStep`; 0/4730 bad |
| `move.pull` displacement | :101349-101387 | **PASS** | same helpers |
| vortex / shockwave AoE displacement | :93596-93616 | **PASS** | same helpers — the previously **undisclosed** copy is fixed too |
| `_slideOnIce(state,cx,cy,dir)` | :75663 | **PASS** | signature now takes a *direction index*, walks with `hexStep` per step |
| Ranged attack (range ≥2) | — | UNVERIFIED | seeded roster only knows `slash` (range 1) |
| `move.aoeRadius` splash | :101163-101178 | UNVERIFIED | no AoE move on the seeded roster |
| `move.laneDepth` lane sweep | :101181-101200 | UNVERIFIED | same |
| Counter Stance retaliation | :100118 | UNVERIFIED | no counter-stance unit available |
| `_ambushReactToMove` (Overwatch) | :102043 | UNVERIFIED | no overwatch unit available |
| `findNearestReachableEnemy` / `_squadSightCanSee` | :85150, :85186 | UNVERIFIED | present and route through `distance()`; not exercised end-to-end |

## §4 — Abilities, passives, fusion, consumables

| Function | Where | Status | Evidence |
|---|---|---|---|
| `_fieldAbilityOf` / `_canUseFieldAbility` / `_activateFieldAbility` | :89028 | **PASS** | present and callable; the starter hero carries none, so the row correctly does not render |
| `hasPassive` / `sideHasPassive` / `anyUnitHasPassive` | :41244+ | **PASS** | present, exercised inside `_getMoveRangeRaw` |
| `hasAdjacentAllyWithPassive` | :41304 | UNVERIFIED | not exercised |
| Fusion predicates (`_unitIsFusionCost/Ready/Castable`) | ~:70796 | **PASS** | present |
| `_resolveFusionPlacement` + adjacency highlight | :95947 / renderBoard | **PASS** | 5 tiles lit (`consumable-target-tile`), **every one at hex distance 1** — the sixth neighbour was occupied |
| `resolveHeroConsumable` | :203779 | UNVERIFIED | needs an equipped Field Bag |
| Kalon transform / Archon summon | dispatch :71111, :71126 | UNVERIFIED | needs admin catalog cards |

## §5 — Traps, walls, tombstones, ruins, looting

| Function | Where | Status | Evidence |
|---|---|---|---|
| Trap trigger (`applyTrapToUnit`) | :101829 | **PASS** | enemy walked onto the trap: 250 → 241 HP, trap consumed |
| `tickTombstones` | :75782 | **PASS** | glowing raise-marker consumed on tick; an un-looted lootable marker correctly never expires (documented rule) |
| `tileBlockedByTombstone` | :75882 | **PASS** | present; false for a plain lootable marker, as designed |
| `_unitCanLoot` + `_lootWithUnit` | :78345 / :78102 | **PASS** | **1 call into the real `_lootGridOpen`**, ctx `{tombName:'Fallen Probe', unitName:'Sir Cedric'}` |
| `_unitCanLootStructure` + `_lootStructureWithUnit` | :78972 / :78992 | **PASS** | **1 call into the real `_lootGridOpen`**, ctx `{tombName:'Wrecked Car', icon:'🚗', lootTitle:'🚗 Wrecked Car Salvage'}` — the ruin path is the tombstone path |
| `_lootGridOpen` | :77926 | **PASS** | one definition; both paths reach it |
| `openExtractionMenu` / `openStructureExtractionMenu` | :78291 / :79169 | **PASS** | callable, no throw |
| `_rollStructurePlacements` / `_seedBattleStructures` | :78544 / :78639 | **PASS** | 5 ruins every match — car, church, school, hospital, house — 0 on a truck tile |

## §6 — Control points (the second victory path)

| Function | Where | Status | Evidence |
|---|---|---|---|
| `_cpSeedControlPoints` | :78797 | **PASS** | 3 trucks ALPHA/BRAVO/CHARLIE; 0 on a ruin tile |
| `_cpHolderOf` | :78819 | **PASS** | truck tile → holder; a hex neighbour → holder; hex distance 2 → `null` |
| `_cpHeldCount` | :78836 | **PASS** | tracks the live board |
| **Tick fires once per side per turn — single player** | :103009 (call), :79146 | **PASS** | two full turn cycles driven through the real `onEndTurn()`: tally `1/ai:1`, `2/player:1`, `2/ai:1` — **0 duplicates** |
| **Tick fires once per side per turn — multiplayer** | :79180 guard | **PASS** | with `App.battlePrep.multiplayer` set, `who==='ai'` is a no-op (score 0) while `who==='player'` still scores (1). The local client can only tick its own side, so the sender/receiver double-count is closed |
| `_cpEvalVictory` | :79245 | **PASS** | streak 3 → `'player'`. `CP_HOLD_TO_WIN=2`, `CP_STREAK_TO_WIN=3` |
| Objective banner + SCP tracker | :143243 / :143255 | **PASS** | banner reads "Hold 2 of the 3 SCP trucks at the start of 3 straight turns to win the battle — or defeat the enemy hero."; tracker shows all three trucks with per-side held/streak |

## §7 — Surfaces and status effects

| Function | Where | Status | Evidence |
|---|---|---|---|
| `_paintSurface` | :75597 | **PASS** | r=1 → exactly 7 tiles, **0** outside hex radius 1 |
| `_floodCollectSurface` / `_floodConvertSurface` | :75415 / :75430 | **PASS** | 7-tile 6-connected blob collected, 7 converted |
| `tickSurfaces` | :75454 | **PASS** | ran on the 14×12 board, no throw |
| `_setSurface` + surface bridge push | :75373 / :106870 | **PASS** | 10 tiles pushed to the stage |
| `applyStatusEffect` / `isImmuneToStatus` | :99389 / :99043 | **PASS** | burn applied (`burn:2`), re-apply refreshes to `burn:5`. Pure — returns a new unit |
| `_seedBattleSurfaces` | :75613 | UNVERIFIED | present; not exercised directly |

## §8 — UI: board, hover menu, modals, hand, rail, turns

| Function | Where | Status | Evidence |
|---|---|---|---|
| `renderBoard` | :143831 | **PASS** | 168 tiles, `grid-template-columns` 29 tracks × 12 rows, row 0 starts at column 1 and row 1 at column 2 (odd-r shift), 3-tone colouring with 0 collisions |
| `renderBattle` / `_renderBattleImmediate` | :135988 / :136010 | **PASS** | |
| `renderUnitModal` | :143101 | **PASS** | own hero 10,887 chars; enemy 7,066 chars (scan gate still redacting) |
| `renderHandStrip` | :144851 | **PASS** | 5 hand cards |
| Side rail | :136400 region | **PASS** | children: `tw-objective-banner`, `cp-track panel`, `bc-fieldcond`, `bcp`, `bc-wrap-action` |
| Deck rail / piles | right rail | **PASS** | foe deck / realm / grave, tunneled, graveyard, your deck, realm deck, camp — see `GATE-app.png` |
| End turn | rail | **PASS** | 1 button; `onEndTurn()` drove two complete cycles |
| `_hoverButtonsFor` | :70743 | **PASS** | hero → attack / move / details; enemy → details |
| `_dispatchHoverAction` | :71093 | **PASS** | `move` entered move mode; the route then telegraphed and walked |
| `onUnitClick` | :145960 | **PASS** | |
| `getSwapTargets` | :146059 | **PASS** | returns targets |
| Swap highlight | `.tile.swap-target` | UNVERIFIED | only one own unit on the field, so nothing to swap with — inconclusive, not a failure |
| DOM tile click delegation | :145644 | **PASS** | `data-x`/`data-y` exact by construction |
| `startTurn` / `endPlayerTurn` / `endAITurn` | :102573 / :103295 / :103309 | **PASS** | turnNumber 1 → 2, turn handed back both ways |
| `checkPostAction` | :151736 | **PASS** | no throw |
| `_twTickGameMode` / `_twEvalObjectives` | :216350 / :216058 | **PASS** | both ran, no throw |
| Weather | :108440 `_wxEnabled`, :144432 `renderWeatherFx`, :39549 icon | **PASS** | rain set → `_wxEnabled()` true, icon resolves, `renderWeatherFx()` runs clean |
| `.unit[data-y]` depth ladder + event lift ladder | :13595-13606, :8400-8411 | **PASS** | rules exist for rows **0–11** |
| Activation FX / draw FX / combat cut-away | :149875, :136399, :100062 | UNVERIFIED | purely visual, not exercised this run |
| `src/battle/targeting.js` readout | targeting.js:340-379 | UNVERIFIED | module not reachable from the page globals here |

## §9 — AI

| Function | Where | Status | Evidence |
|---|---|---|---|
| `scheduleAIStep` / `doAIStep` / `finishAIPhase` | :152310 / :152985 / :152359 | **PASS** | full AI turns ran end to end; the AI unit moved legally and in bounds, turn handed back |
| AI telegraph | `setAIActor` → `_bbStagePushTele` | **PASS** | pushed `{side:'foe', path:['7,2','8,2'], dest:{8,2}}` and the AI ended on exactly that tile |
| Minefield band | :216646-216658 | **PASS** | deliberately square, disclosed in place; board-array lookup is the bounds test. Only remaining `dx=-1..1` loop in the file |

## §10 — Replays  *(OPEN-BREAKS §2 — closed)*

| Function | Where | Status | Evidence |
|---|---|---|---|
| `cloneStateLight` | :71787 | **PASS** | carries `structures`, `controlPoints`, `cpScore`, `cpStreak`, `tombstones`, **`_bbMapSeed`**, plus `activeLocation`, `heroUltimates`, `heroEmotions`, `scanned`, `smokedTiles`, `persistentSpells`, and a key audit that warns about anything new |
| `recordReplaySnapshot` / `commitReplayToProfile` | :71855 / :71774 | **PASS** | |
| `rebuildReplayState` | :71831 | **PASS** | |
| **Replay rebuilds the SAME battlefield** | — | **PASS** | live seed `3322110575` == replay seed; structures identical; control points identical; `_bbGenTerrain(14,12,seed)` is byte-identical for the same seed and differs for another |
| `renderReplayViewer` / replay board | :168874 | **PASS** | the rebuilt board renders 168 tiles, **5** ruin markers, **3** CP markers, the CP track and the objective banner |
| **Replay stepper walks the REAL bent route** | `cloneStateLight` carries `units` verbatim | **PASS ✓w8** | `rebuildReplayState(rep,1)` with an EMPTY telegraph: the sprite walked all 10 legs of `getMovePath` in 1.35 s and settled on (6,3). Before wave 8 this was 1 leg / 0.34 s straight through a wall of bodies |
| Replay snapshot re-diffed (OPEN-BREAKS §2) | :71787 | **PASS ✓w8** | live vs replay: seed `857321850` == `857321850`, ruins `car@11,1\|church@2,8\|hospital@4,1\|house@12,4\|school@10,9` identical, trucks `cp1@1,6\|cp2@7,5\|cp3@11,6` identical, `cpScore`/`cpStreak` identical; `_bbGenTerrain(14,12,seed)` byte-identical for that seed and different for another |

## §11 — Multiplayer

| Function | Where | Status | Evidence |
|---|---|---|---|
| `_mirrorPos` | :181968 | **PASS** | 0 hex-distance violations over the sampled pair sweep |
| `_mirrorAllPositions` | :181976 | **PASS** | involution over units **and** structures **and** control points |
| **`_mirrorAllPositions` mirrors `unit.walkPath`** | :182857 | **PASS ✓w8** | route mirrored point-by-point through the same `_mirrorPos` as `pos`: `6,9→…→6,3` came back as `7,2→…→7,8`, every point the exact mirror. Left unmirrored it starts on a tile the unit is not on, the board rejects it, and the receiver silently reverts to the straight tween |
| **Multiplayer RECEIVE walks the real bent route** | serialize → mirror → `_onRemoteStateArrived` shape | **PASS ✓w8** | with `TELE` empty: 10 legs, 1.35 s, legs == the mirrored route, settled on (7,8). Teeth: `delete u.walkPath` on the same push → 1 leg, 0.34 s, straight through the wall |
| Dead `_mirroredAiTrail` handoff removed | :182926 / :184836 | **PASS ✓w8** | the `isArray(App.ui.aiMoveTrail)` guard could never fire (`setAIActor` stores an object) and read local UI state that belongs to nobody in a multiplayer match. Removed; the receiver clears `aiMoveTrail` as before and the real route rides on the unit |
| `_serializeBattleStateForBroadcast` | :182194 | **PASS** | deny-list — `structures`, `controlPoints`, `cpScore`, `cpStreak`, `tombstones`, `_bbMapSeed` all survive; 17.8 KB |
| Colyseus relay / `_onRemoteStateArrived` / turn-start-on-flip CP tick | :45775, :183805, :183858 | UNVERIFIED | needs two live clients + Supabase. The guard that makes it safe is executed above; the round trip is not |
| Supabase loot persistence | — | UNVERIFIED | the grid opens; the write does not run offline |

## §12 — Canvas stage and the bridge

| Function | Where | Status | Evidence |
|---|---|---|---|
| `gw` / `worldToTile` / `pickTile` round trip | battle-board:553, :5282, :5325 | **PASS** | `__bbHexCheck`: 4,368 centre samples + 2,856 slab samples → **0** centreFails, **0** jitterFails, **0** slabFails |
| `hexCorners` / `tilePoly` | :563 / :1423 | **PASS** | 6 vertices |
| `drawStruct` / `drawTruck` / `drawUnit` + painter order | :3887 / :4376 / :4589 | **PASS** | painter items 14 = 5 ruins + 3 trucks + 2 units + 4 braziers, **0 depth inversions** |
| **Pointer → `pickTile` → `board:tileClick` → `onTileClick`** | :8948 / index.html:107066 | **PASS ✓w8** | **168 of 168** real mouse clicks on projected tile centres resolve to the right tile, on six match seeds and again after `R`. Was 164/168. See FAILURE 1 — CLOSED |
| `slabTakesSample` / `PICK_EDGE_PX` (the fix) | :7573 / :7699 | **PASS ✓w8** | 24 random seeds at the neutral fit: `deadCentres` 0/24 (was 1–6 on 24/24), `nullOverDrawn` 0, `click.hard` 0. Also 0 at 1366×768 and 1920×1080 |
| `hexStepDirs` / `isHexStep` (shoveLegs leg test) | :1477 / :1482 | **PASS ✓w8** | a square-box diagonal `(6,8)→(7,7)→(7,6)` — hex distance 2 off an even row — is **refused** (falls back to the 1-leg endpoint tween); the legal `(6,8)→(6,7)→(7,6)` is **accepted** (2 legs, 0.5 s). Six offsets, not eight |
| Camera fit / framing | `fitDistance` :1301, `fitAim` :1332 | **PASS** | `offFrameFails: 0` and 0 off-canvas tile centres at 1366×768, 1600×900 and 1920×1080 |
| **All ten harness scenes still render** | `battle-board/_harness.html?scene=` | **PASS ✓w8** | gamemap · empty · skirmish · moverange · telegraph · arc · threat · aitele · night · ruins — every one reaches `__harnessReady`, **0 page errors**, 168 tiles, `__bbHexCheck().ok true`, `deadCentres`/`buriedFails`/`offFrameFails`/`nullOverDrawn` all 0, `click.hard 0`, `painter.inversions 0` |
| **Painter order under the free camera** | `camCheck().painter` | **PASS ✓w8** | `inversions: 0` on 24 random seeds at the neutral fit, on all eight camera poses swept (yaw 0/45/90/137/180/270, panned and unpanned), at three viewports and on all ten harness scenes. `terrain.registered` true at every pose — the baked ground layer is not surviving a camera move |
| Free camera (WASD / Q-E / R) | `__bbCam`, `camReset` | **PASS** | 16 poses driven (8 yaws × pans); **R restores exactly** to yaw 0 / pan (0,0) and off-frame back to 0 |
| `_bbMapSeed` / `_bbGenTerrain` | index.html:104733 / :105164 | **PASS** | deterministic: same seed → identical 168-tile output, different seed → different |
| `_bbMapFromEditor` / `_bbStagePayload` | :105269 / :105914 | **PASS** | cols 14, rows 12, 168 tiles, 132 carry `elev`, 168 carry `surf` |
| Push helpers (`paint` / `tele` / `tombs` / `structs` / `cps` / `surfaces` / `units` / `defs`) | :106444-106933 | **PASS** | structs 5, cps 3, tombs 0, surfaces 10 |
| **Telegraph: drawn route == walked route** (wave 7) | `telegraphLegs` battle-board:1571 | **PASS** | see below |

### Wave 7 verified, end to end

Hero at (6,9) behind a 7-tile wall maze, destination (10,6):

```
getMovePath (the rules)   6,9 → 7,10 → 8,10 → 8,9 → 9,8 → 9,7 → 10,6     (hex distance 5, 6 steps)
Board.tele.path (drawn)   6,9 → 7,10 → 8,10 → 8,9 → 9,8 → 9,7 → 10,6
u.tween.legs   (walked)   6,9 → 7,10 → 8,10 → 8,9 → 9,8 → 9,7 → 10,6
App.state pos  (rules)    {x:10, y:6}
```

Identical. The route bends, and the arrow does not lie about the rules.

### Wave 8 verified, end to end — **the route on the paths that have NO telegraph**

Wave 7 fixed the walk by reading the route off `TELE`, the telegraph overlay. `TELE` only
exists while a human is hovering or the local AI is narrating, so the fix reached the
player's own move and nothing else. A client RECEIVING a multiplayer snapshot and the
REPLAY STEPPER both relocate the unit in state and push the roster with no telegraph at
all, and both fell through to the two-endpoint tween. Wave 8 moves the route into state
(`unit.walkPath`, written by the `moveUnit()` reducer, mirrored by `_mirrorAllPositions`,
cloned by `cloneStateLight`, forwarded on the existing per-unit `path` channel).

Hero at (6,9), a wall of bodies across the whole of row 6 with one gap at (3,6),
destination (6,3) — the only legal route detours nine hexes west and back:

```
getMovePath (the rules)   6,9 → 5,9 → 4,9 → 4,8 → 3,7 → 3,6 → 3,5 → 4,5 → 5,5 → 6,4 → 6,3
unit.walkPath (state)     6,9 → 5,9 → 4,9 → 4,8 → 3,7 → 3,6 → 3,5 → 4,5 → 5,5 → 6,4 → 6,3

A · MULTIPLAYER RECEIVE     serialize → _mirrorAllPositions → adopt → _bbStagePushUnits
    telegraph at push       []                                  ← no telegraph, the point
    mirrored route          7,2 → 8,2 → 9,2 → 9,3 → 10,4 → 10,5 → 10,6 → 9,6 → 8,6 → 7,7 → 7,8
    WALKED  u.tween         10 legs, dur 1.35 s (7.4 hex/s), legs == the mirrored route
    settled                 7,8  anim=idle        (mirror of (6,3) on a 14×12 board ✓)
    teeth: same push, route stripped
                            1 leg, dur 0.34 s, 7,2 → 7,8 straight through the wall

B · REPLAY STEPPER          recordReplaySnapshot → rebuildReplayState(rep, 1)
    telegraph at push       []
    WALKED  u.tween         10 legs, dur 1.35 s, legs == getMovePath exactly
    settled                 6,3  anim=idle

C · LOCAL CLICK (wave 7's own case, unchanged)
    telegraph drawn         6,9 → … → 6,3      (11 tiles)
    WALKED  u.tween         10 legs, dur 1.35 s, legs == getMovePath
    App.state pos           {x:6, y:3}

D · PACE          2-hex route → 2 legs / 0.50 s.  10-hex route → 10 legs / 1.35 s
                  (dur = min(WALK_DUR_MAX 1.35, (n+2)/WALK_LEGS_PER_SEC 8) — constant
                  ground speed until the cap, one leg still 0.34 s).
                  A relocation with NO route (teleport / summon) → 1 leg / 0.34 s straight,
                  which is the honest picture: nothing walked.
```

---

# FAILURE 1 — **CLOSED IN WAVE 8.** One to six tiles per match had a dead centre pixel

> ## ✅ CLOSED — re-measured by the wave 8 sign-off, from scratch
>
> The fix is `slabTakesSample()` + `PICK_EDGE_PX` in `public/battle-board/index.html`
> (`:7573`, applied in `pickTile` at `:7699`): the analytic plane sweep keeps its exact
> answer, but a slab only occludes a sample its **drawn top face actually covers**, and
> the ≤1.5 px hairline inside a slab's BACK edges is handed to the tile behind. A
> rim-rejected rung is remembered and restored when the sweep bottoms out on nothing, so
> the rim cannot turn a hit into a null on a perimeter tile.
>
> **Independently re-measured — 24 RANDOM match seeds, neutral fit, host 802×688:**
>
> ```
> deadCentres      0 on 24 of 24 seeds       (was 1..6 on 24 of 24)
> buriedFails      0 on 24 of 24
> offFrameFails    0 on 24 of 24
> nullOverDrawn    0 on 24 of 24             ← the new invariant, and it holds
> slabFails / centreFails / jitterFails  0 on 24 of 24
> click.hard       0 on 24 of 24             ← pick still agrees with the picture
> painter.inversions  0 on 24 of 24
> __bbHexCheck().ok   true on 24 of 24
> minVisible       0.471 – 0.588             (was 0.412 – 0.471)
> ```
>
> **And with real Playwright mouse clicks on all 168 projected tile centres** — the whole
> live path, `.bb-catch` → `board:pointer` → `pickTile` → `board:tileClick`:
>
> ```
> seed 3322110575   168/168 correct        seed 1606707961   168/168
> seed 4248822701   168/168                seed 3489095897   168/168
> seed 2219915628   168/168                after R restore   168/168
> ```
>
> Also `ok:true` at 1366×768 (host 712×560) and 1920×1080 (host 1111×868), and on all
> ten harness scenes.
>
> **What the free camera can still do, and why it is not this failure.** Real clicks,
> default seed: yaw 45 → 0 wrong · yaw 180 → 0 wrong · yaw 45 + pan(1.8,1.4) → 3 wrong ·
> yaw 90 → 14 · yaw 137 + pan(3.75,−2.67) → 12 · yaw 270 + pan(−1.5,1) → 14; and
> pan(1.8,−1.4) pushes 10 tile centres off the canvas, where the click answers nothing.
> `click.hard` is **0 at every one of those poses** — the pick returns the tile the
> renderer painted, so nothing lies — and `R` restores yaw 0 / pan (0,0) exactly, after
> which the sweep is 168/168 again. That is the BAR R1 relief vs BAR R2 pickability trade
> disclosed at `battle-board/index.html:7568-7845`. The knob is still the elevation
> ladder's rung gap, and it is still a decision, not a fix.

---

*The original diagnosis is kept below because it is what the fix was derived from.*

**`public/battle-board/index.html:8582`** (`pointer` → `pickTile` → `unitAt`), consequence
of the elevation ladder introduced by the terrain wave. Disclosed as a known trade in the
header at **`public/battle-board/index.html:7570-7625`** — but that disclosure's table
claims `deadCentres: 0` at 1600×900, and that is only true of the fixture's default seed.

**Measured, 24 random match seeds, host 802×688 (a 1600×900 window):**

```
buriedFails      0 on all 24 seeds   ← nothing is unreachable. This is the invariant, and it holds.
offFrameFails    0 on all 24 seeds   ← OPEN-BREAKS §3 stays closed at every seed
deadCentres      1..6, on 24 of 24 seeds   (median 3, worst 6)
minVisible       0.412 – 0.471
```

**Confirmed with real mouse clicks, not only geometry.** A sweep of all 168 projected
tile centres at 1600×900 on one live match:

```
164 / 168 clicks resolved to the correct tile
  4 resolved to a neighbour:
      (3,1)  → (4,2)
      (12,1) → (12,2)
      (13,1) → (13,2)
      (13,2) → (12,3)
```

Three of those four are exactly the tiles `__bbHexCheck()` reported as `deadCentres` on
that same seed. The element under the cursor was `DIV.bb-catch` every time — the click
reached the board; the *pick* answered with the wrong hexagon.

**Why it matters for gameplay, precisely.** Unit selection on the stage is strictly
tile-based:

```js
// public/battle-board/index.html:8585
const hit = tile ? unitAt(tile.x, tile.z) : null;
if (msg.kind === 'click') { if (tile) dispatch('tileClick', { x:tile.x, z:tile.z, unitId: hit ? String(hit.id) : null }); }
```

`unitAt` is `units.find(u => u.gx===gx && u.gz===gz)` (`:1441`). There is no sprite-box
fallback. So a unit standing on a dead-centre tile cannot be selected by clicking on its
feet — the pick returns the neighbour, and with it the neighbour's unit or none. The unit
is still selectable elsewhere inside its own hexagon (`buriedFails: 0`, and at worst 41%
of the sampled hex still resolves correctly), so nothing is lost permanently and no rule
is wrong. But "click the unit, select the unit" is a battlefield function that worked
before this project — the pre-project board was flat, with no occluders — and it now
fails on 1–6 tiles of every match.

**Not a framing bug.** `offFrameFails` is 0, `centreFails`/`jitterFails`/`slabFails` are 0,
and `__bbCam.check().click.mismatch` is 0 — `pickTile` agrees with the drawn picture
everywhere. The pixel genuinely has a taller slab in front of it; the picture is honest
and the pick is honest. What is wrong is that the *unit's anchor point* is allowed to sit
on a pixel the terrain covers.

> ⚠ **STALE AS OF THE `PICK_EDGE_PX` FIX — the two sentences above about `mismatch`
> no longer hold, and the probe's shape changed.** `camCheck().click` is now
> `{samples, mismatch, rim, hard, offScreen, bad}`. `mismatch` is nonzero **by design**:
> the pick hands the ≤1.5 px band inside a slab's back edges to the tile behind it, so
> pick and picture disagree on 5.64% of drawn ground pixels board-wide (10,392 / 184,215
> rastered at 1 px, 802×688, default seed). **The assertion is `hard === 0`**, and `rim`
> is only allowed to absorb a disagreement whose depth inside the drawn owner is
> ≤ `PICK_EDGE_PX` — without that bound `hard === 0` was satisfiable by any rim width
> (demonstrated at `PICK_EDGE_PX = 8`, every check green, the board measurably worse).
> A second invariant now backs it: `__bbHexCheck().nullOverDrawn`, which asserts that no
> drawn ground pixel answers **nothing**, and is in `ok`.
>
> **Sign-off confirms the new shape and the new assertion.** `camCheck().click` reports
> `{samples, mismatch, rim, hard, offScreen, bad}`; over 24 random seeds at the neutral
> fit `mismatch` is 0–3 and **every one of them is classified `rim`**, `hard` is 0 on all
> 24, and `nullOverDrawn` is 0 on all 24. Held at 1366×768 and 1920×1080 too, and at all
> eight camera poses swept (yaw 0/45/90/137/180/270, panned and unpanned): `hard` 0 at
> every pose.

**The knob, stated so the next person does not re-derive it.** *(Answered: neither (a) nor
(b) — the fix was a third option, the hybrid analytic-plus-drawn-polygon test in
`slabTakesSample`. (b) was explicitly rejected because a sprite-box fallback would make
units clickable and leave bare GROUND still mis-picking, i.e. the rules and the picture
still disagreeing. The original two options are kept below as written.)* Either (a) shrink the
elevation ladder's rung gap — trades BAR R1 relief for BAR R2 pickability, and is a
decision, not a fix; or (b) give `unitAt` a screen-space fallback: when `pickTile` lands
on a tile whose *neighbour* holds a unit whose `unitScreenBox` contains the cursor, prefer
that unit. (b) costs no relief and touches only the pick, not the rules — the tile the
click resolves to for *ground* purposes would stay exactly as it is.

---

# OPEN-BREAKS — all three reproduced on the pre-fix code, then confirmed closed

> ⏭ **RE-CONFIRMED BY THE WAVE 8 SIGN-OFF.** The two fixes this wave made touch code
> adjacent to all three, so all three were measured again on `503db38`:
>
> * **§1 displacement** — 4,730 attacker/target pairs at hex distance ≤3, shoved AWAY and
>   PULLED TOWARD through the shipping `hexDirToward` + `hexStep`: **0** away-step
>   violations, **0** pull-step violations, 0 pairs with no direction. The three recorded
>   cases still land one hex: (7,6)→(7,5), (7,6)→(7,7), (6,6)→(6,5). `_slideOnIce` still
>   has arity 4, i.e. still takes a direction index. Still closed.
> * **§2 replay snapshot** — recorded a live match and replayed it: seed, all five ruin
>   tiles, all three truck tiles, `cpScore` and `cpStreak` identical; `_bbGenTerrain`
>   byte-identical for that seed and different for another. The snapshot now also carries
>   `walkPath`. Still closed.
> * **§3 off-frame tiles** — `offFrameFails: 0` at 1366×768, 1600×900 and 1920×1080 at the
>   neutral fit, and 0 on all 24 random seeds at 1600×900. `R` still restores yaw 0 /
>   pan (0,0) exactly, after which a 168-click sweep is 168/168. Still closed.

Each was reproduced first. A pre-fix serve root was built by symlinking `public/` and
substituting the pre-fix file from git, so the failing code really ran.

## §1 — Displacement along a square diagonal — **CLOSED**

*Reproduced* (the pre-fix `Math.sign` vector, run against the live board):

| attacker | target | lands on | hexes moved |
|---|---|---|---|
| (6,7) | (7,6) | (8,5) | **2** |
| (6,5) | (7,6) | (8,7) | **2** |
| (5,7) | (6,6) | (7,5) | **2** |

Swept over every attacker/target pair at hex distance ≤3: **1,742 of 4,730 pairs**
displaced the target more than one hex.

*Confirmed closed.* `hexDirToward(ax,ay,tx,ty)` + per-step `hexStep(x,y,dir)`
(`index.html:101326`, `:101366`, `:93605`, `_slideOnIce` `:75674`) over the same 4,730
pairs: **0** violations. The three recorded cases now land at (7,5), (7,7), (6,5) —
one hex each. The previously **undisclosed** vortex/shockwave copy at `:93596` is fixed
with the same helpers.

## §2 — Replays render a board that never existed — **CLOSED**

*Reproduced.* The pre-fix allow-list rebuilt verbatim carries neither `structures` nor
`_bbMapSeed` (`hasStructures: false`, `hasSeed: false`).

*Confirmed closed by recording a match and replaying it*, not by reading the allow-list:
live seed `3322110575` == replay seed; ruin tiles identical; truck tiles identical;
`_bbGenTerrain` output byte-identical for that seed (and different for another, so the
comparison has teeth). The replay board renders 5 ruin markers, 3 CP markers, the CP
track and the objective banner — all of which were 0/absent before.

## §3 — Two tiles project off the canvas — **CLOSED**

*Reproduced on the pre-fix board (`c76358c`)*, all three viewports, exactly the recorded
pair:

```
1366×768   off-canvas tile centres: 2   →   (0,10), (13,11)
1600×900   off-canvas tile centres: 2   →   (0,10), (13,11)
1920×1080  off-canvas tile centres: 2   →   (0,10), (13,11)
```

*Confirmed closed on HEAD*, same three viewports: **0** off-canvas centres, `offFrameFails: 0`,
and 0 off-canvas centres on all 24 seeds swept. The fix is in `fitDistance`
(`battle-board:1301`), which now walks **every** tile rather than the two end columns,
samples the tile's **near side vertex** (`cornerX = tileR()`, `cornerZ = hexSize()/2`)
rather than its centre, and reads `tileElev(gx,gz)` rather than assuming flat ground.

**And the camera cannot re-open it.** 16 poses (8 yaws × pans, plus clamp extremes) push
up to 18 tiles out of frame — that is what a free camera is for — but pan is clamped and
**R restores the neutral pose exactly** (yaw 137°/pan (3.75,−2.67) → yaw 0 / pan (0,0),
off-frame back to 0). Every playable tile is always one keypress from being in view.

---

# NITS — recorded so they are not re-derived as new bugs

1. **Pre-existing: a two-turn no-op match stamps `gameOver: 'player'`.** With both heroes
   alive at 250/250 and no log line, `App.state.gameOver` flips to `'player'` at the start
   of the player's turn 2. **This is NOT wave damage** — the identical trace was produced
   on the pre-project build (`4dbc4f9`, `BOARD_W = 8`, before any of this work):
   ```
   HEAD     tn 2 player  go=player  playerH:A:250 aiH:A:250
   PREPROJ  tn 2 player  go=player  playerH:A:250 aiH:A:250
   ```
   Almost certainly the AI deck-out path in this offline sandbox (no admin AI decks).
   Out of scope for this gate; flagged so it is not mistaken for a battlefield regression.
2. **Pre-existing (`66a504f`, 2026-08-11):** `onTileClick`'s sacrifice-targeting branch at
   `index.html:146180` reads `occupantHere`, declared only inside two earlier blocks.
   Taking that branch throws `ReferenceError`. One line to fix; predates this project.
3. **Stale comment**, `index.html:101150`: "N=1 means the 8 surrounding tiles, N=2 expands
   to 24". The code below it is `distance(...) <= r`, i.e. 6 and 18.
4. **DOM board hex proportion** — the hidden fallback board's tiles read ~6% tall against
   HEXW/HEXV. It is covered by the canvas stage (`.board` is `visibility:hidden` while the
   stage is on) and clicks there go through `data-x`/`data-y`, so no rule is affected.
5. **`.ai-trail` DOM glyph renders 0 elements.** Expected: it is `visibility:hidden`
   whenever the stage is on, and the enemy arrow ships through `board:tele` with
   `side:'foe'` — verified above.
6. **Mixed sources of truth in the MP mirror:** `_mirrorAllPositions` mirrors `board` from
   derived W/H but `tombstones`/`structures`/`controlPoints`/`smokeClouds` from the
   constants. They agree at 14×12; nothing is wrong today.
7. **Uncommitted work in the tree at gate time** — `public/battle-board/index.html`,
   105 insertions (occlusion clip: `unitGroundY` falls back to `unitTile()`, the clip
   anchor carries the hop, the audit samples 9×11 plus a ground ring). It is included in
   every measurement above and introduced no error in any run.

---

# Method

* **Boot rig** — `scratchpad/lib.mjs` + `common.mjs`: serves `public/` over http-server,
  loads the **real** `public/index.html` in Playwright Chromium, drives
  `startBattleWithPrep(true)` with `STARTER_HEROES[0..1]`, then waits on the live stage
  (`_BBS.ready` and >100 tiles) before probing. Every game global (`distance`, `BOARD_W`,
  `App`, `_BBS`, …) is a top-level `const` — a **lexical** global, not `window.*` — so
  probes call it as a bare identifier and therefore call the shipping function, not a copy.
  (Three of this gate's early false results were `window.X` reads returning `undefined`.)
* **Pre-fix rigs** — `scratchpad/prefixroot/` (symlinked `public/`, `battle-board/index.html`
  from `c76358c`) and `scratchpad/preproj/` (symlinked `public/`, `index.html` from
  `4dbc4f9`). Both served through the same boot rig via `SERVE_ROOT`.
* **Click sweeps** — real `page.mouse.click()` at each of the 168 tile centres taken from
  the board's own `board:rects` publish, with a 380 ms settle (the tile-click round trip is
  `postMessage` → `pickTile` → `postMessage`; reading sooner scores false misses) and the
  unit modal dismissed between clicks (it opens on the first click and covers the board —
  that artifact alone produced 165 phantom misses on the first attempt).
* **Rendering** — `renderBattle()` is rAF-batched; every DOM assertion calls
  `_renderBattleImmediate()` first.
* **Capture** — `.gauntlet/GATE-final.png` (harness `scene=gamemap`, the as-shipped map at
  the measured in-game host rect) and `.gauntlet/GATE-app.png` (the whole real game screen
  mid-match: rail, objective banner, SCP tracker, hero panels, log, END TURN, consumables,
  hand strip, deck rail, and the hex field with all five ruins and the trucks on it).
  Every tile of the board sits inside the host rect in both.

## Sign-off rigs (wave 8) — how the numbers above were produced

All four are in `scratchpad/` (gitignored), all four drive the **real** `public/index.html`
through `startBattleWithPrep` in Playwright Chromium, and all four call the shipping
functions as bare identifiers because every game global is a lexical `const`.

* `so_lib.mjs` — the shared boot: http-server on `public/`, real match, wait on
  `_BBS.frame.contentWindow.__bbHexCheck` before probing.
* `seedsweep.mjs` — forces a map seed into the real sender
  (`App.state._bbMapSeed = s; _bbStagePost('init', _bbStagePayload())`), then reads
  `__bbHexCheck()` and `__bbCam.check()`. 24 seeds at the neutral fit + 8 camera poses on
  three seeds.
* `clicksweep.mjs` — **real** `page.mouse.click()` on all 168 projected tile centres taken
  from the board's own `board:rects` publish, offset by the `#bb-stage-host` rect. Two
  things make it exact where the gate's sweep was slow and noisy:
  `App.replayViewing = true` makes the host's `board:tileClick` handler a no-op
  (`index.html:107072`) so the click travels the whole real path
  `.bb-catch → board:pointer → pickTile → board:tileClick` and is recorded **without
  mutating the match** — no unit modal to dismiss, no 380 ms settle; and each click is
  **polled for its own answer** instead of zipped positionally, because a click whose
  centre projects off the canvas dispatches nothing and a positional zip turns one silent
  click into a phantom mismatch on every click after it (that artifact alone reported 102
  false mismatches on the first run of this rig).
* `routeprobe.mjs` — builds the wall-of-bodies board, drives
  `_serializeBattleStateForBroadcast → swapBattlePerspective → _bbStagePushUnits` for the
  multiplayer-receive shape and `recordReplaySnapshot → rebuildReplayState` for the replay
  shape, and reads the tween the board actually ran out of `__bbWalk(id)`.
* `breaksprobe.mjs` — the three OPEN-BREAKS, plus the off-frame sweep at three viewports.
* `scenes.mjs` — loads all ten harness scenes and asserts `__harnessReady`, 0 page errors
  and `__bbHexCheck().ok`.

## What genuinely could not be exercised here

* Ranged / AoE / lane moves, Counter Stance, Overwatch — the seeded roster knows `slash` only.
* Consumables end to end — needs an equipped Field Bag from the profile.
* Kalon transform, Archon summon — need admin catalog cards.
* Multiplayer round trip — needs two clients and a live Supabase/Colyseus session. The
  coordinate surface (`_mirrorPos`, `_mirrorAllPositions`, `_serializeBattleStateForBroadcast`)
  and the CP double-tick guard are all executed above; the relay itself is not.
* Supabase-backed loot persistence — the grid opens; the write does not run offline.
