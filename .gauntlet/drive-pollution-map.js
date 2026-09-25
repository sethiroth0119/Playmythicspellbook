/* Overlay-only look: same city and same plant as drive-pollution.js, but the
   camera is put overhead and the panels are pushed aside, so the PICTURE is
   what gets judged — the plume, its direction, and the wind arrows over it. */
(async () => {
  const nc = window.__nc, PL = window.MythicPollution;
  if (!nc || !PL) return console.log('POL no seam');
  const B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const done = () => { try { nc.build.finishAll('map drive'); } catch (e) {} };
  try { nc.game.army.workers = 60; } catch (e) {}
  try { window.MythicEconomy.ECON.construction.municipal.maxSec = 9e6; } catch (e) {}
  window.__ncToastSink = () => {};
  try { await nc.place('coal', 3, 10); } catch (e) {} done();
  try { await nc.place('smelter', 6, 18); } catch (e) {} done();
  window.__ncToastSink = null;
  await nc.step(120, 240);

  PL.layers.air = true; PL.layers.wind = true; PL.layers.sources = true;
  PL.layers.ground = false; PL.layers.water = false; PL.layers.value = false;
  PL.openPanel();
  try { nc.waterPanel(false); } catch (e) {}
  try { document.getElementById('ncpol').style.display = 'none'; } catch (e) {}

  /* ⚠ THE CAMERA IS LEFT ALONE. Setting position/lookAt and then calling
     controls.update() handed OrbitControls an offset it re-derived from, and the
     photograph came back looking at an empty quarter of the map with the whole
     district off frame. The shipped default framing already shows the district;
     hiding the panels is enough to make the OVERLAY the subject. */
  try { const t = nc.three ? nc.three() : null;
        if (t && t.renderer && t.scene && t.camera) t.renderer.render(t.scene, t.camera); } catch (e) {}
  const st = PL.state();
  console.log('POLmap peakAir=' + st.diag.peak.air.toFixed(3) + ' wind=' + st.wind.point +
              ' ' + Math.round(st.wind.deg) + '° stepMs=' + st.diag.stepMs.toFixed(2));
})()
