(async () => {
  const B = window.MythicBroadcast;
  const out = { ready: !!(B && B.ready && B.ready()) };
  if (!out.ready) return out;
  // fill the feed through the shipped tick path
  for (let i = 0; i < 20; i++) {
    try { B.tick(9); } catch(e) { out.tickerr = e.message; }
    await new Promise(r => setTimeout(r, 260));
  }
  out.stats = B.stats();
  out.variants = { total: B.variants().total, voices: B.variants().voices };
  out.selfcheck14 = B.likeSelfCheck(1.4);
  out.selfcheck12 = B.likeSelfCheck(1.2);
  const ps = B.posts({ limit: 60 });
  out.n = ps.length;
  out.posts = ps.map(p => ({ id:p.id, clock:p.clock, kind:p.kind, name:p.poster.name,
    sub:p.poster.sub, shown:p.shown, likes:p.likes, aff:p.affected, subj:p.subject,
    sev:+(p.severity||0).toFixed(2), pole:p.pole, body:p.body, src:p.source.src, why:p.source.why }));
  // ── GROUND TRUTH from the city itself
  const g = window.__nc && __nc.game;
  out.truth = {};
  try { out.truth.pop = __nc.cityPop ? __nc.cityPop() : (g.pop||null); } catch(e){ out.truth.popErr = e.message; }
  try { out.truth.cov = JSON.parse(JSON.stringify(g.cov && g.cov.pct)); } catch(e){ out.truth.covErr = e.message; }
  try { out.truth.power = window.MythicPower ? window.MythicPower.supply() : null; } catch(e){ out.truth.powErr=e.message; }
  try { out.truth.water = window.MythicWater ? window.MythicWater.supply() : null; } catch(e){ out.truth.watErr=e.message; }
  try { out.truth.pollution = window.MythicPollution ? { exposure: MythicPollution.exposure(), air: MythicPollution.state().airAtPeople } : null; } catch(e){}
  try { const r = MythicDemographics.report(); out.truth.demog = { netPerDay:r.netPerDay, flow:r.flow }; } catch(e){}
  try { const s = MythicEconomy.snapshot(); out.truth.econ = { unemployment:s.unemployment, laborForce:s.laborForce, vacancies:s.vacancies, firms:s.firms, bankrupt:s.bankrupt }; } catch(e){ out.truth.econErr = e.message; }
  // roster: every citizen name the game knows
  try {
    const R = window.MythicCitizens;
    const all = R.all ? R.all() : (R.roster ? R.roster() : []);
    out.truth.rosterN = all.length;
    out.truth.rosterNames = all.map(c => c.name);
  } catch(e){ out.truth.rosterErr = e.message; }
  // naming register: business names
  try {
    const N = window.MythicNaming;
    out.truth.namingKeys = Object.keys(N || {});
    if (N && N.all) out.truth.bizNames = N.all().map(b => b.name || b);
  } catch(e){ out.truth.nameErr = e.message; }
  out.log = (g.log||[]).slice(-40).map(l => l.m);
  out.wx = g.wx;
  return out;
})()
