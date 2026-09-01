(async () => {
  const B = window.MythicBroadcast, g = window.__nc.game;
  const o = {}; let seen = new Set();
  const brief = ps => ps.map(p=>({k:p.kind,n:p.poster.name,sub:p.poster.sub,s:p.shown,a:p.affected,u:p.subject,pole:p.pole,b:p.body,w:p.source.why}));
  const mark = () => { seen = new Set(B.posts({limit:200}).map(p=>p.id)); };
  const fresh = () => B.posts({limit:200}).filter(p=>!seen.has(p.id));
  // fill
  for (let i=0;i<10;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }

  // ── LIKE MEASUREMENT: same 90% food shortfall, three real city sizes
  o.like = [];
  for (const pop of [8, 120, 1200]) {
    g.pop.npc = pop; g.cov.pct.food = 0.10;
    mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9);
    o.like.push({ pop, cov:0.10, made: brief(fresh().filter(p=>p.subject==='food')) });
  }
  // ── ...and the same city size at three real severities
  o.sev = [];
  for (const c of [0.10, 0.50, 0.90]) {
    g.pop.npc = 1200; g.cov.pct.food = c;
    mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9);
    o.sev.push({ pop:1200, cov:c, made: brief(fresh().filter(p=>p.subject==='food')) });
  }
  // ── FIX IT: full coverage, big city. bad-pole food must stop, good may start
  g.pop.npc = 1200; g.cov.pct.food = 1.0;
  mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9);
  o.fixed = brief(fresh().filter(p=>p.subject==='food'));
  g.pop.npc = 8;

  // ── COMPANY POST through the real bldSweep log string
  const dep = Object.keys(g.tiles).find(k=>g.tiles[k] && g.tiles[k].type==='depot');
  o.depot = { key:dep, type:g.tiles[dep].type, named: window.MythicNaming.nameFor(dep),
              addr: window.MythicNaming.address ? window.MythicNaming.address(dep) : null };
  g.log.push({t:Date.now(),k:'city',m:'🏗 '+g.tiles[dep].type+' at '+dep+' finished construction.'});
  mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9);
  o.company = brief(fresh());

  // ── LIFE PATH: really lay somebody off
  const r0 = window.MythicCitizens.list();
  const vic = r0.find(c=>c.job);
  o.victim = { name:vic.name, job:vic.job, jobNamed: window.MythicNaming.nameFor(vic.job) };
  mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9); // baseline snapshot
  window.MythicCitizens.setJob(vic.id, null);
  mark(); await new Promise(r=>setTimeout(r,300)); B.tick(9);
  o.lifepath = brief(fresh());

  // ── ALL POSTER TYPES seen so far
  o.byKind = B.stats().byKind;
  o.allSubjects = [...new Set(B.posts({limit:300}).map(p=>p.subject))];
  o.allPosters = [...new Set(B.posts({limit:300}).map(p=>p.kind+'::'+p.poster.name))];

  // ── FRESHNESS on the full corpus
  const all = B.posts({limit:300});
  const bodies = all.map(p=>p.body);
  const dup = {}; bodies.forEach(b=>dup[b]=(dup[b]||0)+1);
  o.fresh = { n: bodies.length, distinct: new Set(bodies).size,
              repeats: Object.entries(dup).filter(([,c])=>c>1) };
  // template tell: strip tails/openers and count core-sentence collisions
  const core = b => b.replace(/^[^a-zA-Z#]*/,'').split(/[.!—]/)[0].trim().toLowerCase();
  const cd={}; bodies.forEach(b=>{const c=core(b); cd[c]=(cd[c]||0)+1;});
  o.fresh.coreCollisions = Object.entries(cd).filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]).slice(0,12);

  // ── LIKE TOGGLE + persistence
  const target = all[0];
  const before = { likes: target.likes, shown: target.shown, mine: target.mine };
  const afterLike = B.like(target.id);
  const afterUnlike = B.like(target.id);
  const afterRelike = B.like(target.id);
  o.likeToggle = { id: target.id, before,
    liked: { likes: afterLike.likes, shown: afterLike.shown, mine: afterLike.mine },
    unliked:{ likes: afterUnlike.likes, shown: afterUnlike.shown, mine: afterUnlike.mine },
    relike: { likes: afterRelike.likes, shown: afterRelike.shown, mine: afterRelike.mine },
    following: B.following ? B.following() : null };

  // ── SAVE ROUND TRIP
  const blob = B.save();
  o.saveType = typeof blob;
  const wire = JSON.stringify(blob);
  o.saveBytes = wire.length;
  const n0 = B.count(), u0 = B.unread();
  B.load(JSON.parse(wire));
  const p0 = B.posts({limit:1})[0];
  o.roundTrip = { countBefore:n0, countAfter:B.count(), unreadBefore:u0, unreadAfter:B.unread(),
                  mineSurvived: p0 && B.post(o.likeToggle.id) ? B.post(o.likeToggle.id).mine : null,
                  topBody: p0 && p0.body, topClock: p0 && p0.clock, topWhy: p0 && p0.source && p0.source.why };
  // ── OLD SAVE (no new fields) and garbage
  const errs = [];
  for (const bad of [null, {}, {v:1,p:[]}, {p:[{b:'old post',n:'Someone'}]}, {p:'nope'}, {p:[null,3,'x']}, 'string', 42]) {
    try { B.load(bad); errs.push({in: JSON.stringify(bad)&&JSON.stringify(bad).slice(0,40), ok:true, n:B.count(), first: B.posts({limit:1})[0]||null }); }
    catch(e){ errs.push({in: String(bad).slice(0,40), ok:false, err:e.message}); }
  }
  o.oldSave = errs.map(e=>({in:e.in, ok:e.ok, n:e.n, body:e.first&&e.first.body, clock:e.first&&e.first.clock, err:e.err}));
  // ── EMPTY CASE
  B.reset();
  o.empty = { count:B.count(), posts:B.posts({limit:5}).length, unread:B.unread(), stats:B.stats().posts,
              saveOk:(()=>{try{JSON.stringify(B.save());return true}catch(e){return e.message}})() };
  return o;
})()
