/* ══════════════════════════════════════════════════════════════════════════
   🎓 DRIVE-GUIDE-SEEN — a page guide is offered once per ACCOUNT, then only on
      the button.

   Reported: "Read the players account to see if they have ever seen the
   tutorial. Do not show them the tutorials unless they click the button. For
   this to keep playing it is annoying."

   🔴 TWO REASONS IT KEPT COMING BACK.
     1. "Seen" lived in localStorage alone, so it was a fact about the BROWSER.
        A second device, another browser, a cleared cache or a private window
        all read as "never seen" for a player who had sat through it many times.
     2. Worse, `done` only silenced a guide the AUTHOR had marked once-only:
          !((g.showOnce || g.triggerType === 'firstVisit') && done)
        A guide authored `everyVisit` or `load` — which the Main Menu tour is —
        replayed on EVERY visit for ever, no matter how many times it had been
        dismissed. Being seen was a property of the trigger, not of the player.

   WHAT THIS PINS:
     · the account is what remembers — Profile.dialogueFlags, which is already
       in all three whitelists, so it survives a reload, a device and a cache
     · a `load`/`everyVisit` guide does NOT auto-play once the account has seen
       it — the fix that actually answers the complaint
     · a guide the account has never seen still plays once, so a new player is
       not left with nothing
     · the replay button stays mounted, which is what "unless they click the
       button" rests on
     · the admin preview clears the ACCOUNT copy too, or a preview would be
       refused ever after by a flag the admin cannot see

   Run:  node .gauntlet/drive-guide-seen.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml' };
const P = 8160 + (process.pid % 60);
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
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

const out = await pg.evaluate(async () => {
  const o = {};
  const ID = 'drv_tour';


  /* helpers exist and read the account */
  o.hasHelpers = typeof _guideIsDone === 'function' && typeof _guideMarkDone === 'function'
              && typeof _guideIsOff === 'function' && typeof _guideClearSeen === 'function';

  Profile.dialogueFlags = {};
  o.freshAccountSaysUnseen = _guideIsDone(ID) === false;

  /* marking it writes the ACCOUNT, not just the device */
  _guideMarkDone(ID);
  o.accountFlagSet = !!(Profile.dialogueFlags || {})['seen:' + ID];
  o.doneAfterMark = _guideIsDone(ID) === true;

  /* 🔴 THE DEVICE IS WIPED — a new browser, a cleared cache, a private window.
     The account must still say seen. */
  try { localStorage.removeItem('mg_guide_done_' + ID); } catch (e) {}
  o.survivesACacheWipe = _guideIsDone(ID) === true;

  /* …and with the account cleared and only the device remembering, it still
     reads as seen — the local copy is the backstop for a signed-out player */
  Profile.dialogueFlags = {};
  try { localStorage.setItem('mg_guide_done_' + ID, '1'); } catch (e) {}
  o.deviceStillCounts = _guideIsDone(ID) === true;

  /* the admin preview clears BOTH, or a preview is refused ever after */
  _guideMarkDone(ID);
  _guideClearSeen(ID);
  o.previewClearsAccount = !(Profile.dialogueFlags || {})['seen:' + ID];
  o.previewClearsDevice = (() => { try { return localStorage.getItem('mg_guide_done_' + ID) === null; } catch (e) { return false; } })();

  /* the do-not-show box also reaches the account */
  _guideMarkOff(ID, true);
  o.offReachesAccount = !!(Profile.dialogueFlags || {})['off:' + ID];
  o.offIsRead = _guideIsOff(ID) === true;
  _guideMarkOff(ID, false);
  o.offCanBeCleared = _guideIsOff(ID) === false;

  /* 🎓 THE BACKFILL. An established account must not be shown the tour one
     more time just because the old record lived on a device. A brand-new one
     must still get it. */
  Profile.dialogueFlags = {};
  Profile.records = { battles: 0, wins: 0, losses: 0 };
  Profile.starterPicked = false; Profile.units = {};
  o.newPlayerNotBackfilled = _guideBackfillSeenOnce() === false;

  Profile.dialogueFlags = {};
  Profile.records = { battles: 12, wins: 6, losses: 6 };
  o.establishedBackfilled = _guideBackfillSeenOnce() === true;
  o.backfillMarkerSet = !!(Profile.dialogueFlags || {}).__guideBackfill_v1;
  o.backfillRunsOnce = _guideBackfillSeenOnce() === false;
  return o;
});

/* the auto-play decision, read out of the source — one boolean, worth pinning */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  out.src = {
    /* the old form only silenced author-marked once-only guides */
    oldTriggerCoupledFormGone: idx.indexOf("!((g.showOnce || g.triggerType === 'firstVisit') && done)") < 0,
    doneNowSilencesEverything: idx.indexOf('        && !done') >= 0,
    /* the account is read, and it is read FIRST */
    readsAccountFirst: idx.indexOf('if (_guideFlags()[_guideSeenFlagKey(id)]) return true;') >= 0,
    /* the replay button is still always mounted — this is what "unless they
       click the button" depends on */
    replayFabStillThere: idx.indexOf('_mountGuideReplayFab') >= 0,
    /* nothing writes the seen/off keys outside the two helpers any more */
    noStrayLocalWrites: (idx.match(/setItem\(_guideDoneKey/g) || []).length === 1
                     && (idx.match(/setItem\(_guideOffKey/g) || []).length === 1,
  };
}

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
if (!out.newPlayerNotBackfilled) F.push('a brand-new account was marked as having seen the guides — it should still get them');
if (!out.establishedBackfilled) F.push('an established account was not backfilled, so it gets the tour one more time');
if (!out.backfillMarkerSet) F.push('the backfill left no marker, so it would run again');
if (!out.backfillRunsOnce) F.push('the backfill ran twice — a guide published later would be suppressed unseen');
if (!out.hasHelpers) F.push('the account-backed helpers are missing');
if (!out.freshAccountSaysUnseen) F.push('a fresh account already reads as having seen it');
if (!out.accountFlagSet) F.push('marking a guide seen did not write the account');
if (!out.doneAfterMark) F.push('marking a guide seen did not take');
if (!out.survivesACacheWipe) F.push('a cleared cache made the account forget — this is the whole bug');
if (!out.deviceStillCounts) F.push('a signed-out player lost their local memory of the guide');
if (!out.previewClearsAccount) F.push('the admin preview left the account flag set');
if (!out.previewClearsDevice) F.push('the admin preview left the device flag set');
if (!out.offReachesAccount) F.push('the do-not-show box did not reach the account');
if (!out.offIsRead) F.push('the do-not-show flag is not read back');
if (!out.offCanBeCleared) F.push('the do-not-show flag cannot be turned off again');
for (const [k, v] of Object.entries(out.src)) if (!v) F.push('source rule failed: ' + k);
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · the account remembers, a seen guide never auto-plays again, and the button still replays it');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
