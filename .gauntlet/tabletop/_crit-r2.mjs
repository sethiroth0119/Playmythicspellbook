/* critic round-2 measurement rig for "table-and-shadow".
   Decodes PNGs to raw RGBA via a headless canvas (no image lib in repo), then
   answers the questions §2 and §7 actually ask. Every metric has a negative
   control run by --selftest: identity must read exactly 0, and a copy darkened
   by a KNOWN amount inside a KNOWN box must read that amount in that box and
   nothing outside it. If the selftest does not fail when I break it, the
   numbers below are decoration. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });

async function load(path) {
  const b64 = readFileSync(path).toString('base64');
  const d = await pg.evaluate(async (s) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: Array.from(d.data) };
  }, b64);
  return { w: d.w, h: d.h, px: Uint8ClampedArray.from(d.data) };
}
const L = (im, x, y) => {
  const o = (y * im.w + x) * 4;
  return 0.2126 * im.px[o] + 0.7152 * im.px[o + 1] + 0.0722 * im.px[o + 2];
};
const RGB = (im, x, y) => { const o = (y * im.w + x) * 4; return [im.px[o], im.px[o + 1], im.px[o + 2]]; };

function boxMean(im, x, y, w, h) {
  let s = 0, n = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { s += L(im, i, j); n++; }
  return s / n;
}
function boxRGB(im, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const c = RGB(im, i, j); r += c[0]; g += c[1]; b += c[2]; n++; }
  return [r / n, g / n, b / n];
}
/* on-minus-off over a rect: px moved by >3 luma, mean signed delta, peak, centroid */
function diff(a, b, x, y, w, h, thr = 3) {
  let n = 0, sum = 0, peak = 0, cx = 0, cy = 0, sumAll = 0, nAll = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const d = L(b, i, j) - L(a, i, j);       /* off minus on: positive = on is DARKER */
    sumAll += d; nAll++;
    if (Math.abs(d) > thr) { n++; sum += Math.abs(d); if (Math.abs(d) > peak) peak = Math.abs(d); cx += i; cy += j; }
  }
  return { movedPx: n, meanMoved: n ? sum / n : 0, peak, centroid: n ? [Math.round(cx / n), Math.round(cy / n)] : null,
           meanAll: sumAll / nAll };
}

const mode = process.argv[2];

if (mode === '--selftest') {
  const im = await load(process.argv[3]);
  /* control A: identity. Every number must be exactly 0. */
  const id = diff(im, im, 0, 0, im.w, im.h);
  /* control B: a copy darkened by exactly 8 luma inside (100,400,200,120). */
  const cp = { w: im.w, h: im.h, px: Uint8ClampedArray.from(im.px) };
  for (let j = 400; j < 520; j++) for (let i = 100; i < 300; i++) {
    const o = (j * im.w + i) * 4;
    cp.px[o] = Math.max(0, cp.px[o] - 8); cp.px[o + 1] = Math.max(0, cp.px[o + 1] - 8); cp.px[o + 2] = Math.max(0, cp.px[o + 2] - 8);
  }
  const inBox  = diff(cp, im, 100, 400, 200, 120, 3);   /* cp is "on" (darker) */
  const outBox = diff(cp, im, 900, 400, 200, 120, 3);
  console.log(JSON.stringify({ identity: id, darkenedBox: inBox, untouchedBox: outBox }, null, 1));
  console.log('SELFTEST PASS:', id.movedPx === 0 && id.meanAll === 0 &&
    Math.abs(inBox.meanAll - 8) < 0.9 && outBox.movedPx === 0);
  await br.close(); process.exit(0);
}

const ON = await load(process.argv[2]);
const OFF = await load(process.argv[3]);
const AA = await load(process.argv[4]);

const out = {};

/* ── 1. ABLATION: is there a cast shadow at all, and WHERE ─────────────────
   Whole frame, then the surround only (everything outside the board's own
   screen bbox), because a "shadow" that only moves pixels ON the board is not
   the cue §2 names. Board bbox on this fixture measured from the render. */
out.whole = diff(ON, OFF, 0, 0, ON.w, ON.h);
out.aaWhole = diff(ON, AA, 0, 0, ON.w, ON.h);

/* the board's own screen quad on this fixture, from the kerb corners the
   geometry note quotes: (549,198)(1156,198)(1341,616)(358,616), grown a little
   to swallow the kerb + skirt. Anything outside this is TABLE. */
const BX = [340, 190, 1020, 440];   /* x,y,w,h — a generous board box */
function outsideBoard(im, i, j) {
  return !(i >= BX[0] && i < BX[0] + BX[2] && j >= BX[1] && j < BX[1] + BX[3]);
}
(function surroundDiff() {
  let n = 0, s = 0, peak = 0, cx = 0, cy = 0, nAll = 0, sAll = 0;
  let naa = 0;
  for (let j = 0; j < ON.h; j++) for (let i = 0; i < ON.w; i++) {
    if (!outsideBoard(ON, i, j)) continue;
    if (j > 600) continue;                       /* below 600 the card rail owns the frame */
    const d = L(OFF, i, j) - L(ON, i, j);
    const daa = L(AA, i, j) - L(ON, i, j);
    sAll += d; nAll++;
    if (Math.abs(d) > 3) { n++; s += Math.abs(d); if (Math.abs(d) > peak) peak = Math.abs(d); cx += i; cy += j; }
    if (Math.abs(daa) > 3) naa++;
  }
  out.surround = { movedPx: n, aaFloorPx: naa, meanMoved: n ? s / n : 0, peak,
                   centroid: n ? [Math.round(cx / n), Math.round(cy / n)] : null, meanAll: sAll / nAll };
})();

/* ── 2. §2 "there IS a table under it" — is the surround ONE material? ─────
   A table is one surface. Walk a vertical column well left of the board from
   the horizon down to the card rail and report the luma at every 20 rows plus
   the RGB, so a critic can see whether it is felt or a landscape with bands. */
out.leftColumn = [];
for (let y = 180; y <= 600; y += 20) out.leftColumn.push([y, +boxMean(ON, 120, y, 24, 8).toFixed(1), boxRGB(ON, 120, y, 24, 8).map(v => Math.round(v))]);
out.rightColumn = [];
for (let y = 180; y <= 600; y += 20) out.rightColumn.push([y, +boxMean(ON, 1450, y, 24, 8).toFixed(1), boxRGB(ON, 1450, y, 24, 8).map(v => Math.round(v))]);

/* ── 3. §2 FAIL clause: horizon / sky / scenery above the board ───────────
   Row profile down the centre of the frame from y=0. A table has no horizon.
   Report where the biggest vertical luma step is above the board. */
out.centreRows = [];
for (let y = 4; y <= 260; y += 8) out.centreRows.push([y, +boxMean(ON, 760, y, 60, 6).toFixed(1)]);

/* ── 4. §7 "the playfield is the brightest thing in frame" ─────────────────*/
out.brightness = {
  playfieldMean: +boxMean(ON, 560, 230, 580, 330).toFixed(2),
  skyMean:       +boxMean(ON, 700, 10, 400, 40).toFixed(2),
  cliffMean:     +boxMean(ON, 180, 40, 300, 80).toFixed(2),
  farTableMean:  +boxMean(ON, 120, 210, 200, 40).toFixed(2),
  nearTableMean: +boxMean(ON, 120, 480, 200, 60).toFixed(2),
  cardRailMean:  +boxMean(ON, 220, 640, 1160, 230).toFixed(2),
};

/* ── 5. the shadow's own footprint on bare table: LEFT vs RIGHT symmetry ───
   §2 wants a directional contact shadow. Sample matched boxes mirrored about
   the frame centre (x=800) at the same rows, on both the ON and OFF arm. */
out.flanks = [];
for (const y of [260, 320, 380, 440, 500, 540]) {
  const lx = 200, rx = 1600 - 200 - 120;
  out.flanks.push({ y,
    leftOn: +boxMean(ON, lx, y, 120, 16).toFixed(1), leftOff: +boxMean(OFF, lx, y, 120, 16).toFixed(1),
    rightOn: +boxMean(ON, rx, y, 120, 16).toFixed(1), rightOff: +boxMean(OFF, rx, y, 120, 16).toFixed(1) });
}

/* ── 6. a horizontal scan across the near-left table at y=470, on vs off,
   so "a band lies on the table" can be seen as a profile rather than asserted */
out.scanY470 = [];
for (let x = 60; x <= 700; x += 20) out.scanY470.push([x, +boxMean(ON, x, 470, 12, 10).toFixed(1), +boxMean(OFF, x, 470, 12, 10).toFixed(1)]);

console.log(JSON.stringify(out, null, 1));

/* heat map of |on-off| so the shape can be LOOKED at */
{
  const hm = await pg.evaluate(async ([a, b, w, h]) => {
    const A = new Image(); A.src = 'data:image/png;base64,' + a; await A.decode();
    const B = new Image(); B.src = 'data:image/png;base64,' + b; await B.decode();
    const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
    const ga = ca.getContext('2d', { willReadFrequently: true }); ga.drawImage(A, 0, 0);
    const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
    const gb = cb.getContext('2d', { willReadFrequently: true }); gb.drawImage(B, 0, 0);
    const da = ga.getImageData(0, 0, w, h), db = gb.getImageData(0, 0, w, h);
    const o = ga.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const la = 0.2126 * da.data[i * 4] + 0.7152 * da.data[i * 4 + 1] + 0.0722 * da.data[i * 4 + 2];
      const lb = 0.2126 * db.data[i * 4] + 0.7152 * db.data[i * 4 + 1] + 0.0722 * db.data[i * 4 + 2];
      const d = Math.min(255, Math.abs(lb - la) * 6);
      o.data[i * 4] = d; o.data[i * 4 + 1] = d; o.data[i * 4 + 2] = d; o.data[i * 4 + 3] = 255;
    }
    ga.putImageData(o, 0, 0); return ca.toDataURL('image/png');
  }, [readFileSync(process.argv[2]).toString('base64'), readFileSync(process.argv[3]).toString('base64'), ON.w, ON.h]);
  writeFileSync(process.argv[5] || '.gauntlet/tabletop/_c2-heat.png', Buffer.from(hm.split(',')[1], 'base64'));
}
await br.close();
