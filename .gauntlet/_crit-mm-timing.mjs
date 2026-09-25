/* CRITIC harness: measures WHEN pairing attempts actually happen, and what a
   second search on the same page does. Serves a (optionally mutated) index.html
   from memory via route-fulfill so the shared file on disk is never written. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MUT = process.argv[2] || 'none';
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.txt':'text/plain','.webp':'image/webp','.glb':'model/gltf-binary' };
let html = fs.readFileSync('public/index.html','utf8');

const mutations = {
  none: (s)=>s,
  norpc: (s)=>{ const a="const res = await Cloud.client.rpc('mm_try_pair');";
    if(s.split(a).length-1!==1) throw new Error('anchor norpc count='+(s.split(a).length-1));
    return s.replace(a,"const res = { data:null, error:null };"); },
  nolatch: (s)=>{ const a="if (rpcErr && _mmRpcFunctionMissing(rpcErr)) Cloud._mmRpcMissing = true;";
    if(s.split(a).length-1!==1) throw new Error('anchor nolatch count='+(s.split(a).length-1));
    return s.replace(a,"if (false) Cloud._mmRpcMissing = true;"); },
  nooncegate: (s)=>{ const a="if (Cloud._mmRpcMissing && !Cloud._mmRequeued && !_delivered";
    if(s.split(a).length-1!==1) throw new Error('anchor nooncegate count='+(s.split(a).length-1));
    return s.replace(a,"if (Cloud._mmRpcMissing && !_delivered"); },
};
html = mutations[MUT](html);

const PORT = 8990 + (process.pid % 40);
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/index.html') { res.writeHead(200,{'Content-Type':'text/html'}); return res.end(html); }
  const f = path.join(ROOT,p);
  if (!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));

const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page = await browser.newPage({viewport:{width:1200,height:800}});
await page.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction('typeof _startMatchmakingPoll==="function" && typeof cloudEnterMatchmaking==="function"',null,{timeout:180000});
await page.waitForTimeout(2500);

await page.evaluate(()=>{
  window.__c = { ev: [], rpcError: null, t0: 0 };
  const T0 = () => Math.round(performance.now() - (window.__c.t0||0));
  const mk = (table)=>{ const ctx={table,op:'select',ops:[]}; const b={};
    const wrap=(n)=>(...a)=>{ if(n==='delete')ctx.op='delete';
      if(n==='insert'){ctx.op='insert'; window.__c.ev.push({t:T0(),k:'insert:'+table});}
      if(n==='upsert'){ctx.op='upsert'; window.__c.ev.push({t:T0(),k:'upsert:'+table});}
      if(n==='eq'&&ctx.op==='delete') window.__c.ev.push({t:T0(),k:'delete:'+table});
      ctx.ops.push([n,a]); return b; };
    for(const n of ['select','insert','upsert','update','delete','eq','neq','is','in','or','gte','lt','lte','order','limit','single','maybeSingle']) b[n]=wrap(n);
    b.then=(res,rej)=>{ if(table==='matches'&&ctx.op==='select') window.__c.ev.push({t:T0(),k:'select:matches'});
      return Promise.resolve({data:[],error:null}).then(res,rej); };
    return b; };
  Cloud.ready = true;
  Cloud.client = { from: mk,
    rpc:(fn)=>{ window.__c.ev.push({t:T0(),k:'rpc:'+fn});
      return Promise.resolve(window.__c.rpcError?{data:null,error:window.__c.rpcError}:{data:{},error:null}); },
    channel:()=>({on(){return this;},subscribe(){return this;}}), removeChannel:()=>{} };
  Profile.cloud = Profile.cloud||{}; Profile.cloud.signedIn=true; Profile.cloud.userId='me-1';
  Profile.cloud.autoSync=false;
  window.showToast=()=>{};
});

const PG = { code:'PGRST202', message:'Could not find the function public.mm_try_pair in the schema cache' };

const A = await page.evaluate(async (PG)=>{
  window.__c.ev=[]; window.__c.rpcError=PG; window.__c.t0=performance.now();
  Cloud._mmRpcMissing=false;
  MultiplayerMatch.active=true; MultiplayerMatch.matchId=null;
  await cloudEnterMatchmaking({mode:'ranked',hiddenMmr:1200,factionId:'f',heroId:'h',deck:{}});
  await new Promise(z=>setTimeout(z,31000));
  _stopMatchmakingPoll();
  return { ev: window.__c.ev.slice(), latched: !!Cloud._mmRpcMissing };
}, PG);

const B = await page.evaluate(async (PG)=>{
  window.__c.ev=[]; window.__c.rpcError=PG; window.__c.t0=performance.now();
  MultiplayerMatch.active=true; MultiplayerMatch.matchId=null;
  await cloudEnterMatchmaking({mode:'ranked',hiddenMmr:1200,factionId:'f',heroId:'h',deck:{}});
  await new Promise(z=>setTimeout(z,13000));
  _stopMatchmakingPoll();
  return { ev: window.__c.ev.slice(), latched: !!Cloud._mmRpcMissing };
}, PG);

const C = await page.evaluate(async ()=>{
  window.__c.ev=[]; window.__c.rpcError=null; window.__c.t0=performance.now();
  Cloud._mmRpcMissing=false;
  MultiplayerMatch.active=true; MultiplayerMatch.matchId=null;
  await cloudEnterMatchmaking({mode:'ranked',hiddenMmr:1200,factionId:'f',heroId:'h',deck:{}});
  await new Promise(z=>setTimeout(z,13000));
  _stopMatchmakingPoll();
  return { ev: window.__c.ev.slice(), latched: !!Cloud._mmRpcMissing };
});

const fmt = (r,label)=>{
  const q = r.ev.filter(e=>/queue/.test(e.k));
  const attempts = r.ev.filter(e=>e.k.startsWith('rpc:')||e.k==='insert:matchmaking_queue');
  console.log('\n=== ' + label + '   (mutation=' + MUT + ') ===');
  console.log('  timeline:\n    ' + r.ev.map(e=>e.t+'ms '+e.k).join('\n    '));
  console.log('  selects=' + r.ev.filter(e=>e.k==='select:matches').length
    + '  rpc=' + r.ev.filter(e=>e.k.startsWith('rpc:')).length
    + '  queueInserts=' + q.filter(e=>e.k.startsWith('insert')).length
    + '  queueDeletes=' + q.filter(e=>e.k.startsWith('delete')).length
    + '  latched=' + r.latched);
  console.log('  PAIRING-ATTEMPT TIMES (rpc or queue re-insert): ' + attempts.map(e=>e.t+'ms').join(', '));
};
fmt(A,'RUN A - 31s search, mm_try_pair ABSENT (production today)');
fmt(B,'RUN B - SECOND search on the same page (latch already set)');
fmt(C,'RUN C - 13s search, mm_try_pair PRESENT');

await browser.close(); server.close();
