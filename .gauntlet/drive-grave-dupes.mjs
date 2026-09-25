import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp'};
const P=9100+(process.pid%50);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame === "function" && typeof _graveViewCards === "function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(5000);
const out=await pg.evaluate(async ()=>{
  const o={};
  App.battlePrep=App.battlePrep||{};
  const me=findHeroById(STARTER_HEROES[0].id), foe=findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero=me; App.battlePrep.multiplayer=false;
  App.state=initGame(me,foe,[],true,null); App.screen='battle';
  const s=App.state;
  o.units0=s.units.length;

  // Three copies of ONE unit card, played and killed — the legal maximum.
  const CID='dupe_probe_unit';
  const mkCard=(i)=>({id:CID,cardId:CID,name:'Probe Wizard',type:'unit',cost:1,atk:3,hp:5,
                      instanceId:'inst_'+i});
  const corpses=[];
  for(let i=0;i<3;i++){
    const card=mkCard(i);
    const uid='pu_'+i;
    // a played unit: corpse in s.units, its card in the pile stamped to it
    s.units.push({id:uid,cardId:CID,originalCardId:CID,name:'Probe Wizard',owner:'player',
                  alive:false,currentHp:0,pos:{x:1+i,y:1},isHero:false,level:1});
    s.player.graveyard.push(Object.assign({},card,{_summonedUnitId:uid}));
    corpses.push(uid);
  }
  const view1=_graveViewCards(s,'player');
  o.healthy=view1.filter(c=>String(c.id)===CID).length;   // must be 3

  // Now break ONE stamp — the case the fallback exists for (revive/transform
  // rebuilds the unit object, so _summonedUnitId no longer matches any u.id).
  const broken=s.player.graveyard.find(c=>c._summonedUnitId===corpses[0]);
  if(broken) broken._summonedUnitId='stale_id_that_matches_nothing';
  const view2=_graveViewCards(s,'player');
  o.staleStamp=view2.filter(c=>String(c.id)===CID).length; // fallback should keep 3

  // And the hole I suspect: a pile card that is a unit card but carries NO stamp
  // at all. The fallback index only indexes cards WITH _summonedUnitId.
  const nostamp=s.player.graveyard.find(c=>c._summonedUnitId&&c._summonedUnitId!=='stale_id_that_matches_nothing');
  if(nostamp) delete nostamp._summonedUnitId;
  const view3=_graveViewCards(s,'player');
  o.noStamp=view3.filter(c=>String(c.id)===CID).length;    // 3, or 4 if the hole is real
  o.total=view3.length;
  o.refs=view3.filter(c=>String(c.id)===CID).map(c=>c._graveRef);
  return o;
});
console.log(JSON.stringify(out, null, 1));

/* A deck may hold at most 3 copies of a card, so 3 played-and-killed copies must
   read as EXACTLY 3 in the graveyard view — in all three stamp states. Before the
   tier-3 claim the noStamp case read 4, with a bare dead_* ref beside the three
   real pile cards, which is what makes these assertions discriminating rather
   than tautological. */
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? "  OK   " : "  FAIL ") + n + (d == null ? "" : "   " + d)); };
ok("every stamp intact  -> exactly 3", out.healthy === 3, String(out.healthy));
ok("one stamp STALE     -> exactly 3", out.staleStamp === 3, String(out.staleStamp));
ok("one stamp MISSING   -> exactly 3 (the reported dupe)", out.noStamp === 3, String(out.noStamp));
ok("no bare corpse ref sneaked in beside the pile cards",
   (out.refs || []).every(r => String(r).indexOf("dead_") !== 0), (out.refs || []).join(", "));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
console.log('page errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('  '+e));
await b.close(); s.close();
process.exit(typeof fails==="number"&&fails?1:0);
