const P='../../public/src/economy/';
global.window={MythicCityBridge:{addCinders:async()=>{}},MythicResourceChain:null};
const chain=await import('../../public/src/resources/chain.js');
global.window.MythicResourceChain={ALL:chain.RESOURCE_CHAIN};
const Sim=await import(P+'sim.js'), HH=await import(P+'households.js'), Firms=await import(P+'firms.js');
const Bank=await import(P+'bank.js');
const {ECON}=await import(P+'tuning.js');
let fails=[];
const chk=(name,cond,extra)=>{ if(!cond){fails.push(name+(extra?' :: '+extra:''));console.log('❌ '+name+(extra?' :: '+extra:''));} else console.log('✅ '+name); };
const finite=(o,path='')=>{ // deep NaN/Infinity hunt
  if(typeof o==='number') return isFinite(o)?null:path;
  if(o&&typeof o==='object'){for(const k in o){const r=finite(o[k],path+'.'+k); if(r)return r;}}
  return null;
};
const host={powerFactor:1,waterFactor:1,logisticsCounts:{warehouse:2},hasBank:false,infrastructure:0.6};

// 1. ZERO POPULATION
Sim.reset('g1'); HH.setPopulation(0); Sim.bootstrap();
for(let i=0;i<30;i++) Sim.advance(20,host);
chk('zero population: no crash, audit ok', Sim.state().lastAudit && Sim.state().lastAudit.ok, JSON.stringify(Sim.state().lastAudit&&Sim.state().lastAudit.err));
chk('zero population: no NaN in snapshot', !finite(Sim.snapshot()), finite(Sim.snapshot()));

// 2. POPULATION CRASH (city wiped)
Sim.reset('g2'); HH.setPopulation(500); Sim.bootstrap();
for(let i=0;i<20;i++) Sim.advance(20,host);
HH.setPopulation(0);
for(let i=0;i<20;i++) Sim.advance(20,host);
chk('population crash to 0: audit ok', Sim.state().lastAudit.ok, 'err='+Sim.state().lastAudit.err);
chk('population crash: savings not negative', HH.totalSavings()>=-1e-9, String(HH.totalSavings()));

// 3. HUGE dt (offline for a year)
Sim.reset('g3'); HH.setPopulation(80); Sim.bootstrap();
Sim.advance(20*60*24*365, host);
chk('one-year dt: audit ok', Sim.state().lastAudit.ok, 'err='+Sim.state().lastAudit.err);
chk('one-year dt: capped days', Sim.state().day<=ECON.clock.maxCatchUpDays+1, 'day='+Sim.state().day);

// 4. NEGATIVE / NaN dt
Sim.reset('g4'); HH.setPopulation(80); Sim.bootstrap();
const before=Sim.totalCinder();
Sim.advance(-500,host); Sim.advance(NaN,host); Sim.advance(Infinity,host); Sim.advance(undefined,host);
chk('hostile dt: total unchanged', Math.abs(Sim.totalCinder()-before)<1e-6, before+' → '+Sim.totalCinder());
chk('hostile dt: no NaN', !finite(Sim.snapshot()), finite(Sim.snapshot()));

// 5. HOSTILE HOST OBJECT
Sim.reset('g5'); HH.setPopulation(80); Sim.bootstrap();
const bad={powerFactor:NaN,waterFactor:-5,logisticsCounts:{warehouse:NaN,bogus:9},hasBank:'yes',infrastructure:Infinity};
for(let i=0;i<15;i++) Sim.advance(20,bad);
chk('hostile host: audit ok', Sim.state().lastAudit.ok, 'err='+Sim.state().lastAudit.err);
chk('hostile host: no NaN', !finite(Sim.snapshot()), finite(Sim.snapshot()));

// 6. NO HOST AT ALL
Sim.reset('g6'); HH.setPopulation(50); Sim.bootstrap();
for(let i=0;i<10;i++) Sim.advance(20,undefined);
chk('no host object: audit ok', Sim.state().lastAudit.ok);

// 7. CORRUPT SAVES
const corrupts=[null,undefined,{},{v:99},'string',[1,2,3],{firms:{firms:'nope'}},{inv:{fakeResource:5,bread:'x',steel:-9}},{treasury:-1e9,day:-5,households:{pop:{low:'x'}}},{firms:{firms:[{out:'notARealResource',cash:1e9},{},null]}}];
let ok=true,which='';
for(const c of corrupts){ try{ Sim.load(c); Sim.advance(20,host); const f=finite(Sim.snapshot()); if(f){ok=false;which=JSON.stringify(c)+' NaN@'+f;break;} }catch(e){ok=false;which=JSON.stringify(c)+' threw '+e.message;break;} }
chk('corrupt saves survive load+tick', ok, which);

/* 7b. 🔴 A SAVE ROUND-TRIPS EXACTLY — AND THE RESIDUAL IS PRINTED, NOT HIDDEN.
   ----------------------------------------------------------------------------
   This used to be a doctored-save sweep asserting that sim.js's load-time Cinder
   clamp bounded what a forged save was WORTH (`totalCinder() + payoutOwed`).
   THAT CLAMP HAS BEEN REMOVED. sim.js documents the three measured reasons above
   `audit()`; the short version is that every rail in it was derived from the
   save's own `day` count, so a four-field edit was worth ≈7,500 gems per real
   hour of real Profile.gems while the gate certified the forgery as PASSING —
   and the identity it enforced is false for the duration of every payout RPC,
   which is exactly the window node-city writes its save in.

   🔴 SO SAY WHAT IS TRUE INSTEAD, OUT LOUD, EVERY RUN. A doctored save CAN still
   inflate this city's money. That is the same tier of exposure as the console
   this client-authoritative app already has — `payCost` is client-side and a
   devtools user reaches `addGems` directly — and the real fix is server-side
   authority, not another clamp. This section prints the residual so that nobody
   reads a green gauntlet as a claim that the save file is trusted.

   WHAT IS ASSERTED HERE IS THE THING THAT PROTECTS THE PLAYER: an honest save
   round-trips EXACTLY (a loader that "fixes" balances is how confiscation
   ships), and a claim that was in flight when the page died comes back owed
   rather than vanishing. */
Sim.reset('g7b'); HH.setPopulation(120); Sim.bootstrap();
for(let i=0;i<40;i++) Sim.advance(20,host);
const honestBlob=JSON.parse(JSON.stringify(Sim.serialize()));
const worthOf=()=>Sim.totalCinder()+Sim.state().payoutOwed+Sim.state().payoutInFlight;
const honestTotal=worthOf();
Sim.load(JSON.parse(JSON.stringify(honestBlob)));
chk('an honest save round-trips with every Cinder intact',
    Math.abs(worthOf()-honestTotal)<0.05, honestTotal+' → '+worthOf());
/* THE DOCUMENTED RESIDUAL, measured and printed rather than asserted away. */
{
  const s=JSON.parse(JSON.stringify(honestBlob)); s.treasury=1e9;
  Sim.load(s);
  console.log('   ⚠ RESIDUAL (documented, not a regression): a doctored `treasury` loads at '+
              worthOf().toFixed(2)+' 🔥 against an honest '+honestTotal.toFixed(2)+
              ' 🔥. The save file is NOT trusted and is not claimed to be — see the header '+
              'above sim.js audit(). The fix is server-side authority, not a load-time clamp.');
  Sim.load(JSON.parse(JSON.stringify(honestBlob)));
}
/* 7c. THE CLAIM THAT WAS IN FLIGHT WHEN THE PAGE DIED. `claimPayout()` moves the
   money onto `payoutInFlight`; if no `.then`/`.catch` ever runs (the tab is
   gone), the save is the only thing that can remember it. run.mjs round 0s §2b
   owns the driven version through the production call; this is the unit shape,
   here so a reader of gauntlet1 sees the whole payout ledger in one place. */
Sim.reset('g7c'); HH.setPopulation(200); Sim.bootstrap();
for(let i=0;i<60;i++) Sim.advance(20,host);
Sim.state().payoutOwed+=25;                       // a day's draw, standing on the books
const claimed=Sim.claimPayout();                  // handed to the bridge…
const blobMid=JSON.parse(JSON.stringify(Sim.serialize()));   // …and the page dies here
Sim.load(blobMid);
chk('a claim in flight when the page died is serialized and comes back OWED',
    claimed>0 && Math.abs(Sim.state().payoutOwed-(blobMid.payoutOwed+claimed))<0.05,
    'claimed '+claimed+', saved owed '+blobMid.payoutOwed+'/inFlight '+blobMid.payoutInFlight+
    ', reloaded owed '+Sim.state().payoutOwed);
chk('…and it is not counted twice — payoutInFlight is settled by the load',
    Sim.state().payoutInFlight<1e-9, String(Sim.state().payoutInFlight));

// 8. NODE SWITCH MID-RUN
Sim.reset('g8'); HH.setPopulation(60); Sim.bootstrap();
for(let i=0;i<10;i++) Sim.advance(20,host);
Sim.setNode('totally-different-node');
for(let i=0;i<10;i++) Sim.advance(20,host);
chk('node switch mid-run: audit ok', Sim.state().lastAudit.ok, 'err='+Sim.state().lastAudit.err);

// 9. NEGATIVE CASH NEVER
Sim.reset('g9'); HH.setPopulation(200); Sim.bootstrap();
for(let i=0;i<80;i++) Sim.advance(20,host);
const neg=Firms.all().filter(f=>f.cash< -1e-9);
chk('no firm has negative cash', neg.length===0, neg.map(f=>f.out+':'+f.cash).join(','));
const negInv=Object.entries(Sim.inventory()).filter(([k,v])=>v< -1e-9);
chk('no negative inventory', negInv.length===0, JSON.stringify(negInv.slice(0,3)));

console.log('\n=== GAUNTLET 1: '+(fails.length?fails.length+' FAILURES':'ALL PASS')+' ===');
if(fails.length) process.exitCode=1;
