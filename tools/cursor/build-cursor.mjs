/* ═══════════════════════════════════════════════════════════════════════════
   🗡 THE ABRA BLADE CURSOR

   The owner asked for the Abra Blade as the game's pointer: small, and with the
   blade pointing at whatever it is about to click. A CSS cursor is an image
   plus a HOTSPOT — the pixel inside that image which IS the click point — so
   "pointing at what it clicks" is exactly: rotate the blade so its tip leads,
   then put the hotspot on the tip, to the pixel.

   This does not eyeball either step. It trims the art to its own alpha, rotates
   it, then SCANS the result for the first opaque pixel along the leading
   diagonal and writes that coordinate out. If the art is ever replaced, re-run
   it and the hotspot follows the new blade.

   Run:  node tools/cursor/build-cursor.mjs
   Out:  public/assets/cursors/abra-blade.png        (the pointer, 40px)
         public/assets/cursors/abra-blade-lg.png     (56px, for the touch/zoom setting)
         public/assets/cursors/abra-blade.json       (the measured hotspots)

   ⚠ Browsers cap a CSS cursor at 128×128 and will silently fall back to the
     system arrow above it — which is why these are small by design, not by
     taste. Firefox additionally ignores a hotspot outside the image box.
   ═══════════════════════════════════════════════════════════════════════════ */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/* The blade, cut out of its starfield by tools/cursor/cut-blade.mjs. The card
   art next door is the framed CARD - rotating that gives you a spinning card,
   not a sword. */
const SRC = 'public/assets/cursors/abra-blade-source.png';
const OUT_DIR = join('public', 'assets', 'cursors');
/* -45° puts a blade drawn point-up into the classic pointer attitude: tip at
   the top-left, hilt trailing to the bottom-right, out of the way of what you
   are reading. */
const ANGLE = -45;
/* 🗡 v121v130 — the owner asked for a SMALLER blade: 40 → 26, and the glow
   variant with it. The hotspot is re-measured on each rendered size rather
   than scaled, so the tip still lands on the pixel the blade points with. */
const SIZES = [{ name: 'abra-blade.png', px: 26 }, { name: 'abra-blade-lg.png', px: 40 }, { name: 'abra-blade-glow.png', px: 26, glow: true }];

/* ✨ THE HOVER BLADE. Over anything clickable the pointer should say so, and a
   40px sword cannot say it by changing shape - so it says it with light: the
   same blade over a blurred, purple-tinted copy of its own silhouette, with
   the steel itself lifted. Built from the art, not drawn by hand, so it stays
   the same sword. */
async function glowify(src) {
  const base = await sharp(src).trim({ threshold: 10 }).toBuffer();
  const { width, height } = await sharp(base).metadata();
  const pad = Math.round(Math.max(width, height) * 0.10);
  const aura = await sharp(base)
    .ensureAlpha()
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ brightness: 1.25, saturation: 2.2 })
    .tint({ r: 168, g: 96, b: 255 })
    .blur(Math.max(2, Math.round(Math.min(width, height) * 0.05)))
    .toBuffer();
  const lit = await sharp(base).modulate({ brightness: 1.22, saturation: 1.35 }).toBuffer();
  return sharp(aura).composite([{ input: lit, top: pad, left: pad }]).png().toBuffer();
}

/* The tip = the opaque pixel nearest the top-left corner, measured by
   (x + y) so it is the true leading point of a diagonal blade rather than the
   topmost pixel of a wide glow. Alpha over 96 ignores the soft aura, which is
   nearly transparent and would otherwise drag the hotspot off the steel. */
function findTip(data, w, h, channels) {
  let best = null, bestScore = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * channels + (channels - 1)];
      if (a < 96) continue;
      const score = x + y;
      if (score < bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best || { x: 0, y: 0 };
}

const out = { source: SRC, angle: ANGLE, sizes: {} };
mkdirSync(OUT_DIR, { recursive: true });

for (const s of SIZES) {
  const _src = s.glow ? await glowify(SRC) : SRC;
  const buf = await sharp(_src)
    .trim({ threshold: 10 })                       // drop the empty margin the art ships with
    .rotate(ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ height: s.px, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const tip = findTip(data, info.width, info.height, info.channels);
  writeFileSync(join(OUT_DIR, s.name), buf);
  out.sizes[s.name] = { w: info.width, h: info.height, hotspot: tip, bytes: buf.length };
  console.log('  ' + s.name.padEnd(20) + info.width + '×' + info.height
    + '   hotspot ' + tip.x + ',' + tip.y + '   ' + (buf.length / 1024).toFixed(1) + ' KB');
}

writeFileSync(join(OUT_DIR, 'abra-blade.json'), JSON.stringify(out, null, 1));
console.log('wrote ' + OUT_DIR);
