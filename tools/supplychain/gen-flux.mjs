#!/usr/bin/env node
/* gen-flux.mjs — writes public/src/supplychain/flux.snapshot.js: HOW MUCH of each
   resource one salvage haul really gives, measured by ROLLING THE GAME'S OWN DROP CODE.

   WHY THIS FILE EXISTS
   proposal.js turns the owner's "every business needs battle loot" into an Ops-Econ
   overlay. A need is only fair if a player can feed it, so every loot input is sized
   against drop flux. Rounds 1-2 measured that flux in a temp directory; the shipped
   module therefore emitted ZERO battle-loot needs (it refuses to guess) — the opposite
   of what the owner asked for — and nobody could re-prove the numbers from the repo.
   This is the catalog.snapshot.js pattern applied to drops: machine-made, deterministic,
   and `--check` fails the moment the loot tables or the roll code move.

   WHAT IS ROLLED (all sliced out of public/index.html as TEXT — they are lexical
   globals of a classic script, so nothing can import them; CLAUDE.md "the globals trap"):
     _rollUnitSalvage       a fallen body          (Math.random swapped for a seeded PRNG)
     _rollStructureSalvage  a ruin                 (takes its rnd as a parameter already)
     SALVAGE_RES, LOOT_RES_IDS, STRUCTURE_SALVAGE, STRUCTURE_ORDER
   and, for the goods that only exist when somebody PLAYS the Homestead Farm, FARM_ECON
   out of public/src/farm/index.js (a module-local const, not exported — same trap).

   WHAT IS ASSUMED, stated once here and printed into the snapshot so the memo can quote it:
     · PANEL — who dies in an ordinary battle. There is no play telemetry in this repo;
       the mix is a guess (mostly level-1 commons, no bosses: a boss is an event, not a
       supply line). Change it here, re-run, and every appetite moves with it.
     · one battle = every ruin looted. The COUNT is not a guess: _rollStructurePlacements
       seats exactly one ruin of EACH kind in STRUCTURE_ORDER, so `perBattleRuins` is the
       sum over kinds and `ruinsPerBattle` is read from the sliced array.
   NOT MEASURED: the Cracking Yard (diesel, naphtha…). Its output depends on crude grade,
   plant built and batches played; there is no per-hour table to read. The snapshot says so.

   REJECTED: measuring at runtime over the bridge. It would need the two roll functions
   exposed on SupplyChainBridge (a new hunk in index.html for an OFF-by-default admin
   preview) and ~400k rolls on the main thread. A generated file + a drift gate is the
   pattern this folder already trusts.
   REJECTED: a timestamp / line numbers in the output — second run must be byte-identical.

   Usage:
     node tools/supplychain/gen-flux.mjs            regenerate (prints "unchanged" when nothing moved)
     node tools/supplychain/gen-flux.mjs --check    write nothing; exit 1 if the snapshot is stale
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const INDEX = path.join(REPO, 'public', 'index.html');
const FARM = path.join(REPO, 'public', 'src', 'farm', 'index.js');
export const SNAPSHOT = path.join(REPO, 'public', 'src', 'supplychain', 'flux.snapshot.js');

/* Other sessions check index.html out as CRLF (memory: git-eol-crlf-trap). Hash and
   slice the LF form or the drift gate goes red with no code change. */
const lf = (s) => s.replace(/\r\n?/g, '\n');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* Cut one top-level declaration out by SYMBOL. Anchored at column zero so a mention in a
   comment cannot match; the end is the first line that leaves a slice which PARSES on its
   own (gen-fixture.mjs learned the hard way that "first closing bracket" over-reads).
   Exported: proposal-gate.mjs slices _opEcon and friends with the same cutter. */
export function sliceDecl(src, kind, name) {
  const head = kind === 'function' ? '^function ' + name + '\\(' : '^const ' + name + '\\s*= ';   // \s*: index.html column-aligns some declarations
  const m = new RegExp(head, 'm').exec(src);
  if (!m) throw new Error('slice: "' + kind + ' ' + name + '" not found at column 0');
  const ends = kind === 'function' ? /^\}[ \t]*$/ : /;[ \t]*(\/\/.*)?$/;
  let at = m.index, lines = 0;
  while (at < src.length && lines < 6000) {
    let nl = src.indexOf('\n', at); if (nl < 0) nl = src.length;
    const line = src.slice(at, nl);
    if (ends.test(line)) {
      const code = src.slice(m.index, nl);
      try { new Function(code); return code; } catch (e) { /* not a complete statement yet */ }
    }
    at = nl + 1; lines++;
  }
  throw new Error('slice: ' + name + ' never closes into a parseable statement');
}

export function readIndex() { return lf(fs.readFileSync(INDEX, 'utf8')); }

export function lootSources(html) {
  return {
    salvageRes: sliceDecl(html, 'const', 'SALVAGE_RES'),
    lootIds: sliceDecl(html, 'const', 'LOOT_RES_IDS'),
    rollUnit: sliceDecl(html, 'function', '_rollUnitSalvage'),
    structTbl: sliceDecl(html, 'const', 'STRUCTURE_SALVAGE'),
    structOrder: sliceDecl(html, 'const', 'STRUCTURE_ORDER'),
    rollStruct: sliceDecl(html, 'function', '_rollStructureSalvage'),
  };
}

/* The assumed casualty mix. [weight, unit]. Weights sum to 1. */
export const PANEL = [
  [0.45, { rarity: 'common', type: 'beast', level: 1 }],
  [0.25, { rarity: 'common', type: 'mech drone', level: 1 }],
  [0.15, { rarity: 'common', type: 'undead shadow', level: 1 }],
  [0.10, { rarity: 'uncommon', type: 'beast', level: 1 }],
  [0.05, { rarity: 'rare', type: 'beast', level: 1 }],
];
export const ROLLS = 40000;
export const SEED = 0x5eed1234;

/* ⚠ The ORDER of rolls below is part of the output. It is round 2's measurement, move for
   move, so the overlay the round-2 critic verified byte-for-byte is still what ships.
   `SRC` may be a mutated copy (the gate feeds it one to prove the drift check can fail). */
export function measure(SRC) {
  let seed = SEED;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const fakeMath = Object.create(Math); fakeMath.random = rnd;
  const NL = '\n';
  /* THEMED run: the any-item pool is emptied, so what is left is exactly what a player can AIM for. */
  const Gt = new Function('Math', ['const SALVAGE_RES = [];', SRC.lootIds, SRC.rollUnit, 'return { _rollUnitSalvage };'].join(NL))(fakeMath);
  const G = new Function('Math', [SRC.salvageRes, SRC.lootIds, SRC.rollUnit, SRC.structTbl, SRC.structOrder, SRC.rollStruct,
    'return { SALVAGE_RES, LOOT_RES_IDS, _rollUnitSalvage, STRUCTURE_SALVAGE, STRUCTURE_ORDER, _rollStructureSalvage };'].join(NL))(fakeMath);
  const N = ROLLS;
  const body = {}; const ruin = {}; const full = {}; const ruinByKind = {};
  for (const [w, unit] of PANEL) {
    const acc = {}, accF = {};
    for (let i = 0; i < N; i++) { const d = Gt._rollUnitSalvage(unit); for (const k in d) acc[k] = (acc[k] || 0) + d[k]; }
    for (let i = 0; i < N; i++) { const d = G._rollUnitSalvage(unit); for (const k in d) accF[k] = (accF[k] || 0) + d[k]; }
    for (const k in acc) body[k] = (body[k] || 0) + w * acc[k] / N;
    for (const k in accF) full[k] = (full[k] || 0) + w * accF[k] / N;
  }
  const perHaulLottery = {}; for (const k in full) { const l = full[k] - (body[k] || 0); if (l > 1e-6) perHaulLottery[k] = +l.toFixed(5); }
  const kinds = Object.keys(G.STRUCTURE_SALVAGE);
  for (const kind of kinds) {
    const acc = {};
    for (let i = 0; i < N; i++) { const d = G._rollStructureSalvage(kind, rnd); for (const k in d) acc[k] = (acc[k] || 0) + d[k]; }
    ruinByKind[kind] = acc;
    for (const k in acc) ruin[k] = (ruin[k] || 0) + acc[k] / N / kinds.length;   // one haul = one ruin, of any kind
  }
  /* A player picks what to salvage, so an id is worth its BETTER haul kind. */
  const perHaul = {}; const from = {};
  for (const k of new Set([...Object.keys(body), ...Object.keys(ruin)])) {
    const b = body[k] || 0, r = ruin[k] || 0;
    perHaul[k] = +(Math.max(b, r)).toFixed(5); from[k] = b >= r ? 'body' : 'ruin';
  }
  /* IN BATTLES. A battle seats one ruin of each kind in STRUCTURE_ORDER, so a fully looted
     battle gives the SUM over those kinds — five hauls that happen together, not in a queue. */
  const order = G.STRUCTURE_ORDER.filter((k) => G.STRUCTURE_SALVAGE[k]);
  const perBattleRuins = {}; const ruinKindOf = {};
  for (const kind of order) for (const k in ruinByKind[kind]) {
    perBattleRuins[k] = (perBattleRuins[k] || 0) + ruinByKind[kind][k] / N;
    (ruinKindOf[k] = ruinKindOf[k] || []).push(kind);
  }
  for (const k in perBattleRuins) perBattleRuins[k] = +perBattleRuins[k].toFixed(4);
  const exotic = G.SALVAGE_RES.filter((r) => r && r.id && !G.LOOT_RES_IDS.includes(r.id)).length;
  return { perHaul, perHaulLottery, from, perBattleRuins, ruinKindOf, ruinsPerBattle: order.length, ruinKinds: order,
    exoticPoolSize: exotic, tables: { structureSalvage: G.STRUCTURE_SALVAGE, lootResIds: G.LOOT_RES_IDS } };
}

/* 🐄 THE HOMESTEAD FARM, read not rolled: FARM_ECON is a rate table, so the honest figure is
   arithmetic on it. "One animal" is the unit because a herd size would be another guess —
   the memo can then say "this need is N animals' work" and the owner can judge it.
     living yield   yieldsPerH[sp][id]                      per adult per FED hour, full health
     meat / hide    slaughter[sp][id] / animals[sp].growH   one adult raised and butchered, balanced cut, butcher L1
     livestock      1 / growH                               one adult raised and crated
   Feed, purchase price and deaths are NOT netted off; this is a ceiling for one pen slot. */
export function farmRates(farmSrc) {
  const code = sliceDecl(farmSrc, 'const', 'FARM_ECON');
  const F = new Function(code + '\nreturn FARM_ECON;')();
  const best = {};
  const offer = (id, v, unit, how) => { if (v > 0 && (!best[id] || v > best[id].perUnitHour)) best[id] = { perUnitHour: +v.toFixed(4), unit, how }; };
  for (const sp of Object.keys(F.yieldsPerH || {})) for (const id of Object.keys(F.yieldsPerH[sp])) offer(id, F.yieldsPerH[sp][id], sp, 'alive, per fed hour');
  for (const sp of Object.keys(F.slaughter || {})) {
    const g = +((F.animals || {})[sp] || {}).growH; if (!(g > 0)) continue;
    for (const id of Object.keys(F.slaughter[sp])) offer(id, F.slaughter[sp][id] / g, sp, 'raised to adult and butchered');
  }
  /* Only breeding stock is crated for trade; guard animals have no breedChancePerH row. */
  for (const sp of Object.keys(F.breedChancePerH || {})) { const g = +((F.animals || {})[sp] || {}).growH; if (g > 0) offer('livestock', 1 / g, sp, 'raised to adult and crated'); }
  const sorted = {}; for (const id of Object.keys(best).sort()) sorted[id] = best[id];
  return { code, rates: sorted };
}

/* `over` lets the gate inject mutated sources: { SRC, farmSrc }. */
export async function build(over) {
  const SRC = (over && over.SRC) || lootSources(readIndex());
  const m = measure(SRC);
  const farm = farmRates((over && over.farmSrc) || lf(fs.readFileSync(FARM, 'utf8')));
  /* The signature is computed by proposal.js's own function so the browser (bridge tables)
     and this generator can never disagree about how it is made. */
  /* proposal.js imports the snapshot and this needs proposal.js: on a first run (or after the
     file was deleted) seat an empty snapshot so the import resolves. `null` means "no flux",
     which proposal.js already treats as "refuse to guess". */
  if (!fs.existsSync(SNAPSHOT)) fs.writeFileSync(SNAPSHOT, 'export const FLUX = null;\nexport default FLUX;\n');
  const { tableSignature } = await import(pathToFileURL(path.join(REPO, 'public', 'src', 'supplychain', 'proposal.js')).href);
  const sourceHash = sha(Object.keys(SRC).sort().map((k) => SRC[k]).join('\n \n') + '\n \n' + farm.code);
  const tables = m.tables; delete m.tables;
  return Object.assign({
    _readme: 'GENERATED by tools/supplychain/gen-flux.mjs. Units of each resource per salvage haul, measured by rolling the real drop code.',
    sourceHash,
    tableSignature: tableSignature(tables.structureSalvage, tables.lootResIds),
    measuredFrom: '_rollUnitSalvage + _rollStructureSalvage sliced from public/index.html, ' + ROLLS + ' rolls each, seeded',
    rolls: ROLLS, seed: SEED,
    panel: PANEL.map(([w, u]) => w + ' ' + u.rarity + ' ' + u.type),
    assumed: ['panel (who dies in an ordinary battle; no bosses, all level 1)', 'every ruin in a battle gets looted'],
    notMeasured: ['Cracking Yard output (diesel, naphtha, kerosene): no per-hour table exists to read', 'roguelite hauls, territory nodes, fishing trips: sized at the thinnest measured themed drop'],
  }, m, { minigame: { source: 'FARM_ECON, public/src/farm/index.js', unitIs: 'one animal, fed, full health; feed and purchase cost not netted off', perUnitHour: farm.rates } });
}

export const text = (flux) =>
  '/* GENERATED by tools/supplychain/gen-flux.mjs — DO NOT EDIT BY HAND.\n' +
  '   Drop flux measured by rolling the real _rollUnitSalvage / _rollStructureSalvage out of\n' +
  '   public/index.html with a seeded PRNG, plus the Homestead Farm rate table. proposal.js sizes\n' +
  '   every battle-loot need against this. No timestamp on purpose: a second run must produce this\n' +
  '   exact file, so a diff here always means the loot tables (or the roll code) really moved.\n' +
  '   Stale? `node tools/supplychain/gen-flux.mjs --check` says so, and proposal-gate.mjs runs it. */\n' +
  'export const FLUX = ' + JSON.stringify(flux, null, 1) + ';\nexport default FLUX;\n';

export function readSnapshotText() { try { return lf(fs.readFileSync(SNAPSHOT, 'utf8')); } catch (e) { return null; } }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fresh = text(await build());
  const prev = readSnapshotText();
  if (process.argv[2] === '--check') {
    if (prev === fresh) { console.log('gen-flux --check: ok — snapshot matches the loot code in public/index.html'); process.exit(0); }
    console.error('gen-flux --check: STALE — the loot tables, the roll code or FARM_ECON moved since flux.snapshot.js was generated.');
    console.error('Every battle-loot appetite in the proposal overlay is sized from that file. Re-run: node tools/supplychain/gen-flux.mjs');
    process.exit(1);
  }
  if (prev === fresh) { console.log('gen-flux: unchanged'); process.exit(0); }
  fs.writeFileSync(SNAPSHOT, fresh);
  console.log('gen-flux: wrote ' + path.relative(REPO, SNAPSHOT) + ' (' + fresh.length + ' bytes)');
}
