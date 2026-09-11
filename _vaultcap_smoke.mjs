/* 📦 THE VAULT CEILING DOES NOT SAG (v121v67).

   Reported: "players' vault base — some of them saying it has decreased and
   they paid for a higher amount."

   Both halves were one bug. getResourceCap() adds the storage a paid, staffed
   Warehouse is worth, and that comes from _opsRowsOf('warehouse') →
   Operations.list — which is EMPTY until opFetch() answers. So every cold load
   computed the ceiling with the warehouse worth ZERO, showed a number lower
   than the player paid for, and jumped when the fetch landed.

   It was not only a display. renderStash() calls _stashEnforceCap() whenever
   the held total exceeds the ceiling, and that JETTISONS from the biggest
   pile — so a player who opened their stash inside that window had real
   resources destroyed against a ceiling missing a building they bought.

   The rule this pins: an unread operations list is not the number zero, it is
   "unknown", and nothing that can cost a player anything may run on it.

   Run: node _vaultcap_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  if (SRC.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* A world with one staffed Warehouse worth 4,000 units. */
function world(opts) {
  opts = opts || {};
  const rows = opts.rows === undefined ? [{ workers: 3 }] : opts.rows;
  const ctx = {
    console, window: {},
    Profile: { whCapLast: opts.last === undefined ? 0 : opts.last },
    Operations: { _fetched: opts.fetched ? 1 : 0, fetchFailed: !!opts.failed, list: [] },
    _opsRowsOf: () => rows,
    _opEcon: () => ({ storageBase: 1000, storagePerWorker: 1000 }),
  };
  vm.createContext(ctx);
  vm.runInContext([fnText('_whCapTrusted'), fnText('_whCapLive'), fnText('_warehouseCapacity')].join('\n'), ctx);
  return { ctx, cap: () => vm.runInContext('_warehouseCapacity()', ctx) };
}

/* ── the sag ── */
{
  const w = world({ fetched: true });
  ok(w.cap() === 4000, 'a read list reports the real warehouse storage', String(w.cap()));
  ok(w.ctx.Profile.whCapLast === 4000, 'and remembers it for the next cold load', String(w.ctx.Profile.whCapLast));
}
{
  /* The cold load, which is the actual report. */
  const w = world({ fetched: false, last: 4000 });
  ok(w.cap() === 4000, 'an UNREAD list holds the last trusted figure instead of reporting zero', String(w.cap()));
}
{
  const w = world({ fetched: true, failed: true, last: 4000 });
  ok(w.cap() === 4000, 'a FAILED read is unread too — a network blip does not shrink the vault', String(w.cap()));
}
{
  const w = world({ fetched: false, last: 0 });
  ok(w.cap() === 0, 'a player who never had a warehouse still gets zero, not an invented number');
}

/* ── it must still be able to go DOWN, or it is a different lie ── */
{
  const w = world({ fetched: true, last: 9000, rows: [{ workers: 0 }] });
  ok(w.cap() === 1000, 'firing the staff lowers it once the list is read', String(w.cap()));
  ok(w.ctx.Profile.whCapLast === 1000, 'and the remembered figure follows down, not just up', String(w.ctx.Profile.whCapLast));
}
{
  const w = world({ fetched: true, last: 9000, rows: [] });
  ok(w.cap() === 0, 'selling the warehouse takes its storage with it');
}
ok(!/Math\.max\(Profile\.whCapLast \| 0, cap\)/.test(SRC),
  'the remembered figure is NOT max-wins — warehouse space is rented and staffed, not bought forever');

/* ── the part that destroyed goods ── */
{
  const i = SRC.indexOf('function _stashEnforceCap() {');
  const seg = SRC.slice(i, i + 1400);
  ok(i > 0 && /if \(typeof _whCapTrusted === 'function' && !_whCapTrusted\(\) && !\(Profile\.whCapLast \| 0\)\)/.test(seg),
    'the enforcer refuses to trim against a ceiling it cannot vouch for');
  const iGuard = seg.indexOf('_whCapTrusted');
  const iCap = seg.indexOf('const cap = getResourceCap();');
  ok(iGuard > 0 && iCap > iGuard, 'and refuses BEFORE it computes one, not after');
  ok(/return null;/.test(seg.slice(iGuard, iCap)), 'returning null, which the caller already treats as "nothing trimmed"');
}

/* ── the three lists, which is how the last one of these shipped ── */
{
  const seg = (name) => {
    let i = SRC.indexOf('function ' + name + '(');
    if (SRC.slice(i - 6, i) === 'async ') i -= 6;
    let d = 0, j = SRC.indexOf('{', i);
    for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
    return '';
  };
  const up = seg('cloudSyncProfile'), hy = seg('cloudFetchProfile'), lo = seg('loadForge');
  ok(up.indexOf('__whCapLast__') > 0, 'the cloud UPLOAD carries the figure');
  ok(hy.indexOf('__whCapLast__') > 0, 'the cloud HYDRATION restores it');
  ok(lo.indexOf('p.whCapLast') > 0, 'and so does the LOCAL load — the third list, missing from which is enough on its own');
  /* The same three-list test for the fields already known to feed the cap. */
  for (const f of ['cityProduction', 'vaultLayout', 'vaultRowsPaid', 'vaultExtraPaid']) {
    const has = (s) => new RegExp('(^|[^A-Za-z_])' + f + '\\b').test(s) || s.indexOf('__' + f + '__') >= 0;
    ok(has(up) && has(hy) && has(lo), f + ' is still in all three lists');
  }
}

/* ── the ceiling maths itself ── */
ok(/const bought = \(v\.rows \| 0\) \* \(v\.cols \| 0\) \* 25 \+ \(v\.stashExtra \| 0\);/.test(SRC), 'bought space is rows x cols x 25 plus the container surplus');
ok(/return Math\.max\(_resStashFloor\(\), Math\.min\(RES_STASH_MAX, bought\)\) \+ wh;/.test(SRC),
  'the free floor is never clamped by the purchase ceiling, and warehouse stacks on top');
{
  /* VAULT_MAX_ROWS must keep `bought` from ever exceeding the clamp, or the
     clamp repossesses space someone paid for. 8 base rows + 13 doors x 5. */
  const rows = /const VAULT_MAX_ROWS = (\d+);/.exec(SRC);
  const max = /const RES_STASH_MAX = (\d+);/.exec(SRC);
  ok(rows && max && (Number(rows[1]) * 250 + 13000) === Number(max[1]),
    'the row cap and the unit cap still land on the same number — 73 rows + 13 doors = 31,250',
    rows && max ? (rows[1] + ' rows -> ' + (Number(rows[1]) * 250 + 13000) + ' vs ' + max[1]) : 'not found');
}
ok(/window\.BUILD_VERSION = 'v121v(6[7-9]|[7-9]\d|\d{3,})'/.test(SRC), 'build v121v67 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
