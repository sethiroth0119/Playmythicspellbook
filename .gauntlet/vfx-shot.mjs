/* ══════════════════════════════════════════════════════════════════════════
   IMPACT VFX PROBE — plays effects through the game's REAL _playElementFx and
   measures the three things that have gone wrong with these overlays before:

   1. TRANSPARENCY. The owner has reported a white background over the board
      repeatedly. Painted over a known green, a pixel FAR from the effect must
      still be that green. The NEGATIVE CONTROL mounts the same page with a
      mismatched color-scheme on the frame element — the Chromium behaviour that
      paints an opaque backdrop — and must come back NOT green, or this check
      cannot see the bug it exists for.
   2. ANCHORING. The effect's contact point must land on the target point.
   3. CLEANUP. The overlay must remove itself (the page reports completion).

   Usage: node .gauntlet/vfx-shot.mjs <outDir>     (public server on :8787)
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'vfx-shots';
fs.mkdirSync(outDir, { recursive: true });
const W = 1440, H = 900, TARGET = { x: 900, y: 520 };
const GREEN = [30, 110, 60];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
await page.goto('http://localhost:8787/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => typeof window._playElementFx === 'function', null, { timeout: 30000 });
/* a flat green "board" and a marker on the target; the app underneath is hidden */
await page.addStyleTag({ content:
  'body > *:not(.element-fx-overlay):not(#mk){visibility:hidden!important}'
  + 'html,body{background:rgb(' + GREEN.join(',') + ')!important}'
  + '#mk{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid #ff0;z-index:1;pointer-events:none}' });
await page.evaluate((t) => { const m = document.createElement('div'); m.id = 'mk'; m.style.left = t.x + 'px'; m.style.top = t.y + 'px'; document.body.appendChild(m); }, TARGET);

const px = async (x, y) => {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  // decode the single PNG pixel in-page (no image dependency on the Node side)
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); return Array.from(g.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, buf.toString('base64'));
};
const isGreen = (p) => Math.abs(p[0] - GREEN[0]) < 6 && Math.abs(p[1] - GREEN[1]) < 6 && Math.abs(p[2] - GREEN[2]) < 6;
const FAR = [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20], [W / 2, 30]];

const overlays = () => page.evaluate(() => document.querySelectorAll('.element-fx-overlay').length);
const results = [];

/* ── negative control: mismatched color-scheme must NOT read green ─────────*/
await page.evaluate(() => {
  const w = document.createElement('div'); w.className = 'element-fx-overlay'; w.id = 'ctl';
  w.style.cssText = 'position:fixed;inset:0;z-index:1480;pointer-events:none';
  const f = document.createElement('iframe');
  f.src = 'assets/vfx/vfx-attacks?atk=4&x=0.625&y=0.578';
  f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:light';   // the effect pages embed DARK, so LIGHT is the mismatch
  w.appendChild(f); document.body.appendChild(w);
});
await page.waitForTimeout(1500);
const ctlFar = await Promise.all(FAR.map(([x, y]) => px(x, y)));
results.push({ case: 'CONTROL (scheme mismatch)', farGreen: ctlFar.filter(isGreen).length + '/' + FAR.length, sample: ctlFar[0] });
await page.evaluate(() => { const c = document.getElementById('ctl'); if (c) c.remove(); });

/* ── the real path, for a spread of effects ───────────────────────────────*/
const CASES = ['fxFire', 'fxLightning', 'atkBlizzard', 'atkCosmic', 'atkMeteor', 'atkPunch', 'atkStomp', 'atkMedusa'];
for (const id of CASES) {
  const t0 = Date.now();
  await page.evaluate(([id, t]) => window._playElementFx(id, t), [id, TARGET]);
  await page.waitForTimeout(id.startsWith('atk') ? 1900 : 1400);
  const far = await Promise.all(FAR.map(([x, y]) => px(x, y)));
  const shot = path.join(outDir, 'vfx-' + id + '.png');
  await page.screenshot({ path: shot, clip: { x: TARGET.x - 380, y: TARGET.y - 300, width: 760, height: 420 } });
  /* where did the canvas land, in page coordinates? */
  const geo = await page.evaluate(() => {
    const f = document.querySelector('.element-fx-overlay iframe'); if (!f) return null;
    const c = f.contentDocument && f.contentDocument.getElementById('vfx'); if (!c) return null;
    const r = c.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             op: getComputedStyle(f).opacity, overlayClass: f.contentDocument.documentElement.className };
  });
  let gone = null;
  for (let i = 0; i < 40; i++) { if ((await overlays()) === 0) { gone = Date.now() - t0; break; } await page.waitForTimeout(250); }
  results.push({ case: id, farGreen: far.filter(isGreen).length + '/' + FAR.length, geo, removedAfterMs: gone, shot });
}

await browser.close();
console.log(JSON.stringify({ target: TARGET, results, errors }, null, 1));
