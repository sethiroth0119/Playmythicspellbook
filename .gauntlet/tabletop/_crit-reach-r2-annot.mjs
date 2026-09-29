/* Draw the measured displacement onto the frame it was measured on:
   a magenta line from each caret to the CENTRE OF THE TILE IT MEANS.
   Magenta because nothing on this board is magenta — a debug overlay that
   shares a hue with the thing it annotates is unreadable, which is the same
   mistake §12.3.2 rejects in the product. */
import fs from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const D = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./_crit-reach-r2c.json', import.meta.url)), 'utf8'));
const W = 1600, H = 900;
const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">'];
for (const o of D){
  svg.push(`<line x1="${o.px}" y1="${o.py}" x2="${o.cx}" y2="${o.cy}" stroke="#ff2bd6" stroke-width="1.4" opacity="0.95"/>`);
  svg.push(`<circle cx="${o.cx}" cy="${o.cy}" r="2.6" fill="#ff2bd6"/>`);
}
svg.push('</svg>');
const src = fileURLToPath(new URL('./_crit-reach-r2c.png', import.meta.url));
const out = fileURLToPath(new URL('./_crit-reach-r2-annot.png', import.meta.url));
await sharp(src).composite([{ input: Buffer.from(svg.join('')), top: 0, left: 0 }]).png().toFile(out);
/* and a 3x crop of the crowd, which is the only region §12.7 scores */
await sharp(out).extract({ left: 700, top: 180, width: 420, height: 320 })
  .resize(420 * 3, 320 * 3, { kernel: 'nearest' }).png()
  .toFile(fileURLToPath(new URL('./_crit-reach-r2-annot-crop.png', import.meta.url)));
console.log('wrote annot + crop for', D.length, 'carets');
