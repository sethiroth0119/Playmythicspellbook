/* THE HULL'S OWN HAZARD, which the builder's own measurements do not cover.
   The pool is the convex hull of the board's lip projected at y=0 AND at
   y=maxElev+0.25. On a high three-quarter camera the raised ring projects
   UPWARD on screen, so the hull is the board quad EXTENDED UPWARD — and every
   pixel in that extension is INSIDE the pool and therefore NOT darkened, even
   though it is table/backdrop and not board. If that extension is large, the
   piece leaves an undarkened wedge sitting directly above the board's far
   edge: a lit hole in the middle of a floodlit frame.

   So: horizontal luma profiles at rows ABOVE the board's far edge, armed vs
   ablated. A wedge shows as dL ~ 0 in the middle of the row and dL << 0 at
   both ends. */
import sharp from 'file:///E:/game-deploy/node_modules/sharp/lib/index.js';
const W = 1600;
const load = async p => (await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const [fa, fb] = process.argv.slice(2);
const A = await load(fa), B = await load(fb);
for (const y of [60, 100, 140, 165, 185, 210]) {
  const a = [], b = [], d = [];
  for (let x = 40; x < 1600; x += 100) {
    const i = (y * W + x) * 4;
    a.push(lum(A, i).toFixed(0).padStart(4)); b.push(lum(B, i).toFixed(0).padStart(4));
    d.push((lum(A, i) - lum(B, i)).toFixed(0).padStart(4));
  }
  console.log('y=' + String(y).padStart(3) + ' armed ' + a.join(''));
  console.log('      abl.  ' + b.join(''));
  console.log('      dL    ' + d.join('') + '\n');
}
