(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning,
        P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  const rf=(x,z)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
  const freePlots=()=>{const o=[];for(let x=0;x<24;x++)for(let z=0;z<24;z++){if(G.tiles[K(x,z)]||G.zones[K(x,z)])continue;if(rf(x,z))o.push({x,z,band:L.bandAt(x,z).id});}return o;};

  /* ══ 0. BOOT, NOTHING RESEARCHED ═════════════════════════════════════════ */
  const v0=nc.districtVerify();
  R.bootVerify={ ok:v0.ok, problems:v0.problems, placebo:v0.placebo, heldOnMap:v0.heldOnMap,
                 researchHeld:v0.researchHeld };

  /* ══ 1. DEFECT 2 — the placebo pairing, from the shipped seams ═══════════ */
  R.differs={
    o_tech_on_o_low : D.differsOn('o_tech','o_low').map(b=>b.id),
    o_tech_on_o_high: D.differsOn('o_tech','o_high').map(b=>b.id),
    i_manu_on_i_mfg : D.differsOn('i_manu','i_mfg').map(b=>b.id),
    i_log_on_i_ware : D.differsOn('i_log','i_ware').map(b=>b.id),
    c_lux_on_c_high : D.differsOn('c_lux','c_high').map(b=>b.id),
    c_retail_on_c_low: D.differsOn('c_retail','c_low').map(b=>b.id),
  };
  R.availOnOfficeLow  = D.available('off','o_low' ).map(r=>({id:r.id,inert:r.inert,differs:r.differs&&r.differs.length,realOn:(r.realOn||[]).map(z=>z.id)}));
  R.availOnOfficeHigh = D.available('off','o_high').map(r=>({id:r.id,inert:r.inert,differs:r.differs&&r.differs.length}));
  R.availNoZone = D.available('off').map(r=>({id:r.id,inert:r.inert,differs:r.differs}));

  /* what the PLAYER sees in the row, both office zones */
  const host=document.createElement('div'); document.body.appendChild(host);
  D.renderSpecRow(host,'o_low');
  R.rowTextOfficeLow=host.textContent.replace(/\s+/g,' ').slice(0,420);
  R.chipClassesLow=[...host.querySelectorAll('[data-spec]')].map(b=>b.dataset.spec+':'+b.className);
  D.renderSpecRow(host,'o_high');
  R.chipClassesHigh=[...host.querySelectorAll('[data-spec]')].map(b=>b.dataset.spec+':'+b.className);
  host.remove();

  /* ══ 2. DEFECT 1 — a locked spec through the SAVE, on a real zoned tile ══ */
  const p=freePlots()[4];
  Z.applyPaint(p.x,p.z,'c_low',null);
  const A={ tile:[p.x,p.z], zone:Z.zoneAt(p.x,p.z), specUnlocked_c_retail:P.specUnlocked('c_retail'),
            before:nc.districtAt(p.x,p.z) };
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{[K(p.x,p.z)]:'c_retail'}}});
  A.specAt=D.specAt(p.x,p.z);
  A.after=nc.districtAt(p.x,p.z);
  A.tenantChanged=A.before.wouldBuild!==A.after.wouldBuild;
  A.bagChanged=JSON.stringify(A.before.afterLand)!==JSON.stringify(A.after.afterLand);
  A.mark=D.markAt(K(p.x,p.z),'c_low');
  A.levelFor=D.levelFor(p.x,p.z,'c_low');
  A.refusal=D.refusal(p.x,p.z);
  A.stats={per:D.stats().per,heldPer:D.stats().heldPer,held:D.stats().held,specialised:D.stats().specialised};
  A.afterLoad=D.afterLoad();
  A.specAfterAfterLoad=D.specAt(p.x,p.z);
  const vv=D.verify(); A.verify={ok:vv.ok,problems:vv.problems,heldOnMap:vv.heldOnMap};
  /* progression must adopt NOTHING off it */
  const gb=P.state().granted.slice();
  A.progAdopted=P.afterLoad();
  A.progGained=P.state().granted.filter(n=>!gb.includes(n));
  A.progSpecs=P.state().specs;
  R.lockedFromSave=A;

  /* ══ 3. THE HOLD IS NOT A DELETION — research it and it comes alive ══════ */
  const node=P.specBlockedBy('c_retail');
  R.unhold={ node, specStillThere:D.specAt(p.x,p.z) };
  P._grant(node.node);
  R.unhold.specUnlockedNow=P.specUnlocked('c_retail');
  R.unhold.after=nc.districtAt(p.x,p.z);
  R.unhold.mark=D.markAt(K(p.x,p.z),'c_low');
  R.unhold.tenantChangedNow=A.before.wouldBuild!==R.unhold.after.wouldBuild;
  R.unhold.perNow=D.stats().per;
  R.unhold.verifyProblems=D.verify().problems;
  R.unhold.noReloadNoRepaint=true;

  /* ══ 4. DEFECT 4 — refusal() on a tile with NO zone, from a save ═════════ */
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{'0,0':'c_lux','1,1':'c_lux'}}});
  Z.applyPaint(1,1,'i_mfg',undefined);
  R.defect4={ noZone:{ spec:D.specAt(0,0), zone:Z.zoneAt(0,0), mark:D.markAt('0,0',null),
                       mix:D.mixFor(0,0,null,['grocery']), refusal:D.refusal(0,0) },
              wrongFamily:{ spec:D.specAt(1,1), zone:Z.zoneAt(1,1), mark:D.markAt('1,1','i_mfg'),
                            mix:D.mixFor(1,1,'i_mfg',['smelter']), refusal:D.refusal(1,1) } };
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{}}});
  Z.applyPaint(1,1,null,null); Z.applyPaint(p.x,p.z,null,null);

  /* ══ 5. DEFECT 5 — the desc names no building the city lacks ═════════════ */
  const B=(()=>{try{return Object.keys(nc.buildings?nc.buildings():{});}catch(e){return null;}})();
  R.defect5={ desc:D.SPEC_BY_ID.c_mythic.desc,
              mentionsGraders:/grader/i.test(D.SPEC_BY_ID.c_mythic.desc),
              o_techDesc:D.SPEC_BY_ID.o_tech.desc };

  /* ══ 6. GRANT EVERYTHING — o_tech on o_low is STILL inert, and still marked */
  for(const n of P.tree.NODES) P._grant(n.id);
  R.granted={ verify:(()=>{const v=D.verify();return{ok:v.ok,problems:v.problems,placebo:v.placebo};})(),
              differs_o_tech_o_low:D.differsOn('o_tech','o_low').map(b=>b.id),
              differs_o_tech_o_high:D.differsOn('o_tech','o_high').map(b=>b.id) };
  const of_=freePlots().slice(0,2);
  Z.applyPaint(of_[0].x,of_[0].z,'o_low',null);
  Z.applyPaint(of_[1].x,of_[1].z,'o_low','o_tech');
  const a=nc.districtAt(of_[0].x,of_[0].z), b=nc.districtAt(of_[1].x,of_[1].z);
  R.granted.oTechLive={ plain:{afterSpec:a.afterSpec,afterLand:a.afterLand,would:a.wouldBuild,lvl:a.lvl},
    spec:{afterSpec:b.afterSpec,afterLand:b.afterLand,would:b.wouldBuild,lvl:b.lvl},
    identicalBag:JSON.stringify(a.afterSpec)===JSON.stringify(b.afterSpec), identicalLvl:a.lvl===b.lvl };
  const h2=document.createElement('div'); document.body.appendChild(h2);
  D.renderSpecRow(h2,'o_low');
  R.granted.rowTextOfficeLow=h2.textContent.replace(/\s+/g,' ').slice(0,500);
  const btn=[...h2.querySelectorAll('[data-spec]')].find(x=>x.dataset.spec==='o_tech');
  R.granted.oTechChipHTML=btn?btn.outerHTML.slice(0,260):null;
  h2.remove();
  Z.applyPaint(of_[0].x,of_[0].z,null,null); Z.applyPaint(of_[1].x,of_[1].z,null,null);

  /* ══ 7. THE MILDER PAIRS — real on ONE band of five, and the row says which */
  const h3=document.createElement('div'); document.body.appendChild(h3);
  D.arm('i_manu'); D.renderSpecRow(h3,'i_mfg');
  R.industrialRow_i_manu=h3.textContent.replace(/\s+/g,' ').slice(0,600);
  D.arm('i_log'); D.renderSpecRow(h3,'i_ware');
  R.industrialRow_i_log=h3.textContent.replace(/\s+/g,' ').slice(0,600);
  R.industrialChips=[...h3.querySelectorAll('[data-spec]')].map(b=>b.dataset.spec+':'+b.className);
  h3.remove(); D.arm(null);
  return R;
})()
