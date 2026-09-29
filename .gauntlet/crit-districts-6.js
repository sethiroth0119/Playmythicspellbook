(async () => {
  const nc=window.__nc, D=window.MythicDistricts, Z=window.MythicZoning,
        P=window.MythicProgress, L=window.MythicLandValue, G=nc.game;
  const R={}, K=(x,z)=>x+','+z;
  for(const n of P.tree.NODES) P._grant(n.id);

  /* 1. THE Z KEY — ONE dispatch each way */
  R.z1={before:Z.panelOpen()};
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  R.z1.afterOpen=Z.panelOpen();
  R.z1.specRow=!!document.getElementById('nz-spec');
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  R.z1.afterClose=Z.panelOpen();
  // and while typing into a field the key must be ignored
  const inp=document.createElement('input'); document.body.appendChild(inp); inp.focus();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));
  R.z1.whileTyping=Z.panelOpen(); inp.remove();

  /* 2. THE CHIP ROW AS A PLAYER USES IT — click the real button */
  Z.panel(true);
  Z.pick && Z.pick('c_low');
  await new Promise(r=>setTimeout(r,150));
  const row=document.getElementById('nz-spec');
  R.chipRow={ present:!!row, buttons:row?[...row.querySelectorAll('[data-spec]')].map(b=>b.dataset.spec+':'+b.className):null };
  if(row){
    const b=[...row.querySelectorAll('[data-spec]')].find(b=>b.dataset.spec==='c_mythic');
    if(b){ b.click(); await new Promise(r=>setTimeout(r,150)); }
    R.chipRow.armedAfterClick=D.armed();
    R.chipRow.armedForCom=D.armedFor('com');
  }

  /* 3. ABSENT MODULE ⇒ TODAY'S GAME. Short-circuit and diff the planner. */
  const plots=[];
  for(let x=0;x<24;x++)for(let z=0;z<24;z++){
    if(G.tiles[K(x,z)]||G.zones[K(x,z)])continue;
    const rf=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if(rf) plots.push({x,z});
  }
  for(const p of plots.slice(0,10)) Z.applyPaint(p.x,p.z,'c_low',null);
  const sig=()=>{const pl=Z.plan(null);return JSON.stringify({out:pl.out.map(o=>[o.x,o.z,o.type]),grow:pl.grow.length,skip:pl.skip});};
  const withMod=sig();
  const keep=window.MythicDistricts; window.MythicDistricts=undefined;
  const without=sig();
  window.MythicDistricts=keep;
  const back=sig();
  R.shortCircuit={identical_unspecialised: withMod===without, restored: withMod===back,
                  sample: withMod.slice(0,200)};
  /* now with a specialisation painted, the two MUST differ */
  if(plots[0]) Z.applyPaint(plots[0].x,plots[0].z,'c_low','c_retail');
  const withSpec=sig();
  window.MythicDistricts=undefined; const withoutSpec=sig(); window.MythicDistricts=keep;
  R.shortCircuit.differsWhenSpecialised = withSpec!==withoutSpec;

  /* 4. refusal() on a tile whose zone family no longer matches */
  const t=plots[1];
  Z.applyPaint(t.x,t.z,'c_low','c_retail');
  const okBefore=D.specAt(t.x,t.z);
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{[K(t.x,t.z)]:'c_retail'}}});
  Z.applyPaint(t.x,t.z,'i_mfg',undefined);         // re-zone into another family
  R.staleFamily={ specAfterRezone:D.specAt(t.x,t.z), okBefore,
                  markAt:D.markAt(K(t.x,t.z),'i_mfg'),
                  mixFor:D.mixFor(t.x,t.z,'i_mfg',['smelter']),
                  refusal:D.refusal(t.x,t.z) };
  /* and on a tile with NO zone at all */
  window.MythicCitySave.restore({v:1,districts:{v:1,spec:{'0,0':'c_lux'}}});
  R.noZone={ spec:D.specAt(0,0), mark:D.markAt('0,0',null), refusal:D.refusal(0,0) };
  return R;
})()
