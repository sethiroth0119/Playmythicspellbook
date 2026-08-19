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

  /* ── 3. THE DISTRIBUTION, BOTH SIDES, PRINTED ─────────────────────────── */
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
  out.careerAdvances = { movedN: moved.length, moved: moved.slice(0, 10) };
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
  /* THE CONTROL. Re-dealing from scratch at the new clock is a DIFFERENT deal —
     which is exactly why the birth stamp has to be stored and cannot be derived.
     If this came back identical the restore below would prove nothing. */
  const reDealt = readAll();
  let differ = 0;
  for (const id in before) if (!reDealt[id] || reDealt[id].b !== before[id].b) differ++;
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
    control_reDealtDifferentlyAtNewClock: differ + ' of ' + Object.keys(before).length,
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
    /* …and leave the dialogue open on the WORKING build for the screenshot. */
    try { window.MythicCitizenUI.open(best); } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
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
