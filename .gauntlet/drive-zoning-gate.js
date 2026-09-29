/* Driver for the zoning growth-gate readout. Run through shot.mjs --eval; the
   return value lands beside the PNG as <out>.png.json. */
(async () => {
  const R = { steps: [] };
  const say = (k, v) => { R[k] = v; };
  const Z = window.MythicZoning, D = window.MythicDemographics, N = window.__nc;
  say('modules', { zoning: !!Z, demog: !!D, nc: !!N, hud: !!window.MythicHUD });
  if (!Z || !D || !N) return R;

  /* ── 1. Zone a residential block over the built district. ───────────────── */
  const tiles = Object.keys(N.game.tiles).filter(k => {
    const t = N.game.tiles[k]; return t && t.type === 'housing';
  });
  say('housingTiles', tiles.length);
  let zoned = 0;
  for (const k of tiles) {
    const c = k.split(',');
    if (Z.setZone(+c[0], +c[1], 'r_low')) zoned++;
  }
  Z.sync();
  say('zonedHigh', zoned);

  /* ── 2. Run the city so demographics ticks with the new ctx. ────────────── */
  say('before', {
    pop: +N.pop().toFixed(2),
    cov: N.game.cov.pct,
  });
  const st = await N.step(20, 20);
  say('stepped', { pop: st.pop, perMin: st.perMin, cov: st.cov });

  /* ── 3. What the model says. ────────────────────────────────────────────── */
  const rep = D.report();
  say('report', {
    ok: rep.ok, population: rep.population, homes: rep.homes,
    capacity: rep.capacity, limit: rep.limit, limitText: rep.limitText,
    hasGrowth: !!(rep.growth && rep.growth.ok),
  });
  say('growth', rep.growth ? {
    ok: rep.growth.ok, open: rep.growth.open, reason: rep.growth.reason,
    grow: rep.growth.grow, atCap: rep.growth.atCap, ramping: rep.growth.ramping,
    needs: (rep.growth.needs || []).map(n => ({ k: n.k, cov: n.cov, short: n.short, fix: n.fix.map(f => f.name) })),
    chip: rep.growth.chip, text: rep.growth.text,
  } : null);

  /* ── 4. The demand meter's causal list — the same sentence? ─────────────── */
  try {
    const dm = await import('/src/hud/demand.js');
    const rows = dm.read();
    const res = rows.find(r => r.id === 'res');
    say('demandRes', { value: res.value, limit: res.limit, causes: res.causes.length,
                       labels: res.causes.map(c => c.sign + ' ' + c.label),
                       gateCause: (res.causes.find(c => /growth gate|population cap/i.test(c.label)) || {}).why || null });
    say('sameSentence', res.limit === rep.limitText);
  } catch (e) { say('demandErr', String(e)); }

  /* ── 5. The map film. ───────────────────────────────────────────────────── */
  Z.overlay(true);
  await new Promise(r => setTimeout(r, 4200));      // one gate poll
  say('film', { gateShut: !!(Z.gate() && !Z.gate().open), dormantTiles: Z.dormantTiles(),
                zonedTotal: Z.stats().zoned, overlayOn: Z.stats().overlay });

  /* ── 6. The zoning panel's own line. ────────────────────────────────────── */
  Z.panel(true);
  await new Promise(r => setTimeout(r, 500));
  const gEl = document.getElementById('nz-gate');
  say('panel', { present: !!gEl, shut: !!(gEl && gEl.querySelector('.shut')),
                 text: gEl ? gEl.textContent.trim().replace(/\s+/g, ' ') : null });

  /* ── 6b. One verdict, or two? report() twice back to back must agree, and a
         difference from step 3 must be a CITY that moved, not a panel that
         disagrees with itself. */
  const t1 = D.report().limitText, t2 = D.report().limitText;
  say('stable', { twiceEqual: t1 === t2, matchesStep3: t1 === rep.limitText,
                  covNow: N.game.cov.pct, popNow: +N.pop().toFixed(2) });

  /* ── 6c. Is the sentence actually legible where the HUD puts it? A caption
         clipped to "…growth needs 90% on Food," has not ended the silence. */
  try {
    window.MythicHUD.demand ? window.MythicHUD.demand(true) : null;
  } catch (e) {}
  await new Promise(r => setTimeout(r, 600));
  const rl = document.querySelector('.rlimit');
  say('rlimit', rl ? { text: rl.textContent.trim(), h: rl.clientHeight, sh: rl.scrollHeight,
                       w: rl.clientWidth, sw: rl.scrollWidth,
                       clipped: rl.scrollHeight > rl.clientHeight + 1 || rl.scrollWidth > rl.clientWidth + 1 }
                   : { none: true, hudKeys: Object.keys(window.MythicHUD || {}) });

  /* ── 7. The People tab. ─────────────────────────────────────────────────── */
  try {
    const html = D.render();
    const m = html.match(/Limiting growth right now:[^<]*<b>([^<]*)</);
    say('peopleTab', { limitLine: m ? m[1] : null, hasGateRow: html.indexOf('dg-gate') >= 0 });
  } catch (e) { say('peopleErr', String(e)); }

  /* ── 8. gate.js itself, on synthetic input — both branches and the
         degradation path, which the live city cannot reach today. ─────────── */
  try {
    const g = await import('/src/demographics/gate.js');
    const mk = (cov) => ({ pop: 4, cap: 300, grow: 0.9, fall: 0.6, ramping: false, rampLeftSec: 0,
      needs: [{ k: 'food', name: 'Food', ico: '🍱', cov: cov[0], fix: [{ type: 'foodtruck', name: 'Food Truck', ico: '🚚' }, { type: 'grocery', name: 'Grocery Store', ico: '🛒' }] },
              { k: 'water', name: 'Water', ico: '💧', cov: cov[1], fix: [] },
              { k: 'health', name: 'Health', ico: '🩹', cov: cov[2], fix: [] }] });
    say('unit', {
      shut: g.verdict(mk([0.62, 1.0, 0.95])).text,
      twoShort: g.verdict(mk([0.62, 0.48, 0.95])).text,
      open: g.verdict(mk([0.95, 1.0, 0.95])).text,
      atCap: g.verdict(Object.assign(mk([0.95, 1.0, 0.95]), { pop: 300, cap: 300 })).text,
      noHandover: g.verdict(undefined),
      noReadings: g.verdict(mk([null, null, null])).text,
      openNotShut: g.verdict(mk([0.95, 1.0, 0.95])).open,
    });
  } catch (e) { say('unitErr', String(e)); }

  /* ── 9. Save round-trip is untouched by any of this. ────────────────────── */
  try {
    const s = JSON.parse(N.serialize());
    say('save', { zones: Object.keys(s.zones || {}).length, hasExt: !!s.ext });
  } catch (e) { say('saveErr', String(e)); }

  /* ── 10. THE FILM MUST GO BACK. A dormant mark that never clears is worse
         than no mark: the player fixes their food and the map still says the
         district is asleep. The live city cannot reach an open gate in a
         20-minute run, so the verdict is swapped at the seam and the poll is
         allowed to notice. Restored afterwards. */
  const realGrowth = D.growth;
  try {
    D.growth = () => ({ ok: true, open: true, reason: null, grow: 0.9, needs: [], text: 'open', chip: '' });
    await new Promise(r => setTimeout(r, 4200));
    say('filmOpened', { dormantTiles: Z.dormantTiles(), zonedTotal: Z.stats().zoned });
    D.growth = realGrowth;
    await new Promise(r => setTimeout(r, 4200));
    say('filmShutAgain', { dormantTiles: Z.dormantTiles() });
  } catch (e) { say('filmErr', String(e)); D.growth = realGrowth; }

  return R;
})()
