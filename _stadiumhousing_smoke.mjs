/* 🏘 THE STADIUM'S HOUSING LINE SPEAKS IN THE CITY'S OWN NUMBERS.
   Run: node _stadiumhousing_smoke.mjs
   Tracker bug-mu2pgkdt: "When putting on a Stadium Event, the Housing Headroom
   figure is set to 8 million+ people … should be something realistic."
   The stadium economy works at world scale — one citizen node-city tracks is
   residentsPerCitizen (6,000) people — so a city with room for 1,400 more
   population printed "Headroom 8,400,000". The comparison was right; the number
   shown meant nothing next to the population the player can see. §3 is the
   negative control: the old line, rebuilt, does print the 8 million. */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const FILE = resolve('./public/src/city/stadium.economy.js');
const M = await import(pathToFileURL(FILE).href);

const node = { population: 120, residents: 200000, housingHeadroom: 1400, hope: 70, morale: 70, security: 80, health: 80,
  powerGen: 1000, powerDemand: 50, motorPoolCapacity: 50000, buildings: [], stadium: { lvl: 3 } };
const world = { neighbours: [{ residents: 200000, route: true }], tradeStability: 80 };
const housing = (room) => M.eventReadiness({ lengthCycles: 1 }, Object.assign({}, node, { housingHeadroom: room }), world, Date.now())
  .checks.find(c => c.id === 'housing');
const PER = M.STADIUM_ECON.migration.residentsPerCitizen;

console.log('\n=== 1. the line reads in population ===');
{
  const h = housing(1400);
  ok(PER === 6000, 'the world-scale factor is still 6,000 people per tracked citizen', String(PER));
  ok(/^Room for 1,400 more population/.test(h.detail), 'room is the city\'s own figure — 1,400, the number its population HUD counts in', h.detail);
  ok(!/8,400,000/.test(h.detail) && !h.detail.includes((1400 * PER).toLocaleString('en-US')), 'the world-scale 8,400,000 is gone from the line');
  ok(/this event would settle (under 0\.1|~[\d.,]+|0)/.test(h.detail), 'and it says how much of that room the event would fill, in the same unit');
  ok(/arriving visitors\)$/.test(h.detail), 'the visitor count is still there, labelled as visitors');
}

console.log('\n=== 2. the verdict is unchanged ===');
{
  ok(housing(1400).status === 'ok' && housing(1400).fix === null, 'room to spare: OK, no advice');
  const z = housing(0);
  ok(z.status === 'fail' && /Build \d+ 🏠 Housing/.test(z.fix), 'no room: FAIL, with the same build advice as before', z.status + ' ' + z.fix);
  const src = readFileSync(FILE, 'utf8');
  ok(/headroomPeople >= projMig\.arrivals \? 'ok' : headroomPeople > 0 \? 'warn' : 'fail'/.test(src),
    'the status still compares people with people — only the words changed');
}

console.log('\n=== 3. NEGATIVE CONTROL — the old line ===');
{
  const oldLine = (room, arrivals) => 'Headroom ' + Math.round(room * PER).toLocaleString('en-US') + ', expect ~' + arrivals + ' arrivals';
  ok(/Headroom 8,400,000/.test(oldLine(1400, 4)), 'rebuilt, the old wording prints 8,400,000 for this city — the reported figure');
}

console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ the housing line is in the city\'s numbers\n');
process.exit(fails ? 1 : 0);
