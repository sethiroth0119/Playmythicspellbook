/* ══ DRIVE THE CITIZEN DOSSIER ═══════════════════════════════════════════
   Runs inside the page after .gauntlet/scene.js has built the standard
   district. Steps the crowd by hand (rAF never fires in this pane, so
   manageAgents/agentTick/citRefresh only run if something calls them), binds
   citizens to walking agents, then opens ONE citizen's dialogue and reports
   every row of the dossier with the source it was read from.

   Returns a JSON string — shot.mjs writes it beside the PNG as <out>.png.json.
   ══════════════════════════════════════════════════════════════════════ */
(async () => {
  const nc = window.__nc;
  if (!nc) return JSON.stringify({ err: 'no __nc' });
  const out = { mounted: {}, crowd: {}, picked: null, rows: [], links: [], dom: {} };

  out.mounted = {
    citizen: !!window.MythicCitizen,
    dossier: !!window.MythicDossier,
    citizens: !!window.MythicCitizens,
    economy: !!window.MythicEconomy,
    demographics: !!window.MythicDemographics,
  };
  if (!window.MythicCitizen) return JSON.stringify(out);

  /* 1. get a crowd onto the road and step it, or nobody is walking anywhere. */
  try { nc.manageAgents(); } catch (e) { out.err_manage = String(e); }
  try { window.MythicCitizens.refresh(true); } catch (e) { out.err_refresh = String(e); }
  for (let i = 0; i < 240; i++) { try { nc.agentTick(1 / 30); } catch (e) { break; } }
  try { window.MythicCitizens.refresh(true); } catch (e) {}

  const agents = nc.agents();
  out.crowd = {
    agents: agents.length,
    civilians: agents.filter(a => a.kind === 'civilian').length,
    bound: agents.filter(a => a.cit).length,
    roster: window.MythicCitizens.count(),
    states: agents.filter(a => a.kind === 'civilian').map(a => a.state + '/' + a.phase),
  };

  /* 2. pick a walking citizen if there is one, else the first on the roster —
        both are worth photographing, because the second is the UNAVAILABLE
        activity path and that path is the one most likely to lie. */
  const roster = window.MythicCitizens.list();
  const CZ = window.MythicCitizen;

  /* ROW COVERAGE ACROSS THE WHOLE ROSTER, not just the one photographed: the
     interesting claim is "which rows this city can answer for whom", and a
     single citizen cannot show it. */
  out.coverage = {};
  for (const c of roster) {
    const f = CZ.facts(c.id);
    if (!f || !f.ok) { out.coverage._broken = (out.coverage._broken || 0) + 1; continue; }
    for (const s of f.sections) for (const r of s.rows) {
      const k = r.label;
      out.coverage[k] = out.coverage[k] || { live: 0, un: 0 };
      out.coverage[k][r.un ? 'un' : 'live']++;
    }
    out.coverage._activity = out.coverage._activity || { live: 0, un: 0 };
    out.coverage._activity[f.activity.ok ? 'live' : 'un']++;
  }

  /* Photograph the RICHEST one — most rows answered — so the shot shows the
     panel at full stretch rather than at its emptiest. */
  let best = null, bestN = -1;
  for (const c of roster) {
    const f = CZ.facts(c.id);
    if (!f || !f.ok) continue;
    let n = f.activity.ok ? 1 : 0;
    for (const s of f.sections) for (const r of s.rows) if (!r.un) n++;
    if (n > bestN) { bestN = n; best = c.id; }
  }
  const walking = agents.find(a => a.kind === 'civilian' && a.cit === best);
  const id = best || (roster[0] && roster[0].id);
  if (!id) return JSON.stringify(out);
  out.bestRows = bestN;
  const F = CZ.facts(id);
  out.picked = { id, name: F && F.name, walking: !!walking,
                 mood: F && F.mood, activity: F && F.activity };
  out.residence = CZ.residence(id);
  if (out.residence && out.residence.members) {
    out.residence = { ok: out.residence.ok, key: out.residence.key, why: out.residence.why,
                      members: out.residence.members.map(m => m.name) };
  }
  if (F && F.ok) {
    for (const s of F.sections) {
      for (const r of s.rows) {
        out.rows.push({ sec: s.id, label: r.label, value: r.value, un: !!r.un,
                        link: r.link ? r.link.key : null, src: r.src.slice(0, 150) });
      }
      if (s.members) out.family = { key: s.houseKey, name: s.houseName, n: s.members.length };
    }
  }

  /* 3. open the real dialogue through the shipped path and read the DOM back,
        so the claim is about what a player sees rather than about the strings. */
  let opened = false;
  try { opened = window.MythicCitizenUI.open(id); } catch (e) { out.err_open = String(e); }
  await new Promise(r => setTimeout(r, 350));
  const box = document.getElementById('citbox');
  out.dom = {
    opened,
    visible: !!document.getElementById('citback').classList.contains('open'),
    strip: !!box.querySelector('.cz-strip'),
    stripText: (box.querySelector('.cz-strip') || {}).textContent,
    heads: [...box.querySelectorAll('.cz-head')].map(e => e.textContent.trim()),
    facs: box.querySelectorAll('.cz-fac').length,
    srcs: box.querySelectorAll('.cz-src').length,
    tileLinks: [...box.querySelectorAll('[data-tile]')].map(e => e.getAttribute('data-tile') + ':' + e.textContent.trim()),
    citRows: [...box.querySelectorAll('[data-cit]')].map(e => e.getAttribute('data-cit')),
    unavailable: [...box.querySelectorAll('.v.un')].map(e => e.closest('.cz-fac').querySelector('.l').textContent),
    scrollH: box.scrollHeight,
  };

  /* 4. DRIVE A CROSS-LINK. A link that renders is not a link that works — the
        delegation is on #citback and the click has to close the dialog AND
        open that building's dossier. Click the first one and read both ends. */
  const link = box.querySelector('.cz-link[data-tile]');
  if (link) {
    const want = link.getAttribute('data-tile');
    link.click();
    await new Promise(r => setTimeout(r, 400));
    const ins = document.getElementById('inspect');
    out.crossTile = {
      clicked: want,
      citClosed: !document.getElementById('citback').classList.contains('open'),
      inspectOpen: !!(ins && (ins.classList.contains('open') || ins.style.display !== 'none')),
      insName: (document.getElementById('insname') || {}).textContent,
      insMeta: (document.getElementById('insmeta') || {}).textContent,
    };
  }

  /* 5. …and the other direction: a household name must open THAT person. */
  try { window.MythicCitizenUI.open(id); } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
  const rows = [...document.getElementById('citbox').querySelectorAll('.wfrow[data-cit]')];
  /* A one-person household is the normal case in a small city, so fall back to
     the person's OWN row — the claim under test is that the delegation fires
     and lands on the right citizen, not that somebody has a sibling. */
  const mate = rows.find(e => e.getAttribute('data-cit') !== id) || rows[0];
  if (mate) {
    const want = mate.getAttribute('data-cit');
    mate.click();
    await new Promise(r => setTimeout(r, 350));
    out.crossCit = { clicked: want, now: window.MythicCitizenUI.isOpen(),
                     ok: window.MythicCitizenUI.isOpen() === want,
                     name: (document.querySelector('#citbox .ctname') || {}).textContent };
  }

  /* 5b. THE DERIVED ROWS NOBODY IN THIS DISTRICT EXERCISES. Every named
        citizen here holds a crewed tile, so Education and Work band are
        UNAVAILABLE for all eight — which is correct and proves nothing about
        the branch that fills them. Idle one person through the shipped setJob
        seam and re-sync: the economy then puts them on a firm, and the two
        derived rows have something to derive from. Restored afterwards. */
  const probe = roster[roster.length - 1];
  if (probe) {
    const hadJob = probe.job;
    try {
      window.MythicCitizens.setJob(probe.id, null);
      out.empSync = window.MythicCitizens.sync();
      const pf = CZ.facts(probe.id);
      out.empProbe = { id: probe.id, name: probe.name,
        rows: pf && pf.ok ? [].concat(...pf.sections.map(s => s.rows))
          .filter(r => ['Education', 'Work band', 'Employer', 'Occupation'].includes(r.label))
          .map(r => ({ label: r.label, value: r.value, un: !!r.un, src: r.src.slice(0, 190) })) : null };
    } catch (e) { out.empProbe = { err: String(e) }; }
    try { window.MythicCitizens.setJob(probe.id, hadJob); window.MythicCitizens.sync(); } catch (e) {}
  }

  /* 5c. THE WORLD → PANEL DOOR. This dossier is only worth anything if you can
        reach it by clicking a person in the city, and that path is shipped code
        (a capture-phase pointerup that raycasts the crowd). Prove it is
        REACHABLE rather than assume it: project a bound agent's own mesh
        through the live camera and ask the shipped picker what is under those
        screen coordinates. */
  try {
    const T = nc.three();
    const a = nc.agents().find(x => x.kind === 'civilian' && x.cit && x.mesh && x.mesh.visible);
    if (a) {
      const v = new T.THREE.Vector3();
      a.mesh.getWorldPosition(v);
      v.y += 0.2;
      v.project(T.camera);
      const rect = T.renderer.domElement.getBoundingClientRect();
      const cx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const cy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      out.worldPick = { cit: a.cit, x: Math.round(cx), y: Math.round(cy),
                        hit: window.MythicCitizenUI.pickAt(cx, cy, 26) };
    } else { out.worldPick = { err: 'no visible bound civilian' }; }
  } catch (e) { out.worldPick = { err: String(e) }; }

  /* 6. leave the panel open and on the ORIGINAL person for the photograph. */
  try { window.MythicCitizenUI.open(id); } catch (e) {}
  await new Promise(r => setTimeout(r, 300));
  const b2 = document.getElementById('citbox');
  out.scrollTopOnOpen = b2.scrollTop;      // must be 0 — see preventScroll in openCitTalk
  return JSON.stringify(out);
})()
