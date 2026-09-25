/* CRITIC PROBE (round 3) — the refused-re-insert orphan is fixed. Is the ORPHAN
   CLASS fixed? _releaseMatchmakingQueueRow() deletes the queue row on pagehide
   and nothing re-inserts it. If that happens AFTER the one re-queue has already
   fired, Cloud._mmRequeued is latched true and no tick will ever put the row
   back — the player finishes the search invisible to trigger_pair_match, which
   is the only live pairing mechanism while sql/066 is unapplied. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.txt':'text/plain','.webp':'image/webp','.glb':'model/gltf-binary' };
const PORT = 8960 + (process.pid % 30);
const server = http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('nf');}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:1200,height:800} });
await page.route('**/*', r => (r.request().url().includes('127.0.0.1')||r.request().url().includes('localhost')) ? r.continue() : r.abort());
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'domcontentloaded', timeout:120000 });
await page.waitForFunction('typeof _startMatchmakingPoll === "function"', null, { timeout:180000 });
await page.waitForTimeout(2000);
const out = await page.evaluate(async () => {
  const log = []; const model = { rows: [] };
  const mk = (table) => { const ctx={table,op:'select',ops:[]}; const b={};
    const wrap=(n)=>(...a)=>{ if(n==='delete')ctx.op='delete'; if(n==='insert'){ctx.op='insert';ctx.payload=a[0];log.push({table,op:'insert',t:Date.now()-window.__t0});}
      if(n==='eq'&&ctx.op==='delete')log.push({table,op:'delete',t:Date.now()-window.__t0});
      ctx.ops.push([n,a]); return b; };
    for(const n of ['select','insert','upsert','update','delete','eq','neq','is','in','or','gte','lt','lte','order','limit'])b[n]=wrap(n);
    b.then=(res,rej)=>{
      if(table==='matchmaking_queue'&&ctx.op==='delete'){ model.rows=[]; return Promise.resolve({data:null,error:null}).then(res,rej); }
      if(table==='matchmaking_queue'&&ctx.op==='insert'){ model.rows=[ctx.payload]; return Promise.resolve({data:null,error:null}).then(res,rej); }
      return Promise.resolve({data:[],error:null,count:0}).then(res,rej); };
    return b; };
  Cloud.ready=true;
  Cloud.client={from:mk,rpc:()=>Promise.resolve({data:null,error:{code:'PGRST202',message:'Could not find the function public.mm_try_pair in the schema cache'}}),
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  Profile.cloud=Profile.cloud||{}; Profile.cloud.signedIn=true; Profile.cloud.userId='me-1'; Profile.cloud.autoSync=false;
  Cloud._mmMode='ranked'; Cloud._mmMmr=1200; Cloud._mmFaction=null; Cloud._mmHeroId='h'; Cloud._mmDeck={};
  Cloud._mmSeen=new Set(); MultiplayerMatch.active=true; MultiplayerMatch.matchId=null;
  window.__t0=Date.now(); model.rows=[{user_id:'me-1'}];   // the entry INSERT already landed
  _startMatchmakingPoll();
  await new Promise(z=>setTimeout(z, 17000));              // past the 15s re-queue
  const afterRequeue = { rows: model.rows.length, requeued: !!Cloud._mmRequeued };
  window.dispatchEvent(new Event('pagehide'));             // app backgrounded / bfcache nav
  await new Promise(z=>setTimeout(z, 500));
  const afterHide = { rows: model.rows.length };
  await new Promise(z=>setTimeout(z, 11000));              // the rest of the 30s search
  _stopMatchmakingPoll();
  return { afterRequeue, afterHide, endRows: model.rows.length, endRequeued: !!Cloud._mmRequeued,
           ops: log.filter(x=>x.table==='matchmaking_queue').map(x=>x.op+'@'+Math.round(x.t/100)/10+'s') };
});
console.log('  after the one re-queue (t=17s) : rows=' + out.afterRequeue.rows + '  _mmRequeued=' + out.afterRequeue.requeued);
console.log('  immediately after pagehide     : rows=' + out.afterHide.rows);
console.log('  at the end of the search       : rows=' + out.endRows + '  _mmRequeued=' + out.endRequeued);
console.log('  queue ops                      : ' + JSON.stringify(out.ops));
console.log(out.endRows === 0
  ? '  >> ORPHANED BY A DIFFERENT ROUTE: the row was deleted on pagehide and the\n     once-per-search latch (already spent) blocks every re-queue for the rest\n     of the search. Same end state the refused-insert fix just removed.'
  : '  >> row restored');
await browser.close(); server.close();
