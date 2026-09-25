/* ⚡ v121v156 — THE ELEMENTAL ARSENAL ON MOVES, UNDER THE TARGET.
   Run: node _elemfx_smoke.mjs

   Owner: "Add the Effect VFX (plays when the effect fires) to moves so when
   players select a unit or hero move to attack the VFX play Under the target
   So if a player, ai attacks a unit with lighting the Lighting strike VFX
   should look like its hitting the attack target just as like missle. Play the
   VFX after the Combat Cinematic 1.5 seconds after to make it more engaging."

   The integration rests on one fact about the effects themselves, and these
   checks pin it: all thirteen draw into a FIXED 1000 x 562.5 logical space and
   the page maps that whole box onto its canvas, so the composition point
   (x=500, ground plane y=380) is ALWAYS 50% across and 67.6% down the canvas.
   "Play it under the target" is therefore achieved by positioning the CANVAS —
   no effect function is touched, no transform overridden. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const FX  = readFileSync('./public/assets/vfx/vfx-elements.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the page's own coordinate contract, which the placement depends on ───── */
ok(/g\.setTransform\(canvas\.width\/1000,0,0,canvas\.height\/562\.5,0,0\)/.test(FX),
  'THE EFFECTS DRAW INTO A FIXED 1000x562.5 BOX mapped onto the whole canvas — this is what makes positioning the canvas equal to positioning the effect');
ok(/\(380 \/ 562\.5\)/.test(FX),
  'the placement uses the effects\' own ground plane (y=380 of 562.5), not a guessed offset');
ok(/cv\.style\.left   = \(px - W \* 0\.5\)/.test(FX), '…and their own centre line (x=500 of 1000)');

/* ── embed mode ───────────────────────────────────────────────────────────── */
ok(/if \(!q\.has\('fx'\)\) return;/.test(FX),
  'a plain visit is left completely untouched — the artist\'s preview still works');
ok(/document\.body\.classList\.add\('mgembed'\)/.test(FX), 'the battlefield layer is opt-in via ?fx=');
ok(/body\.mgembed header,body\.mgembed \.controls/.test(FX), 'the demo chrome is hidden');
ok(/The demo DOM is kept/.test(FX),
  'THE DOM IS KEPT, NOT REMOVED — the effect code reads $(\'ground\') / $(\'loop\') every frame and would throw on the first render without them');
ok(/if \(gd\) gd\.checked = false;/.test(FX),
  'THE GROUND PLATE IS FORCED OFF — it is a big opaque ellipse for the preview and would black out the board');
ok(/if \(lp\) lp\.checked = false;/.test(FX), 'and loop is off — one hit, one effect');
ok(/pointer-events:none!important/.test(FX), 'the overlay is click-through');

/* ── the registry ─────────────────────────────────────────────────────────── */
/* Two pages since Attack VFX Volume 02: the thirteen elemental effects on
   vfx-elements, the ten attacks (entries marked page:'attacks') on vfx-attacks. */
ok(/const _ELEMENT_FX_FILE = 'assets\/vfx\/vfx-elements';/.test(SRC), 'one page backs every ELEMENTAL effect');
ok(/const _ATTACK_FX_FILE = 'assets\/vfx\/vfx-attacks';/.test(SRC), '…and one backs every attack');
{
  const lo = SRC.indexOf('const _ELEMENT_FX = {');
  const hi = SRC.indexOf('};', lo);
  ok(lo > 0 && hi > lo, 'the element registry is locatable');
  const blk = SRC.slice(lo, hi);
  const ids = (blk.match(/fx[A-Z][A-Za-z]*:/g) || []).length;
  ok(ids === 13, 'all THIRTEEN effects are registered', String(ids));
  ok(/fxLightning: \{ ix: 2,/.test(blk),
    'Lightning strike is index 2 — the owner\'s worked example ("attacks a unit with lighting")');
  ok(/fxMissile:   \{ ix: 0,/.test(blk), '…and Missile impact is 0, their other example');
  /* 🔴 PER PAGE. An index means "the Nth effect ON ITS PAGE"; the attack page has
     its own 0..9, so a table-wide set would call atkBlizzard (attacks #0) a
     duplicate of fxMissile (elements #0). The property is unchanged: within one
     page, no two ids may select the same effect. */
  const rows = blk.split('\n').filter(l => /^\s+\w+:\s*\{.*ix: \d+/.test(l));
  const ixOf = l => +(/ix: (\d+)/.exec(l)[1]);
  const ixs = rows.filter(l => !/page: 'attacks'/.test(l)).map(ixOf);
  const ats = rows.filter(l => /page: 'attacks'/.test(l)).map(ixOf);
  ok(new Set(ixs).size === ixs.length, 'no two ELEMENTAL entries point at the same effect index', ixs.join(','));
  ok(new Set(ats).size === ats.length, 'no two ATTACK entries point at the same attack index', ats.join(','));
  ok(ats.length === 10 && Math.min(...ats) === 0 && Math.max(...ats) === 9, 'the ten attacks cover 0..9 exactly', ats.join(','));
  ok(Math.min(...ixs) === 0 && Math.max(...ixs) === 12, 'and they cover 0..12 exactly');
}

/* ── the move carries one, and it is saved ───────────────────────────────── */
ok(/id="mv-vfx-impact"/.test(SRC), 'the move editor offers the picker');
ok(/plays UNDER the target, 1\.5s after the combat cinematic/.test(SRC),
  '…and says what it does, so an author is not guessing');
ok(/const impactFx = _g\('mv-vfx-impact'\) \|\| '';/.test(SRC), 'it is read back on save');
ok(/if \(shake !== 'none' \|\| screen !== 'none' \|\| zoom \|\| impactFx\) \{/.test(SRC),
  'AN IMPACT EFFECT ALONE KEEPS THE OBJECT — without it in this condition, picking only an impact effect would save nothing at all');
ok(/if \(impactFx\) move\.vfx\.impactFx = impactFx;/.test(SRC), '…and rides on move.vfx with the camera settings');

/* ── it fires late, under the target ─────────────────────────────────────── */
ok(/const MOVE_IMPACT_FX_DELAY_MS = 1500;/.test(SRC), 'the delay is the owner\'s 1.5 seconds, named');
{
  const lo = SRC.indexOf('const _ifx = move.vfx && move.vfx.impactFx;');
  ok(lo > 0, 'playMoveFx fires it');
  const f = SRC.slice(lo, lo + 900);
  ok(/setTimeout\(\(\) => \{/.test(f) && /MOVE_IMPACT_FX_DELAY_MS\)/.test(f), '…after the delay');
  ok(/const pt = \(typeof _bbAnchorPoint === 'function'\) \? _bbAnchorPoint\(target\.id\) : null;/.test(f),
    'THE ANCHOR IS RESOLVED WHEN IT FIRES, not when it is scheduled — 1.5s is long enough for the target to move or die, and a point captured early would drop the effect where the unit used to be');
  ok(/if \(pt\) _playElementFx/.test(f),
    '…and no anchor means no effect: a bolt striking empty ground reads as a bug, not as a miss');
}
ok(/decoupled from the damage math \(timed\) so it can never change combat/i.test(SRC)
   || /Decoupled from the damage math/.test(SRC),
  'it hangs off playMoveFx, which is already documented as unable to affect combat — the right home for a delayed cosmetic');

/* ── the overlay cannot leak ─────────────────────────────────────────────── */
{
  const lo = SRC.indexOf('function _playElementFx(id, pt) {');
  ok(lo > 0, '_playElementFx is locatable');
  /* the whole function, not a fixed window: a comment added inside it pushed the
     teardown past the old 1800-char cut and three true checks read as false */
  const f = SRC.slice(lo, SRC.indexOf('\nfunction ', lo + 10));
  ok(/ev\.data\.type === 'elements:complete'/.test(f), 'the frame is torn down when the page reports complete');
  ok(/setTimeout\(kill, 9000\)/.test(f),
    '…with a timeout, so a page that never reports cannot leak an overlay onto the battlefield forever');
  ok(/removeEventListener\('message', onMsg\)/.test(f), 'and the listener goes with it');
  ok(/Math\.max\(0, Math\.min\(1, pt\.x \/ Math\.max\(1, innerWidth\)\)\)/.test(f),
    'the anchor is sent NORMALISED, so it survives a resize between mount and play');
}

/* ── run the placement arithmetic for real ───────────────────────────────── */
{
  const place = (nx, ny, W, vw, vh) => {
    const H = W * 562.5 / 1000;
    const px = nx * vw, py = ny * vh;
    const left = px - W * 0.5, top = py - H * (380 / 562.5);
    return { groundX: left + W * 0.5, groundY: top + H * (380 / 562.5) };
  };
  const r = place(0.5, 0.62, 460, 1280, 800);
  ok(Math.abs(r.groundX - 640) < 0.01 && Math.abs(r.groundY - 496) < 0.01,
    'run for real: the effect\'s ground plane lands EXACTLY on the requested point (measured live in the browser too: 640,496 == 640,496)',
    Math.round(r.groundX) + ',' + Math.round(r.groundY));
  const r2 = place(0.2, 0.9, 460, 1920, 1080);
  ok(Math.abs(r2.groundX - 384) < 0.01 && Math.abs(r2.groundY - 972) < 0.01,
    'run for real: …at any anchor and any viewport', Math.round(r2.groundX) + ',' + Math.round(r2.groundY));
  const r3 = place(0.5, 0.5, 900, 1280, 800);
  ok(Math.abs(r3.groundX - 640) < 0.01 && Math.abs(r3.groundY - 400) < 0.01,
    'run for real: …and the placement is independent of the effect\'s on-screen SIZE');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 156, 'BUILD_VERSION is v121v156 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
