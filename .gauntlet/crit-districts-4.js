(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning,
        P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){} done(); return !!G.tiles[K(x,z)];};
  const roadFronted=(x,z)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
  const freePlots=()=>{const o=[];for(let x=0;x<24;x++)for(let z=0;z<24;z++){if(G.tiles[K(x,z)])continue;if(!roadFronted(x,z))continue;o.push({x,z,prem:Math.round(L.premiumAt(x,z)),band:L.bandAt(x,z).id,lot:nc.landValueAt(x,z).lotValue});}return o.sort((a,b)=>b.prem-a.prem);};

  /* ══ A (redone). A LOCKED SPEC ARRIVING THROUGH A SAVE, on a tile that is
        really zoned c_low (ungated) with c_retail (gated). ══ */
  const cand = freePlots().filter(p=>!G.zones[K(p.x,p.z)]);
  const tA = cand[Math.floor(cand.length/2)];
  const pa = Z.applyPaint(tA.x,tA.z,'c_low',null);
  const A={ tile:tA, paint:pa, zoneAt:Z.zoneAt(tA.x,tA.z),
            specUnlocked_before:P.specUnlocked('c_retail'),
            before:nc.districtAt(tA.x,tA.z) };
  window.MythicCitySave.restore({ v:1, districts:{ v:1, spec:{ [K(tA.x,tA.z)]:'c_retail' } } });
  A.specAt=D.specAt(tA.x,tA.z);
  A.after=nc.districtAt(tA.x,tA.z);
  A.tenantChanged = A.before.wouldBuild !== A.after.wouldBuild;
  A.bagChanged = JSON.stringify(A.before.afterLand)!==JSON.stringify(A.after.afterLand);
  A.specUnlocked_after=P.specUnlocked('c_retail');
  A.progAdoptedWithoutAsking = P.state().granted.slice();
  A.lockedWrites=D.stats().lockedWrites; A.verifyProblems=D.verify().problems;
  R.A=A;
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{}}});
  Z.applyPaint(tA.x,tA.z,null,null);

  for(const n of P.tree.NODES) P._grant(n.id);

  /* ══ B. MANUFACTURE EXPENSIVE LAND. 3 arenas + a road frontage on one plot. ══ */
  const base = freePlots().filter(p=>!G.tiles[K(p.x,p.z)]);
  let target=null;
  for (const p of base) {
    const n=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dz])=>({x:p.x+dx,z:p.z+dz,t:G.tiles[K(p.x+dx,p.z+dz)]}));
    const roads=n.filter(q=>q.t&&q.t.type==='road').length, free=n.filter(q=>!q.t).length;
    if(roads>=1&&free>=2){ target={p,n}; break; }
  }
  R.B={ chosen: target?target.p:null };
  if(target){
    const empties=target.n.filter(q=>!q.t);
    const placed=[];
    for(const q of empties){ if(await place('arena',q.x,q.z)) placed.push('arena@'+q.x+','+q.z); else placed.push('FAIL '+q.x+','+q.z); }
    // fountains in the ring beyond, to push reach/decor
    for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
      const x=target.p.x+dx,z=target.p.z+dz; if(Math.abs(dx)<2&&Math.abs(dz)<2) continue;
      if(!G.tiles[K(x,z)]&&x>=0&&z>=0&&x<24&&z<24) await place('fountain',x,z);
    }
    L.verify();
    R.B.placed=placed;
    R.B.after={ prem:Math.round(L.premiumAt(target.p.x,target.p.z)), band:L.bandAt(target.p.x,target.p.z).id,
                lot:nc.landValueAt(target.p.x,target.p.z).lotValue };
    R.B.hist=(()=>{const h={};for(let x=0;x<24;x++)for(let z=0;z<24;z++){const b=L.bandAt(x,z).id;h[b]=(h[b]||0)+1;}return h;})();
  }

  /* ══ C. LUXURY vs RETAIL vs BARE on the BEST land now available ══ */
  const good = freePlots().filter(p=>!G.zones[K(p.x,p.z)]);
  R.C_best3 = good.slice(0,3);
  const trio = good.slice(0,3);
  const cheapest = good[good.length-1];
  if(trio.length===3){
    Z.applyPaint(trio[0].x,trio[0].z,'c_high',null);
    Z.applyPaint(trio[1].x,trio[1].z,'c_high','c_retail');
    Z.applyPaint(trio[2].x,trio[2].z,'c_high','c_lux');
    R.C = trio.map(p=>{const a=nc.districtAt(p.x,p.z);
      return {at:[p.x,p.z],prem:p.prem,lot:p.lot,band:a.band,spec:a.spec||'none',afterLand:a.afterLand,would:a.wouldBuild,lvlTarget:a.lvl,refusal:a.refusal};});
  }
  if(cheapest){ Z.applyPaint(cheapest.x,cheapest.z,'c_high','c_lux');
    const a=nc.districtAt(cheapest.x,cheapest.z);
    R.C_cheapLux={at:[cheapest.x,cheapest.z],prem:cheapest.prem,lot:cheapest.lot,band:a.band,afterLand:a.afterLand,would:a.wouldBuild,refusal:a.refusal}; }

  /* ══ D. DEVELOP through the shipped path, then read levels ══ */
  const t0=Object.keys(G.tiles).length;
  await Z.develop({toggle:true});
  for(let i=0;i<90;i++){await Z.step();done();}
  Z.stopDevelop();done();
  const rd=p=>{const t=G.tiles[K(p.x,p.z)];return{at:[p.x,p.z],spec:D.specAt(p.x,p.z)||'none',type:t?t.type:null,lvl:t?(t.lvl|0):null,target:nc.districtAt(p.x,p.z).lvl};};
  R.D={tilesBefore:t0,tilesAfter:Object.keys(G.tiles).length,
       trio:trio.length===3?trio.map(rd):null, cheapLux:cheapest?rd(cheapest):null,
       plan:(()=>{const p=Z.plan(null);return{out:p.out.length,grow:p.grow.length,skip:p.skip};})()};

  /* ══ E. cardSeam against a REAL chain ══ */
  const ind = freePlots().filter(p=>!G.zones[K(p.x,p.z)]).slice(0,4);
  for(const p of ind) Z.applyPaint(p.x,p.z,'i_mfg','i_cards');
  const seedTypes=['papermill','printworks','depot','shop'];
  const seeded=[];
  for(let i=0;i<ind.length;i++){ if(await place(seedTypes[i],ind[i].x,ind[i].z)) seeded.push(seedTypes[i]+'@'+ind[i].x+','+ind[i].z); }
  R.E_seeded=seeded;
  R.E_cardSeam=D.cardSeam();
  R.E_countsIndependently=(()=>{let n=0;for(const k in G.tiles){const t=G.tiles[k];if(seedTypes.includes(t.type))n++;}return n;})();
  R.E_marks=Z.specMarks();
  R.E_stats=D.stats();
  R.E_verify=D.verify();
  try{ if(typeof renderVitals==='function') renderVitals(); }catch(e){}
  R.E_chipHTML=(document.getElementById('dschip')||{}).textContent||null;
  return R;
})()
