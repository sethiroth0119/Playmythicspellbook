/* CRITIC 8 — (a) does the bootstrap ghost firm coexist with a real Water Intake?
                (b) the quartz displacement figure, re-measured. */
global.window = global.window || {};
window.MythicCityBridge = { addCinders: async()=>true, getCinders: async()=>9e9 };
const E = (await import('../public/src/economy/index.js')).default;
const HOST = { powerFactor:1, waterFactor:1, hasBank:true, infrastructure:.8, logisticsCounts:{warehouse:3,depot:3} };
const DAY=24*60;
console.log('### (a) THE GHOST FIRM AND THE PLAYER-BUILT INTAKE, SIDE BY SIDE');
E.mount({ nodeId:'crit-ghost-1', population:200, established:false });
E.tick(DAY,HOST);
const g0 = E.firms().filter(f=>f.out==='rawWater').map(f=>({id:f.id,tileKey:f.tileKey,name:f.name}));
console.log('  after bootstrap, rawWater firms:', JSON.stringify(g0));
E.syncBuildings([{key:'5,5',out:'rawWater',ind:'waterworks',lvl:1,name:'Water Intake'}]);
for(let d=0;d<20;d++){ E.tick(DAY,HOST); E.syncBuildings([{key:'5,5',out:'rawWater',ind:'waterworks',lvl:1,name:'Water Intake'}]); }
const g1 = E.firms().filter(f=>f.out==='rawWater').map(f=>({id:f.id,tileKey:f.tileKey===undefined?'(undef)':f.tileKey,name:f.name,rung:f.rung,made:+(f.lastProduced||0).toFixed(1)}));
console.log('  after the player builds ONE Water Intake, rawWater firms:', JSON.stringify(g1));
console.log('  → count =', g1.length, g1.length>1 ? ' *** the invisible bootstrap firm STILL EXISTS beside it ***' : '');

console.log('\n### (b) quartz appended to the QUARRY row — pickAvailable displacement, 500 nodes');
const R = await import('../public/src/economy/recipes.js');
const En = await import('../public/src/economy/endowment.js');
const pick = (nodeId,out)=>{let best=null,br=-1;for(const id of out){if(!R.producible(id))continue;if(!R.isDeposit(id))return id;
  if(!En.canExtract(nodeId,id))continue;const rk=(En.gradeDef(En.gradeOf(nodeId,id))||{}).rank||0;if(rk>br){br=rk;best=id;}}return best;};
const QUARRY=['stone','limestone','gravel','sand','clay','silica'];
const DEEP=['goldOre','silverOre','platinumOre','rareMinerals'];
let chQ=0,dispLime=0,dispWhat={},chD=0,dispD={};
for(let i=0;i<500;i++){const n='crit-node-'+i;
  const a=pick(n,QUARRY), b=pick(n,QUARRY.concat('quartz'));
  if(a!==b){chQ++; if(a==='limestone')dispLime++; dispWhat[a]=(dispWhat[a]||0)+1;}
  const c=pick(n,DEEP), d=pick(n,DEEP.concat('quartz'));
  if(c!==d){chD++; dispD[c]=(dispD[c]||0)+1;}}
console.log('  QUARRY  + quartz: pickAvailable changed on', chQ, 'of 500; displaced:', JSON.stringify(dispWhat), '| limestone displaced on', dispLime);
console.log('  DEEPMINE+ quartz: pickAvailable changed on', chD, 'of 500; displaced:', JSON.stringify(dispD));
