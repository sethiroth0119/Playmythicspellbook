/* CRITIC PROBE — the re-queue does delete-then-insert and NEVER inspects the
   insert result. postgrest-js RESOLVES with {error} on an RLS/column/network
   refusal (it does not throw), so the tick's catch never sees it. Question:
   does a failing re-insert leave the player deleted from matchmaking_queue for
   the rest of the search, with no retry? */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp','.glb':'model/gltf-binary' };
const PORT = 8900 + (process.pid % 40);
const server = http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:1200,height:800} });
await page.route('**/*', r => (r.request().url().includes('127.0.0.1')||r.request().url().includes('localhost')) ? r.continue() : r.abort());
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'domcontentloaded', timeout:120000 });
await page.waitForFunction('typeof _startMatchmakingPoll === "function"', null, { timeout:180000 });
await page.waitForTimeout(2000);
const out = await page.evaluate(async () => {
  const log = [];
  const mk = (table) => { const ctx={table,op:'select',ops:[]}; const b={};
    const wrap=(n)=>(...a)=>{ if(n==='delete')ctx.op='delete'; if(n==='insert')ctx.op='insert';
      if(n==='insert')log.push({table,op:'insert'});
      if(n==='eq'&&ctx.op==='delete')log.push({table,op:'delete'});
      ctx.ops.push([n,a]); return b; };
    for(const n of ['select','insert','upsert','update','delete','eq','neq','is','in','or','gte','lt','lte','order','limit'])b[n]=wrap(n);
    b.then=(res,rej)=>{
      // Live-shaped refusal: RESOLVE with {error}, the way postgrest-js does.
      if(table==='matchmaking_queue'&&ctx.op==='insert')
        return Promise.resolve({data:null,error:{code:'42501',message:'new row violates row-level security policy'}}).then(res,rej);
      return Promise.resolve({data:[],error:null,count:0}).then(res,rej);
    };
    return b; };
  Cloud.ready=true;
  Cloud.client={from:mk,rpc:()=>Promise.resolve({data:null,error:{code:'PGRST202',message:'Could not find the function public.mm_try_pair in the schema cache'}}),
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  Profile.cloud=Profile.cloud||{}; Profile.cloud.signedIn=true; Profile.cloud.userId='me-1'; Profile.cloud.autoSync=false;
  Cloud._mmMode='ranked'; Cloud._mmMmr=1200; Cloud._mmFaction=null; Cloud._mmHeroId='h'; Cloud._mmDeck={};
  Cloud._mmSeen=new Set(); MultiplayerMatch.active=true; MultiplayerMatch.matchId=null;
  _startMatchmakingPoll();
  await new Promise(z=>setTimeout(z, 22000));   // past the 15s re-queue
  _stopMatchmakingPoll();
  const q=log.filter(x=>x.table==='matchmaking_queue');
  return { seq:q.map(x=>x.op), requeuedFlag:!!Cloud._mmRequeued };
});
console.log('  queue ops after the re-queue window :', JSON.stringify(out.seq));
console.log('  Cloud._mmRequeued (retry is locked) :', out.requeuedFlag);
const del=out.seq.filter(x=>x==='delete').length, ins=out.seq.filter(x=>x==='insert').length;
console.log('  deletes=' + del + '  inserts-attempted=' + ins + '  inserts-that-LANDED=0 (all refused)');
console.log(del>=1 && out.requeuedFlag
  ? '  >> ORPHANED: the row was deleted, the re-insert was refused, the error was never\n     inspected, and _mmRequeued=true means no tick will ever retry. The player is\n     OUT of matchmaking_queue for the rest of the search.'
  : '  >> not orphaned');
await browser.close(); server.close();
