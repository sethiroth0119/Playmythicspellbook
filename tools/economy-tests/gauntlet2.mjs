const P='../../public/src/economy/';
global.window={MythicCityBridge:{addCinders:async()=>{}},MythicResourceChain:null};
const chain=await import('../../public/src/resources/chain.js');
global.window.MythicResourceChain={ALL:chain.RESOURCE_CHAIN};
const Sim=await import(P+'sim.js'),HH=await import(P+'households.js'),Firms=await import(P+'firms.js'),
 Prices=await import(P+'prices.js'),Bank=await import(P+'bank.js'),Trade=await import(P+'trade.js'),
 Endow=await import(P+'endowment.js'),BN=await import(P+'bottleneck.js');
const {ECON}=await import(P+'tuning.js');
let fails=[];
const chk=(n,c,e)=>{if(!c){fails.push(n);console.log('❌ '+n+(e?' :: '+e:''));}else console.log('✅ '+n);};
// deterministic PRNG so a failure is reproducible
let seed=12345; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};

// 1. PROPERTY TEST: conservation under randomized hosts, 40 cities x 120 days
let worstErr=0, worstCity='';
for(let c=0;c<40;c++){
  Sim.reset('prop-'+c); HH.setPopulation(20+Math.floor(rnd()*300)); Sim.bootstrap();
  for(let d=0;d<120;d++){
    HH.setPopulation(Math.max(0,20+Math.floor(rnd()*400)));
    const host={powerFactor:rnd(),waterFactor:rnd(),
      logisticsCounts:{warehouse:Math.floor(rnd()*5),depot:Math.floor(rnd()*4),terminal:rnd()<0.3?1:0},
      hasBank:rnd()<0.4,infrastructure:rnd(),shock:rnd()<0.05?(0.5+rnd()*2):1};
    Sim.advance(1+rnd()*60,host);
    const a=Sim.state().lastAudit;
    if(a&&!a.ok){const e=Math.abs(a.err);if(e>worstErr){worstErr=e;worstCity='prop-'+c+' d'+d;}}
  }
}
chk('conservation under 40 randomized cities x 120 days', worstErr===0, 'worst err '+worstErr+' at '+worstCity);

// 2. SAVE/LOAD DETERMINISM
Sim.reset('det'); HH.setPopulation(120); Sim.bootstrap();
const host={powerFactor:1,waterFactor:1,logisticsCounts:{warehouse:3},hasBank:true,infrastructure:0.7};
for(let i=0;i<25;i++) Sim.advance(20,host);
const blob=JSON.parse(JSON.stringify(Sim.serialize()));
const blobTotal=Sim.totalCinder();
for(let i=0;i<15;i++) Sim.advance(20,host);
const direct=Sim.snapshot();
Sim.load(JSON.parse(JSON.stringify(blob)));
for(let i=0;i<15;i++) Sim.advance(20,host);
const viaSave=Sim.snapshot();
chk('save/load determinism: firms', direct.firms===viaSave.firms, direct.firms+' vs '+viaSave.firms);
/* 🔴 COMPLETENESS is tested at ZERO ticks after the load: if any state variable
   is missing from the blob, the reloaded city differs IMMEDIATELY. That is the
   assertion that actually catches a forgotten field (it caught demandEMA, the
   distress throttle and the loan link).
   Drift AFTER ticking is a different question and must NOT be asserted tightly:
   the model is nonlinear (min/max clamps, elasticity, integer headcount), so
   the float rounding in persistence gets amplified chaotically. What matters is
   that it stays BOUNDED rather than diverging.
   ⚠ Never assert on treasury as a PERCENTAGE — municipal spending drains it to
     near zero every day, so a 2 🔥 difference reads as 50% and means nothing. */
Sim.load(JSON.parse(JSON.stringify(blob)));
const instant = Sim.snapshot();
chk('save/load completeness (0 ticks: nothing missing from the blob)',
  Math.abs(instant.totalCinder - blobTotal) < Math.max(1, Math.abs(blobTotal) * 1e-5),
  blobTotal.toFixed(3)+' vs '+instant.totalCinder.toFixed(3));
const driftPct = Math.abs(direct.totalCinder - viaSave.totalCinder) / Math.max(1, Math.abs(direct.totalCinder)) * 100;
chk('save/load drift stays bounded after 15 days', driftPct < 1.0, driftPct.toFixed(3)+'%');

// 3. PRICE BOUNDS never escape the clamp
Sim.reset('pb'); HH.setPopulation(150); Sim.bootstrap();
for(let i=0;i<100;i++) Sim.advance(20,{...host,shock:i%7===0?3.5:1});
let bad=[]; for(const m of Prices.movers()){ if(m.mul<ECON.price.minMul-1e-9||m.mul>ECON.price.maxMul+1e-9) bad.push(m.id+'='+m.mul); if(!isFinite(m.price)||m.price<0) bad.push(m.id+' price '+m.price); }
chk('price multipliers stay inside clamp', bad.length===0, bad.slice(0,4).join(','));

// 4. BANK: no infinite credit, loans bounded by reserve
Sim.reset('bk'); HH.setPopulation(200); Sim.bootstrap();
for(let i=0;i<120;i++) Sim.advance(20,{...host,hasBank:true});
const br=Bank.report();
chk('bank reserve never negative', br.reserve>=-1e-9, String(br.reserve));
chk('bank owed is finite', isFinite(br.owed)&&br.owed>=0, String(br.owed));

// 5. ENDOWMENT DETERMINISM across resets
const g1=Endow.strengths('same-node').join(','); Endow.invalidate();
Sim.reset('other'); const g2=Endow.strengths('same-node').join(',');
chk('endowment deterministic across resets', g1===g2);
chk('endowment: canExtract stable', Endow.canExtract('same-node','ironOre')===Endow.canExtract('same-node','ironOre'));

// 6. BOTTLENECK never throws, always actionable
Sim.reset('bn'); HH.setPopulation(180); Sim.bootstrap();
let threw='';
for(let i=0;i<60;i++){ Sim.advance(20,host);
  try{ BN.cityReport(); const p=BN.primary(); if(p){ if(!p.cause||!p.fix===undefined) threw='primary missing cause'; }
    for(const f of Firms.alive()){ const d=BN.diagnose(f); if(!d) threw='diagnose null'; BN.trace(f.out); } BN.structuralGaps();
  }catch(e){threw=e.message;break;} }
chk('bottleneck never throws over 60 days', !threw, threw);

// 7. FIRM LEVELS cannot skip
Sim.reset('lv'); HH.setPopulation(250); Sim.bootstrap();
let skipped=false, seenLv={};
for(let i=0;i<150;i++){ Sim.advance(20,host); for(const f of Firms.alive()){ const prev=seenLv[f.id]; if(prev!=null&&f.level>prev+1) skipped=true; seenLv[f.id]=f.level; } }
chk('firm levels never skip a rung', !skipped);
const overmax=Firms.all().filter(f=>f.level>ECON.firm.levels.length||f.level<1);
chk('firm level within 1..5', overmax.length===0, overmax.map(f=>f.out+':'+f.level).join(','));

// 8. TRADE: exports cannot exceed the faucet ceiling
Sim.reset('tr'); HH.setPopulation(300); Sim.bootstrap();
let maxFaucet=0;
for(let i=0;i<80;i++){ Sim.advance(20,host); maxFaucet=Math.max(maxFaucet,Sim.state().flow.faucet); }
chk('faucet respects ceiling', maxFaucet<=ECON.faucet.maxPerMin*ECON.clock.dayMin+1e-6, maxFaucet+' vs cap '+(ECON.faucet.maxPerMin*ECON.clock.dayMin));

// 9. PAYOUT never exceeds municipal surplus
Sim.reset('po'); HH.setPopulation(200); Sim.bootstrap();
let viol=0;
for(let i=0;i<100;i++){ Sim.advance(20,host); const f=Sim.state().flow;
  const surplus=Math.max(0,(f.tax+f.faucet)-(f.benefits+f.imports+f.freight));
  if(f.payout>surplus*ECON.tax.payoutRate+1e-6) viol++; }
chk('payout never exceeds its share of surplus', viol===0, viol+' violations');

console.log('\n=== GAUNTLET 2: '+(fails.length?fails.length+' FAILURES':'ALL PASS')+' ===');
if(fails.length) process.exitCode=1;
