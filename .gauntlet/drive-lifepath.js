/* ══ DRIVE /src/lifepath ══════════════════════════════════════════════════
   Runs inside the page after .gauntlet/scene.js has built the standard
   district. Everything it asserts on comes back through a SHIPPED seam —
   window.MythicLifepath, window.MythicCitizen.facts(), the real dialogue's
   DOM — never through a copy of the model.

   ⚠ THREE PIECES OF STATE ARE ARRANGED, AND EVERY ONE IS LABELLED. None of
     them fakes a result; each is a state the game produces on its own given
     hours of play that this pane does not have, and the thing under test still
     runs entirely through shipped code afterwards:

       A. game.pop.npc is raised. citTarget() caps the named roster at
          floor(cityPop()), and a 25-second headless city has a population of 8
          — a roster of 8 cannot show a distribution. vitalsTick grows this on
          its own over hours.
       B. a few firms are given the workers the economy would hire them. sim.js
          hands hired headcount back to firms as
          floor(employed[band] × firmShare), and with 13 employed spread over
          82 firms that floors to ZERO everywhere — so nobody in this test city
          has an economy employer at all and the career row is (correctly)
          unavailable for everyone. The SHIPPED citEmpSync() then does the
          seating; this driver never sets anybody's employer.
       C. one firm is put on level 3, which is what ECON.firm.levels' own gate
          does after enough profitable days. It is set ONCE, before the clock
          moves, and never touched again — so the promotion that follows is the
          clock's doing, not the driver's.
       D. LATE — and only after everything above has been measured without it —
          every workplace tile's `born` is pushed back 60 citizen-years, which
          is a MATURE CITY: about 480 real hours of play. This arrangement did
          not exist for round 9 and its absence was the round's worst blind
          spot. Without it the site half of the tenure ceiling is always the
          shorter one, so the Job level row is DERIVED for every citizen and
          the regime it actually spends its life in — worklife-bound, i.e.
          bound by the SAMPLED age — is never reached. See section 7b.

   ⚠ THE CLOCK IS ADVANCED WITH nc.ticks.vitalsTick, NOT nc.step, for the career
     half. Both advance game.cityAge identically (step() calls this very
     function); step() also runs economyTick, and runDay re-zeroes f.workers
     from the live labour market — which would undo (B) mid-proof.
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const nc = window.__nc;
  if (!nc) return JSON.stringify({ err: 'no __nc' });
  const out = { arranged: {} };
  const LP = window.MythicLifepath;
  out.mounted = {
    lifepath: !!LP, citizen: !!window.MythicCitizen, citizens: !!window.MythicCitizens,
    demographics: !!window.MythicDemographics, economy: !!window.MythicEconomy,
    saveShelf: !!window.MythicCitySave,
  };
  if (!LP) return JSON.stringify(out);
  out.mounted.ready = LP.ready();
  out.mounted.shelvedOnSaveShelf = LP.shelved();

  /* ── 0. let the city run: firms found, buildings age, cohorts fill ─────── */
  try { nc.manageAgents(); } catch (e) {}
  await nc.step(1200, 40);                       // 60 economic days of the real tick
  for (let i = 0; i < 12; i++) { try { nc.demog.tick(20); } catch (e) {} }

  /* ── A. arranged: the city's own NPC population ───────────────────────── */
  out.arranged.popNpcWas = +(nc.game.pop.npc || 0).toFixed(2);
  nc.game.pop.npc = 500;
  try { window.MythicCitizens.refresh(true); } catch (e) {}
  out.arranged.rosterNow = window.MythicCitizens.count();

  /* ── 1. THE CLOCK, AND EVERY INPUT IT WAS DERIVED FROM ────────────────── */
  const clk = LP.clock();
  out.clock = clk.ok ? {
    ok: true, inputs: clk.src,
    workAge: clk.workAge, retireAge: clk.retireAge, workingLifeYears: clk.workingLifeYears,
    econDaysPerYear: +clk.daysPerYear.toFixed(4),
    econCommentSays: '~24 economic days to the year (ECON.demographics.lifecycle)',
    secondsOfCityAgePerYear: Math.round(clk.secPerYear),
    realHoursOfPlayPerYear: +clk.hoursPerYear.toFixed(2),
    gradeYears: +clk.gradeYears.toFixed(3),
    lifeExpectancy: +clk.lifeExpectancy.toFixed(2),
    bands: Object.fromEntries(Object.entries(clk.bands).map(([k, v]) => [k, [+v[0].toFixed(2), +v[1].toFixed(2)]])),
  } : clk;
  if (!clk.ok) return JSON.stringify(out);

  out.sync = LP.sync();

  /* ── 2. THE SAME AGE TWICE ────────────────────────────────────────────── */
  const roster = () => window.MythicCitizens.list();
  const readAll = () => {
    const m = {};
    for (const c of roster()) { const a = LP.age(c.id); if (a.ok) m[c.id] = { y: +a.years.toFixed(6), b: a.born, band: a.band }; }
    return m;
  };
  const A1 = readAll(), A2 = readAll();
  let stable = 0; const unstable = [];
  for (const id in A1) { if (A2[id] && A2[id].y === A1[id].y && A2[id].b === A1[id].b) stable++; else unstable.push(id); }
  out.stableAcrossTwoReads = { n: Object.keys(A1).length, stable, unstable };

  /* ── 3. THE DISTRIBUTION, BOTH SIDES, PRINTED ─────────────────────────────
     🔴 AND READ THIS BEFORE QUOTING maxShareDeviation_pct OFF THIS RUN.
        The round-9 record quoted "1.32% against a one-person bound of 2.50%"
        from here as evidence that the roster reproduces the city's pyramid.
        IT IS NOT EVIDENCE AND MUST NOT BE QUOTED AGAIN. Arrangement (A) above
        sets game.pop.npc = 500, which lifts the NAMED ROSTER to 40 — but
        MythicDemographics still counts the REAL city, which is about four
        people, of whom the whole `young` band is under half a person. What that
        percentage measures is Hamilton's rounding residue against a pyramid
        with no content in it. `cityTotal_people` below is printed precisely so
        the next reader can see that for themselves.
        The claim is nonetheless true, and the run that shows it is
        .gauntlet/critlife-2-dist.mjs: 3 pyramids × 10 roster sizes (n = 1…200),
        30/30 inside the one-person bound, worst case 0.77% against 2.50%. That
        is a node probe against the model with a stubbed pyramid, which is the
        right shape of test for a claim about apportionment — a browser cannot
        give you ten roster sizes and three pyramids in one boot. */
  const pct = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, +(v * 100).toFixed(2)]));
  const d = LP.distribution();
  out.distribution = d.ok ? {
    rosterN: d.n, unstamped: d.unstamped, frameBands: d.bands,
    cityPyramid_people: Object.fromEntries(Object.entries(d.city || {}).map(([k, v]) => [k, +v.toFixed(2)])),
    cityTotal_people: +(d.cityTotal || 0).toFixed(2),
    frameTotal_people: +(d.frameTotal || 0).toFixed(2),
    frameShare_pct: pct(d.frameShare),
    rosterCount: d.rosterCount,
    rosterShare_pct: pct(d.rosterShare),
    maxShareDeviation_pct: +(d.maxShareDev * 100).toFixed(2),
    onePersonBound_pct: +((d.bound || 0) * 100).toFixed(2),
    withinOnePersonBound: d.maxShareDev <= (d.bound || 0) + 1e-9,
    /* the module's own verdict and, when it is broken, its own sentence about
       why — the seam has to be willing to report its claim failing */
    moduleSaysWithinBound: d.withinBound,
    moduleDriftSentence: d.drift,
    whyThisPercentageIsWeakHere: 'cityTotal_people is the REAL city (~4 people) ' +
      'while the roster is arranged to 40 — see the block comment. The bound is ' +
      'demonstrated properly in .gauntlet/critlife-2-dist.mjs, 30/30.',
    ages: d.ages,
  } : d;

  /* ── B + C. arranged employment and ONE firm level ────────────────────── */
  const E = window.MythicEconomy;
  const firms = E.firms();
  let staffed = 0;
  for (const f of firms) {
    if (!f.tileKey) continue;                       // tile-owned firms only
    const meta = E.industries && E.industries[f.ind];
    const band = (meta && meta.band) || 'unskilled';
    if (!(band in f.workers)) continue;
    f.workers[band] = 3;                            // ARRANGED — see the header
    staffed++;
    if (staffed >= 14) break;
  }
  const levelled = firms.find((f) => f.tileKey && Object.values(f.workers).some((n) => n > 0));
  if (levelled) levelled.level = 3;                 // ARRANGED, once, before the clock moves
  out.arranged.firmsStaffed = staffed;
  out.arranged.firmPutOnLevel3 = levelled ? { id: levelled.id, name: levelled.name, tile: levelled.tileKey } : null;
  out.arranged.namedCitizensSeatedByShippedCitEmpSync = window.MythicCitizens.sync();

  const careerSnap = () => {
    const m = {};
    for (const c of roster()) {
      const q = LP.career(c.id);
      if (q.ok) m[c.id] = { g: q.grade, cap: q.cap, r: q.rungs, capped: q.capped,
                            t: +q.tenureYears.toFixed(3), site: +q.siteYears.toFixed(3),
                            worked: +q.workedYears.toFixed(3), f: q.firm.id, from: q.tenureFrom };
    }
    return m;
  };
  const C0 = careerSnap();
  const census = (C) => {
    const o = { withFirm: 0, byGrade: {}, byCap: {}, capped: 0 };
    for (const id in C) { o.withFirm++; o.byGrade[C[id].g] = (o.byGrade[C[id].g] || 0) + 1;
                          o.byCap[C[id].cap] = (o.byCap[C[id].cap] || 0) + 1; if (C[id].capped) o.capped++; }
    return o;
  };
  out.careerCensus_before = { ...census(C0), noFirm: roster().length - Object.keys(C0).length };

  /* ── 4. SAVE ROUND TRIP THROUGH THE SHIPPED SHELF ─────────────────────── */
  const payload = JSON.parse(nc.serialize());      // ⚠ serialize() returns a STRING
  const slice = payload && payload.ext && payload.ext.lifepath;
  const before = readAll();
  const t0 = nc.game.cityAge || 0;

  /* ── 5. THE CLOCK ADVANCES — vitalsTick only, so employment survives ──── */
  const wantSec = clk.secPerYear;                  // exactly one citizen-year
  const slices = 40;
  for (let i = 0; i < slices; i++) nc.ticks.vitalsTick(wantSec / slices);
  const t1 = nc.game.cityAge || 0;

  const pick = Object.keys(before)[0];
  const a0 = before[pick], a1 = LP.age(pick);
  out.ageAdvances = {
    citizen: pick,
    cityAge_before: Math.round(t0), cityAge_after: Math.round(t1),
    secondsStepped: Math.round(t1 - t0), secondsPerYear: Math.round(clk.secPerYear),
    years_before: a0.y, years_after: +a1.years.toFixed(6),
    yearsGained: +(a1.years - a0.y).toFixed(6),
    predicted: +((t1 - t0) / clk.secPerYear).toFixed(6),
    birthStampUnchanged: a0.b === a1.born,
    band_before: a0.band, band_after: a1.band,
  };
  /* …and it is not one citizen: every stamped citizen must have gained the
     same year, because they all share one clock and one stamp each. */
  const after1 = readAll();
  let allSame = true, worst = 0;
  for (const id in before) {
    if (!after1[id]) { allSame = false; continue; }
    worst = Math.max(worst, Math.abs((after1[id].y - before[id].y) - (t1 - t0) / clk.secPerYear));
    if (after1[id].b !== before[id].b) allSame = false;
  }
  out.ageAdvances.everyCitizenGainedTheSameYear = { allBirthStampsUnchanged: allSame, worstYearError: +worst.toFixed(9) };

  /* ── 6. THE CAREER MOVED, AND WHY ─────────────────────────────────────── */
  const C1 = careerSnap();
  const moved = [];
  for (const id in C1) {
    const p = C0[id]; if (!p) continue;
    if (C1[id].g !== p.g || C1[id].r !== p.r) {
      moved.push({ id, firm: C1[id].f, firmUnchanged: p.f === C1[id].f,
        grade: p.g + ' -> ' + C1[id].g, rungs: p.r + ' -> ' + C1[id].r, cap: C1[id].cap,
        tenureYears: p.t + ' -> ' + C1[id].t, tenureBoundBy: C1[id].from,
        reason: p.f !== C1[id].f ? 'their employer changed'
              : C1[id].r !== p.r
                ? 'tenure crossed a rung: one grade per ' + clk.gradeYears.toFixed(2) +
                  ' years (ECON.demographics.education.graduatePerDay)' +
                  (C1[id].g === p.g ? ', but the employer level caps them at ' + C1[id].cap : '')
                : 'the employer level changed' });
    }
  }
  /* 🔴 SPLIT, BECAUSE THE COMBINED COUNT GOT MISQUOTED. Round 9 reported this
     as "15 citizens crossed a career rung", which reads as fifteen promotions.
     Thirteen of the fifteen were `1 -> 1`: their TENURE crossed a rung and
     their employer's level held them exactly where they were, so nothing a
     player would call a promotion happened. Both numbers are printed now and
     the grade one leads, because it is the one the panel shows. */
  const gradeMoved = moved.filter((m) => m.grade.split(' -> ')[0] !== m.grade.split(' -> ')[1]);
  out.careerAdvances = {
    gradesThatActuallyMoved: gradeMoved.length,
    tenureRungsCrossed: moved.length,
    heldByTheEmployerLevel: moved.length - gradeMoved.length,
    note: 'a crossed tenure rung is NOT a promotion when the employer level caps it; ' +
          'gradesThatActuallyMoved is the number the panel changes for.',
    moved: moved.slice(0, 10),
  };
  out.careerCensus_after = { ...census(C1), noFirm: roster().length - Object.keys(C1).length };

  /* The cap, shown as a cap: take somebody whose tenure has out-earned their
     employer and move ONLY the employer's level. */
  let capProof = { why: 'no citizen whose tenure out-earned their employer' };
  const cappedId = Object.keys(C1).find((id) => C1[id].capped);
  if (cappedId) {
    const q0 = LP.career(cappedId);
    const f = E.firm(q0.firm.id), was = f.level;
    f.level = Math.min(5, q0.rungs);
    const q1 = LP.career(cappedId);
    f.level = was;
    const q2 = LP.career(cappedId);
    capProof = { citizen: cappedId, firm: q0.firm.id, tenureYears: +q0.tenureYears.toFixed(2),
      rungsEarnedByTenure: q0.rungs,
      firmLevel: was + ' -> ' + Math.min(5, q0.rungs) + ' -> ' + was,
      grade: q0.grade + ' -> ' + q1.grade + ' -> ' + q2.grade,
      note: 'grade = min(tenure rungs, employer level); only the employer level moved' };
  }
  out.careerCapIsReal = capProof;

  /* ── 4b. …now finish the save proof, at the LATER clock ───────────────── */
  LP.load(null);
  const wiped = Object.keys(LP.stamps()).length;

  /* ── THE CONTROL, AND THE ONE THIS REPLACES ───────────────────────────────
     🔴 THE OLD CONTROL WAS ARITHMETIC, NOT A CONTROL. It re-dealt at the LATER
        clock and reported "40 of 40 differ", offered as proof that the deal
        depends on the pyramid and therefore has to be stored. It proves nothing
        of the kind: stamp = t − age·secPerYear, so shifting t by one year
        shifts EVERY stamp by exactly one year whatever the pyramid does. 40/40
        was guaranteed before the run started. It is kept below, with its delta
        measured against secPerYear, precisely so it can be seen to be that.
     ✅ THE CONTROL THE CLAIM NEEDS holds the clock STILL and moves the PYRAMID.
        The pyramid is moved through the shipped demographics pipeline
        (nc.demog.tick), not stubbed — and cityAge is recorded on both sides so
        a reader can check the clock really did not move. If the pyramid barely
        shifts the control has no teeth, so the before/after pyramid is printed
        too rather than just the verdict. */
  const reDealt = readAll();
  let differ = 0, movedByExactlyOneYear = 0;
  const dtSec = t1 - t0;
  for (const id in before) {
    if (!reDealt[id]) { differ++; continue; }
    if (reDealt[id].b !== before[id].b) differ++;
    if (Math.abs((reDealt[id].b - before[id].b) - dtSec) <= 1.5) movedByExactlyOneYear++;
  }

  const pyrOf = () => { const p = LP.pyramid(); return p.ok ? Object.fromEntries(
    Object.entries(p.city).map(([k, v]) => [k, +v.toFixed(2)])) : null; };
  const clockHeldAt = nc.game.cityAge || 0;
  const pyramidBefore = pyrOf();
  for (let i = 0; i < 60; i++) { try { nc.demog.tick(20); } catch (e) {} }
  const clockAfterDemog = nc.game.cityAge || 0;
  const pyramidAfter = pyrOf();
  LP.load(null);
  const reDealtSameClock = readAll();
  let differByPyramid = 0, comparable = 0;
  for (const id in reDealt) {
    if (!reDealtSameClock[id]) continue;
    comparable++;
    if (reDealtSameClock[id].b !== reDealt[id].b) differByPyramid++;
  }
  LP.load(null);
  window.MythicCitySave.restore(payload.ext);      // the shipped restore path
  const restored = readAll();
  let same = 0; const bad = [];
  for (const id in before) { if (restored[id] && restored[id].b === before[id].b) same++; else bad.push(id); }
  out.saveRoundTrip = {
    sliceKeys: slice ? Object.keys(slice) : null,
    stampsInSlice: slice && slice.b ? Object.keys(slice.b).length : 0,
    sliceBytes: slice ? JSON.stringify(slice).length : 0,
    bytesPerCitizen: slice && slice.b ? +(JSON.stringify(slice).length / Math.max(1, Object.keys(slice.b).length)).toFixed(1) : null,
    wipedTo: wiped,
    /* kept, and labelled as the non-control it is */
    weakControl_reDealtAtNewClock: {
      differ: differ + ' of ' + Object.keys(before).length,
      movedByExactlyTheClockDelta: movedByExactlyOneYear + ' of ' + Object.keys(before).length,
      secPerYear: Math.round(clk.secPerYear), clockDeltaSec: Math.round(dtSec),
      note: 'stamp = t − age·secPerYear, so a clock shift moves every stamp by ' +
            'exactly that shift. "differ" here is arithmetic, not evidence.',
    },
    /* the real one */
    control_reDealtAtSameClockWithADifferentPyramid: {
      differ: differByPyramid + ' of ' + comparable,
      cityAge_held: Math.round(clockHeldAt), cityAge_afterDemogTicks: Math.round(clockAfterDemog),
      clockActuallyStill: Math.abs(clockAfterDemog - clockHeldAt) < 1,
      pyramid_before: pyramidBefore, pyramid_after: pyramidAfter,
      note: 'same clock, shipped demographics pipeline moved underneath it. THIS is what ' +
            'shows the deal depends on the pyramid and therefore has to be stored.',
    },
    restoredIdentical: same + ' of ' + Object.keys(before).length,
    restoredDiffer: bad,
    /* the ages are the SAME BIRTH STAMPS but read at the later clock, so the
       people are a year older than the save — which is the point. */
    exampleAgeAfterRestore: restored[pick],
  };

  /* ── 7. THE PANEL, IN THE REAL PAGE ───────────────────────────────────── */
  const CZ = window.MythicCitizen;
  let best = null, bestN = -1;
  for (const c of roster()) {
    const F = CZ && CZ.facts(c.id); if (!F || !F.ok) continue;
    let n = 0; for (const s of F.sections) for (const r of s.rows) if (!r.un) n++;
    if (LP.career(c.id).ok) n += 5;                // prefer somebody with a career to photograph
    if (n > bestN) { bestN = n; best = c.id; }
  }
  if (best) {
    const F = CZ.facts(best);
    out.factRows = [];
    for (const s of F.sections) for (const r of s.rows) out.factRows.push({ sec: s.id, label: r.label, value: r.value, un: !!r.un, src: r.src });
    try { window.MythicCitizenUI.open(best); } catch (e) { out.openErr = String(e); }
    await new Promise((r) => setTimeout(r, 400));
    const box = document.getElementById('citbox');
    const facs = [...box.querySelectorAll('.cz-fac')];
    const grab = (label) => {
      const el = facs.find((e) => (e.querySelector('.l') || {}).textContent === label);
      if (!el) return null;
      return { value: (el.querySelector('.v,.cz-link') || {}).textContent,
               unavailable: !!el.querySelector('.v.un'),
               src: ((el.querySelector('.cz-src') || {}).textContent || '') };
    };
    out.dom = {
      citizen: best, name: F.name,
      dialogOpen: document.getElementById('citback').classList.contains('open'),
      Age: grab('Age'), JobLevel: grab('Job level'),
      rowsStillUnavailable: [...box.querySelectorAll('.v.un')].map((e) => e.closest('.cz-fac').querySelector('.l').textContent),
    };
  }

  /* ── 7b. 🔴 D. ARRANGED: A MATURE CITY — THE REGIME THIS DRIVER USED TO MISS
        AND THE ONE THE JOB LEVEL ROW LIVES IN.
        Everything above runs in a city whose buildings are about one citizen-
        year old, so the SITE is the shorter half of the tenure ceiling for
        every single citizen and the row is genuinely DERIVED for all of them.
        That is not the normal case, it is the opening minutes. As soon as a
        building has stood longer than a worker's whole career the other half
        binds — and that half is (age − 18), i.e. the SAMPLE — so the grade
        becomes a restatement of a draw. THE ARRANGEMENT THAT MADE THE ROW
        TESTABLE WAS THE ARRANGEMENT THAT HID WHAT IT DEGENERATES INTO.
        So: every workplace tile's `born` is pushed back 60 citizen-years, which
        is a state the game reaches on its own after ~480 real hours. Nothing
        else is touched — no age, no employer, no firm level — and every read
        below still goes through the shipped model and the shipped panel. */
  const AGE_BACK = 60 * clk.secPerYear;
  const tilesAged = [];
  for (const c of roster()) {
    const e = window.MythicCitizens.employer(c.id);
    if (!e || !e.tile || tilesAged.some((x) => x.k === e.tile)) continue;
    const t = nc.game.tiles[e.tile];
    if (!t) continue;
    tilesAged.push({ k: e.tile, was: t.born });
    t.born = (nc.game.cityAge || 0) - AGE_BACK;
  }
  const mature = { tilesAged: tilesAged.length, buildingAgeYears: 60,
                   n: 0, boundByWorklife: 0, boundBySite: 0, sampledTrue: 0, sampledFalse: 0 };
  let worklifeId = null, siteId = null;
  for (const c of roster()) {
    const q = LP.career(c.id); if (!q.ok) continue;
    mature.n++;
    if (q.tenureFrom === 'worklife') { mature.boundByWorklife++; if (!worklifeId) worklifeId = c.id; }
    else { mature.boundBySite++; if (!siteId) siteId = c.id; }
    if (q.sampled) mature.sampledTrue++; else mature.sampledFalse++;
  }
  /* The assertion, in one field: the flag and the binding term are the same
     thing, so a citizen may never be worklife-bound and unmarked. */
  mature.sampledFlagMatchesBindingTerm =
    (mature.sampledTrue === mature.boundByWorklife) && (mature.sampledFalse === mature.boundBySite);
  const jlRow = (id) => {
    const F = CZ.facts(id); if (!F || !F.ok) return null;
    for (const s of F.sections) for (const r of s.rows) if (r.label === 'Job level') {
      const q = LP.career(id);
      return { citizen: id, value: r.value, unavailable: !!r.un,
               leadsOn: (r.src || '').slice(0, 9), boundBy: q.ok ? q.tenureFrom : null,
               siteFrom: q.ok ? q.siteFrom : null, src: r.src };
    }
    return null;
  };
  mature.rowWhenWorklifeBinds = worklifeId ? jlRow(worklifeId) : null;
  mature.rowWhenSiteBinds = siteId ? jlRow(siteId) : null;
  /* 🏚 …and the demolish-and-rebuild case, which is NOT fixed and which the row
     now has to survive in words. Re-stamp one workplace as raised this instant
     and read the same person again: the ceiling and every grade under it go
     back to zero with nobody's job having changed. */
  if (worklifeId) {
    const e = window.MythicCitizens.employer(worklifeId);
    const t = e && e.tile ? nc.game.tiles[e.tile] : null;
    if (t) {
      const q0 = LP.career(worklifeId), was = t.born;
      t.born = nc.game.cityAge || 0;
      const q1 = LP.career(worklifeId);
      const r1 = jlRow(worklifeId);
      t.born = was;
      mature.demolishAndRebuild = {
        citizen: worklifeId,
        tenureYears: +q0.tenureYears.toFixed(1) + ' -> ' + +q1.tenureYears.toFixed(1),
        grade: q0.grade + ' -> ' + q1.grade,
        boundBy: q0.tenureFrom + ' -> ' + q1.tenureFrom,
        rowAfter: r1 ? r1.value : null,
        rowSaysWhy: r1 ? /standing there NOW/.test(r1.src) : false,
        note: 'UNFIXED and unfixable here — tile.born is stamped at placement, the roster ' +
              'keeps no hire date and a firm record carries no founding date. The row is ' +
              'worded so a reader can see why the number moved.',
      };
    }
  }
  /* 🕳 the third site provenance: a firm naming a tile that carries no stamp.
     This used to print "the building it occupies (3,3) has stood 3.5 years"
     about a building that is not there, with the CITY's age as its age. */
  if (worklifeId || siteId) {
    const id = siteId || worklifeId;
    const e = window.MythicCitizens.employer(id);
    const t = e && e.tile ? nc.game.tiles[e.tile] : null;
    if (t) {
      const was = t.born; delete t.born;
      const q = LP.career(id), r = jlRow(id);
      t.born = was;
      mature.tileWithNoStamp = { citizen: id, tile: e.tile, siteFrom: q.ok ? q.siteFrom : null,
        rowClaimsABuildingAge: r ? /building it occupies/.test(r.src) : null,
        rowSaysNoStamp: r ? /carries a raise stamp|no raise stamp|nothing there carries/.test(r.src) : null,
        src: r ? r.src : null };
    }
  }
  out.matureCity = mature;
  /* The tiles are LEFT aged: this is the regime the row actually lives in, so
     it is the one the screenshot should show. */

  out.cardSeam = LP.cardSeam();

  /* ── 8. THE FALLBACK. A 404 on /src/lifepath must cost the player two rows
        and nothing else, and those two rows must read EXACTLY as they did
        before this module existed. facts.js probes window.MythicLifepath at
        call time, so hiding it is the same thing the 404 does. ─────────── */
  if (best) {
    const keep = window.MythicLifepath;
    try { delete window.MythicLifepath; } catch (e) { window.MythicLifepath = undefined; }
    const F2 = CZ.facts(best);
    const findRow = (F, label) => { for (const s of F.sections) for (const r of s.rows) if (r.label === label) return r; return null; };
    out.absentFallback = {
      Age: findRow(F2, 'Age'), JobLevel: findRow(F2, 'Job level'),
      otherRowsUnchanged: (() => {
        const a = {}, b = {};
        for (const s of CZ.facts(best).sections) for (const r of s.rows) if (r.label !== 'Age' && r.label !== 'Job level') a[r.label] = r.value;
        window.MythicLifepath = keep;
        for (const s of CZ.facts(best).sections) for (const r of s.rows) if (r.label !== 'Age' && r.label !== 'Job level') b[r.label] = r.value;
        return JSON.stringify(a) === JSON.stringify(b);
      })(),
    };
    window.MythicLifepath = keep;
    /* …and leave the dialogue open on the WORKING build for the screenshot.
       ⚠ The workplace tiles are still aged (7b), so THIS is the mature-city
       regime and the shot shows the row as a player of a settled city sees it.
       Re-grabbed here for that reason: out.dom above is the young-city read and
       the two are meant to be compared. */
    try { window.MythicCitizenUI.open(best); } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
    try {
      const bx0 = document.getElementById('citbox');
      const fc = [...bx0.querySelectorAll('.cz-fac')];
      const g2 = (label) => {
        const el = fc.find((e) => (e.querySelector('.l') || {}).textContent === label);
        if (!el) return null;
        return { value: (el.querySelector('.v,.cz-link') || {}).textContent,
                 unavailable: !!el.querySelector('.v.un'),
                 src: ((el.querySelector('.cz-src') || {}).textContent || '') };
      };
      const qm = LP.career(best);
      out.domMatureCity = { citizen: best, boundBy: qm.ok ? qm.tenureFrom : null,
                            sampled: qm.ok ? qm.sampled : null,
                            Age: g2('Age'), JobLevel: g2('Job level'), WorkBand: g2('Work band') };
    } catch (e) { out.domMatureErr = String(e); }
    /* Scroll the dialogue to the OCCUPATION section so the shot shows the Job
       level row as well as the Age row — the panel is taller than the box. */
    try {
      const bx = document.getElementById('citbox');
      const jl = [...bx.querySelectorAll('.cz-fac')].find((e) => (e.querySelector('.l') || {}).textContent === 'Job level');
      if (jl) bx.scrollTop = Math.max(0, jl.offsetTop - 160);
      out.dom.scrolledTo = bx.scrollTop;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }

  return JSON.stringify(out);
})();
