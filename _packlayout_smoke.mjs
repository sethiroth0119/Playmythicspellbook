/* 🎴 bug-mu0pk7ah — "The screen for opening card packs is very off. The card
   images are huge and off centre, located down to the bottom right … They
   should be much smaller so the average pack of 7-8 fits on screen, centred in
   the middle for the animation, then shown slightly below centre in an arc."

   Two causes, both in public/pack-opener/index.html:
     A. `#stage{position:fixed;inset:0}` with no width/height. A <canvas> is a
        replaced element, so inset does not stretch it; it kept its intrinsic
        size, which renderer.setSize(w,h,false) makes w×devicePixelRatio. Any
        DPR > 1 (125% Windows scaling, every phone) drew the scene 1.25–3× too
        big pinned top-left — centre in the bottom-right. Measured in the
        browser pane at 1366×768, DPR 1.5, 8 cards: canvas 2049×1152 CSS px,
        spread x 286→1775, centre (1031,678). After: canvas 1366×768, spread
        190→1183, centre (687,452).
     B. A fixed camera distance, so 8 cards (~9 world units) ran off a phone.

   Pinned here against the REAL slotFor/fitCamera lifted from the file, with a
   perspective projection done by hand (camera on +z looking at the origin):
     1. the canvas CSS box is the viewport (width/height 100%)
     2. 7 and 8 cards fit inside the viewport, horizontally centred, the arc's
        centre below the middle — at 1366×768, 1536×864, 1920×1080, 375×812,
        412×915 and 768×1024
     3. a big monitor keeps the old framing (camera never closer than 9.2)
     4. NEGATIVE CONTROL: the old one-row slotFor at the old fixed z=9.2 does
        NOT fit 8 cards on a 375×812 phone — so check 2 measures something.

   Run: node _packlayout_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

const SRC = readFileSync('./public/pack-opener/index.html', 'utf8');

console.log('\n=== 1. the canvas box is the viewport ===');
{
  const m = SRC.match(/#stage\{([^}]*)\}/);
  ok(!!m && /width:100%/.test(m[1]) && /height:100%/.test(m[1]), '#stage has width:100%;height:100%', m && m[1]);
}

function grab(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j + 3);
}
const consts = SRC.match(/const PACK_H=[^\n]*\n/)[0] + SRC.match(/const CARD_H=[^\n]*\n/)[0] + SRC.match(/const CAM_Z_MIN = [^\n]*\n/)[0];
const code = consts + grab('spreadRows') + grab('slotFor') + grab('fitCamera');

function build(n, aspect, oldCode) {
  const camera = { fov: 42, aspect, position: { z: 9.2 } };
  const body = oldCode || code;
  const f = new Function('camera', 'CARDS_PER_PACK', body + '\n;return { slotFor, fit: typeof fitCamera === "function" ? fitCamera : null, CARD_W, CARD_H };');
  const L = f(camera, n);
  if (L.fit) L.fit();
  return { camera, L };
}
function measure(n, W, H, oldCode) {
  const { camera, L } = build(n, W / H, oldCode);
  const D = camera.position.z, t = Math.tan(21 * Math.PI / 180), a = W / H;
  const px = (x, z) => (x / ((D - z) * t * a) + 1) / 2 * W;
  const py = (y, z) => (1 - y / ((D - z) * t)) / 2 * H;
  let l = Infinity, r = -Infinity, top = Infinity, b = -Infinity, cardW = 0;
  for (let i = 0; i < n; i++) {
    const s = L.slotFor(i);
    const x0 = px(s.x - L.CARD_W / 2, s.z), x1 = px(s.x + L.CARD_W / 2, s.z);
    const y0 = py(s.y + L.CARD_H / 2, s.z), y1 = py(s.y - L.CARD_H / 2, s.z);
    l = Math.min(l, x0); r = Math.max(r, x1); top = Math.min(top, y0); b = Math.max(b, y1);
    cardW = x1 - x0;
  }
  return { D, l, r, top, b, cardW, cx: (l + r) / 2, cy: (top + b) / 2, fits: l >= 0 && r <= W && top >= 0 && b <= H };
}

console.log('\n=== 2. 7–8 cards fit, centred, arc below the middle ===');
for (const [W, H] of [[1366, 768], [1536, 864], [1920, 1080], [375, 812], [412, 915], [768, 1024]]) {
  for (const n of [7, 8]) {
    const m = measure(n, W, H);
    ok(m.fits && Math.abs(m.cx - W / 2) <= W * 0.03 && m.cy > H / 2 && m.cy < H * 0.72,
      `${W}×${H}, ${n} cards: x ${m.l | 0}→${m.r | 0}, y ${m.top | 0}→${m.b | 0}, card ${m.cardW | 0}px, camera z ${m.D.toFixed(1)}`,
      JSON.stringify(m));
  }
}

console.log('\n=== 3. a big monitor keeps the old framing ===');
{ const m = measure(8, 1920, 1080); ok(Math.abs(m.D - 9.2) < 1e-9, 'camera stays at 9.2 at 1920×1080', m.D); }

console.log('\n=== 4. NEGATIVE CONTROL: the old layout on a phone ===');
{
  const oldSlot = `function slotFor(i){
  const c=(CARDS_PER_PACK-1)/2, d=i-c;
  return { x: d*(CARD_W*0.72), y: -0.35 - Math.abs(d)*0.13, z: 0.02*i, rz: -d*0.055 };
}`;
  const oldCode = SRC.match(/const PACK_H=[^\n]*\n/)[0] + SRC.match(/const CARD_H=[^\n]*\n/)[0] + oldSlot;
  const m = measure(8, 375, 812, oldCode);
  ok(!m.fits, 'old one-row arc at z=9.2 runs off a 375px phone (x ' + (m.l | 0) + '→' + (m.r | 0) + ')');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
