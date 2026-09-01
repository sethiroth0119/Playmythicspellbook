export const meta = {
  name: 'hexfield-wave9',
  description: 'Keep every playable tile reachable at every camera pose',
  phases: [
    { title: 'Framing', detail: 'no in-bounds tile may leave the frame' },
    { title: 'Signoff', detail: 'independent sweep across poses and seeds' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/OPEN-BREAKS.md  <- section A is this piece, with measured numbers',
  '  ' + ROOT + '/.gauntlet/BAR.md          <- the bar and its binding standing constraint',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/README.md       <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'STATE: the battlefield is done and shipped at v120x4 — 14x12 pointy-top hex field,',
  'seeded post-apocalyptic terrain with elevation and cliff faces, five lootable ruins on',
  'the real _lootGridOpen, three SCP-truck control points with a hold-two-of-three victory,',
  'a free camera, XCOM move contours and route arrows, nameplates and ownership rings.',
  'Picking is exact at the shipped framing: 168/168 real clicks, 0 dead centres on 24 seeds.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- NEVER rewrite a file wholesale with a read-all/write-all script. Targeted edits only.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- No npm dependencies. Do NOT touch card, economy or combat-resolution code.',
  '- Comments explain WHY. Do NOT git commit, checkout, stash or reset.',
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

const BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html and public/battle-board/_harness.html.',
  '',
  'PIECE: A TILE THE RULES CONSIDER PLAYABLE MUST BE REACHABLE AT EVERY CAMERA POSE.',
  '',
  'Measured on the shipped tree by running the board own __bbHexCheck() at five poses:',
  '',
  '  pose                 ok     centreFails jitterFails deadCentres offFrame  misresolved',
  '  yaw 0,   no pan      TRUE   0           0           0           0         0',
  '  yaw 45,  no pan      false  0           0           3           14        13',
  '  yaw 90,  pan 2,1     false  0           0           6           22        19',
  '  yaw 180, pan -2,-1   false  0           0           1           7         8',
  '  yaw 270, pan 1,-2    false  0           0           6           31        16',
  '',
  'Read that carefully before designing anything: centreFails and jitterFails are ZERO at',
  'every pose. The picking GEOMETRY is correct and was hard won — do not touch it. What',
  'fails is FRAMING: rotating and panning swings tiles outside the canvas rect, a click',
  'there lands on the page background, and a unit standing on such a tile cannot be',
  'selected, moved or targeted.',
  '',
  'THE DESIGN TENSION, stated so you do not solve the wrong problem: you cannot simply',
  're-fit the board on every camera change, because PANNING IS SUPPOSED TO MOVE THE VIEW.',
  'A camera that silently re-frames whatever the player pans toward is not a camera. So',
  'the two halves need different answers, and you must decide and defend them:',
  ' - YAW should not cost the player tiles. Rotating is a look-at-it-from-here action, not',
  '   a navigation action, so the board should stay wholly framed as it turns — re-fitting',
  '   the SCALE on yaw is legitimate and invisible.',
  ' - PAN is navigation and is allowed to move tiles off screen — but then the player must',
  '   always be able to bring any tile back, and the game must never require a click on a',
  '   tile that is currently off screen. Clamp pan so the board cannot be lost, and make',
  '   sure nothing forces an interaction with an off-screen tile.',
  'If you think a different split is right, argue it in a comment with the reason.',
  '',
  'ALSO: __bbHexCheck must keep failing honestly. It already had a hole shaped exactly like',
  'a bug once — it filed buried tiles under "occluded" and returned ok:true on a board with',
  'four unclickable hexes. Do NOT close this by widening what the check tolerates. If the',
  'check needs a pose-aware notion of "reachable" (a tile off screen due to deliberate pan',
  'is not the same failure as a tile that cannot be reached at all), then make that',
  'distinction explicit and still fail on the second kind.',
  '',
  'VERIFY — required, and paste real output:',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  'Then run __bbHexCheck() yourself across at least 8 yaw angles x 3 pan states x 4 terrain',
  'seeds and report the full table. Every pose must show zero tiles that cannot be reached.',
  'Capture and READ images at several poses to confirm the board still looks right and the',
  'fit does not visibly pump or jitter as you rotate.',
].join('\n')

const CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: keeping every playable tile reachable at every camera pose.',
  '',
  '1. WRITE YOUR OWN SWEEP — do not reuse the builder harness or trust their table. Drive',
  '   the real page in Chromium across at least 8 yaw angles, 3 pan states and 4 terrain',
  '   seeds. For every tile at every pose, determine whether a real click can reach it.',
  '   Report the full table with numbers. Any tile unreachable at any pose that the rules',
  '   still consider playable is a "fail".',
  '2. CHECK THE CHECK. Confirm __bbHexCheck was not quietly relaxed to make itself pass.',
  '   Diff it. If its tolerance widened, establish whether the new tolerance is a real',
  '   distinction (deliberately panned off screen) or a hole (cannot be reached at all).',
  '   Construct a genuinely unreachable tile and confirm the check still FAILS on it.',
  '3. REGRESSION, and this is the big one: picking geometry was exact before this change —',
  '   0 centreFails and 0 jitterFails at every pose, 168/168 real clicks at the shipped',
  '   framing. Re-measure both. If this fix bought framing at the cost of picking accuracy,',
  '   that is a "fail".',
  '4. FEEL: capture at several yaws and READ the images. Does the board visibly pump, jump',
  '   or jitter as it rotates? A fit that re-scales every frame is correct and unusable.',
  '5. Confirm panning still actually pans — a clamp so tight the camera cannot move is not',
  '   a fix, it is a removal, and the standing constraint forbids removing a feature.',
  '6. node _synckcheck.mjs clean; frame cost measured during motion.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

let built = null, verdict = null
const hist = []

phase('Framing')
for (let i = 1; i <= 3; i++) {
  const p = i === 1 ? BUILD : (
    COMMON +
    'You are the builder for camera framing. Round ' + i + '.\n' +
    'An independent critic swept your real output.\n\n' +
    'VERDICT: ' + verdict.verdict + '\n' +
    'BIGGEST GAP: ' + verdict.biggestGap + '\n' +
    'FIX DIRECTIVE: ' + verdict.fixDirective + '\n' +
    'REGRESSIONS: ' + JSON.stringify(verdict.regressions || []) + '\n\n' +
    'Close that gap without regressing picking accuracy or removing the ability to pan.\n' +
    'Re-verify by EXECUTING the full sweep again.\n\nOriginal brief:\n' + BUILD)
  built = await agent(p, { label: 'build:framing-r' + i, phase: 'Framing', schema: BUILD_RESULT })
  verdict = await agent(
    CRITIQUE +
    (i > 1 ? '\n\nROUND ' + i + '. The gap named last round was:\n"' + hist[hist.length - 1].biggestGap + '"\nVerify it is closed by sweeping yourself, then look for what the fix broke.' : '') +
    '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
    { label: 'critic:framing-r' + i, phase: 'Framing', schema: VERDICT })
  hist.push(verdict)
  log('R' + i + ': ' + verdict.verdict + ' — ' + String(verdict.biggestGap).slice(0, 130))
  if (verdict.verdict === 'pass') break
}

phase('Signoff')
const signoff = await agent(
  COMMON + [
    'You are the FINAL SIGNOFF for the whole battlefield project. You have seen none of it.',
    '',
    'Do not judge taste. Answer two questions with evidence:',
    '',
    'Q1 — IS EVERY PLAYABLE TILE REACHABLE? Sweep the board yourself across yaw angles, pan',
    'states and terrain seeds, in real Chromium. Report the numbers. State plainly yes or no.',
    '',
    'Q2 — DOES EVERY BATTLEFIELD FUNCTION STILL WORK? Read',
    ROOT + '/.gauntlet/FUNCTION-INVENTORY.md if it exists — it lists what was verified',
    'earlier and how. Re-verify a representative sample by EXECUTING, especially: summoning,',
    'moving, attacking, the hover action menu, looting a tombstone, looting a ruin (it must',
    'call the real _lootGridOpen), the control-point tick and its victory, end turn, and the',
    'AI taking a legal turn. Anything you cannot exercise here, mark UNVERIFIED, not PASS.',
    '',
    'Then run: cd ' + ROOT + ' && node _synckcheck.mjs && node _harness.js public/index.html',
    'and confirm public/version.txt, window.BUILD_VERSION and sw.js CACHE_VERSION all agree.',
    '',
    'Return plain text: the two answers with their evidence, then a ranked list of anything',
    'still broken or unverified. Be blunt. Do not congratulate anyone.',
  ].join('\n'),
  { label: 'signoff:final', phase: 'Signoff' })

return { rounds: hist, signoff }
