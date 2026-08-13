// ─────────────────────────────────────────────────────────────────────────────
// 📐 THE VISIBLE MAP BAND — a permanent floor, measured in a real browser.
//
//   node public/warpath/_layoutcheck.js
//
// ⚠ WHY THIS EXISTS. Twice now the phone layout has been "fixed" against a
// number that was not the thing a player sees. First `#sidetoggle` was lifted
// clear of the action rail, which fixed a 29% tap-theft and pushed the rail into
// the top HUD — every viewport lost map and 360x640 went NEGATIVE. Then that was
// reported as "the sheet-open band is 371 / 282 / 172px", which were viewH()'s
// return values: viewH() subtracts the sheet but knows nothing about the HUD
// (73-107px) or the rail (123-159px), and on a short screen those two alone
// exceed what is left.
//
// So this measures the ONLY number that matters — the gap between the bottom of
// the top HUD and the top of whatever is drawn over the canvas beneath it — in
// headless Chromium, at the four viewports the regression was found on, with the
// panel both shut and open. It is a floor, not a snapshot: any layout that keeps
// a usable map passes, and any that trades one overlap for another does not.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const PW = path.join(REPO, 'tools/warpath-deck/node_modules/playwright');

// A map band below this is not a map: you cannot tell where you are relative to
// anything, and dragging it is guesswork. Same constant the app uses.
const MIN_BAND = 120;
const SIZES = [[390, 844], [360, 640], [899, 600], [844, 390], [820, 1180], [1440, 900]];

(async () => {
  let chromium, startServer;
  try {
    ({ chromium } = require(PW));
    ({ startServer } = await import(path.join(REPO, 'tools/warpath-deck/serve.mjs')));
  } catch (e) {
    console.log('note: playwright is not installed — skipping the layout check.');
    console.log('      see tools/warpath-deck/README.md for how it is linked in.');
    process.exit(0);
  }

  const srv = await startServer(path.join(REPO, 'public'), 0);
  const browser = await chromium.launch({
    executablePath: process.env.WP_CHROMIUM || '/opt/pw-browsers/chromium',
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let fails = 0;
  console.log('the visible map band = min(rail top, sheet top) - HUD bottom\n');
  console.log('  viewport     panel   HUD  overlay   BAND   tap-theft');
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.route('**/*', r => r.request().url().startsWith(`http://127.0.0.1:${srv.port}/`)
      ? r.continue() : r.fulfill({ status: 204, body: '' }));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await page.goto(`http://127.0.0.1:${srv.port}/warpath/index.html`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    for (const want of [false, true]) {
      const isOpen = await page.evaluate(() =>
        document.getElementById('side').classList.contains('open')
        || (window.innerWidth > 900 && !document.getElementById('side').classList.contains('hidden')));
      if (isOpen !== want) { await page.click('#sidetoggle'); await page.waitForTimeout(500); }
      const r = await page.evaluate(() => {
        const el = id => document.getElementById(id);
        const q = id => el(id).getBoundingClientRect();
        const hud = q('top'), rail = q('rail'), side = q('side'), tog = q('sidetoggle');
        const narrow = window.innerWidth <= 900;
        // On desktop the panel is a column beside the map, not over it.
        const overlay = narrow ? Math.min(rail.top, side.top) : rail.top;
        // Does the sheet handle steal any part of an action button?
        const btns = [...document.querySelectorAll('#rail button')].map(b => b.getBoundingClientRect());
        let ov = 0;
        for (const b of btns) {
          const a = Math.max(0, Math.min(b.bottom, tog.bottom) - Math.max(b.top, tog.top))
                  * Math.max(0, Math.min(b.right, tog.right) - Math.max(b.left, tog.left));
          ov = Math.max(ov, a / ((b.width * b.height) || 1));
        }
        return {
          hud: Math.round(el('top').offsetHeight), overlay: Math.round(overlay),
          band: Math.round(overlay - hud.bottom), theft: Math.round(ov * 100),
          open: document.getElementById('side').classList.contains('open')
             || (window.innerWidth > 900 && !document.getElementById('side').classList.contains('hidden')),
          scrolled: Math.round(window.scrollY),
        };
      });
      const bad = [];
      if (r.band < MIN_BAND) bad.push('BAND ' + r.band + ' < ' + MIN_BAND);
      if (r.theft > 0) bad.push('the sheet handle covers ' + r.theft + '% of an action button');
      if (r.scrolled) bad.push('the page is scrolled by ' + r.scrolled + 'px — the HUD is off screen');
      if (errs.length) bad.push('pageerror: ' + errs[0]);
      if (bad.length) fails += bad.length;
      console.log('  ' + String(w + 'x' + h).padEnd(12) + (r.open ? ' open ' : ' shut ')
        + String(r.hud).padStart(6) + String(r.overlay).padStart(8)
        + String(r.band).padStart(8) + String(r.theft + '%').padStart(11)
        + (bad.length ? '   ✘ ' + bad.join('; ') : ''));
    }
    await ctx.close();
  }

  console.log(fails ? '\n' + fails + ' LAYOUT FAILURES' : '\nevery viewport keeps a usable map');

  /* ── THE BATTLE-RESULT LOOP, OBSERVED ─────────────────────────────────────
     "Reads correct" is not "observed working". The fix carries the announce
     baseline across a remount in sessionStorage, and there are exactly two ways
     it could be right in the file and wrong in the browser:

       1. a genuinely NEW run stops being quiet, and shouts its own history;
       2. the carry-over does NOT survive the cache-busted `src` the parent
          rebuilds the iframe with, in which case every battle result is still
          swallowed and nothing looks different.

     Both are checked here against the real page. The discriminator for (2) is a
     SENTINEL: a key the app could never generate is written into the carried
     set, the page is reloaded with a different query string, and the set is read
     back. If the app re-baselined, the sentinel is gone. If it continued the
     session, the sentinel is still there. Re-baselining and continuing look
     identical from the outside otherwise — that is why this test exists. */
  console.log('\nthe battle-result loop across a remount\n');
  let lfails = 0;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('**/*', r => r.request().url().startsWith(`http://127.0.0.1:${srv.port}/`)
    ? r.continue() : r.fulfill({ status: 204, body: '' }));
  const page = await ctx.newPage();
  const perrs = [];
  page.on('pageerror', e => perrs.push(String(e.message).slice(0, 140)));

  /* ⚠ THE RULE, STATED, BECAUSE THE FIRST VERSION OF THIS TEST ASSERTED THE
     WRONG ONE. It asserted "a fresh boot raises no ribbon at all", went red, and
     what it had caught was `boot()` raising the run's opening line — "Four
     Heroes entered this world" — which is theatre fired unconditionally on the
     boot path and has nothing to do with announceNewEvents. Tuning the code
     until that went green would have deleted a deliberate piece of writing to
     satisfy an assertion I had made up an hour earlier.

     The rule the carry-over actually protects is narrower and about the FEED:

       a session must never replay events the player has already lived through,
       and must always announce the ones it has not.

     A brand-new run has lived through nothing, so everything already in the
     feed is history and is silently baselined. A REBUILT frame — which is what
     every battle produces, because warpathStartBattle tears this screen down —
     has lived through the previous session, so the events it has not shown yet
     are news, and the battle result is exactly one of those.

     So the discriminator is a real LOUD event injected into the feed through
     the shipped RPC layer, and the assertion is whether THAT specific ribbon
     appears — not whether any ribbon appears. The boot line is allowed to fire
     in both cases, because in both cases it is true. */
  await page.addInitScript(() => {
    window.__ribbons = [];
    // Wrap the network layer the moment the module publishes it, so a known
    // LOUD event is in the feed from the very first read.
    let real = undefined;
    Object.defineProperty(window, 'WarpathNet', {
      configurable: true,
      get() { return real; },
      set(v) {
        const orig = v.rpc;
        v.rpc = function (fn, args) {
          return Promise.resolve(orig.call(v, fn, args)).then((r) => {
            if (fn === 'warpath_state' && r && r.ok && Array.isArray(r.events) && r.me) {
              r.events = [{ turn: (r.run && r.run.turn) || 1, kind: 'hero_defeated',
                            payload: { winner: 'A Rival', loser: r.me.hero_name } }]
                         .concat(r.events);
            }
            return r;
          });
        };
        real = v;
      },
    });
    document.addEventListener('DOMContentLoaded', () => {
      const rib = document.getElementById('ribbon');
      if (!rib) return;
      new MutationObserver(() => {
        if (rib.classList.contains('show')) {
          const t = (rib.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
          if (t && window.__ribbons[window.__ribbons.length - 1] !== t) window.__ribbons.push(t);
        }
      }).observe(rib, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    });
  });

  const DEFEAT = /You were beaten/i;
  const boot = async (qs) => {
    await page.goto(`http://127.0.0.1:${srv.port}/warpath/index.html${qs}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    return page.evaluate(() => {
      const keys = Object.keys(sessionStorage).filter(k => k.indexOf('wp_seen_') === 0);
      const k = keys[0] || null;
      let set = null;
      try { set = k ? JSON.parse(sessionStorage.getItem(k)) : null; } catch (e) {}
      return { key: k, n: set ? Object.keys(set).length : -1,
               hasSentinel: !!(set && set['SENTINEL']),
               ribbons: (window.__ribbons || []).slice(0) };
    });
  };

  // 1 — a first, genuinely new run: the feed is history, including the defeat.
  await page.goto(`http://127.0.0.1:${srv.port}/warpath/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { sessionStorage.clear(); } catch (e) {} });
  const r1 = await boot('?fresh=1');
  if (!r1.key) { console.log('  ✘ no baseline was written at all — the carry-over cannot work'); lfails++; }
  else console.log('  ok  a new run writes its baseline (' + r1.n + ' events, key ' + r1.key + ')');
  if (r1.ribbons.some(t => DEFEAT.test(t))) {
    console.log('  ✘ a genuinely new run replayed a defeat the player never lived through: '
      + JSON.stringify(r1.ribbons)); lfails++;
  } else {
    console.log('  ok  ...and does not replay the feed (raised only ' + JSON.stringify(r1.ribbons) + ')');
  }

  // 2 — a rebuilt frame, mid-run: the same event has NOT been shown yet, so it
  //     must be announced. This is the battle result arriving after a remount.
  await page.evaluate(() => {
    const k = Object.keys(sessionStorage).filter(x => x.indexOf('wp_seen_') === 0)[0];
    if (k) sessionStorage.setItem(k, JSON.stringify({ SENTINEL: 1 }));
  });
  const r2 = await boot('?v=' + Date.now());
  if (!r2.key) { console.log('  ✘ the baseline did not survive the reload'); lfails++; }
  else if (!r2.hasSentinel) {
    console.log('  ✘ THE CARRY-OVER DOES NOT SURVIVE THE CACHE-BUSTED src — the rebuilt frame '
      + 're-baselined, so every battle result is still swallowed'); lfails++;
  } else {
    console.log('  ok  ⚠ the rebuilt frame CONTINUED the torn-down one\'s session (sentinel survived)');
  }
  if (!r2.ribbons.some(t => DEFEAT.test(t))) {
    console.log('  ✘ ⚠ THE BATTLE RESULT WAS STILL SWALLOWED by the rebuilt frame: '
      + JSON.stringify(r2.ribbons)); lfails++;
  } else {
    console.log('  ok  ⚠ ...and TOLD THE PLAYER what happened to them while it was gone');
  }
  /* ── THE BARRIER DOTS, OBSERVED FOR THE FIRST TIME ──────────────────────
     `done` / `away` / `gone` shipped with the mock hardcoding turn_ended:false
     and away:false for every rival, so no critic, harness or player had ever
     seen one — a whole feature that could not be falsified. */
  const dots = await page.evaluate(() => {
    const seen = {};
    for (const i of document.querySelectorAll('#t-seats i')) {
      for (const c of i.classList) seen[c] = (seen[c] || 0) + 1;
    }
    return seen;
  });
  const want = ['thinking', 'done', 'away'];
  const missing = want.filter(k => !dots[k]);
  if (missing.length) {
    console.log('  ✘ barrier dot state(s) still unreachable in the shipped demo: '
      + missing.join(', ') + ' (saw ' + JSON.stringify(dots) + ')'); lfails++;
  } else {
    console.log('  ok  ⚠ barrier dots are observable at last: ' + JSON.stringify(dots));
  }

  if (perrs.length) { console.log('  ✘ pageerror: ' + perrs[0]); lfails++; }
  await ctx.close();

  await browser.close();
  await srv.stop();
  const total = fails + lfails;
  console.log(total ? '\n' + total + ' FAILURES' : '\nALL CLEAN');
  process.exit(total ? 1 : 0);
})();
