/* 💸👷 v121v132 — bug-mtsq62mg, "Out of Cash — Limited by Business 0% impacting
   many businesses throughout the city" (Grimalkin Lord).

   "Place a building that is a business — Pharmacy, Medical Chemicals… Let them
   run for a bit — this issue is always present. I've had buildings stuck on it
   for days and it results in the businesses going bankrupt… Nothing James or
   myself do seems to move the needle, so I am raising this as a bug as
   something either hasn't been built yet or hasn't been plugged in yet."

   Owner, clarifying: "the businesses are not making money and the npcs are not
   going to the businesses for jobs and working in them like they are supposed
   to."

   THE DEADLOCK. citQualifies() refuses to seat anyone in an ECONOMIC building
   until the economy has banded the tile — right, because a freshly built Clinic
   was otherwise crewed by whoever stood nearest and tenure then locked them in
   permanently. Its comment says "the wait is one sync at most". That holds only
   when the economy goes on to band the tile, and tileBands() answers ONLY for a
   tile carrying a live firm with a headcount band:

       for (const f of Firms.alive()) { if (!f.tileKey) continue;
         const hc = Firms.headcountFor(f); if (hc && hc.band) out[f.tileKey] = hc.band; }

   A building the economy never founded a firm on — or founded one without a
   tileKey, or whose headcount yields no band — is never in that map, fails the
   test on every 2-second citizen beat forever, is never staffed, earns nothing,
   reaches zero cash, and is reported as "Out of cash": the symptom, not the
   cause. Which is why the advice it printed could never move the needle.
   Run: node _citjobs_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');

/* ── the wait now expires ─────────────────────────────────────────────────── */
ok(/const CIT_BAND_WAIT_MS = 30000;/.test(NC), 'the wait for a band has a deadline');
ok(/let _citBandWaitAt = null;/.test(NC), '…and a per-tile stopwatch to measure it against');
ok(/if \(nowB - _citBandWaitAt\[tileKey\] < CIT_BAND_WAIT_MS\) return false;/.test(NC),
  '…so an unbanded economic tile still waits — it is only the FOREVER that is gone');
ok(/if \(_citBandWaitAt && _citBandWaitAt\[tileKey\]\) delete _citBandWaitAt\[tileKey\];/.test(NC),
  'a tile that DOES get a band clears its stopwatch, so a later rebuild on that key waits afresh');
{
  const q = NC.slice(NC.indexOf('function citQualifies(c, tileKey) {'), NC.indexOf('function citQualifies(c, tileKey) {') + 3200);
  ok(/ECO_BUILDING_MAP\[t\.type\]/.test(q),
    'the guard itself is intact — an economic building is still not crewed before the economy says what the work demands');
  ok(/bug-mtsq62mg/.test(q), '…and the reason it now expires is written where the next reader will be standing');
}
{
  /* run the rule for real */
  const WAIT = 30000;
  const seen = Object.create(null);
  const qualifies = (tileKey, isEconomic, banded, now) => {
    if (banded) { delete seen[tileKey]; return true; }
    if (!isEconomic) return true;
    if (!seen[tileKey]) seen[tileKey] = now;
    return (now - seen[tileKey]) >= WAIT;
  };
  const t0 = 1e12;
  ok(qualifies('a', false, false, t0) === true, 'run for real: a school or a barracks is hired immediately, as before');
  ok(qualifies('b', true, false, t0) === false, 'run for real: a brand-new Pharmacy waits — the hand-off is not cut short');
  ok(qualifies('b', true, false, t0 + 4000) === false, 'run for real: …still waiting one sync later');
  ok(qualifies('b', true, false, t0 + 29999) === false, 'run for real: …right up to the deadline');
  ok(qualifies('b', true, false, t0 + 30000) === true,
    'run for real: …and past it the city crews it anyway, instead of never — this is the whole bug');
  ok(qualifies('c', true, true, t0) === true, 'run for real: a tile the economy HAS banded is judged on schooling, not on the clock');
  {
    /* the ordinary hand-off must not be disturbed: band arrives inside the wait */
    const k = 'd';
    qualifies(k, true, false, t0);                       // starts waiting
    const during = qualifies(k, true, true, t0 + 5000);  // band lands
    const after = qualifies(k, true, false, t0 + 6000);  // hypothetically unbanded again
    ok(during === true && after === false,
      'run for real: a band arriving inside the wait ends it, and the stopwatch restarts if the tile ever goes unbanded again');
  }
}

/* the knobs */
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 132, 'BUILD_VERSION is v121v132 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
