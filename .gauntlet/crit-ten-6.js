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
  try{nc.eco.sync();}catch(e){} T._field().invalidate();
  R.city={pop:D.population(),maxNear:T._field().field().maxNear,day:E.snapshot().day};

  /* ══ A. RESIDENTIAL ZONING — wants() refuses to run a market on housing.
        Does award() honour that? ══════════════════════════════════════════ */
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  const RES = free.slice(0,26);
  for (const p of RES) Z.applyPaint(p.x,p.z,'r_low',null);
  T._field().invalidate();
  R.resZoned = RES.length;
  R.wantsSaysOnResidential = RES.slice(0,3).map(p=>{
    const d=nc.districtAt(p.x,p.z); const bag=d?d.afterLand:[];
    return {k:K(p.x,p.z),bag,wants:(()=>{try{return T.wants(p.x,p.z,bag,'res');}catch(e){return 'throw';}})()};});
  const t0=T.stats().tenancies;
  await Z.develop({toggle:true});
  for (let i=0;i<160;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done();
  try{nc.eco.sync();}catch(e){} T.observe(true);
  const builtRes = RES.filter(p=>G.tiles[K(p.x,p.z)]);
  const lets=T._store().lets();
  const housingTenancies = Object.keys(lets).filter(k=>lets[k].want==='housing');
  R.residential = { zoned:RES.length, built:builtRes.length,
    builtTypes: builtRes.reduce((a,p)=>{const t=G.tiles[K(p.x,p.z)].type;a[t]=(a[t]||0)+1;return a;},{}),
    tenanciesBefore:t0, tenanciesAfter:T.stats().tenancies,
    HOUSING_TENANCIES: housingTenancies.length,
    sample: housingTenancies.slice(0,5).map(k=>({k,...lets[k],
      tileType:(G.tiles[k]||{}).type, tileLvl:(G.tiles[k]||{}).lvl,
      levelFor:T.levelFor(+k.split(',')[0],+k.split(',')[1]),
      tenantAt:(()=>{const t=T.tenantAt(+k.split(',')[0],+k.split(',')[1]);return t?{name:t.name,typeName:t.typeName,size:t.size.id,firm:t.firm}:null;})()})),
    overlayPaints: (()=>{T.overlay(true);return T.overlayPainted();})(),
    verify: T.verify() };

  /* ══ B. A BUILT LOT WITH NO TENANCY ══════════════════════════════════ */
  const COM = free.slice(26);
  for (const p of COM) Z.applyPaint(p.x,p.z,'c_low',null);
  T._field().invalidate();
  await Z.develop({toggle:true});
  for (let i=0;i<220;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done();
  try{nc.eco.sync();}catch(e){} T.observe(true);
  const lets2=T._store().lets(), vacs2=T._store().vacs();
  const builtCom = COM.filter(p=>G.tiles[K(p.x,p.z)]);
  const orphan = builtCom.filter(p=>!lets2[K(p.x,p.z)]&&!vacs2[K(p.x,p.z)]);
  R.orphans = { builtCom:builtCom.length, tenanted:builtCom.length-orphan.length, ORPHANED:orphan.length,
    sample: orphan.slice(0,4).map(p=>{const k=K(p.x,p.z);
      const e=nc.tenantBids(p.x,p.z,[G.tiles[k].type]);
      return {k,type:G.tiles[k].type,val:L.valueAt(p.x,p.z),
        bestBid:(e&&e.ok&&e.rows.length)?e.rows[0].total:null,
        inOverlay:false, inPanel:false};}) };

  /* ══ C. THE POOL — how many companies actually enter an auction ══════ */
  const p0=COM[0]||free[0];
  const d0=nc.districtAt(p0.x,p0.z), e0=nc.tenantBids(p0.x,p0.z,d0?d0.afterLand:[]);
  R.poolReality = { panelSays: T.stats().pool,
    rowsInAuction: e0&&e0.ok?e0.rows.length:null,
    distinctCandidatesInAuction: e0&&e0.ok?[...new Set(e0.rows.map(r=>r.cand.id))].length:null,
    bagSize: d0?d0.afterLand.length:0 };

  /* ══ D. SAVE / LOAD — every write path into the store ════════════════ */
  const coll = window.MythicCitySave.collect();
  R.saveShape = { keys:Object.keys(coll.tenants||{}), lets:Object.keys((coll.tenants||{}).let||{}).length,
                  fails:((coll.tenants||{}).fail||[]).length, count:(coll.tenants||{}).count };
  const hostile = JSON.parse(JSON.stringify(coll));
  hostile.tenants.let['999,999'] = { c:'shop#99999', n:'Hostile Ltd', want:'shop', size:'national', day:0, lvl:5, rung:'HEALTHY', f:12345, bid:9999 };
  hostile.tenants.let['3,3'] = { c:'shop#0', n:'Ghost', want:'shop', size:'national', day:0, lvl:5, rung:'HEALTHY', f:1, bid:1 };
  hostile.tenants.count = { failed: 999999, let: 999999, grown: 999999 };
  window.MythicCitySave.restore(hostile);
  try{T.afterLoad();}catch(e){}
  R.hostileLoad = { tenancies:T.stats().tenancies, lifetime:T.stats().lifetime,
                    has999: !!T._store().tenancy('999,999'),
                    at33: T._store().tenancy('3,3'),
                    verify: T.verify() };
  return R;
})()
