/* 🔮 PRN NODES NOT SPAWNING IN THE CITY (bug-mtwtxvg8, bug-mtr5bze0).

   spawnAnchors() asked the bridge for the nodes ONCE, at boot. In parent mode
   that answer is FoundationReserve.nodes, which the game fills on its own
   schedule — so a city opened before nodeFetch landed rang no anchors for the
   whole session. The late ring (anchorsLateRing) re-asks a bounded number of
   times, asks the parent to fetch first (cityRefreshNodes), rings what
   arrives without ever displacing a building, and stops.

   This drives the REAL functions lifted out of node-city/index.html against a
   fake board, and the parent's cityRefreshNodes against a fake reserve.

   Run: node _prnlate_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IX = readFileSync('./public/index.html', 'utf8');

function fnText(src, name) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function lineOf(src, re) { const m = src.match(re); if (!m) throw new Error('cannot find ' + re); return m[0]; }

function makeCity(answers, opts) {
  const log = { toasts: [], saves: 0, links: 0, refresh: 0 };
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
    toast: (m) => log.toasts.push(m), logEvent: () => {},
    MythicCityBridge: {
      refreshNodes: async () => { log.refresh++; return true; },
      fetchNodes: async () => {
        const a = answers.length ? answers.shift() : [];
        if (a === 'hang') return new Promise(() => {});
        if (a === 'throw') throw new Error('bridge');
        return a;
      },
    },
  };
  vm.createContext(ctx);
  for (const f of ['anchorFreeNear', 'anchorSetTile', 'anchorSlots', 'reseatAnchors', 'anchorAddMissing', 'anchorsLateRing'])
    vm.runInContext(fnText(NC, f), ctx);
  for (const re of [/const ANCHOR_LATE = [^\n]*/, /const ANCHOR_LATE_MAX = [^\n]*/, /const ANCHOR_LATE_MS  = [^\n]*/])
    vm.runInContext(lineOf(NC, re).replace(/^const /, 'var '), ctx);
  // the per-read timeout, shortened so a hang resolves in the test
  vm.runInContext('var ANCHOR_LATE_FETCH_MS = 20;', ctx);
  if (opts && opts.building) for (const k of opts.building) ctx.game.tiles[k] = { type: 'scrapmine', lvl: 1 };
  return { ctx, log, run: () => vm.runInContext('anchorsLateRing()', ctx) };
}
const N = (id, t) => ({ id, node_type: t || 'supply', name: id, level: 1, eff: 100, camps: 0 });

/* ── 1. the reserve lands late: empty, empty, then two nodes ─────────────── */
{
  const c = makeCity([[], 'throw', 'hang', [N('a'), N('b', 'mining')]]);
  ok((await c.run()) === 0 && !c.ctx.ANCHOR_LATE.done, 'an empty answer is "not yet" — the ring keeps asking');
  ok((await c.run()) === 0 && !c.ctx.ANCHOR_LATE.done, 'a throwing bridge is "not yet", never a crash');
  ok((await c.run()) === 0 && !c.ctx.ANCHOR_LATE.done, 'a hung bridge times out and is "not yet"');
  const added = await c.run();
  ok(added === 2 && c.ctx.game.anchors.length === 2, 'the late nodes are ringed', added);
  ok(c.ctx.ANCHOR_LATE.done, 'and the ring concludes on the first real answer');
  ok(c.log.refresh === 4, 'the parent is asked to fetch before every read', c.log.refresh);
  ok(c.log.links === 1 && c.log.saves === 1 && c.log.toasts.length === 1, 'links recomputed, saved and announced once');
  const tiles = Object.values(c.ctx.game.tiles).filter((t) => t.type === 'anchor');
  ok(tiles.length === 2, 'two anchor tiles on the board', tiles.length);
  ok((await c.run()) === 0 && c.log.refresh === 4, 'a concluded ring never asks again');
}

/* ── 2. never on a building, and never twice ───────────────────────────── */
{
  // anchorSlots(1) wants (12, 4.5→5) — put a building exactly there.
  const c = makeCity([[N('a')]], { building: ['12,5'] });
  vm.runInContext('game.anchors.push({ node: { id: "a" }, x: 1, z: 1, key: "1,1" }); game.tiles["1,1"] = { type: "anchor", anchor: game.anchors[0] };', c.ctx);
  ok((await c.run()) === 0 && c.ctx.game.anchors.length === 1, 'a node already on the map is not ringed twice');
  const d = makeCity([[N('z')]], { building: ['12,5'] });
  await d.run();
  const a = d.ctx.game.anchors[0];
  ok(d.ctx.game.tiles['12,5'].type === 'scrapmine', 'the building on the ring slot is still standing');
  ok(a && a.key !== '12,5' && d.ctx.game.tiles[a.key].type === 'anchor', 'the anchor took the nearest free plot', a && a.key);
}

/* ── 3. remembered position is honoured ────────────────────────────────── */
{
  const c = makeCity([[N('m')]]);
  c.ctx.game.anchorAt = { m: '3,3' };
  await c.run();
  ok(c.ctx.game.anchors[0].key === '3,3', 'a late anchor goes back to where the player last put it', c.ctx.game.anchors[0].key);
}

/* ── 4. bounded: a player with no nodes costs ANCHOR_LATE_MAX reads, then stops ── */
{
  const c = makeCity([]);
  for (let i = 0; i < 20; i++) await c.run();
  ok(c.ctx.ANCHOR_LATE.done && c.log.refresh === c.ctx.ANCHOR_LATE_MAX, 'gives up after ANCHOR_LATE_MAX reads', c.log.refresh);
}

/* ── 5. wiring ─────────────────────────────────────────────────────────── */
ok(/if \(!game\.anchors\.length\) anchorsLateRingStart\(\)/.test(NC), 'boot starts the late ring when it rang nothing');
ok(/B\.refreshNodes = async/.test(NC) && /P\.cityRefreshNodes/.test(NC), 'the bridge asks the parent through cityRefreshNodes');

/* ── 6. the parent's cityRefreshNodes ──────────────────────────────────── */
{
  let fetched = 0, owner = null;
  const ctx = {
    Date, FoundationReserve: { nodes: [] },
    nodeFetch: async () => { fetched++; ctx.FoundationReserve.nodes = [N('x')]; },
    _cityManagedOwner: () => owner, window: {},
  };
  vm.createContext(ctx);
  const src = IX.slice(IX.indexOf('let _cityRefreshNodesAt'), IX.indexOf('};', IX.indexOf('window.cityRefreshNodes')) + 2);
  vm.runInContext(src, ctx);
  owner = 'someone-else';
  ok((await ctx.window.cityRefreshNodes()) === false && fetched === 0, 'managing a client: no fetch of the viewer\'s own nodes');
  owner = null;
  ok((await ctx.window.cityRefreshNodes()) === true && fetched === 1, 'own city, empty reserve: nodeFetch runs');
  ok((await ctx.window.cityRefreshNodes()) === true && fetched === 1, 'reserve filled: no further fetch');
  ctx.FoundationReserve.nodes = [];
  ok((await ctx.window.cityRefreshNodes()) === false && fetched === 1, 'throttled: a second empty ask within 10 s does not refetch');
}

console.log(fails ? '\n' + fails + ' FAIL' : '\nall PASS');
process.exit(fails ? 1 : 0);
