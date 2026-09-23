/* 🏦 CITY HALL NO LONGER NEEDS A TRIP THROUGH THE BANK FIRST (bug-mtr5bze0).

   "You still have to go into the Bank of Ethos before you can go to City Hall.
   The bank account should automatically load in the background."
   City Hall's back office is gated on BankEthos.ready + _appSubmitted, and
   only boeFetch() sets them — which only openBankOfEthos() called. City Hall
   now asks itself (boeEnsureReady), the start-up warm pass asks too, and
   boeFetch is single-flight so those callers cannot race the bank's own read
   into a double INSERT.

   Drives the REAL boeFetch / boeEnsureReady / _cityWarmup lifted out of
   index.html, and checks openCityHall's wiring.

   Run: node _boeboot_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('cannot find ' + head);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  throw new Error('unbalanced ' + head);
}

/* ── 1. boeFetch single-flight + boeEnsureReady, driven ─────────────────── */
async function bank(opts) {
  const ctx = {
    Promise, setTimeout, reads: 0,
    Profile: { cloud: { signedIn: opts.signedIn !== false } },
    BankEthos: { ready: !!opts.ready },
  };
  ctx._boeFetchOnce = () => {
    ctx.reads++;
    if (opts.hang) return new Promise(() => {});
    return new Promise((r) => setTimeout(() => { ctx.BankEthos.ready = true; r(true); }, 10));
  };
  vm.createContext(ctx);
  vm.runInContext('var _boeFetchBusy = null;\n' + fnText(SRC, 'function boeFetch()') + '\n' + fnText(SRC, 'function boeEnsureReady(ms)') +
    '\nthis.boeFetch = boeFetch; this.boeEnsureReady = boeEnsureReady;', ctx);
  return ctx;
}
{
  let c = await bank({});
  const [a, b] = await Promise.all([c.boeFetch(), c.boeFetch()]);
  ok(a === true && b === true && c.reads === 1, 'two overlapping boeFetch calls share one read (no double INSERT)', c.reads);
  await c.boeFetch();
  ok(c.reads === 2, '…and a later call reads again (single-flight, not a cache)', c.reads);
  c = await bank({});
  ok(await c.boeEnsureReady(500) === true && c.reads === 1, 'boeEnsureReady loads a cold account');
  ok(await c.boeEnsureReady(500) === true && c.reads === 1, '…and costs no request once loaded');
  c = await bank({ signedIn: false });
  ok(await c.boeEnsureReady(500) === false && c.reads === 0, 'signed out: no request');
  c = await bank({ hang: true });
  const t0 = Date.now(); const r = await c.boeEnsureReady(40); const dt = Date.now() - t0;
  ok(r === false && dt < 1000, 'a read that never answers is abandoned at the bound', dt + 'ms');
}

/* ── 2. the start-up warm pass loads the bank too ───────────────────────── */
{
  const decl = SRC.slice(SRC.indexOf('const _cityWarm = { at: 0, busy: null };'), SRC.indexOf('async function _cityWarmThenOpen(nodeId)'));
  const calls = [];
  const mk = (n) => () => { calls.push(n); return Promise.resolve(true); };
  const ctx = { Profile: { cloud: { signedIn: true } }, Date, Promise, setTimeout,
    opFetch: mk('op'), frFetch: mk('fr'), nodeFetch: mk('node'), cityHallFetch: mk('hall'), corpTreasuryFetch: mk('treas'), boeEnsureReady: mk('boe') };
  vm.createContext(ctx);
  vm.runInContext(decl + '\nthis.warm = _cityWarmup;', ctx);
  await ctx.warm();
  ok(calls.includes('boe'), 'the background warm pass loads the Bank of Ethos account', calls.join(','));
}

/* ── 3. City Hall asks for the account itself ───────────────────────────── */
{
  const H = fnText(SRC, 'function openCityHall()');
  const ask = H.indexOf('boeEnsureReady(8000)');
  ok(ask > 0, 'openCityHall loads the bank account instead of waiting for the bank screen');
  ok(ask > 0 && ask < H.lastIndexOf('    render();\n    if (online'), '…before its first paint');
  ok(/else if \(!hasBoeAccount && _chBoeLoading\)/.test(H) && H.indexOf('!hasBoeAccount && _chBoeLoading') < H.indexOf('Open a Bank of Ethos account first'),
    'while the read is in flight it says so instead of the "open an account first" splash');
  ok(/_chBoeLoading = false;[\s\S]{0,400}if \(document\.getElementById\(ID\)\) render\(\);/.test(H), '…and repaints when the answer (or the bound) arrives');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
