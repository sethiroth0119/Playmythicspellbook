(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, E = window.MythicEconomy, G = nc.game;
  const R = {}, K=(x,z)=>x+','+z;
  const done = () => { try { nc.build.finishAll('tenants'); } catch (e) {} };
  const place = async (t,x,z) => { try { await nc.place(t,x,z); } catch(e){} done(); return !!G.tiles[K(x,z)]; };
  const audit = () => { const a=E.snapshot().audit; return {ok:a.ok,err:a.err,day:a.day}; };
  const byOut = (out) => E.firms().filter(f=>f.out===out);
  const shot = (out) => { const l=byOut(out); return {
      n:l.length,
      rungs:l.reduce((a,f)=>(a[f.rung]=(a[f.rung]||0)+1,a),{}),
      meanIdle:l.length?+(l.reduce((a,f)=>a+(f.idleForDemand||0),0)/l.length).toFixed(3):null,
      meanCash:l.length?Math.round(l.reduce((a,f)=>a+f.cash,0)/l.length):null,
      meanRev:l.length?Math.round(l.reduce((a,f)=>a+(f.revenueAvg||0),0)/l.length):null,
      bottleneck:l.reduce((a,f)=>(a[(f.lastBottleneck&&f.lastBottleneck.key)||'none']=(a[(f.lastBottleneck&&f.lastBottleneck.key)||'none']||0)+1,a),{}),
      levels:l.reduce((a,f)=>(a['L'+f.level]=(a['L'+f.level]||0)+1,a),{}) }; };
  const settle = () => { nc.eco.sync(); nc.tenantObserve(true); };

  /* ══ 0. A CITY WITH PEOPLE, A CONSTRUCTION CO. AND A FULL LARDER ═════════ */
  for (const n of P.tree.NODES) P._grant(n.id);
  try { await nc.build.acquire('construction'); } catch(e){}
  await place('op_construction',2,2);
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r]=900000; } catch(e){} }
  let svc=0;
  for (let x=17;x<=22;x++) for (let z=17;z<=22;z++){
    if (G.tiles[K(x,z)]) continue;
    const m=(x+z)%3; const t = m===0?'foodtruck':m===1?'purifier':'garden';
    if (await place(t,x,z)) svc++;
  }
  await nc.step(400,200); await nc.step(400,200); settle();
  R.setup = { hasCo:nc.build.hasCo(), slots:nc.build.slots(), svc, pop:Math.round(nc.pop()),
              cov:Object.fromEntries(Object.entries(nc.game.cov.pct).map(([k,v])=>[k,+v.toFixed(2)])),
              audit:audit() };

  /* ══ 1. WHAT THE MARKET WANTS, LOT BY LOT ═══════════════════════════════ */
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z,prem:Math.round(L.premiumAt(x,z)),val:L.valueAt(x,z),band:L.bandAt(x,z).id});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low','c_food');
  settle();
  const bagOf = (p)=>{ const d=nc.districtAt(p.x,p.z); return d?d.afterLand:[]; };
  const ranked = free.map(p=>{ const w=T.winner(p.x,p.z,bagOf(p));
      return {...p, win:w?{t:w.type,size:w.cand.size.id,total:+w.total.toFixed(2),name:w.cand.name}:null}; });
  const bid = ranked.filter(p=>p.win).sort((a,b)=>b.win.total-a.win.total);
  const nob = ranked.filter(p=>!p.win);
  R.market = { plots:free.length, bidOn:bid.length, refused:nob.length,
    bySize: bid.reduce((a,p)=>(a[p.win.size]=(a[p.win.size]||0)+1,a),{}),
    byType: bid.reduce((a,p)=>(a[p.win.t]=(a[p.win.t]||0)+1,a),{}),
    best: bid.slice(0,3).map(p=>({at:K(p.x,p.z),band:p.band,val:p.val,...p.win})),
    worstBid: bid.slice(-3).map(p=>({at:K(p.x,p.z),band:p.band,val:p.val,...p.win})),
    refusedSample: nob.slice(0,2).map(p=>({at:K(p.x,p.z),band:p.band,val:p.val,
      why: T.refusal(p.x,p.z) })) };
  /* the A/B the brief asks for: a good lot and a bad one, same zone, same spec */
  const GOOD=bid[0], BAD=bid[bid.length-1];
  const tbl=(p)=>{const e=nc.tenantBids(p.x,p.z); if(!e||!e.ok) return {ok:false,why:e&&e.why};
    return {at:K(p.x,p.z),band:p.band,val:p.val,
      winner:e.winner?{name:e.winner.cand.name,size:e.winner.cand.size,type:e.winner.type,total:e.winner.total}:null,
      rows:e.rows.map(r=>({size:r.cand.size,type:r.type,total:r.total,bids:r.bids,
        sum:+r.terms.reduce((a,t)=>a+t.v,0).toFixed(3),
        t:Object.fromEntries(r.terms.map(t=>[t.key,t.v]))}))};};
  R.AB = { good: tbl(GOOD), bad: tbl(BAD) };

  /* ══ 2. THE CONTROL — four lots, and nothing else ═══════════════════════ */
  for (const p of free) Z.setZone(p.x,p.z,null);
  const CONTROL = bid.slice(0,4);
  for (const p of CONTROL) Z.applyPaint(p.x,p.z,'c_low','c_food');
  const dev = async () => { await Z.develop({toggle:true});
    for (let i=0;i<90;i++){ await Z.step(); done(); }
    Z.stopDevelop(); done(); settle();
    const pl=Z.plan(null); return {out:pl.out.length,grow:pl.grow.length,skip:pl.skip}; };
  R.devControl = await dev();
  R.controlLet = CONTROL.map(p=>{const t=G.tiles[K(p.x,p.z)];const te=nc.tenantAt(p.x,p.z);
    return {at:K(p.x,p.z),type:t?t.type:null,lvl:t?t.lvl:null,
            tenant:te?{name:te.name,size:te.size.id,bid:te.bid,rung:te.rung,firm:te.firm?te.firm.out:null}:null};});
  const OUT = (R.controlLet.find(b=>b.tenant&&b.tenant.firm)||{tenant:{}}).tenant.firm || 'preparedMeals';
  await nc.step(20*25,250); settle();
  R.afterControl = { out:OUT, firms:shot(OUT), tenants:{n:T.stats().tenancies,vacant:T.stats().vacant,
    byRung:T.stats().byRung,lifetime:T.stats().lifetime}, failures:T.failures().length, audit:audit() };
  /* a FRESH lot's bid in the un-saturated city — the before half of the A/B */
  const spare = free.filter(p=>!G.tiles[K(p.x,p.z)]);
  const PROBE = spare[0];
  Z.applyPaint(PROBE.x,PROBE.z,'c_low','c_food'); settle();
  R.probeBefore = tbl(PROBE);
  Z.setZone(PROBE.x,PROBE.z,null);
  R.failuresControl = T.failures().map(f=>({n:f.n,k:f.k,days:f.days,rung:f.rung,why:f.why}));

  /* ══ 3. NOW OVER-ZONE THE SAME TRADE ════════════════════════════════════ */
  const MORE = bid.slice(4, 4+22).filter(p=>!G.tiles[K(p.x,p.z)]);
  for (const p of MORE) Z.applyPaint(p.x,p.z,'c_low','c_food');
  R.overZone = { painted: MORE.length };
  R.devOver = await dev();
  R.builtOver = MORE.filter(p=>G.tiles[K(p.x,p.z)]).length;
  R.tenantsAfterBuild = { n:T.stats().tenancies, per:T.stats().per, bySize:T.stats().bySize };
  R.rightAfter = { bread: shot('bread'), meals: shot('preparedMeals') };
  await nc.step(20*30,300); settle();
  R.afterOver30 = { bread: shot('bread'), meals: shot('preparedMeals'),
    tenants:{n:T.stats().tenancies,vacant:T.stats().vacant,byRung:T.stats().byRung,lifetime:T.stats().lifetime} };
  await nc.step(20*40,400); settle();
  R.afterOver = { bread: shot('bread'), meals: shot('preparedMeals'),
    tenants:{n:T.stats().tenancies,vacant:T.stats().vacant,byRung:T.stats().byRung,
             byLevel:(()=>{const o={};const l=T._store().lets();for(const k in l)o['L'+l[k].lvl]=(o['L'+l[k].lvl]||0)+1;return o;})(),
             lifetime:T.stats().lifetime},
    failures:T.failures().length, audit:audit(),
    lastObserve: T.stats().lastObserve };
  R.failureLedger = T.failures().slice(-10).map(f=>({n:f.n,k:f.k,size:f.size,want:f.want,days:f.days,rung:f.rung,why:f.why}));

  /* the SAME probe lot, now that the trade is over-supplied */
  Z.applyPaint(PROBE.x,PROBE.z,'c_low','c_food'); settle();
  R.probeAfter = tbl(PROBE);
  R.probeRefusal = T.refusal(PROBE.x,PROBE.z);
  R.planNow = (()=>{const p=Z.plan(null);return {out:p.out.length,grow:p.grow.length,skip:p.skip};})();

  /* ══ 4. THE INVARIANTS ══════════════════════════════════════════════════ */
  R.verify = T.verify();
  R.overlay = { on: T.overlay(true), painted: T.overlayPainted(), visible: T.overlayOn() };
  R.levels = (()=>{ const l=T._store().lets(), out={}; const E2=window.MythicEconomy;
    const fm=new Map(); for(const f of E2.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
    let best=null;
    for(const k in l){ const f=fm.get(k); if(!f) continue; out['L'+f.level]=(out['L'+f.level]||0)+1;
      const c=E2.levelCheck(f.id); if(!best||(c.missing||[]).length<best.missing.length) best={k,name:l[k].n,missing:c.missing,ok:c.ok}; }
    return { firmLevels:out, closestToLevel2:best,
             seamAt: (()=>{ const k=Object.keys(l)[0]; if(!k) return null; const c=k.split(',');
                return { at:k, levelFor: T.levelFor(+c[0],+c[1]), ambition:l[k].size }; })() }; })();
  R.log = (()=>{ try { return window.MythicEconomy.log().slice(-12).map(e=>e.msg||e.text||JSON.stringify(e)); } catch(e){ return String(e); } })();
  const coll = window.MythicCitySave.collect();
  R.saveSlice = { keys: coll.tenants ? Object.keys(coll.tenants) : null,
                  lets: coll.tenants ? Object.keys(coll.tenants.let||{}).length : null,
                  fails: coll.tenants ? (coll.tenants.fail||[]).length : null,
                  salt: coll.tenants ? !!coll.tenants.salt : null };
  window.MythicCitySave.restore(coll);
  R.afterRestore = { n:T.stats().tenancies, failures:T.failures().length, salt:T.stats().salt===R.saveSlice.salt };
  R.afterRestore = { n:T.stats().tenancies, failures:T.failures().length };
  R.finalAudit = audit();
  R.pageErrors = null;
  return R;
})()
