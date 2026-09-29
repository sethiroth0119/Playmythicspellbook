/* 🔌 PRN CLAIMS — "the PRNs in my city are the PRNs I bought from the Foundation
   Reserve" (owner's rule, 2026-09-17), and the Node Manager seat that reaches
   the manager. Six tracker reports:
   · bug-mu2n0w7s "my own and also another Node's PRNs in my city" — a Node
     Manager's OWN city rang a client's PRNs through city_node_links.
   · bug-mtwtxvg8 "PRN nodes are not spawning … despite the usual work around"
   · bug-mtr5bze0 "Start game → Ruin Exchange → Bank of Ethos → City Hall →
     Licenses → PRNs … should all be handled in the background"
   · bug-mtwuhbwu "PRNs evolving rapidly within the City … Foundation Reserve
     still showing Level 1"
   · bug-mtyd8sio "can't see [the owner's new nodes] in the Client City list"
   · bug-mtyo8e66 "When Davos tries to add me … as the mayor, he gets an error"
   Every behaviour below is LIFTED OUT OF THE REAL FILES and run, and the key
   ones are run a second time against the committed HEAD source as a NEGATIVE
   CONTROL: the same scenario must show the bug there, or this suite could not
   have caught it.
   Run: node _prnclaims_smoke.mjs */
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import vm from 'vm';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (c) passes++; else fails++; };
const norm = (s) => s.replace(/\r\n/g, '\n');
const SRC = norm(readFileSync('./public/index.html', 'utf8'));
const NC = norm(readFileSync('./public/node-city/index.html', 'utf8'));
/* ⚠ PINNED, NOT HEAD. The negative controls must run against the source from
   BEFORE this fix; once it is committed HEAD has the fix and a HEAD control
   would fail for the wrong reason. 8fbd06a72f is the tree v175 shipped from and
   the one these six reports were filed against. Labels below say "HEAD" for
   the pre-fix tree. */
const PRE_FIX = '8fbd06a72f';
const head = (p) => { try { return norm(execFileSync('git', ['-c', 'core.eol=lf', '-c', 'core.autocrlf=false', 'show', PRE_FIX + ':' + p], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')); } catch (e) { return null; } };
const SRC0 = head('public/index.html');
const NC0 = head('public/node-city/index.html');

/* Balanced-brace extractor that skips strings, template literals and comments. */
function blockFrom(src, at) {
  let i = src.indexOf('{', at), depth = 0;
  if (i < 0) return '';
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}
const fnAt = (src, header) => { const at = src.indexOf(header); return at < 0 ? '' : blockFrom(src, at); };
const run = (code, ctx) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };

/* ── 1. node-city: the ring is the PRNs the viewer bought (bug-mu2n0w7s) ───── */
function fetchNodesOf(nc) {
  const start = nc.indexOf('  B.fetchNodes = async () => {');
  const seg = nc.slice(start, nc.indexOf("if (B.mode === 'message')", start));
  return (g) => new Function('g', 'with (g) { ' + seg + ' }; return B.fetchNodes; }')(g);
}
const anchorRow = (n) => n.id;
// A manager (mgr) opening their OWN city. They bought m1; they are the active
// Node Manager of `client`, whose PRN c1 the parent's link read hands over.
const mgrWorld = () => ({
  B: { mode: 'parent' }, anchorRow,
  P: {
    cityOwnerIdentity: () => ({ viewerId: 'mgr', isOwner: true }),
    cityOwnerNodes: async () => null,
    FoundationReserve: { nodes: [{ id: 'm1', owner_id: 'mgr' }, { id: 'k1', owner_id: 'corpmate' }] },
    cityLinkedNodes: async () => [{ id: 'c1', owner_id: 'client' }],
    cityMyNodes: async () => [{ id: 'm1', owner_id: 'mgr' }, { id: 'm2', owner_id: 'mgr', corp_id: null }],
  },
});
{
  const now = await fetchNodesOf(NC)(mgrWorld())();
  ok(JSON.stringify(now) === '["m1","m2"]', 'a manager\'s own city rings m1 + m2 (bought, one in a vanished corp) and NOT the client\'s c1', JSON.stringify(now));
  if (NC0 && NC0.indexOf('  B.fetchNodes = async () => {') >= 0) {
    const old = await fetchNodesOf(NC0)(mgrWorld())();
    ok(Array.isArray(old) && old.indexOf('c1') >= 0, 'NEGATIVE CONTROL (HEAD): the same manager\'s city rang the client\'s c1', JSON.stringify(old));
  } else ok(false, 'NEGATIVE CONTROL (HEAD): could not read the committed node-city');
  const w = mgrWorld(); delete w.P.cityMyNodes;
  ok(JSON.stringify(await fetchNodesOf(NC)(w)()) === '["m1"]', 'an older parent (no cityMyNodes): the reserve list under the same owner rule — the corpmate\'s k1 stays out');
  const w2 = mgrWorld(); w2.P.cityOwnerIdentity = () => ({ viewerId: null, isOwner: true }); delete w2.P.cityMyNodes;
  ok(JSON.stringify(await fetchNodesOf(NC)(w2)()) === '[]', 'an unresolved viewer rings nothing (it used to keep the whole corporation\'s reserve)');
  const w3 = mgrWorld(); w3.P.cityOwnerIdentity = () => ({ viewerId: 'mgr', isOwner: false }); w3.P.cityOwnerNodes = async () => [{ id: 'c1', owner_id: 'client' }];
  ok(JSON.stringify(await fetchNodesOf(NC)(w3)()) === '["c1"]', 'the CLIENT\'s city (managing) still rings the client\'s PRNs — the owner\'s nodes, as before');
  ok(!/P\.cityLinkedNodes/.test(NC), 'node-city no longer reads the parent\'s link list at all');
}

/* ── 2. parent: window.cityMyNodes reads MY rows by owner_id, any corp ────── */
{
  const at = SRC.indexOf('const _cityMyNodesCache = {');
  const end = SRC.indexOf('window.cityOwnerNodes = async function () {', at);
  ok(at > 0 && end > at, 'the owner read sits beside cityOwnerNodes');
  const code = SRC.slice(at, end) + '\nthis._rows = _cityMyNodeRows; this._C = _cityMyNodesCache;';
  const mk = (rows, opts = {}) => {
    const q = [];
    const client = { from: (t) => ({ select: () => ({ eq: (k, v) => ({ limit: async () => { q.push(t + ':' + k + '=' + v); return opts.err ? { error: { message: 'x' } } : { data: rows }; } }) }) }) };
    const ctx = { Profile: { cloud: { userId: opts.me === undefined ? 'me' : opts.me } }, Cloud: { ready: true, client },
      FoundationReserve: { nodes: opts.fr || [] }, console: { warn() {} }, setTimeout, Promise, Date, Map, Set, Array, String, Number, q };
    ctx.window = ctx;
    return run(code, ctx);
  };
  const frRow = { id: 'a', owner_id: 'me', corp_id: 'k', meta: { level: 9 } };
  let c = mk([{ id: 'a', owner_id: 'me', meta: { level: 3 } }, { id: 'o', owner_id: 'me', corp_id: null }, { id: 'x', owner_id: 'other' }], { fr: [frRow, { id: 'f', owner_id: 'founder' }] });
  let r = await c.window.cityMyNodes(true);
  ok(Array.isArray(r) && r.map((n) => n.id).sort().join(',') === 'a,o', 'returns my rows only — including a PRN whose corporation is gone (corp_id null)', JSON.stringify(r && r.map((n) => n.id)));
  ok(r.find((n) => n.id === 'a') === frRow, 'an id the Reserve also holds is handed over as the RESERVE\'s object (one copy for _nodeMetaWrite and the panel)');
  ok(c.q.length === 1 && c.q[0] === 'economy_nodes:owner_id=me', 'one read, keyed on owner_id — not corp_id', c.q.join('|'));
  await c.window.cityMyNodes();
  ok(c.q.length === 1, 'a fresh read is reused for 30 s');
  c = mk([], { me: null });
  ok((await c.window.cityMyNodes(true)) === null, 'signed out: null (nothing to say), never somebody else\'s rows');
  c = mk([], { err: true, fr: [frRow] });
  r = await c.window.cityMyNodes(true);
  ok(Array.isArray(r) && r.length === 1 && r[0] === frRow, 'a failed read falls back to the Reserve\'s own rows');
}

/* ── 3. the city's PRN list: my rows, and the LEVEL the city writes (bug-mtwuhbwu) ─ */
function prnList(src, mine, fr) {
  const code = fnAt(src, 'window.cityPrnList = function () {');
  const ctx = {
    Profile: { cloud: { userId: 'me' } }, App: { _cityNodeId: 'N-01' }, FoundationReserve: { nodes: fr },
    _nodeType: () => ({ name: 'T' }), _prnSiteOf: () => null, _nodeActive: () => true, _nodeEff: () => 100,
    _nodeClaimable: () => 0, _nodeActiveRisk: () => null, String, Math,
  };
  if (mine) { ctx._cityMyNodeRows = () => mine; ctx._cityMyNodesFresh = () => true; }
  ctx.window = ctx;
  run(code + ';', ctx);
  return ctx.window.cityPrnList();
}
{
  const rowA = { id: 'a', owner_id: 'me', node_type: 'supply', level: 1, meta: { level: 37 } };
  const rowO = { id: 'o', owner_id: 'me', node_type: 'fuel', level: 1, corp_id: null, meta: { level: 50 } };
  const L = prnList(SRC, [rowA, rowO], [rowA]);
  ok(L.length === 2 && L.map((r) => r.id).join(',') === 'a,o', 'the city\'s PRN list includes the PRN outside the current corporation');
  ok(L[0].level === 37 && L[1].level === 50, 'and reports meta.level (37, 50) — the level the city raises — not the level column (1)', JSON.stringify(L.map((r) => r.level)));
  if (SRC0) {
    const L0 = prnList(SRC0, null, [rowA]);
    ok(L0.length === 1 && L0[0].level === 1, 'NEGATIVE CONTROL (HEAD): the same row read level 1, and the orphan PRN was absent', JSON.stringify(L0.map((r) => [r.id, r.level])));
  } else ok(false, 'NEGATIVE CONTROL (HEAD): could not read the committed index.html');
  ok(/const lv = Math\.max\(1, Math\.min\(50, level \| 0\)\);/.test(SRC) && /rpc\('city_set_node_level', \{ p_node_id: nodeId, p_level: lv \}\)/.test(SRC), 'cityNodeLevel clamps to the server\'s 50 before stamping the mirror and calling the RPC');
}

/* ── 4. node-city: the level counter stops at 50 (bug-mtwuhbwu) ──────────── */
function xpRun(nc, startLevel) {
  const cap = (nc.match(/const NODE_LEVEL_MAX = (\d+);/) || [])[0] || '';
  const code = cap + '\n' + fnAt(nc, 'function nodeXpTick(dtSec) {');
  const toasts = [], pushed = [];
  const ctx = {
    game: { anchors: [{ link: 100, node: { id: 'n', node_type: 'supply', level: startLevel } }], nodeXp: {} },
    NODE_XP_PER_LEVEL: 50000, NODE_TYPES: {}, ARMY: { nodePopPerLvl: 5 },
    MythicCityBridge: { pushNodeLevel: (id, l) => pushed.push(l) }, toast: (m) => toasts.push(m), saveSoon() {},
  };
  run(code + '\nthis.tick = nodeXpTick;', ctx);
  for (let i = 0; i < 40; i++) ctx.tick(500);          // 40 × 500 s at 100 % link = 40 levels' worth
  return { level: ctx.game.anchors[0].node.level, pushed, toasts };
}
{
  const r = xpRun(NC, 45);
  ok(r.level === 50 && Math.max(...r.pushed) === 50 && r.pushed.length === 5, 'from 45, forty levels of XP stop at 50 (5 pushes, none past the server\'s ceiling)', JSON.stringify([r.level, r.pushed.length, Math.max(...r.pushed)]));
  ok(!r.toasts.some((t) => /LEVEL 5[1-9]|LEVEL [6-9]\d/.test(t)), 'no "reached LEVEL 51+" toast');
  if (NC0) {
    const r0 = xpRun(NC0, 45);
    ok(r0.level > 50, 'NEGATIVE CONTROL (HEAD): the same XP ran the city\'s level to ' + r0.level + ' while the Reserve holds 50', r0.level);
  } else ok(false, 'NEGATIVE CONTROL (HEAD): could not read the committed node-city');
}

/* ── 5. node-city: an empty ring is asked again (bug-mtwtxvg8 / bug-mtr5bze0) ─ */
{
  const code = [
    (NC.match(/const ANCHOR_LATE_DELAYS_MS = \[[^\]]*\];/) || [''])[0], 'let _anchorLateArmed = false;',
    fnAt(NC, 'function anchorFreeNear(x, z, taken) {'), fnAt(NC, 'function anchorSetTile(a, x, z) {'),
    fnAt(NC, 'function anchorSlots(n) {'), fnAt(NC, 'async function anchorsLateRing() {'), fnAt(NC, 'function anchorsLateRingArm() {'),
    'this.late = anchorsLateRing; this.arm = anchorsLateRingArm;',
  ].join('\n');
  ok(code.length > 1500 && /async function anchorsLateRing/.test(code), 'the late ring is lifted with the real placement helpers');
  const mk = (nodes) => {
    const toasts = [];
    const ctx = {
      GRID: 24, HALF: 12, game: { anchors: [], tiles: { '12,4': { type: 'house' } }, anchorAt: { m2: '3,3' } },
      key: (x, z) => x + ',' + z, inGrid: (x, z) => x >= 0 && z >= 0 && x < 24 && z < 24,
      THREE: { MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) } },
      buildAnchorMesh: () => ({}), placeMeshAt() {}, dropTileMesh() {}, computeLinks() {}, updateHUD() {},
      toast: (m) => toasts.push(m), MythicCityBridge: { mode: 'parent', fetchNodes: async () => nodes }, Math, String, Set, Array, setTimeout,
    };
    run(code, ctx); ctx.toasts = toasts; return ctx;
  };
  let c = mk([{ id: 'm1' }, { id: 'm2' }]);
  const n = await c.late();
  ok(n === 2 && c.game.anchors.length === 2, 'a city that booted with no anchors rings both PRNs when they arrive');
  ok(c.game.tiles['12,4'].type === 'house' && c.game.anchors[0].key !== '12,4', 'the player\'s building on the ring slot is kept — the anchor takes the nearest free plot');
  ok(c.game.anchors[1].key === '3,3', 'an anchor the player had moved goes back to its remembered plot (anchorAt)');
  ok(c.toasts.length === 1 && /2 now stand in the city/.test(c.toasts[0]), 'and the player is told once');
  ok((await c.late()) === 0 && c.game.anchors.length === 2, 'NEGATIVE CONTROL: a city that already has anchors is never re-rung (no doubled ring)');
  c = mk([]);
  ok((await c.late()) === 0 && c.game.anchors.length === 0, 'an answer with no nodes places nothing');
  ok(/try \{ reseatAnchors\(\); \} catch \(e\) \{ console\.warn\('\[city\] anchor reseat', e\); \}\n\s*\/\/ 🔌 bug-mtwtxvg8[^\n]*\n\s*try \{ anchorsLateRingArm\(\); \} catch \(e\) \{\}/.test(NC), 'boot arms it right after the anchors are reseated');
  ok(NC0 ? !/anchorsLateRing/.test(NC0) : false, 'NEGATIVE CONTROL (HEAD): nothing re-rang an empty city — spawnAnchors ran once at boot');
}

/* ── 6. the warm-up does the whole walk (bug-mtr5bze0) ─────────────────────── */
{
  const decl = SRC.slice(SRC.indexOf('const _cityWarm = { at: 0, busy: null };'), SRC.indexOf('async function _cityWarmThenOpen(nodeId)'));
  const drive = async (bankReady) => {
    const calls = [];
    const mk = (name) => () => { calls.push(name); return Promise.resolve(true); };
    const ctx = {
      Profile: { cloud: { signedIn: true } }, opFetch: mk('opFetch'), frFetch: mk('frFetch'), nodeFetch: mk('nodeFetch'),
      cityHallFetch: mk('cityHallFetch'), corpTreasuryFetch: mk('corpTreasuryFetch'), boeFetch: mk('boeFetch'),
      BankEthos: { ready: bankReady }, Date, Promise, setTimeout, calls,
    };
    ctx.window = ctx; ctx.window.cityMyNodes = (force) => { calls.push('cityMyNodes:' + force); return Promise.resolve([]); };
    run(decl + '\nthis.warm = _cityWarmup;', ctx);
    await ctx.warm(true);
    return calls;
  };
  let calls = await drive(false);
  ok(calls.indexOf('cityMyNodes:true') >= 0, 'the warm-up reads my own PRN rows (forced), not only the corp-scoped nodeFetch', calls.join(','));
  ok(calls.indexOf('boeFetch') >= 0, '"Open Bank of Ethos" is part of it when the bank has not been read this session');
  calls = await drive(true);
  ok(calls.indexOf('boeFetch') < 0 && calls.length === 6, 'a bank already read is not re-read (six legs)', calls.join(','));
}

/* ── 7. the Client City list re-reads the contracts (bug-mtyd8sio) ─────────── */
async function clientCity(src) {
  const header = src.indexOf('async function _openClientCity() {') >= 0 ? 'async function _openClientCity() {' : 'function _openClientCity() {';
  const code = fnAt(src, header);
  const opened = [], toasts = [], fetches = [];
  const ctx = {
    _twMayors: {}, _twMayorsFetching: false, opened, toasts, fetches, Promise, setTimeout,
    showToast: (m) => toasts.push(m), _openNodeCity: (id) => opened.push(id), console,
    _cityWaitUntil: async () => true, document: { getElementById: () => null },
  };
  ctx.tw_fetchNodeMayors = async (force) => { fetches.push(force); ctx._twMayors = { 'N-47': { node_id: 'N-47', mayor_id: 'mgr' } }; return ctx._twMayors; };
  ctx._twMyMayorNodes = () => Object.keys(ctx._twMayors).filter((k) => ctx._twMayors[k].mayor_id === 'mgr').map((id) => ({ id, name: '', ownerName: 'Davos' }));
  run(code + '\nthis.open = _openClientCity;', ctx);
  await ctx.open();
  return ctx;
}
{
  const c = await clientCity(SRC);
  ok(c.fetches.length === 1 && c.fetches[0] === true && c.opened.join() === 'N-47', 'a contract accepted after the map last read node_mayors is re-read (forced) and opened', JSON.stringify([c.fetches, c.opened, c.toasts]));
  if (SRC0) {
    const c0 = await clientCity(SRC0);
    ok(c0.opened.length === 0 && /not the Node Manager/.test(c0.toasts[0] || ''), 'NEGATIVE CONTROL (HEAD): the stale cache said "not the Node Manager of anyone" for the same contract', JSON.stringify(c0.toasts));
  } else ok(false, 'NEGATIVE CONTROL (HEAD): could not read the committed index.html');
}

/* ── 8. in-city appointment: no Cinder for a seat that is already held (bug-mtyo8e66) ─ */
async function appoint(src, contract, reply) {
  const code = fnAt(src, 'window.cityMayorSet = async function (name) {');
  const rpcs = [], toasts = [];
  const ctx = {
    Cloud: { ready: true, client: { rpc: async (fn, args) => { rpcs.push(fn + ':' + (args.p_pay | 0)); return reply || { data: { ok: true, paid: 500, cinder: 1, wallet_seq: 1 } }; } } },
    App: { _cityNodeId: 'N-26' }, Profile: { cloud: { userId: 'owner', displayName: 'Davos' } },
    searchPlayers: async () => [{ userId: 'mgr', name: 'Grim' }], showToast: (m) => toasts.push(m),
    _twNodeMayor: (id) => (id === 'N-26' ? contract : null), _jbRpcMissing: () => false, _jbTradeAdopt() {},
    tw_fetchNodeMayors() {}, String, rpcs, toasts,
    MAYOR_HIRE_FEE: +((src.match(/const MAYOR_HIRE_FEE = (\d+);/) || [])[1] || 500),
  };
  ctx.window = ctx;
  run(code + ';', ctx);
  const r = await ctx.window.cityMayorSet('Grim');
  return { r, rpcs, toasts };
}
{
  const held = { node_id: 'N-26', mayor_id: 'mgr', active: true };
  let a = await appoint(SRC, held);
  ok(a.rpcs.length === 0 && a.r === null && /already this city.s Node Manager/.test(a.toasts[0] || ''), 'the manager who already holds this node\'s contract is refused BEFORE the paid RPC', JSON.stringify(a));
  if (SRC0) {
    const a0 = await appoint(SRC0, held);
    ok(a0.rpcs.join() === 'city_set_mayor:500', 'NEGATIVE CONTROL (HEAD): the same appointment went to the server with 500 Cinder (the live probe charged it)', JSON.stringify(a0.rpcs));
  } else ok(false, 'NEGATIVE CONTROL (HEAD): could not read the committed index.html');
  a = await appoint(SRC, { node_id: 'N-26', mayor_id: 'someone', active: true });
  ok(a.rpcs.length === 0 && /under a Mayor Hall contract/.test(a.toasts[0] || ''), 'another manager\'s Hall contract is never overwritten by a flat fee');
  a = await appoint(SRC, null, { data: { ok: true, paid: 500, contract: true, cinder: 1, wallet_seq: 1 } });
  ok(a.rpcs.join() === 'city_set_mayor:500' && /Client City list/.test(a.toasts[0] || ''), 'with sql/153_B the owner is told the city is now in the manager\'s Client City list');
  a = await appoint(SRC, null);
  ok(/Mayor Hall/.test(a.toasts[0] || '') && !/Client City list/.test(a.toasts[0] || ''), 'on sql/148 (no contract written) the owner is told the truth: send a Mayor Hall offer');
}

/* ── 9. the SQL drafts ──────────────────────────────────────────────────────── */
{
  const p153 = './sql/153_B_city_set_mayor_writes_contract.sql', p154 = './sql/154_B_city_set_node_level_owner_or_manager.sql';
  const s153 = existsSync(p153) ? readFileSync(p153, 'utf8') : '', s154 = existsSync(p154) ? readFileSync(p154, 'utf8') : '';
  ok(/DRAFT — NOT APPLIED/.test(s153) && /DRAFT — NOT APPLIED/.test(s154), 'both files are marked DRAFT — NOT APPLIED');
  ok(/from public\.tw_node_owners w\s+where w\.node_id = p_node_id and w\.user_id = v_uid/.test(s153) && /insert into public\.node_mayors/.test(s153) && /where not public\.node_mayors\.active;/.test(s153), '153_B: only the node\'s owner writes a contract, and never over an active one');
  ok(/'contract', true/.test(s153) && /--- VERIFY/.test(s153) && /\nselect\n/.test(s153.slice(s153.indexOf('--- VERIFY'))), '153_B answers contract:true and ends with a verify SELECT');
  ok(!/city_node_links/.test(s154.slice(s154.indexOf('create or replace function'), s154.indexOf('end $$;'))) && /m\.owner_id = v_owner and m\.mayor_id = auth\.uid\(\) and m\.active/.test(s154), '154_B: a link grants nothing; the owner or their active Node Manager raises the level');
  ok(/revoke all on function public\.city_set_node_level\(uuid, integer\) from public, anon;/.test(s154) && /--- VERIFY/.test(s154), '154_B revokes anon and ends with a verify SELECT');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
