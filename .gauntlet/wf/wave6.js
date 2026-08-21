export const meta = {
  name: 'hexfield-wave6',
  description: 'Close the three regression-gate breaks and the camera occlusion gap',
  phases: [
    { title: 'Breaks', detail: 'square shove, replay snapshot, off-canvas tiles' },
    { title: 'Occlusion', detail: 'units drawing through nearer terrain' },
    { title: 'Gate', detail: 'final function inventory and sign-off' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/OPEN-BREAKS.md  <- the three breaks this wave closes',
  '  ' + ROOT + '/.gauntlet/BAR.md          <- the bar, and the binding "Standing constraint"',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/README.md       <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- NEVER rewrite public/index.html wholesale with a read-all/write-all script.',
  '  Targeted Edit-tool edits only. Another builder may be in the same file.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- No npm dependencies. No new binary art assets.',
  '- Line numbers drift. Verify every one yourself.',
  '- Comments explain WHY, including the bug avoided.',
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

const SHOVE_BUILD = COMMON + [
  'YOU OWN: public/index.html, combat-resolution movement ONLY — the shove/pull/slide',
  'direction code named in OPEN-BREAKS.md finding 1. Do not touch the canvas stage.',
  '',
  'BREAK 1: knockback, pull, vortex and ice-slide shove along a SQUARE diagonal.',
  'Math.sign(dx) / Math.sign(dy) picks one of EIGHT square directions and steps along it.',
  'On a six-direction lattice two of those eight are not directions at all. Measured by the',
  'regression gate: a shove from (6,7) landed the target TWO hexes away, straight through',
  'an enemy standing on the true neighbour — passing through an occupied tile, which no',
  'other movement path in this game permits.',
  '',
  'This was deliberately deferred during the hex conversion because it lives inside combat',
  'resolution, which that wave was forbidden to edit. There is already a comment at the',
  'site admitting it. That deferral is now being paid off deliberately, by you.',
  '',
  'FIX: pick the nearest of the SIX hex directions to the shove vector. Convert the offset',
  'delta to cube space, choose the dominant direction, and step with the canonical',
  'hexNeighbors / hexDirs helpers. DO NOT re-derive an adjacency table at the call site —',
  'that is how the codebase got into this state. Use the one definition.',
  '',
  'This DOES change behaviour, deliberately, and that is the point: today the behaviour is',
  'wrong. State clearly in a comment what changed and why, and note in knownGaps any card',
  'whose description implies a square shove so the text can follow.',
  '',
  'VERIFY BY EXECUTION, not by reading. Reproduce the gate original failure first — set up',
  'the (6,7) shove with an enemy on the true neighbour and watch the target land two hexes',
  'away THROUGH it — then show the same case landing on a real adjacent hex. Sweep every',
  'origin on the board and every shove vector and confirm: the destination is always a hex',
  'neighbour of the origin (or the far end of a multi-step slide along ONE hex direction),',
  'never a tile at distance 2 from a single-step shove, and never through an occupied tile.',
  'Report the sweep size and the failure count.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const SHOVE_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: knockback / pull / vortex / ice-slide direction on the hex lattice.',
  '',
  '1. REPRODUCE THE ORIGINAL FAILURE FIRST. If you cannot make the OLD behaviour fail on',
  '   the pre-fix code, you cannot claim the fix works. Then run the same case on the',
  '   shipped code. Report both.',
  '2. Sweep exhaustively yourself: every origin, every shove vector, both row parities.',
  '   Assert the destination is a genuine hex neighbour (distance 1) for a single-step',
  '   shove, and that a multi-step slide walks ONE hex direction rather than drifting.',
  '   Report sweep size and failures. Any failure is a "fail".',
  '3. NO PASSING THROUGH UNITS OR WALLS. Confirm a shove into an occupied tile behaves the',
  '   way the game handles a blocked shove elsewhere — do not let the fix invent new rules.',
  '   Check what the pre-existing blocked-shove behaviour was and confirm it is preserved.',
  '4. Confirm the fix uses the canonical hex helpers and did NOT re-derive an adjacency',
  '   table locally.',
  '5. REGRESSION: knockback-adjacent effects (vortex, pull, ice) all still resolve; nothing',
  '   in combat resolution beyond direction changed. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

const REPLAY_BUILD = COMMON + [
  'YOU OWN: public/index.html — the replay snapshot and the board framing. Coordinate: do',
  'not edit the shove-direction code another builder owns this phase.',
  '',
  'BREAK 2: REPLAYS RENDER A BOARD THAT NEVER EXISTED.',
  'The replay snapshot is an ALLOW-LIST of state keys. state.structures, the control',
  'points, the objective scores and the MAP SEED are not on it. Nothing throws — the replay',
  'simply generates different terrain, puts the ruins somewhere else, and shows a match',
  'that did not happen. It is the exact failure the seeded generator was built to prevent',
  'between two live clients, reintroduced on the playback path.',
  'FIX: add the new keys to the snapshot, INCLUDING the map seed, so a replay rebuilds the',
  'identical battlefield. Find the allow-list yourself and check whether anything else',
  'added during this project is also missing from it — do not fix only the four named keys',
  'and assume that is the whole set. Enumerate what battle state now exists and diff it',
  'against what the snapshot carries.',
  'VERIFY BY EXECUTION: record a match, replay it, and DIFF the generated map, the ruin',
  'positions, the truck positions and the scores between the live match and the replay.',
  'Reading the allow-list is not verification.',
  '',
  'BREAK 3: TWO TILES PROJECT OFF THE CANVAS, AND THE RULES STILL OFFER ONE AS A MOVE.',
  'Two tiles of the 14x12 board project outside the canvas rect entirely. A real click',
  'there lands on the page background. Yet getValidMoves offers one of them as a legal',
  'destination — so the rules will send a unit somewhere the player can neither see nor',
  'click, and then cannot select it to move it back.',
  'This is the buried-tile bug from the other direction: that one was hidden BEHIND',
  'geometry, this one is OUTSIDE THE FRAME.',
  'FIX AT THE FRAMING LEVEL — the board must fit its host rect with every tile inside it.',
  'Do NOT fix it by removing tiles from getValidMoves: that would make the playable board a',
  'different shape from the drawn board and simply move the lie somewhere else.',
  '!! The camera landed in the previous wave, which makes this sharper: a movable camera',
  'can push any tile off screen. So the rule to enforce is that A TILE THE RULES CONSIDER',
  'PLAYABLE MUST ALWAYS BE REACHABLE BY THE PLAYER — either the board stays framed, or the',
  'camera guarantees the tile can be brought into view. Decide which, implement it, and say',
  'in a comment why the other option was rejected.',
  'VERIFY: sweep every tile at several viewport sizes AND several camera poses, and report',
  'the count that cannot be reached. It must be 0, or the camera must provably bring each',
  'one into view.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const REPLAY_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: the replay snapshot, and tiles that project off the canvas.',
  '',
  '1. REPLAY: do not read the allow-list. Record a match and replay it, then DIFF the',
  '   generated terrain, ruin positions, truck positions and scores. Any difference is a',
  '   "fail". Also independently enumerate the battle state that now exists and check for',
  '   keys the builder did not add — the original finding named four, and the point is',
  '   whether the SET is complete, not whether those four were handled.',
  '2. OFF-CANVAS TILES: write your own sweep. Every tile, several viewport sizes, several',
  '   camera poses including combined pan+yaw. Report the count of tiles that cannot be',
  '   clicked. Then check the rules side: does getValidMoves ever offer a tile the player',
  '   cannot reach? Any yes is a "fail".',
  '3. Confirm the fix was made at the framing level and did NOT quietly shrink the playable',
  '   board by filtering getValidMoves — check the diff for that specifically.',
  '4. REGRESSION per the standing constraint. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

const OCC_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html.',
  '',
  'GAP left open by the camera critic, in their words: "Units and their ground rings draw',
  'straight through terrain that is nearer than they are, so at most yaw+pan poses the',
  'pixel showing a unit\'s feet is terrain that should be in front of them."',
  '',
  'This is the painter-order problem the camera exposed. Depth ordering must come from',
  'CAMERA-SPACE depth, not from world z or row index — those only agree while the camera',
  'sits on the +Z axis. Units, their ground rings, their shadows, props and terrain slabs',
  'all have to sort in one sequence against the same depth key.',
  '',
  'Watch for the specific trap: a unit standing ON a raised slab must draw in FRONT of that',
  'slab top but BEHIND a taller slab nearer the camera. Sorting whole tiles as single units',
  'will fight this — think about what the correct sort key is for a billboard standing on a',
  'surface, and say in a comment why you chose it.',
  '',
  'VERIFY BY LOOKING, at combined poses: capture at (yaw 0, 45, 90, 135, 180, 225, 270) x',
  '(no pan, panned toward one corner, panned toward the opposite corner) and READ the PNGs.',
  'For each, check whether any unit is drawn over terrain that is nearer than it is, and',
  'whether a unit standing on a slab is correctly in front of its own slab. Report a per-',
  'pose verdict, not a summary.',
  'Then measure it rather than only eyeballing: for a sample of units, compare the drawn',
  'order against the camera-space depth of the terrain at the pixel under their feet.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const OCC_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: draw-order correctness under a free camera.',
  '',
  '1. Capture the full grid of poses yourself — 7 yaws x 3 pan states minimum — and READ',
  '   every image. Report a per-pose verdict. A summary claim is not evidence.',
  '2. Hunt the hard case specifically: a unit standing on a raised slab, with a TALLER slab',
  '   between it and the camera. The unit must be in front of its own slab and behind the',
  '   nearer one. Construct that case if the shipped scenes do not contain it.',
  '3. Check ground rings, shadows, nameplates and props sort with the units, not on their',
  '   own separate pass — a fix that orders units correctly while their rings still float',
  '   over nearer terrain is not closed.',
  '4. Measure, do not eyeball: compare drawn order against camera-space depth at sampled',
  '   pixels.',
  '5. REGRESSION: picking must still be exact at every pose (this is the guarantee the whole',
  '   board rests on) — re-run a click probe at several poses and report the failure count.',
  '   Frame cost measured during motion. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

async function gauntlet(name, buildBrief, critiqueBrief, phaseName, maxRounds) {
  let built = null, verdict = null
  const hist = []
  for (let i = 1; i <= (maxRounds || 2); i++) {
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
      (i > 1 ? '\n\nROUND ' + i + '. The gap named last round was:\n"' + hist[hist.length - 1].biggestGap + '"\nVerify it is ACTUALLY closed by running the thing, then look for what the fix broke.' : '') +
      '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
      { label: 'critic:' + phaseName + '-r' + i, phase: phaseName, schema: VERDICT })
    hist.push(verdict)
    log(phaseName + ' R' + i + ': ' + verdict.verdict + ' — ' + String(verdict.biggestGap).slice(0, 120))
    if (verdict.verdict === 'pass') break
  }
  return hist
}

phase('Breaks')
const breaks = await parallel([
  () => gauntlet('Hex shove direction', SHOVE_BUILD, SHOVE_CRITIQUE, 'Breaks', 2),
  () => gauntlet('Replay snapshot + off-canvas tiles', REPLAY_BUILD, REPLAY_CRITIQUE, 'Breaks', 2),
])

phase('Occlusion')
const occ = await gauntlet('Draw order under camera', OCC_BUILD, OCC_CRITIQUE, 'Occlusion', 2)

phase('Gate')
const gate = await agent(
  COMMON + [
    'You are the FINAL REGRESSION GATE and the last check before this ships.',
    'It exists because the user said, twice, in their own words:',
    '  "I want to make sure I keep all of the functions of the battlefield."',
    '  "keep all of the game play the same but for this battlefield and new changes"',
    '',
    'Your job is NOT to judge how it looks. Your job is to find what STOPPED WORKING.',
    '',
    'STEP 1 — INVENTORY. Enumerate every distinct battlefield function the game had before',
    'this project began (git log will show you the pre-project commits). At minimum: summon',
    'from hand and the summon ceremony, move, attack, hero abilities, unit abilities and',
    'passives, consumables, fusion, traps, walls, tombstones (spawn, glow, raise-from-dead,',
    'loot), the loot grid, the hover action menu and every row in it, unit detail modals,',
    'placement, the hand strip, the side rail and piles, end turn, the AI turn, status',
    'effects and surface FX, weather, the combat cut-away, activation FX, draw FX, the',
    'targeting readout, replays, and multiplayer broadcast. Add anything you find.',
    '',
    'STEP 2 — VERIFY EACH. Prefer executing to reading. Where something genuinely cannot be',
    'exercised here (Supabase-gated multiplayer), say so and mark it UNVERIFIED, not PASS.',
    'Never mark PASS for something you did not observe working.',
    '',
    'STEP 3 — HUNT SPECIFICALLY for what this project makes likely:',
    ' - anything still assuming an 8x7 board or a square lattice',
    ' - anything assuming a fixed camera or flat ground at y=0',
    ' - any tile unreachable at any camera pose',
    ' - the DOM board and the canvas stage disagreeing about what is reachable',
    ' - the control-point tick firing more than once per side per turn, in EITHER mode',
    ' - replays rebuilding a different battlefield from the match',
    ' - deploy knobs out of sync: public/version.txt, window.BUILD_VERSION, sw.js',
    '   CACHE_VERSION must all agree',
    '',
    'STEP 4 — Confirm the three OPEN-BREAKS.md items are genuinely closed, by reproducing',
    'each original failure and watching it pass. If you cannot reproduce a failure on the',
    'pre-fix code, say so rather than assuming the fix worked.',
    '',
    'STEP 5 — cd ' + ROOT + ' && node _synckcheck.mjs && node _harness.js public/index.html',
    '',
    'Return plain text: a table of every function with PASS / FAIL / UNVERIFIED and its',
    'evidence, then a ranked list of anything broken, then a plain yes/no on whether every',
    'battlefield function that worked before still works. Be blunt and complete. A gate that',
    'misses a broken feature is worse than no gate.',
  ].join('\n'),
  { label: 'gate:final', phase: 'Gate' })

return { shove: breaks[0], replay: breaks[1], occlusion: occ, gate: gate }
