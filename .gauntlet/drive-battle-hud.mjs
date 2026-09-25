/* ══════════════════════════════════════════════════════════════════════════
   🧭 DRIVE-BATTLE-HUD — is the battle HUD legible, reachable and unclipped?

   THE ASK: "Make this button fit directly in the right ui panel. Move the day,
   and weather ui above, I want to clean the clutter. Make it neat and clean
   where players can see everything cleanly and also make sure nothing overlaps
   anything and everything is showing — like field bag is covered by chat and
   emoji."

   Four claims, each measured rather than eyeballed:
     1. END TURN is INSIDE the right panel's box, not parked beside it.
     2. Day/weather sits ABOVE the tactical rows (compared against the objective
        banner, which is the first of them).
     3. Nothing interactive is BURIED — the honest test is elementFromPoint at
        the control's own centre: "click the middle of this; what do you hit?"
        Field Bag is named explicitly because that is the one that was covered.
     4. Nothing interactive is CLIPPED off the viewport.

   ⚠ A pairwise box overlap is NOT the test, and the first draft of this file
     got that wrong: it reported 21 "overlaps" at 1600x900, of which 17 were a
     container and its own child (leftPanel > bcRail > envCarrier > envRow >
     envLoc). Nesting is how layout works. Pairs where one element contains the
     other are skipped, and the remaining ones are cross-checked against the
     elementFromPoint result so a decorative backdrop behind a button does not
     read as a defect.

   ⚠ CLEAR THE ONBOARDING GATE FIRST. It sits over everything and would make
     every single control read as buried — shot-menus.mjs already lost a pass to
     exactly that and graded nine pages "ok" while showing the overlay.

   Run:  node .gauntlet/drive-battle-hud.mjs [width] [height] [--census]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg'};
const P=7300+(process.pid%90);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const W=+(process.argv[2]||1920), H=+(process.argv[3]||1080);
const CENSUS=process.argv.includes('--census');
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:W,height:H}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame==="function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(5000);

const r=await pg.evaluate(async (dims)=>{
  const o={};
  try{
    localStorage.setItem('mg_onboarded','1');
    document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.auth-gate,#auth-overlay,.modal-overlay')
      .forEach(e=>e.remove());
  }catch(e){}
  App.battlePrep=App.battlePrep||{};
  const me=findHeroById(STARTER_HEROES[0].id), foe=findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero=me; App.battlePrep.multiplayer=false;
  App.state=initGame(me,foe,[],true,null); App.screen='battle';
  /* 🔴 CALL _uiAutoScale() OR EVERY MEASUREMENT BELOW IS TAKEN THROUGH A ZOOM
     THE REAL APP NEVER APPLIES. It is the function that sets the root zoom, it
     EXEMPTS the battle screen (`selfFit`), and its ONLY caller is render() —
     which this harness bypasses by calling renderBattleNow() directly. So the
     zoom left over from the loading screen survived into battle. Measured at
     1366x768 without this line: `html { zoom: 0.783673 }`, `.battle-screen`
     602px tall in a 768px window, and a 166px dead band along the bottom —
     which was reported to the user as a real "letterboxing" defect before the
     control was run. With it: zoom cleared, screen 768px, dead band 0. */
  try{ if(typeof _uiAutoScale==='function') _uiAutoScale(); }catch(e){}
  renderBattleNow();
  await new Promise(r=>setTimeout(r,1500));
  try{ document.querySelectorAll('.onboard-overlay,.tutorial-welcome-modal,.modal-overlay').forEach(e=>e.remove()); }catch(e){}
  await new Promise(r=>setTimeout(r,700));

  const box=(el)=>{const q=el.getBoundingClientRect();
    return {x:Math.round(q.left),y:Math.round(q.top),w:Math.round(q.width),h:Math.round(q.height),
            l:q.left,t:q.top,rt:q.right,bt:q.bottom};};
  const one=(sel)=>{ for(const s of sel.split('|')){ const e=document.querySelector(s.trim()); if(e) return e; } return null; };

  /* Selectors taken from a DOM census of the live battle screen, not guessed. */
  const WANT={
    endTurn:    '#btn-end-turn | .hudx-endturn .endturn',
    rightPanel: '.bp-wrap.bsx',
    envRow:     '.envrow',
    objective:  '.tw-objective-banner',
    fieldBag:   '#btn-bc-bag',
    emote:      '#emote-toggle | #emote-bar',
    battleLog:  '#bsxLog',
    concede:    '#btn-concede',
    prefs:      '#btn-battle-prefs',
    leftRail:   'aside.battle-left',
    bcRail:     '.bc-rail',
  };
  o.found={}; o.missing=[];
  const el={};
  for(const [k,sel] of Object.entries(WANT)){
    const e=one(sel);
    if(!e){ o.missing.push(k); continue; }
    el[k]=e;
    const cs=getComputedStyle(e), q=box(e);
    const vis=q.w>0&&q.h>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0.05;
    const cx=Math.round(q.l+q.w/2), cy=Math.round(q.t+q.h/2);
    const hit=vis?document.elementFromPoint(cx,cy):null;
    const buried=!!(vis&&hit&&hit!==e&&!e.contains(hit)&&!hit.contains(e));
    o.found[k]={...q, vis, z:cs.zIndex,
      buried, hitBy: buried?((hit.id?'#'+hit.id:'')+'.'+String(hit.className||'').split(' ').filter(Boolean).slice(0,2).join('.')):null,
      clipped: !!(vis&&(q.rt>dims.W+1||q.bt>dims.H+1||q.l<-1||q.t<-1))};
  }

  /* ── 1. END TURN inside the right panel ──────────────────────────────── */
  if(el.endTurn&&el.rightPanel){
    const a=box(el.endTurn), p=box(el.rightPanel);
    o.etInPanelDom = el.rightPanel.contains(el.endTurn);
    o.etInPanelBox = a.l>=p.l-1 && a.rt<=p.rt+1 && a.t>=p.t-1 && a.bt<=p.bt+1;
    o.etSlackL=Math.round(a.l-p.l); o.etSlackR=Math.round(p.rt-a.rt);
  }
  /* ── 2. day/weather up in the band, beside the hero frames ───────────── */
  const band=document.querySelector('.hudx-topband');
  const banners=document.querySelector('.hudx-banners');
  const fighters=document.querySelector('#fighters');
  if(el.envRow){
    o.envInBand   = !!(band && band.contains(el.envRow));
    o.envInLeftRail = !!(el.leftRail && el.leftRail.contains(el.envRow));
    if(fighters){
      const e=box(el.envRow), f=box(fighters);
      /* "next to the hero health … with the hero frame": same row, not stacked,
         and actually adjacent rather than at the far end of the band. */
      o.envBesideHeroes = Math.abs((e.t+e.h/2)-(f.t+f.h/2)) < f.h;
      o.envGapToHeroes  = Math.round(f.l - e.rt);
    }
    /* In the BAND it must not sit ON either rail — the band is z=62 over them.
       In the RAIL it is legitimately inside the left one, so the test only
       applies to the band placement. */
    const rr=el.rightPanel?box(el.rightPanel):null, lr=el.leftRail?box(el.leftRail):null;
    const e2=box(el.envRow);
    o.envClearOfRails = !o.envInBand ? true
      : !!( (!lr || e2.l >= lr.rt-1) && (!rr || e2.rt <= rr.l+1) );
    if(el.bcRail){
      const kids=Array.from(el.bcRail.children);
      o.envRailIndex=kids.findIndex(k=>k===el.envRow||k.contains(el.envRow));
      o.envRailKids=kids.length;
    }
    /* the budget hud.js measured to choose between the two homes */
    if(band&&fighters){
      const railW=parseFloat(getComputedStyle(document.documentElement)
                    .getPropertyValue('--btl-rail-w'))||336;
      o.bandRoom=Math.floor((box(band).w - box(fighters).w)/2 - railW - 24);
    }
  }
  /* ── 2b. the kit moved to the right rail ─────────────────────────────── */
  const kit=document.querySelector('.hudx-kit');
  o.kitInRightRail = !!(kit && el.rightPanel && el.rightPanel.contains(kit));
  if(kit){
    o.kitParts=['.ultbtn','.consbox','#btn-bc-bag'].filter(s=>kit.querySelector(s)).length;
    const k=box(kit), p=el.rightPanel?box(el.rightPanel):null;
    o.kitInPanelBox = !!(p && k.l>=p.l-1 && k.rt<=p.rt+1 && k.t>=p.t-1 && k.bt<=p.bt+1);
    o.kitH=Math.round(k.h); o.kitLayoutH=kit.offsetHeight;
    /* the 989px bug: a carrier that inherits min-height:100% reports a box many
       times its own content and starves every sibling. Guard the ratio. */
    const kids=Array.from(kit.children).reduce((a,c)=>a+c.offsetHeight,0);
    o.kitContentH=kids;
    o.kitNotStretched = kit.offsetHeight <= kids*1.5 + 40;
  }
  /* ── 2c. the left rail got BIGGER, which is the readability ask ──────── */
  if(el.bcRail){
    o.leftZoom=parseFloat(getComputedStyle(el.bcRail).zoom)||1;
    const cut=[];
    el.bcRail.querySelectorAll('*').forEach(e=>{
      if(e.children.length) return;                       // leaf text nodes only
      if(e.scrollWidth>e.clientWidth+1&&e.clientWidth>0)
        cut.push((e.className||e.tagName)+' "'+(e.textContent||'').trim().slice(0,28)+'"');
    });
    o.leftTruncated=cut;
  }
  /* the two cards must sit SIDE BY SIDE, not stacked — losing the `.bcp`
     scope on the move silently stacked them once already */
  /* ⚠ LAYOUT px, NOT SCREEN px. `_bcpFit()` scales the whole left rail, so the
     row's getBoundingClientRect width is the SCALED one and tells you nothing
     about how many grid tracks fit. chrome.css asks for
     `repeat(auto-fit, minmax(148px, 1fr))` — "two across while they fit,
     stacked once they do not" — and that decision is made in unscaled px, which
     is `offsetWidth`. At 2560x1440 the rail zooms UP, so 319 screen px is only
     290 layout px and the row legitimately reflows to one column. That is the
     designed fallback, it predates this change, and asserting "always two"
     would be asserting a bug into the suite. */
  if(el.envRow){
    const c=getComputedStyle(el.envRow);
    o.envLayoutW=el.envRow.offsetWidth;
    o.envTracks=c.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
    o.envFitsTwo=o.envLayoutW >= 2*148 + parseFloat(c.columnGap||0);
    o.envGrid=c.gridTemplateColumns+'  gap='+c.columnGap
      +'  layoutW='+o.envLayoutW+'  screenW='+Math.round(el.envRow.getBoundingClientRect().width);
  }
  const cards=Array.from(document.querySelectorAll('.envcard'));
  /* a card whose content is wider than its own box is a card losing text */
  o.envOverflow=cards.filter(c=>c.scrollWidth>c.clientWidth+1).length;
  o.envCards=cards.length;
  if(cards.length===2){
    const a=box(cards[0]), b2=box(cards[1]);
    o.envSideBySide = Math.abs(a.t-b2.t)<4 && b2.l>=a.rt-1;
    o.envCardW=Math.round(a.w);
  }
  /* the day/night banner duplicated the weather card verbatim; it is folded */
  const dn=document.querySelector('.daynight-banner');
  o.dnFolded = !dn || getComputedStyle(dn).display==='none';

  /* ── 3/4. every interactive control: buried? clipped? ─────────────────── */
  const inter=[];
  document.querySelectorAll('.battle-screen button, .battle-screen .cardslot, .battle-screen [role="button"]')
    .forEach(e=>{
      const q=box(e), cs=getComputedStyle(e);
      if(q.w<10||q.h<10) return;
      if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.05) return;
      if(e.disabled) return;
      inter.push({e,q});
    });
  o.interCount=inter.length;
  o.buriedList=[]; o.clippedList=[];
  for(const it of inter){
    const cx=Math.round(it.q.l+it.q.w/2), cy=Math.round(it.q.t+it.q.h/2);
    if(cx<0||cy<0||cx>dims.W||cy>dims.H){ /* centre off-screen -> clipped, below */ }
    else{
      const hit=document.elementFromPoint(cx,cy);
      if(hit&&hit!==it.e&&!it.e.contains(hit)&&!hit.contains(it.e))
        o.buriedList.push(((it.e.id?'#'+it.e.id:'')||'.'+String(it.e.className||'').split(' ')[0])
          +' under '+((hit.id?'#'+hit.id:'')||'.'+String(hit.className||'').split(' ')[0]));
    }
    if(it.q.rt>dims.W+1||it.q.bt>dims.H+1||it.q.l<-1||it.q.t<-1)
      o.clippedList.push(((it.e.id?'#'+it.e.id:'')||'.'+String(it.e.className||'').split(' ')[0])
        +' by '+Math.round(Math.max(it.q.rt-dims.W,it.q.bt-dims.H,-it.q.l,-it.q.t))+'px');
  }

  /* ── 5. THEY STILL WORK. Re-parenting is the whole technique here, and the
     failure mode of a bad re-parent is a control that looks perfect and does
     nothing — `.hudx-endturn` is `pointer-events:none` with the wrap set back
     to `auto`, so a careless move loses the click without moving a pixel.
     So: press the things, and read the game state. ─────────────────────── */
  const hits=(e)=>{ if(!e) return null;
    const q=box(e), h=document.elementFromPoint(Math.round(q.l+q.w/2), Math.round(q.t+q.h/2));
    return !!(h && (h===e || e.contains(h) || h.contains(e))); };
  /* ⚠ ORDER MATTERS, AND GETTING IT WRONG COSTS A FALSE FAILURE. Pressing END
     TURN makes renderBattle() rebuild the whole screen, so every node captured
     above becomes a DETACHED copy — elementFromPoint then returns the NEW field
     bag, which is a different object, and the check reports the bag as
     unreachable when nothing is wrong with it. It did, on the first run of this
     section. So every read happens first and the one destructive act is last. */
  o.bagHitIsButton = hits(el.fieldBag);
  o.wthrHitIsCard  = hits(document.querySelector('.envcard.wthr'));
  o.etHitIsButton  = hits(el.endTurn);
  /* The click itself is deferred to a SECOND evaluate so the screenshot in
     between captures a normal player turn — pressing END TURN here would leave
     every shot showing "ENEMY ACTING…" behind a full-screen turn banner, which
     is a useless picture of the layout this driver exists to check. */

  /* the fitted constants, read from the live page */
  const rs=getComputedStyle(document.documentElement);
  o.vars={};
  ['--btl-rail-w','--r3-rail-r-real','--bpw','--hudx-et-h'].forEach(v=>{o.vars[v]=rs.getPropertyValue(v).trim()||'(unset)';});
  const bpw=document.querySelector('.bp-wrap.bsx');
  if(bpw){
    const body=bpw.querySelector('.bsx-body');
    o.bsxBody=body?Math.round(body.getBoundingClientRect().height):null;
    o.railOverflow=0;
    bpw.querySelectorAll('*').forEach(e=>{const q=e.getBoundingClientRect();
      if(q.width>4&&q.right>dims.W+1) o.railOverflow++;});
  }
  if(dims.census){
    o.census=[];
    document.querySelectorAll('.battle-screen *').forEach(e=>{
      const q=e.getBoundingClientRect(); if(q.width<8||q.height<8) return;
      const cs=getComputedStyle(e);
      if(!(e.tagName==='BUTTON'||cs.position==='fixed'||cs.position==='absolute')) return;
      o.census.push(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')
        +(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,3).join('.'):'')
        +'  ['+Math.round(q.left)+','+Math.round(q.top)+' '+Math.round(q.width)+'x'+Math.round(q.height)+']'
        +' pos='+cs.position+' z='+cs.zIndex);
    });
  }
  return o;
}, {W,H,census:CENSUS});

const out=path.resolve('.gauntlet/shots'); fs.mkdirSync(out,{recursive:true});
await pg.screenshot({path:path.join(out,'hud-'+W+'x'+H+'.png')});

/* NOW press it — after the picture is taken. See the note in the eval. */
const press=await pg.evaluate(async ()=>{
  const before=App.state.turnNumber+'/'+App.state.turn;
  const b=document.querySelector('#btn-end-turn');
  if(!b) return {before, after:before, worked:false, why:'no #btn-end-turn'};
  b.click();
  await new Promise(r=>setTimeout(r,900));
  const after=App.state.turnNumber+'/'+App.state.turn;
  return {before, after, worked: after!==before};
});
r.etBefore=press.before; r.etAfter=press.after; r.etWorked=press.worked;

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F9ED} BATTLE HUD @ '+W+'x'+H+'\n');
for(const [k,v] of Object.entries(r.found))
  console.log('  '+k.padEnd(12)+' ['+String(v.x).padStart(5)+','+String(v.y).padStart(5)+' '
    +String(v.w).padStart(4)+'x'+String(v.h).padStart(3)+']'+(v.vis?'':' HIDDEN')
    +(v.clipped?' CLIPPED':'')+(v.buried?('  BURIED under '+v.hitBy):''));
if(r.missing.length) console.log('  not found: '+r.missing.join(', '));
console.log('  rails: '+Object.entries(r.vars).map(([k,v])=>k.replace('--','')+'='+v).join('  ')+'   bsx-body='+r.bsxBody);

console.log('\n1\u{FE0F}\u{20E3} END TURN belongs to the right panel');
ok('\u{1F3AF} it is a DOM child of the panel, not a sibling floating beside it', r.etInPanelDom===true);
ok('\u{1F3AF} ...and its box is inside the panel\'s box', r.etInPanelBox===true,
   'slack L='+r.etSlackL+'px R='+r.etSlackR+'px');
ok('it is not clipped', r.found.endTurn && !r.found.endTurn.clipped);

/* ── TWO LEGAL HOMES, AND THE MEASUREMENT DECIDES WHICH ────────────────────
   Beside the hero frames is the ask, and it is what a wide screen gets. But the
   banners row is CENTRED, so parking the conditions next to it widens the whole
   group and drives its left edge into the left rail: the budget is
   2 x rail + envrow + gap + fighters <= window, and below the crossing there is
   simply no room (1510 needed of a 1366 window). hud.js measures the gutter and
   falls back to the head of the left rail. Asserting "always in the band" would
   demand an overlap — which is the exact defect this round is about — so the
   gate checks whichever home was chosen, and checks the CHOICE against the same
   budget so a wide screen can never quietly take the fallback. */
console.log('\n2\u{FE0F}\u{20E3} day / weather — beside the hero frames where there is room');
console.log('   band gutter: '+r.bandRoom+'px  ->  home: '+(r.envInBand?'TOP BAND':'head of the left rail'));
ok('\u{1F3AF} the placement matches the measured room (>=210px -> band)',
   r.envInBand === (r.bandRoom>=210), 'room '+r.bandRoom+'px, inBand='+r.envInBand);
if(r.envInBand){
  ok('\u{1F3AF} beside the hero frames, on their row', r.envBesideHeroes===true,
     'gap to the FOE banner: '+r.envGapToHeroes+'px');
  ok('\u{1F3AF} and clear of BOTH rails (the band is z=62 over them)', r.envClearOfRails===true);
  ok('\u{1F3AF} two cards across up here', r.envSideBySide===true,
     r.envTracks+' tracks at '+r.envLayoutW+'px layout');
}else{
  ok('\u{1F3AF} FALLBACK: it is the FIRST block in the left rail, still above the clutter',
     r.envRailIndex===0, 'index '+r.envRailIndex+' of '+r.envRailKids);
}
console.log('  envrow grid: '+r.envGrid);
ok('both cards survived the move', r.envCards===2, r.envCards+' cards');
/* Two-across is pinned in the BAND (§4b) and left to chrome.css's auto-fit in
   the rail, so the track count is asserted above, inside the branch that knows
   which home was used. What holds in BOTH is that no card loses text. */
ok('no card overflows its track in either home', (r.envOverflow|0)===0, r.envOverflow+' overflowing');
ok('the duplicate day/night banner is folded away', r.dnFolded===true);

console.log('\n2\u{FE0F}\u{20E3}b ULTIMATE \u{B7} CONSUMABLES \u{B7} FIELD BAG moved to the right rail');
ok('\u{1F3AF} the kit is in the right panel', r.kitInRightRail===true);
ok('\u{1F3AF} ...inside its box, not spilling out', r.kitInPanelBox===true);
ok('all three parts came with it', r.kitParts===3, r.kitParts+'/3');
/* The 989px bug: a carrier inherits `.bcp`'s min-height:100%, reports a box many
   times its content, and starves every sibling — it collapsed the pile grid to
   zero. Cheap to assert, and it would have caught it in one run. */
ok('\u{1F3AF} the carrier is CONTENT-sized, not stretched by .bcp min-height:100%',
   r.kitNotStretched===true, r.kitLayoutH+'px box for '+r.kitContentH+'px of content');

console.log('\n2\u{FE0F}\u{20E3}c the left rail is more readable for it');
/* ⚠ NOT ">= 1.0". `_bcpFit` scales to FIT, so the zoom a rail reaches depends on
   the viewport, and demanding 1.0 everywhere fails a short screen for being
   short. The bar is the defect the ask names: at 1366x768 the loaded rail
   rendered at zoom 0.50 — half size, which is what "make the left ui more
   viewable" was about. Emptying it takes that to 0.85, and 1.20 at 1920.
   0.8 is a floor no measured viewport reaches from below any more, and one the
   pre-change layout failed outright at 1366 and 1280. */
ok('\u{1F3AF} the emptied rail is out of the unreadable range (was 0.50 at 1366)',
   (r.leftZoom||0)>=0.8, 'zoom '+r.leftZoom);
ok('\u{1F3AF} ...without truncating any of its text', (r.leftTruncated||[]).length===0,
   (r.leftTruncated||[]).length+' clipped strings');
(r.leftTruncated||[]).slice(0,5).forEach(x=>console.log('        '+x));

console.log('\n3\u{FE0F}\u{20E3} nothing is covering anything ('+r.interCount+' live controls)');
ok('\u{1F3AF} FIELD BAG is reachable', r.found.fieldBag && !r.found.fieldBag.buried,
   r.found.fieldBag ? (r.found.fieldBag.buried?('buried under '+r.found.fieldBag.hitBy):'clear') : 'NOT FOUND');
ok('\u{1F3AF} no control is buried under another', (r.buriedList||[]).length===0,
   (r.buriedList||[]).length+' buried');
(r.buriedList||[]).slice(0,8).forEach(x=>console.log('        '+x));

console.log('\n4\u{FE0F}\u{20E3} everything is showing');
ok('\u{1F3AF} no control is clipped off the viewport', (r.clippedList||[]).length===0,
   (r.clippedList||[]).length+' clipped');
(r.clippedList||[]).slice(0,8).forEach(x=>console.log('        '+x));
ok('\u{1F3AF} no right-rail content crosses the right edge', (r.railOverflow|0)===0,
   r.railOverflow+' elements over');

console.log('\n5\u{FE0F}\u{20E3} the moved controls still WORK (a bad re-parent looks perfect and does nothing)');
ok('\u{1F3AF} END TURN\'s centre actually hits END TURN', r.etHitIsButton===true);
ok('\u{1F3AF} ...and pressing it advances the turn', r.etWorked===true, r.etBefore+' -> '+r.etAfter);
ok('FIELD BAG\'s centre hits FIELD BAG', r.bagHitIsButton===true);
ok('the WEATHER card is still a live button after the hoist', r.wthrHitIsCard===true);

console.log('\n  page errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('    '+e));
console.log('  wrote shots/hud-'+W+'x'+H+'.png');
if(r.census){ console.log('\n  \u{1F4CB} census ('+r.census.length+')'); r.census.forEach(c=>console.log('    '+c)); }
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
