/* ══════════════════════════════════════════════════════════════════════════
   🛡 JUDGE A9 — a localStorage quota failure is surfaced, not swallowed.

   THE BUG. `MythicCityBridge.saveCity` wrote its device copy inside a try
   whose catch was `{}`. A QuotaExceededError therefore left nothing on disk,
   said nothing, and the load-side comment still promised localStorage was
   the half that could not fail. Every rule built on that copy — the
   "local newer wins" merge, the offline promise — then rested on a copy that
   was never written.

   THE BAR. With setItem throwing a QuotaExceededError, one saveCity call must
   leave `lastLocalSaveFailed === true`, print a console.warn naming the key
   and the payload size, and raise ONE toast — a second call must not add a
   second toast. And the lying comment must be gone: the phrase
   "cannot fail to land" must occur 0 times in node-city/index.html.

   ⚠ IT DRIVES THE REAL MODULE. saveCity, cityKey and toast are module-scoped
     in node-city; the only public handle is window.MythicCityBridge, which is
     exactly the seam the bar names. Standalone mode is used so the server
     half is inert and the local half is the whole save.
   ⚠ THE STUB GOES ON Storage.prototype, not on `localStorage.setItem`:
     assigning a property on the localStorage object itself goes through the
     Storage named setter and STORES A KEY called "setItem" — the real method
     keeps working and the test passes vacuously.

   Run:  node .gauntlet/judge-a9-local-save-quota.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.glb':'model/gltf-binary'};
const P=8180+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1280,height:900}});
const warns=[]; pg.on('console',m=>{ if(m.type()==='warning') warns.push(m.text()); });
/* jsdelivr must pass — node-city imports three.js there, and the bridge lives
   in that same module. Blocking it means the page never boots. */
await pg.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/node-city/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!(window.MythicCityBridge && window.MythicCityBridge.ready)',null,{timeout:150000}).catch(()=>{});
await pg.waitForTimeout(1500);

const r=await pg.evaluate(async ()=>{
  const B=window.MythicCityBridge; const o={ reachable: !!(B && typeof B.saveCity==='function') };
  if(!o.reachable) return o;
  o.mode=B.mode;
  const toastsNow=()=>Array.from(document.querySelectorAll('#toasts > *')).filter(t=>/refused to store/.test(t.textContent)).length;
  const payload=JSON.stringify({ v:1, savedAt: Date.now(), tiles: [], _probe:'a9' });
  // ── 0. control: a working setItem leaves the flag clear and returns true.
  o.ctrlOk = await B.saveCity(payload);
  o.ctrlFlag = B.lastLocalSaveFailed;
  // ── 1. the quota refusal.
  const real=Storage.prototype.setItem; let calls=0;
  Storage.prototype.setItem=function(){ calls++; throw new DOMException('Failed to execute setItem on Storage: exceeded the quota.','QuotaExceededError'); };
  const t0=toastsNow();
  try {
    o.ret1 = await B.saveCity(payload);
    o.flag1 = B.lastLocalSaveFailed;
    o.toastsAfter1 = toastsNow()-t0;
    o.ret2 = await B.saveCity(payload);
    o.flag2 = B.lastLocalSaveFailed;
    o.toastsAfter2 = toastsNow()-t0;
  } finally { Storage.prototype.setItem=real; }
  o.setItemCalls=calls;
  // ── 2. recovery: once the write lands again the flag clears.
  o.retAfter = await B.saveCity(payload);
  o.flagAfter = B.lastLocalSaveFailed;
  o.payloadLen = payload.length;
  return o;
});
await b.close(); s.close();

const html=fs.readFileSync(path.join(ROOT,'node-city','index.html'),'utf8');
const lieCount=(html.match(/cannot fail to land/g)||[]).length;
const warn=warns.find(w=>/LOCAL SAVE FAILED/.test(w))||'';
const checks=[
  ['bridge reachable in standalone', r.reachable && r.mode==='standalone'],
  ['control: working setItem → true, flag false', r.ctrlOk===true && r.ctrlFlag===false],
  ['quota: lastLocalSaveFailed === true', r.flag1===true],
  ['quota: saveCity does not claim a save (returns false)', r.ret1===false],
  ['quota: console.warn names the key', /key mythic_node_city/.test(warn)],
  ['quota: console.warn names the payload size', new RegExp('\\('+r.payloadLen+' chars\\)').test(warn)],
  ['quota: exactly one toast after the first call', r.toastsAfter1===1],
  ['quota: still one toast after the second call', r.toastsAfter2===1 && r.flag2===true],
  ['recovery: a landed write clears the flag', r.retAfter===true && r.flagAfter===false],
  ['comment: "cannot fail to land" occurrences === 0', lieCount===0],
];
console.log('  mode=' + r.mode + ' setItemCalls=' + r.setItemCalls + ' payload=' + r.payloadLen + ' chars');
console.log('  warn: ' + (warn ? warn.slice(0,160) : '(none)'));
let bad=0; for(const [n,ok] of checks){ console.log('  ' + (ok?'PASS':'FAIL') + '  ' + n); if(!ok) bad++; }
console.log(bad ? `  >> ${bad} check(s) FAILED` : '  >> A9 judge: all checks pass');
process.exit(bad?1:0);
