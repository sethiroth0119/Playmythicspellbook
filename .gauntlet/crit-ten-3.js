(async () => {
  const nc=window.__nc,T=window.MythicTenants,Z=window.MythicZoning,D=window.MythicDemographics,
        E=window.MythicEconomy,G=nc.game,L=window.MythicLandValue;
  const K=(x,z)=>x+','+z,R={};
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};
  const houseKeys=Object.keys(G.tiles).filter(k=>G.tiles[k].type==='housing');
  const probe=()=>houseKeys.slice(0,4).map(k=>{const r=D.residents(k);
    return {k, ok:r.ok, why:r.why, zone:r.zone?r.zone.id+'/'+r.zone.src:null,
            homes:r.homes, occupied:r.occupied, residents:r.residents, income:r.income};});
  R.step0 = { houses:houseKeys.length, demogPop:D.population(), probe:probe(),
              maxNear:T._field().field().maxNear };
  const rep = D.report ? D.report() : null;
  R.report0 = rep ? {pop:rep.population, cap:rep.capacity, homes:rep.homes, limit:rep.limit,
                     occupied:rep.occupied, zonedTiles:rep.zonedTiles, derivedTiles:rep.derivedTiles} : null;

  // grow services + step
  for (const r of ['rations','remedies','goods','water']) { try{G.stock[r]=900000;}catch(e){} }
  let svc=0;
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){ if(G.tiles[K(x,z)])continue;
    const m=(x+z)%3; if(await place(m===2?'foodtruck':'purifier',x,z)) svc++; }
  for(let i=0;i<6;i++){ await nc.step(300,150); }
  T._field().invalidate();
  R.step1 = { svc, demogPop:D.population(), probe:probe(), maxNear:T._field().field().maxNear };

  // now ZONE the housing residential and let the pipeline fill it
  let painted=0;
  for (const k of houseKeys){ const c=k.split(','); if(Z.applyPaint(+c[0],+c[1],'r_low',null)) painted++; }
  for(let i=0;i<6;i++){ await nc.step(300,150); }
  T._field().invalidate();
  R.step2 = { painted, demogPop:D.population(), probe:probe(), maxNear:T._field().field().maxNear };
  const rep2 = D.report ? D.report() : null;
  R.report2 = rep2 ? {pop:rep2.population, cap:rep2.capacity, homes:rep2.homes, limit:rep2.limit,
                      zonedTiles:rep2.zonedTiles, derivedTiles:rep2.derivedTiles} : null;
  return R;
})()
