/* critic crop: sharp lives at E:/game-deploy/node_modules, and sharp resolves by
   walking UP from the script, so this must live in the repo, not the scratchpad. */
import sharp from 'sharp';
const [file, out, x, y, w, h, scale] = process.argv.slice(2);
await sharp(file)
  .extract({ left: +x, top: +y, width: +w, height: +h })
  .resize({ width: Math.round(+w * (+scale || 1)), kernel: 'nearest' })
  .toFile(out);
console.log('wrote', out);
