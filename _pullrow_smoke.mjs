/* 📊 THE THREE DRAWS UNDER THE MOVE-IN METER (bug-mtvblyi9).

   Reported: the residential Zone Demand tab said "Wages, rents, jobs and
   services are what move that; the Survey tab shows which one is worst" — and
   the only Survey tab (Econ → Survey) is the deposit survey. The pipeline now
   measures the three draws it scores and names the weakest in the sentence;
   the panel prints them under the meter with the weakest in red.

   Run: node _pullrow_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const PIPE = readFileSync('./public/src/demographics/pipeline.js', 'utf8').replace(/\r\n/g, '\n');
const IDX = readFileSync('./public/src/demographics/index.js', 'utf8').replace(/\r\n/g, '\n');
const REN = readFileSync('./public/src/demographics/render.js', 'utf8').replace(/\r\n/g, '\n');
const P = await import('./public/src/demographics/pipeline.js');

/* the sentence no longer points at a tab that does not have it */
ok(!/Survey tab shows which one is worst/.test(PIPE), 'the cause line no longer sends the player to the Survey tab');
ok(/label: 'Nobody is moving in', why: 'There are ' \+ Math\.round\(vacantTotal\) \+ ' empty homes waiting, so housing is not what is stopping this city — too few people want to come\. ' \+ pullWorstText\(S\.pull\)/.test(PIPE),
   'it keeps the housing verdict and appends the weakest draw by name');

/* the three draws are measured over every household that looked */
ok(/let pJobs = 0, pJobsW = 0, pRent = 0, pRentW = 0;/.test(PIPE), 'the accumulators exist');
ok(/considered \+= bagW \* ew;\n\s*pRent \+= clamp01\(1 - burden \/ dm\.rent\.burdenMax\) \* bagW \* ew; pRentW \+= bagW \* ew;\n\s*if \(A\.workersPer\(a\) > 0\) \{ pJobs \+= clamp01\(fit\[e\]\) \* bagW \* ew; pJobsW \+= bagW \* ew; \}\n\s*if \(burden > dm\.rent\.burdenMax\)/.test(PIPE),
   'they are credited BEFORE the rent and job gates turn a household away (so a turned-away household counts at the score that turned it away)');
ok(/S\.pull = pullTerms\(pJobsW > 0 \? pJobs \/ pJobsW : null, pRentW > 0 \? pRent \/ pRentW : null, services, dm\.arrival\.weight\);/.test(PIPE), 'S.pull is set beside S.attract');
ok(/S\.limit = null; S\.pull = null;/.test(PIPE), 'reset() clears it');

/* pullTerms, run for real */
{
  const W = { jobs: 0.5, rent: 0.3, services: 0.2 };
  let r = P.pullTerms(0.3, 0.8, 0.9, W);
  ok(r.terms.length === 3 && r.terms.map((t) => t.id).join() === 'jobs,rent,services', 'three terms: jobs, rent, services');
  ok(r.worst === 'jobs' && /^Weakest right now: work — .*30%/.test(r.worstText), 'the LOWEST score is the worst, and its sentence carries its percentage', r.worstText);
  r = P.pullTerms(0.9, 0.2, 0.9, W);
  ok(r.worst === 'rent' && /rents against wages/.test(r.worstText) && /20%/.test(r.worstText) && /Raise wages|zone cheaper/.test(r.worstText), 'rents: names wages and cheaper zoning as the fixes');
  r = P.pullTerms(0.9, 0.9, 0.1, W);
  ok(r.worst === 'services' && /services/.test(r.worstText) && /10%/.test(r.worstText), 'services: named with its percentage');
  r = P.pullTerms(null, 0.5, 0.5, W);
  ok(r.terms[0].v === null && r.worst === 'rent', 'a term nobody scored is null and never "worst"; ties go to the heavier weight');
  r = P.pullTerms(null, null, null, W);
  ok(r.worst === null && r.worstText === '' && /row under this meter/.test(P.pullWorstText(r)), 'nothing scored → the generic sentence points at the row under the meter, not a tab');
  ok(/row under this meter/.test(P.pullWorstText(null)), 'and so does a missing pull');
}

/* the report publishes it and the panel prints it */
ok(/pull: st\.pull \|\| null,/.test(IDX), 'report() carries pull');
ok(/if \(r\.pull && r\.pull\.terms && r\.pull\.terms\.length\) h\.push\(pullRow\(r\.pull\)\);/.test(REN), 'the panel prints the row right after the limit line');
ok(REN.indexOf('h.push(pullRow(r.pull))') > REN.indexOf("h.push(meter('How attractive this city is") && REN.indexOf('h.push(pullRow(r.pull))') < REN.indexOf("h.push('<div class=\"eco-h\">🏘 Districts</div>')"), '…between the meter and the districts');
ok(/function pullRow\(p\) \{/.test(REN) && /— weakest/.test(REN) && /class="dg-pull"/.test(REN), 'pullRow marks the weakest term');
ok(/\.dg-pull \.worst \.pn,\.dg-pull \.worst \.pv\{color:#e0556a;font-weight:700\}/.test(REN) && /\.dg-pull \.worst \.pb i\{background:#e0556a\}/.test(REN), '…in red');
{
  /* render it */
  const R = await import('./public/src/demographics/render.js');
  const html = R.renderPanel({ ok: true, population: 10, households: 4, homes: 20, occupancy: 0.2, netPerDay: 0, attract: 0.71,
    causes: [{ sign: '−', label: 'Nobody is moving in', why: 'x' }], limitText: '', growth: null, zones: [], wealth: [], education: [], ages: [], archetypes: [], adults: 0, inMix: null, labourNote: '', sourceNote: '',
    pull: P.pullTerms(0.9, 0.3, 0.8, { jobs: 0.5, rent: 0.3, services: 0.2 }), day: { in: 0, out: 0, grad: 0, evicted: 0, died: 0 }, flow: { in: 0, out: 0, grad: 0, evicted: 0, died: 0 }, rentIndex: 1 });
  ok(/What draws people here/.test(html) && /Rents against wages — weakest/.test(html) && /Weakest right now: rents against wages/.test(html), 'a rendered panel shows the row with rents marked weakest');
  ok((html.match(/class="pr worst"/g) || []).length === 3 && (html.match(/class="pr"/g) || []).length === 6, 'one term in red, two plain');
}

/* the six knobs moved together */
const SRC = readFileSync('./public/index.html', 'utf8');
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 98, 'BUILD_VERSION is v121v98 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build (the demographics module imports at ?v=NC_BUILD)');
ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
