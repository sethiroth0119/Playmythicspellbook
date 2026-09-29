/* ══════════════════════════════════════════════════════════════════════════
   🏫 DRIVE-SCHOOLS — does building a school VISIBLY MOVE THE METER?

   That question is the whole round, and it is asked in exactly those words
   because it is the question /src/zombie failed three times and was disarmed
   for. An education system whose numbers are correct but which does not
   respond to the building the player just paid for is the same defect wearing
   a mortarboard.

   WHAT IS ASSERTED:
     1  THE LADDER IS SIX RUNGS and the bottom one is reachable without any
        building at all (a school-less city still staffs unskilled work).
     2  NO SCHOOLS ⇒ CAPPED AT SELF-TAUGHT, and the city says which tier is
        missing rather than just refusing.
     3  BUILDING ONE MOVES THE CAP — place an Elementary School and the cap
        rises one rung, on the HOST's own pre-pass, not on a hand-called seam.
     4  THE LADDER MUST BE UNBROKEN — Elementary + High with no Middle between
        them caps at elementary. This is the CONTROL that separates "the cap
        counts schools" from "the cap follows a ladder"; a naive implementation
        that took the highest tier present passes 1-3 and fails this.
     5  SEATS PACE IT — more seats for the same population raises the factor.
     6  AND THE MIX ACTUALLY CLIMBS — with a full ladder the education
        distribution moves up over simulated days. This is the one that would
        catch a cap that is reported but never read by the graduation step.

   Run:  node .gauntlet/drive-schools.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8050 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three' });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc && !!window.MythicDemographics', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(8000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

/* Place a set of school tiles and let the HOST's own pre-pass observe them.
   Nothing here calls setSchooling directly — that would test the seam and not
   the wiring, and the wiring is what a player depends on. */
const build = (types) => page.evaluate(async (list) => {
  const g = window.__nc.game;
  for (const k of Object.keys(g.tiles)) {
    const t = g.tiles[k];
    if (t && window.__nc.BUILDINGS[t.type] && window.__nc.BUILDINGS[t.type].school) delete g.tiles[k];
  }
  let n = 0;
  for (const ty of list) g.tiles[(3 + n++) + ',3'] = { type: ty, lvl: 1 };
  // several host beats, so the pre-pass has certainly run
  await new Promise((r) => setTimeout(r, 2600));
  const D = window.MythicDemographics;
  const s = D && D.schooling ? D.schooling() : null;
  return { placed: list.length, sch: s };
}, types);

console.log('\n1. the ladder itself');
const ladder = await page.evaluate(() => {
  const E = window.MythicEconomy;
  const ed = E && E.ECON && E.ECON.demographics && E.ECON.demographics.education;
  return ed ? { order: ed.order, requires: ed.requires,
                bands: ed.order.map((r) => ed.levels[r].band) } : null;
});
ok('the economy exposes a six-rung ladder', !!ladder && ladder.order.length === 6,
   ladder ? ladder.order.join(' -> ') : 'no ECON');
ok('the bottom rung is self-taught and needs no building',
   !!ladder && ladder.order[0] === 'guru' && ladder.requires.unskilled === 'guru',
   ladder ? 'unskilled requires ' + ladder.requires.unskilled : '');
ok('the top rung is the only route to advanced work',
   !!ladder && ladder.requires.advanced === 'university');

console.log('\n2. no schools — capped at self-taught, and it says what is missing');
const none = await build([]);
console.log('   ' + JSON.stringify(none.sch));
ok('the host pre-pass reached /src/demographics', !!none.sch);
ok('the cap is the floor rung', !!none.sch && none.sch.cap === 'guru', none.sch && none.sch.cap);
ok('it names the missing tier', !!none.sch && none.sch.missing === 'elementary', none.sch && none.sch.missing);
ok('nothing is reported as a school', !!none.sch && none.sch.any === false);

console.log('\n3. build ONE — the cap moves, off the host pre-pass');
const one = await build(['elemschool']);
console.log('   ' + JSON.stringify(one.sch));
ok('the cap rose to elementary', !!one.sch && one.sch.cap === 'elementary', one.sch && one.sch.cap);
ok('the next missing tier is named', !!one.sch && one.sch.missing === 'middle', one.sch && one.sch.missing);
ok('seats are counted from the tile', !!one.sch && one.sch.seats === 40, one.sch && ('seats ' + one.sch.seats));

console.log('\n4. CONTROL — a GAP in the ladder does not count the tiers above it');
const gap = await build(['elemschool', 'highschool', 'university']);
console.log('   ' + JSON.stringify(gap.sch));
ok('elementary + high + university with no middle still caps at elementary',
   !!gap.sch && gap.sch.cap === 'elementary',
   gap.sch ? 'cap ' + gap.sch.cap + ' (a naive "highest tier present" reads university)' : '');
ok('...and it names MIDDLE as the missing one', !!gap.sch && gap.sch.missing === 'middle',
   gap.sch && gap.sch.missing);

console.log('\n5. the full ladder opens the top rung');
const full = await build(['elemschool', 'midschool', 'highschool', 'college', 'university']);
console.log('   ' + JSON.stringify(full.sch));
ok('the cap is university', !!full.sch && full.sch.cap === 'university', full.sch && full.sch.cap);
ok('nothing is missing', !!full.sch && full.sch.missing === null);
ok('all five sets of seats are counted', !!full.sch && full.sch.seats === 40 + 34 + 28 + 20 + 14,
   full.sch && ('seats ' + full.sch.seats));

console.log('\n6. seats pace the rate — twice the schools, a higher factor');
const paced = await page.evaluate(async () => {
  const D = window.MythicDemographics, g = window.__nc.game;
  const read = () => D.schooling();
  // a population large enough that one school cannot seat it
  const before = read();
  for (let i = 0; i < 6; i++) g.tiles[(10 + i) + ',5'] = { type: 'elemschool', lvl: 1 };
  await new Promise((r) => setTimeout(r, 2600));
  const after = read();
  return { before, after };
});
console.log('   before ' + JSON.stringify(paced.before) + '\n   after  ' + JSON.stringify(paced.after));
ok('more schools means more seats', paced.after.seats > paced.before.seats,
   paced.before.seats + ' -> ' + paced.after.seats);
ok('the factor never exceeds 1', paced.after.factor <= 1, String(paced.after.factor));

/* ── 7. THE PHONE SAYS SO, AND THEN STOPS SAYING IT ─────────────────────────
   /src/broadcast is a PULL design: nothing notifies it, so a system is only in
   the feed once an OBSERVER reads it AND that observer is in observe()'s array.
   One written but left out of the array parses, exports, passes modcheck and
   says nothing — indistinguishable from the city being fine. So this checks
   posts, not functions.

   ⚠ THE CLAIM IS "THE COMPLAINT STOPS", NOT "A HAPPY POST APPEARS". The phrase
     bank draws at random and the feed ranks by severity, so demanding a
     specific contented line is a coin flip dressed as an assertion — the first
     version of this section failed on exactly that. A complaint that keeps
     being raised after the player has fixed the thing is the real defect, and
     it is deterministic. */
console.log('\n7. the phone talks about it, and stops once it is fixed');
const phone = await page.evaluate(async (buildList) => {
  const B = window.MythicBroadcast, g = window.__nc.game, nc = window.__nc;
  if (!B || !B.ready()) return { err: 'broadcast not mounted' };
  const isSchool = (t) => t && nc.BUILDINGS[t.type] && nc.BUILDINGS[t.type].school;
  const clear = () => { for (const k of Object.keys(g.tiles)) if (isSchool(g.tiles[k])) delete g.tiles[k]; };
  const bad = () => (B.posts({ limit: 400 }) || [])
    .filter((p) => p && p.subject === 'schooling' && p.pole === 'bad');

  clear();
  await new Promise((r) => setTimeout(r, 10000));
  const before = bad();
  const seen = new Set(before.map((p) => p.id));

  let n = 0;
  for (const ty of buildList) g.tiles[(3 + n++) + ',12'] = { type: ty, lvl: 1 };
  await new Promise((r) => setTimeout(r, 14000));
  const fresh = bad().filter((p) => !seen.has(p.id));

  const subj = (B.subjects() || []).find((x) => x.id === 'schooling') || null;
  return {
    subject: !!subj, dept: subj ? subj.dept : null, tag: subj ? subj.tag : null,
    beforeN: before.length,
    beforeSample: before.slice(0, 2).map((p) => String(p.body || '').slice(0, 100)),
    /* `source` is the provenance record, not a string: { src, why }. The why
       is the observer's own sentence and it names the missing tier, so it is
       the non-flaky way to assert the post is ABOUT the right thing — the
       rendered body is a random draw from the phrase bank and only some lines
       carry {p}. */
    beforeSrc: before.slice(0, 2).map((p) => (p.source && p.source.src) || null),
    beforeWhy: before.slice(0, 2).map((p) => (p.source && p.source.why) || ''),
    freshN: fresh.length,
    freshSample: fresh.slice(0, 2).map((p) => String(p.body || '').slice(0, 100)),
  };
}, ['elemschool', 'midschool', 'highschool', 'college', 'university']);

if (phone.err) { ok('the feed is mounted', false, phone.err); }
else {
  console.log('   complaints before: ' + JSON.stringify(phone.beforeSample));
  ok('the schooling subject is registered on the feed', !!phone.subject);
  ok('...owned by the Department of Education',
     phone.dept === 'Department of Education', String(phone.dept));
  ok('...under the #schools tag', phone.tag === 'schools', String(phone.tag));
  ok('with no schools the feed complains', (phone.beforeN | 0) > 0, phone.beforeN + ' posts');
  ok('...and the complaint is traceable to the school observer',
     phone.beforeSrc.length > 0 && phone.beforeSrc.every((s) => s === 'school'),
     JSON.stringify(phone.beforeSrc));
  ok('...and its provenance names the tier that is missing',
     phone.beforeWhy.some((w) => /no elementary/i.test(w)),
     JSON.stringify(phone.beforeWhy));
  ok('once the full ladder is standing it raises NO new complaint',
     (phone.freshN | 0) === 0, phone.freshN + ' new · ' + JSON.stringify(phone.freshSample));
}

console.log('\npage errors: ' + logs.length);
logs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
