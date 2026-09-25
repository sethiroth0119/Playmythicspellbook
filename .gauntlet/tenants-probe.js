(async () => {
  const nc = window.__nc, P = window.MythicProgress, G = nc.game;
  const R = {}, K=(x,z)=>x+','+z;
  const done = () => { try { nc.build.finishAll('probe'); } catch (e) {} };
  const place = async (t,x,z) => { try { await nc.place(t,x,z); } catch(e){} done(); return !!G.tiles[K(x,z)]; };
  for (const n of P.tree.NODES) P._grant(n.id);
  R.stockBefore = nc.stock();
  for (const r of ['rations','remedies','goods','water','food']) { try { G.stock[r] = 900000; } catch(e){} }
  R.stockAfter = Object.fromEntries(Object.entries(nc.stock()).filter(([k])=>['rations','remedies','goods','water'].includes(k)));
  const C=12; let n=0;
  for (let x=C-4;x<=C+4;x++) for (let z=C-4;z<=C+4;z++){
    if (G.tiles[K(x,z)]) continue;
    const t = ((x+z)%5===0)?'foodtruck':((x+z)%5===1)?'clinic':((x+z)%5===2)?'purifier':((x+z)%5===3)?'fountain':'garden';
    if (await place(t,x,z)) n++;
  }
  R.placed = n;
  R.types = Object.values(G.tiles).reduce((a,t)=>(a[t.type]=(a[t.type]||0)+1,a),{});
  R.s1 = await nc.step(200,100);
  R.s2 = await nc.step(400,200);
  R.s3 = await nc.step(600,300);
  R.pop = nc.pop();
  R.demogPop = window.MythicDemographics.population();
  R.eco = (()=>{const s=window.MythicEconomy.snapshot();return {day:s.day,pop:s.population,firms:s.firms,audit:s.audit};})();
  return R;
})()
