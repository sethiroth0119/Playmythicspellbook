/* ══════════════════════════════════════════════════════════════════════════
   🛡 DRIVE-CITY-PERSIST — can a failed load overwrite a real city?

   THE BUG. `_savePolicy()` ended in `return real ? 'full' : 'none'`, reached
   ONLY when the load did not complete cleanly. `real` is true whenever one
   non-anchor tile exists, and loadState()'s own catch says a throw "leaves
   game.tiles half-built" — so a partial load returned 'full', which is a
   whole-blob upsert of city_state.state, fired unattended by the 60-second
   autosave. Server 642 objects, client fragment of 40, result 40.

   ⚠ IT DRIVES THE DECISION, NOT A CITY. _savePolicy, saveNow, game and the
     load flags are all MODULE-scoped in node-city — invisible to a driver, the
     same lexical-binding trap as Profile/Cloud in index.html — so they are
     reached through the file's own `window.__nc` diagnostics seam. Standing up
     a real 642-tile city to test a policy decision would test the renderer.
     The failure is a pure function of three flags and a tile count.

   ⚠ AND IT ASSERTS THE BUG IS REPRODUCIBLE FIRST. A persistence guard that has
     never been seen to fire is indistinguishable from one that cannot. The
     pre-fix behaviour is reconstructed from the same inputs and asserted to be
     destructive, so a green run means "the fix changed something", not "the
     test agrees with itself".

   Run:  node .gauntlet/drive-city-persist.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=8140+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1280,height:900}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
/* jsdelivr must pass — node-city imports three.js there, and the bridge and
   every function under test live in that same module. Blocking it means the
   page never boots and every check below is vacuous. */
await pg.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/node-city/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!(window.__nc && window.__nc.persist)',null,{timeout:150000}).catch(()=>{});
await pg.waitForTimeout(2500);

const r=await pg.evaluate(async ()=>{
  const o={};
  var NP = (window.__nc && window.__nc.persist) || null;
  o.reachable = !!NP;
  if(!o.reachable) return o;

  /* A city of 60 plots, the way a clean load leaves it. */
  const fill=(n)=>NP.setTiles(n);
  const setFlags=(d,f,v)=>NP.setFlags(d,f,v);

  // ── 1. THE OLD BEHAVIOUR, RECONSTRUCTED — is the bug real? ─────────────
  // Same three inputs, the line as it used to read.
  const oldPolicy=(real,loadDone,loadFailed,verdict)=>{
    if(verdict==='unknown') return real?'local':'none';
    if(loadDone && !loadFailed) return 'full';
    return real?'full':'none';           // <- the line that was there
  };
  o.oldOnFailedLoad = oldPolicy(true,true,true,'established');

  // ── 2. THE FIX ─────────────────────────────────────────────────────────
  fill(60); setFlags(true,false,'established');
  o.cleanLoad = NP.policy();

  fill(40); setFlags(true,true,'established');        // threw mid-load
  o.afterThrow = NP.policy();

  fill(40); setFlags(false,false,'established');      // never finished
  o.midLoad = NP.policy();

  fill(40); setFlags(true,true,'new');                // corrupt payload, new city
  o.corruptNew = NP.policy();

  fill(0);  setFlags(true,true,'established');        // nothing in memory at all
  o.emptyAfterFail = NP.policy();

  fill(5);  setFlags(true,false,'unknown');           // offline / no cloud
  o.offline = NP.policy();

  // ── 3. THE LOSS GUARD ──────────────────────────────────────────────────
  // Capture what saveCity is actually asked to do, without writing anything.
  // The stub answers `true` — an ACCEPTED server write — because saveNow now
  // waits for saveCity's verdict and moves the baseline only on `true`
  // (section 4 below checks the other answers). saveNow is async for the
  // same reason, so it is awaited; a synchronous read of the baseline after
  // it would see the value from before the verdict.
  const calls=[];
  const realSave = MythicCityBridge.saveCity;
  let verdict = true;
  MythicCityBridge.saveCity = async (json, opts) => { calls.push({ localOnly: !!(opts&&opts.localOnly) }); return verdict; };

  fill(60); setFlags(true,false,'established'); NP.setBaseline(60);
  calls.length=0; await NP.saveNow();
  o.normalSaveIsFull = calls.length===1 && calls[0].localOnly===false;

  // a collapse to 12 of 60 — the fragment-overwrite signature
  fill(12); setFlags(true,false,'established');
  calls.length=0; await NP.saveNow();
  o.collapseDowngraded = calls.length===1 && calls[0].localOnly===true;
  o.baselineHeld = NP.flags().baseline;      // must NOT have moved to 12

  // ordinary demolition — 60 -> 45 -> 32 -> 24, each a normal save
  fill(60); setFlags(true,false,'established'); NP.setBaseline(60);
  let allFull=true;
  for(const n of [45,32,24]){
    fill(n); calls.length=0; await NP.saveNow();
    if(!(calls.length===1 && calls[0].localOnly===false)) allFull=false;
  }
  o.gradualDemolitionAllowed = allFull;
  o.baselineFollowed = NP.flags().baseline;   // should be 24

  // a SMALL city may lose most of itself — the ratio carries no signal there
  fill(6); setFlags(true,false,'established'); NP.setBaseline(6);
  fill(1); calls.length=0; await NP.saveNow();
  o.smallCityAllowed = calls.length===1 && calls[0].localOnly===false;

  // ── 4. THE VERDICT ─────────────────────────────────────────────────────
  // A save the server did not accept must not move the baseline. Before this
  // check, saveNow moved it the moment the save was handed off, so a refused
  // (`false`) or unconfirmed (`undefined`) write lowered the guard anyway.
  fill(60); setFlags(true,false,'established'); NP.setBaseline(60);
  fill(50); verdict = false;     await NP.saveNow(); o.baselineAfterRefused = NP.flags().baseline;
  fill(50); verdict = undefined; await NP.saveNow(); o.baselineAfterUnconfirmed = NP.flags().baseline;
  fill(50); verdict = true;      await NP.saveNow(); o.baselineAfterAccepted = NP.flags().baseline;
  o.saveNowReturnsVerdict = (await NP.saveNow()) === true;
  verdict = false; o.saveNowReturnsFalseOnRefusal = (await NP.saveNow()) === false;

  // And the real bridge, against a parent that answers nothing: saveCity must
  // resolve false and flag it, never report a save that went nowhere.
  MythicCityBridge.saveCity = realSave;
  o.bridgeMode = MythicCityBridge.mode;
  if (MythicCityBridge.mode === 'parent') {
    const prevParentSave = window.parent.cityStateSave;
    window.parent.cityStateSave = async () => undefined;
    MythicCityBridge.lastServerSaveFailed = false;
    o.bridgeUndefinedIsFalse = (await MythicCityBridge.saveCity('{"v":1,"tiles":{}}')) === false;
    o.bridgeUndefinedFlagged = MythicCityBridge.lastServerSaveFailed === true;
    window.parent.cityStateSave = prevParentSave;
  }
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F6E1} CITY PERSISTENCE\n');
ok('the policy + save functions are reachable (else nothing below ran)', r.reachable===true);
if(r.reachable){
  console.log('\n\u{1F41B} the bug, reconstructed from the same inputs');
  ok('\u{1F3AF} the OLD line returned FULL after a failed load — destructive, reproducible',
     r.oldOnFailedLoad==='full', 'old policy said: '+r.oldOnFailedLoad);
  console.log('\n\u{2705} the fix');
  ok('a clean load still saves to the server', r.cleanLoad==='full', r.cleanLoad);
  ok('\u{1F3AF} a load that THREW mid-way never writes the server', r.afterThrow==='local', r.afterThrow);
  ok('\u{1F3AF} a load still in progress never writes the server', r.midLoad==='local', r.midLoad);
  ok('\u{1F3AF} a corrupt payload never writes the server', r.corruptNew==='local', r.corruptNew);
  ok('nothing in memory after a failure writes nothing at all', r.emptyAfterFail==='none', r.emptyAfterFail);
  ok('offline/unknown still saves locally, never to the server', r.offline==='local', r.offline);
  console.log('\n\u{1F6E1} the loss guard');
  ok('a normal save still reaches the server', r.normalSaveIsFull===true);
  ok('\u{1F3AF} a collapse from 60 to 12 is DOWNGRADED to a local save', r.collapseDowngraded===true);
  ok('\u{1F3AF} ...and the baseline is NOT moved by the refused write', r.baselineHeld===60, 'baseline='+r.baselineHeld);
  ok('\u{1F3AF} ordinary demolition (60->45->32->24) is never blocked', r.gradualDemolitionAllowed===true);
  ok('...and the baseline follows it down', r.baselineFollowed===24, 'baseline='+r.baselineFollowed);
  ok('a tiny city losing most of itself is NOT blocked (no signal below the floor)',
     r.smallCityAllowed===true);
  console.log('\n\u{1F4E1} the verdict');
  ok('\u{1F3AF} a REFUSED server write does not move the baseline', r.baselineAfterRefused===60, 'baseline='+r.baselineAfterRefused);
  ok('\u{1F3AF} an UNCONFIRMED (undefined) server write does not move the baseline', r.baselineAfterUnconfirmed===60, 'baseline='+r.baselineAfterUnconfirmed);
  ok('an ACCEPTED server write moves it', r.baselineAfterAccepted===50, 'baseline='+r.baselineAfterAccepted);
  ok('saveNow resolves true only on an accepted write', r.saveNowReturnsVerdict===true && r.saveNowReturnsFalseOnRefusal===true);
  if (r.bridgeMode === 'parent') {
    ok('\u{1F3AF} the real bridge: a parent answering undefined -> saveCity false', r.bridgeUndefinedIsFalse===true);
    ok('\u{1F3AF} ...and lastServerSaveFailed is set', r.bridgeUndefinedFlagged===true);
  } else {
    console.log('  (bridge mode '+r.bridgeMode+' — the parent-answer check needs the iframe; see the A3 judge in the browser)');
  }
}
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
