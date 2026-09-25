/* 📸 The Vendor Market's Trader Memberships tab, as a player on the free tier
   with a nearly-full Marketplace sees it. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=8080+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1400,height:1150}});
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!window.MythicTrader && typeof renderVendorMarket==="function"',null,{timeout:120000}).catch(()=>{});
await pg.waitForTimeout(2500);
for (const [tag, st] of [['free',   {ok:true,tier:'survivor',name:'Survivor Trader',slots:15,used:13,remaining:2}],
                         ['full',   {ok:true,tier:'merchant',name:'Merchant',slots:55,used:55,remaining:0}]]) {
  await pg.evaluate(async (st)=>{
    try{ document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e=>e.remove()); }catch(e){}
    window.MythicTraderHost = Object.assign({}, window.MythicTraderHost, {
      rpc: async (fn) => fn==='trader_membership_status' ? st : null,
      aza: () => 140, toast: ()=>{}, render: ()=>{},
    });
    await window.MythicTrader.refresh(true);
    Profile.sovereigns = 140;
    App.screen='vendorMarket'; App.vendorMarketTab='trader';
    renderVendorMarket();
    await new Promise(r=>setTimeout(r,250));
  }, st);
  const out=path.resolve('.gauntlet/shots'); fs.mkdirSync(out,{recursive:true});
  await pg.screenshot({path:path.join(out,'trader-tab-'+tag+'.png')});
  console.log('  wrote shots/trader-tab-'+tag+'.png');
}
await b.close(); s.close();
