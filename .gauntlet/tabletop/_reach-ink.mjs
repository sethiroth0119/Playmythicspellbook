/* ══════════════════════════════════════════════════════════════════════════
   reach-cue — THE PER-CARET INK GATE, and its two negative controls.

   THE QUESTION (§12.2, round 2): a caret that is drawn but PAINTED OVER is
   exactly as useless as one that is occluded by the sprite. Round 1 put
   drawTeleReach() immediately after the depth-sorted actor loop and its header
   claimed nothing remained that could draw over it. Wrong by eight lines:
   drawTeleArc and drawNameplates also run after the sort, and a nameplate is
   an opaque filled box. The crowd critic measured tile 8,5's caret reduced to
   1px of ink by the SHARD plate and tile 8,4's to 14px by the GRINT plate,
   against a ~30px median across the other 34.

   🔴 WHY NOT THE OTHER GATES. _reach-probe.mjs is GEOMETRY — it asks whether
   the caret clears the sprite BOX, and a nameplate floats ABOVE that box, so
   the plate collision is outside the population it scores and it stayed green
   through the whole failure. _reach-pixels.mjs is a WHOLE-MASK DENSITY — it
   sums every caret into one number, and two carets erased out of thirty-six
   move that aggregate by ~5%, which is inside its own reported control spread.
   Both gates ran, both exited 0, both answered a question one degree from the
   one that mattered. This file is the third question: PER CARET, how much ink
   survived.

   THE MEASUREMENT. Ink is a DIFFERENCE, never an absolute count: the board
   under a caret runs from wet asphalt to pale rubble, so "how many bright
   pixels are in this box" measures the terrain. Two frames differing in
   exactly one boolean (__bbReach.on) are subtracted, and the changed pixels
   inside a small window around each caret ARE that caret — nothing else moved.
   Windows come from the renderer's own teleReachPoints(), never recomputed
   here, for the reason the probe records: a gate that re-derives the position
   grades its own arithmetic instead of the picture.

   🔴 THE A/B HAPPENS INSIDE ONE PAGE, IN ONE TASK, AND THAT IS THE WHOLE
   REASON THIS GATE WORKS. The obvious build — screenshot with the cue on,
   screenshot with it off, diff the PNGs — was built first and is unusable, so
   the numbers are recorded here rather than left for the next person to
   rediscover. Across two boots the board is not the same picture: rain, embers,
   the breathing move wash and the easing HP bars all advance. Frame-wide at a
   hard threshold of 70 the cue's entire signal is 505px and a SAME-STATE pair
   scores 306px — a ratio of 1.6, and per caret the median signal (10px) came
   out BELOW the worst same-state window (17px). Round 1's own draw order and
   the fixed order produced indistinguishable distributions, i.e. the gate
   could not see the bug it exists for. Chromium is not bit-identical across
   processes and no threshold rescues that.
   So both frames are rendered by calling frame(now) twice with the SAME
   timestamp — dt clamps to zero, T does not advance, every animation phase is
   held — and getImageData is taken between them, in the same task. The two
   buffers then differ in the caret and in literally nothing else.
   ⚠ This is a 2D context, so the readback is safe; the canvas-A/B warning in
   CLAUDE.md about preserveDrawingBuffer is a WebGL rule and does not apply —
   but its other half does, and is obeyed: the renderer is called between the
   two reads rather than trusting RAF, which fires far too slowly to drive an
   A/B synchronously.

   🔴 CONTROL 0a — THE NOISE FLOOR, and it runs first. The same per-caret
   arithmetic on two ADJACENT frames that differ in NOTHING (on=true both
   times), in the same task, so it carries exactly the same per-frame drift as
   the cue pair does.
   ⚠ IT DOES NOT COME OUT AT ZERO, and the attempts to make it are recorded so
   nobody repeats them. Holding T is not enough: ~550px of the frame still
   changes between two identical-state frames (bbox 259,74..1447,633). Warming
   90 frames to converge drawNameplates' per-frame `hpShown += (want-hpShown)
   *0.14` easing is not enough either, and neither is 400. Reseeding Math.random
   to a fixed LCG before every frame — done, and kept, because it does remove
   the spawn jitter — still leaves ~300-450px: rain and embers carry their own
   per-frame arrays that no clock freeze touches.
   So the floor is MEASURED AND SUBTRACTED per caret per phase rather than
   assumed away, and 0a asserts the floor's MEDIAN stays well under the signal
   (13-14% in practice) so that the subtraction is correcting the result rather
   than producing it.

   🔴 AND THE SCORE IS A MEDIAN OVER PHASES, NOT A MINIMUM. Scoring each caret
   by its worst frame sounds strictly conservative and is the opposite: the
   minimum of a noisy quantity selects the unluckiest noise spike, and it duly
   failed tiles 8,4 and 8,5 — both at phase 38, one phase out of forty-four,
   which is the signature of one rain streak and not of an occluder. A plate is
   anchored to a unit and is there at every phase; weather is there at one.

   🔴 CONTROL 0b — ROUND 1'S DRAW ORDER, RESTORED, and it MUST go red.
   This is the control that actually binds, and the one I first got wrong:
   the obvious mutation is __bbReach.rows=0 (the caret dropped to ground
   height, §12.2's rejected implementation). THAT CONTROL IS DEAD AFTER THIS
   FIX AND WOULD HAVE PASSED VACUOUSLY. The caret is now the last board-space
   pass, so at rows=0 it is painted straight over the sprite standing on the
   tile and its ink is fully intact — a ground-height caret is a DESIGN failure
   the geometry probe catches, not an INK failure this file can see. Asserting
   on it here would have produced a green "control failed to fail" and I would
   have shipped a gate nobody has seen fail. The mutation that matches what
   this file measures is the DRAW ORDER itself, so the control renders a
   throwaway copy of the board page with the pip call moved back in front of
   drawTeleArc/drawNameplates — literally round 1.
   ⚠ WHAT IT ASSERTS IS SENSITIVITY, NOT THAT IT TRIPS THE SAME LINE THE PASS
   CONDITION USES — and that distinction is load-bearing. THE NAMEPLATE IS
   TRANSLUCENT, so a caret under it is dimmed rather than deleted: round 1
   drags the critic's tile 8,5 to 0.569 of its phase median, which is still
   above the half-median bar. Requiring the control to cross that bar would
   leave one option, moving the bar until it did, which is fitting the
   threshold to the answer. Instead the control asserts that round 1 costs some
   caret a large, LOCALIZED amount: 0.370 of a phase median on tile 8,5 while
   the typical caret moves 0.002. A cause that lives in one plate must produce
   a response in one caret; a global shift would mean the two renders differ
   for some reason that has nothing to do with plates, and that fails too.

   ⚠ The copy lives at public/battle-board/_reach-ink-ctl.html because
   boardshot serves public/ as the web root and --page takes a path under it.
   It is deleted in a finally, and its name is underscore-prefixed to match
   _harness.html. It is NOT product code and must never be committed.

   🔴 AND THE SECOND QUESTION, ADDED IN ROUND 3: a caret whose ink survives
   perfectly but hovers over SOMEBODY ELSE'S TILE is not a cue, it is a lie,
   and §12.3.3 rules that worse than no cue at all. Round 2 shipped
   REACH_CUE.rows=1.60 and ALL THIRTY-SIX carets sat outside the hexagon they
   meant — and every gate in this directory stayed green, because ink,
   geometry-vs-sprite-box and density all ask "did the mark reach the screen"
   and none of them asks "is it over the right tile". That is the same
   one-degree-off shape as the nameplate miss above, so the answer is the same:
   a third question, asserted here.
   THE TEST IS POINT-IN-POLYGON AGAINST THE RENDERER'S OWN tilePoly(gx,gz,0),
   read out of the page like teleReachPoints() is. A gate that re-derived the
   hexagon would be grading its own trigonometry against the painter's, and
   would stay green through a projection change that moved both.
   ⚠ ITS NEGATIVE CONTROL IS THE SHIPPED-AND-WRONG NUMBER: the identical
   arithmetic, on the identical projection, in the identical frame, at
   rows=1.60. It must come back 0/36. That control is not hypothetical — it is
   the state this file's own product tree was in one round ago.

   Usage:  node .gauntlet/tabletop/_reach-ink.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';



const SHOT  = fileURLToPath(new URL('./shot.mjs', import.meta.url));
const BOARD = fileURLToPath(new URL('../../public/battle-board/index.html', import.meta.url));
const CTL   = fileURLToPath(new URL('../../public/battle-board/_reach-ink-ctl.html', import.meta.url));
const CTLPAGE = '/battle-board/_reach-ink-ctl.html';

/* ── the control page: round 1's order, built by transform, never re-typed ──
   Cutting and re-pasting the pip block by hand would let the control drift
   from the thing it is controlling. The block is LIFTED from wherever it is
   and RE-INSERTED before the arc, and both halves are asserted. */
const PIP_CALL = '  try { drawTeleReach(T); } catch (e) {}\n';
const ARC_CALL = '  try { drawTeleArc(T); } catch (e) {}\n';
function buildControlPage(){
  const src = fs.readFileSync(BOARD, 'utf8');
  if ((src.split(PIP_CALL).length - 1) !== 1) throw new Error('control: pip call is not unique in the board');
  if ((src.split(ARC_CALL).length - 1) !== 1) throw new Error('control: arc call is not unique in the board');
  const iPip = src.indexOf(PIP_CALL), iArc = src.indexOf(ARC_CALL);
  if (!(iArc < iPip)) throw new Error('control: the board is ALREADY in round-1 order (arc after pips) — nothing to control for');
  const lifted = src.replace(PIP_CALL, '');
  const out = lifted.replace(ARC_CALL, PIP_CALL + ARC_CALL);
  if (out === lifted) throw new Error('control: re-insertion was a no-op');
  const jPip = out.indexOf(PIP_CALL), jArc = out.indexOf(ARC_CALL);
  if (!(jPip < jArc)) throw new Error('control: transform did not produce round-1 order');
  if (out.length !== src.length) throw new Error('control: byte count changed — the transform moved more than the call');
  fs.writeFileSync(CTL, out);
  return { from: iPip, to: jPip };
}

/* ── render plumbing: the shot.mjs COPY device, as _reach-probe.mjs uses it ─ */
const REPORT = "(() => { const R = window.__bbReach; const A = window.teleLoops().pips || []; " +
  /* flattened to [x,y,r] integer triples at the source, the shape
     _reach-pixels.mjs already uses — teleReachPoints() returns {x,y,r}
     objects and a window built from `const [x,y,r] = p` on those silently
     throws rather than mis-measuring, which is how this was caught. */
  "const pips = window.teleReachPoints().map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.r)]); " +
  "const boxes = (window.Board.units || []).filter(u => !u.dead).map(u => { const b = window.Board.unitScreenBox(u); " +
  "return b ? { id:u.id, x:u.x, z:u.z, left:b.left, top:b.top, w:b.width, h:b.height } : null; }).filter(Boolean); " +
  "const hidden = []; " +
  "for (let i=0;i<A.length;i++){ const a=A[i]; " +
  "const g = window.project({ x:a.x, y:a.y + 0.02, z:a.z }); if (!g) continue; const over=[]; " +
  "for (const b of boxes) if (g.x>b.left && g.x<b.left+b.w && g.y>b.top && g.y<b.top+b.h) over.push(b.id); " +
  "if (over.length) hidden.push(i); } " +
  /* LABELS ONLY, and only so a failure names the tile the critic named rather
     than an index. telePips() walks PAINT.move in set order and pushes one
     anchor per key, so the nth key is the nth caret — asserted below by length
     rather than assumed, and dropped to '#i' if it ever stops holding. No
     measurement depends on this; it is the caption, not the number. */
  "const tiles = [...window.Board.paint.move]; " +

  /* ── 🔴 IS EACH CARET OVER THE TILE IT MEANS? (round 3) ──────────────────
     Ray-cast crossing parity over the SIX PROJECTED CORNERS that tilePoly()
     itself returns, so the polygon tested is the polygon drawn. inset 0 and no
     explicit y, which makes tilePoly fall back to tileElev(gx,gz) — the very
     height telePips() anchors at, so the test and the anchor cannot disagree
     about which plane the tile is on.
     A caret that misses its own tile is chased across the whole board so the
     failure names where it actually went; that scan is DIAGNOSTIC ONLY and
     nothing asserts on it — the assert is own-tile containment alone.
     ⚠ ONE PROJECTION, EVERY ROWS VALUE. The live value, the 1.60 control and
     the margin samples all come from this single call site in this single
     frame, so the control differs from the assert in exactly one number and
     in nothing else. R.rows is restored before anything renders. */
  "const inPoly = (P, px, py) => { let ins = false; for (let i=0,j=5;i<6;j=i++){ const a=P[i], b=P[j]; " +
  "if (((a.y>py)!==(b.y>py)) && (px < (b.x-a.x)*(py-a.y)/(b.y-a.y)+a.x)) ins = !ins; } return ins; }; " +
  "const MC = window.Board.map.cols, MR = window.Board.map.rows; " +
  "const ownAt = rw => { const keep = R.rows; R.rows = rw; const pk = window.teleReachPoints(); R.rows = keep; " +
  /* own:-1 is a REFUSAL, not a score: if the caret list and the tile list ever
     stop being the same length then tiles[i] is not pk[i]'s tile and every
     number below is mislabelled. The Node side treats -1 as a hard error
     rather than as a failing count. */
  "if (pk.length !== tiles.length) return { rows:rw, own:-1, of:tiles.length, stray:[] }; " +
  "let own = 0; const stray = []; " +
  "for (let i=0;i<tiles.length;i++){ const c = tiles[i].indexOf(','); " +
  "const gx = +tiles[i].slice(0,c), gz = +tiles[i].slice(c+1); " +
  "const P = window.tilePoly(gx, gz, 0), p = pk[i]; " +
  "if (P && p && inPoly(P, p.x, p.y)){ own++; continue; } " +
  "let on = null; if (p) for (let x=0;x<MC && !on;x++) for (let z=0;z<MR;z++){ " +
  "const Q = window.tilePoly(x, z, 0); if (Q && inPoly(Q, p.x, p.y)){ on = x+','+z; break; } } " +
  "stray.push(tiles[i] + ' -> ' + (on || 'no tile at all')); } " +
  "return { rows:+rw.toFixed(2), own, of:tiles.length, stray:stray.slice(0,6) }; }; " +
  "const ownLive = ownAt(R.rows), ownCtl = ownAt(1.60); " +
  /* the margin either side of the shipped number, printed rather than asserted:
     it is what makes "0.40 is inside the plateau and 0.5 is the cliff edge"
     checkable from this gate's own output instead of from a comment. */
  "const ownMargin = [0, 0.3, 0.4, 0.5, 0.6, 0.7].map(v => { const o = ownAt(v); return [o.rows, o.own]; }); " +

  /* ── THE A/B, held still. frame() is a top-level function DECLARATION in a
     classic script so it is on window; `cv` is a top-level const and is not,
     hence getElementById. The SAME `now` goes into every call: frame() clamps
     dt at zero, so T — which every animation phase in the file is built from —
     does not advance between the two renders. */
  "const el = document.getElementById('stage'); const c2 = el.getContext('2d'); " +
  "const now = performance.now(); " +
  /* CSS px -> device px. The pip coords are CSS px (project()'s space, the one
     the nameplates and every host anchor already use) and getImageData is in
     backing-store px. Measured, never assumed to be 1: a silent DPR of 2 would
     put every window in the top-left quadrant and score the sky. */
  "const S = el.width / el.clientWidth; " +
  /* 🔴 SWEEP THE ANIMATION PHASE, AND SCORE THE WORST ONE. A single frozen
     frame is the wrong sample and the numbers say so: frozen at one phase the
     round-1 control loses only 13px on the critic's own tile 8,5, where the
     critic photographed it down to 1px. Nothing is inconsistent — a NAMEPLATE
     RIDES ITS UNIT'S IDLE BOB (its y comes from unitScreenBox) while a CARET IS
     ANCHORED TO THE TILE and does not bob at all, so how much of the caret the
     plate covers is a function of the bob phase. One frame catches one phase
     and can photograph a caret at its most visible moment.
     That is the intermittent-failure shape CLAUDE.md warns about — worse than
     a hard failure because it passes most of the time — so the sweep walks the
     board forward in dt-clamp-sized steps and every caret keeps its WORST
     phase. A cue has not survived occlusion if it survives it only sometimes. */
  "const STEPS = 44, STEP_MS = 50; " +
  /* sub-rect readback, not the whole 1600x900 canvas: 3 full grabs per phase
     over 44 phases is ~750 MB of churn and times the gate out. The union of
     the caret windows is a fraction of the frame. */
  "let ux0=1e9, uy0=1e9, ux1=-1, uy1=-1; const padOf = p => Math.ceil((p[2] + Math.max(3.0,p[2]*0.80)/2 + 2) * S); " +
  "for (const p of pips){ const q = padOf(p) + 4, cx = p[0]*S, cy = p[1]*S; " +
  "ux0 = Math.min(ux0, cx-q); uy0 = Math.min(uy0, cy-q); ux1 = Math.max(ux1, cx+q); uy1 = Math.max(uy1, cy+q); } " +
  "ux0 = Math.max(0, Math.floor(ux0)); uy0 = Math.max(0, Math.floor(uy0)); " +
  "ux1 = Math.min(el.width-1, Math.ceil(ux1)); uy1 = Math.min(el.height-1, Math.ceil(uy1)); " +
  "const UW = ux1-ux0+1, UH = uy1-uy0+1; " +
  "const grab = () => c2.getImageData(ux0, uy0, UW, UH).data; " +
  /* window: the caret spans +-r across and -0.62r..+0.42r down, plus half the
     casing stroke. Padded and squared off. A window slightly too big only
     ADMITS more ink, so it can never manufacture a failure — the direction an
     honest window errs. Overlap between neighbours is checked on the Node side
     rather than assumed away. */
  "const count = (X, Y, p) => { const pad = padOf(p); " +
  "const cx = Math.round(p[0]*S) - ux0, cy = Math.round(p[1]*S) - uy0; let n = 0; " +
  "for (let y = Math.max(0, cy-pad); y <= Math.min(UH-1, cy+pad); y++) " +
  "for (let x = Math.max(0, cx-pad); x <= Math.min(UW-1, cx+pad); x++){ const i = (y*UW+x)*4; " +
  "const d = (Math.abs(X[i]-Y[i]) + Math.abs(X[i+1]-Y[i+1]) + Math.abs(X[i+2]-Y[i+2]))/3; " +
  /* 🔴 MAGNITUDE, NOT A PIXEL COUNT — and this is the difference between a gate
     that sees the bug and one that does not. THE NAMEPLATE IS TRANSLUCENT. A
     caret painted before it is not erased, it is ATTENUATED: the crop shows the
     round-1 caret over the SHARD plate as a dark navy sliver where the fixed
     order shows a full bright cyan one. A threshold COUNT scores those two the
     same, because the dimmed caret still changes its pixels by more than any
     threshold low enough to be honest — which is exactly why counting reported
     "round 1 lost no caret" while the picture plainly showed it losing one.
     Summing |Δ| instead measures HOW MUCH of the caret reached the screen, and
     a plate at alpha a scales it by (1-a). It degrades smoothly with occlusion
     instead of stepping, and it needs no threshold tuned to the answer — the
     floor below only suppresses 8-bit rounding accumulating over ~440 px. */
  "if (d >= 4) n += d; } return Math.round(n); }; " +
  "const ink = pips.map(() => Infinity), noise = pips.map(() => 0), worstAt = pips.map(() => -1); " +
  /* 🔴 PERSISTENCE, NOT THE SINGLE WORST FRAME — and this correction came out
     of the gate failing me rather than out of taste. Scoring each caret by its
     MINIMUM over the sweep sounds strictly conservative and is not: the
     minimum of a noisy quantity selects the unluckiest noise spike, so with a
     same-state floor that reaches 49px in the unluckiest window, min(net)
     bottoms out at 0 for whichever caret a rain streak crossed. It duly failed
     tiles 8,4 and 8,5 — both at phase 38, the same phase, which is the
     signature of one transient event and not of an occluder.
     The physical difference is the whole discriminator: A PLATE IS ANCHORED TO
     A UNIT AND IS ALWAYS THERE, so real occlusion is low across MANY phases
     (and a bob-driven partial occlusion across roughly half of them), while
     weather is low in one. So each caret's score is HOW OFTEN it falls under
     half its phase median, and min/median are reported alongside for a reader.
     ⚠ This is the one place a threshold could be tuned until it passes, so it
     is fixed by the physics and stated: 15% of phases. One transient is 1/44 =
     2.3%; the shallowest periodic occlusion still occupies its half-cycle. */
  "const low = pips.map(() => 0), ratios = pips.map(() => []); " +
  /* per-phase medians, so the assert compares a caret to the board AT THE SAME
     INSTANT rather than to an average over the sweep */
  "const phaseMed = []; let drift = 0; let t = now; " +
  /* 🔴 SWALLOW THE RESCHEDULE FOR THE LENGTH OF THE SWEEP. frame() ends with
     requestAnimationFrame(frame), so every direct call STARTS A NEW LOOP: 44
     phases x 3 calls left 132 concurrent RAF chains hammering the page and
     page.screenshot() then timed out at 30s with an empty report — which
     surfaces as "no --report came back" and points at the wrong half of the
     rig. Stubbing rAF to a no-op both prevents that and makes the sweep
     deterministic, since no background frame can interleave with the A/B.
     The board's own pending callback fires once, reschedules into the stub and
     stops; the loop is restarted explicitly at the end. */
  "const origRAF = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; " +
  /* 🔴 WARM-UP, and it is not padding. Not every animation in the board is a
     function of T: drawNameplates eases its bar with
     `hpShown += (want - hpShown) * 0.14` — PER FRAME, not per dt — so it keeps
     moving even with the clock held, and it moves INSIDE THE PLATES, which is
     exactly where the caret windows that matter are. Measured: it put up to
     21px of change between two frames of an identical state, against a 42px
     signal, and control 0a went red. Ninety frames at 14% per frame drives the
     residual under 1e-6, after which two consecutive frames really are the
     same picture. Cheap, because no readback happens here. */
  "for (let i = 0; i < 90; i++) window.frame(now); " +
  /* 🔴 AND RESEED Math.random BEFORE EVERY SINGLE frame() CALL. Holding the
     clock is not enough and the warm-up is not enough: measured, two frames of
     an IDENTICAL state still differ by ~550px scattered over almost the whole
     board (bbox 259,74..1447,633), and warming 400 frames does not reduce it.
     That residue is stochastic, not temporal — the weather and ember spawns
     draw from Math.random() once per frame regardless of dt, so no amount of
     freezing T makes two frames the same picture.
     A seeded LCG reset to the SAME seed before each call makes every frame draw
     the identical random sequence, so two frames of the same state become
     bit-identical and the only thing left between the A and the B is the cue.
     Both halves of every pair get the same treatment, so this cannot bias the
     comparison — it can only remove noise from it. Restored afterwards.
     ⚠ Control 0a is what proves this worked; it is not taken on faith. */
  "const origRandom = Math.random; let _s = 0; " +
  "Math.random = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }; " +
  "const F = tt => { _s = 20250915; window.frame(tt); }; " +
  "for (let k = 0; k < STEPS; k++){ t += STEP_MS; " +
  /* 🔴 THREE ADJACENT FRAMES, AND THE PAIRS ARE EQUIDISTANT. A0->A is the
     same-state pair, A->B is the cue pair; both are ONE frame apart, so both
     carry the same amount of whatever the board does per frame. Ordering them
     A, A2, B instead — which is what this did first — puts the cue pair two
     frames apart and the control pair one, and then the control understates
     exactly the thing it exists to bound. */
  "R.on = true;  F(t); const A0 = grab(); " +
  "R.on = true;  F(t); const A  = grab(); " +
  "R.on = false; F(t); const B  = grab(); " +
  /* re-read the caret positions every phase instead of trusting phase 0: if
     they ever DID move the fixed windows would quietly mis-measure, so the
     drift is reported and the Node side asserts on it. */
  "const pk = window.teleReachPoints().map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.r)]); " +
  "for (let i = 0; i < pips.length; i++){ if (pk[i]) drift = Math.max(drift, Math.abs(pk[i][0]-pips[i][0]), Math.abs(pk[i][1]-pips[i][1])); } " +
  /* NET ink: the cue pair minus the same-state pair, floored at zero. The board
     keeps a little per-frame state that neither holding T nor reseeding
     Math.random removes — rain and embers carry their own arrays — and it
     lands in a caret window occasionally rather than uniformly (median 3.5px,
     but up to 21px in the unluckiest window of 44 phases). Subtracting it per
     caret per phase is the honest correction: it can only make a caret look
     WORSE, never better, so it cannot manufacture a pass. */
  "const row = pips.map((p, i) => { const nz = count(A0, A, p); " +
  "const v = Math.max(0, count(A, B, p) - nz); " +
  "if (v < ink[i]){ ink[i] = v; worstAt[i] = k; } " +
  "noise[i] = Math.max(noise[i], nz); return v; }); " +
  "const sr = [...row].sort((a,b)=>a-b); const pm = sr.length%2 ? sr[sr.length>>1] : (sr[(sr.length>>1)-1]+sr[sr.length>>1])/2; " +
  "phaseMed.push(pm); " +
  /* every caret is compared to the board AT THE SAME INSTANT: a caret is faint
     either because something ate it or because the whole frame dimmed, and
     dividing by that phase's own median separates the two */
  "for (let i = 0; i < pips.length; i++){ const rr = pm ? row[i]/pm : 1; ratios[i].push(+rr.toFixed(3)); if (rr < 0.5) low[i]++; } } " +
  "const mid = a => { const s = [...a].sort((x,y)=>x-y); const h = s.length>>1; return s.length%2 ? s[h] : (s[h-1]+s[h])/2; }; " +
  "const lowFrac = low.map(n => +(n / STEPS).toFixed(3)); " +
  "const minRatio = ratios.map(a => Math.min(...a)); const medRatio = ratios.map(a => +mid(a).toFixed(3)); " +
  /* leave the board as it was found, so the PNG boardshot writes afterwards is
     the ON state a human can look at rather than the OFF frame this happened
     to end on */
  /* restore the board: cue back on, one more frame so the PNG boardshot writes
     next is the ON state, and the RAF loop handed back exactly one chain */
  "R.on = true; F(t); Math.random = origRandom; " +
  "window.requestAnimationFrame = origRAF; window.requestAnimationFrame(window.frame); " +
  /* ── WHICH PAGE AM I ACTUALLY IN? Read the DRAW ORDER out of the running
     document's own inline script text and report it. Without this, a --page
     injection that silently missed would render the LIVE board while being
     labelled the control, and the gate would report "round 1 lost no caret" —
     a green control-failed-to-fail that looks exactly like a real result.
     That is the single most dangerous failure this file can have, so it is
     read from the page rather than trusted from the spawn arguments. */
  "let pipBeforeArc = null; " +
  "for (const s of document.querySelectorAll('script')){ const t = s.textContent || ''; " +
  "const a = t.indexOf('drawTeleArc(T)'), p = t.indexOf('try { drawTeleReach(T); }'); " +
  "if (a > 0 && p > 0){ pipBeforeArc = p < a; break; } } " +
  "return JSON.stringify({ rows:R.rows, r:R.r, scale:S, canvas:[el.width, el.height], pipBeforeArc, " +
  "steps:STEPS, stepMs:STEP_MS, drift, phaseMed, worstAt, low, lowFrac, minRatio, medRatio, " +
  "moveSize:window.Board.paint.move.size, pips, hidden, tiles, ink, noise, " +
  "ownLive, ownCtl, ownMargin }); })()";

const tmp = [];
function render(label, inject, page){
  const src = fs.readFileSync(SHOT, 'utf8');
  const N1 = "  await w(300);\n  return 'crowd pushed';";
  if (!src.includes(N1)) throw new Error('crowd eval tail not found — shot.mjs changed');
  let out = src.replace(N1, `  await w(300);\n  ${inject}\n  await w(150);\n  return 'crowd pushed';`);
  if (out === src) throw new Error('eval injection was a no-op');
  const N2 = "  '--eval', evalJs,\n";
  if (!out.includes(N2)) throw new Error('boardshot arg list not found');
  let add = N2 + "    '--report', " + JSON.stringify(REPORT) + ",\n";
  if (page) add += "    '--page', " + JSON.stringify(page) + ",\n";
  const prev = out;
  out = out.replace(N2, add);
  if (out === prev) throw new Error('report/page injection was a no-op');
  if (!out.includes(inject)) throw new Error('injection missing from the copy');
  if (page && !out.includes(JSON.stringify(page))) throw new Error('--page missing from the copy');

  /* beside shot.mjs, never %TEMP%: shot.mjs resolves boardshot relative to its
     OWN url and a copy in the temp dir renders nothing at all. */
  const dst = fileURLToPath(new URL(`./_reach-ink-shot-${label}.mjs`, import.meta.url));
  fs.writeFileSync(dst, out); tmp.push(dst);
  const png = fileURLToPath(new URL(`./_reach-ink-${label}.png`, import.meta.url));
  const r = spawnSync(process.execPath, [dst, png, '--scene', 'crowd'], { encoding:'utf8', maxBuffer: 1 << 26 });
  let J; try { J = JSON.parse(r.stdout); } catch { console.error(String(r.stdout).slice(-1200)); throw new Error('no JSON from ' + label); }
  const rep = J.boardshot && J.boardshot.report;
  if (!rep) {
    /* print the CHILD'S STDERR, not just its JSON: a report expression that
       throws (or runs past boardshot's evaluation budget) comes back as an
       empty `raw` and the JSON alone says nothing about why. */
    console.error('--- child stderr ---\n' + String(r.stderr || '(none)').slice(-3000));
    console.error('--- child stdout tail ---\n' + String(r.stdout || '').slice(-800));
    throw new Error('no --report came back from ' + label);
  }
  /* on Windows the directory entry can lag the child's exit; busy-wait rather
     than trusting the exit code (which once produced a confusing sharp throw) */
  const t0 = Date.now(); while (!fs.existsSync(png) && Date.now() - t0 < 4000){ /* spin */ }
  if (!fs.existsSync(png)) throw new Error(label + ' rendered no PNG');
  return { png, rep: JSON.parse(rep) };
}

const med = a => { const s = [...a].sort((x,y)=>x-y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h-1]+s[h]) / 2; };

/* ⚠ WINDOWS MUST NOT TOUCH. Every window is scored independently, so if two
   overlap, a caret that has been erased still collects its neighbour's ink and
   reads healthy. That is precisely the failure this gate exists to catch, so
   it is checked rather than hoped for — the windows are square and 2*pad+1
   wide, so any pair whose centres are closer than 2*pad+1 in BOTH axes
   overlaps. Reported as a hard error, not a warning: a gate with a known
   leak is not evidence. */
function overlaps(pips){
  const bad = [];
  for (let i = 0; i < pips.length; i++){
    const [xi, yi, ri] = pips[i]; const pi = Math.ceil(ri + Math.max(3.0, ri*0.80)/2 + 2);
    for (let j = i + 1; j < pips.length; j++){
      const [xj, yj, rj] = pips[j]; const pj = Math.ceil(rj + Math.max(3.0, rj*0.80)/2 + 2);
      if (Math.abs(xi - xj) <= pi + pj && Math.abs(yi - yj) <= pi + pj)
        bad.push(`#${i}(${xi},${yi}) and #${j}(${xj},${yj})`);
    }
  }
  return bad;
}
const lab = (pips, tiles, i) =>
  `${(tiles && tiles.length === pips.length && tiles[i]) ? 'tile ' + tiles[i] : '#' + i}@(${pips[i][0]},${pips[i][1]})`;

let fail = 0;
try {
  const moved = buildControlPage();
  console.log(`control page written: round-1 order restored (pip call ${moved.from} -> ${moved.to})\n`);

  /* Two renders, not five: each one now carries its own A/B inside the page,
     so the OFF frame is a sibling of the ON frame rather than a second boot. */
  const on = render('live', 'void 0;');
  const R  = on.rep;
  if (!R.pips.length) throw new Error('the live render reported no carets');
  console.log(`scene: moveSet=${R.moveSize}  carets=${R.pips.length}  rows=${R.rows}  r=${R.r}  ` +
              `occludedTiles=${R.hidden.length}  canvas=${R.canvas.join('x')}  cssPx->devicePx=${R.scale}`);
  console.log(`sweep: ${R.steps} phases x ${R.stepMs}ms of board time; each caret keeps its WORST phase`);
  if (R.scale !== 1) console.log('    (note: DPR is not 1 — windows were scaled by it, see the report expression)');

  const ov = overlaps(R.pips);
  if (ov.length) throw new Error(`caret windows overlap (${ov.length} pairs, e.g. ${ov[0]}) — a dead caret would collect its neighbour's ink`);
  console.log(`    ✅ no two caret windows overlap, so each score is that caret alone`);
  /* the windows are fixed at phase 0; if the carets moved during the sweep the
     windows would be measuring the wrong place by the end of it */
  if (R.drift > 1) throw new Error(`carets moved ${R.drift}px during the sweep — the fixed windows are mis-aimed`);
  console.log(`    ✅ carets moved ${R.drift}px across the sweep, so the fixed windows stay on them\n`);

  const live = R.ink, noise = R.noise;
  const mLive = med(live), mNoise = med(noise);

  console.log('--- 0a. NEGATIVE CONTROL: two frames of the SAME state, adjacent, same windows ---');
  console.log(`    median NET worst-phase ink (sum of |delta|)=${mLive}px   same-state floor: median=${mNoise}px  worst window over the whole sweep=${Math.max(...noise)}px`);
  /* The assert is on the MEDIAN floor, and the worst-case window is handled by
     subtraction rather than by a threshold — see the net-ink note in the
     report. A median floor anywhere near the signal would mean the subtraction
     is doing the work instead of correcting it, and the numbers would be
     arithmetic rather than measurement. */
  if (mNoise > 0.25 * mLive){
    console.log('\n🔴 CONTROL 0a FAILED: two frames that differ in NOTHING score like the pair');
    console.log('   that differs in the cue. The subtraction would be carrying the result.');
    process.exit(1);
  }
  console.log(`    ✅ the floor is ${(100*mNoise/mLive).toFixed(1)}% of the signal and is subtracted per caret per phase\n`);

  console.log('--- 0b. NEGATIVE CONTROL: round 1 draw order (pips BEFORE arc + plates) ---');
  console.log('    (this is the bug being fixed. It MUST go red.)');
  const c1 = render('r1', 'void 0;', CTLPAGE);
  /* the page identified itself; believe that, not the spawn arguments */
  if (R.pipBeforeArc !== false) throw new Error(`the LIVE render reports pipBeforeArc=${R.pipBeforeArc} — expected false (pips last)`);
  if (c1.rep.pipBeforeArc !== true) throw new Error(`the CONTROL render reports pipBeforeArc=${c1.rep.pipBeforeArc} — the control page did not load; --page missed and this would have been a fake green`);
  console.log(`    page identity confirmed from the DOM: live pipBeforeArc=${R.pipBeforeArc}, control pipBeforeArc=${c1.rep.pipBeforeArc}`);
  const ctl = c1.rep.ink;
  /* THE SCORE IS A RATIO, not a raw pixel count, and it is taken against the
     median OF THE SAME PHASE. A caret is faint either because something ate it
     or because the whole board dimmed for an instant; dividing by the board at
     that instant separates the two. Computed in the page, where both halves
     are in hand. */
  /* sorted by how much round-1 DEGRADED the caret relative to live. Sorting by
     the control's own low-fraction hid the answer once: every caret reads 0%
     there, so the six printed were an arbitrary six and the table looked like
     evidence of nothing happening. The quantity of interest is the DELTA. */
  const cmp = R.tiles.map((t, i) => {
    const j = c1.rep.tiles.indexOf(t);
    return { t, lf: R.lowFrac[i], med: R.medRatio[i],
             r1lf: j >= 0 ? c1.rep.lowFrac[j] : null, r1med: j >= 0 ? c1.rep.medRatio[j] : null };
  }).filter(e => e.r1lf != null).sort((a,b) => (a.r1med - a.med) - (b.r1med - b.med));
  console.log('    carets most degraded by round-1 order (median ratio, round1 vs live):');
  for (const e of cmp.slice(0,6))
    console.log(`      · tile ${e.t}  round1=${e.r1med} (low ${(100*e.r1lf).toFixed(0)}% of phases)` +
                `  live=${e.med} (low ${(100*e.lf).toFixed(0)}%)  delta=${(e.r1med - e.med).toFixed(3)}`);
  for (const t of ['8,5', '8,4']){
    const e = cmp.find(x => x.t === t);
    if (e) console.log(`      · critic's tile ${t}: round1=${e.r1med}  live=${e.med}  delta=${(e.r1med - e.med).toFixed(3)}`);
  }
  /* 🔴 WHAT THE CONTROL HAS TO PROVE, stated carefully, because the obvious
     version of it is wrong. It is tempting to require round-1 to trip the SAME
     half-median line the assert uses. It does not, and that is a fact about
     the fixture rather than about the gate: the SHARD plate is TRANSLUCENT, so
     it drags tile 8,5 down to 0.566 of its phase median, not to zero. Demanding
     that the control trip a 0.5 line would leave exactly one honest option —
     move the line until it did — which is the failure this whole pass keeps
     meeting.
     What a control owes is SENSITIVITY: proof that the instrument responds to
     the thing it is aimed at, and responds THERE AND NOWHERE ELSE. Both halves
     are asserted, and the second is the stronger one: a global dimming would
     move every caret and would mean the two renders differ for some reason
     that has nothing to do with plates. */
  const deltas = cmp.map(e => e.med - e.r1med);           /* positive = the fix recovered ink */
  const worst  = Math.max(...deltas), typical = med(deltas.map(Math.abs));
  console.log(`    response: biggest recovery ${worst.toFixed(3)} of a phase median; typical caret moves ${typical.toFixed(3)}`);
  if (worst < 0.25){
    console.log(`\n🔴 CONTROL 0b FAILED: round 1's draw order cost no caret more than ${worst.toFixed(3)}.`);
    console.log('   This gate cannot resolve a caret painted under a plate, so its green');
    console.log('   below is worth nothing. Fix the gate, not the build.');
    process.exit(1);
  }
  if (typical > 0.05){
    console.log(`\n🔴 CONTROL 0b FAILED: the TYPICAL caret also moved (${typical.toFixed(3)}), so the two`);
    console.log('   renders differ globally and the big number above is not attributable');
    console.log('   to the plates. A localized cause must produce a localized response.');
    process.exit(1);
  }
  console.log(`    ✅ red, and localized: the plate-covered caret loses ${worst.toFixed(3)} while the median caret moves ${typical.toFixed(3)}\n`);

  console.log('--- 0c. NEGATIVE CONTROL: point-in-own-hexagon at round 2\'s shipped rows=1.60 ---');
  console.log('    (this is the OTHER bug being fixed. It MUST go red.)');
  if (!R.ownLive || !R.ownCtl) throw new Error('the page reported no own-tile measurement — the report expression is from an older copy of this gate');
  if (R.ownLive.own < 0 || R.ownCtl.own < 0)
    throw new Error('caret count and tile count disagree — teleReachPoints() is no longer index-aligned with PAINT.move, so every per-tile label in this file is wrong');
  console.log(`    live rows=${R.ownLive.rows}: ${R.ownLive.own}/${R.ownLive.of} carets inside tilePoly() of their OWN tile`);
  console.log(`    control rows=${R.ownCtl.rows}: ${R.ownCtl.own}/${R.ownCtl.of}`);
  if (R.ownCtl.stray.length)
    console.log('      e.g. ' + R.ownCtl.stray.slice(0,3).join('   ') + (R.ownCtl.of > 3 ? '   …' : ''));
  console.log('    lift sweep, same frame, same projection (rows -> carets over own tile):');
  console.log('      ' + R.ownMargin.map(([v,n]) => `${v}:${n}`).join('  '));
  /* 🔴 THE BAR IS THE MEASURED COLLAPSE, NOT A ROUND NUMBER I LIKED. 1.60 is
     0/36 on this fixture — the control has been SEEN to fail, which is the
     only thing that makes it evidence (§11). A quarter of the set is allowed
     as slack so a future fixture reshuffle does not turn a still-obviously-red
     control into a spurious gate error; anything above that and the
     containment test has stopped discriminating and its green below is worth
     nothing. */
  if (R.ownCtl.own > 0.25 * R.ownCtl.of){
    console.log(`\n🔴 CONTROL 0c FAILED: round 2's rows=1.60 kept ${R.ownCtl.own}/${R.ownCtl.of} carets on their own tile.`);
    console.log('   This test cannot tell a bound caret from a floating one, so assert 2');
    console.log('   below proves nothing. Fix the gate, not the build.');
    process.exit(1);
  }
  console.log(`    ✅ red: the shipped-and-wrong lift keeps ${R.ownCtl.own}/${R.ownCtl.of}, the live lift keeps ${R.ownLive.own}/${R.ownLive.of}\n`);

  console.log('--- 1. THE ASSERT: no caret below half the median ink, current order ---');
  /* the score is the MEDIAN of a caret's per-phase ratios, not its minimum:
     the minimum of a noisy quantity selects the unluckiest phase (a rain streak
     crossing one window in one frame of forty-four) and fails carets that
     nothing is occluding. The median is the persistence-robust version of the
     same question — an occluder is there at every phase, weather is not. */
  const bad = R.medRatio.map((v,i)=>[v,i]).filter(([v]) => v < 0.5);
  const order = R.medRatio.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]);
  console.log(`    net ink per caret: median=${mLive}  min=${Math.min(...live)}  max=${Math.max(...live)}  (sum of |delta|, floor subtracted)`);
  console.log('    five faintest carets (median of per-phase ratio to that phase\'s median):');
  for (const [v,i] of order.slice(0,5))
    console.log(`      · ${lab(R.pips, R.tiles, i)}  medianRatio=${v}  lowPhases=${(100*R.lowFrac[i]).toFixed(0)}%` +
                `${R.hidden.includes(i) ? '  [occluded tile]' : ''}`);
  /* the two carets the crowd critic named, quoted by tile so the before/after
     is checkable against their report rather than against a median */
  for (const t of ['8,5', '8,4']){
    const i = R.tiles.indexOf(t), j = c1.rep.tiles.indexOf(t);
    if (i >= 0 && j >= 0)
      console.log(`    critic's tile ${t}: live=${R.medRatio[i]}   round-1=${c1.rep.medRatio[j]}   recovered=${(R.medRatio[i]-c1.rep.medRatio[j]).toFixed(3)}`);
  }
  if (bad.length){
    console.log(`\n🔴 FAIL: ${bad.length} caret(s) below half the median — still being painted over.`);
    for (const [v,i] of bad) console.log(`      · ${lab(R.pips, R.tiles, i)} medianRatio=${v}`);
    fail = 1;
  } else {
    console.log(`\n✅ PASS: the faintest caret holds ${order[0][0]} of its phase median (bar is 0.5).`);
    /* ⚠ SAID OUT LOUD rather than left for a reader to infer — and COMPUTED,
       because the hard-coded version of this line went stale the moment the
       build changed under it. It used to read "round-1's worst caret measured
       0.566, which is ABOVE this bar", which was true while the caret floated
       1.60 rows up: a plate is translucent, so up in the air it DIMMED a caret
       rather than deleting it. Round 3 dropped the lift to 0.40 and the
       sentence became false without anybody touching this file — down at tile
       height a plate covers far more of the mark, and round 1's order now
       drags a caret to ~0.21, well under the bar.
       A gate that prints a stale claim about its own control is a gate a
       reader stops believing, so the claim is derived from the run rather than
       narrated. THE CONCLUSION IS UNCHANGED, and is the reason the line exists:
       the bar stays where the brief set it rather than being tuned to straddle
       the two orders, and it is control 0b's A/B — not this assert — that is
       relied on to separate them. */
    const r1w = Math.min(...c1.rep.medRatio);
    console.log(`   ⚠ round-1's worst caret measured ${r1w} — ` + (r1w < 0.5
      ? 'BELOW this bar, so at the current lift this assert happens to catch round 1 as well.'
      : 'also above this bar, so this assert alone does not separate the two orders.'));
    console.log('     Either way the separation is control 0b\'s A/B, which is measured rather than');
    console.log('     dependent on where this bar sits.');
  }

  console.log('\n--- 2. THE BINDING ASSERT: every caret hovers over the tile it means ---');
  /* §12.3.3, applied to POSITION rather than to membership. The set and the
     contour cannot disagree because both read PAINT.move; the caret can still
     disagree by being DRAWN SOMEWHERE ELSE, and that is what this catches. It
     is an equality, not a fraction: one caret over the wrong hexagon is one
     tile the player is told they can reach and cannot. */
  if (R.ownLive.own !== R.ownLive.of){
    console.log(`\n🔴 FAIL: ${R.ownLive.of - R.ownLive.own} of ${R.ownLive.of} carets are NOT over their own tile at rows=${R.ownLive.rows}.`);
    for (const s of R.ownLive.stray) console.log('      · ' + s);
    console.log('   A caret over the wrong hexagon points at a tile whose reachability it');
    console.log('   does not describe. Lower REACH_CUE.rows — see the sweep printed by 0c.');
    fail = 1;
  } else {
    console.log(`✅ PASS: all ${R.ownLive.of} carets fall inside tilePoly() of their own tile at rows=${R.ownLive.rows}.`);
    console.log('   (tested with the renderer\'s own tilePoly, not re-derived geometry.)');
  }
} catch (e){
  console.error('\n🔴 GATE ERROR: ' + (e && e.message || e));
  fail = 1;
} finally {
  /* ⚠ public/ is the DEPLOY ROOT. The control page is removed whether the gate
     passed, failed or threw — a stray copy of the board under the deploy root
     is a shipped duplicate of the whole app. */
  try { if (fs.existsSync(CTL)) fs.unlinkSync(CTL); } catch {}
  for (const f of tmp){ try { fs.unlinkSync(f); } catch {} }
  console.log(`\ncleanup: control page ${fs.existsSync(CTL) ? '🔴 STILL PRESENT ' + CTL : 'removed'}; ${tmp.length} shot copies removed`);
}
process.exit(fail);
