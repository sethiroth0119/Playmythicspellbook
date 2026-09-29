/* crop the board out of a 1600x900 boardshot and upscale, so the markings can
   be inspected at the size a player actually sees them (the board fills the
   screen in game; the shot frames it small). */
import sharp from 'sharp';
const src = process.argv[2];
const out = process.argv[3];
const L = +(process.argv[4] || 380), T = +(process.argv[5] || 190);
const Wc = +(process.argv[6] || 920), Hc = +(process.argv[7] || 420);
await sharp(src).extract({ left:L, top:T, width:Wc, height:Hc }).resize({ width: Wc*2, kernel:'nearest' }).toFile(out);
console.log('wrote ' + out);
