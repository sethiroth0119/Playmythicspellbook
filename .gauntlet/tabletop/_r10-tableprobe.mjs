/* THE ROUND-2 ACCEPTANCE PROBE FOR table-and-shadow.
   usage: node .gauntlet/tabletop/_r10-tableprobe.mjs <on.png> <off.png> [aa.png]
          node .gauntlet/tabletop/_r10-tableprobe.mjs --selftest <on.png>

   _r9-shadowab.mjs already answers "did anything move, and where". It does NOT
   answer the two questions this round was failed on, so they are asked here:

     • playtile_0_8 — the absolute mean luma of the play-surface rect
       (498,445,26,22). The whole reason the shadow is painted between the
       apron and the skirt is that it must NOT darken a tile a unit stands on.
       A delta probe cannot see that clause at all: if the shadow crept onto a
       tile in BOTH arms of a light-direction change, on-minus-off is happy and
       the tile is ruined. So this one is an ABSOLUTE reading, compared against
       the value the previous round measured (130.3), tolerance 1 luma.
     • the bare-felt strip at y=440. x=320 and x=340 read on-minus-off = 0.0
       exactly in round 1 — that is the failure in one number: open table left
       of the board saw no shadow at all. Single pixels are rain-prone, so each
       x is reported as the pixel AND as an 11x11 patch mean around it; the
       patch is what to quote and the pixel is there to show they agree.

   🔴 THE NEGATIVE CONTROL IS BUILT IN AND IT IS NOT OPTIONAL — TABLETOP-BAR
   §11, "a gate nobody has seen fail is not evidence". `--selftest` runs the
   same code against (a) the image compared with itself, which MUST report
   every delta at exactly 0, and (b) the image compared with a copy of itself
   that has been darkened by a known 8 luma inside a box covering the strip
   samples, which MUST report ~8 at those samples and 0 outside the box. If
   either arm does not come back as stated, this probe is measuring nothing
   and no number it prints about the real build means anything. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const SELFTEST = args[0] === '--selftest';
const [ON, OFF, AA] = SELFTEST ? [args[1]] : args;
const b64 = f => readFileSync(f).toString('base64');

const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });

/* `mutate` is the selftest's hook: a rect and a luma drop applied to the OFF
   arm before it is measured. null for every real run. */
async function measure(a, b, mutate) {
  return pg.evaluate(async ([A, B, mutate]) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; };
    const ia = await load(A), ib = await load(B);
    const W = ia.width, H = ia.height;
    const mk = im => { const c = document.createElement('canvas'); c.width = W; c.height = H;
                       const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
                       return g.getImageData(0, 0, W, H).data; };
    const A4 = mk(ia), B4 = mk(ib);
    if (mutate) {
      /* darken INSIDE the box, so the selftest also proves the probe is not
         reporting a global offset it would see anywhere it looked. */
      const [mx, my, mw, mh, drop] = mutate;
      for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) {
        const i = (y * W + x) * 4;
        /* B is the OFF arm and off-minus-on is the reported delta, so a
           BRIGHTER off is a positive delta — i.e. the shadow darkened the on
           arm. Raise B by `drop` to simulate a shadow of that depth. */
        B4[i] = Math.min(255, B4[i] + drop);
        B4[i + 1] = Math.min(255, B4[i + 1] + drop);
        B4[i + 2] = Math.min(255, B4[i + 2] + drop);
      }
    }
    const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boxMean = (d, x0, y0, w, h) => {
      let s = 0, n = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { s += L(d, (y * W + x) * 4); n++; }
      return +(s / n).toFixed(2);
    };
    const deltaAt = (x, y) => { const i = (y * W + x) * 4; return +(L(B4, i) - L(A4, i)).toFixed(2); };
    const deltaPatch = (x, y, r) => {
      let s = 0, n = 0;
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        const i = (yy * W + xx) * 4; s += L(B4, i) - L(A4, i); n++;
      }
      return +(s / n).toFixed(2);
    };
    const strip = x => ({ x, y: 440, pixelDelta: deltaAt(x, 440), patch11Delta: deltaPatch(x, 440, 5) });
    return {
      W, H,
      /* the clause that must NOT move */
      playtile_0_8: { rect: [498, 445, 26, 22], on: boxMean(A4, 498, 445, 26, 22), off: boxMean(B4, 498, 445, 26, 22) },
      /* the clause that must move */
      bareFeltStrip: [strip(320), strip(340)],
      /* the same open-table box _r9-shadowab uses, repeated here so one run
         answers the whole acceptance line without cross-referencing two tools */
      openTableLeft: { rect: [60, 240, 300, 300], meanOn: boxMean(A4, 60, 240, 300, 300), meanOff: boxMean(B4, 60, 240, 300, 300) },
      /* 🔴 THE MASK MEASURE, AND WHY A FIXED RECTANGLE COULD NOT ANSWER THIS.
         The board is drawn in isometric, so the felt outside its left kerb is a
         DIAGONAL strip; openTableLeft is an axis-aligned square sitting at the
         far left of it. A cast shadow hugs the object casting it, so the two
         overlap only in one corner and the box's mean is mostly a average of
         table the shadow was never going to reach — it answers "what fraction
         of this square is in shade", which is a question about the square.
         This instead masks to the pixels that ARE bare felt in the OFF arm
         (luma 55–95: the table measures 63–79 all along the strips, board tops
         run 100–180 and the dark cliff faces under 45, so the window excludes
         both) inside a generous left-of-board region, and reports how many of
         them the shadow took and how deep. That is the §2 question: is there a
         board-shaped shadow on bare table, and would a player see it.
         ⚠ It is a SUPPLEMENT, never a replacement. openTableLeft above is the
         number this round was set, it is still printed, and the handoff quotes
         both. A builder who deletes a failing measurement has not passed it. */
      bareFeltLeft: (() => {
        const X0 = 120, X1 = 460, Y0 = 200, Y1 = 600;
        let felt = 0, shaded = 0, sum = 0, peak = 0;
        for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
          const i = (y * W + x) * 4;
          const lo = L(B4, i);
          if (lo < 55 || lo > 95) continue;          /* not bare felt in the control */
          felt++;
          const d = lo - L(A4, i);
          if (d > 3) { shaded++; sum += d; if (d > peak) peak = d; }
        }
        return { region: [X0, Y0, X1 - X0, Y1 - Y0], feltPx: felt, shadedPx: shaded,
                 shadedPctOfFelt: felt ? +(shaded / felt * 100).toFixed(1) : 0,
                 meanDeltaOnShaded: shaded ? +(sum / shaded).toFixed(2) : 0, peak: +peak.toFixed(1) };
      })(),
    };
  }, [a, b, mutate]);
}

if (SELFTEST) {
  const img = b64(ON);
  const same = await measure(img, img, null);
  /* the box covers both strip samples (x 320 and 340 at y 440, with the 11x11
     patch reaching x±5 / y±5) and misses playtile_0_8 at (498,445) entirely. */
  const bumped = await measure(img, img, [300, 420, 80, 40, 8]);
  const ok = {
    identityAllZero: same.bareFeltStrip.every(s => s.pixelDelta === 0 && s.patch11Delta === 0)
                     && same.playtile_0_8.on === same.playtile_0_8.off,
    bumpSeenAtStrip: bumped.bareFeltStrip.every(s => Math.abs(s.pixelDelta - 8) < 0.51 && Math.abs(s.patch11Delta - 8) < 0.51),
    bumpNotSeenOnPlaytile: Math.abs(bumped.playtile_0_8.off - bumped.playtile_0_8.on) < 0.01,
    /* the mask measure gets the same treatment: nothing shaded when an image is
       compared with itself, and the 80x40 synthetic patch found when there is
       one. Without this the new metric is exactly the "check that runs, exits 0
       and answers a question one degree away" the brief warns about. */
    identityNoFeltShaded: same.bareFeltLeft.shadedPx === 0,
    bumpSeenInFeltMask: bumped.bareFeltLeft.shadedPx > 500 && Math.abs(bumped.bareFeltLeft.meanDeltaOnShaded - 8) < 0.51,
  };
  console.log(JSON.stringify({ selftest: { identity: same, darkenedBy8: bumped, verdict: ok,
    PASS: Object.values(ok).every(Boolean) } }, null, 1));
} else {
  const out = { ab: await measure(b64(ON), b64(OFF), null) };
  if (AA) out.negativeControl_AA = await measure(b64(ON), b64(AA), null);
  console.log(JSON.stringify(out, null, 1));
}
await br.close();
