/* 🔁🔥 FIRST LOAD, THE START-UP WALK, THREE POPULATIONS AND THE CASH VERDICT.

   Four reports, read from their text:
   · "Managed cities not loading first time after a break of more than a couple
     of hours... exit the city and re-enter, after which they reload
     immediately." The second open works because the session has refreshed by
     then. A refused city_state read is now retried once behind a session
     refresh on the parent, and the city itself reads again 2.5 s later when
     the first read was refused and nothing local stood in.
   · "Start game → Ruin Exchange → Bank of Ethos → City Hall → Licenses → PRNs.
     Now everything is ready for the City Builder." The walk fetched the node
     rows, the operations list and the registry that the city reads. The same
     fetches now run in the background after load and at the city door.
   · "Army gives free population at 1089 but population capacity is 294...
     457/1546... Residents are 166." Beds, slots, residents and the economy's
     household count all shared one word. Each row now names its own quantity.
   · "Out of Cash - Limited by ... 0%" on a Cannery, a Farm, a Cinema. The cash
     verdict sat above the material verdict, so an input NOBODY MAKES was
     reported as a cash problem. Material first, cash only when the supplier
     exists.

   Run: node _firstload_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const BN = readFileSync('./public/src/economy/bottleneck.js', 'utf8').replace(/\r\n/g, '\n');
const RD = readFileSync('./public/src/economy/render.js', 'utf8').replace(/\r\n/g, '\n');
function fnText(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('cannot find ' + head);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}

/* ── 1. the parent retries a refused read once, behind a refresh ────────── */
{
  const L = fnText(SRC, 'window.cityStateLoad = async function ()');
  const first = L.indexOf('let r = await _cityRowRead(target, _nodeKey);');
  const retry = L.indexOf('const r2 = await _cityRowRead(target, _nodeKey);');
  ok(first > 0 && retry > first, 'a refused first read is read again');
  ok(/if \(r && r\.error\) \{\s*try \{\s*const au = Cloud\.client && Cloud\.client\.auth;/.test(L), '…only when the first read carried an error');
  ok(/au\.refreshSession\(\), new Promise\(\(res\) => setTimeout\(res, 4000\)\)/.test(L), '…after a session refresh bounded at 4 s');
  ok(/if \(r2 && !r2\.error\) \{ r = r2;/.test(L), '…and a second refusal stays a refusal (r is replaced only by a clean read)');
  ok(retry < L.indexOf('window.__cityLoadUnsafe = false;'), 'the retry lands before the unsafe flag is decided');
}

/* ── 2. the city reads again before showing an empty grid ───────────────── */
{
  const B = NC.slice(NC.indexOf('(async function boot()'), NC.indexOf('await refreshLedgerMirror();', NC.indexOf('(async function boot()')));
  ok(/await loadState\(\);\s*\/\*[\s\S]*?\*\/\s*if \(_loadFailed && !Object\.keys\(game\.tiles \|\| \{\}\)\.length\) \{\s*await new Promise\(\(r\) => setTimeout\(r, 2500\)\);[\s\S]*?await loadState\(\);\s*\}/.test(B),
    'boot: a refused load with no tiles is read again 2.5 s later, exactly once');
  ok(!/_loadFailed && !Object\.keys\(game\.tiles \|\| \{\}\)\.length\) \{[\s\S]{0,400}saveNow/.test(B), 'nothing is saved between the two reads');
}

/* ── 3. the warm-up, lifted and driven ──────────────────────────────────── */
{
  const decl = SRC.slice(SRC.indexOf('const _cityWarm = { at: 0, busy: null };'), SRC.indexOf('async function _cityWarmThenOpen(nodeId)'));
  ok(decl.length > 500 && decl.length < 3000, 'the warm-up block is where expected');
  async function drive(opts) {
    const calls = [];
    const mk = (name, ms, fail) => () => new Promise((res, rej) => { calls.push(name); setTimeout(() => fail ? rej(new Error(name)) : res(name), ms); });
    const ctx = {
      Profile: { cloud: { signedIn: opts.signedIn !== false } },
      opFetch: mk('opFetch', 5, opts.failOps), frFetch: mk('frFetch', 5), nodeFetch: mk('nodeFetch', 5),
      cityHallFetch: mk('cityHallFetch', 5), corpTreasuryFetch: mk('corpTreasuryFetch', opts.slowTreasury ? 20000 : 5),
      Date, Promise, setTimeout, calls,
    };
    vm.createContext(ctx);
    vm.runInContext(decl.replace(/setTimeout\(r, 8000\)/, 'setTimeout(r, ' + (opts.timeout || 8000) + ')') + '\nthis.warm = _cityWarmup; this.fresh = _cityWarmFresh; this.W = _cityWarm;', ctx);
    return ctx;
  }
  let c = await drive({});
  ok(c.fresh() === false, 'cold: nothing is fresh');
  ok(await c.warm() === true && c.calls.length === 5, 'a warm-up runs all five fetches', c.calls.join(','));
  ok(c.fresh() === true && c.W.at > 0, '…and stamps the pass');
  const n = c.calls.length;
  ok(await c.warm() === true && c.calls.length === n, 'a fresh pass is not repeated');
  ok(await c.warm(true) === true && c.calls.length === n + 5, '…unless forced');
  c = await drive({ failOps: true });
  ok(await c.warm() === true && c.fresh(), 'one failing fetch does not fail the pass — every leg is best-effort');
  c = await drive({ signedIn: false });
  ok(await c.warm() === false && c.calls.length === 0 && !c.fresh(), 'signed out: nothing is fetched and nothing is stamped');
  c = await drive({ slowTreasury: true, timeout: 60 });
  const t0 = Date.now(); const r = await c.warm(); const dt = Date.now() - t0;
  ok(r === true && dt < 2000 && c.fresh(), 'a hung fetch is abandoned at the bound, and the pass still counts', dt + 'ms');
  c = await drive({});
  const p1 = c.warm(), p2 = c.warm();
  await Promise.all([p1, p2]);
  ok(c.calls.length === 5, 'two overlapping calls share one pass (five fetches, not ten)', c.calls.length);
  /* wiring */
  ok(/if \(!_resolved && !_cityWarmFresh\(\)\) \{ _cityWarmThenOpen\(nodeId\); return; \}/.test(SRC), 'the city door runs a stale warm-up before opening');
  const O = fnText(SRC, 'function _openNodeCity(nodeId, _resolved)');
  ok(O.indexOf('_cityOpenWhenResolved(nodeId); return;') < O.indexOf('_cityWarmThenOpen(nodeId); return;'), '…after ownership is resolvable, so the resolve path is untouched');
  ok(/_openNodeCity\(nodeId, true\);\s*\}/.test(fnText(SRC, 'async function _cityWarmThenOpen(nodeId)')), '…and re-enters resolved, which skips both gates (no loop)');
  ok(/jobs\.push\(Promise\.resolve\(_cityWarmup\(true\)\)/.test(fnText(SRC, 'async function _cityOpenWhenResolved(nodeId)')), 'the resolve path warms in the same 8 s window');
  ok(/addEventListener\('load', \(\) => \{ setTimeout\(\(\) => \{ try \{ _cityWarmup\(\); \}/.test(SRC), 'the shell warms in the background 7 s after load');
}

/* ── 4. three populations, three names ──────────────────────────────────── */
{
  ok(!/👥 Free population</.test(NC), 'the Army panel no longer calls housing slots "population"');
  ok(/🏠 Free housing slots<\/span><b>' \+ Math\.max\(0, popCap\(\) - popUsed\(\)\)/.test(NC), '…it is "Free housing slots", from the same figure');
  ok(/👥 NPC residents<\/span>' \+\s*'<span class="vpopn">' \+ pop \+ '<span class="vcap"> \/ ' \+ cap \+ ' beds<\/span>/.test(NC), 'Vital Signs reads residents / beds');
  ok(/'Residents \(economy model\)'/.test(RD), 'the economy panel says whose residents it counts');
}

/* ── 5. the cash verdict comes after the material verdict — driven ──────── */
{
  const C = fnText(BN, 'export function classify(firm, worst)');
  const mk = (producers, canExtract) => {
    const ctx = {
      CAUSES: { NO_DEPOSIT: 'NO_DEPOSIT', NO_PRODUCER: 'NO_PRODUCER', NO_INPUT: 'NO_INPUT', NO_FEEDSTOCK: 'NO_FEEDSTOCK', NO_WORKERS: 'NO_WORKERS',
                NO_POWER: 'NO_POWER', NO_WATER: 'NO_WATER', NO_FREIGHT: 'NO_FREIGHT', NO_DEMAND: 'NO_DEMAND', NO_CASH: 'NO_CASH', OK: 'OK' },
      DEPOSITS: { ironOre: 1 }, Endow: { canExtract: () => canExtract }, Sim: { state: () => ({ nodeId: 'n' }) },
      Firms: { byOutput: (id) => producers.includes(id) ? [{}] : [] },
    };
    vm.createContext(ctx);
    vm.runInContext(C.replace('export ', '') + '\nthis.classify = classify;', ctx);
    return ctx.classify;
  };
  const broke = { cash: 0, rung: 'OK' }, flush = { cash: 500, rung: 'OK' };
  const sugar = { key: 'sugar', pct: 0 };
  let cl = mk([], true);
  ok(cl(broke, sugar) === 'NO_PRODUCER', 'broke + an input nobody makes → NOBODY MAKES IT (was: out of cash)');
  ok(cl(flush, sugar) === 'NO_PRODUCER', 'flush + an input nobody makes → the same answer; cash was never the cause');
  cl = mk(['sugar'], true);
  ok(cl(broke, sugar) === 'NO_CASH', 'broke + a supplier exists → out of cash is the honest verdict');
  ok(cl(flush, sugar) === 'NO_INPUT', 'flush + a supplier exists but short → starved of inputs');
  cl = mk([], false);
  ok(cl(broke, { key: 'ironOre', pct: 0 }) === 'NO_DEPOSIT', 'broke + a deposit this ground lacks → not in this ground');
  cl = mk([], true);
  ok(cl({ cash: 0, rung: 'BANKRUPT' }, sugar) === 'NO_CASH', 'a BANKRUPT firm is still out of cash whatever the input');
  ok(cl(broke, { key: 'workers', pct: 0.2 }) === 'NO_WORKERS' && cl(broke, { key: 'freshWater', pct: 0.2 }) === 'NO_WATER', 'labour and water verdicts are untouched');
  ok(cl(broke, null) === 'OK' && cl(broke, { key: 'sugar', pct: 0.999 }) === 'OK', 'a firm with nothing binding is Running, even at zero cash');
  ok(!/It is failing, not blocked/.test(BN), 'the fix text no longer calls a break-even firm "failing"');
}

/* ── 6. the six version knobs moved together ────────────────────────────── */
{
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js CACHE_VERSION carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js cache-busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
