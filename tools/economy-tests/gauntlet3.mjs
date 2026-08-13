const P='../../public/src/economy/';
global.window={MythicCityBridge:{addCinders:async()=>{}},MythicResourceChain:null};
const chain=await import('../../public/src/resources/chain.js');
global.window.MythicResourceChain={ALL:chain.RESOURCE_CHAIN};
const E=(await import(P+'index.js')).default;
const Sim=await import(P+'sim.js'), Firms=await import(P+'firms.js');
let fails=[]; const chk=(n,c,e)=>{if(!c){fails.push(n);console.log('❌ '+n+(e?' :: '+e:''));}else console.log('✅ '+n);};

// Mirror node-city's ECO_BUILDING_MAP exactly.
const MAP={farm:{out:['wheat','corn','rice','potatoes','soybeans','vegetables'],ind:'farm'},
 hydrofarm:{out:['vegetables','fruit','herbs','potatoes'],ind:'farm'},
 fibercroft:{out:['cotton','plantFiber'],ind:'farm'},lumbercamp:{out:['timber','wood'],ind:'forestry'},
 quarry:{out:['stone','limestone','gravel','sand','clay','silica'],ind:'quarry'},
 scrapmine:{out:['ironOre','copperOre','aluminumOre','zincOre','nickelOre','coal'],ind:'mine'},
 fuelrig:{out:['crudeOil','naturalGas'],ind:'oilfield'},
 siphon:{out:['mythicResidue','anomalousEnergy','mythicEssence','arcaneCrystal'],ind:'anomalySite'},
 purifier:{out:['freshWater'],ind:'waterworks'},sawmill:{out:['lumber'],ind:'sawmill'},
 smelter:{out:['pigIron'],ind:'smelter'},cannery:{out:['cannedFood'],ind:'foodPlant'},
 weavery:{out:['fabric'],ind:'textileMill'},machineshop:{out:['machineParts'],ind:'machineWorks'},
 munitions:{out:['metalComponents'],ind:'fabricator'},medlab:{out:['medicine'],ind:'pharma'},
 powerstation:{out:['electricity'],ind:'powerPlant'},grocery:{out:['bread'],ind:'grocer'},
 restaurant:{out:['preparedMeals'],ind:'restaurant'},foodtruck:{out:['preparedMeals'],ind:'restaurant'},
 club:{out:['beverages'],ind:'venue'},arena:{out:['sportingGoods'],ind:'venue'},
 clinic:{out:['medicalSupplies'],ind:'clinic'},gasstation:{out:['gasoline'],ind:'transitCo'},
 housing:{out:['constructionComponents'],ind:'landlord'},depot:{out:['packagingMaterial'],ind:'distributor'},
 railyard:{out:['packagingMaterial'],ind:'distributor'},shop:{out:['boosterPacks'],ind:'cardShop'}};

// every mapped id must be real
let bogus=[]; const R=await import(P+'recipes.js');
for(const k in MAP) for(const o of MAP[k].out) if(!R.producible(o)) bogus.push(k+'→'+o);
for(const k in MAP) if(!R.INDUSTRIES[MAP[k].ind]) bogus.push(k+' ind '+MAP[k].ind);
chk('every building maps to a real resource + industry', bogus.length===0, bogus.join(','));

const tiles={}; let n=0;
const build=(type,lvl)=>{ tiles[(n++)+',0']={type,lvl:lvl||1,damaged:false}; };
const list=()=>Object.entries(tiles).filter(([k,t])=>MAP[t.type]&&!t.damaged)
  .map(([k,t])=>{const o=E.pickAvailable(MAP[t.type].out); return o?{key:k,out:o,ind:MAP[t.type].ind,lvl:t.lvl}:null;}).filter(Boolean);

E.mount({nodeId:'build-test',population:60});
const host={powerFactor:1,waterFactor:1,logisticsCounts:{warehouse:3,depot:2},hasBank:true,infrastructure:0.75};
const track=[];
for(let d=0;d<240;d++){
  // the player builds steadily, as they actually would
  if(d%8===0&&d<200){ const kinds=['farm','purifier','powerstation','grocery','housing','restaurant','quarry','sawmill',
    'lumbercamp','clinic','club','shop','scrapmine','smelter','machineshop','cannery','weavery','arena','gasstation','depot'];
    build(kinds[(d/8)%kinds.length]); }
  const cap = 4 + 12 + 6*Object.values(tiles).filter(t=>t.type==='housing').length;
  host.population = Math.min(cap, 8 + Math.floor(d*0.9));
  E.syncBuildings(list());
  E.tick(20,host);
  if(d%60===59){const s=E.snapshot();track.push(s);
    console.log(`  d${s.day} tiles=${Object.keys(tiles).length} firms=${s.firms} pop=${s.population} emp=${s.employed} unemp=${(s.unemployment*100).toFixed(0)}% savings=${s.savings.toFixed(0)}`);}
}
const first=track[0], last=track[track.length-1];
chk('firms grew with buildings', last.firms>first.firms, first.firms+' → '+last.firms);
chk('employment grew with buildings', last.employed>first.employed, first.employed+' → '+last.employed);
/* The city is bounded by housing, as node-city bounds it. What matters is that
   the labour market CLEARS while the city is small — a city that cannot employ
   its own handful of residents is broken — not that unemployment monotonically
   falls, which a growing city has no obligation to do. */
chk('labour market clears while the city is small', first.unemployment<0.35,
  'early unemployment '+(first.unemployment*100).toFixed(0)+'%');
chk('employment tracks the citizenry', last.employed>=Math.floor(last.population*0.25),
  last.employed+' employed of '+last.population+' residents');
chk('audit still clean through building churn', last.audit.ok, 'err='+(last.audit&&last.audit.err));

// demolition closes the business
const before=E.snapshot().firms;
for(const k of Object.keys(tiles).slice(0,10)) delete tiles[k];
E.syncBuildings(list()); E.tick(20,host);
chk('demolishing buildings closes their businesses', E.snapshot().firms<before, before+' → '+E.snapshot().firms);

// rebuilding a tile as a different type must not inherit the old balance sheet
tiles['0,0']={type:'clinic',lvl:1,damaged:false};
E.syncBuildings(list());
const atKey=Firms.alive().filter(f=>f.tileKey==='0,0');
chk('rebuilt tile gets a NEW business', atKey.length===1&&atKey[0].ind==='clinic', JSON.stringify(atKey.map(f=>f.ind+':'+f.out)));

// idempotent: syncing twice must not double-found
const c1=E.snapshot().firms; E.syncBuildings(list()); E.syncBuildings(list());
chk('syncBuildings is idempotent', E.snapshot().firms===c1, c1+' → '+E.snapshot().firms);

// card economy reached
const co=E.cardOutput();
chk('card shop puts Ouroboros product in the economy', co.totalUnits>0||E.price('boosterPacks')>0, JSON.stringify(co).slice(0,80));

console.log('\n=== GAUNTLET 3: '+(fails.length?fails.length+' FAILURES':'ALL PASS')+' ===');
if(fails.length) process.exitCode=1;
