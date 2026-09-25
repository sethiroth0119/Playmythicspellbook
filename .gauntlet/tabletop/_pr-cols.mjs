/* procedural-ruins r2 — column-mean luma across a horizontal strip, bucketed,
   so a LEFT-RIGHT ramp in the surround is a number instead of a squint.
   usage: node _pr-cols.mjs <png> y0 h bucket

   🔴 WHAT IT FOUND, AND IT IS NOT THE SURROUND — FOR `staged-lighting`.
   The round-1 gap asked for edge-far-L (0,380,90,160) to stop measuring
   brighter than mid-L (200,380,90,160) — 73.1 vs 70.9 on the gauntlet `mixed`
   fixture. Run at bucket 40 that pair resolves into something else entirely:

       x    0- 40  L 79.4      x 1560-1600  L 84.2
       x   40- 80  L 68.3      x 1520-1560  L 71.4
       x   80-120  L 69.5      x 1480-1520  L 70.8

   i.e. the whole of the "edge is brighter" reading is the OUTERMOST ~40 px of
   the frame, on the left AND right edges only, and the surround just inside it
   already falls off outward correctly (edge-minus-rim (40,380,90,160) L 69.0
   vs mid-frame L 70.9). The same 40 px rim is +15 luma in PURE SKY at y 40-120
   (133.1 vs 118.2), where no table, apron or room line is painted at all, and
   it does NOT appear on the top edge. It moved +0.1 across a change that moved
   the horizon junction by −32.6, so it is not the surround's shading: it is a
   post-process edge artifact in grade(), almost certainly the multiply map's
   blur fading to transparent at its own buffer edge — a map that fades out
   leaves the frame UNMULTIPLIED, i.e. brighter — and it therefore belongs to
   whoever owns the grade. Do not chase it from the land bake; the land bake
   cannot reach y 380 at all (see _pr-reach2.mjs).

   ⚠ NEGATIVE CONTROL. Point it at a flat synthetic and every bucket must read
   the same L; point it at the two halves of any A/B where you already know the
   answer (e.g. the board box, which no surround change may move) and the
   buckets must not move either. The measured pair above is stated as fact only
   because the rim survives a change that moved everything around it. */
import sharp from 'sharp';
const [IN, y0s, hs, bs] = process.argv.slice(2);
const y0 = +y0s, h = +hs, bw = +(bs || 100);
const { data, info } = await sharp(IN).extract({ left: 0, top: y0, width: 1600, height: h })
  .raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
for (let x0 = 0; x0 < info.width; x0 += bw) {
  let R = 0, G = 0, B = 0, n = 0;
  for (let r = 0; r < info.height; r++) for (let c = x0; c < Math.min(x0 + bw, info.width); c++) {
    const i = (r * info.width + c) * ch; R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
  }
  R /= n; G /= n; B /= n;
  console.log(String(x0).padStart(5), 'L', (0.299 * R + 0.587 * G + 0.114 * B).toFixed(1));
}
