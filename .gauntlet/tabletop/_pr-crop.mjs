/* procedural-ruins piece — crop/zoom a region of a shot so a silhouette can be
   judged by eye. Lives in the repo (not the scratchpad) only because `sharp`
   resolves from node_modules by walking UP from the script, and a script in the
   temp scratchpad never reaches E:/game-deploy/node_modules.
   usage: node .gauntlet/tabletop/_pr-crop.mjs <in> <out> x y w h [scale] */
import sharp from 'sharp';
const [IN, OUT, x, y, w, h, s] = process.argv.slice(2);
const sc = +(s || 1);
await sharp(IN).extract({ left: +x, top: +y, width: +w, height: +h })
  .resize({ width: Math.round(+w * sc), kernel: 'nearest' }).png().toFile(OUT);
console.log('wrote', OUT, +w + 'x' + h, 'scale', sc);
