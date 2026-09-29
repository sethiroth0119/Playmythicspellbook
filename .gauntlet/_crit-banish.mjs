/* Focused diagnostic: does banishGrave reach App.state through placeUnit()?
   Prints BOTH sides, the battle log, and the owner the effect resolved for. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp','.glb':'model/gltf-binary'};
const PORT=8901;
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await b.newPage({viewport:{width:1600,height:950}});
await page.route('**/*',r=>{const u=r.request().url();if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue();return r.abort();});
await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction('typeof initGame==="function" && typeof placeUnit==="function"',null,{timeout:180000});
await page.waitForTimeout(4000);
const out=await page.evaluate(()=>{
  const start=()=>{App.battlePrep=App.battlePrep||{};const me=findHeroById(STARTER_HEROES[0].id),foe=findHeroById(STARTER_HEROES[1].id);
    App.battlePrep.hero=me;App.battlePrep.multiplayer=false;App.state=initGame(me,foe,[],true,null);App.screen='battle';App.ui=App.ui||{};App.ui.aiBusy=false;renderBattleNow();};
  const cen=(s)=>({p:{g:s.player.graveyard.length,v:(s.player.void||[]).length,d:s.player.deck.length,h:s.player.hand.length},
                   a:{g:s.ai.graveyard.length,v:(s.ai.void||[]).length,d:s.ai.deck.length,h:s.ai.hand.length}});
  const r={};
  // '_warm' burns the first placeUnit after page load, which does not resolve its
  // on-play synchronously; without it whichever case runs FIRST reads as a no-op.
  for (const gs of ['_warm','self','enemy','both','both_noAIgrave','self']) {
    start();
    let s=App.state;
    // seed BOTH graveyards so we can see which one moved
    const noAI = gs === 'both_noAIgrave';
    const realGs = noAI ? 'both' : (gs === '_warm' ? 'self' : gs);
    s={...s, player:{...s.player, deck:s.player.deck.slice(3), graveyard:s.player.deck.slice(0,3)},
             ai:{...s.ai, graveyard: noAI ? [] : [{id:'z1',name:'z1'},{id:'z2',name:'z2'}]}};
    s={...s, player:{...s.player, energy:99, maxEnergy:99}};
    App.state=s;
    const before=cen(s);
    const logLen=(s.log||[]).length;
    const hero=s.units.find(u=>u.owner==='player'&&u.isHero);
    const card={id:'_b_'+gs,name:'Banish '+gs,type:'unit',cost:0,attack:1,health:1,unit:'goblin',
                onPlay:{type:'banishGrave',graveSide:realGs}};
    const t=getValidPlacementTiles(card,hero,s)||[];
    placeUnit(card,t[0],{});
    const after=cen(App.state);
    r['placeUnit_'+gs+'_'+Math.random().toString(36).slice(2,5)]={before,after,newLog:(App.state.log||[]).slice(logLen).map(l=>l.msg).slice(-6)};
  }
  // Direct call control, same seed
  start();
  let s=App.state;
  s={...s, player:{...s.player, deck:s.player.deck.slice(3), graveyard:s.player.deck.slice(0,3)},
           ai:{...s.ai, graveyard:[{id:'z1',name:'z1'},{id:'z2',name:'z2'}]}};
  const hero=s.units.find(u=>u.owner==='player'&&u.isHero);
  const ret=applyOnPlayEffect(s,hero,{id:'_d',name:'d',onPlay:{type:'banishGrave',graveSide:'self'}});
  r.direct_self={before:cen(s),after:cen(ret)};
  return r;
});
console.log(JSON.stringify(out,null,1));
await b.close(); server.close();
