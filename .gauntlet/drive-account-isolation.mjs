/* ══════════════════════════════════════════════════════════════════════════
   🪪 DRIVE-ACCOUNT-ISOLATION — two accounts on one device, one account on two
   devices, through the SHIPPED sign-in / fetch / sync / sign-out code and a
   fake Supabase that both devices share.

   WHY THIS EXISTS. Every account test in this repo before it stopped one level
   short of the round trip:
     · _accountowner_smoke.mjs models the owner stamp with its own copies of
       saveProfile / signIn (it says so), so it proves the IDEA of the stamp;
     · _accountswitch_smoke.mjs calls _resetProfileForNewOwner() directly and
       asks what it clears;
     · drive-labcamp-sync.mjs hands a literal cloud blob to the hydration text
       and admits in its own header that "TRUE two-device behaviour ... has NOT
       been done".
   None of them ever had two browsers write to ONE user_profiles store and then
   asked whose data ended up in whose row. That is the only question the
   players were asking ("it connected their accounts together", "I signed into
   my iPad and got my old data").

   HOW. The real public/index.html boots in Playwright browser contexts (one
   context = one device: its own localStorage, its own IndexedDB). Every
   request to https://ktsiasyjusesawtrwrjc.supabase.co is route-intercepted
   and answered by an in-memory fake that lives in THIS process — so two
   contexts really do read and write the same rows. supabase-js is the real
   library (the page's own CDN <script>, fetched once and replayed from memory),
   so signInWithPassword, the persisted session, onAuthStateChange and every
   .from().upsert() are the shipped client doing real fetch() calls. The driver
   only calls the page's own globals: cloudSignIn, cloudSignOut,
   cloudSyncProfile, cloudFetchProfile, addGems, saveProfile, saveLab,
   _persistItemInventoryNow, _saveCxHoldings, _frScheduleLedgerSave — exactly
   what the game's own buttons call.

   THE FAKE, and what it deliberately does NOT model:
     · auth: password grant, refresh grant, /user, /logout. Tokens are unsigned
       JWT-shaped strings; nothing is ever sent to a real auth server and no
       account is created anywhere.
     · user_profiles and user_progress are real rows keyed by user_id, with
       the RLS rule that matters here enforced: a write whose row user_id is
       not the bearer's `sub` is REFUSED (42501) and counted — a client that
       tried it would itself be a finding.
     · progress_ensure / wallet_credit / wallet_charge are modelled because
       they are how Cinder reaches the canonical row; every other RPC answers
       PGRST202 (function not found), which the page already treats as
       "not installed yet" and degrades from. Every other table reads empty.
     · Realtime websockets are accepted and closed. Storage and edge functions
       answer 404.

   THE SCENARIOS
     S1  ONE DEVICE, TWO ACCOUNTS. Account A plays (Cinder, a held item, an
         Aza-exchange holding, a tax-ledger entry, a hero, a Lab core), then
         account B signs in on the same device. Three ways:
           a  A signs out cleanly (final push lands) — no reload
           b  A signs out but the final push FAILS (local copy is kept on
              purpose) — no reload
           c  A signs out cleanly, the page is HARD-RELOADED, then B signs in
         …and after B has played and synced, B's page is reloaded once more,
         because the side-store keys are only merged back in at BOOT. B's
         in-memory Profile, B's localStorage, every upsert body sent for B and
         B's rows in the store must hold none of A's ids.
     S2  ONE ACCOUNT, TWO DEVICES. Device 1 plays and syncs; device 2 (fresh
         context) signs in and must hold device 1's progress. Device 2 plays
         and syncs. Device 1 then comes back two ways:
           a  REOPENED: a new page on its own stale disk save (persisted
              session bootstrap);
           b  STILL OPEN with a stale unsynced edit (pendingChanges set by an
              upload that failed ~6 s BEFORE device 2's write) when its fetch
              runs.
         Device 1 must end up holding device 2's progress, and no upsert it
         sends afterwards may be a copy that lacks device 2's progress.
     S3  After everything: every user_profiles / user_progress row holds only
         ids stamped for its own account.

   MARKERS. Every id a scenario creates is `zz<ACCOUNT>_<what>` (zzA1_item,
   zzC_d2_hero…), so "whose data is this" is a string scan, not a judgement.
   A POSITIVE CONTROL runs first in every scenario: the marker has to reach the
   owner's OWN row, or a clean result would mean nothing (a sanitizer eating
   unknown ids would otherwise read as perfect isolation).

   NEGATIVE CONTROL (built in). A throwaway copy of the page is written to the
   OS temp dir with _resetProfileForNewOwner() and _resetLabCampForNewOwner()
   turned into no-ops — the account-switch wipe disabled — and S1a/S1b are run
   against it. That copy must leak A's hero / Lab core (the NON side-store
   markers) into B. If it does not, this harness cannot see a switch leak and
   its green means nothing. The real file is never modified.

   Usage:
     node .gauntlet/drive-account-isolation.mjs
     node .gauntlet/drive-account-isolation.mjs --page=<path to an index.html>
         (e.g. the HEAD blob: git -c core.eol=lf show HEAD:public/index.html)
     node .gauntlet/drive-account-isolation.mjs --mutant=nowipe   (the control, alone)
     node .gauntlet/drive-account-isolation.mjs --mutant=plainside --only=S1b
         (_sideWrite files the copy under the PLAIN key: S1b's side-key leak check must go red)
     node .gauntlet/drive-account-isolation.mjs --mutant=noadopt --only=S1b
         (_sideAdoptFor is a no-op: S1b's restore step must go red)
     node .gauntlet/drive-account-isolation.mjs --no-negative     (skip the control)
     node .gauntlet/drive-account-isolation.mjs --only=S1a,S2     (subset; S3 always runs)

   Output: PASS/FAIL lines, plus STATE lines listing ids and counts only.
   Emails are fake (@harness.invalid) and are never printed.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ARGS = process.argv.slice(2);
const argVal = (k) => { const a = ARGS.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const ROOT = path.resolve(process.cwd(), 'public');
const PAGE_ARG = argVal('page');
const MUTANT = argVal('mutant');
const ONLY = (argVal('only') || '').split(',').filter(Boolean);
const RUN_NEG = !ARGS.includes('--no-negative') && !MUTANT;
const SUPA_HOST = 'ktsiasyjusesawtrwrjc.supabase.co';

let fails = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++; else fails++;
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail == null || detail === '' ? '' : '   ' + detail));
  return !!cond;
};
const state = (s) => console.log('   · STATE ' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the page under test ─────────────────────────────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythic-acctiso-'));
function pageSource(p) {
  const src = fs.readFileSync(p || path.join(ROOT, 'index.html'), 'utf8');
  return src;
}
/* The mutants. Each edit is anchored on an exact line of the shipped code so a
   rename is reported as ANCHOR ROT (hits != 1), not as a quietly green control.
     nowipe     the account-switch wipe becomes a no-op (built-in control).
     plainside  _sideWrite files an account's side copy under the UN-namespaced
                key (hg_x instead of hg_x@<id>), so the failed-push copy sits
                where the next player on the device can read it. S1b must go red.
     noadopt    _sideAdoptFor does nothing: the parked copy is never taken back
                (and the side write gate never opens). S1b's restore step must
                go red. */
const MUTANTS = {
  nowipe: { desc: 'account-switch wipe disabled', edits: [
    ['function _resetProfileForNewOwner() {', ' return; /* HARNESS MUTANT: wipe disabled */'],
    ['function _resetLabCampForNewOwner() {', ' return; /* HARNESS MUTANT: wipe disabled */'],
  ] },
  plainside: { desc: '_sideWrite writes the side copy to the un-namespaced key', edits: [
    ['localStorage.setItem(_sideKey(base, o), JSON.stringify(value));',
      'localStorage.setItem(base, JSON.stringify(value)); /* HARNESS MUTANT: plain key */', 'replace'],
  ] },
  noadopt: { desc: '_sideAdoptFor does nothing', edits: [
    ['function _sideAdoptFor(uid, cloudUpdatedMs) {', ' return false; /* HARNESS MUTANT: adopt disabled */'],
  ] },
};
function makeMutant(name, src) {
  const m = MUTANTS[name];
  if (!m) throw new Error('unknown --mutant=' + name + ' (known: ' + Object.keys(MUTANTS).join(', ') + ')');
  const hits = m.edits.map(([a]) => src.split(a).length - 1);
  let out = src;
  for (const [a, add, mode] of m.edits) out = out.replace(a, mode === 'replace' ? add : a + add);
  return { out, hits, desc: m.desc };
}
function makeNoWipe(src) { return makeMutant('nowipe', src); }

/* ── static server: public/ with index.html swappable ────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2' };
let INDEX_BODY = null;   // Buffer served for / and /index.html
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
/* Port 0: the OS picks a free one. A pid-derived port collided with another
   session's server on this machine (EADDRINUSE) and killed a whole run. */
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = 'http://127.0.0.1:' + PORT;

/* ══════════════════════════════════════════════════════════════════════════
   THE FAKE SUPABASE — one store for every context in the run.
   ══════════════════════════════════════════════════════════════════════════ */
function b64u(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function makeStore() {
  return {
    users: {},          // uid -> { id, email, password, name, tag }
    byEmail: {},
    refresh: {},        // refresh token -> uid
    profiles: {},       // uid -> row
    progress: {},       // uid -> row
    upserts: [],        // { uid, device, body, at }
    rlsRefusals: [],    // { table, sub, rowUid }
    failUpsertFor: {},  // uid -> true: injected failure on user_profiles writes
    failDevice: {},     // device label -> true: the same, for one device only
    handled: 0,
    lastAt: 0,
    unhandledSupabase: [],
  };
}
let STORE = makeStore();
function addUser(tag) {
  const id = ('00000000-0000-4000-8000-' + (Buffer.from(tag).toString('hex') + '000000000000').slice(0, 12));
  const email = 'acct-' + tag.toLowerCase() + '@harness.invalid';
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
  return { access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: rt, user: userJson(u) };
}
function subOf(req) {
  const h = req.headers()['authorization'] || '';
  const tok = h.replace(/^Bearer\s+/i, '');
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
function eqFilters(url) {
  const f = {};
  for (const [k, v] of url.searchParams) if (/^eq\./.test(v)) f[k] = v.slice(3);
  return f;
}
function pgrstRows(req, rows) {
  const accept = req.headers()['accept'] || '';
  if (/vnd\.pgrst\.object/.test(accept)) {
    if (rows.length === 1) return J(200, rows[0]);
    return J(406, { code: 'PGRST116', details: 'The result contains ' + rows.length + ' rows',
      hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
  }
  return J(200, rows, { 'content-range': (rows.length ? '0-' + (rows.length - 1) : '*') + '/' + rows.length });
}
const OWN_TABLES = { user_profiles: 'profiles', user_progress: 'progress' };
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
  const bucket = OWN_TABLES[table];
  if (!bucket) {
    if (method === 'GET' || method === 'HEAD') return pgrstRows(req, []);
    return /return=representation/.test(prefer) ? pgrstRows(req, []) : J(method === 'POST' ? 201 : 204);
  }
  const rows = STORE[bucket];
  const filt = eqFilters(url);
  const match = () => Object.values(rows).filter((r) => Object.keys(filt).every((k) => String(r[k]) === filt[k]));
  if (method === 'GET' || method === 'HEAD') return pgrstRows(req, match());
  if (method === 'POST' || method === 'PATCH') {
    const list = method === 'POST' ? (Array.isArray(body) ? body : [body]) : match().map((r) => Object.assign({}, body, { user_id: r.user_id }));
    const out = [];
    for (const rowIn of list) {
      if (!rowIn || typeof rowIn !== 'object') continue;
      const uid = rowIn.user_id;
      /* RLS: auth.uid() = user_id, the one policy that decides whose row this is. */
      if (!sub || uid !== sub) {
        STORE.rlsRefusals.push({ table, sub, rowUid: uid, device });
        return J(403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
      }
      if (bucket === 'profiles') {
        STORE.upserts.push({ uid, device, method, body: JSON.parse(JSON.stringify(rowIn)), at: Date.now() });
        if (STORE.failUpsertFor[uid] || STORE.failDevice[device]) {
          return J(400, { code: 'XX000', message: 'harness: injected upsert failure', details: null, hint: null });
        }
      }
      const prev = rows[uid] || {};
      const next = Object.assign({}, prev, rowIn);
      if (bucket === 'profiles' && !rowIn.updated_at) next.updated_at = new Date().toISOString();
      rows[uid] = next;
      out.push(next);
    }
    if (/return=representation/.test(prefer)) return pgrstRows(req, out);
    return J(method === 'POST' ? 201 : 204);
  }
  if (method === 'DELETE') return J(204);
  return J(405, { message: 'harness: method' });
}
function handleRpc(fn, args, sub) {
  const notFound = () => J(404, { code: 'PGRST202', details: null, hint: null,
    message: 'Could not find the function public.' + fn + ' in the schema cache' });
  if (!sub) return notFound();
  const P = STORE.progress;
  if (fn === 'progress_ensure') {
    if (!P[sub]) {
      P[sub] = { user_id: sub, cinder: Math.max(0, args.p_seed_cinder | 0), sovereigns: 0,
        item_inventory: (args.p_seed_inventory && typeof args.p_seed_inventory === 'object') ? JSON.parse(JSON.stringify(args.p_seed_inventory)) : {},
        wallet_seq: 0, seeded_at: new Date().toISOString() };
    }
    return J(200, [P[sub]]);
  }
  if (fn === 'wallet_credit') {
    if (!P[sub]) P[sub] = { user_id: sub, cinder: 0, sovereigns: 0, item_inventory: {}, wallet_seq: 0 };
    P[sub].cinder += Math.max(0, args.p_amount | 0);
    return J(200, [{ ok: true, new_balance: P[sub].cinder, wallet_seq: P[sub].wallet_seq }]);
  }
  if (fn === 'wallet_charge') {
    const r = P[sub];
    const amt = Math.max(0, args.p_amount | 0);
    if (!r || r.cinder < amt) return J(200, [{ ok: false, reason: 'insufficient', new_balance: r ? r.cinder : 0 }]);
    r.cinder -= amt; r.wallet_seq += 1;
    return J(200, [{ ok: true, new_balance: r.cinder, tax_amount: Math.floor(amt * 0.02), wallet_seq: r.wallet_seq }]);
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

/* ── one device = one browser context ────────────────────────────────────── */
let SUPA_JS = null;       // { body, contentType } — the page's own CDN script, replayed
const NET = { supabaseSeen: 0, supabaseFulfilled: 0, supabaseEscaped: [], wsSupabase: 0, aborted: 0 };
let browser;
async function newDevice(label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'block' });
  const dev = { label, context, page: null, errors: [] };
  await context.routeWebSocket(/.*/, (ws) => {
    if (ws.url().includes(SUPA_HOST)) NET.wsSupabase++;
    try { ws.close(); } catch (e) {}
  });
  context.on('request', (r) => { if (r.url().includes(SUPA_HOST)) NET.supabaseSeen++; });
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    let url;
    try { url = new URL(u); } catch (e) { NET.aborted++; return route.abort(); }
    if (url.origin === ORIGIN) return route.continue();
    if (url.host === SUPA_HOST) {
      STORE.handled++; STORE.lastAt = Date.now();
      let resp;
      try {
        if (req.method() === 'OPTIONS') resp = J(204);
        else if (url.pathname.startsWith('/rest/v1/')) resp = handleRest(req, url, dev.label);
        else if (url.pathname.startsWith('/auth/v1/')) resp = handleAuth(req, url);
        else resp = J(404, { message: 'harness: not modelled' });
      } catch (e) {
        resp = J(500, { message: 'harness error: ' + e.message });
        STORE.unhandledSupabase.push(url.pathname + ' ' + e.message);
      }
      NET.supabaseFulfilled++;
      return route.fulfill(resp);
    }
    /* The page's supabase-js <script> is the ONE off-box thing let through,
       because the whole point is to run the real client library. Fetched once
       per run and replayed from memory to every context. */
    if (/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/.test(u)) {
      if (!SUPA_JS) {
        try {
          const r = await route.fetch();
          SUPA_JS = { body: await r.body(), contentType: r.headers()['content-type'] || 'text/javascript' };
        } catch (e) { NET.aborted++; return route.abort(); }
      }
      return route.fulfill({ status: 200, contentType: SUPA_JS.contentType, body: SUPA_JS.body });
    }
    NET.aborted++;
    return route.abort();
  });
  return dev;
}
async function openPage(dev) {
  const page = await dev.context.newPage();
  dev.page = page;
  page.on('pageerror', (e) => dev.errors.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 120000 });
  await waitBoot(page);
  return page;
}
async function waitBoot(page) {
  await page.waitForFunction(() => {
    try {
      return typeof cloudSignIn === 'function' && typeof Profile !== 'undefined' && !!window.supabase
        && typeof Cloud !== 'undefined' && Cloud.ready === true
        && !(typeof MultiTab !== 'undefined' && MultiTab && MultiTab.amWriter === false);
    } catch (e) { return false; }
  }, null, { timeout: 120000, polling: 250 });
  await quiet();
}
async function reload(dev) {
  await dev.page.reload({ waitUntil: 'load', timeout: 120000 });
  await waitBoot(dev.page);
}
/* Wait until the fake has seen no request for `ms`. The page fires debounced
   syncs, gift/friends refreshes and wallet reads on its own timers; checking
   before they land would test a moment, not an outcome. */
async function quiet(ms = 1500, max = 30000) {
  const t0 = Date.now();
  await sleep(200);
  while (Date.now() - t0 < max) {
    if (Date.now() - STORE.lastAt >= ms) return;
    await sleep(200);
  }
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
  if (!r.ok) return r;
  await waitHydrated(dev.page, u.id);
  return r;
}
async function signOut(dev) {
  const r = await dev.page.evaluate(() => cloudSignOut().then((x) => ({ ok: !!(x && x.ok), localCleared: x ? x.localCleared : undefined, error: x && x.error ? String(x.error) : '' })));
  await quiet();
  return r;
}
async function sync(dev) {
  const r = await dev.page.evaluate(() => cloudSyncProfile().then((x) => ({ ok: !!(x && x.ok), error: x && x.error ? String(x.error) : '', deferred: !!(x && x.deferred) })));
  await quiet();
  return r;
}
/* "Playing", through the same helpers the game's own screens call. Every id is
   stamped with the account tag so ownership is a string match. */
/* `{ side: false }` plays WITHOUT touching the three side stores. That is the
   account that exposes the side-store leak: a player who never trades writes
   nothing to hg_cxHoldings, so whatever the previous account left there is
   still on disk at the next boot. The first draft of this harness had B trade
   too, and B's own write overwrote A's copy — the HEAD leak went green. */
async function play(dev, tag, gems, sub, opt) {
  const side = !(opt && opt.side === false);
  return dev.page.evaluate(([T0, G, S, SIDE]) => {
    const T = S ? T0 + '_' + S : T0;
    const out = {};
    if (!SIDE) {
      try { if (G) addGems(G, 'harness ' + T); out.gems = Profile.gems; } catch (e) { out.gemsErr = String(e); }
      try { Profile.heroes = Profile.heroes || {}; Profile.heroes['zz' + T + '_hero'] = { level: 7, xp: 12, knownMoves: [] }; } catch (e) { out.heroErr = String(e); }
      try { const lab = _labStore(); lab.cores = Array.isArray(lab.cores) ? lab.cores : []; lab.cores.push({ id: 'zz' + T + '_core', createdAt: Date.now(), parents: [] }); saveLab(); } catch (e) { out.labErr = String(e); }
      try { out.saved = saveProfile(); } catch (e) { out.saveErr = String(e); }
      return out;
    }
    try { if (G) addGems(G, 'harness ' + T); out.gems = Profile.gems; } catch (e) { out.gemsErr = String(e); }
    try {
      Profile.itemInventory = Profile.itemInventory || {};
      Profile.itemInventory['zz' + T + '_item'] = 3;
      _persistItemInventoryNow();
    } catch (e) { out.itemErr = String(e); }
    try {
      if (!Profile.cxHoldings || typeof Profile.cxHoldings !== 'object') Profile.cxHoldings = {};
      Profile.cxHoldings['zz' + T + '_cx'] = { qty: 40, avgCost: 10 };
      _saveCxHoldings();
    } catch (e) { out.cxErr = String(e); }
    try {
      const L = (Profile.frTaxLedger && typeof Profile.frTaxLedger === 'object') ? Profile.frTaxLedger : { total: 0, byRes: {}, byMarket: {}, recent: [] };
      L.byRes = L.byRes || {}; L.byMarket = L.byMarket || {}; L.recent = Array.isArray(L.recent) ? L.recent : [];
      L.total = (L.total | 0) + 50000;
      L.byRes['zz' + T + '_tax'] = 50000;
      L.recent.unshift({ resource: 'zz' + T + '_tax', sale_value: 1, tax_amount: 50000, market_type: 'harness', created_at: new Date().toISOString() });
      Profile.frTaxLedger = L;
      _frScheduleLedgerSave();
    } catch (e) { out.taxErr = String(e); }
    try {
      Profile.heroes = Profile.heroes || {};
      Profile.heroes['zz' + T + '_hero'] = { level: 7, xp: 12, knownMoves: [] };
    } catch (e) { out.heroErr = String(e); }
    try {
      const lab = _labStore();
      if (lab) { lab.cores = Array.isArray(lab.cores) ? lab.cores : []; lab.cores.push({ id: 'zz' + T + '_core', createdAt: Date.now(), parents: [] }); saveLab(); }
      else out.labErr = 'no Lab store';
    } catch (e) { out.labErr = String(e); }
    try { out.saved = saveProfile(); } catch (e) { out.saveErr = String(e); }
    return out;
  }, [tag, gems || 0, sub || '', side]);
}
/* What a device holds, as marker sets. Profile + Lab + Camp in memory, and
   every localStorage key except the auth token (which names the account by
   design and holds no progress). */
const MARK_RE = /zz([A-Z][0-9]?)_(d[0-9]_)?[a-z]+/g;
function markers(text) { return new Set((String(text).match(MARK_RE) || [])); }
async function snapshot(dev) {
  return dev.page.evaluate(() => {
    const mem = {};
    try { mem.profile = JSON.stringify(Profile); } catch (e) { mem.profile = ''; }
    try { mem.lab = JSON.stringify(_labStore()); } catch (e) { mem.lab = ''; }
    try { mem.camp = JSON.stringify(_campStore()); } catch (e) { mem.camp = ''; }
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || /^sb-.*-auth-token/.test(k)) continue;
      ls[k] = localStorage.getItem(k) || '';
    }
    let uid = null; try { uid = Profile.cloud.userId; } catch (e) {}
    let gems = null; try { gems = Profile.gems; } catch (e) {}
    return { mem, ls, uid, gems, owner: localStorage.getItem('hg_profile_owner') };
  });
}
const tagOf = (m) => m.replace(/^zz/, '').split('_')[0];
function foreign(set, own) { return [...set].filter((m) => tagOf(m) !== own).sort(); }
/* A foreign id filed under a key namespaced to ITS OWN account (hg_x@<that
   account's id>) is not a leak: it is that account's unsynced copy waiting for
   that account, which is what a failed-push sign-out is supposed to leave.
   Only an un-namespaced key, or a key under somebody else's id, counts. */
const PARKED = [];
function lsForeign(ls, own, strict) {
  const hits = {};
  for (const k of Object.keys(ls)) {
    let f = foreign(markers(ls[k]), own);
    if (!strict) {
      /* Only side-store ids are parked by design. A hero / Lab core under an
         @<id> key is still a leak, as strict as before the allowance. */
      const parked = f.filter((m) => { if (!isSide(m)) return false; const u = Object.values(STORE.users).find((x) => x.tag === tagOf(m)); return u && k.endsWith('@' + u.id); });
      if (parked.length) PARKED.push(k.replace(/@.*/, '@<owner>') + ' ' + parked.join(','));
      f = f.filter((m) => !parked.includes(m));
    }
    if (f.length) hits[k] = f;
  }
  return hits;
}
const fmt = (o) => JSON.stringify(o);
function rowMarkers(uid) {
  return { profile: markers(JSON.stringify(STORE.profiles[uid] || {})), progress: markers(JSON.stringify(STORE.progress[uid] || {})) };
}
function describeRow(u) {
  const r = rowMarkers(u.id);
  const p = STORE.progress[u.id];
  return u.tag + ' row: profile ids ' + fmt([...r.profile].sort()) + ' · progress ids ' + fmt([...r.progress].sort())
    + ' · cinder ' + (p ? p.cinder : 'no-row') + ' · upserts ' + STORE.upserts.filter((x) => x.uid === u.id).length;
}
function describeDevice(label, snap) {
  const own = snap.uid ? (Object.values(STORE.users).find((u) => u.id === snap.uid) || {}).tag : null;
  const mem = markers(snap.mem.profile + snap.mem.lab + snap.mem.camp);
  return label + ' as ' + (own || 'signed-out') + ': memory ids ' + fmt([...mem].sort())
    + ' · gems ' + snap.gems + ' · ls keys holding ids ' + fmt(Object.keys(snap.ls).filter((k) => markers(snap.ls[k]).size).sort());
}
/* Side-store ids are the ones a boot-time localStorage merge can carry:
   _item (hg_itemInventory), _cx (hg_cxHoldings), _tax (hg_frTaxLedger).
   _hero and _core are carried only by Profile / Lab themselves, so a leak of
   THOSE means the account-switch wipe itself did not happen. */
const isSide = (m) => /_(item|cx|tax)$/.test(m);

/* ══════════════════════════════════════════════════════════════════════════
   S1 — ONE DEVICE, TWO ACCOUNTS
   ══════════════════════════════════════════════════════════════════════════ */
const A_GAIN = 987654;
async function scenarioS1(variant, TA, TB, opts = {}) {
  const lbl = 'S1' + variant + (opts.prefix || '');
  console.log('\n  ── ' + lbl + ': one device, account ' + TA + ' then account ' + TB
    + ({ a: ' (clean sign-out, no reload)', b: ' (sign-out whose final push FAILS, no reload)', c: ' (clean sign-out, HARD RELOAD, then B)' })[variant]);
  const A = addUser(TA), B = addUser(TB);
  const dev = await newDevice(lbl + '/device');
  const res = { coreLeak: 0, sideLeak: 0, restore: 0, fails: 0 };
  const tally = (cond, kind) => { if (!cond) { res.fails++; if (kind === 'core') res.coreLeak++; if (kind === 'side') res.sideLeak++; if (kind === 'restore') res.restore++; } };
  const chk = (name, cond, detail, kind) => {
    tally(cond, kind);
    if (opts.quietChecks) return cond;
    return ok(lbl + ': ' + name, cond, detail);
  };
  try {
    await openPage(dev);
    const si = await signIn(dev, A);
    chk('account ' + TA + ' signs in through cloudSignIn (fake auth)', si.ok, si.error);
    const pa = await play(dev, TA, A_GAIN);
    const errs = Object.keys(pa).filter((k) => /Err$/.test(k));
    chk(TA + ' played through the shipped helpers', !errs.length, errs.length ? fmt(pa) : 'gems ' + pa.gems);
    const sa = await sync(dev);
    chk(TA + ' synced (cloudSyncProfile ok)', sa.ok, sa.error);
    /* POSITIVE CONTROL — the markers reach A's own row, so their absence from
       B later is a finding and not a sanitizer. */
    const ra = rowMarkers(A.id);
    const want = ['_item', '_cx', '_tax', '_hero', '_core'].map((s) => 'zz' + TA + s);
    const missing = want.filter((m) => !ra.profile.has(m));
    chk('positive control: every ' + TA + ' marker reached ' + TA + '\'s OWN row', !missing.length, missing.length ? 'missing ' + fmt(missing) : fmt(want));
    chk('positive control: ' + TA + '\'s Cinder reached the canonical row', STORE.progress[A.id] && STORE.progress[A.id].cinder >= A_GAIN,
      'cinder ' + (STORE.progress[A.id] ? STORE.progress[A.id].cinder : 'none'));

    /* S1b: an edit made while the upload is failing, so the side copy the
       sign-out leaves behind really is unsynced (the markers above already
       reached A's row, so on their own they could not show a restore). The
       _d9 ids are what the restore step at the end looks for. */
    const UNS = ['_item', '_cx', '_tax'].map((s) => 'zz' + TA + '_d9' + s);
    const SIDE_BASES = ['hg_itemInventory', 'hg_frTaxLedger', 'hg_cxHoldings', 'hg_side_at'];
    const SIDE_VALS = SIDE_BASES.slice(0, 3);
    const ownKey = (b, u) => b + '@' + u.id;
    const parkedIds = (ls, u) => markers(SIDE_VALS.map((b) => ls[ownKey(b, u)] || '').join('\n'));
    let parkedAt = 0;
    if (variant === 'b') {
      STORE.failUpsertFor[A.id] = true;
      const pu = await play(dev, TA, 0, 'd9');
      await quiet();
      const perr = Object.keys(pu).filter((k) => /Err$/.test(k));
      chk(TA + ' made an edit while its upload is failing', !perr.length, perr.length ? fmt(pu) : '');
      const inRow = UNS.filter((m) => rowMarkers(A.id).profile.has(m));
      chk('precondition: that edit\'s side-store ids are NOT in ' + TA + '\'s row (they are unsynced)', !inRow.length, fmt(inRow));
    }
    const so = await signOut(dev);
    STORE.failUpsertFor[A.id] = false;
    chk('sign-out returned ok', so.ok, so.error);
    if (variant === 'b') chk('sign-out with a failed final push KEEPS the local copy (localCleared=false)', so.localCleared === false, 'localCleared ' + so.localCleared);
    else chk('clean sign-out clears the local copy (localCleared=true)', so.localCleared === true, 'localCleared ' + so.localCleared);
    const after = await snapshot(dev);
    state(describeDevice(lbl + ' after sign-out', after));
    if (variant === 'b') {
      /* The owner's rule: the failed-push copy stays on the device ONLY under
         the leaving account's own key. A side-store key that is un-namespaced,
         or namespaced to anybody else, holding A's ids is a leak. (The main
         hg_profile blob is kept on purpose at this moment and is wiped by the
         switch; the checks after B signs in hold every key to the rule.) */
      const bad = {};
      for (const k of Object.keys(after.ls)) {
        const b = k.split('@')[0];
        if (!SIDE_BASES.includes(b) || k === ownKey(b, A)) continue;
        const f = foreign(markers(after.ls[k]), '-');
        if (f.length) bad[k.split(A.id).join('<' + TA + '>')] = f;
      }
      chk('after the failed-push sign-out no side-store key except ' + TA + '\'s own @<' + TA + '> keys holds ' + TA + '\'s ids', !Object.keys(bad).length, fmt(bad), 'side');
      const pk = parkedIds(after.ls, A);
      const notParked = UNS.filter((m) => !pk.has(m));
      chk('the unsynced side-store values are parked under ' + TA + '\'s own @<' + TA + '> keys', !notParked.length, notParked.length ? 'missing ' + fmt(notParked) : fmt(UNS), 'restore');
      parkedAt = Number(after.ls[ownKey('hg_side_at', A)]) || 0;
    }
    if (variant !== 'b') {
      const left = lsForeign(after.ls, '-', true);   // any id at all = something left on the device
      chk('after a clean sign-out no localStorage key still holds ' + TA + '\'s ids', !Object.keys(left).length, fmt(left), 'side');
    }
    if (variant === 'c') {
      await reload(dev);
      const g = await snapshot(dev);
      state(describeDevice(lbl + ' after the hard reload, nobody signed in', g));
      const gm = foreign(markers(g.mem.profile + g.mem.lab + g.mem.camp), '-');
      chk('after the reload the signed-out page\'s memory holds none of ' + TA + '\'s ids (the boot merge had nothing of theirs to take)', !gm.length, fmt(gm), gm.some((m) => !isSide(m)) ? 'core' : 'side');
    }

    const sb = await signIn(dev, B);
    chk('account ' + TB + ' signs in on the same device', sb.ok, sb.error);
    await play(dev, TB, 1234, '', { side: false });
    const sbs = await sync(dev);
    chk(TB + ' synced', sbs.ok, sbs.error);

    const check = async (when) => {
      const s = await snapshot(dev);
      state(describeDevice(lbl + ' ' + when, s));
      chk(when + ': the page is signed in as ' + TB, s.uid === B.id, 'uid tag ' + ((STORE.users[s.uid] || {}).tag || s.uid));
      const mem = foreign(markers(s.mem.profile + s.mem.lab + s.mem.camp), TB);
      const memCore = mem.filter((m) => !isSide(m)), memSide = mem.filter(isSide);
      chk(when + ': ' + TB + '\'s in-memory Profile/Lab/Camp holds no hero/core of ' + TA, !memCore.length, fmt(memCore), 'core');
      chk(when + ': ' + TB + '\'s in-memory Profile holds no side-store id (item/cx/tax) of ' + TA, !memSide.length, fmt(memSide), 'side');
      const ls = lsForeign(s.ls, TB);
      const lsCore = {}, lsSide = {};
      for (const k of Object.keys(ls)) { const c = ls[k].filter((m) => !isSide(m)), d = ls[k].filter(isSide); if (c.length) lsCore[k] = c; if (d.length) lsSide[k] = d; }
      chk(when + ': no localStorage key holds a hero/core of ' + TA, !Object.keys(lsCore).length, fmt(lsCore), 'core');
      chk(when + ': no localStorage key holds a side-store id of ' + TA + ' (hg_itemInventory / hg_cxHoldings / hg_frTaxLedger)', !Object.keys(lsSide).length, fmt(lsSide), 'side');
      const ups = STORE.upserts.filter((x) => x.uid === B.id);
      const upF = new Set(); for (const x of ups) for (const m of foreign(markers(JSON.stringify(x.body)), TB)) upF.add(m);
      const upCore = [...upF].filter((m) => !isSide(m)).sort(), upSide = [...upF].filter(isSide).sort();
      chk(when + ': no upsert sent for ' + TB + ' (' + ups.length + ' so far) carries a hero/core of ' + TA, !upCore.length, fmt(upCore), 'core');
      chk(when + ': no upsert sent for ' + TB + ' carries a side-store id of ' + TA, !upSide.length, fmt(upSide), 'side');
      const rb = rowMarkers(B.id);
      const rowF = foreign(new Set([...rb.profile, ...rb.progress]), TB);
      chk(when + ': ' + TB + '\'s rows (user_profiles + user_progress) hold none of ' + TA + '\'s ids', !rowF.length, fmt(rowF), rowF.some((m) => !isSide(m)) ? 'core' : 'side');
      const pb = STORE.progress[B.id];
      chk(when + ': ' + TB + '\'s canonical Cinder does not include ' + TA + '\'s ' + A_GAIN, !pb || pb.cinder < A_GAIN, 'cinder ' + (pb ? pb.cinder : 'no-row'), 'core');
      chk(when + ': ' + TB + '\'s own markers are present (the check is not vacuous)', rb.profile.has('zz' + TB + '_hero') && rb.profile.has('zz' + TB + '_core'), fmt([...rb.profile].sort()));
    };
    await check('after ' + TB + ' signs in');
    /* The side stores are merged back in at BOOT, so the leak (if any) shows on
       the next load of B's persisted session, not before it. */
    await reload(dev);
    await waitHydrated(dev.page, B.id);
    const sr = await sync(dev);
    chk('after reload ' + TB + ' synced again', sr.ok, sr.error);
    await check('after ' + TB + ' reloads');

    if (variant === 'b') {
      /* RESTORE. B leaves cleanly, A comes back on the same device and must get
         its unsynced side-store values back. _sideAdoptFor() merges A's own
         copy (written after A's cloud row) and opens the write gate; it does
         NOT delete the @<A> keys, it only removes the plain guest keys. The
         next side write (cloudFetchProfile calls _saveCxHoldings right after)
         rewrites them from A's live Profile. So the copy is SUPERSEDED, not
         gone: hg_side_at@<A> moves past the parked stamp, and no @<A> key holds
         anything A's live Profile does not. */
      console.log('   ── ' + lbl + ' restore: ' + TB + ' signs out, ' + TA + ' signs back in on the same device');
      const pre = await snapshot(dev);
      const still = parkedIds(pre.ls, A);
      chk('restore precondition: while ' + TB + ' played, ' + TA + '\'s copy still waited under its own key', UNS.every((m) => still.has(m)), fmt([...still].sort()), 'restore');
      const bo = await signOut(dev);
      chk(TB + ' signs out cleanly (localCleared=true)', bo.ok && bo.localCleared === true, 'ok ' + bo.ok + ' localCleared ' + bo.localCleared);
      const sinceA = STORE.upserts.length;
      const sa2 = await signIn(dev, A);
      chk('account ' + TA + ' signs back in on the same device', sa2.ok, sa2.error);
      const s1 = await snapshot(dev);
      state(describeDevice(lbl + ' after ' + TA + ' signs back in', s1));
      chk('restore: the page is signed in as ' + TA, s1.uid === A.id, 'uid tag ' + ((STORE.users[s1.uid] || {}).tag || s1.uid), 'restore');
      const memA = markers(s1.mem.profile);
      const lackMem = UNS.filter((m) => !memA.has(m));
      chk('restore: ' + TA + '\'s in-memory Profile got its unsynced item / cx / tax values back', !lackMem.length, lackMem.length ? 'lacks ' + fmt(lackMem) : fmt(UNS), 'restore');
      const memB = foreign(markers(s1.mem.profile + s1.mem.lab + s1.mem.camp), TA);
      chk('restore: ' + TA + '\'s memory holds none of ' + TB + '\'s ids', !memB.length, fmt(memB), 'core');
      const lostCore = ['_hero', '_core'].map((x) => 'zz' + TA + '_d9' + x).filter((m) => !markers(s1.mem.profile + s1.mem.lab).has(m));
      if (lostCore.length) state(lbl + ' unsynced NON-side-store ids not restored (they lived only in the main blob the switch wiped): ' + fmt(lostCore));
      const sy = await sync(dev);
      chk('restore: ' + TA + ' synced after coming back', sy.ok, sy.error);
      const upsA = STORE.upserts.slice(sinceA).filter((x) => x.uid === A.id);
      const lastA = upsA[upsA.length - 1];
      const lackUp = lastA ? UNS.filter((m) => !markers(JSON.stringify(lastA.body)).has(m)) : UNS;
      chk('restore: ' + TA + '\'s latest upload (' + upsA.length + ' since sign-in) carries them', !lackUp.length, lackUp.length ? 'lacks ' + fmt(lackUp) : '', 'restore');
      const lackRow = UNS.filter((m) => !rowMarkers(A.id).profile.has(m));
      chk('restore: ' + TA + '\'s row now holds them', !lackRow.length, lackRow.length ? 'lacks ' + fmt(lackRow) : '', 'restore');
      const s2 = await snapshot(dev);
      const at2 = Number(s2.ls[ownKey('hg_side_at', A)]) || 0;
      chk('restore: the parked copy was superseded (hg_side_at@<' + TA + '> rewritten after adoption)', parkedAt > 0 && at2 > parkedAt, 'parked ' + parkedAt + ' now ' + at2, 'restore');
      const memNow = markers(s2.mem.profile);
      const stale = {};
      for (const b of SIDE_VALS) {
        const extra = [...markers(s2.ls[ownKey(b, A)] || '')].filter((m) => !memNow.has(m));
        if (extra.length) stale[b + '@<' + TA + '>'] = extra;
      }
      chk('restore: every @<' + TA + '> side key holds only what ' + TA + '\'s live Profile holds', !Object.keys(stale).length, fmt(stale), 'restore');
      const lsB = lsForeign(s2.ls, TA, true);
      chk('restore: no localStorage key holds ' + TB + '\'s ids', !Object.keys(lsB).length, fmt(lsB), 'side');
      const plain = Object.keys(s2.ls).filter((k) => SIDE_BASES.includes(k) && markers(s2.ls[k]).size);
      chk('restore: no un-namespaced side-store key holds anyone\'s ids', !plain.length, fmt(plain), 'side');
      const everB = new Set();
      for (const x of STORE.upserts.filter((u) => u.uid === B.id)) for (const m of markers(JSON.stringify(x.body))) if (UNS.includes(m)) everB.add(m);
      for (const m of rowMarkers(B.id).profile) if (UNS.includes(m)) everB.add(m);
      chk('restore: ' + TB + ' never saw the unsynced values (no ' + TB + ' upload or row, over the whole run, carried them)', !everB.size, fmt([...everB]), 'side');
    }
    state(describeRow(A));
    state(describeRow(B));
    if (PARKED.length) state(lbl + ' parked under their own owner key (allowed): ' + fmt([...new Set(PARKED)]));
    PARKED.length = 0;
    if (dev.errors.length) state(lbl + ' page errors (first 3): ' + fmt(dev.errors.slice(0, 3)));
  } catch (e) {
    chk('scenario ran to the end', false, String(e && e.message || e).slice(0, 300));
  } finally {
    await dev.context.close().catch(() => {});
  }
  return res;
}

/* ══════════════════════════════════════════════════════════════════════════
   S2 — ONE ACCOUNT, TWO DEVICES (plus the laptop that was left open)
   ══════════════════════════════════════════════════════════════════════════ */
const C_GAIN = 54321;
async function scenarioS2() {
  const T = 'C';
  const lbl = 'S2';
  console.log('\n  ── S2: one account (' + T + '), device 1 + device 2, and device 3 left open with an unsynced edit');
  const C = addUser(T);
  const d1 = await newDevice('S2/device1');
  const d2 = await newDevice('S2/device2');
  const d3 = await newDevice('S2/device3');
  const lacks = (set, list) => list.filter((m) => !set.has(m));
  const D1 = ['zzC_d1_item', 'zzC_d1_cx', 'zzC_d1_hero', 'zzC_d1_core', 'zzC_d1_tax'];
  const D2 = ['zzC_d2_item', 'zzC_d2_cx', 'zzC_d2_hero', 'zzC_d2_core', 'zzC_d2_tax'];
  try {
    /* device 1 plays and syncs, then its tab is closed (the disk save stays) */
    await openPage(d1);
    ok(lbl + ': device 1 signs in', (await signIn(d1, C)).ok);
    await play(d1, T, C_GAIN, 'd1');
    ok(lbl + ': device 1 synced', (await sync(d1)).ok);
    const miss1 = lacks(rowMarkers(C.id).profile, D1);
    ok(lbl + ': positive control: device 1\'s progress is in the row', !miss1.length, miss1.length ? 'missing ' + fmt(miss1) : '');
    await d1.page.close();
    await quiet();

    /* device 3 signs in, holds device 1's progress, then makes an edit whose
       upload FAILS, so pendingChanges is set and stays set */
    await openPage(d3);
    ok(lbl + ': device 3 signs in', (await signIn(d3, C)).ok);
    STORE.failDevice[d3.label] = true;
    await play(d3, T, 0, 'd3');
    const s3sync = await sync(d3);
    const pend = await d3.page.evaluate(() => ({ pending: !!Profile.cloud.pendingChanges, edit: Profile.cloud.lastLocalEditAt || 0 }));
    ok(lbl + ': device 3\'s upload failed and left pendingChanges set (the stale-pending precondition)',
      !s3sync.ok && pend.pending, 'sync ok=' + s3sync.ok + ' pending=' + pend.pending);
    /* the gap the freshness guard's 5 s grace needs, spent for real rather
       than faked by rewinding a timestamp */
    await sleep(6500);

    /* device 2: fresh context, signs in, must hold device 1's progress */
    await openPage(d2);
    ok(lbl + ': device 2 signs in on a fresh context', (await signIn(d2, C)).ok);
    const s2 = await snapshot(d2);
    const m2 = markers(s2.mem.profile + s2.mem.lab + s2.mem.camp);
    state(describeDevice(lbl + ' device 2 after sign-in', s2));
    for (const m of D1) ok(lbl + ': device 2 holds device 1\'s ' + m.replace('zzC_d1_', ''), m2.has(m));
    ok(lbl + ': device 2 holds device 1\'s Cinder (' + C_GAIN + ')', (s2.gems | 0) >= C_GAIN, 'gems ' + s2.gems);
    await play(d2, T, 0, 'd2');
    ok(lbl + ': device 2 synced its own progress', (await sync(d2)).ok);
    const miss2 = lacks(rowMarkers(C.id).profile, D2);
    ok(lbl + ': positive control: device 2\'s progress is in the row', !miss2.length, miss2.length ? 'missing ' + fmt(miss2) : '');
    const rowAt = Date.parse((STORE.profiles[C.id] || {}).updated_at || 0);
    ok(lbl + ': device 3\'s unsynced edit is older than device 2\'s write by more than the 5 s grace',
      pend.edit > 0 && pend.edit < rowAt - 5000, 'gap ' + (rowAt - pend.edit) + ' ms');

    const checkD = async (dev, name, since) => {
      const s = await snapshot(dev);
      state(describeDevice(lbl + ' ' + name, s));
      const m = markers(s.mem.profile + s.mem.lab + s.mem.camp);
      const lacking = lacks(m, D2);
      ok(lbl + ': ' + name + ' holds device 2\'s newer progress', !lacking.length, lacking.length ? 'lacks ' + fmt(lacking) : '');
      const sent = STORE.upserts.slice(since).filter((x) => x.device === dev.label);
      const stale = sent.filter((x) => lacks(markers(JSON.stringify(x.body)), ['zzC_d2_hero', 'zzC_d2_item']).length > 0);
      ok(lbl + ': ' + name + ' sent no upsert lacking device 2\'s progress (' + sent.length + ' sent)', !stale.length,
        stale.length ? stale.length + ' stale copies' : '');
      const lost = lacks(rowMarkers(C.id).profile, D2.concat(D1));
      ok(lbl + ': the row still holds both devices\' progress after ' + name, !lost.length, lost.length ? 'lost ' + fmt(lost) : '');
    };

    /* S2a — device 1 REOPENS on its stale disk save (persisted session) */
    const before1 = STORE.upserts.length;
    const p1 = await d1.context.newPage();
    d1.page = p1;
    p1.on('pageerror', (e) => d1.errors.push(String(e).slice(0, 160)));
    await p1.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 120000 });
    await waitBoot(p1);
    await waitHydrated(p1, C.id);
    await checkD(d1, 'device 1 reopened', before1);
    ok(lbl + ': device 1 (reopened) syncs', (await sync(d1)).ok);
    await checkD(d1, 'device 1 reopened, after its own sync', before1);

    /* S2b — device 3 was left open; the network comes back and its fetch runs */
    const before3 = STORE.upserts.length;
    STORE.failDevice[d3.label] = false;
    const f3 = await d3.page.evaluate(() => cloudFetchProfile().then((x) => ({ ok: !!(x && x.ok), skippedMerge: !!(x && x.skippedMerge), recoveredLocal: !!(x && x.recoveredLocal), error: (x && x.error) || '' })));
    await quiet(2500);
    ok(lbl + ': device 3\'s fetch MERGED the cloud instead of keeping its stale copy', f3.ok && !f3.skippedMerge && !f3.recoveredLocal, fmt(f3));
    await checkD(d3, 'device 3 (stale pending)', before3);
    const s3b = await sync(d3);
    ok(lbl + ': device 3 syncs', s3b.ok, s3b.error);
    { const sent = STORE.upserts.slice(before3).filter((x) => x.device === d3.label); const last = sent[sent.length - 1];
      state('device 3 upserts since the network came back: ' + sent.length + ' · last body ids ' + fmt(last ? [...markers(JSON.stringify(last.body))].sort() : [])); }
    await checkD(d3, 'device 3, after its own sync', before3);
    await quiet(3000);
    state(describeRow(C));
    /* 🔴 FINDING, REPORTED AND NOT COUNTED (the fix is index.html, not this
       harness's lane). A SUCCESSFUL cloudSyncProfile() ends in saveProfile(),
       and saveProfile() calls _scheduleCloudSync(), which sets pendingChanges
       and uploads again 2 s later — forever. So every signed-in tab, idle or
       not, upserts its WHOLE row every ~2 s (measured here: devices 1 and 2,
       both idle, alternate without end; live pg_stat_user_tables on
       2026-09-17 read 5,460,940 updates across 129 user_profiles rows). The
       consequence for two devices: a device that fetched before another
       device's edit keeps re-uploading its copy, and device 3's late edit is
       gone from the row within one cycle, even though device 3 sent it. The
       S2 checks above ask only the question this piece was set (device 1 must
       not overwrite device 2's newer progress); this line keeps the wider
       fact visible until the loop is fixed. */
    { const tail = STORE.upserts.slice(before3).filter((x) => x.uid === C.id);
      const idle = tail.filter((x) => x.device !== d3.label).length;
      const d3In = rowMarkers(C.id).profile.has('zzC_d3_hero');
      state('upserts for C since device 3 came back: ' + tail.length + ' (' + idle + ' from devices 1/2 that did nothing) · device 3\'s late edit in the row now: ' + d3In);
      if (!d3In || idle > 4) console.log('   · FINDING idle signed-in tabs re-upload the whole row every ~2 s (cloudSyncProfile success -> saveProfile -> _scheduleCloudSync), and those copies overwrote device 3\'s late edit: ' + (d3In ? 'kept' : 'LOST')); }
    for (const d of [d1, d2, d3]) if (d.errors.length) state(d.label + ' page errors (first 3): ' + fmt(d.errors.slice(0, 3)));
  } catch (e) {
    ok(lbl + ': scenario ran to the end', false, String(e && e.message || e).slice(0, 300));
  } finally {
    for (const d of [d1, d2, d3]) await d.context.close().catch(() => {});
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   S3 — the store, after everything
   ══════════════════════════════════════════════════════════════════════════ */
function scenarioS3() {
  console.log('\n  ── S3: every row holds only its own account\'s ids');
  for (const u of Object.values(STORE.users)) {
    if (!STORE.profiles[u.id] && !STORE.progress[u.id]) continue;
    const r = rowMarkers(u.id);
    const f = foreign(new Set([...r.profile, ...r.progress]), u.tag);
    state(describeRow(u));
    ok('S3: ' + u.tag + '\'s rows hold only ' + u.tag + '\'s ids', !f.length, f.length ? 'foreign ' + fmt(f) : r.profile.size + ' own ids');
  }
  ok('S3: no client write was refused by the fake RLS (nobody tried to write another account\'s row)', !STORE.rlsRefusals.length,
    STORE.rlsRefusals.length ? fmt(STORE.rlsRefusals.slice(0, 3).map((x) => ({ table: x.table, device: x.device }))) : '');
  ok('S3: the fake answered every request without an internal error', !STORE.unhandledSupabase.length, fmt(STORE.unhandledSupabase.slice(0, 3)));
}

/* ══════════════════════════════════════════════════════════════════════════
   RUN
   ══════════════════════════════════════════════════════════════════════════ */
const want = (id) => !ONLY.length || ONLY.includes(id);
const t0 = Date.now();
console.log('\n\u{1FAAA} ACCOUNT ISOLATION: two accounts on one device, one account on two devices, real client, fake shared Supabase\n');
try {
  const base = pageSource(PAGE_ARG);
  if (MUTANT) {
    const mu = makeMutant(MUTANT, base);
    ok('mutant anchors found (each exactly once)', mu.hits.every((h) => h === 1), fmt(mu.hits));
    INDEX_BODY = Buffer.from(mu.out);
    fs.writeFileSync(path.join(TMP, 'index.' + MUTANT + '.html'), mu.out);
    console.log('  page: THROWAWAY MUTANT ' + MUTANT + ' (' + mu.desc + '), written to the OS temp dir');
  } else {
    INDEX_BODY = Buffer.from(base);
    console.log('  page: ' + (PAGE_ARG ? path.resolve(PAGE_ARG) : 'public/index.html (working tree)') + ' · ' + INDEX_BODY.length + ' bytes');
  }
  browser = await chromium.launch({ headless: true });

  if (want('S1a')) await scenarioS1('a', 'A1', 'B1');
  if (want('S1b')) await scenarioS1('b', 'A2', 'B2');
  if (want('S1c')) await scenarioS1('c', 'A3', 'B3');
  if (want('S2'))  await scenarioS2();
  scenarioS3();

  console.log('\n  ── network');
  ok('supabase-js loaded from the page\'s own CDN tag (the real client ran)', !!SUPA_JS, SUPA_JS ? SUPA_JS.body.length + ' bytes' : 'NOT LOADED');
  ok('every request to ' + SUPA_HOST + ' was answered by the fake (none reached the real project)',
    NET.supabaseSeen > 0 && NET.supabaseSeen === NET.supabaseFulfilled,
    'seen ' + NET.supabaseSeen + ' · fulfilled by fake ' + NET.supabaseFulfilled + ' · realtime sockets refused ' + NET.wsSupabase + ' · other off-box requests aborted ' + NET.aborted);

  if (RUN_NEG) {
    console.log('\n  ── NEGATIVE CONTROL: S1a/S1b against a throwaway copy with the account-switch wipe disabled');
    const mu = makeNoWipe(base);
    ok('NEG: mutant anchors found (each exactly once)', mu.hits.every((h) => h === 1), fmt(mu.hits));
    fs.writeFileSync(path.join(TMP, 'index.nowipe.html'), mu.out);
    INDEX_BODY = Buffer.from(mu.out);
    STORE = makeStore();
    const na = await scenarioS1('a', 'N', 'O', { quietChecks: true, prefix: '-NEG' });
    const nb = await scenarioS1('b', 'P', 'Q', { quietChecks: true, prefix: '-NEG' });
    state('NEG S1a: ' + na.fails + ' failing checks (' + na.coreLeak + ' hero/core leaks, ' + na.sideLeak + ' side-store leaks)');
    state('NEG S1b: ' + nb.fails + ' failing checks (' + nb.coreLeak + ' hero/core leaks, ' + nb.sideLeak + ' side-store leaks)');
    ok('NEG: with the wipe disabled, S1a goes RED on a hero/Lab-core leak (the harness can see a switch leak)', na.coreLeak > 0, na.coreLeak + ' core leaks');
    ok('NEG: with the wipe disabled, S1b goes RED on a hero/Lab-core leak', nb.coreLeak > 0, nb.coreLeak + ' core leaks');
    ok('NEG: every mutant request was still answered by the fake', NET.supabaseSeen === NET.supabaseFulfilled, 'seen ' + NET.supabaseSeen + ' fulfilled ' + NET.supabaseFulfilled);
  }
} catch (e) {
  ok('the harness ran to the end', false, String(e && e.stack || e).slice(0, 400));
} finally {
  try { if (browser) await browser.close(); } catch (e) {}
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}
console.log('\n  ' + passes + ' passed, ' + fails + ' failed · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
