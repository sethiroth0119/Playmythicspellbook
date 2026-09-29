// ============================================================================
// 🎨 generate-icons.mjs — produces square PWA icons from a portrait source.
// ----------------------------------------------------------------------------
// Reads ./source-icon.png (portrait 2:3-ish), crops a SQUARE region centered
// on the badge (vertically biased upward so the seal at the top stays in
// frame too), then writes:
//
//   public/assets/artwork/icon-192.png
//   public/assets/artwork/icon-256.png
//   public/assets/artwork/icon-384.png
//   public/assets/artwork/icon-512.png
//   public/assets/artwork/icon-1024.png
//   public/assets/artwork/icon-maskable-512.png   (with safe-zone padding)
//
// The maskable variant adds ~12.5% padding on each side so Android adaptive
// icons can apply their circular / squircle mask without clipping the badge.
//
// Usage: `node generate-icons.mjs`
// ============================================================================
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC  = path.join(__dirname, 'source-icon.png');
const OUT  = path.join(__dirname, 'public', 'assets', 'artwork');

// Sizes the manifest references (covers Windows / macOS / Android / iOS).
const SIZES = [192, 256, 384, 512, 1024];

async function main() {
  // Sanity check: source file present?
  try { await fs.access(SRC); }
  catch {
    console.error('❌ Could not find', SRC);
    console.error('   Save the attached icon PNG there and re-run.');
    process.exit(1);
  }

  await fs.mkdir(OUT, { recursive: true });

  const src = sharp(SRC);
  const meta = await src.metadata();
  console.log('📐 Source:', meta.width + '×' + meta.height);

  // Compute a SQUARE crop. The badge sits around the middle-lower 2/3 of the
  // portrait image; we anchor the square so the badge is comfortably centered
  // AND the upper "seal" circle stays in frame. Math:
  //   • crop side = min(w, h)  → biggest square that fits
  //   • offsetY: bias UPWARD by ~10% of the side so the seal isn't cropped
  const side = Math.min(meta.width, meta.height);
  const offsetX = Math.round((meta.width - side) / 2);
  // For a portrait source the badge area sits at ~y = h * 0.55. To bring the
  // square's center there, top-left y = (h*0.55) - side/2, clamped to [0, h-side].
  const targetCenterY = Math.round(meta.height * 0.55);
  let offsetY = Math.round(targetCenterY - side / 2);
  offsetY = Math.max(0, Math.min(meta.height - side, offsetY));
  console.log('✂  Square crop:', side + '×' + side, 'at offset', offsetX + ',' + offsetY);

  // Pull the square slice ONCE as a buffer so each resize uses identical pixels
  // (avoids re-cropping at different resolutions if metadata is weird).
  const squareBuf = await src
    .extract({ left: offsetX, top: offsetY, width: side, height: side })
    .png()
    .toBuffer();

  // Render every size.
  for (const sz of SIZES) {
    const outPath = path.join(OUT, `icon-${sz}.png`);
    await sharp(squareBuf)
      .resize(sz, sz, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(outPath);
    console.log(`✓ wrote ${path.relative(__dirname, outPath)} (${sz}×${sz})`);
  }

  // 🎭 Maskable icon — add a 12.5% padding ring so Android's adaptive icon
  // mask (circle / squircle / teardrop) doesn't clip the badge. The "safe
  // zone" spec says inner 80% must be safe; we pad 12.5% so 75% of the
  // image is guaranteed safe (extra margin for older launchers).
  const mSize = 512;
  const inner = Math.round(mSize * 0.75);   // 384px inner image
  const pad = Math.round((mSize - inner) / 2);
  const innerBuf = await sharp(squareBuf)
    .resize(inner, inner, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  // Background: pull the corner pixel from the source so the maskable matte
  // matches the icon's natural border (dark green/black for this art).
  const cornerPx = await sharp(squareBuf).extract({ left: 0, top: 0, width: 4, height: 4 }).resize(1, 1).raw().toBuffer();
  const [r, g, b] = [cornerPx[0], cornerPx[1], cornerPx[2]];
  await sharp({
    create: { width: mSize, height: mSize, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .composite([{ input: innerBuf, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'icon-maskable-512.png'));
  console.log(`✓ wrote assets/artwork/icon-maskable-512.png (512×512, safe-zone padded, matte rgb(${r},${g},${b}))`);

  // 🪧 Favicon — 32×32 from the same square crop.
  await sharp(squareBuf)
    .resize(32, 32, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'favicon-32.png'));
  console.log('✓ wrote assets/artwork/favicon-32.png (32×32)');

  console.log('\n✨ Done. Update manifest.json + index.html to reference the new icons.');
}

main().catch(err => { console.error('💥', err); process.exit(1); });
