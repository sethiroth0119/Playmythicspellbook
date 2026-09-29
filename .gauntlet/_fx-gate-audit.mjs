#!/usr/bin/env node
/* 🔎 THE AUDIT THE FIRST ROUND WAS MISSING.
   Left side: what the ENGINE reads, per effect (_fx-engine-needs.mjs — never
   ONPLAY_TYPES[].needs). Right side: what the GATE would show, per effect
   (needs + FX_GATE_NEEDS_PATCH, mapped through FX_GATE_FIELDS).
   Prints every field the engine reads that the gate would hide. That list must
   be empty; anything on it is a knob an author cannot reach. */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/* 🔴 Same hardcoded-D: breakage as _fx-engine-needs.mjs — see the comment
   there. This one is worse if it goes unnoticed, because it SPAWNS that script
   with ROOT as argv[2]: a wrong root here propagates into the child and both
   halves fail for a reason that has nothing to do with the effects they audit. */
const ROOT = process.argv[2] || path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const eng = JSON.parse(execFileSync(process.execPath,
  [path.join(ROOT, '.gauntlet/_fx-engine-needs.mjs'), ROOT, '--json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const SRC = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

// needs, per catalogue entry
const catStart = SRC.indexOf('const ONPLAY_TYPES = [');
const CAT = SRC.slice(catStart, SRC.indexOf('\n];', catStart));
const needs = {};
for (const m of CAT.matchAll(/\{\s*id:\s*'([A-Za-z0-9_]+)'[\s\S]*?\}/g)) {
  const nm = /needs:\s*\[([^\]]*)\]/.exec(m[0]);
  needs[m[1]] = nm ? [...nm[1].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]) : [];
}
// the patch
const pStart = SRC.indexOf('const FX_GATE_NEEDS_PATCH = {');
const patchSrc = SRC.slice(pStart, SRC.indexOf('\n};', pStart));
const patch = {};
for (const m of patchSrc.matchAll(/([A-Za-z0-9_]+):\s*\[([^\]]*)\]/g)) {
  patch[m[1]] = [...m[2].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]);
}

const GF = eng.gateFields;
let bad = 0, effBad = 0;
const rows = [];
for (const id of Object.keys(eng.req)) {
  const tok = new Set([...(needs[id] || []), ...(patch[id] || [])]);
  const miss = eng.req[id].filter(suf => !(GF[suf] || []).some(t => tok.has(t)));
  if (miss.length) { effBad++; bad += miss.length; rows.push([id, miss, eng.reqKeys[id]]); }
}
console.log(`engine-required fields the gate would HIDE: ${bad} fields across ${effBad} of ${Object.keys(eng.req).length} effects`);
for (const [id, miss, keys] of rows) {
  const tokens = [...new Set(miss.flatMap(s => GF[s] || []))];
  console.log(`  ${id.padEnd(20)} hides ${miss.join(',')}   -> add tokens ${tokens.join(',')}`);
}
if (rows.length) {
  console.log('\nsuggested FX_GATE_NEEDS_PATCH additions:');
  for (const [id, miss] of rows) {
    const tokens = [...new Set(miss.flatMap(s => GF[s] || []))];
    console.log(`  ${id}: [${tokens.map(t => `'${t}'`).join(', ')}],`);
  }
}
/* ── a SECOND, independent source, printed but not failed: the card-text
   generator. _describeOnPlayEffectBody switches on eff.type and prints values
   per case, so it is a different author's opinion of which knobs each effect
   uses. Anything it prints that the gate hides is worth a look — the author
   reads that sentence back on the card. */
const tStart = SRC.indexOf('function _describeOnPlayEffectBody');
const tEnd = SRC.indexOf('\n}\n', SRC.indexOf('switch (eff.type)', tStart));
const tBody = SRC.slice(tStart, tEnd);
const swAt = tBody.indexOf('switch (eff.type)');
const cs = [...tBody.slice(swAt).matchAll(/case '([A-Za-z0-9_]+)':/g)];
const textHits = [];
for (let i = 0; i < cs.length; i++) {
  const seg = tBody.slice(swAt + cs[i].index, swAt + (i + 1 < cs.length ? cs[i + 1].index : tBody.length));
  const id = cs[i][1];
  if (!eng.req[id]) continue;                       // not a pickable effect
  const tok = new Set([...(needs[id] || []), ...(patch[id] || [])]);
  const miss = [];
  for (const k of new Set([...seg.matchAll(/eff\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))) {
    const sufs = (eng.keyToFields[k] || []).filter(x => GF[x]);
    if (sufs.length && !sufs.some(x => (GF[x] || []).some(t => tok.has(t)))) miss.push(k);
  }
  if (miss.length) textHits.push([id, miss]);
}
console.log('\ncard text vs the gate (informational): '
  + (textHits.length ? textHits.map(([id, m]) => id + ' prints ' + m.join(',')).join('; ') : 'nothing printed is hidden'));
if (textHits.length) {
  console.log('  ⚠ proliferate is the known one and it is a TEXT bug, not a gate bug: the');
  console.log('    engine at 112240 adds exactly +1 turn to every status on the board and');
  console.log('    reads neither amount nor radius, while the sentence promises "units');
  console.log('    within R tiles by N turns". Showing those boxes would put two knobs on');
  console.log('    screen that do nothing. Reported here rather than papered over.');
}
process.exit(bad ? 1 : 0);
