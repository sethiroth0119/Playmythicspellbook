import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain'};
const P=9950;
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
 r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox']});const pg=await b.newPage({viewport:{width:1400,height:900}});
pg.on('pageerror',e=>console.log('PAGEERR: '+String(e.stack||e).split('\n').slice(0,3).join(' | ')));
await pg.route('**/*',r=>{const u=r.request().url();
 if(u.includes('127.0.0.1')||u.includes('cdnjs.cloudflare')||u.includes('fonts.g'))return r.continue();return r.abort();});
await pg.goto('http://127.0.0.1:'+P+'/warehouse/',{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!window.WHDecor',null,{timeout:120000});
await pg.waitForTimeout(2500);
console.log(await pg.evaluate(()=>{
  const D=window.WHDecor;
  const out={ isOwner: (typeof isOwner==='function')?isOwner():'n/a',
              wallet: (typeof WH!=='undefined'&&WH.wallet)?WH.wallet():null,
              owned: D.owned(), placed: D.placedCount() };
  D.setMode('decorate');
  out.buyRack = D.buy('rack');
  out.ownedAfterBuy = D.owned();
  D.startPlacing('rack');
  out.isPlacing = D.isPlacing();
  return out;
}));
await b.close();srv.close();
