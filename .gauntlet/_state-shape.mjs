/* What does a freshly-initialised battle state actually contain, and which of
   the hot functions are window properties (function declarations) vs lexical
   consts? Both answers are needed before any perf A/B can be trusted. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.argv[2] || 'C:/r185/public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.glb':'model/gltf-binary' };
const P = 9200 + Math.floor(Math.random()*200);
const srv = http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r); });
await new Promise(r=>srv.listen(P,'127.0.0.1',r));
const b = await chromium.launch({ args:['--no-sandbox'] });
const pg = await b.newPage({ viewport:{width:1440,height:900} });
await pg.addInitScript(()=>{ try{localStorage.setItem('mg_onboarded','1');}catch(e){} });
await pg.route('**/*', r=>{ const u=r.request().url();
  return (u.includes('127.0.0.1')||u.includes('fonts.g')||u.includes('cdn.jsdelivr')||u.includes('cdnjs'))?r.continue():r.abort(); });
await pg.goto('http://127.0.0.1:'+P+'/index.html',{waitUntil:'domcontentloaded',timeout:180000});
await pg.waitForFunction('typeof initGame === "function"', null, { timeout:180000 });
await pg.evaluate(()=>{ const g=document.getElementById('auth-gate'); if(g) g.remove(); });
await pg.waitForTimeout(2500);

const out = await pg.evaluate(() => {
  const R = {};
  const isWin = (n) => { try { return typeof window[n] === 'function'; } catch(e){ return false; } };
  const isName = (n) => { try { return eval('typeof ' + n) === 'function'; } catch(e){ return false; } };
  R.fns = {};
  for (const n of ['hasPassive','getStatBonus','_nullFieldSrc','_nullFieldOff','_unitDeclaresEffect','initGame',
                   'getMoveTiles','getValidMoveTiles','getValidPlacementTiles','render','_renderImpl',
                   'aiTakeTurn','runAITurn','aiTurn','doAITurn','enemyTurn','aiPlay','takeAITurn','_aiTurn'])
    R.fns[n] = (isWin(n) ? 'window' : '') + (isName(n) ? (isWin(n) ? '+name' : 'name-only') : (isWin(n) ? '' : 'ABSENT'));

  App.battlePrep = App.battlePrep || {};
  const me = findHeroById(STARTER_HEROES[0].id), foe = findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero = me; App.battlePrep.multiplayer = false;
  App.state = initGame(me, foe, [], true, null);
  const s = App.state;
  R.stateKeys = Object.keys(s).slice(0, 60);
  R.unitsIsArray = Array.isArray(s.units);
  R.unitCount = (s.units||[]).length;
  R.units = (s.units||[]).slice(0,6).map(u => ({ keys: Object.keys(u).slice(0,28), isHero: u.isHero, side: u.side, name: u.name, id: u.id }));
  R.handCount = (s.hand||s.playerHand||[]).length;
  /* how do units normally get onto the board? find a spawn-ish global */
  R.spawners = ['spawnUnit','placeUnit','summonUnit','addUnitToBoard','deployUnit','playCardToBoard','_spawnUnit']
    .filter(n => isName(n));
  return R;
});
console.log(JSON.stringify(out, null, 2));
await b.close(); srv.close();
