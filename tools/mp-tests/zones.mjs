#!/usr/bin/env node
/* 🏘 ZONE GRADES ↔ RESEARCH — the two halves that have to agree.

   A residential grade is TWO records in TWO files: a ZONES entry that says how
   the land develops, and a research node that says what unlocks it. Neither
   file imports the other, so a grade added to one and not the other is a zone
   nobody can reach or a research node that unlocks nothing — and both look
   completely fine in their own file.

   ⚠ arch IS NOT FREE TEXT. housingSeed() hands it to seeder.surrogate(), which
     searches for seed coordinates whose district roll lands on that archetype.
     An arch makeHousing cannot produce is a search that never succeeds, and the
     zone silently develops as whatever the unsteered roll gives — a zone that
     looks wired and is not. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* ⚠ SKIP, DO NOT THROW, ON A MISSING INPUT. A module mutation runs in a mirror
   holding only tools/mp-tests plus the one mutated file. Crashing on an absent
   file reddens the run for the wrong reason and scores the mutation "proven"
   while proving nothing — the false proof this runner documents twice. The
   tell is a red mutation reporting 0 findings, which is what this file did
   before the guard went in. */
let zonesSrc = '';
try { zonesSrc = readFileSync(join(ROOT, 'public/src/zoning/zones.js'), 'utf8').replace(/\r\n/g, '\n'); } catch (e) {}
const treeSrc = readFileSync(join(ROOT, 'public/src/progression/tree.js'), 'utf8').replace(/\r\n/g, '\n');
let citySrc = '';
try { citySrc = readFileSync(join(ROOT, 'public/node-city/index.html'), 'utf8').replace(/\r\n/g, '\n'); } catch (e) {}

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (d ? '  — ' + d : '')); } };

/* Parse the two tables out of source rather than importing: zones.js pulls in
   the rest of the module graph, and this check must run on the files alone. */
const zones = [...zonesSrc.matchAll(/\{ id: '(\w+)',\s*cat: '(\w+)'[\s\S]{0,400}?arch: '(\w+)', lvl: (\d+)/g)]
  .map((m) => ({ id: m[1], cat: m[2], arch: m[3], lvl: +m[4] }));
const res = zones.filter((z) => z.cat === 'res');

console.log('\n── residential grades ──');
console.log('  ' + res.map((z) => z.id + '(' + z.arch + ' L' + z.lvl + ')').join('  '));

if (zonesSrc) ok('the new grades exist', res.some((z) => z.id === 'r_mansion') && res.some((z) => z.id === 'r_condo'));
if (zonesSrc) ok('mansions are the low-density form', (res.find((z) => z.id === 'r_mansion') || {}).arch === 'detached');
if (zonesSrc) ok('no duplicate zone ids', new Set(zones.map((z) => z.id)).size === zones.length);

/* Every arch must be one makeHousing's own bags can actually produce. */
const bags = [...citySrc.matchAll(/^\s*(?:terrace|blocks|suburb|lanes):\s*\[([^\]]+)\]/gm)]
  .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
const known = new Set(bags);
if (known.size) {
  console.log('  archetypes makeHousing can produce: ' + [...known].sort().join(', '));
  for (const z of res) ok('“' + z.id + '” asks for a real archetype (' + z.arch + ')', known.has(z.arch));
}

/* MAX_LVL is the ceiling; a zone asking past it silently never reaches its form. */
const maxLvl = +((citySrc.match(/const MAX_LVL = (\d+)/) || [])[1] || 3);
ok('no zone asks for a level past MAX_LVL (' + maxLvl + ')', res.every((z) => z.lvl <= maxLvl),
   res.filter((z) => z.lvl > maxLvl).map((z) => z.id).join(','));

/* Both halves agree: every researched zone exists, and every grade is reachable. */
console.log('\n── research ↔ zones ──');
const researched = [...treeSrc.matchAll(/zones: \[([^\]]+)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
/* ⚠ A SEPARATE, LOOSER PARSE FOR THE EXISTENCE CHECK. The strict parse above
   requires arch+lvl so it can reason about residential FORM; commercial,
   industrial and the grandfather zone do not carry those in that shape, so
   reusing it here reported seven real zones as ghosts. The check was wrong,
   not the data. */
const zoneIds = new Set([...zonesSrc.matchAll(/\{ id: '(\w+)',\s*cat: '/g)].map((m) => m[1]));
const ghosts = researched.filter((id) => !zoneIds.has(id));
if (zonesSrc) ok('every researched zone id is a real zone', ghosts.length === 0, ghosts.join(','));

const unreachable = res.filter((z) => !researched.includes(z.id) && z.id !== 'r_asbuilt');
if (zonesSrc) ok('every residential grade is reachable by research', unreachable.length === 0, unreachable.map((z) => z.id).join(','));

ok('Mansions node unlocks r_mansion', /id: 'res_mansion'[\s\S]{0,400}?zones: \['r_mansion'\]/.test(treeSrc));
ok('Condominiums node unlocks r_condo', /id: 'res_condo'[\s\S]{0,400}?zones: \['r_condo'\]/.test(treeSrc));

/* The tree is hand-placed: two nodes on one slot draw on top of each other. */
const slots = [...treeSrc.matchAll(/cat: '(\w+)', row: (\d+), col: (\d+)/g)].map((m) => m[1] + ':' + m[2] + ',' + m[3]);
const dupSlot = slots.filter((s, i) => slots.indexOf(s) !== i);
ok('no two research nodes share a grid slot', dupSlot.length === 0, dupSlot.join(' '));

/* Every req must name a node that exists, or the branch is unreachable. */
const ids = new Set([...treeSrc.matchAll(/\{ id: '(\w+)', cat:/g)].map((m) => m[1]));
const reqs = [...treeSrc.matchAll(/req: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
const badReq = [...new Set(reqs.filter((r) => !ids.has(r)))];
ok('every research prerequisite exists', badReq.length === 0, badReq.join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
