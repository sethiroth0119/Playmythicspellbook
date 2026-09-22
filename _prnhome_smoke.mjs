/* 🏠 A PRN ANCHORS ONLY IN THE CITY IT STANDS IN
   (bug-mucvogzk, bug-mucu5m51, bug-mtqasoy6 — owner's decisions A–D, 2026-09-22).

   Before: every PRN a player owned rang EVERY city they owned. A second city
   inherited population cap and link from nodes that were never its own, both
   cities' economies stood on the same anchors[0] ground, and city_profiles was
   keyed by that unstable PRN id (duplicate cities on the corp roster).

   This drives the REAL functions lifted out of node-city/index.html and
   index.html:
     A. the bridge's anchorRow + ringHere + fetchNodes (site filter, counts)
     B. anchorsAwayNote — the honest "not here" message
     C. anchorsResync — site / unsite mid-session, never over a building,
        anchorAt kept
     D. anchorsLateRing — concludes on "owns some, none here"
     E. ownedNodeRows / bldNodeCo / thriveNodeLevel player-wide; popCap per city
     F. econGroundId — existing cities pinned where they are; new cities get
        their own ground (server id, owner only → TW node); mayors never mint
     G. cityTradePublish keys by the TW node
     H. _corpMemberCitiesFetch — TW ownership, legacy transition
     I. _ctPrimeCityIds — the node owner's row wins
     J. sql/192 shape

   Run: node _prnhome_smoke.mjs */
import { readFileSync, existsSync } from 'fs';
import vm from 'vm';
let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; else passes++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IX = readFileSync('./public/index.html', 'utf8');

function balancedFrom(src, i, label) {
  if (i < 0) throw new Error('cannot find ' + label);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + label);
}
const fnText = (src, name) => balancedFrom(src, src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(')), name);
const assignText = (src, lhs) => balancedFrom(src, src.indexOf(lhs), lhs) + ';';
const lineOf = (src, re) => { const m = src.match(re); if (!m) throw new Error('cannot find ' + re); return m[0].replace(/^const /, 'var '); };
const tick = () => new Promise((r) => setTimeout(r, 0));

const PRN = (id, site, level, type) => ({ id, node_type: type || 'supply', name: id, owner_id: 'me',
  meta: Object.assign({ eff: 90, level: level || 1 }, site ? { site: { nodeId: site, x: 3, y: 4 } } : {}) });

/* ── A. the bridge: anchorRow + ringHere + fetchNodes ─────────────────────── */
function bridge(here, opts) {
  opts = opts || {};
  const ctx = { String, Array, Object, Promise, setTimeout, clearTimeout, console,
    B: { mode: 'parent' }, HERE: here,
    P: {
      cityOwnerIdentity: () => ({ viewerId: 'me', isOwner: !opts.foreign }),
      cityOwnerNodes: async () => (opts.ownerRows === undefined ? null : opts.ownerRows),
      FoundationReserve: { nodes: opts.reserve || [] },
    },
  };
  vm.createContext(ctx);
  const start = NC.indexOf('const anchorRow = (n) => ({');
  const end = NC.indexOf('B.cityNodeId = () => cityNodeIdForKey();');
  if (start < 0 || end < 0) throw new Error('bridge block not found');
  vm.runInContext('function cityNodeIdForKey() { return HERE; }\n' + NC.slice(start, end)
    + '\nconst _ncBound = (p) => p;\n' + assignText(NC, 'B.fetchNodes = async () =>'), ctx);
  return ctx;
}
{
  const rows = [PRN('a', 'N-25', 7), PRN('b', 'N-25'), PRN('c', 'N-04'), PRN('d', null), PRN('e', null)];
  const c = bridge('N-25', { reserve: rows });
  const got = await c.B.fetchNodes();
  ok(got.map((n) => n.id).join() === 'a,b', 'own city N-25 rings only the PRNs sited on N-25', got.map((n) => n.id).join());
  ok(got[0].site === 'N-25' && got[0].level === 7, 'anchorRow carries site and keeps meta.level (b0ce51b1)', JSON.stringify(got[0]));
  ok(c.B.ownedNodes.length === 5, 'B.ownedNodes keeps every PRN the owner holds', c.B.ownedNodes.length);
  ok(c.B.nodesElsewhere === 1 && c.B.nodesUnsited === 2, 'counts: 1 sited elsewhere, 2 never placed', c.B.nodesElsewhere + '/' + c.B.nodesUnsited);
  const c2 = bridge('N-04', { reserve: rows });
  ok((await c2.B.fetchNodes()).map((n) => n.id).join() === 'c', 'the second city N-04 rings only its own PRN — no inheritance');
  const c3 = bridge(null, { reserve: rows });
  ok((await c3.B.fetchNodes()).length === 0 && c3.B.nodesUnsited === 2, 'no TW node open → no PRN can be sited here → none rung');
  const c4 = bridge('N-99', { reserve: [PRN('x', null), PRN('y', null)] });
  ok((await c4.B.fetchNodes()).length === 0 && c4.B.nodesUnsited === 2, 'unsited PRNs anchor NOWHERE (decision A)');
  const other = Object.assign(PRN('z', 'N-25'), { owner_id: 'corp-founder' });
  const c5 = bridge('N-25', { reserve: [PRN('a', 'N-25'), other] });
  ok((await c5.B.fetchNodes()).map((n) => n.id).join() === 'a', 'the 2026-09-10 owner-only rule still holds (a corp-mate\'s PRN never rings here)');
  const c6 = bridge('N-25', { ownerRows: [PRN('m1', 'N-25'), PRN('m2', 'N-30')], foreign: true });
  const m = await c6.B.fetchNodes();
  ok(m.map((n) => n.id).join() === 'm1' && c6.B.nodesForeign === true, 'a mayor managing N-25 sees only the owner\'s PRN on N-25');
  ok(/const _ncBound = \(p, ms, fallback\)/.test(NC) && /B\.nodesUnknown = \(own === LATE\)/.test(NC), 'the bounded owner read (bug-mtr5xz8t) is untouched');
}

/* ── B. the honest message ────────────────────────────────────────────────── */
{
  const ctx = { MythicCityBridge: { nodesElsewhere: 3, nodesUnsited: 0 } };
  vm.createContext(ctx);
  vm.runInContext(fnText(NC, 'anchorsAwayNote'), ctx);
  ok(ctx.anchorsAwayNote(true) === 'Your 3 PRNs stand in other cities.', 'sited elsewhere → "Your N PRNs stand in other cities"', ctx.anchorsAwayNote(true));
  ctx.MythicCityBridge = { nodesElsewhere: 0, nodesUnsited: 2 };
  ok(ctx.anchorsAwayNote(true) === '2 PRNs not placed in any city — place them from Build → Foundation Reserve.', 'unsited → "N PRNs not placed in any city — place them from Build → Foundation Reserve"', ctx.anchorsAwayNote(true));
  ctx.MythicCityBridge = { nodesElsewhere: 1, nodesUnsited: 1 };
  ok(ctx.anchorsAwayNote(true) === 'Your 1 PRN stands in other cities. 1 PRN is not placed in any city — place it from Build → Foundation Reserve.', 'both at once, singular', ctx.anchorsAwayNote(true));
  ok(/only the owner can place them/.test(ctx.anchorsAwayNote(false)) && /^The owner's/.test(ctx.anchorsAwayNote(false)), 'a mayor is not told to place the owner\'s PRNs');
  ctx.MythicCityBridge = { nodesElsewhere: 0, nodesUnsited: 0 };
  ok(ctx.anchorsAwayNote(true) === '', 'owns none → "" (the caller keeps "No PRN nodes owned yet")');
  ok(/const away = anchorsAwayNote\(mine\);/.test(fnText(NC, 'spawnAnchors')), 'spawnAnchors uses it for an empty ring');
  ok(/anchorsAwayNote\(!MythicCityBridge\.nodesForeign\) \|\| 'No anchors — no PRN nodes owned\.'/.test(NC), 'and so does the node list panel');
}

/* ── C/D. the board: resync and the late ring ─────────────────────────────── */
function board(answers, owned) {
  const log = { toasts: [], saves: 0, links: 0 };
  const ctx = {
    Math, Set, Map, Promise, String, Array, Object, Number, console,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    GRID: 24, HALF: 12,
    THREE: { MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) } },
    game: { tiles: {}, anchors: [], anchorAt: {} },
    key: (x, z) => x + ',' + z,
    inGrid: (x, z) => x >= 0 && z >= 0 && x < 24 && z < 24,
    buildAnchorMesh: () => ({}), placeMeshAt: () => {}, dropTileMesh: () => {},
    computeLinks: () => { log.links++; }, updateHUD: () => {}, saveSoon: () => { log.saves++; },
    toast: (msg) => log.toasts.push(msg), logEvent: () => {},
    MythicCityBridge: {
      ownedNodes: owned, nodesElsewhere: 0, nodesUnsited: 0,
      refreshNodes: async () => true,
      getIdentity: async () => ({ owner: true }),
      fetchNodes: async () => (answers.length ? answers.shift() : []),
    },
  };
  vm.createContext(ctx);
  for (const f of ['anchorFreeNear', 'anchorSetTile', 'anchorSlots', 'reseatAnchors', 'anchorAddMissing', 'anchorsLateRing', 'anchorsResync', 'anchorsAwayNote'])
    vm.runInContext(fnText(NC, f), ctx);
  for (const re of [/const ANCHOR_LATE = [^\n]*/, /const ANCHOR_LATE_MAX = [^\n]*/])
    vm.runInContext(lineOf(NC, re), ctx);
  vm.runInContext('var ANCHOR_LATE_FETCH_MS = 20;', ctx);
  return { ctx, log };
}
const N = (id, site, level) => ({ id, node_type: 'supply', name: id, level: level || 1, eff: 100, camps: 0, site: site || null });
{
  // A city ringing a (here) and b (rung by an older build, now sited elsewhere).
  const A = N('a', 'N-25'), Bn = N('b', 'N-04');
  const b = board([[A]], [A, Bn]);
  const g = b.ctx.game;
  vm.runInContext('anchorSetTile(game.anchors[game.anchors.push({ node: ' + JSON.stringify(A) + ', x: 5, z: 5, link: 0, key: "5,5" }) - 1], 5, 5);'
    + 'anchorSetTile(game.anchors[game.anchors.push({ node: ' + JSON.stringify(Bn) + ', x: 9, z: 9, link: 0, key: "9,9" }) - 1], 9, 9);', b.ctx);
  g.tiles['9,10'] = { type: 'scrapmine', lvl: 2 };
  const n = await b.ctx.anchorsResync();
  ok(n === 1 && g.anchors.length === 1 && g.anchors[0].node.id === 'a', 'resync takes the anchor that no longer belongs here off the ring', n);
  ok(!g.tiles['9,9'] && g.tiles['5,5'].type === 'anchor', 'its tile is cleared; the one that belongs stays put');
  ok(g.tiles['9,10'] && g.tiles['9,10'].type === 'scrapmine', 'no building is touched');
  ok(g.anchorAt.b === '9,9', 'and its anchorAt memory is KEPT', g.anchorAt.b);
  ok(b.log.links === 1 && b.log.saves === 1, 'links recomputed and saved once');
  // …and the player now places b HERE: it comes back where they last had it.
  b.ctx.MythicCityBridge.fetchNodes = async () => [A, N('b', 'N-25')];
  await b.ctx.anchorsResync();
  const back = g.anchors.find((a) => a.node.id === 'b');
  ok(back && back.key === '9,9', 'siting it here re-rings it on its remembered plot', back && back.key);
  // A read that cannot tell removes nothing.
  const c = board([], []);
  vm.runInContext('game.anchors.push({ node: { id: "q" }, x: 1, z: 1, key: "1,1" }); game.tiles["1,1"] = { type: "anchor", anchor: game.anchors[0] };', c.ctx);
  c.ctx.MythicCityBridge.fetchNodes = async () => [];
  await c.ctx.anchorsResync();
  ok(c.ctx.game.anchors.length === 1, 'an empty owned list is "cannot tell" — nothing is removed');
  c.ctx.MythicCityBridge.fetchNodes = async () => { throw new Error('x'); };
  ok((await c.ctx.anchorsResync()) === 0 && c.ctx.game.anchors.length === 1, 'a throwing read removes nothing');
  ok(/anchorsResync\(\);[^\n]*\n[\s\S]{0,40}openInspect\(pk\);/.test(NC) || /Placed here → this is now the one city it anchors in \(anchorsResync\)\.\n\s*try \{ anchorsResync\(\); \} catch \(e\) \{\}\n\s*openInspect\(pk\);/.test(NC), 'placing a PRN re-rings (wired after a successful prnSite)');
  ok(/Released from this city → it no longer anchors here \(anchorsResync\)\.\n\s*try \{ anchorsResync\(\); \} catch \(e\) \{\}/.test(NC), 'releasing one re-rings (wired after a successful prnUnsite)');
}
{
  // D. late ring: the reserve landed, the owner holds PRNs, none is here.
  const d = board([[]], [N('x', 'N-04')]);
  d.ctx.MythicCityBridge.nodesElsewhere = 1;
  ok((await d.ctx.anchorsLateRing()) === 0 && d.ctx.ANCHOR_LATE.done, '"owns some, none here" concludes the late ring (no 8 pointless re-reads)');
  ok(d.log.toasts.length === 1 && /Your 1 PRN stands in other cities/.test(d.log.toasts[0]), 'and says where they are, once', d.log.toasts[0]);
  const e = board([[]], [N('x', null)]);
  e.ctx.MythicCityBridge.nodesUnsited = 1;
  e.ctx.ANCHOR_LATE.noted = true;
  await e.ctx.anchorsLateRing();
  ok(e.ctx.ANCHOR_LATE.done && e.log.toasts.length === 0, 'not said twice when boot already said it');
  const f = board([[], [N('late', 'N-25')]], null);
  ok((await f.ctx.anchorsLateRing()) === 0 && !f.ctx.ANCHOR_LATE.done, 'an unread reserve is still "not yet" (24475705 behaviour)');
  ok((await f.ctx.anchorsLateRing()) === 1 && f.ctx.game.anchors.length === 1, 'and the late PRN is rung when it lands');
}

/* ── E. perks: player-wide vs per-city ───────────────────────────────────── */
{
  const ctx = { Math, Object, game: { tiles: {}, anchors: [] }, BUILDINGS: { house: { popCap: 5 } }, bldSite: () => false,
    ARMY: { nodePopPerLvl: 4 }, window: {}, MythicCityBridge: { ownedNodes: [N('far', 'N-04', 7), N('loose', null, 3)] } };
  vm.createContext(ctx);
  for (const f of ['ownedNodeRows', 'bldNodeCo', 'thriveNodeLevel', 'popCap']) vm.runInContext(fnText(NC, f), ctx);
  ok(ctx.bldNodeCo() === true, 'a city with ZERO anchors keeps the construction ceiling when its owner holds a PRN anywhere (the 21 build cards stay open)');
  ok(ctx.thriveNodeLevel() === 7, 'thriveNodeLevel reads the owner\'s best PRN wherever it stands', ctx.thriveNodeLevel());
  ok(ctx.popCap() === 4, 'popCap counts only THIS city\'s anchors — none here, no node housing', ctx.popCap());
  ctx.game.anchors = [{ node: N('here', 'N-25', 2) }];
  ok(ctx.popCap() === 4 + 8, 'one level-2 anchor here → +8', ctx.popCap());
  ctx.MythicCityBridge = { ownedNodes: [] }; ctx.game.anchors = [];
  ok(ctx.bldNodeCo() === false && ctx.thriveNodeLevel() === 1, 'owns none → ceiling closed, thrive level 1, as before');
  ctx.MythicCityBridge = {}; ctx.game.anchors = [{ node: N('r', null, 4) }];
  ok(ctx.bldNodeCo() === true && ctx.thriveNodeLevel() === 4, 'bridge never answered → falls back to the ring');
  ok(/function citySync\(\) \{\n  if \(!game\.anchors\.length\) return 0;/.test(NC) && /function alliedCamps\(\) \{ return game\.anchors\.reduce/.test(NC),
    'sync % and allied camps stay per-city (read game.anchors)');
}

/* ── F. the economy's ground: existing cities PINNED where they are ─────── */
{
  const ctx = { game: { anchors: [] }, MythicCityBridge: {} };
  vm.createContext(ctx);
  vm.runInContext(lineOf(NC, /var _econGroundPin = '';/) + '\n' + fnText(NC, 'econGroundId'), ctx);
  const pin = () => vm.runInContext('_econGroundPin', ctx);
  const reset = (b, p) => { ctx.MythicCityBridge = b; ctx.game.anchors = []; vm.runInContext('_econGroundPin = ' + JSON.stringify(p || ''), ctx); };
  const owner = { serverGroundId: () => 'cg_owner', cityNodeId: () => 'N-25' };
  // Lived city on a PRN ground: the per-city filter has emptied its ring — it must NOT move.
  reset(Object.assign({ ownedNodes: [{ id: 'prn-elsewhere' }] }, owner));
  ok(ctx.econGroundId({ nodeId: 'prn-old-ground', firms: {} }, 'established') === 'prn-old-ground' && pin() === 'prn-old-ground',
    'an existing city keeps the ground its saved economy is on, and pins it');
  ctx.game.anchors = [{ node: { id: 'prn-new-first' } }]; ctx.MythicCityBridge.ownedNodes = [{ id: 'other' }];
  ok(ctx.econGroundId(null, 'established') === 'prn-old-ground', 'once pinned it never changes, whatever the anchors do later');
  reset(owner);
  ok(ctx.econGroundId({ nodeId: 'local-city' }, 'established') === 'local-city', 'a city on the shared local-city ground stays there (accepted)');
  // Lived city whose blob has no nodeId: the OLD expression, from the old all-PRNs order.
  reset(Object.assign({ ownedNodes: [{ id: 'first-of-all' }, { id: 'b' }] }, owner));
  ctx.game.anchors = [{ node: { id: 'filtered-ring-first' } }];
  ok(ctx.econGroundId({ firms: {} }, 'established') === 'first-of-all', 'no saved nodeId → the old all-PRNs ring\'s first PRN, not the filtered ring', pin());
  reset(owner);
  ok(ctx.econGroundId(null, 'established') === 'local-city', 'lived, no blob, no PRN → local-city, pinned', pin());
  // New city: its own ground.
  reset(owner);
  ok(ctx.econGroundId(null, 'new') === 'cg_owner' && pin() === 'cg_owner', 'a NEW city takes the server ground id (owner), pinned');
  reset({ serverGroundId: () => null, cityNodeId: () => 'N-25' });
  ok(ctx.econGroundId(null, 'new') === 'N-25' && pin() === 'N-25', 'new city, RPC not answered → its TW node, pinned');
  // Mayor never mints.
  reset({ nodesForeign: true, serverGroundId: () => 'cg_MAYOR', cityNodeId: () => 'N-25' });
  ok(ctx.econGroundId(null, 'new') === 'N-25', 'a mayor opening a NEW client city takes the TW node, never the mayor\'s minted id');
  reset({ nodesForeign: true, serverGroundId: () => 'cg_MAYOR', cityNodeId: () => 'N-25' });
  ok(ctx.econGroundId({ nodeId: 'owners-ground' }, 'established') === 'owners-ground', 'a mayor in a lived city pins the OWNER\'s current ground');
  reset({ nodesForeign: true, serverGroundId: () => 'cg_MAYOR' }, 'owners-pin');
  ok(ctx.econGroundId({ nodeId: 'x' }, 'established') === 'owners-pin', 'and an existing pin always wins');
  // Unknown verdict: answer, never pin.
  reset(Object.assign({ ownedNodes: [{ id: 'p1' }] }, owner));
  ok(ctx.econGroundId(null, 'unknown') === 'p1' && pin() === '', 'an ambiguous read answers the legacy ground and pins nothing');
  reset({ serverGroundId: () => 'bad id!', cityNodeId: () => 'N-25' });
  ok(ctx.econGroundId(null, 'new') === 'N-25', 'a malformed id is never used');
  ok(/const nodeId = econGroundId\(_pendingEconomy, _cityVerdict\);/.test(NC) && !/const nodeId = \(game\.anchors && game\.anchors\[0\]/.test(NC), 'E.mount grounds through econGroundId with the saved blob and verdict');
  ok(/econGround: _econGroundPin \|\| undefined,/.test(NC) && /_econGroundPin = \(typeof s\.econGround === 'string'\) \? s\.econGround : '';/.test(NC), 'the pin rides the city save (serialize + loadState)');
  ok(!/now stands on this city\\'s own ground/.test(NC) && !/economy now stands on its own ground/.test(NC), 'no "economy moved" toast/log — pinned cities do not move');
}

/* ── G. cityTradePublish keys by the TW node ─────────────────────────────── */
{
  const calls = [];
  const sb = { from: () => ({ upsert: (row, o) => { calls.push({ row, o }); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'cp1' } }) }) }; } }), rpc: async () => ({}) };
  const ctx = { window: { cityOwnerIdentity: () => ({ isOwner: true }) }, App: { _cityNodeId: 'N-25' }, Profile: { cloud: { userId: 'me' }, name: 'Me' },
    _cityTradeClient: () => sb, Math, Number, String, Array, Object, isFinite, Date, console };
  vm.createContext(ctx);
  vm.runInContext(assignText(IX, 'window.cityTradePublish = async function (payload)'), ctx);
  await ctx.window.cityTradePublish({ nodeId: 'cg_ground', specs: [], sells: {}, buys: {}, offers: [] });
  ok(calls[0] && calls[0].row.node_id === 'N-25', 'published under the city\'s TW node, not the economy ground', calls[0] && calls[0].row.node_id);
  ctx.App._cityNodeId = null;
  await ctx.window.cityTradePublish({ nodeId: 'local-city', specs: [], sells: {}, buys: {}, offers: [] });
  ok(calls[1] && calls[1].row.node_id === 'local-city', 'a node-less city keeps its old key', calls[1] && calls[1].row.node_id);
}

/* ── H. corp roster: TW ownership, with the transition ───────────────────── */
async function roster(tables, members) {
  const q = (t) => {
    const st = { t, f: {} };
    const api = { select: () => api, in: (k, v) => { st.f[k] = v; return api; }, limit: async () => {
      if (tables[t] === 'error') return { error: { message: 'x' } };
      return { data: (tables[t] || []).filter((r) => Object.keys(st.f).every((k) => st.f[k].includes(r[k]))) };
    } };
    return api;
  };
  const ctx = { Corp: { roster: members }, Cloud: { client: { from: q } }, Object, String, Array, isFinite, Number };
  vm.createContext(ctx);
  vm.runInContext(fnText(IX, '_corpMemberCitiesFetch'), ctx);
  await ctx._corpMemberCitiesFetch();
  return ctx.Corp;
}
{
  const members = [{ userId: 'A', name: 'Ann' }, { userId: 'B', name: 'Bo' }];
  const UU = '11111111-2222-3333-4444-555555555555', UU2 = '99999999-2222-3333-4444-555555555555';
  const cp = (o, n, at) => ({ owner_id: o, node_id: n, city_name: o + '@' + n, updated_at: at || '2026-09-20' });
  // Before any republish: only legacy PRN rows exist.
  let C = await roster({
    city_profiles: [cp('A', UU), cp('A', 'local-city')],
    tw_node_owners: [{ node_id: 'N-25', user_id: 'A' }],
    economy_nodes: [{ id: UU, owner_id: 'A' }],
  }, members);
  ok(C.memberCitiesState === 'ok' && C.memberCities[0].cities.length === 1 && C.memberCities[0].cities[0].nodeId === UU,
    'transition: a member whose only row is PRN-keyed still shows their city (old rule) until it republishes');
  // After the republish: the TW row replaces it — never listed twice.
  C = await roster({
    city_profiles: [cp('A', UU), cp('A', 'N-25', '2026-09-22'), cp('A', UU2), cp('B', 'N-25')],
    tw_node_owners: [{ node_id: 'N-25', user_id: 'A' }],
    economy_nodes: [{ id: UU, owner_id: 'A' }, { id: UU2, owner_id: 'A' }],
  }, members);
  ok(C.memberCities[0].cities.map((c) => c.nodeId).join() === 'N-25', 'once the city publishes under N-25 the stale PRN rows drop out (bug-mtqasoy6)', C.memberCities[0].cities.map((c) => c.nodeId).join());
  ok(C.memberCities[1].cities.length === 0 && C.memberCities[1].shared.length === 1 && C.memberCities[1].shared[0].ownerName === 'Ann',
    'a member\'s city on another member\'s TW node is a SHARED row, named with the owner');
  C = await roster({ city_profiles: [cp('A', 'N-30')], tw_node_owners: 'error', economy_nodes: 'error' }, members);
  ok(C.memberCities[0].cities.length === 1, 'an ownership read that fails filters nothing (a bad read never looks like a deletion)');
  C = await roster({ city_profiles: [cp('A', 'N-30')], tw_node_owners: [{ node_id: 'N-25', user_id: 'A' }], economy_nodes: [] }, members);
  ok(C.memberCities[0].cities.length === 0, 'a city on a TW node the member no longer owns is history');
}

/* ── I. _ctPrimeCityIds: the node owner's row wins ───────────────────────── */
{
  const ctx = { App: {}, _ctReady: () => true, _twNodeOwnerUser: (n) => (n === 'N-25' ? { user_id: 'owner' } : null),
    Cloud: { client: { from: () => ({ select: () => ({ in: async () => ({ data: [
      { id: 'owners-city', node_id: 'N-25', owner_id: 'owner' },
      { id: 'squatter', node_id: 'N-25', owner_id: 'someone' },
      { id: 'only', node_id: 'N-30', owner_id: 'x' },
    ] }) }) }) } }, String };
  vm.createContext(ctx);
  vm.runInContext(fnText(IX, '_ctPrimeCityIds'), ctx);
  await ctx._ctPrimeCityIds(['N-25', 'N-30']);
  ok(ctx.App._ctCityIdByNode['N-25'] === 'owners-city', 'two cities on one node → the node owner\'s city is the trade partner', ctx.App._ctCityIdByNode['N-25']);
  ok(ctx.App._ctCityIdByNode['N-30'] === 'only', 'a node with one city resolves to it');
}

/* ── J. the migration ────────────────────────────────────────────────────── */
{
  const P = './sql/192_city_profiles_rekey.sql';
  ok(existsSync(P), 'sql/192_city_profiles_rekey.sql exists');
  const S = existsSync(P) ? readFileSync(P, 'utf8') : '';
  ok(/update public\.city_profiles p\s+set node_id = k\.tw/.test(S) && /not exists \(select 1 from public\.city_profiles x/.test(S), 're-keys in place (keeps ids, offers, agreements) and never collides');
  ok(/o\.filled_units < o\.units and o\.expires_at > now\(\)/.test(S) && /a\.proposer_city = p\.id or a\.partner_city = p\.id/.test(S), 'deletes only rows with no open offer and no agreement');
  ok(!/node_id = 'local-city'\s*;/.test(S.split('-- ── verify')[0].replace(/--[^\n]*/g, '')) && /enable row level security/.test(S), 'local-city rows untouched; backup table has RLS');
  ok(/-- ── verify[\s\S]*select[\s\S]*from public\.city_profiles;\s*$/.test(S), 'ends with a verify query');
}

console.log('\n' + passes + ' pass' + (fails ? ', ' + fails + ' FAIL' : ' — all PASS'));
process.exit(fails ? 1 : 0);
