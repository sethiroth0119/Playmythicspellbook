// DRIVER 11 — THE TWO LATTICES MUST AGREE (HEXSPEC §1 opening paragraph).
// The game owns one lattice (index.html) and the canvas stage owns another
// (battle-board/index.html). The board ships its own cross-check, __bbHexCheck,
// which samples every tile centre and slab. The merge report left this one
// open; it is the single assertion the hex contract is built around, so drive it.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__bbHexCheck); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(3000);

const R = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const out = { hex: null, cam: null, roundTrip: null };
  try { out.hex = bw.__bbHexCheck(); } catch (e) { out.hex = 'THREW ' + e.message; }
  try { out.cam = bw.__bbCam && bw.__bbCam.check ? bw.__bbCam.check() : null; } catch (e) { out.cam = 'THREW ' + e.message; }
  // an independent round trip: the GAME's tile -> the BOARD's world -> the
  // BOARD's inverse -> back to a tile, over all 168 tiles.
  try {
    let bad = 0, n = 0, worst = null;
    for (let y = 0; y < BOARD_H; y++) for (let x = 0; x < BOARD_W; x++) {
      const w = bw.gw(x, y, 0);
      const t = bw.worldToTile ? bw.worldToTile(w.x, w.z) : null;
      n++;
      if (!t || t.x !== x || t.z !== y) { bad++; if (!worst) worst = `${x},${y} -> ${t ? t.x + ',' + t.z : 'null'}`; }
    }
    out.roundTrip = { n, bad, worst };
  } catch (e) { out.roundTrip = 'THREW ' + e.message; }
  return out;
});

const h = R.hex;
console.log('__bbHexCheck():', typeof h === 'object' ? JSON.stringify(h) : h);
console.log('__bbCam.check():', typeof R.cam === 'object' && R.cam ? JSON.stringify({ click: R.cam.click, painter: R.cam.painter, terrain: R.cam.terrain }) : R.cam);
console.log('game tile -> board gw() -> board worldToTile() round trip:', JSON.stringify(R.roundTrip));
console.log('pageErrors:', pageErrors.length, pageErrors.slice(0, 4));
await close();
