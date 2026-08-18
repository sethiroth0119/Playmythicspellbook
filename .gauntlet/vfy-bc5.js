(async () => {
  const B = window.MythicBroadcast, g = window.__nc.game, o = {};
  // run the city HARD so the economy actually moves
  try { __nc.step(45,90); } catch(e){ o.stepErr = e.message; }
  for (let i=0;i<22;i++){ B.tick(9); await new Promise(r=>setTimeout(r,240)); }
  const all = B.posts({limit:400});
  o.byKind = B.stats().byKind;
  o.bySubject = {}; all.forEach(p=>o.bySubject[p.subject]=(o.bySubject[p.subject]||0)+1);
  o.marketish = all.filter(p=>['market','crash','trade','stock'].includes(p.subject))
                   .map(p=>({s:p.shown,a:p.affected,u:p.subject,n:p.poster.name,b:p.body,w:p.source.why}));
  // ── health traceability: force a real coverage gap and read both sides
  g.cov.pct.health = 0.20; g.pop.npc = 500;
  await new Promise(r=>setTimeout(r,300)); const before=new Set(B.posts({limit:400}).map(p=>p.id));
  B.tick(9);
  o.health = { cov: g.cov.pct.health, pop: g.pop.npc,
    posts: B.posts({limit:400}).filter(p=>!before.has(p.id)&&p.subject==='health')
      .map(p=>({s:p.shown,a:p.affected,n:p.poster.name,k:p.kind,b:p.body,w:p.source.why})) };
  // ── the RAIN claim vs the weather the game actually has
  o.weather = { wx: g.wx || null, WEATHER: (window.WEATHER||null),
    rainPosts: all.filter(p=>/rain/i.test(p.body)).map(p=>({b:p.body,u:p.subject,src:p.source.src,w:p.source.why})) };
  // ── econ snapshot for cross-check
  try { const s = MythicEconomy.snapshot(); o.econ={unemployment:s.unemployment,laborForce:s.laborForce,vacancies:s.vacancies,firms:s.firms,bankrupt:s.bankrupt,trade:s.trade}; } catch(e){o.econErr=e.message;}
  try { o.movers = MythicEconomy.movers(6); } catch(e){ o.moversErr=e.message; }
  // ── the JOBS claim vs the vacancies the economy reports
  o.jobsPosts = all.filter(p=>p.subject==='jobs').slice(0,6).map(p=>({s:p.shown,a:p.affected,b:p.body,w:p.source.why}));
  return o;
})()
