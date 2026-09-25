export const meta = {
  name: 'hexfield-wave5',
  description: 'Free camera, XCOM path arrows, the multiplayer mirror fix, and a full regression gate',
  phases: [
    { title: 'Camera', detail: 'WASD pan, Q/E yaw, and the mirror fix in parallel' },
    { title: 'Telegraph', detail: 'move-range contour, real path arrow, attack arc' },
    { title: 'Polish', detail: 'sprite clarity and UI restyle' },
    { title: 'Gate', detail: 'inventory every battlefield function and verify it still works' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/BAR.md      <- the quality bar. Read the "Standing constraint"',
  '                                        section at the end — it is binding on you.',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md <- architecture brief',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/README.md   <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'STATE (committed at ebdfef5): a 14x12 pointy-top hex field with seeded post-apocalyptic',
  'terrain — real elevation with lit cliff faces, cracked asphalt, dirt, grass, rubble,',
  'standing water, scattered debris props, rain. Five lootable ruins that open the real',
  '_lootGridOpen salvage grid. Three SCP-truck control points with per-turn scoring and a',
  'hold-two-of-three-for-three-turns victory. Both lattices proven to agree; clicks resolve',
  'to the hexagon actually drawn under them.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- NEVER rewrite public/index.html wholesale with a read-all/write-all script. Targeted',
  '  Edit-tool edits only. Another builder may be working in the same file.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- Do NOT touch card, economy, or combat-resolution code.',
  '- No npm dependencies. No new binary art assets — draw procedurally.',
  '- Line numbers in the docs have DRIFTED. Verify each one yourself.',
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

/* ══════════════ CAMERA ══════════════ */

const CAM_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html, public/battle-board/_harness.html, and the',
  'small host-side seam in public/index.html that forwards keyboard input to the stage.',
  '',
  'PIECE: THE FREE CAMERA. User requirement #2, verbatim:',
  '  "Make it where players can move the camera around the map with wasd, and turn the',
  '   camera with q/e. I want the field to have a nice size map."',
  '',
  'There are NO camera controls today. CONFIG.camera is never mutated at runtime and',
  'buildCam() is called from exactly one place. CONTRACT.md section 2 Tier 2 lists what',
  'breaks the moment the camera can move; read it in full. In summary, yaw breaks:',
  ' - the z-ascending painter sort (depth order must come from camera-space depth, not',
  '   from world z, or units and props will draw through each other the moment you turn)',
  ' - drawGroundSlices, which bands the ground at constant world Z',
  ' - the screen-anchored sky/backdrop',
  ' - unit facing and the sprite billboard axis',
  ' - EVERY ground-circle radius that is computed as the projected length of a world-X',
  '   offset — these shrink continuously toward ZERO as you rotate, with no error thrown.',
  '   They must become the projected length of a vector perpendicular to the view, or be',
  '   computed from the tile polygon.',
  '',
  '!! THE LANDMINE A PREVIOUS CRITIC LEFT YOU, IN WRITING:',
  'terrainKey() (public/battle-board/index.html, search for it) keys the BAKED STATIC',
  'GROUND on VIEW.cx / VIEW.cy / VIEW.scale, MAP dims, MAPSIG, ground art and light — but',
  'NOT on camera position or yaw. Add WASD/QE without fixing this and the baked ground',
  'stays nailed to the screen while units, props and shadows slide over it. Silently.',
  'Nothing throws. Fix the key, and say so in a comment.',
  '',
  'INPUT PATH: when the stage is embedded, the canvas cannot receive its own keyboard',
  'events — the host owns focus. The host already forwards pointer input as board:pointer.',
  'Add the same treatment for keys: a board:camera inbound message. Follow the existing',
  'protocol shape exactly; do not invent a different one. The standalone harness should',
  'also drive it directly so the camera can be tested without the game.',
  '',
  'FEEL — this is a tactics game, not a flight sim:',
  ' - WASD pans in the CAMERA plane (W moves the view away from you along the ground,',
  '   not along world Z), so panning still feels right after you have rotated.',
  ' - Q/E yaw around the board centre, smoothly, with acceleration and easing — not a',
  '   snap, and not a raw per-frame delta that makes speed depend on frame rate.',
  ' - Clamp panning so the board cannot be lost off screen entirely. A player who presses',
  '   a key for three seconds and sees nothing but sky will think it is broken.',
  ' - Something must reset the view. Say what key and why.',
  ' - Respect prefers-reduced-motion for the easing.',
  '',
  'DO NOT let the camera break click resolution. pickTile must keep resolving to the',
  'hexagon actually drawn under the cursor at ANY camera angle. This is the single thing',
  'most likely to break and it breaks silently.',
  '',
  'VERIFY — required, paste real output. Capture the board at several camera states:',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  'Drive the camera in real Chromium: pan with WASD, yaw with Q/E, and capture PNGs at',
  'yaw 0, 45, 90, 180 and 270 degrees plus a panned state. READ THEM BACK. Report:',
  ' - whether the ground stays registered with the tiles at every angle (the landmine)',
  ' - the painter-order check: do near objects still draw over far ones after rotating 180?',
  ' - a click round-trip at EVERY captured angle: click known screen points and confirm the',
  '   tile reported is the hexagon drawn there. Report the failure count. It must be 0.',
  ' - measured frame cost while the camera is moving.',
].join('\n')

const CAM_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the free camera. You did not build it.',
  '',
  'DRIVE IT YOURSELF IN REAL CHROMIUM. Do not grade the report.',
  '1. Press the actual keys. W, A, S, D, Q, E. Confirm each does what the user asked:',
  '   WASD moves the camera around the map, Q and E turn it. If any key does nothing, or',
  '   does something other than advertised, that is a "fail".',
  '2. THE ROTATION LANDMINE: capture at yaw 0, 45, 90, 135, 180, 225, 270. READ every PNG.',
  '   Look specifically for: the baked ground staying nailed to the screen while the tiles',
  '   rotate over it; props or units drawing through terrain that should occlude them;',
  '   ground rings/shadows collapsing to slivers or vanishing; the sky sliding wrongly.',
  '3. CLICK RESOLUTION AT EVERY ANGLE. Write your own probe. Click many points at each of',
  '   those yaws and confirm the reported tile is the hexagon drawn under the point. Report',
  '   the exact failure count per angle. Any angle with failures is a "fail" — a camera that',
  '   makes the board unclickable when turned is worse than no camera.',
  '4. Pan to the extremes and confirm the board cannot be lost off screen.',
  '5. Confirm the camera works BOTH standalone in the harness AND through the host input',
  '   path (board:camera), not just one of them.',
  '6. REGRESSION per the standing constraint: all harness scenes render, hex geometry still',
  '   exact, node _synckcheck.mjs clean. Measure frame cost during motion.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ══════════════ MIRROR FIX ══════════════ */

const MIR_BUILD = COMMON + [
  'YOU OWN: public/index.html, EXCEPT the canvas-stage seam another builder is editing this',
  'phase (the board:camera host forwarding). Do not touch public/battle-board/*.',
  '',
  'PIECE: close two open critic findings on the ruins and control points.',
  '',
  'FINDING 1 — THE MULTIPLAYER MIRROR. A critic found: the height-aware back-row keep-out',
  'that protects structure placement is applied in the SENDER coordinate frame only, while',
  '_mirrorAllPositions flips every structure 180 degrees for the receiving client. So the',
  'guarantee holds for one player and not the other: the same match can place a ruin',
  'somewhere the opponent cannot reach or cannot click. Find the real function names and',
  'line numbers yourself (they have drifted), work out whether the correct fix is to apply',
  'the constraint symmetrically or to make the constraint mirror-invariant, and implement',
  'it. State in a comment WHY the naive fix (constraining only the sender) is wrong.',
  'Then PROVE it: generate a map, mirror it, and verify the constraint holds in BOTH frames',
  'for many seeds. Report the seed count and failure count.',
  '',
  'FINDING 2 — THE SCHOOL IS UNIDENTIFIABLE. A critic found that four of the five ruins',
  'carry an unmistakable read — the hospital its red cross, the church its steeple and',
  'arched windows, the car its silhouette, the house its pitched roof — and the school does',
  'not: it is a generic dark box. Give it a read a stranger can name at board scale. Real',
  'schools carry: a long low institutional block with a repeating window bay rhythm, a flag',
  'pole, a marked yard, a clock or a sign above the entrance. Pick the cues that survive',
  'being 60 pixels tall and draw them. Procedural canvas only, no new assets.',
  'You will need to coordinate with the stage file for drawing — that file is owned by',
  'another builder this phase, so if the school drawing lives there, write the change as a',
  'precise patch in your report instead of editing it, and say exactly where it goes.',
  '',
  'VERIFY: cd ' + ROOT + ' && node _synckcheck.mjs, plus the mirror proof above.',
].join('\n')

const MIR_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: the multiplayer structure-mirror fix, and the school ruin readability.',
  '',
  '1. THE MIRROR. Do not read the fix — EXECUTE it. Generate maps across many seeds, apply',
  '   the real mirror function, and check the placement constraint in BOTH coordinate',
  '   frames. Report seeds tested and failures. Any seed where a structure is unreachable',
  '   or unclickable for the mirrored player is a "fail".',
  '   Also check the same class of bug for the THREE CONTROL POINTS, which the original',
  '   finding did not mention: are they mirror-safe? If nobody checked, check now.',
  '2. THE SCHOOL. Capture the ruins scene and READ the PNG. Without being told which is',
  '   which, can you name all five buildings? Say which ones you can and cannot identify.',
  '   If the school still cannot be named, the fix did not work.',
  '3. REGRESSION per the standing constraint. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ══════════════ TELEGRAPH ══════════════ */

const TEL_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html (drawing), public/battle-board/_harness.html,',
  'and the parts of public/index.html that compute and push movement/attack preview state.',
  '',
  'PIECE: THE XCOM TELEGRAPH. User requirement #9, restated by the user mid-run:',
  '  "Just when a unit or hero moves have a arrow show where they are going or where they',
  '   are attacking like how games like xcom have it."',
  '',
  'BAR.md R3 and R2 define the shape:',
  ' - MOVEMENT RANGE AS A CONTOUR, not a checkerboard. One continuous glowing polygon',
  '   traced around the OUTER BOUNDARY of the whole reachable region, drawn on the ground',
  '   and following terrain. A second, dimmer contour for extended/dash range if the game',
  '   has such a concept; if it does not, say so rather than inventing one.',
  ' - A PATH ARROW from the unit to the hovered tile, along THE ACTUAL ROUTE THE UNIT WILL',
  '   WALK, ending in a destination marker. !! This must come from the game real',
  '   pathfinder. A straight line drawn between two points is the UI lying about the rules —',
  '   the exact bug class this whole project has been hunting — because the unit will walk',
  '   somewhere else. Find the real movement/path function in index.html and use it. If the',
  '   game resolves movement without an explicit path, say so plainly and derive the route',
  '   the same way the mover does, so the drawn route and the walked route cannot diverge.',
  ' - ATTACK TELEGRAPHS AS AN ARC from attacker to target, drawn above the board, coloured',
  '   by ownership — not a straight laser (BAR R2).',
  ' - THREAT RANGE as a painted region with a brighter outer edge (BAR R2), distinct in',
  '   colour from your own movement range, so "where I can stand" and "what threatens me"',
  '   are never the same colour.',
  '',
  'The board already has PAINT sets (move / attack / place / swap / sel) pushed from the',
  'host. Read how they are produced and pushed before designing anything — the contour is',
  'a rendering of the SAME set the rules already produce, so the outline can never disagree',
  'with the reachable set. Deriving it independently would reintroduce the disagreement.',
  '',
  'It must work at any camera angle — the camera landed in the previous phase. Contours are',
  'ground geometry and must follow the terrain height, not float at y=0.',
  '',
  'VERIFY — required. Capture scenes showing: a selected unit with its move contour; a',
  'hovered destination with the path arrow along a route that BENDS around an obstacle',
  '(a straight-line path proves nothing — pick a case where the real route must detour);',
  'an attack arc to a target; a threat range. READ every PNG back.',
  'Then PROVE the arrow matches the walk: pick several destinations, capture the drawn',
  'route, execute the real move, and compare the tiles the unit actually traversed with the',
  'tiles the arrow drew. Report the comparison. Any divergence is the bug this piece exists',
  'to avoid.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const TEL_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the XCOM telegraph. You did not build it.',
  '',
  '1. THE CENTRAL CLAIM IS THAT THE ARROW SHOWS THE REAL ROUTE. Test it adversarially.',
  '   Construct board states where the shortest visual line and the actual walkable route',
  '   differ — an obstacle, a wall, a raised tile, a unit in the way, a hex-parity detour.',
  '   For each, compare the tiles the arrow draws against the tiles the unit actually',
  '   traverses when the move executes. Report the comparison per case. ANY divergence is a',
  '   "fail" — that is the UI lying about the rules.',
  '2. Verify the move contour is derived from the SAME reachable set the rules use, not',
  '   recomputed. Try to find a state where the outlined region and the set of tiles the',
  '   game will actually accept a move to disagree.',
  '3. LOOK AT IT. Capture and READ: move contour, path arrow on a bending route, attack arc,',
  '   threat range. Score against BAR R2 and R3, including their fail conditions — range as',
  '   a tile checkerboard, destination-only preview with no route, attack as a straight line.',
  '4. CAMERA: repeat the captures at two or three yaw angles. Contours and arrows must stay',
  '   registered with the ground and must follow terrain height, not float.',
  '5. REGRESSION per the standing constraint: selecting, moving, attacking and targeting all',
  '   still work exactly as before. The telegraph is an overlay; it must not gate input.',
  '   Confirm you can still complete a move and an attack. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ══════════════ POLISH ══════════════ */

const POL_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html, public/src/battle/*.css, and the battle HUD',
  'markup regions of public/index.html.',
  '',
  'PIECE: SPRITE CLARITY AND THE UI. User requirements #3 and #10:',
  '  "I still want to keep the sprite units and hero. Make them look extremely clear and',
  '   high quality on the board."',
  '  "Make the ui where it fits this style and keep all of the game play the same."',
  '',
  'HALF 1 — SPRITES. The units are camera-facing billboards drawn from sprite art. Against',
  'BAR R1: "units are SMALL relative to the map and still perfectly crisp — hard pixel',
  'edges, no blur, strong single-colour silhouettes that separate from the ground."',
  'Work the actual causes of softness, and MEASURE before and after:',
  ' - unrounded translate on the sprite parent (fractional device pixels = resample blur)',
  ' - ctx.shadowBlur applied to the sprite draw',
  ' - imageSmoothing settings for the sprite layer',
  ' - the drawn size versus the source frame size — upscaling a small frame will never be',
  '   crisp, and if that is the real limit, SAY SO rather than pretending otherwise',
  ' - separation from ground: a subtle rim or contact shadow so the silhouette reads',
  ' - OWNERSHIP: BAR R2 wants a directional ring at the feet, blue for mine and red for',
  '   theirs, so ownership reads even when sprites overlap. And R3 wants floating enemy',
  '   nameplates with a segmented health bar.',
  'A previous critic warned that the harness substitutes sprite frames the game may not',
  'have on a cold client — read .gauntlet/README.md on provenance, and make sure you are',
  'tuning against what the GAME actually produces, not against a harness-only best case.',
  '',
  'HALF 2 — THE UI. Restyle the battle HUD so it sits with the post-apocalyptic field',
  'instead of fighting it. CONTRACT.md section 6 has the exact tokens: the .bchrome and',
  '.bcp palettes, Cinzel for labels and EB Garamond for body, the double-gradient panel',
  'border, the .envcard chip, the End Turn button as the loudness ceiling.',
  '!! RESTYLE, NOT REBUILD. Every panel keeps its function and its position. The user said',
  '"keep all of the gameplay the same". Do not move, merge, or remove a panel. Do not',
  'change what any control does. If a panel genuinely cannot be restyled without moving it,',
  'leave it and say why.',
  'Also fold in the objective banner and control-point tracker so they read as part of the',
  'same system rather than bolted on.',
  '',
  'VERIFY: capture the as-shipped gamemap scene and the real battle HUD, READ them back,',
  'and report measured sprite sharpness before and after (e.g. edge gradient across a',
  'silhouette boundary, or the fractional-pixel offset you eliminated).',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const POL_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: sprite clarity and the UI restyle.',
  '',
  '1. MEASURE SHARPNESS, do not eyeball it. Capture at native resolution, crop a unit at',
  '   high zoom, and measure the edge transition across its silhouette in pixels. Compare',
  '   against ' + ROOT + '/.gauntlet/NOW-skirmish.png. Report both numbers. If the builder',
  '   claims crispness improved, prove or disprove it with the measurement.',
  '2. PROVENANCE: confirm the tuning was done against what the GAME sends, not against a',
  '   harness-only substitution. Read .gauntlet/README.md and check which scene was used.',
  '   Tuning sprite crispness against frames the game never produces is a "fail".',
  '3. OWNERSHIP AND NAMEPLATES: can you tell friend from foe at a glance when sprites',
  '   overlap? Is enemy health readable without hovering (BAR R3)?',
  '4. THE UI: capture the battle HUD and READ it. Did every panel keep its function and its',
  '   position? Diff the markup to check nothing was removed or moved. A restyle that',
  '   quietly drops a control is a "fail" under the standing constraint.',
  '5. REGRESSION: node _synckcheck.mjs clean, all harness scenes render.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ══════════════ RUN ══════════════ */

async function round(name, buildBrief, critiqueBrief, phaseName, rounds) {
  let built = null, verdict = null
  const hist = []
  for (let i = 1; i <= (rounds || 2); i++) {
    const p = i === 1 ? buildBrief : (
      COMMON +
      'You are the builder for: ' + name + '. Round ' + i + '.\n' +
      'An independent critic ran your real output.\n\n' +
      'VERDICT: ' + verdict.verdict + '\n' +
      'BIGGEST GAP: ' + verdict.biggestGap + '\n' +
      'FIX DIRECTIVE: ' + verdict.fixDirective + '\n' +
      'REGRESSIONS: ' + JSON.stringify(verdict.regressions || []) + '\n\n' +
      'Close that gap. Do not restart, do not widen scope, do not regress anything already\n' +
      'working. Re-verify by EXECUTING, exactly as the original brief demanded.\n\n' +
      'Original brief:\n' + buildBrief)
    built = await agent(p, { label: 'build:' + phaseName + '-r' + i, phase: phaseName, schema: BUILD_RESULT })
    verdict = await agent(
      critiqueBrief +
      (i > 1 ? '\n\nROUND ' + i + '. The gap named last round was:\n"' + hist[hist.length - 1].biggestGap + '"\nVerify it is ACTUALLY closed by running the thing yourself, then look for anything the fix broke.' : '') +
      '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
      { label: 'critic:' + phaseName + '-r' + i, phase: phaseName, schema: VERDICT })
    hist.push(verdict)
    log(phaseName + ' R' + i + ': ' + verdict.verdict + ' — ' + String(verdict.biggestGap).slice(0, 120))
    if (verdict.verdict === 'pass') break
  }
  return hist
}

phase('Camera')

const camAndMirror = await parallel([
  () => round('Free camera', CAM_BUILD, CAM_CRITIQUE, 'Camera', 2),
  () => round('MP mirror + school ruin', MIR_BUILD, MIR_CRITIQUE, 'Camera', 2),
])

phase('Telegraph')
const tel = await round('XCOM telegraph', TEL_BUILD, TEL_CRITIQUE, 'Telegraph', 2)

phase('Polish')
const pol = await round('Sprite clarity + UI', POL_BUILD, POL_CRITIQUE, 'Polish', 2)

phase('Gate')

const gate = await agent(
  COMMON + [
    'You are the REGRESSION GATE. This is the last check before the work ships, and it',
    'exists because the user said, twice, in their own words:',
    '  "I want to make sure I keep all of the functions of the battlefield."',
    '  "keep all of the game play the same but for this battlefield and new changes"',
    '',
    'Your job is NOT to judge how it looks. Your job is to find what STOPPED WORKING.',
    '',
    'STEP 1 — BUILD THE INVENTORY. From the code as it exists at commit ebdfef5 and',
    'earlier, enumerate every distinct battlefield function the game had before this work',
    'began. At minimum, and add anything you find: summoning a unit from hand, the summon',
    'ceremony, moving a unit, attacking, hero abilities, unit abilities and passives,',
    'consumables, fusion, traps, walls, tombstones (spawn, glow, raise-from-dead, loot),',
    'the loot grid itself, the unit hover action menu and every row in it, unit detail',
    'modals, placement/deployment, the hand strip, the side rail and piles, end turn, the',
    'AI turn, status effects and surface FX, weather, the combat cut-away, activation FX,',
    'draw FX, targeting readout, replays, and the multiplayer broadcast.',
    'For each, record HOW you would tell whether it still works.',
    '',
    'STEP 2 — VERIFY EACH ONE. Prefer executing over reading. Use the harness, drive real',
    'Chromium, call the shipped functions. Where a function genuinely cannot be exercised',
    'in this environment (Supabase-gated multiplayer, for example), say so explicitly and',
    'verify by close code reading instead — and mark it as UNVERIFIED rather than PASS.',
    'Do not mark anything PASS that you did not actually observe working.',
    '',
    'STEP 3 — SPECIFICALLY HUNT for these, which this work makes likely:',
    ' - anything that still assumes an 8x7 board or a square lattice',
    ' - anything that assumes a fixed camera',
    ' - anything that assumes flat ground at y=0',
    ' - any tile that cannot be clicked at any camera angle',
    ' - the DOM board and the canvas stage disagreeing about what is reachable',
    ' - the per-turn control-point tick firing more than once per side per turn',
    ' - deploy knobs out of sync: public/version.txt, window.BUILD_VERSION, sw.js',
    '   CACHE_VERSION must all agree',
    '',
    'STEP 4 — Run cd ' + ROOT + ' && node _synckcheck.mjs and node _harness.js public/index.html.',
    '',
    'Return plain text: a table of every function with PASS / FAIL / UNVERIFIED and the',
    'evidence, then a ranked list of everything broken, then a plain yes/no on whether every',
    'battlefield function that worked before still works. Be blunt and be complete. A gate',
    'that misses a broken feature is worse than no gate.',
  ].join('\n'),
  { label: 'gate:regression', phase: 'Gate' })

return { camera: camAndMirror[0], mirror: camAndMirror[1], telegraph: tel, polish: pol, gate: gate }
