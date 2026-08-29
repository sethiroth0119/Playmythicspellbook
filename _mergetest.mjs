#!/usr/bin/env node
// ============================================================================
// 🧪 CAMP / RESEARCH / BUNKHOUSE CLOUD-MERGE TEST
// ----------------------------------------------------------------------------
// _syncaudit.mjs proves a field is NAMED in both halves of the sync. It cannot
// prove the merge is correct, and for these fields "correct" is not one rule:
//
//   • Clocks take MAX. An earlier campLastTick is not a harmless stale read —
//     it re-charges upkeep for a window the player already paid, and an earlier
//     campRaidLastTick re-fires a raid that already happened.
//   • memorial unions (append-only, a death on either device is real).
//   • campMissing must NOT union — MIA entries are removed on rescue, so a
//     union resurrects survivors who already came home.
//   • research never un-completes and never cancels a running project.
//   • bunkhouse never un-builds, and its collect clock takes MAX so the same
//     billet payout cannot be claimed twice by hopping devices.
//
// Getting any of those backwards costs a player real progression and would
// never show up in a one-device test. So rather than re-implementing the merge
// here (which would only test the copy), this EXTRACTS THE REAL BLOCK out of
// public/index.html and runs it. If someone edits the merge, this tests the
// edit.
//
// Run:  node _mergetest.mjs
// ============================================================================

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lines = readFileSync('public/index.html', 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('CAMP LIVE STATE — the other half'));
if (start < 0) throw new Error('could not find the camp hydration block in public/index.html');
let end = lines.findIndex((l, i) => i > start && l.includes('built: ((_lb && _lb.built) || _cb.built)'));
if (end < 0) throw new Error('could not find the end of the camp hydration block');
while (!lines[end].trim().startsWith('}')) end++;

const mod = join(tmpdir(), `mythic-hydrate-${process.pid}.mjs`);
writeFileSync(mod, `export function hydrate(Profile, f) {\n${lines.slice(start, end + 1).join('\n')}\n return Profile;\n}\n`);
const { hydrate } = await import('file://' + mod);
unlinkSync(mod);
console.log(`🧪 testing public/index.html:${start + 1}-${end + 1} (the real merge block)\n`);

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ✅ ' : '  ❌ ') + name);
  if (ok) pass++; else { fail++; console.log(`       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
};

console.log('── The case this exists for: fresh device, empty local, full cloud ──');
{
  const P = {};
  hydrate(P, {
    __campDefense__: 4, __campLastTick__: 1000, __campRaidLastTick__: 900,
    __campPoweredUntil__: 5000, __campRepairUntil__: 4000,
    __campMissing__: [{ refId: 'a', name: 'Ree', ts: 10 }],
    __memorial__: [{ name: 'Kel', ts: 5, cause: 'Turned' }],
    __campRival__: { name: 'Vex', threat: 40 },
    __campConsumeFrac__: { food: 0.4 }, __campTrickleFrac__: { water: 0.2 },
    __research__: { completed: { optics: 2 }, active: { id: 'armor' } },
    __bunkhouse__: { built: 1, house: { billets: 3, lastAt: 700, lastCollect: 650 } },
  });
  t('fortify level restored', P.campDefense, 4);
  t('upkeep clock restored', P.campLastTick, 1000);
  t('overclock window restored', P.campPoweredUntil, 5000);
  t('MIA roster restored', P.campMissing.length, 1);
  t('memorial restored', P.memorial.length, 1);
  t('rival restored', P.campRival.name, 'Vex');
  t('carry fractions restored', P.campConsumeFrac.food, 0.4);
  t('research levels restored', P.research.completed.optics, 2);
  t('active research restored', P.research.active.id, 'armor');
  t('bunkhouse restored as built', P.bunkhouse.built, 1);
  t('bunkhouse billets restored', P.bunkhouse.house.billets, 3);
}

console.log('\n── Clocks: a stale cloud row must not re-charge upkeep or re-fire a raid ──');
{
  const P = { campLastTick: 9000, campRaidLastTick: 8000, campPoweredUntil: 9500, campRepairUntil: 9400, campDefense: 7 };
  hydrate(P, { __campLastTick__: 100, __campRaidLastTick__: 90, __campPoweredUntil__: 200, __campRepairUntil__: 150, __campDefense__: 2 });
  t('upkeep clock keeps the later', P.campLastTick, 9000);
  t('raid clock keeps the later', P.campRaidLastTick, 8000);
  t('overclock keeps the longer window', P.campPoweredUntil, 9500);
  t('repair keeps the longer window', P.campRepairUntil, 9400);
  t('fortify level never lowered', P.campDefense, 7);
}
{
  const P = { campLastTick: 100, campDefense: 1 };
  hydrate(P, { __campLastTick__: 9000, __campDefense__: 6 });
  t('cloud wins when the cloud is later', P.campLastTick, 9000);
  t('cloud wins when the cloud is higher', P.campDefense, 6);
}

console.log('\n── memorial unions; campMissing must not (rescued survivors stay home) ──');
{
  const P = { memorial: [{ name: 'Kel', ts: 5 }, { name: 'Ada', ts: 7 }] };
  hydrate(P, { __memorial__: [{ name: 'Kel', ts: 5 }, { name: 'Bo', ts: 6 }] });
  t('union with no duplicate Kel', P.memorial.map(e => e.name), ['Kel', 'Bo', 'Ada']);
}
{
  const P = { campMissing: [] };
  hydrate(P, { __campMissing__: [{ refId: 'a', name: 'Ree' }] });
  t('empty roster seeds from the cloud', P.campMissing.length, 1);
}
{
  const P = { campMissing: [{ refId: 'z', name: 'Sol' }] };
  hydrate(P, { __campMissing__: [{ refId: 'a', name: 'Ree' }] });
  t('an active roster is NOT overwritten', P.campMissing.map(e => e.name), ['Sol']);
}

console.log('\n── research: never un-complete, never cancel a running project ──');
{
  const P = { research: { completed: { optics: 3 }, active: { id: 'armor' } } };
  hydrate(P, { __research__: { completed: { optics: 1, hydro: 2 }, active: { id: 'other' } } });
  t('local higher level kept', P.research.completed.optics, 3);
  t('cloud-only project added', P.research.completed.hydro, 2);
  t('running project untouched', P.research.active.id, 'armor');
}

console.log('\n── bunkhouse: never un-build, never allow a double collect ──');
{
  const P = { bunkhouse: { built: 1, house: { billets: 2, lastAt: 100, lastCollect: 90 } } };
  hydrate(P, { __bunkhouse__: { built: 0, house: { billets: 9, lastAt: 500, lastCollect: 480 } } });
  t('a stale cloud row cannot un-build', P.bunkhouse.built, 1);
  t('local house is kept', P.bunkhouse.house.billets, 2);
  t('lastCollect takes MAX', P.bunkhouse.house.lastCollect, 480);
  t('lastAt takes MAX', P.bunkhouse.house.lastAt, 500);
}
{
  const P = { bunkhouse: { built: 0, house: null } };
  hydrate(P, { __bunkhouse__: { built: 1, house: { billets: 4, lastAt: 10, lastCollect: 5 } } });
  t('cloud can build when local has not', P.bunkhouse.built, 1);
}

console.log('\n── Junk data must not throw or corrupt ──');
{
  const P = { campDefense: 3, memorial: [{ name: 'Kel', ts: 1 }] };
  hydrate(P, { __campDefense__: 'x', __memorial__: [null, 'nope', { name: 'Bo', ts: 2 }],
               __research__: { completed: null }, __bunkhouse__: { built: 1 } });
  t('a bad number is ignored', P.campDefense, 3);
  t('junk memorial entries are skipped', P.memorial.map(e => e.name), ['Kel', 'Bo']);
  t('a null completed map is tolerated', typeof P.research.completed, 'object');
  t('a houseless bunkhouse is fine', P.bunkhouse.house, null);
}
{
  const P = {};
  hydrate(P, {});   // a cloud row written before these keys existed
  t('an empty forge is a no-op', Object.keys(P).length, 0);
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
