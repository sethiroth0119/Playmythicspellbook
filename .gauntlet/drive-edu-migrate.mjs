/* ══════════════════════════════════════════════════════════════════════════
   🎓 DRIVE-EDU-MIGRATE — does a city saved before the schools round survive?

   /src/demographics/pipeline.js load() DROPS a cohort whose education rung
   this build does not name. That rule is correct for a DELETED zone — a
   retune must not resurrect one through a save file — but the education
   ladder was RENAMED by the schools round, and `none` and `school` are the two
   heaviest weights in every archetype. Dropped, a returning player loads their
   city and most of the population is gone, with the panel, the ledger and the
   audit all agreeing about the smaller number.

   WHAT IS ASSERTED:
     1  NOBODY IS LOST — a legacy save round-trips with its full household count.
     2  THE LABOUR BAND IS PRESERVED — a resident who could hold skilled work
        before still can. That is the invariant the map is built on; matching
        names would be a weaker and wrong-er promise.
     3  NOBODY IS PROMOTED — `school` maps to the FIRST skilled rung (`middle`),
        not `high`. Mapping up a rung would hand every returning city a free
        education, which is a balance change nobody chose.
     4  CONTROL — AN ID IN NEITHER LADDER IS STILL DROPPED. Without this the
        migration is just a hole in the validation, and the round0-class rule it
        was protecting is gone. This is the check that separates "migrate the
        rungs we renamed" from "accept anything".

   Run:  node .gauntlet/drive-edu-migrate.mjs
   ══════════════════════════════════════════════════════════════════════════ */
if (!global.window) global.window = {};

const P = await import('../public/src/demographics/pipeline.js');
const A = await import('../public/src/demographics/archetypes.js');
const Z = await import('../public/src/demographics/zones.js');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

const zone = Z.zoneIds()[0];
const arch = A.archetypeIds().includes('single') ? 'single' : A.archetypeIds()[0];
console.log('using zone=' + zone + ' arch=' + arch);

/* A save exactly as the previous build wrote one: the four old rungs. */
const legacy = {
  co: {
    [zone + '|' + arch + '|none']: 10,
    [zone + '|' + arch + '|school']: 25,
    [zone + '|' + arch + '|college']: 7,
    [zone + '|' + arch + '|university']: 3,
  },
  stress: { none: 0.2, school: 0.4 },
  rent: 1.1, seeded: true,
};
const legacyTotal = Object.values(legacy.co).reduce((s, v) => s + v, 0);

console.log('\n1. a legacy save loads without losing anybody');
P.load(JSON.parse(JSON.stringify(legacy)));
const st = P.state();
const co = st.co || {};
const total = Object.values(co).reduce((s, v) => s + v, 0);
console.log('   restored: ' + JSON.stringify(co));
ok('every household survived the load', Math.abs(total - legacyTotal) < 1e-9,
   legacyTotal + ' saved -> ' + total + ' restored');
ok('no cohort is keyed on a rung this build does not have',
   Object.keys(co).every((k) => A.eduOrder().includes(P.parseKey(k).edu)),
   Object.keys(co).join(' '));

console.log('\n2. the labour band is preserved, rung for rung');
const bandCount = (m) => {
  const out = {};
  for (const k in m) {
    const e = P.parseKey(k).edu;
    const b = A.eduOrder().includes(e) ? A.bandOf(e) : ('legacy:' + e);
    out[b] = (out[b] || 0) + m[k];
  }
  return out;
};
/* The old ladder's bands, written out — this is what the previous build would
   have reported for the same save. */
const OLD_BAND = { none: 'unskilled', school: 'skilled', college: 'technical', university: 'advanced' };
const before = {};
for (const k in legacy.co) { const b = OLD_BAND[P.parseKey(k).edu]; before[b] = (before[b] || 0) + legacy.co[k]; }
const after = bandCount(co);
console.log('   before ' + JSON.stringify(before));
console.log('   after  ' + JSON.stringify(after));
for (const b of Object.keys(before)) {
  ok('  ' + b + ' households are unchanged', Math.abs((after[b] || 0) - before[b]) < 1e-9,
     before[b] + ' -> ' + (after[b] || 0));
}

console.log('\n3. nobody was promoted');
const skilledRung = Object.keys(co).map((k) => P.parseKey(k).edu).filter((e) => A.bandOf(e) === 'skilled');
ok('the old `school` cohort landed on `middle`, the FIRST skilled rung',
   skilledRung.length === 1 && skilledRung[0] === 'middle', skilledRung.join(','));
ok('...and not on `high`', !skilledRung.includes('high'));

console.log('\n4. CONTROL — an id in neither ladder is still dropped');
P.load({ co: {
  [zone + '|' + arch + '|school']: 12,          // legacy, must survive
  [zone + '|' + arch + '|wizard']: 99,          // never existed, must not
  [zone + '|' + arch + '|none']: 5,             // legacy, must survive
}, seeded: true });
const c2 = P.state().co || {};
const t2 = Object.values(c2).reduce((s, v) => s + v, 0);
console.log('   restored: ' + JSON.stringify(c2));
ok('the invented rung was dropped', t2 === 17, 'expected 17 (12 + 5), got ' + t2);
ok('...and it left no key behind',
   !Object.keys(c2).some((k) => P.parseKey(k).edu === 'wizard'), Object.keys(c2).join(' '));

console.log('\n5. a CURRENT save still round-trips untouched');
P.load({ co: { [zone + '|' + arch + '|university']: 4, [zone + '|' + arch + '|guru']: 6 }, seeded: true });
const c3 = P.state().co || {};
ok('current rungs load unchanged',
   Math.abs(Object.values(c3).reduce((s, v) => s + v, 0) - 10) < 1e-9, JSON.stringify(c3));

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
