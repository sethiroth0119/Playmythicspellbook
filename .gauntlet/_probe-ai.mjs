import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
const P = 8799;
const srv = http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox']});
const pg=await b.newPage({viewport:{width:1500,height:950}});
pg.on('pageerror',e=>console.log('PAGEERR '+String(e).slice(0,200)));
await pg.route('**/*',r=>{const u=r.request().url();if(u.includes('127.0.0.1')||u.includes('cdn.jsdelivr.net'))return r.continue();return r.abort();});
await pg.goto('http://127.0.0.1:'+P+'/index.html',{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame === "function"',null,{timeout:200000});
await pg.waitForTimeout(5000);
console.log(await pg.evaluate(()=>{
  App.battlePrep=App.battlePrep||{};
  const me=findHeroById(STARTER_HEROES[0].id),foe=findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero=me;App.battlePrep.multiplayer=false;
  App.state=initGame(me,foe,[],true,null);App.screen='battle';
  return {turn:App.state.turn,turnNumber:App.state.turnNumber,over:!!App.state.gameOver,
          units:App.state.units.map(u=>({o:u.owner,h:!!u.isHero,alive:u.alive})).slice(0,8),
          cps:(App.state.controlPoints||[]).length, aiBusy: !!(App.ui&&App.ui.aiBusy)};
}));
for (let t=0;t<3;t++){
  const before = await pg.evaluate(()=>{
    try { App.state=endPlayerTurn(App.state); } catch(e){ return {err:String(e).slice(0,120)}; }
    try { App.ui=App.ui||{}; App.ui.aiBusy=true; scheduleAIStep(1); } catch(e){ return {err2:String(e).slice(0,120)}; }
    return {turn:App.state.turn,over:!!App.state.gameOver,aiBusy:!!App.ui.aiBusy};
  });
  await pg.waitForFunction('!(App.ui && App.ui.aiBusy) || !App.state || App.state.gameOver',null,{timeout:45000}).catch(()=>console.log('  wait timed out'));
  const after = await pg.evaluate(()=>{
    const s=App.state;
    const aiMoved=(s.units||[]).filter(u=>u.owner==='ai'&&u.alive).map(u=>u.pos&&(u.pos.x+','+u.pos.y));
    let e=null; try{ App.state=endAITurn(App.state);}catch(x){e=String(x).slice(0,120);}
    return {turn:App.state&&App.state.turn,tn:App.state&&App.state.turnNumber,over:!!(App.state&&App.state.gameOver),aiPos:aiMoved,endErr:e};
  });
  console.log('turn '+t, JSON.stringify(before), '->', JSON.stringify(after));
}
await b.close();srv.close();
