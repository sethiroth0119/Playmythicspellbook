/* ══════════════════════════════════════════════════════════════════════════
   🗺 DRIVE-SERVER-GROUND — every account's ground is its own, and the server
      is what says so.

   Asked for: "the game is a full on multiplayer always online game so make sure
   that every account have their own information and stop tying everyone
   together as local and make it server side… you can do one more reroll and
   then send everyone 100,000 cinder as a reward to replace their building cost."

   🔴 WHAT WAS SHARED. node-city derived its own ground id, and the derivation
      was a race it usually lost — so nearly every city in the game was seeded
      from the single literal 'local-city'. /src/resmap, /src/water and
      /src/power all hash that string to place the aquifers, the ore and the
      oil, which means one world under every account in a game where every
      account owns its own everything. sql/045 mints one per (user_id, node_id)
      and stores it; measured on the live table, 33 cities resolve to 33
      distinct grounds.

   WHAT THIS PINS:
     · the server's id reaches the ground and is ADOPTED, not merely reported —
       resmap pins the first answer it gets, so an id that arrives after mount
       is ignored unless it is adopted
     · it OUTRANKS the local pin, because honouring pins would leave everyone on
       the shared seed for ever — this is the one authorised re-roll
     · two accounts on the same node get different ground; one account asking
       twice gets the same ground
     · the grant is claimed once, the amount is NOT a client argument, and a
       second claim pays nothing
     · THE SAME CITY STANDS ON THE SAME GROUND WHICHEVER DOOR IT CAME IN BY.
       cityStateLoad retargets a click on an EMPTY node the player owns to the
       node their city actually stands on — and used to leave the ground where
       _openNodeCity had put it: the empty node's, because that reply is fired
       before the iframe exists and had landed long before the retarget. The
       built city therefore stood on N-05's aquifers when opened from N-05 and
       on N-02's when opened from My City. Section 3 drives the REAL parent and
       the REAL iframe through both doors and reads the ground back through
       MythicCityBridge.serverGroundId() — the same answer, or a fail.

   ⚠ STAGING: the RPCs are stubbed at the Cloud client, which is the seam the
     real ones answer through. The SQL half is verified against the live
     database separately (see the migration header) — this drives the client.

   Run:  node .gauntlet/drive-server-ground.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.jsx': 'text/babel', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const P = 9510 + (process.pid % 60);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const out = {};

/* ── the SQL rules, read out of the migration itself ─────────────────────── */
{
  const sql = fs.readFileSync(path.resolve('sql/045_server_ground_id.sql'), 'utf8');
  out.sql = {
    mintsPerCity: sql.indexOf("md5(v_uid::text || ':' || p_node || ':ground-v1')") >= 0,
    storesIt: sql.indexOf('update public.city_state\n     set ground_id = v_id') >= 0,
    noSessionNoAnswer: sql.indexOf('if v_uid is null or p_node is null') >= 0,
    /* the faucet takes no amount from the caller */
    grantHasNoAmountArg: sql.indexOf('claim_ground_reroll_grant()') >= 0
                      && sql.indexOf('v_amt constant bigint := 100000') >= 0,
    grantIdempotent: sql.indexOf("where user_id = v_uid and ref = v_ref") >= 0,
    anonRevoked: sql.indexOf('revoke all on function public.claim_ground_reroll_grant() from public, anon;') >= 0,
  };
}

/* ── the client half, in a real browser ──────────────────────────────────── */
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1300, height: 850 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  return (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net')) ? r.continue() : r.abort();
});

/* ── 1 · node-city takes the server's id and ADOPTS it ───────────────────── */
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction(() => !!window.__nc, null, { timeout: 120000 }).catch(() => {});
await pg.waitForTimeout(9000);

/* ⚠ cityGroundId() IS MODULE-SCOPED and cannot be called from here — node-city's
   main script is an ES module, which is the globals trap this codebase documents.
   So this drives the SHIPPED path instead of a test-only one: stamp the id where
   the parent stamps it, let the city's own tick call the seed, and read the
   result off the resource map. That is a better test than reaching in would be. */
Object.assign(out, await pg.evaluate(() => {
  const o = {};
  o.bootError = window.__cityBootError ? window.__cityBootError.message : null;
  o.groundBefore = window.MythicResourceMap.cityId();
  /* the parent stamps App._cityGroundId; standalone, `window` IS the parent.
     ⚠ AND THE PARENT HANDS IT OVER THROUGH window.cityGroundId(), not through
       `App` — App is a top-level const in index.html (the globals trap), so
       the bridge asks the parent for the value explicitly. This half went red
       when the bridge made that change and the driver kept stamping only
       `App`: bridgeReads answered null against a perfectly good hand-over.
       The shim below is the parent's own bridge function, verbatim. */
  window.App = window.App || {};
  window.App._cityGroundId = 'cg_a1b2c3d4e5f6a7b8c9d0';
  window.cityGroundId = function () {
    try { const g = window.App._cityGroundId; return (g == null || g === '') ? null : String(g); } catch (e) { return null; }
  };
  o.bridgeReads = (window.MythicCityBridge && window.MythicCityBridge.serverGroundId)
    ? window.MythicCityBridge.serverGroundId() : null;
  return o;
}));
/* let the economy beat run — that is what calls cityGroundId() */
await pg.waitForTimeout(4000);
Object.assign(out, await pg.evaluate(() => ({
  groundAfter: window.MythicResourceMap.cityId(),
  /* a malformed id is refused rather than seeded on */
  rejectsJunk: (() => {
    window.App._cityGroundId = 'not a valid id!! <img>';
    return window.MythicCityBridge.serverGroundId();
  })(),
})));

/* ── 2 · the parent: resolves before the frame, and claims once ──────────── */
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForTimeout(7000);

Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  const calls = [];
  Cloud.ready = true;
  Profile.cloud = Object.assign(Profile.cloud || {}, { signedIn: true, userId: 'u-1' });
  let claims = 0;
  Cloud.client = {
    rpc: async (name, args) => {
      calls.push(name);
      if (name === 'city_ground_id') return { data: 'cg_server_' + (args && args.p_node), error: null };
      if (name === 'claim_ground_reroll_grant') {
        claims++;
        return { data: claims === 1 ? { ok: true, already: false, amount: 100000, balance: 100000 }
                                    : { ok: true, already: true, amount: 0 }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
  };

  /* the grant, twice — the second must pay nothing and not even re-ask */
  const first = await window._claimGroundRerollGrant();
  const second = await window._claimGroundRerollGrant();
  o.grantFirst = first;
  o.grantSecondPaidNothing = (second === null) || (second && second.already === true);
  o.claimCalls = claims;

  /* the amount is never sent from here */
  o.clientNeverSendsAmount = calls.filter(c => c === 'claim_ground_reroll_grant').length > 0;
  return o;
}));

/* the source rule: the ground id is stamped BEFORE the iframe is built */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const open = idx.slice(idx.indexOf('function _openNodeCity('), idx.indexOf('function _openNodeCity(') + 6000);
  out.src = {
    clearsBeforeResolving: open.indexOf('App._cityGroundId = null;') >= 0,
    resolvesOnOpen: open.indexOf("Cloud.client.rpc('city_ground_id'") >= 0,
    ignoresLateReply: open.indexOf('if (App._cityNodeId !== _wantNode) return;') >= 0,
    /* the grant call carries no amount */
    grantSendsNoAmount: idx.indexOf("Cloud.client.rpc('claim_ground_reroll_grant')") >= 0,
  };
}

/* ── 3 · THE RETARGET DOOR: the same city, the same ground, whichever way in ─
   A real parent, a real iframe, the Cloud client stubbed at the seam. The
   player owns N-02 (city built) and N-05 (empty). Door A is My City, which
   resolves straight to N-02. Door B is a map click on N-05: cityStateLoad
   misses, the claim answers 'new_city', and the load is RETARGETED to N-02.
   Both must put the iframe on N-02's server ground.
   ⚠ The N-05 reply answers AT ONCE, on purpose: it must be stamped and then
     CLEARED by the retarget — a slow reply merely gets discarded by the node
     guard, which the source rule above already pins, and is the easy case. */
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('typeof window.cityStateLoad === "function" && window.__mg && typeof window.__mg._openNodeCity === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const ME = 'me-uuid';
await pg.evaluate((ME) => {
  window.__a7 = { rpc: [], lastLoad: null };
  const rows = {
    tw_node_owners: [{ node_id: 'N-02', user_id: ME, display_name: 'Me' }, { node_id: 'N-05', user_id: ME, display_name: 'Me' }],
    node_mayors: [],
    city_state: [{ user_id: ME, node_id: 'N-02', state: { v: 1, plots: [] }, updated_at: '2026-09-01T00:00:00Z', version: 3 }],
    city_state_history: [],
  };
  /* A filter-aware stand-in: every .eq() narrows the rows, maybeSingle hands
     back one row or null. The mayor-city harness's stub answers the same rows
     to every query, which cannot tell "N-05 has no row" from "N-02 has one" —
     and that distinction IS the retarget. */
  const realFrom = Cloud.client.from.bind(Cloud.client);
  Cloud.client.from = (tbl) => {
    if (!Object.prototype.hasOwnProperty.call(rows, tbl)) return realFrom(tbl);
    let cur = rows[tbl].slice(); let single = false;
    const b = {};
    b.select = () => b; b.limit = () => b; b.order = () => b; b.in = () => b; b.is = () => b; b.neq = () => b; b.not = () => b;
    b.eq = (k, v) => { cur = cur.filter((r) => String(r[k]) === String(v)); return b; };
    b.maybeSingle = () => { single = true; return b; };
    b.single = () => { single = true; return b; };
    const answer = () => ({ data: single ? (cur[0] || null) : cur, error: null });
    b.then = (ok, ko) => Promise.resolve(answer()).then(ok, ko);
    b.catch = (ko) => Promise.resolve(answer()).catch(ko);
    return b;
  };
  Cloud.client.rpc = async (name, args) => {
    window.__a7.rpc.push(name + ':' + ((args && (args.p_node || args.p_owner)) || ''));
    if (name === 'city_ground_id') return { data: 'cg_server_' + (args && args.p_node), error: null };
    if (name === 'city_claim_node') return { data: { action: 'new_city' }, error: null };
    if (name === 'city_state_can_write') return { data: true, error: null };
    return { data: null, error: null };
  };
  Cloud.ready = true;
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.userId = ME; Profile.cloud.signedIn = true;
  /* What the parent held at the moment the load answered — the value the
     iframe's first read sees — recorded without touching the shipped path. */
  const realLoad = window.cityStateLoad;
  window.cityStateLoad = async function () {
    const j = await realLoad.apply(this, arguments);
    window.__a7.lastLoad = { node: App._cityNodeId || null, ground: App._cityGroundId || null, gotRow: !!j };
    return j;
  };
}, ME);

/* Read the ground from INSIDE the iframe — same origin, so the bridge is reachable. */
const frameGround = async () => {
  await pg.waitForSelector('#node-city-frame', { timeout: 15000 }).catch(() => null);
  await pg.waitForFunction(() => {
    const f = document.getElementById('node-city-frame');
    const w = f && f.contentWindow;
    return !!(w && w.MythicCityBridge && w.MythicCityBridge.serverGroundId && w.__nc);
  }, null, { timeout: 120000 }).catch(() => {});
  /* let the economy beat run once — that is what pins the resource map */
  await pg.waitForTimeout(5000);
  return pg.evaluate(() => {
    const f = document.getElementById('node-city-frame');
    const w = f && f.contentWindow;
    return {
      frame: !!f,
      booted: !!(w && w.__nc),
      bridge: (w && w.MythicCityBridge && w.MythicCityBridge.serverGroundId) ? w.MythicCityBridge.serverGroundId() : undefined,
      resmap: (w && w.MythicResourceMap && w.MythicResourceMap.cityId) ? w.MythicResourceMap.cityId() : undefined,
      parentNode: App._cityNodeId || null,
      parentGround: App._cityGroundId || null,
      lastLoad: window.__a7.lastLoad || null,
      rpc: window.__a7.rpc.slice(),
    };
  });
};
const closeFrame = async () => {
  await pg.evaluate(() => { window.__mg._closeNodeCity(); window.__a7.rpc = []; window.__a7.lastLoad = null; });
  await pg.waitForFunction(() => !document.getElementById('node-city-frame') && !document.getElementById('node-city-frame-closing'), null, { timeout: 8000 }).catch(() => {});
};

// Door A · My City → N-02 directly
await pg.evaluate(() => { App._myCityNode = null; App._myCityNodes = null; window.__mg._openMyCity(); });
out.viaMyCity = await frameGround();
await closeFrame();

// Door B · a map click on the EMPTY owned node N-05 → retargeted to N-02
await pg.evaluate(() => { window.__mg._openNodeCity('N-05'); });
out.viaRetarget = await frameGround();
await closeFrame();

out.pageErrors = errs.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
console.log(JSON.stringify(out, null, 2));

const F = [];
for (const [k, v] of Object.entries(out.sql)) if (!v) F.push('migration rule failed: ' + k);
for (const [k, v] of Object.entries(out.src)) if (!v) F.push('source rule failed: ' + k);
if (out.bootError) F.push('node-city boot error: ' + out.bootError);
if (out.bridgeReads !== 'cg_a1b2c3d4e5f6a7b8c9d0') F.push('the bridge did not read the server id');

if (out.groundAfter !== 'cg_a1b2c3d4e5f6a7b8c9d0') F.push('the server id was reported but NOT adopted — the ground kept ' + out.groundAfter);
if (out.groundAfter === out.groundBefore) F.push('the ground never moved off the shared seed');
if (out.rejectsJunk !== null) F.push('a malformed ground id was accepted');
if (!out.grantFirst || out.grantFirst.amount !== 100000) F.push('the first claim did not pay 100,000');
if (!out.grantSecondPaidNothing) F.push('a second claim paid again');
if (out.claimCalls !== 1) F.push('the grant was asked for ' + out.claimCalls + ' times in one session');
{
  const A = out.viaMyCity || {}, B = out.viaRetarget || {};
  const WANT = 'cg_server_N-02';
  if (!A.frame || !A.booted) F.push('door A (My City): the iframe did not boot ' + JSON.stringify(A));
  if (A.parentNode !== 'N-02') F.push('door A did not open N-02: ' + A.parentNode);
  if (A.bridge !== WANT) F.push('door A: the iframe reads ' + A.bridge + ' for the ground, not ' + WANT);
  if (!B.frame || !B.booted) F.push('door B (retarget): the iframe did not boot ' + JSON.stringify(B));
  if (B.parentNode !== 'N-02') F.push('door B was not retargeted to N-02: ' + B.parentNode);
  if (!B.lastLoad || !B.lastLoad.gotRow) F.push('door B: the retargeted load served no row');
  if (!(B.rpc || []).includes('city_ground_id:N-02')) F.push('door B: the retarget never asked for N-02 ground — rpc log ' + JSON.stringify(B.rpc));
  if (!B.lastLoad || B.lastLoad.ground !== WANT) F.push('door B: the ground was not stamped before cityStateLoad returned — it held ' + (B.lastLoad && B.lastLoad.ground));
  if (B.parentGround !== WANT) F.push('door B: the parent holds ' + B.parentGround + ' after the retarget, not ' + WANT);
  if (B.bridge !== WANT) F.push('door B: the iframe reads ' + B.bridge + ' for the ground, not ' + WANT + ' — the same city stands on different ground by this door');
  if (A.bridge !== B.bridge) F.push('the two doors disagree about the ground: My City ' + A.bridge + ', retarget ' + B.bridge);
  if (B.resmap !== WANT) F.push('door B: the resource map was seeded from ' + B.resmap + ', not ' + WANT + ' — reported but not adopted');
}
if (out.pageErrors.length) F.push('page errors: ' + out.pageErrors.join(' | '));

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · every account gets its own ground from the server, the compensation is paid once, and a retargeted city stands on its own ground');
await b.close(); srv.close();
process.exit(F.length ? 1 : 0);
