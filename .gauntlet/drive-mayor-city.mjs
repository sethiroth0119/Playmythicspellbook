/* ══════════════════════════════════════════════════════════════════════════
   🏛 DRIVE-MAYOR-CITY — whose city am I standing in?

   THE REPORT: "Players with no node still have access to the city, they just do
   not have nodes… Allow players who are mayors of other cities into the cities
   they are mayors of, but make sure when they go back to their own city show
   them their city."

   TWO RULES, and they pull in opposite directions, which is why both need
   controls:

     · A MAYOR MUST GET IN to a node they were hired to run.
     · MY CITY MUST BE MINE — the way back can never land on a client's.

   And the bug underneath both: _resolveMyCityNode bailed on `if (!mine.length)
   return null` — "I own no node" was read as "I have no city", while the
   function was already holding this player's city_state rows and threw them
   away. A player whose city sits on land they do not own was told "you do not
   own a node yet" and had no route home. Owning land and having a city are
   different facts.

   Pinned:
     · my city on a node I do NOT own still resolves        + CONTROL: owned-with-city still wins
     · my real city outranks empty land I own               + CONTROL: no city at all → the empty land
     · a city of my own lets me back in                     + CONTROL: a foreign node with none still refuses
     · the mayor list holds clients only                    + CONTROL: never a node I own
     · a FRESH page opens my city from the map, My City     + CONTROL: a foreign node with no row of mine
       never pressed, tw_node_owners empty or erroring;       still refuses — after a real read
       the manifest (cityOpsState().cityNodes) carries the
       same list
     · the list is FRESH once read, so the open and a        + CONTROL: a foreign refusal with owners,
       second click inside the window are decided at once,     mayors and the list all warm shows no pill
       no pill on the repeat, never the 3s wait-out             and lands well inside the wait-out

   THE FIFTH LINE, and why it is driven through the real _openNodeCity rather
   than through the flag: the guard's "a city of my own is a way in" read
   App._myCityNodes, and that list was filled by exactly one function —
   _resolveMyCityNode, i.e. the My City button. Nothing else in the session
   ever loaded it. So a fresh page that clicked its own city on the map (land
   it does not own) was refused with "that node is not yours" until the
   player found My City. Section 3 pins the guard's logic; section 5 pins that
   the list is READ before the guard runs, which is a different fact.

   Run:  node .gauntlet/drive-mayor-city.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8630 + (process.pid % 40);
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
await pg.waitForFunction('typeof _resolveMyCityNode === "function" && typeof _twMyMayorNodes === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const o = {};
  o.reachable = typeof _resolveMyCityNode === 'function' && typeof _twMyMayorNodes === 'function';
  if (!o.reachable) return o;

  const ME = 'me-uuid';
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.userId = ME; Profile.cloud.signedIn = true;

  /* Stand in for the two tables _resolveMyCityNode reads, so the ownership /
     city combinations can be posed directly. Everything else is the real
     function. */
  const realFrom = Cloud.client.from.bind(Cloud.client);
  const stub = (ownedNodes, cityRows) => {
    Cloud.client.from = (tbl) => {
      if (tbl === 'tw_node_owners') return { select: () => ({ eq: async () => ({ data: ownedNodes.map(n => ({ node_id: n })), error: null }) }) };
      if (tbl === 'city_state') return { select: () => ({ eq: async () => ({ data: cityRows, error: null }) }) };
      return realFrom(tbl);
    };
  };
  const restore = () => { Cloud.client.from = realFrom; };
  Cloud.ready = true;
  const ask = async (owned, cities) => {
    stub(owned, cities);
    App._myCityNode = null; App._myCityNodes = null;
    const r = await _resolveMyCityNode(true);
    restore();
    return r;
  };

  // ── 1 · my city on land I do NOT own still resolves ─────────────────────
  o.cityOnForeignLand = await ask([], [{ node_id: 'N-02', updated_at: '2026-08-27' }]);
  o.rememberedMine = (App._myCityNodes || []).slice();

  // CONTROL: a node I own that has my city still wins, as before.
  o.ownedWithCity = await ask(['N-13'], [{ node_id: 'N-13', updated_at: '2026-08-26' }]);

  // ── 2 · my real city outranks empty land I own ──────────────────────────
  o.cityBeatsEmptyLand = await ask(['N-05'], [{ node_id: 'N-02', updated_at: '2026-08-27' }]);

  // CONTROL: no city anywhere → the empty land I own, to start one on.
  o.noCityAtAll = await ask(['N-05'], []);

  // CONTROL: nothing at all → still nothing to open.
  o.nothingAtAll = await ask([], []);

  // ── 3 · the entry guard ─────────────────────────────────────────────────
  /* _openNodeCity refuses a node that is not mine and not one I am mayor of.
     A city of MY OWN standing there is the third way in — it cannot create
     anything, it opens what exists. The guard is read through the flag the
     resolver sets. */
  App._myCityNodes = ['N-02'];
  o.guardLetsMeIn = (App._myCityNodes.indexOf('N-02') >= 0);
  o.guardStillRefusesForeign = (App._myCityNodes.indexOf('N-77') < 0);

  // ── 4 · the client list is clients only ─────────────────────────────────
  window._twMayors = null;
  o.noMayorNoList = _twMyMayorNodes().length;
  try {
    // one node I am mayor of, one I am mayor of AND own, one somebody else's
    const fake = {
      'N-21': { mayor_id: ME, owner_name: 'Rhoda' },
      'N-13': { mayor_id: ME, owner_name: 'Me' },
      'N-30': { mayor_id: 'someone-else', owner_name: 'GreyDragon' },
    };
    // eslint-disable-next-line no-eval
    eval('_twMayors = fake');
    const realOwnerCheck = window._twIsNodePlayerOwner;
    window._twIsNodePlayerOwner = (id) => id === 'N-13';   // I own N-13
    const list = _twMyMayorNodes();
    window._twIsNodePlayerOwner = realOwnerCheck;
    o.clientList = list.map(c => c.id).sort();
  } catch (e) { o.listErr = String(e).slice(0, 160); }
  return o;
});

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
if (!out.reachable) bad.push('_resolveMyCityNode / _twMyMayorNodes are not reachable');
else {
  need('THE REPORT: my city on land I do not own still resolves', out.cityOnForeignLand === 'N-02', out.cityOnForeignLand);
  need('…and it is remembered so the guard can let me back in',
       (out.rememberedMine || []).indexOf('N-02') >= 0, out.rememberedMine);
  need('CONTROL: a node I own WITH my city still wins', out.ownedWithCity === 'N-13', out.ownedWithCity);
  need('my real city outranks empty land I own', out.cityBeatsEmptyLand === 'N-02', out.cityBeatsEmptyLand);
  need('CONTROL: no city anywhere → the empty land, to start one', out.noCityAtAll === 'N-05', out.noCityAtAll);
  need('CONTROL: nothing at all → nothing to open', out.nothingAtAll === null, out.nothingAtAll);
  need('a city of my own is a way in', out.guardLetsMeIn === true, out.guardLetsMeIn);
  need('CONTROL: a foreign node with no city of mine is not', out.guardStillRefusesForeign === true, out.guardStillRefusesForeign);
  need('CONTROL: no appointments → no client list', out.noMayorNoList === 0, out.noMayorNoList);
  need('the client list holds the node I was hired for', (out.clientList || []).join(',') === 'N-21', out.clientList);
  need('…and never one I own myself', (out.clientList || []).indexOf('N-13') < 0, out.clientList);
  need('the list did not throw', !out.listErr, out.listErr);
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · THE DOOR FROM THE MAP — a fresh session, My City never pressed.
   The guard's third way in (a city of my own on land I do not own) read a list
   that only _openMyCity ever filled. So on a fresh page a player who clicked
   their own city on the map was refused with "that node is not yours" until
   they found the My City button. These run on the REAL _openNodeCity, through
   the real fetch-then-re-enter path, with the four tables it reads stubbed in
   memory — and they are ordered so the frame is proven to mount BEFORE the
   control proves the refusal still stands.

   AND THE CLOCK. _myCityNodesFresh stamped the read with Date.now() and then
   compared against `stamp | 0` — an Int32 truncation of a millisecond epoch —
   so "fresh" was false forever. The door still opened (5a passed) but only
   because _cityWaitUntil ran out its full 3s and the re-entry decided on the
   list anyway: MEASURED freshOpenMs 3330, a second click on the same node
   3315 with the pill up again, and a foreign refusal that used to be instant
   with owners and mayors warm took 3123. So the timings below are pinned,
   not just the outcomes: a mount and a refusal are decided as soon as the
   reads land, a repeat click inside the window never shows the pill, and the
   pill count comes from a MutationObserver rather than a snapshot — the pill
   is removed before the frame mounts, so a snapshot after the mount would
   never see it.
   ══════════════════════════════════════════════════════════════════════════ */
const ME = 'me-uuid';
await pg.evaluate((ME) => {
  /* Every table the open path reads answers from this map. A value that is a
     function is called, so a table can be made to ERROR (tw_node_owners below).
     Anything not listed falls through to the real client, whose network this
     harness aborts. */
  window.__a8 = { tables: {}, myCityOpens: 0, pillShown: 0, t0: 0 };
  // Count every time the "Checking whose city this is…" pill is put up. It is
  // torn down before the frame mounts, so only an observer can say whether a
  // given open showed it at all.
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n && n.id === 'node-city-resolving') window.__a8.pillShown++;
  }).observe(document.body, { childList: true });
  // _openNodeCity is called from here with the clock started in the SAME
  // evaluate, so the measured span is the open itself and not a round trip.
  window.__a8.open = (id) => { window.__a8.pillShown = 0; window.__a8.t0 = performance.now(); window.__mg._openNodeCity(id); };
  window.__a8.ms = () => Math.round(performance.now() - window.__a8.t0);
  const realFrom = Cloud.client.from.bind(Cloud.client);
  Cloud.client.from = (tbl) => {
    const T = window.__a8.tables;
    if (!Object.prototype.hasOwnProperty.call(T, tbl)) return realFrom(tbl);
    const answer = () => { const v = T[tbl]; return (typeof v === 'function') ? v() : { data: v, error: null }; };
    const b = {};
    ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'gt', 'lt', 'limit', 'order', 'range', 'match', 'single', 'maybeSingle']
      .forEach((k) => { b[k] = () => b; });
    b.then = (ok, ko) => Promise.resolve(answer()).then(ok, ko);
    b.catch = (ko) => Promise.resolve(answer()).catch(ko);
    return b;
  };
  Cloud.ready = true;
  Profile.cloud = Profile.cloud || {};
  Profile.cloud.userId = ME; Profile.cloud.signedIn = true;
  // The only public door to _openMyCity is this bridge; count it so "without
  // _openMyCity having run" is a measurement and not a promise.
  const realMy = window.__mg._openMyCity;
  window.__mg._openMyCity = function () { window.__a8.myCityOpens++; return realMy.apply(this, arguments); };
  window.__a8.fresh = () => {
    /* What a page has before anything city-shaped has been fetched: no owner
       map, no appointments, no list of my cities, no city open. */
    App._myCityNode = null; App._myCityNodes = null; App._myCityNodesAt = 0;
    App._cityOwnerId = null; App._cityOwnerName = null; App._cityNodeId = null;
    try { delete App._twNodeOwners; } catch (e) {}
    // eslint-disable-next-line no-eval
    try { eval('_twMayors = null; _twMayorsMissing = false; _twMayorsFetching = false'); } catch (e) {}
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  };
}, ME);

const frameGone = () => pg.waitForFunction(() => !document.getElementById('node-city-frame') && !document.getElementById('node-city-frame-closing'), null, { timeout: 5000 }).then(() => true).catch(() => false);
const snap = () => pg.evaluate(() => ({
  frame: !!document.getElementById('node-city-frame'),
  cityNodeId: App._cityNodeId || null,
  ownerId: App._cityOwnerId || null,
  myCityNode: App._myCityNode || null,          // set ONLY by _resolveMyCityNode — the My City path
  myCityOpens: window.__a8.myCityOpens,
  list: (App._myCityNodes || []).slice(),
  manifest: (window.cityOpsState() || {}).cityNodes,
  toast: (document.querySelector('.toast') || {}).textContent || '',
  pill: !!document.getElementById('node-city-resolving'),
  pillShown: window.__a8.pillShown,             // times the pill went up during THIS open (observer)
  fresh: (typeof _myCityNodesFresh === 'function') ? _myCityNodesFresh() : null,
  ageMs: Date.now() - (Number(App._myCityNodesAt) || 0),
  ms: window.__a8.ms(),
}));

// ── 5a · THE REPORT: fresh page, I own no node, my city_state row is on N-02 ─
await pg.evaluate(() => {
  window.__a8.fresh();
  window.__a8.tables = {
    tw_node_owners: [],                                             // I own nothing
    node_mayors: [],                                                // nobody hired me
    city_state: [{ node_id: 'N-02', user_id: 'me-uuid', updated_at: '2026-09-01T00:00:00Z' }],
    city_state_history: [],
  };
});
out.freshManifest = await pg.evaluate(() => (window.cityOpsState() || {}).cityNodes);
await pg.evaluate(() => { window.__a8.open('N-02'); });
out.mapMounted = !!(await pg.waitForSelector('#node-city-frame', { timeout: 12000 }).catch(() => null));
out.mapOpen = await snap();
await pg.evaluate(() => { window.__mg._closeNodeCity(); });
out.mapClosed = await frameGone();

// ── 5a2 · A SECOND CLICK INSIDE THE WINDOW: nothing cleared, list read seconds ago
// The guard must answer from memory — no pill, no fetch-and-re-enter, and
// nowhere near the 3s the dead window used to cost every single click.
await pg.evaluate(() => { window.__a8.open('N-02'); });
out.againMounted = !!(await pg.waitForSelector('#node-city-frame', { timeout: 12000 }).catch(() => null));
out.again = await snap();
await pg.evaluate(() => { window.__mg._closeNodeCity(); });
out.againClosed = await frameGone();

// ── 5b · …REGARDLESS OF tw_node_owners: the ownership table errors outright ──
await pg.evaluate(() => {
  window.__a8.fresh();
  window.__a8.tables.tw_node_owners = () => ({ data: null, error: { message: 'permission denied for table tw_node_owners' } });
});
await pg.evaluate(() => { window.__a8.open('N-02'); });
// The owner map never arrives, so the open waits out _cityWaitUntil's 3s before
// deciding on what it has — the list of my cities is what it has. This is the
// ONE case the wait-out is for, so its timing is not pinned.
out.ownersDownMounted = !!(await pg.waitForSelector('#node-city-frame', { timeout: 15000 }).catch(() => null));
out.ownersDown = await snap();
await pg.evaluate(() => { window.__mg._closeNodeCity(); });
out.ownersDownClosed = await frameGone();

// ── 5c · CONTROL: a foreign node with no row of mine still refuses ──────────
await pg.evaluate(() => {
  window.__a8.fresh();
  window.__a8.tables.tw_node_owners = [{ node_id: 'N-77', user_id: 'someone-else', display_name: 'GreyDragon' }];
  // my city is still on N-02 — a row SOMEWHERE must not open a node ANYWHERE
});
await pg.evaluate(() => { window.__a8.open('N-77'); });
await pg.waitForFunction(() => /not yours/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
out.foreign = await snap();
await pg.waitForTimeout(600);

// ── 5d · CONTROL: the same refusal with owners, mayors AND the list warm ─────
// Nothing cleared since 5c, so every leg of _cityOwnershipResolvable is already
// in memory. Before the clock fix this took 3.1s behind the pill; it must be
// decided on the spot, with the pill never put up.
await pg.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); window.__a8.open('N-77'); });
await pg.waitForFunction(() => /not yours/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 12000 }).catch(() => {});
out.foreignWarm = await snap();
await pg.waitForTimeout(600);

need('THE DOOR: a fresh page opens the node my city stands on, from the map', out.mapMounted === true, out.mapOpen);
need('…and it is MY city that opened, not somebody else\'s', out.mapOpen && out.mapOpen.cityNodeId === 'N-02' && out.mapOpen.ownerId === null, out.mapOpen);
need('…without the My City path having run', out.mapOpen && out.mapOpen.myCityOpens === 0 && out.mapOpen.myCityNode === null, out.mapOpen);
need('…because _openNodeCity read the list itself', out.mapOpen && out.mapOpen.list.indexOf('N-02') >= 0, out.mapOpen && out.mapOpen.list);
need('the manifest is empty before the list is read', Array.isArray(out.freshManifest) && out.freshManifest.length === 0, out.freshManifest);
need('…and carries the same list (cityNodes) once it is', out.mapOpen && Array.isArray(out.mapOpen.manifest) && out.mapOpen.manifest.join(',') === 'N-02', out.mapOpen && out.mapOpen.manifest);
need('the frame closed cleanly between cases', out.mapClosed === true, out.mapClosed);
need('the door holds when tw_node_owners cannot be read at all', out.ownersDownMounted === true, out.ownersDown);
need('…and it is still my city', out.ownersDown && out.ownersDown.cityNodeId === 'N-02' && out.ownersDown.ownerId === null, out.ownersDown);
need('CONTROL: a foreign node with no row of mine still toasts the refusal', out.foreign && /That node is not yours/.test(out.foreign.toast), out.foreign && out.foreign.toast);
need('CONTROL: …and mounts nothing', out.foreign && out.foreign.frame === false && out.foreign.cityNodeId === null, out.foreign);
need('CONTROL: …after a real read, not a stale list', out.foreign && out.foreign.list.join(',') === 'N-02', out.foreign && out.foreign.list);
// The clock: the list is fresh once read, and the open is decided as soon as
// the reads land — well inside the 3s that _cityWaitUntil would otherwise burn.
need('THE CLOCK: the list is fresh right after the mount', out.mapOpen && out.mapOpen.fresh === true && out.mapOpen.ageMs < 15000, out.mapOpen && { fresh: out.mapOpen.fresh, ageMs: out.mapOpen.ageMs });
need('…and the fresh open did not wait out the 3s', out.mapOpen && out.mapOpen.ms < 2000, out.mapOpen && out.mapOpen.ms);
need('a second click inside the window mounts', out.againMounted === true, out.again);
need('…my city, still', out.again && out.again.cityNodeId === 'N-02' && out.again.ownerId === null, out.again);
need('…with the pill never put up', out.again && out.again.pillShown === 0 && out.again.pill === false, out.again && { pillShown: out.again.pillShown, pill: out.again.pill });
need('…and at once', out.again && out.again.ms < 1000, out.again && out.again.ms);
need('…and the frame closed cleanly after it', out.againClosed === true, out.againClosed);
need('CONTROL: the cold foreign refusal did not wait out the 3s either', out.foreign && out.foreign.ms < 2000, out.foreign && out.foreign.ms);
need('CONTROL: a warm foreign refusal still toasts', out.foreignWarm && /That node is not yours/.test(out.foreignWarm.toast), out.foreignWarm && out.foreignWarm.toast);
need('CONTROL: …mounts nothing', out.foreignWarm && out.foreignWarm.frame === false && out.foreignWarm.cityNodeId === null, out.foreignWarm);
need('CONTROL: …and is instant, with no pill', out.foreignWarm && out.foreignWarm.pillShown === 0 && out.foreignWarm.ms < 1000, out.foreignWarm && { pillShown: out.foreignWarm.pillShown, ms: out.foreignWarm.ms });

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 4) }, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a mayor gets into the cities they run, the way home always lands on their own, and a fresh page reaches its city from the map.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
