/* arena-markings CRITIC round 1 — crop/zoom a render so the pitch can be SEEN.
   Lives here rather than in a scratchpad because `sharp` only resolves from
   inside the repo's node_modules.
   usage: node _am-crit-crop.mjs <in> <out> x y w h [scale] */
import sharp from 'sharp';
const [IN, OUT, x, y, w, h, s] = process.argv.slice(2);
const sc = +(s || 1);
await sharp(IN).extract({ left:+x, top:+y, width:+w, height:+h })
  .resize({ width: Math.round(+w*sc), kernel:'nearest' }).png().toFile(OUT);
console.log('wrote', OUT, +w + 'x' + h, 'scale', sc);
