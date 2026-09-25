(async () => {
  const nc=window.__nc,T=window.MythicTenants,Z=window.MythicZoning,P=window.MythicProgress,
        L=window.MythicLandValue,E=window.MythicEconomy,G=nc.game,K=(x,z)=>x+','+z;
  const R={}; const done=()=>{try{nc.build.finishAll('ui');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};
  for (const n of P.tree.NODES) P._grant(n.id);
  try { await nc.build.acquire('construction'); } catch(e){}
  await place('op_construction',2,2);
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r]=900000; } catch(e){} }
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){ if(G.tiles[K(x,z)])continue;
    const m=(x+z)%3; await place(m===2?'foodtruck':'purifier',x,z); }
  await nc.step(400,200); nc.eco.sync(); nc.tenantObserve(true);
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){ if(G.tiles[K(x,z)]||G.zones[K(x,z)])continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if(road) free.push({x,z}); }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low','c_food');
  nc.tenantObserve(true);
  const ranked=free.map(p=>{const d=nc.districtAt(p.x,p.z);const w=T.winner(p.x,p.z,d?d.afterLand:[]);return {...p,w};})
    .filter(p=>p.w).sort((a,b)=>b.w.total-a.w.total).slice(0,4);
  for (const p of free) Z.setZone(p.x,p.z,null);
  for (const p of ranked) Z.applyPaint(p.x,p.z,'c_low','c_food');
  await Z.develop({toggle:true}); for(let i=0;i<60;i++){await Z.step();done();}
  Z.stopDevelop(); done(); nc.eco.sync(); nc.tenantObserve(true);

  /* ONE NAME IN THE CITY: the tenant, the sign, and the firm's books */
  const N=window.MythicNaming, fm=new Map(); for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
  R.oneName = Object.keys(T._store().lets()).map(k=>{const rec=T._store().lets()[k];const f=fm.get(k);
    return {k, tenant:rec.n, sign:N.nameFor(k), firm:f?f.name:null, custom:N.isCustom(k),
            match: N.nameFor(k)===rec.n && (!f || f.name===rec.n)};});

  /* THE PANEL — opened through the shipped path, then measured */
  R.panelBefore = T.panelOpen();
  R.opened = T.openPanel();
  const el=document.getElementById('ntn-panel');
  R.panel = { exists:!!el, open:T.panelOpen(), html: el?el.innerHTML.length:0,
    sections: el?Array.from(el.querySelectorAll('.ntsec>b')).map(b=>b.textContent):null,
    tenantRows: el?el.querySelectorAll('.nttab tr').length:0,
    mentionsOmitted: el?['Traffic','Parking','Tourism','Crime','Taxes'].every(w=>el.innerHTML.includes(w)):null };
  /* the B key, through the real listener */
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true}));
  R.afterBKeyOnDocument = T.panelOpen();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}));
  R.afterBKeyOnWindow = T.panelOpen();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}));
  R.afterBKeyAgain = T.panelOpen();
  R.overlay = { on:T.overlay(true), painted:T.overlayPainted() };
  R.tenants = T.stats().tenancies;
  R.errors = window.__ncErrs||null;
  return R;
})()
