/* 🔑 THE NEGATIVE CONTROL FOR THE POOL'S CACHE KEY.
   ═══════════════════════════════════════════════════════════════════════════
   The claim under test: bakeKeys()'s `shape` does NOT contain the camera, so
   the stage pool — which is the board's PROJECTED outline — would go stale the
   moment the camera yaws, and ensureBakes() re-bakes the veil alone when the
   pool's signature moves. That is §10.7's trap living in vista's own cache
   rather than the board page's, and the whole lesson of this pass is that a
   check which merely asserts "the code is present" answers a question one
   degree from the one that matters.

   So this does not grep. It drives the real page twice, identically, YAWING
   THE CAMERA 34° four seconds in, and differs only in the module's own
   ablation flag:

     ARMED    __vistaOff.poolkey unset  -> the veil re-bakes, pool follows board
     ABLATED  __vistaOff.poolkey = 1    -> the veil keeps yaw-0's pool

   It reads five 64x64 boxes straight off the live board canvas. If the two
   runs come back IDENTICAL the block is dead code and this reports FAIL —
   which is the failure mode the check exists to catch, and the reason the
   ablated run is here at all rather than a lone "it looks right" capture.

   Run: node _sl-poolkey.mjs
*/
import { spawnSync } from 'node:child_process';

const PROBE = `(function(){
  var cs=[].slice.call(document.querySelectorAll('canvas'));
  cs.sort(function(a,b){return b.width*b.height-a.width*a.height;});
  var c=cs[0]; if(!c) return {err:'no canvas'};
  var g=c.getContext('2d'); var W=c.width,H=c.height;
  var pts={farLeft:[0.18,0.30],left:[0.24,0.46],centre:[0.50,0.45],right:[0.76,0.46],farRight:[0.82,0.30]};
  var out={};
  for (var k in pts){
    var x=Math.max(0,Math.round(pts[k][0]*W)-32), y=Math.max(0,Math.round(pts[k][1]*H)-32);
    var d=g.getImageData(x,y,64,64).data, s=0, n=d.length/4;
    for(var i=0;i<d.length;i+=4) s+=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    out[k]=Math.round(s/n*10)/10;
  }
  return { yawDeg: (window.__bbCam?window.__bbCam.get().yawDeg:null), W:W, H:H, box:out };
})()`;

function run(label, ablate) {
  /* ⚠ SYNCHRONOUS, NOT A setTimeout, AND THE FIRST ATTEMPT GOT THIS WRONG.
     boardshot runs --eval AFTER --wait and then gives it only 2500 ms before
     --report, so a 4 s timer fired after the probe had already read the frame
     and both runs came back yawDeg 0 — an INCONCLUSIVE that looked exactly
     like a passing pair of identical numbers. The order that is actually
     wanted is: 9 s of settling (the veil bakes at yaw 0) → yaw → 2500 ms of
     redraw → probe, which is what --wait/--eval/--report already give for
     free once the yaw stops deferring itself. */
  const ev = (ablate
      ? "window.__vistaOff=Object.assign(window.__vistaOff||{},{poolkey:1});"
      : "")
    + "try{window.__bbCam.set(34,0,0);}catch(e){window.__slErr=String(e);}";
  const r = spawnSync(process.execPath, [
    'E:/game-deploy/.gauntlet/boardshot.mjs',
    'C:/Users/sethi/AppData/Local/Temp/claude/E--game-deploy/4aad5554-09a5-412c-a875-a96a5851793c/scratchpad/_pk-' + label + '.png',
    '--wait', '9000', '--w', '1600', '--h', '900',
    '--eval', ev, '--report', PROBE
  ], { encoding: 'utf8', maxBuffer: 1 << 26, cwd: 'E:/game-deploy' });
  let j = null; try { j = JSON.parse(r.stdout); } catch (e) { }
  return j;
}

const armed = run('armed', false);
const abl = run('ablated', true);
const A = armed && armed.report, B = abl && abl.report;
console.log('ARMED   (pool follows the camera):', JSON.stringify(A));
console.log('ABLATED (__vistaOff.poolkey = 1) :', JSON.stringify(B));
if (!A || !B || !A.box || !B.box) { console.log('\nRESULT: INCONCLUSIVE — probe did not return boxes'); process.exit(1); }
if (A.yawDeg !== 34 || B.yawDeg !== 34) { console.log('\nRESULT: INCONCLUSIVE — the camera did not yaw (' + A.yawDeg + '/' + B.yawDeg + ')'); process.exit(1); }
let worst = 0, where = '';
for (const k in A.box) { const d = Math.abs(A.box[k] - B.box[k]); if (d > worst) { worst = d; where = k; } }
console.log('\nper-box delta (armed - ablated):');
for (const k in A.box) console.log('   ' + k.padEnd(10) + String(A.box[k]).padStart(7) + String(B.box[k]).padStart(8) + '   ' + (A.box[k] - B.box[k]).toFixed(1));
console.log('\nlargest |delta| ' + worst.toFixed(1) + ' luma at ' + where);
console.log('RESULT: ' + (worst >= 2
  ? 'PASS — ablating the pool key changes the picture, so the re-bake is live and load-bearing'
  : 'FAIL — the two runs agree, so the invalidation block never fires (dead code)'));
