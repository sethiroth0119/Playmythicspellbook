import sharp from 'sharp';
const [, , src, out, x, y, w, h] = process.argv;
await sharp(src).extract({ left: +x, top: +y, width: +w, height: +h }).toFile(out);
console.log('ok', out);
