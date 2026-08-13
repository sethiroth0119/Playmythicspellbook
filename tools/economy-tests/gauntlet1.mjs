const P='../../public/src/economy/';
global.window={MythicCityBridge:{addCinders:async()=>{}},MythicResourceChain:null};
const chain=await import('../../public/src/resources/chain.js');
global.window.MythicResourceChain={ALL:chain.RESOURCE_CHAIN};
const Sim=await import(P+'sim.js'), HH=await import(P+'households.js'), Firms=await import(P+'firms.js');
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
