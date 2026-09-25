/* 🏗 CONSTRUCTION CO. / CORP-ROW SMOKE — bug-mtw1n1bi.
   "Construction Company at my City disappeared and a message shows up when I
   click on placing a new construction company."

   Measured live: a corp MEMBER (MirageSoldier, corp 5e997df8) held
   local_construction_1788930980229 in user_profiles_history at 2026-09-09
   05:17:02 and never again. opFetch retired it because the CORP owns a
   construction row — and that row (f72ca33c) stands in the FOUNDER's city
   (N-20). A member cannot write a corp row (RLS cop_upd, zero rows, no error),
   so siting it "worked" and vanished on the next read, and buying a new one
   answered "You already operate that." / "Only the corporation founder/CEO…".

   THE FUNCTIONS ARE THE SHIPPED ONES — cut out of public/index.html and run
   with stubs for the network. Negative control: the pre-fix retire filter,
   run on the same inputs, drops the member's Co.
   Run: node _cocorprow_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0, passes = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  <- ' + x)); if (c) passes++; else fails++; };

const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(src, name, prefix) {
  const i = (prefix === 'window.') ? src.indexOf('window.' + name + ' = ') : src.indexOf((prefix || 'function ') + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

function harness({ amOwner, corpRows, locals }) {
  const Profile = { cloud: { signedIn: true }, jbLocalOps: locals };
  const Corp = { mine: { id: 'corp1', name: 'Grey Co' }, amOwner };
  const Operations = { list: [], _fetched: 0, fetchFailed: false };
  const writes = [];
  const Cloud = { client: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: corpRows, error: null }) }) }) }) } };
  const body = [
    fnText(SRC, '_jbLocalOpsList'), fnText(SRC, '_opRowIsMine'), fnText(SRC, '_opSite'),
    fnText(SRC, 'opFetch', 'async function '),
    'return { opFetch, _opRowIsMine };',
  ].join('\n');
  const f = new Function('Profile', 'Corp', 'Operations', 'Cloud', 'initCloud', 'saveProfile', 'corpStaffFetch', 'corpStaffPayroll', '_opWriteMeta', 'console', body);
  const api = f(Profile, Corp, Operations, Cloud, () => true, () => true, async () => {}, () => {},
    async (o, p) => { writes.push({ id: o.id, meta: JSON.parse(JSON.stringify(o.meta)) }); return true; }, { warn() {}, info() {} });
  return { api, Profile, Operations, writes };
}
const corpCo = (site) => ({ id: 'f72ca33c', corp_id: 'corp1', op_type: 'construction', status: 'active', meta: site ? { site } : {} });
const localCo = (site) => ({ id: 'local_construction_1788930980229', corp_id: 'local', op_type: 'construction', status: 'active', meta: Object.assign({ localOnly: true, fundedBy: 'free-licence' }, site ? { site } : {}) });
const N20 = { nodeId: 'N-20', x: 0, y: 2, rot: 0 }, N34 = { nodeId: 'N-34', x: 8, y: 9, rot: 0 };

console.log('\n=== 1. a MEMBER keeps their own Construction Co. when the corp owns one ===');
{
  const h = harness({ amOwner: false, corpRows: [corpCo(N20)], locals: [localCo(N34)] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 1, 'member\'s local Co. survives the corp read', h.Profile.jbLocalOps.length);
  ok(h.Operations.list.some((o) => o.id.startsWith('local_construction')), '…and is in Operations.list for the city');
  ok(h.api._opRowIsMine(h.Operations.list.find((o) => o.id === 'f72ca33c')) === false, 'the corp row is NOT the member\'s to site');
  ok(h.api._opRowIsMine(h.Operations.list.find((o) => o.id.startsWith('local_'))) === true, 'the local row IS the member\'s');
}
{
  const h = harness({ amOwner: false, corpRows: [corpCo(N20)], locals: [localCo(null)] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 1, 'an UNSITED member Co. survives too (members never retire)');
}

console.log('\n=== 2. a FOUNDER: the corp copy still wins, but a building keeps a row ===');
{
  const h = harness({ amOwner: true, corpRows: [corpCo(null)], locals: [localCo(null)] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 0, 'founder: unsited local twin retires (unchanged de-dupe)');
}
{
  const cr = corpCo(null);
  const h = harness({ amOwner: true, corpRows: [cr], locals: [localCo(N34)] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 0, 'founder: SITED local twin retires when the corp row stands nowhere…');
  ok(cr.meta.site && cr.meta.site.nodeId === 'N-34', '…and hands its site to the corp row, so the building keeps a licence', JSON.stringify(cr.meta));
  ok(h.writes.length === 1 && h.writes[0].id === 'f72ca33c', '…through _opWriteMeta (the founder may write it)', h.writes.length);
}
{
  const h = harness({ amOwner: true, corpRows: [corpCo(N20)], locals: [localCo(N34)] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 1, 'founder: a Co. standing in ANOTHER city than the corp\'s is kept (a Co. may stand in several)');
}
{
  const h = harness({ amOwner: true, corpRows: [{ id: 'x', corp_id: 'corp1', op_type: 'oil', meta: { site: N20 } }],
    locals: [{ id: 'local_oil_1', corp_id: 'local', op_type: 'oil', meta: { localOnly: true, site: N34 } }] });
  await h.api.opFetch();
  ok(h.Profile.jbLocalOps.length === 0, 'founder: every OTHER op keeps the one-row rule (sited duplicate oil retires as before)');
}

console.log('\n=== 3. negative control: the pre-fix filter drops the member\'s Co. ===');
{
  const locals = [localCo(N34)];
  const cloudTypes = { construction: 1 };
  const old = locals.filter((x) => x && x.op_type && !cloudTypes[x.op_type]);
  ok(old.length === 0, 'OLD `!cloudTypes[x.op_type]` retires MirageSoldier\'s Co. (the reported loss)', old.length);
}

console.log('\n=== 4. the write and the refusals ===');
{
  const site = fnText(SRC, 'cityOpsSite', 'window.');
  ok(/if \(!_opRowIsMine\(o\)\) return \{ ok: false, error: 'corp-row' \}/.test(site), 'cityOpsSite refuses a corp row the viewer cannot write, before any write');
  ok(site.indexOf("error: 'corp-row'") < site.indexOf('_opWriteMeta('), '…the refusal comes before _opWriteMeta');
  const mf = fnText(SRC, 'cityOpsState', 'window.');
  ok(/mine: _opRowIsMine\(o\)/.test(mf), 'the city manifest says which rows the viewer can site (`mine`)');
  const cl = fnText(SRC, '_opCreateLocal', 'async function ');
  ok(/x\.op_type === opType && _opRowIsMine\(x\)/.test(cl), '_opCreateLocal\'s "already operate" asks about the player\'s OWN rows');
  ok(/Corp\.mine && Corp\.amOwner && Cloud/.test(cl), '_opCreateLocal writes corp_operations only for the founder');
  ok(/_memberMayOwn = notOwner && a\.op === 'construction'/.test(SRC), 'Just Business lets a corp member found their own Construction Co.');
  ok(!/Only the corporation founder\/CEO can fund operations\. \(Admin: bypassed automatically\.\)/.test(SRC), 'the dead-end "(Admin: bypassed automatically.)" refusal is gone');
  ok(/ask them to found it from the Treasury \(Just Business → Operations\)/.test(SRC), 'the founder refusal says who to ask and where');
  ok(/const _canSite = \(o\) => o && o\.mine !== false;/.test(NC), 'the city picks a row it can site first');
  ok(/function opsCorpRowMsg\(opType\)/.test(NC) && /Found your own at City Hall \(Just Business → Found a Business\)/.test(NC), 'the city refusal names both moves the player has');
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
