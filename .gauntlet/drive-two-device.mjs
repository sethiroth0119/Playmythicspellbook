/* ══════════════════════════════════════════════════════════════════════════
   🔁 DRIVE-TWO-DEVICE — one account open on several devices: an idle device
   stays quiet, and a device that is behind cannot write over a newer edit.

   THE BUG. A successful cloudSyncProfile() ended in saveProfile(), which
   re-armed the 2 s cloud timer, so every signed-in tab uploaded its WHOLE
   user_profiles row every ~2 s forever (live pg_stat 2026-09-17: 5.46M updates
   on 129 rows). The upload was a blind upsert and no live trigger checks for a
   stale write, so a device that fetched before another device's edit wrote its
   older copy back within one cycle. drive-account-isolation.mjs reported this
   as an uncounted FINDING ("device 3's late edit: LOST"). Here it is counted.

   HOW. Same rig as drive-account-isolation.mjs (copied, because importing that
   file RUNS it): the real public/index.html in Playwright contexts (one context
   = one device), the page's own supabase-js, and every request to the project
   host answered by an in-process fake that all contexts share. The fake models
   what the fix relies on, as the live database does it:
     · user_profiles_touch: the SERVER stamps updated_at on every insert/update
       (a Postgres-shaped, microsecond, strictly increasing string), whatever
       the client sent;
     · PATCH honours every eq. filter (user_id AND updated_at) and returns the
       matched rows for return=representation — zero rows = the CAS lost;
     · POST without resolution=merge-duplicates is an INSERT: 409 / 23505 when
       the row exists; with it, an upsert;
     · RLS auth.uid() = user_id on every write (a refusal is itself a FAIL).
   Every write to user_profiles is logged per device, so "uploads" is a count.

   CHECKS
     I1  one tab signed in, no input for 60 s: at most 1 upload (HEAD: ~30).
     S2  device 1 plays + syncs; devices 2 and 3 sign in; all three idle 20 s
         (at most 1 upload each); device 2 edits + syncs; device 3 goes
         offline and edits (upload fails, pending); device 1 — whose last read
         is older than device 2's write — edits and syncs: the row must keep
         device 2's edit AND gain device 1's. Device 3 comes back and syncs:
         the row must hold every edit (its offline one included), device 3
         must NOT have been shown a device-merge toast (it was required until
         2026-09-18; the owner asked for it to go), and after 15 idle seconds nothing
         has been overwritten (the old FINDING line, now a PASS/FAIL). Finally
         every device reloads and must hold every edit.
   NEGATIVE CONTROLS (both must go red, or this suite's green means nothing)
     NEG-CAS   S2 against a throwaway copy with the compare-and-set disabled
               (the two CAS branches in _profileRowWrite turned into `if
               (false)`, so every write is the old blind upsert): an edit
               must be LOST from the row.
     NEG-LOOP  I1 (30 s) against the HEAD blob of index.html: an idle tab must
               upload at least 5 times. Skipped with a note once HEAD carries
               the fix; then a copy whose success path calls saveProfile()
               again is used instead.

   Usage:
     node .gauntlet/drive-two-device.mjs
     node .gauntlet/drive-two-device.mjs --page=<index.html>   (main run on another file)
     node .gauntlet/drive-two-device.mjs --no-negative
     node .gauntlet/drive-two-device.mjs --idle=60              (I1 seconds)
   Output: PASS/FAIL + STATE lines with marker ids and counts only. Emails are
   fake (@harness.invalid) and never printed. Nothing reaches the live project.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARGS = process.argv.slice(2);
const argVal = (k) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const ROOT = path.resolve(process.cwd(), 'public');
const PAGE_ARG = argVal('page');
const RUN_NEG = !ARGS.includes('--no-negative');
const IDLE_S = Math.max(10, Number(argVal('idle')) || 60);
const SUPA_HOST = 'ktsiasyjusesawtrwrjc.supabase.co';

let passes = 0, fails = 0;
let QUIET_CHECKS = null;   // array while a negative control runs: failures are collected, not counted
const ok = (name, cond, detail) => {
  if (QUIET_CHECKS) { if (!cond) QUIET_CHECKS.push(name + (detail ? '   ' + detail : '')); return !!cond; }
  if (cond) passes++; else fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null || detail === '' ? '' : '   ' + detail));
  return !!cond;
};
const state = (s) => { if (!QUIET_CHECKS) console.log('   · STATE ' + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (o) => JSON.stringify(o);

/* ── static server ───────────────────────────────────────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
let INDEX_BODY = null;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return res.end(INDEX_BODY);
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;

/* ══ THE FAKE SUPABASE ═══════════════════════════════════════════════════ */
function b64u(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function makeStore() {
  return { users: {}, byEmail: {}, refresh: {}, profiles: {}, progress: {},
    writes: [],          // { uid, device, method, kind, body, at, result }
    rlsRefusals: [], failDevice: {}, lastAt: 0, internal: [] };
}
let STORE = makeStore();
let STAMP_SEQ = 0;
/* Postgres-shaped timestamptz text, strictly increasing (microsecond counter). */
function pgNow() {
  const d = new Date();
  const us = String((d.getMilliseconds() * 1000) + ((STAMP_SEQ++) % 1000)).padStart(6, '0');
  return d.toISOString().slice(0, 19) + '.' + us + '+00:00';
}
function addUser(tag) {
  const id = ('00000000-0000-4000-8000-' + (Buffer.from(tag).toString('hex') + '000000000000').slice(0, 12));
  const email = 'dev2-' + tag.toLowerCase() + '@harness.invalid';
  const u = { id, email, password: 'pw-' + tag, name: 'Harness ' + tag, tag };
  STORE.users[id] = u; STORE.byEmail[email] = u;
  return u;
}
function jwtFor(u) {
  const now = Math.floor(Date.now() / 1000);
  return b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
    b64u(JSON.stringify({ sub: u.id, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600,
      email: u.email, session_id: 'sess-' + u.tag, aal: 'aal1' })) + '.harness';
}
function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: u.name },
    identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
function sessionFor(u) {
  const rt = 'rt-' + u.tag + '-' + Math.random().toString(36).slice(2, 10);
  STORE.refresh[rt] = u.id;
  const now = Math.floor(Date.now() / 1000);
  return { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: userJson(u) };
}
function subOf(req) {
  const tok = (req.headers()['authorization'] || '').replace(/^Bearer\s+/i, '');
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return (p && p.role === 'authenticated' && STORE.users[p.sub]) ? p.sub : null;
  } catch (e) { return null; }
}
const J = (status, body, extra) => ({ status, contentType: 'application/json',
  headers: Object.assign({ 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
    'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }, extra || {}),
  body: body === undefined ? '' : JSON.stringify(body) });
function eqFilters(url) { const f = {}; for (const [k, v] of url.searchParams) if (/^eq\./.test(v)) f[k] = v.slice(3); return f; }
function pgrstRows(req, rows) {
  if (/vnd\.pgrst\.object/.test(req.headers()['accept'] || '')) {
    if (rows.length === 1) return J(200, rows[0]);
    return J(406, { code: 'PGRST116', details: 'The result contains ' + rows.length + ' rows', hint: null,
      message: 'JSON object requested, multiple (or no) rows returned' });
  }
  return J(200, rows, { 'content-range': (rows.length ? '0-' + (rows.length - 1) : '*') + '/' + rows.length });
}
const OWN = { user_profiles: 'profiles', user_progress: 'progress' };
function handleRest(req, url, device) {
  const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/);
  if (!m) return J(404, { message: 'harness: bad rest path' });
  const method = req.method();
  const sub = subOf(req);
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = null; }
  if (m[1]) return handleRpc(m[2], body || {}, sub);
  const table = m[2];
  const prefer = req.headers()['prefer'] || '';
  const bucket = OWN[table];
  if (!bucket) {
    if (method === 'GET' || method === 'HEAD') return pgrstRows(req, []);
    return /return=representation/.test(prefer) ? pgrstRows(req, []) : J(method === 'POST' ? 201 : 204);
  }
  const rows = STORE[bucket];
  const filt = eqFilters(url);
  const match = () => Object.values(rows).filter((r) => Object.keys(filt).every((k) => String(r[k]) === filt[k]));
  if (method === 'GET' || method === 'HEAD') return pgrstRows(req, match());
  if (method !== 'POST' && method !== 'PATCH') return J(method === 'DELETE' ? 204 : 405);
  const isProfiles = bucket === 'profiles';
  const upsert = /resolution=merge-duplicates/.test(prefer);
  const kind = method === 'PATCH' ? ('update' + (filt.updated_at ? '+cas' : '')) : (upsert ? 'upsert' : 'insert');
  const log = isProfiles ? { uid: sub, device, method, kind, at: Date.now(), result: '' } : null;
  if (log) STORE.writes.push(log);
  if (isProfiles && STORE.failDevice[device]) { log.result = 'injected-failure'; return J(400, { code: 'XX000', message: 'harness: injected upsert failure', details: null, hint: null }); }
  const out = [];
  if (method === 'PATCH') {
    for (const r of match()) {
      if (!sub || r.user_id !== sub) { STORE.rlsRefusals.push({ table, device }); continue; }   // USING filters silently
      const next = Object.assign({}, r, body || {}, { user_id: r.user_id });
      if (isProfiles) next.updated_at = pgNow();   // user_profiles_touch
      rows[r.user_id] = next; out.push(next);
    }
    if (log) { log.result = out.length ? 'updated' : 'no-match'; log.body = body; }
  } else {
    for (const rowIn of (Array.isArray(body) ? body : [body])) {
      if (!rowIn || typeof rowIn !== 'object') continue;
      const uid = rowIn.user_id;
      if (!sub || uid !== sub) {
        STORE.rlsRefusals.push({ table, device });
        return J(403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
      }
      if (rows[uid] && !upsert) {
        if (log) log.result = 'duplicate';
        return J(409, { code: '23505', details: 'Key (user_id) already exists.', hint: null, message: 'duplicate key value violates unique constraint "user_profiles_pkey"' });
      }
      const next = Object.assign({}, rows[uid] || {}, rowIn);
      if (isProfiles) next.updated_at = pgNow();
      rows[uid] = next; out.push(next);
      if (log) { log.result = 'written'; log.body = rowIn; }
    }
  }
  if (/return=representation/.test(prefer)) return pgrstRows(req, out);
  return J(method === 'POST' ? 201 : 204);
}
function handleRpc(fn, args, sub) {
  const notFound = () => J(404, { code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.' + fn + ' in the schema cache' });
  if (!sub) return notFound();
  const P = STORE.progress;
  if (fn === 'progress_ensure') {
    if (!P[sub]) P[sub] = { user_id: sub, cinder: Math.max(0, args.p_seed_cinder | 0), sovereigns: 0,
      item_inventory: (args.p_seed_inventory && typeof args.p_seed_inventory === 'object') ? JSON.parse(JSON.stringify(args.p_seed_inventory)) : {},
      wallet_seq: 0, seeded_at: new Date().toISOString() };
    return J(200, [P[sub]]);
  }
  if (fn === 'wallet_credit') {
    if (!P[sub]) P[sub] = { user_id: sub, cinder: 0, sovereigns: 0, item_inventory: {}, wallet_seq: 0 };
    P[sub].cinder += Math.max(0, args.p_amount | 0);
    return J(200, [{ ok: true, new_balance: P[sub].cinder, wallet_seq: P[sub].wallet_seq }]);
  }
  return notFound();
}
function handleAuth(req, url) {
  const method = req.method();
  let body = null;
  try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = null; }
  const p = url.pathname;
  if (p === '/auth/v1/token' && method === 'POST') {
    const gt = url.searchParams.get('grant_type');
    if (gt === 'password') {
      const u = body && STORE.byEmail[body.email];
      if (!u || u.password !== body.password) return J(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
      return J(200, sessionFor(u));
    }
    if (gt === 'refresh_token') {
      const uid = body && STORE.refresh[body.refresh_token];
      if (!uid) return J(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' });
      return J(200, sessionFor(STORE.users[uid]));
    }
    return J(400, { error: 'unsupported_grant_type' });
  }
  if (p === '/auth/v1/user') {
    const sub = subOf(req);
    if (!sub) return J(401, { code: 'bad_jwt', message: 'invalid JWT' });
    return J(200, userJson(STORE.users[sub]));
  }
  if (p === '/auth/v1/logout') return J(204);
  return J(404, { message: 'harness: auth path not modelled' });
}

/* ── devices ─────────────────────────────────────────────────────────────── */
let SUPA_JS = null;
const NET = { seen: 0, fulfilled: 0, aborted: 0 };
let browser;
async function newDevice(label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'block' });
  const dev = { label, context, page: null, errors: [] };
  await context.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (e) {} });
  context.on('request', (r) => { if (r.url().includes(SUPA_HOST)) NET.seen++; });
  await context.route('**/*', async (route) => {
    const req = route.request();
    let url;
    try { url = new URL(req.url()); } catch (e) { NET.aborted++; return route.abort(); }
    if (url.origin === ORIGIN) return route.continue();
    if (url.host === SUPA_HOST) {
      STORE.lastAt = Date.now();
      let resp;
      try {
        if (req.method() === 'OPTIONS') resp = J(204);
        else if (url.pathname.startsWith('/rest/v1/')) resp = handleRest(req, url, dev.label);
        else if (url.pathname.startsWith('/auth/v1/')) resp = handleAuth(req, url);
        else resp = J(404, { message: 'harness: not modelled' });
      } catch (e) { resp = J(500, { message: 'harness error: ' + e.message }); STORE.internal.push(url.pathname + ' ' + e.message); }
      NET.fulfilled++;
      return route.fulfill(resp);
    }
    if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/.test(req.url())) {
      if (!SUPA_JS) {
        try { const r = await route.fetch(); SUPA_JS = { body: await r.body(), contentType: r.headers()['content-type'] || 'text/javascript' }; }
        catch (e) { NET.aborted++; return route.abort(); }
      }
      return route.fulfill({ status: 200, contentType: SUPA_JS.contentType, body: SUPA_JS.body });
    }
    NET.aborted++;
    return route.abort();
  });
  return dev;
}
async function waitBoot(page) {
  await page.waitForFunction(() => {
    try {
      return typeof cloudSignIn === 'function' && typeof Profile !== 'undefined' && !!window.supabase
        && typeof Cloud !== 'undefined' && Cloud.ready === true
        && !(typeof MultiTab !== 'undefined' && MultiTab && MultiTab.amWriter === false);
    } catch (e) { return false; }
  }, null, { timeout: 120000, polling: 250 });
  /* Record every toast, so "the player was told" is checkable. A global
     function declaration is a writable property of window, and the page's own
     bare showToast(...) calls resolve through it, so wrapping it here is seen. */
  await page.evaluate(() => {
    window.__toasts = [];
    const o = window.showToast;
    if (typeof o === 'function' && !o.__rec) {
      const w = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return o.apply(this, arguments); };
      w.__rec = true;
      window.showToast = w;
    }
  });
  await quiet();
}
async function openPage(dev) {
  const page = await dev.context.newPage();
  dev.page = page;
  page.on('pageerror', (e) => dev.errors.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 120000 });
  await waitBoot(page);
}
async function quiet(ms = 1500, max = 12000) {
  const t0 = Date.now();
  await sleep(200);
  while (Date.now() - t0 < max) { if (Date.now() - STORE.lastAt >= ms) return; await sleep(200); }
}
async function waitHydrated(page, uid) {
  await page.waitForFunction((id) => {
    try { return Profile.cloud && Profile.cloud.signedIn && Profile.cloud.userId === id && Profile.cloud._hydratedFromCloud === true; }
    catch (e) { return false; }
  }, uid, { timeout: 60000, polling: 200 });
  await quiet(2500);
}
async function signIn(dev, u) {
  const r = await dev.page.evaluate(([e, p]) => cloudSignIn(e, p).then((x) => ({ ok: !!(x && x.ok), error: x && x.error ? String(x.error) : '' })), [u.email, u.password]);
  if (r.ok) await waitHydrated(dev.page, u.id);
  return r;
}
async function sync(dev) {
  const r = await dev.page.evaluate(() => cloudSyncProfile().then((x) => ({ ok: !!(x && x.ok), error: x && x.error ? String(x.error) : '', conflict: !!(x && x.conflict) })));
  await quiet();
  return r;
}
/* An edit, through the helpers the game's own screens use: a hero and a unit
   (both merged per id by cloudFetchProfile), then saveProfile(). */
async function edit(dev, tag) {
  return dev.page.evaluate((T) => {
    Profile.heroes = Profile.heroes || {};
    Profile.heroes['zz' + T + '_hero'] = { level: 7, xp: 12, knownMoves: [] };
    Profile.units = Profile.units || {};
    Profile.units['zz' + T + '_unit'] = { level: 3, xp: 1, knownMoves: [] };
    return saveProfile();
  }, tag);
}
const MARK_RE = /zz[A-Za-z0-9]+_(hero|unit)/g;
const markers = (t) => new Set(String(t).match(MARK_RE) || []);
const lacks = (set, list) => list.filter((m) => !set.has(m));
const want = (...tags) => tags.flatMap((t) => ['zz' + t + '_hero', 'zz' + t + '_unit']);
const rowIds = (uid) => markers(JSON.stringify(STORE.profiles[uid] || {}));
async function memIds(dev) { return markers(await dev.page.evaluate(() => JSON.stringify({ h: Profile.heroes, u: Profile.units }))); }
const uploads = (dev, since) => STORE.writes.slice(since).filter((w) => w.device === dev.label).length;

/* ══ I1 — one idle tab ════════════════════════════════════════════════════ */
async function scenarioI1(lbl, secs, tag) {
  const U = addUser(tag);
  const d = await newDevice(lbl + '/tab');
  let n = -1;
  try {
    await openPage(d);
    ok(lbl + ': signs in', (await signIn(d, U)).ok);
    await edit(d, tag);
    ok(lbl + ': the first edit reaches the row (positive control)', (await sync(d)).ok && !lacks(rowIds(U.id), want(tag)).length, fmt([...rowIds(U.id)]));
    await sleep(3000);
    const since = STORE.writes.length;
    await sleep(secs * 1000);
    n = uploads(d, since);
    state(lbl + ': ' + n + ' writes to user_profiles in ' + secs + ' idle seconds · kinds ' + fmt(STORE.writes.slice(since).map((w) => w.kind + ':' + w.result).slice(0, 4)));
  } catch (e) {
    ok(lbl + ': ran to the end', false, String(e && e.message || e).slice(0, 240));
  } finally { await d.context.close().catch(() => {}); }
  return n;
}

/* ══ S2 — three devices, one account ══════════════════════════════════════ */
async function scenarioS2(lbl, tag) {
  const C = addUser(tag);
  const T = (s) => tag + s;
  const d1 = await newDevice(lbl + '/device1'), d2 = await newDevice(lbl + '/device2'), d3 = await newDevice(lbl + '/device3');
  const res = { lost: 0 };
  const rowHas = (name, list) => {
    const miss = lacks(rowIds(C.id), list);
    if (miss.length) res.lost++;
    return ok(lbl + ': ' + name, !miss.length, miss.length ? 'row lacks ' + fmt(miss) : fmt([...rowIds(C.id)].sort()));
  };
  try {
    await openPage(d1);
    ok(lbl + ': device 1 signs in', (await signIn(d1, C)).ok);
    await edit(d1, T('d1'));
    ok(lbl + ': device 1 synced', (await sync(d1)).ok);
    rowHas('positive control: device 1\'s edit is in the row', want(T('d1')));

    await openPage(d2); ok(lbl + ': device 2 signs in', (await signIn(d2, C)).ok);
    await openPage(d3); ok(lbl + ': device 3 signs in', (await signIn(d3, C)).ok);
    for (const d of [d2, d3]) { const m = await memIds(d); ok(lbl + ': ' + d.label.split('/')[1] + ' holds device 1\'s edit', !lacks(m, want(T('d1'))).length, fmt([...m])); }

    /* all three idle */
    await sleep(2500);
    let since = STORE.writes.length;
    await sleep(20000);
    for (const d of [d1, d2, d3]) {
      const n = uploads(d, since);
      ok(lbl + ': ' + d.label.split('/')[1] + ' idle 20 s sent at most 1 upload', n <= 1, n + ' uploads');
    }

    /* device 2 edits */
    await edit(d2, T('d2'));
    ok(lbl + ': device 2 synced its edit', (await sync(d2)).ok);
    rowHas('device 2\'s edit is in the row', want(T('d1'), T('d2')));

    /* device 3 goes offline and edits */
    STORE.failDevice[d3.label] = true;
    await edit(d3, T('d3'));
    const s3 = await sync(d3);
    const p3 = await d3.page.evaluate(() => !!Profile.cloud.pendingChanges);
    ok(lbl + ': device 3\'s offline upload failed and stays pending', !s3.ok && p3, 'ok=' + s3.ok + ' pending=' + p3);

    /* device 1, idle since before device 2's write, now edits */
    await sleep(1000);
    since = STORE.writes.length;
    await edit(d1, T('d1b'));
    const s1 = await sync(d1);
    await quiet(2500);
    ok(lbl + ': device 1 (behind) saved its new edit', s1.ok, s1.error);
    rowHas('device 1 did NOT write over device 2\'s edit, and its own new edit landed', want(T('d1'), T('d2'), T('d1b')));
    state(lbl + ' device 1 writes: ' + fmt(STORE.writes.slice(since).filter((w) => w.device === d1.label).map((w) => w.kind + ':' + w.result)));

    /* device 3 comes back */
    STORE.failDevice[d3.label] = false;
    since = STORE.writes.length;
    const s3b = await sync(d3);
    await quiet(2500);
    ok(lbl + ': device 3 (offline edit) saved once the network came back', s3b.ok, s3b.error + (s3b.conflict ? ' (conflict)' : ''));
    rowHas('device 3\'s offline edit was merged, not dropped, and nothing else was lost', want(T('d1'), T('d2'), T('d1b'), T('d3')));
    state(lbl + ' device 3 writes: ' + fmt(STORE.writes.slice(since).filter((w) => w.device === d3.label).map((w) => w.kind + ':' + w.result)));
    /* 🤫 INVERTED 2026-09-18, on the owner's request ("make the merge of devices
       automatic and do not show this message"). This used to require the toast;
       the merge is now silent and must stay so. The merge itself is what the
       rowHas() line above proves. */
    const toasts = await d3.page.evaluate(() => (window.__toasts || []).filter((t) => /another device|merged that progress/i.test(t)).length);
    ok(lbl + ': device 3 merged silently — no "saved on another device" toast (owner: do not show this message)', toasts === 0, toasts + ' toast(s)');

    /* the old FINDING: everyone idles, nothing gets overwritten */
    since = STORE.writes.length;
    await sleep(15000);
    rowHas('after 15 idle seconds on all three devices every edit is still in the row (was: device 3\'s late edit LOST)', want(T('d1'), T('d2'), T('d1b'), T('d3')));
    const idleN = STORE.writes.length - since;
    ok(lbl + ': the three idle devices sent at most 3 uploads in those 15 s', idleN <= 3, idleN + ' uploads');

    /* reload every device */
    for (const d of [d1, d2, d3]) {
      await d.page.reload({ waitUntil: 'load', timeout: 120000 });
      await waitBoot(d.page);
      await waitHydrated(d.page, C.id);
    }
    await quiet(3000);
    for (const d of [d1, d2, d3]) {
      const m = await memIds(d);
      const miss = lacks(m, want(T('d1'), T('d2'), T('d1b'), T('d3')));
      if (miss.length) res.lost++;
      ok(lbl + ': ' + d.label.split('/')[1] + ' after reload holds every edit', !miss.length, miss.length ? 'lacks ' + fmt(miss) : '');
    }
    rowHas('after all three reloads the row still holds every edit', want(T('d1'), T('d2'), T('d1b'), T('d3')));
    ok(lbl + ': no write was refused by RLS', !STORE.rlsRefusals.length, fmt(STORE.rlsRefusals.slice(0, 3)));
    for (const d of [d1, d2, d3]) if (d.errors.length) state(d.label + ' page errors (first 2): ' + fmt(d.errors.slice(0, 2)));
  } catch (e) {
    res.lost++;
    ok(lbl + ': ran to the end', false, String(e && e.message || e).slice(0, 300));
  } finally { for (const d of [d1, d2, d3]) await d.context.close().catch(() => {}); }
  return res;
}

/* ══ mutants ══════════════════════════════════════════════════════════════ */
function noCas(src) {
  const a = 'if (base && base.at) {', b = 'if (base && base.absent) {';
  const hits = [src.split(a).length - 1, src.split(b).length - 1];
  return { hits, out: src.replace(a, 'if (false) { /* HARNESS MUTANT: CAS off */').replace(b, 'if (false) { /* HARNESS MUTANT: CAS off */') };
}
function loopBack(src) {
  // The success path goes back to re-arming the cloud timer.
  const a = '    _saveProfileNoCloud();\n    return { ok: true };';
  const hits = [src.split(a).length - 1];
  return { hits, out: src.replace(a, '    _saveProfileLocalOnly = false; saveProfile(); /* HARNESS MUTANT: loop */\n    return { ok: true };')
    .replace('if (_sig && _base && !(opts && opts.final)', 'if (false && _sig && _base && !(opts && opts.final)') };
}

/* ══ RUN ══════════════════════════════════════════════════════════════════ */
const t0 = Date.now();
console.log('\n\u{1F501} TWO DEVICES, ONE ACCOUNT: idle tabs stay quiet, a device that is behind cannot overwrite a newer edit\n');
try {
  const base = fs.readFileSync(PAGE_ARG || path.join(ROOT, 'index.html'), 'utf8');
  INDEX_BODY = Buffer.from(base);
  console.log('  page: ' + (PAGE_ARG ? path.resolve(PAGE_ARG) : 'public/index.html (working tree)') + ' · ' + INDEX_BODY.length + ' bytes');
  browser = await chromium.launch({ headless: true });

  console.log('\n  ── I1: one tab, ' + IDLE_S + ' s with no input');
  const n = await scenarioI1('I1', IDLE_S, 'I');
  ok('I1: at most 1 upload in ' + IDLE_S + ' idle seconds (HEAD: one every ~2 s)', n >= 0 && n <= 1, n + ' uploads');

  console.log('\n  ── S2: three devices, one account');
  await scenarioS2('S2', 'C');
  ok('S2: the fake answered every request without an internal error', !STORE.internal.length, fmt(STORE.internal.slice(0, 3)));
  ok('supabase-js loaded from the page\'s own CDN tag (the real client ran)', !!SUPA_JS);
  ok('every request to ' + SUPA_HOST + ' was answered by the fake', NET.seen > 0 && NET.seen === NET.fulfilled, 'seen ' + NET.seen + ' fulfilled ' + NET.fulfilled);

  if (RUN_NEG) {
    console.log('\n  ── NEG-CAS: S2 against a throwaway copy with the compare-and-set disabled');
    const mu = noCas(base);
    ok('NEG-CAS: both CAS anchors found exactly once', mu.hits[0] === 1 && mu.hits[1] === 1, fmt(mu.hits));
    INDEX_BODY = Buffer.from(mu.out);
    STORE = makeStore();
    QUIET_CHECKS = [];
    const r = await scenarioS2('NEG-CAS', 'N');
    const got = QUIET_CHECKS; QUIET_CHECKS = null;
    state('NEG-CAS failing checks: ' + got.length + ' · first: ' + fmt(got.slice(0, 2).map((s) => s.slice(0, 140))));
    ok('NEG-CAS: with the CAS off an edit is LOST from the row (the suite can see an overwrite)', r.lost > 0, r.lost + ' lost-edit checks');

    console.log('\n  ── NEG-LOOP: I1 (30 s) against a page that re-arms the timer after a sync');
    let loopSrc = null, which = '';
    try {
      const head = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', 'HEAD:public/index.html'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
      if (!head.includes('_saveProfileNoCloud')) { loopSrc = head; which = 'HEAD blob'; }
    } catch (e) {}
    if (!loopSrc) {
      const lb = loopBack(base);
      ok('NEG-LOOP: mutant anchor found exactly once', lb.hits[0] === 1, fmt(lb.hits));
      loopSrc = lb.out; which = 'working tree with the success path calling saveProfile() again';
    }
    console.log('  control page: ' + which);
    INDEX_BODY = Buffer.from(loopSrc);
    STORE = makeStore();
    QUIET_CHECKS = [];
    const nl = await scenarioI1('NEG-LOOP', 30, 'L');
    QUIET_CHECKS = null;
    ok('NEG-LOOP: the control tab uploads at least 5 times in 30 idle seconds (the counter can see the loop)', nl >= 5, nl + ' uploads');
  }
} catch (e) {
  ok('the harness ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  try { if (browser) await browser.close(); } catch (e) {}
  server.close();
}
console.log('\n  ' + passes + ' passed, ' + fails + ' failed · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
