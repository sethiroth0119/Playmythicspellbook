/* 🏹 v121v149 — THE AIMING ARROW. Run: node _aimarrow_smoke.mjs

   Owner: "add the arrow for when a player is targeting to see who the player is
   hovering over or a Tile they are hovering over. Add the arrow for when a
   player is placing a unit or enchantment have the arrow green when it can be
   place in a tile and red when it cannot."

   The load-bearing claim is NOT that an arrow is drawn — it is that green and
   red can never disagree with the click gate. The arrow's legality test is a
   lookup in the very array renderBattle handed the gate that same render, and
   these checks pin that: the set is published from renderBattle, it is the same
   `validPlacement` the tiles are lit from, and the push only ever looks it up. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const BB  = readFileSync('./public/battle-board/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the board can draw the two new sides ─────────────────────────────────── */
ok(/const aimOk   = \(a\.side === 'ok'\);/.test(BB), 'the board knows a LEGAL aim arc');
ok(/const aimDeny = \(a\.side === 'no'\);/.test(BB), '…and an ILLEGAL one');
ok(/const col  = aimOk \? '#7fe89f' : aimDeny \? '#ff5a4a' : \(mine \? '#7fd8ff' : '#ff5a4a'\);/.test(BB),
  'GREEN is the exact colour the board already strokes legal deploy tiles with, and RED the attack red — the arrow agrees with the tiles under it instead of adding a third palette');
ok(/PAINT\.place\.has\(key\)\) +col = '#7fe89f';/.test(BB),
  '…and that green really is the placement colour, not a coincidence');
ok(/for \(let k=0;k<3 && !aimDeny;k\+\+\)\{/.test(BB),
  'a DENIED arrow loses the travelling charge — flow toward a tile the click will refuse is the picture contradicting the rule');
ok(/mine \? '#7fd8ff'/.test(BB) && /const mine = a\.side !== 'foe';/.test(BB),
  'the original mine/foe attack arc is untouched — anything that is not an aim side still falls through to it');

/* ── the host publishes the set, and it is the CLICK GATE's own set ───────── */
ok(/aim: _aim,/.test(SRC), 'renderBattle publishes the aim set beside the four paint sets');
{
  const lo = SRC.indexOf('let _aim = null;');
  const hi = SRC.indexOf('App._bbPaint = { move: validMoves');
  ok(lo > 0 && hi > lo, 'the aim block sits immediately before the paint publish');
  const blk = SRC.slice(lo, hi);
  ok(/tiles: validPlacement\.slice\(\)/.test(blk),
    'PLACEMENT AIMS AT validPlacement ITSELF — the same array the tiles are lit from and the click gate reads, so green can never land on a tile the click refuses');
  ok(/if \(moveCard && validPlacement\.length\)/.test(blk),
    'a card in hand is what arms the green/red arrow');
  ok(/_tgtSet\.has\(u\.id\)/.test(blk), 'the queued effect-target step contributes its targets');
  ok(/_sacSet\.has\(u\.id\)/.test(blk), '…sacrifice targeting contributes its offerable units');
  ok(/for \(const t of consumableTargets\)/.test(blk),
    '…and consumable, skill and Polycreation placement all arrive through the one list they already share');
  ok(/const c = q && \(s\.units \|\| \[\]\)\.find\(u => u && u\.id === q\.casterId/.test(blk),
    'a queued effect arrow starts at its CASTER, which the queue entry already carries');
  ok(/if \(_tiles\.length && _src\)/.test(blk) && /if \(_heroP\) _aim =/.test(blk),
    'NO ORIGIN MEANS NO ARROW — with no hero alive there is no honest source, and an arrow from nowhere is worse than none');
}

/* ── the push draws it, and it owns the telegraph ─────────────────────────── */
{
  const lo = SRC.indexOf('const aim = p.aim;');
  ok(lo > 0, 'the telegraph push reads the aim set');
  const blk = SRC.slice(lo, lo + 900);
  ok(/side: legal \? 'ok' : 'no'/.test(blk), 'legal paints green, illegal paints red');
  ok(/const legal = \(aim\.tiles \|\| \[\]\)\.some\(t => t && \(t\.x \| 0\) === ax && \(t\.y \| 0\) === az\);/.test(blk),
    'THE TEST IS A LOOKUP IN THE PUBLISHED SET — the board is never asked to re-derive a rule, which is the telegraph\'s own standing constraint');
  ok(/payload\.arcs = \[\];/.test(blk) && /payload\.path = \[\]; payload\.dest = null;/.test(blk),
    'aiming CLEARS the move ribbon and the attack fan — two stories drawn at once is the failure the AI-trail branch is an else-if to avoid');
  ok(/h && h\.x >= 0/.test(blk),
    'it needs a live hover, so pointer-leave (which sends x < 0) removes the arrow on the very next push — no timer, no stale arrow');
}
ok(SRC.indexOf('const aim = p.aim;') > SRC.indexOf('payload.threat = _bbTeleThreat(s);'),
  'it is written LAST, so it wins over every earlier branch rather than racing them');

/* ── run the decision for real ────────────────────────────────────────────── */
{
  const tiles = [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }];
  const arc = (aim, hx, hz) => {
    if (!(aim && aim.src)) return null;
    const ax = hx | 0, az = hz | 0;
    const legal = (aim.tiles || []).some(t => t && (t.x | 0) === ax && (t.y | 0) === az);
    return { from: aim.src, to: { x: ax, z: az }, side: legal ? 'ok' : 'no' };
  };
  const aim = { kind: 'place', src: { x: 3, z: 3 }, tiles };
  ok(arc(aim, 3, 4).side === 'ok', 'run for real: hovering a legal placement tile gives a GREEN arrow');
  ok(arc(aim, 9, 9).side === 'no', 'run for real: hovering anywhere else gives a RED one');
  ok(arc(aim, 3, 4).from.x === 3 && arc(aim, 3, 4).from.z === 3, 'run for real: it starts at the actor, not at the tile');
  ok(arc({ src: null, tiles }, 3, 4) === null, 'run for real: no source, no arrow');
  ok(arc({ src: { x: 1, z: 1 }, tiles: [] }, 3, 4).side === 'no',
    'run for real: an EMPTY legal set makes every tile red — a mode with nothing playable never shows green');
}

/* the knobs — the board file changed, so its own cache-buster had to move */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
const bbv = (SRC.match(/const BB_VER = '([^']+)'/) || [])[1];
const bbb = (BB.match(/window\.BB_BUILD='([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 149, 'BUILD_VERSION is v121v149 or later', v);
ok(bbv === bbb, 'BB_VER and BB_BUILD moved together — the iframe cache-buster is the board\'s ONLY one', bbv + ' vs ' + bbb);
/* ⚠ RE-DATED 2026-09-14 (v121v160). This asserted /v149/ literally — the build
   it was written in — so it failed on the first release that touched the board
   afterwards, and it failed for the RIGHT reason expressed the wrong way: the
   pair had moved to v160 exactly as it should. The intent is "the board pair
   carries the CURRENT build, so no client keeps the old board", which is a
   comparison against BUILD_VERSION, not against a literal. Kept, not deleted:
   the v159 release shipped nineteen new tile surfaces into the board file while
   BB_VER sat at v121v149-aim, which is precisely what this check exists to
   catch. */
ok((bbv || '').indexOf(v || '§') === 0, '…and they carry this build, so no client keeps the old board', bbv + ' vs ' + v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
