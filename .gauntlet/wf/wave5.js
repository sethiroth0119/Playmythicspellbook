export const meta = {
  name: 'hexfield-wave5',
  description: 'Free camera and terrain seam fixes; replay/MP/displacement breaks; then XCOM path arrows',
  phases: [
    { title: 'Build', detail: 'camera + seams (stage) and the three breaks (game), disjoint files' },
    { title: 'Critique', detail: 'fresh critics execute rather than read' },
    { title: 'Telegraph', detail: 'XCOM move-route and attack-arc arrows' },
    { title: 'Rework', detail: 'close the named gaps' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/BAR.md               <- the quality bar. The "Standing constraint"',
  '                                            section at the end is binding on every piece.',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md          <- architecture brief',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md <- what works today and what is broken, with',
  '                                            per-function evidence. Do not re-break anything',
  '                                            this file marks WORKS.',
  '  ' + ROOT + '/.gauntlet/README.md            <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'STATE (committed d4a8f11): a 14x12 pointy-top hex field, seeded post-apocalyptic terrain',
  'with real elevation and cliff faces, five lootable ruins that open the real _lootGridOpen,',
  'three SCP-truck control points with a per-turn score and a hold-two-of-three victory.',
  '',
  '!! FILE-SHARING RULE — ANOTHER BUILDER MAY BE EDITING THE OTHER FILE RIGHT NOW.',
  '- Use ONLY targeted Edit-tool edits on public/index.html and public/battle-board/index.html.',
  '- NEVER read a whole file and write it back; NEVER use a script that rewrites either file',
  '  wholesale. That silently destroys the other builder\'s work.',
  '- Stay in the file your brief assigns you.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- Line numbers drift. Verify every one yourself.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
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

/* ══════════ TRACK A — free camera + the seam that survived ══════════ */

const A_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html and public/battle-board/_harness.html.',
  'You may make ONE small additive edit to public/index.html to forward key events (see #1).',
  '',
  '── #1 THE FREE CAMERA. User requirement 2, still entirely unbuilt: ──',
  '   "Make it where players can move the camera around the map with wasd, and turn the',
  '    camera with q/e."',
  '',
  'There are NO camera controls today. CONFIG.camera is never mutated at runtime and',
  'buildCam() is called from exactly one place. What that means in practice (CONTRACT section',
  '2, Tier 2) — every one of these is a real trap, verify each yourself:',
  ' - INPUT. The stage is an IFRAME and cannot reliably receive its own key events; the host',
  '   already forwards pointer input over the bridge. Add a "board:camera" inbound message and',
  '   forward WASD/QE from the host the same way. ⚠ It MUST NOT steal keys while the player is',
  '   typing — chat, any input/textarea/contenteditable, or an open modal. Check what the app',
  '   already does about this and match it.',
  ' - PAN AND YAW ONLY. Do not add pitch. Roughly eleven ground-ellipse squashes are hardcoded',
  '   to the current pitch and would all break; the user asked for move and turn, not tilt.',
  ' - THE BAKED GROUND. terrainKey() keys the cached static ground on VIEW.cx/cy/scale, map',
  '   dims, ground art and light — but NOT on camera position or yaw. Add a camera and the',
  '   baked ground stays nailed to the screen while units, props and shadows slide over it,',
  '   silently, with nothing thrown. This is the single most likely way this piece ships',
  '   broken.',
  ' - THE PAINTER SORT is z-ascending. Under yaw, draw order must follow camera-space depth,',
  '   not world z, or props and units will occlude each other wrongly as you turn.',
  ' - drawGroundSlices bands at constant world Z; the sky/backdrop is screen-anchored; unit',
  '   facing and the ground-circle radius idiom all assume the fixed camera. Fix each, or',
  '   state honestly which you could not and what it looks like.',
  ' - PICKING MUST STAY EXACT. project() and pickTile() are general, but nothing asserts they',
  '   agree under a moved camera. Re-run the round-trip and the click probe AT SEVERAL PAN',
  '   OFFSETS AND YAW ANGLES, not just the default pose. This is the whole reason the board is',
  '   trustworthy today; do not let the camera quietly break it.',
  ' - BOUNDS. Clamp the pan so the player cannot fly off and lose the board, and make the',
  '   camera resettable. Keep it smooth (velocity/easing), not a per-keypress jump.',
  '',
  '── #2 THE BLACK RULE BETWEEN FLUSH TILES ──',
  'The per-edge seam gate landed, but the seam was removed from the STROKE and not from the',
  'GEOMETRY. paintTileRec draws each tile top with tilePoly(x,z,TILE_INSET,e), and TILE_INSET',
  '(0.008) shrinks the polygon toward its own centre on all six edges — so two flush',
  'neighbours\' tops never touch and a ~0.7-1.4 CSS px trench of near-black under-layer shows',
  'between them. Measured on flush same-material edges the notch is median 48.8 L deep on',
  'gamemap and 82.4 L on skirmish — DEEPER than the 66.9 L that marks an actual cliff. Forcing',
  'the inset to 0 collapses it to 4.1 L and changes the cliff profile by under 1.5 L, which',
  'proves the trench is all that is left and that removing it is free.',
  'Fix it so a run of flush tiles paints as one continuous shelf. ⚠ BUT the grid must stay',
  'LEGIBLE — this is a tactics game and BAR R2 requires readable cells. Cells should read as a',
  'light overlay ON the ground, not as the ground being cut into counters. Show both in your',
  'captures: a joined shelf AND visible cells.',
  '',
  '── #3 TWO TILES PROJECT OFF THE CANVAS (a real bug) ──',
  'fitAim computes the board\'s screen extent but only uses it to CENTRE, never to check the',
  'board FITS, and it samples the flat plane so terrain relief is invisible to it. Tiles',
  '(0,10) and (13,11) land outside the canvas at 1366x768, 1600x900 and 1920x1080 — real mouse',
  'clicks there hit the page background and produce no board:tileClick at all. They are fully',
  'legal tiles: getValidMoves offers (0,10) as a destination, so the rules will send a unit',
  'somewhere the player can neither see nor click.',
  'Sample at the tile\'s real elevation and dolly out when the projected half-width exceeds the',
  'frame. Then prove ALL 168 tile centres are inside the canvas at several viewport sizes —',
  'and, since you are adding a camera, at several camera poses too.',
  '',
  'VERIFY — required, paste real output:',
  '  cd ' + ROOT + ' && node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" /tmp/a5-ship.png 1600 900',
  '  cd ' + ROOT + ' && node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=skirmish&shot=1" /tmp/a5-skir.png 1600 900',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  'READ both PNGs. Then drive the camera in real Chromium: pan with WASD, yaw with Q and E,',
  'capture at a rotated pose, READ that image, and confirm the ground rotated WITH the board',
  'rather than staying nailed to the screen. Report the click round-trip failure count at each',
  'pose (must be 0) and a measured frame cost.',
].join('\n')

const A_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the free camera and the terrain seam. You did not build',
  'this and owe it nothing.',
  '',
  '1. DRIVE THE CAMERA YOURSELF in real Chromium. Send WASD and Q/E, capture at several poses,',
  '   and READ the images. Specifically hunt the failure the brief predicted: does the baked',
  '   static ground rotate and pan WITH the board, or does it stay nailed to the screen while',
  '   units and props slide over it? Look at a rotated capture and say what you see.',
  '2. PICKING UNDER A MOVED CAMERA is the thing most likely to be silently wrong. Run your own',
  '   round-trip and real-click probe at the default pose AND at several pan offsets and yaw',
  '   angles. Report failure counts per pose. Any pose where a click resolves to the wrong',
  '   hexagon is a "fail" — that is the guarantee the whole board rests on.',
  '3. DRAW ORDER under yaw: turn the camera 180 degrees and check props and units occlude each',
  '   other correctly. A z-ascending sort looks right at the default pose and inverts when you',
  '   turn around.',
  '4. KEY THEFT: confirm WASD does not type-jack. Focus a text input in the host page and',
  '   confirm typing "was" does not move the camera.',
  '5. THE SEAM: zoom into a run of flush same-elevation tiles and measure the pixel notch',
  '   depth across the boundary. Report the number. Then confirm cells are STILL LEGIBLE —',
  '   a shelf that joined by making the grid invisible has traded one failure for another.',
  '6. THE OFF-CANVAS BUG: verify all 168 tile centres are inside the canvas at several',
  '   viewports AND camera poses, by real clicks, not by projection maths alone.',
  '7. REGRESSION per BAR.md standing constraint and FUNCTION-INVENTORY.md: nothing marked',
  '   WORKS may have broken. node _synckcheck.mjs clean, frame cost measured not claimed.',
  '',
  'Name ONE biggest remaining gap with an actionable fixDirective.',
].join('\n')

/* ══════════ TRACK B — the three game-side breaks ══════════ */

const B_BUILD = COMMON + [
  'YOU OWN: public/index.html. Do not edit public/battle-board/index.html — another builder is',
  'in it. New files under public/src/battle/ are fine.',
  '',
  'The gauntlet\'s function-inventory gate found three confirmed breaks. Fix all three. Each',
  'has measured evidence in .gauntlet/FUNCTION-INVENTORY.md — read it first.',
  '',
  '── #1 REPLAYS RENDER A BOARD THAT NEVER EXISTED ──',
  'cloneStateLight is an ALLOW-LIST and the new battlefield is not on it. The replay snapshot',
  'drops structures, controlPoints, cpScore, cpStreak, tombstones, _bbMapSeed, heroUltimates',
  'and heroEmotions. Measured: a replay renders 0 ruins, 0 trucks, no control-point track and',
  'no objective banner against 5/3/yes/yes live, and the map seed re-rolls to a DIFFERENT',
  'number so the replay draws different terrain. Nothing throws, because every consumer is',
  'guarded — it silently replays a match on a board that never existed.',
  'Fix the allow-list. Then ask the harder question and answer it in a comment: an allow-list',
  'that silently omits new state will do this again to the next person. Is there a cheap guard',
  '(a dev-time warning when a state key is neither allowed nor explicitly denied)? Add it if it',
  'is genuinely cheap; if not, say why.',
  '',
  '── #2 DISPLACEMENT STEPS A SQUARE DIAGONAL ON A SIX-DIRECTION LATTICE ──',
  'knockback, pull, the vortex/shockwave AoE, and _slideOnIce all pick their direction with',
  'Math.sign(dx)/Math.sign(dy). On odd-r that is a real neighbour from one row parity and HEX',
  'DISTANCE 2 from the other, and it steps OVER occupied tiles. Measured with the real',
  'executeMove and knockback 1: (6,7) shoved toward (7,6) landed on (8,5), two hexes away —',
  'and it still landed there with an enemy standing on (7,5), the true neighbour in that',
  'direction.',
  'Fix: one hexStepToward(from, aim) helper beside hexDirs that picks the neighbour best',
  'aligned with the aim direction, re-picked at each step, applied at all four call sites.',
  '⚠ This IS rules-visible combat behaviour. The standing "do not touch combat" rule exists to',
  'stop gratuitous change, not to leave a break in place — this break was CAUSED by the hex',
  'conversion, so fixing it is restoring the intended behaviour, not altering it. Say so in the',
  'comment, and make the fix minimal and legible. Half of this is already disclosed in a',
  'comment at the knockback site; the vortex copy is disclosed nowhere.',
  '',
  '── #3 A CONTROL-POINT VICTORY NEVER ENDS A MULTIPLAYER MATCH ──',
  'The tick arithmetic is correct and identical on both clients, but nothing carries the',
  'VERDICT across. Measured: the winner stamps gameOver at its own turn start, broadcasts',
  'nothing afterwards, and is shown "Confirming result... Server-authoritative verdict',
  'incoming" for up to 25s instead of the victory overlay — because the unambiguous-ending',
  'test only recognises a DEAD HERO. _mpResultIsLegitimate then REFUSES the submit for the',
  'same reason (zero mp_resolve_match invokes, console "submitMatchResult REFUSED — no hero is',
  'actually dead") while nulling gameOver, so the render re-stamps it in a loop. The loser sits',
  'on streak {player:0, ai:2}, no gameOver, isWaitingForOpponent() true, and no overlay —',
  'frozen forever, on exactly the condition the user asked for: a way to win without killing a',
  'hero.',
  'Fix it so a control-point victory is a legitimate, submittable ending in multiplayer. The',
  'end-of-match path is security-sensitive — it is what stops a client claiming a win it did',
  'not earn — so do NOT simply make _mpResultIsLegitimate permissive. Make it recognise this',
  'specific, verifiable ending (the streak state is in the broadcast state both clients hold),',
  'and say in a comment why that is safe and what you rejected.',
  '',
  'VERIFY — required, paste real output. EXECUTE, do not read:',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  ' - Replay: build a live state with ruins, trucks, scores and a seed; clone it; render the',
  '   clone; report the ruin count, truck count and seed on BOTH sides. They must match.',
  ' - Displacement: run the real executeMove with knockback from BOTH row parities and report',
  '   the landing tile and its hex distance (must be 1), including the case where the true',
  '   neighbour is occupied (it must not pass through).',
  ' - MP victory: drive the two-client path and report what each side actually sees. The winner',
  '   must get a victory overlay and a submitted result; the loser must not freeze.',
].join('\n')

const B_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for three bug fixes in public/index.html. You did not build',
  'them. Each was found by measurement, so re-measure — do not read the code and agree.',
  '',
  '1. REPLAY: construct a live state with ruins, control points, scores, streaks and a map',
  '   seed, clone it through the real cloneStateLight, and diff. Report every key still lost.',
  '   Then render the clone and confirm the replay board actually shows the ruins and trucks',
  '   and the SAME terrain seed. A fix that adds the keys but leaves the seed re-rolling has',
  '   not fixed it.',
  '2. DISPLACEMENT: run the real executeMove yourself with knockback and pull, from BOTH row',
  '   parities, in all six directions, and report the hex distance of every landing (all must',
  '   be 1). Include the blocked case: with the true neighbour occupied, the unit must not end',
  '   up behind it. Check the vortex and ice-slide call sites too — the report may have fixed',
  '   only the ones that were disclosed.',
  '3. MP VICTORY: drive it. The winner must see a victory overlay and an actual submitted',
  '   result; the loser must see a defeat, not a frozen wait. Report what each side saw.',
  '   THEN CHECK THE SECURITY SIDE: can a client now claim a control-point win it did not',
  '   earn? Try to construct one. If the legitimacy test became permissive, that is a "fail"',
  '   even though the feature works.',
  '4. REGRESSION per BAR.md standing constraint and FUNCTION-INVENTORY.md: nothing marked',
  '   WORKS may have broken — especially the ordinary hero-death victory, which shares this',
  '   code path. Test it. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest remaining gap with an actionable fixDirective.',
].join('\n')

/* ══════════ Telegraph ══════════ */

const T_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html (drawing) and public/index.html (the path data the',
  'drawing needs). The camera work has already landed in the stage file — read it and follow',
  'its patterns; in particular, anything you draw in world space must survive camera pan and',
  'yaw.',
  '',
  'PIECE: THE XCOM TELEGRAPH. User requirement 9, restated by them mid-run and binding:',
  '  "when a unit or hero moves have a arrow show where they are going or where they are',
  '   attacking like how games like xcom have it."',
  '',
  'Three things, per BAR.md R3 and R2:',
  ' 1. MOVE RANGE AS A CONTOUR, not a checkerboard. One continuous glowing polygon traced',
  '    around the whole reachable region on the ground, following the terrain. XCOM draws the',
  '    boundary, not the cells. The reachable set already exists — getValidMoves. You need the',
  '    outline of that set on a hex lattice: collect the edges of reachable tiles whose',
  '    neighbour across that edge is NOT reachable, and chain them into loops (there can be',
  '    more than one loop, and holes — walls and occupied tiles make them).',
  ' 2. A PATH ARROW ALONG THE ACTUAL ROUTE. From the unit to the hovered tile, following the',
  '    real path the unit will walk, ending in a destination marker. ⚠ IT MUST USE THE GAME\'S',
  '    OWN PATH — getMovePath — not a straight line and not your own re-derivation. A drawn',
  '    route that differs from the route walked is the UI lying about the rules, which is the',
  '    exact bug class this whole effort has been hunting. If getMovePath is not reachable from',
  '    the stage, pass the real path over the bridge.',
  ' 3. AN ATTACK ARC to the target: a curved line from attacker to target drawn above the',
  '    board, coloured by ownership, with a marker on the target. Not a straight laser (BAR R2',
  '    names that as a fail).',
  '',
  'It must be readable on the new terrain: over cracked asphalt, up a cliff face, and against',
  'the muted palette. It must not obscure the units. And it must fit the existing battle chrome',
  '(CONTRACT section 6 for the exact tokens) rather than looking bolted on.',
  '',
  'KEEP EVERYTHING WORKING: the existing move/attack tile highlights are what the game uses',
  'today and other code depends on the PAINT sets. Add the telegraph as a layer; do not rip',
  'out the existing feedback unless you can show nothing else needs it.',
  '',
  'VERIFY — required, paste real output. Capture a scene with a unit selected showing the',
  'contour and a path arrow to a hovered tile, and one showing an attack arc; READ both back.',
  'Then prove the path arrow matches getMovePath exactly for a set of source/destination pairs',
  'including one that must route AROUND a wall — a straight-line arrow will pass through it and',
  'that is the failure to look for. Capture at a rotated camera pose too.',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const T_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the XCOM telegraph. You did not build it.',
  '',
  '1. LOOK AT IT. Capture a selected unit with its move contour and a path arrow, and an attack',
  '   arc, and READ the images. Is the range a single traced CONTOUR or is it still a',
  '   checkerboard of tinted cells? Is the attack an ARC or a straight line? BAR R2 and R3 name',
  '   both of those as fail conditions.',
  '2. THE PATH MUST BE THE REAL PATH. Pick source/destination pairs where the true route must',
  '   detour — around a wall, around an occupied tile, around a blocked cliff — and confirm the',
  '   DRAWN arrow follows the same tiles getMovePath returns. Compare tile by tile and report',
  '   any divergence. An arrow that cuts a corner the unit will not cut is the UI lying about',
  '   the rules.',
  '3. Confirm the contour is the boundary of the ACTUAL reachable set, including holes: put a',
  '   wall inside the range and check the contour traces around it rather than over it.',
  '4. CAMERA: pan and yaw the camera and confirm the contour, arrow and arc stay glued to the',
  '   board rather than to the screen. Capture at a rotated pose and READ it.',
  '5. READABILITY: can you follow the arrow over cracked asphalt and up a cliff? Does it',
  '   obscure the units? Does the chrome match the existing battle UI or look bolted on?',
  '6. REGRESSION per BAR.md standing constraint and FUNCTION-INVENTORY.md: the existing move',
  '   and attack highlights and the PAINT sets must still work. Selection, movement, targeting',
  '   and the hover action menu must be untouched. Test them. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest remaining gap with an actionable fixDirective.',
].join('\n')

/* ══════════ Run ══════════ */

phase('Build')

const TRACKS = [
  { key: 'camera', name: 'Free camera + terrain seam + off-canvas fix', build: A_BUILD, critique: A_CRITIQUE },
  { key: 'breaks', name: 'Replay, displacement and MP-victory breaks', build: B_BUILD, critique: B_CRITIQUE },
]

const r1 = await pipeline(
  TRACKS,
  t => agent(t.build, { label: 'build:' + t.key, phase: 'Build', schema: BUILD_RESULT }),
  (built, t) => agent(
    t.critique + '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
    { label: 'critic:' + t.key, phase: 'Critique', schema: VERDICT })
    .then(v => ({ track: t, verdict: v })),
)

const live = r1.filter(Boolean)
live.forEach(r => log('R1 ' + r.track.key + ': ' + r.verdict.verdict + ' — ' + String(r.verdict.biggestGap).slice(0, 130)))

phase('Telegraph')

const tBuilt = await agent(T_BUILD, { label: 'build:telegraph', phase: 'Telegraph', schema: BUILD_RESULT })
const tVerdict = await agent(
  T_CRITIQUE + '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(tBuilt, null, 2),
  { label: 'critic:telegraph', phase: 'Telegraph', schema: VERDICT })
log('telegraph: ' + tVerdict.verdict + ' — ' + String(tVerdict.biggestGap).slice(0, 130))

phase('Rework')

const all = live.map(r => ({ key: r.track.key, name: r.track.name, brief: r.track.build, critique: r.track.critique, verdict: r.verdict }))
all.push({ key: 'telegraph', name: 'XCOM telegraph', brief: T_BUILD, critique: T_CRITIQUE, verdict: tVerdict })
const todo = all.filter(r => r.verdict.verdict !== 'pass')
log(todo.length + '/' + all.length + ' to rework')

const reworked = await pipeline(
  todo,
  r => agent(
    COMMON +
    'You are the builder for: ' + r.name + '. An independent critic ran your real output.\n\n' +
    'VERDICT: ' + r.verdict.verdict + '\n' +
    'BIGGEST GAP: ' + r.verdict.biggestGap + '\n' +
    'FIX DIRECTIVE: ' + r.verdict.fixDirective + '\n' +
    'REGRESSIONS: ' + JSON.stringify(r.verdict.regressions || []) + '\n\n' +
    'Close that gap. Do not restart, do not widen scope, do not regress anything already\n' +
    'working. Re-verify BY EXECUTING, exactly as the original brief demanded.\n\n' +
    'Original brief:\n' + r.brief,
    { label: 'rebuild:' + r.key, phase: 'Rework', schema: BUILD_RESULT }),
  (rebuilt, r) => agent(
    r.critique + '\n\nROUND 2. The gap named last round was:\n"' + r.verdict.biggestGap + '"\n' +
    'Verify it is ACTUALLY closed by running the thing yourself, then look once more for what\n' +
    'the fix broke. A fix that closes the gap but regresses something is "fail".\n\n' +
    'Builder round-2 claim:\n' + JSON.stringify(rebuilt, null, 2),
    { label: 'recritic:' + r.key, phase: 'Rework', schema: VERDICT })
    .then(v => ({ key: r.key, verdict: v })),
)

const out = {}
all.forEach(r => { out[r.key] = { r1: r.verdict.verdict, gap1: r.verdict.biggestGap } })
reworked.filter(Boolean).forEach(r => { out[r.key].r2 = r.verdict.verdict; out[r.key].gap2 = r.verdict.biggestGap })
return out
