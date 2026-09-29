/* 🔴 AN UNREAD OWNER LIST IS NOT AN EMPTY WORLD.

   2026-09-04: the database was CPU-throttled (a pure `count(*) over
   generate_series(1,1e6)` took 2.6s against a healthy ~0.1s, and reading 110
   ALREADY-CACHED pages of user_profiles took 10.2 seconds). Every read the game
   made timed out. Not one row was lost — all 40 tw_node_owners rows and all 122
   user_profiles rows were sitting in the tables the whole time — but:

     • the map drew all 40 nodes UNCLAIMED,
     • the node drawer offered "🚩 Claim this Node" on land that was owned,
     • NODE OWNERSHIP (PLAYER) read "Owner: Unclaimed",
     • the admin player search said "No players found by that name",

   and 34 node owners were told they owned nothing. The cause is one shape
   repeated in four places: a read that fails returns null/[] into a renderer
   that cannot tell "we did not find out" from "we found out, and it is empty".

   So the rule this file defends is: NOTHING may print Unclaimed, or offer to
   claim, unless the owner list actually loaded. `_twOwnersReady()` is the only
   thing allowed to answer that, and a FAILED fetch must leave the cache UNSET
   (not stored as an empty map) so the next attempt retries.

   Run: node _nodeowners_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');

/* Lift a function's source by brace-matching. Keeps the `async` keyword when
   there is one — dropping it turns an awaited body into a syntax error, and a
   silently non-async lift would grade a promise instead of its value. */
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  const isAsync = /\basync\s+$/.test(SRC.slice(Math.max(0, i - 12), i));
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return (isAsync ? 'async ' : '') + SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const NAMES = ['tw_cloudFetchNodeOwners', '_twOwnersReady', '_twNodeOwnerUser', 'tw_cloudSearchPlayers', '_twOwnersRetry'];

/* `sel` decides what the cloud does: 'ok' returns rows, 'err' returns a
   PostgREST-style {error}, 'throw' blows up mid-flight. All three are real
   failure modes we saw today and all three must land in the same place. */
function build({ sel = 'ok', rows = [{ node_id: 'N-02', user_id: 'u-lids', display_name: 'LIDS' }], signedIn = true, cloudReady = true } = {}) {
  const App = { screen: 'territoryWars' };
  const Profile = { cloud: signedIn ? { userId: 'u-me' } : {} };
  const table = () => ({
    select: () => ({
      limit: async () => {
        if (sel === 'throw') throw new Error('unreachable');
        if (sel === 'err') return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        return { data: rows, error: null };
      },
      ilike: () => ({ limit: async () => ({ data: [], error: sel === 'ok' ? null : { message: 'timeout' } }) }),
    }),
  });
  const Cloud = { ready: cloudReady, client: { from: table } };
  const env = {
    App, Profile, Cloud,
    AdmUM: { all: [], adminFetched: true, _loadingAll: false },
    _admFetchAll: async () => {},
    _admUserSearch: async () => [],
    initCloud: () => cloudReady,
    _twBgRender: () => {},
    showToast: () => {},
    render: () => {},
    window: { __mg: {} },
  };
  const argNames = Object.keys(env);
  const api = new Function(...argNames,
    NAMES.map(fnText).join('\n') + '\nreturn {' + NAMES.join(',') + '};'
  )(...argNames.map((k) => env[k]));
  return { ...api, App, Profile };
}

console.log('\n🔴 NODE OWNERSHIP — unknown must never render as unclaimed\n');

// ── 1. _twOwnersReady is the single question, and it is strict ──────────────
{
  const s = build();
  ok(s._twOwnersReady() === false, 'no cache at all → not ready');
  s.App._twNodeOwners = { at: 1 };
  ok(s._twOwnersReady() === false, 'cache without byNode → not ready (half-built is not an answer)');
  s.App._twNodeOwners = { at: 1, byNode: {} };
  ok(s._twOwnersReady() === true, 'loaded and EMPTY → ready (a real "nobody owns anything")');
}

// ── 2. A failed fetch must not be cached as an answer ───────────────────────
for (const mode of ['err', 'throw']) {
  const s = build({ sel: mode });
  const r = await s.tw_cloudFetchNodeOwners();
  ok(r === null, `${mode}: returns null`);
  ok(s.App._twNodeOwners === undefined, `${mode}: leaves the cache UNSET so the next call retries`);
  ok(s._twOwnersReady() === false, `${mode}: never reports ready`);
  ok(!!s.App._twNodeOwnersErr, `${mode}: records the failure for the UI to surface`);
}

// ── 3. The success path still works, and clears the failure mark ────────────
{
  const s = build({ sel: 'ok' });
  s.App._twNodeOwnersErr = { at: 1, why: 'stale' };
  await s.tw_cloudFetchNodeOwners();
  ok(s._twOwnersReady() === true, 'ok: ready after a good fetch');
  ok(s.App._twNodeOwners.count === 1, 'ok: owner map populated');
  ok(s._twNodeOwnerUser('N-02').display_name === 'LIDS', 'ok: the owner is readable by node');
  ok(s.App._twNodeOwnersErr === null, 'ok: a good fetch clears the stale failure mark');
}

// ── 4. Signed out is its own case: no session, no cache, no false "empty" ───
{
  const s = build({ signedIn: false });
  ok((await s.tw_cloudFetchNodeOwners()) === null, 'signed out: no fetch');
  ok(s._twOwnersReady() === false, 'signed out: not ready (never a claim that nobody owns anything)');
}

// ── 5. Player search: "could not ask" is distinguishable from "no match" ────
{
  const s = build({ sel: 'err' });
  const r = await s.tw_cloudSearchPlayers('lids');
  ok(Array.isArray(r) && r.length === 0, 'unreachable search returns no rows');
  ok(s.App._twPlayerSearchErr === true, 'unreachable search is FLAGGED, not reported as "no players found"');
}
{
  const s = build({ sel: 'ok', rows: [] });
  await s.tw_cloudSearchPlayers('zzzznobody');
  ok(s.App._twPlayerSearchErr === false, 'reachable + genuinely no match → NOT flagged (no crying wolf)');
}
{
  const s = build({ cloudReady: false });
  await s.tw_cloudSearchPlayers('lids');
  ok(s.App._twPlayerSearchErr === true, 'no cloud at all → flagged');
}

// ── 6. Retry clears the mark and re-reads ──────────────────────────────────
{
  const s = build({ sel: 'ok' });
  s.App._twNodeOwners = { at: 1, byNode: {} };
  s.App._twNodeOwnersErr = { at: 1, why: 'timeout' };
  await s._twOwnersRetry();
  ok(s._twOwnersReady() === true && s.App._twNodeOwners.count === 1, 'retry drops the stale cache and re-fetches');
  ok(s.App._twNodeOwnersErr === null, 'retry clears the failure mark on success');
}

/* ── 7. The RENDER sites. These are arrow consts inside the map renderer and
   cannot be lifted, so they are asserted on source — but the assertion is the
   ORDER, which is the whole bug: a readiness guard that sits AFTER the
   UNCLAIMED return is dead code. */
console.log('\n  — render sites —');
{
  const cls = SRC.indexOf('const _twNodeClass = (n, own) =>');
  ok(cls > 0, '_twNodeClass found');
  const body = SRC.slice(cls, cls + 3000);
  const guard = body.indexOf("key:'unknown'");
  const unclaimed = body.indexOf("key:'unclaimed'");
  ok(guard > 0, '_twNodeClass has an "unknown" state distinct from "unclaimed"');
  ok(guard > 0 && unclaimed > guard, '_twNodeClass tests readiness BEFORE it returns UNCLAIMED', 'guard=' + guard + ' unclaimed=' + unclaimed);
  ok(/_twOwnersReady\(\)/.test(body.slice(0, unclaimed)), '_twNodeClass consults _twOwnersReady()');

  const lbl = SRC.indexOf('const _nodeOwnerLabel = (n, own) =>');
  const lbody = SRC.slice(lbl, lbl + 1200);
  const li = lbody.indexOf("name: 'Loading…'"), lu = lbody.indexOf("name: 'Unclaimed'");
  ok(lbl > 0 && li > 0 && lu > li, '_nodeOwnerLabel returns Loading… before it returns Unclaimed');

  ok(/_me && typeof _twOwnersReady === 'function' && !_twOwnersReady\(\)/.test(SRC),
     'the Claim button is gated on the owner list having loaded');
  const claimGuard = SRC.indexOf("_me && typeof _twOwnersReady === 'function' && !_twOwnersReady()");
  const claimBtn = SRC.indexOf('__mg._twPlayerClaimNode(');
  ok(claimGuard > 0 && claimBtn > claimGuard, 'the readiness gate precedes the Claim button', 'gate=' + claimGuard + ' btn=' + claimBtn);

  // NB: the message lives in a single-quoted JS string, so the apostrophe is
  // backslash-escaped in the source — match both spellings or this greps for
  // text that is never written that way on disk.
  ok(/Couldn\\?'t reach the player directory/.test(SRC), 'the search UI has an unreachable message separate from "no players found"');
  ok(/App\._twPlayerSearchErr\s*$/m.test(SRC) || SRC.includes('App._twPlayerSearchErr\n'),
     'the search renderer branches on _twPlayerSearchErr');
}

console.log('\n' + (fails ? `❌ ${fails} FAILED\n` : '✅ all clear — an unread owner list can no longer masquerade as an unowned world\n'));
process.exit(fails ? 1 : 0);
