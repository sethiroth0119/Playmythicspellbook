(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, D = window.MythicDistricts,
        E = window.MythicEconomy, G = nc.game;
  const R = {}, K = (x,z) => x+','+z;
  const done = () => { try { nc.build.finishAll('tenants driver'); } catch (e) {} };
  const place = async (t,x,z) => { try { await nc.place(t,x,z); } catch(e){} done(); return !!G.tiles[K(x,z)]; };

  R.mounted = { tenants: !!(T && T.ready()), districts: !!(D && D.ready()), land: !!(L && L.ready()),
                eco: !!(E && E.ready()), demog: !!(window.MythicDemographics && window.MythicDemographics.ready()) };
  if (!R.mounted.tenants) return R;
  R.verifyAtBoot = T.verify();
  R.radius = T.radius();
  R.omitted = T.omitted().map(o => o.id);
  R.sources = Object.keys(T.sources());

  for (const n of P.tree.NODES) P._grant(n.id);

  /* amenity core so the band ladder is not flat */
  const C = 12; let core = 0;
  for (let x=C-3;x<=C+3;x++) for (let z=C-3;z<=C+3;z++){
    if (G.tiles[K(x,z)]) continue;
    const t = ((x+z)%4===0)?'foodtruck':((x+z)%4===1)?'motorpool':((x+z)%4===2)?'fountain':'garden';
    if (await place(t,x,z)) core++;
  }
  R.core = core;
  try { nc.tenantObserve(true); } catch(e){}

  /* every free road-fronted plot, best and worst */
  const plots = [];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]) continue;
    const road = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) plots.push({x,z,prem:Math.round(L.premiumAt(x,z)),val:L.valueAt(x,z),band:L.bandAt(x,z).id});
  }
  plots.sort((a,b)=>b.prem-a.prem);
  R.plots = { n: plots.length, best: plots[0], worst: plots[plots.length-1] };

  /* the bid table on the best and the worst plot, same zone + spec */
  const A = plots[0], B = plots[plots.length-1];
  for (const p of [A,B]) Z.applyPaint(p.x,p.z,'c_low','c_food');
  const bid = (p) => {
    const e = nc.tenantBids(p.x,p.z);
    if (!e || !e.ok) return { ok:false, why:e && e.why };
    const rows = e.rows.slice(0,4).map(r=>({
      name:r.cand.name, size:r.cand.size, type:r.type, total:r.total, bids:r.bids,
      sum:+r.terms.reduce((a,t)=>a+t.v,0).toFixed(3),
      terms:r.terms.map(t=>t.key+'='+t.v)
    }));
    return { ok:true, at:K(p.x,p.z), prem:p.prem, val:p.val, band:p.band,
             winner: e.winner ? { name:e.winner.cand.name, size:e.winner.cand.size, type:e.winner.type, total:e.winner.total } : null,
             rows };
  };
  R.bidBest = bid(A);
  R.bidWorst = bid(B);
  R.notes = { firstTermsBest: R.bidBest.ok ? R.bidBest.rows[0].terms : null };
  return R;
})()
