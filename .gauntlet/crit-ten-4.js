(async () => {
  const nc=window.__nc,T=window.MythicTenants,Z=window.MythicZoning,D=window.MythicDemographics,
        E=window.MythicEconomy,G=nc.game,L=window.MythicLandValue;
  const K=(x,z)=>x+','+z,R={};
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};
  for (const r of ['rations','remedies','goods','water']) { try{G.stock[r]=900000;}catch(e){} }
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){ if(G.tiles[K(x,z)])continue;
    const m=(x+z)%3; await place(m===2?'foodtruck':'purifier',x,z); }
  for(let i=0;i<7;i++){ await nc.step(300,150); }
  try{nc.eco.sync();}catch(e){}
  T._field().invalidate();
  R.city={ demogPop:D.population(), maxNear:T._field().field().maxNear,
           maxVal:T._field().field().maxVal, econDay:E.snapshot().day, radius:T.radius() };

  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low',null);
  T._field().invalidate();
  R.zoned=free.length;

  const planStr=()=>{const pl=Z.plan(null);
    return {str:pl.out.slice().sort((a,b)=>(a.x-b.x)||(a.z-b.z)).map(o=>K(o.x,o.z)+':'+o.type).join(' '),
            n:pl.out.length,skip:JSON.parse(JSON.stringify(pl.skip))};};
  const A=planStr();
  const hash={}; for(const p of free){const d=nc.districtAt(p.x,p.z); if(d) hash[K(p.x,p.z)]=d.wouldBuild;}
  const saved=window.MythicTenants; window.MythicTenants=null;
  const B=planStr(); window.MythicTenants=saved; const C=planStr();
  const M=(s)=>{const o={};for(const t of s.split(' ')){if(!t)continue;const i=t.lastIndexOf(':');o[t.slice(0,i)]=t.slice(i+1);}return o;};
  const aM=M(A.str),bM=M(B.str);
  let hm=0,miss=[];for(const k in bM){if(bM[k]===hash[k])hm++;else miss.push(k+' '+bM[k]+'/'+hash[k]);}
  const moved=[],lost=[];
  for(const k in bM){if(!(k in aM))lost.push(k);else if(aM[k]!==bM[k])moved.push(k+' '+bM[k]+'→'+aM[k]);}
  R.AB={withMarket:A.n,withoutMarket:B.n,restoredSameAsA:C.str===A.str,
        skipWith:A.skip,skipWithout:B.skip,identical:A.str===B.str,
        hashProof:{n:Object.keys(bM).length,matchesHash:hm,miss:miss.slice(0,5)},
        changedType:moved.length,refusedByMarket:lost.length,
        sampleChanged:moved.slice(0,14),sampleRefused:lost.slice(0,8)};
  R.refusalSentence = lost.length ? T.refusal(+lost[0].split(',')[0],+lost[0].split(',')[1]) : null;

  const tbl=free.map(p=>{const d=nc.districtAt(p.x,p.z);const bag=d?d.afterLand:[];
    const e=nc.tenantBids(p.x,p.z,bag);const w=T.winner(p.x,p.z,bag);
    if(!e||!e.ok)return{k:K(p.x,p.z),ok:false,why:e&&e.why};
    const tots=e.rows.map(r=>r.total);
    return{k:K(p.x,p.z),val:L.valueAt(p.x,p.z),band:L.bandAt(p.x,p.z).id,bagN:bag.length,
      rows:e.rows.length,signing:e.rows.filter(r=>r.bids).length,
      hi:Math.max(...tots),lo:Math.min(...tots),spread:+(Math.max(...tots)-Math.min(...tots)).toFixed(2),
      win:w?{t:w.type,size:w.cand.size.id,name:w.cand.name,total:+w.total.toFixed(2)}:null,
      hash:d?d.wouldBuild:null};});
  const won=tbl.filter(t=>t.win);
  R.market={ lots:tbl.length, withWinner:won.length, noWinner:tbl.filter(t=>t.ok!==false&&!t.win).length,
    rowsPerLot:[...new Set(tbl.map(t=>t.rows))],
    signingPerLot:tbl.reduce((a,t)=>{a[t.signing]=(a[t.signing]||0)+1;return a;},{}),
    winnerSizes:won.reduce((a,t)=>{a[t.win.size]=(a[t.win.size]||0)+1;return a;},{}),
    winnerTypes:won.reduce((a,t)=>{a[t.win.t]=(a[t.win.t]||0)+1;return a;},{}),
    hashTypes:tbl.reduce((a,t)=>{a[t.hash]=(a[t.hash]||0)+1;return a;},{}),
    sameAsHash:won.filter(t=>t.win.t===t.hash).length,
    distinctWinnerNames:[...new Set(won.map(t=>t.win.name))].length,
    winnerNamesSample:[...new Set(won.map(t=>t.win.name))].slice(0,10),
    meanSpread:+(won.reduce((a,t)=>a+t.spread,0)/Math.max(1,won.length)).toFixed(2),
    zeroSpread:won.filter(t=>t.spread===0).length,
    richest:won.slice().sort((a,b)=>b.val-a.val).slice(0,5).map(t=>({k:t.k,val:t.val,band:t.band,win:t.win,spread:t.spread})),
    poorest:won.slice().sort((a,b)=>a.val-b.val).slice(0,5).map(t=>({k:t.k,val:t.val,band:t.band,win:t.win,spread:t.spread})) };
  const one=free[0],d1=nc.districtAt(one.x,one.z),e1=nc.tenantBids(one.x,one.z,d1?d1.afterLand:[]);
  R.fullTable=e1&&e1.ok?{k:e1.k,reserve:e1.reserve,pool:e1.pool,
     rows:e1.rows.map(r=>({n:r.cand.name,size:r.cand.size,type:r.type,total:r.total,bids:r.bids,
        terms:Object.fromEntries(r.terms.map(t=>[t.key,t.v]))}))}:e1;
  R.poolStats = T.stats().pool;
  return R;
})()
