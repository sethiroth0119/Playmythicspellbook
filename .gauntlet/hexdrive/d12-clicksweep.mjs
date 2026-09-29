// DRIVER 12 — REAL MOUSE CLICKS on all 168 projected tile centres.
// The merge report left "clicking a unit's FEET selects it" open. __bbHexCheck
// answers it geometrically; this answers it with the actual pointer path
// .bb-catch -> board:pointer -> pickTile -> board:tileClick.
//
// Two things make it exact (both learned the hard way by the branch's own gate,
// FUNCTION-INVENTORY "Sign-off rigs"):
//   · App.replayViewing = true makes the host's board:tileClick handler a no-op,
//     so the click travels the whole real path WITHOUT mutating the match — no
//     unit modal opening over the board to eat the next 100 clicks.
//   · each click is POLLED for its own answer rather than zipped positionally:
//     a centre that projects off-canvas dispatches nothing, and a positional zip
//     turns one silent click into a phantom mismatch on every click after it.
import { bootMatch } from './boot.mjs';

const { page, close, pageErrors } = await bootMatch();
await page.waitForFunction(() => {
  try { const f = document.querySelector('#bb-stage-host iframe'); return !!(f && f.contentWindow && f.contentWindow.__bbHexCheck); }
  catch (e) { return false; }
}, null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);

// arm: silence the host handler and record every tileClick the board dispatches
const armed = await page.evaluate(() => {
  App.replayViewing = true;
  window.__CLICKS = [];
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'board:tileClick') window.__CLICKS.push({ x: d.x, z: d.z });
  });
  const host = document.querySelector('#bb-stage-host');
  const r = host ? host.getBoundingClientRect() : null;
  return r ? { left: r.left, top: r.top, w: r.width, h: r.height } : null;
});
if (!armed) { console.log('no #bb-stage-host rect'); await close(); process.exit(0); }

// the board's own published tile centres
const rects = await page.evaluate(() => {
  const bw = document.querySelector('#bb-stage-host iframe').contentWindow;
  const out = [];
  for (let z = 0; z < BOARD_H; z++) for (let x = 0; x < BOARD_W; x++) {
    let p = null;
    try { const w = bw.gw(x, z, bw.tileElev(x, z)); p = bw.project({ x: w.x, y: w.y, z: w.z }); } catch (e) {}
    out.push({ x, z, px: p ? p.x : null, py: p ? p.y : null });
  }
  return out;
});

let correct = 0, wrong = 0, silent = 0; const misses = [];
for (const t of rects) {
  if (t.px == null) { silent++; misses.push(`(${t.x},${t.z}) no projection`); continue; }
  await page.evaluate(() => { window.__CLICKS.length = 0; });
  await page.mouse.click(armed.left + t.px, armed.top + t.py);
  // poll for THIS click's own answer
  let got = null;
  for (let i = 0; i < 12; i++) {
    got = await page.evaluate(() => window.__CLICKS[0] || null);
    if (got) break;
    await page.waitForTimeout(25);
  }
  if (!got) { silent++; misses.push(`(${t.x},${t.z}) silent`); continue; }
  if (got.x === t.x && got.z === t.z) correct++;
  else { wrong++; misses.push(`(${t.x},${t.z}) -> (${got.x},${got.z})`); }
}

console.log(`REAL MOUSE CLICKS on 168 projected tile centres, 1600x900, neutral fit:`);
console.log(`  correct ${correct} / ${rects.length}   wrong ${wrong}   silent/off-canvas ${silent}`);
if (misses.length) console.log('  ' + misses.slice(0, 12).join('\n  '));
console.log('pageErrors:', pageErrors.length, pageErrors.slice(0, 4));
console.log(wrong === 0 && silent === 0 ? '\nD12 CLICK SWEEP: PASS — 168/168' : '\nD12 CLICK SWEEP: see numbers above');
await close();
