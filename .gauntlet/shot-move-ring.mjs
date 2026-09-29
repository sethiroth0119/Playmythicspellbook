/* 📸 Photograph the move ring — two moves and a full eight — so the layout gets
   an eye on it and not only a numeric overlap check. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=7700+(process.pid%60);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1600,height:950}});
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame==="function" && typeof _openMoveRing==="function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(5000);
const out=path.resolve('.gauntlet/shots'); fs.mkdirSync(out,{recursive:true});
for(const n of [2,8]){
  await pg.evaluate(async (n)=>{
    App.battlePrep=App.battlePrep||{};
    const me=findHeroById(STARTER_HEROES[0].id), foe=findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero=me; App.battlePrep.multiplayer=false;
    if(!App.state){ App.state=initGame(me,foe,[],true,null); App.screen='battle'; }
    const u=App.state.units.find(x=>x.owner==='player'&&x.alive);
    App.ui=App.ui||{}; App.ui.modalUnitId=null; App.state.player.energy=999;
    const id='shot_'+n;
    if(!App.state.units.find(x=>x.id===id))
      App.state.units.push({...u,id:id,knownMoves:Object.keys(MOVES).slice(0,n)});
    _closeMoveRing();
    _uhmRect={left:770,top:430,width:60,height:80,right:830,bottom:510,x:770,y:430};
    _openMoveRing(id);
    await new Promise(r=>setTimeout(r,300));
  },n);
  await pg.screenshot({path:path.join(out,'move-ring-'+n+'.png')});
  console.log('  wrote move-ring-'+n+'.png');
  /* Truncation is invisible in a numeric overlap check but obvious to a player
     picking an attack, so print what each name NEEDS versus what it got. */
  for(const l of await pg.evaluate(()=>[...document.querySelectorAll('#move-ring .mvr-move')].map(c=>{
    const q=c.querySelector('.mvr-name');
    return '    ' + (q.scrollWidth>q.clientWidth?'CLIPPED ':'ok      ')
      + q.textContent.padEnd(18) + ' needs ' + q.scrollWidth + 'px, has ' + q.clientWidth
      + 'px  (chip ' + Math.round(c.getBoundingClientRect().width) + 'px)'; })))
    console.log(l);
}
await b.close(); s.close();
