(async () => {
  const B = window.MythicBroadcast, g = window.__nc.game;
  const o = {};
  const brief = ps => ps.map(p=>({k:p.kind,n:p.poster.name,s:p.shown,a:p.affected,u:p.subject,b:p.body.slice(0,90),w:p.source.why}));
  for (let i=0;i<14;i++){ B.tick(9); await new Promise(r=>setTimeout(r,260)); }

  // ── 1. ROSTER TRUTH
  const roster = window.MythicCitizens.list();
  o.rosterN = roster.length;
  o.roster = roster.map(c=>({id:c.id,name:c.name,job:c.job,mood:Math.round(c.mood)}));
  const names = new Set(roster.map(c=>c.name));
  const cps = B.posts({limit:80}).filter(p=>p.kind==='citizen');
  o.citizenNamesInFeed = [...new Set(cps.map(p=>p.poster.name))];
  o.citizenNamesNotInRoster = o.citizenNamesInFeed.filter(n=>!names.has(n));

  // ── 2. THE WATER CONTRADICTION
  o.covWater = g.cov.pct.water;
  o.waterSupply = window.MythicWater.supply();
  o.waterPosts = brief(B.posts({subject:'water',limit:5}));

  // ── 3. LIKE MEASUREMENT — change the city for real and watch the number move
  o.likeTest = {};
  const popBefore = g.pop.npc;
  // (a) baseline: force a food shortage at the CURRENT population
  g.cov.pct.food = 0.10;
  let made = B._pass();
  o.likeTest.smallCity = { pop: popBefore, cov: 0.10,
    posts: brief(made.filter(p=>p.subject==='food')) };
  // (b) same shortage, 50x the people. affected must scale, likes must rise.
  g.pop.npc = 400;
  g.cov.pct.food = 0.10;
  await new Promise(r=>setTimeout(r,300)); B.tick(9);
  made = B._pass();
  o.likeTest.bigCity = { pop: 400, cov: 0.10,
    posts: brief(made.filter(p=>p.subject==='food')) };
  // (c) FIX it: full coverage at the big population. bad-pole food must stop.
  g.cov.pct.food = 1.0;
  await new Promise(r=>setTimeout(r,300)); B.tick(9);
  made = B._pass();
  o.likeTest.fixed = { pop: 400, cov: 1.0, posts: brief(made.filter(p=>p.subject==='food')) };
  // (d) a MILD shortage at the big population: fewer affected, fewer likes
  g.cov.pct.food = 0.85;
  await new Promise(r=>setTimeout(r,300)); B.tick(9);
  made = B._pass();
  o.likeTest.mild = { pop: 400, cov: 0.85, posts: brief(made.filter(p=>p.subject==='food')) };
  g.pop.npc = popBefore;
  o.curve = [1,4,9,40,120,400,2000].map(n=>[n, B.likesFor(n,'x'+n)]);

  // ── 4. COMPANY POST via the real log line bldSweep emits
  const keys = Object.keys(g.tiles);
  const shopKey = keys.find(k => { const t=g.tiles[k]; return t && /shop|depot|farm|market/i.test(String(t.type)); });
  o.shopKey = shopKey; o.shopType = shopKey ? g.tiles[shopKey].type : null;
  o.namedAs = shopKey && window.MythicNaming ? window.MythicNaming.nameFor(shopKey) : null;
  if (shopKey) {
    g.log.push({ t: Date.now(), k:'city', m: '🏗 ' + g.tiles[shopKey].type + ' at ' + shopKey + ' finished construction.' });
    await new Promise(r=>setTimeout(r,300)); B.tick(9);
    o.companyPosts = brief(B._pass().filter(p=>p.kind==='company'));
  }
  // ── 5. LIFE PATH via roster diff
  if (roster.length) {
    const withJob = roster.find(c=>c.job);
    o.laidOff = { who: withJob && withJob.name, job: withJob && withJob.job };
    if (withJob) {
      window.MythicCitizens.setJob(withJob.id, null);
      await new Promise(r=>setTimeout(r,300)); B.tick(9);
      o.lifePosts = brief(B._pass());
    }
  }
  o.byKindNow = B.stats().byKind;
  return o;
})()
