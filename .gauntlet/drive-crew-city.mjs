/* ══════════════════════════════════════════════════════════════════════════
   👷 DRIVE-CREW-CITY — units can be posted to the CITY, not just to the farms.

   THE ASK: "add the units being assigned to city buildings for work and
   boosting of producing."

   🔴 WHAT WAS ACTUALLY WRONG, MEASURED. The work system shipped whole — post a
      unit, it lifts the building, capped at x2.00 — and then covered 31 of the
      city's 175 building types. Everything else had a `crew` requirement (the
      city counted them as staffed workplaces and charged them a wage bill) and
      workNeeds() returned [] for every one, so slotsAt() answered 0 and the
      Work Crew card never rendered at all. A player who built the industrial
      chain, six power stations and a high street went looking for somewhere to
      put their units and found the starter farms and mines. Nothing explained
      it, because from the UI's side there was nothing to explain — the card was
      simply absent.

   🔴 AND THE HIGH STREET WAS BLOCKED TWICE. slotsAt also refuses any building
      with neither `gen` nor `svc` — "a building the tick does not multiply
      cannot use a crew" — which was true when it was written and stopped being
      true when patronage started paying shops from residents walking in. So
      the shops, the only buildings a player watches make money, needed both the
      work table AND the guard fixing.

   Pinned, with controls:
     · the work table covers the city, not a corner of it
     · every trade named is one of the thirteen a unit can actually roll
     · a shop patronage pays is crewable — Gym, Clothier, Game Store
     · 🔴 CONTROL: decor and roads are still NOT crewable
     · 🔴 CONTROL: a construction site refuses a post, and says why
     · a posted unit lifts that shop's takings…
     · 🔴 CONTROL: …and ONLY that shop's — the one next door is untouched
     · 🔴 CONTROL: the lift is capped at x2.00, and floors at x1
     · 🔴 CONTROL: it cannot mint past the node's daily ceiling

   Run:  node .gauntlet/drive-crew-city.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9490 + (process.pid % 40);
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
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.__nc.jobfair', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(6000);

const out = {};

/* ══ 1 · the table itself ══════════════════════════════════════════════════ */
out.table = await pg.evaluate(async () => {
  const W = await import('/src/work/work.js');
  const kinds = new Set(W.WORK_TYPES.map(k => k.id));
  const bad = [];
  for (const [bld, ws] of Object.entries(W.BUILDING_WORK)) {
    for (const w of ws) if (!kinds.has(w)) bad.push(bld + ':' + w);
  }
  const keys = Object.keys(W.BUILDING_WORK);
  return {
    covered: keys.length,
    kinds: kinds.size,
    unknownTrades: bad,
    dupes: keys.filter((k, i) => keys.indexOf(k) !== i),
    /* the buildings the ask is really about */
    gym: W.workNeeds('gym'),
    clothier: W.workNeeds('clothier'),
    steelmill: W.workNeeds('steelmill'),
    nuclear: W.workNeeds('nuclear'),
    college: W.workNeeds('college'),
    /* 🔴 CONTROL: decor has no trade and must not gain one. */
    tree: W.workNeeds('tree'),
    road: W.workNeeds('road'),
    housing: W.workNeeds('housing'),
  };
});

/* ══ 2 · a shop patronage pays is actually crewable in a real city ═════════ */
out.city = await pg.evaluate(async () => {
  const J = window.__nc.jobfair, N = window.__nc;
  const o = {};
  J.setPop(40);
  const CREW = N.crew();
  o.haveCrew = !!CREW;
  if (!CREW) return o;

  /* 🛏 BEDS FIRST. The crew cap is housing-derived, and without a bed enlist()
     refuses every unit — which reads in the results as "the feature does not
     work" when what actually happened is the test city had nowhere to sleep. */
  J.plant('2,2', 'housing'); J.plant('2,3', 'housing'); J.plant('3,2', 'housing');

  /* one of each: a shop patronage pays, a classic producer, and decor */
  J.plant('4,4', 'gym');
  J.plant('5,4', 'clothier');
  J.plant('6,4', 'farm');
  J.plant('7,4', 'tree');
  /* 🏬 …and a spread of the high street, because a unit's suitabilities are
     ROLLED from its card. Testing only the Gym makes the whole assertion ride
     on whether this particular hand happened to roll Performing or Guarding —
     it did not, and the first run failed on a lucky-draw problem rather than
     on anything about the feature. Between them these six cover nine of the
     thirteen trades, so any reasonable hand can work SOMEWHERE. */
  const SHOPS = [['4,4', 'gym'], ['5,4', 'clothier'], ['8,4', 'gamestore'],
                 ['9,4', 'pharmacy'], ['10,4', 'fastfood'], ['11,4', 'greatbuy']];
  for (const [k, ty] of SHOPS) J.plant(k, ty);
  o.shopKeys = SHOPS.map(x => x[0]);
  o.shopsCrewable = SHOPS.filter(([k]) => CREW.takesWork(k)).length;
  o.shopsPlanted = SHOPS.filter(([k]) => !!J.tile(k)).length;
  o.planted = ['4,4', '5,4', '6,4', '7,4'].map(k => (J.tile(k) || {}).type || null);

  o.gymTakesWork = CREW.takesWork('4,4');
  o.clothierTakesWork = CREW.takesWork('5,4');
  o.farmTakesWork = CREW.takesWork('6,4');
  /* 🔴 CONTROL: a tree is not a workplace and never becomes one. */
  o.treeTakesWork = CREW.takesWork('7,4');
  o.gymSlots = CREW.slotsAt('4,4');

  /* the patronage predicate the guard now leans on */
  o.paysGym = !!(N.jobfair.patronage && N.jobfair.patronage.venues().some(v => v.key === '4,4'));
  /* 👷 …and every venue reports its crew multiplier, x1 with nobody posted */
  const v = N.jobfair.patronage.venues().find(x => x.key === '4,4');
  o.venueBoostIdle = v ? v.boost : null;
  return o;
});

/* ══ 3 · post a real unit and watch the shop's multiplier move ═════════════ */
out.post = await pg.evaluate(async () => {
  const N = window.__nc, CREW = N.crew();
  const o = {};
  if (!CREW) return { skipped: 'no crew module' };
  const cards = N.cards().filter(c => c && c.type !== 'Structure');
  o.cardsAvailable = cards.length;
  if (!cards.length) return { skipped: 'no cards' };

  o.multBefore = N.crewMult('4,4');
  /* 🔴 post() RETURNS null ON SUCCESS AND A SENTENCE ON REFUSAL. The first
     version of this loop tested `!r || typeof r === 'boolean' ? r : !r.err`,
     which is a precedence bug AND the wrong contract — it reported posted:true
     while the crew was empty and the multiplier was still 1.00. A driver that
     says it did something it did not do is worse than one that fails.
     ⚠ REFUSALS ARE COLLECTED, NOT SWALLOWED. A unit with no suitability for
       the trades a Gym needs is a legitimate refusal, and the difference
       between "no card in this hand can do it" and "the feature is broken" is
       only visible if the reasons are reported. */
  const refusals = [];
  let posted = null, at = null;
  const SHOPS = ['4,4', '5,4', '8,4', '9,4', '10,4', '11,4'];
  outer:
  for (const c of cards.slice(0, 40)) {
    const e = N.enlist(c.id);
    if (e !== null && !/Already/.test(String(e))) { refusals.push('enlist:' + e); continue; }
    for (const k of SHOPS) {
      const r = N.postCrew(c.id, k);
      if (r === null) { posted = c.id; at = k; break outer; }
      refusals.push(k + ': ' + String(r).slice(0, 50));
    }
  }
  o.refusals = refusals.slice(0, 5);
  o.posted = !!posted;
  o.postedCard = posted;
  o.postedAt = at;
  o.multAfter = at ? N.crewMult(at) : null;
  o.powers = at ? N.crewPowers(at).length : 0;
  const vens = N.jobfair.patronage.venues();
  const v = vens.find(x => x.key === at);
  o.venueBoostAfter = v ? v.boost : null;
  /* 🔴 CONTROL: EVERY OTHER SHOP IS UNTOUCHED. A crew lifts the building it is
     posted to, not the city — so this checks all five of the others, not just
     the neighbour, and reports the worst offender rather than an average. */
  o.othersBoost = SHOPS.filter(k => k !== at)
    .map(k => (vens.find(x => x.key === k) || {}).boost);
  o.othersAllIdle = o.othersBoost.every(x => x === 1);
  /* 🔴 CONTROL: the cap the whole system agrees on. */
  o.multIsCapped = (o.multAfter || 1) <= 2.0001;
  return o;
});

/* ══ 4 · the boost on the till, and both of its bounds ═════════════════════ */
out.till = await pg.evaluate(async () => {
  const mod = await import('/src/city/patronage.js');
  const PP = mod.default || mod;
  const cits = Array.from({ length: 60 }, (_, i) => ({ id: 'c' + i, mood: 80 }));
  const day = (boostA) => {
    PP.reset();
    const V = [{ key: 'A', type: 'grocery', open: true, boost: boostA },
               { key: 'B', type: 'grocery', open: true, boost: 1 }];
    const by = {}; let tot = 0;
    for (let m = 0; m < 1440; m++) {
      const r = PP.tick({ citizens: cits, venues: V, cityMul: 1, econMul: 1, tierRate: 20, day: 0, dtMin: 1 });
      for (const k in r.byTile) by[k] = (by[k] || 0) + r.byTile[k];
      tot += r.credited;
    }
    return { A: Math.round(by.A || 0), B: Math.round(by.B || 0), tot: Math.round(tot) };
  };
  return {
    idle: day(1), crewed: day(2),
    absurd: day(99),      // 🔴 must equal `crewed` exactly — clamped, not scaled
    zero: day(0),         // 🔴 must equal `idle` — floored, never punitive
    missing: day(undefined),
    cap: PP.PATRON.BOOST_CAP,
    /* 🔴 the ceiling still wins: a fully crewed top-tier city cannot mint past
       the node's daily cap however many units are posted. */
    ceiling: (() => {
      PP.reset();
      const V = Array.from({ length: 17 }, (_, i) => ({ key: 'k' + i, type: 'grocery', open: true, boost: 2 }));
      const many = Array.from({ length: 400 }, (_, i) => ({ id: 'z' + i, mood: 100 }));
      let tot = 0;
      for (let m = 0; m < 1440; m++) tot += PP.tick({ citizens: many, venues: V, cityMul: 1.2, econMul: 1.2, tierRate: 20, day: 0, dtMin: 1 }).credited;
      return { earned: Math.round(tot), cap: Math.round(PP.capPerMin(20) * 1440) };
    })(),
  };
});

/* ══ 5 · 🔴 a site refuses a post and SAYS SO ══════════════════════════════ */
out.site = await pg.evaluate(() => {
  const N = window.__nc, CREW = N.crew();
  if (!CREW) return { skipped: 'no crew' };
  const cards = N.cards().filter(c => c && c.type !== 'Structure');
  if (!cards.length) return { skipped: 'no cards' };
  const r = CREW.canWorkAt(cards[0].id, '9,9');   // nothing built there
  return { ok: r && r.ok, why: r && r.why };
});

/* ══ 🔴 THE PATH A PLAYER ACTUALLY TAKES ═══════════════════════════════════
   Reported: "the system to add units from the players collection to work in
   buildings is not working, I cannot add my units."
   Nothing was broken in isolation — the collection reached the city, the
   roster rendered, enlist and post both worked. THIS DRIVER PASSED THROUGHOUT,
   because every stage above calls N.enlist(id) and N.postCrew(id, k) straight
   through the seam. It never once clicked a button.
   The player's route is: building → 'Post a worker here' → a dialog that said
   'Nobody is on the work crew. Enlist someone first.' and offered only CLOSE.
   It told them what to do and gave them no way to do it; the enlist button was
   on a side card nothing on that path mentions.
   So this stage uses the DOM only — no seam calls — and walks the exact route
   the report describes. A seam that can do something the UI cannot is not a
   feature, it is a test passing itself. */
out.uiPath = await pg.evaluate(async () => {
  const N = window.__nc, J = N.jobfair, C = N.crew();
  const o = { haveCrew: !!C };
  if (!C) return o;
  /* a fresh situation: beds, a farm, and an empty crew */
  for (const id of C.crewIds ? C.crewIds() : []) { try { C.dismiss(id); } catch (e) {} }
  J.setPop(30);
  J.plant('3,3', 'housing'); J.plant('3,4', 'housing');
  J.plant('5,5', 'farm');
  o.beds = C.crewCap();
  o.crewAtStart = C.state().length;

  /* 1 · the player opens the building's 'who works here' dialog */
  C.openTilePicker('5,5');
  await new Promise((r) => setTimeout(r, 350));
  const box = document.getElementById('crewpick');
  o.dialogOpen = !!box;
  /* 🔴 …and it must offer a way OUT of the empty state, not just Close. */
  const enlistBtn = document.getElementById('pk-enlist');
  o.hasEnlistButton = !!enlistBtn;
  o.enlistEnabled = !!(enlistBtn && !enlistBtn.disabled);
  o.closeIsNotTheOnlyControl = !!(box && box.querySelectorAll('.pfoot button').length > 1);
  if (!enlistBtn || enlistBtn.disabled) return o;

  /* 2 · they click it, and get their own collection */
  enlistBtn.click();
  await new Promise((r) => setTimeout(r, 500));
  const picker = document.getElementById('cardpicker');
  o.pickerOpened = !!picker;

  /* 🔴 …AND IT MUST BE THE THING THE PLAYER CAN ACTUALLY TOUCH.
     Reported: "the modal does not disappear and the list appears behind it."
     ⚠ NOT ASSERTED BY READING z-index. Two elements' z-indexes only decide
       the winner when they share a stacking context, and the numbers being in
       the right order proves nothing about what a click at that pixel hits.
       elementFromPoint asks the browser the same question the mouse does. */
  o.dialogHiddenWhilePicking = !!(box && box.offsetParent === null);
  if (picker) {
    const r0 = picker.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r0.left + r0.width / 2),
                                          Math.round(r0.top + r0.height / 2));
    o.pickerIsOnTop = !!(hit && (hit === picker || picker.contains(hit)));
    /* the ask: wide, and two at a time rather than one long column */
    const cpbox = picker.querySelector('.cpbox');
    const cplist = picker.querySelector('.cplist');
    o.boxIsWide = !!(cpbox && cpbox.classList.contains('wide'));
    o.boxPx = cpbox ? Math.round(cpbox.getBoundingClientRect().width) : 0;
    o.columns = cplist
      ? String(getComputedStyle(cplist).gridTemplateColumns).trim().split(/[ ]+/).filter(Boolean).length
      : 0;
  }
  const rows = picker ? Array.from(picker.querySelectorAll('button')).filter((b) => b.textContent.trim() && !/close|cancel/i.test(b.textContent)) : [];
  o.choices = rows.length;
  /* 🔴 …AND THE ROWS HAVE TO SAY SOMETHING TRUE.
     Every trade line here rendered the literal text "undefined undefined" —
     the picker read sv.id/sv.label off a suit that has only { type, level }.
     Counting the rows proved the list was populated and said nothing about
     whether it was legible, which is the entire point of this dialog. */
  o.rowsSayingUndefined = rows.filter((r) => /undefined/i.test(r.textContent)).length;
  o.rowsShowingATrade = rows.filter((r) => /(Planting|Generating|Mining|Hauling|Cooking|Tending|Building|Guarding|Teaching|Healing|Selling|Driving|Crafting)/.test(r.textContent)).length;
  if (!rows.length) return o;

  /* 3 · they pick one — and it should end up WORKING, not merely enlisted.
     ⚠ A UNIT THAT CANNOT FARM IS NOT A BUG, so the row is chosen rather than
       taken blind. The first version clicked rows[0], drew a unit with no
       Planting suitability, and failed an assertion against the system behaving
       exactly right — canWorkAt refused it and the flow correctly fell back to
       'here is where it COULD work'. Both outcomes are legitimate; this stage
       is about the posting one, so it picks a unit that qualifies. */
  const suited = N.cards().filter((c) => c.type !== 'Structure')
    .find((c) => { try { const r = C.canWorkAt(c.id, '5,5'); return r && r.ok; } catch (e) { return false; } });
  o.foundSuitable = !!suited;
  const row = suited ? rows.find((b) => b.textContent.indexOf(suited.name) >= 0) : null;
  o.rowForSuitable = !!row;
  (row || rows[0]).click();
  await new Promise((r) => setTimeout(r, 600));
  o.crewAfter = C.state().length;
  o.postedAtFarm = C.postsAt('5,5').length;
  o.multiplier = N.crewMult('5,5');
  if (!o.postedAtFarm) return o;

  /* 🔴 …AND A VISIBLE WAY BACK OFF THE JOB.
     Asked for: "add a remove button to remove the units from the building."
     Clicking the posted row already recalled the unit, but silently — the
     control has to be findable without guessing, so this walks the DOM for it
     rather than calling unpost(). */
  C.openTilePicker('5,5');
  await new Promise((r) => setTimeout(r, 350));
  const rem = document.querySelector('#crewpick [data-unpost]');
  o.hasRemove = !!rem;
  o.removeLabelled = !!(rem && /remove/i.test(rem.textContent));
  /* ⚠ a <button> nested in a <button> is unnested by the parser and would
       land OUTSIDE its row — so check it is still inside the option it acts on */
  o.removeInsideRow = !!(rem && rem.closest('[data-pick-card]'));
  if (!rem) return o;
  rem.click();
  await new Promise((r) => setTimeout(r, 400));
  o.postedAfterRemove = C.postsAt('5,5').length;
  o.multiplierAfterRemove = N.crewMult('5,5');
  o.stillOnCrew = C.state().length;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const T = out.table || {}, C = out.city || {}, PO = out.post || {}, TI = out.till || {}, S = out.site || {};

need('THE ASK: the work table covers the city, not a corner of it',
     (T.covered || 0) >= 110, { covered: T.covered });
need('🔴 every trade named is one a unit can actually roll',
     Array.isArray(T.unknownTrades) && T.unknownTrades.length === 0, T.unknownTrades);
need('…and no building is listed twice', (T.dupes || []).length === 0, T.dupes);
need('THE ASK: the Gym has work', (T.gym || []).length > 0, T.gym);
need('…the high street has work', (T.clothier || []).length > 0, T.clothier);
need('…heavy industry has work', (T.steelmill || []).length > 0, T.steelmill);
need('…power stations have work', (T.nuclear || []).length > 0, T.nuclear);
need('…and the schools have work', (T.college || []).length > 0, T.college);
need('🔴 CONTROL: decor gained nothing', (T.tree || []).length === 0 && (T.road || []).length === 0, T);
/* 🏠 "housing is not a job" — the owner's words, from the job-newspaper round.
   It stays out of the work table for the same reason it left the adverts. */
need('🔴 CONTROL: housing is still not a job', (T.housing || []).length === 0, T.housing);

need('SETUP: the crew module mounted', C.haveCrew === true, C.haveCrew);
need('SETUP: the test buildings stand', (C.planted || []).filter(Boolean).length === 4, C.planted);
need('🔴 THE ASK: a shop patronage pays is crewable', C.gymTakesWork === true, C);
need('…and so is the one next to it', C.clothierTakesWork === true, C);
need('CONTROL: a farm still is, as it always was', C.farmTakesWork === true, C);
need('🔴 CONTROL: a tree is not a workplace', C.treeTakesWork === false, C);
need('a shop offers at least one post', (C.gymSlots || 0) >= 1, C.gymSlots);
need('…and the whole high street is crewable, not just one of them',
     C.shopsCrewable === C.shopsPlanted && C.shopsPlanted > 0,
     { crewable: C.shopsCrewable, planted: C.shopsPlanted });
need('👷 every venue reports a crew multiplier, x1 when nobody is posted',
     C.venueBoostIdle === 1, C.venueBoostIdle);

if (PO.skipped) console.log('  · post stage skipped: ' + PO.skipped);
else {
  need('SETUP: a unit was posted to the shop', PO.posted === true && PO.powers > 0,
       { posted: PO.posted, powers: PO.powers, refusals: PO.refusals });
  need('THE ASK: posting a unit lifts that shop', (PO.multAfter || 0) > (PO.multBefore || 0),
       { at: PO.postedAt, before: PO.multBefore, after: PO.multAfter });
  need('…and the venue handed to patronage carries the lift',
       (PO.venueBoostAfter || 0) === (PO.multAfter || 0) && PO.venueBoostAfter > 1,
       { venue: PO.venueBoostAfter, mult: PO.multAfter });
  need('🔴 CONTROL: every other shop is untouched',
       PO.othersAllIdle === true, { postedAt: PO.postedAt, others: PO.othersBoost });
  need('🔴 CONTROL: the lift is capped at x2.00', PO.multIsCapped === true, PO);
}

need('THE ASK: a crewed shop takes more than an idle one',
     (TI.crewed || {}).A > (TI.idle || {}).A * 1.5, { idle: (TI.idle || {}).A, crewed: (TI.crewed || {}).A });
need('🔴 CONTROL: the shop next door is unaffected on the till',
     Math.abs(((TI.crewed || {}).B || 0) - ((TI.idle || {}).B || 0)) / Math.max(1, (TI.idle || {}).B) < 0.02,
     { idle: (TI.idle || {}).B, crewed: (TI.crewed || {}).B });
need('🔴 CONTROL: an absurd multiplier CLAMPS, it does not scale',
     JSON.stringify(TI.absurd) === JSON.stringify(TI.crewed), { absurd: TI.absurd, crewed: TI.crewed });
need('🔴 CONTROL: a zero multiplier floors at x1, it is never punitive',
     JSON.stringify(TI.zero) === JSON.stringify(TI.idle), { zero: TI.zero, idle: TI.idle });
need('🔴 CONTROL: a missing multiplier behaves as no crew',
     JSON.stringify(TI.missing) === JSON.stringify(TI.idle), { missing: TI.missing, idle: TI.idle });
need('the cap is the same x2 the city uses', TI.cap === 2, TI.cap);
need('🔴 CONTROL: a fully crewed city still cannot mint past the daily ceiling',
     (TI.ceiling || {}).earned <= (TI.ceiling || {}).cap, TI.ceiling);

if (S.skipped) console.log('  · site stage skipped: ' + S.skipped);
else {
  need('🔴 CONTROL: an empty plot refuses a post', S.ok === false, S);
  need('…and says why rather than failing silently', /\w/.test(String(S.why || '')), S);
}

/* ── 🔴 the route the player actually walks ───────────────────────────────── */
const UI = out.uiPath || {};
need('SETUP: the crew module mounted for the UI path', UI.haveCrew === true, UI.haveCrew);
need('SETUP: the city has beds and an empty crew', (UI.beds || 0) > 0 && UI.crewAtStart === 0, UI);
need('SETUP: the building dialog opens', UI.dialogOpen === true, UI);
need('🔴 THE BUG: the empty dialog offers a way to ENLIST, not just Close',
     UI.hasEnlistButton === true && UI.closeIsNotTheOnlyControl === true, UI);
need('…and it is usable when there are beds', UI.enlistEnabled === true, UI);
need('THE ASK: clicking it shows the player their own collection',
     UI.pickerOpened === true && (UI.choices || 0) > 0, UI);
need('🔴 no row in the picker renders the text "undefined"',
     UI.rowsSayingUndefined === 0, UI);
need('…and units with a trade actually name it', (UI.rowsShowingATrade || 0) > 0, UI);
need('🔴 THE BUG: the collection opens IN FRONT, not behind the dialog',
     UI.pickerIsOnTop === true, UI);
need('🔴 …and the dialog that opened it gets out of the way',
     UI.dialogHiddenWhilePicking === true, UI);
need('THE ASK: the list is wide, not a long narrow column',
     UI.boxIsWide === true && (UI.boxPx || 0) > 600, UI);
need('THE ASK: …laid out two at a time', UI.columns === 2, UI);
need('🔴 …and picking a unit puts it ON the crew', UI.crewAfter === 1, UI);
if (UI.foundSuitable === false) console.log('  · post-on-enlist not asserted: no unit in this hand can farm');
else {
  need('SETUP: the suitable unit had a row to click', UI.rowForSuitable === true, UI);
  need('🔴 …and POSTS it to the building that asked, in one action',
       UI.postedAtFarm === 1, UI);
  need('…and the buildings output actually rises', (UI.multiplier || 0) > 1, UI.multiplier);
  need('THE ASK: the building offers a visible Remove control',
       UI.hasRemove === true && UI.removeLabelled === true, UI);
  need('…inside the row it acts on, not unnested by the parser',
       UI.removeInsideRow === true, UI);
  need('🔴 …and it actually takes the unit off the building',
       UI.postedAfterRemove === 0, UI);
  /* CONTROL: removing is not dismissing. The unit comes off the JOB and stays
     on the crew — a Remove that quietly un-enlisted would look identical here
     and cost the player their bed. */
  need('CONTROL: removed from the job, still on the crew', UI.stillOnCrew === 1, UI);
  need('CONTROL: and the buildings bonus goes back down',
       Math.abs((UI.multiplierAfterRemove || 0) - 1) < 1e-9, UI);
}

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — units go to work across the whole city, they lift the building they are in and nothing else, and the ceiling still holds.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
