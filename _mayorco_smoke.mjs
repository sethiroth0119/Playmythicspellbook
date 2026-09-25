/* 🏛 A MAYOR'S CONSTRUCTION CO. IN A CLIENT'S CITY (v121v60).

   Asked for: "When mayors are building the cities for their clients, if that
   mayor has a Construction Co. make it where they have all of these things
   unlocked and they can place their construction company in their clients
   cities."

   Defends, by running the real predicates out of node-city:
     · bldMayorCo() is true only while MANAGING (gov.isOwner === false) and
       only when the mayor's own manifest holds a construction row — an owner,
       an unresolved identity, or a mayor with no Co. all read false;
     · bldHasCo() is the union of the three standings (a Co. on this grid, a
       claimed Reserve node, a managing mayor's Co.);
     · the ceiling is ALL it lifts — bldSlots() and bldSpeed() still iterate
       bldCoTiles() alone, so a Co. in another city grants no crews and no
       speed;
     · the shop card asks the same predicate the placement and upgrade gates
       ask, so a card can no longer be locked over a building the gate would
       have raised;
     · a mayor may still site an unsited Co. in the client's city
       (opsMayorMaySite), and no other operation.

   Run: node _mayorco_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(name) {
  const i = NC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = NC.indexOf('{', i);
  for (let k = j; k < NC.length; k++) { if (NC[k] === '{') d++; else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); } }
}

/* ── the predicates, run for real ── */
function world(o) {
  const ctx = {
    gov: o.gov,
    game: { tiles: o.tiles || {}, anchors: o.anchors || [] },
    OPS: { st: { ops: o.ops || [], nodeId: 'N-01' } },
    opsKeyOf: () => 'op_construction',
    bldBusy: (t) => !!(t && t.bld),
    opsSiteHere: (r) => !!(r.site && r.site.nodeId === 'N-01'),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext([fnText('bldCoTiles'), fnText('bldNodeCo'), fnText('opsRowsOf'), fnText('bldMayorCo'), fnText('bldHasCo')].join('\n'), ctx);
  return (expr) => vm.runInContext(expr, ctx);
}
const MAYOR = { isOwner: false }, OWNER = { isOwner: true };
const CO_ELSEWHERE = [{ type: 'construction', site: { nodeId: 'N-99', x: 1, y: 1 } }];
const CO_UNSITED = [{ type: 'construction' }];
{
  /* the reported case: managing, my Co. stands in my own city, this grid is bare */
  const q = world({ gov: MAYOR, ops: CO_ELSEWHERE });
  ok(q('bldCoTiles().length') === 0 && q('bldNodeCo()') === false, 'the client city has no Co. tile and no node of its own');
  ok(q('bldMayorCo()') === true, 'a managing mayor whose Co. stands elsewhere still counts as having one');
  ok(q('bldHasCo()') === true, 'so the ceiling is lifted — the locked cards open');
}
{
  const q = world({ gov: MAYOR, ops: CO_UNSITED });
  ok(q('bldMayorCo()') === true, 'an unsited Co. counts too — the mayor owns the business either way');
}
{
  const q = world({ gov: MAYOR, ops: [{ type: 'oil', site: null }] });
  ok(q('bldMayorCo()') === false && q('bldHasCo()') === false, 'a mayor with no Construction Co. gets nothing');
}
{
  /* an OWNER in their own city is untouched: the standing is not theirs to borrow */
  const q = world({ gov: OWNER, ops: CO_ELSEWHERE });
  ok(q('bldMayorCo()') === false, 'an owner never borrows this standing, even holding a Co. elsewhere');
  ok(q('bldHasCo()') === false, 'and their own bare city still asks for a Co.');
}
{
  /* identity not resolved yet — gov defaults to isOwner true, and must not leak */
  const q = world({ gov: { isOwner: true }, ops: CO_ELSEWHERE });
  ok(q('bldMayorCo()') === false, 'an unresolved identity (the isOwner default) grants nothing');
  const q2 = world({ gov: null, ops: CO_ELSEWHERE });
  ok(q2('bldMayorCo()') === false, 'no gov at all is refused, not thrown');
}
{
  /* the other two standings still work */
  const q = world({ gov: OWNER, anchors: [{ id: 'a' }] });
  ok(q('bldNodeCo()') === true && q('bldHasCo()') === true, 'a claimed Reserve node still satisfies the ceiling');
  const q2 = world({ gov: OWNER, tiles: { '1,1': { type: 'op_construction' } } });
  ok(q2('bldCoTiles().length') === 1 && q2('bldHasCo()') === true, 'a Co. standing on this grid still satisfies it');
  const q3 = world({ gov: OWNER, tiles: { '1,1': { type: 'op_construction', bld: { t: 1 } } } });
  ok(q3('bldCoTiles().length') === 0, 'a Co. that is still a building site supervises nothing');
}

/* ── the sited rule for tiles; the mayor's Co. through ONE guarded reader ──
   v121v101 (owner, 2026-09-10): "the client may not have a construction co.,
   which means the mayor will not be able to build for their clients" — so the
   mayor's own Company now ADDS gangs and speed while managing, via
   bldMayorCoStats() (parent-published counts, gov.isOwner === false only).
   The ceiling predicate bldMayorCo() itself is still not in the crew maths. */
ok(/for \(const \[k\] of bldCoTiles\(\)\) n \+= C\.slots\.perCo/.test(NC), 'bldSlots still iterates bldCoTiles for sited Companies');
ok(/for \(const \[k\] of bldCoTiles\(\)\) m \+= C\.speed\.perCo/.test(NC), 'bldSpeed still iterates bldCoTiles for sited Companies');
ok(!/bldSlots\(\) \{[\s\S]{0,400}bldMayorCo\(\)/.test(NC) && /bldSlots\(\) \{[\s\S]{0,400}bldMayorCoStats\(\)/.test(NC), 'the crew maths reads the mayor\'s Co. through bldMayorCoStats only — never the ceiling predicate bldMayorCo()');

/* ── one predicate, three callers ── */
ok(/const needsCo = over && !bldHasCo\(\);/.test(NC), 'the shop card asks bldHasCo, the same question the gates ask');
ok((NC.match(/durSec > C\.municipal\.maxSec && !bldHasCo\(\)/g) || []).length >= 1 && (NC.match(/durSec > bldCfg\(\)\.municipal\.maxSec && !bldHasCo\(\)/g) || []).length >= 1, 'the placement gate and the upgrade gate both ask it too');
ok(!/needsCo = over && !bldCoTiles\(\)\.length/.test(NC), 'and the old stricter card test is gone');

/* ── siting the Co. in a client's city ── */
ok(/function opsMayorMaySite\(opType\) \{ return opType === 'construction'; \}/.test(NC), 'a mayor may site a Construction Co. in a client\'s city — and only that');
/* 🔴 THE ECONOMY HARNESS LIFTS THESE FUNCTIONS BY NAME. bldHasCo() is a union
   of three predicates and that sandbox evaluates the real gate, so a predicate
   added here but not lifted there ReferenceErrors inside tryPlace — which is
   how this very change first failed the full gate. Pinned in the FAST tier so
   the next person finds out in a minute instead of in ten. */
{
  const RUN = readFileSync('./tools/economy-tests/run.mjs', 'utf8');
  const lifted = ['bldCoTiles', 'bldNodeCo', 'bldMayorCo', 'bldHasCo'].filter((f) => new RegExp('fnText\\(NC, \'' + f + '\'\\)').test(RUN));
  ok(lifted.length === 4, 'the economy harness lifts every predicate bldHasCo calls', 'lifted: ' + lifted.join(','));
}
ok(/window\.NC_BUILD = "v121v(6[0-9]|[7-9]\d|\d{3,})-/.test(NC), 'city build v121v60 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
