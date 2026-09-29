/* 🔁 LIVE CROSS-DEVICE SYNC — the fast half (no browser, ~1 s).

   Owner, 2026-09-18, with a screenshot of the banner "☁ This account was saved
   on another device — merged that progress with the progress on this device
   before saving.": make the merge automatic, show nothing, and let the same
   account open on two devices converge in the background.

   The browser half is .gauntlet/drive-live-sync.mjs (two real devices on a
   fake Supabase). This pins the wiring that suite would take minutes to show:
     1  SILENCE — no player-facing text about another device in the sync path;
        the conflict is logged with console.info; the retry wrapper keeps a
        conflict off the orange error pill.
     2  THE BACKGROUND FETCH — cloudFetchProfile({background}) makes its
        stand-down checks BEFORE it replaces the CAS base, takes the merge
        branch, skips the web-purchase writer and the sprite fetch, and a
        finally puts the freshness inputs back; the two schedulers that a
        merge's own saves reach (_scheduleCloudSync, _adminAutoPublish) refuse
        while it runs.
     3  THE PULL, RUN — _profileLivePull() and _livePullBusy() are cut out of the
        page and run in a vm against a fake Cloud: an own unsent edit, a busy
        player and an unchanged row each cost at most one probe and never a
        fetch; a moved row fetches with {background:true} exactly once.
     4  THE SCHEDULE — 20–30 s jittered, paused while hidden, restarted on
        visible / focus / online; no setInterval (a paused tab must not tick).
   NEGATIVE CONTROL: section 1 run against the pinned pre-change page
   (4237de9973, git show with core.eol=lf) must fail — the banner is there.

   Run: node _livesync_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import vm from 'vm';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; return !!c; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(src, name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  return '';
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

/* ── 1. silence ─────────────────────────────────────────────────────────── */
function silence(src, quiet) {
  const r = [];
  const t = (c, m) => { r.push(c); if (!quiet) ok(c, m); };
  const once = stripComments(fnText(src, '_cloudSyncProfileOnce'));
  const fetch = stripComments(fnText(src, 'cloudFetchProfile'));
  const retry = stripComments(fnText(src, '_runCloudSyncWithRetry'));
  t(once.length > 1000, 'the upload body (_cloudSyncProfileOnce) was found');
  const toastLines = once.split('\n').filter((l) => /showToast\s*\(/.test(l) && /another device|merged|at the same moment/i.test(l));
  t(!toastLines.length, 'the upload body shows NO toast about another device / a merge');
  const errStrings = (once.match(/error:\s*(['"`])(?:(?!\1).)*\1/g) || []).filter((s) => /another device/i.test(s));
  t(!errStrings.length, 'no conflict error string that a "Sync now" button would print mentions another device');
  t(/console\.info\([^)]*another device/.test(once), 'the conflict is still logged (console.info) for debugging');
  t(!/console\.warn\([^)]*Cloud row changed on another device/.test(once), 'and not as a console.warn (it is routine, not a fault)');
  t(!fetch.split('\n').some((l) => /showToast\s*\(/.test(l) && /another device|merged/i.test(l)), 'the fetch/merge shows no toast about another device either');
  const iConf = retry.indexOf('result.conflict'), iErr = retry.indexOf("_setSaveStatus('error'");
  t(iConf > 0 && iErr > iConf, 'the retry wrapper handles a conflict BEFORE it would light the orange error pill');
  t(/_casRetry:\s*_casRound\s*\+\s*1/.test(once) && /_casRound\s*>=\s*3/.test(once), 'a conflict gets up to three silent merge-and-push rounds in one call');
  return r.every(Boolean);
}
console.log('\n  ── 1. silence');
silence(SRC, false);

/* ── 2. the background fetch ────────────────────────────────────────────── */
console.log('\n  ── 2. cloudFetchProfile({ background })');
{
  const f = fnText(SRC, 'cloudFetchProfile');
  const iAwait = f.indexOf('await Cloud.client');
  const iBg = f.indexOf('if (_bg) {', iAwait);
  const iBase = f.indexOf('_setProfileRowBase(');
  ok(iAwait > 0 && iBg > iAwait && iBase > iBg, 'the background stand-down checks run after the one await and BEFORE the CAS base is replaced');
  const bg = f.slice(iBg, iBase);
  ok(/pendingChanges/.test(bg) && /_profileEditSeq/.test(bg) && /_cloudSyncTimer/.test(bg) && /_cloudSyncInFlight/.test(bg) && /_cloudSyncActive/.test(bg),
    'it stands down on an own unsent edit (pending, edit counter, armed timer, sync in flight or queued)');
  ok(/data\.updated_at === _b\.at/.test(bg) && /unchanged: true/.test(bg), 'an unchanged row is a no-op');
  ok(/_foreignProfile/.test(bg) && /_forceRestoreFromCloud/.test(bg) && /_cloudRowHasProgress\(data\)/.test(bg), 'never on a foreign / force-restore / blank row');
  ok(/_profileBgMerge = true/.test(bg) && /_saveProfileLocalOnly = true/.test(bg), 'the merge runs with the cloud timer off');
  ok(/opts\.casMerge \|\| opts\.background/.test(f), 'a background pull takes the merge branch (same per-field rules as every fetch)');
  ok(/if \(!_bg && Array\.isArray\(f\.webPurchases\)/.test(f), 'the web-purchase redeemer (which writes the row itself) is not run from a background pull');
  ok(/if \(!_bg && typeof cloudFetchSprites/.test(f), 'nor the sprite download');
  const fin = f.slice(f.lastIndexOf('finally {'));
  ok(/_profileBgMerge = false/.test(fin) && /_saveProfileLocalOnly = false/.test(fin) && /lastLocalEditAt = _bgPrev\.edit/.test(fin) && /pendingChanges = _bgPrev\.pending/.test(fin),
    'a finally restores the flags and the freshness inputs (a background merge is not an edit)');
  const sch = fnText(SRC, '_scheduleCloudSync'), pub = fnText(SRC, '_adminAutoPublish');
  // The first statement (a leading `try {` does not count as one).
  const first = (s) => stripComments(s).split('\n').slice(1).filter((l) => l.trim() && !/^\s*try\s*\{\s*$/.test(l))[0];
  ok(/_profileBgMerge/.test(first(sch) || ''), '_scheduleCloudSync refuses first thing during a background merge (saveForge/saveLab reach it)');
  ok(/_profileBgMerge/.test(first(pub) || ''), '_adminAutoPublish refuses first thing too (an admin\'s pull must not publish the catalog)');
}

/* ── 3. the pull, run ───────────────────────────────────────────────────── */
console.log('\n  ── 3. _profileLivePull() in a vm');
async function runPull(o) {
  const calls = { probe: 0, fetch: [] };
  const doc = { hidden: !!o.hidden, activeElement: o.active || null, querySelector: (s) => (o.modal && s === '.modal-backdrop' ? {} : null) };
  const ctx = {
    console: { info() {}, warn() {}, log() {} }, document: doc, navigator: { onLine: true }, Date, JSON, Math, String, Object, Promise, setTimeout, clearTimeout,
    Profile: { cloud: Object.assign({ signedIn: true, userId: 'u1', _hydratedFromCloud: true, pendingChanges: false }, o.cloud || {}), heroes: {} },
    App: { screen: o.screen || 'mainMenu' }, MultiTab: { amWriter: true },
    _profileRowBase: { uid: 'u1', at: 'T1' }, _cloudSyncTimer: o.timer || null, _cloudSyncInFlight: false, _cloudSyncActive: 0, _casRefetching: false, _profileEditSeq: 5,
    Cloud: { client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { calls.probe++; return { data: { updated_at: o.cloudAt || 'T1' }, error: null }; } }) }) }) } },
    cloudFetchProfile: async (opts) => { calls.fetch.push(opts); ctx.Profile.heroes = { changed: 1 }; return { ok: true, merged: true }; },
    render: () => { calls.render = (calls.render || 0) + 1; },
  };
  vm.createContext(ctx);
  const code = ['const PROFILE_LIVE_PULL_MIN_MS = 20000, PROFILE_LIVE_PULL_JITTER_MS = 10000, PROFILE_LIVE_PULL_RETRY_MS = 4000;',
    'var _livePull = { timer: null, inFlight: false, lastRun: 0, lastInputAt: ' + (o.recentInput ? 'Date.now()' : '0') + ', pointerDown: ' + !!o.drag + ', renderPending: false, stats: { probes: 0, fetches: 0, merges: 0, deferred: 0, renders: 0 }, last: null };',
    fnText(SRC, '_livePullBusy'), fnText(SRC, '_livePullSig'), fnText(SRC, '_livePullRender'), fnText(SRC, '_profileLivePull'),
    'globalThis.__run = _profileLivePull;'].join('\n');
  vm.runInContext(code, ctx);
  const r = await ctx.__run('smoke');
  return { r, calls };
}
{
  const has = ['_livePullBusy', '_livePullSig', '_livePullRender', '_profileLivePull'].every((n) => fnText(SRC, n).length > 50);
  ok(has, 'the four pull functions are in the page');
  if (has) {
    let x = await runPull({ cloudAt: 'T2' });
    ok(x.calls.probe === 1 && x.calls.fetch.length === 1 && x.calls.fetch[0].background === true && x.r.merged && x.calls.render === 1,
      'a moved row: one probe, one background fetch, one re-render', JSON.stringify(x));
    x = await runPull({ cloudAt: 'T1' });
    ok(x.calls.probe === 1 && !x.calls.fetch.length && x.r.unchanged, 'an unchanged row: one probe, no fetch', JSON.stringify(x));
    x = await runPull({ cloudAt: 'T2', cloud: { pendingChanges: true } });
    ok(!x.calls.probe && !x.calls.fetch.length && x.r.skipped === 'local-edit', 'an own unsent edit: not even a probe (the push owns it)', JSON.stringify(x));
    x = await runPull({ cloudAt: 'T2', timer: 1 });
    ok(!x.calls.fetch.length && x.r.skipped === 'local-edit', 'an armed upload timer: stands down', JSON.stringify(x));
    const busy = [
      ['typing', { active: { tagName: 'INPUT' } }], ['typing', { active: { tagName: 'DIV', isContentEditable: true } }],
      ['dragging', { drag: true }], ['interacting', { recentInput: true }], ['battle', { screen: 'battle' }],
      ['battle', { screen: 'coinFlip' }], ['modal', { modal: true }], ['hidden', { hidden: true }],
    ];
    for (const [why, o] of busy) {
      x = await runPull(Object.assign({ cloudAt: 'T2' }, o));
      ok(!x.calls.fetch.length && !x.calls.render && x.r.deferred === why, 'player busy (' + why + '): deferred, no fetch, no render', JSON.stringify(x));
    }
    x = await runPull({ cloudAt: 'T2', cloud: { signedIn: false } });
    ok(!x.calls.probe && x.r.skipped === 'signed-out', 'signed out: nothing', JSON.stringify(x));
  }
}

/* ── 4. the schedule ────────────────────────────────────────────────────── */
console.log('\n  ── 4. the schedule');
{
  const i = SRC.indexOf('(function _installProfileLivePull()');
  const inst = i > 0 ? SRC.slice(i, SRC.indexOf('})();', i) + 5) : '';
  ok(inst.length > 200, 'the installer is in the page');
  ok(/PROFILE_LIVE_PULL_MIN_MS = 20000/.test(SRC) && /PROFILE_LIVE_PULL_JITTER_MS = 10000/.test(SRC), 'interval 20 s + up to 10 s jitter');
  ok(!/setInterval/.test(inst) && !/setInterval/.test(fnText(SRC, '_livePullTick')), 'self-rescheduling timeout, never setInterval');
  ok(/document\.hidden\)\s*return/.test(fnText(SRC, '_livePullTick')), 'a tick in a hidden tab does nothing and does not re-arm');
  ok(/visibilitychange/.test(inst) && /clearTimeout\(_livePull\.timer\)/.test(inst), 'hiding the tab cancels the timer');
  ok(/'focus'/.test(inst) && /'online'/.test(inst) && /else _livePullSoon\(/.test(inst), 'visible / focus / online each pull soon');
  ok(!/supabase_realtime|\.channel\(/.test(inst + fnText(SRC, '_profileLivePull')), 'no realtime subscription (user_profiles is not in the publication; polling ships)');
}

/* ── negative control ───────────────────────────────────────────────────── */
console.log('\n  ── NEG: section 1 against the pinned pre-change page (4237de9973)');
{
  let pre = '';
  try { pre = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', '4237de9973:public/index.html'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); } catch (e) {}
  ok(pre.length > 1e6, 'the pre-change page was read from git');
  if (pre) ok(!silence(pre, true), 'NEG: the silence checks FAIL on the pre-change page (it shows the banner)');
}

console.log('\n  ' + passes + ' passed, ' + fails + ' failed');
console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\nALL PASS');
process.exit(fails ? 1 : 0);
