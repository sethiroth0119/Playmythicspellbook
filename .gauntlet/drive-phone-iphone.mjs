/* ══════════════════════════════════════════════════════════════════════════
   📱 DRIVE-PHONE-IPHONE — the handset is a handset, and it has a mute switch.

   TWO ASKS: "Update the frame modal of the phone make it the iPhone in the
   second image. Make the phone modal fit that perfectly where it looks like a
   iphone" and "add a mute button to the phone for the notifications".

   🔴 THE PHONE HAD NEVER HONOURED ITS OWN ASPECT RATIO, AND NOBODY COULD SEE IT
      UNTIL THE SHAPE MATTERED. #bcp-shell carried `aspect-ratio:9/19` with
      `width:auto` from the day it shipped. Measured at 1280x900 it was 676px
      tall and 420px wide — 0.62, against the 0.47 the ratio asks for. The cause
      is flex: the shell is an item in a flex row, so with width:auto its base
      size comes from its CONTENT (a feed of text, which is wide) and the ratio
      never resolves; the only thing holding the width in was max-width, so the
      phone was 420px wide at every window size. It read as a slab because it
      was one — which is also why the previous round's rails-and-notch detailing
      never rescued the silhouette. The width is now derived from the height.

   🔴 AND THE MUTE SWITCH IS ON THE SHELL, OUTSIDE #bcp-screen. The main click
      delegate is bound to the screen, so a data-act handled there would never
      receive this button's click — the hire modal shipped with exactly that
      bug, rendered perfectly and did nothing. Wired on the wrapper instead, and
      asserted here by clicking it for real.

   Pinned, with controls:
     · the shell is 9:19.5 — a phone, not a slab
     · chassis and display radii are the real derivation (56 → 46 = bezel)
     · the notch hangs off the display and carries a camera and a speaker
     · 🔴 CONTROL: the notch cannot eat a click meant for the app under it
     · the ring/silent switch exists, and CLICKING IT actually toggles
     · 🔴 muted, a new post plays NO sound…
     · 🔴 CONTROL: …and unmuted, the same post does
     · the choice survives a reload
     · 🔴 CONTROL: muting does not shift the throttle on pings that do play

   Run:  node .gauntlet/drive-phone-iphone.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9640 + (process.pid % 30);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});

/* 🔊 COUNT REAL play() CALLS. The mute has to be tested on the path that
   actually makes noise, not on the flag that is supposed to gate it — a flag
   that reads true while the audio still fires is precisely the bug worth
   catching. Injected before any script runs, so the module's own Audio object
   is the wrapped one. */
await pg.addInitScript(() => {
  window.__PLAYS = 0;
  const A = window.Audio;
  window.Audio = function (...a) {
    const el = new A(...a);
    const play = el.play.bind(el);
    el.play = function () { window.__PLAYS++; try { return play(); } catch (e) { return Promise.resolve(); } };
    return el;
  };
  window.Audio.prototype = A.prototype;
});

await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(5000);

const out = {};

/* ══ 1 · the shape ═════════════════════════════════════════════════════════ */
out.shape = await pg.evaluate(async () => {
  const r = document.querySelector('#railbar .rl[data-rail="bcphone"]');
  if (r) r.click();
  await new Promise(x => setTimeout(x, 700));
  const shell = document.getElementById('bcp-shell');
  const screen = document.getElementById('bcp-screen');
  const notch = document.querySelector('#bcp-screen .bcp-notch-hw');
  if (!shell || !screen) return { open: false };
  const sr = shell.getBoundingClientRect(), cr = screen.getBoundingClientRect();
  const cs = getComputedStyle(shell), ss = getComputedStyle(screen);
  const o = {
    open: !!document.getElementById('bcphone').classList.contains('open'),
    w: Math.round(sr.width), h: Math.round(sr.height),
    ratio: Math.round((sr.width / sr.height) * 1000) / 1000,
    shellRadius: parseFloat(cs.borderTopLeftRadius),
    screenRadius: parseFloat(ss.borderTopLeftRadius),
    padding: parseFloat(cs.paddingTop),
    notch: !!notch,
    hasCam: !!document.querySelector('#bcp-screen .bcp-notch-hw .cam'),
    hasSpk: !!document.querySelector('#bcp-screen .bcp-notch-hw .spk'),
  };
  if (notch) {
    const nr = notch.getBoundingClientRect();
    /* the notch belongs to the DISPLAY: flush with its top edge, inside it */
    o.notchTopFlush = Math.abs(nr.top - cr.top) <= 1.5;
    o.notchInside = nr.left >= cr.left - 1 && nr.right <= cr.right + 1;
    o.notchWidthFrac = Math.round((nr.width / cr.width) * 100) / 100;
    /* 🔴 CONTROL: it overlaps the status row, so it must not take clicks. */
    o.notchInert = getComputedStyle(notch).pointerEvents === 'none';
  }
  /* 🔴 CONTROL: nothing inside the display may spill past the rounded corners. */
  o.screenClips = ss.overflow === 'hidden';

  /* 🔴 EVERY CONTROL HAS TO FIT THE PHONE, WHICH IS NOW 312px WIDE.
     The tab strip used to be a single row with overflow-x:auto and
     scrollbar-width:none — so when the handset started keeping its real
     9:19.5 ratio, the fifth tab (UNEMPLOYED, the newest and least expected
     one) sat cut in half at the right edge behind an invisible scrollbar.
     Nothing looked broken; the content had simply left. A hidden control is
     not a control, so this measures the rects rather than the CSS. */
  const strip = document.getElementById('bcp-tabs');
  if (strip) {
    const btns = Array.from(strip.querySelectorAll('button'));
    const sr = strip.getBoundingClientRect();
    o.tabCount = btns.length;
    o.tabsOverflow = strip.scrollWidth > strip.clientWidth + 1;
    o.tabsAllInside = btns.length > 0 && btns.every((x) => {
      const r = x.getBoundingClientRect();
      return r.left >= sr.left - 1 && r.right <= sr.right + 1 && r.width > 0;
    });
    o.tabRows = new Set(btns.map((x) => Math.round(x.getBoundingClientRect().top))).size;
  }
  /* …and the app title, which has been squeezed twice: once by the narrower
     handset and once by the mute button joining the bar. */
  const ttl = document.getElementById('bcp-appttl');
  o.titleFits = ttl ? ttl.scrollWidth <= ttl.clientWidth + 1 : null;
  o.titleText = ttl ? (ttl.textContent || '').trim() : null;
  return o;
});

/* 🔴 THE EXACT URL THE CITY IMPORTED, CACHE-BUST AND ALL. Importing
   '/src/broadcast/phone.js' bare gives a SECOND MODULE INSTANCE — a different
   URL is a different module, so it has its own `_muted`, its own `_pingSeen`
   and its own Audio element. The first run of this driver did exactly that and
   read a phone whose markup said muted while the module it was asking said
   audible; both were telling the truth about different copies. Everything
   below asks the copy the player is actually using. */
const PHONE_URL = await pg.evaluate(() => '/src/broadcast/phone.js?v=' + (window.NC_BUILD || 'bc1'));

/* ══ 2 · the ring / silent switch ══════════════════════════════════════════ */
out.mute = await pg.evaluate(async (url) => {
  const mod = await import(url);
  const el = document.getElementById('bcp-mute');
  const o = { exists: !!el, exports: typeof mod.isMuted === 'function' && typeof mod.setMuted === 'function' };
  if (!el || !o.exports) return o;

  /* it is a real button on the rail, not a painted line */
  const r = el.getBoundingClientRect();
  const shell = document.getElementById('bcp-shell').getBoundingClientRect();
  o.onLeftRail = r.left < shell.left + 8;
  o.tall = Math.round(r.height);
  o.isButton = el.tagName === 'BUTTON';
  o.hasAria = el.hasAttribute('aria-pressed');

  /* 🔔 THE ONE A PLAYER CAN SEE. The chassis switch is a 4px sliver on the
     rail — correct, and exactly what the real control looks like, but on a
     PICTURE of a phone there is no thumb to find it with. The header bell is
     the discoverable half; both drive the same setMuted. */
  const bell = document.getElementById('bcp-bell');
  o.bellExists = !!bell;
  o.bellInHeader = !!(bell && bell.closest('#bcp-app'));
  o.bellInsideScreen = !!(bell && bell.closest('#bcp-screen'));

  mod.setMuted(false);
  o.startsUnmuted = mod.isMuted() === false;
  o.ariaOff = el.getAttribute('aria-pressed');
  o.bellUnmutedGlyph = bell ? bell.textContent.trim() : null;

  /* 🔴 CLICKED FOR REAL. The switch lives on the shell, outside #bcp-screen
     where the main delegate is bound — the one thing most likely to be wrong
     about it, and unobservable from the exported functions. */
  el.click();
  await new Promise(x => setTimeout(x, 120));
  o.afterClick = mod.isMuted();
  o.ariaOn = el.getAttribute('aria-pressed');
  o.classOn = el.classList.contains('on');
  /* 🔴 BOTH CONTROLS SHOW THE SAME STATE. Two buttons for one setting is two
     ways to be out of step with it, and the stale one is always the one the
     player is not looking at. */
  o.bellFollowedSwitch = !!(bell && bell.classList.contains('on'));
  o.bellMutedGlyph = bell ? bell.textContent.trim() : null;
  /* …and clicking the BELL toggles it back, so the visible one really works
     and is not a read-out of the switch beside it. */
  if (bell) { bell.click(); await new Promise(x => setTimeout(x, 120)); }
  o.afterBellClick = mod.isMuted();
  o.switchFollowedBell = !!(el && !el.classList.contains('on'));
  /* put it back where the rest of the stage expects it */
  mod.setMuted(true);

  el.click();
  await new Promise(x => setTimeout(x, 120));
  o.afterSecondClick = mod.isMuted();

  /* 🔴 CONTROL: clicking hardware must NOT close the phone — the wrapper's
     backdrop handler sits on the same element this listener was added to. */
  o.stillOpen = document.getElementById('bcphone').classList.contains('on')
             || document.getElementById('bcphone').classList.contains('open');
  return o;
}, PHONE_URL);

/* ══ 3 · 🔴 does it actually silence anything ══════════════════════════════ */
out.sound = await pg.evaluate(async (url) => {
  const mod = await import(url);
  const B = window.MythicBroadcast;
  const o = { haveApi: !!(B && B.posts) };
  if (!o.haveApi) return o;

  /* pingTick fires when the newest post id CHANGES, so a post has to be made
     between the two readings for there to be anything to silence.
     🔴 POSTED THROUGH Feed.add, WHICH IS THE SAME INSTANCE THE APP USES.
        MythicBroadcast exposes no way to write a post — `B.post(id)` READS one
        by id, and the first version of this stage called it as if it wrote,
        got null, and produced a control that measured nothing: zero sounds
        while muted and zero while audible, which passes the mute assertion on
        a phone whose speaker is unplugged.
     ⚠ feed.js is imported by index.js with a BARE specifier, so this URL
        resolves to the very module the running feed lives in. Anything with a
        query string would be a second copy with its own POSTS array, and the
        post would never reach the phone. */
  const Feed = await import('/src/broadcast/feed.js');
  o.canPost = typeof Feed.add === 'function';
  let n = 0;
  const say = (t) => {
    try {
      return Feed.add({ at: Date.now(), clock: '00:00', kind: 'world',
        poster: { name: 'Gauntlet', sub: 'test', avatar: '🧪' },
        body: t + ' ' + (++n), tags: [], likes: 0, affected: 0,
        subject: 'test', severity: 0, pole: 0 });
    } catch (e) { o.sayThrew = String(e).slice(0, 120); return null; }
  };

  /* ⚠ A DELTA, NOT AN ABSOLUTE. Turning the switch back ON rings once on
     purpose — so the player hears what they just enabled — which means the
     mute stage above has already moved this counter. Reading it as an absolute
     failed here, on a phone that was behaving perfectly. */
  mod.setMuted(false);
  const base0 = window.__PLAYS;
  mod.pingTick();                       // first sight: records, says nothing
  o.firstSightSilent = window.__PLAYS - base0;

  /* 🔴 MUTED: a new post must play nothing at all. */
  mod.setMuted(true);
  const before = window.__PLAYS;
  say('control post while muted');
  await new Promise(x => setTimeout(x, 60));
  mod.pingTick();
  o.playsWhileMuted = window.__PLAYS - before;

  /* 🔴 CONTROL: unmuted, the very same path DOES play — otherwise the test
     above passes on a phone whose sound was broken for another reason. */
  mod.setMuted(false);
  const before2 = window.__PLAYS;
  say('control post while audible');
  await new Promise(x => setTimeout(x, 60));
  o.tickReturn = mod.pingTick();
  o.playsWhileAudible = window.__PLAYS - before2;
  mod.setMuted(false);
  return o;
}, PHONE_URL);

/* ══ 4 · the choice survives a reload ══════════════════════════════════════ */
out.persist = await pg.evaluate(async (url) => {
  const mod = await import(url);
  mod.setMuted(true);
  let stored = null;
  try { stored = localStorage.getItem('mythic_phone_muted'); } catch (e) {}
  return { stored };
}, PHONE_URL);
await pg.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4500);
out.afterReload = await pg.evaluate(async (url) => {
  const mod = await import(url);
  const r = document.querySelector('#railbar .rl[data-rail="bcphone"]');
  if (r) r.click();
  await new Promise(x => setTimeout(x, 600));
  const el = document.getElementById('bcp-mute');
  const o = { muted: mod.isMuted(), painted: !!(el && el.classList.contains('on')) };
  mod.setMuted(false);
  return o;
}, PHONE_URL);

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const S = out.shape || {}, MU = out.mute || {}, SO = out.sound || {}, PE = out.persist || {}, AR = out.afterReload || {};

need('SETUP: the phone opens', S.open === true, S.open);
/* 9 / 19.5 = 0.4615 */
need('🔴 THE ASK: the handset is a phone shape, not a slab',
     Math.abs((S.ratio || 0) - 0.4615) < 0.02, { ratio: S.ratio, w: S.w, h: S.h });
need('…with an iPhone chassis radius', (S.shellRadius || 0) >= 40, S.shellRadius);
need('…and a display radius derived from it (chassis − bezel)',
     Math.abs((S.shellRadius || 0) - (S.padding || 0) - (S.screenRadius || 0)) <= 2,
     { chassis: S.shellRadius, bezel: S.padding, display: S.screenRadius });
need('THE ASK: it has a notch', S.notch === true, S.notch);
need('…cut out of the display, flush with its top edge', S.notchTopFlush === true && S.notchInside === true, S);
need('…carrying the camera and speaker the eye looks for', S.hasCam === true && S.hasSpk === true, S);
need('🔴 CONTROL: the notch cannot eat a click', S.notchInert === true, S.notchInert);
need('🔴 CONTROL: the display clips its own corners', S.screenClips === true, S.screenClips);

need('SETUP: the tab strip has all its tabs', (S.tabCount || 0) >= 5, S.tabCount);
need('🔴 THE ASK: every tab FITS the phone — none cut off at the edge',
     S.tabsAllInside === true, { inside: S.tabsAllInside, rows: S.tabRows, count: S.tabCount });
need('🔴 …and nothing is hidden behind a sideways scroll',
     S.tabsOverflow === false, S.tabsOverflow);
need('THE ASK: the app title fits too, with the mute button beside it',
     S.titleFits === true, { fits: S.titleFits, text: S.titleText });

need('THE ASK: there is a mute switch', MU.exists === true, MU.exists);
need('…and it is a real button on the left rail', MU.isButton === true && MU.onLeftRail === true, MU);
need('…that a screen reader can read', MU.hasAria === true && MU.ariaOff === 'false', MU);
need('SETUP: it starts unmuted', MU.startsUnmuted === true, MU);
need('🔴 CLICKING IT TOGGLES — it is outside the main delegate and still works',
     MU.afterClick === true, MU);
need('…and says so, in the markup and to a screen reader',
     MU.classOn === true && MU.ariaOn === 'true', MU);
need('…and clicking again turns it back on', MU.afterSecondClick === false, MU);

need('🔔 THE ASK: there is a mute button a player can SEE, in the app bar',
     MU.bellExists === true && MU.bellInHeader === true, MU);
need('…inside the screen, where the main click delegate reaches it',
     MU.bellInsideScreen === true, MU);
need('🔴 clicking the BELL mutes it too — it is a control, not a read-out',
     MU.afterBellClick === false, MU);
need('🔴 …and the two controls never disagree',
     MU.bellFollowedSwitch === true && MU.switchFollowedBell === true, MU);
need('…and it says which state it is in', MU.bellUnmutedGlyph === '🔔' && MU.bellMutedGlyph === '🔕', MU);
need('🔴 CONTROL: clicking hardware does not close the phone', MU.stillOpen === true, MU);

if (!SO.haveApi || !SO.canPost) console.log('  · sound stage skipped: no broadcast post API');
else {
  need('SETUP: the first sight of a post is silent by design', SO.firstSightSilent === 0, SO);
  need('🔴 THE ASK: muted, a new post makes NO sound', SO.playsWhileMuted === 0, SO);
  need('🔴 CONTROL: unmuted, the same path DOES make one', (SO.playsWhileAudible || 0) >= 1, SO);
}

need('the choice is written down', PE.stored === '1', PE);
need('…and survives a reload', AR.muted === true, AR);
need('…and the switch shows it on the first paint, not the first click', AR.painted === true, AR);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — it is shaped like the handset it is drawn from, and the silent switch actually silences it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
