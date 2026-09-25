/* ══════════════════════════════════════════════════════════════════════════
   🔔 DRIVE-NOTIFY-BELL — the passive alerts stop covering the screen.

   THE REPORT: "Move this notification into a bell button above and only show it
   in a modal, so it won't annoy and block things from players." The message was
   "⚠ Camp ran out of Fuel — deposit supplies to recover.", and it came through
   showToast — one fixed bar painted over whatever the player was reading, by a
   status check the player never asked to run.

   The split being pinned here is WHO STARTED IT:

     · notify(…)    — the game noticed something. Goes to the bell. Covers
                      NOTHING: no toast is created at all.
     · showToast(…) — the player pushed a button and this is the answer.
                      CONTROL: still paints, exactly as before.

   And the behaviour that makes the bell usable rather than a second nuisance:

     · the badge counts what has not been read, and opening it IS reading
     · the modal lists what arrived; Clear all empties it
     · a REPEATED message collapses to ×N instead of stacking — the camp
       re-derives its status on a timer, so "out of Fuel" would otherwise fill
       the bell with eleven identical rows
     · the camp shortage itself now takes this path — driven through the real
       _campAwayAlert(), not by calling notify() and calling that a test

   Run:  node .gauntlet/drive-notify-bell.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8790 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof notify === "function" && typeof showToast === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof notify === 'function' && typeof showToast === 'function' && !!window.MythicNotify;
  if (!o.reachable) return o;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const killToasts = () => { document.querySelectorAll('.toast').forEach(t => t.remove()); };
  const toastCount = () => document.querySelectorAll('.toast').length;

  /* ZERO THE BELL FIRST. The page boots, the camp checks itself, and a real
     shortage alert is already waiting — which is the feature working, but it
     makes every count below off by one. Cleared through the modal button, so
     the reset is the same path a player uses. */
  notifOpen();
  try { document.getElementById('notif-clear').click(); } catch (e) {}
  notifClose();
  await sleep(30);
  o.baseline = MythicNotify.state().count;

  // ── 1 · a notify covers nothing ─────────────────────────────────────────
  killToasts(); notifClose();
  notify('⚠ Camp ran out of Fuel — deposit supplies to recover.', { tone: 'warn' });
  await sleep(60);
  o.toastAfterNotify = toastCount();                       // must be 0
  o.bellExists = !!document.getElementById('notif-bell');
  o.state1 = MythicNotify.state();

  // CONTROL: a direct answer to a button still paints, untouched.
  showToast('🎒 Field bag acquired', 4000);
  await sleep(60);
  o.toastAfterShowToast = toastCount();                    // must be 1
  killToasts();

  // ── 2 · the badge counts, and opening it reads ──────────────────────────
  notify('A second thing happened.');
  await sleep(30);
  o.unreadBefore = MythicNotify.state().unread;            // 2
  const badge = document.getElementById('notif-badge');
  o.badgeText = badge ? badge.textContent : null;
  document.getElementById('notif-bell').click();
  await sleep(60);
  o.modalOpen = !!document.getElementById('notif-modal');
  o.rows = document.querySelectorAll('#notif-list .notif-row').length;
  o.unreadAfterOpen = MythicNotify.state().unread;         // 0 — opening is reading
  o.listText = (document.getElementById('notif-list') || {}).textContent || '';

  // ── 3 · a repeat collapses instead of stacking ──────────────────────────
  notify('A second thing happened.');
  notify('A second thing happened.');
  await sleep(40);
  o.rowsAfterRepeat = document.querySelectorAll('#notif-list .notif-row').length;
  o.collapsed = /×3/.test((document.getElementById('notif-list') || {}).textContent || '');

  // ── 4 · Clear all empties it ────────────────────────────────────────────
  document.getElementById('notif-clear').click();
  await sleep(40);
  o.rowsAfterClear = document.querySelectorAll('#notif-list .notif-row').length;
  o.stateAfterClear = MythicNotify.state();
  o.emptyNote = !!document.querySelector('#notif-list .notif-empty');
  notifClose();
  o.modalClosed = !document.getElementById('notif-modal');

  /* ── 5 · THE REPORTED MESSAGE ITSELF, through its own code path ─────────
     _campAwayAlert() reads campStatus() and fires at most once per shortage
     transition, so the status is stubbed and the transition latch cleared —
     everything after that is the shipped function. */
  killToasts();
  try {
    window.campStatus = () => ({ state: 'critical', out: ['fuel'] });
    App._campStatusSig = null;
    _campAwayAlert();
    await sleep(60);
    o.campToast = toastCount();                            // must be 0
    o.campBell = MythicNotify.state();
  } catch (e) { o.campError = String(e).slice(0, 180); }
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('notify / showToast / MythicNotify are not reachable on the page');
else {
  need('a notify paints NO toast over the screen', out.toastAfterNotify === 0, out.toastAfterNotify);
  need('…and the bell exists to hold it', out.bellExists, out);
  need('…with the message in it', out.state1 && out.state1.count === 1 && /Camp ran out of Fuel/.test(out.state1.latest || ''), out.state1);
  need('CONTROL: showToast still paints (direct feedback is untouched)', out.toastAfterShowToast === 1, out.toastAfterShowToast);
  need('the badge counts the unread', out.unreadBefore === 2 && out.badgeText === '2', { unread: out.unreadBefore, badge: out.badgeText });
  need('clicking the bell opens the modal', out.modalOpen, out);
  need('…listing both messages', out.rows === 2, out.rows);
  need('…including the camp one', /Camp ran out of Fuel/.test(out.listText || ''), (out.listText || '').slice(0, 120));
  need('opening it marks them read', out.unreadAfterOpen === 0, out.unreadAfterOpen);
  need('a repeated message collapses instead of stacking', out.rowsAfterRepeat === 2, out.rowsAfterRepeat);
  need('…and says how many times', out.collapsed, out);
  need('Clear all empties the list', out.rowsAfterClear === 0 && out.stateAfterClear.count === 0, out.stateAfterClear);
  need('…and says so', out.emptyNote, out);
  need('the modal closes', out.modalClosed, out);
  need('THE REPORTED ONE: the camp shortage paints no toast', out.campToast === 0, out.campToast);
  need('…and lands in the bell instead', !!(out.campBell && /Camp ran out of Fuel/.test(out.campBell.latest || '')), out.campBell);
  need('the camp path did not throw', !out.campError, out.campError);
}

console.log(JSON.stringify({ ...out, listText: undefined, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the camp alert waits in the bell and covers nothing; a button\'s own answer still appears at once.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
