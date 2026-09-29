(async () => {
  const nc=window.__nc,T=window.MythicTenants,Z=window.MythicZoning,D=window.MythicDemographics,
        E=window.MythicEconomy,G=nc.game,L=window.MythicLandValue;
  const K=(x,z)=>x+','+z,R={};
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};
  for (const r of ['rations','remedies','goods','water']) { try{G.stock[r]=900000;}catch(e){} }
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){ if(G.tiles[K(x,z)])continue;
    const m=(x+z)%3; await place(m===2?'foodtruck':'purifier',x,z); }
  const trace=[];
  for(let i=0;i<22;i++){ await nc.step(300,150); T._field().invalidate();
    const mn=T._field().field().maxNear; trace.push(mn); if(mn>0) break; }
  try{nc.eco.sync();}catch(e){} T._field().invalidate();
  R.growth={trace,pop:D.population(),maxNear:T._field().field().maxNear,day:E.snapshot().day};
  if (!(T._field().field().maxNear>0)) { R.ABORT='still silent'; return R; }

  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  /* ══ A. RESIDENTIAL — wants() refuses; does award()? ══ */
  const RES=free.slice(0,24);
  for (const p of RES) Z.applyPaint(p.x,p.z,'r_low',null);
  T._field().invalidate();
  R.wantsOnRes = RES.slice(0,2).map(p=>{const d=nc.districtAt(p.x,p.z);
    return {k:K(p.x,p.z),bag:d?d.afterLand:[],wants:T.wants(p.x,p.z,d?d.afterLand:[],'res'),
            awardWouldBid:(()=>{const e=nc.tenantBids(p.x,p.z,['housing']);
              return e&&e.ok?e.rows.map(r=>({size:r.cand.size,total:r.total,bids:r.bids})):null;})()};});
  await Z.develop({toggle:true});
  for (let i=0;i<150;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done(); try{nc.eco.sync();}catch(e){} T.observe(true);
  const lets=T._store().lets();
  const hk=Object.keys(lets).filter(k=>lets[k].want==='housing');
  R.residential={ zoned:RES.length, built:RES.filter(p=>G.tiles[K(p.x,p.z)]).length,
    HOUSING_TENANCIES:hk.length, allTenancies:T.stats().tenancies,
    sample:hk.slice(0,4).map(k=>({k,n:lets[k].n,size:lets[k].size,want:lets[k].want,bid:lets[k].bid,
      tileType:(G.tiles[k]||{}).type,tileLvl:(G.tiles[k]||{}).lvl,
      levelFor:T.levelFor(+k.split(',')[0],+k.split(',')[1]),
      firm:(()=>{const t=T.tenantAt(+k.split(',')[0],+k.split(',')[1]);return t&&t.firm?{lvl:t.firm.level,rung:t.firm.rung,out:t.firm.out}:null;})()})),
    overlayPainted:(()=>{T.overlay(true);return T.overlayPainted();})(),
    panelRows:(()=>{try{T.openPanel();const el=document.getElementById('ntn-panel');
      const m=el?el.innerHTML.match(/Housing/g):null;T.closePanel();return m?m.length:0;}catch(e){return 'err';}})(),
    verify:T.verify() };

  /* ══ B. COMMERCIAL — built lots with no tenancy ══ */
  const COM=free.slice(24);
  for (const p of COM) Z.applyPaint(p.x,p.z,'c_low',null);
  T._field().invalidate();
  await Z.develop({toggle:true});
  for (let i=0;i<220;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done(); try{nc.eco.sync();}catch(e){} T.observe(true);
  const l2=T._store().lets(), v2=T._store().vacs();
  const builtCom=COM.filter(p=>G.tiles[K(p.x,p.z)]);
  const orph=builtCom.filter(p=>!l2[K(p.x,p.z)]&&!v2[K(p.x,p.z)]);
  R.commercial={ zoned:COM.length, built:builtCom.length, tenanted:builtCom.length-orph.length,
    ORPHANED:orph.length, maxNearNow:T._field().field().maxNear,
    sample:orph.slice(0,4).map(p=>{const k=K(p.x,p.z);const e=nc.tenantBids(p.x,p.z,[G.tiles[k].type]);
      return {k,type:G.tiles[k].type,val:L.valueAt(p.x,p.z),
        rows:e&&e.ok?e.rows.map(r=>({size:r.cand.size,total:r.total})):null};}) };
  R.finalStats={tenancies:T.stats().tenancies,vacant:T.stats().vacant,lifetime:T.stats().lifetime,
                byRung:T.stats().byRung,bySize:T.stats().bySize};
  R.salt = T.stats().salt;
  return R;
})()
