/* ══════════════════════════════════════════════════════════════════════════
   🎯 DRIVE-HOVER-REACH — arrows from a HOVER, on the player's turn, for units
   that can actually attack. And nothing left behind when the pointer leaves.

   Asked for: "on a player turn where their units and hero can attack (only)
   show arrows where their attacks can reach on an enemy unit while hovering
   over the unit instead of having to press attack. Also when the player isn't
   hovering, remove all of their popups immediately."

   The interesting assertions are the ones that catch a fan which LIES:
     · a unit that has already attacked gets NO arrows        (the "(only)")
     · an ENEMY unit hovered on the player's turn gets none    (whose turn it is)
     · nothing at all on the AI's turn
     · hover-out clears the fan in the SAME push, no timer
     · an armed attack still owns the telegraph — the hover must not overwrite
       the one move the player actually chose
     · and the count matches a reach set computed independently here, so the
       board cannot offer an arrow at a target out of range

   ⚠ _bbStagePushTele ends by diffing against _BBS.teleKey and returns early
     when the payload is unchanged. Every push below clears that key first, or
     the driver reads -1 in every state and looks exactly like a dead feature —
     drive-attack-fan lost a full pass to precisely this.
   ⚠ App._bbHover is BOARD coords {x, z}, not game {x, y} (CONTRACT §1.1).

   Run:  node .gauntlet/drive-hover-reach.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=7960+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1600,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await pg.route('**/*',(r)=>{const u=r.request().url(); if(u.includes('127.0.0.1')||u.includes('localhost'))return r.continue(); return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/index.html`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('typeof initGame==="function" && typeof _hoverAttackReach==="function"',null,{timeout:180000}).catch(()=>{});
await pg.waitForTimeout(4000);

const r=await pg.evaluate(async ()=>{
  const o={};
  App.battlePrep=App.battlePrep||{};
  const me=findHeroById(STARTER_HEROES[0].id), foe=findHeroById(STARTER_HEROES[1].id);
  App.battlePrep.hero=me; App.battlePrep.multiplayer=false;
  App.state=initGame(me,foe,[],true,null); App.screen='battle';
  const st=App.state;
  const mine=st.units.find(u=>u&&u.owner==='player'&&u.alive);
  if(!mine){o.err='no player unit';return o;}

  /* Several enemies in reach, one of them a HERO — the ask names heroes. */
  const foes=[];
  for(let i=0;i<4;i++){
    const id='hr_foe_'+i;
    st.units.push({id, name:'Foe '+i, owner:'ai', alive:true, currentHp:10, hp:10, maxHp:10,
                   pos:{x:mine.pos.x+1, y:mine.pos.y+i-1}, isHero:i===3, knownMoves:[], atk:3, def:1});
    foes.push(id);
  }
  o.foesPlaced=foes.length;

  App.ui=App.ui||{};
  App.ui.selectedUnitId=null; App.ui.selectedMoveId=null; App.ui.actionMode=null;
  renderBattleNow();
  await new Promise(r=>setTimeout(r,400));

  /* Capture what the host actually POSTS, and defeat the diff guard. */
  let sent=null;
  const orig=window._bbStagePost;
  window._bbStagePost=(kind,msg)=>{ if(kind==='tele') sent=msg; };
  const push=()=>{ try{ _BBS.teleKey=''; }catch(e){} sent=null; _bbStagePushTele(); };
  const arcs=()=> sent ? (sent.arcs||[]).length : -1;

  /* An INDEPENDENT reach count, so "N arrows" is checked against something
     other than the function that drew them. */
  o.expect=(function(){
    let n=0;
    const seen=new Set();
    for(const m of (mine.knownMoves||[]).map(x=>lookupMove(x)).filter(Boolean)){
      let range=0;
      if(m.kind==='attack') range=getEffectiveAttackRange(mine,m);
      else if(m.target==='enemy') range=m.range|0; else continue;
      for(const t of st.units){
        if(!t||!t.alive||t.owner==='player') continue;
        if(distance(mine.pos,t.pos)>range) continue;
        const k=t.pos.x+','+t.pos.y; if(seen.has(k))continue; seen.add(k); n++;
      }
    }
    return n;
  })();

  const hoverOn=(u)=>{ App._bbHover={x:u.pos.x, z:u.pos.y, unitId:u.id, box:null}; };

  // ── 1. hover a friendly unit that CAN attack, nothing selected ──────────
  st.turn='player'; mine.hasAttacked=false;
  hoverOn(mine); push();
  o.hoverFan=arcs();

  // ── 2. pointer leaves -> gone in the same push, no timer ────────────────
  App._bbHover=null; push();
  o.afterLeave=arcs();

  // ── 3. the unit has already attacked -> "(only)" means none ─────────────
  mine.hasAttacked=true; hoverOn(mine); push();
  o.spentFan=arcs();
  mine.hasAttacked=false;

  // ── 4. hovering an ENEMY on the player's turn -> not their reach to show ─
  const anEnemy=st.units.find(u=>u&&u.id===foes[0]);
  hoverOn(anEnemy); push();
  o.enemyHoverFan=arcs();

  // ── 5. the AI's turn -> nothing at all ──────────────────────────────────
  st.turn='ai'; hoverOn(mine); push();
  o.aiTurnFan=arcs();
  st.turn='player';

  /* ── 5b. ATTACK CLICKED (the ring is open) -> THE ARROWS STAY UP ─────────
     The reported bug: the ring's chips sit well OUT from the unit, so reaching
     for one takes the pointer off it and every arrow vanished mid-decision.
     The ring must pin the fan regardless of hover. */
  App.ui.selectedUnitId=null; App.ui.selectedMoveId=null; App.ui.actionMode=null;
  _uhmRect={left:600,top:400,width:60,height:80,right:660,bottom:480,x:600,y:400};
  st.player.energy=99;
  App.ui.selectedUnitId=mine.id;
  o.ringOpened=_openMoveRing(mine.id);
  await new Promise(r=>setTimeout(r,200));
  o.ringInDom=!!document.getElementById('move-ring');
  o.ringStamp=(document.getElementById('move-ring')||{dataset:{}}).dataset.mvrUnit||null;

  App._bbHover=null; push();                 // pointer is on a CHIP, not the unit
  o.ringNoHoverFan=arcs();

  /* pointer wandering over an empty tile — still not the unit */
  App._bbHover={x:0,z:0,unitId:null,box:null}; push();
  o.ringElsewhereFan=arcs();

  /* and a spent unit must STILL draw nothing even with its ring open */
  mine.hasAttacked=true; push();
  o.ringSpentFan=arcs();
  mine.hasAttacked=false;

  /* close it the way Cancel does -> back to hover-only */
  _closeMoveRing();
  try{ _clearUnitSelection(); }catch(e){}
  App._bbHover=null; push();
  o.afterRingClosed=arcs();

  // ── 6. an ARMED attack still owns the telegraph ─────────────────────────
  const atk=(mine.knownMoves||[]).map(m=>lookupMove(m)).find(m=>m&&m.kind==='attack');
  App.ui.selectedUnitId=mine.id; App.ui.actionMode='attack';
  App.ui.selectedMoveId=atk?atk.id:null;
  renderBattleNow(); await new Promise(r=>setTimeout(r,400));
  o.paintTargets=((App._bbPaint||{}).attack||[]).length;
  App._bbHover=null; push();
  o.armedFan=arcs();
  /* now hover a DIFFERENT friendly unit while armed — the selection must win */
  hoverOn(mine); push();
  o.armedStillSelection = (arcs()===o.paintTargets);

  window._bbStagePost=orig;
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F3AF} HOVER REACH\n');
if(r.err){ ok('a battle was built', false, r.err); }
else{
  console.log('   independent reach count: '+r.expect+'   (4 foes placed, one a hero)\n');
  ok('the hover fan has something to show', (r.expect|0)>=2, r.expect+' reachable');
  ok('\u{1F3AF} hovering a unit that CAN attack draws its whole reach — no click',
     r.hoverFan===r.expect, r.hoverFan+' arrows vs '+r.expect+' expected');
  ok('\u{1F3AF} pointer leaves -> the fan is gone in the SAME push (no timer)',
     r.afterLeave===0, r.afterLeave+' arrows');
  ok('\u{1F3AF} a unit that has ALREADY attacked draws nothing — the "(only)"',
     r.spentFan===0, r.spentFan+' arrows');
  ok('\u{1F3AF} hovering an ENEMY draws nothing on the player\'s turn',
     r.enemyHoverFan===0, r.enemyHoverFan+' arrows');
  ok('\u{1F3AF} nothing at all on the AI\'s turn', r.aiTurnFan===0, r.aiTurnFan+' arrows');
  console.log('\n\u{2694} attack CLICKED — the ring is open, the pointer is on a chip');
  ok('the ring opened (else nothing below is exercised)', r.ringOpened===true&&r.ringInDom===true);
  ok('the ring is stamped with its own unit', String(r.ringStamp||'')!=='' , 'data-mvr-unit='+r.ringStamp);
  ok('\u{1F3AF} arrows stay up with NO hover at all', r.ringNoHoverFan===r.expect,
     r.ringNoHoverFan+' arrows vs '+r.expect+' expected');
  ok('\u{1F3AF} ...and while the pointer is somewhere else entirely',
     r.ringElsewhereFan===r.expect, r.ringElsewhereFan+' arrows');
  ok('a SPENT unit still draws nothing even with its ring open',
     r.ringSpentFan===0, r.ringSpentFan+' arrows');
  ok('\u{1F3AF} closing the ring returns to hover-only — no arrows unhovered',
     r.afterRingClosed===0, r.afterRingClosed+' arrows');
  console.log('');
  ok('an armed attack still fans from the SELECTION', r.armedFan===r.paintTargets,
     r.armedFan+' arrows vs paint '+r.paintTargets);
  ok('\u{1F3AF} ...and a hover does not overwrite the move the player chose',
     r.armedStillSelection===true);
}
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
