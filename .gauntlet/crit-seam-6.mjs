/* CRITIC 6 — the rawWater bug, reproduced and then fixed, one variable, one city. */
global.window = global.window || {};
window.MythicCityBridge = { addCinders: async()=>true, getCinders: async()=>9e9 };
const E = (await import('../public/src/economy/index.js')).default;
const HOST = { powerFactor:1, waterFactor:1, hasBank:true, infrastructure:.8, logisticsCounts:{warehouse:3,depot:3} };
const DAY = 24*60;

function run(nodeId, withIntake) {
  E.mount({ nodeId, population: 200, established: false });
  for (let d=0; d<30; d++) E.tick(DAY, HOST);
  const fw = E.firms().filter(f => f.out === 'rawWater');
  const rep = { node: nodeId,
    rawWaterFirms: fw.map(f => ({ id: f.id, tileKey: f.tileKey === undefined ? '(undefined)' : f.tileKey, rung: f.rung })),
    freshWaterBottleneck: null };
  // kill every rawWater firm the way a bankruptcy does, then reconcile like the host does
  for (const f of fw) { f.rung = 'BANKRUPT'; f.reported = true; }
  const tiles = withIntake
    ? [{ key: '5,5', out: 'rawWater', ind: 'waterworks', lvl: 1, name: 'Water Intake' }]
    : [];
  const r = E.syncBuildings(tiles);
  for (let d=0; d<30; d++) E.tick(DAY, HOST);
  const after = E.firms().filter(f => f.out === 'rawWater');
  rep.syncResult = r;
  rep.rawWaterAfter = after.map(f => ({ tileKey: f.tileKey === undefined ? '(undefined)' : f.tileKey, rung: f.rung, made: +(f.lastProduced||0).toFixed(2) }));
  const tr = E.trace ? E.trace('freshWater') : null;
  rep.trace = tr;
  rep.inventoryRawWater = +(E.inventory()['rawWater']||0).toFixed(2);
  rep.freshWaterFirm = E.firms().filter(f=>f.out==='freshWater').map(f=>({rung:f.rung, made:+(f.lastProduced||0).toFixed(2), bn:f.lastBottleneck&&f.lastBottleneck.label}));
  return rep;
}
console.log('### WITHOUT a Water Intake tile (the pre-commit world after the bootstrap firm dies)');
console.log(JSON.stringify(run('crit-water-A', false), null, 1));
console.log('\n### WITH a Water Intake tile (what this commit makes possible)');
console.log(JSON.stringify(run('crit-water-A', true), null, 1));
