// DRIVER 8b — TEETH. Re-run d8's corrected stub against the PRE-FIX tilefx.js
// taken straight out of the merge commit, so the "before" number is measured
// with the same instrument as the "after" one. Without this the before/after
// comparison is worthless: d8's first stub was itself wrong.
import { execSync } from 'node:child_process';
import { OVERLAY, bootMatch } from './boot.mjs';

const PREFIX = execSync('git show HEAD:public/src/battle/stage/tilefx.js',
  { cwd: 'D:/game-deploy', maxBuffer: 1 << 28 }).toString();

OVERLAY.set('/src/battle/stage/tilefx.js', () =>
  PREFIX + '\ntry { window.__TFX = { jitQuad, boundaryEdges }; } catch (e) {}\n');

const { page, close, pageErrors } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__TFX); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

const R = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const TFX = bw.__TFX;
  let refused = false;
  const api = {
    MAP: { cols: BOARD_W, rows: BOARD_H },
    tileElev: bw.tileElev, gw: bw.gw, tilePoly: bw.tilePoly,
    hash: (a, b, c) => 0.5 + 0.4 * Math.sin(a * 12.9898 + b * 78.233 + c),
    W: 800, H: 600,
    project: (p) => { if (!refused) { refused = true; return null; } return bw.project(p); },
  };
  const q = TFX.jitQuad(api, 5, 5, 0.02, 0.06);
  const src = String(TFX.boundaryEdges);
  return {
    prefixJitQuad: q ? `${q.length} points` : 'NULL',
    prefixBoundaryTests: (src.match(/g\.set\.has\([^)]*\)/g) || []).length,
  };
});

console.log('PRE-FIX (HEAD, the merge commit), same corrected stub:');
console.log('  jitQuad forced fallback ->', R.prefixJitQuad, '   (post-fix: 8 points)');
console.log('  boundaryEdges adjacency tests ->', R.prefixBoundaryTests, '  (post-fix: 6)');
console.log('pageErrors:', pageErrors.length);
await close();
