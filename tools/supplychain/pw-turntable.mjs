/* ═══════════════════════════════════════════════════════════════════════════
   🎠 pw-turntable — does the IDLE camera keep the owner's map on screen?

   WHY THIS EXISTS. Every other gate in this feature photographs t+0: the map
   is opened, paused and shot. The idle turntable starts 9 s later and then runs
   for as long as the player leaves the overlay open, and until this file was
   written nothing looked at it. It was broken the whole time. Measured on the
   build before the fix, in the real public/index.html at 1600x900, from an
   untouched home with zero input:

       t+0s   33 / 33 plates in frame
       t+31s  32
       t+60s  24   ← all four district labels gone, CITY BUILDER clipped
       t+120s 27
       t+180s 30

   — i.e. the overview spent most of its idle life not reading as the owner's
   PDF, and the districts had turned out of their left-to-right reading order.
   Reduced motion sets `still` and skips the spin, so the one mode anybody had
   inspected closely was the one mode that was correct.

   🔴 HOW IT LOOKS AT t+300s WITHOUT WAITING 300 s. The sway is a function of
   the CLOCK, not an accumulation of frames (scene.js, "THE IDLE TURNTABLE
   SWAYS"), so the camera at time t is fully determined by t. The suite pauses
   the RAF loop and calls renderNow(t0 + offset) — ONE frame, the real one. A
   suite that replayed 18,000 frames would take minutes and would be measuring
   its own frame cadence as much as the camera. This is also why the fix had to
   be phase-based: the 0.56 Hz Browser pane (CLAUDE.md) would otherwise show a
   different picture from a 60 Hz tab at the same wall-clock second.

   🔴 THE PIXEL A/B FOLLOWS THE REPO'S RULE. `preserveDrawingBuffer` is off, so
   the framebuffer is gone by the next task: the two frames are rendered AND
   drawImage'd inside ONE page.evaluate, never across two (CLAUDE.md,
   "Verifying", and .gauntlet/README.md item 6). Without that the comparison
   returns a confident zero and "the spin is gone" looks proven.

   READ-ONLY. It forces Profile.cloud.offlineMode and stubs the first-run gates
   so the hub renders (same bootstrap as pw-e2e.mjs), opens the overlay, reads
   projections and closes. It signs nothing in, writes no repo file other than
   the screenshots you ask for, and touches no database.

   USAGE
     node tools/supplychain/pw-turntable.mjs                 exit 1 on failure
     node tools/supplychain/pw-turntable.mjs --json          + the measurements
     node tools/supplychain/pw-turntable.mjs --shots <dir>   write the PNGs
     node tools/supplychain/pw-turntable.mjs --w 1600 --h 900
   ⚠ DESKTOP ONLY, AND THAT IS NOT A GAP. At a phone viewport (measured at
   390x844) the shell does not mount the 3D scene at all — it opens on the
   BUSINESSES list, state().view is null and there is no canvas — so there is no
   idle turntable there to test. Running this with --w 390 --h 844 times out
   waiting for a view, which is the honest answer rather than a fabricated pass.

   Cost: two Chromium pages in one launch (~40 s). Chromium and the server come
   from the repo (shoot.mjs); nothing is installed and no port is fixed.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);
const W = +val('w', 1600), H = +val('h', 900);

/* The five offsets the bar names, plus t+0 as the control. t+31s is kept from
   the original measurement because it is the moment the old spin first lost a
   plate — a regression would show there before it showed anywhere else.
   🔴 SEVEN SAMPLES, NOT ONE. A single late sample can be accidentally green:
   with the old unbounded spin deliberately restored, t+300s came back 33/33 and
   in perfect district order, because 1.2°/s had carried the camera almost
   exactly once round by then. The same run was 24/33 at t+60s. */
const TIMES = [0, 30000, 31000, 60000, 120000, 180000, 300000];
/* The owner's reading order, left to right across the screen (PDF pages 6-9). */
const DISTRICTS = ['sys:battle', 'sys:business', 'sys:city', 'sys:camp'];

/* ── bootstrap ──────────────────────────────────────────────────────────────
   index.html boots to 'authGate' and only reaches a hub through sign-in, and
   App / Profile / render are top-level LEXICAL consts — so this must be a
   CLASSIC init script; page.evaluate cannot see them (CLAUDE.md, the globals
   trap). Lifted from pw-e2e.mjs rather than imported: that file runs a whole
   suite on import, and a copy of a 40-line stub is cheaper than making it a
   library for one caller. Stubbing the first-run PREDICATES is honest — it
   changes which screen we land on, not how that screen is drawn. */
const BOOT = (hub) => `
(function () {
  var HUB = ${JSON.stringify(hub)};
  var S = window.__TT = { forced: 0, errors: [] };
  window.addEventListener('error', function (e) { try { S.errors.push(String((e && e.message) || e)); } catch (_) {} });
  function gates() {
    try {
      if (typeof Profile !== 'undefined' && Profile) {
        if (!Profile.onboarding) Profile.onboarding = {};
        Profile.onboarding.done = true; Profile.onboarding.skipped = true; Profile.onboarding.step = 'complete';
        if (Profile.cloud) Profile.cloud.offlineMode = true;
      }
      if (typeof Onboarding === 'object' && Onboarding) { Onboarding.step = null; Onboarding._forceNew = false; }
    } catch (_) {}
    var ST = { shouldRunOnboarding: false, _mustPickStarter: false, needsStarterPick: false,
               _isWipedNewPlayer: false, _maintenanceOn: false, hasPickedStarter: true };
    Object.keys(ST).forEach(function (k) {
      try {
        if (typeof window[k] === 'function' && !window[k].__tt) {
          var v = ST[k], f = function () { return v; }; f.__tt = true; window[k] = f;
        }
      } catch (_) {}
    });
    try { document.querySelectorAll('.onb-screen').forEach(function (n) { n.remove(); }); } catch (_) {}
    try { var b = document.getElementById('offline-warn-banner'); if (b) b.remove(); } catch (_) {}
    try { var s = document.getElementById('boot-splash'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (_) {}
  }
  function force() {
    try {
      if (typeof App === 'undefined' || typeof render !== 'function') return;
      gates();
      // never re-render the host under a live overlay: it looks exactly like
      // the overlay losing its page, and it is a real thing that happens.
      if (document.getElementById('sc-overlay')) return;
      App.screen = 'title'; App.titleHub = HUB;
      render(); gates();
      S.forced++; S.ready = true;
    } catch (e) { try { S.errors.push('force: ' + ((e && e.stack) || e)); } catch (_) {} }
  }
  [0, 60, 150, 300, 600, 900, 1400, 2000, 2600, 3200].forEach(function (t) { setTimeout(force, t); });
  setInterval(gates, 150);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', force);
  window.addEventListener('load', force);
})();
`;

/* ── the tiny assertion harness (same shape as pw-e2e, deliberately) ─────── */
const R = { pass: 0, fail: 0, rows: [], frames: [], shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};

/* Runs INSIDE the page. Renders exactly one frame at the given clock and reads
   back every plate's real screen rectangle — project() returns the rectangle
   with the declutter nudge and shrink already applied, which is the rectangle
   the player actually sees. Same task as the render, by construction. */
const MEASURE = (off) => {
  const v = window.__mg.supplyChain.view();
  const cv = document.querySelector('#sc-overlay canvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  v.renderNow(window.__tt0 + off);
  const ids = Array.from(v.layout.pos.keys());
  const out = { off, w, h, n: ids.length, inside: 0, outside: [], x: {} };
  for (const id of ids) {
    const p = v.project(id);
    if (!p) { out.outside.push({ id, why: 'no projection' }); continue; }
    out.x[id] = Math.round(p.x);
    const inFrame = p.depth < 1 && p.left >= 0 && p.right <= w && p.top >= 0 && p.bottom <= h;
    if (inFrame) out.inside++;
    else out.outside.push({ id, l: Math.round(p.left), r: Math.round(p.right), t: Math.round(p.top), b: Math.round(p.bottom), behind: p.depth >= 1 });
  }
  return out;
};

async function run(page, t, { reduced }) {
  await page.addInitScript(BOOT('exchange'));
  await t.goto('index.html');
  if (t.navStatus !== null && t.navStatus >= 400) throw new Error('index.html returned HTTP ' + t.navStatus);
  await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 60000 });
  // fire and forget: open() hands back the overlay's own state object, which is
  // full of DOM and three.js and cannot cross the evaluate boundary — returning
  // it made this call hang for the full timeout on a map that had opened fine.
  await page.evaluate(() => { window.__mg.supplyChain.open(); });
  await page.waitForFunction(() => !!window.__mg.supplyChain.view(), null, { timeout: 30000 });
  /* Let the overlay finish its own entrance and its first real declutter pass
     before freezing the clock — home() is re-solved on the first fit and this
     suite is about the camera afterwards, not about the mount race. */
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const v = window.__mg.supplyChain.view();
    v.pause();                                  // renderNow(t) is now the ONLY frame: one deterministic clock
    window.__tt0 = Date.now();
  });
  const frames = [];
  for (const off of TIMES) {
    const m = await page.evaluate(MEASURE, off);
    m.reduced = !!reduced;
    frames.push(m);
    if (SHOTS) {
      // re-render the same clock in the screenshot's own task: Playwright's
      // capture is a separate task and the RAF loop is paused, so without this
      // the PNG would be of whatever frame happened to be in the buffer.
      await page.evaluate(MEASURE, off);
      const f = path.join(SHOTS, (reduced ? 'reduced-' : '') + 't' + Math.round(off / 1000) + '.png');
      R.shots.push(await shot(page, f));
    }
  }
  return frames;
}

async function main() {
  console.log('\n  🎠 Supply Chain — the idle turntable, inside the real public/index.html\n');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  /* ── 1. normal motion ─────────────────────────────────────────────────── */
  const frames = await withPage(async (page, t) => {
    t.allowErrors = true;                       // the real page's own console noise is not this suite's verdict
    console.log('  ── 1. motion on (1600x900, zero input after the first frame)');
    const fr = await run(page, t, { reduced: false });
    for (const m of fr) {
      const label = 't+' + Math.round(m.off / 1000) + 's';
      ok(m.inside === m.n, `${label}: all ${m.n} plates project inside the canvas`,
        m.inside + '/' + m.n + (m.outside.length ? '  off: ' + m.outside.map((o) => o.id).join(',') : ''));
      const xs = DISTRICTS.map((d) => m.x[d]);
      const ordered = xs.every((x, i) => i === 0 || (typeof x === 'number' && typeof xs[i - 1] === 'number' && x > xs[i - 1]));
      ok(ordered, `${label}: the four districts are in the owner's left-to-right order`,
        DISTRICTS.map((d, i) => d + '@' + xs[i]).join(' < '));
    }
    /* The spin must still BE there. Rendered A/B, both renders and both
       drawImage calls in ONE task — the buffer is gone by the next one. */
    const ab = await page.evaluate(() => {
      const v = window.__mg.supplyChain.view();
      const gl = document.querySelector('#sc-overlay canvas');
      const w = 320, h = 180;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      v.renderNow(window.__tt0); ctx.drawImage(gl, 0, 0, w, h);
      const a = ctx.getImageData(0, 0, w, h).data;
      v.renderNow(window.__tt0 + 60000); ctx.drawImage(gl, 0, 0, w, h);
      const b = ctx.getImageData(0, 0, w, h).data;
      let diff = 0, lit = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] + a[i + 1] + a[i + 2] > 40) lit++;
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) diff++;
      }
      return { pct: Math.round(diff / (a.length / 4) * 1000) / 10, litPct: Math.round(lit / (a.length / 4) * 1000) / 10 };
    });
    ok(ab.litPct > 5, 'the A/B is of a drawn frame, not a black one (control)', ab.litPct + '% lit');
    ok(ab.pct > 0.5, 'the turntable is still visibly moving (t+0 vs t+60s differ)', ab.pct + '% of pixels');
    R.ab = ab;
    return fr;
  }, { w: W, h: H });

  /* ── 2. reduced motion ────────────────────────────────────────────────── */
  const rframes = await withPage(async (page, t) => {
    t.allowErrors = true;
    console.log('\n  ── 2. prefers-reduced-motion');
    const fr = await run(page, t, { reduced: true });
    const t0 = fr[0];
    ok(t0.inside === t0.n, `reduced t+0: all ${t0.n} plates inside`, t0.inside + '/' + t0.n);
    /* "Framed identically to t+0" is the bar's own wording: under reduced
       motion the camera must not move at all, so every plate's x is the SAME
       integer at every sampled time. Comparing rounded x is the strongest form
       of that claim this probe can make, and it is exact — the projection is
       deterministic, so a 1 px drift is a real camera move. */
    for (const m of fr.slice(1)) {
      const moved = Object.keys(t0.x).filter((id) => t0.x[id] !== m.x[id]);
      ok(moved.length === 0, `reduced t+${Math.round(m.off / 1000)}s: framed identically to t+0`,
        moved.length ? moved.length + ' plate(s) moved: ' + moved.slice(0, 5).join(',') : 'all ' + m.n + ' identical');
    }
    return fr;
  }, { w: W, h: H, reducedMotion: true });

  /* Reduced motion must be the SAME frame as motion-on's t+0, not a second,
     differently-fitted picture: the fix widened the home() fit to cover the
     whole sway band, and a version that applied that widening only when the
     spin runs would give reduced-motion players a different map. */
  const dx = Object.keys(frames[0].x).map((id) => Math.abs(frames[0].x[id] - (rframes[0].x[id] ?? 1e9)));
  ok(Math.max(...dx) <= 1, 'reduced motion and motion-on open on the SAME frame', 'max dx ' + Math.max(...dx) + ' px');

  R.frames = frames.concat(rframes);
  console.log(`\n  ${R.fail ? '❌' : '✅'}  ${R.pass} passed, ${R.fail} failed` + (SHOTS ? `   (${R.shots.length} shots in ${SHOTS})` : '') + '\n');
  if (flag('json')) console.log(JSON.stringify(R, null, 1));
  process.exit(R.fail ? 1 : 0);
}

main().catch((e) => { console.error('\n  ❌ pw-turntable threw:\n', (e && e.stack) || e, '\n'); process.exit(1); });
