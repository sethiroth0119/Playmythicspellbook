/* ══════════════════════════════════════════════════════════════════════════
   reach-cue — THE GEOMETRY GATE, and its negative control.

   THE QUESTION THAT MATTERS (§12.2 / §12.3.1): for a tile whose GROUND THE
   PLAYER CANNOT SEE, does the cue land where the body hiding it cannot be?

   Not "is a cue drawn" — drawTeleReach runs after the depth-sorted actor loop,
   so of course it is drawn; a check that only asked that would go green for a
   cue smeared flat across a pile of sprites.

   🔴 AND NOT "does any pip overlap any unit box" EITHER, which is where this
   file started and is worth recording because the wrong question wore the
   right question's clothes for a whole round. Swept 0.05 → 4.0, that version
   reported that NO lift reaches zero, which reads as "the approach is
   impossible". It is not. The reachable region spans nine rows, so the pip
   cloud is ~260px tall while the bodies occupy a ~200px band; lifting the
   cloud slides its near half up THROUGH that band while its far half leaves at
   the top. No global lift empties the band because the cloud is taller than
   the gap — and it does not need to. A pip overlapping a body standing BEHIND
   its own tile is fine: that body cannot hide that tile, and the pip is
   painted after the actor loop anyway.

   So the population is the occluded tiles, and the assert is relative:

     hidden = { tile in PAINT.move : its GROUND CENTRE projects inside some
                living unit's screen box }                  <- §12.2's tiles
     for each such tile
       pip = teleReachPoints()[i]                       <- the renderer's
       assert pip.y + pipRadius < top of EVERY box hiding it   own cache, own
                                                               lift, own box

   Every quantity comes off the STAGE — teleLoops().pips is the cache the
   painter reads, Board.unitScreenBox is the box every nameplate and VFX
   already anchors off. A probe that re-derived either would be grading its own
   arithmetic rather than the renderer's.

   🔴 THE NEGATIVE CONTROL RUNS FIRST AND IS NOT OPTIONAL.
   The same measurement is taken with window.__bbReach.rows dropped to 0 —
   the pip at GROUND height, which is §12.2's rejected implementation by name.
   That run MUST report failures. If it does not, this gate cannot tell a
   floating mark from one lying on a sprite, every number below it is
   meaningless, and it exits non-zero instead of reporting.

   ⚠ WHAT THIS FILE DOES NOT COVER, said rather than implied: it is geometry
   only. That the pips are actually PAINTED — that drawTeleReach is wired into
   frame() at all, and that __bbReach.on=false removes them — is pixels, and is
   measured by _reach-pixels.mjs. Geometry alone would pass on a painter that
   is defined and never called.

   Usage:  node .gauntlet/tabletop/_reach-probe.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const SHOT = fileURLToPath(new URL('./shot.mjs', import.meta.url));

/* Runs in the board frame after the scene has settled. `project` and `tileR`
   are top-level FUNCTION DECLARATIONS in a classic <script>, so they are on
   window; `PAINT` and `units` are top-level const/let and are NOT, which is
   why the roster and the set come through window.Board.
   Each anchor `a` is at its tile's GROUND height, so a.y is the floor and
   a.y+lift is the pip — one object, two readings, no second derivation. */
const REPORT = "(() => { const R = window.__bbReach; const A = window.teleLoops().pips || []; " +
  "const pips = window.teleReachPoints(); " +
  "const boxes = (window.Board.units || []).filter(u => !u.dead).map(u => { const b = window.Board.unitScreenBox(u); " +
  "return b ? { id:u.id, x:u.x, z:u.z, left:b.left, top:b.top, w:b.width, h:b.height } : null; }).filter(Boolean); " +
  "const hidden = []; " +
  "for (let i=0;i<A.length;i++){ const a=A[i]; " +
  "const g = window.project({ x:a.x, y:a.y + 0.02, z:a.z }); if (!g) continue; const over=[]; " +
  "for (const b of boxes) if (g.x>b.left && g.x<b.left+b.w && g.y>b.top && g.y<b.top+b.h) over.push(b); " +
  "if (over.length) hidden.push({ i, gx:+g.x.toFixed(1), gy:+g.y.toFixed(1), over }); } " +
  "return JSON.stringify({ rows:R.rows, on:R.on, r:R.r, moveSize:window.Board.paint.move.size, pips, hidden, boxes }); })()";

/* shot.mjs is the FROZEN fixture (§8.1) and must not grow a flag for this
   gate's convenience, so — the device _am-crit-mkoff.mjs established — a
   throwaway COPY of it is written with one statement appended to the --eval
   and one argument added to the boardshot call. Both substitutions are
   asserted and the copy is grepped for the injected text: a substitution that
   silently missed produces a copy which renders the DEFAULT state while being
   labelled as the mutated one, i.e. a same-state pair reported as an A/B. */
function runVariant(label, inject){
  const src = fs.readFileSync(SHOT, 'utf8');

  const N1 = "  await w(300);\n  return 'crowd pushed';";
  if (!src.includes(N1)) { console.error('FAIL: crowd eval tail not found — shot.mjs changed, fix this probe'); process.exit(1); }
  let out = src.replace(N1, `  await w(300);\n  ${inject}\n  await w(120);\n  return 'crowd pushed';`);
  if (out === src) { console.error('FAIL: eval injection was a no-op'); process.exit(1); }

  const N2 = "  '--eval', evalJs,\n";
  if (!out.includes(N2)) { console.error('FAIL: boardshot arg list not found'); process.exit(1); }
  const prev = out;
  out = out.replace(N2, N2 + "    '--report', " + JSON.stringify(REPORT) + ",\n");
  if (out === prev) { console.error('FAIL: --report injection was a no-op'); process.exit(1); }
  if (!out.includes(inject) || !out.includes('--report')) { console.error('FAIL: injection missing from copy'); process.exit(1); }

  /* ⚠ THE COPY MUST LIVE BESIDE shot.mjs, NOT in the temp dir. shot.mjs
     resolves the renderer with new URL('../boardshot.mjs', import.meta.url);
     from %TEMP% that resolves to a path which does not exist, spawnSync
     returns empty stdout, and this gate reports "no --report came back" while
     the real cause is that no browser ever booted. Cost one run to find, and
     the symptom pointed at the wrong half of the rig. */
  const dst = fileURLToPath(new URL(`./_reach-shot-${label}.mjs`, import.meta.url));
  fs.writeFileSync(dst, out);

  const png = fileURLToPath(new URL(`./_reach-probe-${label}.png`, import.meta.url));
  const r = spawnSync(process.execPath, [dst, png, '--scene', 'crowd'], { encoding:'utf8', maxBuffer: 1 << 26 });
  let J = null;
  try { J = JSON.parse(r.stdout); } catch { console.error(r.stdout.slice(-1500)); console.error('FAIL: shot copy produced no JSON'); process.exit(1); }
  const rep = J.boardshot && J.boardshot.report;
  if (!rep) { console.error(JSON.stringify(J, null, 1).slice(-2000)); console.error('FAIL: no --report came back'); process.exit(1); }
  return typeof rep === 'string' ? JSON.parse(rep) : rep;
}

/* The mark is inflated by its own radius before the comparison: a caret whose
   TIP clears a head while its shoulders do not has not cleared it, and the
   number that decides this piece must not turn on half a pixel. */
/* §12.3.4 — "the blue/red directional foot rings exist because overlapping
   sprites made ownership ambiguous; NOTHING MAY BURY THEM." The pips are
   painted after the actor loop, so a pip landing on a ring is drawn straight
   over it. Separate from the occlusion score on purpose: different rule,
   different population (EVERY pip against EVERY body, not just the occluded
   ones), and merging two rules into one number is how one of them quietly
   stops being checked.

   🔴 THE FIRST MODEL OF "WHERE THE RING IS" WAS A GUESS AND IT WAS WRONG IN
   BOTH DIRECTIONS, which is worth the paragraph because it reported three
   intrusions that do not exist. It took the ring to be the bottom 25% of the
   unit's screen box. Reading the renderer instead (drawUnit, the `🔵🔴 WHOSE
   IS WHOSE` block) the ring is:

       ctx.translate(foot.x, foot.y); ctx.scale(1, 0.34);
       rr = k * (isHero ? 0.52 : 0.42)      // k = unitScreenH = the box height
       stroke an arc at R = rr * 0.78

   — an ELLIPSE CENTRED ON foot, and `foot` is the box's BOTTOM EDGE, not a
   band inside it. So the box-quarter proxy protected a strip of LEGS above the
   ring while missing the entire LOWER HALF of the ring, which hangs below the
   box. It failed three pips that clear the real ellipse by 25-50% and would
   have passed a pip sitting on the ring's near rim.

   This models the drawn thing: the ring's outer ellipse, inflated by the pip's
   own radius. Two deliberate strictnesses, both erring toward failing:
     · rr uses the HERO coefficient 0.52 for every unit rather than detecting
       hero-ness (which would duplicate drawUnit's isHero test and could drift
       from it). Every ring is therefore treated as the largest kind.
     · the whole DISC out to the stroke radius is protected, not just the
       stroked annulus — a pip inside the ring is as bad as one on it. */
const RING_RR   = 0.52;   /* drawUnit: k * (isHero ? 0.52 : 0.42), hero value */
const RING_R    = 0.78;   /* drawUnit: const R = rr * 0.78            */
const RING_SQ   = 0.34;   /* drawUnit: ctx.scale(1, SQ), SQ = 0.34    */
function footHits(D){
  const hits = [];
  for (let i = 0; i < D.pips.length; i++){
    const p = D.pips[i]; if (!p) continue;
    for (const b of D.boxes){
      const cx = b.left + b.w / 2, cy = b.top + b.h;      /* foot = box bottom */
      const R  = b.h * RING_RR * RING_R;
      const ax = R + p.r, ay = R * RING_SQ + p.r;
      const dx = (p.x - cx) / ax, dy = (p.y - cy) / ay;
      const q = dx*dx + dy*dy;
      if (q <= 1){
        hits.push(`pip#${i}(${p.x.toFixed(0)},${p.y.toFixed(0)}) inside ${b.id}@${b.x},${b.z} ring ellipse c=(${cx.toFixed(0)},${cy.toFixed(0)}) a=(${ax.toFixed(0)},${ay.toFixed(0)}) q=${q.toFixed(2)}`);
        break;
      }
    }
  }
  return hits;
}

function score(D){
  let bad = 0, minMargin = 1e9; const notes = [];
  for (const H of D.hidden){
    const p = D.pips[H.i];
    if (!p){ bad++; notes.push(`pip#${H.i} does not project`); continue; }
    for (const b of H.over){
      const m = b.top - (p.y + p.r);
      if (m < minMargin) minMargin = m;
      if (m <= 0){ bad++; notes.push(`pip#${H.i} bottom y=${(p.y+p.r).toFixed(0)} vs ${b.id}@${b.x},${b.z} top=${b.top.toFixed(0)}  margin=${m.toFixed(1)}px`); break; }
    }
  }
  return { hidden: D.hidden.length, bad, minMargin: minMargin === 1e9 ? null : +minMargin.toFixed(1), notes };
}

console.log('--- 0. NEGATIVE CONTROL: the same pips dropped to GROUND height ---');
console.log("    (§12.2's rejected implementation. It MUST fail.)");
const ctl = runVariant('ground', 'try{window.__bbReach.rows=0;}catch(e){}');
const cS = score(ctl);
console.log(`    rows=${ctl.rows}  moveSet=${ctl.moveSize}  occludedTiles=${cS.hidden}  FAILING=${cS.bad}  worstMargin=${cS.minMargin}px`);
for (const n of cS.notes.slice(0, 6)) console.log('      · ' + n);
if (cS.hidden === 0){
  console.log('\n🔴 CONTROL FAILED: the fixture has NO occluded reachable tile, so this');
  console.log('   gate is asserting over an empty set and would pass vacuously.');
  process.exit(1);
}
if (cS.bad === 0){
  console.log('\n🔴 NEGATIVE CONTROL FAILED: a GROUND-height pip cleared every occluder.');
  console.log('   This gate cannot distinguish a floating mark from one lying on a');
  console.log('   sprite, so every number it would print below is worthless.');
  process.exit(1);
}
console.log(`    (foot-ring ellipse intrusions at rows=0: ${footHits(ctl).length} — see control B for why that is expected)`);
console.log('    ✅ control A is RED as required — the occlusion assert can fail.\n');

/* ── CONTROL B, for §12.3.4, and it needs a DIFFERENT mutation ─────────────
   rows=0 does NOT exercise the foot-ring rule and reporting it as though it
   did would be a control that certifies nothing. At rows=0 every pip sits on
   its own tile centre — and every tile in PAINT.move is UNOCCUPIED by
   construction (§12.1), so no pip can be standing on anybody's feet. The rule
   needs a mutation that actually drives marks into the bands: NEGATIVE rows,
   which pushes each pip a row DOWN-SCREEN onto the tile in front of its own,
   which is where the bodies are. Caught by writing the control first and
   watching it come back green. */
const ctlB = runVariant('foot', 'try{window.__bbReach.rows=-1.2;}catch(e){}');
const cF = footHits(ctlB);
console.log('--- 0b. NEGATIVE CONTROL for §12.3.4: pips pushed DOWN onto the feet ---');
console.log(`    rows=${ctlB.rows}  foot-ring ellipse intrusions = ${cF.length}`);
for (const h of cF.slice(0, 4)) console.log('      · ' + h);
if (cF.length === 0){
  console.log('\n🔴 NEGATIVE CONTROL FAILED: pips driven down onto the sprites intruded');
  console.log('   into NO foot-ring band, so the §12.3.4 assert below cannot fail either.');
  process.exit(1);
}
console.log('    ✅ control B is RED as required.\n');

console.log('--- 1. THE SHIPPED CUE ---');
const live = runVariant('live', 'void 0;');
const lS = score(live);
console.log(`    rows=${live.rows}  on=${live.on}  moveSet=${live.moveSize}  bodies=${live.boxes.length}`);
console.log(`    occludedTiles=${lS.hidden}  FAILING=${lS.bad}  worstMargin=${lS.minMargin}px`);
for (const H of live.hidden) console.log(`      · pip#${H.i} ground(${H.gx},${H.gy}) hidden by ${H.over.map(o=>o.id+'@'+o.x+','+o.z).join(', ')}`);
for (const n of lS.notes.slice(0, 6)) console.log('      ! ' + n);

let fails = 0;
const ok = (m, c, d='') => { if (c) console.log('  ✅ ' + m); else { fails++; console.log('  ❌ ' + m + (d ? '  <-- ' + d : '')); } };
/* ⚠ INDEX ALIGNMENT IS AN ASSERT, NOT AN ASSUMPTION. score() reads
   D.pips[H.i], where H.i indexes the ANCHOR array and pips comes from
   teleReachPoints(), which drops anchors that do not project. Those two agree
   only while nothing is dropped — and if one ever is, every margin above is
   quietly measured against the WRONG tile's pip while still printing numbers.
   So it is checked here rather than trusted. */
ok('one pip per reachable tile — anchors and pips are index-aligned',
   live.pips.length === live.moveSize,
   `${live.pips.length} pips vs ${live.moveSize} tiles: an anchor was dropped and every margin above is suspect`);
ok('every pip projects on-camera', live.pips.every(Boolean), `${live.pips.filter(p=>!p).length} behind the near plane`);
ok('the fixture still has occluded tiles to score', lS.hidden > 0);
ok('every occluded tile\'s pip clears the body hiding it', lS.bad === 0, `${lS.bad} of ${lS.hidden} fail`);
ok('clearance is not a knife edge (>= 12px)', lS.minMargin >= 12, `worst margin ${lS.minMargin}px`);
const lF = footHits(live);
ok('§12.3.4 no pip lands in any body\'s foot-ring band', lF.length === 0, lF.slice(0, 4).join(' | '));

console.log(`\n${fails ? '❌' : '✅'} reach-probe ${fails ? 'FAILED' : 'PASSED'}`);
process.exit(fails ? 1 : 0);
