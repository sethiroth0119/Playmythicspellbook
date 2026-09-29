export const meta = {
  name: 'hexfield-wave7',
  description: 'Make the walk follow the arrow, fix draw order under camera, then the final gate',
  phases: [
    { title: 'Fixes', detail: 'animation follows the route; units stop drawing through terrain' },
    { title: 'Gate', detail: 'final function inventory and sign-off' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST: ' + ROOT + '/.gauntlet/BAR.md (especially the "Standing constraint" at the',
  'end), ' + ROOT + '/.gauntlet/CONTRACT.md, ' + ROOT + '/.gauntlet/HEXSPEC.md,',
  ROOT + '/.gauntlet/README.md (how to capture the board headlessly), and ' + ROOT + '/CLAUDE.md.',
  'If ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md exists, read it — do not re-break anything',
  'it marks as working.',
  '',
  'STATE: a 14x12 pointy-top hex battlefield with seeded post-apocalyptic terrain, real',
  'elevation and cliff faces, five lootable ruins opening the real _lootGridOpen, three',
  'SCP-truck control points with a per-turn score and a hold-two-of-three victory, a free',
  'camera (WASD pan, Q/E yaw), XCOM move contours and path arrows, enemy nameplates and',
  'ownership rings.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- NEVER rewrite either large file wholesale with a read-all/write-all script. Targeted',
  '  Edit-tool edits only; another builder may be in the same file.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- No npm dependencies. No new binary art assets.',
  '- Line numbers drift. Verify each yourself.',
  '- Do NOT git commit, checkout, stash or reset. The lead commits.',
  '- WORK PROMPTLY. This machine restarts about hourly; finish and report rather than',
  '  polishing indefinitely.',
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

const WALK_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html and public/battle-board/_harness.html.',
  '',
  'GAP, in the critic\'s words: "The fix moved the lie from the rules into the animation.',
  'moveUnit() in public/battle-board/index.html tweens a unit with a single linear',
  'interpolation between endpoints." So the path arrow honestly draws the bent route the',
  'rules will take, and then the sprite slides straight through the wall the route goes',
  'around. The arrow is right and the picture is still wrong.',
  '',
  'FIX: moveUnit must WALK THE ROUTE. Take the same ordered tile list the telegraph draws',
  '(it is already computed and already pushed — find it rather than recomputing it, because',
  'a second derivation is how these two drift apart again), and tween along it segment by',
  'segment: ease into the first step, keep a constant ground speed through the middle so a',
  'long route does not crawl, settle on the last. Keep the existing hop arc, squash and dust',
  'if they are there — this is a path change, not a restyle. Snap to the tile centre at the',
  'end; never leave a unit off-grid.',
  'Follow terrain height along the way: a unit walking onto a slab should rise with it.',
  '',
  'VERIFY BY EXECUTION: pick routes that MUST bend — around a wall, around a unit, around a',
  'raised mass. For each, record the tiles the arrow drew and the positions the sprite',
  'actually passed through, and compare. Report the comparison per route. A route where the',
  'sprite cuts a corner the arrow went around is not fixed.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const WALK_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: the unit walk following the telegraphed route.',
  '',
  '1. Construct routes that MUST bend — wall, occupied tile, raised mass, hex-parity',
  '   detour — and for each, sample the sprite position over the whole animation and',
  '   compare against the tiles the arrow drew. Report per-route. Any corner cut is a fail.',
  '2. Confirm the walk consumes the SAME path the telegraph draws rather than a second',
  '   derivation of it. Read the code for that specifically: two derivations will drift.',
  '3. Confirm the unit ends exactly on the destination tile centre, and at the right height',
  '   when the destination is raised.',
  '4. REGRESSION: the summon ceremony, attack lunge, death dissolve and any other animation',
  '   that shares this code path must still play. Capture and look.',
  '   node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

const OCC_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html — draw order only. Coordinate: another builder',
  'is editing moveUnit in this same file this phase, so keep your edits away from it.',
  '',
  'GAP, in the critic\'s words: "Units and their ground rings draw straight through terrain',
  'that is nearer than they are, so at most yaw+pan poses the pixel showing a unit\'s feet is',
  'terrain that should be in front of them."',
  '',
  'Depth ordering must come from CAMERA-SPACE depth, not world z or row index — those only',
  'agree while the eye sits on the +Z axis, which is exactly the assumption the free camera',
  'removed. Units, ground rings, shadows, nameplates, props and terrain slabs all have to',
  'sort in ONE sequence against the same depth key.',
  '',
  'The hard case, which a naive whole-tile sort gets wrong: a unit standing ON a raised slab',
  'must draw IN FRONT of its own slab top but BEHIND a taller slab nearer the camera. Think',
  'about the right sort key for a billboard standing on a surface and say in a comment why',
  'you chose it.',
  '',
  'VERIFY: capture yaw 0/45/90/135/180/225/270 crossed with no-pan and two panned states,',
  'READ every image, and give a per-pose verdict — not a summary. Then measure: for sampled',
  'units, compare drawn order against the camera-space depth of the terrain at the pixel',
  'under their feet. Picking must remain exact at every pose; re-probe and report failures.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const OCC_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: draw-order correctness under the free camera.',
  '',
  '1. Capture the full pose grid yourself and READ every image. Per-pose verdict required.',
  '2. Construct the hard case if the shipped scenes lack it: a unit on a raised slab with a',
  '   TALLER slab between it and the camera. It must be in front of its own slab and behind',
  '   the nearer one.',
  '3. Ground rings, shadows and nameplates must sort WITH their unit. A fix that orders',
  '   units correctly while their rings still float over nearer terrain is not closed.',
  '4. Measure rather than eyeball: drawn order vs camera-space depth at sampled pixels.',
  '5. REGRESSION: picking exact at every pose — this is the guarantee the whole board rests',
  '   on. Re-probe and report the failure count. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

async function gauntlet(name, build, critique, phaseName, maxRounds) {
  let built = null, verdict = null
  const hist = []
  for (let i = 1; i <= (maxRounds || 2); i++) {
    const p = i === 1 ? build : (
      COMMON + 'You are the builder for: ' + name + '. Round ' + i + '.\n' +
      'An independent critic ran your real output.\n\n' +
      'VERDICT: ' + verdict.verdict + '\nBIGGEST GAP: ' + verdict.biggestGap + '\n' +
      'FIX DIRECTIVE: ' + verdict.fixDirective + '\n' +
      'REGRESSIONS: ' + JSON.stringify(verdict.regressions || []) + '\n\n' +
      'Close that gap. Do not restart, do not widen scope. Re-verify by EXECUTING.\n\n' +
      'Original brief:\n' + build)
    built = await agent(p, { label: 'build:' + phaseName + '-r' + i, phase: phaseName, schema: BUILD_RESULT })
    verdict = await agent(
      critique +
      (i > 1 ? '\n\nROUND ' + i + '. Gap named last round:\n"' + hist[hist.length - 1].biggestGap + '"\nVerify it is closed by running it, then look for what the fix broke.' : '') +
      '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
      { label: 'critic:' + phaseName + '-r' + i, phase: phaseName, schema: VERDICT })
    hist.push(verdict)
    log(phaseName + ' R' + i + ': ' + verdict.verdict + ' — ' + String(verdict.biggestGap).slice(0, 110))
    if (verdict.verdict === 'pass') break
  }
  return hist
}

phase('Fixes')
const both = await parallel([
  () => gauntlet('Walk follows the arrow', WALK_BUILD, WALK_CRITIQUE, 'Fixes', 2),
  () => gauntlet('Draw order under camera', OCC_BUILD, OCC_CRITIQUE, 'Fixes', 2),
])

phase('Gate')
const gate = await agent(
  COMMON + [
    'You are the FINAL REGRESSION GATE. Last check before this ships. It exists because the',
    'user said, twice, in their own words:',
    '  "I want to make sure I keep all of the functions of the battlefield."',
    '  "keep all of the game play the same but for this battlefield and new changes"',
    '',
    'Your job is NOT to judge how it looks. Your job is to find what STOPPED WORKING.',
    '',
    '1. INVENTORY every distinct battlefield function the game had before this project',
    '   (git log shows the pre-project commits). At minimum: summon from hand and the summon',
    '   ceremony, move, attack, hero and unit abilities, passives, consumables, fusion,',
    '   traps, walls, tombstones (spawn, glow, raise-from-dead, loot), the loot grid, the',
    '   hover action menu and every row in it, unit detail modals, placement, the hand strip,',
    '   the side rail and piles, end turn, the AI turn, status effects and surface FX,',
    '   weather, the combat cut-away, activation FX, draw FX, the targeting readout, replays,',
    '   multiplayer broadcast. Add anything else you find.',
    '2. VERIFY EACH by executing where possible. Where something genuinely cannot be',
    '   exercised here (Supabase-gated multiplayer), mark it UNVERIFIED, never PASS.',
    '3. HUNT specifically: anything still assuming 8x7 or a square lattice; anything assuming',
    '   a fixed camera or flat ground; any tile unreachable at any camera pose; the DOM board',
    '   and the canvas stage disagreeing about reachability; the control-point tick firing',
    '   more than once per side per turn in EITHER mode; replays rebuilding a different',
    '   battlefield; deploy knobs out of sync (public/version.txt, window.BUILD_VERSION,',
    '   public/sw.js CACHE_VERSION must all agree).',
    '4. Confirm each item in ' + ROOT + '/.gauntlet/OPEN-BREAKS.md is genuinely closed by',
    '   reproducing the original failure first. If you cannot reproduce a failure on the',
    '   pre-fix code, say so rather than assuming the fix worked.',
    '5. cd ' + ROOT + ' && node _synckcheck.mjs && node _harness.js public/index.html',
    '6. Capture the board and READ it: node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" ' + ROOT + '/.gauntlet/GATE-final.png 1600 900',
    '',
    'Write your full report to ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md (replace it), and',
    'return as your final text: the count of PASS / FAIL / UNVERIFIED, every FAIL with',
    'file:line, and a plain yes/no on whether every battlefield function that worked before',
    'still works. Be blunt and complete.',
  ].join('\n'),
  { label: 'gate:final', phase: 'Gate' })

return { walk: both[0], occlusion: both[1], gate: gate }
