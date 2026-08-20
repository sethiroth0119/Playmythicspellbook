global.window = global.window || {};
window.MythicCityBridge = { addCinders: async()=>true, getCinders: async()=>9e9 };
const E = (await import('../public/src/economy/index.js')).default;
const HOST = { powerFactor:1, waterFactor:1, hasBank:true, infrastructure:.8, logisticsCounts:{warehouse:3,depot:3} };
const DAY=24*60;
E.mount({ nodeId:'crit-alt-1', population:200, established:true });
E.tick(DAY,HOST);
// Kill every rawWater / reclaimedWater producer, permanently: reap them each day.
const kill = () => { for (const f of E.firms()) if (f.out==='rawWater'||f.out==='reclaimedWater') { f.rung='BANKRUPT'; f.reported=true; } };
kill(); E.syncBuildings([{key:'9,9',out:'freshWater',ind:'waterworks',lvl:1,name:'Purifier'}]);
let tot=0;
for (let d=0; d<30; d++) {
  kill(); E.tick(DAY,HOST);
  const f = E.firms().find(x=>x.out==='freshWater');
  if (f) { tot += f.lastProduced||0;
    if (d%6===0||d===29) console.log('day '+String(d).padStart(2)+
      ' rung='+String(f.rung).padEnd(9)+' made='+(+f.lastProduced).toFixed(1).padStart(7)+
      ' leg='+String(f.lastLeg&&f.lastLeg.tag).padEnd(10)+
      ' bn='+String(f.lastBottleneck&&f.lastBottleneck.label)+
      ' | invRaw='+(E.inventory().rawWater||0).toFixed(2)+' invRecl='+(E.inventory().reclaimedWater||0).toFixed(2)); }
  else if (d%6===0) console.log('day '+d+' — purifier gone');
}
console.log('TOTAL freshWater from ZERO rawWater and ZERO reclaimedWater over 30 days =', tot.toFixed(1));
