/* ══════════════════════════════════════════════════════════════════════════
   🏙 DRIVE-MEMBERCITIES-FETCH — EXECUTE _corpMemberCitiesFetch(), don't parse it.

   _synckcheck.mjs proves index.html PARSES. It says nothing about whether the
   bridge fetch turns a city_profiles page into rows a screen can trust, and the
   two claims that matter here are both runtime ones:
     · exactly one entry per ROSTER row, whatever the query returned — including
       when the query returned nothing at all, or fewer rows than there are
       members (RLS), or two rows for one member (local-city + a real node);
     · no NaN and no coerced 0 — a null population must arrive as null so the
       screen can print an em dash instead of a number nobody wrote.

   So the function is lifted out of the shipped index.html by brace matching and
   run against fake PostgREST clients. Nothing here is a copy of the function.

   Run:  node .gauntlet/drive-membercities-fetch.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const IDX = path.resolve(process.cwd(), 'public/index.html');
const SRC = fs.readFileSync(IDX, 'utf8');

/* Brace-match the shipped function out of the file. Starting the scan at the
   first `{` AFTER the signature keeps the `{` of the arg list out of the depth
   count, which is what makes this work on an async function with destructuring
   further down the file. */
function fnAt(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return null;
  let i = src.indexOf('{', at + sig.length);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(at, j + 1); }
  }
  return null;
}

const FN = fnAt(SRC, 'async function _corpMemberCitiesFetch()');
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail == null ? '' : '   ' + detail));
};
console.log('\n0. the function was lifted out of the SHIPPED file');
ok('found _corpMemberCitiesFetch in public/index.html', !!FN, FN ? FN.length + ' chars' : 'NOT FOUND');
if (!FN) { console.log('\n❌ cannot continue'); process.exit(1); }

/* A fake PostgREST chain: .from().select().in().limit() → the seeded answer.
   `calls` records every hop so the "one query, not one per member" claim is
   measured rather than assumed. */
function fakeClient(answer, calls) {
  return {
    from(table) {
      calls.push({ table });
      const q = {
        select() { return q; },
        in(col, ids) { calls[calls.length - 1].col = col; calls[calls.length - 1].ids = ids; return q; },
        limit() { return Promise.resolve(answer()); },
      };
      return q;
    },
  };
}

async function run(roster, answer) {
  const calls = [];
  const Corp = { roster, memberCities: null, memberCitiesState: null };
  const Cloud = answer === null ? null : { client: fakeClient(answer, calls) };
  const f = new Function('Corp', 'Cloud', FN + '\nreturn _corpMemberCitiesFetch();');
  await f(Corp, Cloud);
  return { Corp, calls };
}

const ROSTER = [
  { userId: 'u-alpha', name: 'Alpha', role: 'founder' },
  { userId: 'u-bravo', name: 'Bravo', role: 'member' },
  { userId: 'u-charlie', name: 'Charlie', role: 'member' },
  { userId: 'u-delta', name: 'Delta', role: 'member' },
];

/* Deliberately hostile rows, all of them shapes the live table can actually
   produce: TWO cities for one owner (038 is unique on (owner_id,node_id) and
   the builder publishes 'local-city' as well as an owned node), a null
   population, a NaN that got into jsonb before cityTradePublish's finite guard,
   a blank city_name, and a member with no row at all. */
const ROWS = [
  { owner_id: 'u-alpha', node_id: 'local-city', city_name: 'Ashfall', population: 340,
    specializations: ['energy'], sells: { lumber: 4500.13, zincOre: 170 }, buys: { crudeOil: 5760, silica: 10 } },
  { owner_id: 'u-alpha', node_id: 'node-77', city_name: '   ', population: null,
    specializations: [], sells: { crudeOil: 12 }, buys: {} },
  { owner_id: 'u-bravo', node_id: 'local-city', city_name: 'Sausage', population: 224,
    specializations: [], sells: { ironOre: 595.57 }, buys: { silica: 10, limestone: 135 } },
  { owner_id: 'u-charlie', node_id: 'local-city', city_name: 'Nowhere', population: 4,
    specializations: null, sells: { gasoline: Number.NaN }, buys: null },
  // u-delta has no row at all.
];

/* ── 1. HAPPY PATH ──────────────────────────────────────────────────── */
console.log('\n1. a real page of city_profiles rows');
{
  const { Corp, calls } = await run(ROSTER, () => ({ data: ROWS, error: null }));
  const mc = Corp.memberCities;
  ok('state is ok', Corp.memberCitiesState === 'ok', Corp.memberCitiesState);
  ok('🔴 exactly one entry per roster row (4 members, 4 city rows for 3 of them)',
     mc.length === ROSTER.length, mc.length + ' entries for ' + ROSTER.length + ' members');
  ok('🔴 ONE query, not one per member', calls.length === 1, calls.length + ' call(s): ' + JSON.stringify(calls.map(c => c.table)));
  ok('…and it is an in(owner_id, [the roster]) read of city_profiles',
     calls[0].table === 'city_profiles' && calls[0].col === 'owner_id' && calls[0].ids.length === 4,
     JSON.stringify(calls[0]));

  const alpha = mc.find(m => m.userId === 'u-alpha');
  ok('a member with TWO cities keeps ONE roster entry holding both',
     alpha.cities.length === 2, JSON.stringify(alpha.cities.map(c => c.nodeId)));
  ok('city name is verbatim', alpha.cities[0].name === 'Ashfall', alpha.cities[0].name);
  ok('population is verbatim (340)', alpha.cities[0].pop === 340, String(alpha.cities[0].pop));
  ok('sells are the row\'s own pairs, sorted by units',
     JSON.stringify(alpha.cities[0].sells) === JSON.stringify([{ id: 'lumber', units: 4500.13 }, { id: 'zincOre', units: 170 }]),
     JSON.stringify(alpha.cities[0].sells));
  ok('buys are the row\'s own pairs',
     JSON.stringify(alpha.cities[0].buys) === JSON.stringify([{ id: 'crudeOil', units: 5760 }, { id: 'silica', units: 10 }]),
     JSON.stringify(alpha.cities[0].buys));
  ok('a blank city_name stays blank — no invented name', alpha.cities[1].name === '', JSON.stringify(alpha.cities[1].name));
  ok('🔴 a NULL population is null, NOT 0', alpha.cities[1].pop === null, String(alpha.cities[1].pop));

  const charlie = mc.find(m => m.userId === 'u-charlie');
  ok('🔴 a NaN unit figure is null, not NaN', charlie.cities[0].sells[0].units === null,
     JSON.stringify(charlie.cities[0].sells));
  ok('…and it keeps its resource id (that part IS true)', charlie.cities[0].sells[0].id === 'gasoline');
  ok('a null specializations column is [] not a crash', Array.isArray(charlie.cities[0].specs) && charlie.cities[0].specs.length === 0);
  ok('a null buys column is []', Array.isArray(charlie.cities[0].buys) && charlie.cities[0].buys.length === 0);

  const delta = mc.find(m => m.userId === 'u-delta');
  ok('🔴 a member with NO city row still has an entry, with cities: []',
     !!delta && Array.isArray(delta.cities) && delta.cities.length === 0);
  ok('…and keeps their real name and role', delta.name === 'Delta' && delta.role === 'member');

  // Nothing anywhere may be NaN or undefined.
  const flat = JSON.stringify(mc);
  ok('no NaN and no undefined survives into the bridge payload',
     !/NaN|undefined/.test(flat), flat.slice(0, 120));
}

/* ── 2. THE TABLE IS NOT THERE (sql/038 never applied) ──────────────── */
console.log('\n2. city_profiles missing — PostgREST answers with an {error}, it does not throw');
{
  const { Corp } = await run(ROSTER, () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }));
  ok('state is unavailable — NOT "nobody founded a city"', Corp.memberCitiesState === 'unavailable', Corp.memberCitiesState);
  ok('every member is still listed, so the roster count does not change',
     Corp.memberCities.length === ROSTER.length, Corp.memberCities.length + '');
  ok('and no city is invented for any of them',
     Corp.memberCities.every(m => m.cities.length === 0));
}

/* ── 3. THE READ THROWS ─────────────────────────────────────────────── */
console.log('\n3. the read throws (offline / fetch rejected)');
{
  const { Corp } = await run(ROSTER, () => { throw new Error('Failed to fetch'); });
  ok('state is unavailable', Corp.memberCitiesState === 'unavailable', Corp.memberCitiesState);
  ok('the roster is intact', Corp.memberCities.length === ROSTER.length);
}

/* ── 4. NO CLOUD AT ALL ─────────────────────────────────────────────── */
console.log('\n4. no Supabase client (signed out / offline)');
{
  const { Corp } = await run(ROSTER, null);
  ok('state is unavailable', Corp.memberCitiesState === 'unavailable', Corp.memberCitiesState);
  ok('the roster is intact', Corp.memberCities.length === ROSTER.length);
}

/* ── 5. EMPTY ROSTER IS A SUCCESSFUL ANSWER, NOT AN OUTAGE ──────────── */
console.log('\n5. an empty roster');
{
  const { Corp, calls } = await run([], () => ({ data: [], error: null }));
  ok('state is ok (there was nothing to look up)', Corp.memberCitiesState === 'ok', Corp.memberCitiesState);
  ok('no query was issued at all', calls.length === 0, calls.length + '');
  ok('the list is empty', Corp.memberCities.length === 0);
}

/* ── 6. RLS RETURNS FEWER ROWS THAN THERE ARE MEMBERS ───────────────── */
console.log('\n6. RLS hands back only ONE member\'s row — the others must not vanish');
{
  const { Corp } = await run(ROSTER, () => ({ data: [ROWS[2]], error: null }));
  ok('🔴 still four entries — rows are built from the ROSTER, not the result',
     Corp.memberCities.length === 4, Corp.memberCities.length + '');
  ok('the one readable city landed on the right member',
     Corp.memberCities.find(m => m.userId === 'u-bravo').cities.length === 1);
  ok('the other three read as "no city", which is what the panel prints',
     Corp.memberCities.filter(m => m.cities.length === 0).length === 3);
}

console.log(fails ? '\n❌ ' + fails + ' CHECK(S) FAILED' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
