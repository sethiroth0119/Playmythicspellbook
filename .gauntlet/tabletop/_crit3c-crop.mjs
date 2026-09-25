import sharp from 'sharp';
const [f, out, x, y, w, h, s, br] = process.argv.slice(2);
let p = sharp(f).extract({ left: +x, top: +y, width: +w, height: +h }).resize(+w * (+s || 1), +h * (+s || 1), { kernel: 'nearest' });
if (br && +br !== 1) p = p.linear(+br, 0);
await p.png().toFile(out);
console.log('wrote', out);
