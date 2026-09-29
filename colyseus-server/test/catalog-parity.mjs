#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// catalog-parity.mjs — the FIRST parity test of the shared-engine effort.
// Diffs the server's HAND-MIRRORED catalogs (dist/engine/catalogs.js, built from
// catalogs.ts) against the GENERATED catalogs (catalogs.gen.json, extracted from
// the live client index.html). Proves the server's data matches the client — or
// surfaces exactly where it has drifted.
//
//   npm run build && node test/catalog-parity.mjs
//
// Exit 0 = no drift on the fields the server models. Exit 1 = drift found.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const hand = require(join(__dirname, '..', 'dist', 'engine', 'catalogs.js'));
const gen = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'engine', 'catalogs.gen.json'), 'utf8'));

let problems = 0;
const note = (m) => { console.log('  ✗ ' + m); problems++; };

function diffDict(label, handDict, genDict, compareFields) {
  console.log('\n• ' + label);
  const handKeys = new Set(Object.keys(handDict || {}));
  const genKeys = new Set(Object.keys(genDict || {}));

  // Entries the server hand-mirrors that the live client NO LONGER has → real drift.
  const stale = [...handKeys].filter((k) => !genKeys.has(k));
  if (stale.length) note('hand-mirror has ' + stale.length + ' entr(ies) absent from the client: ' + stale.join(', '));

  // Entries the client has that the server doesn't model → informational gap.
  const missing = [...genKeys].filter((k) => !handKeys.has(k));
  if (missing.length) console.log('  · ' + missing.length + ' client entr(ies) not modelled server-side (ok for now): ' + missing.slice(0, 12).join(', ') + (missing.length > 12 ? ' …' : ''));

  // Shared entries: compare the fields the server actually reads.
  let valueDrift = 0;
  for (const k of [...handKeys].filter((x) => genKeys.has(x))) {
    const h = handDict[k] || {}, g = genDict[k] || {};
    for (const f of compareFields) {
      if (h[f] === undefined) continue;            // server doesn't model this field for this entry
      const hv = JSON.stringify(h[f]), gv = JSON.stringify(g[f]);
      if (hv !== gv) { note(`${k}.${f}: hand=${hv} client=${gv}`); valueDrift++; }
    }
  }
  console.log('  ' + (stale.length || valueDrift ? '✗' : '✓') + ' ' + handKeys.size + ' modelled, ' + ([...handKeys].filter((x)=>genKeys.has(x)).length) + ' shared, ' + valueDrift + ' value-drift');
}

console.log('═══ Catalog parity: server hand-mirror  vs  generated-from-client ═══');

diffDict('STATUS_EFFECTS', hand.STATUS_EFFECTS, gen.STATUS_EFFECTS,
  ['id', 'name', 'dmgMin', 'dmgMax', 'when', 'escalating', 'atkMod', 'magMod', 'defMod', 'resMod', 'spdMod', 'accMod', 'dodgeChance']);

diffDict('PASSIVES', hand.PASSIVES, gen.PASSIVES,
  ['id', 'name']);

// Type chart: the server computes getTypeMultiplier(); spot-check it against the
// generated TYPE_CHART for every element pair.
if (typeof hand.getTypeMultiplier === 'function') {
  console.log('\n• TYPE_CHART (getTypeMultiplier vs generated)');
  let tcDrift = 0, pairs = 0;
  for (const a of gen.ELEMENTS) for (const d of gen.ELEMENTS) {
    pairs++;
    const want = gen.TYPE_CHART[a][d];
    const got = hand.getTypeMultiplier(a, d);
    if (want !== got) { note(`${a}->${d}: hand=${got} generated=${want}`); tcDrift++; }
  }
  console.log('  ' + (tcDrift ? '✗' : '✓') + ' ' + pairs + ' element pairs, ' + tcDrift + ' drift');
}

console.log('\n' + (problems ? '✗ ' + problems + ' parity problem(s) found.' : '✓ ALL PARITY CHECKS PASS — server data matches the live client.'));
process.exit(problems ? 1 : 0);
