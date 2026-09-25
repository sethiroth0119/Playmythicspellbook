import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg','.mjs':'text/javascript' };
const P = 9700 + Math.floor(Math.random()*200);
const srv = http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox']}); const pg=await b.newPage({viewport:{width:1500,height:980}});
await pg.route('**/*',r=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('fonts.g')) return r.continue(); return r.abort();});
await pg.addInitScript(()=>{try{localStorage.setItem('mg_onboarded','1');}catch(e){}});
await pg.goto('http://127.0.0.1:'+P+'/index.html',{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof render === "function"',null,{timeout:150000});
await pg.waitForTimeout(3500);
for (const scr of (process.argv[2]||'vendorMarket').split(',')) {
  const r = await pg.evaluate((s)=>{
    try{const g=document.getElementById('auth-gate'); if(g) g.remove();}catch(e){}
    App.screen=s; render();
    const counts={};
    document.querySelectorAll('#app *').forEach(el=>{
      const r=el.getBoundingClientRect(); if(r.width<60||r.height<24) return;   // real surfaces only
      (el.className&&el.className.split?el.className.split(/\s+/):[]).forEach(c=>{ if(c) counts[c]=(counts[c]||0)+1; });
    });
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,22);
  }, scr);
  console.log('\n== ' + scr);
  r.forEach(([c,n])=>console.log('   '+String(n).padStart(4)+'  .'+c));
}
await b.close(); srv.close();
