export const meta = {
  name: 'hexfield-wave4b',
  description: 'Close the three named gaps from wave 4 and re-verify each by execution',
  phases: [
    { title: 'Rework', detail: 'stage seams, MP double-tick, ruin mirroring' },
    { title: 'Recheck', detail: 'fresh critics re-run the named gap' },
    { title: 'Sweep', detail: 'whole-battlefield function inventory + regression gate' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/BAR.md      <- the quality bar, INCLUDING the "Standing constraint"',
  '                                   section at the end.',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/README.md   <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'STATE: a 14x12 pointy-top hex field with seeded post-apocalyptic terrain, five lootable',
  'ruins that open the real _lootGridOpen, and three SCP-truck control points with a',
  'per-turn capture score and a hold-two-of-three-for-three-turns victory. Committed at',
  '97328da. Independent critics reviewed each and named one gap each.',
  '',
  '!! FILE-SHARING RULE — OTHER BUILDERS MAY BE EDITING THE SAME FILES RIGHT NOW.',
  '- Use ONLY targeted Edit-tool edits on public/index.html and',
  '  public/battle-board/index.html.',
  '- NEVER read a whole file and write it back. NEVER use a python/node script that',
  '  rewrites either file wholesale. That silently destroys the other builders\' work.',
  '- Keep your edits inside the region your gap concerns.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- Line numbers drift. Verify every one yourself before editing.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- Do NOT touch card, economy, or combat-resolution code.',
  '- No npm dependencies. No new binary art assets — draw procedurally.',
  '- Comments explain WHY, including the bug avoided. Match surrounding style.',
  '- Do NOT git commit, checkout, stash or reset. The lead commits.',
  '',
].join('\n')

const BUILD_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['whatChanged', 'howVerified', 'knownGaps'],
  properties: {
    whatChanged: { type: 'array', items: { type: 'string' } },
    howVerified: { type: 'array', items: { type: 'string' } },
    knownGaps: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'evidence', 'biggestGap', 'fixDirective'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'rework', 'fail'] },
    evidence: { type: 'array', items: { type: 'string' } },
    biggestGap: { type: 'string' },
    fixDirective: { type: 'string' },
    regressions: { type: 'array', items: { type: 'string' } },
  },
}

const TASKS = [
  {
    "key": "stage",
    "name": "Terrain seams / terrace read",
    "gap": "The field still reads as 168 loose hex counters rather than terraced ground, because the three marks that draw a cell are applied to every tile unconditionally instead of per-edge. In `paintTileRec` (public/battle-board/index.html ~:1708-1845) each tile gets a cross-tile value ramp (S.lo at 0.30 on its far corner -> S.hi at 0.16 on its near corner), a 1.8px `rgba(6,6,10,.38)` seam and a lit lip, whether or not the neighbour on that edge is flush. So at every boundary between two same-rung tiles the eye gets a hard light->dark step plus a black line, and a six-tile rung-2 shelf paints as six separate slabs. `paintWalls` already does the right thing (`if (below >= e - 1e-4) continue; /* flush: no face */`) and the skirt already flattens its own ramp for exactly this reason (\"Neighbouring skirt cells at one height have to merge into a shelf\", `ring ? .13 : .30`) \u2014 the play field never got the same treatment, and the play field is where the plate read is. This is the single change that moves it furthest: BAR R1's positive requirement is chunky slabs AT SEVERAL HEIGHTS with cliff faces, not one slab per tile, and BAR R2 asks for the grid as a translucent overlay that follows the terrain rather than as division baked into the ground.",
    "fix": "In `paintTileRec` (public/battle-board/index.html ~:1795-1845), make the cell marks per-EDGE and conditional on the neighbour's elevation, the same test `paintWalls` already uses. Where `elevOf(x+nb[i][0], z+nb[i][1]) === e` (flush), do not stroke the dark seam or the lit lip on that edge, and drop the cross-tile gradient stops to roughly the skirt's flattened values (S.lo ~0.10 far, S.hi ~0.05 near) so a run of same-rung tiles paints as one continuous surface; where the neighbour is a rung or more down, keep the seam, the lip and the full 0.30/0.16 ramp \u2014 that boundary is where they earn the terrace read. Also cut the per-tile value jitter on the field from 0.34 to ~0.16 (the skirt's number), since a +/-17% swatch step per hex re-cuts the shelf the gradient fix just joined. Then restore pickability the way BAR R2 asks: after the ground is finished, one pass of low-alpha light hex outlines over the whole field (a single stroke around each tile, e.g. `rgba(210,205,190,.10)`, no dark companion), so cells stay legible as an overlay ON the terrain instead of as the terrain being cut into counters. Verify by re-capturing `?scene=gamemap&shot=1` and `?scene=skirmish&shot=1` at 1600x900 and confirming a 4+ tile rung-2 run reads as one shelf with a single cliff face on its outer boundary; the board-rect histogram must not move more than ~2 mean L points and mean HSV saturation must stay <= 0.16. Separately, and cheaply: (1) close the residual picker leak by making `hexSelfCheck` test point-in-projected-top-face before crediting a sample to the tolerant `occluded` bucket \u2014 0.37-0.65% of interior samples currently get an answer whose drawn face does not contain them, at every host including 1600x900, and that is the same hole shape as the original bug; (2) correct the comment above `hexSelfCheck` and the writeup to say deadCentres/ok:false occur at 1440x900, 1200x800, 1000x800 and 390x844 as well as 1100x780, because \"one exotic host\" will read as a generator regression to the next person who runs it on a laptop."
  },
  {
    "key": "objectives",
    "name": "Control-point MP double tick",
    "gap": "THE DOUBLE-COUNT TRAP IS PRESENT \u2014 in multiplayer, not in single-player. The builder keyed the tick on `who` instead of `turnNumber`, which correctly defeats the trap the CONTRACT describes, but there is a second, unguarded path: `startTurn` is reached TWICE for the same logical side in one multiplayer round. `USE_COLYSEUS_MP` is `false` (public/index.html:45134), so `_mpColEnd` at :151732 is false and `onEndTurn` runs the full local `endPlayerTurn(App.state)` -> `startTurn(s,'ai')` \u2014 ticking the OPPONENT's side on MY client. That state is then broadcast; the opponent adopts it wholesale at :183603 (`App.state = swapped`, and cpScore/cpStreak are adopted, not private like `player`), and immediately runs the TURN-START ON FLIP block at :183656-183667 -> `startTurn(App.state,'player')` \u2014 ticking the same side a second time on their client. Executed and measured in real Chromium with `App.battlePrep.multiplayer = true` and instrumented tick counts: `A-client: after onEndTurn ticks player=0 ai=1 ... score P0/A1`; the swapped snapshot arrives at B as `score P1/A0`; after B's turn-start-on-flip, `ticks player=1 ... score P2/A0`. One turn, one side, TWO ticks. With the opponent holding two trucks the divergence is on the match-ending number: `round 1: A-client says opponent streak=1 score=2 || B-client says OWN streak=2 score=4`. Streak advances +2 per round on a player's own client and +1 per round on their opponent's, so a multiplayer client reaches `CP_STREAK_TO_WIN` after two of its own turns instead of three, stamps `gameOver` and shows the victory overlay while the opponent's board still reads streak 1 with the match live. That is a wrong winner plus a client desync on the one condition that ends the match without a hero dying \u2014 the exact silent failure the brief asked me to look for, and the builder's `howVerified` covers only the single-player loop.",
    "fix": "Make the control-point tick fire for the LOCAL side only in multiplayer, and prove it with a counter. In `_cpTickControlPoints` (public/index.html:78753), immediately after the existing `if (who !== 'player' && who !== 'ai') return;`, add a guarded early return: `try { if (App.battlePrep && App.battlePrep.multiplayer && who !== 'player') return; } catch (e) {}` \u2014 with a comment stating WHY, quoting the two call sites by line: in MP each client is authoritative for its own turn-start, and the remote client runs its own at index.html:183656-183667 after adopting our snapshot at :183603, so ticking `'ai'` locally from `endPlayerTurn` (reached because `USE_COLYSEUS_MP` is false at :45134, so `_mpColEnd` at :151732 is false) applies the same score and streak increment a second time to state the opponent has already banked. Record the rejected alternative in the same comment: a `state._cpTickedFor = {player:n, ai:n}` turnNumber stamp does NOT work, because the sender bumps `turnNumber` at :151758 AFTER its tick, so the receiver sees a different number and ticks anyway. The opponent's score and streak still reach us \u2014 they ride the adopted snapshot, and `swapBattlePerspective` already flips `cpScore`/`cpStreak`/`holder`/`scored`. Then re-run the two-client proof: instrument `window._cpTickControlPoints`, run `onEndTurn()` with `App.battlePrep.multiplayer = true`, feed the result through `swapBattlePerspective` and the verbatim flip guard, and assert the same side is ticked exactly ONCE per round and that both clients report the same `cpStreak` after three rounds. Second, name-and-fix the follow-on: the AI has zero references to `controlPoints` anywhere in `public/index.html` or `public/src/battle/*.js`, and a six-round run of the real `doAIStep` controller ended with `ai max trucks ever held = 0, ai score 0` while its units sat 3 hexes from the nearest truck \u2014 so as shipped every single-player battle in the game now has an uncontested alternate win, which is a difficulty regression to battles this wave was not supposed to touch. That needs an objective weight in the AI target scorer before the mode is balanced; it is honestly disclosed in knownGaps but it is not a gap that can ship."
  },
  {
    "key": "ruins",
    "name": "Ruin placement mirroring",
    "gap": "The height-aware back-row keep-out added this round is applied in the SENDER's coordinate frame only, and `_mirrorAllPositions` flips every structure 180\u00b0 for the multiplayer guest. By pushing all five ruins down the board to protect the host's framing, `_rollStructurePlacements` now deposits them precisely on the rows that mirror onto the guest's cropped top rows. Measured over 400 seeds against the game's real `.board-area` rect at a 2560x1080 window (1762x868, where a 2.85-unit church is cropped on rows 0-5): the rule cuts host-side church crops to 85/400 seeds but raises guest-side crops to 315/400 \u2014 worse than the 296/400 the same board produced with the rule disabled entirely. The decapitated church the keep-out exists to kill is still shipping; it has simply been moved onto the other player's screen, where the builder never looked. Secondary, in the same line of code: the step table under-shoots by two rows even in its own calibration frame (church head Y is -86.8 at row 3, -35.5 at row 4, clearing only at row 5).",
    "fix": "Make the keep-out symmetric, in public/index.html inside `_rollStructurePlacements` (grep `HARD reject, on every attempt`). Replace `if (c.y < Math.min(_structMinRow(kind, elevAt ? elevAt[c.x + ',' + c.y] : 0), rowCap)) continue;` with a band that rejects BOTH the host row and the mirrored row, reading the mirrored tile's own elevation because the guest generates terrain from the same seed un-mirrored:\n\n    const _mx = W - 1 - c.x, _my = H - 1 - c.y;\n    const _floorH = Math.min(_structMinRow(kind, elevAt ? (elevAt[c.x + ',' + c.y] || 0) : 0), rowCap);\n    const _floorG = Math.min(_structMinRow(kind, elevAt ? (elevAt[_mx + ',' + _my] || 0) : 0), rowCap);\n    if (c.y < _floorH) continue;   // cropped on the placer's own screen\n    if (_my  < _floorG) continue;  // cropped on the GUEST's screen after _mirrorAllPositions\n\nand record in the comment WHY the second test exists \u2014 that `_mirrorAllPositions` (index.html:181955) flips structures for the remote client, and that the one-sided rule measured 315/400 guest crops against 296/400 with no rule at all. Then raise `_STRUCT_ROW_STEPS` by the two rows the projector says are missing (church needs row >= 5, not 3, at 1600x900 full-viewport), and prove it with a 400-seed sweep that reports host AND guest violation counts side by side plus `seedsShortOfFive:0` \u2014 the symmetric band for a church on a 12-row board is tight, so if the relax ladder cannot fill it, widen the ladder rather than dropping a building. If the symmetric band genuinely cannot hold five ruins, say so out loud and take the other road instead: drop the row rule entirely and clamp the DRAWN height inside `drawStruct` so a billboard's head can never project above the canvas top \u2014 that is frame-correct on every window shape and in both coordinate frames at once, and it costs no board rows."
  }
]

const RECHECK = {
  stage: [
    'You are a FRESH-CONTEXT CRITIC for the terrain render. Verify the named gap is closed:',
    'the field must read as terraced GROUND, not as 168 loose hex counters.',
    '1. Capture and READ both scenes yourself:',
    '   node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" /tmp/s1.png 1600 900',
    '   node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=skirmish&shot=1" /tmp/s2.png 1600 900',
    '   Zoom into a run of same-elevation tiles. Is there still a hard light-to-dark step and a',
    '   black seam at every internal boundary? Measure pixel values across such a boundary and',
    '   report the numbers.',
    '2. THE GRID MUST STILL BE LEGIBLE. This is a tactics game — BAR R2 requires discrete,',
    '   readable cells. If the seam removal made the cells disappear, that is a different',
    '   failure, not a success. Confirm a player can still see where one hex ends and the next',
    '   begins, and say how.',
    '3. Confirm cliff edges KEPT their seam, lip and full ramp — that boundary is what earns',
    '   the terrace read.',
    '4. REGRESSION: zero unclickable tiles must still hold. Run your own sampling sweep across',
    '   viewport sizes and seeds. node _synckcheck.mjs clean. Frame cost measured.',
  ].join('\n'),
  objectives: [
    'You are a FRESH-CONTEXT CRITIC for the control-point tick. Verify the named gap is closed:',
    'the per-turn score must increment EXACTLY ONCE per side per round in BOTH single-player',
    'and multiplayer.',
    '1. EXECUTE IT, do not read it. Instrument the tick with a counter and drive real turns in',
    '   real Chromium. Report the actual counts you observed for: single-player, and the',
    '   multiplayer path where one client runs endPlayerTurn locally, broadcasts, and the',
    '   remote client adopts the snapshot and runs its own turn start. The reported bug was',
    '   that the opponent\'s side gets ticked on MY client and then again on theirs.',
    '2. Verify the whole rule still holds after the fix, by execution: holding adds a point,',
    '   losing subtracts one, two-of-three for three CONSECUTIVE turns wins, a streak broken',
    '   at turn 2 RESETS. Paste turn-by-turn numbers.',
    '3. Verify the win still fires in a NORMAL battle and survives the render pass.',
    '4. REGRESSION: ordinary hero-death victory still works; the turn loop is otherwise',
    '   unchanged. node _synckcheck.mjs clean.',
  ].join('\n'),
  ruins: [
    'You are a FRESH-CONTEXT CRITIC for ruin placement. Verify the named gap is closed: the',
    'keep-out that stops a ruin being cropped off screen must be SYMMETRIC, so it protects the',
    'multiplayer guest (whose board is mirrored 180 degrees) as well as the host.',
    '1. EXECUTE THE MEASUREMENT the previous critic did, yourself, over many seeds: for each',
    '   seed, compute host-side crops and guest-side crops after the 180-degree mirror, at a',
    '   realistic window size. Report both counts. Guest-side crops must not be worse than',
    '   host-side, and neither should be worse than with the rule disabled.',
    '2. Confirm the five ruins are still deterministic from the seed, still off deployment',
    '   zones, still reachable, and still cannot bury a tile.',
    '3. Confirm looting still opens the REAL _lootGridOpen and the full interaction works',
    '   (open, drag, rotate on R, take-all, and dragging your OWN loot into the container).',
    '   Drive it in real Chromium.',
    '4. Look at the school specifically — the earlier gap was that a stranger could not name it.',
    '   Capture the ruins scene, READ it, and say whether the school is now identifiable and',
    '   distinct from the hospital at silhouette distance.',
    '5. REGRESSION: tombstone looting unchanged. node _synckcheck.mjs clean.',
  ].join('\n'),
}

phase('Rework')

const done = await pipeline(
  TASKS,
  t => agent(
    COMMON +
    'You are the builder for: ' + t.name + '.\n' +
    'An independent critic inspected the real output and named exactly one gap.\n\n' +
    'BIGGEST GAP:\n' + t.gap + '\n\n' +
    'FIX DIRECTIVE (the critic was specific; follow it unless you can show it is wrong,\n' +
    'in which case say so explicitly and explain):\n' + t.fix + '\n\n' +
    'Close that gap and nothing else. Do not restart, do not widen scope, do not regress\n' +
    'anything already working. Then re-verify BY EXECUTING — capture and READ images for\n' +
    'visual work, and instrument and run the real code for behavioural work. A claim you\n' +
    'did not execute is not verification.',
    { label: 'fix:' + t.key, phase: 'Rework', schema: BUILD_RESULT }),
  (built, t) => agent(
    COMMON + RECHECK[t.key] +
    '\n\nThe gap you are checking was:\n' + t.gap +
    '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2) +
    '\n\nName ONE biggest remaining gap with an actionable fixDirective. A fix that closes the\n' +
    'gap but regresses something already working is "fail".',
    { label: 'recheck:' + t.key, phase: 'Recheck', schema: VERDICT })
    .then(v => ({ key: t.key, verdict: v })),
)

const results = done.filter(Boolean)
results.forEach(r => log(r.key + ': ' + r.verdict.verdict + ' — ' + String(r.verdict.biggestGap).slice(0, 120)))

phase('Sweep')

const sweep = await agent(
  COMMON + [
    'You are the BATTLEFIELD FUNCTION INVENTORY GATE. This exists because of a standing,',
    'binding user constraint quoted at the end of BAR.md:',
    '  "I want to make sure I keep all of the functions of the battlefield... keep all of the',
    '   gameplay the same but for this battlefield and new changes."',
    '',
    'Several waves of work have changed the board from an 8x7 square grid to a 14x12 hex',
    'field with generated terrain, ruins and control points. Your job is NOT to admire it.',
    'Your job is to find what BROKE.',
    '',
    'STEP 1 — INVENTORY. Build the list of every battlefield function that existed before',
    'this work, by reading the code, not by guessing. At minimum: summon/placement, movement,',
    'attack and counterattack, ranged and AoE, abilities and passives, consumables, fusion,',
    'traps, walls, tombstones and tombstone looting, the hover action menu and each of its',
    'rows, unit details, the hand and side rail, end turn, surfaces/status effects, the AI',
    'turn, replays, and the multiplayer broadcast. Add anything else you find.',
    'Write the inventory to ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md with, for each entry,',
    'the entry-point function and file:line.',
    '',
    'STEP 2 — TEST EACH ONE. For every entry, establish whether it still works on the new',
    'board. Prefer executing the real function in real Chromium over reading it. Where you',
    'genuinely cannot execute something (needs a live Supabase session, needs two clients),',
    'say so explicitly and reason from the code instead — but be honest about which is which.',
    'Pay special attention to anything that could have assumed:',
    '  - an 8x7 board, or any fixed dimension',
    '  - eight neighbours instead of six',
    '  - a square distance metric',
    '  - flat ground (elevation is new: does anything place, project or path assuming y=0?)',
    '  - that every tile is empty ground (ruins and control points now occupy tiles)',
    '',
    'STEP 3 — REPORT. Return plain text:',
    '  VERDICT: clean / broken',
    '  Then a table of every function: WORKS / BROKEN / UNTESTABLE-HERE, with evidence.',
    '  Then every breakage with file:line and the smallest fix.',
    'Do not fix anything yourself — report. Being thorough matters more than being reassuring;',
    'a sweep that finds nothing is only useful if you actually tried to break things.',
  ].join('\n'),
  { label: 'sweep:functions', phase: 'Sweep' })

return { results: results.map(r => ({ key: r.key, verdict: r.verdict.verdict, gap: r.verdict.biggestGap })), sweep }
