(async () => {
  const nc = window.__nc, D = window.MythicDistricts, Z = window.MythicZoning,
        P = window.MythicProgress, L = window.MythicLandValue, G = nc.game;
  const R = {}, K=(x,z)=>x+','+z;
  R.districtVerifyAtBoot_problems = nc.districtVerify().problems;
  R.districtVerifyAtBoot_held = nc.districtVerify().researchHeld;

  /* ══ THE SAVE EXPLOIT: does a hand-edited districts slice buy the tree? ══ */
  const before = P.state();
  window.MythicCitySave.restore({ v:1, districts:{ v:1, spec:{ '3,3':'c_mythent','4,4':'i_cards','5,5':'o_corp' } } });
  const adopted = P.afterLoad();
  const after = P.state();
  R.saveExploit = {
    unlockedBefore: before.unlocked.length, grantedBefore: before.granted.length, specsBefore: before.specs,
    adopted, specsAfter: after.specs,
    grantedNodesGained: after.granted.filter(n=>!before.granted.includes(n)),
    pointsBefore: before.points, pointsAfter: after.points,
  };
  /* and now: is that save-installed locked spec ACTED ON by typeFor? reset first */
  window.MythicCitySave.restore({ v:1, districts:{ v:1, spec:{} } });

  /* grant everything so the ladder is not reporting a research gap */
  for (const n of P.tree.NODES) P._grant(n.id);

  /* ══ 1. GENERALITY — every (zone, spec, band), through the module's OWN
        mixFor and the LIVE band ladder. filterMix is exactly
        ids.filter(t => band.tenants.all.includes(t)), so substituting the band
        for bandAt() is the model, not a re-derivation. Cross-checked against
        nc.districtAt() on real tiles below. ══ */
  const bands = L.bands().map(b=>({id:b.id, all:b.tenants.all.slice()}));
  const SP = 2, SZ = 2;                       // scratch tile, far from the scene
  const pick=(bag,x,z)=>{ if(!bag.length) return null;
    const h=(Math.imul(x|0,0x27d4eb2d)^Math.imul(z|0,0x165667b1)^0x7f4a7c15)>>>0; return bag[h%bag.length]; };
  const msOf=a=>{const m={};for(const t of a)m[t]=(m[t]||0)+1;return JSON.stringify(Object.keys(m).sort().map(k=>[k,m[k]]));};
  const table=[]; const tally={real:0,perm:0,noop:0,refuse:0,dead:0}; const rollup={};
  for (const s of D.SPECS) {
    for (const zd of Z.ZONES.filter(z=>z.cat===s.cat)) {
      let base=[]; for (const [t,w] of (zd.mix||[])) for(let i=0;i<w;i++) base.push(t);
      Z.applyPaint(SP,SZ,zd.id,s.id);
      const got = D.specAt(SP,SZ);
      const afterSpec = D.mixFor(SP,SZ,zd.id,base);
      const lvl = D.levelFor(SP,SZ,zd.id);
      const rowKey = s.id+'/'+zd.id; rollup[rowKey]=[];
      for (const b of bands) {
        const zb = base.filter(t=>b.all.includes(t));
        const sb = afterSpec.filter(t=>b.all.includes(t));
        let v;
        if(!zb.length&&!sb.length) v='dead';
        else if(!sb.length) v='refuse';
        else if(msOf(zb)===msOf(sb)) v=(JSON.stringify(zb)===JSON.stringify(sb))?'noop':'perm';
        else v='real';
        // how many of 576 tiles would actually build something different
        let diff=0; for(let x=0;x<24;x++)for(let q=0;q<24;q++) if(pick(zb,x,q)!==pick(sb,x,q)) diff++;
        tally[v]++; rollup[rowKey].push(v);
        table.push([s.id,zd.id,b.id,v,diff,'Z['+zb.join(' ')+'] S['+sb.join(' ')+']']);
      }
      rollup[rowKey]={verdicts:rollup[rowKey], armedOK:got===s.id, lvlOverride:lvl, zoneLvl:zd.lvl|0};
    }
  }
  Z.applyPaint(SP,SZ,null,null);
  R.generality = { tally, rollup };
  R.generalityTable = table.map(r=>r.join(' | '));

  /* ══ 2. o_tech ON o_low — the pair with zero effective bands ══ */
  R.oTech = (()=>{
    let base=[]; for(const[t,w]of Z.ZONE_BY_ID.o_low.mix) for(let i=0;i<w;i++) base.push(t);
    Z.applyPaint(2,3,'o_low','o_tech'); Z.applyPaint(2,4,'o_low',null);
    const a=D.mixFor(2,3,'o_low',base), b=D.mixFor(2,4,'o_low',base);
    const out={ specialised:a, plain:b, identical:JSON.stringify(a)===JSON.stringify(b),
      lvlSpec:D.levelFor(2,3,'o_low'), lvlPlain:D.levelFor(2,4,'o_low'),
      perBand: bands.map(bd=>({band:bd.id, z:base.filter(t=>bd.all.includes(t)), s:a.filter(t=>bd.all.includes(t))})) };
    Z.applyPaint(2,3,null,null); Z.applyPaint(2,4,null,null);
    return out;
  })();

  /* ══ 3. CROSS-CHECK the substitution against nc.districtAt on REAL tiles ══ */
  const xc=[];
  for (const [x,z] of [[2,2],[2,3],[13,13],[9,9]]) {
    Z.applyPaint(x,z,'c_low','c_retail');
    const da = nc.districtAt(x,z);
    const bd = bands.find(b=>b.id===da.band);
    let base=[]; for(const[t,w]of Z.ZONE_BY_ID.c_low.mix) for(let i=0;i<w;i++) base.push(t);
    const mine = D.mixFor(x,z,'c_low',base).filter(t=>bd.all.includes(t));
    xc.push({x,z,band:da.band, districtAt_afterLand:da.afterLand, mine:[...new Set(mine)], agree:JSON.stringify(da.afterLand)===JSON.stringify([...new Set(mine)])});
    Z.applyPaint(x,z,null,null);
  }
  R.crosscheck = xc;
  return R;
})()
