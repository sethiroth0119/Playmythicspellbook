/* ══════════════════════════════════════════════════════════════════════════
   🏗 DRIVE-CITY-BUILDCLOCK — does a construction timer survive leaving?

   THE REPORT: start a build, leave the City Builder, come back, and the timer
   has restarted at its full duration.

   THE ONLY QUESTION THAT DECIDES IT: does the job's absolute START STAMP
   survive a save/load round-trip? node-city stores `t.bld = { s, d }` where s
   is Date.now() at the moment the order resolved and `endAt = s + d*1000` is
   DERIVED, never stored — so remaining time is a pure function of wall clock.
   If s round-trips unchanged, the timer physically cannot reset, and any reset
   the player sees comes from somewhere else. If it does not, that is the bug.

   ⚠ THIS DRIVES THE REAL serialize() AND THE REAL bldLoad(), through the file's
     own `window.__nc` seam. Both are module-scoped and invisible to a driver
     (the lexical-binding trap CLAUDE.md records). A test that re-implemented
     either would be testing its own copy — and a copy of a clock is exactly the
     thing that cannot prove a clock.

   ⚠ IT PROVES THE TEST CAN FAIL. A job planted as "started 30 minutes ago" must
     come back reporting ~30 minutes gone, not its full duration — so the
     assertion is on the DIFFERENCE, not merely on "some number came back".

   Run:  node .gauntlet/drive-city-buildclock.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=8240+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1280,height:900}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await pg.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/node-city/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!(window.__nc && window.__nc.persist && window.__nc.persist.bldPlant)',null,{timeout:150000}).catch(()=>{});
await pg.waitForTimeout(2500);

const r=await pg.evaluate(async ()=>{
  const o={};
  const NP = (window.__nc && window.__nc.persist) || null;
  o.reachable = !!(NP && NP.bldPlant);
  if(!o.reachable) return o;

  const HOUR = 3600, MIN = 60000;
  // A 2-hour build that began 30 minutes ago — the brief's own example.
  NP.bldPlant('7,7', 'house', 2 * HOUR, 30 * MIN);
  o.plantedRemain = Math.round(NP.bldRemain('7,7'));      // expect ~5400s (90 min)

  const rt = NP.bldRoundTrip('7,7');
  o.err = rt.err || null;
  o.savedS = rt.saved ? rt.saved.s : null;
  o.savedD = rt.saved ? rt.saved.d : null;
  o.beforeS = rt.before ? rt.before.s : null;
  o.beforeD = rt.before ? rt.before.d : null;
  o.afterS  = rt.after ? rt.after.s : null;
  o.afterD  = rt.after ? rt.after.d : null;
  o.sSurvivesSave = (o.savedS === o.beforeS);
  o.sSurvivesLoad = (o.afterS  === o.beforeS);
  o.dSurvives     = (o.afterD  === o.beforeD);

  // What the UI would show after the round trip — the number the player reads.
  const endAfter = (o.afterS || 0) + (o.afterD || 0) * 1000;
  o.remainAfter = Math.round(Math.max(0, (endAfter - Date.now()) / 1000));
  o.resetToFull = (o.remainAfter > 2 * HOUR - 60);        // would mean it restarted

  // A job that finished while away must come back COMPLETE, not restarted.
  NP.bldPlant('8,8', 'house', 1 * HOUR, 3 * HOUR * 1000);
  const rt2 = NP.bldRoundTrip('8,8');
  const end2 = ((rt2.after && rt2.after.s) || 0) + ((rt2.after && rt2.after.d) || 0) * 1000;
  o.overdueRemain = Math.round(Math.max(0, (end2 - Date.now()) / 1000));

  // A FUTURE-dated stamp must be pulled back to now, never parked forever.
  NP.bldPlant('9,9', 'house', 1 * HOUR, -60 * MIN);       // "started" an hour from now
  const rt3 = NP.bldRoundTrip('9,9');
  o.futureClamped = !!(rt3.after && rt3.after.s <= Date.now() + 1000);
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F3D7} CONSTRUCTION CLOCK\n');
ok('the construction seam is reachable (else nothing below ran)', r.reachable===true);
if(r.reachable){
  console.log('   planted: 2h build begun 30m ago -> ' + r.plantedRemain + 's left ('
    + Math.round(r.plantedRemain/60) + ' min)\n');
  ok('no error round-tripping the board', !r.err, r.err || 'clean');
  ok('\u{1F3AF} the START STAMP survives serialize()', r.sSurvivesSave===true,
     r.beforeS + ' -> saved ' + r.savedS);
  ok('\u{1F3AF} ...and survives the load', r.sSurvivesLoad===true,
     r.beforeS + ' -> loaded ' + r.afterS);
  ok('the planned duration survives', r.dSurvives===true, r.beforeD + ' -> ' + r.afterD);
  console.log('');
  ok('\u{1F3AF} after leaving and returning it shows ~90 min, NOT the full 2 h',
     r.remainAfter > 5100 && r.remainAfter < 5700, r.remainAfter + 's left');
  ok('\u{1F3AF} ...i.e. it did NOT restart at full duration', r.resetToFull===false);
  ok('\u{1F3AF} a job that came due while away returns COMPLETE, not restarted',
     r.overdueRemain===0, r.overdueRemain + 's left');
  ok('a future-dated stamp is clamped back, never parked', r.futureClamped===true);
}
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
