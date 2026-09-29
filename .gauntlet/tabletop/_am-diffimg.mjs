/* arena-markings r1 — render the A/B as a PICTURE, not a percentage.
   A row histogram tells you a band moved; it cannot tell you whether what moved
   is a straight painted line, a wash, a ring, or the rain. The difference image
   shows the SHAPE, which is the only thing that answers §7 and §3.4.
   Green = the on/off signal. Red = the on/on control (rain, grain, sky), drawn
   in the same frame at the same gain so the eye can separate my paint from the
   renderer's own jitter instead of being asked to trust a threshold.
   usage: node _am-diffimg.mjs <off.png> <on.png> <onRepeat.png> <out.png> [gain] */
import sharp from 'sharp';
const [OFF, ON, REP, OUT] = process.argv.slice(2, 6);
const GAIN = +(process.argv[6] || 6);
async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { d:data, w:info.width, h:info.height, c:info.channels }; }
const a = await raw(OFF), b = await raw(ON), r = await raw(REP);
const { w:W, h:H, c:C } = a;
const out = Buffer.alloc(W*H*3);
for (let p = 0; p < W*H; p++){
  const i = p*C;
  const dAB = (Math.abs(a.d[i]-b.d[i]) + Math.abs(a.d[i+1]-b.d[i+1]) + Math.abs(a.d[i+2]-b.d[i+2])) / 3;
  const dBR = (Math.abs(r.d[i]-b.d[i]) + Math.abs(r.d[i+1]-b.d[i+1]) + Math.abs(r.d[i+2]-b.d[i+2])) / 3;
  out[p*3+0] = Math.min(255, dBR * GAIN);   /* control  → red   */
  out[p*3+1] = Math.min(255, dAB * GAIN);   /* my paint → green */
  out[p*3+2] = 0;
}
await sharp(out, { raw:{ width:W, height:H, channels:3 } }).png().toFile(OUT);
console.log('wrote ' + OUT + '  (green = markings signal, red = render noise, gain ' + GAIN + ')');
