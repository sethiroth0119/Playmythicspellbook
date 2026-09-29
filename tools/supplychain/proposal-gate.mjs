#!/usr/bin/env node
/* proposal-gate.mjs — re-proves public/src/supplychain/proposal.js FROM THE REPO.

   WHY THIS FILE EXISTS
   The proposal overlay is a list of gameplay changes that is switched OFF. Rounds 1-2 proved
   it safe with a harness that lived in a temp directory; the round-2 critic's verdict was
   "nothing that makes the overlay real, or lets anyone re-prove it, lives in the repo". This
   is that harness, committed. It answers, against the REAL game code and nothing typed:
     1. is the shipped drop-rate measurement (flux.snapshot.js) still about this game?
     2. does the overlay go through the REAL _opEcon without moving a price, a wage, an
        existing input or yield, or construction's pinned price — locally AND published?
     3. can a player actually get every new need (aimable loot, or a business makes it)?
     4. as SHIPPED (no argument injected) does every business get a battle-loot need?
     5. is it still OFF — does anything outside an admin-gated file import it?
     6. what does it cost (the throttle, stage 4), measured on the real _opComputed?

   NEGATIVE CONTROLS FIRST, EVERY TIME — a check that cannot fail proves nothing
   (.gauntlet/tabletop/_plat-host.mjs is the house pattern):
     A  _opEcon without the nested inputs merge     must fail "inputs preserved"
     B  _opEcon without the pinned-price clamp      must fail "construction price"
     C  round 1's handLoot sourcing rule            must fail "aimable source"
     D  round 1's rate-matching remove              must fail "remove after a retune"
     E  a ruin table with one id swapped            must fail the flux drift check + fluxCheck
     F  a planted non-admin importer                must fail the default-OFF scan
     G  round 3's fail-open adminCopyPayload        must fail "no loot tables = no payload"
        (+ a planted caller passing unchecked:true  must fail the "tests only" scan)
     G  round 3's fail-open adminCopyPayload        must fail "no loot tables = no payload"
        (+ a planted caller passing unchecked:true  must fail the "tests only" scan)
     G  round 3's fail-open adminCopyPayload        must fail "no loot tables = no payload"
        (+ a planted caller passing unchecked:true  must fail the "tests only" scan)

   Everything from index.html is cut out as TEXT by symbol (gen-flux.mjs sliceDecl: the end
   is the first line that leaves a slice which parses). The round-2 builder cut by end-marker
   text and the critic by brace matching; this is a third method, so the three cannot share
   a slicing bug.

   NOT COVERED, and the memo says so: the terroir multiplier (module not loaded here), the
   sql/151 server behaviour (read, never executed — no database is touched by this file),
   a browser run of the admin copy action (the button does not exist yet).

   Usage:
     node tools/supplychain/proposal-gate.mjs                 ~10 s, exit 1 on any failure
     node tools/supplychain/proposal-gate.mjs --emit <dir>    also write overlay / explain / diff JSON
                                                              (proposal-memo.mjs reads them)
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sliceDecl, readIndex, lootSources, build as buildFlux, text as fluxText, readSnapshotText } from './gen-flux.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PUB = path.join(REPO, 'public');
const imp = (p) => import(pathToFileURL(path.join(PUB, 'src', 'supplychain', p)).href);
const emitAt = process.argv.indexOf('--emit');
const EMIT = emitAt > 0 ? path.resolve(process.argv[emitAt + 1] || '.') : null;

let fails = 0;
const show = (label, rows, expectFail) => {
  console.log('\n== ' + label);
  for (const [n, ok, note] of rows) console.log((ok ? '  PASS ' : '  FAIL ') + n + (note ? '  [' + note + ']' : ''));
  const failed = rows.filter((r) => !r[1]).map((r) => r[0]);
  if (expectFail) { for (const e of expectFail) if (!failed.includes(e)) { fails++; console.log('  !! NEGATIVE CONTROL DID NOT FAIL: ' + e); } }
  else fails += failed.length;
};

const html = readIndex();
const SRC = {
  table: sliceDecl(html, 'const', 'OPS_ECON'),
  free: sliceDecl(html, 'const', 'OPS_FREE_LICENCE'),
  pinned: sliceDecl(html, 'const', 'OPS_PINNED_PRICE'),
  overrides: sliceDecl(html, 'function', 'getOpsEconOverrides'),
  opEcon: sliceDecl(html, 'function', '_opEcon'),
  caps: sliceDecl(html, 'const', 'OP_COLLECT_CD_MS') + '\n' + sliceDecl(html, 'const', 'OP_ACCRUAL_CAP_H'),
  computed: sliceDecl(html, 'function', '_opComputed'),
  cxClamp: sliceDecl(html, 'const', 'CX_MUL_MIN') + '\n' + sliceDecl(html, 'const', 'CX_MUL_MAX'),
  cxYield: sliceDecl(html, 'function', 'cxYieldMul'),
};
/* `local` = Forge.opsEcon (the admin's own browser), `published` = Catalog.opsEcon (everyone). */
function host(opEconSrc, local, stash, cx, published) {
  const Forge = { opsEcon: local || {} }, Catalog = { opsEcon: published || {} };
  const getRes = (id) => (stash && stash[id]) || 0;
  const cxMarketMul = cx || (() => 1);
  return new Function('Forge', 'Catalog', 'getRes', 'cxMarketMul',
    [SRC.table, SRC.free, SRC.pinned, SRC.overrides, opEconSrc, SRC.caps, SRC.cxClamp, SRC.cxYield, SRC.computed,
      'return { OPS_ECON, _opEcon, _opComputed, cxYieldMul };'].join('\n'))(Forge, Catalog, getRes, cxMarketMul);
}

/* ── 1. THE SHIPPED MEASUREMENT ─────────────────────────────────────────────────────────── */
const LOOT_SRC = lootSources(html);
const freshFlux = await buildFlux({ SRC: LOOT_SRC });
const snapText = readSnapshotText();
const [proposal, tuning, recipes, coverage, catalog, loot, businesses, snap] = await Promise.all(
  ['proposal.js', 'tuning.js', 'recipes.js', 'coverage.js', 'catalog.js', 'loot.js', 'businesses.js', 'flux.snapshot.js'].map(imp));
const SC = tuning.SC;
const FLUX = snap.FLUX;
const liveTables = (S) => new Function([S.structTbl, S.lootIds, 'return { structureSalvage: STRUCTURE_SALVAGE, lootResIds: LOOT_RES_IDS };'].join('\n'))();
const fluxSuite = (S, fresh) => [
  ['flux.snapshot.js is byte-identical to a fresh roll of the real drop code', snapText === fluxText(fresh)],
  ['fluxCheck: the snapshot\'s table signature matches the live loot tables', proposal.fluxCheck(FLUX, liveTables(S)).ok, proposal.fluxCheck(FLUX, liveTables(S)).why],
];
const mutLoot = Object.assign({}, LOOT_SRC, { structTbl: LOOT_SRC.structTbl.replace("'relicFragments'", "'ritualCandles'") });
if (mutLoot.structTbl === LOOT_SRC.structTbl) throw new Error('mutant E did not mutate');
show('MUTANT E — a ruin table with one id swapped (must fail BOTH staleness checks)', fluxSuite(mutLoot, await buildFlux({ SRC: mutLoot })),
  ['flux.snapshot.js is byte-identical to a fresh roll of the real drop code', 'fluxCheck: the snapshot\'s table signature matches the live loot tables']);
show('REAL loot tables', fluxSuite(LOOT_SRC, freshFlux));
show('FLUX SHAPE', [
  ['a battle seats one ruin of each kind (read from STRUCTURE_ORDER, not typed)', FLUX.ruinsPerBattle === FLUX.ruinKinds.length && FLUX.ruinsPerBattle > 0, FLUX.ruinKinds.join(',')],
  ['perBattleRuins = ruinsPerBattle x perHaul for a ruin-only id (the two units agree)', Object.keys(FLUX.perBattleRuins).filter((id) => FLUX.from[id] === 'ruin').every((id) => Math.abs(FLUX.perBattleRuins[id] - FLUX.ruinsPerBattle * FLUX.perHaul[id]) < 0.002)],
  ['the farm rate table was read', Object.keys((FLUX.minigame || {}).perUnitHour || {}).length > 0, Object.keys((FLUX.minigame || {}).perUnitHour || {}).join(',')],
  ['fluxCheck refuses when no tables are handed over', !proposal.fluxCheck(FLUX, null).ok],
  ['fluxCheck refuses a missing measurement', !proposal.fluxCheck(null, liveTables(LOOT_SRC)).ok],
]);

/* ── the overlay AS SHIPPED: no flux argument anywhere below unless a test says so ── */
const data = { recipes, coverage, catalog, loot, businesses };
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixture.opsecon.json'), 'utf8'));
/* ROUND 5: the knobs live in tuning.js and nowhere else. Rounds 2-4 merged a fallback from proposal.js
   here and only WARNed, so the "one number that sets every appetite" sat outside the settings file
   for three rounds. Now: no block = FAIL, and a copy of SC with the block removed / a knob mistyped
   must make proposal.js propose NOTHING (the controls below), so the fallback cannot creep back. */
const G = (SC.proposal || {}).lootGate;
const gateProblems = proposal.lootGateProblems(SC);

/* Built against the SLICED live table, not the fixture, so a drifted fixture cannot hide anything. */
const clean = host(SRC.opEcon, {});
const liveFn = (id) => clean._opEcon(id);
const liveMap = {}; for (const k of Object.keys(clean.OPS_ECON)) liveMap[k] = clean._opEcon(k);
const ex = proposal.explainOverlay(data, SC, liveMap);
const overlay = proposal.buildOpsEconOverlay(data, SC, liveMap);
const noGateSC = JSON.parse(JSON.stringify(SC)); delete noGateSC.proposal.lootGate;
const badGateSC = JSON.parse(JSON.stringify(SC)); badGateSC.proposal.lootGate.haulsPerWindow = '36';
const propSrc = fs.readFileSync(path.join(PUB, 'src', 'supplychain', 'proposal.js'), 'utf8');
/* "haulsPerWindow: 36" as a property in an object literal; `r.haulsPerWindow : 0` inside a ternary is a read, not a value. */
const knobLiteral = Object.keys(proposal.LOOT_GATE_SHAPE).filter((k) => new RegExp('(^|[\\s{,])' + k + '\\s*:\\s*(\\d|true|false|\\[)', 'm').test(propSrc));
show('LOOT GATE — settings live in tuning.js only', [
  ['SC.proposal.lootGate is present and well-typed in tuning.js', gateProblems.length === 0, gateProblems.join(' ')],
  ['proposal.js types NO knob value (no "haulsPerWindow: 36"-style literal anywhere in it)', knobLiteral.length === 0, 'typed: ' + (knobLiteral.join(', ') || 'none')],
  ['proposal.js exports no LOOT_GATE_DEFAULTS', !('LOOT_GATE_DEFAULTS' in proposal)],
]);
const NOGATE = 'with the block removed from SC, proposal.js proposes nothing and says why';
const BADGATE = 'with one knob mistyped (a string), proposal.js proposes nothing and names the knob';
show('MUTANT H — SC without lootGate / with a mistyped knob (must refuse, never fall back)', [
  [NOGATE, (() => { const e = proposal.explainOverlay(data, noGateSC, liveMap); return Object.keys(e.overlay).length === 0 && e.stats.refused === 'no-lootGate' && e.stats.problems.length === 1; })()],
  [BADGATE, (() => { const e = proposal.explainOverlay(data, badGateSC, liveMap); return Object.keys(e.overlay).length === 0 && /haulsPerWindow/.test(e.stats.problems.join(' ')); })()],
  ['adminCopyPayload returns null without the block, even with matching tables and unchecked:true', proposal.adminCopyPayload(data, noGateSC, liveMap, {}, { unchecked: true }) === null],
  ['adminCopyReport names the missing block', /lootGate/.test(proposal.adminCopyReport(data, noGateSC, liveMap, { unchecked: true }).problems.join(' '))],
  ['diffAgainst says "Nothing is proposed" instead of crashing', /^Nothing is proposed/.test(proposal.diffAgainst(fixture, data, noGateSC).text)],
]);

/* ── 2. THROUGH THE REAL _opEcon ─────────────────────────────────────────────────────────── */
function suite(opEconSrc, viaPublished) {
  const out = []; const t = (name, cond, note) => out.push([name, !!cond, note || '']);
  const hostile = JSON.parse(JSON.stringify(overlay));
  hostile.construction = Object.assign({}, hostile.construction || {}, { startup: 350000, azaStartup: 0 });
  const H = viaPublished ? host(opEconSrc, {}, null, null, hostile) : host(opEconSrc, hostile);
  const base = clean.OPS_ECON;
  let keptIn = true, keptY = true, moneySame = true, added = true, otherSame = true;
  for (const op of Object.keys(base)) {
    const m = H._opEcon(op);
    for (const id of Object.keys(base[op].inputs || {})) if (!m.inputs || m.inputs[id] !== base[op].inputs[id]) keptIn = false;
    for (const id of Object.keys(base[op].yields || {})) if (!m.yields || m.yields[id] !== base[op].yields[id]) keptY = false;
    for (const f of ['ratePerWorkerHr', 'salaryPerWorkerHr', 'maxWorkers']) if (m[f] !== base[op][f]) moneySame = false;
    if (op !== 'construction' && m.startup !== base[op].startup) moneySame = false;
    /* every field that is not inputs / yields, whatever it is called, must read the same as with no override */
    const b0 = clean._opEcon(op);
    for (const f of new Set([...Object.keys(b0), ...Object.keys(m)])) if (f !== 'inputs' && f !== 'yields' && JSON.stringify(b0[f]) !== JSON.stringify(m[f])) otherSame = false;
    for (const key of ['inputs', 'yields']) for (const id of Object.keys((overlay[op] || {})[key] || {})) if (!m[key] || m[key][id] !== overlay[op][key][id]) added = false;
  }
  t('every existing input preserved through the merge', keptIn);
  t('every existing yield preserved through the merge', keptY);
  t('rates / wages / worker caps / startups unchanged', moneySame);
  t('every field other than inputs / yields reads exactly as it does with no override', otherSame);
  t('every overlay rate arrives on the merged row', added);
  const c = H._opEcon('construction');
  t('construction pinned price intact against a hostile override', c.startup === base.construction.startup && c.azaStartup === base.construction.azaStartup, c.startup + ' / ' + c.azaStartup);
  return out;
}
const mutNoInputs = SRC.opEcon.replace(/if \(o\.inputs && typeof o\.inputs === 'object'\) \{[\s\S]*?\n  \}/, '');
const mutNoPin = SRC.opEcon.replace(/if \(OPS_PINNED_PRICE\[t\]\) \{[^\n]*\n/, '');
if (mutNoInputs === SRC.opEcon || mutNoPin === SRC.opEcon) throw new Error('mutant A/B did not mutate — _opEcon changed shape; re-aim the mutants before trusting this gate');
show('MUTANT A — _opEcon without the nested inputs merge (must fail inputs-preserved)', suite(mutNoInputs), ['every existing input preserved through the merge']);
show('MUTANT B — _opEcon without the pinned-price clamp (must fail construction)', suite(mutNoPin), ['construction pinned price intact against a hostile override', 'every field other than inputs / yields reads exactly as it does with no override']);
show('REAL _opEcon — overlay as the admin\'s LOCAL override', suite(SRC.opEcon, false));
show('REAL _opEcon — overlay as the PUBLISHED override', suite(SRC.opEcon, true));

/* ── 3. SOURCING: judged by loot.js directly, NOT by anything proposal.js says about itself ── */
const bestVia = (id) => { const s = loot.sourcesFor(id, { catalog }).find((r) => r && r.via && !r.notLootable && !r.unverified); return s ? s.via : 'none'; };
const passiveMakers = (id, self) => Object.keys(liveMap).filter((b) => b !== self && (liveMap[b].yields || {})[id] > 0);
const minigameMakers = (id, self) => Object.keys(recipes.RECIPES).filter((b) => b !== self && recipes.RECIPES[b].makes.some((m) => m.id === id && m.live && m.via !== 'cityFirm'));
const AIM = 'no required input\'s best source is lottery (exotic/all) or a trader shelf, unless a business makes it';
function sourcingSuite(ov) {
  const made = {}; for (const op of Object.keys(ov)) for (const id of Object.keys(ov[op].yields || {})) (made[id] = made[id] || []).push(op);
  const bad = []; const tally = {};
  for (const op of Object.keys(ov)) for (const id of Object.keys(ov[op].inputs || {})) {
    const v = bestVia(id); tally[v] = (tally[v] || 0) + 1;
    const aim = ['always', 'drops', 'staples'].includes(v);
    const mk = passiveMakers(id, op).length || minigameMakers(id, op).length || (made[id] || []).some((b) => b !== op);
    if (!aim && !mk) bad.push(op + '.' + id + '(' + v + ')');
  }
  return { bad, rows: [[AIM, bad.length === 0, bad.length + ' bad: ' + bad.slice(0, 6).join(' ') + ' | best-source tally ' + JSON.stringify(tally)]] };
}
const handLootRule = { sourcesFor: (id) => { const r = catalog.byId(id); return r && (r.handLoot || r.staple) ? [{ id: 'fake:handLoot', via: 'drops', label: 'handLoot' }] : []; } };
const exMutC = proposal.explainOverlay(Object.assign({}, data, { loot: handLootRule }), SC, liveMap);
const mutC = sourcingSuite(exMutC.overlay);
show('MUTANT C — round 1\'s handLoot rule swapped in for loot.js (must fail sourcing)', mutC.rows, [AIM]);
const vC = proposal.validateOverlay(exMutC.overlay, data, liveMap);
show('…and validateOverlay (with the real loot.js) refuses mutant C\'s overlay', [['validateOverlay refuses it', !vC.ok, vC.errors.length + ' errors']]);
show('REAL sourcing', sourcingSuite(overlay).rows);

/* ── 4. AS SHIPPED + shape + sizing ── */
const rows = []; const t = (n, c, note) => rows.push([n, !!c, note || '']);
t('AS SHIPPED (no flux argument) the overlay uses the shipped measurement', ex.stats.fluxShipped === true);
t('AS SHIPPED every one of the ' + Object.keys(liveMap).length + ' businesses gets at least one AIMABLE battle-loot need (the owner said ALL)', ex.stats.opsWithoutAimableLoot.length === 0 && ex.stats.opsTouched === Object.keys(liveMap).length, ex.stats.aimableLootInputs + ' aimable of ' + ex.stats.newInputs + ' inputs; without: ' + ex.stats.opsWithoutAimableLoot.join(','));
t('injecting the fresh roll gives the identical overlay (snapshot == measurement)', JSON.stringify(proposal.buildOpsEconOverlay(data, SC, liveMap, { flux: freshFlux })) === JSON.stringify(overlay));
const noFlux = proposal.explainOverlay(data, SC, liveMap, { flux: null });
t('with the measurement explicitly withheld (flux:null) NO battle-loot input is emitted — it refuses to guess', noFlux.rows.every((r) => r.kind !== 'input' || ['madeLive', 'madeByOverlay'].includes(r.supply.kind)), noFlux.stats.newInputs + ' made-goods inputs only');
const noLoot = proposal.explainOverlay(Object.assign({}, data, { loot: null }), SC, liveMap);
t('WITHOUT loot data no loot input is emitted either', noLoot.rows.every((r) => r.kind !== 'input' || ['madeLive', 'madeByOverlay', 'madeInMinigame'].includes(r.supply.kind)));
const badKeys = []; for (const op of Object.keys(overlay)) for (const k of Object.keys(overlay[op])) if (!['inputs', 'yields'].includes(k)) badKeys.push(op + '.' + k);
t('no key other than inputs / yields', badKeys.length === 0, badKeys.join(','));
t('only real OPS_ECON ops', Object.keys(overlay).every((op) => clean.OPS_ECON[op]));
const salvIds = new Set(new Function(LOOT_SRC.salvageRes + '\nreturn SALVAGE_RES;')().map((r) => r.id));
const idsAll = []; for (const op of Object.keys(overlay)) for (const k of ['inputs', 'yields']) for (const id of Object.keys(overlay[op][k] || {})) idsAll.push([op, k, id]);
t('every id is a SALVAGE_RES row in the SLICED table (addSalvage drops others)', idsAll.every((x) => salvIds.has(x[2])), idsAll.filter((x) => !salvIds.has(x[2])).join(' '));
t('no phantom id', idsAll.every((x) => !catalog.isPhantom(x[2])));
const vo = proposal.validateOverlay(overlay, data, liveMap);
t('validateOverlay agrees', vo.ok, vo.errors.slice(0, 3).join(' | '));
t('validateOverlay catches a typo id', !proposal.validateOverlay({ mining: { inputs: { clothh: 0.1 } } }, data, liveMap).ok);
t('validateOverlay catches a price key', !proposal.validateOverlay({ mining: { startup: 1 } }, data, liveMap).ok);
t('validateOverlay catches touching an existing rate', !proposal.validateOverlay({ medical: { inputs: { food: 0.1 } } }, data, liveMap).ok);
t('validateOverlay catches a lottery-only input (etherCrystals)', !proposal.validateOverlay({ gas: { inputs: { etherCrystals: 0.01 } } }, data, liveMap).ok);
t('function-form liveOpEcon gives the identical overlay', JSON.stringify(proposal.buildOpsEconOverlay(data, SC, liveFn)) === JSON.stringify(overlay));
t('fixture-form liveOpEcon gives the identical overlay (fixture not drifted)', JSON.stringify(proposal.buildOpsEconOverlay(data, SC, fixture)) === JSON.stringify(overlay));
t('contract two-argument form (rows riding on data) gives the identical overlay', JSON.stringify(proposal.buildOpsEconOverlay(Object.assign({}, data, { opEcon: liveMap }), SC)) === JSON.stringify(overlay));
t('deterministic', JSON.stringify(proposal.buildOpsEconOverlay(data, SC, liveMap)) === JSON.stringify(overlay));
const doubled = JSON.parse(JSON.stringify(liveMap)); for (const op of Object.keys(doubled)) for (const k of ['inputs', 'yields']) for (const id of Object.keys(doubled[op][k] || {})) doubled[op][k][id] *= 2;
const ex2 = proposal.explainOverlay(data, SC, doubled);
let scaledOk = true, nUncapped = 0;
for (const r of ex.rows) { const r2 = ex2.rows.find((x) => x.op === r.op && x.id === r.id && x.kind === r.kind); if (!r2) continue;
  if (r.kind === 'yield' || (!r.cappedBy && !r2.cappedBy)) { nUncapped++; if (Math.abs(r2.rate - 2 * r.rate) > 0.011) scaledOk = false; }
  if (r.kind === 'input' && r.cappedBy === 'drop-flux' && r2.rate > r.rate + 1e-9) scaledOk = false; }
t('the WANT is relative (doubling the table doubles every uncapped rate) and a flux cap does not move with the table', scaledOk, nUncapped + ' uncapped rows compared');
const repriced = JSON.parse(JSON.stringify(liveMap)); for (const op of Object.keys(repriced)) { repriced[op].startup = 1; repriced[op].ratePerWorkerHr = 7; repriced[op].salaryPerWorkerHr = 3; }
t('startup / wages / Cinder rate do not move the overlay', JSON.stringify(proposal.buildOpsEconOverlay(data, SC, repriced)) === JSON.stringify(overlay));
const overBudget = Object.entries(ex.stats.perOp).filter(([, p]) => p.haulsPerWindow > G.haulsPerWindow + 0.5);
t('no business asks for more than ' + G.haulsPerWindow + ' salvage hauls per ' + G.windowHours + 'h (= ' + ex.stats.battlesBudgetIfQueued + ' fully looted battles if every haul were a separate trip)', overBudget.length === 0, 'max ' + Math.max(...Object.values(ex.stats.perOp).map((p) => p.haulsPerWindow)));
t('no business needs more fully looted battles than that budget, read either way', Object.values(ex.stats.perOp).every((p) => p.battlesPerWindow <= p.battlesIfQueued + 1e-9 && p.battlesIfQueued <= ex.stats.battlesBudgetIfQueued + 0.11), 'max together ' + Math.max(...Object.values(ex.stats.perOp).map((p) => p.battlesPerWindow)));
const overMade = ex.stats.madeBalance.filter((m) => m.newDemandPerHr > G.madeShare * m.sparePerHr + 0.02);
t('business-made goods: new demand <= ' + G.madeShare + ' of the makers\' spare hourly output, for every id', overMade.length === 0);
/* farm goods: all buyers of one good together never lean on more than madeShare x minigameUnits animals */
const farmUse = {}; for (const r of ex.rows) if (r.makerUnitsNeeded != null) farmUse[r.id] = (farmUse[r.id] || 0) + r.makerUnitsNeeded;
t('farm-made goods: all new buyers together keep at most ' + (G.madeShare * G.minigameUnits) + ' of ONE animal busy (measured from FARM_ECON)', Object.keys(farmUse).length > 0 && Object.values(farmUse).every((u) => u <= G.madeShare * G.minigameUnits + 0.011), JSON.stringify(farmUse));
const unmeasured = ex.rows.filter((r) => r.makerUnmeasured).map((r) => r.op + '.' + r.id);
t('every minigame-made need is either measured or FLAGGED unmeasured (nothing silently sized)', ex.rows.filter((r) => r.supply && r.supply.kind === 'madeInMinigame').every((r) => r.makerUnitsNeeded != null || r.makerUnmeasured), 'flagged: ' + unmeasured.join(' '));
const st = proposal.stagedOverlays(data, SC, liveMap);
let nest = true; for (let i = 1; i < st.length; i++) for (const op of Object.keys(st[i - 1].overlay)) for (const k of ['inputs', 'yields']) for (const id of Object.keys(st[i - 1].overlay[op][k] || {})) if (!st[i].overlay[op] || !st[i].overlay[op][k] || st[i].overlay[op][k][id] !== st[i - 1].overlay[op][k][id]) nest = false;
t('each stage contains the previous one, same rates', nest, st.map((s) => s.n + ':' + s.stats.newInputs + 'in/' + s.stats.newYields + 'y').join(' '));
t('by stage 2 every business already has an aimable battle-loot need', st[1].stats.opsWithoutAimableLoot.length === 0);
t('last stage equals the full overlay', JSON.stringify(st[st.length - 1].overlay) === JSON.stringify(overlay));
const admin = { mining: { startup: 123, yields: { metal: 9 } }, medical: { inputs: { cloth: 5 } } };
const mg = proposal.mergeIntoOverrides(admin, overlay);
t('mergeIntoOverrides keeps admin fields and admin rates', mg.mining.startup === 123 && mg.mining.yields.metal === 9 && mg.medical.inputs.cloth === 5);
t('removeFromOverrides restores the admin map exactly', JSON.stringify(proposal.removeFromOverrides(mg, overlay)) === JSON.stringify(admin));
const Hm = host(SRC.opEcon, mg);
t('the removal record is INERT in the real _opEcon and changes no row', Hm._opEcon(proposal.OVERLAY_MARKER) === null && JSON.stringify(Hm._opEcon('gas')) === JSON.stringify(host(SRC.opEcon, overlay)._opEcon('gas')));
const nr = proposal.newOpRows(data);
t('newOpRows = fashion + airport, every owner-priced field and every rate null', Object.keys(nr).sort().join() === 'airport,fashion' && Object.values(nr).every((r) => proposal.OWNER_PRICED_FIELDS.every((f) => r.row[f] === null) && [...Object.values(r.row.yields), ...Object.values(r.row.inputs)].every((v) => v === null)));
t('fashion makes cloth', nr.fashion && 'cloth' in nr.fashion.row.yields);
t('a new-op row is INERT through the real _opEcon (returns null)', host(SRC.opEcon, { fashion: nr.fashion.row })._opEcon('fashion') === null);
t('enabledByDefault is false', ex.stats.enabledByDefault === false);
show('AS SHIPPED / SHAPE / SIZING / STAGES / MERGE', rows);

/* remove-after-retune */
const countLines = (m) => { let n = 0; for (const op of Object.keys(m)) if (op !== proposal.OVERLAY_MARKER) for (const k of ['inputs', 'yields']) n += Object.keys((m[op] || {})[k] || {}).length; return n; };
const later = proposal.buildOpsEconOverlay(data, SC, doubled);
const RM1 = 'remove works after a retune (table doubled between ON and OFF): 0 lines left', RM2 = 'remove never deletes an admin line whose rate happens to equal ours';
const removeSuite = (removeFn) => [[RM1, countLines(removeFn(proposal.mergeIntoOverrides({}, overlay), later)) === 0],
  [RM2, (() => { const op = Object.keys(overlay).find((o) => overlay[o].inputs); const id = Object.keys(overlay[op].inputs)[0]; const a = { [op]: { inputs: { [id]: overlay[op].inputs[id] } } }; const back = removeFn(proposal.mergeIntoOverrides(a, overlay), overlay); return back[op] && back[op].inputs && back[op].inputs[id] === overlay[op].inputs[id]; })()]];
const r1Remove = (existing, ov) => { const out = JSON.parse(JSON.stringify(existing)); delete out[proposal.OVERLAY_MARKER]; for (const op of Object.keys(ov)) { if (!out[op]) continue; for (const key of ['inputs', 'yields']) { const add = ov[op][key], cur = out[op][key]; if (!add || !cur) continue; for (const id of Object.keys(add)) if (cur[id] === add[id]) delete cur[id]; if (!Object.keys(cur).length) delete out[op][key]; } if (!Object.keys(out[op]).length) delete out[op]; } return out; };
show('MUTANT D — round 1\'s rate-matching remove (must fail both)', removeSuite(r1Remove), [RM1, RM2]);
show('REAL removeFromOverrides', removeSuite(proposal.removeFromOverrides));

/* ── the admin copy / remove payloads, end to end through the real merge, both paths ── */
const tables = liveTables(LOOT_SRC);
const copied = proposal.adminCopyPayload(data, SC, liveMap, admin, { lootTables: tables });
const parsed = copied ? JSON.parse(copied) : null;
const viaLocal = parsed && host(SRC.opEcon, parsed), viaPub = parsed && host(SRC.opEcon, {}, null, null, parsed);
const sameAs = (H) => Object.keys(overlay).every((op) => ['inputs', 'yields'].every((k) => Object.keys(overlay[op][k] || {}).every((id) => (admin[op] && admin[op][k] && id in admin[op][k]) || H._opEcon(op)[k][id] === overlay[op][k][id])));
show('ADMIN COPY / REMOVE PAYLOAD (what the button would put on the clipboard)', [
  ['adminCopyPayload returns parseable JSON carrying the removal record', !!parsed && !!parsed[proposal.OVERLAY_MARKER]],
  ['pasted as the LOCAL override, the real _opEcon shows every overlay line; the admin\'s own lines win', !!viaLocal && sameAs(viaLocal) && viaLocal._opEcon('medical').inputs.cloth === 5],
  ['pasted as the PUBLISHED override, the same', !!viaPub && sameAs(viaPub) && viaPub._opEcon('medical').inputs.cloth === 5],
  ['construction stays pinned through the pasted payload', !!viaPub && viaPub._opEcon('construction').startup === clean.OPS_ECON.construction.startup],
  ['adminRemovePayload gives the admin\'s map back exactly', !!parsed && proposal.adminRemovePayload(parsed, overlay) === JSON.stringify(admin, null, 2)],
  ['adminCopyPayload REFUSES when the live loot tables differ from the measured ones', proposal.adminCopyPayload(data, SC, liveMap, admin, { lootTables: liveTables(mutLoot) }) === null],
  ['adminCopyReport says why, in words', (() => { const r = proposal.adminCopyReport(data, SC, liveMap, { lootTables: liveTables(mutLoot) }); return !r.ok && /loot tables changed/.test(r.problems.join(' ')); })()],
  ['adminCopyReport is clean on the real tables', proposal.adminCopyReport(data, SC, liveMap, { lootTables: tables }).ok],
]);

/* ── G. THE STALENESS GUARD IS FAIL-CLOSED ───────────────────────────────────────────────
   Round 3's adminCopyPayload only checked the measurement when the caller passed
   opts.lootTables. Called the short way it returned the whole payload, sized from whatever
   snapshot shipped, while the memo told the owner the copy "refuses to run on a stale
   measurement". The button does not exist yet, so the short way IS what its author would
   type. The mutant below is round 3's function, verbatim in behaviour. */
const G1 = 'no loot tables handed over = NO payload (null)', G2 = 'tables that are not tables (a string, an empty object) = NO payload', G3 = 'the report names the reason when no tables are supplied';
const r3Copy = (d, sc, live, existing, o) => { if (o && o.lootTables && !proposal.fluxCheck(o.flux === undefined ? undefined : o.flux, o.lootTables).ok) return null; const ov = proposal.buildOpsEconOverlay(d, sc, live, o); if (!proposal.validateOverlay(ov, d, live, o).ok) return null; return JSON.stringify(proposal.mergeIntoOverrides(existing, ov), null, 2); };
const closedSuite = (copyFn) => [
  [G1, copyFn(data, SC, liveMap, admin) === null && copyFn(data, SC, liveMap, admin, {}) === null && copyFn(data, SC, liveMap, admin, { lootTables: null }) === null],
  [G2, copyFn(data, SC, liveMap, admin, { lootTables: 'yes' }) === null && copyFn(data, SC, liveMap, admin, { lootTables: {} }) === null],
  [G3, (() => { const r = proposal.adminCopyReport(data, SC, liveMap); return !r.ok && /not supplied/.test(r.problems.join(' ')); })()],
];
show('MUTANT G — the round-3 fail-open adminCopyPayload (must fail the first; it DID refuse junk tables, which is why nobody noticed)', closedSuite(r3Copy), [G1]);
show('REAL adminCopyPayload — fail closed', closedSuite(proposal.adminCopyPayload).concat([
  ['the explicit tests-only escape still works (unchecked:true gives a payload) — so the refusals above are the CHECK, not a broken function', typeof proposal.adminCopyPayload(data, SC, liveMap, admin, { unchecked: true }) === 'string'],
  ['unchecked must be exactly true (a truthy string does not open it)', proposal.adminCopyPayload(data, SC, liveMap, admin, { unchecked: 'true' }) === null],
]));

/* ── 5. DEFAULT OFF ──────────────────────────────────────────────────────────────────────
   "Off" = nothing outside this folder imports proposal.js, and a file inside the folder may
   only do so if it also gates on isAdmin( — the contract allows exactly one runtime caller, an
   admin-only copy action. Comments naming the file are fine, which is why this looks for
   import statements and not for the bare name. */
const FOLDER = path.join(PUB, 'src', 'supplychain');
const IMPORT_RE = /(?:import\s[^;]*?from\s*|import\s*\(\s*|importScripts\s*\(\s*)['"`][^'"`]*supplychain\/proposal\.js|(?:from\s*|import\s*\(\s*)['"`]\.\/proposal\.js/;
function scan(files) {
  const bad = [], okAdmin = [];
  for (const [file, src] of files) {
    if (path.resolve(file) === path.join(FOLDER, 'proposal.js')) continue;
    const inFolder = path.resolve(file).startsWith(FOLDER + path.sep);
    const hit = IMPORT_RE.test(src) || /<script[^>]*supplychain\/proposal\.js/.test(src);
    if (!hit) continue;
    if (inFolder && /\bisAdmin\s*\(/.test(src)) okAdmin.push(path.relative(REPO, file)); else bad.push(path.relative(REPO, file));
  }
  return { bad, okAdmin };
}
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'assets') walk(p, out); }
    else if (/\.(m?js|jsx|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const realFiles = walk(PUB, []).map((f) => [f, fs.readFileSync(f, 'utf8')]);
const OFF = 'nothing imports proposal.js except an isAdmin-gated file inside src/supplychain/';
const offSuite = (files) => { const s = scan(files); return [[OFF, s.bad.length === 0, 'bad: ' + (s.bad.join(', ') || 'none') + ' | admin-gated importers: ' + (s.okAdmin.join(', ') || 'none') + ' | ' + files.length + ' files read']]; };
show('MUTANT F — a planted non-admin importer (must fail default-OFF)', offSuite(realFiles.concat([
  [path.join(FOLDER, 'planted.js'), 'import { buildOpsEconOverlay } from \'./proposal.js\';\nbuildOpsEconOverlay();'],
])), [OFF]);
show('MUTANT F2 — a planted importer OUTSIDE the folder, admin-gated or not (must fail)', offSuite(realFiles.concat([
  [path.join(PUB, 'src', 'planted-elsewhere.js'), 'if (isAdmin()) import(\'../supplychain/proposal.js\');'],
])), [OFF]);
show('REAL tree — default OFF', offSuite(realFiles));
/* unchecked:true is a test escape. Anything under public/ that passes it has re-opened the hole. */
const UNCH = 'no file under public/ passes unchecked to the admin copy';
/* ROUND 5: the scan matches the WORD, not the `unchecked:` spelling — `{ unchecked }`, `opts.unchecked = true`,
   `['unchecked']` all count — in any file under public/ that names the copy function OR the module.
   A false positive costs a rename; a false negative re-opens the hole. Comments are not stripped on purpose:
   a comment that says "unchecked" next to a copy call deserves a look. */
const unchSuite = (files) => { const bad = files.filter(([f, src]) => path.resolve(f) !== path.join(FOLDER, 'proposal.js') && /\bunchecked\b/.test(src) && /adminCopyPayload|proposal\.js/.test(src)).map(([f]) => path.relative(REPO, f)); return [[UNCH, bad.length === 0, 'bad: ' + (bad.join(', ') || 'none')]]; };
show('MUTANT G2 — a planted caller that skips the check (must fail)', unchSuite(realFiles.concat([[path.join(FOLDER, 'planted-modal.js'), 'if (isAdmin()) copy(P.adminCopyPayload(d, SC, live, ex, { unchecked: true }));']])), [UNCH]);
show('MUTANT G3 — the shorthand spelling { unchecked } (must fail)', unchSuite(realFiles.concat([[path.join(FOLDER, 'planted-modal.js'), 'const unchecked = true;\nif (isAdmin()) copy(P.adminCopyPayload(d, SC, live, ex, { unchecked }));']])), [UNCH]);
show('MUTANT G4 — an options object built elsewhere and a bare import (must fail)', unchSuite(realFiles.concat([[path.join(PUB, 'src', 'admin-helper.js'), 'import P from \'./supplychain/proposal.js\';\nconst o = {}; o.unchecked = true; export const go = (d, SC, live, ex) => P.adminCopyPayload(d, SC, live, ex, o);']])), [UNCH]);
show('REAL tree — nobody skips the check', unchSuite(realFiles));

/* ── 6. WHAT IT COSTS, on the REAL _opComputed ── */
console.log('\n== THROTTLE (real _opComputed, ' + G.windowHours + 'h since last collect, full staff)');
const thr = [];
for (const op of Object.keys(overlay)) {
  if (!overlay[op].inputs) continue;
  const o = { op_type: op, workers: clean.OPS_ECON[op].maxWorkers, meta: { lastCollect: Date.now() - G.windowHours * 3600000 } };
  const full = {}; for (const id of Object.keys(clean.OPS_ECON[op].inputs || {})) full[id] = 1e9;
  const before = host(SRC.opEcon, {}, full)._opComputed(o);
  const afterEmpty = host(SRC.opEcon, overlay, full)._opComputed(o);
  const stocked = Object.assign({}, full); for (const id of Object.keys(overlay[op].inputs)) stocked[id] = 1e9;
  /* stages 1-3 only (no new yields) so the market multiplier is untouched by construction */
  const afterStocked3 = host(SRC.opEcon, st[2].overlay, stocked)._opComputed(o);
  const need = {}; for (const id of Object.keys(overlay[op].inputs)) need[id] = +(o.workers * overlay[op].inputs[id] * G.windowHours).toFixed(1);
  const p = ex.stats.perOp[op];
  thr.push({ op, netBefore: before.net, netUnstocked: afterEmpty.net, salaryOwed: afterEmpty.salary, netStockedStage3: afterStocked3.net, needPerWindow: need, hauls: p.haulsPerWindow, battles: p.battlesPerWindow, battlesIfQueued: p.battlesIfQueued, bodies: p.bodiesPerWindow, otherTrips: p.otherTripsPerWindow });
}
for (const r of thr) console.log('  ' + r.op.padEnd(13) + ' net today ' + String(r.netBefore).padStart(8) + ' | ON, not stocked: ' + r.netUnstocked + ' (wages owed ' + r.salaryOwed + ') | stage-3 stocked: ' + r.netStockedStage3 + ' | battles ' + r.battles + '..' + r.battlesIfQueued + ' bodies ' + r.bodies + ' other ' + r.otherTrips);
show('THROTTLE FACTS', [['unstocked businesses earn 0', thr.every((r) => r.netUnstocked === 0)], ['stages 1-3 fully stocked earn exactly today\'s income', thr.every((r) => r.netStockedStage3 === r.netBefore)]]);

console.log('\n== STAGE 4 — Cinder effect of new by-products (real cxYieldMul; old products at x1, new ones swept across the clamp)');
const yieldFx = [];
for (const op of Object.keys(overlay)) {
  if (!overlay[op].yields) continue;
  const newIds = new Set(Object.keys(overlay[op].yields));
  const o = { op_type: op, workers: clean.OPS_ECON[op].maxWorkers, meta: { lastCollect: Date.now() - G.windowHours * 3600000 } };
  const stock = {}; for (const id of Object.keys(Object.assign({}, clean.OPS_ECON[op].inputs || {}, overlay[op].inputs || {}))) stock[id] = 1e9;
  const probe = (mul) => { const H = host(SRC.opEcon, overlay, stock, (id) => (newIds.has(id) ? mul : 1)); const e = H._opEcon(op); return { mul: H.cxYieldMul(e.yields), net: H._opComputed(o).net }; };
  const base = host(SRC.opEcon, {}, stock)._opComputed(o).net;
  const clampLo = new Function(SRC.cxClamp + '\nreturn [CX_MUL_MIN, CX_MUL_MAX];')();
  const lo = probe(clampLo[0]), hi = probe(clampLo[1]), flat = probe(1);
  const q = clean._opEcon(op).yields || {}; const qOld = Object.values(q).reduce((a, b) => a + b, 0); const qNew = Object.values(overlay[op].yields).reduce((a, b) => a + b, 0);
  yieldFx.push({ op, share: +(qNew / (qOld + qNew)).toFixed(3), mulLo: +lo.mul.toFixed(3), mulHi: +hi.mul.toFixed(3), netToday: base, netFlat: flat.net, netLo: lo.net, netHi: hi.net });
}
for (const y of yieldFx) console.log('  ' + y.op.padEnd(13) + ' new by-products = ' + (y.share * 100).toFixed(0) + '% of the priced mix | x' + y.mulLo + ' … x' + y.mulHi + ' | net today ' + y.netToday + ' -> ' + y.netLo + ' … ' + y.netHi);
show('STAGE 4 FACT', [['with new goods priced at par, stage 4 fully stocked still equals today', yieldFx.every((y) => y.netFlat === y.netToday)]]);


if (EMIT) {
  fs.mkdirSync(EMIT, { recursive: true });
  const diff = proposal.diffAgainst(fixture, data, SC);
  fs.writeFileSync(path.join(EMIT, 'out.overlay.json'), JSON.stringify(overlay, null, 2));
  fs.writeFileSync(path.join(EMIT, 'out.diff.txt'), diff.text + '\n\n--- LEFT OUT ---\n' + diff.withheldLines.join('\n') + '\n');
  fs.writeFileSync(path.join(EMIT, 'out.explain.json'), JSON.stringify({ stats: ex.stats, stages: st.map((s) => ({ n: s.n, title: s.title, plain: s.plain, stats: s.stats })), rows: ex.rows, withheld: ex.withheld, throttle: thr, yieldFx, newOpRows: nr,
    mutantC: { badInputs: mutC.bad.length, newInputs: exMutC.stats.newInputs },
    /* what allowUnmeasuredMakers:true would put ON (the round-3 shape) — derived, so the memo can say which business
       would get a stand-in refinery good and which merely wished for one and was withheld anyway */
    unmeasuredIfAllowed: (() => { const sc = JSON.parse(JSON.stringify(SC)); sc.proposal.lootGate.allowUnmeasuredMakers = true;
      return proposal.explainOverlay(data, sc, liveMap).rows.filter((r) => r.kind === 'input' && r.makerUnmeasured).map((r) => ({ op: r.op, id: r.id })); })(),
    /* per business: its single hungriest loot item in battles, and whether that sits at the ceiling */
    ceiling: Object.keys(ex.stats.perOp).map((op) => { const rs = ex.rows.filter((r) => r.op === op && r.kind === 'input' && r.effort && r.effort.unit === 'battles'); if (!rs.length) return null;
      const top = rs.slice().sort((a, b) => b.effort.n - a.effort.n)[0]; return { op, id: top.id, battles: top.effort.n, atCeiling: top.effort.n >= ex.stats.battlesBudgetIfQueued - 0.15, items: rs.length }; }).filter(Boolean),
    counts: { lootSized: ex.rows.filter((r) => r.kind === 'input' && r.haulsPerWindow > 0).length, aimableAndMade: ex.rows.filter((r) => r.kind === 'input' && r.supply && r.supply.kind === 'madeLive' && r.supply.alsoLoot).length },
    copyGuard: { noTablesRefused: proposal.adminCopyPayload(data, SC, liveMap, admin) === null, staleRefused: proposal.adminCopyPayload(data, SC, liveMap, admin, { lootTables: liveTables(mutLoot) }) === null, matchingTablesGivePayload: !!copied, round3WouldHaveCopied: typeof r3Copy(data, SC, liveMap, admin) === 'string' }, noFluxInputs: noFlux.stats.newInputs, lootGateInTuning: !!((SC.proposal || {}).lootGate),
    flux: { exoticPoolSize: FLUX.exoticPoolSize, panel: FLUX.panel, rolls: FLUX.rolls, floor: ex.stats.fluxFloor, from: FLUX.from, ruinsPerBattle: FLUX.ruinsPerBattle, ruinKinds: FLUX.ruinKinds, notMeasured: FLUX.notMeasured, minigame: FLUX.minigame } }, null, 1));
  console.log('\nemitted to ' + EMIT);
}
const s = Object.assign({}, ex.stats); delete s.perOp; delete s.madeBalance;
console.log('\nstats', JSON.stringify(s));
console.log(fails ? '\nFAILS: ' + fails : '\nALL GREEN');
process.exit(fails ? 1 : 0);
