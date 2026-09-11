/* 🏗 v121v104 — the Construction Co. can always be placed in your OWN city,
   even while it stands in a client's city; only a mayor may put it in someone
   else's city (unchanged). Owner, 2026-09-10: "he cannot place his
   construction company in his city because it is saying his construction
   company is placed in another city."

   Run: node _cohome_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the build-menu card ── */
ok(/const resite = opType === 'construction' && !rows\.unsited\.length && rows\.elsewhere\.length > 0 && !rows\.here\.length;\n\s*const free = opsIsFree\(opType\) && !blocked && \(!rows\.elsewhere\.length \|\| opType === 'construction'\);\n\s*if \(\(!rows\.unsited\.length && !resite\) \|\| blocked\) \{/.test(NC), 'a Construction Co. sited elsewhere does not lock the card; every other op still does');
ok(/const row = rows\.unsited\[0\] \|\| \(opType === 'construction' && !rows\.here\.length \? rows\.elsewhere\[0\] : null\);/.test(NC), 'tryPlace sites the elsewhere row for construction (never for another op, never when one already stands here)');
ok(/if \(st && st\.manager && !opsMayorMaySite\(opType\)\) \{ toast\('🏛 You are managing another player\\'s city — your own businesses cannot be sited here\.', 'bad'\); return; \}/.test(NC) && /function opsMayorMaySite\(opType\) \{ return opType === 'construction'; \}/.test(NC), 'in a client\'s city only the Construction Co. may be sited (mayor rule unchanged)');
{
  /* the card gate, run for real over the three shapes */
  const gate = (opType, rows, blocked) => {
    const resite = opType === 'construction' && !rows.unsited.length && rows.elsewhere.length > 0 && !rows.here.length;
    return !((!rows.unsited.length && !resite) || blocked);
  };
  ok(gate('construction', { unsited: [], here: [], elsewhere: [{}] }, false) === true, 'construction sited in a client\'s city → placeable at home');
  ok(gate('construction', { unsited: [], here: [{}], elsewhere: [{}] }, false) === false, '…but not twice in the same city');
  ok(gate('mining', { unsited: [], here: [], elsewhere: [{}] }, false) === false, 'a Mining Co. sited elsewhere stays locked (one plot)');
  ok(gate('construction', { unsited: [], here: [], elsewhere: [{}] }, true) === false, 'blocked (manifest unavailable) still locks');
}

/* ── the parent's site writer ── */
{
  const body = SRC.slice(SRC.indexOf('window.cityOpsSite = async function (opId, x, y, rot) {'), SRC.indexOf('window.cityOpsUnsite = async function (opId) {'));
  ok(/const prev = _opSite\(o\);\n\s*if \(prev && o\.op_type !== 'construction'\) return \{ ok: false, error: 'already-sited' \};\n\s*if \(prev && String\(prev\.nodeId\) === String\(nodeId\)\) return \{ ok: false, error: 'already-sited' \};/.test(body), 'cityOpsSite: a second site is refused for every op except construction, and for construction when it is the same city');
  ok(body.indexOf("if (App && App._cityOwnerId && o.op_type !== 'construction') return { ok: false, error: 'manager' };") < body.indexOf('const prev = _opSite(o);'), 'the mayor rule (only construction in a client\'s city) is checked first and is unchanged');
  ok(/now stands in ' \+ where \+ ' as well — the business record moved here; the other building stays\./.test(body), 'the toast says the record moved and the other building stays');
  /* run it */
  const mk = (row, ownerId, nodeId) => {
    const g = { App: { _cityOwnerId: ownerId, _cityNodeId: nodeId, _cityOwnerName: 'Owner' }, OP_LABELS: { construction: 'Construction Co.', mining: 'Mining Company' },
      _opRowById: () => row, _opSite: (o) => (o.meta && o.meta.site) || null, _opWriteMeta: async (o, m) => { o.meta = Object.assign({}, o.meta, m); g.wrote = m; }, showToast: (m) => { g.toast = m; }, window: {} };
    new Function('g', 'with (g) { ' + body + ' }')(g);
    return g;
  };
  let g = mk({ id: 1, op_type: 'construction', meta: { site: { nodeId: 'client-1', x: 3, y: 4 } } }, null, 'home-9');
  let r = await g.window.cityOpsSite(1, 5, 6, 0);
  ok(r.ok === true && g.wrote.site.nodeId === 'home-9' && /moved here/.test(g.toast), 'run for real: a Co. sited in client-1 is sited at home-9 — the site moved, the toast says so', JSON.stringify(r));
  g = mk({ id: 1, op_type: 'construction', meta: { site: { nodeId: 'home-9', x: 3, y: 4 } } }, null, 'home-9');
  r = await g.window.cityOpsSite(1, 5, 6, 0);
  ok(r.ok === false && r.error === 'already-sited', 'the same city twice → already-sited');
  g = mk({ id: 2, op_type: 'mining', meta: { site: { nodeId: 'client-1', x: 3, y: 4 } } }, null, 'home-9');
  r = await g.window.cityOpsSite(2, 5, 6, 0);
  ok(r.ok === false && r.error === 'already-sited', 'a Mining Company keeps the one-plot rule');
  g = mk({ id: 3, op_type: 'mining', meta: {} }, 'owner-x', 'client-1');
  r = await g.window.cityOpsSite(3, 5, 6, 0);
  ok(r.ok === false && r.error === 'manager', 'a mayor still cannot site any other business in a client\'s city');
  g = mk({ id: 4, op_type: 'construction', meta: { site: { nodeId: 'home-9', x: 1, y: 1 } } }, 'owner-x', 'client-1');
  r = await g.window.cityOpsSite(4, 5, 6, 0);
  ok(r.ok === true && g.wrote.site.nodeId === 'client-1', 'a mayor whose Co. stands at home can still site it in the client\'s city');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 104, 'BUILD_VERSION is v121v104 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
