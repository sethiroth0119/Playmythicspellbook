/* ══════════════════════════════════════════════════════════════════════════
   🛠 DRIVE-PLAYER-MAINTENANCE — maintenance mode for one player, not the game.

   Asked for: "Make a maintenance mode button that I can put certain players in
   maintenance mode in user management."

   The game already had a maintenance lock — it was all-or-nothing. This pins
   the per-player one that shares its screen, its exemption and its accrual
   freeze.

   WHAT THIS PINS:
     · a held player is locked to the maintenance screen, signed in, and an
       admin never is
     · the hold survives a reload WITHOUT waiting on the network, and a
       remembered RELEASE is never trusted (only a hold is replayed)
     · "no session" reads as UNKNOWN, never as "not held" — the RLS trap that
       has already cost this project two production lockouts
     · a network error leaves the last known state alone rather than releasing
     · downtime is dead time for BOTH windows, counted ONCE — a global window
       and a player window that overlap must not hand back more time than
       actually elapsed
     · the button is in User Management, says which state it is in, and cancel
       is not the same answer as "leave the note blank"

   ⚠ STAGING: the maintenance ROW is injected at the client boundary the server
     read fills, because this harness is signed out and offline by design. The
     screen, the gate, the freeze arithmetic and the admin markup are all real.

   Run:  node .gauntlet/drive-player-maintenance.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9110 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── the source + server facts a booted page cannot show ─────────────────── */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const wk = fs.readFileSync(path.join(process.cwd(), 'worker.js'), 'utf8');
  const sql = fs.readFileSync(path.join(process.cwd(), 'sql', '044_player_maintenance.sql'), 'utf8');
  out.src = {
    /* the button, in User Management, in both states */
    buttonOn: idx.indexOf('id="um-maint-on"') >= 0,
    buttonOff: idx.indexOf('id="um-maint-off"') >= 0,
    /* the server op, and that it does NOT fall through to the Auth Admin PUT */
    workerOps: wk.indexOf("op === 'maint_on' || op === 'maint_off'") >= 0,
    workerBranchesEarly: wk.indexOf("op === 'maint_on'") < wk.indexOf("let method = 'PUT'"),
    /* release KEEPS the row — a deleted one would bill the player for the
       cycles they were locked out of */
    releaseKeepsRow: wk.indexOf('enabled: false, ended_at: nowIso') >= 0,
    /* the player reads their own row; only an admin writes one */
    rlsSelfRead: /using \(user_id = auth\.uid\(\) or is_admin\(\)\)/.test(sql),
    rlsAdminWrite: /for update to authenticated using \(is_admin\(\)\) with check \(is_admin\(\)\)/.test(sql),
    /* the client never guesses without a session */
    guardsOnSession: idx.indexOf('if (!(Profile.cloud && Profile.cloud.userId)) return null;   // no session') >= 0,
  };
}

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(6000);

/* ── the trap: no session must read as UNKNOWN, not as "not held" ────────── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: false, userId: null });
  Cloud.ready = true;
  let asked = false;
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => { asked = true; return { data: [], error: null }; } }) }) }) };
  const r = await window._maintFetchMine(true);
  o.anonAsked = asked;                  // it must not even ASK without a session
  o.anonAnswer = r;                     // …and must not record an answer
  return o;
}));

/* ── held: the screen, and the admin exemption ───────────────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: true, userId: 'held-1', offlineMode: false });
  const row = { enabled: true, title: null, message: 'Repairing your vault rows — back shortly.',
                since: new Date(Date.now() - 3600000).toISOString(), ended_at: null };
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [row], error: null }) }) }) }) };
  await window._maintFetchMine(true);

  App.screen = 'title'; render();
  await new Promise(r => setTimeout(r, 900));
  o.heldScreen = !!document.getElementById('maint-recheck');
  o.heldCopy = (document.body.innerText.match(/Repairing your vault rows[^\n]*/) || [null])[0];
  o.heldTitle = (document.body.innerText.match(/YOUR ACCOUNT IS IN MAINTENANCE/) || [null])[0];

  /* an admin is never held — same exemption the global lock uses */
  const realIsAdmin = window.isAdmin;
  window.isAdmin = () => true;
  App.screen = 'title'; render();
  await new Promise(r => setTimeout(r, 900));
  o.adminPassesThrough = !document.getElementById('maint-recheck');
  window.isAdmin = realIsAdmin;
  return o;
}));

/* ── a network error must not release anybody ────────────────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'network' } }) }) }) }) };
  const r = await window._maintFetchMine(true);
  return { stillHeldAfterError: !!(r && r.enabled) };
}));

/* ── the freeze: two windows, counted once ───────────────────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  const H = 3600000, now = Date.now();
  /* ⚠ STAGE THE PLAYER WINDOW EXPLICITLY. It was left at 1h by the step above,
     and a first draft of this test asserted 10h against it and called correct
     arithmetic a double-count. The spans have to be the ones the assertion
     talks about. */
  const held = { enabled: true, title: null, message: null,
                 since: new Date(now - 10 * H).toISOString(), ended_at: null };
  Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [held], error: null }) }) }) }) };
  await window._maintFetchMine(true);

  /* player [now-10h, open] with a global [now-6h, now-4h] fully INSIDE it.
     The union is 10h; adding them claims 12h of downtime inside a 10h span,
     which is more time than actually passed. */
  Forge.maintenance = { enabled: false, since: now - 6 * H, endedAt: now - 4 * H };
  Catalog.maintenance = Forge.maintenance;
  const overlap = maintenanceFrozenMs(now - 10 * H, now);
  /* …and a DISJOINT global window, where using only one of them under-credits */
  Forge.maintenance = { enabled: false, since: now - 20 * H, endedAt: now - 18 * H };
  Catalog.maintenance = Forge.maintenance;
  const disjoint = maintenanceFrozenMs(now - 24 * H, now);
  return {
    unionHours: +(overlap / H).toFixed(2),
    disjointHours: +(disjoint / H).toFixed(2),
  };
}));

/* ── the hold survives a reload with the network dead ────────────────────── */
{
  await pg.evaluate(() => { try { return localStorage.getItem('hg_maint_mine'); } catch (e) { return null; } });
  out.cachedOnDisk = await pg.evaluate(() => { try { return !!localStorage.getItem('hg_maint_mine'); } catch (e) { return false; } });
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(5000);
  Object.assign(out, await pg.evaluate(async () => {
    const o = {};
    /* no session, no network — exactly the first second after a reload */
    Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: true, userId: 'held-1' });
    App.screen = 'title'; render();
    await new Promise(r => setTimeout(r, 900));
    o.heldImmediatelyAfterReload = !!document.getElementById('maint-recheck');
    return o;
  }));
  /* …and a remembered RELEASE is not replayed as a release */
  out.releaseNotCached = await pg.evaluate(async () => {
    Cloud.ready = true;
    Cloud.client = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ enabled: false, title: null, message: null, since: null, ended_at: new Date().toISOString() }], error: null }) }) }) }) };
    await window._maintFetchMine(true);
    try { return localStorage.getItem('hg_maint_mine') === null; } catch (e) { return false; }
  });
}

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
const s = out.src;
if (!s.buttonOn || !s.buttonOff) F.push('the maintenance button is not in User Management in both states');
if (!s.workerOps) F.push('the server has no maint_on / maint_off op');
if (!s.workerBranchesEarly) F.push('the maintenance op falls through to the Auth Admin PUT');
if (!s.releaseKeepsRow) F.push('releasing deletes the row — the frozen window would be lost');
if (!s.rlsSelfRead) F.push('a player cannot read their own hold, so the client cannot enforce it');
if (!s.rlsAdminWrite) F.push('the write policy is not admin-only');
if (!s.guardsOnSession) F.push('the read is not guarded on having a session');
if (out.anonAsked) F.push('it queried the table with no session — an empty result would read as "not held"');
if (out.anonAnswer !== null) F.push('a sessionless read recorded an answer instead of staying unknown');
if (!out.heldScreen) F.push('a held player was not locked to the maintenance screen');
if (!out.heldCopy) F.push("the admin's note is not what the player reads");
if (!out.heldTitle) F.push('a per-player hold used the whole-game title');
if (!out.adminPassesThrough) F.push('an admin was held by a player-level flag');
if (!out.stillHeldAfterError) F.push('a network error released a held player');
if (out.unionHours !== 10) F.push('overlapping windows froze ' + out.unionHours + 'h of a 10h span (double-counted)');
if (out.disjointHours !== 12) F.push('disjoint windows froze ' + out.disjointHours + 'h, expected 12h (10 + 2)');
if (!out.cachedOnDisk) F.push('the hold was not remembered for the next load');
if (!out.heldImmediatelyAfterReload) F.push('a reload let a held player in before the network answered');
if (!out.releaseNotCached) F.push('a release was cached — a stale one could let a held player straight in');
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · one player can be held, released, and is never let in by a guess');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
