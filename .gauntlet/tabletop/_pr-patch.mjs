/* procedural-ruins round 1 — patch vista.js.
   Run: node .gauntlet/tabletop/_pr-patch.mjs
   Idempotent: refuses if RIDGES_ON is already present. */
import fs from 'fs';

const P = 'public/src/battle/stage/vista.js';
let s = fs.readFileSync(P, 'utf8');
if (s.includes('\r\n')) { console.error('FAIL: file has CRLF'); process.exit(1); }
if (s.includes('RIDGES_ON')) { console.error('FAIL: already patched'); process.exit(1); }

/* ── 1. the three ranges get wrapped in the switch ──────────────────────── */
const START = '    /* FAR range. Suppressed when the location supplies backdrop art';
const END = "      lw: 1.7, form: 1.0, lightX: lightX, key: 'near'\n    });\n";

const i = s.indexOf(START);
if (i < 0) { console.error('FAIL: START anchor not found'); process.exit(1); }
const j = s.indexOf(END, i);
if (j < 0) { console.error('FAIL: END anchor not found'); process.exit(1); }
const jEnd = j + END.length;
if (s.indexOf(START, i + 1) >= 0) { console.error('FAIL: START anchor not unique'); process.exit(1); }

const body = s.slice(i, jEnd);
if ((body.match(/ridgeLayer\(api, g, \{/g) || []).length !== 3) {
  console.error('FAIL: expected exactly 3 ridgeLayer calls in the slice, got',
    (body.match(/ridgeLayer\(api, g, \{/g) || []).length);
  process.exit(1);
}

const indented = body.split('\n').map(l => (l.length ? '  ' + l : l)).join('\n');

const HEAD = [
  '    /* 🔴 THE SKYLINE IS OFF. See RIDGES_ON above bakeLand for the whole',
  '       argument; the switch is read HERE because this is the only place the',
  '       three ranges are ever drawn from, so gating it here is the difference',
  '       between "the mesas are not painted" and "the mesas are painted and',
  '       then covered", which is the bug the pillars piece had to avoid too.',
  '       Everything inside is kept byte-for-byte: the fog ordering, the two',
  '       `⚠ it has to clear the TERRAIN` sizing notes and the burn-24-draws',
  '       branch are four rounds of measurement and re-deriving them would cost',
  '       far more than a dead branch costs. Flip RIDGES_ON to bring it back. */',
  '    if (RIDGES_ON) {',
  ''
].join('\n');
const TAIL = '    }\n';

s = s.slice(0, i) + HEAD + indented + TAIL + s.slice(jEnd);

/* ── 2. the switch itself, immediately above bakeLand ───────────────────── */
const BL = '  function bakeLand(api, dpr, artWins, into) {';
if (s.indexOf(BL) < 0) { console.error('FAIL: bakeLand anchor not found'); process.exit(1); }
if (s.indexOf(BL) !== s.lastIndexOf(BL)) { console.error('FAIL: bakeLand anchor not unique'); process.exit(1); }

const SWITCH = [
  '  /* ══ 🏜 THE PROCEDURAL SKYLINE — SWITCHED OFF. TABLETOP BAR §2/§6, Ask G ══',
  '',
  '     WHAT THIS TURNS OFF: the three ridgeLayer() ranges in bakeLand (far, mid,',
  '     near) — the seeded mesa-and-butte desert skyline that stands behind the',
  '     board from one edge of the frame to the other. Nothing else. The haze',
  '     band, THE ROOM LINE, tableField() and the board shadow all still run.',
  '',
  '     🔴 FIRST, THE THING THIS PIECE WAS BRIEFED TO REMOVE IS ALREADY GONE, AND',
  '     SAYING SO IS PART OF THE FIX. The brief was "remove the ~26 procedural',
  '     ruin silhouettes the painted backdrop was hiding". Those 26 buildings were',
  '     never in this module: they lived in the board page\'s FALLBACK sky and were',
  '     deleted outright by f936ecee69 ("the tiles became pieces, and the ruined',
  '     city came down"), which left a long tombstone comment in their place. They',
  '     could not have been on screen in any case — this module\'s draw() replaces',
  '     that entire fallback path (see the header), so the fallback only paints on',
  '     a cold first frame or if this module throws. Checked, not assumed:',
  '     .gauntlet/tabletop/_pr-reach.mjs asks "can anything draw a skyline behind',
  '     the board", not "does the word ruin appear", and it has a negative control.',
  '',
  '     WHAT IS ACTUALLY BEHIND THE BOARD IN A REAL SHOT IS THIS DESERT. So the',
  '     owner\'s note — the background behind the board has to go — lands here now.',
  '',
  '     WHY IT GOES, IN THE BAR\'S OWN WORDS. §2: "whatever surrounds the board',
  '     reads as the surface it rests on … never as landscape continuing to a',
  '     horizon", then "no sky doing scenery work". A range of buttes running off',
  '     both edges of the frame IS that read; that the place is rock rather than a',
  '     city does not change which of the two readings a player gets, and §2 is',
  '     scored on the reading. §6 names the three replacements it will accept — a',
  '     table surface, an arena floor, a dark vignette — and two of the three are',
  '     already built and already sit underneath this: tableField() paints the',
  '     table and THE ROOM LINE (end of bakeLand) paints the dark junction where',
  '     it stops. Removing the ranges is what lets either of them be the thing the',
  '     eye lands on behind the board instead of the third-brightest cliff.',
  '',
  '     ⚠ VERIFIED NOT LOAD-BEARING BEFORE FLIPPING IT, because the worry was the',
  '     right one to have and the brief said to stop if it was true. ridgeLayer()',
  '     has no other caller (grep: three calls, all in bakeLand). It writes only',
  '     into the land bake\'s own canvas; nothing reads its pixels back — the',
  '     probes that do read canvases back (shadowProbe, discProbe, coolThumb,',
  '     shadowThumb, artDetField) read the composited frame or the SKY bake, and',
  '     each one measures a statistic that is defined with or without a ridge in',
  '     it. It is not in any cache key: bakeKeys()/lightKey() key the land bake on',
  '     the light rig and the geometry, and RIDGES_ON is a module constant, so the',
  '     bake is self-consistent for the life of the page either way. And it is not',
  '     in terrainKeyParts — that is the board page\'s PER-TILE key and this is not',
  '     a per-tile input; adding a constant to it would only invalidate every',
  '     ground bake for nothing.',
  '',
  '     ⚠ WHAT I DELIBERATELY DID NOT DO, so the next reader does not redo it.',
  '     (a) I did not paint a room WALL over the sky. bakeWorld\'s order is sky,',
  '         art, body, shafts, LAND, and draw() paints the body live again over',
  '         the far bake in the cross-fade path — so an opaque band drawn here',
  '         would swallow the sun on one path and have the sun drawn on top of it',
  '         on the other. A wall behind the board is a real answer to §2 but it',
  '         has to be built where the body is, not here.',
  '     (b) I did not dim or recolour the sky, and I did not retune the haze',
  '         band\'s warm desert-dust hue now that there is no desert. Both are',
  '         `staged-lighting`\'s piece and it names them; doing them here would',
  '         mean two sessions grading the same pixels.',
  '     🔴 SO THE HONEST STATE AFTER THIS PIECE is a bright sky meeting the dark',
  '     room line above a table. That is strictly less "standing in a place" than',
  '     a canyon and strictly more than §2 finally wants. The remaining gap is the',
  '     sky, and it belongs to the piece that owns the grade.',
  '',
  '     KEPT, NOT DELETED, exactly like PYLONS_ON in the board page: this is a',
  '     taste call the owner can reverse, and ridgeLayer() carries five measured',
  '     passes (face split, talus, strata, gullies, fluting) plus the aerial',
  '     ordering that round 3B spent a whole round establishing. Flip to true. */',
  '  const RIDGES_ON = false;',
  '',
  ''
].join('\n');

s = s.slice(0, s.indexOf(BL)) + SWITCH + s.slice(s.indexOf(BL));

/* ── 3. a pointer on ridgeLayer itself, so a grep for the generator finds it ── */
const RL = '  function ridgeLayer(api, g, opt) {';
if (s.indexOf(RL) < 0) { console.error('FAIL: ridgeLayer anchor not found'); process.exit(1); }
const NOTE = [
  '  /* ⚠ DORMANT. Every call to this lives behind RIDGES_ON (above bakeLand),',
  '     which is false: TABLETOP-BAR §2 does not allow a landscape horizon behind',
  '     the board. The code below is kept deliberately — read that switch before',
  '     deleting, retuning or re-deriving any of it. */',
  ''
].join('\n');
s = s.slice(0, s.indexOf(RL)) + NOTE + s.slice(s.indexOf(RL));

fs.writeFileSync(P, s);
console.log('patched', P, '— RIDGES_ON added, 3 ranges gated');
