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
 fibercroft:{out:['cotton','plantFiber'],ind:'farm'},lumbercamp:{out:['timber'],ind:'forestry'},
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
 railyard:{out:['packagingMaterial'],ind:'distributor'},shop:{out:['boosterPacks'],ind:'cardShop'},
 papermill:{out:['cardStock'],ind:'paperMill'},printworks:{out:['printedCards'],ind:'cardPrinter'}};

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

/* ════════════════════════════════════════════════════════════════════════════
   👻 THE BOOTSTRAP SCAFFOLD — IT HAS TO STAND, AND IT HAS TO COME DOWN
   ----------------------------------------------------------------------------
   `bootstrap()` founds firms with NO tileKey so a brand-new city has water,
   power and food before the player has built anything. `syncBuildings` opens
   with `if (!f.tileKey) continue`, so for the whole life of that seam it could
   never retire one — and once `waterintake` gave the player a BUILDING for the
   same job, every city that built one ran TWO rawWater businesses: the visible
   Water Intake and an invisible Waterworks the player could not inspect or
   demolish, on a second payroll, doubling their own supply.

   Both directions are asserted here because fixing one by breaking the other is
   the obvious failure: retire too eagerly and a fresh city has no water at all,
   which is strictly worse than the ghost. sim.js `retireSeededDuplicates()`
   carries the reasoning. */
{
  const rw = () => Firms.alive().filter(f=>f.out==='rawWater');
  const H = {powerFactor:1,waterFactor:1,hasBank:true,infrastructure:.8,logisticsCounts:{warehouse:3,depot:3}};
  const DAY = 24*60;

  /* 1. THE SCAFFOLD STANDS. A city the player has built nothing in — and whose
        host reconciles an EMPTY tile list at every tick, which is what node-city
        actually does — must still have a water business. */
  E.mount({nodeId:'crit-ghost-1',population:200,established:false});
  for(let d=0;d<30;d++){ E.tick(DAY,H); E.syncBuildings([]); }
  const fresh = rw();
  chk('a fresh city with NO buildings still has water (the scaffold is not reaped)',
      fresh.length===1 && !fresh[0].tileKey, JSON.stringify(fresh.map(f=>f.name+'@'+f.tileKey)));

  /* 2. AND IT COMES DOWN when the player builds the real thing. One producer,
        and it is the one with a tile under it. */
  const intake = [{key:'5,5',out:'rawWater',ind:'waterworks',lvl:1,name:'Water Intake'}];
  E.syncBuildings(intake);
  for(let d=0;d<10;d++){ E.tick(DAY,H); E.syncBuildings(intake); }
  const after = rw();
  chk('building a Water Intake retires the invisible bootstrap Waterworks',
      after.length===1 && after[0].tileKey==='5,5', JSON.stringify(after.map(f=>f.name+'@'+(f.tileKey||'(none)'))));
  chk('…and the surviving producer is actually producing',
      (after[0]&&after[0].lastProduced||0) > 0, 'made '+(after[0]&&after[0].lastProduced));
  const sn = E.snapshot();
  chk('…and the audit is clean across the retirement (the estate is a transfer)',
      sn.audit.ok, 'err='+(sn.audit&&sn.audit.err));

  /* 3. IDENTITY IS out+ind, NOT out. bootstrap founds bread twice — a foodPlant
        that bakes it and a grocer that sells it — so a rule keyed on `out`
        alone would close the city's bakery the day it opened a corner shop.
        Driven from the other side: a tile whose `ind` DIFFERS must retire
        nothing. */
  E.mount({nodeId:'crit-ghost-1',population:200,established:false});
  E.tick(DAY,H);
  const seededBread = Firms.alive().filter(f=>f.out==='bread'&&!f.tileKey).map(f=>f.ind);
  E.syncBuildings([{key:'7,7',out:'bread',ind:'foodPlant',lvl:1,name:'Bakery'}]);
  const kept = Firms.alive().filter(f=>f.out==='bread'&&!f.tileKey).map(f=>f.ind);
  chk('a tile matching only on `out` retires NOTHING — identity is out+ind',
      seededBread.length>0 && kept.length===seededBread.length,
      'seeded ['+seededBread.join(',')+'] → kept ['+kept.join(',')+']');
  E.syncBuildings([{key:'7,7',out:'bread',ind:'foodPlant',lvl:1,name:'Bakery'},
                   {key:'8,8',out:'bread',ind:'grocer',lvl:1,name:'Grocery'}]);
  chk('…and a tile matching on BOTH does retire it',
      Firms.alive().filter(f=>f.out==='bread'&&!f.tileKey).length===0,
      JSON.stringify(Firms.alive().filter(f=>f.out==='bread').map(f=>f.ind+'@'+(f.tileKey||'(none)'))));
}

/* ════════════════════════════════════════════════════════════════════════════
   🃏 THE OUROBOROS CHAIN, END TO END — and why this section was rewritten.
   ----------------------------------------------------------------------------
   🔴 THE ASSERTION THAT USED TO LIVE HERE COULD NOT FAIL:

       chk('card shop puts Ouroboros product in the economy',
           co.totalUnits > 0 || E.price('boosterPacks') > 0, …)

   `Prices.priceOf()` is base × multiplier and is ALWAYS > 0 — the base is
   floored at ECON.price.rawFloor and the multiplier is clamped to a positive
   band — so the right-hand side is a constant `true`. Measured before the fix:
   that line printed ✅ while `cardOutput()` returned
   {units:{}, totalUnits:0, value:0, exported:0} after 600 days at population
   600, which is what a card economy that has never produced one card looks
   like. It was the ONLY test covering the chain.

   What replaces it tests OUTPUT and MONEY, both of which are zero when the
   chain is broken:
     • real units out of `cardOutput()`
     • a card SHOP that actually printed
     • Cinder that reached the printer, the mill, the sawmill and the forest —
       "each company buys from the previous company using Cinder" is the claim,
       so lifetimeRevenue at every rung is the evidence
     • the closed-loop audit still clean with card production running (Rule 1)

   ⚠ ITS OWN CITY, ITS OWN NODE. The chain starts at `timber`, which is a
     DEPOSIT — a node without it founds no forestry camp and the test would be
     measuring the ground rather than the chain. So the node is chosen by
     asking `canBuild('timber')`, deterministically, and the search itself is
     asserted rather than assumed.
   ════════════════════════════════════════════════════════════════════════════ */
const CARDMAP={lumbercamp:{out:['timber'],ind:'forestry'},sawmill:{out:['lumber'],ind:'sawmill'},
 purifier:{out:['freshWater'],ind:'waterworks'},papermill:{out:['cardStock'],ind:'paperMill'},
 printworks:{out:['printedCards'],ind:'cardPrinter'},depot:{out:['packagingMaterial'],ind:'distributor'},
 shop:{out:['boosterPacks'],ind:'cardShop'},housing:{out:['constructionComponents'],ind:'landlord'},
 farm:{out:['wheat','corn','rice','potatoes','soybeans','vegetables'],ind:'farm'},
 grocery:{out:['bread'],ind:'grocer'}};

/* 🧨 THE SAME SWITCH round0j USES, so ONE variable proves both halves of this
   fix can fail: run.mjs round0j proves the STRUCTURE goes red, and this proves
   the LIVE CITY does. `holographicFoil: 0.02` is the shipped boosterPacks
   recipe; no city tile makes foil, and firms.js produce() takes the minimum
   over inputs, so restoring it takes the whole chain back to zero output. */
if(process.env.ECON_TEST_SABOTAGE==='dark-cards'){
  R.RECIPES.boosterPacks.in.holographicFoil=0.02;
  console.log('   🧨 restored `holographicFoil: 0.02` to boosterPacks — the card city must now print nothing');
}

let cardNode=null;
for(let i=0;i<300&&!cardNode;i++){ E.mount({nodeId:'ouro-'+i,population:200}); if(E.canBuild('timber')) cardNode='ouro-'+i; }
chk('found a node whose ground carries timber (the chain starts in the forest)', !!cardNode, String(cardNode));

if(cardNode){
  E.mount({nodeId:cardNode,population:300});
  const ct={}; let cn=0;
  const cbuild=(t,c)=>{for(let i=0;i<(c||1);i++)ct[(cn++)+',0']={type:t,lvl:1,damaged:false};};
  cbuild('lumbercamp',3);cbuild('sawmill',1);cbuild('purifier',2);cbuild('papermill',1);
  cbuild('printworks',1);cbuild('depot',1);cbuild('shop',1);cbuild('housing',30);
  cbuild('farm',2);cbuild('grocery',1);
  const clist=()=>Object.entries(ct).map(([k,t])=>{const m=CARDMAP[t.type];if(!m)return null;
    const o=E.pickAvailable(m.out); return o?{key:k,out:o,ind:m.ind,lvl:t.lvl}:null;}).filter(Boolean);
  const chost={powerFactor:1,waterFactor:1,logisticsCounts:{warehouse:3,depot:2},hasBank:true,
               infrastructure:0.8,population:300};
  E.syncBuildings(clist());
  /* The chain has five rungs and each one needs the rung below it to have
     stocked up first, so this is a LONG run on purpose — the first pack does
     not leave the shop until roughly day 4. */
  let peak=0, peakPacks=0, liveDays=0;
  const RUNGS=['timber','lumber','cardStock','printedCards','boosterPacks'];
  const supSum={}; for(const id of RUNGS) supSum[id]=0;
  for(let d=0;d<600;d++){
    E.syncBuildings(clist()); E.tick(20,chost);
    const c=E.cardOutput();
    if(c.totalUnits>0) liveDays++;
    if(c.totalUnits>peak) peak=c.totalUnits;
    const pk=(c.units.boosterPacks||0); if(pk>peakPacks) peakPacks=pk;
    /* Accumulated INSIDE the loop because sim.js zeroes S.observed at the top of
       every runDay — read it after the run and you get one arbitrary day. */
    const ob=Sim.state().observed||{};
    for(const id of RUNGS) supSum[id]+=((ob[id]||{}).supply)||0;
  }
  const co=E.cardOutput();
  const rev=(id)=>Firms.alive().filter(f=>f.out===id).reduce((a,f)=>a+(f.lifetimeRevenue||0),0);
  const made=(id)=>Firms.alive().filter(f=>f.out===id).reduce((a,f)=>a+(f.lastProduced||0),0);
  /* 🔴 TWO DIFFERENT NUMBERS, AND THE HEADLINE USED TO PRINT THE WRONG ONE.
     `f.lastProduced` is what a firm's LINE ran at — its capacity given inputs,
     labour and power. sim.js then TRIMS what actually reaches the market to the
     firm's share of demand, and it is the trimmed figure that lands in
     `S.observed[id].supply`, which is what cardOutput() feeds the Foundation
     Reserve. This line printed capacity and called it "/d": it read
     "boosterPacks 76/d" beside a cardOutput of 1.687 — off by ~45x — so the one
     summary line a reader actually reads overstated the card economy by a factor
     nobody could see. The assertions were always on observed supply and were
     never wrong; only the headline was.

     ⚠ AND IT IS A MEAN OVER 600 DAYS, NOT THE CLOSING DAY. The first repair here
       printed the last tick's observed supply and read
       `cardStock 0.00/d (cap 90) → printedCards 0.00/d (cap 86)` beside a
       cardOutput of 0.279 — true, and just as misleading the other way, because
       whether an intermediate rung sells on any ONE day depends on whether that
       day's demand trim happened to bite (the same reason the assertion below
       counts liveDays instead of the last day). Capacity is kept in brackets on
       purpose: the GAP between the two columns is the interesting quantity — it
       is how much of this chain is idle for want of buyers. */
  const rung=(id)=>id+' '+(supSum[id]/600).toFixed(2)+'/d (cap '+made(id).toFixed(0)+')';
  console.log('  chain@'+cardNode+' — mean OBSERVED supply/day over 600d, line capacity in brackets:');
  console.log('    '+RUNGS.map(rung).join(' → '));
  console.log('  cardOutput '+JSON.stringify(co));

  /* 🔴 MEASURED OVER THE WHOLE RUN, NOT ON THE LAST DAY. `cardOutput()` reads
     `S.observed[id].supply`, which sim.js zeroes at the top of every runDay —
     it is a ONE-DAY figure, which is exactly what the host's ecoDailyClose()
     pushes. Asserting on a single closing day would make this test depend on
     whether that particular day's demand trim happened to bite. `liveDays` is
     the honest measure: on how many of 600 days did this city report card
     product at all. Zero is what a broken chain scores, on every day. */
  chk('the card chain PRODUCES — cardOutput() reported product on most days',
      liveDays>300 && peak>0,
      'liveDays='+liveDays+'/600 peak='+peak.toFixed(2)+' lastDay='+co.totalUnits.toFixed(3));
  chk('a real card SHOP printed packs (not just the presses upstream)',
      made('boosterPacks')>0 && peakPacks>0,
      'shop/day='+made('boosterPacks').toFixed(2)+' peak packs reported='+peakPacks.toFixed(2));
  chk('the printer runs — printedCards is a real, made id now',
      made('printedCards')>0, 'printedCards/day='+made('printedCards').toFixed(2));
  /* 💸 THE CINDER WALKS BACK UP. Each rung is paid by the one above it
     (sim.js payUpstream), so a zero anywhere here means the chain is producing
     on paper while nobody is buying from anybody. */
  for(const [id,label] of [['printedCards','the print works'],['cardStock','the paper mill'],
                           ['lumber','the sawmill'],['timber','the forestry camp']])
    chk('Cinder reached '+label+' ('+id+')', rev(id)>0, id+' lifetimeRevenue='+rev(id).toFixed(2));

  chk('Rule 1 — the audit is still clean with card production running',
      !!(E.audit()&&E.audit().ok), JSON.stringify(E.audit()).slice(0,140));
}

console.log('\n=== GAUNTLET 3: '+(fails.length?fails.length+' FAILURES':'ALL PASS')+' ===');
if(fails.length) process.exitCode=1;
