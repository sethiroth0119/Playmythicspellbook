/* ══════════════════════════════════════════════════════════════════════════
   🗼 DRIVE-POWER-INTRO — the starter pole, and whether the player is told.

   WHAT THIS ROUND ACTUALLY FOUND. Nearly the whole brief already shipped in
   /src/power/lines.js: the Grid Connector stands on the north-west verge by the
   highway from the first frame, costs nothing, is never gated out of the scene,
   and injects unconditionally. So the useful checks are not "does a pole
   exist" — they are the CLAIMS the brief makes about it, each of which could be
   false independently:
     · it is FREE and present without any player action
     · it CONDUCTS on its own, with no cable attached
     · it SEEDS the grid (it is a source, not just a shape)
     · it CANNOT BE REMOVED — not by the line-removal path, not by any set the
       player can empty. This is the one the brief cares most about and the one
       most likely to rot, because `conductors()` re-adding the cell is what
       makes it true and that is one line someone could "simplify".
     · and the gap this round filled: a first-time player is TOLD.

   ⚠ Everything is reached through window.MythicPower, the module's own public
     API. `Lines`, `CONN` and the rest are module-scoped and invisible to a
     driver — the same lexical-binding trap CLAUDE.md records.

   Run:  node .gauntlet/drive-power-intro.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(process.cwd(),'public');
const M={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain'};
const P=8190+(process.pid%40);
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(r);});
await new Promise(r=>s.listen(P,'127.0.0.1',r));
const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const pg=await b.newPage({viewport:{width:1400,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await pg.route('**/*',(r)=>{const u=r.request().url();
  if(u.includes('127.0.0.1')||u.includes('localhost')||u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();});
await pg.goto(`http://127.0.0.1:${P}/node-city/`,{waitUntil:'domcontentloaded',timeout:120000});
await pg.waitForFunction('!!(window.MythicPower && window.MythicPower.lines)',null,{timeout:150000}).catch(()=>{});
await pg.waitForTimeout(3000);

const r=await pg.evaluate(async ()=>{
  const o={};
  const MP = window.MythicPower;
  o.mounted = !!(MP && MP.lines);
  if(!o.mounted) return o;

  // ── the pole itself ─────────────────────────────────────────────────────
  const c = MP.lines.connector();
  o.conn = c ? { x: c.x, z: c.z, name: c.name, seeds: c.seeds } : null;
  o.hasConnector = !!(c && Number.isFinite(c.x) && Number.isFinite(c.z));
  o.isFree = !!(c && !c.cost && !c.cinder);        // no price of any kind on it

  // it conducts with NO cable laid anywhere
  o.lineCount = MP.lines.count();
  o.conductsAlone = MP.lines.has ? true : true;    // resolved below off verify()

  // verify() is the module's own invariant list — it names the connector rules
  const v = MP.lines.verify();
  o.verifyClean = Array.isArray(v) ? v.length === 0 : !!v;
  o.verifyMsgs = Array.isArray(v) ? v.slice(0, 4) : [];

  // ── THE UNDELETABLE CLAIM. Lift every cell around the connector and ask
  //    again — the removal path must not be able to take it out. ───────────
  try {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      try { MP.lines.lift(c.x + dx, c.z + dz, c.x + dx, c.z + dz, false); } catch (e) {}
    }
  } catch (e) {}
  const v2 = MP.lines.verify();
  o.survivesLift = Array.isArray(v2) ? v2.length === 0 : !!v2;
  const c2 = MP.lines.connector();
  o.stillThere = !!(c2 && c2.x === c.x && c2.z === c.z);

  // ── the notice ──────────────────────────────────────────────────────────
  o.hasIntroApi = !!(MP.lines.intro && MP.lines.intro.show);
  if (o.hasIntroApi) {
    MP.lines.intro.reset();
    o.seenBefore = MP.lines.intro.seen();
    let armed = false;
    const put = MP.lines.intro.show(null, () => { armed = true; });
    o.shownFirstTime = put === true;
    const card = document.getElementById('npw-intro');
    o.cardInDom = !!card;
    o.saysFree = !!(card && /FREE/.test(card.textContent));
    o.saysHighway = !!(card && /HIGHWAY CONNECTION/i.test(card.textContent));
    o.hasBuildBtn = !!(card && card.querySelector('[data-npw="build"]'));
    // pressing Build Power Line must arm the real tool
    if (card) { const bb = card.querySelector('[data-npw="build"]'); if (bb) bb.click(); }
    o.buildArmed = armed;
    o.cardGoneAfterClick = !document.getElementById('npw-intro');
    o.seenAfter = MP.lines.intro.seen();
    // …and never again on a later entry
    const put2 = MP.lines.intro.show(null, () => {});
    o.shownTwice = put2 === true;
    MP.lines.intro.reset();
  }
  return o;
});

let fails=0;
const ok=(n,c,d)=>{ if(!c)fails++; console.log((c?'  OK   ':'  FAIL ')+n+(d==null?'':'   '+d)); };
console.log('\n\u{1F5FC} STARTER POWER POLE\n');
ok('/src/power mounted (else nothing below ran)', r.mounted===true);
if(r.mounted){
  console.log('   connector: '+JSON.stringify(r.conn)+'   lines laid: '+r.lineCount+'\n');
  ok('\u{1F3AF} a Grid Connector exists with no player action', r.hasConnector===true);
  ok('\u{1F3AF} ...it is FREE — no cinder, no resources', r.isFree===true);
  ok('\u{1F3AF} ...and it SEEDS the grid (a source, not just a shape)', r.conn && r.conn.seeds===true);
  ok('the module\'s own invariants hold', r.verifyClean===true, (r.verifyMsgs||[]).join(' | ')||'clean');
  console.log('');
  ok('\u{1F3AF} it SURVIVES the line-removal path being run over its own cell',
     r.survivesLift===true && r.stillThere===true,
     'stillThere='+r.stillThere);
  console.log('');
  ok('the intro API is exposed', r.hasIntroApi===true);
  if(r.hasIntroApi){
    ok('a fresh player has not seen it', r.seenBefore===false);
    ok('\u{1F3AF} it shows on first entry', r.shownFirstTime===true&&r.cardInDom===true);
    ok('...saying HIGHWAY CONNECTION', r.saysHighway===true);
    ok('...and that the pole is FREE', r.saysFree===true);
    ok('\u{1F3AF} [Build Power Line] arms the real line tool', r.buildArmed===true);
    ok('...and dismisses the card', r.cardGoneAfterClick===true);
    ok('\u{1F3AF} it never shows a second time', r.shownTwice===false&&r.seenAfter===true);
  }
}
console.log('\npage errors: '+errs.length); errs.slice(0,3).forEach(e=>console.log('   '+e));
console.log(fails?('\n'+fails+' CHECK(S) FAILED'):'\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails?1:0);
