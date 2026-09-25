/* ══════════════════════════════════════════════════════════════════════════
   🧹 DRIVE-CITY-WIPE — does the save-key bump actually stop a wiped city
   coming back from the player's own disk?

   THE WHOLE POINT. Deleting `city_state` server-side wipes nothing on its own:
   `B.loadCity` reads the server FIRST and falls back to localStorage when the
   server returns nothing — and a deleted row is indistinguishable from "no city
   yet". So a v1 local save would restore the city and re-upload it, and the
   wipe would silently fail while the row count quietly climbed back.

   Four things have to be true, and the last one is the one a careless fix
   breaks:
     1. `cityKey()` is on v2.
     2. A v1 save on disk is SWEPT — both the bare key and the `:uid` form.
     3. A v1 save cannot be READ back (the city is really gone).
     4. A v2 save CAN still be read back — the offline fallback must survive.
        Killing the fallback outright would also "pass" 1-3 while breaking
        every player's offline session, so it is asserted explicitly.

   PART 2 — THE PER-CITY DELETE, which no key bump can cover. An operator's
   city_move_node() or forced delete removes ONE row; the owner's device still
   holds a v2 blob stamped for that owner and that node, and it passed every
   guard in loadCity() on the next open. The bridge now asks the parent's
   `cityStateWasDeleted(node)` (a 'delete' archive in city_state_history for
   (me, node) — what a delete and a move both leave behind) before adopting a
   stamped blob on a positive server miss, and only an explicit `false` adopts.
   Driven in PARENT mode: a synthetic same-origin parent exposes the four
   functions the bridge's mode detection and this path read, and the real
   node-city runs in an iframe under it.
     5. wasDeleted → true : loadCity() is null, the blob is RENAMED to
        localKey()+':retired' and is gone from the main key.
     6. wasDeleted → false: the blob is returned.
     7. wasDeleted → null (not proven): retired, not adopted.
     8. an UNSTAMPED blob is never adopted once the node is resolved.
     9. the retired copy is never replaced by a SMALLER one.
    10. no blob + deleted: an empty grid founds no row (policy 'none', no
        cityStateSave call); one real tile and it saves 'full' by the player's
        own hand.
    11. an UNSAFE read still adopts the stamped blob — offline play survives —
        and never asks the parent (a refused read proves nothing).
    12. city_state_guard_trg is still BEFORE UPDATE OR DELETE only, per the
        newest sql/ file that defines it: no INSERT branch, because the client
        refuses.

   Run:  node .gauntlet/drive-city-wipe.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=7880+(process.pid%50);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1280,height:900}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
/* ⚠ jsdelivr MUST be allowed through. node-city imports three.js from it inside
   a `<script type="module">`, and the bridge — including the v1 sweep and
   cityKey() — is defined in that same module. Block the CDN and the module
   never executes: the page sits on "detecting renderer…", MythicCityBridge is
   undefined, and this file reports six failures that have nothing to do with
   the wipe. Everything else stays blocked. */
await pg.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();});

/* Plant a v1 city on disk BEFORE node-city ever loads — this is the state a
   real player is in the moment the new build reaches them. */
await pg.goto(`http://127.0.0.1:${P}/node-city/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.evaluate(()=>{
  localStorage.clear();
  localStorage.setItem('mythic_node_city_v1', JSON.stringify({tiles:{'0,0':'house'}, _owner:null, marker:'BARE_V1'}));
  localStorage.setItem('mythic_node_city_v1:user-abc', JSON.stringify({tiles:{'1,1':'farm'}, _owner:'user-abc', marker:'NS_V1'}));
  localStorage.setItem('mythic_node_city_v1:user-xyz', JSON.stringify({tiles:{'2,2':'mine'}, _owner:'user-xyz', marker:'NS_V1_OTHER'}));
});
const planted = await pg.evaluate(()=>Object.keys(localStorage).filter(k=>k.indexOf('mythic_node_city')===0).sort());

/* Now load the page for real, so the sweep at module scope runs. */
await pg.reload({waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof window.MythicCityBridge === "object" && window.MythicCityBridge',null,{timeout:120000}).catch(()=>{});
await pg.waitForTimeout(2500);

const r = await pg.evaluate(async ()=>{
  const o={};
  const B = window.MythicCityBridge;
  o.hasBridge = !!B;
  o.mode = B ? B.mode : null;
  o.keysAfterSweep = Object.keys(localStorage).filter(k=>k.indexOf('mythic_node_city')===0).sort();
  o.v1Left = o.keysAfterSweep.filter(k=>k.indexOf('mythic_node_city_v1')===0);
  o.localKey = (B && B.localKey) ? B.localKey() : null;

  /* 3. a v1 save cannot come back. Re-plant one and ask loadCity for it. */
  localStorage.setItem('mythic_node_city_v1', JSON.stringify({tiles:{'0,0':'house'}, marker:'BARE_V1'}));
  let got=null;
  try { got = await B.loadCity(); } catch(e) { o.loadErr=String(e); }
  o.v1Restored = !!(got && String(got).indexOf('BARE_V1') >= 0);

  /* 4. …but a v2 save MUST still load, or the offline fallback is dead. */
  localStorage.setItem(o.localKey || 'mythic_node_city_v2',
    JSON.stringify({tiles:{'3,3':'mill'}, marker:'FRESH_V2'}));
  let got2=null;
  try { got2 = await B.loadCity(); } catch(e) { o.loadErr2=String(e); }
  o.v2Restored = !!(got2 && String(got2).indexOf('FRESH_V2') >= 0);

  /* and a fresh save must WRITE to v2, never to v1.
     ⚠ Clear the v1 key THIS TEST re-planted two steps up first. The sweep runs
       once at module load, so anything the test writes afterwards survives —
       and leaving it there made this assertion fail on a key the app never
       touched, which is a lie about the product. */
  Object.keys(localStorage).filter(k=>k.indexOf('mythic_node_city')===0)
    .forEach(k=>localStorage.removeItem(k));
  try { await B.saveCity(JSON.stringify({tiles:{'4,4':'depot'}, marker:'WROTE'}), {localOnly:true}); } catch(e){}
  o.keysAfterSave = Object.keys(localStorage).filter(k=>k.indexOf('mythic_node_city')===0).sort();
  o.wroteToV2 = o.keysAfterSave.some(k=>k.indexOf('mythic_node_city_v2')===0);
  o.wroteToV1 = o.keysAfterSave.some(k=>k.indexOf('mythic_node_city_v1')===0);
  return o;
});

/* ── PART 2: a DELETED or MOVED city must not come back from disk ────────────
   The bridge goes into 'parent' mode when window.parent has getRes AND
   addCinders (its mode detection, verbatim). Everything else here is the exact
   surface loadCity()/_savePolicy() read off the parent: cityStateUserId,
   cityNodeIdForKey, cityStateLoad + __cityLoadUnsafe, cityStateWasDeleted,
   cityStateSave. Served same-origin so `P = window.parent` resolves. */
const OWNER='user-U', NODE='N-7';
const PARENT_HTML = `<!DOCTYPE html><html><body><script>
window.getRes=()=>0; window.addCinders=()=>true;
window.cityStateUserId=()=>${JSON.stringify(OWNER)};
window.cityNodeIdForKey=()=>${JSON.stringify(NODE)};
window.cityGroundId=()=>null;
window.__cityLoadUnsafe=false; window.__wasDeleted=false; window.__askedFor=[]; window.__saves=[];
window.cityStateLoad=async()=>null;
window.cityStateWasDeleted=async(n)=>{ window.__askedFor.push(n); return window.__wasDeleted; };
window.cityStateSave=async(j)=>{ window.__saves.push(j); return false; };
</script><iframe id="node-city-frame" src="/node-city/" style="width:1000px;height:700px"></iframe></body></html>`;
await pg.route(`http://127.0.0.1:${P}/__wipe-parent.html`, (r)=>r.fulfill({status:200,contentType:'text/html',body:PARENT_HTML}));
await pg.goto(`http://127.0.0.1:${P}/__wipe-parent.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction(()=>{ const f=document.getElementById('node-city-frame'); try { return !!(f && f.contentWindow && f.contentWindow.MythicCityBridge && f.contentWindow.__nc); } catch(e) { return false; } },null,{timeout:120000}).catch(()=>{});
await pg.waitForTimeout(2500);
const fr = pg.frames().find(f=>f.url().indexOf('/node-city/')>=0);
const r2 = fr ? await fr.evaluate(async ({OWNER,NODE})=>{
  const o={}; const B=window.MythicCityBridge; const par=window.parent;
  o.mode=B.mode; const key=B.localKey(); o.key=key; const rk=key+':retired'; o.rk=rk;
  o.hasSeam=!!(window.__nc && window.__nc.persist);
  const blob=(m,extra)=>JSON.stringify(Object.assign({tiles:{'1,1':'farm','2,2':'mine'},_owner:OWNER,_node:NODE,savedAt:Date.now(),marker:m},extra||{}));
  const mark=(s)=>{ try { return JSON.parse(s).marker; } catch(e) { return s==null?null:'?'; } };
  /* 5. deleted → null, renamed to :retired */
  localStorage.removeItem(rk); localStorage.setItem(key, blob('DELETED_CITY'));
  par.__wasDeleted=true; par.__askedFor.length=0;
  o.a=mark(await B.loadCity()); o.aAsked=par.__askedFor.slice(); o.aRetired=mark(localStorage.getItem(rk)); o.aMain=localStorage.getItem(key); o.aFlag=B.nodeDeleted;
  /* 6. not deleted → the blob comes back */
  localStorage.setItem(key, blob('LIVE_CITY')); par.__wasDeleted=false;
  o.b=mark(await B.loadCity()); o.bFlag=B.nodeDeleted; o.bMain=mark(localStorage.getItem(key));
  /* 7. not proven → retired, not adopted */
  localStorage.setItem(key, blob('UNPROVEN',{savedAt:Date.now()+1000})); par.__wasDeleted=null;
  o.c=mark(await B.loadCity()); o.cRetired=mark(localStorage.getItem(rk)); o.cFlag=B.nodeDeleted;
  /* 8. unstamped, node resolved, NOT deleted → never adopted */
  localStorage.setItem(key, JSON.stringify({tiles:{'3,3':'mill'},_owner:OWNER,savedAt:Date.now(),marker:'UNSTAMPED'})); par.__wasDeleted=false;
  o.d=mark(await B.loadCity());
  /* 9. a smaller blob does not replace the retired copy */
  localStorage.setItem(key, JSON.stringify({tiles:{'9,9':'hut'},_owner:OWNER,_node:NODE,savedAt:Date.now()+5000,marker:'SMALL'})); par.__wasDeleted=true;
  o.e=mark(await B.loadCity()); o.eRetired=mark(localStorage.getItem(rk)); o.eMain=localStorage.getItem(key);
  /* 10. no blob, deleted: an empty grid founds no row; a built one saves */
  localStorage.removeItem(key); par.__wasDeleted=true;
  o.f=await B.loadCity(); o.fFlag=B.nodeDeleted;
  if (o.hasSeam) {
    const NC=window.__nc;
    NC.persist.setFlags(true,false,'new'); NC.persist.setTiles(0); o.fPolEmpty=NC.persist.policy();
    par.__saves.length=0; o.fSaveRet=await NC.persist.saveNow(); o.fSavesEmpty=par.__saves.length;
    NC.persist.setTiles(1); o.fPolBuilt=NC.persist.policy();
    /* …and the same empty grid on a node that was NOT deleted still founds. */
    par.__wasDeleted=false; await B.loadCity(); NC.persist.setTiles(0); o.fPolEmptyClean=NC.persist.policy();
  }
  /* 11. unsafe read: offline fallback survives, parent never asked */
  par.__cityLoadUnsafe=true; par.__askedFor.length=0; localStorage.setItem(key, blob('OFFLINE')); par.__wasDeleted=true;
  o.g=mark(await B.loadCity()); o.gAsked=par.__askedFor.length; o.gUnsafe=B.loadUnsafe; par.__cityLoadUnsafe=false;
  return o;
},{OWNER,NODE}) : { mode:null, noFrame:true };

/* 12. the trigger, from the newest sql/ file that defines it */
const trg=(()=>{
  const dir=path.resolve(process.cwd(),'sql');
  const files=fs.readdirSync(dir).filter(f=>/^\d+.*\.sql$/i.test(f)).sort((a,b)=>parseInt(a,10)-parseInt(b,10)||a.localeCompare(b));
  let last=null, stmt=null;
  for (const f of files) {
    const src=fs.readFileSync(path.join(dir,f),'utf8');
    const m=src.match(/create\s+trigger\s+city_state_guard_trg[\s\S]*?;/i);
    if (m) { last=f; stmt=m[0]; }
  }
  return { file:last, stmt, ok: !!stmt && /before\s+(update\s+or\s+delete|delete\s+or\s+update)\s+on\s+public\.city_state/i.test(stmt) && !/insert/i.test(stmt) };
})();

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F9F9} THE CITY WIPE — can a wiped city come back from disk?\n');
console.log('  planted before load : '+planted.join(', '));
console.log('  after the sweep     : '+(r.keysAfterSweep.length?r.keysAfterSweep.join(', '):'(none)'));
console.log('  bridge mode         : '+r.mode+'   localKey: '+r.localKey+'\n');

ok('the bridge came up (else nothing below was exercised)', r.hasBridge===true);
ok('\u{1F3AF} the save key is on v2', /mythic_node_city_v2/.test(String(r.localKey)), String(r.localKey));
ok('\u{1F3AF} every v1 key was SWEPT — bare and :uid alike', (r.v1Left||[]).length===0,
   (r.v1Left||[]).length+' left: '+((r.v1Left||[]).join(', ')||'none'));
ok('\u{1F3AF} a v1 save on disk can NOT be restored — the city is really gone',
   r.v1Restored===false, 'restored='+r.v1Restored+(r.loadErr?('  ERR '+r.loadErr):''));
ok('\u{1F3AF} …but a v2 save STILL loads — the offline fallback survived',
   r.v2Restored===true, 'restored='+r.v2Restored+(r.loadErr2?('  ERR '+r.loadErr2):''));
ok('a new save writes to v2', r.wroteToV2===true, r.keysAfterSave.join(', '));
ok('…and never to v1', r.wroteToV1===false);

console.log('\n\u{1FAA6} PART 2 — a deleted or moved city, on the device that had it open\n');
console.log('  bridge mode         : '+r2.mode+'   localKey: '+r2.key+'\n');
ok('the bridge came up in PARENT mode under the synthetic parent', r2.mode==='parent', r2.noFrame?'no node-city frame':'mode='+r2.mode);
ok('\u{1F3AF} wasDeleted=true  → loadCity() is null', r2.a===null, 'got '+r2.a);
ok('\u{1F3AF} …the parent was asked for THIS node', Array.isArray(r2.aAsked)&&r2.aAsked.length===1&&r2.aAsked[0]===NODE, JSON.stringify(r2.aAsked));
ok('\u{1F3AF} …the blob was RENAMED to localKey()+\':retired\'', r2.aRetired==='DELETED_CITY' && r2.aMain===null, 'retired='+r2.aRetired+' main='+(r2.aMain===null?'(cleared)':'still there'));
ok('…and nodeDeleted reads true', r2.aFlag===true, String(r2.aFlag));
ok('\u{1F3AF} wasDeleted=false → the blob is returned', r2.b==='LIVE_CITY', 'got '+r2.b);
ok('…and the main key still holds it', r2.bMain==='LIVE_CITY' && r2.bFlag===false, 'main='+r2.bMain+' flag='+r2.bFlag);
ok('\u{1F3AF} wasDeleted=null (not proven) → retired, not adopted', r2.c===null && r2.cRetired==='UNPROVEN' && r2.cFlag===null, 'got '+r2.c+' retired='+r2.cRetired+' flag='+r2.cFlag);
ok('\u{1F3AF} an UNSTAMPED blob is never adopted once the node is resolved', r2.d===null, 'got '+r2.d);
ok('a SMALLER blob does not replace the retired copy (but is cleared from the main key)', r2.e===null && r2.eRetired==='UNPROVEN' && r2.eMain===null, 'retired='+r2.eRetired+' main='+(r2.eMain===null?'(cleared)':'still there'));
ok('the persistence seam is exposed (window.__nc.persist)', r2.hasSeam===true);
ok('\u{1F3AF} no blob + deleted: an empty grid founds NO row — policy \'none\', cityStateSave never called', r2.f===null && r2.fFlag===true && r2.fPolEmpty==='none' && r2.fSavesEmpty===0 && r2.fSaveRet===false, 'policy='+r2.fPolEmpty+' saves='+r2.fSavesEmpty+' flag='+r2.fFlag);
ok('…one real tile and it saves \'full\' by the player\'s own hand', r2.fPolBuilt==='full', 'policy='+r2.fPolBuilt);
ok('…and an empty grid on a node that was NOT deleted still founds (\'full\')', r2.fPolEmptyClean==='full', 'policy='+r2.fPolEmptyClean);
ok('\u{1F3AF} an UNSAFE read still adopts the stamped blob (offline play survives)…', r2.g==='OFFLINE' && r2.gUnsafe===true, 'got '+r2.g+' unsafe='+r2.gUnsafe);
ok('…and never asks the parent — a refused read proves nothing', r2.gAsked===0, 'asked '+r2.gAsked+'x');
ok('\u{1F3AF} city_state_guard_trg is BEFORE UPDATE OR DELETE only ('+trg.file+')', trg.ok===true, trg.stmt?trg.stmt.replace(/\s+/g,' '):'no definition found');

console.log('\n  page errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('    '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
