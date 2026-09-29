/* ══════════════════════════════════════════════════════════════════════════
   SCOPE CHECK — is the symbol REACHABLE, not merely present.

   WHY THIS EXISTS, and it is not hypothetical.
   On 2026-09-15 a sibling session landed a vocabulary block one line too early,
   so `const TRAP_MODES` came to rest INSIDE `getCardRange`'s body instead of at
   top level. It was valid JavaScript. `_synckcheck` passed. `comment-scan`
   passed. `grep "const TRAP_MODES"` found it. And the Forge's trap-mode
   dropdown rendered with zero options, because the editor asks
   `typeof TRAP_MODES !== 'undefined'` and got the honest answer: the const
   ceased to exist the moment the function returned.

   The check a reasonable person writes — grep for the symbol — CANNOT answer
   this. A text search tells you a declaration exists somewhere. It cannot tell
   you what scope it is in, and therefore cannot tell you whether anything else
   can see it.

   That matters here because the board page is a ~830 KB classic script whose
   painters call each other by bare name across thousands of lines. A helper
   that lands inside a neighbouring function is invisible to every caller, and
   the symptom is not an exception — `artImage()` answers null, a tile keeps its
   palette swatch, and the board renders looking merely disappointing. The whole
   TILE_ART contract is built to degrade quietly, which means this class of bug
   degrades quietly too.

   🔴 THE NEGATIVE CONTROL RUNS FIRST. A gate nobody has seen fail is not
   evidence. Before asserting anything about the real file, this parses a
   snippet whose declaration is deliberately nested and FAILS THE WHOLE RUN if
   the walker reports it as top-level. Five separate bugs in two days shared the
   shape "a green check that was answering an adjacent question"; this is the
   cheapest defence against being the sixth.

   Usage:  node .gauntlet/tabletop/scopecheck.mjs
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

/* Collect every name declared directly in a Program body — function
   declarations, and the binding identifiers of top-level var/let/const. Nested
   declarations are deliberately NOT collected; that is the entire point. */
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

/* ── 0. THE NEGATIVE CONTROL ──────────────────────────────────────────────
   Two snippets, identical except for where the declaration sits. If the
   walker cannot tell them apart it is not a scope check and nothing below it
   means anything, so this exits non-zero rather than merely reporting. */
console.log('--- 0. negative control (the walker must be able to fail) ---');
{
  const nested = `function getCardRange(c){ if(c.t==='spell') return 1; const TRAP_MODES=['a']; return 2; }`;
  const top    = `const TRAP_MODES=['a']; function getCardRange(c){ return 2; }`;
  const nestedNames = topLevelNames(acorn.parse(nested, { ecmaVersion: 2022 }));
  const topNames    = topLevelNames(acorn.parse(top,    { ecmaVersion: 2022 }));

  ok('a NESTED declaration is NOT reported as top-level', !nestedNames.has('TRAP_MODES'),
     'the walker cannot see scope — every assertion below is worthless');
  ok('a TOP-LEVEL declaration IS reported as top-level', topNames.has('TRAP_MODES'),
     'the walker reports nothing — every assertion below would pass vacuously');

  if (fails){
    console.log('\n🔴 NEGATIVE CONTROL FAILED. Refusing to report on the real files.');
    process.exit(1);
  }
}

/* ── 1. THE BOARD PAGE ────────────────────────────────────────────────────
   The stage is one big classic <script>. Parse the largest inline script and
   assert the painters this pass added are reachable from their callers. */
console.log('\n--- 1. public/battle-board/index.html (the canvas stage) ---');
{
  const html = fs.readFileSync(path.join(ROOT, 'public/battle-board/index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  ok('found inline script blocks', blocks.length > 0);
  const src = blocks.sort((a, b) => b.length - a.length)[0] || '';
  ok('largest inline block is the stage (>300 KB)', src.length > 300_000, src.length + ' chars');

  let program = null;
  try { program = acorn.parse(src, { ecmaVersion: 2022 }); }
  catch (e) { ok('the stage parses', false, e.message); }

  if (program){
    ok('the stage parses', true);
    const names = topLevelNames(program);

    /* Everything this pass added or re-signed, plus the anchors they are
       called from. A helper unreachable from its caller is the bug. */
    const REQUIRED = [
      'wallLamBand',      // round 3: the camera-facing lam band per hex edge
      'tileArtTopInk',    // round 2: cached mean RGB of a tile painting's top
      'tileArtTopDrawn',  // round 2: the top face AS DRAWN, not the palette
      'rgbHexRaw',
      'drawTileRim',      // tile-edge-physical: the rim on all six sides
      'rimSpec',
      'shadeSkirtCell',   // table-and-shadow r6: the skirt shades itself
      'skirtShadeAt',     //   …through the probe vista.js hands over
      'slabPieces',       //   …and the silhouette it is filled over
      'paintSkirtCell',   // the caller that must see shadeSkirtCell
      'paintWalls',       // the caller that must see wallLamBand
      'paintTileRec',     // the caller that must see drawTileRim
      /* reach-cue (TABLETOP-BAR §12): the air half of the move telegraph.
         drawTeleReach is called by bare name from frame()'s air pass and
         teleReachPoints() is called by bare name from BOTH the painter and
         every gate under .gauntlet/tabletop/_reach-*.mjs (through window). Land
         either one inside a neighbouring function and there is no exception:
         the pips simply stop appearing, which looks exactly like the crowding
         fix never having been made. */
      'REACH_CUE',
      'TELE_MOVE_COL',    // the ONE move colour the contour and the pips share
      'telePips',         // the cached per-tile anchors
      'teleReachPoints',  // …projected; the painter's and the probes' one source
      'drawTeleReach',    // the air pass itself
      'teleLoops',        // the cache both halves of the telegraph read
      'terrainKeyParts',  // the single cache-invalidation point
      'artImage',
      'tileArtLoaded',
      'TILE_ART',
      'SURF',
      '_SURF_ORDER',
      '_surfCode',
      'buildHeightfield',
      'tileElevRungs',
      /* 🟥🟦 player platforms (2026-09-16). Called by bare name from frame()'s
         depth pass, buildStage(), the resize listener, handleHostMessage() and
         summonUnit(). Every one of those sits in a try or a guarded branch, so a
         nested declaration here would not throw where anyone looks — the daises
         would just never appear, or never glow. */
      'PLATFORM_ART',
      'PLATFORM_LAYOUT',
      'PLATFORM_GLOW',
      'PLATFORMS',
      'platformOwner',    // the ONE place the colour rule is applied
      'platformGlow',
      'platformGlowAmt',
      'platformRect',
      'platformFrameX',
      'platformPlace',
      'seedPlatforms',
      'seedPlatformsAtHome',
      'platformSprite',
      'drawPlatform',
      'buildStage',       // the callers that must see them
      'handleHostMessage',
      'summonUnit',
      'fitReport',
    ];
    for (const id of REQUIRED)
      ok(`${id} is reachable at top level`, names.has(id),
         'declared somewhere but NOT at top level — callers cannot see it');
  }
}

/* ── 2. ley.js ────────────────────────────────────────────────────────────
   Different shape on purpose: ley.js is an IIFE module, so its helpers are
   correctly NOT at Program top level. What matters there is that the resolver
   is reachable from seed() and is on the export table — being nested inside
   the IIFE is right, being nested inside seed() would not be. */
console.log('\n--- 2. public/src/battle/ley.js (IIFE module) ---');
{
  const src = fs.readFileSync(path.join(ROOT, 'public/src/battle/ley.js'), 'utf8');
  let program = null;
  try { program = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script' }); }
  catch (e) { ok('ley.js parses', false, e.message); }

  if (program){
    ok('ley.js parses', true);
    /* Find the IIFE body and treat THAT as the module's top level. */
    let body = null;
    for (const node of program.body){
      const ex = node.type === 'ExpressionStatement' ? node.expression : null;
      const call = ex && (ex.type === 'CallExpression' ? ex : (ex.type === 'UnaryExpression' ? ex.argument : null));
      const fn = call && call.callee && /FunctionExpression/.test(call.callee.type) ? call.callee : null;
      if (fn && fn.body && fn.body.body && fn.body.body.length > 5){ body = fn.body; break; }
    }
    ok('found the module IIFE', !!body);
    if (body){
      const names = topLevelNames(body);
      for (const id of ['surfSeedFor', 'SURF_SEED', 'EDITOR_SEED', 'LEY'])
        ok(`${id} is at module scope`, names.has(id),
           'nested deeper than the module — seed() and the export table cannot see it');
    }
  }
}

console.log(`\n${fails ? '❌' : '✅'} ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
