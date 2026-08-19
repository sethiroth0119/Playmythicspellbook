(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, D = window.MythicDistricts,
        E = window.MythicEconomy, G = nc.game;
  const R = {}, K=(x,z)=>x+','+z;
  const done = () => { try { nc.build.finishAll('tenants'); } catch (e) {} };
  const place = async (t,x,z) => { try { await nc.place(t,x,z); } catch(e){} done(); return !!G.tiles[K(x,z)]; };
  const foodFirms = () => E.firms().filter(f => f.ind === 'restaurant');
  const rungs = (l) => l.reduce((a,f)=>(a[f.rung]=(a[f.rung]||0)+1,a),{});
  const meanIdle = (l) => l.length ? +(l.reduce((a,f)=>a+(f.idleForDemand||0),0)/l.length).toFixed(3) : null;
  const audit = () => { const a = E.snapshot().audit; return { ok:a.ok, err:a.err, day:a.day, tol:a.tol }; };

  /* ══ PHASE 0 — a city with people in it ══════════════════════════════════ */
  for (const n of P.tree.NODES) P._grant(n.id);
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r] = 900000; } catch(e){} }
  const C=12; let svc=0;
  for (let x=C-4;x<=C+4;x++) for (let z=C-4;z<=C+4;z++){
    if (G.tiles[K(x,z)]) continue;
    const m=(x+z)%5;
    const t = m===0?'foodtruck':m===1?'clinic':m===2?'purifier':m===3?'purifier':'garden';
    if (await place(t,x,z)) svc++;
  }
  R.p0 = { svcPlaced: svc, step: await nc.step(400,200) };
  R.p0.step2 = await nc.step(600,300);
  R.p0.pop = Math.round(nc.pop());
  R.p0.demogPop = window.MythicDemographics.population();
  R.p0.audit = audit();
  R.p0.foodFirmsAtStart = { n: foodFirms().length, rungs: rungs(foodFirms()), meanIdle: meanIdle(foodFirms()) };

  /* ══ PHASE 1 — a good lot attracts a better tenant than a bad one ════════ */
  const free = [];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]) continue;
    const road = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z,prem:Math.round(L.premiumAt(x,z)),val:L.valueAt(x,z),band:L.bandAt(x,z).id});
  }
  free.sort((a,b)=>b.prem-a.prem);
  const GOOD = free[0], BAD = free[free.length-1];
  Z.applyPaint(GOOD.x,GOOD.z,'c_low','c_food');
  Z.applyPaint(BAD.x,BAD.z,'c_low','c_food');
  nc.tenantObserve(true);
  const table = (p) => {
    const e = nc.tenantBids(p.x,p.z);
    if (!e||!e.ok) return {ok:false,why:e&&e.why};
    return { at:K(p.x,p.z), prem:p.prem, val:p.val, band:p.band,
             winner: e.winner?{name:e.winner.cand.name,size:e.winner.cand.size,type:e.winner.type,total:e.winner.total}:null,
             bidders: e.rows.length, bidding: e.rows.filter(r=>r.bids).length,
             rows: e.rows.slice(0,3).map(r=>({size:r.cand.size,type:r.type,total:r.total,
                    sum:+r.terms.reduce((a,t)=>a+t.v,0).toFixed(3),
                    t:Object.fromEntries(r.terms.map(t=>[t.key,t.v]))})) };
  };
  R.p1 = { good: table(GOOD), bad: table(BAD) };
  R.p1.notes = { sameZone:'c_low', sameSpec:'c_food',
                 goodWouldBuild: nc.districtAt(GOOD.x,GOOD.z).wouldBuild,
                 badWouldBuild: nc.districtAt(BAD.x,BAD.z).wouldBuild };
  R.p1.customersRow = { good: R.p1.good.rows && R.p1.good.rows[0] ? R.p1.good.rows[0].t : null,
                        bad: R.p1.bad.rows && R.p1.bad.rows[0] ? R.p1.bad.rows[0].t : null };
  R.p1.noteText = (()=>{ const e=nc.tenantBids(GOOD.x,GOOD.z); return e&&e.ok&&e.rows[0]?e.rows[0].terms.map(t=>t.key+': '+t.note):null; })();
  return R;
})()
