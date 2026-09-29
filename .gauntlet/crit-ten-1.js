(async () => {
  const nc = window.__nc, T = window.MythicTenants, Z = window.MythicZoning,
        L = window.MythicLandValue, D = window.MythicDemographics, E = window.MythicEconomy, G = nc.game;
  const K = (x,z)=>x+','+z;
  const R = {};
  R.mounted = { tenants: !!(T&&T.ready&&T.ready()), zoning: !!Z, land: !!(L&&L.ready()),
                demog: !!(D&&D.ready&&D.ready()), eco: !!(E&&E.ready&&E.ready()) };
  R.pop = { demog: D&&D.population?D.population():null, ncPop: Math.round(nc.pop()) };

  // vacant road-fronting tiles
  const free = [];
  for (let x=0;x<24;x++) for (let z=0;z<24;z++){
    if (G.tiles[K(x,z)]||G.zones[K(x,z)]) continue;
    const road=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>{const t=G.tiles[K(x+dx,z+dz)];return t&&t.type==='road';});
    if (road) free.push({x,z});
  }
  R.freeRoadFront = free.length;
  for (const p of free) Z.applyPaint(p.x,p.z,'c_low',null);   // NO district spec — plain commercial
  try { T.observe(true); } catch(e){}

  const planStr = () => { const pl = Z.plan(null);
    return { str: pl.out.slice().sort((a,b)=>(a.x-b.x)||(a.z-b.z)).map(o=>K(o.x,o.z)+':'+o.type).join(' '),
             n: pl.out.length, skip: JSON.parse(JSON.stringify(pl.skip)) }; };

  const A = planStr();
  // the game's OWN hash re-derivation through the shipped filters
  const hash = {};
  for (const p of free) { const d = nc.districtAt(p.x,p.z); if (d) hash[K(p.x,p.z)] = d.wouldBuild; }
  R.withTenants = { n:A.n, skip:A.skip };

  // per-lot detail while the market is live
  const detail = free.slice(0,200).map(p=>{
    const d = nc.districtAt(p.x,p.z);
    const bag = d?d.afterLand:[];
    const w = T.winner(p.x,p.z,bag);
    const e = nc.tenantBids(p.x,p.z,bag);
    return { k:K(p.x,p.z), bag, hash: d?d.wouldBuild:null,
             win: w?{t:w.type,size:w.cand.size.id,name:w.cand.name,total:+w.total.toFixed(2)}:null,
             rows: (e&&e.ok)?e.rows.map(r=>({size:r.cand.size,type:r.type,total:r.total,bids:r.bids})):null };
  });
  R.sampleDetail = detail.slice(0,6);
  R.agreeWithHash = detail.filter(d=>d.win&&d.win.t===d.hash).length;
  R.differFromHash = detail.filter(d=>d.win&&d.win.t!==d.hash).length;
  R.noWinner = detail.filter(d=>!d.win).length;
  R.distinctBidderSizes = detail.map(d=>d.rows?new Set(d.rows.map(r=>r.size)).size:0);
  R.bidderRowsPerLot = detail.length?detail[0].rows.length:0;
  R.sizeOfWinner = detail.reduce((a,d)=>{if(d.win)a[d.win.size]=(a[d.win.size]||0)+1;return a;},{});
  R.winnerNames = [...new Set(detail.filter(d=>d.win).map(d=>d.win.name))];

  // ══ SHORT-CIRCUIT: a 404 on /src/tenants ═════════════════════════════
  const saved = window.MythicTenants;
  window.MythicTenants = null;
  const B = planStr();
  window.MythicTenants = saved;
  const C = planStr();                     // restore control

  R.without = { n:B.n, skip:B.skip };
  R.restored = { n:C.n, skip:C.skip, sameAsA: C.str===A.str };
  R.AvsB_identical = A.str===B.str;
  // is B exactly the hash?
  const bMap = {}; for (const s of B.str.split(' ')) { if(!s) continue; const i=s.lastIndexOf(':'); bMap[s.slice(0,i)]=s.slice(i+1); }
  let hashMatch=0, hashMiss=[];
  for (const k in bMap) { if (bMap[k]===hash[k]) hashMatch++; else hashMiss.push(k+' plan='+bMap[k]+' hash='+hash[k]); }
  R.hashProof = { planned: Object.keys(bMap).length, matchHash: hashMatch, misses: hashMiss.slice(0,8) };
  // how many plots the market moved
  const aMap = {}; for (const s of A.str.split(' ')) { if(!s) continue; const i=s.lastIndexOf(':'); aMap[s.slice(0,i)]=s.slice(i+1); }
  const moved=[], lostA=[], gainedA=[];
  for (const k in bMap) { if (!(k in aMap)) lostA.push(k+' hash='+bMap[k]); else if (aMap[k]!==bMap[k]) moved.push(k+' '+bMap[k]+'→'+aMap[k]); }
  for (const k in aMap) if (!(k in bMap)) gainedA.push(k);
  R.marketMoved = { changedType: moved.length, refusedByMarket: lostA.length, newlyAllowed: gainedA.length,
                    sampleChanged: moved.slice(0,10), sampleRefused: lostA.slice(0,6) };
  R.refusalSentence = lostA.length ? T.refusal(+lostA[0].split(',')[0], +lostA[0].split(',')[1].split(' ')[0]) : null;
  R.silentCheck = { maxNear: (()=>{try{return T._field().field().maxNear;}catch(e){return 'err';}})(),
                    maxVal: (()=>{try{return T._field().field().maxVal;}catch(e){return 'err';}})() };
  for (const p of free) Z.setZone(p.x,p.z,null);
  return R;
})()
