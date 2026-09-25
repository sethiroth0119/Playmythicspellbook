/* §8.9 — "performance does not regress." The comment in vista.js claims the
   stage pool costs one extra pass over the post bake's thumbnail and NOTHING
   per frame, because it lives in the (attn, col) affine grade rather than in a
   composite. That is a perf claim, so it gets re-measured rather than asserted.

   The honest number on a deferring rasteriser is framePeriodP50 — the wall
   clock between two grade() calls, which the module's own header names as "the
   one number that cannot lie". bakeSplit.post is the bake bracket, reported
   alongside because it is the thing the pool actually lengthens.

   ARMED vs __vistaOff.stagepool = 1, otherwise identical runs.
*/
import { spawnSync } from 'node:child_process';
const PROBE = `(function(){ var d = window.__vistaDebug ? window.__vistaDebug() : null;
  if(!d) return {err:'no __vistaDebug'};
  return { framePeriodP50: d.framePeriodP50, framePeriod: d.framePeriod,
           bakeSplit: d.bakeSplit, postMs: d.post, gradeRawP50: d.gradeRawP50 }; })()`;
function run(ablate){
  const ev = ablate ? "window.__vistaOff=Object.assign(window.__vistaOff||{},{stagepool:1});" : "1;";
  const r = spawnSync(process.execPath, ['E:/game-deploy/.gauntlet/boardshot.mjs',
    'C:/Users/sethi/AppData/Local/Temp/claude/E--game-deploy/4aad5554-09a5-412c-a875-a96a5851793c/scratchpad/_perf.png',
    '--wait','4000','--w','1600','--h','900','--eval',ev,'--report',PROBE],
    { encoding:'utf8', maxBuffer:1<<26, cwd:'E:/game-deploy' });
  try { return JSON.parse(r.stdout).report; } catch(e){ return { err:String(r.stdout||'').slice(-400) }; }
}
console.log('ARMED   ', JSON.stringify(run(false)));
console.log('ABLATED ', JSON.stringify(run(true)));
