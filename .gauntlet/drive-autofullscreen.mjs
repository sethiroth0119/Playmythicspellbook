/* ══════════════════════════════════════════════════════════════════════════
   🖥 DRIVE-AUTOFULLSCREEN — an installed launch opens fullscreen; a tab does not.

   THE ASK: "Make the PWA auto full screen."

   THE REAL FIX IS ONE LINE OF manifest.json — `"display": "fullscreen"` —
   which opens an installed app with no browser chrome, with no gesture, no
   permission and no JavaScript. That line is pinned below, because it is the
   part that actually does the work and it is also the part that is easiest to
   lose in a later edit to a file nobody reads.

   THE REST EXISTS FOR THE GAPS THAT DECLARATION CANNOT COVER: an app installed
   before the manifest changed keeps its old display mode until the browser
   re-reads it; browsers that do not honour `fullscreen` fall back to
   `standalone`; desktop Chrome reopens a PWA in the window state it was closed
   in. In those cases the app is running but windowed, and the arm spends the
   player's first tap on entering fullscreen.

   🔴 THE ONE THING THAT MUST NOT REGRESS IS THE TAB. Stealing a browser tab's
      first click to force fullscreen is hostile — the browser paints a warning
      over the game, and the player never asked for it. The control for that is
      the most important assertion in this file, and it is written as a
      CONTROL rather than a feature test on purpose: a bug that turns this on
      for tabs would look, from the feature side, exactly like success.

   Pinned:
     · the manifest declares fullscreen, first in display_override
     · an installed launch enters fullscreen on the first gesture
     · CONTROL: a browser tab is never taken fullscreen by a click
     · CONTROL: leaving fullscreen stops it re-entering on the next click
     · CONTROL: the setting turned off means no arm at all
     · the setting defaults ON, and only an explicit '0' turns it off

   Run:  node .gauntlet/drive-autofullscreen.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8720 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

/* ── 1 · the manifest, which is the fix itself ──────────────────────────── */
const mani = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];

/* A page, loaded either as an installed launch or as an ordinary tab, with a
   spy standing in for the one call that actually changes the window. The
   DECISION is what is under test; requestFullscreen itself is platform
   plumbing and is not this file's business. */
async function boot(query) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/index.html' + query, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('!!(window.FS && window.FS.launchedAsApp)', null, { timeout: 120000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => {
    window.__fsCalls = 0;
    window.FS.enter = function () { window.__fsCalls++; return Promise.resolve(); };
  });
  return pg;
}
/* A REAL click on the page, not a synthetic dispatch — the arm listens for a
   trusted gesture and a dispatched event is exactly what browsers refuse. */
const click = async (pg) => { await pg.mouse.click(8, 8); await pg.waitForTimeout(120); };

const out = {};

/* ── 2 · an installed launch ────────────────────────────────────────────── */
{
  const pg = await boot('?source=pwa');
  out.appMode = await pg.evaluate(() => window.FS.launchedAsApp());
  out.appDefaultOn = await pg.evaluate(() => window.FS.autoEnabled());
  await click(pg);
  out.appEnteredOnFirstClick = await pg.evaluate(() => window.__fsCalls);

  /* CONTROL: the player takes it back. The arm must not drag them in again.
     fullscreenchange is dispatched by hand because no real fullscreen was
     entered — the spy above saw to that — and it is the listener's REACTION
     that is being measured, not the browser's. */
  await pg.evaluate(() => {
    window.__fsCalls = 0;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  await pg.evaluate(() => window.FS.setAuto(true));     // try hard to re-arm
  await click(pg);
  out.appReEnteredAfterUserLeft = await pg.evaluate(() => window.__fsCalls);
  await pg.close();
}

/* ── 3 · CONTROL: an ordinary browser tab ───────────────────────────────── */
{
  const pg = await boot('');
  out.tabMode = await pg.evaluate(() => window.FS.launchedAsApp());
  await click(pg);
  await click(pg);
  out.tabEntered = await pg.evaluate(() => window.__fsCalls);
  await pg.close();
}

/* ── 4 · CONTROL: the setting, off ──────────────────────────────────────── */
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  /* Written before any of the page's own script runs, so the arm reads it on
     the way up rather than being switched off after the fact. */
  await pg.addInitScript(() => { try { localStorage.setItem('hg_pwa_autofs', '0'); } catch (e) {} });
  await pg.goto('http://127.0.0.1:' + P + '/index.html?source=pwa', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await pg.waitForFunction('!!(window.FS && window.FS.autoEnabled)', null, { timeout: 120000 }).catch(() => {});
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { window.__fsCalls = 0; window.FS.enter = function () { window.__fsCalls++; return Promise.resolve(); }; });
  out.offReadsAsOff = await pg.evaluate(() => window.FS.autoEnabled());
  await click(pg);
  out.offEntered = await pg.evaluate(() => window.__fsCalls);
  /* …and turning it back on arms a launch that is already running. */
  await pg.evaluate(() => { window.FS.setAuto(true); window.__fsCalls = 0; });
  await click(pg);
  out.backOnEntered = await pg.evaluate(() => window.__fsCalls);
  await pg.close();
}

/* ── 5 · the off switch, in the panel the player would look in ──────────
   renderSettings() is called DIRECTLY. render() routes to the auth gate for
   a signed-out visitor, so driving the UI to Settings would mean signing in
   — and the thing under test is the section's markup and wiring, which is
   the same function either way. The binding runs inside renderSettings, so
   this exercises the real handler and not a copy of it. */
{
  const pg = await boot('?source=pwa');
  out.settings = await pg.evaluate(() => {
    const o = {};
    try { renderSettings(); } catch (e) { return { err: String(e).slice(0, 200) }; }
    const cb = document.getElementById('set-autofs');
    o.exists = !!cb;
    o.checkedByDefault = cb ? cb.checked : null;
    o.wired = !!(cb && typeof cb.onchange === 'function');
    if (!o.wired) return o;
    cb.checked = false; cb.onchange();
    o.offAfterUncheck = window.FS.autoEnabled();
    cb.checked = true; cb.onchange();
    o.onAfterRecheck = window.FS.autoEnabled();
    return o;
  });
  await pg.close();
}

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
need('the manifest asks for fullscreen', mani.display === 'fullscreen', mani.display);
need('…and fullscreen is what display_override tries first',
     Array.isArray(mani.display_override) && mani.display_override[0] === 'fullscreen', mani.display_override);
need('…with standalone still behind it as the fallback',
     Array.isArray(mani.display_override) && mani.display_override.indexOf('standalone') > 0, mani.display_override);
need('an installed launch is recognised as one', out.appMode === true, out.appMode);
need('the setting defaults ON', out.appDefaultOn === true, out.appDefaultOn);
need('THE ASK: an installed launch goes fullscreen on the first click', out.appEnteredOnFirstClick === 1, out.appEnteredOnFirstClick);
need('CONTROL: once the player leaves, a later click does not drag them back',
     out.appReEnteredAfterUserLeft === 0, out.appReEnteredAfterUserLeft);
need('CONTROL: a browser tab is not an installed launch', out.tabMode === false, out.tabMode);
need('CONTROL: and a tab is NEVER taken fullscreen by a click', out.tabEntered === 0, out.tabEntered);
need('CONTROL: the setting off reads as off', out.offReadsAsOff === false, out.offReadsAsOff);
need('CONTROL: …and then nothing is armed at all', out.offEntered === 0, out.offEntered);
need('turning it back on arms the running launch', out.backOnEntered === 1, out.backOnEntered);
const S = out.settings || {};
need('the Display section carries the switch', S.exists === true, S.err || S.exists);
need('…checked, because ON is the default', S.checkedByDefault === true, S.checkedByDefault);
need('…and it is actually wired to something', S.wired === true, S.wired);
need('unchecking it turns auto-fullscreen off', S.offAfterUncheck === false, S.offAfterUncheck);
need('CONTROL: …and re-checking turns it back on', S.onAfterRecheck === true, S.onAfterRecheck);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify({ manifest: { display: mani.display, display_override: mani.display_override }, ...out, pageErrors: errs.slice(0, 3) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the installed app opens fullscreen; a browser tab is left alone.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
