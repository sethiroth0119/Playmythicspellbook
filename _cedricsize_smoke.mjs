/* 🧍 v121v154 — CEDRIC: WHOLE BODY, ABOVE THE TEXT BOX. Run: node _cedricsize_smoke.mjs

   Owner: "Make him much bigger" (v153), then "Move him up towards the middle
   over the text box I want to see his whole body" (v154 — this file).

   The interesting part is not the numbers, it is that `object-fit: contain`
   binds on whichever cap is TIGHTER — so the height box and the image's bottom
   offset are one decision written twice, and a narrow screen needs both halves
   overridden or it gets the worse half of the pair. That is what these checks
   protect, and it is the bug this release shipped and then fixed after looking
   at a phone. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const MM  = readFileSync('./public/main-menu/index.html', 'utf8').replace(/\r\n/g, '\n');
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the asset grew FIRST, so bigger does not mean blurrier ───────────────── */
{
  const buf = readFileSync('./public/assets/artwork/ui/cedric-idle.webp');
  ok(buf.length > 1000000 && buf.length < 6000000,
    'the loop is still under the 6.0MB the whole-body loop used to cost',
    (buf.length / 1048576).toFixed(2) + 'MB');
  /* WebP VP8X canvas size: bytes 24..29 of the RIFF are width-1 / height-1, 24-bit LE */
  const s = buf.toString('latin1');
  const i = s.indexOf('VP8X');
  ok(i > 0, 'the file is an extended (animated) WebP');
  if (i > 0) {
    const w = 1 + (buf[i + 12] | (buf[i + 13] << 8) | (buf[i + 14] << 16));
    const h = 1 + (buf[i + 15] | (buf[i + 16] << 8) | (buf[i + 17] << 16));
    ok(w === 768 && h === 1152,
      'THE LOOP IS AT THE SOURCE\'S NATIVE 768x1152 — the box was grown, so leaving the asset at 640 would have made him bigger AND softer, which is not what bigger means',
      w + 'x' + h);
  }
  const still = readFileSync('./public/assets/artwork/ui/cedric-still.webp');
  ok(still.length > 20000 && still.length < 900000, 'the still is still cheap', (still.length / 1024).toFixed(0) + 'KB');
}

/* ── the box, and the pair that puts him WHOLLY above the banner ──────────── */
/* ⚠ v121v154 — these assertions were INVERTED from v153, on the owner's call:
   "I want to see his whole body." v153 pinned the opposite rule (overflow the
   viewport, spend the boots). The new rule is strictly HARDER to satisfy: it
   has to hold against a measured obstacle — the banner at 85.6vh — rather than
   just against the viewport edge. */
const BANNER_TOP_VH = 85.6;   // measured in the browser at 1440x900
{
  const m = MM.match(/\.char-stage\{\s*\n\s*position:fixed[^}]*?width:min\((\d+)vw, (\d+)px\); height:(\d+)vh;/);
  ok(!!m, 'the char-stage box is readable from the CSS');
  if (m) {
    const [, vw, px, vh] = m.map(Number);
    const off = Number((MM.match(/\.char-img\{[^}]*?bottom:(-?\d+)vh;/s) || [])[1]);
    ok(off > 0, 'THE OFFSET IS POSITIVE — v153 pushed him DOWN to crop the boots; this LIFTS him so they clear the text box', off + 'vh');
    const bootsAt = 100 - off;              // vh from the top of the viewport
    const headAt  = bootsAt - vh;
    ok(headAt >= 0, 'his HEAD is on screen', headAt.toFixed(1) + 'vh from the top');
    ok(bootsAt <= 100, '…and so are his BOOTS — the whole body is visible, which is the ask', bootsAt.toFixed(1) + 'vh');
    ok(bootsAt <= BANNER_TOP_VH,
      'HE CLEARS THE TEXT BOX — the banner starts at 85.6vh (measured in the browser, not guessed) and his feet land above it',
      bootsAt.toFixed(1) + 'vh vs ' + BANNER_TOP_VH + 'vh');
    ok(headAt <= 6,
      '…while still using the band: he fills the space between the top of the screen and the banner rather than floating in the middle of it',
      headAt.toFixed(1) + 'vh');
    ok(vw >= 80 && px >= 1300,
      'the width cap stays wide, so a short wide window does not become the binding cap instead', vw + 'vw / ' + px + 'px');
  }
}
ok(/There is no more size to find here/.test(MM),
  'WHY THIS IS NOT ALSO "MUCH BIGGER" is written down — whole-body and bigger genuinely pull against each other once the band is fixed');
ok(/99\.2% figure/.test(MM),
  '…including the measurement that closes off the obvious workaround: the source is 99.2% figure, so there is no transparent margin to trim');

/* ── the narrow screens get BOTH halves overridden ────────────────────────── */
{
  const lo = MM.indexOf('@media (max-width: 900px)');
  const hi = MM.indexOf('@media', lo + 10);
  ok(lo > 0, 'the narrow breakpoint is locatable');
  const blk = MM.slice(lo, hi > lo ? hi : lo + 2500);
  ok(/\.char-stage\{ width:88vw; height:86vh;/.test(blk),
    'a narrow screen gets the wider box without the desktop height');
  const _noff = Number((blk.match(/\.char-img\{ bottom:(-?\d+)vh; \}/) || [])[1]);
  ok(_noff > 0,
    'AND IT LIFTS HIM TOO — he is WIDTH-bound on a phone, so the height cap does not position him; the offset does, and it has to clear a banner that sits lower there',
    _noff + 'vh');
}

/* ── run the fit rule for real ────────────────────────────────────────────── */
{
  const ART_W = 768, ART_H = 1152;
  const fit = (vw, vh, capVw, capPx, capVh) => {
    const boxW = Math.min(vw * capVw / 100, capPx), boxH = vh * capVh / 100;
    const k = Math.min(boxW / ART_W, boxH / ART_H);
    return { h: ART_H * k, boundBy: (boxW / ART_W < boxH / ART_H) ? 'width' : 'height' };
  };
  const newD = fit(1920, 1080, 86, 1420, 83);
  ok(newD.boundBy === 'height',
    'run for real: on a desktop the HEIGHT is the binding cap — which is WHY a whole-body figure cannot be made bigger by widening the box');
  ok(newD.h <= 1080, 'run for real: the whole figure fits on screen');
  /* the real geometry: feet at (100 - offset)vh, head that much minus the box
     height. Both must land inside the band, and the feet above the banner. */
  {
    const H = 83, OFF = 16;
    const feet = 100 - OFF, head = feet - H;
    ok(head >= 0 && feet <= BANNER_TOP_VH,
      'run for real: head at ' + head + 'vh and feet at ' + feet + 'vh — inside the screen AND above the banner at ' + BANNER_TOP_VH + 'vh');
    ok(BANNER_TOP_VH - feet < 3,
      'run for real: …and the gap to the banner is small, so the band is used rather than left empty',
      (BANNER_TOP_VH - feet).toFixed(1) + 'vh');
  }

  const phone = fit(375, 812, 88, 1420, 86);
  ok(phone.boundBy === 'width',
    'run for real: ON A PHONE THE WIDTH BINDS — which is why the offset, not the height cap, is what positions him there');
  const oldP = fit(375, 812, 64, 1420, 86);
  ok(phone.h > oldP.h, 'run for real: he is still bigger on a phone than the pre-v153 rules', '+' + Math.round((phone.h / oldP.h - 1) * 100) + '%');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 154, 'BUILD_VERSION is v121v154 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
