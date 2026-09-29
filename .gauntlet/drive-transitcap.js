/* 🚆 THE TRANSIT BUILD-TIME AUDIT, driven against the real page.
   Every transit type, its SHIPPED duration off bldDuration(), against the free
   Municipal Works ceiling — plus the actual refusal a player gets when they
   click the tile. Run through .gauntlet/shot.mjs --scene --eval. */
(async () => {
  const nc = window.__nc, ops = window.__ncOps;
  const out = { steps: [] };
  if (!nc || !nc.build) return (window.__AUDIT = { err: 'no __nc.build' });
  const C = nc.build.cfg();
  out.ceiling = C ? C.municipal.maxSec : null;
  out.slots = nc.build.slots(); out.speed = nc.build.speed(); out.hasCo = nc.build.hasCo();
  const hms = s => { s = Math.round(s); const h = (s/3600)|0, m = ((s%3600)/60)|0, x = s%60;
    return (h ? h+':' : '') + String(m).padStart(h?2:1,'0') + ':' + String(x).padStart(2,'0'); };
  out.set = {};
  for (const t of ['busstop', 'trainstation', 'railtrack']) {
    const d = nc.build.timeFor(t, 1, 0, nc.build.speed());
    out.set[t] = { sec: d, hms: hms(d), exempt: nc.build.exempt(t),
                   over: C ? d > C.municipal.maxSec : null, cost: nc.BUILDINGS[t].cost };
  }
  /* the licences, so the placement gate is reached at all */
  ops.mockBuy('bus'); ops.mockBuy('rail'); await ops.refresh(true);
  out.licences = { bus: window.MythicTransit.hasLicence('bus'), rail: window.MythicTransit.hasLicence('rail') };
  /* Capture what the player is TOLD. ⚠ `toast` is a top-level `const` in
     node-city's module script — the CLAUDE.md globals trap — so there is no
     window.toast to wrap. `window.__ncToastSink` is the shipped seam (zoning's
     bulk-refusal summariser uses it) and it is the only way to read a refusal. */
  const said = [];
  window.__ncToastSink = (m) => { said.push(String(m)); };
  /* auto-accept the long-order confirm so it is never the thing that blocks */
  try { window.gcConfirm = () => Promise.resolve(true); } catch (e) {}
  const free = [];
  for (let x = 2; x < 26 && free.length < 30; x++) for (let z = 2; z < 26 && free.length < 30; z++)
    if (!nc.game.tiles[x + ',' + z]) free.push([x, z]);
  const tryOne = async (type) => {
    said.length = 0;
    const [x, z] = free.shift();
    await nc.place(type, x, z);
    const t = nc.game.tiles[x + ',' + z];
    return { at: x + ',' + z, stood: !!t, timed: !!(t && t.bld), said: said.slice() };
  };
  out.place = {};
  out.place.trainstation = await tryOne('trainstation');
  out.place.busstop      = await tryOne('busstop');
  /* track: lay a RUN of it, which is what a rail line needs */
  out.track = { laid: 0, refused: 0, said: [] };
  for (let i = 0; i < 8; i++) {
    said.length = 0;
    const [x, z] = free.shift();
    await nc.place('railtrack', x, z);
    if (nc.game.tiles[x + ',' + z]) out.track.laid++; else { out.track.refused++; if (said.length) out.track.said.push(said[0]); }
  }
  out.track.jobs = nc.build.list().length;
  window.__ncToastSink = null;
  window.__AUDIT = out;
  console.log('AUDIT_SET ' + JSON.stringify(out.set));
  console.log('AUDIT_META ' + JSON.stringify({ ceiling: out.ceiling, slots: out.slots, speed: out.speed, hasCo: out.hasCo, licences: out.licences }));
  console.log('AUDIT_STATION ' + JSON.stringify(out.place.trainstation));
  console.log('AUDIT_BUSSTOP ' + JSON.stringify(out.place.busstop));
  console.log('AUDIT_TRACK ' + JSON.stringify(out.track));
})();
