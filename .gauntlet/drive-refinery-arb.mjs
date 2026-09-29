/* ══════════════════════════════════════════════════════════════════════════
   💰 DRIVE-REFINERY-ARB — can you MINT Cinder by refining into a mispriced id?

   THE SUSPICION. `_resCinderValue(id)` ends in `|| 3`, documented as a crash
   guard that no shipped id can reach because round0t asserts every RESOURCES id
   has its own entry. Two ids reach it anyway — `weaponParts` and `gunOil` —
   which is what round0t has been red about. Separately, the Industrialist
   trades weaponParts at buy 280 / sell 140.

   If the Refinery values a resource at 3 while a trader pays 140 for it, the
   loop is: buy something cheap → `_refineryYield` it into weaponParts at the
   3-value → sell to the trader. That mints Cinder out of the spread, which is
   the one thing the economy is not allowed to do.

   MEASURED WITH THE GAME'S OWN FUNCTIONS, not re-derived here — `_resCinderValue`
   and `_refineryYield` are called directly, so this cannot disagree with the
   product about the arithmetic. Every RESOURCES id is swept, not just the two
   suspects, because a price table with two holes may have more.

   Exit 1 = a profitable loop exists.
   Run:  node .gauntlet/drive-refinery-arb.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=7810+(process.pid%50);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1400,height:900}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,140)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof _resCinderValue==="function" && typeof _refineryYield==="function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(3000);

const r=await pg.evaluate(() => {
  const o={};
  o.spread = REFINERY_CONVERT_SPREAD;
  o.ids = RESOURCES.map(x=>x.id);
  o.noOwnPrice = o.ids.filter(id => !(id in RESOURCE_CINDER_VALUE));
  o.values = {}; o.ids.forEach(id => { o.values[id] = _resCinderValue(id); });

  /* Every trader line in the file, flattened to {id: {buy, sell}}. The tables
     are built by _trMakeLine, so this reads what the traders actually offer
     rather than a copy of the numbers. */
  /* 🔴 `TRADER_DEFAULTS` IS A TOP-LEVEL `const` — IT IS NOT ON `window`.
     The first draft of this file probed `window.TRADERS` / `window.TRADE_*`,
     found nothing, and reported "0 traded ids · 0 profitable loops · OK". That
     is a VACUOUS PASS: with no trader lines the loop search has nothing to
     iterate and green means "I could not look", not "there is nothing there".
     A bare identifier inside evaluate() resolves against the lexical scope, so
     TRADER_DEFAULTS is read directly — and the count is asserted below so this
     can never silently go quiet again. */
  const lines = {};
  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(scan); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)
          && typeof v.buy === 'number' && typeof v.sell === 'number') {
        if (!lines[k] || v.sell > lines[k].sell) lines[k] = { buy: v.buy | 0, sell: v.sell | 0 };
      } else scan(v);
    }
  };
  try { scan(TRADER_DEFAULTS); } catch (e) { o.scanErr = String(e); }
  o.traderLines = lines;
  o.tradedIds = Object.keys(lines);

  /* THE LOOP. For each (from -> to) where BOTH are traded: buying `from` costs
     `buy(from)` each; refining gives `_refineryYield(from,to,N)` of `to`;
     selling `to` pays `sell(to)` each. Profitable if the sale beats the spend. */
  const N = 1000;
  const wins = [];
  for (const from of o.tradedIds) {
    for (const to of o.tradedIds) {
      if (from === to) continue;
      const got = _refineryYield(from, to, N);
      if (!got) continue;
      const spend = N * (lines[from].buy | 0);
      const earn  = got * (lines[to].sell | 0);
      if (earn > spend) wins.push({from, to, spend, earn, gain: Math.round(earn - spend),
                                   perCinder: +(earn / Math.max(1, spend)).toFixed(3),
                                   vFrom: _resCinderValue(from), vTo: _resCinderValue(to), got});
    }
  }
  wins.sort((a, b) => b.perCinder - a.perCinder);
  o.wins = wins.slice(0, 12);
  o.winCount = wins.length;
  o.winsTouchingSuspects = wins.filter(w => w.to==='weaponParts' || w.to==='gunOil').length;
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F4B0} REFINERY ARBITRAGE\n');
console.log('  RESOURCES: '+r.ids.length+'   refinery spread: '+r.spread);
console.log('  traded ids with a buy/sell line: '+r.tradedIds.length);
console.log('  ids with NO own price (fall through to the `|| 3` crash guard): '
  + (r.noOwnPrice.length ? r.noOwnPrice.join(', ') : 'none'));
r.noOwnPrice.forEach(id=>console.log('      '+id+'  _resCinderValue='+r.values[id]
  +(r.traderLines[id]?('   but a trader pays sell='+r.traderLines[id].sell+' / buy='+r.traderLines[id].buy):'   (not traded)')));

console.log('');
/* The anti-vacuity guard. Without it "0 profitable loops" is indistinguishable
   from "I found no traders to check" — which is exactly what this file reported
   on its first run. */
ok('the trader catalogue was actually READ (else every result below is vacuous)',
   (r.tradedIds||[]).length>=20, r.tradedIds.length+' traded ids'+(r.scanErr?('  ERR '+r.scanErr):''));
ok('\u{1F3AF} every shipped id has its OWN price — the `|| 3` is unreachable',
   r.noOwnPrice.length===0, r.noOwnPrice.length+' fall through');
ok('\u{1F3AF} NO refine-and-sell loop returns more Cinder than it costs',
   r.winCount===0, r.winCount+' profitable loop(s)');
if(r.winCount){
  console.log('\n  the best loops (buy `from` -> refine -> sell `to`):');
  r.wins.forEach(w=>console.log('    '+String(w.from).padEnd(16)+' -> '+String(w.to).padEnd(14)
    +'  spend '+String(w.spend).padStart(7)+'  earn '+String(Math.round(w.earn)).padStart(8)
    +'  x'+w.perCinder+'   (values '+w.vFrom+' -> '+w.vTo+')'));
  console.log('\n  loops that land on a MISPRICED id: '+r.winsTouchingSuspects);
}
console.log('\n  page errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('    '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
