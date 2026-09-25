import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve('C:/r185/public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.jsx':'text/babel','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.glb':'model/gltf-binary','.wav':'audio/wav','.mp3':'audio/mpeg'};
const P=9990; const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
 const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
 r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--use-gl=swiftshader']});
const pg=await b.newPage({viewport:{width:1440,height:900}});
const blocked=[]; const failed=[];
await pg.addInitScript(()=>{try{localStorage.setItem('mg_onboarded','1');}catch(e){}});
await pg.route('**/*', r=>{const u=r.request().url();
 if(u.includes('127.0.0.1')||u.includes('fonts.g')||u.includes('cdn.jsdelivr')||u.includes('cdnjs')) return r.continue();
 blocked.push(u.slice(0,90)); return r.abort();});
pg.on('requestfailed', r=>failed.push(r.url().slice(0,90)+' :: '+((r.failure()||{}).errorText||'')));
await pg.goto('http://127.0.0.1:'+P+'/index.html',{waitUntil:'domcontentloaded',timeout:180000});
await pg.waitForFunction('typeof initGame === "function"',null,{timeout:180000});
await pg.evaluate(()=>{const g=document.getElementById('auth-gate'); if(g)g.remove();});
await pg.waitForTimeout(2000);
await pg.evaluate(()=>{App.battlePrep=App.battlePrep||{};const me=findHeroById(STARTER_HEROES[0].id),foe=findHeroById(STARTER_HEROES[1].id);
 App.battlePrep.hero=me;App.battlePrep.multiplayer=false;App.state=initGame(me,foe,[],true,null);App.screen='battle';render();});
await pg.waitForTimeout(9000);
const info = await pg.evaluate(()=>{
  const f=document.querySelector('iframe.bb-stage');
  const w=f&&f.contentWindow, d=f&&f.contentDocument;
  return { hasFrame:!!f, src:f?String(f.getAttribute('src')).slice(0,80):null,
    frameNodes:d?d.getElementsByTagName('*').length:-1,
    canvasInFrame:d?d.getElementsByTagName('canvas').length:-1,
    THREE: w?typeof w.THREE:'n/a', Board: w?typeof w.Board:'n/a',
    renderer: w&&w.renderer?'yes':'no' };
});
console.log(JSON.stringify(info,null,2));
console.log('blocked sample:', [...new Set(blocked)].slice(0,12));
console.log('failed sample:', [...new Set(failed)].slice(0,8));
await b.close(); srv.close();
