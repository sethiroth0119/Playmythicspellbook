/* 🤝 "DO BUSINESS" RESOLVES THE PARTNER CITY, AND SAYS WHAT IS MISSING.
   Run: node _citytradeid_smoke.mjs
   Tracker bug-mu5gu2wv: "I have been unable to do any business with any nodes …
   seconded by Clarey … the language used in the error isn't helpful".
   The drawer passes TERRITORY-MAP node ids ('N-01', from tw_node_owners); a
   city publishes its trade profile under its ECONOMY node id (a uuid) or
   'local-city'. Measured on the live table 2026-09-17: 87 city_profiles rows,
   0 of them keyed by a map id — so the node lookup matched nothing for every
   node and every player, and _ctPropose blamed the partner for never visiting.
   The exact node match is still tried first; unresolved nodes now fall back to
   the node's OWNER, which both sides agree on.
   §4 is the negative control: the old lookup, run against the same data. */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
function fnText(name) {
  const i = SRC.search(new RegExp('(async )?function ' + name + '[(]'));
  if (i < 0) throw new Error('missing ' + name);
  let d = 0;
  for (let k = SRC.indexOf('{', SRC.indexOf(')', i)); k < SRC.length; k++) {
    if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); }
  }
}

/* A fake PostgREST over a fixed table, shaped like the live one: profiles keyed
   by an economy uuid or 'local-city', never by a map id. */
const ROWS = [
  { id: 'cityA', owner_id: 'ownerA', node_id: '0bc6c60b-f803-4bd8-9de5-473890c1a3b7', updated_at: '2026-09-17T10:00:00Z' },
  { id: 'cityA_local', owner_id: 'ownerA', node_id: 'local-city', updated_at: '2026-09-17T12:00:00Z' },
  { id: 'cityB_local', owner_id: 'ownerB', node_id: 'local-city', updated_at: '2026-09-16T09:00:00Z' },
  { id: 'mine_local', owner_id: 'me', node_id: 'local-city', updated_at: '2026-09-17T13:00:00Z' },
  { id: 'mine_node', owner_id: 'me', node_id: '10934d67-32f4-467c-9764-7ec561107506', updated_at: '2026-09-17T11:00:00Z' },
];
function client(rows) {
  const q = (rs) => ({
    _rs: rs, select() { return this; },
    eq(c, v) { this._rs = this._rs.filter(r => r[c] === v); return this; },
    in(c, vs) { this._rs = this._rs.filter(r => vs.indexOf(r[c]) >= 0); return this; },
    order(c, o) { const dir = (o && o.ascending === false) ? -1 : 1; this._rs = this._rs.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * dir); return this; },
    limit(n) { this._rs = this._rs.slice(0, n); return this; },
    then(res) { return Promise.resolve({ data: this._rs }).then(res); },
  });
  return { from: () => q(rows.slice()) };
}
const OWNERS = { 'N-01': { user_id: 'ownerA' }, 'N-02': { user_id: 'ownerB' }, 'N-03': { user_id: 'ownerNoCity' }, 'N-04': null };
function ctx(rows) {
  const c = { console, App: {}, Profile: { cloud: { userId: 'me', signedIn: true } },
    Cloud: { client: client(rows) }, _ctReady: () => true,
    _twNodeOwnerUser: (nid) => OWNERS[nid] || null };
  vm.createContext(c);
  vm.runInContext(fnText('_ctPrimeCityIds') + '\n' + fnText('_ctMyCityId'), c);
  return c;
}

console.log('\n=== 1. a map node resolves to its owner\'s published city ===');
{
  const c = ctx(ROWS);
  await vm.runInContext("_ctPrimeCityIds(['N-01','N-02','N-03','N-04'])", c);
  const map = c.App._ctCityIdByNode || {};
  ok(map['N-01'] === 'cityA', 'N-01 → its owner\'s city on a node (not their local-city row)', JSON.stringify(map));
  ok(map['N-02'] === 'cityB_local', 'N-02 → that owner\'s only profile, the local one');
  ok(!map['N-03'] && !map['N-04'], 'an owner with no city, and an unowned node, stay unresolved — the dialog must say so');
}

console.log('\n=== 2. an exact node-id match still wins ===');
{
  const rows = ROWS.concat([{ id: 'exact', owner_id: 'ownerA', node_id: 'N-01', updated_at: '2020-01-01T00:00:00Z' }]);
  const c = ctx(rows);
  await vm.runInContext("_ctPrimeCityIds(['N-01'])", c);
  ok((c.App._ctCityIdByNode || {})['N-01'] === 'exact', 'a profile published under the id on screen keeps its own row, however old');
}

console.log('\n=== 3. my own city: newest, and a node city beats local-city ===');
{
  const c = ctx(ROWS);
  const mine = await vm.runInContext('_ctMyCityId()', c);
  ok(mine === 'mine_node', 'the city standing on a node is proposed, not the pre-claim local one', String(mine));
  const only = ctx(ROWS.filter(r => r.id !== 'mine_node'));
  ok(await vm.runInContext('_ctMyCityId()', only) === 'mine_local', 'with only a local profile, that one is used');
  ok(await vm.runInContext('_ctMyCityId()', ctx(ROWS.filter(r => r.owner_id !== 'me'))) === null, 'with nothing published it returns null, so the dialog can say whose fault it is');
}

console.log('\n=== 4. the refusal names what is actually missing ===');
{
  const p = fnText('_ctPropose');
  ok(/Your own city is not published yet/.test(p), 'no city of mine → it tells ME to open my city');
  ok(/Nobody owns that node yet/.test(p), 'unowned node → nobody to trade with');
  ok(/no published city to trade with yet/.test(p), 'owner with no profile → names the node/city and what its owner must do');
  ok(!/That city has no trade profile yet — it must be visited by its owner first/.test(SRC), 'the one-size message is gone');
}

console.log('\n=== 5. NEGATIVE CONTROL — the old node-id-only lookup ===');
{
  const oldPrime = async (nodeIds, cl, app) => {
    const { data } = await cl.from('city_profiles').select('id,node_id').in('node_id', nodeIds);
    app._ctCityIdByNode = {};
    for (const r of (data || [])) app._ctCityIdByNode[r.node_id] = r.id;
  };
  const app = {};
  await oldPrime(['N-01', 'N-02'], client(ROWS), app);
  ok(Object.keys(app._ctCityIdByNode).length === 0,
    'the old lookup resolves NOTHING against live-shaped rows — the reported bug, reproduced');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ Do Business finds the partner city, or says exactly what is missing\n');
process.exit(fails ? 1 : 0);
