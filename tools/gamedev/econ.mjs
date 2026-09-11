#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// econ.mjs — the economy and business systems, headless.
//
//   node tools/gamedev/econ.mjs ops                 # every Corp operation priced through _opEcon()/_opComputed()
//   node tools/gamedev/econ.mjs tax 1000,25000,1e6  # Foundation Reserve tax quote for those gross amounts
//   node tools/gamedev/econ.mjs resources           # RESOURCES + caps + Cinder sell values
//   node tools/gamedev/econ.mjs city                # runs public/src/city production.data.js auditCatalog() with the LIVE resource ids
//   node tools/gamedev/econ.mjs parity              # client ⇄ worker.js: GARAGE_RIGS skus/prices, SOVEREIGN_PACKAGES ids/prices
//   node tools/gamedev/econ.mjs --check             # city + parity, exit 1 on any problem (what check.mjs runs)
//
// Why these and not "all of it": the economy is mostly Supabase-side and
// interactive. The parts below are deterministic, local, and have bitten before:
// a price the client shows that the worker charges differently (worker.js is the
// payment authority), or a city building that costs a resource that does not
// exist. Those are cheap to lock and expensive to discover in production.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEngine, ROOT, argFlag, positional } from './headless.mjs';

const [cmd, arg] = positional();
const eng = loadEngine();
const problems = [];
const bad = (m) => { problems.push(m); console.log('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

/** Evaluate a top-level `const NAME = {…}` literal out of worker.js (same column-0 trick as extract-engine-data). */
function workerConst(name) {
  const lines = readFileSync(join(ROOT, 'worker.js'), 'utf8').split('\n');
  const s = lines.findIndex((l) => new RegExp('^(?:const|let|var) ' + name + ' = ').test(l));
  if (s === -1) return undefined;
  let e = lines.findIndex((l, i) => i > s && /^[}\])]/.test(l)); if (e === -1) e = s;
  const src = lines.slice(s, e + 1).join('\n').replace(/^(?:const|let|var) \w+ = /, 'return ');
  try { return new Function(src)(); } catch (err) { return { __error: err.message }; }
}

async function city() {
  console.log('\n■ city production catalog (public/src/city/production.data.js → auditCatalog)');
  try {
    const mod = await import(pathToFileURL(join(ROOT, 'public', 'src', 'city', 'production.data.js')).href);
    const ids = (eng.RESOURCES || []).map((r) => r.id);
    const res = mod.auditCatalog(ids);
    const list = Array.isArray(res) ? res : (res && res.problems) || [];
    if (!list.length) ok(mod.CITY_PRODUCTION.length + ' buildings, ' + ids.length + ' resources — no problems');
    list.forEach((p) => bad('city: ' + p));
  } catch (e) { bad('could not run the city audit: ' + e.message); }
}

function parity() {
  console.log('\n■ client ⇄ worker.js parity (worker is the payment authority)');
  const wRigs = workerConst('GARAGE_RIGS');
  const cRigs = eng.GARAGE_RIGS;
  if (!wRigs || wRigs.__error) bad('worker GARAGE_RIGS not readable' + (wRigs ? ': ' + wRigs.__error : ''));
  else if (!Array.isArray(cRigs)) bad('client GARAGE_RIGS not exported');
  else {
    for (const r of cRigs) {
      const w = wRigs[r.sku];
      if (!w) { bad('garage: client sells sku "' + r.sku + '" that worker.js does not know — checkout will 400'); continue; }
      const cents = Math.round((r.price || 0) * 100);
      if (w.cents !== cents) bad('garage: ' + r.sku + ' client shows $' + r.price + ' but worker charges ' + (w.cents / 100).toFixed(2));
      if (w.name && r.name && w.name !== r.name) bad('garage: ' + r.sku + ' name differs (client "' + r.name + '" / worker "' + w.name + '")');
    }
    for (const sku of Object.keys(wRigs)) if (!cRigs.find((r) => r.sku === sku)) bad('garage: worker sells "' + sku + '" the client never lists (unreachable product)');
    if (!problems.some((p) => p.startsWith('garage'))) ok('garage rigs: ' + cRigs.length + ' skus match worker.js names and prices');
  }
  const cPk = eng.SOVEREIGN_PACKAGES;
  // worker.js names its table AZA_PACKS ("PRICING SOURCE OF TRUTH — these MUST match
  // SOVEREIGN_PACKAGES in public/index.html"); try the known names, then search.
  let wPk = workerConst('AZA_PACKS') || workerConst('SOVEREIGN_PACKAGES');
  if (!wPk) {                                       // find the const whose BODY mentions the first client id
    const txt = readFileSync(join(ROOT, 'worker.js'), 'utf8');
    const first = cPk && cPk[0] && cPk[0].id;
    const re = first ? new RegExp('^const (\\w+) = \\{[^]*?^\\s+' + first + '\\s*:', 'm') : null;
    const mm = re && txt.match(re);
    if (mm) wPk = workerConst(mm[1]);
  }
  if (!Array.isArray(cPk)) bad('client SOVEREIGN_PACKAGES not exported');
  else if (!wPk || wPk.__error) bad('worker package table not found/readable — cannot verify Aza prices (STRIPE.md says they must match)');
  else {
    const wList = Array.isArray(wPk) ? wPk : Object.entries(wPk).map(([id, v]) => ({ id, ...v }));
    for (const p of cPk) {
      const w = wList.find((x) => x.id === p.id || x.sku === p.id);
      if (!w) { bad('aza: client package "' + p.id + '" unknown to worker.js'); continue; }
      const wPrice = w.cents != null ? w.cents / 100 : w.price != null ? w.price : w.usd;
      if (wPrice != null && Math.abs(wPrice - p.price) > 0.001) bad('aza: ' + p.id + ' client $' + p.price + ' vs worker $' + wPrice);
      const wSov = w.sovereigns != null ? w.sovereigns : w.aza != null ? w.aza : w.coins;
      if (wSov != null && wSov !== p.sovereigns) bad('aza: ' + p.id + ' client grants ' + p.sovereigns + ' but worker grants ' + wSov);
    }
    if (!problems.some((p) => p.startsWith('aza'))) ok('aza packages: ' + cPk.length + ' ids match worker.js prices and grants');
  }
}

function ops() {
  console.log('\n■ Corp operations — OPS_ECON through _opEcon() (' + Object.keys(eng.OPS_ECON || {}).length + ' ops)\n');
  const cols = ['op', 'startup', 'rate/wkr/h', 'salary/wkr/h', 'workers', 'net/h full', 'yields', 'inputs', 'flags'];
  const rows = Object.keys(eng.OPS_ECON || {}).map((t) => {
    const o = eng._opEcon(t) || {};
    let c = null; try { c = eng._opComputed ? eng._opComputed(o) : null; } catch (e) {}
    const net = (o.ratePerWorkerHr - o.salaryPerWorkerHr) * (o.maxWorkers | 0);
    return [t, o.startup, o.ratePerWorkerHr, o.salaryPerWorkerHr, o.maxWorkers, net, JSON.stringify(o.yields || {}), JSON.stringify(o.inputs || {}), [o.illicit && 'illicit', c && c.terroirMul && 'terroir×' + c.terroirMul].filter(Boolean).join(' ')];
  });
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? '').length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join('  '));
  rows.forEach((r) => console.log(r.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ')));
  const payback = rows.map((r) => [r[0], r[5] > 0 ? (r[1] / r[5]).toFixed(1) + ' h' : '∞']);
  console.log('\npayback at full staff: ' + payback.map((p) => p[0] + '=' + p[1]).join('  '));
  console.log('\n(overrides: getOpsEconOverrides() is admin-tunable in-app; this shows the merged live value)');
}

function tax() {
  const amounts = (arg || '100,1000,10000,100000,1000000').split(',').map(Number);
  console.log('\n■ Foundation Reserve tax (frTaxQuote)\n');
  for (const g of amounts) {
    try { const q = eng.frTaxQuote(g, {}); console.log('  gross ' + String(g).padStart(9) + ' → ' + JSON.stringify(q)); }
    catch (e) { console.log('  gross ' + g + ' → threw ' + e.message); }
  }
}

function resources() {
  console.log('\n■ RESOURCES (' + (eng.RESOURCES || []).length + ') + CONSUMABLE (' + (eng.CONSUMABLE_RESOURCES || []).length + ') + SALVAGE_RES (' + Object.keys(eng.SALVAGE_RES || {}).length + ' loot-only)\n');
  let cap = null; try { cap = eng.getResourceCap(); } catch (e) {}
  const sell = eng.RESOURCE_CINDER_VALUE || eng.CINDER_SELL_VALUES || {};
  (eng.RESOURCES || []).forEach((r) => console.log('  ' + r.icon + ' ' + r.id.padEnd(18) + r.name.padEnd(18) + (sell[r.id] != null ? 'sell ¢' + sell[r.id] : '')));
  console.log('\n  cap (fresh profile): ' + JSON.stringify(cap));
}

(async () => {
  if (argFlag('check')) { await city(); parity(); console.log('\n' + (problems.length ? '✗ ' + problems.length + ' economy problem(s)' : '✓ economy checks pass')); process.exit(problems.length ? 1 : 0); }
  if (cmd === 'ops') ops();
  else if (cmd === 'tax') tax();
  else if (cmd === 'resources') resources();
  else if (cmd === 'city') await city();
  else if (cmd === 'parity') parity();
  else console.log('usage: econ.mjs ops | tax [a,b,c] | resources | city | parity | --check');
  process.exit(problems.length ? 1 : 0);
})();
