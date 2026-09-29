/* ══════════════════════════════════════════════════════════════════════════
   CARD SHEET SHOT — the tabletop detail sheet, at full resolution.

   The Browser pane returns an 800×500 downscale, which is fine for "is the
   layout right" and useless for judging a frame whose whole point is machined
   1px edges and a segmented gauge. This boots real Chromium against the
   already-running preview and writes one PNG per fixture at device scale 2.

   Usage:  node .gauntlet/cardsheet-shot.mjs [outDir] [--w 1440] [--h 900]
   Requires the `public` preview server (port 8787) to be up.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const outDir = (args[0] && !args[0].startsWith('--')) ? args[0] : 'scratchpad-shots';
const W = parseInt(flag('w', '1440'), 10);
const H = parseInt(flag('h', '900'), 10);
const URL_ = flag('url', 'http://localhost:8787/src/cardsheet/preview.html');

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle' });

const out = [];
for (const fixture of ['unit', 'spell', 'field']) {
  await page.evaluate((k) => window.__ttsPick(k), fixture);
  /* 🔴 WAIT FOR THE PORTRAIT, not for a timer. The first pass at this shot
     switched fixture and captured in the same tick; both PNGs came back with an
     empty art plate and I nearly filed a layout bug against CSS that was
     correct. The image was simply still decoding. */
  await page.waitForFunction(() => {
    const i = document.querySelector('.tts-art');
    return !i || (i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().height > 40);
  }, null, { timeout: 8000 });
  await page.waitForTimeout(160);
  const file = path.join(outDir, 'cardsheet-' + fixture + '.png');
  await page.locator('.tts').screenshot({ path: file });
  const m = await page.evaluate(() => {
    const s = document.querySelector('.tts').getBoundingClientRect();
    const fills = [...document.querySelectorAll('.tts-fill')].map(f => Math.round(f.getBoundingClientRect().width));
    return { w: Math.round(s.width), h: Math.round(s.height), bars: fills.length, fills };
  });
  out.push({ fixture, file, ...m });
}

await browser.close();
console.log(JSON.stringify({ out, errors: errs }, null, 2));
