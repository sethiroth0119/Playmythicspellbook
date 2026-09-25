(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        L = window.MythicLandValue, D = window.MythicDemographics, E = window.MythicEconomy,
        P = window.MythicProgress, G = nc.game;
  const K=(x,z)=>x+','+z, R={};
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};

  R.before = { demogPop: D.population(), maxNear: T._field().field().maxNear,
               housing: Object.values(G.tiles).filter(t=>t.type==='housing').length };

  // grow the city the way the builder's driver does
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r]=900000; } catch(e){} }
  let svc=0;
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){
    if (G.tiles[K(x,z)]) continue;
    const m=(x+z)%3; if (await place(m===2?'foodtruck':'purifier',x,z)) svc++;
  }
  const grow=[];
  for (let i=0;i<6;i++){ const s=await nc.step(300,150); grow.push(s.pop); if(i>1&&grow[i]===grow[i-1]) break; }
  try{nc.eco.sync();}catch(e){} try{T.observe(true);}catch(e){}
  T._field().invalidate();
  R.grown = { svc, popTrace:grow, demogPop:D.population(), maxNear:T._field().field().maxNear,
              econDay: E.snapshot().day };

  // zone every vacant road-fronting tile plain commercial
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low',null);
  T._field().invalidate();
  R.zoned = free.length;

  const planStr=()=>{const pl=Z.plan(null);
    return {str:pl.out.slice().sort((a,b)=>(a.x-b.x)||(a.z-b.z)).map(o=>K(o.x,o.z)+':'+o.type).join(' '),
            n:pl.out.length, skip:JSON.parse(JSON.stringify(pl.skip))};};
  const A=planStr();
  const hash={}; for(const p of free){const d=nc.districtAt(p.x,p.z); if(d) hash[K(p.x,p.z)]=d.wouldBuild;}
  const saved=window.MythicTenants; window.MythicTenants=null;
  const B=planStr(); window.MythicTenants=saved;
  const aM={},bM={};
  for(const s of A.str.split(' ')){if(!s)continue;const i=s.lastIndexOf(':');aM[s.slice(0,i)]=s.slice(i+1);}
  for(const s of B.str.split(' ')){if(!s)continue;const i=s.lastIndexOf(':');bM[s.slice(0,i)]=s.slice(i+1);}
  let hm=0,miss=[]; for(const k in bM){ if(bM[k]===hash[k])hm++; else miss.push(k+' '+bM[k]+'/'+hash[k]); }
  const moved=[],lost=[];
  for(const k in bM){ if(!(k in aM)) lost.push(k); else if(aM[k]!==bM[k]) moved.push(k+' '+bM[k]+'→'+aM[k]); }
  R.AB = { withMarket:A.n, withoutMarket:B.n, skipWith:A.skip, skipWithout:B.skip,
           identical:A.str===B.str, hashProof:{n:Object.keys(bM).length,match:hm,miss:miss.slice(0,5)},
           changedType:moved.length, refusedByMarket:lost.length,
           sampleChanged:moved.slice(0,12), sampleRefused:lost.slice(0,8) };

  // the bid table on a handful of real lots — every bidder, the spread
  const pick = free.slice(0,120);
  const tbl = pick.map(p=>{ const d=nc.districtAt(p.x,p.z); const bag=d?d.afterLand:[];
    const e=nc.tenantBids(p.x,p.z,bag); const w=T.winner(p.x,p.z,bag);
    if(!e||!e.ok) return {k:K(p.x,p.z),ok:false};
    const tot=e.rows.map(r=>r.total);
    return {k:K(p.x,p.z), val:L.valueAt(p.x,p.z), band:L.bandAt(p.x,p.z).id, bag,
            rows:e.rows.length, bidders:e.rows.filter(r=>r.bids).length,
            spread:+(Math.max(...tot)-Math.min(...tot)).toFixed(2),
            win: w?{t:w.type,size:w.cand.size.id,name:w.cand.name,total:+w.total.toFixed(2)}:null,
            hash: d?d.wouldBuild:null }; });
  R.lots = { n:tbl.length,
    withWinner: tbl.filter(t=>t.win).length,
    noWinner: tbl.filter(t=>t.ok!==false&&!t.win).length,
    winnerSizes: tbl.reduce((a,t)=>{if(t.win)a[t.win.size]=(a[t.win.size]||0)+1;return a;},{}),
    winnerTypesVsHash: { same: tbl.filter(t=>t.win&&t.win.t===t.hash).length,
                         differ: tbl.filter(t=>t.win&&t.win.t!==t.hash).length },
    distinctWinnerNames: [...new Set(tbl.filter(t=>t.win).map(t=>t.win.name))].length,
    meanSpread: +(tbl.reduce((a,t)=>a+(t.spread||0),0)/Math.max(1,tbl.length)).toFixed(2),
    sample: tbl.slice(0,8) };
  // one full bid table printed
  const one = pick[0]; const d1=nc.districtAt(one.x,one.z);
  const e1=nc.tenantBids(one.x,one.z,d1?d1.afterLand:[]);
  R.fullTable = e1&&e1.ok ? { k:e1.k, reserve:e1.reserve, pool:e1.pool,
      rows:e1.rows.map(r=>({n:r.cand.name,size:r.cand.size,type:r.type,total:r.total,bids:r.bids,
        terms:Object.fromEntries(r.terms.map(t=>[t.key,t.v]))})) } : e1;
  for (const p of free) Z.setZone(p.x,p.z,null);
  return R;
})()
