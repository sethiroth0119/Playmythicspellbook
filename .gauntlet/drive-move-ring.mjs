/* 🎯 DRIVE-MOVE-RING — the Attack row opens the unit's moves ON the board.
   Asked for: picking Attack shows the moves around the unit instead of taking
   the player to the details panel.
   The interesting assertions are not "a ring appeared" but: it has one chip per
   KNOWN MOVE, clicking one SELECTS that move (which is what lights the target
   fan), the modal did NOT open, and the modal still DOES open when the ring has
   nothing to show — a silent failure there would leave Attack doing nothing.

   🔴 SECOND ASK, AND THE DANGEROUS HALF: the left-rail Cancel was DELETED. That
   is only safe if a cancel exists in BOTH states the rail used to cover —
   ring-open ("which move?") and armed ("pick a target"). The armed state is the
   trap: it has no ring, so a driver that only checks the ring would pass while
   the player is stuck with no exit. Both are asserted below, and so is the rail
   button's ABSENCE — otherwise "cancel works" could be the old rail button all
   along and the new chips could be doing nothing.

   Run:  node .gauntlet/drive-move-ring.mjs */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=7620+(process.pid%60);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1600,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame==="function" && typeof _openMoveRing==="function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(5000);
let fails=0; const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
const r=await pg.evaluate(async ()=>{
  const o={}; const nap=(ms)=>new Promise(res=>setTimeout(res,ms));
  const RECT={left:600,top:400,width:60,height:80,right:660,bottom:480,x:600,y:400};
  App.battlePrep=App.battlePrep||{};
  const me=findHeroById(STARTER_HEROES[0].id), foe=findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero=me; App.battlePrep.multiplayer=false;
  App.state=initGame(me,foe,[],true,null); App.screen='battle';
  /* render() is what calls _uiAutoScale(); renderBattleNow() is not, so without
     this the ring is measured through a stale root zoom. */
  try{ if(typeof _uiAutoScale==='function') _uiAutoScale(); }catch(e){}
  const u=App.state.units.find(x=>x.owner==='player'&&x.alive);
  o.moves=(u.knownMoves||[]).length;
  App.ui=App.ui||{}; App.ui.modalUnitId=null;
  App.state.player.energy=99;                       // afford everything
  /* the rect the hover menu would have captured */
  _uhmRect={...RECT};
  o.opened=_openMoveRing(u.id);
  await nap(250);
  const ring=document.getElementById('move-ring');
  o.ringInDom=!!ring;
  /* 🔴 .mvr-move, NOT .mvr-chip — the Cancel chip is a .mvr-chip too, so
     counting the base class would report moves+1 and "one chip per move" would
     fail for a reason that has nothing to do with the moves. */
  o.chips=ring?ring.querySelectorAll('.mvr-move').length:0;
  o.names=ring?[...ring.querySelectorAll('.mvr-move .mvr-name')].map(n=>n.textContent).slice(0,4):[];
  o.tinted=ring?[...ring.querySelectorAll('.mvr-move')].filter(c=>/--mvr-col/.test(c.getAttribute('style')||'')).length:0;
  o.ringCancels=ring?ring.querySelectorAll('.mvr-cancel').length:0;

  /* 📏 THE RANGE BADGE, CHECKED AGAINST THE ENGINE — not merely "a number is
     present". The chip must print getEffectiveAttackRange(unit, move), which is
     what validAttacks and _hoverAttackReach both use; printing the base
     `move.range` instead would put a figure on the button that disagrees with
     the arrows drawn from that very move, and a confidently wrong range is
     worse than no range. Recomputed here from the engine and compared. */
  if(ring){
    const bad=[]; let shown=0;
    ring.querySelectorAll('.mvr-move').forEach(c=>{
      const id=c.getAttribute('data-mvr-move');
      const m=lookupMove(id);
      const badge=c.querySelector('.mvr-rng');
      const want=(m&&m.kind==='attack')?(getEffectiveAttackRange(u,m)|0):((m&&m.range|0)||0);
      if(want>0){
        if(!badge){ bad.push(id+' has range '+want+' but NO badge'); return; }
        shown++;
        const got=parseInt(String(badge.textContent).replace(/[^0-9]/g,''),10);
        if(got!==want) bad.push(id+' badge '+got+' != effective '+want);
      } else if(badge) bad.push(id+' has a badge but no range');
    });
    o.rngShown=shown; o.rngBad=bad;
  }

  /* ── the hover tab must be GONE while the ring is up ─────────────────────
     The ask is explicit: "make sure the hover tab that shows attack move etc
     do not show up". The ring IS the decision now; the tab behind it would be
     a second, competing one. */
  o.suppressed=(typeof _hoverMenuSuppressed==='function')?_hoverMenuSuppressed():null;

  /* clicking a chip must SELECT the move — that is what lights the target fan */
  const before=App.ui.selectedMoveId||null;
  if(ring){ const c=ring.querySelector('.mvr-move:not(.is-off)'); o.clicked=c?c.getAttribute('data-mvr-move'):null; if(c) c.click(); }
  await nap(350);
  o.selBefore=before; o.selAfter=App.ui.selectedMoveId||null;
  o.mode=App.ui.actionMode||null;
  o.ringClosed=!document.getElementById('move-ring');
  o.modalOpened=!!App.ui.modalUnitId;

  /* ── ARMED STATE: "pick a target". The rail button used to be the only exit
     here. If this reads false the feature shipped a dead end. ─────────────── */
  o.tcArmed=!!document.getElementById('target-cancel');
  renderBattleNow(); await nap(300);
  o.railCancelWhileArmed=!!document.getElementById('bc-cancel-sel');
  o.tcSurvivesRender=!!document.getElementById('target-cancel');
  const tc=document.querySelector('#target-cancel .mvr-cancel');
  if(tc) tc.click();
  await nap(300);
  o.selAfterTC=App.ui.selectedMoveId||null;
  o.unitAfterTC=App.ui.selectedUnitId||null;
  o.tcGone=!document.getElementById('target-cancel');

  /* ── THE LEAK: the attack RESOLVES and nobody called cancel. 26 sites clear
     selectedMoveId; if the chip's lifetime were wired to those call sites this
     is where a stale "Cancel attack" would be left floating over a unit that is
     already done. Simulated by clearing the state the way any of them does and
     letting the render run — no cancel path is touched. ─────────────────── */
  App.ui.selectedUnitId=u.id; App.ui.selectedMoveId='slash'; App.ui.actionMode='attack';
  renderBattleNow(); await nap(250);
  o.tcReArmed=!!document.getElementById('target-cancel');
  App.ui.selectedMoveId=null;                       // <- the attack landed
  renderBattleNow(); await nap(250);
  o.tcAfterResolve=!!document.getElementById('target-cancel');

  /* ── the RING's own Cancel: closes the ring and drops the unit ─────────── */
  App.ui.selectedMoveId=null; App.ui.actionMode=null; App.ui.modalUnitId=null;
  App.state.player.energy=99; _uhmRect={...RECT};
  _openMoveRing(u.id); await nap(200);
  App.ui.selectedUnitId=u.id;
  const rc=document.querySelector('#move-ring .mvr-cancel');
  o.ringCancelFound=!!rc;
  if(rc) rc.click();
  await nap(300);
  o.ringGoneAfterCancel=!document.getElementById('move-ring');
  o.selUnitAfterRingCancel=App.ui.selectedUnitId||null;
  o.modalAfterRingCancel=!!App.ui.modalUnitId;

  /* affordability is SHOWN, not hidden */
  App.state.player.energy=0; _uhmRect={...RECT};
  _openMoveRing(u.id); await nap(200);
  const r2=document.getElementById('move-ring');
  o.chipsBroke=r2?r2.querySelectorAll('.mvr-move').length:0;
  o.offBroke=r2?r2.querySelectorAll('.mvr-move.is-off').length:0;
  o.cancelNotDimmed=r2?r2.querySelectorAll('.mvr-cancel.is-off').length:0;   // must be 0 — you can always leave
  _closeMoveRing();
  /* ── GEOMETRY, MEASURED NOT REASONED. The move sweep runs -150deg to +150deg
     THROUGH 0 (right) — so it passes straight down, and "put Cancel below the
     unit" collides at larger move counts even though it looks clear at 2. The
     ring has never been seen with a full set, so this builds one and asserts
     no chip's box overlaps any other's. ───────────────────────────────────── */
  const many=Object.keys(MOVES).slice(0,8);
  const big={...u, id:'many_unit', knownMoves:many};
  App.state.units.push(big);
  App.state.player.energy=999; App.ui.modalUnitId=null; _uhmRect={...RECT};
  _openMoveRing('many_unit'); await nap(250);
  const r3=document.getElementById('move-ring');
  o.bigChips=r3?r3.querySelectorAll('.mvr-chip').length:0;
  o.bigMoves=many.length;
  if(r3){
    const boxes=[...r3.querySelectorAll('.mvr-chip')].map(c=>({
      cancel:c.classList.contains('mvr-cancel'), r:c.getBoundingClientRect() }));
    let hits=0, cancelHits=0, offscreen=0;
    for(let i=0;i<boxes.length;i++){
      const A=boxes[i].r;
      if(A.left<0||A.top<0||A.right>innerWidth||A.bottom>innerHeight) offscreen++;
      for(let j=i+1;j<boxes.length;j++){
        const B=boxes[j].r;
        const ov=!(A.right<=B.left||B.right<=A.left||A.bottom<=B.top||B.bottom<=A.top);
        if(ov){ hits++; if(boxes[i].cancel||boxes[j].cancel) cancelHits++; }
      }
    }
    o.bigOverlaps=hits; o.bigCancelOverlaps=cancelHits; o.bigOffscreen=offscreen;
    o.boxes=[...r3.querySelectorAll('.mvr-chip')].map(c=>{
      const q=c.getBoundingClientRect();
      return (c.classList.contains('mvr-cancel')?'X':(c.querySelector('.mvr-key')||{}).textContent)
        +' ['+Math.round(q.left)+','+Math.round(q.top)+' '+Math.round(q.width)+'x'+Math.round(q.height)+']';
    });
  }
  _closeMoveRing();

  /* ── AND THE SAME SET ON A UNIT AT THE EDGE. Widening the radius to fit eight
     chips pushes the ring ~355px from the unit, so a unit in the left column of
     the board now reaches further past the viewport than it used to. Cancel is
     the one at 180deg, i.e. the chip pointing straight AT that edge. ───────── */
  _uhmRect={left:70,top:120,width:60,height:80,right:130,bottom:200,x:70,y:120};
  App.ui.modalUnitId=null;
  _openMoveRing('many_unit'); await nap(250);
  const r4=document.getElementById('move-ring');
  if(r4){
    const bs=[...r4.querySelectorAll('.mvr-chip')].map(c=>c.getBoundingClientRect());
    o.edgeClipped=bs.filter(q=>q.left<0||q.top<0||q.right>innerWidth||q.bottom>innerHeight).length;
    o.edgeChips=bs.length;
  }
  _closeMoveRing();

  /* The lone targeting chip has the same exposure — a unit on the BOTTOM rank
     would push it under the fold, and that one really is the only way out. */
  App.ui.selectedUnitId='many_unit'; App.ui.selectedMoveId=many[0];
  _uhmRect={left:700,top:innerHeight-70,width:60,height:60,right:760,
            bottom:innerHeight-10,x:700,y:innerHeight-70};
  _hideTargetCancel(); _showTargetCancel(); await nap(200);
  const tcb=document.querySelector('#target-cancel .mvr-cancel');
  const tq=tcb?tcb.getBoundingClientRect():null;
  o.tcEdgeOnScreen=!!(tq&&tq.left>=0&&tq.top>=0&&tq.right<=innerWidth&&tq.bottom<=innerHeight);
  _hideTargetCancel(); App.ui.selectedUnitId=null; App.ui.selectedMoveId=null;

  /* FALLBACK: a unit with no moves must still get the modal */
  const bare={...u, id:'bare_unit', knownMoves:[]}; App.state.units.push(bare);
  App.ui.modalUnitId=null;
  o.bareRing=_openMoveRing('bare_unit');
  return o;
});
console.log('\n\u{1F3AF} THE MOVE RING\n');
console.log('   '+JSON.stringify(r));
ok('the unit has moves to ring',(r.moves|0)>0,r.moves+' known');
ok('\u{1F3AF} the ring opened',r.opened===true&&r.ringInDom===true);
ok('\u{1F3AF} one chip per known move',r.chips===r.moves,r.chips+' chips vs '+r.moves+' moves');
ok('every move chip is element-tinted',r.tinted===r.chips,r.tinted+'/'+r.chips);
ok('chips show real move names',(r.names||[]).length>0,(r.names||[]).join(', '));
ok('\u{1F4CF} every move with a range shows one',(r.rngShown|0)>0,r.rngShown+' badges');
ok('\u{1F3AF} ...and it is the EFFECTIVE range the arrows use, not the base',
   (r.rngBad||[]).length===0,(r.rngBad||[]).join(' | ')||'all match');
console.log('\n\u{2716} the hover tab and the rail button');
ok('\u{1F3AF} the hover tab is SUPPRESSED while the ring is open',r.suppressed===true,'_hoverMenuSuppressed()='+r.suppressed);
ok('\u{1F3AF} no rail Cancel renders in the armed state',r.railCancelWhileArmed===false,'#bc-cancel-sel present: '+r.railCancelWhileArmed);
console.log('\n\u{2716} cancel in the RING (which move?)');
ok('\u{1F3AF} the ring carries exactly one Cancel chip',r.ringCancels===1,r.ringCancels+' found');
ok('Cancel is never dimmed — leaving costs nothing',r.cancelNotDimmed===0,r.cancelNotDimmed+' dimmed at 0 energy');
ok('\u{1F3AF} clicking it closes the ring',r.ringCancelFound===true&&r.ringGoneAfterCancel===true);
ok('...and drops the selected unit',r.selUnitAfterRingCancel===null,'selectedUnitId='+r.selUnitAfterRingCancel);
ok('...without falling through to the details modal',r.modalAfterRingCancel===false);
console.log('\n\u{2716} cancel while ARMED (pick a target) — the state with no ring');
ok('\u{1F3AF} a Cancel appears on the unit once a move is armed',r.tcArmed===true,'#target-cancel: '+r.tcArmed);
ok('...and survives a re-render (the rail rebuilds constantly)',r.tcSurvivesRender===true);
ok('\u{1F3AF} clicking it disarms the move',r.selAfterTC===null,'selectedMoveId='+r.selAfterTC);
ok('...and drops the unit',r.unitAfterTC===null,'selectedUnitId='+r.unitAfterTC);
ok('...and removes itself',r.tcGone===true);
ok('\u{1F3AF} it comes back when a move is armed again',r.tcReArmed===true);
ok('\u{1F3AF} and it does NOT linger once the attack resolves',r.tcAfterResolve===false,
   'stale chip present: '+r.tcAfterResolve);
console.log('\n\u{1F3AF} the rest');
ok('\u{1F3AF} clicking a chip SELECTS that move',r.selAfter&&r.selAfter===r.clicked,r.selBefore+' -> '+r.selAfter);
ok('...and puts the unit in attack mode (this lights the fan)',r.mode==='attack','mode='+r.mode);
ok('...and closes the ring',r.ringClosed===true);
ok('\u{1F3AF} the DETAILS modal did NOT open',r.modalOpened===false,'modalUnitId set: '+r.modalOpened);
ok('unaffordable moves are SHOWN and dimmed, not hidden',r.chipsBroke===r.moves&&r.offBroke>0,
   r.chipsBroke+' chips, '+r.offBroke+' dimmed at 0 energy');
console.log('\n\u{1F4D0} a FULL move set — the case the ring has never been seen in');
ok('all 8 moves plus Cancel are chipped',r.bigChips===r.bigMoves+1,r.bigChips+' chips for '+r.bigMoves+' moves + cancel');
ok('\u{1F3AF} no two chips overlap',r.bigOverlaps===0,r.bigOverlaps+' overlapping pairs');
ok('\u{1F3AF} ...and Cancel in particular is clear of every move',r.bigCancelOverlaps===0,
   r.bigCancelOverlaps+' pairs involve Cancel');
ok('every chip stays on screen',r.bigOffscreen===0,r.bigOffscreen+' clipped');
ok('\u{1F3AF} ...and still does for a unit in the top-left corner',r.edgeClipped===0,
   r.edgeClipped+' of '+r.edgeChips+' clipped off-viewport');
ok('\u{1F3AF} the lone targeting Cancel stays on screen on the bottom rank',r.tcEdgeOnScreen===true,
   'reachable: '+r.tcEdgeOnScreen);
console.log('');
ok('\u{1F3AF} FALLBACK: no moves -> ring declines so the modal answers',r.bareRing===false,'returned '+r.bareRing);
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close(); process.exit(fails?1:0);
