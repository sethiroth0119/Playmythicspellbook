(async () => {
  const B = window.MythicBroadcast, g = window.__nc.game;
  const o = {}; let seen = new Set();
  const brief = ps => ps.map(p=>({k:p.kind,n:p.poster.name,sub:p.poster.sub,s:p.shown,a:p.affected,u:p.subject,pole:p.pole,b:p.body,w:p.source.why}));
  const mark = () => { seen = new Set(B.posts({limit:300}).map(p=>p.id)); };
  const fresh = () => B.posts({limit:300}).filter(p=>!seen.has(p.id));
  const step = async () => { await new Promise(r=>setTimeout(r,300)); B.tick(9); };
  for (let i=0;i<10;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }

  // ── A. COMPANY POST first, before any city mutation
  try {
    const dep = Object.keys(g.tiles).find(k=>g.tiles[k] && g.tiles[k].type==='depot');
    o.depot = { key:dep, named: window.MythicNaming.nameFor(dep) };
    g.log.push({t:Date.now(),k:'city',m:'🏗 '+g.tiles[dep].type+' at '+dep+' finished construction.'});
    mark(); await step(); o.company = brief(fresh());
  } catch(e){ o.companyErr = e.message; }
  // ── B. LIFE PATH: really lay somebody off
  try {
    const vic = window.MythicCitizens.list().find(c=>c.job);
    o.victim = { name:vic.name, job:vic.job, employer: window.MythicNaming.nameFor(vic.job) };
    mark(); await step();
    window.MythicCitizens.setJob(vic.id, null);
    mark(); await step(); o.lifepath = brief(fresh());
  } catch(e){ o.lifeErr = e.message; }
  // ── C. LIKES vs POPULATION at a fixed 90% food shortfall
  o.like = [];
  for (const pop of [8, 120, 1200]) {
    try { g.pop.npc = pop; g.cov.pct.food = 0.10; mark(); await step();
      o.like.push({ pop, made: brief(fresh().filter(p=>p.subject==='food')) }); }
    catch(e){ o.like.push({pop, err:e.message}); }
  }
  // ── D. LIKES vs SEVERITY at pop 1200
  o.sev = [];
  for (const c of [0.10, 0.50, 0.90, 1.0]) {
    try { g.pop.npc = 1200; g.cov.pct.food = c; mark(); await step();
      o.sev.push({ cov:c, made: brief(fresh().filter(p=>p.subject==='food')) }); }
    catch(e){ o.sev.push({cov:c, err:e.message}); }
  }
  try { g.pop.npc = 8; } catch(e){}
  o.byKind = B.stats().byKind;
  o.subjects = [...new Set(B.posts({limit:400}).map(p=>p.subject))];
  o.posters = [...new Set(B.posts({limit:400}).map(p=>p.kind+'::'+p.poster.name))];
  // ── E. FRESHNESS
  const all = B.posts({limit:400}); const bodies = all.map(p=>p.body);
  const dup={}; bodies.forEach(b=>dup[b]=(dup[b]||0)+1);
  const core=b=>b.replace(/^[^a-zA-Z#]*/,'').split(/[.!—]/)[0].trim().toLowerCase();
  const cd={}; bodies.forEach(b=>{const c=core(b);cd[c]=(cd[c]||0)+1;});
  o.freshness = { n:bodies.length, distinct:new Set(bodies).size,
    verbatimRepeats: Object.entries(dup).filter(([,c])=>c>1).map(([b,c])=>[c,b]),
    coreCollisions: Object.entries(cd).filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([b,c])=>[c,b]) };
  // ── F. LIKE TOGGLE
  try {
    const t = all[0];
    const L=B.like(t.id), U=B.like(t.id), R=B.like(t.id);
    o.likeToggle={id:t.id, base:{likes:t.likes,shown:t.shown,mine:t.mine},
      liked:{likes:L.likes,shown:L.shown,mine:L.mine},
      unliked:{likes:U.likes,shown:U.shown,mine:U.mine},
      relike:{likes:R.likes,shown:R.shown,mine:R.mine},
      subject:t.subject, following:B.following()};
  } catch(e){ o.likeErr=e.message; }
  // ── G. SAVE ROUND TRIP
  try {
    const blob=B.save(); o.saveType=typeof blob;
    const wire=JSON.stringify(blob); o.saveBytes=wire.length;
    const n0=B.count(), u0=B.unread(), lid=o.likeToggle.id;
    B.load(JSON.parse(wire));
    const p0=B.posts({limit:1})[0];
    o.roundTrip={countBefore:n0,countAfter:B.count(),unreadBefore:u0,unreadAfter:B.unread(),
      mineSurvived:B.post(lid)?B.post(lid).mine:'post gone',
      followingAfter:B.following(), topBody:p0&&p0.body, topClock:p0&&p0.clock,
      topWhy:p0&&p0.source&&p0.source.why, topShown:p0&&p0.shown};
  } catch(e){ o.saveErr=e.message; }
  // ── H. OLD / BAD SAVES
  o.oldSave=[];
  for (const bad of [null,{},{v:1,p:[]},{p:[{b:'legacy body',n:'Old Poster'}]},{p:'nope'},{p:[null,3,'x']},'str',42]) {
    try { B.load(bad); const f=B.posts({limit:1})[0];
      o.oldSave.push({in:JSON.stringify(bad),ok:true,n:B.count(),body:f&&f.body,clock:f&&f.clock,kind:f&&f.kind,hue:f&&f.poster.avatar.hue}); }
    catch(e){ o.oldSave.push({in:JSON.stringify(bad),ok:false,err:e.message}); }
  }
  // ── I. EMPTY CASE
  B.reset();
  o.empty={count:B.count(),posts:B.posts({limit:5}).length,unread:B.unread(),unreadFollowed:B.unreadFollowed(),
    subjects:B.subjects().length,depts:B.depts().length,
    saveOk:(()=>{try{return JSON.stringify(B.save()).length}catch(e){return e.message}})()};
  return o;
})()
