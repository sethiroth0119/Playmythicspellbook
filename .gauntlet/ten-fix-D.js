(async () => {
  const nc=window.__nc,T=window.MythicTenants,Z=window.MythicZoning,G=nc.game;
  const K=(x,z)=>x+','+z,R={};
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low',null);
  let mine=0, cats={};
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    const k=K(x,z); if (G.tiles[k]) continue;
    const id=Z.zoneAt(x,z); const zd=id&&Z.ZONE_BY_ID?Z.ZONE_BY_ID[id]:null;
    const c=zd?zd.cat:null; cats[String(c)]=(cats[String(c)]||0)+1;
    if (c==='com'||c==='off'||c==='ind') mine++;
  }
  R.painted=free.length;
  R.zoningStats={empty:Z.stats().empty, zoned:Z.stats().zoned};
  R.myScan={marketEmpty:mine, cats};
  R.hasZoneById=!!Z.ZONE_BY_ID;
  R.tenantsPool=T.stats().pool;
  R.tenantsRefused=T.stats().refused;
  R.dormant=T.stats().dormant;
  return R;
})()
