/* THE SHADOW A/B, WITH ITS OWN NEGATIVE CONTROL.
   usage: node .gauntlet/tabletop/_r9-shadowab.mjs <on.png> <off.png> [aa.png] [heat.png]

   Reports, over the whole frame and over the BOTTOM THIRD separately:
     • pixels where off-minus-on luma exceeds a threshold (the shadow darkens,
       so the delta is one-signed and a two-sided count would be noise)
     • mean and peak delta on those pixels
     • the moved region's bbox and centroid, and the centroid's offset from the
       board's own screen centre — which is what says the shape is thrown along
       a light vector rather than dropped symmetrically underneath.
   🔴 THE THIRD ARGUMENT IS THE POINT. The board rains, so two captures of the
   SAME arm differ. Without an A/A pass in the same rig every number below is
   unfalsifiable: pass the same-arm capture as aa.png and the tool prints the
   floor it has to beat. TABLETOP-BAR §11. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const [ON, OFF, AA, HEAT] = process.argv.slice(2);
const b64 = f => readFileSync(f).toString('base64');
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 40, height: 40 } });

async function pair(a, b, wantHeat) {
  return pg.evaluate(async ([A, B, wantHeat]) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); return i; };
    const ia = await load(A), ib = await load(B);
    const W = ia.width, H = ia.height;
    const mk = im => { const c = document.createElement('canvas'); c.width = W; c.height = H;
                       const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
                       return g.getImageData(0, 0, W, H).data; };
    const A4 = mk(ia), B4 = mk(ib);
    const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const TH = 3;                       /* luma; below this is rain and dither */
    const zone = (y0, y1) => {
      let n = 0, sum = 0, peak = 0, sx = 0, sy = 0;
      let x0 = 1e9, y0b = 1e9, x1 = -1, y1b = -1;
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const d = L(B4, i) - L(A4, i);   /* off minus on: positive = the shadow darkened it */
        if (d > TH) { n++; sum += d; if (d > peak) peak = d; sx += x; sy += y;
                      if (x < x0) x0 = x; if (x > x1) x1 = x;
                      if (y < y0b) y0b = y; if (y > y1b) y1b = y; }
      }
      return { px: n, mean: n ? +(sum / n).toFixed(2) : 0, peak: +peak.toFixed(1),
               cx: n ? Math.round(sx / n) : null, cy: n ? Math.round(sy / n) : null,
               bbox: n ? [x0, y0b, x1, y1b] : null };
    };
    /* THE OPEN-TABLE BOX. The zone counters above are thresholded, so they
       answer "how many pixels moved"; this one is the plain mean over every
       pixel in a rectangle of bare table left of the board, which is the
       number that says whether a player standing in front of the screen would
       SEE a shadow there. Thresholding it would hide the answer, because a
       shadow that is 1 luma deep over a whole box passes a >3 filter on none
       of its pixels and is still exactly the failure being looked for. */
    const box = (x0, y0, w, h) => {
      let s = 0, n = 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const i = (y * W + x) * 4;
        s += L(B4, i) - L(A4, i); n++;
      }
      return { rect: [x0, y0, w, h], meanDelta: +(s / n).toFixed(2) };
    };
    const out = { W, H, all: zone(0, H), bottomThird: zone(Math.floor(H * 2 / 3), H),
                  openTableLeft: box(60, 240, 300, 300),
                  openTableRight: box(1250, 240, 300, 300) };
    if (wantHeat) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); const im = g.createImageData(W, H);
      for (let i = 0; i < A4.length; i += 4) {
        const d = Math.max(0, L(B4, i) - L(A4, i));
        const v = Math.min(255, d * 6);
        im.data[i] = v; im.data[i + 1] = v * 0.4; im.data[i + 2] = 255 - v; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      out.heat = c.toDataURL('image/png');
    }
    return out;
  }, [a, b, wantHeat]);
}

const main = await pair(b64(ON), b64(OFF), !!HEAT);
if (HEAT && main.heat) writeFileSync(HEAT, Buffer.from(main.heat.split(',')[1], 'base64'));
delete main.heat;
const res = { ab: main };
if (AA) { const aa = await pair(b64(ON), b64(AA), false); res.negativeControl_AA = aa; }
console.log(JSON.stringify(res, null, 1));
await br.close();
