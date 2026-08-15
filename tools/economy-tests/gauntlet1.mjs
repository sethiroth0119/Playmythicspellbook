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

/* 7b. 🔴 …AND THE BALANCE MUST NOT MOVE. THE ROUND ABOVE ONLY EVER ASKED
   "no NaN, no throw", AND THAT IS HOW THE SAVE FILE MINTED FOR THE WHOLE LIFE
   OF THE FEATURE.
   ----------------------------------------------------------------------------
   `totalCinder()` has five terms and four of them arrived from disk through
   `Math.max(0, Number(x) || 0)` — NaN safety with no bound on magnitude at all,
   in four different files. Measured on the pre-fix tree from an honest 40-day
   city holding 298,394 🔥, each of these was ONE edited number in a JSON file:

     treasury                → 1,000,298,330  (+999,999,936)
     bank.reserve            → 1,000,298,394  (+1,000,000,000)
     households.savings.low  → 1,000,296,764  (+999,998,370)
     firms.firms[0].cash     → 1,000,296,815  (+999,998,421)
     charter (already clamped, and still leaking) → 375,292  (+76,898)

   Every one then passed the closed-loop audit for the rest of the city's life,
   because `load()` runs outside `runDay`'s window and `sim.js audit()` only ever
   asks whether the DAY balanced. The corrupt-save round above ran two lines up
   from this and could not see any of it: it fed garbage in and asked whether
   the process was still alive.

   sim.js `clampLoadedCinder()` now bounds the whole total by the only two ways
   Cinder is ever created — `charterIssued + faucetLifetime`. So the assertion
   here is the structural one: a doctored save may not lift what the save is
   WORTH above what this city could honestly hold. The residual is what the city
   has SPENT over its life (imports + payout), which no tally on disk records; it
   is reported rather than hidden.

   🔴 WORTH, NOT `totalCinder()` — AND THAT DISTINCTION IS THE WHOLE OF ROUND 2.
      `totalCinder()` is the five accounts that stay INSIDE the simulation.
      `payoutOwed` is the ONE field that leaves it, through the bridge, into
      `Profile.gems`. It is deliberately not a term of the total (the money left
      the city's books on the day it was drawn), so `clampLoadedCinder()` never
      looked at it and neither did this round. On a tree where all five clamps
      above were present and working, doctoring that single field and nothing
      else took an honest 298,251 🔥 city to 1,000,000,022 🔥 DELIVERED TO THE
      PLAYER on the very next tick, with `totalCinder()` unmoved and
      `lastAudit.ok === true`. The quantity under test is therefore
      `totalCinder() + payoutOwed`.

   Prove this can fail: ECON_TEST_SABOTAGE=save-mint re-commits the unclamped
   assignment for the five balance terms, and ECON_TEST_SABOTAGE=payout-save
   re-commits it for `payoutOwed`. */
const SABOTAGE=process.env.ECON_TEST_SABOTAGE||'';
Sim.reset('g7b'); HH.setPopulation(120); Sim.bootstrap();
for(let i=0;i<40;i++) Sim.advance(20,host);
const honestBlob=JSON.parse(JSON.stringify(Sim.serialize()));
Sim.load(JSON.parse(JSON.stringify(honestBlob)));
const worthOf=()=>Sim.totalCinder()+Sim.state().payoutOwed;
const honestTotal=worthOf();
const doctors=[
  ['treasury',              s=>{s.treasury=1e9;}],
  ['bank.reserve',          s=>{s.bank.reserve=1e9;}],
  ['households.savings.low',s=>{s.households.savings.low=1e9;}],
  ['firms.firms[0].cash',   s=>{if(s.firms.firms[0])s.firms.firms[0].cash=1e9;}],
  ['charter',               s=>{s.charter=1e9;}],
  /* 🔴 THE ONE THAT CROSSES THE BRIDGE. Invisible to `totalCinder()` and so
     invisible to every assertion this round used to make. */
  ['payoutOwed',            s=>{s.payoutOwed=1e9;}],
  /* 🔴 THE INTERNALLY-CONSISTENT FORGERY: `day`, the faucet tally and a balance
     moved TOGETHER, so the ceiling's own inputs rise with the balance they are
     supposed to bound. run.mjs round 0s §2 owns the detailed bound on this; it
     is here so a reader of gauntlet1 sees the whole doctor set in one place. */
  ['day + faucetLifetime + treasury + payoutOwed',
                            s=>{s.day=2e9;s.faucetLifetime=1e9;s.treasury=1e9;s.payoutOwed=1e9;}, true],
];
let overCeiling=0,worstGain=0,worstName='',worstLever=0;
console.log('   honest worth (totalCinder + payoutOwed) '+honestTotal.toFixed(2)+':');
for(const [name,mut,lever] of doctors){
  const s=JSON.parse(JSON.stringify(honestBlob));
  mut(s);
  Sim.load(s);
  if(SABOTAGE==='save-mint'){
    /* 🧨 THE SHIPPED LOADER, re-committed for exactly these fields: the raw
       value straight into state with no ceiling, which is verbatim what
       `S.treasury = Math.max(0, Number(raw.treasury) || 0)` and its three
       siblings in households.js / firms.js / bank.js did. */
    if(name==='treasury') Sim.state().treasury=Math.max(0,Number(s.treasury)||0);
    if(name==='charter')  Sim.state().charter =Math.max(0,Number(s.charter)||0);
    if(name==='bank.reserve') Bank.state().reserve=Math.max(0,Number(s.bank.reserve)||0);
    if(name==='households.savings.low') HH.state().savings.low=Math.max(0,Number(s.households.savings.low)||0);
    if(name==='firms.firms[0].cash'){ const f=Firms.all()[0]; if(f) f.cash=Math.max(0,Number(s.firms.firms[0].cash)||0); }
  }
  if(SABOTAGE==='payout-save'){
    /* 🧨 sim.js's shipped `S.payoutOwed = Math.max(0, Number(raw.payoutOwed) ||
       0)` — NaN safety, no ceiling. One edited field, a billion Cinder through
       the bridge on the next tick. */
    Sim.state().payoutOwed=Math.max(0,Number(s.payoutOwed)||0);
  }
  const tot=worthOf(), ceil=Sim.loadedCinderCeiling().ceiling, gain=tot-honestTotal;
  if(tot>ceil+1e-6) overCeiling++;
  if(lever) worstLever=Math.max(worstLever,gain);
  else if(gain>worstGain){worstGain=gain;worstName=name;}
  console.log('     '+name.padEnd(40)+' → worth '+tot.toFixed(2).padStart(16)+
              '   gain '+gain.toFixed(2).padStart(16)+'   ceiling '+ceil.toFixed(2)+
              (lever?'   ← edits the ceiling itself':''));
}
chk('a doctored save is not WORTH more than the honest ceiling', overCeiling===0,
    overCeiling+' of '+doctors.length+' doctored fields loaded ABOVE the ceiling — the save file mints');
/* The second half, and it is the one that makes the first half mean something:
   a bound the forgery never approaches proves nothing. 1e9 must come back as a
   rounding error against the honest balance, not as a fortune.
   ⚠ THE `day + faucetLifetime` ROW IS SCORED SEPARATELY, and deliberately so.
     It moves the ceiling's own inputs, so it legitimately buys headroom — an
     old city may honestly be rich and nothing on disk can prove otherwise. It
     is bounded instead by the pinned literal in run.mjs round 0s §2, which is
     the one number no save can move. Averaging it in here would hide both. */
console.log('   ⚠ the ceiling-lever row is worth '+worstLever.toFixed(2)+
            ' 🔥 above honest — bounded by run.mjs round 0s §2\'s pinned ceiling-of-ceilings, not by this line');
chk('…and the mint is reduced from 1e9 to under 1% of the honest balance',
    worstGain < honestTotal*0.01,
    'worst gain '+worstGain.toFixed(2)+' 🔥 on `'+worstName+'` against an honest '+honestTotal.toFixed(2));
Sim.load(JSON.parse(JSON.stringify(honestBlob)));
chk('…and an HONEST save is not touched by the clamp',
    Math.abs(worthOf()-honestTotal)<0.05, honestTotal+' → '+worthOf());

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
