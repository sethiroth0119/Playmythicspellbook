(async () => {
  const nc=window.__nc,P=window.MythicProgress,E=window.MythicEconomy,G=nc.game,K=(x,z)=>x+','+z;
  const done=()=>{try{nc.build.finishAll('cap');}catch(e){}};
  const place=async(t,x,z)=>{try{await nc.place(t,x,z);}catch(e){}done();return !!G.tiles[K(x,z)];};
  const R={};
  for (const n of P.tree.NODES) P._grant(n.id);
  try { await nc.build.acquire('construction'); } catch(e){}
  await place('op_construction',2,2);
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r]=900000; } catch(e){} }
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){ if(G.tiles[K(x,z)])continue;
    const m=(x+z)%3; await place(m===2?'foodtruck':'purifier',x,z); }
  const snap=()=>{const s=E.snapshot();return {day:s.day,treasury:Math.round(s.treasury),charter:Math.round(s.charter),
    issued:Math.round(s.charterIssued),cap:s.charterCap,budget:Math.round(s.foundingDrawBudget||0),firms:s.firms,pop:s.population};};
  R.t=[];
  for (let i=0;i<10;i++){ await nc.step(400,120); R.t.push(snap()); }
  /* found ONE new firm by hand-placing a foodtruck and see what it got */
  const fbefore=new Set(E.firms().map(f=>f.id));
  await place('foodtruck',10,10); nc.eco.sync();
  const nf=E.firms().filter(f=>!fbefore.has(f.id));
  R.newFirm=nf.map(f=>({id:f.id,out:f.out,cash:Math.round(f.cash),want:Math.round(f.seedWant||0),short:Math.round(f.seedShort||0)}));
  return R;
})()
