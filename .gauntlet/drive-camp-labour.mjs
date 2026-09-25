/* ══════════════════════════════════════════════════════════════════════════
   🏕 DRIVE-CAMP-LABOUR — the Employment Board hires real people, or nobody.

   THE ASK: "in the employment board make it where players have to be registered
   in another players node and can only hire npcs from other players cities and
   show in the player city npcs that may work for the registered player
   camp/city. If they are farmers, guards etc....."

   🔴 WHAT THIS REPLACES WAS FICTION, AND NAMING IT IS THE POINT OF THE TEST.
      `_campRolePool()` returned a CONSTANT — 180 for the node's prime trade, 50
      for everything else. The same fifty Farmers were on sale to every player in
      the game at once, no other player was involved, and hiring "drained the
      node's local labour pool" only in the sense that a counter in the hirer's
      own save went up. Nobody's city was ever a worker poorer.

   ⚠ WHAT THIS DRIVER CAN AND CANNOT SEE. The rules that matter — you must be
     registered, the node must be someone else's, the city must not be yours,
     the pool must not go negative — are enforced in sql/088 by
     camp_hire_from_city, and a browser with no second player and no signed-in
     session cannot exercise them. So this proves the half that lives in the
     client: that the fiction is GONE, that the board asks the server rather
     than inventing a pool, that a refusal is shown rather than swallowed, and
     that the city half of the ask renders. The server half is asserted
     structurally against the migration text, with controls, in the same way
     drive-vault-drop asserts an absence.

   Pinned, with controls:
     · the constant pool is deleted, not merely unused
     · the board reads camp_labour_market and renders per CITY, not per trade
     · hiring calls camp_hire_from_city and adopts the server's own figures
     · CONTROL: it credits `d.hired`, never the amount asked for
     · the city shows who camps could take, by trade  ← "farmers, guards etc"
     · every aptitude maps to a camp trade, and Guard exists
     · the published count excludes people already on an errand
     · the migration gates registration, ownership and self-hire  + CONTROLS

   Run:  node .gauntlet/drive-camp-labour.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const nc = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
const eco = fs.readFileSync(path.join(ROOT, 'src', 'economy', 'index.js'), 'utf8');
const sqlPath = path.resolve(process.cwd(), 'sql', '088_cross_city_labour.sql');
/* 🔴 088b REPLACES TWO OF 088's FUNCTIONS AND IS READ AFTER IT, so the bodies
   sliced below are the ones that actually run. 088 alone shipped a rule that
   matched NOTHING on the live database — cities sit in nodes their owners do
   not own — and the reach test is what fixes it. Concatenated in file order for
   the same reason the database applies them in file order. */
const sqlB = path.resolve(process.cwd(), 'sql', '088b_labour_reach.sql');
const sql = (fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '')
         + (fs.existsSync(sqlB) ? ('\n' + fs.readFileSync(sqlB, 'utf8')) : '');
const sqlLatest = fs.existsSync(sqlB) ? fs.readFileSync(sqlB, 'utf8') : '';

const out = { client: {}, sql: {}, city: {} };

/* ── the client half, read from what ships ───────────────────────────────── */
out.client = {
  /* 🔴 DELETED, not left lying about. A function still called _campRolePool is
     an invitation to call it again, and it would answer confidently with a
     number that means nothing. The comment that explains the removal is
     allowed to mention the name — the DEFINITION is what must be gone. */
  fictionGone: !/function _campRolePool\(/.test(idx),
  fictionExplained: /_campRolePool\(\)` returned a CONSTANT/.test(idx),
  readsMarket: /rpc\('camp_labour_market'\)/.test(idx),
  hiresThroughServer: /rpc\('camp_hire_from_city'/.test(idx),
  /* CONTROL for the credit rule: the camp must gain what the SERVER moved. */
  creditsServerFigure: /Profile\.campWorkforce\[role\] = \(Profile\.campWorkforce\[role\] \| 0\) \+ Math\.max\(0, d\.hired \| 0\)/.test(idx),
  adoptsBalance: /if \(d\.balance != null\)/.test(idx),
  showsRefusal: /if \(!d\.ok\) \{[\s\S]{0,120}d\.why/.test(idx),
  namesTheCity: /From <b>\$\{escapeHtml\(String\(o\.city_name/.test(idx),
  explainsEmpty: /You can only hire from OTHER players' cities/.test(idx),
  saysMigrationMissing: /apply sql\/088_cross_city_labour\.sql/.test(idx),
  publishesLabour: /rpc\('city_labour_publish'/.test(idx),
  payloadCarriesLabour: /labour,/.test(eco) && /window\.cityLabourByRole/.test(eco),
};

/* ── the migration's rules ───────────────────────────────────────────────── */
const fn = (name) => {
  /* ⚠ ANCHORED ON THE `create` LINE, NOT ON THE BARE NAME. `function
     public.camp_hire_from_city(` also appears in the REVOKE and GRANT
     statements at the foot of each migration, and lastIndexOf happily returned
     the grant — a 1,300-character slice of trailing boilerplate in which every
     rule this driver asserts was missing. Every SQL assertion went false at
     once, which is the only reason it was obvious; a slicer that had caught
     half the body would have failed far more quietly.
     🔴 THE CONTROL IS WHAT CAUGHT IT. `controlCodeSurvives` asserts the sliced
        body still contains _ct_cinder_take and is longer than 400 characters,
        precisely so an empty or truncated slice cannot make an ABSENCE
        assertion pass for the wrong reason.
     088b redefines two of these, and the LAST create in file order is what the
     database ends up with — so the newer file is preferred when it has one. */
  const decl = 'create or replace function public.' + name + '(';
  const src = sqlLatest.indexOf(decl) >= 0 ? sqlLatest : sql;
  const i = src.lastIndexOf(decl);
  if (i < 0) return '';
  const j = src.indexOf('end $$;', i);
  return j < 0 ? src.slice(i) : src.slice(i, j);
};
const hire = fn('camp_hire_from_city');
const market = fn('camp_labour_market');
const publish = fn('city_labour_publish');
/* ⚠ COMMENTS STRIPPED BEFORE ANY ABSENCE IS ASSERTED. The header of
   camp_hire_from_city QUOTES the wrong test it used to make — `v_take->>'ok'` —
   to explain why it is wrong, and a plain search cannot tell a warning about a
   mistake from the mistake itself. This is the second time that has bitten in
   this gate (U20's stale-claim marker was the first), so absences are judged
   against code only. */
const hireCode = hire.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
out.sql = {
  exists: !!sql,
  poolTable: /create table if not exists public\.city_labour_pool/.test(sql),
  /* the three gates the ask names, in the function that can actually refuse */
  needsRegistration: /from tw_camp_registrations where user_id = v_uid/.test(hire),
  needsOtherOwner: /if v_owner = v_uid then/.test(hire),
  refusesOwnCity: /if v_cityown = v_uid then/.test(hire),
  locksBeforeMeasuring: hire.indexOf('for update') > 0
    && hire.indexOf('for update') < hire.indexOf('if v_avail < v_want'),
  /* CONTROL: the market listing applies the same two gates, so the board never
     shows something the hire would then refuse. */
  marketNeedsRegistration: /from tw_camp_registrations r where r\.user_id = v_uid/.test(market),
  marketExcludesOwnCity: /cp\.owner_id <> v_uid/.test(market),
  /* 🔴 the publish must not be able to reset the hired tally */
  publishCannotResetHired: !/set[\s\S]{0,200}hired\s*=/.test(publish),
  publishChecksOwnership: /where id = p_city_id and owner_id = v_uid/.test(publish),
  /* the wallet contract, which an earlier draft got wrong */
  catchesRaise: /exception when raise_exception then/.test(hire),
  noOkFieldTest: !/v_take->>'ok'/.test(hireCode),
  /* CONTROL: the stripper must not be silently emptying the body — if it did,
     every absence above would pass for the wrong reason. */
  controlCodeSurvives: /_ct_cinder_take/.test(hireCode) && hireCode.length > 400,
  /* CONTROL: no table-level write policy exists — both mutations are functions */
  noWritePolicy: !/create policy city_labour_pool_write/.test(sql),
  hasReadPolicy: /create policy city_labour_pool_read/.test(sql),
  /* 🔴 THE REACH RULE. 088 alone matched nothing on the live database: it
     required a city LOCATED IN the registered node, and cities sit in nodes
     their owners do not own (measured: 21 camps registered to another player's
     node, 0 of them with a reachable city). 088b adds the owner route. */
  hasReachRule: /p\.node_id = v_node or cp\.owner_id = v_owner/.test(market),
  hireChecksReach: /if not \(v_citynode = v_node or v_cityown = v_owner\) then/.test(hire),
  /* 🔴 …AND WIDENING THE REACH MUST NOT HAVE OPENED THE SELF-HIRE HOLE. Both
     halves still exclude the caller's own city, and that is the one check that
     must survive every change to the rule around it. */
  marketStillExcludesSelf: /cp\.owner_id <> v_uid/.test(market),
  hireStillExcludesSelf: /if v_cityown = v_uid then/.test(hire),
};

/* ── the city half, in a real browser ────────────────────────────────────── */
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9260 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 980 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.MythicCitizens && !!window.__nc', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);

out.city = await pg.evaluate(async () => {
  const o = {};
  const M2 = window.MythicCitizens;
  window.__nc.jobfair.setPop(40);
  /* A fresh node is an empty field. The errand test below needs a real seat to
     send somebody to, or it silently measures nothing — the hollow pass this
     gate has already been caught by once. */
  window.__nc.jobfair.plant('5,5', 'farm');
  window.__nc.jobfair.plant('6,5', 'quarry');
  /* ⏱ LONG ENOUGH FOR THE ECONOMY TO ADOPT AND BAND THEM. An economic building
     with no band yet accepts NOBODY — that is deliberate (a new Clinic used to
     be staffed by whoever was nearest, seconds before the economy said it needs
     technicians) — so a shorter wait here makes sendToJob refuse and this test
     measure nothing. syncBuildings runs on a 4s beat. */
  await new Promise(r => setTimeout(r, 6500));

  const un = M2.unemployed();
  o.unemployed = un.length;
  /* Every work-seeker must carry a camp trade — one without is somebody no
     camp could ever ask for, and they would silently never be published. */
  o.allHaveRole = un.every(p => !!p.campRole);
  o.roles = Array.from(new Set(un.map(p => p.campRole))).sort();

  const byRole = M2.labourByRole();
  o.byRole = byRole;
  const sum = Object.keys(byRole).reduce((s, k) => s + byRole[k], 0);
  /* The published total must equal the people, or the pool is advertising
     somebody twice — or nobody. */
  o.sumMatches = sum === un.length;

  /* 🔴 SOMEBODY ON AN ERRAND IS NOT FOR SALE. They still have no job, so they
     stay on the work-seeker list — but publishing them would let one person be
     spent twice: once by a camp and once by the errand they are already on. */
  const places = M2.placements() || [];
  o.placements = places.length;
  if (places.length && un.length) {
    const who = un[0].id;
    const before = M2.labourByRole();
    const beforeSum = Object.keys(before).reduce((s, k) => s + before[k], 0);
    const r = M2.sendToJob(who, places[0].key);
    o.errandAccepted = !!(r && r.ok);
    const after = M2.labourByRole();
    const afterSum = Object.keys(after).reduce((s, k) => s + after[k], 0);
    /* A refusal here is a FAILURE, not a null: the setup guarantees a banded
       seat and a qualified resident, so a refusal means that guarantee broke. */
    o.dropsWhenBusy = o.errandAccepted ? (afterSum === beforeSum - 1) : false;
    o.refusedWhy = o.errandAccepted ? null : (r && r.why);
    o.beforeSum = beforeSum; o.afterSum = afterSum;
    /* CONTROL: they are still ON the work-seeker list — hidden from camps is
       not the same as vanished from the city. */
    o.stillListed = !!M2.unemployed().find(p => p.id === who);
  }

  /* The paper renders the camp note and the per-card trade. */
  await window.__nc.jobfair.open();
  const paper = document.getElementById('jf-paper');
  const html = paper ? paper.innerHTML : '';
  o.campNote = /Camps can hire these people/.test(html);
  o.cardRole = /jf-id-role/.test(html);
  o.namesATrade = /hires as (Farmer|Guard|Builder|Doctor|Engineer|Mechanic|Researcher|Merchant|Civilian)/.test(paper ? paper.textContent : '');
  return o;
});
await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const C = out.client, S = out.sql, T = out.city;

need('🔴 the constant labour pool is DELETED', C.fictionGone === true, C.fictionGone);
need('CONTROL: …and the removal is explained where it was', C.fictionExplained === true, C.fictionExplained);
need('the board reads the server market', C.readsMarket === true, C.readsMarket);
need('THE ASK: it names the city the workers come from', C.namesTheCity === true, C.namesTheCity);
need('…and explains an empty board instead of showing a blank grid', C.explainsEmpty === true, C.explainsEmpty);
need('hiring goes through the server', C.hiresThroughServer === true, C.hiresThroughServer);
need('CONTROL: the camp gains what the SERVER moved, not what was asked',
     C.creditsServerFigure === true, C.creditsServerFigure);
need('…and adopts the wallet balance the server wrote', C.adoptsBalance === true, C.adoptsBalance);
need('…and a refusal is shown, not swallowed', C.showsRefusal === true, C.showsRefusal);
need('an unapplied migration says so by name', C.saysMigrationMissing === true, C.saysMigrationMissing);
need('the city publishes its labour', C.publishesLabour === true && C.payloadCarriesLabour === true, C);

need('sql/088 ships with the pool table', S.exists && S.poolTable, S);
need('🔴 hiring requires a camp registration', S.needsRegistration === true, S.needsRegistration);
need('🔴 …the node must be someone else\'s', S.needsOtherOwner === true, S.needsOtherOwner);
need('🔴 …and you cannot hire from your own city', S.refusesOwnCity === true, S.refusesOwnCity);
need('…locking before measuring, as sql/045 does', S.locksBeforeMeasuring === true, S.locksBeforeMeasuring);
need('CONTROL: the listing applies the same gates, so the board cannot offer what the hire refuses',
     S.marketNeedsRegistration === true && S.marketExcludesOwnCity === true, S);
need('🔴 a publish cannot reset the hired tally', S.publishCannotResetHired === true, S.publishCannotResetHired);
need('…and cannot publish into someone else\'s city', S.publishChecksOwnership === true, S.publishChecksOwnership);
need('the wallet raise is caught narrowly', S.catchesRaise === true, S.catchesRaise);
need('CONTROL: …and the ok-field that never existed is not tested for', S.noOkFieldTest === true, S.noOkFieldTest);
need('CONTROL: …with the comment-stripper proven not to have emptied the body',
     S.controlCodeSurvives === true, S.controlCodeSurvives);
need('CONTROL: no table-level write path exists', S.noWritePolicy === true && S.hasReadPolicy === true, S);
need('🔴 the market can actually reach a city (088b)', S.hasReachRule === true, S.hasReachRule);
need('…and the hire applies the SAME reach test', S.hireChecksReach === true, S.hireChecksReach);
need('🔴 CONTROL: widening the reach did not open self-hire',
     S.marketStillExcludesSelf === true && S.hireStillExcludesSelf === true, S);

need('SETUP: the city has residents out of work', (T.unemployed | 0) > 0, T.unemployed);
need('THE ASK: every work-seeker has a camp trade', T.allHaveRole === true, T.roles);
need('…and the trades are the board\'s own names', (T.roles || []).length > 0
     && (T.roles || []).every(r => ['Builder', 'Guard', 'Farmer', 'Doctor', 'Engineer', 'Mechanic', 'Researcher', 'Merchant', 'Civilian'].indexOf(r) >= 0), T.roles);
need('the published count is exactly the people', T.sumMatches === true, { byRole: T.byRole, n: T.unemployed });
need('SETUP: there is a free seat to send somebody to', (T.placements | 0) > 0, T.placements);
need('🔴 somebody on an errand is not offered to camps', T.dropsWhenBusy === true,
     { accepted: T.errandAccepted, before: T.beforeSum, after: T.afterSum, seats: T.placements });
need('CONTROL: …but they are still listed in their own city', T.stillListed === true, T.stillListed);
need('THE ASK: the city says camps can hire these people', T.campNote === true, T.campNote);
need('…and each card names the trade they would go as', T.cardRole === true && T.namesATrade === true, T);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2).slice(0, 4500));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — the workers come out of somebody\'s city, and the board can no longer invent them.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
