(async () => {
  const nc = window.__nc, G = nc.game, P = window.MythicProgress;
  for (const n of P.tree.NODES) P._grant(n.id);
  const R = {}, K=(x,z)=>x+','+z;
  R.free = nc.build.free('construction');
  R.priceC = nc.build.price('construction');
  R.grantState = nc.build.grantState();
  try { R.acquire = await nc.build.acquire('construction'); } catch(e){ R.acquire = String(e); }
  try { R.grant = await nc.build.grant(); } catch(e){ R.grant = String(e); }
  R.licences = nc.build.licences('construction');
  R.opsKey = (()=>{ for (const t in nc.BUILDINGS) if (/construct/i.test(t)) return t; return null; })();
  R.opTypes = Object.keys(nc.BUILDINGS).filter(t=>/^op_/.test(t));
  if (R.opsKey) {
    let done=false;
    for (let x=2;x<22&&!done;x++) for (let z=2;z<22&&!done;z++){
      if (G.tiles[K(x,z)]) continue;
      try { await nc.place(R.opsKey,x,z); } catch(e){}
      try { nc.build.finishAll('probe3'); } catch(e){}
      if (G.tiles[K(x,z)]) { R.placedAt=K(x,z); done=true; }
    }
  }
  R.hasCo = nc.build.hasCo ? nc.build.hasCo() : null;
  R.slots = nc.build.slots();
  R.canGrocery = (()=>{ try { return nc.build.crewNote ? nc.build.crewNote('grocery',1) : null; } catch(e){ return String(e);} })();
  return R;
})()
