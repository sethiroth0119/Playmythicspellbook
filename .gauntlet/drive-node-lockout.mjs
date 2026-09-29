/* ══════════════════════════════════════════════════════════════════════════
   🔒 DRIVE-NODE-LOCKOUT — a node owner is never told they own nothing.

   Reported: "sometimes it tells the player who owns a node that they do not
   have a node, and it locks them out of content like the camp."

   🔴 THE MECHANISM, CONFIRMED AGAINST THE LIVE DATABASE.
      tw_node_owners' select policy is granted TO authenticated USING (true),
      and the table has rows. So a read made while the client is still anon —
      auth not resolved yet, or a token mid-refresh — does not fail. It returns
      ZERO ROWS AND NO ERROR. The old code took that at face value:

          if (error) return null;                    // no error
          App._twNodeOwners = { at, byNode };        // cached EMPTY

      and _campOwnerDataEnsure opened with `if (App._twNodeOwners) return;`, so
      it never fetched again for the whole session. Camp, Cashout Vault, Tutor
      Shop and Player Market all resolve through playerOwnsAnyNode(), so all
      four stayed locked for an actual node owner until they reloaded.

   THE THREE THINGS THIS PINS:
     1. no session → no cache (an empty map and a missing map mean different
        things and must not be stored the same way)
     2. an empty map is RETRIED, throttled and capped — a genuinely empty world
        is a real answer, but only after asking properly
     3. a confirmed owner LATCHES, so no later blip can re-lock content the
        game already opened

   Run:  node .gauntlet/drive-node-lockout.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const P = 9790 + (process.pid % 40);
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
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => (r.request().url().includes('127.0.0.1') ? r.continue() : r.abort()));
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(5000);

const out = {};

/* ── 1 · the anon read that started it all ───────────────────────────────── */
out.anon = await pg.evaluate(async () => {
  const o = {};
  const calls = [];
  Cloud.ready = true;
  /* 🔴 exactly what RLS does to an anon client: rows exist, you see none, and
     nothing errors */
  Cloud.client = { from: () => ({ select: () => ({ limit: async () => { calls.push('select'); return { data: [], error: null }; } }) }) };
  Profile.cloud = { signedIn: true, userId: null };        // signed in, id not resolved yet
  delete App._twNodeOwners; delete App._twNodeOwnersFetching; App._twNodeOwnersTries = 0;
  Profile.ownedNodeEver = false;

  await tw_cloudFetchNodeOwners();
  o.queriedWithoutSession = calls.length;                  // must be 0 — it should not even ask
  o.cachedAnything = !!App._twNodeOwners;                  // 🔴 must be false
  return o;
});

/* ── 2 · an empty map from a REAL session is retried, not believed ───────── */
out.empty = await pg.evaluate(async () => {
  const o = {};
  let served = 0;
  Cloud.ready = true;
  Cloud.client = { from: () => ({ select: () => ({ limit: async () => { served++; return { data: [], error: null }; } }) }) };
  Profile.cloud = { signedIn: true, userId: 'me-1' };
  delete App._twNodeOwners; delete App._twNodeOwnersFetching; App._twNodeOwnersTries = 0;

  await tw_cloudFetchNodeOwners();
  o.cachedEmpty = !!App._twNodeOwners;
  o.count = App._twNodeOwners && App._twNodeOwners.count;
  /* the ensure must be willing to ask again — the old code returned for ever */
  App._twNodeOwners.at = Date.now() - 60000;               // age it past the throttle
  _campOwnerDataEnsure();
  await new Promise(r => setTimeout(r, 300));
  o.refetched = served > 1;                                // 🔴 must be true
  /* …but not on every single render */
  const before = served;
  _campOwnerDataEnsure(); _campOwnerDataEnsure(); _campOwnerDataEnsure();
  await new Promise(r => setTimeout(r, 200));
  o.throttled = (served === before);                       // fresh cache → no new calls
  return o;
});

/* ── 3 · a real owner is recognised, and latched ─────────────────────────── */
out.owner = await pg.evaluate(async () => {
  const o = {};
  Cloud.ready = true;
  Cloud.client = { from: () => ({ select: () => ({ limit: async () => ({
    data: [{ node_id: 'N-07', user_id: 'me-1', display_name: 'Me' }], error: null }) }) }) };
  Profile.cloud = { signedIn: true, userId: 'me-1' };
  Profile.ownedNodeEver = false;
  delete App._twNodeOwners; delete App._twNodeOwnersFetching; App._twNodeOwnersTries = 0;

  await tw_cloudFetchNodeOwners();
  o.owns = playerOwnsAnyNode();
  o.latched = !!Profile.ownedNodeEver;
  o.campUnlocked = isCampUnlocked();
  o.cashoutUnlocked = isCashoutUnlocked();
  o.tutorUnlocked = isTutorUnlocked();
  o.marketUnlocked = isPlayerMarketUnlocked();
  return o;
});

/* ── 4 · 🔴 THE LOCKOUT ITSELF: a blip after that must not re-lock them ──── */
out.blip = await pg.evaluate(async () => {
  const o = {};
  /* the network goes bad exactly as the old bug describes: an empty map lands */
  App._twNodeOwners = { at: Date.now(), byNode: {}, count: 0 };
  Profile.cloud = { signedIn: true, userId: 'me-1' };
  o.stillOwns = playerOwnsAnyNode();
  o.campStillUnlocked = isCampUnlocked();
  o.cashoutStillUnlocked = isCashoutUnlocked();
  o.tutorStillUnlocked = isTutorUnlocked();
  o.marketStillUnlocked = isPlayerMarketUnlocked();
  /* …and even with the map gone entirely */
  delete App._twNodeOwners;
  o.survivesNoMapAtAll = isCampUnlocked();
  return o;
});

/* ── 5 · CONTROL: someone who never owned a node stays locked ────────────── */
out.control = await pg.evaluate(async () => {
  const o = {};
  Profile.ownedNodeEver = false;
  Profile.cloud = { signedIn: true, userId: 'someone-else' };
  Profile.heroes = {};                                   // no hero progression either
  App._twNodeOwners = { at: Date.now(), byNode: { 'N-07': { user_id: 'me-1' } }, count: 1 };
  o.owns = playerOwnsAnyNode();
  o.latched = !!Profile.ownedNodeEver;
  o.campLocked = !isCampUnlocked();
  return o;
});

await pg.close(); await b.close(); srv.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const A = out.anon || {}, E = out.empty || {}, O = out.owner || {}, B = out.blip || {}, C = out.control || {};

need('🔴 THE ROOT CAUSE: with no resolved session it does not even ask',
     A.queriedWithoutSession === 0, A);
need('🔴 …and caches nothing, so the next pass can try again',
     A.cachedAnything === false, A);

need('a real session does cache its answer', E.cachedEmpty === true, E);
need('…and records that the answer was empty', E.count === 0, E);
need('🔴 THE BUG: an empty map is RETRIED rather than believed for the session',
     E.refetched === true, E);
need('…but not on every render — a fresh cache is left alone', E.throttled === true, E);

need('a real owner is recognised', O.owns === true, O);
need('…and the confirmation latches', O.latched === true, O);
need('…and every gated feature opens',
     O.campUnlocked === true && O.cashoutUnlocked === true
     && O.tutorUnlocked === true && O.marketUnlocked === true, O);

need('🔴 THE LOCKOUT: a later empty map does NOT take ownership away',
     B.stillOwns === true, B);
need('🔴 …and the Camp stays open', B.campStillUnlocked === true, B);
need('…as do the Cashout Vault, Tutor Shop and Player Market',
     B.cashoutStillUnlocked === true && B.tutorStillUnlocked === true
     && B.marketStillUnlocked === true, B);
need('…even with the owner map gone entirely', B.survivesNoMapAtAll === true, B);

need('🔴 CONTROL: someone else\'s node does not unlock anything',
     C.owns === false && C.latched === false && C.campLocked === true, C);

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
if (bad.length) { console.log('\n❌ FAIL:'); bad.forEach(x => console.log('  · ' + x)); process.exit(1); }
console.log('\n✅ PASS — an owner is never told they own nothing, and a bad five seconds cannot lock them out.');
