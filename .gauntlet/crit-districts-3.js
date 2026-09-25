(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning,
        P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){} done(); return !!G.tiles[K(x,z)];};

  /* ══ A. A LOCKED SPEC ARRIVING THROUGH A SAVE — is it ACTED ON? ══
     c_low is not governed by the tree (paintable at boot); c_retail IS gated. */
  R.A_lockedFromSave = (()=>{
    const o={};
    o.c_low_zoneUnlocked = P.zoneUnlocked('c_low');
    o.c_retail_specUnlocked = P.specUnlocked('c_retail');
    Z.applyPaint(4,4,'c_low',null);
    o.beforeSpec = nc.districtAt(4,4);
    window.MythicCitySave.restore({ v:1, districts:{ v:1, spec:{ '4,4':'c_retail' } } });
    o.specAt = D.specAt(4,4);
    o.afterSpec = nc.districtAt(4,4);
    o.tenantChanged = o.beforeSpec.wouldBuild !== o.afterSpec.wouldBuild;
    o.stillLocked = P.specUnlocked('c_retail');
    o.lockedWrites = D.stats().lockedWrites;
    o.verify_problems = D.verify().problems;
    return o;
  })();
  window.MythicCitySave.restore({ v:1, districts:{ v:1, spec:{} } });
  Z.applyPaint(4,4,null,null);

  for (const n of P.tree.NODES) P._grant(n.id);

  /* ══ B. RAISE LAND VALUE so a premium/prime plot exists ══ */
  const C=12, made=[];
  for(let x=C-3;x<=C+3;x++) for(let z=C-3;z<=C+3;z++){
    if(G.tiles[K(x,z)]) continue;
    const t=((x+z)%4===0)?'foodtruck':((x+z)%4===1)?'motorpool':((x+z)%4===2)?'fountain':'garden';
    if(await place(t,x,z)) made.push(t);
  }
  const plots=[];
  for(let x=0;x<24;x++)for(let z=0;z<24;z++){
    if(G.tiles[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if(road) plots.push({x,z,prem:Math.round(L.premiumAt(x,z)),band:L.bandAt(x,z).id, lot:nc.landValueAt(x,z).lotValue});
  }
  plots.sort((a,b)=>b.prem-a.prem);
  const hist={}; for(let x=0;x<24;x++)for(let z=0;z<24;z++){const b=L.bandAt(x,z).id;hist[b]=(hist[b]||0)+1;}
  R.B_land={ amenities:made.length, bandHist:hist, dearest:plots[0], cheapest:plots[plots.length-1], nPlots:plots.length };

  /* ══ C. "LUXURY RETAIL SHOULD NOT TAKE ON A $90 LOT" ══ */
  const dear = plots[0], cheap = plots[plots.length-1];
  Z.applyPaint(cheap.x,cheap.z,'c_high','c_lux');
  Z.applyPaint(dear.x,dear.z,'c_high','c_lux');
  R.C_luxury = {
    cheapTile:{ ...cheap, at:nc.districtAt(cheap.x,cheap.z) },
    dearTile:{ ...dear, at:nc.districtAt(dear.x,dear.z) },
    floorFromPanel: D.floorOf('c_lux'),
    reach: D.reachOf('c_lux').map(b=>b.id),
    panelRow: D.available('com').find(r=>r.id==='c_lux'),
  };

  /* ══ D. LUXURY vs PLAIN RETAIL vs BARE ZONE on the SAME expensive land ══ */
  const near = plots.slice(0,12).filter(p=>!G.zones[K(p.x,p.z)]);
  const trio = near.slice(0,3);
  if (trio.length===3){
    Z.applyPaint(trio[0].x,trio[0].z,'c_high',null);
    Z.applyPaint(trio[1].x,trio[1].z,'c_high','c_retail');
    Z.applyPaint(trio[2].x,trio[2].z,'c_high','c_lux');
    R.D_compare = trio.map((p,i)=>{ const a=nc.districtAt(p.x,p.z);
      return { at:[p.x,p.z], band:a.band, spec:a.spec||'none', afterLand:a.afterLand, wouldBuild:a.wouldBuild, lvlTarget:a.lvl }; });
    /* is lvl the ONLY difference between lux and retail here? */
    const r=R.D_compare[1], l=R.D_compare[2];
    R.D_luxDiffersBeyondLvl = JSON.stringify(r.afterLand)!==JSON.stringify(l.afterLand);
  }

  /* ══ E. OVERLAY MARKS off the buffer ══ */
  const m0 = Z.specMarks();
  Z.overlay(true);
  R.E_marks = { afterPaints: Z.specMarks(), zonedTiles: Object.keys(G.zones).length, m0 };

  /* ══ F. DEVELOP, shipped path — does the spec's level target really apply? ══ */
  const t0 = Object.keys(G.tiles).length;
  const dev = await Z.develop({toggle:true});
  for(let i=0;i<80;i++){ await Z.step(); done(); }
  Z.stopDevelop(); done();
  const rd = (p)=>{const t=G.tiles[K(p.x,p.z)];return {at:[p.x,p.z],spec:D.specAt(p.x,p.z)||'none',type:t?t.type:null,lvl:t?(t.lvl|0):null,target:nc.districtAt(p.x,p.z).lvl};};
  R.F_develop = { tilesBefore:t0, tilesAfter:Object.keys(G.tiles).length, dev,
    cheap: rd(cheap), dear: rd(dear), trio: (trio.length===3?trio.map(rd):null),
    plan:(()=>{const p=Z.plan(null);return {out:p.out.length,grow:p.grow.length,skip:p.skip};})() };

  /* ══ G. cardSeam + chip + verify ══ */
  R.G_cardSeam = D.cardSeam();
  R.G_stats = D.stats();
  R.G_verify = D.verify();
  try{ nc.renderVitals && nc.renderVitals(); }catch(e){}
  const chip=document.getElementById('dschip');
  R.G_chip = chip? chip.textContent : (document.querySelector('#vitalscard')?'(no dschip in vitals)':'(no vitalscard)');
  R.G_marksFinal = Z.specMarks();
  return R;
})()
