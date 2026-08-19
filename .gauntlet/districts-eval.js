(async () => {
  const nc = window.__nc, D = window.MythicDistricts, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue;
  const R = {};
  if (!D) return { fatal: 'MythicDistricts absent' };
  R.mods = { districts: !!D && D.ready(), zoning: !!Z, progress: !!P, landvalue: !!(L && L.ready()) };

  /* ── 1. THE GATE, BEFORE ANY NODE IS TAKEN ─────────────────────────────── */
  R.gate = { before: {} };
  for (const id of ['c_retail', 'c_mythic', 'i_cards', 'o_corp']) {
    R.gate.before[id] = { unlocked: D.unlocked(id), arm: D.arm(id), blockedBy: (D.blockedBy(id) || {}).node || null };
  }
  D.arm(null);

  /* ── 2. TAKE THE NODES (test seam: grants without spending) ────────────── */
  for (const n of ['com_high', 'com_district', 'com_night', 'com_luxury',
                   'ind_district', 'ind_ware', 'off_low', 'off_district', 'off_high',
                   'myth_press', 'myth_street', 'myth_arena', 'civ_landmark', 'sci_urban'])
    P._grant(n);
  R.gate.after = {};
  for (const id of ['c_retail', 'c_mythic', 'i_cards', 'o_corp'])
    R.gate.after[id] = { unlocked: D.unlocked(id), arm: D.arm(id) };
  D.arm(null);

  /* ── 3. THE DERIVED FLOORS — no threshold is written down anywhere ─────── */
  R.floors = {};
  for (const cat of ['com', 'off', 'ind'])
    for (const r of D.available(cat))
      R.floors[r.id] = { floor: r.floor ? r.floor.id : null,
                         reach: r.reach ? r.reach.map(b => b.id) : null,
                         builds: r.tenants.length, lvl: r.lvl, locked: r.locked, empty: r.empty };

  /* ── 4. FIND A GOOD PLOT AND A CHEAP ONE, from the live band field ─────── */
  const G = nc.game;
  const cand = [];
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) {
    const k = x + ',' + z;
    if (G.tiles[k]) continue;
    const road = ['1,0','-1,0','0,1','0,-1'].some(d => {
      const [dx, dz] = d.split(',').map(Number); const t = G.tiles[(x+dx) + ',' + (z+dz)];
      return t && t.type === 'road';
    });
    if (!road) continue;
    cand.push({ x, z, prem: L ? Math.round(L.premiumAt(x, z)) : 0, band: L ? L.bandAt(x, z).id : null });
  }
  cand.sort((a, b) => b.prem - a.prem);
  R.plots = { n: cand.length, best: cand[0], worst: cand[cand.length - 1] };
  const HI = cand[0], LO = cand[cand.length - 1];

  /* ── 5. UNSPECIALISED IS UNCHANGED — the whole contract, measured ──────── */
  Z.applyPaint(HI.x, HI.z, 'c_high', undefined);
  const plainAt = nc.districtAt(HI.x, HI.z);
  R.unspecialised = { spec: plainAt.spec, base: plainAt.base, afterSpec: plainAt.afterSpec,
                      same: JSON.stringify(plainAt.base) === JSON.stringify(plainAt.afterSpec),
                      wouldBuild: plainAt.wouldBuild, lvl: plainAt.lvl };

  /* ── 6. THE SAME TILE, SPECIALISED — layer 2 changes what develops ─────── */
  Z.applyPaint(HI.x, HI.z, 'c_high', 'c_mythic');
  const myth = nc.districtAt(HI.x, HI.z);
  R.mythicRetail = { spec: myth.spec, band: myth.band, afterSpec: myth.afterSpec,
                     afterLand: myth.afterLand, wouldBuild: myth.wouldBuild, lvl: myth.lvl };

  /* ── 7. LUXURY ON THE CHEAPEST ROAD-FRONTED PLOT — refused, and it says so */
  Z.applyPaint(LO.x, LO.z, 'c_high', 'c_lux');
  const lux = nc.districtAt(LO.x, LO.z);
  R.luxuryOnCheapLand = { band: lux.band, prem: LO.prem, afterSpec: lux.afterSpec,
                          afterLand: lux.afterLand, wouldBuild: lux.wouldBuild,
                          refusal: lux.refusal ? lux.refusal.slice(0, 190) : null };
  /* …and the SAME spec on the best plot, for the contrast */
  Z.applyPaint(HI.x, HI.z, 'c_high', 'c_lux');
  const luxHi = nc.districtAt(HI.x, HI.z);
  R.luxuryOnGoodLand = { band: luxHi.band, afterLand: luxHi.afterLand, wouldBuild: luxHi.wouldBuild, lvl: luxHi.lvl };

  /* ── 8. A MARQUEE THAT SPECIALISES A BLOCK ALREADY ZONED ──────────────── */
  const rect = { x0: HI.x - 2, z0: HI.z, x1: HI.x + 2, z1: HI.z };
  const r1 = Z.applyRect(rect.x0, rect.z0, rect.x1, rect.z1, 'c_high', undefined);
  const r2 = Z.applyRect(rect.x0, rect.z0, rect.x1, rect.z1, 'c_high', 'c_mythic');
  R.repaint = { firstPass: r1, secondPassSameZoneNewSpec: r2,
                note: 'the second pass changes no zone at all — it must still report changes' };

  /* ── 9. THE OVERLAY MARK ──────────────────────────────────────────────── */
  Z.overlay(true); Z.sync();
  R.overlay = { specialisedTiles: D.stats().specialised, marksDrawn: Z.specMarks() };

  /* ── 10. INDUSTRIAL + OFFICE, on their own families ───────────────────── */
  const ind = cand.filter(c => !G.zones[c.x + ',' + c.z]).slice(0, 3);
  if (ind[0]) { Z.applyPaint(ind[0].x, ind[0].z, 'i_mfg', 'i_cards'); R.cardWorks = nc.districtAt(ind[0].x, ind[0].z); }
  if (ind[1]) { Z.applyPaint(ind[1].x, ind[1].z, 'o_low', 'o_tech'); R.officeTech = nc.districtAt(ind[1].x, ind[1].z); }
  /* a commercial spec on an industrial zone must be IGNORED, not applied */
  if (ind[2]) {
    Z.applyPaint(ind[2].x, ind[2].z, 'i_mfg', 'c_mythic');
    R.familyMismatch = { asked: 'c_mythic on i_mfg', got: D.specAt(ind[2].x, ind[2].z) };
  }

  /* ── 11. RECONCILE — re-zone a district into another family ───────────── */
  const rk = HI.x + ',' + HI.z;
  const beforeRe = D.specAt(HI.x, HI.z);
  Z.applyPaint(HI.x, HI.z, 'r_low', undefined);
  R.reconcile = { before: beforeRe, afterRezoneToResidential: D.specAt(HI.x, HI.z) };
  Z.applyPaint(HI.x, HI.z, 'c_high', 'c_mythic');

  /* ── 12. SAVE ROUND TRIP ──────────────────────────────────────────────── */
  let slice = null;
  try { slice = JSON.parse(nc.serialize()).ext.districts; } catch (e) { slice = { err: String(e) }; }
  R.save = { keys: slice && slice.spec ? Object.keys(slice.spec).length : 0,
             v: slice && slice.v, sample: slice && slice.spec ? Object.entries(slice.spec).slice(0, 3) : null };

  /* ── 13. THE PANEL ────────────────────────────────────────────────────── */
  Z.panel(true); Z.select('c_high'); Z.sync();
  await new Promise(r => setTimeout(r, 150));
  const el = document.getElementById('nz-spec');
  R.panel = { present: !!el, chips: el ? el.querySelectorAll('[data-spec]').length : 0,
              mythicChips: el ? el.querySelectorAll('.ndc.myth').length : 0,
              text: el ? el.textContent.replace(/\s+/g, ' ').slice(0, 260) : null };
  Z.select('r_low'); Z.sync();
  await new Promise(r => setTimeout(r, 150));
  R.panelResidential = { chips: el ? el.querySelectorAll('[data-spec]').length : 0,
                         html: el ? el.innerHTML.length : -1 };
  Z.select('i_mfg'); Z.sync();
  await new Promise(r => setTimeout(r, 150));
  R.panelIndustrial = { chips: el ? el.querySelectorAll('[data-spec]').length : 0 };

  /* ── 14. THE CARD SEAM + SELF CHECKS ──────────────────────────────────── */
  R.cardSeam = D.cardSeam();
  R.verify = D.verify();
  R.progressState = { specs: P.state().specs, points: P.points() };
  R.zoningStats = { zoned: Z.stats().zoned, specialised: Z.stats().specialised, specPer: Z.stats().specPer };
  return R;
})()
