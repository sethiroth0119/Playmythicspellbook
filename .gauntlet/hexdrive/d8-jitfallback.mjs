// DRIVER 8 — jitQuad's "NEVER FALL BACK TO NOTHING" GUARD.
//
// jitQuad projects 8 jittered lattice points; if any one fails to project it
// falls back to api.tilePoly(...) and rebuilds the 8-point form from it. The
// fallback demands EXACTLY 4 vertices:
//     if (!tp || tp.length !== 4) { _polys.set(key, null); return null; }
// On the hex board tilePoly is hexCorners -> SIX. So the guard whose own
// comment says "dropping the tile silently makes a LEGAL TILE UNPAINTABLE"
// drops every tile it is asked to rescue.
//
// This driver FORCES the fallback (a project() that refuses the jittered
// points) and reads the answer, rather than reasoning about it.
import { OVERLAY, bootMatch } from './boot.mjs';

OVERLAY.set('/src/battle/stage/tilefx.js', src =>
  src + '\ntry { window.__TFX = { jitQuad }; } catch (e) {}\n');

const { page, close, pageErrors } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__TFX); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => { try { const r = fn(); res.push({ name, ...r }); } catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); } };
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const TFX = bw.__TFX;

  // An api whose project() refuses ONLY the jittered points — the exact
  // condition the fallback exists for. The unjittered brick corners still
  // project, so a correct fallback has something to work with.
  const mkApi = (refuse) => ({
    MAP: { cols: BOARD_W, rows: BOARD_H },
    tileElev: bw.tileElev, gw: bw.gw, tilePoly: bw.tilePoly,
    hash: (a, b, c) => 0.5 + 0.4 * Math.sin(a * 12.9898 + b * 78.233 + c),
    W: 800, H: 600,
    project: (p) => refuse(p) ? null : bw.project(p),
  });

  T('tilePoly on the hex board returns 6 vertices, so the 4-vertex fallback is dead', () => {
    const p = bw.tilePoly(6, 6, 0);
    return { pass: p && p.length === 6, note: `tilePoly(6,6).length = ${p ? p.length : 'null'}` };
  });

  T('FORCED fallback: jitQuad must still return an 8-point polygon, never null', () => {
    // ⚠ REFUSE EXACTLY ONE CALL — the first. jitQuad BREAKS out of its 8-point
    // loop on the first refusal, so it only ever makes one call before falling
    // back; a stub that refuses "the first 8" therefore also refuses 7 of the
    // fallback's own calls and scores a false NULL. (That is what this driver
    // did on its first run.)
    let refused = false;
    const api = mkApi(() => { if (refused) return false; refused = true; return true; });
    const q = TFX.jitQuad(api, 5, 5, 0.02, 0.06);
    return { pass: !!q && q.length === 8,
      note: q ? `returned ${q.length} points (want 8), all finite ${q.every(p => p && isFinite(p.x) && isFinite(p.y))}`
              : 'returned NULL — the tile is unpaintable, which is exactly what the guard exists to prevent' };
  });

  return res;
});

let pass = 0, fail = 0;
for (const r of R) { r.pass ? pass++ : fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`); }
console.log(`\nD8 JITQUAD FALLBACK: ${pass} pass / ${fail} fail   pageErrors ${pageErrors.length}`);
await close();
