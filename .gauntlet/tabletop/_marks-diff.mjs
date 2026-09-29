/* arena-markings: A/B the terrain bake before vs after the markings pass.
   Both PNGs are produced by shot.mjs at the same seed/camera, so any pixel that
   moved is mine. Reports coverage and the strongest rows/cols so the centre
   line and the two deployment bands can be located by number, not by eye. */
import sharp from 'sharp';
const dir = 'E:/game-deploy/.gauntlet/tabletop/';
const A = process.argv[2] || dir + 'arena-markings-before.png';
const B = process.argv[3] || dir + 'arena-markings-r1.png';
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { data, info }; }
const a = await raw(A), b = await raw(B);
const { width:W, height:H, channels:C } = a.info;
/* the board occupies roughly y 200..600, x 380..1300 in the 1600x900 shot */
let moved = 0, maxd = 0;
const rowN = new Array(H).fill(0);
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const i=(y*W+x)*C;
  const d = Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2]);
  if (d > 6){ moved++; rowN[y]++; }
  if (d > maxd) maxd = d;
}
console.log('changed px: ' + moved + ' of ' + (W*H) + ' (' + (100*moved/(W*H)).toFixed(2) + '%)  max |dRGB| sum = ' + maxd);
const bands = [];
for (let y=0;y<H;y+=20){ let n=0; for(let k=y;k<Math.min(H,y+20);k++) n+=rowN[k]; if (n) bands.push(y+':'+n); }
console.log('rows with change: ' + bands.join(' '));
