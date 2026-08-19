/* ══ DRIVE /src/lifepath ══════════════════════════════════════════════════
   Runs inside the page after .gauntlet/scene.js has built the standard
   district. Proves, from SHIPPED SEAMS only:

     1. the clock — every input the "how long is a year" derivation used;
     2. the same citizen's age is identical across two reads;
     3. the roster's age bands reproduce MythicDemographics.report().ages
        (both printed, plus the largest share deviation and its bound);
     4. the stamps survive serialize() -> MythicCitySave.restore();
     5. an age advances after __nc.step(), by the amount the clock predicts;
     6. a career grade changes for a nameable reason;
     7. the real dialogue renders both rows.

   Returns a JSON string — shot.mjs writes it beside the PNG as <out>.png.json.
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const nc = window.__nc;
  if (!nc) return JSON.stringify({ err: 'no __nc' });
  const out = { mounted: {}, steps: [] };
  const say = (k, v) => { out[k] = v; out.steps.push(k); };

  out.mounted = {
    lifepath: !!window.MythicLifepath,
    citizen: !!window.MythicCitizen,
    citizens: !!window.MythicCitizens,
    demographics: !!window.MythicDemographics,
    economy: !!window.MythicEconomy,
    saveShelf: !!window.MythicCitySave,
  };
  const LP = window.MythicLifepath;
  if (!LP) return JSON.stringify(out);
  out.mounted.ready = LP.ready();
  out.mounted.shelved = LP.shelved();

  /* Give the city a citizenry and a demographics reading. Both are driven by
     ticks that RAF would normally run, and RAF is dead in this pane. */
  try { nc.manageAgents(); } catch (e) {}
  try { window.MythicCitizens.refresh(true); } catch (e) {}
  for (let i = 0; i < 6; i++) { try { nc.demog.tick(20); } catch (e) { out.demogErr = String(e); break; } }
  try { window.MythicCitizens.refresh(true); } catch (e) {}

  /* ── 1. THE CLOCK ─────────────────────────────────────────────────────── */
  const clk = LP.clock();
  say('clock', clk.ok ? {
    ok: true,
    inputs: clk.src,
    workAge: clk.workAge, retireAge: clk.retireAge, workingLifeYears: clk.workingLifeYears,
    econDaysPerYear: +clk.daysPerYear.toFixed(4),
    secPerYear: Math.round(clk.secPerYear),
    realHoursPerYear: +clk.hoursPerYear.toFixed(2),
    gradeYears: +clk.gradeYears.toFixed(3),
    youngYears: +clk.youngYears.toFixed(3),
    retirementYears: +clk.retirementYears.toFixed(3),
    lifeExpectancy: +clk.lifeExpectancy.toFixed(2),
    bands: Object.fromEntries(Object.entries(clk.bands).map(([k, v]) => [k, [+v[0].toFixed(2), +v[1].toFixed(2)]])),
    /* ECON's own comment says "~24 economic days to the year". This is that
       figure re-derived, so the two files must agree. */
    econCommentSays: 24,
  } : clk);
  if (!clk.ok) return JSON.stringify(out);

  say('sync', LP.sync());

  /* ── 2. STABILITY ACROSS TWO READS ────────────────────────────────────── */
  const roster = window.MythicCitizens.list();
  const readAll = () => {
    const m = {};
    for (const c of roster) { const a = LP.age(c.id); if (a.ok) m[c.id] = { y: +a.years.toFixed(6), b: a.born, band: a.band }; }
    return m;
  };
  const A1 = readAll(), A2 = readAll();
  let stable = 0, unstable = [];
  for (const id in A1) { if (A2[id] && A2[id].y === A1[id].y && A2[id].b === A1[id].b) stable++; else unstable.push(id); }
  say('stableAcrossTwoReads', { n: Object.keys(A1).length, stable, unstable });

  /* ── 3. THE DISTRIBUTION, BOTH SIDES ──────────────────────────────────── */
  const d = LP.distribution();
  const pct = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, +(v * 100).toFixed(1)]));
  say('distribution', d.ok ? {
    rosterN: d.n, unstamped: d.unstamped, frameBands: d.bands,
    cityPyramid_people: Object.fromEntries(Object.entries(d.city || {}).map(([k, v]) => [k, +v.toFixed(1)])),
    cityTotal: +(d.cityTotal || 0).toFixed(1),
    frameShare_pct: pct(d.frameShare),
    rosterCount: d.rosterCount,
    rosterShare_pct: pct(d.rosterShare),
    maxShareDev_pct: +(d.maxShareDev * 100).toFixed(2),
    boundOnePerson_pct: +((d.bound || 0) * 100).toFixed(2),
    withinBound: d.maxShareDev <= (d.bound || 0) + 1e-9,
    ages: d.ages,
  } : d);

  /* ── 4. SAVE ROUND TRIP, THROUGH THE SHIPPED SHELF ────────────────────── */
  const payload = nc.serialize();
  const slice = payload && payload.ext && payload.ext.lifepath;
  const before = readAll();
  LP.load(null);                                   // wipe the stamps
  const wiped = LP.stamps();
  /* Re-reading now RE-DEALS from scratch, which is a different deal — that is
     the control: if the ages came back identical after a wipe, the save would
     be proving nothing. */
  const reseeded = readAll();
  let changedByWipe = 0;
  for (const id in before) if (!reseeded[id] || reseeded[id].b !== before[id].b) changedByWipe++;
  LP.load(null);
  window.MythicCitySave.restore(payload.ext);      // the shipped restore path
  const after = readAll();
  let same = 0, diff = [];
  for (const id in before) { if (after[id] && after[id].b === before[id].b) same++; else diff.push(id); }
  say('saveRoundTrip', {
    sliceKeys: slice ? Object.keys(slice) : null,
    sliceStamps: slice && slice.b ? Object.keys(slice.b).length : 0,
    sliceBytes: slice ? JSON.stringify(slice).length : 0,
    wipedToZero: Object.keys(wiped).length === 0,
    reDealtDifferently: changedByWipe,
    restoredIdentical: same, restoredDiffer: diff,
    n: Object.keys(before).length,
  });

  /* ── 5. THE CLOCK ADVANCES THE AGE ────────────────────────────────────── */
  const pick = Object.keys(after)[0];
  const t0 = nc.game.cityAge || 0;
  const age0 = LP.age(pick);
  const career0 = {};
  for (const c of roster) { const q = LP.career(c.id); if (q.ok) career0[c.id] = { g: q.grade, cap: q.cap, r: q.rungs, t: +q.tenureYears.toFixed(3), f: q.firm.id }; }

  /* One citizen-year, on the derived clock. step() advances game.cityAge by
     mins*60 through vitalsTick — the SAME call animate() makes. */
  const mins = clk.secPerYear / 60;
  await nc.step(mins, 60);
  const t1 = nc.game.cityAge || 0;
  const age1 = LP.age(pick);
  say('ageAdvances', {
    citizen: pick,
    cityAge_before: Math.round(t0), cityAge_after: Math.round(t1),
    secondsStepped: Math.round(t1 - t0),
    secPerYear: Math.round(clk.secPerYear),
    years_before: +age0.years.toFixed(4), years_after: +age1.years.toFixed(4),
    yearsGained: +(age1.years - age0.years).toFixed(4),
    predicted: +((t1 - t0) / clk.secPerYear).toFixed(4),
    bornStampUnchanged: age0.born === age1.born,
    band_before: age0.band, band_after: age1.band,
  });

  /* ── 6. A CAREER GRADE CHANGES, FOR A REASON WE CAN NAME ──────────────── */
  const moved = [];
  for (const c of roster) {
    const q = LP.career(c.id); if (!q.ok) continue;
    const p0 = career0[c.id]; if (!p0) continue;
    if (q.grade !== p0.g || q.rungs !== p0.r) {
      moved.push({ id: c.id, from: p0.g, to: q.grade, rungsFrom: p0.r, rungsTo: q.rungs,
                   cap: q.cap, capped: q.capped,
                   tenureFrom: p0.t, tenureTo: +q.tenureYears.toFixed(3),
                   firmSame: p0.f === q.firm.id,
                   reason: q.firm.id !== p0.f ? 'employer changed'
                         : q.rungs !== p0.r ? 'tenure crossed a rung of ' + clk.gradeYears.toFixed(2) + ' years'
                         : 'employer level changed' });
    }
  }
  say('careerAfterClock', { moved: moved.slice(0, 12), movedN: moved.length });

  /* …and the CAP half, which is the one a player actually sees move. The
     driver levels ONE firm — the same thing ECON.firm.levels' own gate does
     after enough profitable days — and asserts the person's grade follows the
     firm's, without this module writing anything. */
  let capProof = { why: 'no capped citizen found' };
  const capped = roster.map(c => ({ c, q: LP.career(c.id) })).find(x => x.q.ok && x.q.capped);
  if (capped) {
    const f = window.MythicEconomy.firm(capped.q.firm.id);
    const wasLevel = f.level;
    const b4 = LP.career(capped.c.id);
    f.level = Math.min(5, b4.rungs);                 // arranged state, not a faked result
    const af = LP.career(capped.c.id);
    f.level = wasLevel;                              // put it back
    const rst = LP.career(capped.c.id);
    capProof = { id: capped.c.id, firm: b4.firm.id,
                 firmLevel_before: wasLevel, firmLevel_forced: Math.min(5, b4.rungs),
                 grade_before: b4.grade, grade_atHigherFirmLevel: af.grade, grade_afterRevert: rst.grade,
                 rungsEarnedByTenure: b4.rungs, tenureYears: +b4.tenureYears.toFixed(2),
                 reason: 'the grade is min(tenure rungs, firm level); only the cap moved' };
  }
  say('careerCapProof', capProof);

  /* A census of the career rows, so "grade 1 of 1 everywhere" is visible if
     that is what this city is. */
  const census = { withFirm: 0, noFirm: 0, byGrade: {}, byCap: {}, cappedN: 0, tenureMax: 0 };
  for (const c of roster) {
    const q = LP.career(c.id);
    if (!q.ok) { census.noFirm++; continue; }
    census.withFirm++;
    census.byGrade[q.grade] = (census.byGrade[q.grade] || 0) + 1;
    census.byCap[q.cap] = (census.byCap[q.cap] || 0) + 1;
    if (q.capped) census.cappedN++;
    census.tenureMax = Math.max(census.tenureMax, +q.tenureYears.toFixed(2));
  }
  say('careerCensus', census);

  /* ── 7. THE PANEL, IN THE REAL PAGE ───────────────────────────────────── */
  const CZ = window.MythicCitizen;
  let best = null, bestN = -1;
  for (const c of roster) {
    const F = CZ && CZ.facts(c.id); if (!F || !F.ok) continue;
    let n = 0; for (const s of F.sections) for (const r of s.rows) if (!r.un) n++;
    if (n > bestN) { bestN = n; best = c.id; }
  }
  if (best) {
    const F = CZ.facts(best);
    out.factRows = [];
    for (const s of F.sections) for (const r of s.rows) {
      out.factRows.push({ sec: s.id, label: r.label, value: r.value, un: !!r.un, src: r.src });
    }
    try { window.MythicCitizenUI.open(best); } catch (e) { out.openErr = String(e); }
    await new Promise(r => setTimeout(r, 350));
    const box = document.getElementById('citbox');
    const facs = [...box.querySelectorAll('.cz-fac')];
    const grab = (label) => {
      const el = facs.find(e => (e.querySelector('.l') || {}).textContent === label);
      if (!el) return null;
      return { value: (el.querySelector('.v,.cz-link') || {}).textContent,
               un: !!el.querySelector('.v.un'),
               src: ((el.querySelector('.cz-src') || {}).textContent || '').slice(0, 400) };
    };
    say('dom', {
      citizen: best, name: F.name,
      open: document.getElementById('citback').classList.contains('open'),
      age: grab('Age'), jobLevel: grab('Job level'),
      stillUnavailable: [...box.querySelectorAll('.v.un')].map(e => e.closest('.cz-fac').querySelector('.l').textContent),
    });
  }

  say('cardSeam', LP.cardSeam());
  return JSON.stringify(out);
})();
