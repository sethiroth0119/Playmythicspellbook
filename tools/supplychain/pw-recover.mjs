/* ═══════════════════════════════════════════════════════════════════════════
   ↩ pw-recover — CAN THE PLAYER GET THE MAP BACK?

   WHY THIS SUITE EXISTS, SEPARATELY FROM pw-e2e. Every other gate in this
   feature asks "is the right thing on screen". This one asks the question that
   only shows up one interaction later: after the player has DONE something, is
   the thing they came for still reachable. Two measured answers said no.

     1. One click on a tile flies scene.js's focus() into a close-up. Measured
        on the real page: 33 of 33 plates in frame at home, 6 of 33 after
        picking Weapon Smith, still 6 of 33 after the card was dismissed — on
        an empty floor with no district labels. render.js's onClose was an
        explicit no-op and there was no reset control in the chrome at all;
        Escape closed the whole overlay instead.
     2. The 3D map was raced against a 2200 ms deadline and DISPOSED if it
        arrived late, so 4 of 8 cold opens of the real 11.6 MB index.html came
        up as the 2D list — and the footer then told a player with a perfectly
        good GPU that they had no WebGL, which is both false and the one
        sentence guaranteed to stop them looking for a way back.

   So every assertion below is about a SECOND state: after a real mouse click,
   after a real Escape, after a page load that lost a race. Nothing here calls
   home(), select() or clicks a tab to "help" — a test that recovers the view
   by calling the recovery API cannot see the bug it is here to catch.

   🔴 WHY THE REAL index.html AND NOT A HARNESS. Both failures are timing and
   layout against the 11.6 MB page: the deadline is missed BECAUSE of the real
   page's boot cost, and the close-up framing is measured against the real
   overlay's stage rect. tools/supplychain/harness-shell.html misses both.

   READ-ONLY. It stubs the first-run gates and forces a hub render (the same
   bootstrap pw-e2e uses), then drives the overlay with the mouse and the
   keyboard. It signs nothing in, buys nothing, writes nothing to the repo
   outside --shots, and touches no database.

   USAGE
     node tools/supplychain/pw-recover.mjs                 exit 1 on any failure
     node tools/supplychain/pw-recover.mjs --json          + the full report
     node tools/supplychain/pw-recover.mjs --shots <dir>   write the screenshots
     node tools/supplychain/pw-recover.mjs --colds 8       how many cold opens
   Cost: one Chromium launch, 2 viewports + N cold pages (~3 min at N=8).
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { withPage, shot } from './shoot.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes('--' + n);
const val = (n, d) => { const i = ARGV.indexOf('--' + n); return (i >= 0 && ARGV[i + 1]) ? ARGV[i + 1] : d; };
const SHOTS = val('shots', null);
const COLDS = Math.max(1, parseInt(val('colds', '8'), 10) || 8);

/* ── the bootstrap ──────────────────────────────────────────────────────────
   Lifted from pw-e2e.mjs deliberately, not imported: that file does not export
   it, and the two suites must be able to drift apart without one silently
   changing the other's starting state. index.html boots into 'authGate' and
   App / Profile / render are top-level lexical consts, so this has to be a
   CLASSIC init script — an evaluate() is module scope and cannot see them. */
const BOOT = `
(function () {
  var S = window.__RCV = { forced: 0, errors: [] };
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
        if (typeof window[k] === 'function' && !window[k].__rcv) {
          var v = ST[k], f = function () { return v; }; f.__rcv = true; window[k] = f;
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
      if (document.getElementById('sc-overlay')) return;   // never re-render under the overlay
      App.screen = 'title'; App.titleHub = 'exchange';
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

/* ── assertions ─────────────────────────────────────────────────────────── */
const R = { pass: 0, fail: 0, rows: [], notes: {}, shots: [] };
const ok = (cond, what, detail) => {
  const good = !!cond;
  R[good ? 'pass' : 'fail']++;
  R.rows.push({ ok: good, what, detail: detail === undefined ? '' : String(detail) });
  console.log(`  ${good ? 'OK  ' : 'FAIL'} ${what}${detail === undefined || detail === '' ? '' : '   ' + detail}`);
  return good;
};
const note = (k, v) => { R.notes[k] = v; };
const MINE = /supplychain|SupplyChainBridge|MythicSupplyChain|sc-overlay|openSupplyChain/i;

/* One deterministic frame. pause() + renderNow() in the same task is the rule
   from CLAUDE.md "Verifying"; resumed at once, because a paused scene stops
   answering camera moves and the next step would photograph a stale frame. */
const png = async (page, name) => {
  if (!SHOTS) return null;
  await page.evaluate(() => {
    try { const v = window.__mg.supplyChain.view(); if (v && v.pause) { v.pause(); v.renderNow && v.renderNow(); } } catch (e) {}
  });
  const abs = await shot(page, path.join(SHOTS, name + '.png'));
  await page.evaluate(() => { try { const v = window.__mg.supplyChain.view(); if (v && v.resume) v.resume(); } catch (e) {} });
  R.shots.push(abs);
  return abs;
};

/* ── what the suite reads inside the page ───────────────────────────────── */

/* 🔴 THE ONE MEASUREMENT THIS SUITE IS BUILT AROUND: how much of the economy
   is on screen. project() answers in the canvas's own LAYOUT pixels, which is
   the same space clientWidth/clientHeight are in, so the containment test is
   done entirely in that space and never touches client pixels (that conversion
   is only needed for the mouse — see aimAt). A plate is counted `inside` only
   when the WHOLE plate is within the canvas; `centred` (its anchor point
   inside) is reported alongside, because a half-clipped plate at the rim is a
   different complaint from a plate behind the camera and the two must not be
   confused when a number moves. */
function readPlates() {
  const api = window.__mg && window.__mg.supplyChain;
  const v = api && api.view();
  const g = window.MythicSupplyChain && window.MythicSupplyChain.graph;
  const cv = document.querySelector('#sc-overlay canvas');
  if (!api || !v || !g || typeof v.project !== 'function') return { kind: '2d-or-none', total: (g && g.nodes || []).length, inside: 0, centred: 0, off: [] };
  if (!cv) return { kind: 'no-canvas', total: g.nodes.length, inside: 0, centred: 0, off: [] };
  try { if (v.renderNow) v.renderNow(); } catch (e) {}
  const W = cv.clientWidth, H = cv.clientHeight;
  let inside = 0, centred = 0; const off = [];
  for (const n of g.nodes) {
    let p = null;
    try { p = v.project(n.id); } catch (e) { p = null; }
    if (!p || p.visible === false) { off.push(n.id); continue; }
    if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) centred++;
    if (p.left >= 0 && p.top >= 0 && p.right <= W && p.bottom <= H) inside++; else off.push(n.id);
  }
  return { kind: 'scene', total: g.nodes.length, inside, centred, off, canvas: { w: W, h: H } };
}

/* Is the way back on screen, and is it a real box a mouse could hit? `hidden`
   is not enough: a button inside a collapsed or covered parent is "not hidden"
   and still unreachable, so this reports the rect and whether the modal (the
   only thing that can cover the stage's top-right) overlaps it. */
function readBackBtn() {
  const b = document.querySelector('#sc-overlay .sc-back');
  if (!b) return { present: false };
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const modal = document.querySelector('[data-sc-modal]');
  let covered = 0;
  if (modal) {
    for (const card of modal.querySelectorAll('.scm-card, .scm-sheet, .scm-body, .scm-head')) {
      const m = card.getBoundingClientRect();
      const ix = Math.max(0, Math.min(r.right, m.right) - Math.max(r.left, m.left));
      const iy = Math.max(0, Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top));
      covered = Math.max(covered, Math.round(ix * iy));
    }
  }
  return {
    present: true, hidden: b.hidden, display: cs.display, visibility: cs.visibility,
    label: (b.textContent || '').trim(),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    onScreen: r.width > 20 && r.height > 12 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    covered,
  };
}

function readFooter() {
  const st = document.querySelector('#sc-overlay .sc-state');
  const retry = document.querySelector('#sc-overlay .sc-retry3d');
  return {
    text: st ? (st.textContent || '').trim() : null,
    retryPresent: !!retry, retryHidden: retry ? retry.hidden : null,
  };
}

/* aimAt — the plate's centre in CLIENT pixels.
   🔴 TWO SPACES, AND MISSING THE SECOND LOOKS LIKE "CLICKING DOES NOTHING".
   project() is in the canvas's LAYOUT pixels; page.mouse is in CLIENT pixels,
   and inside the real index.html those differ twice (the stage starts ~180 px
   down, and the app scales its whole UI, so the canvas lays out wider than it
   paints). Convert with the canvas's own bounding rect, exactly as pw-e2e does
   — a raw aim lands ~80 px off the plate and the click hits the floor. */
async function aimAt(page, id) {
  return page.evaluate((nid) => {
    const v = window.__mg.supplyChain.view();
    if (v && typeof v.project === 'function') {
      const p = v.project(nid);
      const cv = document.querySelector('#sc-overlay canvas');
      if (cv && p && isFinite(p.x) && isFinite(p.y) && p.visible !== false) {
        const r = cv.getBoundingClientRect();
        const kx = r.width / Math.max(1, cv.clientWidth), ky = r.height / Math.max(1, cv.clientHeight);
        return { x: Math.round(r.left + p.x * kx), y: Math.round(r.top + p.y * ky), via: 'project' };
      }
    }
    const el = document.querySelector('[data-sc-node="' + nid + '"]');
    if (el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), via: 'dom' }; }
    return null;
  }, id);
}

/* The camera tweens; project() during the flight reports where it is, not
   where it is going. scene.js's tween is sub-second, so a second and a half is
   several times the flight — and it is a WAIT, never a nudge: touching the
   canvas here would wake the idle turntable and mask the very bug (a move
   eaten by the idle branch) the shell's wakeCam exists for. */
const settle = (page, ms = 1500) => page.waitForTimeout(ms);

async function openMap(page, opts) {
  /* 150 s, not 90. The real page is 11.6 MB and this suite loads several of
     them in one browser; a slow module mount is this machine being busy, not
     the feature being broken, and a timeout here kills the whole run with a
     stack that says nothing about the map. */
  await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 150000 });
  await page.evaluate((o) => window.openSupplyChain(o || {}), opts || null);
  await page.waitForFunction(() => !!document.getElementById('sc-overlay'), null, { timeout: 30000 });
}
/* Wait until the shell has settled on a view. Deliberately generous: the whole
   point of the round is that the 3D map is allowed to be late, so a test that
   gives up at 2.2 s would be re-asserting the bug as a requirement. */
const waitView = (page, ms = 30000) =>
  page.waitForFunction(() => {
    const s = window.__mg.supplyChain.state();
    return !!(s && s.open && s.view);
  }, null, { timeout: ms }).catch(() => {});
const waitScene = (page, ms = 30000) =>
  page.waitForFunction(() => {
    const s = window.__mg.supplyChain.state();
    return !!(s && s.open && s.view === 'scene');
  }, null, { timeout: ms }).then(() => true, () => false);

/* ══ the run ═══════════════════════════════════════════════════════════════ */
async function viewportRun(page, t, label) {
  console.log(`\n  ── ${label}: one click must not cost the map`);
  await t.goto('index.html');
  ok(t.navStatus === null || t.navStatus < 400, `${label}: index.html served`, 'HTTP ' + t.navStatus);
  await openMap(page);
  const gotScene = await waitScene(page);
  ok(gotScene, `${label}: the 3D map is the view that mounts`, JSON.stringify(await page.evaluate(() => window.__mg.supplyChain.state())));
  if (!gotScene) return;                       // every plate assertion below is about the 3D map
  await settle(page, 2000);

  /* (a) home */
  const home = await page.evaluate(readPlates);
  note(label + '.home', home);
  ok(home.inside === home.total, `${label} (a): all ${home.total} plates are inside the canvas at home`, `${home.inside}/${home.total} whole · ${home.centred} centred · off: ${home.off.slice(0, 6).join(',')}`);
  await png(page, label + '-1-home');

  /* (b) a REAL click on a tile, then a REAL click on the card's close button */
  const target = 'weaponsmith';
  const aim = await aimAt(page, target);
  ok(aim && aim.via === 'project', `${label}: aimed at ${target} on the canvas`, JSON.stringify(aim));
  if (!aim) return;
  await page.mouse.click(aim.x, aim.y);
  await page.waitForFunction(() => !!document.querySelector('[data-sc-modal]'), null, { timeout: 8000 }).catch(() => {});
  const modalUp = await page.evaluate(() => !!document.querySelector('[data-sc-modal]'));
  ok(modalUp, `${label}: the click opened the card`);
  await settle(page);
  const closeUp = await page.evaluate(readPlates);
  note(label + '.closeup', closeUp);
  ok(closeUp.inside < home.inside, `${label}: the click really is a close-up (so the test is testing something)`, `${closeUp.inside}/${closeUp.total} in frame`);

  /* (c) the way back is visible IN the close-up, before anything is dismissed */
  const back = await page.evaluate(readBackBtn);
  note(label + '.back', back);
  ok(back.present && !back.hidden && back.onScreen, `${label} (c): a labelled way back is on screen in the close-up`, JSON.stringify(back.rect) + ' "' + back.label + '"');
  ok(back.covered === 0, `${label} (c): the card does not cover it`, back.covered + 'px²');
  await png(page, label + '-2-closeup-card');

  /* the close button, clicked with the mouse like a player would */
  const cbtn = await page.evaluate(() => {
    const b = document.querySelector('[data-sc-modal] .scm-close');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  ok(cbtn, `${label}: the card has a close button`);
  if (cbtn) await page.mouse.click(cbtn.x, cbtn.y);
  await settle(page, 2000);
  const after = await page.evaluate(readPlates);
  note(label + '.afterClose', after);
  ok(after.inside === after.total, `${label} (b): closing the card gives the whole map back — no home(), no select(), no tab`, `${after.inside}/${after.total} (was ${closeUp.inside}/${closeUp.total})`);
  await png(page, label + '-3-after-close');

  /* (c cont.) the button restores the map in ONE click from a close-up that
     has no card on top of it — the "show this flow on the map" route, which is
     the only way to reach that state and the one the old build stranded. */
  const aim2 = await aimAt(page, 'medical');
  if (aim2) {
    await page.mouse.click(aim2.x, aim2.y);
    await page.waitForFunction(() => !!document.querySelector('[data-sc-modal]'), null, { timeout: 8000 }).catch(() => {});
    /* 🔴 A LOCATOR CLICK, NOT page.mouse, FOR THIS ONE BUTTON. "Show this flow
       on the map" sits well down a scrolling card, so its rect is measurable
       while the point is outside the card's own clip — a raw mouse click at
       those coordinates landed on a partner row instead, which RE-OPENS the
       card, and the test read "the card is still up" for a reason that had
       nothing to do with the code under test. locator.click scrolls it into
       view first and is still a real mouse click. */
    const hlLoc = page.locator('[data-sc-modal] [data-a="highlight"]').first();
    const hl = (await hlLoc.count()) > 0;
    if (hl) {
      await hlLoc.click();
      await settle(page);
      const naked = await page.evaluate(() => ({ modal: !!document.querySelector('[data-sc-modal]'), back: (() => { const b = document.querySelector('#sc-overlay .sc-back'); return b ? !b.hidden : null; })() }));
      ok(naked.modal === false && naked.back === true, `${label} (c): a close-up with no card still shows the way back`, JSON.stringify(naked));
      await png(page, label + '-4-closeup-nocard');
      const bb = await page.evaluate(readBackBtn);
      if (bb.present && !bb.hidden) {
        await page.mouse.click(bb.rect.x + bb.rect.w / 2, bb.rect.y + bb.rect.h / 2);
        await settle(page, 2000);
        const backHome = await page.evaluate(readPlates);
        note(label + '.afterBackBtn', backHome);
        ok(backHome.inside === backHome.total, `${label} (c): one click on "${bb.label}" restores the whole map`, `${backHome.inside}/${backHome.total}`);
        await png(page, label + '-5-after-back');
      }
    } else {
      ok(false, `${label}: the card offers "Show this flow on the map"`, 'button not found');
      await page.keyboard.press('Escape');
      await settle(page);
    }
  }

  /* (d) the Escape ladder: close-up first, overlay second */
  const aim3 = await aimAt(page, 'restaurant');
  if (aim3) {
    await page.mouse.click(aim3.x, aim3.y);
    await page.waitForFunction(() => !!document.querySelector('[data-sc-modal]'), null, { timeout: 8000 }).catch(() => {});
    const hl2 = page.locator('[data-sc-modal] [data-a="highlight"]').first();
    if (await hl2.count()) await hl2.click();
    await settle(page);
    const before = await page.evaluate(() => ({ modal: !!document.querySelector('[data-sc-modal]'), overlay: !!document.getElementById('sc-overlay'), sel: window.__mg.supplyChain.state().selected }));
    await page.keyboard.press('Escape');
    await settle(page, 2000);
    const esc1 = await page.evaluate(() => ({ overlay: !!document.getElementById('sc-overlay'), sel: window.__mg.supplyChain.state() ? window.__mg.supplyChain.state().selected : 'closed' }));
    const plates1 = await page.evaluate(readPlates);
    note(label + '.esc1', { before, esc1, plates1 });
    ok(esc1.overlay === true, `${label} (d): Escape in a close-up does NOT close the whole map`, JSON.stringify(esc1));
    ok(plates1.inside === plates1.total, `${label} (d): …it gives the overview back instead`, `${plates1.inside}/${plates1.total}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const esc2 = await page.evaluate(() => !!document.getElementById('sc-overlay'));
    ok(esc2 === false, `${label} (d): a second Escape closes the map`, String(esc2));
  }

  /* re-open, so the next viewport starts from the same place and so the
     close/open cycle itself is exercised once per viewport */
  const still = await page.evaluate(() => !!document.getElementById('sc-overlay'));
  if (still) await page.evaluate(() => window.MythicSupplyChain.close());
}

/* (e) cold opens. A fresh PAGE each time in the same browser context: the
   module graph, the overlay and every timer are new, which is what the race
   is about. The HTTP cache is warm, and that is stated rather than worked
   around — a cold cache would make this the slowest gate in the repo and the
   deadline it is measuring is dominated by parse and execute, not transfer. */
async function coldRun(t, n) {
  console.log(`\n  ── (e) ${n} cold opens: does the 3D map win, and is the footer honest`);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const page = await t.newPage('cold' + i);
    try {
      await page.addInitScript(BOOT);
      await page.goto(t.url('index.html'), { waitUntil: 'load', timeout: 90000 });
      const t0 = Date.now();
      await openMap(page);
      await waitView(page);
      const first = await page.evaluate(() => window.__mg.supplyChain.state().view);
      const firstMs = Date.now() - t0;
      const scene = await waitScene(page);
      const row = {
        i, first, firstMs, endedScene: scene, ms: Date.now() - t0,
        webgl: await page.evaluate(() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }),
        footer: await page.evaluate(readFooter),
      };
      rows.push(row);
      console.log(`     #${i}  first=${row.first} (${row.firstMs}ms)  ended=${row.endedScene ? 'scene' : '2d'} (${row.ms}ms)  footer="${row.footer.text}"`);
      if (SHOTS && i === 0) { R.shots.push(await shot(page, path.join(SHOTS, 'cold-0.png'))); }
    } finally { await page.close().catch(() => {}); }
  }
  note('colds', rows);
  const gl = rows.filter((r) => r.webgl).length;
  const sceneEnd = rows.filter((r) => r.endedScene).length;
  ok(gl === rows.length, `(e): WebGL was available in all ${rows.length} runs`, gl + '/' + rows.length);
  ok(sceneEnd === rows.length, `(e): state().view is 'scene' in ${rows.length} of ${rows.length} cold opens`, sceneEnd + '/' + rows.length);
  /* the honesty clause, checked on every run including the ones that ended 3D:
     the 2D footer is allowed to exist, it is not allowed to blame the GPU */
  const lies = rows.filter((r) => r.webgl && /no WebGL/i.test(String(r.footer.text)));
  ok(lies.length === 0, '(e): no footer claimed "no WebGL" on a machine that has it', lies.length + ' liar(s)');
  const first2d = rows.filter((r) => r.first === '2d');
  note('first2d', first2d.length);
  console.log(`     (${first2d.length} of ${rows.length} showed the 2D map first and were swapped to 3D)`);
}

/* (e cont.) THE SWAP ITSELF. On this machine the scene usually beats the
   2200 ms deadline, so the recovery path that matters most — 2D drawn first,
   real map adopted when it lands — would never execute in a green run and
   would rot. `scene2dAfterMs: 0` is the test seam that forces it: the 2D map
   is guaranteed to be drawn first, and everything after is the real code. */
async function swapRun(t) {
  console.log('\n  ── (e) the late scene is adopted, not thrown away');
  const page = await t.newPage('swap');
  try {
    await page.addInitScript(BOOT);
    await page.goto(t.url('index.html'), { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!(window.__mg && window.__mg.supplyChain), null, { timeout: 90000 });
    /* 🔴 RECORD THE SEQUENCE, DO NOT SAMPLE IT. The first version of this test
       read state() once after the open resolved and found 'scene' — not
       because the 2D map was never drawn, but because the swap had already
       happened in the gap (three.js was warm in the HTTP cache, so the "late"
       scene was ~100 ms late). A 10 ms sampler started BEFORE the open is the
       only honest way to assert on an order of events this short. */
    await page.evaluate(() => {
      window.__SWAP = { seq: [], footers: [] };
      window.__SWAP.t = setInterval(() => {
        try {
          const s = window.__mg.supplyChain.state();
          const v = s && s.open ? s.view : null;
          const q = window.__SWAP.seq;
          if (v && q[q.length - 1] !== v) {
            q.push(v);
            const f = document.querySelector('#sc-overlay .sc-state');
            window.__SWAP.footers.push(f ? f.textContent.trim() : null);
          }
        } catch (e) {}
      }, 10);
    });
    await page.evaluate(() => window.openSupplyChain({ scene2dAfterMs: 0 }));
    await waitView(page);
    const became0 = await waitScene(page, 40000);
    const seq = await page.evaluate(() => { clearInterval(window.__SWAP.t); return { seq: window.__SWAP.seq, footers: window.__SWAP.footers }; });
    note('swapSeq', seq);
    ok(seq.seq[0] === '2d', 'swap: the 2D map is drawn first when the deadline is 0', JSON.stringify(seq.seq));
    ok(!/no WebGL/i.test(String(seq.footers[0] || '')), 'swap: the meanwhile footer does not blame the GPU', seq.footers[0]);
    /* NO SCREENSHOT OF THE MEANWHILE STATE HERE, deliberately. The first draft
       saved one called "swap-1-meanwhile.png" and it was a picture of the 3D
       map: the swap had already happened by the time the camera could fire,
       which is the same sampling mistake the sequence recorder above exists to
       avoid — and a mislabelled screenshot is worse than none, because the
       next reader believes it. The genuinely-2D frame is photographed in
       noThreeRun, where the state is permanent. */
    const became = became0;
    const after = await page.evaluate(() => ({
      view: window.__mg.supplyChain.state().view,
      canvases: document.querySelectorAll('#sc-overlay canvas').length,
      twoD: document.querySelectorAll('#sc-overlay .scf').length,
      is2d: !!document.querySelector('#sc-overlay .sc-stage.is-2d'),
      footer: document.querySelector('#sc-overlay .sc-state').textContent.trim(),
    }));
    ok(became && after.view === 'scene', 'swap: the late 3D map takes over by itself', JSON.stringify(after));
    ok(after.twoD === 0 && after.is2d === false, 'swap: the 2D map is disposed, not left underneath', JSON.stringify(after));
    await page.waitForTimeout(2000);
    const plates = await page.evaluate(readPlates);
    ok(plates.inside === plates.total, 'swap: the adopted map opens on the whole board', `${plates.inside}/${plates.total}`);
    if (SHOTS) R.shots.push(await shot(page, path.join(SHOTS, 'swap-adopted.png')));
  } finally { await page.close().catch(() => {}); }
}

/* (e cont.) THE CASE THE OLD FOOTER LIED ABOUT. WebGL is fine, three.js never
   arrives (blocked CDN, missing vendored copy, an offline first visit). The
   old build called this "no WebGL"; it must now say the library did not load
   AND offer a way to try again — and that way has to genuinely re-request the
   script, which is the part that is easy to fake and easy to get wrong. */
async function noThreeRun(t) {
  console.log('\n  ── (e) WebGL is fine, three.js is not');
  const page = await t.newPage('nothree');
  let block = true;
  try {
    await page.route(/three(\.min)?\.js/, (route) => (block ? route.abort() : route.continue()));
    await page.addInitScript(BOOT);
    await page.goto(t.url('index.html'), { waitUntil: 'load', timeout: 90000 });
    await openMap(page);
    await waitView(page);
    const f = await page.evaluate(readFooter);
    const st = await page.evaluate(() => window.__mg.supplyChain.state());
    note('nothree', { st, f });
    ok(st.view === '2d', 'no-three: the 2D map is drawn', st.view);
    ok(!/no WebGL/i.test(String(f.text)), 'no-three: the footer does NOT blame the GPU', f.text);
    ok(/could not load/i.test(String(f.text)), 'no-three: it says what actually happened', f.text);
    ok(f.retryPresent && f.retryHidden === false, 'no-three: a visible control offers the 3D map again', JSON.stringify(f));
    if (SHOTS) R.shots.push(await shot(page, path.join(SHOTS, 'nothree-1-blocked.png')));
    /* the 2D stage is a SCROLL container; a control that scrolls off the top
       of it is a control the player who needs it most cannot reach */
    const scrolled = await page.evaluate(() => {
      const st = document.querySelector('#sc-overlay .sc-stage');
      st.scrollTop = st.scrollHeight;
      const b = document.querySelector('#sc-overlay .sc-retry3d').getBoundingClientRect();
      return { top: Math.round(b.top), onScreen: b.top >= 0 && b.bottom <= innerHeight && b.width > 20, scrollTop: Math.round(st.scrollTop) };
    });
    ok(scrolled.scrollTop > 0 && scrolled.onScreen, 'no-three: it stays on screen after the 2D list is scrolled', JSON.stringify(scrolled));
    await page.evaluate(() => { document.querySelector('#sc-overlay .sc-stage').scrollTop = 0; });
    /* press it while still blocked: it must stay honest, not pretend */
    await page.locator('#sc-overlay .sc-retry3d').click();
    await page.waitForTimeout(3000);
    const still = await page.evaluate(readFooter);
    ok(/could not load/i.test(String(still.text)), 'no-three: a retry that fails says so again', still.text);
    /* now let the script through, as a flaky network would: the SAME button
       has to reach a real 3D map, which only works if the retry re-requests */
    block = false;
    await page.locator('#sc-overlay .sc-retry3d').click();
    const got = await waitScene(page, 45000);
    const after = await page.evaluate(readFooter);
    ok(got, 'no-three: pressing it once the network is back reaches the 3D map', String(got) + ' · ' + after.text);
    if (got) {
      await page.waitForTimeout(2000);
      const plates = await page.evaluate(readPlates);
      ok(plates.inside === plates.total, 'no-three: and that map opens on the whole board', `${plates.inside}/${plates.total}`);
      if (SHOTS) R.shots.push(await shot(page, path.join(SHOTS, 'nothree-2-recovered.png')));
    }
  } finally { await page.close().catch(() => {}); }
}

/* (e cont.) the honest no-WebGL page: the ONE case where the footer may blame
   the GPU, and the case where "Try the 3D map" must NOT be offered — a button
   that cannot work is worse than no button. */
async function noWebglRun(t) {
  console.log('\n  ── (e) the genuinely WebGL-less machine');
  const page = await t.newPage('nogl');
  try {
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
        if (/^(webgl2?|experimental-webgl)$/.test(String(kind))) return null;
        return real.call(this, kind, ...rest);
      };
    });
    await page.addInitScript(BOOT);
    await page.goto(t.url('index.html'), { waitUntil: 'load', timeout: 90000 });
    await openMap(page);
    await waitView(page);
    const st = await page.evaluate(() => window.__mg.supplyChain.state());
    const f = await page.evaluate(readFooter);
    note('nogl', { st, f });
    ok(st.view === '2d', 'no-WebGL: the 2D map is drawn', st.view);
    ok(/no WebGL/i.test(String(f.text)), 'no-WebGL: the footer says so — the one time it may', f.text);
    ok(f.retryPresent && f.retryHidden === true, 'no-WebGL: "Try the 3D map" is NOT offered', JSON.stringify(f));
    if (SHOTS) R.shots.push(await shot(page, path.join(SHOTS, 'nogl.png')));
  } finally { await page.close().catch(() => {}); }
}

async function main() {
  console.log('\n  ↩ Supply Chain — recovery, inside the real public/index.html\n');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  await withPage(async (page, t) => {
    t.allowErrors = true;                      // the real page's own console is not this suite's verdict
    await page.addInitScript(BOOT);
    /* the two --no-* flags exist for iterating on one section; a full run
       passes neither, and the summary line prints what actually ran */
    if (!flag('no-vp')) {
      await viewportRun(page, t, '1600x900');
      await page.setViewportSize({ width: 1366, height: 768 });
      await viewportRun(page, t, '1366x768');
    }
    if (!flag('no-colds')) await coldRun(t, COLDS);
    await swapRun(t);
    await noThreeRun(t);
    await noWebglRun(t);
    const mine = t.errors.filter((e) => MINE.test(e));
    note('ourErrors', mine);
    ok(mine.length === 0, 'no console error attributable to the map', mine.slice(0, 3).join(' | '));
  }, { w: 1600, h: 900 });

  console.log(`\n  ${R.fail ? '❌' : '✅'}  ${R.pass} passed, ${R.fail} failed\n`);
  if (flag('json')) console.log(JSON.stringify(R, null, 2));
  process.exit(R.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
