(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning, P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  /* A NON-LEGACY city: a save that DOES carry a progress slice (v + empty
     unlocked lists) plus a hand-edited districts slice. */
  window.MythicCitySave.restore({ v:1,
    progress: { v:1, u:[], g:[], r:[], e:[], spent:0, legacy:false },
    districts:{ v:1, spec:{ '3,3':'c_mythent','4,4':'i_cards','5,5':'o_corp' } } });
  const b=P.state();
  const ad=P.afterLoad();
  const a=P.state();
  R.nonLegacy={ legacy:a.legacy, adopted:ad, gained:a.granted.filter(n=>!b.granted.includes(n)),
                specsAfter:a.specs, points:a.points };

  /* Re-confirm the locked-spec-through-save effect, deterministically, twice */
  const rf=(x,z)=>[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
  const plots=[]; for(let x=0;x<24;x++)for(let z=0;z<24;z++){if(G.tiles[K(x,z)]||G.zones[K(x,z)])continue;if(rf(x,z))plots.push({x,z});}
  const t=plots[3];
  const trial=()=>{ window.MythicCitySave.restore({v:1,districts:{v:1,spec:{}}});
    Z.applyPaint(t.x,t.z,'c_low',null);
    const before=nc.districtAt(t.x,t.z).wouldBuild;
    window.MythicCitySave.restore({v:1,districts:{v:1,spec:{[K(t.x,t.z)]:'c_retail'}}});
    const after=nc.districtAt(t.x,t.z).wouldBuild;
    return {before,after,spec:D.specAt(t.x,t.z),lockedWrites:D.stats().lockedWrites,verifyOK:D.verify().ok}; };
  R.trials=[trial(),trial(),trial()];
  return R;
})()
