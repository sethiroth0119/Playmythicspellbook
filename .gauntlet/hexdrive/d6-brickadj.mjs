// DRIVER 6 — WHICH TILE IS ON THE OTHER SIDE OF EACH EDGE?
//
// tilefx's jitQuad does NOT draw a hexagon. It builds the cell as the unit
// square (x±0.5, z±0.5) in TILE space and pushes it through the board's own
// gw(), which applies the odd-row +0.5 stagger and the 1.5 row pitch. The
// result is a BRICK lattice: bricks of hexW x hexV, offset half a brick on odd
// rows. This driver derives, from the real gw() geometry and by sampling, which
// brick lies across each of the four brick sides — because the fix to
// boundaryEdges depends on that mapping and it must not be guessed.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.gw); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});

const R = await page.evaluate(() => {
  const res = [];
  const T = (name, fn) => { try { const r = fn(); res.push({ name, ...r }); } catch (e) { res.push({ name, pass: false, note: 'THREW: ' + (e && e.message) }); } };
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  // MAP is a lexical const inside the board (window.MAP is undefined — the
  // globals trap again). HEXSPEC §7: the canvas dims are FED from BOARD_W /
  // BOARD_H, so take them from the game side rather than re-typing them.
  const gw = bw.gw, MAP = { cols: BOARD_W, rows: BOARD_H };

  // ⚠ EVERY gw() CALL HERE USES INTEGER TILE COORDS. rowShift() INTERPOLATES
  // the half-column stagger for fractional rows (deliberately — the walk tween
  // needs that), so gw(x-0.5, z-0.5) is NOT the brick's corner: it carries a
  // quarter-column of shift that belongs to neither row. Derive hexW / hexV
  // from integer steps instead and offset from the integer centre by hand.
  const o = gw(0, 0, 0), ex = gw(1, 0, 0), ez = gw(0, 2, 0);
  const HEXW = ex.x - o.x, HEXV = (ez.z - o.z) / 2;
  const centre = (x, z) => gw(x, z, 0);
  // world -> which brick owns this world point (brute force over the board)
  const ownerOf = (wx, wz) => {
    for (let z = 0; z < MAP.rows; z++) for (let x = 0; x < MAP.cols; x++) {
      const c = centre(x, z);
      if (Math.abs(wx - c.x) < HEXW / 2 && Math.abs(wz - c.z) < HEXV / 2) return [x, z];
    }
    return null;
  };

  T('the brick lattice tiles the plane: 4 sides, 6 distinct edge-neighbours', () => {
    const rows = []; let ok = true;
    for (const z of [6, 7]) {                                     // even row, odd row
      const x = 6;
      const eps = 0.06;
      const c = centre(x, z);
      // sample just outside each of the four brick sides, at the quarter points
      const probes = {
        'N-left':  [-0.25, -(0.5 + eps)], 'N-right': [+0.25, -(0.5 + eps)],
        'S-right': [+0.25, +(0.5 + eps)], 'S-left':  [-0.25, +(0.5 + eps)],
        'E':       [+(0.5 + eps), 0],     'W':       [-(0.5 + eps), 0],
      };
      const found = {};
      for (const k in probes) {
        found[k] = ownerOf(c.x + probes[k][0] * HEXW, c.z + probes[k][1] * HEXV);
      }
      const uniq = new Set(Object.values(found).map(v => v && v.join(',')));
      // and they must all be true hex neighbours of (x,z) under the GAME lattice
      const hexSet = new Set(hexNeighbors(x, z).map(n => n.x + ',' + n.y));
      const allHex = [...uniq].every(k => hexSet.has(k));
      if (uniq.size !== 6 || !allHex) ok = false;
      rows.push(`row${z} (${z & 1 ? 'odd' : 'even'}): ` +
        Object.keys(found).map(k => `${k}->${found[k] ? found[k].join(',') : 'null'}`).join(' ') +
        ` | distinct ${uniq.size}, allAreHexNeighbours ${allHex}`);
    }
    return { pass: ok, note: rows.join('\n        ') };
  });

  return res;
});

for (const r of R) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.note}`);
console.log('pageErrors:', pageErrors.length);
await close();
