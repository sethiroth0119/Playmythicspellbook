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

  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low',null);
  T._field().invalidate();
  // DEVELOP through the shipped path
  await Z.develop({toggle:true});
  for (let i=0;i<260;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done();
  try{nc.eco.sync();}catch(e){} T.observe(true);
  const built=free.filter(p=>G.tiles[K(p.x,p.z)]);
  R.dev={zoned:free.length,built:built.length,
    types:built.reduce((a,p)=>{const t=G.tiles[K(p.x,p.z)].type;a[t]=(a[t]||0)+1;return a;},{}),
    tenancies:T.stats().tenancies, plan:(()=>{const pl=Z.plan(null);return{out:pl.out.length,grow:pl.grow.length,skip:pl.skip};})()};
  const lets0=T._store().lets();
  R.tenants0=Object.keys(lets0).sort().slice(0,80).map(k=>({k,n:lets0[k].n,size:lets0[k].size,want:lets0[k].want,bid:lets0[k].bid}));
  R.companiesHolding=(()=>{const m={};for(const k in lets0)m[lets0[k].c]=(m[lets0[k].c]||0)+1;
    return {distinct:Object.keys(m).length, lots:Object.keys(lets0).length, maxPerCompany:Math.max(0,...Object.values(m))};})();
  R.verify0=T.verify();

  // ══ DRIVE THE CLOCK ══
  const samples=[];
  for (let s=0;s<10;s++){
    await nc.step(20*60,200);
    try{nc.eco.sync();}catch(e){}
    const o=T.observe(true);
    const st=T.stats();
    const fm=new Map(); for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
    const lv={}; for(const k in T._store().lets()){const f=fm.get(k); if(f) lv['L'+f.level]=(lv['L'+f.level]||0)+1;}
    samples.push({day:E.snapshot().day, tenancies:st.tenancies, vacant:st.vacant,
      byRung:st.byRung, lifetime:st.lifetime, firmLevels:lv,
      obs:{failed:o.failed.length,relet:o.relet.length,grown:o.grown.length,noBidder:o.noBidder,waiting:o.waiting,damaged:o.damaged,struggling:o.struggling},
      audit:E.snapshot().audit.ok});
    console.log('SMP '+JSON.stringify(samples[samples.length-1]).slice(0,380));
  }
  R.samples=samples;
  R.ledger=T.failures().slice(-14).map(f=>({n:f.n,k:f.k,size:f.size,want:f.want,days:f.days,rung:f.rung,why:f.why}));
  R.vacancies=nc.tenantVacancies().slice(0,8);
  R.verify1=T.verify();
  R.levels=(()=>{const l=T._store().lets(),out={};const fm=new Map();
    for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
    let seam=null;
    for(const k in l){const f=fm.get(k); if(!f)continue; out['L'+f.level]=(out['L'+f.level]||0)+1;
      const c=k.split(','); if(!seam||f.level>1) seam={k,name:l[k].n,size:l[k].size,firmLevel:f.level,
        levelFor:T.levelFor(+c[0],+c[1]),tileLvl:(G.tiles[k]||{}).lvl};}
    return {firmLevels:out,seam};})();
  R.overlay={on:T.overlay(true),painted:T.overlayPainted()};
  R.audit=E.snapshot().audit;
  R.econLog=E.log().slice(-12).map(e=>e.msg||e.text||'');
  return R;
})()
