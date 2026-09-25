/* 🔌 DRIVE THE ELECTRICITY TRADE METER in the real page.
   Run:  node .gauntlet/shot.mjs .gauntlet/shots/trade.png --scene --wait 24000 \
           --eval "$(cat .gauntlet/drive-power-trade.js)"
   The result lands beside the PNG as trade.png.json.

   Four states, in the order a player meets them:
     A  CUT OFF          172-tile district, no interchange. The meter must
                         REFUSE and name the building, not read 0 kW.
     B  CONNECTED, SHORT  interchange + road. The city has no generator at all,
                         so it should IMPORT its whole demand and the brownout
                         should lift.
     C  CONNECTED, LONG   a Power Station goes up; the surplus should EXPORT.
     D  THE BILL          /src/economy must be holding a real Cinder figure for
                         the energy that crossed, and the audit must be clean. */
(async () => {
  const nc = window.__nc; if (!nc) return 'no __nc';
  const P = window.MythicPower, O = window.MythicOutside, E = window.MythicEconomy;
  const out = { have: { power: !!P, outside: !!O, economy: !!(E && E.ready && E.ready()) } };
  if (!P || !O) return out;
  const done = () => { try { nc.build.finishAll('trade driver'); } catch (e) {} };
  const place = async (t, x, z) => { try { await nc.place(t, x, z); } catch (e) {} done();
                                     return !!nc.game.tiles[x + ',' + z]; };
  /* `__nc.step(mins)` is the SHIPPED economy/vitals beat with the clock
     injected — economyTick is where the power pre-pass and /src/power's solve()
     actually run, so nothing about this feature moves without it. */
  const tick = async (min) => { try { await nc.step(min); } catch (e) {} };
  const trade = () => { const t = P.trade(); return { ok: t.ok, imp: t.importUnits, exp: t.exportUnits,
                          cap: t.importCap, arrears: t.arrears, curtailed: t.curtailed,
                          connected: t.connected, priced: t.priced, why: t.why, fix: t.fix }; };
  const grid = () => { const s = P.state(); return s && s.ok
    ? { capacity: +s.capacity.toFixed(3), load: +s.load.toFixed(3), served: +s.served.toFixed(3),
        ratio: +s.ratio.toFixed(3), factor: +s.factor.toFixed(3) } : { ok: false }; };

  /* ── A. CUT OFF ─────────────────────────────────────────────────────────── */
  out.A = { outside: { connected: O.state().connected, reason: O.state().reason },
            trade: trade(), grid: grid(), power: nc.power() };

  /* ── B. CONNECT IT ──────────────────────────────────────────────────────── */
  /* One more Supply Depot buys +10 road cap; the district ran the cap dry (29
     road placements were refused in the standard scene), so without this the
     two tiles of ramp road cannot be laid at all. This is exactly the forced
     order the scene builder documents: housing → depots → roads. */
  const freeNearRoad = () => {
    for (let x = 1; x < 23; x++) for (let z = 1; z < 23; z++) {
      if (nc.game.tiles[x + ',' + z]) continue;
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const t = nc.game.tiles[(x + dx) + ',' + (z + dz)];
        if (t && t.type === 'road') return [x, z];
      }
    }
    return null;
  };
  const dp = freeNearRoad();
  out.B = { depot: dp ? await place('depot', dp[0], dp[1]) : false, depotAt: dp };
  /* Column x=4 carries the standard grid's first north–south street and its
     top tile is (4,3), so (4,0) is the interchange and (4,1)+(4,2) is the ramp
     road that joins it to the city. */
  out.B.interchange = await place('interchange', 4, 0);
  out.B.road1 = await place('road', 4, 1);
  out.B.road2 = await place('road', 4, 2);
  try { O.invalidate(); } catch (e) {}
  await tick(2);
  out.B.outside = { connected: O.state().connected, via: O.state().via, reason: O.state().reason };
  out.B.trade = trade(); out.B.grid = grid(); out.B.power = nc.power();

  /* ── C. BUILD A GENERATOR AND FLIP THE FLOW ─────────────────────────────── */
  /* ☀️ SOLAR FARMS, NOT THE POWER STATION, AND THE REASON IS A REAL GATE.
     A Power Station declares `use: { fuel: 0.55 }` and node-city's input gate
     gives a generator with ANY input at zero an output of zero — this city has
     never made a drop of fuel, so one placed here reads `capacity: 0` and
     `idlePlants: 1`, which is CORRECT and demonstrates nothing about trade.
     (Measured: the first run of this driver did exactly that.) `solar` has no
     `use` block at all, so it is the cheapest honest surplus available.
     ⚠ RUN THIS WITH `--hour 13`. Solar availability is a function of the clock
       (/src/power/plants.js) and estClock() reads the real wall clock, so an
       unpinned run photographs whatever time of day it happens to be — the same
       trap that cost the visual loop three rounds. At night these produce
       nothing and the city correctly keeps importing.
     The Construction Co. still goes up first: it lifts the 2,400 s municipal
     ceiling and buys extra crew slots, and without it a third placement in a
     row is refused outright. */
  const c1 = freeNearRoad();
  out.C = { constructionCo: c1 ? await place('op_construction', c1[0], c1[1]) : false, coAt: c1 };
  out.C.solar = [];
  for (let i = 0; i < 3; i++) {
    const p1 = freeNearRoad();
    if (!p1) break;
    out.C.solar.push({ at: p1, placed: await place('solar', p1[0], p1[1]) });
  }
  /* 👷 HIRE THE CREW. `staffingRatio()` is `game.army.workers / crewNeeded()`
     and the harness never hires anybody, so it is ZERO — which multiplies EVERY
     generator in the city to zero output. That is not a bug and it is not
     specific to this feature: it is why the standard capture's whole city
     produces nothing, and the electricity panel already says so in as many
     words ("a plant with no crew makes no power. Hire workers"). Staffing the
     city is the one thing a player does that this harness cannot, so it is done
     here, on the game's own field, rather than by faking a plant's output. */
  out.C.hired = { before: nc.game.army.workers };
  try { nc.game.army.workers = 400; } catch (e) {}
  out.C.hired.after = nc.game.army.workers;
  done();
  await tick(2);
  out.C.trade = trade(); out.C.grid = grid(); out.C.power = nc.power();
  try { const st = P.state(); out.C.fleet = st && st.byPlant ? st.byPlant.map(p => ({ type: p.type, out: +p.out.toFixed(2), avail: +(p.avail || 0).toFixed(2), why: p.why })) : null; } catch (e) {}

  /* ── D. THE BILL ────────────────────────────────────────────────────────── */
  /* 20 real minutes is exactly one economic day (ECON.clock.dayMin), which is
     when /src/economy settles the link inside runDay's audit window. */
  await tick(22);
  if (E && E.ready && E.ready()) {
    const u = E.utilityReport(), s = E.snapshot();
    out.D = { pendingImport: +u.pendingImport.toFixed(4), pendingExport: +u.pendingExport.toFixed(4),
              pendingImportUnitMin: +u.pendingImportUnitMin.toFixed(3),
              pendingExportUnitMin: +u.pendingExportUnitMin.toFixed(3),
              arrears: u.arrears, last: u.last,
              auditOk: !!(s.audit && s.audit.ok), auditErr: s.audit && s.audit.err,
              flowUtilityImport: s.flow.utilityImport, flowUtilityExport: s.flow.utilityExport,
              payoutAllowed: s.payoutAllowed };
  } else { out.D = 'economy not ready'; }

  /* ── E. THE LOUD FALLBACK ───────────────────────────────────────────────
     "A guarded read that silently substitutes a plausible value is
     indistinguishable from a working integration." A trade meter reading
     0 kW / 0 kW is a CLAIM that the link is live and idle, so the two module
     absences must each produce a DIFFERENT sentence, not a zero. Proved by
     taking each global away and putting it back. */
  const keepO = window.MythicOutside, keepE = window.MythicEconomy;
  try { window.MythicOutside = null; await tick(1); } catch (e) {}
  out.E = { noOutside: P.trade().why };
  window.MythicOutside = keepO;
  try { window.MythicEconomy = null; await tick(1); } catch (e) {}
  out.E.noEconomy = P.trade().why;
  window.MythicEconomy = keepE;
  try { await tick(1); } catch (e) {}
  out.E.restored = P.trade().ok;

  /* ── AND THE PANEL ITSELF, so the meter is in the screenshot. ───────────── */
  /* ⚠ CLOSE THE INSPECTOR FIRST. `nc.place()` is tryPlace(), and tryPlace opens
     the building modal on the tile it just wrote — so the last thing placed
     sits on top of the electricity panel and the screenshot photographs a
     Construction Co. instead of the meter. Cost one round. */
  try { nc.closeInspect(); } catch (e) {}
  try { P.openPanel(); } catch (e) {}
  const el = document.querySelector('#ncpwr');
  out.panel = el ? { open: true,
                     hasTradeSection: /ELECTRICITY TRADE/.test(el.textContent),
                     hasReserveSection: /RESERVE MARGIN/.test(el.textContent),
                     tradeText: (el.textContent.split('ELECTRICITY TRADE')[1] || '').slice(0, 420) }
                 : { open: false };
  return out;
})()
