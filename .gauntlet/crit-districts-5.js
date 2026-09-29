(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning,
        P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  const done=()=>{try{nc.build.finishAll('crit');}catch(e){}};
  const roadFronted=(x,z)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
  const freePlots=()=>{const o=[];for(let x=0;x<24;x++)for(let z=0;z<24;z++){if(G.tiles[K(x,z)])continue;if(!roadFronted(x,z))continue;if(G.zones[K(x,z)])continue;o.push({x,z,prem:Math.round(L.premiumAt(x,z)),band:L.bandAt(x,z).id});}return o.sort((a,b)=>b.prem-a.prem);};
  for(const n of P.tree.NODES) P._grant(n.id);

  /* ══ 1. THE LEVEL OVERRIDE, on land this city actually has.
        c_low targets lvl 1. 🃏 Mythic Retail targets lvl 2 and on MODEST land
        its bag is [retail]. Two adjacent modest plots, one specialised. ══ */
  const mod = freePlots().filter(p=>p.band==='modest').slice(0,4);
  R.pair = mod.slice(0,2);
  if(mod.length>=2){
    Z.applyPaint(mod[0].x,mod[0].z,'c_low',null);
    Z.applyPaint(mod[1].x,mod[1].z,'c_low','c_mythic');
    R.plan_before = (()=>{const p=Z.plan(null);return{out:p.out.length,grow:p.grow.length};})();
    R.targets = mod.slice(0,2).map(p=>({at:[p.x,p.z],spec:D.specAt(p.x,p.z)||'none',
      would:nc.districtAt(p.x,p.z).wouldBuild, specLvl:D.levelFor(p.x,p.z,'c_low'), zoneLvl:Z.ZONE_BY_ID.c_low.lvl}));
    await Z.develop({toggle:true});
    for(let i=0;i<120;i++){await Z.step();done();}
    Z.stopDevelop();done();
    R.levelResult = mod.slice(0,2).map(p=>{const t=G.tiles[K(p.x,p.z)];
      return {at:[p.x,p.z],spec:D.specAt(p.x,p.z)||'none',type:t?t.type:null,lvl:t?(t.lvl|0):null};});
    R.plan_after=(()=>{const p=Z.plan(null);return{out:p.out.length,grow:p.grow.length,skip:p.skip};})();
  }

  /* ══ 2. o_tech ON o_low, THROUGH districtAt ON A REAL TILE ══ */
  const of_ = freePlots().slice(0,2);
  if(of_.length>=2){
    Z.applyPaint(of_[0].x,of_[0].z,'o_low',null);
    Z.applyPaint(of_[1].x,of_[1].z,'o_low','o_tech');
    const a=nc.districtAt(of_[0].x,of_[0].z), b=nc.districtAt(of_[1].x,of_[1].z);
    R.oTechLive={ plain:{afterSpec:a.afterSpec,afterLand:a.afterLand,would:a.wouldBuild,lvl:a.lvl},
                  spec:{afterSpec:b.afterSpec,afterLand:b.afterLand,would:b.wouldBuild,lvl:b.lvl},
                  identicalBag:JSON.stringify(a.afterSpec)===JSON.stringify(b.afterSpec),
                  identicalLvl:a.lvl===b.lvl };
  }

  /* ══ 3. WHAT THE PANEL SAYS ABOUT o_tech WHILE o_low IS ON THE BRUSH ══ */
  const host=document.createElement('div');
  document.body.appendChild(host);
  R.panelRendered_off = D.renderSpecRow(host,'o_low');
  R.panelText_off = host.textContent.replace(/\s+/g,' ').slice(0,900);
  R.panelRendered_res = D.renderSpecRow(host,'r_low');
  R.panelTextAfterRes = host.textContent;
  host.remove();
  R.availableOff = D.available('off').map(r=>({id:r.id,tenants:r.tenants,floor:r.floor?r.floor.id:null,lvl:r.lvl,locked:r.locked}));

  /* ══ 4. THE CHIP AND THE KEY ══ */
  await nc.step(1,2);
  const chip=document.getElementById('dschip');
  R.chip={ present:!!chip, text:chip?chip.textContent.trim():null, title:chip?chip.title.slice(0,80):null,
           stats:{built:D.stats().built,specialised:D.stats().specialised} };
  const wasOpen=Z.panelOpen();
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  R.zKey={ before:wasOpen, after:Z.panelOpen() };
  R.specRowInPanel = !!document.getElementById('nz-spec');
  return R;
})()
