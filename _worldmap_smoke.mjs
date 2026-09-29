/* 🗺 THE SHARED WORLD MAP CANNOT BE REPLACED BY A FALLBACK.

   Reported twice: "the map is empty / the nodes are gone". Both times
   tw_world_map still held every node and the client simply could not read it.
   But the near-miss underneath is the one worth defending against:

     · a device whose world-map fetch fails seeds the 16-node starter map,
     · any admin action fires _adminAutoPublish(0),
     · sql/043's server guard only refuses a map with ZERO nodes,
     · 16 is not 0 — so 16 generic PRNs become the world for all 121 accounts.

   043's own header counts FIFTEEN profiles sitting on exactly 16 nodes beside
   31 on the real 40. That is this accident's fingerprint, already in the data.

   Two independent guards, and this file drives both:
     CLIENT — never publish a map this device never successfully READ
              (App._twForgeSeen), so the seed can never be the thing uploaded.
     SERVER — sql/108 refuses any publish carrying fewer nodes than the live
              map unless a human passed force, and keeps the outgoing doc in
              tw_world_map_history so even a forced mistake is reversible.

   A test that only asserted "blank is refused" would pass on the OLD code and
   prove nothing, so every case here is about a NON-empty map that is still
   wrong.

   Run: node _worldmap_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/108_world_map_cannot_shrink.sql', 'utf8');

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

/* `reply` is what the server RPC returns, so we can drive the shrink refusal
   without a database. `calls` records every RPC the client actually made —
   which is how we prove a refusal did NOT quietly retry with force. */
function build({ seen = true, nodes = 40, admin = true, reply = { ok: true, version: 9 }, confirmAnswer = true,
                 liveDoc = null, replies = null } = {}) {
  const calls = [];
  const App = { _twForgeSeen: seen, _twWorldMapVersion: 8 };
  const Forge = { territoryWars: { regions: [{ id: 'r1' }], sectors: [], nodes: Array.from({ length: nodes }, (_, i) => ({ id: 'N-' + (i + 1) })) } };
  const toasts = [];
  /* `replies` lets one build answer the first RPC differently from the second,
     which is what a reconcile is: refused, then published. */
  let nth = 0;
  const env = {
    App, Forge,
    Cloud: { ready: true, client: {
      rpc: async (fn, args) => { calls.push({ fn, args }); const rep = replies ? (replies[nth] || replies[replies.length - 1]) : reply; nth++; return { data: rep, error: null }; },
      /* the live-map read the reconcile does, straight off the table */
      from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: liveDoc ? [liveDoc] : [], error: null }) }) }) }),
    } },
    Profile: { cloud: { userId: 'u-admin', signedIn: true } },
    isAdmin: () => admin,
    showToast: (m) => { toasts.push(String(m)); },
    gcConfirm: async () => confirmAnswer,
    render: () => {},
    saveForge: () => {},
    tw_cloudFetchWorldMap: async () => null,
    _twWorldMapAt: 0,
    console: { warn: () => {}, info: () => {} },
  };
  const argNames = Object.keys(env);
  /* The reconcile ships WITH the publisher — the shrink branch calls it, so a
     harness without it would be testing a function that cannot exist. */
  const api = new Function(...argNames,
    [fnText('_twLiveMapRow'), fnText('_twMergeNodeLists'), fnText('_twReconcileAndPublish'), fnText('tw_cloudPublishWorldMap')].join('\n')
    + '\nreturn { tw_cloudPublishWorldMap, _twMergeNodeLists };'
  )(...argNames.map((k) => env[k]));
  return { ...api, App, Forge, calls, toasts };
}

console.log('\n🗺 WORLD MAP — a fallback must never become everyone\'s world\n');

// ── 1. THE CORE RULE: an unread map is never published ─────────────────────
{
  const s = build({ seen: false, nodes: 16 });
  const r = await s.tw_cloudPublishWorldMap();
  ok(r === null, 'unread map (the 16-node seed): refused');
  ok(s.calls.length === 0, 'unread map: no RPC was even attempted', JSON.stringify(s.calls));
}
{
  // …and it is the READ flag that decides, not the node count. A full-looking
  // 40-node local map that was never confirmed against the server is still not
  // ours to publish.
  const s = build({ seen: false, nodes: 40 });
  ok((await s.tw_cloudPublishWorldMap()) === null, 'unread map with 40 nodes: still refused');
  ok(s.calls.length === 0, 'unread map with 40 nodes: no RPC attempted');
}
{
  const s = build({ seen: true, nodes: 40 });
  const r = await s.tw_cloudPublishWorldMap();
  ok(r && r.ok === true, 'a map that WAS read publishes normally');
  ok(s.calls.length === 1 && s.calls[0].fn === 'tw_publish_world_map', 'one publish RPC');
}

// ── 2. A blank map is still refused (043's rule, not regressed) ─────────────
{
  const s = build({ nodes: 0 });
  ok((await s.tw_cloudPublishWorldMap()) === null, 'blank map: refused');
  ok(s.calls.length === 0, 'blank map: no RPC attempted');
}

// ── 3. Non-admin cannot publish ────────────────────────────────────────────
{
  const s = build({ admin: false });
  ok((await s.tw_cloudPublishWorldMap()) === null, 'non-admin: refused');
  ok(s.calls.length === 0, 'non-admin: no RPC attempted');
}

// ── 4. force is OFF unless a human is standing there ───────────────────────
{
  /* And it is OMITTED, not sent as false: PostgREST resolves the overload by
     argument NAME, so naming p_force against a database that has not run
     sql/108 fails the whole call. Two args match the old and new functions
     both, which is what lets the client and the migration deploy in either
     order. */
  const s = build();
  await s.tw_cloudPublishWorldMap();
  ok(!('p_force' in s.calls[0].args), 'the automatic path does not name p_force at all', JSON.stringify(s.calls[0].args && Object.keys(s.calls[0].args)));
  ok('p_doc' in s.calls[0].args && 'p_version' in s.calls[0].args, 'it still sends p_doc and p_version');
}

// ── 5. The server's shrink refusal, and who may answer it ──────────────────
{
  /* 🔴 v121v69: the automatic path RECONCILES instead of dead-ending.
     A shrink there means this device is behind, not that the admin deleted
     anything — and the dirty-map fetch guard meant it could never catch up, so
     the same refusal repeated for the rest of the session and a new node could
     never be saved. Both lists are true, so they are UNIONed. It still must
     never force. */
  const live = { doc: { regions: [], sectors: [], nodes: Array.from({ length: 40 }, (_, i) => ({ id: 'L-' + i })) }, version: 12 };
  const s = build({
    nodes: 16,
    liveDoc: live,
    replies: [{ ok: false, why: 'shrink', have: 40, sent: 16, version: 8 }, { ok: true, version: 13 }],
  });
  const r = await s.tw_cloudPublishWorldMap();
  ok(r && r.ok === true, 'shrink on the automatic path: reconciled and published', JSON.stringify(r));
  ok(s.calls.length === 2, 'shrink on the automatic path: exactly one retry, after the merge', 'calls=' + s.calls.length);
  ok(!s.calls.some(c => c.args && 'p_force' in c.args), 'shrink on the automatic path: NEVER forced', JSON.stringify(s.calls.map(c => Object.keys(c.args || {}))));
  ok(s.calls[1].args.p_doc.nodes.length === 56, 'the union is published — 40 live + 16 local, nobody loses a node', String(s.calls[1].args.p_doc.nodes.length));
  ok(s.toasts.some(t => t.includes('40') && t.includes('56')), 'and the admin is told what was merged', JSON.stringify(s.toasts));
}
{
  // Explicit button, admin declines → still no force.
  const s = build({ reply: { ok: false, why: 'shrink', have: 40, sent: 16, version: 8 }, confirmAnswer: false });
  const r = await s.tw_cloudPublishWorldMap({ allowConfirm: true });
  ok(r === null, 'shrink + admin says no: refused');
  ok(s.calls.length === 1, 'shrink + admin says no: no forced retry', 'calls=' + s.calls.length);
}
{
  // Explicit button, admin agrees → exactly one forced retry.
  // Built inline because this case needs a TWO-STAGE rpc: the first attempt is
  // refused as a shrink, the confirmed retry succeeds.
  const sent = [];
  const App = { _twForgeSeen: true, _twWorldMapVersion: 8 };
  const Forge = { territoryWars: { regions: [], sectors: [], nodes: Array.from({ length: 16 }, (_, i) => ({ id: "N-" + (i + 1) })) } };
  const env = {
    App, Forge,
    Cloud: { ready: true, client: { rpc: async (fn, args) => {
      sent.push(args);
      return { data: sent.length === 1
        ? { ok: false, why: "shrink", have: 40, sent: 16, version: 8 }
        : { ok: true, version: 9 }, error: null };
    } } },
    Profile: { cloud: { userId: "u-admin", signedIn: true } },
    isAdmin: () => true,
    showToast: () => {},
    gcConfirm: async () => true,
    render: () => {},
    tw_cloudFetchWorldMap: async () => null,
    _twWorldMapAt: 0,
    console: { warn: () => {}, info: () => {} },
  };
  const names = Object.keys(env);
  const { tw_cloudPublishWorldMap } = new Function(...names,
    fnText("tw_cloudPublishWorldMap") + "\nreturn { tw_cloudPublishWorldMap };")(...names.map(k => env[k]));
  const r = await tw_cloudPublishWorldMap({ allowConfirm: true });
  ok(r && r.ok === true, "shrink + admin confirms: the forced publish goes through");
  ok(sent.length === 2, "shrink + admin confirms: exactly two RPCs (try, then force)", "calls=" + sent.length);
  ok(!('p_force' in sent[0]) && sent[1].p_force === true,
     "the first attempt omits p_force and only the confirmed retry sends it",
     JSON.stringify(sent.map(c => c.p_force)));
}

// ── 5b. The remembered map: draws, but is never authoritative ──────────────
{
  /* The device keeps the last map it successfully read so a failed fetch draws
     the real world instead of a blank board. The danger in doing that is
     obvious — a cached map that could be PUBLISHED is the 16-node-seed
     accident wearing a different hat — so the cache deliberately does not set
     _twForgeSeen, and these two checks are what hold that line. */
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const App = {};
  const Forge = { territoryWars: { regions: [], sectors: [], nodes: [] } };
  const env = { App, Forge, localStorage, console: { info: () => {}, warn: () => {} } };
  const names = Object.keys(env);
  const api = new Function(...names,
    fnText('_twMapCacheSave') + '\n' + fnText('_twMapCacheLoad') + '\n' + fnText('_twMapCacheApply') +
    "\nconst TW_MAP_CACHE_KEY = 'hg_tw_worldmap_v1';" +
    '\nreturn { _twMapCacheSave, _twMapCacheLoad, _twMapCacheApply };')(...names.map(k => env[k]));

  const real = { regions: [{ id: 'r1' }], sectors: [], nodes: Array.from({ length: 40 }, (_, i) => ({ id: 'N-' + (i + 1) })) };
  api._twMapCacheSave(real, 7);
  ok(!!store['hg_tw_worldmap_v1'], 'a good map is remembered');
  ok(api._twMapCacheApply() === true, 'the remembered map is drawn onto an empty board');
  ok(Forge.territoryWars.nodes.length === 40, 'all 40 nodes come back', String(Forge.territoryWars.nodes.length));
  ok(App._twForgeSeen !== true, 'drawing from cache does NOT mark the map as read — so it can never be published');

  // an empty or junk map is never remembered, or it would erase a good one
  const before = store['hg_tw_worldmap_v1'];
  api._twMapCacheSave({ nodes: [] }, 8);
  api._twMapCacheSave(null, 9);
  ok(store['hg_tw_worldmap_v1'] === before, 'an empty map never overwrites the remembered one');

  // and it never paints over a board that already has something real on it
  const F2 = { territoryWars: { regions: [], sectors: [], nodes: [{ id: 'LIVE' }] } };
  const env2 = { App: {}, Forge: F2, localStorage, console: { info: () => {}, warn: () => {} } };
  const n2 = Object.keys(env2);
  const api2 = new Function(...n2,
    fnText('_twMapCacheLoad') + '\n' + fnText('_twMapCacheApply') +
    "\nconst TW_MAP_CACHE_KEY = 'hg_tw_worldmap_v1';" +
    '\nreturn { _twMapCacheApply };')(...n2.map(k => env2[k]));
  ok(api2._twMapCacheApply() === false, 'the cache never overwrites a board that already has nodes');
  ok(F2.territoryWars.nodes.length === 1 && F2.territoryWars.nodes[0].id === 'LIVE', 'the live board is untouched');
}

// ── 5c. The edge cache is consulted, and is not the only way in ────────────
{
  ok(/fetch\('\/api\/worldmap\?t=' \+ Math\.floor\(Date\.now\(\) \/ 60000\)/.test(SRC),
     'the client reads /api/worldmap with a PER-MINUTE cache-buster (the zone TTL rewrote max-age=60 to 14400)');
  const fn = fnText('tw_cloudFetchWorldMap');
  const edge = fn.indexOf("/api/worldmap"), direct = fn.indexOf("from('tw_world_map')");
  ok(edge > 0 && direct > edge, 'the edge copy is tried BEFORE the direct table read', 'edge=' + edge + ' direct=' + direct);
  ok(/if \(!row\) \{/.test(fn), 'the direct read still runs when the edge copy is unavailable');
  ok(/_twMapCacheSave\(doc, row\.version \| 0\)/.test(fn), 'every successful read is remembered');

  // a publish must not leave the edge serving the map it just replaced
  const pub = fnText('tw_cloudPublishWorldMap');
  const okBranch = pub.indexOf('if (data && data.ok) {');
  const okBody = pub.slice(okBranch, pub.indexOf('return data;', okBranch));
  ok(okBranch > 0 && /\/api\/worldmap\?fresh=1/.test(okBody), 'a successful publish immediately refreshes the edge copy');
  ok(/_twMapCacheSave\(doc, data\.version \| 0\)/.test(okBody), 'a successful publish updates the local remembered map');
}

// ── 6. The empty board explains itself instead of just being empty ─────────
console.log('\n  — the empty-board banner —');
{
  ok(/_twMapUnread/.test(SRC), 'the war map computes an "unread" state');
  ok(/Couldn\\?'t load the world map/.test(SRC), 'the banner says the map could not be loaded');
  ok(/__mg\._twMapRetry\(\)/.test(SRC), 'the banner offers a retry');
  ok(/function _twMapRetry\(\)/.test(SRC), '_twMapRetry exists');
  const retry = fnText('_twMapRetry');
  ok(/_twWorldMapAt = 0/.test(retry), 'retry clears the 60s fetch throttle so the press actually re-reads');
  // the banner must only appear for a signed-in player whose map is unread —
  // never over a real, legitimately-empty board
  const blk = SRC.slice(SRC.indexOf('const _twMapUnread'), SRC.indexOf('const _twMapUnread') + 500);
  ok(/signedIn/.test(blk) && /_twForgeSeen/.test(blk), 'the banner is gated on signed-in AND map-unread', blk.slice(0, 120));
}

// ── 7. The server-side net (sql/108) ───────────────────────────────────────
console.log('\n  — sql/108 —');
{
  ok(/create table if not exists public\.tw_world_map_history/.test(SQL), 'history table exists');
  ok(/enable row level security/.test(SQL), 'history has RLS enabled');
  ok(!/create policy\s+\w+\s+on public\.tw_world_map_history/.test(SQL),
     'history has NO policy — unreachable from the client that could make the mistake');
  ok(/drop function if exists public\.tw_publish_world_map\(jsonb, integer\);/.test(SQL),
     'the 2-arg publish function is DROPPED, not left to make the call ambiguous');
  ok(/if v_new < v_old and not coalesce\(p_force, false\)/.test(SQL), 'the shrink guard is present');
  ok(/'why', 'shrink'/.test(SQL), 'the refusal identifies itself as a shrink');
  ok(/for update/.test(SQL), 'the live row is locked so two publishes cannot race the guard');
  ok(/insert into tw_world_map_history[\s\S]{0,400}?update tw_world_map/.test(SQL),
     'the outgoing map is archived BEFORE it is overwritten');
  ok(/create or replace function public\.tw_restore_world_map/.test(SQL), 'a one-call restore exists');
  const revokes = (SQL.match(/revoke all on function[^;]*from public, anon;/g) || []).length;
  ok(revokes === 2, 'both new functions revoke from public AND anon (the double-grant trap)', 'found ' + revokes);
  const grants = (SQL.match(/grant execute on function[^;]*to authenticated;/g) || []).length;
  ok(grants === 2, 'both new functions grant execute to authenticated', 'found ' + grants);
}

console.log('\n' + (fails ? `❌ ${fails} FAILED\n` : '✅ all clear — no fallback map can become the shared world, and every version is recoverable\n'));
process.exit(fails ? 1 : 0);
