export const meta = {
  name: 'hexfield-wave8',
  description: 'Close the gate FAIL (dead-centre tiles) and make the walk route travel with the move',
  phases: [
    { title: 'Fixes', detail: 'dead-centre picking, and the route travelling with the move' },
    { title: 'Signoff', detail: 're-gate the two fixes only' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST: ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md (the gate report — the FAIL and',
  'the UNVERIFIED list), ' + ROOT + '/.gauntlet/BAR.md (the "Standing constraint" at the end is',
  'binding), ' + ROOT + '/.gauntlet/CONTRACT.md, ' + ROOT + '/.gauntlet/HEXSPEC.md,',
  ROOT + '/.gauntlet/README.md, and ' + ROOT + '/CLAUDE.md.',
  '',
  'STATE: the battlefield is complete and committed — 14x12 pointy-top hex field, seeded',
  'post-apocalyptic terrain with elevation and cliff faces, five lootable ruins on the real',
  '_lootGridOpen, three SCP-truck control points with a hold-two-of-three victory, free',
  'camera, XCOM contours and path arrows, nameplates and ownership rings, correct draw order',
  'under camera. The final gate scored 91 PASS / 1 FAIL / 17 UNVERIFIED. You are closing the',
  'FAIL and the one substantive gap the walk fix left open. Nothing else.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- NEVER rewrite either large file wholesale with a read-all/write-all script. Targeted',
  '  Edit-tool edits only; another builder may be in the same file.',
  '- After every edit: cd ' + ROOT + ' && node _synckcheck.mjs',
  '- No npm dependencies. No new binary art assets.',
  '- Line numbers drift. Verify each yourself.',
  '- Do NOT git commit, checkout, stash or reset. The lead commits.',
  '- WORK PROMPTLY. This machine restarts about hourly. Ship the fix and report.',
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

const PICK_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html.',
  '',
  'THIS IS THE GATE FAIL — the one thing that worked before this project and does not now.',
  '',
  'The gate measured it over 24 random match seeds at host 802x688:',
  '  buriedFails  0 on all 24  (nothing unreachable — that invariant holds)',
  '  offFrameFails 0 on all 24 (OPEN-BREAKS #3 stays closed)',
  '  deadCentres  1 to 6, on 24 of 24 seeds (median 3, worst 6)',
  'Confirmed with REAL MOUSE CLICKS, not geometry: 164/168 tile centres resolved correctly;',
  '4 resolved to a neighbour — (3,1)->(4,2), (12,1)->(12,2), (13,1)->(13,2), (13,2)->(12,3).',
  'elementFromPoint was the board catcher every time, so the click reached the board and the',
  'PICK answered with the wrong hexagon.',
  '',
  'Why it is gameplay and not cosmetics: selection is strictly tile-based —',
  '  const hit = tile ? unitAt(tile.x, tile.z) : null   (around :8585)',
  '  unitAt = units.find(u => u.gx===gx && u.gz===gz)   (around :1441)',
  'There is no sprite-box fallback. A unit standing on a dead-centre tile cannot be selected',
  'by clicking its feet. It is still selectable elsewhere in its hex, so nothing is',
  'permanently lost — but "click the unit, select the unit" worked on the flat pre-project',
  'board and does not now, on 1 to 6 tiles of every match.',
  '',
  'CAUSE: the elevation ladder. pickTile resolves through the terrain, and near a step the',
  'tile whose CENTRE you clicked is not the tile whose surface the ray meets first. There is',
  'a disclosed trade-off comment around :7570-7625 whose table claims deadCentres 0 at',
  '1600x900 — true only of the fixture default seed, not of real match seeds.',
  '',
  'FIX IT PROPERLY. The requirement is: clicking anywhere inside a hexagon that is visible',
  'must resolve to that hexagon, including its centre, at every camera pose and every seed.',
  'Decide the right mechanism yourself and say in a comment why you chose it and what you',
  'rejected. Options worth weighing rather than assuming: marching the ray against tile TOP',
  'surfaces in depth order instead of intersecting a single plane; resolving against the',
  'drawn polygon set (the same tilePoly the renderer strokes) rather than analytically; a',
  'hybrid that uses the analytic answer and then corrects it against the drawn polygons.',
  'Whatever you choose must stay exact under pan and yaw and must not cost the frame.',
  '',
  'DO NOT close this by loosening the test or by adding a sprite-box fallback for units —',
  'that would leave bare ground still mis-picking and put the rules and the picture back',
  'into disagreement, which is the bug class this whole project exists to remove.',
  '',
  'VERIFY BY EXECUTION, and report the numbers:',
  ' - __bbHexCheck() (or your own equivalent) across at least 20 RANDOM MATCH SEEDS, not the',
  '   fixture default. Report deadCentres, buriedFails and offFrameFails per seed. deadCentres',
  '   must be 0 on every seed.',
  ' - Real mouse clicks on all 168 tile centres, at a minimum of three camera poses',
  '   including a panned+yawed one. Report the mismatch count. It must be 0.',
  ' - Frame cost before and after.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const PICK_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: the gate FAIL — tile centres that resolve to the wrong hexagon.',
  '',
  '1. REPRODUCE THE FAILURE FIRST on the pre-fix code (git show the previous revision of the',
  '   file into a scratch serve root). If you cannot make it fail, you cannot claim the fix',
  '   works. Report the pre-fix deadCentre count.',
  '2. Then measure the shipped code yourself, over at least 20 RANDOM match seeds — not the',
  '   fixture default, which is exactly how this was missed the first time. Report per-seed',
  '   deadCentres, buriedFails, offFrameFails.',
  '3. REAL MOUSE CLICKS, not geometry alone: click all 168 tile centres at several poses',
  '   including panned+yawed, and verify the reported tile is the hexagon drawn under the',
  '   cursor. Report the mismatch count per pose. Any mismatch is a fail.',
  '4. Check the fix did not close the hole by loosening the test or by special-casing units:',
  '   bare ground must pick correctly too. Read the diff for that specifically.',
  '5. REGRESSION: picking exact at every pose, no painter inversions, all harness scenes',
  '   render, frame cost not materially worse. node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

const ROUTE_BUILD = COMMON + [
  'YOU OWN: public/index.html (the move call sites and the stage push), and the small',
  'receiving end in public/battle-board/index.html. Another builder is working on picking in',
  'the board file this phase — keep your edits there minimal and away from pickTile.',
  '',
  'GAP the walk critic found, and reproduced in the real game:',
  'The walk takes its route from TELE — the telegraph overlay, which only exists while a',
  'human is hovering or the local AI is narrating. So a move that arrives WITHOUT a live',
  'telegraph still teleports in a straight line through solid ground. Reproduced: with a wall',
  'of enemy units across a row and no selection, relocating the hero (6,9)->(6,3) and pushing',
  'units gave tween {n:1, dur:0.34, legs:[[6,9],[6,3]]} — six hexes in a third of a second,',
  'straight over the occupied tile (6,6).',
  '',
  'That shape — relocate then push — is exactly what the multiplayer receive path and the',
  'replay stepper produce. So on the opponent\'s screen and in every replay, every enemy move',
  'is the same "arrow right, picture wrong" lie the walk fix just removed locally, at the',
  'wrong pace too (0.34s for a six-tile move instead of ~1.0s).',
  '',
  'Two specific defects the critic traced, verify both yourself before relying on them:',
  ' - _bbStagePushTele only emits a foe route when App.ui.aiActorId is set, which never',
  '   happens on a receiving client.',
  ' - the mirror (around public/index.html:182851) guards on Array.isArray(App.ui.aiMoveTrail)',
  '   while setAIActor (around :153105) stores an OBJECT {from,to,path} — so the mirrored AI',
  '   trail can never be produced, and a later site nulls the trail unconditionally.',
  '',
  'FIX: stop reading the route off a UI overlay. Attach it TO THE MOVE, so it travels with',
  'the state change through every path — local, multiplayer receive, and replay. There is',
  'already a per-unit channel used for shoves; reuse it rather than inventing a parallel one.',
  'The board should walk whatever route arrives with the unit and fall back to the straight',
  'tween only when a move genuinely has no route (a teleport effect, a summon relocation) —',
  'and those cases should be deliberate and commented, not accidental.',
  '',
  'ALSO, one line the walk critic flagged: shoveLegs validates a leg with',
  'Math.abs(nx-px) > 1 || Math.abs(nz-pz) > 1 — a square box that admits EIGHT offsets, two',
  'of which are hex distance 2. Its entire job is to refuse a route it cannot vouch for.',
  'Reject unless the step is in hexDirs(pz).',
  '',
  'VERIFY BY EXECUTION: drive a move through the multiplayer-receive shape (relocate the unit',
  'then push units, with no telegraph) and confirm the board walks the real bent route at the',
  'right pace, not a straight tween. Do the same for the replay stepper. Report the tween',
  'legs and duration you actually observed in each case.',
  'cd ' + ROOT + ' && node _synckcheck.mjs',
].join('\n')

const ROUTE_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC. You did not build this.',
  'PIECE: making the walk route travel with the move rather than with the telegraph overlay.',
  '',
  '1. REPRODUCE THE FAILURE on the pre-fix code: no telegraph, relocate a unit across a wall,',
  '   push units, and confirm the old code gives a single straight leg through solid ground.',
  '   Report the tween you observed. Then run the same on the shipped code.',
  '2. Test all three arrival paths, not just one: a local move, the multiplayer-receive shape,',
  '   and the replay stepper. For each, report the legs and duration observed. A fix that',
  '   works locally and not on the receive path has not closed this.',
  '3. Confirm the route travels with the state rather than being re-derived at the board — a',
  '   second derivation is how the arrow and the walk drifted apart in the first place.',
  '4. Verify the deliberate fallbacks (teleport, summon relocation) still work and are',
  '   commented as deliberate rather than being accidental straight tweens.',
  '5. Check shoveLegs now refuses a square-diagonal leg: feed it one and confirm rejection.',
  '6. REGRESSION: local move, summon ceremony, attack lunge and death still play.',
  '   node _synckcheck.mjs clean.',
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
  () => gauntlet('Dead-centre picking (the gate FAIL)', PICK_BUILD, PICK_CRITIQUE, 'Fixes', 2),
  () => gauntlet('Route travels with the move', ROUTE_BUILD, ROUTE_CRITIQUE, 'Fixes', 2),
])

phase('Signoff')
const signoff = await agent(
  COMMON + [
    'You are the SIGN-OFF. Scope is deliberately narrow: confirm the two fixes this wave made',
    'are real, and confirm nothing they touched regressed. Do NOT re-run the whole 109-item',
    'inventory — that was done and is in FUNCTION-INVENTORY.md.',
    '',
    '1. THE GATE FAIL — tile centres resolving to the wrong hexagon. Measure over at least 20',
    '   RANDOM match seeds (not the fixture default) and with real mouse clicks at several',
    '   camera poses including panned+yawed. Report deadCentres, buriedFails, offFrameFails',
    '   per seed and the click mismatch count per pose. State plainly whether the FAIL is',
    '   closed.',
    '2. THE ROUTE — confirm a move arriving with no telegraph (the multiplayer-receive and',
    '   replay shapes) walks the real bent route at the right pace. Report observed legs and',
    '   durations.',
    '3. Re-confirm the three OPEN-BREAKS are still closed (displacement direction, replay',
    '   snapshot, off-frame tiles) — the two fixes touched adjacent code.',
    '4. Confirm picking is still exact, painter order still correct, all harness scenes still',
    '   render, and deploy knobs still agree (public/version.txt, window.BUILD_VERSION,',
    '   public/sw.js CACHE_VERSION).',
    '5. cd ' + ROOT + ' && node _synckcheck.mjs && node _harness.js public/index.html',
    '6. Capture and READ: node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" ' + ROOT + '/.gauntlet/SIGNOFF.png 1600 900',
    '',
    'Update ' + ROOT + '/.gauntlet/FUNCTION-INVENTORY.md in place: correct the FAIL row and',
    'anything else this wave changed, leave the rest.',
    '',
    'Return plain text: is the FAIL closed, is the route fixed on all arrival paths, did',
    'anything regress, and the final PASS/FAIL/UNVERIFIED counts. Be blunt.',
  ].join('\n'),
  { label: 'signoff', phase: 'Signoff' })

return { pick: both[0], route: both[1], signoff: signoff }
