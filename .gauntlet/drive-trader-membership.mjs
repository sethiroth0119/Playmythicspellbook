/* ══════════════════════════════════════════════════════════════════════════
   🪪 DRIVE-TRADER-MEMBERSHIP — the capacity header, the shop, and the maths.

   ⚠ WHAT THIS FILE CANNOT TEST, STATED UP FRONT SO A GREEN RUN IS NOT READ AS
     MORE THAN IT IS. The actual cap is three BEFORE INSERT triggers installed
     by sql/053; they live in Postgres and cannot be exercised from a signed-out
     harness. This drives the CLIENT half: that the module loads without the
     globals it is not allowed to see, that the numbers it renders are the ones
     the server handed it, that it never invents a balance, and that the "full"
     state appears at exactly the cap and not a listing early.
     The database half is verified in the migration's own VERIFY block and by
     the counts read back after applying it.

   The interesting cases are the ones where a capacity meter lies:
     · it must not show 15/15 before the server has answered — a Market Tycoon
       seeing "15" for one frame would conclude they lost what they paid for
     · full must be `used >= slots`, not `>`
     · a failed purchase must not move the local balance or the tier
     · the tier list must match the brief exactly, prices included

   Run:  node .gauntlet/drive-trader-membership.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=8010+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1400,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!window.MythicTrader',null,{timeout:120000}).catch(()=>{});
await pg.waitForTimeout(2500);

const r=await pg.evaluate(async ()=>{
  const o={};
  const T=window.MythicTrader;
  o.loaded=!!T;
  if(!T) return o;
  o.hostPresent=!!window.MythicTraderHost;

  /* the catalogue, against the brief */
  o.tiers=T.TIERS.map(t=>t.id+':'+t.slots+':'+t.aza).join(' ');
  o.free=T.FREE_SLOTS;

  /* 1. BEFORE the server answers, the header must not claim a number. */
  const pre=T.snapshot();
  o.preKnown=pre.known;
  o.preHtml=T.capacityHtml();
  o.preClaimsNumbers=/\d+\s*\/\s*\d+/.test(o.preHtml);

  /* 2. Feed it a server answer the way the RPC would, then read the header.
        A fake host is installed so nothing here needs a signed-in session. */
  let lastRpc=null, azaSet=null;
  window.MythicTraderHost = Object.assign({}, window.MythicTraderHost, {
    rpc: async (fn, args) => {
      lastRpc={fn,args};
      if(fn==='trader_membership_status')
        return {ok:true, tier:'merchant', name:'Merchant', slots:55, used:47, remaining:8};
      if(fn==='trader_buy_membership')
        return {ok:true, tier:'professional', name:'Professional Trader', slots:80, used:47, charged:35, aza:12};
      return null;
    },
    aza: () => 500,
    setAza: (n) => { azaSet=n; },
    toast: () => {}, confirm: async () => true, render: () => {},
  });
  await T.refresh(true);
  const s1=T.snapshot();
  o.tier=s1.tier; o.slots=s1.slots; o.used=s1.used; o.remaining=s1.remaining;
  const html=T.capacityHtml();
  o.showsUsedOfSlots=/47\s*\/\s*55/.test(html);
  o.showsName=/Merchant/.test(html);
  o.showsRemaining=/>8</.test(html);
  o.fullAt47=T.isFull();
  o.nextTier=(T.nextTier()||{}).id||null;

  /* 3. FULL is `>=`, not `>`. 55/55 must read as full; 54 must not. */
  await (async()=>{
    window.MythicTraderHost.rpc=async(fn)=>fn==='trader_membership_status'
      ? {ok:true,tier:'merchant',name:'Merchant',slots:55,used:54,remaining:1} : null;
    await T.refresh(true); o.fullAt54=T.isFull();
    window.MythicTraderHost.rpc=async(fn)=>fn==='trader_membership_status'
      ? {ok:true,tier:'merchant',name:'Merchant',slots:55,used:55,remaining:0} : null;
    await T.refresh(true); o.fullAt55=T.isFull();
    o.fullHtml=T.capacityHtml();
  })();
  o.fullPanelShown=/CAPACITY REACHED/.test(o.fullHtml);
  o.fullOffersMemberships=/View Memberships/.test(o.fullHtml);

  /* 4. the shop lists every tier with its price */
  const shop=T.shopHtml();
  o.shopHasAll=['Survivor Trader','Street Trader','Merchant','Professional Trader','Trade Company','Market Tycoon']
    .every(n=>shop.indexOf(n)>=0);
  /* ⚠ MATCH THE BUTTON, NOT THE STRING. The first version of this counted loose
     substrings and read 4 of 5 for two compounding reasons, neither a product
     bug: '9 AZA' is a substring of '69 AZA', and a tier the player ALREADY has
     correctly shows "Included" instead of a price. Parsed off the buy buttons,
     so it asks the real question — does every tier above the current one offer
     its exact price? */
  o.shopOffers=(shop.match(/data-tm-buy="([a-z]+)"[^>]*>[^<]*?(\d+) AZA/g)||[])
    .map(m=>{const g=/data-tm-buy="([a-z]+)"[^>]*>[^<]*?(\d+) AZA/.exec(m); return g[1]+':'+g[2];})
    .join(' ');
  o.shopSaysCapacityOnly=/capacity only/i.test(shop);
  /* owned tiers must not offer a buy button */
  o.shopBuyable=(shop.match(/data-tm-buy=/g)||[]).length;

  /* 5. a purchase ADOPTS the server's numbers and never computes a balance */
  window.MythicTraderHost.rpc=async(fn,args)=>{
    lastRpc={fn,args};
    if(fn==='trader_buy_membership')
      return {ok:true,tier:'professional',name:'Professional Trader',slots:80,used:55,charged:35,aza:12};
    return null;
  };
  await T.buy('professional');
  const s2=T.snapshot();
  o.buySentTier=(lastRpc&&lastRpc.args&&lastRpc.args.p_tier)||null;
  o.afterBuySlots=s2.slots; o.afterBuyTier=s2.tier;
  o.azaAdopted=azaSet;

  /* 7. THE STOREFRONT. The Upgrade button must LAND somewhere that sells the
        thing — it used to route to the Base Vault bag overlay, a different
        screen with the memberships behind a modal the player had to find. */
  o.openShopLanded = (function () {
    try {
      App.screen = 'title'; App.vendorMarketTab = null;
      window.MythicTraderHost.openShop();
      return App.screen + '/' + App.vendorMarketTab;
    } catch (e) { return 'threw: ' + e; }
  })();
  /* and the tab body actually builds, with tiers in it */
  o.vmBody = (function () {
    try {
      const h = _buildTraderShopBody();
      return { len: h.length, hasTiers: /data-tm-buy=/.test(h), hasCap: /tm-cap/.test(h),
               unavailable: /unavailable/.test(h) };
    } catch (e) { return { err: String(e) }; }
  })();
  /* the tab is offered in the vendor market's own tab bar */
  o.vmTabPresent = (function () {
    try {
      App.screen = 'vendorMarket'; App.vendorMarketTab = 'trader';
      renderVendorMarket();
      const btn = document.querySelector('[data-vm-tab="trader"]');
      const body = document.querySelector('.tm-vm');
      return { tab: !!btn, active: !!(btn && btn.className.indexOf('vm-tab-active') >= 0),
               body: !!body, buys: document.querySelectorAll('[data-tm-buy]').length };
    } catch (e) { return { err: String(e) }; }
  })();

  /* 6. a FAILED purchase must move nothing */
  window.MythicTraderHost.rpc=async()=>({ok:false,error:'insufficient_aza',price:125});
  azaSet=null;
  const okFail=await T.buy('tycoon');
  const s3=T.snapshot();
  o.failReturned=okFail;
  o.failLeftSlots=s3.slots; o.failLeftTier=s3.tier; o.failTouchedAza=azaSet;
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1FAAA} TRADER MEMBERSHIPS (client half)\n');
ok('the module loaded without the globals it cannot see', r.loaded===true);
if(r.loaded){
  console.log('   tiers: '+r.tiers+'\n');
  ok('index.html installed the host bridge', r.hostPresent===true);
  ok('the free tier is 15 slots', r.free===15, String(r.free));
  ok('\u{1F3AF} the six tiers match the brief, slots and prices',
     r.tiers==='survivor:15:0 street:35:9 merchant:55:19 professional:80:35 company:140:69 tycoon:300:125',
     r.tiers);
  console.log('');
  ok('\u{1F3AF} before the server answers it claims NO numbers',
     r.preKnown===false&&r.preClaimsNumbers===false,
     'known='+r.preKnown+' printedNumbers='+r.preClaimsNumbers);
  ok('after the answer it shows used / slots', r.showsUsedOfSlots===true);
  ok('...the membership name', r.showsName===true);
  ok('...and the remaining count', r.showsRemaining===true, 'remaining='+r.remaining);
  console.log('');
  ok('47 of 55 is NOT full', r.fullAt47===false);
  ok('54 of 55 is NOT full', r.fullAt54===false);
  ok('\u{1F3AF} 55 of 55 IS full (>=, not >)', r.fullAt55===true);
  ok('...and the capacity panel appears', r.fullPanelShown===true);
  ok('...offering the memberships rather than a dead end', r.fullOffersMemberships===true);
  console.log('');
  ok('the shop lists all six tiers', r.shopHasAll===true);
  /* A Merchant is offered exactly the three tiers above them, at the brief's
     prices. Tiers at or below are "Included" — a shop that offered to sell a
     player what they already have would be the real bug here. */
  ok('\u{1F3AF} every tier ABOVE the current one is offered at its brief price',
     r.shopOffers==='professional:35 company:69 tycoon:125', r.shopOffers);
  ok('...and states it is capacity only', r.shopSaysCapacityOnly===true);
  ok('tiers at or below the current one are not for sale', r.shopBuyable>0&&r.shopBuyable<5,
     r.shopBuyable+' buyable of 5 paid tiers (owner is Merchant)');
  console.log('');
  ok('\u{1F3AF} buying sends the tier id to the RPC', r.buySentTier==='professional', String(r.buySentTier));
  ok('\u{1F3AF} ...and ADOPTS the server\'s slots, never its own', r.afterBuySlots===80&&r.afterBuyTier==='professional',
     r.afterBuyTier+' / '+r.afterBuySlots);
  ok('\u{1F3AF} ...and adopts the server\'s AZA balance', r.azaAdopted===12, 'setAza('+r.azaAdopted+')');
  console.log('\n\u{1F3EA} the storefront — where "Upgrade Trader Membership" lands');
  ok('\u{1F3AF} Upgrade opens the Vendor Market\'s TRADER tab (was basevault/bags)',
     r.openShopLanded==='vendorMarket/trader', r.openShopLanded);
  ok('the tab body builds', (r.vmBody||{}).len>200&&!(r.vmBody||{}).unavailable,
     JSON.stringify(r.vmBody));
  ok('\u{1F3AF} ...with buyable tiers in it', (r.vmBody||{}).hasTiers===true);
  ok('...and the capacity readout above them', (r.vmBody||{}).hasCap===true);
  ok('\u{1F3AF} the Vendor Market renders the tab, selected, with live buy buttons',
     !!(r.vmTabPresent&&r.vmTabPresent.tab&&r.vmTabPresent.active&&r.vmTabPresent.body&&r.vmTabPresent.buys>0),
     JSON.stringify(r.vmTabPresent));
  console.log('');
  ok('\u{1F3AF} a FAILED purchase returns false', r.failReturned===false);
  ok('\u{1F3AF} ...and moves neither the tier nor the slots',
     r.failLeftSlots===80&&r.failLeftTier==='professional', r.failLeftTier+' / '+r.failLeftSlots);
  ok('\u{1F3AF} ...and never touches the AZA balance', r.failTouchedAza===null, String(r.failTouchedAza));
}
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
