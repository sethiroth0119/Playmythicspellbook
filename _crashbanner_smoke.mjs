/* 🩸 bug-mtyl7vad — "Keeps showing last session ended in a crash every time I
   open the game up".

   The crash detector in public/index.html writes hg_clean_exit='0' at boot and
   only pagehide/beforeunload flipped it back to '1'. Neither fires when a phone
   swipes the app away, when Chrome's Memory Saver discards a background tab, or
   for a SECOND tab of the game reading the live one's '0'. So an ordinary close
   read as a crash on every open.

   What is pinned here, against the REAL block lifted out of index.html (from
   `function _showCrashTrailBanner(` to the end of the crumb recorder) and run in
   a simulated browser whose localStorage survives between "sessions":
     1. a session that dies while VISIBLE still shows the banner — the negative
        control: the detector is not simply switched off
     2. a session hidden first (swiped away / backgrounded, then killed) does not
     3. a pagehide exit does not
     4. a tab reloaded after a Memory Saver discard (document.wasDiscarded) does not
     5. a second tab opened while the first is alive does not (BroadcastChannel)
     6. hidden → shown again → dies visible: re-armed, banner shows
     7. bfcache restore (pageshow persisted) re-arms too
     8. a tab that boots hidden (opened in the background) is not "running"
     9. HEAD control (only while HEAD still carries the old block): the OLD code
        shows the banner for scenario 2 — the bug, reproduced.

   Run: node _crashbanner_smoke.mjs */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };

function lift(src) {
  const i = src.indexOf('function _showCrashTrailBanner(');
  if (i < 0) throw new Error('no _showCrashTrailBanner');
  const k = src.indexOf('window.__mg.crumbs', i);
  if (k < 0) throw new Error('no crumb recorder end');
  const endMark = '\n} catch (e) {}';
  const j = src.indexOf(endMark, k);
  return src.slice(i, j + endMark.length);
}

/* ---- a tiny browser: one shared localStorage + BroadcastChannel bus ---- */
function makeWorld() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const channels = [];
  const queue = [];
  class BroadcastChannel {
    constructor(name) { this.name = name; this.onmessage = null; this.closed = false; channels.push(this); }
    postMessage(data) {
      for (const c of channels) if (c !== this && c.name === this.name && !c.closed) queue.push(() => { if (!c.closed && c.onmessage) c.onmessage({ data }); });
    }
    close() { this.closed = true; }
  }
  const pump = () => { let n = 0; while (queue.length && n++ < 100) queue.shift()(); };
  return { store, localStorage, BroadcastChannel, channels, pump };
}

function boot(world, code, opts = {}) {
  const docL = {}, winL = {}, timers = [], appended = [];
  const document = {
    visibilityState: opts.hidden ? 'hidden' : 'visible',
    wasDiscarded: !!opts.discarded,
    body: { appendChild: (el) => appended.push(el) },
    getElementById: (id) => appended.find((e) => e.id === id) || null,
    createElement: () => ({ style: {}, set innerHTML(v) { this._h = v; }, remove() {} }),
    addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
  };
  const window = { addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); } };
  const myChannels = [];
  const BC = class extends world.BroadcastChannel { constructor(n) { super(n); myChannels.push(this); } };
  const setTimeout = (f) => { timers.push(f); return timers.length; };
  const setInterval = () => 0;   // the crumb ticker — irrelevant here
  const quiet = { warn() {}, log() {}, error() {}, info() {} };
  const fn = new Function('localStorage', 'document', 'window', 'BroadcastChannel', 'setTimeout', 'setInterval', 'console', 'navigator',
    code + '\n;');
  fn(world.localStorage, document, window, opts.noBC ? undefined : BC, setTimeout, setInterval, quiet, {});
  const s = {
    document,
    fireDoc(t) { (docL[t] || []).forEach((f) => f({})); },
    fireWin(t, ev) { (winL[t] || []).forEach((f) => f(ev || {})); },
    hide() { document.visibilityState = 'hidden'; this.fireDoc('visibilitychange'); },
    show() { document.visibilityState = 'visible'; this.fireDoc('visibilitychange'); },
    kill() { myChannels.forEach((c) => c.close()); },   // no events: the process just ends
    settle() { world.pump(); timers.splice(0).forEach((f) => f()); world.pump(); },
    banner() { return appended.some((e) => e.id === 'crash-trail-banner'); },
  };
  return s;
}
const TRAIL = JSON.stringify([{ t: 3, scr: 'title', mb: 80, pct: 9 }, { t: 6, scr: 'title', mb: 82, pct: 9 }]);
function nextBoot(world, code, opts) { world.store.set('hg_crumbs', TRAIL); const s = boot(world, code, opts); s.settle(); return s; }

const SRC = readFileSync('./public/index.html', 'utf8');
const CODE = lift(SRC);
ok(/visibilitychange/.test(CODE) && /hg_session_alive/.test(CODE), 'the lifted block is the fixed one (visibility checkpoint + sibling channel)');

function scenario(code, script) {
  const w = makeWorld();
  const a = boot(w, code); a.settle();
  script(w, a);
  return w;
}

console.log('\n=== 1. NEGATIVE CONTROL: dying while visible is still a crash ===');
{ const w = scenario(CODE, (w, a) => a.kill()); const b = nextBoot(w, CODE); ok(b.banner(), 'banner shown after a foreground crash'); }

console.log('\n=== 2. hidden, then killed (app swiped away) ===');
{ const w = scenario(CODE, (w, a) => { a.hide(); a.kill(); }); const b = nextBoot(w, CODE); ok(!b.banner(), 'no banner after a background kill'); }

console.log('\n=== 3. pagehide exit ===');
{ const w = scenario(CODE, (w, a) => { a.fireWin('pagehide'); a.kill(); }); const b = nextBoot(w, CODE); ok(!b.banner(), 'no banner after a clean pagehide'); }

console.log('\n=== 4. Memory Saver discard, then reload ===');
{ const w = scenario(CODE, (w, a) => { a.kill(); }); const b = nextBoot(w, CODE, { discarded: true }); ok(!b.banner(), 'no banner when document.wasDiscarded'); }

console.log('\n=== 5. a second tab while the first is alive ===');
{
  const w = makeWorld();
  const a = boot(w, CODE); a.settle();            // tab A: alive, visible, flag '0'
  ok(w.store.get('hg_clean_exit') === '0', 'tab A marked running');
  const b = nextBoot(w, CODE);                     // tab B opens beside it
  ok(!b.banner(), 'tab B does not report its live sibling as crashed');
  // …and the veto is really the sibling's answer: with no sibling, same state shows.
  a.kill();
  const c = nextBoot(w, CODE);
  ok(!c.banner(), 'tab C after A closed but B still alive: B answers, no banner');
  const w2 = makeWorld(); const a2 = boot(w2, CODE); a2.settle(); a2.kill();
  const d = nextBoot(w2, CODE);
  ok(d.banner(), 'control: same flag, no sibling alive → banner');
}

console.log('\n=== 6. hidden → shown → dies visible ===');
{ const w = scenario(CODE, (w, a) => { a.hide(); a.show(); a.kill(); }); const b = nextBoot(w, CODE); ok(b.banner(), 're-armed on show: banner shown'); }

console.log('\n=== 7. bfcache restore re-arms ===');
{ const w = scenario(CODE, (w, a) => { a.fireWin('pagehide'); a.fireWin('pageshow', { persisted: true }); a.kill(); }); const b = nextBoot(w, CODE); ok(b.banner(), 'restored from bfcache then crashed: banner shown'); }

console.log('\n=== 8. booted hidden ===');
{ const w = makeWorld(); const a = boot(w, CODE, { hidden: true }); a.settle(); ok(w.store.get('hg_clean_exit') === '1', 'a tab opened in the background is not "running"'); a.kill(); const b = nextBoot(w, CODE); ok(!b.banner(), 'and its death is no crash'); }

console.log('\n=== 9. HEAD control (the bug, reproduced) ===');
{
  let head = null;
  try { head = execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'show', 'HEAD:public/index.html'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) {}
  const old = head ? lift(head) : null;
  if (!old || /hg_session_alive/.test(old)) console.log('  (skipped: HEAD already carries the fix)');
  else {
    const w = scenario(old, (w, a) => { a.hide(); a.kill(); });
    const b = nextBoot(w, old);
    ok(b.banner(), 'OLD code: a background kill IS reported as a crash (what the player saw)');
  }
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
