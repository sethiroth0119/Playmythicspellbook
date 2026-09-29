export const meta = {
  name: 'hexfield-wave4',
  description: 'Fix the unclickable-tile bug and the value range; build lootable ruins and SCP control points',
  phases: [
    { title: 'Build', detail: 'stage/terrain fixes and ruins+loot, disjoint regions' },
    { title: 'Critique', detail: 'fresh critics run the real thing' },
    { title: 'Objectives', detail: 'control points, capture scoring, alternate victory' },
    { title: 'Rework', detail: 'close the named gaps' },
  ],
}

const ROOT = '/home/user/Playmythicspellbook'

const COMMON = [
  'PROJECT: Mythic Spellbook, a tactics card game. Repo root ' + ROOT + '.',
  'READ FIRST, in full:',
  '  ' + ROOT + '/.gauntlet/BAR.md      <- the quality bar, INCLUDING the "Standing constraint"',
  '                                   section at the end. Requirements 5-10 are this wave.',
  '  ' + ROOT + '/.gauntlet/CONTRACT.md <- architecture brief. Section 3 seams, 4 loot recipe,',
  '                                   5 turn loop and victory, 6 visual style tokens.',
  '  ' + ROOT + '/.gauntlet/HEXSPEC.md',
  '  ' + ROOT + '/.gauntlet/README.md   <- how to capture the board headlessly',
  '  ' + ROOT + '/CLAUDE.md',
  '',
  'STATE: a 14x12 pointy-top hex field with seeded post-apocalyptic terrain — elevation,',
  'cliff faces, cracked asphalt, dirt, grass, rubble, water, props, rain. Both lattices are',
  'proven to agree. Committed at c84e547.',
  '',
  '!! FILE-SHARING RULE — ANOTHER BUILDER IS EDITING public/index.html RIGHT NOW.',
  '- Use ONLY targeted Edit-tool edits on public/index.html.',
  '- NEVER read the whole file and write it back. NEVER use a python/node script that',
  '  rewrites public/index.html wholesale. That would silently destroy the other builder\'s',
  '  work. sed -i on a specific matched line is acceptable; a full-file rewrite is not.',
  '- Stay strictly inside the line regions your brief assigns you.',
  '',
  'HARD RULES:',
  '- public/index.html is 13MB. NEVER read it whole. grep -n and sed -n ranges only.',
  '- Line numbers in the docs have DRIFTED. Verify every one yourself before editing.',
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

/* ═══════════ TRACK A — the stage, and a real bug ═══════════ */

const A_BUILD = COMMON + [
  'YOU OWN: public/battle-board/index.html, public/battle-board/_harness.html, and in',
  'public/index.html ONLY the terrain-generation region (_BB_ELEV / _bbGenTerrain /',
  'lotLevel / streetDist / _bbMapFromEditor, roughly lines 103600-104050 — verify). Touch',
  'NOTHING else in index.html; another builder owns the rest.',
  '',
  'An independent judge captured the board and ranked it against BAR.md R1. It ranked the',
  'current state well above both earlier baselines but ruled it does NOT yet win. Four',
  'findings, in priority order. #1 is a real bug, not a matter of taste.',
  '',
  '── #1 FOUR HEXES ARE COMPLETELY UNCLICKABLE (fix this first) ──',
  'Sampling 36 points inside every tile and asking pickTile which tile it returns:',
  '  scene=gamemap:  (13,5), (4,8), (3,9), (8,9) return 0/36 — no pixel inside those',
  '                  hexes resolves to them. Six more have unclickable centres.',
  '  scene=skirmish: (13,5) and (10,0) return 0/36 — a DIFFERENT set.',
  'The failing set is camera/viewport dependent, so it is unpredictable at real window',
  'sizes. pickTile is doing the physically correct thing; the GENERATOR is the bug —',
  'nothing stops a rung-3/4 mound at row z+1 from standing directly in front of a low tile',
  'at row z and burying it completely.',
  'Consequence: you cannot move a unit there, click a unit standing there, or target it —',
  'while the DOM board can still reach them. That is the two renderers disagreeing about',
  'what is reachable: the same "UI lies about the rules" family as the scar comment at',
  'index.html:141543.',
  'WORSE, THE SAFETY NET HAS A HOLE THE EXACT SHAPE OF THE BUG: window.__bbHexCheck()',
  'returns ok:true / fails:[] on this very map, because it buckets these tiles into',
  '"occluded: 181" and treats occlusion as acceptable.',
  'FIX BOTH:',
  ' (a) A generator constraint so no tile can be buried — e.g. no tile may sit 2 or more',
  '     rungs below its z+1 neighbour, or must retain a visible fringe. Choose the rule,',
  '     state it in a comment, and enforce it in the generator, not by capping heights',
  '     globally (heights are needed — see #2).',
  ' (b) Make __bbHexCheck FAIL when any tile has zero reachable sample points, instead of',
  '     counting it as occluded. A self-check that passes on a broken board is worse than',
  '     no self-check. Report its output before and after.',
  ' (c) Re-run the sampling sweep yourself over several viewport sizes AND several seeds,',
  '     and report the count of zero-reachable tiles. It must be 0 everywhere.',
  '',
  '── #2 THE DIORAMA LIVES IN 19% OF THE VALUE RANGE ──',
  'The SURF table (public/battle-board/index.html around :1448) sets each material\'s "hi" —',
  'the FULLY KEY-LIT colour — to near-black: dirt #4d3d29 (L=62), asphalt #474d55 (L=76),',
  'rubble #4f4e48 (L=78), grass #454f2c (L=73), water #2f414b (L=62). Measured on delivered',
  'pixels a lit slab top reads L=64 and its cliff face L=33; across the frame 89.5% of',
  'pixels are below L=96 and only 2.0% above. The LIGHT RIG IS CORRECT (day, key #fff2c8 at',
  '1.15) — the albedos are near-black by construction.',
  'The comment above SURF cites BAR R1 "one value range; nothing neon" as justification.',
  'That is a misreading: in the reference HUE AND CHROMA are muted, VALUE IS NOT. Lit rock',
  'sits near L=150-170 and shadow near L=50. This is why "height readable at a glance" fails',
  'even though a genuine ~49px cliff is present — 31 levels of separation is a whisper.',
  'FIX: raise every "hi" roughly 2.2x (rubble -> ~#a9a79c, asphalt -> ~#9aa2ac, dirt ->',
  '~#a8875c, grass -> ~#8d9c60), leave "lo" where it is so top-vs-face contrast grows, and',
  'lift MAP.ground.base (#2a2418, L=36) out of near-black. Do NOT touch LIGHT.',
  'Then MEASURE the delivered pixels again and report the histogram. Keep chroma muted:',
  'mean saturation is currently 0.16 and that clause already passes — do not spend the value',
  'increase on saturation.',
  '',
  '── #3 THE RELIEF IS A PICTURE FRAME AROUND A FLAT BOWL ──',
  'Every rung-3 and rung-4 tile is in rows 0-3 and 8-11. Rows 4-7 — the central plaza where',
  'units stand and the eye goes — top out at rung 1 (~11px). So the play area is flat and',
  'the relief is a rim, which is exactly the "even border round an arena" the generator\'s own',
  'comment swears off. Also: all 36 tiles at elev >= 0.95 are surf "rubble". 100%. Height and',
  'material are welded together, so grass/dirt/asphalt only ever exist at the bottom.',
  'FIX: force at least two rung-3+ masses INSIDE rows 3-8, each with a contiguous 3-4 tile',
  'top so it reads as a plateau a squad could stand on rather than a 1-tile pillar. Decouple',
  'height from material: a rung-2 grass shelf and a rung-2 dirt shelf are what turn this from',
  '"rubble heaps on a road" into the reference picture. BAR R1 asks for four materials at',
  'four heights. Respect the #1 no-burying constraint while doing it.',
  '',
  '── #4 PROPS ARE ONE STAMP, AND THE EVENT GLYPHS ARE FLAT ICONS ──',
  'The stone chip is ONE pentagon at ONE rotation with ONE light direction, stamped several',
  'hundred times; the tipped slab likewise. At crop level they read as gravel stickers, not',
  'silhouettes. Give per-instance rotation and three size tiers, plus two or three more',
  'silhouettes (kerb stone, rebar spike, tipped concrete slab), and more than one thorn-bush',
  'shape (around :2016).',
  'Separately, the wall/trap/objective markers are flat SCREEN-SPACE 2D icons floating above',
  'the diorama and are the loudest non-reference element in the frame. Render them as',
  'projected geometry standing on their tile.',
  '',
  '── ALSO ──',
  '.gauntlet/README.md:70 still says scene "gamemap" is _bbMapFromEditor literal output for',
  'the shipped default, "tiles: [], bare ground". That is no longer true and it is the line',
  'that DEFINES what "as-shipped" means for every future critic. Fix it.',
  '',
  'VERIFY — required, paste real output:',
  '  cd ' + ROOT + ' && node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=gamemap&shot=1" /tmp/a-ship.png 1600 900',
  '  cd ' + ROOT + ' && node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=skirmish&shot=1" /tmp/a-skir.png 1600 900',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  'READ both PNGs back. Report the zero-reachable tile count (must be 0), the value',
  'histogram before and after, and a real measured frame cost.',
].join('\n')

const A_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the stage/terrain work. You did not build it.',
  '',
  '1. THE BUG COMES FIRST. Write your OWN sampling sweep — do not reuse or trust the',
  '   builder\'s. For every tile, sample many points inside its drawn hexagon and ask',
  '   pickTile what it returns. Do this across at least three viewport sizes and at least',
  '   four different terrain seeds. Report the count of tiles with ZERO reachable points.',
  '   Any tile that cannot be clicked at all is a "fail", full stop — a unit standing there',
  '   cannot be selected, moved or targeted.',
  '   Then confirm __bbHexCheck() itself now FAILS on a deliberately buried tile: construct',
  '   one and check the self-check catches it. A safety net you did not test is not a net.',
  '2. CAPTURE AND LOOK. Both scenes, READ the PNGs. "gamemap" is authoritative.',
  '   Measure the value histogram yourself from the real pixels. Report the fraction below',
  '   L=96 and above L=96, and mean saturation — the goal was more VALUE range without more',
  '   chroma. If saturation climbed materially, the fix overshot.',
  '3. Check the relief actually moved into rows 3-8 and that height is no longer welded to',
  '   "rubble". Dump the generated rung/surface map and report the real distribution.',
  '4. BLIND A/B against ' + ROOT + '/.gauntlet/wave3-skirmish.png and BAR.md R1. Which wins, and',
  '   would someone holding the FFT reference accept the new one? Be willing to say no.',
  '5. REGRESSION per BAR.md standing constraint: harness scenes all render, hex geometry',
  '   still exact, node _synckcheck.mjs clean, frame cost measured not claimed.',
  '6. Confirm the builder stayed out of the other builder\'s territory: the ONLY index.html',
  '   changes should be in the terrain-generation region. Check git diff.',
  '',
  'Name ONE biggest remaining gap with an actionable fixDirective.',
].join('\n')

/* ═══════════ TRACK B — ruins and loot ═══════════ */

const B_BUILD = COMMON + [
  'YOU OWN: public/index.html EXCEPT the terrain-generation region (_BB_ELEV /',
  '_bbGenTerrain / lotLevel / streetDist / _bbMapFromEditor, roughly 103600-104050) which',
  'another builder owns this wave. You may also add NEW files under public/src/battle/.',
  'You may add a SMALL push function to public/battle-board/index.html to draw your objects',
  '— but the other builder is editing that file heavily, so keep your edits there minimal,',
  'additive, and at the end of a section rather than interleaved.',
  '',
  'PIECE: THE FIVE LOOTABLE RUINS. User requirements 5 and 6, verbatim:',
  '  "I want the locations to loot to be a car, a church, a school, a hospital, and a house."',
  '  "Add the function to where players go to the loot locations to give the same ability as',
  '   the player is looting a tomb stone and show the exact function where resource appear in',
  '   a gird that players can loot from and swap loot they have from."',
  '',
  'That last sentence is the whole requirement: it must be THE SAME FUNCTION. Not a copy,',
  'not a lookalike. _lootGridOpen(got, ctx) is the real Tarkov-style salvage grid with drag,',
  'rotate-on-R, take-all, and swap-your-own-loot-into-the-container. A structure must open',
  'THAT function.',
  '',
  'CONTRACT.md section 4 has the full recipe; verify its line numbers, they have drifted:',
  ' - _lootGridOpen(got, ctx) is already generic: "got" is a flat {resourceId: qty}, "ctx"',
  '   is two cosmetic strings. Reuse it UNCHANGED.',
  ' - Add state.structures, using the EXACT field names tombstones use so every existing',
  '   consumer keeps working.',
  ' - _rollStructureSalvage — the haul table. Different structures should feel different:',
  '   a hospital yields medical, a school yields books/supplies, a church yields relics, a',
  '   house yields household goods, a car yields fuel/parts. Use resource ids that already',
  '   exist — grep the resource catalogue, invent nothing.',
  ' - _unitCanLootStructure and _lootStructureWithUnit — model on _lootWithUnit.',
  ' - !! MUST-KEEPS from the tombstone flow, or the loot silently breaks (verify each line',
  '   yourself): the line that spends the unit turn; the line that creates s._salvageRun',
  '   (the grid WRITES into it but never creates it — omit this and the haul vanishes);',
  '   the haul pipeline (rarity boost, event mods, backpack multiplier); and the empty-haul',
  '   guard.',
  ' - One row in the unit hover action menu, matching the existing rows exactly.',
  ' - A _bbStagePushStructs modelled on _bbStagePushTombs, and stage-side drawing.',
  ' - Mirror it for multiplayer wherever tombstones are mirrored.',
  '',
  'PLACEMENT: five structures placed on the generated map, deterministically from the SAME',
  'seed the terrain uses, so both multiplayer clients and replays agree. They must not spawn',
  'on top of unit deployment zones, must not bury a tile, and must be reachable.',
  '',
  'DRAWING: they must READ as destroyed, per the user: "the places on the map that can be',
  'looted looked destroyed". A wrecked car, a gutted church with a broken steeple, a',
  'collapsed school, a hospital with a caved roof and a visible red cross, a burnt house.',
  'Procedural canvas drawing — no new image assets. They are the biggest objects on the',
  'board after the terrain, so they carry the post-apocalyptic read.',
  '',
  'VERIFY — required, paste real output:',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  '  Prove the loot path end to end in real Chromium: drive the shipped functions, confirm',
  '  _lootGridOpen is the function that opens (not a reimplementation), confirm the grid',
  '  renders with real resources in it, confirm taking and swapping commits to',
  '  Profile.fieldBag, and confirm the unit turn is spent. Paste what you actually observed.',
  '  Add a harness scene showing the five ruins on the board and capture it:',
  '  cd ' + ROOT + ' && node .gauntlet/shot.mjs "/battle-board/_harness.html?scene=ruins&shot=1" /tmp/b-ruins.png 1600 900',
  '  READ it back and describe what you see.',
].join('\n')

const B_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the lootable ruins. You did not build them.',
  '',
  '1. THE CENTRAL REQUIREMENT IS IDENTITY, NOT SIMILARITY. The user asked for "the same',
  '   ability as the player is looting a tombstone" and "the exact function". Verify by',
  '   reading the code that looting a structure calls the REAL _lootGridOpen. If the builder',
  '   wrote a parallel grid, that is a "fail" no matter how good it looks.',
  '   Then verify the FULL interaction actually works, in real Chromium, driving it',
  '   yourself: the grid opens, resources are in it, drag works, rotate-on-R works,',
  '   take-all works, and — the part most likely to be broken — the player can drag their',
  '   OWN carried loot INTO the container to make room. That swap is explicitly in the',
  '   user\'s words.',
  '2. THE MUST-KEEPS. Check each one in the shipped code, not the report: does looting spend',
  '   the unit turn? Is s._salvageRun created before the grid can write into it? Is the haul',
  '   pipeline applied? Is the empty-haul case guarded? A missing _salvageRun creation makes',
  '   the haul vanish silently — test it.',
  '3. DETERMINISM: same seed gives the same five structures in the same places; different',
  '   seeds differ. Execute it. Math.random() in placement is a multiplayer desync.',
  '4. Confirm structures cannot spawn on deployment zones, cannot bury a tile (the stage has',
  '   a no-burying constraint — verify structures respect it), and are reachable.',
  '5. LOOK AT THEM. Capture the ruins scene and READ the PNG. Do they read as a car, a',
  '   church, a school, a hospital and a house — and do they read as DESTROYED? Name any',
  '   that are unidentifiable.',
  '6. REGRESSION per BAR.md standing constraint: tombstone looting must still work exactly',
  '   as before — this piece must not have altered it. Test that too.',
  '   node _synckcheck.mjs must be clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ═══════════ Objectives ═══════════ */

const O_BUILD = COMMON + [
  'YOU OWN: public/index.html except the terrain-generation region, plus new files under',
  'public/src/battle/, plus minimal additive edits to public/battle-board/index.html.',
  'The lootable-ruins work has already landed in this same file — read it and FOLLOW ITS',
  'PATTERNS rather than inventing parallel ones.',
  '',
  'PIECE: THREE SCP-TRUCK CONTROL POINTS AND AN ALTERNATE WAY TO WIN.',
  'User requirements 7 and 8, verbatim:',
  '  "The Control Points will be SCP trucks with nodes."',
  '  "The first to control the control points which I want 3 of them, the first to control',
  '   two of them for 3 turns straight — which each turn a player control a control point',
  '   give them a point, when they lose it take away the point. So this gives players',
  '   another way to win outside of killing the players hero."',
  '',
  'Read that carefully; it is two mechanics, not one:',
  ' (a) A RUNNING SCORE. Each turn a player holds a control point, they gain a point. When',
  '     they lose it, they lose the point. That is a score that goes up AND down.',
  ' (b) A WIN CONDITION. Holding TWO of the three for THREE STRAIGHT TURNS wins the match,',
  '     without killing the enemy hero. "Straight" means consecutive — the streak resets the',
  '     moment they drop below two.',
  'Implement both. If you believe the wording is ambiguous anywhere, implement the reading',
  'that matches the stated intent ("another way to win outside of killing the hero"), say',
  'clearly in a comment which reading you took and why, and flag it in knownGaps.',
  '',
  'CONTRACT.md section 5 has the seams; verify the drifted line numbers yourself:',
  ' - startTurn is the only symmetric per-side hook. !! turnNumber increments in TWO places',
  '   (single-player and multiplayer) — tick on WHO, never on turnNumber, or the score',
  '   double-counts in one mode and not the other.',
  ' - There is an existing hold-the-tile capture pattern (the oil-tower capture) to copy,',
  '   AND a comment right above it documenting a REJECTED per-unit-marker design that',
  '   silently froze progress at 0. Read that comment before designing yours.',
  ' - The existing objective evaluator is gated on a Territory-Wars flag. Our mode must work',
  '   in NORMAL battles — do not inherit that gate, or you will tick forever and never win.',
  ' - state.gameOver names the WINNER and is set at ~65 sites, and can be CLEARED from',
  '   inside the render by the hero-guardian path. Set it the way the existing victory paths',
  '   set it, and make sure a control-point win survives that render pass.',
  '',
  'CAPTURE RULES: define clearly and comment WHY — who holds a point (a unit on it? nearest?',
  'uncontested?), what contested means, and what happens when both sides have units on it.',
  'Simple and legible beats clever; the player must be able to see why they are or are not',
  'holding a point.',
  '',
  'HUD (BAR.md R3, and CONTRACT.md section 6 for the exact style tokens — Cinzel labels, the',
  '.bchrome and .bcp palettes, the double-gradient panel border, the .envcard chip as the',
  'tracker-tile template):',
  ' - A persistent objective banner: what must happen, in one plain sentence. There is an',
  '   already-styled .tw-objective-banner class that is never emitted — a free class.',
  ' - A three-point tracker showing who holds each point, each side score, and — critically',
  '   — the STREAK: "2 of 3 held - 2 turns straight". A player must be able to see they are',
  '   one turn from losing.',
  ' - Restyle to fit the battlefield; do not rebuild the panels or move them.',
  '',
  'DRAWING: three SCP trucks with nodes, drawn procedurally on the board, visibly showing',
  'which side holds each one. Placed deterministically from the same map seed, spread so no',
  'one side starts holding two.',
  '',
  'VERIFY — required, paste real output:',
  '  cd ' + ROOT + ' && node _synckcheck.mjs',
  '  Then PROVE THE RULE by executing it, not by reading it: simulate a match state in real',
  '  Chromium and step turns — hold two points for three straight turns and confirm the game',
  '  ends with the right winner; break the streak at turn 2 and confirm it RESETS rather than',
  '  carrying over; lose a point and confirm the score goes DOWN. Paste the actual turn-by-',
  '  turn numbers you observed. A capture rule that was never executed is not implemented.',
  '  Capture a scene showing the trucks and the HUD, and READ it back.',
].join('\n')

const O_CRITIQUE = COMMON + [
  'You are a FRESH-CONTEXT CRITIC for the control-point objective mode. You did not build it.',
  '',
  '1. EXECUTE THE RULE, DO NOT READ IT. Drive the shipped code in real Chromium and step a',
  '   match through turns. Verify, with actual numbers you observed:',
  '   - holding a point for a turn ADDS a point; losing it SUBTRACTS one',
  '   - holding two of three for three CONSECUTIVE turns ends the match with that side winning',
  '   - a streak broken at turn 2 RESETS to zero and does not carry over',
  '   - the win works in a NORMAL battle, not only under a Territory-Wars flag',
  '   - the win survives the render pass (the hero-guardian path can clear gameOver)',
  '   Any of these that you cannot make happen is a "fail".',
  '2. THE DOUBLE-COUNT TRAP: turnNumber increments in two different places for single-player',
  '   and multiplayer. Verify the tick fires exactly once per side per turn in BOTH modes.',
  '   This is the most likely silent bug in the piece.',
  '3. Verify the AI is not oblivious: does the enemy ever contest a point? If the AI ignores',
  '   objectives entirely, the alternate win condition is free for the player and the mode is',
  '   hollow. Report what you find — it may be a legitimate knownGap, but it must be named.',
  '4. HUD: capture it and READ the image. Can you tell, at a glance, who holds what, the',
  '   score, and how many turns of streak remain? BAR R3 wants a persistent objective banner',
  '   and a visible clock. Is the styling consistent with the existing battle chrome, or does',
  '   it look bolted on?',
  '5. Determinism: same seed gives the same truck placement. Execute it.',
  '6. REGRESSION per BAR.md standing constraint: the ordinary hero-death victory must still',
  '   work, and the turn loop must be unchanged for everything else. Test it.',
  '   node _synckcheck.mjs clean.',
  '',
  'Name ONE biggest gap with an actionable fixDirective.',
].join('\n')

/* ═══════════ Run ═══════════ */

phase('Build')

const TRACKS = [
  { key: 'stage', name: 'Terrain fixes + unclickable-tile bug', build: A_BUILD, critique: A_CRITIQUE },
  { key: 'ruins', name: 'Five lootable ruins', build: B_BUILD, critique: B_CRITIQUE },
]

const r1 = await pipeline(
  TRACKS,
  t => agent(t.build, { label: 'build:' + t.key, phase: 'Build', schema: BUILD_RESULT }),
  (built, t) => agent(
    t.critique + '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(built, null, 2),
    { label: 'critic:' + t.key, phase: 'Critique', schema: VERDICT })
    .then(v => ({ track: t, built: built, verdict: v })),
)

const live = r1.filter(Boolean)
live.forEach(r => log('R1 ' + r.track.key + ': ' + (r.verdict && r.verdict.verdict) + ' — ' + String(r.verdict && r.verdict.biggestGap).slice(0, 130)))

phase('Objectives')

const objBuilt = await agent(O_BUILD, { label: 'build:objectives', phase: 'Objectives', schema: BUILD_RESULT })
const objVerdict = await agent(
  O_CRITIQUE + '\n\nBuilder claim (verify, do not trust):\n' + JSON.stringify(objBuilt, null, 2),
  { label: 'critic:objectives', phase: 'Objectives', schema: VERDICT })
log('objectives: ' + objVerdict.verdict + ' — ' + String(objVerdict.biggestGap).slice(0, 130))

phase('Rework')

const all = live.map(r => ({ key: r.track.key, name: r.track.name, brief: r.track.build, critique: r.track.critique, verdict: r.verdict }))
all.push({ key: 'objectives', name: 'Control points', brief: O_BUILD, critique: O_CRITIQUE, verdict: objVerdict })
const todo = all.filter(r => r.verdict && r.verdict.verdict !== 'pass')
log(todo.length + '/' + all.length + ' to rework')

const reworked = await pipeline(
  todo,
  r => agent(
    COMMON +
    'You are the builder for: ' + r.name + '. An independent critic ran your real output.\n\n' +
    'VERDICT: ' + r.verdict.verdict + '\n' +
    'BIGGEST GAP: ' + r.verdict.biggestGap + '\n' +
    'FIX DIRECTIVE: ' + r.verdict.fixDirective + '\n' +
    'REGRESSIONS: ' + JSON.stringify(r.verdict.regressions || []) + '\n' +
    'EVIDENCE CITED: ' + JSON.stringify(r.verdict.evidence || []) + '\n\n' +
    'Close that gap. Do not restart, do not widen scope, do not regress anything already\n' +
    'working. Re-verify by EXECUTING, exactly as your original brief demanded.\n\n' +
    'Original brief:\n' + r.brief,
    { label: 'rebuild:' + r.key, phase: 'Rework', schema: BUILD_RESULT }),
  (rebuilt, r) => agent(
    r.critique + '\n\nROUND 2. The gap named last round was:\n"' + r.verdict.biggestGap + '"\n' +
    'Verify it is ACTUALLY closed, by running the thing yourself. Then look once more for\n' +
    'anything the fix broke. A fix that closes the gap but regresses something is "fail".\n\n' +
    'Builder round-2 claim:\n' + JSON.stringify(rebuilt, null, 2),
    { label: 'recritic:' + r.key, phase: 'Rework', schema: VERDICT })
    .then(v => ({ key: r.key, verdict: v })),
)

const out = {}
all.forEach(r => { out[r.key] = { r1: r.verdict && r.verdict.verdict, gap1: r.verdict && r.verdict.biggestGap } })
reworked.filter(Boolean).forEach(r => { out[r.key].r2 = r.verdict && r.verdict.verdict; out[r.key].gap2 = r.verdict && r.verdict.biggestGap })

return out
