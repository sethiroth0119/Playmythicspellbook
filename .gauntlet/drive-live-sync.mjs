/* ══════════════════════════════════════════════════════════════════════════
   🔁 DRIVE-LIVE-SYNC — one account open on two devices at once converges in
   the background, silently, and an idle tab still writes nothing.

   THE ASK (owner, 2026-09-18, with a screenshot of the banner "☁ This account
   was saved on another device — merged that progress with the progress on this
   device before saving."): "Make the merge of devices automatic and do not show
   this message. Where the same thing from one device is shown automatically on
   the other device, and then if the player logs into the other device the
   player picks back up from what they did on the other device."

   WHAT CHANGED IN index.html, and what this drives:
     · the CAS-conflict toast is gone (console.info only), the conflict error no
       longer lights the orange save pill, and a conflict retries fast;
     · _profileLivePull(): while the tab is visible, a one-column PROBE of the
       player's own row (updated_at) every 20–30 s (plus on visible / focus /
       online); a moved row is merged through cloudFetchProfile({background})
       — the same per-field merge — persisted locally only, and re-rendered
       once. It stands down while this device has its own unsent edit, and
       defers while the player types, drags, clicks, battles or has a modal up.

   HOW. Same rig as drive-two-device.mjs (copied, because importing that file
   RUNS it): the real public/index.html in Playwright contexts (one context =
   one device), the page's own supabase-js, and every request to the project
   host answered by an in-process fake both contexts share. The fake stamps
   updated_at server-side (user_profiles_touch), honours the CAS filter on
   PATCH, enforces RLS auth.uid() = user_id, logs every user_profiles write per
   device and counts the one-column probes. Realtime sockets are refused (the
   live table is not in the supabase_realtime publication, so polling is what
   ships). Nothing reaches the live project; the suite asserts that.

   CHECKS (one account, devices A and B)
     d   B signs in on a fresh device after A played → B holds A's progress, no
         device banner. d2: B's tab closed, A plays on, B REOPENS (persisted
         session) → B holds it, and B's first upload is not a stale copy.
     a   A edits + saves → B shows it within one pull interval, no reload, no
         banner, and B wrote nothing while it caught up (no echo).
     b   B edits while A idles → A converges the same way.
     c   A (heroes) and B (Lab cores) edit DIFFERENT stores and save at the same
         moment → one compare-and-set loses (asserted: the conflict path ran),
         merges silently, and both edits end up on both devices and in the row.
     f   B has a text field focused with typing in it → a background pull does
         not merge or re-render under it (deferred, field intact, still
         focused); once the field is left, B converges.
     e   both tabs idle 120 s → ZERO writes to user_profiles, while the probe
         loop is demonstrably alive (probes > 0 on both).
   NEGATIVE CONTROLS (each must go red, or this suite's green means nothing)
     NEG-PRE     scenario c against the pre-change page (pinned commit
                 4237de9973, git show with core.eol=lf): the device banner MUST
                 be shown there.
     NEG-NOPULL  scenario a against a throwaway copy of the working tree whose
                 _profileLivePull() returns at once: B must NOT catch up.

   Usage:
     node .gauntlet/drive-live-sync.mjs
     node .gauntlet/drive-live-sync.mjs --page=<index.html>   (main run on another file)
     node .gauntlet/drive-live-sync.mjs --no-negative
     node .gauntlet/drive-live-sync.mjs --idle=120           (e, seconds)
   Output: PASS/FAIL + STATE lines with marker ids and counts only. Emails are
   fake (@harness.invalid) and never printed.
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
const IDLE_S = Math.max(30, Number(argVal('idle')) || 120);
const PRE_REF = '4237de9973';   // the commit before this change (pinned, never HEAD)
const PULL_WAIT_MS = 40000;     // one full pull interval (20–30 s) + the probe + slack
const SUPA_HOST = 'ktsiasyjusesawtrwrjc.supabase.co';
const BANNER_RE = /another device|merged that progress/i;

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
    writes: [],          // { uid, device, method, kind, at, result }
    probes: [],          // { device, at } — GET user_profiles?select=updated_at
    fetches: [],         // { device, at } — GET user_profiles?select=*
    rlsRefusals: [], lastAt: 0, internal: [] };
}
let STORE = makeStore();
let STAMP_SEQ = 0;
function pgNow() {
  const d = new Date();
  const us = String((d.getMilliseconds() * 1000) + ((STAMP_SEQ++) % 1000)).padStart(6, '0');
  return d.toISOString().slice(0, 19) + '.' + us + '+00:00';
}
function addUser(tag) {
  const id = ('00000000-0000-4000-8000-' + (Buffer.from(tag).toString('hex') + '000000000000').slice(0, 12));
  const email = 'live-' + tag.toLowerCase() + '@harness.invalid';
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
/* PostgREST column selection, for the one-column probe: `select=updated_at`
   returns exactly that column, as the live API does. */
function project(url, rows) {
  const sel = url.searchParams.get('select');
  if (!sel || sel === '*') return rows;
  const cols = sel.split(',').map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => { const o = {}; for (const c of cols) if (c in r) o[c] = r[c]; return o; });
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
  if (method === 'GET' || method === 'HEAD') {
    if (bucket === 'profiles') (url.searchParams.get('select') === 'updated_at' ? STORE.probes : STORE.fetches).push({ device, at: Date.now() });
    return pgrstRows(req, project(url, match()));
  }
  if (method !== 'POST' && method !== 'PATCH') return J(method === 'DELETE' ? 204 : 405);
  const isProfiles = bucket === 'profiles';
  const upsert = /resolution=merge-duplicates/.test(prefer);
  const kind = method === 'PATCH' ? ('update' + (filt.updated_at ? '+cas' : '')) : (upsert ? 'upsert' : 'insert');
  const log = isProfiles ? { uid: sub, device, method, kind, at: Date.now(), result: '' } : null;
  if (log) STORE.writes.push(log);
  const out = [];
  if (method === 'PATCH') {
    for (const r of match()) {
      if (!sub || r.user_id !== sub) { STORE.rlsRefusals.push({ table, device }); continue; }
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
  if (/return=representation/.test(prefer)) return pgrstRows(req, project(url, out));
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
const NET = { seen: 0, fulfilled: 0, aborted: 0, ws: 0 };
let browser;
/* Every piece of text the page ADDS to the document is scanned for the device
   banner — not just showToast, so a message from any other path (a pill, a
   modal, a status line) is caught too. Script/style text is not page text. */
function bannerWatch() {
  window.__deviceBanners = [];
  const RX = /another device|merged that progress/i;
  const textOf = (n) => {
    if (!n) return '';
    if (n.nodeType === 3) { const p = n.parentNode; return (p && /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(p.nodeName)) ? '' : (n.nodeValue || ''); }
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.nodeName)) return '';
    let s = '';
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) { const p = t.parentNode; if (!p || !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(p.nodeName)) s += t.nodeValue; }
    return s;
  };
  const hit = (n) => { try { const t = textOf(n); if (t && RX.test(t)) window.__deviceBanners.push(t.replace(/\s+/g, ' ').trim().slice(0, 200)); } catch (e) {} };
  const start = () => {
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') hit(m.target); else m.addedNodes.forEach(hit); } })
      .observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
}
async function newDevice(label) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'block' });
  const dev = { label, context, page: null, errors: [], loads: 0 };
  await context.addInitScript(bannerWatch);
  await context.routeWebSocket(/.*/, (ws) => { NET.ws++; try { ws.close(); } catch (e) {} });
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
  // Record every toast too (a global function declaration is a writable window property).
  await page.evaluate(() => {
    window.__toasts = window.__toasts || [];
    const o = window.showToast;
    if (typeof o === 'function' && !o.__rec) {
      const w = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return o.apply(this, arguments); };
      w.__rec = true;
      window.showToast = w;
    }
    window.__liveToken = window.__liveToken || ('tok-' + Math.random().toString(36).slice(2));
  });
  await quiet();
}
async function openPage(dev) {
  const page = await dev.context.newPage();
  dev.page = page;
  page.on('pageerror', (e) => dev.errors.push(String(e).slice(0, 160)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('load', () => { dev.loads++; });
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 120000 });
  await waitBoot(page);
  dev.token = await page.evaluate(() => window.__liveToken);
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
/* Edits, through the helpers the game's own screens use. `hero` touches the
   heroes column (merged per id); `core` touches the Lab (forge.__labCores__,
   union-merged) — two DIFFERENT stores for check c. */
async function edit(dev, tag, which) {
  return dev.page.evaluate(([T, W]) => {
    if (W === 'core') {
      const lab = _labStore();
      lab.cores = Array.isArray(lab.cores) ? lab.cores : [];
      lab.cores.push({ id: 'zz' + T + '_core', createdAt: Date.now(), parents: [] });
      saveLab();
      return saveProfile();
    }
    Profile.heroes = Profile.heroes || {};
    Profile.heroes['zz' + T + '_hero'] = { level: 7, xp: 12, knownMoves: [] };
    return saveProfile();
  }, [tag, which || 'hero']);
}
const MARK_RE = /zz[A-Za-z0-9]+_(hero|core)/g;
const markers = (t) => new Set(String(t).match(MARK_RE) || []);
const rowIds = (uid) => markers(JSON.stringify(STORE.profiles[uid] || {}));
async function memIds(dev) { return markers(await dev.page.evaluate(() => { let lab = null; try { lab = _labStore(); } catch (e) {} return JSON.stringify({ h: Profile.heroes, l: lab }); })); }
const writesBy = (dev, since) => STORE.writes.slice(since).filter((w) => w.device === dev.label);
const probesBy = (dev, since) => STORE.probes.filter((p) => p.device === dev.label && p.at >= since).length;
async function banners(dev) {
  return dev.page.evaluate(() => ({
    dom: (window.__deviceBanners || []).slice(),
    toasts: (window.__toasts || []).filter((t) => /another device|merged that progress/i.test(t)),
  }));
}
async function liveStats(dev) {
  return dev.page.evaluate(() => (window.ProfileLiveSync ? JSON.parse(JSON.stringify({ stats: ProfileLiveSync.state.stats, last: ProfileLiveSync.state.last })) : null));
}
/* Poll a device's MEMORY (no page call that could itself sync) until it holds
   every marker, or the wait runs out. Returns ms taken, or -1. */
async function waitHolds(dev, list, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const m = await memIds(dev);
    if (list.every((x) => m.has(x))) return Date.now() - t0;
    await sleep(1000);
  }
  return -1;
}
async function sameTab(dev) {
  const tok = await dev.page.evaluate(() => window.__liveToken).catch(() => null);
  return tok && tok === dev.token;
}

/* ══ THE SCENARIO ═════════════════════════════════════════════════════════ */
async function scenario(lbl, tag, steps) {
  const want = (s) => steps.includes(s);
  const U = addUser(tag);
  const A = await newDevice(lbl + '/A'), B = await newDevice(lbl + '/B');
  const T = (s) => tag + s;
  const res = { aCaught: false, bannerSeen: 0, conflicts: 0 };
  const noBanner = async (dev, when) => {
    const b = await banners(dev);
    const n = b.dom.length + b.toasts.length;
    res.bannerSeen += n;
    return ok(lbl + ': ' + when + ' — no device-merge banner on ' + dev.label.split('/')[1], n === 0, n ? fmt(b.dom.concat(b.toasts).slice(0, 2)) : '');
  };
  try {
    /* A plays */
    await openPage(A);
    ok(lbl + ': device A signs in', (await signIn(A, U)).ok);
    await edit(A, T('a0'));
    ok(lbl + ': device A saved', (await sync(A)).ok);
    ok(lbl + ': positive control: A\'s progress is in the row', rowIds(U.id).has('zz' + T('a0') + '_hero'), fmt([...rowIds(U.id)]));

    /* d — B signs in on a fresh device after A played */
    await openPage(B);
    ok(lbl + ': (d) device B signs in on a fresh device', (await signIn(B, U)).ok);
    { const m = await memIds(B); ok(lbl + ': (d) B picked up A\'s progress on sign-in', m.has('zz' + T('a0') + '_hero'), fmt([...m])); }
    await noBanner(B, '(d) sign-in');
    if (!QUIET_CHECKS) ok(lbl + ': the live pull is installed on both devices', !!(await liveStats(A)) && !!(await liveStats(B)));
    await quiet(2500);
    await sleep(3000);

    if (want('a')) {
      /* a — A edits, B catches up on its own */
      const sinceW = STORE.writes.length;
      await edit(A, T('a1'));
      const sa = await sync(A);
      ok(lbl + ': (a) A saved a new edit', sa.ok, sa.error);
      const bWritesBefore = writesBy(B, sinceW).length;
      const ms = await waitHolds(B, ['zz' + T('a1') + '_hero'], PULL_WAIT_MS);
      res.aCaught = ms >= 0;
      ok(lbl + ': (a) B shows A\'s edit without a reload, within one pull interval', ms >= 0, ms >= 0 ? (ms / 1000).toFixed(1) + ' s after A saved' : 'not within ' + PULL_WAIT_MS / 1000 + ' s');
      ok(lbl + ': (a) B was not reloaded (same tab, same document)', await sameTab(B));
      await quiet(2500);
      const bw = writesBy(B, sinceW).length - bWritesBefore;
      ok(lbl + ': (a) B wrote nothing while catching up (a background merge is not an edit — no echo)', bw === 0, bw + ' write(s) · ' + fmt(writesBy(B, sinceW).map((w) => w.kind + ':' + w.result)));
      const st = await liveStats(B);
      if (st) ok(lbl + ': (a) B merged through the live pull and re-rendered once for it', st.stats.merges >= 1 && st.stats.renders >= 1, fmt(st.stats));
      await noBanner(A, '(a)'); await noBanner(B, '(a)');
    }

    if (want('b')) {
      /* b — B edits while A idles */
      await sleep(3000);
      const sinceW = STORE.writes.length;
      await edit(B, T('b1'));
      ok(lbl + ': (b) B saved its edit', (await sync(B)).ok);
      const ms = await waitHolds(A, ['zz' + T('b1') + '_hero'], PULL_WAIT_MS);
      ok(lbl + ': (b) A (idle) converged to B\'s edit without a reload', ms >= 0, ms >= 0 ? (ms / 1000).toFixed(1) + ' s' : 'not within ' + PULL_WAIT_MS / 1000 + ' s');
      ok(lbl + ': (b) A was not reloaded', await sameTab(A));
      await quiet(2500);
      const aw = writesBy(A, sinceW).length;
      ok(lbl + ': (b) A wrote nothing while catching up', aw === 0, aw + ' write(s)');
      await noBanner(A, '(b)'); await noBanner(B, '(b)');
    }

    if (want('c')) {
      /* c — different stores, saved at the same moment */
      await sleep(3000);
      const sinceW = STORE.writes.length;
      await Promise.all([edit(A, T('c1'), 'hero'), edit(B, T('c2'), 'core')]);
      const [ra, rb] = await Promise.all([
        A.page.evaluate(() => cloudSyncProfile().then((x) => ({ ok: !!(x && x.ok), conflict: !!(x && x.conflict), error: (x && x.error) || '' }))),
        B.page.evaluate(() => cloudSyncProfile().then((x) => ({ ok: !!(x && x.ok), conflict: !!(x && x.conflict), error: (x && x.error) || '' }))),
      ]);
      await quiet(3000);
      res.conflicts = STORE.writes.slice(sinceW).filter((w) => w.result === 'no-match' || w.result === 'duplicate').length;
      ok(lbl + ': (c) both saves went through', ra.ok && rb.ok, fmt({ A: ra, B: rb }));
      ok(lbl + ': (c) the compare-and-set conflict path really ran (a write matched no row)', res.conflicts > 0, res.conflicts + ' lost CAS write(s) · ' + fmt(STORE.writes.slice(sinceW).map((w) => w.device.split('/')[1] + ' ' + w.kind + ':' + w.result)));
      const both = ['zz' + T('c1') + '_hero', 'zz' + T('c2') + '_core'];
      const rowMiss = both.filter((x) => !rowIds(U.id).has(x));
      ok(lbl + ': (c) the row holds both edits', !rowMiss.length, rowMiss.length ? 'lacks ' + fmt(rowMiss) : '');
      const ma = await waitHolds(A, both, PULL_WAIT_MS), mb = await waitHolds(B, both, PULL_WAIT_MS);
      ok(lbl + ': (c) both edits survive on device A', ma >= 0, ma >= 0 ? '' : 'A lacks one');
      ok(lbl + ': (c) both edits survive on device B', mb >= 0, mb >= 0 ? '' : 'B lacks one');
      await noBanner(A, '(c) same-moment saves'); await noBanner(B, '(c) same-moment saves');
      const pill = await Promise.all([A, B].map((d) => d.page.evaluate(() => (typeof SaveStatus !== 'undefined' ? SaveStatus.state : '?'))));
      if (!QUIET_CHECKS) state(lbl + ' (c) save indicator after the merge: A ' + pill[0] + ' · B ' + pill[1]);
    }

    if (want('d2')) {
      /* d2 — B's tab closes, A plays on, B REOPENS on its disk save */
      await B.page.close(); await quiet();
      await edit(A, T('d2'));
      ok(lbl + ': (d2) A saved while B was closed', (await sync(A)).ok);
      const sinceW = STORE.writes.length;
      await openPage(B);
      await waitHydrated(B.page, U.id);
      const m = await memIds(B);
      ok(lbl + ': (d2) B reopened and picked up where A left off', m.has('zz' + T('d2') + '_hero'), fmt([...m].sort()));
      const bw = writesBy(B, sinceW);
      const stale = bw.filter((w) => w.body && !markers(JSON.stringify(w.body)).has('zz' + T('d2') + '_hero'));
      ok(lbl + ': (d2) no upload B sent after reopening lacks A\'s newer edit', !stale.length, bw.length + ' sent, ' + stale.length + ' stale');
      await noBanner(B, '(d2) reopen');
      await sleep(3000);
    }

    if (want('f')) {
      /* f — B is typing in a field when A's change lands */
      await sleep(3000);
      await B.page.evaluate(() => {
        const i = document.createElement('input');
        i.id = 'harness-live-typing'; i.type = 'text';
        (document.getElementById('app') || document.body).appendChild(i);
        window.__typingNode = i;
      });
      await B.page.focus('#harness-live-typing');
      await B.page.keyboard.type('half a sentence');
      const st0 = await liveStats(B);
      await edit(A, T('f1'));
      ok(lbl + ': (f) A saved while B types', (await sync(A)).ok);
      await sleep(PULL_WAIT_MS);
      const f = await B.page.evaluate(() => {
        const n = window.__typingNode;
        return { connected: !!(n && n.isConnected), value: n ? n.value : null, focused: document.activeElement === n };
      });
      const m = await memIds(B);
      const st1 = await liveStats(B);
      ok(lbl + ': (f) the field B is typing in was not clobbered (same node, text intact, still focused)', f.connected && f.value === 'half a sentence' && f.focused, fmt(f));
      ok(lbl + ': (f) B deferred the pull while the field had focus (no merge under the typing)',
        !m.has('zz' + T('f1') + '_hero') && st1 && st0 && st1.stats.deferred > st0.stats.deferred, fmt({ deferred: [st0 && st0.stats.deferred, st1 && st1.stats.deferred], merged: m.has('zz' + T('f1') + '_hero') }));
      await B.page.evaluate(() => { try { document.activeElement.blur(); } catch (e) {} });
      const ms = await waitHolds(B, ['zz' + T('f1') + '_hero'], 15000);
      ok(lbl + ': (f) once the field is left, B converges', ms >= 0, ms >= 0 ? (ms / 1000).toFixed(1) + ' s after blur' : 'not within 15 s');
      await B.page.evaluate(() => { try { window.__typingNode && window.__typingNode.remove(); } catch (e) {} });
      await noBanner(B, '(f)');
    }

    if (want('e')) {
      /* e — both idle: zero writes, probe loop alive */
      await quiet(3000); await sleep(3000);
      const sinceW = STORE.writes.length, sinceT = Date.now();
      await sleep(IDLE_S * 1000);
      const wa = writesBy(A, sinceW).length, wb = writesBy(B, sinceW).length;
      const pa = probesBy(A, sinceT), pb = probesBy(B, sinceT);
      const fa = STORE.fetches.filter((x) => x.at >= sinceT).length;
      ok(lbl + ': (e) both tabs idle ' + IDLE_S + ' s: ZERO writes to user_profiles', wa === 0 && wb === 0, 'A ' + wa + ' · B ' + wb);
      ok(lbl + ': (e) the pull loop was alive meanwhile (one-column probes from both tabs)', pa > 0 && pb > 0, 'probes A ' + pa + ' · B ' + pb + ' · full-row fetches ' + fa);
      ok(lbl + ': (e) an idle probe never escalated to a full-row fetch (nothing changed)', fa === 0, fa + ' fetch(es)');
    }

    await noBanner(A, 'end of run'); await noBanner(B, 'end of run');
    ok(lbl + ': no write was refused by RLS', !STORE.rlsRefusals.length, fmt(STORE.rlsRefusals.slice(0, 3)));
    for (const d of [A, B]) if (d.errors.length) state(d.label + ' page errors (first 2): ' + fmt(d.errors.slice(0, 2)));
  } catch (e) {
    ok(lbl + ': ran to the end', false, String(e && e.message || e).slice(0, 300));
  } finally { for (const d of [A, B]) await d.context.close().catch(() => {}); }
  return res;
}

/* ══ RUN ══════════════════════════════════════════════════════════════════ */
const t0 = Date.now();
console.log('\n\u{1F501} LIVE SYNC: one account on two open devices converges silently; an idle tab writes nothing\n');
try {
  const base = fs.readFileSync(PAGE_ARG || path.join(ROOT, 'index.html'), 'utf8');
  INDEX_BODY = Buffer.from(base);
  console.log('  page: ' + (PAGE_ARG ? path.resolve(PAGE_ARG) : 'public/index.html (working tree)') + ' · ' + INDEX_BODY.length + ' bytes');
  browser = await chromium.launch({ headless: true });

  console.log('\n  ── L: devices A and B, one account');
  await scenario('L', 'L', ['a', 'b', 'c', 'd2', 'f', 'e']);
  ok('the fake answered every request without an internal error', !STORE.internal.length, fmt(STORE.internal.slice(0, 3)));
  ok('supabase-js loaded from the page\'s own CDN tag (the real client ran)', !!SUPA_JS);
  ok('every request to ' + SUPA_HOST + ' was answered by the fake (none reached the live project)', NET.seen > 0 && NET.seen === NET.fulfilled,
    'seen ' + NET.seen + ' fulfilled ' + NET.fulfilled + ' · sockets refused ' + NET.ws + ' · other off-box aborted ' + NET.aborted);

  if (RUN_NEG) {
    console.log('\n  ── NEG-PRE: check c against the pre-change page (' + PRE_REF + ')');
    let pre = null;
    try { pre = execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', PRE_REF + ':public/index.html'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); } catch (e) {}
    ok('NEG-PRE: the pinned pre-change page was read from git', !!pre && pre.includes('merged that progress'), pre ? pre.length + ' bytes' : 'git show failed');
    if (pre) {
      INDEX_BODY = Buffer.from(pre);
      STORE = makeStore();
      QUIET_CHECKS = [];
      const r = await scenario('NEG-PRE', 'P', ['c']);
      const got = QUIET_CHECKS; QUIET_CHECKS = null;
      state('NEG-PRE failing checks: ' + got.length + ' · first: ' + fmt(got.slice(0, 2).map((s) => s.slice(0, 160))));
      ok('NEG-PRE: the pre-change page SHOWS the device banner on a same-moment save (the watcher can see it)', r.bannerSeen > 0 && r.conflicts > 0, r.bannerSeen + ' banner sighting(s), ' + r.conflicts + ' CAS conflict(s)');
    }

    console.log('\n  ── NEG-NOPULL: check a against a copy whose background pull is cut out');
    const anchor = 'async function _profileLivePull(reason) {';
    const hits = base.split(anchor).length - 1;
    ok('NEG-NOPULL: mutant anchor found exactly once', hits === 1, String(hits));
    INDEX_BODY = Buffer.from(base.replace(anchor, anchor + " return { skipped: 'HARNESS MUTANT' };"));
    STORE = makeStore();
    QUIET_CHECKS = [];
    const r2 = await scenario('NEG-NOPULL', 'N', ['a']);
    const got2 = QUIET_CHECKS; QUIET_CHECKS = null;
    state('NEG-NOPULL failing checks: ' + got2.length + ' · first: ' + fmt(got2.slice(0, 2).map((s) => s.slice(0, 160))));
    ok('NEG-NOPULL: without the background pull B does NOT catch up (check a can fail)', !r2.aCaught, r2.aCaught ? 'B caught up anyway' : 'B stayed behind');
    ok('NEG: every control request was answered by the fake', NET.seen === NET.fulfilled, 'seen ' + NET.seen + ' fulfilled ' + NET.fulfilled);
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
