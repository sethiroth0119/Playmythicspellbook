(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, E = window.MythicEconomy, G = nc.game;
  const R = {}, K=(x,z)=>x+','+z;
  const done = () => { try { nc.build.finishAll('tenants'); } catch (e) {} };
  const place = async (t,x,z) => { try { await nc.place(t,x,z); } catch(e){} done(); return !!G.tiles[K(x,z)]; };
  const audit = () => { const a=E.snapshot().audit; return {ok:a.ok,err:a.err,day:a.day}; };
  const settle = () => { nc.eco.sync(); nc.tenantObserve(true); };
  const shot = (out) => { const l=E.firms().filter(f=>f.out===out); return {
      n:l.length, rungs:l.reduce((a,f)=>(a[f.rung]=(a[f.rung]||0)+1,a),{}),
      meanIdle:l.length?+(l.reduce((a,f)=>a+(f.idleForDemand||0),0)/l.length).toFixed(3):null,
      meanCash:l.length?Math.round(l.reduce((a,f)=>a+f.cash,0)/l.length):null,
      meanRevAvg:l.length?Math.round(l.reduce((a,f)=>a+(f.revenueAvg||0),0)/l.length):null,
      meanBad:l.length?+(l.reduce((a,f)=>a+(f.badDays||0),0)/l.length).toFixed(1):null,
      bottleneck:l.reduce((a,f)=>(a[(f.lastBottleneck&&f.lastBottleneck.key)||'none']=(a[(f.lastBottleneck&&f.lastBottleneck.key)||'none']||0)+1,a),{}) }; };
  const tstat = () => { const s=T.stats(); return {n:s.tenancies,vacant:s.vacant,byRung:s.byRung,bySize:s.bySize,lifetime:s.lifetime}; };
  const tbl=(x,z)=>{const e=nc.tenantBids(x,z); if(!e||!e.ok) return {ok:false,why:e&&e.why};
    return {at:K(x,z),val:L.valueAt(x,z),band:L.bandAt(x,z).id,
      winner:e.winner?{name:e.winner.cand.name,size:e.winner.cand.size,type:e.winner.type,total:e.winner.total}:null,
      rows:e.rows.map(r=>({size:r.cand.size,type:r.type,total:r.total,bids:r.bids,
        sum:+r.terms.reduce((a,t)=>a+t.v,0).toFixed(4),
        t:Object.fromEntries(r.terms.map(t=>[t.key,t.v]))}))};};

  /* ══ 0. A STABLE CITY ═══════════════════════════════════════════════════ */
  for (const n of P.tree.NODES) P._grant(n.id);
  try { await nc.build.acquire('construction'); } catch(e){}
  await place('op_construction',2,2);
  for (const r of ['rations','remedies','goods','water']) { try { G.stock[r]=900000; } catch(e){} }
  let svc=0;
  for (let x=16;x<=22;x++) for (let z=16;z<=22;z++){
    if (G.tiles[K(x,z)]) continue;
    const m=(x+z)%3; const t = m===2?'foodtruck':'purifier';
    if (await place(t,x,z)) svc++;
  }
  const grow=[];
  for (let i=0;i<6;i++){ const s=await nc.step(300,150); grow.push({pop:s.pop,water:+s.cov.water.toFixed(2),food:+s.cov.food.toFixed(2)}); if (i>1 && grow[i].pop===grow[i-1].pop) break; }
  settle();
  R.setup = { svcPlaced:svc, hasCo:nc.build.hasCo(), grow, pop:Math.round(nc.pop()),
              demogPop:window.MythicDemographics.population(), audit:audit() };

  /* ══ 1. THE MARKET OVER THE WHOLE BOARD ════════════════════════════════ */
  const free=[];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z,val:L.valueAt(x,z),band:L.bandAt(x,z).id});
  }
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low','c_food');
  settle();
  const bagOf=(p)=>{const d=nc.districtAt(p.x,p.z);return d?d.afterLand:[];};
  const ranked = free.map(p=>{const w=T.winner(p.x,p.z,bagOf(p));
    return {...p, win:w?{t:w.type,size:w.cand.size.id,total:+w.total.toFixed(2),name:w.cand.name}:null};});
  const bid = ranked.filter(p=>p.win).sort((a,b)=>b.win.total-a.win.total);
  const nob = ranked.filter(p=>!p.win);
  R.market = { plots:free.length, bidOn:bid.length, refusedOutright:nob.length,
    bySize:bid.reduce((a,p)=>(a[p.win.size]=(a[p.win.size]||0)+1,a),{}),
    sizeOfTop10:bid.slice(0,10).map(p=>p.win.size),
    sizeOfBottom10:bid.slice(-10).map(p=>p.win.size),
    meanValTopTen:Math.round(bid.slice(0,10).reduce((a,p)=>a+p.val,0)/10),
    meanValBottomTen:Math.round(bid.slice(-10).reduce((a,p)=>a+p.val,0)/10),
    refusalSentence: nob.length?T.refusal(nob[0].x,nob[0].z):null };
  R.AB = { good: tbl(bid[0].x,bid[0].z), bad: tbl(bid[bid.length-1].x,bid[bid.length-1].z) };

  /* ══ 2. THE CONTROL: five lots of one trade ════════════════════════════ */
  for (const p of free) Z.setZone(p.x,p.z,null);
  const CONTROL = bid.slice(0,5);
  for (const p of CONTROL) Z.applyPaint(p.x,p.z,'c_low','c_food');
  const dev = async () => { await Z.develop({toggle:true});
    for (let i=0;i<100;i++){ await Z.step(); done(); }
    Z.stopDevelop(); done(); settle();
    const pl=Z.plan(null); return {out:pl.out.length,grow:pl.grow.length,skip:pl.skip}; };
  R.devControl = await dev();
  R.controlLet = CONTROL.map(p=>{const t=G.tiles[K(p.x,p.z)];const te=nc.tenantAt(p.x,p.z);
    return {at:K(p.x,p.z),type:t?t.type:null,tenant:te&&!te.vacant?{name:te.name,size:te.size.id,bid:te.bid,out:te.firm?te.firm.out:null}:null};});
  R.liveControl = { tenants:tstat(), overlay:{on:T.overlay(true),painted:T.overlayPainted()},
    levelSeam:(()=>{const l=T._store().lets(); const k=Object.keys(l)[0]; if(!k)return null;
      const c=k.split(','); const fm=new Map(); for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
      const f=fm.get(k); return {at:k,name:l[k].n,size:l[k].size,firmLevel:f?f.level:null,
        levelFor:T.levelFor(+c[0],+c[1]),tileLvl:(G.tiles[k]||{}).lvl,
        gatesShort:f?(E.levelCheck(f.id).missing||[]).map(m=>m.label+' '+(Math.round(m.have*10)/10)+'/'+m.need):null};})(),
    verify:T.verify(), seed:(()=>{const l=T._store().lets(); const out=[];
      const fm=new Map(); for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
      for(const k in l){const f=fm.get(k); if(f) out.push({k,cash:Math.round(f.cash),want:Math.round(f.seedWant||0),short:Math.round(f.seedShort||0)});}
      return out;})(),
    econ:(()=>{const sn=E.snapshot();return {treasury:Math.round(sn.treasury),charter:Math.round(sn.charter),budget:Math.round(sn.foundingDrawBudget||0)};})() };
  const TR = R.controlLet.find(b=>b.tenant&&b.tenant.out);
  const OUT = TR?TR.tenant.out:'preparedMeals', TYPE = TR?TR.type:'foodtruck';
  R.trade = { out:OUT, type:TYPE };
  await nc.step(20*15,150); settle();
  R.afterControl = { trade:shot(OUT), tenants:tstat(), audit:audit(),
    vacancies: nc.tenantVacancies(),
    ledgerNow: T.failures().map(f=>({n:f.n,k:f.k,days:f.days,rung:f.rung,why:f.why})) };
  R.levelsControl = (()=>{ const l=T._store().lets(), out={}; let best=null,seam=null;
    const fm=new Map(); for(const f of E.firms()) if(f.tileKey) fm.set(String(f.tileKey),f);
    for (const k in l){ const f=fm.get(k); if(!f) continue; out['L'+f.level]=(out['L'+f.level]||0)+1;
      const c=E.levelCheck(f.id);
      if(!best||(c.missing||[]).length<best.missing.length) best={k,name:l[k].n,ok:c.ok,missing:(c.missing||[]).map(m=>m.label+' '+(Math.round(m.have*10)/10)+'/'+m.need)};
      const cc=k.split(','); if(!seam) seam={at:k,levelFor:T.levelFor(+cc[0],+cc[1]),firmLevel:f.level,ambition:l[k].size,tileLvl:(G.tiles[k]||{}).lvl}; }
    return {firmLevels:out,closest:best,seam}; })();
  const PROBE = free.find(p=>!G.tiles[K(p.x,p.z)] && !CONTROL.includes(p));
  Z.applyPaint(PROBE.x,PROBE.z,'c_low','c_food'); settle();
  R.probeBefore = tbl(PROBE.x,PROBE.z);
  Z.setZone(PROBE.x,PROBE.z,null);

  /* ══ 3. OVER-ZONE THE SAME TRADE ═══════════════════════════════════════ */
  const MORE = bid.slice(5,5+24).filter(p=>!G.tiles[K(p.x,p.z)]);
  for (const p of MORE) Z.applyPaint(p.x,p.z,'c_low','c_food');
  R.overZone = { painted:MORE.length };
  R.devOver = await dev();
  R.builtOver = MORE.filter(p=>G.tiles[K(p.x,p.z)]).length;
  R.rightAfterBuild = { trade:shot(OUT), tenants:tstat() };
  await nc.step(20*15,150); settle();
  R.afterOver = { trade:shot(OUT), tenants:tstat(), audit:audit(),
                  lastObserve:T.stats().lastObserve,
                  vacancies: nc.tenantVacancies().slice(0,6) };
  Z.applyPaint(PROBE.x,PROBE.z,'c_low','c_food'); settle();
  R.probeAfter = tbl(PROBE.x,PROBE.z);
  R.probeRefusal = T.refusal(PROBE.x,PROBE.z);
  /* THE SAME BOARD-WIDE QUESTION AS §1, ASKED AGAIN with the trade over-supplied */
  const free2 = free.filter(p=>!G.tiles[K(p.x,p.z)]);
  for (const p of free2) Z.applyPaint(p.x,p.z,'c_low','c_food');
  settle();
  const ranked2 = free2.map(p=>{const w=T.winner(p.x,p.z,bagOf(p));
    return {...p,win:w?{t:w.type,size:w.cand.size.id,total:+w.total.toFixed(2)}:null};});
  const bid2 = ranked2.filter(p=>p.win);
  R.marketAfter = { plots:free2.length, bidOn:bid2.length, refusedOutright:free2.length-bid2.length,
    bySize:bid2.reduce((a,p)=>(a[p.win.size]=(a[p.win.size]||0)+1,a),{}),
    sameLotsBefore:(()=>{const set=new Set(free2.map(p=>K(p.x,p.z)));
      return {bidOnBefore:bid.filter(p=>set.has(K(p.x,p.z))).length, of:free2.length};})() };
  for (const p of free2) Z.setZone(p.x,p.z,null);

  /* ══ 4. THE LEDGER, with a diagnosis per row ═══════════════════════════ */
  const fmap = new Map(); for (const f of E.firms()) if (f.tileKey) fmap.set(String(f.tileKey), f);
  R.ledger = T.failures().slice(-12).map(f=>{ const t=G.tiles[f.k];
    return {n:f.n,k:f.k,size:f.size,want:f.want,days:f.days,rung:f.rung,why:f.why,
            tileNow:t?{type:t.type,damaged:!!t.damaged,site:!!(t.bld&&(t.bld.k|0)===0)}:null,
            firmNow:fmap.has(f.k)?{id:fmap.get(f.k).id,rung:fmap.get(f.k).rung,bad:fmap.get(f.k).badDays}:null};});
  R.ecoLog = E.log().slice(-14).map(e=>e.msg||e.text||JSON.stringify(e));

  /* ══ 5. LEVELS — the success half ═════════════════════════════════════ */
  R.levels = (()=>{ const l=T._store().lets(), out={}; let best=null, seam=null;
    for (const k in l){ const f=fmap.get(k); if(!f) continue;
      out['L'+f.level]=(out['L'+f.level]||0)+1;
      const c=E.levelCheck(f.id);
      if(!best||(c.missing||[]).length<best.missing.length) best={k,name:l[k].n,ok:c.ok,missing:(c.missing||[]).map(m=>m.label+' '+(Math.round(m.have*10)/10)+'/'+m.need)};
      const cc=k.split(','); if(!seam) seam={at:k,levelFor:T.levelFor(+cc[0],+cc[1]),firmLevel:f.level,ambition:l[k].size,tileLvl:(G.tiles[k]||{}).lvl};
    }
    return {firmLevels:out, closest:best, seam}; })();

  /* ══ 6. INVARIANTS ════════════════════════════════════════════════════ */
  R.verify = T.verify();
  R.overlay = { on:T.overlay(true), painted:T.overlayPainted(), visible:T.overlayOn() };
  const coll = window.MythicCitySave.collect();
  R.save = { keys:coll.tenants?Object.keys(coll.tenants):null, lets:coll.tenants?Object.keys(coll.tenants.let||{}).length:null,
             fails:coll.tenants?(coll.tenants.fail||[]).length:null };
  const beforeR = tstat();
  window.MythicCitySave.restore(coll);
  R.saveRoundTrip = { before:beforeR, after:tstat(), same:JSON.stringify(beforeR)===JSON.stringify(tstat()) };
  R.omitted = T.omitted().map(o=>o.id);
  R.finalAudit = audit();
  return R;
})()
