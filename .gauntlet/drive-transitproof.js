/* 🚆 THE HEADLINE PROOF: a fresh city, no Construction Co., buys the Rail
   Operator licence and raises a Train Station — quoted against the ceiling. */
(async () => {
  const nc = window.__nc, ops = window.__ncOps;
  ops.mockBuy('rail'); await ops.refresh(true);
  window.gcConfirm = () => Promise.resolve(true);
  const C = nc.build.cfg();
  const n = nc.build.crewNote('trainstation');
  let x = 12, z = 12; while (nc.game.tiles[x + ',' + z]) x++;
  await nc.place('trainstation', x, z);
  for (let i = 1; i <= 6; i++) await nc.place('railtrack', x + i, z);
  const t = nc.game.tiles[x + ',' + z];
  console.log('PROOF ' + JSON.stringify({
    hasCo: nc.build.hasCo(), slots: nc.build.slots(), speed: nc.build.speed(),
    station: n.label + ' (' + n.sec + 's)', ceiling: n.ceilingLabel + ' (' + n.ceilingSec + 's)',
    headroom: (n.ceilingSec - n.sec) + 's', over: n.over, needsCo: n.needsCo,
    stood: !!t, timerRunning: !!(t && t.bld), remain: Math.round(nc.build.remain(x + ',' + z)),
    trackLaid: [1,2,3,4,5,6].filter(i => nc.game.tiles[(x+i) + ',' + z]).length,
    jobsOnTheBoard: nc.build.list().length,
  }));
  nc.build.beat();
})();
