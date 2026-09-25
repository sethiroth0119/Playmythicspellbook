/* procedural-ruins r2 — WHERE CAN THE LAND BAKE STILL BE SEEN?
   Diffs the opaque-black room-line probe against the base and prints, per row,
   how many of 1600 columns moved by more than 3 luma. That is the honest answer
   to "how far down the frame can bakeLand still paint", which is NOT a question
   the source can answer: paintTerrain() fills the whole ground quad opaquely
   over this bake, so a stop extended past that quad's top edge draws nothing.
   The probe frame comes from _pr-ablate-roomline.mjs — read its header.
   🔴 ITS NEGATIVE CONTROL IS THE SAME PNG PASSED TWICE, and it was run BEFORE the
   result was believed: every row must read `moved 0/1600  meanDL 0.00`. Verified
   2026-09-15 on rows 185-194 — 0/1600 against itself, 1600/1600 against the probe.
   A reach tool that cannot report "nothing moved" is a tool that always says yes.
   usage: node _pr-reach2.mjs <base.png> <probe.png> [y0] [y1] */
import sharp from 'sharp';
const [A, B, y0s, y1s] = process.argv.slice(2);
const y0 = +(y0s || 0), y1 = +(y1s || 900);
const a = await sharp(A).extract({ left: 0, top: y0, width: 1600, height: y1 - y0 }).raw().toBuffer({ resolveWithObject: true });
const b = await sharp(B).extract({ left: 0, top: y0, width: 1600, height: y1 - y0 }).raw().toBuffer({ resolveWithObject: true });
const ch = a.info.channels;
const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
for (let r = 0; r < a.info.height; r++) {
  let n = 0, sum = 0;
  for (let c = 0; c < 1600; c++) {
    const i = (r * 1600 + c) * ch;
    const d = L(b.data, i) - L(a.data, i);
    if (Math.abs(d) > 3) n++;
    sum += d;
  }
  console.log(String(y0 + r).padStart(4), 'moved', String(n).padStart(4), '/1600  meanDL', (sum / 1600).toFixed(2));
}
