/* ═══════════════════════════════════════════════════════════════════════════
   🧪 seam-smoke — the seam's bar, as a test that lives in the repo.

   WHY. Round 1 proved all of this with scratch scripts, and a proof nobody can
   re-run is a claim. Worse, the one hole the critic found (an ASYNC bridge
   member that rejects → "Uncaught (in promise)" for every player) was exactly
   the case the scratch matrix did not contain. So the hostile matrix is kept
   here, async-reject included, and unhandled rejections are COUNTED rather than
   left to Node's default — which would kill the process with a stack trace and
   no indication of which setup did it.

       node tools/supplychain/seam-smoke.mjs             Node only, ~1 s, no browser
       node tools/supplychain/seam-smoke.mjs --browser   + every fake-bridge persona in Chromium

   Exit 0 = pass. Not wired into _checkall.mjs by this piece (that file is not
   the seam's to edit) — the audit piece owns the hook; the command is the line
   above.
   ═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, drift, FIXTURE } from './gen-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SRC = path.join(REPO, 'public', 'src', 'supplychain');
const fails = [];
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) fails.push(msg); };

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });

/* ── 1. fixture == index.html, and drift() can actually see a change ────── */
console.log('fixture');
const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const fresh = build();
const d0 = drift(fx, fresh);
check(d0.length === 0, `fixture matches public/index.html (${d0.length} difference(s))${d0.length ? ' — ' + d0.slice(0, 3).join(' | ') : ''}`);
// The op count is read from index.html, not typed here: a 26th business is
// not a failure of the seam, a fixture that missed it is.
check(Object.keys(fx.opsEcon).length === Object.keys(fresh.opsEcon).length && fx.counts.ops === Object.keys(fx.opsEcon).length, `op count agrees (${fx.counts.ops})`);
// yields is NOT required: smuggling has none in the game (it earns Cinder and
// burns fuel). What every op must say is what it costs and what it touches.
const FIELDS = ['startup', 'ratePerWorkerHr', 'salaryPerWorkerHr', 'maxWorkers'];
const thin = Object.keys(fx.opsEcon).filter((k) => FIELDS.some((f) => typeof fx.opsEcon[k][f] !== 'number') || !(fx.opsEcon[k].yields || fx.opsEcon[k].inputs));
check(thin.length === 0, `every op carries ${FIELDS.join('/')} and yields or inputs${thin.length ? ' — missing on ' + thin.join(',') : ''}`);
{
  // Tamper a COPY three ways; each must be reported. A detector is only
  // trusted once it has been seen to fire.
  const multi = Object.keys(fx.opsEcon).find((k) => Object.keys(fx.opsEcon[k].yields || {}).length > 1);
  const any = Object.keys(fx.opsEcon)[0];
  const t = JSON.parse(JSON.stringify(fx));
  t.opsEcon[any].startup = (+t.opsEcon[any].startup || 0) + 1;
  check(drift(t, fx).some((l) => l.startsWith(`opsEcon.${any}.startup`)), 'drift() reports a changed number with its field path');
  const t2 = JSON.parse(JSON.stringify(fx));
  delete t2.opsEcon[any];
  check(drift(t2, fx).length > 0, 'drift() reports a missing op');
  if (multi) {
    const t3 = JSON.parse(JSON.stringify(fx));
    t3.opsEcon[multi].yields = Object.fromEntries(Object.entries(t3.opsEcon[multi].yields).reverse());
    check(drift(t3, fx).some((l) => l.includes('key order')), `drift() reports reordered yields (${multi}) — first yield is "the main product"`);
  }
}

/* ── 2. the bridge is total: 9 kinds of id × hostile setups ─────────────── */
console.log('sc.bridge.js totality');
const B = await import(pathToFileURL(path.join(SRC, 'sc.bridge.js')).href);
const TYPES = { ready: 'boolean', healthy: 'boolean', opEcon: 'rowOrNull', opLabel: 'string', ownsOp: 'boolean', resources: 'array', salvageRes: 'array', lootResIds: 'array', structureSalvage: 'map', held: 'count', gems: 'count', isAdmin: 'boolean', signedIn: 'boolean', toast: 'undefined', confirmAsync: 'boolean', openBusiness: 'boolean', transportPhase: 'count' };
const ACC = Object.keys(TYPES);
check(ACC.every((a) => typeof B[a] === 'function'), `all ${ACC.length} accessors exported (16 contract + healthy)`);
const typed = (n, v) => {
  const t = TYPES[n];
  if (t === 'rowOrNull') return v === null || (typeof v === 'object' && !Array.isArray(v));
  if (t === 'array') return Array.isArray(v);
  if (t === 'map') return !!v && typeof v === 'object' && !Array.isArray(v);
  if (t === 'count') return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return typeof v === t;
};
const M = B.BRIDGE_MEMBERS;
const every = (fn) => Object.fromEntries(M.map((m) => [m, fn(m)]));
const cyc = {}; cyc.self = cyc;
const full = {
  opEcon: (id) => fx.opsEcon[id] || null, opLabel: (id) => fx.opLabels[id], ownsOp: () => true,
  resources: () => fx.resources, salvageRes: () => fx.salvageRes, lootResIds: () => fx.lootResIds,
  structureSalvage: () => fx.structureSalvage, held: () => 7, gems: () => 1234.5, isAdmin: () => false,
  signedIn: () => true, toast: () => {}, confirm: async () => true, openBusiness: () => true, transportPhase: () => fx.transportPhase,
};
const W = (b) => () => { globalThis.window = { SupplyChainBridge: b }; };
const SETUPS = {
  'no window': () => { delete globalThis.window; },
  'window = {}': () => { globalThis.window = {}; },
  'half (opEcon + opLabel)': W({ opEcon: full.opEcon, opLabel: full.opLabel }),
  'every member throws': W(every(() => () => { throw new Error('boom'); })),
  'every member is async and REJECTS': W(every(() => async () => { throw new Error('rej'); })),
  'every member returns a rejected promise': W(every(() => () => Promise.reject(new Error('rej2')))),
  'every member returns a thenable whose then throws': W(every(() => () => ({ get then() { throw new Error('then'); } }))),
  'every member returns a never-settling promise': W(every(() => () => new Promise(() => {}))),
  'throwing getter on window': () => { globalThis.window = { get SupplyChainBridge() { throw 2; } }; },
  'throwing Proxy bridge': W(new Proxy({}, { get() { throw 3; }, has() { throw 3; } })),
  'members return a throwing Proxy': W(every(() => () => new Proxy({}, { get() { throw 4; }, ownKeys() { throw 4; } }))),
  'junk strings': W(every(() => () => 'oops')),
  'cyclic objects': W(every(() => () => cyc)),
  'NaN / negative / Infinity / bad rows': W({ opEcon: () => [1], held: () => -5, gems: () => Infinity, transportPhase: () => NaN, resources: () => [null, { id: 5 }, { id: '' }, { id: 'x' }], lootResIds: () => [1, null, 'a'], structureSalvage: () => ({ a: null, b: { core: 'x' } }) }),
  'bridge is a string': W('hi'),
  'members are numbers': W(every(() => 42)),
  'full': W(full),
};
const IDS = ['mining', 'nope', undefined, null, 42, Symbol('s'), { toString() { throw 9; } }, {}, ''];
let calls = 0, threw = 0, mistyped = 0;
for (const [name, set] of Object.entries(SETUPS)) {
  set();
  for (const a of ACC) for (const id of IDS) {
    calls++;
    try {
      let v = B[a](id);
      if (a === 'confirmAsync') {
        if (!(v instanceof Promise)) { mistyped++; console.log('    confirmAsync did not return a promise:', name); }
        // Raced, not awaited bare: under the never-settling setup an unanswered
        // question stays unanswered by design, and the test must not hang on it.
        v = await Promise.race([v, new Promise((r) => setTimeout(() => r(false), 20))]);
      }
      if (!typed(a, v)) { mistyped++; console.log('    MISTYPED', name, a, typeof v); }
    } catch (e) { threw++; console.log('    THREW', name, a, String(e).slice(0, 80)); }
  }
}
await new Promise((r) => setTimeout(r, 250));     // let any orphaned rejection surface
check(threw === 0, `${calls} calls across ${Object.keys(SETUPS).length} setups: ${threw} synchronous throws`);
check(mistyped === 0, `${mistyped} wrongly typed results`);
check(unhandled === 0, `${unhandled} unhandled promise rejections (the round-1 hole: was 126)`);

// healthy() is the honest gate; ready() is only "is there a bridge".
SETUPS['every member throws'](); check(B.ready() === true && B.healthy() === false, 'throwing bridge: ready() true, healthy() false → shell shows its offline notice');
SETUPS['every member is async and REJECTS'](); check(B.healthy() === false, 'rejecting bridge: healthy() false');
SETUPS['junk strings'](); check(B.healthy() === false, 'junk bridge: healthy() false');
SETUPS['full'](); check(B.healthy() === true && B.healthy(['nope', 'mining']) === true && B.healthy(['nope']) === false, 'full bridge: healthy() true, and it probes the ids it is given');
{
  // Read-only in fact, not just in name: a view mutating a row must not reach the table.
  const before = JSON.stringify(fx.opsEcon);
  const r = B.opEcon(Object.keys(fx.opsEcon)[0]); r.startup = -1; if (r.yields) r.yields.__x = 1;
  B.resources().forEach((x) => { x.name = 'mutated'; });
  check(JSON.stringify(fx.opsEcon) === before && fx.resources.every((x) => x.name !== 'mutated'), 'accessors return copies — mutating a result leaves the source table alone');
}
await new Promise((r) => setTimeout(r, 50));
check(unhandled === 0, `still ${unhandled} unhandled rejections after the healthy() probes`);

/* ── 2b. total in TIME, and a printed number that stays in its range ──────
   Two holes the round-2 critic found by inspection, both of which the matrix
   above cannot see because it only asks "did it throw" and "is it typed":

   • confirmAsync was the one member with no ceiling. A `confirm` that never
     settles left its caller awaiting forever — in Node, an unsettled top-level
     await exits 13 with no message. It now races SC.bridge.confirmTimeoutMs
     and answers false, and the test passes its own 30 ms so the proof is fast.
   • transportPhase is PRINTED as "stage N of 3". num() rejects non-positive
     and non-finite and nothing else, so a bridge answering 99 printed 99. */
console.log('confirm has a ceiling; phase stays in range');
{
  const { SC } = await import(pathToFileURL(path.join(SRC, 'tuning.js')).href);
  const ms = SC && SC.bridge && SC.bridge.confirmTimeoutMs;
  check(Number.isFinite(ms) && ms > 0, `SC.bridge.confirmTimeoutMs is the documented ceiling (${ms} ms) and lives in tuning.js, not in sc.bridge.js`);

  globalThis.window = { SupplyChainBridge: { confirm: () => new Promise(() => {}) } };
  const t0 = Date.now();
  check((await B.confirmAsync('never answered', 30)) === false && Date.now() - t0 < 2000,
    `a confirm that never settles answers false after the ceiling (${Date.now() - t0} ms), instead of hanging the caller`);

  // A LATE yes is still a no — the question timed out, and re-opening the map
  // must not act on an answer nobody is looking at any more. It must also not
  // leak: the late promise settles into a race that is already over.
  globalThis.window = { SupplyChainBridge: { confirm: () => new Promise((r) => setTimeout(() => r(true), 120)) } };
  check((await B.confirmAsync('answered too late', 20)) === false, 'an answer that arrives after the ceiling reads as no');
  check((await B.confirmAsync('answered in time', 4000)) === true, 'an answer inside the ceiling is passed through');

  globalThis.window = { SupplyChainBridge: { confirm: () => Promise.reject(new Error('dialog blew up')) } };
  check((await B.confirmAsync('rejects', 30)) === false, 'a rejecting confirm reads as no');

  const phase = (v) => { globalThis.window = { SupplyChainBridge: { transportPhase: () => v } }; return B.transportPhase(); };
  check(phase(99) === 3 && phase(3) === 3 && phase(2) === 2 && phase(1) === 1,
    `transportPhase is clamped to 0..${B.TRANSPORT_PHASE_MAX} — a bridge answering 99 can never print "stage 99 of 3"`);
  check(phase(-1) === 0 && phase(0) === 0 && phase(NaN) === 0 && phase('2') === 2 && phase(1.7) === 1,
    'transportPhase: junk and non-positive read as 0 (unknown), a numeric string is accepted, a fraction floors');
}
await new Promise((r) => setTimeout(r, 200));      // the late `true` lands in here
check(unhandled === 0, `still ${unhandled} unhandled rejections after the confirm ceiling probes`);
delete globalThis.window;

/* ── 3. one seam, no numbers ────────────────────────────────────────────── */
console.log('seam hygiene');
// Comments are allowed to SAY the name (most files explain the globals trap);
// code is not allowed to read it.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const others = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'sc.bridge.js');
const leaks = others.filter((f) => /SupplyChainBridge/.test(code(fs.readFileSync(path.join(SRC, f), 'utf8'))));
check(leaks.length === 0, `only sc.bridge.js reads window.SupplyChainBridge (checked ${others.length} sibling modules)${leaks.length ? ' — ' + leaks.join(',') : ''}`);

const { SC } = await import(pathToFileURL(path.join(SRC, 'tuning.js')).href);
let frozen = true; try { SC.overlay.zIndex = 1; frozen = SC.overlay.zIndex !== 1; } catch (e) { frozen = true; }
check(frozen && Object.isFrozen(SC), 'SC is deep-frozen');
{
  /* tuning.js must not carry an economy number. Comparing VALUES against the
     game's figures was tried and is useless — wages and tween times are both
     round numbers, so 750 ms "equalled" a 750/hr rate and ten knobs failed.
     What separates them is NAME and SCALE: no numeric knob may be named like
     money, and nothing may be licence-sized unless it is a duration or the
     z-index. A new big number has to be one of those or explain itself here. */
  const named = [], big = [];
  const walk = (v, p) => {
    if (typeof v === 'number') {
      if (/startup|wage|salar|price|cost|cinder|gem|fee|payout|perWorkerHr/i.test(p)) named.push(p);
      if (Math.abs(v) >= 1000 && !/(Ms|zIndex)$/.test(p)) big.push(p + '=' + v);
    } else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], p + '.' + k);
  };
  walk(SC, 'SC');
  check(named.length === 0, `no numeric SC knob is named like money${named.length ? ' — ' + named.join(', ') : ''}`);
  check(big.length === 0, `no SC number >= 1000 outside *Ms / zIndex${big.length ? ' — ' + big.join(', ') : ''}`);
}
{
  // fake-bridge.js must offer exactly the members the real bridge must.
  const fb = fs.readFileSync(path.join(HERE, 'fake-bridge.js'), 'utf8').replace(/\r\n/g, '\n');
  const blk = /var full = \{([\s\S]*?)\n  \};/.exec(fb);
  const keys = blk ? [...blk[1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]) : [];
  check(JSON.stringify(keys.slice().sort()) === JSON.stringify(M.slice().sort()), `fake-bridge "full" persona has exactly BRIDGE_MEMBERS (${keys.length}/${M.length})`);
}

/* ── 3b. the camera's own Git-Bash trap ─────────────────────────────────────
   Pure, so it runs in the fast Node pass. Git Bash's MSYS layer rewrote
   `/__sc/x.html` into `/C:/Program Files/Git/__sc/x.html`, shoot.mjs saved a
   black PNG of the 404 and exited 0 — a green verdict on a photograph of
   nothing, which would have corrupted every other piece's critique. The repair
   must fire on the mangled form and must NOT fire on a path that really
   exists, or a file:// shot would be silently redirected. */
{
  const { unmangle } = await import(pathToFileURL(path.join(HERE, 'shoot.mjs')).href);
  const gitRoot = ['C:/Program Files/Git', 'C:/Program Files (x86)/Git'].find((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
  if (gitRoot) {
    check(unmangle('/' + gitRoot + '/__sc/harness-scene3d.html') === '/__sc/harness-scene3d.html', 'unmangle repairs the real Git-Bash rewrite');
    check(unmangle(gitRoot + '/__sc/a.html?owns=mining') === '/__sc/a.html?owns=mining', 'unmangle keeps the query string');
  } else { check(true, 'unmangle: no Git install to build the mangled form from (skipped)'); }
  check(unmangle('__sc/harness-modal.html') === '__sc/harness-modal.html', 'unmangle leaves the documented no-slash form alone');
  check(unmangle('/__sc/harness-modal.html') === '/__sc/harness-modal.html', 'unmangle leaves an honest leading-slash path alone');
  check(unmangle('http://127.0.0.1:1/x') === 'http://127.0.0.1:1/x', 'unmangle leaves an absolute URL alone');
  check(unmangle(path.join(HERE, 'README.md')).replace(/\\/g, '/') === path.join(HERE, 'README.md').replace(/\\/g, '/'), 'unmangle leaves a Windows path that really exists alone');
  check(unmangle(null) === '' && unmangle(undefined) === '', 'unmangle is total on null/undefined');
}

/* ── 4. (--browser) every persona through real Chromium ─────────────────── */
if (process.argv.includes('--browser')) {
  console.log('personas in Chromium');
  const { withPage } = await import('./shoot.mjs');
  const html = `<!doctype html><meta charset=utf-8><script src="/__sc/fake-bridge.js"></script><script type=module>
import * as B from '/src/supplychain/sc.bridge.js';
const out = { throws: 0 };
for (const a of ${JSON.stringify(ACC)}) { try { let v = B[a]('mining'); if (v instanceof Promise) v = await v; out[a] = Array.isArray(v) ? 'arr' + v.length : (v && typeof v === 'object') ? 'obj' : String(v); } catch (e) { out.throws++; out[a] = 'THROW ' + e; } }
await new Promise((r) => setTimeout(r, 150));
out.unhandled = (window.__scFake && window.__scFake.unhandled) || 0;
window.__out = out; document.body.dataset.ready = '1';</script>`;
  await withPage(async (page0, t) => {
    // One Chromium for all six personas — t.newPage(), not six withPage calls.
    for (const mode of ['full', 'none', 'half', 'throw', 'reject', 'junk']) {
      const page = await t.newPage(mode);
      await page.route('**/__smoke/p.html*', (x) => x.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto(t.url('/__smoke/p.html?scbridge=' + mode + '&owns=mining'));
      await t.ready('[data-ready="1"]', { page });   // zero-height body: waitForSelector would call this hidden
      const o = await page.evaluate(() => window.__out);
      const errs = t.errors.filter((l) => l.startsWith('[' + mode + ']'));
      const want = mode === 'full' || mode === 'half';   // half still has opEcon: the map can be drawn honestly
      check(o.throws === 0 && o.unhandled === 0 && errs.length === 0 && (o.healthy === String(want)),
        `${mode}: throws ${o.throws}, unhandled ${o.unhandled}, console/page errors ${errs.length}, healthy ${o.healthy}${errs.length ? ' — ' + errs[0] : ''}`);
      await page.close();
    }
  }, { w: 800, h: 600 });
}

console.log(fails.length ? `\nseam-smoke: ${fails.length} FAILED\n  ` + fails.join('\n  ') : '\nseam-smoke: all passed');
process.exit(fails.length ? 1 : 0);
