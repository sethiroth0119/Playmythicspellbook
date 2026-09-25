/* ══════════════════════════════════════════════════════════════════════════
   DRIVE /src/pollution — build a coal plant beside the standard district's
   housing, run the economy, and MEASURE the plume instead of looking at it.

   Runs inside the page via page.evaluate, after .gauntlet/scene.js. Everything
   it asserts goes through the shipped seams: __nc.place (tryPlace),
   __nc.step (economyTick + vitalsTick), __nc.pollutionAt (explainAt).

   The four questions:
     1. is there a plume at all, and is it DOWNWIND rather than upwind?
     2. does ground pollution reach /src/water's aquifer purity?
     3. do the three consequences actually bite (health demand, Hope, rent)?
     4. what does the diffusion cost per tick?
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const nc = window.__nc, PL = window.MythicPollution, out = {};
  if (!nc) return console.log('POL no __nc');
  if (!PL) return console.log('POL no MythicPollution');
  const B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const done = () => { try { nc.build.finishAll('pollution drive'); } catch (e) {} };

  const w0 = PL.wind();
  out.wind = { dir: Math.round(w0.dir), point: w0.point, speed: +w0.speed.toFixed(3),
               dx: +w0.dx.toFixed(3), dz: +w0.dz.toFixed(3), prevailing: w0.prevailing };
  out.endow = PL.endowment().summary;

  /* 👷 HIRE THE CREW. Emissions are keyed on `tileMult`, which carries
     staffingRatio() — so an UNSTAFFED plant has a cold chimney and emits
     nothing at all. That is the design (see tuning.js `sources`), and it means
     the standard gauntlet city, which hires nobody, is legitimately spotless.
     The drive has to staff it or it is measuring a city with the works shut. */
  try { nc.game.army.workers = 60; } catch (e) {}
  /* 🔒 …and lift the free Municipal Works ceiling. A Coal Plant takes 52:42 to
     raise, which is over ECON.construction.municipal.maxSec, so the ORDER is
     refused before tryPlace ever reaches placement — a player answers that with
     a Construction Co., and a driver answers it by raising the ceiling. This is
     the only shipped gate this driver moves, and it is a gate about BUILD TIME,
     not about pollution. (The first two runs of this file reported a plume of
     exactly zero because the plant was never built and the refusal was a toast
     nobody was listening to.) */
  try { window.MythicEconomy.ECON.construction.municipal.maxSec = 9e6; } catch (e) {}

  /* THE PLANT, PUT UPWIND OF THE HOUSING ON PURPOSE. The scene's homes are the
     western blocks (x 5–11); this city's prevailing wind blows east; so a stack
     at x=3 puts the plume straight over them, which is the mistake the CS2
     tutorial is teaching a player not to make. Road at (4,10) is what makes the
     tile placeable. */
  const SX = 3, SZ = 10;
  /* Refusals are toasts, and a silent refusal is why the first run of this
     driver reported a plume of zero with nothing to say. The zoning module's
     bulk sink is the seam for capturing them. */
  const refusals = [];
  window.__ncToastSink = (m) => refusals.push(String(m).slice(0, 90));
  try { await nc.place('coal', SX, SZ); } catch (e) {}
  done();
  out.plant = nc.game.tiles[SX + ',' + SZ] ? nc.game.tiles[SX + ',' + SZ].type : 'FAILED';
  // …and a dirty industry, to prove the retro-fit feeds the same fields.
  try { await nc.place('smelter', 6, 18); } catch (e) {}
  done();
  out.smelter = nc.game.tiles['6,18'] ? nc.game.tiles['6,18'].type : 'FAILED';
  window.__ncToastSink = null;
  out.refusals = refusals.slice(0, 4);

  const before = { cov: { ...(nc.game.cov.pct || {}) } };

  /* 120 economy minutes in 240 slices. The air settles inside 20 (a 4½-minute
     half-life), but the GROUND's is 45 and the aquifer's rise is slower still,
     so a 40-minute run measured a plume that had arrived over a water table
     that had barely started to move. */
  const r = await nc.step(120, 240);
  out.after = { pop: r.pop, cov: r.cov, hope: r.vitals.hope, health: r.vitals.health };

  const st = PL.state();
  if (!st || !st.ok) { console.log('POL state ' + JSON.stringify(st)); return; }
  out.field = { meanAir: +st.diag.mean.air.toFixed(4), peakAir: +st.diag.peak.air.toFixed(3),
                meanGround: +st.diag.mean.ground.toFixed(4), peakGround: +st.diag.peak.ground.toFixed(3),
                meanWater: +st.diag.mean.water.toFixed(4), peakWater: +st.diag.peak.water.toFixed(3),
                hot: st.diag.hot, stepMs: +st.diag.stepMs.toFixed(3), steps: st.diag.steps,
                breach: st.diag.breach };
  out.effect = { exposure: +st.exposure.toFixed(3), healthLoad: +st.healthLoad.toFixed(3),
                 moraleHit: +st.moraleHit.toFixed(2), landValue: +st.landValue.toFixed(3),
                 homes: st.homes, exposedHomes: st.exposedHomes };
  out.water = st.water;
  out.sources = st.sources.length;

  /* 🧭 THE DIRECTION TEST. Sample three tiles downwind of the stack and three
     upwind. If the minus sign in advect() were the wrong way round these two
     would swap, and nothing else in the feature would look wrong. */
  const probe = (n) => {
    const x = Math.round(SX + w0.dx * n), z = Math.round(SZ + w0.dz * n);
    const e = nc.pollutionAt(x, z);
    return { x, z, air: e ? +e.air.toFixed(3) : null };
  };
  out.downwind = [probe(2), probe(4), probe(6)];
  out.upwind = [probe(-2), probe(-4), probe(-6)];
  out.atStack = probe(0);

  const blame = nc.pollutionAt(Math.round(SX + w0.dx * 3), Math.round(SZ + w0.dz * 3));
  out.blame = blame && blame.blame.slice(0, 2).map(b => b.name + ' ' + b.where);

  /* 💾 SAVE / LOAD ROUND TRIP, through the host's own serialize(). A field that
     does not survive a reload is a field the player watches reset every time
     they come back, and the sparse encoding is exactly where that would break
     without anyone noticing. */
  try {
    const blob = PL.save();
    const probeK = Math.round(SX + w0.dx * 2) + ',' + Math.round(SZ + w0.dz * 2);
    const [px, pz] = probeK.split(',').map(Number);
    const was = { air: +PL.airAt(px, pz).toFixed(3), ground: +PL.groundAt(px, pz).toFixed(3) };
    PL.load(null);                                   // wipe, as an absent save would
    const wiped = +PL.airAt(px, pz).toFixed(3);
    PL.load(blob);                                   // …and restore
    out.save = { cells: blob.air.length / 2 + blob.ground.length / 2 + blob.water.length / 2,
                 was, wiped, back: { air: +PL.airAt(px, pz).toFixed(3), ground: +PL.groundAt(px, pz).toFixed(3) },
                 foreign: PL.load({ v: 1, cityId: 'someone-elses-city', grid: 24, air: [], ground: [], water: [] }) };
    PL.load(blob);
  } catch (e) { out.save = 'threw ' + e.message; }
  out.selfCheck = PL.selfCheck(Object.keys(nc.game.tiles).length ? null : null);

  /* Open the info view AND the hydrology one beside it — the pair a player has
     open when they are doing what this batch is for. */
  nc.pollutionPanel(true);
  try { nc.waterPanel(true); } catch (e) {}
  try { PL.layers.ground = true; PL.layers.water = true; PL.openPanel(); } catch (e) {}

  const s = JSON.stringify(out);
  for (let i = 0; i < s.length; i += 350) console.log('POL' + (i / 350 | 0) + ' ' + s.slice(i, i + 350));
})()
