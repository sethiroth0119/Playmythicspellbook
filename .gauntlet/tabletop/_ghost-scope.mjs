/* ══════════════════════════════════════════════════════════════════════════
   👻 OCCLUDER-GHOST SCOPE CHECK — are the piece's symbols REACHABLE?

   Same instrument and same reason as scopecheck.mjs; a separate file only
   because scopecheck.mjs's REQUIRED list belongs to the shared tree and this
   piece owns nothing there. When the lead folds this piece in, these ten names
   should move into scopecheck.mjs's list and this file should go away.

   WHY IT MATTERS HERE SPECIFICALLY. drawOccluderGhost is called by bare name
   from frame()'s air pass and GHOST_ORDER is written by bare name from the
   actor loop. Land either one line too deep and there is no exception and no
   console error: the ghost simply never appears, which is indistinguishable
   from the piece never having been landed at all — the exact failure mode the
   reach cue's entry in scopecheck.mjs was added for. sideInk is worse again,
   because it has TWO readers in two different functions (drawUnit's foot ring
   and ghostOne's patch) and §12.3.4's whole argument is that those two agree.

   🔴 THE NEGATIVE CONTROL RUNS FIRST and exits non-zero on its own. A walker
   that cannot tell a nested declaration from a top-level one makes every
   assertion below pass or fail for reasons that have nothing to do with the
   file, so it is proved able to fail before it is believed.

   Usage:  node .gauntlet/tabletop/_ghost-scope.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
let fails = 0, passes = 0;
const ok = (msg, cond, detail = '') => {
  if (cond) { passes++; console.log('  ✅ ' + msg); }
  else { fails++; console.log('  ❌ ' + msg + (detail ? '  <-- ' + detail : '')); }
};

function topLevelNames(program){
  const names = new Set();
  for (const node of program.body){
    if (node.type === 'FunctionDeclaration' && node.id) names.add(node.id.name);
    else if (node.type === 'VariableDeclaration')
      for (const d of node.declarations)
        if (d.id && d.id.type === 'Identifier') names.add(d.id.name);
  }
  return names;
}

console.log('--- 0. negative control (the walker must be able to fail) ---');
{
  /* Deliberately shaped like the real mistake: a helper that came to rest
     inside the painter directly above it. */
  const nested = `function drawTeleReach(t){ if(!t) return; function drawOccluderGhost(){} const GHOST_CUE={on:1}; }`;
  const top    = `function drawOccluderGhost(){} const GHOST_CUE={on:1}; function drawTeleReach(t){ return t; }`;
  const N = topLevelNames(acorn.parse(nested, { ecmaVersion: 2022 }));
  const T = topLevelNames(acorn.parse(top,    { ecmaVersion: 2022 }));
  ok('a NESTED drawOccluderGhost is NOT reported as top-level', !N.has('drawOccluderGhost'),
     'the walker cannot see scope — everything below is worthless');
  ok('a NESTED GHOST_CUE is NOT reported as top-level', !N.has('GHOST_CUE'));
  ok('a TOP-LEVEL drawOccluderGhost IS reported as top-level', T.has('drawOccluderGhost'),
     'the walker reports nothing — everything below would pass vacuously');
  if (fails){
    console.log('\n🔴 NEGATIVE CONTROL FAILED. Refusing to report on the real file.');
    process.exit(1);
  }
}

console.log('\n--- 1. public/battle-board/index.html ---');
{
  const html = fs.readFileSync(path.join(ROOT, 'public/battle-board/index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const src = blocks.sort((a, b) => b.length - a.length)[0] || '';
  ok('found the stage script (>300 KB)', src.length > 300_000, src.length + ' chars');
  const program = acorn.parse(src, { ecmaVersion: 2022 });
  ok('the stage parses', true);
  const names = topLevelNames(program);
  const REQUIRED = [
    'SIDE_INK',           // the one pair of side literals…
    'sideInk',            // …and its reader, shared by the foot ring and the ghost
    'GHOST_CUE',          // the knob every gate in _ghost-ab.mjs pivots on
    'GHOST_ORDER',        // written by frame(), read by drawOccluderGhost
    'ghostBuf',           // the three scratch canvases
    'ghostAnchor',        // foot + k, from drawUnit's own three lines
    'ghostFigure',        // one unit painted into an arbitrary context
    'ghostOne',           // one hidden unit + its occluders
    'drawOccluderGhost',  // the pass itself, called bare from frame()
    /* the anchors it is wired between — if any of these moved scope the wiring
       is broken even when every name above is fine */
    'drawUnit', 'drawTeleReach', 'unitScreenBox', 'unitScreenH', 'unitGroundY', 'paintSprite',
  ];
  for (const id of REQUIRED)
    ok(`${id} is reachable at top level`, names.has(id),
       'declared somewhere but NOT at top level — callers cannot see it');

  /* Wiring, not just presence: the two bare-name call sites have to exist. */
  ok('frame() calls drawOccluderGhost by bare name',
     /try \{ drawOccluderGhost\(T\); \} catch \(e\) \{\}/.test(src),
     'the pass is declared but nothing invokes it');
  ok('drawOccluderGhost runs BEFORE drawTeleReach (the pips stay last board-space)',
     src.indexOf('drawOccluderGhost(T);') < src.indexOf('drawTeleReach(T);'),
     'the reach pips are no longer the last board-space pass');
  ok('GHOST_ORDER is filled from the painter\'s sort, not recomputed',
     /drawables\.sort\(\(a,b\) => b\.d - a\.d\);[\s\S]{0,900}?GHOST_ORDER = drawables\.filter/.test(src),
     'the ghost has grown a second opinion about what is in front of what');
  ok('the foot ring reads sideInk rather than its own literals',
     !/const col = foe \? '224,85,60'/.test(src) && /const ink = sideInk\(u\);/.test(src),
     'the ring and the ghost can now drift apart — §12.3.4');
}

console.log(`\n${fails ? '❌' : '✅'} ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
