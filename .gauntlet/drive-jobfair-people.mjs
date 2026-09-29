/* ══════════════════════════════════════════════════════════════════════════
   🧑 DRIVE-JOBFAIR-PEOPLE — housing is not a job, and the unemployed have names.

   THE ASK:
     · "in this job newspaper modal, remove housing as housing is not a job"
     · "add the list of npcs in a player city that do not have jobs, give in
        their details what the npc is good at … show where they would be placed
        where they would be good at and the highest education they have"
     · "players can choose to have them find a job and at what business … or
        send them to school and what school … make the time random on when they
        complete the task not instant"

   WHAT WAS THERE: every housing tile is founded as a `landlord` firm, so the
   bulletin printed one "Housing · Property Company" advert PER HOUSE — a city
   with twelve homes read as twelve businesses hiring. And the paper listed only
   vacancies: it could say four posts were unfillable and leave the player with
   nothing to do but build a school and wait.

   🔴 HOUSING IS REMOVED FROM THE PAPER BUT NOT FROM THE ECONOMY, and the
      difference is the point. Housing is the ONLY producer of
      constructionComponents in the city, and the housing line of the household
      basket buys exactly that to keep the homes standing — zeroing its crew
      would have looked tidier and cut the city's only supply of its own upkeep.
      So those posts still exist, still compete for the same skilled residents,
      and are DISCLOSED in a line rather than hidden. A bulletin that dropped
      them silently would say "short 3" while three more skilled workers were
      being taken by houses the reader was never shown.

   Pinned, with controls:
     · no Housing advert survives            + CONTROL: real businesses still do
     · the upkeep posts are counted, not lost + CONTROL: the note names them
     · unemployed residents get a card each  + CONTROL: an employed one gets none
     · a card carries schooling and aptitude, and both are STABLE across renders
     · the suggested placement is a building that really stands in this city
     · sending to work does NOT seat them instantly …
     · … and the errand completes on its own later    ← the "not instant" ask
     · CONTROL: a second errand for the same person is refused
     · CONTROL: schooling cannot skip a rung

   Run:  node .gauntlet/drive-jobfair-people.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9160 + (process.pid % 40);
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
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.MythicCitizens && typeof window.MythicCitizens.unemployed === "function"', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(4000);

const out = {};

/* ── give the city something to offer ────────────────────────────────────── */
/* A fresh node is an empty field: no business with a seat, no school. Without
   these four tiles the two verbs under test have nothing to act on and the
   driver would report a hollow pass. They are planted through the same narrow
   hook `bldPlant` set the precedent for, and every rule about who may work or
   study where is still enforced by the shipped code. */
out.planted = await pg.evaluate(() => {
  const j = window.__nc && window.__nc.jobfair;
  if (!j || typeof j.plant !== 'function') return { err: 'no plant hook' };
  const o = { houses: 0, seats: 0 };
  /* 40 residents against a handful of seats — a normal city, and the only
     shape in which "who has no job" is a question with an answer. */
  o.pop = j.setPop(40);
  /* 🏘 HOUSES FIRST, AND MOST OF THEM. The roster is capped by the CITY'S
     POPULATION (citCap → cityPop), so a city with nine job seats and eight
     residents employs everybody and this driver measures an empty list —
     which is exactly the hollow pass it caught on its first run. Housing
     raises popCap 6 a tile and carries NO crew of its own, so it adds people
     without adding jobs: that gap is the whole subject of the test. */
  for (let i = 0; i < 8; i++) { if (j.plant((10 + i) + ',9', 'housing')) o.houses++; }
  const seat = (k, t) => { const r = j.plant(k, t); if (r) o.seats += r.crew | 0; return r; };
  o.farm = seat('5,5', 'farm');
  o.quarry = seat('6,5', 'quarry');
  o.elem = seat('7,5', 'elemschool');
  o.mid = seat('8,5', 'midschool');
  o.college = seat('9,5', 'college');
  return o;
});
await pg.waitForTimeout(6000);   // the economy syncs buildings on a 4s beat — tileBands is empty before it runs

/* ── the model: cards, stability, and the suggestion ─────────────────────── */
Object.assign(out, await pg.evaluate(() => {
  const o = {};
  const M2 = window.MythicCitizens;
  o.reachable = !!(M2 && typeof M2.unemployed === 'function');
  if (!o.reachable) return o;
  const un = M2.unemployed();
  o.unemployedCount = un.length;
  o.sample = un.slice(0, 3).map(p => ({
    id: p.id, name: p.name, rung: p.rung, eduLabel: p.eduLabel, band: p.band,
    apt: p.aptName, suggest: p.suggest ? p.suggest.name : null,
  }));
  /* Every card must carry a real name, a real rung and a real aptitude — a
     blank on any of these is a card that describes nobody. */
  o.allComplete = un.every(p => p.name && p.rung && p.eduLabel && p.aptName && p.band);
  /* STABILITY: asked twice, the same person is the same person. A card whose
     aptitude re-rolled per render would be a different human every time the
     player opened the paper. */
  const un2 = M2.unemployed();
  o.stable = un.length === un2.length
    && un.every((p, i) => p.aptName === un2[i].aptName && p.rung === un2[i].rung);
  /* CONTROL: employed residents are NOT on this list. */
  const all = M2.list();
  const employedIds = new Set(all.filter(c => c.job).map(c => c.id));
  o.employedTotal = employedIds.size;
  o.noEmployedOnList = un.every(p => !employedIds.has(p.id));
  /* A suggestion must name a building that is really standing here. */
  const placeKeys = new Set((M2.placements() || []).map(p => p.key));
  o.placementsOpen = placeKeys.size;
  o.suggestionsReal = un.every(p => !p.suggest || placeKeys.has(p.suggest.key));
  o.schools = (M2.schools() || []).map(s => s.rung);
  return o;
}));

/* ── the paper: no housing, and the roster is on the page ────────────────── */
Object.assign(out, await pg.evaluate(async () => {
  const o = {};
  /* Through the module's own driver hook — the whole job-fair screen is
     module-scoped, which is exactly why __nc.jobfair.open exists. */
  try { await window.__nc.jobfair.open(); } catch (e) { o.openErr = String(e).slice(0, 160); }
  const paper = document.getElementById('jf-paper');
  o.paperRendered = !!(paper && paper.innerHTML.length > 200);
  const txt = paper ? paper.textContent : '';
  /* 🔴 THE ASK. Not "fewer housing ads" — none. */
  o.housingAds = (paper ? paper.querySelectorAll('.jf-ad') : []).length
    ? Array.from(paper.querySelectorAll('.jf-ad')).filter(a => /Property Company/i.test(a.textContent)).length
    : 0;
  o.totalAds = paper ? paper.querySelectorAll('.jf-ad').length : 0;
  o.hasSeekerSection = /Looking for work/i.test(txt);
  o.idCards = paper ? paper.querySelectorAll('.jf-id').length : 0;
  o.upkeepNoted = /Housing upkeep is also taking/i.test(txt);
  const d = (window.MythicEconomy && window.MythicEconomy.jobs) ? window.MythicEconomy.jobs() : null;
  o.upkeepPosts = d && d.upkeep ? d.upkeep.posts : null;
  /* CONTROL: the firm rows the paper DOES show carry no landlord. */
  o.landlordRows = d ? (d.firms || []).filter(f => f.ind === 'landlord').length : null;
  o.firmRows = d ? (d.firms || []).length : null;
  return o;
}));

/* ── the verbs: not instant, and guarded ─────────────────────────────────── */
Object.assign(out, await pg.evaluate(() => {
  const o = {};
  const M2 = window.MythicCitizens;
  const un = M2.unemployed();
  const places = M2.placements() || [];
  if (!un.length || !places.length) { o.skipped = 'no unemployed resident or no open seat in this fresh city'; return o; }
  const who = un[0].id, where = places[0].key;
  const r = M2.sendToJob(who, where);
  o.accepted = !!(r && r.ok);
  /* 🔴 THE "NOT INSTANT" ASK, MEASURED: immediately after accepting, they must
     still have no job — only an errand with time left on it. */
  const after = M2.unemployed().find(p => p.id === who);
  o.stillUnemployed = !!after;
  o.hasErrand = !!(after && after.task && after.task.kind === 'job');
  o.msLeft = after && after.task ? (after.task.doneAt - Date.now()) : null;
  o.seatedInstantly = (M2.get(who) || {}).job === where;
  /* CONTROL: one errand per person. */
  const second = M2.sendToJob(who, where);
  o.secondRefused = !!(second && !second.ok);
  o.secondWhy = second && second.why;
  /* CONTROL: schooling cannot skip rungs. */
  const schools = M2.schools() || [];
  o.schoolRungs = schools.map(x => x.rung);
  const uni = schools.find(s => s.rung === 'university' || s.rung === 'college');
  if (uni) {
    const other = M2.unemployed().find(p => p.id !== who);
    if (other) {
      const sk = M2.sendToSchool(other.id, uni.key);
      o.skipRefused = !!(sk && !sk.ok);
      o.skipWhy = sk && sk.why;
    }
  } else o.skipRefused = 'no college/university in this fresh city';
  return o;
}));

/* ── and it completes on its own ─────────────────────────────────────────── */
out.completion = await pg.evaluate(async () => {
  const M2 = window.MythicCitizens;
  const er = (M2.errands() || []).filter(e => e.kind === 'job')[0];
  if (!er) return { skipped: 'no errand in flight' };
  /* Rather than waiting out a random 45s–6min delay, pull the deadline into the
     past and run the REAL beat — __nc.jobfair.pull calls citTaskTick itself, so
     what completes here is the shipped path and not a copy of it. */
  const had = M2.errands().length;
  let ran = null;
  try { ran = window.__nc.jobfair.pull(er.cit); } catch (e) { return { err: String(e).slice(0, 140) }; }
  const c = M2.get(er.cit);
  return { hadErrands: had, ran, seatedNow: !!(c && c.job), seatKey: c && c.job,
           left: (M2.errands() || []).length };
});

/* ── 🧑‍💼 the Employment Office ───────────────────────────────────────────── */
out.office = await pg.evaluate(() => {
  const o = {};
  const j = window.__nc.jobfair;
  /* The building has to be BUYABLE and VISIBLE, not just defined: a BUILDINGS
     row missing from BUILD_SECTIONS cannot be bought, and one missing from
     buildMesh is an invisible building on a paid-for tile — the failure that
     file warns about in capitals. */
  try {
    const def = window.__nc.jobfair.buildingDef("employoffice");
    o.defined = !!def;
    o.boost = def && def.hireBoost;
    o.inShop = window.__nc.BUILD_SECTIONS.some(sec => sec.items.indexOf("employoffice") >= 0);
    /* meshBox is the module's own probe for exactly this failure — an empty
       THREE.Group is an invisible building on a paid-for tile. CONTROL below. */
    const mb = window.__nc.meshBox("employoffice", 1);
    o.meshes = mb && mb.meshes; o.meshEmpty = mb && mb.empty;
    o.controlNoArm = window.__nc.meshBox("definitely-not-a-building", 1);
    o.before = window.__nc.jobfair.hireChance();
    j.plant("12,12", "employoffice");
    o.after = window.__nc.jobfair.hireChance();
    /* CONTROL: it saturates rather than buying instant placement. */
    for (let i = 0; i < 12; i++) j.plant("2" + i + ",13", "employoffice");
    o.saturated = window.__nc.jobfair.hireChance();
  } catch (e) { o.err = String(e).slice(0, 140); }
  return o;
});

/* ── 🎓 the schooling rule, and who it applies to ───────────────────────── */
out.grandfather = await pg.evaluate(async () => {
  const o = {};
  const M2 = window.MythicCitizens, j = window.__nc.jobfair;
  /* A building whose seats demand more schooling than anybody here has. The
     clinic bands `technical`, and this city's residents are self-taught or
     close to it, so nobody can be hired into it. */
  j.plant('20,20', 'clinic');
  await new Promise(r => setTimeout(r, 6500));   // let the economy adopt it and band it
  const bands = (window.MythicEconomy.tileBands && window.MythicEconomy.tileBands()) || {};
  o.clinicBand = bands['20,20'] || null;
  /* 🔴 THE RULE BITES ON NEW HIRES: a seat nobody qualifies for stays open
     rather than being filled by whoever is nearest. */
  const staffed = (M2.byJob('20,20') || []).length;
  o.clinicStaffed = staffed;
  /* …and the player cannot place somebody there by hand either. */
  const un = M2.unemployed();
  const low = un.find(p => p.band === 'unskilled');
  if (low) {
    const r = M2.sendToJob(low.id, '20,20');
    o.handPlaceRefused = !!(r && !r.ok);
    o.handPlaceWhy = r && r.why;
  }
  /* 🔴 CONTROL: SOMEBODY ALREADY IN A SEAT KEEPS IT. Seat an unqualified
     resident directly — the way a save written before the rule existed would
     have — then run the assignment pass and check they are still there. */
  if (low) {
    /* A SECOND clinic, so this control is not fighting the first one for seats:
       the point here is whether tenure survives the assignment pass, not who
       wins a contested seat. */
    j.plant('21,20', 'clinic');
    await new Promise(r => setTimeout(r, 6500));
    const forced = M2.setJob(low.id, '21,20');
    o.forcedIn = !!forced;
    j.setPop(40);                              // forces a citRefresh → citAssignJobs
    await new Promise(r => setTimeout(r, 400));
    const after = M2.get(low.id);
    o.keptSeat = !!(after && after.job === '21,20');
  }
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

need('the citizen roster is reachable', out.reachable === true, out.reachable);
/* 🔴 THE ANTI-HOLLOW-PASS GUARD. The first run of this driver reported PASS
   with zero unemployed residents, zero cards and both verbs skipped: every
   assertion below was vacuously true because the setup had employed the whole
   city. An assertion about an empty list is not evidence, so the SETUP is
   asserted before anything that depends on it. */
need('SETUP: the test city has residents out of work', (out.unemployedCount | 0) > 0, out.unemployedCount);
need('SETUP: …a business with a free seat', (out.placementsOpen | 0) > 0, out.placementsOpen);
need('SETUP: …and a ladder of schools to send them to',
     (out.schools || []).length >= 2, out.schools);
need('the paper renders', out.paperRendered === true, out.paperRendered);
need('🔴 THE ASK: no Housing advert is left in the paper', out.housingAds === 0, out.housingAds);
need('…and none reaches the bulletin seam either', out.landlordRows === 0, out.landlordRows);
need('CONTROL: real businesses are still advertised', (out.totalAds | 0) > 0 || (out.firmRows | 0) === 0,
     { ads: out.totalAds, firmRows: out.firmRows });
need('the housing upkeep posts are still counted', out.upkeepPosts !== null, out.upkeepPosts);
need('CONTROL: …and disclosed on the page when there are any',
     !(out.upkeepPosts > 0) || out.upkeepNoted === true, { posts: out.upkeepPosts, noted: out.upkeepNoted });

need('THE ASK: the paper has a work-seeker section', out.hasSeekerSection === true, out.hasSeekerSection);
need('…with one card per unemployed resident',
     out.idCards === out.unemployedCount, { cards: out.idCards, people: out.unemployedCount });
need('every card carries a name, schooling and an aptitude', out.allComplete === true, out.sample);
need('…and the same person reads the same twice', out.stable === true, out.stable);
need('CONTROL: employed residents get no card', out.noEmployedOnList === true,
     { employed: out.employedTotal });
need('a suggested placement is a building that really stands here', out.suggestionsReal === true, out.sample);

/* A skip here is a FAILURE, not a note: the setup above guarantees somebody
   unemployed and somewhere to send them, so a skip means the guarantee broke. */
need('the send-to-work verb was actually exercised', !out.skipped, out.skipped);
if (out.skipped) console.log('  · verbs skipped: ' + out.skipped);
else {
  need('THE ASK: sending to work is accepted', out.accepted === true, out.accepted);
  need('🔴 THE ASK: it is NOT instant — they are still unemployed', out.stillUnemployed === true, out.stillUnemployed);
  need('…and NOT seated the moment it was clicked', out.seatedInstantly === false, out.seatedInstantly);
  need('…they carry an errand with time left on it', out.hasErrand === true && out.msLeft > 0,
       { errand: out.hasErrand, msLeft: out.msLeft });
  need('CONTROL: a second errand for the same person is refused', out.secondRefused === true, out.secondWhy);
  need('CONTROL: schooling cannot skip a rung', out.skipRefused === true,
       { refused: out.skipRefused, why: out.skipWhy, schools: out.schoolRungs });
}
const C = out.completion || {};
need('the completion path was actually exercised', !C.skipped && !C.err, C);
if (C.skipped || C.err) console.log('  · completion not run: ' + JSON.stringify(C));
else {
  need('THE ASK: the errand completes on its own later', C.seatedNow === true, C);
  need('…and is taken off the list when it does', C.left === 0, C);
}
const O = out.office || {};
need('THE ASK: an Employment Office building exists', O.defined === true, O);
need('…and can actually be bought', O.inShop === true, O.inShop);
need('…and is not an invisible building on a paid-for tile', (O.meshes | 0) > 0 && O.meshEmpty === false, O);
need('CONTROL: …and the mesh probe DOES report a type with no arm as empty',
     !!(O.controlNoArm && (O.controlNoArm.empty === true || O.controlNoArm.error)), O.controlNoArm);
need('the office row carries the boost it claims', (O.boost | 0) > 0 || O.boost > 0, O.boost);
need('🔴 THE ASK: it raises the chance of finding work', O.after > O.before, { before: O.before, after: O.after });
need('CONTROL: …but stacking them cannot buy instant placement', O.saturated < 1 && O.saturated <= 0.75, O.saturated);
need('CONTROL: a city with no office still hires on its own', O.before > 0, O.before);
const G = out.grandfather || {};
need('SETUP: the clinic demands schooling this city has not got',
     G.clinicBand === 'technical' || G.clinicBand === 'advanced', G.clinicBand);
need('🔴 a seat nobody qualifies for is left OPEN, not filled by anyone',
     G.clinicStaffed === 0, G.clinicStaffed);
need('…and the player cannot place an unqualified resident by hand either',
     G.handPlaceRefused === true, G.handPlaceWhy);
need('🔴 CONTROL: somebody already in a seat KEEPS it (grandfathered)',
     G.forcedIn === true && G.keptSeat === true, G);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — no houses in the job ads, and the people out of work have names, schooling and somewhere to go.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
