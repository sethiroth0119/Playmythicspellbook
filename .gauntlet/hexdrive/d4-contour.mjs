// DRIVER 4 — THE REACHABLE-AREA CONTOUR, on the canvas stage.
//
// The merge made a deliberate hybrid at battle-board/index.html drawTeleGround():
// when window.BBX.tilefx.drawStates exists it OWNS the PAINT.move region and
// theirs' teleWash + teleStroke is suppressed. So the contour the player
// actually sees is the one src/battle/stage/tilefx.js traces. This driver asks
// the LIVE page which one is drawing, and then measures that one's own
// adjacency rule against the hex lattice.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();

// wait for the stage iframe to come up
await page.waitForFunction(() => {
  try {
    const f = document.querySelector('#bb-stage-host iframe');
    return !!(f && f.contentWindow && f.contentWindow.Board);
  } catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

// The four stage modules are deferred <script type="module"> tags at the bottom
// of battle-board/index.html. Give them time to attach to window.BBX before
// asking who owns the move region — asking too early answers "nobody" and would
// score the hybrid's live branch wrong.
await page.waitForFunction(() => {
  try {
    const f = document.querySelector('#bb-stage-host iframe');
    const b = f && f.contentWindow && f.contentWindow.BBX;
    return !!(b && Object.keys(b).length >= 4);
  } catch (e) { return false; }
}, null, { timeout: 60000 }).catch(() => {});

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => {
    try { const r = fn(); res.push({ name, ...r }); }
    catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); }
  };
  const f = document.querySelector('#bb-stage-host iframe');
  const bw = f && f.contentWindow;

  T('stage iframe is up and exposes the board', () => ({
    pass: !!(bw && bw.Board), note: bw ? `Board ${typeof bw.Board}, BBX ${bw.BBX ? Object.keys(bw.BBX).join('/') : 'none'}` : 'no iframe' }));

  // WHO OWNS THE MOVE REGION AT RUNTIME
  T('drawTeleGround hybrid: which layer draws PAINT.move', () => {
    if (!bw) return { pass: false, note: 'no stage' };
    const has = !!(bw.BBX && bw.BBX.tilefx && bw.BBX.tilefx.drawStates);
    return { pass: true, note: has
      ? 'BBX.tilefx.drawStates PRESENT -> tilefx owns the contour; the battlefield branch teleWash/teleStroke is SUPPRESSED'
      : 'BBX.tilefx.drawStates ABSENT -> the battlefield branch teleWash/teleStroke draws it' };
  });

  // tilePoly is the spine's authority on a tile's screen polygon. On the hex
  // board it is a HEXAGON. jitQuad's fallback demands exactly 4 points.
  T('tilePoly vertex count on the hex board (jitQuad fallback expects 4)', () => {
    if (!bw || !bw.tilePoly) return { pass: false, note: 'tilePoly not reachable' };
    const p = bw.tilePoly(6, 6, 0);
    const n = p ? p.length : 0;
    return { pass: n === 6, note: `tilePoly(6,6) returns ${n} vertices (hexCorners -> 6). jitQuad's fallback tests \`tp.length !== 4\` and returns null on anything else.` };
  });

  return res;
});

for (const r of R) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`);
console.log('pageErrors:', pageErrors.length, pageErrors.slice(0, 6));
await close();
